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
        getWeeklySummary: "dashboard:get-weekly-summary",
      },
    },
  };
  
  // Default mock responses
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === "dashboard:get-daily-summary") {
      return Promise.resolve({
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
    } else if (channel === "dashboard:get-weekly-summary") {
      return Promise.resolve({
        success: true,
        data: [],
      });
    }
    return Promise.resolve({ success: false });
  });
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
    renderDashboard();
    
    expect(screen.getByText("Posture Streak")).toBeInTheDocument();
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("days")).toBeInTheDocument();
  });

  it("displays loading state initially", () => {
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
    renderDashboard();
    
    await screen.findByText("Weekly Trend");
  });

  it("displays weekly chart with data from IPC", async () => {
    const today = new Date();
    const mockWeeklyData = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - i));
      return {
        date: date.toISOString().split("T")[0],
        score: 80 + i * 2,
      };
    });

    mockInvoke.mockImplementation((channel: string) => {
      if (channel === "dashboard:get-daily-summary") {
        return Promise.resolve({
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
      } else if (channel === "dashboard:get-weekly-summary") {
        return Promise.resolve({
          success: true,
          data: mockWeeklyData,
        });
      }
      return Promise.resolve({ success: false });
    });

    renderDashboard();
    
    await screen.findByText("Weekly Trend");
    
    // Chart should be rendered (not loading)
    const loadingText = screen.queryByText("Loading chart...");
    expect(loadingText).not.toBeInTheDocument();
  });

  it("displays loading state for weekly chart initially", () => {
    renderDashboard();
    
    expect(screen.getByText("Loading chart...")).toBeInTheDocument();
  });
});
