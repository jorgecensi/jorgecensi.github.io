# Personal Trainer e2e specs

Playwright regression specs for the Personal Trainer PWA (`/personal-trainer`).
They previously lived only in an ephemeral session scratchpad, so each session
either rewrote them or worked without them — hence this directory.

## Running

```sh
cd tools/personal-trainer-e2e
npm install          # first time only; see "Playwright version" below
./run.sh             # every spec
./run.sh e2e.js      # just the named ones
```

`run.sh` builds the site, serves `_site/` on port 4001, runs the specs, and exits
non-zero if any fail. Failing specs print their last lines inline; full logs land
in a temp directory named at the end of the run. Set `SHOTS_DIR` yourself only if
you want to keep screenshots — the runner points it at a temp dir otherwise.

## Environment caveats

**Playwright version is pinned deliberately.** `package.json` pins `1.56.0`
exactly, with no caret. Browsers are pre-installed at `/opt/pw-browsers` and must
never be re-downloaded; a newer Playwright looks for a build directory that isn't
there and dies with `Executable doesn't exist at .../chromium_headless_shell-<N>`.
Install with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. If the base image changes, read
the build number from `ls /opt/pw-browsers` and match it against
`node_modules/playwright-core/browsers.json` to find the version to pin.

**Jekyll binstub.** `bundle exec jekyll` can fail with `command not found: jekyll`
in a fresh container even after a successful `bundle install`. `run.sh` falls back
to the binary reported by `gem environment`, so it works either way.

**Static server instead of `jekyll serve`.** `personal-trainer/{index.html,sw.js,
manifest.json}` contain no Liquid — Jekyll only strips the frontmatter — so a plain
`python3 -m http.server` over `_site/` is equivalent and starts much faster.

## Navigating the app from a spec

Two things reliably catch out new specs:

- **The exercise library is not on the home screen.** `#nav-library` lives on the
  setup/settings screen (moved there by `e281d87`). From home you must click
  `#nav-settings` first. Clicking `#nav-library` straight from home finds the button
  in the DOM but never visible, so it fails as a 30s click timeout rather than a
  missing-element error.
- **`[data-back]` ignores its own value.** Those buttons call `goBack()`, which pops
  browser history; `data-back="home"` is vestigial. Backing out of the library lands
  on `setup`, not `home`. `e2e.js` has a `backToHome()` helper that unwinds until the
  home screen is actually active — copy that pattern rather than assuming one back.

## A note on deleted coverage

`e2e-share-goal-modal.js` used to live here and was deleted rather than repaired.
It exercised a "Share a goal" picker modal (`#share-goal-modal`, `#share-goal-week`,
`#share-goal-streak`) from PR #283, which was **closed unmerged** — that feature has
never existed on `master`. Every assertion in the spec depended on it, so there was
nothing to salvage. `#btn-commit` shares the weekly commitment card directly, which
`e2e-commitment-card.js` covers. If the picker is ever revived, restore the spec from
history rather than rewriting it.
