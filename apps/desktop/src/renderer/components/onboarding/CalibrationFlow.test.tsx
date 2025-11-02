import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronHandler } from "../../../main/preload";
import {
  IPC_CHANNELS,
  type RendererChannel,
} from "../../../shared/ipcChannels";
import type {
  CalibrationCompletePayload,
  CalibrationProgress,
} from "../../../shared/types/calibration";
import { CalibrationFlow } from "./CalibrationFlow";

type InvokeFn = ElectronHandler["ipcRenderer"]["invoke"];

const mockMediaStream = () => {
  const stop = vi.fn();
  const track = { stop };
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
};

const setupMediaMocks = () => {
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    set() {
      // no-op for tests
    },
    configurable: true,
  });

  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  });

  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(mockMediaStream()),
    },
    configurable: true,
  });
};

const triggerCameraReady = () => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });

  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

describe("CalibrationFlow", () => {
  beforeEach(() => {
    setupMediaMocks();
  });

  const createElectronMock = () => {
    const progressListeners = new Set<(...args: unknown[]) => void>();

    const invoke = vi.fn<InvokeFn>(async (channel) => {
      if (channel !== IPC_CHANNELS.calibrationStart) {
        throw new Error(`Unexpected channel ${String(channel)}`);
      }

      const progressEvent: CalibrationProgress = {
        phase: "collecting",
        collectedSamples: 80,
        targetSamples: 100,
        stabilityScore: 72,
        qualityScore: null,
      };

      progressListeners.forEach((listener) => listener(progressEvent));

      const payload: CalibrationCompletePayload = {
        baseline: {
          baselinePitch: 2.5,
          baselineEHD: 0.12,
          baselineDPR: 1.02,
          quality: 85,
          sampleCount: 100,
        },
        sensitivity: "medium",
        customThresholds: null,
        thresholds: {
          pitch: 12,
          ehd: 0.18,
          dpr: 0.12,
        },
        validation: {
          quality: 85,
          unreliableFrameRatio: 0.03,
          suggestion: "ok",
        },
        calibrationId: 1,
        recordedAt: Date.now(),
      };

      return payload;
    });

    const on = vi.fn(
      (channel: RendererChannel, listener: (...args: unknown[]) => void) => {
        if (channel === IPC_CHANNELS.calibrationProgress) {
          progressListeners.add(listener);
          return () => {
            progressListeners.delete(listener);
          };
        }
        return () => {};
      },
    );

    const electron = {
      ipcRenderer: {
        sendMessage: () => {},
        on,
        once: () => {},
        invoke,
      },
      channels: IPC_CHANNELS,
      env: {} as ElectronHandler["env"],
    } satisfies ElectronHandler;

    return {
      electron,
      invoke,
      on,
    };
  };

  it("runs calibration flow and reports success", async () => {
    const { electron, invoke } = createElectronMock();
    const onComplete = vi.fn();
    const user = userEvent.setup();

    render(
      <CalibrationFlow
        electron={electron}
        onComplete={onComplete}
        completionDelayMs={0}
      />,
    );

    const calibrateButton = await screen.findByRole("button", {
      name: /calibrate now/i,
    });

    triggerCameraReady();

    await waitFor(() => {
      expect(calibrateButton).toBeEnabled();
    });

    await user.click(calibrateButton);

    await waitFor(() => {
      expect(calibrateButton).toBeDisabled();
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.calibrationStart, {});
    });

    await screen.findByText(/calibration successful!/i);

    expect(onComplete).not.toHaveBeenCalled();
  });
});
