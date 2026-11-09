import { expect, test, type Page } from '@playwright/test';
import {
  enterCountUpRound,
  enterGameScore,
  enterPentScore,
  judgeTowerDarts,
  openFreshApp,
  openSingleGame,
  startCountUp,
  startTower,
  towerClick,
} from './helpers';

/**
 * 「ゲームを終了しますか？」 on the play screens' exit buttons, and 「前回の途中から始めますか？」 on the
 * next start of a game that was left with 「途中経過を保存する」.
 *
 * Covered: 通常01・チェックアウト練習 (New / N), COUNT-UP and TOWER (PRACTICE), ペンタスロン個別練習の
 * 301/501 (中断 / N / ☰ 3). The full five-discipline pentathlon keeps leaving at once.
 */

const exitDialog = (page: Page) => page.getByRole('dialog', { name: 'ゲームの終了確認' });
const resumeDialog = (page: Page) => page.getByRole('dialog', { name: '前回の途中からの再開' });
const remaining = (page: Page) => page.locator('.n01-left-table strong').first();

async function startX01(page: Page, mode: '01' | 'checkout' = '01') {
  if (mode === 'checkout') await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
  await page.getByRole('button', { name: /ゲームを開始/ }).click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();
}

test.describe('通常01・チェックアウト練習', () => {
  test('New with nothing thrown yet leaves at once, with no dialog and no save', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.locator('.mode-card').first()).toBeVisible();
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /保存した対戦を再開/ })).toHaveCount(0);
  });

  test('a score of 0 is an entry, so New then asks', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 0);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(exitDialog(page)).toBeVisible();
  });

  test('shows the three choices; Esc is NO and the match carries on untouched', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.getByRole('button', { name: 'New', exact: true }).click();

    const dialog = exitDialog(page);
    await expect(dialog.getByRole('heading')).toHaveText('ゲームを終了しますか？');
    await expect(dialog.getByRole('button')).toHaveText([/YES/, /NO/, '途中経過を保存する']);
    await expect(dialog.getByRole('button', { name: /YES/ })).toContainText('Enter');
    await expect(dialog.getByRole('button', { name: /NO/ })).toContainText('Esc');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(remaining(page)).toHaveText('401');
    // The keyboard is the game's again: the next score lands (player 2's turn).
    await enterGameScore(page, 60);
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('441');
  });

  test('NO by button also carries on', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await exitDialog(page).getByRole('button', { name: /NO/ }).click();
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('401');
  });

  test('YES (Enter) discards the match and its save', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.keyboard.press('n');
    await expect(exitDialog(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.mode-card').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /保存した対戦を再開/ })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('n02-current-v1'))).toBeNull();

    // Nothing saved, so the next start is a plain new game.
    await startX01(page);
    await expect(resumeDialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('501');
  });

  test('Enter on a focused 途中経過を保存する saves rather than discards', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /保存した対戦を再開/ })).toBeVisible();
  });

  test('途中経過を保存する, then the next start asks 「前回の途中から始めますか？」 - YES resumes', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();
    await expect(page.locator('.mode-card').first()).toBeVisible();
    // The existing resume button stays.
    await expect(page.getByRole('button', { name: /保存した対戦を再開/ })).toContainText('501・LEG 1');

    // Another start score is chosen, but YES resumes the saved match with its own settings.
    await page.locator('.field select').first().selectOption('701');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(resumeDialog(page).getByRole('heading')).toHaveText('前回の途中から始めますか？');
    await expect(resumeDialog(page).getByRole('button')).toHaveText(['YES', 'NO']);
    await resumeDialog(page).getByRole('button', { name: 'YES' }).click();
    await expect(remaining(page)).toHaveText('401');
  });

  test('NO deletes the save and starts new with the settings just chosen', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    await page.locator('.field select').first().selectOption('701');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await resumeDialog(page).getByRole('button', { name: 'NO' }).click();
    await expect(remaining(page)).toHaveText('701');

    // The old 501 save is gone; only the new match (saved as it is played) remains.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('n02-current-v1')!).startScore);
    expect(stored).toBe(701);
  });

  test('Escape on the resume prompt changes nothing', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.keyboard.press('n');
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(resumeDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(resumeDialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /保存した対戦を再開/ })).toContainText('501・LEG 1');
  });

  test('通常01 and チェックアウト練習 keep separate saves and only ask for their own', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page);
    await enterGameScore(page, 100);
    await page.keyboard.press('n');
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    // A checkout start does not ask about the 01 save, and does not replace it.
    await startX01(page, 'checkout');
    await expect(resumeDialog(page)).toHaveCount(0);
    await enterGameScore(page, 0);
    await page.keyboard.press('n');
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    const buttons = page.getByRole('button', { name: /保存した対戦を再開/ });
    await expect(buttons).toHaveCount(2);
    await expect(page.locator('.resume-button[data-saved-mode="01"]')).toContainText('501');
    await expect(page.locator('.resume-button[data-saved-mode="checkout"]')).toContainText('CHECKOUT');

    await page.locator('.resume-button[data-saved-mode="01"]').click();
    await expect(remaining(page)).toHaveText('401');
  });

  test('a checkout match saved in the shared slot before this release is offered as checkout', async ({ page }) => {
    await openFreshApp(page);
    await startX01(page, 'checkout');
    await enterGameScore(page, 0);
    const saved = await page.evaluate(() => localStorage.getItem('n02-current-checkout-v1'));
    await page.evaluate((raw) => {
      localStorage.removeItem('n02-current-checkout-v1');
      localStorage.setItem('n02-current-v1', raw!);
    }, saved);
    await page.reload();

    await expect(page.locator('.resume-button[data-saved-mode="checkout"]')).toBeVisible();
    await expect(page.locator('.resume-button[data-saved-mode="01"]')).toHaveCount(0);
  });
});

test.describe('COUNT-UP', () => {
  test('save, then YES resumes; Esc on the exit dialog is NO', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page);
    await enterCountUpRound(page, 60);
    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    await page.keyboard.press('Escape');
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(page.locator('.countup-total-value').first()).toContainText('60');

    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();

    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    await expect(resumeDialog(page)).toContainText('前回の途中から始めますか？');
    await resumeDialog(page).getByRole('button', { name: 'YES' }).click();
    await expect(page.locator('.countup-total-value').first()).toContainText('60');

    // Finishing the resumed game clears the save.
    for (let round = 0; round < 7; round += 1) await enterCountUpRound(page, 60);
    expect(await page.evaluate(() => localStorage.getItem('n02-practice-countup-progress-v1'))).toBeNull();
  });

  test('NO deletes the save and starts new; YES on exit discards', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page);
    await enterCountUpRound(page, 60);
    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    await resumeDialog(page).getByRole('button', { name: 'NO' }).click();
    await expect(page.locator('.countup-total-value').first()).toContainText('0');
    expect(await page.evaluate(() => localStorage.getItem('n02-practice-countup-progress-v1'))).toBeNull();

    await enterCountUpRound(page, 45);
    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();
    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    await expect(resumeDialog(page)).toHaveCount(0);
    await expect(page.locator('.countup-shell')).toBeVisible();
  });

  test('nothing entered yet leaves without asking', async ({ page }) => {
    await openFreshApp(page);
    await startCountUp(page);
    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();
  });
});

test.describe('TOWER OF THE DARTS', () => {
  test('save, then YES resumes the climb where it was left', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTowerDarts(page, 'hit', 4);
    await expect(page.locator('.tower-floor-badge strong')).toContainText('5');

    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();
    await expect(page.locator('.practice-card[data-practice="tower"]')).toBeVisible();

    await page.locator('.practice-card[data-practice="tower"]').click();
    await page.getByRole('button', { name: /TOWER を開始/ }).click();
    await resumeDialog(page).getByRole('button', { name: 'YES' }).click();
    await expect(page.locator('.tower-shell')).toBeVisible();
    await expect(page.locator('.tower-floor-badge strong')).toContainText('5');
    // The undo history came back too.
    await towerClick(page, '.tower-menu button:has-text("1投戻す")');
    await expect(page.locator('.tower-floor-badge strong')).toContainText('4');
  });

  test('NO deletes the save and starts a new climb; Esc on exit is NO; YES discards', async ({ page }) => {
    await openFreshApp(page);
    await startTower(page);
    await judgeTowerDarts(page, 'hit', 2);
    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    await page.locator('.practice-card[data-practice="tower"]').click();
    await page.getByRole('button', { name: /TOWER を開始/ }).click();
    await resumeDialog(page).getByRole('button', { name: 'NO' }).click();
    await expect(page.locator('.tower-floor-badge strong')).toContainText('1');
    expect(await page.evaluate(() => localStorage.getItem('n02-practice-tower-progress-v1'))).toBeNull();

    await judgeTowerDarts(page, 'hit', 1);
    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await page.keyboard.press('Escape');
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(page.locator('.tower-floor-badge strong')).toContainText('2');

    await towerClick(page, '.tower-menu button:has-text("PRACTICE")');
    await exitDialog(page).getByRole('button', { name: /YES/ }).click();
    await expect(page.locator('.practice-card[data-practice="tower"]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('n02-practice-tower-progress-v1'))).toBeNull();
  });
});

test.describe('ペンタスロン個別練習 301/501', () => {
  async function startSingle501(page: Page) {
    await openFreshApp(page);
    await openSingleGame(page, 'JDA 501');
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();
  }

  test('nothing entered yet: 中断 leaves at once', async ({ page }) => {
    await startSingle501(page);
    await page.getByRole('button', { name: '中断' }).click();
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(page.locator('.mode-card').first()).toBeVisible();
  });

  test('中断 asks; YES deletes the saved session', async ({ page }) => {
    await startSingle501(page);
    await enterPentScore(page, 100);
    await page.getByRole('button', { name: '中断' }).click();
    await expect(exitDialog(page)).toContainText('ゲームを終了しますか？');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mode-card').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('n02-pentathlon-single-v1'))).toBeNull();
  });

  test('☰ 中断してメニューへ asks too, and Esc is NO', async ({ page }) => {
    await startSingle501(page);
    await enterPentScore(page, 100);
    await page.getByRole('button', { name: 'メニュー' }).click();
    await page.getByRole('button', { name: /中断してメニューへ/ }).click();
    await expect(exitDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('401');
  });

  test('save, then starting the same discipline asks; YES resumes, another discipline does not ask', async ({
    page,
  }) => {
    await startSingle501(page);
    await enterPentScore(page, 100);
    await page.getByRole('button', { name: '中断' }).click();
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    await openSingleGame(page, 'JDA 501');
    // The existing resume button stays.
    await expect(page.getByRole('button', { name: /中断した個別練習を再開/ })).toBeVisible();
    await page.getByRole('button', { name: /JDA 501 を開始/ }).click();
    await expect(resumeDialog(page)).toContainText('JDA 501');
    await resumeDialog(page).getByRole('button', { name: 'YES' }).click();
    await expect(remaining(page)).toHaveText('401');

    await page.getByRole('button', { name: '中断' }).click();
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();
    await openSingleGame(page, 'JDA 301');
    await page.getByRole('button', { name: /JDA 301 を開始/ }).click();
    await expect(resumeDialog(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('301');
  });

  test('NO deletes the save and starts the discipline new', async ({ page }) => {
    await startSingle501(page);
    await enterPentScore(page, 100);
    await page.keyboard.press('n');
    await exitDialog(page).getByRole('button', { name: '途中経過を保存する' }).click();

    await openSingleGame(page, 'JDA 501');
    await page.getByRole('button', { name: /JDA 501 を開始/ }).click();
    await resumeDialog(page).getByRole('button', { name: 'NO' }).click();
    await expect(remaining(page)).toHaveText('501');
  });

  test('the full pentathlon still leaves at once from 中断', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card[data-mode="pentathlon"]').click();
    await page.waitForSelector('.pent-preset-card');
    // JDA (the default preset) opens on 501.
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();
    await enterPentScore(page, 100);
    await page.getByRole('button', { name: '中断' }).click();
    await expect(exitDialog(page)).toHaveCount(0);
    await expect(page.locator('.mode-card').first()).toBeVisible();
  });
});
