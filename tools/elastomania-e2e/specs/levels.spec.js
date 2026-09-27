// A simple volt-steering bot must still ride the first generated levels to
// the flower. Guards against physics/tuning changes that quietly make the
// early game unwinnable. (It isn't a good rider: it only uses gas, brake and
// volts to keep the bike parallel to the ground ahead.)
const { openGame, assert } = require('./lib');
const LEVELS = [0, 1, 2, 3];

(async () => {
  const { browser, page, errors } = await openGame();
  const results = await page.evaluate((levels) => {
    const api = window.__elasto;
    const out = [];
    for (const lv of levels) {
      let best = null;
      for (const vmax of [14, 10, 7]) {
        api.start(lv);
        const W = api.level.worldW;
        let maxX = 0, steps = 0;
        while (api.state === 'playing' && steps < 60 * 60) {
          const s = api.snapshot();
          const v = Math.hypot(s.chassis.vx, s.chassis.vy);
          const air = api.terrainY(s.rear.x) - s.rear.y > 18 && api.terrainY(s.front.x) - s.front.y > 18;
          const ground = Math.atan((api.terrainY(s.chassis.x + 40) - api.terrainY(s.chassis.x)) / 40);
          api.setInput({ gas: v < vmax ? 1 : 0, brake: v > vmax + 3 && !air });
          const err = s.chassis.angle - ground + s.chassis.spin * 14;
          if (err < -0.55) api.volt(1); else if (err > 0.55) api.volt(-1);
          api.step(1); steps++;
          maxX = Math.max(maxX, s.chassis.x);
          if (s.chassis.x > W - 80) break;
        }
        const res = { lv, vmax, reached: maxX / W, state: api.state };
        if (!best || res.reached > best.reached) best = res;
        if (res.state === "win" || res.reached > 0.95) break;
      }
      out.push(best);
    }
    api.setInput({ gas: 0, brake: false });
    return out;
  }, LEVELS);
  for (const r of results) console.log(JSON.stringify(r));
  for (const r of results) {
    assert(r.state === 'win' || r.reached > 0.93, `bot reaches the flower on level ${r.lv + 1} (got ${(r.reached * 100).toFixed(0)}%)`);
  }
  assert(errors.length === 0, 'no page errors: ' + errors.join('\n'));
  await browser.close();
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
