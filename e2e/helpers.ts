import type { Page } from '@playwright/test';

/**
 * Enters a visit score on the 01/Checkout game screen. The on-screen keypad only exists on narrow
 * viewports (desktop users type instead), so this drives whichever input the viewport actually
 * offers - exercising both paths across the desktop and mobile projects.
 */
export async function enterGameScore(page: Page, score: number | string) {
  const keypadVisible = await page.locator('.n01-key-table').isVisible();
  if (!keypadVisible) {
    await page.keyboard.type(String(score));
    await page.keyboard.press('Enter');
    return;
  }
  for (const char of String(score)) {
    await page.locator('.n01-key-table button', { hasText: new RegExp(`^${char}$`) }).first().click();
  }
  await page.locator('.n01-key-table button.enter').click();
}

/**
 * Enters a visit score on the Pentathlon X01 screen (301/501), which reuses the exact same
 * fullscreen keypad/keyboard input as 通常01・チェックアウト練習. Double-in is the player's own
 * responsibility (enter 0 for a visit that failed to open) rather than anything the UI tracks.
 */
export async function enterPentScore(page: Page, score: number | string) {
  await enterGameScore(page, score);
}

/**
 * Stages dart hits on the Pentathlon dart pad and commits the turn.
 * Hit notation: 'S20' | 'D16' | 'T19' | 'BULL' | '25' | 'MISS'.
 */
export async function enterPentHits(page: Page, hits: string[]) {
  for (const hit of hits) {
    if (hit === 'MISS') {
      await page.locator('.pent-number-grid button.wide', { hasText: 'MISS' }).click();
    } else if (hit === 'BULL') {
      await page.locator('.pent-ring-row button', { hasText: /^BULL$/ }).click();
    } else if (hit === '25') {
      await page.locator('.pent-ring-row button', { hasText: /^25$/ }).click();
    } else {
      await page.locator('.pent-ring-row button', { hasText: new RegExp(`^${hit[0]}$`) }).click();
      await page.locator('.pent-number-grid button', { hasText: new RegExp(`^${hit.slice(1)}$`) }).first().click();
    }
  }
  await page.locator('button', { hasText: 'この投球を確定' }).click();
}

/** Confirms a finish-darts declaration dialog, choosing the first offered count. */
export async function confirmFinish(page: Page) {
  await page.locator('.n01-modal-card button', { hasText: /本目で終了/ }).first().click();
}

export async function openFreshApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.mode-card');
}

export async function openPentathlon(page: Page) {
  await page.locator('.mode-card', { hasText: 'ペンタスロン' }).click();
  await page.waitForSelector('.pent-preset-card');
}
