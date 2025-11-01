const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const IPC_CHANNELS = {
  rendererPing: 'system:ping',
  workerRequest: 'worker:request',
  workerStatus: 'worker:status',
  workerResponse: 'worker:response',
};

const WORKER_MESSAGES = {
  ready: 'worker:ready',
};

let window = null;

const preloadPath = path.resolve(__dirname, 'preload.js');
const htmlPath = path.resolve(__dirname, 'index.html');

const createWindow = async () => {
  window = new BrowserWindow({
    width: 960,
    height: 640,
    show: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(htmlPath);
  await window.webContents.executeJavaScript(`
    (function setupHarness() {
      const electron = window.electron;
      window.__E2E_SCRIPT_READY = !!electron;
      if (!electron || !electron.ipcRenderer) {
        console.warn('Bridge unavailable');
        return;
      }

      const CHANNELS = {
        rendererPing: 'system:ping',
        workerRequest: 'worker:request',
        workerStatus: 'worker:status',
        workerResponse: 'worker:response',
      };

      const pingMainButton = document.querySelector('[data-testid="ping-main"]');
      const pingWorkerButton = document.querySelector('[data-testid="ping-worker"]');
      const mainResponse = document.querySelector('[data-testid="main-response"]');
      const workerStatus = document.querySelector('[data-testid="worker-status"]');
      const workerResponse = document.querySelector('[data-testid="worker-response"]');

      if (pingMainButton) {
        pingMainButton.addEventListener('click', () => {
          electron.ipcRenderer.sendMessage(CHANNELS.rendererPing, 'ping');
        });
      }

      if (pingWorkerButton) {
        pingWorkerButton.addEventListener('click', () => {
          electron.ipcRenderer.sendMessage(CHANNELS.workerRequest);
        });
      }

      electron.ipcRenderer.on(CHANNELS.rendererPing, (message) => {
        if (mainResponse) {
          mainResponse.textContent = String(message);
        }
      });

      electron.ipcRenderer.on(CHANNELS.workerStatus, (status) => {
        if (workerStatus) {
          workerStatus.textContent = typeof status === 'object' && status && status.state
            ? status.state
            : JSON.stringify(status);
        }
      });

      electron.ipcRenderer.on(CHANNELS.workerResponse, (payload) => {
        if (workerResponse) {
          workerResponse.textContent = typeof payload === 'object' && payload && payload.payload
            ? String(payload.payload)
            : JSON.stringify(payload);
        }
      });
    })();
  `);
  window.on('closed', () => {
    window = null;
  });
};

ipcMain.on(IPC_CHANNELS.rendererPing, (event, payload) => {
  globalThis.__e2eLastPing = payload;
  event.sender.send(
    IPC_CHANNELS.rendererPing,
    typeof payload === 'string' ? `pong:${payload}` : 'pong',
  );
});

ipcMain.on(IPC_CHANNELS.workerRequest, (event) => {
  globalThis.__e2eWorkerRequests = (globalThis.__e2eWorkerRequests ?? 0) + 1;
  event.sender.send(IPC_CHANNELS.workerStatus, {
    state: 'online',
    observedAt: new Date().toISOString(),
  });
  event.sender.send(IPC_CHANNELS.workerResponse, {
    type: WORKER_MESSAGES.ready,
    payload: 'worker:ready',
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(createWindow);
