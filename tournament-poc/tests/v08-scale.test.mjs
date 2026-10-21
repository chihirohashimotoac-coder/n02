// v0.8: 1 大会の上限（選手 128 名）の規模で、作成 → 組み合わせ → 結果 → 公開データが上限内に収まることを確かめる（模擬環境）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}

const people = (n) => Array.from({ length: n }, (_, i) => ({ name: '選手' + String(i + 1).padStart(3, '0'), affiliation: '所属' + (i % 9), rating: String(100 - (i % 50)) }));

function matchesOf(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  return st.rounds.flatMap((r) => r.matches);
}

/** 入力できる試合をまとめて確定する（1 回の操作で最大 limit 試合。名前の番号が小さい方が勝つ） */
function playAll(p, id, stageIndex) {
  let total = 0;
  for (let guard = 0; guard < 400; guard++) {
    const st = p.ok('eventDetail', { eventId: id }).stages[stageIndex];
    const open = matchesOf(st).filter((m) => m.status === 'scheduled' && m.p1.id && m.p2.id);
    if (!open.length) return total;
    const results = open.slice(0, 50).map((m) => {
      const need = Math.floor(m.bestOf / 2) + 1;
      const p1 = m.p1.name < m.p2.name;
      return { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1 ? need : 0, p2Legs: p1 ? 0 : need };
    });
    p.ok('saveMatchResults', { eventId: id, results });
    total += results.length;
  }
  throw new Error('終わらない');
}

function snapshotChars(p, id) {
  const ev = p.ok('eventDetail', { eventId: id }).event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' });
  p.clock.advance(21000);
  const r = p.viewer.run('getPublicSnapshot', { eventId: id });
  assert.equal(r.ok, true);
  return JSON.stringify(r.data).length;
}

test('128 名のトーナメント（3 位決定戦あり）: 128 試合を作り、最後まで進めて優勝者が決まる。公開データは上限内', () => {
  const p = ready();
  const t0 = Date.now();
  const id = p.ok('createEvent', { name: '128 名', template: 'elimination', thirdPlace: true, rule: { format: 'legs', bestOf: 3 } }).eventId;
  assert.equal(p.ok('importPlayers', { eventId: id, players: people(128) }).added, 128);
  let d = p.ok('eventDetail', { eventId: id });
  p.ok('setEntrants', { eventId: id, stageId: d.stages[0].id, playerIds: d.players.map((x) => x.id) });
  assert.equal(p.ok('generateBracket', { eventId: id, stageId: d.stages[0].id }).created, 128);
  assert.equal(playAll(p, id, 0), 128);
  d = p.ok('eventDetail', { eventId: id });
  assert.equal(d.stages[0].champion.name, '選手001');
  assert.equal(d.event.status, 'finished', '自動終了');
  const chars = snapshotChars(p, id);
  assert.ok(chars < 400000, `公開データ ${chars} 文字`);
  // 上限を超える 129 名目は登録しない
  assert.equal(p.call('importPlayers', { eventId: id, players: [{ name: '129 人目' }] }).error.code, 'VALIDATION');
  console.log(`# 128 名トーナメント: 公開データ ${chars} 文字・${Date.now() - t0} ms（模擬環境）`);
});

test('128 名の予選ロビン（16 組 × 8 名 = 448 試合）→ 決勝 32 名: 公開データは上限内で、進出まで進められる', () => {
  const p = ready();
  const t0 = Date.now();
  const id = p.ok('createEvent', { name: '128 名ロビン', template: 'robin_ko', groupCount: 16, advanceCount: 2, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: id, players: people(128) });
  let d = p.ok('eventDetail', { eventId: id });
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id, method: 'balanced', useSeeds: true, useRating: true, spreadAffiliation: true });
  assert.equal(p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id }).created, 448);
  assert.equal(playAll(p, id, 0), 448);
  d = p.ok('confirmAdvancement', { eventId: id, stageId: d.stages[0].id }).detail;
  assert.equal(d.stages[1].entries.length, 32);
  assert.equal(p.ok('generateBracket', { eventId: id, stageId: d.stages[1].id }).created, 31);
  const chars = snapshotChars(p, id);
  assert.ok(chars < 400000, `公開データ ${chars} 文字`);
  console.log(`# 128 名ロビン→決勝: 公開データ ${chars} 文字・${Date.now() - t0} ms（模擬環境）`);
});

test('64 名のダブルエリミネーションと 128 名のスイス式 7 回戦: 組み合わせを作れる', () => {
  const p = ready();
  const de = p.ok('createEvent', { name: 'DE 64', template: 'double_elimination', rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: de, players: people(64) });
  let d = p.ok('eventDetail', { eventId: de });
  p.ok('setEntrants', { eventId: de, stageId: d.stages[0].id, playerIds: d.players.map((x) => x.id) });
  p.ok('generateBracket', { eventId: de, stageId: d.stages[0].id });
  const played = playAll(p, de, 0);
  assert.ok(played === 126 || played === 127, `${played} 試合（2N-2 または リセットで 2N-1）`);
  assert.equal(p.ok('eventDetail', { eventId: de }).stages[0].champion.name, '選手001');
  const t0 = Date.now();
  const sw = p.ok('createEvent', { name: 'スイス 128', template: 'swiss', swissRounds: 7, playoff: 0, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('importPlayers', { eventId: sw, players: people(128) });
  d = p.ok('eventDetail', { eventId: sw });
  p.ok('autoAssign', { eventId: sw, stageId: d.stages[0].id });
  for (let r = 1; r <= 7; r++) {
    const res = p.ok('generateSwissRound', { eventId: sw, stageId: d.stages[0].id });
    assert.equal(res.created, 64);
    assert.deepEqual(res.rematches, [], `第${r}回戦に再戦なし`);
    playAll(p, sw, 0);
  }
  const chars = snapshotChars(p, sw);
  assert.ok(chars < 400000, `公開データ ${chars} 文字`);
  console.log(`# 128 名スイス 7 回戦: 公開データ ${chars} 文字・${Date.now() - t0} ms（模擬環境）`);
});
