// ポータル「トーナメント・リーグ」の画面側の処理（検索・並べ替え・進捗の帯・ログインの記憶）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './gas-mock.mjs';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(join(ROOT, 'portal/src/client/portal.js'), 'utf8'), ctx);
const P = ctx.TPPortal;

const ev = (id, patch = {}) => ({ id: 'EVT-' + id, name: '大会' + id, status: 'running', dateLabel: '', updatedAt: '2026-10-20T00:00:00.000Z', format: { kind: 'robin' }, ...patch });

test('検索: 部分一致・全角半角・大文字小文字・ひらがなカタカナ・空白を区別しない', () => {
  const list = [ev('A', { name: 'n02 オープン 2026' }), ev('B', { name: '秋季ダーツリーグ' }), ev('C', { name: 'ＮＯ２カップ' })];
  const names = (q) => Array.from(P.filterEvents(list, { q }), (e) => e.name).sort();
  assert.deepEqual(names('オープン'), ['n02 オープン 2026']);
  assert.deepEqual(names('おーぷん'), ['n02 オープン 2026']);
  assert.deepEqual(names('N02'), ['n02 オープン 2026']);
  assert.deepEqual(names('ｎ０２オープン'), ['n02 オープン 2026']);
  assert.deepEqual(names('りーぐ'), ['秋季ダーツリーグ']);
  assert.deepEqual(names('no2'), ['ＮＯ２カップ']);
  assert.deepEqual(names('  '), names(''));
  assert.equal(names('').length, 3);
  assert.deepEqual(names('存在しない'), []);
});

test('絞り込み: 開催状態と形式', () => {
  const list = [ev('A', { status: 'running', format: { kind: 'robin' } }), ev('B', { status: 'draft', format: { kind: 'tournament' } }), ev('C', { status: 'finished', format: { kind: 'mixed' } })];
  assert.deepEqual(Array.from(P.filterEvents(list, { status: 'draft' }), (e) => e.id), ['EVT-B']);
  assert.deepEqual(Array.from(P.filterEvents(list, { format: 'mixed' }), (e) => e.id), ['EVT-C']);
  assert.deepEqual(Array.from(P.filterEvents(list, { status: 'running', format: 'mixed' }), (e) => e.id), []);
  assert.deepEqual({ ...P.countByStatus(list) }, { all: 3, running: 1, draft: 1, finished: 1 });
});

test('並び順: 開催中 → 準備中 → 終了。準備中は開催日が近い順、終了は新しい順、開催中は更新が新しい順', () => {
  const list = [
    ev('F1', { status: 'finished', dateLabel: '2026/09/01' }),
    ev('D1', { status: 'draft', dateLabel: '2026/12/01' }),
    ev('R1', { status: 'running', updatedAt: '2026-10-20T10:00:00Z' }),
    ev('F2', { status: 'finished', dateLabel: '2026年10月12日' }),
    ev('D2', { status: 'draft', dateLabel: '2026-11-03〜04' }),
    ev('D3', { status: 'draft', dateLabel: '日付未定' }),
    ev('R2', { status: 'running', updatedAt: '2026-10-21T10:00:00Z' }),
    ev('F3', { status: 'finished', dateLabel: '' }),
  ];
  assert.deepEqual(Array.from(P.filterEvents(list, {}), (e) => e.id), ['EVT-R2', 'EVT-R1', 'EVT-D2', 'EVT-D1', 'EVT-D3', 'EVT-F2', 'EVT-F1', 'EVT-F3']);
});

test('開催日の読み取り', () => {
  assert.equal(P.parseDateLabel('2026/11/03'), Date.UTC(2026, 10, 3));
  assert.equal(P.parseDateLabel('2026-11-3（日）'), Date.UTC(2026, 10, 3));
  assert.equal(P.parseDateLabel('２０２６年１１月３日'), Date.UTC(2026, 10, 3));
  assert.equal(P.parseDateLabel('11/3'), null);
  assert.equal(P.parseDateLabel('2026/13/40'), null);
  assert.equal(P.parseDateLabel(''), null);
});

test('進捗の帯: 段階の幅は試合数に比例し、未作成の段階は見積もりか平均の幅で出す', () => {
  const segs = P.progressSegments({
    stages: [
      { name: 'ロビン', type: 'round_robin', total: 12, final: 6, live: 2, generated: true, estimated: 0, complete: false },
      { name: 'A', type: 'single_elimination', total: 0, final: 0, live: 0, generated: false, estimated: 3, complete: false },
      { name: 'B', type: 'single_elimination', total: 0, final: 0, live: 0, generated: false, estimated: 0, complete: false },
    ],
  });
  assert.deepEqual(Array.from(segs, (s) => s.state), ['running', 'ungenerated', 'ungenerated']);
  // 12 : 3 : 平均 7.5
  assert.ok(Math.abs(segs[0].width - (12 * 100) / 22.5) < 1e-9);
  assert.ok(Math.abs(segs[1].width - (3 * 100) / 22.5) < 1e-9);
  assert.ok(Math.abs(segs[2].width - (7.5 * 100) / 22.5) < 1e-9);
  assert.equal(segs[0].finalWidth, 50);
  assert.ok(Math.abs(segs[0].liveWidth - (2 * 100) / 12) < 1e-9);
  assert.equal(segs[1].finalWidth, 0);
  assert.deepEqual(Array.from(P.progressSegments({ stages: [] })), []);
});

test('現在の段階の説明', () => {
  assert.equal(P.currentStageText({ currentStage: { name: '予選', state: 'running' } }), '予選');
  assert.equal(P.currentStageText({ currentStage: { name: '決勝', state: 'ungenerated' } }), '決勝（対戦表は未作成）');
  assert.equal(P.currentStageText({ currentStage: { name: '決勝', state: 'done' } }), '決勝（全試合確定）');
  assert.equal(P.currentStageText({ currentStage: null }), '段階が未設定');
});

test('ログインの記憶（運営画面と同じ形式）: 期限切れ・壊れた値は使わない', () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  const ok = JSON.stringify({ session: 'a'.repeat(64), email: 'x@example.org', expiresAt: '2026-10-21T06:00:00Z' });
  assert.equal(P.readLoginValue(ok, now).email, 'x@example.org');
  assert.equal(P.readLoginValue(JSON.stringify({ session: 'a', expiresAt: '2026-10-20T23:59:59Z' }), now), null);
  assert.equal(P.readLoginValue('{broken', now), null);
  assert.equal(P.readLoginValue(null, now), null);
  assert.equal(P.readLoginValue(JSON.stringify({ expiresAt: '2027-01-01T00:00:00Z' }), now), null);
});

test('更新日時の表示', () => {
  const now = new Date(2026, 9, 21, 15, 0).getTime();
  assert.equal(P.formatUpdated(new Date(2026, 9, 21, 9, 5).toISOString(), now), '今日 09:05');
  assert.equal(P.formatUpdated(new Date(2026, 9, 2, 18, 30).toISOString(), now), '10/2 18:30');
  assert.equal(P.formatUpdated(new Date(2025, 0, 3, 18, 30).toISOString(), now), '2025/1/3');
  assert.equal(P.formatUpdated('', now), '');
});
