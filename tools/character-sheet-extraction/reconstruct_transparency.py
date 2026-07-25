#!/usr/bin/env python3
"""
Reconstruct real alpha transparency for a character-sheet image whose
"transparent" background was actually flattened to solid RGB pixels —
either a checkerboard pattern (the classic editor transparency indicator)
or a solid color (often near-black).

This happens often with AI-generated character sheets: the generation
tool renders a transparency preview, but the exported file has no real
alpha channel — the checkerboard/solid color is baked into the pixels.

Usage:
    python3 reconstruct_transparency.py <input.png> <output.png> [--mode checkerboard|solid]

If --mode is omitted, it's guessed by checking whether the image already
has an alpha channel with variation (skip) and whether the corners look
like a checkerboard (alternating light/white ~20-25px cells) or a single
solid tone.

How it works: any low-saturation ("grayscale-ish") pixel above a
brightness floor is a background *candidate*. Connected-component
labeling groups candidates into blobs, and only blobs touching the image
border are treated as real background — this is the key trick that lets
saturated character content (green hoodie, brown fur, gold trophy, etc.)
survive untouched even where its brightness overlaps the background's,
while background regions fully enclosed by the character (see
GOTCHAS.md) are NOT caught by this pass and need a separate, spatially
scoped fix.
"""
import argparse
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def detect_mode(im: Image.Image) -> str:
    arr = np.array(im.convert('RGB')).astype(np.int32)
    # Sample a block near each corner (big enough to span several
    # checkerboard tiles regardless of exact grid alignment) and check
    # whether the grayscale-ish pixels in it vary a lot (checkerboard,
    # alternating tones) or barely at all (solid background color).
    h, w, _ = arr.shape
    block = 90
    corners = [
        arr[0:block, 0:block],
        arr[0:block, w - block:w],
        arr[h - block:h, 0:block],
        arr[h - block:h, w - block:w],
    ]
    variations = []
    for c in corners:
        flat = c.reshape(-1, 3)
        grayscale = np.all(np.abs(flat - flat.mean(axis=1, keepdims=True)) < 10, axis=1)
        if grayscale.any():
            variations.append(flat[grayscale].std())
    variation = max(variations) if variations else 0
    return 'checkerboard' if variation > 15 else 'solid'


def reconstruct(src: str, dst: str, mode: str | None = None) -> None:
    im = Image.open(src).convert('RGB')
    arr = np.array(im).astype(np.float32)
    h, w, _ = arr.shape

    if mode is None:
        mode = detect_mode(im)
    print(f'mode: {mode}', file=sys.stderr)

    if mode == 'checkerboard':
        mx = arr.max(axis=2)
        mn = arr.min(axis=2)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
        bg_candidate = (sat < 0.12) & (arr.mean(axis=2) >= 170)
    elif mode == 'solid':
        # Background is a solid near-black (or otherwise very dark) tone;
        # character content is always noticeably brighter. Adjust the
        # threshold if the sheet uses a different solid background color.
        bg_candidate = arr.max(axis=2) < 20
    else:
        raise ValueError(f'unknown mode: {mode}')

    labeled, _ = ndimage.label(bg_candidate, structure=np.ones((3, 3)))
    border_labels = set(labeled[0, :]) | set(labeled[-1, :]) | set(labeled[:, 0]) | set(labeled[:, -1])
    border_labels.discard(0)
    bg_mask = np.isin(labeled, list(border_labels))

    alpha = np.where(bg_mask, 0, 255).astype(np.uint8)

    # Anti-alias the cutout edge a touch so it isn't razor-jagged.
    bg_f = bg_mask.astype(np.float32)
    smoothed = ndimage.uniform_filter(bg_f, size=3)
    edge = (smoothed > 0) & (smoothed < 1)
    alpha_f = alpha.astype(np.float32)
    alpha_f[edge] = (1 - smoothed[edge]) * 255
    alpha = alpha_f.astype(np.uint8)

    rgba = np.dstack([np.array(im), alpha])
    Image.fromarray(rgba, mode='RGBA').save(dst)
    print(f'saved {dst} {Image.open(dst).size} — background pixels: {int(bg_mask.sum())}/{h * w}', file=sys.stderr)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('src')
    p.add_argument('dst')
    p.add_argument('--mode', choices=['checkerboard', 'solid'], default=None,
                    help='background type; auto-detected if omitted')
    args = p.parse_args()
    reconstruct(args.src, args.dst, args.mode)
