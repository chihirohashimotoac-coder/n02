// セキュリティ: 公開される関数・権限・返却データの最小化
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupPair, loadProject, ROOT } from './gas-mock.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('google.script.run から呼べる関数（末尾 "_" なしのトップレベル関数）は各 2 つだけ', () => {
  const admin = loadProject('admin');
  const viewer = loadProject('viewer');
  const pub = (p) => p.topLevelFunctions().filter((f) => !f.endsWith('_')).sort();
  assert.deepEqual(pub(admin), ['adminCall', 'doGet']);
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
  for (const fn of ['adminCall', 'initializeStorage_', 'actionSaveMatchResult_', 'requireAdmin_']) {
    assert.throws(() => viewer.run(fn), /not found|private/, fn);
  }
});

test('マニフェスト: 閲覧者用は読み取り専用スコープのみ・匿名アクセス、運営者用は本人のみ', () => {
  const viewer = JSON.parse(read('dist/viewer/appsscript.json'));
  const admin = JSON.parse(read('dist/admin/appsscript.json'));
  assert.deepEqual(viewer.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.deepEqual(viewer.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(viewer.dependencies.enabledAdvancedServices, [{ userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4' }]);
  assert.deepEqual(admin.webapp, { executeAs: 'USER_DEPLOYING', access: 'MYSELF' });
  assert.deepEqual([...admin.oauthScopes].sort(), ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email']);
});

test('ソースに認証情報・スプレッドシート ID・メールアドレスを埋め込んでいない', () => {
  for (const file of ['dist/admin/Code.gs', 'dist/viewer/Code.gs', 'dist/admin/Index.html', 'dist/viewer/Index.html']) {
    const text = read(file);
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{44}/, `${file}: ID らしき長い文字列`);
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@(gmail|googlemail|example)\.com/i, `${file}: メールアドレス`);
    assert.doesNotMatch(text, /(api[_-]?key|client[_-]?secret|password)\s*[:=]/i, `${file}: 秘密情報らしき記述`);
  }
});

const ACTIONS = [
  ['bootstrap', {}],
  ['configureStorage', { spreadsheetId: 'x' }],
  ['initializeStorage', {}],
  ['createEvent', { name: 'x', bestOf: 5, groupCount: 1 }],
  ['createSampleEvent', { publish: true }],
  ['addPlayers', { eventId: 'EVT-AAAAAAAAAAAA', names: ['x'] }],
  ['saveMatchResult', { matchId: 'MAT-AAAAAAAAAAAA', rev: 1, status: 'final', p1Legs: 3, p2Legs: 0 }],
  ['setViewerUrl', { url: '' }],
  ['eventDetail', { eventId: 'EVT-AAAAAAAAAAAA' }],
];

test('運営者用 API: 匿名・他のアカウントからは全操作が FORBIDDEN で、何も書き込まれない', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const d = p.ok('createSampleEvent', { publish: true }).detail;
  const m = d.groups[1].matches[5];
  const targets = ACTIONS.concat([['saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }]]);
  const dump = p.store.dump();
  const props = JSON.stringify(p.admin.properties.getProperties());
  for (const user of ['', 'stranger@example.net', 'OWNER@example.com.evil.net']) {
    p.admin.activeUser = user;
    for (const [action, payload] of targets) {
      const res = p.call(action, payload);
      assert.equal(res.ok, false, `${user} ${action}`);
      assert.equal(res.error.code, 'FORBIDDEN', `${user} ${action}`);
      assert.equal(res.data, undefined);
    }
    const page = p.admin.run('doGet', {});
    assert.ok(!page.content.includes('adminCall'), '運営画面の HTML を返さない');
    assert.match(page.content, /運営者専用/);
  }
  assert.equal(p.store.dump(), dump, 'シートに変化なし');
  assert.equal(JSON.stringify(p.admin.properties.getProperties()), props, 'プロパティに変化なし');
});

test('運営者用 API: 所有者本人（メールの大文字小文字は区別しない）は操作できる', () => {
  const p = setupPair({ admin: { activeUser: 'Owner@Example.com' } });
  assert.equal(p.call('bootstrap').ok, true);
  assert.match(p.admin.run('doGet', {}).content, /adminCall/);
});

test('運営者用 API: 実行ユーザーのメールが取れない場合は誰も許可しない（フェイルクローズ）', () => {
  const p = setupPair({ admin: { owner: '' } });
  assert.equal(p.call('bootstrap').error.code, 'FORBIDDEN');
});

test('将来の複数管理者: ADMIN_EMAILS に列挙したアカウントだけを許可する', () => {
  const p = setupPair({ admin: { properties: { SPREADSHEET_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd', ADMIN_EMAILS: 'staff1@example.org, staff2@example.org' } } });
  p.admin.activeUser = 'staff2@example.org';
  assert.equal(p.call('bootstrap').ok, true);
  p.admin.activeUser = 'owner@example.com';
  assert.equal(p.call('bootstrap').error.code, 'FORBIDDEN', '一覧を設定したら所有者も一覧に含める必要がある');
  p.admin.activeUser = 'staff3@example.org';
  assert.equal(p.call('bootstrap').error.code, 'FORBIDDEN');
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
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (keys.add(k), walk(x)));
  };
  walk(res.data);
  assert.deepEqual([...keys].sort(), [
    'bestOf', 'check', 'dataUpdatedAt', 'dateLabel', 'event', 'final', 'groups', 'id', 'legs', 'legsAgainst', 'legsFor', 'legsToWin', 'live',
    'lost', 'matches', 'name', 'order', 'p1', 'p2', 'played', 'playerId', 'players', 'progress', 'provisional', 'round', 'rule', 'scheduled',
    'schema', 'stage', 'status', 'summary', 'total', 'type', 'winnerId', 'won',
  ].sort());
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
