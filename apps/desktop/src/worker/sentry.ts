import {
  captureException as sentryCaptureException,
  init as initSentry,
  setContext,
  setTag,
} from '@sentry/node';
import type { NodeOptions } from '@sentry/node';
import { monitoringConfig } from '../shared/config/monitoring';
import { getLogger } from '../shared/logger';

const logger = getLogger('sentry-worker', 'worker');

let workerInitialised = false;

export const initWorkerSentry = () => {
  if (!monitoringConfig.sentry.enabled || workerInitialised) {
    if (!monitoringConfig.sentry.enabled) {
      logger.debug('Worker Sentry disabled by configuration');
    }
    return;
  }

  initSentry({
    dsn: monitoringConfig.sentry.dsn,
    environment: monitoringConfig.environment,
    release: monitoringConfig.release,
    beforeSend: monitoringConfig.sentry.beforeSend as NonNullable<
      NodeOptions['beforeSend']
    >,
    tracesSampleRate: monitoringConfig.sentry.tracesSampleRate,
  });

  setTag('process', 'worker');
  setContext('worker', {
    pid: process.pid,
    platform: process.platform,
  });

  workerInitialised = true;
};

export const captureWorkerException = (error: unknown) => {
  if (!workerInitialised || !monitoringConfig.sentry.enabled) {
    return;
  }

  const normalisedError =
    error instanceof Error ? error : new Error(String(error));

  sentryCaptureException(normalisedError);
};

export const registerWorkerHandlers = () => {
  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught exception in worker', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    captureWorkerException(error);
  });

  process.on('unhandledRejection', (reason) => {
    const fallbackMessage = (() => {
      if (reason instanceof Error) {
        return reason.message;
      }
      if (typeof reason === 'string') {
        return reason;
      }
      try {
        return JSON.stringify(reason);
      } catch {
        return 'unknown';
      }
    })();

    const error = reason instanceof Error ? reason : new Error(fallbackMessage);
    logger.fatal('Unhandled rejection in worker', {
      error: error.message,
      stack: error.stack,
    });
    captureWorkerException(error);
  });
};

initWorkerSentry();
registerWorkerHandlers();
