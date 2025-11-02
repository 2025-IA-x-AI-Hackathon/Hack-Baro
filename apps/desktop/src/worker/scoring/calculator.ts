import type { EngineReliability } from "../../shared/types/engine-state";
import type { MetricValues } from "../../shared/types/metrics";
import type { ScoreFreezeReason, ScoreSample } from "../../shared/types/score";
import { evaluateScoreEligibility } from "./score-gating";
import getZone from "./zone-mapper";

export type Calibration = {
  baselinePitch: number; // degrees
  baselineEHD: number; // normalized units
  baselineDPR: number; // ratio, typically 1.0
};

export type ScoreWeights = {
  pitchPerDegree: number; // default 3.0
  ehdPerUnit: number; // default 250
  dprPerUnit: number; // default 150
};

export type ScoreConfig = {
  weights?: Partial<ScoreWeights>;
  alpha?: number; // EMA for score, default 0.2
  neutralScore?: number; // default 35 used when frozen without prior score
  calibration?: Partial<Calibration>;
};

export type ScoreUpdateOptions = {
  reliability?: EngineReliability;
};

const DEFAULT_WEIGHTS: ScoreWeights = {
  pitchPerDegree: 3.0,
  ehdPerUnit: 250,
  dprPerUnit: 150,
};

const DEFAULT_CALIBRATION: Calibration = {
  baselinePitch: 0,
  baselineEHD: 0,
  baselineDPR: 1,
};

export class ScoreProcessor {
  private lastScore: number | null = null;

  private readonly alpha: number;

  private readonly neutral: number;

  private readonly weights: ScoreWeights;

  private readonly calibration: Calibration;

  constructor(config?: ScoreConfig) {
    this.alpha = typeof config?.alpha === "number" ? config.alpha : 0.2;
    this.neutral =
      typeof config?.neutralScore === "number" ? config.neutralScore : 35;
    this.weights = { ...DEFAULT_WEIGHTS, ...(config?.weights ?? {}) };
    this.calibration = {
      ...DEFAULT_CALIBRATION,
      ...(config?.calibration ?? {}),
    };
  }

  reset(): void {
    this.lastScore = null;
  }

  update(
    metrics: MetricValues | null | undefined,
    options: ScoreUpdateOptions = {},
  ): ScoreSample {
    const eligibility = evaluateScoreEligibility(metrics, {
      reliability: options.reliability,
    });
    const frozen = eligibility.freeze;
    let reason: ScoreFreezeReason | null = eligibility.reason ?? null;

    const rawScore = frozen
      ? (this.lastScore ?? this.neutral)
      : this.calculateRawScore(metrics as MetricValues);

    const emaScore =
      this.lastScore === null
        ? rawScore
        : this.alpha * rawScore + (1 - this.alpha) * this.lastScore;

    const clampedEma = Math.max(0, Math.min(100, emaScore));
    // Use Math.floor to ensure that scores just below an integer (e.g., 79.9) map to the lower zone (YELLOW),
    // while integer values (e.g., 80.0) map to the next zone (GREEN), aligning zone boundaries with integer thresholds.
    const zoneBasis = Math.floor(clampedEma);

    if (!frozen) {
      this.lastScore = clampedEma;
    } else if (!reason && metrics) {
      // fall back to any metric-derived reason if none provided.
      if (metrics.flags.baselinePending) {
        reason = "baseline-pending";
      } else if (metrics.flags.lowConfidence) {
        reason = "low-confidence";
      }
    } else if (!reason) {
      reason = "missing-metrics";
    }

    return {
      raw: rawScore,
      ema: clampedEma,
      zone: getZone(zoneBasis),
      frozen,
      reason,
    } satisfies ScoreSample;
  }

  private calculateRawScore(metrics: MetricValues): number {
    const pitch =
      metrics.metrics.pitch.smoothed ?? metrics.metrics.pitch.raw ?? null;
    const ehd = metrics.metrics.ehd.smoothed ?? metrics.metrics.ehd.raw ?? null;
    const dpr = metrics.metrics.dpr.smoothed ?? metrics.metrics.dpr.raw ?? null;

    const { baselinePitch, baselineEHD, baselineDPR } = this.calibration;

    const pitchDeviation = Math.max(0, (pitch ?? 0) - baselinePitch);
    const ehdDeviation = Math.max(0, (ehd ?? 0) - baselineEHD);
    const dprDeviation = Math.max(0, (dpr ?? 1) - baselineDPR);

    const pitchPenalty = pitchDeviation * this.weights.pitchPerDegree;
    const ehdPenalty = ehdDeviation * this.weights.ehdPerUnit;
    const dprPenalty = dprDeviation * this.weights.dprPerUnit;

    const totalPenalty = pitchPenalty + ehdPenalty + dprPenalty;
    return Math.max(0, Math.min(100, 100 - totalPenalty));
  }
}
