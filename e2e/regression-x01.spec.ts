import { expect, test, type Page } from '@playwright/test';
import { confirmFinish, enterGameScore, openFreshApp } from './helpers';

/** The 先攻/後攻 badge each player's header currently shows. */
async function starterBadges(page: Page) {
  return [
    (await page.locator('.n01-player-name').nth(0).locator('span').innerText()).trim(),
    (await page.locator('.n01-player-name').nth(1).locator('span').innerText()).trim(),
  ];
}

/** True when player 1's header carries the THROW/active highlight. */
async function p0IsThrowing(page: Page) {
  return ((await page.locator('.n01-player-name').nth(0).getAttribute('class')) ?? '').includes('active');
}

/** Plays a 501 leg out so that プレイヤー1 always wins it, whichever player opened. */
async function p0WinsLeg(page: Page) {
  if (!(await p0IsThrowing(page))) await enterGameScore(page, 0); // P2 opens
  await enterGameScore(page, 180);
  await enterGameScore(page, 0);
  await enterGameScore(page, 180);
  await enterGameScore(page, 0);
  await enterGameScore(page, 141);
  await confirmFinish(page);
}

/** Plays a fixed-41 checkout leg so that プレイヤー1 always wins it, whichever player opened. */
async function p0WinsCheckoutLeg(page: Page) {
  if (!(await p0IsThrowing(page))) await enterGameScore(page, 0); // P2 opens
  await enterGameScore(page, 41);
  await confirmFinish(page);
}

/**
 * Regression coverage for the two pre-existing modes. These must keep passing unchanged as
 * Pentathlon evolves.
 */

test.describe('通常01', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
  });

  test('main menu keeps 通常01 and チェックアウト練習 first, with the other modes after', async ({ page }) => {
    const cards = page.locator('.mode-card');
    await expect(cards).toHaveCount(5);
    await expect(cards.nth(0)).toContainText('通常01');
    await expect(cards.nth(1)).toContainText('チェックアウト練習');
    await expect(cards.nth(2)).toContainText('ペンタスロン');
    await expect(cards.nth(3)).toContainText('ペンタスロン個別練習');
    // PRACTICE is appended after the pre-existing modes, so nothing above it moves.
    await expect(cards.nth(4)).toContainText('PRACTICE');
  });

  test('scores, busts, checks out and awards the leg', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();

    await enterGameScore(page, 180); // P1 -> 321
    await enterGameScore(page, 26); // P2 -> 475
    await enterGameScore(page, 180); // P1 -> 141
    await enterGameScore(page, 26); // P2 -> 449
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');

    // Bust: 150 > 141 leaves the score untouched.
    await enterGameScore(page, 150);
    await expect(page.locator('.n01-notice')).toContainText('バスト');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');

    await enterGameScore(page, 26); // P2
    await enterGameScore(page, 141); // P1 declares a finish
    await confirmFinish(page);

    await expect(page.locator('.result-card')).toContainText('LEG 1 WINNER');
    await expect(page.locator('.result-card h2')).toHaveText('プレイヤー1');
  });

  test('leaving 1 is a three-dart bust and hands over the turn', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    for (const score of [180, 0, 180, 0, 109, 0, 31]) await enterGameScore(page, score);

    await expect(page.locator('.n01-notice')).toContainText('バスト');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('32');
    await expect(page.locator('.n01-player-name').nth(1)).toHaveClass(/active/);
    const lastVisit = await page.evaluate(() => {
      const raw = localStorage.getItem('n02-current-v1');
      const visits = raw
        ? (JSON.parse(raw) as { visits: Array<Record<string, unknown>> }).visits
        : [];
      return visits.at(-1);
    });
    expect(lastVisit).toMatchObject({ before: 32, after: 32, darts: 3, bust: true });
  });

  test('has no always-on entry preview and keeps its four-button menu', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-entry-display')).toHaveCount(0);
    await expect(page.locator('.pent-entry-display')).toHaveCount(0);
    await expect(page.locator('.n01-menu-table > button')).toHaveCount(4);
    await expect(page.locator('.n01-menu-table button', { hasText: 'RULES' })).toHaveCount(0);

    // Typing still works without any preview row - Enter is what commits it.
    await page.keyboard.type('45');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('456');
  });

  test('undo reverts the last visit', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await page.getByRole('button', { name: '直前の入力を戻す' }).click();
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('501');
  });

  test('persists the match to localStorage and resumes it', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100);

    const stored = await page.evaluate(() => localStorage.getItem('n02-current-v1'));
    expect(stored).toBeTruthy();
    // The legacy storage contract must not change shape.
    const parsed = JSON.parse(stored!);
    expect(Object.keys(parsed)).toEqual(
      expect.arrayContaining(['players', 'active', 'leg', 'settings', 'visits', 'undo', 'matchWinner']),
    );

    await page.reload();
    await page.getByRole('button', { name: /保存した対戦を再開/ }).click();
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
  });

  test('past scores can be edited and later rounds recalculate', async ({ page }) => {
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100); // P1 -> 401
    await enterGameScore(page, 50); // P2 -> 451

    await page.locator('.n01-score-table td.scored button').first().click();
    await page.locator('.n01-modal-card input[type="number"]').fill('140');
    await page.getByRole('button', { name: '修正して再計算' }).click();

    await expect(page.locator('.n01-left-table strong').first()).toHaveText('361');
  });
});

test.describe('チェックアウト練習', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
  });

  test('starts with a randomised checkout target and shares the 01 engine', async ({ page }) => {
    await expect(page.locator('.n01-game-meta')).toContainText('CHECKOUT');
    const target = await page.locator('.n01-left-table strong').first().innerText();
    const value = Number(target);
    expect(value).toBeGreaterThanOrEqual(41);
    expect(value).toBeLessThanOrEqual(170);
  });

  test('leaving 1 is also a bust', async ({ page }) => {
    // This describe's beforeEach has already started the random challenge. Start a deterministic
    // 41 challenge afresh so scoring 40 exercises the shared leave-1 boundary.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByLabel('出題下限').fill('41');
    await page.getByLabel('出題上限').fill('41');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await enterGameScore(page, 40);
    await expect(page.locator('.n01-notice')).toContainText('バスト');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('41');
  });

  test('has no always-on entry preview', async ({ page }) => {
    await expect(page.locator('.n01-entry-display')).toHaveCount(0);
    await expect(page.locator('.pent-entry-display')).toHaveCount(0);
    await expect(page.locator('.n01-menu-table > button')).toHaveCount(4);
  });

  test('gives both players the identical challenge score, before and after a hand-off', async ({ page }) => {
    const remaining = page.locator('.n01-left-table strong');
    const target = await remaining.nth(0).innerText();
    await expect(remaining.nth(1)).toHaveText(target);

    // Hand the turn over: the challenge belongs to the leg, not to whoever is throwing.
    await enterGameScore(page, 0);
    await expect(remaining.nth(0)).toHaveText(target);
    await expect(remaining.nth(1)).toHaveText(target);
  });

  test('keeps both challenge scores in step across save and resume', async ({ page }) => {
    const remaining = page.locator('.n01-left-table strong');
    const target = await remaining.nth(0).innerText();
    await enterGameScore(page, 0);

    await page.reload();
    await page.getByRole('button', { name: /保存した対戦を再開/ }).click();
    await expect(remaining.nth(0)).toHaveText(target);
    await expect(remaining.nth(1)).toHaveText(target);
  });

  test('draws one new shared challenge score for the next leg', async ({ page }) => {
    const remaining = page.locator('.n01-left-table strong');
    const firstTarget = await remaining.nth(0).innerText();

    await enterGameScore(page, 0); // player 1 scores nothing
    await enterGameScore(page, Number(firstTarget)); // player 2 checks out the challenge
    await confirmFinish(page);
    await page.getByRole('button', { name: /次のLegへ/ }).click();

    const nextTarget = await remaining.nth(0).innerText();
    await expect(remaining.nth(1)).toHaveText(nextTarget);
    expect(Number(nextTarget)).not.toBeNaN();
  });
});

/**
 * 先攻の交代・Leg結果ダイアログのEnter・1ラウンド目の先攻入れ替え。
 * All three regressed when 通常01/チェックアウト練習 were re-implemented alongside Pentathlon.
 */
test.describe('交互先攻とLeg送り', () => {
  test('通常01: 同じプレイヤーが勝ち続けても先攻はLegごとに交代し、Enterで次のLegへ進める', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    // Leg 1: P1 opens.
    expect(await starterBadges(page)).toEqual(['先攻', '後攻']);
    expect(await p0IsThrowing(page)).toBe(true);
    await p0WinsLeg(page);
    await expect(page.locator('.result-card')).toContainText('LEG 1 WINNER');
    await expect(page.locator('.result-card h2')).toHaveText('プレイヤー1');

    // The <kbd>Enter</kbd> badge must actually work.
    await page.keyboard.press('Enter');
    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');

    // Leg 2: the throw changed hands even though P1 won leg 1.
    expect(await starterBadges(page)).toEqual(['後攻', '先攻']);
    expect(await p0IsThrowing(page)).toBe(false);
    await p0WinsLeg(page);
    await expect(page.locator('.result-card h2')).toHaveText('プレイヤー1');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 3');

    // Leg 3: back to P1, after two straight P1 wins.
    expect(await starterBadges(page)).toEqual(['先攻', '後攻']);
    expect(await p0IsThrowing(page)).toBe(true);
    await expect(page.locator('.n01-leg-center strong')).toHaveText('2 - 0');
  });

  test('チェックアウト練習: 連勝しても先攻は交代し、Enterで次のLegへ進める', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByLabel('出題下限').fill('41');
    await page.getByLabel('出題上限').fill('41');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    expect(await starterBadges(page)).toEqual(['先攻', '後攻']);
    await p0WinsCheckoutLeg(page);
    await expect(page.locator('.result-card')).toContainText('LEG 1 WINNER');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
    expect(await starterBadges(page)).toEqual(['後攻', '先攻']);

    await p0WinsCheckoutLeg(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 3');
    expect(await starterBadges(page)).toEqual(['先攻', '後攻']);
    await expect(page.locator('.n01-leg-center strong')).toHaveText('2 - 0');
  });

  test('Leg結果ダイアログ: IME変換確定のEnterでは進まない', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await p0WinsLeg(page);
    await expect(page.locator('.result-card')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
      );
    });
    await expect(page.locator('.result-card')).toBeVisible();
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 1');

    // A real Enter still advances.
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
  });

  test('Leg結果ダイアログ: 表示中のキー入力が裏のテンキーに溜まらない', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await p0WinsLeg(page);
    await expect(page.locator('.result-card')).toBeVisible();

    await page.keyboard.type('99');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
    // The 99 must not have survived into leg 2's entry field.
    await expect(page.locator('.n01-score-table td.scored.current input')).toHaveValue('');
  });
});

test.describe('復活した旧機能', () => {
  test('前のLegをやり直す: 勝利直前の状態まで巻き戻り、Legカウントも戻る', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await p0WinsLeg(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
    await expect(page.locator('.n01-leg-center strong')).toHaveText('1 - 0');

    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await page.getByRole('button', { name: '前のLegをやり直す' }).click();

    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 1');
    await expect(page.locator('.n01-leg-center strong')).toHaveText('0 - 0');
    // Back on the checkout, just before taking it.
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');
    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(page.locator('.n01-notice')).toContainText('前のLegを勝利直前の状態で再開しました');
  });

  test('前のLegをやり直す: 戻せるLegが無いうちは選べない', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await expect(page.getByRole('button', { name: '前のLegをやり直す' })).toBeDisabled();
  });

  test('マッチ結果: Enterで新しい対戦を始められる', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: '2 Leg先取' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await p0WinsLeg(page);
    await page.keyboard.press('Enter');
    await p0WinsLeg(page);

    await expect(page.locator('.result-card.match-summary')).toContainText('MATCH WINNER');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mode-card').first()).toBeVisible();
    // 新しい対戦を始める clears the save, so no resume button is offered.
    await expect(page.getByRole('button', { name: /保存した対戦を再開/ })).toHaveCount(0);
  });
});

test.describe('1ラウンド目の先攻入れ替え', () => {
  test('通常01: 相手セルをタップして先攻を入れ替えられ、トグルで元に戻る', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    // Exactly one picker: the opponent's empty 1st-round cell.
    const picker = page.locator('.n01-score-table button.starter-picker');
    await expect(picker).toHaveCount(1);
    await expect(picker).toHaveAttribute('aria-label', 'プレイヤー2を先攻にする');

    await picker.click();
    expect(await starterBadges(page)).toEqual(['後攻', '先攻']);
    expect(await p0IsThrowing(page)).toBe(false);
    await expect(page.locator('.n01-notice')).toContainText('プレイヤー2を先攻に変更しました');

    // Tapping the other side toggles it straight back.
    await expect(picker).toHaveAttribute('aria-label', 'プレイヤー1を先攻にする');
    await picker.click();
    expect(await starterBadges(page)).toEqual(['先攻', '後攻']);
    expect(await p0IsThrowing(page)).toBe(true);
  });

  test('通常01: 1投でも入力されたら入れ替え不可になり、得点修正と競合しない', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await enterGameScore(page, 100);
    await expect(page.locator('.n01-score-table button.starter-picker')).toHaveCount(0);

    // The played cell still opens the past-score editor, unchanged.
    await page.locator('.n01-score-table td.scored button').first().click();
    await expect(page.locator('.n01-modal-card')).toContainText('過去得点を修正');
  });

  test('通常01: 入れ替えた順序を起点に以降のLegも交互先攻になる', async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await page.locator('.n01-score-table button.starter-picker').click();
    expect(await starterBadges(page)).toEqual(['後攻', '先攻']);

    await p0WinsLeg(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
    // Leg 2 alternates from the swapped order, not from the match's original starter.
    expect(await starterBadges(page)).toEqual(['先攻', '後攻']);

    await p0WinsLeg(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 3');
    expect(await starterBadges(page)).toEqual(['後攻', '先攻']);
  });

  test('チェックアウト練習: 相手セルのタップで先攻が入れ替わり、以降も交互になる', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByLabel('出題下限').fill('41');
    await page.getByLabel('出題上限').fill('41');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    const picker = page.locator('.n01-score-table button.starter-picker');
    await expect(picker).toHaveCount(1);
    await picker.click();
    expect(await starterBadges(page)).toEqual(['後攻', '先攻']);
    expect(await p0IsThrowing(page)).toBe(false);

    await p0WinsCheckoutLeg(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
    expect(await starterBadges(page)).toEqual(['先攻', '後攻']);
  });
});

/** The full pre-Pentathlon keyboard map, restored on the 01/checkout play screen. */
test.describe('キーボードショートカット', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
  });

  test('Tab も Enter と同じく得点を確定する', async ({ page }) => {
    await page.keyboard.type('60');
    await page.keyboard.press('Tab');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('441');
  });

  test('Delete も BackSpace と同じく1文字削除する', async ({ page }) => {
    await page.keyboard.type('123');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('491'); // 10
  });

  test('F で Finish、M でメニュー、S で Stats が開く', async ({ page }) => {
    // F mirrors the Finish button exactly: from 501 there is nothing to declare, so it warns.
    await page.keyboard.press('f');
    await expect(page.locator('.n01-notice')).toContainText('上がれない数字');
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);

    await page.keyboard.press('m');
    await expect(page.locator('.n01-modal-card')).toContainText('メニュー');
    await page.keyboard.press('Backspace'); // BackSpace also closes a dialog
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);

    await page.keyboard.press('s');
    await expect(page.locator('.n01-modal-card')).toContainText('対戦成績');
    await page.keyboard.press('Escape');
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);
  });

  test('N で新しいゲームへ戻る', async ({ page }) => {
    await enterGameScore(page, 100);
    await page.keyboard.press('n');
    await expect(page.locator('.mode-card').first()).toBeVisible();
  });

  test('U で直前の入力を取り消す（長押しの連射は無視される）', async ({ page }) => {
    await enterGameScore(page, 100);
    await enterGameScore(page, 100);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');

    await page.keyboard.press('u');
    await expect(page.locator('.n01-notice')).toContainText('直前の入力を取り消しました');
    // A held key must not unwind the whole leg: only real presses count.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', repeat: true, bubbles: true }));
    });
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
  });

  test('矢印で履歴セルを選択し、R で修正ダイアログを開く', async ({ page }) => {
    await enterGameScore(page, 100); // P1 -> 401
    await enterGameScore(page, 50); // P2 -> 451

    // First arrow press parks on the most recent visit (P2's).
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.n01-score-table td.scored button.selected')).toHaveCount(1);
    await expect(page.locator('.n01-score-table td.scored button.selected')).toHaveText('50');

    // Left moves to the other player in the same row.
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.n01-score-table td.scored button.selected')).toHaveText('100');

    await page.keyboard.press('r');
    await expect(page.locator('.n01-modal-card')).toContainText('過去得点を修正');
    await expect(page.locator('.n01-modal-card input[type="number"]')).toHaveValue('100');
  });

  test('選択中に数字を打つとその値で修正ダイアログが開く', async ({ page }) => {
    await enterGameScore(page, 100);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('4');
    await expect(page.locator('.n01-modal-card')).toContainText('過去得点を修正');
    await expect(page.locator('.n01-modal-card input[type="number"]')).toHaveValue('4');

    // The dialog's own Enter commits it.
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('456'); // 501 - 45
  });

  test('ESC は選択を解除し、その後は入力欄のクリアに戻る', async ({ page }) => {
    await enterGameScore(page, 100);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.n01-score-table td.scored button.selected')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.n01-score-table td.scored button.selected')).toHaveCount(0);

    await page.keyboard.type('77');
    await page.keyboard.press('Escape');
    await expect(page.locator('.n01-score-table td.scored.current input')).toHaveValue('');
  });

  test('+ / - で使用ダーツを変え、その本数で記録される', async ({ page }) => {
    await page.keyboard.press('-'); // 3 -> 2
    await page.keyboard.press('m');
    await expect(page.locator('.n01-darts-inline button.selected')).toHaveText('2');
    await page.keyboard.press('Escape');

    await page.keyboard.type('60');
    await page.keyboard.press('Enter');
    const lastVisit = await page.evaluate(() => {
      const raw = localStorage.getItem('n02-current-v1');
      const visits = raw ? (JSON.parse(raw) as { visits: Array<Record<string, unknown>> }).visits : [];
      return visits.at(-1);
    });
    expect(lastVisit).toMatchObject({ score: 60, darts: 2 });

    // It resets to a full three for the next visit.
    await page.keyboard.press('m');
    await expect(page.locator('.n01-darts-inline button.selected')).toHaveText('3');
  });

  test('メニューは数字キー 1〜4 で操作できる', async ({ page }) => {
    await page.keyboard.press('m');
    await page.keyboard.press('1'); // 残り点数で入力
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);
    await expect(page.locator('.n01-game-meta')).toContainText('残り点数入力');

    await page.keyboard.press('m');
    await page.keyboard.press('1'); // back to 得点入力
    await expect(page.locator('.n01-game-meta')).toContainText('得点入力');

    await enterGameScore(page, 100); // P1 -> 401
    await page.keyboard.press('m');
    await page.keyboard.press('2'); // プレイヤーのスコアを入れ替え
    await expect(page.locator('.n01-notice')).toContainText('入れ替えました');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('401');

    await page.keyboard.press('m');
    await page.keyboard.press('4'); // Legを終了・引き分け
    await expect(page.locator('.result-card h2')).toHaveText('引き分け');
  });

  test('メニューの 3 で前のLegに戻れる', async ({ page }) => {
    await p0WinsLeg(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');

    await page.keyboard.press('m');
    await page.keyboard.press('3');
    await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 1');
    await expect(page.locator('.n01-leg-center strong')).toHaveText('0 - 0');
  });

  test('上がり本数ダイアログは 1〜3 で選び、BackSpace で戻れる', async ({ page }) => {
    for (const score of [180, 0, 180, 0]) await enterGameScore(page, score); // P1 -> 141
    await page.keyboard.type('141');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-modal-card')).toContainText('上がり本数');

    await page.keyboard.press('Backspace');
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');

    await page.keyboard.press('f');
    await page.keyboard.press('3');
    await expect(page.locator('.result-card')).toContainText('LEG 1 WINNER');
  });

  test('Leg結果は ESC で「戻る」＝本数を選び直せる', async ({ page }) => {
    await p0WinsLeg(page);
    await expect(page.locator('.result-card')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('141');
  });

  test('ラウンド上限の勝敗選択は 1 / 2 / 3 で決められる', async ({ page }) => {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByLabel('最大ラウンド数').fill('1');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();

    await enterGameScore(page, 60);
    await enterGameScore(page, 40);
    await expect(page.locator('.n01-modal-card')).toContainText('ラウンド終了');
    await page.keyboard.press('1'); // プレイヤー1の勝ち
    await expect(page.locator('.result-card h2')).toHaveText('プレイヤー1');
  });
});

test.describe('themes', () => {
  test('applies the neon theme and persists it', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.theme-panel select').selectOption('neon');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');
  });
});
