/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { Worker } from 'node:worker_threads';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { captureException } from './sentry';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import {
  IPC_CHANNELS,
  WORKER_MESSAGES,
  type WorkerMessage,
} from '../shared/ipcChannels';
import {
  openCameraSettings,
  requestCameraPermission,
} from './cameraPermissions';
import { getLogger } from '../shared/logger';

let mainWindow: BrowserWindow | null = null;
let backgroundWorker: Worker | null = null;

const pendingWorkerMessages: WorkerMessage[] = [];
const logger = getLogger('main-process', 'main');

const toErrorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

const installExtensions = async (): Promise<void> => {
  try {
    const installerModule = await import('electron-devtools-installer');
    const { installExtension, REACT_DEVELOPER_TOOLS } = installerModule;

    const forceDownload = Boolean(process.env.UPGRADE_EXTENSIONS);
    await installExtension([REACT_DEVELOPER_TOOLS], {
      forceDownload,
    });
  } catch (error: unknown) {
    logger.warn(
      'Failed to install developer tools extensions',
      toErrorPayload(error),
    );
  }
};

const initializeAppUpdater = (): void => {
  log.transports.file.level = 'info';
  autoUpdater.logger = log;

  autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    logger.warn(
      'Auto updater failed to check for updates',
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
  packaged: 'worker.js',
  development: 'worker.bundle.dev.js',
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

  try {
    backgroundWorker = new Worker(workerEntrypoint);
    backgroundWorker.on('message', (message: WorkerMessage) => {
      dispatchWorkerMessage(message);
    });
    backgroundWorker.on('error', (error) => {
      logger.error('Worker process error', toErrorPayload(error));
      captureException(error, { scope: 'worker:error' });
      dispatchWorkerMessage({
        type: WORKER_MESSAGES.status,
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
    backgroundWorker.on('exit', (code) => {
      if (code !== 0) {
        logger.warn('Worker exited with non-zero code', {
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
    logger.error('Failed to start background worker', toErrorPayload(error));
    captureException(error, { scope: 'worker:start' });
    dispatchWorkerMessage({
      type: WORKER_MESSAGES.status,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  return backgroundWorker;
};

ipcMain.on(IPC_CHANNELS.rendererPing, (event, arg) => {
  if (arg === 'error') {
    throw new Error('Intentional Main Process Error');
  }
  const msgTemplate = (pingPong: string) => `IPC ping: ${pingPong}`;
  logger.info('Renderer ping received', { payload: arg });
  event.reply(IPC_CHANNELS.rendererPing, msgTemplate('pong'));
});

ipcMain.on(IPC_CHANNELS.workerRequest, (event) => {
  if (!backgroundWorker) {
    event.sender.send(IPC_CHANNELS.workerStatus, {
      state: 'starting',
      observedAt: new Date().toISOString(),
    });
    event.sender.send(IPC_CHANNELS.workerResponse, {
      error: 'Background worker not running yet',
    });
    startWorker();
    return;
  }

  event.sender.send(IPC_CHANNELS.workerStatus, {
    state: 'online',
    observedAt: new Date().toISOString(),
  });
  backgroundWorker.postMessage({ type: WORKER_MESSAGES.ping });
});

ipcMain.handle(IPC_CHANNELS.TRIGGER_MAIN_ERROR, () => {
  throw new Error('Intentional Main Process Error from Renderer');
});

ipcMain.on(IPC_CHANNELS.TRIGGER_WORKER_ERROR, () => {
  if (backgroundWorker) {
    backgroundWorker.postMessage({
      type: WORKER_MESSAGES.TRIGGER_WORKER_ERROR,
    });
  }
});

ipcMain.handle(IPC_CHANNELS.REQUEST_CAMERA_PERMISSION, () =>
  requestCameraPermission(),
);

ipcMain.handle(IPC_CHANNELS.OPEN_CAMERA_SETTINGS, () => openCameraSettings());

if (process.env.NODE_ENV === 'production') {
  import('source-map-support')
    .then(({ install }) => {
      return install();
    })
    .catch((error: unknown) => {
      logger.warn(
        'Failed to install source map support',
        toErrorPayload(error),
      );
    });
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

const shouldInstallDevtoolsExtensions =
  isDebug && process.env.ENABLE_DEVTOOLS_EXTENSIONS === 'true';

if (isDebug) {
  import('electron-debug')
    .then(({ default: electronDebug }) => {
      return electronDebug({
        showDevTools: process.env.ENABLE_DEVTOOLS_EXTENSIONS === 'true',
      });
    })
    .catch((error: unknown) => {
      logger.warn(
        'Failed to enable electron debug tooling',
        toErrorPayload(error),
      );
    });
}

const createWindow = async () => {
  if (shouldInstallDevtoolsExtensions) {
    await installExtensions();
  } else if (isDebug) {
    logger.info(
      'Skipping devtools extension installation for development. Set ENABLE_DEVTOOLS_EXTENSIONS=true to enable.',
    );
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  await mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    flushPendingWorkerMessages();
  });

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url).catch((error: unknown) => {
      logger.error(
        'Failed to open external URL from main window',
        toErrorPayload(error),
      );
    });
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  initializeAppUpdater();
};

/**
 * Add event listeners...
 */

app.on('before-quit', () => {
  if (backgroundWorker) {
    backgroundWorker.terminate().catch((error: unknown) => {
      logger.warn(
        'Failed to terminate background worker',
        toErrorPayload(error),
      );
    });
    backgroundWorker = null;
  }
});

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const onAppReady = async () => {
  startWorker();
  await createWindow();
  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
      createWindow().catch((error: unknown) => {
        logger.error(
          'Failed to create window after activation',
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
      'Failed to initialise Electron application',
      toErrorPayload(error),
    );
  });
