import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { ElectronHandler } from '../preload';
import { IPC_CHANNELS } from '../../shared/ipcChannels';

const listeners = new Map<string, (..._args: unknown[]) => void>();

vi.mock('electron', () => {
  const send = vi.fn();
  const removeListener = vi.fn(
    (channel: string, listener: (..._args: unknown[]) => void) => {
      const existing = listeners.get(channel);
      if (existing === listener) {
        listeners.delete(channel);
      }
    },
  );
  const on = vi.fn(
    (channel: string, listener: (..._args: unknown[]) => void) => {
      listeners.set(channel, listener);
    },
  );
  const once = vi.fn(
    (channel: string, listener: (..._args: unknown[]) => void) => {
      listeners.set(`${channel}:once`, listener);
    },
  );

  const contextBridge = {
    exposeInMainWorld: vi.fn(),
  };

  class FakeIpcRendererEvent {}

  return {
    contextBridge,
    ipcRenderer: {
      send,
      on,
      once,
      removeListener,
    },
    IpcRendererEvent: FakeIpcRendererEvent,
  };
});

type ElectronModule = typeof import('electron');

let electronHandler: ElectronHandler;
let electronMock: ElectronModule;

beforeAll(async () => {
  ({ electronHandler } = await import('../preload.js'));
});

beforeEach(async () => {
  electronMock = await import('electron');
});

afterEach(() => {
  listeners.clear();
  vi.clearAllMocks();
});

describe('electron preload bridge', () => {
  it('forwards msg to ipcRenderer when using allowed channel', () => {
    electronHandler.ipcRenderer.sendMessage(IPC_CHANNELS.rendererPing, 'hello');

    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith(
      IPC_CHANNELS.rendererPing,
      'hello',
    );
  });

  it('throws when attempting to use invalid channel', () => {
    expect(() =>
      electronHandler.ipcRenderer.sendMessage('invalid-channel' as never),
    ).toThrowError(/unsupported IPC channel/);
  });

  it('removes underlying listener on cleanup', () => {
    const handler = vi.fn();

    const dispose = electronHandler.ipcRenderer.on(
      IPC_CHANNELS.workerStatus,
      handler,
    );
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1);

    dispose();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledTimes(1);
  });

  it('normalizes listener args by stripping the Electron event object', () => {
    const handler = vi.fn();
    electronHandler.ipcRenderer.on(IPC_CHANNELS.workerResponse, handler);

    const listener = listeners.get(IPC_CHANNELS.workerResponse);
    expect(listener).toBeDefined();

    listener?.({} as never, { payload: 42 });

    expect(handler).toHaveBeenCalledWith({ payload: 42 });
  });
});
