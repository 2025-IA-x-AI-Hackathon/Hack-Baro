/* eslint-disable import/no-extraneous-dependencies */
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import path from "path";
// eslint-disable-next-line import/no-unresolved, import/extensions
import { IPC_CHANNELS } from "../src/shared/ipcChannels";
import type { CalibrationCompletePayload } from "../src/shared/types/calibration";

type E2ETestGlobal = typeof globalThis & {
  e2eLatestBaseline?: CalibrationCompletePayload;
};

declare global {
  // Playwright e2e tests store the latest baseline on the Electron global.
  // Declaring it here keeps TypeScript aware of the test-only hook.
  let e2eLatestBaseline: CalibrationCompletePayload | undefined;
}

let electronApp: ElectronApplication;
let calibrationWindow: Page;

test.beforeEach(async () => {
  const electronPath = path.join(
    __dirname,
    "../release/app/dist/mac/Posely.app/Contents/MacOS/Posely",
  );

  // For development, use the main process entry point
  electronApp = await electron.launch({
    args: [path.join(__dirname, "../src/main/main.ts")],
    executablePath: process.env.CI ? electronPath : undefined,
  });

  calibrationWindow = await electronApp.firstWindow();
  await calibrationWindow.waitForLoadState("domcontentloaded");
});

test.afterEach(async () => {
  if (electronApp) {
    await electronApp.close();
  }
});

test.describe("Calibration Flow", () => {
  test("should complete full calibration flow successfully", async () => {
    const window = calibrationWindow;

    // Mock camera permission to be granted
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ granted: true }));
    }, IPC_CHANNELS.requestCameraPermission);

    // Mock calibration request to succeed
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({
        ok: true,
        baseline: {
          id: 1,
          detector: "mediapipe",
          keypoints: [
            { x: 0.5, y: 0.3, z: 0, visibility: 0.95, name: "nose" },
            { x: 0.45, y: 0.35, z: 0, visibility: 0.9, name: "left_shoulder" },
            { x: 0.55, y: 0.35, z: 0, visibility: 0.9, name: "right_shoulder" },
          ],
          createdAt: Date.now(),
        },
      }));
    }, IPC_CHANNELS.calibrationRequest);

    // Step 1: Welcome screen - verify initial state
    await expect(
      window.locator('h1:has-text("Let\'s set up your posture coach")'),
    ).toBeVisible();
    await expect(window.locator('div:has-text("Step 1 of 3")')).toBeVisible();

    // Step 1: Click Next to request camera permission
    await window.locator('button:has-text("Next")').click();

    // Step 1: Wait for permission granted state
    await expect(
      window.locator("text=Thank you! Camera access is enabled"),
    ).toBeVisible();

    // Step 2: Wait for transition to calibration step
    await expect(
      window.locator('h1:has-text("Calibrate your posture baseline")'),
    ).toBeVisible({ timeout: 3000 });
    await expect(window.locator('div:has-text("Step 2 of 3")')).toBeVisible();

    // Step 2: Verify calibration UI elements are present
    await expect(
      window.locator('p:has-text("Position your head and shoulders")'),
    ).toBeVisible();

    // Mock video element to simulate camera feed
    await window.evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        // Set mock dimensions
        Object.defineProperty(video, "videoWidth", {
          value: 640,
          writable: false,
        });
        Object.defineProperty(video, "videoHeight", {
          value: 480,
          writable: false,
        });
      }
    });

    // Step 2: Verify "Calibrate Now" button is visible
    const calibrateButton = window.locator('button:has-text("Calibrate Now")');
    await expect(calibrateButton).toBeVisible();

    // Step 2: Click "Calibrate Now" button
    await calibrateButton.click();

    // Step 2: Verify calibrating state
    await expect(
      window.locator('p:has-text("Analyzing your posture")'),
    ).toBeVisible({ timeout: 1000 });

    // Step 2: Wait for success animation
    await expect(window.locator('p:has-text("Success!")')).toBeVisible({
      timeout: 3000,
    });
    await expect(
      window.locator("text=Your baseline posture has been saved"),
    ).toBeVisible();

    // Step 3: Wait for transition to complete step
    await expect(window.locator('h1:has-text("Setup complete!")')).toBeVisible({
      timeout: 3000,
    });
    await expect(window.locator('div:has-text("Step 3 of 3")')).toBeVisible();

    // Step 3: Verify completion message
    await expect(
      window.locator('h2:has-text("You\'re all set!")'),
    ).toBeVisible();
    await expect(
      window.locator("text=Your posture baseline has been configured"),
    ).toBeVisible();

    // Step 3: Verify "Get Started" button is present
    await expect(
      window.locator('button:has-text("Get Started")'),
    ).toBeVisible();
  });

  test("should handle calibration failure and allow retry", async () => {
    const window = calibrationWindow;

    // Mock camera permission to be granted
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ granted: true }));
    }, IPC_CHANNELS.requestCameraPermission);

    // Mock calibration request to fail
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({
        ok: false,
        error: "Failed to save calibration data",
      }));
    }, IPC_CHANNELS.calibrationRequest);

    // Navigate to calibration step
    await window.locator('button:has-text("Next")').click();
    await expect(
      window.locator('h1:has-text("Calibrate your posture baseline")'),
    ).toBeVisible({ timeout: 3000 });

    // Mock video dimensions
    await window.evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        Object.defineProperty(video, "videoWidth", {
          value: 640,
          writable: false,
        });
        Object.defineProperty(video, "videoHeight", {
          value: 480,
          writable: false,
        });
      }
    });

    // Click calibrate button
    await window.locator('button:has-text("Calibrate Now")').click();

    // Verify error state
    await expect(window.locator("text=Failed to save calibration")).toBeVisible(
      { timeout: 2000 },
    );

    // Verify "Try Again" button appears
    await expect(window.locator('button:has-text("Try Again")')).toBeVisible();

    // Verify error message in footer
    await expect(
      window.locator('p.text-red-200:has-text("Failed to save calibration")'),
    ).toBeVisible();
  });

  test("should display SVG overlay guides during calibration", async () => {
    const window = calibrationWindow;

    // Mock camera permission
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ granted: true }));
    }, IPC_CHANNELS.requestCameraPermission);

    // Navigate to calibration step
    await window.locator('button:has-text("Next")').click();
    await expect(
      window.locator('h1:has-text("Calibrate your posture baseline")'),
    ).toBeVisible({ timeout: 3000 });

    // Verify video element exists
    await expect(window.locator("video")).toBeVisible();

    // Verify SVG overlay exists
    const svg = window.locator("svg");
    await expect(svg).toBeVisible();

    // Verify SVG contains guide elements (circle for head, lines for shoulders)
    const circle = svg.locator("circle");
    await expect(circle).toBeVisible();

    const lines = svg.locator("line");
    await expect(lines.first()).toBeVisible();
  });

  test("should handle camera initialization failure gracefully", async () => {
    const window = calibrationWindow;

    // Mock camera permission to be granted
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ granted: true }));
    }, IPC_CHANNELS.requestCameraPermission);

    // Mock getUserMedia to fail
    await window.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new Error("Camera not available"));
    });

    // Navigate to calibration step
    await window.locator('button:has-text("Next")').click();

    // Wait for calibration step
    await window.waitForTimeout(1500);

    // Verify error message appears
    await expect(window.locator("text=Failed to access camera")).toBeVisible({
      timeout: 2000,
    });
  });

  test("should verify canvas element for frame capture", async () => {
    const window = calibrationWindow;

    // Mock camera permission
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ granted: true }));
    }, IPC_CHANNELS.requestCameraPermission);

    // Navigate to calibration step
    await window.locator('button:has-text("Next")').click();
    await expect(
      window.locator('h1:has-text("Calibrate your posture baseline")'),
    ).toBeVisible({ timeout: 3000 });

    // Verify hidden canvas element exists for frame capture
    const canvas = window.locator("canvas");
    await expect(canvas).toHaveCount(1);

    // Verify canvas has "hidden" class
    await expect(canvas).toHaveClass(/hidden/);
  });
});
