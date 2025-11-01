import { getEnvVar, parseNumericEnv } from "../../shared/env";
import type { MetricKey } from "../processing/types";

export type SignalProcessingMetricConfig = {
  /**
   * Optional fixed alpha to apply to the EMA smoother.
   * When undefined, the windowSeconds value is used to derive a dynamic alpha.
   */
  alpha?: number;
  /**
   * Target smoothing window, expressed in seconds. Used to derive alpha when alpha is not provided.
   */
  windowSeconds: number;
  /**
   * Optional per-second rate limit. When provided, incoming deltas will be clamped to this rate.
   */
  rateLimitPerSecond?: number;
  /**
   * Optional per-second delta threshold. When exceeded the sample is treated as an outlier and rejected.
   */
  outlierThresholdPerSecond?: number;
};

export type SignalProcessingConfig = {
  confidenceThreshold: number;
  metrics: Record<MetricKey, SignalProcessingMetricConfig>;
};

export type SignalProcessingMetricOverrides =
  Partial<SignalProcessingMetricConfig>;

export type SignalProcessingConfigOverrides = {
  confidenceThreshold?: number;
  metrics?: Partial<Record<MetricKey, SignalProcessingMetricOverrides>>;
};

export const DEFAULT_SIGNAL_PROCESSING_CONFIG: SignalProcessingConfig = {
  confidenceThreshold: 0.4,
  metrics: {
    pitch: {
      alpha: 0.3,
      windowSeconds: 0.8,
      rateLimitPerSecond: 200,
      outlierThresholdPerSecond: 200,
    },
    yaw: {
      alpha: 0.3,
      windowSeconds: 0.8,
      rateLimitPerSecond: 220,
      outlierThresholdPerSecond: 220,
    },
    roll: {
      alpha: 0.3,
      windowSeconds: 0.8,
      rateLimitPerSecond: 220,
      outlierThresholdPerSecond: 220,
    },
    ehd: {
      alpha: 0.3,
      windowSeconds: 0.6,
      outlierThresholdPerSecond: 2,
    },
    dpr: {
      alpha: 0.25,
      windowSeconds: 1.0,
      rateLimitPerSecond: 0.3,
      outlierThresholdPerSecond: 10,
    },
  },
};

const cloneConfig = (
  config: SignalProcessingConfig,
): SignalProcessingConfig => {
  const metrics: Record<MetricKey, SignalProcessingMetricConfig> = {} as Record<
    MetricKey,
    SignalProcessingMetricConfig
  >;

  (Object.keys(config.metrics) as MetricKey[]).forEach((key) => {
    metrics[key] = { ...config.metrics[key] };
  });

  return {
    confidenceThreshold: config.confidenceThreshold,
    metrics,
  };
};

const initialEnvConfidence = parseNumericEnv(
  getEnvVar("POSELY_SIGNAL_CONF_THRESHOLD"),
  { min: 0, max: 1 },
);

let activeConfig: SignalProcessingConfig = cloneConfig(
  DEFAULT_SIGNAL_PROCESSING_CONFIG,
);

if (typeof initialEnvConfidence === "number") {
  activeConfig.confidenceThreshold = initialEnvConfidence;
}

const mergeMetricConfig = (
  current: SignalProcessingMetricConfig,
  override: SignalProcessingMetricOverrides | undefined,
): SignalProcessingMetricConfig => {
  if (!override) {
    return { ...current };
  }

  return {
    ...current,
    ...override,
  };
};

const mergeMetrics = (
  current: Record<MetricKey, SignalProcessingMetricConfig>,
  override:
    | Partial<Record<MetricKey, SignalProcessingMetricOverrides>>
    | undefined,
): Record<MetricKey, SignalProcessingMetricConfig> => {
  const merged: Partial<Record<MetricKey, SignalProcessingMetricConfig>> = {};

  (Object.keys(current) as MetricKey[]).forEach((key) => {
    merged[key] = mergeMetricConfig(current[key], override?.[key]);
  });

  if (override) {
    (Object.keys(override) as MetricKey[]).forEach((key) => {
      if (!merged[key]) {
        merged[key] = mergeMetricConfig(
          DEFAULT_SIGNAL_PROCESSING_CONFIG.metrics[key],
          override[key],
        );
      }
    });
  }

  return merged as Record<MetricKey, SignalProcessingMetricConfig>;
};

export const getSignalProcessingConfig = (): SignalProcessingConfig => {
  return cloneConfig(activeConfig);
};

export const updateSignalProcessingConfig = (
  override: SignalProcessingConfigOverrides,
): SignalProcessingConfig => {
  activeConfig = {
    confidenceThreshold:
      override.confidenceThreshold ?? activeConfig.confidenceThreshold,
    metrics: mergeMetrics(activeConfig.metrics, override.metrics),
  };

  return getSignalProcessingConfig();
};

export const resetSignalProcessingConfig = (): SignalProcessingConfig => {
  activeConfig = cloneConfig(DEFAULT_SIGNAL_PROCESSING_CONFIG);
  if (typeof initialEnvConfidence === "number") {
    activeConfig.confidenceThreshold = initialEnvConfidence;
  }
  return getSignalProcessingConfig();
};

export const createSignalProcessingEnvOverrides =
  (): SignalProcessingConfigOverrides => {
    const threshold = parseNumericEnv(
      getEnvVar("POSELY_SIGNAL_CONF_THRESHOLD"),
      {
        min: 0,
        max: 1,
      },
    );

    return threshold === null
      ? {}
      : {
          confidenceThreshold: threshold,
        };
  };
