import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { IPC_CHANNELS } from "../../shared/ipcChannels";

const handlers = new Map<string, Mock>();

vi.mock("electron", () => {
  return {
    ipcMain: {
      handle: vi.fn((channel: string, listener: Mock) => {
        handlers.set(channel, listener);
      }),
    },
  };
});

const saveCalibrationBaseline = vi.fn();

vi.mock("../database/calibrationRepository", () => {
  return {
    saveCalibrationBaseline,
  };
});

const loadHandler = async () => {
  type RegisterCalibrationHandler =
    typeof import("./calibrationHandler").default;
  const module = (await import("./calibrationHandler.js")) as unknown as {
    default: RegisterCalibrationHandler;
  };
  const registerCalibrationHandler = module.default;
  registerCalibrationHandler();
  const handler = handlers.get(IPC_CHANNELS.calibrationRequest);
  if (!handler) {
    throw new Error("Calibration handler was not registered");
  }
  return handler;
};

describe("registerCalibrationHandler", () => {
  beforeEach(() => {
    handlers.clear();
    saveCalibrationBaseline.mockReset();
    vi.clearAllMocks();
  });

  it("returns success payload when repository insert succeeds", async () => {
    const baseline = {
      id: 1,
      createdAt: 123,
      detector: "mediapipe" as const,
      keypoints: [{ x: 1, y: 2 }],
    };
    saveCalibrationBaseline.mockReturnValue(baseline);

    const handler = await loadHandler();
    const response = await handler(null, {
      detector: "mediapipe",
      keypoints: [{ x: 1, y: 2 }],
    });

    expect(response).toEqual({
      ok: true,
      baseline,
    });
    expect(saveCalibrationBaseline).toHaveBeenCalledWith({
      detector: "mediapipe",
      keypoints: [{ x: 1, y: 2 }],
    });
  });

  it("returns an error payload when repository insert throws", async () => {
    saveCalibrationBaseline.mockImplementation(() => {
      throw new Error("database down");
    });

    const handler = await loadHandler();
    const response = await handler(null, {
      detector: "mediapipe",
      keypoints: [],
    });

    expect(response).toEqual({
      ok: false,
      error: "database down",
    });
  });
});
