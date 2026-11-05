// 23: 保存 1 回で読む量（文字数）が、大会の数・履歴の行数でどう増えるか（模擬。本番の時間ではない）
import { setupPair } from '../../tournament-poc/tests/gas-mock.mjs';
const names = (n) => Array.from({ length: n }, (_, i) => '選手' + String(i + 1).padStart(2, '0'));
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
function scenario(otherEvents, extraHistory) {
  const p = setupPair();
  p.ok('initializeStorage');
  for (let i = 0; i < otherEvents; i++) p.ok('createSampleEvent', { publish: true });
  const id = p.ok('createEvent', { name: '計測', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(16) });
  let d = p.ok('eventDetail', { eventId: id });
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id });
  p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id });
  const ev = p.ok('eventDetail', { eventId: id }).event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: '', notes: '', status: ev.status, isPublic: true, isFeatured: false });
  const book = p.store.get();
  if (extraHistory) {
    const h = book.getSheetByName('History');
    const tmpl = h.rows[h.rows.length - 1];
    for (let i = 0; i < extraHistory; i++) { const r = tmpl.slice(); r[0] = 'HIS-X' + i; h.rows.push(r); }
  }
  let chars = 0; const perSheet = {};
  const origGet = book.getSheetByName.bind(book);
  book.getSheetByName = (n) => {
    const s = origGet(n);
    if (s && !s.__w) {
      s.__w = true;
      for (const fn of ['getDataRange', 'getRange']) {
        const o = s[fn].bind(s);
        s[fn] = (...a) => { const r = o(...a); const gv = r.getValues.bind(r); r.getValues = () => { const v = gv(); const c = JSON.stringify(v).length; chars += c; perSheet[n] = (perSheet[n] || 0) + c; return v; }; return r; };
      }
    }
    return s;
  };
  const times = [], reads = [];
  let resp = 0;
  for (let i = 0; i < 30; i++) {
    const m = p.ok('eventDetail', { eventId: id }).stages[0].groups[0].matches.find((x) => x.status === 'scheduled');
    chars = 0; for (const k of Object.keys(perSheet)) delete perSheet[k];
    const t0 = performance.now();
    const r = p.call('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 2, p2Legs: 0 });
    times.push(performance.now() - t0);
    reads.push(chars);
    resp = JSON.stringify(r).length;
  }
  const sheets = Object.fromEntries(['Events', 'Players', 'Matches', 'History', 'PublicSnapshots'].map((n) => [n, origGet(n).rows.length - 1]));
  return { otherEvents, historyRows: sheets.History, sheetRows: sheets, charsReadPerSave: { p50: pct(reads, 0.5), p95: pct(reads, 0.95) }, topSheets: Object.entries(perSheet).sort((a, b) => b[1] - a[1]).slice(0, 4), responseChars: resp, localMs: { p50: +pct(times, 0.5).toFixed(1), p95: +pct(times, 0.95).toFixed(1) } };
}
for (const [e, h] of [[0, 0], [10, 0], [40, 0]]) console.log(JSON.stringify(scenario(e, h)));
