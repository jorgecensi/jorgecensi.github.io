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

The bottom tab bar is the app's root navigation, so every top-level destination is one
click: `#tabbar .tab[data-tab="home"|"progress"|"library"|"setup"]`. `e2e.js` wraps that
in a `gotoTab()` helper. This replaced two long-standing traps — the library being
reachable only via the settings screen, and `[data-back="home"]` not honouring its own
value — both of which are gone.

What still catches out new specs:

- **Only four screens are tabs.** `preview`, `player`, `complete`, `history`, `info`,
  `achievements` and `records` are sub-screens reached with `navigate()`, and their
  `[data-back]` buttons pop browser history. `#nav-history` and `#nav-info` live on the
  **Progress** tab, not Today — click that tab first or the click times out.
- **Tab switches replace the root history entry, they don't push.** Hopping between
  tabs never grows `history.length`, so `page.goBack()` after a few tab taps leaves the
  app rather than replaying them. `e2e-setup-back.js` asserts this.
- **Home is split.** Today holds the stats, session-length picker, Generate CTA and the
  weekly-goal card; Progress holds the heatmap, achievements, records and tier bars.
  Both are painted by the same `renderHome()`, and elements stay in the DOM whichever
  screen is active — so `page.textContent()` reads work from either tab, but
  `page.click()` needs the owning tab to be showing.
- **The app reloads itself on a cold profile.** `sw.js` calls `clients.claim()` and the
  page reloads on `controllerchange`, several times before it settles. Those reloads
  wipe the DOM out from under a mid-flight assertion. `e2e.js` has a `settle()` helper
  that waits for main-frame navigations to go quiet — use it after the first `goto()`
  and after any step that then reads freshly-rendered state.

## A note on deleted coverage

`e2e-share-goal-modal.js` used to live here and was deleted rather than repaired.
It exercised a "Share a goal" picker modal (`#share-goal-modal`, `#share-goal-week`,
`#share-goal-streak`) from PR #283, which was **closed unmerged** — that feature has
never existed on `master`. Every assertion in the spec depended on it, so there was
nothing to salvage. `#btn-commit` shares the weekly commitment card directly, which
`e2e-commitment-card.js` covers. If the picker is ever revived, restore the spec from
history rather than rewriting it.
