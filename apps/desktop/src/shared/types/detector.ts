export type DetectorKind = 'mediapipe' | 'onnx';

export type DetectorInitPayload = {
  kind: DetectorKind;
  targetFps: number;
  downscaleShortSide: number;
  assetBaseUrl: string;
};

export type FrameMetadata = {
  id: number;
  capturedAt: number;
};

export type DetectorResult = {
  frameId: number;
  processedAt: number;
  durationMs: number;
  inference?: unknown;
};

export type InitializeFn = (payload: DetectorInitPayload) => Promise<void>;
export type ProcessFrameFn = (
  frame: ImageBitmap,
  metadata: FrameMetadata,
) => Promise<DetectorResult>;
export type DisposeFn = () => Promise<void>;

export interface Detector {
  readonly name: string;
  initialize: InitializeFn;
  processFrame: ProcessFrameFn;
  dispose: DisposeFn;
}

export type DetectorFactory = () => Detector;
