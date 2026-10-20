// ローカル確認用サーバー（tools/preview-server.mjs、Google 非接続）に対する画面テスト。
// @playwright/test はリポジトリ直下の devDependencies を使う（直下で npm ci が必要）。
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const preinstalled = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(preinstalled) ? { executablePath: preinstalled } : {};
const PORT = 4180;

export default defineConfig({
  testDir: './e2e',
  // 1 台の模擬サーバーの状態を共有するため直列に実行する
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `node tools/preview-server.mjs`,
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
  },
});
