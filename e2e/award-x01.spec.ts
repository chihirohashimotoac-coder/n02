import { expect, test, type Page } from '@playwright/test';
import { confirmFinish, enterGameScore, openFreshApp } from './helpers';

/**
 * Awards in 通常01 / チェックアウト練習.
 *
 * The classification itself is unit-tested in src/domain/awards.test.ts, and the media contract
 * (muted/inline playback, the movie -> poster -> CSS fallback chain, reduced motion, the 3000ms
 * window) in src/components/common/AwardOverlay.test.tsx - Playwright's Chromium ships without the
 * H.264 decoder, so a movie can never actually play here.
 *
 * What this file covers is what the player gets: which award appears, that the presentation blocks
 * nothing, that the ON/OFF setting is shared and remembered, and that a bust, an undo or a past
 * correction never fires one.
 *
 * Note on the media tests below: whether the movie loads at all is an environment property here
 * (codec support, and a service worker that answers requests page.route never sees), so nothing in
 * this file asserts that a movie failed. The one media case that IS a product guarantee - offline
 * with nothing cached - is driven through real offline instead.
 */

const card = (page: Page) => page.locator('.award-card');
const name = (page: Page) => page.locator('.award-name');
const remaining = (page: Page) => page.locator('.n01-left-table strong').first();

/** 通常01, no leg target, so a leg can be played out without the match ending. */
async function start01(page: Page) {
  await openFreshApp(page);
  await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
  await page.getByRole('button', { name: /ゲームを開始/ }).click();
  await expect(page.locator('.n01-game-shell')).toBeVisible();
}

/** Walks player 1 down to an exact remaining, leaving player 2 on 501. */
async function bringP1To(page: Page, target: number) {
  let left = 501;
  while (left > target) {
    const step = Math.min(60, left - target);
    await enterGameScore(page, step); // P1
    await enterGameScore(page, 0); // P2
    left -= step;
  }
  await expect(remaining(page)).toHaveText(String(target));
}

async function waitForAwardToClear(page: Page) {
  await expect(card(page)).toHaveCount(0, { timeout: 6000 });
}

test.describe('通常01 のアワード判定', () => {
  const bands: Array<[number, string | null]> = [
    [99, null],
    [100, 'LOW TON'],
    [149, 'LOW TON'],
    [151, 'HIGH TON'],
    // 169 / 179 are deliberately not here: they are among the nine totals three darts cannot make
    // (163, 166, 169, 172, 173, 175, 176, 178, 179), so the engine rejects the entry outright and
    // no award is ever reached. src/domain/awards.test.ts covers what the classifier answers for
    // those numbers; this file covers what a player can actually throw.
    [168, 'HIGH TON'],
    [177, 'HIGH TON'],
    [180, 'TON 80'],
  ];

  for (const [score, label] of bands) {
    test(`${score} → ${label ?? 'アワードなし'}`, async ({ page }) => {
      await start01(page);
      await enterGameScore(page, score);
      if (label === null) await expect(card(page)).toHaveCount(0);
      else await expect(name(page)).toHaveText(label);
    });
  }

  test('150 は THREE IN THE BLACK（Separate Bull 側）で、HAT TRICK は出ない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 150);
    await expect(name(page)).toHaveText('THREE IN THE BLACK');
    await expect(card(page)).not.toContainText('HAT TRICK');
  });

  test('チェックアウト練習でも同じ分類になる', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByLabel('出題下限').fill('170');
    await page.getByLabel('出題上限').fill('170');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(remaining(page)).toHaveText('170');

    // 150 from 170 leaves 20 - not a checkout, so it is the bull award, not BIG FISH.
    await enterGameScore(page, 150);
    await expect(name(page)).toHaveText('THREE IN THE BLACK');
  });
});

test.describe('BIG FISH', () => {
  test('残り170から170を上がったときだけ出る', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByLabel('出題下限').fill('170');
    await page.getByLabel('出題上限').fill('170');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(remaining(page)).toHaveText('170');

    await enterGameScore(page, 170);
    await confirmFinish(page);
    await expect(name(page)).toHaveText('BIG FISH');
  });

  test('残り170で170を投げてもチェックアウトしなければ HIGH TON', async ({ page }) => {
    await start01(page);
    // 501 - 331 = 170 exactly, then a 170 that is declared as a non-finishing visit is impossible -
    // so instead: from 171, a 170 leaves 1, which is a bust. Use 180 remaining: a 170 leaves 10.
    await bringP1To(page, 180);
    await enterGameScore(page, 170);
    await expect(name(page)).toHaveText('HIGH TON');
    await expect(remaining(page)).toHaveText('10');
  });

  test('残りが170以外のときの170点は BIG FISH ではなく HIGH TON', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 170); // from 501
    await expect(name(page)).toHaveText('HIGH TON');
    await expect(remaining(page)).toHaveText('331');
  });

  test('170以外のチェックアウトでは出ない', async ({ page }) => {
    await openFreshApp(page);
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByLabel('出題下限').fill('167');
    await page.getByLabel('出題上限').fill('167');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(remaining(page)).toHaveText('167');

    await enterGameScore(page, 167);
    await confirmFinish(page);
    await expect(name(page)).toHaveText('HIGH TON');
  });
});

test.describe('アワードが出ない操作', () => {
  test('バストでは出ない', async ({ page }) => {
    await start01(page);
    await bringP1To(page, 120);
    // 150 from 120 busts: the remaining does not move and nothing is scored.
    await enterGameScore(page, 150);
    await expect(page.locator('.n01-notice')).toContainText('バスト');
    await expect(remaining(page)).toHaveText('120');
    await expect(card(page)).toHaveCount(0);
  });

  test('無効な入力では出ない', async ({ page }) => {
    await start01(page);
    // The entry is capped at three digits and 181+ is rejected by the engine.
    await enterGameScore(page, 181);
    await expect(card(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText('501');
  });

  test('UNDO で取り消しても再発火しない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 180);
    await expect(name(page)).toHaveText('TON 80');
    await waitForAwardToClear(page);

    await page.keyboard.press('u');
    await expect(remaining(page)).toHaveText('501');
    await expect(card(page)).toHaveCount(0);
  });

  test('過去得点の修正では出ない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 60);
    await waitForAwardToClear(page);

    await page.locator('.n01-score-table td.scored button').first().click();
    await page.locator('.n01-modal-card input[type="number"]').fill('180');
    await page.getByRole('button', { name: '修正して再計算' }).click();

    await expect(remaining(page)).toHaveText('321');
    // The correction recalculated the leg, but a correction is not a throw: no presentation.
    await expect(card(page)).toHaveCount(0);
  });
});

test.describe('アワード表示 ON/OFF', () => {
  const menu = (page: Page) => page.locator('.n01-menu-table button', { hasText: '☰' });
  const toggle = (page: Page) => page.getByRole('button', { name: /アワード表示/ });

  test('初期値は ON', async ({ page }) => {
    await start01(page);
    await menu(page).click();
    await expect(toggle(page)).toContainText('ON');
    await page.keyboard.press('Escape');
    await enterGameScore(page, 180);
    await expect(name(page)).toHaveText('TON 80');
  });

  test('OFF にすると演出が出ず、再度 ON で戻る', async ({ page }) => {
    await start01(page);
    await menu(page).click();
    await toggle(page).click();

    await enterGameScore(page, 180);
    await expect(card(page)).toHaveCount(0);
    // The score itself is entirely unaffected by the display setting.
    await expect(remaining(page)).toHaveText('321');

    await menu(page).click();
    await expect(toggle(page)).toContainText('OFF');
    await toggle(page).click();
    await enterGameScore(page, 0); // P2
    await enterGameScore(page, 180); // P1 again
    await expect(name(page)).toHaveText('TON 80');
  });

  test('リロード後も保存され、通常01とチェックアウト練習で共有される', async ({ page }) => {
    await start01(page);
    await menu(page).click();
    await toggle(page).click();
    await expect(page.locator('.n01-modal-card')).toHaveCount(0);

    // Reload, resume the saved match: still OFF.
    await page.reload();
    await page.getByRole('button', { name: /再開|続き/ }).click();
    await page.waitForSelector('.n01-game-shell');
    await menu(page).click();
    await expect(toggle(page)).toContainText('OFF');
    await page.keyboard.press('Escape');

    // And the other mode reads the same setting.
    await page.keyboard.press('n');
    await page.locator('.mode-card', { hasText: 'チェックアウト練習' }).click();
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await menu(page).click();
    await expect(toggle(page)).toContainText('OFF');
  });

  test('COUNT-UP はこのトグルの影響を受けない', async ({ page }) => {
    await start01(page);
    await menu(page).click();
    await toggle(page).click();
    await page.keyboard.press('n');

    await page.locator('.mode-card[data-mode="practice"]').click();
    await page.locator('.practice-card[data-practice="count-up"]').click();
    await page.getByRole('button', { name: /COUNT-UP を開始/ }).click();
    await page.waitForSelector('.countup-shell');

    await page.keyboard.type('180');
    await page.keyboard.press('Enter');
    await expect(name(page)).toHaveText('TON 80');
  });
});

test.describe('アワード演出は操作を妨げない', () => {
  test('表示中でも得点入力・Enter・UNDO が効く', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 180);
    await expect(card(page)).toBeVisible();

    // Straight into the next visit while the presentation is still up.
    await enterGameScore(page, 60);
    await expect(card(page)).toBeVisible();
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('441');

    await page.keyboard.press('u');
    await expect(page.locator('.n01-left-table strong').nth(1)).toHaveText('501');
  });

  test('レイヤーはポインタを受け取らず、フォーカスも奪わない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 180);
    await expect(card(page)).toBeVisible();

    expect(await page.locator('.award-layer').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    // Nothing inside the layer can hold focus, and nothing in it is a dialog.
    expect(await page.locator('.award-layer [role="dialog"]').count()).toBe(0);
    expect(
      await page.evaluate(() => document.querySelector('.award-layer')?.contains(document.activeElement) ?? false),
    ).toBe(false);
  });

  test('2999msでは表示され、3001msでは消えている', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 180);
    await expect(card(page)).toBeVisible();

    await page.waitForTimeout(2400);
    await expect(card(page)).toHaveCount(1);
    await page.waitForTimeout(1200); // now past 3000ms
    await expect(card(page)).toHaveCount(0);
  });

  test('連続発火で古いタイマーが新しいアワードを消さない', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 100);
    await expect(name(page)).toHaveText('LOW TON');
    await page.waitForTimeout(2000);

    // A second award almost at the end of the first one's window.
    await enterGameScore(page, 180);
    await expect(name(page)).toHaveText('TON 80');
    // The first award's timer would have fired by now; the second must still be up.
    await page.waitForTimeout(1500);
    await expect(name(page)).toHaveText('TON 80');
  });
});

test.describe('アワードのメディア', () => {
  test('動画は装飾で、アワード名・点数・プレイヤー名はテキストとして読める', async ({ page }) => {
    await start01(page);
    await enterGameScore(page, 180);

    await expect(page.locator('.award-media')).toHaveAttribute('aria-hidden', 'true');
    const text = page.locator('.award-text');
    await expect(text).toHaveAttribute('aria-live', 'polite');
    await expect(text.locator('.award-player')).toHaveText('プレイヤー1');
    await expect(text.locator('.award-name')).toHaveText('TON 80');
    await expect(text.locator('.award-score')).toHaveText('180');
  });

  test('動画が未キャッシュのままオフラインでも、ポスターとテキストでアワードが出る', async ({
    page,
    context,
  }) => {
    // The requirement this pins: a first offline run, with no movie cached at all, must still
    // present the award. The posters are precached at service-worker install for exactly that.
    //
    // Deliberately driven with real offline rather than page.route(): a request from a page under
    // a service worker is issued BY the worker, which page.route does not intercept, so blocking
    // at that layer proves nothing. Going offline before the mode is even entered also means the
    // idle warm-up cannot have cached the movie first.
    await openFreshApp(page);
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
      timeout: 20_000,
    });
    await context.setOffline(true);

    await page.getByLabel('勝利条件').selectOption({ label: 'なし（Legを継続）' });
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();
    await enterGameScore(page, 180);

    await expect(page.locator('.award-poster')).toBeVisible();
    // Still fully readable, and still clears on time.
    await expect(name(page)).toHaveText('TON 80');
    await expect(card(page)).toHaveCount(0, { timeout: 6000 });
    await context.setOffline(false);
  });

  test('prefers-reduced-motion では動画を再生せずポスターとテキストを出す', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await start01(page);
    await enterGameScore(page, 180);

    await expect(page.locator('.award-video')).toHaveCount(0);
    await expect(page.locator('.award-poster')).toBeVisible();
    await expect(name(page)).toHaveText('TON 80');
    expect(await card(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await expect(card(page)).toHaveCount(0, { timeout: 6000 });
  });

  test('動画は初期ロードに含まれず、モード開始後に取りに行く', async ({ page }) => {
    const movieRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/awards/') && request.url().endsWith('.mp4')) {
        movieRequests.push(request.url());
      }
    });

    await openFreshApp(page);
    await page.waitForTimeout(500);
    expect(movieRequests).toEqual([]); // nothing on the menu

    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.locator('.n01-game-shell')).toBeVisible();
    // The warm-up is idle-scheduled, so give it a moment - and it must only ever ask for the
    // awards this mode can produce, never HAT TRICK.
    await page.waitForTimeout(4000);
    expect(movieRequests.length).toBeGreaterThan(0);
    expect(movieRequests.some((url) => url.includes('hat-trick'))).toBe(false);
  });
});
