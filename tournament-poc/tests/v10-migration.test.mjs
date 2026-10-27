// v1.0: スキーマ v3 → v4 の移行（期制リーグのシート・列の追加だけ）と、v0.9.0 へのロールバックの境界。
// 旧版は本番で動いている実物のコード（main d96f3b2 の dist。tests/fixtures/*-v0.9.0.gs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createStore, createClock, loadProject, ROOT, SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID, fakeIdToken } from './gas-mock.mjs';

const V090_ADMIN = join(ROOT, 'tests', 'fixtures', 'admin-v0.9.0.gs');
const V090_VIEWER = join(ROOT, 'tests', 'fixtures', 'viewer-v0.9.0.gs');

function world() {
  const store = createStore();
  const clock = createClock();
  store.add();
  const props = { SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID };
  const old = loadProject('admin', { store, clock, properties: props, codePath: V090_ADMIN });
  let n = 0;
  const call = (project, action, payload = {}, auth = { adminKey: ADMIN_KEY }) => project.post({ action, payload, requestId: `mig-request-${String(++n).padStart(8, '0')}`, auth: auth || undefined });
  const ok = (project, action, payload, auth) => {
    const res = call(project, action, payload, auth);
    if (!res.ok) throw new Error(`${action}: ${res.error.code} ${res.error.message}`);
    return res.data;
  };
  ok(old, 'initializeStorage');
  const login = (project) => ({ session: ok(project, 'login', { idToken: fakeIdToken('owner@gmail.com', clock, { sub: '300000000000000000001' }) }, null).session });
  const session = login(old);
  // v0.9.0 で作ったリーグ（2 ディビジョン）とロビン。結果を入れて公開
  const league = ok(old, 'createEvent', { name: '旧リーグ', template: 'league', divisions: 2, rule: { format: 'legs', bestOf: 3 } }, session).eventId;
  ok(old, 'importPlayers', { eventId: league, players: Array.from({ length: 8 }, (_, i) => ({ name: '旧選手' + (i + 1) })) }, session);
  let d = ok(old, 'eventDetail', { eventId: league }, session);
  ok(old, 'autoAssign', { eventId: league, stageId: d.stages[0].id }, session);
  ok(old, 'generateMatches', { eventId: league, stageId: d.stages[0].id }, session);
  d = ok(old, 'eventDetail', { eventId: league }, session);
  const m = d.stages[0].groups[0].matches[0];
  ok(old, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 }, session);
  ok(old, 'updateEvent', { eventId: league, rev: d.event.rev, name: d.event.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' }, session);
  return { store, clock, props, call, ok, old, session, login, league };
}

function essentials(detail) {
  return {
    event: { name: detail.event.name, status: detail.event.status, isPublic: detail.event.isPublic },
    stages: detail.stages.map((st) => ({ type: st.type, groups: (st.groups || []).map((g) => ({ standings: g.standings.map((r) => [r.playerId, r.rank, r.won, r.lost]), matches: g.matches.map((x) => [x.id, x.status, x.winnerId]) })) })),
  };
}

test('移行（v3 → v4）: 新しい版では書き込みは移行まで止まり（閲覧はできる）、移行はシート・列の追加だけで既存の大会の結果を変えない', () => {
  const w = world();
  const before = essentials(w.ok(w.old, 'eventDetail', { eventId: w.league }));
  const next = loadProject('admin', { store: w.store, clock: w.clock, properties: w.old.properties.getProperties(), cache: w.old.cache });
  assert.equal(next.properties.getProperty('SCHEMA_VERSION'), '3');
  const auth = w.login(next);
  assert.deepEqual(essentials(w.ok(next, 'eventDetail', { eventId: w.league }, auth)), before, '移行前でも読める');
  assert.equal(w.call(next, 'addPlayers', { eventId: w.league, names: ['x'] }, auth).error.code, 'MIGRATION_REQUIRED');
  assert.equal(w.call(next, 'createSeasonLeague', { name: '新リーグ' }, auth).error.code, 'MIGRATION_REQUIRED');
  const res = w.ok(next, 'migrateStorage');
  assert.equal(res.migrateResult.from, 3);
  assert.equal(res.migrateResult.to, 4);
  assert.equal(next.properties.getProperty('SCHEMA_VERSION'), '4');
  const names = w.store.get().sheets.map((s) => s.name);
  ['Leagues', 'LeagueSeasons', 'LeagueMembers'].forEach((n) => assert.ok(names.includes(n), n));
  assert.ok(names.some((x) => x.startsWith('bak-s3-') && x.endsWith('-Players')), 'バックアップ');
  assert.ok(w.store.get().getSheetByName('Players').rows[0].includes('member_id'));
  assert.ok(w.store.get().getSheetByName('Players').records().every((r) => r.member_id === ''), '既存の選手に会員 ID を勝手に付けない');
  assert.deepEqual(essentials(w.ok(next, 'eventDetail', { eventId: w.league }, auth)), before);
  assert.equal(w.ok(next, 'eventDetail', { eventId: w.league }, auth).season.convertible, true, '既存のリーグは主催者が明示的に移行できる');
  assert.equal(w.ok(next, 'migrateStorage').migrateResult.migrated, false, '何度実行しても安全');
});

test('ロールバック: v4 に移行して期制リーグを使った後に v0.9.0 へ戻しても、既存の大会・期の大会を読み書きでき、追加の列・シートを壊さない。戻した後に v1.0 に進めても続きから使える', () => {
  const w = world();
  const props = w.old.properties.getProperties();
  const next = loadProject('admin', { store: w.store, clock: w.clock, properties: props, cache: w.old.cache });
  w.ok(next, 'migrateStorage');
  const auth = w.login(next);
  // v1.0: 期制リーグ（1 期目・6 人）と、分割して公開する大きな大会（30 人のリーグ）
  const s1 = w.ok(next, 'createSeasonLeague', { name: '新リーグ', thresholds: [4], rule: { format: 'legs', bestOf: 3 } }, auth).eventId;
  w.ok(next, 'importPlayers', { eventId: s1, players: Array.from({ length: 6 }, (_, i) => ({ name: '新選手' + (i + 1) })) }, auth);
  let d = w.ok(next, 'eventDetail', { eventId: s1 }, auth);
  w.ok(next, 'autoAssign', { eventId: s1, stageId: d.stages[0].id }, auth);
  w.ok(next, 'generateMatches', { eventId: s1, stageId: d.stages[0].id }, auth);
  d = w.ok(next, 'eventDetail', { eventId: s1 }, auth);
  w.ok(next, 'saveMatchResults', { eventId: s1, results: d.stages[0].groups[0].matches.map((x) => ({ matchId: x.id, rev: x.rev, p1Legs: 2, p2Legs: 0 })) }, auth);
  const pv = w.ok(next, 'previewNextSeason', { eventId: s1 }, auth);
  const s2 = w.ok(next, 'confirmNextSeason', { eventId: s1, planVersion: pv.planVersion }, auth).eventId;
  const big = w.ok(next, 'createEvent', { name: '大きなリーグ', template: 'league', rule: { format: 'legs', bestOf: 3 } }, auth).eventId;
  w.ok(next, 'importPlayers', { eventId: big, players: Array.from({ length: 50 }, (_, i) => ({ name: '大選手' + (i + 1) })) }, auth);
  d = w.ok(next, 'eventDetail', { eventId: big }, auth);
  w.ok(next, 'autoAssign', { eventId: big, stageId: d.stages[0].id }, auth);
  w.ok(next, 'generateMatches', { eventId: big, stageId: d.stages[0].id }, auth);
  d = w.ok(next, 'eventDetail', { eventId: big }, auth);
  const pub = w.ok(next, 'updateEvent', { eventId: big, rev: d.event.rev, name: d.event.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' }, auth);
  assert.equal(pub.publication.partitioned, true);
  const membersBefore = w.store.get().getSheetByName('LeagueMembers').records().length;

  // v0.9.0 に戻す（スクリプト プロパティ SCHEMA_VERSION=4 のまま）
  const old = loadProject('admin', { store: w.store, clock: w.clock, properties: next.properties.getProperties(), cache: next.cache, codePath: V090_ADMIN });
  const oldAuth = w.login(old);
  assert.equal(w.ok(old, 'eventDetail', { eventId: w.league }, oldAuth).event.name, '旧リーグ');
  const d2 = w.ok(old, 'eventDetail', { eventId: s2 }, oldAuth);
  assert.equal(d2.stages[0].type, 'league');
  assert.equal(d2.stages[1].type, 'promotion', '入替戦の段階は旧版でも読める（表示は旧版の扱い）');
  w.ok(old, 'addPlayers', { eventId: s2, names: ['旧版で追加'] }, oldAuth);
  w.ok(old, 'generateMatches', { eventId: s2, stageId: d2.stages[0].id }, oldAuth);
  // 旧版の閲覧者用アプリは分割行（EVT-….Pnn）を読まない。大きな大会は試合一覧のない本体だけを返す（順位表は出る）
  const oldViewer = loadProject('viewer', { store: w.store, clock: w.clock, properties: { SPREADSHEET_ID }, codePath: V090_VIEWER });
  const snap = oldViewer.run('getPublicSnapshot', { eventId: big });
  assert.equal(snap.ok, true);
  assert.equal(snap.data.stages[0].groups[0].matches.length, 0);
  assert.equal(snap.data.stages[0].groups[0].standings.length, 50);
  const list = JSON.parse(oldViewer.fn('doGet')({ parameter: { format: 'list' } }).getContent());
  assert.ok(list.data.events.every((e) => /^EVT-[A-Z0-9]+$/.test(e.id)), '一覧に分割行は出ない');
  // 追加の列・シートは旧版の書き込みで消えない
  const players = w.store.get().getSheetByName('Players');
  assert.ok(players.rows[0].includes('member_id'));
  assert.ok(players.records().filter((r) => r.event_id === s2 && r.display_name !== '旧版で追加').every((r) => /^LMB-/.test(r.member_id)));
  assert.equal(w.store.get().getSheetByName('LeagueMembers').records().length, membersBefore);

  // もう一度 v1.0 に進める: 旧版で足した選手にも会員 ID が付き、期制リーグを続けられる
  const again = loadProject('admin', { store: w.store, clock: w.clock, properties: old.properties.getProperties(), cache: old.cache });
  const auth2 = w.login(again);
  assert.equal(w.ok(again, 'migrateStorage').migrateResult.migrated, false);
  w.ok(again, 'republish', { eventId: s2 }, auth2);
  const d3 = w.ok(again, 'eventDetail', { eventId: s2 }, auth2);
  assert.ok(d3.season.members.every((x) => /^LMB-/.test(x.memberId)));
  assert.equal(d3.season.members.length, 7);
  // 旧版で大会を消すと、分割行が残る（旧版は分割行を知らない）。新しい閲覧者用アプリは、本体のない分割行を返さない
  const parts = w.store.get().getSheetByName('PublicSnapshots').records().filter((r) => r.event_id.startsWith(big + '.P'));
  assert.ok(parts.length >= 1);
  const evBig = w.ok(old, 'eventDetail', { eventId: big }, oldAuth).event;
  w.ok(old, 'deleteEvent', { eventId: big, rev: evBig.rev, confirmName: '大きなリーグ' }, oldAuth);
  const viewer = loadProject('viewer', { store: w.store, clock: w.clock, properties: { SPREADSHEET_ID } });
  const orphan = viewer.run('getPublicSnapshot', { eventId: big, part: parts[0].event_id });
  assert.equal(orphan.ok, false);
  assert.equal(orphan.error.code, 'NO_PUBLIC_EVENT');
});
