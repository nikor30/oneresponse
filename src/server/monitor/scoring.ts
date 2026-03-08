export interface SlaThresholds {
  sla_latency_ms: number;
  sla_jitter_ms: number;
  sla_loss_pct: number;
}

export interface MetricValues {
  latency_avg: number;
  jitter: number;
  loss_pct: number;
}

function metricScore(value: number, threshold: number, maxMultiplier: number): number {
  if (value <= threshold) return 100;
  if (value >= threshold * maxMultiplier) return 0;
  return 100 * (1 - (value - threshold) / (threshold * (maxMultiplier - 1)));
}

export function calculateSlaScore(metrics: MetricValues, thresholds: SlaThresholds): number {
  const latencyScore = metricScore(metrics.latency_avg, thresholds.sla_latency_ms, 3);
  const jitterScore = metricScore(metrics.jitter, thresholds.sla_jitter_ms, 3);
  const lossScore = metricScore(metrics.loss_pct, thresholds.sla_loss_pct, 5);
  return Math.round((latencyScore * 0.4 + jitterScore * 0.3 + lossScore * 0.3) * 100) / 100;
}

export function isSlaCompliant(score: number): boolean {
  return score >= 70;
}
