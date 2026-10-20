// 画面テスト共通の操作
import { expect } from '@playwright/test';
import { ADMIN_KEY } from '../tests/gas-mock.mjs';

export { ADMIN_KEY };
export const VIEWER_ENDPOINT = 'https://script.google.com/macros/s/PREVIEW/exec';
export const ADMIN_ENDPOINT = 'https://script.google.com/macros/s/PREVIEW-ADMIN/exec';

export async function reset(request, opts = {}) {
  await request.post('/__reset', { data: opts });
}

export async function setFault(request, app, mode) {
  await request.post('/__fault', { data: { app, mode } });
}

let seq = 0;
/**
 * 運営用 API（doPost）を直接呼ぶ（画面操作の前提データ作成用）。
 * auth 省略 = 管理者の鍵 / 'anon' = 未認証 / { eventId, key } = 主催者
 */
export async function adminCall(request, action, payload = {}, auth) {
  const a = auth === undefined ? { adminKey: ADMIN_KEY } : auth === 'anon' ? undefined : auth;
  const res = await request.post('/admin-post', {
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    data: JSON.stringify({ action, payload, requestId: `e2e-request-${Date.now()}-${++seq}`, auth: a }),
  });
  return res.json();
}

/** 初期化済み・サンプル大会を公開した状態を作り、詳細と運営用の鍵を返す */
export async function publishedSample(request) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const res = await adminCall(request, 'createSampleEvent', { publish: true });
  expect(res.ok).toBe(true);
  return { ...res.data.detail, adminKey: res.data.adminKey };
}

/**
 * GitHub Pages のページから script.google.com への通信を、ローカルの模擬サーバーへ振り替える。
 * 送られた Cookie を seen に記録する（Cookie を送らないことの確認用）。
 */
export async function routeAppsScript(page, request, seen = []) {
  await page.route(`${VIEWER_ENDPOINT}**`, async (route) => {
    const headers = await route.request().allHeaders();
    seen.push({ url: route.request().url(), cookie: headers.cookie || '' });
    const u = new URL(route.request().url());
    const r = await request.get(`/viewer-json${u.search}`);
    await route.fulfill({ status: r.status(), contentType: r.headers()['content-type'], body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const headers = await route.request().allHeaders();
    seen.push({ url: route.request().url(), cookie: headers.cookie || '', method: route.request().method() });
    const r = await request.post('/admin-post', { headers: { 'content-type': 'text/plain;charset=utf-8' }, data: route.request().postData() || '' });
    await route.fulfill({ status: r.status(), contentType: 'application/json', body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
  return seen;
}

/** 横スクロールが発生していないこと（スマートフォン表示の確認） */
export async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
