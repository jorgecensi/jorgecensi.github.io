// Interval hints and song references: the Hint button in Learn hear rounds,
// hinted rounds not counting towards passing, the after-answer song card with
// its on-demand YouTube embed, the "Play the key first" setting (and that it
// survives a reload and a progress reset), and a sanity check that every
// reference tune actually contains the interval it is meant to teach.
const { launch, run, assert, PROGRESS_KEY } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open, reload, mt } = await launch();

  // The sandbox can't reach YouTube; serve an empty page for the embed so the
  // spec checks our wiring, not the network.
  await page.route('**://www.youtube-nocookie.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));

  await open();

  // ── Reference data: every interval, both directions, plays its own interval ──
  const refProblems = await mt(() => {
    const refs = window.__musicTheory.intervalRefs;
    const out = [];
    for (const dir of ['up', 'down']) {
      for (let n = 1; n <= 12; n++) {
        const r = refs[dir][n];
        if (!r || !r.tune || !r.tune.notes.length) { out.push(`${dir} ${n}: missing`); continue; }
        const offs = r.tune.notes.map(x => x[0]);
        const want = dir === 'up' ? n : -n;
        const ok = offs.some((o, i) => o === 0 && offs[i + 1] === want);
        if (!ok) out.push(`${dir} ${n}: no 0 -> ${want} step in ${JSON.stringify(offs)}`);
        (r.pop || []).forEach(p => { if (!/^[\w-]{11}$/.test(p.id)) out.push(`${dir} ${n}: bad video id ${p.id}`); });
      }
    }
    return out;
  });
  assert(refProblems.length === 0, 'interval references are complete and correct: ' + refProblems.join('; '));

  // Start on unit 2 (perfect intervals, hear step) with unit 1 done.
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
    v: 1, learn: { unitIdx: 1, units: { pulse: { step: 'done' } } },
  })), PROGRESS_KEY);
  await reload();
  await mt(() => window.__musicTheory.switchMode('learn'));

  const hearStats = () => mt(() => window.__musicTheory.progress.learn.units['perfect-intervals'].hear);
  const visible = (sel) => page.locator(sel).isVisible();

  assert((await mt(() => window.__musicTheory.currentQuestion().kind)) === 'interval', 'unit 2 hear round is an interval question');
  assert(await visible('#learn-hint-btn'), 'Hint button shows in an interval hear round');
  assert(!(await visible('#learn-refs')), 'song card is hidden before hinting or answering');
  assert(await visible('#learn-keyctx-row'), '"Play the key first" toggle shows in an interval round');

  // ── Hint: shows the songs, hides itself, and the round does not count ──
  assert(await mt(() => window.__musicTheory.useHint()), 'useHint() succeeds on an interval hear round');
  assert(await visible('#learn-refs'), 'song card shows after Hint');
  assert(await page.locator('#learn-refs [data-ref="tune"]').count() === 1, 'song card has a playable tune');
  assert(!(await visible('#learn-hint-btn')), 'Hint button hides once used');
  const fbAfterHintedAnswer = await mt(() => {
    window.__musicTheory.answerCorrect();
    return document.getElementById('learn-feedback').textContent;
  });
  assert(/not counted/i.test(fbAfterHintedAnswer), 'hinted answer says it was not counted, got: ' + fbAfterHintedAnswer);
  await page.waitForTimeout(50);
  assert((await hearStats()).total === 0, 'a hinted answer does not add to the hear step stats');
  assert(await visible('#learn-hint-btn'), 'the next round offers Hint again');
  assert(!(await mt(() => window.__musicTheory.currentQuestion().hinted)), 'the next round starts unhinted');

  await mt(() => window.__musicTheory.answerCorrect());
  await page.waitForTimeout(50);
  assert((await hearStats()).total === 1, 'an unhinted answer counts');

  // ── After answering: song card, and a video embeds only when asked ──
  let watched = false;
  for (let i = 0; i < 20 && !watched; i++) {
    const ans = await mt(() => window.__musicTheory.currentQuestion().answer);
    await page.locator(`#learn-options .quiz-opt-btn[data-id="${ans}"]`).click();
    assert(await visible('#learn-refs'), 'song card shows after answering an interval round');
    assert(!(await visible('#learn-hint-btn')), 'Hint is gone once the round is answered');
    const watch = page.locator('#learn-refs [data-video]').first();
    if (await watch.count()) {
      const id = await watch.getAttribute('data-video');
      assert(await page.locator('#learn-refs iframe').count() === 0, 'no iframe before Watch is tapped');
      await watch.click();
      const src = await page.locator('#learn-refs iframe').getAttribute('src');
      assert(src.includes(`youtube-nocookie.com/embed/${id}`), 'Watch embeds that video, got ' + src);
      await watch.click();
      assert(await page.locator('#learn-refs iframe').count() === 0, 'tapping Watch again closes the video');
      watched = true;
    }
    await page.locator('#learn-next-btn').click();
  }
  assert(watched, 'within 20 rounds of unit 2 a song with a video came up (5th or octave)');

  // ── Key context: off plays two notes, on plays I–IV–V–I first ──
  let ev = await mt(() => window.__musicTheory.promptEvents());
  assert(ev && ev.length === 2, 'without key context the prompt is two notes, got ' + (ev && ev.length));
  await page.locator('#learn-keyctx').check();
  assert((await mt(() => window.__musicTheory.progress.settings.keyContext)) === true, 'toggle saves the setting');
  ev = await mt(() => window.__musicTheory.promptEvents());
  assert(ev.length === 6, 'with key context the prompt is 4 chords + 2 notes, got ' + ev.length);
  assert(ev.slice(0, 4).every(e => e.notes.length === 3), 'the first four events are triads');
  assert(ev[4].t > ev[3].t, 'the interval comes after the cadence');

  await reload();
  await mt(() => window.__musicTheory.switchMode('learn'));
  assert(await page.locator('#learn-keyctx').isChecked(), 'key context is still on after a reload');
  await mt(() => window.__musicTheory.resetProgress());
  assert((await mt(() => window.__musicTheory.progress.settings.keyContext)) === true, 'reset progress keeps the setting');
  assert((await mt(() => window.__musicTheory.progress.learn.unitIdx)) === 0, 'reset progress still resets the path');

  // ── Free-play Quiz: Intervals shows the toggle and the song card ──
  await mt(() => window.__musicTheory.switchMode('quiz'));
  await page.locator('.quiz-type-btn[data-type="intervals"]').click();
  assert(await visible('#quiz-keyctx-row'), 'Quiz intervals shows the key toggle');
  assert(await page.locator('#quiz-keyctx').isChecked(), 'Quiz toggle mirrors the saved setting');
  const qa = await mt(() => window.__musicTheory.currentQuestion());
  await page.locator(`#quiz-options .quiz-opt-btn[data-id="${qa.answer}"]`).click();
  const hasRef = qa.mode !== 'harmonic';
  assert((await visible('#quiz-refs')) === hasRef, 'Quiz shows the song card after a melodic interval answer');
  await page.locator('.quiz-type-btn[data-type="chords"]').click();
  assert(!(await visible('#quiz-keyctx-row')), 'the key toggle hides outside interval rounds');
  assert(!(await visible('#quiz-refs')), 'the song card hides outside interval rounds');

  assert(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log('interval hints OK');
  await browser.close();
});
