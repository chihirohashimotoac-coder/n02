import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import {
  commitPentTurn,
  confirmFinish,
  enterGameScore,
  enterPentScore,
  openFreshApp,
  openPentathlon,
  openSingleGame,
  tapBaseballOutcome,
  tapQuickTarget,
} from './helpers';

/**
 * Every screen must be reachable without the app logging an error. Only messages the app itself
 * produces count - the preview server's own noise (favicon/service-worker fetches on a page that
 * was reloaded mid-request) is not something the app controls.
 */
const IGNORED = [
  /favicon/i,
  /service worker/i,
  /workbox/i,
  /Failed to load resource: net::ERR_(ABORTED|FAILED)/i,
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  const record = (text: string) => {
    if (!IGNORED.some((pattern) => pattern.test(text))) errors.push(text);
  };
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') record(message.text());
  });
  page.on('pageerror', (error) => record(String(error)));
  return errors;
}

test.describe('no console errors', () => {
  test('通常01 and チェックアウト練習', async ({ page }) => {
    const errors = collectErrors(page);

    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 180);
    await enterGameScore(page, 26);
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await page.getByRole('button', { name: '直前の入力を戻す' }).click();

    await page.goto('/');
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 0);

    expect(errors).toEqual([]);
  });

  test('Pentathlon setup, play, discipline result and rule modals', async ({ page }) => {
    const errors = collectErrors(page);

    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: '採用ルール・出典' }).click();
    await page.keyboard.press('Escape');
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await page.getByRole('button', { name: 'メニュー' }).click();
    await page.getByRole('button', { name: 'ルール説明' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);
    await page.getByRole('button', { name: /次の種目へ/ }).click();

    expect(errors).toEqual([]);
  });

  test('個別練習 across every input style', async ({ page }) => {
    const errors = collectErrors(page);

    await openFreshApp(page);
    await openSingleGame(page, 'BASEBALL');
    await page.getByRole('button', { name: /を開始/ }).click();
    await tapBaseballOutcome(page, 'トリプル');
    await tapBaseballOutcome(page, 'ミス');
    await tapBaseballOutcome(page, 'ミス');
    await commitPentTurn(page);
    await page.getByRole('button', { name: 'メニュー' }).click();
    await page.getByRole('button', { name: '前の確定ラウンドに戻す' }).click();

    await page.goto('/');
    await openSingleGame(page, 'CRICKET');
    await page.getByRole('button', { name: /を開始/ }).click();
    await page.getByRole('button', { name: 'トリプル20', exact: true }).click();
    await page.getByRole('button', { name: '1投戻す' }).click();

    await page.goto('/');
    await openSingleGame(page, 'CORK');
    await page.getByRole('button', { name: /を開始/ }).click();
    await tapQuickTarget(page, 'インナーブル');
    await tapQuickTarget(page, 'アウターブル');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    expect(errors).toEqual([]);
  });
});
