# Elasto Mania e2e / physics specs

Playwright specs for the Elasto Mania PWA (`/elastomania`). They pin the
bike's physical behaviour, so run them after touching any physics constant
or the step loop in `elastomania/index.html`.

## Running

```sh
cd tools/elastomania-e2e
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # first time only
./run.sh                    # every spec
./run.sh physics.spec.js    # just the named one(s)
```

`run.sh` builds the site, serves `_site/` on port 4003 (override with
`PORT=`), runs each spec as a plain Node script and exits non-zero if any
fail. Playwright is pinned to `1.56.0` to match the pre-installed Chromium
at `/opt/pw-browsers` — see `tools/auto-runner-e2e/README.md` for how to
re-derive the pin. If `jekyll` isn't on PATH, run `bundle install` at the
repo root first (`run.sh` then finds the binary via `gem environment`).

Specs:

- `physics.spec.js` — idle stability, steady throttle doesn't loop, top
  speed, one/two back volts, volt lockout, mid-air spin conservation, hard
  braking without an endo, hard landing keeps the frame above the axles,
  head-circle wall death, turning around. Each check maps to a fixed bug or
  a tuning target.
- `levels.spec.js` — a simple volt-steering bot must still finish levels
  1–4.
- `realtime.spec.js` — real keyboard + `requestAnimationFrame` path: the
  original key layout and ~60 physics steps per wall-clock second.

## The `?debug=1` API

`window.__elasto` exists only with `?debug=1` in the URL:

- `start(levelIndex)`, `startCustom({ terrain: [[x, y], ...], apples?, flower? })`
- `step(n)` — advance n fixed 60Hz steps; returns a snapshot. **The first
  call stops the rAF loop from advancing physics for the rest of the page's
  life** — `realtime.spec.js` must never call it.
- `setInput({ gas: 0..1, brake: bool })` (held), `volt(±1)` (one press,
  +1 = clockwise), `turn()`
- `placeBike(x, y, angle?)` — reset the bike at rest with its frame at x, y
- `snapshot()`, `terrainY(x)`, and getters `state`, `level`, `apples`

`lib.js` opens the page with service workers blocked, so the SW's
first-load reload can't wipe state mid-spec.

## Tuning notes (what was learned the hard way)

- **Never use Matter's constraint `damping` on the suspension.** It damps
  the two bodies' *linear* velocities along the link and ignores the
  frame's rotation, so a spinning bike reads as suspension motion and the
  spin gets braked (~2%/step). `dampSuspension()` does it with ω × r.
  Same rule for any hand-written "relative velocity" — use
  `chassisPointVelocity()`.
- That hidden brake was masking an overpowered throttle reaction. Any
  change that removes damping of rotation needs `MOTOR_REACTION` and
  `VOLT_SPIN` re-swept with `physics.spec.js`.
- The brake's spin transfer is its own knob (`BRAKE_REACTION`); at 1:1 a
  hard stop endos the bike.
- `MAX_WHEEL_SPIN` sets top speed now that air drag is ~0; the level
  generator's ramps/walls assume ~15 px/step.
- Level generator (pre-existing, not physics): from about level 7 the
  rolling-terrain jitter hits the `MAX_Y` clamp and leaves pits with ~43°
  walls on both sides that no bike can climb out of from a standstill (old
  physics included). The bot in `levels.spec.js` therefore only covers
  levels 1–4.
