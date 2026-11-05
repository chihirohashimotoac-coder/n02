const B = 'http://127.0.0.1:' + (process.env.TPORT || 4185);
const GAS_MOCK = require('path').resolve(__dirname, '../../tournament-poc/tests/gas-mock.mjs');
const ADMIN_KEY = require('child_process').execFileSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify('file://' + GAS_MOCK)}).then((m) => process.stdout.write(m.ADMIN_KEY))`]).toString();
let seq = 0;
async function call(action, payload = {}, auth) {
  const a = auth === undefined ? { adminKey: ADMIN_KEY } : auth;
  const r = await fetch(B + '/admin-post', { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, payload, requestId: 'x-' + Date.now() + '-' + (++seq), auth: a }) });
  return r.json();
}
async function ok(action, payload, auth) { const r = await call(action, payload, auth); if (!r.ok) throw new Error(action + ': ' + JSON.stringify(r.error)); return r.data; }
async function reset() { await fetch(B + '/__reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ configured: true }) }); await call('initializeStorage'); }
function allMatches(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  return (st.rounds || []).flatMap((r) => r.matches);
}
async function detail(id) { return ok('eventDetail', { eventId: id }); }
async function play(id, sid, limit = 999) {
  for (let i = 0; i < limit; i++) {
    const st = (await detail(id)).stages.find((s) => s.id === sid);
    const m = allMatches(st).find((x) => (x.status === 'scheduled' || x.status === 'live') && x.p1.id && x.p2.id);
    if (!m) return;
    const p1 = m.p1.name < m.p2.name;
    await ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: p1 ? 2 : 0, p2Legs: p1 ? 0 : 2 });
  }
}
async function publish(id) { const ev = (await detail(id)).event; await ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel || '', notes: ev.notes || '', status: ev.status, isPublic: true, isFeatured: false }); }
async function routeViewer(page) {
  await page.route('https://script.google.com/macros/s/PREVIEW/exec**', async (route) => {
    const u = new URL(route.request().url());
    const r = await fetch(B + '/viewer-json' + u.search);
    await route.fulfill({ status: r.status, contentType: r.headers.get('content-type'), body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
}
module.exports = { B, ADMIN_KEY, call, ok, reset, allMatches, detail, play, publish, routeViewer };
