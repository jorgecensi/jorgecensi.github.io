// Smoke: the page loads clean, the menu shows, Begin starts act 1, WebGL draws a scene, pause and resume work.
const { run, assert } = require('./_helpers');

run('smoke', async ({ page, open, state, canvasColours, shot }) => {
  await open();

  // Menu
  assert(await page.isVisible('#menu'), 'menu is not visible on load');
  assert(await page.isVisible('#btn-start'), 'Begin button is not visible');
  assert(!(await page.isVisible('#btn-continue')), 'Continue shows on a fresh save');
  assert((await state()).mode === 'menu', 'mode is not "menu" on load');
  const menuColours = await canvasColours();
  assert(menuColours > 20, `the menu backdrop looks flat (${menuColours} distinct colours)`);

  // Begin, through the real button
  await page.click('#btn-start');
  let s = await state();
  assert(s.mode === 'play' && s.act === 1 && s.phase === 'muster', 'Begin did not start act 1 muster: ' + JSON.stringify(s));
  assert(s.mounted === true, 'act 1 does not start on horseback');
  assert(s.hp === 100, 'act 1 does not start at 100 hp');
  assert(!(await page.isVisible('#menu')), 'menu still visible after Begin');
  assert(await page.isVisible('#hud'), 'HUD is not visible while playing');

  // The canvas renders a scene, not one flat colour. Let a few real frames go by first.
  await page.waitForTimeout(500);
  const colours = await canvasColours();
  await shot('smoke-play');
  assert(colours > 20, `the canvas looks flat while playing (${colours} distinct colours)`);

  // The real-time loop is simulating (no step() call was made on this page).
  await page.waitForFunction(() => window.__winterfell.state.t > 0.2, null, { timeout: 10000 });

  // Escape pauses, the Resume button resumes
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__winterfell.state.mode === 'paused', null, { timeout: 3000 });
  assert(await page.isVisible('#paused'), 'pause screen is not visible after Escape');
  const t0 = (await state()).t;
  await page.waitForTimeout(300);
  assert((await state()).t === t0, 'the simulation keeps running while paused');
  await page.click('#btn-resume');
  s = await state();
  assert(s.mode === 'play', 'Resume did not return to play: ' + s.mode);
  assert(!(await page.isVisible('#paused')), 'pause screen still visible after Resume');
  await page.waitForFunction((t) => window.__winterfell.state.t > t, t0, { timeout: 10000 });
});
