import type {
  Detector,
  DetectorInitPayload,
  DetectorResult,
  FrameMetadata,
} from "../../shared/types/detector";
import type { CombinedLandmarks } from "../../shared/types/landmarks";
import { createMediapipePipeline } from "../mediapipe";

export class MediapipeDetector implements Detector {
  readonly name = "MediapipeDetector";

  private pipeline = createMediapipePipeline();

  async initialize(payload: DetectorInitPayload): Promise<void> {
    await this.pipeline.initialise(payload, {
      alternatingFrameCadence: payload.alternatingFrameCadence,
      face: {
        delegate: payload.delegate,
      },
      pose: {
        delegate: payload.delegate,
      },
    });
  }

  processFrame(
    frame: ImageBitmap,
    metadata: FrameMetadata,
  ): Promise<DetectorResult<CombinedLandmarks | null>> {
    return this.pipeline.processFrame(frame, metadata);
  }

  dispose(): Promise<void> {
    return this.pipeline.dispose();
  }
}

export const createMediapipeDetector = (): Detector => {
  return new MediapipeDetector();
};
