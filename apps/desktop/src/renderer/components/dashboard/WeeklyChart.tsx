import { useState } from "react";

type WeeklySummary = {
  date: string;
  avgScore: number;
  sampleCount: number;
};

type WeeklyChartProps = {
  data: WeeklySummary[];
};

/**
 * WeeklyChart Component
 *
 * Displays a bar chart showing daily average posture scores for the past 7 days.
 * Features:
 * - Simple div-based bars (no heavy chart library)
 * - Animated entry (bars grow from baseline)
 * - Hover tooltips showing date and score
 * - Color-coded bars based on score thresholds (green >= 80, yellow >= 60, red < 60)
 */
function WeeklyChart({ data }: WeeklyChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Format date to short day name (Mon, Tue, etc.)
  const formatDayLabel = (dateString: string): string => {
    const date = new Date(dateString);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[date.getDay()] || "???";
  };

  // Get bar color based on score thresholds
  const getBarColor = (score: number): string => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  // Format tooltip text
  const getTooltipText = (item: WeeklySummary): string => {
    const date = new Date(item.date);
    const formattedDate = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const score = Math.round(item.avgScore);
    return `${formattedDate}: ${score}%`;
  };

  // Handle case where there's no data
  if (data.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center px-4">
        <p className="text-sm text-slate-400">No data available yet</p>
      </div>
    );
  }

  return (
    <div className="relative px-4" style={{ height: "120px" }}>
      <div className="flex h-full items-end justify-around gap-2">
        {data.map((item, index) => {
          const score = Math.round(item.avgScore);
          // Only show bars for days with data (sampleCount > 0)
          const heightPercent = item.sampleCount > 0 ? score : 0;

          return (
            <div
              key={item.date}
              className="relative flex flex-1 flex-col items-center gap-2"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Tooltip */}
              {hoveredIndex === index && item.sampleCount > 0 && (
                <div className="absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white shadow-lg">
                  {getTooltipText(item)}
                </div>
              )}

              {/* Bar */}
              <div
                className={`weekly-chart-bar w-full rounded-t transition-all duration-300 hover:opacity-80 ${
                  item.sampleCount > 0
                    ? getBarColor(item.avgScore)
                    : "bg-slate-200"
                }`}
                style={{
                  height: `${heightPercent}%`,
                  animationDelay: `${index * 50}ms`,
                }}
                title={item.sampleCount > 0 ? getTooltipText(item) : "No data"}
              />

              {/* Day label */}
              <span className="text-xs text-slate-500">
                {formatDayLabel(item.date)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default WeeklyChart;
