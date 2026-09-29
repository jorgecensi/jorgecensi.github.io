// Drives the game through the REAL input and timing path (keyboard events,
// requestAnimationFrame loop) — never calls step(), which would hand the
// clock to the test. Checks the original-game key layout and that the
// fixed-step loop runs physics at 60 steps per wall-clock second.
const { openGame, assert } = require('./lib');

(async () => {
  const { browser, page, errors } = await openGame();
  await page.keyboard.press('Space'); // start level 1
  await page.waitForFunction(() => window.__elasto.state === 'playing');
  const snap = () => page.evaluate(() => window.__elasto.snapshot());

  // Fixed step: ~60 physics steps per second of wall time.
  const t0 = await snap();
  const w0 = Date.now();
  await page.waitForTimeout(1500);
  const t1 = await snap();
  const rate = (t1.playSteps - t0.playSteps) / ((Date.now() - w0) / 1000);
  console.log('steps/sec', rate.toFixed(1));
  assert(rate > 45 && rate < 70, 'physics runs at ~60 steps/sec, got ' + rate);
  assert(t1.facing === 1, 'Space that started the level did not also turn the bike');

  // Up arrow = gas.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowUp');
  const t2 = await snap();
  console.log('moved', (t2.chassis.x - t1.chassis.x).toFixed(0), 'px');
  assert(t2.chassis.x - t1.chassis.x > 60, 'ArrowUp drives the bike forward');

  // Down arrow = brake.
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(1200);
  const t3 = await snap();
  await page.keyboard.up('ArrowDown');
  assert(Math.abs(t3.chassis.vx) < 1.5, 'ArrowDown brakes to a stop, vx=' + t3.chassis.vx);

  // Right arrow = clockwise volt (one impulse per press).
  const a0 = (await snap()).chassis.spin;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
  const a1 = (await snap()).chassis.spin;
  console.log('volt spin', a0.toFixed(3), '->', a1.toFixed(3));
  assert(a1 - a0 > 0.01, 'ArrowRight volts clockwise');

  // Space = turn around.
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await page.waitForTimeout(50);
  assert((await snap()).facing === -1, 'Space turns the bike around');

  // Timer HUD follows simulation time — no page errors throughout.
  assert(errors.length === 0, 'no page errors: ' + errors.join('\n'));
  await browser.close();
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
