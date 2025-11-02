import { WORKER_MESSAGES, type WorkerMessage } from "../../shared/ipcChannels";
import {
  PostureAnalyzer,
  createDefaultBaseline,
} from "../../shared/posture/postureAnalyzer";
// Disable no-unused-vars lint noise for constructor signature helpers
/* eslint no-unused-vars: off */
import type { PoseKeypoint } from "../../shared/types/calibration";
import type { EngineTick } from "../../shared/types/engine";

type IntervalHandle = ReturnType<typeof setInterval>;

type CalibrationProvider =
  | (() => Promise<PoseKeypoint[] | null>)
  | (() => PoseKeypoint[] | null);

type WorkerMessageHandler = (message: WorkerMessage) => void;

const DEFAULT_INTERVAL_MS = 750;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const unrefIfPossible = (handle: unknown): void => {
  if (
    typeof handle === "object" &&
    handle !== null &&
    "unref" in handle &&
    typeof (handle as { unref?: unknown }).unref === "function"
  ) {
    (handle as { unref: () => void }).unref();
  }
};

export class EngineTickEmitter {
  private readonly postMessage: WorkerMessageHandler;

  private readonly calibrationProvider: CalibrationProvider;

  private readonly intervalMs: number;

  private readonly random: () => number;

  private timer: IntervalHandle | null = null;

  private analyzer: PostureAnalyzer | null = null;

  private baseline: PoseKeypoint[] = [];

  private calibrated = false;

  private lastTick: EngineTick | null = null;

  private tickSequence = 0;

  constructor({
    postMessage,
    calibrationProvider,
    intervalMs = DEFAULT_INTERVAL_MS,
    random = Math.random,
  }: {
    postMessage: WorkerMessageHandler;
    calibrationProvider: CalibrationProvider;
    intervalMs?: number;
    random?: () => number;
  }) {
    this.postMessage = postMessage;
    this.calibrationProvider = calibrationProvider;
    this.intervalMs = intervalMs;
    this.random = random;
  }

  async start(): Promise<void> {
    await this.refreshBaseline();
    this.emitTick();
    this.startInterval();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  async refreshBaseline(): Promise<void> {
    try {
      const nextBaseline =
        (await Promise.resolve(this.calibrationProvider())) ?? null;

      if (nextBaseline && nextBaseline.length >= 4) {
        this.baseline = nextBaseline.map((point) => ({ ...point }));
        this.calibrated = true;
      } else {
        this.baseline = createDefaultBaseline();
        this.calibrated = false;
      }

      this.analyzer = new PostureAnalyzer({
        baseline: this.baseline,
        calibrated: this.calibrated,
      });
    } catch (error) {
      this.analyzer = new PostureAnalyzer({
        baseline: createDefaultBaseline(),
        calibrated: false,
      });
      this.calibrated = false;
      this.postMessage({
        type: WORKER_MESSAGES.status,
        payload: {
          error: error instanceof Error ? error.message : String(error),
          scope: "engine:baseline",
        },
      });
    }
  }

  getLastTick(): EngineTick | null {
    return this.lastTick;
  }

  ingestExternalTick(tick: EngineTick): void {
    this.lastTick = tick;
    this.tickSequence += 1;
  }

  private startInterval(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    const handle = setInterval(() => {
      this.emitTick();
    }, this.intervalMs);
    this.timer = handle;
    unrefIfPossible(handle);
  }

  private emitTick(): void {
    if (!this.analyzer) {
      return;
    }

    try {
      const keypoints = this.generateCurrentKeypoints();
      const tick = this.analyzer.evaluate(keypoints, Date.now());
      this.lastTick = tick;
      this.postMessage({
        type: WORKER_MESSAGES.engineTick,
        payload: tick,
      });
    } catch (error) {
      this.postMessage({
        type: WORKER_MESSAGES.status,
        payload: {
          error: error instanceof Error ? error.message : String(error),
          scope: "engine:emit",
        },
      });
    } finally {
      this.tickSequence += 1;
    }
  }

  private generateCurrentKeypoints(): PoseKeypoint[] {
    if (this.baseline.length === 0) {
      return createDefaultBaseline();
    }

    const phase = this.tickSequence % 24;
    const baseVariance = this.calibrated ? 0.01 : 0.02;

    let varianceMultiplier = 1;
    if (phase >= 8 && phase < 16) {
      varianceMultiplier = 2.5;
    } else if (phase >= 16) {
      varianceMultiplier = 4;
    }

    const variance = baseVariance * varianceMultiplier;

    return this.baseline.map((point) => {
      const offsetX = this.centeredNoise(variance);
      const offsetY = this.centeredNoise(variance);
      const offsetZ = this.centeredNoise(variance * 0.2);
      const visibilityDrop = Math.abs(this.centeredNoise(variance * 0.5));

      return {
        ...point,
        x: clamp((point.x ?? 0.5) + offsetX, 0, 1),
        y: clamp((point.y ?? 0.5) + offsetY, 0, 1),
        z:
          typeof point.z === "number"
            ? clamp(point.z + offsetZ, -1, 1)
            : undefined,
        visibility: clamp((point.visibility ?? 1) - visibilityDrop, 0.05, 1),
      };
    });
  }

  private centeredNoise(magnitude: number): number {
    return (this.random() - 0.5) * 2 * magnitude;
  }
}

export default EngineTickEmitter;
