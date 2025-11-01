import type { NodeOptions } from "@sentry/node";
import { monitoringConfig } from "../shared/config/monitoring";
import { getLogger } from "../shared/logger";

type SentryNodeModule = typeof import("@sentry/node");

const logger = getLogger("sentry-worker", "worker");

let workerInitialised = false;

let cachedSentryModule: SentryNodeModule | null | undefined;

const isNodeRuntime = () => {
  return (
    typeof process !== "undefined" &&
    process.release?.name === "node" &&
    typeof process.versions?.node === "string"
  );
};

const loadSentryModule = (): SentryNodeModule | null => {
  if (cachedSentryModule !== undefined) {
    return cachedSentryModule;
  }

  if (!isNodeRuntime()) {
    logger.debug("Worker Sentry unavailable: Node APIs not detected");
    cachedSentryModule = null;
    return cachedSentryModule;
  }

  let dynamicRequire: ((specifier: string) => unknown) | null = null;

  try {
    // eslint-disable-next-line no-eval
    dynamicRequire = (0, eval)("require") as (specifier: string) => unknown;
  } catch (error) {
    logger.debug("Worker Sentry unavailable: require not accessible", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!dynamicRequire) {
    cachedSentryModule = null;
    return cachedSentryModule;
  }

  try {
    cachedSentryModule = dynamicRequire("@sentry/node") as SentryNodeModule;
  } catch (error) {
    logger.warn("Failed to load @sentry/node in worker", {
      error: error instanceof Error ? error.message : String(error),
    });
    cachedSentryModule = null;
  }

  return cachedSentryModule;
};

export const initWorkerSentry = () => {
  if (!monitoringConfig.sentry.enabled || workerInitialised) {
    if (!monitoringConfig.sentry.enabled) {
      logger.debug("Worker Sentry disabled by configuration");
    }
    return;
  }

  const sentry = loadSentryModule();
  if (!sentry) {
    logger.debug("Worker Sentry initialisation skipped: module unavailable");
    return;
  }

  sentry.init({
    dsn: monitoringConfig.sentry.dsn,
    environment: monitoringConfig.environment,
    release: monitoringConfig.release,
    beforeSend: monitoringConfig.sentry.beforeSend as NonNullable<
      NodeOptions["beforeSend"]
    >,
    tracesSampleRate: monitoringConfig.sentry.tracesSampleRate,
  });

  sentry.setTag("process", "worker");
  sentry.setContext("worker", {
    pid: process.pid,
    platform: process.platform,
  });

  workerInitialised = true;
};

export const captureWorkerException = (error: unknown) => {
  if (!workerInitialised || !monitoringConfig.sentry.enabled) {
    return;
  }

  const sentry = loadSentryModule();
  if (!sentry) {
    return;
  }

  const normalisedError =
    error instanceof Error ? error : new Error(String(error));

  sentry.captureException(normalisedError);
};

export const registerWorkerHandlers = () => {
  if (typeof process === "undefined" || typeof process.on !== "function") {
    logger.debug(
      "Worker process event handlers unavailable: process hooks not supported",
    );
    return;
  }

  process.on("uncaughtException", (error) => {
    logger.fatal("Uncaught exception in worker", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    captureWorkerException(error);
  });

  process.on("unhandledRejection", (reason) => {
    const fallbackMessage = (() => {
      if (reason instanceof Error) {
        return reason.message;
      }
      if (typeof reason === "string") {
        return reason;
      }
      try {
        return JSON.stringify(reason);
      } catch {
        return "unknown";
      }
    })();

    const error = reason instanceof Error ? reason : new Error(fallbackMessage);
    logger.fatal("Unhandled rejection in worker", {
      error: error.message,
      stack: error.stack,
    });
    captureWorkerException(error);
  });
};

initWorkerSentry();
registerWorkerHandlers();
