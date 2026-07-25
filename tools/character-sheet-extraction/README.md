# Character sheet extraction

Turns an AI-generated "character sheet" image (several poses of one
character, laid out in a grid, with a fake — non-alpha — transparent
background) into clean, individually-cropped RGBA PNGs ready to drop into
`img/pt/` (or anywhere else) and reference directly in app code.

Built while extracting Barnaby-the-capybara's poses for the Personal
Trainer app's feedback buttons and achievement-unlock toast. Reuse this
whenever a new character sheet shows up — don't rebuild the pipeline from
scratch.

## Why this exists

Image-gen tools frequently export a "transparent" PNG that isn't actually
transparent: it's a flattened RGB image with the transparency-preview
checkerboard (or a solid color) baked into the pixels. `Image.open(...).mode`
will read `RGB`, not `RGBA`. Check this first — if `mode` is already
`RGBA` with real variation in the alpha channel, skip straight to
`extract_poses.py`.

## Pipeline

```
# 1. Reconstruct real alpha transparency from the fake checkerboard/solid bg
python3 reconstruct_transparency.py sheet.png sheet-rgba.png

# 2. Split into individual pose crops (inspect + iterate on padding/overrides)
python3 extract_poses.py sheet-rgba.png poses/

# 3. If a pose has a small enclosed background pocket the border-flood-fill
#    in step 1 couldn't reach (see GOTCHAS.md), patch it directly
python3 patch_trapped_background.py poses/pose-00.png poses/pose-00-fixed.png \
    --box 135,100,224,140 --method bright

# 4. Trim to tight bbox + downscale for app use
python3 finalize_asset.py poses/pose-00-fixed.png ../../img/pt/character-pose.png
```

At every step, **composite the result onto the app's actual background
color and look at it** before moving on — these are all heuristics tuned
per-image, not guaranteed-correct algorithms. A one-liner for that:

```python
from PIL import Image
im = Image.open('out.png')
bg = Image.new('RGB', im.size, (15, 21, 33))  # match your app's --bg
bg.paste(im, (0, 0), im)
bg.save('preview.png')
```

## Requirements

`pip install pillow numpy scipy` (numpy/scipy are usually already present;
if not, `pip install scipy` pulls both).

See `GOTCHAS.md` for the specific failure modes this pipeline exists to
avoid re-discovering.
