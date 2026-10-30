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
  tabletPortrait: { width: 768, height: 1024 },
  tabletLandscape: { width: 1024, height: 768 },
  tabletWide: { width: 1180, height: 820 },
  // The same three phones on their side. Barely 390px tall, and the tightest layout the app has.
  iphone13Landscape: { width: 844, height: 390 },
  iphone15Landscape: { width: 852, height: 393 },
  iphoneMaxLandscape: { width: 932, height: 430 },
} as const;

/**
 * Where display-reach.spec.ts checks that every result card, menu and Cricket control can really be
 * reached and pressed: three desktop sizes (mouse), three tablets and four phones upright, two on
 * their side (touch, coarse pointer, no hover).
 */
const REACH_VIEWPORTS = [
  ['pc-1920x1080', { width: 1920, height: 1080 }, false],
  ['pc-1366x768', { width: 1366, height: 768 }, false],
  ['pc-1280x720', { width: 1280, height: 720 }, false],
  ['tablet-768x1024', { width: 768, height: 1024 }, true],
  ['tablet-1024x768', { width: 1024, height: 768 }, true],
  ['tablet-1180x820', { width: 1180, height: 820 }, true],
  ['phone-320x568', { width: 320, height: 568 }, true],
  ['phone-390x844', { width: 390, height: 844 }, true],
  ['phone-402x874', { width: 402, height: 874 }, true],
  ['phone-430x932', { width: 430, height: 932 }, true],
  ['phone-844x390', { width: 844, height: 390 }, true],
  ['phone-932x430', { width: 932, height: 430 }, true],
] as const;

/**
 * CI runs the reach-* projects as a job of their own beside the main suite, so neither outgrows
 * its time limit: N02_E2E=main leaves them out, N02_E2E=reach runs only them. Unset - a local
 * `npm run test:e2e` - runs everything.
 */
const suite = process.env.N02_E2E;

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
    // Full suites, run on one desktop and one mobile viewport. landscape.spec.ts is excluded: it
    // asserts the layout that only exists on a short landscape viewport, and has its own projects.
    {
      name: 'desktop-chromium',
      testIgnore: /(landscape|display-reach)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop, ...chromium },
    },
    {
      name: 'mobile-chromium',
      testIgnore: /(landscape|display-reach)\.spec\.ts/,
      use: { ...devices['Pixel 5'], ...chromium },
    },

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
    {
      name: 'layout-touch-768x1024',
      testMatch: /layout\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORTS.tabletPortrait,
        hasTouch: true,
        ...chromium,
      },
    },
    {
      name: 'layout-touch-1024x768',
      testMatch: /layout\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORTS.tabletLandscape,
        hasTouch: true,
        ...chromium,
      },
    },
    {
      name: 'layout-touch-1180x820',
      testMatch: /layout\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORTS.tabletWide,
        hasTouch: true,
        ...chromium,
      },
    },

    /*
     * Smartphone landscape. A separate set of projects rather than more layout-* entries, because
     * these run landscape.spec.ts as well: the rail layout it checks only exists at this height,
     * and the orientation tests rotate the viewport themselves.
     */
    ...(
      [
        ['844x390', VIEWPORTS.iphone13Landscape],
        ['852x393', VIEWPORTS.iphone15Landscape],
        ['932x430', VIEWPORTS.iphoneMaxLandscape],
      ] as const
    ).map(([name, viewport]) => ({
      name: `layout-landscape-${name}`,
      testMatch: /(layout|landscape)\.spec\.ts/,
      use: { ...devices['Pixel 5'], viewport, ...chromium },
    })),

    /*
     * Reachability of every result-card, menu and Cricket control (display-reach.spec.ts). Phones
     * and tablets are Pixel 5 based - touch, coarse pointer, no hover - at the listed size; the
     * desktop sizes are a mouse-and-keyboard Chrome.
     */
    ...REACH_VIEWPORTS.map(([name, viewport, touch]) => ({
      name: `reach-${name}`,
      testMatch: /display-reach\.spec\.ts/,
      use: touch
        ? { ...devices['Pixel 5'], viewport, ...chromium }
        : { ...devices['Desktop Chrome'], viewport, ...chromium },
    })),

    /*
     * Real WebKit on an iPhone device profile - the closest this suite gets to Mobile Safari.
     *
     * Scoped to what actually needs a second rendering engine: layout and viewport geometry, the
     * restored 01/checkout behaviour, and the absence of console errors. The gameplay walkthroughs
     * stay on Chromium (desktop, Pixel 5, and every required iPhone viewport), which is where the
     * game logic is verified. That split is deliberate: driving hundreds of taps through a single
     * page keeps killing WebKit's own browser process on the headless Linux runner ("Target
     * crashed") regardless of what the app does, and the engine-specific risk in those tests is
     * layout, which layout.spec.ts covers here directly.
     */
    ...(webkitAvailable
      ? [
          {
            name: 'iphone-webkit',
            testMatch: /(layout|console|regression-x01)\.spec\.ts/,
            use: { ...devices['iPhone 13'] },
          },
          {
            name: 'iphone-webkit-max',
            testMatch: /layout\.spec\.ts/,
            use: { ...devices['iPhone 14 Pro Max'] },
          },
        ]
      : []),
  ].filter(({ name }) => (name.startsWith('reach-') ? suite !== 'main' : suite !== 'reach')),
  webServer: {
    command: `npm run preview -- --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
