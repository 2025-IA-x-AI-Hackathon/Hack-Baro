import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { HeroUIProvider } from "@heroui/react";
import { Dashboard } from "../Dashboard";

// Mock window.electron
const mockInvoke = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  
  // Mock the electron API
  (global as any).window = {
    electron: {
      ipcRenderer: {
        invoke: mockInvoke,
      },
      channels: {
        getDailySummary: "dashboard:get-daily-summary",
      },
    },
  };
});

describe("Dashboard Component", () => {
  const renderDashboard = () => {
    return render(
      <HeroUIProvider>
        <Dashboard />
      </HeroUIProvider>
    );
  };

  it("renders the posture streak section with placeholder data", () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        avgScore: 0,
        sampleCount: 0,
      },
    });

    renderDashboard();
    
    expect(screen.getByText("Posture Streak")).toBeInTheDocument();
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("days")).toBeInTheDocument();
  });

  it("displays loading state initially", () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        avgScore: 0,
        sampleCount: 0,
      },
    });

    renderDashboard();
    
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("fetches and displays dynamically loaded score", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: {
        date: "2025-11-02",
        secondsInGreen: 120,
        secondsInYellow: 45,
        secondsInRed: 15,
        avgScore: 85.5,
        sampleCount: 180,
      },
    });

    renderDashboard();
    
    // Wait for data to load
    await screen.findByText("86%"); // Rounded from 85.5
    expect(screen.getByText("180 samples")).toBeInTheDocument();
  });

  it("handles zero samples gracefully", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        avgScore: 0,
        sampleCount: 0,
      },
    });

    renderDashboard();
    
    await screen.findByText("0%");
  });

  it("displays error state when fetch fails", async () => {
    mockInvoke.mockResolvedValue({
      success: false,
      error: "Database error",
    });

    renderDashboard();
    
    await screen.findByText(/Error: Database error/);
  });

  it("renders the weekly trend section", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        avgScore: 0,
        sampleCount: 0,
      },
    });

    renderDashboard();
    
    await screen.findByText("Weekly Trend");
    
    // Check that all days of the week are displayed
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    days.forEach(day => {
      expect(screen.getByText(day)).toBeInTheDocument();
    });
  });

  it("renders 7 bars in the weekly trend chart", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        avgScore: 0,
        sampleCount: 0,
      },
    });

    const { container } = renderDashboard();
    
    await screen.findByText("Weekly Trend");
    const bars = container.querySelectorAll('.bg-blue-500');
    expect(bars.length).toBe(7);
  });
});
