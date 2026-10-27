// v1.0: 期制リーグ・分割した公開データに入る項目の確認と、閲覧者用アプリのパートの配信の安全性
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

// v0.8 までの許可リスト（tests/v08-public.test.mjs）に v1.0 で足した項目
const ALLOWED_V08 = [
  'advanced', 'bestOf', 'champion', 'check', 'complete', 'cycles', 'dataUpdatedAt', 'dateLabel', 'entrants', 'event', 'final', 'format', 'groups',
  'id', 'label', 'legs', 'legsAgainst', 'legsFor', 'legsToWin', 'live', 'lost', 'matches', 'name', 'order', 'p1', 'p2', 'pending', 'played', 'playerCount',
  'playerId', 'players', 'progress', 'provisional', 'rank', 'round', 'roundBestOf', 'rounds', 'rule', 'scheduled', 'schema', 'seed', 'setBestOf',
  'sets', 'setsAgainst', 'setsFor', 'setsToWin', 'source', 'stage', 'stages', 'standings', 'status', 'summary', 'thirdPlace', 'tiebreakers',
  'tied', 'total', 'type', 'winnerId', 'won',
  'drawn', 'timezone', 'announcement', 'text', 'updatedAt', 'ruleDisplay', 'category', 'startScore', 'inMode', 'outMode', 'bull', 'roundLimit', 'note',
  'points', 'win', 'draw', 'loss', 'adjustment', 'buchholz', 'byes', 'swiss', 'generated', 'roundsPlayed', 'drawMode', 'fixedRounds', 'startRound', 'direct',
  'grandFinal', 'sides', 'side', 'runnerUp', 'planned', 'nightPoints', 'nights', 'participants', 'results', 'place', 'provisionalPoints', 'nightWins', 'roster',
  'nightsComplete', 'schedule', 'date', 'time', 'venue', 'board', 'referee', 'original', 'resultType', 'fixedLegs', 'affiliation', 'rating',
];
const ALLOWED = new Set([
  ...ALLOWED_V08,
  // v1.0 期制リーグ
  'season', 'league', 'no', 'seasons', 'current', 'zone', 'next', 'outcome', 'kind', 'to', 'pairs', 'upper', 'lower', 'match',
  // v1.0 分割（本体の parts とグループの印、パートの中身）
  'parts', 'version', 'stageId', 'groupId', 'fromRound', 'toRound', 'count', 'matchesInParts', 'matchCount', 'kind', 'eventId', 'labels', 'rows',
]);
const FORBIDDEN = ['rev', 'notes', 'storedStatus', 'resultNote', 'reason', 'reasons', 'manual', 'changedBy', 'changedAt', 'ownerEmail', 'config', 'completion', 'log', 'email', 'collaborators', 'history', 'problems', 'withdrawn', 'role', 'memberId', 'members', 'confirmedAt', 'confirmedBy', 'planVersion', 'basis'];

function keysOf(data) {
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    // 回戦ごとの表示名（labels）のキーは回戦の番号（データ）なので項目名として数えない
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (/^\d+$/.test(k) || keys.add(k), walk(x)));
  };
  walk(data);
  return keys;
}

function publish(p, id) {
  const ev = p.ok('eventDetail', { eventId: id }).event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '運営メモ' });
}

test('期制リーグ（入替戦・確定後の結果）と分割した大会の公開データに、許可した項目以外・運営画面だけの項目が入らない', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id1 = p.ok('createSeasonLeague', { name: '公開確認', thresholds: [4], rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: id1, players: Array.from({ length: 8 }, (_, i) => ({ name: '選手' + (i + 1), affiliation: '所属' + i })) });
  let d = p.ok('eventDetail', { eventId: id1 });
  p.ok('autoAssign', { eventId: id1, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: id1, stageId: d.stages[0].id });
  d = p.ok('eventDetail', { eventId: id1 });
  p.ok('saveMatchResults', { eventId: id1, results: d.stages[0].groups[0].matches.map((m) => (m.p1.name < m.p2.name ? { matchId: m.id, rev: m.rev, p1Legs: 2, p2Legs: 1 } : { matchId: m.id, rev: m.rev, p1Legs: 1, p2Legs: 2 })) });
  const pv = p.ok('previewNextSeason', { eventId: id1 });
  const key = pv.rows[0].key;
  const edits = { moves: [{ key, division: 1, reason: '秘密の理由' }] };
  const id2 = p.ok('confirmNextSeason', { eventId: id1, edits, planVersion: p.ok('previewNextSeason', { eventId: id1, edits }).planVersion }).eventId;
  d = p.ok('eventDetail', { eventId: id2 });
  p.ok('generateMatches', { eventId: id2, stageId: d.stages[0].id });
  d = p.ok('eventDetail', { eventId: id2 });
  const all = d.stages[0].groups.flatMap((g) => g.matches);
  p.ok('saveMatchResults', { eventId: id2, results: all.map((m) => (m.p1.name < m.p2.name ? { matchId: m.id, rev: m.rev, p1Legs: 2, p2Legs: 1 } : { matchId: m.id, rev: m.rev, p1Legs: 1, p2Legs: 2 })) });
  p.ok('generatePlayoffs', { eventId: id2 });
  const pm = p.ok('eventDetail', { eventId: id2 }).stages[1].pairs[0].match;
  p.ok('saveMatchResult', { matchId: pm.id, rev: pm.rev, status: 'final', resultType: 'walkover', winnerSide: 2, note: '非公開の不戦の理由' });
  const pv2 = p.ok('previewNextSeason', { eventId: id2 });
  p.ok('confirmNextSeason', { eventId: id2, planVersion: pv2.planVersion });
  publish(p, id1);
  publish(p, id2);
  // 分割する大きな大会（50 人のリーグ）
  const big = p.ok('createEvent', { name: '大きな大会', template: 'league', rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: big, players: Array.from({ length: 50 }, (_, i) => ({ name: '大選手' + (i + 1) })) });
  d = p.ok('eventDetail', { eventId: big });
  p.ok('autoAssign', { eventId: big, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: big, stageId: d.stages[0].id });
  d = p.ok('eventDetail', { eventId: big });
  const bm = d.stages[0].groups[0].matches;
  p.ok('setSchedule', { matchId: bm[0].id, rev: bm[0].rev, date: '2026-11-03', time: '19:00', venue: '本店', board: '1', referee: '審判' });
  const bm1 = p.ok('eventDetail', { eventId: big }).stages[0].groups[0].matches[0];
  p.ok('postponeMatch', { matchId: bm1.id, rev: bm1.rev, reason: '非公開の延期理由' });
  p.ok('saveMatchResult', { matchId: bm[1].id, rev: bm[1].rev, status: 'final', resultType: 'retired', winnerSide: 1, note: '非公開の棄権理由', p1Legs: 1, p2Legs: 0 });
  publish(p, big);
  p.clock.advance(21000);
  for (const id of [id1, id2, big]) {
    const main = p.viewer.run('getPublicSnapshot', { eventId: id });
    assert.equal(main.ok, true);
    const bodies = [main.data];
    (main.data.parts || []).forEach((info) => bodies.push(p.viewer.run('getPublicSnapshot', { eventId: id, part: info.id }).data));
    for (const data of bodies) {
      const extra = [...keysOf(data)].filter((k) => !ALLOWED.has(k));
      assert.deepEqual(extra, [], id + ': 公開データに想定外の項目');
      FORBIDDEN.forEach((k) => assert.ok(!keysOf(data).has(k), id + ': ' + k));
      const text = JSON.stringify(data);
      for (const secret of ['運営メモ', '非公開', '秘密', '@', 'LMB-', 'LSN-', 'LGS-', '所属']) assert.ok(!text.includes(secret), id + ': ' + secret);
    }
    if (id === big) assert.equal(bodies.length, 3, '本体 + パート 2');
  }
});

test('閲覧者用アプリのパート: 大会 ID と合わない・形の違う指定は拒否。本体が非公開になったらパートも消える', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const big = p.ok('createEvent', { name: '大きな大会', template: 'league', rule: { format: 'legs', bestOf: 3 } }).eventId;
  const other = p.ok('createEvent', { name: '別の大会', template: 'league', rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: big, players: Array.from({ length: 50 }, (_, i) => ({ name: '選手' + (i + 1) })) });
  let d = p.ok('eventDetail', { eventId: big });
  p.ok('autoAssign', { eventId: big, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: big, stageId: d.stages[0].id });
  publish(p, big);
  publish(p, other);
  p.clock.advance(21000);
  const part = big + '.P01';
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: big, part }).ok, true);
  for (const req of [{ part }, { eventId: other, part }, { eventId: big, part: big + '.P1' }, { eventId: big, part: big + '.X01' }, { eventId: big, part: 123 }, { eventId: big, part: big + '.P01/../' }]) {
    const r = p.viewer.run('getPublicSnapshot', req);
    assert.equal(r.ok, false, JSON.stringify(req));
    assert.equal(r.error.code, 'BAD_REQUEST', JSON.stringify(req));
  }
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: big, part: big + '.P09' }).error.code, 'NO_PUBLIC_EVENT');
  // ?format=json&part=
  const via = JSON.parse(p.viewer.fn('doGet')({ parameter: { format: 'json', event: big, part } }).getContent());
  assert.equal(via.ok, true);
  assert.equal(via.data.kind, 'matches');
  // 一覧に分割行は出ない
  const list = JSON.parse(p.viewer.fn('doGet')({ parameter: { format: 'list' } }).getContent());
  assert.deepEqual(list.data.events.map((e) => e.id).sort(), [big, other].sort());
  // 非公開にすると本体もパートも消える
  d = p.ok('eventDetail', { eventId: big });
  p.ok('updateEvent', { eventId: big, rev: d.event.rev, name: d.event.name, dateLabel: '', status: 'running', isPublic: false, isFeatured: false, notes: '' });
  assert.equal(p.store.get().getSheetByName('PublicSnapshots').records().filter((r) => String(r.event_id).startsWith(big)).length, 0);
  p.clock.advance(21000);
  assert.equal(p.viewer.run('getPublicSnapshot', { eventId: big, part }).error.code, 'NO_PUBLIC_EVENT');
  // 小さくなったら分割をやめ、使わなくなったパートの行を消す
  publish(p, big);
  d = p.ok('eventDetail', { eventId: big });
  p.ok('clearMatches', { eventId: big, groupId: d.stages[0].groups[0].id });
  const rows = p.store.get().getSheetByName('PublicSnapshots').records().filter((r) => String(r.event_id).startsWith(big));
  assert.deepEqual(rows.map((r) => r.event_id), [big]);
  // 大会を消すとパートも消える
  publish(p, other);
  p.ok('generateMatches', { eventId: big, stageId: d.stages[0].id });
  assert.ok(p.store.get().getSheetByName('PublicSnapshots').records().some((r) => r.event_id === part));
  const ev = p.ok('eventDetail', { eventId: big }).event;
  p.ok('deleteEvent', { eventId: big, rev: ev.rev, confirmName: '大きな大会' });
  assert.equal(p.store.get().getSheetByName('PublicSnapshots').records().filter((r) => String(r.event_id).startsWith(big)).length, 0);
});

test('閲覧ページ: パートの取得は変わったものだけ。版が合わなければ失敗として再試行に回す', async () => {
  const vm = await import('node:vm');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROOT } = await import('./gas-mock.mjs');
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(ROOT, 'viewer/src/client/viewer.js'), 'utf8'), ctx);
  const { withParts } = ctx.TPViewer;
  const main = { event: { id: 'EVT-AAAA1111' }, stages: [{ id: 'S', groups: [{ id: 'G', players: [{ id: 'P1', name: 'A' }, { id: 'P2', name: 'B' }], matches: [], matchesInParts: true, matchCount: 1 }] }], groups: [], parts: [{ id: 'EVT-AAAA1111.P01', version: 'v1', groupId: 'G' }] };
  const body = { schema: 1, kind: 'matches', groupId: 'G', labels: { 1: '第1節' }, rows: [['MAT-1', 1, 1, 0, 1, 3, 1, null, null, 'f', 1, 5]] };
  const cache = {};
  const calls = [];
  const fetchOne = (req, ok) => {
    calls.push(req.part);
    ok({ ok: true, version: 'v1', data: body });
  };
  let got = null;
  withParts(fetchOne, cache, 'EVT-AAAA1111', { ok: true, version: 'm1', data: main }, (r) => (got = r), () => assert.fail('fail'));
  assert.deepEqual(calls, ['EVT-AAAA1111.P01']);
  assert.equal(got.data.stages[0].groups[0].matches[0].p2.name, 'B');
  assert.equal(got.data.stages[0].groups[0].matches[0].winnerId, 'P1');
  assert.equal(got.data.stages[0].groups[0].matches[0].label, '第1節');
  assert.equal(got.data.parts, undefined);
  // 2 回目（本体の版が変わったがパートは同じ）: パートは取り直さない
  withParts(fetchOne, cache, 'EVT-AAAA1111', { ok: true, version: 'm2', data: main }, (r) => (got = r), () => assert.fail('fail'));
  assert.equal(calls.length, 1);
  // 版が合わないパート → 失敗（自動更新が再試行する）
  let failed = null;
  const stale = { ...main, parts: [{ id: 'EVT-AAAA1111.P01', version: 'v2', groupId: 'G' }] };
  withParts((req, ok) => ok({ ok: true, version: 'v1', data: body }), {}, 'EVT-AAAA1111', { ok: true, version: 'm3', data: stale }, () => assert.fail('ok'), (e) => (failed = e));
  assert.ok(failed);
});
