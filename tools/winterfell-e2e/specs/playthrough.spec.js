// Playthrough: the built-in test pilot, invulnerable, plays all three acts to dawn.
const { run, assert, HZ } = require('./_helpers');

const ORDER = ['1:muster', '1:charge', '1:clash', '1:retreat', '1:afoot', '2:hold', '2:fallback', '3:siege', '3:dawn'];
const PHASE_BUDGET = 240;   // game seconds any one phase may take (the longest, the siege, is about 100 s)
const TOTAL_BUDGET = 900;   // game seconds for the whole run (about 6 minutes in practice)
const CHUNK = 10 * HZ;      // steps per round trip to the page

run('playthrough', async ({ page, open, ev, state, saved }) => {
  await open();
  await ev(() => { const w = window.__winterfell; w.start(1); w.god(true); w.bot(true); });

  // Step one frame at a time inside the page, so every phase change and every frame's `mounted` is seen.
  const visits = [];          // { key, at (game s), kills, trenchLit, hp }
  const problems = [];
  let steps = 0, inPhase = 0, mode = 'play';
  while (mode === 'play') {
    const r = await ev(({ n, last }) => {
      const w = window.__winterfell;
      const out = { visits: [], problems: [], done: 0, last };
      for (let i = 0; i < n; i++) {
        const s = w.state;
        if (s.mode !== 'play') break;
        const key = s.act + ':' + s.phase;
        if (key !== out.last) { out.visits.push({ key, i, kills: s.kills, trenchLit: s.trenchLit, hp: s.hp }); out.last = key; }
        const riding = s.act === 1 && s.phase !== 'afoot';
        if (s.mounted !== riding && out.problems.length < 5) out.problems.push(`mounted is ${s.mounted} in ${key} at t=${s.t.toFixed(2)}`);
        w.step(1);
        out.done++;
      }
      out.mode = w.state.mode;
      return out;
    }, { n: CHUNK, last: visits.length ? visits[visits.length - 1].key : null });
    for (const v of r.visits) { v.at = (steps + v.i) / HZ; visits.push(v); inPhase = 0; }
    problems.push(...r.problems);
    steps += r.done; inPhase += r.done; mode = r.mode;
    const cur = visits[visits.length - 1].key;
    const s = await state();
    assert(inPhase / HZ <= PHASE_BUDGET, `stalled in phase ${cur}: ${PHASE_BUDGET} game seconds without leaving it ` +
      `(visited: ${visits.map((v) => v.key).join(' > ')}; state ${JSON.stringify(s)})`);
    assert(steps / HZ <= TOTAL_BUDGET, `no win after ${TOTAL_BUDGET} game seconds, stuck in phase ${cur}`);
  }
  console.log(visits.map((v) => `${v.key}@${v.at.toFixed(1)}s`).join('  ') + `  end@${(steps / HZ).toFixed(1)}s`);

  // Phases in order, each exactly once
  assert(visits.map((v) => v.key).join(' ') === ORDER.join(' '), 'phases out of order: ' + visits.map((v) => v.key).join(' > '));
  assert(problems.length === 0, problems.join('; '));

  // The trench is not lit when the fallback starts, and is by the time the siege does
  const by = Object.fromEntries(visits.map((v) => [v.key, v]));
  assert(by['2:fallback'].trenchLit === false, 'trench already lit when the fallback began');
  assert(by['3:siege'].trenchLit === true, 'trench was not lit before act 3');

  // Won
  const s = await state();
  assert(s.mode === 'won', 'run ended in mode ' + s.mode + ', not won');
  assert(await page.isVisible('#won'), 'the #won screen is not shown');
  assert(s.kills > 0, 'the pilot killed nothing');
  assert(s.hp > 0, 'player has no hp at the end');
  const tally = await ev(() => document.getElementById('won-kills').textContent);
  assert(Number(tally) === s.kills, `won screen shows ${tally} slain, state says ${s.kills}`);
  console.log(`kills ${s.kills}, allies alive ${s.allies}`);

  // Winning resets the checkpoint and records a best run
  const p = await saved();
  assert(p && p.act === 1, 'progress.act is not reset to 1 after winning: ' + JSON.stringify(p));
  assert(p.best && p.best.kills === s.kills, 'best run not saved: ' + JSON.stringify(p));
});
