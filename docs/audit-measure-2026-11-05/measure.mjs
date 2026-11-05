// 監査案 20・21・23 の計測（模擬環境。本番の時間ではなく、回数・件数・大きさを数える）
import { setupPair } from '../../tournament-poc/tests/gas-mock.mjs';
const names = (n, p = '選手') => Array.from({ length: n }, (_, i) => p + String(i + 1).padStart(2, '0'));
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const out = {};
function ensureMatches(p, id, auth) {
  const d = p.ok('eventDetail', { eventId: id }, auth ? { auth } : undefined);
  const st = d.stages[0];
  if (!st.groups.flatMap((g) => g.matches).length) {
    if (!st.groups.some((g) => g.players.length)) p.ok('autoAssign', { eventId: id, stageId: st.id });
    p.ok('generateMatches', { eventId: id, stageId: st.id });
  }
}

function publish(p, id) {
  const ev = p.ok('eventDetail', { eventId: id }).event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', notes: '', status: ev.status, isPublic: true, isFeatured: false });
}

/* ---------- 21: 閲覧者用 GAS の未知 ID ---------- */
{
  const p = setupPair();
  p.ok('initializeStorage');
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(p.ok('createSampleEvent', { publish: true }).detail.event.id);
  const sheetChars = JSON.stringify(p.store.get().getSheetByName('PublicSnapshots').rows).length;
  p.clock.advance(60000);
  const run = (label, reqs) => {
    p.clock.advance(60000); // キャッシュを切らす
    const s0 = p.store.stats.reads;
    let notFound = 0;
    reqs.forEach((id, i) => {
      const r = p.viewer.run('getPublicSnapshot', { eventId: id });
      if (!r.ok) notFound++;
      p.clock.advance(100); // 0.1 秒ごと（20 秒の TTL の中）
    });
    return { label, requests: reqs.length, sheetReads: p.store.stats.reads - s0, notFound };
  };
  const unknown = (i) => 'EVT-' + ('UNKNOWN' + String(i).padStart(6, '0')).slice(0, 13).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  out.m21 = {
    publicSheetChars: sheetChars,
    rows: [
      run('公開中の同じ ID × 100', Array(100).fill(ids[0])),
      run('公開中の 5 つの ID × 20', Array.from({ length: 100 }, (_, i) => ids[i % 5])),
      run('同じ未知 ID × 100', Array(100).fill('EVT-ZZZZZZZZZZ')),
      run('毎回違う未知 ID × 100', Array.from({ length: 100 }, (_, i) => 'EVT-Z' + String(i).padStart(9, '0'))),
      run('公開中 50 + 違う未知 50（交互）', Array.from({ length: 100 }, (_, i) => (i % 2 ? 'EVT-Y' + String(i).padStart(9, '0') : ids[0]))),
    ],
  };
}

/* ---------- 20: スタッフ認証の失敗の共有 ---------- */
{
  const p = setupPair();
  p.ok('initializeStorage');
  const a = p.ok('createSampleEvent', { publish: true }).detail.event;
  const b = p.ok('createSampleEvent', { publish: true }).detail.event;
  p.ok('setStaffPassword', { eventId: a.id, rev: p.ok('eventDetail', { eventId: a.id }).event.rev, password: 'correct-pass-01' });
  p.ok('setStaffPassword', { eventId: b.id, rev: p.ok('eventDetail', { eventId: b.id }).event.rev, password: 'correct-pass-02' });
  ensureMatches(p, a.id);
  const before = p.staffLogin(a.id, 'correct-pass-01'); // 攻撃の前からログインしていたスタッフ
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push(p.call('staffLogin', { eventId: a.id, password: 'wrong-' + i }, { auth: 'anon' }).error.code);
  const rightA = p.call('staffLogin', { eventId: a.id, password: 'correct-pass-01' }, { auth: 'anon' });
  const rightB = p.call('staffLogin', { eventId: b.id, password: 'correct-pass-02' }, { auth: 'anon' });
  const m = p.ok('eventDetail', { eventId: a.id }, { auth: before }).stages[0].groups.flatMap((g) => g.matches).find((x) => x.status === 'scheduled' && x.p1.id && x.p2.id);
  const save = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }, { auth: before });
  p.clock.advance(599 * 1000);
  const at599 = p.call('staffLogin', { eventId: a.id, password: 'correct-pass-01' }, { auth: 'anon' });
  p.clock.advance(2 * 1000);
  const at601 = p.call('staffLogin', { eventId: a.id, password: 'correct-pass-01' }, { auth: 'anon' });
  out.m20 = {
    wrongAttemptCodes: codes,
    correctPasswordAfter: rightA.ok ? 'ok' : rightA.error.code,
    otherEventCorrect: rightB.ok ? 'ok' : rightB.error.code,
    existingSessionSave: save.ok ? 'ok' : save.error.code,
    correctAt599s: at599.ok ? 'ok' : at599.error.code,
    correctAt601s: at601.ok ? 'ok' : at601.error.code,
  };
}

/* ---------- 23: 保存の処理（読み書きの回数・応答の大きさ） ---------- */
{
  const p = setupPair();
  p.ok('initializeStorage');
  // 他の大会がある状態（全件参照の影響を見るため 10 大会）
  for (let i = 0; i < 9; i++) p.ok('createSampleEvent', { publish: true });
  const ev = p.ok('createSampleEvent', { publish: true }).detail.event;
  ensureMatches(p, ev.id);
  const book = p.store.get();
  const tally = {};
  const wrap = (sheet) => {
    if (sheet.__wrapped) return;
    sheet.__wrapped = true;
    const name = sheet.getName();
    for (const fn of ['getDataRange', 'getRange']) {
      const orig = sheet[fn].bind(sheet);
      sheet[fn] = (...args) => {
        const r = orig(...args);
        const gv = r.getValues.bind(r);
        r.getValues = () => { tally[name] = (tally[name] || 0) + 1; return gv(); };
        const sv = r.setValues ? r.setValues.bind(r) : null;
        if (sv) r.setValues = (v) => { tally[name + ' (書)'] = (tally[name + ' (書)'] || 0) + 1; return sv(v); };
        return r;
      };
    }
  };
  const origGet = book.getSheetByName.bind(book);
  book.getSheetByName = (n) => { const s = origGet(n); if (s) wrap(s); return s; };
  const histRows = () => book.getSheetByName('History').rows.length - 1;
  const measure = (label, fn) => {
    for (const k of Object.keys(tally)) delete tally[k];
    const s0 = { ...p.store.stats };
    const res = fn();
    return { label, reads: p.store.stats.reads - s0.reads, writes: p.store.stats.writes - s0.writes, perSheet: { ...tally }, responseChars: JSON.stringify(res).length, elapsedMs: res.elapsedMs };
  };
  const rows = [];
  const all = () => p.ok('eventDetail', { eventId: ev.id }).stages[0].groups.flatMap((g) => g.matches).filter((m) => m.status === 'scheduled');
  rows.push(measure('eventDetail（16 人のサンプル）', () => p.call('eventDetail', { eventId: ev.id })));
  const m1 = all()[0];
  rows.push(measure('saveMatchResult 1 試合', () => p.call('saveMatchResult', { matchId: m1.id, rev: m1.rev, status: 'final', p1Legs: 3, p2Legs: 0 })));
  const batch = all().slice(0, 8);
  rows.push(measure('saveMatchResults 8 試合', () => p.call('saveMatchResults', { eventId: ev.id, results: batch.map((m) => ({ matchId: m.id, rev: m.rev, p1Legs: 3, p2Legs: 1 })) })));
  rows.push(measure('bootstrap（管理者のホーム・10 大会）', () => p.call('bootstrap', {})));
  // 時間の分布（模擬。GAS の実時間ではない）
  const times = [];
  for (let i = 0; i < 40; i++) {
    const ms = all();
    if (!ms.length) break;
    const m = ms[0];
    const t0 = performance.now();
    p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 });
    times.push(performance.now() - t0);
  }
  out.m23 = { historyRows: histRows(), rows, localMs: { n: times.length, p50: Math.round(pct(times, 0.5)), p95: Math.round(pct(times, 0.95)) } };
}
console.log(JSON.stringify(out, null, 1));
