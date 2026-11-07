# Gotchas

- **Don't reduce the palette.** A shared median-cut palette (even 64 colours)
  turned Mira's teeth, eye whites and earring green: small light areas lose to
  large teal ones. The block averaging in `snap()` already yields clean colours,
  so the strips are saved without quantising.
- **`period` can report a multiple.** It said 12 for the SIEM robot sheet, which
  produced a 30×27 sprite; the art was really drawn at 6. On noisy scene JPEGs it
  can also bottom out at 3. If a sprite looks far too small or too blocky, try
  half or double, and check the preview.
- **Generators ignore "no borders".** The SIEM sheet came with dark divider lines
  between cells; `--inset 10` trims them.
- **Mixed sheets.** One upload had four portraits and two other figures on one
  canvas. `--figures` splits along empty magenta columns and rows (an XY cut),
  then `--pick` keeps the ones you want, ordered left-to-right, top-to-bottom.
- **A `[hidden]` rule may not hide anything.** If a CSS rule sets `display` on
  the element (Cyber Quest's `.avatar` sets `display: grid`), add an explicit
  `[hidden] { display: none; }` for it.
