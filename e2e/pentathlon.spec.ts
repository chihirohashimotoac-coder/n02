import { expect, test } from '@playwright/test';
import {
  commitPentTurn,
  confirmFinish,
  enterGameScore,
  enterPentHits,
  enterPentScore,
  openFreshApp,
  openPentathlon,
  proceedWithDnf,
  tapAnyRingNumber,
  tapBaseballOutcome,
  tapQuickTarget,
  continueOpponentPlay,
} from './helpers';

/** Plays the starter to a 9-dart 501 finish, then the opponent to a slower finish. */
async function play501TwoPlayers(page: import('@playwright/test').Page) {
  await enterPentScore(page, 180); // starter -> 321
  await enterPentScore(page, 26); // opponent -> 475
  await enterPentScore(page, 180); // starter -> 141
  await enterPentScore(page, 26); // opponent -> 449
  await enterPentScore(page, 141); // starter declares finish
  await confirmFinish(page);
  // The starter checked out first: choose to wait for the opponent to also check out (rather than
  // proceeding to the next discipline immediately) so both results are final.
  await continueOpponentPlay(page);
  await enterPentScore(page, 180); // opponent -> 269
  await enterPentScore(page, 180); // opponent -> 89
  await enterPentScore(page, 89);
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
  test('a finished player waits while the opponent completes their own result', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    // P1 checked out first: the hand-off choice names them explicitly before P2 continues.
    await expect(page.locator('.pent-modal-card')).toContainText('プレイヤー1');
    await expect(page.locator('.pent-modal-card')).toContainText('9');
    await continueOpponentPlay(page);

    // P1 is locked at 9 darts; the discipline is NOT over and P2 keeps throwing.
    await expect(page.locator('.n01-player-name').first()).toContainText('FINISHED');
    await expect(page.locator('.n01-left-table').first()).toContainText('9');
    await expect(page.locator('.n01-left-table').first()).toContainText('DARTS');
    await expect(page.locator('.n01-player-name.active')).toContainText('プレイヤー2');
    await expect(page.locator('.n01-game-meta')).toContainText('プレイヤー2');
  });

  test('choosing to proceed ends the discipline immediately, recording the still-playing opponent as DNF', async ({
    page,
  }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    await proceedWithDnf(page);

    await expect(page.getByText('DISCIPLINE COMPLETE')).toBeVisible();
    const rows = page.locator('.pent-result-table .pent-result-row');
    await expect(rows.nth(1)).toContainText('COMPLETE');
    await expect(rows.nth(1)).toContainText('9');
    await expect(rows.nth(2)).toContainText('DNF');
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

    await expect(page.locator('.pent-progress')).toContainText('501');
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
    await expect(page.locator('.pent-cricket-mark.m3')).toHaveCount(6); // 20-15 closed, bull still open
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

    await page.getByRole('button', { name: 'RULES' }).click();
    await expect(page.locator('.n01-modal-card h2')).toContainText('501');
    await expect(page.locator('.pent-rules-body')).toContainText('ダブル');
    await page.getByRole('button', { name: '閉じる' }).click();
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

  test('previews the score only while it is being typed, then hides again', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    const preview = page.locator('.pent-entry-popover');
    await expect(preview).toHaveCount(0);
    await page.keyboard.type('18');
    await expect(preview.locator('strong')).toHaveText('18');
    await page.keyboard.press('Enter');
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.n01-left-table strong').first()).toHaveText('483');

    // Clearing the entry (Backspace to empty) also dismisses it.
    await page.keyboard.type('4');
    await expect(preview.locator('strong')).toHaveText('4');
    await page.keyboard.press('Backspace');
    await expect(preview).toHaveCount(0);
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

  /** Plays one X01 attempt per player - both take the same route, so the discipline is a draw. */
  async function play501Both(page: import('@playwright/test').Page) {
    for (let visit = 0; visit < 2; visit += 1) {
      await enterPentScore(page, 180);
      await enterPentScore(page, 180);
    }
    await enterPentScore(page, 141);
    await confirmFinish(page);
    await continueOpponentPlay(page);
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
    await continueOpponentPlay(page);
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
    await continueOpponentPlay(page);
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

test.describe('Pentathlon X01 DNF safety', () => {
  test('pressing Enter after a checkout continues play instead of marking the opponent DNF', async ({
    page,
  }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    // The primary action is continuing the opponent's play - Enter must take that, never DNF.
    await expect(page.getByRole('dialog')).toContainText('プレイヤー2 のプレイを続ける');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('DISCIPLINE COMPLETE')).toHaveCount(0);
    // Player 2 is still throwing, with no result recorded.
    await expect(page.locator('.n01-player-name.active')).toContainText('プレイヤー2');
    await expect(page.locator('.n01-left-table').last()).toContainText('449');
  });

  test('the DNF choice records nothing until its confirmation is accepted', async ({ page }) => {
    await openFreshApp(page);
    await openPentathlon(page);
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();

    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 180);
    await enterPentScore(page, 26);
    await enterPentScore(page, 141);
    await confirmFinish(page);

    await page.getByRole('button', { name: /をDNFとして次の種目へ進む/ }).click();
    // The confirmation names the player who would be marked DNF.
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText('プレイヤー2');
    await expect(confirm).toContainText('DNF');

    // Cancelling records nothing and hands back to the still-playing player.
    await page.getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByText('DISCIPLINE COMPLETE')).toHaveCount(0);
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('n02-pentathlon-v1');
      return raw ? (JSON.parse(raw).records as unknown[]).length : -1;
    });
    expect(stored).toBe(0);

    // Confirming is what finally records the DNF.
    await page.getByRole('button', { name: /をDNFとして次の種目へ進む/ }).click();
    await page.getByRole('button', { name: /をDNFにして進む/ }).click();
    await expect(page.getByText('DISCIPLINE COMPLETE')).toBeVisible();
    await expect(page.locator('.pent-result-table .pent-result-row').nth(2)).toContainText('DNF');
  });
});
