import { expect, test, type Page } from '@playwright/test';
import {
  enterCountUpRound,
  openFreshApp,
  openPentathlon,
  openPracticeHub,
  openSingleGame,
  startCountUp,
  tapQuickTarget,
} from './helpers';

/**
 * Layout guarantees that must hold at every supported viewport size (see playwright.config.ts's
 * layout-* projects): nothing scrolls sideways, the input controls stay reachable and unobstructed,
 * and the keypad never sits flush against the bottom edge of the screen.
 */

const LONG_NAME = 'あいうえおかきくけこさしすせそたちつ'; // exactly the 18-character input limit

/** Does anything on the page require the user to scroll to reach it? */
async function hasVerticalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollHeight > doc.clientHeight + 1 || document.body.scrollHeight > doc.clientHeight + 1;
  });
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // 1px of tolerance: sub-pixel rounding can report a scrollWidth a hair over clientWidth.
    return doc.scrollWidth > doc.clientWidth + 1 || document.body.scrollWidth > doc.clientWidth + 1;
  });
}

/** Narrow screens and wide touch-first screens need the on-screen input route. */
const keypadExpected = (page: Page) =>
  page.evaluate(
    () =>
      window.innerWidth <= 720 ||
      window.matchMedia('(hover: none) and (pointer: coarse)').matches,
  );

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
    await page.locator('select').first().selectOption('1');
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
  test('the keypad follows input capability rather than viewport width alone', async ({ page }) => {
    await startSinglePentathlonX01(page);
    const keypad = page.locator('.n01-key-table');
    if (await keypadExpected(page)) await expect(keypad).toBeVisible();
    else await expect(keypad).toBeHidden();
  });

  test('the remaining score is set at exactly the size 通常01 uses', async ({ page }) => {
    // Both screens are the same fullscreen shell, so the headline number a player reads from across
    // the room must not shrink just because the game happens to be a Pentathlon discipline.
    await startSinglePentathlonX01(page);
    const pentathlon = await page
      .locator('.n01-left-table strong')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);

    // 通常01 is the menu's own default selection, so starting straight away opens it.
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();
    const standard = await page
      .locator('.n01-left-table strong')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);

    expect(pentathlon).toBe(standard);
  });

  test('the score being typed appears in the sheet, with nothing covering it', async ({ page }) => {
    await startSinglePentathlonX01(page);

    await page.keyboard.type('45');
    const cell = page.locator('.n01-score-table td.scored.current input');
    await expect(cell).toHaveValue('45');
    await expect(cell).toBeInViewport();

    if (!(await keypadExpected(page))) return;
    // Where the keypad exists, every key stays clickable while a score is part-entered.
    for (const label of ['1', '0', 'Enter']) {
      const button = page.locator('.n01-key-table button', { hasText: new RegExp(`^${label}$`) }).first();
      await expect(button).toBeInViewport();
    }
    expect(await isUnobstructed(page, '.n01-key-table button.enter')).toBe(true);
  });

  test('the keypad is on screen and clear of the bottom edge', async ({ page }) => {
    test.skip(!(await keypadExpected(page)), 'this viewport has a physical-keyboard input route');
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

  test('is fully playable with the on-screen keypad where it exists', async ({ page }) => {
    test.skip(!(await keypadExpected(page)), 'this viewport has a physical-keyboard input route');
    await startSinglePentathlonX01(page);

    const key = (label: string) =>
      page.locator('.n01-key-table button', { hasText: new RegExp(`^${label}$`) }).first();
    const cell = () => page.locator('.n01-score-table td.scored.current input');

    await key('1').click();
    await key('8').click();
    await key('0').click();
    await expect(cell()).toHaveValue('180');

    // Correcting the entry, then confirming it - all without touching the keyboard.
    await page.locator('.n01-key-table button[aria-label="1文字削除"]').click();
    await expect(cell()).toHaveValue('18');
    await key('0').click();
    await page.locator('.n01-key-table button.enter').click();

    await expect(cell()).toHaveValue('');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('321');
  });

  test('the keyboard shortcuts are listed in the ☰ menu', async ({ page }) => {
    await startSinglePentathlonX01(page);
    await page.getByRole('button', { name: 'メニュー' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Enter');
    await expect(dialog).toContainText('Backspace');
  });
});

test.describe('layout: shared 通常01 / checkout input route', () => {
  for (const mode of ['通常01', 'チェックアウト練習'] as const) {
    test(`${mode} can enter a visit by the available input route`, async ({ page }) => {
      await openFreshApp(page);
      if (mode === 'チェックアウト練習') {
        await page.locator('.mode-card', { hasText: mode }).click();
      }
      await page.getByRole('button', { name: /ゲームを開始/ }).click();

      const keypad = page.locator('.n01-key-table');
      if (await keypadExpected(page)) {
        await expect(keypad).toBeVisible();
        await keypad.getByRole('button', { name: '0', exact: true }).click();
        await keypad.locator('button.enter').click();
      } else {
        await expect(keypad).toBeHidden();
        await page.keyboard.type('0');
        await page.keyboard.press('Enter');
      }

      await expect(page.locator('.n01-score-table td.scored button').first()).toHaveText('0');
      expect(await hasHorizontalScroll(page)).toBe(false);
      const footer = (await page.locator('.n01-game-footer').boundingBox())!;
      expect(footer.y + footer.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    });
  }
});

test.describe('layout: gameplay fits one screen', () => {
  /** Every discipline, at every layout viewport, must be playable without scrolling the page. */
  const DISCIPLINES = ['CORK', 'JDA 501', 'BASEBALL', 'HALF-IT', 'GOLF', 'CRICKET'] as const;

  for (const label of DISCIPLINES) {
    test(`${label} needs no scrolling to play`, async ({ page }) => {
      await openFreshApp(page);
      await openSingleGame(page, label);
      await page.locator('select').first().selectOption('2');
      await page.getByRole('button', { name: /を開始/ }).click();

      expect(await hasVerticalScroll(page)).toBe(false);
      expect(await hasHorizontalScroll(page)).toBe(false);

      // The controls that commit a throw are on screen and genuinely clickable, unscrolled.
      // X01 commits with Enter. Its keypad is visible on touch-first layouts and hidden where a
      // physical-keyboard route is expected, so the live entry cell must always remain reachable.
      const commit =
        label === 'JDA 501'
          ? page.locator('.n01-score-table td.scored.current input')
          : label === 'CRICKET'
            ? page.getByRole('button', { name: '確定' })
            : page.locator('button', { hasText: 'この投球を確定' });
      await expect(commit).toBeInViewport();
      await expect(page.getByRole('button', { name: 'メニュー' })).toBeInViewport();
    });
  }

  test('Cricket still fits once a turn has been entered', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'CRICKET');
    await page.locator('select').first().selectOption('2');
    await page.getByRole('button', { name: /を開始/ }).click();

    for (const name of ['トリプル20', 'トリプル19', 'トリプル18']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    await page.getByRole('button', { name: '確定' }).click();

    expect(await hasVerticalScroll(page)).toBe(false);
    expect(await isUnobstructed(page, '.pent-cricket-key')).toBe(true);
    await expect(page.getByRole('button', { name: '確定' })).toBeInViewport();
  });

  test('Cork still fits with a dart staged', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'CORK');
    await page.locator('select').first().selectOption('2');
    await page.getByRole('button', { name: /を開始/ }).click();

    await tapQuickTarget(page, 'インナーブル');
    expect(await hasVerticalScroll(page)).toBe(false);
    await expect(page.locator('button', { hasText: 'この投球を確定' })).toBeInViewport();
  });
});


test.describe('layout: PRACTICE / COUNT-UP', () => {
  test('the hub and the COUNT-UP setup never scroll sideways', async ({ page }) => {
    await openFreshApp(page);
    await openPracticeHub(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    await page.locator('.practice-card[data-practice="count-up"]').click();
    await expect(page.locator('.countup-setup')).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('the play screen fits one viewport, keypad clear of the bottom edge', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, { players: 2, names: [LONG_NAME, LONG_NAME] });

    expect(await hasVerticalScroll(page)).toBe(false);
    expect(await hasHorizontalScroll(page)).toBe(false);

    // ROUND, the active player, TOTAL and the input are all on screen at once, unscrolled.
    await expect(page.locator('.countup-round-badge')).toBeInViewport();
    await expect(page.locator('.countup-total-card.active')).toBeInViewport();
    await expect(page.locator('.countup-entry-value')).toBeInViewport();
    const enter = page.locator('.countup-keypad button.enter');
    await expect(enter).toBeInViewport();
    expect(await isUnobstructed(page, '.countup-keypad button.enter')).toBe(true);

    const box = (await enter.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  test('the score being typed is visible while the keypad stays reachable', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page);
    for (const digit of ['1', '4', '0']) {
      await page.locator('.countup-keypad button', { hasText: new RegExp(`^${digit}$`) }).first().click();
    }
    await expect(page.locator('.countup-entry-value')).toHaveText('140');
    await expect(page.locator('.countup-entry-value')).toBeInViewport();
    await expect(page.locator('.countup-cell-entry')).toHaveText('140');
  });

  test('the award presentation covers neither the entry nor the keypad', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page);
    await enterCountUpRound(page, 180);
    await expect(page.locator('.countup-award-card')).toBeVisible();

    // The overlay takes no pointer events, so every control underneath stays live.
    expect(await isUnobstructed(page, '.countup-keypad button.enter')).toBe(true);
    await enterCountUpRound(page, 60);
    await expect(page.locator('.countup-total-value').first()).toContainText('240');
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('the result screen fits, with 18-character player names', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, { players: 2, names: [LONG_NAME, LONG_NAME] });
    for (let round = 0; round < 8; round += 1) {
      await enterCountUpRound(page, 100);
      await enterCountUpRound(page, 40);
    }
    await expect(page.locator('.countup-result-shell')).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expect(page.locator('.countup-verdict strong')).toContainText('あいうえお');
  });
});
