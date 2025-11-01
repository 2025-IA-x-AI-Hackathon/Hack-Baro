const path = require('node:path');
const { _electron: electron, expect, test } = require('@playwright/test');

const projectRoot = path.resolve(__dirname, '..');

test.describe('Electron app smoke test', () => {
  test('launches harness window and handles IPC round trips', async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, 'fixtures/test-main.js')],
      cwd: projectRoot,
      env: {
        NODE_ENV: 'test',
      },
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForSelector('[data-testid="app-ready"]');

      const hasBridge = await window.evaluate(() => !!window.electron);
      expect(hasBridge).toBe(true);

      const scriptReady = await window.evaluate(
        () => window.__E2E_SCRIPT_READY ?? false,
      );
      expect(scriptReady).toBe(true);

      await expect(window).toHaveTitle('Posely E2E Harness');
      await expect(
        window.locator('[data-testid="app-description"]'),
      ).toContainText('IPC communication');

      const pingMainButton = window.locator('[data-testid="ping-main"]');
      await expect(pingMainButton).toBeVisible();
      await pingMainButton.click();
      await window.waitForTimeout(200);

      const lastPing = await electronApp.evaluate(
        () => globalThis.__e2eLastPing ?? null,
      );
      expect(lastPing).toBe('ping');

      await expect(window.locator('[data-testid="main-response"]')).toHaveText(
        'pong:ping',
      );

      const pingWorkerButton = window.locator('[data-testid="ping-worker"]');
      await expect(pingWorkerButton).toBeVisible();
      await pingWorkerButton.click();
      await window.waitForTimeout(200);

      const workerRequests = await electronApp.evaluate(
        () => globalThis.__e2eWorkerRequests ?? 0,
      );
      expect(workerRequests).toBeGreaterThan(0);

      await expect(window.locator('[data-testid="worker-status"]')).toHaveText(
        /online/i,
      );
      await expect(
        window.locator('[data-testid="worker-response"]'),
      ).toHaveText('worker:ready');
    } finally {
      await electronApp.close();
    }
  });
});
