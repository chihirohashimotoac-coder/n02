import { expect, test } from '@playwright/test';
import { confirmFinish, enterGameScore, openFreshApp } from './helpers';

/**
 * Regression coverage for the two pre-existing modes. These must keep passing unchanged as
 * Pentathlon evolves.
 */

test.describe('通常01', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
  });

  test('main menu offers all three modes with Pentathlon as an equal third card', async ({ page }) => {
    const cards = page.locator('.mode-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('通常01');
    await expect(cards.nth(1)).toContainText('チェックアウト練習');
    await expect(cards.nth(2)).toContainText('ペンタスロン');
  });

  test('scores, busts, checks out and awards the leg', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();

    await enterGameScore(page, 180); // P1 -> 321
    await enterGameScore(page, 26); // P2 -> 475
    await enterGameScore(page, 180); // P1 -> 141
    await enterGameScore(page, 26); // P2 -> 449
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');

    // Bust: 150 > 141 leaves the score untouched.
    await enterGameScore(page, 150);
    await expect(page.locator('.n01-notice')).toContainText('バスト');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');

    await enterGameScore(page, 26); // P2
    await enterGameScore(page, 141); // P1 declares a finish
    await confirmFinish(page);

    await expect(page.locator('.result-card')).toContainText('LEG 1 WINNER');
    await expect(page.locator('.result-card h2')).toHaveText('プレイヤー1');
  });

  test('has no always-on entry preview and keeps its four-button menu', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-entry-display')).toHaveCount(0);
    await expect(page.locator('.pent-entry-display')).toHaveCount(0);
    await expect(page.locator('.n01-menu-table > button')).toHaveCount(4);
    await expect(page.locator('.n01-menu-table button', { hasText: 'RULES' })).toHaveCount(0);

    // Typing still works without any preview row - Enter is what commits it.
    await page.keyboard.type('45');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('456');
  });

  test('undo reverts the last visit', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await page.getByRole('button', { name: '直前の入力を戻す' }).click();
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('501');
  });

  test('persists the match to localStorage and resumes it', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100);

    const stored = await page.evaluate(() => localStorage.getItem('n02-current-v1'));
    expect(stored).toBeTruthy();
    // The legacy storage contract must not change shape.
    const parsed = JSON.parse(stored!);
    expect(Object.keys(parsed)).toEqual(
      expect.arrayContaining(['players', 'active', 'leg', 'settings', 'visits', 'undo', 'matchWinner']),
    );

    await page.reload();
    await page.getByRole('button', { name: /保存した対戦を再開/ }).click();
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
  });

  test('past scores can be edited and later rounds recalculate', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100); // P1 -> 401
    await enterGameScore(page, 50); // P2 -> 451

    await page.locator('.n01-score-table td.scored button').first().click();
    await page.locator('.n01-modal-card input[type="number"]').fill('140');
    await page.getByRole('button', { name: '修正して再計算' }).click();

    await expect(page.locator('.n01-left-table strong').first()).toHaveText('361');
  });
});

test.describe('チェックアウト練習', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
  });

  test('starts with a randomised checkout target and shares the 01 engine', async ({ page }) => {
    await expect(page.locator('.n01-game-meta')).toContainText('CHECKOUT');
    const target = await page.locator('.n01-left-table strong').first().innerText();
    const value = Number(target);
    expect(value).toBeGreaterThanOrEqual(41);
    expect(value).toBeLessThanOrEqual(170);
  });

  test('has no always-on entry preview', async ({ page }) => {
    await expect(page.locator('.n01-entry-display')).toHaveCount(0);
    await expect(page.locator('.pent-entry-display')).toHaveCount(0);
    await expect(page.locator('.n01-menu-table > button')).toHaveCount(4);
  });

  test('gives both players the identical challenge score, before and after a hand-off', async ({ page }) => {
    const remaining = page.locator('.n01-left-table strong');
    const target = await remaining.nth(0).innerText();
    await expect(remaining.nth(1)).toHaveText(target);

    // Hand the turn over: the challenge belongs to the leg, not to whoever is throwing.
    await enterGameScore(page, 0);
    await expect(remaining.nth(0)).toHaveText(target);
    await expect(remaining.nth(1)).toHaveText(target);
  });

  test('keeps both challenge scores in step across save and resume', async ({ page }) => {
    const remaining = page.locator('.n01-left-table strong');
    const target = await remaining.nth(0).innerText();
    await enterGameScore(page, 0);

    await page.reload();
    await page.getByRole('button', { name: /保存した対戦を再開/ }).click();
    await expect(remaining.nth(0)).toHaveText(target);
    await expect(remaining.nth(1)).toHaveText(target);
  });

  test('draws one new shared challenge score for the next leg', async ({ page }) => {
    const remaining = page.locator('.n01-left-table strong');
    const firstTarget = await remaining.nth(0).innerText();

    await enterGameScore(page, 0); // player 1 scores nothing
    await enterGameScore(page, Number(firstTarget)); // player 2 checks out the challenge
    await confirmFinish(page);
    await page.getByRole('button', { name: /次のLegへ/ }).click();

    const nextTarget = await remaining.nth(0).innerText();
    await expect(remaining.nth(1)).toHaveText(nextTarget);
    expect(Number(nextTarget)).not.toBeNaN();
  });
});

test.describe('themes', () => {
  test('applies the neon theme and persists it', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.theme-panel select').selectOption('neon');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');
  });
});
