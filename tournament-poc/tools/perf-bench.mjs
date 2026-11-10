// 運営用 API の処理時間を模擬環境（tests/gas-mock.mjs）で計測する（性能改善の前後比較用）。
// 注意: Node.js 上の模擬環境の値で、Apps Script・スプレッドシートの実環境の応答時間ではない。
//
//   node tools/perf-bench.mjs [--root <tournament-poc のパス>] [--reps 15] [--many 100] [--out result.json] [--dump outputs.json]
//
// --root を変えると、別の版（例: main の worktree）の dist/admin/Code.gs で同じ手順を計測できる。
// ID・乱数は固定の系列に差し替えるので、同じ手順なら版をまたいで応答（--dump）を比べられる。
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const root = resolve(arg('root', join(fileURLToPath(import.meta.url), '..', '..')));
const reps = Number(arg('reps', 15));
const out = arg('out', '');
const dumpPath = arg('dump', '');
const { setupPair } = await import(pathToFileURL(join(root, 'tests', 'gas-mock.mjs')).href);

// 決まった系列の ID・乱数（版をまたいで同じ手順を再現する）
let seed = 12345;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
let uuidN = 0;
const uuid = () => {
  const h = (++uuidN).toString(16).padStart(12, '0').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4000-8000-000000000000`;
};

const PHASES = [
  'authenticate_', 'readTable_', 'collectEvent_', 'buildEventView_', 'summarizeEventView_', 'prepareMatchResult_', 'applyMatchResult_',
  'afterEventChange_', 'syncPublication_', 'buildPublication_', 'commitContext_', 'eventDetail_', 'seasonDetail_', 'snapshotBudget_',
];

function instrument(project) {
  project.context.Utilities.getUuid = uuid;
  const prof = {};
  for (const name of PHASES) {
    const f = project.context[name];
    if (typeof f !== 'function') continue;
    project.context[name] = function (...a) {
      const t = performance.now();
      try {
        return f.apply(this, a);
      } finally {
        const p = (prof[name] = prof[name] || { calls: 0, ms: 0 });
        p.calls++;
        p.ms += performance.now() - t;
      }
    };
  }
  return prof;
}

function stats(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2) };
}

const p = setupPair();
const prof = instrument(p.admin);
p.ok('initializeStorage');
const ALICE = 'alice@example.org';
const BOB = 'bob@example.net';
let alice = p.loginAs(ALICE);
p.link(alice);
let bob = p.loginAs(BOB);
p.link(bob);
// 作成の回数制限（1 時間に 5 件）があるので、5 件ごとに模擬の時計を進めてログインし直す
let created = 0;
function relogin() {
  alice = p.loginAs(ALICE);
  bob = p.loginAs(BOB);
}
function beforeCreate() {
  if (created > 0 && created % 5 === 0) {
    p.clock.advance(61 * 60 * 1000);
    relogin();
  }
  created++;
}
const people = (n, pre) => Array.from({ length: n }, (_, i) => ({ name: pre + String(i + 1).padStart(3, '0') }));

function playSome(auth, eventId, count) {
  let d = p.ok('eventDetail', { eventId }, { auth });
  for (let k = 0; k < count; k++) {
    const all = d.stages.flatMap((s) => (s.groups ? s.groups.flatMap((g) => g.matches) : (s.rounds || []).flatMap((r) => r.matches)));
    const m = all.find((x) => x.status === 'scheduled' && x.p1.id && x.p2.id);
    if (!m) return;
    d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: k % 3 }, { auth }).detail;
  }
}

// 準備: Alice の大会 24 件（サンプル 16 人・結果あり/なし・公開/非公開）、Bob の大会 12 件、Alice の 50 人総当たり 1 件
const aliceEvents = [];
for (let i = 0; i < 24; i++) {
  beforeCreate();
  const id = p.ok('createSampleEvent', { publish: i % 2 === 0 }, { auth: alice }).eventId;
  if (i % 3 === 0) playSome(alice, id, 6);
  aliceEvents.push(id);
}
for (let i = 0; i < 12; i++) {
  beforeCreate();
  p.ok('createSampleEvent', { publish: true }, { auth: bob });
}
beforeCreate();
const big = p.ok('createEvent', { name: '50 人総当たり', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 5 } }, { auth: alice }).eventId;
p.ok('importPlayers', { eventId: big, players: people(50, '選手') }, { auth: alice });
let bd = p.ok('eventDetail', { eventId: big }, { auth: alice });
p.ok('autoAssign', { eventId: big, stageId: bd.stages[0].id }, { auth: alice });
p.ok('generateMatches', { eventId: big, stageId: bd.stages[0].id }, { auth: alice });
bd = p.ok('eventDetail', { eventId: big }, { auth: alice });
p.ok('updateEvent', { eventId: big, rev: bd.event.rev, name: bd.event.name, dateLabel: '', status: 'running', isPublic: true, isFeatured: false, notes: '' }, { auth: alice });
// 50 人の半分ほど（600 試合）を入れておく
bd = p.ok('eventDetail', { eventId: big }, { auth: alice });
const bigAll = bd.stages[0].groups[0].matches;
for (let i = 0; i < 600; i += 64) {
  const batch = bigAll.slice(i, Math.min(600, i + 64)).map((x, k) => ({ matchId: x.id, rev: x.rev, p1Legs: 3, p2Legs: (i + k) % 3 }));
  p.ok('saveMatchResults', { eventId: big, results: batch }, { auth: alice });
}

const results = {};
const dumps = {};
function measure(label, n, fn) {
  const times = [];
  const reads = [];
  const writes = [];
  const sizes = [];
  for (const k of Object.keys(prof)) delete prof[k];
  for (let i = 0; i < n; i++) {
    const r0 = p.store.stats.reads;
    const w0 = p.store.stats.writes;
    const t = performance.now();
    const res = fn(i);
    times.push(performance.now() - t);
    reads.push(p.store.stats.reads - r0);
    writes.push(p.store.stats.writes - w0);
    if (!res.ok) throw new Error(`${label}: ${res.error.code} ${res.error.message}`);
    sizes.push(JSON.stringify(res).length);
    if (i === 0 || i === n - 1) {
      const copy = { ...res };
      delete copy.elapsedMs;
      dumps[`${label}#${i}`] = copy;
    }
  }
  const phases = {};
  for (const [k, v] of Object.entries(prof)) phases[k] = { callsPerOp: +(v.calls / n).toFixed(2), msPerOp: +(v.ms / n).toFixed(2) };
  results[label] = { ms: stats(times), sheetReadsPerOp: reads.reduce((a, b) => a + b, 0) / n, sheetWritesPerOp: writes.reduce((a, b) => a + b, 0) / n, responseChars: Math.round(sizes.reduce((a, b) => a + b, 0) / n), phases };
}

measure('myEvents (Alice 25 events, 37 total)', reps, () => p.call('myEvents', {}, { auth: alice }));
measure('eventDetail (50 players, 1225 matches, public)', reps, () => p.call('eventDetail', { eventId: big }, { auth: alice }));
measure('eventDetail (16 players sample)', reps, () => p.call('eventDetail', { eventId: aliceEvents[1] }, { auth: alice }));

// 1 試合の保存（50 人・公開・分割あり）
bd = p.ok('eventDetail', { eventId: big }, { auth: alice });
let pending = bd.stages[0].groups[0].matches.filter((x) => x.status === 'scheduled');
measure('saveMatchResult (50 players, public, partitioned)', reps, (i) => {
  const m = pending[i];
  return p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: i % 3 }, { auth: alice });
});
// 64 試合のまとめて確定
bd = p.ok('eventDetail', { eventId: big }, { auth: alice });
pending = bd.stages[0].groups[0].matches.filter((x) => x.status === 'scheduled');
const batchReps = Math.max(3, Math.min(5, Math.floor(pending.length / 64)));
measure('saveMatchResults x64 (50 players, public)', batchReps, (i) => {
  const batch = pending.slice(i * 64, i * 64 + 64).map((x, k) => ({ matchId: x.id, rev: x.rev, p1Legs: k % 3, p2Legs: 3 }));
  return p.call('saveMatchResults', { eventId: big, results: batch }, { auth: alice });
});
// 16 人のサンプル大会（公開）で 1 試合の保存
const small = aliceEvents[2];
let sd = p.ok('eventDetail', { eventId: small }, { auth: alice });
const smallPending = sd.stages[0].groups.flatMap((g) => g.matches).filter((x) => x.status === 'scheduled');
measure('saveMatchResult (16 players sample, public)', Math.min(reps, smallPending.length), (i) => {
  const m = smallPending[i];
  return p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 1 }, { auth: alice });
});
measure('republish (50 players)', Math.min(reps, 8), () => p.call('republish', { eventId: big }, { auth: alice }));

// 大会の多い条件: Alice 100 件・Bob 100 件（一覧の上限 MAX_MY_EVENTS = 100）
const many = Number(arg('many', 100));
if (many > 0) {
  for (let i = aliceEvents.length + 1; i < many; i++) {
    beforeCreate();
    const id = p.ok('createSampleEvent', { publish: i % 2 === 0 }, { auth: alice }).eventId;
    if (i % 4 === 0) playSome(alice, id, 4);
  }
  for (let i = 12; i < many; i++) {
    beforeCreate();
    p.ok('createSampleEvent', { publish: true }, { auth: bob });
  }
  measure(`myEvents (Alice ${many} events, ${2 * many} total)`, reps, () => p.call('myEvents', {}, { auth: alice }));
  const d4 = p.ok('eventDetail', { eventId: aliceEvents[4] }, { auth: alice });
  const pend4 = d4.stages[0].groups.flatMap((g) => g.matches).filter((x) => x.status === 'scheduled');
  measure(`saveMatchResult (16 players sample, ${2 * many} events in sheets)`, Math.min(reps, pend4.length), (i) => {
    const m = pend4[i];
    return p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 2 }, { auth: alice });
  });
  measure(`eventDetail (16 players sample, ${2 * many} events in sheets)`, reps, () => p.call('eventDetail', { eventId: aliceEvents[4] }, { auth: alice }));
}

const report = { root, note: 'Node.js mock (tests/gas-mock.mjs) timings; NOT Apps Script production latency', node: process.version, results };
console.log(JSON.stringify(report, null, 2));
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
if (dumpPath) writeFileSync(dumpPath, JSON.stringify({ dumps, store: JSON.parse(p.store.dump()) }));
