// Shared helpers for the Elasto Mania specs.
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4003;
const BASE = `http://localhost:${PORT}/elastomania/`;

async function openGame() {
  const browser = await chromium.launch();
  // Block the service worker: its first-load clients.claim() reload would
  // otherwise land mid-spec and wipe the page state.
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1000, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '?debug=1');
  await page.waitForFunction(() => !!window.__elasto);
  return { browser, page, errors };
}

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };

module.exports = { openGame, assert, BASE };
