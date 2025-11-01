import * as Sentry from "@sentry/electron/main";
import type { Breadcrumb, ElectronMainOptions } from "@sentry/electron/main";
import { app } from "electron";
import { monitoringConfig } from "../shared/config/monitoring";
import { getLogger } from "../shared/logger";

const logger = getLogger("sentry-main", "main");

let isinitialized = false;

const buildDefaultBreadcrumb = (message: string): Breadcrumb => ({
  timestamp: Date.now() / 1000,
  level: "info" as Breadcrumb["level"],
  category: "application",
  message,
});

export const captureException = (
  error: unknown,
  context?: Record<string, unknown>,
) => {
  if (!isinitialized || !monitoringConfig.sentry.enabled) {
    return;
  }

  Sentry.captureException(error, {
    contexts: context ? { metadata: context } : undefined,
  });
};

export const captureMessage = (message: string) => {
  if (!isinitialized || !monitoringConfig.sentry.enabled) {
    return;
  }

  Sentry.captureMessage(message);
};

const resolveReasonMessage = (reason: unknown): string => {
  if (reason instanceof Error && typeof reason.message === "string") {
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
};

const initSentry = () => {
  if (!monitoringConfig.sentry.enabled || isinitialized) {
    if (!monitoringConfig.sentry.enabled) {
      logger.debug("Skipping Sentry initialisation: disabled by configuration");
    }
    return;
  }

  Sentry.init({
    dsn: monitoringConfig.sentry.dsn,
    environment: monitoringConfig.environment,
    release: monitoringConfig.release,
    beforeSend: monitoringConfig.sentry.beforeSend as NonNullable<
      ElectronMainOptions["beforeSend"]
    >,
    tracesSampleRate: monitoringConfig.sentry.tracesSampleRate,
    integrations: [],
  });

  const scope = Sentry.getCurrentScope?.();
  if (scope) {
    scope.setTag?.("process", "main");
    scope.setContext?.("application", {
      version: app.getVersion(),
      locale: app.getLocale(),
      name: app.getName(),
    });
  }

  Sentry.addBreadcrumb(
    buildDefaultBreadcrumb("Sentry initialised for Electron main process"),
  );

  isinitialized = true;

  process.on("uncaughtException", (error) => {
    logger.fatal("Uncaught exception in main process", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    captureException(error);
  });

  process.on("unhandledRejection", (reason) => {
    const error =
      reason instanceof Error
        ? reason
        : new Error(resolveReasonMessage(reason));
    logger.fatal("Unhandled promise rejection in main process", {
      error: error.message,
      stack: error.stack,
    });
    captureException(error);
  });
};

initSentry();
