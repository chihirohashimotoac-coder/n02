// UX 改善 S1: 設定の欄（section）ごとの下書きと保存状態。
// 保存していない入力は、画面を移っても・別の欄を保存しても・保存に失敗しても・読み込み直しても消えない。
// 保存できたか分からない間は「保存済み」と出さず、同じ操作（同じ requestId）としてだけ確かめられる。
import { test, expect } from '@playwright/test';
import { reset, adminCall, loginSession, routeAppsScript, fakeGoogle, googleLogin, ORGANIZER, openTab, openSettings, openCreate, shortTimeouts, interceptAction, organizerHome } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';

/** 主催者の大会（選手なし・準備中）を API で作り、その運営画面を開く */
async function openOwnEvent(page, request, opts = {}) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const auth = await loginSession(request, ORGANIZER);
  const res = await adminCall(request, 'createEvent', { name: '下書きの確認', template: opts.template || 'robin_ko', groupCount: 2, advanceCount: 1, rule: { format: 'legs', bestOf: 3 } }, auth);
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  const eventId = res.data.eventId;
  if (opts.before) await opts.before(page);
  await routeAppsScript(page, request);
  if (opts.intercept) await opts.intercept(page);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${eventId}`);
  await googleLogin(page);
  await expect(page.getByRole('heading', { name: '下書きの確認' })).toBeVisible();
  return { eventId, auth };
}

async function detailOf(request, eventId, auth) {
  const res = await adminCall(request, 'eventDetail', { eventId }, auth);
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  return res.data;
}

test('メニューの往復: 保存していない大会名は消えず、欄の中に「未保存の変更」と出る。取り消すと確定値に戻る', async ({ page, request }) => {
  await openOwnEvent(page, request);
  await openSettings(page);
  const state = page.locator('#settings-event .save-state');
  await expect(state).toHaveText('');
  await expect(page.getByRole('button', { name: '大会情報を保存' })).toBeDisabled(); // 変更がなければ保存できない
  await page.locator('#set-name').fill('下書きの確認（変更）');
  await expect(state).toHaveText('未保存の変更');
  await expect(state).toHaveAttribute('role', 'status');
  await expect(page.locator('#draft-count')).toHaveText('未保存 1');
  await openTab(page, '進行状況');
  await expect(page.locator('#draft-count')).toHaveText('未保存 1');
  await openSettings(page);
  await expect(page.locator('#set-name')).toHaveValue('下書きの確認（変更）');
  await expect(state).toHaveText('未保存の変更');
  await page.getByRole('button', { name: '変更を取り消す' }).click();
  await expect(page.locator('#set-name')).toHaveValue('下書きの確認');
  await expect(page.locator('#draft-count')).toBeHidden();
});

test('別の欄を保存しても、もう一方の欄の下書きは消えない。送った欄だけが保存済みになり、残りも続けて保存できる', async ({ page, request }) => {
  const { eventId, auth } = await openOwnEvent(page, request);
  await openSettings(page);
  await page.locator('#set-notes').fill('会場は 2 階');
  await openSettings(page, '公開・表示');
  await page.locator('#set-announcement').fill('受付は 18:30 からです');
  await openSettings(page, '基本情報');
  await expect(page.locator('#draft-count')).toHaveText('未保存 2');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存済み');
  await expect(page.locator('#draft-count')).toHaveText('未保存 1');
  let d = await detailOf(request, eventId, auth);
  expect(d.event.notes).toBe('会場は 2 階');
  expect(d.event.config.announcement || null).toBe(null); // お知らせはまだ保存していない
  await openSettings(page, '公開・表示');
  await expect(page.locator('#set-announcement')).toHaveValue('受付は 18:30 からです');
  await expect(page.locator('#settings-display .save-state')).toHaveText('未保存の変更');
  // 大会情報の保存で版が進んでも、この欄は変わっていないので、そのまま保存できる（競合にしない）
  await page.getByRole('button', { name: '表示の設定を保存' }).click();
  await expect(page.locator('#settings-display .save-state')).toHaveText('保存済み');
  d = await detailOf(request, eventId, auth);
  expect(d.event.config.announcement.text).toBe('受付は 18:30 からです');
  expect(d.event.notes).toBe('会場は 2 階');
  await expect(page.locator('#draft-count')).toBeHidden();
});

test('保存中（応答を 5 秒遅らせる）: すぐに欄が「保存中…」になり入力できない。二重に押しても 1 回だけ送る。別の欄への入力は残る', async ({ page, request }) => {
  let seen;
  const { eventId, auth } = await openOwnEvent(page, request, {
    intercept: async (p) => {
      seen = await interceptAction(p, request, 'updateEvent', async ({ pass }) => {
        await new Promise((r) => setTimeout(r, 5000)); // 試験の条件（実測値ではない）
        await pass();
      });
    },
  });
  await openSettings(page);
  await page.locator('#set-name').fill('遅い保存');
  const save = page.getByRole('button', { name: '大会情報を保存' });
  await save.dblclick();
  const started = Date.now();
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存中…', { timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(1500);
  await expect(save).toBeDisabled();
  await expect(page.locator('#settings-event fieldset.section-fields')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#set-name')).toBeDisabled();
  // 保存中も、別の欄は見られるし下書きを入力できる
  await openSettings(page, '公開・表示');
  await page.locator('#set-announcement').fill('保存中に入力したお知らせ');
  await expect(page.getByRole('button', { name: '表示の設定を保存' })).toBeDisabled(); // 書き込みは 1 つずつ
  await openSettings(page, '基本情報');
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存中…');
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存済み', { timeout: 15000 });
  expect(seen.length).toBe(1);
  await openSettings(page, '公開・表示');
  await expect(page.locator('#set-announcement')).toHaveValue('保存中に入力したお知らせ');
  await expect(page.getByRole('button', { name: '表示の設定を保存' })).toBeEnabled();
  expect((await detailOf(request, eventId, auth)).event.name).toBe('遅い保存');
});

test('保存されなかった（VALIDATION）: 入力を残し、理由を欄の中に出し続ける。「保存済み」とは出さない', async ({ page, request }) => {
  let mode = 'reject';
  const { eventId, auth } = await openOwnEvent(page, request, {
    intercept: async (p) => {
      await interceptAction(p, request, 'updateEvent', async ({ reply, pass }) => {
        if (mode === 'reject') return reply(JSON.stringify({ ok: false, error: { code: 'VALIDATION', message: '大会名を確認してください。' } }));
        await pass();
      });
    },
  });
  await openSettings(page);
  await page.locator('#set-name').fill('保存できない名前');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  const state = page.locator('#settings-event .save-state');
  await expect(state).toContainText('保存されませんでした');
  await expect(state).toContainText('大会名を確認してください。');
  await expect(page.locator('#set-name')).toHaveValue('保存できない名前');
  await expect(page.locator('#set-name')).toBeEnabled();
  await page.waitForTimeout(9000); // 数秒で消える通知とは別に、欄の表示は残る
  await expect(state).toContainText('保存されませんでした');
  expect((await detailOf(request, eventId, auth)).event.name).toBe('下書きの確認');
  mode = 'pass';
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(state).toHaveText('保存済み');
});

test('競合（2 人が同じ項目を変更）: 古い版では保存されず、最新の値と下書きの両方を示す。サーバーの値を黙って上書きしない', async ({ page, request }) => {
  const { eventId, auth } = await openOwnEvent(page, request);
  await openSettings(page);
  await page.locator('#set-name').fill('自分の変更');
  // 別の管理者（同じ主催者の別の画面）が同じ項目を先に保存する
  const before = (await detailOf(request, eventId, auth)).event;
  const other = await adminCall(request, 'updateEvent', { eventId, rev: before.rev, name: '相手の変更', dateLabel: '', status: 'draft', isPublic: false, isFeatured: false, notes: '' }, auth);
  expect(other.ok).toBe(true);
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  const state = page.locator('#settings-event .save-state');
  await expect(state).toContainText('別の画面で更新されました');
  const list = page.locator('#settings-event .conflict-list');
  await expect(list).toContainText('大会名');
  await expect(list).toContainText('最新: 相手の変更');
  await expect(list).toContainText('下書き: 自分の変更');
  await expect(page.locator('#set-name')).toHaveValue('自分の変更');
  await expect(page.getByRole('button', { name: '大会情報を保存' })).toBeDisabled(); // 確かめるまで保存できない
  expect((await detailOf(request, eventId, auth)).event.name).toBe('相手の変更');
  // 下書きを残すことを選んでから、あらためて保存する
  await page.getByRole('button', { name: '下書きを残して編集を続ける' }).click();
  await expect(page.locator('#set-name')).toHaveValue('自分の変更');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(state).toHaveText('保存済み');
  expect((await detailOf(request, eventId, auth)).event.name).toBe('自分の変更');
});

test('競合（相手は別の欄を変更）: 保存は拒否されるが、この欄は変わっていないので下書きのまま保存し直せる。最新の内容を使うこともできる', async ({ page, request }) => {
  const { eventId, auth } = await openOwnEvent(page, request);
  await openSettings(page);
  await page.locator('#set-notes').fill('自分のメモ');
  const before = (await detailOf(request, eventId, auth)).event;
  expect((await adminCall(request, 'updateEventSettings', { eventId, rev: before.rev, announcement: '相手のお知らせ' }, auth)).ok).toBe(true);
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  const state = page.locator('#settings-event .save-state');
  await expect(state).toContainText('保存されませんでした');
  await expect(page.locator('#set-notes')).toHaveValue('自分のメモ');
  await expect(page.locator('#settings-event .conflict-list')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '大会情報を保存' })).toBeEnabled();
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(state).toHaveText('保存済み');
  const d = await detailOf(request, eventId, auth);
  expect(d.event.notes).toBe('自分のメモ');
  expect(d.event.config.announcement.text).toBe('相手のお知らせ'); // 相手の変更も残る
});

test('保存できたか確認できない: 「保存済み」と出さず入力を残す。同じタブで読み込み直しても未確認のまま残り、同じ requestId で確かめると 1 回だけ保存される', async ({ page, request }) => {
  let mode = 'hold';
  let seen;
  const { eventId, auth } = await openOwnEvent(page, request, {
    before: (p) => shortTimeouts(p, 2000),
    intercept: async (p) => {
      seen = await interceptAction(p, request, 'updateEvent', async ({ pass }) => {
        if (mode === 'hold') return; // 応答しない（サーバーにも届かない）
        await pass();
      });
    },
  });
  await openSettings(page);
  await page.locator('#set-name').fill('確認できない保存');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  const state = page.locator('#settings-event .save-state');
  await expect(state).toHaveText('保存できたか確認できていません', { timeout: 15000 });
  await expect(page.locator('#set-name')).toHaveValue('確認できない保存');
  await expect(page.locator('#set-name')).toBeDisabled(); // 元の欄から新しい要求としては送らせない
  await expect(page.getByRole('button', { name: '大会情報を保存' })).toBeDisabled();
  await expect(page.locator('#settings-event')).not.toContainText('保存済み');
  expect(seen.length).toBe(2);
  expect(seen[0].requestId).toBe(seen[1].requestId);
  // 同じタブで読み込み直す → 下書きと「結果未確認」が戻る。自動では送らない
  await page.reload();
  await expect(page.getByRole('heading', { name: '下書きの確認' })).toBeVisible();
  await openSettings(page);
  await expect(state).toHaveText('保存できたか確認できていません');
  await expect(page.locator('#set-name')).toHaveValue('確認できない保存');
  await expect(page.getByRole('button', { name: '大会情報を保存' })).toBeDisabled();
  expect(seen.length).toBe(2);
  expect((await detailOf(request, eventId, auth)).event.name).toBe('下書きの確認');
  mode = 'pass';
  await page.getByRole('button', { name: '同じ操作として確認する' }).click();
  await expect(state).toHaveText('保存済み');
  expect(seen.length).toBe(3);
  expect(seen[2].requestId).toBe(seen[0].requestId);
  const d = await detailOf(request, eventId, auth);
  expect(d.event.name).toBe('確認できない保存');
  expect(d.history.filter((h) => h.action === 'event.update').length).toBe(1);
});

test('応答が消えた（保存はされた）: 同じ requestId の送り直しで保存済みを確かめ、履歴は 1 件だけ', async ({ page, request }) => {
  let seen;
  const { eventId, auth } = await openOwnEvent(page, request, {
    before: (p) => shortTimeouts(p, 2000),
    intercept: async (p) => {
      seen = await interceptAction(p, request, 'updateEvent', async ({ forward, pass, n }) => {
        if (n === 1) return void (await forward()); // サーバーは保存するが、応答は画面に届かない
        await pass();
      });
    },
  });
  await openSettings(page);
  await page.locator('#set-name').fill('応答が消えた保存');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存済み', { timeout: 15000 });
  expect(seen.length).toBe(2);
  expect(seen[0].requestId).toBe(seen[1].requestId);
  const d = await detailOf(request, eventId, auth);
  expect(d.event.name).toBe('応答が消えた保存');
  expect(d.history.filter((h) => h.action === 'event.update').length).toBe(1);
});

test('BUSY（サーバーが実行しなかった）: 同じ requestId で待って送り直し、保存できる', async ({ page, request }) => {
  let seen;
  await openOwnEvent(page, request, {
    intercept: async (p) => {
      seen = await interceptAction(p, request, 'updateEvent', async ({ reply, pass, n }) => {
        if (n === 1) return reply(JSON.stringify({ ok: false, error: { code: 'BUSY', message: '混み合っています。' } }));
        await pass();
      });
    },
  });
  await openSettings(page);
  await page.locator('#set-name').fill('混雑の後に保存');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存済み', { timeout: 15000 });
  expect(seen.length).toBe(2);
  expect(seen[0].requestId).toBe(seen[1].requestId);
});

test('ログインが切れた: 保存は止まるが下書きは残り、同じアカウントでログインし直すと続きから保存できる', async ({ page, request }) => {
  let mode = 'expired';
  await openOwnEvent(page, request, {
    intercept: async (p) => {
      await interceptAction(p, request, 'updateEvent', async ({ reply, pass }) => {
        if (mode === 'expired') return reply(JSON.stringify({ ok: false, error: { code: 'AUTH_EXPIRED', message: 'ログインの有効期限が切れました。' } }));
        await pass();
      });
    },
  });
  await openSettings(page);
  await page.locator('#set-name').fill('再ログイン後に保存');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(page.getByRole('heading', { name: 'この大会の運営画面を開く' })).toBeVisible();
  mode = 'pass';
  await googleLogin(page);
  await expect(page.getByRole('heading', { name: '下書きの確認' })).toBeVisible();
  await openSettings(page);
  await expect(page.locator('#set-name')).toHaveValue('再ログイン後に保存');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  await expect(page.locator('#settings-event .save-state')).toHaveText('保存済み');
});

test('段階の設定（形式）: 下書きはメニューを移っても残り、その段階だけを保存できる', async ({ page, request }) => {
  const { eventId, auth } = await openOwnEvent(page, request);
  const d0 = await detailOf(request, eventId, auth);
  const robin = d0.stages[0];
  await openTab(page, '形式');
  const card = page.locator(`.stage-editor[data-stage-id="${robin.id}"]`);
  await card.locator(`#stage-${robin.id}-name`).fill('予選リーグ A');
  await card.locator(`#stage-${robin.id}-labels`).fill('1: 第 1 巡');
  await expect(card.locator('.save-state')).toHaveText('未保存の変更');
  await openTab(page, '進行状況');
  await openTab(page, '形式');
  await expect(card.locator(`#stage-${robin.id}-name`)).toHaveValue('予選リーグ A');
  await expect(card.locator(`#stage-${robin.id}-labels`)).toHaveValue('1: 第 1 巡');
  // 順位の決め方（ボタンで並べ替える欄）の変更も下書きに入る
  const firstTb = await card.locator('.tb-item').first().textContent();
  await card.getByRole('button', { name: /を下へ$/ }).first().click();
  await expect(card.locator('.tb-item').first()).not.toHaveText(firstTb);
  await openTab(page, '進行状況');
  await openTab(page, '形式');
  await expect(card.locator('.tb-item').nth(1)).toHaveText(firstTb.replace(/^1\./, '2.'));
  await card.getByRole('button', { name: 'この段階を保存' }).click();
  await expect(card.locator('.save-state')).toHaveText('保存済み');
  const d1 = await detailOf(request, eventId, auth);
  expect(d1.stages[0].name).toBe('予選リーグ A');
  expect(d1.stages[0].config.roundLabels['1']).toBe('第 1 巡');
  expect(d1.stages[0].config.tiebreakers[0]).toBe(d0.stages[0].config.tiebreakers[1]);
  expect(d1.stages[1].name).toBe(d0.stages[1].name); // 他の段階は変えない
});

test('作成の下書き: 大会を開いて一覧へ戻っても・同じタブで読み込み直しても、入力が残る', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const auth = await loginSession(request, ORGANIZER);
  expect((await adminCall(request, 'createEvent', { name: '既存の大会', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, auth)).ok).toBe(true);
  await organizerHome(page, request);
  await openCreate(page);
  await page.locator('#new-name').fill('作成途中の大会');
  await page.locator('#new-template-league').check();
  await page.locator('#new-divisions').fill('2');
  await page.locator('#back-to-list').click();
  await expect(page.locator('#event-list')).toContainText('作成途中の入力が残っています');
  await page.locator('.event-card').getByRole('button', { name: /を開く$/ }).click();
  await expect(page.getByRole('heading', { name: '既存の大会' })).toBeVisible();
  await page.locator('#back-to-list').click();
  await openCreate(page);
  await expect(page.locator('#new-name')).toHaveValue('作成途中の大会');
  await expect(page.locator('#new-template-league')).toBeChecked();
  await expect(page.locator('#new-divisions')).toHaveValue('2');
  await page.reload();
  await expect(page.locator('#new-name')).toHaveValue('作成途中の大会');
  await expect(page.locator('#new-template-league')).toBeChecked();
  // 下書きにログインの情報は入れない
  const stored = await page.evaluate(() => sessionStorage.getItem('tpoc-drafts:v1') || '');
  expect(stored).toContain('作成途中の大会');
  const login = await page.evaluate(() => JSON.parse(localStorage.getItem('tpoc-google')).session);
  expect(stored).not.toContain(login);
  await page.getByRole('button', { name: '入力をリセット' }).click();
  await expect(page.locator('#new-name')).toHaveValue('');
  expect(await page.evaluate(() => sessionStorage.getItem('tpoc-drafts:v1'))).toBe(null);
});

test('作成の結果を確認できない: 読み込み直した後も作成ボタンから二重に作らせない。同じ操作として確かめると 1 つだけ作られる', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await shortTimeouts(page, 2000);
  let mode = 'lost';
  await routeAppsScript(page, request);
  const seen = await interceptAction(page, request, 'createEvent', async ({ forward, pass }) => {
    if (mode === 'lost') return void (await forward()); // サーバーは作成するが、応答は届かない
    await pass();
  });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#new`);
  await googleLogin(page);
  await page.locator('#new-name').fill('二重に作らない大会');
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  const state = page.locator('#create-form .save-state');
  await expect(state).toHaveText('保存できたか確認できていません', { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'この内容で大会を作成' })).toBeDisabled();
  await page.reload();
  await expect(state).toHaveText('保存できたか確認できていません');
  await expect(page.locator('#new-name')).toHaveValue('二重に作らない大会');
  await expect(page.locator('#new-name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'この内容で大会を作成' })).toBeDisabled();
  const sentBefore = seen.length;
  mode = 'pass';
  await page.getByRole('button', { name: '同じ操作として確認する' }).click();
  await expect(page.getByRole('heading', { name: '二重に作らない大会' })).toBeVisible();
  expect(seen.length).toBe(sentBefore + 1);
  expect(new Set(seen.map((x) => x.requestId)).size).toBe(1);
  const auth = await loginSession(request, ORGANIZER);
  const boot = await adminCall(request, 'bootstrap', {}, auth);
  expect(boot.data.events.filter((e) => e.name === '二重に作らない大会').length).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('tpoc-drafts:v1'))).toBe(null);
});

test('別の人の下書きは出さない: ログアウトすると下書きを消し、別のアカウントでログインしても表示しない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await organizerHome(page, request);
  await openCreate(page);
  await page.locator('#new-name').fill('A さんの下書き');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tpoc-drafts:v1') || '')).toContain('A さんの下書き');
  await page.getByRole('button', { name: 'ログアウト' }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('tpoc-drafts:v1'))).toBe(null);
  // 別のアカウントでログイン
  await page.unroute('https://accounts.google.com/gsi/client');
  await fakeGoogle(page, request, 'other-organizer@example.org');
  await page.reload();
  await googleLogin(page);
  await expect(page.locator('#actor')).toContainText('other-organizer@example.org');
  await expect(page.locator('#new-name')).toHaveValue('');
});

test('ログインが切れたまま別のアカウントでログインした: 前の人の下書きは表示せず、端末からも消す', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await organizerHome(page, request);
  await openCreate(page);
  await page.locator('#new-name').fill('前の人の下書き');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tpoc-drafts:v1') || '')).toContain('前の人の下書き');
  // ログアウトの操作をせずにログインだけが消えた（期限切れ・別のタブでのログアウトに相当）
  await page.evaluate(() => localStorage.removeItem('tpoc-google'));
  await page.unroute('https://accounts.google.com/gsi/client');
  await fakeGoogle(page, request, 'other-organizer@example.org');
  await page.reload();
  await googleLogin(page);
  await expect(page.locator('#actor')).toContainText('other-organizer@example.org');
  await expect(page.locator('#new-name')).toHaveValue('');
  expect(await page.evaluate(() => sessionStorage.getItem('tpoc-drafts:v1') || '')).not.toContain('前の人の下書き');
});

test('保存はできたが閲覧ページへの反映に失敗: 「保存済み」と区別して欄に出し続け、再生成の導線へ行ける', async ({ page, request }) => {
  const { eventId, auth } = await openOwnEvent(page, request, {
    intercept: async (p) => {
      await interceptAction(p, request, 'updateEvent', async ({ forward, reply }) => {
        const res = JSON.parse(await forward()); // 保存は実際に行い、応答の公開の結果だけを失敗にする
        res.data.publication = { published: false, failed: true, message: '公開データを書き込めませんでした' };
        await reply(JSON.stringify(res));
      });
    },
  });
  await openSettings(page);
  await page.locator('#set-notes').fill('反映に失敗する保存');
  await page.getByRole('button', { name: '大会情報を保存' }).click();
  const state = page.locator('#settings-event .save-state');
  await expect(state).toContainText('保存済み。ただし閲覧ページへの反映に失敗しました');
  await expect(state).not.toHaveText('保存済み');
  await expect(page.locator('#draft-count')).toBeHidden(); // 入力は保存されている
  expect((await detailOf(request, eventId, auth)).event.notes).toBe('反映に失敗する保存');
  await openTab(page, '進行状況');
  await expect(page.getByRole('button', { name: '公開データを再生成' })).toBeVisible();
});
