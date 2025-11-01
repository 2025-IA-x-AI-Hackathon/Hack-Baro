import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const askForMediaAccess = vi.fn();
const openExternal = vi.fn();
const captureException = vi.fn();
const getLogger = vi.fn(() => ({
  error: vi.fn(),
}));

vi.mock('electron', () => ({
  systemPreferences: {
    askForMediaAccess,
  },
  shell: {
    openExternal,
  },
}));

vi.mock('../sentry', () => ({
  captureException,
}));

vi.mock('../shared/logger', () => ({
  getLogger,
}));

let requestCameraPermission: typeof import('../cameraPermissions.js').requestCameraPermission;
let openCameraSettings: typeof import('../cameraPermissions.js').openCameraSettings;

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  'platform',
);

type PlatformName = typeof process.platform;

const setPlatform = (platform: PlatformName) => {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
};

beforeEach(async () => {
  vi.resetModules();
  const module = await import('../cameraPermissions.js');
  requestCameraPermission = module.requestCameraPermission;
  openCameraSettings = module.openCameraSettings;
});

afterEach(() => {
  askForMediaAccess.mockReset();
  openExternal.mockReset();
  captureException.mockReset();
  getLogger.mockClear();
  if (originalPlatformDescriptor?.value) {
    setPlatform(originalPlatformDescriptor.value as PlatformName);
  }
});

afterAll(() => {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
});

describe('cameraPermissions', () => {
  it('requests camera permissions via system preferences on macOS', async () => {
    setPlatform('darwin');
    askForMediaAccess.mockResolvedValueOnce(true);

    const result = await requestCameraPermission();

    expect(askForMediaAccess).toHaveBeenCalledWith('camera');
    expect(result).toEqual({ granted: true });
  });

  it('skips system preferences on non-mac platforms', async () => {
    setPlatform('win32');

    const result = await requestCameraPermission();

    expect(askForMediaAccess).not.toHaveBeenCalled();
    expect(result).toEqual({ granted: true });
  });

  it('returns error when camera access request fails', async () => {
    const error = new Error('unavailable');
    setPlatform('darwin');
    askForMediaAccess.mockRejectedValueOnce(error);

    const result = await requestCameraPermission();

    expect(result.granted).toBe(false);
    expect(result.error).toBe('unavailable');
    expect(captureException).toHaveBeenCalledWith(error, {
      scope: 'camera:request',
    });
  });

  it('opens system settings on supported platforms', async () => {
    setPlatform('win32');
    openExternal.mockResolvedValueOnce(undefined);

    const result = await openCameraSettings();

    expect(openExternal).toHaveBeenCalledWith('ms-settings:privacy-webcam');
    expect(result).toEqual({ success: true });
  });

  it('returns an error for unsupported platforms', async () => {
    setPlatform('linux');

    const result = await openCameraSettings();

    expect(openExternal).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('linux');
  });

  it('captures exceptions when opening settings fails', async () => {
    const error = new Error('failed to open');
    setPlatform('darwin');
    openExternal.mockRejectedValueOnce(error);

    const result = await openCameraSettings();

    expect(result.success).toBe(false);
    expect(result.error).toBe('failed to open');
    expect(captureException).toHaveBeenCalledWith(error, {
      scope: 'camera:open-settings',
    });
  });
});
