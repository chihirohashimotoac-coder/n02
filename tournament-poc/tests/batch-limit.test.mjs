// 監査 PR-15: まとめて確定の上限は画面とサーバーで同じ（64 試合）。サーバーの上限は変えない（65 試合は何も保存せずに拒否）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupPair, ROOT } from './gas-mock.mjs';

test('画面の MAX_BATCH_RESULTS とサーバーの MAX_BATCH_RESULTS_ は同じ値', () => {
  const client = readFileSync(join(ROOT, 'admin/src/client/admin.js'), 'utf8').match(/var MAX_BATCH_RESULTS = (\d+);/);
  const server = readFileSync(join(ROOT, 'admin/src/server/06_actions.js'), 'utf8').match(/var MAX_BATCH_RESULTS_ = (\d+);/);
  assert.ok(client && server);
  assert.equal(client[1], server[1]);
  assert.equal(Number(server[1]), 64);
});

test('サーバー: 64 試合は保存し、65 試合は何も保存せずに拒否する（上限は維持）', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: '上限', template: 'robin', groupCount: 2, rule: { format: 'legs', bestOf: 5 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: Array.from({ length: 18 }, (_, i) => '選手' + i) });
  const st = p.ok('eventDetail', { eventId: id }).stages[0];
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  p.ok('generateMatches', { eventId: id, stageId: st.id });
  const matches = () => p.ok('eventDetail', { eventId: id }).stages[0].groups.flatMap((g) => g.matches);
  const results = (list) => list.map((m) => ({ matchId: m.id, rev: m.rev, p1Legs: 3, p2Legs: 0 }));
  const all = matches();
  assert.equal(all.length, 72);
  const tooMany = p.call('saveMatchResults', { eventId: id, results: results(all.slice(0, 65)) });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error.code, 'VALIDATION');
  assert.equal(matches().filter((m) => m.status === 'final').length, 0, '何も保存しない');
  assert.equal(p.ok('saveMatchResults', { eventId: id, results: results(all.slice(0, 64)) }).saved, 64);
  assert.equal(matches().filter((m) => m.status === 'final').length, 64);
});
