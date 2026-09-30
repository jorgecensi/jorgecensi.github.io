// Shared helpers for the Music Theory specs (not a spec itself: run.sh only
// picks up *.spec.js).
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4003;
const BASE = `http://localhost:${PORT}/music-theory/`;
const PROGRESS_KEY = 'music-theory-progress-v1';

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };

// The piano samples come from tonejs.github.io, which the sandbox network may
// block. A failed sample load is expected and must not count as an error.
const isSampleNoise = (text) => /samples?|salamander|Failed to load|tonejs\.github\.io|ERR_/i.test(text);

async function launch() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !isSampleNoise(m.text())) errors.push(m.text());
  });

  // sw.js calls clients.claim(), and index.html reloads itself on the
  // resulting controllerchange. Wait for navigations to go quiet before
  // driving anything, or the reload can destroy an in-flight page.evaluate().
  let lastNav = Date.now();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) lastNav = Date.now(); });
  const settle = async (quietMs = 1000, timeout = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (Date.now() - lastNav > quietMs) return;
      await page.waitForTimeout(150);
    }
  };

  // Load ?debug=1, wait for the debug API (clear failure message if it never
  // appears), then let any SW reload finish and wait for the API again.
  const open = async () => {
    await page.goto(BASE + '?debug=1');
    await waitForApi();
  };
  const waitForApi = async () => {
    try {
      await page.waitForFunction(() => window.__musicTheory, null, { timeout: 5000 });
    } catch (e) {
      throw new Error('ASSERT FAILED: window.__musicTheory is not defined with ?debug=1 (debug API from the contract is missing)');
    }
    await settle();
    await page.waitForFunction(() => window.__musicTheory);
  };
  const reload = async () => { await page.reload(); await waitForApi(); };

  // Evaluate a snippet against the debug API.
  const mt = (fn, arg) => page.evaluate(fn, arg);

  return { browser, page, errors, assert, open, reload, mt, settle };
}

function run(main) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { launch, run, assert, BASE, PROGRESS_KEY };
