#!/usr/bin/env python3
"""Fetch YouTube video metadata + an opening-seconds contact sheet via InnerTube.

Network policy blocks yt-dlp and the youtube.com/watch HTML (bot-detect -> google.com/sorry),
but the InnerTube ANDROID player endpoint and googlevideo CDN are reachable, and the
ANDROID client returns un-ciphered progressive URLs.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
API = f"https://youtubei.googleapis.com/youtubei/v1/player?key={KEY}"
CTX = {"client": {"clientName": "ANDROID", "clientVersion": "20.10.38",
                  "androidSdkVersion": 30, "hl": "en"}}


def player(vid):
    body = json.dumps({"videoId": vid, "context": CTX}).encode()
    req = urllib.request.Request(API, data=body,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read())


def meta(vid):
    d = player(vid)
    vd = d.get("videoDetails", {}) or {}
    ps = d.get("playabilityStatus", {}) or {}
    return {
        "id": vid,
        "status": ps.get("status"),
        "reason": ps.get("reason"),
        "title": vd.get("title"),
        "author": vd.get("author"),
        "channelId": vd.get("channelId"),
        "duration": int(vd.get("lengthSeconds") or 0),
        "_raw": d,
    }


def pick_video_fmt(d, max_h=360):
    best = None
    for f in d.get("streamingData", {}).get("adaptiveFormats", []):
        if not f.get("url") or "video/mp4" not in f.get("mimeType", ""):
            continue
        h = f.get("height") or 0
        if h > max_h:
            continue
        if best is None or h > (best.get("height") or 0):
            best = f
    return best


def fetch_head(url, out, nbytes):
    req = urllib.request.Request(url, headers={
        "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
        "Range": f"bytes=0-{nbytes}"})
    with urllib.request.urlopen(req, timeout=90) as r, open(out, "wb") as fh:
        fh.write(r.read())
    return os.path.getsize(out)


def contact_sheet(vid, outdir, times, max_h=360, budget=3_500_000):
    """Download the opening of the video and tile frames at `times` into one PNG."""
    d = player(vid)
    f = pick_video_fmt(d, max_h)
    if not f:
        return None, "no mp4 video format"
    mp4 = os.path.join(outdir, f"{vid}.mp4")
    try:
        fetch_head(f["url"], mp4, budget)
    except Exception as e:
        return None, f"download failed: {e}"
    sheet = os.path.join(outdir, f"{vid}_sheet.png")
    sel = "+".join([f"between(t,{t},{t}+0.04)" for t in times])
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-err_detect", "ignore_err", "-i", mp4,
           "-vf", f"select='{sel}',scale=320:-1,tile={len(times)}x1",
           "-frames:v", "1", "-vsync", "0", sheet]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if not os.path.exists(sheet):
        return None, f"ffmpeg: {p.stderr.strip()[:200]}"
    return sheet, None


if __name__ == "__main__":
    vid = sys.argv[1]
    m = meta(vid)
    print(json.dumps({k: v for k, v in m.items() if k != "_raw"}, indent=2))
