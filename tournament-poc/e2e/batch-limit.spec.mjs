// 監査 PR-15（W-005）: まとめて確定は 1 回に 64 試合まで（サーバーの上限は変えない）。65 試合以上あるときは
// 「64 試合を確定（残り n 試合）」として、押すたびに画面の順で 64 試合ずつ送り、保存できた分だけ下書きから外す。
import { test, expect } from '@playwright/test';
import { reset, adminCall, loginSession, routeAppsScript, fakeGoogle, googleLogin, ORGANIZER, ADMIN_ENDPOINT, expectNoHorizontalOverflow } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';
test.describe.configure({ timeout: 240_000 });

async function ok(request, action, payload, auth) {
  const res = await adminCall(request, action, payload, auth);
  expect(res.ok, `${action}: ${JSON.stringify(res.error)}`).toBe(true);
  return res.data;
}

/** 総当たり（groups 組 × perGroup 人。どの組も 60 試合以下なので節の選択は出ない）。対戦カードまで作る */
async function seed(request, groups, perGroup) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const auth = await loginSession(request, ORGANIZER);
  const id = (await ok(request, 'createEvent', { name: 'まとめて確定の上限', template: 'robin', groupCount: groups, rule: { format: 'legs', bestOf: 5 } }, auth)).eventId;
  await ok(request, 'addPlayers', { eventId: id, names: Array.from({ length: groups * perGroup }, (_, i) => '選手' + String(i + 1).padStart(3, '0')) }, auth);
  const st = (await ok(request, 'eventDetail', { eventId: id }, auth)).stages[0];
  await ok(request, 'autoAssign', { eventId: id, stageId: st.id }, auth);
  await ok(request, 'generateMatches', { eventId: id, stageId: st.id }, auth);
  return { id, auth, groupNames: Array.from({ length: groups }, (_, i) => 'グループ' + 'ABCDEFGH'[i]) };
}

/** 運営用 API の saveMatchResults だけ振る舞いを変える（送った結果の一覧を記録する） */
async function interceptBatch(page, request, handler) {
  const seen = [];
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action !== 'saveMatchResults') return route.fallback();
    seen.push(body);
    const forward = async () => (await request.post('/admin-post', { headers: { 'content-type': 'text/plain;charset=utf-8' }, data: route.request().postData() || '' })).text();
    await handler({ route, forward, n: seen.length });
  });
  return seen;
}

async function open(page, request, s) {
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${s.id}`);
  await googleLogin(page);
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
}

/** 画面の順（組 A から、各組の上から）に n 試合へ 3-0 を入力する（skip の試合は飛ばす）。入力した試合 ID を順に返す */
async function fillDrafts(page, s, n, skip = []) {
  const ids = [];
  for (const g of s.groupNames) {
    if (ids.length >= n) break;
    await page.getByRole('button', { name: g, exact: true }).click();
    const cards = page.locator('.match-editor:not(.match-editor--final)');
    const count = await cards.count();
    for (let i = 0; i < count && ids.length < n; i++) {
      const card = cards.nth(i);
      if (skip.includes(await card.getAttribute('data-match-id'))) continue;
      await card.locator('input').nth(0).fill('3');
      await card.locator('input').nth(1).fill('0');
      ids.push(await card.getAttribute('data-match-id'));
    }
  }
  expect(ids.length).toBe(n);
  return ids;
}

async function finalIds(request, s) {
  const d = await ok(request, 'eventDetail', { eventId: s.id }, s.auth);
  return new Set(d.stages[0].groups.flatMap((g) => g.matches).filter((m) => m.status === 'final').map((m) => m.id));
}

const bar = (page) => page.locator('.batch-bar');

test('64 試合はそのまま 1 回で確定。65 試合は「64 試合を確定（残り 1 試合）」で、画面の順の 64 試合だけ送り、残りの下書きを残す', async ({ page, request }) => {
  const s = await seed(request, 2, 9); // 72 試合
  await routeAppsScript(page, request);
  const seen = await interceptBatch(page, request, async ({ route, forward }) => route.fulfill({ status: 200, contentType: 'application/json', body: await forward(), headers: { 'access-control-allow-origin': '*' } }));
  await open(page, request, s);
  const ids = await fillDrafts(page, s, 64);
  await expect(bar(page)).toContainText('確定できる入力が 64 試合あります');
  await expect(bar(page).getByRole('button')).toHaveText('64 試合をまとめて確定');
  // 1 試合増やすと 65（上限を超える）
  ids.push(...(await fillDrafts(page, { groupNames: ['グループB'] }, 1, ids)));
  await expect(bar(page)).toContainText('確定できる入力が 65 試合あります');
  await expect(bar(page)).toContainText('残り 1 試合');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('batch-65.png') });
  await bar(page).getByRole('button').click();
  await expect(page.getByText('64 試合の結果を確定しました。').last()).toBeVisible();
  expect(seen.length).toBe(1);
  expect(seen[0].payload.results.length).toBe(64);
  const finals = await finalIds(request, s);
  expect(finals.size).toBe(64);
  // 保存した 64 試合は画面の順の先頭 64 試合。65 試合目の下書きは残る
  const sent = seen[0].payload.results.map((r) => r.matchId);
  expect(new Set(sent)).toEqual(finals);
  const left = ids.filter((id) => !finals.has(id));
  expect(left.length).toBe(1);
  await page.getByRole('button', { name: 'グループB', exact: true }).click();
  const card = page.locator(`.match-editor[data-match-id="${left[0]}"]`);
  await expect(card.getByText('未保存の入力')).toBeVisible();
  await expect(card.locator('input').nth(0)).toHaveValue('3');
  await expect(bar(page)).toBeHidden();
});

test('128 試合: 押すたびに 64 試合ずつ（残り 64 → 0）。2 回で全部確定し、二重に送らない', async ({ page, request }) => {
  const s = await seed(request, 3, 11); // 165 試合
  await routeAppsScript(page, request);
  const seen = await interceptBatch(page, request, async ({ route, forward }) => route.fulfill({ status: 200, contentType: 'application/json', body: await forward(), headers: { 'access-control-allow-origin': '*' } }));
  await open(page, request, s);
  const ids = await fillDrafts(page, s, 128);
  await expect(bar(page)).toContainText('確定できる入力が 128 試合あります');
  await expect(bar(page)).toContainText('残り 64 試合');
  await bar(page).getByRole('button').click();
  await expect(page.getByText('64 試合の結果を確定しました。').last()).toBeVisible();
  await expect(bar(page)).toContainText('確定できる入力が 64 試合あります');
  await expect(bar(page)).not.toContainText('残り');
  await bar(page).getByRole('button').click();
  await expect(bar(page)).toBeHidden();
  expect(seen.length).toBe(2);
  const first = seen[0].payload.results.map((r) => r.matchId);
  const second = seen[1].payload.results.map((r) => r.matchId);
  expect(first.length + second.length).toBe(128);
  expect(first.filter((id) => second.includes(id))).toEqual([]);
  expect(first).toEqual(ids.slice(0, 64)); // 画面の順
  const finals = await finalIds(request, s);
  expect(ids.every((id) => finals.has(id))).toBe(true);
  expect(finals.size).toBe(128);
});

test('同時編集の競合: 送る 64 試合の 1 つを別の画面で確定していたら何も保存せず、他の下書きを残す。読み直した後の確定で残りを保存する', async ({ page, request }) => {
  const s = await seed(request, 2, 9);
  await routeAppsScript(page, request);
  const seen = await interceptBatch(page, request, async ({ route, forward }) => route.fulfill({ status: 200, contentType: 'application/json', body: await forward(), headers: { 'access-control-allow-origin': '*' } }));
  await open(page, request, s);
  const ids = await fillDrafts(page, s, 65);
  // 別の画面（API）で 3 試合目を確定する
  const d = await ok(request, 'eventDetail', { eventId: s.id }, s.auth);
  const m = d.stages[0].groups.flatMap((g) => g.matches).find((x) => x.id === ids[2]);
  await ok(request, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 0, p2Legs: 3 }, s.auth);
  await bar(page).getByRole('button').click();
  await expect(page.locator('.toast--error').last()).toContainText('確定済みの試合が含まれています');
  expect((await finalIds(request, s)).size, '何も保存しない').toBe(1);
  // 読み直すと、別の画面で確定した試合の下書きだけが外れ、残り 64 試合の下書きは残る
  await expect(bar(page)).toContainText('確定できる入力が 64 試合あります');
  await bar(page).getByRole('button').click();
  await expect(page.getByText('64 試合の結果を確定しました。').last()).toBeVisible();
  const finals = await finalIds(request, s);
  expect(finals.size).toBe(65);
  expect(ids.every((id) => finals.has(id))).toBe(true);
  expect(seen.length).toBe(2);
});

test('応答が消えた: 「確認できない」で下書きを残し、同じ操作として送り直すと同じ 64 試合だけ保存する（二重にしない）', async ({ page, request }) => {
  const s = await seed(request, 2, 9);
  let mode = 'lose';
  await routeAppsScript(page, request);
  const seen = await interceptBatch(page, request, async ({ route, forward }) => {
    const body = await forward(); // サーバーには届いて保存される
    if (mode === 'lose') return route.abort('connectionreset'); // 応答だけが消える
    await route.fulfill({ status: 200, contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
  });
  await open(page, request, s);
  const ids = await fillDrafts(page, s, 65);
  await bar(page).getByRole('button').click();
  const notice = page.locator('.toast--unconfirmed');
  await expect(notice).toBeVisible({ timeout: 20000 });
  mode = 'pass';
  await notice.getByRole('button', { name: '同じ操作としてもう一度送る' }).click();
  await expect(notice).toBeHidden({ timeout: 20000 });
  const finals = await finalIds(request, s);
  expect(finals.size).toBe(64);
  expect(new Set(seen.map((b) => b.requestId)).size, '送り直しも同じ requestId').toBe(1);
  expect(seen.every((b) => b.payload.results.length === 64)).toBe(true);
  const left = ids.filter((id) => !finals.has(id));
  expect(left.length).toBe(1);
  await page.getByRole('button', { name: 'グループB', exact: true }).click();
  await expect(page.locator(`.match-editor[data-match-id="${left[0]}"]`).getByText('未保存の入力')).toBeVisible();
});
