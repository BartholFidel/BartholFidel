import { getPostgresPool } from "../db/postgres.js";

export interface AnomalyScoreInsert {
  entityId: string;
  metric: string;
  observedValue: number;
  baselineMean: number | null;
  baselineStdDev: number | null;
  zScore: number;
  timestamp?: Date;
}

/** Persists a z-score observation when anomalous (z >= 2). */
export async function insertAnomalyScore(
  params: AnomalyScoreInsert,
): Promise<string> {
  const pool = getPostgresPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO anomaly_scores (
       entity_id, metric, observed_value,
       baseline_mean, baseline_std_dev, z_score, timestamp
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.entityId,
      params.metric,
      params.observedValue,
      params.baselineMean,
      params.baselineStdDev,
      params.zScore,
      params.timestamp ?? new Date(),
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert anomaly score");
  }
  return row.id;
}

/** Recent anomalous scores for incident correlation (z >= 2 within window). */
export async function getRecentAnomaliesForEntity(
  entityId: string,
  withinMinutes: number,
): Promise<
  Array<{
    metric: string;
    z_score: number;
    observed_value: number;
    baseline_mean: number | null;
    baseline_std_dev: number | null;
    timestamp: Date;
  }>
> {
  const pool = getPostgresPool();
  const result = await pool.query<{
    metric: string;
    z_score: string;
    observed_value: string;
    baseline_mean: string | null;
    baseline_std_dev: string | null;
    timestamp: Date;
  }>(
    `SELECT DISTINCT ON (metric)
       metric, z_score, observed_value, baseline_mean, baseline_std_dev, timestamp
     FROM anomaly_scores
     WHERE entity_id = $1
       AND z_score >= 2
       AND timestamp >= NOW() - ($2::int * INTERVAL '1 minute')
     ORDER BY metric, timestamp DESC`,
    [entityId, withinMinutes],
  );

  return result.rows.map((row) => ({
    metric: row.metric,
    z_score: Number(row.z_score),
    observed_value: Number(row.observed_value),
    baseline_mean: row.baseline_mean !== null ? Number(row.baseline_mean) : null,
    baseline_std_dev:
      row.baseline_std_dev !== null ? Number(row.baseline_std_dev) : null,
    timestamp: row.timestamp,
  }));
}
