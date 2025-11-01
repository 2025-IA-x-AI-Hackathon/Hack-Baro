import type { DetectorResult } from "./detector";

// Placeholder types for future Epic 4 implementation
// TODO: Move these to proper files when implementing engine scoring
export type Calibration = {
  id: number;
  detector: string;
  keypoints: unknown[];
  createdAt: number;
};

export type EngineTick = {
  t: number;
  presence: "PRESENT" | "ABSENT";
  reliability: "OK" | "UNRELIABLE";
  metrics: {
    pitchDeg: number;
    ehdNorm: number;
    dpr: number;
    conf: number;
  };
  score: number;
  zone: "GREEN" | "YELLOW" | "RED";
  state:
    | "INITIAL"
    | "GOOD"
    | "AT_RISK"
    | "BAD_POSTURE"
    | "RECOVERING"
    | "IDLE"
    | "UNRELIABLE";
  diagnostics?: {
    inputWidth?: number;
    fps?: number;
    dominantTrackId?: string;
  };
};

export type EngineFrameResult = Pick<
  DetectorResult,
  "frameId" | "processedAt" | "durationMs"
>;

export type EngineFrameDiagnostics = {
  inputWidth?: number;
  frameIntervalMs?: number;
  fps?: number;
};

export type EngineFramePayload = {
  result: EngineFrameResult;
  calibration?: Calibration | null;
  diagnostics?: EngineFrameDiagnostics | null;
};

export type EngineTickPayload = {
  tick: EngineTick;
  // Future extensions can include risk snapshots or metadata.
};
