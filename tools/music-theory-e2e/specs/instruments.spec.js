// Instruments: every sample set loads and plays, Learn mixes random
// instruments that can reach each question's notes, Quiz and the explore tabs
// follow the picker, and the choices survive a reload and a progress reset.
const { launch, run, assert, PROGRESS_KEY } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open, reload, mt } = await launch();

  await open();
  await mt(() => window.__musicTheory.resetProgress());

  const ids = await mt(() => window.__musicTheory.instrumentIds);
  assert(ids.length === 21, 'piano, electric piano and 19 sampled instruments, got ' + ids.length);
  const options = await page.$$eval('#instrument-select option', os => os.map(o => o.value));
  assert(options[0] === 'random', 'picker starts with Random, got ' + options[0]);
  assert(JSON.stringify(options.slice(1)) === JSON.stringify(ids), 'picker lists every instrument');
  // (The app opens on Learn, which already mixes, so check the saved choice.)
  assert(await mt(() => window.__musicTheory.progress.settings.instrument) === 'piano', 'default instrument is piano');
  assert(await page.inputValue('#instrument-select') === 'piano', 'picker shows piano by default');
  assert(await mt(() => window.__musicTheory.progress.settings.learnMix) === true, 'Learn mixes instruments by default');

  // Every self-hosted sample set loads (a missing or misnamed file fails it)
  // and plays a chord through the real playback path.
  for (const id of ids.filter(i => i !== 'piano')) {
    const ok = await mt((i) => window.__musicTheory.loadInstrument(i), id);
    assert(ok, id + ' samples load');
    await page.selectOption('#instrument-select', id);
    assert(await mt(() => window.__musicTheory.instrument) === id, 'selecting ' + id + ' switches to it');
    await mt(() => window.__musicTheory.playChord([60, 64, 67]));
    const hidden = await page.evaluate(() => document.getElementById('keyboard-loading').classList.contains('hidden'));
    assert(hidden, 'loading overlay hidden once ' + id + ' is ready');
  }

  // Learn with "Mix instruments": with everything loaded, rounds change sound,
  // and each pick can reach every note the question plays.
  // (Unit 1 is rhythm only, so unlock unit 2's intervals.)
  const pulseDone = { step: 'done', hear: { correct: 10, total: 10, recent: [] }, play: { correct: 0, total: 0, recent: [] } };
  await page.evaluate(([k, u]) => localStorage.setItem(k, JSON.stringify({ v: 1, learn: { unitIdx: 1, layout: 2, units: { pulse: u } } })),
    [PROGRESS_KEY, pulseDone]);
  await reload();
  for (const id of ids.filter(i => i !== 'piano')) await mt((i) => window.__musicTheory.loadInstrument(i), id);
  await page.selectOption('#instrument-select', 'violin');
  await mt(() => window.__musicTheory.switchMode('learn'));
  await page.locator('.learn-unit[data-unit="perfect-intervals"]').click();
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const r = await mt(() => {
      const t = window.__musicTheory;
      const q = t.currentQuestion();
      return { inst: t.instrument, range: t.instrumentRange(t.instrument), midis: q ? q.midis : null,
               label: document.getElementById('learn-instrument').textContent };
    });
    assert(r.midis, 'round ' + i + ' has a question');
    assert(r.midis.every(m => m >= r.range[0] && m <= r.range[1]),
      `${r.inst} [${r.range}] reaches the question notes ${r.midis}`);
    assert(r.label.length > 0, 'Learn panel names the instrument');
    seen.add(r.inst);
    await mt(() => window.__musicTheory.answerCorrect());
    await page.waitForTimeout(40);
  }
  assert(seen.size >= 4, 'Learn rounds use several instruments, got ' + [...seen].join(','));

  // Explore tabs go back to the picker's instrument.
  await mt(() => window.__musicTheory.switchMode('chords'));
  assert(await mt(() => window.__musicTheory.instrument) === 'violin', 'Chords tab plays the picked violin');

  // Quiz follows the picker...
  await mt(() => window.__musicTheory.switchMode('quiz'));
  assert(await mt(() => window.__musicTheory.instrument) === 'violin', 'Quiz rounds use the picked violin');

  // ...unless the picker is on Random.
  await page.selectOption('#instrument-select', 'random');
  const quizSeen = new Set();
  for (let i = 0; i < 8; i++) {
    await mt(() => window.__musicTheory.switchMode('quiz'));   // starts a fresh round
    quizSeen.add(await mt(() => window.__musicTheory.instrument));
  }
  assert(quizSeen.size >= 3, 'Random picker varies Quiz rounds, got ' + [...quizSeen].join(','));

  // With mixing off, Learn uses the picked instrument.
  await page.selectOption('#instrument-select', 'cello');
  await mt(() => window.__musicTheory.setLearnMix(false));
  await mt(() => window.__musicTheory.switchMode('learn'));
  await page.locator('.learn-unit[data-unit="perfect-intervals"]').click();
  assert(await mt(() => window.__musicTheory.instrument) === 'cello', 'unmixed Learn uses the picked cello');

  // Both choices are saved, restored on reload, and kept through a reset.
  const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PROGRESS_KEY));
  assert(stored.settings.instrument === 'cello' && stored.settings.learnMix === false,
    'settings saved: ' + JSON.stringify(stored.settings));
  await reload();
  await mt(() => window.__musicTheory.switchMode('scales'));
  assert(await mt(() => window.__musicTheory.instrument) === 'cello', 'cello restored after reload');
  assert(await page.inputValue('#instrument-select') === 'cello', 'picker shows cello after reload');
  assert(!(await page.isChecked('#learn-mix')), 'Mix instruments stays off after reload');
  await mt(() => window.__musicTheory.resetProgress());
  await reload();
  assert(await mt(() => window.__musicTheory.progress.settings.instrument) === 'cello', 'instrument kept through reset');

  // An unknown saved value falls back to piano.
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, settings: { instrument: 'kazoo' } })), PROGRESS_KEY);
  await reload();
  assert(await page.inputValue('#instrument-select') === 'piano', 'unknown saved instrument falls back to piano');

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));

  console.log('ALL CHECKS PASSED');
  await browser.close();
});
