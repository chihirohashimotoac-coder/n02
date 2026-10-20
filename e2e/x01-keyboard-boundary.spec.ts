import { expect, test, type Page } from '@playwright/test';
import { confirmFinish, enterGameScore, enterPentScore, openFreshApp, openPentathlon, openSingleGame } from './helpers';

/**
 * Where a keystroke stops on 通常01・チェックアウト練習・ペンタスロン X01: IME, held keys and
 * Ctrl/Meta/Alt chords never act; the score sheet's read-only entry box belongs to the game; and a
 * dialog's keys never reach the game behind it. The key MAP itself is pinned by regression-x01 and
 * pentathlon-x01-keyboard, and is unchanged.
 *
 * IME keystrokes here are synthetic (isComposing / keyCode 229 dispatched from the page). That
 * proves the app ignores what a browser reports during a conversion; it is not a real IME run.
 */

const remaining = (page: Page) => page.locator('.n01-left-table strong').first();
const liveCell = (page: Page) => page.locator('.n01-score-table td.scored.current input');
const dialog = (page: Page) => page.locator('[role="dialog"]');

/** Dispatches a keydown at the focused element the way a browser reports one during IME input. */
async function imeKey(page: Page, key: string, how: 'isComposing' | 'keyCode229') {
  await page.evaluate(
    ([k, mode]) => {
      const event = new KeyboardEvent('keydown', {
        key: k,
        bubbles: true,
        cancelable: true,
        isComposing: mode === 'isComposing',
      });
      if (mode === 'keyCode229') Object.defineProperty(event, 'keyCode', { get: () => 229 });
      (document.activeElement ?? document.body).dispatchEvent(event);
    },
    [key, how] as const,
  );
}

const storageSnapshot = (page: Page) =>
  page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));

async function start01(page: Page) {
  await openFreshApp(page);
  await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
  await page.getByRole('button', { name: /ゲームを開始/ }).click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();
}

async function startPent501(page: Page) {
  await openFreshApp(page);
  await openSingleGame(page, 'n01 501');
  await page.locator('select').first().selectOption('1');
  await page.getByRole('button', { name: /を開始/ }).click();
  await expect(page.locator('.pent-x01-shell')).toBeVisible();
}

const COMMAND_CHORDS = ['Control', 'Alt', 'Meta'].flatMap((modifier) =>
  ['n', 's', 'f', 'u', 'r', 'm', '1', 'Enter'].map((key) => `${modifier}+${key}`),
);

test.describe('通常01・チェックアウト練習', () => {
  test('Shift+Enter / Shift+Tab も確定し、大文字 F も Finish になる', async ({ page }) => {
    await start01(page);
    await page.keyboard.type('60');
    await page.keyboard.press('Shift+Enter');
    await expect(remaining(page)).toHaveText('441');
    await page.keyboard.type('41'); // P2
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('60');
    await page.keyboard.press('Shift+Tab');
    await expect(remaining(page)).toHaveText('381');

    await page.keyboard.press('Shift+F');
    await expect(page.locator('.n01-notice')).toContainText('上がれない数字');
  });

  test('チェックアウト固定41で 9 → Enter は残り32', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByLabel('出題下限').fill('41');
    await page.getByLabel('出題上限').fill('41');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await page.keyboard.type('9');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('32');
  });

  test('現在得点の入力欄をクリックしても数字・Enter・Tab が効く', async ({ page }) => {
    await start01(page);
    await liveCell(page).click();
    await page.keyboard.type('60');
    await expect(liveCell(page)).toHaveValue('60');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('441');

    await liveCell(page).click(); // P2
    await page.keyboard.type('45');
    await page.keyboard.press('Tab');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('456');
  });

  test('Ctrl / Alt / Meta 付きのキーはゲームを操作しない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 100);
    await page.keyboard.type('5');
    const before = await storageSnapshot(page);

    for (const chord of COMMAND_CHORDS) await page.keyboard.press(chord);

    await expect(page.locator('.n01-game-shell')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('401');
    await expect(liveCell(page)).toHaveValue('5');
    await expect(page.locator('.n01-score-table td.scored button.selected')).toHaveCount(0);
    expect(await storageSnapshot(page)).toBe(before);
  });

  test('メニューの U は「直前の入力を戻す」ボタンと同じ結果になる', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 100);
    await enterGameScore(page, 100);
    await expect(remaining(page)).toHaveText('401');

    await page.keyboard.press('m');
    await page.keyboard.press('u');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.n01-notice')).toHaveText('直前の入力を取り消しました。');
    await expect(remaining(page)).toHaveText('401');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('501');

    // The button, for comparison: the same undo, the same notice.
    await page.keyboard.press('m');
    await page.getByRole('button', { name: /直前の入力を戻す/ }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.n01-notice')).toHaveText('直前の入力を取り消しました。');
    await expect(remaining(page)).toHaveText('501');

    // Typing goes on to the keypad afterwards.
    await page.keyboard.type('60');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('441');
  });

  test('取り消すものがないとメニューの U は何もしない', async ({ page }) => {
    await start01(page);
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: /直前の入力を戻す/ })).toBeDisabled();
    await page.keyboard.press('u');
    await expect(dialog(page)).toContainText('メニュー');
    await expect(page.locator('.n01-notice')).toHaveCount(0);
  });

  test('長押しの U / Enter は1回分しか動かない', async ({ page }) => {
    await start01(page);
    // P1 100, P2 100, P1 100 -> P1 301, P2 401.
    for (const score of [100, 100, 100]) await enterGameScore(page, score);
    await expect(remaining(page)).toHaveText('301');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('401');

    await page.keyboard.press('m');
    await page.keyboard.down('u');
    await page.keyboard.down('u'); // auto-repeat
    await page.keyboard.up('u');
    await expect(remaining(page)).toHaveText('401');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('401');

    // A held Enter on the focused UNDO button: one native click, one undo (P2's visit).
    await page.keyboard.press('m');
    await page.getByRole('button', { name: /直前の入力を戻す/ }).focus();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(remaining(page)).toHaveText('401');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('501');
  });

  test('修飾付きの Enter / Space ではフォーカス中のボタンが押されない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 100);
    await enterGameScore(page, 100);
    await page.keyboard.press('m');
    const undo = page.getByRole('button', { name: /直前の入力を戻す/ });
    await undo.focus();
    for (const chord of ['Control+Space', 'Alt+Space', 'Meta+Space', 'Control+Enter', 'Alt+Enter']) {
      await page.keyboard.press(chord);
    }
    await expect(dialog(page)).toContainText('メニュー');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('401');

    // A plain Space is still the button's own click.
    await page.keyboard.press('Space');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('501');
  });

  test('IME 変換中・修飾付きのキーはダイアログを操作しない', async ({ page }) => {
    await start01(page);
    await page.keyboard.press('m');
    await imeKey(page, '1', 'isComposing');
    await imeKey(page, '4', 'keyCode229');
    await imeKey(page, 'Escape', 'isComposing');
    await page.keyboard.press('Control+1');
    await page.keyboard.press('Control+a');
    await expect(dialog(page)).toContainText('メニュー');
    await expect(page.getByRole('button', { name: /アワード表示/ })).toContainText('ON');
    await page.keyboard.press('Escape');
    await expect(page.locator('.n01-game-meta strong')).toContainText('得点入力');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 1');

    // Finish dialog and Leg result: P1 on a 1-dart-finishable 40, and P1 to throw.
    for (const score of [180, 0, 180, 0, 101, 0]) await enterGameScore(page, score);
    await expect(remaining(page)).toHaveText('40');
    await page.keyboard.press('f');
    await imeKey(page, '1', 'keyCode229');
    await page.keyboard.press('Alt+1');
    await expect(dialog(page)).toContainText('上がり本数');
    await page.keyboard.press('1');
    await expect(dialog(page)).toContainText('WINNER');
    await imeKey(page, 'Enter', 'isComposing');
    await imeKey(page, 'Escape', 'keyCode229');
    await expect(dialog(page)).toContainText('WINNER');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
  });

  test('ダイアログ内の Tab は背後の得点を確定しない', async ({ page }) => {
    await start01(page);
    await page.keyboard.type('60');
    await page.keyboard.press('m');
    // A click on the card's heading focuses the card itself (tabIndex -1).
    await dialog(page).locator('h2').click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(remaining(page)).toHaveText('501');
    await expect(liveCell(page)).toHaveValue('60');
  });

  test('修正欄は Ctrl+A が使え、Ctrl+Enter では確定せず Enter で確定する', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 60);
    await page.locator('.n01-score-table td.scored button').first().click();
    const field = dialog(page).locator('input[type="number"]');
    await expect(field).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('45');
    await expect(field).toHaveValue('45');
    await page.keyboard.press('Control+Enter');
    await expect(dialog(page)).toContainText('過去得点を修正');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('456');
  });

  test('セルを押して開いた修正欄は、打った数字が元の得点を置き換える', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 12); // P1 -> 489
    await page.locator('.n01-score-table td.scored button').first().click();
    const field = dialog(page).locator('input[type="number"]');
    await expect(field).toBeFocused();
    await page.keyboard.type('45');
    await expect(field).toHaveValue('45');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('456');

    // Opened by typing over a parked cell, the typed digit stays the first one.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('6');
    await expect(field).toHaveValue('6');
    await page.keyboard.type('0');
    await expect(field).toHaveValue('60');
  });

  test('修正の失敗・取消・Undo のあとも次の得点が正しいプレイヤーに入る', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 60); // P1 -> 441
    await enterGameScore(page, 50); // P2 -> 451

    await page.locator('.n01-score-table td.scored button').first().click();
    const field = dialog(page).locator('input[type="number"]');
    await field.fill('181');
    await page.keyboard.press('Enter');
    await expect(dialog(page).getByRole('alert')).toBeVisible(); // refused, dialog stays
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);

    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('421');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('451');

    await page.keyboard.press('u');
    await expect(remaining(page)).toHaveText('441');
    await page.keyboard.type('30');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('411');
  });
});

test.describe('ペンタスロン X01', () => {
  test('現在得点の入力欄をクリックしても数字・Enter・Tab が効く', async ({ page }) => {
    await startPent501(page);
    await liveCell(page).click();
    await page.keyboard.type('60');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('441');
    await liveCell(page).click();
    await page.keyboard.type('41');
    await page.keyboard.press('Tab');
    await expect(remaining(page)).toHaveText('400');
  });

  test('Ctrl / Alt / Meta 付きのキーはゲームを操作しない', async ({ page }) => {
    await startPent501(page);
    await enterPentScore(page, 100);
    await page.keyboard.type('5');
    const before = await storageSnapshot(page);

    for (const chord of COMMAND_CHORDS) await page.keyboard.press(chord);

    await expect(page.locator('.pent-x01-shell')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('401');
    await expect(liveCell(page)).toHaveValue('5');
    expect(await storageSnapshot(page)).toBe(before);
  });

  test('R で開いた修正欄は、打った数字が元の得点を置き換える', async ({ page }) => {
    await startPent501(page);
    await enterPentScore(page, 12);
    await page.keyboard.press('r');
    const field = dialog(page).locator('input[type="number"]');
    await expect(field).toHaveValue('12');
    await page.keyboard.type('45');
    await expect(field).toHaveValue('45');
    await page.keyboard.press('Enter');
    await expect(remaining(page)).toHaveText('456');
  });

  test('メニューは 1 が Undo のまま、U は割り当てなし', async ({ page }) => {
    await startPent501(page);
    await enterPentScore(page, 100);
    await page.keyboard.press('m');
    await page.keyboard.press('u');
    await expect(dialog(page)).toContainText('メニュー');
    await expect(remaining(page)).toHaveText('401');
    await page.keyboard.press('1');
    await expect(dialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('501');
  });

  test('IME 変換中・修飾付きのキーで上がり本数を確定しない', async ({ page }) => {
    await startPent501(page);
    for (const step of [100, 100, 100, 100, 61]) await enterPentScore(page, step);
    await page.keyboard.press('f');
    await imeKey(page, '1', 'keyCode229');
    await imeKey(page, '2', 'isComposing');
    await imeKey(page, 'Escape', 'isComposing');
    await page.keyboard.press('Control+1');
    await expect(dialog(page)).toContainText('上がり本数');
    await expect(page.locator('.pent-x01-shell')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.locator('.pent-x01-shell')).toHaveCount(0);
  });

  test('種目結果は IME の Enter・Ctrl+Enter では進まず、Enter で進む', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    for (const score of [180, 26, 180, 26, 141]) await enterPentScore(page, score);
    await confirmFinish(page);
    await expect(page.getByText('DISCIPLINE COMPLETE')).toBeVisible();

    await imeKey(page, 'Enter', 'isComposing');
    await imeKey(page, 'Enter', 'keyCode229');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('DISCIPLINE COMPLETE')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByText('DISCIPLINE COMPLETE')).toHaveCount(0);
  });
});
