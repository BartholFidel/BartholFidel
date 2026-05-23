import type { TriggeredMetric } from "@bartholfidel/shared";
import { insertAnomalyScore } from "../repositories/anomalies.repository.js";
import { BASELINE_WINDOW_DAYS } from "./calculator.js";
import { baseMetricName } from "./metric.utils.js";
import { getBaselineForMetric } from "../repositories/baselines.repository.js";
import { evaluateIncidentFromAnomalies } from "../alerts/scorer.js";

export type ZScoreSeverity = "normal" | "suspicious" | "high" | "critical";

export interface ZScoreResult {
  zScore: number;
  severity: ZScoreSeverity;
  logged: boolean;
  flagged: boolean;
}

/**
 * z = (observed_value - mean) / std_dev
 * Scoring thresholds per Week 3 spec.
 */
export function computeZScore(
  observedValue: number,
  mean: number,
  stdDev: number,
): number {
  if (stdDev === 0) {
    return observedValue === mean ? 0 : Infinity;
  }
  return (observedValue - mean) / stdDev;
}

export function classifyZScore(zScore: number): ZScoreSeverity {
  const absZ = Math.abs(zScore);
  if (absZ < 2.0) {
    return "normal";
  }
  if (absZ < 3.0) {
    return "suspicious";
  }
  if (absZ <= 3.5) {
    return "high";
  }
  return "critical";
}

/**
 * Scores a newly stored metric against its baseline and logs anomalies.
 * Invokes incident evaluation when flagged.
 */
export async function processNewMetric(params: {
  entityId: string;
  metric: string;
  observedValue: number;
  timestamp?: Date;
}): Promise<ZScoreResult | null> {
  const metricKey = baseMetricName(params.metric);
  const baseline = await getBaselineForMetric(
    params.entityId,
    metricKey,
    BASELINE_WINDOW_DAYS,
  );

  if (!baseline || baseline.status === "insufficient_data") {
    return null;
  }

  if (
    baseline.mean === null ||
    baseline.std_dev === null ||
    baseline.sample_count < 2
  ) {
    return null;
  }

  const zScore = computeZScore(
    params.observedValue,
    baseline.mean,
    baseline.std_dev,
  );

  if (!Number.isFinite(zScore)) {
    return null;
  }

  const severity = classifyZScore(zScore);
  const roundedZ = Math.round(zScore * 10000) / 10000;

  if (severity === "normal") {
    return { zScore: roundedZ, severity, logged: false, flagged: false };
  }

  await insertAnomalyScore({
    entityId: params.entityId,
    metric: params.metric, // keep full versioned metric on the anomaly row
    observedValue: params.observedValue,
    baselineMean: baseline.mean,
    baselineStdDev: baseline.std_dev,
    zScore: roundedZ,
    timestamp: params.timestamp,
  });

  const flagged = severity === "high" || severity === "critical";

  const triggered: TriggeredMetric = {
    metric: params.metric,
    z_score: roundedZ,
    observed_value: params.observedValue,
    baseline_mean: baseline.mean,
    baseline_std_dev: baseline.std_dev,
    severity: severity === "suspicious" ? "suspicious" : severity,
    timestamp: (params.timestamp ?? new Date()).toISOString(),
  };

  await evaluateIncidentFromAnomalies({
    entityId: params.entityId,
    latestAnomaly: triggered,
  });

  console.log(
    `[zscore] entity=${params.entityId} metric=${params.metric} z=${roundedZ} severity=${severity}`,
  );

  return { zScore: roundedZ, severity, logged: true, flagged };
}
