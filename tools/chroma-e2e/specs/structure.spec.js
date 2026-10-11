// Song shape on the electronic demo (2 s bars): groove (bars 0-3),
// breakdown (4-7), build-up (8-11), drop (12-15). The band demo, with steady
// drums, has no build-ups or drops.
const { launch, run, assert } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open, state } = await launch();
  await open();

  await page.evaluate(() => window.__chroma.startDemo({ song: 'edm' }));
  const samples = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const id = setInterval(() => {
      const d = window.__chroma.demoNow();
      const st = window.__chroma.state;
      if (d) out.push({ bar: d.bar, into: d.intoBar, section: st.section, score: st.buildScore, pump: st.pump });
      if (d && d.bar >= 16) { clearInterval(id); resolve(out); }
    }, 100);
  }));
  const s = await state();
  const share = (pred, sec) => { const p = samples.filter(pred); return p.filter((x) => x.section === sec).length / Math.max(1, p.length); };
  const bars = {};
  for (const x of samples) (bars[x.bar] = bars[x.bar] || {})[x.section] = ((bars[x.bar] || {})[x.section] || 0) + 1;
  for (const [b, v] of Object.entries(bars)) console.log(`bar ${b.padStart(2)} ${JSON.stringify(v)} score ${samples.filter((x) => x.bar == b).slice(-1)[0].score.toFixed(2)}`);
  const pumpGroove = Math.max(...samples.filter((x) => x.bar >= 2 && x.bar <= 3).map((x) => x.pump));
  console.log(`drops ${s.drops}, pump in groove ${pumpGroove.toFixed(2)}`);

  assert(share((x) => x.bar <= 3, 'normal') > 0.9, 'groove is "normal"');
  assert(share((x) => x.bar >= 6 && x.bar <= 7, 'break') > 0.8, 'bars 6-7 are a breakdown');
  assert(share((x) => x.bar >= 10 && x.bar <= 11, 'build') > 0.7, 'bars 10-11 are a build-up');
  const firstDrop = samples.find((x) => x.section === 'drop');
  assert(firstDrop && firstDrop.bar === 12 && firstDrop.into < 1.5, `the drop lands early in bar 12, got ${firstDrop && firstDrop.bar + '+' + firstDrop.into.toFixed(1)}`);
  assert(s.drops === 1, `exactly one drop, got ${s.drops}`);
  assert(pumpGroove > 0.3, 'the groove pad pumps');

  await page.evaluate(() => window.__chroma.stop());
  await page.reload();
  await page.waitForFunction(() => window.__chroma);
  await page.evaluate(() => window.__chroma.startDemo({ song: 'band' }));
  const band = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const id = setInterval(() => {
      out.push(window.__chroma.state.section);
      if (out.length >= 120) { clearInterval(id); resolve(out); }
    }, 100);
  }));
  const s2 = await state();
  const builds = band.filter((x) => x === 'build').length;
  console.log(`band demo: drops ${s2.drops}, build samples ${builds}/120, breaks ${band.filter((x) => x === 'break').length}`);
  assert(s2.drops === 0 && builds < 12, 'the band demo has no drop and no real build-up');

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
