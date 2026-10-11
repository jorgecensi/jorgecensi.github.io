// Plays the full 16-bar demo song (with drums and a loud bass line, like real
// music) and checks how often the shown chord matches the one being played.
// Ignores the first 0.6 s of each bar: the pitch window is ~0.34 s long and
// the chord display waits 0.15 s before switching.
const { launch, run, assert } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open } = await launch();
  await open();
  await page.evaluate(() => window.__chroma.startDemo());

  const samples = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const id = setInterval(() => {
      const d = window.__chroma.demoNow();
      if (d && d.intoBar > 0.6) out.push({ want: d.chord, got: window.__chroma.state.chord });
      if (out.length >= 250) { clearInterval(id); resolve(out); }
    }, 100);
  }));

  const perChord = {};
  let hits = 0;
  for (const s of samples) {
    const k = s.want;
    perChord[k] = perChord[k] || { n: 0, ok: 0, got: {} };
    perChord[k].n++;
    perChord[k].got[s.got] = (perChord[k].got[s.got] || 0) + 1;
    if (s.got === s.want) { hits++; perChord[k].ok++; }
  }
  for (const [k, v] of Object.entries(perChord)) {
    console.log(`${k.padEnd(6)} ${v.ok}/${v.n}  ${JSON.stringify(v.got)}`);
  }
  const acc = hits / samples.length;
  console.log(`accuracy ${(acc * 100).toFixed(0)}% over ${samples.length} samples`);
  assert(acc >= 0.85, `chord accuracy ${(acc * 100).toFixed(0)}% is below 85%`);

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
