---
description: Launch the World Cup 2026 app locally and take Playwright screenshots or record a video. Use when asked to test, verify, show, or make a video/simulation of the worldcup-2026 app.
---

# Screenshot / record video of the World Cup 2026 app

The app (`worldcup-2026/index.html`) loads React, ReactDOM, Babel, and QRCode from cdnjs — all blocked in the cloud environment. This skill patches those away and uses a local HTTP server so Playwright can render the app fully.

## 1 — Set up dependencies (once per session)

```bash
# Install exact CDN-matching versions locally
cd /tmp && npm install react@18.2.0 react-dom@18.2.0 @babel/standalone@7.23.5 2>&1 | tail -3
```

If you'll be **recording video**, also install ffmpeg once (not preinstalled; the first `apt-get install` attempt sometimes 404s on a stale mirror index — run `apt-get update` first if so):

```bash
apt-get update 2>&1 | tail -3
apt-get install -y --no-install-recommends ffmpeg 2>&1 | tail -5
```

## 2 — Build the serve directory

Run this every time the source HTML changes:

```bash
kill $(lsof -ti:8765 2>/dev/null) 2>/dev/null; true

mkdir -p /tmp/wc_serve/worldcup-2026
cp -r /home/user/jorgecensi.github.io/worldcup-2026/* /tmp/wc_serve/worldcup-2026/

# Local JS stubs
cp /tmp/node_modules/react/umd/react.production.min.js      /tmp/wc_serve/react.min.js
cp /tmp/node_modules/react-dom/umd/react-dom.production.min.js /tmp/wc_serve/react-dom.min.js
cp /tmp/node_modules/@babel/standalone/babel.min.js         /tmp/wc_serve/babel.min.js
echo 'window.QRCode=function(){};QRCode.prototype.clear=function(){};QRCode.prototype.makeCode=function(){};' \
  > /tmp/wc_serve/qrcode.min.js

# Patch the HTML: swap CDN URLs for local paths, strip SRI integrity attrs
sed -i \
  -e 's|https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js|/react.min.js|g' \
  -e 's|https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js|/react-dom.min.js|g' \
  -e 's|https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js|/babel.min.js|g' \
  -e 's|https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js|/qrcode.min.js|g' \
  -e 's/ integrity="[^"]*"//g' \
  -e 's/ crossorigin="[^"]*"//g' \
  /tmp/wc_serve/worldcup-2026/index.html

python3 -m http.server 8765 --directory /tmp/wc_serve &>/tmp/wc_server.log &
sleep 1
curl -s -o /dev/null -w "Server: %{http_code}\n" http://localhost:8765/worldcup-2026/index.html
```

## 3 — Seed test data BEFORE `page.goto()`, not after

The app persists its own state back to `localStorage` on mount (`useEffect(()=>{saveScores(...)},[groupMatches,ko])` and similar for predictions/rivals). If you `page.goto()` first and then `page.evaluate()` to write `localStorage`, the app's own persist-effect can clobber your seeded data within the first render — it looks like your data silently didn't take.

**Fix: use `page.addInitScript()` before `page.goto()`.** It runs before any of the page's own scripts on every navigation, so the app boots with your data already in place:

```javascript
await page.addInitScript(({ me, rivals, name, scores }) => {
  localStorage.setItem('wc2026:predictions:v1', JSON.stringify(me));
  localStorage.setItem('wc2026:player:v1', name);
  localStorage.setItem('wc2026:rivals:v1', JSON.stringify(rivals));
  // Seed real results directly under the app's own scores cache key — this
  // avoids the "refresh scores" button flow entirely, which also fires an
  // unrelated flash-celebration queue for every newly-detected exact/right
  // rival guess (noisy, and not what you're usually testing).
  localStorage.setItem('wc2026:scores:v1', JSON.stringify({ group: scores.group, ko: {} }));
}, { me: {...}, name: 'Jorge', rivals: [...], scores: require('/home/user/jorgecensi.github.io/worldcup-2026/scores.json') });

await page.goto('http://localhost:8765/worldcup-2026/index.html');
```

Predictions format: `{ group: { "A-0": {home,away}, ... }, ko: { "r32-0": {a,b}, ... } }`. Group match ids are `${GROUP_LETTER}-${0..5}`; KO ids are `r32-0..15`, `r16-0..7`, `qf-0..3`, `sf-0..1`, `final`, `third`.

To test the real `?rival=` share-link accept flow (someone scans/taps a link), append it to the URL you `goto()` instead of seeding rivals via localStorage — the app's own `useEffect` detects the query param and shows the `AddRivalModal` (button text matches `/add rival/i`).

## 4 — Playwright helper script

Write `/tmp/wc_screenshot.cjs` and run it with `timeout 90 node /tmp/wc_screenshot.cjs`.

```javascript
// /tmp/wc_screenshot.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // If seeding data, call page.addInitScript(...) here, BEFORE goto — see § 3.

  await page.goto('http://localhost:8765/worldcup-2026/index.html');

  // Babel standalone compiles ~6 000 lines of JSX — wait for React to mount
  await page.waitForFunction(
    () => document.querySelector('#root')?.children?.length > 0,
    { timeout: 45000 }
  );
  // Splash screen is TIMER-driven (dismisses itself at 2.9s via setTimeout,
  // not on click) — wait it out fully before interacting, or early clicks on
  // nav buttons will silently no-op because the splash overlay is still on top.
  await page.waitForTimeout(3300);
  await page.click('body'); // harmless, not what actually dismisses it
  await page.waitForTimeout(300);

  if (errors.length) console.warn('JS errors:', errors);

  // ── Navigation helpers ────────────────────────────────────────────────────

  /** Click the main bottom-nav tab. Real labels: Fantasy / Standings / Knockout / Bracket / Stats
   *  — there is NO "Fixtures" tab; the fixtures list lives inside Standings (click a group) or
   *  is reached as a sub-view. Default view on load is "Fantasy". */
  async function goTab(label) {
    await page.evaluate((l) => {
      for (const b of document.querySelectorAll('button')) {
        if (new RegExp(l, 'i').test(b.textContent)) { b.click(); return; }
      }
    }, label);
    await page.waitForTimeout(800);
  }

  /**
   * Switch the Knockout round using the custom UpDropdown at the bottom.
   * label: substring of the option text, e.g. 'Round of 16', 'Quarter', 'Semi', 'Final'
   */
  async function goKORound(label) {
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.includes('▾')) { b.click(); return; }
      }
    });
    await page.waitForTimeout(300);
    await page.evaluate((l) => {
      for (const d of document.querySelectorAll('div')) {
        if (d.textContent.trim().includes(l) && d.style?.cursor === 'pointer') {
          d.click(); return;
        }
      }
    }, label);
    await page.waitForTimeout(700);
  }

  /** Load live scores from scores.json (same as clicking "Refresh scores").
   *  The refresh button only exists on the Knockout/Fixtures views, NOT Fantasy —
   *  goTab('knockout') before calling this, or better, seed 'wc2026:scores:v1'
   *  directly (see § 3) to skip this entirely and avoid the flash-celebration queue. */
  async function loadLiveScores() {
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (/refresh/i.test(b.textContent)) { b.click(); return; }
      }
    });
    await page.waitForTimeout(1500);
  }

  /** Set a native <input type="range"> (e.g. the progression modal's .pp-slider)
   *  and have React's onChange actually fire. A plain `.value = x` assignment is
   *  silently ignored by React-controlled inputs — you must go through the
   *  native prototype setter, then dispatch a real 'input' event. */
  async function setRange(selector, value) {
    await page.evaluate(({ selector, value }) => {
      const el = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { selector, value });
  }

  // ── YOUR SCREENSHOTS BELOW ───────────────────────────────────────────────
  // Customise this section for whatever you need to capture.

  await goTab('knockout');
  await loadLiveScores();

  await page.screenshot({ path: '/tmp/wc_r32.png' });

  await goKORound('Round of 16');
  await page.screenshot({ path: '/tmp/wc_r16.png' });

  await browser.close();
  console.log('Screenshots saved to /tmp/wc_*.png');
})();
```

## 5 — Recording a video instead of screenshots

Same setup, but record the whole `BrowserContext` instead of a plain page. Requires ffmpeg (§ 1) to convert the output `.webm` to a widely-playable `.mp4`.

```javascript
// /tmp/wc_record.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');

const VIDEO_DIR = '/tmp/wc_video_out';
fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const size = { width: 420, height: 900 }; // portrait phone; use e.g. 844x390 for landscape
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: VIDEO_DIR, size } });
  const page = await context.newPage();

  // ... addInitScript to seed data (§ 3), goto, wait out splash (3300ms), drive the
  // UI exactly like the screenshot script above ...

  await context.close(); // <- finalizes the .webm; nothing is written before this

  // Playwright names the file by an internal hash — find and rename it.
  const [f] = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm'));
  fs.renameSync(path.join(VIDEO_DIR, f), path.join(VIDEO_DIR, 'out.webm'));
  await browser.close();
})();
```

```bash
timeout 90 node /tmp/wc_record.cjs
cd /tmp/wc_video_out && ffmpeg -y -i out.webm -c:v libx264 -pix_fmt yuv420p -crf 20 -preset medium -movflags +faststart out.mp4
```

Then send `out.mp4` (not the `.webm`) with `SendUserFile` — much broader playback compatibility.

For a **long animation** (e.g. a 72-match replay at 1s/match), don't record the whole thing: `page.waitForTimeout()` for a representative slice (~20-30s), then jump to the end via `setRange()` on the slider before closing the context, so the clip shows both the motion and the finish without a multi-minute file.

## Notes

- **Babel compile time** — the `waitForFunction` timeout is 45 s; don't reduce it.
- **Splash screen** — timer-driven (2.9s via `setTimeout`), not click-dismissible. Wait ≥3.3s before the first interaction or early clicks silently no-op against the still-visible overlay.
- **Round dropdown** — `UpDropdown` is a custom React component (not a `<select>`). Use the `goKORound` helper above; native `select` APIs won't work.
- **SRI block** — the QRCode CDN script has an `integrity` attribute; stripping it (step 2 `sed`) is required, not optional.
- **Babel version** — must be exactly `@babel/standalone@7.23.5`. Babel 8 breaks the `type="text/babel" data-presets="react"` API.
- **Port** — uses 8765. Kill any previous process on that port before starting (step 2 does this).
- **`document.body.textContent` includes raw `<script>` source** — all the app's `<script>` tags are children of `<body>`, so `.textContent` on `body` picks up your own JS/comment text, not just rendered UI. Scope any "does the page say X" check to `document.getElementById('root').textContent` instead.
- **Range inputs need the native setter trick** — see `setRange()` above; a plain `el.value = x` is invisible to React.
