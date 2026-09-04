import { expect, test, type Page } from '@playwright/test';
import {
  enterCountUpRound,
  keypadExpected,
  openFreshApp,
  openPracticeHub,
  startCountUp as startCountUpGame,
} from './helpers';

/**
 * PRACTICE / COUNT-UP end-to-end coverage. Nothing here touches 01, checkout or Pentathlon: the
 * mode is reached by its own menu card and plays on its own `countup-*` screen.
 */

const enterRound = enterCountUpRound;

async function openPractice(page: Page) {
  await openFreshApp(page);
  await openPracticeHub(page);
}

async function openCountUpSetup(page: Page) {
  await openPractice(page);
  await page.locator('.practice-card[data-practice="count-up"]').click();
  await expect(page.locator('.countup-setup')).toBeVisible();
}

async function startCountUp(page: Page, options: { players?: 1 | 2; bull?: 'separate' | 'fat' } = {}) {
  await openFreshApp(page);
  await startCountUpGame(page, options);
}

/** The visible TOTAL of one player card in the footer. */
function total(page: Page, player = 0) {
  return page.locator('.countup-total-value').nth(player);
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1 || document.body.scrollWidth > doc.clientWidth + 1;
  });
}

test.describe('PRACTICE hub', () => {
  test('is reachable from the top menu and lists COUNT-UP as playable', async ({ page }) => {
    await openPractice(page);
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toContainText('COUNT-UP');
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toContainText('8 ROUNDS');
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('shows CRICKET COUNT-UP and EAGLE\'S EYE as COMING SOON', async ({ page }) => {
    await openPractice(page);
    for (const id of ['cricket-count-up', 'eagles-eye']) {
      const card = page.locator(`.practice-card[data-practice="${id}"]`);
      await expect(card).toContainText('COMING SOON');
      await expect(card).toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('a COMING SOON card cannot navigate anywhere', async ({ page }) => {
    await openPractice(page);
    // They are not buttons at all, so there is nothing to activate by pointer or keyboard.
    await expect(page.locator('.practice-card.coming-soon button')).toHaveCount(0);
    await page.locator('.practice-card[data-practice="eagles-eye"]').click({ force: true });
    await page.locator('.practice-card[data-practice="cricket-count-up"]').click({ force: true });
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();
    await expect(page.locator('.countup-shell')).toHaveCount(0);
    await expect(page.locator('.countup-setup')).toHaveCount(0);
  });

  test('goes back to the top menu', async ({ page }) => {
    await openPractice(page);
    await page.getByRole('button', { name: 'メニューへ戻る' }).click();
    await expect(page.locator('.mode-card').first()).toBeVisible();
  });
});

test.describe('COUNT-UP setup', () => {
  test('defaults to 1 PLAYER and SEPARATE BULL', async ({ page }) => {
    await openCountUpSetup(page);
    await expect(page.getByRole('button', { name: /1 PLAYER/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /2 PLAYERS/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: /SEPARATE BULL/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /FAT BULL/ })).toHaveAttribute('aria-pressed', 'false');
    // 1 PLAYER means exactly one name field.
    await expect(page.locator('.name-input input')).toHaveCount(1);
  });

  test('a blank name falls back to PLAYER 1 / PLAYER 2', async ({ page }) => {
    await openCountUpSetup(page);
    await page.getByRole('button', { name: /2 PLAYERS/ }).click();
    await page.locator('.name-input input').nth(0).fill('   ');
    await page.locator('.name-input input').nth(1).fill('');
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    // R | name | TOTAL | name | TOTAL - each player owns a 得点 column and its running total.
    await expect(page.locator('.countup-table thead th').nth(1)).toHaveText('PLAYER 1');
    await expect(page.locator('.countup-table thead th').nth(3)).toHaveText('PLAYER 2');
  });

  test('goes back to the PRACTICE hub', async ({ page }) => {
    await openCountUpSetup(page);
    await page.getByRole('button', { name: 'PRACTICE へ戻る' }).click();
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();
  });
});

test.describe('COUNT-UP play', () => {
  test('1 player: 8 rounds, TOTAL and PPR update, then the result screen', async ({ page }) => {
    await startCountUp(page);
    await expect(page.locator('.countup-round-badge strong')).toContainText('1');

    await enterRound(page, 60);
    await expect(total(page)).toContainText('60');
    await expect(page.locator('.countup-total-meta')).toContainText('PPR 60.00');
    await expect(page.locator('.countup-round-badge strong')).toContainText('2');

    for (const score of [100, 80, 120, 40, 140, 50]) await enterRound(page, score);
    await expect(page.locator('.countup-round-badge strong')).toContainText('8');
    await expect(total(page)).toContainText('590');

    await enterRound(page, 50);
    await expect(page.locator('.countup-result-shell')).toBeVisible();
    await expect(page.locator('.countup-result-total')).toHaveText('640');
    await expect(page.locator('.countup-result-ppr')).toContainText('80.00');
    // A solo game is never given a winner.
    await expect(page.locator('.countup-verdict')).toHaveCount(0);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('2 players: the turn alternates P1 → P2 within each round', async ({ page }) => {
    await startCountUp(page, { players: 2 });
    const active = page.locator('.countup-total-card.active .countup-total-name');
    await expect(active).toContainText('PLAYER 1');
    await expect(page.locator('.countup-round-badge strong')).toContainText('1');

    await enterRound(page, 60);
    await expect(active).toContainText('PLAYER 2');
    await expect(page.locator('.countup-round-badge strong')).toContainText('1');

    await enterRound(page, 40);
    await expect(active).toContainText('PLAYER 1');
    await expect(page.locator('.countup-round-badge strong')).toContainText('2');
    await expect(total(page, 0)).toContainText('60');
    await expect(total(page, 1)).toContainText('40');
  });

  test('rejects an out-of-range score without changing the game', async ({ page }) => {
    await startCountUp(page);
    await enterRound(page, 181);
    await expect(page.locator('.countup-notice')).toContainText('180');
    await expect(total(page)).toContainText('0');
    await expect(page.locator('.countup-round-badge strong')).toContainText('1');
  });
});

test.describe('COUNT-UP input route', () => {
  test('the on-screen keypad appears only where the device has no physical keyboard', async ({ page }) => {
    await startCountUp(page);
    const keypad = page.locator('.countup-keypad');
    if (await keypadExpected(page)) await expect(keypad).toBeVisible();
    else await expect(keypad).toBeHidden();
  });

  test('PC: the physical keyboard enters, corrects and confirms a round', async ({ page }) => {
    test.skip(await keypadExpected(page), 'this device is served by the on-screen keypad');
    await startCountUp(page);
    await expect(page.locator('.countup-keypad')).toBeHidden();

    // 1 → 0 → 0 → Enter confirms ROUND SCORE 100.
    await page.keyboard.type('100');
    await expect(page.locator('.countup-entry-value')).toHaveText('100');
    await page.keyboard.press('Enter');
    await expect(page.locator('.countup-table td.scored button').first()).toHaveText('100');
    await expect(total(page)).toContainText('100');
    await expect(page.locator('.countup-round-badge strong')).toContainText('2');

    // Backspace and Delete both drop the last digit typed; Escape clears the whole entry.
    await page.keyboard.type('12');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.countup-entry-value')).toHaveText('1');
    await page.keyboard.type('4');
    await page.keyboard.press('Delete');
    await expect(page.locator('.countup-entry-value')).toHaveText('1');
    await page.keyboard.press('Escape');
    await expect(page.locator('.countup-entry-value')).toHaveText('–');

    await page.keyboard.type('140');
    await page.keyboard.press('Enter');
    await expect(total(page)).toContainText('240');

    // U still takes the last round back without touching the on-screen menu.
    await page.keyboard.press('u');
    await expect(total(page)).toContainText('100');
  });

  test('PC: Enter still confirms a score after the footer UNDO button was clicked', async ({ page }) => {
    test.skip(await keypadExpected(page), 'this device is served by the on-screen keypad');
    await startCountUp(page);
    for (const score of ['100', '60']) {
      await page.keyboard.type(score);
      await page.keyboard.press('Enter');
    }
    await expect(total(page)).toContainText('160');

    // Clicking UNDO must not leave the keyboard route aimed at that button: with no on-screen ENTER
    // to fall back on, the next Enter would re-fire UNDO instead of confirming the typed score.
    await page.locator('.countup-menu button', { hasText: 'UNDO' }).click();
    await expect(total(page)).toContainText('100');

    await page.keyboard.type('40');
    await expect(page.locator('.countup-entry-value')).toHaveText('40');
    await page.keyboard.press('Enter');
    await expect(total(page)).toContainText('140');
    await expect(page.locator('.countup-round-badge strong')).toContainText('3');
  });

  test('touch: the on-screen keypad enters a round by tapping', async ({ page }) => {
    test.skip(!(await keypadExpected(page)), 'this device has a physical-keyboard route');
    await startCountUp(page);
    const keypad = page.locator('.countup-keypad');
    await expect(keypad).toBeVisible();

    for (const digit of ['1', '0', '0']) {
      await keypad.locator('button', { hasText: new RegExp(`^${digit}$`) }).first().click();
    }
    await expect(page.locator('.countup-entry-value')).toHaveText('100');
    await keypad.locator('button[aria-label="1文字削除"]').click();
    await expect(page.locator('.countup-entry-value')).toHaveText('10');
    await keypad.locator('button', { hasText: /^0$/ }).click();
    await keypad.locator('button.enter').click();
    await expect(total(page)).toContainText('100');
  });
});

test.describe('COUNT-UP awards', () => {
  const cases = [
    { score: 100, label: 'LOW TON', bull: 'separate' as const },
    { score: 160, label: 'HIGH TON', bull: 'separate' as const },
    { score: 180, label: 'TON 80', bull: 'separate' as const },
    { score: 150, label: 'HAT TRICK', bull: 'fat' as const },
    { score: 150, label: 'THREE IN THE BLACK', bull: 'separate' as const },
  ];

  for (const item of cases) {
    test(`${item.score} with ${item.bull} bull presents ${item.label}`, async ({ page }) => {
      await startCountUp(page, { bull: item.bull });
      await enterRound(page, item.score);
      const card = page.locator('.countup-award-card');
      await expect(card).toBeVisible();
      await expect(card.locator('.countup-award-name')).toHaveText(item.label);
      await expect(card.locator('.countup-award-score')).toHaveText(String(item.score));
    });
  }

  test('99 earns no award at all', async ({ page }) => {
    await startCountUp(page);
    await enterRound(page, 99);
    await expect(page.locator('.countup-award-card')).toHaveCount(0);
  });

  test('does not block the next entry, and disappears on its own', async ({ page }) => {
    await startCountUp(page);
    await enterRound(page, 180);
    await expect(page.locator('.countup-award-card')).toBeVisible();

    // The next score goes in while the presentation is still up.
    await enterRound(page, 60);
    await expect(total(page)).toContainText('240');

    await expect(page.locator('.countup-award-card')).toHaveCount(0, { timeout: 6000 });
  });

  test('a consecutive award replaces the previous one instead of queueing', async ({ page }) => {
    await startCountUp(page);
    await enterRound(page, 100);
    await expect(page.locator('.countup-award-name')).toHaveText('LOW TON');
    await enterRound(page, 180);
    await expect(page.locator('.countup-award-card')).toHaveCount(1);
    await expect(page.locator('.countup-award-name')).toHaveText('TON 80');

    // The replacement restarts the presentation from its own beginning rather than inheriting
    // whatever was left of the first one's time on screen.
    const elapsed = await page
      .locator('.countup-award-card')
      .evaluate((el) => el.getAnimations().map((animation) => Number(animation.currentTime ?? 0)));
    expect(Math.min(...elapsed)).toBeLessThan(1500);
  });

  test('runs one entry-hold-exit animation and is gone after about 3 seconds', async ({ page }) => {
    await startCountUp(page);
    await enterRound(page, 180);
    const card = page.locator('.countup-award-card');
    await expect(card).toBeVisible();

    const animation = await card.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        name: style.animationName,
        seconds: parseFloat(style.animationDuration),
        fill: style.animationFillMode,
      };
    });
    // Entry, hold and exit are one run that spans the whole time the card is up, so the fade-out is
    // actually played on screen instead of the card being cut off mid-animation at unmount.
    expect(animation.name).toBe('countup-award-cycle');
    expect(animation.seconds).toBeGreaterThan(2);
    expect(animation.seconds).toBeLessThan(3);
    expect(animation.fill).toBe('both');

    // Comfortably inside the window it is still up; comfortably past it, it is gone.
    await page.waitForTimeout(1200);
    await expect(card).toBeVisible();
    await expect(card).toHaveCount(0, { timeout: 6000 });
  });
});

test.describe('COUNT-UP awards with reduced motion', () => {
  test('the award is still readable with the motion switched off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startCountUp(page);
    await enterRound(page, 180);
    const card = page.locator('.countup-award-card');
    await expect(card.locator('.countup-award-name')).toHaveText('TON 80');
    await expect(card.locator('.countup-award-score')).toHaveText('180');
    expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    expect(await card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

    // Still non-blocking: the next round goes in exactly as before.
    await enterRound(page, 60);
    await expect(total(page)).toContainText('240');
  });
});

test.describe('COUNT-UP editing', () => {
  test('a past round can be corrected, recalculating TOTAL, PPR and awards without an award replay', async ({
    page,
  }) => {
    await startCountUp(page, { bull: 'fat' });
    await enterRound(page, 120);
    await enterRound(page, 60);
    await expect(total(page)).toContainText('180');
    // Let the LOW TON presentation clear so the edit can be seen not to replay one.
    await expect(page.locator('.countup-award-card')).toHaveCount(0, { timeout: 6000 });

    await page.locator('.countup-table td.scored button').first().click();
    await page.getByLabel('修正後のラウンド得点').fill('150');
    await page.getByRole('button', { name: '修正して再計算' }).click();

    await expect(total(page)).toContainText('210');
    await expect(page.locator('.countup-total-meta')).toContainText('PPR 105.00');
    await expect(page.locator('.countup-award-card')).toHaveCount(0);

    // The recalculated award count shows up on the result screen: HAT TRICK, no LOW TON.
    for (const score of [0, 0, 0, 0, 0, 0]) await enterRound(page, score);
    await expect(page.locator('.countup-award-list')).toContainText('HAT TRICK');
    await expect(page.locator('.countup-award-list')).not.toContainText('LOW TON');
  });

  test('a round can still be corrected after ROUND 8', async ({ page }) => {
    await startCountUp(page);
    for (let round = 0; round < 8; round += 1) await enterRound(page, 60);
    await expect(page.locator('.countup-result-total')).toHaveText('480');

    await page.locator('.countup-round-list button').first().click();
    await page.getByLabel('修正後のラウンド得点').fill('180');
    await page.getByRole('button', { name: '修正して再計算' }).click();
    await expect(page.locator('.countup-result-total')).toHaveText('600');
    await expect(page.locator('.countup-result-ppr')).toContainText('75.00');
    await expect(page.locator('.countup-award-list')).toContainText('TON 80');
  });

  test('UNDO takes back the previous entry', async ({ page }) => {
    await startCountUp(page);
    await enterRound(page, 60);
    await enterRound(page, 40);
    await expect(total(page)).toContainText('100');
    await page.locator('.countup-menu button', { hasText: 'UNDO' }).click();
    await expect(total(page)).toContainText('60');
  });
});

test.describe('COUNT-UP result', () => {
  test('2 players: the higher TOTAL is the winner', async ({ page }) => {
    await startCountUp(page, { players: 2 });
    for (let round = 0; round < 8; round += 1) {
      await enterRound(page, 60);
      await enterRound(page, 40);
    }
    await expect(page.locator('.countup-verdict')).toContainText('WINNER');
    await expect(page.locator('.countup-verdict strong')).toHaveText('PLAYER 1');
    await expect(page.locator('.countup-result-total').first()).toHaveText('480');
  });

  test('2 players: an equal TOTAL is a DRAW', async ({ page }) => {
    await startCountUp(page, { players: 2 });
    for (let round = 0; round < 8; round += 1) {
      await enterRound(page, 60);
      await enterRound(page, 60);
    }
    await expect(page.locator('.countup-verdict')).toHaveClass(/draw/);
    await expect(page.locator('.countup-verdict strong')).toHaveText('DRAW');
  });

  test('SAME SETTINGS starts a fresh game with the same player count and names', async ({ page }) => {
    await openCountUpSetup(page);
    await page.getByRole('button', { name: /2 PLAYERS/ }).click();
    await page.getByRole('button', { name: /FAT BULL/ }).click();
    await page.locator('.name-input input').nth(0).fill('あお');
    await page.locator('.name-input input').nth(1).fill('みどり');
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();

    for (let round = 0; round < 8; round += 1) {
      await enterRound(page, 60);
      await enterRound(page, 40);
    }
    await expect(page.locator('.countup-verdict strong')).toHaveText('あお');

    await page.getByRole('button', { name: /SAME SETTINGS/ }).click();
    await expect(page.locator('.countup-table thead th').nth(1)).toHaveText('あお');
    await expect(page.locator('.countup-table thead th').nth(3)).toHaveText('みどり');
    await expect(total(page, 0)).toContainText('0');
    await expect(page.locator('.countup-round-badge strong')).toContainText('1');
  });

  test('goes back to the COUNT-UP setup, where the game is listed under RECENT RESULTS', async ({ page }) => {
    await startCountUp(page);
    for (let round = 0; round < 8; round += 1) await enterRound(page, 60);
    await page.getByRole('button', { name: 'COUNT-UP 設定へ' }).click();
    await expect(page.locator('.countup-setup')).toBeVisible();
    await expect(page.locator('.countup-history-row').first()).toContainText('480');
  });

  test('goes back to the PRACTICE hub', async ({ page }) => {
    await startCountUp(page);
    for (let round = 0; round < 8; round += 1) await enterRound(page, 60);
    await page.getByRole('button', { name: 'PRACTICE へ戻る' }).click();
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();
  });
});

test.describe('COUNT-UP storage', () => {
  test('records only completed games, newest first, capped at 10', async ({ page }) => {
    await openFreshApp(page);
    // Nine older games are seeded directly; the tenth and eleventh are played, so the cap is
    // exercised against real gameplay output.
    await page.evaluate(() => {
      const seeded = Array.from({ length: 9 }, (_, index) => ({
        date: `2026-01-0${index + 1}T00:00:00.000Z`,
        playerCount: 1,
        bullMode: 'separate',
        players: [
          {
            name: `SEED ${index + 1}`,
            total: index,
            ppr: 0,
            awards: {
              LOW_TON: 0,
              HIGH_TON: 0,
              TON_80: 0,
              HAT_TRICK: 0,
              THREE_IN_THE_BLACK: 0,
            },
            roundScores: [],
          },
        ],
      }));
      localStorage.setItem('n02-practice-countup-history-v1', JSON.stringify(seeded));
    });
    await page.reload();

    await page.locator('.mode-card[data-mode="practice"]').click();
    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();

    // An abandoned game is never stored.
    await enterRound(page, 60);
    await page.locator('.countup-menu button', { hasText: 'PRACTICE' }).click();
    await page.getByRole('button', { name: '終了してPRACTICEへ' }).click();
    await expect(page.locator('.practice-card[data-practice="count-up"]')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('n02-practice-countup-history-v1')!).length)).toBe(9);

    await page.locator('.practice-card[data-practice="count-up"]').click();
    for (const rounds of [70, 90]) {
      await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
      for (let round = 0; round < 8; round += 1) await enterRound(page, rounds);
      await page.getByRole('button', { name: 'COUNT-UP 設定へ' }).click();
      await expect(page.locator('.countup-setup')).toBeVisible();
    }

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('n02-practice-countup-history-v1')!),
    );
    expect(stored).toHaveLength(10);
    expect(stored[0].players[0].total).toBe(720); // newest first: 8 × 90
    expect(stored[1].players[0].total).toBe(560); // 8 × 70
    await expect(page.locator('.countup-history-row').first()).toContainText('720');
    await expect(page.locator('.countup-history > li')).toHaveCount(10);
  });

  test('leaves the pre-existing n02 storage keys untouched', async ({ page }) => {
    await openFreshApp(page);
    await page.evaluate(() => {
      localStorage.setItem('n02-current-v1', '{"sentinel":1}');
      localStorage.setItem('n02-history-v1', '[{"sentinel":2}]');
      localStorage.setItem('n02-pentathlon-v1', '{"sentinel":3}');
    });

    await page.locator('.mode-card[data-mode="practice"]').click();
    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    for (let round = 0; round < 8; round += 1) await enterRound(page, 100);
    await expect(page.locator('.countup-result-total')).toBeVisible();

    const keys = await page.evaluate(() => ({
      current: localStorage.getItem('n02-current-v1'),
      history: localStorage.getItem('n02-history-v1'),
      pentathlon: localStorage.getItem('n02-pentathlon-v1'),
    }));
    expect(keys.current).toBe('{"sentinel":1}');
    expect(keys.history).toBe('[{"sentinel":2}]');
    expect(keys.pentathlon).toBe('{"sentinel":3}');
  });

  test('an in-progress game is never persisted, and a reload does not resume it', async ({ page }) => {
    await startCountUp(page);
    await enterRound(page, 100);
    await enterRound(page, 100);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).not.toContain('n02-practice-countup-history-v1');

    await page.reload();
    await expect(page.locator('.mode-card').first()).toBeVisible();
    await expect(page.locator('.countup-shell')).toHaveCount(0);
  });
});
