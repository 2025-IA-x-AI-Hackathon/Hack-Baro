import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_ASSETS } from '../../shared/detection/mediapipeAssets.mjs';
import type {
  Detector,
  DetectorInitPayload,
  DetectorResult,
  FrameMetadata,
} from '../../shared/types/detector';

type PoseLandmarkerInstance = Pick<
  Awaited<ReturnType<typeof PoseLandmarker.createFromOptions>>,
  'detect' | 'close'
>;

const bitmapToImageData = (bitmap: ImageBitmap) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error(
      'Unable to get context to convert ImageBitmap to ImageData',
    );
  }

  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
};

export class MediapipeDetector implements Detector {
  readonly name = 'MediapipeDetector';

  private landmarker: PoseLandmarkerInstance | null = null;

  async initialize(payload: DetectorInitPayload): Promise<void> {
    const baseUrl = payload.assetBaseUrl || MEDIAPIPE_ASSETS.baseUrl;
    const modelAssetPath = payload.assetBaseUrl
      ? `${baseUrl}/pose_landmarker_lite.task`
      : MEDIAPIPE_ASSETS.model;

    const filesetResolver = await FilesetResolver.forVisionTasks(baseUrl);

    const instance = await PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath,
      },
      runningMode: 'IMAGE',
      numPoses: 1,
    });

    this.landmarker = instance as PoseLandmarkerInstance;
  }

  processFrame(
    frame: ImageBitmap,
    metadata: FrameMetadata,
  ): Promise<DetectorResult> {
    if (!this.landmarker) {
      throw new Error('MediapipeDetector is not initialised');
    }

    const inferenceStart = performance.now();
    const imageData = bitmapToImageData(frame);

    const result = this.landmarker.detect(imageData);
    const inferenceEnd = performance.now();

    frame.close();

    return Promise.resolve({
      frameId: metadata.id,
      processedAt: inferenceEnd,
      durationMs: inferenceEnd - inferenceStart,
      inference: result,
    });
  }

  dispose(): Promise<void> {
    this.landmarker?.close();
    this.landmarker = null;
    return Promise.resolve();
  }
}

export const createMediapipeDetector = (): Detector => {
  return new MediapipeDetector();
};
