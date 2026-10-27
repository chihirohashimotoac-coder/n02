// v0.9: 主催者・共同主催者を Google の不変 ID（sub）で識別する。メールアドレスの一致だけでは権限を与えない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createStore, createClock, loadProject, setupPair, ROOT, SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID, fakeIdToken, WORKSPACE } from './gas-mock.mjs';

const V080 = join(ROOT, 'tests', 'fixtures', 'admin-v0.8.0.gs');
// sub は本物と同じく数字の列。応答・公開データに出ていないかを文字列で探せるよう、ほかの値と重ならないものにする
const SUB = { alice: '100000000000000000001', bob: '100000000000000000002', carol: '100000000000000000003', mallory: '100000000000000000099' };

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  const as = (name, email, extra = {}) => p.loginAs(email, { sub: SUB[name], ...extra });
  return { ...p, as };
}

test('ID トークン: sub がない・不正なものは拒否し、sub・メール・Google が持ち主を保証できるかを返す（応答に sub は出さない）', () => {
  const p = setupPair();
  const verify = p.admin.fn('verifyGoogleIdToken_');
  const clock = p.clock;
  assert.throws(() => verify(fakeIdToken('a@example.org', clock, { sub: undefined })), (e) => e.appCode === 'AUTH_INVALID');
  assert.throws(() => verify(fakeIdToken('a@example.org', clock, { sub: '' })), (e) => e.appCode === 'AUTH_INVALID');
  assert.throws(() => verify(fakeIdToken('a@example.org', clock, { sub: '12 34' })), (e) => e.appCode === 'AUTH_INVALID');
  assert.throws(() => verify(fakeIdToken('a@example.org', clock, { sub: 12345 })), (e) => e.appCode === 'AUTH_INVALID');
  assert.throws(() => verify(fakeIdToken('a@example.org', clock, { sub: '1'.repeat(256) })), (e) => e.appCode === 'AUTH_INVALID');
  // aud・iss・exp・email_verified は従来どおり（security.test.mjs）。hd があれば Workspace = 保証あり
  const plain = verify(fakeIdToken('A@Example.org', clock, { sub: '42' }));
  assert.deepEqual({ ...plain }, { sub: '42', email: 'a@example.org', emailAuthoritative: false });
  assert.equal(verify(fakeIdToken('a@example.org', clock, { sub: '42', hd: 'example.org' })).emailAuthoritative, true);
  assert.equal(verify(fakeIdToken('someone@gmail.com', clock, { sub: '43' })).emailAuthoritative, true);
  // @gmail.com 以外（googlemail.com・似た名前のドメイン）は保証なし
  assert.equal(verify(fakeIdToken('someone@googlemail.com', clock, { sub: '44' })).emailAuthoritative, false);
  assert.equal(verify(fakeIdToken('someone@notgmail.com', clock, { sub: '45' })).emailAuthoritative, false);
  assert.equal(verify(fakeIdToken('someone@gmail.com.evil.example', clock, { sub: '46' })).emailAuthoritative, false);
  assert.equal(verify(fakeIdToken('a@example.org', clock, { sub: '47', hd: '' })).emailAuthoritative, false);
  // 偽のメールアドレス（形式違い）・メール未確認は拒否
  assert.throws(() => verify(fakeIdToken('not-an-email', clock, { sub: '48' })), (e) => e.appCode === 'AUTH_INVALID');
  assert.throws(() => verify(fakeIdToken('a@example.org', clock, { sub: '49', email_verified: 'false', hd: 'example.org' })), (e) => e.appCode === 'AUTH_INVALID');
  // ログインの応答に sub は含めない
  const res = p.ok('login', { idToken: fakeIdToken('a@example.org', clock, { sub: SUB.alice }) }, { auth: 'anon' });
  assert.deepEqual(Object.keys(res).sort(), ['email', 'expiresAt', 'session']);
  assert.ok(!JSON.stringify(res).includes(SUB.alice));
});

test('tokeninfo の障害: 混雑（429・5xx）はトークンの誤りと言わずに UNAVAILABLE。通信の例外の文面（URL にトークンを含みうる）はログに出さない', () => {
  const p = setupPair();
  const token = fakeIdToken('a@example.org', p.clock, { sub: '42' });
  const original = p.admin.context.UrlFetchApp.fetch;
  for (const code of [429, 500, 503]) {
    p.admin.context.UrlFetchApp.fetch = () => ({ getResponseCode: () => code, getContentText: () => '' });
    assert.equal(p.call('login', { idToken: token }, { auth: 'anon' }).error.code, 'UNAVAILABLE', String(code));
  }
  p.admin.context.UrlFetchApp.fetch = (url) => {
    throw new Error('Address unavailable: ' + url);
  };
  assert.equal(p.call('login', { idToken: token }, { auth: 'anon' }).error.code, 'UNAVAILABLE');
  p.admin.context.UrlFetchApp.fetch = original;
  assert.ok(!JSON.stringify(p.admin.logs).includes(token.split('.')[1]), 'ID トークンをログに残さない');
});

test('v0.8 までのセッション（メールアドレスだけ）は使えず、ログインし直しを求める。送られた sub・メールアドレスは信用しない', () => {
  const p = ready();
  const alice = p.as('alice', 'alice@example.org');
  const id = p.ok('createSampleEvent', {}, { auth: alice }).eventId;
  // 旧形式のセッションをキャッシュに直接置く（v0.8 の issueSession_ と同じ形）
  const legacy = 'a'.repeat(64);
  const key = p.admin.fn('sessionCacheKey_')(legacy);
  p.admin.cache.put(key, JSON.stringify({ kind: 'google', email: 'alice@example.org', expiresAt: new Date(p.clock.now() + 3600000).toISOString() }), 21600);
  const res = p.call('eventDetail', { eventId: id }, { auth: { session: legacy } });
  assert.equal(res.error.code, 'AUTH_EXPIRED');
  assert.match(res.error.message, /もう一度 Google でログイン/);
  // 送られた sub・メールアドレス（auth・payload）は使わない
  const bob = p.as('bob', 'bob@example.org', WORKSPACE);
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: { ...bob, sub: SUB.alice, email: 'alice@example.org' } }).error.code, 'NOT_FOUND');
  assert.equal(p.ok('linkAccount', { sub: SUB.alice, email: 'alice@example.org', eventId: id }, { auth: bob }).linked.owner, 0);
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: bob }).error.code, 'NOT_FOUND');
});

test('2 人・2 大会: 主催者・共同主催者・無関係な人の読み取り・更新・削除。ID を混ぜても他の大会に届かない', () => {
  const p = ready();
  const alice = p.as('alice', 'alice@example.org');
  const bob = p.as('bob', 'bob@gmail.com');
  const carol = p.as('carol', 'carol@example.org', WORKSPACE);
  const a = p.ok('createSampleEvent', { publish: true }, { auth: alice }).detail;
  const b = p.ok('createSampleEvent', { publish: true }, { auth: bob }).detail;
  p.ok('addCollaborator', { eventId: a.event.id, email: 'carol@example.org' }, { auth: alice });
  p.link(carol);
  const roles = { alice: [a, 'owner'], bob: [b, 'owner'] };
  for (const [name, [ev, role]] of Object.entries(roles)) {
    const auth = name === 'alice' ? alice : bob;
    assert.equal(p.ok('eventDetail', { eventId: ev.event.id }, { auth }).event.role, role);
  }
  assert.equal(p.ok('eventDetail', { eventId: a.event.id }, { auth: carol }).event.role, 'editor');
  // 無関係（carol と b、alice と b、bob と a）
  for (const [auth, ev] of [[carol, b], [alice, b], [bob, a]]) {
    const om = ev.groups[3].matches[0];
    const op = ev.players[0];
    for (const [action, payload] of [
      ['eventDetail', { eventId: ev.event.id }],
      ['exportEvent', { eventId: ev.event.id }],
      ['saveMatchResult', { matchId: om.id, rev: om.rev, status: 'final', p1Legs: 3, p2Legs: 0 }],
      ['updatePlayer', { playerId: op.id, rev: op.rev, name: '乗っ取り' }],
      ['deleteEvent', { eventId: ev.event.id, rev: ev.event.rev, confirmName: ev.event.name }],
      ['addCollaborator', { eventId: ev.event.id, email: 'x@example.org' }],
    ]) {
      assert.equal(p.call(action, payload, { auth }).ok, false, action);
    }
  }
  // 共同主催者が、自分の大会 ID と他の大会の試合・選手を混ぜる
  const bm = b.groups[3].matches[0];
  assert.equal(p.call('saveMatchResults', { eventId: a.event.id, results: [{ matchId: bm.id, rev: bm.rev, p1Legs: 3, p2Legs: 0 }] }, { auth: carol }).ok, false);
  assert.equal(p.call('assignPlayer', { eventId: a.event.id, playerId: b.players[0].id, groupId: '' }, { auth: carol }).ok, false);
  // 共同主催者は削除・共同主催者の管理・保存（エクスポート）はできない
  assert.equal(p.call('deleteEvent', { eventId: a.event.id, rev: a.event.rev, confirmName: a.event.name }, { auth: carol }).error.code, 'FORBIDDEN');
  assert.equal(p.call('exportEvent', { eventId: a.event.id }, { auth: carol }).ok, true, '共同主催者は v0.8 と同じく保存できる');
  // 主催者は自分の大会を削除できる
  const ev = p.ok('eventDetail', { eventId: b.event.id }, { auth: bob }).event;
  p.ok('deleteEvent', { eventId: b.event.id, rev: ev.rev, confirmName: ev.name }, { auth: bob });
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: alice }).ok, true);
});

test('メールアドレスの変更: 同じ sub ならアドレスが変わっても自分の大会を運営できる。同じアドレスでも別の sub（再割り当て）には権限がない', () => {
  const p = ready();
  const alice = p.as('alice', 'alice@example.org', WORKSPACE);
  const id = p.ok('createSampleEvent', {}, { auth: alice }).eventId;
  const renamed = p.loginAs('alice.new@example.org', { sub: SUB.alice, ...WORKSPACE });
  assert.equal(p.ok('eventDetail', { eventId: id }, { auth: renamed }).event.role, 'owner');
  assert.deepEqual(Array.from(p.ok('myEvents', {}, { auth: renamed }).events, (e) => e.id), [id]);
  // 同じアドレスを別の人（別の sub）が使う: Google が保証するアドレス（Workspace）でも、作った人の大会には入れない
  const mallory = p.loginAs('alice@example.org', { sub: SUB.mallory, ...WORKSPACE });
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: mallory }).error.code, 'NOT_FOUND');
  assert.deepEqual(Array.from(p.ok('myEvents', {}, { auth: mallory }).events), []);
  assert.deepEqual(p.ok('bootstrap', {}, { auth: mallory }).role.link, { available: 0, pending: 0 });
});

/** v0.8.0（本番の版）で大会と共同主催者を作り、v0.9 に進めて移行した保存先 */
function migratedFromV080() {
  const store = createStore();
  const clock = createClock();
  store.add();
  const props = { SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID };
  const old = loadProject('admin', { store, clock, properties: props, codePath: V080 });
  let n = 0;
  const call = (project, action, payload = {}, auth = { adminKey: ADMIN_KEY }) => project.post({ action, payload, requestId: `idt-request-${String(++n).padStart(8, '0')}`, auth: auth || undefined });
  const ok = (project, action, payload, auth) => {
    const res = call(project, action, payload, auth);
    if (!res.ok) throw new Error(`${action}: ${res.error.code} ${res.error.message}`);
    return res.data;
  };
  const login = (project, email, sub, extra = {}) => ({ session: ok(project, 'login', { idToken: fakeIdToken(email, clock, { sub, ...extra }) }, null).session });
  ok(old, 'initializeStorage');
  const gmail = login(old, 'owner@gmail.com', SUB.alice);
  const ext = login(old, 'owner@external.example', SUB.bob);
  const g = ok(old, 'createSampleEvent', { publish: true }, gmail).eventId;
  const x = ok(old, 'createSampleEvent', {}, ext).eventId;
  const orphan = ok(old, 'createEvent', { name: '主催者なし', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  ok(old, 'addCollaborator', { eventId: g, email: 'helper@gmail.com' }, gmail);
  ok(old, 'addCollaborator', { eventId: g, email: 'helper@external.example' }, gmail);
  const helperOld = login(old, 'helper@gmail.com', SUB.carol);
  assert.equal(ok(old, 'eventDetail', { eventId: g }, helperOld).event.role, 'editor', 'v0.8.0 ではメールアドレスだけで共同主催者');
  const next = loadProject('admin', { store, clock, properties: old.properties.getProperties(), cache: old.cache });
  const migrated = ok(next, 'migrateStorage');
  return { store, clock, call, ok, login, old, next, migrated, ids: { g, x, orphan }, sessions: { gmail, ext, helperOld } };
}

test('移行（v2 → v3）: 共同主催者のメールアドレスは招待に移し、権限は本人のログインで紐付くまで付かない。件数・バックアップ・やり直し', () => {
  const w = migratedFromV080();
  assert.equal(w.migrated.migrateResult.from, 2);
  // v1.0: v0.8 の保存先は v3 の移し替えを経て、v4（期制リーグのシート・列の追加）まで 1 回で上がる
  assert.equal(w.migrated.migrateResult.to, 4);
  assert.equal(w.migrated.migrateResult.records.collaboratorsMoved, 2);
  const book = w.store.get();
  const collabs = book.getSheetByName('Collaborators').records();
  assert.deepEqual(collabs.map((r) => [r.email, r.invite_email, r.sub]), [['', 'helper@gmail.com', ''], ['', 'helper@external.example', '']]);
  const backup = book.sheets.find((s) => s.name.startsWith('bak-s2-') && s.name.endsWith('-Collaborators'));
  assert.deepEqual(backup.records().map((r) => r.email), ['helper@gmail.com', 'helper@external.example'], 'バックアップに元の値');
  // 大会の行は値を変えない（列が増えるだけ）
  const events = book.getSheetByName('Events').records();
  assert.deepEqual(events.map((e) => [e.owner_email, e.owner_sub]), [['owner@gmail.com', ''], ['owner@external.example', ''], ['', '']]);
  // v0.8 のセッションはログインし直し
  assert.equal(w.call(w.next, 'eventDetail', { eventId: w.ids.g }, w.sessions.gmail).error.code, 'AUTH_EXPIRED');
  // Gmail の主催者: ログインで自動的に紐付く
  const gmail = w.login(w.next, 'owner@gmail.com', SUB.alice);
  assert.equal(w.call(w.next, 'eventDetail', { eventId: w.ids.g }, gmail).error.code, 'NOT_FOUND');
  assert.deepEqual(w.ok(w.next, 'linkAccount', {}, gmail).linked, { owner: 1, collaborator: 0 });
  assert.equal(w.ok(w.next, 'eventDetail', { eventId: w.ids.g }, gmail).event.role, 'owner');
  // Gmail の共同主催者: 紐付けると有効
  const helper = w.login(w.next, 'helper@gmail.com', SUB.carol);
  assert.deepEqual(w.ok(w.next, 'linkAccount', {}, helper).linked, { owner: 0, collaborator: 1 });
  assert.equal(w.ok(w.next, 'eventDetail', { eventId: w.ids.g }, helper).event.role, 'editor');
  // 2 回目の移行は何もしない
  assert.equal(w.ok(w.next, 'migrateStorage').migrateResult.migrated, false);
});

test('移行のやり直し: 値の移し替えの途中で止まっても SCHEMA_VERSION は上がらず、もう一度実行すると続きから終わる', () => {
  const store = createStore();
  const clock = createClock();
  store.add();
  const old = loadProject('admin', { store, clock, properties: { SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID }, codePath: V080 });
  const post = (project, action, payload, auth) => project.post({ action, payload, requestId: 'retry-' + Math.random().toString(16).slice(2, 18), auth });
  post(old, 'initializeStorage', {}, { adminKey: ADMIN_KEY });
  const s = { session: post(old, 'login', { idToken: fakeIdToken('o@gmail.com', clock, { sub: '7' }) }).data.session };
  const id = post(old, 'createSampleEvent', {}, s).data.eventId;
  post(old, 'addCollaborator', { eventId: id, email: 'h1@gmail.com' }, s);
  post(old, 'addCollaborator', { eventId: id, email: 'h2@gmail.com' }, s);
  const next = loadProject('admin', { store, clock, properties: old.properties.getProperties(), cache: old.cache });
  // Collaborators への書き込みを 1 回だけ失敗させる
  const sheet = store.get().getSheetByName('Collaborators');
  const original = sheet.getRange.bind(sheet);
  let failOnce = true;
  sheet.getRange = (...args) => {
    const r = original(...args);
    const set = r.setValues.bind(r);
    r.setValues = (v) => {
      if (failOnce && args[0] > 1) {
        failOnce = false;
        throw new Error('Service Spreadsheets failed (simulated)');
      }
      return set(v);
    };
    return r;
  };
  const first = post(next, 'migrateStorage', {}, { adminKey: ADMIN_KEY });
  assert.equal(first.ok, false);
  assert.equal(next.properties.getProperty('SCHEMA_VERSION'), '2', '版は上げない');
  // 書き込みは移行が終わるまで止まる（閲覧はできる）
  assert.equal(post(next, 'addPlayers', { eventId: id, names: ['x'] }, { adminKey: ADMIN_KEY }).error.code, 'MIGRATION_REQUIRED');
  assert.equal(post(next, 'eventDetail', { eventId: id }, { adminKey: ADMIN_KEY }).ok, true);
  const second = post(next, 'migrateStorage', {}, { adminKey: ADMIN_KEY });
  assert.equal(second.ok, true, JSON.stringify(second.error));
  assert.equal(next.properties.getProperty('SCHEMA_VERSION'), '4');
  assert.deepEqual(sheet.records().map((r) => [r.email, r.invite_email]), [['', 'h1@gmail.com'], ['', 'h2@gmail.com']]);
});

test('Google が保証しないアドレスの既存の主催者: 自動では紐付けず確認待ちにし、管理者が承認すると主催者になる', () => {
  const w = migratedFromV080();
  const ext = w.login(w.next, 'owner@external.example', SUB.bob);
  assert.deepEqual(w.ok(w.next, 'bootstrap', {}, ext).role.link, { available: 1, pending: 0 });
  const res = w.ok(w.next, 'linkAccount', {}, ext);
  assert.deepEqual(res.linked, { owner: 0, collaborator: 0 });
  assert.equal(res.claimed, 1);
  assert.equal(w.call(w.next, 'eventDetail', { eventId: w.ids.x }, ext).error.code, 'NOT_FOUND', '確認待ちの間は権限なし');
  assert.deepEqual(w.ok(w.next, 'bootstrap', {}, ext).role.link, { available: 0, pending: 1 });
  // 同じアドレスを名乗る別のアカウント（なりすまし・再割り当て）も確認待ちに並ぶだけ
  const imp = w.login(w.next, 'owner@external.example', SUB.mallory);
  w.ok(w.next, 'linkAccount', {}, imp);
  assert.equal(w.call(w.next, 'eventDetail', { eventId: w.ids.x }, imp).error.code, 'NOT_FOUND');
  // 管理者の画面: 確認待ち 2 件（sub は出さず、見分け用の参照だけ）
  const d = w.ok(w.next, 'eventDetail', { eventId: w.ids.x });
  assert.equal(d.event.ownerLink.linked, false);
  assert.equal(d.event.ownerLink.claims.length, 2);
  assert.ok(!JSON.stringify(d).includes(SUB.bob) && !JSON.stringify(d).includes(SUB.mallory));
  assert.equal(w.ok(w.next, 'bootstrap').events.find((e) => e.id === w.ids.x).ownerClaims, 2);
  // 主催者本人・他の Google ログインは承認できない。違う参照は拒否
  assert.equal(w.call(w.next, 'approveOwnerClaim', { eventId: w.ids.x, rev: d.event.rev, ref: d.event.ownerLink.claims[0].ref }, ext).error.code, 'NOT_FOUND');
  assert.equal(w.call(w.next, 'approveOwnerClaim', { eventId: w.ids.x, rev: d.event.rev, ref: '0123456789ab' }).error.code, 'NOT_FOUND');
  assert.equal(w.call(w.next, 'approveOwnerClaim', { eventId: w.ids.x, rev: d.event.rev, ref: 'x' }).error.code, 'BAD_REQUEST');
  // 管理者が（本人確認のうえで）正しい方を承認する
  const ref = w.next.fn('subRef_')(SUB.bob);
  const approved = w.ok(w.next, 'approveOwnerClaim', { eventId: w.ids.x, rev: d.event.rev, ref });
  assert.equal(approved.detail.event.ownerLink.linked, true);
  assert.equal(w.ok(w.next, 'eventDetail', { eventId: w.ids.x }, ext).event.role, 'owner');
  assert.equal(w.call(w.next, 'eventDetail', { eventId: w.ids.x }, imp).error.code, 'NOT_FOUND');
  // 同じアドレスの別の sub が紐付いたので、なりすまし側は以後どの大会にも自動では紐付かない
  assert.deepEqual(w.ok(w.next, 'bootstrap', {}, imp).role.link, { available: 0, pending: 0 });
  // 履歴に sub は残さない
  assert.ok(!JSON.stringify(approved.detail.history).includes(SUB.bob));
});

test('共同主催者の招待: 未受け入れ（招待中）→ 確認待ち → 主催者が承認 → 解除。保証のないアドレスは自動で有効にならない', () => {
  const p = ready();
  const alice = p.as('alice', 'alice@gmail.com');
  const a = p.ok('createSampleEvent', {}, { auth: alice }).detail;
  p.ok('addCollaborator', { eventId: a.event.id, email: 'bob@external.example' }, { auth: alice });
  // 同じアドレスの招待を重ねられない
  assert.equal(p.call('addCollaborator', { eventId: a.event.id, email: 'BOB@external.example' }, { auth: alice }).error.code, 'VALIDATION');
  let list = p.ok('eventDetail', { eventId: a.event.id }, { auth: alice }).collaborators;
  assert.equal(list[0].status, 'invited');
  // シートの email 列は空（旧版はこの列で権限を判定する）
  assert.deepEqual(p.store.get().getSheetByName('Collaborators').records().map((r) => [r.email, r.invite_email]), [['', 'bob@external.example']]);
  const bob = p.as('bob', 'bob@external.example');
  assert.equal(p.link(bob).claimed, 1);
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: bob }).error.code, 'NOT_FOUND');
  list = p.ok('eventDetail', { eventId: a.event.id }, { auth: alice }).collaborators;
  assert.equal(list[0].status, 'pending');
  assert.equal(list[0].claims.length, 1);
  assert.equal(list[0].claims[0].email, 'bob@external.example');
  // 共同主催者本人・無関係な人は承認できない
  assert.equal(p.call('approveCollaborator', { eventId: a.event.id, collabId: list[0].id, rev: list[0].rev, ref: list[0].claims[0].ref }, { auth: bob }).error.code, 'NOT_FOUND');
  // 古い版番号は拒否
  assert.equal(p.call('approveCollaborator', { eventId: a.event.id, collabId: list[0].id, rev: list[0].rev - 1, ref: list[0].claims[0].ref }, { auth: alice }).error.code, 'CONFLICT');
  p.ok('approveCollaborator', { eventId: a.event.id, collabId: list[0].id, rev: list[0].rev, ref: list[0].claims[0].ref }, { auth: alice });
  assert.equal(p.ok('eventDetail', { eventId: a.event.id }, { auth: bob }).event.role, 'editor');
  list = p.ok('eventDetail', { eventId: a.event.id }, { auth: alice }).collaborators;
  assert.equal(list[0].status, 'active');
  // 解除はすぐ効く
  p.ok('removeCollaborator', { eventId: a.event.id, collabId: list[0].id }, { auth: alice });
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: bob }).error.code, 'NOT_FOUND');
});

test('共同主催者の招待: 保証のあるアドレスでも、そのアドレスに別の sub が紐付いていれば（再割り当ての疑い）確認待ちにする', () => {
  const p = ready();
  const alice = p.as('alice', 'alice@gmail.com');
  const bob = p.as('bob', 'bob@example.org', WORKSPACE);
  const a = p.ok('createSampleEvent', {}, { auth: alice }).detail;
  const b = p.ok('createSampleEvent', {}, { auth: alice }).detail;
  p.ok('addCollaborator', { eventId: a.event.id, email: 'bob@example.org' }, { auth: alice });
  p.link(bob);
  // 同じアドレスを後から別の人が使う（Workspace の管理者がアドレスを別の社員に付け替えた）
  p.ok('addCollaborator', { eventId: b.event.id, email: 'bob@example.org' }, { auth: alice });
  const newcomer = p.loginAs('bob@example.org', { sub: SUB.mallory, ...WORKSPACE });
  const res = p.link(newcomer);
  assert.deepEqual(res.linked, { owner: 0, collaborator: 0 });
  assert.equal(res.claimed, 1);
  assert.equal(p.call('eventDetail', { eventId: b.event.id }, { auth: newcomer }).error.code, 'NOT_FOUND');
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: newcomer }).error.code, 'NOT_FOUND');
  // 元の人は、新しい招待にもログインで紐付く
  assert.equal(p.link(bob).linked.collaborator, 1);
  assert.equal(p.ok('eventDetail', { eventId: b.event.id }, { auth: bob }).event.role, 'editor');
});

test('管理者の付け替え・主催者なしの大会・複製・復元: 新しい大会の主催者は作った人の sub。保存ファイル・履歴に sub を出さない', () => {
  const p = ready();
  const alice = p.as('alice', 'alice@gmail.com');
  const bob = p.as('bob', 'bob@gmail.com');
  const orphan = p.ok('createEvent', { name: '主催者なし', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  assert.equal(p.call('eventDetail', { eventId: orphan }, { auth: alice }).error.code, 'NOT_FOUND');
  assert.deepEqual(p.ok('bootstrap', {}, { auth: alice }).role.link, { available: 0, pending: 0 });
  const a = p.ok('createSampleEvent', { publish: true }, { auth: alice }).detail;
  const dup = p.ok('duplicateEvent', { eventId: a.event.id, name: '複製', includePlayers: true }, { auth: alice }).detail;
  assert.equal(dup.event.role, 'owner');
  const archive = p.ok('exportEvent', { eventId: a.event.id }, { auth: alice });
  assert.ok(!JSON.stringify(archive).includes(SUB.alice));
  assert.equal(archive.event.owner_sub, undefined);
  assert.equal(archive.event.owner_link_json, undefined);
  // bob が alice の保存ファイルから復元すると、主催者は bob
  const restored = p.ok('restoreEvent', { archive, mode: 'full' }, { auth: bob }).detail;
  assert.equal(restored.event.role, 'owner');
  assert.equal(p.call('eventDetail', { eventId: restored.event.id }, { auth: alice }).error.code, 'NOT_FOUND');
  // 管理者が alice の大会を bob に付け替え: alice はすぐ外れ、bob は紐付けで主催者になる
  const ev = p.ok('eventDetail', { eventId: a.event.id }).event;
  p.ok('setOwner', { eventId: a.event.id, rev: ev.rev, ownerEmail: 'bob@gmail.com' });
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: alice }).error.code, 'NOT_FOUND');
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: bob }).error.code, 'NOT_FOUND');
  assert.equal(p.link(bob).linked.owner, 1);
  assert.equal(p.ok('eventDetail', { eventId: a.event.id }, { auth: bob }).event.role, 'owner');
  // 同じアドレスのまま保存しても紐付けは外れない
  const ev2 = p.ok('eventDetail', { eventId: a.event.id }).event;
  p.ok('setOwner', { eventId: a.event.id, rev: ev2.rev, ownerEmail: 'bob@gmail.com' });
  assert.equal(p.ok('eventDetail', { eventId: a.event.id }, { auth: bob }).event.role, 'owner');
  // 履歴・応答に sub を出さない
  const history = p.store.get().getSheetByName('History').records().map((h) => h.before_json + h.after_json + h.actor).join('');
  for (const sub of Object.values(SUB)) assert.ok(!history.includes(sub), 'history ' + sub);
});

test('公開データ・一覧・閲覧者用 JSON・スタッフと共同主催者の画面に、sub・紐付けの記録・主催者と共同主催者のメールアドレスを出さない', () => {
  const p = ready();
  const alice = p.as('alice', 'alice@gmail.com');
  const carol = p.as('carol', 'carol@gmail.com');
  const a = p.ok('createSampleEvent', { publish: true }, { auth: alice }).detail;
  p.ok('addCollaborator', { eventId: a.event.id, email: 'carol@gmail.com' }, { auth: alice });
  p.ok('addCollaborator', { eventId: a.event.id, email: 'pending@external.example' }, { auth: alice });
  p.link(carol);
  p.link(p.loginAs('pending@external.example', { sub: SUB.mallory }));
  const ev = p.ok('eventDetail', { eventId: a.event.id }, { auth: alice }).event;
  p.ok('setStaffPassword', { eventId: a.event.id, rev: ev.rev, password: 'staff-pass-01' }, { auth: alice });
  const staff = p.staffLogin(a.event.id, 'staff-pass-01');
  const secrets = [...Object.values(SUB), 'alice@gmail.com', 'carol@gmail.com', 'pending@external.example', 'owner_link', 'invite_email'];
  const check = (label, value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const s of secrets) assert.ok(!text.includes(s), `${label}: ${s}`);
  };
  p.clock.advance(21000);
  check('snapshot', p.viewer.run('getPublicSnapshot', { eventId: a.event.id }));
  for (const format of ['json', 'list']) check(format, p.viewer.fn('doGet')({ parameter: { format, event: a.event.id } }).getContent());
  const staffView = p.ok('eventDetail', { eventId: a.event.id }, { auth: staff });
  check('staff', { ...staffView, history: [] });
  const carolView = p.ok('eventDetail', { eventId: a.event.id }, { auth: carol });
  check('editor', { ...carolView, history: [] });
  // 共同主催者・スタッフの一覧にも出ない
  check('staff boot', p.ok('bootstrap', {}, { auth: staff }).events);
  check('editor myEvents', p.ok('myEvents', {}, { auth: carol }).events);
  // 主催者の画面にも sub は出ない（メールアドレスは本人・管理者向けに従来どおり）
  const ownerView = p.ok('eventDetail', { eventId: a.event.id }, { auth: alice });
  for (const sub of Object.values(SUB)) assert.ok(!JSON.stringify(ownerView).includes(sub));
  // エラー応答にも出ない
  check('error', p.call('approveCollaborator', { eventId: a.event.id, collabId: 'COL-AAAAAAAAAAAA', rev: 1, ref: '0123456789ab' }, { auth: alice }));
});

test('ロールバック（v0.9 → v0.8.0 のコード）: 主催者はメールアドレスで従来どおり開けるが、招待中・確認待ち・v0.9 で有効にした共同主催者には権限が付かない', () => {
  const w = migratedFromV080();
  const gmail = w.login(w.next, 'owner@gmail.com', SUB.alice);
  w.ok(w.next, 'linkAccount', {}, gmail);
  const helper = w.login(w.next, 'helper@gmail.com', SUB.carol);
  w.ok(w.next, 'linkAccount', {}, helper);
  w.ok(w.next, 'addCollaborator', { eventId: w.ids.g, email: 'invited@gmail.com' }, gmail);
  const extHelper = w.login(w.next, 'helper@external.example', SUB.mallory);
  w.ok(w.next, 'linkAccount', {}, extHelper);
  // 運営用を v0.8.0 に戻す（スクリプト プロパティ・キャッシュはそのまま）
  const back = loadProject('admin', { store: w.store, clock: w.clock, properties: w.next.properties.getProperties(), cache: w.next.cache, codePath: V080 });
  // v0.9 のセッションも v0.8.0 で使える（メールアドレスを含むため）。主催者は従来どおり
  assert.equal(w.ok(back, 'eventDetail', { eventId: w.ids.g }, gmail).event.name, 'サンプル大会（PoC 検証用）');
  // 共同主催者（v0.9 で有効）・招待中・確認待ちは、v0.8.0 では権限なし（メールアドレスの列が空）
  assert.equal(w.call(back, 'eventDetail', { eventId: w.ids.g }, helper).error.code, 'NOT_FOUND');
  assert.equal(w.call(back, 'eventDetail', { eventId: w.ids.g }, extHelper).error.code, 'NOT_FOUND');
  const invited = w.login(back, 'invited@gmail.com', '555');
  assert.equal(w.call(back, 'eventDetail', { eventId: w.ids.g }, invited).error.code, 'NOT_FOUND');
  // v0.8.0 での付け替え・共同主催者の追加（メールアドレスだけ）
  const ev = w.ok(back, 'eventDetail', { eventId: w.ids.g }).event;
  w.ok(back, 'setOwner', { eventId: w.ids.g, rev: ev.rev, ownerEmail: 'successor@gmail.com' });
  w.ok(back, 'addCollaborator', { eventId: w.ids.x, email: 'late@gmail.com' }, { adminKey: ADMIN_KEY });
  // もう一度 v0.9 に進める: 旧版での付け替えは「紐付けが古い」とみなし、前の主催者（sub）に権限を残さない
  const again = loadProject('admin', { store: w.store, clock: w.clock, properties: back.properties.getProperties(), cache: back.cache });
  assert.equal(w.call(again, 'eventDetail', { eventId: w.ids.g }, gmail).error.code, 'NOT_FOUND');
  const successor = w.login(again, 'successor@gmail.com', '777');
  assert.equal(w.ok(again, 'linkAccount', {}, successor).linked.owner, 1);
  assert.equal(w.ok(again, 'eventDetail', { eventId: w.ids.g }, successor).event.role, 'owner');
  // 旧版で email 列に追加された共同主催者は、v0.9 では招待として扱う（紐付けで有効。紐付けで email 列は空にする）
  const late = w.login(again, 'late@gmail.com', '888');
  assert.equal(w.call(again, 'eventDetail', { eventId: w.ids.x }, late).error.code, 'NOT_FOUND');
  assert.equal(w.ok(again, 'linkAccount', {}, late).linked.collaborator, 1);
  assert.equal(w.ok(again, 'eventDetail', { eventId: w.ids.x }, late).event.role, 'editor');
  assert.ok(w.store.get().getSheetByName('Collaborators').records().every((r) => r.email === ''));
});

test('重複送信の判定・作成の回数制限は sub ごと（メールアドレスが変わっても同じ人として数える）', () => {
  const p = ready();
  const before = p.loginAs('limit@gmail.com', { sub: '900' });
  for (let i = 0; i < 5; i++) p.ok('createEvent', { name: '大会' + i, template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, { auth: before });
  const renamed = p.loginAs('limit.renamed@gmail.com', { sub: '900' });
  assert.equal(p.call('createEvent', { name: '6 件目', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, { auth: renamed }).error.code, 'LIMIT');
});
