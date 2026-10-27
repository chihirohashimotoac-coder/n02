// v1.0: 50 人の期制リーグ 1 期目（1 回総当たり 1,225 試合・2 回総当たり 2,450 試合）を模擬環境で最後まで進めて計測する。
// 組み合わせの生成・結果の保存・順位の計算・公開データ（分割）・閲覧ページでの復元・次期の配置まで。
// 注意: 時間は Node.js 上の模擬環境（tests/gas-mock.mjs）の値で、Apps Script・スプレッドシートの実環境の時間ではない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupPair, ROOT } from './gas-mock.mjs';

const viewerCtx = vm.createContext({});
vm.runInContext(readFileSync(join(ROOT, 'viewer/src/client/viewer.js'), 'utf8'), viewerCtx);
const { hydrateParts } = viewerCtx.TPViewer;

const people = (n) => Array.from({ length: n }, (_, i) => ({ name: 'リーグ選手' + String(i + 1).padStart(3, '0') }));
const results = [];

function ms(t0) {
  return Date.now() - t0;
}

function run(cycles) {
  const p = setupPair();
  p.ok('initializeStorage');
  const m = { cycles, players: 50 };
  let t0 = Date.now();
  const id = p.ok('createSeasonLeague', { name: '50 人リーグ', thresholds: [12, 30], cycles, rule: { format: 'legs', bestOf: 5 } }).eventId;
  p.ok('importPlayers', { eventId: id, players: people(50) });
  let d = p.ok('eventDetail', { eventId: id });
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id });
  t0 = Date.now();
  m.created = p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id }).created;
  m.generateMs = ms(t0);
  // 公開してから結果を入れる（公開データは保存のたびに作り直される）
  const ev = p.ok('eventDetail', { eventId: id }).event;
  const pub = p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' });
  assert.equal(pub.publication.published, true, '50 人でも公開できる');
  // 結果: 名前の番号が小さい方の勝ち（3-0〜3-2 を混ぜる）。まとめて確定は 1 回 64 試合まで
  t0 = Date.now();
  let saves = 0;
  let maxSaveMs = 0;
  d = p.ok('eventDetail', { eventId: id });
  const all = d.stages[0].groups[0].matches;
  for (let i = 0; i < all.length; i += 64) {
    const batch = all.slice(i, i + 64).map((x, k) => {
      const lose = (i + k) % 3;
      return x.p1.name < x.p2.name ? { matchId: x.id, rev: x.rev, p1Legs: 3, p2Legs: lose } : { matchId: x.id, rev: x.rev, p1Legs: lose, p2Legs: 3 };
    });
    const s0 = Date.now();
    p.ok('saveMatchResults', { eventId: id, results: batch });
    maxSaveMs = Math.max(maxSaveMs, ms(s0));
    saves++;
  }
  m.saveOps = saves;
  m.saveTotalMs = ms(t0);
  m.saveMaxMs = maxSaveMs;
  t0 = Date.now();
  d = p.ok('eventDetail', { eventId: id });
  m.detailMs = ms(t0);
  m.detailChars = JSON.stringify(d).length;
  const st = d.stages[0].groups[0].standings;
  assert.equal(d.stages[0].groups[0].progress.final, m.created);
  assert.equal(st[0].rank, 1);
  // 順位: 名前順がそのまま成績順（全勝 49 勝 → 0 勝）
  assert.deepEqual(st.slice(0, 3).map((s) => s.won), [49 * cycles, 48 * cycles, 47 * cycles]);
  m.budget = d.snapshotBudget;
  // 閲覧者用アプリから本体とパートを取り、閲覧ページと同じ処理で元の形に戻す
  p.clock.advance(21000);
  t0 = Date.now();
  const main = p.viewer.run('getPublicSnapshot', { eventId: id });
  assert.equal(main.ok, true);
  const parts = {};
  m.partChars = [];
  for (const info of main.data.parts) {
    const res = p.viewer.run('getPublicSnapshot', { eventId: id, part: info.id });
    assert.equal(res.ok, true);
    assert.equal(res.version, info.version);
    parts[info.id] = { version: res.version, data: res.data };
    m.partChars.push(JSON.stringify(res.data).length);
  }
  m.viewerFetchMs = ms(t0);
  m.mainChars = JSON.stringify(main.data).length;
  m.parts = main.data.parts.length;
  assert.ok(m.mainChars <= 400000 && m.partChars.every((c) => c <= 400000), '本体・パートとも 1 行の上限（40 万文字）以内');
  t0 = Date.now();
  const merged = JSON.parse(JSON.stringify(hydrateParts(main.data, parts)));
  m.hydrateMs = ms(t0);
  // 分割前の公開データ（閲覧ページが表示に使う形）と一致する
  const fullView = p.admin.fn('buildPublicSnapshot_')(p.admin.fn('collectEvent_')(p.admin.fn('createContext_')(p.admin.fn('openStorage_')(), 'test', null), id));
  const full = JSON.parse(JSON.stringify(fullView));
  m.fullChars = JSON.stringify(full).length;
  assert.deepEqual(merged, full);
  // 公開データに管理用の情報を含めない
  const text = JSON.stringify(main.data) + JSON.stringify(Object.values(parts).map((x) => x.data));
  for (const secret of ['"rev"', 'storedStatus', 'resultNote', 'ownerEmail', 'notes', 'LMB-', '@']) assert.ok(!text.includes(secret), secret);
  // 次期（50 人 → 3 部制: 16・17・17 人）
  t0 = Date.now();
  const pv = p.ok('previewNextSeason', { eventId: id });
  m.previewMs = ms(t0);
  assert.equal(pv.ok, true, JSON.stringify(pv.problems));
  assert.deepEqual(pv.divisions.map((x) => x.size), [16, 17, 17]);
  t0 = Date.now();
  const next = p.ok('confirmNextSeason', { eventId: id, planVersion: pv.planVersion });
  m.confirmMs = ms(t0);
  const d2 = p.ok('eventDetail', { eventId: next.eventId });
  assert.deepEqual(d2.stages[0].groups.map((g) => g.players.length), [16, 17, 17]);
  // 次期を確定すると、前期の公開データに昇降格の結果が入る（版が変わる）。その後の再取得は、変わっていなければ本文を送らない（notModified）
  p.clock.advance(21000);
  const after = p.viewer.run('getPublicSnapshot', { eventId: id, knownVersion: main.version });
  assert.notEqual(after.version, main.version);
  assert.equal(after.data.event.season.next.outcome.length, 50);
  p.clock.advance(21000);
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: id, knownVersion: after.version }).notModified, true);
  const cells = p.store.get().sheets.reduce((sum, s) => sum + s.getLastRow() * s.getLastColumn(), 0);
  m.sheetCells = cells;
  results.push(m);
  return m;
}

test('50 人・1 回総当たり（1,225 試合）: 生成・結果・順位・公開データ（分割）・閲覧ページでの復元・次期の配置', () => {
  const m = run(1);
  assert.equal(m.created, 1225);
  console.log('# 50 人・1 回総当たり: ' + JSON.stringify(m));
});

test('50 人・2 回総当たり（2,450 試合）: 生成・結果・順位・公開データ（分割）・閲覧ページでの復元・次期の配置', () => {
  const m = run(2);
  assert.equal(m.created, 2450);
  console.log('# 50 人・2 回総当たり: ' + JSON.stringify(m));
  // 計測値をファイルに残す（docs の報告の元。リポジトリには入れない）
  try {
    mkdirSync(join(ROOT, 'test-results'), { recursive: true });
    writeFileSync(join(ROOT, 'test-results', 'v10-scale.json'), JSON.stringify(results, null, 2));
  } catch (e) {
    /* 書けない環境では残さない */
  }
});
