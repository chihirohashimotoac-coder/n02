import { expect, test, type Page } from '@playwright/test';
import {
  commitPentTurn,
  confirmFinish,
  enterPentScore,
  openFreshApp,
  openPentathlon,
  openSingleGame,
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

async function startSingleGame(page: Page, label: string, playerCount: 1 | 2 = 1) {
  await openSingleGame(page, label);
  if (playerCount === 2) await page.locator('select').first().selectOption('2');
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
    await expect(page.locator('.pent-progress')).toContainText('501');
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

    // With darts staged, the round undo is disabled - the staged turn must be cleared first.
    const roundUndo = page.getByRole('button', { name: '前の確定ラウンドに戻す' });
    await expect(roundUndo).toBeDisabled();

    // 1投戻す removes only the last staged dart; the committed inning is untouched.
    await page.getByRole('button', { name: '1投戻す' }).click();
    await expect(page.locator('.pent-pending-chip').nth(1)).toContainText('2投目');
    await expect(page.locator('.pent-player-value')).toHaveText('3');
    await expect(page.locator('.pent-aim-phase')).toContainText('第2イニング');

    await page.getByRole('button', { name: '1投戻す' }).click();
    await expect(roundUndo).toBeEnabled();

    // Now the round undo takes back the committed inning itself.
    await roundUndo.click();
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

  test('the in-game RULES popup is equally accessible', async ({ page }) => {
    await openFreshApp(page);
    await startSingleGame(page, 'CORK');

    const trigger = page.getByRole('button', { name: 'ルール説明' });
    await trigger.click();
    await expect(page.getByRole('dialog')).toContainText('CORK');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Escape closing the dialog must not also clear the pad behind it.
    await tapQuickTarget(page, 'インナーブル');
    await expect(page.locator('.pent-pending-chip').first()).toHaveText('BULL');
  });
});
