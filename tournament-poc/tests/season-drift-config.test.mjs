// 監査 PR-09（C-025・C-026）: 次期を作った後の照合（前期の訂正 → 次期の所属の違い）は、確定したときの
// 期制リーグの設定（ディビジョン数の境目・目標人数・定員）で計算する。設定を後から変えても違いは出ず、
// 結果を訂正したときだけ、その訂正による違いを示す。確定時の設定が記録にない古い記録で、確定の後に設定が
// 変わっていたら、違いは示すが自動では反映しない（主催者が判断して記録として承認する）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const people = (n) => Array.from({ length: n }, (_, i) => ({ name: '選手' + String(i + 1).padStart(2, '0') }));

function playAll(p, id) {
  for (let guard = 0; guard < 50; guard++) {
    const st = p.ok('eventDetail', { eventId: id }).stages[0];
    const open = st.groups.flatMap((g) => g.matches).filter((m) => m.status === 'scheduled' && m.p1.id && m.p2.id);
    if (!open.length) return;
    p.ok('saveMatchResults', {
      eventId: id,
      results: open.slice(0, 60).map((m) => {
        const need = Math.floor(m.bestOf / 2) + 1;
        return m.p1.name < m.p2.name ? { matchId: m.id, rev: m.rev, p1Legs: need, p2Legs: need - 1 } : { matchId: m.id, rev: m.rev, p1Legs: need - 1, p2Legs: need };
      }),
    });
  }
  throw new Error('終わらない');
}

/** 8 人・境目 8 人で 2 部制の 2 期目を作る（1 部 4 人・2 部 4 人） */
function world() {
  const p = setupPair();
  p.ok('initializeStorage');
  const id1 = p.ok('createSeasonLeague', { name: '照合リーグ', thresholds: [8], cycles: 1, rule: { format: 'legs', bestOf: 5 } }).eventId;
  p.ok('importPlayers', { eventId: id1, players: people(8) });
  const d = p.ok('eventDetail', { eventId: id1 });
  p.ok('autoAssign', { eventId: id1, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: id1, stageId: d.stages[0].id });
  playAll(p, id1);
  const pv = p.ok('previewNextSeason', { eventId: id1, edits: {} });
  const id2 = p.ok('confirmNextSeason', { eventId: id1, edits: {}, planVersion: pv.planVersion }).eventId;
  return { p, id1, id2 };
}

/** 確定の後に期制リーグの設定を変える（境目をなくして 1 ディビジョンに、などの次の期向けの変更） */
function changeSettings(w, patch) {
  w.p.clock.advance(60 * 1000);
  const league = w.p.ok('eventDetail', { eventId: w.id2 }).season.league;
  w.p.ok('updateLeagueSettings', { eventId: w.id2, rev: league.rev, ...patch });
}

/** 1 期目の 選手04 vs 選手05 を訂正して 4 位と 5 位（1 部と 2 部の境目）を入れ替える */
function correctBorder(w) {
  const d1 = w.p.ok('eventDetail', { eventId: w.id1 });
  const m = d1.stages[0].groups[0].matches.find((x) => [x.p1.name, x.p2.name].sort().join() === '選手04,選手05');
  const p4First = m.p1.name === '選手04';
  w.p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: p4First ? 0 : 3, p2Legs: p4First ? 3 : 0 });
}

const drift = (w) => w.p.ok('eventDetail', { eventId: w.id2 }).season.drift;
const diffNames = (dr) => dr.diffs.map((x) => x.name + ':' + x.confirmed + '→' + x.now).sort();

/** このコードより前の確定記録にする（確定時の設定を持たない） */
function toLegacyRecord(w) {
  const sheet = w.p.store.get().getSheetByName('LeagueSeasons');
  const header = sheet.rows[0].map(String);
  const iEvent = header.indexOf('event_id');
  const iPlan = header.indexOf('plan_json');
  const row = sheet.rows.find((r, i) => i > 0 && r[iEvent] === w.id2);
  const record = JSON.parse(String(row[iPlan]).slice(1));
  assert.ok(record.config, '新しい記録は確定時の設定を持つ');
  delete record.config;
  row[iPlan] = '~' + JSON.stringify(record);
}

for (const patch of [{ thresholds: [] }, { thresholds: [6] , targets: [3] }, { capacities: [3] }]) {
  test('結果を訂正せずに期制リーグの設定だけを変えても、照合に違いは出ない（' + JSON.stringify(patch) + '）', () => {
    const w = world();
    changeSettings(w, patch);
    const dr = drift(w);
    assert.equal(dr.changed, false);
    assert.deepEqual(dr.diffs, [], '設定の変更による違いを出さない');
    assert.deepEqual(dr.problems, []);
    assert.equal(w.p.ok('eventDetail', { eventId: w.id1 }).season.next.drift.changed, false);
  });
}

test('設定を変えた後に前期の結果を訂正: 確定時の設定で計算し、訂正による違い（境目の 2 人）だけを示す。反映できる', () => {
  const w = world();
  changeSettings(w, { thresholds: [] });
  correctBorder(w);
  const dr = drift(w);
  assert.equal(dr.changed, true);
  assert.deepEqual(diffNames(dr), ['選手04:1→2', '選手05:2→1']);
  assert.ok(dr.diffs.every((x) => x.canApply), JSON.stringify(dr.diffs.map((x) => x.lock)));
  const d2 = w.p.ok('eventDetail', { eventId: w.id2 });
  const res = w.p.ok('reconcileNextSeason', { eventId: w.id2, rev: d2.season.seasonRev, apply: dr.diffs.map((x) => x.key), reason: '1 期目の訂正' });
  assert.equal(res.applied, 2);
  const after = drift(w);
  assert.equal(after.changed, false, '反映した後は、今の前期の結果が次期の根拠');
  assert.deepEqual(after.diffs, []);
});

test('古い確定記録（確定時の設定がない）で確定の後に設定が変わっていたら、違いは示すが自動では反映しない。記録として承認はできる', () => {
  const w = world();
  toLegacyRecord(w);
  changeSettings(w, { thresholds: [] });
  correctBorder(w);
  const dr = drift(w);
  assert.equal(dr.changed, true);
  assert.ok(dr.diffs.length > 0);
  assert.ok(dr.diffs.every((x) => !x.canApply && /確定の後に期制リーグの設定が変わ/.test(x.lock)), JSON.stringify(dr.diffs.map((x) => x.lock)));
  assert.ok(dr.problems.some((x) => /確定したときの設定が記録にありません/.test(x)));
  const d2 = w.p.ok('eventDetail', { eventId: w.id2 });
  const apply = w.p.call('reconcileNextSeason', { eventId: w.id2, rev: d2.season.seasonRev, apply: dr.diffs.map((x) => x.key), reason: '反映' });
  assert.equal(apply.ok, false);
  assert.equal(apply.error.code, 'LOCKED');
  w.p.ok('reconcileNextSeason', { eventId: w.id2, rev: d2.season.seasonRev, acknowledge: true, reason: '設定の変更前の確定のため、所属は主催者が判断' });
  assert.ok(drift(w).acknowledged);
});

test('古い確定記録でも、確定の後に設定が変わっていなければ従来どおり（今の設定＝確定時の設定）で照合し、反映できる', () => {
  const w = world();
  toLegacyRecord(w);
  correctBorder(w);
  const dr = drift(w);
  assert.deepEqual(diffNames(dr), ['選手04:1→2', '選手05:2→1']);
  assert.ok(dr.diffs.every((x) => x.canApply));
  assert.deepEqual(dr.problems, []);
});
