// 監査 PR-18（W-007）: スイス式の見積もり。再戦なし・不戦（Bye）を同じ人に 2 回与えずに組める回戦数の上限は、
// 奇数の人数は n 回戦、偶数は n − 1 回戦。不戦は試合数と分けて示す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject, setupPair } from './gas-mock.mjs';

const admin = loadProject('admin');
const est = (params) => JSON.parse(JSON.stringify(admin.fn('estimateFormat_')('swiss', params)));

test('5 人 5 回戦・3 人 3 回戦・7 人 7 回戦（奇数の上限）は問題なし。不戦は試合数に含めず回数を別に示す', () => {
  const e = est({ players: 5, swissRounds: 5 });
  assert.deepEqual(e.problems, []);
  assert.deepEqual(e.notes, []);
  assert.equal(e.stages[0].matches, 10, '5 回戦 × 2 試合（不戦を含めない）');
  assert.equal(e.stages[0].byes, 5);
  assert.equal(e.total, 10);
  assert.match(e.stages[0].note, /不戦（Bye）は毎回戦 1 人で計 5 回（試合数に含めません）/);
  assert.deepEqual(est({ players: 3, swissRounds: 3 }).problems, []);
  assert.deepEqual(est({ players: 7, swissRounds: 7 }).problems, []);
});

test('4 人 3 回戦（偶数の上限）は問題なし・注意なし。偶数は不戦がない', () => {
  const e = est({ players: 4, swissRounds: 3 });
  assert.deepEqual(e.problems, []);
  assert.deepEqual(e.notes, []);
  assert.equal(e.stages[0].matches, 6);
  assert.equal(e.stages[0].byes, undefined);
  assert.doesNotMatch(e.stages[0].note, /不戦/);
});

test('5 人 6 回戦は奇数の上限（5 回戦）と理由を説明。4 人 4 回戦・6 人 6 回戦は偶数の上限を説明', () => {
  const odd = est({ players: 5, swissRounds: 6 }).problems.join();
  assert.match(odd, /回戦数（6）が多すぎます。5 人では 5 回戦まで/);
  assert.match(odd, /2 回目の不戦（Bye）/);
  assert.match(est({ players: 4, swissRounds: 4 }).problems.join(), /4 人では 3 回戦までしか全員が再戦なしで組めません/);
  assert.match(est({ players: 6, swissRounds: 6 }).problems.join(), /5 回戦まで/);
});

test('6 人 5 回戦（偶数の上限で 6 人以上）は、最後の回戦を再戦なしで組めないことがあると注意する', () => {
  const e = est({ players: 6, swissRounds: 5 });
  assert.deepEqual(e.problems, []);
  assert.match(e.notes.join(), /再戦なしで組めないことがあります/);
});

/** 実際の組み合わせ処理で、見積もりの「問題なし」が条件を緩めずに組めることを確かめる（結果は種つきの乱数） */
function relaxedRuns(n, rounds, runs) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let relaxed = 0;
  for (let t = 0; t < runs; t++) {
    const p = setupPair();
    p.ok('initializeStorage');
    const id = p.ok('createEvent', { name: 's', template: 'swiss', swissRounds: rounds, playoff: 0, rule: { format: 'legs', bestOf: 3 } }).eventId;
    p.ok('addPlayers', { eventId: id, names: Array.from({ length: n }, (_, i) => `選手${i + 1}`) });
    const st = p.ok('eventDetail', { eventId: id }).stages[0];
    p.ok('autoAssign', { eventId: id, stageId: st.id });
    let any = false;
    for (let r = 1; r <= rounds; r++) {
      if (p.ok('generateSwissRound', { eventId: id, stageId: st.id }).relaxed.length) any = true;
      for (;;) {
        const m = p.ok('eventDetail', { eventId: id }).stages[0].groups[0].matches.find((x) => x.status === 'scheduled');
        if (!m) break;
        const w = rnd() < 0.5;
        p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: w ? 2 : 1, p2Legs: w ? 1 : 2 });
      }
    }
    if (any) relaxed++;
  }
  return relaxed;
}

test('実際の組み合わせ: 5 人 5 回戦・4 人 3 回戦は条件を緩めずに組め、5 人 6 回戦・4 人 4 回戦は必ず緩める', () => {
  assert.equal(relaxedRuns(5, 5, 10), 0);
  assert.equal(relaxedRuns(4, 3, 10), 0);
  assert.equal(relaxedRuns(5, 6, 3), 3);
  assert.equal(relaxedRuns(4, 4, 3), 3);
});
