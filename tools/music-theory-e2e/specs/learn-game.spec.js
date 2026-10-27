// The Learn game layer: question variants, one-line facts, combos and XP,
// boss runs (lives, timer, unlocking), the daily mix and its day streak, and
// singing answers (judging, keyboard fallback, the pitch detector, and the
// real mic path through Chromium's fake audio capture).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, run, assert, PROGRESS_KEY } = require('./_helpers');

const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const toMidi = (name) => {
  const [, n, o] = name.match(/^([A-G]#?)(-?\d)$/);
  return (+o + 1) * 12 + NAMES.indexOf(n);
};
const stats = () => ({ correct: 10, total: 10, recent: [1,1,1,1,1,1,1,1,1,1] });
const unit = (step) => ({ step, hear: stats(), play: stats() });
// On the play step with nothing played yet, so one answer can't pass it.
const atPlay = () => ({ step: 'play', hear: stats(), play: { correct: 0, total: 0, recent: [] } });

// A mono 16-bit WAV of a steady sine, for the fake microphone.
function sineWav(freq, secs = 4, rate = 48000) {
  const n = secs * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 12000), 44 + i * 2);
  return buf;
}

run(async () => {
  const { browser, page, errors, open, reload, mt } = await launch();
  await open();
  const ids = await mt(() => window.__musicTheory.units.map(u => u.id));
  const save = (blob) => page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [PROGRESS_KEY, blob]);
  const prog = () => mt(() => window.__musicTheory.progress);
  const tick = (ms = 40) => page.waitForTimeout(ms);
  const visible = (sel) => page.locator(sel).isVisible();

  // ── Variants: every unit and step serves each of its variants correctly ──
  await save({ v: 1, learn: { unitIdx: ids.length - 1, layout: 2,
    units: Object.fromEntries(ids.map(id => [id, unit('done')])) } });
  await reload();
  await mt(() => window.__musicTheory.switchMode('learn'));
  let served = 0;
  for (const id of ids) {
    await page.click(`.learn-unit[data-unit="${id}"]`);
    for (const step of ['hear', 'play']) {
      const variants = await mt(([u, s]) => window.__musicTheory.variantsFor(u, s), [id, step]);
      if (!variants.length) continue;   // pulse has no play step
      assert(variants.includes('standard'), `${id}/${step} always offers the standard round`);
      for (const v of variants) {
        await mt((x) => window.__musicTheory.forceVariant(x), v);
        for (let rep = 0; rep < 3; rep++) {
          await mt((s) => window.__musicTheory.viewStep(s), step);
          const q = await mt(() => {
            const q = window.__musicTheory.currentQuestion();
            return { ...q, answerPcs: q.answerPcs && [...q.answerPcs], needPcs: q.needPcs && [...q.needPcs],
                     reveal: !!q.reveal, choiceIds: q.choices && q.choices.map(c => c.id) };
          });
          const tag = `${id}/${step}/${v}`;
          assert(q.variant === v, `${tag}: served variant ${q.variant}`);
          assert(q.unitId === id, `${tag}: question knows its unit`);
          assert(q.prompt && q.prompt.length > 8, `${tag}: has a prompt`);
          if (q.choiceIds) assert(q.choiceIds.includes(q.answer), `${tag}: answer ${q.answer} is one of the choices`);
          else assert(q.answerPcs && q.answerPcs.length && (q.needPcs || q.answerPcs).length, `${tag}: keyboard round has notes to play`);
          const evMidis = (q.events || []).flatMap(e => e.notes.map(toMidi));
          assert(evMidis.every(m => m >= 36 && m <= 96), `${tag}: prompt notes stay in range: ${evMidis}`);
          const all = new Set([...(q.midis || []), ...(q.extraMidis || []), ...(q.givenMidis || [])]);
          assert(evMidis.every(m => all.has(m)), `${tag}: every prompt note is listed for instrument picks`);

          if (v === 'song' && q.kind === 'interval-song') {
            assert(Math.abs(q.midis[1] - q.midis[0]) === q.semis && String(q.semis) === q.answer, `${tag}: answer is the tune's interval`);
            const pairs = evMidis.slice(1).map((m, i) => [evMidis[i], m]);
            assert(pairs.some(([a, b]) => a === q.midis[0] && b === q.midis[1]), `${tag}: the tune contains the interval`);
          }
          if (v === 'song' && q.kind === 'chord-song') assert(q.answer === q.chordType, `${tag}: answer is the chord's type`);
          if (v === 'odd' && q.kind === 'odd' && id !== 'pulse' && evMidis.length === 6) {
            const d = [0, 2, 4].map(i => evMidis[i + 1] - evMidis[i]);
            const odd = +q.answer;
            const others = d.filter((_, i) => i !== odd);
            assert(others[0] === others[1] && d[odd] !== others[0], `${tag}: odd interval ${odd} in ${d}`);
          }
          if (v === 'wrong-note') {
            const diffs = q.midis.map((m, i) => evMidis[i] - m);
            const off = diffs.map((x, i) => (x ? i : -1)).filter(i => i >= 0);
            assert(off.length === 1 && String(off[0]) === q.answer && Math.abs(diffs[off[0]]) === 1,
              `${tag}: exactly the answer degree is a semitone off: ${diffs}`);
          }
          if (v === 'phrase') {
            assert(q.exactMidi === q.rootMidi + q.semis, `${tag}: target is the interval above the lit key`);
            assert(evMidis[evMidis.length - 1] === q.rootMidi, `${tag}: the lead-in stops on the lit key`);
          }
          if (v === 'blind') assert(evMidis.length === 2 && evMidis[0] === q.rootMidi, `${tag}: plays both notes from the lit key`);
          if (v === 'complete') assert(q.needPcs.length === 1 && !q.givenMidis.some(m => q.needPcs.includes(m % 12)), `${tag}: one note is missing`);
          if (v === 'missing') assert(evMidis.length === q.midis.length - 1, `${tag}: one scale note is silent`);

          // Answering right or wrong goes through cleanly for every variant.
          const before = (await prog()).learn.units[id][step].total;
          await mt((r) => (r ? window.__musicTheory.answerCorrect() : window.__musicTheory.answerWrong()), rep !== 1);
          await tick();
          assert((await prog()).learn.units[id][step].total === before + 1, `${tag}: the answer is recorded`);
          served++;
        }
      }
    }
  }
  await mt(() => window.__musicTheory.forceVariant(null));
  console.log('variants: served and answered', served, 'rounds');

  // Unforced, a unit mixes its variants.
  await page.click('.learn-unit[data-unit="perfect-intervals"]');
  await mt(() => window.__musicTheory.viewStep('hear'));
  const kinds = new Set();
  for (let i = 0; i < 40; i++) {
    kinds.add(await mt(() => window.__musicTheory.currentQuestion().variant));
    await mt(() => window.__musicTheory.answerCorrect());
    await tick(20);
  }
  assert(kinds.size >= 3 && kinds.has('standard'), 'unforced rounds mix variants, saw ' + [...kinds]);

  // ── Facts: a one-liner shows after answering, and hides for the next round ──
  const ans = await mt(() => window.__musicTheory.currentQuestion().answer);
  await page.click(`#learn-options .quiz-opt-btn[data-id="${ans}"]`);
  assert(await visible('#learn-fact'), 'a fact shows after answering');
  assert((await page.textContent('#learn-fact')).length > 15, 'the fact has text');
  await page.click('#learn-next-btn');
  assert(!(await visible('#learn-fact')), 'the fact hides when the next round starts');

  // ── Combos and XP ──
  await mt(() => window.__musicTheory.resetProgress());
  await mt(() => window.__musicTheory.switchMode('learn'));
  for (let i = 0; i < 5; i++) { await mt(() => window.__musicTheory.answerCorrect()); await tick(); }
  assert(await mt(() => window.__musicTheory.combo) === 5, 'five right in a row is a combo of 5');
  // x1 for answers 1-4, x2 from the 5th: 4*10 + 20.
  assert((await prog()).learn.xp === 60, 'XP with the combo multiplier is 60, got ' + (await prog()).learn.xp);
  assert(/5 in a row/.test(await page.textContent('#learn-combo')), 'the combo shows in the round');
  assert(/60/.test(await page.textContent('#learn-xp')), 'the stats bar shows the XP');
  await mt(() => window.__musicTheory.answerWrong());
  await tick();
  assert(await mt(() => window.__musicTheory.combo) === 0, 'a miss resets the combo');
  assert((await prog()).learn.bestCombo === 5, 'best combo is kept');
  await reload();
  assert((await prog()).learn.xp === 60, 'XP survives a reload');

  // ── Boss: opens after Why, has lives and a timer, and gates the next unit ──
  await save({ v: 1, learn: { unitIdx: 0, layout: 2, units: { pulse: unit('why') } } });
  await reload();
  await mt(() => window.__musicTheory.switchMode('learn'));
  assert(/boss/i.test(await page.textContent('#learn-got-it')), 'the Why button leads to the boss');
  await page.click('#learn-got-it');
  assert((await prog()).learn.units.pulse.step === 'boss', 'Got it moves the unit to its boss');
  assert(await visible('#learn-card'), 'the boss intro card shows');
  assert(/Metronome/.test(await page.textContent('#learn-card')), 'the card names the boss');
  assert(await page.locator('#learn-steps [data-step="boss"]').count() === 1, 'the steps row has a Boss step');
  await page.click('#learn-card [data-action="boss"]');
  let r = await mt(() => window.__musicTheory.run);
  assert(r && r.kind === 'boss' && r.lives === 3 && r.timed && r.len === 10, 'the boss run starts with 3 lives and a timer');
  assert(r.limit > 10000 && r.limit < 45000, 'the timer allows the prompt plus answer time, got ' + r.limit);
  assert(await visible('#learn-run-bar'), 'the run bar shows');
  assert(!(await visible('#learn-hint-btn')), 'no hints during a boss');
  await page.waitForTimeout(300);
  r = await mt(() => window.__musicTheory.run);
  assert(r.left < r.limit, 'the timer counts down');
  assert(await mt(() => window.__musicTheory.expireTimer()), 'the timer can run out');
  assert(/time/i.test(await page.textContent('#learn-feedback')), 'running out of time says so');
  assert((await mt(() => window.__musicTheory.run)).lives === 2, 'running out of time costs a life');
  await page.click('#learn-next-btn');
  for (let i = 0; i < 2; i++) {
    await mt(() => window.__musicTheory.answerWrong());   // answers, then moves on by itself
    await tick();
  }
  r = await mt(() => window.__musicTheory.run);
  assert(r.ended && !r.won && r.lives === 0, 'three misses end the run as a loss');
  assert(await visible('#learn-card') && /try again/i.test(await page.textContent('#learn-card')), 'the loss card offers a retry');
  assert((await prog()).learn.units.pulse.step === 'boss' && (await prog()).learn.unitIdx === 0, 'losing keeps the unit at its boss');
  const xpBefore = (await prog()).learn.xp;
  assert(await mt(() => window.__musicTheory.playBoss()), 'the boss can be played again');
  r = await mt(() => window.__musicTheory.run);
  assert(r.ended && r.won && r.correct === 10, 'ten right beats the boss');
  let p = await prog();
  assert(p.learn.units.pulse.step === 'done' && p.learn.unitIdx === 1, 'beating the boss finishes the unit and unlocks the next');
  assert(p.learn.xp >= xpBefore + 50 + 100, 'the first win pays the boss bonus, got ' + (p.learn.xp - xpBefore));
  assert(/beaten/i.test(await page.textContent('#learn-card')), 'the win card shows');
  const xpAfterWin = p.learn.xp;
  await mt(() => window.__musicTheory.playBoss());
  r = await mt(() => window.__musicTheory.run);
  assert(r.won && r.bonus === 0 && (await prog()).learn.xp === xpAfterWin + r.xp,
    'a rematch earns its answers\' XP but no second bonus');
  assert((await prog()).learn.unitIdx === 1, 'a rematch changes nothing else');

  // A later boss also draws from finished earlier units.
  await save({ v: 1, learn: { unitIdx: 2, layout: 2, units: {
    pulse: unit('done'), 'perfect-intervals': unit('done'), thirds: unit('boss') } } });
  await reload();
  await mt(() => window.__musicTheory.switchMode('learn'));
  const from = new Set();
  for (let k = 0; k < 3; k++) {
    await mt(() => window.__musicTheory.startBoss());
    for (let i = 0; i < 10; i++) {
      from.add(await mt(() => window.__musicTheory.currentQuestion().unitId));
      await mt(() => window.__musicTheory.answerCorrect());
      await tick(20);
    }
    await mt(() => window.__musicTheory.viewStep('boss'));
  }
  assert(from.has('thirds') && (from.has('pulse') || from.has('perfect-intervals')),
    'boss questions come from this unit and earlier ones: ' + [...from]);

  // ── Daily mix and the day streak ──
  await mt(() => window.__musicTheory.resetProgress());
  await mt(() => window.__musicTheory.switchMode('learn'));
  assert(await page.locator('#learn-daily-btn').isDisabled(), 'the daily mix is locked before any Hear step passes');
  await save({ v: 1, learn: { unitIdx: 0, layout: 2, units: { pulse: unit('why') } } });
  await reload();
  await mt(() => window.__musicTheory.switchMode('learn'));
  const daily = async (date) => {
    await mt((d) => window.__musicTheory.setToday(d), date);
    assert(await mt(() => window.__musicTheory.startDaily()), 'the daily mix starts on ' + date);
    const rr = await mt(() => window.__musicTheory.run);
    assert(rr.kind === 'daily' && rr.lives === null && !rr.timed, 'the daily mix has no lives or timer');
    const units = new Set();
    for (let i = 0; i < 10; i++) {
      units.add(await mt(() => window.__musicTheory.currentQuestion().unitId));
      await mt(() => window.__musicTheory.answerCorrect());
      await tick(20);
    }
    assert(units.size === 1 && units.has('pulse'), 'the mix only uses started units: ' + [...units]);
    return mt(() => window.__musicTheory.run);
  };
  let d = await daily('2026-10-27');
  p = await prog();
  assert(d.ended && d.bonus === 30, 'the first mix of the day pays a bonus');
  assert(p.daily.last === '2026-10-27' && p.daily.streak === 1, 'a finished mix starts a streak');
  assert(await visible('#learn-card') && /streak/i.test(await page.textContent('#learn-card')), 'the results card shows the streak');
  d = await daily('2026-10-27');
  assert(d.bonus === 0 && (await prog()).daily.streak === 1, 'a second mix the same day pays no bonus and keeps the streak');
  await daily('2026-10-28');
  assert((await prog()).daily.streak === 2, 'a mix the next day grows the streak');
  await mt(() => window.__musicTheory.leaveDaily());
  await mt(() => window.__musicTheory.setToday('2026-10-31'));
  assert(/lost/i.test(await page.textContent('#learn-streak')), 'missing a day shows the streak as lost');
  await daily('2026-10-31');
  p = await prog();
  assert(p.daily.streak === 1 && p.daily.best === 2, 'a gap restarts the streak and keeps the best');
  await page.click('#learn-card [data-action="leave-daily"]');
  assert(!(await mt(() => window.__musicTheory.state.learnDaily)), 'leaving the mix returns to the path');
  await reload();
  p = await prog();
  assert(p.daily.streak === 1 && p.daily.best === 2 && p.daily.last === '2026-10-31', 'the streak survives a reload');

  // ── Singing (judged without a real mic) ──
  await save({ v: 1, learn: { unitIdx: 1, layout: 2, units: { pulse: unit('done'), 'perfect-intervals': atPlay() } } });
  await reload();
  await mt(() => window.__musicTheory.switchMode('learn'));
  assert(await visible('#learn-sing-row'), 'the Sing toggle shows in an interval play step');
  await mt(() => window.__musicTheory.setSing(true));
  let q = await mt(() => window.__musicTheory.currentQuestion());
  assert(q.kind === 'sing' && /sing/i.test(q.prompt), 'sing mode serves sing rounds');
  assert(await visible('#learn-sing'), 'the sing meter shows');
  const total0 = (await prog()).learn.units['perfect-intervals'].play.total;
  assert(await mt((m) => window.__musicTheory.sing(m), q.targetMidi - 12), 'a sung note is judged');
  assert(/correct/i.test(await page.textContent('#learn-feedback')), 'the right note in another octave counts');
  await page.click('#learn-next-btn');
  q = await mt(() => window.__musicTheory.currentQuestion());
  await mt((m) => window.__musicTheory.sing(m), q.targetMidi + 1);
  assert(/you sang/i.test(await page.textContent('#learn-feedback')) && !/correct/i.test(await page.textContent('#learn-feedback')),
    'a wrong sung note is marked wrong');
  p = await prog();
  assert(p.learn.units['perfect-intervals'].play.total === total0 + 2, 'sung answers count towards the play step');
  await page.click('#learn-next-btn');
  q = await mt(() => window.__musicTheory.currentQuestion());
  await page.evaluate((m) => {
    const k = document.querySelector(`.key[data-midi="${m}"]`);
    const o = { bubbles: true, isPrimary: true, pointerId: 9 };
    k.dispatchEvent(new PointerEvent('pointerdown', o));
    k.dispatchEvent(new PointerEvent('pointerup', o));
  }, q.targetMidi);
  assert(/correct/i.test(await page.textContent('#learn-feedback')), 'a sing round can also be answered on the keyboard');
  await mt(() => window.__musicTheory.setSing(false));
  assert((await mt(() => window.__musicTheory.currentQuestion().kind)) === 'interval-play', 'turning singing off goes back to keys');
  for (const f of [110, 196, 261.63, 440, 659.25]) {
    const got = await mt((x) => window.__musicTheory.detectPitch(x), f);
    assert(got && Math.abs(got - f) / f < 0.01, `pitch detector reads ${f} Hz as ${got}`);
  }

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  await browser.close();

  // ── Singing through a (fake) microphone: a steady G4 tone ──
  const wav = path.join(os.tmpdir(), `mt-g4-${process.pid}.wav`);
  fs.writeFileSync(wav, sineWav(392));
  const mic = await launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required',
  ] });
  try {
    await mic.open();
    await mic.page.evaluate(([k, b]) => localStorage.setItem(k, JSON.stringify(b)),
      [PROGRESS_KEY, { v: 1, learn: { unitIdx: 1, layout: 2, units: { pulse: unit('done'), 'perfect-intervals': atPlay() } } }]);
    await mic.reload();
    await mic.mt(() => window.__musicTheory.switchMode('learn'));
    await mic.mt(() => window.__musicTheory.setSing(true, true));
    assert(await mic.mt(() => window.__musicTheory.progress.settings.sing), 'the fake mic is accepted');
    const sungRound = async (root, semis) => {
      await mic.mt(([r, s]) => window.__musicTheory.singRound(r, s), [root, semis]);
      await mic.page.waitForFunction(() => window.__musicTheory.state.quizAnswered, null, { timeout: 10000 });
      return mic.page.textContent('#learn-feedback');
    };
    let fb = await sungRound(60, 7);   // C4 + a 5th = G: matches the tone
    assert(/correct/i.test(fb) && /G/.test(fb), 'a held G is heard as the 5th above C: ' + fb);
    fb = await sungRound(60, 5);       // C4 + a 4th = F: the tone is wrong
    assert(/you sang G/i.test(fb) && !/correct/i.test(fb), 'a held G is marked wrong for the 4th above C: ' + fb);
    if (mic.errors.length) throw new Error('console/page errors (mic): ' + mic.errors.join(' | '));
  } finally {
    await mic.browser.close();
    fs.unlinkSync(wav);
  }

  console.log('ALL CHECKS PASSED');
});
