// Shared helpers for the Cyber Quest specs (not a spec itself: run.sh only picks up *.spec.js).
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4012;
const URL = `http://localhost:${PORT}/cyber-quest/?debug=1`;
const SHOTS = process.env.SHOTS_DIR || null;

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const browser = await chromium.launch();
  // Service workers are blocked: their first-install claim() can reload the page mid-spec.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // A missing sprite or background shows up as a 4xx, not a console error.
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  page.on('dialog', (d) => d.accept());

  const ev = (f, a) => page.evaluate(f, a);
  const open = async () => {
    await page.goto(URL);
    await page.waitForFunction(() => window.__cyberQuest, null, { timeout: 5000 });
  };
  // Training Grounds is collapsed by default; mission and lab cards live inside it.
  const openGrounds = () => ev(() => { document.getElementById('grounds').open = true; });
  const screen = () => ev(() => window.__cyberQuest.state.screen);
  // The terminal opens full screen from a button; open it first if it's closed.
  const type = async (cmd) => {
    if (await page.isVisible('#ops-open')) await page.click('#ops-open');
    await page.fill('#ops-input', cmd); await page.press('#ops-input', 'Enter');
  };
  const feed = () => ev(() => document.getElementById('ops-feed').innerText);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  const noHScroll = async () => assert(!(await ev(() => document.documentElement.scrollWidth > innerWidth)), 'page scrolls horizontally');

  return { browser, page, errors, ev, open, openGrounds, screen, type, feed, shot, noHScroll };
}

module.exports = { launch, assert, sleep };
