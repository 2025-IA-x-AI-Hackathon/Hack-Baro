import { Button, Card, CardBody, CardHeader } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IPC_CHANNELS } from "../../../shared/ipcChannels";
import { getLogger } from "../../../shared/logger";
import type {
  CalibrationCompletePayload,
  CalibrationProgress,
} from "../../../shared/types/calibration";

const logger = getLogger("calibration-flow", "renderer");

type ElectronApi = Window["electron"];

type CalibrationState =
  | "initialising"
  | "ready"
  | "calibrating"
  | "success"
  | "error";

const DEFAULT_COMPLETION_DELAY_MS = 800;

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

const isCalibrationProgress = (
  value: unknown,
): value is CalibrationProgress => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CalibrationProgress>;
  return (
    typeof candidate.phase === "string" &&
    typeof candidate.collectedSamples === "number" &&
    typeof candidate.targetSamples === "number" &&
    typeof candidate.stabilityScore === "number"
  );
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

// TODO: yeomin4242 - help needed please help help
// Resolve the conflicting types here
// type CalibrationFlowProps = {
//   electron: ElectronHandler;
//   onComplete: (payload: CalibrationCompletePayload) => void;
//   completionDelayMs?: number;
type CalibrationStepProps = {
  electron: ElectronApi;
  onComplete: () => void;
  completionDelayMs: number;
  autoStart?: boolean;
};

export function CalibrationFlow({
  electron,
  onComplete,
  //   completionDelayMs = DEFAULT_COMPLETION_DELAY_MS,
  // }: CalibrationFlowProps) {
  completionDelayMs,
  autoStart = false,
}: CalibrationStepProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const completionTimeoutRef = useRef<number | null>(null);
  // Undefined canvasRef issue
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // TODO: yeomin4242 - help needed please help
  // const { ensureBridge, dispose } = useDetectionBridge();
  const autoStartTriggeredRef = useRef(false);

  const [state, setState] = useState<CalibrationState>("initialising");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<CalibrationProgress | null>(null);
  const [result, setResult] = useState<CalibrationCompletePayload | null>(null);
  const [validationNote, setValidationNote] = useState<string | null>(null);

  // TODO: yeomin4242 - help needed please help
  // Type error due to dispose
  // useEffect(() => {
  //   let isMounted = true;
  //   const startCamera = async () => {
  //     try {
  //       setState("initialising");
  //       if (!navigator.mediaDevices?.getUserMedia) {
  //         throw new Error(
  //           "Camera access is not supported. This may be due to browser permissions, lack of HTTPS, or unsupported hardware.",
  //         );
  //       }
  //       const stream = await navigator.mediaDevices.getUserMedia({
  //         video: {
  //           width: { ideal: 640 },
  //           height: { ideal: 480 },
  //           facingMode: "user",
  //         },
  //       });
  //       if (!isMounted) {
  //         stream.getTracks().forEach((track) => track.stop());
  //         return;
  //       }
  //       const video = videoRef.current;
  //       if (!video) {
  //         stream.getTracks().forEach((track) => track.stop());
  //         throw new Error("Video element unavailable.");
  //       }
  //       streamRef.current = stream;
  //       video.srcObject = stream;
  //       await video.play();
  //       setState("ready");
  //     } catch (error) {
  //       const message = normaliseErrorMessage(error);
  //       logger.error("Failed to start camera for calibration", { message });
  //       setErrorMessage(message);
  //       setState("error");
  //     }
  //   };

  //   startCamera().catch((error) => {
  //     logger.error("Unexpected camera initialisation failure", {
  //       error: normaliseErrorMessage(error),
  //     });
  //   });

  //   return () => {
  //     isMounted = false;
  //     if (completionTimeoutRef.current !== null) {
  //       window.clearTimeout(completionTimeoutRef.current);
  //     }
  //     if (streamRef.current) {
  //       streamRef.current.getTracks().forEach((track) => track.stop());
  //       streamRef.current = null;
  //     }
  //   };
  // }, [dispose]);

  // Handle visibility change: restart camera when window becomes visible
  // This fixes camera initialization when app was hidden (e.g., re-calibrate from hidden state)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Window became visible - check if camera stream is still active
        const video = videoRef.current;
        const stream = streamRef.current;

        if (!stream || !stream.active) {
          logger.info(
            "Window became visible with inactive camera stream, reinitializing...",
          );
          // Camera stream is inactive, need to reinitialize
          // Set to initialising state to trigger camera restart
          setState("initialising");

          // Clean up old stream if exists
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }

          // Restart camera
          navigator.mediaDevices
            .getUserMedia({
              video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user",
              },
            })
            .then((newStream) => {
              if (!video) {
                newStream.getTracks().forEach((track) => track.stop());
                throw new Error("Video element unavailable.");
              }
              streamRef.current = newStream;
              video.srcObject = newStream;
              return video.play();
            })
            .then(() => {
              setState("ready");
              // Reset auto-start trigger so it can fire again
              autoStartTriggeredRef.current = false;
              logger.info(
                "Camera reinitialized successfully after visibility change",
              );
              return undefined;
            })
            .catch((error) => {
              const message = normaliseErrorMessage(error);
              logger.error(
                "Failed to reinitialize camera on visibility change",
                {
                  message,
                },
              );
              setErrorMessage(message);
              setState("error");
            });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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

  useEffect(() => {
    const handleProgress = (...args: unknown[]) => {
      const [maybeProgress] = args;
      if (isCalibrationProgress(maybeProgress)) {
        setProgress(maybeProgress);
        return;
      }
      logger.warn("Received malformed calibration progress payload", {
        payload: maybeProgress,
      });
    };

    const dispose = electron.ipcRenderer.on(
      IPC_CHANNELS.calibrationProgress,
      handleProgress,
    );

    return () => {
      dispose?.();
    };
  }, [electron]);

  const reconnectCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setState("initialising");
      setErrorMessage(null);
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
  }, []);

  const handleCalibrate = useCallback(async () => {
    if (state === "calibrating") {
      return;
    }
    setErrorMessage(null);
    setValidationNote(null);
    setResult(null);
    setProgress(null);
    setState("calibrating");

    try {
      const response = (await electron.ipcRenderer.invoke(
        IPC_CHANNELS.calibrationStart,
        {},
      )) as CalibrationCompletePayload;

      setResult(response);
      const { suggestion } = response.validation;
      if (suggestion === "recalibrate_low_quality") {
        setValidationNote(
          "Calibration quality was below the recommended threshold. Try improving lighting and sitting as upright as possible, then retry.",
        );
      } else if (suggestion === "recalibrate_unreliable") {
        setValidationNote(
          "Calibration detected unreliable frames. Ensure your face and shoulders are clearly visible, then try again.",
        );
      } else if (suggestion === "adjust_sensitivity") {
        setValidationNote(
          "Calibration completed, but optimal conditions could improve results. Consider retrying with steadier posture or better lighting.",
        );
      }

      setState("success");
      completionTimeoutRef.current = window.setTimeout(() => {
        // onComplete(response);
      }, completionDelayMs);
    } catch (error) {
      const message = normaliseErrorMessage(error);
      setErrorMessage(message);
      setState("error");
    }
  }, [completionDelayMs, electron.ipcRenderer, onComplete, state]);

  // Auto-trigger calibration when camera is ready (for re-calibration flow)
  useEffect(() => {
    if (autoStart && state === "ready" && !autoStartTriggeredRef.current) {
      autoStartTriggeredRef.current = true;
      logger.info("Auto-starting calibration for re-calibration flow");
      handleCalibrate().catch((error) => {
        logger.error("Auto-calibration failed", {
          error: normaliseErrorMessage(error),
        });
      });
    }
  }, [autoStart, state, handleCalibrate]);

  const statusLabel = useMemo(() => {
    switch (state) {
      case "initialising":
        return "Preparing camera...";
      case "calibrating": {
        if (!progress) {
          return "Calibrating posture...";
        }
        if (progress.phase === "collecting") {
          return `Collecting baseline samples (${progress.collectedSamples}/${progress.targetSamples})...`;
        }
        if (progress.phase === "validating") {
          return "Validating calibration stability (30s)...";
        }
        return "Processing calibration...";
      }
      case "success":
        return "Calibration successful!";
      case "error":
        return errorMessage ?? "Calibration failed.";
      default:
        return "Align with the guide, then tap Calibrate Now.";
    }
  }, [errorMessage, progress, state]);

  const qualityLabel = useMemo(() => {
    if (!result) {
      return null;
    }
    return `Quality score: ${result.baseline.quality}/100`;
  }, [result]);

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
          {progress ? (
            <p className="text-sm text-white/70">
              {progress.phase === "collecting"
                ? `${progress.collectedSamples} samples captured`
                : progress.phase === "validating"
                  ? "Validation in progress..."
                  : null}
            </p>
          ) : null}
          {progress ? (
            <div className="grid w-full gap-2 rounded-xl bg-white/5 p-3 text-xs text-white/80 sm:grid-cols-2">
              <div>
                <span className="font-semibold text-white/90">Accepted:</span>{" "}
                {progress.acceptedSamples ?? progress.collectedSamples}/
                {progress.targetSamples}
              </div>
              <div>
                <span className="font-semibold text-white/90">Dropped:</span>{" "}
                {progress.rejectedSamples ?? 0} (low conf{" "}
                {progress.rejectedLowConfidence ?? 0}, unreliable{" "}
                {progress.rejectedUnreliable ?? 0})
              </div>
              <div>
                <span className="font-semibold text-white/90">
                  Last confidence:
                </span>{" "}
                {progress.lastSampleConfidence !== null &&
                progress.lastSampleConfidence !== undefined
                  ? progress.lastSampleConfidence.toFixed(2)
                  : "—"}
              </div>
              <div>
                <span className="font-semibold text-white/90">Elapsed:</span>{" "}
                {progress.elapsedMs
                  ? `${Math.round(progress.elapsedMs / 1000)}s`
                  : "—"}
              </div>
            </div>
          ) : null}
          {qualityLabel ? (
            <p className="text-sm text-white/70">{qualityLabel}</p>
          ) : null}
          {validationNote ? (
            <p className="text-sm text-amber-200">{validationNote}</p>
          ) : null}
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
                reconnectCamera().catch((error) => {
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

// export default CalibrationFlow;
type OnboardingWizardProps = {
  electron: ElectronApi;
  onComplete: () => void;
  completionDelayMs?: number;
  calibrationCompletionDelayMs?: number;
  autoStart?: boolean;
};

export function OnboardingWizard({
  electron,
  onComplete,
  completionDelayMs = DEFAULT_COMPLETION_DELAY_MS,
  calibrationCompletionDelayMs,
  autoStart = false,
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
    <div className="flex flex-col gap-6">
      <Card className="bg-white/10 backdrop-blur">
        <CardBody className="flex flex-col gap-4 text-left text-white">
          <h2 className="text-2xl font-semibold">Calibrate Your Posture</h2>
          <p className="text-base text-white/90">
            To provide accurate posture monitoring, we need to calibrate your
            baseline posture. This helps us understand your unique alignment and
            habits.
          </p>
          <p className="text-base text-white/90">
            During calibration, please sit upright and still for about 60
            seconds while we collect data. Make sure your face and shoulders are
            clearly visible to the camera.
          </p>
        </CardBody>
      </Card>
    </div>
    // TODO: yeomin4242 - help needed please help
    // <CalibrationStep
    //   electron={electron}
    //   onComplete={() => {
    //     setCompleted(true);
    //   }}
    //   completionDelayMs={calibrationCompletionDelayMs}
    //   autoStart={autoStart}
    // />
  );
}

export default OnboardingWizard;
