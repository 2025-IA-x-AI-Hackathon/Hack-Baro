import {
  getEnvVar,
  parseNumericEnv,
  parseOptionalBoolean,
} from "../../shared/env";
import { resolveTimestamp } from "../../shared/time";
import type { PoseLandmarks } from "../../shared/types/landmarks";
import {
  DEFAULT_PRESENCE_THRESHOLDS,
  DEFAULT_REQUIRED_LANDMARKS,
  MEDIAPIPE_POSE_LANDMARKER_LEFT_HIP,
  MEDIAPIPE_POSE_LANDMARKER_LEFT_SHOULDER,
  MEDIAPIPE_POSE_LANDMARKER_RIGHT_HIP,
  MEDIAPIPE_POSE_LANDMARKER_RIGHT_SHOULDER,
  type PresenceConfig,
  type PresenceInputs,
  type PresenceSnapshot,
  type PresenceState,
  type PresenceThresholds,
} from "./types";

const resolveRequiredLandmarks = (requireHips: boolean): readonly number[] => {
  if (requireHips) {
    return [
      MEDIAPIPE_POSE_LANDMARKER_LEFT_SHOULDER,
      MEDIAPIPE_POSE_LANDMARKER_RIGHT_SHOULDER,
      MEDIAPIPE_POSE_LANDMARKER_LEFT_HIP,
      MEDIAPIPE_POSE_LANDMARKER_RIGHT_HIP,
    ] as const;
  }
  return DEFAULT_REQUIRED_LANDMARKS;
};

const resolvePresenceEnvConfig = (): {
  thresholds: Partial<PresenceThresholds>;
  requireHips: boolean | null;
} => {
  const thresholds: Partial<PresenceThresholds> = {};

  const face =
    parseNumericEnv(getEnvVar("POSELY_PRESENCE_FACE_THRESHOLD"), {
      min: 0,
      max: 1,
    }) ?? null;
  if (face !== null) {
    thresholds.faceConfidence = face;
  }

  const pose =
    parseNumericEnv(getEnvVar("POSELY_PRESENCE_POSE_THRESHOLD"), {
      min: 0,
      max: 1,
    }) ?? null;
  if (pose !== null) {
    thresholds.poseConfidence = pose;
  }

  const visibility =
    parseNumericEnv(getEnvVar("POSELY_PRESENCE_VISIBILITY_THRESHOLD"), {
      min: 0,
      max: 1,
    }) ?? null;
  if (visibility !== null) {
    thresholds.poseVisibility = visibility;
  }

  const presentFrames =
    parseNumericEnv(getEnvVar("POSELY_PRESENCE_PRESENT_FRAMES"), {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    }) ?? null;
  if (presentFrames !== null) {
    thresholds.presentConsecutiveFrames = presentFrames;
  }

  const absentFrames =
    parseNumericEnv(getEnvVar("POSELY_PRESENCE_ABSENT_FRAMES"), {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    }) ?? null;
  if (absentFrames !== null) {
    thresholds.absentConsecutiveFrames = absentFrames;
  }

  const requireHips = parseOptionalBoolean(
    getEnvVar("POSELY_PRESENCE_REQUIRE_HIPS"),
  );

  return {
    thresholds,
    requireHips,
  };
};

const toFiniteOrNull = (value: unknown): number | null => {
  if (typeof value !== "number") {
    return null;
  }
  return Number.isFinite(value) ? value : null;
};

const hasUpperBodyVisibility = (
  pose: PoseLandmarks | null,
  minimumVisibility: number,
  requiredLandmarks: readonly number[],
): boolean => {
  if (!pose?.landmarks) {
    return false;
  }

  return requiredLandmarks.every((index) => {
    const landmark = pose.landmarks[index];
    if (!landmark) {
      return false;
    }
    const visibility =
      typeof landmark.visibility === "number" ? landmark.visibility : 1;
    return Number.isFinite(visibility) && visibility >= minimumVisibility;
  });
};

export class PresenceDetector {
  private thresholds: PresenceThresholds;

  private requiredLandmarks: readonly number[];

  private state: PresenceState = "ABSENT";

  private stateEnteredAt = 0;

  private lastUpdatedAt = 0;

  private presentStreak = 0;

  private absentStreak = 0;

  private snapshot: PresenceSnapshot = {
    state: "ABSENT",
    consecutiveFrames: 0,
    lastStateChangeAt: 0,
    lastUpdatedAt: 0,
    faceConfidence: null,
    poseConfidence: null,
  };

  constructor(config?: PresenceConfig) {
    const envConfig = resolvePresenceEnvConfig();
    const { requireHips: requireHipsConfig, ...thresholdOverrides } =
      config ?? {};
    this.thresholds = {
      ...DEFAULT_PRESENCE_THRESHOLDS,
      ...envConfig.thresholds,
      ...thresholdOverrides,
    };
    const requireHipsOverride =
      typeof requireHipsConfig === "boolean" ? requireHipsConfig : null;
    const requireHips = requireHipsOverride ?? envConfig.requireHips ?? false;
    this.requiredLandmarks = resolveRequiredLandmarks(requireHips);
    this.reset();
  }

  update(inputs: PresenceInputs, timestamp?: number): PresenceSnapshot {
    const resolvedTimestamp = resolveTimestamp(timestamp);
    const faceConfidence = toFiniteOrNull(inputs.face?.confidence);
    const poseConfidence = toFiniteOrNull(inputs.pose?.confidence);

    const faceDetected =
      faceConfidence !== null &&
      faceConfidence >= this.thresholds.faceConfidence;
    const poseDetected =
      poseConfidence !== null &&
      poseConfidence >= this.thresholds.poseConfidence &&
      hasUpperBodyVisibility(
        inputs.pose,
        this.thresholds.poseVisibility,
        this.requiredLandmarks,
      );

    const frameIndicatesPresence = faceDetected || poseDetected;

    if (frameIndicatesPresence) {
      this.presentStreak += 1;
      this.absentStreak = 0;
    } else {
      this.absentStreak += 1;
      this.presentStreak = 0;
    }

    if (this.state === "ABSENT" && frameIndicatesPresence) {
      if (this.presentStreak >= this.thresholds.presentConsecutiveFrames) {
        this.state = "PRESENT";
        this.stateEnteredAt = resolvedTimestamp;
      }
    } else if (this.state === "PRESENT" && !frameIndicatesPresence) {
      if (this.absentStreak >= this.thresholds.absentConsecutiveFrames) {
        this.state = "ABSENT";
        this.stateEnteredAt = resolvedTimestamp;
      }
    }

    this.lastUpdatedAt = resolvedTimestamp;
    const consecutiveFrames =
      this.state === "PRESENT" ? this.presentStreak : this.absentStreak;

    this.snapshot = {
      state: this.state,
      consecutiveFrames,
      lastStateChangeAt: this.stateEnteredAt,
      lastUpdatedAt: this.lastUpdatedAt,
      faceConfidence,
      poseConfidence,
    };

    return this.snapshot;
  }

  getSnapshot(): PresenceSnapshot {
    return this.snapshot;
  }

  getState(): PresenceState {
    return this.snapshot.state;
  }

  reset(timestamp?: number): void {
    const resolvedTimestamp = resolveTimestamp(timestamp);
    this.state = "ABSENT";
    this.stateEnteredAt = resolvedTimestamp;
    this.lastUpdatedAt = resolvedTimestamp;
    this.presentStreak = 0;
    this.absentStreak = 0;
    this.snapshot = {
      state: "ABSENT",
      consecutiveFrames: 0,
      lastStateChangeAt: this.stateEnteredAt,
      lastUpdatedAt: this.lastUpdatedAt,
      faceConfidence: null,
      poseConfidence: null,
    };
  }

  setConfig(config: PresenceConfig): void {
    const { requireHips, ...thresholdOverrides } = config;
    if (typeof requireHips === "boolean") {
      this.requiredLandmarks = resolveRequiredLandmarks(requireHips);
    }
    this.thresholds = {
      ...this.thresholds,
      ...thresholdOverrides,
    };
  }
}

export const createPresenceDetector = (
  config?: PresenceConfig,
): PresenceDetector => {
  return new PresenceDetector(config);
};
