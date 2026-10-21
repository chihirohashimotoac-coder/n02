// セキュリティ: 公開される関数・権限・返却データの最小化
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupPair, loadProject, ROOT, fakeIdToken, GOOGLE_CLIENT_ID } from './gas-mock.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('外部から呼べる関数（末尾 "_" なしのトップレベル関数）は各 2 つだけ', () => {
  const admin = loadProject('admin');
  const viewer = loadProject('viewer');
  const pub = (p) => p.topLevelFunctions().filter((f) => !f.endsWith('_')).sort();
  assert.deepEqual(pub(admin), ['doGet', 'doPost']);
  assert.deepEqual(pub(viewer), ['doGet', 'getPublicSnapshot']);
});

test('閲覧者用プロジェクトには書き込み・初期化・管理用の処理が存在しない', () => {
  const viewer = loadProject('viewer');
  const code = read('dist/viewer/Code.gs');
  for (const api of ['setValues', 'setValue(', 'appendRow', 'deleteRow', 'insertSheet', 'clearContents', '.clear(', 'setProperty', 'deleteProperty', 'UrlFetchApp', 'DriveApp', 'MailApp', 'GmailApp', 'ScriptApp']) {
    assert.ok(!code.includes(api), `viewer must not use ${api}`);
  }
  // 読み込みは Sheets API（参照専用スコープで使える）だけ。SpreadsheetApp は編集スコープを要求するので使わない
  assert.doesNotMatch(code, /SpreadsheetApp\.\w+\(/);
  assert.match(code, /Sheets\.Spreadsheets\.Values\.get\(/);
  for (const fn of ['doPost', 'handleAdminRequest_', 'initializeStorage_', 'actionSaveMatchResult_']) {
    assert.throws(() => viewer.run(fn), /not found|private/, fn);
  }
});

test('マニフェスト: 閲覧者用は読み取り専用スコープのみ、運営用はスプレッドシートと外部通信（Google のログイン確認用）のみ。どちらも匿名アクセス（認証はアプリ側）', () => {
  const viewer = JSON.parse(read('dist/viewer/appsscript.json'));
  const admin = JSON.parse(read('dist/admin/appsscript.json'));
  assert.deepEqual(viewer.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.deepEqual(viewer.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(viewer.dependencies.enabledAdvancedServices, [{ userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4' }]);
  assert.deepEqual(admin.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.external_request']);
  assert.deepEqual(admin.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  // 運営用はメール・Drive 操作をしない。外部への通信は Google の tokeninfo（ログインの確認）の 1 か所だけ
  const code = read('dist/admin/Code.gs');
  for (const api of ['DriveApp', 'MailApp', 'GmailApp', 'ScriptApp', 'HtmlService']) assert.ok(!code.includes(api), api);
  const fetches = code.match(/UrlFetchApp\.\w+\([^)]*/g) || [];
  assert.deepEqual(fetches.map((f) => f.replace(/\s+/g, ' ')), ["UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token"]);
});

test('ソースに認証情報・スプレッドシート ID・メールアドレスを埋め込んでいない', () => {
  for (const file of ['dist/admin/Code.gs', 'dist/viewer/Code.gs', 'dist/viewer/Index.html', 'dist/pages/admin/admin.js', 'dist/pages/viewer.js', 'dist/pages/admin/config.example.js', 'dist/pages/config.example.js']) {
    const text = read(file);
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{44}/, `${file}: ID らしき長い文字列`);
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@(gmail|googlemail|example)\.com/i, `${file}: メールアドレス`);
    assert.doesNotMatch(text, /(api[_-]?key|client[_-]?secret|password)\s*[:=]\s*['"][^'"]+/i, `${file}: 秘密情報らしき記述`);
  }
});

const ALICE = 'alice@example.org';
const BOB = 'bob@example.org';

/** 2 人がそれぞれ Google でログインして大会を作る */
function twoOrganizers() {
  const p = setupPair();
  p.ok('initializeStorage');
  const authA = p.loginAs(ALICE);
  const authB = p.loginAs(BOB);
  const a = p.call('createSampleEvent', { publish: true }, { auth: authA });
  const b = p.call('createSampleEvent', { publish: true }, { auth: authB });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  assert.equal(b.ok, true);
  return { p, a: a.data, b: b.data, authA, authB };
}

test('大会の作成: Google でログインした人だけが作れ、作った人が主催者として記録される', () => {
  const { p, a } = twoOrganizers();
  assert.equal(a.detail.event.ownerEmail, ALICE);
  const events = p.store.get().getSheetByName('Events').records();
  assert.deepEqual(events.map((e) => e.owner_email), [ALICE, BOB]);
  // 未認証では作れない（作成コードの仕組みはない）
  const input = { name: '大会', bestOf: 5, groupCount: 1 };
  assert.equal(p.call('createEvent', input, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  assert.equal(p.call('createSampleEvent', {}, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  p.admin.properties.setProperty('CREATE_CODE', 'darts-2026');
  assert.equal(p.call('createEvent', { ...input, createCode: 'darts-2026' }, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  // 管理者が作った大会は主催者なし
  assert.equal(p.ok('createEvent', input).detail.event.ownerEmail, '');
  // セッションはシートにも応答の詳細にも残らない
  assert.ok(!p.store.dump().includes(p.loginAs(ALICE).session));
});

test('Google ログインの確認: 署名違い・期限切れ・別アプリ向け・発行元違い・メール未確認・形式違いはすべて拒否する', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const login = (idToken) => p.call('login', { idToken }, { auth: 'anon' });
  const ok = login(fakeIdToken(ALICE, p.clock));
  assert.equal(ok.ok, true);
  assert.match(ok.data.session, /^[a-f0-9]{64}$/);
  assert.equal(ok.data.email, ALICE);
  assert.equal(login(fakeIdToken('Alice@Example.org', p.clock)).data.email, ALICE, 'メールアドレスは小文字にそろえる');
  const bad = [
    fakeIdToken(ALICE, p.clock, {}, 'forged-signature'),
    fakeIdToken(ALICE, p.clock, { exp: String(Math.floor(p.clock.now() / 1000) - 10) }),
    fakeIdToken(ALICE, p.clock, { aud: 'other-app.apps.googleusercontent.com' }),
    fakeIdToken(ALICE, p.clock, { iss: 'https://evil.example.org' }),
    fakeIdToken(ALICE, p.clock, { email_verified: 'false' }),
    fakeIdToken('not-an-email', p.clock),
    'not.a-token',
    'a'.repeat(5000),
    123,
  ];
  for (const t of bad) assert.equal(login(t).error.code, 'AUTH_INVALID', String(t).slice(0, 40));
  // Google に接続できないときは、ログイン情報の誤りと区別して伝える
  p.admin.urlFetchFail = true;
  assert.equal(login(fakeIdToken(ALICE, p.clock)).error.code, 'UNAVAILABLE');
  p.admin.urlFetchFail = false;
  // クライアント ID が未設定なら誰もログインできない
  p.admin.properties.deleteProperty('GOOGLE_CLIENT_ID');
  assert.equal(login(fakeIdToken(ALICE, p.clock)).error.code, 'AUTH_NOT_CONFIGURED');
  assert.equal(p.call('bootstrap', {}, { auth: 'anon' }).data.googleLoginReady, false);
  p.admin.properties.setProperty('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID);
  assert.equal(p.call('bootstrap', {}, { auth: 'anon' }).data.googleLoginReady, true);
});

test('ログインの回数制限: 全体で 1 分あたり 30 回まで（Google への問い合わせを使い切られないように）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  for (let i = 0; i < 30; i++) assert.notEqual(p.call('login', { idToken: fakeIdToken(ALICE, p.clock, {}, 'forged-signature') }, { auth: 'anon' }).error.code, 'LIMIT');
  assert.equal(p.call('login', { idToken: fakeIdToken(ALICE, p.clock) }, { auth: 'anon' }).error.code, 'LIMIT');
  p.clock.advance(60_000);
  assert.equal(p.call('login', { idToken: fakeIdToken(ALICE, p.clock) }, { auth: 'anon' }).ok, true);
});

test('セッション: 6 時間で切れ、ログアウトや偽のセッションでは使えない。ログイン後の操作では Google に問い合わせない', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const auth = p.loginAs(ALICE);
  const before = p.admin.fetches.length;
  const id = p.ok('createEvent', { name: '大会', bestOf: 5, groupCount: 1 }, { auth }).eventId;
  assert.equal(p.call('eventDetail', { eventId: id }, { auth }).ok, true);
  assert.equal(p.admin.fetches.length, before, 'セッションで操作するときは tokeninfo を呼ばない');
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: { session: 'f'.repeat(64) } }).error.code, 'AUTH_EXPIRED');
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: { session: 'short' } }).error.code, 'AUTH_EXPIRED');
  p.clock.advance(6 * 3600_000 + 1000);
  assert.equal(p.call('eventDetail', { eventId: id }, { auth }).error.code, 'AUTH_EXPIRED');
  const again = p.loginAs(ALICE);
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: again }).ok, true);
  assert.equal(p.call('logout', { session: again.session }, { auth: again }).ok, true);
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: again }).error.code, 'AUTH_EXPIRED');
  // 期限切れのセッションを送ったままでもログインし直せる
  assert.equal(p.call('login', { idToken: fakeIdToken(ALICE, p.clock) }, { auth: again }).ok, true);
});

test('主催者: 自分の大会は操作でき、他の大会は eventId / matchId / playerId / groupId のどれを指定しても操作できない', () => {
  const { p, a, b, authA } = twoOrganizers();
  const own = p.call('eventDetail', { eventId: a.eventId }, { auth: authA });
  assert.equal(own.ok, true);
  const m = own.data.groups[3].matches[0];
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 }, { auth: authA }).ok, true);

  const other = b.detail;
  const om = other.groups[3].matches[0];
  const op = other.players[0];
  const og = other.groups[0];
  const attempts = [
    ['eventDetail', { eventId: other.event.id }],
    ['updateEvent', { eventId: other.event.id, rev: other.event.rev, name: '乗っ取り', dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '' }],
    ['setStaffPassword', { eventId: other.event.id, rev: other.event.rev, password: 'takeover-1234' }],
    ['setOwner', { eventId: other.event.id, rev: other.event.rev, ownerEmail: ALICE }],
    ['saveMatchResult', { matchId: om.id, rev: om.rev, status: 'final', p1Legs: 3, p2Legs: 0 }],
    ['updatePlayer', { playerId: op.id, rev: op.rev, name: '乗っ取り' }],
    ['deletePlayer', { playerId: op.id, rev: op.rev }],
    ['renameGroup', { groupId: og.id, rev: og.rev, name: '乗っ取り' }],
    ['clearMatches', { eventId: other.event.id, groupId: og.id }],
    ['addPlayers', { eventId: other.event.id, names: ['x'] }],
    ['republish', { eventId: other.event.id }],
    // 自分の eventId と他の大会の ID を混ぜても通らない
    ['assignPlayer', { eventId: a.eventId, playerId: op.id, groupId: '' }],
    ['clearMatches', { eventId: a.eventId, groupId: og.id }],
    ['saveMatchResults', { eventId: other.event.id, results: [{ matchId: om.id, rev: om.rev, p1Legs: 3, p2Legs: 0 }] }],
    ['saveMatchResults', { eventId: a.eventId, results: [{ matchId: om.id, rev: om.rev, p1Legs: 3, p2Legs: 0 }] }],
  ];
  for (const [action, payload] of attempts) {
    const res = p.call(action, payload, { auth: authA });
    assert.equal(res.ok, false, `${action} ${JSON.stringify(payload)}`);
  }
  const after = p.call('eventDetail', { eventId: other.event.id });
  assert.equal(after.data.event.name, other.event.name);
  assert.equal(after.data.event.ownerEmail, BOB);
  assert.equal(after.data.event.staffPasswordSet, false);
  assert.equal(after.data.players.length, other.players.length);
  assert.equal(after.data.groups[3].matches[0].status, 'scheduled');
});

test('主催者: 管理者向けの操作はできず、一覧には自分の大会しか出ない', () => {
  const { p, a, authA } = twoOrganizers();
  for (const [action, payload] of [['initializeStorage', {}], ['configureStorage', { spreadsheetId: 'x' }], ['setViewerUrl', { url: '' }]]) {
    assert.equal(p.call(action, payload, { auth: authA }).error.code, 'FORBIDDEN', action);
  }
  const ev = a.detail.event;
  assert.equal(p.call('setOwner', { eventId: ev.id, rev: ev.rev, ownerEmail: BOB }, { auth: authA }).error.code, 'FORBIDDEN');
  const boot = p.call('bootstrap', {}, { auth: authA }).data;
  assert.deepEqual(Array.from(boot.events, (e) => e.id), [a.eventId]);
  assert.equal(boot.role.kind, 'google');
  assert.equal(boot.role.email, ALICE);
  assert.equal(boot.events[0].ownerEmail, undefined, '一覧の主催者メールアドレスは管理者にだけ返す');
  assert.equal(boot.storage.spreadsheetId, undefined, '保存先の ID は管理者以外に返さない');
  // 既定表示（プラットフォーム全体の設定）は主催者には変えられない
  const d = p.call('updateEvent', { eventId: ev.id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '' }, { auth: authA }).data.detail;
  assert.equal(d.event.isFeatured, false);
});

test('未認証: 初期表示とログイン以外はできず、初期表示では大会も保存先も見えない', () => {
  const { p, a } = twoOrganizers();
  const boot = p.call('bootstrap', {}, { auth: 'anon' }).data;
  assert.deepEqual(Array.from(boot.events), []);
  assert.equal(boot.role.kind, 'anonymous');
  assert.equal(boot.storage.spreadsheetId, undefined);
  assert.equal(boot.storage.spreadsheetName, undefined);
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  assert.equal(p.call('saveMatchResult', { matchId: 'MAT-AAAAAAAAAAAA', rev: 1, status: 'live', p1Legs: 0, p2Legs: 0 }, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  assert.equal(p.call('initializeStorage', {}, { auth: 'anon' }).error.code, 'FORBIDDEN');
  // v0.4 までの運営用 URL の鍵は、もう認証に使えない
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: { eventId: a.eventId, key: 'a'.repeat(64) } }).error.code, 'AUTH_REQUIRED');
});

test('管理パスワード: 主催者が設定し、店舗スタッフはその大会だけを運営できる。パスワードの変更・主催者の情報は扱えない', () => {
  const { p, a, b, authA, authB } = twoOrganizers();
  let ev = p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).data.event;
  assert.equal(p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: 'short' }, { auth: authA }).error.code, 'VALIDATION');
  assert.equal(p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: 'has space 123' }, { auth: authA }).error.code, 'VALIDATION');
  const set = p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: 'Shop-A-2026!' }, { auth: authA });
  assert.equal(set.ok, true);
  assert.equal(set.data.detail.event.staffPasswordSet, true);
  // シート・履歴・応答に平文のパスワードを残さない。ハッシュとソルトは履歴にも出さない
  const dump = p.store.dump();
  assert.ok(!dump.includes('Shop-A-2026!'));
  const row = p.store.get().getSheetByName('Events').records().find((e) => e.event_id === a.eventId);
  assert.match(row.staff_pass_hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(set.data).includes(row.staff_pass_hash));
  const history = p.store.get().getSheetByName('History').records().map((h) => h.after_json + h.before_json).join('');
  assert.ok(!history.includes(row.staff_pass_hash) && !history.includes(row.staff_pass_salt));

  const staff = p.staffLogin(a.eventId, 'Shop-A-2026!');
  const detail = p.call('eventDetail', { eventId: a.eventId }, { auth: staff });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.event.ownerEmail, undefined, 'スタッフには主催者のメールアドレスを見せない');
  assert.equal(detail.data.event.canChangePassword, false);
  const m = detail.data.groups[3].matches[0];
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 }, { auth: staff }).ok, true);
  ev = p.call('eventDetail', { eventId: a.eventId }, { auth: staff }).data.event;
  assert.equal(p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: 'Changed-by-staff' }, { auth: staff }).error.code, 'FORBIDDEN');
  assert.equal(p.call('eventDetail', { eventId: b.eventId }, { auth: staff }).error.code, 'NOT_FOUND');
  assert.equal(p.call('createEvent', { name: 'x', bestOf: 5, groupCount: 1 }, { auth: staff }).error.code, 'AUTH_REQUIRED');
  const boot = p.call('bootstrap', {}, { auth: staff }).data;
  assert.equal(boot.role.kind, 'staff');
  assert.deepEqual(Array.from(boot.events, (e) => e.id), [a.eventId]);
  // 他の大会のパスワードとしては使えない
  assert.equal(p.call('staffLogin', { eventId: b.eventId, password: 'Shop-A-2026!' }, { auth: 'anon' }).error.code, 'AUTH_INVALID');
  // 主催者がパスワードを変えると、古いパスワードのセッションは使えなくなる
  ev = p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).data.event;
  assert.equal(p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: 'Shop-A-2026-v2' }, { auth: authA }).ok, true);
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: staff }).error.code, 'AUTH_EXPIRED');
  assert.equal(p.call('staffLogin', { eventId: a.eventId, password: 'Shop-A-2026!' }, { auth: 'anon' }).error.code, 'AUTH_INVALID');
  const staff2 = p.staffLogin(a.eventId, 'Shop-A-2026-v2');
  // 解除するとパスワードでは開けない
  ev = p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).data.event;
  assert.equal(p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: '' }, { auth: authA }).ok, true);
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: staff2 }).error.code, 'AUTH_EXPIRED');
  assert.equal(p.call('staffLogin', { eventId: a.eventId, password: 'Shop-A-2026-v2' }, { auth: 'anon' }).error.code, 'AUTH_INVALID');
  assert.ok(authB);
});

test('大会の削除: 本人と管理者だけが、データを保存してから大会名を入力して削除でき、全シートからその大会の行だけが消える', () => {
  const { p, a, b, authA, authB } = twoOrganizers();
  let ev = p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).data.event;
  p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: 'Shop-A-2026!' }, { auth: authA });
  const staff = p.staffLogin(a.eventId, 'Shop-A-2026!');
  ev = p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).data.event;
  const book = p.store.get();
  const countRows = (eventId) => Object.fromEntries(book.getSheets().filter((sh) => sh.getName() !== 'シート1').map((sh) => [sh.getName(), sh.records().filter((r) => r.event_id === eventId).length]));
  const beforeB = countRows(b.eventId);

  // 保存（アーカイブ）: 全シートの行と結果が入り、パスワードのハッシュ・ソルトは入らない
  const archive = p.call('exportEvent', { eventId: a.eventId }, { auth: authA });
  assert.equal(archive.ok, true);
  assert.equal(archive.data.format, 'n02-tournament-archive');
  assert.equal(archive.data.event.event_id, a.eventId);
  assert.equal(archive.data.tables.Players.length, 16);
  assert.equal(archive.data.tables.Matches.length, 24);
  assert.ok(archive.data.tables.History.length > 0);
  assert.equal(archive.data.results.event.name, a.detail.event.name);
  const text = JSON.stringify(archive.data);
  assert.ok(!text.includes('staff_pass_hash') && !text.includes('staff_pass_salt') && !text.includes('admin_key_hash'));

  // スタッフ・他の主催者・未ログインは保存も削除もできない
  const del = (auth, extra = {}) => p.call('deleteEvent', { eventId: a.eventId, rev: ev.rev, confirmName: a.detail.event.name, ...extra }, { auth });
  assert.equal(p.call('exportEvent', { eventId: a.eventId }, { auth: staff }).error.code, 'FORBIDDEN');
  assert.equal(del(staff).error.code, 'FORBIDDEN');
  assert.equal(del(authB).error.code, 'NOT_FOUND');
  assert.equal(del('anon').error.code, 'AUTH_REQUIRED');
  // 大会名が違えば消さない
  assert.equal(del(authA, { confirmName: 'ちがう名前' }).error.code, 'VALIDATION');
  assert.equal(del(authA, { confirmName: undefined }).error.code, 'VALIDATION');
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).ok, true);

  const done = del(authA);
  assert.equal(done.ok, true, JSON.stringify(done.error));
  assert.equal(done.data.deletedEventId, a.eventId);
  assert.deepEqual(Object.values(countRows(a.eventId)).filter((n) => n > 0), [], 'どのシートにも行が残らない');
  assert.deepEqual(countRows(b.eventId), beforeB, '他の大会の行は変わらない');
  // 一覧・詳細・閲覧ページ・スタッフのログインから消える
  assert.deepEqual(Array.from(p.call('bootstrap', {}, { auth: authA }).data.events), []);
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).error.code, 'NOT_FOUND');
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: staff }).error.code, 'AUTH_EXPIRED');
  p.clock.advance(60_000);
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: a.eventId }).error.code, 'NO_PUBLIC_EVENT');
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: b.eventId }).ok, true);
  // 削除したことだけを履歴（大会に属さない行）に残す
  const log = book.getSheetByName('History').records().filter((h) => h.action === 'event.delete');
  assert.equal(log.length, 1);
  assert.equal(log[0].event_id, '');
  assert.match(log[0].after_json, new RegExp(a.eventId));
  // 同じ操作を再送しても二重に動かない・管理者は他人の大会も削除できる
  const evB = p.ok('eventDetail', { eventId: b.eventId }).event;
  assert.equal(p.call('deleteEvent', { eventId: b.eventId, rev: evB.rev, confirmName: ' ' + evB.name + ' ' }).ok, true);
  assert.equal(p.store.get().getSheetByName('Events').records().length, 0);
  assert.ok(authB);
});

test('大会の削除: 見出し以外のすべての行を消す場合（シートの空き行がない）でも削除できる', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const auth = p.loginAs(ALICE);
  const id = p.ok('createEvent', { name: '満杯', bestOf: 5, groupCount: 1 }, { auth }).eventId;
  // 空き行のないシートを再現（History の最大行数 = 使っている行数）
  const hist = p.store.get().getSheetByName('History');
  hist.maxRows = hist.getLastRow();
  const ev = p.ok('eventDetail', { eventId: id }, { auth }).event;
  assert.equal(p.call('deleteEvent', { eventId: id, rev: ev.rev, confirmName: '満杯' }, { auth }).ok, true);
  assert.equal(hist.records().filter((h) => h.event_id === id).length, 0);
});

test('管理パスワードの総当たり対策: 同じ大会で 10 回間違えると 10 分間は正しいパスワードでも開けない', () => {
  const { p, a, authA } = twoOrganizers();
  const ev = p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).data.event;
  p.call('setStaffPassword', { eventId: a.eventId, rev: ev.rev, password: 'Shop-A-2026!' }, { auth: authA });
  const tryLogin = (password, eventId = a.eventId) => p.call('staffLogin', { eventId, password }, { auth: 'anon' });
  for (let i = 0; i < 10; i++) assert.equal(tryLogin('wrong-' + i).error.code, 'AUTH_INVALID');
  assert.equal(tryLogin('Shop-A-2026!').error.code, 'AUTH_LOCKED');
  // 存在しない大会・形式違いも同じエラー（大会があるかどうかを推測させない）
  assert.equal(tryLogin('Shop-A-2026!', 'EVT-AAAAAAAAAAAA').error.code, 'AUTH_INVALID');
  assert.equal(tryLogin('Shop-A-2026!', "EVT-1' OR '1'='1").error.code, 'AUTH_INVALID');
  p.clock.advance(10 * 60_000 + 1000);
  assert.equal(tryLogin('Shop-A-2026!').ok, true);
});

test('大会作成の通信が切れて再送されても、同じ大会を返す（大会は 1 つだけ作られる）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const auth = p.loginAs(ALICE);
  const requestId = 'create-request-000001';
  const first = p.call('createEvent', { name: '大会', bestOf: 5, groupCount: 1 }, { auth, requestId });
  const again = p.call('createEvent', { name: '大会', bestOf: 5, groupCount: 1 }, { auth, requestId });
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.eventId, first.data.eventId);
  assert.equal(p.store.get().getSheetByName('Events').records().length, 1);
});

test('作成の上限: 1 人あたり 1 時間に 5 件、全体で 10 件まで（管理者は対象外）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const users = ['u1', 'u2', 'u3'].map((u) => p.loginAs(u + '@example.org'));
  const create = (auth, name) => p.call('createEvent', { name, bestOf: 5, groupCount: 1 }, { auth });
  for (let i = 0; i < 5; i++) assert.equal(create(users[0], `A${i}`).ok, true);
  assert.equal(create(users[0], 'A6').error.code, 'LIMIT');
  for (let i = 0; i < 5; i++) assert.equal(create(users[1], `B${i}`).ok, true);
  assert.equal(create(users[2], 'C1').error.code, 'LIMIT', '全体の上限');
  assert.equal(create(undefined, '管理者').ok, true);
  p.clock.advance(3600_000);
  assert.equal(create(users[0], '1時間後').ok, true);
});

test('管理者の鍵: 違う鍵は拒否、未設定・短すぎる設定では誰も管理者になれない', () => {
  const p = setupPair();
  assert.equal(p.call('bootstrap', {}, { auth: { adminKey: 'wrong-key-wrong-key-wrong-key' } }).error.code, 'AUTH_INVALID');
  assert.equal(p.call('bootstrap', {}, { auth: { adminKey: 123 } }).error.code, 'AUTH_INVALID');
  p.admin.properties.setProperty('ADMIN_KEY', 'short');
  assert.equal(p.call('bootstrap', {}, { auth: { adminKey: 'short' } }).error.code, 'AUTH_NOT_CONFIGURED');
  p.admin.properties.deleteProperty('ADMIN_KEY');
  assert.equal(p.call('initializeStorage', {}, { auth: { adminKey: '' } }).error.code, 'AUTH_NOT_CONFIGURED');
});

test('運営用 API の doGet は画面を返さず、案内の JSON だけを返す', () => {
  const admin = loadProject('admin');
  const out = admin.run('doGet', {});
  assert.equal(out.mimeType, 'application/json');
  assert.equal(JSON.parse(out.text).ok, true);
});

test('主催者のいない大会（v0.4 以前に作成・管理者が作成）は管理者だけが操作でき、管理者が主催者を設定できる', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: '旧大会', bestOf: 5, groupCount: 1 }).eventId;
  const alice = p.loginAs(ALICE);
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: alice }).error.code, 'NOT_FOUND');
  const ev = p.ok('eventDetail', { eventId: id }).event;
  assert.equal(p.call('setOwner', { eventId: id, rev: ev.rev, ownerEmail: 'not-an-email' }).error.code, 'VALIDATION');
  assert.equal(p.ok('setOwner', { eventId: id, rev: ev.rev, ownerEmail: ' Alice@Example.org ' }).detail.event.ownerEmail, ALICE);
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: alice }).ok, true);
  assert.deepEqual(Array.from(p.call('bootstrap', {}, { auth: alice }).data.events, (e) => e.id), [id]);
  // 管理者の一覧には主催者のメールアドレスが出る
  assert.equal(p.ok('bootstrap').events[0].ownerEmail, ALICE);
});

test('閲覧者に返すデータに非公開情報（メモ・操作者・履歴・版番号・内部 ID 以外の管理項目）を含めない', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const d = p.ok('createSampleEvent', { publish: true }).detail;
  const ev = d.event;
  p.ok('updateEvent', { eventId: ev.id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '運営メモSECRET-MEMO' });
  // 選手の非公開メモ（シートの notes 列）
  const sheet = p.store.get().getSheetByName('Players');
  sheet.rows[1][sheet.rows[0].indexOf('notes')] = 'SECRET-PLAYER-NOTE';
  p.ok('republish', { eventId: ev.id });
  const res = p.viewer.run('getPublicSnapshot', {});
  const text = JSON.stringify(res);
  for (const secret of ['SECRET-MEMO', 'SECRET-PLAYER-NOTE', 'owner@example.com', '@example.org', 'staff_pass', '"rev"', 'history', 'notes', 'SPREADSHEET', 'spreadsheet', 'is_public', 'external_ref', 'problems']) {
    assert.ok(!text.includes(secret), `公開データに ${secret} が含まれている`);
  }
  // 公開データに含めてよいキーの一覧（これ以外が増えたら見直す）
  const ALLOWED = new Set([
    'advanced', 'bestOf', 'champion', 'check', 'complete', 'cycles', 'dataUpdatedAt', 'dateLabel', 'entrants', 'event', 'final', 'format', 'groups',
    'id', 'label', 'legs', 'legsAgainst', 'legsFor', 'legsToWin', 'live', 'lost', 'matches', 'name', 'order', 'p1', 'p2', 'pending', 'played', 'playerCount',
    'playerId', 'players', 'progress', 'provisional', 'rank', 'round', 'roundBestOf', 'rounds', 'rule', 'scheduled', 'schema', 'seed', 'setBestOf',
    'sets', 'setsAgainst', 'setsFor', 'setsToWin', 'source', 'stage', 'stages', 'standings', 'status', 'summary', 'thirdPlace', 'tiebreakers',
    'tied', 'total', 'type', 'winnerId', 'won',
  ]);
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (keys.add(k), walk(x)));
  };
  walk(res.data);
  const extra = [...keys].filter((k) => !ALLOWED.has(k));
  assert.deepEqual(extra, [], '公開データに想定外の項目');
});

test('閲覧者用の doGet は書き込み関数を呼ぶコードを含まない HTML を返す', () => {
  const viewer = loadProject('viewer');
  const page = viewer.run('doGet', {});
  assert.match(page.content, /getPublicSnapshot/);
  assert.ok(!page.content.includes('adminCall'));
  assert.equal(page.meta.viewport, 'width=device-width, initial-scale=1');
});

test('画面のスクリプトはデータを innerHTML で埋め込まない（XSS 対策）', () => {
  for (const file of ['admin/src/client/admin.js', 'viewer/src/client/viewer.js', 'portal/src/client/portal.js']) {
    const code = read(file);
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code), file);
  }
});

test('GitHub Pages 用の閲覧ページ: インラインのスクリプトなし・CSP で通信先を Apps Script に限定・Cookie を送らない', () => {
  const html = read('dist/pages/index.html');
  assert.doesNotMatch(html, /<script>(?!<\/script>)|<script(?![^>]*src=)[^>]*>/, 'インラインのスクリプトがある');
  assert.doesNotMatch(html, /<style>/);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /connect-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com(;|$)/);
  assert.match(read('dist/pages/viewer.js'), /credentials: 'omit'/);
  assert.equal(read('dist/pages/viewer.js').includes(read('viewer/src/client/viewer.js')), true, '閲覧画面と同じスクリプト');
});

test('ポータル（events/）: インラインのスクリプトなし・CSP で通信先を Apps Script と Google のログインに限定・Cookie を送らない', () => {
  const html = read('dist/pages/events/index.html');
  assert.doesNotMatch(html, /<script>(?!<\/script>)|<script(?![^>]*src=)[^>]*>/, 'インラインのスクリプトがある');
  assert.doesNotMatch(html, /<style>|style="/);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client(;|$)/);
  assert.match(csp, /connect-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com https:\/\/accounts\.google\.com\/gsi\/(;|$)/);
  assert.match(csp, /form-action 'none'/);
  assert.match(html, /<meta name="referrer" content="strict-origin" \/>/);
  // 設定は既存の閲覧ページ・運営画面のものを読む（秘密の情報は持たない）
  assert.match(html, /<script src="\.\.\/config\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/admin\/config\.js"><\/script>/);
  const js = read('dist/pages/events/portal.js');
  assert.equal((js.match(/credentials: 'omit'/g) || []).length, 2, 'すべての通信で Cookie を送らない');
  // セッションを URL に載せない（運営画面へは大会 ID だけを渡す）
  assert.doesNotMatch(js, /[?&#](session|token|password|key)=/i);
  assert.match(js, /'\.\.\/admin\/#e=' \+ encodeURIComponent\(id\)/);
});
