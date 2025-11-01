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
import { useOnboardingStore } from "../../stores/onboardingStore";

export type OnboardingWizardProps = {
  electron?: ElectronHandler | null;
  onComplete?: () => void;
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

// Helper function to get step number from step name
const getStepNumber = (step: string): number => {
  const stepMap: Record<string, number> = {
    welcome: 1,
    permissions: 2,
    calibration: 3,
    "feedback-explanation": 4,
  };
  return stepMap[step] || 1;
};

export function OnboardingWizardV2({
  electron = null,
  onComplete,
}: OnboardingWizardProps) {
  const { currentStep, nextStep, previousStep } = useOnboardingStore();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const electronApi = useMemo(() => getElectronApi(electron), [electron]);

  // Request camera permission
  const requestPermission = useCallback(() => {
    if (!electronApi) {
      setErrorMessage(
        "Camera permissions are unavailable because the Electron APIs could not be loaded.",
      );
      return;
    }

    const { ipcRenderer, channels } = electronApi;
    const requestChannel: RendererChannel =
      channels?.requestCameraPermission ?? IPC_CHANNELS.requestCameraPermission;

    setIsRequestingPermission(true);
    setErrorMessage(null);

    const invokePermission = async () => {
      try {
        const response = (await ipcRenderer.invoke(requestChannel)) as {
          granted?: boolean;
          error?: string;
        };

        if (response?.granted) {
          setPermissionGranted(true);
          setErrorMessage(null);
          return;
        }

        setErrorMessage(
          response?.error ||
            "Camera access was denied. You can enable it via system settings to continue.",
        );
      } catch (error: unknown) {
        logger.error("Failed to request camera permission", {
          error: error instanceof Error ? error.message : String(error),
        });
        setErrorMessage(
          "We hit an unexpected error while requesting camera access. Please try again.",
        );
      } finally {
        setIsRequestingPermission(false);
      }
    };

    invokePermission().catch((error: unknown) => {
      logger.error("Camera permission invocation failed unexpectedly", {
        error: error instanceof Error ? error.message : String(error),
      });
      setErrorMessage(
        "We hit an unexpected error while requesting camera access. Please try again.",
      );
      setIsRequestingPermission(false);
    });
  }, [electronApi]);

  // Open system settings
  const openSystemSettings = useCallback(() => {
    if (!electronApi) {
      setErrorMessage(
        "System settings cannot be opened because Electron APIs are unavailable.",
      );
      return;
    }

    const { ipcRenderer, channels } = electronApi;
    const openSettingsChannel: RendererChannel =
      // channels?.openCameraPrivacySettings ??
      IPC_CHANNELS.openCameraPrivacySettings;

    setIsOpeningSettings(true);
    setErrorMessage(null);

    const invokeOpenSettings = async () => {
      try {
        const response = (await ipcRenderer.invoke(openSettingsChannel)) as {
          success?: boolean;
          error?: string;
        };

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

  // Complete onboarding
  const completeOnboarding = useCallback(async () => {
    if (!electronApi) {
      return;
    }

    setIsCompleting(true);

    try {
      const { ipcRenderer } = electronApi;
      await ipcRenderer.invoke(
        IPC_CHANNELS.setSetting,
        "onboardingCompleted",
        "true",
      );

      logger.info("Onboarding completed successfully");

      if (onComplete) {
        onComplete();
      }

      // Close window after brief delay
      setTimeout(() => {
        window.close();
      }, 500);
    } catch (error: unknown) {
      logger.error("Failed to complete onboarding", {
        error: error instanceof Error ? error.message : String(error),
      });
      setErrorMessage(
        "Failed to save onboarding completion. Please try again.",
      );
    } finally {
      setIsCompleting(false);
    }
  }, [electronApi, onComplete]);

  // Auto-advance from permissions step when permission is granted
  useEffect(() => {
    if (currentStep === "permissions" && permissionGranted) {
      const timer = setTimeout(() => {
        nextStep();
      }, 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [currentStep, permissionGranted, nextStep]);

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <>
            <p className="text-base text-white/80">
              Welcome to Posely! We&apos;ll help you set up your posture
              monitoring in just a few steps. This wizard will guide you through
              granting camera permissions, calibrating your workspace, and
              understanding the feedback system.
            </p>
            <Spacer y={4} />
            <Button
              color="primary"
              size="lg"
              onPress={nextStep}
              className="w-full"
            >
              Get Started
            </Button>
          </>
        );

      case "permissions":
        if (permissionGranted) {
          return (
            <>
              <p className="text-base text-white/80">
                ✓ Camera permission granted! We&apos;ll use your webcam to
                monitor posture locally on your device—no footage is ever
                uploaded or stored.
              </p>
              <Spacer y={4} />
              <Progress
                isIndeterminate
                aria-label="Moving to next step"
                color="success"
              />
            </>
          );
        }

        if (isRequestingPermission) {
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
        }

        if (errorMessage) {
          return (
            <>
              <p className="text-base text-white/80">
                We need camera access to monitor your posture in real time. You
                can enable the camera in your system settings, then return here
                to continue onboarding.
              </p>
              <Spacer y={4} />
              <div className="flex gap-2">
                <Button
                  color="secondary"
                  size="lg"
                  variant="bordered"
                  className="flex-1"
                  onPress={openSystemSettings}
                  isLoading={isOpeningSettings}
                >
                  Open Settings
                </Button>
                <Button
                  color="primary"
                  size="lg"
                  className="flex-1"
                  onPress={requestPermission}
                >
                  Try Again
                </Button>
              </div>
            </>
          );
        }

        return (
          <>
            <p className="text-base text-white/80">
              We use your webcam to monitor posture locally on your device—no
              footage is ever uploaded or stored. To get started, we need
              permission to access your camera.
            </p>
            <Spacer y={4} />
            <Button
              color="primary"
              size="lg"
              onPress={requestPermission}
              className="w-full"
            >
              Grant Camera Permission
            </Button>
          </>
        );

      case "calibration":
        return (
          <>
            <p className="text-base text-white/80">
              Now we&apos;ll calibrate your neutral posture. Sit in a
              comfortable, upright position and look directly at the camera.
              This will be your baseline for good posture.
            </p>
            <Spacer y={4} />
            <p className="text-sm text-white/60">
              Note: Calibration feature will be implemented in the next step.
            </p>
            <Spacer y={4} />
            <div className="flex gap-2">
              <Button
                color="default"
                size="lg"
                variant="bordered"
                className="flex-1"
                onPress={previousStep}
              >
                Back
              </Button>
              <Button
                color="primary"
                size="lg"
                className="flex-1"
                onPress={nextStep}
              >
                Continue
              </Button>
            </div>
          </>
        );

      case "feedback-explanation":
        return (
          <>
            <p className="mb-4 text-base text-white/80">
              Posely monitors your posture in real-time and displays your status
              through the menu bar icon:
            </p>
            <div className="mb-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <p className="text-sm text-white/80">
                  <strong>Green:</strong> Good posture - keep it up!
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-yellow-500" />
                <p className="text-sm text-white/80">
                  <strong>Yellow:</strong> At risk - adjust your posture
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <p className="text-sm text-white/80">
                  <strong>Red:</strong> Poor posture - time to correct
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-gray-500" />
                <p className="text-sm text-white/80">
                  <strong>Gray:</strong> Paused or tracking lost
                </p>
              </div>
            </div>
            <Spacer y={2} />
            <div className="flex gap-2">
              <Button
                color="default"
                size="lg"
                variant="bordered"
                className="flex-1"
                onPress={previousStep}
              >
                Back
              </Button>
              <Button
                color="primary"
                size="lg"
                className="flex-1"
                onPress={() => {
                  completeOnboarding().catch((error: unknown) => {
                    logger.error("Onboarding completion failed", {
                      error:
                        error instanceof Error ? error.message : String(error),
                    });
                  });
                }}
                isLoading={isCompleting}
              >
                Start Monitoring
              </Button>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  // Get step title
  const getStepTitle = () => {
    switch (currentStep) {
      case "welcome":
        return "Welcome to Posely";
      case "permissions":
        return "Camera Permission";
      case "calibration":
        return "Calibrate Your Workspace";
      case "feedback-explanation":
        return "Understanding Feedback";
      default:
        return "Setup";
    }
  };

  return (
    <Card className="w-full max-w-xl bg-black/40 text-left backdrop-blur-xl">
      <CardHeader className="flex flex-col gap-2 text-white">
        <div className="text-sm uppercase tracking-wide text-white/60">
          {`Step ${getStepNumber(currentStep)} of 4`}
        </div>
        <h1 className="text-3xl font-semibold">{getStepTitle()}</h1>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">{renderStepContent()}</CardBody>
      {errorMessage && currentStep !== "permissions" ? (
        <CardFooter className="border-t border-white/10 pt-4">
          <p className="text-sm text-red-200">{errorMessage}</p>
        </CardFooter>
      ) : null}
    </Card>
  );
}

OnboardingWizardV2.defaultProps = {
  electron: null,
  onComplete: undefined,
} satisfies Partial<OnboardingWizardProps>;
