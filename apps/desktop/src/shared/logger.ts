/* eslint-disable no-console */
// Console output is intentional here to mirror structured logs locally while shipping them to Better Stack.
import { monitoringConfig } from "./config/monitoring";

export type LoggerProcessType = "main" | "renderer" | "worker";

export type LoggerMetadata = Record<string, unknown>;

type LoggerOptions = {
  module: string;
  processType: LoggerProcessType;
};

const createLogtailAdapter = (client: unknown, mode: "browser" | "node") => {
  const logtailClient = client as {
    log?: unknown;
    flush?: unknown;
  };

  const log = async (message: string, metadata?: LoggerMetadata) => {
    if (typeof logtailClient.log !== "function") {
      return;
    }

    if (mode === "browser") {
      await Reflect.apply(logtailClient.log, logtailClient, [
        message,
        undefined,
        metadata,
      ]);
      return;
    }

    await Reflect.apply(logtailClient.log, logtailClient, [message, metadata]);
  };

  const flush =
    typeof logtailClient.flush === "function"
      ? async () => {
          await Reflect.apply(
            logtailClient.flush as () => Promise<void>,
            logtailClient,
            [],
          );
        }
      : undefined;

  return { log, flush };
};

const logtailInstances: Partial<
  Record<
    LoggerProcessType,
    Promise<ReturnType<typeof createLogtailAdapter> | null>
  >
> = {};

const consoleWriters = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  fatal: console.error.bind(console),
} as const;

const loadLogtail = async (
  processType: LoggerProcessType,
): Promise<ReturnType<typeof createLogtailAdapter> | null> => {
  if (!monitoringConfig.logtail.enabled) {
    return null;
  }

  const existingInstance = logtailInstances[processType];
  if (existingInstance) {
    return existingInstance;
  }

  const instancePromise = (async () => {
    try {
      if (processType === "renderer") {
        const { Logtail } = await import("@logtail/browser");
        const client = new Logtail(monitoringConfig.logtail.token);
        return createLogtailAdapter(client, "browser");
      }

      const { Logtail } = await import(
        /* webpackIgnore: true */ "@logtail/node"
      );
      const client = new Logtail(monitoringConfig.logtail.token);
      return createLogtailAdapter(client, "node");
    } catch (error) {
      console.error("Failed to initialise Better Stack Logtail client", error);
      return null;
    }
  })();

  logtailInstances[processType] = instancePromise;
  return instancePromise;
};

const formatConsolePayload = (
  level: keyof typeof consoleWriters,
  message: string,
  metadata?: LoggerMetadata,
) => {
  const timestamp = new Date().toISOString();
  return [
    `[${timestamp}] [${level.toUpperCase()}] ${message}`,
    metadata ?? {},
  ] as const;
};

const emitLogtail = async (
  processType: LoggerProcessType,
  message: string,
  metadata: LoggerMetadata,
) => {
  try {
    const instance = await loadLogtail(processType);
    if (!instance) {
      return;
    }

    await instance.log(message, metadata);
  } catch (error) {
    console.error("Failed to send log to Better Stack", error);
  }
};

const createEmitter =
  (
    { module, processType }: LoggerOptions,
    level: keyof typeof consoleWriters,
  ) =>
  (message: string, metadata: LoggerMetadata = {}) => {
    const enrichedMetadata = {
      ...metadata,
      module,
      processType,
      environment: monitoringConfig.environment,
      timestamp: new Date().toISOString(),
      level,
    };

    const [consoleMessage, consoleMetadata] = formatConsolePayload(
      level,
      message,
      enrichedMetadata,
    );

    consoleWriters[level](consoleMessage, consoleMetadata);

    if (monitoringConfig.logtail.enabled) {
      emitLogtail(processType, message, enrichedMetadata).catch(
        () => undefined,
      );
    }
  };

export const createLogger = (options: LoggerOptions) => {
  const debug = createEmitter(options, "debug");
  const info = createEmitter(options, "info");
  const warn = createEmitter(options, "warn");
  const error = createEmitter(options, "error");
  const fatal = createEmitter(options, "fatal");

  const flush = async () => {
    const instance = await loadLogtail(options.processType);
    await instance?.flush?.();
  };

  return {
    debug,
    info,
    warn,
    error,
    fatal,
    flush,
  };
};

export type Logger = ReturnType<typeof createLogger>;

const loggerCache = new Map<string, Logger>();

export const getLogger = (
  module: string,
  processType: LoggerProcessType,
): Logger => {
  const cacheKey = `${processType}:${module}`;

  if (loggerCache.has(cacheKey)) {
    return loggerCache.get(cacheKey)!;
  }

  const logger = createLogger({ module, processType });
  loggerCache.set(cacheKey, logger);
  return logger;
};
