// Drums and notes are kept apart: a drums-only demo makes drum hits but no
// notes or chords, and a notes-only demo makes notes but (almost) no drum hits.
const { launch, run, assert } = require('./_helpers');

run(async () => {
  const { browser, page, errors, open, state } = await launch();
  await open();

  await page.evaluate(() => window.__chroma.startDemo({ drums: true, harmony: false }));
  await page.waitForTimeout(6000);
  let s = await state();
  console.log(`drums only: drums ${JSON.stringify(s.drums)}, noteOns ${s.noteOns}, chord ${s.chord}, perc ${s.perc.toFixed(2)}`);
  assert(s.drums.kick >= 6, `kicks should register, got ${s.drums.kick}`);
  assert(s.drums.snare + s.drums.hat >= 4, `snares/hats should register, got ${JSON.stringify(s.drums)}`);
  assert(s.noteOns <= 2, `drums alone should not make notes, got ${s.noteOns} note-ons`);
  assert(s.chord === null, `drums alone should not make a chord, got ${s.chord}`);

  await page.evaluate(() => window.__chroma.stop());
  await page.reload();
  await page.waitForFunction(() => window.__chroma);
  await page.evaluate(() => window.__chroma.startDemo({ drums: false, harmony: true }));
  await page.waitForTimeout(6000);
  s = await state();
  const hits = s.drums.kick + s.drums.snare + s.drums.hat;
  console.log(`notes only: drums ${JSON.stringify(s.drums)}, noteOns ${s.noteOns}, chord ${s.chord}, perc ${s.perc.toFixed(2)}`);
  assert(s.noteOns >= 5, `notes should register, got ${s.noteOns}`);
  assert(hits <= 3, `notes alone should not make drum hits, got ${JSON.stringify(s.drums)}`);

  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
