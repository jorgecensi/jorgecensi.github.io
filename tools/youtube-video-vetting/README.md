# YouTube video vetting

Tooling for auditing the `PRESET_LINKS` form-guide videos in
`personal-trainer/index.html` — checking that a link still resolves, that it
shows the right movement, and that it isn't a talking-head tutorial.

## Why this exists

You cannot watch a video from this container. `yt-dlp` is proxy-blocked, the
`youtube.com/watch` HTML bot-detects and redirects to `google.com/sorry`
(itself blocked), and headless Chromium can't reach youtube.com at all
(`ERR_CONNECTION_RESET`, even with the proxy CA added to the NSS store).

What *does* work is sampling **frames** and reading them as images.

## What works

| Need | Endpoint | Notes |
|---|---|---|
| Frames at ~25/50/75% | `https://i.ytimg.com/vi/<id>/hq{1,2,3}.jpg` | Never rate-limited. The workhorse. |
| Liveness / title / channel | `https://www.youtube.com/oembed?url=...&format=json` | 404 ⇒ video deleted or private. |
| Channel catalogue | InnerTube `browse` + `ANDROID` client | See `origym_catalogue.py`. |
| Duration / playability | InnerTube `player` + `ANDROID` client | `ytprobe.py`. **Heavily rate-limited** — see GOTCHAS. |

## Typical audit

```bash
python3 origym_catalogue.py UCJE6aPsWHvsUCEWxyqMGSTQ > origym.json   # channel index
./contact_sheet.sh out.png <videoId> [<videoId> ...]                 # frames to look at
```

Then *read the PNG as an image* and judge it. Six videos per sheet keeps the
labels legible.

## Reading a contact sheet

Signals that a video is **not** a clean direct-to-demo clip:

- a face filling the frame, addressing camera, especially with a name
  lower-third ("Sarah Ruback, Senior Pilates Instructor") — Howcast's format;
- a full-screen channel branding card (Live Lean TV, ARS CORPUS, Online
  Pilates Classes) appearing in the 25% sample;
- all three samples showing people talking and no exercise at all.

Signals it's fine: the movement is visible in every sample; an anatomy
side-panel ("MUSCLES WORKED") next to a live demo is fine — that's OriGym's
house style, not an intro.

## Limitation, stated plainly

The three samples are at ~25/50/75% of the runtime, so this method detects a
*substantial* talking segment. It cannot prove what the literal first seconds
contain — a 5-second lead-in on a 90-second clip would sit before the 25%
sample and go unseen. Storyboard sprite sheets (`/sb/<id>/...`) would give
dense early frames but require a `sigh` signature from the player response,
which is not obtainable here.

Videos under ~20s are self-evidently intro-free; most of the DAREBEE and
OriGym library falls in that bucket.
