// UX 改善 S3: 受け取り済みの内容を使い、画面の移動での通信を減らす（回数は API の操作の数。時間の短縮率ではない）。
//   作成 … createEvent 1 回で運営画面（一覧・大会を読み直さない）
//   一覧 → 大会 … eventDetail 1 回 / 欄の保存 … 1 回 / 大会 → 一覧 … 手元の一覧をすぐ出して bootstrap 1 回
// 権限はサーバーが毎回確かめる（画面用の記憶では開けない）。遅れて届いた別の大会の応答で画面を戻さない。
import { test, expect } from '@playwright/test';
import { reset, adminCall, loginSession, routeAppsScript, fakeGoogle, googleLogin, ORGANIZER, openSettings, openCreate, recordActions, interceptAction, shortTimeouts } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';
const OTHER = 'other-organizer@example.org';

async function seed(request, names, email = ORGANIZER) {
  const auth = await loginSession(request, email);
  const ids = [];
  for (const name of names) {
    const res = await adminCall(request, 'createEvent', { name, template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, auth);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    ids.push(res.data.eventId);
  }
  return { auth, ids };
}

async function home(page, request, hooks) {
  await routeAppsScript(page, request);
  if (hooks) await hooks(page);
  const actions = await recordActions(page); // 後から登録した方が先に呼ばれる（記録してから hooks へ渡す）
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await page.locator('#event-list').waitFor();
  return actions;
}

const openCard = (page, name) => page.locator('.event-card').filter({ hasText: name }).getByRole('button', { name: /を開く$/ }).click();

test('通信回数: 作成は createEvent の 1 回で運営画面、一覧 → 大会は eventDetail の 1 回、欄の保存は 1 回、一覧へ戻ると bootstrap の 1 回', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await seed(request, ['既存の大会']);
  const actions = await home(page, request);
  // 一覧 → 作成画面: 通信しない
  actions.length = 0;
  await openCreate(page);
  await page.locator('#new-name').fill('通信回数の確認');
  await page.locator('#new-expected').fill('12'); // 見積もりの更新も通信しない
  expect(actions).toEqual([]);
  // 作成: 1 回で運営画面が出る
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  await expect(page.getByRole('heading', { name: '通信回数の確認' })).toBeVisible();
  await expect(page).toHaveURL(/#e=EVT-[A-Z0-9]+$/);
  await expect(page.locator('#next-step')).toContainText('選手を登録');
  await page.waitForTimeout(600);
  expect(actions).toEqual(['createEvent']);
  // 欄の保存: 1 回（応答の内容で画面を更新し、読み直さない）
  actions.length = 0;
  await openSettings(page);
  await page.locator('#set-notes').fill('メモ');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存済み');
  await page.waitForTimeout(600);
  expect(actions).toEqual(['updateEvent']);
  // 一覧へ戻る: 手元の一覧（作った大会を含む）をすぐに出し、裏で 1 回読み直す
  actions.length = 0;
  await page.locator('#back-to-list').click();
  await expect(page.locator('.event-card').filter({ hasText: '通信回数の確認' })).toBeVisible();
  await expect(page.locator('#list-refreshing')).toHaveCount(0);
  expect(actions).toEqual(['bootstrap']);
  // 検索・状態の絞り込み: 通信しない
  actions.length = 0;
  await page.locator('#home-search').fill('既存');
  await expect(page.locator('.event-card')).toHaveCount(1);
  await page.getByRole('button', { name: '開催中', exact: true }).click();
  await expect(page.locator('.event-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'すべて', exact: true }).click();
  await page.locator('#home-search').fill('');
  await expect(page.locator('.event-card')).toHaveCount(2);
  expect(actions).toEqual([]);
  // 一覧 → 大会: 大会の読み込みだけ（一覧は読み直さない）
  await openCard(page, '既存の大会');
  await expect(page.getByRole('heading', { name: '既存の大会' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(actions).toEqual(['eventDetail']);
});

test('一覧へ戻ったとき: 前回取得した一覧をすぐに出し、取得中であることを示す。読み直しに失敗しても一覧は残す', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await seed(request, ['一覧の確認']);
  let mode = 'pass';
  let release;
  await home(page, request, async (p) => {
    await interceptAction(p, request, 'bootstrap', async ({ pass, reply }) => {
      if (mode === 'hold') await new Promise((r) => (release = r));
      if (mode === 'fail') return reply(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: '一時的なエラー' } }));
      await pass();
    });
  });
  await openCard(page, '一覧の確認');
  await expect(page.getByRole('heading', { name: '一覧の確認' })).toBeVisible();
  mode = 'hold';
  await page.locator('#back-to-list').click();
  await expect(page.locator('.event-card')).toHaveCount(1); // 応答を待たずに出る
  await expect(page.locator('#list-refreshing')).toContainText('前回取得した一覧');
  mode = 'fail';
  release();
  await expect(page.locator('#list-refreshing')).toHaveCount(0);
  await expect(page.locator('.event-card')).toHaveCount(1);
  await expect(page.getByText(/一覧を更新できませんでした/)).toBeVisible();
});

test('応答の逆転: A を開いた直後に一覧へ戻って B を開くと、遅れて届いた A の応答で B の画面を置き換えない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const { ids } = await seed(request, ['大会 A', '大会 B']);
  let releaseA;
  let heldA = false;
  await home(page, request, async (p) => {
    await interceptAction(p, request, 'eventDetail', async ({ body, pass }) => {
      if (body.payload.eventId === ids[0] && !heldA) {
        heldA = true;
        await new Promise((r) => (releaseA = r));
      }
      await pass();
    });
  });
  await openCard(page, '大会 A');
  await expect(page.getByRole('heading', { name: '読み込み中…' })).toBeVisible();
  await page.locator('#back-to-list').click();
  await openCard(page, '大会 B');
  await expect(page.getByRole('heading', { name: '大会 B' })).toBeVisible();
  releaseA(); // A の遅い応答が届く
  await page.waitForTimeout(800);
  await expect(page.getByRole('heading', { name: '大会 B' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp('#e=' + ids[1] + '$'));
  // 一覧へ戻った後に届いた応答でも、一覧を大会の画面に戻さない
  heldA = false;
  await page.locator('#back-to-list').click();
  await openCard(page, '大会 A');
  await page.locator('#back-to-list').click();
  await expect(page.locator('#event-list')).toBeVisible();
  releaseA();
  await page.waitForTimeout(800);
  await expect(page.locator('#event-list')).toBeVisible();
  await expect(page.locator('.tabs')).toHaveCount(0);
});

test('権限は毎回サーバーが確かめる: 一覧を読み込み済みでも、他人の非公開の大会・権限を解除された大会は開けない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const other = await seed(request, ['他人の非公開大会'], OTHER);
  // 共同主催者として招待された大会（後で解除される）
  expect((await adminCall(request, 'addCollaborator', { eventId: other.ids[0], email: ORGANIZER }, other.auth)).ok).toBe(true);
  const own = await seed(request, ['自分の大会']);
  // 招待された本人がログインして紐付けを申請し、主催者が承認する（Google が持ち主を保証しないアドレスの手順）
  expect((await adminCall(request, 'linkAccount', {}, own.auth)).ok).toBe(true);
  const invited = (await adminCall(request, 'eventDetail', { eventId: other.ids[0] }, other.auth)).data.collaborators[0];
  if (invited.status !== 'active') {
    expect((await adminCall(request, 'approveCollaborator', { eventId: other.ids[0], collabId: invited.id, rev: invited.rev, ref: invited.claims[0].ref }, other.auth)).ok).toBe(true);
  }
  const actions = await home(page, request);
  await expect(page.locator('.event-card').filter({ hasText: '他人の非公開大会' })).toContainText('共同主催');
  // 権限を解除する（この画面の一覧の記憶には残っている）
  const d = await adminCall(request, 'eventDetail', { eventId: other.ids[0] }, other.auth);
  expect((await adminCall(request, 'removeCollaborator', { eventId: other.ids[0], collabId: d.data.collaborators[0].id }, other.auth)).ok).toBe(true);
  actions.length = 0;
  await openCard(page, '他人の非公開大会');
  await expect(page.getByRole('heading', { name: 'この大会を運営する権限がありません' })).toBeVisible();
  await expect(page.locator('.tabs')).toHaveCount(0);
  await expect(page.getByText('他人の非公開大会')).toHaveCount(0);
  expect(actions).toEqual(['eventDetail']);
  // 一覧へ戻ると、解除された大会は一覧からも消える
  await page.getByRole('link', { name: '自分の大会の一覧へ' }).click();
  await expect(page.locator('#list-refreshing')).toHaveCount(0);
  await expect(page.locator('.event-card')).toHaveCount(1);
  await expect(page.locator('.event-card')).toContainText('自分の大会');
  // 存在しない大会の URL
  await page.goto(`${ADMIN_PAGE}#e=EVT-NOTEXIST1`);
  await expect(page.getByRole('heading', { name: 'この大会を運営する権限がありません' })).toBeVisible();
  expect(own.ids.length).toBe(1);
});

test('ログインが無効になった: 画面用の記憶では開かず、ログインの画面に戻る。別のアカウントに前の人の一覧を見せない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await seed(request, ['A さんの大会']);
  await home(page, request);
  await expect(page.locator('.event-card')).toHaveCount(1);
  // サーバー側でセッションを無効にする（期限切れに相当）
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('tpoc-google')).session);
  expect((await adminCall(request, 'logout', { session }, 'anon')).ok).toBe(true);
  await openCard(page, 'A さんの大会');
  await expect(page.getByRole('heading', { name: 'この大会の運営画面を開く' })).toBeVisible();
  await expect(page.locator('.tabs')).toHaveCount(0);
  // 別のアカウントでログイン: 前の人の大会は開けず、一覧にも出ない
  await page.unroute('https://accounts.google.com/gsi/client');
  await fakeGoogle(page, request, OTHER);
  await page.reload();
  await googleLogin(page);
  await expect(page.getByRole('heading', { name: 'この大会を運営する権限がありません' })).toBeVisible();
  await page.getByRole('link', { name: '自分の大会の一覧へ' }).click();
  await expect(page.locator('#event-list')).toBeVisible();
  await expect(page.locator('#list-refreshing')).toHaveCount(0); // 裏の読み直しが終わるまで待つ
  await expect(page.locator('.event-card')).toHaveCount(0);
});

test('作成の応答が消えて送り直した（前の送信で作成済み）: 同じ大会を開き、大会の読み込みは 1 回だけ。二重には作らない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await shortTimeouts(page, 2000);
  const actions = await home(page, request, async (p) => {
    await interceptAction(p, request, 'createEvent', async ({ forward, pass, n }) => {
      if (n === 1) return void (await forward()); // 作成はされるが応答が届かない
      await pass();
    });
  });
  await openCreate(page);
  await page.locator('#new-name').fill('送り直しで開く大会');
  actions.length = 0;
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  await expect(page.getByRole('heading', { name: '送り直しで開く大会' })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(600);
  expect(actions).toEqual(['createEvent', 'createEvent', 'eventDetail']);
  const auth = await loginSession(request, ORGANIZER);
  const boot = await adminCall(request, 'bootstrap', {}, auth);
  expect(boot.data.events.length).toBe(1);
});

test('作成の送信中に別の画面へ移った: 遅れて届いた作成の応答で今の画面を置き換えない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  let release;
  await home(page, request, async (p) => {
    await interceptAction(p, request, 'createEvent', async ({ pass }) => {
      await new Promise((r) => (release = r));
      await pass();
    });
  });
  await openCreate(page);
  await page.locator('#new-name').fill('遅い作成');
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  await expect(page.locator('#create-form .save-state')).toHaveText('保存中…');
  await page.locator('#back-to-list').click();
  await expect(page.locator('#event-list')).toBeVisible();
  release();
  await expect(page.getByText(/大会を作成しました。（前の画面の操作）/)).toBeVisible();
  await expect(page.locator('#event-list')).toBeVisible();
  await expect(page).not.toHaveURL(/#e=/);
});
