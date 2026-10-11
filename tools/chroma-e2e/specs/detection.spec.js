// Real Web Audio end to end: oscillators go through the same analysers the
// microphone uses, and the app must name the chord / note we played.
const { launch, run, assert, mtof } = require('./_helpers');

const CASES = [
  // [label, midi notes, expected chord name]
  ['C major triad', [60, 64, 67], 'C'],
  ['A minor triad', [57, 60, 64], 'Am'],
  ['G dominant 7th', [55, 59, 62, 65], 'G7'],
  ['F major 7th', [53, 57, 60, 64], 'Fmaj7'],
  ['B diminished', [59, 62, 65], 'B°'],
  ['E major, 1st inversion', [56, 59, 64], 'E'],
];

run(async () => {
  const { browser, page, errors, open, listenTo, state } = await launch();
  await open();

  for (const [label, notes, want] of CASES) {
    const s = await listenTo(notes.map(mtof));
    assert(s.chordKind === 'chord' && s.chord === want, `${label}: expected ${want}, got ${s.chord} (${s.chordKind})`);
    console.log(`ok  ${label} -> ${s.chord}`);
  }

  // A single sine tone is a note, not a chord, and the melody tracker
  // finds it too.
  const s = await listenTo([mtof(69)]);
  assert(s.chordKind === 'note' && s.chord === 'A', `single A4: expected note A, got ${s.chord} (${s.chordKind})`);
  assert(s.melody === 'A', `single A4: expected melody A, got ${s.melody}`);
  console.log('ok  single note A4 -> note A, melody A');

  // Clashing notes read as more tense than a consonant triad.
  const calm = (await listenTo([60, 64, 67].map(mtof))).tension;
  const tense = (await listenTo([60, 61, 66].map(mtof))).tension;
  assert(tense > calm + 0.15, `cluster tension (${tense.toFixed(2)}) should exceed C major (${calm.toFixed(2)})`);
  console.log(`ok  tension C major ${calm.toFixed(2)} < cluster ${tense.toFixed(2)}`);

  await page.evaluate(() => window.__chroma.stop());
  if (errors.length) throw new Error('console/page errors: ' + errors.join(' | '));
  console.log('ALL CHECKS PASSED');
  await browser.close();
});
