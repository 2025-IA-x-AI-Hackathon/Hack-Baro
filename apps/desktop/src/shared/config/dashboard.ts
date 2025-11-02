/**
 * Dashboard HTTP Server Configuration
 *
 * Shared constants for the dashboard HTTP server and client.
 * These values are used by both the main process (server) and renderer process (client).
 */

/**
 * Default port for the dashboard HTTP server
 */
export const DASHBOARD_HTTP_DEFAULT_PORT = 3212;

/**
 * Default host for the dashboard HTTP server
 */
export const DASHBOARD_HTTP_DEFAULT_HOST = "127.0.0.1";

/**
 * Default origin for the dashboard HTTP server
 */
export const DASHBOARD_HTTP_DEFAULT_ORIGIN = `http://${DASHBOARD_HTTP_DEFAULT_HOST}:${DASHBOARD_HTTP_DEFAULT_PORT}`;

/**
 * Environment variable key for dashboard HTTP origin
 */
export const DASHBOARD_HTTP_ORIGIN_ENV_KEY = "POSELY_DASHBOARD_HTTP_ORIGIN";

/**
 * Polling interval in milliseconds for HTTP-based dashboard updates (browser mode)
 */
export const DASHBOARD_HTTP_POLL_INTERVAL_MS = 30000;
