// 監査 PR-11（C-013）: 進出を確定した後に、順位・回戦を変える段階の設定（不戦勝の Leg 数・節の順位ポイント・
// 節の数・スイス式の回戦数）を変えられないようにする。進出を取り消した後は変えられる。
// 運営画面は保存のたびに全項目を送るので、今と同じ値は通す（名前などの保存を止めない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

function names(n, prefix = '選手') {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
}

function allMatches(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  if (st.nights) return st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches));
  return (st.rounds || []).flatMap((r) => r.matches);
}

/** 名前の番号が小さい方が勝つ（2-0。同点の並びを作らない） */
function playStage(p, eventId, stageId) {
  for (let n = 0; n < 500; n++) {
    const d = p.ok('eventDetail', { eventId });
    const st = d.stages.find((s) => s.id === stageId);
    const m = allMatches(st).find((x) => x.status === 'scheduled' || x.status === 'live');
    if (!m) return;
    const p1wins = m.p1.name < m.p2.name;
    p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1wins ? 2 : 0, p2Legs: p1wins ? 0 : 2 });
  }
  throw new Error('終わらない');
}

const stageOf = (p, id, sid) => p.ok('eventDetail', { eventId: id }).stages.find((s) => s.id === sid);

/** 運営画面の「この段階を保存」と同じく、今の設定の全項目を送る */
function formPayload(st, extra) {
  const c = st.config;
  const base = { stageId: st.id, rev: st.rev, name: st.name };
  if (st.type === 'round_robin' || st.type === 'league' || st.type === 'swiss') base.walkoverLegs = c.walkoverLegs;
  if (st.type === 'swiss') Object.assign(base, { rounds: c.rounds, firstRound: c.firstRound, byePoints: c.byePoints });
  if (st.type === 'series') Object.assign(base, { walkoverLegs: c.walkoverLegs, nights: c.nights, nightPoints: c.nightPoints.slice(), nightDraw: c.nightDraw });
  return Object.assign(base, extra || {});
}

function robinAdvanced() {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'ロビン', template: 'robin_ko', groupCount: 1, advanceCount: 2, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(4) });
  const st = p.ok('eventDetail', { eventId: id }).stages[0];
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  p.ok('generateMatches', { eventId: id, stageId: st.id });
  playStage(p, id, st.id);
  p.ok('confirmAdvancement', { eventId: id, stageId: st.id });
  return { p, id, sid: st.id };
}

test('ロビン: 進出確定後は不戦勝の Leg 数の扱いを変えられない（同じ値の保存は通る・拒否しても設定と rev は変わらない）', () => {
  const { p, id, sid } = robinAdvanced();
  let st = stageOf(p, id, sid);
  assert.equal(st.config.advanced, true);
  assert.equal(st.config.walkoverLegs, 'exclude');
  const res = p.call('updateStage', { stageId: sid, rev: st.rev, walkoverLegs: 'award' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'LOCKED');
  assert.match(res.error.message, /進出確定後/);
  const after = stageOf(p, id, sid);
  assert.equal(after.rev, st.rev);
  assert.equal(after.config.walkoverLegs, 'exclude');
  // 画面の保存（全項目を今の値で送る）は通る。名前は変わる
  p.ok('updateStage', formPayload(st, { name: '予選（改）' }));
  st = stageOf(p, id, sid);
  assert.equal(st.name, '予選（改）');
  assert.equal(st.config.walkoverLegs, 'exclude');
});

test('ロビン: 進出を取り消した後は不戦勝の Leg 数の扱いを変えられる', () => {
  const { p, id, sid } = robinAdvanced();
  p.ok('undoAdvancement', { eventId: id, stageId: sid });
  const st = stageOf(p, id, sid);
  assert.equal(st.config.advanced, false);
  p.ok('updateStage', { stageId: sid, rev: st.rev, walkoverLegs: 'award' });
  assert.equal(stageOf(p, id, sid).config.walkoverLegs, 'award');
});

function seriesAdvanced() {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'シリーズ', template: 'series_playoff', nights: 2, playoff: 2, nightPoints: [5, 3, 2, 0], rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(4) });
  let st = p.ok('eventDetail', { eventId: id }).stages[0];
  // 節の組み合わせを参加者名簿の順にする（抽選だと 2 位が同点になり、進出を確定できないことがある）
  p.ok('updateStage', { stageId: st.id, rev: st.rev, nightDraw: 'seed' });
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  for (const night of st.nights) {
    p.ok('generateNight', { eventId: id, groupId: night.id });
    playStage(p, id, st.id);
  }
  st = stageOf(p, id, st.id);
  assert.equal(st.complete, true);
  p.ok('confirmAdvancement', { eventId: id, stageId: st.id });
  return { p, id, sid: st.id };
}

test('シリーズ: 進出確定後は節の順位ポイント・節の数・不戦勝の Leg 数を変えられない。同じ値の保存と節の組み方は通る', () => {
  const { p, id, sid } = seriesAdvanced();
  const st = stageOf(p, id, sid);
  assert.equal(st.config.advanced, true);
  const groupsBefore = st.nights.length;
  const standingsBefore = JSON.stringify(st.standings);
  for (const change of [{ nightPoints: [10, 6, 4, 0] }, { nights: 3 }, { nights: 1 }, { walkoverLegs: 'award' }]) {
    const res = p.call('updateStage', { stageId: sid, rev: st.rev, ...change });
    assert.equal(res.ok, false, JSON.stringify(change));
    assert.equal(res.error.code, 'LOCKED', JSON.stringify(change));
  }
  const after = stageOf(p, id, sid);
  assert.equal(after.rev, st.rev);
  assert.equal(after.nights.length, groupsBefore, '節を足していない');
  assert.deepEqual(after.config.nightPoints, [5, 3, 2, 0]);
  assert.equal(JSON.stringify(after.standings), standingsBefore, '順位は変わらない');
  // 全項目を今の値で送る保存と、節の組み方（以後の節を組むときだけに効く）の変更は通る
  p.ok('updateStage', formPayload(st, { nightDraw: 'standing' }));
  assert.equal(stageOf(p, id, sid).config.nightDraw, 'standing');
});

test('シリーズ: 進出を取り消した後は節の順位ポイント・節の数を変えられる', () => {
  const { p, id, sid } = seriesAdvanced();
  p.ok('undoAdvancement', { eventId: id, stageId: sid });
  let st = stageOf(p, id, sid);
  p.ok('updateStage', { stageId: sid, rev: st.rev, nightPoints: [10, 6, 4, 0], nights: 3 });
  st = stageOf(p, id, sid);
  assert.deepEqual(st.config.nightPoints, [10, 6, 4, 0]);
  assert.equal(st.nights.length, 3);
});

function swissAdvanced() {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'スイス', template: 'swiss', swissRounds: 2, playoff: 4, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(4) });
  const st = p.ok('eventDetail', { eventId: id }).stages[0];
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  for (let r = 0; r < 2; r++) {
    p.ok('generateSwissRound', { eventId: id, stageId: st.id });
    playStage(p, id, st.id);
  }
  const done = stageOf(p, id, st.id);
  // 2 位・3 位が同点なら手で並べる（進出確定の前提）
  const res = p.call('confirmAdvancement', { eventId: id, stageId: st.id });
  if (!res.ok) {
    const g = done.groups[0];
    p.ok('setManualOrder', { eventId: id, groupId: g.id, rev: g.rev, order: g.standings.map((r) => r.playerId) });
    p.ok('confirmAdvancement', { eventId: id, stageId: st.id });
  }
  return { p, id, sid: st.id };
}

test('スイス式: 進出確定後は回戦数と不戦勝の Leg 数を変えられない。同じ値の保存は通る。取り消し後は回戦数を増やせる', () => {
  const { p, id, sid } = swissAdvanced();
  let st = stageOf(p, id, sid);
  assert.equal(st.config.advanced, true);
  assert.equal(st.complete, true);
  for (const change of [{ rounds: 3 }, { walkoverLegs: 'award' }]) {
    const res = p.call('updateStage', { stageId: sid, rev: st.rev, ...change });
    assert.equal(res.ok, false, JSON.stringify(change));
    assert.equal(res.error.code, 'LOCKED', JSON.stringify(change));
  }
  st = stageOf(p, id, sid);
  assert.equal(st.config.rounds, 2);
  assert.equal(st.complete, true, '段階は終わったまま');
  p.ok('updateStage', formPayload(st, { name: 'スイス（改）' }));
  p.ok('undoAdvancement', { eventId: id, stageId: sid });
  st = stageOf(p, id, sid);
  p.ok('updateStage', { stageId: sid, rev: st.rev, rounds: 3 });
  assert.equal(stageOf(p, id, sid).config.rounds, 3);
});

test('進出を確定していない段階は、従来どおり不戦勝の Leg 数・節の順位ポイントを変えられる', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'シリーズ', template: 'series_playoff', nights: 2, playoff: 2, rule: { format: 'legs', bestOf: 3 } }).eventId;
  let st = p.ok('eventDetail', { eventId: id }).stages[0];
  p.ok('updateStage', { stageId: st.id, rev: st.rev, nightPoints: [7, 4, 2, 0], walkoverLegs: 'award', nights: 3 });
  st = stageOf(p, id, st.id);
  assert.deepEqual(st.config.nightPoints, [7, 4, 2, 0]);
  assert.equal(st.config.walkoverLegs, 'award');
  assert.equal(st.nights.length, 3);
});

test('スイス式: 1 回戦を組んだ後も、画面の保存（1 回戦の組み方・不戦の点を今の値で送る）は通る。値を変えると従来どおり拒否', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'スイス', template: 'swiss', swissRounds: 3, playoff: 0, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(5) });
  let st = p.ok('eventDetail', { eventId: id }).stages[0];
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  p.ok('generateSwissRound', { eventId: id, stageId: st.id });
  st = stageOf(p, id, st.id);
  p.ok('updateStage', formPayload(st, { name: 'スイス（改）', rounds: 4 }));
  st = stageOf(p, id, st.id);
  assert.equal(st.name, 'スイス（改）');
  assert.equal(st.config.rounds, 4);
  for (const change of [{ firstRound: 'random' }, { byePoints: st.config.byePoints + 1 }]) {
    const res = p.call('updateStage', { stageId: st.id, rev: st.rev, ...change });
    assert.equal(res.ok, false, JSON.stringify(change));
    assert.equal(res.error.code, 'LOCKED', JSON.stringify(change));
  }
});
