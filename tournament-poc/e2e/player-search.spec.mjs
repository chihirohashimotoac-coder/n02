// 監査 PR-16（W-003・C-049）: 閲覧ページの「選手を探す」と更新の強調を、形式によらず試合 ID・選手 ID で行う。
// - 試合を集める範囲: groups・rounds（従来）に、ダブルエリミの sides・ポイントシリーズの nights・入替戦の pairs を足す。同じ試合は 1 回だけ
// - 順位表の行の強調: 名前の文字列（所属を出すと一致しない）ではなく、行の選手 ID で一致させる
import { test, expect } from '@playwright/test';
import { reset, adminCall, routeAppsScript, expectNoHorizontalOverflow } from './helpers.mjs';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

function ok(res) {
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  return res.data;
}

async function detail(request, eventId) {
  return ok(await adminCall(request, 'eventDetail', { eventId }));
}

function allMatches(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  if (st.nights) return st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches));
  return (st.rounds || []).flatMap((r) => r.matches);
}

/** 入力できる試合を、名前の番号の小さい方の勝ち（2-0）で limit 試合だけ確定する */
async function play(request, eventId, stageId, limit = 999) {
  for (let i = 0; i < limit; i++) {
    const st = (await detail(request, eventId)).stages.find((s) => s.id === stageId);
    const m = allMatches(st).find((x) => (x.status === 'scheduled' || x.status === 'live') && x.p1.id && x.p2.id);
    if (!m) return;
    const p1wins = m.p1.name < m.p2.name;
    ok(await adminCall(request, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1wins ? 2 : 0, p2Legs: p1wins ? 0 : 2 }));
  }
}

async function makeEvent(request, payload, names) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const id = ok(await adminCall(request, 'createEvent', { rule: { format: 'legs', bestOf: 3 }, ...payload })).eventId;
  ok(await adminCall(request, 'addPlayers', { eventId: id, names }));
  return id;
}

async function publish(request, eventId) {
  const ev = (await detail(request, eventId)).event;
  ok(await adminCall(request, 'updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel || '', notes: ev.notes || '', status: ev.status, isPublic: true, isFeatured: false }));
}

async function openViewer(page, request, eventId) {
  await routeAppsScript(page, request);
  await page.goto(`/pages/index.html?event=${eventId}`);
  await expect(page.locator('#player-search')).toBeVisible();
}

async function pick(page, text, meta) {
  const q = page.getByRole('combobox', { name: '選手を探す' });
  await q.fill(text);
  const option = page.getByRole('option').filter({ hasText: text });
  await expect(option).toHaveCount(1);
  if (meta) await expect(option).toContainText(meta);
  await option.click();
}

const names4 = ['選手1', '選手2', '選手3', '選手4'];

test('ダブルエリミ: 勝者側・敗者側・グランドファイナルの試合を数え、強調する', async ({ page, request }) => {
  const id = await makeEvent(request, { name: 'DE 検索', template: 'double_elimination', grandFinal: 'single' }, names4);
  let d = await detail(request, id);
  const sid = d.stages[0].id;
  ok(await adminCall(request, 'setEntrants', { eventId: id, stageId: sid, playerIds: d.players.map((x) => x.id) }));
  ok(await adminCall(request, 'generateBracket', { eventId: id, stageId: sid }));
  await play(request, id, sid);
  await publish(request, id);
  d = await detail(request, id);
  const pid = d.players.find((x) => x.name === '選手2').id;
  const mine = allMatches(d.stages[0]).filter((m) => m.p1.id === pid || m.p2.id === pid);
  expect(mine.length).toBeGreaterThanOrEqual(2);
  expect(new Set(mine.map((m) => m.side)).size).toBeGreaterThanOrEqual(2); // 勝者側と敗者側（またはグランドファイナル）
  await openViewer(page, request, id);
  await pick(page, '選手2', `${mine.length} 試合`);
  await expect(page.locator('[data-match-id].is-focus')).toHaveCount(mine.length);
  for (const m of mine) await expect(page.locator(`[data-match-id="${m.id}"]`)).toHaveClass(/is-focus/);
  await expectNoHorizontalOverflow(page);
});

test('ポイントシリーズ: 各節の試合を数えて強調し、累計順位の行を選手 ID で強調する', async ({ page, request }) => {
  const id = await makeEvent(request, { name: 'シリーズ検索', template: 'series_playoff', nights: 2, playoff: 2 }, names4);
  let d = await detail(request, id);
  const st = d.stages[0];
  ok(await adminCall(request, 'updateStage', { stageId: st.id, rev: st.rev, nightDraw: 'seed' }));
  ok(await adminCall(request, 'autoAssign', { eventId: id, stageId: st.id }));
  for (const night of st.nights) {
    ok(await adminCall(request, 'generateNight', { eventId: id, groupId: night.id }));
    await play(request, id, st.id);
  }
  await publish(request, id);
  d = await detail(request, id);
  const pid = d.players.find((x) => x.name === '選手3').id;
  const mine = allMatches(d.stages[0]).filter((m) => m.p1.id === pid || m.p2.id === pid);
  expect(mine.length).toBe(2); // 各節の準決勝で負ける
  await openViewer(page, request, id);
  await pick(page, '選手3', '2 試合');
  await expect(page.locator('[data-match-id].is-focus')).toHaveCount(2);
  await expect(page.locator('.series-table tbody tr.is-focus')).toHaveCount(1);
  await expect(page.locator(`.series-table tbody tr[data-player-id="${pid}"]`)).toHaveClass(/is-focus/);
});

test('所属を公開したロビン: 候補に所属を出し、順位表の行（名前と所属のセル）を選手 ID で強調する', async ({ page, request }) => {
  const id = await makeEvent(request, { name: '所属つき', template: 'robin', groupCount: 1 }, names4);
  let d = await detail(request, id);
  for (const [i, pl] of d.players.entries()) {
    ok(await adminCall(request, 'updatePlayer', { playerId: pl.id, rev: pl.rev, affiliation: i % 2 ? 'B クラブ' : 'A クラブ' }));
  }
  d = await detail(request, id);
  ok(await adminCall(request, 'updateEventSettings', { eventId: id, rev: d.event.rev, publicFields: { affiliation: true, rating: false } }));
  const sid = d.stages[0].id;
  ok(await adminCall(request, 'autoAssign', { eventId: id, stageId: sid }));
  ok(await adminCall(request, 'generateMatches', { eventId: id, stageId: sid }));
  await play(request, id, sid, 2);
  await publish(request, id);
  d = await detail(request, id);
  const pid = d.players.find((x) => x.name === '選手1').id;
  await openViewer(page, request, id);
  await expect(page.locator('.summary__aff').first()).toBeVisible();
  await pick(page, '選手1', 'A クラブ');
  await expect(page.locator('.match.is-focus')).toHaveCount(3);
  await expect(page.locator('.summary tbody tr.is-focus')).toHaveCount(1);
  await expect(page.locator(`.summary tbody tr[data-player-id="${pid}"]`)).toHaveClass(/is-focus/);
});

test('試合の集め方（純粋な関数）: 入替戦の pairs を含め、同じ ID の試合は 1 回だけ。不戦（相手なし）でも止まらない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await routeAppsScript(page, request);
  await page.goto('/pages/index.html');
  const out = await page.evaluate(() => {
    const m = (id, a, b) => ({ id, p1: { id: a, name: a }, p2: b ? { id: b, name: b } : { id: null, name: '' } });
    const data = {
      stages: [
        { id: 'S1', groups: [{ matches: [m('G1', 'A', 'B')] }] },
        { id: 'S2', rounds: [{ matches: [m('R1', 'A', 'C'), m('G1', 'A', 'B')] }] },
        { id: 'S3', sides: [{ rounds: [{ matches: [m('W1', 'A', 'D')] }] }, { rounds: [{ matches: [m('L1', 'A', 'E')] }] }] },
        { id: 'S4', nights: [{ rounds: [{ matches: [m('N1', 'A', 'F'), m('N2', 'A', null)] }] }] },
        { id: 'S5', pairs: [{ players: [{ id: 'A', name: 'A' }, { id: 'G', name: 'G' }], match: m('P1', 'A', 'G') }, { players: [], match: null }] },
      ],
    };
    const VP = window.TPViewerPlus;
    return { ids: VP.matches(data).map((x) => x.id), players: VP.players(data).map((p) => p.id) };
  });
  expect(out.ids).toEqual(['G1', 'R1', 'W1', 'L1', 'N1', 'N2', 'P1']);
  expect(out.players).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
  expect(out.players).toHaveLength(7);
});
