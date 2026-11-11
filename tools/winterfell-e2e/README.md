# Battle of Winterfell e2e

Playwright specs for `/winterfell/` (a first-person three.js game). They click the
real menu, pause and retry buttons, and drive the fight through the `?debug=1` hook.

```
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # first run in a fresh container
./run.sh                    # every spec (about 25 s, build included)
./run.sh smoke.spec.js      # just the named ones
```

`run.sh` builds the site, serves `_site/` on port 4016 (`PORT=` to change), and
runs each spec with a 420 s timeout (`SPEC_TIMEOUT=`). Logs and screenshots land in
`$TMPDIR/winterfell-e2e-<pid>/`.

| Spec | What it covers | Time |
|---|---|---|
| `smoke.spec.js` | Loads with no page errors, failed requests or console errors; the menu shows; the real Begin button starts act 1 (`muster`, mounted); the WebGL canvas draws a scene (not one flat colour) on the menu and in play; Escape pauses and freezes the clock, Resume resumes. Runs in real time. | ~5 s |
| `playthrough.spec.js` | `god(true)` + `bot(true)` from act 1 to the Night King and dawn, checked every simulation step: the fourteen phases in order, mounted until the horse falls (`afoot`), the trench lit during the fallback, the `#won` screen and its tally, `progress.act` back to 1 and a best run saved. | ~8 s |
| `combat.spec.js` | A strike kills a wight 1.8 m ahead and not one behind; an idle player in act 3 is hurt and dies, the `#dead` screen shows and Try again restarts act 3 at 100 hp; starting act 2 saves a checkpoint and Continue shows (and works) after a reload. | ~8 s |

## Debug hook (`?debug=1`)

`window.__winterfell`:

- `state` → `{ mode, act, phase, t, hp, kills, x, z, mounted, wights, allies, trenchLit, flame }`.
  `mode` is `menu` | `play` | `paused` | `dead` | `won`. Phases: act 1 `muster → charge → clash →
  retreat → afoot`, act 2 `hold → fallback`, act 3 `siege` (ends by reaching the keep door),
  act 4 `halls`, act 5 `grove → walkers → king → dawn`. `t` is seconds in the current phase.
- `start(act)` begins act 1, 2 or 3 (same as the menu buttons).
- `step(n)` advances n fixed 1/60 s steps synchronously. **One call stops the real-time loop
  from simulating for the rest of that page load**, so time is deterministic (randomness is
  not) and fast: the whole game, about 260 game seconds, steps in about 7 s.
- `god(true)` makes the player invulnerable; `bot(true)` turns on the built-in test pilot.
- `key(code, down)`, `look(yaw, pitch)` (yaw 0 faces north = -Z, the enemy; `Math.PI` faces
  the castle), `attack()` queues one strike, `spawn(x, z, { speed, hp })` adds a wight.
- Raw objects: `G`, `P` (player), `wights`, `allies`, `progress`.

World: horde musters at z=-30, clash at z=-250, Unsullied line at z=-14, trench z 8..12
(bridge at |x|<4), gate at z=40 (|x|<5), courtyard z 41..100. Progress is in `localStorage`
under `winterfell-progress-v1` (`{ v: 1, act, best, muted }`).

## Gotchas

- **Playwright must match the image's Chromium.** This suite pins 1.63.0 (build 1243). If
  launch fails with `Executable doesn't exist at .../chromium_headless_shell-<N>`, read `<N>`
  from `ls /opt/pw-browsers` and pin the Playwright whose
  `node_modules/playwright-core/browsers.json` lists that revision. Never run `playwright install`.
- **WebGL needs SwiftShader.** `launch()` passes `--use-gl=swiftshader --enable-unsafe-swiftshader`;
  without them headless Chromium has no WebGL context. The viewport is 960×540 at 1x to keep
  software rendering cheap.
- **Service workers are blocked** in `launch()`. The page then logs the warning "Service Worker
  registration blocked by Playwright"; that and GL driver messages are ignored, every other
  console error fails the spec (`run()` in `_helpers.js` checks after the body).
- **Randomness is not seeded.** Spawns use `Math.random`, so kills and the moment of the first
  hit vary run to run; only phase timing is fixed. Assert on outcomes, not counts.
- **`spawn(..., { speed: 0 })` gives a random speed** (`o.speed || rand(...)`); use `0.01` for a
  wight that should stay put.
- **Allies steal kills.** Only the player's own strikes add to `kills`. At the act 2 start spot
  the Unsullied on both sides can reach a wight placed in front of the player, so
  `combat.spec.js` moves the player to open snow (x=60, z=-40) first.
- **An idle player is ignored for a while in act 3.** Wights go for the defenders first: over
  nine runs the first hit landed 18 to 44 s in and death 37 to 54 s in (the giant comes through
  the gate at 48 s). So the spec does not require a hit inside the first 60 s, only that the
  player is hurt and then dies before the siege ends at 80 s.
- **The `#dead` screen appears on a real 1.3 s timer** (`setTimeout`), not on game time, so
  wait for `#dead.on` after stepping to a death. `#won` shows at once.
- **God mode does not cover the horse fall**: entering `afoot` takes 12 hp directly (never
  below 25), so hp is not 100 throughout a god-mode run.
- **Pointer lock**: Begin, Resume and Try again ask for pointer lock; in headless Chromium the
  request does nothing visible and the game carries on, so specs need no special handling.
