import type { EngineReliability } from "../../shared/types/engine-state";
import type { MetricValues } from "../../shared/types/metrics";
import type { ScoreFreezeReason } from "../../shared/types/score";

export type ScoreGateResult = {
  freeze: boolean;
  reason: ScoreFreezeReason | null;
};

export type ScoreGateOptions = {
  reliability?: EngineReliability;
};

export const evaluateScoreEligibility = (
  metrics: MetricValues | null | undefined,
  options: ScoreGateOptions = {},
): ScoreGateResult => {
  if (options.reliability === "UNRELIABLE") {
    return {
      freeze: true,
      reason: "unreliable",
    } satisfies ScoreGateResult;
  }

  if (!metrics) {
    return {
      freeze: true,
      reason: "missing-metrics",
    } satisfies ScoreGateResult;
  }

  if (metrics.flags.baselinePending) {
    return {
      freeze: true,
      reason: "baseline-pending",
    } satisfies ScoreGateResult;
  }

  if (metrics.flags.lowConfidence) {
    return {
      freeze: true,
      reason: "low-confidence",
    } satisfies ScoreGateResult;
  }

  return {
    freeze: false,
    reason: null,
  } satisfies ScoreGateResult;
};

export const shouldFreezeScore = (
  metrics: MetricValues | null | undefined,
  options: ScoreGateOptions = {},
): boolean => {
  return evaluateScoreEligibility(metrics, options).freeze;
};
