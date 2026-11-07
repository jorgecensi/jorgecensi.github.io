# UI check

Phone-size screenshots of any page on this site, plus a smoke check: failed
requests, console and page errors, and horizontal scroll. Use it to look at a
change before opening a PR (then actually look at the PNGs).

```bash
# 1. Build and serve (any free port; 4011 is the default the script expects)
/opt/rbenv/versions/3.3.6/bin/jekyll build
(cd _site && python3 -m http.server 4011 --bind 127.0.0.1 >/dev/null 2>&1 &)

# 2. Shoot
NODE_PATH="$(npm root -g)" node tools/ui-check/shoot.js /cyber-quest/
NODE_PATH="$(npm root -g)" node tools/ui-check/shoot.js /cyber-quest/?debug=1 --steps my-steps.js --out "$SCRATCH/shots"
```

Defaults: 390×844 at 2× (an iPhone-size viewport), reduced motion on (so fades
aren't caught half-way; pass `--motion` to see animations), service workers
blocked (a first-install `clients.claim()` can reload the page mid-script).
Exit code 1 means it found problems.

A steps file drives the page and names the shots:

```js
// my-steps.js
module.exports = async ({ page, shot, sleep }) => {
  await shot('home');
  await page.click('[data-story-play]');
  await sleep(300);
  await shot('story', false);   // false = viewport only, not full page
};
```

`NODE_PATH="$(npm root -g)"` uses the Playwright that ships with the cloud image,
which always matches its Chromium. Inside a pinned e2e suite directory, plain
`node` works too. See the Playwright caveat in AGENTS.md.
