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
