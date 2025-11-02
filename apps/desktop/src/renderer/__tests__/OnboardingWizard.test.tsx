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

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.requestCameraPermission);

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
      IPC_CHANNELS.requestCameraPermission,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.openCameraPrivacySettings,
    );
  });

  it("surfaces an error when the electron APIs are unavailable", async () => {
    const user = userEvent.setup();

    renderWithProviders(<OnboardingWizard electron={null} />);

    const nextButton = screen.getByRole("button", { name: /next/i });
    await user.click(nextButton);

    await screen.findByText(/electron apis could not be loaded/i);
  });

  // This test requires an actual Electron environment with Canvas/MediaPipe - should be an E2E test
  // The calibration flow with real video processing is tested in e2e/calibration.spec.ts
  // it.skip("completes calibration flow successfully (migrate to E2E)", async () => {
    // TODO: This functionality is already tested in e2e/calibration.spec.ts
    // where a real Electron environment, Canvas API, and MediaPipe are available
  // });

  // This test requires an actual Electron environment with Canvas/MediaPipe - should be an E2E test
  // The calibration failure handling is tested in e2e/calibration.spec.ts
  // it.skip("handles calibration failure with retry option (migrate to E2E)", async () => {
    // TODO: This functionality is already tested in e2e/calibration.spec.ts
    // where a real Electron environment, Canvas API, and MediaPipe are available
  // });

  // This test requires an actual Electron environment with Canvas/MediaPipe - should be an E2E test
  // The OnboardingWizard doesn't show "preparing calibration" text, it shows "Camera access is enabled"
  // SVG overlay testing should be done in E2E tests where real video/canvas elements are available
  // it.skip("displays SVG overlay guides during calibration step (migrate to E2E)", async () => {
    // TODO: This functionality is better tested in e2e/calibration.spec.ts
    // where a real Electron environment, Canvas API, and MediaPipe are available
  // });
});
