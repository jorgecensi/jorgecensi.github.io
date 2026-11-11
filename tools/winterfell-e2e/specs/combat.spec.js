// Combat: a strike kills what is in front and not what is behind; the player can be hurt, die and retry;
// starting an act stores a checkpoint that the menu offers after a reload.
const { run, assert, HZ } = require('./_helpers');

run('combat', async ({ page, open, ev, state, start, step, saved }) => {
  // ── (a) strike arc ──
  await open();
  await start(2);
  await ev(() => window.__winterfell.god(true));
  await step(1);   // from here on the page only simulates when told to

  // Stand in open snow, away from the Unsullied (their spears would steal the kill) and facing north.
  const strikeAt = (dz) => ev((d) => {
    const w = window.__winterfell;
    w.P.x = 60; w.P.z = -40; w.look(0);
    const before = w.state.kills;
    const wight = w.spawn(60, -40 + d, { speed: 0.01 });   // 0 would be replaced by a random speed
    w.attack();
    w.step(20);
    const out = { before, after: w.state.kills, wightState: wight.state };
    wight.state = 'dying';   // clear it away before the next case
    return out;
  }, dz);

  const front = await strikeAt(-1.8);
  assert(front.after === front.before + 1, `a wight 1.8 m ahead was not killed by one strike (kills ${front.before} -> ${front.after})`);
  assert(front.wightState !== 'alive', 'the wight ahead is still alive after the strike');
  await step(40);  // let the strike cooldown run out

  const behind = await strikeAt(1.8);
  assert(behind.after === behind.before, `a strike killed something behind the player (kills ${behind.before} -> ${behind.after})`);
  assert(behind.wightState === 'alive', 'the wight behind the player died from a forward strike');

  // ── (b) damage, death, retry ──
  await open();
  await start(3);
  let s = await state();
  assert(s.act === 3 && s.phase === 'siege' && s.hp === 100, 'act 3 did not start in the siege at 100 hp: ' + JSON.stringify(s));

  // Step with no input until hurt (or 60 game seconds).
  const hurt = await ev((n) => {
    const w = window.__winterfell;
    let i = 0;
    for (; i < n && w.state.mode === 'play' && w.state.hp >= 100; i++) w.step(1);
    return { steps: i, hp: w.state.hp };
  }, 60 * HZ);
  assert(hurt.hp < 100, 'an idle player took no damage in the first 60 s of the siege');
  console.log(`first hit after ${(hurt.steps / HZ).toFixed(1)} s`);

  // Keep standing still: the player must die before the act ends.
  const end = await ev((n) => {
    const w = window.__winterfell;
    let i = 0, min = 100;
    for (; i < n && w.state.mode === 'play'; i++) { w.step(1); min = Math.min(min, w.state.hp); }
    return { steps: i, min };
  }, 200 * HZ);
  s = await state();
  assert(s.mode === 'dead', `an idle player did not die in act 3 (mode ${s.mode}, phase ${s.phase}, lowest hp ${end.min.toFixed(0)})`);
  assert(s.act === 3 && s.phase === 'siege', 'death did not happen during the siege: ' + s.phase);
  assert(s.hp === 0, 'hp is not 0 when dead: ' + s.hp);
  console.log(`died ${((hurt.steps + end.steps) / HZ).toFixed(1)} s into the siege`);

  // The death screen fades in on a real-time timer (1.3 s).
  await page.waitForSelector('#dead.on', { timeout: 5000 });
  assert(await page.isVisible('#btn-retry'), 'Try again button is not visible');
  await page.click('#btn-retry');
  s = await state();
  assert(s.mode === 'play' && s.act === 3 && s.phase === 'siege', 'retry did not restart act 3: ' + JSON.stringify(s));
  assert(s.hp === 100, 'retry did not restore hp: ' + s.hp);
  assert(s.t === 0, 'retry did not restart the act clock: ' + s.t);
  assert(!(await page.isVisible('#dead')), 'death screen still visible after retry');

  // ── (c) checkpoint ──
  await ev(() => localStorage.clear());
  await open();
  assert(!(await page.isVisible('#btn-continue')), 'Continue shows with no save');
  await start(2);
  let p = await saved();
  assert(p && p.v === 1 && p.act === 2, 'starting act 2 did not store act 2: ' + JSON.stringify(p));
  await page.reload();
  await page.waitForFunction(() => window.__winterfell, null, { timeout: 15000 });
  assert((await state()).mode === 'menu', 'reload did not return to the menu');
  assert(await page.isVisible('#btn-continue'), 'Continue is not visible after a reload with an act 2 checkpoint');
  const label = await page.textContent('#btn-continue');
  assert(/Act II$/.test(label.trim()), 'Continue button label is wrong: ' + label);
  await page.click('#btn-continue');
  s = await state();
  assert(s.mode === 'play' && s.act === 2 && s.phase === 'hold' && s.mounted === false, 'Continue did not start act 2: ' + JSON.stringify(s));
});
