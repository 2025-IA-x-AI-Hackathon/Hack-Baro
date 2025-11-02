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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["common"]);
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
          t("onboarding.wizard.messages.calibrationLoadError"),
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
        t("onboarding.wizard.messages.calibrationLoadError"),
      );
      setIsCalibrationLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [calibration, electronApi, t]);

  useEffect(() => {
    if (calibration) {
      onComplete?.(calibration);
    }
  }, [calibration, onComplete]);

  const requestPermission = useCallback(() => {
    if (!electronApi) {
      setPermissionState("error");
      setErrorMessage(t("onboarding.wizard.messages.permissionUnavailable"));
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
          setErrorMessage(t("onboarding.wizard.messages.permissionDenied"));
        }
      } catch (error: unknown) {
        logger.error("Failed to request camera permission", {
          error: error instanceof Error ? error.message : String(error),
        });
        setPermissionState("error");
        setErrorMessage(t("onboarding.wizard.messages.permissionError"));
      }
    };

    invokePermission().catch((error: unknown) => {
      logger.error("Camera permission invocation failed unexpectedly", {
        error: error instanceof Error ? error.message : String(error),
      });
      setPermissionState("error");
      setErrorMessage(t("onboarding.wizard.messages.permissionError"));
    });
  }, [electronApi, t]);

  const openSystemSettings = useCallback(() => {
    if (!electronApi) {
      setErrorMessage(t("onboarding.wizard.messages.settingsUnavailable"));
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
          t("onboarding.wizard.messages.settingsOpenError"),
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
      setErrorMessage(t("onboarding.wizard.messages.settingsOpenError"));
    });
  }, [electronApi, t]);

  const renderCardBody = () => {
    switch (permissionState) {
      case "welcome":
        return (
          <>
            <p className="text-base text-white/80">
              {t("onboarding.wizard.states.welcome.body")}
            </p>
            <Spacer y={4} />
            <Button
              color="primary"
              size="lg"
              onPress={requestPermission}
              className="w-full"
            >
              {t("onboarding.wizard.states.welcome.cta")}
            </Button>
          </>
        );
      case "requesting":
        return (
          <>
            <p className="text-base text-white/80">
              {t("onboarding.wizard.states.requesting.body")}
            </p>
            <Spacer y={4} />
            <Progress
              isIndeterminate
              aria-label={t("onboarding.wizard.states.requesting.aria")}
            />
          </>
        );
      case "denied":
        return (
          <>
            <p className="text-base text-white/80">
              {t("onboarding.wizard.states.denied.body")}
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
              {t("camera.openSettings")}
            </Button>
          </>
        );
      case "error":
        return (
          <>
            <p className="text-base text-white/80">
              {t("onboarding.wizard.states.error.body")}
            </p>
            <Spacer y={4} />
            <Button
              color="primary"
              size="lg"
              className="w-full"
              onPress={requestPermission}
            >
              {t("onboarding.wizard.states.error.cta")}
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
          <h1 className="text-3xl font-semibold">
            {t("onboarding.wizard.titles.electronUnavailable")}
          </h1>
        </CardHeader>
        <CardBody className="text-base text-white/80">
          {t("onboarding.wizard.messages.electronMissing")}
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
              {t("onboarding.wizard.stepLabel", { current: 1, total: 2 })}
            </div>
            <h1 className="text-3xl font-semibold">
              {t("onboarding.wizard.titles.setup")}
            </h1>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {renderCardBody()}
            {isCalibrationLoading ? (
              <div className="flex items-center gap-3 text-sm text-white/70">
                <Progress
                  isIndeterminate
                  aria-label={t("onboarding.wizard.loading.checkingLabel")}
                />
                {t("onboarding.wizard.loading.checkingMessage")}
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
