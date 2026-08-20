#!/bin/bash
# contact_sheet.sh <out.png> <videoId> [<videoId> ...]
# One row per video: frames at ~25/50/75% of the runtime, labelled with the id.
# Read the resulting PNG as an image to judge whether the clip is direct-to-demo.
set -euo pipefail
out=$1; shift
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
rows=()
for v in "$@"; do
  for f in hq1 hq2 hq3; do
    curl -sS --max-time 30 -o "$tmp/${v}_$f.jpg" "https://i.ytimg.com/vi/$v/$f.jpg"
  done
  # a ~1.3KB placeholder means this video has no usable sampled frames
  if [ "$(stat -c%s "$tmp/${v}_hq1.jpg")" -lt 2000 ]; then
    echo "warning: $v serves placeholder thumbnails; cannot vet from frames" >&2
  fi
  ffmpeg -y -loglevel error \
    -i "$tmp/${v}_hq1.jpg" -i "$tmp/${v}_hq2.jpg" -i "$tmp/${v}_hq3.jpg" \
    -filter_complex "[0:v]scale=300:-1,drawtext=text='$v':fontcolor=yellow:fontsize=16:box=1:boxcolor=black@0.6:x=4:y=4[a];[1:v]scale=300:-1[b];[2:v]scale=300:-1[c];[a][b][c]hstack=3" \
    "$tmp/row_$v.png"
  rows+=("$tmp/row_$v.png")
done
args=(); filt=""
for i in "${!rows[@]}"; do args+=(-i "${rows[$i]}"); filt+="[$i:v]"; done
ffmpeg -y -loglevel error "${args[@]}" -filter_complex "${filt}vstack=${#rows[@]}" "$out"
echo "$out"
