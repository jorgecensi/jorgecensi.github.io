# Gotchas discovered extracting Barnaby's poses

## 1. "Transparent" PNG from an image-gen tool often isn't

`Image.open(path).mode` comes back `RGB`, not `RGBA` — the transparency
checkerboard (or a solid color, seen on a different character sheet with a
black "transparent" background) is baked into real pixels. Always check
`.mode` and sample a corner pixel before assuming alpha exists.

## 2. Border-connected flood fill misses enclosed pockets

`reconstruct_transparency.py`'s core trick — label connected low-saturation
regions, keep only the ones touching the image border — correctly leaves
real character content untouched almost everywhere. But if a pose has a
gap that's **fully enclosed** by opaque character pixels (e.g. the sliver
of background visible between two raised arms, or between two legs), it's
topologically disconnected from the border and this pass can't reach it.
Symptom: after step 1, most of the pose is clean but one or two small
patches still show the checkerboard/solid color.

Fix: `patch_trapped_background.py`, scoped to a small manually-identified
window around just that pocket. Don't try to make step 1 catch everything
in one pass — spot-check every pose crop for these before calling it done.

## 3. Trapped-pocket color can be indistinguishable from real content

The first fix attempt for Barnaby's leg-gap pocket used a blanket "any
low-saturation, bright-enough pixel in this window is background" rule.
It worked for the pocket between his raised arms (surrounded by a
saturated green sleeve and gold trophy — easy to tell apart from
grayscale background). It did **not** work for the pocket between his
legs: his gray sweatpants and the checkerboard's shadow-tinted squares
are nearly the same RGB values in that specific lighting. The rule ate a
chunk of his actual pants.

Lesson: check what's actually adjacent to the pocket before picking a
method.
- Saturated neighbors (colored fabric, skin, props) → `--method bright`
  (color-based) is safe.
- Similarly low-saturation neighbors (another gray/white/black garment) →
  color can't discriminate; use `--method texture` instead. A checkerboard
  alternates tone at a small regular pitch (high local variance); a real
  solid-fill region shades smoothly (near-zero local variance). A local
  standard-deviation filter (`scipy.ndimage.uniform_filter` on the value
  and value² channels) separates them even when their *average* color is
  identical.

## 4. The texture check alone still misses flat tile interiors

Checkerboard tiles are ~20-25px squares. A small local-stddev window
(5-7px) sitting entirely inside one tile sees uniform color — locally
smooth, same as a real solid fill — so pure texture detection catches the
tile *edges* (where light meets dark) but leaves tile *centers* untouched
as isolated leftover specks. Combine texture detection with a narrow
"unambiguously brighter (or otherwise more extreme) than any real content
value in this specific window" rule to mop up the remainder. This only
works because you've already scoped to a small window where you know the
real content's actual value range (e.g. "these pants never get brighter
than ~160 in this lighting" → anything ≥200 in the window is safe to
treat as background).

## 5. Iterate against a screenshot, not raw pixel guesses

Manually reasoning about "is pixel (198, 122) inside my window" from
coordinates alone is error-prone and slow. Every fix in this pipeline
went through several rounds of: run the script → composite onto the
app's real background color → crop/zoom into just the problem area with
a coordinate grid overlaid → read off corrected numbers → re-run. Don't
skip the visual check to save a step; it's faster than debugging blind.
