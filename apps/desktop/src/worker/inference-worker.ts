/// <reference lib="webworker" />
import { MEDIAPIPE_ASSETS } from "../shared/detection/mediapipeAssets.mjs";
import type {
  InferenceWorkerInboundMessage,
  InferenceWorkerOutboundMessage,
} from "../shared/detection/messages";
import { getLogger } from "../shared/logger";
import type { Detector, DetectorKind } from "../shared/types/detector";
import { updateDetectionGuardrailConfig } from "./config/detection-config";
import createDetector from "./detectors";
import { setGuardrailDebugEnabled } from "./guardrails/debug-flags";
import { captureWorkerException } from "./sentry";

type WorkerContext = typeof globalThis & {
  postMessage: typeof globalThis.postMessage;
  close: typeof globalThis.close;
  addEventListener: typeof globalThis.addEventListener;
};

const workerContext = globalThis as WorkerContext;
const logger = getLogger("inference-worker", "worker");

let detector: Detector | null = null;
let detectorKind: DetectorKind = "mediapipe";

const post = (message: InferenceWorkerOutboundMessage) => {
  workerContext.postMessage(message);
};

const ensureDetector = () => {
  if (!detector) {
    throw new Error("Detector is not initialized");
  }
  return detector;
};

const initializedetector = async (
  message: InferenceWorkerInboundMessage & { type: "init" },
) => {
  detectorKind = message.payload.kind;

  setGuardrailDebugEnabled(Boolean(message.payload.debugGuardrailsVerbose));

  const { guardrailOverrides } = message.payload;
  if (guardrailOverrides) {
    updateDetectionGuardrailConfig(guardrailOverrides);
    logger.info("Applied guardrail overrides to inference worker", {
      guardrailOverrides,
    });
  }

  detector = createDetector(message.payload.kind);

  try {
    await detector.initialize({
      ...message.payload,
      assetBaseUrl: message.payload.assetBaseUrl || MEDIAPIPE_ASSETS.baseUrl,
    });
  } catch (error) {
    captureWorkerException(error);
    throw error instanceof Error
      ? error
      : new Error(
          String(
            JSON.stringify(error) ||
              "Unknown error during detector initialization",
          ),
        );
  }

  post({
    type: "ready",
    payload: {
      detector: detectorKind,
      readyAt: Date.now(),
    },
  });
};

const processFrame = async (
  message: InferenceWorkerInboundMessage & { type: "frame" },
) => {
  const { bitmap, metadata } = message.payload;
  let shouldReleaseBitmap = false;

  try {
    const activeDetector = ensureDetector();
    const result = await activeDetector.processFrame(bitmap, metadata);

    post({
      type: "result",
      payload: result,
    });
  } catch (error) {
    shouldReleaseBitmap = true;
    captureWorkerException(error);
    post({
      type: "error",
      payload: {
        message: error instanceof Error ? error.message : String(error),
        frameId: metadata.id,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  } finally {
    if (shouldReleaseBitmap && typeof bitmap.close === "function") {
      try {
        if (bitmap.width > 0) {
          bitmap.close();
        }
      } catch (closeError) {
        logger.warn("Failed to close bitmap after error", {
          error:
            closeError instanceof Error
              ? closeError.message
              : String(closeError),
        });
      }
    }
  }
};

const shutdown = async () => {
  if (detector) {
    await detector.dispose();
  }
  detector = null;
  workerContext.close();
};

workerContext.addEventListener(
  "message",
  (event: MessageEvent<InferenceWorkerInboundMessage>) => {
    const message = event.data;

    switch (message.type) {
      case "init":
        initializedetector(message).catch((error) => {
          post({
            type: "error",
            payload: {
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          });
        });
        break;
      case "frame":
        processFrame(message).catch((error) => {
          captureWorkerException(error);
          post({
            type: "error",
            payload: {
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          });
        });
        break;
      case "shutdown":
        shutdown().catch((error) => {
          captureWorkerException(error);
          post({
            type: "error",
            payload: {
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          });
        });
        break;
      default:
        post({
          type: "error",
          payload: {
            message: `Unknown inference worker message: ${(message as { type?: string }).type}`,
          },
        });
    }
  },
);

export default null;
