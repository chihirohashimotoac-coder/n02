import { expect, test, type Page } from '@playwright/test';
import { confirmFinish, enterGameScore, enterPentScore, openFreshApp, openSingleGame } from './helpers';

/**
 * The big remaining numbers of 通常01・チェックアウト練習・Pentathlon 301/501 roll briefly into a
 * newly committed value. Purely a display: the game state, the save and every control are already
 * final the moment a visit is committed, and only the digits catch up over about 400ms.
 *
 * What is pinned here is what the player relies on: only the thrower's number rolls, it always lands
 * on the real value, the DOM text is the real value throughout, nothing on the screen moves, nothing
 * waits for it, and anything but an ordinary commit shows the number at once.
 */

const consoleProblems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  consoleProblems.set(page, problems);
  page.on('console', (message) => {
    if (message.type() === 'error' || /ResizeObserver/.test(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(consoleProblems.get(page) ?? []).toEqual([]);
});

const remaining = (page: Page) => page.locator('.n01-left-table strong');

interface Frame {
  t: number;
  strongs: Array<{ text: string; reels: number; rect: number[] }>;
  durations: number[];
  legResult: boolean;
  shell: boolean;
}

/** Samples every animation frame for `ms`, starting now. Read the result with readFrames(). */
async function startFrames(page: Page, ms = 900) {
  await page.evaluate((duration) => {
    const frames: unknown[] = [];
    (window as unknown as { __frames: unknown[] }).__frames = frames;
    const start = performance.now();
    const tick = () => {
      frames.push({
        t: Math.round(performance.now() - start),
        strongs: [...document.querySelectorAll('.n01-left-table strong')].map((strong) => {
          const box = strong.getBoundingClientRect();
          return {
            text: strong.textContent,
            reels: strong.querySelectorAll('.remaining-odometer-reel').length,
            rect: [box.left, box.top, box.width, box.height],
          };
        }),
        // Only the reels' own animations: the page runs others (the THROW highlight, transitions).
        durations: document
          .getAnimations()
          .filter((animation) =>
            (animation.effect as KeyframeEffect | null)?.target?.classList.contains('remaining-odometer-reel'),
          )
          .map((animation) => Number((animation.effect as KeyframeEffect).getTiming().duration)),
        legResult: document.querySelector('.result-card') !== null,
        shell: document.querySelector('.n01-game-shell') !== null,
      });
      if (performance.now() - start < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function readFrames(page: Page, ms = 900): Promise<Frame[]> {
  await page.waitForTimeout(ms + 100);
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
}

/** Types a score and commits it from the keyboard, the fastest way a player can. */
async function typeScore(page: Page, score: number) {
  await page.keyboard.type(String(score));
  await page.keyboard.press('Enter');
}

const rolling = (frames: Frame[], player: number) => frames.filter((frame) => frame.strongs[player]?.reels > 0);

async function start01(page: Page, options: { start?: number; com?: boolean } = {}) {
  await openFreshApp(page);
  await page.locator('.field select').first().selectOption(String(options.start ?? 501));
  if (options.com) await page.locator('.toggle-field', { hasText: 'COM対戦' }).nth(1).locator('input').check();
  await page.getByRole('button', { name: /ゲームを開始/ }).click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();
}

test.describe('通常01', () => {
  test("rolls only the thrower's number, for about 400ms, and lands on the real value", async ({ page }) => {
    await start01(page);
    const settled = await remaining(page).evaluateAll((all) =>
      all.map((strong) => strong.getBoundingClientRect().toJSON()),
    );
    await startFrames(page);
    await typeScore(page, 100); // プレイヤー1 501 -> 401; プレイヤー2 is up next
    const frames = await readFrames(page);

    const rolled = rolling(frames, 0);
    expect(rolled.length).toBeGreaterThan(5);
    // Nobody else moves: not the opponent, who is the one now throwing.
    expect(rolling(frames, 1)).toHaveLength(0);
    // The whole roll, stagger included, is 400ms - and nothing is added before or after it.
    expect(Math.max(...rolled.flatMap((frame) => frame.durations))).toBe(400);
    const span = rolled[rolled.length - 1].t - rolled[0].t;
    expect(span).toBeGreaterThan(300);
    expect(span).toBeLessThan(520);
    // The DOM text is the official value on every frame, and the numbers never move or resize.
    for (const frame of rolled) {
      expect(frame.strongs.map((strong) => strong.text)).toEqual(['401', '501']);
      frame.strongs.forEach((strong, index) => {
        const box = settled[index];
        // 401 is as wide as 501 in tabular numerals, so the settled box is the box to hold to.
        expect(strong.rect).toEqual([box.left, box.top, box.width, box.height]);
      });
    }
    // Landed: back to the plain number, nothing left running.
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '401');
    expect(await page.locator('.remaining-odometer-reel').count()).toBe(0);
  });

  test('lands 3→2 and 4→3 digits without a leading zero, and does not roll a 0 or a bust', async ({ page }) => {
    await start01(page, { start: 1101 });
    await startFrames(page);
    await typeScore(page, 180); // 1101 -> 921
    let frames = await readFrames(page);
    expect(rolling(frames, 0)[0].strongs[0]).toMatchObject({ text: '921', reels: 3 });
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '921');

    await startFrames(page);
    await typeScore(page, 0); // プレイヤー2 stays on 1101
    frames = await readFrames(page);
    expect(rolling(frames, 0)).toHaveLength(0);
    expect(rolling(frames, 1)).toHaveLength(0);

    for (const score of [180, 0, 180, 0, 180, 0]) await typeScore(page, score); // 921 -> 381
    await typeScore(page, 180); // 381 -> 201
    await typeScore(page, 0);
    await typeScore(page, 121); // 201 -> 80
    await expect(remaining(page).first()).toHaveText('80');
    await typeScore(page, 0);

    await startFrames(page);
    await typeScore(page, 100); // 80: a bust
    frames = await readFrames(page);
    await expect(page.locator('.n01-notice')).toContainText('バスト');
    expect(rolling(frames, 0)).toHaveLength(0);
    expect(rolling(frames, 1)).toHaveLength(0);
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '80');
  });

  test('a 180 → 80 roll uses two columns', async ({ page }) => {
    await start01(page);
    for (const score of [180, 0, 141, 0]) await typeScore(page, score); // プレイヤー1 on 180
    await expect(remaining(page).first()).toHaveText('180');
    await startFrames(page);
    await typeScore(page, 100);
    const frames = await readFrames(page);
    expect(rolling(frames, 0)[0].strongs[0]).toMatchObject({ text: '80', reels: 2 });
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '80');
  });

  test('a checkout rolls to 0 behind the Leg result, which comes up at once', async ({ page }) => {
    await start01(page);
    for (const score of [180, 0, 180, 0, 101, 0]) await typeScore(page, score); // プレイヤー1 on 40
    await expect(remaining(page).first()).toHaveText('40');
    await page.keyboard.type('40');
    await page.keyboard.press('Enter');
    await expect(page.locator('.n01-modal-card', { hasText: '上がり本数' })).toBeVisible();
    await startFrames(page);
    await page.keyboard.press('1');
    const frames = await readFrames(page);
    const zero = frames.filter((frame) => frame.strongs[0]?.text === '0');
    // The very first frame showing the 0 already shows the Leg result: nothing waits for the roll.
    expect(zero[0].legResult).toBe(true);
    const rolled = rolling(frames, 0);
    expect(rolled.length).toBeGreaterThan(0);
    expect(rolled[0].strongs[0]).toMatchObject({ text: '0', reels: 1 });
    await expect(page.locator('.result-card')).toBeVisible();
  });

  test('undo in the middle of a roll shows the real number at once', async ({ page }) => {
    await start01(page);
    await startFrames(page);
    await typeScore(page, 100);
    await page.keyboard.press('u');
    const frames = await readFrames(page);
    // Whether or not a frame caught the 401 before the undo landed, from the undo on there is never
    // a reel again and never anything but 501.
    const after = frames.slice(frames.map((frame) => frame.strongs[0].text).lastIndexOf('401') + 1);
    expect(after.length).toBeGreaterThan(10);
    for (const frame of after) expect(frame.strongs[0]).toMatchObject({ text: '501', reels: 0 });
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '501');
  });

  test('input is never held back: two quick visits both count, the latest roll wins', async ({ page }) => {
    await start01(page);
    await startFrames(page);
    await typeScore(page, 60); // プレイヤー1 -> 441
    await typeScore(page, 45); // プレイヤー2 -> 456, while 441 may still be rolling
    const frames = await readFrames(page);
    expect(rolling(frames, 1).length).toBeGreaterThan(0);
    await expect(remaining(page)).toHaveText(['441', '456']);
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '441');
    await expect(remaining(page).nth(1)).toHaveJSProperty('innerHTML', '456');
    // Ten rapid visits: the state takes every one of them, and nothing is left queued.
    for (const score of [60, 60, 60, 60, 60, 60, 60, 60]) await typeScore(page, score);
    await expect(remaining(page)).toHaveText(['201', '216']);
    await page.waitForTimeout(500);
    expect(await page.locator('.remaining-odometer-reel').count()).toBe(0);
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '201');
  });

  test('a past-score correction and a resumed save show the number at once', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 100); // プレイヤー1 -> 401
    await enterGameScore(page, 50); // プレイヤー2 -> 451
    await page.waitForTimeout(500);

    await page.locator('.n01-score-table td.scored button').first().click();
    await page.locator('.n01-modal-card input[type="number"]').fill('140');
    await startFrames(page);
    await page.getByRole('button', { name: '修正して再計算' }).click();
    let frames = await readFrames(page);
    await expect(remaining(page).first()).toHaveText('361');
    expect(rolling(frames, 0)).toHaveLength(0);
    expect(rolling(frames, 1)).toHaveLength(0);

    await page.reload();
    await startFrames(page, 1500);
    await page.getByRole('button', { name: /保存した対戦を再開/ }).click();
    frames = await readFrames(page, 1500);
    await expect(remaining(page)).toHaveText(['361', '451']);
    expect(frames.some((frame) => frame.strongs.some((strong) => strong.reels > 0))).toBe(false);
  });

  test('a COM visit rolls the COM player, with its timing unchanged', async ({ page }) => {
    await page.addInitScript(() => {
      // A fixed stream of "random" numbers, so the COM visit is the same every run.
      let seed = 7;
      Math.random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
    });
    await start01(page, { com: true });
    await startFrames(page, 1600);
    await typeScore(page, 60);
    const frames = await readFrames(page, 1600);
    const after = await remaining(page).allTextContents();
    expect(after[0]).toBe('441');
    // With this seed the COM scores, so its own number has to roll.
    expect(after[1]).not.toBe('501');
    const comRoll = rolling(frames, 1);
    expect(comRoll.length).toBeGreaterThan(0);
    expect(comRoll[0].strongs[1].text).toBe(after[1]);
    // The COM still takes its turn 700ms after the hand-over, not 700ms after a roll.
    const firstOwn = rolling(frames, 0)[0].t;
    expect(comRoll[0].t - firstOwn).toBeGreaterThan(550);
    expect(comRoll[0].t - firstOwn).toBeLessThan(1000);
  });

  test('prefers-reduced-motion shows every new number at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await start01(page);
    await startFrames(page);
    await typeScore(page, 100);
    const frames = await readFrames(page);
    expect(frames.some((frame) => frame.strongs.some((strong) => strong.reels > 0))).toBe(false);
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '401');
  });
});

test.describe('チェックアウト練習', () => {
  test('rolls the thrower to the new remaining, and to 0 on the checkout', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.locator('.field', { hasText: '出題下限' }).locator('input').fill('121');
    await page.locator('.field', { hasText: '出題上限' }).locator('input').fill('121');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();

    await startFrames(page);
    await typeScore(page, 60); // 121 -> 61
    let frames = await readFrames(page);
    expect(rolling(frames, 0)[0].strongs[0]).toMatchObject({ text: '61', reels: 2 });
    expect(rolling(frames, 1)).toHaveLength(0);

    await typeScore(page, 0);
    await page.keyboard.type('61');
    await page.keyboard.press('Enter');
    await startFrames(page);
    await page.keyboard.press('2');
    frames = await readFrames(page);
    expect(rolling(frames, 0)[0].strongs[0]).toMatchObject({ text: '0', reels: 1 });
    expect(frames.find((frame) => frame.strongs[0]?.text === '0')?.legResult).toBe(true);
  });
});

test.describe('Pentathlon 301/501', () => {
  test('two players: each roll belongs to whoever threw', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'JDA 501');
    await page.locator('select').first().selectOption('2');
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();

    await startFrames(page);
    await typeScore(page, 180); // starter 501 -> 321
    let frames = await readFrames(page);
    expect(rolling(frames, 0)[0].strongs[0]).toMatchObject({ text: '321', reels: 3 });
    expect(rolling(frames, 1)).toHaveLength(0);

    await startFrames(page);
    await typeScore(page, 26); // opponent 501 -> 475
    frames = await readFrames(page);
    expect(rolling(frames, 1)[0].strongs[1]).toMatchObject({ text: '475', reels: 3 });
    expect(rolling(frames, 0)).toHaveLength(0);

    // UNDO from the keyboard: back to 501 at once.
    await startFrames(page);
    await page.keyboard.press('u');
    frames = await readFrames(page);
    await expect(remaining(page)).toHaveText(['321', '501']);
    expect(frames.some((frame) => frame.strongs.some((strong) => strong.reels > 0))).toBe(false);
  });

  test('one player, and a checkout that ends the discipline straight away', async ({ page }) => {
    await openFreshApp(page);
    await openSingleGame(page, 'JDA 501');
    await page.locator('select').first().selectOption('1');
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();

    await startFrames(page);
    await enterPentScore(page, 180);
    const frames = await readFrames(page);
    expect(rolling(frames, 0)[0].strongs[0]).toMatchObject({ text: '321', reels: 3 });
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '321');

    await enterPentScore(page, 180);
    await enterPentScore(page, 141);
    await startFrames(page);
    await confirmFinish(page);
    const finish = await readFrames(page);
    // The result screen replaces the play screen in the same update: the play screen is never seen
    // holding a 0 for the roll's sake.
    expect(finish.some((frame) => frame.shell && frame.strongs[0]?.text === '0')).toBe(false);
    expect(finish[finish.length - 1].shell).toBe(false);
    await expect(page.getByText('GAME COMPLETE')).toBeVisible();
  });

  test('the full Pentathlon opens on 501 and rolls the same way', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card[data-mode="pentathlon"]').click();
    await page.getByRole('button', { name: /ペンタスロンを開始/ }).click();
    await expect(page.locator('.pent-x01-shell')).toBeVisible();
    await startFrames(page);
    await typeScore(page, 140);
    const frames = await readFrames(page);
    expect(rolling(frames, 0)[0].strongs[0]).toMatchObject({ text: '361', reels: 3 });
    await expect(remaining(page).first()).toHaveJSProperty('innerHTML', '361');
  });
});
