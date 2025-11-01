import { Button, Card, CardBody, CardHeader } from "@heroui/react";
/* eslint-disable react/require-default-props */
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MEDIAPIPE_ASSETS } from "../../shared/detection/mediapipeAssets.mjs";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import { getLogger } from "../../shared/logger";
import type {
  CalibrationBaselinePayload,
  PoseKeypoint,
} from "../../shared/types/calibration";
import type { DetectorResult } from "../../shared/types/detector";
import { DetectionWorkerBridge } from "../detection/detectionWorkerBridge";

type ElectronApi = Window["electron"];

const logger = getLogger("onboarding-wizard", "renderer");

type CalibrationState =
  | "initialising"
  | "ready"
  | "calibrating"
  | "success"
  | "error";

type CalibrationResponse =
  | {
      ok: true;
      baseline: CalibrationBaselinePayload & { id: number; createdAt: number };
    }
  | {
      ok: false;
      error: string;
    };

const CALIBRATION_TIMEOUT_MS = 7000;
const DEFAULT_COMPLETION_DELAY_MS = 800;
const DEFAULT_CALIBRATION_COMPLETION_DELAY_MS = 1200;

const normaliseErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

const extractPoseKeypoints = (inference: unknown): PoseKeypoint[] => {
  if (!inference || typeof inference !== "object") {
    return [];
  }

  const maybeWithLandmarks = inference as {
    landmarks?: Array<
      Array<{
        x: number;
        y: number;
        z?: number;
        visibility?: number;
      }>
    >;
  };

  const [firstPose] = maybeWithLandmarks.landmarks ?? [];
  if (!firstPose) {
    return [];
  }

  return firstPose.map((point, index) => ({
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
    name: `landmark-${index + 1}`,
  }));
};

function CalibrationOverlay() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 640 480"
    >
      <defs>
        <linearGradient id="overlay-gradient" x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.15)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
        </linearGradient>
      </defs>
      <rect fill="url(#overlay-gradient)" height="100%" rx="24" width="100%" />
      <g
        stroke="rgba(255,255,255,0.45)"
        strokeDasharray="12 12"
        strokeWidth="2"
      >
        <path d="M120 120 Q320 20 520 120" fill="none" />
        <path d="M160 330 Q320 420 480 330" fill="none" />
      </g>
      <g fill="rgba(255,255,255,0.6)">
        <circle cx="320" cy="140" r="6" />
        <circle cx="260" cy="220" r="5" />
        <circle cx="380" cy="220" r="5" />
      </g>
      <line
        stroke="rgba(255,255,255,0.4)"
        strokeDasharray="8 8"
        strokeWidth="2"
        x1="80"
        x2="560"
        y1="240"
        y2="240"
      />
    </svg>
  );
}

type CalibrationStepProps = {
  electron: ElectronApi;
  onComplete: () => void;
  completionDelayMs: number;
};

const useDetectionBridge = () => {
  const bridgeRef = useRef<DetectionWorkerBridge | null>(null);
  const initialisePromise = useRef<Promise<void> | null>(null);

  const ensureBridge = useCallback(async () => {
    if (!bridgeRef.current) {
      bridgeRef.current = new DetectionWorkerBridge();
    }

    if (!initialisePromise.current) {
      initialisePromise.current = bridgeRef.current
        .initialise({
          kind: "mediapipe",
          targetFps: 1,
          downscaleShortSide: 320,
          assetBaseUrl: MEDIAPIPE_ASSETS.baseUrl,
        })
        .catch((error) => {
          bridgeRef.current?.shutdown();
          bridgeRef.current = null;
          throw error;
        })
        .finally(() => {
          initialisePromise.current = null;
        });
    }

    await initialisePromise.current;
    return bridgeRef.current;
  }, []);

  const dispose = useCallback(() => {
    bridgeRef.current?.shutdown();
    bridgeRef.current = null;
    initialisePromise.current = null;
  }, []);

  return {
    ensureBridge,
    dispose,
  };
};

const runInference = async (
  bridge: DetectionWorkerBridge,
  bitmap: ImageBitmap,
): Promise<DetectorResult> => {
  const metadata = bridge.nextFrameMetadata();

  return new Promise<DetectorResult>((resolve, reject) => {
    let timeoutId: number | null = null;
    let disposeResult: (() => void) | null = null;
    let disposeError: (() => void) | null = null;

    const cleanup = () => {
      disposeResult?.();
      disposeError?.();
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      const timeoutSeconds = Math.round(CALIBRATION_TIMEOUT_MS / 1000);
      reject(
        new Error(`Calibration timed out after ${timeoutSeconds} seconds`),
      );
    }, CALIBRATION_TIMEOUT_MS);

    disposeResult = bridge.on("result", (result) => {
      if (result.frameId !== metadata.id) {
        return;
      }
      cleanup();
      resolve(result);
    });

    disposeError = bridge.on("error", (error) => {
      if (typeof error.frameId === "number" && error.frameId !== metadata.id) {
        return;
      }
      cleanup();
      reject(new Error(error.message || "Calibration worker error"));
    });

    try {
      bridge.processFrame(bitmap, metadata);
    } catch (error) {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error(normaliseErrorMessage(error)),
      );
    }
  });
};

function CalibrationStep({
  electron,
  onComplete,
  completionDelayMs,
}: CalibrationStepProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const completionTimeoutRef = useRef<number | null>(null);
  const { ensureBridge, dispose } = useDetectionBridge();

  const [state, setState] = useState<CalibrationState>("initialising");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const startCamera = async () => {
      try {
        setState("initialising");
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera access is not supported. This may be due to browser permissions, lack of HTTPS, or unsupported hardware.",
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
        });
        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("Video element unavailable.");
        }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        setState("ready");
      } catch (error) {
        const message = normaliseErrorMessage(error);
        logger.error("Failed to start camera for calibration", { message });
        setErrorMessage(message);
        setState("error");
      }
    };

    startCamera().catch((error) => {
      logger.error("Unexpected camera initialisation failure", {
        error: normaliseErrorMessage(error),
      });
    });

    return () => {
      isMounted = false;
      dispose();
      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [dispose]);

  const captureFrame = useCallback(async (): Promise<ImageBitmap> => {
    const video = videoRef.current;
    if (!video) {
      throw new Error("Unable to capture frame. Video is not ready.");
    }

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }

    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", {
      willReadFrequently: false,
    });

    if (!context) {
      throw new Error("Failed to capture video frame.");
    }

    context.drawImage(video, 0, 0, width, height);

    return createImageBitmap(canvas);
  }, []);

  const sendCalibrationBaseline = useCallback(
    async (
      payload: CalibrationBaselinePayload,
    ): Promise<CalibrationResponse> => {
      try {
        const response = (await electron.ipcRenderer.invoke(
          IPC_CHANNELS.calibrationRequest,
          payload,
        )) as CalibrationResponse;
        return response;
      } catch (error) {
        const message = normaliseErrorMessage(error);
        logger.error("Failed to persist calibration baseline via IPC", {
          message,
        });
        return {
          ok: false,
          error: message,
        };
      }
    },
    [electron.ipcRenderer],
  );

  const handleCalibrate = useCallback(async () => {
    if (state === "calibrating") {
      return;
    }
    setErrorMessage(null);
    setState("calibrating");

    try {
      const bitmap = await captureFrame();
      const bridge = await ensureBridge();
      const result = await runInference(bridge, bitmap);
      const keypoints = extractPoseKeypoints(result.inference);

      if (keypoints.length === 0) {
        throw new Error(
          "No posture detected. Please ensure your full upper body is visible in the frame, ensure good lighting, and try again.",
        );
      }

      const payload: CalibrationBaselinePayload = {
        detector: "mediapipe",
        keypoints,
      };

      const response = await sendCalibrationBaseline(payload);
      if (!response.ok) {
        throw new Error(
          response.error || "Saving calibration failed. Please retry.",
        );
      }

      setState("success");
      completionTimeoutRef.current = window.setTimeout(() => {
        onComplete();
      }, completionDelayMs);
    } catch (error) {
      const message = normaliseErrorMessage(error);
      setErrorMessage(message);
      setState("error");
    }
  }, [
    captureFrame,
    completionDelayMs,
    ensureBridge,
    onComplete,
    sendCalibrationBaseline,
    state,
  ]);

  const statusLabel = useMemo(() => {
    switch (state) {
      case "initialising":
        return "Preparing camera...";
      case "calibrating":
        return "Calibrating posture...";
      case "success":
        return "Calibration successful!";
      case "error":
        return errorMessage ?? "Calibration failed.";
      default:
        return "Align with the guide, then tap Calibrate Now.";
    }
  }, [errorMessage, state]);

  const calibrateDisabled =
    state === "initialising" || state === "calibrating" || state === "success";

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden bg-black/50 backdrop-blur">
        <CardHeader className="flex flex-col gap-2 text-left text-white">
          <h2 className="text-2xl font-semibold">Find Your Baseline</h2>
          <p className="text-base text-white/80">
            Sit tall with ears over shoulders. Align yourself within the guide,
            then tap Calibrate Now to lock in your ideal posture.
          </p>
        </CardHeader>
        <CardBody>
          <div className="relative aspect-video overflow-hidden rounded-3xl border border-white/20 bg-black/60 shadow-2xl">
            <video
              ref={videoRef}
              autoPlay
              className="h-full w-full object-cover"
              muted
              playsInline
            />
            <CalibrationOverlay />
            <AnimatePresence>
              {state === "calibrating" ? (
                <motion.div
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    className="h-16 w-16 rounded-full border-4 border-white/40 border-t-white"
                    transition={{
                      repeat: Infinity,
                      duration: 1.2,
                      ease: "linear",
                    }}
                  />
                </motion.div>
              ) : null}
              {state === "success" ? (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-emerald-500/70 text-white backdrop-blur-md"
                  exit={{ opacity: 0, scale: 0.9 }}
                  initial={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                >
                  <motion.div
                    animate={{ scale: [0.6, 1.1, 1] }}
                    className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-white/20 text-5xl font-bold"
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  >
                    ✓
                  </motion.div>
                  <motion.p
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xl font-semibold"
                    initial={{ opacity: 0, y: 8 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                  >
                    Baseline locked!
                  </motion.p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </CardBody>
      </Card>

      <Card className="bg-white/10 backdrop-blur">
        <CardBody className="flex flex-col items-start gap-4 text-left text-white">
          <p className="text-base">{statusLabel}</p>
          {errorMessage && state === "error" ? (
            <p className="text-sm text-red-200">{errorMessage}</p>
          ) : null}
          <div className="flex gap-3">
            <Button
              color="primary"
              size="lg"
              isDisabled={calibrateDisabled}
              onPress={() => {
                handleCalibrate().catch((error) => {
                  logger.error("Calibration failed unexpectedly", {
                    error: normaliseErrorMessage(error),
                  });
                });
              }}
            >
              Calibrate Now
            </Button>
            <Button
              color="secondary"
              size="lg"
              variant="bordered"
              isDisabled={state === "calibrating"}
              onPress={() => {
                if (streamRef.current) {
                  streamRef.current
                    .getTracks()
                    .forEach((track) => track.stop());
                  streamRef.current = null;
                }
                setState("initialising");
                setErrorMessage(null);
                (async () => {
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                      video: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: "user",
                      },
                    });
                    const video = videoRef.current;
                    if (!video) {
                      stream.getTracks().forEach((track) => track.stop());
                      throw new Error("Video element unavailable.");
                    }
                    streamRef.current = stream;
                    video.srcObject = stream;
                    await video.play();
                    setState("ready");
                  } catch (error) {
                    const message = normaliseErrorMessage(error);
                    setErrorMessage(message);
                    setState("error");
                  }
                })().catch((error) => {
                  logger.error("Reconnect camera failed", {
                    error: normaliseErrorMessage(error),
                  });
                });
              }}
            >
              Reconnect Camera
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

type OnboardingWizardProps = {
  electron: ElectronApi;
  onComplete: () => void;
  completionDelayMs?: number;
  calibrationCompletionDelayMs?: number;
};

export function OnboardingWizard({
  electron,
  onComplete,
  completionDelayMs = DEFAULT_COMPLETION_DELAY_MS,
  calibrationCompletionDelayMs = DEFAULT_CALIBRATION_COMPLETION_DELAY_MS,
}: OnboardingWizardProps) {
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!completed) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      onComplete();
    }, completionDelayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [completed, completionDelayMs, onComplete]);

  if (completed) {
    return (
      <Card className="bg-emerald-500/80 text-white backdrop-blur">
        <CardBody className="flex flex-col gap-3 text-left">
          <h2 className="text-2xl font-semibold">
            Calibration complete! You&apos;re ready to continue.
          </h2>
          <p className="text-base text-white/90">
            We saved your baseline posture. When you start monitoring, we use it
            to personalise feedback and alerts.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <CalibrationStep
      electron={electron}
      onComplete={() => {
        setCompleted(true);
      }}
      completionDelayMs={calibrationCompletionDelayMs}
    />
  );
}

export default OnboardingWizard;
