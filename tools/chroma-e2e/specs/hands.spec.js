// Notes are found with their octaves and split into a low part (left hand)
// and a high part (right hand).
const { launch, run, assert, mtof } = require('./_helpers');

const names = (s) => s.notes.map((n) => `${n.name}:${n.hand}`).join(' ');

run(async () => {
  const { browser, page, errors, open, state } = await launch();
  await open();

  // A triangle wave has strong odd overtones (3rd = a fifth up): still one note.
  await page.evaluate((f) => window.__chroma.playTones([f], 'triangle'), mtof(48));
  await page.waitForTimeout(1200);
  let s = await state();
  assert(s.notes.length === 1 && s.notes[0].name === 'C3', `one triangle C3 should be one note, got [${names(s)}]`);
  console.log(`ok  triangle C3 -> [${names(s)}]`);

  // Left hand C3 + G3, right hand E5 + G5.
  await page.evaluate((fs) => window.__chroma.playTones(fs, 'sine'), [48, 55, 76, 79].map(mtof));
  await page.waitForTimeout(1500);
  s = await state();
  const want = 'C3:L G3:L E5:R G5:R';
  assert(names(s) === want, `expected [${want}], got [${names(s)}] (split ${s.split.toFixed(1)})`);
  console.log(`ok  two hands -> [${names(s)}], split ${s.split.toFixed(1)}`);

  // The demo song: bass in the left hand, melody in the right.
  await page.evaluate(() => window.__chroma.startDemo());
  const samples = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const id = setInterval(() => {
      const st = window.__chroma.state;
      const d = window.__chroma.demoNow();
      if (d && d.intoBar > 0.6) out.push(st.notes);
      if (out.length >= 120) { clearInterval(id); resolve(out); }
    }, 100);
  }));
  let bassLeft = 0, bassSeen = 0, highRight = 0, highSeen = 0;
  for (const notes of samples) {
    for (const n of notes) {
      if (n.midi < 48) { bassSeen++; if (n.hand === 'L') bassLeft++; }
      if (n.midi >= 72) { highSeen++; if (n.hand === 'R') highRight++; }
    }
  }
  console.log(`demo: bass in left ${bassLeft}/${bassSeen}, melody in right ${highRight}/${highSeen}`);
  assert(bassSeen > 50 && bassLeft / bassSeen > 0.9, 'bass notes should be in the left hand');
  assert(highSeen > 30 && highRight / highSeen > 0.9, 'melody notes should be in the right hand');

  await page.evaluate(() => window.__chroma.setMode('hands'));
  await page.waitForTimeout(1500);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: require('path').join(process.env.SHOTS_DIR, 'chroma-hands-demo.png') });

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
