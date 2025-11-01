import { downscaleFrame } from "../../shared/cv/downscale";
import { FrameGovernor } from "../../shared/cv/frameGovernor";
import { MEDIAPIPE_ASSETS } from "../../shared/detection/mediapipeAssets.mjs";
import { getLogger } from "../../shared/logger";
import type { DetectorKind } from "../../shared/types/detector";
import { CameraManager } from "./cameraManager";
import { DetectionWorkerBridge } from "./detectionWorkerBridge";

type RunningDetector = DetectorKind;

export type DetectionMetrics = {
  framesProcessed: number;
  framesSkipped: number;
  framesDroppedWhileBusy: number;
  averageInferenceMs: number;
  lastInferenceMs: number;
  averageDownscaleMs: number;
  lastDownscaleMs: number;
  detector: RunningDetector;
  crossOriginIsolated: boolean;
};

const logger = getLogger("detection-pipeline", "renderer");

const DEFAULT_TARGET_FPS = 30;
// Exponential weighted moving average alpha: higher values = more responsive to recent samples,
// lower values = smoother but slower to react.
const EWMA_SMOOTHING = 0.2;

const updateAverage = (current: number, next: number): number => {
  if (!Number.isFinite(current) || current === 0) {
    return next;
  }

  return current * (1 - EWMA_SMOOTHING) + next * EWMA_SMOOTHING;
};

export class DetectionPipeline {
  private readonly camera = new CameraManager();

  private readonly worker = new DetectionWorkerBridge();

  private readonly governor = new FrameGovernor({
    targetFps: DEFAULT_TARGET_FPS,
  });

  private running = false;

  private rafId: number | null = null;

  private metrics: DetectionMetrics = {
    framesProcessed: 0,
    framesSkipped: 0,
    framesDroppedWhileBusy: 0,
    averageInferenceMs: 0,
    lastInferenceMs: 0,
    averageDownscaleMs: 0,
    lastDownscaleMs: 0,
    detector: "mediapipe",
    crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
  };

  private inFlightFrames = new Map<number, number>();

  private longTaskObserver: PerformanceObserver | null = null;

  private workerDisposers: Array<() => void> = [];

  async start(
    detector: RunningDetector = "mediapipe",
  ): Promise<DetectionMetrics> {
    if (!globalThis.crossOriginIsolated) {
      throw new Error(
        "Cross-origin isolation is required for the detection pipeline.",
      );
    }

    logger.info("Starting detection pipeline", { detector });

    this.metrics.detector = detector;
    await this.camera.initialise({ idealFrameRate: DEFAULT_TARGET_FPS });

    await this.worker.initialise({
      kind: detector,
      targetFps: DEFAULT_TARGET_FPS,
      downscaleShortSide: 320,
      assetBaseUrl: MEDIAPIPE_ASSETS.baseUrl,
    });

    this.running = true;
    this.attachWorkers();
    this.observeLongTasks();
    this.scheduleNextFrame();

    return this.metrics;
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.worker.shutdown();
    this.camera.dispose();
    this.inFlightFrames.clear();
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
    this.governor.reset();
    this.workerDisposers.forEach((dispose) => {
      try {
        dispose();
      } catch (error) {
        logger.warn("Failed to dispose worker listener", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.workerDisposers = [];
  }

  getMetrics(): DetectionMetrics {
    return { ...this.metrics };
  }

  private scheduleNextFrame(): void {
    if (!this.running) {
      return;
    }

    this.rafId = requestAnimationFrame((timestamp) => {
      this.captureLoop(timestamp).catch((error) => {
        logger.error("Frame processing failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.metrics.framesSkipped += 1;
        this.scheduleNextFrame();
      });
    });
  }

  private async captureLoop(timestamp: number): Promise<void> {
    if (!this.running) {
      return;
    }

    if (!this.worker.isReady() || this.worker.isBusy()) {
      this.metrics.framesDroppedWhileBusy += 1;
      this.scheduleNextFrame();
      return;
    }

    if (!this.governor.shouldProcess(timestamp)) {
      this.metrics.framesSkipped += 1;
      this.scheduleNextFrame();
      return;
    }

    const frameStartMarker = this.governor.beginFrame(timestamp);

    const bitmap = await this.camera.captureFrame();
    const downscaleStart = performance.now();
    const downscaled = await downscaleFrame(bitmap, 320);
    const downscaleEnd = performance.now();

    if (downscaled.downscaled) {
      bitmap.close();
    }

    const downscaleDuration = downscaleEnd - downscaleStart;
    this.metrics.lastDownscaleMs = downscaleDuration;
    this.metrics.averageDownscaleMs = updateAverage(
      this.metrics.averageDownscaleMs,
      downscaleDuration,
    );

    const metadata = this.worker.nextFrameMetadata();
    this.inFlightFrames.set(metadata.id, frameStartMarker);

    this.worker.processFrame(downscaled.bitmap, metadata);

    this.scheduleNextFrame();
  }

  private attachWorkers(): void {
    this.workerDisposers.push(
      this.worker.on("result", (result) => {
        this.metrics.framesProcessed += 1;
        this.metrics.lastInferenceMs = result.durationMs;
        this.metrics.averageInferenceMs = updateAverage(
          this.metrics.averageInferenceMs,
          result.durationMs,
        );

        const startMarker = this.inFlightFrames.get(result.frameId);
        const now = performance.now();
        if (typeof startMarker === "number") {
          this.governor.completeFrame(startMarker, now);
          this.inFlightFrames.delete(result.frameId);
        }
      }),
    );

    this.workerDisposers.push(
      this.worker.on("error", (error) => {
        logger.error("Detection worker emitted error", error);
        this.metrics.framesSkipped += 1;
        if (typeof error.frameId === "number") {
          this.inFlightFrames.delete(error.frameId);
        }
      }),
    );
  }

  private observeLongTasks(): void {
    if (this.longTaskObserver) {
      return;
    }

    if (typeof PerformanceObserver === "undefined") {
      logger.warn(
        "PerformanceObserver not available; cannot monitor long tasks",
      );
      return;
    }

    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          logger.warn("Long task detected on main thread", {
            duration: entry.duration,
            startTime: entry.startTime,
          });
        });
      });

      this.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch (error) {
      logger.warn("Failed to observe long tasks", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
