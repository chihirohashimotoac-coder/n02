// 大会ロジック（Best of N の判定・総当たり表・入力検証）の単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject, ROOT } from './gas-mock.mjs';

const admin = loadProject('admin');
const evaluate = admin.fn('evaluateResult_');
const pairings = admin.fn('roundRobinPairings_');
const cleanText = admin.fn('cleanText_');
const parseInt0 = admin.fn('parseNonNegativeInt_');

/** Best of 5 の正解表（独立に書き下したもの） */
function expectedBo5(status, a, b) {
  if (a > 3 || b > 3) return false;
  if (status === 'scheduled') return a === 0 && b === 0;
  if (status === 'live') return a < 3 && b < 3;
  if (status === 'final') return (a === 3) !== (b === 3);
  return false;
}

test('Best of 5: 全組み合わせ（0〜4 Leg × 3 状態）で成立条件どおりに判定する', () => {
  for (const status of ['scheduled', 'live', 'final']) {
    for (let a = 0; a <= 4; a++) {
      for (let b = 0; b <= 4; b++) {
        const r = evaluate(status, a, b, 5);
        assert.equal(r.ok, expectedBo5(status, a, b), `${status} ${a}-${b}`);
        if (r.ok && status === 'final') assert.equal(r.winnerSide, a === 3 ? 1 : 2);
        if (!r.ok || status !== 'final') assert.equal(r.winnerSide, 0, `勝者は確定時のみ: ${status} ${a}-${b}`);
      }
    }
  }
});

test('確定できるのは 3-0 / 3-1 / 3-2 / 0-3 / 1-3 / 2-3 の 6 通りだけ', () => {
  const ok = [];
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) if (evaluate('final', a, b, 5).ok) ok.push(`${a}-${b}`);
  assert.deepEqual(ok.sort(), ['0-3', '1-3', '2-3', '3-0', '3-1', '3-2']);
});

test('Best of 1 / 3 / 7 でも勝利数 = floor(N/2)+1 で判定する', () => {
  assert.equal(evaluate('final', 1, 0, 1).ok, true);
  assert.equal(evaluate('live', 1, 0, 1).ok, false);
  assert.equal(evaluate('final', 2, 1, 3).ok, true);
  assert.equal(evaluate('final', 3, 3, 7).ok, false);
  assert.equal(evaluate('final', 4, 3, 7).ok, true);
  assert.equal(evaluate('live', 3, 3, 7).ok, true);
});

test('不正な値（負数・小数・NaN・不明な状態・偶数の Best of）は確定させない', () => {
  assert.equal(evaluate('final', -1, 3, 5).ok, false);
  assert.equal(evaluate('final', 3, 1.5, 5).ok, false);
  assert.equal(evaluate('final', 3, NaN, 5).ok, false);
  assert.equal(evaluate('final', 3, null, 5).ok, false);
  assert.equal(evaluate('done', 3, 0, 5).ok, false);
  assert.equal(evaluate('final', 3, 0, 4).ok, false);
  assert.equal(evaluate('final', 3, 0, null).ok, false);
});

test('総当たり表: 4 人なら 3 ラウンド・6 試合、全組み合わせが 1 回ずつ、各ラウンドで各選手 1 試合', () => {
  const list = pairings(['a', 'b', 'c', 'd']);
  assert.equal(list.length, 6);
  const keys = list.map((m) => [m.p1, m.p2].sort().join(''));
  assert.deepEqual([...new Set(keys)].sort(), ['ab', 'ac', 'ad', 'bc', 'bd', 'cd']);
  for (let round = 1; round <= 3; round++) {
    const ps = list.filter((m) => m.round === round).flatMap((m) => [m.p1, m.p2]);
    assert.equal(new Set(ps).size, 4, `round ${round}`);
  }
  assert.deepEqual(Array.from(list, (m) => m.order), [1, 2, 3, 4, 5, 6]);
});

test('総当たり表: 奇数（5 人）は 5 ラウンド・10 試合で各ラウンド 1 人休み', () => {
  const list = pairings(['a', 'b', 'c', 'd', 'e']);
  assert.equal(list.length, 10);
  assert.equal(new Set(list.map((m) => [m.p1, m.p2].sort().join(''))).size, 10);
  assert.equal(Math.max(...list.map((m) => m.round)), 5);
  assert.equal(pairings(['a']).length, 0);
  assert.equal(pairings([]).length, 0);
});

test('入力文字列: 数式として解釈されうる先頭文字・制御文字・長すぎる入力を拒否する', () => {
  for (const bad of ['=IMPORTXML("http://x","//a")', '+1', '-1', '@foo']) {
    assert.throws(() => cleanText(bad, '選手名', 40), (e) => e.appCode === 'VALIDATION', bad);
  }
  assert.throws(() => cleanText('a\u0000b', '選手名', 40), (e) => e.appCode === 'VALIDATION');
  assert.throws(() => cleanText('x'.repeat(41), '選手名', 40), (e) => e.appCode === 'VALIDATION');
  assert.throws(() => cleanText('   ', '選手名', 40), (e) => e.appCode === 'VALIDATION');
  assert.throws(() => cleanText({}, '選手名', 40), (e) => e.appCode === 'VALIDATION');
  assert.equal(cleanText('  山田　 太郎 ', '選手名', 40), '山田 太郎');
  assert.equal(cleanText('', 'メモ', 40, { allowEmpty: true }), '');
  // HTML はサーバーではそのまま保存し、画面側で必ず文字列として表示する（e2e で確認）
  assert.equal(cleanText('<b>x</b>', '選手名', 40), '<b>x</b>');
});

test('Leg 数の入力: 全角数字を受け付け、整数以外は null', () => {
  assert.equal(parseInt0('３'), 3);
  assert.equal(parseInt0(' 2 '), 2);
  assert.equal(parseInt0(0), 0);
  for (const bad of ['', '1.5', '-1', 'a', '1e2', -1, 1.5, NaN, null, undefined, '1000']) assert.equal(parseInt0(bad), null, String(bad));
});

test('運営画面のクライアント側チェックはサーバーの判定と一致する（Best of 1〜9 の全組み合わせ）', () => {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(ROOT, 'admin/src/client/admin.js'), 'utf8'), ctx);
  const check = ctx.TPAdmin.checkResult;
  for (const bestOf of [1, 3, 5, 7, 9]) {
    for (const status of ['scheduled', 'live', 'final']) {
      for (let a = 0; a <= 6; a++) {
        for (let b = 0; b <= 6; b++) {
          assert.equal(check(status, String(a), String(b), bestOf) === '', evaluate(status, a, b, bestOf).ok, `Bo${bestOf} ${status} ${a}-${b}`);
        }
      }
    }
  }
});
