import { getMonotonicTime, resolveTimestamp } from "../../shared/time";
import type {
  CoreRiskState,
  EngineReliability,
  PresenceState,
  RiskState,
  RiskTimers,
} from "../../shared/types/engine-state";
import { isFiniteNumber } from "../../shared/validation/metricValues";
import type { PresenceSnapshot } from "../presence/types";

export type RiskStateMachineConfig = {
  absenceToIdleMs?: number;
  presenceResumeMs?: number;
  sleepAfterAbsenceMs?: number;
  resumeBoostMs?: number;
};

type RequiredConfig = Required<RiskStateMachineConfig>;

export type RiskMachineSnapshot = {
  state: RiskState;
  presence: PresenceState;
  lastUpdatedAt: number;
  stateChangedAt: number;
  timers: RiskTimers;
  reliability: EngineReliability;
  absenceDurationMs: number;
  presenceDurationMs: number;
  shouldSleep: boolean;
  shouldBoost: boolean;
};

export type RiskEvaluationInput = {
  timestamp: number;
  presence: PresenceSnapshot;
  recommendedState?: CoreRiskState;
  reliability?: EngineReliability;
};

const DEFAULT_CONFIG: RequiredConfig = {
  absenceToIdleMs: 5000,
  presenceResumeMs: 2000,
  sleepAfterAbsenceMs: 60000,
  resumeBoostMs: 4000,
};

const clampTimers = (timers: RiskTimers): RiskTimers => {
  return {
    good: Math.max(0, timers.good),
    atRisk: Math.max(0, timers.atRisk),
    badPosture: Math.max(0, timers.badPosture),
  };
};

const cloneTimers = (timers: RiskTimers): RiskTimers => {
  return {
    good: timers.good,
    atRisk: timers.atRisk,
    badPosture: timers.badPosture,
  };
};

export class RiskStateMachine {
  private config: RequiredConfig;

  private state: RiskState = "INITIAL";

  private presenceState: PresenceState = "ABSENT";

  private stateChangedAt = 0;

  private presenceChangedAt = 0;

  private lastUpdatedAt = 0;

  private timers: RiskTimers = {
    good: 0,
    atRisk: 0,
    badPosture: 0,
  };

  private resumeBoostUntil = 0;

  private reliability: EngineReliability = "OK";

  constructor(config?: RiskStateMachineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
    this.reset();
  }

  advance(input: RiskEvaluationInput): RiskMachineSnapshot {
    const timestamp = resolveTimestamp(input.timestamp);
    if (this.lastUpdatedAt === 0) {
      this.lastUpdatedAt = timestamp;
    }
    const deltaMs = Math.max(0, timestamp - this.lastUpdatedAt);

    this.reliability = input.reliability ?? "OK";

    const presenceSnapshot = input.presence;
    const presenceState = presenceSnapshot.state;
    const presenceStateChanged =
      presenceState !== this.presenceState ||
      this.presenceChangedAt === 0 ||
      presenceSnapshot.lastStateChangeAt > this.presenceChangedAt;

    if (presenceStateChanged) {
      this.presenceState = presenceState;
      this.presenceChangedAt = resolveTimestamp(
        presenceSnapshot.lastStateChangeAt,
      );
      if (presenceState === "PRESENT") {
        this.resumeBoostUntil = timestamp + this.config.resumeBoostMs;
      }
    }

    const presenceDurationMs = Math.max(0, timestamp - this.presenceChangedAt);
    const absenceDurationMs =
      this.presenceState === "ABSENT" ? presenceDurationMs : 0;

    if (this.reliability === "UNRELIABLE") {
      this.lastUpdatedAt = timestamp;
      return this.createSnapshot({
        timestamp,
        absenceDurationMs,
        presenceDurationMs,
      });
    }

    if (this.presenceState === "ABSENT") {
      if (
        this.state !== "IDLE" &&
        absenceDurationMs >= this.config.absenceToIdleMs
      ) {
        this.transitionTo("IDLE", timestamp);
      }

      this.lastUpdatedAt = timestamp;
      return this.createSnapshot({
        timestamp,
        absenceDurationMs,
        presenceDurationMs,
      });
    }

    if (
      (this.state === "IDLE" || this.state === "INITIAL") &&
      presenceDurationMs >= this.config.presenceResumeMs
    ) {
      this.transitionTo("GOOD", timestamp);
    }

    if (this.state !== "IDLE" && this.state !== "INITIAL") {
      const recommended = input.recommendedState;
      if (recommended && this.state !== recommended) {
        this.transitionTo(recommended, timestamp);
      }
    }

    if (this.state === "GOOD") {
      this.timers.good += deltaMs / 1000;
    } else if (this.state === "AT_RISK") {
      this.timers.atRisk += deltaMs / 1000;
    } else if (this.state === "BAD_POSTURE") {
      this.timers.badPosture += deltaMs / 1000;
    }

    this.lastUpdatedAt = timestamp;
    return this.createSnapshot({
      timestamp,
      absenceDurationMs,
      presenceDurationMs,
    });
  }

  getSnapshot(): RiskMachineSnapshot {
    return this.createSnapshot({
      timestamp: this.lastUpdatedAt,
      absenceDurationMs:
        this.presenceState === "ABSENT"
          ? Math.max(0, this.lastUpdatedAt - this.presenceChangedAt)
          : 0,
      presenceDurationMs: Math.max(
        0,
        this.lastUpdatedAt - this.presenceChangedAt,
      ),
    });
  }

  reset(timestamp?: number): void {
    const resolvedTimestamp = isFiniteNumber(timestamp)
      ? timestamp
      : getMonotonicTime();
    this.state = "INITIAL";
    this.stateChangedAt = resolvedTimestamp;
    this.presenceState = "ABSENT";
    this.presenceChangedAt = resolvedTimestamp;
    this.lastUpdatedAt = resolvedTimestamp;
    this.timers = {
      good: 0,
      atRisk: 0,
      badPosture: 0,
    };
    this.resumeBoostUntil = 0;
    this.reliability = "OK";
  }

  updateConfig(config: RiskStateMachineConfig): void {
    this.config = { ...this.config, ...(config ?? {}) };
  }

  private transitionTo(state: RiskState, timestamp: number): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.stateChangedAt = timestamp;
    if (state === "IDLE") {
      this.resetTimers();
    }
  }

  private resetTimers(): void {
    this.timers = {
      good: 0,
      atRisk: 0,
      badPosture: 0,
    };
  }

  private createSnapshot(options: {
    timestamp: number;
    absenceDurationMs: number;
    presenceDurationMs: number;
  }): RiskMachineSnapshot {
    const { timestamp, absenceDurationMs, presenceDurationMs } = options;
    const shouldSleep =
      this.presenceState === "ABSENT" &&
      absenceDurationMs >= this.config.sleepAfterAbsenceMs;
    const shouldBoost =
      this.presenceState === "PRESENT" && timestamp <= this.resumeBoostUntil;
    const { reliability } = this;
    const effectiveState: RiskState =
      reliability === "UNRELIABLE" ? "UNRELIABLE" : this.state;

    return {
      state: effectiveState,
      presence: this.presenceState,
      lastUpdatedAt: timestamp,
      stateChangedAt: this.stateChangedAt,
      timers: clampTimers(cloneTimers(this.timers)),
      reliability,
      absenceDurationMs,
      presenceDurationMs,
      shouldSleep,
      shouldBoost,
    };
  }
}

export const createRiskStateMachine = (
  config?: RiskStateMachineConfig,
): RiskStateMachine => {
  return new RiskStateMachine(config);
};
