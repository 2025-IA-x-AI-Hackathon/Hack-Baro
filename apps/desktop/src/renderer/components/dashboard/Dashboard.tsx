import { Card, CardBody, CardHeader } from "@heroui/react";
import { useEffect, useState } from "react";

export const Dashboard = () => {
  // Placeholder data for initial implementation
  const [streak, setStreak] = useState(12);
  const [todayScore, setTodayScore] = useState(92);
  const [weeklyData, setWeeklyData] = useState([
    { day: "Mon", score: 85 },
    { day: "Tue", score: 88 },
    { day: "Wed", score: 90 },
    { day: "Thu", score: 87 },
    { day: "Fri", score: 92 },
    { day: "Sat", score: 89 },
    { day: "Sun", score: 91 },
  ]);

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
            <div className="text-center">
              <div className="text-6xl font-bold text-blue-500">
                {todayScore}%
              </div>
              <div className="mt-1 text-sm text-slate-500">
                posture quality
              </div>
            </div>
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
              {weeklyData.map((data, index) => (
                <div key={index} className="flex flex-1 flex-col items-center">
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
