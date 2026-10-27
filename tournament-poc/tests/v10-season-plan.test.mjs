// v1.0: 期制リーグの配置計算（04g_season.js の純粋な関数）の単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const p = setupPair();
const fn = (name) => p.admin.fn(name);
const plan = (input) => JSON.parse(JSON.stringify(fn('planSeasonPlacement_')(input)));

/** n 人のディビジョン（順位どおり。tie = [順位, 人数] で同順位を作る） */
function division(index, name, keys, opts = {}) {
  const rows = keys.map((k, i) => ({ key: k, name: k, rank: i + 1, tied: false, withdrawn: null }));
  (opts.ties || []).forEach(([from, size]) => {
    for (let i = from - 1; i < from - 1 + size; i++) Object.assign(rows[i], { rank: from, tied: true });
  });
  return { index, name, complete: opts.complete !== false, progress: { final: 1, total: 1 }, rows };
}

const keys = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + (i + 1));
const cfg = (over = {}) => ({ thresholds: [], targets: [], capacities: [], ...over });

test('ディビジョン数: 主催者が決めた境目の人数だけで決まる（境目がなければ 1）', () => {
  const count = fn('seasonDivisionCount_');
  assert.equal(count(50, []), 1);
  assert.equal(count(11, [12, 24]), 1);
  assert.equal(count(12, [12, 24]), 2);
  assert.equal(count(23, [12, 24]), 2);
  assert.equal(count(24, [12, 24]), 3);
});

test('人数の分け方: 目標人数があればその人数、なければ均等。端数は下の部へ。最下位は残り。足りなければ問題', () => {
  const sizes = (n, d, t) => JSON.parse(JSON.stringify(fn('seasonDivisionSizes_')(n, d, t)));
  assert.deepEqual(sizes(13, 2, []).sizes, [6, 7]);
  assert.deepEqual(sizes(50, 3, []).sizes, [16, 17, 17]);
  assert.deepEqual(sizes(50, 3, [10]).sizes, [10, 20, 20]);
  assert.deepEqual(sizes(50, 3, [10, 12]).sizes, [10, 12, 28]);
  assert.deepEqual(sizes(50, 3, [10, 12, 99]).sizes, [10, 12, 28], '最下位の目標人数は使わない（残り）');
  assert.match(sizes(10, 2, [9]).problems[0], /目標人数の合計/);
});

test('役割: 隣接する A・B で、B の 1 位 自動昇格・2 位 入替戦、A の最下位 自動降格・下から 2 位 入替戦。最上位・最下位の外側には作らない', () => {
  const r = JSON.parse(JSON.stringify(fn('seasonRoles_')([division(1, '1部', keys('a', 5)), division(2, '2部', keys('b', 5)), division(3, '3部', keys('c', 5))])));
  const roleOf = (k) => r.roles[k].role;
  assert.deepEqual(keys('a', 5).map(roleOf), ['stay', 'stay', 'stay', 'playoff_down', 'auto_relegate']);
  assert.deepEqual(keys('b', 5).map(roleOf), ['auto_promote', 'playoff_up', 'stay', 'playoff_down', 'auto_relegate']);
  assert.deepEqual(keys('c', 5).map(roleOf), ['auto_promote', 'playoff_up', 'stay', 'stay', 'stay']);
  assert.deepEqual(r.playoffs.map((x) => [x.upperKey, x.lowerKey]), [['a4', 'b2'], ['b4', 'c2']]);
  assert.deepEqual(r.problems, []);
});

test('人数不足: 中間のディビジョンが 3 人なら、2 位が上下両方の入替戦に当たるので自動で決めない', () => {
  const r = JSON.parse(JSON.stringify(fn('seasonRoles_')([division(1, '1部', keys('a', 4)), division(2, '2部', keys('b', 3)), division(3, '3部', keys('c', 4))])));
  assert.match(r.problems.join(), /2部 は 3 人のため、昇格・降格・入替戦の対象が重なります/);
  assert.ok(keys('b', 3).every((k) => r.roles[k].role === 'conflict'));
  assert.deepEqual(r.playoffs, [], '重なる組の入替戦は作らない');
  const pl = plan({ seasonNo: 2, config: cfg(), divisions: [division(1, '1部', keys('a', 4)), division(2, '2部', keys('b', 3)), division(3, '3部', keys('c', 4))], playoffs: [], edits: {} });
  assert.ok(pl.problems.some((x) => /b2 の次期の所属を手動で決めてください/.test(x)));
});

test('同順位: 役割が分かれる塊は問題（1 位と 2 位が並ぶ・最下位と下から 2 位が並ぶ）。役割が同じ塊は問題にしない', () => {
  const roles = (div) => JSON.parse(JSON.stringify(fn('seasonRoles_')(div)));
  assert.match(roles([division(1, '1部', keys('a', 5)), division(2, '2部', keys('b', 5), { ties: [[1, 2]] })]).problems.join(), /2部 の 1位が同順位/);
  assert.match(roles([division(1, '1部', keys('a', 5), { ties: [[4, 2]] }), division(2, '2部', keys('b', 5))]).problems.join(), /1部 の 4位が同順位/);
  assert.deepEqual(roles([division(1, '1部', keys('a', 6), { ties: [[1, 3]] }), division(2, '2部', keys('b', 5))]).problems, [], '1部 の 1〜3 位は全員残留');
});

test('配置: 1 期目（1 ディビジョン）は順位の梯子を目標人数で区切る。境目の同順位は問題、境目でない同順位は問題にしない', () => {
  const base = { seasonNo: 1, config: cfg({ thresholds: [6] }), playoffs: [], edits: {} };
  let pl = plan({ ...base, divisions: [division(1, 'リーグ', keys('p', 8))] });
  assert.equal(pl.divisionCount, 2);
  assert.deepEqual(pl.divisions.map((d) => d.members), [keys('p', 8).slice(0, 4), keys('p', 8).slice(4)]);
  assert.match(pl.rows[0].reasons[0], /1期目 1位のため 1部（1〜4位が 1部）/);
  pl = plan({ ...base, divisions: [division(1, 'リーグ', keys('p', 8), { ties: [[4, 2]] })] });
  assert.match(pl.problems.join(), /4位の同順位が、次期の 1部 と 2部 の境目にかかります/);
  pl = plan({ ...base, divisions: [division(1, 'リーグ', keys('p', 8), { ties: [[1, 3]] })] });
  assert.deepEqual(pl.problems, []);
});

test('配置: 入替戦の結果で梯子を作る。降りてきた選手は下の部の先頭、上がってきた選手は上の部の最後', () => {
  const divisions = [division(1, '1部', keys('a', 4)), division(2, '2部', keys('b', 4))];
  const lowerWins = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs: [{ upper: 1, lower: 2, upperKey: 'a3', lowerKey: 'b2', state: 'final', winnerKey: 'b2' }], edits: {} });
  assert.deepEqual(lowerWins.problems, []);
  assert.deepEqual(lowerWins.divisions.map((d) => d.members), [['a1', 'a2', 'b1', 'b2'], ['a3', 'a4', 'b3', 'b4']]);
  const upperWins = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs: [{ upper: 1, lower: 2, upperKey: 'a3', lowerKey: 'b2', state: 'final', winnerKey: 'a3' }], edits: {} });
  assert.deepEqual(upperWins.divisions.map((d) => d.members), [['a1', 'a2', 'a3', 'b1'], ['a4', 'b2', 'b3', 'b4']]);
  // 対戦者の不一致・未確定・未実施
  const mismatch = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs: [{ upper: 1, lower: 2, upperKey: 'a2', lowerKey: 'b2', state: 'final', winnerKey: 'b2' }], edits: {} });
  assert.match(mismatch.problems.join(), /対戦者が今の順位と合いません/);
  const live = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs: [{ upper: 1, lower: 2, upperKey: 'a3', lowerKey: 'b2', state: 'live', winnerKey: '' }], edits: {} });
  assert.match(live.problems.join(), /結果が確定していません/);
  // 入替戦を行わない場合は、対象の 2 人を手動で決めれば確定できる
  const skip = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs: [], edits: { moves: { a3: { division: 1, reason: '入替戦なし（会場の都合）' }, b2: { division: 2, reason: '入替戦なし（会場の都合）' } } } });
  assert.deepEqual(skip.problems, []);
  assert.deepEqual(skip.rows.find((r) => r.key === 'a3').reasons.slice(-1), ['手動で 1部（入替戦なし（会場の都合））']);
});

test('配置: 定員の超過・最少人数の不足・範囲外の手動の所属は問題。新規参加は最下位', () => {
  const divisions = [division(1, '1部', keys('a', 4)), division(2, '2部', keys('b', 4))];
  const playoffs = [{ upper: 1, lower: 2, upperKey: 'a3', lowerKey: 'b2', state: 'final', winnerKey: 'a3' }];
  let pl = plan({ seasonNo: 2, config: cfg({ thresholds: [8], capacities: [4, 4] }), divisions, playoffs, edits: { join: [{ key: 'new:1', name: '新人' }] } });
  assert.deepEqual(pl.divisions.map((d) => d.size), [4, 5]);
  assert.match(pl.problems.join(), /2部 は 5 人で、定員（4 人）を超えています/);
  assert.equal(pl.rows.find((r) => r.key === 'new:1').newDivision, 2);
  pl = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs, edits: { moves: { a1: { division: 3, reason: 'x' } } } });
  assert.match(pl.problems.join(), /範囲にありません/);
  pl = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs, edits: { moves: { a1: { division: 2, reason: 'x' }, a2: { division: 2, reason: 'x' }, b1: { division: 2, reason: 'x' } } } });
  assert.match(pl.problems.join(), /次期の 1部 は 1 人です/);
});

test('配置の根拠: 名前を変えても変わらず、順位・入替戦の結果が変わると変わる', () => {
  const basis = (divs, pf) => JSON.stringify(fn('seasonBasis_')(divs, pf));
  const a = [division(1, '1部', keys('a', 4))];
  const renamed = JSON.parse(JSON.stringify(a));
  renamed[0].rows[0].name = '別の名前';
  assert.equal(basis(a, []), basis(renamed, []));
  const swapped = JSON.parse(JSON.stringify(a));
  [swapped[0].rows[0].key, swapped[0].rows[1].key] = [swapped[0].rows[1].key, swapped[0].rows[0].key];
  assert.notEqual(basis(a, []), basis(swapped, []));
  assert.notEqual(basis(a, [{ upper: 1, upperKey: 'x', lowerKey: 'y', state: 'final', winnerKey: 'x' }]), basis(a, [{ upper: 1, upperKey: 'x', lowerKey: 'y', state: 'final', winnerKey: 'y' }]));
});

/* ---------- 欠員の補充（ディビジョン数が前期と同じとき） ---------- */

const leaveOf = (pl) => Object.fromEntries(pl.rows.filter((r) => r.movement !== 'leave').map((r) => [r.key, r.newDivision]));
const upperWins = (upper, upperKey, lowerKey) => ({ upper, lower: upper + 1, upperKey, lowerKey, state: 'final', winnerKey: upperKey });

test('欠員: 上の部の欠員は、下の部に残った選手の順位の順（入替戦に負けた 2 位 → 3 位 …）で繰り上げる。自動降格・自動昇格は人数の調整で取り消さない', () => {
  const divisions = [division(1, '1部', keys('a', 6)), division(2, '2部', keys('b', 6))];
  const playoffs = [upperWins(1, 'a5', 'b2')];
  const base = { seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs };
  // 欠員なし: 前期と同じ 6・6
  let pl = plan({ ...base, edits: {} });
  assert.deepEqual(pl.problems, []);
  assert.deepEqual(pl.divisions.map((d) => d.members), [['a1', 'a2', 'a3', 'a4', 'a5', 'b1'], ['a6', 'b2', 'b3', 'b4', 'b5', 'b6']]);
  // 1 部から 1 人抜ける → 2 部 2 位（入替戦の敗者）が繰り上がる。a6 は降格のまま
  pl = plan({ ...base, edits: { leave: ['a3'] } });
  let at = leaveOf(pl);
  assert.equal(at.b2, 1);
  assert.equal(at.a6, 2);
  assert.deepEqual(pl.divisions.map((d) => d.size), [6, 5]);
  assert.match(pl.rows.find((r) => r.key === 'b2').reasons.join(), /欠員の補充（1部 は前期と同じ 6 人）のため 1部 へ繰り上げ/);
  // 1 部から 3 人抜ける → b2・b3・b4
  pl = plan({ ...base, edits: { leave: ['a1', 'a2', 'a3'] } });
  at = leaveOf(pl);
  assert.deepEqual(['b2', 'b3', 'b4', 'b5', 'a6'].map((k) => at[k]), [1, 1, 1, 2, 2]);
  // 2 部から抜けても、1 部の人数（と自動昇格の b1）は変わらない
  pl = plan({ ...base, edits: { leave: ['b4'] } });
  at = leaveOf(pl);
  assert.equal(at.b1, 1);
  assert.deepEqual(pl.divisions.map((d) => d.size), [6, 5]);
  assert.deepEqual(pl.problems, []);
  // 新規参加は最下位（欠員の補充には使わない。下の部の選手が先）
  pl = plan({ ...base, edits: { leave: ['a3'], join: [{ key: 'new:1', name: '新人' }] } });
  at = leaveOf(pl);
  assert.equal(at.b2, 1);
  assert.equal(at['new:1'], 2);
});

test('欠員: 3 部制では上から順に補充する（1 部の欠員を 2 部の次点で埋め、2 部の欠員を 3 部の次点で埋める）', () => {
  const divisions = [division(1, '1部', keys('a', 5)), division(2, '2部', keys('b', 5)), division(3, '3部', keys('c', 5))];
  const playoffs = [upperWins(1, 'a4', 'b2'), upperWins(2, 'b4', 'c2')];
  const pl = plan({ seasonNo: 2, config: cfg({ thresholds: [6, 12] }), divisions, playoffs, edits: { leave: ['a1'] } });
  assert.deepEqual(pl.problems, []);
  const at = leaveOf(pl);
  // 1 部: a2 a3 a4 + 自動昇格 b1 + 欠員の補充 b2（入替戦の敗者で 2 部に残った選手の最上位）
  assert.deepEqual(pl.divisions.map((d) => d.members), [['a2', 'a3', 'a4', 'b1', 'b2'], ['a5', 'b3', 'b4', 'c1', 'c2'], ['b5', 'c3', 'c4', 'c5']]);
  assert.equal(at.a5, 2, '自動降格はそのまま');
  assert.equal(at.c2, 2, '2 部の欠員は 3 部に残った選手の最上位（c2）で埋める');
  assert.equal(at.b5, 3);
});

test('欠員: 繰り上げの対象が同順位の塊の途中で切れるときは問題（名前順で決めない）。目標人数を減らしたときは残留した選手の下位から下げる', () => {
  const divisions = [division(1, '1部', keys('a', 6)), division(2, '2部', keys('b', 6), { ties: [[3, 2]] })];
  const playoffs = [upperWins(1, 'a5', 'b2')];
  let pl = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs, edits: { leave: ['a1', 'a2'] } });
  assert.match(pl.problems.join(), /2部 の 3位の同順位が、1部 への繰り上げの対象にかかります/);
  pl = plan({ seasonNo: 2, config: cfg({ thresholds: [8] }), divisions, playoffs, edits: { leave: ['a1', 'a2', 'a3'] } });
  assert.deepEqual(pl.problems, [], '同順位の 2 人とも繰り上がるなら問題にしない');
  // 目標人数を 5 にすると、1 部に残留した選手の最下位（入替戦に勝った a5）が下がる。自動昇格の b1 は下げない
  pl = plan({ seasonNo: 2, config: cfg({ thresholds: [8], targets: [5] }), divisions: [division(1, '1部', keys('a', 6)), division(2, '2部', keys('b', 6))], playoffs, edits: {} });
  const at = leaveOf(pl);
  assert.equal(at.b1, 1);
  assert.equal(at.a5, 2);
  assert.match(pl.rows.find((r) => r.key === 'a5').reasons.join(), /人数調整（1部 は目標人数 5 人）のため 2部 へ繰り下げ/);
});
