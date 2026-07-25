#!/usr/bin/env python3
"""
Last step: trim a cropped pose to its tight alpha bounding box (no wasted
transparent padding) and downscale it to a sane size for a PWA — full-res
character-sheet crops are typically 300-600px on a side and 150-250KB,
which is overkill for something rendered at 30-70px in the UI.

Usage:
    python3 finalize_asset.py <in.png> <out.png> [--max-dimension 220]
"""
import argparse

from PIL import Image


def finalize(src: str, dst: str, max_dimension: int) -> None:
    im = Image.open(src).convert('RGBA')
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    scale = max_dimension / max(im.size)
    if scale < 1:
        new_size = (round(im.width * scale), round(im.height * scale))
        im = im.resize(new_size, Image.LANCZOS)
    im.save(dst, optimize=True)
    print(f'{dst}: {im.size}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('src')
    p.add_argument('dst')
    p.add_argument('--max-dimension', type=int, default=220)
    args = p.parse_args()
    finalize(args.src, args.dst, args.max_dimension)
