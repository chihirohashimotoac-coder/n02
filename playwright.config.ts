import { existsSync } from 'node:fs';
import { defineConfig, devices, webkit } from '@playwright/test';

const preinstalledChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalledChromium) ? preinstalledChromium : undefined;

/**
 * WebKit has to be downloaded separately and some sandboxes block that download. Its projects are
 * registered only when the browser is actually present, so `npm run test:e2e` still runs everywhere;
 * CI installs it, so the iPhone/WebKit coverage does run there.
 */
const webkitAvailable = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

const PORT = 4174;
const HOST = '127.0.0.1';

/** Viewport sizes the UI is required to work at (see e2e/layout.spec.ts). */
const VIEWPORTS = {
  desktop: { width: 1366, height: 768 },
  desktopTall: { width: 1363, height: 936 },
  iphone13: { width: 390, height: 844 },
  iphone15: { width: 393, height: 852 },
  iphoneMax: { width: 430, height: 932 },
} as const;

const chromium = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'on-first-retry',
    ...chromium,
  },
  projects: [
    // Full suites, run on one desktop and one mobile viewport.
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop, ...chromium },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'], ...chromium } },

    // Layout-only checks across every required viewport size.
    {
      name: 'layout-1363x936',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktopTall, ...chromium },
    },
    {
      name: 'layout-iphone-390',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Pixel 5'], viewport: VIEWPORTS.iphone13, ...chromium },
    },
    {
      name: 'layout-iphone-393',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Pixel 5'], viewport: VIEWPORTS.iphone15, ...chromium },
    },
    {
      name: 'layout-iphone-430',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Pixel 5'], viewport: VIEWPORTS.iphoneMax, ...chromium },
    },

    // Real WebKit, on an iPhone device profile - the closest this suite gets to Mobile Safari.
    // Everything runs here except the @long-session walkthroughs: those drive several hundred taps
    // through one page over ~10 minutes, which kills WebKit's browser process on the headless Linux
    // runner ("Target crashed"), independently of what the app does. They keep running in full on
    // every Chromium project, so the five-discipline walkthroughs stay covered.
    ...(webkitAvailable
      ? [
          {
            name: 'iphone-webkit',
            grepInvert: /@long-session/,
            use: { ...devices['iPhone 13'] },
          },
          {
            name: 'iphone-webkit-max',
            testMatch: /layout\.spec\.ts/,
            use: { ...devices['iPhone 14 Pro Max'] },
          },
        ]
      : []),
  ],
  webServer: {
    command: `npm run preview -- --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
