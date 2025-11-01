const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI
    ? [
        ['github'],
        [
          'html',
          { outputFolder: path.join(__dirname, 'report'), open: 'never' },
        ],
      ]
    : [
        ['list'],
        [
          'html',
          { outputFolder: path.join(__dirname, 'report'), open: 'never' },
        ],
      ],
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  webServer: {
    command: 'pnpm --filter @baro/desktop run start:renderer',
    url: 'http://localhost:1212',
    timeout: 180 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    ...devices['Desktop Chrome'],
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.{js,ts}',
    },
  ],
  outputDir: path.join(__dirname, 'test-results'),
});
