import type { EngineDiagnostics } from "../../shared/types/engine-output";
import type {
  EngineReliability,
  PresenceSnapshot,
} from "../../shared/types/engine-state";
import type { MetricValues } from "../../shared/types/metrics";
import type { ScoreSample } from "../../shared/types/score";
import type { RiskMachineSnapshot } from "../state-machine";

export type EngineDiagnosticsInput = EngineDiagnostics & {
  /** Optional frame interval used to derive FPS if explicit fps not supplied. */
  frameIntervalMs?: number;
};

export type EngineTickBuildInput = {
  timestamp: number;
  metrics: MetricValues | null | undefined;
  score: ScoreSample | null | undefined;
  presence: PresenceSnapshot | null | undefined;
  risk: RiskMachineSnapshot | null | undefined;
  reliability?: EngineReliability;
  diagnostics?: EngineDiagnosticsInput | null;
};
