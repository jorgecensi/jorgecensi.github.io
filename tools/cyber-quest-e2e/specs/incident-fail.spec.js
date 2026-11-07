// Lets the chapter 2 brute-force incident run out: the threat meter fills, the log grows,
// the incident ends in "Breached", and "Try again" restarts it from 0%. Takes ~85 s.
const { launch, assert } = require('./_helpers');

(async () => {
  const { browser, page, errors, ev, open, shot } = await launch();
  await open();
  const idx = await ev(() => window.__cyberQuest.story.chapter('ch2').beats.findIndex((b) => b.title === 'SSH under attack'));
  assert(idx > 0, 'found the brute-force beat');
  await ev((i) => window.__cyberQuest.story.open('ch2', i), idx);
  await page.waitForTimeout(30000);
  const mid = await ev(() => ({ pct: parseInt(document.getElementById('ops-threat-pct').innerText, 10), lines: window.__cyberQuest.shell.nodeAt('/var/log/auth.log').content.split('\n').length }));
  assert(mid.pct > 20 && mid.pct < 100, 'threat climbs while nobody acts (got ' + mid.pct + '%)');
  assert(mid.lines > 15, 'the attack streams into auth.log (got ' + mid.lines + ' lines)');
  await shot('brute-midway');
  await page.waitForSelector('#ops-done.show', { timeout: 70000 });
  assert(/Breached/.test(await page.innerText('#ops-done-title')), 'incident ends in a breach');
  await page.click('#ops-continue');
  const again = await ev(() => ({ pct: document.getElementById('ops-threat-pct').innerText, finished: window.__cyberQuest.shell._finished }));
  assert(again.pct === '0%' && !again.finished, 'Try again restarts the incident');
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  console.log('PASS incident-fail');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
