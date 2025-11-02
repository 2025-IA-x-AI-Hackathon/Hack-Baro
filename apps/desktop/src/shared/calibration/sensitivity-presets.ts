import type {
  CalibrationBaselineMetrics,
  CalibrationCustomThresholds,
  CalibrationSensitivity,
  CalibrationThresholds,
} from "../types/calibration";

export const SENSITIVITY_MULTIPLIERS: Record<
  Exclude<CalibrationSensitivity, "custom">,
  number
> = {
  low: 1.3,
  medium: 1,
  high: 0.7,
};

export const DEFAULT_THRESHOLD_DELTAS: CalibrationThresholds = {
  pitch: 12,
  ehd: 0.18,
  dpr: 0.12,
};

export const CUSTOM_THRESHOLD_OFFSETS = {
  pitch: {
    min: 2,
    max: 30,
  },
  ehd: {
    min: 0.05,
    max: 0.6,
  },
  dpr: {
    min: 0.02,
    max: 0.5,
  },
} as const;

export const resolveCustomThresholdBounds = (
  baseline: CalibrationBaselineMetrics,
) => {
  return {
    pitch: {
      min: baseline.baselinePitch + CUSTOM_THRESHOLD_OFFSETS.pitch.min,
      max: baseline.baselinePitch + CUSTOM_THRESHOLD_OFFSETS.pitch.max,
    },
    ehd: {
      min: baseline.baselineEHD + CUSTOM_THRESHOLD_OFFSETS.ehd.min,
      max: baseline.baselineEHD + CUSTOM_THRESHOLD_OFFSETS.ehd.max,
    },
    dpr: {
      min: baseline.baselineDPR + CUSTOM_THRESHOLD_OFFSETS.dpr.min,
      max: baseline.baselineDPR + CUSTOM_THRESHOLD_OFFSETS.dpr.max,
    },
  } as const;
};

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const applyMultiplier = (
  multiplier: number,
  deltas: CalibrationThresholds,
): CalibrationThresholds => {
  return {
    pitch: deltas.pitch * multiplier,
    ehd: deltas.ehd * multiplier,
    dpr: deltas.dpr * multiplier,
  };
};

export const resolveSensitivityMultiplier = (
  sensitivity: CalibrationSensitivity,
): number => {
  if (sensitivity === "custom") {
    return 1;
  }
  return SENSITIVITY_MULTIPLIERS[sensitivity] ?? 1;
};

export const sanitiseCustomThresholds = (
  baseline: CalibrationBaselineMetrics,
  custom: CalibrationCustomThresholds | null | undefined,
): CalibrationThresholds | null => {
  if (!custom) {
    return null;
  }

  const bounds = resolveCustomThresholdBounds(baseline);

  const pitch =
    custom.pitch !== undefined
      ? clampNumber(custom.pitch, bounds.pitch.min, bounds.pitch.max)
      : null;
  const ehd =
    custom.ehd !== undefined
      ? clampNumber(custom.ehd, bounds.ehd.min, bounds.ehd.max)
      : null;
  const dpr =
    custom.dpr !== undefined
      ? clampNumber(custom.dpr, bounds.dpr.min, bounds.dpr.max)
      : null;

  if (pitch === null && ehd === null && dpr === null) {
    return null;
  }

  return {
    pitch:
      (pitch ?? baseline.baselinePitch + DEFAULT_THRESHOLD_DELTAS.pitch) -
      baseline.baselinePitch,
    ehd:
      (ehd ?? baseline.baselineEHD + DEFAULT_THRESHOLD_DELTAS.ehd) -
      baseline.baselineEHD,
    dpr:
      (dpr ?? baseline.baselineDPR + DEFAULT_THRESHOLD_DELTAS.dpr) -
      baseline.baselineDPR,
  };
};

export const deriveThresholds = (
  baseline: CalibrationBaselineMetrics,
  sensitivity: CalibrationSensitivity,
  customThresholds?: CalibrationCustomThresholds | null,
  deltas: CalibrationThresholds = DEFAULT_THRESHOLD_DELTAS,
): CalibrationThresholds => {
  if (sensitivity === "custom") {
    const sanitised = sanitiseCustomThresholds(baseline, customThresholds);
    if (sanitised) {
      return sanitised;
    }
  }

  const multiplier = resolveSensitivityMultiplier(sensitivity);
  return applyMultiplier(multiplier, deltas);
};

export const applyThresholdDeltas = (
  baseline: CalibrationBaselineMetrics,
  deltas: CalibrationThresholds,
): CalibrationThresholds => {
  return {
    pitch: baseline.baselinePitch + deltas.pitch,
    ehd: baseline.baselineEHD + deltas.ehd,
    dpr: baseline.baselineDPR + deltas.dpr,
  };
};

export default deriveThresholds;
