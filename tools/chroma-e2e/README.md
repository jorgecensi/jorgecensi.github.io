# Chroma e2e specs

Playwright specs for `/chroma/`. They push real Web Audio (oscillators and the
built-in demo song) through the same analysers the microphone uses, so they test
the actual detection path. No mic or network is needed.

```
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # first run in a fresh container
./run.sh                    # every spec
./run.sh detection.spec.js  # only the named specs
```

`run.sh` builds the site, serves `_site/` on port 4005 (override with `PORT`),
and prints PASS/FAIL for each spec. Screenshots of the start screen and all
three visual modes go to `$TMPDIR/chroma-e2e-<pid>/shots/`.

Playwright is pinned to `1.56.0`, which matches the pre-installed Chromium in
`/opt/pw-browsers`. Never let it download browsers. Chromium starts with
`--autoplay-policy=no-user-gesture-required`, so the AudioContext runs without a
click.

| Spec | Checks |
|---|---|
| `theory.spec.js` | The mapping rules: a fifth is one 30° hue step, a tritone is complementary (180°), and `detectChord`, `detectKey` and `roughness` work on ideal vectors. |
| `detection.spec.js` | Steady tones give the right chord: triads, 7ths, diminished, an inversion. One sine is a "note" and is found as the melody. A cluster reads as more tense than a triad. |
| `demo-accuracy.spec.js` | Over the 16-bar demo song (drums and a loud bass), the chord shown matches the chord played in at least 85% of samples. It prints a per-chord breakdown, so run it after any change to the analysis code. |
| `demo.spec.js` | The demo registers notes, drums and a key. All four modes render, and Stop returns to the start screen. |
| `separation.spec.js` | Drums and notes stay apart. The drums-only demo makes kicks, snares and hats but no notes or chord. The notes-only demo makes notes but no drum hits. |
| `hands.spec.js` | Notes come with octaves and a hand. A triangle C3 stays one note (overtones are not notes), C3+G3 / E5+G5 splits into left / right, and in the demo the bass is in the left hand and the melody in the right more than 90% of the time. |

## Debug API (`?debug=1`)

`window.__chroma` exposes:

- `state`: source, level, chord, chordKind (`'chord'`/`'note'`), key, melody, tension, chroma, mode, plus:
  - `notes`: the sounding notes, low to high, as `{ midi, name, hand }` (`hand` is `'L'` or `'R'`);
  - `split`: the current low/high dividing line (MIDI number);
  - `noteOns`: the number of notes started so far;
  - `drums` (`{ kick, snare, hat }` counts), `kicks`, `drumHits` (recent hits with their time relative to now), and `perc` (the drums' share of the energy).
- `playTones(freqs)`: steady oscillators into the analysers. They make no sound.
- `startDemo(parts)`, `stop()`, `setMode(m)`. `parts` defaults to `{ harmony: true, drums: true }`; turn one off to play only drums or only notes.
- `demoNow()`: the chord the demo is playing right now and how far into the bar it is.
- The pure functions `detectChord`, `detectKey`, `roughness`, `pcHue`, `oklchToRgb`, and `NOTE_NAMES`.
- `step(n)`: drives frames by hand. After the first call, the rAF loop stays off until the page reloads.

The pitch FFT is 16384 samples (about 0.34 s at 48 kHz), and the chord display
waits 0.15 s before it switches. Allow about 0.6 s after a change before you
assert on the chord.

## Tuning notes (drums vs notes)

These numbers come from the demo. Re-check them with `separation.spec.js` if you change them:

- **Spectral peaks** must stand 15 dB above the median of the ±16 bins around them. This rejects drum noise and the kick's pitch sweep. An earlier test against the bins exactly ±5 away wrongly rejected notes a semitone apart, such as B3 and C4.
- **Drum hits** need their change spread over at least 15% of the 150 Hz–8 kHz bins. Real hits spread over 21% or more; a whole chord starting at once stays at 8% or less, and would otherwise read as a snare.
- **Kicks** have their own low-band detector, because broadband snares and hats drown them out. A kick also needs more percussive than harmonic energy below 150 Hz, so a new bass note doesn't count.
- **Hi-hats under loud harmony** often fall below the "≥ 30% percussive" bar and are skipped. That's acceptable: they are the busiest layer.
