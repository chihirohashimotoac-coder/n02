import { expect, test, type Page } from '@playwright/test';
import {
  commitPentTurn,
  confirmFinish,
  enterPentScore,
  openFreshApp,
  openPentathlon,
  enterPentHits,
  openPentGameMenu,
  openSingleGame,
  tapCricket,
  tapBaseballOutcome,
  tapQuickTarget,
} from './helpers';

/** Every (preset, discipline) pairing the 個別練習 menu must offer, with what its play screen shows. */
const CATALOGUE: Array<{ label: string; screen: string }> = [
  { label: 'JDA 501', screen: '.pent-x01-shell' },
  { label: 'HALF-IT', screen: '.pent-keypad' },
  { label: 'Round-the-Clock ON DOUBLES', screen: '.pent-keypad' },
  { label: 'GOLF', screen: '.pent-keypad' },
  { label: 'JDA 301', screen: '.pent-x01-shell' },
  { label: 'CORK', screen: '.pent-keypad' },
  { label: 'n01 301', screen: '.pent-x01-shell' },
  { label: 'BASEBALL', screen: '.pent-keypad' },
  { label: 'n01 501', screen: '.pent-x01-shell' },
  { label: 'CRICKET', screen: '.pent-cricket-board' },
];

/** The live entry cell of the X01 score sheet - where a score being typed appears. */
function liveCell(page: Page) {
  return page.locator('.n01-score-table td.scored.current input');
}

async function startSingleGame(page: Page, label: string, playerCount: 1 | 2 = 1) {
  await openSingleGame(page, label);
  // Always explicit: the menu's own default is 2 players, so a 1-player test must say so.
  await page.locator('select').first().selectOption(String(playerCount));
  await page.getByRole('button', { name: /を開始/ }).click();
}

test.describe('ペンタスロン個別練習', () => {
  test('offers all ten discipline entries, with 301/501 labelled by preset', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();

    const cards = page.locator('.pent-single-card');
    await expect(cards).toHaveCount(10);
    for (const { label } of CATALOGUE) {
      await expect(page.locator('.pent-single-card', { hasText: new RegExp(`^${label}`) })).toHaveCount(1);
    }
  });

  test('defaults to 2 players', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'JDA 501');
    await expect(page.locator('select').first()).toHaveValue('2');
    // Both player-name fields are offered up front, without changing anything.
    await expect(page.locator('.name-input input')).toHaveCount(2);
  });

  test('starts every one of the ten disciplines on its own', async ({ page }) => {
    test.slow();
    for (const { label, screen } of CATALOGUE) {
      await openFreshApp(page);
      await startSingleGame(page, label);
      await expect(page.locator(screen)).toBeVisible();
      // A single game shows no 1-of-5 progress rail.
      await expect(page.locator('.pent-progress')).toHaveCount(0);
    }
  });

  test('ends after its one discipline instead of moving on to another', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');

    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    await expect(page.getByText('GAME COMPLETE')).toBeVisible();
    await expect(page.getByRole('button', { name: 'もう一度プレイ' })).toBeVisible();
    await expect(page.getByRole('button', { name: '別のゲームを選ぶ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'メインメニューへ戻る' })).toBeVisible();
    // No hand-off to another discipline, and no overall standing.
    await expect(page.getByRole('button', { name: /次の種目へ|総合リザルトへ/ })).toHaveCount(0);
    await expect(page.getByText('種目勝利数')).toHaveCount(0);
  });

  test('"別のゲームを選ぶ" returns to the discipline menu; "もう一度プレイ" restarts the same one', async ({
    page,
  }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    await page.getByRole('button', { name: 'もう一度プレイ' }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('501');

    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);
    await page.getByRole('button', { name: '別のゲームを選ぶ' }).click();
    await expect(page.locator('.pent-single-card').first()).toBeVisible();
  });

  test('never touches an in-progress full pentathlon', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await enterPentScore(page, 180);
    const fullSave = await page.evaluate(() => localStorage.getItem('n02-pentathlon-v1'));
    expect(fullSave).toBeTruthy();

    await page.goto('/');
    await startSingleGame(page, 'n01 501');
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);
    await expect(page.getByText('GAME COMPLETE')).toBeVisible();

    // The full pentathlon's own save is byte-identical, and the single game used its own key.
    const fullAfter = await page.evaluate(() => localStorage.getItem('n02-pentathlon-v1'));
    expect(fullAfter).toBe(fullSave);
    const singleSave = await page.evaluate(() => localStorage.getItem('n02-pentathlon-single-v1'));
    expect(singleSave).toBeTruthy();

    // Resuming the full pentathlon still lands on its own first discipline with only its own record.
    await page.goto('/');
    await page.locator('.mode-card[data-mode="pentathlon"]').click();
    await page.getByRole('button', { name: /中断したペンタスロンを再開/ }).click();
    await expect(page.locator('.n01-leg-center')).toContainText('501');
    const records = await page.evaluate(() => {
      const raw = localStorage.getItem('n02-pentathlon-v1');
      return raw ? (JSON.parse(raw).records as unknown[]).length : -1;
    });
    expect(records).toBe(0);
  });

  test('a solo result shows no win-count wording', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    await expect(page.locator('.pent-note')).toContainText('結果記録');
    await expect(page.getByText('種目勝利数')).toHaveCount(0);
    await expect(page.getByText('WINNER')).toHaveCount(0);
  });
});

test.describe('BASEBALL の4択入力', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'BASEBALL');
  });

  test('offers four outcome buttons instead of a number grid', async ({ page }) => {
    await expect(page.locator('.pent-quick-btn')).toHaveCount(4);
    await expect(page.locator('.pent-number-grid')).toHaveCount(0);
    await expect(page.locator('.pent-ring-row')).toHaveCount(0);

    const labels = page.locator('.pent-quick-btn');
    await expect(labels.nth(0)).toContainText('シングル');
    await expect(labels.nth(0)).toContainText('1 RUN');
    await expect(labels.nth(1)).toContainText('ダブル');
    await expect(labels.nth(1)).toContainText('2 RUN');
    await expect(labels.nth(2)).toContainText('トリプル');
    await expect(labels.nth(2)).toContainText('3 RUN');
    await expect(labels.nth(3)).toContainText('ミス');
    await expect(labels.nth(3)).toContainText('0 RUN');
  });

  test('shows the current inning and target number prominently', async ({ page }) => {
    await expect(page.locator('.pent-aim-phase')).toContainText('第1イニング');
    await expect(page.locator('.pent-aim-target')).toContainText('1');
    await expect(page.locator('.pent-aim-hint')).toContainText('1のシングル・ダブル・トリプルを狙ってください');

    await tapBaseballOutcome(page, 'ミス');
    await tapBaseballOutcome(page, 'ミス');
    await tapBaseballOutcome(page, 'ミス');
    await commitPentTurn(page);

    await expect(page.locator('.pent-aim-phase')).toContainText('第2イニング');
    await expect(page.locator('.pent-aim-target')).toContainText('2');
  });

  test('scores single/double/triple/miss correctly', async ({ page }) => {
    const runs = page.locator('.pent-player-value');
    await expect(runs).toHaveText('0');

    // Inning 1: single + double + triple = 1 + 2 + 3 = 6 runs.
    await tapBaseballOutcome(page, 'シングル');
    await tapBaseballOutcome(page, 'ダブル');
    await tapBaseballOutcome(page, 'トリプル');
    await commitPentTurn(page);
    await expect(runs).toHaveText('6');

    // Inning 2: three misses add nothing.
    await tapBaseballOutcome(page, 'ミス');
    await tapBaseballOutcome(page, 'ミス');
    await tapBaseballOutcome(page, 'ミス');
    await commitPentTurn(page);
    await expect(runs).toHaveText('6');

    // Inning 3: two triples + a miss = 6 more.
    await tapBaseballOutcome(page, 'トリプル');
    await tapBaseballOutcome(page, 'トリプル');
    await tapBaseballOutcome(page, 'ミス');
    await commitPentTurn(page);
    await expect(runs).toHaveText('12');
  });

  test('each outcome button meets the 44x44 touch-target minimum', async ({ page }) => {
    const buttons = page.locator('.pent-quick-btn');
    for (let i = 0; i < (await buttons.count()); i += 1) {
      const box = (await buttons.nth(i).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('Undo の役割分離', () => {
  test('the staged-dart undo and the committed-round undo revert different things', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'BASEBALL');

    // Commit inning 1 with a triple (3 runs), then stage two darts of inning 2.
    await tapBaseballOutcome(page, 'トリプル');
    await tapBaseballOutcome(page, 'ミス');
    await tapBaseballOutcome(page, 'ミス');
    await commitPentTurn(page);
    await expect(page.locator('.pent-player-value')).toHaveText('3');

    await tapBaseballOutcome(page, 'ダブル');
    await tapBaseballOutcome(page, 'シングル');
    await expect(page.locator('.pent-pending-chip').nth(1)).toHaveText('S2');

    // With darts staged, the round undo (in the ☰ menu) is disabled - clear the staged turn first.
    await openPentGameMenu(page);
    await expect(page.getByRole('button', { name: '前の確定ラウンドに戻す' })).toBeDisabled();
    await page.keyboard.press('Escape');

    // 1投戻す removes only the last staged dart; the committed inning is untouched.
    await page.getByRole('button', { name: '1投戻す' }).click();
    await expect(page.locator('.pent-pending-chip').nth(1)).toContainText('2投目');
    await expect(page.locator('.pent-player-value')).toHaveText('3');
    await expect(page.locator('.pent-aim-phase')).toContainText('第2イニング');

    await page.getByRole('button', { name: '1投戻す' }).click();

    // Now the round undo takes back the committed inning itself.
    await openPentGameMenu(page);
    await page.getByRole('button', { name: '前の確定ラウンドに戻す' }).click();
    await expect(page.locator('.pent-player-value')).toHaveText('0');
    await expect(page.locator('.pent-aim-phase')).toContainText('第1イニング');
  });
});

test.describe('ペンタスロン用ルールモーダルのアクセシビリティ', () => {
  test('closes on Escape and returns focus to the button that opened it', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();

    const trigger = page.getByRole('button', { name: '採用ルール・出典' });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus moved into the dialog on open.
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('states the Cricket variant and how the overall standing is decided', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();
    await page.getByRole('button', { name: '採用ルール・出典' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('スタンダードクリケット');
    await expect(dialog).toContainText('勝利種目数');
    await expect(dialog).toContainText('総合引き分け');
    // No internal file paths anywhere in the UI.
    await expect(page.locator('body')).not.toContainText('docs/pentathlon-rules.md');
  });

  test('a click inside the dialog does not close it, but the backdrop does', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();
    await page.getByRole('button', { name: '採用ルール・出典' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('h2').click();
    await expect(dialog).toBeVisible();

    await page.locator('.pent-modal-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
  });

  test('keeps Tab focus inside the dialog', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();
    await page.getByRole('button', { name: '採用ルール・出典' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(
        true,
      );
    }
  });

  test('the in-game ☰ menu is equally accessible', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CORK');

    const trigger = page.getByRole('button', { name: 'メニュー' });
    await trigger.click();
    await page.getByRole('button', { name: 'ルール説明' }).click();
    await expect(page.getByRole('dialog')).toContainText('CORK');
    // Rules are a second view of the same dialog, so Escape steps back to the menu, then out.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toContainText('メニュー');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Escape closing the dialog must not also clear the pad behind it.
    await tapQuickTarget(page, 'インナーブル');
    await expect(page.locator('.pent-pending-chip').first()).toHaveText('BULL');
  });
});

test.describe('モーダルは背後のゲームへキー入力を漏らさない', () => {
  test('Enter on an open dialog does not also commit the score behind it', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');

    // Type a score but do not confirm it, then open the in-game menu.
    await page.keyboard.type('180');
    await expect(liveCell(page)).toHaveValue('180');
    await page.getByRole('button', { name: 'メニュー' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enter activates the dialog's own focused button (here: opening the rules view) and nothing
    // else - it must never also commit the score sitting behind the dialog.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('のルール');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('501');
    await expect(liveCell(page)).toHaveValue('180');
  });

  test('digits, Backspace and U on an open dialog do not edit or undo hidden gameplay', async ({
    page,
  }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');

    await enterPentScore(page, 100); // 501 -> 401, one committed round
    await page.keyboard.type('55');
    await page.getByRole('button', { name: 'メニュー' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.type('77');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('u');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The entry is exactly as it was left, and the committed round was not undone.
    await expect(liveCell(page)).toHaveValue('55');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('401');
  });

  test('the finish-darts dialog still takes its own digit keys', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');

    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await page.keyboard.type('141');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('上がり本数');

    await page.keyboard.press('3');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('GAME COMPLETE')).toBeVisible();
  });
});

test.describe('個別練習の中断と再開', () => {
  test('an interrupted single game can be resumed from the menu', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');
    await enterPentScore(page, 180);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('321');

    await page.getByRole('button', { name: '中断' }).click();
    await page.locator('.mode-card[data-mode="pentathlon-single"]').click();

    const resume = page.getByRole('button', { name: /中断した個別練習を再開/ });
    await expect(resume).toBeVisible();
    await expect(resume).toContainText('JDA 501');
    await resume.click();

    await expect(page.locator('.pent-x01-shell')).toBeVisible();
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('321');
  });

  test('finishing a game clears its saved session', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'JDA 501');
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);
    await page.getByRole('button', { name: '別のゲームを選ぶ' }).click();

    await expect(page.locator('.pent-single-card').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /中断した個別練習を再開/ })).toHaveCount(0);
  });
});

test.describe('PCキーボード操作（ダーツ入力系の種目）', () => {
  test('a quick-target pad binds its buttons to the number keys in display order', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CORK');

    // CORK's pad is アウターブル / インナーブル / ミス, so 1/2/3 stage exactly those.
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('3');
    const chips = page.locator('.pent-pending-chip');
    await expect(chips.nth(0)).toHaveText('OUTER BULL');
    await expect(chips.nth(1)).toHaveText('BULL');
    await expect(chips.nth(2)).toHaveText('MISS');

    // Backspace takes the last dart back, Enter commits the turn.
    await page.keyboard.press('Backspace');
    await expect(chips.nth(2)).toContainText('3投目');
    await page.keyboard.press('3');
    await page.keyboard.press('Enter');
    // 1 inner (2) + 1 outer (1) = 3 bulls counted.
    await expect(page.locator('.pent-player-value').first()).toHaveText('3');
  });

  test('CRICKET takes darts notation, with the digits shown as they are typed', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CRICKET');

    // "2" alone can only ever become 20 on a Cricket board, so the ring key resolves it.
    await page.keyboard.press('2');
    await expect(page.locator('.pent-play-title h2')).toContainText('入力中 2');
    await page.keyboard.press('t');
    // A triple is 3 marks, so the number closes immediately - shown as the closed mark, in red.
    const mark = page.locator('.pent-cricket-mark.staged').first();
    await expect(mark).toContainText('3');
    await expect(mark.locator('.pent-cricket-glyph[data-marks="3"]')).toBeVisible();

    // B is the inner bull (2 marks), O the outer (1 mark).
    await page.keyboard.press('b');
    await page.keyboard.press('o');
    await expect(page.locator('.pent-cricket-mark.staged')).toHaveCount(2);

    // Enter confirms the turn: 20 and BULL are both closed, and nothing is provisional any more.
    await page.keyboard.press('Enter');
    await expect(page.locator('.pent-cricket-mark.staged')).toHaveCount(0);
    await expect(page.locator('.pent-cricket-glyph[data-marks="3"]')).toHaveCount(2);
  });

  test('a mark entered this turn can be corrected or deleted by tapping it', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CRICKET');

    await tapCricket(page, 'トリプル20');
    const mark = page.locator('.pent-cricket-mark.staged').first();
    await expect(mark).toContainText('3');

    // Tapping it offers ／ ✕ ⊗ and delete; picking ／ leaves a single mark.
    await mark.click();
    await page.getByRole('button', { name: '1マークにする' }).click();
    await expect(page.locator('.pent-cricket-mark.staged').first()).toContainText('1');

    // Deleting removes it from the turn entirely.
    await page.locator('.pent-cricket-mark.staged').first().click();
    await page.getByRole('button', { name: 'この入力を削除' }).click();
    await expect(page.locator('.pent-cricket-mark.staged')).toHaveCount(0);
  });

  test('only the current, unconfirmed turn is editable - never a committed or opponent mark', async ({
    page,
  }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CRICKET', 2);

    // P1 stages a mark: their own unconfirmed mark is the one thing that can be tapped to correct.
    await tapCricket(page, 'トリプル20');
    await expect(page.locator('.pent-cricket-mark.editable')).toHaveCount(1);

    // Once confirmed it is history: nothing on the board can be tapped to correct any more.
    await page.getByRole('button', { name: '確定' }).click();
    await expect(page.locator('.pent-cricket-mark.editable')).toHaveCount(0);
    await expect(page.locator('.pent-cricket-glyph[data-marks="3"]')).toHaveCount(1);

    // P2 stages their own mark: still exactly one editable cell, and P1's committed 20 is not it.
    await tapCricket(page, 'トリプル19');
    await expect(page.locator('.pent-cricket-mark.editable')).toHaveCount(1);
    const row20 = page
      .locator('.pent-cricket-row')
      .filter({ has: page.getByRole('button', { name: 'シングル20', exact: true }) });
    await expect(row20.locator('.pent-cricket-mark.editable')).toHaveCount(0);
  });

  test('a BULL correction that would not fit in the turn is offered as disabled, not truncated', async ({
    page,
  }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CRICKET', 2);

    // Fill the turn: two darts elsewhere, the third an outer bull (1 mark on BULL).
    await tapCricket(page, 'シングル20');
    await tapCricket(page, 'シングル19');
    await tapCricket(page, 'アウターブル');
    await expect(page.locator('.pent-cricket-status')).toContainText('3 / 3');

    // 3 marks on BULL needs an inner AND an outer (there is no triple bull), and this turn has no
    // spare dart for the second one - so that choice must be refused outright, never half-applied.
    const bullRow = page
      .locator('.pent-cricket-row')
      .filter({ has: page.getByRole('button', { name: 'アウターブル', exact: true }) });
    await bullRow.locator('.pent-cricket-mark.editable').click();
    await expect(page.getByRole('button', { name: '3マークにする' })).toBeDisabled();
    await expect(page.getByRole('dialog')).toContainText('残りの投数が足りません');

    // The choices that do fit still work: 2 marks replaces the outer bull with an inner.
    await page.getByRole('button', { name: '2マークにする' }).click();
    await expect(bullRow.locator('.pent-cricket-mark.staged')).toContainText('2');
    await expect(page.locator('.pent-cricket-status')).toContainText('3 / 3');
  });

  test('the same BULL correction is allowed once the turn has room for it', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CRICKET', 2);

    // Only one dart used, so inner + outer both fit.
    await tapCricket(page, 'アウターブル');
    const bullRow = page
      .locator('.pent-cricket-row')
      .filter({ has: page.getByRole('button', { name: 'アウターブル', exact: true }) });
    await bullRow.locator('.pent-cricket-mark.editable').click();
    await page.getByRole('button', { name: '3マークにする' }).click();

    await expect(bullRow.locator('.pent-cricket-mark.staged')).toContainText('3');
    await expect(bullRow.locator('.pent-cricket-glyph[data-marks="3"]')).toBeVisible();
    // Two darts of the three are now spoken for.
    await expect(page.locator('.pent-cricket-status')).toContainText('2 / 3');
  });

  test('the result reports MPR under a STATS column instead of a dart count', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CRICKET', 1);

    // Six triples close 20-15 in six rounds (18 effective marks), shutting the 80% window; the
    // seventh round closes BULL and ends the game.
    for (const n of [20, 19, 18, 17, 16, 15]) await enterPentHits(page, [`T${n}`]);
    await enterPentHits(page, ['BULL', '25']);

    await expect(page.getByText('GAME COMPLETE')).toBeVisible();
    const head = page.locator('.pent-result-row.head');
    await expect(head).toContainText('STATS');
    await expect(head).not.toContainText('DARTS');

    const stat = page.locator('.pent-result-stat').first();
    await expect(stat.locator('b')).toHaveText('3.00');
    await expect(stat).toContainText('MPR 80%');
    // 21 effective marks over 7 rounds for the full game.
    await expect(stat).toContainText('3.00 (100%)');
  });

  test('a turn where nothing landed is 確定 alone', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CRICKET', 1);

    await expect(page.locator('.pent-cricket-status')).toContainText('0 / 3');
    await page.getByRole('button', { name: '確定' }).click();
    // The round advanced with nothing marked at all.
    await expect(page.locator('.pent-cricket-mark.staged')).toHaveCount(0);
    await expect(page.locator('.pent-cricket-glyph')).toHaveCount(0);
  });

  test('lists the shortcuts for the pad the screen is actually showing', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CORK');
    await openPentGameMenu(page);
    await expect(page.getByRole('dialog')).toContainText('各ボタン');
    await page.keyboard.press('Escape');

    await page.goto('/');
    await startSingleGame(page, 'CRICKET');
    await openPentGameMenu(page);
    await expect(page.getByRole('dialog')).toContainText('T20');
    await expect(page.getByRole('dialog')).toContainText('確定');
  });
});
