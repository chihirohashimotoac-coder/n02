// 運営用 API（doPost）の結合テスト。スプレッドシートは gas-mock の模擬実装。認証は既定で管理者の鍵。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair, createStore, loadProject, SPREADSHEET_ID, ADMIN_KEY } from './gas-mock.mjs';

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

function createEvent(p, extra = {}) {
  return p.ok('createEvent', { name: 'テスト大会', dateLabel: '2026/11/03', bestOf: 5, provisional: true, groupCount: 2, ...extra }).eventId;
}

function setupEventWithMatches(p) {
  const eventId = createEvent(p);
  p.ok('addPlayers', { eventId, names: ['選手A', '選手B', '選手C', '選手D', '選手E', '選手F', '選手G', '選手H'] });
  p.ok('autoAssign', { eventId });
  const d = p.ok('generateMatches', { eventId });
  return { eventId, detail: d.detail };
}

const firstMatch = (detail) => detail.groups[0].matches[0];

test('保存先の設定: 未設定の状態から Web 画面で ID（共有リンク）を登録できる', () => {
  const store = createStore();
  store.add();
  const admin = loadProject('admin', { store, properties: { ADMIN_KEY } });
  const auth = { adminKey: ADMIN_KEY };
  const call = (action, payload, requestId = 'setup-request-0000001') => admin.post({ action, payload, requestId, auth });
  let boot = admin.post({ action: 'bootstrap', auth });
  assert.equal(boot.data.storage.configured, false);
  const res = call('configureStorage', { spreadsheetId: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?usp=sharing` });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(admin.properties.getProperty('SPREADSHEET_ID'), SPREADSHEET_ID);
  // 2 回目は拒否（保存先の付け替えは Apps Script のプロパティ編集でのみ）
  const again = call('configureStorage', { spreadsheetId: SPREADSHEET_ID }, 'setup-request-0000002');
  assert.equal(again.error.code, 'ALREADY_CONFIGURED');
  // 開けない ID は保存しない
  const admin2 = loadProject('admin', { store, properties: { ADMIN_KEY } });
  const bad = admin2.post({ action: 'configureStorage', payload: { spreadsheetId: '1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' }, requestId: 'setup-request-0000003', auth });
  assert.equal(bad.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(admin2.properties.getProperty('SPREADSHEET_ID'), null);
});

test('初期化: 必要なシートと見出しを作る。2 回実行しても既存データは消えない', () => {
  const p = setupPair();
  const first = p.ok('initializeStorage');
  assert.equal(first.storage.initialized, true);
  assert.deepEqual([...first.initializeResult.created].sort(), ['Entries', 'Events', 'Groups', 'History', 'Matches', 'Players', 'PublicSnapshots', 'Rules', 'Stages']);
  const eventId = createEvent(p);
  const before = p.store.get().getSheetByName('Events').records();
  const second = p.ok('initializeStorage');
  assert.equal(second.initializeResult.created.length, 0);
  assert.deepEqual(p.store.get().getSheetByName('Events').records(), before);
  assert.equal(p.store.get().getSheetByName('シート1') !== null, true, '既存のシートは削除しない');
  assert.ok(p.ok('eventDetail', { eventId }));
});

test('初期化: 列が足りないシートには末尾に列を足すだけで、既存の列・値は動かさない', () => {
  const p = ready();
  const sheet = p.store.get().getSheetByName('Players');
  // 将来のバージョンで列が増えた状況を、既存列を 1 つ消して再現する
  const header = sheet.rows[0];
  const idx = header.indexOf('external_ref');
  header.splice(idx, 1);
  const res = p.ok('initializeStorage');
  assert.deepEqual([...res.initializeResult.extended], ['Players: external_ref']);
  assert.equal(sheet.rows[0][0], 'player_id');
  assert.equal(sheet.rows[0][sheet.rows[0].length - 1], 'external_ref');
});

test('初期化: 管理対象外のデータがあるスプレッドシートには何も書き込まない', () => {
  const p = setupPair();
  const book = p.store.get();
  book.getSheetByName('シート1').getRange(1, 1, 1, 2).setValues([['実大会', '既存データ']]);
  const dump = p.store.dump();
  const res = p.call('initializeStorage');
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UNSAFE_TARGET');
  assert.equal(p.store.dump(), dump, '中止時はシートを作らない・書き込まない');
});

test('大会作成: 大会・ルール（暫定）・ロビンのステージ・グループが ID 付きで作られる', () => {
  const p = ready();
  const eventId = createEvent(p, { groupCount: 3 });
  assert.match(eventId, /^EVT-[A-Z0-9]{12}$/);
  const d = p.ok('eventDetail', { eventId });
  assert.equal(d.event.name, 'テスト大会');
  assert.equal(d.event.isPublic, false);
  assert.equal(d.rule.bestOf, 5);
  assert.equal(d.rule.legsToWin, 3);
  assert.equal(d.rule.provisional, true);
  assert.deepEqual(Array.from(d.groups, (g) => g.name), ['グループA', 'グループB', 'グループC']);
  assert.equal(d.stage.type, 'round_robin');
  const rules = p.store.get().getSheetByName('Rules').records();
  assert.match(rules[0].notes, /暫定/);
});

test('選手: 追加・名前変更・削除。重複名・不正な名前は拒否', () => {
  const p = ready();
  const eventId = createEvent(p);
  p.ok('addPlayers', { eventId, names: ['山田', '1/2', '2026-01-01', 'TRUE', '007'] });
  let d = p.ok('eventDetail', { eventId });
  // スプレッドシートの自動変換（日付・数値・真偽値）を受けずに文字列のまま保存されている
  assert.deepEqual(Array.from(d.players, (x) => x.name), ['山田', '1/2', '2026-01-01', 'TRUE', '007']);
  assert.equal(p.call('addPlayers', { eventId, names: ['山田'] }).error.code, 'VALIDATION');
  assert.equal(p.call('addPlayers', { eventId, names: ['=HYPERLINK("http://example.com")'] }).error.code, 'VALIDATION');
  assert.equal(p.call('addPlayers', { eventId, names: [] }).error.code, 'VALIDATION');
  const yamada = d.players[0];
  d = p.ok('updatePlayer', { playerId: yamada.id, rev: yamada.rev, name: '山田 一郎' }).detail;
  assert.equal(d.players[0].name, '山田 一郎');
  // 古い rev での更新は競合として拒否
  assert.equal(p.call('updatePlayer', { playerId: yamada.id, rev: yamada.rev, name: '山田 二郎' }).error.code, 'CONFLICT');
  d = p.ok('deletePlayer', { playerId: d.players[1].id, rev: d.players[1].rev }).detail;
  assert.equal(d.players.length, 4);
});

test('選手数の上限: 1 回 64 名・1 大会 128 名', () => {
  const p = ready();
  const eventId = createEvent(p);
  const names = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  assert.equal(p.call('addPlayers', { eventId, names: names(65, 'a') }).error.code, 'VALIDATION');
  p.ok('addPlayers', { eventId, names: names(64, 'a') });
  p.ok('addPlayers', { eventId, names: names(64, 'b') });
  assert.equal(p.call('addPlayers', { eventId, names: ['c'] }).error.code, 'VALIDATION');
});

test('グループ: 自動割当・手動割当・対戦カード作成。カード作成後は構成を変更できない', () => {
  const p = ready();
  const { eventId, detail } = setupEventWithMatches(p);
  assert.deepEqual(Array.from(detail.groups, (g) => g.players.length), [4, 4]);
  assert.deepEqual(Array.from(detail.groups, (g) => g.matches.length), [6, 6]);
  assert.equal(detail.progress.total, 12);
  assert.equal(p.call('setGroupCount', { eventId, count: 3 }).error.code, 'LOCKED');
  assert.equal(p.call('autoAssign', { eventId }).error.code, 'LOCKED');
  const pl = detail.players[0];
  assert.equal(p.call('assignPlayer', { eventId, playerId: pl.id, groupId: '' }).error.code, 'LOCKED');
  assert.equal(p.call('deletePlayer', { playerId: pl.id, rev: pl.rev }).error.code, 'LOCKED');
  // 二重作成はしない
  const again = p.ok('generateMatches', { eventId });
  assert.equal(again.created, 0);
  assert.equal(again.skipped.length, 2);
  // 結果が入ったグループのカードは消せない
  const m = firstMatch(detail);
  p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
  assert.equal(p.call('clearMatches', { eventId, groupId: detail.groups[0].id }).error.code, 'LOCKED');
  // 結果のないグループは消せて、構成変更もできるようになる
  p.ok('clearMatches', { eventId, groupId: detail.groups[1].id });
  const d = p.ok('assignPlayer', { eventId, playerId: detail.groups[1].players[0].id, groupId: '' }).detail;
  assert.equal(d.groups[1].players.length, 3);
});

test('グループ数の変更・名前変更（カード作成前）', () => {
  const p = ready();
  const eventId = createEvent(p, { groupCount: 2 });
  p.ok('addPlayers', { eventId, names: ['a', 'b', 'c', 'd'] });
  p.ok('autoAssign', { eventId });
  let d = p.ok('setGroupCount', { eventId, count: 4 }).detail;
  assert.equal(d.groups.length, 4);
  d = p.ok('setGroupCount', { eventId, count: 1 }).detail;
  assert.equal(d.groups.length, 1);
  assert.equal(d.groups[0].players.length, 2, '削除したグループの選手は未割当に戻る');
  assert.equal(p.call('setGroupCount', { eventId, count: 0 }).error.code, 'VALIDATION');
  assert.equal(p.call('setGroupCount', { eventId, count: 17 }).error.code, 'VALIDATION');
  d = p.ok('renameGroup', { groupId: d.groups[0].id, rev: d.groups[0].rev, name: '予選1組' }).detail;
  assert.equal(d.groups[0].name, '予選1組');
});

test('試合結果: Best of 5 の成立条件を満たさない結果は確定できない（サーバー側で拒否）', () => {
  const p = ready();
  const { detail } = setupEventWithMatches(p);
  const m = firstMatch(detail);
  for (const [a, b] of [[2, 1], [3, 3], [4, 1], [0, 0], [2, 2]]) {
    const res = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: a, p2Legs: b });
    assert.equal(res.error.code, 'VALIDATION', `${a}-${b}`);
  }
  for (const [status, a, b] of [['live', 3, 1], ['scheduled', 1, 0], ['live', -1, 0], ['live', 'x', 0], ['live', 1.5, 0], ['done', 3, 0]]) {
    assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status, p1Legs: a, p2Legs: b }).error.code, 'VALIDATION', `${status} ${a}-${b}`);
  }
  // 拒否された保存は何も書き込まない
  const stored = p.store.get().getSheetByName('Matches').records().find((r) => r.match_id === m.id);
  assert.equal(stored.status, 'scheduled');
  assert.equal(stored.player1_legs, 0);
});

test('試合結果: 進行中 → 確定 → 訂正。勝者は確定時のみ、訂正は明示が必要', () => {
  const p = ready();
  const { detail } = setupEventWithMatches(p);
  let m = firstMatch(detail);
  let d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: '２', p2Legs: 1 }).detail;
  m = firstMatch(d);
  assert.equal(m.status, 'live');
  assert.equal(m.p1.legs, 2);
  assert.equal(m.winnerId, null);
  d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 }).detail;
  m = firstMatch(d);
  assert.equal(m.status, 'final');
  assert.equal(m.winnerId, m.p1.id);
  assert.ok(m.confirmedAt);
  // 確定済みは「訂正」指定なしでは変更できない
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 1, p2Legs: 3 }).error.code, 'ALREADY_FINAL');
  d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 1, p2Legs: 3, correction: true }).detail;
  m = firstMatch(d);
  assert.equal(m.winnerId, m.p2.id);
  // 訂正で進行中に戻すと勝者は消える
  d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 2, correction: true }).detail;
  assert.equal(firstMatch(d).winnerId, null);
  const actions = Array.from(d.history, (h) => h.action);
  assert.ok(actions.includes('match.correct'));
  assert.ok(actions.includes('match.result'));
  // 集計は確定試合のみ
  assert.equal(d.groups[0].summary.reduce((s, x) => s + x.played, 0), 0);
});

test('同時更新: 2 つの画面が同じ試合を読み、後から保存した方は CONFLICT で拒否される', () => {
  const p = ready();
  const { detail } = setupEventWithMatches(p);
  const m = firstMatch(detail);
  const tabA = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 });
  const tabB = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 0, p2Legs: 3 });
  assert.equal(tabA.ok, true);
  assert.equal(tabB.error.code, 'CONFLICT');
  const stored = p.store.get().getSheetByName('Matches').records().find((r) => r.match_id === m.id);
  assert.equal(stored.player1_legs, 3, '先に保存した結果が残る');
});

test('同時更新: ロックを取れないときは BUSY を返し、何も書き込まない', () => {
  const p = ready();
  const { detail } = setupEventWithMatches(p);
  const m = firstMatch(detail);
  p.admin.lockBusy = true;
  const dump = p.store.dump();
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 }).error.code, 'BUSY');
  assert.equal(p.store.dump(), dump);
});

test('二重送信: 同じ requestId の書き込みは 1 回しか反映されない', () => {
  const p = ready();
  const eventId = createEvent(p);
  const requestId = 'duplicate-request-00001';
  const first = p.call('addPlayers', { eventId, names: ['a'] }, { requestId });
  const second = p.call('addPlayers', { eventId, names: ['b'] }, { requestId });
  assert.equal(first.ok, true);
  assert.deepEqual(second.data, { duplicate: true });
  assert.equal(p.ok('eventDetail', { eventId }).players.length, 1);
  // requestId のない書き込みは受け付けない
  const res = p.admin.post({ action: 'addPlayers', payload: { eventId, names: ['c'] }, auth: { adminKey: ADMIN_KEY } });
  assert.equal(res.error.code, 'BAD_REQUEST');
});

test('不正なリクエスト: 不明な操作・ID 形式違い・存在しない ID', () => {
  const p = ready();
  assert.equal(p.admin.post('null').error.code, 'BAD_REQUEST');
  assert.equal(p.admin.post('{broken').error.code, 'BAD_REQUEST');
  assert.equal(p.admin.post('[]').error.code, 'BAD_REQUEST');
  assert.equal(p.admin.post('x'.repeat(100001)).error.code, 'BAD_REQUEST');
  assert.equal(p.call('dropAllSheets').error.code, 'BAD_REQUEST');
  assert.equal(p.call('constructor').error.code, 'BAD_REQUEST');
  assert.equal(p.call('eventDetail', { eventId: "EVT-1' OR 1=1" }).error.code, 'BAD_REQUEST');
  assert.equal(p.call('eventDetail', { eventId: 'EVT-AAAAAAAAAAAA' }).error.code, 'NOT_FOUND');
  assert.equal(p.call('saveMatchResult', { matchId: 'MAT-AAAAAAAAAAAA', rev: 1, status: 'live', p1Legs: 0, p2Legs: 0 }).error.code, 'NOT_FOUND');
  assert.equal(p.call('updateEvent', { eventId: 'EVT-AAAAAAAAAAAA' }).error.code, 'NOT_FOUND');
});

test('ルール変更: 結果入力後は Best of を変更できない', () => {
  const p = ready();
  const { eventId, detail } = setupEventWithMatches(p);
  let d = p.ok('updateRule', { eventId, rev: detail.rule.rev, bestOf: 7, provisional: true }).detail;
  assert.equal(d.rule.bestOf, 7);
  const m = firstMatch(d);
  assert.equal(m.bestOf, 7);
  assert.equal(p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }).error.code, 'VALIDATION');
  d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 4, p2Legs: 0 }).detail;
  assert.equal(p.call('updateRule', { eventId, rev: d.rule.rev, bestOf: 5, provisional: true }).error.code, 'LOCKED');
  assert.equal(p.call('updateRule', { eventId, rev: d.rule.rev, bestOf: 4, provisional: true }).error.code, 'VALIDATION');
  d = p.ok('updateRule', { eventId, rev: d.rule.rev, bestOf: 7, provisional: false }).detail;
  assert.equal(d.rule.provisional, false);
});

test('公開: 公開にすると PublicSnapshots に書かれ、非公開に戻すと消える。既定表示は 1 大会だけ', () => {
  const p = ready();
  const { eventId, detail } = setupEventWithMatches(p);
  const snapshots = () => p.store.get().getSheetByName('PublicSnapshots').records();
  assert.equal(snapshots().length, 0);
  const ev = detail.event;
  let d = p.ok('updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: 'running', isPublic: true, isFeatured: true, notes: '' }).detail;
  assert.equal(d.publication.published, true);
  assert.equal(snapshots().length, 1);
  assert.equal(snapshots()[0].is_default, true);
  assert.equal(String(snapshots()[0].chunk_01).charAt(0), '~');
  // 結果の保存で公開データも更新される
  const before = snapshots()[0].version;
  const m = firstMatch(d);
  d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 2 }).detail;
  assert.notEqual(snapshots()[0].version, before);
  // 2 つ目の大会を既定表示にすると 1 つ目は既定でなくなる
  const second = createEvent(p, { name: '別の大会' });
  const ev2 = p.ok('eventDetail', { eventId: second }).event;
  p.ok('updateEvent', { eventId: second, rev: ev2.rev, name: ev2.name, dateLabel: '', status: 'draft', isPublic: true, isFeatured: true, notes: '' });
  const rows = snapshots();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.filter((r) => r.is_default).map((r) => r.event_id), [second]);
  // 非公開に戻すと行が消える
  const ev3 = p.ok('eventDetail', { eventId }).event;
  p.ok('updateEvent', { eventId, rev: ev3.rev, name: ev3.name, dateLabel: '', status: 'running', isPublic: false, isFeatured: false, notes: '' });
  assert.deepEqual(snapshots().map((r) => r.event_id), [second]);
});

test('サンプル大会: 16 名・4×4 ロビン・24 試合、Best of 5（暫定）、確定・進行中・未開始を含む', () => {
  const p = ready();
  const d = p.ok('createSampleEvent', { publish: true }).detail;
  assert.equal(d.players.length, 16);
  assert.equal(d.groups.length, 4);
  assert.deepEqual(Array.from(d.groups, (g) => g.players.length), [4, 4, 4, 4]);
  assert.equal(d.progress.total, 24);
  assert.equal(d.progress.final, 12);
  assert.equal(d.progress.live, 2);
  assert.equal(d.progress.scheduled, 10);
  assert.equal(d.progress.check, 0);
  assert.equal(d.rule.bestOf, 5);
  assert.equal(d.rule.provisional, true);
  assert.equal(d.event.isSample, true);
  assert.equal(d.publication.published, true);
  assert.ok(d.players.every((x) => /^サンプル選手\d\d$/.test(x.name)));
  // グループ A は全試合確定。勝敗の合計が一致する
  const a = d.groups[0];
  assert.equal(a.summary.reduce((s, x) => s + x.won, 0), 6);
  assert.equal(a.summary.reduce((s, x) => s + x.lost, 0), 6);
});

test('履歴: 書き込み操作ごとに History へ記録される（操作者・前後の値）', () => {
  const p = ready();
  const { detail } = setupEventWithMatches(p);
  const m = firstMatch(detail);
  p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 });
  const rows = p.store.get().getSheetByName('History').records();
  const last = rows[rows.length - 1];
  assert.equal(last.action, 'match.result');
  assert.equal(last.actor, 'admin');
  assert.equal(JSON.parse(last.before_json).status, 'scheduled');
  assert.equal(JSON.parse(last.after_json).player1_legs, 3);
  assert.ok(rows.every((r) => /^HIS-/.test(r.history_id)));
});

test('行数が足りなくなったら行を追加し、追加した行にも文字列の書式を設定する', () => {
  const store = createStore();
  store.add();
  store.defaultMaxRows = 5;
  const p = setupPair({ store });
  p.ok('initializeStorage');
  const eventId = createEvent(p);
  p.ok('addPlayers', { eventId, names: ['1/2', '3/4', '5/6', '7/8', '9/10', '11/12'] });
  const names = Array.from(p.ok('eventDetail', { eventId }).players, (x) => x.name);
  assert.deepEqual(names, ['1/2', '3/4', '5/6', '7/8', '9/10', '11/12']);
});

test('シートを直接書き換えて不整合が生じても、公開データでは「確認中」になり勝者を出さない', () => {
  const p = ready();
  const { eventId, detail } = setupEventWithMatches(p);
  const ev = detail.event;
  p.ok('updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: true, notes: '' });
  const sheet = p.store.get().getSheetByName('Matches');
  const header = sheet.rows[0];
  const row = sheet.rows[1];
  row[header.indexOf('status')] = 'final';
  row[header.indexOf('player1_legs')] = 2;
  row[header.indexOf('player2_legs')] = 1;
  p.ok('republish', { eventId });
  p.viewer.cache.clear();
  const res = p.viewer.run('getPublicSnapshot', {});
  const match = res.data.groups.flatMap((g) => g.matches).find((m) => m.id === row[header.indexOf('match_id')]);
  assert.equal(match.status, 'check');
  assert.equal(match.winnerId, null);
  assert.equal(match.p1.legs, null);
});

test('閲覧者用 URL: GitHub Pages と Apps Script の URL だけを登録できる', () => {
  const p = ready();
  assert.equal(p.ok('setViewerUrl', { url: 'https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/' }).viewerUrl, 'https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/');
  assert.equal(p.ok('setViewerUrl', { url: 'https://script.google.com/macros/s/AKfycbABC_-123/exec' }).viewerUrl, 'https://script.google.com/macros/s/AKfycbABC_-123/exec');
  for (const bad of ['http://example.github.io/x/', 'https://evil.example.com/', 'javascript:alert(1)', 'https://a.github.io/x/?q=<script>']) {
    assert.equal(p.call('setViewerUrl', { url: bad }).error.code, 'VALIDATION', bad);
  }
  assert.equal(p.ok('setViewerUrl', { url: '' }).viewerUrl, '');
});
