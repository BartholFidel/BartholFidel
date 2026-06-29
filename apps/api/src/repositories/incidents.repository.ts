import type {
  Incident,
  IncidentStatus,
  IncidentStatusAction,
  IncidentTier,
  IncidentTierCounts,
  RawPayloadSummary,
  TriggeredMetric,
} from "@bartholfidel/shared";
import { getPostgresPool } from "../db/postgres.js";

interface IncidentRow {
  id: string;
  entity_id: string;
  entity_name: string | null;
  composite_score: string;
  tier: string;
  status: string;
  triggered_metrics: TriggeredMetric[];
  corroborating_signals: unknown[];
  surface: string;
  attack_pattern: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    entity_id: row.entity_id,
    entity_name: row.entity_name ?? undefined,
    composite_score: Number(row.composite_score),
    tier: row.tier as IncidentTier,
    status: row.status as Incident["status"],
    triggered_metrics: row.triggered_metrics ?? [],
    corroborating_signals: row.corroborating_signals ?? [],
    surface: row.surface,
    attack_pattern: row.attack_pattern,
    created_at: row.created_at.toISOString(),
    resolved_at: row.resolved_at?.toISOString() ?? null,
  };
}

export async function createIncident(params: {
  entityId: string;
  compositeScore: number;
  tier: IncidentTier;
  triggeredMetrics: TriggeredMetric[];
  surface: string;
  attackPattern?: string | null;
}): Promise<Incident> {
  const pool = getPostgresPool();
  const result = await pool.query<IncidentRow>(
    `INSERT INTO incidents (
       entity_id, composite_score, tier, status,
       triggered_metrics, surface, attack_pattern
     )
     VALUES ($1, $2, $3, 'open', $4::jsonb, $5, $6)
     ON CONFLICT (entity_id, attack_pattern) DO UPDATE SET
       composite_score = EXCLUDED.composite_score,
       tier = EXCLUDED.tier,
       triggered_metrics = EXCLUDED.triggered_metrics,
       surface = EXCLUDED.surface
     RETURNING
       id, entity_id, NULL::text AS entity_name,
       composite_score, tier, status, triggered_metrics,
       corroborating_signals, surface, attack_pattern,
       created_at, resolved_at`,
    [
      params.entityId,
      params.compositeScore,
      params.tier,
      JSON.stringify(params.triggeredMetrics),
      params.surface,
      params.attackPattern ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create incident");
  }
  return mapIncident(row);
}

export async function listIncidents(): Promise<Incident[]> {
  const pool = getPostgresPool();
  const result = await pool.query<IncidentRow>(
    `SELECT
       i.id, i.entity_id, e.name AS entity_name,
       i.composite_score, i.tier, i.status,
       i.triggered_metrics, i.corroborating_signals,
       i.surface, i.attack_pattern, i.created_at, i.resolved_at
     FROM incidents i
     JOIN entities e ON e.id = i.entity_id
     ORDER BY i.created_at DESC`,
  );
  return result.rows.map(mapIncident);
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  const pool = getPostgresPool();
  const result = await pool.query<IncidentRow>(
    `SELECT
       i.id, i.entity_id, e.name AS entity_name,
       i.composite_score, i.tier, i.status,
       i.triggered_metrics, i.corroborating_signals,
       i.surface, i.attack_pattern, i.created_at, i.resolved_at
     FROM incidents i
     JOIN entities e ON e.id = i.entity_id
     WHERE i.id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapIncident(row) : null;
}

export async function getLatestRawPayloadSummary(
  entityId: string,
): Promise<RawPayloadSummary | null> {
  const pool = getPostgresPool();
  const result = await pool.query<{
    event_type: string;
    source: string;
    ingest_timestamp: Date;
    payload: unknown;
  }>(
    `SELECT event_type, source, ingest_timestamp, payload
     FROM raw_events
     WHERE entity_id = $1
     ORDER BY ingest_timestamp DESC
     LIMIT 1`,
    [entityId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const preview = JSON.stringify(row.payload).slice(0, 500);
  return {
    event_type: row.event_type,
    source: row.source,
    ingest_timestamp: row.ingest_timestamp.toISOString(),
    payload_preview:
      preview.length >= 500 ? `${preview}…` : preview,
  };
}

export async function updateIncidentStatus(
  id: string,
  action: IncidentStatusAction,
): Promise<Incident | null> {
  const status: IncidentStatus =
    action === "confirm" ? "confirmed" : "false_positive";

  const pool = getPostgresPool();
  const result = await pool.query<IncidentRow>(
    `UPDATE incidents
     SET status = $2,
         resolved_at = CASE WHEN $2 IN ('confirmed', 'false_positive') THEN NOW() ELSE resolved_at END
     WHERE id = $1
     RETURNING
       id, entity_id, NULL::text AS entity_name,
       composite_score, tier, status, triggered_metrics,
       corroborating_signals, surface, attack_pattern,
       created_at, resolved_at`,
    [id, status],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const entityResult = await pool.query<{ name: string }>(
    `SELECT name FROM entities WHERE id = $1`,
    [row.entity_id],
  );
  const withName: IncidentRow = {
    ...row,
    entity_name: entityResult.rows[0]?.name ?? null,
  };
  return mapIncident(withName);
}

/** Open incidents grouped by tier for dashboard cards */
export async function countActiveIncidentsByTier(): Promise<IncidentTierCounts> {
  const pool = getPostgresPool();
  const result = await pool.query<{ tier: string; count: string }>(
    `SELECT tier, COUNT(*)::text AS count
     FROM incidents
     WHERE status = 'open'
     GROUP BY tier`,
  );

  const counts: IncidentTierCounts = { info: 0, warning: 0, critical: 0 };
  for (const row of result.rows) {
    if (row.tier === "info") {
      counts.info = Number.parseInt(row.count, 10);
    } else if (row.tier === "warning") {
      counts.warning = Number.parseInt(row.count, 10);
    } else if (row.tier === "critical") {
      counts.critical = Number.parseInt(row.count, 10);
    }
  }
  return counts;
}
