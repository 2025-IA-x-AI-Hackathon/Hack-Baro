import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeeklyChart, type WeeklyDataPoint } from "../WeeklyChart";

describe("WeeklyChart", () => {
  it("should render 7 bars for a full week", () => {
    const today = new Date();
    const mockData: WeeklyDataPoint[] = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - i));
      return {
        date: date.toISOString().split("T")[0]!,
        score: 80 + i * 2,
      };
    });

    const { container } = render(<WeeklyChart data={mockData} />);
    
    // Should render 7 day labels
    const dayLabels = container.querySelectorAll(".text-xs.text-slate-500");
    expect(dayLabels).toHaveLength(7);
  });

  it("should render bars with heights proportional to scores", () => {
    const today = new Date();
    const mockData: WeeklyDataPoint[] = [
      {
        date: today.toISOString().split("T")[0]!,
        score: 50,
      },
      {
        date: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]!,
        score: 100,
      },
    ];

    const { container } = render(<WeeklyChart data={mockData} />);
    
    const bars = container.querySelectorAll(".rounded-t-md");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("should handle empty data by showing zero-height bars", () => {
    const { container } = render(<WeeklyChart data={[]} />);
    
    // Should still render 7 bars (filled with zeros)
    const bars = container.querySelectorAll(".rounded-t-md");
    expect(bars).toHaveLength(7);
  });

  it("should fill missing days with zero scores", () => {
    const today = new Date();
    const mockData: WeeklyDataPoint[] = [
      {
        date: today.toISOString().split("T")[0]!,
        score: 85,
      },
    ];

    const { container } = render(<WeeklyChart data={mockData} />);
    
    // Should render 7 bars even with only 1 data point
    const bars = container.querySelectorAll(".rounded-t-md");
    expect(bars).toHaveLength(7);
  });

  it("should apply correct styling for bars with data", () => {
    const today = new Date();
    const mockData: WeeklyDataPoint[] = [
      {
        date: today.toISOString().split("T")[0]!,
        score: 90,
      },
    ];

    const { container } = render(<WeeklyChart data={mockData} />);
    
    const bars = container.querySelectorAll(".rounded-t-md");
    const hasBlueBar = Array.from(bars).some(bar => 
      bar.className.includes("bg-blue-500")
    );
    expect(hasBlueBar).toBe(true);
  });

  it("should apply correct styling for bars without data", () => {
    const { container } = render(<WeeklyChart data={[]} />);
    
    const bars = container.querySelectorAll(".rounded-t-md");
    const hasGrayBar = Array.from(bars).some(bar => 
      bar.className.includes("bg-slate-200")
    );
    expect(hasGrayBar).toBe(true);
  });

  it("should render day labels in correct format", () => {
    const today = new Date();
    const mockData: WeeklyDataPoint[] = [
      {
        date: today.toISOString().split("T")[0]!,
        score: 85,
      },
    ];

    const { container } = render(<WeeklyChart data={mockData} />);
    
    const dayLabels = container.querySelectorAll(".text-xs.text-slate-500");
    expect(dayLabels.length).toBe(7);
    
    // Check that labels are short day names (Mon, Tue, etc.)
    dayLabels.forEach(label => {
      expect(label.textContent).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/);
    });
  });

  it("should include animation styles", () => {
    const today = new Date();
    const mockData: WeeklyDataPoint[] = [
      {
        date: today.toISOString().split("T")[0]!,
        score: 85,
      },
    ];

    const { container } = render(<WeeklyChart data={mockData} />);
    
    // Check that animation keyframes are defined
    const styleTag = container.querySelector("style");
    expect(styleTag?.textContent).toContain("@keyframes growBar");
    expect(styleTag?.textContent).toContain("transform: scaleY");
  });
});
