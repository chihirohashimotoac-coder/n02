// ポータル「トーナメント・リーグ」用の API: 公開大会の一覧（閲覧者用 ?format=list）と作成した大会の一覧（運営用 myEvents）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const ALICE = 'alice@example.org';
const BOB = 'bob@example.net';

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

/** 閲覧者用 Web アプリの ?format=list（GitHub Pages のポータルが fetch で読む口） */
function list(p, known = '') {
  return JSON.parse(p.viewer.fn('doGet')({ parameter: { format: 'list', known } }).getContent());
}

const names = (n) => Array.from({ length: n }, (_, i) => `選手${String(i + 1).padStart(2, '0')}`);

/** 公開状態・状態を変える（主催者のセッションで） */
function setEvent(p, auth, eventId, patch) {
  const ev = p.ok('eventDetail', { eventId }, { auth }).event;
  return p.ok('updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: ev.status, isPublic: ev.isPublic, isFeatured: ev.isFeatured, notes: ev.notes, ...patch }, { auth });
}

function finishStage(p, auth, eventId, stageId) {
  let d = p.ok('eventDetail', { eventId }, { auth });
  for (;;) {
    const st = d.stages.find((s) => s.id === stageId);
    const all = st.groups ? st.groups.flatMap((g) => g.matches) : st.rounds.flatMap((r) => r.matches);
    const m = all.find((x) => x.status === 'scheduled' || x.status === 'live');
    if (!m) return d;
    d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }, { auth }).detail;
  }
}

test('公開一覧: 公開中の大会だけを要約で返し、非公開・削除済みの大会は載らない', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const pub = p.ok('createSampleEvent', { publish: true }, { auth: alice }).eventId;
  const hidden = p.ok('createEvent', { name: '非公開の大会SECRET-NAME', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 5 } }, { auth: alice }).eventId;
  const gone = p.ok('createSampleEvent', { publish: true }, { auth: alice }).eventId;
  const ev = p.ok('exportEvent', { eventId: gone }, { auth: alice });
  assert.ok(ev);
  const detail = p.ok('eventDetail', { eventId: gone }, { auth: alice });
  p.ok('deleteEvent', { eventId: gone, rev: detail.event.rev, confirmName: detail.event.name }, { auth: alice });

  const res = list(p);
  assert.equal(res.ok, true);
  const ids = res.data.events.map((e) => e.id);
  assert.deepEqual(ids, [pub]);
  assert.ok(!ids.includes(hidden));
  assert.ok(!JSON.stringify(res).includes('SECRET-NAME'));

  // 公開に切り替えると載り、非公開に戻すと消える（運営の保存で公開データが同期される）
  setEvent(p, alice, hidden, { isPublic: true });
  p.viewer.cache.clear();
  assert.deepEqual(list(p).data.events.map((e) => e.id).sort(), [pub, hidden].sort());
  setEvent(p, alice, hidden, { isPublic: false });
  p.viewer.cache.clear();
  assert.deepEqual(list(p).data.events.map((e) => e.id), [pub]);
});

test('公開一覧の要約: 人数・試合数・確定数・進捗率・形式・現在の段階・更新時刻。非公開情報は含まない', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const id = p.ok('createSampleEvent', { publish: true }, { auth: alice }).eventId;
  const d = p.ok('eventDetail', { eventId: id }, { auth: alice });
  p.ok('updateEvent', { eventId: id, rev: d.event.rev, name: d.event.name, dateLabel: '2026/11/03', status: 'running', isPublic: true, isFeatured: false, notes: '運営メモSECRET-MEMO' }, { auth: alice });
  const s = list(p).data.events[0];
  assert.equal(s.name, d.event.name);
  assert.equal(s.dateLabel, '2026/11/03');
  assert.equal(s.status, 'running');
  assert.equal(s.playerCount, 16);
  assert.equal(s.matchCount, d.progress.total);
  assert.equal(s.finalCount, d.progress.final);
  assert.equal(s.liveCount, d.progress.live);
  assert.equal(s.progress.percent, Math.floor((d.progress.final * 100) / d.progress.total));
  assert.deepEqual(s.format, { kind: 'robin', label: 'ロビン', flow: 'ロビン' });
  assert.equal(s.currentStage.name, d.stages[0].name);
  assert.equal(s.currentStage.state, 'running');
  assert.match(s.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const text = JSON.stringify(list(p));
  for (const secret of ['SECRET-MEMO', ALICE, 'owner', 'staff', 'pass', '"rev"', 'notes', 'history', 'サンプル選手']) {
    assert.ok(!text.includes(secret), `一覧に ${secret} が含まれている`);
  }
});

test('公開一覧: 版が同じなら notModified で本文を返さない。変更があれば新しい版になる', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const id = p.ok('createSampleEvent', { publish: true }, { auth: alice }).eventId;
  const first = list(p);
  const again = list(p, first.version);
  assert.equal(again.notModified, true);
  assert.equal(again.data, undefined);
  setEvent(p, alice, id, { status: 'finished' });
  p.viewer.cache.clear();
  const changed = list(p, first.version);
  assert.notEqual(changed.version, first.version);
  assert.equal(changed.data.events[0].status, 'finished');
});

test('公開一覧: 一覧はキャッシュから返し、閲覧ごとにシートを読まない（大会ごとの問い合わせも発生しない）', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  p.ok('createSampleEvent', { publish: true }, { auth: alice });
  p.ok('createSampleEvent', { publish: true }, { auth: alice });
  p.viewer.cache.clear();
  list(p);
  const reads = p.store.stats.reads;
  for (let i = 0; i < 20; i++) assert.equal(list(p).data.events.length, 2);
  assert.equal(p.store.stats.reads, reads);
  // 一覧を読んだ後の大会ごとの閲覧も同じ読み込みのキャッシュから返る
  const ev = list(p).data.events[0];
  assert.equal(JSON.parse(p.viewer.fn('doGet')({ parameter: { format: 'json', event: ev.id } }).getContent()).ok, true);
  assert.equal(p.store.stats.reads, reads);
});

test('公開大会がない・未初期化でも、一覧は空で返す（例外にしない）', () => {
  const p = setupPair();
  const res = list(p);
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.events, []);
});

test('進捗率: まだトーナメント表がない段階があるときは 100% にしない。表を作ると見積もりが実数になる', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const id = p.ok('createEvent', { name: 'AB', template: 'robin_ab', groupCount: 2, advanceCount: 2, thirdPlace: false, rule: { format: 'legs', bestOf: 5 } }, { auth: alice }).eventId;
  let d = p.ok('eventDetail', { eventId: id }, { auth: alice });
  const [robin, A, B] = d.stages;
  p.ok('addPlayers', { eventId: id, names: names(8) }, { auth: alice });
  p.ok('autoAssign', { eventId: id, stageId: robin.id }, { auth: alice });
  p.ok('generateMatches', { eventId: id, stageId: robin.id }, { auth: alice });
  setEvent(p, alice, id, { isPublic: true, status: 'running' });
  finishStage(p, alice, id, robin.id);
  p.viewer.cache.clear();
  let s = list(p).data.events[0];
  assert.equal(s.matchCount, 12);
  assert.equal(s.finalCount, 12);
  // ロビンは全試合確定でも、A/B トーナメントは出場者がまだいない（見積もれない）
  assert.equal(s.progress.complete, false);
  assert.ok(s.progress.percent < 100, `percent=${s.progress.percent}`);
  assert.equal(s.progress.pendingStages, 2);
  assert.equal(s.progress.partial, true);
  assert.deepEqual(s.format, { kind: 'mixed', label: '複合', flow: 'ロビン → トーナメント' });
  assert.equal(s.currentStage.name, A.name);
  assert.equal(s.currentStage.state, 'ungenerated');

  // 進出を確定すると出場者が決まり、トーナメントの試合数（4 名 → 3 試合 × 2）を見積もれる
  p.ok('confirmAdvancement', { eventId: id, stageId: robin.id }, { auth: alice });
  p.viewer.cache.clear();
  s = list(p).data.events[0];
  assert.equal(s.progress.partial, false);
  assert.equal(s.progress.estimated, 6);
  assert.equal(s.progress.percent, Math.floor((12 * 100) / 18));

  p.ok('generateBracket', { eventId: id, stageId: A.id }, { auth: alice });
  p.ok('generateBracket', { eventId: id, stageId: B.id }, { auth: alice });
  finishStage(p, alice, id, A.id);
  finishStage(p, alice, id, B.id);
  p.viewer.cache.clear();
  s = list(p).data.events[0];
  assert.equal(s.progress.complete, true);
  assert.equal(s.progress.percent, 100);
  assert.equal(s.currentStage.state, 'done');
  assert.equal(s.finalCount, s.matchCount);
});

test('作成した大会: Google でログインした本人の大会だけを、非公開・準備中も含めて返す', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const bob = p.loginAs(BOB);
  const a1 = p.ok('createSampleEvent', { publish: true }, { auth: alice }).eventId;
  const a2 = p.ok('createEvent', { name: 'アリスの非公開', template: 'elimination', rule: { format: 'legs', bestOf: 3 } }, { auth: alice }).eventId;
  const b1 = p.ok('createEvent', { name: 'ボブの非公開BOB-SECRET', template: 'league', rule: { format: 'legs', bestOf: 3 } }, { auth: bob }).eventId;

  const mine = p.ok('myEvents', {}, { auth: alice });
  assert.equal(mine.email, ALICE);
  assert.deepEqual(mine.events.map((e) => e.id).sort(), [a1, a2].sort());
  const priv = mine.events.find((e) => e.id === a2);
  assert.equal(priv.isPublic, false);
  assert.equal(priv.status, 'draft');
  assert.deepEqual(priv.format, { kind: 'tournament', label: 'トーナメント', flow: 'トーナメント' });
  assert.equal(priv.playerCount, 0);
  assert.equal(mine.events.find((e) => e.id === a1).isPublic, true);
  assert.ok(!JSON.stringify(mine).includes('BOB-SECRET'));
  assert.ok(!JSON.stringify(mine).includes('staff'));

  assert.deepEqual(p.ok('myEvents', {}, { auth: bob }).events.map((e) => e.id), [b1]);
});

test('作成した大会: 送られたメールアドレスや大会 ID では絞り込まない（セッションだけで判断する）', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const bob = p.loginAs(BOB);
  p.ok('createEvent', { name: 'アリスの大会', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, { auth: alice });
  const res = p.ok('myEvents', { email: ALICE, ownerEmail: ALICE, eventId: 'EVT-0000' }, { auth: bob });
  assert.equal(res.email, BOB);
  assert.deepEqual(res.events, []);
});

test('作成した大会: 未ログイン・管理パスワードのセッション・期限切れ・偽のセッションでは返さない', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const id = p.ok('createSampleEvent', { publish: true }, { auth: alice }).eventId;
  const ev = p.ok('eventDetail', { eventId: id }, { auth: alice }).event;
  p.ok('setStaffPassword', { eventId: id, rev: ev.rev, password: 'staff-pass-1234' }, { auth: alice });
  const staff = p.staffLogin(id, 'staff-pass-1234');

  assert.equal(p.call('myEvents', {}, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  assert.equal(p.call('myEvents', {}, { auth: staff }).error.code, 'AUTH_REQUIRED');
  assert.equal(p.call('myEvents', {}, { auth: { session: 'f'.repeat(64) } }).error.code, 'AUTH_EXPIRED');
  assert.equal(p.call('myEvents', {}, { auth: { session: '<script>' } }).error.code, 'AUTH_EXPIRED');
  // 管理者の鍵でも「作成した大会」は返さない（管理者は運営画面の #admin を使う）
  assert.equal(p.call('myEvents', {}).error.code, 'AUTH_REQUIRED');
  // 6 時間を過ぎたセッション
  p.clock.advance(6 * 3600 * 1000 + 1000);
  assert.equal(p.call('myEvents', {}, { auth: alice }).error.code, 'AUTH_EXPIRED');
});

test('他人の大会: Google ログインだけでは運営できず、管理パスワードでスタッフとして運営できる', () => {
  const p = ready();
  const alice = p.loginAs(ALICE);
  const bob = p.loginAs(BOB);
  const id = p.ok('createSampleEvent', { publish: true }, { auth: alice }).eventId;
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: bob }).error.code, 'NOT_FOUND');
  assert.equal(p.call('staffLogin', { eventId: id, password: 'whatever-1234' }, { auth: 'anon' }).error.code, 'AUTH_INVALID');
  const ev = p.ok('eventDetail', { eventId: id }, { auth: alice }).event;
  p.ok('setStaffPassword', { eventId: id, rev: ev.rev, password: 'staff-pass-1234' }, { auth: alice });
  assert.equal(p.call('staffLogin', { eventId: id, password: 'wrong-pass-0000' }, { auth: 'anon' }).error.code, 'AUTH_INVALID');
  const staff = p.staffLogin(id, 'staff-pass-1234');
  const d = p.ok('eventDetail', { eventId: id }, { auth: staff });
  assert.equal(d.event.id, id);
  assert.equal(d.event.ownerEmail, undefined);
});
