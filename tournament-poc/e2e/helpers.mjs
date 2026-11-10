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

/**
 * 横スクロールが発生していないこと（スマートフォン表示の確認）。
 * 指定した画面の幅と比べる: スマートフォンの条件（isMobile）では、ページが画面より広いとブラウザがページ全体を縮小し、
 * window.innerWidth もページの幅まで広がるため、innerWidth と比べるとはみ出しを見逃す
 */
export async function expectNoHorizontalOverflow(page) {
  const width = page.viewportSize().width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
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


/**
 * 大会の運営画面のメニューを開く。PC は左のメニュー、スマートフォンは「進行状況・試合結果・選手」以外を「その他」から開く
 */
export async function openTab(page, label) {
  const tabs = page.locator('.tabs');
  await tabs.waitFor();
  const tab = tabs.getByRole('button', { name: label, exact: true });
  if (!(await tab.isVisible())) await page.locator('#tab-more').click();
  await tab.click();
}

/** 大会設定の分類（基本情報・公開・表示・権限・その他）を開く */
export async function openSettings(page, group) {
  await openTab(page, '大会設定');
  if (group) await page.locator('.subtabs').getByRole('button', { name: group }).first().click();
}

/** 主催者のホームから大会の作成画面を開く */
export async function openCreate(page) {
  await page.locator('#open-create').click();
  await page.locator('#new-name').waitFor();
}

/** 作成画面で大会の形式を選ぶ（「その他の形式」は開いてから） */
export async function chooseFormat(page, id) {
  const radio = page.locator('#new-template-' + id);
  if (!(await radio.isVisible())) await page.locator('#new-format-more > summary').click();
  await radio.check();
}

/** admin/config.js の値に通信の期限（短く）を足す（期限切れ・確認できない結果の試験用） */
export async function shortTimeouts(page, ms) {
  await page.addInitScript((t) => {
    let value;
    Object.defineProperty(window, 'TPOC_ADMIN_CONFIG', {
      configurable: true,
      get: () => value,
      set: (v) => {
        value = Object.assign({}, v, { timeouts: { query: t, mutate: t, long: t } });
      },
    });
  }, ms);
}

/**
 * 運営用 API の指定した操作だけ振る舞いを変える（それ以外は通常の模擬サーバーへ）。routeAppsScript の後に呼ぶ。
 * 戻り値: 送られた要求の一覧（{ requestId, payload }）。handler({ route, body, forward, pass, n })
 */
export async function interceptAction(page, request, action, handler) {
  const seen = [];
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action !== action) return route.fallback();
    seen.push({ requestId: body.requestId, payload: body.payload });
    const forward = async () => {
      const r = await request.post('/admin-post', { headers: { 'content-type': 'text/plain;charset=utf-8' }, data: route.request().postData() || '' });
      return r.text();
    };
    const reply = (text) => route.fulfill({ status: 200, contentType: 'application/json', body: text, headers: { 'access-control-allow-origin': '*' } });
    await handler({ route, body, forward, reply, pass: async () => reply(await forward()), n: seen.length });
  });
  return seen;
}

/** 運営用 API へ送られた操作名を、送った順に記録する（通信回数の確認用）。routeAppsScript の後に呼ぶ */
export async function recordActions(page) {
  const actions = [];
  await page.route(ADMIN_ENDPOINT, async (route) => {
    try {
      actions.push(JSON.parse(route.request().postData() || '{}').action);
    } catch (e) {
      actions.push('?');
    }
    return route.fallback();
  });
  return actions;
}

/** 初期化済みの空の環境で、主催者としてログインしたホームを開く */
export async function organizerHome(page, request, email = ORGANIZER) {
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, email);
  await page.goto('/pages/admin/index.html');
  await googleLogin(page);
  await page.locator('#event-list').waitFor();
}
