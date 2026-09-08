import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone config for the computed-style snapshot tool (see style-snapshot.spec.ts). Kept apart
 * from playwright.config.ts so the tool can never join the CI suite: it asserts nothing, it only
 * records what a build renders.
 */
const preinstalledChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalledChromium) ? preinstalledChromium : undefined;
const PORT = 4174;
const HOST = '127.0.0.1';

export default defineConfig({
  testDir: '.',
  reporter: [['list']],
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `npm run preview -- --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
