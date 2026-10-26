// v0.9: Google アカウント（sub）との紐付け・承認、ログアウトの確認（サーバーでの無効化の成否を区別する）
import { test, expect } from '@playwright/test';
import { reset, adminCall, loginSession, routeAppsScript, fakeGoogle, googleLogin, publishedSample, ORGANIZER, ADMIN_ENDPOINT } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';
const STAFF_PASSWORD = 'staff-pass-1234';

async function ok(request, action, payload, auth) {
  const res = await adminCall(request, action, payload, auth);
  expect(res.ok, `${action}: ${JSON.stringify(res.error)}`).toBe(true);
  return res.data;
}

/**
 * 運営用 API の logout だけを差し替える（ほかの操作は模擬サーバーへ）。
 * mode: 'ok' | 'fail'（HTTP 500）| 'offline'（通信断）| 'slow'（応答しない）。呼ばれた回数を数える
 */
async function controlLogout(page, request, state) {
  await routeAppsScript(page, request);
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const body = route.request().postData() || '';
    let action = '';
    try {
      action = JSON.parse(body).action;
    } catch {
      action = '';
    }
    if (action !== 'logout') return route.fallback();
    state.calls = (state.calls || 0) + 1;
    if (state.mode === 'fail') return route.fulfill({ status: 500, contentType: 'text/html', body: 'Internal Server Error' });
    if (state.mode === 'offline') return route.abort('internetdisconnected');
    if (state.mode === 'slow') {
      await new Promise((r) => setTimeout(r, 17000));
      return route.abort('timedout');
    }
    return route.fallback();
  });
}

test('ログアウト（成功）: この端末のログインを消し、サーバーでの無効化を確かめてから「サーバーでも無効にした」と伝える', async ({ page, request }) => {
  await publishedSample(request);
  const state = { mode: 'ok' };
  await controlLogout(page, request, state);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await expect(page.getByRole('heading', { name: 'あなたの大会' })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('tpoc-google')).session);
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page.getByText('ログアウトしました（サーバーでもログインを無効にしました）。')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tpoc-google'))).toBeNull();
  // サーバーでも使えない
  expect((await adminCall(request, 'bootstrap', {}, { session })).error.code).toBe('AUTH_EXPIRED');
  expect(state.calls).toBe(1);
});

test('ログアウト（API 500・通信断）: この端末ではすぐにログアウトし、成功とは表示せず、警告と再試行を出す。再試行で成功すれば警告を消す', async ({ page, request }) => {
  await publishedSample(request);
  const state = { mode: 'fail' };
  await controlLogout(page, request, state);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await expect(page.getByRole('heading', { name: 'あなたの大会' })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('tpoc-google')).session);
  await page.getByRole('button', { name: 'ログアウト' }).click();
  // この端末では、通信の結果を待たずに使えなくなる（ボタンも消える = 連打できない）
  expect(await page.evaluate(() => localStorage.getItem('tpoc-google'))).toBeNull();
  await expect(page.getByRole('button', { name: 'ログアウト' })).toHaveCount(0);
  await expect(page.getByText('サーバー側でログインを無効にできたかは確認できていません')).toBeVisible();
  await expect(page.getByText('サーバーでもログインを無効にしました')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '大会を主催する' })).toBeVisible();
  // 失敗したので、サーバー側ではまだ有効（この画面からはもう送らない）
  expect((await adminCall(request, 'bootstrap', {}, { session })).ok).toBe(true);
  // 通信断でも同じ
  state.mode = 'offline';
  await page.getByRole('button', { name: 'サーバーでの無効化をもう一度試す' }).click();
  await expect(page.getByText('サーバー側でログインを無効にできたかは確認できていません')).toBeVisible();
  // 復旧して再試行 → 成功
  state.mode = 'ok';
  await page.getByRole('button', { name: 'サーバーでの無効化をもう一度試す' }).click();
  await expect(page.getByText('ログアウトしました（サーバーでもログインを無効にしました）。')).toBeVisible();
  await expect(page.getByText('確認できていません')).toHaveCount(0);
  expect((await adminCall(request, 'bootstrap', {}, { session })).error.code).toBe('AUTH_EXPIRED');
  // 再読み込みしてもログイン状態は戻らない
  await page.reload();
  await expect(page.getByRole('heading', { name: '大会を主催する' })).toBeVisible();
});

test('ログアウト（応答が遅い）: 時間切れまで成功と表示せず、警告を出す', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '時間がかかるので PC 幅だけで確認する');
  test.setTimeout(60_000);
  await publishedSample(request);
  const state = { mode: 'slow' };
  await controlLogout(page, request, state);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await expect(page.getByRole('heading', { name: 'あなたの大会' })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await page.waitForTimeout(5000);
  await expect(page.getByText('サーバーでもログインを無効にしました')).toHaveCount(0);
  await expect(page.getByText('確認できていません')).toHaveCount(0);
  await expect(page.getByText('サーバー側でログインを無効にできたかは確認できていません')).toBeVisible({ timeout: 15000 });
});

test('複数のタブ: 一方のタブでログアウトすると、もう一方のタブ（運営画面・ポータル）もすぐにログアウトした状態になる', async ({ context, request }) => {
  const sample = await publishedSample(request);
  const a = await context.newPage();
  const b = await context.newPage();
  const c = await context.newPage();
  for (const p of [a, b, c]) {
    await routeAppsScript(p, request);
    await fakeGoogle(p, request, ORGANIZER);
  }
  await a.goto(ADMIN_PAGE);
  await googleLogin(a);
  await expect(a.getByRole('heading', { name: 'あなたの大会' })).toBeVisible();
  await b.goto(ADMIN_PAGE + '#e=' + sample.event.id);
  await expect(b.getByRole('heading', { name: sample.event.name })).toBeVisible();
  await c.goto('/pages/events/');
  await expect(c.locator('.account__email')).toContainText(ORGANIZER);
  await a.getByRole('button', { name: 'ログアウト' }).click();
  await expect(b.getByRole('heading', { name: 'この大会の運営画面を開く' })).toBeVisible();
  await expect(c.locator('.account__email')).toHaveCount(0);
});

test('スタッフ（管理パスワード）のログアウト: 失敗時は警告と再試行。Google のログインには影響しない', async ({ page, request }) => {
  const sample = await publishedSample(request);
  await ok(request, 'setStaffPassword', { eventId: sample.event.id, rev: sample.event.rev, password: STAFF_PASSWORD }, sample.auth);
  const state = { mode: 'fail' };
  await controlLogout(page, request, state);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE + '#e=' + sample.event.id);
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: '開く' }).click();
  await expect(page.getByRole('heading', { name: sample.event.name })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト' }).click();
  expect(await page.evaluate((id) => localStorage.getItem('tpoc-staff:' + id), sample.event.id)).toBeNull();
  await expect(page.getByText('サーバー側でログインを無効にできたかは確認できていません')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'この大会の運営画面を開く' })).toBeVisible();
  state.mode = 'ok';
  await page.getByRole('button', { name: 'サーバーでの無効化をもう一度試す' }).click();
  await expect(page.getByText('ログアウトしました（サーバーでもログインを無効にしました）。')).toBeVisible();
});

test('ポータルのログアウト: 失敗時は成功と表示せず警告と再試行。再試行で成功', async ({ page, request }) => {
  await publishedSample(request);
  const state = { mode: 'offline' };
  await controlLogout(page, request, state);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto('/pages/events/');
  await page.locator('.plate .fake-gsi').click();
  await expect(page.locator('.account__email')).toContainText(ORGANIZER);
  await page.getByRole('button', { name: 'ログアウト' }).click();
  expect(await page.evaluate(() => localStorage.getItem('tpoc-google'))).toBeNull();
  await expect(page.locator('#banner')).toContainText('サーバー側でログインを無効にできたかは確認できていません');
  await expect(page.getByText('サーバーでもログインを無効にしました')).toHaveCount(0);
  state.mode = 'ok';
  await page.locator('#banner').getByRole('button', { name: 'もう一度試す' }).click();
  await expect(page.getByText('ログアウトしました（サーバーでもログインを無効にしました）。')).toBeVisible();
  await expect(page.locator('#banner')).not.toContainText('確認できていません');
});

test('既存の大会の紐付け: 管理者が主催者のアドレスを設定した大会は、本人（Workspace）のログインで自動的に紐付き、一覧に出る', async ({ page, request }) => {
  await reset(request, { configured: true });
  await ok(request, 'initializeStorage');
  const id = (await ok(request, 'createEvent', { name: '引き継ぐ大会', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } })).eventId;
  const ev = (await ok(request, 'eventDetail', { eventId: id })).event;
  await ok(request, 'setOwner', { eventId: id, rev: ev.rev, ownerEmail: ORGANIZER });
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER, { hd: 'example.org' });
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await expect(page.getByText('このアカウントに 1 件の大会（主催・共同主催）を紐付けました。')).toBeVisible();
  await expect(page.locator('.event-card')).toContainText('引き継ぐ大会');
});

test('既存の大会の紐付け（Google が保証しないアドレス）: 確認待ちを本人に伝え、管理者の承認で主催者になる', async ({ page, request }) => {
  await reset(request, { configured: true });
  await ok(request, 'initializeStorage');
  const id = (await ok(request, 'createEvent', { name: '確認が要る大会', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } })).eventId;
  const ev = (await ok(request, 'eventDetail', { eventId: id })).event;
  await ok(request, 'setOwner', { eventId: id, rev: ev.rev, ownerEmail: ORGANIZER });
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await expect(page.getByText('このアカウントの確認待ちが 1 件あります')).toBeVisible();
  await expect(page.locator('.event-card')).toHaveCount(0);
  // 管理者の画面で承認する
  const admin = await page.context().newPage();
  await routeAppsScript(admin, request);
  await admin.goto(ADMIN_PAGE + '#admin');
  await admin.locator('#admin-key').fill('test-admin-key-0123456789-abcdefghij');
  await admin.getByRole('button', { name: '開く' }).click();
  await expect(admin.locator('.event-card')).toContainText('主催者の承認待ち 1');
  await admin.locator('.event-card').filter({ hasText: '確認が要る大会' }).getByRole('button', { name: '開く' }).click();
  await admin.getByRole('button', { name: '大会設定', exact: true }).click();
  await expect(admin.getByText('確認待ちのログインがあります。')).toBeVisible();
  await admin.getByRole('button', { name: '承認' }).click();
  await admin.getByRole('button', { name: 'この人を主催者にする' }).click();
  await expect(admin.getByText('主催者を承認しました。')).toBeVisible();
  await expect(admin.getByText(/紐付け済み（管理者が承認/)).toBeVisible();
  await page.reload();
  await expect(page.locator('.event-card')).toContainText('確認が要る大会');
});

test('共同主催者: 招待中 → 相手のログイン（保証のないアドレス）で承認待ち → 主催者が承認して有効', async ({ page, request }) => {
  const sample = await publishedSample(request);
  await ok(request, 'addCollaborator', { eventId: sample.event.id, email: 'helper@external.example' }, sample.auth);
  const helper = await loginSession(request, 'helper@external.example');
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE + '#e=' + sample.event.id);
  await googleLogin(page);
  await page.getByRole('button', { name: '大会設定', exact: true }).click();
  await expect(page.getByText(/helper@external\.example（.* 追加） — 招待中（相手のログイン待ち）/)).toBeVisible();
  await ok(request, 'linkAccount', {}, helper);
  expect((await adminCall(request, 'eventDetail', { eventId: sample.event.id }, helper)).error.code).toBe('NOT_FOUND');
  await page.reload();
  await page.getByRole('button', { name: '大会設定', exact: true }).click();
  await expect(page.getByText(/— 承認待ち/)).toBeVisible();
  await page.getByRole('button', { name: '承認' }).click();
  await page.getByRole('button', { name: 'この人を承認' }).click();
  await expect(page.getByText('共同主催者を承認しました。')).toBeVisible();
  await expect(page.getByText(/helper@external\.example（.* 追加）$/)).toBeVisible();
  expect((await ok(request, 'eventDetail', { eventId: sample.event.id }, helper)).event.role).toBe('editor');
});
