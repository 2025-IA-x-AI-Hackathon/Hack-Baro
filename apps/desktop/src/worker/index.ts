import { parentPort, workerData } from "node:worker_threads";
import { WORKER_MESSAGES, type WorkerMessage } from "../shared/ipcChannels";
import { getLogger } from "../shared/logger";
import type { DetectorResult } from "../shared/types/detector";
import type {
  EngineFramePayload,
  EngineTickPayload,
} from "../shared/types/engine-ipc";
import {
  type DetectionGuardrailOverrides,
  updateDetectionGuardrailConfig,
} from "./config/detection-config";
import { EngineCoordinator } from "./engine";
import { setGuardrailDebugEnabled } from "./guardrails/debug-flags";
import "./sentry";

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
