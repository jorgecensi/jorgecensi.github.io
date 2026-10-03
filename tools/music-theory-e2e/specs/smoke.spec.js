// App loads with ?debug=1, exposes window.__musicTheory, opens on the Learn
// tab with the 11 units in order, and tab switching works.
const { launch, run, assert } = require('./_helpers');

const UNIT_IDS = [
  'pulse', 'perfect-intervals', 'thirds', 'major-minor-chords',
  'seconds', 'sixths', 'sevenths', 'all-intervals',
  'major-scale', 'dominant-7th', 'minor-and-modes',
];

run(async () => {
  const { browser, page, errors, open, mt } = await launch();

  await open();
  assert(await mt(() => !!window.__musicTheory), 'window.__musicTheory present with ?debug=1');

  // Learn is the first tab and the one active on first load.
  const activeMode = await page.evaluate(() => {
    const t = document.querySelector('.tab.active');
    return t && t.dataset.mode;
  });
  assert(activeMode === 'learn', 'Learn tab is the active tab on first load, got: ' + activeMode);
  assert(await page.locator('#panel-learn').isVisible(), '#panel-learn is visible on first load');
  assert(await mt(() => window.__musicTheory.state.mode) === 'learn', 'state.mode is "learn" on first load');

  const ids = await mt(() => window.__musicTheory.units.map((u) => u.id));
  assert(JSON.stringify(ids) === JSON.stringify(UNIT_IDS),
    'units are the 8 contract ids in order, got: ' + JSON.stringify(ids));

  await mt(() => window.__musicTheory.switchMode('scales'));
  assert(await page.locator('#panel-scales').isVisible(), 'switchMode("scales") shows #panel-scales');
  assert(!(await page.locator('#panel-learn').isVisible()), '#panel-learn hidden after switching to scales');

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));

  console.log('ALL CHECKS PASSED');
  await browser.close();
});
