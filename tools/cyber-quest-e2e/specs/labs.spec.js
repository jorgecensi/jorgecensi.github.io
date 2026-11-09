// Clears every terminal lab by typing what its lessons teach, and checks shell details
// (tail -n, grep -c, answer, man), lab locking, and that an old save keeps cleared labs.
const { launch, assert, SOLVE } = require('./_helpers');

const LABS = {
  'first-contact': ['pwd', 'ls', 'cd projects', 'ls', 'cd starfall', 'ls', 'pwd', 'cd ..', 'cd ..', 'ls -a', 'cat incident-ticket.txt', 'whoami'],
  'lost-and-found': ['ls', 'cat sam-note.txt', 'cd /srv/shared', 'ls', 'cd marketing', 'ls', 'cat README.txt', 'cd ../engineering/releases', 'ls', 'ls -a', 'cd .archive', 'ls', 'cd 2026-03', 'cat release-checklist.txt', 'pwd', 'find /srv/shared -name starfall-logo.png', 'cd /srv/shared/art/logos/wip/v3', 'ls'],
  'linux-map': ['ls /', 'cd /etc', 'ls', 'cat hostname', 'ls /var/log', 'cd ~', 'pwd', 'ls -a /tmp'],
  'reading-logs': ['tail -n 3 syslog', 'grep -i error syslog', 'cat auth.log', 'grep -c Failed auth.log', 'grep "Failed password" auth.log | wc -l', 'answer 10.0.4.22', 'answer 198.51.100.23'],
  'log-filters': ['head -n 3 syslog', 'grep -v CRON syslog', 'grep -i error syslog | grep app', 'grep "Failed password" auth.log', 'grep "Failed password" auth.log | tail -n 1', 'answer 09:15:20', 'answer 09:13:48'],
  'log-timeline': ['ls nginx', 'head nginx/access.log', 'cut -d " " -f 1 nginx/access.log', 'cut -d " " -f 1 nginx/access.log | sort | uniq -c | sort -rn | head -n 1', 'answer 203.0.113.45', 'grep -r 203.0.113.45 /var/log', 'answer deploy'],
  jobs: ['ps aux', 'kill 3310', 'cat /etc/crontab', 'ls /etc/cron.d', 'crontab -l'],
  'file-perms': ['ls -l', 'answer rw-', 'answer r--', 'stat notes.txt', 'answer 755', 'chmod o-w salaries.csv', 'chmod 600 secrets.env', 'ls -l'],
  services: ['systemctl list-units', 'ss -tlnp', 'answer 6379', 'systemctl status telnet', 'systemctl stop telnet', 'systemctl disable telnet', 'ufw deny 3306', 'ufw allow 22', 'ufw allow 443', 'ufw enable', 'ufw status'],
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
    if (id === 'log-filters') {
      const out = await ev(() => window.__cyberQuest.ops.out);
      const inv = out.split('grep -v CRON syslog')[1].split('grep -i error')[0];
      assert(!/CRON\[/.test(inv) && /disk usage/.test(inv), 'grep -v drops the matching lines and keeps the rest');
      const chain = out.split('| grep app')[1].split('grep "Failed')[0];
      assert(/database connection refused/.test(chain) && !/nginx/.test(chain), 'grep | grep narrows twice');
    }
    if (id === 'file-perms') {
      const out = await ev(() => window.__cyberQuest.ops.out);
      assert(/\(0644\/-rw-r--r--\)/.test(out), 'stat shows permissions as a number and as letters');
      assert(/-rw-rw-r--\s+dana\s+staff/.test(out) && /-rw-------\s+alex\s+staff/.test(out), 'ls -l shows owner and group, and the chmods took effect');
    }
    if (id === 'services') {
      const out = await ev(() => window.__cyberQuest.ops.out);
      assert(/telnet\.service\s+active/.test(out) && /enabled at boot/.test(out) && /Status: active/.test(out), 'systemctl list-units/status and ufw status report the state');
    }
    if (id === 'log-timeline') {
      const out = await ev(() => window.__cyberQuest.ops.out);
      assert(/\b8 203\.0\.113\.45/.test(out.split('sort -rn | head -n 1')[1].split('answer')[0]), 'cut | sort | uniq -c | sort -rn ranks the busiest address first');
      assert(/auth\.log:.*deploy/.test(out), 'grep -r names the file each match came from');
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
  // rev 3 inserted Chapter 2's filter and trail parts after its beat 3.
  await ev(() => localStorage.setItem('cyber-quest-progress-v1', JSON.stringify({ v: 1, rev: 2, missions: {}, labs: {}, story: {}, storyAt: { ch: 'ch2', beat: 5 } })));
  await open();
  assert(await ev(() => window.__cyberQuest.progress.storyAt.beat) === 11, 'an old ch2 save past Reading Logs moves 6 beats on');
  await ev(() => localStorage.setItem('cyber-quest-progress-v1', JSON.stringify({ v: 1, rev: 2, missions: {}, labs: {}, story: {}, storyAt: { ch: 'ch2', beat: 3 } })));
  await open();
  assert(await ev(() => window.__cyberQuest.progress.storyAt.beat) === 3, 'an old ch2 save before the new parts stays put');
  await ev(() => localStorage.setItem('cyber-quest-progress-v1', JSON.stringify({ v: 1, rev: 2, missions: {}, labs: {}, story: {}, storyAt: { ch: 'ch4', beat: 1 } })));
  await open();
  assert(await ev(() => window.__cyberQuest.progress.storyAt.beat) === 7, 'an old ch4 save at its training moves 6 beats on');
  await noHScroll();
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  console.log('PASS labs');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
