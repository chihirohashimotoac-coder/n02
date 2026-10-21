// v0.8: 大会形式の追加（ダブルエリミ・スイス式・シリーズ・複数段階ロビン・回戦ごとの抽選・途中回戦シード・直接出場）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject, setupPair } from './gas-mock.mjs';

const admin = loadProject('admin');
const fn = (name) => admin.fn(name);
const plain = (v) => JSON.parse(JSON.stringify(v));

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

function names(n, prefix = '選手') {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
}

/** 決まった規則で勝者を決める（名前の番号が小さい方が勝つ / 逆） */
function pickByName(lowWins = true) {
  return (m) => {
    const a = m.p1.name;
    const b = m.p2.name;
    return (a < b) === lowWins ? 1 : 2;
  };
}

/** 乱数（種つき） */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allMatches(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  if (st.nights) return st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches));
  return (st.rounds || []).flatMap((r) => r.matches);
}

/** 段階の「入力できる試合」を 1 つずつ確定していく（chooser が勝者の側 1/2 を返す）。戻り値は確定した試合数 */
function playStage(p, eventId, stageId, chooser, limit = 1000) {
  let n = 0;
  for (; n < limit; n++) {
    const d = p.ok('eventDetail', { eventId });
    const st = d.stages.find((s) => s.id === stageId);
    const m = allMatches(st).find((x) => x.status === 'scheduled' || x.status === 'live');
    if (!m) break;
    const side = chooser(m, d);
    const need = Math.floor(m.bestOf / 2) + 1;
    const res = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: side === 1 ? need : need - 1, p2Legs: side === 2 ? need : need - 1 });
    if (!res.ok) throw new Error(`${m.label}: ${res.error.message}`);
  }
  return n;
}

function create(p, payload) {
  return p.ok('createEvent', { name: '大会', rule: { format: 'legs', bestOf: 3 }, ...payload }).eventId;
}

function detail(p, eventId) {
  return p.ok('eventDetail', { eventId });
}

/* ---------- 形式の定義（shared/formats.js） ---------- */

test('作成欄の形式は指定の順で 10 種類。既存の ID を残し、説明と流れを持つ', () => {
  const list = plain(admin.context.TOURNAMENT_FORMATS);
  assert.deepEqual(list.map((f) => f.id), ['robin_ko', 'elimination', 'robin_ab', 'double_elimination', 'robin', 'league', 'league_playoff', 'multi_robin_ko', 'series_playoff', 'swiss']);
  assert.equal(admin.context.DEFAULT_FORMAT_ID, 'robin_ko');
  list.forEach((f) => {
    assert.ok(f.label && f.flow && f.description, f.id);
    assert.doesNotMatch(f.description + f.label, /公式|準拠|認定|互換/, '公式を名乗らない');
  });
});

test('見積もり: 予定試合数と成り立たない条件', () => {
  const est = (id, params) => plain(fn('estimateFormat_')(id, params));
  assert.equal(est('robin', { players: 5, groups: 1 }).total, 10);
  assert.equal(est('robin', { players: 7, groups: 1 }).total, 21);
  assert.equal(est('robin', { players: 7, groups: 1, cycles: 2 }).total, 42);
  const rk = est('robin_ko', { players: 16, groups: 4, advance: 2, thirdPlace: true });
  assert.equal(rk.total, 24 + 7 + 1);
  assert.deepEqual(est('double_elimination', { players: 8 }), { stages: [{ name: 'ダブルエリミネーション', matches: 14, note: 'グランドファイナルで敗者側が勝てば、もう 1 試合（リセット）' }], total: 14, max: 15, problems: [], notes: [] });
  assert.equal(est('double_elimination', { players: 8, grandFinal: 'single' }).max, 14);
  assert.match(est('robin', { players: 5, groups: 3 }).problems.join(), /2 人未満/);
  assert.match(est('swiss', { players: 6, swissRounds: 6 }).problems.join(), /5 回戦まで/);
  assert.equal(est('series_playoff', { players: 8, nights: 16, playoff: 4 }).total, 16 * 7 + 3);
  assert.match(est('series_playoff', { players: 3, nights: 2, playoff: 4 }).problems.join(), /プレーオフの人数/);
});

/* ---------- 総当たり ---------- */

test('総当たり: 5 人 10 試合・7 人 21 試合・7 人 2 回 42 試合。同じ回に同じ選手は 1 回だけ', () => {
  const pair = fn('roundRobinPairings_');
  for (const [n, cycles, total] of [[5, 1, 10], [7, 1, 21], [7, 2, 42], [6, 1, 15]]) {
    const list = plain(pair(names(n), cycles));
    assert.equal(list.length, total, `${n}x${cycles}`);
    const byRound = {};
    list.forEach((m) => {
      byRound[m.round] = byRound[m.round] || new Set();
      assert.ok(!byRound[m.round].has(m.p1) && !byRound[m.round].has(m.p2), `round ${m.round}`);
      byRound[m.round].add(m.p1);
      byRound[m.round].add(m.p2);
    });
    const pairs = new Set(list.map((m) => [m.p1, m.p2].sort().join('|')));
    assert.equal(pairs.size, (n * (n - 1)) / 2);
  }
});

/* ---------- 予選ロビン → 決勝トーナメント ---------- */

test('予選ロビン → 決勝: 組の人数が違っても通過者を重複・欠落なく進め、同じ組の選手は初戦で当たらない。最後まで行くと自動で終了', () => {
  const p = ready();
  const id = create(p, { template: 'robin_ko', groupCount: 3, advanceCount: 2, thirdPlace: true });
  p.ok('addPlayers', { eventId: id, names: names(10) });
  let d = detail(p, id);
  assert.deepEqual(d.stages.map((s) => s.type), ['round_robin', 'single_elimination']);
  assert.equal(d.event.config.template, 'robin_ko');
  assert.equal(d.event.config.autoFinish, true);
  const pre = d.stages[0];
  p.ok('autoAssign', { eventId: id, stageId: pre.id });
  p.ok('generateMatches', { eventId: id, stageId: pre.id });
  d = detail(p, id);
  assert.deepEqual(d.stages[0].groups.map((g) => g.players.length), [4, 3, 3]);
  playStage(p, id, pre.id, pickByName(true));
  const preview = p.ok('previewAdvancement', { eventId: id, stageId: pre.id });
  assert.equal(preview.ok, true);
  assert.equal(preview.targets[0].rows.length, 6);
  const adv = p.ok('confirmAdvancement', { eventId: id, stageId: pre.id });
  assert.equal(adv.advanced, 6);
  d = adv.detail;
  const ko = d.stages[1];
  const entrants = ko.entries.map((e) => e.playerId);
  assert.equal(new Set(entrants).size, 6, '重複なし');
  // 各組の 1・2 位だけが入っている
  const expected = d.stages[0].groups.flatMap((g) => g.standings.filter((r) => r.rank <= 2).map((r) => r.playerId));
  assert.deepEqual([...entrants].sort(), [...expected].sort());
  const bp = p.ok('previewBracket', { eventId: id, stageId: ko.id });
  assert.equal(bp.ok, true);
  d = p.ok('generateBracket', { eventId: id, stageId: ko.id }).detail;
  const groupOf = {};
  d.stages[0].groups.forEach((g) => g.players.forEach((pl) => (groupOf[pl.id] = g.id)));
  const firstRound = allMatches(d.stages[1]).filter((m) => m.p1.id && m.p2.id && m.round === 1);
  firstRound.forEach((m) => assert.notEqual(groupOf[m.p1.id], groupOf[m.p2.id], `${m.p1.name} vs ${m.p2.name}`));
  playStage(p, id, ko.id, pickByName(true));
  d = detail(p, id);
  assert.ok(d.stages[1].champion);
  assert.equal(d.complete, true);
  assert.equal(d.event.status, 'finished', '全段階（3 位決定戦を含む）が終わったら自動で終了');
  assert.ok(d.history.some((h) => h.action === 'event.autoFinish'));
  // 決勝を「未開始」に戻すと、終わっていない段階ができるので開催中に戻る
  const final = allMatches(d.stages[1]).find((m) => m.label === '決勝');
  d = p.ok('saveMatchResult', { matchId: final.id, rev: final.rev, status: 'scheduled', p1Legs: 0, p2Legs: 0, correction: true }).detail;
  assert.equal(d.event.status, 'running');
  assert.ok(d.history.some((h) => h.action === 'event.autoReopen'));
});

test('進出の境目の同順位は主催者が決めるまで進めない（名前順などで決めない）', () => {
  const p = ready();
  const id = create(p, { template: 'robin_ko', groupCount: 1, advanceCount: 1 });
  p.ok('addPlayers', { eventId: id, names: names(3) });
  let d = detail(p, id);
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id });
  d = p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id }).detail;
  // 3 人で 1 勝ずつ（じゃんけん状態）。Leg も同じにする
  const ms = d.stages[0].groups[0].matches;
  const byName = (m) => [m.p1.name, m.p2.name].sort().join('-');
  const winner = { '選手01-選手02': '選手01', '選手02-選手03': '選手02', '選手01-選手03': '選手03' };
  ms.forEach((m) => {
    const w = winner[byName(m)] === m.p1.name ? 1 : 2;
    p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: w === 1 ? 2 : 1, p2Legs: w === 2 ? 2 : 1 });
  });
  d = detail(p, id);
  assert.ok(d.stages[0].groups[0].standings.every((r) => r.tied));
  const pv = p.ok('previewAdvancement', { eventId: id, stageId: d.stages[0].id });
  assert.equal(pv.ok, false);
  assert.equal(pv.code, 'TIE');
  assert.equal(p.call('confirmAdvancement', { eventId: id, stageId: d.stages[0].id }).error.code, 'TIE');
  const g = d.stages[0].groups[0];
  const order = g.players.map((x) => x.id).reverse();
  p.ok('setManualOrder', { eventId: id, stageId: d.stages[0].id, groupId: g.id, playerIds: order });
  const res = p.ok('confirmAdvancement', { eventId: id, stageId: d.stages[0].id });
  assert.equal(res.detail.stages[1].entries[0].playerId, order[0]);
});

test('決勝の直接出場枠: 予選の参加者は直接出場にできず、枠数を超える進出は止める。直接出場は上位シード', () => {
  const p = ready();
  const id = create(p, { template: 'robin_ko', groupCount: 2, advanceCount: 2 });
  p.ok('addPlayers', { eventId: id, names: names(8) });
  p.ok('addPlayers', { eventId: id, names: ['招待A', '招待B'] });
  let d = detail(p, id);
  const pre = d.stages[0];
  const ko = d.stages[1];
  const invited = d.players.filter((x) => x.name.startsWith('招待')).map((x) => x.id);
  const regular = d.players.filter((x) => !x.name.startsWith('招待'));
  // 予選の割り当て（招待は予選に入れない）
  regular.forEach((pl, i) => p.ok('assignPlayer', { eventId: id, stageId: pre.id, playerId: pl.id, groupId: pre.groups[i % 2].id }));
  p.ok('setEntrants', { eventId: id, stageId: ko.id, entrants: invited.map((pid) => ({ playerId: pid, direct: true })) });
  // 予選の参加者を直接出場にはできない
  assert.equal(p.call('setEntrants', { eventId: id, stageId: ko.id, entrants: [{ playerId: regular[0].id, direct: true }] }).error.code, 'VALIDATION');
  d = detail(p, id);
  p.ok('updateStage', { stageId: ko.id, rev: d.stages[1].rev, maxEntrants: 5 });
  p.ok('generateMatches', { eventId: id, stageId: pre.id });
  playStage(p, id, pre.id, pickByName(true));
  // 直接 2 + 進出 4 = 6 > 枠 5
  const over = p.call('confirmAdvancement', { eventId: id, stageId: pre.id });
  assert.equal(over.error.code, 'VALIDATION');
  assert.match(over.error.message, /枠は 5 人/);
  d = detail(p, id);
  p.ok('updateStage', { stageId: ko.id, rev: d.stages[1].rev, maxEntrants: 6 });
  d = p.ok('confirmAdvancement', { eventId: id, stageId: pre.id }).detail;
  const entries = d.stages[1].entries.slice().sort((a, b) => a.seed - b.seed);
  assert.deepEqual(entries.slice(0, 2).map((e) => e.playerId).sort(), invited.slice().sort());
  assert.ok(entries.slice(0, 2).every((e) => e.direct));
  // 取り消しても直接出場は残る
  d = p.ok('undoAdvancement', { eventId: id, stageId: pre.id }).detail;
  assert.deepEqual(d.stages[1].entries.map((e) => e.playerId).sort(), invited.slice().sort());
});

/* ---------- シングルエリミネーションの上級設定 ---------- */

test('勝ち抜き戦: 5/6/7/9/17 人で試合数は n-1（3 位決定戦は +1）。Bye 同士の試合や 1 人だけの 3 位決定戦は作らない', () => {
  const plan = fn('planSingleElimination_');
  for (const n of [2, 3, 5, 6, 7, 9, 17]) {
    const ids = names(n);
    const r = plain(plan(ids, { thirdPlace: true }));
    const real = r.matches;
    const expectThird = n >= 4 ? 1 : 0;
    assert.equal(real.length, n - 1 + expectThird, `n=${n}`);
    real.forEach((m) => assert.ok(m.round !== 1 || m.label === '3位決定戦' || (m.p1 && m.p2), `n=${n} ${m.key}`));
    // 3 人: 3 位決定戦は作らない（準決勝の片方が Bye）
    if (n === 3) assert.ok(!real.some((m) => m.label === '3位決定戦'));
  }
});

test('途中回戦から出場するシード: 12 人で上位 4 人が 2 回戦から。空き枠がない設定は理由付きで拒否', () => {
  const p = ready();
  const id = create(p, { template: 'elimination' });
  p.ok('addPlayers', { eventId: id, names: names(12) });
  let d = detail(p, id);
  const st = d.stages[0];
  const entrants = d.players.map((pl, i) => ({ playerId: pl.id, startRound: i < 4 ? 2 : 1 }));
  p.ok('setEntrants', { eventId: id, stageId: st.id, entrants });
  d = p.ok('generateBracket', { eventId: id, stageId: st.id }).detail;
  const r1 = d.stages[0].rounds[0].matches;
  assert.equal(r1.length, 4);
  const late = new Set(entrants.filter((e) => e.startRound === 2).map((e) => e.playerId));
  r1.forEach((m) => assert.ok(!late.has(m.p1.id) && !late.has(m.p2.id)));
  assert.ok(d.stages[0].entrants.filter((e) => e.startRound === 2).length === 4);
  // 14 人で上位 4 人が 2 回戦から: シード 3・4 の 1 回戦の相手枠が空かないので拒否
  const id2 = create(p, { template: 'elimination' });
  p.ok('addPlayers', { eventId: id2, names: names(14) });
  d = detail(p, id2);
  p.ok('setEntrants', { eventId: id2, stageId: d.stages[0].id, entrants: d.players.map((pl, i) => ({ playerId: pl.id, startRound: i < 4 ? 2 : 1 })) });
  const pv = p.ok('previewBracket', { eventId: id2, stageId: d.stages[0].id });
  assert.equal(pv.ok, false);
  assert.match(pv.problems.join(), /2 回戦から出場させるには/);
  assert.equal(p.call('generateBracket', { eventId: id2, stageId: d.stages[0].id }).error.code, 'VALIDATION');
});

test('回戦ごとの抽選: 回戦が終わってから主催者が抽選し、結果は保存される（読み直しで変わらない）。始まる前だけやり直せる', () => {
  const p = ready();
  const id = create(p, { template: 'elimination', thirdPlace: true });
  p.ok('addPlayers', { eventId: id, names: names(8) });
  let d = detail(p, id);
  const st = d.stages[0];
  p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
  d = p.ok('updateStage', { stageId: st.id, rev: d.stages[0].rev, drawMode: 'redraw', fixedRounds: 0 }).detail;
  d = p.ok('generateBracket', { eventId: id, stageId: st.id }).detail;
  assert.equal(d.stages[0].rounds.length, 1);
  const r1 = d.stages[0].rounds[0].matches;
  assert.equal(r1.length, 4);
  // 読み直しても同じ
  assert.deepEqual(detail(p, id).stages[0].rounds[0].matches.map((m) => [m.p1.id, m.p2.id]), r1.map((m) => [m.p1.id, m.p2.id]));
  // 1 回戦が終わる前は次の回戦を抽選できない
  assert.equal(p.call('drawNextRound', { eventId: id, stageId: st.id }).error.code, 'LOCKED');
  // 始まっていなければ 1 回戦の抽選をやり直せる（履歴に前の抽選を残す）
  d = p.ok('drawNextRound', { eventId: id, stageId: st.id, redo: true }).detail;
  assert.ok(d.history.some((h) => h.action === 'bracket.redraw'));
  playStage(p, id, st.id, pickByName(true));
  d = p.ok('drawNextRound', { eventId: id, stageId: st.id }).detail;
  assert.equal(d.stages[0].rounds[1].matches.length, 2);
  assert.equal(d.stages[0].rounds[1].label, '準決勝');
  const first = d.stages[0].rounds[1].matches[0];
  p.ok('saveMatchResult', { matchId: first.id, rev: first.rev, status: 'final', p1Legs: 2, p2Legs: 0 });
  // 試合が始まった回戦の抽選はやり直せない
  assert.equal(p.call('drawNextRound', { eventId: id, stageId: st.id, redo: true }).error.code, 'LOCKED');
  playStage(p, id, st.id, pickByName(true));
  d = p.ok('drawNextRound', { eventId: id, stageId: st.id }).detail;
  const last = d.stages[0].rounds[2].matches;
  assert.deepEqual(last.map((m) => m.label).sort(), ['3位決定戦', '決勝']);
  playStage(p, id, st.id, pickByName(true));
  d = detail(p, id);
  assert.ok(d.stages[0].champion);
  assert.equal(d.event.status, 'finished');
});

test('回戦ごとの抽選: 途中回戦のシードを入れて各回戦の人数が奇数になる設定は理由付きで拒否', () => {
  const sched = fn('redrawSchedule_');
  const es = (n, late) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, seed: i + 1, startRound: i < late.count ? late.round : 1 }));
  assert.deepEqual(plain(sched(es(8, { count: 0, round: 1 }), 0)).problems, []);
  // 12 人のうち 4 人が 2 回戦から: 1 回戦 8 人 → 2 回戦 4 + 4 = 8 人 → 4 → 2
  assert.deepEqual(plain(sched(es(12, { count: 4, round: 2 }), 0)).rounds.map((r) => r.players), [8, 8, 4, 2]);
  // 10 人のうち 2 人が 2 回戦から: 8 → 4 + 2 = 6 → 3（奇数）
  assert.match(plain(sched(es(10, { count: 2, round: 2 }), 0)).problems.join(), /奇数/);
});

/* ---------- ダブルエリミネーション ---------- */

function runDoubleElimination(n, grandFinal, chooserFactory) {
  const p = ready();
  const id = create(p, { template: 'double_elimination', grandFinal });
  p.ok('addPlayers', { eventId: id, names: names(n) });
  let d = detail(p, id);
  const st = d.stages[0];
  p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
  d = p.ok('generateBracket', { eventId: id, stageId: st.id }).detail;
  const played = playStage(p, id, st.id, chooserFactory());
  d = detail(p, id);
  return { p, id, d, st: d.stages[0], played };
}

test('ダブルエリミ: 2/3/5/8 人で、実際の試合数は 2N-2（リセットの決勝を行えば 2N-1）。負けは 2 回まで・同じ選手が二重に進まない', () => {
  for (const n of [2, 3, 5, 8]) {
    for (let seed = 1; seed <= 6; seed++) {
      const r = rng(seed * 31 + n);
      const { st, played, d } = runDoubleElimination(n, 'reset', () => () => (r() < 0.5 ? 1 : 2));
      const finals = allMatches(st).filter((m) => m.status === 'final');
      assert.equal(finals.length, played);
      const reset = allMatches(st).find((m) => m.label === 'グランドファイナル（リセット）');
      const resetPlayed = reset && reset.status === 'final';
      assert.equal(played, 2 * n - 2 + (resetPlayed ? 1 : 0), `n=${n} seed=${seed}`);
      // 各選手の負けの数: 優勝者は 0〜1、それ以外は 2（リセットなしの GF 例外はない設定）
      const losses = {};
      finals.forEach((m) => {
        const loser = m.winnerId === m.p1.id ? m.p2.id : m.p1.id;
        losses[loser] = (losses[loser] || 0) + 1;
      });
      assert.ok(st.champion, `n=${n} champion`);
      d.players.forEach((pl) => {
        const l = losses[pl.id] || 0;
        if (pl.id === st.champion.id) assert.ok(l <= 1, `champion losses n=${n}`);
        else assert.equal(l, 2, `${pl.name} losses n=${n} seed=${seed}`);
      });
      assert.equal(d.event.status, 'finished');
    }
  }
});

test('ダブルエリミ: 勝者側の優勝者が勝てばリセットなし、敗者側の優勝者が勝てばリセットの決勝。1 試合のみの設定ではリセットしない', () => {
  // 名前の番号が小さい方が必ず勝つ → 勝者側の 01 が無敗で優勝（リセットは「実施なし」）
  const a = runDoubleElimination(4, 'reset', () => pickByName(true));
  const resetA = allMatches(a.st).find((m) => m.label === 'グランドファイナル（リセット）');
  assert.equal(resetA.status, 'void');
  assert.equal(a.played, 2 * 4 - 2);
  assert.equal(a.st.champion.name, '選手01');
  // グランドファイナルだけ敗者側が勝つ → リセットの決勝
  const b = runDoubleElimination(4, 'reset', () => (m) => (m.label === 'グランドファイナル' ? 2 : m.p1.name < m.p2.name ? 1 : 2));
  const resetB = allMatches(b.st).find((m) => m.label === 'グランドファイナル（リセット）');
  assert.equal(resetB.status, 'final');
  assert.equal(b.played, 2 * 4 - 1);
  // 1 試合のみ: GF で敗者側が勝てば優勝（勝者側の選手は 1 敗で敗退する例外）
  const c = runDoubleElimination(4, 'single', () => (m) => (m.label === 'グランドファイナル' ? 2 : m.p1.name < m.p2.name ? 1 : 2));
  assert.ok(!allMatches(c.st).some((m) => m.label === 'グランドファイナル（リセット）'));
  assert.equal(c.played, 2 * 4 - 2);
  assert.notEqual(c.st.champion.name, '選手01');
});

test('ダブルエリミ: 訂正は次の試合が始まっていたら止める（進行中の対戦を壊さない）', () => {
  const p = ready();
  const id = create(p, { template: 'double_elimination' });
  p.ok('addPlayers', { eventId: id, names: names(4) });
  let d = detail(p, id);
  const st = d.stages[0];
  p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
  d = p.ok('generateBracket', { eventId: id, stageId: st.id }).detail;
  const w1 = allMatches(d.stages[0]).filter((m) => m.side === 'W' && m.round === 1);
  w1.forEach((m) => p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 }));
  d = detail(p, id);
  const l1 = allMatches(d.stages[0]).find((m) => m.side === 'L' && m.round === 1);
  assert.ok(l1.p1.id && l1.p2.id, '勝者側 1 回戦の敗者が敗者側へ');
  p.ok('saveMatchResult', { matchId: l1.id, rev: l1.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  const m0 = allMatches(detail(p, id).stages[0]).find((m) => m.id === w1[0].id);
  const res = p.call('saveMatchResult', { matchId: m0.id, rev: m0.rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.error.code, 'LOCKED');
});

/* ---------- スイス式 ---------- */

test('スイス式: 7 人 4 回戦。再戦なし・同じ回に二重出場なし・不戦は同じ人に 2 回与えない。Buchholz は不戦を 0 として数える', () => {
  const p = ready();
  const id = create(p, { template: 'swiss', swissRounds: 4, playoff: 0 });
  p.ok('addPlayers', { eventId: id, names: names(7) });
  let d = detail(p, id);
  const st = d.stages[0];
  assert.equal(st.type, 'swiss');
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  assert.equal(p.call('generateMatches', { eventId: id, stageId: st.id }).error.code, 'BAD_REQUEST');
  const r = rng(7);
  for (let round = 1; round <= 4; round++) {
    const res = p.ok('generateSwissRound', { eventId: id, stageId: st.id });
    assert.equal(res.round, round);
    assert.ok(res.bye, '奇数人数なので不戦');
    playStage(p, id, st.id, () => (r() < 0.5 ? 1 : 2));
  }
  assert.equal(p.call('generateSwissRound', { eventId: id, stageId: st.id }).error.code, 'LOCKED');
  d = detail(p, id);
  const g = d.stages[0].groups[0];
  const seen = new Set();
  const byes = {};
  const perRound = {};
  g.matches.forEach((m) => {
    perRound[m.round] = perRound[m.round] || new Set();
    [m.p1.id, m.p2.id].filter(Boolean).forEach((pid) => {
      assert.ok(!perRound[m.round].has(pid), '同じ回に二重出場');
      perRound[m.round].add(pid);
    });
    if (m.resultType === 'bye') {
      byes[m.p1.id] = (byes[m.p1.id] || 0) + 1;
      return;
    }
    const key = [m.p1.id, m.p2.id].sort().join('|');
    assert.ok(!seen.has(key), '再戦');
    seen.add(key);
  });
  Object.values(byes).forEach((c) => assert.equal(c, 1));
  assert.equal(Object.keys(byes).length, 4);
  // Buchholz = 実際に対戦した相手の勝ち点の合計（不戦は含まない）
  const pts = {};
  g.standings.forEach((row) => (pts[row.playerId] = row.points));
  g.standings.forEach((row) => {
    const opps = g.matches.filter((m) => m.resultType !== 'bye' && (m.p1.id === row.playerId || m.p2.id === row.playerId)).map((m) => (m.p1.id === row.playerId ? m.p2.id : m.p1.id));
    assert.equal(row.buchholz, opps.reduce((s, o) => s + pts[o], 0));
  });
  assert.deepEqual(d.stages[0].tiebreakers, ['points', 'buchholz', 'leg_diff', 'legs_for']);
  assert.equal(d.event.status, 'finished');
});

test('スイス式: 後の回戦を組んだら前の回戦は訂正できない。最新の回戦を削除すれば訂正できる。組めない条件は理由を記録する', () => {
  const p = ready();
  const id = create(p, { template: 'swiss', swissRounds: 3, playoff: 0 });
  p.ok('addPlayers', { eventId: id, names: names(4) });
  let d = detail(p, id);
  const st = d.stages[0];
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  p.ok('generateSwissRound', { eventId: id, stageId: st.id });
  playStage(p, id, st.id, pickByName(true));
  d = p.ok('generateSwissRound', { eventId: id, stageId: st.id }).detail;
  const r1 = d.stages[0].groups[0].matches.find((m) => m.round === 1);
  assert.equal(p.call('saveMatchResult', { matchId: r1.id, rev: r1.rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true }).error.code, 'LOCKED');
  d = p.ok('deleteSwissRound', { eventId: id, stageId: st.id }).detail;
  const r1b = d.stages[0].groups[0].matches.find((m) => m.id === r1.id);
  p.ok('saveMatchResult', { matchId: r1b.id, rev: r1b.rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  // 4 人 3 回戦は再戦なしで組める（総当たりと同じ）。4 回戦目は組めない設定にはできない（回戦数の上限は見積もりで警告）
  p.ok('generateSwissRound', { eventId: id, stageId: st.id });
  playStage(p, id, st.id, pickByName(true));
  const res = p.ok('generateSwissRound', { eventId: id, stageId: st.id });
  assert.equal(res.round, 3);
  d = res.detail;
  assert.ok(Array.isArray(d.stages[0].swiss.log));
  // 純粋な関数: 4 人で全員と対戦済みなら「不可能」として再戦を許す（探索の打ち切りとは区別）
  const pair = fn('swissPairRound_');
  const full = (id2, others) => ({ id: id2, points: 0, byes: 0, opponents: Object.fromEntries(others.map((o) => [o, 1])) });
  const out = plain(pair([full('a', ['b', 'c', 'd']), full('b', ['a', 'c', 'd']), full('c', ['a', 'b', 'd']), full('d', ['a', 'b', 'c'])], {}));
  assert.equal(out.relaxed[0].rule, 'rematch');
  assert.equal(out.relaxed[0].reason, 'impossible');
  assert.equal(out.rematches.length, 2);
  const timeout = plain(pair([full('a', ['b', 'c', 'd']), full('b', ['a', 'c', 'd']), full('c', ['a', 'b', 'd']), full('d', ['a', 'b', 'c'])], { budget: 1 }));
  assert.equal(timeout.relaxed[0].reason, 'timeout');
});

/* ---------- ポイントシリーズ ---------- */

test('ポイントシリーズ: 各節の得点は到達順位の総点（二重加算しない）。中止の節は点なし。全節が終わるまで終了しない。上位 4 人のプレーオフは 1 対 4・2 対 3', () => {
  const p = ready();
  const id = create(p, { template: 'series_playoff', nights: 3, playoff: 4, nightPoints: [5, 3, 2, 0] });
  p.ok('addPlayers', { eventId: id, names: names(8) });
  let d = detail(p, id);
  const st = d.stages[0];
  assert.equal(st.type, 'series');
  assert.equal(st.nights.length, 3);
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  // 1 節目: 番号の小さい方が勝つ
  p.ok('generateNight', { eventId: id, groupId: st.nights[0].id });
  playStage(p, id, st.id, pickByName(true));
  d = detail(p, id);
  let s = d.stages[0];
  assert.equal(s.nights[0].status, 'complete');
  const champ = s.nights[0].champion.id;
  const row = s.standings.find((r) => r.playerId === champ);
  assert.equal(row.points, 5, '優勝は 5 点（5+3+2 にしない）');
  assert.deepEqual(s.nights[0].results.map((x) => x.points).sort((a, b) => b - a), [5, 3, 2, 2, 0, 0, 0, 0]);
  assert.equal(d.event.status === 'finished', false, '未実施の節がある');
  // 2 節目は中止、3 節目を行う
  p.ok('cancelNight', { eventId: id, groupId: s.nights[1].id, rev: s.nights[1].rev, reason: '会場の都合' });
  p.ok('generateNight', { eventId: id, groupId: s.nights[2].id });
  playStage(p, id, st.id, pickByName(false));
  d = detail(p, id);
  s = d.stages[0];
  assert.equal(s.nights[1].status, 'cancelled');
  assert.equal(s.complete, true);
  const total = s.standings.reduce((sum, r) => sum + r.points, 0);
  assert.equal(total, 2 * (5 + 3 + 2 + 2), '2 節分（中止の節は 0）');
  assert.ok(s.standings.every((r) => r.nights.length === 3 && r.nights[1] === null));
  // 訂正した節から累計を計算し直す
  const finalMatch = s.nights[0].rounds.at(-1).matches[0];
  d = p.ok('saveMatchResult', { matchId: finalMatch.id, rev: finalMatch.rev, status: 'final', p1Legs: finalMatch.winnerId === finalMatch.p1.id ? 1 : 2, p2Legs: finalMatch.winnerId === finalMatch.p1.id ? 2 : 1, correction: true }).detail;
  const newChamp = d.stages[0].nights[0].champion.id;
  assert.notEqual(newChamp, champ);
  // プレーオフ（累計が並んでいれば、主催者が手で順位を決めるまで進めない）
  const tieTry = p.call('confirmAdvancement', { eventId: id, stageId: st.id });
  if (tieTry.ok) {
    d = tieTry.data.detail;
  } else {
    assert.equal(tieTry.error.code, 'TIE');
    const order = detail(p, id).stages[0].standings.map((r) => r.playerId);
    p.ok('setManualOrder', { eventId: id, stageId: st.id, playerIds: order });
    d = p.ok('confirmAdvancement', { eventId: id, stageId: st.id }).detail;
  }
  const po = d.stages[1];
  assert.equal(po.entries.length, 4);
  d = p.ok('generateBracket', { eventId: id, stageId: po.id }).detail;
  const semis = d.stages[1].rounds[0].matches;
  const seedOf = {};
  d.stages[1].entries.forEach((e) => (seedOf[e.playerId] = e.seed));
  assert.deepEqual(semis.map((m) => [seedOf[m.p1.id], seedOf[m.p2.id]].sort()), [[1, 4], [2, 3]]);
});

test('ポイントシリーズ: 16 節を保存・表示できる（段階の数とは別に数える）', () => {
  const p = ready();
  const id = create(p, { template: 'series_playoff', nights: 16, playoff: 4 });
  const d = detail(p, id);
  assert.equal(d.stages.length, 2);
  assert.equal(d.stages[0].nights.length, 16);
  assert.equal(d.stages[0].nights[15].name, '第16節');
  assert.equal(d.stages[0].planned, 16);
});

/* ---------- 複数段階ロビン ---------- */

test('複数段階ロビン: 予選の上位を 2 次ロビンの複数の組へ配り（同じ予選の組どうしを分ける）、2 次ロビンの上位が決勝へ。成績は持ち越さない', () => {
  const p = ready();
  const id = create(p, { template: 'multi_robin_ko', groupCount: 4, advanceCount: 2, groupCount2: 2, advanceCount2: 2 });
  p.ok('addPlayers', { eventId: id, names: names(16) });
  let d = detail(p, id);
  assert.deepEqual(d.stages.map((s) => s.type), ['round_robin', 'round_robin', 'single_elimination']);
  const [r1, r2, fin] = d.stages;
  p.ok('autoAssign', { eventId: id, stageId: r1.id });
  p.ok('generateMatches', { eventId: id, stageId: r1.id });
  playStage(p, id, r1.id, pickByName(true));
  d = p.ok('confirmAdvancement', { eventId: id, stageId: r1.id }).detail;
  const second = d.stages[1];
  assert.deepEqual(second.groups.map((g) => g.players.length), [4, 4]);
  const srcGroup = {};
  d.stages[0].groups.forEach((g) => g.players.forEach((pl) => (srcGroup[pl.id] = g.id)));
  second.groups.forEach((g) => {
    const srcs = g.players.map((pl) => srcGroup[pl.id]);
    assert.equal(new Set(srcs).size, srcs.length, '同じ予選の組の選手は別の組へ');
  });
  assert.ok(second.entries.every((e) => /位$/.test(e.source)), '進出元のラベル');
  p.ok('generateMatches', { eventId: id, stageId: r2.id });
  d = detail(p, id);
  assert.ok(d.stages[1].groups.every((g) => g.standings.every((r) => r.won === 0 && r.played === 0)), '成績を持ち越さない');
  playStage(p, id, r2.id, pickByName(true));
  d = p.ok('confirmAdvancement', { eventId: id, stageId: r2.id }).detail;
  assert.equal(d.stages[2].entries.length, 4);
  void fin;
});

/* ---------- リーグ: ディビジョン・勝ち点・引き分け ---------- */

test('リーグ: 複数ディビジョンの成績を混ぜない。固定 Leg 数で引き分け、勝 2・分 1・負 0 と手動の加減点（理由付き）', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: 'リーグ', template: 'league', divisions: 2, rule: { format: 'fixed', bestOf: 4 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(6) });
  let d = detail(p, id);
  const st = d.stages[0];
  assert.deepEqual(st.groups.map((g) => g.name), ['ディビジョン1', 'ディビジョン2']);
  assert.deepEqual(st.points, { win: 2, draw: 1, loss: 0 });
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  d = p.ok('generateMatches', { eventId: id, stageId: st.id }).detail;
  const g1 = d.stages[0].groups[0];
  const [m1, m2, m3] = g1.matches;
  // 固定 4 Legs: 2-2 は引き分け、3-1 は勝ち。合計 4 でなければ確定できない
  assert.equal(p.call('saveMatchResult', { matchId: m1.id, rev: m1.rev, status: 'final', p1Legs: 2, p2Legs: 1 }).error.code, 'VALIDATION');
  p.ok('saveMatchResult', { matchId: m1.id, rev: m1.rev, status: 'final', p1Legs: 2, p2Legs: 2 });
  p.ok('saveMatchResult', { matchId: m2.id, rev: m2.rev, status: 'final', p1Legs: 3, p2Legs: 1 });
  p.ok('saveMatchResult', { matchId: m3.id, rev: m3.rev, status: 'final', p1Legs: 0, p2Legs: 4 });
  d = detail(p, id);
  const g = d.stages[0].groups[0];
  const drawMatch = g.matches.find((m) => m.id === m1.id);
  assert.equal(drawMatch.draw, true);
  assert.equal(drawMatch.winnerId, null);
  const totalPoints = g.standings.reduce((s, r) => s + r.points, 0);
  assert.equal(totalPoints, 1 + 1 + 2 + 2, '引き分け 1+1・勝ち 2 × 2');
  // ディビジョン 2 の選手の成績は 0 のまま（混ぜない）
  assert.ok(d.stages[0].groups[1].standings.every((r) => r.played === 0));
  // 加減点: 理由が必要
  const target = g.standings[0].playerId;
  assert.equal(p.call('updateStage', { stageId: st.id, rev: d.stages[0].rev, adjustments: [{ playerId: target, points: -1, reason: '' }] }).error.code, 'VALIDATION');
  d = p.ok('updateStage', { stageId: st.id, rev: d.stages[0].rev, adjustments: [{ playerId: target, points: -1, reason: '遅刻' }] }).detail;
  const after = d.stages[0].groups[0].standings.find((r) => r.playerId === target);
  assert.equal(after.adjustment, -1);
  // 勝ち抜き戦の段階に固定 Leg 数は使えない
  assert.equal(p.call('createEvent', { name: 'x', template: 'league_playoff', rule: { format: 'fixed', bestOf: 4 } }).error.code, 'VALIDATION');
});

test('既存の段階（v0.7 までの設定）には勝ち点を付けず、従来の順位（勝数 → Leg 差 → 直接対決 → 得 Leg）のまま', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: '旧形式', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  const d = detail(p, id);
  assert.deepEqual(d.stages[0].tiebreakers, ['wins', 'leg_diff', 'head_to_head', 'legs_for']);
  assert.equal(d.stages[0].points, undefined);
  assert.equal(d.stages[0].config.points, null);
});
