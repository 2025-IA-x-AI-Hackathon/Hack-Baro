import { MEDIAPIPE_ASSETS } from "../../shared/detection/mediapipeAssets.mjs";

export type MediapipeFaceConfig = {
  modelAssetPath: string;
  numFaces: number;
  minFaceDetectionConfidence: number;
  minFacePresenceConfidence: number;
  minTrackingConfidence: number;
  enableTransformationMatrix: boolean;
  delegate: "CPU" | "GPU";
};

export type MediapipePoseConfig = {
  modelAssetPath: string;
  numPoses: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
  delegate: "CPU" | "GPU";
};

export type MediapipeRuntimeConfig = {
  stickinessMs: number;
  alternatingFrameCadence: number;
  warmupFrameCount: number;
  face: MediapipeFaceConfig;
  pose: MediapipePoseConfig;
};

export const DEFAULT_MEDIAPIPE_CONFIG: MediapipeRuntimeConfig = {
  stickinessMs: 3000,
  alternatingFrameCadence: 0,
  warmupFrameCount: 5,
  face: {
    modelAssetPath: MEDIAPIPE_ASSETS.faceModel,
    numFaces: 1,
    minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
    enableTransformationMatrix: true,
    delegate: "GPU",
  },
  pose: {
    modelAssetPath: MEDIAPIPE_ASSETS.poseModel,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    delegate: "GPU",
  },
};
