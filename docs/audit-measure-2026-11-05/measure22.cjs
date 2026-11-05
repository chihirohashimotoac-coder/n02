const { chromium } = require('playwright');
const c = require('./common.cjs');
(async () => {
  const res = [];
  for (const n of [30, 50, 80, 110]) {
    await c.reset();
    const id = (await c.ok('createEvent', { name: 'L' + n, template: 'league', rule: { format: 'legs', bestOf: 3 } })).eventId;
    await c.ok('importPlayers', { eventId: id, players: Array.from({ length: n }, (_, i) => ({ name: '大選手' + (i + 1) })) });
    let d = await c.detail(id);
    await c.ok('autoAssign', { eventId: id, stageId: d.stages[0].id });
    const g = await c.call('generateMatches', { eventId: id, stageId: d.stages[0].id });
    if (!g.ok) { res.push({ n, error: g.error.code + ' ' + g.error.message }); continue; }
    const pub = await c.call('updateEvent', { eventId: id, rev: (await c.detail(id)).event.rev, name: 'L' + n, dateLabel: '', notes: '', status: 'running', isPublic: true, isFeatured: false });
    if (!pub.ok) { res.push({ n, error: pub.error.code + ' ' + pub.error.message }); continue; }
    for (const delay of [0, 300]) {
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      let inflight = 0, maxInflight = 0, parts = 0, mains = 0;
      await page.route('https://script.google.com/macros/s/PREVIEW/exec**', async (route) => {
        const u = new URL(route.request().url());
        const isPart = /part/.test(u.search);
        if (isPart) parts++; else mains++;
        inflight++; maxInflight = Math.max(maxInflight, inflight);
        if (delay && isPart) await new Promise((r) => setTimeout(r, delay)); // 応答の遅れ（模擬）
        const r = await fetch(c.B + '/viewer-json' + u.search);
        const body = await r.text();
        inflight--;
        await route.fulfill({ status: r.status, contentType: r.headers.get('content-type'), body, headers: { 'access-control-allow-origin': '*' } });
      });
      const t0 = Date.now();
      await page.goto(c.B + '/pages/index.html?event=' + id);
      await page.waitForSelector('.match', { timeout: 60000 });
      const firstMs = Date.now() - t0;
      await browser.close();
      res.push({ n, partDelayMs: delay, mainRequests: mains, partRequests: parts, maxInFlight: maxInflight, firstRenderMs: firstMs });
    }
  }
  console.log(JSON.stringify(res, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
