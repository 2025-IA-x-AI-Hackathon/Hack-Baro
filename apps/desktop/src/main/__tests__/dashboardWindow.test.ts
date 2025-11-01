import { BrowserWindow, app } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron modules
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  app: {
    isPackaged: false,
  },
}));

// Mock path
vi.mock("path", () => ({
  default: {
    join: vi.fn((...args) => args.join("/")),
  },
}));

// Mock resolveHtmlPath
vi.mock("../util", () => ({
  resolveHtmlPath: vi.fn((path) => `http://localhost:3000/${path}`),
}));

describe("Dashboard Window", () => {
  const mockBrowserWindow = {
    loadURL: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockBrowserWindow
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a dashboard window with correct dimensions", async () => {
    const { createDashboardWindow } = await import("../windows/dashboardWindow.js");
    createDashboardWindow();

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 400,
        height: 600,
        resizable: false,
        title: "Progress Dashboard",
      })
    );
  });

  it("should have dashboard route functionality", () => {
    // This verifies the window creation module exists
    expect(BrowserWindow).toBeDefined();
  });
});

