// Drives the game entirely through the ?debug=1 manual-step API for a long,
// fast, deterministic run and asserts the state machine never does anything
// invalid, no console/page errors occur, and every authored chunk validated
// cleanly on load.
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4002;
const BASE = `http://localhost:${PORT}/auto-runner/`;
const VALID_STATES = new Set(['waiting', 'playing', 'paused', 'resuming', 'gameover']);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  const logs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    logs.push(m.text());
    if (m.type() === 'error') errors.push(m.text());
  });

  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };

  await page.goto(BASE + '?debug=1');
  await page.waitForTimeout(300);

  assert(await page.evaluate(() => !!window.__autoRunner), 'debug hook exposed on window');

  assert(
    logs.some((l) => l.includes('all chunks validated OK')),
    'every authored chunk validated at load — got: ' + JSON.stringify(logs)
  );
  assert(
    !logs.some((l) => l.includes('chunk validation failure')),
    'no chunk validation failures — got: ' + JSON.stringify(logs)
  );

  // Naive bot: hold jump whenever a ground hazard is close ahead, release
  // otherwise. It doesn't need to be good — the point is to exercise
  // start/die/revive/restart transitions many times over a long run, not to
  // survive indefinitely.
  const result = await page.evaluate(() => {
    const api = window.__autoRunner;
    const statesSeen = new Set();
    let maxDistance = 0;
    let sawPlaying = false;
    let sawGameover = false;

    for (let step = 0; step < 30 * 60; step++) { // 30 simulated seconds at 60 steps/sec
      statesSeen.add(api.state);
      if (api.state === 'playing') sawPlaying = true;
      if (api.state === 'gameover') sawGameover = true;
      maxDistance = Math.max(maxDistance, api.distance);

      const near = api.obstacles.some((o) => !o.isFloat && o.x > 30 && o.x < 240);
      api.setInput(0, near);
      api.setInput(1, near);

      // Any input works to progress waiting → playing and gameover → waiting,
      // so a synthetic "tap" (rising edge) keeps the run cycling instead of
      // stalling forever on a screen that needs a fresh press.
      if (step % 5 === 0) { api.setInput(0, true); api.setInput(1, true); }

      api.stepOnce();
    }

    return { statesSeen: [...statesSeen], maxDistance, sawPlaying, sawGameover };
  });

  console.log('states seen:', result.statesSeen.join(', '));
  console.log('max distance reached:', result.maxDistance.toFixed(1) + 'm');

  for (const s of result.statesSeen) {
    assert(VALID_STATES.has(s), 'unexpected state in state machine: ' + s);
  }
  assert(result.sawPlaying, 'the run actually entered "playing" at least once');
  assert(result.sawGameover, 'the run reached "gameover" at least once over 30s of play');
  assert(result.maxDistance > 0, 'distance advanced during the run');

  if (errors.length) {
    throw new Error('console/page errors during run: ' + errors.join(' | '));
  }

  console.log('ALL CHECKS PASSED');
  await browser.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
