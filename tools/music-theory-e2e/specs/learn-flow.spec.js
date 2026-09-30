// Drives the Learn path through the debug API: unit 1 (hear -> why, no play
// step), the >=8-of-last-10 pass threshold in unit 2's hear step, unit 2's
// play step, then a reload to prove progress persists and the Learn panel
// marks unit 3 (thirds) as the active unit.
const { launch, run, assert, PROGRESS_KEY } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open, reload, mt } = await launch();

  await open();
  await mt(() => window.__musicTheory.resetProgress());
  await mt(() => window.__musicTheory.switchMode('learn'));

  const unitState = (id) => mt((uid) => window.__musicTheory.progress.learn.units[uid] || null, id);
  const unitIdx = () => mt(() => window.__musicTheory.progress.learn.unitIdx);

  // answerCorrect()/answerWrong() advance after 0 ms (a setTimeout), so give
  // that tick a moment. A wrong answer may instead wait on a visible "Next"
  // button; click it if so, so the next call has a fresh question.
  const answer = async (kind, unitId, phase) => {
    const before = ((await unitState(unitId)) || {})[phase];
    const beforeTotal = before ? before.total : 0;
    await mt((k) => (k === 'correct' ? window.__musicTheory.answerCorrect() : window.__musicTheory.answerWrong()), kind);
    await page.waitForTimeout(30);
    const next = page.locator('#panel-learn button', { hasText: /^\s*next/i }).first();
    if (await next.count() && await next.isVisible()) { await next.click(); await page.waitForTimeout(30); }
    const after = (await unitState(unitId))[phase];
    // If the step just passed, a fresh phase object may have replaced the old one.
    return { total: after.total, correct: after.correct, recent: after.recent, beforeTotal };
  };

  // ── Unit 1: pulse (hear -> why, no play step) ──
  assert(await unitIdx() === 0, 'fresh progress starts at unitIdx 0');
  let n = 0;
  while ((await unitState('pulse') || { step: 'hear' }).step === 'hear') {
    n++;
    assert(n <= 12, 'unit 1 hear step should pass within 12 correct answers, still on hear after ' + n);
    await mt(() => window.__musicTheory.answerCorrect());
    await page.waitForTimeout(30);
  }
  assert(n >= 10, 'hear step cannot pass in fewer than 10 answers, passed after ' + n);
  console.log('unit 1 hear passed after', n, 'correct answers');
  let s = await unitState('pulse');
  assert(s.step === 'why', 'unit 1 has no play step: expected step "why", got "' + s.step + '"');

  await mt(() => window.__musicTheory.gotIt());
  assert(await unitIdx() === 1, 'gotIt() advances unitIdx to 1, got ' + await unitIdx());
  const unit2 = await mt(() => window.__musicTheory.units[1].id);
  assert(unit2 === 'perfect-intervals', 'units[1].id is perfect-intervals, got ' + unit2);
  s = await unitState('pulse');
  assert(s.step === 'done', 'unit 1 is marked done after gotIt(), got "' + s.step + '"');

  // ── Unit 2 hear: threshold is total >= 10 AND >= 8 correct in the last 10 ──
  // Sequence W W W then C...: after answer 10 the window holds 7 correct (not
  // enough); after answer 11 it holds 8, so the step passes there (allow up
  // to 13 in case the implementation counts differently, but never earlier).
  const U2 = 'perfect-intervals';
  for (let i = 0; i < 3; i++) await answer('wrong', U2, 'hear');
  let total = 3;
  let passedAt = null;
  for (let i = 0; i < 10; i++) {
    const r = await answer('correct', U2, 'hear');
    total = r.total;
    const step = (await unitState(U2)).step;
    if (step !== 'hear') { passedAt = total; break; }
    assert(total < 11, 'still on hear at total ' + total + ' although last-10 window has >= 8 correct');
  }
  assert(passedAt !== null, 'unit 2 hear step never passed after 3 wrong + 10 correct');
  assert(passedAt >= 11 && passedAt <= 13,
    'hear passed at total=' + passedAt + ', expected 11 (window = 2 wrong + 8 correct) and never before 10 answers');
  s = await unitState(U2);
  const hear = s.hear;
  assert(hear.recent.length === 10, 'recent window has length 10, got ' + hear.recent.length);
  const recentCorrect = hear.recent.reduce((a, b) => a + b, 0);
  assert(recentCorrect >= 8, 'window held >= 8 correct when passing, got ' + recentCorrect);
  assert(s.step === 'play', 'unit 2 has a play step: expected "play" after hear, got "' + s.step + '"');
  console.log('unit 2 hear passed at total', passedAt, 'recent', JSON.stringify(hear.recent));

  // ── Unit 2 play ──
  n = 0;
  while ((await unitState(U2)).step === 'play') {
    n++;
    assert(n <= 12, 'unit 2 play step should pass within 12 correct answers, still on play after ' + n);
    await mt(() => window.__musicTheory.answerCorrect());
    await page.waitForTimeout(30);
  }
  assert(n >= 10, 'play step cannot pass in fewer than 10 answers, passed after ' + n);
  s = await unitState(U2);
  assert(s.step === 'why', 'after play passes the step is "why", got "' + s.step + '"');

  await mt(() => window.__musicTheory.gotIt());
  assert(await unitIdx() === 2, 'gotIt() advances unitIdx to 2, got ' + await unitIdx());

  // ── Reload: progress persists and the DOM marks unit 3 (thirds) active ──
  await reload();
  assert(await unitIdx() === 2, 'progress.learn.unitIdx === 2 after reload, got ' + await unitIdx());
  assert(await page.locator('#panel-learn').isVisible(), '#panel-learn visible after reload');

  const active = await page.evaluate(() => {
    const panel = document.querySelector('#panel-learn');
    const el = panel.querySelector('[data-unit="thirds"]');
    if (el) return { via: 'data-unit', cls: el.className, aria: el.getAttribute('aria-current') };
    // Fallback: any active/current-looking element mentioning "Thirds".
    const cand = [...panel.querySelectorAll('.active, .current, [aria-current]')]
      .find((e) => /thirds/i.test(e.textContent));
    return cand ? { via: 'text', cls: cand.className, aria: cand.getAttribute('aria-current') } : null;
  });
  assert(active, 'Learn panel has an element for unit "thirds" ([data-unit="thirds"] or an active element mentioning Thirds)');
  assert(/\b(active|current)\b/.test(active.cls) || active.aria,
    'thirds unit is marked active/current (found via ' + active.via + ', class="' + active.cls + '")');

  // The stored blob is what the reload read back.
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), PROGRESS_KEY);
  assert(stored && stored.v === 1 && stored.learn.unitIdx === 2, 'stored progress has v=1 and learn.unitIdx=2');

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));

  console.log('ALL CHECKS PASSED');
  await browser.close();
});
