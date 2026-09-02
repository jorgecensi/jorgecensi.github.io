// Proves the game simulates at a fixed rate independent of display refresh:
// replaces requestAnimationFrame with a setTimeout ticking at a controlled
// rate (30Hz and 120Hz), lets the real (non-debug-driven) game run for the
// same fixed wall-clock duration under each, and asserts the accumulated
// distance is close either way. Before the fixed-timestep accumulator, the
// simulation ran once per rAF callback, so a 120Hz display would have
// covered roughly 2x the distance of a 30Hz one in the same real time.
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4002;
const BASE = `http://localhost:${PORT}/auto-runner/`;
const RUN_MS = 1000; // stays well under the ~1.3s frame-80 obstacle gate at base speed

async function runAtRate(browser, hz) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // sw.js calls clients.claim() in its activate handler, which fires a
  // one-time controllerchange on a not-yet-controlled page — and index.html
  // reloads itself on that event. An unnoticed reload mid-measurement would
  // reset distance to 0 and silently corrupt the comparison, so track
  // navigations and fail loudly instead of guessing.
  let navCount = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navCount++; });

  // Installed before any page script runs, so the game's own loop() is
  // scheduled through this instead of the real display-synced rAF.
  await page.addInitScript((intervalMs) => {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), intervalMs);
  }, 1000 / hz);

  await page.goto(BASE + '?debug=1');
  await page.waitForTimeout(1000); // let the SW install/activate settle before timing anything
  navCount = 0; // discard navigations from initial load / SW-triggered reload

  await page.keyboard.press('d'); // real input path — starts the run, not debug-driven
  await page.waitForTimeout(RUN_MS);

  if (navCount > 0) throw new Error(`unexpected navigation during the ${hz}Hz measurement window`);

  const distance = await page.evaluate(() => window.__autoRunner.distance);
  const state = await page.evaluate(() => window.__autoRunner.state);
  await page.close();

  if (errors.length) throw new Error(`errors at ${hz}Hz: ` + errors.join(' | '));
  return { distance, state };
}

(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
  const browser = await chromium.launch();

  const slow = await runAtRate(browser, 30);
  const fast = await runAtRate(browser, 120);
  await browser.close();

  console.log('30Hz:', JSON.stringify(slow));
  console.log('120Hz:', JSON.stringify(fast));

  assert(slow.state === 'playing', '30Hz run should still be mid-run (before any obstacle), got ' + slow.state);
  assert(fast.state === 'playing', '120Hz run should still be mid-run (before any obstacle), got ' + fast.state);
  assert(slow.distance > 0 && fast.distance > 0, 'both runs advanced distance');

  const diff = Math.abs(fast.distance - slow.distance) / slow.distance;
  console.log('relative difference:', (diff * 100).toFixed(2) + '%');
  assert(diff < 0.05, `distance should match within 5% regardless of refresh rate, got ${(diff * 100).toFixed(1)}%`);

  console.log('ALL CHECKS PASSED');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
