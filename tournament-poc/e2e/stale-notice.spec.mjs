// 監査 PR-17（W-006）: サーバーが最新を読めず予備（stale）を返したときは、一覧・詳細とも「最新の状態です」と知らせず、
// 前回のデータを表示していることを伝える（帯・一覧の下の表示と、トーストを一致させる）。通常の未変更・取得失敗・復帰も確かめる
import { test, expect } from '@playwright/test';
import { publishedSample, routeAppsScript, VIEWER_ENDPOINT } from './helpers.mjs';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/** 閲覧者用 API の応答を切り替える: 'ok' = そのまま / 'stale' = 予備を返したことにする（stale: true）/ 'fail' = 通信の失敗 */
async function controlViewer(page, request) {
  const ctl = { mode: 'ok' };
  await page.route(`${VIEWER_ENDPOINT}**`, async (route) => {
    if (ctl.mode === 'fail') return route.abort('connectionreset');
    const u = new URL(route.request().url());
    const r = await request.get(`/viewer-json${u.search}`);
    let body = await r.text();
    if (ctl.mode === 'stale') {
      const json = JSON.parse(body);
      if (json && json.ok) json.stale = true;
      body = JSON.stringify(json);
    }
    await route.fulfill({ status: r.status(), contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
  });
  return ctl;
}

const toast = (page) => page.locator('.ux-toast').last();

test('ポータル: 予備のデータ（stale・未変更）では「一覧は最新の状態です」と言わず、前回のデータと伝える。復帰すると通常の表示', async ({ page, request }) => {
  await publishedSample(request);
  await routeAppsScript(page, request);
  const ctl = await controlViewer(page, request);
  await page.goto('/pages/events/');
  await expect(page.locator('.row')).toHaveCount(1);
  // 通常の未変更
  await page.locator('#sync').getByRole('button', { name: '今すぐ更新' }).click();
  await expect(toast(page)).toContainText('一覧は最新の状態です。');
  await expect(page.locator('#sync')).not.toContainText('前回のデータ');
  // 予備（stale）＋未変更
  ctl.mode = 'stale';
  await page.locator('#sync').getByRole('button', { name: '今すぐ更新' }).click();
  await expect(toast(page)).toContainText('前回のデータ');
  await expect(toast(page)).not.toContainText('最新の状態です');
  await expect(page.locator('#sync')).toContainText('前回のデータ');
  await expect(page.locator('.row')).toHaveCount(1);
  // 取得の失敗: 一覧は残し、エラーを伝える
  ctl.mode = 'fail';
  await page.locator('#sync').getByRole('button', { name: '今すぐ更新' }).click();
  await expect(page.locator('#results .banner--error')).toContainText('大会の一覧を読み込めませんでした');
  await expect(page.locator('.row')).toHaveCount(1);
  // 復帰
  ctl.mode = 'ok';
  await page.locator('#sync').getByRole('button', { name: '今すぐ更新' }).click();
  await expect(toast(page)).toContainText('一覧は最新の状態です。');
  await expect(page.locator('#results .banner--error')).toHaveCount(0);
  await expect(page.locator('#sync')).not.toContainText('前回のデータ');
});

test('閲覧ページ: 予備のデータ（stale・未変更）では帯とトーストの両方で前回のデータと伝え、「最新の状態です」と言わない。復帰すると帯が消える', async ({ page, request }) => {
  const d = await publishedSample(request);
  await routeAppsScript(page, request);
  const ctl = await controlViewer(page, request);
  await page.goto(`/pages/index.html?event=${d.event.id}`);
  await expect(page.locator('.match')).toHaveCount(24);
  const refresh = async () => {
    await page.waitForTimeout(5200); // 手動更新は前回の取得から 5 秒あける
    await page.getByRole('button', { name: '今すぐ更新' }).click();
  };
  // 通常の未変更
  await refresh();
  await expect(toast(page)).toContainText('最新の状態です。');
  await expect(page.locator('#banner')).toBeHidden();
  // 予備（stale）＋未変更
  ctl.mode = 'stale';
  await refresh();
  await expect(page.locator('#banner')).toContainText('最新データを読み込めなかった');
  await expect(toast(page)).toContainText('前回のデータ');
  await expect(toast(page)).not.toContainText('最新の状態です');
  await expect(page.locator('.match')).toHaveCount(24);
  // 取得の失敗
  ctl.mode = 'fail';
  await refresh();
  await expect(page.locator('#banner')).toContainText('更新に失敗しました');
  await expect(toast(page)).toContainText('更新できませんでした');
  // 復帰: 失敗の後は手動の更新を少し間引くので、自動の再試行で帯が消えるのを待ち、その後の手動の更新で「最新の状態です」
  ctl.mode = 'ok';
  await expect(page.locator('#banner')).toBeHidden({ timeout: 60_000 });
  await refresh();
  await expect(toast(page)).toContainText('最新の状態です。');
  await expect(page.locator('#banner')).toBeHidden();
});
