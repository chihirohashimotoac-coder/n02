import type { Page } from '@playwright/test';

/**
 * Enters a visit score on the 01/Checkout game screen. The on-screen keypad exists on narrow and
 * touch-first viewports (desktop keyboard users type instead), so this drives whichever input the
 * current device actually offers.
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
 * Enters a Cricket turn on the board (which is itself the keypad) and confirms it. Darts that
 * scored nothing are simply not entered, so `hits` may be empty for a turn where nothing landed.
 * Hit notation: 'S20' | 'D16' | 'T19' | 'BULL' (inner) | '25' (outer bull).
 */
export async function enterPentHits(page: Page, hits: string[]) {
  for (const hit of hits) {
    // A dart that scored nothing is simply not entered on this board.
    if (hit === 'MISS') continue;
    if (hit === 'BULL') await tapCricket(page, 'ダブルブル');
    else if (hit === '25') await tapCricket(page, 'アウターブル');
    else {
      const ring = hit[0] === 'T' ? 'トリプル' : hit[0] === 'D' ? 'ダブル' : 'シングル';
      await tapCricket(page, `${ring}${hit.slice(1)}`);
    }
  }
  await page.getByRole('button', { name: '確定' }).click();
}

/** Taps one button of the Cricket board by its accessible name, e.g. 'トリプル20' / 'ダブルブル'. */
export async function tapCricket(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}

/**
 * Taps one button in the Cork/Golf/Half-It/RTC-on-Doubles "quick target" pad by its exact visible
 * label (e.g. 'インナーブル', 'アウターブル', 'ミス', 'シングル3', 'ダブル3', 'トリプル3', '成功（D7）').
 * Does not commit the turn - call commitPentTurn() once all darts for the turn are staged.
 */
export async function tapQuickTarget(page: Page, label: string) {
  await page.locator('.pent-quick-btn', { hasText: new RegExp(`^${label}$`) }).click();
}

/** Half-It's "any double"/"any triple" rounds: taps a specific landed-on number, or 'MISS'. */
export async function tapAnyRingNumber(page: Page, value: number | 'MISS') {
  if (value === 'MISS') {
    await page.locator('.pent-number-grid button.wide', { hasText: 'ミス' }).click();
  } else {
    await page
      .locator('.pent-number-grid button', { hasText: new RegExp(`^${value}$`) })
      .first()
      .click();
  }
}

/** Commits the currently staged dart hits as the active player's turn. */
export async function commitPentTurn(page: Page) {
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
  // By data-mode: the menu also carries a 「ペンタスロン個別練習」 card whose label contains this one's.
  await page.locator('.mode-card[data-mode="pentathlon"]').click();
  await page.waitForSelector('.pent-preset-card');
}

/** Opens the 個別練習 menu and selects one discipline by its exact card label (e.g. 'n01 301'). */
export async function openSingleGame(page: Page, label: string) {
  await page.locator('.mode-card[data-mode="pentathlon-single"]').click();
  await page.waitForSelector('.pent-single-card');
  await page.locator('.pent-single-card', { hasText: new RegExp(`^${label}`) }).first().click();
}

/**
 * Opens the in-game ☰ menu, which is where every Pentathlon play screen keeps the controls that
 * aren't needed to throw a dart (round undo, rules, quit) so the screen itself fits one viewport.
 */
export async function openPentGameMenu(page: Page) {
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.waitForSelector('.pent-modal-card');
}

/** Opens the in-game rule explanation, which lives one level inside the ☰ menu. */
export async function openPentRules(page: Page) {
  await openPentGameMenu(page);
  await page.getByRole('button', { name: 'ルール説明' }).click();
}

/** Taps one of Baseball's four per-dart outcome buttons ('シングル' | 'ダブル' | 'トリプル' | 'ミス'). */
export async function tapBaseballOutcome(page: Page, label: string) {
  await page.locator('.pent-quick-btn', { hasText: new RegExp(`^${label}`) }).click();
}

/**
 * Opens the PRACTICE hub from the top menu. `data-mode` rather than the label, so this can never
 * pick up one of the Pentathlon cards.
 */
export async function openPracticeHub(page: Page) {
  await page.locator('.mode-card[data-mode="practice"]').click();
  await page.waitForSelector('.practice-card');
}

/** Opens PRACTICE → COUNT-UP and starts a game with the given options. */
export async function startCountUp(
  page: Page,
  options: { players?: 1 | 2; bull?: 'separate' | 'fat'; names?: string[] } = {},
) {
  await openPracticeHub(page);
  await page.locator('.practice-card[data-practice="count-up"]').click();
  await page.waitForSelector('.countup-setup');
  if (options.players === 2) await page.getByRole('button', { name: /2 PLAYERS/ }).click();
  if (options.bull === 'fat') await page.getByRole('button', { name: /FAT BULL/ }).click();
  for (const [index, name] of (options.names ?? []).entries()) {
    await page.locator('.name-input input').nth(index).fill(name);
  }
  await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
  await page.waitForSelector('.countup-shell');
}

/**
 * Does this device get an on-screen keypad? Narrow screens and wide touch-first screens do; a
 * mouse/keyboard desktop types instead. Mirrors the CSS capability test used by 01 and COUNT-UP.
 */
export const keypadExpected = (page: Page) =>
  page.evaluate(
    () => window.innerWidth <= 720 || window.matchMedia('(hover: none) and (pointer: coarse)').matches,
  );

/**
 * Enters one COUNT-UP round total by whichever input route the current device actually offers:
 * its own on-screen keypad where that exists, the physical keyboard otherwise.
 */
export async function enterCountUpRound(page: Page, score: number | string) {
  if (!(await page.locator('.countup-keypad').isVisible())) {
    // A button left focused by an earlier click would swallow Enter as its own activation.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.type(String(score));
    await page.keyboard.press('Enter');
    return;
  }
  for (const char of String(score)) {
    await page.locator('.countup-keypad button', { hasText: new RegExp(`^${char}$`) }).first().click();
  }
  await page.locator('.countup-keypad button.enter').click();
}
