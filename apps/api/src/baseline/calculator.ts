import {
  getAllMetricSamplesForEntity,
  getEntityHistorySpanDays,
  getMetricSamplesInWindow,
  listDistinctEntityIdsWithMetrics,
  upsertBaseline,
} from "../repositories/baselines.repository.js";
import { baseMetricName } from "./metric.utils.js";

/** Lookback window for baseline statistics */
export const BASELINE_WINDOW_DAYS = 30;

/** Minimum days of entity history before anomaly scoring is enabled */
export const COLD_START_MIN_DAYS = 7;

export interface BaselineCalculatorResult {
  entitiesProcessed: number;
  baselinesWritten: number;
  insufficientData: number;
}

/**
 * Computes statistical baselines for every entity/metric pair using
 * the last 30 days of entity_metrics_history.
 */
export async function runBaselineCalculator(): Promise<BaselineCalculatorResult> {
  const entityIds = await listDistinctEntityIdsWithMetrics();
  let baselinesWritten = 0;
  let insufficientData = 0;

  for (const entityId of entityIds) {
    const historyDays = await getEntityHistorySpanDays(entityId);

    if (historyDays < COLD_START_MIN_DAYS) {
      const samples = await resolveSamplesForEntity(entityId);
      const metrics = [...new Set(samples.map((s) => s.metric))];
      for (const metric of metrics) {
        await upsertBaseline({
          entityId,
          metric,
          windowDays: BASELINE_WINDOW_DAYS,
          status: "insufficient_data",
          mean: null,
          stdDev: null,
          p50: null,
          p95: null,
          p99: null,
          sampleCount: 0,
        });
        insufficientData += 1;
      }
      continue;
    }

    const samples = await resolveSamplesForEntity(entityId);
    const byMetric = groupSamplesByMetric(samples);

    for (const [metric, values] of byMetric.entries()) {
      if (values.length === 0) {
        continue;
      }

      const stats = computeStatistics(values);
      await upsertBaseline({
        entityId,
        metric,
        windowDays: BASELINE_WINDOW_DAYS,
        status: "active",
        mean: stats.mean,
        stdDev: stats.stdDev,
        p50: stats.p50,
        p95: stats.p95,
        p99: stats.p99,
        sampleCount: values.length,
      });
      baselinesWritten += 1;
    }
  }

  console.log(
    `[baseline] entities=${entityIds.length} written=${baselinesWritten} insufficient=${insufficientData}`,
  );

  return {
    entitiesProcessed: entityIds.length,
    baselinesWritten,
    insufficientData,
  };
}

/**
 * Prefer last-30-day window; if empty (e.g. npm historical timestamps),
 * use full history so baselines can be computed for monitored packages.
 */
async function resolveSamplesForEntity(
  entityId: string,
): Promise<Array<{ metric: string; value: number }>> {
  const inWindow = await getMetricSamplesInWindow(entityId, BASELINE_WINDOW_DAYS);
  const all = await getAllMetricSamplesForEntity(entityId);

  if (inWindow.length === 0) {
    return all;
  }

  // npm ingest uses historical publish timestamps — prefer full history when
  // the 30-day window only contains a handful of recent observations
  if (inWindow.length < all.length * 0.05) {
    return all;
  }

  return inWindow;
}

function groupSamplesByMetric(
  samples: Array<{ metric: string; value: number }>,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const sample of samples) {
    const key = baseMetricName(sample.metric);
    const list = map.get(key);
    if (list) {
      list.push(sample.value);
    } else {
      map.set(key, [sample.value]);
    }
  }
  return map;
}

interface Statistics {
  mean: number;
  stdDev: number;
  p50: number;
  p95: number;
  p99: number;
}

function computeStatistics(values: number[]): Statistics {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
      : 0;
  const stdDev = Math.sqrt(variance);

  return {
    mean: round(mean),
    stdDev: round(stdDev),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
  };
}

/** Linear interpolation percentile on sorted values */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0] ?? 0;
  }
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  const lowVal = sorted[lower] ?? 0;
  const highVal = sorted[upper] ?? lowVal;
  return lowVal + weight * (highVal - lowVal);
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
