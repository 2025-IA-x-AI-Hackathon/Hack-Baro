import { resolveTimestamp } from "../../shared/time";
import type { CoreRiskState } from "../../shared/types/engine-state";
import type { MetricValues } from "../../shared/types/metrics";
import {
  DEFAULT_MAX_DELTA_SECONDS,
  type RiskDetectionConfig,
  cloneRiskConfig,
} from "../config/detection-config";
import type { Calibration } from "../scoring/calculator";
import { type RiskAssessment, RiskEvaluator } from "./risk-evaluator";

export type RiskStateMachineOptions = {
  config: RiskDetectionConfig;
  evaluator?: RiskEvaluator;
  onTransition?: (event: RiskTransitionEvent) => void;
};

export type RiskUpdateInput = {
  metrics: MetricValues | null | undefined;
  calibration: Calibration | null | undefined;
  timestamp?: number;
  freeze?: boolean;
};

export type RiskStateSnapshot = {
  state: CoreRiskState;
  timeInConditions: number;
  timeInRecovery: number;
  lastUpdatedAt: number;
  lastStateChangeAt: number;
  assessment: RiskAssessment;
};

export type RiskTransitionEvent = {
  from: CoreRiskState;
  to: CoreRiskState;
  timestamp: number;
  snapshot: RiskStateSnapshot;
};

const createInitialAssessment = (): RiskAssessment => ({
  timestamp: null,
  pitch: null,
  ehd: null,
  dpr: null,
  pitchDeviation: null,
  ehdDeviation: null,
  dprDeviation: null,
  pitchThreshold: 0,
  ehdThreshold: 0,
  dprThreshold: 0,
  pitchRecoveryThreshold: 0,
  ehdRecoveryThreshold: 0,
  dprRecoveryThreshold: 0,
  conditionsMet: false,
  recoveryConditionsMet: false,
  signalsAvailable: 0,
  insufficientSignals: true,
  degeneratePose: false,
  missingCalibration: true,
  baselinePending: false,
  shouldHold: true,
  reasons: ["missing-calibration"],
});

export class RiskStateMachine {
  private config: RiskDetectionConfig;

  private evaluator: RiskEvaluator;

  private state: CoreRiskState = "GOOD";

  private lastUpdatedAt: number;

  private lastStateChangeAt: number;

  private timeInConditions = 0;

  private timeInRecovery = 0;

  private assessment: RiskAssessment;

  private readonly onTransition?: (event: RiskTransitionEvent) => void;

  constructor(options: RiskStateMachineOptions) {
    this.config = cloneRiskConfig(options.config);
    this.evaluator =
      options.evaluator ?? new RiskEvaluator(cloneRiskConfig(options.config));
    this.lastUpdatedAt = 0;
    this.lastStateChangeAt = 0;
    this.assessment = createInitialAssessment();
    this.onTransition = options.onTransition;
  }

  updateConfig(config: RiskDetectionConfig): void {
    this.config = cloneRiskConfig(config);
    this.evaluator.updateConfig(config);
  }

  update(input: RiskUpdateInput): RiskStateSnapshot {
    let timestamp = resolveTimestamp(
      input.timestamp ?? input.metrics?.timestamp,
    );
    if (!Number.isFinite(timestamp)) {
      timestamp = this.lastUpdatedAt !== 0 ? this.lastUpdatedAt : Date.now();
    }
    const previousUpdatedAt =
      this.lastUpdatedAt !== 0 && Number.isFinite(this.lastUpdatedAt)
        ? this.lastUpdatedAt
        : timestamp;
    let deltaSeconds = (timestamp - previousUpdatedAt) / 1000;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      deltaSeconds = 0;
    }
    const { triggerSeconds, recoverySeconds, maxDeltaSeconds } =
      this.config.timings;
    const maxDelta =
      typeof maxDeltaSeconds === "number" && Number.isFinite(maxDeltaSeconds)
        ? maxDeltaSeconds
        : DEFAULT_MAX_DELTA_SECONDS;
    deltaSeconds = Math.min(deltaSeconds, maxDelta);

    const baseAssessment = this.evaluator.assess({
      metrics: input.metrics,
      calibration: input.calibration,
    });

    const reasons = [...baseAssessment.reasons];
    let { shouldHold } = baseAssessment;
    if (input.freeze) {
      shouldHold = true;
      reasons.push("engine-freeze");
    }

    const assessment: RiskAssessment = {
      ...baseAssessment,
      shouldHold,
      reasons,
    };

    if (shouldHold) {
      this.assessment = assessment;
      this.lastUpdatedAt = timestamp;
      return this.getSnapshot();
    }

    let nextState: CoreRiskState = this.state;
    let { timeInConditions, timeInRecovery } = this;

    if (this.state === "GOOD") {
      timeInRecovery = 0;
      if (assessment.conditionsMet) {
        nextState = "AT_RISK";
        timeInConditions = Math.min(
          timeInConditions + deltaSeconds,
          triggerSeconds,
        );
      } else {
        timeInConditions = 0;
      }
    } else if (this.state === "AT_RISK") {
      timeInRecovery = 0;
      if (!assessment.conditionsMet) {
        nextState = "GOOD";
        timeInConditions = 0;
      } else {
        timeInConditions = Math.min(
          timeInConditions + deltaSeconds,
          triggerSeconds,
        );
        if (timeInConditions >= triggerSeconds) {
          nextState = "BAD_POSTURE";
          timeInConditions = triggerSeconds;
          timeInRecovery = 0;
        }
      }
    } else if (this.state === "BAD_POSTURE") {
      if (assessment.conditionsMet) {
        timeInConditions = triggerSeconds;
        timeInRecovery = 0;
      } else if (assessment.recoveryConditionsMet) {
        timeInConditions = 0;
        timeInRecovery = Math.min(
          timeInRecovery + deltaSeconds,
          recoverySeconds,
        );
        if (timeInRecovery >= recoverySeconds) {
          nextState = "GOOD";
          timeInConditions = 0;
          timeInRecovery = 0;
        } else {
          nextState = "RECOVERING";
        }
      } else {
        nextState = "AT_RISK";
        timeInConditions = 0;
        timeInRecovery = 0;
      }
    } else if (this.state === "RECOVERING") {
      if (assessment.conditionsMet) {
        // Instead of jumping to BAD_POSTURE, go to AT_RISK and accumulate timeInConditions()
        nextState = "AT_RISK";
        timeInConditions = Math.min(
          triggerSeconds,
          timeInConditions + deltaSeconds,
        );
        timeInRecovery = 0;
      } else if (assessment.recoveryConditionsMet) {
        timeInRecovery = Math.min(
          timeInRecovery + deltaSeconds,
          recoverySeconds,
        );
        if (timeInRecovery >= recoverySeconds) {
          nextState = "GOOD";
          timeInConditions = 0;
          timeInRecovery = 0;
        }
      } else {
        nextState = "AT_RISK";
        timeInConditions = 0;
        timeInRecovery = 0;
      }
    }

    const previousState = this.state;

    this.state = nextState;
    this.timeInConditions = Math.max(0, timeInConditions);
    this.timeInRecovery = Math.max(0, timeInRecovery);
    this.lastUpdatedAt = timestamp;
    this.assessment = assessment;

    if (previousState !== nextState) {
      this.lastStateChangeAt = timestamp;
      this.onTransition?.({
        from: previousState,
        to: nextState,
        timestamp,
        snapshot: this.getSnapshot(),
      });
    }

    return this.getSnapshot();
  }

  getSnapshot(): RiskStateSnapshot {
    const assessmentClone: RiskAssessment = {
      ...this.assessment,
      reasons: [...this.assessment.reasons],
    };
    return {
      state: this.state,
      timeInConditions: this.timeInConditions,
      timeInRecovery: this.timeInRecovery,
      lastUpdatedAt: this.lastUpdatedAt,
      lastStateChangeAt: this.lastStateChangeAt,
      assessment: assessmentClone,
    };
  }
}
