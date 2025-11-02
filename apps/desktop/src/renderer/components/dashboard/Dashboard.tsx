import { Card, CardBody, CardHeader } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DASHBOARD_HTTP_DEFAULT_ORIGIN,
  DASHBOARD_HTTP_ORIGIN_ENV_KEY,
  DASHBOARD_HTTP_POLL_INTERVAL_MS,
} from "../../../shared/config/dashboard";
import { getLogger } from "../../../shared/logger";
import WeeklyChart from "./WeeklyChart";

const logger = getLogger("Dashboard", "renderer");

type DailySummary = {
  date: string;
  secondsInGreen: number;
  secondsInYellow: number;
  secondsInRed: number;
  avgScore: number;
  sampleCount: number;
  streak?: number; // Optional for backwards compatibility
};

type WeeklySummary = {
  date: string;
  avgScore: number;
  sampleCount: number;
};

type DashboardEnv = {
  VITE_POSELY_DASHBOARD_HTTP_ORIGIN?: string;
  POSELY_DASHBOARD_HTTP_ORIGIN?: string;
  [key: string]: string | undefined;
};

const resolveDashboardHttpOrigin = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const electronEnv = window.electron?.env as
    | (DashboardEnv & Record<string, string | undefined>)
    | undefined;
  const electronOrigin = electronEnv?.[DASHBOARD_HTTP_ORIGIN_ENV_KEY];
  if (electronOrigin && electronOrigin.trim().length > 0) {
    return electronOrigin;
  }

  if (typeof process !== "undefined" && process.env) {
    const processEnv = process.env as DashboardEnv;
    const processOrigin =
      processEnv.VITE_POSELY_DASHBOARD_HTTP_ORIGIN ??
      processEnv[DASHBOARD_HTTP_ORIGIN_ENV_KEY];
    if (processOrigin && processOrigin.trim().length > 0) {
      return processOrigin;
    }
  }

  return DASHBOARD_HTTP_DEFAULT_ORIGIN;
};

/**
 * Dashboard Component
 *
 * This is the main Progress Dashboard UI as specified in Story 2.1.
 * Displays real-time posture data fetched from the database:
 * - Posture Streak (consecutive days meeting goal) - placeholder for now
 * - Today's Score (current posture performance) - from database
 * - Weekly Trend (7-day bar chart) - placeholder for now
 */
function Dashboard() {
  const { t } = useTranslation(["common"]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWeeklyLoading, setIsWeeklyLoading] = useState(true);

  // Refs to track first load state without causing re-renders
  const hasLoadedDailyRef = useRef(false);
  const hasLoadedWeeklyRef = useRef(false);

  useEffect(() => {
    logger.info("Dashboard component mounted, initializing data fetch");
    if (typeof window === "undefined") {
      setIsLoading(false);
      setIsWeeklyLoading(false);
      return () => {
        /* no-op cleanup for non-browser environments */
      };
    }

    const electronApi = window.electron;
    const isElectronEnv = Boolean(electronApi?.ipcRenderer);
    const httpOrigin = resolveDashboardHttpOrigin();

    if (!isElectronEnv) {
      logger.info(
        "Running dashboard in browser mode, using HTTP data fallback",
        {
          httpOrigin,
        },
      );
    }

    let isCancelled = false;
    let unsubscribe: (() => void) | null = null;
    let focusHandler: (() => void) | null = null;
    let pollTimer: number | null = null;

    const fetchJson = async <T,>(url: string): Promise<T | null> => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          logger.warn("Dashboard HTTP request failed", {
            url,
            status: response.status,
            statusText: response.statusText,
          });
          return null;
        }
        return (await response.json()) as T;
      } catch (error) {
        logger.error("Dashboard HTTP request threw", {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };

    const fetchDailySummary = async () => {
      if (!hasLoadedDailyRef.current) {
        setIsLoading(true);
      }

      try {
        let summary: DailySummary | null = null;

        if (isElectronEnv) {
          summary = (await electronApi.ipcRenderer.invoke(
            electronApi.channels.getDailySummary,
          )) as DailySummary | null;
        } else if (httpOrigin) {
          summary =
            (await fetchJson<DailySummary | null>(
              `${httpOrigin}/api/dashboard/daily-summary`,
            )) ?? null;
        }

        if (isCancelled) {
          return;
        }

        logger.info("Fetched daily summary", {
          source: isElectronEnv ? "ipc" : "http",
          avgScore: summary?.avgScore,
          sampleCount: summary?.sampleCount,
        });

        setDailySummary(summary);
      } catch (error) {
        if (!isCancelled) {
          logger.error("Failed to fetch daily summary", {
            error: error instanceof Error ? error.message : String(error),
          });
          setDailySummary(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
          hasLoadedDailyRef.current = true;
        }
      }
    };

    const fetchWeeklySummary = async () => {
      if (!hasLoadedWeeklyRef.current) {
        setIsWeeklyLoading(true);
      }

      try {
        let summary: WeeklySummary[] | null = null;

        if (isElectronEnv) {
          summary = (await electronApi.ipcRenderer.invoke(
            electronApi.channels.getWeeklySummary,
          )) as WeeklySummary[] | null;
        } else if (httpOrigin) {
          summary =
            (await fetchJson<WeeklySummary[] | null>(
              `${httpOrigin}/api/dashboard/weekly-summary`,
            )) ?? [];
        }

        if (isCancelled) {
          return;
        }

        logger.info("Fetched weekly summary", {
          source: isElectronEnv ? "ipc" : "http",
          dataPoints: summary?.length || 0,
        });

        setWeeklySummary(Array.isArray(summary) ? summary : []);
      } catch (error) {
        if (!isCancelled) {
          logger.error("Failed to fetch weekly summary", {
            error: error instanceof Error ? error.message : String(error),
          });
          setWeeklySummary([]);
        }
      } finally {
        if (!isCancelled) {
          setIsWeeklyLoading(false);
          hasLoadedWeeklyRef.current = true;
        }
      }
    };

    const refreshChain = async (): Promise<void> => {
      try {
        await fetchDailySummary();
      } catch {
        /* fetchDailySummary already logs failures */
      }

      if (isCancelled) {
        return;
      }

      try {
        await fetchWeeklySummary();
      } catch {
        /* fetchWeeklySummary already logs failures */
      }
    };

    const triggerRefresh = () => {
      refreshChain().catch(() => {
        /* refreshChain already logs failures */
      });
    };

    triggerRefresh();

    if (isElectronEnv) {
      unsubscribe = electronApi.ipcRenderer.on(
        electronApi.channels.postureDataUpdated,
        () => {
          logger.info(
            "Received posture data update notification, refreshing...",
          );
          triggerRefresh();
        },
      );

      focusHandler = () => {
        logger.info("Window focused, refreshing dashboard data");
        triggerRefresh();
      };

      if (window.addEventListener) {
        window.addEventListener("focus", focusHandler);
      }
    } else {
      pollTimer = window.setInterval(() => {
        logger.debug("Polling dashboard HTTP endpoints for fresh data", {
          intervalMs: DASHBOARD_HTTP_POLL_INTERVAL_MS,
        });
        triggerRefresh();
      }, DASHBOARD_HTTP_POLL_INTERVAL_MS);
    }

    return () => {
      isCancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
      if (focusHandler && window.removeEventListener) {
        window.removeEventListener("focus", focusHandler);
      }
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, []);

  // Calculate display score
  const displayScore =
    dailySummary && dailySummary.sampleCount > 0
      ? Math.round(dailySummary.avgScore)
      : 0;

  // Get streak value
  const streak = dailySummary?.streak ?? 0;

  // Determine score color based on thresholds
  const getScoreColor = (score: number): string => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  // Determine streak color based on value
  const getStreakColor = (streakValue: number): string => {
    if (streakValue >= 7) return "text-green-500"; // Strong habit
    if (streakValue >= 3) return "text-yellow-500"; // Building habit
    return "text-gray-500"; // Getting started
  };

  return (
    <div
      className="flex min-h-screen flex-col gap-6 bg-gradient-to-br from-slate-50 to-slate-100 p-6"
      data-testid="dashboard"
    >
      <header>
        <h1 className="text-2xl font-semibold text-slate-800">
          {t("dashboard.title", "Progress Dashboard")}
        </h1>
      </header>

      <main className="flex flex-col gap-4">
        {/* Posture Streak Card */}
        <Card className="bg-white shadow-md">
          <CardHeader className="flex flex-col items-center gap-2 pb-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-600">
              {t("dashboard.streak.title", "Posture Streak")}
            </h2>
          </CardHeader>
          <CardBody className="flex items-center justify-center py-6">
            {isLoading ? (
              <div className="text-2xl text-slate-400">Loading...</div>
            ) : (
              <div
                className="text-5xl font-bold"
                title="Consecutive days with score ≥ 70%"
              >
                <span role="img" aria-label="fire">
                  🔥
                </span>{" "}
                <span className={getStreakColor(streak)}>{streak}</span>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Today's Score Card */}
        <Card className="bg-white shadow-md">
          <CardHeader className="flex flex-col items-center gap-2 pb-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-600">
              {t("dashboard.score.title", "Today's Score")}
            </h2>
          </CardHeader>
          <CardBody className="flex items-center justify-center py-6">
            {isLoading ? (
              <div className="text-2xl text-slate-400">Loading...</div>
            ) : (
              <div
                className={`text-6xl font-bold ${getScoreColor(displayScore)}`}
              >
                {displayScore}%
              </div>
            )}
          </CardBody>
        </Card>

        {/* Weekly Trend Card */}
        <Card className="bg-white shadow-md">
          <CardHeader className="flex flex-col items-center gap-2 pb-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-600">
              {t("dashboard.trend.title", "Weekly Trend")}
            </h2>
          </CardHeader>
          <CardBody className="py-6">
            {isWeeklyLoading ? (
              <div
                className="flex items-center justify-center"
                style={{ height: "120px" }}
              >
                <div className="text-2xl text-slate-400">Loading...</div>
              </div>
            ) : (
              <WeeklyChart data={weeklySummary} />
            )}
          </CardBody>
        </Card>
      </main>
    </div>
  );
}

export default Dashboard;
