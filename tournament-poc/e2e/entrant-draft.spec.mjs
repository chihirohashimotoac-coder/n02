// 監査 PR-14（W-004）: トーナメントの出場者・シードの編集中の並び（下書き）は、保存できなかったとき（通信エラー・
// 検証で拒否・ログイン切れ）には残し、保存できたとき・「変更を取り消す」を押したときだけ消す。別の大会の画面に混ざらない。
import { test, expect } from '@playwright/test';
import { reset, adminCall, loginSession, routeAppsScript, fakeGoogle, googleLogin, ORGANIZER, ADMIN_ENDPOINT, expectNoHorizontalOverflow, openTab } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';
const NAMES = ['選手A', '選手B', '選手C', '選手D', '選手E'];

async function ok(request, action, payload, auth) {
  const res = await adminCall(request, action, payload, auth);
  expect(res.ok, `${action}: ${JSON.stringify(res.error)}`).toBe(true);
  return res.data;
}

/** 主催者のトーナメントの大会（5 名・出場者は未保存）を 2 つ作る */
async function seed(request) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const org = await loginSession(request, ORGANIZER);
  const make = async (name, names) => {
    const id = (await ok(request, 'createEvent', { name, template: 'elimination', rule: { format: 'legs', bestOf: 3 } }, org)).eventId;
    await ok(request, 'addPlayers', { eventId: id, names }, org);
    return id;
  };
  return { org, a: await make('下書きの大会A', NAMES), b: await make('下書きの大会B', ['別の1', '別の2', '別の3']) };
}

/** 運営用 API の setEntrants だけ振る舞いを変える（それ以外は通常の模擬サーバーへ） */
async function interceptSetEntrants(page, request, handler) {
  const seen = [];
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action !== 'setEntrants') return route.fallback();
    seen.push(body);
    const forward = async () => (await request.post('/admin-post', { headers: { 'content-type': 'text/plain;charset=utf-8' }, data: route.request().postData() || '' })).text();
    await handler({ route, forward, n: seen.length });
  });
  return seen;
}

const fulfillError = (route, code, message) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message } }), headers: { 'access-control-allow-origin': '*' } });

async function openBracketTab(page, eventId) {
  await page.goto(`${ADMIN_PAGE}#e=${eventId}`);
  await openTab(page, '組み合わせ');
}

/** 下書き: 全員を追加し、選手A を一番下へ（B C D E A） */
async function makeDraft(page) {
  await page.getByRole('button', { name: '登録選手を全員追加' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '選手A を下へ' }).click();
}

const order = (page) => page.locator('.seed-row .tb-item').allInnerTexts();
const DRAFT = ['選手B', '選手C', '選手D', '選手E', '選手A'];

test('検証で拒否・通信エラー（確認できない）: 下書きを残す。送り直して保存できたら保存済みの並びになる', async ({ page, request }) => {
  const s = await seed(request);
  let mode = 'reject';
  await routeAppsScript(page, request);
  const seen = await interceptSetEntrants(page, request, async ({ route, forward }) => {
    if (mode === 'reject') return fulfillError(route, 'VALIDATION', '出場者の指定が不正です（試験）。');
    if (mode === 'drop') return route.abort('connectionreset');
    await route.fulfill({ status: 200, contentType: 'application/json', body: await forward(), headers: { 'access-control-allow-origin': '*' } });
  });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${s.a}`);
  await googleLogin(page);
  await openTab(page, '組み合わせ');
  await makeDraft(page);
  expect(await order(page)).toEqual(DRAFT);
  // 検証で拒否
  await page.getByRole('button', { name: '出場者とシードを保存' }).click();
  await expect(page.getByText('出場者の指定が不正です（試験）。').last()).toBeVisible();
  expect(await order(page), '拒否されても下書きを残す').toEqual(DRAFT);
  await expect(page.getByRole('button', { name: '変更を取り消す' })).toBeVisible();
  // 通信エラー（応答なし）: 確認できない → 下書きを残す
  mode = 'drop';
  await page.getByRole('button', { name: '出場者とシードを保存' }).click();
  const notice = page.locator('.toast--unconfirmed');
  await expect(notice).toBeVisible({ timeout: 15000 });
  expect(await order(page), '確認できないときも下書きを残す').toEqual(DRAFT);
  await expectNoHorizontalOverflow(page);
  // 同じ操作として送り直す → 保存できる
  mode = 'pass';
  await notice.getByRole('button', { name: '同じ操作としてもう一度送る' }).click();
  await expect(page.getByText('保存しました。').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '変更を取り消す' })).toHaveCount(0);
  expect(await order(page)).toEqual(DRAFT);
  const st = (await ok(request, 'eventDetail', { eventId: s.a }, s.org)).stages[0];
  const nameOf = Object.fromEntries((await ok(request, 'eventDetail', { eventId: s.a }, s.org)).players.map((p) => [p.id, p.name]));
  expect(st.entries.slice().sort((x, y) => x.seed - y.seed).map((e) => nameOf[e.playerId])).toEqual(DRAFT);
  expect(seen.length).toBeGreaterThanOrEqual(3);
});

test('ログイン切れ: 下書きを残し、ログインし直すと同じ下書きが続く', async ({ page, request }) => {
  const s = await seed(request);
  let expire = true;
  await routeAppsScript(page, request);
  await interceptSetEntrants(page, request, async ({ route, forward }) => {
    if (expire) {
      expire = false;
      return fulfillError(route, 'AUTH_EXPIRED', 'ログインの有効期限が切れました。もう一度ログインしてください。');
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: await forward(), headers: { 'access-control-allow-origin': '*' } });
  });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${s.a}`);
  await googleLogin(page);
  await openTab(page, '組み合わせ');
  await makeDraft(page);
  await page.getByRole('button', { name: '出場者とシードを保存' }).click();
  await expect(page.getByText('ログインの有効期限が切れました').first()).toBeVisible();
  await googleLogin(page);
  await openTab(page, '組み合わせ');
  expect(await order(page), 'ログインし直した後も下書きが続く').toEqual(DRAFT);
  await page.getByRole('button', { name: '出場者とシードを保存' }).click();
  await expect(page.getByText('保存しました。').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '変更を取り消す' })).toHaveCount(0);
});

test('保存できた・「変更を取り消す」: 下書きを消す。別の大会の画面には下書きが混ざらない', async ({ page, request }) => {
  const s = await seed(request);
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${s.a}`);
  await googleLogin(page);
  await openTab(page, '組み合わせ');
  await makeDraft(page);
  // 別の大会を開く → その大会の保存済みの並び（空）。戻ると A の下書きが続く
  await openBracketTab(page, s.b);
  await expect(page.locator('.event-head__title')).toHaveText('下書きの大会B');
  expect(await order(page)).toEqual([]);
  await expect(page.getByText(/出場者とシード（0 名/)).toBeVisible();
  await openBracketTab(page, s.a);
  await expect(page.locator('.event-head__title')).toHaveText('下書きの大会A');
  expect(await order(page)).toEqual(DRAFT);
  // 取り消す → 保存済み（空）に戻る
  await page.getByRole('button', { name: '変更を取り消す' }).click();
  expect(await order(page)).toEqual([]);
  // 保存できた → 下書きを消し、保存済みの並び
  await makeDraft(page);
  await page.getByRole('button', { name: '出場者とシードを保存' }).click();
  await expect(page.getByText('保存しました。').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '変更を取り消す' })).toHaveCount(0);
  expect(await order(page)).toEqual(DRAFT);
});
