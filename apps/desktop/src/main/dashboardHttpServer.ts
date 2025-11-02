import http from "node:http";
import { URL } from "node:url";
import {
  DASHBOARD_HTTP_DEFAULT_HOST,
  DASHBOARD_HTTP_DEFAULT_PORT,
  DASHBOARD_HTTP_ORIGIN_ENV_KEY,
} from "../shared/config/dashboard";
import { getLogger, toErrorPayload } from "../shared/logger";
import {
  getTodaySummary,
  getWeeklySummary,
} from "./database/dailyPostureRepository";

const logger = getLogger("dashboard-http", "main");

let server: http.Server | null = null;
let activeOrigin: string | null = null;

const setDashboardHttpOriginEnv = (origin: string): void => {
  Reflect.set(process.env, DASHBOARD_HTTP_ORIGIN_ENV_KEY, origin);
};

const clearDashboardHttpOriginEnv = (): void => {
  Reflect.deleteProperty(process.env, DASHBOARD_HTTP_ORIGIN_ENV_KEY);
};

const buildHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

const parseConfiguredPort = (): {
  port: number;
  host: string;
  origin: string;
} => {
  const envOrigin = process.env.POSELY_DASHBOARD_HTTP_ORIGIN;
  const envPort = process.env.POSELY_DASHBOARD_HTTP_PORT;

  if (envOrigin) {
    try {
      const parsed = new URL(envOrigin);
      const port = parsed.port
        ? Number(parsed.port)
        : DASHBOARD_HTTP_DEFAULT_PORT;
      const host = parsed.hostname || DASHBOARD_HTTP_DEFAULT_HOST;
      const origin = `${parsed.protocol}//${host}:${port}`;
      return { port, host, origin };
    } catch (error) {
      logger.warn("Failed to parse POSELY_DASHBOARD_HTTP_ORIGIN", {
        origin: envOrigin,
        error: toErrorPayload(error),
      });
    }
  }

  if (envPort) {
    const parsedPort = Number(envPort);
    if (Number.isFinite(parsedPort) && parsedPort > 0) {
      const host = DASHBOARD_HTTP_DEFAULT_HOST;
      const origin = `http://${host}:${parsedPort}`;
      return { port: parsedPort, host, origin };
    }
    logger.warn("Invalid POSELY_DASHBOARD_HTTP_PORT provided", {
      value: envPort,
    });
  }

  const origin = `http://${DASHBOARD_HTTP_DEFAULT_HOST}:${DASHBOARD_HTTP_DEFAULT_PORT}`;
  return {
    port: DASHBOARD_HTTP_DEFAULT_PORT,
    host: DASHBOARD_HTTP_DEFAULT_HOST,
    origin,
  };
};

const handleRequest = (
  req: http.IncomingMessage,
  res: http.ServerResponse<http.IncomingMessage>,
  port: number,
) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!req.url) {
    res.writeHead(400, buildHeaders());
    res.end(JSON.stringify({ error: "Missing request URL" }));
    return;
  }

  let pathname: string;
  try {
    const parsedUrl = new URL(req.url, `http://localhost:${port}`);
    pathname = parsedUrl.pathname;
  } catch (error) {
    logger.warn("Invalid request URL received", {
      url: req.url,
      error: toErrorPayload(error),
    });
    res.writeHead(400, buildHeaders());
    res.end(JSON.stringify({ error: "Invalid request URL" }));
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, buildHeaders());
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (pathname === "/api/dashboard/daily-summary") {
    try {
      const summary = getTodaySummary();
      res.writeHead(200, buildHeaders());
      res.end(JSON.stringify(summary));
    } catch (error) {
      logger.error(
        "Failed to handle daily summary request",
        toErrorPayload(error),
      );
      res.writeHead(500, buildHeaders());
      res.end(JSON.stringify({ error: "Failed to load daily summary" }));
    }
    return;
  }

  if (pathname === "/api/dashboard/weekly-summary") {
    try {
      const summary = getWeeklySummary();
      res.writeHead(200, buildHeaders());
      res.end(JSON.stringify(summary));
    } catch (error) {
      logger.error(
        "Failed to handle weekly summary request",
        toErrorPayload(error),
      );
      res.writeHead(500, buildHeaders());
      res.end(JSON.stringify({ error: "Failed to load weekly summary" }));
    }
    return;
  }

  res.writeHead(404, buildHeaders());
  res.end(JSON.stringify({ error: "Not found" }));
};

export const startDashboardHttpServer = (): void => {
  if (server) {
    logger.warn("Dashboard HTTP server already running", {
      origin: activeOrigin,
    });
    return;
  }

  const { port, host, origin } = parseConfiguredPort();

  server = http.createServer((req, res) => {
    handleRequest(req, res, port);
  });

  const isAddrInUseError = (
    error: unknown,
  ): error is Error & { code: string } =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string";

  server.on("error", (error: unknown) => {
    if (isAddrInUseError(error) && error.code === "EADDRINUSE") {
      logger.error("Dashboard HTTP server port already in use", {
        host,
        port,
      });
    } else {
      logger.error(
        "Dashboard HTTP server encountered an error",
        toErrorPayload(error),
      );
    }
  });

  server.listen(port, host, () => {
    activeOrigin = origin;
    // Share origin with renderer processes via environment so the preload bridge can expose it.
    setDashboardHttpOriginEnv(origin);
    logger.info("Dashboard HTTP server listening", {
      host,
      port,
    });
  });
};

export const stopDashboardHttpServer = (): void => {
  if (!server) {
    return;
  }

  const serverToClose = server;
  server = null;
  activeOrigin = null;
  clearDashboardHttpOriginEnv();
  serverToClose.close((error) => {
    if (error) {
      logger.warn(
        "Failed to close dashboard HTTP server cleanly",
        toErrorPayload(error),
      );
    } else {
      logger.info("Dashboard HTTP server stopped");
    }
  });
};

export const getDashboardHttpOrigin = (): string | null => {
  return activeOrigin;
};
