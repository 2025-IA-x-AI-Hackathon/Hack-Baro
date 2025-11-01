import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronHandler } from "../../main/preload";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import type { CalibrationBaselinePayload } from "../../shared/types/calibration";
import { OnboardingWizard } from "./OnboardingWizard";

type InvokeFn = ElectronHandler["ipcRenderer"]["invoke"];

const isCalibrationPayload = (
  value: unknown,
): value is CalibrationBaselinePayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "detector" in value && "keypoints" in value;
};

vi.mock("../detection/detectionWorkerBridge", () => {
  const wrapListener = (callback: CallableFunction) => {
    return (payload: unknown) => {
      Reflect.apply(callback, undefined, [payload]);
    };
  };

  class MockDetectionWorkerBridge {
    private resultListeners = new Set<ReturnType<typeof wrapListener>>();

    private errorListeners = new Set<ReturnType<typeof wrapListener>>();

    initialise = vi.fn(async () => {});

    on = vi.fn((event: "result" | "error", callback: CallableFunction) => {
      if (event === "result") {
        const wrapped = wrapListener(callback);
        this.resultListeners.add(wrapped);
        return () => {
          this.resultListeners.delete(wrapped);
        };
      }
      const wrapped = wrapListener(callback);
      this.errorListeners.add(wrapped);
      return () => {
        this.errorListeners.delete(wrapped);
      };
    });

    nextFrameMetadata = vi.fn(() => {
      return {
        id: 1,
        capturedAt: performance.now(),
      };
    });

    processFrame = vi.fn(() => {
      queueMicrotask(() => {
        this.resultListeners.forEach((listener) => {
          listener({
            frameId: 1,
            processedAt: performance.now(),
            durationMs: 16,
            inference: {
              landmarks: [
                [
                  {
                    x: 0.1,
                    y: 0.2,
                    z: 0.0,
                    visibility: 0.95,
                  },
                ],
              ],
            },
          });
        });
      });
    });

    shutdown = vi.fn(() => {
      this.resultListeners.clear();
      this.errorListeners.clear();
    });
  }

  return {
    DetectionWorkerBridge: MockDetectionWorkerBridge,
    default: MockDetectionWorkerBridge,
  };
});

const mockMediaStream = () => {
  const stop = vi.fn();
  const track = { stop };
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
};

const setupMediaMocks = () => {
  Object.defineProperty(global, "createImageBitmap", {
    value: vi.fn().mockResolvedValue({} as ImageBitmap),
    configurable: true,
  });

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

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    }),
    configurable: true,
  });

  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(mockMediaStream()),
    },
    configurable: true,
  });
};

describe("OnboardingWizard", () => {
  beforeEach(() => {
    setupMediaMocks();
  });

  const createElectronMock = () => {
    const invoke = vi.fn<InvokeFn>((channel, payload) => {
      if (!isCalibrationPayload(payload)) {
        throw new Error(`Unexpected payload for channel ${String(channel)}`);
      }
      return Promise.resolve({
        ok: true,
        baseline: {
          id: 1,
          createdAt: Date.now(),
          detector: payload.detector,
          keypoints: payload.keypoints,
        },
      });
    });

    const electron = {
      ipcRenderer: {
        sendMessage: () => {},
        on: () => () => {},
        once: () => {},
        invoke,
      },
      channels: IPC_CHANNELS,
      env: {
        NODE_ENV: undefined,
        APP_ENV: undefined,
        POS_ENV: undefined,
        DESKTOP_ENV: undefined,
        SENTRY_DSN: undefined,
        ENABLE_SENTRY_IN_DEV: undefined,
        SENTRY_TRACES_SAMPLE_RATE: undefined,
        BETTER_STACK_TOKEN: undefined,
        ENABLE_BETTER_STACK_IN_DEV: undefined,
        POSELY_DETECTOR: undefined,
        npm_package_version: undefined,
      },
    } satisfies ElectronHandler;

    return {
      electron,
      invoke,
    };
  };

  it("runs calibration flow and persists baseline", async () => {
    const { electron, invoke } = createElectronMock();
    const onComplete = vi.fn();
    const user = userEvent.setup();

    render(
      <OnboardingWizard
        electron={electron}
        onComplete={onComplete}
        completionDelayMs={0}
        calibrationCompletionDelayMs={0}
      />,
    );

    const calibrateButton = await screen.findByRole("button", {
      name: /calibrate now/i,
    });

    await waitFor(() => {
      expect(calibrateButton).toBeEnabled();
    });

    await user.click(calibrateButton);

    await screen.findByText(/calibration complete/i);

    expect(invoke).toHaveBeenCalled();
    const [firstCall] = invoke.mock.calls;
    if (!firstCall) {
      throw new Error("Invoke was not called with expected arguments");
    }
    const [channel, payload] = firstCall;
    expect(channel).toBe(IPC_CHANNELS.calibrationRequest);
    expect(isCalibrationPayload(payload)).toBe(true);
    if (isCalibrationPayload(payload)) {
      expect(payload).toEqual(
        expect.objectContaining({
          detector: "mediapipe",
        }),
      );
    }

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
