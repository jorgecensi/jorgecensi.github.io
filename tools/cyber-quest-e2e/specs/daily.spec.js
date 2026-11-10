// The daily shift: one short terminal job a day from what the player has already learned,
// with a streak that grows on consecutive days and resets after a missed one.
const { launch, assert, sleep, SOLVE } = require('./_helpers');

(async () => {
  const { browser, page, errors, ev, open, screen, type, shot, noHScroll } = await launch();
  const seed = (p) => ev((q) => localStorage.setItem('cyber-quest-progress-v1', JSON.stringify(Object.assign({ v: 1, rev: 4, missions: {}, labs: {}, story: {}, settings: {}, memo: {} }, q))), p);
  // Travel in time: n days from today.
  const day = (n) => ev((k) => { window.__cyberQuest.daily.now = () => new Date(Date.now() + k * 864e5); }, n);
  const home = () => ev(() => document.querySelector('[data-go="home"]').click());
  const daily = () => ev(() => window.__cyberQuest.progress.daily);
  const xp = () => ev(() => document.getElementById('rank-xp').textContent);

  // Play today's job to the end and return the result card's text.
  const play = async () => {
    await page.click('[data-daily]');
    assert(await screen() === 'ops', 'the daily shift opens in the terminal');
    const info = await ev(() => { const s = window.__cyberQuest.shell; return { id: s.lab.id, title: s.lab.title, vars: s.T.vars }; });
    if (SOLVE[info.id]) for (const c of SOLVE[info.id](info.vars)) await type(c);
    else if (info.id === 'brute') { await sleep(1500); await type('grep Failed /var/log/auth.log'); await type('ufw deny from 203.0.113.66'); }
    else throw new Error('ASSERT FAILED: no solver for daily job ' + info.id);
    await page.waitForFunction(() => window.__cyberQuest.shell._ready, null, { timeout: 15000 });
    await type('exit');
    await page.waitForSelector('#ops-done.show', { timeout: 5000 });
    assert(/Shift done/.test(await page.innerText('#ops-done-title')), 'the result is a finished shift');
    const text = await page.innerText('#ops-done-text');
    await page.click('#ops-continue');
    assert(await screen() === 'home', 'a finished shift returns to HQ');
    return { id: info.id, text };
  };

  await open();
  assert(await page.isHidden('#daily-card'), 'no daily shift before anything has been taught');

  // One Basics lab cleared: its challenge is the only job in the pool.
  await seed({ labs: { 'lost-and-found': { done: true, xp: 45 } } });
  await open();
  assert(await page.isVisible('[data-daily]'), 'the daily shift appears once a challenge is unlocked');
  assert(/Lost Again/.test(await page.innerText('[data-daily]')) && /🔥 0/.test(await page.innerText('[data-daily]')), 'the card names the job and shows no streak yet');
  await shot('daily-card');
  const before = parseInt(await xp(), 10);
  let r = await play();
  assert(r.id === 'ch-find' && /1-day streak/.test(r.text) && /\+15 XP/.test(r.text), 'the first shift starts a streak: ' + r.text);
  assert(parseInt(await xp(), 10) === before + 15, 'a shift is worth 15 XP');
  assert(!(await ev(() => window.__cyberQuest.progress.labs['ch-find'])), 'a daily shift does not clear the Training Grounds challenge');
  assert(/Done for today/.test(await page.innerText('[data-daily]')) && /🔥 1/.test(await page.innerText('[data-daily]')), 'the card shows today is done');
  await noHScroll();
  await shot('daily-done');

  // Again the same day: practice only.
  r = await play();
  assert(/just for practice/.test(r.text), 'a second shift the same day is practice');
  assert((await daily()).streak === 1 && parseInt(await xp(), 10) === before + 15, 'practice earns no streak and no XP');

  // The next day the streak grows.
  await day(1); await home();
  assert(!/Done for today/.test(await page.innerText('[data-daily]')) && /🔥 1/.test(await page.innerText('[data-daily]')), 'a new day opens a new shift and keeps the streak alive');
  r = await play();
  assert(/2-day streak/.test(r.text) && (await daily()).streak === 2, 'consecutive days grow the streak');

  // A missed day resets it, and the best streak is kept.
  await day(4); await home();
  assert(/🔥 0/.test(await page.innerText('[data-daily]')), 'a missed day shows the streak as lost');
  r = await play();
  const d = await daily();
  assert(/1-day streak/.test(r.text) && d.streak === 1 && d.best === 2 && d.xp === 45, 'the streak restarts at 1 and the best is kept: ' + JSON.stringify(d));

  // Finished chapters add their incidents to the pool, and the progress survives a reload.
  await ev(() => { const p = JSON.parse(localStorage.getItem('cyber-quest-progress-v1')); p.story = { ch1: { done: true, stars: 3, xp: 80 }, ch2: { done: true, stars: 3, xp: 100 } }; p.storyAt = { ch: 'ch3', beat: 0 }; localStorage.setItem('cyber-quest-progress-v1', JSON.stringify(p)); });
  await open();
  const pool = await ev(() => window.__cyberQuest.daily.pool().map((j) => j.id));
  assert(pool.includes('ch-find') && pool.includes('brute') && pool.includes('noise') && !pool.includes('miner'), 'the pool grows with the story: ' + pool.join(','));
  let n = 5;
  for (; n < 40; n++) { await day(n); if (await ev(() => window.__cyberQuest.daily.job().id) === 'brute') break; }
  assert(n < 40, 'some day serves the brute-force incident');
  await home();
  assert(/SSH under attack/.test(await page.innerText('[data-daily]')), 'the card names the incident');
  r = await play();
  assert(r.id === 'brute' && /1-day streak/.test(r.text), 'an incident counts as a shift: ' + r.text);

  await noHScroll();
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  console.log('PASS daily');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
