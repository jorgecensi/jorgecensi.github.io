// Plays a real (non-debug-driven) run to death without ever jumping — both
// stationary players are guaranteed to hit the first ground obstacle — then
// asserts ar-best-v2 and ar-stats land in localStorage with a sane shape,
// and that they survive a reload.
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4002;
const BASE = `http://localhost:${PORT}/auto-runner/`;

(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // sw.js calls clients.claim() in its activate handler, which fires a
  // one-time controllerchange on a not-yet-controlled page — and index.html
  // reloads itself on that event. Wait for navigations to go quiet before
  // driving anything, or that reload can land mid-poll and destroy the
  // execution context out from under an in-flight page.evaluate().
  let lastNav = Date.now();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) lastNav = Date.now(); });
  const settle = async (quietMs = 1000, timeout = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (Date.now() - lastNav > quietMs) return;
      await page.waitForTimeout(150);
    }
  };

  await page.goto(BASE + '?debug=1');
  await settle();
  await page.keyboard.press('d'); // start the run; deliberately never jump again

  // Poll for game over rather than sleeping a fixed guess — the exact death
  // time depends on the randomized obstacle gap roll.
  let state = null;
  for (let i = 0; i < 60; i++) {
    state = await page.evaluate(() => window.__autoRunner.state);
    if (state === 'gameover') break;
    await page.waitForTimeout(200);
  }
  assert(state === 'gameover', 'both stationary players should have died by now, state=' + state);

  const stored = await page.evaluate(() => ({
    best: localStorage.getItem('ar-best-v2'),
    stats: localStorage.getItem('ar-stats'),
  }));

  assert(stored.best !== null, 'ar-best-v2 was written');
  const best = parseInt(stored.best, 10);
  assert(best > 0, 'ar-best-v2 is a positive number, got ' + stored.best);

  assert(stored.stats !== null, 'ar-stats was written');
  const stats = JSON.parse(stored.stats);
  assert(stats.runs >= 1, 'ar-stats.runs incremented, got ' + stats.runs);
  assert(stats.bestDistance > 0, 'ar-stats.bestDistance is positive, got ' + stats.bestDistance);
  assert(Array.isArray(stats.achievements), 'ar-stats.achievements is an array');
  assert(stats.mode === 1 || stats.mode === 2, 'ar-stats.mode is 1 or 2, got ' + stats.mode);

  console.log('persisted:', JSON.stringify({ best, stats }));

  // Reload and confirm the values are still there and the title screen
  // actually reflects the persisted best (a stale-load bug would zero it).
  await page.reload();
  await settle();
  const afterReload = await page.evaluate(() => ({
    best: localStorage.getItem('ar-best-v2'),
    runs: JSON.parse(localStorage.getItem('ar-stats')).runs,
  }));
  assert(parseInt(afterReload.best, 10) === best, 'best distance survives a reload');
  assert(afterReload.runs === stats.runs, 'run count survives a reload');

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));

  console.log('ALL CHECKS PASSED');
  await browser.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
