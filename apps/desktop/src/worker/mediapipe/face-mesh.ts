import {
  FaceLandmarker,
  type FaceLandmarkerResult,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import type { MediapipeFaceConfig } from "../config/mediapipe-config";

export type FaceMeshRuntime = {
  landmarker: FaceLandmarker;
  detect: (image: ImageData, timestamp: number) => FaceLandmarkerResult;
  dispose: () => void;
};

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export const createFaceMeshRuntime = async (
  filesetResolver: VisionFileset,
  config: MediapipeFaceConfig,
): Promise<FaceMeshRuntime> => {
  const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: config.modelAssetPath,
      delegate: config.delegate,
    },
    runningMode: "VIDEO",
    numFaces: config.numFaces,
    minFaceDetectionConfidence: config.minFaceDetectionConfidence,
    minFacePresenceConfidence: config.minFacePresenceConfidence,
    minTrackingConfidence: config.minTrackingConfidence,
    outputFacialTransformationMatrixes: config.enableTransformationMatrix,
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
