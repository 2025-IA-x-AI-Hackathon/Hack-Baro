declare module "@mediapipe/tasks-vision" {
  type FilesetResolver = {
    readonly __brand?: "FilesetResolver";
  };

  interface FilesetResolverStatic {
    forVisionTasks(
      baseUrl: string,
    ): Promise<FilesetResolver & { readonly __baseUrl?: typeof baseUrl }>;
  }

  export const FilesetResolver: FilesetResolverStatic;

  type PoseLandmarkerOptions = {
    baseOptions: {
      modelAssetPath: string;
    };
    runningMode: "IMAGE" | "VIDEO";
    numPoses?: number;
  };

  type PoseLandmarkerResult = {
    readonly __brand?: "PoseLandmarkerResult";
  };

  interface PoseLandmarker {
    detect(
      image: ImageData,
    ): PoseLandmarkerResult & { readonly __image?: typeof image };
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
}
