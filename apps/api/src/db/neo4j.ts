import neo4j, { type Driver, type Session } from "neo4j-driver";

let driver: Driver | null = null;

/** Returns the shared Neo4j driver (lazy singleton). */
export function getDriver(): Driver {
  if (!driver) {
    throw new Error("Neo4j driver not initialized. Call connectNeo4j first.");
  }
  return driver;
}

/** Opens a new session on the shared driver. Caller must close it. */
export function getNeo4jSession(): Session {
  return getDriver().session();
}

/** Connects to Neo4j and verifies connectivity. */
export async function connectNeo4j(
  uri: string,
  user: string,
  password: string,
): Promise<void> {
  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  await driver.verifyConnectivity();
}

/** Gracefully closes the Neo4j driver. */
export async function disconnectNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

/**
 * Upserts an entity node. Nodes are kept minimal — Postgres remains the source
 * of truth for full entity metadata; Neo4j only powers traversal.
 */
export async function mergeEntityNode(node: {
  id: string;
  name: string;
  type: string;
}): Promise<void> {
  const session = getNeo4jSession();
  try {
    await session.run(
      "MERGE (e:Entity {id: $id}) SET e.name = $name, e.type = $type",
      node,
    );
  } finally {
    await session.close();
  }
}

/** Removes an entity node and any edges attached to it. */
export async function deleteEntityNode(id: string): Promise<void> {
  const session = getNeo4jSession();
  try {
    await session.run("MATCH (e:Entity {id: $id}) DETACH DELETE e", { id });
  } finally {
    await session.close();
  }
}

/**
 * Upserts a directed relationship edge. A single edge label `REL` discriminated
 * by a `type` property is used so the type can be parameterized safely (Cypher
 * cannot parameterize labels).
 */
export async function mergeRelationshipEdge(edge: {
  sourceId: string;
  targetId: string;
  type: string;
}): Promise<void> {
  const session = getNeo4jSession();
  try {
    await session.run(
      `MATCH (a:Entity {id: $sourceId}), (b:Entity {id: $targetId})
       MERGE (a)-[r:REL {type: $type}]->(b)`,
      edge,
    );
  } finally {
    await session.close();
  }
}

/** Removes a directed relationship edge. */
export async function deleteRelationshipEdge(edge: {
  sourceId: string;
  targetId: string;
  type: string;
}): Promise<void> {
  const session = getNeo4jSession();
  try {
    await session.run(
      `MATCH (a:Entity {id: $sourceId})-[r:REL {type: $type}]->(b:Entity {id: $targetId})
       DELETE r`,
      edge,
    );
  } finally {
    await session.close();
  }
}

/**
 * Returns the ordered entity ids along the shortest path between two entities.
 * Traversal is undirected so direction never blocks pathfinding. Returns an
 * empty array when no path exists.
 */
export async function shortestPathEntityIds(
  fromId: string,
  toId: string,
): Promise<string[]> {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `MATCH (a:Entity {id: $fromId}), (b:Entity {id: $toId}),
             p = shortestPath((a)-[:REL*..15]-(b))
       RETURN [n IN nodes(p) | n.id] AS ids`,
      { fromId, toId },
    );
    const record = result.records[0];
    if (!record) {
      return [];
    }
    return record.get("ids") as string[];
  } finally {
    await session.close();
  }
}

/**
 * Idempotently projects the full graph from Postgres into Neo4j. Used on
 * startup to self-heal any drift from best-effort dual-writes.
 */
export async function reconcileGraph(
  nodes: Array<{ id: string; name: string; type: string }>,
  edges: Array<{ sourceId: string; targetId: string; type: string }>,
): Promise<void> {
  const session = getNeo4jSession();
  try {
    await session.run(
      `UNWIND $nodes AS n
       MERGE (e:Entity {id: n.id}) SET e.name = n.name, e.type = n.type`,
      { nodes },
    );
    if (edges.length > 0) {
      await session.run(
        `UNWIND $edges AS rel
         MATCH (a:Entity {id: rel.sourceId}), (b:Entity {id: rel.targetId})
         MERGE (a)-[r:REL {type: rel.type}]->(b)`,
        { edges },
      );
    }
  } finally {
    await session.close();
  }
}
