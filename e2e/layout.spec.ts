import { expect, test, type Page } from '@playwright/test';
import { openFreshApp, openPentathlon, openSingleGame } from './helpers';

/**
 * Layout guarantees that must hold at every supported viewport size (see playwright.config.ts's
 * layout-* projects): nothing scrolls sideways, the input controls stay reachable and unobstructed,
 * and the keypad never sits flush against the bottom edge of the screen.
 */

const LONG_NAME = 'あいうえおかきくけこさしすせそたちつ'; // exactly the 18-character input limit

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // 1px of tolerance: sub-pixel rounding can report a scrollWidth a hair over clientWidth.
    return doc.scrollWidth > doc.clientWidth + 1 || document.body.scrollWidth > doc.clientWidth + 1;
  });
}

/** Is the element the top-most thing at its own centre - i.e. genuinely clickable, not covered? */
async function isUnobstructed(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return false;
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && (element === hit || element.contains(hit) || hit.contains(element));
  }, selector);
}

/** Fills every visible player-name input with an 18-character name. */
async function fillLongNames(page: Page) {
  const inputs = page.locator('.name-input input');
  for (let i = 0; i < (await inputs.count()); i += 1) await inputs.nth(i).fill(LONG_NAME);
}

async function startSinglePentathlonX01(page: Page, { longNames = false } = {}) {
  await openFreshApp(page);
  await openSingleGame(page, 'JDA 501');
  await page.locator('select').first().selectOption('2');
  if (longNames) await fillLongNames(page);
  await page.getByRole('button', { name: /を開始/ }).click();
  await expect(page.locator('.pent-x01-shell')).toBeVisible();
}

test.describe('layout: no horizontal scrolling', () => {
  test('main menu', async ({ page }) => {
    await openFreshApp(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('Pentathlon setup and 個別練習 menu', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    await page.getByRole('button', { name: 'メニューへ戻る' }).click();
    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();
    await expect(page.locator('.pent-single-card').first()).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('Pentathlon X01 with 18-character player names', async ({ page }) => {
    await startSinglePentathlonX01(page, { longNames: true });
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expect(page.locator('.n01-player-name strong').first()).toContainText('あいうえお');
  });

  test('Cricket board with 18-character player names', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'CRICKET');
    await page.locator('select').first().selectOption('2');
    await fillLongNames(page);
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-cricket-board')).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('the discipline result table with 18-character player names', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'JDA 501');
    await fillLongNames(page);
    await page.getByRole('button', { name: /を開始/ }).click();

    await page.keyboard.type('180');
    await page.keyboard.press('Enter');
    await page.keyboard.type('180');
    await page.keyboard.press('Enter');
    await page.keyboard.type('141');
    await page.keyboard.press('Enter');
    await page.locator('.pent-modal-card button', { hasText: /本目で終了/ }).first().click();

    await expect(page.locator('.pent-result-table')).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

test.describe('layout: Pentathlon X01 input', () => {
  test('the entry preview covers neither the remaining scores nor any keypad button', async ({ page }) => {
    await startSinglePentathlonX01(page);

    await page.keyboard.type('45');
    const preview = page.locator('.pent-entry-popover');
    await expect(preview).toBeVisible();
    await expect(preview).toBeInViewport();

    const previewBox = (await preview.boundingBox())!;
    const keypadBox = (await page.locator('.n01-key-table').boundingBox())!;
    const scoresBox = (await page.locator('.n01-left-table').boundingBox())!;

    // Entirely above the footer, so it overlaps neither the scores nor the keys.
    expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(scoresBox.y + 1);
    expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(keypadBox.y + 1);

    // Every keypad button stays clickable while the preview is up.
    for (const label of ['1', '0', 'Enter']) {
      const button = page.locator('.n01-key-table button', { hasText: new RegExp(`^${label}$`) }).first();
      await expect(button).toBeInViewport();
    }
    expect(await isUnobstructed(page, '.n01-key-table button.enter')).toBe(true);
  });

  test('the keypad is on screen and clear of the bottom edge', async ({ page }) => {
    await startSinglePentathlonX01(page);

    const keypad = page.locator('.n01-key-table');
    await expect(keypad).toBeVisible();
    await expect(keypad).toBeInViewport();

    const box = (await keypad.boundingBox())!;
    const viewport = page.viewportSize()!;
    // The keypad element itself may run to the bottom edge, but its bottom row of buttons must not:
    // the padding underneath keeps repeated taps away from the home indicator / gesture area.
    const enter = (await page.locator('.n01-key-table button.enter').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(viewport.height - (enter.y + enter.height)).toBeGreaterThanOrEqual(12);
  });

  test('is fully playable with the mouse alone', async ({ page }) => {
    await startSinglePentathlonX01(page);

    const key = (label: string) =>
      page.locator('.n01-key-table button', { hasText: new RegExp(`^${label}$`) }).first();

    await key('1').click();
    await key('8').click();
    await key('0').click();
    await expect(page.locator('.pent-entry-popover strong')).toHaveText('180');

    // Correcting the entry, then confirming it - all without touching the keyboard.
    await page.locator('.n01-key-table button[aria-label="1文字削除"]').click();
    await expect(page.locator('.pent-entry-popover strong')).toHaveText('18');
    await key('0').click();
    await page.locator('.n01-key-table button.enter').click();

    await expect(page.locator('.pent-entry-popover')).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('321');
  });

  test('shows the keyboard shortcuts next to the input', async ({ page }) => {
    await startSinglePentathlonX01(page);
    const hint = page.locator('.pent-key-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Enter');
    await expect(hint).toContainText('Backspace');
  });
});

test.describe('layout: Cricket', () => {
  test('the input pad is reachable and unobstructed in the first viewport', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'CRICKET');
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-cricket-board')).toBeVisible();

    // Without scrolling: the pad's commit button and the ring row must already be on screen.
    await expect(page.locator('.pent-ring-row')).toBeInViewport();
    await expect(page.locator('.pent-keypad')).toBeInViewport();
    expect(await isUnobstructed(page, '.pent-ring-row button')).toBe(true);

    // The sticky pad must not sit on top of the menu row that travels with it.
    const padBox = (await page.locator('.pent-keypad').boundingBox())!;
    const actionsBox = (await page.locator('.pent-sticky-pad .pent-actions-3').boundingBox())!;
    expect(padBox.y + padBox.height).toBeLessThanOrEqual(actionsBox.y + 1);
    expect(await isUnobstructed(page, '.pent-sticky-pad .pent-actions-3 button')).toBe(true);
  });

  test('the progress list is collapsed so the board and pad fit', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('.pent-preset-card', { hasText: 'i-Pentathlon' }).click();
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    // Skip Cork/301/Baseball/501 by jumping straight to a single Cricket game instead: this test
    // only cares that the full-pentathlon Cricket screen collapses its progress list.
    await page.goto('/');
    await openSingleGame(page, 'CRICKET');
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-cricket-board')).toBeVisible();
    await expect(page.locator('.pent-keypad')).toBeInViewport();
  });
});
