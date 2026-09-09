/**
 * Contrast audit tool. NOT part of the test suite - it lives outside e2e/ and only reports.
 *
 *   npm run build:preview
 *   npx playwright test --config tools/style-snapshot.config.ts contrast
 *
 * Walks every text-bearing element on the listed screens, resolves the colour actually painted
 * behind it (walking up through transparent ancestors and honouring the alpha of each layer), and
 * reports every pair below the WCAG AA threshold for its size: 4.5:1 for body text, 3:1 for large
 * text (>=24px, or >=18.66px when bold).
 */
import { test } from '@playwright/test';
import {
  enterCountUpRound,
  enterGameScore,
  openFreshApp,
  openPentathlon,
  openPracticeHub,
  openSingleGame,
  startCountUp,
} from '../e2e/helpers';

const AUDIT = `
(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /**
   * The colour painted behind an element: composite the background-color of each ancestor down to
   * the first opaque one.
   *
   * Gradients cannot be reduced to a single colour here. <body> carries a very faint radial wash
   * over an opaque --canvas, so ignoring it costs nothing - but a gradient nearer than that (the
   * COUNT-UP header, the award card) really is what the text sits on, and the composited colour is
   * then only an approximation. Those rows carry an approx flag so they get read by eye
   * rather than trusted as a number.
   */
  const backdrop = (el) => {
    const layers = [];
    let approx = false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' && n !== document.body && n !== document.documentElement) {
        approx = true;
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a === 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
    return { colour: base, approx };
  };

  const out = [];
  /*
   * While a dialog is open the screen behind it is covered by a scrim, so its text is neither
   * readable nor meant to be: auditing it just reports the scrim blend. Audit only what is on top.
   */
  const dialog = document.querySelector(
    '.n01-modal-backdrop, .countup-modal-backdrop, .pent-modal-backdrop, .result-backdrop',
  );
  const scope = dialog ?? document;

  scope.querySelectorAll('*').forEach((el) => {
    // Disabled controls are explicitly exempt from the WCAG contrast requirement, and greying them
    // out is how they say they are unavailable.
    if (el.closest('[disabled], [aria-disabled="true"]')) return;
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
      .trim();
    if (!text) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) return;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;

    const fgRaw = parse(cs.color);
    const bg = backdrop(el);
    if (!fgRaw || !bg.colour) return;
    // The element's own opacity fades its text against that backdrop too.
    const alpha = fgRaw.a * parseFloat(cs.opacity);
    const fg = over({ ...fgRaw, a: alpha }, bg.colour);

    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg.colour);
    if (r < need) {
      out.push({
        text: text.slice(0, 24),
        sel: (el.className && typeof el.className === 'string' ? el.className : el.tagName),
        ratio: Math.round(r * 100) / 100,
        need,
        size: Math.round(size),
        weight,
        colour: cs.color,
        behind: \`rgb(\${Math.round(bg.colour.r)}, \${Math.round(bg.colour.g)}, \${Math.round(bg.colour.b)})\`,
        approx: bg.approx || undefined,
      });
    }
  });
  return out;
})()
`;

async function audit(page: import('@playwright/test').Page, label: string) {
  // The theme lands on <html> from a React effect. Sampling before it settles reads a half-applied
  // palette and invents failures that do not exist.
  const theme = label.split(' ')[0];
  await page.waitForFunction((t) => (document.documentElement.dataset.theme ?? 'clean') === t, theme);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const rows = (await page.evaluate(AUDIT)) as Array<Record<string, unknown>>;
  if (rows.length === 0) return;
  console.log(`\n=== ${label}`);
  for (const r of rows) console.log('   ' + JSON.stringify(r));
}

test('contrast audit', async ({ page }) => {
  for (const theme of ['clean', 'neon', 'navy'] as const) {
    await openFreshApp(page);
    await page.evaluate((t) => localStorage.setItem('n02-theme-v1', t), theme);
    await page.reload();
    await page.waitForSelector('.mode-card');

    await audit(page, `${theme} top`);

    await openPracticeHub(page);
    await audit(page, `${theme} practice-hub`);

    await page.goto('/');
    await startCountUp(page, { players: 2 });
    await enterCountUpRound(page, 140);
    await audit(page, `${theme} countup-game`);
    for (let i = 0; i < 15; i += 1) await enterCountUpRound(page, 60);
    await audit(page, `${theme} countup-result`);

    await page.goto('/');
    await page.waitForSelector('.mode-card');
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await page.waitForSelector('.n01-game-shell');
    await enterGameScore(page, 100);
    await audit(page, `${theme} 01-game`);
    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await audit(page, `${theme} 01-menu`);
    await page.keyboard.press('Escape');

    await page.goto('/');
    await openPentathlon(page);
    await audit(page, `${theme} pent-setup`);

    await page.goto('/');
    await openSingleGame(page, 'CRICKET');
    await page.getByRole('button', { name: /を開始/ }).click();
    await page.waitForSelector('.pent-cricket-board');
    await audit(page, `${theme} cricket`);
  }
});
