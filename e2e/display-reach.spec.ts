import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { confirmFinish, enterGameScore, openSingleGame } from './helpers';
import {
  LONG_NAMES,
  NORMAL_NAMES,
  pentathlonAtCricket,
  pentathlonUntil,
  x01FreshMatch,
  x01MatchBeforeFinalLeg,
} from './engineStates';
import { expectReachableWithoutScrolling, reach, reachAndTap } from './reach';

/**
 * Every control on the result cards, the play menus and the 総合 CRICKET board can actually be
 * reached and pressed, on every required screen size (the reach-* projects in playwright.config.ts).
 *
 * The states are produced by the engines (engineStates.ts), saved where the app saves them and
 * opened through the app's own 再開 buttons; the final leg / the leg under test is then thrown
 * through the UI. See reach.ts for what "reached" means - in short: the whole control is inside
 * the viewport and every clipping ancestor, after real wheel / touch scrolling only, and nothing
 * is painted over it where it is tapped. Each tap is checked for what it did.
 */

type Theme = 'clean' | 'neon' | 'navy';

/** Opens the app on a clean storage holding only `saved` (key -> value) and the theme. */
async function openSaved(page: Page, saved: Record<string, unknown>, theme: Theme = 'clean') {
  await page.goto('/');
  await page.evaluate(
    ([entries, themeName]) => {
      localStorage.clear();
      for (const [key, json] of entries) localStorage.setItem(key, json);
      localStorage.setItem('n02-theme-v1', themeName);
    },
    [Object.entries(saved).map(([key, value]) => [key, JSON.stringify(value)]), theme] as const,
  );
  await page.reload();
  await page.waitForSelector('.mode-card');
}

async function resumeX01(page: Page, state: unknown, theme?: Theme) {
  await openSaved(page, { 'n02-current-v1': state }, theme);
  await page.locator('.resume-button').click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();
}

async function resumePentathlon(page: Page, session: unknown, theme?: Theme) {
  await openSaved(page, { 'n02-pentathlon-v1': session }, theme);
  await page.locator('.mode-card[data-mode="pentathlon"]').click();
  await page.getByRole('button', { name: /中断したペンタスロンを再開/ }).click();
}

/** Throws one leg for the player whose turn it is, finishing it through the 上がり本数 dialog. */
async function throwWinningLeg(page: Page, mode: '01' | 'checkout', remaining: number, testInfo: TestInfo) {
  if (mode === '01') {
    for (const score of [180, 26, 180, 26]) await enterGameScore(page, score);
    await enterGameScore(page, 141);
  } else {
    await enterGameScore(page, remaining);
  }
  // The 上がり本数 dialog is a menu-list card too: its 戻る must be reachable as well.
  const finishDialog = page.locator('.n01-modal-card.menu-list');
  await expect(finishDialog).toBeVisible();
  for (const button of await finishDialog.locator(':scope > button').all()) await reach(page, button, testInfo);
  await confirmFinish(page);
}

/** Reaches every one of `targets`, top to bottom. */
async function reachAll(page: Page, targets: Locator, testInfo: TestInfo) {
  const all = await targets.all();
  expect(all.length).toBeGreaterThan(0);
  for (const target of all) await reach(page, target, testInfo);
}

/** Decodes a PNG in the page and returns its size plus how much of its lowest tenth is painted. */
async function inspectPng(page: Page, base64: string) {
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const band = Math.max(1, Math.floor(canvas.height / 10));
    const pixels = context.getImageData(0, canvas.height - band, canvas.width, band).data;
    let painted = 0;
    const colours = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0) painted += 1;
      colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      bottomPainted: painted / (pixels.length / 4),
      bottomColours: colours.size,
    };
  }, base64);
}

const RESULT_SCENARIOS = [
  { targetLegs: 2, loserLegs: 0, names: NORMAL_NAMES, theme: 'clean' as Theme, exit: 'menu' },
  { targetLegs: 3, loserLegs: 0, names: NORMAL_NAMES, theme: 'navy' as Theme, exit: 'new' },
  { targetLegs: 7, loserLegs: 0, names: NORMAL_NAMES, theme: 'neon' as Theme, exit: 'menu' },
  { targetLegs: 10, loserLegs: 0, names: NORMAL_NAMES, theme: 'clean' as Theme, exit: 'new' },
  // A close match: 19 legs in the list.
  { targetLegs: 10, loserLegs: 9, names: NORMAL_NAMES, theme: 'clean' as Theme, exit: 'menu' },
  { targetLegs: 3, loserLegs: 2, names: LONG_NAMES, theme: 'clean' as Theme, exit: 'new' },
] as const;

for (const mode of ['01', 'checkout'] as const) {
  const label = mode === '01' ? '通常01' : 'チェックアウト練習';

  test.describe(`${label}: 結果カード`, () => {
    for (const scenario of RESULT_SCENARIOS) {
      const name = `${scenario.targetLegs}Leg先取 ${scenario.targetLegs}-${scenario.loserLegs}・${scenario.names === LONG_NAMES ? '18文字名' : '通常名'}・${scenario.theme}`;
      test(`D01 最終リザルト（${name}）: 統計・Leg一覧・3つの操作に到達でき、押した結果が正しい`, async ({ page }, testInfo) => {
        const state = x01MatchBeforeFinalLeg({ mode, ...scenario });
        await resumeX01(page, state, scenario.theme);
        await throwWinningLeg(page, mode, state.players[state.active].remaining, testInfo);

        const card = page.locator('.result-card.match-summary');
        await expect(card).toBeVisible();
        // The final leg's starter wins it (engineStates.ts), so the score reads from player 1's side.
        const [left, right] =
          state.active === 0
            ? [scenario.targetLegs, scenario.loserLegs]
            : [scenario.loserLegs, scenario.targetLegs];
        await expect(card.locator('.match-legs-score')).toHaveText(`${left} - ${right}`);

        await reachAll(page, card.locator('.match-stats-block .n01-stats-row'), testInfo);
        const legRows = card.locator('.leg-stats-table tbody tr');
        await expect(legRows).toHaveCount(scenario.targetLegs + scenario.loserLegs);
        await reachAll(page, legRows, testInfo);

        // Share: a real tap, then the image it produced must hold the whole card, not a blank
        // or cut-off one. Tapped once the card's 0.32s entrance animation has finished, as a person
        // would: the snapshot copies the card's opacity, so a tap while it is still fading in (well
        // under half a second after it appears) yields a transparent image - not this PR's change.
        await card.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
        const fullHeight = await card.evaluate((el) => el.getBoundingClientRect().height + el.scrollHeight - el.clientHeight);
        const downloadPromise = page.waitForEvent('download');
        await reachAndTap(page, card.getByRole('button', { name: 'リザルトカードを共有' }), testInfo);
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('n02-result.png');
        const png = await inspectPng(page, (await readFile(await download.path())).toString('base64'));
        const scale = png.width / Math.ceil(await card.evaluate((el) => el.getBoundingClientRect().width));
        expect(png.height / scale).toBeGreaterThanOrEqual(Math.ceil(fullHeight) - 2);
        expect(png.bottomPainted).toBeGreaterThan(0.5);
        expect(png.bottomColours).toBeGreaterThan(2);

        await reach(page, card.getByRole('button', { name: /新しい対戦を始める/ }), testInfo);
        await reach(page, card.getByRole('button', { name: 'メニューへ戻る' }), testInfo);
        const exit =
          scenario.exit === 'menu'
            ? card.getByRole('button', { name: 'メニューへ戻る' })
            : card.getByRole('button', { name: /新しい対戦を始める/ });
        await reachAndTap(page, exit, testInfo);
        await expect(page.locator('.mode-card').first()).toBeVisible();
        await expect(page.locator('.resume-button')).toHaveCount(0);
      });
    }

    test('D03 途中Leg結果: 「次のLegへ」と「戻る（本数を選び直す）」に到達でき、どちらも働く', async ({ page }, testInfo) => {
      for (const names of [NORMAL_NAMES, LONG_NAMES]) {
        await test.step(names[0], async () => {
          const state = x01FreshMatch(mode, 3, names);
          await resumeX01(page, state);
          const remaining = state.players[state.active].remaining;
          await throwWinningLeg(page, mode, remaining, testInfo);

          // DialogShell puts the dialog role on the card itself.
          const card = page.getByRole('dialog', { name: 'Leg結果' });
          await expect(card).toHaveClass(/result-card/);
          await reach(page, card.getByRole('button', { name: /次のLegへ/ }), testInfo);

          // 戻る un-finishes the leg: the checkout is taken back and the remaining score returns.
          await reachAndTap(page, card.getByRole('button', { name: /戻る（本数を選び直す）/ }), testInfo);
          await expect(card).toHaveCount(0);
          await expect(page.locator('.n01-left-table strong').nth(state.active)).toHaveText(
            String(mode === '01' ? 141 : remaining),
          );
          await expect(page.locator('.n01-score-scroll')).toBeFocused();

          // Finish it again, and this time go on to the next leg.
          await enterGameScore(page, mode === '01' ? 141 : remaining);
          await confirmFinish(page);
          await expect(card).toBeVisible();
          await reachAndTap(page, card.getByRole('button', { name: /次のLegへ/ }), testInfo);
          await expect(card).toHaveCount(0);
          await expect(page.locator('.n01-leg-center small')).toHaveText('LEG 2');
          await expect(page.locator('.n01-leg-center strong')).toHaveText(state.active === 0 ? '1 - 0' : '0 - 1');
        });
      }
    });
  });

  test.describe(`${label}: ☰ メニュー`, () => {
    test('D04 全項目と「戻る」に到達でき、戻る・Legを終了が働く', async ({ page }, testInfo) => {
      for (const theme of ['clean', 'neon'] as const) {
        await test.step(theme, async () => {
          // A leg already finished, so 前のLegをやり直す / 直前の入力を戻す are live rows too.
          const state = x01MatchBeforeFinalLeg({ mode, targetLegs: 3, loserLegs: 1 });
          await resumeX01(page, state, theme);
          await enterGameScore(page, mode === '01' ? 60 : 0);

          const menuButton = page.locator('.n01-menu-table button', { hasText: '☰' });
          await menuButton.click();
          const card = page.locator('.n01-modal-card.menu-list');
          await expect(card).toBeVisible();
          await reachAll(page, card.locator('.n01-darts-inline button'), testInfo);
          await reachAll(page, card.locator(':scope > button'), testInfo);

          await reachAndTap(page, card.getByRole('button', { name: '戻る', exact: true }), testInfo);
          await expect(card).toHaveCount(0);

          await menuButton.click();
          await expect(card).toBeVisible();
          await reachAndTap(page, card.getByRole('button', { name: /Legを終了・引き分け/ }), testInfo);
          await expect(card).toHaveCount(0);
          const legResult = page.getByRole('dialog', { name: 'Leg結果' });
          await expect(legResult.locator('h2')).toHaveText('引き分け');
          await reach(page, legResult.getByRole('button', { name: /戻る（本数を選び直す）/ }), testInfo);
        });
      }
    });
  });
}

test.describe('ペンタスロン 301 / 501: ☰ メニュー', () => {
  const cases = [
    { label: 'JDA 総合 501', open: (page: Page) => resumePentathlon(page, pentathlonUntil('jda', 2, NORMAL_NAMES, 'x01-501')) },
    { label: 'n01 総合 301', open: (page: Page) => resumePentathlon(page, pentathlonUntil('n01', 2, LONG_NAMES, 'x01-301')) },
    {
      label: 'JDA 個別 301',
      open: async (page: Page) => {
        await openSaved(page, {}, 'navy');
        await openSingleGame(page, 'JDA 301');
        await page.getByRole('button', { name: /を開始/ }).click();
      },
    },
    {
      label: 'n01 個別 501',
      open: async (page: Page) => {
        await openSaved(page, {});
        await openSingleGame(page, 'n01 501');
        await page.getByRole('button', { name: /を開始/ }).click();
      },
    },
  ];

  test('D04 全項目と「戻る」に到達でき、戻る・ルール説明が働く', async ({ page }, testInfo) => {
    for (const { label, open } of cases) {
      await test.step(label, async () => {
        await open(page);
        await expect(page.locator('.pent-x01-shell')).toBeVisible();
        const menuButton = page.locator('.n01-menu-table button', { hasText: '☰' });
        await menuButton.click();
        const card = page.locator('.pent-modal-card.menu-list');
        await expect(card).toBeVisible();
        await reachAll(page, card.locator(':scope > button'), testInfo);

        await reachAndTap(page, card.getByRole('button', { name: '戻る', exact: true }), testInfo);
        await expect(card).toHaveCount(0);

        await menuButton.click();
        await reachAndTap(page, card.getByRole('button', { name: 'ルール説明' }), testInfo);
        const rules = page.locator('.pent-modal-card').filter({ hasText: 'のルール' });
        await expect(rules).toBeVisible();
        await reachAndTap(page, rules.getByRole('button', { name: '閉じる' }), testInfo);
        await expect(page.locator('.pent-modal-card.menu-list')).toBeVisible();
      });
    }
  });
});

/**
 * The one required size where the whole Cricket board cannot fit one screen without shrinking its
 * keys or text: 320×568 with 総合's progress panel needs ~402px for a ~388px band. There the middle
 * band scrolls (as the play screen is designed to on a genuinely short screen), so every key is
 * checked as reachable by a real swipe and never overlapped; everywhere else every key must be on
 * screen at once.
 */
function checkPadKey(page: Page, testInfo: TestInfo) {
  const viewport = page.viewportSize()!;
  const shortPhone = viewport.width <= 360 && viewport.height <= 600;
  return (button: Locator) =>
    shortPhone ? reach(page, button, testInfo) : expectReachableWithoutScrolling(page, button, testInfo);
}

test.describe('総合ペンタスロン CRICKET', () => {
  const padButtons = (page: Page) =>
    page.locator('.pent-cricket-keys button, .pent-cricket-actions button');

  for (const playerCount of [1, 2] as const) {
    for (const names of [NORMAL_NAMES, LONG_NAMES]) {
      const nameLabel = names === NORMAL_NAMES ? '通常名' : '18文字名';
      test(`D02 ${playerCount}人・${nameLabel}: 進行欄の開閉にかかわらず全入力と確定がその場で押せる`, async ({ page }, testInfo) => {
        await resumePentathlon(page, pentathlonAtCricket(playerCount, names), playerCount === 2 ? 'neon' : 'clean');
        await expect(page.locator('.pent-cricket-board')).toBeVisible();
        const progress = page.locator('details.pent-progress-collapsible');
        await expect(progress).not.toHaveAttribute('open', '');

        // 7 targets x 3 keys + the undo button: every one in view at once, no scrolling - and so are
        // the names above the board and the POINTS read-out under it.
        await expect(padButtons(page)).toHaveCount(22);
        for (const button of await padButtons(page).all()) await checkPadKey(page, testInfo)(button);
        await checkPadKey(page, testInfo)(page.locator('.pent-cricket-row.head'));
        await checkPadKey(page, testInfo)(page.locator('.pent-cricket-row.total'));

        // An outer bull, confirmed - from the bottom row of the board.
        await reachAndTap(page, page.getByRole('button', { name: 'アウターブル', exact: true }), testInfo);
        await reachAndTap(page, page.getByRole('button', { name: '確定', exact: true }), testInfo);
        const bullRow = page.locator('.pent-cricket-row').filter({ has: page.getByRole('button', { name: 'アウターブル' }) });
        await expect(bullRow.locator('.pent-cricket-glyph[data-marks="1"]')).toHaveCount(1);

        // Open the standings: still every key, then a throw from the lowest number row.
        await reachAndTap(page, progress.locator('summary'), testInfo);
        await expect(progress).toHaveAttribute('open', '');
        await reachAll(page, progress.locator('.pent-progress-item'), testInfo);
        await expect(progress.locator('.pent-progress-item.done')).toHaveCount(4);
        for (const button of await padButtons(page).all()) await checkPadKey(page, testInfo)(button);
        await checkPadKey(page, testInfo)(page.locator('.pent-cricket-row.total'));
        await reachAndTap(page, page.getByRole('button', { name: 'トリプル15', exact: true }), testInfo);
        await reachAndTap(page, page.getByRole('button', { name: '確定', exact: true }), testInfo);
        const row15 = page.locator('.pent-cricket-row').filter({ has: page.getByRole('button', { name: 'トリプル15' }) });
        await expect(row15.locator('.pent-cricket-glyph[data-marks="3"]')).toHaveCount(1);

        // 前のラウンドに戻す reopens that round as staged input; 1投戻す then takes the dart back.
        await reachAndTap(page, page.getByRole('button', { name: '前のラウンドに戻す' }), testInfo);
        await expect(page.locator('.pent-cricket-status')).toContainText('この投球 1 / 3');
        await reachAndTap(page, page.getByRole('button', { name: '1投戻す' }), testInfo);
        await expect(row15.locator('.pent-cricket-glyph')).toHaveCount(0);
        await expect(page.locator('.pent-cricket-status')).toContainText('この投球 0 / 3');
        // Closing the standings again changes nothing on the pad.
        await reachAndTap(page, progress.locator('summary'), testInfo);
        await expect(progress).not.toHaveAttribute('open', '');
        for (const button of await padButtons(page).all()) await checkPadKey(page, testInfo)(button);
      });
    }
  }
});

test.describe('個別練習 CRICKET', () => {
  test('D02 回帰確認: 全入力と確定がその場で押せる', async ({ page }, testInfo) => {
    await openSaved(page, {});
    await openSingleGame(page, 'CRICKET');
    await page.getByRole('button', { name: /を開始/ }).click();
    await expect(page.locator('.pent-cricket-board')).toBeVisible();
    await expect(page.locator('details.pent-progress-collapsible')).toHaveCount(0);

    const padButtons = page.locator('.pent-cricket-keys button, .pent-cricket-actions button');
    await expect(padButtons).toHaveCount(22);
    for (const button of await padButtons.all()) await checkPadKey(page, testInfo)(button);
    await checkPadKey(page, testInfo)(page.locator('.pent-cricket-row.head'));
    await checkPadKey(page, testInfo)(page.locator('.pent-cricket-row.total'));

    await reachAndTap(page, page.getByRole('button', { name: 'ダブルブル', exact: true }), testInfo);
    await reachAndTap(page, page.getByRole('button', { name: '確定', exact: true }), testInfo);
    const bullRow = page.locator('.pent-cricket-row').filter({ has: page.getByRole('button', { name: 'ダブルブル' }) });
    await expect(bullRow.locator('.pent-cricket-glyph[data-marks="2"]')).toHaveCount(1);
  });
});
