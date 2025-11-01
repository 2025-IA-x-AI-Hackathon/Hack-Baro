import { HeroUIProvider } from "@heroui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ElectronHandler } from "../../main/preload";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import { OnboardingWizard } from "../components/onboarding/OnboardingWizard";

const renderWithProviders = (ui: ReactElement) => {
  return render(<HeroUIProvider>{ui}</HeroUIProvider>);
};

const createElectronMock = () => {
  const invoke = vi.fn();

  const electron = {
    ipcRenderer: {
      invoke,
    },
    channels: IPC_CHANNELS,
  } as unknown as ElectronHandler;

  return { electron, invoke };
};

describe("OnboardingWizard", () => {
  it("requests camera permission and shows success state when granted", async () => {
    const { electron, invoke } = createElectronMock();
    const user = userEvent.setup();

    invoke.mockResolvedValueOnce({
      granted: true,
    });

    renderWithProviders(<OnboardingWizard electron={electron} />);

    const nextButton = screen.getByRole("button", { name: /next/i });
    await user.click(nextButton);

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.REQUEST_CAMERA_PERMISSION);

    await screen.findByText(/camera access is enabled/i);
  });

  it("shows denied state and opens system settings on request", async () => {
    const { electron, invoke } = createElectronMock();
    const user = userEvent.setup();

    invoke
      .mockResolvedValueOnce({
        granted: false,
      })
      .mockResolvedValueOnce({
        success: true,
      });

    renderWithProviders(<OnboardingWizard electron={electron} />);

    const nextButton = screen.getByRole("button", { name: /next/i });
    await user.click(nextButton);

    await screen.findByText(/enable the camera in your system settings/i);

    const openSettings = screen.getByRole("button", {
      name: /open system settings/i,
    });
    await user.click(openSettings);

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.REQUEST_CAMERA_PERMISSION,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.OPEN_CAMERA_SETTINGS,
    );
  });

  it("surfaces an error when the electron APIs are unavailable", async () => {
    const user = userEvent.setup();

    renderWithProviders(<OnboardingWizard electron={null} />);

    const nextButton = screen.getByRole("button", { name: /next/i });
    await user.click(nextButton);

    await screen.findByText(/electron apis could not be loaded/i);
  });

  // TODO: Requires actual Electron environment for Canvas API - migrate to E2E tests
  it.skip("completes calibration flow successfully", async () => {
    const { electron, invoke } = createElectronMock();
    const user = userEvent.setup();

    // Mock camera permission
    invoke.mockResolvedValueOnce({ granted: true });

    // Mock successful calibration
    invoke.mockResolvedValueOnce({
      ok: true,
      baseline: {
        id: 1,
        detector: "mediapipe",
        keypoints: [{ x: 0.5, y: 0.3, z: 0, visibility: 0.95, name: "nose" }],
        createdAt: Date.now(),
      },
    });

    // Mock getUserMedia
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
    } as unknown as MediaStream;

    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    });

    renderWithProviders(<OnboardingWizard electron={electron} />);

    // Step 1: Click Next for camera permission
    const nextButton = screen.getByRole("button", { name: /next/i });
    await user.click(nextButton);

    // Wait for permission granted and transition to calibration
    await screen.findByText(/preparing calibration/i, {}, { timeout: 2000 });

    // Step 2: Wait for calibration step to load
    await screen.findByText(
      /position your head and shoulders/i,
      {},
      { timeout: 2000 },
    );

    // Verify "Calibrate Now" button appears
    const calibrateButton = await screen.findByRole(
      "button",
      { name: /calibrate now/i },
      { timeout: 2000 },
    );
    expect(calibrateButton).toBeInTheDocument();

    // Mock video element dimensions
    const videoElement = document.querySelector("video");
    if (videoElement) {
      Object.defineProperty(videoElement, "videoWidth", {
        value: 640,
        configurable: true,
      });
      Object.defineProperty(videoElement, "videoHeight", {
        value: 480,
        configurable: true,
      });
    }

    // Click "Calibrate Now"
    await user.click(calibrateButton);

    // Verify calibration was called
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.calibrationRequest,
      expect.objectContaining({
        detector: "mediapipe",
        keypoints: expect.arrayContaining([
          expect.objectContaining({ name: "nose" }),
        ]),
      }),
    );

    // Verify success state
    await screen.findByText(/success!/i, {}, { timeout: 2000 });
    await screen.findByText(/baseline posture has been saved/i);

    // Wait for transition to complete step
    await screen.findByText(/you're all set!/i, {}, { timeout: 3000 });
    await screen.findByRole("button", { name: /get started/i });
  });

  // TODO: Requires actual Electron environment for Canvas API - migrate to E2E tests
  it.skip("handles calibration failure with retry option", async () => {
    const { electron, invoke } = createElectronMock();
    const user = userEvent.setup();

    // Mock camera permission
    invoke.mockResolvedValueOnce({ granted: true });

    // Mock failed calibration
    invoke.mockResolvedValueOnce({
      ok: false,
      error: "Failed to save calibration data",
    });

    // Mock getUserMedia
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
    } as unknown as MediaStream;

    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    });

    renderWithProviders(<OnboardingWizard electron={electron} />);

    // Navigate to calibration step
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/preparing calibration/i, {}, { timeout: 2000 });
    await screen.findByText(
      /position your head and shoulders/i,
      {},
      { timeout: 2000 },
    );

    // Mock video dimensions
    const videoElement = document.querySelector("video");
    if (videoElement) {
      Object.defineProperty(videoElement, "videoWidth", {
        value: 640,
        configurable: true,
      });
      Object.defineProperty(videoElement, "videoHeight", {
        value: 480,
        configurable: true,
      });
    }

    // Click calibrate
    const calibrateButton = await screen.findByRole(
      "button",
      { name: /calibrate now/i },
      { timeout: 2000 },
    );
    await user.click(calibrateButton);

    // Verify error message appears
    await screen.findByText(
      /failed to save calibration/i,
      {},
      { timeout: 2000 },
    );

    // Verify "Try Again" button appears
    const tryAgainButton = await screen.findByRole("button", {
      name: /try again/i,
    });
    expect(tryAgainButton).toBeInTheDocument();
  });

  it("displays SVG overlay guides during calibration step", async () => {
    const { electron, invoke } = createElectronMock();
    const user = userEvent.setup();

    // Mock camera permission
    invoke.mockResolvedValueOnce({ granted: true });

    // Mock getUserMedia
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
    } as unknown as MediaStream;

    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    });

    renderWithProviders(<OnboardingWizard electron={electron} />);

    // Navigate to calibration step
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/preparing calibration/i, {}, { timeout: 2000 });
    await screen.findByText(
      /position your head and shoulders/i,
      {},
      { timeout: 2000 },
    );

    // Verify SVG overlay exists
    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();

    // Verify SVG contains guide elements
    const circle = svg?.querySelector("circle");
    expect(circle).toBeInTheDocument();

    const lines = svg?.querySelectorAll("line");
    expect(lines).toHaveLength(2); // Shoulder line and center guide
  });
});
