import { expect, test, type Page } from '@playwright/test';
import { enterGameScore, openFreshApp } from './helpers';

/**
 * アレンジルート（設定「アレンジルート」ON）で残りの下に出るルートが、01 Arrangement Support の
 * 基準ルートそのものであること。全 162 件の一致は src/domain/darts.test.ts が見ている。ここでは
 * 通常01・チェックアウト練習の画面が、その表を実際に表示していることを確かめる。
 */

const p1Remaining = (page: Page) => page.locator('.n01-left-table strong').first();
const p1Route = (page: Page) => page.locator('.n01-left-table > div').first().locator('.checkout-route');

async function turnRouteOn(page: Page) {
  await page.locator('.toggle-field', { hasText: 'アレンジルート' }).locator('input[type="checkbox"]').check();
}

test('チェックアウト練習: 出題 125 で基準ルート SB - T20 - D20 を出し、60 に減ると S20 - D20 に変わる', async ({
  page,
}) => {
  await openFreshApp(page);
  await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
  await page.getByLabel('出題下限').fill('125');
  await page.getByLabel('出題上限').fill('125');
  await turnRouteOn(page);
  await page.getByRole('button', { name: /ゲームを開始/ }).click();

  await expect(p1Remaining(page)).toHaveText('125');
  await expect(page.locator('.checkout-route')).toHaveText(['SB - T20 - D20', 'SB - T20 - D20']);

  // Whoever opens, P1's own remaining drops to 60 once P1 scores 65.
  const p1Active = await page.locator('.n01-left-table > div').first().evaluate((el) => el.classList.contains('active'));
  if (!p1Active) await enterGameScore(page, 0);
  await enterGameScore(page, 65);
  await expect(p1Remaining(page)).toHaveText('60');
  await expect(p1Route(page)).toHaveText('S20 - D20');
});

test('通常01: 残り 171 以上ではルートを出さず、121 で基準ルート T20 - S11 - BULL を出す', async ({ page }) => {
  await openFreshApp(page);
  await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
  await turnRouteOn(page);
  await page.getByRole('button', { name: /ゲームを開始/ }).click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();

  const p1Active = await page.locator('.n01-left-table > div').first().evaluate((el) => el.classList.contains('active'));
  if (!p1Active) await enterGameScore(page, 0);

  await enterGameScore(page, 180); // P1 -> 321
  await enterGameScore(page, 0); // P2
  await expect(p1Remaining(page)).toHaveText('321');
  await expect(p1Route(page)).toHaveCount(0);

  await enterGameScore(page, 180); // P1 -> 141
  await enterGameScore(page, 0); // P2
  await expect(p1Route(page)).toHaveText('T20 - T19 - D12');

  await enterGameScore(page, 20); // P1 -> 121
  await expect(p1Remaining(page)).toHaveText('121');
  await expect(p1Route(page)).toHaveText('T20 - S11 - BULL');
});
