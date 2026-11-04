// 監査 PR-12（C-011）: スイス式の次の回戦は、表示用の順位の決め方（tiebreakers）から「勝ち点」を外しても、
// 実際の勝ち点で組む（同じ勝ち点の中で上半分と下半分。組めないときは近い勝ち点）。
// 既定の決め方（勝ち点が先頭）の並び・不戦・再戦回避は変えない。生成済みの試合には触れない。
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

function build(n, rounds, tiebreakers) {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'スイス', template: 'swiss', swissRounds: rounds, playoff: 0, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(n) });
  let st = stageOf(p, id);
  if (tiebreakers) p.ok('updateStage', { stageId: st.id, rev: st.rev, tiebreakers });
  st = stageOf(p, id);
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  return { p, id, sid: st.id };
}

/** 確定した試合から実際の勝ち点（勝ち 2・負け 0・不戦 2）を数える */
function actualPoints(st) {
  const pts = {};
  st.groups[0].players.forEach((x) => (pts[x.id] = 0));
  st.groups[0].matches.forEach((m) => {
    if (m.status !== 'final' && m.resultType !== 'bye') return;
    if (m.resultType === 'bye') pts[m.p1.id] += 2;
    else pts[m.winnerId] += 2;
  });
  return pts;
}

function roundPairs(st, round) {
  return st.groups[0].matches.filter((m) => m.round === round && m.resultType !== 'bye').map((m) => [m.p1.name, m.p2.name]);
}

test('表示用の決め方から勝ち点を外しても（Buchholz・Leg 差）、2 回戦は 1 回戦の勝者どうし・敗者どうしで組む', () => {
  const { p, id, sid } = build(8, 3, ['buchholz', 'leg_diff']);
  assert.deepEqual(stageOf(p, id).tiebreakers, ['buchholz', 'leg_diff']);
  p.ok('generateSwissRound', { eventId: id, stageId: sid });
  playRound(p, id);
  const before = stageOf(p, id);
  const pts = actualPoints(before);
  // 表示の順位は Buchholz が先頭なので、1 回戦の敗者（相手が勝ち点 2）が上に並ぶ（表示はそのまま）
  assert.equal(before.groups[0].standings[0].points, undefined, '表示用の順位表に勝ち点の列は出ない（従来どおり）');
  const r1 = before.groups[0].matches.filter((m) => m.round === 1).map((m) => m.id + ':' + m.rev + ':' + m.status);
  p.ok('generateSwissRound', { eventId: id, stageId: sid });
  const after = stageOf(p, id);
  const byId = Object.fromEntries(after.groups[0].players.map((x) => [x.name, x.id]));
  roundPairs(after, 2).forEach(([a, b]) => assert.equal(pts[byId[a]], pts[byId[b]], `${a}（${pts[byId[a]]} 点）と ${b}（${pts[byId[b]]} 点）が組まれた`));
  // 生成済みの 1 回戦には触れない
  assert.deepEqual(after.groups[0].matches.filter((m) => m.round === 1).map((m) => m.id + ':' + m.rev + ':' + m.status), r1);
});

test('勝ち点を外した決め方で 7 人 4 回戦: 毎回戦、同じ勝ち点どうしで組めるときはそう組む。再戦なし・不戦は同じ人に 2 回与えない', () => {
  const { p, id, sid } = build(7, 4, ['buchholz', 'wins', 'leg_diff']);
  for (let round = 1; round <= 4; round++) {
    const st0 = stageOf(p, id);
    const pts = actualPoints(st0);
    const res = p.ok('generateSwissRound', { eventId: id, stageId: sid });
    assert.ok(res.bye, '奇数人数なので不戦');
    const st = stageOf(p, id);
    const byId = Object.fromEntries(st.groups[0].players.map((x) => [x.name, x.id]));
    const pairs = roundPairs(st, round);
    // 勝ち点ごとの人数（不戦の選手を除く）から、同点どうしで組めない組の最少数を求め、それ以上ずれていないこと
    const byeId = st.groups[0].matches.find((m) => m.round === round && m.resultType === 'bye').p1.id;
    const counts = {};
    Object.keys(pts).filter((pid) => pid !== byeId).forEach((pid) => (counts[pts[pid]] = (counts[pts[pid]] || 0) + 1));
    const minMixed = Math.floor(Object.values(counts).filter((c) => c % 2).length / 2);
    const mixed = pairs.filter(([a, b]) => pts[byId[a]] !== pts[byId[b]]).length;
    assert.ok(mixed <= minMixed, `第${round}回戦: 勝ち点の違う組 ${mixed}（最少 ${minMixed}）`);
    playRound(p, id);
  }
  const st = stageOf(p, id);
  const seen = new Set();
  const byes = {};
  st.groups[0].matches.forEach((m) => {
    if (m.resultType === 'bye') {
      byes[m.p1.id] = (byes[m.p1.id] || 0) + 1;
      return;
    }
    const key = [m.p1.id, m.p2.id].sort().join('|');
    assert.ok(!seen.has(key), '再戦');
    seen.add(key);
  });
  Object.values(byes).forEach((c) => assert.equal(c, 1));
});

test('既定の決め方（勝ち点が先頭）の組み合わせは変わらない（8 人 3 回戦・7 人 3 回戦）', () => {
  // 修正前のコードで記録した組み合わせ（1 回戦はシード順・番号の小さい方が勝つ）
  const expected = {
    8: [
      [['選手01', '選手05'], ['選手02', '選手06'], ['選手03', '選手07'], ['選手04', '選手08']],
      [['選手01', '選手03'], ['選手02', '選手04'], ['選手05', '選手07'], ['選手06', '選手08']],
      [['選手01', '選手02'], ['選手03', '選手05'], ['選手04', '選手06'], ['選手07', '選手08']],
    ],
    7: [
      [['選手01', '選手04'], ['選手02', '選手05'], ['選手03', '選手06']],
      [['選手01', '選手03'], ['選手02', '選手07'], ['選手04', '選手05']],
      [['選手01', '選手02'], ['選手03', '選手07'], ['選手04', '選手06']],
    ],
  };
  for (const n of [8, 7]) {
    const { p, id, sid } = build(n, 3, null);
    const got = [];
    for (let round = 1; round <= 3; round++) {
      p.ok('generateSwissRound', { eventId: id, stageId: sid });
      got.push(roundPairs(stageOf(p, id), round));
      playRound(p, id);
    }
    assert.deepEqual(got, expected[n], `${n} 人`);
  }
});

test('組み合わせに使う勝ち点は、勝ち点を表示する順位表の勝ち点と一致する（引き分け・不戦・勝ち点の設定を変えた場合も）', () => {
  const pointsOf = admin.fn('swissPairingPoints_');
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'スイス', template: 'swiss', swissRounds: 3, playoff: 0, rule: { format: 'fixed', bestOf: 2 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(5) });
  let st = stageOf(p, id);
  p.ok('updateStage', { stageId: st.id, rev: st.rev, points: { win: 3, draw: 1, loss: 0 } });
  st = stageOf(p, id);
  p.ok('updateStage', { stageId: st.id, rev: st.rev, byePoints: 2 });
  st = stageOf(p, id);
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  let k = 0;
  for (let round = 1; round <= 3; round++) {
    p.ok('generateSwissRound', { eventId: id, stageId: st.id });
    for (;;) {
      const s = stageOf(p, id);
      const m = s.groups[0].matches.find((x) => x.status === 'scheduled');
      if (!m) break;
      const r = k++ % 3; // 勝ち・引き分け・負けを順に
      p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: r === 0 ? 2 : r === 1 ? 1 : 0, p2Legs: r === 0 ? 0 : r === 1 ? 1 : 2 });
    }
  }
  st = stageOf(p, id);
  const cfg = st.config;
  const rows = st.groups[0].standings;
  assert.ok(rows.some((r) => r.drawn), '引き分けがある');
  assert.ok(rows.some((r) => r.byes), '不戦がある');
  rows.forEach((r) => assert.equal(pointsOf(r, cfg), r.points, r.playerId));
});
