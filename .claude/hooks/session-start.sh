#!/bin/bash
set -euo pipefail

# Only relevant in Claude Code on the web's remote containers.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Playwright test/video tooling for worldcup-2026 (see the screenshot-worldcup
# skill). Pre-installing here means a session that needs a screenshot or a
# video doesn't pay the ffmpeg/npm setup cost on the first request.
# ---------------------------------------------------------------------------

# ffmpeg: not preinstalled, needed to convert Playwright's recorded .webm
# videos to widely-playable .mp4. `apt-get install` alone sometimes 404s on a
# stale mirror index, hence the `update` first.
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends ffmpeg
fi

# Pinned to match the exact CDN versions worldcup-2026/index.html loads
# (react@18.2.0, react-dom@18.2.0, @babel/standalone@7.23.5), so the
# screenshot-worldcup skill's local-serve patch works unmodified.
mkdir -p /tmp
(cd /tmp && npm install --no-save --no-audit --no-fund \
  react@18.2.0 react-dom@18.2.0 @babel/standalone@7.23.5)
