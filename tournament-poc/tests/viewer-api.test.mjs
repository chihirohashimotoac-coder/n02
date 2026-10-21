// 閲覧者用 API（getPublicSnapshot）とキャッシュのテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

function published() {
  const p = setupPair();
  p.ok('initializeStorage');
  const d = p.ok('createSampleEvent', { publish: true }).detail;
  return { ...p, eventId: d.event.id, detail: d };
}

test('公開大会がないときは NO_PUBLIC_EVENT（例外ではなく固定文言）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const res = p.viewer.run('getPublicSnapshot', {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NO_PUBLIC_EVENT');
  assert.equal(res.refresh.intervalSec, 60);
});

test('未初期化（シートなし）でも NO_PUBLIC_EVENT を返す', () => {
  const p = setupPair();
  assert.equal(p.viewer.run('getPublicSnapshot', {}).error.code, 'NO_PUBLIC_EVENT');
});

test('公開データ: 大会名・グループ・対戦・Leg 数・状態・勝者を返す', () => {
  const p = published();
  const res = p.viewer.run('getPublicSnapshot', {});
  assert.equal(res.ok, true);
  assert.equal(res.data.event.name, 'サンプル大会（PoC 検証用）');
  assert.equal(res.data.rule.bestOf, 5);
  assert.equal(res.data.rule.provisional, true);
  assert.equal(res.data.groups.length, 4);
  const a = res.data.groups[0];
  assert.equal(a.matches.length, 6);
  const m = a.matches[0];
  assert.equal(m.status, 'final');
  assert.equal(m.p1.legs, 3);
  assert.equal(m.p2.legs, 1);
  assert.equal(m.winnerId, m.p1.id);
  const live = res.data.groups[1].matches.find((x) => x.status === 'live');
  assert.equal(live.winnerId, null, '進行中の試合に勝者は出さない');
  const sched = res.data.groups[3].matches[0];
  assert.equal(sched.status, 'scheduled');
  assert.equal(sched.winnerId, null);
});

test('大会 ID の指定: 公開中の ID は取得でき、非公開・不正な ID は取得できない', () => {
  const p = published();
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: p.eventId }).data.event.id, p.eventId);
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: 'EVT-AAAAAAAAAAAA' }).error.code, 'NO_PUBLIC_EVENT');
  for (const bad of ['../x', 'EVT-<script>', 'x'.repeat(300), 123, { a: 1 }]) {
    assert.equal(p.viewer.run('getPublicSnapshot', { eventId: bad }).error.code, 'BAD_REQUEST', String(bad));
  }
  assert.equal(p.viewer.run('getPublicSnapshot', null).ok, true);
  assert.equal(p.viewer.run('getPublicSnapshot').ok, true);
});

test('キャッシュ: 有効期間中は何回呼んでもシートを読まない（50 回 → 読み込み 1 回）', () => {
  const p = published();
  const reads0 = p.store.stats.reads;
  const opens0 = p.store.stats.opens;
  const results = Array.from({ length: 50 }, () => p.viewer.run('getPublicSnapshot', {}));
  assert.ok(results.every((r) => r.ok));
  assert.equal(p.store.stats.opens - opens0, 1, 'スプレッドシートを開くのは 1 回');
  assert.equal(p.store.stats.reads - reads0, 1, 'シートの読み込みは 1 回');
  assert.equal(results[0].cache, 'miss');
  assert.ok(results.slice(1).every((r) => r.cache === 'hit'));
});

test('キャッシュ: 既定表示と ID 指定は 1 回の読み込みでまとめてキャッシュする', () => {
  const p = published();
  p.viewer.run('getPublicSnapshot', {});
  const opens = p.store.stats.opens;
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: p.eventId }).cache, 'hit');
  assert.equal(p.store.stats.opens, opens);
});

test('キャッシュ失効: 20 秒経過後は読み直し、運営側の更新が反映される', () => {
  const p = published();
  const first = p.viewer.run('getPublicSnapshot', {});
  const m = p.detail.groups[3].matches[0];
  p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  p.clock.advance(10_000);
  const cached = p.viewer.run('getPublicSnapshot', {});
  assert.equal(cached.version, first.version, '有効期間内はキャッシュ');
  p.clock.advance(11_000);
  const fresh = p.viewer.run('getPublicSnapshot', {});
  assert.equal(fresh.cache, 'miss');
  assert.notEqual(fresh.version, first.version);
  assert.equal(fresh.data.groups[3].matches[0].status, 'live');
});

test('knownVersion が最新なら本体を送らない（notModified）', () => {
  const p = published();
  const first = p.viewer.run('getPublicSnapshot', {});
  const second = p.viewer.run('getPublicSnapshot', { knownVersion: first.version });
  assert.equal(second.notModified, true);
  assert.equal(second.data, undefined);
  assert.equal(second.version, first.version);
  assert.ok(p.viewer.run('getPublicSnapshot', { knownVersion: 'old' }).data);
});

test('シートが読めないとき: 予備キャッシュ（stale）を返し、なければ固定文言のエラー', () => {
  const p = published();
  const first = p.viewer.run('getPublicSnapshot', {});
  p.viewer.cache.expireFresh('pub:v1:');
  p.store.failOpen = true;
  const stale = p.viewer.run('getPublicSnapshot', {});
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.version, first.version);
  p.viewer.cache.clear();
  const err = p.viewer.run('getPublicSnapshot', {});
  assert.equal(err.ok, false);
  assert.equal(err.error.code, 'UNAVAILABLE');
  assert.equal(err.error.message, 'データを取得できませんでした。');
  assert.doesNotMatch(JSON.stringify(err), /simulated|Spreadsheets|stack/, '内部のエラー内容を返さない');
  p.store.failOpen = false;
  assert.equal(p.viewer.run('getPublicSnapshot', {}).ok, true, '復旧後は通常どおり');
});

test('ロックを取れないとき（他のリクエストが再読込中）も応答は返す', () => {
  const p = published();
  p.viewer.lockBusy = true;
  const res = p.viewer.run('getPublicSnapshot', {});
  assert.equal(res.ok, true);
});

test('ロックを取れないとき: 予備キャッシュ（stale）があればそれを返し、シートを読みに行かない', () => {
  const p = published();
  const first = p.viewer.run('getPublicSnapshot', {});
  p.viewer.cache.expireFresh('pub:v1:');
  p.viewer.lockBusy = true;
  let reads = 0;
  const original = p.viewer.context.refreshFromSheet_;
  p.viewer.context.refreshFromSheet_ = (...args) => {
    reads++;
    return original(...args);
  };
  const res = p.viewer.run('getPublicSnapshot', {});
  assert.equal(res.ok, true);
  assert.equal(res.stale, true);
  assert.equal(res.version, first.version);
  assert.equal(reads, 0, '待っている側はシートを読まない');
  p.viewer.lockBusy = false;
  assert.equal(p.viewer.run('getPublicSnapshot', {}).ok, true);
  assert.equal(reads, 1, 'ロックを取れた側だけが読み直す');
});

test('公開をやめた大会は、シートが読めないときも予備キャッシュから返さない', () => {
  const p = published();
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: p.eventId }).ok, true);
  const ev = p.ok('eventDetail', { eventId: p.eventId }).event;
  p.ok('updateEvent', { eventId: p.eventId, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: ev.status, isPublic: false, isFeatured: false, notes: ev.notes });
  p.viewer.cache.expireFresh('pub:v1:');
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: p.eventId }).ok, false, '読み直したら非公開');
  // 「公開されていない」の短いキャッシュが切れた後にシートが読めなくなっても、古い内容を出さない
  p.viewer.cache.expireFresh('pub:v1:');
  p.store.failOpen = true;
  const res = p.viewer.run('getPublicSnapshot', { eventId: p.eventId });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UNAVAILABLE');
  const list = JSON.parse(p.viewer.fn('doGet')({ parameter: { format: 'list' } }).getContent());
  assert.ok(!JSON.stringify(list).includes(p.eventId), '一覧の予備にも載らない');
});

test('壊れた公開データ行（接頭辞なし・JSON 不正）は読み飛ばす', () => {
  const p = published();
  const sheet = p.store.get().getSheetByName('PublicSnapshots');
  const header = sheet.rows[0];
  sheet.rows[1][header.indexOf('chunk_01')] = '~{broken';
  p.viewer.cache.clear();
  assert.equal(p.viewer.run('getPublicSnapshot', {}).error.code, 'NO_PUBLIC_EVENT');
  sheet.rows[1][header.indexOf('chunk_01')] = '{"a":1}';
  p.viewer.cache.clear();
  assert.equal(p.viewer.run('getPublicSnapshot', {}).error.code, 'NO_PUBLIC_EVENT');
});

test('既定表示がない場合は最後に公開データを更新した大会を表示する', () => {
  const p = published();
  const ev = p.ok('eventDetail', { eventId: p.eventId }).event;
  p.ok('updateEvent', { eventId: p.eventId, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' });
  p.clock.advance(1000);
  const second = p.ok('createSampleEvent', { publish: true }).detail.event.id;
  p.viewer.cache.clear();
  assert.equal(p.viewer.run('getPublicSnapshot', {}).data.event.id, second);
});

test('キャッシュに入らない大きさの公開データでも応答は返す（キャッシュせずに読む）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const eventId = p.ok('createEvent', { name: 'x'.repeat(80), dateLabel: '', bestOf: 5, groupCount: 16 }).eventId;
  const names = (prefix) => Array.from({ length: 64 }, (_, i) => `${prefix}${'長い名前'.repeat(8)}${i}`);
  p.ok('addPlayers', { eventId, names: names('a') });
  p.ok('addPlayers', { eventId, names: names('b') });
  p.ok('autoAssign', { eventId });
  p.ok('generateMatches', { eventId });
  const ev = p.ok('eventDetail', { eventId }).event;
  p.ok('updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '' });
  const res = p.viewer.run('getPublicSnapshot', {});
  assert.equal(res.ok, true);
  assert.equal(res.data.groups.length, 16);
  assert.ok(p.viewer.logs.some((l) => l[0] === 'warn' && String(l[1]).includes('too large')));
});

test('?format=json: 閲覧ページ（GitHub Pages）用に公開データを JSON で返す', () => {
  const p = published();
  const out = p.viewer.fn('doGet')({ parameter: { format: 'json' } });
  assert.equal(out.mimeType, 'application/json');
  const res = JSON.parse(out.getContent());
  assert.equal(res.ok, true);
  assert.equal(res.data.event.id, p.eventId);
  assert.equal(res.data.groups.length, 4);
  // event・known の指定は getPublicSnapshot と同じ扱い
  const byId = JSON.parse(p.viewer.fn('doGet')({ parameter: { format: 'json', event: p.eventId, known: res.version } }).getContent());
  assert.equal(byId.notModified, true);
  const bad = JSON.parse(p.viewer.fn('doGet')({ parameter: { format: 'json', event: '<x>' } }).getContent());
  assert.equal(bad.error.code, 'BAD_REQUEST');
  // format 指定がなければ従来どおり画面を返す
  assert.match(p.viewer.fn('doGet')({ parameter: {} }).getContent(), /getPublicSnapshot/);
  assert.match(p.viewer.fn('doGet')().getContent(), /getPublicSnapshot/);
});

test('?format=json: シートが読めないときも内部情報を含まない固定文言の JSON を返す', () => {
  const p = published();
  p.viewer.cache.clear();
  p.store.failOpen = true;
  const text = p.viewer.fn('doGet')({ parameter: { format: 'json' } }).getContent();
  const res = JSON.parse(text);
  assert.equal(res.error.code, 'UNAVAILABLE');
  assert.doesNotMatch(text, /simulated|sheets\.spreadsheets|stack/i);
});
