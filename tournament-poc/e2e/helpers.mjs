// 画面テスト共通の操作
import { expect } from '@playwright/test';
import { ADMIN_KEY, fakeIdToken } from '../tests/gas-mock.mjs';

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

/** Google でログインしたことにしてセッションの auth を返す（API を直接呼ぶテスト用）。claims で ID トークンの中身を変えられる */
export async function loginSession(request, email, claims = {}) {
  const res = await adminCall(request, 'login', { idToken: fakeIdToken(email, null, claims) }, 'anon');
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  return { session: res.data.session };
}

export const ORGANIZER = 'organizer@example.org';

/** 初期化済み・サンプル大会を公開した状態を作り、詳細と主催者のセッションを返す（主催者は ORGANIZER） */
export async function publishedSample(request) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const auth = await loginSession(request, ORGANIZER);
  const res = await adminCall(request, 'createSampleEvent', { publish: true }, auth);
  expect(res.ok).toBe(true);
  return { ...res.data.detail, auth };
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

/**
 * Google のログインボタン（accounts.google.com/gsi/client）を模擬に振り替える。
 * ボタンを押すと email の Google アカウントでログインしたことになる（サーバー側は模擬 tokeninfo で確かめる）。
 */
export async function fakeGoogle(page, request, email, options = {}) {
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    const r = await request.get(`/__fake-gsi.js?email=${encodeURIComponent(email)}${options.hd ? '&hd=' + encodeURIComponent(options.hd) : ''}`);
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: await r.text() });
  });
  // ボタン用のスタイル（画面はこれを読み込み終えてからボタンを描く）
  await page.route('https://accounts.google.com/gsi/style', async (route) => {
    if (options.styleDelayMs) await new Promise((r) => setTimeout(r, options.styleDelayMs));
    await route.fulfill({ status: 200, contentType: 'text/css', body: '/* gsi style (test) */' });
  });
}

/** 運営ページで Google でログインする（fakeGoogle を設定済みのページで） */
export async function googleLogin(page) {
  await page.locator('.fake-gsi').first().click();
}

