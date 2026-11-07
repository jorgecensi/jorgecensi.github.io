---
description: Screenshot any page of this site at phone size and smoke-check it (failed requests, console errors, horizontal scroll) with tools/ui-check/shoot.js. Use whenever you change an app's UI and want to see it, before opening a PR, or when asked to "show", "screenshot" or "check on mobile". Don't hand-write a new Playwright script for this.
---

# Check a page on a phone-size screen

`tools/ui-check/shoot.js` already does the setup this repo needs (390×844 at 2×,
reduced motion, service workers blocked, problem report, exit code). Read
`tools/ui-check/README.md` once for the details.

## 1. Build and serve

```bash
/opt/rbenv/versions/3.3.6/bin/jekyll build 2>&1 | grep -iE "error|done"
curl -sf -o /dev/null http://localhost:4011/ || (cd _site && (python3 -m http.server 4011 --bind 127.0.0.1 >/dev/null 2>&1 &); sleep 1)
```

Rebuild after every edit; the static server reads `_site/` fresh on each request.
If `jekyll` isn't at that path, see the binstub caveat in AGENTS.md.

## 2. Shoot

```bash
SHOTS=<scratchpad>/shots
NODE_PATH="$(npm root -g)" node tools/ui-check/shoot.js /<app>/ --out $SHOTS
```

To reach a state behind clicks, write a steps file and pass `--steps`:

```js
module.exports = async ({ page, shot, sleep }) => {
  await page.click('[data-story-play]'); await sleep(300);
  await shot('after-click', false);   // false = viewport only
};
```

Many apps expose a `?debug=1` hook (`window.__<app>`; see AGENTS.md) that jumps
straight to a state: `await page.evaluate(() => window.__cyberQuest.story.open('ch2', 7))`.

## 3. Look

Read every PNG you produced. A clean problem report proves nothing about layout:
overlapping text, clipped buttons, unreadable contrast and art showing through
cards only show up in the image. Fix, rebuild, shoot again.

## Notes

- **Reduced motion is on by default** so fades aren't captured half-way (a
  screenshot taken during a 0.25 s fade looks dimmed). Pass `--motion` only to
  check animations.
- **Jumping into the middle of a flow can leave stale state** that a real player
  never sees (a title card still showing, a previous scene's background). Before
  calling a screenshot a bug, check whether a real tap-through gets there.
- **`hidden` vs CSS `display`**: if an element you hid still shows, a CSS rule
  probably sets `display` on it; add `[hidden] { display: none; }` for it.
