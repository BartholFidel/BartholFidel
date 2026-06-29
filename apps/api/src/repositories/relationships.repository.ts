import type {
  Entity,
  EntityGraph,
  EntityRelationship,
  GraphEdge,
  GraphNode,
} from "@bartholfidel/shared";
import { getPostgresPool } from "../db/postgres.js";
import {
  deleteEntityNode,
  deleteRelationshipEdge,
  mergeEntityNode,
  mergeRelationshipEdge,
  reconcileGraph,
} from "../db/neo4j.js";

interface RelationshipRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  confidence: string;
  last_confirmed_at: Date;
}

function mapRelationship(row: RelationshipRow): EntityRelationship {
  return {
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type,
    confidence: Number(row.confidence),
    last_confirmed_at: row.last_confirmed_at.toISOString(),
  };
}

/**
 * Creates (or refreshes) a relationship. Postgres is the source of truth; the
 * Neo4j edge is best-effort and never blocks the write.
 */
export async function createRelationship(params: {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  confidence?: number;
}): Promise<EntityRelationship> {
  if (params.sourceEntityId === params.targetEntityId) {
    throw new Error("A relationship cannot connect an entity to itself");
  }

  const pool = getPostgresPool();
  const result = await pool.query<RelationshipRow>(
    `INSERT INTO entity_relationships
       (source_entity_id, target_entity_id, relationship_type, confidence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_entity_id, target_entity_id, relationship_type)
     DO UPDATE SET
       last_confirmed_at = now(),
       confidence = EXCLUDED.confidence
     RETURNING *`,
    [
      params.sourceEntityId,
      params.targetEntityId,
      params.relationshipType,
      params.confidence ?? 1.0,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create relationship");
  }

  await mergeRelationshipEdge({
    sourceId: row.source_entity_id,
    targetId: row.target_entity_id,
    type: row.relationship_type,
  }).catch((error: unknown) => {
    console.error("[relationships] neo4j edge merge failed:", error);
  });

  return mapRelationship(row);
}

export async function deleteRelationship(
  id: string,
): Promise<EntityRelationship | null> {
  const pool = getPostgresPool();
  const result = await pool.query<RelationshipRow>(
    `DELETE FROM entity_relationships WHERE id = $1 RETURNING *`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  await deleteRelationshipEdge({
    sourceId: row.source_entity_id,
    targetId: row.target_entity_id,
    type: row.relationship_type,
  }).catch((error: unknown) => {
    console.error("[relationships] neo4j edge delete failed:", error);
  });

  return mapRelationship(row);
}

export async function listRelationships(): Promise<EntityRelationship[]> {
  const pool = getPostgresPool();
  const result = await pool.query<RelationshipRow>(
    `SELECT * FROM entity_relationships ORDER BY last_confirmed_at DESC`,
  );
  return result.rows.map(mapRelationship);
}

/** Finds an existing edge between two entities of a given type, if any. */
export async function findRelationship(
  sourceEntityId: string,
  targetEntityId: string,
  relationshipType: string,
): Promise<EntityRelationship | null> {
  const pool = getPostgresPool();
  const result = await pool.query<RelationshipRow>(
    `SELECT * FROM entity_relationships
     WHERE source_entity_id = $1 AND target_entity_id = $2 AND relationship_type = $3`,
    [sourceEntityId, targetEntityId, relationshipType],
  );
  const row = result.rows[0];
  return row ? mapRelationship(row) : null;
}

interface GraphNodeRow {
  id: string;
  name: string;
  type: string;
  source: string;
  risk_tier: string;
  historically_compromised: boolean;
}

/** Full graph (nodes + edges) read from Postgres for rendering. */
export async function listGraph(): Promise<EntityGraph> {
  const pool = getPostgresPool();
  const [nodeResult, edgeResult] = await Promise.all([
    pool.query<GraphNodeRow>(
      `SELECT id, name, type, source, risk_tier, historically_compromised
       FROM entities`,
    ),
    pool.query<RelationshipRow>(`SELECT * FROM entity_relationships`),
  ]);

  const nodes: GraphNode[] = nodeResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source as Entity["source"],
    risk_tier: row.risk_tier,
    historically_compromised: row.historically_compromised,
  }));

  const edges: GraphEdge[] = edgeResult.rows.map((row) => ({
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type,
    confidence: Number(row.confidence),
  }));

  return { nodes, edges };
}

/** Best-effort upsert of an entity node into Neo4j. */
export async function syncEntityNode(entity: Entity): Promise<void> {
  await mergeEntityNode({
    id: entity.id,
    name: entity.name,
    type: entity.type,
  }).catch((error: unknown) => {
    console.error("[relationships] neo4j node merge failed:", error);
  });
}

/** Best-effort removal of an entity node from Neo4j. */
export async function removeEntityNode(id: string): Promise<void> {
  await deleteEntityNode(id).catch((error: unknown) => {
    console.error("[relationships] neo4j node delete failed:", error);
  });
}

/**
 * Projects the entire Postgres graph into Neo4j. Run on startup to self-heal
 * any drift introduced by best-effort dual-writes.
 */
export async function reconcileNeo4j(): Promise<void> {
  const pool = getPostgresPool();
  const [nodeResult, edgeResult] = await Promise.all([
    pool.query<{ id: string; name: string; type: string }>(
      `SELECT id, name, type FROM entities`,
    ),
    pool.query<RelationshipRow>(`SELECT * FROM entity_relationships`),
  ]);

  await reconcileGraph(
    nodeResult.rows,
    edgeResult.rows.map((row) => ({
      sourceId: row.source_entity_id,
      targetId: row.target_entity_id,
      type: row.relationship_type,
    })),
  );
}
