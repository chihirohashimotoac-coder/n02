// 監査 PR-05（W-001 / C-047）の保存側: 作成・追加の操作は、二重実行防止のキャッシュ（10 分）が消えた後に
// 同じ requestId で再送されても、別の操作として実行し直さない。作ったレコードに要求の印を残して照合する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

const rows = (p, sheet) => p.store.get().getSheetByName(sheet).records().length;
const ELEVEN_MINUTES = 11 * 60 * 1000;

/** 同じ requestId で 2 回送る（間にキャッシュの期限切れを挟む）。2 回目の応答と、件数が増えていないことを返す */
function sendTwice(p, action, payload, sheet, auth) {
  const req = { requestId: 'durable-' + action + '-000000001', ...(auth ? { auth } : {}) };
  const first = p.call(action, payload, req);
  assert.equal(first.ok, true, action + ': ' + (first.ok ? '' : first.error.message));
  const count = rows(p, sheet);
  p.clock.advance(ELEVEN_MINUTES);
  const second = p.call(action, payload, req);
  return { first: first.data, second, count, after: rows(p, sheet) };
}

test('作成の操作（大会・サンプル・期制リーグ）: キャッシュが消えた後の再送でも 2 つ目を作らず、同じ大会を返す', () => {
  const p = ready();
  for (const [action, payload] of [
    ['createEvent', { name: '再送の確認', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }],
    ['createSampleEvent', {}],
    ['createSeasonLeague', { name: '再送の期制', thresholds: [4], rule: { format: 'legs', bestOf: 3 } }],
  ]) {
    const r = sendTwice(p, action, payload, 'Events');
    assert.equal(r.second.ok, true, action);
    assert.equal(r.second.data.duplicate, true, action + ': 前の送信で保存済みとして返す');
    assert.equal(r.second.data.eventId, r.first.eventId, action + ': 同じ大会');
    assert.equal(r.after, r.count, action + ': 大会が増えない');
  }
});

test('複製・復元: キャッシュが消えた後の再送でも 2 つ目を作らない', () => {
  const p = ready();
  const src = p.ok('createSampleEvent', {}).eventId;
  const archive = p.ok('exportEvent', { eventId: src });
  for (const [action, payload] of [
    ['duplicateEvent', { eventId: src, name: '複製の再送' }],
    ['restoreEvent', { archive, mode: 'settings' }],
  ]) {
    const r = sendTwice(p, action, payload, 'Events');
    assert.equal(r.second.ok, true, action);
    assert.equal(r.second.data.duplicate, true, action);
    assert.equal(r.second.data.eventId, r.first.eventId, action);
    assert.equal(r.after, r.count, action);
  }
});

test('追加の操作（選手の追加・CSV 取込・段階の追加）: キャッシュが消えた後の再送でも 2 回追加しない', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: '追加の再送', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  for (const [action, payload, sheet] of [
    ['addPlayers', { eventId: id, names: ['再送A', '再送B'] }, 'Players'],
    ['importPlayers', { eventId: id, players: [{ name: '取込A' }, { name: '取込B' }] }, 'Players'],
    ['addStage', { eventId: id, type: 'single_elimination', name: '決勝' }, 'Stages'],
  ]) {
    const r = sendTwice(p, action, payload, sheet);
    assert.equal(r.second.ok, true, action + ': ' + (r.second.ok ? '' : r.second.error.message));
    assert.equal(r.second.data.duplicate, true, action);
    assert.equal(r.second.data.eventId, id, action);
    assert.equal(r.after, r.count, action + ': 行が増えない');
  }
});

test('別の requestId・別の利用者の同じ requestId は、別の操作として実行する（印は利用者ごと）', () => {
  const p = ready();
  const alice = p.loginAs('alice.dedupe@gmail.com', { sub: '300000000000000000011' });
  const bob = p.loginAs('bob.dedupe@gmail.com', { sub: '300000000000000000012' });
  const payload = { name: '同じ名前', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } };
  const a1 = p.call('createEvent', payload, { requestId: 'same-request-id-00000001', auth: alice });
  const b1 = p.call('createEvent', payload, { requestId: 'same-request-id-00000001', auth: bob });
  const a2 = p.call('createEvent', payload, { requestId: 'other-request-id-0000001', auth: alice });
  assert.ok(a1.ok && b1.ok && a2.ok);
  assert.ok(!b1.data.duplicate && !a2.data.duplicate);
  assert.equal(new Set([a1.data.eventId, b1.data.eventId, a2.data.eventId]).size, 3);
  // 他人の印には当たらない（bob が alice の requestId で再送しても alice の大会は返らない）
  p.clock.advance(ELEVEN_MINUTES);
  const b2 = p.call('createEvent', payload, { requestId: 'same-request-id-00000001', auth: bob });
  assert.equal(b2.data.eventId, b1.data.eventId);
});

test('要求の印は運営画面・閲覧ページの応答に出ず（保存ファイルには行のまま入る）、複製・復元した大会には引き継がない', () => {
  const p = ready();
  const id = p.call('createEvent', { name: '印の確認', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, { requestId: 'mark-check-0000000001' }).data.eventId;
  p.call('addPlayers', { eventId: id, names: ['印A', '印B'] }, { requestId: 'mark-check-0000000002' });
  const d = p.ok('eventDetail', { eventId: id });
  assert.doesNotMatch(JSON.stringify(d), /requestMark/);
  const ev = d.event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' });
  assert.doesNotMatch(JSON.stringify(p.viewer.run('getPublicSnapshot', { eventId: id })), /requestMark/);
  const archive = p.ok('exportEvent', { eventId: id });
  const copy = p.ok('restoreEvent', { archive, mode: 'full' }).eventId;
  const dup = p.ok('duplicateEvent', { eventId: id, name: '印の複製', includePlayers: true }).eventId;
  const marks = (eventId) => {
    const book = p.store.get();
    const ev2 = book.getSheetByName('Events').records().find((r) => r.event_id === eventId);
    const players = book.getSheetByName('Players').records().filter((r) => r.event_id === eventId);
    return [ev2.config_json, ...players.map((x) => x.meta_json)].join(' ');
  };
  // 復元・複製した大会の印は、その操作自身の印だけ（元の大会の作成・追加の印は持ち込まない）
  assert.doesNotMatch(marks(copy).replace(/"requestMark":"[0-9a-f]+"/, ''), /requestMark/);
  assert.doesNotMatch(marks(dup).replace(/"requestMark":"[0-9a-f]+"/, ''), /requestMark/);
});

/** Events のシートへの書き込みを 1 回だけ失敗させる（大会の行より後の History で失敗させる場合は 'History'） */
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
}

test('書き込みが途中で止まった作成: 大会の行まで書けていれば再送は保存済みとして返し、書けていなければ従来どおり PARTIAL_WRITE', () => {
  // 大会の行の後（履歴）で止まった → 大会はできている
  const p = ready();
  failOnce(p, 'History');
  const req = { requestId: 'partial-create-00000001' };
  const payload = { name: '途中で止まる', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } };
  const first = p.call('createEvent', payload, req);
  assert.equal(first.ok, false);
  const events = rows(p, 'Events');
  const retry = p.call('createEvent', payload, req);
  assert.equal(retry.ok, true, retry.ok ? '' : retry.error.code);
  assert.equal(retry.data.duplicate, true);
  assert.ok(retry.data.eventId);
  assert.equal(rows(p, 'Events'), events, '2 つ目を作らない');

  // 大会の行より前（ルール）で止まった → 大会の行はない。何ができたか分からないので実行し直さない
  const q = ready();
  failOnce(q, 'Rules');
  const req2 = { requestId: 'partial-create-00000002' };
  assert.equal(q.call('createEvent', payload, req2).ok, false);
  const retry2 = q.call('createEvent', payload, req2);
  assert.equal(retry2.ok, false);
  assert.equal(retry2.error.code, 'PARTIAL_WRITE');
});

test('版番号で守られた操作は従来どおり: キャッシュが消えた後の再送は、更新の競合として止まる（2 回反映しない）', () => {
  const p = ready();
  const d = p.ok('createSampleEvent', {}).detail;
  const m = d.groups[3].matches[0];
  const req = { requestId: 'rev-guarded-0000000001' };
  const payload = { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 };
  assert.equal(p.call('saveMatchResult', payload, req).ok, true);
  p.clock.advance(ELEVEN_MINUTES);
  const again = p.call('saveMatchResult', payload, req);
  assert.equal(again.ok, false);
  assert.ok(['CONFLICT', 'ALREADY_FINAL'].includes(again.error.code), again.error.code);
});
