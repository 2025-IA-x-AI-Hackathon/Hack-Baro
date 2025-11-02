import type { DetectorKind } from "./detector";

export type PoseKeypoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  name?: string;
};

export type CalibrationBaselinePayload = {
  detector: DetectorKind;
  keypoints: PoseKeypoint[];
};

export type CalibrationBaselineRecord = CalibrationBaselinePayload & {
  id: number;
  createdAt: number;
};

export type CalibrationSensitivity = "low" | "medium" | "high" | "custom";

export type CalibrationThresholds = {
  pitch: number;
  ehd: number;
  dpr: number;
};

export type CalibrationBaselineMetrics = {
  baselinePitch: number;
  baselineEHD: number;
  baselineDPR: number;
};

export type CalibrationQualitySnapshot = {
  quality: number;
  sampleCount: number;
};

export type CalibrationCustomThresholds = Partial<CalibrationThresholds>;

export type PostureCalibrationPayload = CalibrationBaselineMetrics &
  CalibrationQualitySnapshot & {
    userId?: number;
    sensitivity?: CalibrationSensitivity;
    customThresholds?: CalibrationCustomThresholds | null;
    calibratedAt: number;
    isActive?: boolean;
  };

export type PostureCalibrationRecord = CalibrationBaselineMetrics &
  CalibrationQualitySnapshot & {
    id: number;
    userId: number;
    sensitivity: CalibrationSensitivity;
    customPitchThreshold: number | null;
    customEHDThreshold: number | null;
    customDPRThreshold: number | null;
    calibratedAt: number;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  };

export type CalibrationSample = {
  timestamp: number;
  pitch: number | null;
  ehd: number | null;
  dpr: number | null;
  confidence: number | null;
  reliability?: "OK" | "UNRELIABLE";
};

export type CalibrationProgressPhase =
  | "idle"
  | "collecting"
  | "validating"
  | "complete"
  | "failed";

export type CalibrationProgress = {
  phase: CalibrationProgressPhase;
  collectedSamples: number;
  targetSamples: number;
  stabilityScore: number;
  qualityScore: number | null;
  message?: string;
  acceptedSamples?: number;
  rejectedSamples?: number;
  rejectedLowConfidence?: number;
  rejectedUnreliable?: number;
  rejectedInvalid?: number;
  lastSampleConfidence?: number | null;
  elapsedMs?: number;
};

export type CalibrationValidationSuggestion =
  | "recalibrate_low_quality"
  | "recalibrate_unreliable"
  | "adjust_sensitivity"
  | "ok";

export type CalibrationValidationResult = {
  quality: number;
  unreliableFrameRatio: number;
  suggestion: CalibrationValidationSuggestion;
};

export type CalibrationProgressEvent = CalibrationProgress;

export type CalibrationFailureReason =
  | "insufficient_samples"
  | "low_quality"
  | "unreliable_detection"
  | "timeout"
  | "unknown";

export type CalibrationFailure = {
  reason: CalibrationFailureReason;
  message: string;
};

export type CalibrationSessionResult = {
  baseline: CalibrationBaselineMetrics & CalibrationQualitySnapshot;
  sensitivity: CalibrationSensitivity;
  customThresholds: CalibrationCustomThresholds | null;
  thresholds: CalibrationThresholds;
  validation: CalibrationValidationResult;
};

export type CalibrationStartRequest = {
  sensitivity?: CalibrationSensitivity;
  customThresholds?: CalibrationCustomThresholds | null;
  targetSamples?: number;
  minQuality?: number;
  validationDurationMs?: number;
};

export type CalibrationCompletePayload = CalibrationSessionResult & {
  calibrationId: number;
  recordedAt: number;
};

export type CalibrationSensitivityUpdateRequest = {
  calibrationId: number;
  sensitivity: CalibrationSensitivity;
  customThresholds?: CalibrationCustomThresholds | null;
};
