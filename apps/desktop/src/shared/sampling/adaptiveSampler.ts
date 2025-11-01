import { clamp } from "../env";
import type { PresenceState, RiskState } from "../types/engine-state";
import {
  DEFAULT_PERFORMANCE_MODE_ID,
  type PerformanceModeId,
  type PerformanceModePreset,
  clampFpsToPresetRange,
  getPerformanceModePreset,
} from "./performanceModes";

type Clock = () => number;

type AdaptiveSamplerOptions = {
  modeId?: PerformanceModeId;
  clock?: Clock;
  rampUpDurationMs?: number;
  rampDownDurationMs?: number;
  decayDelayMs?: number;
  presenceBoostDurationMs?: number;
  idleFps?: number;
};

type CpuThrottleState = {
  active: boolean;
  multiplier: number;
  appliedAt: number | null;
  lockUntil: number;
};

const DEFAULT_IDLE_FPS = 1;
const CPU_THROTTLE_MULTIPLIER = 0.8;
const CPU_THROTTLE_COOLDOWN_MS = 30_000;
const RESOLUTION_WINDOW_MS = 60_000;
// The maximum number of recent CPU throttle events to retain in history.
// This value (6) was chosen to balance memory usage and responsiveness:
// a small history smooths out transient spikes, while still allowing
// the system to react to sustained changes in CPU load. Increasing this
// value would make the system slower to respond to changes, while decreasing
// it could make it too sensitive to short-lived fluctuations.
const MAX_THROTTLE_HISTORY = 6;

const computeCenter = (range: { min: number; max: number }): number => {
  return (range.min + range.max) / 2;
};

export class AdaptiveSampler {
  private readonly clock: Clock;

  private readonly rampUpDurationMs: number;

  private readonly rampDownDurationMs: number;

  private readonly decayDelayMs: number;

  private readonly presenceBoostDurationMs: number;

  private readonly idleFps: number;

  private mode: PerformanceModePreset;

  private riskState: RiskState = "INITIAL";

  private presenceState: PresenceState = "ABSENT";

  private currentFps: number;

  private targetFps: number;

  private lastUpdateAt: number;

  private goodSince: number | null = null;

  private boostUntil: number = 0;

  private cpuThrottle: CpuThrottleState = {
    active: false,
    multiplier: 1,
    appliedAt: null,
    lockUntil: 0,
  };

  private throttleEvents: number[] = [];

  constructor(options: AdaptiveSamplerOptions = {}) {
    this.clock = options.clock ?? (() => performance.now());
    this.rampUpDurationMs = Math.max(options.rampUpDurationMs ?? 2000, 1);
    this.rampDownDurationMs = Math.max(options.rampDownDurationMs ?? 3000, 1);
    this.decayDelayMs = Math.max(options.decayDelayMs ?? 10_000, 0);
    this.presenceBoostDurationMs = Math.max(
      options.presenceBoostDurationMs ?? 2000,
      0,
    );
    this.idleFps = Math.max(options.idleFps ?? DEFAULT_IDLE_FPS, 0.1);

    this.mode = getPerformanceModePreset(
      options.modeId ?? DEFAULT_PERFORMANCE_MODE_ID,
    );

    const initialFps = computeCenter(this.mode.baseline);
    const now = this.clock();

    this.currentFps = initialFps;
    this.targetFps = initialFps;
    this.lastUpdateAt = now;
  }

  private getBaselineTarget(): number {
    return clampFpsToPresetRange(
      this.mode,
      computeCenter(this.mode.baseline),
      "baseline",
    );
  }

  private getBoostedTarget(): number {
    return clampFpsToPresetRange(
      this.mode,
      computeCenter(this.mode.boosted),
      "boosted",
    );
  }

  getMode(): PerformanceModePreset {
    return this.mode;
  }

  getModeId(): PerformanceModeId {
    return this.mode.id;
  }

  getRiskState(): RiskState {
    return this.riskState;
  }

  getPresenceState(): PresenceState {
    return this.presenceState;
  }

  setMode(modeId: PerformanceModeId, now = this.clock()): void {
    const next = getPerformanceModePreset(modeId);
    this.mode = next;
    this.recalculateTarget(now);
    this.currentFps = clamp(
      this.currentFps,
      next.baseline.min,
      next.boosted.max,
    );
  }

  setPresenceState(presence: PresenceState, now = this.clock()): void {
    if (presence === this.presenceState) {
      return;
    }
    const previous = this.presenceState;
    this.presenceState = presence;
    if (presence === "PRESENT" && previous === "ABSENT") {
      this.boostUntil = now + this.presenceBoostDurationMs;
    } else if (presence === "ABSENT") {
      this.boostUntil = 0;
    }
    this.recalculateTarget(now);
  }

  setRiskState(state: RiskState, now = this.clock()): void {
    if (state === this.riskState) {
      return;
    }
    const previousState = this.riskState;
    this.riskState = state;
    if (state === "GOOD") {
      const cameFromRisk =
        previousState === "AT_RISK" || previousState === "BAD_POSTURE";
      this.goodSince = cameFromRisk ? now : now - this.decayDelayMs;
    } else if (state === "AT_RISK" || state === "BAD_POSTURE") {
      this.goodSince = null;
      this.boostUntil = Math.max(this.boostUntil, now + this.rampUpDurationMs);
    } else {
      this.goodSince = null;
    }
    this.recalculateTarget(now);
  }

  updateState(
    state: {
      presence?: PresenceState;
      risk?: RiskState;
    } = {},
    now = this.clock(),
  ): void {
    if (state.presence) {
      this.setPresenceState(state.presence, now);
    }
    if (state.risk) {
      this.setRiskState(state.risk, now);
    } else {
      this.recalculateTarget(now);
    }
  }

  tick(now = this.clock()): number {
    if (this.boostUntil > 0 && now >= this.boostUntil) {
      this.boostUntil = 0;
      this.recalculateTarget(now);
    } else if (
      this.riskState === "GOOD" &&
      this.goodSince !== null &&
      now - this.goodSince >= this.decayDelayMs
    ) {
      const baselineTarget = this.getBaselineTarget();
      if (Math.abs(this.targetFps - baselineTarget) > 0.05) {
        this.recalculateTarget(now);
      }
    }

    const elapsed = Math.max(0, now - this.lastUpdateAt);
    this.lastUpdateAt = now;

    const diff = this.targetFps - this.currentFps;
    if (Math.abs(diff) < 0.01) {
      this.currentFps = this.targetFps;
      return this.currentFps;
    }

    const rampDuration =
      diff > 0 ? this.rampUpDurationMs : this.rampDownDurationMs;
    const progress = clamp(elapsed / rampDuration, 0, 1);
    this.currentFps += diff * progress;

    if (
      (diff > 0 && this.currentFps > this.targetFps) ||
      (diff < 0 && this.currentFps < this.targetFps)
    ) {
      this.currentFps = this.targetFps;
    }

    return this.currentFps;
  }

  getCurrentFps(): number {
    return this.currentFps;
  }

  getTargetFps(): number {
    return this.targetFps;
  }

  isCpuThrottled(): boolean {
    return this.cpuThrottle.active;
  }

  applyCpuThrottle(now = this.clock()): boolean {
    if (now < this.cpuThrottle.lockUntil) {
      return false;
    }

    this.cpuThrottle = {
      active: true,
      multiplier: CPU_THROTTLE_MULTIPLIER,
      appliedAt: now,
      lockUntil: now + CPU_THROTTLE_COOLDOWN_MS,
    } satisfies CpuThrottleState;

    this.recordThrottleEvent(now);
    this.recalculateTarget(now);
    return true;
  }

  clearCpuThrottle(now = this.clock()): boolean {
    if (!this.cpuThrottle.active) {
      return false;
    }

    this.cpuThrottle = {
      active: false,
      multiplier: 1,
      appliedAt: null,
      lockUntil: now,
    } satisfies CpuThrottleState;

    this.recalculateTarget(now);
    return true;
  }

  getCpuThrottleInfo(): CpuThrottleState {
    return { ...this.cpuThrottle } satisfies CpuThrottleState;
  }

  getRecentThrottleCount(now = this.clock()): number {
    this.throttleEvents = this.throttleEvents.filter(
      (timestamp) => now - timestamp <= RESOLUTION_WINDOW_MS,
    );
    return this.throttleEvents.length;
  }

  private recordThrottleEvent(timestamp: number): void {
    this.throttleEvents.push(timestamp);
    if (this.throttleEvents.length > MAX_THROTTLE_HISTORY) {
      this.throttleEvents.splice(
        0,
        this.throttleEvents.length - MAX_THROTTLE_HISTORY,
      );
    }
  }

  private shouldUseIdleFps(): boolean {
    return this.presenceState === "ABSENT" || this.riskState === "IDLE";
  }

  private recalculateTarget(now: number): void {
    let desired: number;

    if (this.shouldUseIdleFps()) {
      desired = this.idleFps;
    } else {
      const boostedTarget = this.getBoostedTarget();
      const baselineTarget = this.getBaselineTarget();
      const boostActive =
        this.boostUntil > now ||
        this.riskState === "AT_RISK" ||
        this.riskState === "BAD_POSTURE";

      if (boostActive) {
        desired = boostedTarget;
      } else if (
        this.riskState === "GOOD" &&
        this.goodSince !== null &&
        now - this.goodSince < this.decayDelayMs
      ) {
        desired = boostedTarget;
      } else {
        desired = baselineTarget;
      }
    }

    if (this.cpuThrottle.active) {
      desired *= this.cpuThrottle.multiplier;
    }

    this.targetFps = clamp(
      desired,
      Math.min(this.mode.baseline.min, this.idleFps),
      this.mode.boosted.max,
    );
  }
}

export default AdaptiveSampler;
