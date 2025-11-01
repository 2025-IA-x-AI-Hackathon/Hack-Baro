import { Card, CardBody, CardHeader } from "@heroui/react";
import { useEffect, useState } from "react";
import { WeeklyChart, type WeeklyDataPoint } from "./WeeklyChart";

type DailySummary = {
  date: string;
  secondsInGreen: number;
  secondsInYellow: number;
  secondsInRed: number;
  avgScore: number;
  sampleCount: number;
  streak: number;
};

export const Dashboard = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklyDataPoint[]>([]);
  const [isLoadingWeekly, setIsLoadingWeekly] = useState(true);

  // Helper function to get color based on streak value
  const getStreakColor = (streakValue: number): string => {
    if (streakValue >= 7) return "text-green-500";
    if (streakValue >= 3) return "text-yellow-500";
    return "text-gray-500";
  };

  const streak = dailySummary?.streak ?? 0;

  useEffect(() => {
    const fetchDailySummary = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await window.electron.ipcRenderer.invoke(
          window.electron.channels.getDailySummary,
        );

        if (response.success && response.data) {
          setDailySummary(response.data);
        } else {
          setError(response.error ?? "Failed to fetch daily summary");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    const fetchWeeklySummary = async () => {
      setIsLoadingWeekly(true);

      try {
        const response = await window.electron.ipcRenderer.invoke(
          window.electron.channels.getWeeklySummary,
        );

        if (response.success && response.data) {
          setWeeklyData(response.data);
        } else {
          console.error("Failed to fetch weekly summary:", response.error);
        }
      } catch (err) {
        console.error("Error fetching weekly summary:", err);
      } finally {
        setIsLoadingWeekly(false);
      }
    };

    fetchDailySummary();
    fetchWeeklySummary();
  }, []);

  const todayScore = dailySummary?.avgScore ?? 0;

  return (
    <div className="flex min-h-screen items-start justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Posture Streak Card */}
        <Card className="shadow-md">
          <CardHeader className="flex justify-center pb-2">
            <h3 className="text-lg font-semibold text-slate-700">
              Posture Streak
            </h3>
          </CardHeader>
          <CardBody className="flex items-center justify-center py-6">
            <div className="text-center">
              <div className="text-6xl">🔥</div>
              <div
                className={`mt-2 text-5xl font-bold ${getStreakColor(streak)}`}
                title="Consecutive days with score ≥ 70%"
              >
                {streak}
              </div>
              <div className="mt-1 text-sm text-slate-500">days</div>
            </div>
          </CardBody>
        </Card>

        {/* Today's Score Card */}
        <Card className="shadow-md">
          <CardHeader className="flex justify-center pb-2">
            <h3 className="text-lg font-semibold text-slate-700">
              Today's Score
            </h3>
          </CardHeader>
          <CardBody className="flex items-center justify-center py-6">
            {isLoading ? (
              <div className="text-center">
                <div className="text-sm text-slate-500">Loading...</div>
              </div>
            ) : error ? (
              <div className="text-center">
                <div className="text-sm text-red-500">Error: {error}</div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-6xl font-bold text-blue-500">
                  {Math.round(todayScore)}%
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  posture quality
                </div>
                {dailySummary && dailySummary.sampleCount > 0 && (
                  <div className="mt-2 text-xs text-slate-400">
                    {dailySummary.sampleCount} samples
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Weekly Trend Card */}
        <Card className="shadow-md">
          <CardHeader className="flex justify-center pb-2">
            <h3 className="text-lg font-semibold text-slate-700">
              Weekly Trend
            </h3>
          </CardHeader>
          <CardBody className="py-6">
            {isLoadingWeekly ? (
              <div className="flex h-48 items-center justify-center">
                <div className="text-sm text-slate-500">Loading chart...</div>
              </div>
            ) : (
              <WeeklyChart data={weeklyData} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
