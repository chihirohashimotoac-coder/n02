// 大会フォーマット（段階・トーナメント・進出・順位・セット制）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject, setupPair } from './gas-mock.mjs';

const admin = loadProject('admin');
const fn = (name) => admin.fn(name);
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ---------- 純粋な関数 ---------- */

test('シード配置: 1 位と 2 位は決勝まで当たらない標準の並び', () => {
  const pos = fn('seedPositions_');
  assert.deepEqual(plain(pos(2)), [1, 2]);
  assert.deepEqual(plain(pos(4)), [1, 4, 2, 3]);
  assert.deepEqual(plain(pos(8)), [1, 8, 4, 5, 2, 7, 3, 6]);
  const p16 = plain(pos(16));
  assert.equal(new Set(p16).size, 16);
  // 1 回戦の組は合計が 17（1-16, 8-9 …）
  for (let i = 0; i < 16; i += 2) assert.equal(p16[i] + p16[i + 1], 17);
});

test('トーナメント表: 2〜17 名で試合数は n-1、全員が 1 回だけ登場し、不戦勝は上位シードに付く', () => {
  const plan = fn('planBracket_');
  for (let n = 2; n <= 17; n++) {
    const ids = Array.from({ length: n }, (_, i) => `P${i + 1}`);
    const list = plain(plan(ids, false));
    assert.equal(list.length, n - 1, `n=${n}`);
    let size = 1;
    while (size < n) size *= 2;
    const byes = size - n;
    // 1 回戦に出る選手 + 2 回戦から出る選手（不戦勝）で全員
    const r1 = list.filter((m) => m.round === 1).flatMap((m) => [m.p1, m.p2]);
    const r2direct = list.filter((m) => m.round === 2).flatMap((m) => [m.p1, m.p2]).filter(Boolean);
    assert.equal(new Set(r1).size, r1.length);
    assert.deepEqual([...r1, ...r2direct].sort(), [...ids].sort(), `n=${n}`);
    // 不戦勝はシード上位 byes 名
    if (size > 2) assert.deepEqual(r2direct.sort(), ids.slice(0, byes).sort(), `byes n=${n}`);
    // 決勝は 1 つ、次の試合への参照は表の中に存在する
    const keys = new Set(list.map((m) => m.key));
    assert.equal(list.filter((m) => m.label === '決勝').length, 1);
    list.forEach((m) => m.nextKey && assert.ok(keys.has(m.nextKey), `next ${m.key}`));
  }
});

test('トーナメント表: 3 位決定戦は準決勝の敗者が入る', () => {
  const list = plain(fn('planBracket_')(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], true));
  assert.equal(list.length, 8);
  const third = list.find((m) => m.label === '3位決定戦');
  const semis = list.filter((m) => m.label === '準決勝');
  assert.ok(third);
  assert.deepEqual(semis.map((m) => [m.loserNextKey, m.loserNextSlot]), [['third', 1], ['third', 2]]);
  // 2 名なら 3 位決定戦は作らない
  assert.equal(plain(fn('planBracket_')(['A', 'B'], true)).length, 1);
});

test('2 回総当たり: 4 名で 12 試合、2 巡目は先後が入れ替わる', () => {
  const list = plain(fn('roundRobinPairings_')(['a', 'b', 'c', 'd'], 2));
  assert.equal(list.length, 12);
  assert.equal(Math.max(...list.map((m) => m.round)), 6);
  const first = list.slice(0, 6).map((m) => m.p1 + m.p2);
  const second = list.slice(6).map((m) => m.p2 + m.p1);
  assert.deepEqual(second, first);
});

test('セット制: セット数は Best of で判定し、Leg 数（任意）はセット数と矛盾しないか確かめる', () => {
  const ev = fn('evaluateMatchInput_');
  const spec = { format: 'sets', bestOf: 3, setBestOf: 5 }; // 2 セット先取、各セット 3 Leg 先取
  assert.equal(ev('final', { p1Sets: 2, p2Sets: 1, p1Legs: null, p2Legs: null }, spec).winnerSide, 1);
  assert.equal(ev('final', { p1Sets: 1, p2Sets: 1, p1Legs: null, p2Legs: null }, spec).ok, false);
  assert.equal(ev('final', { p1Sets: 3, p2Sets: 0, p1Legs: null, p2Legs: null }, spec).ok, false);
  // 2-1 なら勝者の Leg は 6〜8、敗者は 3〜7
  assert.equal(ev('final', { p1Sets: 2, p2Sets: 1, p1Legs: 6, p2Legs: 3 }, spec).ok, true);
  assert.equal(ev('final', { p1Sets: 2, p2Sets: 1, p1Legs: 8, p2Legs: 7 }, spec).ok, true);
  assert.equal(ev('final', { p1Sets: 2, p2Sets: 1, p1Legs: 5, p2Legs: 3 }, spec).ok, false);
  assert.equal(ev('final', { p1Sets: 2, p2Sets: 1, p1Legs: 9, p2Legs: 3 }, spec).ok, false);
  assert.equal(ev('final', { p1Sets: 2, p2Sets: 1, p1Legs: 6, p2Legs: 2 }, spec).ok, false);
  // 進行中は進行中のセットの Leg（最大 2）を足してよい
  assert.equal(ev('live', { p1Sets: 1, p2Sets: 0, p1Legs: 5, p2Legs: 2 }, spec).ok, true);
  assert.equal(ev('live', { p1Sets: 1, p2Sets: 0, p1Legs: 6, p2Legs: 2 }, spec).ok, false);
  assert.equal(ev('live', { p1Sets: 2, p2Sets: 0, p1Legs: null, p2Legs: null }, spec).ok, false);
  assert.equal(ev('scheduled', { p1Sets: 0, p2Sets: 0, p1Legs: 1, p2Legs: 0 }, spec).ok, false);
});

test('順位: 勝数 → Leg 差 → 直接対決 → 手動、の順に決まり、決まらなければ同順位', () => {
  const standings = (ids, finals, keys, manual) => plain(fn('computeStandings_')(ids, finals, keys, manual || {}));
  const f = (p1, p2, l1, l2) => ({ p1, p2, l1, l2, s1: 0, s2: 0, winner: l1 > l2 ? p1 : p2 });
  // a,b,c が 2 勝 1 敗で並び、Leg 差も同じ。直接対決は a>b, b>c, c>a の三すくみ
  const finals = [f('a', 'b', 3, 0), f('b', 'c', 3, 0), f('c', 'a', 3, 0), f('a', 'd', 3, 0), f('b', 'd', 3, 0), f('c', 'd', 3, 0)];
  let r = standings(['a', 'b', 'c', 'd'], finals, ['wins', 'leg_diff', 'head_to_head']);
  assert.deepEqual(r.map((x) => [x.playerId, x.rank, x.tied]), [['a', 1, true], ['b', 1, true], ['c', 1, true], ['d', 4, false]]);
  // 手動で順番を決めると解消
  r = standings(['a', 'b', 'c', 'd'], finals, ['wins', 'leg_diff', 'head_to_head'], { c: 1, a: 2, b: 3 });
  assert.deepEqual(r.map((x) => [x.playerId, x.rank, x.tied]), [['c', 1, false], ['a', 2, false], ['b', 3, false], ['d', 4, false]]);
  // 直接対決で決まる 2 人の並び
  // x・y が 2 勝、z・w が 1 勝。x は y に、w は z に勝っている
  const f2 = [f('x', 'y', 3, 0), f('x', 'w', 3, 0), f('y', 'w', 3, 0), f('y', 'z', 3, 0), f('z', 'x', 3, 0), f('w', 'z', 3, 0)];
  r = standings(['y', 'x', 'z', 'w'], f2, ['wins', 'head_to_head']);
  assert.deepEqual(r.map((x) => [x.playerId, x.rank, x.tied]), [['x', 1, false], ['y', 2, false], ['w', 3, false], ['z', 4, false]]);
  // 項目なし（手動のみ）だと全員同順位
  r = standings(['a', 'b'], [f('a', 'b', 3, 0)], []);
  assert.equal(r.every((x) => x.tied && x.rank === 1), true);
});

/* ---------- API を通した結合テスト ---------- */

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

const names = (n, prefix = '選手') => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);

/** 段階内の全試合を確定する（score(m) が [p1, p2] を返す） */
function finishStage(p, stageId, score) {
  let d = p.ok('eventDetail', { eventId: p.eventId });
  for (;;) {
    const st = d.stages.find((s) => s.id === stageId);
    const all = st.groups ? st.groups.flatMap((g) => g.matches) : st.rounds.flatMap((r) => r.matches);
    const m = all.find((x) => x.status === 'scheduled');
    if (!m) return d;
    const [a, b] = score(m);
    d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: a, p2Legs: b }).detail;
  }
}

test('ひな形「ロビン → A/B トーナメント」: 進出確定 → トーナメント表 → 勝ち上がり → 優勝者', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'AB大会', template: 'robin_ab', groupCount: 2, advanceCount: 2, thirdPlace: true, rule: { format: 'legs', bestOf: 5 } }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  assert.deepEqual(d.stages.map((s) => [s.name, s.type]), [['予選ロビン', 'round_robin'], ['A トーナメント', 'single_elimination'], ['B トーナメント', 'single_elimination']]);
  const [robin, A, B] = d.stages;
  assert.deepEqual(robin.config.advancement.map((r) => [r.fromRank, r.toRank, r.targetStageId]), [[1, 2, A.id], [3, 99, B.id]]);
  p.ok('addPlayers', { eventId: p.eventId, names: names(8) });
  p.ok('autoAssign', { eventId: p.eventId, stageId: robin.id });
  p.ok('generateMatches', { eventId: p.eventId, stageId: robin.id });
  // 進出の確定は全試合の確定後
  assert.equal(p.call('confirmAdvancement', { eventId: p.eventId, stageId: robin.id }).error.code, 'LOCKED');
  // 登録が早い選手ほど強い（番号の小さい方が 3-0 で勝つ）→ 各組で順位が一意に決まる
  const num = (name) => Number(name.replace(/\D/g, ''));
  finishStage(p, robin.id, (m) => (num(m.p1.name) < num(m.p2.name) ? [3, 0] : [0, 3]));
  d = p.ok('confirmAdvancement', { eventId: p.eventId, stageId: robin.id }).detail;
  const a = d.stages.find((s) => s.id === A.id);
  const b = d.stages.find((s) => s.id === B.id);
  assert.equal(a.entries.length, 4);
  assert.equal(b.entries.length, 4);
  // 1 位どうしが上位シード
  assert.deepEqual(a.entries.map((e) => e.source), ['グループA 1位', 'グループB 1位', 'グループA 2位', 'グループB 2位']);
  // 進出確定後はロビンの結果を変更できない
  const rm = d.stages[0].groups[0].matches[0];
  assert.equal(p.call('saveMatchResult', { matchId: rm.id, rev: rm.rev, status: 'final', p1Legs: 0, p2Legs: 3, correction: true }).error.code, 'LOCKED');

  // A トーナメント: 4 名 → 準決勝 2 + 決勝 + 3 位決定戦
  d = p.ok('generateBracket', { eventId: p.eventId, stageId: A.id }).detail;
  let at = d.stages.find((s) => s.id === A.id);
  assert.deepEqual(at.rounds.map((r) => [r.label, r.matches.length]), [['準決勝', 2], ['決勝', 2]]);
  const final = at.rounds[1].matches.find((m) => m.label === '決勝');
  assert.equal(final.status, 'pending');
  // 準決勝を確定すると決勝と 3 位決定戦に選手が入る
  d = finishStage(p, A.id, () => [3, 1]);
  at = d.stages.find((s) => s.id === A.id);
  const finalAfter = at.rounds[1].matches.find((m) => m.label === '決勝');
  assert.equal(finalAfter.status, 'final');
  assert.equal(at.champion.name, finalAfter.p1.name);
  // 公開データにもトーナメントが出る
  const ev = d.event;
  p.ok('updateEvent', { eventId: p.eventId, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '' });
  const pub = p.viewer.run('getPublicSnapshot', {});
  const pa = pub.data.stages.find((s) => s.id === A.id);
  assert.equal(pa.champion.name, at.champion.name);
  assert.equal(pa.rounds.length, 2);
  // 進出の取り消しは、進出先で結果が入っていると不可
  assert.equal(p.call('undoAdvancement', { eventId: p.eventId, stageId: robin.id }).error.code, 'LOCKED');
});

test('トーナメント: 不戦勝・訂正時の勝ち上がりの入れ替え・次の試合が始まっていたら訂正できない', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'KO', template: 'elimination', rule: { format: 'legs', bestOf: 3 } }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  const st = d.stages[0];
  p.ok('addPlayers', { eventId: p.eventId, names: names(5) });
  d = p.ok('eventDetail', { eventId: p.eventId });
  // シード順を手で決める（逆順）
  const ids = d.players.map((x) => x.id).reverse();
  p.ok('setEntrants', { eventId: p.eventId, stageId: st.id, playerIds: ids });
  d = p.ok('generateBracket', { eventId: p.eventId, stageId: st.id }).detail;
  let s = d.stages[0];
  // 5 名 → 8 枠、不戦勝 3。1 回戦は 1 試合だけ（シード 4 対 5）
  assert.equal(s.rounds[0].matches.length, 1);
  assert.deepEqual([s.rounds[0].matches[0].p1.id, s.rounds[0].matches[0].p2.id], [ids[3], ids[4]]);
  // 出場者の変更はトーナメント表の作成後は不可
  assert.equal(p.call('setEntrants', { eventId: p.eventId, stageId: st.id, playerIds: ids }).error.code, 'LOCKED');
  // 1 回戦: シード 5 が勝つ → 準々決勝でシード 1 と対戦
  const r1 = s.rounds[0].matches[0];
  d = p.ok('saveMatchResult', { matchId: r1.id, rev: r1.rev, status: 'final', p1Legs: 0, p2Legs: 2 }).detail;
  s = d.stages[0];
  const qf = s.rounds[1].matches.find((m) => m.p1.id === ids[0] || m.p2.id === ids[0]);
  assert.deepEqual([qf.p1.id, qf.p2.id].sort(), [ids[0], ids[4]].sort());
  // 訂正で勝者が変わると、次の試合の枠も入れ替わる
  const r1b = s.rounds[0].matches[0];
  d = p.ok('saveMatchResult', { matchId: r1b.id, rev: r1b.rev, status: 'final', p1Legs: 2, p2Legs: 1, correction: true }).detail;
  s = d.stages[0];
  const qf2 = s.rounds[1].matches.find((m) => m.id === qf.id);
  assert.deepEqual([qf2.p1.id, qf2.p2.id].sort(), [ids[0], ids[3]].sort());
  // 次の試合が始まったら、前の試合は訂正できない
  p.ok('saveMatchResult', { matchId: qf2.id, rev: qf2.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  d = p.ok('eventDetail', { eventId: p.eventId });
  const r1c = d.stages[0].rounds[0].matches[0];
  assert.equal(p.call('saveMatchResult', { matchId: r1c.id, rev: r1c.rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true }).error.code, 'LOCKED');
  // 対戦相手が未確定の試合には結果を入れられない
  const pending = d.stages[0].rounds[2].matches[0];
  assert.equal(pending.status, 'pending');
  assert.equal(p.call('saveMatchResult', { matchId: pending.id, rev: pending.rev, status: 'live', p1Legs: 1, p2Legs: 0 }).error.code, 'LOCKED');
  // 結果の入った表は削除できない
  assert.equal(p.call('clearBracket', { eventId: p.eventId, stageId: st.id }).error.code, 'LOCKED');
});

test('ラウンドごとの Best of: 決勝だけ Best of 7 にすると、決勝は 3-0 では確定できず 4-0 で確定', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'Bo7', template: 'elimination', rule: { format: 'legs', bestOf: 5 } }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  const st = d.stages[0];
  p.ok('addPlayers', { eventId: p.eventId, names: names(4) });
  d = p.ok('eventDetail', { eventId: p.eventId });
  p.ok('setEntrants', { eventId: p.eventId, stageId: st.id, playerIds: d.players.map((x) => x.id) });
  d = p.ok('eventDetail', { eventId: p.eventId });
  p.ok('updateStage', { stageId: st.id, rev: d.stages[0].rev, roundBestOf: { 2: 7 } });
  d = p.ok('generateBracket', { eventId: p.eventId, stageId: st.id }).detail;
  for (const m of d.stages[0].rounds[0].matches) p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 });
  d = p.ok('eventDetail', { eventId: p.eventId });
  const f = d.stages[0].rounds[1].matches[0];
  assert.equal(f.bestOf, 7);
  assert.equal(p.call('saveMatchResult', { matchId: f.id, rev: f.rev, status: 'final', p1Legs: 3, p2Legs: 0 }).error.code, 'VALIDATION');
  assert.equal(p.call('saveMatchResult', { matchId: f.id, rev: f.rev, status: 'final', p1Legs: 4, p2Legs: 0 }).ok, true);
  // 結果の入ったラウンドの Best of は変えられない
  d = p.ok('eventDetail', { eventId: p.eventId });
  assert.equal(p.call('updateStage', { stageId: st.id, rev: d.stages[0].rev, roundBestOf: { 2: 9 } }).error.code, 'LOCKED');
});

test('セット制の段階: セット数で勝敗、順位表にセット数も集計', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'Sets', template: 'league', rule: { format: 'sets', bestOf: 3, setBestOf: 5 } }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  const st = d.stages[0];
  assert.equal(st.rule.format, 'sets');
  p.ok('addPlayers', { eventId: p.eventId, names: names(3) });
  p.ok('autoAssign', { eventId: p.eventId, stageId: st.id });
  d = p.ok('generateMatches', { eventId: p.eventId, stageId: st.id }).detail;
  const m = d.stages[0].groups[0].matches[0];
  assert.equal(m.label, '第1節');
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Sets: 2, p2Sets: 2 }).error.code, 'VALIDATION');
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Sets: 2, p2Sets: 1, p1Legs: 4, p2Legs: 3 }).error.code, 'VALIDATION');
  d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Sets: 2, p2Sets: 1, p1Legs: 7, p2Legs: 5 }).detail;
  const row = d.stages[0].groups[0].standings.find((x) => x.playerId === m.p1.id);
  assert.deepEqual([row.won, row.setsFor, row.setsAgainst, row.legsFor], [1, 2, 1, 7]);
  // Leg 数を入れない運用も可能
  const m2 = d.stages[0].groups[0].matches[1];
  assert.equal(p.call('saveMatchResult', { matchId: m2.id, rev: m2.rev, status: 'final', p1Sets: 0, p2Sets: 2, p1Legs: '', p2Legs: '' }).ok, true);
  // 結果入力後は形式を変えられない
  d = p.ok('eventDetail', { eventId: p.eventId });
  assert.equal(p.call('updateStage', { stageId: st.id, rev: d.stages[0].rev, rule: { format: 'legs', bestOf: 5 } }).error.code, 'LOCKED');
});

test('リーグ: 2 回総当たり・節の表示名', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'League', template: 'league', cycles: 2, rule: { format: 'legs', bestOf: 5 } }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  const st = d.stages[0];
  assert.equal(st.cycles, 2);
  p.ok('addPlayers', { eventId: p.eventId, names: names(4) });
  p.ok('autoAssign', { eventId: p.eventId, stageId: st.id });
  d = p.ok('eventDetail', { eventId: p.eventId });
  d = p.ok('updateStage', { stageId: st.id, rev: d.stages[0].rev, roundLabels: { 1: '第1節 11/3', 4: '第4節 12/1' } }).detail;
  d = p.ok('generateMatches', { eventId: p.eventId, stageId: st.id }).detail;
  const ms = d.stages[0].groups[0].matches;
  assert.equal(ms.length, 12);
  assert.equal(ms[0].label, '第1節 11/3');
  assert.equal(ms.find((m) => m.round === 4).label, '第4節 12/1');
  assert.equal(ms.find((m) => m.round === 2).label, '第2節');
  // 対戦カード作成後は回数を変えられない
  assert.equal(p.call('updateStage', { stageId: st.id, rev: d.stages[0].rev, cycles: 1 }).error.code, 'LOCKED');
});

test('同順位が進出の境目をまたぐと進出できず、手動で順位を決めると進出できる', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'Tie', template: 'robin_ab', groupCount: 1, advanceCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  const robin = d.stages[0];
  // 順位の決め方を「勝数」だけにする
  p.ok('updateStage', { stageId: robin.id, rev: robin.rev, tiebreakers: ['wins'] });
  p.ok('addPlayers', { eventId: p.eventId, names: names(3) });
  p.ok('autoAssign', { eventId: p.eventId, stageId: robin.id });
  p.ok('generateMatches', { eventId: p.eventId, stageId: robin.id });
  // 三すくみ: 全員 1 勝 1 敗
  d = finishStage(p, robin.id, () => [2, 0]);
  const g = d.stages[0].groups[0];
  assert.ok(g.standings.every((r) => r.tied && r.rank === 1));
  assert.equal(p.call('confirmAdvancement', { eventId: p.eventId, stageId: robin.id }).error.code, 'TIE');
  const order = g.standings.map((r) => r.playerId).reverse();
  d = p.ok('setManualOrder', { eventId: p.eventId, stageId: robin.id, groupId: g.id, playerIds: order }).detail;
  assert.deepEqual(d.stages[0].groups[0].standings.map((r) => r.playerId), order);
  d = p.ok('confirmAdvancement', { eventId: p.eventId, stageId: robin.id }).detail;
  assert.deepEqual(d.stages[1].entries.map((e) => e.playerId), [order[0]]);
  assert.deepEqual(d.stages[2].entries.map((e) => e.playerId), order.slice(1));
  // 取り消すと進出先は空に戻り、ロビンを再び編集できる
  d = p.ok('undoAdvancement', { eventId: p.eventId, stageId: robin.id }).detail;
  assert.equal(d.stages[1].entries.length, 0);
  assert.equal(d.stages[0].config.advanced, false);
});

test('段階の追加・設定・削除と、その制約', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'Stages', template: 'robin', groupCount: 2, rule: { format: 'legs', bestOf: 5 } }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  const robin = d.stages[0];
  const added = p.ok('addStage', { eventId: p.eventId, type: 'single_elimination', name: '決勝トーナメント' });
  d = added.detail;
  const ko = d.stages.find((s) => s.id === added.stageId);
  assert.equal(ko.order, 2);
  // 進出ルール: 各組 1〜2 位 → 決勝トーナメント
  d = p.ok('updateStage', { stageId: robin.id, rev: d.stages[0].rev, advancement: [{ fromRank: 1, toRank: 2, targetStageId: ko.id }] }).detail;
  assert.equal(d.stages[0].config.advancement.length, 1);
  // 不正な進出ルール（自分自身・前の段階・範囲の重なり）
  const rev = d.stages[0].rev;
  assert.equal(p.call('updateStage', { stageId: robin.id, rev, advancement: [{ fromRank: 1, toRank: 2, targetStageId: robin.id }] }).error.code, 'VALIDATION');
  assert.equal(p.call('updateStage', { stageId: robin.id, rev, advancement: [{ fromRank: 1, toRank: 2, targetStageId: ko.id }, { fromRank: 2, toRank: 3, targetStageId: ko.id }] }).error.code, 'VALIDATION');
  assert.equal(p.call('updateStage', { stageId: robin.id, rev, tiebreakers: ['wins', 'unknown'] }).error.code, 'VALIDATION');
  // 進出先になっている段階は削除できない
  assert.equal(p.call('deleteStage', { stageId: ko.id, rev: ko.rev }).error.code, 'LOCKED');
  // 最後の段階は削除できない／段階は 8 つまで
  d = p.ok('updateStage', { stageId: robin.id, rev, advancement: [] }).detail;
  d = p.ok('deleteStage', { stageId: ko.id, rev: d.stages[1].rev }).detail;
  assert.equal(d.stages.length, 1);
  assert.equal(p.call('deleteStage', { stageId: robin.id, rev: d.stages[0].rev }).error.code, 'LOCKED');
  assert.equal(p.call('addStage', { eventId: p.eventId, type: 'swiss' }).error.code, 'VALIDATION');
  for (let i = 0; i < 7; i++) p.ok('addStage', { eventId: p.eventId, type: 'league' });
  assert.equal(p.call('addStage', { eventId: p.eventId, type: 'league' }).error.code, 'LIMIT');
});

test('主催者は他の大会の段階を、stageId や eventId との組み合わせで操作できない', () => {
  const p = ready();
  const a = p.call('createEvent', { name: 'A', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, { auth: 'anon' }).data;
  const b = p.call('createEvent', { name: 'B', template: 'elimination', rule: { format: 'legs', bestOf: 3 } }, { auth: 'anon' }).data;
  const authA = { eventId: a.eventId, key: a.adminKey };
  const bStage = b.detail.stages[0];
  assert.equal(p.call('updateStage', { stageId: bStage.id, rev: bStage.rev, name: 'x' }, { auth: authA }).error.code, 'NOT_FOUND');
  assert.equal(p.call('deleteStage', { stageId: bStage.id, rev: bStage.rev }, { auth: authA }).error.code, 'NOT_FOUND');
  assert.equal(p.call('generateBracket', { eventId: a.eventId, stageId: bStage.id }, { auth: authA }).error.code, 'NOT_FOUND');
  assert.equal(p.call('setEntrants', { eventId: a.eventId, stageId: bStage.id, playerIds: [] }, { auth: authA }).error.code, 'NOT_FOUND');
  // 自分の大会の操作は可能
  assert.equal(p.call('addStage', { eventId: a.eventId, type: 'single_elimination' }, { auth: authA }).ok, true);
});

test('まとめて確定: トーナメントの準決勝 2 試合を一度に確定すると、決勝・3 位決定戦に勝者・敗者が入る', () => {
  const p = ready();
  p.eventId = p.ok('createEvent', { name: 'Batch', template: 'elimination', rule: { format: 'legs', bestOf: 3 }, thirdPlace: true }).eventId;
  let d = p.ok('eventDetail', { eventId: p.eventId });
  const st = d.stages[0];
  p.ok('addPlayers', { eventId: p.eventId, names: names(4) });
  d = p.ok('eventDetail', { eventId: p.eventId });
  p.ok('setEntrants', { eventId: p.eventId, stageId: st.id, playerIds: d.players.map((x) => x.id) });
  d = p.ok('generateBracket', { eventId: p.eventId, stageId: st.id }).detail;
  const [s1, s2] = d.stages[0].rounds[0].matches;
  d = p.ok('saveMatchResults', {
    eventId: p.eventId,
    results: [
      { matchId: s1.id, rev: s1.rev, p1Legs: 2, p2Legs: 0 },
      { matchId: s2.id, rev: s2.rev, p1Legs: 1, p2Legs: 2 },
    ],
  }).detail;
  const last = d.stages[0].rounds[1].matches;
  const final = last.find((m) => m.label === '決勝');
  const third = last.find((m) => m.label === '3位決定戦');
  assert.deepEqual([final.p1.id, final.p2.id], [s1.p1.id, s2.p2.id]);
  assert.deepEqual([third.p1.id, third.p2.id], [s1.p2.id, s2.p1.id]);
  assert.equal(final.status, 'scheduled');
});
