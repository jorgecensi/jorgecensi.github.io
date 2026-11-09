// Plays the whole story campaign the way a player would: taps through scenes, answers
// questions (one wrong first), types real commands in every training and incident beat,
// and checks each live mechanic fires (miner respawn, SSH lockout warning, C2 relaunch).
const { launch, assert, sleep, SOLVE } = require('./_helpers');

const TRAIN = {
  'first-contact': ['pwd', 'ls', 'cd projects', 'ls', 'cd starfall', 'ls', 'pwd', 'cd ..', 'cd ..', 'ls -a', 'cat incident-ticket.txt', 'whoami'],
  'lost-and-found': ['ls', 'cat sam-note.txt', 'cd /srv/shared', 'ls', 'cd marketing', 'ls', 'cat README.txt', 'cd ../engineering/releases', 'ls', 'ls -a', 'cd .archive', 'ls', 'cd 2026-03', 'cat release-checklist.txt', 'pwd', 'find /srv/shared -name starfall-logo.png', 'cd /srv/shared/art/logos/wip/v3', 'ls'],
  'linux-map': ['ls /', 'cd /etc', 'ls', 'cat hostname', 'ls /var/log', 'cd ~', 'pwd', 'ls -a /tmp'],
  'reading-logs': ['tail syslog', 'grep -i error syslog', 'cat auth.log', 'grep -c Failed auth.log', 'answer 198.51.100.23'],
  'log-filters': ['head -n 3 syslog', 'grep -v CRON syslog', 'grep -i error syslog | grep app', 'grep "Failed password" auth.log', 'grep "Failed password" auth.log | tail -n 1', 'answer 09:15:20', 'answer 09:13:48'],
  'log-timeline': ['ls nginx', 'head nginx/access.log', 'cut -d " " -f 1 nginx/access.log', 'cut -d " " -f 1 nginx/access.log | sort | uniq -c | sort -rn | head -n 1', 'answer 203.0.113.45', 'grep -r 203.0.113.45 /var/log', 'answer deploy'],
  jobs: ['ps aux', 'kill 3310', 'cat /etc/crontab', 'ls /etc/cron.d', 'crontab -l'],
  perms: ['ls -l ~/.ssh', 'chmod 600 ~/.ssh/id_ed25519', 'ss -tlnp', 'systemctl stop ftp', 'ufw deny 21', 'ufw enable'],
  'Deleting safely': ['cat /etc/cron.d/old-test', 'rm /etc/cron.d/old-test', 'ls /etc/cron.d'],
  'Restore from backup': ['ls /backup/starfall', 'restore-backup /srv/starfall', 'ls /srv/starfall']
};

(async () => {
  const { browser, page, errors, ev, open, screen, type, feed, shot, noHScroll } = await launch();
  const seen = { miner: false, lockout: false, c2: false, wrongAnswer: false };
  let triageAttempt = 0;

  const procPid = (name) => ev((n) => { const x = window.__cyberQuest.shell.T.procs.find((q) => q.cmd.includes(n)); return x && x.pid; }, name);

  const playTerminal = async () => {
    const info = await ev(() => { const s = window.__cyberQuest.shell; return { title: s.lab.title, lab: s.lab.labId, inc: !!s.lab.incident }; });
    const key = info.lab || info.title;
    if (TRAIN[key]) {
      for (const c of TRAIN[key]) await type(c);
    } else if (SOLVE[key]) {
      // A chapter's final exam: no lesson, no hints, random answers.
      await type('hint');
      assert(/No hints/.test(await ev(() => window.__cyberQuest.ops.out)), key + ': the exam gives no hints');
      const vars = await ev(() => window.__cyberQuest.shell.T.vars);
      for (const c of SOLVE[key](vars)) await type(c);
      seen.exams = (seen.exams || 0) + 1;
    } else if (key === 'SSH under attack') {
      await sleep(3000);
      await type('grep Failed /var/log/auth.log');
      await type('ufw deny from 203.0.113.66');
    } else if (key === 'Ghost in the machine') {
      await type('ps aux'); await type('kill 4242');
      for (let i = 0; i < 40 && !/is back/.test(await feed()); i++) await sleep(500);
      seen.miner = /is back/.test(await feed());
      await shot('story-miner');
      await type('cat /etc/cron.d/sys-update'); await type('rm /etc/cron.d/sys-update'); await type('rm /var/tmp/.x/kworkerds');
      await type('kill ' + await procPid('kworkerds'));
    } else if (key === 'Port scan') {
      await type('ss -tlnp');
      await type('ufw deny 22'); // lock ourselves out on purpose
      await sleep(1600);
      seen.lockout = /reach the server/.test(await feed());
      await type('ufw delete deny 22');
      for (const c of ['systemctl stop ftp', 'systemctl stop telnet', 'systemctl stop devpanel', 'ufw deny 3306']) await type(c);
    } else if (key === 'Ransomware') {
      await type('ps aux'); await type('kill 6660');
      for (let i = 0; i < 30 && !/relaunched/.test(await feed()); i++) await sleep(500);
      seen.c2 = /relaunched/.test(await feed());
      await shot('story-ransomware');
      await type('ss -tnp'); await type('ufw deny from 198.51.100.77');
      const pid = await procPid('lockd');
      if (pid) await type('kill ' + pid);
    } else throw new Error('ASSERT FAILED: unknown terminal beat ' + key);
    // Every objective done: the clock stops and the session waits for the player to log out.
    await page.waitForFunction(() => window.__cyberQuest.shell._ready, null, { timeout: 15000 });
    assert(!(await ev(() => window.__cyberQuest.shell._finished)), key + ': the result waits for exit');
    await type('exit');
    await page.waitForSelector('#ops-done.show', { timeout: 5000 });
    assert(/Connection to \S+ closed/.test(await ev(() => window.__cyberQuest.ops.out)), key + ': exit prints the logout lines');
    const title = await page.innerText('#ops-done-title');
    assert(info.inc ? /contained/.test(title) : /done|passed/.test(title), key + ' did not complete: ' + title);
    console.log('  ', key, '→', title);
    await page.click('#ops-continue');
  };

  const playTriage = async () => {
    triageAttempt++;
    for (;;) {
      const st = await ev(() => { const t = window.__cyberQuest.triage; return { over: t.over, active: t.active.map((m) => ({ id: m.id, phish: m.phish })) }; });
      if (st.over) break;
      // New mail is added below the older ones, so nothing moves under the player's finger.
      const order = await ev(() => [...document.querySelectorAll('#tr-inbox .tr-card:not(.gone)')].map((c) => Number(c.id.slice(4))));
      assert(order.every((id, i) => i === 0 || id > order[i - 1]), 'inbox keeps the oldest mail on top: ' + order.join(','));
      // First attempt allows everything and must fail; the retry answers correctly.
      for (const m of st.active) await page.click(`[data-tr="${triageAttempt === 1 ? 'allow' : m.phish ? 'report' : 'allow'}"][data-id="${m.id}"]`).catch(() => {});
      await sleep(400);
    }
    const title = await page.innerText('#tr-done-title');
    assert(triageAttempt === 1 ? /Too many/.test(title) : /stopped/.test(title), 'triage attempt ' + triageAttempt + ': ' + title);
    console.log('   triage attempt', triageAttempt, '→', title);
    await page.click('#tr-continue');
  };

  await open();
  assert(/Start the story/.test(await page.innerText('[data-story-play]')), 'fresh hero offers to start the story');
  await page.click('[data-story-play]');
  let done = false;
  for (let guard = 0; guard < 2000 && !done; guard++) {
    const sc = await screen();
    if (sc === 'ops') { await playTerminal(); continue; }
    if (sc === 'triage') { await playTriage(); continue; }
    assert(sc === 'story', 'unexpected screen ' + sc);
    const st = await ev(() => { const s = window.__cyberQuest.story; return { ask: !!s.askBeat, answer: s.askBeat && s.askBeat.answer, next: !!document.querySelector('[data-story-next]'), end: !!document.querySelector('#st-choices [data-go="home"]') }; });
    if (st.ask) {
      if (!seen.wrongAnswer) {
        const wrong = await ev(() => [...document.querySelectorAll('#st-choices [data-ask]')].map((b) => Number(b.dataset.ask)).find((k) => k !== window.__cyberQuest.story.askBeat.answer));
        await page.click(`[data-ask="${wrong}"]`);
        seen.wrongAnswer = /Not quite/.test(await page.innerText('#st-feedback'));
      }
      await page.click(`[data-ask="${st.answer}"]`);
      await page.click('[data-story-tap]');
    } else if (st.next) await page.click('[data-story-next]');
    else if (st.end) done = true;
    else await page.click('#st-dialog');
  }
  assert(done, 'reached the end of chapter 5');
  await shot('story-end');
  assert(seen.exams === 5, 'every chapter ends with a no-hint exam (got ' + seen.exams + ')');
  assert(seen.wrongAnswer, 'a wrong answer is rejected with feedback');
  assert(seen.miner, 'the miner respawns while its cron job exists');
  assert(seen.lockout, 'blocking port 22 triggers the lockout warning');
  assert(seen.c2, 'the C2 relaunches the encryptor while its line is open');

  await page.click('#st-choices [data-go="home"]');
  const prog = await ev(() => window.__cyberQuest.progress);
  assert(['ch1', 'ch2', 'ch3', 'ch4', 'ch5'].every((id) => prog.story[id] && prog.story[id].done), 'every chapter is saved as done');
  assert(['first-contact', 'lost-and-found', 'linux-map', 'reading-logs', 'log-filters', 'log-timeline', 'jobs', 'perms'].every((id) => prog.labs[id] && prog.labs[id].done), 'training beats clear their labs');
  await noHScroll();
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  console.log('PASS story');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
