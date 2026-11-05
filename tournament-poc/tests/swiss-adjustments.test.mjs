// 監査 PR-13（C-012）: スイス式の加減点を、順位表の勝ち点と次の回戦の組み合わせの両方に入れる（利用者の決定）。
// 修正前は設定できるのに、順位表にも組み合わせにも入っていなかった（総当たり・リーグは入っている）。
// - 勝ち点 = 試合の勝ち点 + 加減点。順位表の行に adjustment を出す（総当たりと同じ）
// - Buchholz（対戦した相手の勝ち点の合計）は、相手の試合の勝ち点だけで数える（ある選手への加減点で、その相手全員の Buchholz を動かさない）
// - 次の回戦は加減点を入れた勝ち点で組む。生成済みの回戦には触れない
// - 加減点を設定していない段階は従来どおり
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject, setupPair } from './gas-mock.mjs';

const admin = loadProject('admin');

function names(n) {
  return Array.from({ length: n }, (_, i) => `選手${String(i + 1).padStart(2, '0')}`);
}

const stageOf = (p, id) => p.ok('eventDetail', { eventId: id }).stages[0];

/** 名前の番号が小さい方が勝つ（2-0） */
function playRound(p, id) {
  for (;;) {
    const st = stageOf(p, id);
    const m = st.groups[0].matches.find((x) => x.status === 'scheduled' || x.status === 'live');
    if (!m) return;
    const p1wins = m.p1.name < m.p2.name;
    p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1wins ? 2 : 0, p2Legs: p1wins ? 0 : 2 });
  }
}

/** 勝ち 2・引き分け 1・負け 0 を明示した n 人のスイス式（加減点は勝ち点を設定した段階でだけ設定できる） */
function build(n, rounds, playoff = 0) {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'スイス', template: 'swiss', swissRounds: rounds, playoff, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(n) });
  let st = stageOf(p, id);
  p.ok('updateStage', { stageId: st.id, rev: st.rev, points: { win: 2, draw: 1, loss: 0 } });
  st = stageOf(p, id);
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  return { p, id, sid: st.id };
}

const idOf = (st, name) => st.groups[0].players.find((x) => x.name === name).id;
const nameOf = (st, pid) => st.groups[0].players.find((x) => x.id === pid).name;
const rowOf = (st, name) => st.groups[0].standings.find((r) => r.playerId === idOf(st, name));

function adjust(p, id, list) {
  const st = stageOf(p, id);
  p.ok('updateStage', { stageId: st.id, rev: st.rev, adjustments: list.map(([name, points]) => ({ playerId: idOf(st, name), points, reason: '理由 ' + name })) });
}

function roundPairs(st, round) {
  return st.groups[0].matches.filter((m) => m.round === round && m.resultType !== 'bye').map((m) => [m.p1.name, m.p2.name]);
}

test('加減点（正・負）を順位表の勝ち点に入れ、行に加減点を出す。順位も変わる', () => {
  const { p, id, sid } = build(8, 3);
  p.ok('generateSwissRound', { eventId: id, stageId: sid });
  playRound(p, id); // 1 回戦: 01-05・02-06・03-07・04-08 で 01〜04 が勝ち
  adjust(p, id, [['選手01', -3], ['選手05', 2]]);
  const st = stageOf(p, id);
  assert.equal(rowOf(st, '選手01').points, -1, '勝ち 2 + 加減 −3');
  assert.equal(rowOf(st, '選手01').adjustment, -3);
  assert.equal(rowOf(st, '選手05').points, 2, '負け 0 + 加減 +2');
  assert.equal(rowOf(st, '選手05').adjustment, 2);
  assert.equal(rowOf(st, '選手02').adjustment, undefined, '加減点のない選手の行は従来どおり');
  const order = st.groups[0].standings.map((r) => nameOf(st, r.playerId));
  assert.equal(order[order.length - 1], '選手01', '勝ち点 −1 は最下位');
  assert.ok(order.indexOf('選手05') < 4, '勝ち点 2 の組（上位 5 人）に入る');
});

test('Buchholz は相手の試合の勝ち点だけで数える（相手への加減点で動かない）', () => {
  const { p, id, sid } = build(8, 3);
  p.ok('generateSwissRound', { eventId: id, stageId: sid });
  playRound(p, id);
  const before = stageOf(p, id);
  const b5 = rowOf(before, '選手05').buchholz;
  assert.equal(b5, 2, '選手05 の相手は 1 回戦で勝った 選手01（2 点）');
  adjust(p, id, [['選手01', -3]]);
  const after = stageOf(p, id);
  assert.equal(rowOf(after, '選手05').buchholz, 2);
  assert.equal(rowOf(after, '選手01').buchholz, rowOf(before, '選手01').buchholz, '自分への加減点も自分の Buchholz には入らない');
});

test('次の回戦は加減点を入れた勝ち点で組む（同点どうし）。生成済みの 1 回戦は変えない', () => {
  const { p, id, sid } = build(8, 3);
  p.ok('generateSwissRound', { eventId: id, stageId: sid });
  playRound(p, id);
  // 選手01 を 0 点に、選手05 を 2 点にすると、2 点は 02・03・04・05、0 点は 01・06・07・08
  adjust(p, id, [['選手01', -2], ['選手05', 2]]);
  const r1 = stageOf(p, id).groups[0].matches.filter((m) => m.round === 1).map((m) => m.id + ':' + m.rev + ':' + m.status);
  p.ok('generateSwissRound', { eventId: id, stageId: sid });
  const st = stageOf(p, id);
  const pts = Object.fromEntries(st.groups[0].standings.map((r) => [nameOf(st, r.playerId), r.points]));
  const pairs = roundPairs(st, 2);
  assert.equal(pairs.length, 4);
  pairs.forEach(([a, b]) => assert.equal(pts[a], pts[b], `${a}（${pts[a]} 点）と ${b}（${pts[b]} 点）が組まれた`));
  const top = new Set(pairs.filter(([a]) => pts[a] === 2).flat());
  assert.deepEqual([...top].sort(), ['選手02', '選手03', '選手04', '選手05']);
  assert.deepEqual(st.groups[0].matches.filter((m) => m.round === 1).map((m) => m.id + ':' + m.rev + ':' + m.status), r1);
});

test('加減点で同点になれば同点として扱い（次の決め方で並べる）、進出の境目は加減点を入れた順位で決まる', () => {
  const { p, id, sid } = build(4, 2, 2);
  for (let r = 0; r < 2; r++) {
    p.ok('generateSwissRound', { eventId: id, stageId: sid });
    playRound(p, id);
  }
  // 2 回戦後: 選手01 4 点・選手02 2 点・選手03 2 点・選手04 0 点（番号の小さい方が必ず勝つ）
  let st = stageOf(p, id);
  assert.deepEqual(st.groups[0].standings.map((r) => r.points), [4, 2, 2, 0]);
  // 選手04 に +4 → 4 点で 選手01 と同点。選手01 に −1 → 3 点で単独 2 位に
  adjust(p, id, [['選手04', 4]]);
  st = stageOf(p, id);
  const tied = st.groups[0].standings.filter((r) => r.points === 4);
  assert.deepEqual(tied.map((r) => nameOf(st, r.playerId)).sort(), ['選手01', '選手04']);
  adjust(p, id, [['選手04', 4], ['選手01', -1]]);
  st = stageOf(p, id);
  const order = st.groups[0].standings.map((r) => nameOf(st, r.playerId));
  assert.deepEqual(order.slice(0, 2), ['選手04', '選手01'], '進出圏（2 人）は 選手04（4 点）と 選手01（3 点）');
  const d = p.ok('confirmAdvancement', { eventId: id, stageId: sid }).detail;
  const adv = d.stages[1].entries.map((e) => d.players.find((x) => x.id === e.playerId).name).sort();
  assert.deepEqual(adv, ['選手01', '選手04']);
});

test('組み合わせに使う勝ち点は順位表の勝ち点（加減点を含む）と一致し、加減点 0 件の段階は修正前と同じ', () => {
  const pointsOf = admin.fn('swissPairingPoints_');
  const { p, id, sid } = build(5, 2);
  p.ok('generateSwissRound', { eventId: id, stageId: sid });
  playRound(p, id);
  let st = stageOf(p, id);
  const plain = st.groups[0].standings.map((r) => [r.playerId, r.points]);
  st.groups[0].standings.forEach((r) => assert.equal(pointsOf(r, st.config), r.points));
  adjust(p, id, [['選手02', 5], ['選手03', -1]]);
  st = stageOf(p, id);
  st.groups[0].standings.forEach((r) => assert.equal(pointsOf(r, st.config), r.points, nameOf(st, r.playerId)));
  adjust(p, id, []);
  st = stageOf(p, id);
  assert.deepEqual(st.groups[0].standings.map((r) => [r.playerId, r.points]), plain, '加減点を消すと元の順位・勝ち点');
  assert.ok(st.groups[0].standings.every((r) => r.adjustment === undefined));
});
