// Shared helpers for the Battle of Winterfell specs (not a spec itself: run.sh only picks up *.spec.js).
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4016;
const URL = `http://localhost:${PORT}/winterfell/?debug=1`;
const SHOTS = process.env.SHOTS_DIR || null;
const STORE_KEY = 'winterfell-progress-v1';
const HZ = 60;   // the simulation's fixed step rate

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Console noise that is not a game fault: the blocked service worker, and software-GL driver chatter.
const IGNORE = [/Service Worker registration blocked by Playwright/i, /GL Driver Message/i, /GPU stall/i, /WebGL.*performance/i,
  /swiftshader/i, /Automatic fallback to software WebGL/i];

async function launch() {
  // SwiftShader gives headless Chromium a (software) WebGL context; without it three.js cannot start.
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  // Service workers are blocked: a first-install claim() could reload the page mid-spec.
  // A small 1x viewport keeps software rendering cheap.
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!IGNORE.some((re) => re.test(text))) errors.push('console: ' + text);
  });
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url() + ' ' + ((r.failure() || {}).errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });

  const ev = (f, a) => page.evaluate(f, a);
  const open = async () => {
    await page.goto(URL);
    await page.waitForFunction(() => window.__winterfell, null, { timeout: 15000 });
  };
  const state = () => ev(() => window.__winterfell.state);
  const start = (act) => ev((a) => window.__winterfell.start(a), act);
  const step = (n) => ev((k) => window.__winterfell.step(k), n);
  const saved = () => ev((k) => JSON.parse(localStorage.getItem(k) || 'null'), STORE_KEY);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // Number of distinct colours the WebGL canvas shows, with every DOM overlay hidden.
  // The screenshot is decoded in the page (no PNG library needed), sampled every 4th pixel.
  const canvasColours = async () => {
    const style = await page.addStyleTag({ content: '#hud, #touch, .screen, #fade { visibility: hidden !important; }' });
    const png = await page.screenshot();
    await style.evaluate((el) => el.remove());
    return ev(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) {
        const i = (y * c.width + x) * 4;
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      return seen.size;
    }, png.toString('base64'));
  };

  return { browser, page, errors, ev, open, state, start, step, saved, shot, canvasColours };
}

// Run a spec body, print the result and set the exit code.
async function run(name, body) {
  const t0 = Date.now();
  const h = await launch();
  let failed = false;
  try {
    await body(h);
    assert(h.errors.length === 0, 'page errors:\n  ' + h.errors.join('\n  '));
    console.log(`${name}: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed = true;
    console.error(e.message || e);
    try { console.error('state: ' + JSON.stringify(await h.state())); } catch (_) { /* page gone */ }
    try { await h.shot(name + '-fail'); } catch (_) { /* page gone */ }
  }
  await h.browser.close();
  process.exit(failed ? 1 : 0);
}

module.exports = { launch, run, assert, sleep, STORE_KEY, HZ };
