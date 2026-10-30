import { expect, test, type Page } from '@playwright/test';
import {
  enterCountUpRound,
  enterGameScore,
  openFreshApp,
  openSingleGame,
  startCountUp,
} from './helpers';
import { reach } from './reach';

/**
 * Smartphone landscape (844×390, 852×393, 932×430 - see the layout-landscape-* projects in
 * playwright.config.ts).
 *
 * A phone on its side is barely 390px tall. Stacked vertically the 01 footer alone is taller than
 * that, which used to leave the score sheet exactly 0px high - no history, no live entry cell, no
 * remaining score - with the keypad running past the bottom edge. The controls now sit in a rail
 * beside the sheet instead. These tests pin the outcome, not the technique: every number a player
 * needs is on screen, every control is reachable, and nothing overflows.
 */

const box = async (page: Page, selector: string) => {
  const handle = page.locator(selector);
  await expect(handle).toBeVisible();
  return (await handle.boundingBox())!;
};

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      vertical: Math.max(doc.scrollHeight, document.body.scrollHeight) - doc.clientHeight,
      horizontal: Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth,
    };
  });
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.vertical).toBeLessThanOrEqual(1);
}

/** Everything on screen, and the bottom key row clear of the home indicator / gesture area. */
async function expectFitsWithBottomClearance(page: Page, keypadSelector: string, enterSelector: string) {
  const viewport = page.viewportSize()!;
  const keypad = await box(page, keypadSelector);
  const enter = await box(page, enterSelector);
  expect(keypad.y + keypad.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(viewport.height - (enter.y + enter.height)).toBeGreaterThanOrEqual(12);
}

test.describe('smartphone landscape: 通常01 / チェックアウト練習', () => {
  for (const mode of ['通常01', 'チェックアウト練習'] as const) {
    test(`${mode}: 得点シートが潰れず、残り点数と入力欄が同時に見える`, async ({ page }) => {
      await openFreshApp(page);
      if (mode === 'チェックアウト練習') await page.locator('.mode-card', { hasText: mode }).click();
      await page.getByRole('button', { name: /ゲームを開始/ }).click();
      await expect(page.locator('.n01-game-shell')).toBeVisible();

      await expectNoOverflow(page);

      // The regression this whole block exists for: the sheet had collapsed to 0px.
      const sheet = await box(page, '.n01-score-area');
      expect(sheet.height).toBeGreaterThanOrEqual(160);

      // At least one full history row fits inside it.
      const row = await box(page, '.n01-score-table tbody tr:first-child');
      expect(row.height).toBeLessThanOrEqual(sheet.height);

      // The three numbers a player reads while throwing are all on screen at once.
      await expect(page.locator('.n01-left-table strong').first()).toBeInViewport();
      await expect(page.locator('.n01-score-table td.scored.current input')).toBeInViewport();
      await expect(page.locator('.n01-player-name strong').first()).toBeInViewport();

      // Every control is reachable without scrolling.
      await expect(page.locator('.n01-menu-table button', { hasText: '☰' })).toBeInViewport();
      await expectFitsWithBottomClearance(page, '.n01-key-table', '.n01-key-table button.enter');
    });
  }

  test('横向きでもテンキーだけで1投を入力できる', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();

    const key = (label: string) =>
      page.locator('.n01-key-table button', { hasText: new RegExp(`^${label}$`) }).first();
    await key('6').click();
    await key('0').click();
    await expect(page.locator('.n01-score-table td.scored.current input')).toHaveValue('60');
    await page.locator('.n01-key-table button.enter').click();

    await expect(page.locator('.n01-left-table strong').first()).toHaveText('441');
    await expectNoOverflow(page);
  });

  test('得点入力後もシートと操作列が収まったままになる', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    for (const score of [60, 45, 100, 26]) await enterGameScore(page, score);

    await expectNoOverflow(page);
    await expect(page.locator('.n01-score-table td.scored.current input')).toBeInViewport();
    await expectFitsWithBottomClearance(page, '.n01-key-table', '.n01-key-table button.enter');
  });

  test('ダイアログは横向き画面をはみ出さない', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();

    const card = await box(page, '.n01-modal-card');
    const viewport = page.viewportSize()!;
    expect(card.y).toBeGreaterThanOrEqual(-1);
    expect(card.y + card.height).toBeLessThanOrEqual(viewport.height + 1);
    await expectNoOverflow(page);
  });
});

test.describe('smartphone landscape: Pentathlon X01', () => {
  test('301/501 の得点シートが潰れず、操作列も収まる', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'JDA 501');
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();

    await expectNoOverflow(page);
    const sheet = await box(page, '.n01-score-area');
    expect(sheet.height).toBeGreaterThanOrEqual(160);
    await expect(page.locator('.n01-left-table strong').first()).toBeInViewport();
    await expectFitsWithBottomClearance(page, '.n01-key-table', '.n01-key-table button.enter');
  });
});

/**
 * n01's own landscape layout: the keypad the full height of the right-hand side, the header, the
 * sheet, the remaining scores and the menu bar stacked on the left. Every part is checked against
 * every other for overlap - measuring each part's own size is not enough, a part can be laid out
 * over another one (the Pentathlon footer once covered the whole screen with the sizes all right).
 */
async function expectN01StyleLandscape(page: Page) {
  const viewport = page.viewportSize()!;
  const parts = ['.n01-game-header', '.n01-score-area', '.n01-left-table', '.n01-menu-table', '.n01-key-table'];
  const boxes = Object.fromEntries(await Promise.all(parts.map(async (part) => [part, await box(page, part)] as const)));
  for (const [i, a] of parts.entries()) {
    const boxA = boxes[a];
    expect(boxA.x).toBeGreaterThanOrEqual(-0.5);
    expect(boxA.x + boxA.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(boxA.y + boxA.height).toBeLessThanOrEqual(viewport.height + 0.5);
    for (const b of parts.slice(i + 1)) {
      const boxB = boxes[b];
      const overlapX = Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x);
      const overlapY = Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y);
      expect(overlapX <= 0.5 || overlapY <= 0.5, `${a} overlaps ${b}`).toBe(true);
    }
  }
  // The keypad runs from the top edge to the bottom; everything else sits to its left.
  const keys = boxes['.n01-key-table'];
  expect(keys.y).toBeLessThanOrEqual(0.5);
  expect(keys.y + keys.height).toBeGreaterThanOrEqual(viewport.height - 0.5);
  for (const part of parts.slice(0, -1)) expect(boxes[part].x + boxes[part].width).toBeLessThanOrEqual(keys.x + 0.5);
  // The sheet, then the remaining scores, then the menu bar, top to bottom.
  expect(boxes['.n01-score-area'].y + boxes['.n01-score-area'].height).toBeLessThanOrEqual(boxes['.n01-left-table'].y + 0.5);
  expect(boxes['.n01-left-table'].y + boxes['.n01-left-table'].height).toBeLessThanOrEqual(boxes['.n01-menu-table'].y + 0.5);
}

test.describe('smartphone landscape: n01 型の配置', () => {
  for (const [mode, theme] of [
    ['通常01', 'clean'],
    ['通常01', 'neon'],
    ['通常01', 'navy'],
    ['Pentathlon 501', 'clean'],
    ['Pentathlon 501', 'neon'],
    ['Pentathlon 501', 'navy'],
  ] as const) {
    test(`${mode}（${theme}）: テンキーが右の全高、シート・残り点数・メニューが左。重なりなく、全キーが押せる`, async ({ page }, testInfo) => {
      await openFreshApp(page);
      await page.evaluate((name) => localStorage.setItem('n02-theme-v1', name), theme);
      await page.reload();
      await page.waitForSelector('.mode-card');
      if (mode === '通常01') {
        await page.getByRole('button', { name: /ゲームを開始/ }).click();
        await expect(page.locator('.n01-game-shell')).toBeVisible();
      } else {
        await openSingleGame(page, 'JDA 501');
        await page.getByRole('button', { name: /を開始/ }).click();
        await expect(page.locator('.pent-x01-shell')).toBeVisible();
      }
      await expectNoOverflow(page);
      await expectN01StyleLandscape(page);

      // Every key and menu button whole, uncovered and pressable where it is tapped, with no scrolling.
      for (const button of await page.locator('.n01-key-table button, .n01-menu-table button').all()) {
        expect((await reach(page, button, testInfo)).gestures).toBe(0);
      }
      // The footer spans the whole screen, so its empty cell must be see-through in every theme:
      // a tap passing through is not enough, the header and the sheet have to be visible under it.
      expect(await page.locator('.n01-game-footer').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        'rgba(0, 0, 0, 0)',
      );
      // A tap on the sheet's free area still reaches the sheet through the footer's empty cell.
      const sheet = await box(page, '.n01-score-area');
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('.n01-score-area') !== null,
        [sheet.x + sheet.width / 2, sheet.y + sheet.height - 4] as const,
      );
      expect(hit).toBe(true);

      // And a visit entered on the keypad still lands.
      await enterGameScore(page, 60);
      await expect(page.locator('.n01-left-table strong').first()).toHaveText('441');
      await expectN01StyleLandscape(page);
    });
  }
});

test.describe('smartphone landscape: COUNT-UP', () => {
  test('ラウンド履歴が読める高さを保ち、TOTAL と ENTER が同時に見える', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, {});

    await expectNoOverflow(page);
    const board = await box(page, '.countup-board');
    // Used to be 18px - not even one round.
    expect(board.height).toBeGreaterThanOrEqual(160);
    const row = await box(page, '.countup-table tbody tr:first-child');
    expect(board.height / row.height).toBeGreaterThanOrEqual(2);

    await expect(page.locator('.countup-total-value').first()).toBeInViewport();
    await expect(page.locator('.countup-menu button', { hasText: '☰' })).toBeInViewport();
    await expectFitsWithBottomClearance(page, '.countup-keypad', '.countup-keypad button.enter');
  });

  test('横向きでもテンキーでラウンド得点を確定できる', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, {});
    await enterCountUpRound(page, 100);
    await expect(page.locator('.countup-total-value').first()).toContainText('100');
    await expectNoOverflow(page);
  });
});

test.describe('smartphone landscape: 他モード', () => {
  for (const label of ['CRICKET', 'CORK', 'BASEBALL'] as const) {
    test(`${label} は横向きでもスクロールなしで投げられる`, async ({ page }) => {
      await openFreshApp(page);
      await openSingleGame(page, label);
      await page.getByRole('button', { name: /を開始/ }).click();

      await expectNoOverflow(page);
      const commit =
        label === 'CRICKET'
          ? page.getByRole('button', { name: '確定' })
          : page.locator('button', { hasText: 'この投球を確定' });
      await expect(commit).toBeInViewport();
      await expect(page.getByRole('button', { name: 'メニュー' })).toBeInViewport();
    });
  }
});

/**
 * Rotating the device must never cost the player their game. The layout is CSS-only, so the React
 * state behind it is the same object either way - this proves it, including the digits that were
 * only part-typed when the phone turned.
 */
test.describe('画面回転', () => {
  test('通常01: portrait → landscape → portrait でゲーム状態と入力途中の値が残る', async ({ page }) => {
    const landscape = page.viewportSize()!;
    const portrait = { width: landscape.height, height: landscape.width };

    await page.setViewportSize(portrait);
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100);
    await enterGameScore(page, 60);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');

    // A visit half typed at the moment the phone is turned.
    const key = (label: string) =>
      page.locator('.n01-key-table button', { hasText: new RegExp(`^${label}$`) }).first();
    await key('4').click();
    await key('5').click();
    const entry = page.locator('.n01-score-table td.scored.current input');
    await expect(entry).toHaveValue('45');

    await page.setViewportSize(landscape);
    await expect(entry).toHaveValue('45');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
    await expect(page.locator('.n01-score-table td.scored button').first()).toHaveText('100');
    await expectNoOverflow(page);

    await page.setViewportSize(portrait);
    await expect(entry).toHaveValue('45');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');

    // And the part-typed visit still commits normally afterwards.
    await page.locator('.n01-key-table button.enter').click();
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('356');
  });

  test('COUNT-UP: portrait → landscape → portrait でラウンド履歴と入力途中の値が残る', async ({ page }) => {
    const landscape = page.viewportSize()!;
    const portrait = { width: landscape.height, height: landscape.width };

    await page.setViewportSize(portrait);
    await openFreshApp(page);
    await startCountUp(page, {});
    await enterCountUpRound(page, 140);
    await expect(page.locator('.countup-total-value').first()).toContainText('140');

    await page.locator('.countup-keypad button', { hasText: /^8$/ }).first().click();
    await expect(page.locator('.countup-table td.entry .countup-cell-entry')).toHaveText('8');

    await page.setViewportSize(landscape);
    await expect(page.locator('.countup-table td.entry .countup-cell-entry')).toHaveText('8');
    await expect(page.locator('.countup-total-value').first()).toContainText('140');
    await expectNoOverflow(page);

    await page.setViewportSize(portrait);
    await expect(page.locator('.countup-table td.entry .countup-cell-entry')).toHaveText('8');
    await page.locator('.countup-keypad button', { hasText: /^1$/ }).first().click();
    await page.locator('.countup-keypad button.enter').click();
    // 140 + 81
    await expect(page.locator('.countup-total-value').first()).toContainText('221');
  });
});
