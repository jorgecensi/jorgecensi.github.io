// Pins the bike's physical behaviour on hand-built terrain via the
// ?debug=1 manual-step API. Each check corresponds to a bug that was fixed
// or a tuning target that makes the bike feel like the original game —
// see the constants block in elastomania/index.html.
const { openGame, assert } = require('./lib');

(async () => {
  const { browser, page, errors } = await openGame();
  const r = await page.evaluate(() => {
    const api = window.__elasto;
    const flat = { terrain: [[0, 420], [8000, 420]] };
    const out = {};
    const frontLift = (s) => api.terrainY(s.front.x) - s.front.y - 13;

    // 1. Idle: settles level and still.
    api.startCustom(flat); api.step(180);
    const a0 = api.snapshot(); const s0 = api.step(120);
    out.idle = { angle: s0.chassis.angle, drift: Math.abs(s0.chassis.x - a0.chassis.x), state: api.state };

    // 2. Steady full throttle on flat: rides, doesn't loop; top speed capped.
    api.startCustom(flat); api.step(60); api.setInput({ gas: 1 });
    let minA = 0, s;
    for (let i = 0; i < 240; i++) { s = api.step(1); minA = Math.min(minA, s.chassis.angle); }
    out.gas = { minAngle: minA, speed: s.chassis.vx, state: api.state };
    api.setInput({ gas: 0 });

    // 3. One back volt at speed = a wheelie that comes back down; two = loop.
    api.startCustom(flat); api.step(60); api.setInput({ gas: 1 }); api.step(60);
    api.volt(-1); minA = 0; let lift = 0;
    for (let i = 0; i < 120; i++) { s = api.step(1); minA = Math.min(minA, s.chassis.angle); lift = Math.max(lift, frontLift(s)); }
    out.oneVolt = { minAngle: minA, lift, state: api.state, endLift: frontLift(s) };
    api.startCustom(flat); api.step(60); api.setInput({ gas: 1 }); api.step(60);
    api.volt(-1); api.step(20); api.volt(-1); api.step(120);
    out.twoVolts = { state: api.state };
    api.setInput({ gas: 0 });

    // 4. Volt lockout: a second press inside the cooldown is dropped.
    api.startCustom(flat); api.placeBike(400, -2000); api.step(2);
    api.volt(1); api.step(3); api.volt(1); api.step(20);
    const single = api.snapshot().chassis.spin;
    api.startCustom(flat); api.placeBike(400, -2000); api.step(2);
    api.volt(1); api.step(23);
    out.lockout = { mashed: single, single: api.snapshot().chassis.spin };

    // 5. Mid-air spin is conserved (the suspension used to brake rotation).
    api.startCustom(flat); api.placeBike(400, -2000); api.step(2);
    api.volt(1); api.step(8); const peak = api.snapshot().chassis.spin;
    api.step(30);
    out.airSpin = { peak, after: api.snapshot().chassis.spin };

    // 6. Hard braking from top speed: stops, nose dips, no endo.
    api.startCustom(flat); api.step(30); api.setInput({ gas: 1 }); api.step(180);
    api.setInput({ gas: 0, brake: true }); let n = 0, maxA = 0;
    while (api.snapshot().chassis.vx > 0.3 && n < 300) { s = api.step(1); n++; maxA = Math.max(maxA, s.chassis.angle); }
    out.brake = { steps: n, maxNoseDown: maxA, state: api.state };
    api.setInput({ brake: false });

    // 7. Big drop onto flat ground: frame stays above the axles (it used to
    //    punch through into the mirrored pose) and the rider survives.
    api.startCustom(flat); api.placeBike(400, 40); let worst = Infinity;
    for (let i = 0; i < 180; i++) {
      s = api.step(1);
      const axleY = (s.rear.y + s.front.y) / 2;
      if (i > 40) worst = Math.min(worst, axleY - s.chassis.y);
    }
    out.drop = { minFrameAboveAxle: worst, wheelbase: Math.hypot(s.front.x - s.rear.x, s.front.y - s.rear.y), state: api.state };

    // 8. Head is a circle: riding face-first into a vertical-ish wall kills
    //    even though the head's centre never goes below the surface line.
    const wall = { terrain: [[0, 420], [500, 420], [506, 200], [900, 200]] };
    api.startCustom(wall); api.setInput({ gas: 1 }); n = 0;
    while (api.state === 'playing' && n < 400) { api.step(1); n++; }
    const h = api.snapshot().head;
    out.wall = { state: api.state, headAboveSurface: api.terrainY(h.x) - h.y };
    api.setInput({ gas: 0 });

    // 9. Turning around drives the other way.
    api.startCustom({ terrain: [[0, 420], [3000, 420]] }); api.placeBike(1500, 380); api.step(60);
    api.turn(); api.setInput({ gas: 1 }); api.step(90);
    out.turn = { facing: api.snapshot().facing, vx: api.snapshot().chassis.vx };
    api.setInput({ gas: 0 });
    return out;
  });
  console.log(JSON.stringify(r, null, 1));

  assert(r.idle.state === 'playing' && Math.abs(r.idle.angle) < 0.05 && r.idle.drift < 2, 'bike idles level and still');
  assert(r.gas.state === 'playing' && r.gas.minAngle > -0.3, 'steady full throttle on flat does not wheelie/loop');
  assert(r.gas.speed > 11 && r.gas.speed < 17, 'top speed ≈ 15 px/step (spin-capped), got ' + r.gas.speed);
  assert(r.oneVolt.state === 'playing' && r.oneVolt.lift > 15 && r.oneVolt.minAngle > -1.2 && r.oneVolt.endLift < 5,
    'one back volt at speed lifts the front wheel and lands back');
  assert(r.twoVolts.state === 'dead', 'two quick back volts under gas loop the bike');
  assert(Math.abs(r.lockout.mashed - r.lockout.single) < 0.005, 'a volt inside the lockout is dropped');
  assert(r.airSpin.after > r.airSpin.peak * 0.8, 'mid-air rotation is conserved (≤20% loss in 0.5s)');
  assert(r.brake.state === 'playing' && r.brake.steps < 120 && r.brake.maxNoseDown < 0.35, 'hard brake stops without an endo');
  assert(r.drop.state === 'playing' && r.drop.minFrameAboveAxle > 8 && Math.abs(r.drop.wheelbase - 60) < 8,
    'hard landing keeps the frame above the axles');
  assert(r.wall.state === 'dead' && r.wall.headAboveSurface > 0,
    'head touching a wall face-first kills (centre still above the surface line)');
  assert(r.turn.facing === -1 && r.turn.vx < -3, 'turned bike drives left');
  assert(errors.length === 0, 'no page errors: ' + errors.join('\n'));
  await browser.close();
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
