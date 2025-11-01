import type {
  MetricConfidence,
  MetricSource,
  MetricValues,
} from "../types/metrics";

const METRIC_KEYS = ["ehd", "pitch", "yaw", "roll", "dpr"] as const;

const METRIC_KEY_LOOKUP: Record<(typeof METRIC_KEYS)[number], true> = {
  ehd: true,
  pitch: true,
  yaw: true,
  roll: true,
  dpr: true,
};

const METRIC_CONFIDENCE_LOOKUP: Record<MetricConfidence, true> = {
  HIGH: true,
  LOW: true,
  NONE: true,
};

const METRIC_SOURCE_LOOKUP: Record<MetricSource, true> = {
  "pose-world": true,
  "pose-image": true,
  "face-transform": true,
  "solve-pnp": true,
  "dpr-baseline": true,
  unknown: true,
};

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

export const isOptionalNumber = (value: unknown): value is number | null => {
  return value === null || isFiniteNumber(value);
};

export const isBoolean = (value: unknown): value is boolean => {
  return typeof value === "boolean";
};

export const isMetricConfidence = (
  value: unknown,
): value is MetricConfidence => {
  return typeof value === "string" && value in METRIC_CONFIDENCE_LOOKUP;
};

export const isMetricSource = (value: unknown): value is MetricSource => {
  return typeof value === "string" && value in METRIC_SOURCE_LOOKUP;
};

const isMetricKey = (value: unknown): value is (typeof METRIC_KEYS)[number] => {
  return typeof value === "string" && value in METRIC_KEY_LOOKUP;
};

export const isMetricSeries = (
  value: unknown,
): value is MetricValues["metrics"][(typeof METRIC_KEYS)[number]] => {
  if (!isRecord(value)) {
    return false;
  }

  const {
    raw,
    smoothed,
    confidence,
    source,
    outlier,
    gated,
    reliabilityPaused,
  } = value;

  if (!isOptionalNumber(raw) || !isOptionalNumber(smoothed)) {
    return false;
  }

  if (!isMetricConfidence(confidence)) {
    return false;
  }

  if (!isMetricSource(source)) {
    return false;
  }

  if (
    !isBoolean(outlier) ||
    !isBoolean(gated) ||
    !isBoolean(reliabilityPaused)
  ) {
    return false;
  }

  return true;
};

export const isMetricFlags = (
  value: unknown,
): value is MetricValues["flags"] => {
  if (!isRecord(value)) {
    return false;
  }

  const { yawDeweighted, lowConfidence, baselinePending } = value;

  return (
    isBoolean(yawDeweighted) &&
    isBoolean(lowConfidence) &&
    isBoolean(baselinePending)
  );
};

export const isMetricValues = (value: unknown): value is MetricValues => {
  if (!isRecord(value)) {
    return false;
  }

  const { frameId, timestamp, baselineFaceSize, metrics, flags } = value;

  if (!isFiniteNumber(frameId) || !isFiniteNumber(timestamp)) {
    return false;
  }

  if (!isOptionalNumber(baselineFaceSize)) {
    return false;
  }

  if (!isRecord(metrics)) {
    return false;
  }

  const metricEntries = Object.entries(metrics);
  if (metricEntries.length !== METRIC_KEYS.length) {
    return false;
  }

  const allMetricsValid = metricEntries.every(([key, series]) => {
    return isMetricKey(key) && isMetricSeries(series);
  });

  if (!allMetricsValid) {
    return false;
  }

  if (!isMetricFlags(flags)) {
    return false;
  }

  return true;
};
