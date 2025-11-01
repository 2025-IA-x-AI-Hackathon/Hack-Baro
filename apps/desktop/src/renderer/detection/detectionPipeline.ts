import { downscaleFrame } from "../../shared/cv/downscale";
import { FrameGovernor } from "../../shared/cv/frameGovernor";
import { MEDIAPIPE_ASSETS } from "../../shared/detection/mediapipeAssets.mjs";
import { parseBooleanFlag } from "../../shared/env";
import buildGuardrailOverridesFromRecord from "../../shared/guardrails/overrides";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import { getLogger } from "../../shared/logger";
import {
  AdaptiveSampler,
  CpuMonitor,
  DEFAULT_PERFORMANCE_MODE_ID,
  type PerformanceModeId,
  type PerformanceModePreset,
  getPerformanceModePreset,
} from "../../shared/sampling";
import type { DetectorKind, DetectorResult } from "../../shared/types/detector";
import type { EngineFramePayload } from "../../shared/types/engine-ipc";
import type {
  EngineReliability,
  PresenceSnapshot,
  PresenceState,
  RiskState,
} from "../../shared/types/engine-state";
import type { CombinedLandmarks } from "../../shared/types/landmarks";
import type { MetricValues } from "../../shared/types/metrics";
import { captureRendererException } from "../sentry";
import { CameraManager } from "./cameraManager";
import { handleMetricsDebug } from "./debugOverlay";
import { DetectionWorkerBridge } from "./detectionWorkerBridge";
import emitSignalTrace from "./signalTraceWriter";

type RunningDetector = DetectorKind;
type ElectronApi = Window["electron"];

const ENABLE_EXPERIMENTAL_SCORING = (() => {
  const electronEnv =
    typeof window !== "undefined" ? window.electron?.env : undefined;
  const envValue =
    electronEnv?.POSELY_ENABLE_EXPERIMENTAL_SCORING ??
    (typeof process !== "undefined"
      ? (process.env?.POSELY_ENABLE_EXPERIMENTAL_SCORING ?? null)
      : null);
  return parseBooleanFlag(envValue);
})();

const DEBUG_GUARDRAILS_VERBOSE = (() => {
  const electronEnv =
    typeof window !== "undefined" ? window.electron?.env : undefined;
  const envValue =
    electronEnv?.POSELY_DEBUG_GUARDRAILS_VERBOSE ??
    (typeof process !== "undefined"
      ? (process.env?.POSELY_DEBUG_GUARDRAILS_VERBOSE ?? null)
      : null);
  return parseBooleanFlag(envValue);
})();

export const PERFORMANCE_DELEGATES = ["GPU", "CPU"] as const;
export type PerformanceDelegate = (typeof PERFORMANCE_DELEGATES)[number];
export const PERFORMANCE_FPS_OPTIONS = [15, 20, 30] as const;
export type PerformanceFps = (typeof PERFORMANCE_FPS_OPTIONS)[number];
const SHORT_SIDE_OPTIONS = [192, 224, 256, 288, 320] as const;
export const PERFORMANCE_SHORT_SIDE_OPTIONS = SHORT_SIDE_OPTIONS;
export type PerformanceShortSide =
  (typeof PERFORMANCE_SHORT_SIDE_OPTIONS)[number];

export type PerformanceConfig = {
  delegate: PerformanceDelegate;
  fps: PerformanceFps;
  shortSide: PerformanceShortSide;
  alternatingFrameCadence: number;
};

export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  // Balanced preset: GPU delegate @ 15 FPS, 256px short side
  // (~13% renderer CPU / ~4% GPU on M3 Pro after 60s warm-up).
  delegate: "GPU",
  fps: 15,
  shortSide: 256,
  alternatingFrameCadence: 2,
};

export type DetectionMetrics = {
  framesProcessed: number;
  framesSkipped: number;
  framesDroppedWhileBusy: number;
  averageInferenceMs: number;
  lastInferenceMs: number;
  averageDownscaleMs: number;
  lastDownscaleMs: number;
  lastMainThreadMs: number;
  mainThreadBudgetOverruns: number;
  detector: RunningDetector;
  crossOriginIsolated: boolean;
};

export type DebugMetricSnapshot = {
  pitchRaw: number | null;
  pitchEma: number | null;
  yawRaw: number | null;
  yawEma: number | null;
  rollRaw: number | null;
  rollEma: number | null;
  ehdRaw: number | null;
  ehdEma: number | null;
  dprRaw: number | null;
  dprEma: number | null;
  yawDeweighted: boolean;
  lowConfidence: boolean;
  baselinePending: boolean;
  baseline: number | null;
  outliers: {
    pitch: boolean;
    yaw: boolean;
    roll: boolean;
    ehd: boolean;
    dpr: boolean;
  };
};

export type DetectionDebugState = {
  landmarks: CombinedLandmarks | null;
  metrics: DebugMetricSnapshot;
  reliability: EngineReliability;
  reliabilityReasons: string[];
};

const logger = getLogger("detection-pipeline", "renderer");

// Exponential weighted moving average alpha: higher values = more responsive to recent samples,
// lower values = smoother but slower to react.
const EWMA_SMOOTHING = 0.2;
// Maximum tolerated main-thread processing time (ms) per frame while detection runs.
const MAIN_THREAD_BUDGET_MS = 5;
const FRAME_PROCESS_TIMEOUT_MS = 200;
const SLEEP_MODE_FPS = 0.5;
const CPU_SAMPLE_INTERVAL_MS = 5000;
const CPU_BUDGET_PERCENT = 15;
const CPU_RECOVERY_PERCENT = 12;
const CPU_RECOVERY_DURATION_MS = 20_000;
const CPU_LOG_INTERVAL_MS = 30_000;
const FPS_EPSILON = 0.05;
const RESOLUTION_RECOVERY_MS = 60_000;
const CPU_OVERBUDGET_SAMPLE_THRESHOLD = 2;

const DYNAMIC_SHORT_SIDE_STEPS: ReadonlyArray<PerformanceShortSide> = [
  ...SHORT_SIDE_OPTIONS,
].reverse();
type DynamicShortSide = PerformanceShortSide;
const FALLBACK_SHORT_SIDE: DynamicShortSide =
  DYNAMIC_SHORT_SIDE_STEPS[DYNAMIC_SHORT_SIDE_STEPS.length - 1] ??
  SHORT_SIDE_OPTIONS[0];

const normalizePerformanceConfig = (
  config: Partial<PerformanceConfig> | PerformanceConfig | undefined,
): PerformanceConfig => {
  const delegate: PerformanceDelegate =
    config?.delegate === "CPU" ? "CPU" : "GPU";

  const fps = PERFORMANCE_FPS_OPTIONS.includes(config?.fps as PerformanceFps)
    ? (config?.fps as PerformanceFps)
    : DEFAULT_PERFORMANCE_CONFIG.fps;

  const shortSide = PERFORMANCE_SHORT_SIDE_OPTIONS.includes(
    config?.shortSide as PerformanceShortSide,
  )
    ? (config?.shortSide as PerformanceShortSide)
    : DEFAULT_PERFORMANCE_CONFIG.shortSide;

  const alternatingFrameCadence =
    typeof config?.alternatingFrameCadence === "number"
      ? Math.max(0, Math.floor(config.alternatingFrameCadence))
      : delegate === "CPU"
        ? 3
        : DEFAULT_PERFORMANCE_CONFIG.alternatingFrameCadence;

  return {
    delegate,
    fps,
    shortSide,
    alternatingFrameCadence,
  };
};

const performanceConfigsEqual = (
  a: PerformanceConfig,
  b: PerformanceConfig,
): boolean => {
  return (
    a.delegate === b.delegate &&
    a.fps === b.fps &&
    a.shortSide === b.shortSide &&
    a.alternatingFrameCadence === b.alternatingFrameCadence
  );
};

const updateAverage = (current: number, next: number): number => {
  if (!Number.isFinite(current) || current === 0) {
    return next;
  }

  return current * (1 - EWMA_SMOOTHING) + next * EWMA_SMOOTHING;
};

const DEFAULT_DEBUG_METRICS: DebugMetricSnapshot = {
  pitchRaw: null,
  pitchEma: null,
  yawRaw: null,
  yawEma: null,
  rollRaw: null,
  rollEma: null,
  ehdRaw: null,
  ehdEma: null,
  dprRaw: null,
  dprEma: null,
  yawDeweighted: false,
  lowConfidence: false,
  baselinePending: false,
  baseline: null,
  outliers: {
    pitch: false,
    yaw: false,
    roll: false,
    ehd: false,
    dpr: false,
  },
};

const createInitialDebugState = (): DetectionDebugState => ({
  landmarks: null,
  metrics: { ...DEFAULT_DEBUG_METRICS },
  reliability: "OK",
  reliabilityReasons: [],
});

export const updateSmoothedValue = (
  current: number | null,
  next: number | null,
): number | null => {
  if (next === null || !Number.isFinite(next)) {
    return current;
  }

  if (current === null || !Number.isFinite(current)) {
    return next;
  }

  return current * (1 - EWMA_SMOOTHING) + next * EWMA_SMOOTHING;
};

type Vec3 = { x: number; y: number; z: number };

const averagePoint = <T extends Vec3>(points: Array<T | null>): Vec3 | null => {
  const valid = points.filter(
    (point): point is T =>
      point !== null &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z),
  );

  if (valid.length === 0) {
    return null;
  }

  const sum = valid.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
      z: accumulator.z + point.z,
    }),
    { x: 0, y: 0, z: 0 },
  );

  return {
    x: sum.x / valid.length,
    y: sum.y / valid.length,
    z: sum.z / valid.length,
  };
};

const selectLandmark = <T>(
  landmarks: T[] | undefined,
  index: number,
): T | null => {
  if (!landmarks || index < 0 || index >= landmarks.length) {
    return null;
  }
  const landmark = landmarks[index];
  return landmark ?? null;
};

export const computePoseMetrics = (
  landmarks: CombinedLandmarks | null,
): { pitch: number | null; ehd: number | null; dpr: number | null } => {
  if (!landmarks?.pose) {
    return {
      pitch: null,
      ehd: null,
      dpr: null,
    };
  }

  const { pose } = landmarks;
  const normalized = pose.landmarks;
  const world = pose.worldLandmarks;

  const leftEarWorld = selectLandmark(world, 7);
  const rightEarWorld = selectLandmark(world, 8);
  const leftShoulderWorld = selectLandmark(world, 11);
  const rightShoulderWorld = selectLandmark(world, 12);
  const noseWorld = selectLandmark(world, 0);

  const earCenterWorld = averagePoint([
    leftEarWorld,
    rightEarWorld,
  ] as Array<Vec3 | null>);
  const shoulderCenterWorld = averagePoint([
    leftShoulderWorld,
    rightShoulderWorld,
  ] as Array<Vec3 | null>);

  let pitch: number | null = null;
  let dpr: number | null = null;

  if (earCenterWorld && shoulderCenterWorld) {
    const deltaY = earCenterWorld.y - shoulderCenterWorld.y;
    const deltaZ = earCenterWorld.z - shoulderCenterWorld.z;

    if (Number.isFinite(deltaY) && Number.isFinite(deltaZ)) {
      pitch = (Math.atan2(deltaZ, Math.max(deltaY, 1e-4)) * 180) / Math.PI;
    }
  }

  if (shoulderCenterWorld && noseWorld) {
    const deltaZ = shoulderCenterWorld.z - noseWorld.z;
    if (Number.isFinite(deltaZ)) {
      dpr = Math.abs(deltaZ);
    }
  }

  const leftEar = selectLandmark(normalized, 7);
  const rightEar = selectLandmark(normalized, 8);
  const leftShoulder = selectLandmark(normalized, 11);
  const rightShoulder = selectLandmark(normalized, 12);

  const earCenter = averagePoint([leftEar, rightEar] as Array<Vec3 | null>);
  const shoulderCenter = averagePoint([
    leftShoulder,
    rightShoulder,
  ] as Array<Vec3 | null>);

  let ehd: number | null = null;

  if (earCenter && shoulderCenter) {
    const deltaX = earCenter.x - shoulderCenter.x;
    const deltaY = earCenter.y - shoulderCenter.y;
    if (Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
      ehd = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }
  }

  return {
    pitch,
    ehd,
    dpr,
  };
};

export const cloneCombinedLandmarks = (
  source: CombinedLandmarks | null,
): CombinedLandmarks | null => {
  if (!source) {
    return null;
  }

  return {
    frameId: source.frameId,
    capturedAt: source.capturedAt,
    processedAt: source.processedAt,
    presence: source.presence,
    reliability: source.reliability,
    face: source.face
      ? {
          confidence: source.face.confidence,
          landmarks: source.face.landmarks.map((landmark) => ({
            x: landmark.x,
            y: landmark.y,
            z: landmark.z,
          })),
          transformationMatrix: source.face.transformationMatrix
            ? [...source.face.transformationMatrix]
            : undefined,
        }
      : null,
    pose: source.pose
      ? {
          confidence: source.pose.confidence,
          landmarks: source.pose.landmarks.map((landmark) => ({
            x: landmark.x,
            y: landmark.y,
            z: landmark.z,
            visibility: landmark.visibility,
          })),
          worldLandmarks: source.pose.worldLandmarks
            ? source.pose.worldLandmarks.map((landmark) => ({
                x: landmark.x,
                y: landmark.y,
                z: landmark.z,
                visibility: landmark.visibility,
              }))
            : undefined,
        }
      : null,
  };
};

export class DetectionPipeline {
  private readonly camera = new CameraManager();

  private readonly worker = new DetectionWorkerBridge();

  private governor = new FrameGovernor({
    targetFps: DEFAULT_PERFORMANCE_CONFIG.fps,
  });

  private adaptiveSampler = new AdaptiveSampler({
    modeId: DEFAULT_PERFORMANCE_MODE_ID,
    idleFps: SLEEP_MODE_FPS,
  });

  private performanceMode: PerformanceModeId = DEFAULT_PERFORMANCE_MODE_ID;

  private performancePreset: PerformanceModePreset = getPerformanceModePreset(
    DEFAULT_PERFORMANCE_MODE_ID,
  );

  private dynamicShortSide: DynamicShortSide = 256;

  private resolutionIndex = Math.max(DYNAMIC_SHORT_SIDE_STEPS.indexOf(256), 0);

  private cpuMonitor: CpuMonitor | null = null;

  private cpuSampleTimer: number | null = null;

  private cpuOverBudgetSamples = 0;

  private lastCpuOverBudgetAt = 0;

  private lastCpuHeadroomAt: number | null = null;

  private lastCpuLogAt = 0;

  private lastCpuThrottleActive = false;

  private lastLoggedFps = 0;

  private currentRiskState: RiskState = "INITIAL";

  private performanceConfig: PerformanceConfig = normalizePerformanceConfig(
    DEFAULT_PERFORMANCE_CONFIG,
  );

  private activeDetector: RunningDetector = "mediapipe";

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
    lastMainThreadMs: 0,
    mainThreadBudgetOverruns: 0,
    detector: this.activeDetector,
    crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
  };

  private inFlightFrames = new Map<number, number>();

  private longTaskObserver: PerformanceObserver | null = null;

  private workerDisposers: Array<() => void> = [];

  private debugState: DetectionDebugState = createInitialDebugState();

  private latestLandmarks: CombinedLandmarks | null = null;

  private lastPresenceSnapshot: PresenceSnapshot | null = null;

  private presenceState: PresenceState = "ABSENT";

  private presenceChangedAt = 0;

  private effectiveFps: number = DEFAULT_PERFORMANCE_CONFIG.fps;

  private landmarkListeners = new Set<
    (landmarks: CombinedLandmarks | null) => void
  >();

  private cameraPreviewVisible = false;

  private frameTimeouts = new Map<number, number>();

  private timedOutFrames = new Set<number>();

  private readonly electron: ElectronApi | null =
    typeof window === "undefined"
      ? null
      : ((window as unknown as { electron?: ElectronApi }).electron ?? null);

  private lastEngineFrameProcessedAt: number | null = null;

  async start(
    detector: RunningDetector = "mediapipe",
  ): Promise<DetectionMetrics> {
    if (!globalThis.crossOriginIsolated) {
      throw new Error(
        "Cross-origin isolation is required for the detection pipeline.",
      );
    }

    this.activeDetector = detector;
    this.performanceConfig = normalizePerformanceConfig(this.performanceConfig);
    this.performancePreset = getPerformanceModePreset(this.performanceMode);
    this.dynamicShortSide = this.resolveShortSide(
      this.performancePreset.defaultShortSide,
    );
    this.resolutionIndex = this.findResolutionIndex(this.dynamicShortSide);
    this.performanceConfig = {
      ...this.performanceConfig,
      shortSide: this.dynamicShortSide,
    } satisfies PerformanceConfig;

    this.adaptiveSampler = new AdaptiveSampler({
      modeId: this.performanceMode,
      idleFps: SLEEP_MODE_FPS,
    });
    this.lastLoggedFps = this.adaptiveSampler.getCurrentFps();
    this.lastCpuThrottleActive = false;

    this.governor = new FrameGovernor({
      targetFps: this.adaptiveSampler.getCurrentFps(),
    });
    this.effectiveFps = this.adaptiveSampler.getCurrentFps();

    this.resetCpuMonitoring(performance.now());

    logger.info("Starting detection pipeline", {
      detector,
      performance: this.performanceConfig,
    });

    this.metrics = {
      framesProcessed: 0,
      framesSkipped: 0,
      framesDroppedWhileBusy: 0,
      averageInferenceMs: 0,
      lastInferenceMs: 0,
      averageDownscaleMs: 0,
      lastDownscaleMs: 0,
      lastMainThreadMs: 0,
      mainThreadBudgetOverruns: 0,
      detector,
      crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    };
    this.debugState = createInitialDebugState();
    this.latestLandmarks = null;
    this.lastPresenceSnapshot = null;
    this.presenceState = "ABSENT";
    const now = performance.now();
    this.presenceChangedAt = now;

    await this.camera.initialise({
      idealFrameRate: this.performanceConfig.fps,
    });

    const guardrailOverrides = buildGuardrailOverridesFromRecord(
      ((typeof window !== "undefined" ? window.electron?.env : undefined) ??
        {}) as Record<string, string | undefined>,
    );

    await this.worker.initialise({
      kind: detector,
      targetFps: this.performanceConfig.fps,
      downscaleShortSide: this.performanceConfig.shortSide,
      assetBaseUrl: MEDIAPIPE_ASSETS.baseUrl,
      delegate: this.performanceConfig.delegate,
      alternatingFrameCadence: this.performanceConfig.alternatingFrameCadence,
      enableScoring: ENABLE_EXPERIMENTAL_SCORING,
      guardrailOverrides,
      debugGuardrailsVerbose: DEBUG_GUARDRAILS_VERBOSE,
    });

    this.running = true;
    this.camera.setPreviewVisibility(this.cameraPreviewVisible);
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
    if (this.cpuSampleTimer !== null) {
      window.clearInterval(this.cpuSampleTimer);
      this.cpuSampleTimer = null;
    }
    this.cpuMonitor = null;
    this.cpuOverBudgetSamples = 0;
    this.lastCpuHeadroomAt = null;
    this.frameTimeouts.forEach((timeout) => window.clearTimeout(timeout));
    this.frameTimeouts.clear();
    this.timedOutFrames.clear();
    this.worker.shutdown();
    this.camera.dispose();
    this.cameraPreviewVisible = false;
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
    this.debugState = createInitialDebugState();
    this.latestLandmarks = null;
    this.lastPresenceSnapshot = null;
    this.presenceState = "ABSENT";
    this.presenceChangedAt = performance.now();
    this.effectiveFps = this.adaptiveSampler.getCurrentFps();
    this.notifyLandmarkListeners(null);
  }

  getMetrics(): DetectionMetrics {
    return { ...this.metrics };
  }

  getDebugState(): DetectionDebugState {
    return {
      landmarks: cloneCombinedLandmarks(this.debugState.landmarks),
      metrics: { ...this.debugState.metrics },
      reliability: this.debugState.reliability,
      reliabilityReasons: [...this.debugState.reliabilityReasons],
    };
  }

  getLatestLandmarks(): CombinedLandmarks | null {
    return this.latestLandmarks;
  }

  onLandmarks(
    listener: (landmarks: CombinedLandmarks | null) => void,
  ): () => void {
    this.landmarkListeners.add(listener);
    return () => {
      this.landmarkListeners.delete(listener);
    };
  }

  setCameraPreviewVisible(visible: boolean): void {
    this.cameraPreviewVisible = visible;
    this.camera.setPreviewVisibility(visible);
  }

  isRunning(): boolean {
    return this.running;
  }

  getPerformanceConfig(): PerformanceConfig {
    return { ...this.performanceConfig };
  }

  getPerformanceMode(): PerformanceModeId {
    return this.performanceMode;
  }

  async setPerformanceMode(mode: PerformanceModeId): Promise<void> {
    if (mode === this.performanceMode) {
      return;
    }
    this.performanceMode = mode;
    this.performancePreset = getPerformanceModePreset(mode);
    this.dynamicShortSide = this.resolveShortSide(
      this.performancePreset.defaultShortSide,
    );
    this.resolutionIndex = this.findResolutionIndex(this.dynamicShortSide);
    this.performanceConfig = {
      ...this.performanceConfig,
      shortSide: this.dynamicShortSide,
    } satisfies PerformanceConfig;
    this.adaptiveSampler = new AdaptiveSampler({
      modeId: mode,
      idleFps: SLEEP_MODE_FPS,
    });
    this.lastLoggedFps = this.adaptiveSampler.getCurrentFps();
    this.lastCpuThrottleActive = this.adaptiveSampler.isCpuThrottled();

    if (this.running) {
      const detector = this.metrics.detector ?? this.activeDetector;
      const previewVisible = this.cameraPreviewVisible;
      this.stop();
      await this.start(detector);
      this.camera.setPreviewVisibility(previewVisible);
    }
  }

  private clearFrameTimer(frameId: number) {
    const timeout = this.frameTimeouts.get(frameId);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      this.frameTimeouts.delete(frameId);
    }
  }

  private handleFrameTimeout(frameId: number) {
    this.clearFrameTimer(frameId);
    this.timedOutFrames.add(frameId);
    const startMarker = this.inFlightFrames.get(frameId);
    if (typeof startMarker === "number") {
      this.governor.completeFrame(startMarker, performance.now());
      this.inFlightFrames.delete(frameId);
    }
    this.metrics.framesSkipped += 1;
    logger.warn("Frame processing timed out", {
      frameId,
      timeoutMs: FRAME_PROCESS_TIMEOUT_MS,
    });
    captureRendererException(
      new Error(
        `Detection frame ${frameId} timed out after ${FRAME_PROCESS_TIMEOUT_MS}ms`,
      ),
    );
  }

  async applyPerformanceConfig(
    config: Partial<PerformanceConfig> | PerformanceConfig,
  ): Promise<DetectionMetrics> {
    const normalised = normalizePerformanceConfig(config);
    if (performanceConfigsEqual(this.performanceConfig, normalised)) {
      return this.metrics;
    }

    const wasRunning = this.running;
    const desiredPreview = this.cameraPreviewVisible;
    this.performanceConfig = normalised;
    this.performancePreset = getPerformanceModePreset(this.performanceMode);
    this.dynamicShortSide = this.resolveShortSide(normalised.shortSide);
    this.resolutionIndex = this.findResolutionIndex(this.dynamicShortSide);
    this.adaptiveSampler = new AdaptiveSampler({
      modeId: this.performanceMode,
      idleFps: SLEEP_MODE_FPS,
    });
    this.lastLoggedFps = this.adaptiveSampler.getCurrentFps();
    this.lastCpuThrottleActive = this.adaptiveSampler.isCpuThrottled();
    this.governor.setTargetFps(this.lastLoggedFps);
    this.effectiveFps = this.lastLoggedFps;

    if (!wasRunning) {
      return this.metrics;
    }

    const detector = this.metrics.detector ?? this.activeDetector;
    this.stop();
    this.cameraPreviewVisible = desiredPreview;
    const restartedMetrics = await this.start(detector);
    if (!desiredPreview) {
      this.camera.setPreviewVisibility(false);
    }
    return restartedMetrics;
  }

  private handlePresenceSnapshot(snapshot: PresenceSnapshot | null): void {
    const now = performance.now();
    const nextState: PresenceState = snapshot?.state ?? "ABSENT";
    this.lastPresenceSnapshot = snapshot ?? null;

    if (nextState !== this.presenceState) {
      this.presenceState = nextState;
      this.presenceChangedAt = now;
      logger.info("Presence state changed", { state: nextState });
    }

    this.adaptiveSampler.setPresenceState(nextState, now);
  }

  private updateFrameGovernorFps(targetFps: number): void {
    if (Math.abs(this.effectiveFps - targetFps) < FPS_EPSILON) {
      return;
    }
    this.governor.setTargetFps(targetFps);
    this.effectiveFps = targetFps;
  }

  private applyAdaptiveSampler(now: number): void {
    const nextFps = this.adaptiveSampler.tick(now);
    this.updateFrameGovernorFps(nextFps);
    this.maybeLogFpsChange(nextFps, this.getCurrentFpsReason());
  }

  private getCurrentFpsReason(): string {
    if (this.adaptiveSampler.isCpuThrottled()) {
      return "cpu";
    }
    if (this.presenceState === "ABSENT") {
      return "absence";
    }
    if (
      this.currentRiskState === "AT_RISK" ||
      this.currentRiskState === "BAD_POSTURE"
    ) {
      return this.currentRiskState.toLowerCase();
    }
    if (this.currentRiskState === "UNRELIABLE") {
      return "unreliable";
    }
    return "baseline";
  }

  private maybeLogFpsChange(next: number, reason: string): void {
    if (Math.abs(next - this.lastLoggedFps) < 0.5) {
      return;
    }
    const previous = this.lastLoggedFps;
    logger.info("[Adaptive] FPS change", {
      previous: Number(previous.toFixed(2)),
      next: Number(next.toFixed(2)),
      reason,
    });
    this.lastLoggedFps = next;
  }

  private resetCpuMonitoring(now: number): void {
    if (this.cpuSampleTimer !== null) {
      window.clearInterval(this.cpuSampleTimer);
      this.cpuSampleTimer = null;
    }
    this.cpuMonitor = new CpuMonitor();
    this.cpuMonitor.sample(now);
    this.cpuOverBudgetSamples = 0;
    this.lastCpuOverBudgetAt = 0;
    this.lastCpuHeadroomAt = null;
    this.lastCpuLogAt = now;
    this.lastCpuThrottleActive = this.adaptiveSampler.isCpuThrottled();
    this.cpuSampleTimer = window.setInterval(() => {
      this.pollCpuUsage();
    }, CPU_SAMPLE_INTERVAL_MS);
  }

  private pollCpuUsage(): void {
    if (!this.cpuMonitor) {
      return;
    }
    const now = performance.now();
    const sample = this.cpuMonitor.sample(now);

    if (now - this.lastCpuLogAt >= CPU_LOG_INTERVAL_MS) {
      logger.debug("[CPU Monitor] Sample", {
        average: Number(sample.average.toFixed(1)),
        instant: Number(sample.instant.toFixed(1)),
      });
      this.lastCpuLogAt = now;
    }

    if (sample.average > CPU_BUDGET_PERCENT) {
      this.cpuOverBudgetSamples += 1;
      this.lastCpuHeadroomAt = null;
      if (this.cpuOverBudgetSamples >= CPU_OVERBUDGET_SAMPLE_THRESHOLD) {
        this.handleCpuBudgetExceeded(sample.average, now);
        this.cpuOverBudgetSamples = 0;
      }
      return;
    }

    this.cpuOverBudgetSamples = 0;
    if (sample.average < CPU_RECOVERY_PERCENT) {
      if (this.lastCpuHeadroomAt === null) {
        this.lastCpuHeadroomAt = now;
      } else if (now - this.lastCpuHeadroomAt >= CPU_RECOVERY_DURATION_MS) {
        this.handleCpuRecovered(sample.average, now);
        this.lastCpuHeadroomAt = now;
      }
    } else {
      this.lastCpuHeadroomAt = null;
    }
  }

  private handleCpuBudgetExceeded(average: number, now: number): void {
    const previousFps = this.adaptiveSampler.getCurrentFps();
    const applied = this.adaptiveSampler.applyCpuThrottle(now);
    this.lastCpuThrottleActive = this.adaptiveSampler.isCpuThrottled();
    if (!applied && !this.lastCpuThrottleActive) {
      return;
    }

    const nextFps = this.adaptiveSampler.tick(now);
    this.updateFrameGovernorFps(nextFps);
    logger.warn("[Governor] CPU budget exceeded", {
      averageCpu: Number(average.toFixed(1)),
      previousFps: Number(previousFps.toFixed(2)),
      nextFps: Number(nextFps.toFixed(2)),
    });
    this.maybeLogFpsChange(nextFps, "cpu");
    this.lastCpuOverBudgetAt = now;

    if (
      this.adaptiveSampler.getRecentThrottleCount(now) >=
      CPU_OVERBUDGET_SAMPLE_THRESHOLD
    ) {
      this.stepDownResolution();
    }
  }

  private handleCpuRecovered(average: number, now: number): void {
    if (!this.lastCpuThrottleActive) {
      this.considerResolutionRecovery(now);
      return;
    }
    const previousFps = this.adaptiveSampler.getCurrentFps();
    const cleared = this.adaptiveSampler.clearCpuThrottle(now);
    this.lastCpuThrottleActive = this.adaptiveSampler.isCpuThrottled();
    if (!cleared) {
      this.considerResolutionRecovery(now);
      return;
    }

    const nextFps = this.adaptiveSampler.tick(now);
    this.updateFrameGovernorFps(nextFps);
    logger.info("[Governor] CPU headroom restored", {
      averageCpu: Number(average.toFixed(1)),
      previousFps: Number(previousFps.toFixed(2)),
      nextFps: Number(nextFps.toFixed(2)),
    });
    this.maybeLogFpsChange(nextFps, "cpu-recovery");
    this.considerResolutionRecovery(now);
  }

  private stepDownResolution(): void {
    const minIndex = this.findResolutionIndex(
      this.resolveShortSide(this.performancePreset.minShortSide),
    );
    if (this.resolutionIndex >= minIndex) {
      return;
    }
    const previousShortSide = this.dynamicShortSide;
    this.resolutionIndex = Math.min(minIndex, this.resolutionIndex + 1);
    this.dynamicShortSide =
      DYNAMIC_SHORT_SIDE_STEPS[this.resolutionIndex] ?? FALLBACK_SHORT_SIDE;
    this.performanceConfig = {
      ...this.performanceConfig,
      shortSide: this.dynamicShortSide,
    } satisfies PerformanceConfig;
    logger.warn("[Governor] CPU throttle escalating, stepping resolution", {
      previousShortSide,
      nextShortSide: this.dynamicShortSide,
    });
  }

  private stepUpResolution(): void {
    const baselineIndex = this.findResolutionIndex(
      this.resolveShortSide(this.performancePreset.defaultShortSide),
    );
    if (this.resolutionIndex <= baselineIndex) {
      return;
    }
    const previousShortSide = this.dynamicShortSide;
    this.resolutionIndex = Math.max(baselineIndex, this.resolutionIndex - 1);
    this.dynamicShortSide =
      DYNAMIC_SHORT_SIDE_STEPS[this.resolutionIndex] ?? FALLBACK_SHORT_SIDE;
    this.performanceConfig = {
      ...this.performanceConfig,
      shortSide: this.dynamicShortSide,
    } satisfies PerformanceConfig;
    logger.info("[Governor] CPU headroom sustained, increasing resolution", {
      previousShortSide,
      nextShortSide: this.dynamicShortSide,
    });
  }

  private considerResolutionRecovery(now: number): void {
    if (
      this.resolutionIndex <=
      this.findResolutionIndex(
        this.resolveShortSide(this.performancePreset.defaultShortSide),
      )
    ) {
      return;
    }
    if (now - this.lastCpuOverBudgetAt < RESOLUTION_RECOVERY_MS) {
      return;
    }
    this.stepUpResolution();
  }

  // Cache for allowed short sides based on performancePreset
  private _allowedShortSidesCache: DynamicShortSide[] | null = null;

  private _allowedShortSidesCacheMin: number | null = null;

  private _allowedShortSidesCacheMax: number | null = null;

  private getAllowedShortSides(): DynamicShortSide[] {
    const min = this.performancePreset.minShortSide;
    const max = this.performancePreset.maxShortSide;
    if (
      this._allowedShortSidesCache !== null &&
      this._allowedShortSidesCacheMin === min &&
      this._allowedShortSidesCacheMax === max
    ) {
      return this._allowedShortSidesCache;
    }
    const filtered = DYNAMIC_SHORT_SIDE_STEPS.filter(
      (size): size is DynamicShortSide => size <= max && size >= min,
    );
    this._allowedShortSidesCache = filtered;
    this._allowedShortSidesCacheMin = min;
    this._allowedShortSidesCacheMax = max;
    return filtered;
  }

  private resolveShortSide(target: number): DynamicShortSide {
    const allowed = this.getAllowedShortSides();
    if (allowed.length === 0) {
      return FALLBACK_SHORT_SIDE;
    }
    const bounded = Math.min(
      Math.max(target, this.performancePreset.minShortSide),
      this.performancePreset.maxShortSide,
    );
    for (const size of allowed) {
      if (size <= bounded) {
        return size;
      }
    }
    return allowed[allowed.length - 1] ?? FALLBACK_SHORT_SIDE;
  }

  private findResolutionIndex(size: number): number {
    const index = DYNAMIC_SHORT_SIDE_STEPS.findIndex(
      (option) => option === size,
    );
    if (index >= 0) {
      return index;
    }
    const resolved = this.resolveShortSide(size);
    return Math.max(DYNAMIC_SHORT_SIDE_STEPS.indexOf(resolved), 0);
  }

  private updateAdaptiveSamplerState(result: DetectorResult | null): void {
    const now = performance.now();
    const presence = result?.presence ?? this.lastPresenceSnapshot ?? null;
    if (presence) {
      this.adaptiveSampler.setPresenceState(presence.state, now);
    }
    const nextRisk = this.deriveRiskState(result, presence);
    if (nextRisk !== this.currentRiskState) {
      const previous = this.currentRiskState;
      this.currentRiskState = nextRisk;
      this.adaptiveSampler.setRiskState(nextRisk, now);
      logger.info("[Adaptive] Risk state change", {
        previous,
        next: nextRisk,
      });
    } else {
      this.adaptiveSampler.updateState({}, now);
    }
  }

  private emitEngineFrame(result: DetectorResult): void {
    const ipc = this.electron?.ipcRenderer;
    if (!ipc?.sendMessage) {
      return;
    }

    const diagnostics = {
      inputWidth: this.dynamicShortSide,
      frameIntervalMs:
        this.lastEngineFrameProcessedAt !== null
          ? result.processedAt - this.lastEngineFrameProcessedAt
          : undefined,
      fps: this.effectiveFps,
    } as EngineFramePayload["diagnostics"];

    const payload: EngineFramePayload = {
      result: {
        frameId: result.frameId,
        processedAt: result.processedAt,
        durationMs: result.durationMs,
        metrics: result.metrics,
        score: result.score,
        presence: result.presence,
        reliability: result.reliability,
        reliabilityReasons: result.reliabilityReasons,
      },
      diagnostics,
    };

    ipc.sendMessage(IPC_CHANNELS.engineFrame, payload);
    this.lastEngineFrameProcessedAt = result.processedAt;
  }

  private deriveRiskState(
    result: DetectorResult | null,
    presence: PresenceSnapshot | null,
  ): RiskState {
    if (result?.reliability === "UNRELIABLE") {
      return "UNRELIABLE";
    }
    const presenceState = presence?.state ?? this.presenceState;
    if (presenceState === "ABSENT") {
      return "IDLE";
    }
    const zone = result?.score?.zone ?? null;
    if (zone === "RED") {
      return "BAD_POSTURE";
    }
    if (zone === "YELLOW") {
      return "AT_RISK";
    }
    return "GOOD";
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

    this.applyAdaptiveSampler(timestamp);

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
    const downscaled = await downscaleFrame(bitmap, this.dynamicShortSide);
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
    this.metrics.lastMainThreadMs = downscaleDuration;
    if (downscaleDuration > MAIN_THREAD_BUDGET_MS) {
      this.metrics.mainThreadBudgetOverruns += 1;
      logger.warn("Main thread budget exceeded", {
        duration: downscaleDuration,
        budget: MAIN_THREAD_BUDGET_MS,
      });
    }

    const metadata = this.worker.nextFrameMetadata();
    this.inFlightFrames.set(metadata.id, frameStartMarker);
    const timeoutId = window.setTimeout(() => {
      this.handleFrameTimeout(metadata.id);
    }, FRAME_PROCESS_TIMEOUT_MS);
    this.frameTimeouts.set(metadata.id, timeoutId);

    this.worker.processFrame(downscaled.bitmap, metadata);

    this.scheduleNextFrame();
  }

  private updateDebugState(result: DetectorResult | null): void {
    const inference = result?.inference ?? null;
    const metrics: MetricValues | null = result?.metrics ?? null;
    const clonedLandmarks = cloneCombinedLandmarks(inference);
    const workerMetrics = metrics?.metrics ?? null;
    // Lazy fallback: only compute derived metrics if a specific series is missing
    let fallback: ReturnType<typeof computePoseMetrics> | null = null;
    const previous = this.debugState.metrics;

    const pitchRaw =
      workerMetrics?.pitch.raw ??
      (fallback ??= inference ? computePoseMetrics(inference) : null)?.pitch ??
      null;
    const pitchEma =
      workerMetrics?.pitch.smoothed ??
      updateSmoothedValue(previous.pitchEma, pitchRaw);

    const yawRaw = workerMetrics?.yaw.raw ?? null;
    const yawEma =
      workerMetrics?.yaw.smoothed ??
      updateSmoothedValue(previous.yawEma, yawRaw);

    const rollRaw = workerMetrics?.roll.raw ?? null;
    const rollEma =
      workerMetrics?.roll.smoothed ??
      updateSmoothedValue(previous.rollEma, rollRaw);

    const ehdRaw =
      workerMetrics?.ehd.raw ??
      (fallback ??= inference ? computePoseMetrics(inference) : null)?.ehd ??
      null;
    const ehdEma =
      workerMetrics?.ehd.smoothed ??
      updateSmoothedValue(previous.ehdEma, ehdRaw);

    const dprRaw =
      workerMetrics?.dpr.raw ??
      (fallback ??= inference ? computePoseMetrics(inference) : null)?.dpr ??
      null;
    const dprEma =
      workerMetrics?.dpr.smoothed ??
      updateSmoothedValue(previous.dprEma, dprRaw);

    const yawDeweighted = metrics?.flags.yawDeweighted ?? false;
    const lowConfidence = metrics?.flags.lowConfidence ?? false;
    const baselinePending = metrics?.flags.baselinePending ?? false;
    const baseline = metrics?.baselineFaceSize ?? null;
    const outliers = {
      pitch: workerMetrics?.pitch.outlier ?? false,
      yaw: workerMetrics?.yaw.outlier ?? false,
      roll: workerMetrics?.roll.outlier ?? false,
      ehd: workerMetrics?.ehd.outlier ?? false,
      dpr: workerMetrics?.dpr.outlier ?? false,
    } as const;

    const reliability: EngineReliability =
      result?.reliability ?? this.debugState.reliability ?? "OK";
    const reliabilityReasons = result?.reliabilityReasons ?? [];

    this.debugState = {
      landmarks: clonedLandmarks,
      metrics: {
        pitchRaw,
        pitchEma,
        yawRaw,
        yawEma,
        rollRaw,
        rollEma,
        ehdRaw,
        ehdEma,
        dprRaw,
        dprEma,
        yawDeweighted,
        lowConfidence,
        baselinePending,
        baseline,
        outliers,
      },
      reliability,
      reliabilityReasons: [...reliabilityReasons],
    } satisfies DetectionDebugState;
    if (typeof window !== "undefined") {
      window.__POSELY_DEBUG_STATE__ = this.debugState;
    }

    const presenceSnapshot = result?.presence ?? this.lastPresenceSnapshot;
    const illuminationConfidence =
      presenceSnapshot?.faceConfidence ?? inference?.face?.confidence ?? null;

    handleMetricsDebug({
      timestamp: metrics?.timestamp ?? Date.now(),
      frameId: metrics?.frameId ?? result?.frameId ?? null,
      presence: presenceSnapshot?.state ?? this.presenceState,
      faceConfidence: presenceSnapshot?.faceConfidence ?? null,
      poseConfidence: presenceSnapshot?.poseConfidence ?? null,
      illuminationConfidence,
      yawDeweighted,
      lowConfidence,
      baselinePending,
      baseline,
      reliability,
      reliabilityReasons,
      metrics: {
        pitch: {
          raw: pitchRaw,
          ema: pitchEma,
          confidence: workerMetrics?.pitch.confidence ?? "NONE",
          source: workerMetrics?.pitch.source ?? "unknown",
          outlier: outliers.pitch,
        },
        yaw: {
          raw: yawRaw,
          ema: yawEma,
          confidence: workerMetrics?.yaw.confidence ?? "NONE",
          source: workerMetrics?.yaw.source ?? "unknown",
          outlier: outliers.yaw,
        },
        roll: {
          raw: rollRaw,
          ema: rollEma,
          confidence: workerMetrics?.roll.confidence ?? "NONE",
          source: workerMetrics?.roll.source ?? "unknown",
          outlier: outliers.roll,
        },
        ehd: {
          raw: ehdRaw,
          ema: ehdEma,
          confidence: workerMetrics?.ehd.confidence ?? "NONE",
          source: workerMetrics?.ehd.source ?? "unknown",
          outlier: outliers.ehd,
        },
        dpr: {
          raw: dprRaw,
          ema: dprEma,
          confidence: workerMetrics?.dpr.confidence ?? "NONE",
          source: workerMetrics?.dpr.source ?? "unknown",
          outlier: outliers.dpr,
        },
      },
    });

    this.latestLandmarks = clonedLandmarks;
    this.notifyLandmarkListeners(clonedLandmarks);
  }

  private attachWorkers(): void {
    this.workerDisposers.push(
      this.worker.on("result", (result) => {
        this.clearFrameTimer(result.frameId);
        if (this.timedOutFrames.delete(result.frameId)) {
          logger.warn("Ignoring late detection result after timeout", {
            frameId: result.frameId,
          });
          return;
        }
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
        this.updateDebugState(result);
        this.handlePresenceSnapshot(result.presence ?? null);
        this.updateAdaptiveSamplerState(result);

        if (result.metrics) {
          emitSignalTrace(result.metrics);
        }

        this.emitEngineFrame(result);
      }),
    );

    this.workerDisposers.push(
      this.worker.on("error", (error) => {
        if (typeof error.frameId === "number") {
          this.clearFrameTimer(error.frameId);
          this.timedOutFrames.delete(error.frameId);
          const startMarker = this.inFlightFrames.get(error.frameId);
          if (typeof startMarker === "number") {
            this.governor.completeFrame(startMarker, performance.now());
            this.inFlightFrames.delete(error.frameId);
          }
        }
        logger.error("Detection worker emitted error", error);
        captureRendererException(
          new Error(`Detection worker error: ${error.message}`),
        );
        this.metrics.framesSkipped += 1;
        if (typeof error.frameId === "number") {
          this.inFlightFrames.delete(error.frameId);
        }
        this.updateDebugState(null);
        this.updateAdaptiveSamplerState(null);
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

  private notifyLandmarkListeners(landmarks: CombinedLandmarks | null): void {
    this.landmarkListeners.forEach((listener) => {
      try {
        listener(landmarks);
      } catch (error) {
        logger.warn("Landmark listener execution failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}

declare global {
  interface Window {
    __POSELY_DEBUG_STATE__?: DetectionDebugState;
  }
}
