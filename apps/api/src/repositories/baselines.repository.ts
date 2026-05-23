import type { BaselineStatus, EntityBaseline } from "@bartholfidel/shared";
import { getPostgresPool } from "../db/postgres.js";

interface BaselineRow {
  id: string;
  entity_id: string;
  metric: string;
  window_days: number;
  mean: string | null;
  std_dev: string | null;
  p50: string | null;
  p95: string | null;
  p99: string | null;
  sample_count: number;
  weight_adjustment: string;
  status: string;
  computed_at: Date;
}

function mapBaseline(row: BaselineRow): EntityBaseline {
  return {
    id: row.id,
    entity_id: row.entity_id,
    metric: row.metric,
    window_days: row.window_days,
    mean: row.mean !== null ? Number(row.mean) : null,
    std_dev: row.std_dev !== null ? Number(row.std_dev) : null,
    p50: row.p50 !== null ? Number(row.p50) : null,
    p95: row.p95 !== null ? Number(row.p95) : null,
    p99: row.p99 !== null ? Number(row.p99) : null,
    sample_count: row.sample_count,
    weight_adjustment: Number(row.weight_adjustment),
    status: row.status as BaselineStatus,
    computed_at: row.computed_at.toISOString(),
  };
}

export async function getBaselineForMetric(
  entityId: string,
  metric: string,
  windowDays: number,
): Promise<EntityBaseline | null> {
  const pool = getPostgresPool();
  const result = await pool.query<BaselineRow>(
    `SELECT * FROM entity_baselines
     WHERE entity_id = $1 AND metric = $2 AND window_days = $3
     ORDER BY computed_at DESC
     LIMIT 1`,
    [entityId, metric, windowDays],
  );
  const row = result.rows[0];
  return row ? mapBaseline(row) : null;
}

/** Days of metric history available for an entity (earliest observation to now). */
export async function getEntityHistorySpanDays(entityId: string): Promise<number> {
  const pool = getPostgresPool();
  const result = await pool.query<{ span_days: string | null }>(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(timestamp))) / 86400 AS span_days
     FROM entity_metrics_history
     WHERE entity_id = $1`,
    [entityId],
  );
  const span = result.rows[0]?.span_days;
  if (span === null || span === undefined) {
    return 0;
  }
  return Number(span);
}

export interface MetricSampleRow {
  metric: string;
  value: number;
  timestamp: Date;
}

/** Observations within the lookback window for an entity. */
export async function getMetricSamplesInWindow(
  entityId: string,
  windowDays: number,
): Promise<MetricSampleRow[]> {
  const pool = getPostgresPool();
  const result = await pool.query<{ metric: string; value: string; timestamp: Date }>(
    `SELECT metric, value, timestamp
     FROM entity_metrics_history
     WHERE entity_id = $1
       AND timestamp >= NOW() - ($2::int * INTERVAL '1 day')
     ORDER BY metric, timestamp`,
    [entityId, windowDays],
  );
  return result.rows.map((row) => ({
    metric: row.metric,
    value: Number(row.value),
    timestamp: row.timestamp,
  }));
}

/** All metric observations for an entity (fallback when window is empty). */
export async function getAllMetricSamplesForEntity(
  entityId: string,
): Promise<MetricSampleRow[]> {
  const pool = getPostgresPool();
  const result = await pool.query<{ metric: string; value: string; timestamp: Date }>(
    `SELECT metric, value, timestamp
     FROM entity_metrics_history
     WHERE entity_id = $1
     ORDER BY metric, timestamp`,
    [entityId],
  );
  return result.rows.map((row) => ({
    metric: row.metric,
    value: Number(row.value),
    timestamp: row.timestamp,
  }));
}

export async function upsertBaseline(params: {
  entityId: string;
  metric: string;
  windowDays: number;
  status: BaselineStatus;
  mean: number | null;
  stdDev: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  sampleCount: number;
}): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `DELETE FROM entity_baselines
     WHERE entity_id = $1 AND metric = $2 AND window_days = $3`,
    [params.entityId, params.metric, params.windowDays],
  );
  await pool.query(
    `INSERT INTO entity_baselines (
       entity_id, metric, window_days, mean, std_dev,
       p50, p95, p99, sample_count, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      params.entityId,
      params.metric,
      params.windowDays,
      params.mean,
      params.stdDev,
      params.p50,
      params.p95,
      params.p99,
      params.sampleCount,
      params.status,
    ],
  );
}

export async function listDistinctEntityIdsWithMetrics(): Promise<string[]> {
  const pool = getPostgresPool();
  const result = await pool.query<{ entity_id: string }>(
    `SELECT DISTINCT entity_id FROM entity_metrics_history`,
  );
  return result.rows.map((row) => row.entity_id);
}
