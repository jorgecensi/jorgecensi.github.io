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

## Mocked network

`_helpers.js` answers X, `api.fxtwitter.com`, `api.vxtwitter.com` and `*.twimg.com`
with Playwright routes, so the specs don't depend on X:

- `api.fx` / `api.vx` in the object `launch()` returns are functions of the post id
  that return `{ status, body }`; a spec swaps them to simulate an outage, a missing
  post or a post without media. `fxPost(id, media)` builds an FxTwitter response.
- `video.twimg.com` serves `fixtures/clip.webm` (2 s of ffmpeg `testsrc`, 320×180, 10 fps).
  **Like the real host, it answers 403 to any request that carries a Referer**, and
  records it in `referers`; the smoke spec asserts that list stays empty. A URL
  containing `Blocked` is aborted, which opens the save-by-hand panel.
- `launch({ ua })` sets the user agent (`ios`, `iosChrome`, `android`), which is how
  the specs check each device's save-by-hand steps.
- **Routes can't test CORS**: Playwright makes fulfilled responses pass CORS whatever
  headers you set. The browser also caches fulfilled responses, so give a scenario
  that needs a different answer for a media file its own URL.

## Checking against the real X

The session environment `jorgecensi.github.io` allows `api.fxtwitter.com`,
`api.vxtwitter.com`, `video.twimg.com` and `pbs.twimg.com`. On it, check real
headers with curl. The Referer is what matters:

```bash
U=https://video.twimg.com/tweet_video/<id>.mp4
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: https://jorgecensi.com' $U                                         # 200
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: https://jorgecensi.com' -H 'Referer: https://jorgecensi.com/' $U   # 403
```

The pinned Chromium here decodes X's H.264 MP4s, so you can also drive the built
page against a real post (`page.goto('http://localhost:<port>/gif-grab/')`, paste
the link, click `[data-act=save-mp4]` and `[data-act=make-gif]`).

## Checking the GIF itself

`check_gif.py <gif> <clip> <fps> <width>` decodes the GIF with Pillow (an
independent decoder, so a bad LZW stream or frame offset fails even if Chromium is
lenient), composites every frame and compares it with the frame ffmpeg decodes
from the clip at the same moment. It needs `ffmpeg` and Pillow, both in the image.
The smoke spec converts at Small/10 fps so no scaling is involved; a mean error of
about 2/255 is normal on the test pattern. Real camera footage scores about 6, and
fast motion can push the per-frame maximum past the threshold, because ffmpeg's
`fps` filter and the app's seeking can pick neighbouring frames.

## Debug hook

`?debug=1` exposes `window.__gifGrab`: `state` (`post`, `busy`, `lastGif`,
`lastGifInfo`), `parseId()`, `fromFx()`, `fromVx()`, `lookup()`, `go()`,
`photoUrl()`, `makeGif(src, { width, fps, maxSecs, tol }, onProgress, signal)`,
`medianCut()`, `GifEncoder`, `platform`, `SOURCES`. `?platform=ios|android|desktop`
forces the save-by-hand steps.
