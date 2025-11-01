import { getEnvVar, parseOptionalBoolean } from "../../shared/env";
import { type LoggerMetadata, getLogger } from "../../shared/logger";
import { resolveTimestamp } from "../../shared/time";
import type {
  CombinedLandmarks,
  DetectionReliability,
  FaceLandmarks,
  PoseLandmarks,
} from "../../shared/types/landmarks";
import type { MetricValues } from "../../shared/types/metrics";
import { isFiniteNumber } from "../../shared/validation/metricValues";
import SignalProcessor from "../processing";
import type { SignalProcessingContext } from "../processing/types";
import { computeDpr } from "./dpr";
import { computeEhd } from "./ehd";
import { computeHeadPose } from "./head-pitch";

const logger = getLogger("metrics-processor", "worker");
const isHeadPoseDebugEnabled = (): boolean => {
  return parseOptionalBoolean(getEnvVar("POSELY_DEBUG_HEAD_POSE")) === true;
};

const logHeadPose = (message: string, metadata?: LoggerMetadata) => {
  if (!isHeadPoseDebugEnabled()) {
    return;
  }
  logger.debug(message, metadata);
};

const YAW_DEWEIGHT_THRESHOLD_DEGREES = 25;

const parsePositiveIntEnv = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
};

const shouldTrackLatencyStats = parseOptionalBoolean(
  getEnvVar("POSELY_SIGNAL_LATENCY_STATS"),
);
const latencyStatsInterval = parsePositiveIntEnv(
  getEnvVar("POSELY_SIGNAL_LATENCY_INTERVAL"),
  120,
);
const latencyStatsWindow = parsePositiveIntEnv(
  getEnvVar("POSELY_SIGNAL_LATENCY_WINDOW"),
  600,
);

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * (sorted.length - 1) + 0.5),
  );
  return sorted[index] ?? Number.NaN;
};

class LatencyStats {
  private readonly samples: number[] = [];

  private frames = 0;

  constructor(
    private readonly interval: number,
    private readonly windowSize: number,
  ) {}

  record(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    const valueMs = deltaSeconds * 1000;
    this.samples.push(valueMs);
    if (this.samples.length > this.windowSize) {
      this.samples.splice(0, this.samples.length - this.windowSize);
    }
    this.frames += 1;
  }

  maybeLog(): void {
    if (this.frames === 0 || this.samples.length === 0) {
      return;
    }
    if (this.frames % this.interval !== 0) {
      return;
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = this.samples.reduce((acc, value) => acc + value, 0);
    const average = sum / this.samples.length;

    logger.info("Signal frame cadence stats", {
      windowSize: this.samples.length,
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      avgMs: Number(average.toFixed(3)),
      p50Ms: Number(percentile(sorted, 50).toFixed(3)),
      p95Ms: Number(percentile(sorted, 95).toFixed(3)),
    });
  }
}

const getDeltaSeconds = (
  previousTimestamp: number | null,
  currentTimestamp: number,
): number => {
  if (!Number.isFinite(currentTimestamp)) {
    return 0.1;
  }
  if (previousTimestamp === null || !Number.isFinite(previousTimestamp)) {
    return 0.1;
  }
  const delta = Math.max((currentTimestamp - previousTimestamp) / 1000, 0);
  if (delta <= 0) {
    return 0.1;
  }
  return Math.min(delta, 0.5);
};

const computeFrameConfidence = (
  landmarks: CombinedLandmarks | null | undefined,
): number | null => {
  if (!landmarks) {
    return null;
  }

  const confidences: number[] = [];
  const faceConfidence = landmarks.face?.confidence;
  const poseConfidence = landmarks.pose?.confidence;

  if (Number.isFinite(faceConfidence)) {
    confidences.push(faceConfidence as number);
  }
  if (Number.isFinite(poseConfidence)) {
    confidences.push(poseConfidence as number);
  }

  if (confidences.length === 0) {
    return null;
  }

  return Math.min(...confidences);
};

const isLowReliability = (reliability: DetectionReliability): boolean => {
  return reliability === "LOW" || reliability === "UNRELIABLE";
};

export type MetricProcessorInput = {
  frameId: number;
  timestamp: number;
  landmarks: CombinedLandmarks | null;
  imageWidth: number;
  imageHeight: number;
};

export default class MetricProcessor {
  private baselineFaceSize: number | null = null;

  private lastTimestamp: number | null = null;

  private readonly signalProcessor = new SignalProcessor();

  private readonly latencyStats: LatencyStats | null = shouldTrackLatencyStats
    ? new LatencyStats(latencyStatsInterval, latencyStatsWindow)
    : null;

  setBaseline(size: number): void {
    if (!Number.isFinite(size) || size <= 0) {
      return;
    }
    this.baselineFaceSize = size;
  }

  getBaseline(): number | null {
    return this.baselineFaceSize;
  }

  update(input: MetricProcessorInput): MetricValues {
    const { landmarks, imageWidth, imageHeight, frameId, timestamp } = input;

    const face: FaceLandmarks | null | undefined = landmarks?.face ?? null;
    const pose: PoseLandmarks | null | undefined = landmarks?.pose ?? null;

    const resolvedTimestamp = resolveTimestamp(timestamp);
    const deltaSeconds = getDeltaSeconds(this.lastTimestamp, resolvedTimestamp);
    this.lastTimestamp = resolvedTimestamp;

    this.latencyStats?.record(deltaSeconds);

    const ehdResult = computeEhd(pose);
    const headPoseResult = computeHeadPose(face, imageWidth, imageHeight);
    const dprResult = computeDpr(face, this.baselineFaceSize);

    if (
      this.baselineFaceSize === null &&
      dprResult.confidence === "HIGH" &&
      Number.isFinite(dprResult.size ?? NaN)
    ) {
      this.baselineFaceSize = dprResult.size ?? null;
    }

    const reliability = landmarks?.reliability ?? "UNKNOWN";
    const frameConfidence = computeFrameConfidence(landmarks);

    this.signalProcessor.beginFrame(frameConfidence);

    const processingContext: SignalProcessingContext = {
      deltaSeconds,
      reliability,
      frameConfidence,
    };

    const ehdSignal = this.signalProcessor.process(
      {
        key: "ehd",
        rawValue: ehdResult.value,
        confidence: ehdResult.confidence,
        source: ehdResult.source,
      },
      processingContext,
    );

    const pitchSignal = this.signalProcessor.process(
      {
        key: "pitch",
        rawValue: headPoseResult.pitch,
        confidence: headPoseResult.confidence,
        source: headPoseResult.source,
      },
      processingContext,
    );

    const yawSignal = this.signalProcessor.process(
      {
        key: "yaw",
        rawValue: headPoseResult.yaw,
        confidence: headPoseResult.confidence,
        source: headPoseResult.source,
      },
      processingContext,
    );

    const rollSignal = this.signalProcessor.process(
      {
        key: "roll",
        rawValue: headPoseResult.roll,
        confidence: headPoseResult.confidence,
        source: headPoseResult.source,
      },
      processingContext,
    );

    if (isHeadPoseDebugEnabled()) {
      logHeadPose("signal update", {
        headPoseSource: headPoseResult.source,
        headPoseConfidence: headPoseResult.confidence,
        yawRaw: yawSignal.raw,
        yawSmoothed: yawSignal.smoothed,
        yawGated: yawSignal.gated,
        yawReliabilityPaused: yawSignal.reliabilityPaused,
        rollRaw: rollSignal.raw,
        rollSmoothed: rollSignal.smoothed,
        rollGated: rollSignal.gated,
        rollReliabilityPaused: rollSignal.reliabilityPaused,
        frameConfidence,
      });
    }

    const dprSignal = this.signalProcessor.process(
      {
        key: "dpr",
        rawValue: dprResult.ratio ?? null,
        confidence: dprResult.confidence,
        source: dprResult.source,
      },
      processingContext,
    );

    const yawCandidate =
      typeof yawSignal.raw === "number" ? yawSignal.raw : yawSignal.smoothed;
    let yawValue: number | null = null;
    if (isFiniteNumber(yawCandidate)) {
      yawValue = yawCandidate;
    }
    const baselinePending = this.baselineFaceSize === null;

    const yawDeweighted =
      typeof yawValue === "number" &&
      Math.abs(yawValue) >= YAW_DEWEIGHT_THRESHOLD_DEGREES;

    const gatingTriggered =
      ehdSignal.gated ||
      pitchSignal.gated ||
      yawSignal.gated ||
      rollSignal.gated ||
      dprSignal.gated;

    const reliabilityPaused =
      ehdSignal.reliabilityPaused ||
      pitchSignal.reliabilityPaused ||
      yawSignal.reliabilityPaused ||
      rollSignal.reliabilityPaused ||
      dprSignal.reliabilityPaused;

    const outlierDetected =
      ehdSignal.outlier ||
      pitchSignal.outlier ||
      yawSignal.outlier ||
      rollSignal.outlier ||
      dprSignal.outlier;

    const lowConfidence =
      gatingTriggered ||
      reliabilityPaused ||
      outlierDetected ||
      baselinePending ||
      frameConfidence === null ||
      isLowReliability(reliability) ||
      ehdResult.confidence !== "HIGH" ||
      headPoseResult.confidence !== "HIGH" ||
      dprResult.confidence !== "HIGH";

    const payload: MetricValues = {
      frameId,
      timestamp,
      baselineFaceSize: this.baselineFaceSize,
      metrics: {
        ehd: {
          raw: ehdSignal.raw,
          smoothed: ehdSignal.smoothed,
          source: ehdResult.source,
          confidence: ehdResult.confidence,
          outlier: ehdSignal.outlier,
          gated: ehdSignal.gated,
          reliabilityPaused: ehdSignal.reliabilityPaused,
        },
        pitch: {
          raw: pitchSignal.raw,
          smoothed: pitchSignal.smoothed,
          source: headPoseResult.source,
          confidence: headPoseResult.confidence,
          outlier: pitchSignal.outlier,
          gated: pitchSignal.gated,
          reliabilityPaused: pitchSignal.reliabilityPaused,
        },
        yaw: {
          raw: yawSignal.raw,
          smoothed: yawSignal.smoothed,
          source: headPoseResult.source,
          confidence: headPoseResult.confidence,
          outlier: yawSignal.outlier,
          gated: yawSignal.gated,
          reliabilityPaused: yawSignal.reliabilityPaused,
        },
        roll: {
          raw: rollSignal.raw,
          smoothed: rollSignal.smoothed,
          source: headPoseResult.source,
          confidence: headPoseResult.confidence,
          outlier: rollSignal.outlier,
          gated: rollSignal.gated,
          reliabilityPaused: rollSignal.reliabilityPaused,
        },
        dpr: {
          raw: dprSignal.raw,
          smoothed: dprSignal.smoothed,
          source: dprResult.source,
          confidence: dprResult.confidence,
          outlier: dprSignal.outlier,
          gated: dprSignal.gated,
          reliabilityPaused: dprSignal.reliabilityPaused,
        },
      },
      flags: {
        yawDeweighted,
        lowConfidence,
        baselinePending,
      },
    } satisfies MetricValues;

    logger.debug("Metric frame computed", {
      frameId,
      yawDeweighted,
      baselinePending,
      baseline: this.baselineFaceSize,
      ehdRaw: payload.metrics.ehd.raw,
      pitchRaw: payload.metrics.pitch.raw,
      yawRaw: payload.metrics.yaw.raw,
      rollRaw: payload.metrics.roll.raw,
      dprRaw: payload.metrics.dpr.raw,
      frameConfidence,
      gatingTriggered,
      reliabilityPaused,
      outlierDetected,
    });

    this.latencyStats?.maybeLog();

    return payload;
  }
}

export const createMetricProcessor = (): MetricProcessor => {
  return new MetricProcessor();
};
