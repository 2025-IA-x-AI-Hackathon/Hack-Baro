import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Progress,
  Spacer,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElectronHandler } from "../../../main/preload";
import { IPC_CHANNELS } from "../../../shared/ipcChannels";
import { getLogger } from "../../../shared/logger";
import type { CalibrationBaselinePayload } from "../../../shared/types/calibration";

type WizardStep = "permission" | "calibration" | "complete";

type PermissionState =
  | "welcome"
  | "requesting"
  | "granted"
  | "denied"
  | "error";

type CalibrationState = "ready" | "calibrating" | "success" | "error";

type CameraPermissionResponse = {
  granted?: boolean;
  error?: string;
};

type OpenSettingsResponse = {
  success?: boolean;
  error?: string;
};

type CalibrationResponse = {
  ok: boolean;
  baseline?: {
    id: number;
    detector: string;
    keypoints: unknown[];
    createdAt: number;
  };
  error?: string;
};

export type OnboardingWizardProps = {
  electron?: ElectronHandler | null;
};

const logger = getLogger("onboarding-wizard", "renderer");

const defaultProps = {
  electron: null,
} as const;

const getElectronApi = (electron?: ElectronHandler | null) => {
  if (electron) {
    return electron;
  }

  if (typeof window !== "undefined") {
    return window.electron;
  }

  return null;
};

export function OnboardingWizard(props: OnboardingWizardProps) {
  const { electron = defaultProps.electron } = props;
  const [currentStep, setCurrentStep] = useState<WizardStep>("permission");
  const [permissionState, setPermissionState] =
    useState<PermissionState>("welcome");
  const [calibrationState, setCalibrationState] =
    useState<CalibrationState>("ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const electronApi = useMemo(() => getElectronApi(electron), [electron]);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  // Initialize camera when entering calibration step
  useEffect(() => {
    if (currentStep === "calibration" && !stream) {
      const initCamera = async () => {
        try {
          const mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
          });
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        } catch (error) {
          logger.error("Failed to initialize camera", {
            error: error instanceof Error ? error.message : String(error),
          });
          setErrorMessage("Failed to access camera. Please check permissions.");
        }
      };
      initCamera().catch((error: unknown) => {
        logger.error("Camera initialization failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }, [currentStep, stream]);

  const requestPermission = useCallback(() => {
    if (!electronApi) {
      setPermissionState("error");
      setErrorMessage(
        "Camera permissions are unavailable because the Electron APIs could not be loaded.",
      );
      return;
    }

    const { ipcRenderer, channels } = electronApi;
    setPermissionState("requesting");
    setErrorMessage(null);

    const invokePermission = async () => {
      try {
        const response = (await ipcRenderer.invoke(
          channels?.REQUEST_CAMERA_PERMISSION ??
            IPC_CHANNELS.REQUEST_CAMERA_PERMISSION,
        )) as CameraPermissionResponse;

        if (response?.granted) {
          setPermissionState("granted");
          // Move to calibration step after a brief delay
          setTimeout(() => {
            setCurrentStep("calibration");
            setErrorMessage(null);
          }, 1000);
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

  const captureFrameAndCalibrate = useCallback(() => {
    if (!electronApi || !videoRef.current || !canvasRef.current) {
      setCalibrationState("error");
      setErrorMessage("Camera or system unavailable for calibration.");
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) {
      setCalibrationState("error");
      setErrorMessage("Failed to get canvas context.");
      return;
    }

    setCalibrationState("calibrating");
    setErrorMessage(null);

    // Capture frame from video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // For MVP, create mock keypoints (in production, this would come from pose detection)
    const mockKeypoints = [
      { x: 0.5, y: 0.3, z: 0, visibility: 0.95, name: "nose" },
      { x: 0.45, y: 0.35, z: 0, visibility: 0.9, name: "left_shoulder" },
      { x: 0.55, y: 0.35, z: 0, visibility: 0.9, name: "right_shoulder" },
    ];

    const payload: CalibrationBaselinePayload = {
      detector: "mediapipe",
      keypoints: mockKeypoints,
    };

    const { ipcRenderer, channels } = electronApi;

    const invokeCalibration = async () => {
      try {
        const response = (await ipcRenderer.invoke(
          channels?.calibrationRequest ?? IPC_CHANNELS.calibrationRequest,
          payload,
        )) as CalibrationResponse;

        if (response?.ok) {
          setCalibrationState("success");
          logger.info("Calibration successful", {
            baselineId: response.baseline?.id,
          });

          // Show success animation then move to next step
          setTimeout(() => {
            setCurrentStep("complete");
          }, 2000);
        } else {
          setCalibrationState("error");
          setErrorMessage(
            response?.error ?? "Calibration failed. Please try again.",
          );
        }
      } catch (error: unknown) {
        logger.error("Calibration request failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        setCalibrationState("error");
        setErrorMessage("Failed to save calibration. Please try again.");
      }
    };

    invokeCalibration().catch((error: unknown) => {
      logger.error("Calibration invocation failed unexpectedly", {
        error: error instanceof Error ? error.message : String(error),
      });
      setCalibrationState("error");
      setErrorMessage("An unexpected error occurred during calibration.");
    });
  }, [electronApi]);

  const renderCalibrationStep = () => {
    return (
      <div className="flex flex-col gap-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/20">
          {/* Video feed */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {/* SVG Overlay Guide */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 640 480"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Head circle guide */}
            <circle
              cx="320"
              cy="160"
              r="60"
              fill="none"
              stroke="rgba(34, 197, 94, 0.5)"
              strokeWidth="2"
              strokeDasharray="5,5"
            />
            {/* Shoulder guide line */}
            <line
              x1="220"
              y1="240"
              x2="420"
              y2="240"
              stroke="rgba(34, 197, 94, 0.5)"
              strokeWidth="2"
              strokeDasharray="5,5"
            />
            {/* Center guide */}
            <line
              x1="320"
              y1="0"
              x2="320"
              y2="480"
              stroke="rgba(34, 197, 94, 0.3)"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
          </svg>

          {/* Canvas for frame capture (hidden) */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <p className="text-center text-sm text-white/70">
          Position your head and shoulders within the guides above
        </p>

        {calibrationState === "ready" && (
          <Button
            color="primary"
            size="lg"
            className="w-full"
            onPress={captureFrameAndCalibrate}
          >
            Calibrate Now
          </Button>
        )}

        {calibrationState === "calibrating" && (
          <>
            <Progress
              isIndeterminate
              aria-label="Calibrating posture baseline"
              color="primary"
            />
            <p className="text-center text-sm text-white/70">
              Analyzing your posture...
            </p>
          </>
        )}

        {calibrationState === "success" && (
          <div className="animate-in fade-in zoom-in flex flex-col items-center gap-2 duration-500">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
              <svg
                className="h-10 w-10 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-lg font-semibold text-green-400">Success!</p>
            <p className="text-sm text-white/70">
              Your baseline posture has been saved
            </p>
          </div>
        )}

        {calibrationState === "error" && (
          <Button
            color="primary"
            size="lg"
            className="w-full"
            onPress={captureFrameAndCalibrate}
          >
            Try Again
          </Button>
        )}
      </div>
    );
  };

  const renderPermissionStep = () => {
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
      case "granted":
        return (
          <>
            <p className="text-base text-white/80">
              Thank you! Camera access is enabled. Preparing calibration...
            </p>
            <Spacer y={4} />
            <Progress
              isIndeterminate
              aria-label="Loading calibration"
              color="success"
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

  const renderCompleteStep = () => {
    return (
      <>
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20">
            <svg
              className="h-12 w-12 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-white">
            You&apos;re all set!
          </h2>
          <p className="text-center text-base text-white/70">
            Your posture baseline has been configured. You can now start using
            Posely to improve your posture throughout the day.
          </p>
        </div>
        <Button color="primary" size="lg" className="w-full">
          Get Started
        </Button>
      </>
    );
  };

  const getStepNumber = () => {
    switch (currentStep) {
      case "permission":
        return 1;
      case "calibration":
        return 2;
      case "complete":
        return 3;
      default:
        return 1;
    }
  };

  const getStepTitle = () => {
    switch (currentStep) {
      case "permission":
        return "Let's set up your posture coach";
      case "calibration":
        return "Calibrate your posture baseline";
      case "complete":
        return "Setup complete!";
      default:
        return "Let's set up your posture coach";
    }
  };

  const renderCardBody = () => {
    switch (currentStep) {
      case "permission":
        return renderPermissionStep();
      case "calibration":
        return renderCalibrationStep();
      case "complete":
        return renderCompleteStep();
      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-xl bg-black/40 text-left backdrop-blur-xl">
      <CardHeader className="flex flex-col gap-2 text-white">
        <div className="text-sm uppercase tracking-wide text-white/60">
          Step {getStepNumber()} of 3
        </div>
        <h1 className="text-3xl font-semibold">{getStepTitle()}</h1>
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
