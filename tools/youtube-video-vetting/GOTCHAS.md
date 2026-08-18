# Gotchas

## The `player` endpoint rate-limits hard, and stays limited

Sweeping ~100 videos through InnerTube `player` back-to-back gets the
container's IP flagged. Every later call returns
`playabilityStatus.status = LOGIN_REQUIRED` ("Sign in to confirm you're not a
bot"), *including for videos that answered fine minutes earlier*. It did not
decay within ~20 minutes of idling.

Consequences:

- Don't treat `LOGIN_REQUIRED` as "this video is broken" — it says nothing
  about the video. Use **oEmbed** to test liveness; a real dead video returns
  **404 there** (that's how `mob-deepsquat` / `EK-Xn1JFeAw` was caught).
- Get durations early if you need them, or pace the sweep.
- The `browse` endpoint is a *separate* budget and kept working throughout —
  channel catalogues are safe to pull after `player` is blocked.

## Stream URLs are useless — don't build on them

The `ANDROID` client returns un-ciphered `googlevideo.com` URLs, which makes
downloading look feasible. It isn't: every request returns **HTTP 403**
(server-side, not the proxy — the CONNECT tunnel succeeds). YouTube requires
PoToken attestation. `IOS` behaves the same; `TVHTML5` / `WEB_EMBEDDED` /
`MWEB` return no formats at all. Frames via `i.ytimg.com` are the only route.

## Captions are not available either

The `ANDROID` client omits `captionTracks`, and the `WEB` client — which does
return them — answers `UNPLAYABLE` without a PoToken. So you cannot read a
transcript to detect "hey guys, welcome back".

## Blank thumbnails are a real state

Some videos serve hq1/hq2/hq3 as an identical ~1.3 KB placeholder (e.g.
`cpRASoVJ0xI`). The video is alive — oEmbed resolves it — but it cannot be
vetted this way. Check the byte size before concluding the frames are black.

## ffmpeg `drawtext` chokes on `%`

`drawtext=text='25%'` fails with `Stray %`. Drop the percent signs or escape
them; the label is the only place this bites.
