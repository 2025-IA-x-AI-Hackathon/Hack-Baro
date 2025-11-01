import type {
  InferenceWorkerInboundMessage,
  InferenceWorkerOutboundMessage,
} from "../../shared/detection/messages";
import { getLogger } from "../../shared/logger";
import type {
  DetectorKind,
  DetectorResult,
  FrameMetadata,
} from "../../shared/types/detector";
import { DETECTION_WORKER_URL } from "./workerEntrypoint.mjs";

type EventCallback<T> = (_payload: T) => void;

type BridgeEvents = {
  ready: { detector: DetectorKind; readyAt: number };
  result: DetectorResult;
  error: { message: string; frameId?: number };
};

type InitPayload = Extract<
  InferenceWorkerInboundMessage,
  { type: "init" }
>["payload"];

const logger = getLogger("detection-worker-bridge", "renderer");

type ListenerSets = {
  ready: Set<EventCallback<BridgeEvents["ready"]>>;
  result: Set<EventCallback<BridgeEvents["result"]>>;
  error: Set<EventCallback<BridgeEvents["error"]>>;
};

export class DetectionWorkerBridge {
  private worker: Worker | null = null;

  private listeners: ListenerSets = {
    ready: new Set(),
    result: new Set(),
    error: new Set(),
  };

  private isinitialized = false;

  private pendingInitialise: Promise<void> | null = null;

  private busy = false;

  private frameSequence = 0;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(DETECTION_WORKER_URL, {
        type: "module",
      });

      this.worker.addEventListener(
        "message",
        (event: MessageEvent<InferenceWorkerOutboundMessage>) => {
          const message = event.data;

          switch (message.type) {
            case "ready":
              this.isinitialized = true;
              this.busy = false;
              this.emit("ready", message.payload);
              break;
            case "result":
              this.busy = false;
              this.emit("result", message.payload);
              break;
            case "error":
              this.busy = false;
              logger.error("Inference worker error", message.payload);
              this.emit("error", {
                message: message.payload.message,
                frameId: message.payload.frameId,
              });
              break;
            default:
              logger.warn("Unhandled worker message", {
                type: message.type,
              });
          }
        },
      );
    }

    return this.worker;
  }

  private getListenerSet<K extends keyof BridgeEvents>(
    event: K,
  ): Set<EventCallback<BridgeEvents[K]>> {
    switch (event) {
      case "ready":
        return this.listeners.ready as Set<EventCallback<BridgeEvents[K]>>;
      case "result":
        return this.listeners.result as Set<EventCallback<BridgeEvents[K]>>;
      case "error":
        return this.listeners.error as Set<EventCallback<BridgeEvents[K]>>;
      default: {
        const exhaustiveCheck: never = event;
        throw new Error(
          `Unsupported bridge event: ${exhaustiveCheck as string}`,
        );
      }
    }
  }

  on<EventName extends keyof BridgeEvents>(
    event: EventName,
    callback: EventCallback<BridgeEvents[EventName]>,
  ) {
    this.getListenerSet(event).add(callback);

    return () => {
      this.getListenerSet(event).delete(callback);
    };
  }

  private emit<EventName extends keyof BridgeEvents>(
    event: EventName,
    payload: BridgeEvents[EventName],
  ) {
    this.getListenerSet(event).forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        logger.error("Listener execution failed", {
          event,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  initialise(payload: InitPayload): Promise<void> {
    if (this.isinitialized) {
      return Promise.resolve();
    }

    if (!this.pendingInitialise) {
      const worker = this.ensureWorker();
      this.pendingInitialise = new Promise<void>((resolve, reject) => {
        let removeError: () => void;

        const removeReady = this.on("ready", () => {
          removeReady();
          removeError();
          resolve();
        });

        removeError = this.on("error", (error) => {
          removeReady();
          removeError();
          reject(new Error(error.message));
        });

        worker.postMessage({
          type: "init",
          payload,
        } satisfies InferenceWorkerInboundMessage);
      }).finally(() => {
        this.pendingInitialise = null;
      });
    }

    return this.pendingInitialise;
  }

  isReady(): boolean {
    return this.isinitialized;
  }

  isBusy(): boolean {
    return this.busy;
  }

  nextFrameMetadata(): FrameMetadata {
    this.frameSequence += 1;
    const id = this.frameSequence;
    return {
      id,
      capturedAt: performance.now(),
    };
  }

  processFrame(bitmap: ImageBitmap, metadata: FrameMetadata): void {
    if (!this.worker) {
      throw new Error("Worker has not been initialized");
    }
    this.busy = true;
    const message: InferenceWorkerInboundMessage = {
      type: "frame",
      payload: {
        bitmap,
        metadata,
      },
    };

    this.worker.postMessage(message, [bitmap]);
  }

  shutdown(): void {
    if (!this.worker) {
      return;
    }

    this.worker.postMessage({
      type: "shutdown",
    } satisfies InferenceWorkerInboundMessage);
    this.worker.terminate();
    this.worker = null;
    this.isinitialized = false;
    this.busy = false;
  }
}

export default DetectionWorkerBridge;
