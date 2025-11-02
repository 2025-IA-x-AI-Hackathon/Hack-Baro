import { parentPort, workerData } from "node:worker_threads";
import { getLatestCalibrationBaseline } from "../main/database/calibrationRepository";
import { WORKER_MESSAGES, type WorkerMessage } from "../shared/ipcChannels";
import { getLogger } from "../shared/logger";
import type { CalibrationThresholds } from "../shared/types/calibration";
import type { DetectorResult } from "../shared/types/detector";
import type {
  EngineFramePayload,
  EngineTickPayload,
} from "../shared/types/engine-ipc";
import { MetricValues } from "../shared/types/metrics";
import {
  CalibrationFlow,
  type CalibrationFlowOptions,
} from "./calibration/calibration-flow";
import {
  type DetectionGuardrailOverrides,
  updateDetectionGuardrailConfig,
} from "./config/detection-config";
import { EngineCoordinator } from "./engine";
import { setGuardrailDebugEnabled } from "./guardrails/debug-flags";
import { EngineTickEmitter } from "./posture/engineTickEmitter";
import "./sentry";

type TimeoutHandle = ReturnType<typeof setTimeout>;

const port = parentPort;

if (!port) {
  throw new Error("Worker must be spawned from the Electron main process.");
}

const postMessage = (message: WorkerMessage) => {
  port.postMessage(message);
};

const logger = getLogger("worker-runtime", "worker");

const engineCoordinator = new EngineCoordinator();
let lastEngineFrameTimestamp: number | null = null;
const calibrationFlow = new CalibrationFlow();

calibrationFlow.on("progress", (progress) => {
  postMessage({
    type: WORKER_MESSAGES.calibrationProgress,
    payload: progress,
  });
});

calibrationFlow.on("complete", (result) => {
  postMessage({
    type: WORKER_MESSAGES.calibrationComplete,
    payload: result,
  });
});

calibrationFlow.on("failed", (failure) => {
  postMessage({
    type: WORKER_MESSAGES.calibrationFailed,
    payload: failure,
  });
});
const rendererTickTimeout: TimeoutHandle | null = null;

type WorkerInitPayload = {
  guardrailOverrides?: DetectionGuardrailOverrides;
  debugHeadPose?: boolean;
  debugGuardrailsVerbose?: boolean;
};

const workerInitPayload = (workerData ?? {}) as WorkerInitPayload;

if (workerInitPayload.guardrailOverrides) {
  updateDetectionGuardrailConfig(workerInitPayload.guardrailOverrides);
  logger.info("Applied guardrail overrides from main process", {
    overrides: workerInitPayload.guardrailOverrides,
  });
}

setGuardrailDebugEnabled(Boolean(workerInitPayload.debugGuardrailsVerbose));

postMessage({
  type: WORKER_MESSAGES.ready,
  payload: {
    readyAt: new Date().toISOString(),
  },
});

const engineTickEmitter = new EngineTickEmitter({
  postMessage,
  calibrationProvider: () => {
    const baseline = getLatestCalibrationBaseline();
    return baseline?.keypoints ?? null;
  },
});

// Story 3.3: Track paused state in worker
let isPausedInWorker = false;
// Story 3.3: Track if a start operation is in progress to prevent race conditions
let isStartingEngine = false;

const isEngineFramePayload = (value: unknown): value is EngineFramePayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { result?: unknown };
  const result = candidate.result as
    | { frameId?: unknown; processedAt?: unknown }
    | undefined;
  return (
    !!result &&
    typeof result.frameId === "number" &&
    Number.isFinite(result.frameId) &&
    typeof result.processedAt === "number"
  );
};

const handleEngineFrame = (payload: EngineFramePayload) => {
  try {
    // Story 3.3: Skip processing if monitoring is paused
    if (isPausedInWorker) {
      return;
    }

    const diagnostics = payload.diagnostics ?? null;
    const frameIntervalMs =
      diagnostics?.frameIntervalMs ??
      (lastEngineFrameTimestamp !== null
        ? payload.result.processedAt - lastEngineFrameTimestamp
        : undefined);

    lastEngineFrameTimestamp = payload.result.processedAt;

    const update = engineCoordinator.update({
      result: payload.result as unknown as DetectorResult,
      calibration: payload.calibration ?? null,
      diagnostics: {
        inputWidth: diagnostics?.inputWidth,
        frameIntervalMs,
        fps: diagnostics?.fps,
      },
    });

    const message: WorkerMessage<typeof WORKER_MESSAGES.engineTick> = {
      type: WORKER_MESSAGES.engineTick,
      payload: {
        tick: update.tick,
      } satisfies EngineTickPayload,
    };

    postMessage(message);

    calibrationFlow.ingest({
      metrics: payload.result.metrics ?? null,
      reliability: payload.result.reliability ?? null,
    });
  } catch (error) {
    logger.error("EngineCoordinator update failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    postMessage({
      type: WORKER_MESSAGES.engineError,
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

port.on("message", (message: WorkerMessage) => {
  switch (message.type) {
    case WORKER_MESSAGES.ping: {
      postMessage({
        type: WORKER_MESSAGES.pong,
        payload: {
          respondedAt: new Date().toISOString(),
        },
      });
      break;
    }
    case WORKER_MESSAGES.engineFrame: {
      if (isEngineFramePayload(message.payload)) {
        handleEngineFrame(message.payload);
      } else {
        logger.warn("Received invalid engine frame payload", {
          payload: message.payload,
        });
      }
      break;
    }
    case WORKER_MESSAGES.calibrationStart: {
      const options = (message.payload ?? {}) as
        | CalibrationFlowOptions
        | undefined;
      calibrationFlow.start(options ?? {});
      break;
    }
    case WORKER_MESSAGES.calibrationCancel: {
      calibrationFlow.cancel("unknown", "Calibration cancelled by caller.");
      break;
    }
    case WORKER_MESSAGES.calibrationApply: {
      const payload = (message.payload ?? null) as {
        thresholds?: CalibrationThresholds;
      } | null;
      if (payload?.thresholds) {
        engineCoordinator.updateRiskThresholds(payload.thresholds);
      }
      break;
    }
    case WORKER_MESSAGES.setPaused: {
      // Story 3.3: Handle pause/resume monitoring
      isPausedInWorker = Boolean(message.payload);
      logger.info(
        `Worker monitoring ${isPausedInWorker ? "paused" : "resumed"}`,
      );

      // When paused, stop the engineTickEmitter
      if (isPausedInWorker) {
        engineTickEmitter.stop();
        // Reset the starting flag when pausing
        isStartingEngine = false;
      } else {
        // Story 3.3: Prevent race conditions from rapid pause/resume clicks
        if (isStartingEngine) {
          logger.warn(
            "Engine start already in progress, skipping duplicate start request",
          );
          break;
        }

        isStartingEngine = true;
        engineTickEmitter
          .start()
          .then(() => {
            isStartingEngine = false;
            logger.info("Engine successfully restarted after resume");
            return undefined;
          })
          .catch((err: unknown) => {
            isStartingEngine = false;
            logger.error("Failed to restart monitoring after resume", {
              error: err instanceof Error ? err.message : String(err),
              action:
                "User should try pausing and resuming again, or restart the application",
            });
            // Notify main process about the failure
            postMessage({
              type: WORKER_MESSAGES.engineError,
              payload: {
                message:
                  "Failed to restart monitoring. Please try again or restart the application.",
              },
            });
          });
      }
      break;
    }
    case WORKER_MESSAGES.triggerWorkerError: {
      throw new Error("Intentional Worker Error");
    }
    default: {
      postMessage({
        type: WORKER_MESSAGES.status,
        payload: {
          unknownMessage: message.type,
          observedAt: new Date().toISOString(),
        },
      });
      logger.warn("Worker received unknown message", {
        messageType: message.type,
      });
      break;
    }
  }
});

process.on("exit", () => {
  engineTickEmitter.stop();
  if (rendererTickTimeout) {
    clearTimeout(rendererTickTimeout);
  }
});
