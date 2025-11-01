import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../Settings";

// Mock logger
vi.mock("../../../../shared/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue: string) => defaultValue,
  }),
}));

describe("Settings Component", () => {
  const mockInvoke = vi.fn();
  const mockElectron = {
    ipcRenderer: {
      invoke: mockInvoke,
      sendMessage: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    },
    channels: {
      getSetting: "settings:get",
      setSetting: "settings:set",
      reCalibrate: "calibration:re-calibrate",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup window.electron
    Object.defineProperty(window, "electron", {
      value: mockElectron,
      writable: true,
      configurable: true,
    });

    // Default mock implementations
    mockInvoke.mockImplementation((channel: string, key?: string) => {
      if (channel === "settings:get") {
        if (key === "launchAtStartup") return Promise.resolve("false");
        if (key === "sensitivity") return Promise.resolve("50");
      }
      return Promise.resolve({ success: true });
    });
  });

  it("should fetch and display initial settings values", async () => {
    mockInvoke.mockImplementation((channel: string, key?: string) => {
      if (channel === "settings:get") {
        if (key === "launchAtStartup") return Promise.resolve("true");
        if (key === "sensitivity") return Promise.resolve("75");
      }
      return Promise.resolve({ success: true });
    });

    render(<Settings />);

    await waitFor(() => {
      expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    });

    // Check that settings were fetched
    expect(mockInvoke).toHaveBeenCalledWith("settings:get", "launchAtStartup");
    expect(mockInvoke).toHaveBeenCalledWith("settings:get", "sensitivity");

    // Verify the checkbox is checked (launchAtStartup = true)
    const checkbox = screen.getByRole("checkbox", { name: /launch at startup/i });
    expect(checkbox).toBeChecked();
  });

  it("should call setSetting when launch at startup checkbox is toggled", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => {
      expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox", { name: /launch at startup/i });

    await user.click(checkbox);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "settings:set",
        "launchAtStartup",
        "true",
      );
    });
  });

  it("should call setSetting when sensitivity slider is changed", async () => {
    render(<Settings />);

    await waitFor(() => {
      expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    });

    // Find the slider input by its role
    const slider = screen.getByRole("slider");

    // Simulate changing the slider value using fireEvent
    fireEvent.change(slider, { target: { value: 80 } });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "settings:set",
        "sensitivity",
        "80",
      );
    });
  });

  it("should trigger re-calibrate IPC when re-calibrate button is clicked", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => {
      expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    });

    const reCalibButton = screen.getByRole("button", {
      name: /re-calibrate posture/i,
    });

    await user.click(reCalibButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("calibration:re-calibrate");
    });
  });

  it("should display loading state initially", () => {
    render(<Settings />);

    expect(screen.getByText("Loading settings...")).toBeInTheDocument();
  });

  it("should handle errors gracefully when fetching settings fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error("Failed to fetch settings"));

    render(<Settings />);

    await waitFor(() => {
      expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    });

    // Should still render the UI with default values
    expect(screen.getByText(/Settings/i)).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
