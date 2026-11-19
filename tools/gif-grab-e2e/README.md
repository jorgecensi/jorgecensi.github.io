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
`video.twimg.com`, so `_helpers.js` answers all of them with Playwright routes:

- `api.fx` / `api.vx` in the object `launch()` returns are functions of the post id
  that return `{ status, body }`; a spec swaps them to simulate an outage, a missing
  post or a post without media. `fxPost(id, media)` builds an FxTwitter response.
- `video.twimg.com` serves `fixtures/clip.webm` (2 s of ffmpeg `testsrc`, 320×180,
  10 fps; WebM because the headless shell has no H.264). A URL containing `NoCors`
  is aborted instead: Playwright makes fulfilled responses pass CORS, so a missing
  `Access-Control-Allow-Origin` header can't be simulated, but an aborted fetch
  throws the same TypeError the page gets from a CORS block.
- The browser caches fulfilled responses, so give a scenario that needs a different
  answer for a media file its own URL.

## Checking the GIF itself

`check_gif.py <gif> <clip> <fps> <width>` decodes the GIF with Pillow (an
independent decoder, so a bad LZW stream or frame offset fails even if Chromium is
lenient), composites every frame and compares it with the frame ffmpeg decodes
from the clip at the same moment. It needs `ffmpeg` and Pillow, both in the image.
The smoke spec converts at Small/10 fps so no scaling is involved; a mean error of
about 2/255 is normal (dithering).

## Debug hook

`?debug=1` exposes `window.__gifGrab`: `state` (`post`, `lastGif` blob,
`lastGifInfo`), `parseId()`, `fromFx()`, `fromVx()`, `lookup()`, `go()`,
`makeGif(src, { width, fps, maxSecs }, onProgress, signal)`, `medianCut()`,
`GifEncoder`, `SOURCES`.
