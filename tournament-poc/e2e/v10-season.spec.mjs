// v1.0: 期制リーグを画面で通しで操作する（主催者の作成 → 1 期目 → 次期のプレビュー・修正・確定 → 入替戦 → 閲覧ページの前期・次期）
// と、50 人のリーグ（分割した公開データ）の閲覧ページでの表示の計測
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { reset, routeAppsScript, expectNoHorizontalOverflow, ADMIN_KEY, fakeGoogle, googleLogin, ORGANIZER, adminCall, loginSession } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';
let initSeq = 0;

async function start(page, request) {
  await reset(request, { configured: true });
  const seen = await routeAppsScript(page, request);
  await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'initializeStorage', payload: {}, requestId: `e2e-v10-init-${Date.now()}-${++initSeq}`, auth: { adminKey: ADMIN_KEY } }) });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  return seen;
}

function eventIdOf(page) {
  return page.url().match(/#e=(EVT-[A-Z0-9]+)/)[1];
}

/** 期の大会の全試合（リーグ）を API で確定する（名前の小さい方の勝ち）。画面は読み直す */
async function playLeague(request, eventId, stageIndex = 0, win = (m) => m.p1.name < m.p2.name) {
  for (let guard = 0; guard < 100; guard++) {
    const d = (await adminCall(request, 'eventDetail', { eventId })).data;
    const st = d.stages[stageIndex];
    const all = st.groups ? st.groups.flatMap((g) => g.matches) : st.pairs.map((x) => x.match).filter(Boolean);
    const open = all.filter((m) => m.status === 'scheduled' && m.p1.id && m.p2.id);
    if (!open.length) return;
    const res = await adminCall(request, 'saveMatchResults', { eventId, results: open.slice(0, 64).map((m) => (win(m) ? { matchId: m.id, rev: m.rev, p1Legs: 3, p2Legs: 1 } : { matchId: m.id, rev: m.rev, p1Legs: 1, p2Legs: 3 })) });
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
  }
}

async function publish(request, eventId) {
  const ev = (await adminCall(request, 'eventDetail', { eventId })).data.event;
  const res = await adminCall(request, 'updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
}

test('主催者: 期制リーグを作り、1 期目の順位から 2 期目の配置をプレビュー・修正・確定。2 期目の入替戦の後に 3 期目を作る。閲覧ページで前期・次期をたどれる', async ({ page, context, request }) => {
  const seen = await start(page, request);
  // 作成（境目は主催者が入力。6 人以上で 2 部制）
  const panel = page.locator('#season-create');
  await panel.getByRole('button', { name: '期制リーグの作成欄を開く' }).click();
  await panel.getByLabel('期制リーグの名前（各期は「名前 第n期」として作ります）').fill('水曜リーグ');
  await panel.getByLabel(/ディビジョン数の境目/).fill('6');
  await panel.getByRole('button', { name: '期制リーグを作成' }).click();
  await expect(page.locator('.event-head__title')).toHaveText('水曜リーグ 第1期');
  const e1 = eventIdOf(page);
  // 選手・組み合わせ
  await page.getByRole('button', { name: '選手', exact: true }).click();
  await page.getByPlaceholder('1 行に 1 名ずつ入力').fill(['選手1', '選手2', '選手3', '選手4', '選手5', '選手6', '選手7', '選手8'].join('\n'));
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('登録選手（8 名）')).toBeVisible();
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '登録選手を全員参加させる' }).click();
  await page.getByRole('button', { name: '対戦カードを作成' }).first().click();
  await expect(page.getByText('28 試合を作成しました。')).toBeVisible();
  await playLeague(request, e1);
  await page.reload();
  // 期・昇降格タブ: プレビュー（何位なので、どのディビジョンか）
  await page.getByRole('button', { name: '期・昇降格', exact: true }).click();
  await expect(page.getByText('期制リーグ「水曜リーグ」 第1期')).toBeVisible();
  await page.getByRole('button', { name: '次期の配置をプレビュー' }).click();
  const result = page.locator('#season-preview-result');
  await expect(result).toContainText('次期: 8 人・2 部制');
  const plan = page.locator('table.season-plan');
  await expect(plan.locator('tr', { hasText: '1期目 4位のため 1部（1〜4位が 1部）' })).toHaveCount(1);
  await expect(plan.locator('tr', { hasText: '1期目 5位のため 2部（5〜8位が 2部）' })).toHaveCount(1);
  // 手動で修正: 選手5 を 1 部へ（理由が空のうちは確定できない）→ 理由を入れて更新 → 人数の問題（1 部 5 人・2 部 3 人は可）
  const row5 = plan.locator('tbody tr', { hasText: '選手5' }).first();
  await row5.getByLabel('選手5 の次期の所属').selectOption('1');
  await page.getByRole('button', { name: 'プレビューを更新（修正を反映）' }).first().click();
  await expect(page.getByText('選手5 の手動の所属の理由を入力してください。')).toBeVisible();
  await expect(page.locator('#season-confirm')).toBeDisabled();
  await plan.locator('tbody tr', { hasText: '選手5' }).first().getByLabel('選手5 の手動の所属の理由').fill('本人の希望で入れ替え');
  // 人数をそろえるため 選手4 を 2 部へ
  await plan.locator('tbody tr', { hasText: '選手4' }).first().getByLabel('選手4 の次期の所属').selectOption('2');
  await plan.locator('tbody tr', { hasText: '選手4' }).first().getByLabel('選手4 の手動の所属の理由').fill('本人の希望で入れ替え');
  await page.getByRole('button', { name: 'プレビューを更新（修正を反映）' }).first().click();
  await expect(plan.locator('tbody tr', { hasText: '選手5' }).first()).toContainText('手動で 1部（本人の希望で入れ替え）');
  await expect(result).toContainText('1部: 4 人');
  await expect(page.locator('#season-confirm')).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('admin-preview.png'), fullPage: true });
  // 確定（確認のダイアログ）→ 第2期の大会が開く
  page.once('dialog', (dlg) => dlg.accept());
  await page.locator('#season-confirm').click();
  await expect(page.locator('.event-head__title')).toHaveText('水曜リーグ 第2期');
  const e2 = eventIdOf(page);
  expect(e2).not.toBe(e1);
  await page.getByRole('button', { name: '期・昇降格', exact: true }).click();
  await expect(page.getByText('この期の配置の根拠（第1期から確定）')).toBeVisible();
  await expect(page.locator('tr', { hasText: '選手5' }).first()).toContainText('手動で 1部');
  // 2 期目: 1 部 4 人・2 部 4 人 → 対戦カード → 結果 → 入替戦（1 部の下から 2 位 vs 2 部の 2 位）
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '全ディビジョンの対戦カードを作成' }).click();
  await playLeague(request, e2);
  await page.reload();
  await page.getByRole('button', { name: '期・昇降格', exact: true }).click();
  await page.getByRole('button', { name: '入替戦を組む' }).click();
  await expect(page.getByText('入替戦を 1 試合組みました。')).toBeVisible();
  // 入替戦の結果は「試合結果」タブで入力（下位の部の選手の勝ち）
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  await page.locator('.chips[aria-label="段階"] .chip', { hasText: '入替戦' }).click();
  const card = page.locator('.match-editor:not(.match-editor--final)').first();
  await card.locator('input').nth(0).fill('1');
  await card.locator('input').nth(1).fill('3');
  await card.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.match-editor:not(.match-editor--final)')).toHaveCount(0);
  await page.getByRole('button', { name: '期・昇降格', exact: true }).click();
  await page.getByRole('button', { name: '次期の配置をプレビュー' }).click();
  await expect(page.locator('table.season-plan')).toContainText('入替戦に勝って昇格');
  await expect(page.locator('table.season-plan')).toContainText('自動降格');
  page.once('dialog', (dlg) => dlg.accept());
  await page.locator('#season-confirm').click();
  await expect(page.locator('.event-head__title')).toHaveText('水曜リーグ 第3期');

  // 閲覧ページ（未ログイン・別のページ）: 1・2 期目を公開。2 期目の画面に期の一覧・昇降格の結果・入替戦
  await publish(request, e1);
  await publish(request, e2);
  const viewer = await context.newPage();
  await routeAppsScript(viewer, request, seen);
  await viewer.goto(`/pages/?event=${e2}`);
  const nav = viewer.locator('#season-nav');
  await expect(nav).toContainText('期制リーグ「水曜リーグ」 第2期');
  await expect(nav.getByRole('link', { name: '第1期' })).toBeVisible();
  await expect(nav).toContainText('第3期（非公開）');
  await expect(nav).toContainText('第3期の所属が確定しました');
  await expect(viewer.locator('.stage--promotion')).toContainText('1部・2部 入替戦');
  await expect(viewer.locator('.summary th', { hasText: '次期' }).first()).toBeVisible();
  await expect(viewer.locator('.summary td.zone', { hasText: '入替戦で昇格 → 1部' })).toHaveCount(1);
  await expect(viewer.locator('.summary td.zone', { hasText: '自動降格 → 2部' })).toHaveCount(1);
  if (test.info().project.name === 'mobile') await expectNoHorizontalOverflow(viewer);
  await viewer.screenshot({ path: test.info().outputPath('viewer-season2.png'), fullPage: true });
  // 前期へ移る
  await nav.getByRole('link', { name: '第1期' }).click();
  await expect(viewer.locator('#season-nav')).toContainText('第1期');
  await expect(viewer.locator('#event-title')).toHaveText('水曜リーグ 第1期');
  await expect(viewer.locator('#season-nav .season-nav__list').getByRole('link', { name: '第2期' })).toBeVisible();
  await expect(viewer.locator('#season-nav').getByRole('link', { name: '第2期を見る' })).toBeVisible();
  // 閲覧ページは Cookie を送らない（未ログインの閲覧）
  expect(seen.filter((x) => x.url.includes('PREVIEW/exec')).every((x) => !x.cookie)).toBe(true);
});

test('主催者: 次期を作った後に前期の結果を訂正すると、次期の画面に不整合を示し、反映・承認の操作で記録する', async ({ page, request }) => {
  await start(page, request);
  // 主催者（画面でログインしている人）の期制リーグ。結果の入力などの準備は管理者の鍵で行う
  const auth = await loginSession(request, ORGANIZER);
  const e1 = (await adminCall(request, 'createSeasonLeague', { name: '訂正リーグ', thresholds: [8], rule: { format: 'legs', bestOf: 5 } }, auth)).data.eventId;
  await adminCall(request, 'importPlayers', { eventId: e1, players: Array.from({ length: 8 }, (_, i) => ({ name: '選手0' + (i + 1) })) });
  let d = (await adminCall(request, 'eventDetail', { eventId: e1 })).data;
  await adminCall(request, 'autoAssign', { eventId: e1, stageId: d.stages[0].id });
  await adminCall(request, 'generateMatches', { eventId: e1, stageId: d.stages[0].id });
  await playLeague(request, e1);
  const pv = (await adminCall(request, 'previewNextSeason', { eventId: e1 })).data;
  const e2 = (await adminCall(request, 'confirmNextSeason', { eventId: e1, planVersion: pv.planVersion })).data.eventId;
  // 1 期目の 選手04 vs 選手05 を訂正（4 位と 5 位が入れ替わる）
  d = (await adminCall(request, 'eventDetail', { eventId: e1 })).data;
  const m = d.stages[0].groups[0].matches.find((x) => [x.p1.name, x.p2.name].sort().join() === '選手04,選手05');
  const p4First = m.p1.name === '選手04';
  await adminCall(request, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: p4First ? 0 : 3, p2Legs: p4First ? 3 : 0 });
  // 次期の所属の主催者の画面（期・昇降格）
  await page.goto(`${ADMIN_PAGE}#e=${e2}`);
  await page.getByRole('button', { name: '期・昇降格', exact: true }).click();
  const drift = page.locator('#season-drift');
  await expect(drift).toContainText('前期の結果が、この期を作った後に変わりました');
  await expect(drift.locator('tr', { hasText: '選手05' })).toContainText('2部');
  await drift.getByLabel('選手05 を反映する').check();
  await drift.getByLabel('選手04 を反映する').check();
  await drift.getByPlaceholder('理由（必須）').fill('1 期目の結果の訂正');
  await page.screenshot({ path: test.info().outputPath('admin-drift.png'), fullPage: true });
  await drift.getByRole('button', { name: 'チェックした選手の所属を反映' }).click();
  await expect(page.getByText('2 人の所属を反映しました。')).toBeVisible();
  await expect(page.locator('#season-drift')).toHaveCount(0);
  await expect(page.getByText(/照合 .*選手0[45] .*を反映（1 期目の結果の訂正）/)).toBeVisible();
});

test('閲覧ページ: 50 人の 2 回総当たり（2,450 試合・分割した公開データ）を読み込み、節を選んで表示する（表示の時間を計測）', async ({ page, request }) => {
  await reset(request, { configured: true });
  await routeAppsScript(page, request);
  await adminCall(request, 'initializeStorage');
  const id = (await adminCall(request, 'createSeasonLeague', { name: '50 人リーグ', cycles: 2, rule: { format: 'legs', bestOf: 5 } })).data.eventId;
  await adminCall(request, 'importPlayers', { eventId: id, players: Array.from({ length: 50 }, (_, i) => ({ name: '選手' + String(i + 1).padStart(3, '0') })) });
  const d = (await adminCall(request, 'eventDetail', { eventId: id })).data;
  await adminCall(request, 'autoAssign', { eventId: id, stageId: d.stages[0].id });
  await adminCall(request, 'generateMatches', { eventId: id, stageId: d.stages[0].id });
  // 前半の 1,225 試合だけ確定（進行中の大会を想定）
  const all = (await adminCall(request, 'eventDetail', { eventId: id })).data.stages[0].groups[0].matches;
  for (let i = 0; i < 1225; i += 64) {
    const res = await adminCall(request, 'saveMatchResults', { eventId: id, results: all.slice(i, Math.min(i + 64, 1225)).map((m) => (m.p1.name < m.p2.name ? { matchId: m.id, rev: m.rev, p1Legs: 3, p2Legs: 1 } : { matchId: m.id, rev: m.rev, p1Legs: 1, p2Legs: 3 })) });
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
  }
  await publish(request, id);
  const requests = [];
  page.on('request', (r) => {
    if (r.url().includes('PREVIEW/exec')) requests.push(new URL(r.url()).searchParams.get('part') || 'main');
  });
  const t0 = Date.now();
  await page.goto(`/pages/?event=${id}`);
  await expect(page.locator('.round-pick__select')).toBeVisible({ timeout: 30000 });
  const loadMs = Date.now() - t0;
  // 既定は未確定の試合がある最初の節（第50節。1 回目の総当たりは確定済み）
  await expect(page.locator('.round-pick__select')).toHaveValue('50');
  await expect(page.locator('.group .matches .match')).toHaveCount(25);
  await expect(page.locator('.summary tbody tr')).toHaveCount(50);
  const t1 = Date.now();
  await page.locator('.round-pick__select').selectOption('1');
  await expect(page.locator('.group .matches .match.match--final')).toHaveCount(25);
  const switchMs = Date.now() - t1;
  const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
  if (test.info().project.name === 'mobile') await expectNoHorizontalOverflow(page);
  // 手動更新: 本体が変わっていなければパートは取り直さない
  const before = requests.length;
  await page.waitForTimeout(5200);
  await page.getByRole('button', { name: '今すぐ更新' }).click();
  await expect(page.locator('#fetched-at')).not.toHaveText('—');
  await page.waitForTimeout(1500);
  const refetchedParts = requests.slice(before).filter((x) => x !== 'main').length;
  expect(refetchedParts).toBe(0);
  const metrics = { project: test.info().project.name, loadMs, switchMs, domNodes, firstLoadRequests: requests.slice(0, before), refetchedParts };
  console.log('# 閲覧ページ 50 人・2,450 試合: ' + JSON.stringify(metrics));
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/v10-viewer-${test.info().project.name}.json`, JSON.stringify(metrics, null, 2));
  await page.screenshot({ path: test.info().outputPath('viewer-50.png'), fullPage: false });
});
