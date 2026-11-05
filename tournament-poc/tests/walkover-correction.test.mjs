// 監査 PR-19（C-014）: 棄権・失格した選手の分の不戦勝（自動の不戦勝・棄権の処理で付いた不戦勝）がある勝ち抜き戦で、
// その前の試合を訂正できなかった（次の試合が「始まっている」扱いで LOCKED。未開始に戻しても、保存の後に自動の不戦勝がもう一度かかる）。
// 利用者の決定: 前の試合の訂正で、その不戦勝を取り消し、訂正後の選手との未開始の試合に戻す。
// - 取り消すのは「棄権・失格した選手の負けで、Leg・セットの記録がない不戦勝・失格」だけ。実際に始まった試合は従来どおり保護する
// - 不戦勝で進んだ先の試合が始まっていれば、従来どおり拒否する（何も変えない）
// - 取り消した後、新しい組み合わせにも棄権者がいれば、自動の不戦勝がもう一度かかる（勝者側が入れ替わった場合など）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const names = (n) => Array.from({ length: n }, (_, i) => `選手${String(i + 1).padStart(2, '0')}`);

function bracket(n, opts = {}) {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'KO', template: opts.template || 'elimination', grandFinal: opts.grandFinal, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(n) });
  let d = p.ok('eventDetail', { eventId: id });
  const sid = d.stages[0].id;
  if (opts.redraw) p.ok('updateStage', { stageId: sid, rev: d.stages[0].rev, drawMode: 'redraw', fixedRounds: 0 });
  p.ok('setEntrants', { eventId: id, stageId: sid, playerIds: d.players.map((x) => x.id) });
  p.ok('generateBracket', { eventId: id, stageId: sid });
  return { p, id, sid };
}

const stage = (w) => w.p.ok('eventDetail', { eventId: w.id }).stages[0];
const detail = (w) => w.p.ok('eventDetail', { eventId: w.id });
const round = (w, r) => stage(w).rounds[r].matches;
const find = (w, mid) => stage(w).rounds.flatMap((r) => r.matches).find((m) => m.id === mid);

function win(w, m, side, correction = false) {
  return w.p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: side === 1 ? 2 : 0, p2Legs: side === 1 ? 0 : 2, correction });
}

function withdraw(w, pid) {
  const pl = detail(w).players.find((x) => x.id === pid);
  w.p.ok('withdrawPlayer', { eventId: w.id, playerId: pl.id, rev: pl.rev, kind: 'withdrawn', reason: '体調不良' });
}

/** 試合の表の状態（比較用） */
const snapshot = (w) => JSON.stringify(stage(w).rounds.map((r) => r.matches.map((m) => [m.id, m.rev, m.status, m.p1.id, m.p2.id, m.winnerId, m.resultType])));

test('4 人: 準決勝の勝者が棄権 → 決勝は相手の自動の不戦勝。準決勝を訂正すると不戦勝を取り消し、訂正後の勝者との未開始の決勝に戻す', () => {
  const w = bracket(4);
  const [s1, s2] = round(w, 0);
  win(w, s1, 1);
  withdraw(w, s1.p1.id);
  win(w, round(w, 0)[1], 1);
  let final = round(w, 1)[0];
  assert.equal(final.status, 'final');
  assert.equal(final.resultType, 'walkover');
  assert.equal(final.winnerId, s2.p1.id);
  const res = w.p.call('saveMatchResult', { matchId: s1.id, rev: round(w, 0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  final = round(w, 1)[0];
  assert.equal(final.status, 'scheduled');
  assert.equal(final.resultType || '', '');
  assert.equal(final.winnerId || '', '');
  assert.deepEqual([final.p1.id, final.p2.id].sort(), [s1.p2.id, s2.p1.id].sort(), '訂正後の勝者と相手の未開始の試合');
  assert.equal(detail(w).stages[0].champion, null, '優勝者は未定に戻る');
  assert.ok(detail(w).history.some((h) => h.action === 'match.walkoverUndone'), '取り消しを履歴に残す');
  // 決勝はふつうに入力できる
  win(w, final, 1);
  assert.equal(round(w, 1)[0].status, 'final');
});

test('勝者側が入れ替わる訂正: 決勝の不戦勝（棄権者の負け）の勝者を訂正後の選手に替え、不戦勝のまま', () => {
  const w = bracket(4);
  const [s1, s2] = round(w, 0);
  win(w, s1, 1);
  win(w, s2, 1);
  withdraw(w, s2.p1.id); // 決勝: s1.p1 の不戦勝
  assert.equal(round(w, 1)[0].winnerId, s1.p1.id);
  const res = w.p.call('saveMatchResult', { matchId: s1.id, rev: round(w, 0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const final = round(w, 1)[0];
  assert.equal(final.status, 'final');
  assert.equal(final.resultType, 'walkover');
  assert.equal(final.winnerId, s1.p2.id, '訂正後の勝者が棄権者に不戦勝');
  assert.equal(detail(w).stages[0].champion.id, s1.p2.id);
});

test('不戦勝で進んだ先の試合が始まっていれば、従来どおり拒否して何も変えない。進んだ先を未開始に戻せば訂正できる', () => {
  const w = bracket(8);
  const qf = round(w, 0);
  qf.forEach((m) => win(w, m, 1));
  withdraw(w, qf[0].p1.id); // 準決勝 1: qf[1] の勝者の不戦勝
  const sf = round(w, 1);
  assert.equal(sf[0].resultType, 'walkover');
  win(w, sf[1], 1);
  const final = round(w, 2)[0];
  win(w, final, 1); // 決勝を確定（実際に始まった試合）
  const before = snapshot(w);
  const res = w.p.call('saveMatchResult', { matchId: qf[0].id, rev: round(w, 0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'LOCKED');
  assert.equal(snapshot(w), before, '拒否したときは何も変えない');
  // 決勝を未開始に戻すと、訂正できる（準決勝 1 の不戦勝を取り消し、決勝の枠も空く）
  const f = round(w, 2)[0];
  w.p.ok('saveMatchResult', { matchId: f.id, rev: f.rev, status: 'scheduled', p1Legs: 0, p2Legs: 0, correction: true });
  const ok = w.p.call('saveMatchResult', { matchId: qf[0].id, rev: round(w, 0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const sf1 = round(w, 1)[0];
  assert.equal(sf1.status, 'scheduled');
  assert.deepEqual([sf1.p1.id, sf1.p2.id].sort(), [qf[0].p2.id, qf[1].p1.id].sort());
  const f2 = round(w, 2)[0];
  assert.ok(f2.p1.id !== qf[1].p1.id && f2.p2.id !== qf[1].p1.id, '不戦勝で進んだ選手は決勝の枠から外れる');
});

test('棄権と関係なく実際に始まった次の試合は、従来どおり訂正を拒否する', () => {
  const w = bracket(4);
  const [s1, s2] = round(w, 0);
  win(w, s1, 1);
  win(w, s2, 1);
  win(w, round(w, 1)[0], 1);
  const before = snapshot(w);
  const res = w.p.call('saveMatchResult', { matchId: s1.id, rev: round(w, 0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.error.code, 'LOCKED');
  assert.equal(snapshot(w), before);
});

test('棄権者が途中まで戦った試合（途中棄権・Leg の記録あり）は取り消さず、従来どおり拒否する', () => {
  const w = bracket(4);
  const [s1, s2] = round(w, 0);
  win(w, s1, 1);
  win(w, s2, 1);
  const f = round(w, 1)[0];
  const side = f.p1.id === s1.p1.id ? 1 : 2;
  w.p.ok('saveMatchResult', { matchId: f.id, rev: f.rev, status: 'final', resultType: 'retired', winnerSide: side === 1 ? 2 : 1, note: '体調', p1Legs: 1, p2Legs: 0 });
  const before = snapshot(w);
  const res = w.p.call('saveMatchResult', { matchId: s1.id, rev: round(w, 0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.error.code, 'LOCKED');
  assert.equal(snapshot(w), before);
});

test('棄権からの復帰: 復帰した選手の不戦勝の試合は、その試合の訂正で未開始に戻せ、自動の不戦勝はもうかからない', () => {
  const w = bracket(4);
  const [s1, s2] = round(w, 0);
  win(w, s1, 1);
  withdraw(w, s1.p1.id);
  win(w, round(w, 0)[1], 1);
  const pl = detail(w).players.find((x) => x.id === s1.p1.id);
  w.p.ok('reinstatePlayer', { eventId: w.id, playerId: pl.id, rev: pl.rev });
  let f = round(w, 1)[0];
  assert.equal(f.resultType, 'walkover', '復帰しても処理済みの結果は戻さない（従来どおり）');
  w.p.ok('saveMatchResult', { matchId: f.id, rev: f.rev, status: 'scheduled', p1Legs: 0, p2Legs: 0, correction: true });
  f = round(w, 1)[0];
  assert.equal(f.status, 'scheduled');
  assert.deepEqual([f.p1.id, f.p2.id].sort(), [s1.p1.id, s2.p1.id].sort());
});

test('ダブルエリミ 4 人: 勝者側 1 回戦の勝者が棄権 → 勝者側決勝・敗者側の不戦勝。勝者側 1 回戦を訂正すると、勝者側決勝の不戦勝を取り消し、敗者側には棄権者が入って相手の不戦勝になる', () => {
  const w = bracket(4, { template: 'double_elimination', grandFinal: 'single' });
  const wb = (r) => stage(w).sides[0].rounds[r].matches;
  const [a, b] = wb(0);
  win(w, a, 1);
  withdraw(w, a.p1.id);
  win(w, wb(0)[1], 1);
  assert.equal(wb(1)[0].resultType, 'walkover');
  const res = w.p.call('saveMatchResult', { matchId: a.id, rev: wb(0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const wf = wb(1)[0];
  assert.equal(wf.status, 'scheduled');
  assert.deepEqual([wf.p1.id, wf.p2.id].sort(), [a.p2.id, b.p1.id].sort());
  const lbMatches = stage(w).sides[1].rounds.flatMap((r) => r.matches);
  const withX = lbMatches.filter((m) => m.p1.id === a.p1.id || m.p2.id === a.p1.id);
  assert.ok(withX.length >= 1, '棄権者は敗者側に入る');
  assert.ok(withX.every((m) => m.status !== 'final' || m.winnerId !== a.p1.id), '棄権者は勝ち上がらない');
});

test('回戦ごとの抽選: 後の回戦をまだ抽選していなければ、不戦勝を取り消して訂正できる', () => {
  const w = bracket(4, { redraw: true });
  const [s1, s2] = round(w, 0);
  win(w, s1, 1);
  win(w, s2, 1);
  w.p.ok('drawNextRound', { eventId: w.id, stageId: w.sid });
  withdraw(w, s1.p1.id); // 決勝: s2.p1 の不戦勝
  assert.equal(round(w, 1)[0].resultType, 'walkover');
  const res = w.p.call('saveMatchResult', { matchId: s1.id, rev: round(w, 0)[0].rev, status: 'final', p1Legs: 0, p2Legs: 2, correction: true });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const f = round(w, 1)[0];
  assert.equal(f.status, 'scheduled');
  assert.deepEqual([f.p1.id, f.p2.id].sort(), [s1.p2.id, s2.p1.id].sort());
});

test('回戦ごとの抽選: 不戦勝の勝者を後の回戦に抽選で入れた後は、どの枠を空けるか決まらないので従来どおり拒否する', () => {
  const w = bracket(8, { redraw: true });
  round(w, 0).forEach((m) => win(w, m, 1));
  w.p.ok('drawNextRound', { eventId: w.id, stageId: w.sid });
  const qf = round(w, 0);
  const sf = round(w, 1);
  const x = sf[0].p1.id; // 準決勝 1 の選手が棄権 → 相手の不戦勝
  withdraw(w, x);
  win(w, round(w, 1)[1], 1);
  w.p.ok('drawNextRound', { eventId: w.id, stageId: w.sid });
  const q = qf.find((m) => m.winnerId === x);
  const before = snapshot(w);
  const res = w.p.call('saveMatchResult', { matchId: q.id, rev: round(w, 0).find((m) => m.id === q.id).rev, status: 'final', p1Legs: q.p1.id === x ? 0 : 2, p2Legs: q.p1.id === x ? 2 : 0, correction: true });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'LOCKED');
  assert.equal(snapshot(w), before);
});
