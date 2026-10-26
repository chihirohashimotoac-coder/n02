// v0.8: 公開データ（閲覧ページの JSON）に入る項目は許可した項目だけ。全形式で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

// 公開データに出てよい項目（v0.7 の項目 + v0.8 で足した項目）。項目を足すときはここも更新する
const ALLOWED = new Set([
  // v0.7
  'advanced', 'bestOf', 'champion', 'check', 'complete', 'cycles', 'dataUpdatedAt', 'dateLabel', 'entrants', 'event', 'final', 'format', 'groups',
  'id', 'label', 'legs', 'legsAgainst', 'legsFor', 'legsToWin', 'live', 'lost', 'matches', 'name', 'order', 'p1', 'p2', 'pending', 'played', 'playerCount',
  'playerId', 'players', 'progress', 'provisional', 'rank', 'round', 'roundBestOf', 'rounds', 'rule', 'scheduled', 'schema', 'seed', 'setBestOf',
  'sets', 'setsAgainst', 'setsFor', 'setsToWin', 'source', 'stage', 'stages', 'standings', 'status', 'summary', 'thirdPlace', 'tiebreakers',
  'tied', 'total', 'type', 'winnerId', 'won',
  // v0.8
  'drawn', 'timezone', 'announcement', 'text', 'updatedAt', 'ruleDisplay', 'category', 'startScore', 'inMode', 'outMode', 'bull', 'roundLimit', 'note',
  'points', 'win', 'draw', 'loss', 'adjustment', 'buchholz', 'byes', 'swiss', 'generated', 'roundsPlayed', 'drawMode', 'fixedRounds', 'startRound', 'direct',
  'grandFinal', 'sides', 'side', 'runnerUp', 'planned', 'nightPoints', 'nights', 'participants', 'results', 'place', 'provisionalPoints', 'nightWins', 'roster',
  'nightsComplete', 'schedule', 'date', 'time', 'venue', 'board', 'referee', 'original', 'resultType', 'fixedLegs', 'affiliation', 'rating',
]);
// 公開データに出てはいけない項目（運営画面だけのもの）
const FORBIDDEN = ['rev', 'notes', 'storedStatus', 'resultNote', 'reason', 'changedBy', 'changedAt', 'ownerEmail', 'config', 'completion', 'log', 'cancelReason', 'email', 'collaborators', 'history', 'snapshotBudget', 'problems', 'withdrawn', 'role'];

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

function publish(p, id) {
  const ev = p.ok('eventDetail', { eventId: id }).event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '運営メモ' });
  p.clock.advance(21000);
  return p.viewer.run('getPublicSnapshot', { eventId: id }).data;
}

function keysOf(data) {
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (keys.add(k), walk(x)));
  };
  walk(data);
  return keys;
}

function firstPlayable(st) {
  const all = st.groups ? st.groups.flatMap((g) => g.matches) : st.sides ? st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches)) : st.nights ? st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches)) : st.rounds.flatMap((r) => r.matches);
  return all.filter((m) => m.status === 'scheduled');
}

test('全形式の公開データに、許可した項目以外・運営画面だけの項目が入らない', () => {
  const p = ready();
  const names = Array.from({ length: 8 }, (_, i) => '選手' + (i + 1));
  const built = {};
  for (const template of ['robin_ko', 'elimination', 'robin_ab', 'double_elimination', 'robin', 'league', 'league_playoff', 'multi_robin_ko', 'series_playoff', 'swiss']) {
    const id = p.ok('createEvent', { name: template, template, groupCount: 2, advanceCount: 2, groupCount2: 1, advanceCount2: 2, nights: 2, playoff: 4, swissRounds: 2, rule: { format: 'legs', bestOf: 3 } }).eventId;
    p.ok('importPlayers', { eventId: id, players: names.map((n, i) => ({ name: n, affiliation: '所属' + (i % 2), rating: String(10 + i) })) });
    let d = p.ok('eventDetail', { eventId: id });
    const st = d.stages[0];
    const ev = d.event;
    p.ok('updateEventSettings', { eventId: id, rev: ev.rev, announcement: 'お知らせ', ruleDisplay: { category: 'soft', startScore: 501, outMode: 'open', bull: 'fat', roundLimit: 15, note: '' } });
    if (st.type === 'single_elimination' || st.type === 'double_elimination') {
      p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
      p.ok('generateBracket', { eventId: id, stageId: st.id });
    } else if (st.type === 'swiss') {
      p.ok('autoAssign', { eventId: id, stageId: st.id });
      p.ok('generateSwissRound', { eventId: id, stageId: st.id });
    } else if (st.type === 'series') {
      p.ok('autoAssign', { eventId: id, stageId: st.id });
      p.ok('generateNight', { eventId: id, groupId: st.nights[0].id });
    } else {
      p.ok('autoAssign', { eventId: id, stageId: st.id, method: 'random' });
      p.ok('generateMatches', { eventId: id, stageId: st.id });
    }
    d = p.ok('eventDetail', { eventId: id });
    const [m1, m2] = firstPlayable(d.stages[0]);
    p.ok('saveMatchResult', { matchId: m1.id, rev: m1.rev, status: 'final', resultType: 'walkover', winnerSide: 1, note: '欠席（理由は非公開）' });
    p.ok('setSchedule', { matchId: m2.id, rev: m2.rev, date: '2026-11-03', time: '19:00', venue: '本店', board: '1', referee: '審判' });
    const m2b = firstPlayable(p.ok('eventDetail', { eventId: id }).stages[0]).find((m) => m.id === m2.id);
    p.ok('postponeMatch', { matchId: m2.id, rev: m2b.rev, reason: '非公開の延期理由' });
    const data = publish(p, id);
    built[template] = data;
    const extra = [...keysOf(data)].filter((k) => !ALLOWED.has(k));
    assert.deepEqual(extra, [], template + ': 公開データに想定外の項目');
    FORBIDDEN.forEach((k) => assert.ok(!keysOf(data).has(k), template + ': ' + k));
    const text = JSON.stringify(data);
    assert.ok(!text.includes('運営メモ') && !text.includes('非公開') && !text.includes('@'), template + ': 非公開の文字列');
    assert.equal(data.event.format, template);
    // 所属・Rt は公開の設定にしない限り出ない
    assert.ok(!text.includes('所属0'), template + ': 所属');
  }
  assert.ok(built.double_elimination.stages[0].sides);
  assert.ok(built.series_playoff.stages[0].nights);
  assert.ok(built.swiss.stages[0].swiss);
});
