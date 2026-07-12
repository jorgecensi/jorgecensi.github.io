# AGENTS.md

## Cursor Cloud specific instructions

This is a **Jekyll static site** (personal portfolio/blog) served on **port 4000**.

### Running the dev server

```
bundle exec jekyll serve --host 0.0.0.0 --port 4000 --livereload
```

### Key caveats

- **Bundle path**: Gems must be installed outside the workspace (e.g. `~/.bundle`) to avoid Jekyll scanning the `vendor/` directory and failing on invalid date frontmatter in bundled gem templates. The global Bundler config at `~/.bundle/config` sets `path: "/home/ubuntu/.bundle"` for this purpose.
- **No linting or test suite**: This project has no configured linter (ESLint, Rubocop, etc.) or automated tests. Validation is done via `bundle exec jekyll build` (should exit 0).
- **Build warning**: `Layout 'feed' requested in blog/atom.xml does not exist` is a known benign warning; it does not affect site functionality.
- **PWAs**: The CrossFit Timer (`/crossfit-timer`) and Flappy Bird (`/flappy`) are fully client-side PWAs requiring no additional services.
- **Restarting `jekyll serve`**: `jekyll serve` (without `--watch`) reads files fresh from `_site/` on every request, so after editing a file just re-run `bundle exec jekyll build` — no server restart needed. If you do `pkill -f "jekyll serve"` to stop a `run_in_background` server, the harness reports that background task as "failed" (exit 144, i.e. SIGTERM) even though the kill succeeded; this is expected, not a real error — verify by curling the port or just start a new background server instead of killing the old one.

### Personal Trainer app (`/personal-trainer`)

- **Keep the "How it Works" page in sync**: the `#info` screen in `personal-trainer/index.html` documents the progression mechanics in user-facing terms. Whenever those mechanics change — tier math (`SCORE_PER_TIER`, `MAX_SCORE`, `TIER_LABELS`, `tierCap`), feedback deltas (`FEEDBACK_DELTA`), dose growth (`doseFor`), exercise-pool selection (`pickPool`), rest durations (`restSecs` in `generateWorkout`), the streak window, or starting scores (`LEVEL_START`) — update the `#info` page copy in the same change so it never drifts from the code.
- **Bump the SW cache version on any PWA change**: when editing `personal-trainer/index.html`, `sw.js`, or `manifest.json` on a working branch, bump `CACHE_VERSION` (sw.js) and `SW_VERSION` (index.html) together so installed apps pick the change up. (A GitHub workflow also auto-bumps on merge to master, so an explicit bump is belt-and-braces, but new precached assets must be added to `PRECACHE_URLS` manually.)
- **Preferred video source for `PRESET_LINKS`**: the owner prefers the DAREBEE Exercise Library (YouTube playlist `PLQSMS0J6JbrKdSOSbyJXaQ_zN_HSSp7zZ`, videos titled "Exercise Library: <Name>") for exercise form-guide presets. When adding or updating presets, use the Darebee video if one exists for the movement; fall back to another clean landscape (non-Shorts) demo otherwise. Note: this environment's network policy blocks youtube.com/darebee.com, so discover Darebee video IDs via web search with exact-title queries like `youtube "Exercise Library: Side Planks"`.
