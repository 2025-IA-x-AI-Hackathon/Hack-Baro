export type FrameGovernorOptions = {
  targetFps?: number;
  minimumIntervalMs?: number;
};

const TARGET_FPS = 30;
const DEFAULT_MINIMUM_INTERVAL_MS = 5;
const DEFAULT_FRAME_INTERVAL_MS = 33.33; // ~30 FPS

export class FrameGovernor {
  private readonly frameInterval: number;

  private nextAllowedTime = 0;

  private readonly minimumInterval: number;

  constructor({
    targetFps = TARGET_FPS,
    minimumIntervalMs = DEFAULT_MINIMUM_INTERVAL_MS,
  }: FrameGovernorOptions = {}) {
    const interval = 1000 / targetFps;
    this.frameInterval = Number.isFinite(interval)
      ? interval
      : DEFAULT_FRAME_INTERVAL_MS;
    this.minimumInterval = minimumIntervalMs;
  }

  shouldProcess(now = performance.now()): boolean {
    return now >= this.nextAllowedTime;
  }

  beginFrame(now = performance.now()): number {
    if (now < this.nextAllowedTime) {
      return -1;
    }

    return now;
  }

  completeFrame(startTime: number, endTime = performance.now()): void {
    if (startTime < 0) {
      return;
    }

    const processingDuration = Math.max(endTime - startTime, 0);
    const overBudget = processingDuration - this.frameInterval;

    if (overBudget > 0) {
      this.nextAllowedTime = endTime + overBudget;
      return;
    }

    const cooldown = Math.max(
      this.minimumInterval,
      this.frameInterval - processingDuration,
    );
    this.nextAllowedTime = endTime + cooldown;
  }

  reset(now = performance.now()): void {
    this.nextAllowedTime = now;
  }
}
