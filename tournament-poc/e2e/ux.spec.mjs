// ポータルと閲覧ページ（GitHub Pages）の操作・動き: スケルトン・オートコンプリート・トースト・進み具合・選手を探す・
// 引っぱって更新・「大会一覧」への移動
import { test, expect } from '@playwright/test';
import { publishedSample, routeAppsScript, fakeGoogle, adminCall, expectNoHorizontalOverflow, ORGANIZER, VIEWER_ENDPOINT } from './helpers.mjs';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/** 閲覧者用 Web アプリへの通信を遅らせる（読み込み中の表示を確かめる） */
async function slowViewer(page, request, ms) {
  await page.route(`${VIEWER_ENDPOINT}**`, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    const u = new URL(route.request().url());
    const r = await request.get(`/viewer-json${u.search}`);
    await route.fulfill({ status: r.status(), contentType: 'application/json', body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
}

test('ポータル: 読み込み中はスケルトン（読み上げは「読み込んでいます」）、読み込めたら一覧に置き換わる', async ({ page, request }) => {
  await publishedSample(request);
  await routeAppsScript(page, request);
  await slowViewer(page, request, 1200);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto('/pages/events/');
  await expect(page.locator('#results .skeleton')).toBeVisible();
  await expect(page.locator('#results .skeleton')).toContainText('大会の一覧を読み込んでいます');
  await expect(page.locator('.row__open')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#results .skeleton')).toHaveCount(0);
});

test('ポータル: 大会名の候補（オートコンプリート）を ↑↓・Enter で選ぶと、その大会が開く。Esc で候補を閉じる', async ({ page, request }) => {
  await publishedSample(request);
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto('/pages/events/');
  await expect(page.locator('.row__open')).toHaveCount(1);
  const q = page.getByRole('combobox', { name: '大会名で検索' });
  await q.fill('さんぷる');
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('サンプル大会（PoC 検証用）');
  await expect(q).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await q.press('ArrowDown');
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await q.press('Enter');
  await expect(page.getByRole('dialog', { name: 'サンプル大会（PoC 検証用）' })).toBeVisible();
  await expect(q).toHaveValue('サンプル大会（PoC 検証用）');
});

test('ポータル: 「今すぐ更新」の結果をトーストで伝える', async ({ page, request }) => {
  await publishedSample(request);
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto('/pages/events/');
  await expect(page.locator('.row__open')).toHaveCount(1);
  await page.getByRole('button', { name: '今すぐ更新' }).click();
  await expect(page.locator('.ux-toast')).toContainText('一覧は最新の状態です。');
});

test('閲覧ページ: 右上の「大会一覧」でポータルへ。Apps Script の閲覧画面には出さない', async ({ page, request }) => {
  const d = await publishedSample(request);
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`/pages/index.html?event=${d.event.id}`);
  const link = page.getByRole('link', { name: '大会一覧' });
  await expect(link).toBeVisible();
  // 見出しの帯の右上（大会名より上の行の右端）
  const bar = await page.locator('.topbar').boundingBox();
  const box = await link.boundingBox();
  const title = await page.locator('#event-title').boundingBox();
  expect(box.x + box.width).toBeGreaterThan(bar.x + bar.width * 0.6);
  expect(box.y).toBeLessThan(title.y);
  await link.click();
  await expect(page).toHaveURL(/\/pages\/events\/$/);
  await expect(page.locator('.row__open')).toHaveCount(1);
  await page.goto('/viewer');
  await expect(page.getByRole('link', { name: '大会一覧' })).toHaveCount(0);
});

test('閲覧ページ: 読み込み中はスケルトン、読み込めたら大会の進み具合（確定・進行中・未開始）を出す', async ({ page, request }) => {
  const d = await publishedSample(request);
  await routeAppsScript(page, request);
  await slowViewer(page, request, 1200);
  await page.goto(`/pages/index.html?event=${d.event.id}`);
  await expect(page.locator('#groups .skeleton')).toBeVisible();
  await expect(page.locator('.match')).toHaveCount(24, { timeout: 10_000 });
  await expect(page.locator('#groups .skeleton')).toHaveCount(0);
  const ov = page.getByRole('region', { name: '大会の進み具合' });
  await expect(ov).toBeVisible();
  await expect(ov.locator('.overview__num')).toHaveText('50', { timeout: 5000 });
  await expect(ov.locator('.overview__counts')).toContainText('確定 12');
  await expect(ov.locator('.overview__counts')).toContainText('進行中 2');
  await expect(ov.locator('.overview__counts')).toContainText('未開始 10');
  await expect(ov.locator('.ov-stage__value')).toHaveText(['12 / 24']);
  await expectNoHorizontalOverflow(page);
});

test('閲覧ページ: 選手を探す（候補から選ぶと、その選手の試合と順位表の行を強調し、解除できる）', async ({ page, request }) => {
  const d = await publishedSample(request);
  await routeAppsScript(page, request);
  await page.goto(`/pages/index.html?event=${d.event.id}`);
  await expect(page.locator('.match')).toHaveCount(24);
  const q = page.getByRole('combobox', { name: '選手を探す' });
  await q.fill('選手05');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('サンプル選手05');
  await expect(page.getByRole('option')).toContainText('3 試合');
  await page.getByRole('option').click();
  await expect(page.locator('.match.is-focus')).toHaveCount(3);
  await expect(page.locator('.summary tr.is-focus')).toHaveCount(1);
  await expect(page.locator('.player-search__chip')).toContainText('サンプル選手05 の試合を強調しています');
  // 自動更新などで描き直しても強調は残る
  await page.getByRole('button', { name: 'グループB' }).click();
  await expect(page.locator('.match.is-focus')).toHaveCount(3);
  await page.getByRole('button', { name: 'サンプル選手05 の強調を解除' }).click();
  await expect(page.locator('.is-focus')).toHaveCount(0);
});

test('閲覧ページ: 結果が確定した試合を一瞬強調し、手動更新ではトーストで伝える', async ({ page, request }) => {
  const d = await publishedSample(request);
  await routeAppsScript(page, request);
  await page.goto(`/pages/index.html?event=${d.event.id}`);
  await expect(page.locator('.match')).toHaveCount(24);
  const m = d.groups.flatMap((g) => g.matches).find((x) => x.status === 'scheduled');
  const res = await adminCall(request, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }, d.auth);
  expect(res.ok).toBe(true);
  await request.post('/__expire-viewer-cache');
  await page.waitForTimeout(5200); // 手動更新は前回の取得から 5 秒あける
  await page.getByRole('button', { name: '今すぐ更新' }).click();
  await expect(page.locator('.ux-toast')).toContainText('1 試合の結果が確定しました。');
  await expect(page.locator(`[data-match-id="${m.id}"]`)).toHaveClass(/is-updated/);
});

test('閲覧ページ（スマートフォン）: 一番上から下へ引っぱって離すと更新する', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'タッチ操作の端末だけ');
  const d = await publishedSample(request);
  const seen = await routeAppsScript(page, request);
  await page.goto(`/pages/index.html?event=${d.event.id}`);
  await expect(page.locator('.match')).toHaveCount(24);
  await page.waitForTimeout(5200);
  const before = seen.length;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] });
  await touch('touchStart', 300);
  for (let y = 300; y <= 480; y += 20) await touch('touchMove', y);
  await expect(page.locator('.ux-ptr')).toHaveClass(/is-armed/);
  await touch('touchEnd', 480);
  await expect(page.locator('.ux-toast')).toContainText('最新の状態です。');
  expect(seen.length).toBeGreaterThan(before);
});

test('ポータル: Google のボタンは専用のスタイルを読み込んでから描き、ダークモードでも周りに白い枠を出さない', async ({ page, request }) => {
  await publishedSample(request);
  await routeAppsScript(page, request);
  await page.emulateMedia({ colorScheme: 'dark' });
  await fakeGoogle(page, request, ORGANIZER, { styleDelayMs: 1500 });
  const styleRequested = page.waitForRequest('https://accounts.google.com/gsi/style');
  // load を待つとスタイルの読み込みまで待ってしまうので、HTML を読んだところで進める
  await page.goto('/pages/events/', { waitUntil: 'domcontentloaded' });
  await styleRequested;
  // スタイルを読み込むまではボタンを描かない（読み込み前に描くと大きな G のロゴが崩れて出る）
  await page.waitForTimeout(300);
  expect(await page.locator('.plate .fake-gsi').count()).toBe(0);
  await expect(page.locator('.plate .fake-gsi')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.row__open')).toHaveCount(1);
  // Google の iframe と配色をそろえる（dark のままだと iframe に白い背景が敷かれる）
  const box = page.locator('.plate .gsi__button');
  expect(await box.evaluate((e) => getComputedStyle(e).colorScheme)).toBe('light');
  // 見出しは 1 行のまま（ボタンが崩れて描かれても押し広げない高さ）
  const h = await box.boundingBox();
  expect(h.height).toBeLessThanOrEqual(36);
  await expectNoHorizontalOverflow(page);
});
