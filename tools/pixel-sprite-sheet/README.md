# Pixel sprite sheets

Turns AI-generated **pixel-art** character sheets (several expressions of one
character on a flat magenta `#FF00FF` background) into crisp, true-pixel RGBA
sprite strips, and scene paintings into small web backgrounds. Built for the
Cyber Quest cast (`img/cq/`), reusable for any app.

Use this for pixel art. For painted art on a fake checkerboard background (like
Barnaby the capybara), use `tools/character-sheet-extraction/` instead.

## Asking for art

Ask the image generator for: hard-edged pixel art, no anti-aliasing, a flat
solid magenta background (`#FF00FF`) with no checkerboard or shadows, the same
character in a grid of cells at identical size and framing, and no text or cell
borders. Generators often add borders anyway; `--inset` shaves them off.

## Commands

```
# How many screen pixels make up one art pixel? (a guide: see GOTCHAS.md)
python3 sprites.py period sheet.png

# A 2x2 sheet -> one strip of 4 frames, plus a 4x preview on the app background
python3 sprites.py sheet sheet.png ../../img/cq/mira.png --scale 8 --grid 2x2 --preview /tmp/mira.png

# A 4x2 sheet with divider lines; keep cells 0,1,4,5,3 in that order
python3 sprites.py sheet robot.jpg ../../img/cq/siem.png --scale 6 --grid 4x2 --inset 10 --pick 0,1,4,5,3

# A sheet that isn't a clean grid: split along empty background instead
python3 sprites.py sheet mixed.png ../../img/cq/lantern.png --scale 8 --figures --pick 4,5

# A 16:9 scene painting -> a 688px-wide WebP background
python3 sprites.py bg scene.jpg ../../img/cq/bg-day.webp
```

How `sheet` works: it keys out magenta, splits the cells, then rebuilds the true
pixel grid by averaging each `scale`×`scale` block's **foreground** pixels (so no
magenta bleeds into edges). A block is opaque when more than half of it is
foreground. Frames are aligned bottom-centre to one shared size and written side
by side, so CSS can show frame `i` of `n` with
`background-size: n*100% 100%; background-position: i/(n-1)*100% 0` and
`image-rendering: pixelated`.

Always look at the `--preview` before using a strip.

Requires Pillow and numpy (both present in the cloud image; no scipy needed).
