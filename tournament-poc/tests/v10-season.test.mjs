// v1.0: 期制リーグ（1 期目の全員総当たり → 人数に応じたディビジョン → 昇降格・入替戦 → 次期の作成・訂正の照合）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const SUB = { alice: '200000000000000000001', bob: '200000000000000000002', carol: '200000000000000000003' };

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  const as = (name) => p.loginAs(name + '@gmail.com', { sub: SUB[name] });
  return { ...p, as };
}

const people = (n, prefix = '選手') => Array.from({ length: n }, (_, i) => ({ name: prefix + String(i + 1).padStart(2, '0') }));

function matchesOf(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.pairs) return st.pairs.map((x) => x.match).filter(Boolean);
  return [];
}

/**
 * 段階の未開始の試合をまとめて確定する。win(m) が true なら 1 番目の選手の勝ち（既定: 名前の小さい方の勝ち = 名前順が成績順）
 */
function playAll(p, id, stageIndex, win = (m) => m.p1.name < m.p2.name, auth) {
  for (let guard = 0; guard < 200; guard++) {
    const st = p.ok('eventDetail', { eventId: id }, { auth }).stages[stageIndex];
    const open = matchesOf(st).filter((m) => m.status === 'scheduled' && m.p1.id && m.p2.id);
    if (!open.length) return;
    p.ok('saveMatchResults', {
      eventId: id,
      results: open.slice(0, 60).map((m) => {
        const need = Math.floor(m.bestOf / 2) + 1;
        return win(m) ? { matchId: m.id, rev: m.rev, p1Legs: need, p2Legs: need - 1 } : { matchId: m.id, rev: m.rev, p1Legs: need - 1, p2Legs: need };
      }),
    }, { auth });
  }
  throw new Error('終わらない');
}

/** 期制リーグを作り、1 期目に n 人を登録して対戦カードを作る */
function season1(p, n, opts = {}, auth) {
  const id = p.ok('createSeasonLeague', { name: opts.name || '水曜リーグ', thresholds: opts.thresholds || [], targets: opts.targets, capacities: opts.capacities, cycles: opts.cycles || 1, rule: { format: 'legs', bestOf: 5 } }, { auth }).eventId;
  p.ok('importPlayers', { eventId: id, players: people(n, opts.prefix) }, { auth });
  const d = p.ok('eventDetail', { eventId: id }, { auth });
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id }, { auth });
  p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id }, { auth });
  return id;
}

function next(p, id, edits = {}, auth) {
  const pv = p.ok('previewNextSeason', { eventId: id, edits }, { auth });
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
  return p.ok('confirmNextSeason', { eventId: id, edits, planVersion: pv.planVersion }, { auth });
}

function rowsByName(pv) {
  const out = {};
  pv.rows.forEach((r) => (out[r.name] = r));
  return out;
}

/** 次期の大会の各ディビジョンの選手名（順位表の並び） */
function divisionsOf(p, id, auth) {
  const d = p.ok('eventDetail', { eventId: id }, { auth });
  const nameOf = {};
  d.players.forEach((x) => (nameOf[x.id] = x.name));
  return d.stages[0].groups.map((g) => g.players.map((x) => nameOf[x.id]));
}

/* ---------- 1 期目 → 2 期目 ---------- */

test('1 期目: 全員 1 つのリーグで総当たり（1 回・2 回）。人数の境目は主催者の設定だけで決まり、「何位なので、どのディビジョンか」を表示する', () => {
  const p = ready();
  const id = season1(p, 12, { thresholds: [8, 16] });
  let d = p.ok('eventDetail', { eventId: id });
  assert.equal(d.stages.length, 1);
  assert.equal(d.stages[0].type, 'league');
  assert.equal(d.stages[0].groups.length, 1);
  assert.equal(d.stages[0].groups[0].matches.length, 66, '12 人の 1 回総当たり');
  assert.equal(d.season.seasonNo, 1);
  assert.deepEqual(d.season.league.config.thresholds, [8, 16]);
  // 全試合が確定するまでは確定できない（プレビューは見られる）
  let pv = p.ok('previewNextSeason', { eventId: id });
  assert.equal(pv.ok, false);
  assert.match(pv.problems.join(), /全試合が確定していません/);
  assert.equal(p.call('confirmNextSeason', { eventId: id, planVersion: pv.planVersion }).error.code, 'VALIDATION');
  playAll(p, id, 0);
  pv = p.ok('previewNextSeason', { eventId: id });
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
  assert.equal(pv.divisionCount, 2, '12 人 ≥ 8 人で 2 部制（16 人未満なので 3 部制ではない）');
  assert.deepEqual(pv.divisions.map((x) => [x.name, x.size]), [['1部', 6], ['2部', 6]]);
  const rows = rowsByName(pv);
  assert.equal(rows['選手06'].newDivision, 1);
  assert.equal(rows['選手07'].newDivision, 2);
  assert.match(rows['選手06'].reasons[0], /1期目 6位のため 1部（1〜6位が 1部）/);
  assert.match(rows['選手07'].reasons[0], /1期目 7位のため 2部（7〜12位が 2部）/);
  // 確定する前は、次期の所属はどこにも書かれていない
  assert.equal(p.ok('eventDetail', { eventId: id }).season.next, null);
  const c = p.ok('confirmNextSeason', { eventId: id, planVersion: pv.planVersion });
  assert.deepEqual(divisionsOf(p, c.eventId), [['選手01', '選手02', '選手03', '選手04', '選手05', '選手06'], ['選手07', '選手08', '選手09', '選手10', '選手11', '選手12']]);
  d = p.ok('eventDetail', { eventId: c.eventId });
  assert.equal(d.event.name, '水曜リーグ 第2期');
  assert.equal(d.season.seasonNo, 2);
  assert.equal(d.stages[1].type, 'promotion');
  assert.deepEqual(d.stages[1].pairs.map((x) => x.name), ['1部・2部 入替戦']);
  assert.equal(d.event.status, 'draft');
  assert.equal(d.event.isPublic, false, '次期は非公開で作る（主催者が公開する）');
  // 会員 ID は期をまたいで同じ（名前ではなく ID で対応）
  const prev = p.ok('eventDetail', { eventId: id }).season.members;
  const now = d.season.members;
  assert.equal(new Set(prev.map((x) => x.memberId)).size, 12);
  assert.deepEqual(now.map((x) => x.memberId).sort(), prev.map((x) => x.memberId).sort());
  assert.ok(prev.every((x) => /^LMB-/.test(x.memberId)));
});

test('1 期目の 2 回総当たり。総当たりの回数は 1 回・2 回だけ（3 回は受け付けない）', () => {
  const p = ready();
  const id = season1(p, 6, { cycles: 2 });
  assert.equal(p.ok('eventDetail', { eventId: id }).stages[0].groups[0].matches.length, 30);
  assert.equal(p.call('createSeasonLeague', { name: 'x', cycles: 3 }).ok, true, '3 は 1 回として扱う（既存の作成と同じ）');
  const d = p.ok('eventDetail', { eventId: id });
  assert.equal(p.call('updateLeagueSettings', { eventId: id, rev: d.season.league.rev, cycles: 3 }).error.code, 'VALIDATION');
  assert.equal(p.call('updateStage', { stageId: d.stages[0].id, rev: d.stages[0].rev, cycles: 3 }).error.code, 'VALIDATION');
});

test('少人数: 境目に届かなければ 1 ディビジョンのまま。昇降格・入替戦は作らない', () => {
  const p = ready();
  const id = season1(p, 6, { thresholds: [10] });
  playAll(p, id, 0);
  const c = next(p, id);
  const d = p.ok('eventDetail', { eventId: c.eventId });
  assert.equal(d.stages.length, 1, '入替戦の段階を作らない');
  assert.equal(d.stages[0].groups[0].name, 'リーグ');
  p.ok('generateMatches', { eventId: c.eventId, stageId: d.stages[0].id });
  playAll(p, c.eventId, 0);
  assert.equal(p.call('generatePlayoffs', { eventId: c.eventId }).error.code, 'VALIDATION');
  const pv = p.ok('previewNextSeason', { eventId: c.eventId });
  assert.equal(pv.ok, true);
  assert.ok(pv.rows.every((r) => r.movement === 'rank'));
  // 境目を設定しない期制リーグは、人数によらず 1 ディビジョン（アプリが勝手に境目を決めない）
  const q = ready();
  const big = season1(q, 30, { thresholds: [] });
  playAll(q, big, 0);
  assert.equal(q.ok('previewNextSeason', { eventId: big }).divisionCount, 1);
});

/* ---------- 昇降格・入替戦 ---------- */

/** 2 部制の 2 期目まで進め、リーグを全試合確定させた状態 */
function twoDivisions(p, n = 12, opts = {}) {
  const id1 = season1(p, n, { thresholds: [8], ...opts });
  playAll(p, id1, 0);
  const id2 = next(p, id1).eventId;
  const d = p.ok('eventDetail', { eventId: id2 });
  p.ok('generateMatches', { eventId: id2, stageId: d.stages[0].id });
  playAll(p, id2, 0);
  return { id1, id2 };
}

test('入替戦: A の下から 2 位 vs B の 2 位。B 側が勝てば入れ替わり、B の 1 位は自動昇格・A の最下位は自動降格', () => {
  const p = ready();
  const { id2 } = twoDivisions(p);
  // 組む前は「入替戦がまだ」で確定できない
  let pv = p.ok('previewNextSeason', { eventId: id2 });
  assert.match(pv.problems.join(), /入替戦がまだ組まれていません/);
  assert.equal(p.ok('generatePlayoffs', { eventId: id2 }).created, 1);
  let d = p.ok('eventDetail', { eventId: id2 });
  const pair = d.stages[1].pairs[0];
  assert.deepEqual(pair.players.map((x) => x.name + ':' + x.source), ['選手05:1部 5位', '選手08:2部 2位']);
  assert.equal(p.call('generatePlayoffs', { eventId: id2 }).error.code, 'LOCKED', '同じ入替戦を二重に組まない');
  // 結果待ち
  pv = p.ok('previewNextSeason', { eventId: id2 });
  assert.match(pv.problems.join(), /入替戦の結果が確定していません/);
  // 引き分けは確定できない
  const m = pair.match;
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 2 }).error.code, 'VALIDATION');
  // B 側（2 部 2 位）の勝ち
  p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 1, p2Legs: 3 });
  pv = p.ok('previewNextSeason', { eventId: id2 });
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
  const rows = rowsByName(pv);
  assert.equal(rows['選手06'].movement, 'auto_relegate');
  assert.equal(rows['選手07'].movement, 'auto_promote');
  assert.equal(rows['選手05'].movement, 'playoff_lose_relegate');
  assert.equal(rows['選手08'].movement, 'playoff_win_promote');
  assert.equal(rows['選手01'].movement, 'stay');
  assert.deepEqual(pv.playoffs.map((x) => x.state), ['final']);
  const c = p.ok('confirmNextSeason', { eventId: id2, planVersion: pv.planVersion });
  assert.deepEqual(divisionsOf(p, c.eventId), [['選手01', '選手02', '選手03', '選手04', '選手07', '選手08'], ['選手05', '選手06', '選手09', '選手10', '選手11', '選手12']]);
  // 確定の記録（前期の所属・順位・昇降格・新しい所属・理由）を次期の運営画面で追える
  d = p.ok('eventDetail', { eventId: c.eventId });
  const rec = d.season.plan.rows.find((r) => r.name === '選手08');
  assert.deepEqual([rec.from.divisionName, rec.from.rank, rec.movement, rec.newDivision], ['2部', 2, 'playoff_win_promote', 1]);
  assert.ok(d.season.plan.playoffs[0].confirmedAt, '入替戦の確定時刻');
  assert.ok(d.season.plan.confirmedAt);
});

test('入替戦: A 側が勝てば両者とも残留（B の 1 位の自動昇格・A の最下位の自動降格はそのまま）', () => {
  const p = ready();
  const { id2 } = twoDivisions(p);
  p.ok('generatePlayoffs', { eventId: id2 });
  playAll(p, id2, 1, () => true);
  const pv = p.ok('previewNextSeason', { eventId: id2 });
  const rows = rowsByName(pv);
  assert.equal(rows['選手05'].movement, 'playoff_win_stay');
  assert.equal(rows['選手08'].movement, 'playoff_lose_stay');
  assert.equal(rows['選手05'].newDivision, 1);
  assert.equal(rows['選手08'].newDivision, 2);
  assert.equal(rows['選手06'].newDivision, 2);
  assert.equal(rows['選手07'].newDivision, 1);
});

test('3 部制: 中間のディビジョンは上下の入替戦が重ならない人数（4 人以上）が必要。足りなければ確定させず、主催者に変更を求める', () => {
  const p = ready();
  // 12 人・3 部制（目標人数 4・4、残り 4）
  const id1 = season1(p, 12, { thresholds: [6, 12], targets: [4, 4] });
  playAll(p, id1, 0);
  let pv = p.ok('previewNextSeason', { eventId: id1 });
  assert.deepEqual(pv.divisions.map((x) => x.size), [4, 4, 4]);
  assert.equal(pv.ok, true);
  // 中間の 2 部を 3 人にする目標人数は、確定させない（2 位が上側・下側の入替戦の両方になる）
  const d1 = p.ok('eventDetail', { eventId: id1 });
  p.ok('updateLeagueSettings', { eventId: id1, rev: d1.season.league.rev, targets: [5, 3] });
  pv = p.ok('previewNextSeason', { eventId: id1 });
  assert.equal(pv.ok, false);
  assert.match(pv.problems.join(), /2部 は 3 人です。.*4 人以上が必要/);
  assert.equal(p.call('confirmNextSeason', { eventId: id1, planVersion: pv.planVersion }).error.code, 'VALIDATION');
  // 手動で人数を直せば確定できる（理由は必須）
  const target = pv.rows.find((r) => r.newDivision === 1 && r.ladder === 5);
  const moves = [{ key: target.key, division: 2, reason: '' }];
  pv = p.ok('previewNextSeason', { eventId: id1, edits: { moves } });
  assert.match(pv.problems.join(), /理由を入力/);
  moves[0].reason = '本人の希望';
  pv = p.ok('previewNextSeason', { eventId: id1, edits: { moves } });
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
  const id2 = p.ok('confirmNextSeason', { eventId: id1, edits: { moves }, planVersion: pv.planVersion }).eventId;
  const div = divisionsOf(p, id2);
  assert.deepEqual(div.map((x) => x.length), [4, 4, 4]);
  // 3 部制の入替戦は 2 組（1部・2部、2部・3部）。中間の 2 部は上側が 1 位・2 位、下側が 3 位・4 位
  const d2 = p.ok('eventDetail', { eventId: id2 });
  p.ok('generateMatches', { eventId: id2, stageId: d2.stages[0].id });
  playAll(p, id2, 0);
  p.ok('generatePlayoffs', { eventId: id2 });
  const pairs = p.ok('eventDetail', { eventId: id2 }).stages[1].pairs;
  assert.deepEqual(pairs.map((x) => x.players.map((y) => y.source)), [['1部 3位', '2部 2位'], ['2部 3位', '3部 2位']]);
  playAll(p, id2, 1, () => false);
  const pv2 = p.ok('previewNextSeason', { eventId: id2 });
  const kinds = pv2.rows.filter((r) => r.from.divisionName === '2部').map((r) => r.movement);
  assert.deepEqual(kinds, ['auto_promote', 'playoff_win_promote', 'playoff_lose_relegate', 'auto_relegate']);
});

test('同順位: 1 期目の順位がディビジョンの境目にかかったら、主催者が順位を決めるまで確定しない（名前順で決めない）', () => {
  const p = ready();
  const id = season1(p, 8, { thresholds: [8] });
  // 全員 0 勝で引き分け（固定 Leg がないので、全試合を 1 番目の選手の勝ちにして循環させる）: 4 人の勝数が同じになるように
  const d = p.ok('eventDetail', { eventId: id });
  const ms = d.stages[0].groups[0].matches;
  // 選手01〜03 は全勝・残り 5 人は 選手04〜08 の間で循環（勝数がそろう）
  const top = new Set(['選手01', '選手02', '選手03']);
  const order = ['選手04', '選手05', '選手06', '選手07', '選手08'];
  const beats = (a, b) => {
    if (top.has(a) && top.has(b)) return a < b;
    if (top.has(a)) return true;
    if (top.has(b)) return false;
    const i = order.indexOf(a);
    const j = order.indexOf(b);
    return (j - i + 5) % 5 === 1 || (j - i + 5) % 5 === 2;
  };
  p.ok('saveMatchResults', { eventId: id, results: ms.map((m) => (beats(m.p1.name, m.p2.name) ? { matchId: m.id, rev: m.rev, p1Legs: 3, p2Legs: 0 } : { matchId: m.id, rev: m.rev, p1Legs: 0, p2Legs: 3 })) });
  let pv = p.ok('previewNextSeason', { eventId: id });
  assert.equal(pv.ok, false);
  assert.match(pv.problems.join(), /同順位が、次期の 1部 と 2部 の境目にかかります/);
  // 主催者が同順位の選手の順番を決めると確定できる
  const g = p.ok('eventDetail', { eventId: id }).stages[0].groups[0];
  const tied = g.standings.filter((s) => s.tied).map((s) => s.playerId);
  assert.equal(tied.length, 5);
  p.ok('setManualOrder', { eventId: id, groupId: g.id, playerIds: tied });
  pv = p.ok('previewNextSeason', { eventId: id });
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
});

test('同順位: 2 期目で昇格・入替戦の対象が同順位なら、入替戦を組まない・次期を確定しない', () => {
  const p = ready();
  const id1 = season1(p, 8, { thresholds: [8] });
  playAll(p, id1, 0);
  const id2 = next(p, id1).eventId;
  const d = p.ok('eventDetail', { eventId: id2 });
  p.ok('generateMatches', { eventId: id2, stageId: d.stages[0].id });
  // 2 部（選手05〜08）: 05・06・07 が循環（05>06>07>05）で 2 勝 1 敗・得失 Leg も同じ、3 人とも 08 に勝つ → 1〜3 位が同順位
  const det = p.ok('eventDetail', { eventId: id2 });
  const g2 = det.stages[0].groups[1];
  const pairWin = { '選手05|選手06': true, '選手06|選手07': true, '選手05|選手07': false, '選手05|選手08': true, '選手06|選手08': true, '選手07|選手08': true };
  const res = g2.matches.map((m) => {
    const k = [m.p1.name, m.p2.name].sort().join('|');
    const p1Wins = pairWin[k] === (m.p1.name < m.p2.name);
    return p1Wins ? { matchId: m.id, rev: m.rev, p1Legs: 3, p2Legs: 0 } : { matchId: m.id, rev: m.rev, p1Legs: 0, p2Legs: 3 };
  });
  p.ok('saveMatchResults', { eventId: id2, results: res });
  playAll(p, id2, 0);
  const g = p.ok('eventDetail', { eventId: id2 }).stages[0].groups[1];
  assert.ok(g.standings[0].tied && g.standings[1].tied && g.standings[2].tied, '2 部の 1〜3 位が同順位: ' + JSON.stringify(g.standings));
  assert.equal(p.call('generatePlayoffs', { eventId: id2 }).error.code, 'TIE');
  assert.match(p.ok('previewNextSeason', { eventId: id2 }).problems.join(), /2部 の 1位が同順位/);
});

test('人数の増減: 増えて境目を超えれば増設、減れば統合。所属が変わる理由（増設・統合・欠員の繰り上げ）を表示する', () => {
  const p = ready();
  const { id2 } = twoDivisions(p, 12, { thresholds: [8, 16] });
  p.ok('generatePlayoffs', { eventId: id2 });
  playAll(p, id2, 1, () => true);
  // 増設: 新規 5 人で 17 人 ≥ 16 人 → 3 部制
  const join = people(5, '新人').map((x) => ({ name: x.name }));
  let pv = p.ok('previewNextSeason', { eventId: id2, edits: { join } });
  assert.equal(pv.divisionCount, 3);
  assert.deepEqual(pv.divisions.map((x) => x.size), [5, 6, 6], '端数は下の部へ');
  const rows = rowsByName(pv);
  assert.match(rows['新人01'].reasons.join(), /新規参加のため最下位の 3部/);
  assert.equal(rows['選手05'].newDivision, 1, '入替戦に勝って残留');
  assert.ok(Object.values(rows).some((r) => r.reasons.join().includes('ディビジョン増設（次期 17 人 → 3 部制）')));
  // 統合: 5 人が不参加で 7 人 < 8 人 → 1 部制
  const prevRows = p.ok('previewNextSeason', { eventId: id2 }).rows;
  const leave = prevRows.filter((r) => ['選手09', '選手10', '選手11', '選手12', '選手02'].includes(r.name)).map((r) => r.key);
  pv = p.ok('previewNextSeason', { eventId: id2, edits: { leave } });
  assert.equal(pv.divisionCount, 1);
  assert.ok(pv.rows.filter((r) => r.movement !== 'leave').every((r) => r.reasons.join().includes('ディビジョン統合')), JSON.stringify(pv.rows.map((r) => r.reasons)));
  assert.equal(pv.rows.filter((r) => r.movement === 'leave').length, 5);
  // 欠員の繰り上げ: 1 部から 2 人抜けると、2 部の上位が 1 部へ（目標人数 6）
  const d2 = p.ok('eventDetail', { eventId: id2 });
  p.ok('updateLeagueSettings', { eventId: id2, rev: d2.season.league.rev, targets: [6] });
  const leave2 = prevRows.filter((r) => ['選手01', '選手02'].includes(r.name)).map((r) => r.key);
  pv = p.ok('previewNextSeason', { eventId: id2, edits: { leave: leave2 } });
  assert.equal(pv.divisionCount, 2);
  const r2 = rowsByName(pv);
  assert.equal(r2['選手06'].newDivision, 1, '自動降格の選手が欠員で繰り上がる');
  assert.match(r2['選手06'].reasons.join(), /人数調整（目標人数・欠員）のため 1部 へ繰り上げ/);
});

test('参加・脱退・再参加: 会員 ID は名前に依らず、脱退した人を後の期で復帰させても同じ ID。表示名の変更・同姓同名も扱える', () => {
  const p = ready();
  const id1 = season1(p, 6);
  playAll(p, id1, 0);
  let pv = p.ok('previewNextSeason', { eventId: id1 });
  const yamada = pv.rows.find((r) => r.name === '選手03');
  const c2 = p.ok('confirmNextSeason', { eventId: id1, edits: { leave: [yamada.key] }, planVersion: p.ok('previewNextSeason', { eventId: id1, edits: { leave: [yamada.key] } }).planVersion });
  let d2 = p.ok('eventDetail', { eventId: c2.eventId });
  assert.equal(d2.players.length, 5);
  assert.deepEqual(d2.season.otherMembers.map((x) => [x.name, x.status]), [['選手03', 'left']]);
  // 2 期目で表示名を変える（同じ会員のまま）。新しく同じ名前の別人（新人）を 3 期目に入れる
  const p1 = d2.players.find((x) => x.name === '選手01');
  p.ok('updatePlayer', { playerId: p1.id, rev: p1.rev, name: '選手01（改名）' });
  p.ok('generateMatches', { eventId: c2.eventId, stageId: d2.stages[0].id });
  playAll(p, c2.eventId, 0);
  pv = p.ok('previewNextSeason', { eventId: c2.eventId, edits: { rejoin: [yamada.key], join: [{ name: '選手03' }] } });
  assert.equal(pv.ok, false);
  assert.match(pv.problems.join(), /同じ表示名「選手03」が 2 人います/);
  const edits = { rejoin: [yamada.key], join: [{ name: '選手03' }], names: [{ key: 'new:1', name: '選手03（新）' }] };
  pv = p.ok('previewNextSeason', { eventId: c2.eventId, edits });
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
  assert.equal(rowsByName(pv)['選手03'].movement, 'return');
  const c3 = p.ok('confirmNextSeason', { eventId: c2.eventId, edits, planVersion: pv.planVersion });
  const d3 = p.ok('eventDetail', { eventId: c3.eventId });
  const m3 = {};
  d3.season.members.forEach((x) => (m3[x.name] = x.memberId));
  assert.equal(m3['選手03'], yamada.key, '復帰した人は以前と同じ会員 ID');
  assert.notEqual(m3['選手03（新）'], yamada.key, '同じ名前の新人は別の会員');
  assert.equal(m3['選手01（改名）'], d2.season.members.find((x) => x.name === '選手01').memberId, '改名しても同じ会員');
});

test('棄権: 入替戦の対象が棄権していれば相手の不戦勝で組み、プレビューで次期の参加を確かめるよう知らせる', () => {
  const p = ready();
  const { id2 } = twoDivisions(p);
  const d = p.ok('eventDetail', { eventId: id2 });
  const p5 = d.players.find((x) => x.name === '選手05');
  p.ok('withdrawPlayer', { playerId: p5.id, rev: p5.rev, kind: 'withdrawn', reason: '転居' });
  p.ok('generatePlayoffs', { eventId: id2 });
  const pair = p.ok('eventDetail', { eventId: id2 }).stages[1].pairs[0];
  assert.equal(pair.match.status, 'final');
  assert.equal(pair.match.resultType, 'walkover');
  assert.equal(pair.match.winnerId, pair.match.p2.id);
  const pv = p.ok('previewNextSeason', { eventId: id2 });
  assert.equal(rowsByName(pv)['選手05'].movement, 'playoff_lose_relegate');
  assert.match(pv.warnings.join(), /選手05 は第2期を棄権しています/);
});

/* ---------- 訂正・再送・権限 ---------- */

test('結果の訂正: 入替戦の後にリーグの結果を直すと対戦者の不一致を示し、組み直せる（始まっていれば止める）', () => {
  const p = ready();
  const { id2 } = twoDivisions(p);
  p.ok('generatePlayoffs', { eventId: id2 });
  // 1 部の 5 位と 4 位が入れ替わるよう、選手04 vs 選手05 の結果を訂正する
  const d = p.ok('eventDetail', { eventId: id2 });
  const m = d.stages[0].groups[0].matches.find((x) => [x.p1.name, x.p2.name].sort().join() === '選手04,選手05');
  const p4First = m.p1.name === '選手04';
  const fix = (extra) => ({ matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: p4First ? 0 : 3, p2Legs: p4First ? 3 : 0, ...extra });
  p.ok('saveMatchResult', fix());
  let pv = p.ok('previewNextSeason', { eventId: id2 });
  const standings = p.ok('eventDetail', { eventId: id2 }).stages[0].groups[0].standings;
  assert.ok(!standings.some((s) => s.tied), '訂正後の 1 部に同順位はない（選手05 が 4 位・選手04 が 5 位）');
  {
    assert.match(pv.problems.join(), /対戦者が今の順位と合いません/);
    assert.equal(p.ok('eventDetail', { eventId: id2 }).season.playoffs.expected[0].matches, false);
    // 結果が入った入替戦は組み直せない
    const pm = p.ok('eventDetail', { eventId: id2 }).stages[1].pairs[0].match;
    p.ok('saveMatchResult', { matchId: pm.id, rev: pm.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
    assert.equal(p.call('generatePlayoffs', { eventId: id2, redo: true }).error.code, 'LOCKED');
    const pm2 = p.ok('eventDetail', { eventId: id2 }).stages[1].pairs[0].match;
    p.ok('saveMatchResult', { matchId: pm2.id, rev: pm2.rev, status: 'scheduled', p1Legs: 0, p2Legs: 0 });
    assert.equal(p.ok('generatePlayoffs', { eventId: id2, redo: true }).created, 1);
    pv = p.ok('previewNextSeason', { eventId: id2 });
    assert.doesNotMatch(pv.problems.join(), /対戦者が今の順位と合いません/);
  }
});

test('次期の作成後に前期の結果を訂正: 次期の所属は黙って変えず不整合を示す。対戦カードがなければ反映でき、試合が始まっていれば記録として承認する', () => {
  const p = ready();
  const id1 = season1(p, 8, { thresholds: [8] });
  playAll(p, id1, 0);
  const id2 = next(p, id1).eventId;
  const before = divisionsOf(p, id2);
  // 1 期目の 選手04 vs 選手05 を訂正して 4 位と 5 位を入れ替える
  const d1 = p.ok('eventDetail', { eventId: id1 });
  const m = d1.stages[0].groups[0].matches.find((x) => [x.p1.name, x.p2.name].sort().join() === '選手04,選手05');
  const p4First = m.p1.name === '選手04';
  p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: p4First ? 0 : 3, p2Legs: p4First ? 3 : 0 });
  assert.deepEqual(divisionsOf(p, id2), before, '次期の所属は黙って書き換えない');
  let d2 = p.ok('eventDetail', { eventId: id2 });
  assert.equal(d2.season.drift.changed, true);
  const names = d2.season.drift.diffs.map((x) => x.name + ':' + x.confirmed + '→' + x.now).sort();
  // 訂正で 選手05 が 4 勝 3 敗（4 位）、選手04 が 3 勝 4 敗（5 位）になり、境目をまたいで入れ替わる
  assert.deepEqual(names, ['選手04:1→2', '選手05:2→1']);
  // 前期の画面にも出る
  assert.equal(p.ok('eventDetail', { eventId: id1 }).season.next.drift.changed, true);
  // 対戦カードがあるディビジョンは反映できない（対戦カードを消せば反映できる）
  p.ok('generateMatches', { eventId: id2, stageId: d2.stages[0].id });
  d2 = p.ok('eventDetail', { eventId: id2 });
  assert.ok(d2.season.drift.diffs.every((x) => !x.canApply && /対戦カードがあります/.test(x.lock)));
  const keys = d2.season.drift.diffs.map((x) => x.key);
  assert.equal(p.call('reconcileNextSeason', { eventId: id2, rev: d2.season.seasonRev, apply: keys, reason: '訂正' }).error.code, 'LOCKED');
  // 試合が始まったら所属は変えられない。記録として承認すると警告は消える（記録は残る）
  const first = d2.stages[0].groups[0].matches[0];
  p.ok('saveMatchResult', { matchId: first.id, rev: first.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  d2 = p.ok('eventDetail', { eventId: id2 });
  assert.match(d2.season.drift.diffs[0].lock, /試合が始まっている/);
  assert.equal(p.call('reconcileNextSeason', { eventId: id2, rev: d2.season.seasonRev, acknowledge: true, reason: '' }).error.code, 'VALIDATION', '理由は必須');
  p.ok('reconcileNextSeason', { eventId: id2, rev: d2.season.seasonRev, acknowledge: true, reason: '開幕後のため今期はこのまま' });
  d2 = p.ok('eventDetail', { eventId: id2 });
  assert.ok(d2.season.drift.acknowledged);
  assert.equal(d2.season.drift.acknowledged.reason, '開幕後のため今期はこのまま');
  assert.equal(d2.season.plan.log.length, 1);
});

test('次期の作成後の訂正を反映: 次期の対戦カードを作る前なら、主催者の操作で所属を直せる（記録に残る）', () => {
  const p = ready();
  const id1 = season1(p, 8, { thresholds: [8] });
  playAll(p, id1, 0);
  const id2 = next(p, id1).eventId;
  const d1 = p.ok('eventDetail', { eventId: id1 });
  // 選手04 が 選手05・06・07・08 すべてに負けたことにする（5 位以下へ）
  const fixes = d1.stages[0].groups[0].matches.filter((x) => {
    const n = [x.p1.name, x.p2.name];
    return n.includes('選手04') && n.some((y) => y > '選手04');
  });
  fixes.forEach((x) => {
    const cur = p.ok('eventDetail', { eventId: id1 }).stages[0].groups[0].matches.find((y) => y.id === x.id);
    const p4First = cur.p1.name === '選手04';
    p.ok('saveMatchResult', { matchId: cur.id, rev: cur.rev, status: 'final', correction: true, p1Legs: p4First ? 0 : 3, p2Legs: p4First ? 3 : 0 });
  });
  let d2 = p.ok('eventDetail', { eventId: id2 });
  const diffs = d2.season.drift.diffs;
  assert.ok(diffs.length >= 2, JSON.stringify(diffs));
  assert.ok(diffs.every((x) => x.canApply));
  p.ok('reconcileNextSeason', { eventId: id2, rev: d2.season.seasonRev, apply: diffs.map((x) => x.key), reason: '1 期目の結果の訂正' });
  d2 = p.ok('eventDetail', { eventId: id2 });
  assert.equal(d2.season.drift.changed, false, '反映後は違いがない');
  assert.ok(divisionsOf(p, id2)[1].includes('選手04'));
  assert.match(d2.season.plan.rows.find((r) => r.name === '選手04').reasons.join(), /前期の訂正を反映して 2部 へ/);
});

test('確定の二重送信・再試行: 同じ requestId の再送も、別の画面・別の requestId の再試行も、次期を 2 つ作らない。古いプレビューでは確定しない', () => {
  const p = ready();
  const id1 = season1(p, 6);
  playAll(p, id1, 0);
  const pv = p.ok('previewNextSeason', { eventId: id1 });
  const count = () => p.store.get().getSheetByName('Events').records().length;
  const n0 = count();
  const a = p.ok('confirmNextSeason', { eventId: id1, planVersion: pv.planVersion }, { requestId: 'confirm-request-000000001' });
  const b = p.ok('confirmNextSeason', { eventId: id1, planVersion: pv.planVersion }, { requestId: 'confirm-request-000000001' });
  assert.equal(b.duplicate, true);
  assert.equal(b.eventId, a.eventId);
  const c = p.ok('confirmNextSeason', { eventId: id1, planVersion: pv.planVersion }, { requestId: 'confirm-request-000000002' });
  assert.equal(c.existing, true);
  assert.equal(c.eventId, a.eventId);
  assert.equal(count(), n0 + 1);
  // 古いプレビュー（その後に結果が変わった）では確定しない
  const q = ready();
  const e1 = season1(q, 6);
  playAll(q, e1, 0);
  const old = q.ok('previewNextSeason', { eventId: e1 });
  const det = q.ok('eventDetail', { eventId: e1 });
  q.ok('updateLeagueSettings', { eventId: e1, rev: det.season.league.rev, thresholds: [4] });
  assert.equal(q.call('confirmNextSeason', { eventId: e1, planVersion: old.planVersion }).error.code, 'CONFLICT');
});

test('次期の作成が途中で止まった跡（期の行だけが残った）は、次の確定で作り直す', () => {
  const p = ready();
  const id1 = season1(p, 6);
  playAll(p, id1, 0);
  const pv = p.ok('previewNextSeason', { eventId: id1 });
  const id2 = p.ok('confirmNextSeason', { eventId: id1, planVersion: pv.planVersion }).eventId;
  // 大会の行だけが書けなかった状態を作る（期の行・選手などは残る）
  const sheet = p.store.get().getSheetByName('Events');
  const rowIndex = sheet.rows.findIndex((r) => r[0] === id2);
  sheet.deleteRows(rowIndex + 1, 1);
  const again = p.ok('confirmNextSeason', { eventId: id1, planVersion: p.ok('previewNextSeason', { eventId: id1 }).planVersion });
  assert.notEqual(again.eventId, id2);
  assert.equal(p.store.get().getSheetByName('Players').records().filter((r) => r.event_id === id2).length, 0, '途中まで書いた行は消す');
  assert.equal(p.store.get().getSheetByName('LeagueSeasons').records().filter((r) => r.event_id === id2).length, 0);
});

test('権限: 次期の作成・設定・照合は主催者と管理者だけ。共同主催者・管理パスワードは入替戦の運営とプレビューまで。他人の大会・会員の ID への差し替えは拒否', () => {
  const p = ready();
  const alice = p.as('alice');
  const bob = p.as('bob');
  const carol = p.as('carol');
  const idA = season1(p, 8, { thresholds: [8] }, alice);
  playAll(p, idA, 0, undefined, alice);
  const idB = season1(p, 6, { name: 'ボブのリーグ' }, bob);
  playAll(p, idB, 0, undefined, bob);
  // 共同主催者（carol）と管理パスワード
  p.ok('addCollaborator', { eventId: idA, email: 'carol@gmail.com' }, { auth: alice });
  p.link(carol);
  let ev = p.ok('eventDetail', { eventId: idA }, { auth: alice }).event;
  p.ok('setStaffPassword', { eventId: idA, rev: ev.rev, password: 'staff-pass-01' }, { auth: alice });
  const staff = p.staffLogin(idA, 'staff-pass-01');
  const pvA = p.ok('previewNextSeason', { eventId: idA }, { auth: carol });
  assert.equal(pvA.canConfirm, false);
  assert.equal(p.ok('previewNextSeason', { eventId: idA }, { auth: staff }).ok, true);
  assert.equal(p.call('confirmNextSeason', { eventId: idA, planVersion: pvA.planVersion }, { auth: carol }).error.code, 'FORBIDDEN');
  assert.equal(p.call('confirmNextSeason', { eventId: idA, planVersion: pvA.planVersion }, { auth: staff }).error.code, 'FORBIDDEN');
  const detA = p.ok('eventDetail', { eventId: idA }, { auth: alice });
  assert.equal(p.call('updateLeagueSettings', { eventId: idA, rev: detA.season.league.rev, thresholds: [4] }, { auth: carol }).error.code, 'FORBIDDEN');
  // 他人の大会は存在を知らせない
  assert.equal(p.call('previewNextSeason', { eventId: idA }, { auth: bob }).error.code, 'NOT_FOUND');
  assert.equal(p.call('confirmNextSeason', { eventId: idA, planVersion: pvA.planVersion }, { auth: bob }).error.code, 'NOT_FOUND');
  assert.equal(p.call('generatePlayoffs', { eventId: idA }, { auth: bob }).error.code, 'NOT_FOUND');
  // 自分の大会の ID に、他人の期制リーグの会員 ID を混ぜても受け付けない
  const aliceMember = detA.season.members[0].memberId;
  const pvB = p.ok('previewNextSeason', { eventId: idB }, { auth: bob });
  for (const edits of [{ leave: [aliceMember] }, { rejoin: [aliceMember] }, { moves: [{ key: aliceMember, division: 1, reason: 'x' }] }]) {
    assert.equal(p.call('previewNextSeason', { eventId: idB, edits }, { auth: bob }).error.code, 'NOT_FOUND', JSON.stringify(edits));
    assert.equal(p.call('confirmNextSeason', { eventId: idB, edits, planVersion: pvB.planVersion }, { auth: bob }).error.code, 'NOT_FOUND');
  }
  const detB = p.ok('eventDetail', { eventId: idB }, { auth: bob });
  const bobPlayer = detB.players[0];
  assert.equal(p.call('setPlayerMember', { eventId: idB, playerId: bobPlayer.id, rev: bobPlayer.rev, memberId: aliceMember }, { auth: bob }).error.code, 'NOT_FOUND');
  // 他人の大会の選手を自分の大会の ID と組み合わせても受け付けない
  const alicePlayer = detA.players[0];
  assert.equal(p.call('setPlayerMember', { eventId: idB, playerId: alicePlayer.id, rev: alicePlayer.rev, memberId: detB.season.members[0].memberId }, { auth: bob }).error.code, 'NOT_FOUND');
  // 主催者は作れる。次期の主催者も alice（共同主催者・管理パスワードは引き継がない）
  const idA2 = p.ok('confirmNextSeason', { eventId: idA, planVersion: pvA.planVersion }, { auth: alice }).eventId;
  const detA2 = p.ok('eventDetail', { eventId: idA2 }, { auth: alice });
  assert.equal(detA2.event.role, 'owner');
  assert.deepEqual(detA2.collaborators, []);
  assert.equal(detA2.event.staffPasswordSet, false);
  assert.equal(p.call('eventDetail', { eventId: idA2 }, { auth: carol }).error.code, 'NOT_FOUND', '共同主催者は次期を開けない（明示的に追加するまで）');
  // 管理者が作っても、次期の主催者は前期の主催者
  const idB2 = next(p, idB, {}, undefined).eventId;
  assert.equal(p.ok('eventDetail', { eventId: idB2 }, { auth: bob }).event.role, 'owner');
  // 他人の次期の照合も拒否
  assert.equal(p.call('reconcileNextSeason', { eventId: idA2, rev: detA2.season.seasonRev, acknowledge: true, reason: 'x' }, { auth: bob }).error.code, 'NOT_FOUND');
});

test('既存のリーグ大会を期制リーグに移行: 選手ごとに新しい会員 ID（名前で他の大会と結び付けない）。2 ディビジョンなら入替戦の段階を足す', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: '既存リーグ', template: 'league', divisions: 2, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: id, players: people(8) });
  let d = p.ok('eventDetail', { eventId: id });
  assert.equal(d.season.linked, false);
  assert.equal(d.season.convertible, true);
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id });
  playAll(p, id, 0);
  // 同じ名前の選手がいる別の期制リーグがあっても、結び付けない
  const other = season1(p, 8);
  p.ok('convertToSeasonLeague', { eventId: id, name: '既存リーグ', seasonNo: 3, thresholds: [8] });
  d = p.ok('eventDetail', { eventId: id });
  assert.equal(d.season.seasonNo, 3);
  assert.equal(d.stages[1].type, 'promotion');
  const otherMembers = new Set(p.ok('eventDetail', { eventId: other }).season.members.map((x) => x.memberId));
  assert.ok(d.season.members.every((x) => x.memberId && !otherMembers.has(x.memberId)));
  assert.equal(p.call('convertToSeasonLeague', { eventId: id, name: 'x' }).error.code, 'LOCKED');
  // プレーオフのある大会は移行しない
  const lp = p.ok('createEvent', { name: 'プレーオフ付き', template: 'league_playoff', rule: { format: 'legs', bestOf: 3 } }).eventId;
  assert.equal(p.call('convertToSeasonLeague', { eventId: lp, name: 'x' }).error.code, 'VALIDATION');
  p.ok('generatePlayoffs', { eventId: id });
  playAll(p, id, 1);
  const c = next(p, id);
  assert.equal(p.ok('eventDetail', { eventId: c.eventId }).event.name, '既存リーグ 第4期');
});

test('期の途中で選手を足すと会員 ID を付け、消した選手の会員は残さない。以前の会員への付け替えは主催者が明示的に行う', () => {
  const p = ready();
  const id1 = season1(p, 6);
  playAll(p, id1, 0);
  const pv = p.ok('previewNextSeason', { eventId: id1 });
  const gone = pv.rows.find((r) => r.name === '選手06');
  const id2 = p.ok('confirmNextSeason', { eventId: id1, edits: { leave: [gone.key] }, planVersion: p.ok('previewNextSeason', { eventId: id1, edits: { leave: [gone.key] } }).planVersion }).eventId;
  p.ok('addPlayers', { eventId: id2, names: ['途中参加'] });
  let d = p.ok('eventDetail', { eventId: id2 });
  const late = d.season.members.find((x) => x.name === '途中参加');
  assert.match(late.memberId, /^LMB-/);
  // 途中参加の人は、以前脱退した 選手06 本人だった: 主催者が付け替える（名前は違っても ID で）
  const pl = d.players.find((x) => x.name === '途中参加');
  p.ok('setPlayerMember', { eventId: id2, playerId: pl.id, rev: pl.rev, memberId: gone.key });
  d = p.ok('eventDetail', { eventId: id2 });
  assert.equal(d.season.members.find((x) => x.name === '途中参加').memberId, gone.key);
  const membersSheet = p.store.get().getSheetByName('LeagueMembers').records();
  assert.equal(membersSheet.filter((m) => m.member_id === late.memberId).length, 0, '使わなくなった会員は消す');
  assert.equal(membersSheet.find((m) => m.member_id === gone.key).status, 'active', '復帰した');
  // 選手を消すと、その期だけの会員は消える
  p.ok('addPlayers', { eventId: id2, names: ['取り消し'] });
  d = p.ok('eventDetail', { eventId: id2 });
  const tmp = d.players.find((x) => x.name === '取り消し');
  const tmpMember = d.season.members.find((x) => x.name === '取り消し').memberId;
  p.ok('deletePlayer', { playerId: tmp.id, rev: tmp.rev });
  assert.equal(p.store.get().getSheetByName('LeagueMembers').records().filter((m) => m.member_id === tmpMember).length, 0);
});

/* ---------- 公開データ ---------- */

test('公開データ: 期の一覧は公開中の期だけ大会 ID を出す。順位表の昇降格の帯、入替戦、確定後の昇降格の結果。理由・会員 ID・メモは出さない', () => {
  const p = ready();
  const { id1, id2 } = twoDivisions(p);
  p.ok('generatePlayoffs', { eventId: id2 });
  playAll(p, id2, 1, () => false);
  const publish = (id) => {
    const ev = p.ok('eventDetail', { eventId: id }).event;
    p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '運営メモ' });
  };
  publish(id2);
  p.clock.advance(21000);
  let data = p.viewer.run('getPublicSnapshot', { eventId: id2 }).data;
  assert.deepEqual(data.event.season.seasons, [{ no: 1, eventId: null, current: false }, { no: 2, eventId: id2, current: true }], '非公開の 1 期目の ID は出さない');
  const st = data.stages[0].groups[0].standings;
  assert.deepEqual(st.map((s) => s.zone || ''), ['', '', '', '', 'playoff', 'relegate']);
  assert.deepEqual(data.stages[0].groups[1].standings.map((s) => s.zone || ''), ['promote', 'playoff', '', '', '', '']);
  assert.equal(data.stages[1].type, 'promotion');
  assert.equal(data.stages[1].pairs[0].match.status, 'final');
  assert.equal(data.event.season.next, undefined, '確定前は結果を出さない');
  // 1 期目を公開すると、2 期目の公開データの期の一覧にも出る（前後の期の公開データも作り直す）
  publish(id1);
  p.clock.advance(21000);
  data = p.viewer.run('getPublicSnapshot', { eventId: id2 }).data;
  assert.equal(data.event.season.seasons[0].eventId, id1);
  // 次期を手動の修正つきで確定 → 前期の公開データに結果（種類と次期の所属だけ）
  const pv = p.ok('previewNextSeason', { eventId: id2 });
  const r9 = pv.rows.find((r) => r.name === '選手09');
  const edits = { moves: [{ key: r9.key, division: 1, reason: '非公開の理由です' }] };
  const pv2 = p.ok('previewNextSeason', { eventId: id2, edits });
  assert.equal(pv2.ok, true, JSON.stringify(pv2.problems));
  const id3 = p.ok('confirmNextSeason', { eventId: id2, edits, planVersion: pv2.planVersion }).eventId;
  p.clock.advance(21000);
  data = p.viewer.run('getPublicSnapshot', { eventId: id2 }).data;
  assert.equal(data.event.season.next.no, 3);
  assert.equal(data.event.season.next.eventId, null, '次期は非公開なので ID を出さない');
  const nameOf = {};
  data.stages[0].groups.forEach((g) => g.players.forEach((x) => (nameOf[x.id] = x.name)));
  const out = {};
  data.event.season.next.outcome.forEach((o) => (out[nameOf[o.playerId]] = o.kind + '→' + o.to));
  assert.equal(out['選手08'], 'playoff_win_promote→1部');
  assert.equal(out['選手05'], 'playoff_lose_relegate→2部');
  assert.equal(out['選手09'], 'stay→1部', '手動で変えた所属は結果だけを出す');
  const text = JSON.stringify(data);
  for (const secret of ['非公開の理由です', '運営メモ', 'LMB-', 'LSN-', 'reasons', 'manual', '@']) assert.ok(!text.includes(secret), secret);
  // 次期を公開すると、前期の公開データに次期の ID が出る
  publish(id3);
  p.clock.advance(21000);
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: id2 }).data.event.season.next.eventId, id3);
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: id3 }).data.event.season.seasons.length, 3);
});
