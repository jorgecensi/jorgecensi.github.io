---
description: Get pixel-art characters, scene backgrounds or an app icon for an app in this site. The owner generates the images with an outside AI tool from prompts you write, uploads them, and you turn them into crisp sprites with tools/pixel-sprite-sheet. Use when the owner asks for pixel art, character portraits, sprites, backgrounds or a new icon, or asks "can you make art for this".
---

# Pixel-art assets

There is no image generator or Aseprite in the cloud container. The workflow is:
you write prompts, the owner generates and uploads, you process and integrate.
Don't try to draw characters in code; generated art is far better.

## 1. Write the prompts

Give one shared style block plus one prompt per asset, ready to paste. Ask for
everything the processing needs: a flat magenta background, a grid of same-size
cells, no text, no borders.

**Shared style (characters):**
> 16-bit retro pixel art, crisp hard-edged pixels on a consistent pixel grid, no anti-aliasing, no blur, no gradients, no dithering noise. Limited palette of about 16 colours: <app palette, e.g. dark navy, deep teal, emerald green, warm skin tones, amber and a red accent>. 1-pixel dark outline around the figure. Character portrait, head and shoulders, three-quarter view facing slightly left. Character sheet: the same character 4 times in a 2×2 grid, same size and framing in every cell, with expressions **neutral**, **talking (mouth open)**, **worried/alarmed**, **happy/smiling**. Flat solid magenta background (#FF00FF) behind everything, no checkerboard, no shadows on the background, no text, no labels, no borders between cells.

Then one short paragraph per character: age range, skin, hair, clothes, one
prop, personality. Describe people without gendered pronouns. Non-human
characters (a robot, a villain) can have fewer poses; say which.

**Backgrounds:** same style, but "wide 16:9 background scene, no characters, no
text" instead of the portrait and grid part; magenta isn't needed. One per
mood or location the app has (for example calm/day, night, alarm).

**App icon:**
> 16-bit pixel art app icon, square, <subject>, <app background colour> filling the whole square, bold readable shape at small sizes, no text, crisp hard pixels, no anti-aliasing.

Tell the owner: PNG at the largest size the tool gives, and send it even if the
generator ignored the magenta and drew a checkerboard (then use
`tools/character-sheet-extraction/` for that sheet instead).

## 2. Process the uploads

Uploads land in `/root/.claude/uploads/<session>/`. Read
`tools/pixel-sprite-sheet/README.md` and `GOTCHAS.md` first.

```bash
T=tools/pixel-sprite-sheet/sprites.py
python3 -I $T period sheet.png                          # art-pixel size (a hint: may be 2x off)
python3 -I $T sheet sheet.png img/<app>/<name>.png --scale 8 --grid 2x2 --preview <scratch>/p.png
python3 -I $T sheet robot.jpg img/<app>/robot.png --scale 6 --grid 4x2 --inset 10 --pick 0,1,4,5,3
python3 -I $T sheet mixed.png img/<app>/villain.png --scale 8 --figures --pick 4,5
python3 -I $T bg scene.jpg img/<app>/bg-day.webp        # 688px WebP, ~25-40 KB
python3 -I $T icon icon.jpg img/<app>-icon              # -> -192.png and -512.png
```

**Read every `--preview`** before using a strip. Typical portrait strips are
about 75×79 px per frame and 20-40 KB. If a sprite is tiny or blocky, the scale
is wrong (try half or double).

Any upload you don't use (an extra character, an off-brief variant, an
unrelated file such as a zip): don't use it silently, ask the owner what it's for.

## 3. Use them in the app

- **Sprite strip:** one element per actor, with
  `background-image: url(strip.png)`, `background-size: <n*100>% 100%`,
  `background-position: <i/(n-1)*100>% 0`, `aspect-ratio: w / h` and
  `image-rendering: pixelated`. Keep an expression → frame map per character.
- **Backgrounds:** `background: url(bg.webp) center / cover`.
- **Precache:** add every new file to the app's service-worker precache list,
  and preload images before a scene that needs them so nothing pops in.
- **Bump** `SW_VERSION`/`CACHE_VERSION` (see AGENTS.md).

Cyber Quest is the reference implementation: `CHARS[*].sprite`, `Story.actor()`,
`restFace()`, the mouth flap in `speak()`, and per-scene `bg`.

## 4. Check

Use the `mobile-ui-check` skill: one screenshot per mood or background and per
expression state. Then commit the processed assets only (never the raw uploads)
and open the PR.
