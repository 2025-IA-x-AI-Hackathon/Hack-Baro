type Environment = string;
type RuntimeEnv = Record<string, string | undefined>;

export type SanitizableSentryEvent = Record<string, unknown>;

const getWindowEnv = (): RuntimeEnv | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const windowWithElectron = window as typeof window & {
    electron?: { env?: RuntimeEnv };
  };

  return windowWithElectron.electron?.env;
};

const getProcessEnv = (): RuntimeEnv | undefined => {
  if (typeof globalThis === 'undefined') {
    return undefined;
  }

  const globalWithProcess = globalThis as typeof globalThis & {
    process?: { env?: RuntimeEnv };
  };

  return globalWithProcess.process?.env;
};

const resolveEnvironment = (env: RuntimeEnv): Environment => {
  const explicitEnv = env.APP_ENV ?? env.POS_ENV ?? env.DESKTOP_ENV;

  if (explicitEnv && explicitEnv.trim().length > 0) {
    return explicitEnv;
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv && nodeEnv.trim().length > 0) {
    return nodeEnv;
  }

  return 'development';
};

const normalizeBoolean = (value: string | undefined, fallback = false) => {
  if (!value) {
    return fallback;
  }

  switch (value.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return fallback;
  }
};

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'authorization',
  'auth',
  'ssn',
  'email',
  'phone',
];

const stringifyUserId = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable-user-id]';
  }
};

const scrubValue = (value: unknown): unknown => {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};

    Object.entries(value as Record<string, unknown>).forEach(
      ([key, nestedValue]) => {
        const lowerKey = key.toLowerCase();
        if (
          SENSITIVE_KEYS.some((sensitiveKey) => lowerKey.includes(sensitiveKey))
        ) {
          result[key] = '[redacted]';
          return;
        }

        result[key] = scrubValue(nestedValue);
      },
    );

    return result;
  }

  if (typeof value === 'string') {
    if (
      SENSITIVE_KEYS.some((sensitiveKey) =>
        value.toLowerCase().includes(sensitiveKey),
      )
    ) {
      return '[redacted]';
    }
  }

  return value;
};

const sanitizeSentryEvent = (event: unknown): unknown => {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return event;
  }

  const eventRecord = { ...(event as Record<string, unknown>) };

  const rawBreadcrumbs = eventRecord.breadcrumbs;
  if (Array.isArray(rawBreadcrumbs)) {
    eventRecord.breadcrumbs = rawBreadcrumbs
      .filter((breadcrumb): breadcrumb is Record<string, unknown> => {
        return typeof breadcrumb === 'object' && breadcrumb !== null;
      })
      .map((breadcrumb) => {
        const breadcrumbRecord = { ...breadcrumb };
        if ('data' in breadcrumbRecord) {
          breadcrumbRecord.data = scrubValue(breadcrumbRecord.data);
        }
        return breadcrumbRecord;
      });
  }

  eventRecord.request = undefined;

  const rawExtra = eventRecord.extra;
  if (rawExtra && typeof rawExtra === 'object' && !Array.isArray(rawExtra)) {
    eventRecord.extra = scrubValue(rawExtra);
  }

  const rawContexts = eventRecord.contexts;
  if (
    rawContexts &&
    typeof rawContexts === 'object' &&
    !Array.isArray(rawContexts)
  ) {
    eventRecord.contexts = scrubValue(rawContexts);
  }

  const rawUser = eventRecord.user;
  if (rawUser && typeof rawUser === 'object' && !Array.isArray(rawUser)) {
    const userRecord = rawUser as Record<string, unknown>;
    const userId = userRecord.id;
    if (userId != null) {
      eventRecord.user = { id: stringifyUserId(userId) };
    } else {
      eventRecord.user = undefined;
    }
  }

  return eventRecord as SanitizableSentryEvent;
};

export type MonitoringConfig = {
  environment: Environment;
  release?: string;
  sentry: {
    dsn: string;
    enabled: boolean;
    enableInDevelopment: boolean;
    tracesSampleRate: number;
    beforeSend: typeof sanitizeSentryEvent;
  };
  logtail: {
    token: string;
    enabled: boolean;
    consoleOnly: boolean;
  };
};

const runtimeEnv = getWindowEnv() ?? getProcessEnv() ?? {};

const environment = resolveEnvironment(runtimeEnv);
const isProductionLike =
  environment === 'production' || environment === 'staging';

const sentryDsn = runtimeEnv.SENTRY_DSN ?? '';
const sentryEnabled =
  Boolean(sentryDsn) &&
  (isProductionLike ||
    normalizeBoolean(runtimeEnv.ENABLE_SENTRY_IN_DEV, false));

const logtailToken = runtimeEnv.BETTER_STACK_TOKEN ?? '';
const logtailEnabled =
  Boolean(logtailToken) &&
  (isProductionLike ||
    normalizeBoolean(runtimeEnv.ENABLE_BETTER_STACK_IN_DEV, false));

export const monitoringConfig: MonitoringConfig = {
  environment,
  release: runtimeEnv.npm_package_version,
  sentry: {
    dsn: sentryDsn,
    enabled: sentryEnabled,
    enableInDevelopment: normalizeBoolean(
      runtimeEnv.ENABLE_SENTRY_IN_DEV,
      false,
    ),
    tracesSampleRate: (() => {
      const rawValue = runtimeEnv.SENTRY_TRACES_SAMPLE_RATE;
      const parsedValue = parseFloat(rawValue ?? '0.1');
      return Number.isNaN(parsedValue) ? 0.1 : parsedValue;
    })(),
    beforeSend: sanitizeSentryEvent,
  },
  logtail: {
    token: logtailToken,
    enabled: logtailEnabled,
    consoleOnly: !logtailEnabled,
  },
};

export const isMonitoringEnabled = () =>
  monitoringConfig.sentry.enabled || monitoringConfig.logtail.enabled;

export const isSentryEnabled = () => monitoringConfig.sentry.enabled;
export const isLogtailEnabled = () => monitoringConfig.logtail.enabled;

export const getMonitoringEnvironment = () => monitoringConfig.environment;

export const getSentryBeforeSend = () => monitoringConfig.sentry.beforeSend;
