// Shared helpers for the Cyber Quest specs (not a spec itself: run.sh only picks up *.spec.js).
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4012;
const URL = `http://localhost:${PORT}/cyber-quest/?debug=1`;
const SHOTS = process.env.SHOTS_DIR || null;

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const browser = await chromium.launch();
  // Service workers are blocked: their first-install claim() can reload the page mid-spec.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // A missing sprite or background shows up as a 4xx, not a console error.
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  page.on('dialog', (d) => d.accept());

  const ev = (f, a) => page.evaluate(f, a);
  const open = async () => {
    await page.goto(URL);
    await page.waitForFunction(() => window.__cyberQuest, null, { timeout: 5000 });
  };
  // Training Grounds is collapsed by default; mission and lab cards live inside it.
  // Training Grounds only shows while the player stands on its map spot: walk there, then open it.
  const openGrounds = () => ev(() => {
    const m = window.__cyberQuest.map;
    if (window.__cyberQuest.progress.settings.mapAt !== 'grounds') m.walk('grounds');
    m.syncGrounds();
    document.getElementById('grounds').open = true;
  });
  const screen = () => ev(() => window.__cyberQuest.state.screen);
  // The terminal opens full screen from a button; open it first if it's closed.
  const type = async (cmd) => {
    if (await page.isVisible('#ops-open')) await page.click('#ops-open');
    await page.fill('#ops-input', cmd); await page.press('#ops-input', 'Enter');
  };
  const feed = () => ev(() => document.getElementById('ops-feed').innerText);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  const noHScroll = async () => assert(!(await ev(() => document.documentElement.scrollWidth > innerWidth)), 'page scrolls horizontally');

  return { browser, page, errors, ev, open, openGrounds, screen, type, feed, shot, noHScroll };
}


// Solutions for the no-hint challenges and chapter exams, built from the run's random T.vars.
const SOLVE = {
  'ch-find': (v) => ['find /srv/shared -name launch-key.txt', 'cat ' + v.path, 'answer ' + v.code, 'answer ' + v.dir],
  'ch-map': (v) => ['cat /etc/passwd', 'answer ' + v.user, 'ls /var/log', 'answer ' + v.logs, 'ls -a /tmp', 'ls -a /var/tmp', 'answer ' + v.code],
  'ch-logs': (v) => ['grep Failed /var/log/auth.log', 'answer ' + v.ip, 'answer ' + v.n, 'grep Accepted /var/log/auth.log', 'answer ' + v.user],
  'ch-filter': (v) => ['grep -v CRON /var/log/syslog | wc -l', 'answer ' + v.n, 'grep "Failed password" /var/log/auth.log | tail -n 1', 'answer ' + v.time],
  'ch-trail': (v) => ['cut -d " " -f 1 /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -n 1', 'answer ' + v.ip, 'grep -r ' + v.ip + ' /var/log', 'answer ' + v.user],
  'ch-jobs': (v) => ['ps aux', 'kill ' + v.pid, 'ls /etc/cron.d', 'answer ' + v.job],
  'ch-perms': (v) => ['ls -l ~/.ssh', 'chmod 600 ' + v.key, 'ss -tlnp', 'systemctl stop ' + v.svc, 'ufw deny ' + v.port, 'ufw enable'],
  'ch-final': (v) => ['find /srv/shared -name cert-key.txt', 'cat ' + v.path, 'answer ' + v.code, 'grep Failed /var/log/auth.log', 'answer ' + v.ip, 'ps aux', 'kill ' + v.pid, 'ls -l ~/.ssh', 'chmod 600 ' + v.key]
};

module.exports = { launch, assert, sleep, SOLVE };
