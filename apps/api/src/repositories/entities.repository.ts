import type { CreateEntityBody, Entity, EntityMetric } from "@bartholfidel/shared";
import type { PoolClient, QueryResult } from "pg";
import { getPostgresPool } from "../db/postgres.js";

interface EntityRow {
  id: string;
  name: string;
  type: string;
  source: string;
  chain_id: number | null;
  address: string | null;
  config: Record<string, unknown>;
  risk_tier: string;
  historically_compromised: boolean;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MetricRow {
  id: string;
  entity_id: string;
  metric: string;
  value: string;
  timestamp: Date;
}

function mapEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source as Entity["source"],
    chain_id: row.chain_id,
    address: row.address,
    config: row.config ?? {},
    risk_tier: row.risk_tier,
    historically_compromised: row.historically_compromised,
    last_active_at: row.last_active_at ? row.last_active_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function mapMetric(row: MetricRow): EntityMetric {
  return {
    id: row.id,
    entity_id: row.entity_id,
    metric: row.metric,
    value: Number(row.value),
    timestamp: row.timestamp.toISOString(),
  };
}

export interface EntityFilters {
  source?: string;
  type?: string;
}

export async function createEntity(body: CreateEntityBody): Promise<Entity> {
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `INSERT INTO entities (name, type, source, chain_id, address, config)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      body.name,
      body.type,
      body.source,
      body.chain_id ?? null,
      body.address ?? null,
      JSON.stringify(body.config ?? {}),
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create entity");
  }
  return mapEntity(row);
}

export async function listEntities(filters: EntityFilters): Promise<Entity[]> {
  const pool = getPostgresPool();
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters.source) {
    params.push(filters.source);
    conditions.push(`source = $${params.length}`);
  }
  if (filters.type) {
    params.push(filters.type);
    conditions.push(`type = $${params.length}`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities ${where} ORDER BY created_at DESC`,
    params,
  );
  return result.rows.map(mapEntity);
}

export async function getEntityById(id: string): Promise<Entity | null> {
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapEntity(row) : null;
}

/** Finds a single entity matching name + type + source, if any. */
export async function findEntityByName(
  name: string,
  type: string,
  source: string,
): Promise<Entity | null> {
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities WHERE name = $1 AND type = $2 AND source = $3 LIMIT 1`,
    [name, type, source],
  );
  const row = result.rows[0];
  return row ? mapEntity(row) : null;
}

/** Finds a web3 entity of given types by on-chain address (case-insensitive). */
export async function findWeb3EntityByAddress(
  address: string,
  types: string[],
): Promise<Entity | null> {
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities
     WHERE source = 'web3' AND type = ANY($1::text[])
       AND lower(address) = lower($2)
     LIMIT 1`,
    [types, address],
  );
  const row = result.rows[0];
  return row ? mapEntity(row) : null;
}

/** Fetches entities by id (order not guaranteed; caller re-orders if needed). */
export async function getEntitiesByIds(ids: string[]): Promise<Entity[]> {
  if (ids.length === 0) {
    return [];
  }
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return result.rows.map(mapEntity);
}

export async function countEntities(): Promise<number> {
  const pool = getPostgresPool();
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM entities`,
  );
  const row = result.rows[0];
  return row ? Number.parseInt(row.count, 10) : 0;
}

/** Last 10 observations per metric name for an entity */
export async function getEntityMetricsGrouped(
  entityId: string,
): Promise<Record<string, EntityMetric[]>> {
  const pool = getPostgresPool();
  const result = await pool.query<MetricRow>(
    `SELECT id, entity_id, metric, value, timestamp
     FROM (
       SELECT *,
         ROW_NUMBER() OVER (PARTITION BY metric ORDER BY timestamp DESC) AS rn
       FROM entity_metrics_history
       WHERE entity_id = $1
     ) ranked
     WHERE rn <= 10
     ORDER BY metric, timestamp DESC`,
    [entityId],
  );

  const grouped: Record<string, EntityMetric[]> = {};
  for (const row of result.rows) {
    const metric = mapMetric(row);
    const list = grouped[metric.metric];
    if (list) {
      list.push(metric);
    } else {
      grouped[metric.metric] = [metric];
    }
  }
  return grouped;
}

/** npm_package entities on the web2 watchlist */
export async function listNpmWatchlistEntities(): Promise<Entity[]> {
  return listEntities({ source: "web2", type: "npm_package" });
}

export async function updateEntity(
  id: string,
  updates: {
    name?: string;
    chain_id?: number | null;
    address?: string | null;
    config?: Record<string, unknown>;
  },
): Promise<Entity> {
  const pool = getPostgresPool();
  const fields: string[] = [];
  const params: Array<string | number | null> = [];

  if (updates.name !== undefined) {
    params.push(updates.name);
    fields.push(`name = $${params.length}`);
  }
  if (updates.chain_id !== undefined) {
    params.push(updates.chain_id);
    fields.push(`chain_id = $${params.length}`);
  }
  if (updates.address !== undefined) {
    params.push(updates.address);
    fields.push(`address = $${params.length}`);
  }
  if (updates.config !== undefined) {
    params.push(JSON.stringify(updates.config));
    fields.push(`config = $${params.length}::jsonb`);
  }

  if (fields.length === 0) {
    return getEntityById(id) as Promise<Entity>;
  }

  params.push(id);
  const result = await pool.query<EntityRow>(
    `UPDATE entities
     SET ${fields.join(", ")}, updated_at = now()
     WHERE id = $${params.length}
     RETURNING *`,
    params,
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to update entity");
  }
  return mapEntity(row);
}

export async function deleteEntity(id: string): Promise<boolean> {
  const pool = getPostgresPool();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM entity_relationships
       WHERE source_entity_id = $1 OR target_entity_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM entity_metrics_history WHERE entity_id = $1`,
      [id],
    );
    await client.query(`DELETE FROM raw_events WHERE entity_id = $1`, [id]);
    const result: QueryResult = await client.query(
      `DELETE FROM entities WHERE id = $1`,
      [id],
    );
    await client.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
