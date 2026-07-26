#!/usr/bin/env bash
# Build the site, serve it, and run the Personal Trainer e2e specs.
#
#   ./run.sh              # run every spec
#   ./run.sh e2e.js ...   # run only the named specs
#
# Exits non-zero if any spec fails. See README.md for the environment caveats.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-4001}"
WORK="${TMPDIR:-/tmp}/pt-e2e-$$"

# `bundle exec jekyll` is not reliably on PATH in a fresh container even after a
# successful `bundle install`; fall back to the rbenv binary directly.
JEKYLL="$(command -v jekyll || true)"
if [ -z "$JEKYLL" ]; then
    JEKYLL="$(gem environment 2>/dev/null | awk '/EXECUTABLE DIRECTORY/{print $NF}')/jekyll"
fi
[ -x "$JEKYLL" ] || { echo "could not locate the jekyll binary (tried: $JEKYLL)"; exit 1; }

echo "==> building site"
(cd "$REPO" && "$JEKYLL" build >/dev/null) || { echo "jekyll build failed"; exit 1; }

# personal-trainer/{index.html,sw.js,manifest.json} contain no Liquid, so a plain
# static server over _site/ is equivalent to `jekyll serve` and starts far faster.
echo "==> serving _site on :$PORT"
(cd "$REPO/_site" && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

for _ in $(seq 1 40); do
    curl -sf -o /dev/null "http://localhost:$PORT/personal-trainer/" && break
    sleep 0.25
done
curl -sf -o /dev/null "http://localhost:$PORT/personal-trainer/" || { echo "server never came up"; exit 1; }

if [ "$#" -gt 0 ]; then
    SPECS=("$@")
else
    SPECS=()
    for f in "$HERE"/specs/e2e*.js; do SPECS+=("$(basename "$f")"); done
fi

mkdir -p "$WORK/shots"
pass=0; fail=0; failed=()
for spec in "${SPECS[@]}"; do
    if SHOTS_DIR="$WORK/shots" timeout 240 node "$HERE/specs/$spec" >"$WORK/$spec.log" 2>&1; then
        echo "PASS  $spec"; pass=$((pass + 1))
    else
        echo "FAIL  $spec"; fail=$((fail + 1)); failed+=("$spec")
        sed 's/^/        /' "$WORK/$spec.log" | tail -12
    fi
done

echo
echo "==> $pass passed, $fail failed"
[ "$fail" -eq 0 ] || { printf '    %s\n' "${failed[@]}"; echo "    logs: $WORK"; exit 1; }
