---
description: Scaffold a new PWA in this Jekyll site. Creates <slug>/index.html, sw.js, manifest.json and icons, and wires up the home cards (EN + pt-BR), README, the cache-bump workflow and AGENTS.md.
argument-hint: [what the app should do]
---

You are adding a new standalone, offline-capable app (PWA) to this site. Every
recent app follows the same layout; copy it rather than inventing a new one.
Reference apps: `chroma/` (single file, canvas/audio) and `cyber-quest/`
(single file, multi-screen UI, e2e suite).

## 1. Decide the basics (don't interrogate the owner)

From `$ARGUMENTS` and the conversation, pick sensible defaults and state them in
one short list. Ask only if what the app should *do* is unclear.

| Field | Default |
|---|---|
| Name | From the request, e.g. "Cyber Quest" |
| Short name | ≤ 12 characters |
| Slug | kebab-case of the short name → `/<slug>/` |
| Theme colour | The app's dark background (most apps are dark navy), else `#6366f1` |
| Emoji | One emoji for the home card |
| Card tag | `PWA` or `Game` |

## 2. Create the files

```
<slug>/index.html      front matter `layout: null` + `permalink: /<slug>/`; the whole app in one file
<slug>/sw.js           copy of chroma/sw.js with the name swapped (below)
<slug>/manifest.json   copy of chroma/manifest.json, fields changed
img/<slug>-icon-192.png, img/<slug>-icon-512.png
```

```bash
mkdir -p <slug>
sed -e 's/chroma/<slug>/g' -e "s/CACHE_VERSION = '[^']*'/CACHE_VERSION = 'dev'/" chroma/sw.js > <slug>/sw.js
```

In `manifest.json`, set `id`, `start_url` and `scope` to `/<slug>/`, plus `name`,
`short_name`, `description`, `theme_color`, `background_color`, `categories`,
`orientation`, and the icon paths (`"purpose": "any maskable"`).

`index.html` essentials (copy the `<head>` and the service-worker block at the
bottom of `cyber-quest/index.html`, then rename):

- `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`,
  theme-color, `apple-mobile-web-app-*`, `<link rel="manifest" href="/<slug>/manifest.json">`,
  icon and apple-touch-icon links.
- `const SW_VERSION = 'dev';` (the workflow rewrites it), and registration of
  `/<slug>/sw.js?v=` + SW_VERSION with scope `/<slug>/`. Reload on
  `controllerchange` only if the page already had a controller; show an "update
  ready" prompt for the waiting worker.
- **Safe area (required):** `--safe-bottom: env(safe-area-inset-bottom, 0px)` on
  `:root`. Give the outermost container `padding-bottom: calc(<16-28>px + var(--safe-bottom))`,
  and do the same for every fixed or sticky bottom bar and floating button. If
  you centre the shell with flexbox on `body`, add `align-items: flex-start`, or
  the padding is lost once content scrolls (this bit personal-trainer).
- Colours as CSS variables, `prefers-reduced-motion` respected, and no layout
  wider than the viewport at 390 px.
- If the app has state worth testing, add a `?debug=1` hook (`window.__<app>`)
  from the start.

**Icons:** for a real icon, have the owner generate one (prompt in the
`pixel-art-assets` skill) and run
`python3 -I tools/pixel-sprite-sheet/sprites.py icon <upload> img/<slug>-icon`.
For a placeholder now, draw a simple shape on the theme colour with Pillow at
512 and 192 px, keeping it inside the central 80% (the maskable safe zone).

## 3. Wire it up (all four, or the app is half-installed)

1. **Home cards:** add an `<a class="app-card" href="/<slug>/">` after the last
   card in both `index.html` and `pt-BR/index.html` (Portuguese text, add
   "(em inglês)" if the app is English only). Copy a neighbour's markup.
2. **README.md:** one line in the Apps list.
3. **`.github/workflows/bump-pwa-cache-version.yml`:** four edits, mirroring `cyber_quest`:
   the `check` line under "Detect changed PWA files", the `changed` dict entry,
   an `if bump_all or changed[...]` block setting `CACHE_VERSION` in sw.js and
   `SW_VERSION` in index.html, and both files in the final `git add`.
4. **AGENTS.md:** add the app to the PWA list under Key caveats, and give it its
   own section (structure, debug hook, tests, "bump SW_VERSION/CACHE_VERSION
   together").

## 4. Verify

- `/opt/rbenv/versions/3.3.6/bin/jekyll build` exits 0.
- Use the `mobile-ui-check` skill: screenshot the app's screens at phone size,
  with no problems reported. Look at the images.
- If the app has real logic, copy `tools/cyber-quest-e2e/` (run.sh, package.json
  pinned to the image's Playwright, `_helpers.js`) and write a smoke spec.

Then branch, commit, push and open a draft PR as usual.
