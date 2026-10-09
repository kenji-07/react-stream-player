import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.RSP_TEST_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1000, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1000, height: 800 },
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
          args: ['--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
  webServer: [
    {
      command: `node scripts/fixture-server.mjs --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}/tests/e2e/harness/index.html`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Second origin for credential-scoping and cross-origin tests.
      command: `node scripts/fixture-server.mjs --port ${PORT + 1}`,
      url: `http://127.0.0.1:${PORT + 1}/tests/e2e/harness/index.html`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
