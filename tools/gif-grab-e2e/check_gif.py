"""Check a GIF made by GIF Grab against the clip it was made from.

    python3 -I check_gif.py <out.gif> <clip.webm> <fps> <width>

Decodes the GIF with Pillow (an independent decoder, so a broken LZW stream or
bad frame offsets fail here even if Chromium is forgiving), composites every
frame, and compares each one with the frame ffmpeg decodes from the source at
the same moment. Prints a JSON summary; exits 1 if a check fails.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageSequence, ImageStat

gif_path, clip, fps, width = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])

im = Image.open(gif_path)
assert im.format == 'GIF', im.format
frames, t = [], 0
for fr in ImageSequence.Iterator(im):
    frames.append((t, fr.convert('RGB').copy()))
    t += fr.info.get('duration', 0)
loop = im.info.get('loop')

with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', clip, '-vf', f'fps={fps},scale={width}:-2',
                    f'{tmp}/f%04d.png'], check=True)
    ref = [Image.open(p).convert('RGB') for p in sorted(Path(tmp).glob('f*.png'))]

errs = []
for start, fr in frames:
    i = min(len(ref) - 1, round(start / 1000 * fps))
    r = ref[i].resize(fr.size)
    diff = ImageStat.Stat(ImageChops.difference(fr, r)).mean
    errs.append(sum(diff) / 3)

out = {
    'size': list(im.size),
    'frames': len(frames),
    'ms': t,
    'loop': loop,
    'meanErr': round(sum(errs) / len(errs), 2),
    'maxErr': round(max(errs), 2),
}
print(json.dumps(out))
ok = out['frames'] > 1 and loop == 0 and out['maxErr'] < 14
sys.exit(0 if ok else 1)
