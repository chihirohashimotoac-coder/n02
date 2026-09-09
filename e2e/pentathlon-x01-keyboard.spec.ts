import { expect, test, type Page } from '@playwright/test';
import { enterPentScore, openFreshApp, openSingleGame } from './helpers';

/**
 * The PC keyboard on Pentathlon's 301/501, which must be the same keyboard 通常01・チェックアウト練習
 * answer to. Those two screens read from a completely different engine and are deliberately left
 * untouched; this file pins the parity from the Pentathlon side.
 *
 * The one key with no counterpart here is 通常01's <kbd>+</kbd> / <kbd>-</kbd> 使用ダーツ: a
 * Pentathlon X01 attempt is SCORED in darts, so declaring fewer would change who wins the
 * discipline rather than adjust a statistic. The checkout, the one visit where the count is real,
 * asks for it in its own dialog. See the 使用ダーツ test at the bottom.
 */

const cell = (page: Page) => page.locator('.n01-score-table td.scored button.selected');
const remaining = (page: Page) => page.locator('.n01-left-table strong').first();
const liveCell = (page: Page) => page.locator('.n01-score-table td.scored.current input');
const modal = (page: Page) => page.locator('.pent-modal-card');

/** A 1-player 個別練習 of n01 501 - the shortest route to the X01 score sheet. */
async function start501(page: Page, playerCount: 1 | 2 = 1) {
  await openFreshApp(page);
  await openSingleGame(page, 'n01 501');
  await page.locator('select').first().selectOption(String(playerCount));
  await page.getByRole('button', { name: /を開始/ }).click();
  await expect(page.locator('.pent-x01-shell')).toBeVisible();
}

test.describe('ペンタスロン X01 のキーボード操作（通常01と同一）', () => {
  test('Tab も Enter と同じく得点を確定する', async ({ page }) => {
    await start501(page);
    await page.keyboard.type('60');
    await page.keyboard.press('Tab');
    await expect(remaining(page)).toHaveText('441');
  });

  test('Delete も BackSpace と同じく1文字削除する', async ({ page }) => {
    await start501(page);
    await page.keyboard.type('123');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('491'); // 10
  });

  test('F で Finish、M でメニュー、S で Stats が開く', async ({ page }) => {
    await start501(page);
    // F mirrors the Finish button exactly: from 501 there is nothing to declare, so it warns.
    await page.keyboard.press('f');
    await expect(page.locator('.n01-notice')).toContainText('上がれない数字');
    await expect(modal(page)).toHaveCount(0);

    await page.keyboard.press('m');
    await expect(modal(page)).toContainText('メニュー');
    await page.keyboard.press('Backspace'); // BackSpace also closes a dialog
    await expect(modal(page)).toHaveCount(0);

    await page.keyboard.press('s');
    await expect(modal(page)).toContainText('成績');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
  });

  /**
   * 通常01's N abandons the match. Here it is the footer's 中断, which keeps the save - so the
   * session is still offered for resume afterwards.
   */
  test('N で中断してメニューへ戻る（セッションは残る）', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 100);
    await page.keyboard.press('n');
    await expect(page.locator('.mode-card').first()).toBeVisible();

    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();
    await expect(page.getByRole('button', { name: /中断した個別練習を再開/ })).toBeVisible();
  });

  test('U で前の確定ラウンドに戻す（長押しの連射は無視される）', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 100);
    await enterPentScore(page, 100);
    await expect(remaining(page)).toHaveText('301');

    await page.keyboard.press('u');
    await expect(remaining(page)).toHaveText('401');
    // A held key must not unwind the whole attempt: only real presses count.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', repeat: true, bubbles: true }));
    });
    await expect(remaining(page)).toHaveText('401');
  });

  test('矢印で履歴セルを選択し、R で修正ダイアログを開く', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 60); // -> 441
    await enterPentScore(page, 50); // -> 391

    // First arrow press parks on the most recent visit.
    await page.keyboard.press('ArrowUp');
    await expect(cell(page)).toHaveCount(1);
    await expect(cell(page)).toHaveText('50');

    // Up walks back through the rounds.
    await page.keyboard.press('ArrowUp');
    await expect(cell(page)).toHaveText('60');
    await page.keyboard.press('ArrowDown');
    await expect(cell(page)).toHaveText('50');

    await page.keyboard.press('r');
    await expect(modal(page)).toContainText('過去得点を修正');
    await expect(modal(page).locator('input[type="number"]')).toHaveValue('50');
  });

  test('2人対戦では左右で相手のセルへ移動できる', async ({ page }) => {
    await start501(page, 2);
    await enterPentScore(page, 60); // P1 -> 441
    await enterPentScore(page, 50); // P2 -> 451

    await page.keyboard.press('ArrowUp');
    await expect(cell(page)).toHaveText('50'); // most recent = P2's
    await page.keyboard.press('ArrowLeft');
    await expect(cell(page)).toHaveText('60'); // same row, other player
    await page.keyboard.press('ArrowRight');
    await expect(cell(page)).toHaveText('50');
  });

  test('選択中に数字を打つとその値で修正ダイアログが開き、Enter で確定できる', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 100);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('4');
    await expect(modal(page)).toContainText('過去得点を修正');
    await expect(modal(page).locator('input[type="number"]')).toHaveValue('4');

    // The dialog's own Enter commits it - the key that used to do nothing here.
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('456'); // 501 - 45
  });

  /**
   * Entered from the keyboard rather than through the helper, which taps the on-screen keypad on
   * the touch projects. That leaves focus on the Enter BUTTON, and a focused button keeps its own
   * native Enter - the same deliberate rule 通常01 follows, so the two screens still agree.
   */
  test('Enter は選択中セルの修正ダイアログを開く', async ({ page }) => {
    await start501(page);
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('401');

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(modal(page)).toContainText('過去得点を修正');
    await expect(modal(page).locator('input[type="number"]')).toHaveValue('100');
  });

  test('ESC は選択を解除し、その後は入力欄のクリアに戻る', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 100);
    await page.keyboard.press('ArrowUp');
    await expect(cell(page)).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(cell(page)).toHaveCount(0);

    await page.keyboard.type('77');
    await page.keyboard.press('Escape');
    await expect(liveCell(page)).toHaveValue('');
  });

  test('BackSpace も選択を解除する', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 100);
    await page.keyboard.press('ArrowUp');
    await expect(cell(page)).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await expect(cell(page)).toHaveCount(0);
  });

  /** The same fix 通常01 carries: leaving the editor must unpark the cell it parked on. */
  test('修正を確定・キャンセルしたあとも現ラウンドが入力できる', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 60);

    await page.locator('.n01-score-table td.scored button').first().click();
    await modal(page).locator('input[type="number"]').fill('100');
    await page.getByRole('button', { name: '修正して再計算' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('401');

    await enterPentScore(page, 41);
    await expect(modal(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('360');

    await page.locator('.n01-score-table td.scored button').first().click();
    await page.getByRole('button', { name: 'キャンセル' }).click();
    await expect(modal(page)).toHaveCount(0);
    await enterPentScore(page, 60);
    await expect(remaining(page)).toHaveText('300');
  });

  test('メニューは数字キー 1〜3 と A で操作できる', async ({ page }) => {
    await start501(page);
    await enterPentScore(page, 100);

    // 2: rules. Escape from there goes back to the menu it was opened from, as it already did.
    await page.keyboard.press('m');
    await page.keyboard.press('2');
    await expect(modal(page)).toContainText('のルール');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toContainText('メニュー');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);

    // A: the shared award setting.
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: /アワード表示/ })).toContainText('ON');
    await page.keyboard.press('a');
    await expect(modal(page)).toHaveCount(0);
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: /アワード表示/ })).toContainText('OFF');
    await page.keyboard.press('Escape');

    // 1: undo the committed round.
    await page.keyboard.press('m');
    await page.keyboard.press('1');
    await expect(modal(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('501');
  });

  test('メニューの 3 で中断してメニューへ戻る', async ({ page }) => {
    await start501(page);
    await page.keyboard.press('m');
    await page.keyboard.press('3');
    await expect(page.locator('.mode-card').first()).toBeVisible();
  });

  test('上がり本数ダイアログは 1〜3 で選び、BackSpace で戻れる', async ({ page }) => {
    await start501(page);
    // 501 -> 40, which can be finished with one dart (D20).
    for (const step of [100, 100, 100, 100, 61]) await enterPentScore(page, step);
    await expect(remaining(page)).toHaveText('40');

    await page.keyboard.press('f');
    await expect(modal(page)).toContainText('上がり本数');
    await page.keyboard.press('Backspace');
    await expect(modal(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('40');

    await page.keyboard.press('f');
    await page.keyboard.press('1');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator('.pent-x01-shell')).toHaveCount(0); // checkout ends the discipline
  });

  /**
   * Not a gap: the dart count is this discipline's own result metric (getResult ranks by it), so a
   * per-visit override would decide who wins rather than adjust a statistic. Every non-checkout
   * visit is three darts, and the checkout declares its own count.
   */
  test('+ / - は使用ダーツを変えない（本数は種目の成績そのもの）', async ({ page }) => {
    await start501(page);
    await page.keyboard.type('60');
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await page.keyboard.press('Enter');

    await expect(remaining(page)).toHaveText('441');
    await page.keyboard.press('s');
    const darts = modal(page).locator('.n01-stats-row', { hasText: 'DARTS' });
    await expect(darts).toContainText('3');
  });

  /** A focused button keeps its native activation, and must not also drive the keypad behind it. */
  test('ボタンにフォーカスがある Enter は得点を確定しない', async ({ page }) => {
    await start501(page);
    await page.keyboard.type('60');
    await page.getByRole('button', { name: 'メニュー' }).click();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);

    // Focus came back to the score sheet, not to ☰, so Enter commits exactly once.
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('441');
    await expect(modal(page)).toHaveCount(0);
  });
});
