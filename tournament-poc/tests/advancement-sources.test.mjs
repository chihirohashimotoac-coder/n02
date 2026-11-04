// 監査 PR-02（C-010）: 複数の段階（予選 A・予選 B）から同じ進出先（決勝）へ進出するとき、
// 一方の確定・取り消しで、他方の進出者や直接出場の選手を消さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

function names(n, prefix) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

/** 予選 A（4 人）・予選 B（4 人）→ 決勝（直接出場 D）。各予選の 1〜2 位が決勝へ */
function build({ targetType = 'single_elimination', direct = true, toRank = 2, dupA1 = false } = {}) {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: '複数予選', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  const b = p.ok('addStage', { eventId: id, type: 'round_robin', name: '予選B' }).stageId;
  const fin = p.ok('addStage', { eventId: id, type: targetType, name: '決勝' }).stageId;
  p.ok('addPlayers', { eventId: id, names: [...names(4, 'A'), ...names(4, 'B'), 'D'] });
  let d = p.ok('eventDetail', { eventId: id });
  const a = d.stages[0].id;
  const pid = Object.fromEntries(d.players.map((x) => [x.name, x.id]));
  names(4, 'A').forEach((n) => p.ok('assignPlayer', { eventId: id, stageId: a, playerId: pid[n], groupId: d.stages[0].groups[0].id }));
  names(4, 'B').forEach((n) => p.ok('assignPlayer', { eventId: id, stageId: b, playerId: pid[n], groupId: d.stages[1].groups[0].id }));
  // 運用上の誤り: A1 を予選 B にも入れる（B でも 1 位になる）
  if (dupA1) p.ok('assignPlayer', { eventId: id, stageId: b, playerId: pid.A1, groupId: d.stages[1].groups[0].id });
  if (direct && targetType === 'single_elimination') p.ok('setEntrants', { eventId: id, stageId: fin, entrants: [{ playerId: pid.D, direct: true }] });
  d = p.ok('eventDetail', { eventId: id });
  p.ok('updateStage', { stageId: a, rev: d.stages[0].rev, advancement: [{ fromRank: 1, toRank, targetStageId: fin }] });
  p.ok('updateStage', { stageId: b, rev: d.stages[1].rev, advancement: [{ fromRank: 1, toRank, targetStageId: fin }] });
  for (const st of [a, b]) {
    p.ok('generateMatches', { eventId: id, stageId: st });
    // 名前の番号が小さい方が勝つ → A1・A2 / B1・B2 が上位
    for (;;) {
      const dd = p.ok('eventDetail', { eventId: id });
      const m = dd.stages.find((s) => s.id === st).groups.flatMap((g) => g.matches).find((x) => x.status === 'scheduled');
      if (!m) break;
      const p1wins = m.p1.name < m.p2.name;
      p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1wins ? 2 : 0, p2Legs: p1wins ? 0 : 2 });
    }
  }
  const finalEntries = () => {
    const dd = p.ok('eventDetail', { eventId: id });
    const nameOf = Object.fromEntries(dd.players.map((x) => [x.id, x.name]));
    return dd.stages.find((s) => s.id === fin).entries.slice().sort((x, y) => x.seed - y.seed).map((e) => nameOf[e.playerId]);
  };
  const stageOf = (sid) => p.ok('eventDetail', { eventId: id }).stages.find((s) => s.id === sid);
  return { p, id, a, b, fin, pid, finalEntries, stageOf };
}

test('A 確定 → B 確定: 両方の進出者と直接出場が残り、シードは直接出場 → 先に確定した進出元 → 後の進出元の順', () => {
  const w = build();
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  assert.deepEqual(w.finalEntries(), ['D', 'A1', 'A2']);
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.b });
  assert.deepEqual(w.finalEntries(), ['D', 'A1', 'A2', 'B1', 'B2']);
  const seeds = w.p.ok('eventDetail', { eventId: w.id }).stages.find((s) => s.id === w.fin).entries.map((e) => e.seed).sort((x, y) => x - y);
  assert.deepEqual(seeds, [1, 2, 3, 4, 5], 'シードが重ならない');
});

test('B 確定 → A 確定（逆順）も両方が残る', () => {
  const w = build();
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.b });
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  assert.deepEqual(w.finalEntries(), ['D', 'B1', 'B2', 'A1', 'A2']);
});

test('片方の取り消しは、その進出元の進出者だけを外す（他方・直接出場・他方の確定状態は残る）', () => {
  const w = build();
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.b });
  w.p.ok('undoAdvancement', { eventId: w.id, stageId: w.b });
  assert.deepEqual(w.finalEntries(), ['D', 'A1', 'A2']);
  assert.equal(w.stageOf(w.a).advanced, true);
  assert.equal(w.stageOf(w.b).advanced, false);
  // 取り消した側を再確定すると、後ろに並び直す
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.b });
  assert.deepEqual(w.finalEntries(), ['D', 'A1', 'A2', 'B1', 'B2']);
  // A を取り消して再確定すると、A が後ろになる（B の進出者・シードは変えない）
  w.p.ok('undoAdvancement', { eventId: w.id, stageId: w.a });
  assert.deepEqual(w.finalEntries(), ['D', 'B1', 'B2']);
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  assert.deepEqual(w.finalEntries(), ['D', 'B1', 'B2', 'A1', 'A2']);
});

test('確定のプレビューは、他の進出元の進出者を含めた実際の並びを示す', () => {
  const w = build();
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  const pv = w.p.ok('previewAdvancement', { eventId: w.id, stageId: w.b });
  assert.equal(pv.ok, true);
  assert.deepEqual(pv.targets[0].rows.map((r) => r.name), ['D', 'A1', 'A2', 'B1', 'B2']);
});

test('同じ選手が別の進出元から既に進出しているときは、確定を止めて何も変えない', () => {
  const w = build({ dupA1: true });
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  const before = w.finalEntries();
  const res = w.p.call('confirmAdvancement', { eventId: w.id, stageId: w.b });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'VALIDATION');
  assert.match(res.error.message, /A1/);
  assert.deepEqual(w.finalEntries(), before);
  assert.equal(w.stageOf(w.b).advanced, false);
});

test('進出先の表を作った後は、もう一方の確定も取り消しも止まる（開始済みの決勝を守る）', () => {
  const w = build();
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.b });
  w.p.ok('generateBracket', { eventId: w.id, stageId: w.fin });
  const d = w.p.ok('eventDetail', { eventId: w.id });
  const m = d.stages.find((s) => s.id === w.fin).rounds.flatMap((r) => r.matches).find((x) => x.status === 'scheduled' && x.p1 && x.p2);
  w.p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 });
  assert.equal(w.p.call('undoAdvancement', { eventId: w.id, stageId: w.b }).error.code, 'LOCKED');
  assert.deepEqual(w.finalEntries(), ['D', 'A1', 'A2', 'B1', 'B2']);
});

test('由来の記録がない旧データ（v0.7 以前の進出者）は、他の進出元が確定済みなら自動で消さずに止める', () => {
  const w = build();
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  // A の進出者の由来（meta_json）を消して、v0.7 以前の記録を模す
  const sheet = w.p.store.get().getSheetByName('Entries');
  const col = sheet.rows[0].indexOf('meta_json');
  const stageCol = sheet.rows[0].indexOf('stage_id');
  sheet.rows.forEach((r, i) => {
    if (i > 0 && r[stageCol] === w.fin && !String(r[col]).includes('"direct":true')) r[col] = '';
  });
  const before = w.finalEntries();
  const res = w.p.call('confirmAdvancement', { eventId: w.id, stageId: w.b });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'LOCKED');
  assert.deepEqual(w.finalEntries(), before, '旧データを書き換えない');
});

test('進出元が 1 つの大会は従来どおり: 由来のない旧データの進出者も、再確定で入れ替わる', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: '1 予選', template: 'robin_ko', groupCount: 1, advanceCount: 2, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(4, 'P') });
  let d = p.ok('eventDetail', { eventId: id });
  const pre = d.stages[0].id;
  const fin = d.stages[1].id;
  p.ok('autoAssign', { eventId: id, stageId: pre });
  p.ok('generateMatches', { eventId: id, stageId: pre });
  for (;;) {
    const dd = p.ok('eventDetail', { eventId: id });
    const m = dd.stages[0].groups.flatMap((g) => g.matches).find((x) => x.status === 'scheduled');
    if (!m) break;
    const p1wins = m.p1.name < m.p2.name;
    p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1wins ? 2 : 0, p2Legs: p1wins ? 0 : 2 });
  }
  p.ok('confirmAdvancement', { eventId: id, stageId: pre });
  const sheet = p.store.get().getSheetByName('Entries');
  const col = sheet.rows[0].indexOf('meta_json');
  const stageCol = sheet.rows[0].indexOf('stage_id');
  sheet.rows.forEach((r, i) => {
    if (i > 0 && r[stageCol] === fin) r[col] = '';
  });
  p.ok('undoAdvancement', { eventId: id, stageId: pre });
  d = p.ok('eventDetail', { eventId: id });
  assert.equal(d.stages[1].entries.length, 0, '旧データでも取り消しで外れる（従来どおり）');
  p.ok('confirmAdvancement', { eventId: id, stageId: pre });
  d = p.ok('eventDetail', { eventId: id });
  assert.equal(d.stages[1].entries.length, 2);
});

test('進出先がロビン: 2 つの進出元から入れても組とシードが重ならない', () => {
  const w = build({ targetType: 'round_robin', direct: false });
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.a });
  w.p.ok('confirmAdvancement', { eventId: w.id, stageId: w.b });
  assert.deepEqual(w.finalEntries().slice().sort(), ['A1', 'A2', 'B1', 'B2']);
  w.p.ok('undoAdvancement', { eventId: w.id, stageId: w.a });
  assert.deepEqual(w.finalEntries().slice().sort(), ['B1', 'B2']);
});
