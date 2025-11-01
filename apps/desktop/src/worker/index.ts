import { parentPort, workerData } from "node:worker_threads";
import { WORKER_MESSAGES, type WorkerMessage } from "../shared/ipcChannels";
import { getLogger } from "../shared/logger";
import type { DetectorResult } from "../shared/types/detector";
import type {
  EngineFramePayload,
  EngineTickPayload,
} from "../shared/types/engine-ipc";
import type { ScoreZone } from "../shared/types/score";
import {
  type DetectionGuardrailOverrides,
  updateDetectionGuardrailConfig,
} from "./config/detection-config";
import { EngineCoordinator } from "./engine";
import { setGuardrailDebugEnabled } from "./guardrails/debug-flags";
import "./sentry";

const STREAK_THRESHOLD = 70;

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
let isAnalysisPaused = false;

// Posture data accumulator for the current day
type PostureAccumulator = {
  date: string; // YYYY-MM-DD format
  secondsInGreen: number;
  secondsInYellow: number;
  secondsInRed: number;
  scoreSum: number;
  sampleCount: number;
  lastTickTimestamp: number | null;
};

let postureAccumulator: PostureAccumulator = {
  date: new Date().toISOString().split("T")[0] ?? "",
  secondsInGreen: 0,
  secondsInYellow: 0,
  secondsInRed: 0,
  scoreSum: 0,
  sampleCount: 0,
  lastTickTimestamp: null,
};

const getCurrentDate = (): string => {
  return new Date().toISOString().split("T")[0] ?? ""; // YYYY-MM-DD
};

const resetAccumulatorIfNewDay = () => {
  const currentDate = getCurrentDate();
  if (postureAccumulator.date !== currentDate) {
    logger.info(`New day detected, persisting final data for ${postureAccumulator.date} before reset`);
    
    // Persist the previous day's final data before resetting
    persistPostureData();
    
    logger.info(`Resetting accumulator for new day: ${currentDate}`);
    postureAccumulator = {
      date: currentDate,
      secondsInGreen: 0,
      secondsInYellow: 0,
      secondsInRed: 0,
      scoreSum: 0,
      sampleCount: 0,
      lastTickTimestamp: null,
    };
  }
};

const updatePostureAccumulator = (zone: ScoreZone, score: number, timestamp: number) => {
  resetAccumulatorIfNewDay();

  // Calculate elapsed time since last tick (in seconds)
  // Assume ticks come roughly every second, but we calculate based on actual time difference
  const elapsedSeconds =
    postureAccumulator.lastTickTimestamp !== null
      ? Math.min((timestamp - postureAccumulator.lastTickTimestamp) / 1000, 5) // Cap at 5 seconds to avoid anomalies
      : 1; // First tick, assume 1 second

  // Increment zone seconds
  if (zone === "GREEN") {
    postureAccumulator.secondsInGreen += elapsedSeconds;
  } else if (zone === "YELLOW") {
    postureAccumulator.secondsInYellow += elapsedSeconds;
  } else if (zone === "RED") {
    postureAccumulator.secondsInRed += elapsedSeconds;
  }

  // Update score sum and sample count
  postureAccumulator.scoreSum += score;
  postureAccumulator.sampleCount += 1;
  postureAccumulator.lastTickTimestamp = timestamp;
};

const persistPostureData = () => {
  if (postureAccumulator.sampleCount === 0) {
    logger.info("No posture data to persist");
    return;
  }

  const avgScore = postureAccumulator.scoreSum / postureAccumulator.sampleCount;
  const meetsGoal = avgScore >= STREAK_THRESHOLD ? 1 : 0;

  const payload = {
    date: postureAccumulator.date,
    secondsInGreen: Math.round(postureAccumulator.secondsInGreen),
    secondsInYellow: Math.round(postureAccumulator.secondsInYellow),
    secondsInRed: Math.round(postureAccumulator.secondsInRed),
    avgScore: Math.round(avgScore * 100) / 100, // Round to 2 decimal places
    sampleCount: postureAccumulator.sampleCount,
    meetsGoal,
  };

  logger.info("Persisting posture data", payload);

  postMessage({
    type: WORKER_MESSAGES.persistPostureData,
    payload,
  });
};

// Set up periodic persistence (every 60 seconds)
const PERSIST_INTERVAL_MS = 60 * 1000; // 60 seconds
setInterval(persistPostureData, PERSIST_INTERVAL_MS);

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
  // Skip processing if analysis is paused
  if (isAnalysisPaused) {
    return;
  }

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

    // Update posture accumulator with tick data
    updatePostureAccumulator(
      update.tick.zone,
      update.tick.score,
      update.tick.t,
    );
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
    case WORKER_MESSAGES.setPaused: {
      const payload = message.payload as { paused?: boolean } | undefined;
      if (payload && typeof payload.paused === "boolean") {
        isAnalysisPaused = payload.paused;
        logger.info(`Worker analysis ${isAnalysisPaused ? "paused" : "resumed"}`, {
          paused: isAnalysisPaused,
        });
      }
      break;
    }
    case WORKER_MESSAGES.getDailySummary: {
      // The worker doesn't have database access, so it will return current accumulator data
      // The main process will need to fetch from the database
      postMessage({
        type: WORKER_MESSAGES.dailySummaryResponse,
        payload: {
          currentAccumulator: {
            date: postureAccumulator.date,
            secondsInGreen: Math.round(postureAccumulator.secondsInGreen),
            secondsInYellow: Math.round(postureAccumulator.secondsInYellow),
            secondsInRed: Math.round(postureAccumulator.secondsInRed),
            avgScore:
              postureAccumulator.sampleCount > 0
                ? Math.round((postureAccumulator.scoreSum / postureAccumulator.sampleCount) * 100) / 100
                : 0,
            sampleCount: postureAccumulator.sampleCount,
          },
        },
      });
      break;
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
