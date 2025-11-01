import { Card, CardBody, CardHeader } from "@heroui/react";
import { useEffect, useState } from "react";

type DailySummary = {
  date: string;
  secondsInGreen: number;
  secondsInYellow: number;
  secondsInRed: number;
  avgScore: number;
  sampleCount: number;
};

export const Dashboard = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Placeholder data for initial implementation
  const streak = 12;
  const weeklyData = [
    { day: "Mon", score: 85 },
    { day: "Tue", score: 88 },
    { day: "Wed", score: 90 },
    { day: "Thu", score: 87 },
    { day: "Fri", score: 92 },
    { day: "Sat", score: 89 },
    { day: "Sun", score: 91 },
  ];

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

    fetchDailySummary();
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
              <div className="mt-2 text-5xl font-bold text-slate-800">
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
            <div className="flex h-48 items-end justify-around gap-2 px-4">
              {weeklyData.map((data) => (
                <div key={data.day} className="flex flex-1 flex-col items-center">
                  <div className="relative w-full">
                    <div
                      className="w-full rounded-t-md bg-blue-500 transition-all hover:bg-blue-600"
                      style={{
                        height: `${(data.score / 100) * 160}px`,
                      }}
                      title={`${data.day}: ${data.score}%`}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{data.day}</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
