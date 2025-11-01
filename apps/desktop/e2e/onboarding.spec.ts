/* eslint-disable import/no-extraneous-dependencies */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
// eslint-disable-next-line import/no-unresolved, import/extensions
import { IPC_CHANNELS } from '../src/shared/ipcChannels';

let electronApp: ElectronApplication;
let onboardingWindow: Page;

test.beforeEach(async () => {
  electronApp = await electron.launch({ args: ['.'] });
  onboardingWindow = await electronApp.firstWindow();
  await onboardingWindow.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await electronApp.close();
});

test('Onboarding - Deny Path', async () => {
  const window = onboardingWindow;

  await electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => ({ granted: false }));
  }, IPC_CHANNELS.REQUEST_CAMERA_PERMISSION);

  await expect(
    window.locator('h1:has-text("Let\'s set up your posture coach")'),
  ).toBeVisible();

  await window.locator('button:has-text("Next")').click();

  await expect(
    window.locator('button:has-text("Open System Settings")'),
  ).toBeVisible();

  await expect(
    window.locator(
      'text=Camera access was denied. You can enable it via system settings to continue.',
    ),
  ).toBeVisible();
});

test('Onboarding - Allow Path', async () => {
  const window = onboardingWindow;

  await electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => ({ granted: true }));
  }, IPC_CHANNELS.REQUEST_CAMERA_PERMISSION);

  await expect(
    window.locator('h1:has-text("Let\'s set up your posture coach")'),
  ).toBeVisible();

  await window.locator('button:has-text("Next")').click();

  await expect(
    window.locator('text=Thank you! Camera access is enabled.'),
  ).toBeVisible();
});
