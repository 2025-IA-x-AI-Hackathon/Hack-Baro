// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type RendererChannel } from '../shared/ipcChannels';

const validChannels = new Set<RendererChannel>(Object.values(IPC_CHANNELS));

const ensureChannelIsAllowed = (channel: RendererChannel) => {
  if (!validChannels.has(channel)) {
    throw new Error(`Attempted to use unsupported IPC channel: ${channel}`);
  }
};

export const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: RendererChannel, ...args: unknown[]) {
      ensureChannelIsAllowed(channel);
      ipcRenderer.send(channel, ...args);
    },
    on(channel: RendererChannel, func: (...args: unknown[]) => void) {
      ensureChannelIsAllowed(channel);
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: RendererChannel, func: (...args: unknown[]) => void) {
      ensureChannelIsAllowed(channel);
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
    invoke(channel: RendererChannel, ...args: unknown[]) {
      ensureChannelIsAllowed(channel);
      return ipcRenderer.invoke(channel, ...args);
    },
  },
  channels: IPC_CHANNELS,
  env: {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    POS_ENV: process.env.POS_ENV,
    DESKTOP_ENV: process.env.DESKTOP_ENV,
    SENTRY_DSN: process.env.SENTRY_DSN,
    ENABLE_SENTRY_IN_DEV: process.env.ENABLE_SENTRY_IN_DEV,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
    BETTER_STACK_TOKEN: process.env.BETTER_STACK_TOKEN,
    ENABLE_BETTER_STACK_IN_DEV: process.env.ENABLE_BETTER_STACK_IN_DEV,
    npm_package_version: process.env.npm_package_version,
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
