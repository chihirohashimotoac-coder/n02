// 性能改善（同じリクエストの中の重複した組み立ての削減）で、応答・保存内容が変わらないことの確認。
// - 結果の保存の応答の詳細（detail）は、保存の後に改めて取得した eventDetail と同じ
//   （afterEventChange_ の表示・syncPublication_ の公開データを使い回しても、作り直したときと同じ）
// - 自動終了で大会が変わったとき・非公開・期制リーグ・店舗スタッフ（伏せ字）でも同じ
// - まとめて確定の検証は使い回した構成要素でも 1 件ずつ行い、1 つでも不正なら何も保存しない
// - 作成した大会の一覧（myEvents）は、大会ごとに作り直した要約と同じ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const ALICE = 'alice@example.org';
const STAFF_PASS = 'staff-pass-1234';
const names = (n, pre = '選手') => Array.from({ length: n }, (_, i) => ({ name: pre + String(i + 1).padStart(2, '0') }));

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

function allMatches(d) {
  return d.stages.flatMap((s) => (s.groups ? s.groups.flatMap((g) => g.matches) : (s.rounds || []).flatMap((r) => r.matches)));
}

function robin(p, auth, n, extra = {}) {
  const id = p.ok('createEvent', { name: '総当たり', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 }, ...extra }, { auth }).eventId;
  p.ok('importPlayers', { eventId: id, players: names(n) }, { auth });
  const st = p.ok('eventDetail', { eventId: id }, { auth }).stages[0];
  p.ok('autoAssign', { eventId: id, stageId: st.id }, { auth });
  p.ok('generateMatches', { eventId: id, stageId: st.id }, { auth });
  return id;
}

function setPublic(p, auth, eventId, isPublic) {
  const ev = p.ok('eventDetail', { eventId }, { auth }).event;
  p.ok('updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: 'running', isPublic, isFeatured: false, notes: ev.notes }, { auth });
}

/** 保存の応答の detail と、その直後に取得した eventDetail が同じであること */
function assertDetailFresh(p, auth, res, label) {
  assert.ok(res.detail, label + ': detail がある');
  const fresh = p.ok('eventDetail', { eventId: res.detail.event.id }, { auth });
  assert.deepEqual(res.detail, fresh, label + ': 応答の detail = 改めて取得した eventDetail');
}

test('1 試合の保存: 公開・非公開・訂正で、応答の detail は改めて取得した詳細と同じ', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  p.link(alice);
  const id = robin(p, alice, 6);
  setPublic(p, alice, id, true);
  let d = p.ok('eventDetail', { eventId: id }, { auth: alice });
  let m = allMatches(d)[0];
  let res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 1 }, { auth: alice });
  assert.equal(res.publication.published, true);
  assertDetailFresh(p, alice, res, '公開・確定');
  // 訂正
  m = allMatches(res.detail).find((x) => x.id === m.id);
  res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: 0, p2Legs: 2, note: '入力の誤り' }, { auth: alice });
  assertDetailFresh(p, alice, res, '公開・訂正');
  // 進行中の保存
  m = allMatches(res.detail).find((x) => x.status === 'scheduled');
  res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 }, { auth: alice });
  assertDetailFresh(p, alice, res, '公開・進行中');
  // 非公開
  setPublic(p, alice, id, false);
  d = p.ok('eventDetail', { eventId: id }, { auth: alice });
  m = allMatches(d).find((x) => x.status === 'scheduled');
  res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 }, { auth: alice });
  assert.equal(res.publication.published, false);
  assertDetailFresh(p, alice, res, '非公開');
});

test('公開データの大きさ（snapshotBudget）: 保存の応答と改めて作った値が同じ（使い回しは同じ内容から作ったもの）', () => {
  const p = ready();
  const id = robin(p, undefined, 8);
  setPublic(p, undefined, id, true);
  const d = p.ok('eventDetail', { eventId: id });
  const m = allMatches(d)[0];
  const res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 });
  const ctx = p.admin.fn('createContext_')(p.admin.fn('openStorage_')(), '', null);
  const budget = p.admin.fn('snapshotBudget_')(p.admin.fn('collectEvent_')(ctx, id));
  assert.deepEqual(res.detail.snapshotBudget, JSON.parse(JSON.stringify(budget)));
  // 公開データの行は閲覧者用アプリから読める最新の内容（版が詳細の公開状態と一致する）
  assert.equal(res.detail.publication.version, res.publication.version);
});

test('最後の試合の確定で自動終了したとき（大会が変わったので作り直す）・終了後の訂正で再開したときも、detail は最新', () => {
  const p = ready();
  const id = robin(p, undefined, 3);
  setPublic(p, undefined, id, true);
  let d = p.ok('eventDetail', { eventId: id });
  assert.equal(d.event.config.autoFinish, true);
  let res;
  for (const m of allMatches(d)) {
    res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 });
    assertDetailFresh(p, undefined, res, '確定');
  }
  assert.equal(res.detail.event.status, 'finished', '自動で終了');
  assert.ok(res.detail.history.some((h) => h.action === 'event.autoFinish'));
  // 終了後の訂正: 全試合確定のままなので終了のまま（大会は変えない → 使い回し）
  const m = allMatches(res.detail)[0];
  res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: 0, p2Legs: 2, note: '訂正' });
  assertDetailFresh(p, undefined, res, '終了後の訂正');
  assert.equal(res.detail.event.status, 'finished');
});

test('まとめて確定: 応答の detail は最新。不正な結果が 1 つでもあれば何も保存しない（検証は 1 件ずつ）', () => {
  const p = ready();
  const id = robin(p, undefined, 10);
  setPublic(p, undefined, id, true);
  let d = p.ok('eventDetail', { eventId: id });
  const pending = allMatches(d);
  const before = p.store.dump();
  // 3 件目だけ勝敗が決まらない数（Best of 3 で 1-1）
  const bad = pending.slice(0, 5).map((m, i) => ({ matchId: m.id, rev: m.rev, p1Legs: i === 2 ? 1 : 2, p2Legs: 1 }));
  const r1 = p.call('saveMatchResults', { eventId: id, results: bad });
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, 'VALIDATION');
  assert.match(r1.error.message, /どの試合も保存していません/);
  assert.equal(p.store.dump(), before, '何も書き込まない');
  // 古い rev が 1 つでもあれば何も保存しない
  const stale = pending.slice(0, 4).map((m, i) => ({ matchId: m.id, rev: i === 3 ? m.rev + 5 : m.rev, p1Legs: 2, p2Legs: 0 }));
  const r2 = p.call('saveMatchResults', { eventId: id, results: stale });
  assert.equal(r2.ok, false);
  assert.equal(p.store.dump(), before, '何も書き込まない');
  // 正しい結果は保存し、detail は最新
  const good = pending.slice(0, 20).map((m) => ({ matchId: m.id, rev: m.rev, p1Legs: 2, p2Legs: 0 }));
  const res = p.ok('saveMatchResults', { eventId: id, results: good });
  assert.equal(res.saved, 20);
  assertDetailFresh(p, undefined, res, 'まとめて確定');
  assert.equal(allMatches(res.detail).filter((m) => m.status === 'final').length, 20);
});

test('店舗スタッフ・期制リーグでも、保存の応答の detail は改めて取得した詳細と同じ（伏せ字・期の情報を含む）', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  p.link(alice);
  const id = p.ok('createSeasonLeague', { name: '水曜リーグ', thresholds: [], cycles: 1, rule: { format: 'legs', bestOf: 5 } }, { auth: alice }).eventId;
  p.ok('importPlayers', { eventId: id, players: names(6, 'リーグ') }, { auth: alice });
  let d = p.ok('eventDetail', { eventId: id }, { auth: alice });
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id }, { auth: alice });
  p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id }, { auth: alice });
  setPublic(p, alice, id, true);
  d = p.ok('eventDetail', { eventId: id }, { auth: alice });
  assert.ok(d.season, '期制リーグ');
  p.ok('setStaffPassword', { eventId: id, rev: d.event.rev, password: STAFF_PASS }, { auth: alice });
  const staff = p.staffLogin(id, STAFF_PASS);
  d = p.ok('eventDetail', { eventId: id }, { auth: staff });
  let m = allMatches(d)[0];
  let res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 }, { auth: staff });
  assertDetailFresh(p, staff, res, 'スタッフ');
  assert.equal(JSON.stringify(res.detail).includes(ALICE), false, 'スタッフにはメールアドレスを出さない');
  m = allMatches(res.detail).find((x) => x.status === 'scheduled');
  res = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 2 }, { auth: alice });
  assertDetailFresh(p, alice, res, '期制リーグ・主催者');
  assert.ok(res.detail.season);
});

test('作成した大会の一覧（myEvents）: 大会ごとに作り直した要約と同じ（順番・件数・公開状態・権限も）', () => {
  const p = ready();
  let alice = p.loginAs(ALICE);
  p.link(alice);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(p.ok('createSampleEvent', { publish: i % 2 === 0 }, { auth: alice }).eventId);
  ids.push(robin(p, alice, 5));
  p.clock.advance(61 * 60 * 1000);
  alice = p.loginAs(ALICE);
  const bob = p.loginAs('bob@example.net');
  p.link(bob);
  const bobs = p.ok('createSampleEvent', { publish: true }, { auth: bob }).eventId;
  // 結果を少し入れる（進捗が大会ごとに違う）
  const d = p.ok('eventDetail', { eventId: ids[1] }, { auth: alice });
  const m = allMatches(d).filter((x) => x.status === 'scheduled' && x.p1.id && x.p2.id).slice(0, 3);
  m.forEach((x) => p.ok('saveMatchResult', { matchId: x.id, rev: x.rev, status: 'final', p1Legs: 3, p2Legs: 0 }, { auth: alice }));

  const res = p.ok('myEvents', {}, { auth: alice });
  assert.equal(res.events.length, ids.length);
  assert.equal(res.events.some((e) => e.id === bobs), false, '他人の大会は出さない');
  // 期待値: 索引を使わずに大会ごとに組み立てた要約（従来の作り方）
  const fn = p.admin.fn;
  const ctx = fn('createContext_')(fn('openStorage_')(), '', null);
  const events = ctx.table('Events').rows.filter((e) => ids.includes(e.event_id)).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const expected = events.map((e) => {
    const s = fn('summarizeEventView_')(fn('buildEventView_')(fn('collectEvent_')(ctx, e.event_id), false), '');
    if (String(e.updated_at || '') > s.updatedAt) s.updatedAt = String(e.updated_at || '');
    s.isPublic = !!e.is_public;
    s.isSample = !!e.is_sample;
    s.role = 'owner';
    return JSON.parse(JSON.stringify(s));
  });
  assert.equal(JSON.stringify(res.events), JSON.stringify(expected));
});

test('coerceCell_: 文字列を先に返しても、従来と同じ値（文字列・数・日付・空・真偽・整数）', () => {
  const p = ready();
  const coerce = p.admin.fn('coerceCell_');
  const legacy = (value, type) => {
    if (type === 'int' || type === 'bool') return coerce(value, type);
    if (value === null || value === undefined) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') return isNaN(value.getTime()) ? '' : value.toISOString();
    return String(value);
  };
  const d = new p.admin.context.Date(Date.UTC(2026, 10, 3, 1, 2, 3));
  const values = ['', ' a ', 'TRUE', '12', '=x', 0, 12, 1.5, true, false, null, undefined, d, new Date(NaN)];
  for (const type of ['text', 'json', 'int', 'bool']) {
    for (const v of values) assert.deepEqual(coerce(v, type), legacy(v, type), `${type} ${String(v)}`);
  }
});

test('eventRowIndex_: 表の行を event_id ごとに、表の順番のまま返す（filter と同じ）。返す配列はコピー', () => {
  const p = ready();
  for (let i = 0; i < 3; i++) p.ok('createSampleEvent', { publish: false });
  const fn = p.admin.fn;
  const ctx = fn('createContext_')(fn('openStorage_')(), '', null);
  const rowsOf = fn('eventRowIndex_')(ctx);
  const ids = ctx.table('Events').rows.map((e) => e.event_id).concat(['EVT-NONE0000']);
  for (const name of ['Rules', 'Stages', 'Groups', 'Entries', 'Players', 'Matches']) {
    for (const id of ids) {
      const a = rowsOf(name, id);
      const b = ctx.table(name).rows.filter((r) => r.event_id === id);
      assert.equal(a.length, b.length, name);
      a.forEach((r, i) => assert.equal(r, b[i], name + ' の行は同じ記録・同じ順番'));
      a.reverse();
      assert.deepEqual(rowsOf(name, id), b, 'コピーなので並べ替えても索引は変わらない');
    }
  }
});
