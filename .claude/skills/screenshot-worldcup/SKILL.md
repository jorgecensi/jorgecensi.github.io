---
description: Launch the World Cup 2026 app locally and take Playwright screenshots. Use when asked to test, verify, or show the worldcup-2026 app visually.
---

# Screenshot the World Cup 2026 app

The app (`worldcup-2026/index.html`) loads React, ReactDOM, Babel, and QRCode from cdnjs — all blocked in the cloud environment. This skill patches those away and uses a local HTTP server so Playwright can render the app fully.

## 1 — Set up dependencies (once per session)

```bash
# Install exact CDN-matching versions locally
cd /tmp && npm install react@18.2.0 react-dom@18.2.0 @babel/standalone@7.23.5 2>&1 | tail -3
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

## 3 — Playwright helper script

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

  await page.goto('http://localhost:8765/worldcup-2026/index.html');

  // Babel standalone compiles ~6 000 lines of JSX — wait for React to mount
  await page.waitForFunction(
    () => document.querySelector('#root')?.children?.length > 0,
    { timeout: 45000 }
  );
  await page.waitForTimeout(1500);

  // Dismiss the splash screen
  await page.click('body');
  await page.waitForTimeout(500);

  if (errors.length) console.warn('JS errors:', errors);

  // ── Navigation helpers ────────────────────────────────────────────────────

  /** Click the main bottom-nav tab (Fantasy / Fixtures / Standings / Knockout / Stats) */
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
    // Open the dropdown (button that contains ▾)
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.includes('▾')) { b.click(); return; }
      }
    });
    await page.waitForTimeout(300);
    // Click the matching option (div with cursor:pointer)
    await page.evaluate((l) => {
      for (const d of document.querySelectorAll('div')) {
        if (d.textContent.trim().includes(l) && d.style?.cursor === 'pointer') {
          d.click(); return;
        }
      }
    }, label);
    await page.waitForTimeout(700);
  }

  /** Load live scores from scores.json (same as clicking "Refresh scores") */
  async function loadLiveScores() {
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (/refresh/i.test(b.textContent)) { b.click(); return; }
      }
    });
    await page.waitForTimeout(1500);
  }

  // ── YOUR SCREENSHOTS BELOW ───────────────────────────────────────────────
  // Customise this section for whatever you need to capture.

  await loadLiveScores();          // populate group results from scores.json

  await goTab('knockout');

  await page.screenshot({ path: '/tmp/wc_r32.png' });

  await goKORound('Round of 16');
  await page.screenshot({ path: '/tmp/wc_r16.png' });

  await goKORound('Quarter');
  await page.screenshot({ path: '/tmp/wc_qf.png' });

  await goKORound('Semi');
  await page.screenshot({ path: '/tmp/wc_sf.png' });

  await browser.close();
  console.log('Screenshots saved to /tmp/wc_*.png');
})();
```

## 4 — Read and send the screenshots

```javascript
// After the script finishes, read each PNG with the Read tool and send with SendUserFile.
```

## Notes

- **Babel compile time** — the `waitForFunction` timeout is 45 s; don't reduce it.
- **Round dropdown** — `UpDropdown` is a custom React component (not a `<select>`). Use the `goKORound` helper above; native `select` APIs won't work.
- **SRI block** — the QRCode CDN script has an `integrity` attribute; stripping it (step 2 `sed`) is required, not optional.
- **Babel version** — must be exactly `@babel/standalone@7.23.5`. Babel 8 breaks the `type="text/babel" data-presets="react"` API.
- **Port** — uses 8765. Kill any previous process on that port before starting (step 2 does this).
