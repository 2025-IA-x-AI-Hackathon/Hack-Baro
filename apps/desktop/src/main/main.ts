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
  Menu as ElectronMenu,
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
import { parseBooleanFlag } from "../shared/env";
import buildGuardrailOverridesFromRecord from "../shared/guardrails/overrides";
import {
  IPC_CHANNELS,
  WORKER_MESSAGES,
  type WorkerMessage,
} from "../shared/ipcChannels";
import { getLogger, toErrorPayload } from "../shared/logger";
import type { EngineFramePayload } from "../shared/types/engine-ipc";
import type { MetricValues } from "../shared/types/metrics";
import { isMetricValues, isRecord } from "../shared/validation/metricValues";
// TODO: check whether `openCameraPrivacySettings` is overlapping with cameraPermissions.ts
import {
  openCameraSettings,
  requestCameraPermission,
} from "./cameraPermissions";
import { getSetting, setSetting } from "./database/settingsRepository";
import registerCalibrationHandler from "./ipc/calibrationHandler";
import MenuBuilder from "./menu";
import { captureException } from "./sentry";
import { resolveHtmlPath } from "./util";
import {
  closeSettingsWindow,
  createSettingsWindow,
} from "./windows/settingsWindow";

dotenvExpand.expand(dotenv.config());

let mainWindow: BrowserWindow | null = null;
let backgroundWorker: Worker | null = null;
let tray: Tray | null = null;

const pendingWorkerMessages: WorkerMessage[] = [];
const logger = getLogger("main-process", "main");

const SIGNAL_TRACE_ENABLED = parseBooleanFlag(process.env.POSELY_SIGNAL_TRACE);
const DEFAULT_TRACE_DIR = path.join(os.homedir(), ".posely", "signal-traces");
const DEFAULT_TRACE_DIR_RESOLVED = path.resolve(DEFAULT_TRACE_DIR);
const SIGNAL_TRACE_FILE = process.env.POSELY_SIGNAL_TRACE_FILE
  ? path.resolve(process.env.POSELY_SIGNAL_TRACE_FILE)
  : null;
let signalTraceStream: fs.WriteStream | null = null;
let signalTracePath: string | null = null;
let signalTraceHeaderWritten = false;

const isPathWithinBase = (target: string, base: string): boolean => {
  const relative = path.relative(base, target);
  if (relative === "") {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

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
      break;
    case WORKER_MESSAGES.pong:
      mainWindow.webContents.send(
        IPC_CHANNELS.workerResponse,
        message.payload ?? null,
      );
      break;
    case WORKER_MESSAGES.engineTick:
      mainWindow.webContents.send(
        IPC_CHANNELS.engineTick,
        message.payload ?? null,
      );
      break;
    case WORKER_MESSAGES.engineError:
      logger.warn("Worker reported engine error", {
        payload: message.payload ?? null,
      });
      mainWindow.webContents.send(
        IPC_CHANNELS.workerStatus,
        message.payload ?? null,
      );
      break;
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

const createTray = () => {
  if (tray) {
    return tray;
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "../../assets");

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  // Create a simple 16x16 gray circle icon
  const trayIconPath = getAssetPath("icons", "16x16.png");

  // Create native image and resize for tray
  const icon = nativeImage.createFromPath(trayIconPath);
  const trayIcon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip("Posely - Posture Monitor");

  // Create context menu for tray
  const contextMenu = ElectronMenu.buildFromTemplate([
    {
      label: "Show Dashboard",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Settings",
      click: () => {
        createSettingsWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // On macOS, clicking the tray icon should show the main window
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  logger.info("System tray icon created");
  return tray;
};

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
  backgroundWorker.postMessage({ type: WORKER_MESSAGES.ping });
});

ipcMain.handle(IPC_CHANNELS.triggerMainError, () => {
  throw new Error("Intentional Main Process Error from Renderer");
});

// TODO: check whether `openCameraPrivacySettings` is overlapping with cameraPermissions.ts (`IPC_CHANNELS.requestCameraPermission`, `IPC_CHANNELS.openCameraSettings`)
ipcMain.handle(IPC_CHANNELS.openCameraPrivacySettings, async () => {
  const { platform } = process;
  const targets: Record<string, string> = {
    darwin:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
    win32: "ms-settings:privacy-webcam",
  };

  const fallbackUrl = "https://support.apple.com/en-us/HT211193";
  const target = targets[platform] ?? fallbackUrl;

  try {
    await shell.openExternal(target);
    return { opened: true };
  } catch (error: unknown) {
    logger.error(
      "Failed to open camera privacy settings",
      toErrorPayload(error),
    );
    throw error;
  }
});

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
    payload,
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
ipcMain.handle(IPC_CHANNELS.requestCameraPermission, () =>
  requestCameraPermission(),
);

ipcMain.handle(IPC_CHANNELS.openCameraSettings, () => openCameraSettings());

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

ipcMain.handle(IPC_CHANNELS.openSettings, () => {
  try {
    createSettingsWindow();
    return { success: true };
  } catch (error) {
    logger.error("Failed to open settings window", toErrorPayload(error));
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC_CHANNELS.reCalibrate, () => {
  try {
    // Close settings window if open
    closeSettingsWindow();

    // TODO: Trigger calibration flow from Story 1.2
    // For now, just log that we received the request
    logger.info("Re-calibration requested from settings");

    return { success: true };
  } catch (error) {
    logger.error("Failed to trigger re-calibration", toErrorPayload(error));
    return { success: false, error: String(error) };
  }
});

const isDebug =
  process.env.NODE_ENV === "development" || process.env.DEBUG_PROD === "true";

const shouldInstallDevtoolsExtensions =
  isDebug && process.env.ENABLE_DEVTOOLS_EXTENSIONS === "true";

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

const createWindow = async () => {
  // Check if onboarding has been completed
  const onboardingCompleted = getSetting("onboardingCompleted");
  logger.debug("Onboarding check", {
    onboardingCompleted,
    type: typeof onboardingCompleted,
  });
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

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "../../assets");

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
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

  if (shouldShowOnboarding) {
    // Load onboarding page
  }

  // Build URL and pass dev-time feature flags to renderer via query params
  const baseUrl = resolveHtmlPath("index.html");
  const url = new URL(baseUrl);
  if (process.env.PREFER_CONTINUITY_CAMERA === "true") {
    url.searchParams.set("preferContinuityCamera", "1");
  }

  mainWindow.loadURL(url.toString()).catch((error: unknown) => {
    logger.error("Failed to load main window URL", toErrorPayload(error));
  });

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
  if (backgroundWorker) {
    backgroundWorker.terminate().catch((error: unknown) => {
      logger.warn(
        "Failed to terminate background worker",
        toErrorPayload(error),
      );
    });
    backgroundWorker = null;
  }

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

const onAppReady = async () => {
  configureSecurityHeaders();
  registerCalibrationHandler();
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
  startWorker();
  await createWindow();
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
