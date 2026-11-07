#!/usr/bin/env node
// Screenshot a page of this site at phone size and report what's wrong with it.
//
//   node tools/ui-check/shoot.js /cyber-quest/?debug=1                 # one full-page shot
//   node tools/ui-check/shoot.js /cyber-quest/?debug=1 --steps s.js    # scripted shots
//   node tools/ui-check/shoot.js /tuner/ --width 1280 --height 800     # desktop
//
// Serves nothing itself: run `jekyll build` and serve `_site/` first (see README.md).
// Prints failed requests (4xx/5xx), console errors, page errors and horizontal
// scroll, and exits 1 if there are any, so it doubles as a smoke check.
//
// A steps file exports `async ({ page, shot, sleep }) => { ... }`; call
// `await shot('name')` wherever you want a screenshot.
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--full', '--motion'].includes(args[i - 1])));
if (!target) { console.error('usage: shoot.js <path-or-url> [--steps file.js] [--out dir] [--port 4011] [--width 390 --height 844] [--motion]'); process.exit(2); }

const port = opt('port', '4011');
const url = /^https?:/.test(target) ? target : `http://localhost:${port}${target.startsWith('/') ? '' : '/'}${target}`;
const out = path.resolve(opt('out', process.env.SHOTS_DIR || path.join(process.env.TMPDIR || '/tmp', 'ui-check')));
fs.mkdirSync(out, { recursive: true });

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('playwright not found: run with NODE_PATH="$(npm root -g)" or install the pinned version (see README.md)');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: +opt('width', 390), height: +opt('height', 844) },
    deviceScaleFactor: 2,
    // Reduced motion makes screenshots deterministic (no fades caught half-way).
    reducedMotion: flag('motion') ? 'no-preference' : 'reduce',
    // A first-install service worker can reload the page mid-script.
    serviceWorkers: 'block'
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });
  page.on('dialog', (d) => d.accept());

  const shots = [];
  const shot = async (name, full = true) => {
    const file = path.join(out, name.replace(/[^\w.-]+/g, '-') + '.png');
    await page.screenshot({ path: file, fullPage: full });
    shots.push(file);
    return file;
  };
  const sleep = (ms) => page.waitForTimeout(ms);

  await page.goto(url);
  await sleep(300);
  const steps = opt('steps');
  if (steps) await require(path.resolve(steps))({ page, shot, sleep, url });
  else await shot('page');

  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (hscroll) problems.push('horizontal scroll: the page is wider than the viewport');
  console.log('shots:\n  ' + shots.join('\n  '));
  console.log(problems.length ? 'problems:\n  ' + problems.join('\n  ') : 'problems: none');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
