import { expect, test } from '@playwright/test';
import {
  commitPentTurn,
  confirmFinish,
  enterGameScore,
  enterPentHits,
  enterPentScore,
  openFreshApp,
  openPentathlon,
  openPentRules,
  tapAnyRingNumber,
  tapBaseballOutcome,
  tapQuickTarget,
} from './helpers';

/**
 * Plays 501 to a 9-dart finish for the starter. 501 is a race, so that checkout wins the discipline
 * outright - the opponent, still on 449, never throws again.
 */
async function play501TwoPlayers(page: import('@playwright/test').Page) {
  await enterPentScore(page, 180); // starter -> 321
  await enterPentScore(page, 26); // opponent -> 475
  await enterPentScore(page, 180); // starter -> 141
  await enterPentScore(page, 26); // opponent -> 449
  await enterPentScore(page, 141); // starter declares finish
  await confirmFinish(page);
}

/** Plays a full Cork attempt (5 rounds of 3 darts at bull) via the quick bull pad. */
async function playCorkAttempt(
  page: import('@playwright/test').Page,
  hits: ('インナーブル' | 'アウターブル' | 'ミス')[],
) {
  for (let i = 0; i < hits.length; i += 3) {
    for (const hit of hits.slice(i, i + 3)) await tapQuickTarget(page, hit);
    await commitPentTurn(page);
  }
}

test.describe('Pentathlon setup', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
  });

  test('offers both rule sets with their discipline order', async ({ page }) => {
    const cards = page.locator('.pent-preset-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('JDA');
    await expect(cards.nth(0)).toContainText('501');
    await expect(cards.nth(0)).toContainText('HALF-IT');
    await expect(cards.nth(1)).toContainText('i-Pentathlon');
    await expect(cards.nth(1)).toContainText('CORK');
    await expect(cards.nth(1)).toContainText('CRICKET');
  });

  test('exposes 1-player and 2-player modes plus both starter modes', async ({ page }) => {
    const playerCount = page.locator('select').first();
    await expect(playerCount.locator('option')).toHaveText([/1人/, /2人/]);

    await expect(page.getByText('第1種目の先攻')).toBeVisible();
    const starterMode = page.locator('select').nth(2);
    await expect(starterMode.locator('option')).toHaveText(['敗者先攻', '交互先攻']);
  });

  test('hides starter options in 1-player mode', async ({ page }) => {
    await page.locator('select').first().selectOption('1');
    await expect(page.getByText('第1種目の先攻')).toHaveCount(0);
  });
});

test.describe('Pentathlon 2-player progression', () => {
  test('the first checkout wins 501 outright - the opponent does not throw again', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await play501TwoPlayers(page);

    // No hand-off prompt, no further throwing: the discipline result is up straight away.
    await expect(page.getByText('DISCIPLINE COMPLETE')).toBeVisible();
    const rows = page.locator('.pent-result-table .pent-result-row');
    await expect(rows.nth(1)).toContainText('COMPLETE');
    await expect(rows.nth(1)).toContainText('9');
    await expect(rows.nth(2)).toContainText('DNF');
  });

  test('a NON-race discipline still lets a finished player wait while the opponent plays on', async ({
    page,
  }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('.pent-preset-card', { hasText: 'i-Pentathlon' }).click();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    // Cork: both players throw all 5 rounds regardless of how the other is doing.
    for (let round = 0; round < 4; round += 1) {
      await playCorkAttempt(page, ['インナーブル', 'インナーブル', 'インナーブル']);
      await playCorkAttempt(page, ['ミス', 'ミス', 'ミス']);
    }
    await playCorkAttempt(page, ['インナーブル', 'インナーブル', 'インナーブル']);

    // P1 has thrown all 15 darts; P2 must still get their last round.
    await expect(page.locator('.pent-badge.finished')).toHaveCount(1);
    await expect(page.locator('.pent-player.active')).toContainText('プレイヤー2');
  });

  test('loser starts the next discipline', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await play501TwoPlayers(page);

    await expect(page.getByText('DISCIPLINE COMPLETE')).toBeVisible();
    await expect(page.locator('.pent-result-table .pent-result-row').nth(1)).toContainText('COMPLETE');
    // P1 won on darts, so P2 (the loser) starts Half-It.
    await expect(page.locator('.pent-next-starter').last()).toContainText('プレイヤー2 START');
    await expect(page.locator('.pent-next-starter').last()).toContainText('敗者先攻');

    await page.getByRole('button', { name: /次の種目へ/ }).click();
    await expect(page.locator('.pent-aim')).toContainText('プレイヤー2');
  });

  test('alternate mode swaps the starter regardless of who won', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').nth(2).selectOption('alternate');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await play501TwoPlayers(page);

    await expect(page.locator('.pent-next-starter').last()).toContainText('交互先攻');
    await expect(page.locator('.pent-next-starter').last()).toContainText('プレイヤー2 START');
  });
});

test.describe('Pentathlon persistence and undo', () => {
  test('resumes an interrupted session from the same discipline', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await enterPentScore(page, 180);

    const before = await page.evaluate(() => localStorage.getItem('n02-pentathlon-v1'));
    expect(before).toBeTruthy();

    await page.reload();
    await page.locator('.mode-card[data-mode="pentathlon"]').click();
    await page.getByRole('button', { name: /中断したペンタスロンを再開/ }).click();

    // The X01 screen names its discipline in the header centre (種目 n / 5 + the discipline name).
    await expect(page.locator('.n01-leg-center')).toContainText('501');
    await expect(page.locator('.n01-leg-center')).toContainText('1 / 5');
    const after = await page.evaluate(() => localStorage.getItem('n02-pentathlon-v1'));
    expect(after).toBe(before);
  });

  test('does not disturb the existing 01 save data', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await enterGameScore(page, 100);
    const x01Save = await page.evaluate(() => localStorage.getItem('n02-current-v1'));

    await page.goto('/');
    await page.locator('.mode-card[data-mode="pentathlon"]').click();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await enterPentScore(page, 100);

    const x01After = await page.evaluate(() => localStorage.getItem('n02-current-v1'));
    expect(x01After).toBe(x01Save);
  });

  test('undo reverts a staged dart in a dart-hit discipline', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').first().selectOption('1');
    await page.locator('.pent-preset-card', { hasText: 'i-Pentathlon' }).click();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    // Cork: stage a dart via the quick bull pad, then undo it.
    await tapQuickTarget(page, 'インナーブル');
    await expect(page.locator('.pent-pending-chip').first()).toHaveText('BULL');
    await page.getByRole('button', { name: '1投戻す' }).click();
    await expect(page.locator('.pent-pending-chip').first()).toContainText('1投目');
  });
});

test.describe('Pentathlon full session', () => {
  test('plays all five n01 disciplines and shows the final result', async ({ page }) => {
    test.slow();
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('.pent-preset-card', { hasText: 'i-Pentathlon' }).click();
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    const next = () => page.getByRole('button', { name: /次の種目へ|総合リザルトへ/ }).click();

    // 1. Cork: 5 rounds of 3 darts (15 total) at bull via the quick pad - inner=2/outer=1/miss=0.
    await playCorkAttempt(page, [
      'インナーブル',
      'アウターブル',
      'ミス',
      'インナーブル',
      'アウターブル',
      'ミス',
      'インナーブル',
      'アウターブル',
      'ミス',
      'インナーブル',
      'アウターブル',
      'ミス',
      'インナーブル',
      'アウターブル',
      'ミス',
    ]);
    await expect(page.locator('.pent-result-table')).toContainText('15 POINTS');
    await next();

    // 2. 301 (double-in / double-out) - double-in is the player's own responsibility (enter 0 for
    // a visit that failed to open); this opening visit is simply played as a double already.
    await enterPentScore(page, 180);
    await enterPentScore(page, 61);
    await enterPentScore(page, 60);
    await confirmFinish(page);
    await next();

    // 3. Baseball: 9 innings via the four-outcome pad (the inning's number is never typed).
    // Triple + single on the inning number = 4 runs each -> 36 runs.
    for (let inning = 1; inning <= 9; inning++) {
      await expect(page.locator('.pent-aim-target')).toContainText(String(inning));
      await tapBaseballOutcome(page, 'トリプル');
      await tapBaseballOutcome(page, 'シングル');
      await tapBaseballOutcome(page, 'ミス');
      await commitPentTurn(page);
    }
    await expect(page.locator('.pent-result-table')).toContainText('36 RUNS');
    await next();

    // 4. 501 in 9 darts. Measured in darts, so the dart count belongs to the DARTS column alone -
    // the SCORE column stays empty rather than repeating it.
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);
    const x01Row = page.locator('.pent-result-table .pent-result-row').nth(1);
    await expect(x01Row).toContainText('COMPLETE');
    await expect(x01Row).toContainText('9');
    await expect(page.locator('.pent-result-table')).not.toContainText('9 DARTS');
    await next();

    // 5. Cricket: close all seven targets (each round is a fixed 3 darts), on the dedicated
    // scoreboard grid screen (numbers down the middle, standard mark notation).
    await expect(page.locator('.pent-cricket-board')).toBeVisible();
    await enterPentHits(page, ['T20', 'T19', 'T18']);
    await enterPentHits(page, ['T17', 'T16', 'T15']);
    await expect(page.locator('.pent-cricket-glyph[data-marks="3"]')).toHaveCount(6); // 20-15 closed, bull still open
    // Closing BULL closes all seven targets, which finishes Cricket immediately (solo, 0-0 on
    // points) and hands off straight to the discipline result screen - so no further grid assertion
    // after this commit.
    await enterPentHits(page, ['BULL', '25', 'MISS']);
    await next();

    await expect(page.locator('.pent-share-card')).toContainText('PENTATHLON');
    await expect(page.locator('.pent-share-card')).toContainText('n01 / i-Pentathlon');
    await expect(page.locator('.pent-share-card')).toContainText('36 RUNS');
    await expect(page.getByRole('button', { name: 'リザルトカードを共有' })).toBeVisible();
  });

  test('plays all five JDA disciplines via the quick-target pad', async ({ page }) => {
    test.slow();
    await openFreshApp(page);
    await openPentathlon(page);
    // JDA (501 / Half-It / Round-the-Clock ON DOUBLES / Golf / 301) is selected by default.
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    const next = () => page.getByRole('button', { name: /次の種目へ|総合リザルトへ/ }).click();

    // 1. 501 in 9 darts.
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await confirmFinish(page);
    await next();

    // 2. Half-It: 9 rounds, exercising every quick-target shape (number / any-double / any-triple /
    // bull). 40 -S15-> 55 -miss-> 27 -D7(any-double)-> 41 -D17-> 75 -miss-> 37 -T5(any-triple)-> 52
    // -T19-> 109 -miss-> 54 -BULL-> 104.
    await tapQuickTarget(page, 'シングル15');
    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    await tapAnyRingNumber(page, 7);
    await tapAnyRingNumber(page, 'MISS');
    await tapAnyRingNumber(page, 'MISS');
    await commitPentTurn(page);

    await tapQuickTarget(page, 'ダブル17');
    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    await tapAnyRingNumber(page, 5);
    await tapAnyRingNumber(page, 'MISS');
    await tapAnyRingNumber(page, 'MISS');
    await commitPentTurn(page);

    await tapQuickTarget(page, 'トリプル19');
    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    await tapQuickTarget(page, 'インナーブル');
    await tapQuickTarget(page, 'ミス');
    await tapQuickTarget(page, 'ミス');
    await commitPentTurn(page);

    await expect(page.locator('.pent-result-table')).toContainText('104 POINTS');
    await next();

    // 3. Round-the-Clock ON DOUBLES: a perfect 21-dart run, hitting D1/D2/D3 etc. within the SAME
    // turn each time - the quick pad must preview the target advancing mid-turn, not just per-commit.
    for (let n = 1; n <= 18; n += 3) {
      await tapQuickTarget(page, `成功（D${n}）`);
      await tapQuickTarget(page, `成功（D${n + 1}）`);
      await tapQuickTarget(page, `成功（D${n + 2}）`);
      await commitPentTurn(page);
    }
    await tapQuickTarget(page, '成功（D19）');
    await tapQuickTarget(page, '成功（D20）');
    await tapQuickTarget(page, 'インナーブル');
    await commitPentTurn(page);
    // Measured in darts: the count belongs to the DARTS column alone, never repeated in SCORE.
    const rtcRow = page.locator('.pent-result-table .pent-result-row').nth(1);
    await expect(rtcRow).toContainText('COMPLETE');
    await expect(rtcRow).toContainText('21');
    await expect(page.locator('.pent-result-table')).not.toContainText('21 DARTS');
    await next();

    // 4. Golf: 9 holes, a double each for 1 stroke -> best possible round (9 strokes), stopping
    // early after a single dart each time (allowEarlyCommit).
    for (let hole = 1; hole <= 9; hole++) {
      await tapQuickTarget(page, `ダブル${hole}`);
      await commitPentTurn(page);
    }
    await expect(page.locator('.pent-result-table')).toContainText('9 STROKES');
    await next();

    // 5. 301 (double-in/out) - double-in is the player's own responsibility, same as the n01 test.
    // Remaining 60 after the first two visits is checkout-able in as few as 2 darts (e.g. S20+D20),
    // and confirmFinish() picks the fewest-darts option offered, for 3+3+2 = 8 darts total.
    await enterPentScore(page, 180);
    await enterPentScore(page, 61);
    await enterPentScore(page, 60);
    await confirmFinish(page);
    const x301Row = page.locator('.pent-result-table .pent-result-row').nth(1);
    await expect(x301Row).toContainText('COMPLETE');
    await expect(x301Row).toContainText('8');
    await next();

    await expect(page.locator('.pent-share-card')).toContainText('PENTATHLON');
    await expect(page.locator('.pent-share-card')).toContainText('JDA');
  });
});

test.describe('Pentathlon rule popup and arrange-route setting', () => {
  test('the RULES popup shows the rule text for the current discipline', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await openPentRules(page);
    await expect(page.locator('.n01-modal-card h2')).toContainText('501');
    await expect(page.locator('.pent-rules-body')).toContainText('ダブル');
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);
  });

  test('arrange-route suggestions default to off and can be turned on in setup', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').first().selectOption('1'); // 1-player: both visits are the same player
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    // 141 remaining (suggestCheckoutRoute's supported range is <=170) has no shown route by default.
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await expect(page.locator('.checkout-route')).toHaveCount(0);
  });

  test('enabling the arrange-route setting shows a suggested checkout route', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('select').first().selectOption('1'); // 1-player: both visits are the same player
    await page.locator('.toggle-field', { hasText: 'アレンジルート' }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await enterPentScore(page, 180);
    await enterPentScore(page, 180); // -> 141, within suggestCheckoutRoute's range
    await expect(page.locator('.checkout-route').first()).toBeVisible();
  });

  test('shows the score being typed in the live cell of the score sheet, exactly as 通常01 does', async ({
    page,
  }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    const liveCell = page.locator('.n01-score-table td.scored.current input');
    await expect(liveCell).toHaveValue('');
    await page.keyboard.type('18');
    await expect(liveCell).toHaveValue('18');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('483');

    // Backspace clears the entry back out of the cell without committing anything.
    await page.keyboard.type('4');
    await expect(page.locator('.n01-score-table td.scored.current input')).toHaveValue('4');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.n01-score-table td.scored.current input')).toHaveValue('');
  });
});

test.describe('Pentathlon 2-player full sessions', () => {
  /** Commits dart-hit turns with a fixed tap sequence until the discipline result screen appears. */
  async function playUntilResult(
    page: import('@playwright/test').Page,
    tap: () => Promise<void>,
    maxTurns: number,
  ) {
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (await page.locator('.pent-result-table').isVisible()) return;
      await tap();
      await commitPentTurn(page);
    }
    await expect(page.locator('.pent-result-table')).toBeVisible();
  }

  /**
   * Plays 501 to the starter's 9-dart checkout. 501 is a race, so that ends the discipline with the
   * opponent - who threw the identical route but is one visit behind - recorded as DNF.
   */
  async function play501Both(page: import('@playwright/test').Page) {
    for (let visit = 0; visit < 2; visit += 1) {
      await enterPentScore(page, 180);
      await enterPentScore(page, 180);
    }
    await enterPentScore(page, 141);
    await confirmFinish(page);
  }

  test('completes all five JDA disciplines with two players', async ({ page }) => {
    test.slow();
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    const next = () => page.getByRole('button', { name: /次の種目へ|総合リザルトへ/ }).click();

    // 1. 501 - both players take the identical 9-dart route.
    await play501Both(page);
    await next();

    // 2. Half-It - 9 rounds each, every dart a miss (both halve identically).
    await playUntilResult(
      page,
      async () => {
        for (let dart = 0; dart < 3; dart += 1) {
          const anyRing = await page.locator('.pent-number-grid button.wide').count();
          if (anyRing > 0) await tapAnyRingNumber(page, 'MISS');
          else await tapQuickTarget(page, 'ミス');
        }
      },
      24,
    );
    await next();

    // 3. Round-the-Clock ON DOUBLES - RTC has no dart limit, so both players actually work their
    // way through D1..D20 + BULL. The quick pad's "hit" button is always the current target, so
    // tapping it repeatedly walks the sequence for whichever player is throwing.
    await playUntilResult(page, async () => {
      for (let dart = 0; dart < 3; dart += 1) {
        const hit = page.locator('.pent-quick-btn.hit').first();
        if (await hit.isEnabled()) await hit.click();
      }
    }, 20);
    await next();

    // 4. Golf - 9 holes each, one dart per hole (early commit).
    await playUntilResult(page, async () => {
      await tapQuickTarget(page, 'ミス');
    }, 24);
    await next();

    // 5. 301.
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 61);
    await enterPentScore(page, 61);
    await enterPentScore(page, 60);
    await confirmFinish(page);
    await next();

    await expect(page.locator('.pent-share-card')).toContainText('JDA');
    await expect(page.locator('.pent-result-row.total')).toContainText('種目勝利数');
  });

  test('completes all five n01 disciplines with two players', async ({ page }) => {
    test.slow();
    await openFreshApp(page);
    await openPentathlon(page);
    await page.locator('.pent-preset-card', { hasText: 'i-Pentathlon' }).click();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    const next = () => page.getByRole('button', { name: /次の種目へ|総合リザルトへ/ }).click();

    // 1. Cork - 5 rounds of 3 bull darts each.
    await playUntilResult(page, async () => {
      for (let dart = 0; dart < 3; dart += 1) await tapQuickTarget(page, 'ミス');
    }, 16);
    await next();

    // 2. 301.
    await enterPentScore(page, 180);
    await enterPentScore(page, 180);
    await enterPentScore(page, 61);
    await enterPentScore(page, 61);
    await enterPentScore(page, 60);
    await confirmFinish(page);
    await next();

    // 3. Baseball - a tie extends into extra innings, which the engine caps; play until it settles.
    await playUntilResult(page, async () => {
      for (let dart = 0; dart < 3; dart += 1) await tapBaseballOutcome(page, 'ミス');
    }, 30);
    await next();

    // 4. 501.
    await play501Both(page);
    await next();

    // 5. Cricket - both players close 20-15, then the starter takes BULL and wins on points.
    await expect(page.locator('.pent-cricket-board')).toBeVisible();
    await enterPentHits(page, ['T20', 'T19', 'T18']);
    await enterPentHits(page, ['T20', 'T19', 'T18']);
    await enterPentHits(page, ['T17', 'T16', 'T15']);
    await enterPentHits(page, ['T17', 'T16', 'T15']);
    await enterPentHits(page, ['BULL', 'BULL', 'MISS']);
    await expect(page.locator('.pent-result-table')).toBeVisible();
    await next();

    await expect(page.locator('.pent-share-card')).toContainText('n01 / i-Pentathlon');
  });
});
