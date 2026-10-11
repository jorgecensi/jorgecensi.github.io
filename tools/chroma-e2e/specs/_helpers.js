// Shared helpers for the Chroma specs (not a spec itself: run.sh only picks up
// *.spec.js).
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4005;
const BASE = `http://localhost:${PORT}/chroma/`;

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };

async function launch() {
  // No user gesture in a headless run, so let the AudioContext start anyway.
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const open = async () => {
    await page.goto(BASE + '?debug=1');
    try {
      await page.waitForFunction(() => window.__chroma, null, { timeout: 5000 });
    } catch (e) {
      throw new Error('ASSERT FAILED: window.__chroma is not defined with ?debug=1');
    }
    // Let the service worker install so its claim() happens before we test.
    await page.waitForTimeout(800);
  };

  const state = () => page.evaluate(() => window.__chroma.state);

  // Feed steady tones into the analysers and wait until the chord settles.
  const listenTo = async (freqs, ms = 1500) => {
    await page.evaluate((f) => window.__chroma.playTones(f), freqs);
    await page.waitForTimeout(ms);
    return state();
  };

  return { browser, page, errors, open, state, listenTo };
}

function run(main) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

module.exports = { launch, run, assert, mtof, BASE };
