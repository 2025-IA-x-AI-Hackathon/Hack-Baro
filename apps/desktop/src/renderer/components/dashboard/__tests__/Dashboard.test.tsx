import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeroUIProvider } from "@heroui/react";
import { Dashboard } from "../Dashboard";

describe("Dashboard Component", () => {
  const renderDashboard = () => {
    return render(
      <HeroUIProvider>
        <Dashboard />
      </HeroUIProvider>
    );
  };

  it("renders the posture streak section with placeholder data", () => {
    renderDashboard();
    
    expect(screen.getByText("Posture Streak")).toBeInTheDocument();
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("days")).toBeInTheDocument();
  });

  it("renders the today's score section with placeholder data", () => {
    renderDashboard();
    
    expect(screen.getByText("Today's Score")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("posture quality")).toBeInTheDocument();
  });

  it("renders the weekly trend section", () => {
    renderDashboard();
    
    expect(screen.getByText("Weekly Trend")).toBeInTheDocument();
    
    // Check that all days of the week are displayed
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    days.forEach(day => {
      expect(screen.getByText(day)).toBeInTheDocument();
    });
  });

  it("renders 7 bars in the weekly trend chart", () => {
    const { container } = renderDashboard();
    
    // Find all the bar elements by checking for divs with the bg-blue-500 class
    const bars = container.querySelectorAll('.bg-blue-500');
    expect(bars.length).toBe(7);
  });
});
