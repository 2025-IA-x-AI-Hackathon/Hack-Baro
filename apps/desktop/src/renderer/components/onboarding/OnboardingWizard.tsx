import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Progress,
  Spacer,
} from '@heroui/react';

import type { ElectronHandler } from '../../../main/preload';
import { IPC_CHANNELS } from '../../../shared/ipcChannels';
import { getLogger } from '../../../shared/logger';

type PermissionState =
  | 'welcome'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'error';

type CameraPermissionResponse = {
  granted?: boolean;
  error?: string;
};

type OpenSettingsResponse = {
  success?: boolean;
  error?: string;
};

export type OnboardingWizardProps = {
  electron?: ElectronHandler | null;
};

const logger = getLogger('onboarding-wizard', 'renderer');

const getElectronApi = (electron?: ElectronHandler | null) => {
  if (electron) {
    return electron;
  }

  if (typeof window !== 'undefined') {
    return window.electron;
  }

  return null;
};

export function OnboardingWizard({ electron = null }: OnboardingWizardProps) {
  const [permissionState, setPermissionState] =
    useState<PermissionState>('welcome');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);

  const electronApi = useMemo(() => getElectronApi(electron), [electron]);

  const requestPermission = useCallback(() => {
    if (!electronApi) {
      setPermissionState('error');
      setErrorMessage(
        'Camera permissions are unavailable because the Electron APIs could not be loaded.',
      );
      return;
    }

    const { ipcRenderer, channels } = electronApi;
    setPermissionState('requesting');
    setErrorMessage(null);

    const invokePermission = async () => {
      try {
        const response = (await ipcRenderer.invoke(
          channels?.REQUEST_CAMERA_PERMISSION ??
            IPC_CHANNELS.REQUEST_CAMERA_PERMISSION,
        )) as CameraPermissionResponse;

        if (response?.granted) {
          setPermissionState('granted');
          return;
        }

        setPermissionState('denied');
        if (response?.error) {
          setErrorMessage(response.error);
        } else {
          setErrorMessage(
            'Camera access was denied. You can enable it via system settings to continue.',
          );
        }
      } catch (error: unknown) {
        logger.error('Failed to request camera permission', {
          error: error instanceof Error ? error.message : String(error),
        });
        setPermissionState('error');
        setErrorMessage(
          'We hit an unexpected error while requesting camera access. Please try again.',
        );
      }
    };

    invokePermission().catch((error: unknown) => {
      logger.error('Camera permission invocation failed unexpectedly', {
        error: error instanceof Error ? error.message : String(error),
      });
      setPermissionState('error');
      setErrorMessage(
        'We hit an unexpected error while requesting camera access. Please try again.',
      );
    });
  }, [electronApi]);

  const openSystemSettings = useCallback(() => {
    if (!electronApi) {
      setErrorMessage(
        'System settings cannot be opened because Electron APIs are unavailable.',
      );
      return;
    }

    const { ipcRenderer, channels } = electronApi;
    setIsOpeningSettings(true);
    setErrorMessage(null);

    const invokeOpenSettings = async () => {
      try {
        const response = (await ipcRenderer.invoke(
          channels?.OPEN_CAMERA_SETTINGS ?? IPC_CHANNELS.OPEN_CAMERA_SETTINGS,
        )) as OpenSettingsResponse;

        if (!response?.success && response?.error) {
          setErrorMessage(response.error);
        }
      } catch (error: unknown) {
        logger.error('Failed to open system settings for camera permissions', {
          error: error instanceof Error ? error.message : String(error),
        });
        setErrorMessage(
          'Unable to open system settings automatically. Please open them manually to grant access.',
        );
      } finally {
        setIsOpeningSettings(false);
      }
    };

    invokeOpenSettings().catch((error: unknown) => {
      logger.error('Camera settings invocation failed unexpectedly', {
        error: error instanceof Error ? error.message : String(error),
      });
      setIsOpeningSettings(false);
      setErrorMessage(
        'Unable to open system settings automatically. Please open them manually to grant access.',
      );
    });
  }, [electronApi]);

  const renderCardBody = () => {
    switch (permissionState) {
      case 'welcome':
        return (
          <>
            <p className="text-base text-white/80">
              Welcome to Posely. We use your webcam to monitor posture locally
              on your device—no footage is ever uploaded or stored. To get
              started, we need permission to access your camera.
            </p>
            <Spacer y={4} />
            <Button
              color="primary"
              size="lg"
              onPress={requestPermission}
              className="w-full"
            >
              Next
            </Button>
          </>
        );
      case 'requesting':
        return (
          <>
            <p className="text-base text-white/80">
              Requesting camera access. Approve the system prompt to continue.
            </p>
            <Spacer y={4} />
            <Progress
              isIndeterminate
              aria-label="Requesting camera permission"
            />
          </>
        );
      case 'granted':
        return (
          <>
            <p className="text-base text-white/80">
              Thank you! Camera access is enabled. We&apos;ll guide you through
              positioning your workspace next.
            </p>
            <Spacer y={4} />
            <Button color="primary" size="lg" className="w-full" isDisabled>
              Continue
            </Button>
          </>
        );
      case 'denied':
        return (
          <>
            <p className="text-base text-white/80">
              We need camera access to monitor your posture in real time. You
              can enable the camera in your system settings, then return here to
              continue onboarding.
            </p>
            <Spacer y={4} />
            <Button
              color="secondary"
              size="lg"
              variant="bordered"
              className="w-full"
              onPress={openSystemSettings}
              isLoading={isOpeningSettings}
            >
              Open System Settings
            </Button>
          </>
        );
      case 'error':
        return (
          <>
            <p className="text-base text-white/80">
              Something went wrong while requesting camera access. Check your
              connection and try again.
            </p>
            <Spacer y={4} />
            <Button
              color="primary"
              size="lg"
              className="w-full"
              onPress={requestPermission}
            >
              Try Again
            </Button>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-xl bg-black/40 backdrop-blur-xl text-left">
      <CardHeader className="flex flex-col gap-2 text-white">
        <div className="text-sm uppercase tracking-wide text-white/60">
          Step {permissionState === 'granted' ? '2' : '1'} of 3
        </div>
        <h1 className="text-3xl font-semibold">
          Let&apos;s set up your posture coach
        </h1>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">{renderCardBody()}</CardBody>
      {errorMessage ? (
        <CardFooter className="border-t border-white/10 pt-4">
          <p className="text-sm text-red-200">{errorMessage}</p>
        </CardFooter>
      ) : null}
    </Card>
  );
}

OnboardingWizard.defaultProps = {
  electron: null,
} satisfies Partial<OnboardingWizardProps>;
