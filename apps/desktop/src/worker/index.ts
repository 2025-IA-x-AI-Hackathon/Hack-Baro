import { parentPort } from "node:worker_threads";
import { WORKER_MESSAGES, type WorkerMessage } from "../shared/ipcChannels";
import { getLogger } from "../shared/logger";
import "./sentry";

const port = parentPort;

if (!port) {
  throw new Error("Worker must be spawned from the Electron main process.");
}

const postMessage = (message: WorkerMessage) => {
  port.postMessage(message);
};

const logger = getLogger("worker-runtime", "worker");

postMessage({
  type: WORKER_MESSAGES.ready,
  payload: {
    readyAt: new Date().toISOString(),
  },
});

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
    case WORKER_MESSAGES.TRIGGER_WORKER_ERROR: {
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
