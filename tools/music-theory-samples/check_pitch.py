#!/usr/bin/env python3
"""Flag samples whose measured pitch class doesn't match their file name.

Usage: check_pitch.py <samples-dir>     (e.g. music-theory/samples)

Estimates each note's fundamental with a harmonic product spectrum and prints
the ones more than 0.6 semitone off in pitch class. The estimator sometimes
locks onto an overtone (most often the 3rd harmonic: an octave and a fifth up,
reported as pc_err -5), so check each flagged file's spectral peaks before
relabeling: evenly spaced peaks at the expected fundamental mean the sample is
fine. A genuine mislabel goes in RELABEL in build_samples.py.
"""
import os
import re
import subprocess
import sys

import numpy as np

PCS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(stem):
    letter, sharp, octave = re.match(r'^([A-G])(s?)(\d)$', stem).groups()
    return (int(octave) + 1) * 12 + PCS[letter] + (1 if sharp else 0)


def f0(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ss', '0.15', '-t', '1.0',
                          '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32).astype(float)
    x -= x.mean()
    n = len(x)
    mag = np.abs(np.fft.rfft(x * np.hanning(n), 4 * n))
    freqs = np.fft.rfftfreq(4 * n, 1 / 22050)
    hps = mag.copy()
    for h in (2, 3, 4):
        d = mag[::h]
        hps[:len(d)] *= d
    lo, hi = np.searchsorted(freqs, 25), np.searchsorted(freqs, 4200)
    return freqs[lo + np.argmax(hps[lo:hi])]


def main(root):
    bad = total = 0
    for inst in sorted(os.listdir(root)):
        d = os.path.join(root, inst)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.mp3'):
                continue
            expected = midi(f[:-4])
            hz = f0(os.path.join(d, f))
            got = 69 + 12 * np.log2(hz / 440)
            pc_err = ((got - expected + 6) % 12) - 6
            total += 1
            if abs(pc_err) > 0.6:
                bad += 1
                print(f'{inst}/{f}: expected {expected}, measured {got:.1f} ({hz:.0f} Hz) pc_err {pc_err:+.1f}')
    print(f'{bad} of {total} off by more than 0.6 semitone (pitch class)')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
