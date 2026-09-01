# Auto Runner e2e specs

Playwright regression specs for the Auto Runner PWA (`/auto-runner`).

## Running

```sh
cd tools/auto-runner-e2e
npm install                  # first time only; see "Playwright version" below
./run.sh                     # every spec
./run.sh smoke.spec.js       # just the named one(s)
```

`run.sh` builds the site, serves `_site/` on port 4002 (override with `PORT=`),
runs each spec as a plain Node script, and exits non-zero if any fail. Failing
specs print their last 20 log lines inline; full logs land in a temp directory
named at the end of the run.

## Environment caveats

**Playwright version is pinned deliberately.** `package.json` pins `1.56.0`
exactly, with no caret. Browsers are pre-installed at `/opt/pw-browsers` (and
`PLAYWRIGHT_BROWSERS_PATH` points there) and must never be re-downloaded — a
newer Playwright looks for a build directory that isn't there and dies with
`Executable doesn't exist at .../chromium_headless_shell-<N>`. Install with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`. If the base image changes,
read the build number from `ls /opt/pw-browsers` and match it against
`node_modules/playwright-core/browsers.json` to find the version to pin.

**Jekyll binstub.** `bundle exec jekyll` can fail with `command not found:
jekyll` in a fresh container even after a successful `bundle install`.
`run.sh` falls back to the binary reported by `gem environment`.

**Static server instead of `jekyll serve`.** `auto-runner/{index.html,sw.js,
manifest.json}` contain no Liquid beyond the frontmatter, so a plain
`python3 -m http.server` over `_site/` is equivalent and starts much faster.

## The `?debug=1` API

`auto-runner/index.html` exposes `window.__autoRunner` only when the URL has
`?debug=1`:

- Read-only getters: `state`, `distance`, `stage`, `speed`, `mode`, `players`,
  `obstacles`.
- `stepOnce()` — runs one simulation step directly, bypassing the
  `requestAnimationFrame` loop.
- `setInput(playerIdx, down)` — presses (`down: true`) or releases
  (`down: false`) a player's jump, going through the same `doJump`/
  `releaseJump` path real input uses.

**Calling `stepOnce()` or `setInput()` even once disables the game's own
rAF-driven update loop for the rest of that page's life** — the test then
owns time completely, which is what makes `smoke.spec.js` fast and
deterministic. A spec that instead wants to exercise the *real* timing path
(`timestep.spec.js`) must never call either of those and should drive input
through `page.keyboard`/`page.mouse` instead, or the very mechanism it's
trying to test gets bypassed.

Loading with `?debug=1` also runs `validateChunk()` against every authored
chunk in `CHUNKS` at every stage speed it could spawn at, logging
`[auto-runner debug] all chunks validated OK` or a per-chunk failure —
`smoke.spec.js` asserts on that log line rather than re-implementing the
check.

## What each spec covers

- **smoke.spec.js** — drives the game via the debug API for 30 simulated
  seconds with a naive bot, asserting the state machine only ever visits
  `waiting`/`playing`/`paused`/`resuming`/`gameover`, that it actually reaches
  `playing` and `gameover` at least once, and that no chunk failed
  validation.
- **timestep.spec.js** — replaces `requestAnimationFrame` with a
  `setTimeout` firing at a controlled rate (30Hz and 120Hz), runs the *real*
  game for the same fixed wall-clock duration under each, and asserts the
  simulated distance is within 5% either way. This is what proves the fixed
  60Hz step accumulator (not the display's refresh rate) drives the
  simulation.
- **persistence.spec.js** — starts a run and never jumps, so both stationary
  players are guaranteed to die on the first obstacle; asserts `ar-best-v2`
  and `ar-stats` land in `localStorage` with a sane shape and survive a page
  reload.
