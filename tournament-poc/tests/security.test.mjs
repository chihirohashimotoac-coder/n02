// セキュリティ: 公開される関数・権限・返却データの最小化
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupPair, loadProject, ROOT } from './gas-mock.mjs';

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

test('マニフェスト: 閲覧者用は読み取り専用スコープのみ、運営用はスプレッドシートのみ。どちらも匿名アクセス（認証はアプリ側）', () => {
  const viewer = JSON.parse(read('dist/viewer/appsscript.json'));
  const admin = JSON.parse(read('dist/admin/appsscript.json'));
  assert.deepEqual(viewer.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.deepEqual(viewer.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(viewer.dependencies.enabledAdvancedServices, [{ userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4' }]);
  assert.deepEqual(admin.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
  assert.deepEqual(admin.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  // 運営用は外部への通信・メール・Drive 操作をしない
  const code = read('dist/admin/Code.gs');
  for (const api of ['UrlFetchApp', 'DriveApp', 'MailApp', 'GmailApp', 'ScriptApp', 'HtmlService']) assert.ok(!code.includes(api), api);
});

test('ソースに認証情報・スプレッドシート ID・メールアドレスを埋め込んでいない', () => {
  for (const file of ['dist/admin/Code.gs', 'dist/viewer/Code.gs', 'dist/viewer/Index.html', 'dist/pages/admin/admin.js', 'dist/pages/viewer.js', 'dist/pages/admin/config.example.js', 'dist/pages/config.example.js']) {
    const text = read(file);
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{44}/, `${file}: ID らしき長い文字列`);
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@(gmail|googlemail|example)\.com/i, `${file}: メールアドレス`);
    assert.doesNotMatch(text, /(api[_-]?key|client[_-]?secret|password)\s*[:=]\s*['"][^'"]+/i, `${file}: 秘密情報らしき記述`);
  }
});

/** 未認証で 2 つの大会を作り、それぞれの運営用の鍵を受け取る */
function twoOrganizers() {
  const p = setupPair();
  p.ok('initializeStorage');
  const a = p.call('createSampleEvent', { publish: true }, { auth: 'anon' });
  const b = p.call('createSampleEvent', { publish: true }, { auth: 'anon' });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  assert.equal(b.ok, true);
  const authA = { eventId: a.data.eventId, key: a.data.adminKey };
  const authB = { eventId: b.data.eventId, key: b.data.adminKey };
  return { p, a: a.data, b: b.data, authA, authB };
}

test('大会の作成: ログインなしで作れ、運営用の鍵（16 進 64 文字）が 1 回だけ返る。シート・履歴には鍵そのものを残さない', () => {
  const { p, a, b } = twoOrganizers();
  assert.match(a.adminKey, /^[a-f0-9]{64}$/);
  assert.notEqual(a.adminKey, b.adminKey);
  const dump = p.store.dump();
  assert.ok(!dump.includes(a.adminKey) && !dump.includes(b.adminKey), '鍵がシートに平文で残っている');
  const events = p.store.get().getSheetByName('Events').records();
  assert.ok(events.every((e) => /^[a-f0-9]{64}$/.test(e.admin_key_hash)));
  // 詳細や一覧の応答にもハッシュを含めない
  assert.ok(!JSON.stringify(a.detail).includes(events[0].admin_key_hash));
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
  const dump = p.store.dump();
  const attempts = [
    ['eventDetail', { eventId: other.event.id }],
    ['updateEvent', { eventId: other.event.id, rev: other.event.rev, name: '乗っ取り', dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '' }],
    ['rotateKey', { eventId: other.event.id, rev: other.event.rev }],
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
  ];
  for (const [action, payload] of attempts) {
    const res = p.call(action, payload, { auth: authA });
    assert.equal(res.ok, false, `${action} ${JSON.stringify(payload)}`);
  }
  // 他の大会に触れる操作は、自分の大会側の検証で弾かれたものも含め、他の大会のデータを変えていない
  const after = p.call('eventDetail', { eventId: other.event.id });
  assert.equal(after.data.event.name, other.event.name);
  assert.equal(after.data.players.length, other.players.length);
  assert.equal(after.data.groups[3].matches[0].status, 'scheduled');
  assert.ok(dump.length > 0);
});

test('主催者: 管理者向けの操作はできず、一覧には自分の大会しか出ない', () => {
  const { p, a, authA } = twoOrganizers();
  for (const [action, payload] of [['initializeStorage', {}], ['configureStorage', { spreadsheetId: 'x' }], ['setViewerUrl', { url: '' }]]) {
    assert.equal(p.call(action, payload, { auth: authA }).error.code, 'FORBIDDEN', action);
  }
  const boot = p.call('bootstrap', {}, { auth: authA }).data;
  assert.deepEqual(Array.from(boot.events, (e) => e.id), [a.eventId]);
  assert.equal(boot.role.kind, 'organizer');
  assert.equal(boot.storage.spreadsheetId, undefined, '保存先の ID は管理者以外に返さない');
  // 既定表示（プラットフォーム全体の設定）は主催者には変えられない
  const ev = a.detail.event;
  const d = p.call('updateEvent', { eventId: ev.id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '' }, { auth: authA }).data.detail;
  assert.equal(d.event.isFeatured, false);
});

test('未認証: 大会の作成と初期表示以外はできず、初期表示では大会も保存先も見えない', () => {
  const { p, a } = twoOrganizers();
  const boot = p.call('bootstrap', {}, { auth: 'anon' }).data;
  assert.deepEqual(Array.from(boot.events), []);
  assert.equal(boot.role.kind, 'anonymous');
  assert.equal(boot.storage.spreadsheetId, undefined);
  assert.equal(boot.storage.spreadsheetName, undefined);
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  assert.equal(p.call('saveMatchResult', { matchId: 'MAT-AAAAAAAAAAAA', rev: 1, status: 'live', p1Legs: 0, p2Legs: 0 }, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
  assert.equal(p.call('initializeStorage', {}, { auth: 'anon' }).error.code, 'FORBIDDEN');
});

test('鍵の確認: 違う鍵・形式違い・存在しない大会・別の大会の鍵はすべて同じエラーで拒否する', () => {
  const { p, a, b, authB } = twoOrganizers();
  const bad = [
    { eventId: a.eventId, key: 'f'.repeat(64) },
    { eventId: a.eventId, key: authB.key },
    { eventId: 'EVT-AAAAAAAAAAAA', key: a.adminKey },
    { eventId: a.eventId, key: a.adminKey.toUpperCase() },
    { eventId: a.eventId, key: a.adminKey.slice(0, 40) },
    { eventId: a.eventId },
    { key: a.adminKey },
    { eventId: "EVT-1' OR '1'='1", key: a.adminKey },
  ];
  for (const auth of bad) {
    const res = p.call('eventDetail', { eventId: a.eventId }, { auth });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'AUTH_INVALID', JSON.stringify(auth));
  }
  assert.ok(b.eventId);
});

test('運営用 URL の再発行: 新しい鍵が返り、古い鍵はすぐに使えなくなる（主催者・管理者のどちらからでも）', () => {
  const { p, a, authA } = twoOrganizers();
  const ev = p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).data.event;
  const rotated = p.call('rotateKey', { eventId: a.eventId, rev: ev.rev }, { auth: authA });
  assert.equal(rotated.ok, true);
  assert.match(rotated.data.adminKey, /^[a-f0-9]{64}$/);
  assert.notEqual(rotated.data.adminKey, a.adminKey);
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: authA }).error.code, 'AUTH_INVALID');
  const authNew = { eventId: a.eventId, key: rotated.data.adminKey };
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: authNew }).ok, true);
  // 管理者が再発行（紛失時）
  const ev2 = p.call('eventDetail', { eventId: a.eventId }).data.event;
  const byAdmin = p.call('rotateKey', { eventId: a.eventId, rev: ev2.rev });
  assert.equal(byAdmin.ok, true);
  assert.equal(p.call('eventDetail', { eventId: a.eventId }, { auth: authNew }).error.code, 'AUTH_INVALID');
  // 履歴に鍵を残さない
  assert.ok(!p.store.dump().includes(byAdmin.data.adminKey));
});

test('大会作成の通信が切れて再送されても、同じ大会・同じ鍵を返す（大会は 1 つだけ作られる）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const requestId = 'create-request-000001';
  const first = p.call('createEvent', { name: '大会', bestOf: 5, groupCount: 1 }, { auth: 'anon', requestId });
  const again = p.call('createEvent', { name: '大会', bestOf: 5, groupCount: 1 }, { auth: 'anon', requestId });
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.eventId, first.data.eventId);
  assert.equal(again.data.adminKey, first.data.adminKey);
  assert.equal(p.store.get().getSheetByName('Events').records().length, 1);
});

test('作成コード: 設定されていればコードを知っている人だけが大会を作れる（管理者は不要）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  p.admin.properties.setProperty('CREATE_CODE', 'darts-2026');
  const input = { name: '大会', bestOf: 5, groupCount: 1 };
  assert.equal(p.call('bootstrap', {}, { auth: 'anon' }).data.createCodeRequired, true);
  assert.equal(p.call('createEvent', input, { auth: 'anon' }).error.code, 'FORBIDDEN');
  assert.equal(p.call('createEvent', { ...input, createCode: 'wrong' }, { auth: 'anon' }).error.code, 'FORBIDDEN');
  assert.equal(p.call('createSampleEvent', { createCode: 'wrong' }, { auth: 'anon' }).error.code, 'FORBIDDEN');
  assert.equal(p.call('createEvent', { ...input, createCode: ' darts-2026 ' }, { auth: 'anon' }).ok, true);
  assert.equal(p.call('createEvent', input).ok, true, '管理者はコード不要');
  assert.equal(p.store.get().getSheetByName('Events').records().length, 2);
});

test('作成の上限: 管理者以外は 1 時間に 10 件まで', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  for (let i = 0; i < 10; i++) assert.equal(p.call('createEvent', { name: `大会${i}`, bestOf: 5, groupCount: 1 }, { auth: 'anon' }).ok, true);
  assert.equal(p.call('createEvent', { name: '11件目', bestOf: 5, groupCount: 1 }, { auth: 'anon' }).error.code, 'LIMIT');
  assert.equal(p.call('createEvent', { name: '管理者', bestOf: 5, groupCount: 1 }).ok, true);
  p.clock.advance(3600_000);
  assert.equal(p.call('createEvent', { name: '1時間後', bestOf: 5, groupCount: 1 }, { auth: 'anon' }).ok, true);
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

test('既存の大会（運営用 URL 未発行）は管理者だけが操作でき、管理者が発行できる', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: '旧大会', bestOf: 5, groupCount: 1 }).eventId;
  // 旧バージョンで作られた大会を再現（鍵のハッシュなし）
  const sheet = p.store.get().getSheetByName('Events');
  sheet.rows[1][sheet.rows[0].indexOf('admin_key_hash')] = '';
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: { eventId: id, key: 'a'.repeat(64) } }).error.code, 'AUTH_INVALID');
  const ev = p.ok('eventDetail', { eventId: id }).event;
  const issued = p.ok('rotateKey', { eventId: id, rev: ev.rev });
  assert.equal(p.call('eventDetail', { eventId: id }, { auth: { eventId: id, key: issued.adminKey } }).ok, true);
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
  for (const secret of ['SECRET-MEMO', 'SECRET-PLAYER-NOTE', 'owner@example.com', '"rev"', 'history', 'notes', 'SPREADSHEET', 'spreadsheet', 'is_public', 'external_ref', 'problems']) {
    assert.ok(!text.includes(secret), `公開データに ${secret} が含まれている`);
  }
  // 公開データに含めてよいキーの一覧（これ以外が増えたら見直す）
  const ALLOWED = new Set([
    'advanced', 'bestOf', 'champion', 'check', 'complete', 'cycles', 'dataUpdatedAt', 'dateLabel', 'entrants', 'event', 'final', 'format', 'groups',
    'id', 'label', 'legs', 'legsAgainst', 'legsFor', 'legsToWin', 'live', 'lost', 'matches', 'name', 'order', 'p1', 'p2', 'pending', 'played',
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
  for (const file of ['admin/src/client/admin.js', 'viewer/src/client/viewer.js']) {
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
