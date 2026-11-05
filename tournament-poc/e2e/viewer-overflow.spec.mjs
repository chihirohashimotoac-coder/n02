// 閲覧ページの横のはみ出し（監査外の不具合）: 段階の入れ物（.stage）の grid の列が中身の最小幅まで広がり、
// ダブルエリミの表・ポイントシリーズの節の列でページ全体が横にはみ出していた（8 人のダブルエリミで 852px）。
// スマートフォンではページ全体が縮小表示になる。表が収まらないときは、表の中だけが横にスクロールすること
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
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  if (st.nights) return st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches));
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  return (st.rounds || []).flatMap((r) => r.matches);
}

/** 入力できる試合を、名前の番号の小さい方の勝ち（2-0）ですべて確定する */
async function play(request, eventId, stageId) {
  for (let i = 0; i < 200; i++) {
    const st = (await detail(request, eventId)).stages.find((s) => s.id === stageId);
    const m = allMatches(st).find((x) => (x.status === 'scheduled' || x.status === 'live') && x.p1.id && x.p2.id);
    if (!m) return;
    const p1wins = m.p1.name < m.p2.name;
    ok(await adminCall(request, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1wins ? 2 : 0, p2Legs: p1wins ? 0 : 2 }));
  }
}

async function makeEvent(request, payload, count) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const id = ok(await adminCall(request, 'createEvent', { rule: { format: 'legs', bestOf: 3 }, ...payload })).eventId;
  const names = Array.from({ length: count }, (_, i) => `選手${String(i + 1).padStart(2, '0')}`);
  ok(await adminCall(request, 'addPlayers', { eventId: id, names }));
  return id;
}

async function publish(request, eventId) {
  const ev = (await detail(request, eventId)).event;
  ok(await adminCall(request, 'updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel || '', notes: ev.notes || '', status: ev.status, isPublic: true, isFeatured: false }));
}

/** 幅 390px で開く（desktop は PC のブラウザの窓を狭めた状態、mobile はスマートフォン） */
async function openNarrow(page, request, eventId) {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeAppsScript(page, request);
  await page.goto(`/pages/index.html?event=${eventId}`);
}

/** ページは画面幅に収まる。selector を渡すと、狭い画面ではその表の中が横にスクロールすること（表を縮めて隠していない）も確かめる */
async function expectFits(page, selector = '') {
  await expectNoHorizontalOverflow(page);
  const width = page.viewportSize().width;
  const stage = await page.locator('.stage').first().evaluate((el) => el.getBoundingClientRect().right);
  expect(stage).toBeLessThanOrEqual(width);
  if (selector) {
    const scrollers = page.locator(selector);
    const inner = await scrollers.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(inner).toBeGreaterThan(0);
  }
}

test('ダブルエリミ（8 人・グランドファイナル 2 回）: ページは画面幅に収まり、表の中だけが横にスクロールする', async ({ page, request }) => {
  const id = await makeEvent(request, { name: 'DE はみ出し', template: 'double_elimination', grandFinal: 'double' }, 8);
  const d = await detail(request, id);
  const sid = d.stages[0].id;
  ok(await adminCall(request, 'setEntrants', { eventId: id, stageId: sid, playerIds: d.players.map((x) => x.id) }));
  ok(await adminCall(request, 'generateBracket', { eventId: id, stageId: sid }));
  await play(request, id, sid);
  await publish(request, id);
  await openNarrow(page, request, id);
  await expect(page.locator('.de')).toBeVisible();
  await expectFits(page, '.de .bracket__scroll, .de .round-columns');
});

test('ポイントシリーズ: 節の列でページがはみ出さない', async ({ page, request }) => {
  const id = await makeEvent(request, { name: 'シリーズはみ出し', template: 'series_playoff', nights: 2, playoff: 2 }, 6);
  const st = (await detail(request, id)).stages[0];
  ok(await adminCall(request, 'updateStage', { stageId: st.id, rev: st.rev, nightDraw: 'seed' }));
  ok(await adminCall(request, 'autoAssign', { eventId: id, stageId: st.id }));
  for (const night of st.nights) {
    ok(await adminCall(request, 'generateNight', { eventId: id, groupId: night.id }));
    await play(request, id, st.id);
  }
  await publish(request, id);
  await openNarrow(page, request, id);
  await expect(page.locator('.night').first()).toBeVisible();
  await expectFits(page);
});
