import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SanitizableSentryEvent } from "../shared/config/monitoring.js";

const ORIGINAL_ENV = { ...process.env };

const setEnv = (values: Record<string, string | undefined>) => {
  Object.entries(values).forEach(([key, value]) => {
    if (typeof value === "undefined") {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });
};

type MonitoringModule = typeof import("../shared/config/monitoring.js");

const loadMonitoringModule = async (): Promise<MonitoringModule> => {
  vi.resetModules();
  const module = await import("../shared/config/monitoring.js");
  return module;
};

beforeEach(() => {
  setEnv({});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("monitoring configuration", () => {
  it("disables Sentry when DSN is absent", async () => {
    setEnv({
      NODE_ENV: "development",
      SENTRY_DSN: "",
    });

    const { monitoringConfig } = await loadMonitoringModule();

    expect(monitoringConfig.sentry.enabled).toBe(false);
  });

  it("enables Sentry and Better Stack in production when tokens are present", async () => {
    setEnv({
      NODE_ENV: "production",
      SENTRY_DSN: "https://examplePublicKey.ingest.sentry.io/1234",
      BETTER_STACK_TOKEN: "logtail-token",
    });

    const { monitoringConfig } = await loadMonitoringModule();

    expect(monitoringConfig.sentry.enabled).toBe(true);
    expect(monitoringConfig.logtail.enabled).toBe(true);
    expect(monitoringConfig.environment).toBe("production");
  });

  it("sanitises sensitive fields via beforeSend hook", async () => {
    setEnv({
      NODE_ENV: "production",
      SENTRY_DSN: "https://examplePublicKey.ingest.sentry.io/1234",
    });

    const { monitoringConfig } = await loadMonitoringModule();
    const fakeEvent: SanitizableSentryEvent = {
      user: {
        id: "user-123",
        email: "person@example.com",
      },
      extra: {
        password: "secret",
        nested: {
          token: "abc123",
        },
      },
      breadcrumbs: [
        {
          timestamp: Date.now() / 1000,
          category: "ui",
          message: "Clicked button",
          data: {
            password: "open-sesame",
          },
        },
      ],
    };

    const sanitised = monitoringConfig.sentry.beforeSend(
      fakeEvent,
    ) as SanitizableSentryEvent;

    expect(sanitised?.user).toEqual({ id: "user-123" });
    expect(sanitised?.extra).toMatchObject({
      password: "[redacted]",
      nested: {
        token: "[redacted]",
      },
    });
    const breadcrumbs = sanitised?.breadcrumbs as
      | Array<Record<string, unknown>>
      | undefined;

    expect(breadcrumbs?.[0]?.data).toMatchObject({
      password: "[redacted]",
    });
  });
});
