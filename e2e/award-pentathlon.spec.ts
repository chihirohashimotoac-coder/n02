import { expect, test, type Page } from '@playwright/test';
import { confirmFinish, enterPentScore, openFreshApp, openPentathlon, openSingleGame } from './helpers';

/**
 * Awards in Pentathlon's 301/501 - both inside the five-discipline run and in 個別練習.
 *
 * These take a visit total exactly as 通常01・チェックアウト練習 do, so they get the same six awards
 * from the same classifier, read on the SEPARATE BULL side. The classification itself is unit-tested
 * in src/domain/awards.test.ts; what matters here is that the presentation reaches the Pentathlon
 * screens at all, that it survives the checkout that ENDS the discipline, and that the ON/OFF
 * setting is the one shared with every other mode.
 *
 * Only the X01 disciplines are in scope: Cricket, HALF-IT, GOLF and the rest do not take a visit
 * total and present no awards.
 */

const card = (page: Page) => page.locator('.award-card');
const name = (page: Page) => page.locator('.award-name');
const remaining = (page: Page) => page.locator('.n01-left-table strong').first();

/** A solo 個別練習 of one X01 discipline - the shortest route to its score sheet. */
async function startSingleX01(page: Page, label: string) {
  await openFreshApp(page);
  await openSingleGame(page, label);
  await page.locator('select').first().selectOption('1');
  await page.getByRole('button', { name: /を開始/ }).click();
  await expect(page.locator('.pent-x01-shell')).toBeVisible();
}

async function waitForAwardToClear(page: Page) {
  await expect(card(page)).toHaveCount(0, { timeout: 6000 });
}

test.describe('ペンタスロン個別練習 501/301 のアワード', () => {
  const bands: Array<[number, string | null]> = [
    [99, null],
    [100, 'LOW TON'],
    [140, 'LOW TON'],
    [150, 'THREE IN THE BLACK'],
    [151, 'HIGH TON'],
    [180, 'TON 80'],
  ];

  for (const [score, label] of bands) {
    test(`501: ${score}点 → ${label ?? 'アワードなし'}`, async ({ page }) => {
      await startSingleX01(page, 'n01 501');
      await enterPentScore(page, score);
      if (label === null) await expect(card(page)).toHaveCount(0);
      else await expect(name(page)).toHaveText(label);
      // The score is recorded exactly as before, award or not.
      await expect(remaining(page)).toHaveText(String(501 - score));
    });
  }

  test('301 でも同じ分類になる', async ({ page }) => {
    await startSingleX01(page, 'JDA 301');
    await enterPentScore(page, 180);
    await expect(name(page)).toHaveText('TON 80');
    await expect(page.locator('.award-score')).toHaveText('180');
  });

  test('バストでは出ない', async ({ page }) => {
    await startSingleX01(page, 'JDA 301');
    await enterPentScore(page, 180); // 301 -> 121
    await waitForAwardToClear(page);
    await enterPentScore(page, 180); // busts against 121
    await expect(card(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('121');
  });

  test('過去得点の修正では出ない', async ({ page }) => {
    await startSingleX01(page, 'n01 501');
    await enterPentScore(page, 60);
    await waitForAwardToClear(page);

    await page.locator('.n01-score-table td.scored button').first().click();
    await page.locator('.pent-modal-card input[type="number"], .n01-modal-card input[type="number"]').fill('180');
    await page.getByRole('button', { name: '修正して再計算' }).click();
    await expect(remaining(page)).toHaveText('321');
    await expect(card(page)).toHaveCount(0);
  });
});

test.describe('ペンタスロン 501/301 の BIG FISH', () => {
  test('残り170から170で上がると BIG FISH が出て、種目リザルトに切り替わっても消えない', async ({
    page,
  }) => {
    await startSingleX01(page, 'n01 501');
    // 501 -> 170 (i.e. 331 away) in visits none of which is itself an award.
    for (const step of [60, 60, 60, 60, 60, 31]) await enterPentScore(page, step);
    await expect(remaining(page)).toHaveText('170');
    await expect(card(page)).toHaveCount(0);

    await enterPentScore(page, 170);
    await confirmFinish(page);

    // The checkout ends the discipline outright: the play screen is gone, the result screen is up,
    // and the award the player just threw is still on top of it.
    await expect(page.locator('.pent-x01-shell')).toHaveCount(0);
    await expect(name(page)).toHaveText('BIG FISH');
    await expect(page.locator('.award-score')).toHaveText('170');
  });

  test('残り170以外での170点は HIGH TON', async ({ page }) => {
    await startSingleX01(page, 'n01 501');
    await enterPentScore(page, 170); // from 501
    await expect(name(page)).toHaveText('HIGH TON');
  });
});

test.describe('ペンタスロン本編 501 のアワード', () => {
  test('1種目目の501でも出る', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();

    await enterPentScore(page, 180);
    await expect(name(page)).toHaveText('TON 80');
  });
});

test.describe('ペンタスロンのアワード表示 ON/OFF', () => {
  const menu = (page: Page) => page.locator('.n01-menu-table button', { hasText: '☰' });
  const toggle = (page: Page) => page.getByRole('button', { name: /アワード表示/ });

  test('初期値は ON', async ({ page }) => {
    await startSingleX01(page, 'n01 501');
    await menu(page).click();
    await expect(toggle(page)).toContainText('ON');
  });

  test('OFF にすると演出が出ず、得点そのものは変わらない', async ({ page }) => {
    await startSingleX01(page, 'n01 501');
    await menu(page).click();
    await toggle(page).click();

    await enterPentScore(page, 180);
    await expect(card(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('321');
  });

  test('通常01で OFF にした設定をそのまま読む', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await page.waitForSelector('.n01-game-shell');
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await toggle(page).click();
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);

    await page.keyboard.press('n');
    await openSingleGame(page, 'n01 501');
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /を開始/ }).click();

    await menu(page).click();
    await expect(toggle(page)).toContainText('OFF');
    await page.keyboard.press('Escape');
    await enterPentScore(page, 180);
    await expect(card(page)).toHaveCount(0);
  });
});
