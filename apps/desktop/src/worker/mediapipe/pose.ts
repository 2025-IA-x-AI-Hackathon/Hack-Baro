import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { MediapipePoseConfig } from "../config/mediapipe-config";

export type PoseRuntime = {
  landmarker: PoseLandmarker;
  detect: (image: ImageData, timestamp: number) => PoseLandmarkerResult;
  dispose: () => void;
};

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export const createPoseRuntime = async (
  filesetResolver: VisionFileset,
  config: MediapipePoseConfig,
): Promise<PoseRuntime> => {
  const landmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: config.modelAssetPath,
      delegate: config.delegate,
    },
    runningMode: "VIDEO",
    numPoses: config.numPoses,
    minPoseDetectionConfidence: config.minPoseDetectionConfidence,
    minPosePresenceConfidence: config.minPosePresenceConfidence,
    minTrackingConfidence: config.minTrackingConfidence,
    outputSegmentationMasks: false,
  });

  return {
    landmarker,
    detect: (image: ImageData, timestamp: number) => {
      return landmarker.detectForVideo(image, timestamp);
    },
    dispose: () => {
      landmarker.close();
    },
  };
};
