// v0.8: 保存の仕組み（まとめて書き込む・途中で止まった書き込みの検出・スキーマ v2 への移行）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createStore, createClock, loadProject, setupPair, ROOT, SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID, fakeIdToken } from './gas-mock.mjs';

const OLD_CODE = join(ROOT, 'tests', 'fixtures', 'admin-v0.7.1.gs');

/** v0.7.1 のコード（本番で動いている版）で大会を作り、結果を入れた保存先を用意する */
function legacyWorld() {
  const store = createStore();
  const clock = createClock();
  store.add();
  const props = { SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID };
  const old = loadProject('admin', { store, clock, properties: props, codePath: OLD_CODE });
  let n = 0;
  const call = (project, action, payload = {}, auth = { adminKey: ADMIN_KEY }) => project.post({ action, payload, requestId: `legacy-request-${String(++n).padStart(8, '0')}`, auth: auth || undefined });
  const ok = (project, action, payload, auth) => {
    const res = call(project, action, payload, auth);
    if (!res.ok) throw new Error(`${action}: ${res.error.code} ${res.error.message}`);
    return res.data;
  };
  ok(old, 'initializeStorage');
  const session = { session: ok(old, 'login', { idToken: fakeIdToken('legacy@example.org', clock) }, null).session };
  const sample = ok(old, 'createSampleEvent', { publish: true }, session);
  const ko = ok(old, 'createEvent', { name: '旧トーナメント', template: 'elimination', thirdPlace: true, rule: { format: 'legs', bestOf: 3 } }, session).eventId;
  ok(old, 'addPlayers', { eventId: ko, names: ['一', '二', '三', '四', '五'] }, session);
  let d = ok(old, 'eventDetail', { eventId: ko }, session);
  ok(old, 'setEntrants', { eventId: ko, stageId: d.stages[0].id, playerIds: d.players.map((p) => p.id) }, session);
  d = ok(old, 'generateBracket', { eventId: ko, stageId: d.stages[0].id }, session).detail;
  const first = d.stages[0].rounds[0].matches[0];
  ok(old, 'saveMatchResult', { matchId: first.id, rev: first.rev, status: 'final', p1Legs: 2, p2Legs: 1 }, session);
  ok(old, 'setStaffPassword', { eventId: ko, rev: ok(old, 'eventDetail', { eventId: ko }, session).event.rev, password: 'legacy-pass-01' }, session);
  return { store, clock, props, call, ok, old, session, sampleId: sample.eventId, koId: ko };
}

/** 移行前後で変わってはいけない内容（勝敗・順位・シード・主催者・公開状態・パスワードの有無） */
function essentials(detail) {
  return {
    event: { name: detail.event.name, status: detail.event.status, isPublic: detail.event.isPublic, ownerEmail: detail.event.ownerEmail, staffPasswordSet: detail.event.staffPasswordSet },
    stages: detail.stages.map((st) => ({
      type: st.type,
      groups: (st.groups || []).map((g) => ({ standings: g.standings.map((r) => [r.playerId, r.rank, r.won, r.lost, r.legsFor, r.legsAgainst]), matches: g.matches.map((m) => [m.id, m.status, m.winnerId, m.p1.legs, m.p2.legs]) })),
      rounds: (st.rounds || []).map((r) => r.matches.map((m) => [m.id, m.p1.id, m.p2.id, m.status, m.winnerId])),
      entrants: (st.entrants || []).map((e) => [e.id, e.seed]),
    })),
  };
}

test('移行: v0.7.1 で作った保存先を新しい版で開くと、閲覧はでき、書き込みは移行まで止まる。移行後も勝敗・順位・権限は変わらない', () => {
  const w = legacyWorld();
  const before = {
    sample: essentials(w.ok(w.old, 'eventDetail', { eventId: w.sampleId })),
    ko: essentials(w.ok(w.old, 'eventDetail', { eventId: w.koId })),
  };
  const sheetsBefore = w.store.get().sheets.map((s) => s.name);
  // 新しい版（v0.8）に差し替え。スクリプト プロパティ（SCHEMA_VERSION=1）はそのまま
  const props = w.old.properties.getProperties();
  assert.equal(props.SCHEMA_VERSION, '1');
  const next = loadProject('admin', { store: w.store, clock: w.clock, properties: props, cache: w.old.cache });
  // 閲覧（運営画面の読み込み）は移行前でもできる
  const boot = w.ok(next, 'bootstrap');
  assert.equal(boot.storage.initialized, true);
  assert.equal(boot.storage.migrationRequired, true);
  assert.deepEqual(essentials(w.ok(next, 'eventDetail', { eventId: w.sampleId })), before.sample);
  // 公開データの読み込み（閲覧者用）から移行は起動しない
  const viewer = loadProject('viewer', { store: w.store, clock: w.clock, properties: { SPREADSHEET_ID }, activeUser: '' });
  assert.equal(viewer.run('getPublicSnapshot', { eventId: w.sampleId }).ok, true);
  assert.equal(next.properties.getProperty('SCHEMA_VERSION'), '1');
  // 書き込みは移行が終わるまで受け付けない（途中まで書くこともない）
  const dump = w.store.dump();
  const blocked = w.call(next, 'addPlayers', { eventId: w.sampleId, names: ['新人'] });
  assert.equal(blocked.error.code, 'MIGRATION_REQUIRED');
  assert.equal(w.store.dump(), dump);
  // 移行は管理者の鍵だけ。Google ログインの主催者・未認証では実行できない
  assert.equal(w.call(next, 'migrateStorage', {}, w.session).error.code, 'FORBIDDEN');
  assert.equal(w.call(next, 'migrateStorage', {}, null).error.code, 'FORBIDDEN');
  const migrated = w.ok(next, 'migrateStorage');
  assert.equal(migrated.migrateResult.migrated, true);
  assert.equal(migrated.migrateResult.from, 1);
  assert.equal(migrated.migrateResult.to, 2);
  assert.equal(migrated.storage.migrationRequired, false);
  assert.equal(next.properties.getProperty('SCHEMA_VERSION'), '2');
  // バックアップ（同じスプレッドシート内の複製）が全シート分あり、元のシートは残っている
  const names = w.store.get().sheets.map((s) => s.name);
  sheetsBefore.filter((n) => n !== 'シート1').forEach((n) => {
    assert.ok(names.includes(n), n);
    assert.ok(names.some((x) => x.startsWith('bak-s1-') && x.endsWith('-' + n)), 'backup of ' + n);
  });
  assert.ok(names.includes('Collaborators'));
  const events = w.store.get().getSheetByName('Events');
  const backup = w.store.get().sheets.find((s) => s.name.startsWith('bak-s1-') && s.name.endsWith('-Events'));
  assert.deepEqual(backup.records(), events.records().map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'config_json'))));
  // 勝敗・順位・シード・主催者・公開状態・パスワードの有無は変わらない
  assert.deepEqual(essentials(w.ok(next, 'eventDetail', { eventId: w.sampleId })), before.sample);
  assert.deepEqual(essentials(w.ok(next, 'eventDetail', { eventId: w.koId })), before.ko);
  // 既存の大会の管理パスワード・Google ログインはそのまま使える
  const staff = { session: w.ok(next, 'staffLogin', { eventId: w.koId, password: 'legacy-pass-01' }, null).session };
  assert.equal(w.ok(next, 'eventDetail', { eventId: w.koId }, staff).event.name, '旧トーナメント');
  assert.equal(w.ok(next, 'addPlayers', { eventId: w.sampleId, names: ['新人'] }, w.session).added, 1);
  // 2 回目は何もしない（何度呼んでも安全）
  const again = w.ok(next, 'migrateStorage');
  assert.equal(again.migrateResult.migrated, false);
  assert.equal(w.store.get().sheets.filter((s) => s.name.startsWith('bak-')).length, names.filter((x) => x.startsWith('bak-')).length);
  // 既存大会の設定（自動終了など新機能の初期値）で状態を書き換えていない
  assert.equal(w.ok(next, 'eventDetail', { eventId: w.sampleId }).event.status, before.sample.event.status);
});

test('移行: 旧画面の「初期化する」を押しても、バックアップ付きの移行として実行される', () => {
  const w = legacyWorld();
  const next = loadProject('admin', { store: w.store, clock: w.clock, properties: w.old.properties.getProperties() });
  const res = w.ok(next, 'initializeStorage');
  assert.equal(res.migrateResult.migrated, true);
  assert.ok(w.store.get().sheets.some((s) => s.name.startsWith('bak-s1-')));
});

test('まとめて書き込み: 途中で検証に失敗した操作は何も書き込まない', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const d = p.ok('createSampleEvent', { publish: true }).detail;
  const dump = p.store.dump();
  // 2 試合目が不成立のまとめて確定 → 1 試合目も保存しない（既存の保証）。
  const ms = d.groups[3].matches;
  const res = p.call('saveMatchResults', { eventId: d.event.id, results: [{ matchId: ms[0].id, rev: ms[0].rev, p1Legs: 3, p2Legs: 0 }, { matchId: ms[1].id, rev: ms[1].rev, p1Legs: 2, p2Legs: 2 }] });
  assert.equal(res.ok, false);
  assert.equal(p.store.dump(), dump);
});

test('まとめて書き込み: 公開データが上限を超える変更は保存しない（保存してから気づかない）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: '大きな大会', template: 'league', rule: { format: 'legs', bestOf: 5 } }).eventId;
  const names = Array.from({ length: 64 }, (_, i) => '長い名前の選手' + String(i).padStart(3, '0') + 'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰ');
  p.ok('addPlayers', { eventId: id, names });
  p.ok('addPlayers', { eventId: id, names: names.map((n) => n + '二') });
  let d = p.ok('eventDetail', { eventId: id });
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id });
  d = p.ok('eventDetail', { eventId: id });
  p.ok('updateEvent', { eventId: id, rev: d.event.rev, name: d.event.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' });
  const dump = p.store.dump();
  const res = p.call('generateMatches', { eventId: id, stageId: d.stages[0].id });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'TOO_LARGE');
  assert.match(res.error.message, /保存していません/);
  assert.equal(p.store.dump(), dump);
});

test('書き込みが途中で止まった操作: 同じ requestId の再送は実行し直さず、別の操作は履歴に記録して進める', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const d = p.ok('createSampleEvent', {}).detail;
  // 書き込みの途中で Google 側のエラーが起きた状態を作る（最初の書き込みは成功し、2 回目で失敗）
  const book = p.store.get();
  const matches = book.getSheetByName('Matches');
  const original = matches.getRange.bind(matches);
  let fail = true;
  matches.getRange = (...args) => {
    const r = original(...args);
    const set = r.setValues.bind(r);
    r.setValues = (v) => {
      if (fail) throw new Error('Service Spreadsheets failed (simulated)');
      return set(v);
    };
    return r;
  };
  const m = d.groups[3].matches[0];
  const req = { requestId: 'partial-write-000001' };
  const first = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 }, req);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'INTERNAL');
  fail = false;
  const retry = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 }, req);
  assert.equal(retry.error.code, 'PARTIAL_WRITE');
  // 別の操作は進められ、途中で止まった操作のことが履歴に残る
  const other = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 });
  assert.ok(other.detail.history.some((h) => h.action === 'storage.incompleteWrite'));
  assert.equal(p.admin.properties.getProperty('WRITE_JOURNAL'), null);
});
