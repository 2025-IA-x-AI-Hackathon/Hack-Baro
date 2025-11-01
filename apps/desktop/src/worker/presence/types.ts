import type {
  FaceLandmarks,
  PoseLandmarks,
} from "../../shared/types/landmarks";

export type {
  PresenceSnapshot,
  PresenceState,
} from "../../shared/types/engine-state";

export type PresenceThresholds = {
  faceConfidence: number;
  poseConfidence: number;
  poseVisibility: number;
  presentConsecutiveFrames: number;
  absentConsecutiveFrames: number;
};

export type PresenceConfig = Partial<PresenceThresholds> & {
  requireHips?: boolean;
};

export type PresenceInputs = {
  face: FaceLandmarks | null;
  pose: PoseLandmarks | null;
};

export const DEFAULT_PRESENCE_THRESHOLDS: PresenceThresholds = {
  faceConfidence: 0.4,
  poseConfidence: 0.4,
  poseVisibility: 0.25,
  presentConsecutiveFrames: 5,
  absentConsecutiveFrames: 10,
};

// Landmarks indices based on MediaPipe documentation (https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker?hl=ko)
export const MEDIAPIPE_POSE_LANDMARKER_NOSE = 0;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_EYE_INNER = 1;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_EYE = 2;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_EYE_OUTER = 3;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_EYE_INNER = 4;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_EYE = 5;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_EYE_OUTER = 6;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_EAR = 7;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_EAR = 8;
export const MEDIAPIPE_POSE_LANDMARKER_MOUTH_LEFT = 9;
export const MEDIAPIPE_POSE_LANDMARKER_MOUTH_RIGHT = 10;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_SHOULDER = 11;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_SHOULDER = 12;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_ELBOW = 13;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_ELBOW = 14;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_WRIST = 15;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_WRIST = 16;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_PINKY = 17;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_PINKY = 18;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_INDEX = 19;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_INDEX = 20;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_THUMB = 21;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_THUMB = 22;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_HIP = 23;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_HIP = 24;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_KNEE = 25;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_KNEE = 26;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_ANKLE = 27;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_ANKLE = 28;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_HEEL = 29;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_HEEL = 30;
export const MEDIAPIPE_POSE_LANDMARKER_LEFT_FOOT_INDEX = 31;
export const MEDIAPIPE_POSE_LANDMARKER_RIGHT_FOOT_INDEX = 32;

export const DEFAULT_REQUIRED_LANDMARKS = [
  MEDIAPIPE_POSE_LANDMARKER_LEFT_SHOULDER,
  MEDIAPIPE_POSE_LANDMARKER_RIGHT_SHOULDER,
] as const;
