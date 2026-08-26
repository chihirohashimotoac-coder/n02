import { expect, test } from '@playwright/test';
import {
  confirmFinish,
  enterGameScore,
  enterPentHits,
  enterPentScore,
  openFreshApp,
  openPentathlon,
} from './helpers';

/** Plays the starter to a 9-dart 501 finish, then the opponent to a slower finish. */
async function play501TwoPlayers(page: import('@playwright/test').Page) {
  await enterPentScore(page, 180); // starter -> 321
  await enterPentScore(page, 26); // opponent -> 475
  await enterPentScore(page, 180); // starter -> 141
  await enterPentScore(page, 26); // opponent -> 449
  await enterPentScore(page, 141); // starter declares finish
  await confirmFinish(page);
  await enterPentScore(page, 180); // opponent -> 269
  await enterPentScore(page, 180); // opponent -> 89
  await enterPentScore(page, 89);
  await confirmFinish(page);
}

test.describe('Pentathlon setup', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
  });

  test('offers both rule sets with their discipline order', async ({ page }) => {
    const cards = page.locator('.pent-preset-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('JDA');
    await expect(cards.nth(0)).toContainText('501');
    await expect(cards.nth(0)).toContainText('HALF-IT');
    await expect(cards.nth(1)).toContainText('i-Pentathlon');
    await expect(cards.nth(1)).toContainText('CORK');
    await expect(cards.nth(1)).toContainText('CRICKET');
  });

  test('exposes 1-player and 2-player modes plus both starter modes', async ({ page }) => {
    const playerCount = page.locator('select').first();
    await expect(playerCount.locator('option')).toHaveText([/1人/, /2人/]);

    await expect(page.getByText('第1種目の先攻')).toBeVisible();
    const starterMode = page.locator('select').nth(2);
    await expect(starterMode.locator('option')).toHaveText(['敗者先攻', '交互先攻']);
  });

  test('hides starter options in 1-player mode', async ({ page }) => {
    await page.locator('select').first().selectOption('1');
    await expect(page.getByText('第1種目の先攻')).toHaveCount(0);
  });
});

test.describe('Pentathlon 2-player progression', () => {
  test('a finished player waits while the opponent completes their own result', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    // P1 is locked at 9 darts; the discipline is NOT over and P2 keeps throwing.
    await expect(page.locator('.pent-player').first()).toContainText('FINISHED');
    await expect(page.locator('.pent-player').first()).toContainText('9 DARTS');
    await expect(page.locator('.pent-player').nth(1)).toContainText('THROW');
    await expect(page.locator('.pent-target')).toContainText('プレイヤー2');
  });

  test('loser starts the next discipline', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await play501TwoPlayers(page);

    await expect(page.getByText('DISCIPLINE COMPLETE')).toBeVisible();
    await expect(page.locator('.pent-result-table')).toContainText('9 DARTS');
    // P1 won on darts, so P2 (the loser) starts Half-It.
    await expect(page.locator('.pent-next-starter').last()).toContainText('プレイヤー2 START');
    await expect(page.locator('.pent-next-starter').last()).toContainText('敗者先攻');

    await page.getByRole('button', { name: /次の種目へ/ }).click();
    await expect(page.locator('.pent-target')).toContainText('プレイヤー2');
  });

  test('alternate mode swaps the starter regardless of who won', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').nth(2).selectOption('alternate');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await play501TwoPlayers(page);

    await expect(page.locator('.pent-next-starter').last()).toContainText('交互先攻');
    await expect(page.locator('.pent-next-starter').last()).toContainText('プレイヤー2 START');
  });
});

test.describe('Pentathlon persistence and undo', () => {
  test('resumes an interrupted session from the same discipline', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await enterPentScore(page, 180);

    const before = await page.evaluate(() => localStorage.getItem('n02-pentathlon-v1'));
    expect(before).toBeTruthy();

    await page.reload();
    await page.locator('.mode-card', { hasText: 'ペンタスロン' }).click();
    await page.getByRole('button', { name: /中断したペンタスロンを再開/ }).click();

    await expect(page.locator('.pent-progress')).toContainText('501');
    const after = await page.evaluate(() => localStorage.getItem('n02-pentathlon-v1'));
    expect(after).toBe(before);
  });

  test('does not disturb the existing 01 save data', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100);
    const x01Save = await page.evaluate(() => localStorage.getItem('n02-current-v1'));

    await page.goto('/');
    await page.locator('.mode-card', { hasText: 'ペンタスロン' }).click();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await enterPentScore(page, 100);

    const x01After = await page.evaluate(() => localStorage.getItem('n02-current-v1'));
    expect(x01After).toBe(x01Save);
  });

  test('undo reverts a staged dart in a dart-hit discipline', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').first().selectOption('1');
    await page.locator('.pent-preset-card', { hasText: 'i-Pentathlon' }).click();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    // Cork: stage a dart, then undo it.
    await page.locator('.pent-ring-row button', { hasText: /^BULL$/ }).click();
    await expect(page.locator('.pent-pending-chip').first()).toHaveText('BULL');
    await page.getByRole('button', { name: '1投戻す' }).click();
    await expect(page.locator('.pent-pending-chip').first()).toContainText('1投目');
  });
});

test.describe('Pentathlon full session', () => {
  test('plays all five n01 disciplines and shows the final result', async ({ page }) => {
    test.slow();
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('.pent-preset-card', { hasText: 'i-Pentathlon' }).click();
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    const next = () => page.getByRole('button', { name: /次の種目へ|総合リザルトへ/ }).click();

    // 1. Cork
    await enterPentHits(page, ['BULL']);
    await next();

    // 2. 301 (double-in / double-out)
    await enterPentScore(page, 180);
    await enterPentScore(page, 61);
    await enterPentScore(page, 60);
    await confirmFinish(page);
    await next();

    // 3. Baseball: 9 innings, T+S on the inning number = 4 runs each -> 36 runs
    for (let inning = 1; inning <= 9; inning++) {
      await enterPentHits(page, [`T${inning}`, `S${inning}`, 'MISS']);
    }
    await expect(page.locator('.pent-result-table')).toContainText('36 RUNS');
    await next();

    // 4. 501 in 9 darts
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);
    await expect(page.locator('.pent-result-table')).toContainText('9 DARTS');
    await next();

    // 5. Cricket: close all seven targets
    await enterPentHits(page, ['T20', 'T19', 'T18']);
    await enterPentHits(page, ['T17', 'T16', 'T15']);
    await enterPentHits(page, ['BULL', '25']);
    await next();

    await expect(page.locator('.pent-share-card')).toContainText('PENTATHLON');
    await expect(page.locator('.pent-share-card')).toContainText('n01 / i-Pentathlon');
    await expect(page.locator('.pent-share-card')).toContainText('36 RUNS');
    await expect(page.getByRole('button', { name: 'リザルトカードを共有' })).toBeVisible();
  });
});
