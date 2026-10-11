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
| `demo-accuracy.spec.js` | Over the 16-bar band demo (a fading piano, a singer with vibrato, bass and drums), the chord shown matches the chord played in at least 82% of samples. Runs usually score 84–90%. It prints a per-chord breakdown, so run it after any change to the analysis code. |
| `demo.spec.js` | The demo registers notes, drums and a key. All four modes render, and Stop returns to the start screen. |
| `separation.spec.js` | Drums and notes stay apart. The drums-only demo makes kicks, snares and hats but no notes or chord. The notes-only demo makes notes but no drum hits. |
| `timbre.spec.js` | Uses `playVoices`. A struck note fades and has no vibrato, while a held saw with vibrato holds and moves. A sine is soft and a saw bright. A sidechain-pumped pad still holds, the pumping is measured, and it isn't counted as movement. A 4 Hz filter wobble moves at about 4 Hz. In the band demo, the piano fades, the bass holds still and the singer holds with vibrato. |
| `structure.spec.js` | Plays the 32 s electronic demo. Bars 0–3 (groove) are "normal", bars 6–7 a breakdown, bars 10–11 a build-up, and the one drop lands early in bar 12; the groove pad pumps. The band demo has no drop and no build-up. |
| `hands.spec.js` | Notes come with octaves and a hand. A triangle C3 stays one note (overtones are not notes), C3+G3 / E5+G5 splits into left / right, and in the demo the bass is in the left hand and the melody in the right more than 90% of the time. |

## Debug API (`?debug=1`)

`window.__chroma` exposes:

- `state`: source, level, chord, chordKind (`'chord'`/`'note'`), key, melody, tension, chroma, mode, plus:
  - `notes`: the sounding notes, low to high, as `{ midi, name, hand }` (`hand` is `'L'` or `'R'`);
  - `split`: the current low/high dividing line (MIDI number);
  - `noteOns`: the number of notes started so far;
  - `drums` (`{ kick, snare, hat }` counts), `kicks`, `drumHits` (recent hits with their time relative to now), and `perc` (the drums' share of the energy).
  - `notes` entries also carry `env` (`'?'`, `'fade'`, `'hold'` or `'short'`), `move` (0..1) and `bright` (0..1).
  - `recent`: the notes from the last 6 s with their final timbre (`env`, `move`, `rate`, `bright`, `len`).
  - `pump` (0..1) and `kickPeriod`; `section` (`normal`, `build`, `break` or `drop`), `buildScore` and `drops`.
- `playTones(freqs)`: steady oscillators into the analysers. They make no sound.
- `startDemo({ song, parts })`, `stop()`, `setMode(m)`, `setFocus('all'|'held'|'fading')`.
  - `song` is `'band'` (the default) or `'edm'`.
  - `parts` defaults to `{ harmony: true, drums: true }`; turn one off to play only drums or only notes. The older form `startDemo({ drums, harmony })` still works.
- `playVoices(voices, { kicks })`: repeating test voices with a chosen timbre: `{ midi, type, gain, env: 'hold'|'fade', every, tau, vibrato (cents), vibRate, wobble (0..1 filter wobble), wobRate, pump }`.
- `demoNow()`: what the demo is playing right now: `{ chord, intoBar, bar, section }` (`section` is set for the electronic demo).
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

## Tuning notes (timbre)

Per-note timbre is read from a third analyser: 4096 points, about 85 ms, with bins of about 12 Hz. The 2048-point window's 23 Hz bins put neighbouring notes' partials too close together, and the long window smears vibrato.

- **Pick the partial carefully.** Only a harmonic that really exists counts: it needs its own peak in the long window, because a triangle has no even harmonics and a sine has none at all. It also has to be clear of every other sounding note's partials, up to the 16th: a 2-bin margin always, and a 6-bin margin when the neighbour is at least 30% as loud. A loud vibrato partial 4–5 bins away leaks its wobble into the measurement. Notes that are still being held count as neighbours even in frames where their peak is missing.
- **Fade vs hold** fits a line to the note's level in the medium window, skipping drum frames. The note fades if the slope is at least 6 dB/s *and* the drop is more than 2.5× the scatter around the line. Summing the rises and falls frame by frame doesn't work, because 0.4 dB of jitter per frame adds up to more than 10 dB a second. A note with vibrato counts as held.
- **Movement** is a 2.5–12 Hz wobble in pitch, brightness or loudness. Brightness and loudness count only on a note whose level is steady and that isn't fading: a dying note's upper partials sink into the background, so its brightness drifts. Loudness wobble also never counts while a sidechain is pumping. Frames with a drum sounding are skipped for all three.
- **Overtone vs note:** a peak counts as an overtone of a lower note only if that note also has a harmonic within two steps of it. Otherwise a melody would vanish as "the 6th harmonic" of a sine bass.
- **Vibrato** splits a sung note into two peaks at the ends of its swing. Peaks less than ¾ of a semitone apart merge into one note, and a peak may be up to ±45 cents from the note.
- **Octave doubling cannot be separated:** a note an octave above another has every partial on top of the lower note's partials. The band demo's piano leaves out the note the singer holds as it strikes, as a real pianist would.

## Tuning notes (song shape)

`structure()` looks at the last 12 s of history, sampled at 10 Hz:

- **Build-up:** the full-spectrum brightness rises, drum hits get denser and the level rises over 6 s. It needs 6.5 s of history first, because a song's opening would otherwise look like a build.
- **Drop:** the kick is back after at least 3 s without it, while music kept playing. A drop holds for 6 s.
- **Breakdown:** at most one drum hit in 3 s, after drums have been heard earlier. A chord change sometimes passes for a single hit.
