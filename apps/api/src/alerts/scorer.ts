import type { IncidentTier, TriggeredMetric } from "@bartholfidel/shared";
import { getEntityById } from "../repositories/entities.repository.js";
import { getRecentAnomaliesForEntity } from "../repositories/anomalies.repository.js";
import { createIncident } from "../repositories/incidents.repository.js";

const INCIDENT_CORRELATION_MINUTES = 15;
const SINGLE_METRIC_CRITICAL_Z = 4.5;

/**
 * individual_score = min(|z_score| / 5, 1)
 * composite = 1 - ∏(1 - individual_score_i)
 */
export function computeCompositeScore(zScores: number[]): number {
  if (zScores.length === 0) {
    return 0;
  }
  let product = 1;
  for (const z of zScores) {
    const individual = Math.min(Math.abs(z) / 5, 1);
    product *= 1 - individual;
  }
  const composite = 1 - product;
  return Math.round(composite * 10000) / 10000;
}

export function tierFromComposite(composite: number): IncidentTier {
  if (composite >= 0.8) {
    return "critical";
  }
  if (composite >= 0.6) {
    return "warning";
  }
  return "info";
}

function mapSeverity(zScore: number): TriggeredMetric["severity"] {
  const absZ = Math.abs(zScore);
  if (absZ >= 3.5) {
    return "critical";
  }
  if (absZ >= 3.0) {
    return "high";
  }
  return "suspicious";
}

/**
 * Creates an incident when correlation rules are met:
 * - 2+ anomalous metrics (|z| >= 2) within 15 minutes, OR
 * - single metric with |z| > 4.5
 */
export async function evaluateIncidentFromAnomalies(params: {
  entityId: string;
  latestAnomaly: TriggeredMetric;
}): Promise<void> {
  const entity = await getEntityById(params.entityId);
  if (!entity) {
    return;
  }

  const recent = await getRecentAnomaliesForEntity(
    params.entityId,
    INCIDENT_CORRELATION_MINUTES,
  );

  const triggeredMetrics: TriggeredMetric[] = recent.map((row) => ({
    metric: row.metric,
    z_score: row.z_score,
    observed_value: row.observed_value,
    baseline_mean: row.baseline_mean,
    baseline_std_dev: row.baseline_std_dev,
    severity: mapSeverity(row.z_score),
    timestamp: row.timestamp.toISOString(),
  }));

  // Ensure the metric that just fired is represented
  if (!triggeredMetrics.some((m) => m.metric === params.latestAnomaly.metric)) {
    triggeredMetrics.push(params.latestAnomaly);
  }

  const distinctMetrics = new Set(triggeredMetrics.map((m) => m.metric));
  const maxAbsZ = Math.max(
    ...triggeredMetrics.map((m) => Math.abs(m.z_score)),
    0,
  );

  const twoMetricRule = distinctMetrics.size >= 2;
  const singleCriticalRule = maxAbsZ > SINGLE_METRIC_CRITICAL_Z;

  if (!twoMetricRule && !singleCriticalRule) {
    return;
  }

  const zScores = triggeredMetrics.map((m) => m.z_score);
  const compositeScore = computeCompositeScore(zScores);
  const tier = tierFromComposite(compositeScore);
  const surface = `${entity.source}/${entity.type}`;

  const attackPattern = inferAttackPattern(triggeredMetrics);

  await createIncident({
    entityId: params.entityId,
    compositeScore,
    tier,
    triggeredMetrics,
    surface,
    attackPattern,
  });

  console.log(
    `[scorer] incident entity=${params.entityId} composite=${compositeScore} tier=${tier}`,
  );
}

function inferAttackPattern(metrics: TriggeredMetric[]): string | null {
  const names = metrics.map((m) => m.metric).join(" ");
  if (names.includes("has_install_script")) {
    return "supply_chain_script_injection";
  }
  if (names.includes("dependency_count")) {
    return "dependency_surge";
  }
  if (names.includes("package_size_kb")) {
    return "package_bloat";
  }
  if (names.includes("publish_interval_hours")) {
    return "abnormal_publish_cadence";
  }
  return "multi_metric_anomaly";
}
