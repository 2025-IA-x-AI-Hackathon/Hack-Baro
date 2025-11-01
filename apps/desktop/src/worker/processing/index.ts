import { clamp, getEnvVar, parseOptionalBoolean } from "../../shared/env";
import { getLogger } from "../../shared/logger";
import type { SignalProcessingConfig } from "../config/signal-processing-config";
import {
  DEFAULT_SIGNAL_PROCESSING_CONFIG,
  getSignalProcessingConfig,
} from "../config/signal-processing-config";
import { ConfidenceGate } from "./confidence-gate";
import EMASmoother from "./ema-smoother";
import type {
  MetricKey,
  MetricSample,
  SignalProcessingContext,
  SignalProcessingResult,
} from "./types";

const logger = getLogger("signal-processor", "worker");

const allowUnreliableSignals = (): boolean => {
  return (
    parseOptionalBoolean(getEnvVar("POSELY_DEBUG_ALLOW_UNRELIABLE_SIGNALS")) ===
    true
  );
};

type MetricSignalState = {
  smoother: EMASmoother;
  lastRaw: number | null;
};

const createDefaultState = (): MetricSignalState => ({
  smoother: new EMASmoother(),
  lastRaw: null,
});

const computeAlpha = (
  deltaSeconds: number,
  config: SignalProcessingConfig["metrics"][MetricKey],
): number => {
  const windowSeconds = Math.max(config.windowSeconds, 1e-3);
  const derivedAlpha = clamp((3 * deltaSeconds) / windowSeconds, 0.01, 1);
  const configuredAlpha =
    config.alpha === undefined ? derivedAlpha : clamp(config.alpha, 0.001, 1);
  return configuredAlpha;
};

export default class SignalProcessor {
  private readonly states: Record<MetricKey, MetricSignalState>;

  private config: SignalProcessingConfig;

  private readonly gate: ConfidenceGate;

  private gateAllowsUpdate = true;

  constructor() {
    this.states = {
      pitch: createDefaultState(),
      yaw: createDefaultState(),
      roll: createDefaultState(),
      ehd: createDefaultState(),
      dpr: createDefaultState(),
    };
    this.config = DEFAULT_SIGNAL_PROCESSING_CONFIG;
    this.gate = new ConfidenceGate(this.config.confidenceThreshold);
  }

  beginFrame(frameConfidence: number | null): void {
    this.config = getSignalProcessingConfig();
    this.gate.setThreshold(this.config.confidenceThreshold);
    const decision = this.gate.evaluate(frameConfidence);
    this.gateAllowsUpdate = decision.allowUpdate;

    if (!decision.allowUpdate && this.gate.getSkippedFrameCount() % 60 === 0) {
      logger.debug("Confidence gate skipping frames", {
        skippedFrames: this.gate.getSkippedFrameCount(),
        reason: decision.reason,
        threshold: this.config.confidenceThreshold,
        frameConfidence,
      });
    }
  }

  process(
    sample: MetricSample,
    context: SignalProcessingContext,
  ): SignalProcessingResult {
    const state = this.states[sample.key];
    const metricConfig =
      this.config.metrics[sample.key] ??
      DEFAULT_SIGNAL_PROCESSING_CONFIG.metrics[sample.key];

    const allowUnreliable = allowUnreliableSignals();
    const reliabilityPaused =
      !allowUnreliable && context.reliability === "UNRELIABLE";

    if (allowUnreliable && context.reliability === "UNRELIABLE") {
      logger.debug("Bypassing reliability pause for diagnostics", {
        metric: sample.key,
      });
    }
    const metricConfidenceLow = sample.confidence !== "HIGH";
    const gateBlocked = !this.gateAllowsUpdate;
    const gated = gateBlocked || metricConfidenceLow;

    if (reliabilityPaused && state.lastRaw !== null) {
      logger.debug("Signal processor paused due to reliability", {
        metric: sample.key,
        reliability: context.reliability,
      });
    }

    let rawResult: number | null =
      !gated && !reliabilityPaused ? sample.rawValue : null;

    if (rawResult === null || !Number.isFinite(rawResult)) {
      return {
        raw: rawResult,
        smoothed: state.smoother.getValue(),
        outlier: false,
        gated,
        reliabilityPaused,
        updated: false,
      };
    }

    const previousRaw = Number.isFinite(state.lastRaw) ? state.lastRaw : null;
    const deltaSeconds = Math.max(context.deltaSeconds, 1e-3);

    let outlier = false;
    let processedRaw = rawResult;

    if (previousRaw !== null) {
      const delta = processedRaw - previousRaw;
      if (metricConfig.outlierThresholdPerSecond) {
        const rate = Math.abs(delta) / deltaSeconds;
        if (rate > metricConfig.outlierThresholdPerSecond) {
          outlier = true;
        }
      }

      if (!outlier && metricConfig.rateLimitPerSecond) {
        const limit = metricConfig.rateLimitPerSecond * deltaSeconds;
        if (limit > 0 && Math.abs(delta) > limit) {
          processedRaw = previousRaw + Math.sign(delta) * limit;
        }
      }
    }

    if (outlier) {
      logger.debug("Signal processor rejected outlier", {
        metric: sample.key,
        raw: rawResult,
        previous: previousRaw,
        thresholdPerSecond: metricConfig.outlierThresholdPerSecond,
      });
      return {
        raw: rawResult,
        smoothed: state.smoother.getValue(),
        outlier: true,
        gated,
        reliabilityPaused,
        updated: false,
      };
    }

    const alpha = computeAlpha(deltaSeconds, metricConfig);
    const smoothed = state.smoother.update(processedRaw, alpha);
    state.lastRaw = processedRaw;
    rawResult = processedRaw;

    return {
      raw: rawResult,
      smoothed,
      outlier: false,
      gated,
      reliabilityPaused,
      updated: true,
    };
  }

  reset(): void {
    (Object.keys(this.states) as MetricKey[]).forEach((key) => {
      const state = this.states[key];
      state.smoother.reset();
      state.lastRaw = null;
    });
  }
}
