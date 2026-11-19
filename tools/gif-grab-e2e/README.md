# GIF Grab e2e

Playwright specs for `/gif-grab/`.

```bash
cd tools/gif-grab-e2e
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # first run in a fresh container
./run.sh                 # every spec
./run.sh smoke.spec.js   # just one
```

`run.sh` builds the site, serves `_site/` on port 4017 and runs each `specs/*.spec.js`
with plain node. Playwright is pinned to 1.63.0 to match the image's Chromium
(build 1243); see the Playwright note in `AGENTS.md` if the image changes.

## No real network

Cloud containers can't reach X, `api.fxtwitter.com`, `api.vxtwitter.com` or
`*.twimg.com`, so `_helpers.js` answers all of them with Playwright routes:

- `api.fx` / `api.vx` in the object `launch()` returns are functions of the post id
  that return `{ status, body }`; a spec swaps them to simulate an outage, a missing
  post or a post without media. `fxPost(id, media)` builds an FxTwitter response.
- `video.twimg.com` serves `fixtures/clip.webm` (2 s of ffmpeg `testsrc`, 320×180;
  WebM because the headless shell has no H.264) so the preview plays.
- **Routes can't test CORS.** Playwright makes fulfilled responses pass CORS whatever
  headers you set, so a spec that reads a routed file proves nothing about the real
  host. The real `video.twimg.com` sends no CORS headers; that's why the app only
  links to the media and never fetches it.
- `launch({ ua })` sets the user agent, which is how the specs check the iPhone,
  Android and desktop save guides.

## Debug hook

`?debug=1` exposes `window.__gifGrab`: `state` (`post`, `busy`), `parseId()`,
`fromFx()`, `fromVx()`, `lookup()`, `go()`, `photoUrl()`, `platform`, `SOURCES`.
`?platform=ios|android|desktop` forces the save guide.
