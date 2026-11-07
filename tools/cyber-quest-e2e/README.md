# Cyber Quest e2e

Playwright specs for `/cyber-quest/`. They drive the real UI (typing commands into
the terminal, tapping through story scenes, deciding phishing mails) plus the
`?debug=1` hook for things a test can't see on screen.

```
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # first run in a fresh container
./run.sh                    # every spec (about 6 minutes)
./run.sh labs.spec.js       # just the named ones
```

`run.sh` builds the site, serves `_site/` on port 4012 (`PORT=` to change), and
runs each spec with a 420 s timeout (`SPEC_TIMEOUT=`). Screenshots land in
`$TMPDIR/cyber-quest-e2e-<pid>/shots/`.

| Spec | What it covers | Time |
|---|---|---|
| `story.spec.js` | All 5 story chapters end to end: scenes, questions (one wrong answer first), every training and incident beat with real commands, the phishing rush (a deliberate fail, then a win), and each live mechanic: the miner respawning from cron, the SSH lockout warning, the ransomware C2 relaunch. | ~3 min |
| `incident-fail.spec.js` | Lets the chapter 2 brute-force attack run out: the meter climbs, `auth.log` grows, the incident ends in “Breached”, and “Try again” restarts at 0%. | ~90 s |
| `missions.spec.js` | Every Training Grounds quiz mission, tier unlocking, the password forge, a boss timeout, reaching the top rank. | ~1 min |
| `labs.spec.js` | Every terminal lab by following its lessons, shell details (`tail -n`, `grep -c`, quoted args, `answer`, `man`), lab locking, old-save compatibility. | ~30 s |

## Gotchas

- **Playwright must match the image's Chromium.** This suite pins 1.63.0
  (build 1243). If launch fails with `Executable doesn't exist at
  .../chromium_headless_shell-<N>`, read `<N>` from `ls /opt/pw-browsers` and
  pin the Playwright whose `node_modules/playwright-core/browsers.json` lists
  that revision. Never run `playwright install`.
- **Incidents run in real time.** Their clocks only tick while the tab is
  visible, and specs wait for real events (the miner respawns every 14 s, the C2
  relaunches about 9 s after a kill), so don't shorten those waits.
- **Training Grounds is collapsed by default.** Mission and lab cards sit
  inside `<details id="grounds">`, so open it (`openGrounds()` in
  `_helpers.js`) after every page load before clicking them.
- **Service workers are blocked** in `launch()`, so the app's first-install
  `clients.claim()` can't reload the page mid-spec.

## Debug hook (`?debug=1`)

`window.__cyberQuest` exposes `state`, `progress`, `missions`, `answerCorrect()`,
`answerWrong()`, `next()`, `labs`, `ops` (`open`, `start`, `run`, `done`,
`tasks`, `out`), `chapters`, and the raw `story`, `triage` and `shell` engines
(for example `story.open('ch2', beatIndex)` jumps straight to a beat).
