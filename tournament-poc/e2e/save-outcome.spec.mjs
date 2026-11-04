// 監査 PR-05（W-001 / C-047）: 運営画面は通信を待ち続けず、保存の結果を「保存済み・保存されなかった・確認できない」に分ける。
// 確認できないときは入力を残し、同じ操作（同じ requestId）として送り直せる。送った後に画面を移ったら、遅れて届いた応答で画面を戻さない。
import { test, expect } from '@playwright/test';
import { routeAppsScript, publishedSample, fakeGoogle, googleLogin, ORGANIZER, ADMIN_ENDPOINT, expectNoHorizontalOverflow } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';

/** admin/config.js の値に通信の期限（短く）を足す */
async function shortTimeouts(page, ms) {
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

/** 運営用 API の指定した操作だけ振る舞いを変える（それ以外は通常の模擬サーバーへ）。送られた requestId を記録する */
async function interceptAction(page, request, action, handler) {
  const seen = [];
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action !== action) return route.fallback();
    seen.push(body.requestId);
    const forward = async () => {
      const r = await request.post('/admin-post', { headers: { 'content-type': 'text/plain;charset=utf-8' }, data: route.request().postData() || '' });
      return r.text();
    };
    await handler({ route, body, forward, n: seen.length });
  });
  return seen;
}

async function openResults(page, request, sample) {
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${sample.event.id}`);
  await googleLogin(page);
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  await page.getByRole('button', { name: 'グループD', exact: true }).click();
  const ids = sample.groups[3].matches.map((m) => m.id);
  return (i) => page.locator(`.match-editor[data-match-id="${ids[i]}"]`);
}

test('応答がない（サーバーに届いていない）: 待ち続けずに「確認できない」と案内し、入力を残す。同じ操作として送ると保存できる', async ({ page, request }) => {
  await shortTimeouts(page, 2000);
  const sample = await publishedSample(request);
  let mode = 'hold';
  await routeAppsScript(page, request); // 先に登録（後から登録した横取りが優先される）
  const seen = await interceptAction(page, request, 'saveMatchResult', async ({ route, forward }) => {
    if (mode === 'hold') return; // 応答しない（運営画面が期限で打ち切る）
    await route.fulfill({ status: 200, contentType: 'application/json', body: await forward(), headers: { 'access-control-allow-origin': '*' } });
  });
  const card = await openResults(page, request, sample);
  await card(0).locator('input').nth(0).fill('3');
  await card(0).locator('input').nth(1).fill('0');
  await card(0).getByRole('button', { name: '確定', exact: true }).click();
  const notice = page.locator('.toast--unconfirmed');
  await expect(notice).toBeVisible({ timeout: 15000 });
  await expect(notice).toContainText('保存できたか確認できませんでした');
  await expect(notice).toContainText('入力した内容は残しています');
  // 入力は残り、他の操作もできる（待ち続けない）
  await expect(card(0).locator('input').nth(0)).toHaveValue('3');
  await expect(card(0).locator('input').nth(1)).toHaveValue('0');
  await expect(card(0).locator('.status')).toHaveText('未開始');
  await expect(card(1).getByRole('button', { name: '確定', exact: true })).toBeEnabled();
  expect(seen.length).toBe(2);
  expect(seen[0]).toBe(seen[1]); // 期限切れの後の自動の送り直しも同じ requestId
  await expectNoHorizontalOverflow(page);
  // 同じ操作としてもう一度送る → 保存される（requestId は同じ）
  mode = 'pass';
  await notice.getByRole('button', { name: '同じ操作としてもう一度送る' }).click();
  await expect(page.getByText('結果を確定しました。').last()).toBeVisible();
  await expect(notice).toBeHidden();
  await page.getByRole('button', { name: 'すべての状態' }).click();
  await expect(card(0).locator('.status')).toHaveText('確定済み');
  expect(new Set(seen).size).toBe(1);
});

test('保存はされたが応答が消えた: 同じ requestId で送り直して保存済みを確かめ、二重に保存しない', async ({ page, request }) => {
  await shortTimeouts(page, 5000);
  const sample = await publishedSample(request);
  await routeAppsScript(page, request);
  const seen = await interceptAction(page, request, 'saveMatchResult', async ({ route, forward, n }) => {
    const text = await forward(); // サーバーでは保存される
    if (n === 1) return route.abort('connectionreset'); // 応答だけが消える
    await route.fulfill({ status: 200, contentType: 'application/json', body: text, headers: { 'access-control-allow-origin': '*' } });
  });
  const card = await openResults(page, request, sample);
  await card(0).locator('input').nth(0).fill('3');
  await card(0).locator('input').nth(1).fill('1');
  await card(0).getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.getByText('前の送信で保存されていました').last()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.toast--unconfirmed')).toHaveCount(0);
  await page.getByRole('button', { name: 'すべての状態' }).click();
  await expect(card(0).locator('.status')).toHaveText('確定済み');
  expect(seen.length).toBe(2);
  expect(seen[0]).toBe(seen[1]);
  // サーバーの記録でも、結果の保存は 1 回だけ
  const detail = await (await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'eventDetail', payload: { eventId: sample.event.id }, auth: { adminKey: 'test-admin-key-0123456789-abcdefghij' } }) })).json();
  const saves = detail.data.history.filter((h) => h.entityId === sample.groups[3].matches[0].id && /^match\./.test(h.action));
  expect(saves.length).toBe(1);
});

test('送った後に画面を移った: 遅れて届いた応答で、移った先の画面を前の大会に戻さない', async ({ page, request }) => {
  await shortTimeouts(page, 10000);
  const sample = await publishedSample(request);
  await routeAppsScript(page, request);
  await interceptAction(page, request, 'saveMatchResult', async ({ route, forward }) => {
    const text = await forward();
    await new Promise((r) => setTimeout(r, 2500)); // 応答が遅れる
    await route.fulfill({ status: 200, contentType: 'application/json', body: text, headers: { 'access-control-allow-origin': '*' } });
  });
  const card = await openResults(page, request, sample);
  await card(0).locator('input').nth(0).fill('3');
  await card(0).locator('input').nth(1).fill('2');
  await card(0).getByRole('button', { name: '確定', exact: true }).click();
  // 応答を待たずに大会の一覧（主催者のホーム）へ移る
  await page.evaluate(() => {
    window.location.hash = '';
  });
  // 大会の運営画面（見出し・タブ）は閉じ、ホーム（自分の大会の一覧）が出ている
  await expect(page.locator('.event-head__title')).toHaveCount(0);
  await expect(page.getByText('（前の画面の操作）').last()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
  await expect(page.locator('.event-head__title')).toHaveCount(0); // 応答が来ても前の大会の運営画面に戻らない
  await expect(page.getByRole('button', { name: '試合結果', exact: true })).toHaveCount(0);
});

test('大会の読み込みが止まった: 待ち続けずに理由と「再読み込み」を出し、押すと開ける', async ({ page, request }) => {
  await shortTimeouts(page, 2000);
  const sample = await publishedSample(request);
  let hold = true;
  await routeAppsScript(page, request);
  await interceptAction(page, request, 'eventDetail', async ({ route, forward }) => {
    if (hold) return;
    await route.fulfill({ status: 200, contentType: 'application/json', body: await forward(), headers: { 'access-control-allow-origin': '*' } });
  });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${sample.event.id}`);
  await googleLogin(page);
  await expect(page.getByText(/応答がありませんでした/)).toBeVisible({ timeout: 10000 });
  hold = false;
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByRole('heading', { name: sample.event.name })).toBeVisible();
});
