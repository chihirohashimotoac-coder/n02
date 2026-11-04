// 監査 PR-06（C-027・C-008）: 次期の作成（confirmNextSeason）が書き込みの途中で止まっても、再試行で
// 次期・会員が重複せず、最終状態が故障なしの場合と一致する。無関係な大会・会員の行は巻き込まない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const people = (n) => Array.from({ length: n }, (_, i) => ({ name: '選手' + String(i + 1).padStart(2, '0') }));
const SHEETS = ['Events', 'Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'Collaborators', 'LeagueMembers', 'Leagues', 'LeagueSeasons', 'PublicSnapshots'];

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

function publish(p, id) {
  const e = p.ok('eventDetail', { eventId: id }).event;
  p.ok('updateEvent', { eventId: id, rev: e.rev, name: e.name, dateLabel: e.dateLabel, notes: e.notes, status: e.status, isPublic: true, isFeatured: false });
}

const keyOf = (pv, name) => pv.rows.find((r) => r.name === name).key;

/**
 * 無関係な大会 1 つと、期制リーグの 2 期目（リーグを全試合確定）。2 期目から 3 期目を作るときに、
 * 不参加・復帰・新規参加・表示名の変更・期の途中で足した選手（via player）のすべてが起きる修正を返す
 */
function world() {
  const p = setupPair();
  p.ok('initializeStorage');
  const other = p.ok('createSampleEvent', {}).eventId;
  // 無関係な期制リーグ（会員の行を巻き込まないことを確かめる）
  const otherLeague = p.ok('createSeasonLeague', { name: '別のリーグ', thresholds: [], cycles: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: otherLeague, players: [{ name: '別01' }, { name: '別02' }, { name: '別03' }] });
  const id1 = p.ok('createSeasonLeague', { name: '木曜リーグ', thresholds: [], cycles: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: id1, players: people(8) });
  let d = p.ok('eventDetail', { eventId: id1 });
  p.ok('autoAssign', { eventId: id1, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: id1, stageId: d.stages[0].id });
  playAll(p, id1);
  publish(p, id1);
  let pv = p.ok('previewNextSeason', { eventId: id1, edits: {} });
  const leave1 = { leave: [keyOf(pv, '選手08')] };
  pv = p.ok('previewNextSeason', { eventId: id1, edits: leave1 });
  const id2 = p.ok('confirmNextSeason', { eventId: id1, edits: leave1, planVersion: pv.planVersion }).eventId;
  p.ok('addPlayers', { eventId: id2, names: ['途中参加'] });
  d = p.ok('eventDetail', { eventId: id2 });
  p.ok('autoAssign', { eventId: id2, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: id2, stageId: d.stages[0].id });
  playAll(p, id2);
  publish(p, id2);
  pv = p.ok('previewNextSeason', { eventId: id2, edits: {} });
  const edits = {
    leave: [keyOf(pv, '選手07')],
    rejoin: [pv.candidates.find((c) => c.name === '選手08').key],
    join: [{ name: '新人A' }, { name: '新人B' }],
    names: [{ key: keyOf(pv, '選手01'), name: '選手01改' }],
  };
  return { p, other, otherLeague, id1, id2, edits };
}

function confirm(w, extra) {
  const pv = w.p.ok('previewNextSeason', { eventId: w.id2, edits: w.edits });
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
  return w.p.call('confirmNextSeason', { eventId: w.id2, edits: w.edits, planVersion: pv.planVersion }, extra);
}

/** 比べる状態: 各シートの行数（履歴を除く）・会員（表示名・状態・印）・次期の所属・無関係な大会の行 */
function snapshot(w, nextId) {
  const book = w.p.store.get();
  const recs = (name) => book.getSheetByName(name).records();
  const counts = {};
  SHEETS.forEach((n) => (counts[n] = recs(n).length));
  const members = recs('LeagueMembers')
    .map((m) => {
      const meta = JSON.parse(m.meta_json || '{}');
      return [m.display_name, m.status, meta.joinedSeason ?? null, meta.leftAfterSeason ?? null, meta.rejoinedSeason ?? null, meta.via ?? null, (meta.names || []).map((x) => x.name).join('/')].join('|');
    })
    .sort();
  const d = w.p.ok('eventDetail', { eventId: nextId });
  const nameOf = {};
  d.players.forEach((x) => (nameOf[x.id] = x.name));
  const divisions = d.stages[0].groups.map((g) => g.players.map((x) => nameOf[x.id]).sort());
  const unrelated = SHEETS.filter((n) => n !== 'Leagues' && n !== 'LeagueMembers').map((n) => n + ':' + recs(n).filter((r) => r.event_id === w.other || r.event_id === w.otherLeague).length);
  const otherLeagueId = recs('LeagueSeasons').find((r) => r.event_id === w.otherLeague).league_id;
  const otherMembers = recs('LeagueMembers')
    .filter((m) => m.league_id === otherLeagueId)
    .map((m) => [m.member_id, m.display_name, m.status, m.meta_json, m.rev].join('|'))
    .sort();
  const seasons = recs('LeagueSeasons').map((r) => r.season_no).sort();
  const seasonList = (id) => w.p.ok('eventDetail', { eventId: id }).season.seasons.map((x) => x.no + ':' + x.exists).join(',');
  return { counts, members, divisions, unrelated, otherMembers: otherMembers.length, seasons, lists: [seasonList(w.id1), seasonList(w.id2), seasonList(nextId)] };
}

/** シートへの書き込み（setValues）を 1 回だけ失敗させる。書き込みがなければ何もしない */
function failOnce(p, sheetName) {
  const sheet = p.store.get().getSheetByName(sheetName);
  const original = sheet.getRange.bind(sheet);
  let armed = true;
  sheet.getRange = (...args) => {
    const r = original(...args);
    const set = r.setValues.bind(r);
    r.setValues = (v) => {
      if (armed) {
        armed = false;
        throw new Error('Service Spreadsheets failed (simulated)');
      }
      return set(v);
    };
    return r;
  };
  return () => !armed;
}

const baseline = (() => {
  const w = world();
  const r = confirm(w);
  assert.equal(r.ok, true);
  return snapshot(w, r.data.eventId);
})();

const FAULTS = ['LeagueSeasons', 'Rules', 'Players', 'Stages', 'Groups', 'Entries', 'LeagueMembers', 'Events', 'History', 'PublicSnapshots'];

/** 故障なしの状態との違い（項目名と値）。一致すれば空 */
function differences(actual, expected) {
  const out = [];
  for (const k of Object.keys(expected)) {
    if (JSON.stringify(actual[k]) !== JSON.stringify(expected[k])) out.push(k + ': ' + JSON.stringify(actual[k]) + ' ≠ ' + JSON.stringify(expected[k]));
  }
  return out;
}

for (const mode of ['new-request', 'same-request', 'other-op-between']) {
  test('次期の作成が途中で止まった後の再試行（' + mode + '）: どのシートで止まっても、次期・会員が重複せず、故障なしの場合と同じ状態になる', () => {
    const problems = [];
    for (const sheet of FAULTS) {
      const w = world();
      const fired = failOnce(w.p, sheet);
      const req = { requestId: 'season-partial-' + sheet.toLowerCase().padEnd(10, '0') + '-01' };
      const first = confirm(w, req);
      assert.equal(fired(), true, sheet + ': 書き込みがあった');
      assert.equal(first.ok, false, sheet + ': 1 回目は失敗する');
      if (mode === 'same-request') {
        const again = confirm(w, req);
        assert.equal(again.ok, false, sheet + ': 同じ requestId の再送は実行し直さない');
        assert.equal(again.error.code, 'PARTIAL_WRITE', sheet);
      }
      if (mode === 'other-op-between') {
        const e = w.p.ok('eventDetail', { eventId: w.other }).event;
        w.p.ok('updateEvent', { eventId: w.other, rev: e.rev, name: e.name, dateLabel: e.dateLabel, notes: '別の操作', status: e.status, isPublic: false, isFeatured: false });
      }
      const retry = confirm(w);
      if (!retry.ok) {
        problems.push(sheet + ': 再試行が失敗 ' + retry.error.code + ' ' + retry.error.message);
        continue;
      }
      differences(snapshot(w, retry.data.eventId), baseline).forEach((x) => problems.push(sheet + ' → ' + x));
    }
    assert.deepEqual(problems, []);
  });
}

/** 無関係な期制リーグの会員の行（ID・名前・状態・meta・版）。前後で同じことを確かめる */
function otherLeagueMembers(w) {
  const recs = (name) => w.p.store.get().getSheetByName(name).records();
  const leagueId = recs('LeagueSeasons').find((r) => r.event_id === w.otherLeague).league_id;
  return recs('LeagueMembers')
    .filter((m) => m.league_id === leagueId)
    .map((m) => [m.member_id, m.display_name, m.status, m.meta_json, m.rev].join('|'))
    .sort();
}

test('作り直しもまた途中で止まった（2 回続けて故障）: 3 回目の確定で、故障なしと同じ状態になる。無関係なリーグの会員は変えない', () => {
  const problems = [];
  for (const f1 of ['Players', 'LeagueMembers', 'Events']) {
    for (const f2 of ['LeagueSeasons', 'Players', 'LeagueMembers', 'Events']) {
      const w = world();
      const before = otherLeagueMembers(w);
      failOnce(w.p, f1);
      assert.equal(confirm(w).ok, false, f1);
      const fired = failOnce(w.p, f2);
      const second = confirm(w);
      assert.equal(fired(), true, f1 + '→' + f2);
      assert.equal(second.ok, false, f1 + '→' + f2);
      const third = confirm(w);
      if (!third.ok) {
        problems.push(f1 + '→' + f2 + ': ' + third.error.code + ' ' + third.error.message);
        continue;
      }
      differences(snapshot(w, third.data.eventId), baseline).forEach((x) => problems.push(f1 + '→' + f2 + ' → ' + x));
      assert.deepEqual(otherLeagueMembers(w), before, f1 + '→' + f2 + ': 無関係なリーグの会員');
    }
  }
  assert.deepEqual(problems, []);
});

test('途中で止まった跡: 運営画面とプレビューに示し（プレビューは何も書かない）、確定で同じ大会 ID・同じ期の行で作り直す。履歴に片づけた内容を残す', () => {
  const w = world();
  failOnce(w.p, 'Events');
  assert.equal(confirm(w).ok, false);
  const book = w.p.store.get();
  const rowsNow = () => SHEETS.concat(['History']).map((n) => n + ':' + book.getSheetByName(n).records().length).join(',');
  const broken = book.getSheetByName('LeagueSeasons').records().find((r) => r.season_no === 3);
  assert.ok(broken, '期の行は最初に書かれている');
  const d2 = w.p.ok('eventDetail', { eventId: w.id2 });
  assert.equal(d2.season.next.exists, false);
  assert.equal(d2.season.next.broken.seasonNo, 3);
  assert.ok(d2.season.next.broken.rows > 0);
  assert.deepEqual(d2.season.next.broken.removedMembers.slice().sort(), ['新人A', '新人B']);
  assert.deepEqual(d2.season.next.broken.restoredMembers.slice().sort(), ['途中参加', '選手01', '選手07', '選手08'], '今回の作成で変えた会員だけ（via・表示名・不参加・復帰）');
  assert.equal(d2.season.next.broken.legacy, false);
  assert.ok(d2.season.seasons.some((x) => x.no === 3 && !x.exists && /途中で止まりました/.test(x.name)));
  // 途中の跡の会員（新人）は、復帰の候補に出ない
  assert.ok(!d2.season.otherMembers.some((x) => /新人/.test(x.name)), JSON.stringify(d2.season.otherMembers));
  const before = rowsNow();
  const pv = w.p.ok('previewNextSeason', { eventId: w.id2, edits: w.edits });
  assert.equal(pv.repair.seasonNo, 3);
  assert.deepEqual(pv.repair.removedMembers.slice().sort(), ['新人A', '新人B']);
  assert.equal(pv.ok, true);
  assert.equal(rowsNow(), before, 'プレビューは何も書かない');
  const r = w.p.ok('confirmNextSeason', { eventId: w.id2, edits: w.edits, planVersion: pv.planVersion });
  assert.equal(r.eventId, broken.event_id, '同じ大会 ID');
  const seasons = book.getSheetByName('LeagueSeasons').records().filter((x) => x.season_no === 3);
  assert.equal(seasons.length, 1);
  assert.equal(seasons[0].season_key, broken.season_key, '同じ期の行');
  const repairs = book.getSheetByName('History').records().filter((h) => h.action === 'season.repair');
  assert.equal(repairs.length, 1);
  const after = JSON.parse(repairs[0].after_json);
  assert.equal(after.removedEventId, broken.event_id);
  assert.deepEqual(after.removedMembers.slice().sort(), ['新人A', '新人B']);
  assert.deepEqual(differences(snapshot(w, r.eventId), baseline), []);
  assert.equal(w.p.ok('eventDetail', { eventId: w.id2 }).season.next.exists, true);
});

test('途中で止まった後の同時の再試行: 1 つ目が作り直し、2 つ目は作成済みの次期を返す（次期を 2 つ作らない）', () => {
  const w = world();
  failOnce(w.p, 'Players');
  assert.equal(confirm(w).ok, false);
  const pv = w.p.ok('previewNextSeason', { eventId: w.id2, edits: w.edits });
  const a = w.p.call('confirmNextSeason', { eventId: w.id2, edits: w.edits, planVersion: pv.planVersion }, { requestId: 'season-concurrent-0000000a' });
  const b = w.p.call('confirmNextSeason', { eventId: w.id2, edits: w.edits, planVersion: pv.planVersion }, { requestId: 'season-concurrent-0000000b' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.data.existing, true);
  assert.equal(b.data.eventId, a.data.eventId);
  assert.deepEqual(differences(snapshot(w, a.data.eventId), baseline), []);
});

/**
 * このコードより前の作成の跡を作る: 正常に作った次期の大会の行を消し、会員の戻し方の印・確定記録の版・名前の期の印を外す
 * （前のコードは会員・子の行を期の行より先に書いたので、大会の行の書き込みで止まるとこの状態になる）
 */
function toLegacyBroken(w, nextId) {
  const book = w.p.store.get();
  const edit = (name, fn) => {
    const sheet = book.getSheetByName(name);
    const header = sheet.rows[0].map(String);
    for (let i = sheet.rows.length - 1; i >= 1; i--) {
      const rec = Object.fromEntries(header.map((h, j) => [h, sheet.rows[i][j] === undefined ? '' : sheet.rows[i][j]]));
      const out = fn(rec);
      if (out === null) sheet.rows.splice(i, 1);
      else if (out) header.forEach((h, j) => (sheet.rows[i][j] = out[h]));
    }
  };
  edit('Events', (r) => (r.event_id === nextId ? null : undefined));
  edit('LeagueMembers', (r) => {
    const meta = JSON.parse(r.meta_json || '{}');
    if (!meta.seasonUndo && !(meta.names || []).some((x) => 'season' in x)) return undefined;
    delete meta.seasonUndo;
    (meta.names || []).forEach((x) => delete x.season);
    return { ...r, meta_json: JSON.stringify(meta) };
  });
  edit('LeagueSeasons', (r) => {
    if (r.event_id !== nextId) return undefined;
    const record = JSON.parse(String(r.plan_json).slice(1));
    delete record.undo;
    delete record.legacyRows;
    return { ...r, plan_json: '~' + JSON.stringify(record) };
  });
}

test('このコードより前の作成の跡（会員の印がない）: 確定記録で分かる変更だけ戻して作り直す。印のない表示名の変更は戻さない。作り直しがまた止まっても片づく', () => {
  for (const f2 of [null, 'Players', 'LeagueMembers']) {
    const w = world();
    const before = otherLeagueMembers(w);
    const first = confirm(w);
    assert.equal(first.ok, true);
    toLegacyBroken(w, first.data.eventId);
    const d2 = w.p.ok('eventDetail', { eventId: w.id2 });
    assert.equal(d2.season.next.broken.legacy, true);
    assert.deepEqual(d2.season.next.broken.removedMembers.slice().sort(), ['新人A', '新人B']);
    // 不参加にした選手07を参加中に、復帰させた選手08を脱退に戻す。表示名（選手01改）は戻さない
    assert.deepEqual(d2.season.next.broken.restoredMembers.slice().sort(), ['選手07', '選手08']);
    if (f2) {
      failOnce(w.p, f2);
      assert.equal(confirm(w).ok, false, f2);
    }
    const r = confirm(w);
    assert.equal(r.ok, true, String(f2) + ': ' + (r.ok ? '' : r.error.message));
    assert.equal(r.data.eventId, first.data.eventId, '同じ大会 ID');
    assert.deepEqual(differences(snapshot(w, r.data.eventId), baseline), [], String(f2));
    assert.deepEqual(otherLeagueMembers(w), before, '無関係なリーグの会員');
  }
});
