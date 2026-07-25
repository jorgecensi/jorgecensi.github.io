#!/usr/bin/env python3
"""
Split a multi-pose character sheet (already RGBA with real transparency —
run reconstruct_transparency.py first if it isn't) into individual,
tightly-cropped pose images.

Approach:
1. Find connected components of non-transparent pixels. The handful of
   largest blobs are the actual character poses; everything else (sweat
   drops, motion lines, breath clouds, sparkles) is a small "effect" blob
   drawn near — but not touching — its parent pose.
2. Assign each small effect blob to its nearest main-pose blob by
   centroid distance, and grow that pose's bounding box to include it.
3. Pad each box a little, then crop. Poses on a dense sheet often end up
   with overlapping padded boxes — inspect the crops (e.g. composite each
   onto your app's real background color) and pass --overrides to nudge
   specific edges inward where one pose's box bleeds into a neighbor's
   limb. There's no fully automatic fix for that; trial and error against
   visual output is the normal workflow.

Usage:
    python3 extract_poses.py <sheet_rgba.png> <output_dir> \\
        [--min-main-size N] [--min-effect-size N] [--pad N]

Writes numbered crops (pose-00.png, pose-01.png, ...) plus a
poses_manifest.txt listing each crop's box, so you can rename the ones
you keep to meaningful names by hand.
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def extract(src: str, outdir: str, min_main_size: int, min_effect_size: int, pad: int) -> None:
    im = Image.open(src).convert('RGBA')
    arr = np.array(im)
    alpha = arr[:, :, 3]
    mask = alpha > 30

    labeled, n = ndimage.label(mask, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(labeled)
    sizes = ndimage.sum(mask, labeled, range(1, n + 1))

    blobs = []
    for i, sl in enumerate(objs):
        if sl is None:
            continue
        ys, xs = sl
        blobs.append({'size': sizes[i], 'box': (xs.start, ys.start, xs.stop, ys.stop)})
    blobs.sort(key=lambda b: -b['size'])

    main = [b for b in blobs if b['size'] >= min_main_size]
    effects = [b for b in blobs if b['size'] < min_main_size and b['size'] >= min_effect_size]

    def centroid(box):
        x0, y0, x1, y1 = box
        return (x0 + x1) / 2, (y0 + y1) / 2

    main_centroids = [centroid(m['box']) for m in main]
    merged = [list(m['box']) for m in main]

    for e in effects:
        ec = centroid(e['box'])
        dists = [((ec[0] - mc[0]) ** 2 + (ec[1] - mc[1]) ** 2) for mc in main_centroids]
        idx = dists.index(min(dists))
        x0, y0, x1, y1 = merged[idx]
        ex0, ey0, ex1, ey1 = e['box']
        merged[idx] = [min(x0, ex0), min(y0, ey0), max(x1, ex1), max(y1, ey1)]

    w, h = im.size
    os.makedirs(outdir, exist_ok=True)
    manifest = []
    for i, box in enumerate(merged):
        x0, y0, x1, y1 = box
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(w, x1 + pad)
        y1 = min(h, y1 + pad)
        crop = im.crop((x0, y0, x1, y1))
        name = f'pose-{i:02d}.png'
        crop.save(os.path.join(outdir, name))
        manifest.append(f'{name}: box=({x0},{y0},{x1},{y1}) size={crop.size}')
        print(manifest[-1])

    with open(os.path.join(outdir, 'poses_manifest.txt'), 'w') as f:
        f.write('\n'.join(manifest) + '\n')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('src')
    p.add_argument('outdir')
    p.add_argument('--min-main-size', type=int, default=30000,
                    help='pixel-count floor for a blob to count as a real pose (default 30000)')
    p.add_argument('--min-effect-size', type=int, default=30,
                    help='pixel-count floor for a blob to count as an effect worth merging, vs. noise (default 30)')
    p.add_argument('--pad', type=int, default=14, help='padding in px added around each merged box (default 14)')
    args = p.parse_args()
    extract(args.src, args.outdir, args.min_main_size, args.min_effect_size, args.pad)
