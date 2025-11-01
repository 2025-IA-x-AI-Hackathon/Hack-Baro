declare module "@mediapipe/tasks-vision" {
  export type Landmark = {
    x: number;
    y: number;
    z?: number;
    visibility?: number;
  };

  export type NormalizedLandmark = Landmark;

  export type Matrix = {
    data: readonly number[];
  };

  type FilesetResolver = {
    readonly __brand?: "FilesetResolver";
  };

  interface FilesetResolverStatic {
    forVisionTasks(
      baseUrl: string,
    ): Promise<FilesetResolver & { readonly __baseUrl?: typeof baseUrl }>;
  }

  export const FilesetResolver: FilesetResolverStatic;

  type BaseOptions = {
    modelAssetPath: string;
    delegate?: "CPU" | "GPU";
  };

  type PoseLandmarkerOptions = {
    baseOptions: BaseOptions;
    runningMode: "IMAGE" | "VIDEO";
    numPoses?: number;
    minPoseDetectionConfidence?: number;
    minPosePresenceConfidence?: number;
    minTrackingConfidence?: number;
    outputSegmentationMasks?: boolean;
  };

  export type PoseLandmarkerResult = {
    landmarks?: NormalizedLandmark[][];
    worldLandmarks?: Landmark[][];
    segmentationMasks?: ImageData[];
  };

  interface PoseLandmarker {
    detect(
      image: ImageData,
    ): PoseLandmarkerResult & { readonly __image?: typeof image };
    detectForVideo(
      image: ImageData,
      timestamp: number,
    ): PoseLandmarkerResult & { readonly __videoTimestamp?: typeof timestamp };
    close(): void;
  }

  interface PoseLandmarkerStatic {
    createFromOptions(
      filesetResolver: FilesetResolver,
      options: PoseLandmarkerOptions,
    ): Promise<
      PoseLandmarker & {
        readonly __args?: [typeof filesetResolver, typeof options];
      }
    >;
  }

  export const PoseLandmarker: PoseLandmarkerStatic;

  type FaceLandmarkerOptions = {
    baseOptions: BaseOptions;
    runningMode: "IMAGE" | "VIDEO";
    numFaces?: number;
    minFaceDetectionConfidence?: number;
    minFacePresenceConfidence?: number;
    minTrackingConfidence?: number;
    outputFacialTransformationMatrixes?: boolean;
  };

  export type FaceLandmarkerResult = {
    faceLandmarks?: NormalizedLandmark[][];
    facialTransformationMatrixes?: Matrix[];
  };

  interface FaceLandmarker {
    detect(
      image: ImageData,
    ): FaceLandmarkerResult & { readonly __image?: typeof image };
    detectForVideo(
      image: ImageData,
      timestamp: number,
    ): FaceLandmarkerResult & { readonly __videoTimestamp?: typeof timestamp };
    close(): void;
  }

  interface FaceLandmarkerStatic {
    createFromOptions(
      filesetResolver: FilesetResolver,
      options: FaceLandmarkerOptions,
    ): Promise<
      FaceLandmarker & {
        readonly __args?: [typeof filesetResolver, typeof options];
      }
    >;
  }

  export const FaceLandmarker: FaceLandmarkerStatic;
}
