/**
 * npm metrics are stored as "dependency_count:4.18.1".
 * Baselines aggregate on the base name ("dependency_count").
 */
export function baseMetricName(metric: string): string {
  const colonIndex = metric.indexOf(":");
  if (colonIndex === -1) {
    return metric;
  }
  return metric.slice(0, colonIndex);
}
