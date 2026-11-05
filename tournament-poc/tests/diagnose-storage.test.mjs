// 整合性の診断（監査の採用候補「整合性診断」）: 管理者だけが使える読み取り専用の点検。
// 参照の切れ・勝ち上がりの不一致・読めない JSON・途中で止まった次期の作成の跡などを一覧にし、何も書き換えない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const names = (n) => Array.from({ length: n }, (_, i) => `選手${String(i + 1).padStart(2, '0')}`);

/** 正常なデータ: サンプル大会・4 人のトーナメント（決勝まで確定）・期制リーグの 2 期目 */
function world() {
  const p = setupPair();
  p.ok('initializeStorage');
  p.ok('createSampleEvent', { publish: true });
  const ko = p.ok('createEvent', { name: 'KO', template: 'elimination', rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: ko, names: names(4) });
  let d = p.ok('eventDetail', { eventId: ko });
  const sid = d.stages[0].id;
  p.ok('setEntrants', { eventId: ko, stageId: sid, playerIds: d.players.map((x) => x.id) });
  p.ok('generateBracket', { eventId: ko, stageId: sid });
  for (;;) {
    const st = p.ok('eventDetail', { eventId: ko }).stages[0];
    const m = st.rounds.flatMap((r) => r.matches).find((x) => x.status === 'scheduled' && x.p1.id && x.p2.id);
    if (!m) break;
    p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 });
  }
  const s1 = p.ok('createSeasonLeague', { name: '診断リーグ', thresholds: [], cycles: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: s1, players: names(4).map((name) => ({ name })) });
  d = p.ok('eventDetail', { eventId: s1 });
  p.ok('autoAssign', { eventId: s1, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: s1, stageId: d.stages[0].id });
  for (;;) {
    const st = p.ok('eventDetail', { eventId: s1 }).stages[0];
    const open = st.groups.flatMap((g) => g.matches).filter((m) => m.status === 'scheduled' && m.p1.id && m.p2.id);
    if (!open.length) break;
    p.ok('saveMatchResults', { eventId: s1, results: open.map((m) => (m.p1.name < m.p2.name ? { matchId: m.id, rev: m.rev, p1Legs: 2, p2Legs: 0 } : { matchId: m.id, rev: m.rev, p1Legs: 0, p2Legs: 2 })) });
  }
  const pv = p.ok('previewNextSeason', { eventId: s1, edits: {} });
  const s2 = p.ok('confirmNextSeason', { eventId: s1, edits: {}, planVersion: pv.planVersion }).eventId;
  return { p, ko, s1, s2 };
}

const book = (w) => w.p.store.get();
const sheet = (w, name) => book(w).getSheetByName(name);
const col = (w, name, c) => sheet(w, name).rows[0].map(String).indexOf(c);
function rowsWhere(w, name, c, v) {
  const i = col(w, name, c);
  return sheet(w, name).rows.filter((r, k) => k > 0 && r[i] === v);
}
function setCell(w, name, row, c, v) {
  row[col(w, name, c)] = v;
}
const dump = (w) => JSON.stringify(['Events', 'Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'PublicSnapshots', 'Leagues', 'LeagueSeasons', 'LeagueMembers', 'History'].map((n) => sheet(w, n).rows));

test('正常なデータでは問題なし。シートの行数を返す', () => {
  const w = world();
  const r = w.p.ok('diagnoseStorage');
  assert.equal(r.total, 0, JSON.stringify(r.issues, null, 1));
  assert.deepEqual(r.issues, []);
  assert.equal(r.truncated, false);
  assert.ok(r.counts.Events >= 3);
  assert.ok(r.counts.Matches > 0);
});

test('壊したデータ: 大会がない行・参照の切れ・勝ち上がりの不一致・読めない JSON・同じ段階の重複出場・期の跡・会員なしを見つけ、何も書き換えない', () => {
  const w = world();
  // 1) 大会がない選手の行（作成・削除が途中で止まった跡）
  const pl = sheet(w, 'Players').rows[1].slice();
  setCell(w, 'Players', pl, 'player_id', 'PLY-ORPHAN-0001');
  setCell(w, 'Players', pl, 'event_id', 'EVT-GONE-0001');
  sheet(w, 'Players').rows.push(pl);
  // 2) 勝ち上がりの不一致: トーナメントの決勝の枠 1 を別の選手に
  const koMatches = rowsWhere(w, 'Matches', 'event_id', w.ko);
  const semi = koMatches.find((r) => r[col(w, 'Matches', 'next_match_id')]);
  const final = koMatches.find((r) => r[col(w, 'Matches', 'match_id')] === semi[col(w, 'Matches', 'next_match_id')]);
  const slot = semi[col(w, 'Matches', 'next_match_slot')] === 2 ? 'player2_id' : 'player1_id';
  const loserOfSemi = semi[col(w, 'Matches', 'player1_id')] === semi[col(w, 'Matches', 'winner_id')] ? semi[col(w, 'Matches', 'player2_id')] : semi[col(w, 'Matches', 'player1_id')];
  setCell(w, 'Matches', final, slot, loserOfSemi);
  // 3) 読めない JSON
  const stage = rowsWhere(w, 'Stages', 'event_id', w.ko)[0];
  setCell(w, 'Stages', stage, 'config_json', '{壊れた');
  // 4) 参照の切れ: 出場の選手がいない
  const entry = rowsWhere(w, 'Entries', 'event_id', w.ko)[0];
  setCell(w, 'Entries', entry, 'player_id', 'PLY-MISSING-0001');
  // 5) 同じ段階に同じ選手が 2 回
  const e2 = rowsWhere(w, 'Entries', 'event_id', w.ko)[1].slice();
  setCell(w, 'Entries', e2, 'entry_id', 'ENT-DUP-0001');
  sheet(w, 'Entries').rows.push(e2);
  // 6) 次期の作成が途中で止まった跡（期の行はあるが大会の行がない）
  const season = rowsWhere(w, 'LeagueSeasons', 'event_id', w.s2)[0].slice();
  setCell(w, 'LeagueSeasons', season, 'season_key', 'SEASON-TRACE-0001');
  setCell(w, 'LeagueSeasons', season, 'event_id', 'EVT-TRACE-0001');
  setCell(w, 'LeagueSeasons', season, 'season_no', 3);
  sheet(w, 'LeagueSeasons').rows.push(season);
  // 7) 会員がない選手
  const sp = rowsWhere(w, 'Players', 'event_id', w.s2)[0];
  setCell(w, 'Players', sp, 'member_id', 'MBR-MISSING-0001');

  const before = dump(w);
  const r = w.p.ok('diagnoseStorage');
  assert.equal(dump(w), before, '診断は何も書き換えない');
  const kinds = Object.fromEntries(r.kinds.map((k) => [k.kind, k.count]));
  assert.ok(kinds.orphan_event >= 1, JSON.stringify(r.kinds));
  assert.ok(r.issues.some((x) => x.kind === 'orphan_event' && x.sheet === 'Players' && x.id === 'PLY-ORPHAN-0001'));
  assert.ok(r.issues.some((x) => x.kind === 'bracket_mismatch' && x.eventId === w.ko));
  assert.ok(r.issues.some((x) => x.kind === 'bad_json' && x.sheet === 'Stages' && /config_json/.test(x.detail)));
  assert.ok(r.issues.some((x) => x.kind === 'missing_ref' && x.sheet === 'Entries' && /PLY-MISSING-0001/.test(x.detail)));
  assert.ok(r.issues.some((x) => x.kind === 'duplicate_entry' && x.id === 'ENT-DUP-0001'));
  assert.ok(r.issues.some((x) => x.kind === 'season_trace' && x.id === 'SEASON-TRACE-0001' && x.eventId === 'EVT-TRACE-0001'));
  assert.ok(r.issues.some((x) => x.kind === 'missing_member' && /MBR-MISSING-0001/.test(x.detail)));
  assert.equal(r.total, r.kinds.reduce((s, k) => s + k.count, 0));
  r.issues.forEach((x) => assert.ok(x.label && x.detail && x.sheet, JSON.stringify(x)));
});

test('管理者だけ: 主催者・未認証は使えない（読み取りでも）', () => {
  const w = world();
  const alice = w.p.loginAs('alice@example.org');
  const res = w.p.call('diagnoseStorage', {}, { auth: alice });
  assert.equal(res.ok, false);
  assert.match(res.error.code, /FORBIDDEN|AUTH/);
  const anon = w.p.call('diagnoseStorage', {}, { auth: 'anon' });
  assert.equal(anon.ok, false);
});

test('問題が多くても一覧は 300 件までで、種類ごとの件数と total は全部を数える', () => {
  const w = world();
  const base = sheet(w, 'Players').rows[1];
  for (let i = 0; i < 320; i++) {
    const r = base.slice();
    setCell(w, 'Players', r, 'player_id', 'PLY-ORPHAN-' + String(i).padStart(4, '0'));
    setCell(w, 'Players', r, 'event_id', 'EVT-GONE-0001');
    sheet(w, 'Players').rows.push(r);
  }
  const r = w.p.ok('diagnoseStorage');
  assert.equal(r.issues.length, 300);
  assert.equal(r.truncated, true);
  assert.ok(r.total >= 320);
  assert.equal(r.kinds.find((k) => k.kind === 'orphan_event').count, 320);
});

/** 段階の試合を、名前の番号の小さい方の勝ちで全部確定する（形式によらない） */
function playStage(p, id, sid) {
  const all = (st) => (st.sides ? st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches)) : st.nights ? st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches)) : st.groups ? st.groups.flatMap((g) => g.matches) : st.rounds.flatMap((r) => r.matches));
  for (let i = 0; i < 300; i++) {
    const st = p.ok('eventDetail', { eventId: id }).stages.find((s) => s.id === sid);
    const m = all(st).find((x) => x.status === 'scheduled' && x.p1.id && x.p2.id);
    if (!m) return;
    const a = m.p1.name < m.p2.name;
    p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: a ? 2 : 0, p2Legs: a ? 0 : 2 });
  }
}

test('誤検知しない: ダブルエリミ（リセットあり・5 人）・6 人のトーナメント（不戦）・回戦ごとの抽選・スイス式 5 人（Bye）・予選→決勝の進出・棄権の不戦勝・ポイントシリーズ（節ごとの出場）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const mk = (payload, n) => {
    const id = p.ok('createEvent', { rule: { format: 'legs', bestOf: 3 }, ...payload }).eventId;
    p.ok('addPlayers', { eventId: id, names: names(n) });
    return id;
  };
  const bracket = (id, redraw) => {
    const d = p.ok('eventDetail', { eventId: id });
    const st = d.stages[0];
    if (redraw) p.ok('updateStage', { stageId: st.id, rev: st.rev, drawMode: 'redraw', fixedRounds: 0 });
    p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
    p.ok('generateBracket', { eventId: id, stageId: st.id });
    return st.id;
  };
  // ダブルエリミ 5 人・リセットあり（敗者側の選手がグランドファイナルに勝つ並びにする）
  const de = mk({ name: 'DE', template: 'double_elimination', grandFinal: 'double' }, 5);
  playStage(p, de, bracket(de));
  // 6 人のトーナメント（不戦あり）・途中で棄権
  const se = mk({ name: 'SE6', template: 'elimination' }, 6);
  const seSid = bracket(se);
  const pl = p.ok('eventDetail', { eventId: se }).players.find((x) => x.name === '選手06');
  p.ok('withdrawPlayer', { eventId: se, playerId: pl.id, rev: pl.rev, kind: 'withdrawn', reason: '欠席' });
  playStage(p, se, seSid);
  // 回戦ごとの抽選
  const rd = mk({ name: 'RD', template: 'elimination' }, 8);
  const rdSid = bracket(rd, true);
  for (let r = 0; r < 3; r++) {
    playStage(p, rd, rdSid);
    const res = p.call('drawNextRound', { eventId: rd, stageId: rdSid });
    if (!res.ok) break;
  }
  // スイス式 5 人 3 回戦
  const sw = mk({ name: 'SW', template: 'swiss', swissRounds: 3, playoff: 0 }, 5);
  const swSt = p.ok('eventDetail', { eventId: sw }).stages[0];
  p.ok('autoAssign', { eventId: sw, stageId: swSt.id });
  for (let r = 0; r < 3; r++) {
    p.ok('generateSwissRound', { eventId: sw, stageId: swSt.id });
    playStage(p, sw, swSt.id);
  }
  // 予選ロビン → 決勝トーナメント
  const rk = mk({ name: 'RK', template: 'robin_ko', groupCount: 1, advanceCount: 2 }, 4);
  let d = p.ok('eventDetail', { eventId: rk });
  p.ok('autoAssign', { eventId: rk, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: rk, stageId: d.stages[0].id });
  playStage(p, rk, d.stages[0].id);
  p.ok('confirmAdvancement', { eventId: rk, stageId: d.stages[0].id });
  d = p.ok('eventDetail', { eventId: rk });
  p.ok('generateBracket', { eventId: rk, stageId: d.stages[1].id });
  playStage(p, rk, d.stages[1].id);
  // ポイントシリーズ 6 人 2 節（節ごとに出場の行を持つ）→ プレーオフ
  const ps = mk({ name: 'PS', template: 'series_playoff', nights: 2, playoff: 2 }, 6);
  const psSt = p.ok('eventDetail', { eventId: ps }).stages[0];
  p.ok('updateStage', { stageId: psSt.id, rev: psSt.rev, nightDraw: 'seed' });
  p.ok('autoAssign', { eventId: ps, stageId: psSt.id });
  for (const night of psSt.nights) {
    p.ok('generateNight', { eventId: ps, groupId: night.id });
    playStage(p, ps, psSt.id);
  }
  // サンプル大会（ポイントシリーズのサンプルを含む）
  p.ok('createSampleEvent', { publish: true });
  const r = p.ok('diagnoseStorage');
  assert.equal(r.total, 0, JSON.stringify(r.issues, null, 1));
  // 実際に不戦・リセット・Bye・棄権の不戦勝ができていること（試験の前提）
  const dd = p.ok('eventDetail', { eventId: de }).stages[0];
  assert.ok(dd.champion, 'DE は優勝まで');
  assert.ok(p.ok('eventDetail', { eventId: sw }).stages[0].groups[0].matches.some((m) => m.resultType === 'bye'));
  assert.ok(p.ok('eventDetail', { eventId: se }).stages[0].rounds.flatMap((x) => x.matches).some((m) => m.resultType === 'walkover'));
});
