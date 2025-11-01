import type { MetricValues } from "../../shared/types/metrics";
import { isFiniteNumber } from "../../shared/validation/metricValues";
import {
  type RiskDetectionConfig,
  cloneRiskConfig,
} from "../config/detection-config";
import type { Calibration } from "../scoring/calculator";

export type RiskAssessment = {
  timestamp: number | null;
  pitch: number | null;
  ehd: number | null;
  dpr: number | null;
  pitchDeviation: number | null;
  ehdDeviation: number | null;
  dprDeviation: number | null;
  pitchThreshold: number;
  ehdThreshold: number;
  dprThreshold: number;
  pitchRecoveryThreshold: number;
  ehdRecoveryThreshold: number;
  dprRecoveryThreshold: number;
  conditionsMet: boolean;
  recoveryConditionsMet: boolean;
  signalsAvailable: number;
  insufficientSignals: boolean;
  degeneratePose: boolean;
  missingCalibration: boolean;
  baselinePending: boolean;
  shouldHold: boolean;
  reasons: string[];
};

export type RiskEvaluatorInput = {
  metrics: MetricValues | null | undefined;
  calibration: Calibration | null | undefined;
};

const extractMetricValue = (
  metric: MetricValues["metrics"]["pitch"] | undefined,
): number | null => {
  if (!metric) {
    return null;
  }
  if (isFiniteNumber(metric.smoothed)) {
    return metric.smoothed;
  }
  if (isFiniteNumber(metric.raw)) {
    return metric.raw;
  }
  return null;
};

const computeDeviation = (
  value: number | null,
  baseline: number,
): number | null => {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return value - baseline;
};

const computeRecoveryThreshold = (
  threshold: number,
  hysteresisPct: number,
): number => {
  if (threshold <= 0) {
    return 0;
  }
  const delta = threshold * (hysteresisPct / 100);
  return Math.max(0, threshold - delta);
};

const countSignals = (...signals: Array<number | null>): number => {
  return signals.reduce((count: number, value) => {
    return count + (isFiniteNumber(value) ? 1 : 0);
  }, 0);
};

export class RiskEvaluator {
  private config: RiskDetectionConfig;

  constructor(config: RiskDetectionConfig) {
    this.config = cloneRiskConfig(config);
  }

  updateConfig(config: RiskDetectionConfig): void {
    this.config = cloneRiskConfig(config);
  }

  assess(input: RiskEvaluatorInput): RiskAssessment {
    const metrics = input.metrics ?? null;
    const calibration = input.calibration ?? null;

    const timestamp = metrics ? metrics.timestamp : null;

    const pitchValue = extractMetricValue(metrics?.metrics.pitch);
    const ehdValue = extractMetricValue(metrics?.metrics.ehd);
    const dprValue = extractMetricValue(metrics?.metrics.dpr);

    const baselinePending = Boolean(metrics?.flags.baselinePending);
    const missingCalibration = calibration === null;

    const baselinePitch = calibration?.baselinePitch ?? 0;
    const baselineEHD = calibration?.baselineEHD ?? 0;
    const baselineDPR = calibration?.baselineDPR ?? 1;

    const pitchDeviation = missingCalibration
      ? null
      : computeDeviation(pitchValue, baselinePitch);
    const ehdDeviation = missingCalibration
      ? null
      : computeDeviation(ehdValue, baselineEHD);
    const dprDeviation = missingCalibration
      ? null
      : computeDeviation(dprValue, baselineDPR);

    const pitchDelta =
      pitchDeviation !== null ? Math.max(0, pitchDeviation) : null;
    const ehdDelta = ehdDeviation !== null ? Math.max(0, ehdDeviation) : null;
    const dprDelta = dprDeviation !== null ? Math.max(0, dprDeviation) : null;

    const { thresholds } = this.config;
    const {
      hysteresisDeltaPct: hysteresisPct,
      pitchDeg: pitchThreshold,
      ehdNorm: ehdThreshold,
      dprDelta: dprThreshold,
      degeneratePitchDeg,
    } = thresholds;

    const signalsAvailable = countSignals(pitchDelta, ehdDelta, dprDelta);
    const insufficientSignals =
      pitchDelta === null ||
      signalsAvailable < 2 ||
      !isFiniteNumber(pitchValue);

    const degeneratePose =
      isFiniteNumber(pitchValue) && Math.abs(pitchValue) >= degeneratePitchDeg;

    const pitchRecoveryThreshold = computeRecoveryThreshold(
      pitchThreshold,
      hysteresisPct,
    );
    const ehdRecoveryThreshold = computeRecoveryThreshold(
      ehdThreshold,
      hysteresisPct,
    );
    const dprRecoveryThreshold = computeRecoveryThreshold(
      dprThreshold,
      hysteresisPct,
    );

    const pitchBad =
      pitchDelta !== null &&
      pitchDelta > pitchThreshold &&
      !Number.isNaN(pitchThreshold);
    const ehdBad =
      ehdDelta !== null &&
      ehdDelta > ehdThreshold &&
      !Number.isNaN(ehdThreshold);
    const dprBad =
      dprDelta !== null &&
      dprDelta > dprThreshold &&
      !Number.isNaN(dprThreshold);

    const pitchRecovered =
      pitchDelta !== null && pitchDelta < pitchRecoveryThreshold;
    const ehdRecovered = ehdDelta !== null && ehdDelta < ehdRecoveryThreshold;
    const dprRecovered = dprDelta !== null && dprDelta < dprRecoveryThreshold;

    const baseReasons: string[] = [];
    if (missingCalibration) {
      baseReasons.push("missing-calibration");
    }
    if (baselinePending) {
      baseReasons.push("baseline-pending");
    }
    if (insufficientSignals) {
      baseReasons.push("insufficient-signals");
    }
    if (degeneratePose) {
      baseReasons.push("degenerate-pose");
    }

    const shouldHold = baseReasons.length > 0;

    const conditionsMet = !shouldHold && pitchBad && (ehdBad || dprBad);
    const recoveryConditionsMet =
      !shouldHold && pitchRecovered && (ehdRecovered || dprRecovered);

    return {
      timestamp,
      pitch: pitchValue,
      ehd: ehdValue,
      dpr: dprValue,
      pitchDeviation,
      ehdDeviation,
      dprDeviation,
      pitchThreshold,
      ehdThreshold,
      dprThreshold,
      pitchRecoveryThreshold,
      ehdRecoveryThreshold,
      dprRecoveryThreshold,
      conditionsMet,
      recoveryConditionsMet,
      signalsAvailable,
      insufficientSignals,
      degeneratePose,
      missingCalibration,
      baselinePending,
      shouldHold,
      reasons: baseReasons,
    };
  }
}
