import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroUIProvider } from '@heroui/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ElectronHandler } from '../../main/preload';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';

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

describe('OnboardingWizard', () => {
  it('requests camera permission and shows success state when granted', async () => {
    const { electron, invoke } = createElectronMock();
    const user = userEvent.setup();

    invoke.mockResolvedValueOnce({
      granted: true,
    });

    renderWithProviders(<OnboardingWizard electron={electron} />);

    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.REQUEST_CAMERA_PERMISSION);

    await screen.findByText(/camera access is enabled/i);
  });

  it('shows denied state and opens system settings on request', async () => {
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

    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);

    await screen.findByText(/enable the camera in your system settings/i);

    const openSettings = screen.getByRole('button', {
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

  it('surfaces an error when the electron APIs are unavailable', async () => {
    const user = userEvent.setup();

    renderWithProviders(<OnboardingWizard electron={null} />);

    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);

    await screen.findByText(/electron apis could not be loaded/i);
  });
});
