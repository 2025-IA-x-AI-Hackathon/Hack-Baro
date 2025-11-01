import type { DetectorResult } from "../../shared/types/detector";
import type { EngineTick } from "../../shared/types/engine-output";
import type {
  EngineReliability,
  PresenceSnapshot,
  PresenceState,
} from "../../shared/types/engine-state";
import type { MetricValues } from "../../shared/types/metrics";
import type { ScoreSample } from "../../shared/types/score";
import {
  RiskDetector,
  type RiskDetectorUpdateInput,
  type RiskStateSnapshot,
} from "../detection";
import type { Calibration } from "../scoring/calculator";
import {
  RiskStateMachine as EngineStateMachine,
  type RiskStateMachineConfig as EngineStateMachineConfig,
  type RiskMachineSnapshot,
} from "../state-machine";
import { EngineOutputBuilder } from "./output-builder";
import type { EngineDiagnosticsInput, EngineTickBuildInput } from "./types";

type RiskDetectorLike = {
  update: (input: RiskDetectorUpdateInput) => RiskStateSnapshot;
};

export type EngineCoordinatorOptions = {
  /** Override default neutral score passed to the output builder. */
  neutralScore?: number;
  /** Optional pre-configured risk detector instance (primarily for tests). */
  riskDetector?: RiskDetectorLike;
  /** Optional state machine config overrides for envelope behaviour. */
  engineStateConfig?: EngineStateMachineConfig;
};

export type EngineCoordinatorUpdateInput = {
  result: DetectorResult;
  calibration?: Calibration | null;
  diagnostics?: EngineDiagnosticsInput | null;
};

export type EngineCoordinatorUpdateOutput = {
  tick: EngineTick;
  riskSnapshot: RiskStateSnapshot;
  engineSnapshot: RiskMachineSnapshot;
};

const createDefaultPresenceSnapshot = (
  timestamp: number,
  state: PresenceState,
): PresenceSnapshot => {
  return {
    state,
    consecutiveFrames: 0,
    lastStateChangeAt: timestamp,
    lastUpdatedAt: timestamp,
    faceConfidence: null,
    poseConfidence: null,
  };
};

const coercePresenceSnapshot = (
  presence: DetectorResult["presence"],
  fallbackTimestamp: number,
): PresenceSnapshot => {
  if (presence) {
    return presence;
  }
  return createDefaultPresenceSnapshot(fallbackTimestamp, "ABSENT");
};

const coerceMetrics = (
  metrics: DetectorResult["metrics"],
): MetricValues | null => {
  return metrics ?? null;
};

const coerceScore = (score: DetectorResult["score"]): ScoreSample | null => {
  return score ?? null;
};

const resolveReliability = (
  raw: DetectorResult["reliability"],
): EngineReliability => {
  if (raw === "UNRELIABLE") {
    return "UNRELIABLE";
  }
  return "OK";
};

export class EngineCoordinator {
  private readonly builder: EngineOutputBuilder;

  private readonly riskDetector: RiskDetectorLike;

  private readonly engineState: EngineStateMachine;

  private calibration: Calibration | null = null;

  constructor(options: EngineCoordinatorOptions = {}) {
    this.builder = new EngineOutputBuilder({
      neutralScore: options.neutralScore,
    });
    this.riskDetector = options.riskDetector ?? new RiskDetector();
    this.engineState = new EngineStateMachine(options.engineStateConfig);
  }

  reset(): void {
    this.builder.reset();
  }

  update(input: EngineCoordinatorUpdateInput): EngineCoordinatorUpdateOutput {
    const { result, calibration, diagnostics } = input;
    const timestamp = Number.isFinite(result.processedAt)
      ? result.processedAt
      : Date.now();

    if (calibration !== undefined) {
      this.calibration = calibration ?? null;
    }

    const presenceSnapshot = coercePresenceSnapshot(result.presence, timestamp);
    const metrics = coerceMetrics(result.metrics);
    const score = coerceScore(result.score);
    const reliability = resolveReliability(result.reliability);

    const shouldFreezeRisk =
      presenceSnapshot.state === "ABSENT" || reliability === "UNRELIABLE";

    const riskSnapshot = this.riskDetector.update({
      metrics,
      calibration: this.calibration,
      timestamp,
      freeze: shouldFreezeRisk,
    });

    const engineSnapshot = this.engineState.advance({
      timestamp,
      presence: presenceSnapshot,
      recommendedState: riskSnapshot.state,
      reliability,
    });

    const tickInput: EngineTickBuildInput = {
      timestamp,
      metrics,
      score,
      presence: presenceSnapshot,
      risk: engineSnapshot,
      reliability,
      diagnostics,
    };

    const tick = this.builder.build(tickInput);

    return {
      tick,
      riskSnapshot,
      engineSnapshot,
    };
  }
}
