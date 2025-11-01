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
          streak: 0,
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

  it("renders the posture streak section with dynamic data", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        avgScore: 0,
        sampleCount: 0,
        streak: 5,
      },
    });

    renderDashboard();
    
    expect(screen.getByText("Posture Streak")).toBeInTheDocument();
    expect(screen.getByText("🔥")).toBeInTheDocument();
    await screen.findByText("5");
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
        streak: 12,
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
        streak: 0,
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
            streak: 0,
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

  describe("Streak Color Coding", () => {
    it("displays gray color for streak 0-2 days", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: {
          date: "2025-11-02",
          secondsInGreen: 0,
          secondsInYellow: 0,
          secondsInRed: 0,
          avgScore: 65,
          sampleCount: 100,
          streak: 2,
        },
      });

      renderDashboard();
      
      const streakElement = await screen.findByText("2");
      expect(streakElement).toHaveClass("text-gray-500");
    });

    it("displays yellow color for streak 3-6 days", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: {
          date: "2025-11-02",
          secondsInGreen: 0,
          secondsInYellow: 0,
          secondsInRed: 0,
          avgScore: 75,
          sampleCount: 100,
          streak: 5,
        },
      });

      renderDashboard();
      
      const streakElement = await screen.findByText("5");
      expect(streakElement).toHaveClass("text-yellow-500");
    });

    it("displays green color for streak 7+ days", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: {
          date: "2025-11-02",
          secondsInGreen: 0,
          secondsInYellow: 0,
          secondsInRed: 0,
          avgScore: 85,
          sampleCount: 100,
          streak: 10,
        },
      });

      renderDashboard();
      
      const streakElement = await screen.findByText("10");
      expect(streakElement).toHaveClass("text-green-500");
    });

    it("includes tooltip with streak explanation", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: {
          date: "2025-11-02",
          secondsInGreen: 0,
          secondsInYellow: 0,
          secondsInRed: 0,
          avgScore: 75,
          sampleCount: 100,
          streak: 5,
        },
      });

      renderDashboard();
      
      const streakElement = await screen.findByText("5");
      expect(streakElement).toHaveAttribute("title", "Consecutive days with score ≥ 70%");
    });
  });
});
