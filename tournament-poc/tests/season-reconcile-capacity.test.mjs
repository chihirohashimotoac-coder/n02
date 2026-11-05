// 監査 PR-10（C-025・C-026）: 次期を作った後の照合で、前期の訂正を一部の選手だけ反映する（部分反映）ときも、
// 次期の確定と同じく「設定した定員」を検査する（利用者の決定: 定員が空欄の部は上限なし）。
// - 4 人の部（定員 4）を 5 人にする単独の移動は拒否し、行・ログ・期の版は変えない
// - 同時の入れ替え（出る人と入る人を一緒に反映）と、定員に空きがある部への移動（欠員の補充）は通る
// - 定員は確定したときの設定で数える（監査 PR-09 と同じ。確定の後に定員を変えても、照合の検査は変わらない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const people = (n) => Array.from({ length: n }, (_, i) => ({ name: '選手' + String(i + 1).padStart(2, '0') }));

function playAll(p, id) {
  for (let guard = 0; guard < 50; guard++) {
    const st = p.ok('eventDetail', { eventId: id }).stages[0];
    const open = st.groups.flatMap((g) => g.matches).filter((m) => m.status === 'scheduled' && m.p1.id && m.p2.id);
    if (!open.length) return;
    p.ok('saveMatchResults', {
      eventId: id,
      results: open.slice(0, 60).map((m) => {
        const need = Math.floor(m.bestOf / 2) + 1;
        return m.p1.name < m.p2.name ? { matchId: m.id, rev: m.rev, p1Legs: need, p2Legs: need - 1 } : { matchId: m.id, rev: m.rev, p1Legs: need - 1, p2Legs: need };
      }),
    });
  }
  throw new Error('終わらない');
}

/** 8 人・境目 8 人で 2 部制の 2 期目を作る（1 部 4 人・2 部 4 人）。capacities = 期制リーグの定員 */
function world(capacities) {
  const p = setupPair();
  p.ok('initializeStorage');
  const id1 = p.ok('createSeasonLeague', { name: '定員リーグ', thresholds: [8], capacities, cycles: 1, rule: { format: 'legs', bestOf: 5 } }).eventId;
  p.ok('importPlayers', { eventId: id1, players: people(8) });
  const d = p.ok('eventDetail', { eventId: id1 });
  p.ok('autoAssign', { eventId: id1, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: id1, stageId: d.stages[0].id });
  playAll(p, id1);
  const pv = p.ok('previewNextSeason', { eventId: id1, edits: {} });
  assert.deepEqual(pv.divisions.map((x) => x.size), [4, 4]);
  const id2 = p.ok('confirmNextSeason', { eventId: id1, edits: {}, planVersion: pv.planVersion }).eventId;
  return { p, id1, id2 };
}

/** 1 期目の 選手04 vs 選手05 を訂正して 4 位と 5 位（1 部と 2 部の境目）を入れ替える → 違いは 選手04: 1→2・選手05: 2→1 */
function correctBorder(w) {
  const d1 = w.p.ok('eventDetail', { eventId: w.id1 });
  const m = d1.stages[0].groups[0].matches.find((x) => [x.p1.name, x.p2.name].sort().join() === '選手04,選手05');
  const p4First = m.p1.name === '選手04';
  w.p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: p4First ? 0 : 3, p2Legs: p4First ? 3 : 0 });
  const dr = w.p.ok('eventDetail', { eventId: w.id2 }).season.drift;
  assert.deepEqual(dr.diffs.map((x) => x.name + ':' + x.confirmed + '→' + x.now).sort(), ['選手04:1→2', '選手05:2→1']);
  assert.ok(dr.diffs.every((x) => x.canApply), JSON.stringify(dr.diffs.map((x) => x.lock)));
  return dr;
}

const keyOf = (dr, name) => dr.diffs.find((x) => x.name === name).key;

/** 次期の各部の人数（部の順） */
function sizes(w) {
  return w.p.ok('eventDetail', { eventId: w.id2 }).stages[0].groups.map((g) => g.players.length);
}

/** 書き込みの有無を比べるためのシートの中身 */
function sheets(w) {
  const ss = w.p.store.get();
  return ['Entries', 'LeagueSeasons', 'History'].map((n) => JSON.stringify(ss.getSheetByName(n).rows));
}

function reconcile(w, apply, reason = '1 期目の訂正') {
  const d2 = w.p.ok('eventDetail', { eventId: w.id2 });
  return w.p.call('reconcileNextSeason', { eventId: w.id2, rev: d2.season.seasonRev, apply, reason });
}

test('定員 4 の 1 部を 5 人にする単独の反映は VALIDATION で拒否し、所属・期の記録（ログ・版）・履歴を変えない', () => {
  const w = world([4, 4]);
  const dr = correctBorder(w);
  const before = sheets(w);
  const res = reconcile(w, [keyOf(dr, '選手05')]);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'VALIDATION');
  assert.match(res.error.message, /1部.*5 人.*定員（4 人）/);
  assert.deepEqual(sheets(w), before, '拒否したときは何も書き込まない');
  assert.deepEqual(sizes(w), [4, 4]);
  assert.deepEqual(w.p.ok('eventDetail', { eventId: w.id2 }).season.drift.log, []);
});

test('同時の入れ替え（出る 選手04 と入る 選手05 を一緒に反映）は定員 4 のまま通る', () => {
  const w = world([4, 4]);
  const dr = correctBorder(w);
  const res = reconcile(w, [keyOf(dr, '選手04'), keyOf(dr, '選手05')]);
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.equal(res.data.applied, 2);
  assert.deepEqual(sizes(w), [4, 4]);
  assert.equal(w.p.ok('eventDetail', { eventId: w.id2 }).season.drift.changed, false);
});

test('出る人だけの単独の反映（1 部 4 → 3 人・2 部 4 → 5 人）は、2 部の定員を超えるので拒否。2 部の定員が空欄なら通る', () => {
  const w = world([4, 4]);
  const dr = correctBorder(w);
  const res = reconcile(w, [keyOf(dr, '選手04')]);
  assert.equal(res.ok, false);
  assert.match(res.error.message, /2部.*5 人.*定員（4 人）/);
  const w2 = world([4]);
  const dr2 = correctBorder(w2);
  const ok = reconcile(w2, [keyOf(dr2, '選手04')]);
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.deepEqual(sizes(w2), [3, 5]);
});

test('定員に空きがある部への単独の反映（欠員の補充: 定員 5 の 1 部が 4 人）は通る', () => {
  const w = world([5, 5]);
  const dr = correctBorder(w);
  const res = reconcile(w, [keyOf(dr, '選手05')]);
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.deepEqual(sizes(w), [5, 3]);
  const log = w.p.ok('eventDetail', { eventId: w.id2 }).season.drift.log;
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].applied.map((a) => a.name), ['選手05']);
});

test('定員が空欄なら、単独の反映で 4 人の部が 5 人になっても通る（次期の確定と同じ規則）', () => {
  const w = world(undefined);
  const dr = correctBorder(w);
  const res = reconcile(w, [keyOf(dr, '選手05')]);
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.deepEqual(sizes(w), [5, 3]);
});

test('定員は確定したときの設定で数える: 確定の後に定員を 4 にしても空欄のときと同じく通り、定員 4 で確定した後に 6 にしても拒否する', () => {
  const change = (w, capacities) => {
    w.p.clock.advance(60 * 1000);
    const league = w.p.ok('eventDetail', { eventId: w.id2 }).season.league;
    w.p.ok('updateLeagueSettings', { eventId: w.id2, rev: league.rev, capacities });
  };
  const w = world(undefined);
  change(w, [4, 4]);
  const dr = correctBorder(w);
  assert.equal(reconcile(w, [keyOf(dr, '選手05')]).ok, true);
  const w2 = world([4, 4]);
  change(w2, [6, 6]);
  const dr2 = correctBorder(w2);
  const res = reconcile(w2, [keyOf(dr2, '選手05')]);
  assert.equal(res.ok, false);
  assert.match(res.error.message, /定員（4 人）/);
});

test('確定の後に手で選手を足して定員を超えた部（1 部 5 人・定員 4）でも、その部の入れ替えは止めない。その部の人数が増える反映は拒否', () => {
  const w = world([4, 4]);
  const added = w.p.ok('addPlayers', { eventId: w.id2, names: ['追加の選手'] });
  const d2 = w.p.ok('eventDetail', { eventId: w.id2 });
  const pid = (added.players || d2.players).find((x) => x.name === '追加の選手').id;
  w.p.ok('assignPlayer', { eventId: w.id2, playerId: pid, groupId: d2.stages[0].groups[0].id });
  assert.deepEqual(sizes(w), [5, 4]);
  const dr = correctBorder(w);
  const grow = reconcile(w, [keyOf(dr, '選手05')]);
  assert.equal(grow.ok, false, '1 部を 6 人にする反映は拒否');
  assert.match(grow.error.message, /1部.*6 人.*定員（4 人）/);
  const swap = reconcile(w, [keyOf(dr, '選手04'), keyOf(dr, '選手05')]);
  assert.equal(swap.ok, true, JSON.stringify(swap.error));
  assert.deepEqual(sizes(w), [5, 4], '入れ替えは人数を変えない');
});
