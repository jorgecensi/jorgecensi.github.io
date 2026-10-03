// Free-play Quiz level now persists across reloads, and the progress blob in
// localStorage is well-formed.
const { launch, run, assert, PROGRESS_KEY } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open, reload, mt } = await launch();

  await open();
  await mt(() => window.__musicTheory.resetProgress());
  await mt(() => window.__musicTheory.switchMode('quiz'));
  assert(await page.locator('#panel-quiz').isVisible(), '#panel-quiz visible after switchMode("quiz")');
  assert(await mt(() => window.__musicTheory.state.quizLevel) === 1, 'quiz level starts at 1');

  await page.click('#quiz-level-btn'); // cycles 1 -> 2
  assert(await mt(() => window.__musicTheory.state.quizLevel) === 2, 'one click on #quiz-level-btn sets quizLevel 2');
  assert(/Level 2/.test(await page.textContent('#quiz-level-btn')), '#quiz-level-btn text mentions "Level 2"');

  await reload();
  await mt(() => window.__musicTheory.switchMode('quiz'));
  const level = await mt(() => window.__musicTheory.state.quizLevel);
  assert(level === 2, 'state.quizLevel === 2 after reload, got ' + level);
  const label = await page.textContent('#quiz-level-btn');
  assert(/Level 2/.test(label), '#quiz-level-btn text contains "Level 2" after reload, got "' + label + '"');

  const stored = await page.evaluate((k) => localStorage.getItem(k), PROGRESS_KEY);
  assert(stored !== null, 'localStorage["' + PROGRESS_KEY + '"] exists');
  let parsed;
  try { parsed = JSON.parse(stored); } catch (e) { throw new Error('ASSERT FAILED: stored progress is not valid JSON: ' + stored); }
  assert(parsed.v === 1, 'stored progress has v === 1, got ' + parsed.v);
  assert(parsed.quiz && parsed.quiz.level === 2, 'stored progress quiz.level === 2, got ' + JSON.stringify(parsed.quiz));

  // A saved unitIdx past the last unit keeps the furthest unit unlocked
  // rather than dropping back to unit 1.
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, learn: { unitIdx: 99, layout: 2, units: {} } })), PROGRESS_KEY);
  const lastIdx = await mt(() => window.__musicTheory.units.length - 1);
  const clamped = await mt(() => window.__musicTheory.progress.learn.unitIdx);
  assert(clamped === lastIdx, 'unitIdx 99 loads as the last unit (' + lastIdx + '), got ' + clamped);

  // Progress saved against the original 8-unit order (no `layout` field) is
  // mapped by unit id, and the learner is sent to the first unfinished unit
  // before it: the new 2nds unit, not whatever now sits at the old index.
  const ids = await mt(() => window.__musicTheory.units.map(u => u.id));
  const done = (id) => ({ step: 'done', hear: { correct: 10, total: 10, recent: [] }, play: { correct: 10, total: 10, recent: [] } });
  const legacy = (unitIdx, doneIds) => page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)),
    [PROGRESS_KEY, { v: 1, learn: { unitIdx, units: Object.fromEntries(doneIds.map(id => [id, done(id)])) } }]);
  const loadedIdx = () => mt(() => window.__musicTheory.progress.learn.unitIdx);

  // Was on "all-intervals" (old index 4) with the first four units done.
  await legacy(4, ['pulse', 'perfect-intervals', 'thirds', 'major-minor-chords']);
  let idx = await loadedIdx();
  assert(ids[idx] === 'seconds', 'old index 4 with units 1-4 done resumes at the new 2nds unit, got ' + ids[idx]);

  // Was on "dominant-7th" (old index 6) with everything before it done.
  await legacy(6, ['pulse', 'perfect-intervals', 'thirds', 'major-minor-chords', 'all-intervals', 'major-scale']);
  idx = await loadedIdx();
  assert(ids[idx] === 'seconds', 'old index 6 resumes at the first new unit it skipped, got ' + ids[idx]);
  await reload();
  const locked = await page.evaluate(() => [...document.querySelectorAll('.learn-unit')]
    .filter(b => b.disabled).map(b => b.dataset.unit));
  assert(!locked.includes('major-scale') && !locked.includes('all-intervals'),
    'units already finished stay open past the frontier, locked: ' + locked.join(','));
  assert(locked.includes('dominant-7th'), 'unfinished units past the frontier stay locked, locked: ' + locked.join(','));

  // Finishing the new units moves the frontier past the ones already done.
  for (const id of ['seconds', 'sixths', 'sevenths']) {
    await page.evaluate(([k, uid]) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.learn.units[uid] = { step: 'why', hear: { correct: 10, total: 10, recent: [] }, play: { correct: 10, total: 10, recent: [] } };
      localStorage.setItem(k, JSON.stringify(d));
    }, [PROGRESS_KEY, id]);
  }
  await reload();
  // Walk the three new units' why steps in order through the UI.
  for (const id of ['seconds', 'sixths', 'sevenths']) {
    await page.locator(`.learn-unit[data-unit="${id}"]`).click();
    assert(await mt(() => window.__musicTheory.gotIt()), 'gotIt() works on the ' + id + ' why step');
  }
  idx = await loadedIdx();
  assert(ids[idx] === 'dominant-7th', 'after the new units the frontier skips done units to dominant-7th, got ' + ids[idx]);

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));

  console.log('ALL CHECKS PASSED');
  await browser.close();
});
