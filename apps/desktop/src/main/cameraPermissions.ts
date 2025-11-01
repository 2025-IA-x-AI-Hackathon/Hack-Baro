import { shell, systemPreferences } from 'electron';
import { captureException } from './sentry';
import { getLogger } from '../shared/logger';

export type CameraPermissionResult = {
  granted: boolean;
  error?: string;
};

export type OpenCameraSettingsResult = {
  success: boolean;
  error?: string;
};

const logger = getLogger('camera-permissions', 'main');

const toErrorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

export const requestCameraPermission =
  async (): Promise<CameraPermissionResult> => {
    try {
      if (process.platform === 'darwin') {
        const granted = await systemPreferences.askForMediaAccess('camera');
        return { granted };
      }

      return { granted: true };
    } catch (error: unknown) {
      const payload = toErrorPayload(error);
      logger.error('Failed to request camera permission', payload);
      captureException(error, { scope: 'camera:request' });
      return { granted: false, error: payload.error };
    }
  };

export const openCameraSettings =
  async (): Promise<OpenCameraSettingsResult> => {
    try {
      let targetUrl: string | undefined;

      if (process.platform === 'darwin') {
        targetUrl =
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';
      } else if (process.platform === 'win32') {
        targetUrl = 'ms-settings:privacy-webcam';
      }

      if (!targetUrl) {
        return {
          success: false,
          error: `Opening camera settings is not supported on ${process.platform}`,
        };
      }

      await shell.openExternal(targetUrl);
      return { success: true };
    } catch (error: unknown) {
      const payload = toErrorPayload(error);
      logger.error('Failed to open system settings for camera access', payload);
      captureException(error, { scope: 'camera:open-settings' });
      return { success: false, error: payload.error };
    }
  };
