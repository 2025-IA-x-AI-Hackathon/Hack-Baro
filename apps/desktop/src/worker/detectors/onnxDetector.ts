import type {
  Detector,
  DetectorInitPayload,
  DetectorResult,
  FrameMetadata,
} from "../../shared/types/detector";

export class OnnxDetector implements Detector {
  readonly name = "OnnxDetector";

  // Placeholder for ONNX Runtime Web session
  private initialized = false;

  private initPayload: DetectorInitPayload | null = null;

  initialize(payload: DetectorInitPayload): Promise<void> {
    this.initialized = true;
    this.initPayload = payload;
    return Promise.resolve();
  }

  processFrame(
    frame: ImageBitmap,
    metadata: FrameMetadata,
  ): Promise<DetectorResult> {
    if (!this.initialized) {
      throw new Error("OnnxDetector has not been initialized");
    }

    const start = performance.now();
    // Placeholder stub - no inference yet
    frame.close();
    const end = performance.now();

    return Promise.resolve({
      frameId: metadata.id,
      processedAt: end,
      durationMs: end - start,
      inference: null,
    });
  }

  dispose(): Promise<void> {
    this.initialized = false;
    this.initPayload = null;
    return Promise.resolve();
  }
}

export const createOnnxDetector = (): Detector => new OnnxDetector();
