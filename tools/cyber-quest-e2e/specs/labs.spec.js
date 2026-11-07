// Clears every terminal lab by typing what its lessons teach, and checks shell details
// (tail -n, grep -c, answer, man), lab locking, and that an old save keeps cleared labs.
const { launch, assert } = require('./_helpers');

const LABS = {
  'first-contact': ['pwd', 'ls', 'cd projects', 'ls', 'cd starfall', 'ls', 'pwd', 'cd ..', 'cd ..', 'ls -a', 'cat incident-ticket.txt', 'whoami'],
  'lost-and-found': ['ls', 'cat sam-note.txt', 'cd /srv/shared', 'ls', 'cd marketing', 'ls', 'cat README.txt', 'cd ../engineering/releases', 'ls', 'ls -a', 'cd .archive', 'ls', 'cd 2026-03', 'cat release-checklist.txt', 'pwd', 'find /srv/shared -name starfall-logo.png', 'cd /srv/shared/art/logos/wip/v3', 'ls'],
  'linux-map': ['ls /', 'cd /etc', 'ls', 'cat hostname', 'ls /var/log', 'cd ~', 'pwd', 'ls -a /tmp'],
  'reading-logs': ['tail -n 3 syslog', 'grep -i error syslog', 'cat auth.log', 'grep -c Failed auth.log', 'grep "Failed password" auth.log | wc -l', 'answer 10.0.4.22', 'answer 198.51.100.23'],
  jobs: ['ps aux', 'kill 3310', 'cat /etc/crontab', 'ls /etc/cron.d', 'crontab -l'],
  perms: ['ls -l ~/.ssh', 'chmod 600 ~/.ssh/id_ed25519', 'ss -tlnp', 'systemctl stop ftp', 'ufw deny 21', 'ufw enable'],
  intruder: ['ps aux', 'kill 6621', 'ls /etc/cron.d', 'cat /etc/cron.d/apache-update', 'grep Accepted /var/log/auth.log', 'ufw deny from 203.0.113.66'],
  lockdown: ['ls -l', 'chmod 640 config.php', 'ss -tlnp', 'systemctl stop telnet', 'ufw deny 3306']
};

(async () => {
  const { browser, page, errors, ev, open, openGrounds, type, noHScroll } = await launch();
  await open(); await openGrounds();
  const states = await ev(() => [...document.querySelectorAll('#lab-list [data-lab]')].map((b) => b.disabled));
  assert(!states[0] && states.slice(1).every(Boolean), 'only the first lab is open at the start');

  for (const [id, cmds] of Object.entries(LABS)) {
    await page.click(`[data-lab="${id}"]`);
    await page.click('#ob-start');
    assert(/STEP 1 OF/i.test(await page.innerText('#ops-lesson')), id + ' shows its first lesson');
    for (const c of cmds) await type(c);
    if (id === 'reading-logs') {
      const out = await ev(() => window.__cyberQuest.ops.out);
      assert(/Session 42/.test(out) && !/Mar 09 06:00:44/.test(out.split('tail -n 3 syslog')[1].split('grep -i')[0]), 'tail -n 3 shows only the last lines');
      assert(/Not quite/.test(out), 'a wrong answer is rejected');
    }
    assert(await ev(() => window.__cyberQuest.shell._ready) && !(await ev(() => window.__cyberQuest.ops.done)), id + ': objectives done, waiting for exit');
    await type('exit');
    assert(await ev(() => window.__cyberQuest.ops.done), id + ' should be finished');
    assert(await page.isVisible('#ops-term') && await page.isVisible('#ops-done'), id + ': the result docks under the terminal, which stays readable');
    console.log('  ', id, '→ done');
    await page.click('#ops-continue');
    await openGrounds();
  }
  // Challenges: no lesson, no hints, randomised answers (read from the shell's vars), stars for efficiency.
  const SOLVE = {
    'ch-find': (v) => ['find /srv/shared -name launch-key.txt', 'cat ' + v.path, 'answer ' + v.code, 'answer ' + v.dir],
    'ch-map': (v) => ['cat /etc/passwd', 'answer ' + v.user, 'ls /var/log', 'answer ' + v.logs, 'ls -a /tmp', 'ls -a /var/tmp', 'answer ' + v.code],
    'ch-logs': (v) => ['grep Failed /var/log/auth.log', 'answer ' + v.ip, 'answer ' + v.n, 'grep Accepted /var/log/auth.log', 'answer ' + v.user],
    'ch-jobs': (v) => ['ps aux', 'kill ' + v.pid, 'ls /etc/cron.d', 'answer ' + v.job],
    'ch-perms': (v) => ['ls -l ~/.ssh', 'chmod 600 ' + v.key, 'ss -tlnp', 'systemctl stop ' + v.svc, 'ufw deny ' + v.port, 'ufw enable']
  };
  for (const [id, solve] of Object.entries(SOLVE)) {
    await page.click('[data-lab="' + id + '"]');
    await page.click('#ob-start');
    const lesson = await page.innerText('#ops-lesson');
    assert(/challenge/i.test(lesson) && !/STEP 1/i.test(lesson), id + ' shows no lesson');
    assert((await page.$$('#ops-chips .chip')).length <= 2, id + ' has no command shortcuts');
    await type('hint');
    assert(/No hints/.test(await ev(() => window.__cyberQuest.ops.out)), id + ': hint is switched off');
    await type('answer definitely-wrong');
    const vars = await ev(() => window.__cyberQuest.shell.T.vars);
    for (const c of solve(vars)) await type(c);
    await type('exit');
    assert(await ev(() => window.__cyberQuest.ops.done), id + ' should be finished');
    const stars = await ev((i) => window.__cyberQuest.progress.labs[i].stars, id);
    assert(stars >= 2, id + ' earns stars for an efficient run (got ' + stars + ')');
    console.log('  ', id, '->', stars, 'stars');
    await page.click('#ops-continue');
    await openGrounds();
  }
  // A fresh run is randomised.
  const runs = new Set();
  for (let i = 0; i < 6; i++) runs.add(await ev(() => { window.__cyberQuest.ops.open('ch-logs'); window.__cyberQuest.ops.start(); return window.__cyberQuest.shell.T.vars.ip; }));
  assert(runs.size > 1, 'challenge answers change between runs');
  await page.click('#ops-quit');
  await open(); await openGrounds();

  await page.click('[data-lab="first-contact"]');
  await page.click('#ob-start');
  await type('man crontab'); await type('frobnicate');
  await type('exit');
  assert(/still have work/.test(await ev(() => window.__cyberQuest.ops.out)) && !(await ev(() => window.__cyberQuest.ops.done)), 'exit before the objectives are done keeps you in');
  const out = await ev(() => window.__cyberQuest.ops.out);
  assert(/minute hour/.test(out) && /type help/.test(out), 'man pages and unknown-command help work');
  assert(await page.isVisible('#ops-term') && !(await ev(() => window.__cyberQuest.ops.out)).includes('Mira'), 'the terminal is open full screen and has no character lines');
  await page.click('#ops-close');
  assert(!(await page.isVisible('#ops-term')) && await page.isVisible('#ops-open'), 'closing the terminal goes back to the lesson');
  await page.click('#ops-quit');

  // A save from before the Basics track existed keeps the labs it already cleared.
  await ev(() => localStorage.setItem('cyber-quest-progress-v1', JSON.stringify({ v: 1, missions: {}, labs: { 'first-contact': { done: true, xp: 40 }, intruder: { done: true, xp: 75 }, lockdown: { done: true, xp: 95 } } })));
  await open(); await openGrounds();
  const old = await ev(() => Object.fromEntries([...document.querySelectorAll('#lab-list [data-lab]')].map((b) => [b.dataset.lab, !b.disabled])));
  assert(old['linux-map'] && old.intruder && old.lockdown && !old['reading-logs'], 'old saves keep cleared labs open: ' + JSON.stringify(old));
  // Saves from before Day One's Lost & Found beats (rev 1) skip past them; newer saves don't move.
  await ev(() => localStorage.setItem('cyber-quest-progress-v1', JSON.stringify({ v: 1, missions: {}, labs: {}, story: {}, storyAt: { ch: 'ch1', beat: 4 } })));
  await open();
  assert(await ev(() => window.__cyberQuest.progress.storyAt.beat) === 6, 'an old ch1 save past the first training moves 2 beats on');
  await ev(() => localStorage.setItem('cyber-quest-progress-v1', JSON.stringify({ v: 1, rev: 2, missions: {}, labs: {}, story: {}, storyAt: { ch: 'ch1', beat: 4 } })));
  await open();
  assert(await ev(() => window.__cyberQuest.progress.storyAt.beat) === 4, 'a current save keeps its beat');
  await noHScroll();
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  console.log('PASS labs');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
