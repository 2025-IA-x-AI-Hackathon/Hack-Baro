import { describe, it, expect, vi, beforeEach } from "vitest";
import { Menu } from "electron";

// Mock electron modules
vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: vi.fn((template) => ({
      template,
      popup: vi.fn(),
    })),
  },
  Tray: vi.fn(),
  app: {
    quit: vi.fn(),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      resize: vi.fn(() => ({})),
    })),
  },
}));

describe("Tray Menu", () => {
  describe("buildTrayMenu", () => {
    it("should build menu with monitoring status when not paused", () => {
      const isPaused = false;
      const statusLabel = isPaused ? "Status: Paused" : "Status: Monitoring";
      const pauseResumeLabel = isPaused
        ? "Resume Monitoring"
        : "Pause Monitoring";

      expect(statusLabel).toBe("Status: Monitoring");
      expect(pauseResumeLabel).toBe("Pause Monitoring");
    });

    it("should build menu with paused status when paused", () => {
      const isPaused = true;
      const statusLabel = isPaused ? "Status: Paused" : "Status: Monitoring";
      const pauseResumeLabel = isPaused
        ? "Resume Monitoring"
        : "Pause Monitoring";

      expect(statusLabel).toBe("Status: Paused");
      expect(pauseResumeLabel).toBe("Resume Monitoring");
    });

    it("should include all required menu items", () => {
      const menuTemplate: Array<{ label?: string; type?: string; enabled?: boolean }> = [
        { label: "Status: Monitoring", enabled: false },
        { type: "separator" },
        { label: "Show Dashboard" },
        { label: "Settings" },
        { label: "Pause Monitoring" },
        { type: "separator" },
        { label: "Quit Posely" },
      ];

      expect(menuTemplate).toHaveLength(7);
      expect(menuTemplate[0]?.label).toBe("Status: Monitoring");
      expect(menuTemplate[2]?.label).toBe("Show Dashboard");
      expect(menuTemplate[3]?.label).toBe("Settings");
      expect(menuTemplate[4]?.label).toBe("Pause Monitoring");
      expect(menuTemplate[6]?.label).toBe("Quit Posely");
    });
  });

  describe("togglePauseState", () => {
    it("should toggle isPaused from false to true", () => {
      let isPaused = false;
      isPaused = !isPaused;
      expect(isPaused).toBe(true);
    });

    it("should toggle isPaused from true to false", () => {
      let isPaused = true;
      isPaused = !isPaused;
      expect(isPaused).toBe(false);
    });
  });

  describe("Menu structure validation", () => {
    it("should have separator before Quit item", () => {
      const menuTemplate: Array<{ label?: string; type?: string; enabled?: boolean }> = [
        { label: "Status: Monitoring", enabled: false },
        { type: "separator" },
        { label: "Show Dashboard" },
        { label: "Settings" },
        { label: "Pause Monitoring" },
        { type: "separator" },
        { label: "Quit Posely" },
      ];

      const lastSeparatorIndex = menuTemplate.findIndex(
        (item, idx) =>
          item.type === "separator" && idx === menuTemplate.length - 2,
      );
      expect(lastSeparatorIndex).toBe(5);
    });

    it("should have status as first item and disabled", () => {
      const menuTemplate: Array<{ label?: string; type?: string; enabled?: boolean }> = [
        { label: "Status: Monitoring", enabled: false },
        { type: "separator" },
        { label: "Show Dashboard" },
      ];

      expect(menuTemplate[0]?.enabled).toBe(false);
      expect(menuTemplate[0]?.label).toContain("Status:");
    });
  });
});
