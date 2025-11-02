import { EventEmitter } from "node:events";
import {
  DEFAULT_THRESHOLD_DELTAS,
  deriveThresholds,
} from "../../shared/calibration/sensitivity-presets";
import { parseBooleanFlag } from "../../shared/env";
import { getLogger } from "../../shared/logger";
import type {
  CalibrationCustomThresholds,
  CalibrationFailure,
  CalibrationProgress,
  CalibrationSensitivity,
  CalibrationSessionResult,
  CalibrationValidationResult,
  CalibrationValidationSuggestion,
} from "../../shared/types/calibration";
import type { EngineReliability } from "../../shared/types/engine-state";
import type { MetricValues } from "../../shared/types/metrics";
import {
  BaselineCalculator,
  type BaselineCalculatorOptions,
  type BaselineComputationResult,
  type BaselineSampleOutcome,
} from "./baseline-calculator";

const mapConfidenceString = (input: string | null | undefined): number => {
  switch (input) {
    case "HIGH":
      return 1;
    case "LOW":
      return 0.4;
    default:
      return 0;
  }
};

const toSampleConfidence = (metrics: MetricValues | null): number => {
  if (!metrics) {
    return 0;
  }

  const pitchConfidence = mapConfidenceString(
    metrics.metrics.pitch?.confidence ?? null,
  );
  const ehdConfidence = mapConfidenceString(
    metrics.metrics.ehd?.confidence ?? null,
  );
  const dprConfidence = mapConfidenceString(
    metrics.metrics.dpr?.confidence ?? null,
  );

  const confidences = [pitchConfidence, ehdConfidence, dprConfidence];
  if (metrics.flags.lowConfidence) {
    confidences.push(0.5);
  }
  if (metrics.flags.baselinePending) {
    confidences.push(0.7);
  }
  return Math.min(...confidences);
};

const mapReliability = (
  reliability: EngineReliability | null | undefined,
): "OK" | "UNRELIABLE" => {
  if (!reliability || reliability === "OK") {
    return "OK";
  }
  return "UNRELIABLE";
};

const createCalculator = (
  options: CalibrationFlowOptions,
): BaselineCalculator => {
  const calculatorOptions: BaselineCalculatorOptions = {
    targetSamples: options.targetSamples,
    minConfidence: options.calculatorOptions?.minConfidence,
    sessionWindow: options.calculatorOptions?.sessionWindow,
  };
  return new BaselineCalculator(calculatorOptions);
};

export type CalibrationFlowOptions = {
  sensitivity?: CalibrationSensitivity;
  customThresholds?: CalibrationCustomThresholds | null;
  targetSamples?: number;
  minQuality?: number;
  validationDurationMs?: number;
  maxCollectionDurationMs?: number;
  progressIntervalMs?: number;
  calculatorOptions?: BaselineCalculatorOptions;
};

type CalibrationPhase =
  | "idle"
  | "collecting"
  | "validating"
  | "complete"
  | "failed";

type CalibrationEvents = {
  progress: [CalibrationProgress];
  complete: [CalibrationSessionResult];
  failed: [CalibrationFailure];
};

const DEFAULT_MIN_QUALITY = 40;
const DEFAULT_VALIDATION_DURATION_MS = 30_000;
const DEFAULT_MAX_COLLECTION_DURATION_MS = 80_000;
const DEFAULT_PROGRESS_INTERVAL_MS = 350;

export type CalibrationIngestInput = {
  metrics: MetricValues | null;
  reliability: EngineReliability | null;
};

export class CalibrationFlow extends EventEmitter<CalibrationEvents> {
  private baselineCalculator: BaselineCalculator;

  private options: CalibrationFlowOptions;

  private phase: CalibrationPhase = "idle";

  private sessionStartedAt: number | null = null;

  private validationStartedAt: number | null = null;

  private validationSamples = 0;

  private unreliableValidationSamples = 0;

  private lastProgressEmitAt = 0;

  private baselineResult: BaselineComputationResult | null = null;

  private processedSamples = 0;

  private acceptedSamples = 0;

  private droppedLowConfidence = 0;

  private droppedUnreliable = 0;

  private droppedInvalid = 0;

  private lastSampleConfidence: number | null = null;

  private readonly debugEnabled: boolean = parseBooleanFlag(
    process.env.POSELY_CALIBRATION_DEBUG,
    false,
  );

  private readonly logger = getLogger("calibration-flow", "worker");

  constructor(options: CalibrationFlowOptions = {}) {
    super();
    this.options = options;
    this.baselineCalculator = createCalculator(options);
  }

  start(options: CalibrationFlowOptions = {}): void {
    this.options = { ...this.options, ...options };
    this.baselineCalculator = createCalculator(this.options);
    this.phase = "collecting";
    this.sessionStartedAt = Date.now();
    this.validationStartedAt = null;
    this.validationSamples = 0;
    this.unreliableValidationSamples = 0;
    this.lastProgressEmitAt = 0;
    this.baselineResult = null;
    this.processedSamples = 0;
    this.acceptedSamples = 0;
    this.droppedLowConfidence = 0;
    this.droppedUnreliable = 0;
    this.droppedInvalid = 0;
    this.lastSampleConfidence = null;
    this.baselineCalculator.reset();
    this.emitProgress("collecting");
  }

  cancel(reason: CalibrationFailure["reason"], message: string): void {
    if (this.phase === "complete" || this.phase === "failed") {
      return;
    }
    this.phase = "failed";
    this.emit("failed", { reason, message });
  }

  ingest(input: CalibrationIngestInput): void {
    if (this.phase !== "collecting" && this.phase !== "validating") {
      return;
    }

    if (!input.metrics) {
      return;
    }

    const now = Date.now();
    if (
      this.phase === "collecting" &&
      this.sessionStartedAt !== null &&
      now - this.sessionStartedAt >
        (this.options.maxCollectionDurationMs ??
          DEFAULT_MAX_COLLECTION_DURATION_MS)
    ) {
      this.cancel("timeout", "Calibration timed out while collecting samples.");
      return;
    }

    this.processedSamples += 1;

    const timestamp = input.metrics.timestamp || now;
    const reliability = mapReliability(input.reliability);

    const pitch =
      input.metrics.metrics.pitch?.smoothed ??
      input.metrics.metrics.pitch?.raw ??
      null;
    const ehd =
      input.metrics.metrics.ehd?.smoothed ??
      input.metrics.metrics.ehd?.raw ??
      null;
    const dpr =
      input.metrics.metrics.dpr?.smoothed ??
      input.metrics.metrics.dpr?.raw ??
      null;

    const confidence = toSampleConfidence(input.metrics);

    if (this.phase === "collecting") {
      const outcome: BaselineSampleOutcome = this.baselineCalculator.addSample({
        timestamp,
        pitch,
        ehd,
        dpr,
        confidence,
        reliability,
      });

      this.lastSampleConfidence = confidence;
      if (outcome === "accepted") {
        this.acceptedSamples += 1;
        this.debugLog("sample-accepted", {
          confidence,
          pitch,
          ehd,
          dpr,
          accepted: this.acceptedSamples,
        });
      } else if (outcome === "low-confidence") {
        this.droppedLowConfidence += 1;
        this.debugLog("sample-rejected-low-confidence", {
          confidence,
          reliability,
          droppedLowConfidence: this.droppedLowConfidence,
        });
      } else if (outcome === "unreliable") {
        this.droppedUnreliable += 1;
        this.debugLog("sample-rejected-unreliable", {
          confidence,
          reliability,
          droppedUnreliable: this.droppedUnreliable,
        });
      } else {
        this.droppedInvalid += 1;
        this.debugLog("sample-rejected-invalid", {
          pitch,
          ehd,
          dpr,
          droppedInvalid: this.droppedInvalid,
        });
      }

      if (outcome !== "accepted") {
        this.emitProgress("collecting");
        return;
      }

      if (this.baselineCalculator.isComplete()) {
        this.handleBaselineComplete();
        return;
      }

      this.emitProgress("collecting");
      return;
    }

    if (this.phase === "validating") {
      this.validationSamples += 1;
      if (reliability === "UNRELIABLE" || confidence < 0.2) {
        this.unreliableValidationSamples += 1;
      }

      if (this.validationStartedAt === null) {
        this.validationStartedAt = timestamp;
      }

      const elapsedMs = timestamp - (this.validationStartedAt ?? timestamp);
      if (
        elapsedMs >=
        (this.options.validationDurationMs ?? DEFAULT_VALIDATION_DURATION_MS)
      ) {
        this.completeSession();
        return;
      }

      this.emitProgress("validating");
    }
  }

  private handleBaselineComplete(): void {
    try {
      const result = this.baselineCalculator.calculate();

      const minQuality = this.options.minQuality ?? DEFAULT_MIN_QUALITY;
      if (result.quality < minQuality) {
        this.cancel(
          "low_quality",
          `Calibration quality ${result.quality} below threshold ${minQuality}.`,
        );
        return;
      }

      this.baselineResult = result;
      this.phase = "validating";
      this.validationSamples = 0;
      this.unreliableValidationSamples = 0;
      this.validationStartedAt = null;
      this.emitProgress("validating");
    } catch (error) {
      this.cancel(
        "insufficient_samples",
        error instanceof Error ? error.message : "Calibration failed.",
      );
    }
  }

  private completeSession(): void {
    if (!this.baselineResult) {
      this.cancel("unknown", "Baseline result missing.");
      return;
    }

    const unreliableRatio =
      this.validationSamples === 0
        ? 0
        : this.unreliableValidationSamples / this.validationSamples;

    let suggestion: CalibrationValidationSuggestion = "ok";
    if (this.baselineResult.quality < DEFAULT_MIN_QUALITY) {
      suggestion = "recalibrate_low_quality";
    } else if (this.baselineResult.quality < 80) {
      suggestion = "adjust_sensitivity";
    }
    if (unreliableRatio > 0.1) {
      suggestion = "recalibrate_unreliable";
    }

    const validation: CalibrationValidationResult = {
      quality: this.baselineResult.quality,
      unreliableFrameRatio: Number(unreliableRatio.toFixed(3)),
      suggestion,
    };

    const sensitivity = this.options.sensitivity ?? "medium";
    const thresholds = deriveThresholds(
      this.baselineResult,
      sensitivity,
      this.options.customThresholds,
      DEFAULT_THRESHOLD_DELTAS,
    );

    const completePayload: CalibrationSessionResult = {
      baseline: {
        baselinePitch: this.baselineResult.baselinePitch,
        baselineEHD: this.baselineResult.baselineEHD,
        baselineDPR: this.baselineResult.baselineDPR,
        quality: this.baselineResult.quality,
        sampleCount: this.baselineResult.sampleCount,
      },
      sensitivity,
      customThresholds: this.options.customThresholds ?? null,
      thresholds,
      validation,
    };

    this.phase = "complete";
    this.emit("complete", completePayload);
  }

  private emitProgress(phase: CalibrationPhase): void {
    const now = Date.now();
    if (
      now - this.lastProgressEmitAt <
      (this.options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS)
    ) {
      return;
    }
    this.lastProgressEmitAt = now;

    const collectedSamples = this.baselineCalculator.getSampleCount();
    const targetSamples = this.baselineCalculator.getTargetSamples();
    const stabilityScore = this.baselineCalculator.estimateStability();
    const qualityScore =
      this.baselineResult?.quality ??
      (phase === "validating" ? stabilityScore : null);

    let message: string | undefined;

    if (phase === "collecting") {
      message = "Capturing neutral posture...";
    } else if (phase === "validating") {
      message = "Validating calibration stability...";
    }

    const progress: CalibrationProgress = {
      phase,
      collectedSamples,
      targetSamples,
      stabilityScore,
      qualityScore,
      message,
      acceptedSamples: this.acceptedSamples,
      rejectedSamples:
        this.droppedLowConfidence +
        this.droppedInvalid +
        this.droppedUnreliable,
      rejectedLowConfidence: this.droppedLowConfidence,
      rejectedInvalid: this.droppedInvalid,
      rejectedUnreliable: this.droppedUnreliable,
      lastSampleConfidence: this.lastSampleConfidence,
      elapsedMs:
        this.sessionStartedAt !== null
          ? now - this.sessionStartedAt
          : undefined,
    };

    this.emit("progress", progress);
  }

  private debugLog(event: string, payload: Record<string, unknown>): void {
    if (!this.debugEnabled) {
      return;
    }
    this.logger.debug(event, payload);
  }
}

export default CalibrationFlow;
