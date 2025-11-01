const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set([
  "system:ping",
  "worker:request",
  "worker:status",
  "worker:response",
  "calibration:request",
]);

const ensureAllowed = (channel) => {
  if (!CHANNELS.has(channel)) {
    throw new Error(`Unsupported channel requested in preload: ${channel}`);
  }
};

const api = {
  ipcRenderer: {
    sendMessage(channel, ...args) {
      ensureAllowed(channel);
      ipcRenderer.send(channel, ...args);
    },
    on(channel, callback) {
      ensureAllowed(channel);
      const subscription = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
    once(channel, callback) {
      ensureAllowed(channel);
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    },
    invoke(channel, ...args) {
      ensureAllowed(channel);
      return ipcRenderer.invoke(channel, ...args);
    },
  },
};

contextBridge.exposeInMainWorld("electron", api);
