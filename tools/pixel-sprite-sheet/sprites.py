#!/usr/bin/env python3
"""Turn AI-generated pixel-art sheets on a flat magenta background into crisp,
true-pixel RGBA sprite strips, and scene paintings into small web backgrounds.

  sprites.py sheet  IN OUT --scale 8 --grid 2x2 [--inset 0] [--pick 0,1,2,3]
  sprites.py sheet  IN OUT --scale 8 --figures [--pick 4,5]
  sprites.py bg     IN OUT --width 688
  sprites.py period IN...            # estimate the art-pixel size of a sheet

OUT for `sheet` is a horizontal strip: every frame is cropped to the same
union box, so frames stay aligned and CSS can step through them. See README.md.
"""
import argparse
import numpy as np
from PIL import Image

BG_PREVIEW = (11, 18, 32)  # the app's --bg, for previews


def key_mask(a):
    """True where a pixel is foreground. Magenta (and its darker/lighter blends) is background."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return ~((r > 110) & (b > 110) & (g < 0.6 * np.minimum(r, b)))


def snap(cell, s):
    """Rebuild the true pixel grid: one output pixel per s×s block.
    Colour = mean of the block's foreground pixels (so magenta never bleeds in),
    alpha = opaque when more than half the block is foreground."""
    a = np.asarray(cell.convert('RGB')).astype(float)
    m = key_mask(a).astype(float)
    h, w = (a.shape[0] // s) * s, (a.shape[1] // s) * s
    a, m = a[:h, :w], m[:h, :w]

    def blk(x):
        return x.reshape(h // s, s, w // s, s, *x.shape[2:]).sum(axis=(1, 3))

    cov = blk(m)
    rgb = blk(a * m[..., None]) / np.maximum(cov, 1)[..., None]
    alpha = (cov / (s * s) > 0.5) * 255
    return np.dstack([rgb, alpha]).astype(np.uint8)


def grid_cells(im, cols, rows, inset=0):
    W, H = im.size
    cw, ch = W / cols, H / rows
    return [im.crop((int(c * cw) + inset, int(r * ch) + inset, int((c + 1) * cw) - inset, int((r + 1) * ch) - inset))
            for r in range(rows) for c in range(cols)]


def _runs(occupied, min_gap):
    spans, start, gap = [], None, 0
    for i, v in enumerate(occupied):
        if v:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                spans.append((start, i - gap + 1))
                start, gap = None, 0
    if start is not None:
        spans.append((start, len(occupied) - gap))
    return spans


def figure_cells(im, min_gap=12, min_size=150):
    """XY-cut: split along empty background columns, then rows. For sheets that aren't a clean grid."""
    m = key_mask(np.asarray(im.convert('RGB')).astype(float))
    boxes = []
    for x0, x1 in _runs(m.sum(axis=0) > 3, min_gap):
        for y0, y1 in _runs(m[:, x0:x1].sum(axis=1) > 3, min_gap):
            if x1 - x0 >= min_size and y1 - y0 >= min_size:
                boxes.append((x0, y0, x1, y1))
    boxes.sort(key=lambda b: (b[0] // 300, b[1]))
    return [im.crop(b) for b in boxes]


def align(frames, pad=1):
    """Pad every frame to a common size (bottom-centred, like a portrait), then crop to the union box."""
    H = max(f.shape[0] for f in frames)
    W = max(f.shape[1] for f in frames)
    out = []
    for f in frames:
        c = np.zeros((H, W, 4), np.uint8)
        y, x = H - f.shape[0], (W - f.shape[1]) // 2
        c[y:y + f.shape[0], x:x + f.shape[1]] = f
        out.append(c)
    ys, xs = np.where(np.any([f[..., 3] > 0 for f in out], axis=0))
    y0, y1 = max(ys.min() - pad, 0), ys.max() + 1 + pad
    x0, x1 = max(xs.min() - pad, 0), xs.max() + 1 + pad
    return [f[y0:y1, x0:x1] for f in out]


def strip(frames):
    h, w = frames[0].shape[:2]
    out = Image.new('RGBA', (w * len(frames), h))
    for i, f in enumerate(frames):
        out.paste(Image.fromarray(f, 'RGBA'), (i * w, 0))
    return out


def preview(img, path, zoom=4):
    bg = Image.new('RGBA', img.size, BG_PREVIEW + (255,))
    bg.alpha_composite(img)
    bg.resize((img.width * zoom, img.height * zoom), Image.NEAREST).save(path)


def period(path):
    """Estimate the art-pixel size from how often colour edges repeat. A guide, not gospel:
    it can report a multiple (try half) or hit the bottom of its range on noisy JPEGs."""
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    res = {}
    for axis, name in ((1, 'x'), (0, 'y')):
        d = np.abs(np.diff(a, axis=axis)).sum(axis=2)
        prof = d.sum(axis=0 if axis == 1 else 1)
        prof = prof - prof.mean()
        ac = np.correlate(prof, prof, 'full')[len(prof) - 1:]
        ac /= ac[0]
        lag = int(np.argmax(ac[3:40]) + 3)
        res[name] = (lag, round(float(ac[lag]), 2))
    return res


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('sheet')
    s.add_argument('src'); s.add_argument('out')
    s.add_argument('--scale', type=int, required=True, help='screen pixels per art pixel')
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument('--grid', help='COLSxROWS, e.g. 2x2')
    g.add_argument('--figures', action='store_true', help='split along empty background instead of a grid')
    s.add_argument('--inset', type=int, default=0, help='pixels to shave off each grid cell (divider lines)')
    s.add_argument('--pick', help='comma-separated cell indexes to keep, in order')
    s.add_argument('--preview', help='also write a 4x preview on the app background')
    b = sub.add_parser('bg')
    b.add_argument('src'); b.add_argument('out'); b.add_argument('--width', type=int, default=688)
    b.add_argument('--quality', type=int, default=80)
    pr = sub.add_parser('period'); pr.add_argument('src', nargs='+')
    a = p.parse_args()

    if a.cmd == 'period':
        for f in a.src:
            print(f, period(f))
    elif a.cmd == 'bg':
        im = Image.open(a.src).convert('RGB')
        im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
        im.save(a.out, quality=a.quality, method=6)
        print(a.out, im.size)
    else:
        im = Image.open(a.src)
        if a.figures:
            cells = figure_cells(im)
        else:
            c, r = map(int, a.grid.lower().split('x'))
            cells = grid_cells(im, c, r, a.inset)
        if a.pick:
            cells = [cells[int(i)] for i in a.pick.split(',')]
        frames = align([snap(c, a.scale) for c in cells])
        out = strip(frames)
        out.save(a.out, optimize=True)
        if a.preview:
            preview(out, a.preview)
        print(a.out, f'{len(frames)} frames of {frames[0].shape[1]}x{frames[0].shape[0]}')


if __name__ == '__main__':
    main()
