import {
  type FaceLandmarkerResult,
  FilesetResolver,
  type Landmark,
  type Matrix,
  type NormalizedLandmark,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { getLogger } from "../../shared/logger";
import type {
  DetectorInitPayload,
  DetectorResult,
  FrameMetadata,
} from "../../shared/types/detector";
import type {
  CombinedLandmarks,
  DetectionPresence,
  DetectionReliability,
  FaceLandmarks,
  PoseLandmarks,
} from "../../shared/types/landmarks";
import { getDetectionGuardrailConfig } from "../config/detection-config";
import {
  DEFAULT_MEDIAPIPE_CONFIG,
  type MediapipeFaceConfig,
  type MediapipePoseConfig,
  type MediapipeRuntimeConfig,
} from "../config/mediapipe-config";
import { getScoreConfig } from "../config/score-config";
import { ReliabilityGuardrails } from "../guardrails";
import { createMetricProcessor } from "../metrics";
import { createPresenceDetector } from "../presence/detector";
import { ScoreProcessor } from "../scoring/calculator";
import { captureWorkerException } from "../sentry";
import { FACE_PRESENCE_CONFIG } from "./config/presence-config";
import { createFaceMeshRuntime } from "./face-mesh";
import { createPoseRuntime } from "./pose";

const logger = getLogger("mediapipe-pipeline", "worker");

const sanitizeProcessForMediaPipe = () => {
  if (typeof globalThis.process === "undefined") {
    return;
  }

  try {
    // MediaPipe uses process.versions.node to detect Node environments.
    // Electron's sandboxed workers can expose a stubbed process object that lacks require,
    // causing MediaPipe's runtime to take the Node code path and throw before ModuleFactory is set.
    // Removing the shim forces the browser/worker code path, which works in Electron.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - delete is safe here
    delete globalThis.process;
  } catch (error) {
    logger.warn(
      "Failed to sanitize process for MediaPipe, continuing with existing process object",
      { error: error instanceof Error ? error.message : String(error) },
    );
    (globalThis as Record<string, unknown>).process = undefined;
  }
};

sanitizeProcessForMediaPipe();

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

type TrackState = {
  bounds: BoundingBox;
  updatedAt: number;
  landmarks: NormalizedLandmark[];
  confidence: number;
  worldLandmarks?: Landmark[];
  transformationMatrix?: number[];
};

type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
};

type MediapipeRuntimeOverrides = {
  stickinessMs?: number;
  alternatingFrameCadence?: number;
  warmupFrameCount?: number;
  face?: Partial<MediapipeFaceConfig>;
  pose?: Partial<MediapipePoseConfig>;
};

const bitmapToImageData = (bitmap: ImageBitmap): ImageData => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to get OffscreenCanvas context for MediaPipe");
  }

  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
};

const averageVisibility = (landmarks: NormalizedLandmark[]): number => {
  if (landmarks.length === 0) {
    return 0;
  }
  const total = landmarks.reduce((sum, landmark) => {
    const visibility =
      typeof landmark.visibility === "number"
        ? clamp01(landmark.visibility)
        : 0;
    return sum + visibility;
  }, 0);

  return clamp01(total / landmarks.length);
};

const computeBounds = (landmarks: NormalizedLandmark[]): BoundingBox => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  landmarks.forEach((landmark) => {
    if (Number.isFinite(landmark.x)) {
      minX = Math.min(minX, landmark.x);
      maxX = Math.max(maxX, landmark.x);
    }
    if (Number.isFinite(landmark.y)) {
      minY = Math.min(minY, landmark.y);
      maxY = Math.max(maxY, landmark.y);
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    maxX = 0;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = 0;
    maxY = 0;
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    area: Math.max(width * height, 0),
  };
};

const intersectionOverUnion = (a: BoundingBox, b: BoundingBox): number => {
  const xLeft = Math.max(a.minX, b.minX);
  const yTop = Math.max(a.minY, b.minY);
  const xRight = Math.min(a.maxX, b.maxX);
  const yBottom = Math.min(a.maxY, b.maxY);

  if (xRight <= xLeft || yBottom <= yTop) {
    return 0;
  }

  const intersection = (xRight - xLeft) * (yBottom - yTop);
  const union = a.area + b.area - intersection;

  if (union <= 0) {
    return 0;
  }

  return intersection / union;
};

type TransformationCandidate = Matrix | Float32Array | readonly number[] | null;

const computeFaceAreaScore = (area: number): number => {
  if (!Number.isFinite(area) || area <= 0) {
    return 0;
  }
  const normalised =
    (area - FACE_PRESENCE_CONFIG.minArea) /
    (FACE_PRESENCE_CONFIG.maxArea - FACE_PRESENCE_CONFIG.minArea);
  return clamp01(normalised);
};

const computeFaceStabilityScore = (
  current: TrackState | null,
  previous: TrackState | null,
): number => {
  if (!current) {
    return 0;
  }
  if (!previous) {
    return FACE_PRESENCE_CONFIG.stabilityFallback;
  }
  return clamp01(intersectionOverUnion(current.bounds, previous.bounds));
};

const computeFacePresenceConfidence = (
  current: TrackState | null,
  previous: TrackState | null,
  hadMultiple: boolean,
): number => {
  if (!current) {
    return 0;
  }
  const areaScore = computeFaceAreaScore(current.bounds.area);
  const stabilityScore = computeFaceStabilityScore(current, previous);
  let confidence =
    FACE_PRESENCE_CONFIG.areaWeight * areaScore +
    FACE_PRESENCE_CONFIG.stabilityWeight * stabilityScore;
  if (hadMultiple) {
    confidence *= FACE_PRESENCE_CONFIG.multiplePenalty;
  }
  return clamp01(confidence);
};

const hasMatrixData = (
  candidate: TransformationCandidate,
): candidate is Matrix => {
  return (
    !!candidate &&
    typeof candidate === "object" &&
    "data" in candidate &&
    Array.isArray(candidate.data)
  );
};

const toNumberArray = (
  candidate: TransformationCandidate | undefined,
): number[] | undefined => {
  if (!candidate) {
    return undefined;
  }
  if (candidate instanceof Float32Array) {
    return Array.from(candidate);
  }
  if (Array.isArray(candidate)) {
    return Array.from(candidate);
  }
  if (hasMatrixData(candidate)) {
    return candidate.data.slice();
  }
  return undefined;
};

const selectDominantTrack = (
  candidates: NormalizedLandmark[][],
  worldCandidates: Landmark[][] | undefined,
  transformationCandidates: readonly TransformationCandidate[] | undefined,
  timestamp: number,
  previous: TrackState | null,
  stickinessMs: number,
): { track: TrackState | null; hadMultiple: boolean } => {
  if (candidates.length === 0) {
    return { track: null, hadMultiple: false };
  }

  const candidateStates: TrackState[] = candidates.map((landmarks, index) => {
    const bounds = computeBounds(landmarks);
    const confidence = averageVisibility(landmarks);
    const transformation = toNumberArray(transformationCandidates?.[index]);
    return {
      bounds,
      landmarks,
      updatedAt: timestamp,
      confidence,
      worldLandmarks: worldCandidates?.[index],
      transformationMatrix: transformation,
    };
  });

  if (candidateStates.length === 0) {
    return { track: null, hadMultiple: false };
  }

  const pickLargestTrack = (tracks: TrackState[]): TrackState | null => {
    let best: TrackState | null = null;
    tracks.forEach((track) => {
      if (!track) {
        return;
      }
      if (!best || track.bounds.area > best.bounds.area) {
        best = track;
      }
    });
    return best;
  };

  if (!previous) {
    const bestTrack = pickLargestTrack(candidateStates);
    if (!bestTrack) {
      return { track: null, hadMultiple: false };
    }
    return {
      track: bestTrack,
      hadMultiple: candidateStates.length > 1,
    };
  }

  const sticky = timestamp - previous.updatedAt < stickinessMs;
  if (sticky) {
    const matched = candidateStates.find((candidate) => {
      return intersectionOverUnion(candidate.bounds, previous.bounds) >= 0.3;
    });

    if (matched) {
      return {
        track: {
          ...matched,
          updatedAt: timestamp,
        },
        hadMultiple: candidateStates.length > 1,
      };
    }

    return {
      track: {
        ...previous,
        updatedAt: timestamp,
      },
      hadMultiple: candidateStates.length > 1,
    };
  }

  const bestTrack = pickLargestTrack(candidateStates);
  if (!bestTrack) {
    return { track: null, hadMultiple: false };
  }

  return {
    track: { ...bestTrack, updatedAt: timestamp },
    hadMultiple: candidateStates.length > 1,
  };
};

const toFaceLandmarks = (track: TrackState | null): FaceLandmarks | null => {
  if (!track) {
    return null;
  }

  return {
    landmarks: track.landmarks.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z ?? 0,
    })),
    confidence: track.confidence,
    transformationMatrix: track.transformationMatrix
      ? [...track.transformationMatrix]
      : undefined,
  };
};

const toPoseLandmarks = (track: TrackState | null): PoseLandmarks | null => {
  if (!track) {
    return null;
  }

  return {
    landmarks: track.landmarks.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z ?? 0,
      visibility: clamp01(landmark.visibility ?? 0),
    })),
    worldLandmarks: track.worldLandmarks
      ? track.worldLandmarks.map((world) => ({
          x: world.x,
          y: world.y,
          z: world.z ?? 0,
          visibility: clamp01(world.visibility ?? 0),
        }))
      : undefined,
    confidence: track.confidence,
  };
};

const resolveReliability = (
  face: TrackState | null,
  pose: TrackState | null,
): DetectionReliability => {
  const confidences = [
    face?.confidence ?? null,
    pose?.confidence ?? null,
  ].filter((value): value is number => value !== null);

  if (confidences.length === 0) {
    return "UNKNOWN";
  }

  const config = getDetectionGuardrailConfig();
  const okThreshold = Math.max(
    config.confidence.faceThreshold,
    config.confidence.poseThreshold,
    config.illumination.illuminationThreshold,
  );
  const lowThreshold = Math.max(
    0,
    Math.min(okThreshold - 0.3, okThreshold * 0.5),
  );

  const minConfidence = Math.min(...confidences);

  logger.debug("resolveReliability confidences", {
    faceConfidence: face?.confidence ?? null,
    poseConfidence: pose?.confidence ?? null,
    minConfidence,
    okThreshold,
    lowThreshold,
  });

  if (minConfidence >= okThreshold) {
    return "OK";
  }
  if (minConfidence >= lowThreshold) {
    return "LOW";
  }
  return "UNRELIABLE";
};

export class MediapipePipeline {
  private config: MediapipeRuntimeConfig = DEFAULT_MEDIAPIPE_CONFIG;

  private fileset: VisionFileset | null = null;

  private faceTrack: TrackState | null = null;

  private poseTrack: TrackState | null = null;

  private faceRuntime: Awaited<
    ReturnType<typeof createFaceMeshRuntime>
  > | null = null;

  private poseRuntime: Awaited<ReturnType<typeof createPoseRuntime>> | null =
    null;

  private frameCounter = 0;

  private metricProcessor = createMetricProcessor();

  private scoreProcessor: ScoreProcessor | null = null;

  private scoringEnabled = false;

  private facePresenceConfidence: number | null = null;

  private readonly presenceDetector = createPresenceDetector();

  private readonly guardrails = new ReliabilityGuardrails();

  async initialise(
    payload: DetectorInitPayload,
    overrides: MediapipeRuntimeOverrides = {},
  ): Promise<void> {
    this.config = {
      stickinessMs:
        overrides.stickinessMs ?? DEFAULT_MEDIAPIPE_CONFIG.stickinessMs,
      alternatingFrameCadence:
        overrides.alternatingFrameCadence ??
        DEFAULT_MEDIAPIPE_CONFIG.alternatingFrameCadence,
      warmupFrameCount:
        overrides.warmupFrameCount ?? DEFAULT_MEDIAPIPE_CONFIG.warmupFrameCount,
      face: {
        ...DEFAULT_MEDIAPIPE_CONFIG.face,
        ...(overrides.face ?? {}),
      },
      pose: {
        ...DEFAULT_MEDIAPIPE_CONFIG.pose,
        ...(overrides.pose ?? {}),
      },
    } satisfies MediapipeRuntimeConfig;

    logger.info("Initialising MediaPipe fileset", {
      assetBaseUrl: payload.assetBaseUrl,
    });

    try {
      const fileset = await FilesetResolver.forVisionTasks(
        payload.assetBaseUrl,
      );
      this.fileset = fileset;
      this.faceRuntime = await createFaceMeshRuntime(fileset, this.config.face);
      this.poseRuntime = await createPoseRuntime(fileset, this.config.pose);
      this.frameCounter = 0;
      this.metricProcessor = createMetricProcessor();
      this.scoringEnabled = payload.enableScoring === true;
      if (this.scoringEnabled) {
        const scoreConfig = getScoreConfig();
        this.scoreProcessor = new ScoreProcessor({
          alpha: scoreConfig.alpha,
          neutralScore: scoreConfig.neutralScore,
          weights: scoreConfig.weights,
        });
      } else {
        this.scoreProcessor = null;
      }
      this.presenceDetector.reset(performance.now());
      this.guardrails.reset();
      logger.info("MediaPipe models initialised", {
        faceModel: this.config.face.modelAssetPath,
        poseModel: this.config.pose.modelAssetPath,
        stickinessMs: this.config.stickinessMs,
        alternatingFrameCadence: this.config.alternatingFrameCadence,
        delegateFace: this.config.face.delegate,
        delegatePose: this.config.pose.delegate,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(JSON.stringify(error) || "Unknown error");
      logger.error("Failed to initialise MediaPipe pipeline", {
        error: message,
      });
      captureWorkerException(error);
      throw new Error(`Failed to initialise MediaPipe pipeline: ${message}`);
    }
  }

  private ensureRuntimes() {
    if (!this.faceRuntime || !this.poseRuntime) {
      throw new Error("MediaPipe pipeline invoked before initialisation");
    }
  }

  private shouldSampleFace(): boolean {
    const cadence = this.config.alternatingFrameCadence;
    if (!cadence || cadence <= 1) {
      return true;
    }
    return this.frameCounter % cadence === 0;
  }

  private shouldSamplePose(): boolean {
    const cadence = this.config.alternatingFrameCadence;
    if (!cadence || cadence <= 1) {
      return true;
    }
    // Offset pose sampling to alternate with face when cadence provided.
    return (this.frameCounter + Math.floor(cadence / 2)) % cadence === 0;
  }

  async processFrame(
    bitmap: ImageBitmap,
    metadata: FrameMetadata,
  ): Promise<DetectorResult<CombinedLandmarks>> {
    this.ensureRuntimes();
    this.frameCounter += 1;
    const inferenceStart = performance.now();

    const imageData = bitmapToImageData(bitmap);
    bitmap.close();

    const timestamp = metadata.capturedAt;

    let faceResult: FaceLandmarkerResult | null = null;
    let poseResult: PoseLandmarkerResult | null = null;

    const sampleFace = this.shouldSampleFace();
    const samplePose = this.shouldSamplePose();

    if (this.faceRuntime && sampleFace) {
      faceResult = this.faceRuntime.detect(imageData, timestamp);
    }

    if (this.poseRuntime && samplePose) {
      poseResult = this.poseRuntime.detect(imageData, timestamp);
    }

    let faceMultiple = false;
    let poseMultiple = false;

    if (sampleFace) {
      const previousFaceTrack = this.faceTrack;
      const { track, hadMultiple } = selectDominantTrack(
        faceResult?.faceLandmarks ?? [],
        undefined,
        faceResult?.facialTransformationMatrixes,
        timestamp,
        previousFaceTrack,
        this.config.stickinessMs,
      );

      if (track) {
        const confidence = computeFacePresenceConfidence(
          track,
          previousFaceTrack,
          hadMultiple,
        );
        this.faceTrack = {
          ...track,
          confidence,
        };
        this.facePresenceConfidence = confidence;
      } else {
        this.faceTrack = null;
        this.facePresenceConfidence = null;
      }
      faceMultiple = hadMultiple;
    } else if (this.faceTrack) {
      this.faceTrack = {
        ...this.faceTrack,
        updatedAt: timestamp,
      };
    }

    if (samplePose) {
      const { track, hadMultiple } = selectDominantTrack(
        poseResult?.landmarks ?? [],
        poseResult?.worldLandmarks,
        undefined,
        timestamp,
        this.poseTrack,
        this.config.stickinessMs,
      );
      this.poseTrack = track;
      poseMultiple = hadMultiple;
    } else if (this.poseTrack) {
      this.poseTrack = {
        ...this.poseTrack,
        updatedAt: timestamp,
      };
    }

    const { faceTrack } = this;
    const { poseTrack } = this;

    const faceLandmarks = toFaceLandmarks(faceTrack);
    const poseLandmarks = toPoseLandmarks(poseTrack);

    const processedAt = performance.now();

    const presenceFaceLandmarks =
      faceLandmarks && this.facePresenceConfidence !== null
        ? {
            ...faceLandmarks,
            confidence: this.facePresenceConfidence,
          }
        : (faceLandmarks ?? null);

    const presenceSnapshot = this.presenceDetector.update(
      {
        face: presenceFaceLandmarks,
        pose: poseLandmarks ?? null,
      },
      processedAt,
    );

    const reliability = resolveReliability(faceTrack, poseTrack);

    const combinedLandmarks: CombinedLandmarks = {
      frameId: metadata.id,
      capturedAt: metadata.capturedAt,
      processedAt,
      // Use presence-enriched face landmarks so downstream signal processors
      // see a stable confidence value for head-pose metrics.
      face: presenceFaceLandmarks ?? null,
      pose: poseLandmarks ?? null,
      presence:
        faceMultiple || poseMultiple
          ? ("MULTIPLE" as DetectionPresence)
          : presenceSnapshot.state,
      reliability,
    } satisfies CombinedLandmarks;

    const metrics = this.metricProcessor.update({
      frameId: metadata.id,
      timestamp: processedAt,
      landmarks: combinedLandmarks,
      imageWidth: imageData.width,
      imageHeight: imageData.height,
    });

    const yawValue =
      metrics.metrics.yaw.smoothed ?? metrics.metrics.yaw.raw ?? null;
    const rollValue =
      metrics.metrics.roll.smoothed ?? metrics.metrics.roll.raw ?? null;

    const faceConfidence =
      presenceSnapshot.faceConfidence ??
      combinedLandmarks.face?.confidence ??
      null;
    const poseConfidence =
      presenceSnapshot.poseConfidence ??
      combinedLandmarks.pose?.confidence ??
      null;
    // TODO: Wire a dedicated illumination signal when available.
    // To avoid double-counting face confidence, leave illumination undefined for guardrails.
    const illuminationConfidence = null;

    const guardrailEvaluation = this.guardrails.evaluate({
      timestamp: processedAt,
      yaw: yawValue,
      roll: rollValue,
      faceConfidence,
      poseConfidence,
      illuminationConfidence,
      detectionReliability: reliability,
    });

    if (
      guardrailEvaluation.reliability === "UNRELIABLE" &&
      guardrailEvaluation.reasons.length > 0 &&
      this.frameCounter % 30 === 0
    ) {
      logger.debug("Reliability guardrails triggered", {
        reasons: guardrailEvaluation.reasons,
        yaw: yawValue,
        roll: rollValue,
        faceConfidence,
        poseConfidence,
        illuminationConfidence,
        detectionReliability: reliability,
      });
    }

    const scoreInput = presenceSnapshot.state === "ABSENT" ? null : metrics;
    const score = this.scoreProcessor?.update(scoreInput, {
      reliability: guardrailEvaluation.reliability,
    });

    return {
      frameId: metadata.id,
      processedAt,
      durationMs: processedAt - inferenceStart,
      inference: combinedLandmarks,
      metrics,
      score,
      presence: presenceSnapshot,
      reliability: guardrailEvaluation.reliability,
      reliabilityReasons: guardrailEvaluation.reasons,
    };
  }

  async dispose(): Promise<void> {
    if (this.faceRuntime) {
      this.faceRuntime.dispose();
      this.faceRuntime = null;
    }
    if (this.poseRuntime) {
      this.poseRuntime.dispose();
      this.poseRuntime = null;
    }
    this.fileset = null;
    this.faceTrack = null;
    this.poseTrack = null;
    this.frameCounter = 0;
    this.scoreProcessor = null;
    this.scoringEnabled = false;
    this.presenceDetector.reset(performance.now());
  }
}

export type MediapipePipelineFactory = () => MediapipePipeline;

export const createMediapipePipeline: MediapipePipelineFactory = () => {
  return new MediapipePipeline();
};
