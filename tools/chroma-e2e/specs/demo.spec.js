// The built-in demo song drives every layer: beats, drum kicks, a key, and
// all three visual modes render without errors. Saves screenshots.
const path = require('path');
const { launch, run, assert } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open, state } = await launch();
  await open();
  const shots = process.env.SHOTS_DIR;

  if (shots) await page.screenshot({ path: path.join(shots, 'chroma-start.png') });
  await page.click('#btn-demo');
  await page.waitForTimeout(9000);

  let s = await state();
  assert(s.source === 'demo', `source should be demo, got ${s.source}`);
  assert(s.noteOns >= 8, `expected notes to register, got ${s.noteOns} note-ons`);
  assert(s.kicks >= 4, `expected drum kicks to register, got ${s.kicks}`);
  // The demo is in C major. Nine seconds in, the closely related keys (one
  // step round the circle of fifths, or their relative minors) are fair.
  const near = ['C major', 'G major', 'F major', 'A minor', 'E minor', 'D minor'];
  assert(near.includes(s.key), `demo is in or next to C major, got key ${s.key}`);
  assert(s.chord, 'a chord or note is shown while the demo plays');
  assert(!(await page.locator('#start').isVisible()), 'start overlay closes when the demo begins');
  assert(await page.locator('#hud').evaluate((e) => !e.classList.contains('off')), 'HUD is visible');
  console.log(`ok  demo: ${s.noteOns} note-ons, drums ${JSON.stringify(s.drums)}, ${s.kicks} kicks, key ${s.key}, chord ${s.chord}`);

  for (const mode of ['aurora', 'wheel', 'wash', 'hands']) {
    await page.evaluate((m) => window.__chroma.setMode(m), mode);
    await page.waitForTimeout(1200);
    if (shots) await page.screenshot({ path: path.join(shots, `chroma-${mode}.png`) });
  }

  // Stopping returns to the start screen.
  await page.mouse.move(100, 100);
  await page.click('#btn-listen');
  s = await state();
  assert(s.source === null, 'stop clears the source');
  assert(await page.locator('#start').isVisible(), 'start overlay is back after stopping');

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
