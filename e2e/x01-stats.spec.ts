import { expect, test, type Page } from '@playwright/test';
import { enterGameScore, openFreshApp } from './helpers';

/**
 * 通常01・チェックアウト練習: the play-screen statistics.
 *
 * Beside the sheet on a wide landscape screen (a 160px or 112px column for each player), the 詳細
 * dialog everywhere else. What these tests pin is what the player must be able to rely on: no score
 * gets smaller or moves when Stats is switched on, the sheet and the remaining row stay aligned,
 * the menu bar and keypad stay where they were, Stats never touches the match, and the screen's
 * important dialogs always win. The figures themselves are checked against n01 in
 * src/domain/x01Stats.n01.test.ts.
 *
 * Each block runs in one project only (desktop-chromium, or mobile-chromium for the phone), with its
 * own viewport, so nothing is run twice.
 */

const consoleProblems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  consoleProblems.set(page, problems);
  page.on('console', (message) => {
    if (message.type() === 'error' || /ResizeObserver/.test(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(consoleProblems.get(page) ?? []).toEqual([]);
});

const statsButton = (page: Page) => page.locator('.n01-menu-table button', { hasText: 'Stats' });
const columns = (page: Page) => page.locator('.x01-side-stats');
const detailDialog = (page: Page) => page.locator('.x01-stats-detail');

async function startMatch(page: Page, options: { mode?: '01' | 'checkout'; start?: number; com?: boolean } = {}) {
  await openFreshApp(page);
  if (options.mode === 'checkout') await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
  else await page.locator('.field select').first().selectOption(String(options.start ?? 1101));
  if (options.com) await page.locator('.toggle-field', { hasText: 'COM対戦' }).nth(1).locator('input').check();
  await page.getByRole('button', { name: /ゲームを開始/ }).click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();
}

async function enterAll(page: Page, scores: number[]) {
  for (const score of scores) await enterGameScore(page, score);
}

/** Every typographic property of the scores, and every height that must not move. */
async function scoreLayout(page: Page) {
  return page.evaluate(() => {
    const font = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const s = getComputedStyle(element);
      return [s.fontSize, s.fontFamily, s.fontStretch, s.fontWeight, s.lineHeight, s.fontVariationSettings].join(' | ');
    };
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
    };
    return {
      fonts: {
        score: font('.n01-score-table td.scored button'),
        ton: font('.n01-score-table .ton-score'),
        entry: font('.n01-score-table td.scored.current input'),
        toGo: font('.n01-score-table td.to-go'),
        darts: font('.n01-score-table td.darts'),
        remaining: font('.n01-left-table strong'),
        route: font('.n01-left-table span'),
        name: font('.n01-player-name strong'),
      },
      rowHeight: box('.n01-score-table tbody tr')?.height,
      remainingHeight: box('.n01-left-table')?.height,
      footer: box('.n01-game-footer'),
      menu: box('.n01-menu-table'),
      keypad: box('.n01-key-table'),
      sheetTop: box('.n01-score-area')?.top,
      sheetBottom: box('.n01-score-area')?.bottom,
      lineHeight: getComputedStyle(document.querySelector('.n01-game-footer')!, '::before').height,
      lineColor: getComputedStyle(document.querySelector('.n01-game-footer')!, '::before').backgroundColor,
    };
  });
}

/** Left/right edges of the sheet, the remaining row and the navy line, and the columns' boxes. */
async function edges(page: Page) {
  return page.evaluate(() => {
    const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const footer = r('.n01-game-footer');
    const before = getComputedStyle(document.querySelector('.n01-game-footer')!, '::before');
    const panels = [...document.querySelectorAll<HTMLElement>('.x01-side-stats')]
      .filter((panel) => !panel.hidden)
      .map((panel) => {
        const b = panel.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width };
      });
    return {
      sheet: [r('.n01-score-area').left, r('.n01-score-area').right],
      table: [r('.n01-score-table').left, r('.n01-score-table').right],
      remaining: [r('.n01-left-table').left, r('.n01-left-table').right],
      line: [footer.left + parseFloat(before.left), footer.right - parseFloat(before.right)],
      menuTop: r('.n01-menu-table').top,
      headerBottom: r('.n01-game-header').bottom,
      panels,
    };
  });
}

async function expectAligned(page: Page, side: number) {
  const viewport = page.viewportSize()!;
  const e = await edges(page);
  const middle = [side, viewport.width - side];
  expect(e.sheet).toEqual(middle);
  expect(e.table).toEqual(middle);
  expect(e.remaining).toEqual(middle);
  expect(e.line).toEqual(middle);
  expect(e.panels).toHaveLength(2);
  expect(e.panels[0]).toMatchObject({ left: 0, right: side, width: side });
  expect(e.panels[1]).toMatchObject({ left: viewport.width - side, right: viewport.width, width: side });
  for (const panel of e.panels) {
    // From under the header's 3px ring edge to the top of the menu bar.
    expect(panel.top).toBe(e.headerBottom + 3);
    expect(panel.bottom).toBe(e.menuTop);
  }
}

/** The match as saved, the live entry, and every bit of input state Stats must leave alone. */
async function inputState(page: Page) {
  return {
    saved: await page.evaluate(() => localStorage.getItem('n02-current-v1')),
    entry: await page.locator('.n01-score-table td.scored.current input').inputValue(),
    parked: await page.locator('.n01-score-table td.scored button.selected').count(),
    meta: await page.locator('.n01-game-meta strong').textContent(),
  };
}

test.describe('PC 1366×900', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-chromium only');
  test.use({ viewport: { width: 1366, height: 900 } });

  test('OFF / ON: scores keep their type and size, the sheet and remaining row stay aligned, the menu bar stays', async ({ page }) => {
    await startMatch(page);
    await enterAll(page, [100, 60, 140, 26, 180, 45]);
    const off = await scoreLayout(page);
    const offEdges = await edges(page);
    expect(offEdges.sheet).toEqual([0, 1366]);
    expect(offEdges.remaining).toEqual([0, 1366]);
    expect(offEdges.panels).toEqual([]);

    await statsButton(page).click();
    await expect(columns(page).first()).toBeVisible();
    expect(await scoreLayout(page)).toEqual(off);
    await expectAligned(page, 160);
    // The menu bar keeps its full width and place.
    const on = await scoreLayout(page);
    expect(on.menu).toMatchObject({ left: 0, width: 1366 });

    // Figures on the light grey column are #101820, the rate's numerator / denominator included.
    const colours = await page.evaluate(() => {
      const panel = document.querySelector('.x01-side-stats')!;
      return {
        value: getComputedStyle(panel.querySelector('dd')!).color,
        fraction: getComputedStyle(panel.querySelector('.x01-rate-fraction')!).color,
        background: getComputedStyle(panel).backgroundColor,
      };
    });
    expect(colours).toEqual({ value: 'rgb(16, 24, 32)', fraction: 'rgb(16, 24, 32)', background: 'rgb(233, 236, 232)' });
    // All twelve figures fit this height without scrolling.
    await expect(columns(page).first().locator('dl > div')).toHaveCount(12);
    expect(await columns(page).first().evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  });

  test('the Stats button and S switch the same columns, with aria-pressed / aria-controls / per-player labels', async ({ page }) => {
    await startMatch(page);
    const button = statsButton(page);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toHaveAttribute('aria-controls', 'x01-stats-p1 x01-stats-p2');
    await expect(page.locator('#x01-stats-p1')).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('complementary', { name: 'プレイヤー1の統計' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'プレイヤー2の統計' })).toBeVisible();

    await page.keyboard.press('s');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(columns(page).first()).toBeHidden();
    await page.keyboard.press('S');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(columns(page).first()).toBeVisible();

    // A held S, or S with a modifier, is not a Stats press.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', repeat: true, bubbles: true })));
    await page.keyboard.press('Control+s').catch(() => {});
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  test('Stats changes nothing in the match: the save, the entry, 使用ダーツ, the parked cell, 残り点数入力', async ({ page }) => {
    await startMatch(page);
    await enterAll(page, [60, 45]);
    await page.keyboard.press('m');
    await page.keyboard.press('1'); // 残り点数で入力
    await expect(page.locator('.n01-game-meta strong')).toContainText('残り点数入力');
    await page.keyboard.type('98');
    await page.keyboard.press('-'); // 使用ダーツ 2
    await page.keyboard.press('ArrowUp'); // park on the last visit
    const before = await inputState(page);
    expect(before.entry).toBe('98');
    expect(before.parked).toBe(1);

    await statsButton(page).click();
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await page.locator('.x01-side-stats-detail').first().click();
    await page.keyboard.press('Escape');
    await statsButton(page).click();

    expect(await inputState(page)).toEqual(before);
    await page.keyboard.press('m');
    await expect(page.locator('.n01-darts-inline button.selected')).toHaveText('2');
  });

  test('詳細 from a column: focus trapped, the game blocked, Escape closes back to the sheet, the columns stay', async ({ page }) => {
    await startMatch(page);
    await enterAll(page, [60]);
    await statsButton(page).click();
    await page.locator('.x01-side-stats-detail').first().click();
    await expect(detailDialog(page)).toBeVisible();
    await expect(detailDialog(page).getByRole('button', { name: '閉じる' })).toBeFocused();
    // Every row of n01's Details view.
    await expect(detailDialog(page).locator('.n01-stats-row')).toHaveCount(17);
    await expect(detailDialog(page)).toContainText('Checkout 予測');

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.x01-stats-detail'))).toBe(true);
    }
    const before = await inputState(page);
    await page.keyboard.type('99');
    await page.keyboard.press('u');
    await expect(detailDialog(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(detailDialog(page)).toHaveCount(0);
    await expect(page.locator('.n01-score-scroll')).toBeFocused();
    await expect(columns(page).first()).toBeVisible();
    await expect(statsButton(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await inputState(page)).toEqual(before);
  });

  test('S, a resize or a rotation never cover the Leg結果 dialog', async ({ page }) => {
    await startMatch(page, { start: 501 });
    await enterAll(page, [180, 0, 180, 0, 141]);
    await page.keyboard.press('3');
    const legResult = page.locator('.result-card');
    await expect(legResult).toBeVisible();

    await page.keyboard.press('s');
    await page.setViewportSize({ width: 900, height: 1366 });
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(legResult).toBeVisible();
    await expect(detailDialog(page)).toHaveCount(0);
    await expect(columns(page).first()).toBeHidden();
  });

  test('a rotation keeps what was asked for, without opening anything', async ({ page }) => {
    await startMatch(page);
    await statsButton(page).click();
    await page.setViewportSize({ width: 900, height: 1366 });
    await expect(columns(page)).toHaveCount(0);
    await expect(detailDialog(page)).toHaveCount(0);
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(columns(page).first()).toBeVisible();
    await expect(statsButton(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the next leg, an Undo and a correction keep the columns on and recompute them', async ({ page }) => {
    await startMatch(page, { start: 501 });
    await statsButton(page).click();
    const p1Average = page.locator('#x01-stats-p1 dd').first();
    await enterAll(page, [180, 0, 180, 0]);
    await expect(p1Average).toHaveText('180.00');
    await page.keyboard.press('u');
    await page.keyboard.press('u');
    await expect(p1Average).toHaveText('180.00');
    await expect(page.locator('#x01-stats-p2 dd').first()).toHaveText('0.00');
    await page.locator('.n01-score-table td.scored button').first().click();
    await page.locator('.n01-modal-card input[type="number"]').fill('60');
    await page.keyboard.press('Enter');
    await expect(p1Average).toHaveText('60.00');
    // 441 left: 180, 180, then 81 on the third dart.
    await enterAll(page, [180, 0, 180, 0, 81]);
    await page.keyboard.press('3');
    await expect(page.locator('#x01-stats-p1 dt', { hasText: 'Legs' }).locator('+ dd')).toHaveText('1');
    await page.keyboard.press('Enter'); // 次のLegへ
    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(columns(page).first()).toBeVisible();
    await expect(page.locator('#x01-stats-p1 dt', { hasText: 'Legs' }).locator('+ dd')).toHaveText('1');
  });

  test('a new match, a reload and a resumed save all start with Stats off', async ({ page }) => {
    await startMatch(page);
    await enterAll(page, [60]);
    await statsButton(page).click();
    await page.reload();
    await page.getByRole('button', { name: /保存した対戦を再開/ }).click();
    await expect(statsButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(columns(page).first()).toBeHidden();

    await statsButton(page).click();
    await page.keyboard.press('n');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(statsButton(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('on a COM turn Stats still switches, scoring stays blocked, and the COM throws exactly once', async ({ page }) => {
    await startMatch(page, { start: 501, com: true });
    await enterGameScore(page, 60);
    // The COM is now thinking (700ms): Stats works, a typed digit does not.
    await page.keyboard.press('s');
    await expect(columns(page).first()).toBeVisible();
    await page.keyboard.press('7');
    await statsButton(page).click();
    await statsButton(page).click();
    const comCells = page.locator('.n01-score-table tbody tr td:nth-child(4) button');
    await expect(comCells).toHaveCount(1);
    await page.waitForTimeout(1500);
    await expect(comCells).toHaveCount(1);
    await expect(page.locator('.n01-score-table td.scored.current input')).toHaveValue('');
  });
});

test.describe('PC 1280×720: scrolling without a bar', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-chromium only');
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the sheet, a column and the 詳細 body scroll by wheel and keyboard, and draw no bar or gutter', async ({ page }) => {
    await startMatch(page);
    await enterAll(page, [60, 60, 60, 60, 60, 60, 60, 60, 60, 60]);
    await statsButton(page).click();
    await expectAligned(page, 160);

    const style = (selector: string) =>
      page.locator(selector).first().evaluate((el: HTMLElement) => {
        const s = getComputedStyle(el);
        return [s.overflowY, s.scrollbarWidth, s.scrollbarGutter, el.offsetWidth - el.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth)];
      });
    const scrollTop = (selector: string) => page.locator(selector).first().evaluate((el) => el.scrollTop);

    // The sheet: it follows the latest round, so scroll it back up.
    expect(await style('.n01-score-scroll')).toEqual(['auto', 'none', 'auto', 0]);
    const sheetStart = await scrollTop('.n01-score-scroll');
    expect(sheetStart).toBeGreaterThan(0);
    await page.locator('.n01-score-scroll').hover();
    await page.mouse.wheel(0, -400);
    await expect.poll(() => scrollTop('.n01-score-scroll')).toBeLessThan(sheetStart);

    // A column holds more than this height shows.
    expect(await style('.x01-side-stats')).toEqual(['auto', 'none', 'auto', 0]);
    await page.locator('#x01-stats-p1').hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollTop('#x01-stats-p1')).toBeGreaterThan(0);
    await page.locator('#x01-stats-p2').focus();
    await page.keyboard.press('End');
    await expect.poll(() => scrollTop('#x01-stats-p2')).toBeGreaterThan(0);
    await page.keyboard.press('Home');
    await expect.poll(() => scrollTop('#x01-stats-p2')).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => scrollTop('#x01-stats-p2')).toBeGreaterThan(0);
    // ...and the arrow keys scrolled the column instead of walking the score sheet.
    await expect(page.locator('.n01-score-table td.scored button.selected')).toHaveCount(0);

    // The 詳細 body.
    await page.locator('#x01-stats-p2 .x01-side-stats-detail').click();
    expect(await style('.x01-stats-detail-body')).toEqual(['auto', 'none', 'auto', 0]);
    await page.locator('.x01-stats-detail-body').hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollTop('.x01-stats-detail-body')).toBeGreaterThan(0);
    await page.locator('.x01-stats-detail-body').evaluate((el) => (el.scrollTop = 0));
    await page.keyboard.press('Tab'); // from 閉じる round to the table
    await expect(page.locator('.x01-stats-detail-body')).toBeFocused();
    await page.keyboard.press('End');
    await expect.poll(() => scrollTop('.x01-stats-detail-body')).toBeGreaterThan(0);
    await expect(detailDialog(page).getByRole('button', { name: '閉じる' })).toBeVisible();
  });
});

test.describe('tablet 1024×768 (touch)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-chromium only');
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('compact 112px columns with the main figures; the keypad and menu bar keep their full width and place', async ({ page }) => {
    await startMatch(page);
    await enterAll(page, [100, 60, 140]);
    const off = await scoreLayout(page);
    expect(off.keypad).not.toBeNull();
    await statsButton(page).click();
    expect(await scoreLayout(page)).toEqual(off);
    await expectAligned(page, 112);
    await expect(columns(page).first().locator('dl > div')).toHaveCount(8);
    const on = await scoreLayout(page);
    expect(on.keypad).toMatchObject({ left: 0, width: 1024 });
    expect(on.menu).toMatchObject({ left: 0, width: 1024 });
  });
});

test.describe('チェックアウト練習 1366×900', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-chromium only');
  test.use({ viewport: { width: 1366, height: 900 } });

  test('Stats ON beside the sheet, with the leg\'s own challenge as the start', async ({ page }) => {
    await startMatch(page, { mode: 'checkout' });
    const off = await scoreLayout(page);
    await enterAll(page, [0]);
    await statsButton(page).click();
    await expectAligned(page, 160);
    await expect(page.locator('#x01-stats-p1 dd').first()).toHaveText('0.00');
    const on = await scoreLayout(page);
    expect(on.fonts.remaining).toBe(off.fonts.remaining);
    expect(on.remainingHeight).toBe(off.remainingHeight);
  });
});

test.describe('smartphone portrait', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile-chromium only');

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 320, height: 568 },
  ]) {
    test.describe(`${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport });

      test('Stats opens 詳細 directly: no strip, no extra button, no reserved space; closing turns Stats off', async ({ page }) => {
        await startMatch(page);
        await enterAll(page, [100, 60]);
        const before = await scoreLayout(page);
        const beforeEdges = await edges(page);
        expect(beforeEdges.sheet).toEqual([0, viewport.width]);
        await expect(statsButton(page)).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(columns(page)).toHaveCount(0);

        await statsButton(page).click();
        await expect(detailDialog(page)).toBeVisible();
        await expect(page.locator('.x01-side-stats, .x01-side-stats-detail')).toHaveCount(0);
        const card = await detailDialog(page).boundingBox();
        expect(card!.y).toBeGreaterThanOrEqual(0);
        expect(card!.y + card!.height).toBeLessThanOrEqual(viewport.height);
        await expect(detailDialog(page).getByRole('button', { name: '閉じる' })).toBeInViewport();
        // Figures on the dialog's light table are #101820, numerator / denominator included.
        const colours = await detailDialog(page).evaluate((dialog) => ({
          value: getComputedStyle(dialog.querySelector('.n01-stats-row strong')!).color,
          fraction: getComputedStyle(dialog.querySelector('.x01-rate-fraction')!).color,
        }));
        expect(colours).toEqual({ value: 'rgb(16, 24, 32)', fraction: 'rgb(16, 24, 32)' });

        // The body scrolls; the screen behind it does not take input.
        await page.locator('.x01-stats-detail-body').hover();
        await page.mouse.wheel(0, 300);
        await expect.poll(() => page.locator('.x01-stats-detail-body').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

        await page.keyboard.press('Escape');
        await expect(detailDialog(page)).toHaveCount(0);
        await expect(page.locator('.n01-score-scroll')).toBeFocused();
        expect(await scoreLayout(page)).toEqual(before);
        expect(await edges(page)).toEqual(beforeEdges);

        await statsButton(page).click();
        await detailDialog(page).getByRole('button', { name: '閉じる' }).click();
        await expect(detailDialog(page)).toHaveCount(0);
        expect(await edges(page)).toEqual(beforeEdges);
      });
    });
  }
});
