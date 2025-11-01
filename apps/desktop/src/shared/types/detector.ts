import type { EngineReliability, PresenceSnapshot } from "./engine-state";
import type { GuardrailOverrides, ReliabilityReason } from "./guardrails";
import type { CombinedLandmarks } from "./landmarks";
import type { MetricValues } from "./metrics";
import type { ScoreSample } from "./score";

export type DetectorDelegate = "CPU" | "GPU";

export type DetectorKind = "mediapipe" | "onnx";

export type DetectorInitPayload = {
  kind: DetectorKind;
  targetFps: number;
  downscaleShortSide: number;
  assetBaseUrl: string;
  delegate: DetectorDelegate;
  alternatingFrameCadence: number;
  enableScoring?: boolean;
  guardrailOverrides?: GuardrailOverrides;
  debugGuardrailsVerbose?: boolean;
};

export type FrameMetadata = {
  id: number;
  capturedAt: number;
};

export type DetectorResult<TInference = CombinedLandmarks | null> = {
  frameId: number;
  processedAt: number;
  durationMs: number;
  inference?: TInference;
  metrics?: MetricValues;
  score?: ScoreSample;
  presence?: PresenceSnapshot;
  reliability?: EngineReliability;
  reliabilityReasons?: readonly ReliabilityReason[];
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
