#!/usr/bin/env python3
"""Thin, trim and re-encode tonejs-instruments samples for the Music Theory app.

Usage: build_samples.py <tonejs-instruments>/samples <out-dir>

For every instrument folder (piano is skipped: the app uses Salamander), keeps
mp3 samples at least MIN_GAP semitones apart, levels each note's loudness
(TARGET_DB, capped by PEAK_DB), trims it to MAX_SECS with a fade-out,
re-encodes to mono BITRATE mp3, and prints the JS `notes` lists to
paste into INSTRUMENTS in music-theory/index.html.
"""
import json
import os
import re
import subprocess
import sys

MIN_GAP = 3          # semitones between kept samples (Tone.Sampler repitches the rest)
MAX_SECS = 4.0
FADE_SECS = 0.6
BITRATE = '96k'
SKIP = {'piano'}
TARGET_DB = -16.0    # mean loudness of each note's first second after leveling
PEAK_DB = -1.0       # never boost a note past this peak

# Source files whose name is the wrong pitch, measured from their harmonic
# series: (instrument, source stem) -> the note it actually plays.
RELABEL = {('clarinet', 'Fs6'): 'F6'}   # 1398 Hz

PCS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
NAME = re.compile(r'^([A-G])(s?)(-?\d)$')   # tonejs-instruments writes A# as "As"


def midi_of(stem):
    m = NAME.match(stem)
    if not m:
        return None
    letter, sharp, octave = m.groups()
    return (int(octave) + 1) * 12 + PCS[letter] + (1 if sharp else 0)


def levels(path):
    """(mean dB over the first second, peak dB) of an audio file."""
    def detect(*extra):
        r = subprocess.run(['ffmpeg', '-v', 'info', *extra, '-i', path, '-af', 'volumedetect',
                            '-f', 'null', '-'], capture_output=True, text=True)
        mean = re.search(r'mean_volume: (-?[\d.]+) dB', r.stderr)
        peak = re.search(r'max_volume: (-?[\d.]+) dB', r.stderr)
        return float(mean.group(1)) if mean else None, float(peak.group(1)) if peak else 0.0
    mean, _ = detect('-t', '1')
    _, peak = detect()
    return mean, peak


def main(src, out):
    manifest = {}
    for inst in sorted(os.listdir(src)):
        d = os.path.join(src, inst)
        if inst in SKIP or not os.path.isdir(d):
            continue
        notes = []   # (midi, note name, source stem)
        for f in os.listdir(d):
            src_stem = f[:-4]
            name = RELABEL.get((inst, src_stem), src_stem)
            if f.endswith('.mp3') and midi_of(name) is not None:
                notes.append((midi_of(name), name, src_stem))
        kept = []
        for note in sorted(notes):
            if not kept or note[0] - kept[-1][0] >= MIN_GAP:
                kept.append(note)
        os.makedirs(os.path.join(out, inst), exist_ok=True)
        for _, stem, src_stem in kept:
            src_path = os.path.join(d, src_stem + '.mp3')
            mean, peak = levels(src_path)
            gain = 0.0 if mean is None else min(TARGET_DB - mean, PEAK_DB - peak)
            subprocess.run([
                'ffmpeg', '-v', 'error', '-y', '-i', src_path,
                '-t', str(MAX_SECS), '-ac', '1',
                '-af', f'volume={gain:.2f}dB,afade=t=out:st={MAX_SECS - FADE_SECS}:d={FADE_SECS}',
                '-b:a', BITRATE, os.path.join(out, inst, stem + '.mp3'),
            ], check=True)
        manifest[inst] = [stem for _, stem, _ in kept]
        print(f"      {inst}: {json.dumps(manifest[inst])},")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
