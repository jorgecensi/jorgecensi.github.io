// Pure mapping rules, no audio: hues follow the circle of fifths, and the
// chord / key detectors work on ideal pitch-class vectors.
const { launch, run, assert } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open } = await launch();
  await open();

  const r = await page.evaluate(() => {
    const c = window.__chroma;
    const v = (pcs) => { const a = new Array(12).fill(0); pcs.forEach((p) => { a[p] = 1; }); return a; };
    const name = (x) => x && c.NOTE_NAMES[x.root] + x.q.suffix;
    const hueDist = (a, b) => { const d = Math.abs(c.pcHue(a) - c.pcHue(b)) % 360; return Math.min(d, 360 - d); };
    const cMajorScale = [6.35, 0, 3.48, 0, 4.38, 4.09, 0, 5.19, 0, 3.66, 0, 2.88];
    return {
      fifth: hueDist(0, 7),            // C–G
      tritone: hueDist(0, 6),          // C–F#
      semitone: hueDist(0, 1),         // C–C#
      cHue: c.pcHue(0),
      chords: [name(c.detectChord(v([0, 4, 7]))), name(c.detectChord(v([2, 5, 9]))), name(c.detectChord(v([7, 11, 2, 5])))],
      key: (() => { const k = c.detectKey(cMajorScale); return c.NOTE_NAMES[k.tonic] + ' ' + k.mode; })(),
      roughCalm: c.roughness(v([0, 4, 7])),
      roughClash: c.roughness(v([0, 1, 6])),
      red: c.oklchToRgb(0.62, 0.2, c.pcHue(0)),
    };
  });

  assert(r.fifth === 30, `a fifth should be one 30° hue step, got ${r.fifth}`);
  assert(r.tritone === 180, `a tritone should be complementary (180°), got ${r.tritone}`);
  assert(r.semitone === 150, `a semitone should be 150° apart, got ${r.semitone}`);
  assert(r.red[0] > r.red[1] && r.red[0] > r.red[2], `C should be red-ish, got rgb(${r.red})`);
  assert(JSON.stringify(r.chords) === JSON.stringify(['C', 'Dm', 'G7']), `chords: ${r.chords}`);
  assert(r.key === 'C major', `key: ${r.key}`);
  assert(r.roughClash > r.roughCalm * 3, `roughness calm ${r.roughCalm} vs clash ${r.roughClash}`);

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
