import { useState } from "react";

export type WeeklyDataPoint = {
  date: string;
  score: number;
};

type WeeklyChartProps = {
  data: WeeklyDataPoint[];
};

export const WeeklyChart = ({ data }: WeeklyChartProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Ensure we always display 7 days (fill missing days with 0 score)
  const fillDataForSevenDays = (): WeeklyDataPoint[] => {
    const today = new Date();
    const result: WeeklyDataPoint[] = [];

    // Ensure data is an array
    const dataArray = Array.isArray(data) ? data : [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      const existingData = dataArray.find((d) => d.date === dateStr);
      result.push({
        date: dateStr!,
        score: existingData?.score ?? 0,
      });
    }

    return result;
  };

  const weeklyData = fillDataForSevenDays();

  // Get day of week labels
  const getDayLabel = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { weekday: "short" });
  };

  // Format date for tooltip
  const formatTooltipDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="flex h-48 items-end justify-around gap-2 px-4">
      {weeklyData.map((dataPoint, index) => {
        const barHeight = (dataPoint.score / 100) * 160;
        const hasData = dataPoint.score > 0;

        return (
          <div
            key={dataPoint.date}
            className="relative flex flex-1 flex-col items-center"
          >
            {/* Tooltip */}
            {hoveredIndex === index && (
              <div className="absolute bottom-full mb-2 whitespace-nowrap rounded-md bg-slate-800 px-3 py-1.5 text-xs text-white shadow-lg">
                <div className="font-semibold">
                  {formatTooltipDate(dataPoint.date)}
                </div>
                <div className="text-slate-300">
                  {hasData
                    ? `${Math.round(dataPoint.score)}% quality`
                    : "No data"}
                </div>
                {/* Arrow pointer */}
                <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
              </div>
            )}

            {/* Bar */}
            <div className="relative w-full">
              <div
                className={`
                  w-full rounded-t-md transition-all duration-500
                  ${hasData ? "bg-blue-500 hover:bg-blue-600" : "bg-slate-200"}
                `}
                style={{
                  height: `${barHeight}px`,
                  transform: `scaleY(1)`,
                  transformOrigin: "bottom",
                  // Staggered animation
                  animation: `growBar 500ms ease-out ${index * 50}ms backwards`,
                }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                title={
                  hasData
                    ? `${formatTooltipDate(dataPoint.date)}: ${Math.round(dataPoint.score)}%`
                    : `${formatTooltipDate(dataPoint.date)}: No data`
                }
              />
            </div>

            {/* Day label */}
            <div className="mt-2 text-xs text-slate-500">
              {getDayLabel(dataPoint.date)}
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes growBar {
          from {
            transform: scaleY(0);
          }
          to {
            transform: scaleY(1);
          }
        }
      `}</style>
    </div>
  );
};
