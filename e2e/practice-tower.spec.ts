import { expect, test, type Page } from '@playwright/test';
import {
  enterCountUpRound,
  judgeTower,
  judgeTowerDarts,
  openFreshApp,
  openPracticeHub,
  startCountUp,
  startTower,
  towerClick,
  towerClickByName,
  TOWER_INPUT_GAP_MS,
} from './helpers';

/**
 * PRACTICE / TOWER OF THE DARTS end-to-end coverage.
 *
 * Two things are being checked: that a climb actually plays end to end on a real page, and that
 * playing one leaves nothing behind - no keyboard binding, no style, no storage write that any
 * other mode can feel. The last describe block is that second half.
 */

const floorBadge = (page: Page) => page.locator('.tower-floor-badge strong');
const lifeLabel = (page: Page) => page.locator('.tower-status-card').first().locator('.tower-status-life');

async function lifeOf(page: Page, index = 0): Promise<number> {
  const label = await page.locator('.tower-status-card').nth(index).locator('.tower-status-life').getAttribute('aria-label');
  return Number((label ?? '').replace(/^LIFE (\d+).*$/, '$1'));
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1 || document.body.scrollWidth > doc.clientWidth + 1;
  });
}

/** Every pre-existing storage key, with a value planted in it. */
const FOREIGN_KEYS = {
  'n02-current-v1': '{"keep":"me"}',
  'n02-history-v1': '[{"keep":"me"}]',
  'n02-theme-v1': 'neon',
  'n02-pentathlon-v1': '{"keep":"me"}',
  'n02-pentathlon-single-v1': '{"keep":"me"}',
  'n02-award-display-v1': '{"keep":"me"}',
  'n02-practice-countup-history-v1': '[{"keep":"me"}]',
} as const;

test.describe('PRACTICE hub', () => {
  test('lists TOWER as playable alongside COUNT-UP', async ({ page }) => {
    await openFreshApp(page);
    await openPracticeHub(page);
    const card = page.locator('.practice-card[data-practice="tower"]');
    await expect(card).toContainText('TOWER OF THE DARTS');
    await expect(card).toContainText('100 FLOORS');
    // The pre-existing cards are all still there and unchanged.
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toContainText('8 ROUNDS');
    await expect(page.locator('.practice-card.coming-soon')).toHaveCount(2);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('opens the TOWER setup and comes back to the hub', async ({ page }) => {
    await openFreshApp(page);
    await openPracticeHub(page);
    await page.locator('.practice-card[data-practice="tower"]').click();
    await expect(page.locator('.tower-setup')).toBeVisible();
    await page.getByRole('button', { name: 'PRACTICE へ戻る' }).click();
    await expect(page.locator('.practice-card[data-practice="tower"]')).toBeVisible();
  });
});

test.describe('TOWER play', () => {
  test('shows the first-run help once, and never again', async ({ page }) => {
    await openFreshApp(page);
    await openPracticeHub(page);
    await page.locator('.practice-card[data-practice="tower"]').click();
    await page.getByRole('button', { name: /TOWER を開始/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('どちらも押さずに着弾を確認');
    await dialog.getByRole('button', { name: 'はじめる' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Leave and come back: the help has been seen.
    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await page.locator('.practice-card[data-practice="tower"]').click();
    await page.getByRole('button', { name: /TOWER を開始/ }).click();
    await expect(page.locator('.tower-shell')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('climbs one floor per 成功 and holds the floor on MISS', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await expect(floorBadge(page)).toContainText('1');
    await expect(page.locator('.tower-target-text')).toHaveText('盤面すべて（82エリア）');

    await judgeTower(page, 'hit');
    await expect(floorBadge(page)).toContainText('2');
    expect(await lifeOf(page)).toBe(3);

    await judgeTower(page, 'miss');
    await expect(floorBadge(page)).toContainText('2');
    expect(await lifeOf(page)).toBe(2);
  });

  test('waits at the pickup screen after three darts, and only moves on 次へ', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTower(page, 'hit');
    await judgeTower(page, 'hit');
    await judgeTower(page, 'hit');

    await expect(page.locator('.tower-panel.pickup')).toContainText('ダーツを回収してください');
    await expect(page.locator('.tower-judge')).toHaveCount(0);
    // Nothing advances by itself: still on the pickup screen a second later.
    await page.waitForTimeout(1200);
    await expect(page.locator('.tower-panel.pickup')).toBeVisible();

    await towerClick(page, '.tower-panel.pickup button');
    await expect(page.locator('.tower-judge.hit')).toBeVisible();
    await expect(page.locator('.tower-pip.done')).toHaveCount(0);
  });

  test('recovers LIFE on clearing 10F, not on reaching it', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    // Nine floors, with a miss on the way so the recovery has something to restore. Every dart goes
    // through judgeTowerDarts, which takes the pickup screen whenever a turn happens to run out.
    await judgeTowerDarts(page, 'hit', 8);
    await judgeTowerDarts(page, 'miss', 1);
    expect(await lifeOf(page)).toBe(2);

    await judgeTowerDarts(page, 'hit', 1); // 9F cleared -> standing on 10F
    await expect(floorBadge(page)).toContainText('10');
    expect(await lifeOf(page)).toBe(2);

    await judgeTowerDarts(page, 'hit', 1); // 10F cleared -> recovery
    await expect(floorBadge(page)).toContainText('11');
    expect(await lifeOf(page)).toBe(3);
  });

  test('offers CONTINUE at LIFE 0 and restarts the same floor', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTowerDarts(page, 'hit', 3); // on 4F
    await judgeTowerDarts(page, 'miss', 3);

    await expect(page.locator('.tower-panel.over')).toContainText('GAME OVER');
    await expect(page.locator('.tower-judge')).toHaveCount(0);

    await towerClickByName(page, 'CONTINUE する');
    await expect(floorBadge(page)).toContainText('4');
    expect(await lifeOf(page)).toBe(3);
    await expect(page.locator('.tower-status-card').first()).toContainText('CONTINUE 残 4');
  });

  test('takes a dart back, recovery and all', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTowerDarts(page, 'hit', 9);
    await judgeTower(page, 'miss');
    await expect(floorBadge(page)).toContainText('10');
    expect(await lifeOf(page)).toBe(2);

    await towerClick(page, '.tower-menu button:has-text("1投戻す")');
    expect(await lifeOf(page)).toBe(3);
    await expect(page.locator('.tower-notice')).toContainText('取り消しました');
  });

  test('ends at RESULT with CLEAR FLOOR, and plays again', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page, { names: ['AKI'] });
    // Three floors beaten, then out of LIFE on 4F and no CONTINUE: CLEAR FLOOR 3.
    await judgeTowerDarts(page, 'hit', 3);
    await judgeTowerDarts(page, 'miss', 3);
    await towerClickByName(page, 'やめる');
    await towerClick(page, '.tower-panel.end button');

    await expect(page.locator('.tower-result')).toBeVisible();
    await expect(page.locator('.tower-result-floor')).toContainText('3');
    await expect(page.locator('.tower-result-card')).toContainText('AKI');
    await expect(page.locator('.tower-result-card')).toContainText('GAME OVER');
    await expect(page.locator('.tower-result')).toContainText('START LIFE 3');
    await expect(page.locator('.tower-result')).toContainText('CONTINUE 5');

    await page.getByRole('button', { name: /同じ設定でもう一度/ }).click();
    await expect(page.locator('.tower-shell')).toBeVisible();
    await expect(floorBadge(page)).toContainText('1');
  });

  test('gets back to PRACTICE from RESULT, where the climb is listed', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page, { names: ['AKI'] });
    await judgeTowerDarts(page, 'hit', 2);
    await judgeTowerDarts(page, 'miss', 3);
    await towerClickByName(page, 'やめる');
    await towerClick(page, '.tower-panel.end button');

    await page.getByRole('button', { name: '設定を変えて遊ぶ' }).click();
    await expect(page.locator('.tower-setup')).toBeVisible();
    await expect(page.locator('.countup-history')).toContainText('AKI');
    await expect(page.locator('.countup-history')).toContainText('2');

    await page.getByRole('button', { name: 'PRACTICE へ戻る' }).click();
    await expect(page.locator('.practice-card[data-practice="tower"]')).toBeVisible();
  });

  test('comes back from RESULT on 1投戻す, un-recording the game', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page, { names: ['AKI'] });
    await judgeTowerDarts(page, 'hit', 3);
    await judgeTowerDarts(page, 'miss', 3);
    await towerClickByName(page, 'やめる');
    await towerClick(page, '.tower-panel.end button');
    await expect(page.locator('.tower-result')).toBeVisible();

    // RESULT is a finished game, so it is in the history...
    const recorded = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('n02-practice-tower-history-v1') ?? '[]').length,
    );
    expect(recorded).toBe(1);

    await page.getByRole('button', { name: /1投戻す/ }).click();
    // ...and taking the dart back puts the game back in play, so the row goes with it.
    await expect(page.locator('.tower-shell')).toBeVisible();
    await expect(floorBadge(page)).toContainText('4');
    expect(await lifeOf(page)).toBe(1);
    const afterUndo = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('n02-practice-tower-history-v1') ?? '[]').length,
    );
    expect(afterUndo).toBe(0);
  });

  test('two players climb their own towers and both reach RESULT', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page, { players: 2, names: ['AKI', 'BEN'] });

    await judgeTower(page, 'hit');
    await judgeTower(page, 'hit');
    await judgeTower(page, 'hit');
    await expect(page.locator('.tower-panel.pickup')).toContainText('BEN の手番です');
    await towerClick(page, '.tower-panel.pickup button');

    // BEN opens on their own 1F; AKI's three floors are AKI's.
    await expect(floorBadge(page)).toContainText('1');
    await expect(page.locator('.tower-status-card').first()).toContainText('4F');
    await expect(page.locator('.tower-status-card').nth(1)).toContainText('1F');

    // BEN runs out and stops; AKI keeps going alone.
    await judgeTowerDarts(page, 'miss', 3);
    await towerClickByName(page, 'やめる');
    await towerClick(page, '.tower-panel.end button');
    await expect(page.locator('.tower-turn-line')).toContainText('AKI');
    await expect(floorBadge(page)).toContainText('4');

    await judgeTowerDarts(page, 'miss', 3);
    await towerClickByName(page, 'やめる');
    await towerClick(page, '.tower-panel.end button');

    await expect(page.locator('.tower-result-card')).toHaveCount(2);
    await expect(page.locator('.tower-result-card').first()).toContainText('AKI');
    await expect(page.locator('.tower-result-card').nth(1)).toContainText('BEN');
  });
});

test.describe('TOWER keyboard', () => {
  test('1 judges 成功, 2 judges MISS, Backspace undoes, Enter advances', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);

    const pressAfterGap = async (key: string) => {
      await page.waitForTimeout(TOWER_INPUT_GAP_MS);
      await page.keyboard.press(key);
    };

    await pressAfterGap('1');
    await expect(floorBadge(page)).toContainText('2');
    await pressAfterGap('2');
    expect(await lifeOf(page)).toBe(2);
    await pressAfterGap('1');
    await expect(page.locator('.tower-panel.pickup')).toBeVisible();

    await pressAfterGap('Enter');
    await expect(page.locator('.tower-judge.hit')).toBeVisible();

    await pressAfterGap('Backspace');
    await expect(floorBadge(page)).toContainText('2');
  });

  test('never spends a dart on a held key', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await page.keyboard.down('1');
    await page.waitForTimeout(600);
    await page.keyboard.up('1');
    await expect(page.locator('.tower-pip.done')).toHaveCount(1);
    await expect(floorBadge(page)).toContainText('2');
  });

  test('never spends a dart on a double click', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await page.locator('.tower-judge.hit').dblclick();
    await expect(page.locator('.tower-pip.done')).toHaveCount(1);
    await expect(floorBadge(page)).toContainText('2');
  });

  test('leaves the name field alone on the setup screen', async ({ page }) => {
    await openFreshApp(page);
    await openPracticeHub(page);
    await page.locator('.practice-card[data-practice="tower"]').click();
    const input = page.locator('.name-input input').first();
    await input.fill('');
    await input.type('12');
    await expect(input).toHaveValue('12');
  });
});

test.describe('TOWER layout', () => {
  test('keeps the board, the dart pips and both judgement buttons usable at once', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);

    for (const selector of ['.tower-board-main', '.tower-turn-pips', '.tower-judge.hit', '.tower-judge.miss']) {
      await expect(page.locator(selector)).toBeInViewport();
    }
    expect(await hasHorizontalScroll(page)).toBe(false);

    // The judgement buttons are big, and are not on top of one another.
    const hit = await page.locator('.tower-judge.hit').boundingBox();
    const miss = await page.locator('.tower-judge.miss').boundingBox();
    expect(hit && hit.height).toBeGreaterThanOrEqual(56);
    expect(miss && miss.height).toBeGreaterThanOrEqual(56);
    expect(hit && miss && hit.x + hit.width).toBeLessThanOrEqual(miss!.x);
  });

  test('keeps the buttons on screen without scrolling after a dart', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTower(page, 'miss');
    await expect(page.locator('.tower-judge.hit')).toBeInViewport();
    await expect(page.locator('.tower-judge.miss')).toBeInViewport();
    await expect(lifeLabel(page)).toBeVisible();
  });
});

/**
 * Smartphone landscape - the tightest layout the app has, and the one where a footer stacked under
 * the board would leave the judgement buttons off screen. TOWER answers it the way COUNT-UP and 01
 * do: the controls become a rail down the right. Its own viewport rather than another project, so
 * the check rides along with the rest of this file.
 */
test.describe('TOWER in smartphone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('keeps the board and both judgement buttons on screen, with no scrolling', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);

    for (const selector of [
      '.tower-board-main',
      '.tower-turn-pips',
      '.tower-status-card',
      '.tower-judge.hit',
      '.tower-judge.miss',
    ]) {
      await expect(page.locator(selector).first(), `${selector} is off screen`).toBeInViewport();
    }
    expect(await hasHorizontalScroll(page)).toBe(false);

    // The board and the controls sit side by side rather than overlapping.
    const board = await page.locator('.tower-board-main').boundingBox();
    const footer = await page.locator('.tower-footer').boundingBox();
    expect(board && footer && board.x + board.width).toBeLessThanOrEqual(footer!.x + 1);
  });

  test('plays a dart, a pickup and a CONTINUE without the controls moving off screen', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    // Raw judgements, so the turn is left standing on the pickup screen rather than taken past it.
    await judgeTower(page, 'hit');
    await judgeTower(page, 'hit');
    await judgeTower(page, 'hit');
    await expect(page.locator('.tower-panel.pickup button')).toBeInViewport();
    await towerClick(page, '.tower-panel.pickup button');

    await judgeTowerDarts(page, 'miss', 3);
    await expect(page.getByRole('button', { name: 'CONTINUE する' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'やめる' })).toBeInViewport();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

/**
 * The regression half: TOWER is additive, and this is where that is actually proved rather than
 * asserted. Each test plays TOWER and then goes and uses something else.
 */
test.describe('TOWER leaves the rest of n02 alone', () => {
  test('writes only its own storage keys', async ({ page }) => {
    await openFreshApp(page);
    await page.evaluate((keys) => {
      for (const [key, value] of Object.entries(keys)) localStorage.setItem(key, value);
    }, FOREIGN_KEYS);

    await startTower(page, { names: ['AKI'] });
    await judgeTowerDarts(page, 'hit', 2);
    await judgeTowerDarts(page, 'miss', 3);
    await towerClickByName(page, 'やめる');
    await towerClick(page, '.tower-panel.end button');
    await expect(page.locator('.tower-result')).toBeVisible();

    // ...and again through a replay, a dart and an undo, which are the other three ways TOWER
    // writes anything at all.
    await page.getByRole('button', { name: /同じ設定でもう一度/ }).click();
    await expect(page.locator('.tower-shell')).toBeVisible();
    await judgeTowerDarts(page, 'hit', 1);
    await towerClick(page, '.tower-menu button:has-text("1投戻す")');
    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    // The undo left nothing to lose, so leaving does not stop to confirm.
    const confirm = page.getByRole('button', { name: /終了して PRACTICE へ/ });
    if (await confirm.isVisible()) await confirm.click();
    await expect(page.locator('.practice-card[data-practice="tower"]')).toBeVisible();

    const after = await page.evaluate(
      (keys) => Object.fromEntries(Object.keys(keys).map((key) => [key, localStorage.getItem(key)])),
      FOREIGN_KEYS,
    );
    expect(after).toEqual(FOREIGN_KEYS);

    // ...and TOWER's own key is the only new one.
    const towerKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.includes('tower')).sort(),
    );
    expect(towerKeys).toEqual(['n02-practice-tower-history-v1', 'n02-practice-tower-help-v1'].sort());
  });

  test('does not persist a climb in progress, and a reload does not resume one', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTowerDarts(page, 'hit', 4);
    await expect(floorBadge(page)).toContainText('5');

    await page.reload();
    // Back at the top menu, with nothing of the climb kept and no dart double-counted anywhere.
    await expect(page.locator('.mode-card[data-mode="practice"]')).toBeVisible();
    const history = await page.evaluate(() => localStorage.getItem('n02-practice-tower-history-v1'));
    expect(history).toBeNull();
  });

  test('hands the keyboard back to COUNT-UP afterwards', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTowerDarts(page, 'hit', 2);
    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await page.getByRole('button', { name: /終了して PRACTICE へ/ }).click();
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();

    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    await expect(page.locator('.countup-shell')).toBeVisible();

    // COUNT-UP's own digits, Enter and U still do exactly what they did.
    await enterCountUpRound(page, 121);
    await expect(page.locator('.countup-total-value').first()).toContainText('121');
    await page.keyboard.press('u');
    await expect(page.locator('.countup-total-value').first()).toContainText('0');
  });

  test('hands the keyboard back to 01 afterwards', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTowerDarts(page, 'hit', 2);
    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await page.getByRole('button', { name: /終了して PRACTICE へ/ }).click();
    await page.getByRole('button', { name: 'メニューへ戻る' }).click();
    await expect(page.locator('.mode-card').first()).toBeVisible();

    // 通常01 is the first card on the top menu and starts from its own setup screen.
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();

    // 01 scores on typed digits + Enter; TOWER's 1 / 2 must not have been left bound to anything.
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-game-shell')).toContainText('401');
  });

  test('leaves COUNT-UP looking exactly as it did', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page);
    const before = await page.locator('.countup-shell').screenshot();

    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    await page.getByRole('button', { name: 'メニューへ戻る' }).click();
    await openPracticeHub(page);
    await page.locator('.practice-card[data-practice="tower"]').click();
    await page.getByRole('button', { name: /TOWER を開始/ }).click();
    const help = page.getByRole('button', { name: 'はじめる' });
    if (await help.isVisible()) await help.click();
    await judgeTowerDarts(page, 'hit', 2);
    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await page.getByRole('button', { name: /終了して PRACTICE へ/ }).click();

    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    await expect(page.locator('.countup-shell')).toBeVisible();
    // TOWER's stylesheet is loaded the whole time; if any rule of it reached COUNT-UP, this differs.
    expect(await page.locator('.countup-shell').screenshot()).toEqual(before);
  });

  test('never renders a TOWER element outside TOWER', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page);
    expect(await page.locator('[class*="tower-"]').count()).toBe(0);
    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    expect(await page.locator('[class*="tower-"]').count()).toBe(0);
  });
});
