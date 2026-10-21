// 閲覧画面の自動更新（再試行・重複防止・分散・タブ非表示）のテスト。疑似タイマーで時間を進める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, setupPair } from './gas-mock.mjs';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(join(ROOT, 'viewer/src/client/viewer.js'), 'utf8'), ctx);
const { createPoller } = ctx.TPViewer;

function harness({ random = () => 0.5, respond, ...opts } = {}) {
  let t = 0;
  let id = 0;
  const timers = new Map();
  const log = [];
  const pending = [];
  const h = {
    log,
    pending,
    now: () => t,
    requests: 0,
    poller: null,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [k, v] of timers) if (v.at <= end && (!next || v.at < next[1].at)) next = [k, v];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
  h.poller = createPoller({
    now: () => t,
    random,
    setTimer: (fn, ms) => {
      timers.set(++id, { fn, at: t + ms });
      return id;
    },
    clearTimer: (k) => timers.delete(k),
    fetch: (req, ok, fail) => {
      h.requests++;
      const call = { req, ok, fail, at: t };
      pending.push(call);
      if (respond) respond(call, h);
    },
    onEvent: (type, detail, s) => log.push({ type, detail, s, at: t }),
    ...opts,
  });
  return h;
}

const okRes = (version = 'v1', extra = {}) => ({ ok: true, version, data: { v: version }, refresh: { intervalSec: 60, jitterSec: 10 }, ...extra });

test('起動直後に 1 回取得し、その後は 60 秒 ± 10 秒ごとに取得する', () => {
  const h = harness({ respond: (c) => c.ok(okRes()) });
  h.poller.start();
  assert.equal(h.requests, 1);
  h.advance(59_999);
  assert.equal(h.requests, 1, 'random=0.5 → ちょうど 60 秒');
  h.advance(1);
  assert.equal(h.requests, 2);
  h.advance(60_000 * 10);
  assert.equal(h.requests, 12);
});

test('取得間隔は閲覧者ごとにばらける（random 0→50 秒、1→70 秒）', () => {
  for (const [r, expected] of [[0, 50_000], [1, 70_000], [0.25, 55_000]]) {
    const h = harness({ random: () => r, respond: (c) => c.ok(okRes()) });
    h.poller.start();
    const sched = h.log.find((e) => e.type === 'scheduled');
    assert.equal(sched.detail.delayMs, expected, `random=${r}`);
  }
});

test('取得中は次の取得を始めない（手動更新・タイマーとも）', () => {
  const h = harness();
  h.poller.start();
  assert.equal(h.poller.refreshNow(), 'busy');
  h.advance(10_000);
  assert.equal(h.requests, 1);
  h.pending[0].ok(okRes());
  assert.equal(h.poller.refreshNow(), 'started');
  assert.equal(h.requests, 2);
});

test('手動更新は直前の取得から 5 秒以内なら実行しない', () => {
  const h = harness({ respond: (c) => c.ok(okRes()) });
  h.poller.start();
  h.advance(3000);
  assert.equal(h.poller.refreshNow(), 'throttled');
  h.advance(2000);
  assert.equal(h.poller.refreshNow(), 'started');
});

test('通信失敗時は 5→10→20→40→60 秒（上限）の指数バックオフで再試行し、成功したら通常間隔に戻る', () => {
  let fail = true;
  const h = harness({ random: () => 1, respond: (c) => (fail ? c.fail(new Error('network')) : c.ok(okRes())) });
  h.poller.start();
  const delays = () => h.log.filter((e) => e.type === 'failure').map((e) => e.detail.retryInMs);
  h.advance(5_000 + 10_000 + 20_000 + 40_000 + 60_000 + 60_000);
  assert.deepEqual(delays(), [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  assert.equal(h.poller.state().failures, 7);
  fail = false;
  h.advance(60_000);
  assert.equal(h.poller.state().failures, 0);
  const last = h.log.filter((e) => e.type === 'scheduled').pop();
  assert.equal(last.detail.delayMs, 70_000, '成功後は通常間隔（random=1 → 70 秒）');
});

test('バックオフにもランダム幅がある（random=0 で半分）', () => {
  const h = harness({ random: () => 0, respond: (c) => c.fail(new Error('x')) });
  h.poller.start();
  assert.equal(h.log.find((e) => e.type === 'failure').detail.retryInMs, 2500);
});

test('サーバーが ok:false（UNAVAILABLE）を返したときも失敗として再試行する', () => {
  const h = harness({ respond: (c) => c.ok({ ok: false, error: { code: 'UNAVAILABLE', message: 'x' } }) });
  h.poller.start();
  assert.equal(h.log.filter((e) => e.type === 'failure').length, 1);
});

test('「公開中の大会なし」は失敗ではなく、通常間隔で確認を続ける', () => {
  const h = harness({ respond: (c) => c.ok({ ok: false, error: { code: 'NO_PUBLIC_EVENT', message: 'x' }, refresh: { intervalSec: 60, jitterSec: 10 } }) });
  h.poller.start();
  assert.equal(h.poller.state().failures, 0);
  assert.equal(h.log.find((e) => e.type === 'scheduled').detail.delayMs, 60_000);
});

test('応答が 25 秒ない場合はタイムアウトとして再試行し、遅れて届いた応答は無視する', () => {
  const h = harness({ random: () => 1 });
  h.poller.start();
  h.advance(25_000);
  assert.equal(h.log.filter((e) => e.type === 'failure').length, 1);
  assert.equal(h.log.find((e) => e.type === 'failure').detail.error.code, 'TIMEOUT');
  h.pending[0].ok(okRes('late'));
  assert.equal(h.log.filter((e) => e.type === 'success').length, 0, '遅れた応答は使わない');
  h.advance(5_000);
  assert.equal(h.requests, 2);
  h.pending[1].ok(okRes('v2'));
  assert.equal(h.poller.state().version, 'v2');
});

test('2 回目以降は knownVersion を送り、notModified なら版を保つ', () => {
  const h = harness();
  h.poller.start();
  assert.equal(h.pending[0].req.knownVersion, '');
  h.pending[0].ok(okRes('v1'));
  h.advance(60_000);
  assert.equal(h.pending[1].req.knownVersion, 'v1');
  h.pending[1].ok({ ok: true, notModified: true, version: 'v1', refresh: { intervalSec: 60, jitterSec: 10 } });
  assert.equal(h.poller.state().version, 'v1');
});

test('タブが非表示の間は取得せず、表示に戻ったら 0〜2 秒後に取得する', () => {
  const h = harness({ respond: (c) => c.ok(okRes()) });
  h.poller.start();
  h.poller.setHidden(true);
  h.advance(10 * 60_000);
  assert.equal(h.requests, 1, '非表示中は 1 回も取得しない');
  h.poller.setHidden(false);
  h.advance(2_000);
  assert.equal(h.requests, 2);
});

test('サーバー指定の間隔は 30〜600 秒に制限し、URL で指定した試験用間隔はそれより優先する', () => {
  const h = harness({ respond: (c) => c.ok(okRes('v', { refresh: { intervalSec: 1, jitterSec: 0 } })) });
  h.poller.start();
  assert.equal(h.log.find((e) => e.type === 'scheduled').detail.delayMs, 30_000);
  const h2 = harness({ intervalMs: 15_000, jitterMs: 0, intervalLocked: true, respond: (c) => c.ok(okRes()) });
  h2.poller.start();
  assert.equal(h2.log.find((e) => e.type === 'scheduled').detail.delayMs, 15_000);
});

test('fetch が同期的に例外を投げても止まらず再試行する', () => {
  const h = harness({ respond: () => { throw new Error('google is not defined'); } });
  h.poller.start();
  assert.equal(h.poller.state().failures, 1);
  assert.equal(h.poller.state().inFlight, false);
});

test('負荷の試算（模擬）: 50 人 × 60 分、運営が毎分結果を更新しても、シートの読み込みは毎分 3 回程度に収まる', () => {
  // 実環境の負荷試験ではない。キャッシュと取得間隔の設計値どおりに読み込み回数が抑えられるかの計算上の確認。
  const pair = setupPair();
  pair.ok('initializeStorage');
  const detail = pair.ok('createSampleEvent', { publish: true }).detail;
  const scheduled = detail.groups.flatMap((g) => g.matches).filter((m) => m.status === 'scheduled');
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const clients = [];
  const timers = [];
  let t = 0;
  for (let i = 0; i < 50; i++) {
    const c = createPoller({
      now: () => t,
      random: rand,
      setTimer: (fn, ms) => {
        const tm = { fn, at: t + ms, live: true };
        timers.push(tm);
        return tm;
      },
      clearTimer: (tm) => tm && (tm.live = false),
      fetch: (req, ok) => ok(pair.viewer.run('getPublicSnapshot', req)),
    });
    clients.push(c);
  }
  const readsBefore = pair.store.stats.opens;
  // 50 人が最初の 30 秒の間にばらばらに開く
  const starts = clients.map((c) => ({ c, at: Math.floor(rand() * 300) * 100 }));
  let responses = 0;
  let maxSameSecond = 0;
  const perSecond = new Map();
  const origRun = pair.viewer.run;
  pair.viewer.run = (...a) => {
    responses++;
    const s = Math.floor(t / 1000);
    perSecond.set(s, (perSecond.get(s) || 0) + 1);
    maxSameSecond = Math.max(maxSameSecond, perSecond.get(s));
    return origRun(...a);
  };
  let nextAdminUpdate = 60_000;
  let k = 0;
  const end = 60 * 60_000;
  while (t < end) {
    const startsNow = starts.filter((s) => s.at === t);
    startsNow.forEach((s) => s.c.start());
    const due = timers.filter((tm) => tm.live && tm.at <= t);
    due.forEach((tm) => {
      tm.live = false;
      tm.fn();
    });
    if (t >= nextAdminUpdate && k < scheduled.length) {
      const m = scheduled[k++];
      pair.clock.advance(0);
      pair.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 });
      nextAdminUpdate += 60_000;
    }
    t += 100;
    pair.clock.advance(100);
  }
  const opens = pair.store.stats.opens - readsBefore;
  const perMinute = responses / 60;
  // 1 人あたり約 1 回/分 → 50 回/分前後
  assert.ok(perMinute > 45 && perMinute < 56, `requests/min = ${perMinute}`);
  // キャッシュ 20 秒 → シートを開くのは閲覧側で最大 3 回/分程度（運営側の書き込みで開く回数を含む）
  assert.ok(opens / 60 < 5, `spreadsheet opens/min = ${opens / 60}`);
  assert.ok(maxSameSecond <= 10, `同じ 1 秒に集中したリクエスト数 = ${maxSameSecond}`);
  console.log(`[simulation] requests/min=${perMinute.toFixed(1)} spreadsheetOpens/min=${(opens / 60).toFixed(2)} maxPerSecond=${maxSameSecond}`);
});

test('URL のパラメータ（?event=…&interval=…）を読む', () => {
  const read = ctx.TPViewer.readSearchParams;
  assert.deepEqual({ ...read('?event=EVT-ABC123&interval=15') }, { event: 'EVT-ABC123', interval: '15' });
  assert.deepEqual({ ...read('') }, {});
  assert.deepEqual({ ...read('?a=1&a=2&b') }, { a: '1', b: '' });
  assert.equal(read('?q=%E5%A4%A7%E4%BC%9A+1').q, '大会 1');
});

test('fetch の通信: Cookie を送らず ?format=json を読み、HTTP エラー・JSON でない応答は失敗にする', async () => {
  const calls = [];
  const responses = [
    { ok: true, status: 200, json: async () => ({ ok: true, version: 'v1' }) },
    { ok: false, status: 500, json: async () => ({}) },
    { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } },
  ];
  const win = { fetch: async (url, opts) => (calls.push({ url, opts }), responses[calls.length - 1]) };
  const transport = ctx.TPViewer.createFetchTransport(win, 'https://script.google.com/macros/s/ABC/exec');
  const run = (req) => new Promise((resolve) => transport(req, (d) => resolve({ ok: d }), (e) => resolve({ fail: e.message })));
  assert.deepEqual(await run({ eventId: 'EVT-ABC123', knownVersion: 'v0' }), { ok: { ok: true, version: 'v1' } });
  assert.equal(calls[0].url, 'https://script.google.com/macros/s/ABC/exec?format=json&event=EVT-ABC123&known=v0');
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.equal(calls[0].opts.cache, 'no-store');
  assert.deepEqual(await run({}), { fail: 'HTTP 500' });
  assert.equal(calls[1].url, 'https://script.google.com/macros/s/ABC/exec?format=json');
  assert.match((await run({})).fail, /Unexpected token/);
});

test('トーナメント表の配置: 試合は order の枠に置き、不戦勝の枠は空き・線の要否・3 位決定戦を分ける', () => {
  const { bracketLayout } = ctx.TPViewer;
  // vm の別コンテキストの配列なので、比較の前に普通の値にする
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const m = (round, order, label, p1 = 'a', p2 = 'b') => ({ id: `${round}-${order}-${label}`, round, order, label, p1: { id: p1 }, p2: { id: p2 } });
  // 5 名 → 8 枠: 1 回戦は 2 枠目（4 位 vs 5 位）だけ、準決勝 2・決勝・3 位決定戦
  const layout = bracketLayout([
    { round: 3, label: '決勝', matches: [m(3, 1, '決勝', '', ''), m(3, 2, '3位決定戦', '', '')] },
    { round: 1, label: '準々決勝', matches: [m(1, 2, '準々決勝')] },
    { round: 2, label: '準決勝', matches: [m(2, 1, '準決勝', 'p1', ''), m(2, 2, '準決勝', 'p2', 'p3')] },
  ]);
  assert.deepEqual(plain(layout.columns.map((c) => [c.label, c.slots.length])), [['準々決勝', 4], ['準決勝', 2], ['決勝', 1]]);
  assert.deepEqual(plain(layout.columns[0].slots.map((x) => (x ? x.order : null))), [null, 2, null, null]);
  // 準決勝 1 は 1 回戦から勝者が上がってくる（線を引く）、準決勝 2 は不戦勝どうしなので線なし
  assert.deepEqual(plain(layout.columns[1].fed), [true, false]);
  assert.deepEqual(plain(layout.columns[2].fed), [true]);
  assert.deepEqual(plain(layout.third.map((x) => x.label)), ['3位決定戦']);

  // order が欠けている・重なるときは出現順に詰める
  const broken = bracketLayout([{ round: 1, label: '決勝', matches: [m(1, 5, '決勝'), m(1, 5, '決勝')] }]);
  assert.equal(broken.columns[0].slots.filter(Boolean).length, 2);
  assert.deepEqual(plain(bracketLayout([]).columns), []);
});

