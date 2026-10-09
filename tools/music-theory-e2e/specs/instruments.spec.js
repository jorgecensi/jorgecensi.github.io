// The instrument picker: every sound is selectable, a synth plays without
// waiting for the piano samples, and the choice survives a reload and a
// progress reset.
const { launch, run, assert, PROGRESS_KEY } = require('./_helpers');

const IDS = ['piano', 'epiano', 'guitar', 'marimba', 'organ', 'strings', 'flute'];

run(async () => {
  const { browser, page, errors, open, reload, mt } = await launch();

  await open();
  await mt(() => window.__musicTheory.resetProgress());

  const options = await page.$$eval('#instrument-select option', os => os.map(o => o.value));
  assert(JSON.stringify(options) === JSON.stringify(IDS), 'picker lists every instrument, got ' + options.join(','));
  assert(await mt(() => window.__musicTheory.instrument) === 'piano', 'default instrument is piano');

  // Each synth plays a chord through the real playback path. Errors show up
  // in `errors` via pageerror, so a broken patch fails the run.
  for (const id of IDS.filter(i => i !== 'piano')) {
    await page.selectOption('#instrument-select', id);
    const now = await mt(() => window.__musicTheory.instrument);
    assert(now === id, 'selecting ' + id + ' switches the instrument, got ' + now);
    await mt(() => window.__musicTheory.playChord([60, 64, 67]));
    await page.waitForTimeout(60);
    const hidden = await page.evaluate(() => document.getElementById('keyboard-loading').classList.contains('hidden'));
    assert(hidden, 'keyboard loading overlay hidden for ' + id);
  }

  // Piano comes back.
  await page.selectOption('#instrument-select', 'piano');
  assert(await mt(() => window.__musicTheory.instrument) === 'piano', 'switching back to piano works');

  // The choice is saved in the settings and restored on reload.
  await page.selectOption('#instrument-select', 'marimba');
  await page.waitForTimeout(50);
  const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PROGRESS_KEY));
  assert(stored.settings && stored.settings.instrument === 'marimba', 'settings.instrument saved as marimba');
  await reload();
  assert(await mt(() => window.__musicTheory.instrument) === 'marimba', 'marimba restored after reload');
  assert(await page.inputValue('#instrument-select') === 'marimba', 'picker shows marimba after reload');

  // Reset clears progress but keeps the sound choice.
  await mt(() => window.__musicTheory.resetProgress());
  await reload();
  assert(await mt(() => window.__musicTheory.instrument) === 'marimba', 'instrument kept through progress reset');

  // A stored value that isn't a known instrument falls back to piano.
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, settings: { keyContext: false, instrument: 'kazoo' } })), PROGRESS_KEY);
  await reload();
  assert(await mt(() => window.__musicTheory.instrument) === 'piano', 'unknown saved instrument falls back to piano');

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));

  console.log('ALL CHECKS PASSED');
  await browser.close();
});
