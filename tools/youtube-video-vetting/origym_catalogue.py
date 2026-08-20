#!/usr/bin/env python3
"""Dump a YouTube channel's full uploads list as JSON: [{vid,title,len}, ...].

Usage: python3 origym_catalogue.py <channelId>   # e.g. UCJE6aPsWHvsUCEWxyqMGSTQ (OriGym)

Uses the InnerTube `browse` endpoint with the ANDROID client. The WEB client
returns a page with no playlistVideoRenderer entries, and ANDROID paginates
with the legacy `nextContinuationData.continuation` key rather than
`continuationCommand.token` — both are handled here.
"""
import json, sys, time, urllib.request

KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip"
CTX = {"client": {"clientName": "ANDROID", "clientVersion": "20.10.38",
                  "androidSdkVersion": 30, "hl": "en", "gl": "US"}}


def post(payload):
    req = urllib.request.Request(
        f"https://www.youtube.com/youtubei/v1/browse?key={KEY}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA,
                 "Origin": "https://www.youtube.com"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def videos(node, out):
    if isinstance(node, dict):
        if "playlistVideoRenderer" in node:
            v = node["playlistVideoRenderer"]
            t = v.get("title", {})
            out.append({
                "vid": v.get("videoId"),
                "title": t.get("simpleText") or "".join(r.get("text", "") for r in t.get("runs", [])),
                "len": (v.get("lengthText") or {}).get("simpleText"),
            })
        for x in node.values():
            videos(x, out)
    elif isinstance(node, list):
        for x in node:
            videos(x, out)


def continuations(node, out):
    if isinstance(node, dict):
        nc = node.get("nextContinuationData") or {}
        if nc.get("continuation"):
            out.append(nc["continuation"])
        cc = node.get("continuationCommand") or {}
        if cc.get("token"):
            out.append(cc["token"])
        for x in node.values():
            continuations(x, out)
    elif isinstance(node, list):
        for x in node:
            continuations(x, out)


def main(channel_id):
    uploads = "UU" + channel_id[2:]
    d = post({"context": CTX, "browseId": "VL" + uploads})
    vids = []
    videos(d, vids)
    seen = {v["vid"] for v in vids}
    toks = []
    continuations(d, toks)
    tok = toks[-1] if toks else None
    while tok:
        d = post({"context": CTX, "continuation": tok})
        page = []
        videos(d, page)
        added = 0
        for v in page:
            if v["vid"] not in seen:
                seen.add(v["vid"])
                vids.append(v)
                added += 1
        toks = []
        continuations(d, toks)
        tok = toks[-1] if toks else None
        if not added:
            break
        time.sleep(0.6)
    json.dump(vids, sys.stdout, indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
