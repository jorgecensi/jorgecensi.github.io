# Music Theory instrument samples

Builds `music-theory/samples/<instrument>/*.mp3` from
[tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) and
checks the result. Credits for the recordings are in
`music-theory/samples/CREDITS.md`.

## Rebuilding

```sh
# Only the mp3s (the repo also holds ogg and wav: ~3x the download).
git clone --depth 1 --filter=blob:none --sparse https://github.com/nbrosowsky/tonejs-instruments ti
git -C ti sparse-checkout set --no-cone '/samples/*/*.mp3' '/sample-source-info.txt'
python3 build_samples.py ti/samples ../../music-theory/samples
python3 check_pitch.py ../../music-theory/samples
```

`build_samples.py` skips the piano (the app uses Salamander), keeps samples
at least 3 semitones apart (Tone.Sampler repitches the rest), levels each
note to about -16 dB over its first second (capped at a -1 dB peak), trims it to
4 s with a fade-out, and writes 96 kbps mono mp3: about 11 MB for all 19
instruments, versus 66 MB for the source mp3s. It prints each instrument's
`notes` list; paste those into `INSTRUMENTS` in `music-theory/index.html`
whenever they change.

## Gotchas

- **Fetch blobs in one go.** `git ls-tree -l` on a blobless clone fetches each
  blob in its own request and takes many minutes. A sparse checkout fetches
  them in one batch.
- **The source has a mislabeled note.** `clarinet/Fs6.mp3` actually plays F6
  (1398 Hz), so `RELABEL` in `build_samples.py` renames it. Run
  `check_pitch.py` after any rebuild.
- **`check_pitch.py` has false positives.** On low brass notes and the violin's
  open G it can lock onto the 3rd harmonic (reported as `pc_err -5`), and the
  xylophone's inharmonic overtones throw off `G6`. Those four flags are expected.
  Look at the spectral peaks before relabeling: harmonics evenly spaced at the
  expected fundamental mean the file is fine.
- **Plucked and struck sounds stay a few dB quieter** (guitars, harp,
  xylophone). Their attack hits the peak cap before the first-second average
  reaches the target. A sharp attack tends to sound louder than its average
  level, so this is probably fine, but nobody has checked it by ear yet.
