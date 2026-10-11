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
| `demo.spec.js` | The demo registers beats, kicks and a key. All modes render, and Stop returns to the start screen. |

## Debug API (`?debug=1`)

`window.__chroma` exposes:

- `state`: source, level, chord, chordKind (`'chord'`/`'note'`), key, melody, tension, chroma, onsets, kicks, mode.
- `playTones(freqs)`: steady oscillators into the analysers. They make no sound.
- `startDemo()`, `stop()`, `setMode(m)`.
- `demoNow()`: the chord the demo is playing right now and how far into the bar it is.
- The pure functions `detectChord`, `detectKey`, `roughness`, `pcHue`, `oklchToRgb`, and `NOTE_NAMES`.
- `step(n)`: drives frames by hand. After the first call, the rAF loop stays off until the page reloads.

The pitch FFT is 16384 samples (about 0.34 s at 48 kHz), and the chord display
waits 0.15 s before it switches. Allow about 0.6 s after a change before you
assert on the chord.
