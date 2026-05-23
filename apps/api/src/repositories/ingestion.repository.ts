import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { processNewMetric } from "../baseline/zscore.engine.js";
import { getPostgresPool } from "../db/postgres.js";

export function computePayloadHash(payload: unknown): string {
  const normalized = JSON.stringify(payload);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Inserts a raw event if payload_hash is new. Returns true when inserted.
 */
export async function insertRawEventIfNew(params: {
  entityId: string;
  eventType: string;
  source: string;
  eventTimestamp: Date | null;
  payload: unknown;
}): Promise<boolean> {
  const pool = getPostgresPool();
  const payloadHash = computePayloadHash(params.payload);

  const result = await pool.query(
    `INSERT INTO raw_events (
       entity_id, event_type, source, event_timestamp, payload, payload_hash
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (payload_hash) DO NOTHING
     RETURNING id`,
    [
      params.entityId,
      params.eventType,
      params.source,
      params.eventTimestamp,
      JSON.stringify(params.payload),
      payloadHash,
    ],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Inserts a metric and runs z-score anomaly scoring against the baseline.
 */
export async function insertEntityMetric(params: {
  entityId: string;
  metric: string;
  value: number;
  timestamp?: Date;
}): Promise<void> {
  const timestamp = params.timestamp ?? new Date();
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO entity_metrics_history (entity_id, metric, value, timestamp)
     VALUES ($1, $2, $3, $4)`,
    [params.entityId, params.metric, params.value, timestamp],
  );

  await processNewMetric({
    entityId: params.entityId,
    metric: params.metric,
    observedValue: params.value,
    timestamp,
  });
}

/** Batch insert metrics; scores each row after commit */
export async function insertEntityMetricsBatch(
  metrics: Array<{
    entityId: string;
    metric: string;
    value: number;
    timestamp: Date;
  }>,
): Promise<void> {
  if (metrics.length === 0) {
    return;
  }

  const pool = getPostgresPool();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of metrics) {
      await client.query(
        `INSERT INTO entity_metrics_history (entity_id, metric, value, timestamp)
         VALUES ($1, $2, $3, $4)`,
        [row.entityId, row.metric, row.value, row.timestamp],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Score after batch commit so baselines see prior history
  for (const row of metrics) {
    await processNewMetric({
      entityId: row.entityId,
      metric: row.metric,
      observedValue: row.value,
      timestamp: row.timestamp,
    });
  }
}
