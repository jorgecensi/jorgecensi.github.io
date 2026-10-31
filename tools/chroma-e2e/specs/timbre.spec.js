// Timbre per note: fade vs hold, movement (vibrato / wobble), brightness,
// and sidechain pumping not mistaken for fading.
const { launch, run, assert } = require('./_helpers');

const summary = (notes) => notes.map((n) => `${n.name}:${n.env} m${n.move} r${n.rate} b${n.bright} (${n.len}s)`).join(' | ');

run(async () => {
  const { browser, page, errors, open, state } = await launch();
  await open();
  const play = async (voices, opts, ms) => {
    await page.evaluate(([v, o]) => window.__chroma.playVoices(v, o), [voices, opts || {}]);
    await page.waitForTimeout(ms);
    return state();
  };
  const of = (s, name) => s.recent.filter((n) => n.name === name && n.env !== '?');

  // 1. A struck note (fading, re-struck every second) under a held one
  //    with vibrato.
  let s = await play([
    { midi: 52, type: 'triangle', env: 'fade', every: 1, gain: 0.3, tau: 0.3 },
    { midi: 69, type: 'sawtooth', gain: 0.12, vibrato: 35, vibRate: 5.5 },
  ], {}, 4500);
  console.log('1  ' + summary(s.recent));
  const e3 = of(s, 'E3'), a4 = of(s, 'A4');
  assert(e3.length >= 1 && e3.every((n) => n.env === 'fade'), `E3 (struck) should fade: ${summary(e3)}`);
  assert(e3.every((n) => n.move < 0.3), `E3 has no vibrato: ${summary(e3)}`);
  assert(a4.length >= 1 && a4[0].env === 'hold', `A4 (held) should hold: ${summary(a4)}`);
  assert(a4[0].move > 0.5, `A4 has vibrato: ${summary(a4)}`);

  // 2. Brightness: a pure sine is soft, a sawtooth bright. Neither moves.
  s = await play([{ midi: 60, type: 'sine', gain: 0.2 }, { midi: 76, type: 'sawtooth', gain: 0.12 }], {}, 2500);
  console.log('2  ' + summary(s.recent));
  const c4 = of(s, 'C4')[0], e5 = of(s, 'E5')[0];
  assert(c4 && c4.env === 'hold' && c4.bright < 0.2 && c4.move < 0.25, `C4 sine: held, soft, still: ${summary(s.recent)}`);
  assert(e5 && e5.bright > 0.4 && e5.move < 0.25, `E5 saw: bright, still: ${summary(s.recent)}`);

  // 3. A held pad ducked by a sidechain on every kick still counts as held,
  //    and the pumping itself is measured.
  s = await play([
    { midi: 55, type: 'sawtooth', gain: 0.1, pump: true },
    { midi: 59, type: 'sawtooth', gain: 0.1, pump: true },
    { midi: 62, type: 'sawtooth', gain: 0.1, pump: true },
  ], { kicks: true }, 5000);
  console.log(`3  pump ${s.pump.toFixed(2)} kickPeriod ${s.kickPeriod.toFixed(2)} | ` + summary(s.recent));
  const pad = s.recent.filter((n) => [55, 59, 62].includes(n.midi) && n.len >= 1);
  assert(s.pump > 0.3, `pumping should be measured, got ${s.pump.toFixed(2)}`);
  assert(pad.length >= 2 && pad.every((n) => n.env === 'hold'), `pumped pad should hold: ${summary(pad)}`);
  assert(pad.every((n) => n.move < 0.4), `pumping is not movement: ${summary(pad)}`);

  // 4. A wobble bass: a held saw through a filter swept at 4 Hz.
  s = await play([{ midi: 45, type: 'sawtooth', gain: 0.3, wobble: 0.9, wobRate: 4 }], {}, 3000);
  console.log('4  ' + summary(s.recent));
  const a2 = of(s, 'A2')[0];
  assert(a2 && a2.move > 0.5 && a2.rate > 3 && a2.rate < 5.5, `A2 wobble should move at ~4 Hz: ${summary(s.recent)}`);

  // 5. The band demo, all at once: the piano (G3-F#4) fades, the bass
  //    (octave 2) holds still, the singer (octave 5) holds with vibrato.
  await page.evaluate(() => window.__chroma.startDemo({ song: 'band', parts: { harmony: true, drums: true } }));
  await page.waitForTimeout(8000);
  s = await state();
  const judged = s.recent.filter((n) => n.env === 'fade' || n.env === 'hold');
  const piano = judged.filter((n) => n.midi >= 55 && n.midi <= 66);
  const bass = judged.filter((n) => n.midi < 48);
  const voice = judged.filter((n) => n.midi >= 72);
  const share = (arr, f) => arr.filter(f).length / Math.max(1, arr.length);
  console.log(`5  piano fade ${share(piano, (n) => n.env === 'fade').toFixed(2)} (${piano.length}), bass hold+still ${share(bass, (n) => n.env === 'hold' && n.move < 0.3).toFixed(2)} (${bass.length}), voice moving ${share(voice, (n) => n.move > 0.5).toFixed(2)} hold ${share(voice, (n) => n.env === 'hold').toFixed(2)} (${voice.length})`);
  assert(piano.length >= 3 && share(piano, (n) => n.env === 'fade') >= 0.7, 'piano notes fade: ' + summary(piano));
  assert(share(piano, (n) => n.move < 0.3) >= 0.7, 'piano notes are still: ' + summary(piano));
  assert(bass.length >= 2 && share(bass, (n) => n.env === 'hold' && n.move < 0.3) >= 0.9, 'bass holds still: ' + summary(bass));
  assert(voice.length >= 2 && share(voice, (n) => n.move > 0.5) >= 0.6 && share(voice, (n) => n.env === 'hold') >= 0.6, 'singer holds with vibrato: ' + summary(voice));

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
