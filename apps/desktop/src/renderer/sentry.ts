import * as SentryRenderer from '@sentry/electron/renderer';
import type { BrowserOptions } from '@sentry/electron/renderer';
import { monitoringConfig } from '../shared/config/monitoring';
import { getLogger } from '../shared/logger';

const logger = getLogger('sentry-renderer', 'renderer');

let rendererInitialised = false;

export const initRendererSentry = () => {
  if (!monitoringConfig.sentry.enabled || rendererInitialised) {
    if (!monitoringConfig.sentry.enabled) {
      logger.debug('Renderer Sentry disabled by configuration');
    }
    return;
  }

  SentryRenderer.init({
    dsn: monitoringConfig.sentry.dsn,
    environment: monitoringConfig.environment,
    release: monitoringConfig.release,
    beforeSend: monitoringConfig.sentry.beforeSend as NonNullable<
      BrowserOptions['beforeSend']
    >,
    tracesSampleRate: monitoringConfig.sentry.tracesSampleRate,
  });

  SentryRenderer.setTag('process', 'renderer');

  rendererInitialised = true;
};

export const captureRendererException = (error: unknown) => {
  if (!rendererInitialised || !monitoringConfig.sentry.enabled) {
    return;
  }

  const normalisedError =
    error instanceof Error ? error : new Error(String(error));

  SentryRenderer.captureException(normalisedError);
};

const handleErrorEvent = (event: ErrorEvent) => {
  if (event.cancelable) {
    event.preventDefault();
  }
  logger.error('Unhandled renderer error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
  captureRendererException(event.error ?? event.message);
};

const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
  if (event.cancelable) {
    event.preventDefault();
  }

  const reasonMessage =
    event.reason instanceof Error
      ? event.reason.message
      : String(event.reason ?? '');

  logger.error('Unhandled renderer promise rejection', {
    reason: reasonMessage,
  });
  captureRendererException(event.reason);
};

initRendererSentry();

if (typeof window !== 'undefined') {
  window.addEventListener('error', handleErrorEvent);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
}
