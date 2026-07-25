#!/usr/bin/env python3
"""
Fix a small pocket of background trapped *inside* a character's silhouette
that reconstruct_transparency.py's border-flood-fill couldn't reach —
e.g. a gap between raised arms, or between legs, fully enclosed by opaque
character pixels on all sides so it's topologically disconnected from the
image border.

There is no single automatic rule for this; the right check depends on
what's actually adjacent to the pocket (see GOTCHAS.md):

  --method bright   Pocket is surrounded by SATURATED colors (a green
                     sleeve, a gold trophy, brown fur). A plain
                     "low-saturation and bright enough" rule is safe.

  --method texture   Pocket is surrounded by something similarly
                     low-saturation (gray sweatpants, a gray hoodie).
                     Color alone can't tell them apart, but a checkerboard
                     ALTERNATES tone at a small regular pitch (its
                     signature is high local variance), while a real
                     solid-fill region shades smoothly (near-zero local
                     variance). This uses a local standard-deviation
                     filter to catch the alternating edges, plus a narrow
                     "unambiguously brighter than any real fill in this
                     patch" rule to catch flat tile interiors the
                     variance check misses (checkerboard tiles have LOW
                     variance in their own interior too — only their
                     edges show the alternation).

Both methods are restricted to a small rectangular window you specify
(--box x0,y0,x1,y1) — found by cropping/zooming the pose and reading off
approximate pixel coordinates. Getting the window right normally takes
2-3 iterations: run, composite onto your app's real background color,
zoom in, and nudge the box or thresholds based on what leaked or what's
still opaque.

Usage:
    python3 patch_trapped_background.py <in.png> <out.png> \\
        --box 135,100,224,140 --method bright --min-value 90

    python3 patch_trapped_background.py <in.png> <out.png> \\
        --box 145,353,210,416 --method texture --std-threshold 8 --min-value 200
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage


def patch(src: str, dst: str, box: tuple[int, int, int, int], method: str,
          min_value: float, max_saturation: float, std_threshold: float, std_window: int) -> None:
    im = Image.open(src).convert('RGBA')
    arr = np.array(im).astype(np.float32)
    h, w = arr.shape[:2]

    x0, y0, x1, y1 = box
    window = np.zeros((h, w), dtype=bool)
    window[y0:y1, x0:x1] = True

    mx = arr[:, :, :3].max(axis=2)
    mn = arr[:, :, :3].min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    val = arr[:, :, :3].mean(axis=2)

    bright_rule = (sat < max_saturation) & (val >= min_value)

    if method == 'bright':
        candidate = bright_rule & window
    elif method == 'texture':
        gray = arr[:, :, :3].mean(axis=2)
        mean = ndimage.uniform_filter(gray, size=std_window)
        mean_sq = ndimage.uniform_filter(gray ** 2, size=std_window)
        std = np.sqrt(np.maximum(mean_sq - mean ** 2, 0))
        candidate = window & ((std > std_threshold) | bright_rule)
    else:
        raise ValueError(f'unknown method: {method}')

    alpha = arr[:, :, 3].astype(np.uint8).copy()
    n_before = int((alpha[window] == 255).sum())
    alpha[candidate] = 0
    out = np.dstack([arr[:, :, :3].astype(np.uint8), alpha])
    Image.fromarray(out, 'RGBA').save(dst)
    print(f'cleared {int(candidate.sum())} px in the window '
          f'({n_before} were opaque before) -> {dst}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('src')
    p.add_argument('dst')
    p.add_argument('--box', required=True, help='x0,y0,x1,y1 — the small window containing just the trapped pocket')
    p.add_argument('--method', choices=['bright', 'texture'], required=True)
    p.add_argument('--min-value', type=float, default=90, help='brightness floor for the "bright" rule (0-255)')
    p.add_argument('--max-saturation', type=float, default=0.10, help='saturation ceiling (0-1)')
    p.add_argument('--std-threshold', type=float, default=8, help='local-stddev floor for the "texture" rule')
    p.add_argument('--std-window', type=int, default=7, help='window size (px) for the local-stddev filter')
    args = p.parse_args()
    box = tuple(int(v) for v in args.box.split(','))
    patch(args.src, args.dst, box, args.method, args.min_value, args.max_saturation,
          args.std_threshold, args.std_window)
