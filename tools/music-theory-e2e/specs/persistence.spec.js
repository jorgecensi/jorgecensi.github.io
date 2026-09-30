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
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, learn: { unitIdx: 99, units: {} } })), PROGRESS_KEY);
  const lastIdx = await mt(() => window.__musicTheory.units.length - 1);
  const clamped = await mt(() => window.__musicTheory.progress.learn.unitIdx);
  assert(clamped === lastIdx, 'unitIdx 99 loads as the last unit (' + lastIdx + '), got ' + clamped);

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));

  console.log('ALL CHECKS PASSED');
  await browser.close();
});
