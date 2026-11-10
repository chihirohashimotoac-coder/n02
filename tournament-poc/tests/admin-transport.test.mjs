// 監査 PR-05（W-001 / C-047）の運営画面側: 通信の期限と、書き込みの結果を「保存済み・保存されなかった・確認できない」に分けること。
// 送り直しは同じ requestId で行い、結果が分からないものを別の操作として実行し直さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { ROOT, setupPair, ADMIN_KEY } from './gas-mock.mjs';

const ctx = vm.createContext({ crypto: webcrypto, setTimeout, clearTimeout, Promise, Uint8Array });
vm.runInContext(readFileSync(join(ROOT, 'admin/src/client/admin.js'), 'utf8'), ctx);
const { createApi, createFetchRunner, resolveTimeouts } = ctx.TPAdmin;
const noWait = () => Promise.resolve();
const T = { query: 1000, mutate: 1000, long: 3000 };

/** 呼ばれるたびに次の振る舞いをする偽の通信。'network' / 'timeout' / { ok, data } / { error } */
function scripted(steps) {
  const calls = [];
  const runner = (request, ok, fail) => {
    calls.push({ ...request });
    const s = steps.shift();
    if (s === 'network') return fail(new Error('Failed to fetch'));
    if (s === 'timeout') return fail({ timeout: true });
    if (s && s.error) return ok({ ok: false, error: s.error });
    return ok({ ok: true, data: s ? s.data : {} });
  };
  return { runner, calls };
}

test('期限: 既定は読み込み 45 秒・保存 45 秒・復元など 120 秒。config.timeouts で変えられ、1 秒未満は無視する', () => {
  assert.deepEqual({ ...resolveTimeouts({}) }, { query: 45000, mutate: 45000, long: 120000 });
  assert.deepEqual({ ...resolveTimeouts({ timeouts: { query: 3000, mutate: 500 } }) }, { query: 3000, mutate: 45000, long: 120000 });
  const s = scripted([{ data: {} }, { data: {} }, { data: {} }]);
  const api = createApi(s.runner, { timeouts: T, wait: noWait });
  return Promise.all([api.query('eventDetail', {}), api.mutate('saveMatchResult', {}), api.mutate('restoreEvent', {})]).then(() => {
    assert.deepEqual(s.calls.map((c) => c.timeoutMs), [1000, 1000, 3000]);
  });
});

test('保存済み: 1 回で成功すれば、そのまま返す（送り直さない）', async () => {
  const s = scripted([{ data: { eventId: 'EVT-AAAA' } }]);
  const data = await createApi(s.runner, { timeouts: T, wait: noWait }).mutate('updateEvent', { x: 1 });
  assert.equal(data.eventId, 'EVT-AAAA');
  assert.equal(data.recovered, undefined);
  assert.equal(s.calls.length, 1);
});

test('保存されなかった: サーバーが理由を返したら送り直さずにそのエラー（確認不能にしない）', async () => {
  const s = scripted([{ error: { code: 'VALIDATION', message: '名前を入力してください。' } }]);
  await assert.rejects(createApi(s.runner, { timeouts: T, wait: noWait }).mutate('updateEvent', {}), (e) => e.code === 'VALIDATION');
  assert.equal(s.calls.length, 1);
});

test('BUSY（サーバーが実行しなかった）は 2 回まで同じ requestId で送り直す', async () => {
  const s = scripted([{ error: { code: 'BUSY' } }, { error: { code: 'BUSY' } }, { data: { ok: 1 } }]);
  const data = await createApi(s.runner, { timeouts: T, wait: noWait }).mutate('saveMatchResult', {});
  assert.equal(data.ok, 1);
  assert.equal(new Set(s.calls.map((c) => c.requestId)).size, 1);
  const s2 = scripted([{ error: { code: 'BUSY' } }, { error: { code: 'BUSY' } }, { error: { code: 'BUSY', message: '他の更新処理が実行中です。' } }]);
  await assert.rejects(createApi(s2.runner, { timeouts: T, wait: noWait }).mutate('saveMatchResult', {}), (e) => e.code === 'BUSY', 'BUSY が続けば保存されなかったとして返す（実行されていない）');
});

test('応答がない・送信直後に切れた: 同じ requestId で 1 回だけ送り直し、成功すれば保存済み（送り直しで確かめた印付き）', async () => {
  for (const first of ['timeout', 'network']) {
    const s = scripted([first, { data: { eventId: 'EVT-BBBB', duplicate: true } }]);
    const data = await createApi(s.runner, { timeouts: T, wait: noWait }).mutate('addPlayers', { eventId: 'EVT-BBBB' });
    assert.equal(data.recovered, true, first);
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls[0].requestId, s.calls[1].requestId, first + ': 同じ requestId');
  }
});

test('確認できない: 送り直しても分からない・送り直しの応答が「1 回目で保存済み」を示す競合なら UNCONFIRMED（保存失敗とは言わない）', async () => {
  for (const [steps, why] of [
    [['timeout', 'timeout'], '2 回とも応答なし'],
    [['network', 'network'], '2 回とも切断'],
    [['timeout', { error: { code: 'CONFLICT', message: '他の人が更新しました。' } }], '1 回目で保存済みのため版番号が合わない'],
    [['network', { error: { code: 'ALREADY_FINAL' } }], '1 回目で確定済み'],
    [['timeout', { error: { code: 'BUSY' } }, { error: { code: 'BUSY' } }, { error: { code: 'BUSY' } }], '1 回目がまだ実行中（BUSY が続く）'],
    [[{ error: { code: 'PARTIAL_WRITE', message: '前回の保存が途中で止まった可能性があります。' } }], '書き込みが途中で止まった'],
  ]) {
    const s = scripted(steps);
    let err;
    try {
      await createApi(s.runner, { timeouts: T, wait: noWait }).mutate('saveMatchResult', { matchId: 'M' });
    } catch (e) {
      err = e;
    }
    assert.equal(err && err.code, 'UNCONFIRMED', why);
    assert.match(err.message, /確認できませんでした/);
    assert.match(err.message, /入力した内容は残しています/);
    assert.equal(typeof err.resend, 'function');
    assert.equal(new Set(s.calls.map((c) => c.requestId)).size, 1, why + ': 送り直しはすべて同じ requestId');
  }
});

test('「同じ操作としてもう一度送る」は同じ requestId で送り、保存済みなら返す', async () => {
  const s = scripted(['timeout', 'timeout', { data: { duplicate: true } }]);
  const api = createApi(s.runner, { timeouts: T, wait: noWait });
  const err = await api.mutate('createEvent', { name: 'x' }).catch((e) => e);
  assert.equal(err.code, 'UNCONFIRMED');
  const data = await err.resend();
  assert.equal(data.duplicate, true);
  assert.equal(data.recovered, true);
  assert.equal(new Set(s.calls.map((c) => c.requestId)).size, 1);
});

test('読み込み（query）は送り直さない。期限切れは TIMEOUT として返す', async () => {
  const s = scripted(['timeout']);
  await assert.rejects(createApi(s.runner, { timeouts: T, wait: noWait }).query('eventDetail', {}), (e) => e.code === 'TIMEOUT');
  assert.equal(s.calls.length, 1);
});

test('fetch の期限: 応答がなければ期限で打ち切り（abort）、後から応答が来ても 2 回目の結果は呼ばない', async () => {
  let release;
  let aborted = false;
  const win = {
    AbortController: class {
      constructor() {
        this.signal = {};
      }
      abort() {
        aborted = true;
      }
    },
    fetch: () => new Promise((resolve) => (release = resolve)),
  };
  const run = createFetchRunner(win, 'https://example.invalid/exec', () => undefined);
  const events = [];
  run({ action: 'a', payload: {}, requestId: 'r', timeoutMs: 30 }, (d) => events.push(['ok', d]), (e) => events.push(['fail', e]));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(aborted, true);
  assert.deepEqual(events.map((e) => e[0]), ['fail']);
  assert.equal(events[0][1].timeout, true);
  release({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(events.length, 1, '期限の後に届いた応答は使わない');
});

/* ---------- 実物のサーバー（模擬 GAS）とつないだ場合 ---------- */

/** サーバーで実行した後に応答だけを捨てる（保存後の応答消失）。drop の回数だけ捨て、beforeResend で時計を進められる */
function lossy(p, drops, between) {
  let left = drops;
  return (request, ok, fail) => {
    const res = p.admin.post({ action: request.action, payload: request.payload, requestId: request.requestId, auth: { adminKey: ADMIN_KEY } });
    if (left > 0) {
      left--;
      if (between) between();
      return fail(new Error('connection reset after send'));
    }
    ok(res);
  };
}

test('保存後に応答が消えた（キャッシュが残っている）: 送り直しは前の保存を返し、二重に保存しない', async () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: '応答消失', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  const before = p.store.get().getSheetByName('Players').records().length;
  const api = createApi(lossy(p, 1), { timeouts: T, wait: noWait });
  const data = await api.mutate('addPlayers', { eventId: id, names: ['消失A', '消失B'] });
  assert.equal(data.recovered, true);
  assert.equal(data.duplicate, true);
  assert.equal(p.store.get().getSheetByName('Players').records().length, before + 2, '2 人だけ（4 人にならない）');
});

test('保存後に応答が消え、二重実行防止のキャッシュも消えた: 作成・追加は印で照合して保存済み、版番号の操作は確認不能（失敗と言わない）', async () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const expire = () => p.clock.advance(11 * 60 * 1000);
  // 作成
  const events0 = p.store.get().getSheetByName('Events').records().length;
  const created = await createApi(lossy(p, 1, expire), { timeouts: T, wait: noWait }).mutate('createEvent', { name: '消失して再送', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } });
  assert.equal(created.duplicate, true);
  assert.ok(created.eventId);
  assert.equal(p.store.get().getSheetByName('Events').records().length, events0 + 1, '大会は 1 つだけ');
  // 結果の保存（版番号で守られる）
  const d = p.ok('createSampleEvent', {}).detail;
  const m = d.groups[3].matches[0];
  const err = await createApi(lossy(p, 1, expire), { timeouts: T, wait: noWait })
    .mutate('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 })
    .catch((e) => e);
  assert.equal(err.code, 'UNCONFIRMED');
  const after = p.ok('eventDetail', { eventId: d.event.id }).groups[3].matches.find((x) => x.id === m.id);
  assert.equal(after.status, 'final', '実際には 1 回目で保存されている（読み直すと分かる）');
});

/* ---------- UX 改善 S1: 要求を先に作り、同じ要求として送り直せる（結果が分からないまま再読み込みした後の確認） ---------- */

test('prepare / send: 要求を先に作って送る。mutate と同じ結果の分け方で、requestId は prepare で決まる', async () => {
  const s = scripted([{ data: { eventId: 'EVT-AAAA' } }]);
  const api = createApi(s.runner, { timeouts: T, wait: noWait });
  const request = api.prepare('updateEvent', { x: 1 });
  assert.match(request.requestId, /^[0-9a-f]{32}$/);
  assert.equal(request.timeoutMs, 1000);
  assert.equal(s.calls.length, 0, 'prepare は送らない');
  const data = await api.send(request);
  assert.equal(data.eventId, 'EVT-AAAA');
  assert.equal(s.calls[0].requestId, request.requestId);
  assert.equal(api.prepare('restoreEvent', {}).timeoutMs, 3000);
  assert.notEqual(api.prepare('updateEvent', {}).requestId, request.requestId, 'requestId を渡さなければ新しい操作');
});

test('prepare に前の requestId を渡すと同じ操作になる。send(…, true) は「結果が分からない要求の確認」として送る', async () => {
  // 保存済みだった: 確かめられたもの（recovered）として返る
  const s = scripted([{ data: { eventId: 'EVT-AAAA' } }]);
  const api = createApi(s.runner, { timeouts: T, wait: noWait });
  const data = await api.send(api.prepare('createEvent', { name: 'x' }, 'a'.repeat(32)), true);
  assert.equal(s.calls[0].requestId, 'a'.repeat(32));
  assert.equal(data.recovered, true);
  // まだ分からない（通信できない）: 自動では繰り返さず、同じ requestId のまま「確認できない」
  const s2 = scripted(['network']);
  const err = await createApi(s2.runner, { timeouts: T, wait: noWait })
    .send(api.prepare('createEvent', { name: 'x' }, 'b'.repeat(32)), true)
    .then(() => null, (e) => e);
  assert.equal(err.code, 'UNCONFIRMED');
  assert.equal(s2.calls.length, 1);
  assert.equal(s2.calls[0].requestId, 'b'.repeat(32));
  // 版の不一致（1 回目で保存済みの可能性が高い）は、保存されなかったと決めつけず「確認できない」
  const s3 = scripted([{ error: { code: 'CONFLICT', message: '別の画面で更新されています。' } }]);
  const err3 = await createApi(s3.runner, { timeouts: T, wait: noWait })
    .send(api.prepare('updateEvent', {}, 'c'.repeat(32)), true)
    .then(() => null, (e) => e);
  assert.equal(err3.code, 'UNCONFIRMED');
  // サーバーがはっきり拒否した（入力の誤り）: 保存されなかった
  const s4 = scripted([{ error: { code: 'VALIDATION', message: '名前を入力してください。' } }]);
  await assert.rejects(createApi(s4.runner, { timeouts: T, wait: noWait }).send(api.prepare('updateEvent', {}, 'd'.repeat(32)), true), (e) => e.code === 'VALIDATION');
});

test('URL: #new は作成画面、#new-season・#restore・#sample は別の入口（秘密の情報は入れない）', () => {
  const { parseHash } = ctx.TPAdmin;
  assert.deepEqual({ ...parseHash('#new') }, { mode: 'home', create: true, view: 'new' });
  assert.deepEqual({ ...parseHash('#new-season') }, { mode: 'home', view: 'season' });
  assert.deepEqual({ ...parseHash('#restore') }, { mode: 'home', view: 'restore' });
  assert.deepEqual({ ...parseHash('#sample') }, { mode: 'home', view: 'sample' });
  assert.deepEqual({ ...parseHash('') }, { mode: 'home' });
  assert.equal(parseHash('#e=EVT-ABCD1234').mode, 'event');
});
