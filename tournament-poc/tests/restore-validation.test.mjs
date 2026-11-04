// 監査 PR-04（C-001）: 保存ファイル（JSON）からの復元で、書き込む前にファイルの中身を検査する。
// 拒否したときはどのシートも変えない。旧版（v0.8.0・v0.9.0 の実物のコード）で保存した有効なファイルは読める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createStore, createClock, loadProject, setupPair, ROOT, SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID } from './gas-mock.mjs';

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

/** サンプル大会（16 人・4 組のロビン。結果が一部入っている）を作り、保存ファイルを返す */
function sampleArchive(p) {
  const id = p.ok('createSampleEvent', {}).eventId;
  return { id, archive: p.ok('exportEvent', { eventId: id }) };
}

/** 全シートの中身（拒否したときに何も変わっていないことの確認用） */
const sheets = (p) => JSON.stringify(p.store.get().sheets.map((s) => [s.name, s.rows]));
const clone = (v) => JSON.parse(JSON.stringify(v));

function expectRejected(p, archive, mode, pattern) {
  const before = sheets(p);
  const res = p.call('restoreEvent', { archive, mode });
  assert.equal(res.ok, false, '拒否する');
  assert.equal(res.error.code, 'VALIDATION');
  if (pattern) assert.match(res.error.message, pattern);
  assert.equal(sheets(p), before, 'どのシートも変えない');
}

test('有効な保存ファイル: 設定のみ・結果込みの両方で復元できる（従来どおり）', () => {
  const p = ready();
  const { id, archive } = sampleArchive(p);
  const s = p.ok('restoreEvent', { archive, mode: 'settings' });
  const f = p.ok('restoreEvent', { archive, mode: 'full' });
  const orig = p.ok('eventDetail', { eventId: id });
  const full = p.ok('eventDetail', { eventId: f.eventId });
  const finals = (d) => d.stages[0].groups.flatMap((g) => g.matches).filter((m) => m.status === 'final').length;
  assert.equal(finals(full), finals(orig));
  assert.equal(p.ok('eventDetail', { eventId: s.eventId }).stages.length, orig.stages.length);
});

for (const [label, path] of [['v0.7.1', 'admin-v0.7.1.gs'], ['v0.8.0', 'admin-v0.8.0.gs'], ['v0.9.0', 'admin-v0.9.0.gs']]) {
  test(`旧版（${label} の実物のコード）で保存した有効なファイルを、設定のみ・結果込みで復元できる`, () => {
    const store = createStore();
    store.add();
    const clock = createClock();
    const old = loadProject('admin', { store, clock, properties: { SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID }, codePath: join(ROOT, 'tests', 'fixtures', path) });
    let n = 0;
    const call = (action, payload = {}) => old.post({ action, payload, requestId: `old-request-${String(++n).padStart(8, '0')}`, auth: { adminKey: ADMIN_KEY } });
    assert.equal(call('initializeStorage').ok, true);
    const id = call('createSampleEvent', {}).data.eventId;
    const archive = call('exportEvent', { eventId: id }).data;
    assert.equal(archive.format, 'n02-tournament-archive');
    const p = ready();
    for (const mode of ['settings', 'full']) {
      const res = p.call('restoreEvent', { archive: clone(archive), mode });
      assert.equal(res.ok, true, `${label} ${mode}: ${res.ok ? '' : res.error.message}`);
    }
  });
}

test('ルール: 形式・Best of が不正なファイルは拒否する（結果を保存できない大会を作らない）', () => {
  const p = ready();
  const { archive } = sampleArchive(p);
  for (const [mut, re] of [
    [(a) => (a.tables.Rules[0].best_of = 4), /ルール/],
    [(a) => (a.tables.Rules[0].best_of = 999), /ルール/],
    [(a) => (a.tables.Rules[0].best_of = '=1+2'), /ルール/],
    [(a) => (a.tables.Rules[0].format = 'unknown'), /ルール/],
  ]) {
    for (const mode of ['settings', 'full']) {
      const a = clone(archive);
      mut(a);
      expectRejected(p, a, mode, re);
    }
  }
});

test('ルールの名前・メモはファイルの値を使わず、形式から作り直す', () => {
  const p = ready();
  const { archive } = sampleArchive(p);
  const a = clone(archive);
  a.tables.Rules[0].name = '=IMPORTXML("https://example.invalid/","//a")';
  a.tables.Rules[0].notes = '@SUM(A1)';
  const res = p.ok('restoreEvent', { archive: a, mode: 'settings' });
  const rules = p.store.get().getSheetByName('Rules').records().filter((r) => r.event_id === res.eventId);
  assert.ok(rules.length > 0);
  assert.ok(rules.every((r) => !/^[=+@-]/.test(r.name) && !/^[=+@-]/.test(r.notes)));
});

test('文字列: 先頭が = + @ の値・長すぎる値・制御文字は、どの列でも拒否する', () => {
  const p = ready();
  const { archive } = sampleArchive(p);
  const formula = '=IMPORTXML("https://example.invalid/","//a")';
  const cases = [
    ['settings', (a) => (a.tables.Stages[0].name = formula)],
    ['settings', (a) => (a.tables.Stages[0].name = 'x'.repeat(5000))],
    ['settings', (a) => (a.tables.Groups[0].name = '+cmd')],
    ['settings', (a) => (a.tables.Groups[0].name = '@x')],
    ['full', (a) => (a.tables.Players[0].affiliation = formula)],
    ['full', (a) => (a.tables.Players[0].notes = '=1+1')],
    ['full', (a) => (a.tables.Players[0].affiliation = 'a\u0000b')],
    ['full', (a) => (a.tables.Players[0].rating = '=1')],
    ['full', (a) => (a.tables.Matches[0].label = formula)],
    ['full', (a) => (a.tables.Matches[0].result_note = '-A1+1')],
    ['full', (a) => (a.tables.Matches[0].confirmed_at = '=NOW()')],
    ['full', (a) => (a.tables.Entries[0].source_label = formula)],
    ['full', (a) => (a.tables.Matches[0].schedule_json = formula)],
    ['full', (a) => (a.tables.Matches[0].meta_json = '{"x":"' + 'y'.repeat(60000) + '"}')],
    ['settings', (a) => (a.tables.Stages[0].config_json = '[1,2]')],
    ['settings', (a) => (a.tables.Stages[0].config_json = formula)],
    ['settings', (a) => (a.event.date_label = formula)],
    ['settings', (a) => (a.event.config_json = '{"announcement":"' + 'z'.repeat(60000) + '"}')],
  ];
  for (const [mode, mut] of cases) {
    const a = clone(archive);
    mut(a);
    expectRejected(p, a, mode);
  }
});

test('数値・列挙値: 整数でない値、範囲外、不明な状態・結果の種類は拒否する', () => {
  const p = ready();
  const { archive } = sampleArchive(p);
  const cases = [
    ['full', (a) => (a.tables.Matches[0].round = '=1+1')],
    ['full', (a) => (a.tables.Matches[0].player1_legs = -1)],
    ['full', (a) => (a.tables.Matches[0].player1_legs = 1.5)],
    ['full', (a) => (a.tables.Matches[0].status = 'done')],
    ['full', (a) => (a.tables.Matches[0].result_type = 'magic')],
    ['full', (a) => (a.tables.Matches[0].bracket_side = 'Q')],
    ['full', (a) => (a.tables.Matches[0].next_match_slot = 3)],
    ['full', (a) => (a.tables.Entries[0].seed = 'abc')],
    ['settings', (a) => (a.tables.Stages[0].order = '=2')],
    ['settings', (a) => (a.tables.Groups[0].order = -3)],
  ];
  for (const [mode, mut] of cases) {
    const a = clone(archive);
    mut(a);
    expectRejected(p, a, mode);
  }
});

test('参照の矛盾: 重複した ID、別の段階のグループを指す試合・出場者は拒否する', () => {
  const p = ready();
  const { archive } = sampleArchive(p);
  // サンプルは 1 段階なので、2 つ目の段階とグループを足してから矛盾させる
  const withSecond = (a) => {
    const st = clone(a.tables.Stages[0]);
    st.stage_id = 'STG-' + 'B'.repeat(12);
    st.order = 2;
    a.tables.Stages.push(st);
    const g = clone(a.tables.Groups[0]);
    g.group_id = 'GRP-' + 'B'.repeat(12);
    g.stage_id = st.stage_id;
    a.tables.Groups.push(g);
    return g.group_id;
  };
  const cases = [
    ['full', (a) => a.tables.Matches.push(clone(a.tables.Matches[0]))],
    ['full', (a) => a.tables.Players.push(Object.assign(clone(a.tables.Players[0]), { display_name: '別名' }))],
    ['settings', (a) => a.tables.Groups.push(Object.assign(clone(a.tables.Groups[0]), { name: '別名' }))],
    ['full', (a) => (a.tables.Matches[0].group_id = withSecond(a))],
    ['full', (a) => (a.tables.Entries[0].group_id = withSecond(a))],
  ];
  for (const [mode, mut] of cases) {
    const a = clone(archive);
    mut(a);
    expectRejected(p, a, mode);
  }
});

test('拒否されたファイルを直して送り直すと復元できる（拒否で途中まで登録されていない）', () => {
  const p = ready();
  const { archive } = sampleArchive(p);
  const bad = clone(archive);
  bad.tables.Rules[0].best_of = 4;
  expectRejected(p, bad, 'full');
  const events = p.store.get().getSheetByName('Events').records().length;
  p.ok('restoreEvent', { archive: clone(archive), mode: 'full' });
  assert.equal(p.store.get().getSheetByName('Events').records().length, events + 1);
});

/* ---------- 10 形式の大会を進めて保存したファイルは、検査を通って復元できる（誤って拒否しない） ---------- */

function allMatches(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  if (st.nights) return st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches));
  return (st.rounds || []).flatMap((r) => r.matches);
}

function playAll(p, id, stageId) {
  for (let k = 0; k < 400; k++) {
    const d = p.ok('eventDetail', { eventId: id });
    const st = d.stages.find((s) => s.id === stageId);
    const m = allMatches(st).find((x) => (x.status === 'scheduled' || x.status === 'live') && x.p1 && x.p2);
    if (!m) return;
    const need = m.format === 'fixed' ? null : Math.floor(m.bestOf / 2) + 1;
    const win = m.p1.name < m.p2.name ? 1 : 2;
    const res = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: win === 1 ? need || m.bestOf : 0, p2Legs: win === 2 ? need || m.bestOf : 0 });
    if (!res.ok) throw new Error(m.label + ': ' + res.error.message);
  }
}

function runEvent(p, template, extra) {
  const id = p.ok('createEvent', { name: '形式 ' + template, template, rule: { format: 'legs', bestOf: 3 }, ...extra }).eventId;
  p.ok('addPlayers', { eventId: id, names: Array.from({ length: 8 }, (_, i) => '選手' + String(i + 1).padStart(2, '0')) });
  // 棄権の記録（結果の種類・メモ）も保存ファイルに入れる
  let withdrew = false;
  for (let guard = 0; guard < 12; guard++) {
    const d = p.ok('eventDetail', { eventId: id });
    let progressed = false;
    for (const st of d.stages) {
      const matches = allMatches(st);
      if ((st.type === 'round_robin' || st.type === 'league') && !matches.length) {
        if (!(st.groups || []).some((g) => g.standings.length) && st === d.stages[0]) p.ok('autoAssign', { eventId: id, stageId: st.id });
        const r = p.call('generateMatches', { eventId: id, stageId: st.id });
        if (r.ok) progressed = true;
      } else if ((st.type === 'single_elimination' || st.type === 'double_elimination') && !matches.length) {
        if (st === d.stages[0]) p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
        const r = p.call('generateBracket', { eventId: id, stageId: st.id });
        if (r.ok) progressed = true;
      } else if (st.type === 'swiss' && !st.complete) {
        if (st === d.stages[0] && !matches.length && !(st.groups || []).some((g) => g.standings.length)) p.ok('autoAssign', { eventId: id, stageId: st.id });
        if (!matches.some((m) => m.status !== 'final')) {
          const r = p.call('generateSwissRound', { eventId: id, stageId: st.id });
          if (r.ok) progressed = true;
        }
      } else if (st.type === 'series') {
        if (st === d.stages[0] && !st.entries.length) p.ok('autoAssign', { eventId: id, stageId: st.id });
        const night = st.nights.find((n) => !n.rounds.length && n.status !== 'cancelled');
        if (night && !matches.some((m) => m.status !== 'final')) {
          const r = p.call('generateNight', { eventId: id, groupId: night.id });
          if (r.ok) progressed = true;
        }
      }
      if (!withdrew && st === d.stages[0] && allMatches(p.ok('eventDetail', { eventId: id }).stages[0]).length && st.type !== 'series') {
        const pl = d.players[7];
        const r = p.call('withdrawPlayer', { eventId: id, playerId: pl.id, rev: pl.rev, kind: 'withdrawn', reason: '体調不良' });
        withdrew = r.ok;
      }
      playAll(p, id, st.id);
      const after = p.ok('eventDetail', { eventId: id }).stages.find((s) => s.id === st.id);
      if (after.config && after.config.advancement && after.config.advancement.length && !after.advanced) {
        const r = p.call('confirmAdvancement', { eventId: id, stageId: st.id });
        if (r.ok) progressed = true;
      }
    }
    if (!progressed) break;
  }
  return id;
}

test('10 形式の大会（結果・進出・棄権を含む）を保存したファイルは、結果込み・設定のみの両方で復元できる', () => {
  const p = ready();
  const extra = {
    robin_ko: { groupCount: 2, advanceCount: 2, thirdPlace: true },
    robin_ab: { groupCount: 2, advanceCount: 2 },
    robin: { groupCount: 2 },
    league: { divisions: 1 },
    league_playoff: { divisions: 2, playoff: 4 },
    multi_robin_ko: { groupCount: 2, advanceCount: 3, groupCount2: 1, advanceCount2: 2 },
    series_playoff: { nights: 2, playoff: 4 },
    swiss: { swissRounds: 3 },
    double_elimination: {},
    elimination: { thirdPlace: true },
  };
  const formats = JSON.parse(JSON.stringify(loadProject('admin').context.TOURNAMENT_FORMATS)).map((f) => f.id);
  assert.equal(formats.length, 10);
  for (const template of formats) {
    const id = runEvent(p, template, extra[template] || {});
    const archive = p.ok('exportEvent', { eventId: id });
    const finals = archive.tables.Matches.filter((m) => m.status === 'final').length;
    assert.ok(finals > 0, template + ': 結果が入っている');
    for (const mode of ['full', 'settings']) {
      const res = p.call('restoreEvent', { archive: clone(archive), mode });
      assert.equal(res.ok, true, `${template} ${mode}: ${res.ok ? '' : res.error.message}`);
    }
  }
});
