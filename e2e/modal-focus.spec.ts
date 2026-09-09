import { expect, test, type Page } from '@playwright/test';
import { enterCountUpRound, enterGameScore, openFreshApp, startCountUp } from './helpers';

/**
 * The keyboard and focus contract every dialog owes its user, checked on the screens that did not
 * have it before: 通常01, チェックアウト練習 and COUNT-UP.
 *
 * Pentathlon's equivalents are covered in pentathlon-single.spec.ts and are unchanged; the three
 * screens here now share the same implementation (components/common/useDialogFocus.ts).
 */

/** Is focus inside the open dialog card? */
const focusInsideDialog = (page: Page, cardSelector: string) =>
  page.evaluate(
    (sel) => document.querySelector(sel)?.contains(document.activeElement) ?? false,
    cardSelector,
  );

async function start01(page: Page) {
  await openFreshApp(page);
  await page.getByRole('button', { name: /ゲームを開始/ }).click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();
}

test.describe('通常01・チェックアウト練習のダイアログ', () => {
  test('☰ メニューは開くとフォーカスを受け取り、Escapeで閉じて元のボタンへ返す', async ({ page }) => {
    await start01(page);

    const trigger = page.locator('.n01-menu-table button', { hasText: '☰' });
    await trigger.click();
    await expect(page.locator('.n01-modal-card')).toBeVisible();
    expect(await focusInsideDialog(page, '.n01-modal-card')).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);
    // Focus lands on the score sheet, not on <body> and not back on the ☰ button: this screen
    // leaves a focused button its native Enter activation, so parking focus on ☰ would turn the
    // next Enter - the key that commits a score - into "open the menu again".
    await expect(page.locator('.n01-score-scroll')).toBeFocused();

    // Which is to say: typing still confirms a visit straight after closing a dialog.
    await enterGameScore(page, 60);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('441');
  });

  test('Tab / Shift+Tab はメニュー内を循環し、背後のゲームへ抜けない', async ({ page }) => {
    await start01(page);
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await expect(page.locator('.n01-modal-card')).toBeVisible();

    // Forward well past the number of controls in the card, then backwards the same way.
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusInsideDialog(page, '.n01-modal-card')).toBe(true);
    }
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusInsideDialog(page, '.n01-modal-card')).toBe(true);
    }
  });

  test('ダイアログ表示中のキーは背後のゲームを操作しない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 60);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('441');

    await page.locator('.n01-menu-table button', { hasText: 'Stats' }).click();
    await expect(page.locator('.n01-stats-modal')).toBeVisible();

    // Digits must not queue into the keypad behind the dialog, and U must not undo the 60.
    await page.keyboard.type('99');
    await page.keyboard.press('u');
    await expect(page.locator('.n01-stats-modal')).toBeVisible();

    // Enter activates the dialog's own focused 閉じる button (as it does in Pentathlon) - and only
    // that: it must not also commit a visit behind the dialog.
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-stats-modal')).toHaveCount(0);
    // The 60 is still the only visit, and nothing was typed behind the dialog.
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('441');
    await expect(page.locator('.n01-score-table td.scored.current input')).toHaveValue('');
  });

  test('過去得点の修正ダイアログはEnterで確定でき、入力欄がフォーカスを保つ', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 60);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('441');

    await page.locator('.n01-score-table td.scored button').first().click();
    const field = page.locator('.n01-modal-card input[type="number"]');
    await expect(field).toBeFocused();

    await field.fill('100');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
  });

  test('上がり本数ダイアログは数字キーを受け取り、Escapeで取り消せる', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await enterGameScore(page, 180);
    await enterGameScore(page, 0);
    await enterGameScore(page, 180);
    await enterGameScore(page, 0);
    // 141 left, and 141 is a real 3-dart finish - so this opens the 上がり本数 dialog.
    await enterGameScore(page, 141);
    await expect(page.locator('.n01-modal-card')).toContainText('上がり本数');
    expect(await focusInsideDialog(page, '.n01-modal-card')).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);
    // Cancelled, so the leg is still live on 141.
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');
  });

  test('Leg結果ダイアログはフォーカスを受け取り、Escapeで上がり宣告をやり直せる', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await enterGameScore(page, 180);
    await enterGameScore(page, 0);
    await enterGameScore(page, 180);
    await enterGameScore(page, 0);
    await enterGameScore(page, 141);
    await page.locator('.n01-modal-card button', { hasText: /本目で終了/ }).first().click();

    await expect(page.locator('.result-card')).toContainText('LEG 1 WINNER');
    expect(await focusInsideDialog(page, '.result-card')).toBe(true);

    // ESC is what the card itself promises: un-finish the leg to re-declare the checkout.
    await page.keyboard.press('Escape');
    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');
  });
});

test.describe('COUNT-UPのダイアログ', () => {
  test('☰ メニューはフォーカスを受け取り、Escapeで閉じて元のボタンへ返す', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, {});

    await page.locator('.countup-menu button', { hasText: '☰' }).click();
    await expect(page.locator('.countup-modal-card')).toBeVisible();
    expect(await focusInsideDialog(page, '.countup-modal-card')).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.countup-modal-card')).toHaveCount(0);
    // The score sheet, for the same reason 01 does it: the next Enter has to confirm a round, not
    // re-open the menu it just closed.
    await expect(page.locator('.countup-board')).toBeFocused();

    await enterCountUpRound(page, 60);
    await expect(page.locator('.countup-total-value').first()).toContainText('60');
  });

  test('Tab はメニュー内を循環する', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, {});
    await page.locator('.countup-menu button', { hasText: '☰' }).click();
    await expect(page.locator('.countup-modal-card')).toBeVisible();

    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusInsideDialog(page, '.countup-modal-card')).toBe(true);
    }
  });

  test('ダイアログ表示中のキーは得点シートへ漏れない', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, {});

    await page.locator('.countup-menu button', { hasText: '☰' }).click();
    await expect(page.locator('.countup-modal-card')).toBeVisible();
    await page.keyboard.type('99');
    await page.keyboard.press('Escape');

    await expect(page.locator('.countup-modal-card')).toHaveCount(0);
    await expect(page.locator('.countup-table td.entry .countup-cell-entry')).toHaveText('–');
  });

  test('ラウンド得点の修正ダイアログはEnterで確定でき、入力欄がフォーカスを保つ', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page, {});
    await enterCountUpRound(page, 60);
    await expect(page.locator('.countup-total-value')).toContainText('60');

    await page.locator('.countup-table td.scored button').first().click();
    const field = page.locator('.countup-modal-card input[type="number"]');
    await expect(field).toBeFocused();

    await field.fill('100');
    await page.keyboard.press('Enter');
    await expect(page.locator('.countup-modal-card')).toHaveCount(0);
    await expect(page.locator('.countup-total-value')).toContainText('100');
  });
});
