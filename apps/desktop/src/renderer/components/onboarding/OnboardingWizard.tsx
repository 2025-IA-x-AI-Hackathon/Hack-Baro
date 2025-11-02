import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Progress,
  Spacer,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ElectronHandler } from "../../../main/preload";
import { IPC_CHANNELS } from "../../../shared/ipcChannels";
import type { RendererChannel } from "../../../shared/ipcChannels";
import { getLogger } from "../../../shared/logger";
import type { CalibrationCompletePayload } from "../../../shared/types/calibration";
import { CalibrationFlow } from "./CalibrationFlow";

type PermissionState =
  | "welcome"
  | "requesting"
  | "granted"
  | "denied"
  | "error";

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
  onComplete?: (payload: CalibrationCompletePayload | null) => void;
};

const logger = getLogger("onboarding-wizard", "renderer");

const getElectronApi = (electron?: ElectronHandler | null) => {
  if (electron) {
    return electron;
  }

  if (typeof window !== "undefined") {
    return window.electron;
  }

  return null;
};

export function OnboardingWizard({
  electron = null,
  onComplete,
}: OnboardingWizardProps) {
  const [permissionState, setPermissionState] =
    useState<PermissionState>("welcome");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);
  const [calibration, setCalibration] =
    useState<CalibrationCompletePayload | null>(null);
  const [isCalibrationLoading, setIsCalibrationLoading] = useState(false);
  const [calibrationLoadError, setCalibrationLoadError] = useState<
    string | null
  >(null);

  const electronApi = useMemo(() => getElectronApi(electron), [electron]);

  useEffect(() => {
    if (!electronApi || calibration) {
      return;
    }
    let cancelled = false;
    const loadExistingCalibration = async () => {
      const loadChannel: RendererChannel =
        electronApi.channels?.calibrationLoad ?? IPC_CHANNELS.calibrationLoad;
      try {
        setIsCalibrationLoading(true);
        const response = (await electronApi.ipcRenderer.invoke(
          loadChannel,
        )) as CalibrationCompletePayload | null;
        if (cancelled) {
          return;
        }
        if (response) {
          setCalibration(response);
          setPermissionState("granted");
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        logger.error("Failed to load existing calibration", {
          error: error instanceof Error ? error.message : String(error),
        });
        setCalibrationLoadError(
          "We couldn’t load your previous calibration. Please run calibration again.",
        );
      } finally {
        if (!cancelled) {
          setIsCalibrationLoading(false);
        }
      }
    };

    loadExistingCalibration().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      logger.error("Unexpected calibration load failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      setCalibrationLoadError(
        "We couldn’t load your previous calibration. Please run calibration again.",
      );
      setIsCalibrationLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [calibration, electronApi]);

  useEffect(() => {
    if (calibration) {
      onComplete?.(calibration);
    }
  }, [calibration, onComplete]);

  const requestPermission = useCallback(() => {
    if (!electronApi) {
      setPermissionState("error");
      setErrorMessage(
        "Camera permissions are unavailable because the Electron APIs could not be loaded.",
      );
      return;
    }

    const { ipcRenderer, channels } = electronApi;
    const requestChannel: RendererChannel =
      channels?.requestCameraPermission ?? IPC_CHANNELS.requestCameraPermission;
    setPermissionState("requesting");
    setErrorMessage(null);

    const invokePermission = async () => {
      try {
        const response = (await ipcRenderer.invoke(
          requestChannel,
        )) as CameraPermissionResponse;

        if (response?.granted) {
          setPermissionState("granted");
          return;
        }

        setPermissionState("denied");
        if (response?.error) {
          setErrorMessage(response.error);
        } else {
          setErrorMessage(
            "Camera access was denied. You can enable it via system settings to continue.",
          );
        }
      } catch (error: unknown) {
        logger.error("Failed to request camera permission", {
          error: error instanceof Error ? error.message : String(error),
        });
        setPermissionState("error");
        setErrorMessage(
          "We hit an unexpected error while requesting camera access. Please try again.",
        );
      }
    };

    invokePermission().catch((error: unknown) => {
      logger.error("Camera permission invocation failed unexpectedly", {
        error: error instanceof Error ? error.message : String(error),
      });
      setPermissionState("error");
      setErrorMessage(
        "We hit an unexpected error while requesting camera access. Please try again.",
      );
    });
  }, [electronApi]);

  const openSystemSettings = useCallback(() => {
    if (!electronApi) {
      setErrorMessage(
        "System settings cannot be opened because Electron APIs are unavailable.",
      );
      return;
    }

    const { ipcRenderer, channels } = electronApi;
    const openSettingsChannel: RendererChannel =
      channels?.openCameraPrivacySettings ??
      IPC_CHANNELS.openCameraPrivacySettings;
    setIsOpeningSettings(true);
    setErrorMessage(null);

    const invokeOpenSettings = async () => {
      try {
        const response = (await ipcRenderer.invoke(
          openSettingsChannel,
        )) as OpenSettingsResponse;

        if (!response?.success && response?.error) {
          setErrorMessage(response.error);
        }
      } catch (error: unknown) {
        logger.error("Failed to open system settings for camera permissions", {
          error: error instanceof Error ? error.message : String(error),
        });
        setErrorMessage(
          "Unable to open system settings automatically. Please open them manually to grant access.",
        );
      } finally {
        setIsOpeningSettings(false);
      }
    };

    invokeOpenSettings().catch((error: unknown) => {
      logger.error("Camera settings invocation failed unexpectedly", {
        error: error instanceof Error ? error.message : String(error),
      });
      setIsOpeningSettings(false);
      setErrorMessage(
        "Unable to open system settings automatically. Please open them manually to grant access.",
      );
    });
  }, [electronApi]);

  const renderCardBody = () => {
    switch (permissionState) {
      case "welcome":
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
      case "requesting":
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
      case "denied":
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
      case "error":
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

  if (!electronApi) {
    return (
      <Card className="w-full max-w-xl bg-black/40 text-left backdrop-blur-xl">
        <CardHeader className="flex flex-col gap-2 text-white">
          <h1 className="text-3xl font-semibold">Electron unavailable</h1>
        </CardHeader>
        <CardBody className="text-base text-white/80">
          Posely can’t access camera permissions or calibration because the
          Electron preload bridge is missing. Restart the app to continue.
        </CardBody>
      </Card>
    );
  }

  if (calibration) {
    // Onboarding finished; hand control back to parent.
    return null;
  }

  const shouldShowPermissionCard = permissionState !== "granted";
  const showCalibrationFlow = permissionState === "granted";

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {shouldShowPermissionCard ? (
        <Card className="bg-black/40 text-left backdrop-blur-xl">
          <CardHeader className="flex flex-col gap-2 text-white">
            <div className="text-sm uppercase tracking-wide text-white/60">
              Step 1 of 2
            </div>
            <h1 className="text-3xl font-semibold">
              Let&apos;s set up your posture coach
            </h1>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {renderCardBody()}
            {isCalibrationLoading ? (
              <div className="flex items-center gap-3 text-sm text-white/70">
                <Progress isIndeterminate aria-label="Checking calibration" />
                Checking previous calibration…
              </div>
            ) : null}
          </CardBody>
          {errorMessage ? (
            <CardFooter className="border-t border-white/10 pt-4">
              <p className="text-sm text-red-200">{errorMessage}</p>
            </CardFooter>
          ) : null}
          {calibrationLoadError ? (
            <CardFooter className="border-t border-white/10 pt-4">
              <p className="text-sm text-amber-200">{calibrationLoadError}</p>
            </CardFooter>
          ) : null}
        </Card>
      ) : null}

      {showCalibrationFlow ? (
        <CalibrationFlow
          electron={electronApi}
          completionDelayMs={600}
          onComplete={
            () => {}
            //   (payload) => {
            //   setCalibration(payload);
            // }
          }
        />
      ) : null}
    </div>
  );
}

OnboardingWizard.defaultProps = {
  electron: null,
  onComplete: undefined,
} satisfies Partial<OnboardingWizardProps>;
