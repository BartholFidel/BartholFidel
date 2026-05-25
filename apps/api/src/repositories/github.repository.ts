import type { Entity, Incident, IncidentTier, TriggeredMetric } from "@bartholfidel/shared";
import { getPostgresPool } from "../db/postgres.js";
import { listEntities, type EntityFilters } from "./entities.repository.js";

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  watch_actions: boolean;
  github_last_collaborator_count?: number;
  github_last_workflow_count?: number;
  github_workflow_domains?: Record<string, string[]>;
}

export function parseGitHubRepoName(name: string): { owner: string; repo: string } | null {
  const trimmed = name.trim();
  const match = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/.exec(trimmed);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

export function parseGitHubConfig(config: Record<string, unknown>): GitHubRepoConfig | null {
  const owner = typeof config.owner === "string" ? config.owner : null;
  const repo = typeof config.repo === "string" ? config.repo : null;
  if (!owner || !repo) {
    return null;
  }
  const watch_actions =
    typeof config.watch_actions === "boolean" ? config.watch_actions : true;

  const github_workflow_domains =
    typeof config.github_workflow_domains === "object" &&
    config.github_workflow_domains !== null
      ? (config.github_workflow_domains as Record<string, string[]>)
      : undefined;

  return {
    owner,
    repo,
    watch_actions,
    github_last_collaborator_count:
      typeof config.github_last_collaborator_count === "number"
        ? config.github_last_collaborator_count
        : undefined,
    github_last_workflow_count:
      typeof config.github_last_workflow_count === "number"
        ? config.github_last_workflow_count
        : undefined,
    github_workflow_domains,
  };
}

export async function listGitHubWatchlistEntities(): Promise<Entity[]> {
  return listEntities({ source: "web2", type: "github_repo" } as EntityFilters);
}

export async function findGitHubEntityByFullName(
  fullName: string,
): Promise<Entity | null> {
  const parsed = parseGitHubRepoName(fullName);
  if (!parsed) {
    return null;
  }

  const entities = await listGitHubWatchlistEntities();
  return (
    entities.find((entity) => {
      const cfg = parseGitHubConfig(entity.config);
      return cfg?.owner === parsed.owner && cfg?.repo === parsed.repo;
    }) ?? null
  );
}

export async function updateEntityConfig(
  entityId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE entities SET config = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [entityId, JSON.stringify(config)],
  );
}

export async function hasRecentMetricSignal(
  entityId: string,
  metric: string,
  minValue: number,
  withinMinutes: number,
): Promise<boolean> {
  const pool = getPostgresPool();
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM entity_metrics_history
       WHERE entity_id = $1
         AND metric = $2
         AND value >= $3
         AND timestamp >= NOW() - ($4::int * INTERVAL '1 minute')
     ) AS exists`,
    [entityId, metric, minValue, withinMinutes],
  );
  return result.rows[0]?.exists ?? false;
}

/** Pattern-based incident (supply chain rules) with corroborating signals */
export async function createPatternIncident(params: {
  entityId: string;
  tier: IncidentTier;
  attackPattern: string;
  compositeScore: number;
  triggeredMetrics: TriggeredMetric[];
  surface: string;
  corroboratingSignals: unknown[];
}): Promise<Incident> {
  const pool = getPostgresPool();
  const result = await pool.query<{
    id: string;
    entity_id: string;
    composite_score: string;
    tier: string;
    status: string;
    triggered_metrics: TriggeredMetric[];
    corroborating_signals: unknown[];
    surface: string;
    attack_pattern: string | null;
    created_at: Date;
    resolved_at: Date | null;
  }>(
    `INSERT INTO incidents (
       entity_id, composite_score, tier, status,
       triggered_metrics, corroborating_signals, surface, attack_pattern
     )
     VALUES ($1, $2, $3, 'open', $4::jsonb, $5::jsonb, $6, $7)
     RETURNING *`,
    [
      params.entityId,
      params.compositeScore,
      params.tier,
      JSON.stringify(params.triggeredMetrics),
      JSON.stringify(params.corroboratingSignals),
      params.surface,
      params.attackPattern,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create pattern incident");
  }
  return {
    id: row.id,
    entity_id: row.entity_id,
    composite_score: Number(row.composite_score),
    tier: row.tier as Incident["tier"],
    status: row.status as Incident["status"],
    triggered_metrics: row.triggered_metrics,
    corroborating_signals: row.corroborating_signals,
    surface: row.surface,
    attack_pattern: row.attack_pattern,
    created_at: row.created_at.toISOString(),
    resolved_at: row.resolved_at?.toISOString() ?? null,
  };
}
