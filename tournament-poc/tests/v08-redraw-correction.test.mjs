// 回戦ごとの抽選（drawMode=redraw）の結果の訂正: 抽選済みの後の回戦と矛盾する勝者の変更・確定の取り消しをサーバー側で止める。
// 後の試合が未開始なら勝者（と 3 位決定戦の敗者）を差し替え、始まっていれば拒否する（固定の表と同じ規則）。
// 拒否した操作では、結果・対戦カード・公開データを変えない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

const names = (n) => Array.from({ length: n }, (_, i) => 'P' + (i + 1));
const all = (st) => st.rounds.flatMap((r) => r.matches);
const detail = (p, id) => p.ok('eventDetail', { eventId: id });
const stage = (p, id) => detail(p, id).stages[0];
const byId = (p, id, mid) => all(stage(p, id)).find((m) => m.id === mid);

/** p1 / p2 側を勝たせて確定（Best of 3） */
function win(p, m, side, correction) {
  return p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: side === 1 ? 2 : 0, p2Legs: side === 2 ? 2 : 0, correction: !!correction });
}

function setup(p, { players = 4, thirdPlace = false, fixedRounds = 0, drawMode = 'redraw' } = {}) {
  const id = p.ok('createEvent', { name: '抽選', template: 'elimination', thirdPlace, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(players) });
  let d = detail(p, id);
  const st = d.stages[0];
  p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
  d = detail(p, id);
  p.ok('updateStage', { stageId: st.id, rev: d.stages[0].rev, drawMode, fixedRounds });
  p.ok('generateBracket', { eventId: id, stageId: st.id });
  const ev = detail(p, id).event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' });
  return { id, stageId: st.id };
}

/** 回戦の試合をすべて p1 の勝ちで確定する */
function playRound(p, id, round) {
  all(stage(p, id))
    .filter((m) => m.round === round && m.status === 'scheduled' && m.p1.id && m.p2.id)
    .forEach((m) => assert.equal(win(p, m, 1).ok, true));
}

function snapshot(p, id) {
  p.clock.advance(21000);
  return JSON.stringify(p.viewer.run('getPublicSnapshot', { eventId: id }).data);
}

/** 操作が LOCKED で拒否され、シート（結果・対戦カード）と公開データが変わらないこと */
function assertRejectedWithoutChange(p, id, run, pattern) {
  const sheets = p.store.dump();
  const pub = snapshot(p, id);
  const res = run();
  assert.equal(res.ok, false, '拒否されるはず');
  assert.equal(res.error.code, 'LOCKED');
  assert.match(res.error.message, pattern);
  assert.equal(p.store.dump(), sheets, 'シートを変えない');
  assert.equal(snapshot(p, id), pub, '公開データを変えない');
}

test('4 名・回戦ごとの抽選: 決勝が確定・進行中のときは、準決勝の勝者の変更と確定の取り消しを拒否し、何も変えない（報告の再現手順）', () => {
  const p = ready();
  const { id, stageId } = setup(p);
  playRound(p, id, 1);
  p.ok('drawNextRound', { eventId: id, stageId });
  const fin = all(stage(p, id)).find((m) => m.round === 2);
  const semi = all(stage(p, id)).find((m) => m.round === 1 && (m.winnerId === fin.p1.id || m.winnerId === fin.p2.id));
  // 決勝が進行中（1-0）
  p.ok('saveMatchResult', { matchId: fin.id, rev: fin.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  let s = byId(p, id, semi.id);
  assertRejectedWithoutChange(p, id, () => win(p, s, s.winnerId === s.p1.id ? 2 : 1, true), /後の試合（決勝）が始まっている/);
  // 決勝が確定
  const live = byId(p, id, fin.id);
  assert.equal(p.call('saveMatchResult', { matchId: live.id, rev: live.rev, status: 'final', p1Legs: 2, p2Legs: 0, correction: false }).ok, true);
  s = byId(p, id, semi.id);
  assertRejectedWithoutChange(p, id, () => win(p, s, s.winnerId === s.p1.id ? 2 : 1, true), /後の試合（決勝）が始まっている/);
  // 確定の取り消し（未開始・進行中に戻す）も拒否
  assertRejectedWithoutChange(p, id, () => p.call('saveMatchResult', { matchId: s.id, rev: s.rev, status: 'scheduled', p1Legs: 0, p2Legs: 0, correction: true }), /確定は取り消せません/);
  assertRejectedWithoutChange(p, id, () => p.call('saveMatchResult', { matchId: s.id, rev: s.rev, status: 'live', p1Legs: 1, p2Legs: 0, correction: true }), /確定は取り消せません/);
  // 勝者を変えない訂正（同じ勝者で Leg 数だけ直す）はできる
  const sameSide = s.winnerId === s.p1.id ? 1 : 2;
  const fix = p.call('saveMatchResult', { matchId: s.id, rev: s.rev, status: 'final', p1Legs: sameSide === 1 ? 2 : 1, p2Legs: sameSide === 2 ? 2 : 1, correction: true });
  assert.equal(fix.ok, true);
  assert.equal(byId(p, id, semi.id).winnerId, s.winnerId);
});

test('4 名・回戦ごとの抽選: 決勝（と 3 位決定戦）が未開始なら、準決勝の勝者の変更で決勝の勝者・3 位決定戦の敗者を差し替える。取り消しは拒否', () => {
  const p = ready();
  const { id, stageId } = setup(p, { thirdPlace: true });
  playRound(p, id, 1);
  p.ok('drawNextRound', { eventId: id, stageId });
  let r2 = all(stage(p, id)).filter((m) => m.round === 2);
  assert.deepEqual(r2.map((m) => m.label).sort(), ['3位決定戦', '決勝']);
  const s = all(stage(p, id)).find((m) => m.round === 1);
  const oldWinner = s.winnerId;
  const newWinner = s.winnerId === s.p1.id ? s.p2.id : s.p1.id;
  // 取り消しは拒否（後の回戦の枠が決まらないため）
  assertRejectedWithoutChange(p, id, () => p.call('saveMatchResult', { matchId: s.id, rev: s.rev, status: 'scheduled', p1Legs: 0, p2Legs: 0, correction: true }), /確定は取り消せません/);
  // 勝者の変更: 決勝の旧勝者 → 新勝者、3 位決定戦の旧敗者（= 新勝者）→ 旧勝者
  assert.equal(win(p, s, s.winnerId === s.p1.id ? 2 : 1, true).ok, true);
  r2 = all(stage(p, id)).filter((m) => m.round === 2);
  const fin = r2.find((m) => m.label === '決勝');
  const third = r2.find((m) => m.label === '3位決定戦');
  const ids = (m) => [m.p1.id, m.p2.id];
  assert.ok(ids(fin).includes(newWinner) && !ids(fin).includes(oldWinner), '決勝に新しい勝者');
  assert.ok(ids(third).includes(oldWinner) && !ids(third).includes(newWinner), '3 位決定戦に新しい敗者');
  // 4 人がちょうど 1 回ずつ（同じ選手が二重に入らない）
  assert.equal(new Set([...ids(fin), ...ids(third)]).size, 4);
  // 公開データにも反映
  const pub = JSON.parse(snapshot(p, id));
  const pubFinal = pub.stages[0].rounds.flatMap((r) => r.matches).find((m) => m.id === fin.id);
  assert.ok([pubFinal.p1.id, pubFinal.p2.id].includes(newWinner));
  // 3 位決定戦が始まったら、準決勝の勝者は変えられない（敗者が入っているため）
  const t = byId(p, id, third.id);
  p.ok('saveMatchResult', { matchId: t.id, rev: t.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  const s2 = byId(p, id, s.id);
  assertRejectedWithoutChange(p, id, () => win(p, s2, s2.winnerId === s2.p1.id ? 2 : 1, true), /後の試合（3位決定戦）が始まっている/);
});

test('固定の表は従来どおり: 決勝が未開始なら準決勝の訂正で決勝の枠が入れ替わり、始まっていれば拒否する', () => {
  const p = ready();
  const { id } = setup(p, { drawMode: 'fixed' });
  playRound(p, id, 1);
  const s = all(stage(p, id)).find((m) => m.round === 1);
  const newWinner = s.winnerId === s.p1.id ? s.p2.id : s.p1.id;
  assert.equal(win(p, s, s.winnerId === s.p1.id ? 2 : 1, true).ok, true);
  const fin = all(stage(p, id)).find((m) => m.round === 2);
  assert.ok([fin.p1.id, fin.p2.id].includes(newWinner));
  p.ok('saveMatchResult', { matchId: fin.id, rev: fin.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  const s2 = byId(p, id, s.id);
  assertRejectedWithoutChange(p, id, () => win(p, s2, s2.winnerId === s2.p1.id ? 2 : 1, true), /次の試合（決勝）が始まっている/);
});

test('固定の回戦 → 回戦ごとの抽選（8 名・1 回戦は固定）: 抽選した 2 回戦が未開始なら差し替え、始まっていれば拒否。固定の回戦どうしは従来のつながりで伝わる', () => {
  // fixedRounds=1: 1 回戦は固定の表、2 回戦から抽選
  let p = ready();
  let ctx = setup(p, { players: 8, fixedRounds: 1 });
  playRound(p, ctx.id, 1);
  p.ok('drawNextRound', { eventId: ctx.id, stageId: ctx.stageId });
  let r1 = all(stage(p, ctx.id)).filter((m) => m.round === 1);
  const s = r1[0];
  const newWinner = s.winnerId === s.p1.id ? s.p2.id : s.p1.id;
  assert.equal(win(p, s, s.winnerId === s.p1.id ? 2 : 1, true).ok, true);
  const r2 = all(stage(p, ctx.id)).filter((m) => m.round === 2);
  const holder = r2.find((m) => m.p1.id === newWinner || m.p2.id === newWinner);
  assert.ok(holder, '2 回戦に新しい勝者');
  assert.equal(r2.flatMap((m) => [m.p1.id, m.p2.id]).filter((x) => x === s.winnerId).length, 0, '旧勝者は 2 回戦にいない');
  p.ok('saveMatchResult', { matchId: holder.id, rev: holder.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  const s2 = byId(p, ctx.id, s.id);
  assertRejectedWithoutChange(p, ctx.id, () => win(p, s2, s2.winnerId === s2.p1.id ? 2 : 1, true), /後の試合（準決勝）が始まっている/);

  // fixedRounds=2: 1・2 回戦は固定（1 回戦 → 2 回戦は従来のつながり）、3 回戦（決勝）から抽選
  p = ready();
  ctx = setup(p, { players: 8, fixedRounds: 2 });
  playRound(p, ctx.id, 1);
  r1 = all(stage(p, ctx.id)).filter((m) => m.round === 1);
  const a = r1[0];
  const aNew = a.winnerId === a.p1.id ? a.p2.id : a.p1.id;
  assert.equal(win(p, a, a.winnerId === a.p1.id ? 2 : 1, true).ok, true);
  assert.ok(all(stage(p, ctx.id)).filter((m) => m.round === 2).some((m) => m.p1.id === aNew || m.p2.id === aNew), '固定のつながりで 2 回戦へ');
  playRound(p, ctx.id, 2);
  p.ok('drawNextRound', { eventId: ctx.id, stageId: ctx.stageId });
  const fin = all(stage(p, ctx.id)).find((m) => m.round === 3);
  assert.equal(win(p, fin, 1).ok, true);
  const semi = all(stage(p, ctx.id)).find((m) => m.round === 2);
  assertRejectedWithoutChange(p, ctx.id, () => win(p, semi, semi.winnerId === semi.p1.id ? 2 : 1, true), /後の試合（決勝）が始まっている/);
  // 2 回戦が確定済みなので、1 回戦の訂正も（固定のつながりで）止まる
  const a2 = byId(p, ctx.id, a.id);
  assertRejectedWithoutChange(p, ctx.id, () => win(p, a2, a2.winnerId === a2.p1.id ? 2 : 1, true), /始まっているため変更できません/);
});
