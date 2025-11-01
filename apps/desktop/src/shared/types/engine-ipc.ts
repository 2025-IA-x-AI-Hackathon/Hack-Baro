import type { Calibration } from "../../worker/scoring/calculator";
import type { DetectorResult } from "./detector";
import type { EngineTick } from "./engine-output";

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

export type EngineFrameResult = Pick<
  DetectorResult,
  | "frameId"
  | "processedAt"
  | "durationMs"
  | "metrics"
  | "score"
  | "presence"
  | "reliability"
  | "reliabilityReasons"
>;
