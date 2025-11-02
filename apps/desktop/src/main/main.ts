/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  session,
  shell,
} from "electron";
import log from "electron-log";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import { Worker } from "node:worker_threads";
import os from "os";
import path from "path";
import { deriveThresholds } from "../shared/calibration/sensitivity-presets";
import { parseBooleanFlag } from "../shared/env";
import buildGuardrailOverridesFromRecord from "../shared/guardrails/overrides";
import {
  IPC_CHANNELS,
  WORKER_MESSAGES,
  type WorkerMessage,
} from "../shared/ipcChannels";
import { getLogger, toErrorPayload } from "../shared/logger";
import type {
  CalibrationCompletePayload,
  CalibrationCustomThresholds,
  CalibrationFailure,
  CalibrationProgress,
  CalibrationSensitivityUpdateRequest,
  CalibrationSessionResult,
  CalibrationStartRequest,
  PostureCalibrationRecord,
} from "../shared/types/calibration";
import type { EngineTick } from "../shared/types/engine";
import type {
  EngineFramePayload,
  EngineTickPayload,
} from "../shared/types/engine-ipc";
import type { MetricValues } from "../shared/types/metrics";
import { isMetricValues, isRecord } from "../shared/validation/metricValues";
import {
  openCameraSettings,
  requestCameraPermission,
} from "./cameraPermissions";
import {
  startDashboardHttpServer,
  stopDashboardHttpServer,
} from "./dashboardHttpServer";
import {
  getActivePostureCalibration,
  markPostureCalibrationActive,
  savePostureCalibration,
  updatePostureCalibrationSensitivity,
} from "./database/calibrationRepository";
import {
  calculateStreak,
  getTodaySummary,
  getWeeklySummary,
} from "./database/dailyPostureRepository";
import { getSetting, setSetting } from "./database/settingsRepository";
import { createRendererTickHandler } from "./engineTickBridge";
import registerCalibrationHandler from "./ipc/calibrationHandler";
import MenuBuilder from "./menu";
import {
  processEngineTick,
  startPostureDataAggregator,
  stopPostureDataAggregator,
} from "./postureDataAggregator";
import { captureException } from "./sentry";
import { resolveHtmlPath } from "./util";

// E2E Testing: Type definitions for global test state
interface TrayIconState {
  lastIconPath: string;
  lastTooltip: string;
  updateCount: number;
  lastTick: EngineTick | null;
}

interface TrayMenuState {
  menuItemCount: number;
  separatorCount: number;
  menuStructure: Array<{
    label: string;
    type: string;
    enabled: boolean;
  }>;
}

declare global {
  // eslint-disable-next-line vars-on-top, no-underscore-dangle
  var __trayIconState: TrayIconState | undefined;
  // eslint-disable-next-line vars-on-top, no-underscore-dangle
  var __trayMenuState: TrayMenuState | undefined;
}

dotenvExpand.expand(dotenv.config());

let mainWindow: BrowserWindow | null = null;
let backgroundWorker: Worker | null = null;
let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let isPaused = false; // Story 3.3: Pause/Resume monitoring state

const pendingWorkerMessages: WorkerMessage[] = [];
const logger = getLogger("main-process", "main");

let latestEngineTick: EngineTick | null = null;

const isDebug =
  process.env.NODE_ENV === "development" || process.env.DEBUG_PROD === "true";

/**
 * Path to the assets directory (icons, images, etc.)
 */
const RESOURCES_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "assets")
  : path.join(__dirname, "../../assets");

/**
 * Get the full path to an asset file
 */
const getAssetPath = (...paths: string[]): string => {
  return path.join(RESOURCES_PATH, ...paths);
};

/**
 * Get neutral score threshold from environment or use default
 * NOTE: This function is kept for backward compatibility but the simple threshold
 * mode now uses the same three-color logic as production mode.
 */
const getNeutralThreshold = (): number => {
  const envValue = process.env.POSELY_SCORE_NEUTRAL;
  if (envValue) {
    const parsed = parseFloat(envValue);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      return parsed;
    }
  }
  // Default production thresholds (from Epic 4 Story 8)
  return 80; // Default value when POSELY_SCORE_NEUTRAL is not configured or invalid
};

/**
 * Score thresholds for tray icon colors
 * - score >= 80 → GREEN (good posture)
 * - score > 50 and score < 80 → YELLOW (at risk)
 * - score <= 50 → RED (bad posture)
 */
const SCORE_THRESHOLDS = {
  GREEN: 80,
  YELLOW: 51, // Yellow shows when score > 50 (so >= 51)
  RED: 50, // Red shows when score <= 50
} as const;

/**
 * Delay after showing/focusing a window before loading new content.
 * This ensures the window is fully visible and camera permissions are established,
 * preventing camera initialization failures when transitioning from hidden state.
 */
const WINDOW_SHOW_DELAY_MS = 100;

const NEUTRAL_THRESHOLD = getNeutralThreshold();
const USE_SIMPLE_THRESHOLD = !!process.env.POSELY_SCORE_NEUTRAL;

// Log tray icon configuration at startup
logger.info("Tray icon configuration", {
  mode: USE_SIMPLE_THRESHOLD ? "simple (testing)" : "production",
  neutralThreshold: NEUTRAL_THRESHOLD,
  envValue: process.env.POSELY_SCORE_NEUTRAL,
  productionThresholds: SCORE_THRESHOLDS,
});

/**
 * Get tray icon path based on EngineTick score
 * Rules (in priority order):
 * - IDLE/UNRELIABLE/INITIAL states: gray (neutral, non-alarming)
 * - Score-based colors for active states (see thresholds above)
 */
const getTrayIconPath = (tick: EngineTick): string => {
  // Handle envelope states (IDLE, UNRELIABLE, INITIAL) with neutral gray
  // INITIAL is the starting state before any posture data is available
  const isEnvelopeState =
    tick.state === "IDLE" ||
    tick.state === "UNRELIABLE" ||
    (tick.state as string) === "INITIAL";

  // Debug logging for envelope state check
  logger.info("getTrayIconPath debug", {
    state: tick.state,
    isEnvelopeState,
    score: tick.score,
    scoreType: typeof tick.score,
    neutralThreshold: NEUTRAL_THRESHOLD,
    useSimpleThreshold: USE_SIMPLE_THRESHOLD,
    scoreComparison:
      USE_SIMPLE_THRESHOLD && !isEnvelopeState
        ? `${tick.score} >= ${NEUTRAL_THRESHOLD} = ${tick.score >= NEUTRAL_THRESHOLD}`
        : "n/a",
  });

  if (isEnvelopeState) {
    return path.join(RESOURCES_PATH, "icons", "tray-gray.png");
  }

  // Three-color logic: GREEN >= 80, YELLOW 51-79, RED <= 50
  // Note: USE_SIMPLE_THRESHOLD kept for backward compatibility but uses same logic
  if (tick.score >= SCORE_THRESHOLDS.GREEN) {
    return path.join(RESOURCES_PATH, "icons", "tray-green.png");
  }
  if (tick.score > SCORE_THRESHOLDS.RED) {
    // score is between 51-79 (inclusive)
    return path.join(RESOURCES_PATH, "icons", "tray-yellow.png");
  }
  // score <= 50
  return path.join(RESOURCES_PATH, "icons", "tray-red.png");
};

/**
 * Get tooltip text based on EngineTick score and state
 * Follows non-judgmental microcopy from engine-output-contract.md
 * Uses score thresholds to determine appropriate message
 */
const getTrayTooltip = (tick: EngineTick): string => {
  // Handle envelope states first
  if (tick.state === "IDLE") {
    return "Paused — no one detected";
  }
  if (tick.state === "UNRELIABLE") {
    return "Tracking lost — face camera / improve lighting";
  }
  if ((tick.state as string) === "INITIAL") {
    return "Posely";
  }

  // Simple two-state messages when using POSELY_SCORE_NEUTRAL (testing mode)
  if (USE_SIMPLE_THRESHOLD) {
    if (tick.score >= NEUTRAL_THRESHOLD) {
      return tick.state === "RECOVERING"
        ? "Great — keep returning to neutral"
        : "You're aligned — nice!";
    }
    return "Let's sit tall again";
  }

  // Production three-state messages
  if (tick.score >= SCORE_THRESHOLDS.GREEN) {
    // Green zone (score >= 80)
    return tick.state === "RECOVERING"
      ? "Great — keep returning to neutral"
      : "You're aligned — nice!";
  }
  if (tick.score >= SCORE_THRESHOLDS.YELLOW) {
    // Yellow zone (score >= 60)
    return "Hold steady — almost there";
  }
  // Red zone (score < 60)
  return "Let's sit tall again";
};

/**
 * Get status label for tray context menu based on EngineTick
 */
const getStatusLabel = (tick: EngineTick | null): string => {
  if (!tick) {
    return "Status: Starting…";
  }

  // Handle envelope states
  if (tick.state === "IDLE") {
    return "Status: Paused";
  }
  if (tick.state === "UNRELIABLE") {
    return "Status: Tracking Lost";
  }
  if ((tick.state as string) === "INITIAL") {
    return "Status: Initializing…";
  }

  // Handle active states based on zone
  if (tick.zone === "GREEN") {
    return "Status: Good Posture ✓";
  }
  if (tick.zone === "YELLOW") {
    return "Status: At Risk ⚠";
  }
  // RED zone
  return "Status: Poor Posture ✗";
};

/**
 * Update tray context menu with current posture status
 *
 * Menu Grouping Philosophy (Story 1.5):
 * The menu is organized into 4 logical groups separated by visual dividers:
 *
 * 1. Status Group: Current posture state (informational only, disabled)
 *    - Displays dynamic status based on EngineTick state and zone
 *    - Examples: "Good Posture ✓", "At Risk ⚠", "Poor Posture ✗"
 *
 * 2. Application Group: Actions that open windows
 *    - "Show Desktop" - Opens/focuses the main monitoring window
 *    - "Show Dashboard" - Opens the analytics dashboard (separate window)
 *    - "Settings" - Will open settings window (Epic 3)
 *
 * 3. Monitoring Group: Controls for detection
 *    - "Pause Monitoring" / "Resume Monitoring" - Toggles detection on/off (Story 3.3)
 *
 * 4. System Group: App-level actions
 *    - "Quit Posely" - Terminates the application
 *
 * Visual hierarchy is created through separators (thin gray lines) that provide
 * implicit categorization without requiring text labels, maintaining clean minimalism
 * while improving usability and scannability.
 */
const updateTrayMenu = (tick: EngineTick | null) => {
  if (!tray) {
    return;
  }

  const statusLabel = getStatusLabel(tick);

  const contextMenu = Menu.buildFromTemplate([
    // === STATUS GROUP ===
    {
      label: statusLabel,
      enabled: false,
    },
    { type: "separator" }, // Separator after status

    // === APPLICATION GROUP ===
    {
      label: "Show Desktop",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          // eslint-disable-next-line no-use-before-define
          createWindow().catch((error: unknown) => {
            logger.error(
              "Failed to create main window from tray",
              toErrorPayload(error),
            );
          });
        }
      },
    },
    {
      label: "Show Dashboard",
      click: () => {
        // eslint-disable-next-line no-use-before-define
        createDashboardWindow();
      },
    },
    {
      label: "Settings",
      click: () => {
        // eslint-disable-next-line no-use-before-define
        createSettingsWindow();
      },
    },
    { type: "separator" }, // Separator after application controls

    // === MONITORING GROUP ===
    {
      label: isPaused ? "Resume Monitoring" : "Pause Monitoring",
      enabled: true, // Story 3.3: Pause/Resume functionality now implemented
      click: () => {
        // Toggle the paused state
        isPaused = !isPaused;

        logger.info(`Monitoring ${isPaused ? "paused" : "resumed"}`);

        // Send message to Worker Process to pause/resume
        if (backgroundWorker) {
          backgroundWorker.postMessage({
            type: WORKER_MESSAGES.setPaused,
            payload: isPaused,
          });
        }

        // Update tray icon to reflect paused state
        if (isPaused) {
          const pausedIconPath = getAssetPath("icons", "tray-gray.png");
          const pausedImage = nativeImage.createFromPath(pausedIconPath);
          tray?.setImage(pausedImage);
          tray?.setToolTip("Posely - Paused");
        } else if (latestEngineTick) {
          // Resume: Update icon based on latest tick
          // eslint-disable-next-line no-use-before-define
          updateTrayIcon(latestEngineTick);
        }

        // Broadcast status change to all renderer windows
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send("app:status-changed", { isPaused });
        });

        // Rebuild menu to update label
        updateTrayMenu(latestEngineTick);
      },
    },
    { type: "separator" }, // Separator before system actions

    // === SYSTEM GROUP ===
    {
      label: "Quit Posely",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // E2E Testing: Expose menu state for verification
  if (
    isDebug ||
    process.env.NODE_ENV === "test" ||
    process.env.E2E_TEST === "true"
  ) {
    const menuTemplate = contextMenu.items.map((item) => ({
      label: item.label,
      type: item.type,
      enabled: item.enabled,
    }));

    // eslint-disable-next-line no-underscore-dangle
    globalThis.__trayMenuState = {
      menuItemCount: menuTemplate.length,
      separatorCount: menuTemplate.filter((item) => item.type === "separator")
        .length,
      menuStructure: menuTemplate,
    };
  }
};

/**
 * Update tray icon and tooltip based on EngineTick score
 */
const updateTrayIcon = (tick: EngineTick) => {
  if (!tray) {
    return;
  }

  const trayInstance = tray; // Capture for type narrowing

  try {
    const iconPath = getTrayIconPath(tick);
    const tooltip = getTrayTooltip(tick);

    // Debug logging - always log to help diagnose issues
    logger.info("Tray icon update", {
      mode: USE_SIMPLE_THRESHOLD
        ? `simple (neutral=${NEUTRAL_THRESHOLD})`
        : "production",
      score: tick.score,
      state: tick.state,
      presence: tick.presence,
      reliability: tick.reliability,
      iconPath: iconPath.split("/").pop(), // Just the filename
      tooltip,
      isPaused,
    });

    // E2E Testing: Expose state for verification
    if (isDebug || process.env.NODE_ENV === "test") {
      // eslint-disable-next-line no-underscore-dangle
      const currentState = globalThis.__trayIconState;
      const updateCount = currentState ? currentState.updateCount + 1 : 1;
      // eslint-disable-next-line no-underscore-dangle
      globalThis.__trayIconState = {
        lastIconPath: iconPath,
        lastTooltip: tooltip,
        updateCount,
        lastTick: tick,
      };
    }

    // Use nativeImage to support both PNG and SVG
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      // DO NOT use setTemplateImage for colored icons
      // Template images are converted to monochrome by macOS
      // Only use template mode for monochrome icons that should adapt to light/dark mode
      if (process.platform === "darwin") {
        // For colored tray icons, we need to disable template mode
        image.setTemplateImage(false);
      }
      trayInstance.setImage(image);
      trayInstance.setToolTip(tooltip);
      // Update menu with current status
      updateTrayMenu(tick);
    } else {
      logger.warn("Failed to load tray icon", { iconPath });
    }
  } catch (error) {
    logger.error("Failed to update tray icon", toErrorPayload(error));
  }
};

const broadcastEngineTick = (tick: EngineTick) => {
  logger.info("🟢 broadcastEngineTick called", {
    score: tick.score,
    state: tick.state,
    presence: tick.presence,
    isPaused,
  });

  latestEngineTick = tick;

  // Update tray icon based on score (unless manually paused)
  // When paused, keep the gray icon
  if (!isPaused) {
    updateTrayIcon(tick);
  }

  // Process tick for data aggregation
  processEngineTick(tick);

  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.engineTick, tick);
  }
};

const forwardEngineTickToWorker = (tick: EngineTick) => {
  if (!backgroundWorker) {
    return;
  }

  try {
    backgroundWorker.postMessage({
      type: WORKER_MESSAGES.engineTick,
      payload: tick,
    });
  } catch (error) {
    logger.error(
      "Failed to forward EngineTick to worker",
      toErrorPayload(error),
    );
  }
};
const SIGNAL_TRACE_ENABLED = parseBooleanFlag(process.env.POSELY_SIGNAL_TRACE);
const DEFAULT_TRACE_DIR = path.join(os.homedir(), ".posely", "signal-traces");
const DEFAULT_TRACE_DIR_RESOLVED = path.resolve(DEFAULT_TRACE_DIR);
const SIGNAL_TRACE_FILE = process.env.POSELY_SIGNAL_TRACE_FILE
  ? path.resolve(process.env.POSELY_SIGNAL_TRACE_FILE)
  : null;
let signalTraceStream: fs.WriteStream | null = null;
let signalTracePath: string | null = null;
let signalTraceHeaderWritten = false;

type PendingCalibrationPromise = {
  resolve: (value: CalibrationCompletePayload) => void;
  reject: (reason: Error) => void;
};

let pendingCalibration: PendingCalibrationPromise | null = null;
let activeCalibration: CalibrationCompletePayload | null = null;

const isPathWithinBase = (target: string, base: string): boolean => {
  const relative = path.relative(base, target);
  if (relative === "") {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const handleRendererEngineTick = createRendererTickHandler({
  logger,
  broadcast: broadcastEngineTick,
  forwardToWorker: forwardEngineTickToWorker,
});

const resolveTracePath = (requested?: string | null): string => {
  if (SIGNAL_TRACE_FILE) {
    const resolvedRequested =
      requested && requested.trim().length > 0 ? path.resolve(requested) : null;
    if (resolvedRequested && resolvedRequested !== SIGNAL_TRACE_FILE) {
      logger.warn(
        "Ignoring renderer-provided signal trace path; using configured override instead",
        { requestedPath: resolvedRequested, allowedPath: SIGNAL_TRACE_FILE },
      );
    }
    return SIGNAL_TRACE_FILE;
  }

  if (requested && requested.trim().length > 0) {
    const candidate = path.resolve(requested);
    if (isPathWithinBase(candidate, DEFAULT_TRACE_DIR_RESOLVED)) {
      return candidate;
    }
    logger.warn("Rejected signal trace path outside allowed directory", {
      requestedPath: candidate,
      allowedBase: DEFAULT_TRACE_DIR_RESOLVED,
    });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_");
  const fileName = `signal-trace-${timestamp}.csv`;
  return path.join(DEFAULT_TRACE_DIR_RESOLVED, fileName);
};

const ensureSignalTraceStream = (requested?: string | null): fs.WriteStream => {
  if (signalTraceStream) {
    return signalTraceStream;
  }

  const targetPath = resolveTracePath(
    requested ?? signalTracePath ?? undefined,
  );
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const existed = fs.existsSync(targetPath);
  const stream = fs.createWriteStream(targetPath, { flags: "a" });
  signalTraceStream = stream;
  signalTracePath = targetPath;
  signalTraceHeaderWritten = existed && fs.statSync(targetPath).size > 0;

  if (!signalTraceHeaderWritten) {
    stream.write(
      "timestamp_ms,frame_id,metric,raw,smoothed,gated,reliability_paused,outlier,confidence\n",
    );
    signalTraceHeaderWritten = true;
  }

  logger.info("Signal trace logging enabled", { filePath: targetPath });
  return stream;
};

const formatSignalTraceNumber = (value: number | null): string => {
  if (value === null) {
    return "";
  }
  if (!Number.isFinite(value)) {
    return "";
  }
  return String(value);
};

const appendSignalTrace = (
  metrics: MetricValues,
  requestedPath?: string | null,
): void => {
  if (!SIGNAL_TRACE_ENABLED) {
    return;
  }

  try {
    const stream = ensureSignalTraceStream(requestedPath);
    const entries = Object.entries(metrics.metrics) as Array<
      [
        keyof MetricValues["metrics"],
        MetricValues["metrics"][keyof MetricValues["metrics"]],
      ]
    >;
    const lines = entries.map(([metric, series]) => {
      return [
        metrics.timestamp,
        metrics.frameId,
        metric,
        formatSignalTraceNumber(series.raw),
        formatSignalTraceNumber(series.smoothed),
        series.gated ? "1" : "0",
        series.reliabilityPaused ? "1" : "0",
        series.outlier ? "1" : "0",
        series.confidence,
      ].join(",");
    });
    stream.write(`${lines.join("\n")}\n`);
  } catch (error: unknown) {
    logger.warn("Failed to append signal trace entry", toErrorPayload(error));
  }
};

// SharedArrayBuffer requires both the Chromium feature flag and cross-origin isolation.
// The COOP/COEP headers are applied in configureSecurityHeaders(). Keep these in sync.
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

const broadcastCalibrationProgress = (progress: CalibrationProgress): void => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.calibrationProgress, progress);
};

const broadcastCalibrationFailure = (failure: CalibrationFailure): void => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.calibrationFailed, failure);
};

const broadcastCalibrationComplete = (
  payload: CalibrationCompletePayload,
): void => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.calibrationComplete, payload);
};

const resolveCustomThresholdsFromRecord = (
  record: PostureCalibrationRecord,
): CalibrationCustomThresholds | null => {
  const hasCustom =
    record.customPitchThreshold !== null ||
    record.customEHDThreshold !== null ||
    record.customDPRThreshold !== null;
  if (!hasCustom) {
    return null;
  }
  return {
    pitch: record.customPitchThreshold ?? undefined,
    ehd: record.customEHDThreshold ?? undefined,
    dpr: record.customDPRThreshold ?? undefined,
  } as CalibrationCustomThresholds;
};

const hydrateCalibrationPayload = (
  record: PostureCalibrationRecord,
): CalibrationCompletePayload => {
  const custom = resolveCustomThresholdsFromRecord(record);
  const baseline = {
    baselinePitch: record.baselinePitch,
    baselineEHD: record.baselineEHD,
    baselineDPR: record.baselineDPR,
    quality: record.quality,
    sampleCount: record.sampleCount,
  };
  const thresholds = deriveThresholds(baseline, record.sensitivity, custom);

  return {
    baseline,
    sensitivity: record.sensitivity,
    customThresholds: custom,
    thresholds,
    validation: {
      quality: record.quality,
      unreliableFrameRatio: 0,
      suggestion: record.quality < 60 ? "recalibrate_low_quality" : "ok",
    },
    calibrationId: record.id,
    recordedAt: record.calibratedAt,
  } satisfies CalibrationCompletePayload;
};

const reliabilityTracker = {
  samples: [] as number[],
  maxSamples: 500,
  threshold: 0.1,
  lastNudgeAt: 0,
};

const notifyWorkerCalibrationApplied = (): void => {
  if (!backgroundWorker || !activeCalibration) {
    return;
  }
  backgroundWorker.postMessage({
    type: WORKER_MESSAGES.calibrationApply,
    payload: {
      thresholds: activeCalibration.thresholds,
    },
  });
};

const persistCalibrationResult = (
  result: CalibrationSessionResult,
): CalibrationCompletePayload => {
  const timestamp = Date.now();
  const saved = savePostureCalibration({
    baselinePitch: result.baseline.baselinePitch,
    baselineEHD: result.baseline.baselineEHD,
    baselineDPR: result.baseline.baselineDPR,
    quality: result.baseline.quality,
    sampleCount: result.baseline.sampleCount,
    sensitivity: result.sensitivity,
    customThresholds: result.customThresholds ?? undefined,
    calibratedAt: timestamp,
  });

  markPostureCalibrationActive(saved.id, saved.userId);

  const hydrated = hydrateCalibrationPayload(saved);
  const payload: CalibrationCompletePayload = {
    ...hydrated,
    thresholds: result.thresholds,
    validation: result.validation,
  };
  activeCalibration = payload;
  reliabilityTracker.samples = [];
  reliabilityTracker.lastNudgeAt = 0;
  notifyWorkerCalibrationApplied();
  return payload;
};

const getWorkerCalibrationPayload = () => {
  if (!activeCalibration) {
    return null;
  }
  return {
    baselinePitch: activeCalibration.baseline.baselinePitch,
    baselineEHD: activeCalibration.baseline.baselineEHD,
    baselineDPR: activeCalibration.baseline.baselineDPR,
  };
};

const recordReliabilitySample = (isUnreliable: boolean): void => {
  reliabilityTracker.samples.push(isUnreliable ? 1 : 0);
  if (reliabilityTracker.samples.length > reliabilityTracker.maxSamples) {
    reliabilityTracker.samples.shift();
  }
};

const maybeEmitCalibrationNudge = (): void => {
  if (!mainWindow) {
    return;
  }
  const { samples, threshold } = reliabilityTracker;
  if (samples.length < 100) {
    return;
  }
  const ratio = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const now = Date.now();
  if (
    ratio >= threshold &&
    now - reliabilityTracker.lastNudgeAt > 4 * 60 * 60 * 1000
  ) {
    reliabilityTracker.lastNudgeAt = now;
    mainWindow.webContents.send(IPC_CHANNELS.calibrationNudge, {
      reason: "frequent-unreliable",
      ratio,
      observedAt: new Date(now).toISOString(),
    });
  }
};

const installExtensions = async (): Promise<void> => {
  try {
    const installerModule = await import("electron-devtools-installer");
    const { installExtension, REACT_DEVELOPER_TOOLS } = installerModule;

    const forceDownload = Boolean(process.env.UPGRADE_EXTENSIONS);
    await installExtension([REACT_DEVELOPER_TOOLS], {
      forceDownload,
    });
  } catch (error: unknown) {
    logger.warn(
      "Failed to install developer tools extensions",
      toErrorPayload(error),
    );
  }
};

const initializeAppUpdater = (): void => {
  log.transports.file.level = "info";
  autoUpdater.logger = log;

  autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    logger.warn(
      "Auto updater failed to check for updates",
      toErrorPayload(error),
    );
  });
};

const dispatchWorkerMessage = (message: WorkerMessage) => {
  if (!mainWindow) {
    if (message.type === WORKER_MESSAGES.engineTick) {
      const enginePayload = (message.payload ?? null) as
        | EngineTickPayload
        | null;
      const tick = enginePayload?.tick ?? null;
      if (tick) {
        broadcastEngineTick(tick);
        const reliability = tick.reliability ?? null;
        if (reliability) {
          recordReliabilitySample(reliability === "UNRELIABLE");
          maybeEmitCalibrationNudge();
        }
      }
      return;
    }

    pendingWorkerMessages.push(message);
    return;
  }

  switch (message.type) {
    case WORKER_MESSAGES.ready:
    case WORKER_MESSAGES.status:
      mainWindow.webContents.send(
        IPC_CHANNELS.workerStatus,
        message.payload ?? null,
      );
      if (message.type === WORKER_MESSAGES.ready) {
        notifyWorkerCalibrationApplied();
      }
      break;
    case WORKER_MESSAGES.pong:
      mainWindow.webContents.send(
        IPC_CHANNELS.workerResponse,
        message.payload ?? null,
      );
      break;
    case WORKER_MESSAGES.engineTick: {
      const enginePayload = message.payload as EngineTickPayload | null;
      const tick = enginePayload?.tick ?? null;

      if (tick) {
        broadcastEngineTick(tick);
        const reliability = tick.reliability ?? null;
        if (reliability) {
          recordReliabilitySample(reliability === "UNRELIABLE");
          maybeEmitCalibrationNudge();
        }
      } else {
        logger.warn("Received engine tick payload without tick", {
          payload: enginePayload,
        });
      }

      mainWindow.webContents.send(
        IPC_CHANNELS.engineTick,
        message.payload ?? null,
      );
      break;
    }
    case WORKER_MESSAGES.engineError:
      logger.warn("Worker reported engine error", {
        payload: message.payload ?? null,
      });
      mainWindow.webContents.send(
        IPC_CHANNELS.workerStatus,
        message.payload ?? null,
      );
      break;
    case WORKER_MESSAGES.calibrationProgress: {
      const progress = (message.payload ?? null) as CalibrationProgress | null;
      if (progress) {
        broadcastCalibrationProgress(progress);
      }
      break;
    }
    case WORKER_MESSAGES.calibrationComplete: {
      const result = (message.payload ??
        null) as CalibrationSessionResult | null;
      if (!result) {
        const failure: CalibrationFailure = {
          reason: "unknown",
          message: "Calibration complete payload was invalid.",
        };
        broadcastCalibrationFailure(failure);
        if (pendingCalibration) {
          pendingCalibration.reject(new Error(failure.message));
          pendingCalibration = null;
        }
        break;
      }

      try {
        const payload = persistCalibrationResult(result);
        broadcastCalibrationComplete(payload);
        if (pendingCalibration) {
          pendingCalibration.resolve(payload);
          pendingCalibration = null;
        }
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unknown error";
        const failure: CalibrationFailure = {
          reason: "unknown",
          message: `Failed to persist calibration: ${messageText}`,
        };
        broadcastCalibrationFailure(failure);
        if (pendingCalibration) {
          pendingCalibration.reject(new Error(failure.message));
          pendingCalibration = null;
        }
      }
      break;
    }
    case WORKER_MESSAGES.calibrationFailed: {
      const failurePayload = (message.payload ??
        null) as CalibrationFailure | null;
      const failure: CalibrationFailure = failurePayload ?? {
        reason: "unknown",
        message: "Calibration failed unexpectedly.",
      };
      broadcastCalibrationFailure(failure);
      if (pendingCalibration) {
        pendingCalibration.reject(new Error(failure.message));
        pendingCalibration = null;
      }
      break;
    }
    default:
      mainWindow.webContents.send(IPC_CHANNELS.workerResponse, {
        type: message.type,
        payload: message.payload ?? null,
      });
  }
};

const flushPendingWorkerMessages = () => {
  if (!mainWindow || pendingWorkerMessages.length === 0) {
    return;
  }

  const messages = pendingWorkerMessages.splice(
    0,
    pendingWorkerMessages.length,
  );
  messages.forEach((message) => {
    dispatchWorkerMessage(message);
  });

  if (latestEngineTick) {
    mainWindow.webContents.send(IPC_CHANNELS.engineTick, latestEngineTick);
  }
};

const WORKER_BUNDLE_FILES = {
  packaged: "worker.js",
  development: "worker.bundle.dev.js",
} as const;

const getWorkerEntrypoint = () =>
  app.isPackaged
    ? path.join(__dirname, WORKER_BUNDLE_FILES.packaged)
    : path.join(__dirname, WORKER_BUNDLE_FILES.development);

const startWorker = () => {
  if (backgroundWorker) {
    return backgroundWorker;
  }

  const workerEntrypoint = getWorkerEntrypoint();
  const guardrailOverrides = buildGuardrailOverridesFromRecord(
    process.env as Record<string, string | undefined>,
  );
  const debugHeadPose = parseBooleanFlag(
    process.env.POSELY_DEBUG_HEAD_POSE,
    false,
  );
  const debugGuardrailsVerbose = parseBooleanFlag(
    process.env.POSELY_DEBUG_GUARDRAILS_VERBOSE,
    false,
  );

  try {
    backgroundWorker = new Worker(workerEntrypoint, {
      workerData: {
        guardrailOverrides,
        debugHeadPose,
        debugGuardrailsVerbose,
      },
    });
    backgroundWorker.on("message", (message: WorkerMessage) => {
      dispatchWorkerMessage(message);
    });
    backgroundWorker.on("error", (error) => {
      logger.error("Worker process error", toErrorPayload(error));
      captureException(error, { scope: "worker:error" });
      dispatchWorkerMessage({
        type: WORKER_MESSAGES.status,
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
    backgroundWorker.on("exit", (code) => {
      if (code !== 0) {
        logger.warn("Worker exited with non-zero code", {
          code,
        });
        dispatchWorkerMessage({
          type: WORKER_MESSAGES.status,
          payload: {
            error: `Worker exited with code ${code}`,
          },
        });
      }
      backgroundWorker = null;
    });
  } catch (error: unknown) {
    logger.error("Failed to start background worker", toErrorPayload(error));
    captureException(error, { scope: "worker:start" });
    dispatchWorkerMessage({
      type: WORKER_MESSAGES.status,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  return backgroundWorker;
};

let securityConfigured = false;

const configureSecurityHeaders = () => {
  if (securityConfigured) {
    return;
  }

  const { defaultSession } = session;

  defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === "media") {
        callback(true);
        return;
      }

      logger.warn("Permission request denied", {
        url: webContents.getURL(),
        permission,
      });
      callback(false);
    },
  );

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const baseHeaders =
      details.responseHeaders || ({} as Record<string, string[]>);
    const responseHeaders = {
      ...baseHeaders,
      "Cross-Origin-Opener-Policy": ["same-origin"],
      "Cross-Origin-Embedder-Policy": ["require-corp"],
      "Cross-Origin-Resource-Policy": ["same-origin"],
    } as Record<string, string[]>;

    callback({
      responseHeaders,
    });
  });

  securityConfigured = true;
};

ipcMain.on(IPC_CHANNELS.engineCaptureTick, (_event, payload: unknown) => {
  logger.info("🔵 Received engineCaptureTick from renderer", {
    hasPayload: !!payload,
    payloadType: typeof payload,
    payloadKeys:
      payload && typeof payload === "object"
        ? Object.keys(payload as Record<string, unknown>)
        : [],
  });
  handleRendererEngineTick(payload);
});

ipcMain.on(IPC_CHANNELS.rendererPing, (event, arg) => {
  if (arg === "error") {
    throw new Error("Intentional Main Process Error");
  }
  const msgTemplate = (pingPong: string) => `IPC ping: ${pingPong}`;
  logger.info("Renderer ping received", { payload: arg });
  event.reply(IPC_CHANNELS.rendererPing, msgTemplate("pong"));
});

ipcMain.on(IPC_CHANNELS.workerRequest, (event) => {
  if (!backgroundWorker) {
    event.sender.send(IPC_CHANNELS.workerStatus, {
      state: "starting",
      observedAt: new Date().toISOString(),
    });
    event.sender.send(IPC_CHANNELS.workerResponse, {
      error: "Background worker not running yet",
    });
    startWorker();
    return;
  }

  event.sender.send(IPC_CHANNELS.workerStatus, {
    state: "online",
    observedAt: new Date().toISOString(),
  });
  if (latestEngineTick) {
    event.sender.send(IPC_CHANNELS.engineTick, latestEngineTick);
  }
  backgroundWorker.postMessage({ type: WORKER_MESSAGES.ping });
});

ipcMain.handle(IPC_CHANNELS.triggerMainError, () => {
  throw new Error("Intentional Main Process Error from Renderer");
});

ipcMain.handle(IPC_CHANNELS.openCameraPrivacySettings, () =>
  openCameraSettings(),
);

ipcMain.on(IPC_CHANNELS.triggerWorkerError, () => {
  if (backgroundWorker) {
    backgroundWorker.postMessage({
      type: WORKER_MESSAGES.triggerWorkerError,
    });
  }
});

ipcMain.on(IPC_CHANNELS.signalTraceAppend, (_event, payload: unknown) => {
  if (!SIGNAL_TRACE_ENABLED) {
    return;
  }

  if (!isRecord(payload)) {
    return;
  }

  const metricsCandidate = payload.metrics;
  if (!isMetricValues(metricsCandidate)) {
    return;
  }
  const metrics = metricsCandidate;

  const filePath =
    typeof payload.filePath === "string" ? payload.filePath : null;

  appendSignalTrace(metrics, filePath);
});

const isEngineFramePayload = (value: unknown): value is EngineFramePayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as EngineFramePayload;
  return (
    payload.result !== undefined &&
    typeof payload.result.frameId === "number" &&
    Number.isFinite(payload.result.frameId) &&
    typeof payload.result.processedAt === "number"
  );
};

ipcMain.on(IPC_CHANNELS.engineFrame, (_event, payload: unknown) => {
  if (!backgroundWorker) {
    logger.warn("Engine frame received before worker initialised", {
      payload,
    });
    return;
  }

  if (!isEngineFramePayload(payload)) {
    logger.warn("Rejected invalid engine frame payload", { payload });
    return;
  }

  backgroundWorker.postMessage({
    type: WORKER_MESSAGES.engineFrame,
    payload: {
      ...payload,
      calibration: getWorkerCalibrationPayload(),
    },
  });
});

app.on("before-quit", () => {
  if (signalTraceStream) {
    signalTraceStream.end();
    signalTraceStream = null;
    signalTracePath = null;
    signalTraceHeaderWritten = false;
  }
});
ipcMain.handle(
  IPC_CHANNELS.calibrationStart,
  (_event, payload: unknown): Promise<CalibrationCompletePayload> => {
    if (!backgroundWorker) {
      throw new Error("Calibration worker is not ready.");
    }
    if (pendingCalibration) {
      throw new Error("Calibration already in progress.");
    }

    const request = (payload ?? null) as CalibrationStartRequest | null;
    const options = {
      sensitivity: request?.sensitivity,
      customThresholds: request?.customThresholds ?? null,
      targetSamples: request?.targetSamples,
      minQuality: request?.minQuality,
      validationDurationMs: request?.validationDurationMs,
    } satisfies CalibrationStartRequest;

    return new Promise<CalibrationCompletePayload>((resolve, reject) => {
      pendingCalibration = { resolve, reject };
      backgroundWorker?.postMessage({
        type: WORKER_MESSAGES.calibrationStart,
        payload: options,
      });
    });
  },
);

ipcMain.handle(IPC_CHANNELS.calibrationLoad, () => {
  if (activeCalibration) {
    return activeCalibration;
  }
  const record = getActivePostureCalibration();
  if (!record) {
    return null;
  }
  const payload = hydrateCalibrationPayload(record);
  activeCalibration = payload;
  reliabilityTracker.samples = [];
  reliabilityTracker.lastNudgeAt = 0;
  notifyWorkerCalibrationApplied();
  return payload;
});

ipcMain.handle(
  IPC_CHANNELS.calibrationUpdateSensitivity,
  (_event, payload: unknown) => {
    const request = (payload ??
      null) as CalibrationSensitivityUpdateRequest | null;
    if (!request || typeof request.calibrationId !== "number") {
      throw new Error("Invalid calibration sensitivity update request.");
    }
    const updated = updatePostureCalibrationSensitivity(
      request.calibrationId,
      request.sensitivity,
      request.customThresholds ?? undefined,
    );
    if (!updated) {
      throw new Error("Calibration record not found.");
    }
    markPostureCalibrationActive(updated.id, updated.userId);
    const response = hydrateCalibrationPayload(updated);
    activeCalibration = response;
    reliabilityTracker.samples = [];
    reliabilityTracker.lastNudgeAt = 0;
    notifyWorkerCalibrationApplied();
    return response;
  },
);

ipcMain.handle(IPC_CHANNELS.requestCameraPermission, () =>
  requestCameraPermission(),
);

ipcMain.handle(IPC_CHANNELS.getDailySummary, () => {
  try {
    const summary = getTodaySummary();
    const streak = calculateStreak();
    return summary ? { ...summary, streak } : null;
  } catch (error) {
    logger.error("Failed to get daily summary", toErrorPayload(error));
    return null;
  }
});

ipcMain.handle(IPC_CHANNELS.getWeeklySummary, () => {
  try {
    const weeklySummary = getWeeklySummary();
    return weeklySummary;
  } catch (error) {
    logger.error("Failed to get weekly summary", toErrorPayload(error));
    return [];
  }
});

ipcMain.handle(IPC_CHANNELS.getSetting, (_event, key: string) => {
  try {
    return getSetting(key);
  } catch (error) {
    logger.error("Failed to get setting", toErrorPayload(error));
    return null;
  }
});

ipcMain.handle(
  IPC_CHANNELS.setSetting,
  (_event, key: string, value: string) => {
    try {
      setSetting(key, value);

      // Handle launch at startup setting
      if (key === "launchAtStartup") {
        const enabled = value === "true";
        app.setLoginItemSettings({
          openAtLogin: enabled,
        });
        logger.info(`Launch at startup ${enabled ? "enabled" : "disabled"}`);
      }

      return { success: true };
    } catch (error) {
      logger.error("Failed to set setting", toErrorPayload(error));
      return { success: false, error: String(error) };
    }
  },
);

ipcMain.handle(IPC_CHANNELS.reCalibrate, async () => {
  try {
    logger.info("Re-calibrate requested, starting standalone calibration");

    // Close settings window if open
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }

    // Prepare calibration URL
    const baseUrl = resolveHtmlPath("index.html");
    const url = new URL(baseUrl);
    url.hash = "#/calibration";
    if (process.env.PREFER_CONTINUITY_CAMERA === "true") {
      url.searchParams.set("preferContinuityCamera", "1");
    }

    // Navigate to standalone calibration (no wizard UI)
    if (mainWindow && !mainWindow.isDestroyed()) {
      // CRITICAL: Show and focus window BEFORE loading calibration
      // This ensures camera permissions and visibility are established
      mainWindow.show();
      mainWindow.focus();

      // Wait a brief moment for window to be fully visible
      // This prevents camera initialization failures when window was hidden
      await new Promise((resolve) => {
        setTimeout(resolve, WINDOW_SHOW_DELAY_MS);
      });

      await mainWindow.loadURL(url.toString());
      logger.info("Calibration route loaded successfully");
    } else {
      // If main window doesn't exist, create it and navigate to calibration
      // eslint-disable-next-line no-use-before-define
      await createWindow();
      logger.info("Created new window for recalibration");

      // Now navigate the newly created window to calibration
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        await new Promise((resolve) => {
          setTimeout(resolve, WINDOW_SHOW_DELAY_MS);
        });
        await mainWindow.loadURL(url.toString());
        logger.info("Navigated new window to calibration route");
      }
    }

    return { success: true };
  } catch (error) {
    logger.error("Failed to handle re-calibrate", toErrorPayload(error));
    return { success: false, error: String(error) };
  }
});

if (process.env.NODE_ENV === "production") {
  import("source-map-support")
    .then(({ install }) => {
      return install();
    })
    .catch((error: unknown) => {
      logger.warn(
        "Failed to install source map support",
        toErrorPayload(error),
      );
    });
}

const shouldInstallDevtoolsExtensions =
  isDebug && process.env.ENABLE_DEVTOOLS_EXTENSIONS === "true";

// E2E Testing: Expose tray state for verification
if (isDebug || process.env.NODE_ENV === "test") {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__trayIconState = {
    lastIconPath: "",
    lastTooltip: "",
    updateCount: 0,
    lastTick: null,
  };
}

if (isDebug) {
  import("electron-debug")
    .then(({ default: electronDebug }) => {
      return electronDebug({
        showDevTools: process.env.ENABLE_DEVTOOLS_EXTENSIONS === "true",
        devToolsMode: "detach",
      });
    })
    .catch((error: unknown) => {
      logger.warn(
        "Failed to enable electron debug tooling",
        toErrorPayload(error),
      );
    });
}

let dashboardWindow: BrowserWindow | null = null;

/**
 * Create and show the settings window
 */
const createSettingsWindow = () => {
  // If settings window already exists, focus it
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: false,
    icon: getAssetPath("icon.png"),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, "preload.js")
        : path.join(__dirname, "../../.erb/dll/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: process.env.ELECTRON_SANDBOX === "true",
      webSecurity: true,
    },
  });

  const baseUrl = resolveHtmlPath("index.html");
  const url = new URL(baseUrl);
  url.hash = "#/settings"; // Use hash routing for the settings

  settingsWindow.loadURL(url.toString()).catch((error: unknown) => {
    logger.error("Failed to load settings window", toErrorPayload(error));
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  logger.info("Settings window created");
};

// E2E Testing: Expose settings window creation for tests
if (
  process.env.NODE_ENV === "test" ||
  process.env.E2E_TEST === "true" ||
  !app.isPackaged
) {
  // eslint-disable-next-line no-underscore-dangle -- Test-only global variable
  (
    globalThis as typeof globalThis & { __createSettingsWindow?: () => void }
  ).__createSettingsWindow = createSettingsWindow;
}

/**
 * Create and show the dashboard window
 */
const createDashboardWindow = () => {
  // If dashboard window already exists, focus it
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 400,
    height: 600,
    resizable: false,
    icon: getAssetPath("icon.png"),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, "preload.js")
        : path.join(__dirname, "../../.erb/dll/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: process.env.ELECTRON_SANDBOX === "true",
      webSecurity: true,
      enableBlinkFeatures: "SharedArrayBuffer",
    },
  });

  const baseUrl = resolveHtmlPath("index.html");
  const url = new URL(baseUrl);
  url.hash = "#/dashboard"; // Use hash routing for the dashboard
  if (process.env.PREFER_CONTINUITY_CAMERA === "true") {
    url.searchParams.set("preferContinuityCamera", "1");
  }

  dashboardWindow.loadURL(url.toString()).catch((error: unknown) => {
    logger.error("Failed to load dashboard window", toErrorPayload(error));
  });

  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
  });

  // When dashboard window finishes loading, broadcast a data refresh to all windows
  // This ensures both the main window and dashboard window have the latest data
  dashboardWindow.webContents.once("did-finish-load", () => {
    logger.info(
      "Dashboard window loaded, broadcasting data refresh to all windows",
    );
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.postureDataUpdated);
      }
    });
  });

  logger.info("Dashboard window created");
};

/**
 * Initialize the system tray icon
 * Starts with gray (neutral) icon until first EngineTick received
 */
const createTray = () => {
  if (tray) {
    return tray;
  }

  const iconPath = getAssetPath("icons", "tray-gray.png");
  const image = nativeImage.createFromPath(iconPath);

  // DO NOT use setTemplateImage for colored icons
  // Template images are converted to monochrome by macOS
  if (process.platform === "darwin") {
    image.setTemplateImage(false);
  }

  try {
    tray = new Tray(image);
    tray.setToolTip("Posely - Starting up…");

    // Initialize context menu with organized structure
    // Will be updated dynamically as EngineTick updates arrive
    updateTrayMenu(null);

    logger.info("Tray icon initialized with organized menu structure", {
      iconPath,
      platform: process.platform,
    });
  } catch (error) {
    logger.error("Failed to create tray icon", toErrorPayload(error));
  }

  return tray;
};

const createWindow = async () => {
  // Prevent creating multiple windows
  if (mainWindow !== null) {
    logger.warn("Window already exists, skipping creation");
    return;
  }

  // Check if onboarding has been completed
  const onboardingCompleted = getSetting("onboardingCompleted");
  const shouldShowOnboarding = onboardingCompleted !== "true";

  if (shouldShowOnboarding) {
    logger.info("First launch detected, showing onboarding wizard");
  } else {
    logger.info("Onboarding completed, starting app normally");
  }

  if (shouldInstallDevtoolsExtensions) {
    await installExtensions();
  } else if (isDebug) {
    logger.info(
      "Skipping devtools extension installation for development. Set ENABLE_DEVTOOLS_EXTENSIONS=true to enable.",
    );
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: shouldShowOnboarding ? 800 : 1024,
    height: shouldShowOnboarding ? 600 : 728,
    icon: getAssetPath("icon.png"),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, "preload.js")
        : path.join(__dirname, "../../.erb/dll/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      // Keep sandbox disabled in dev by default. You can opt-in by
      // setting ELECTRON_SANDBOX=true when starting the app.
      sandbox: process.env.ELECTRON_SANDBOX === "true",
      webSecurity: true,
      enableBlinkFeatures: "SharedArrayBuffer",
    },
  });

  // Build URL and pass dev-time feature flags to renderer via query params
  const baseUrl = resolveHtmlPath("index.html");
  const url = new URL(baseUrl);
  if (process.env.PREFER_CONTINUITY_CAMERA === "true") {
    url.searchParams.set("preferContinuityCamera", "1");
  }

  // Set hash route based on onboarding status
  if (shouldShowOnboarding) {
    url.hash = "#/onboarding";
  }

  await mainWindow.loadURL(url.toString());

  mainWindow.webContents.once("did-finish-load", () => {
    flushPendingWorkerMessages();
    // In production ensure the window becomes visible after content is loaded
    if (!isDebug) {
      try {
        if (process.env.START_MINIMIZED) {
          mainWindow?.minimize();
        } else {
          mainWindow?.show();
        }
      } catch (err: unknown) {
        logger.warn(
          "Failed to show window after did-finish-load",
          toErrorPayload(err),
        );
      }
    }
  });

  // Dev-only fallbacks to avoid invisible window on early renderer issues
  if (isDebug && mainWindow) {
    mainWindow.webContents.on(
      "did-fail-load",
      (_e, code, desc, validatedURL) => {
        logger.error("Renderer failed to load", { code, desc, validatedURL });
        try {
          mainWindow?.show();
          if (process.env.DEVTOOLS_OPEN_ON_FALLBACK === "true") {
            mainWindow?.webContents.openDevTools({ mode: "detach" });
          }
        } catch (err: unknown) {
          logger.warn(
            "Failed to show window after load failure",
            toErrorPayload(err),
          );
        }
      },
    );

    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        logger.warn("Forcing window visible in dev (fallback show)");
        try {
          mainWindow.show();
          if (process.env.DEVTOOLS_OPEN_ON_FALLBACK === "true") {
            mainWindow.webContents.openDevTools({ mode: "detach" });
          }
        } catch (err: unknown) {
          logger.warn("Fallback show failed", toErrorPayload(err));
        }
      }
    }, 3000);
  }

  mainWindow.on("ready-to-show", () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url).catch((error: unknown) => {
      logger.error(
        "Failed to open external URL from main window",
        toErrorPayload(error),
      );
    });
    return { action: "deny" };
  });

  // Remove this if your app does not use auto updates
  initializeAppUpdater();
};

/**
 * Add event listeners...
 */

app.on("before-quit", () => {
  // Stop posture data aggregator and save any pending data
  stopPostureDataAggregator();
  stopDashboardHttpServer();

  if (backgroundWorker) {
    backgroundWorker.terminate().catch((error: unknown) => {
      logger.warn(
        "Failed to terminate background worker",
        toErrorPayload(error),
      );
    });
    backgroundWorker = null;
  }

  // Clean up tray icon
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on("window-all-closed", () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow().catch((error: unknown) => {
      logger.error(
        "Failed to create window after activation",
        toErrorPayload(error),
      );
    });
  }
});

const onAppReady = async () => {
  configureSecurityHeaders();
  // Initialize database BEFORE any other operations that might use it
  try {
    const { initializeDatabase } = await import("./database/client.js");
    initializeDatabase();
    logger.info("Database initialized successfully");
  } catch (error: unknown) {
    logger.error("Failed to initialize database", toErrorPayload(error));
    throw error;
  }

  registerCalibrationHandler({
    onBaselineSaved: () => {
      if (backgroundWorker) {
        backgroundWorker.postMessage({
          type: WORKER_MESSAGES.refreshBaseline,
        });
      }
    },
  });

  const existingCalibration = getActivePostureCalibration();
  if (existingCalibration) {
    activeCalibration = hydrateCalibrationPayload(existingCalibration);
    notifyWorkerCalibrationApplied();
  }

  // Apply launch at startup setting
  try {
    const launchAtStartupValue = getSetting("launchAtStartup");
    const enabled = launchAtStartupValue === "true";
    app.setLoginItemSettings({
      openAtLogin: enabled,
    });
    logger.info(`Launch at startup ${enabled ? "enabled" : "disabled"}`);
  } catch (error) {
    logger.warn(
      "Failed to apply launch at startup setting",
      toErrorPayload(error),
    );
  }

  // In production, avoid relative file reads resolving to protected folders like Desktop
  if (!isDebug) {
    try {
      const logsDir = app.getPath("userData");
      process.chdir(logsDir);
      logger.info("Changed working directory for safety", {
        cwd: process.cwd(),
      });
    } catch (err: unknown) {
      logger.warn("Failed to change working directory", toErrorPayload(err));
    }
  }
  // Initialize tray icon before starting worker and window
  createTray();
  startDashboardHttpServer();
  // Start posture data aggregator with callback to broadcast updates
  startPostureDataAggregator(() => {
    // Broadcast data update to all windows
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.postureDataUpdated);
      }
    });
    logger.info("Broadcasted posture data update to all windows", {
      windowCount: allWindows.length,
    });
  });
  startWorker();
  await createWindow();

  // DEV ONLY: Add keyboard shortcuts to test tray icon with different scores
  // NOTE: Global shortcuts can interfere with macOS system shortcuts (like Cmd+Shift+4 for screenshots)
  // Set DISABLE_TEST_SHORTCUTS=true to disable these shortcuts
  if (isDebug && process.env.DISABLE_TEST_SHORTCUTS !== "true") {
    const { globalShortcut } = await import("electron");

    // Cmd+1: Test with score 90 (green)
    globalShortcut.register("CommandOrControl+1", () => {
      // Unpause monitoring to allow icon change
      if (isPaused) {
        isPaused = false;
        logger.info("🧪 TEST: Auto-unpaused monitoring for testing");
      }

      const testTick: EngineTick = {
        t: Date.now(),
        presence: "PRESENT",
        reliability: "OK",
        zone: "GREEN",
        state: "GOOD",
        score: 90,
        metrics: { pitchDeg: 5, ehdNorm: 0.08, dpr: 1.02, conf: 0.9 },
      };
      logger.info("🧪 TEST: Injecting high score EngineTick (90)", testTick);
      broadcastEngineTick(testTick);
    });

    // Cmd+2: Test with score 65 (yellow - below threshold)
    globalShortcut.register("CommandOrControl+2", () => {
      // Unpause monitoring to allow icon change
      if (isPaused) {
        isPaused = false;
        logger.info("🧪 TEST: Auto-unpaused monitoring for testing");
      }

      const testTick: EngineTick = {
        t: Date.now(),
        presence: "PRESENT",
        reliability: "OK",
        zone: "YELLOW",
        state: "AT_RISK",
        score: 65,
        metrics: { pitchDeg: 15, ehdNorm: 0.15, dpr: 1.08, conf: 0.85 },
      };
      logger.info(
        "🧪 TEST: Injecting below-threshold score EngineTick (65)",
        testTick,
      );
      broadcastEngineTick(testTick);
    });

    // Cmd+3: Test with score 50 (red)
    globalShortcut.register("CommandOrControl+3", () => {
      // Unpause monitoring to allow icon change
      if (isPaused) {
        isPaused = false;
        logger.info("🧪 TEST: Auto-unpaused monitoring for testing");
      }

      const testTick: EngineTick = {
        t: Date.now(),
        presence: "PRESENT",
        reliability: "OK",
        zone: "RED",
        state: "BAD_POSTURE",
        score: 50,
        metrics: { pitchDeg: 25, ehdNorm: 0.22, dpr: 1.12, conf: 0.8 },
      };
      logger.info("🧪 TEST: Injecting low score EngineTick (50)", testTick);
      broadcastEngineTick(testTick);
    });

    // Cmd+4: Test IDLE state (gray)
    globalShortcut.register("CommandOrControl+4", () => {
      // IDLE state should work even when paused
      const testTick: EngineTick = {
        t: Date.now(),
        presence: "ABSENT",
        reliability: "OK",
        zone: "GREEN",
        state: "IDLE",
        score: 70,
        metrics: { pitchDeg: 0, ehdNorm: 0, dpr: 1.0, conf: 0 },
      };
      logger.info("🧪 TEST: Injecting IDLE EngineTick (gray)", testTick);

      // For IDLE state, update icon directly regardless of pause state
      updateTrayIcon(testTick);
      latestEngineTick = testTick;
    });

    logger.info("🎹 Test keyboard shortcuts registered", {
      shortcuts: [
        "Cmd+1: Score 90 (GREEN) - auto-unpauses",
        "Cmd+2: Score 65 (YELLOW) - auto-unpauses",
        "Cmd+3: Score 50 (RED) - auto-unpauses",
        "Cmd+4: IDLE (GRAY) - works regardless of pause state",
        "Note: Set DISABLE_TEST_SHORTCUTS=true to disable if interfering with system shortcuts",
      ],
      mode: USE_SIMPLE_THRESHOLD
        ? `Simple mode: score >= ${NEUTRAL_THRESHOLD} = green, < ${NEUTRAL_THRESHOLD} = red`
        : "Production mode: >=80 green, >=60 yellow, <60 red",
    });
  }
};

app
  .whenReady()
  .then(onAppReady)
  .catch((error: unknown) => {
    logger.error(
      "Failed to initialise Electron application",
      toErrorPayload(error),
    );
  });
