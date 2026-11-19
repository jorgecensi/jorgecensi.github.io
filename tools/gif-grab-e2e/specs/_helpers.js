// Shared helpers for the GIF Grab specs (not a spec itself: run.sh only picks up *.spec.js).
// Cloud containers can't reach X, the lookup APIs or video.twimg.com, so every
// external request is answered by a Playwright route with a local fixture.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4017;
const BASE = `http://localhost:${PORT}/gif-grab/`;
const SHOTS = process.env.SHOTS_DIR || null;
const CLIP = path.join(__dirname, '..', 'fixtures', 'clip.webm');
const VIDEO_URL = 'https://video.twimg.com/tweet_video/TestClip.mp4';
const PHOTO_URL = 'https://pbs.twimg.com/media/TestPic.jpg';

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What api.fxtwitter.com answers for a post with the given media.
const fxPost = (id, media) => ({
  code: 200, message: 'OK',
  tweet: {
    id, text: 'a test post', url: `https://x.com/tester/status/${id}`,
    author: { name: 'Test Person', screen_name: 'tester' },
    media: { all: media },
  },
});
const fxGif = (id) => fxPost(id, [{ type: 'gif', url: VIDEO_URL, thumbnail_url: PHOTO_URL, width: 320, height: 180 }]);
// What api.vxtwitter.com answers.
const vxGif = (id) => ({
  tweetID: id, text: 'a test post', user_name: 'Test Person', user_screen_name: 'tester',
  media_extended: [{ type: 'gif', url: VIDEO_URL, thumbnail_url: PHOTO_URL, size: { width: 320, height: 180 } }],
});

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

async function launch({ ua } = {}) {
  const browser = await chromium.launch();
  // Service workers are blocked: their first-install claim() can reload the page mid-spec.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block', userAgent: ua ? UA[ua] : undefined });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const api = { fx: (id) => ({ status: 200, body: fxGif(id) }), vx: (id) => ({ status: 200, body: vxGif(id) }) };
  const calls = [];
  const referers = [];
  const json = (route, r) => route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body || {}) });
  await ctx.route('https://api.fxtwitter.com/**', (route) => {
    calls.push('fx'); json(route, api.fx(route.request().url().match(/(\d+)$/)[1]));
  });
  await ctx.route('https://api.vxtwitter.com/**', (route) => {
    calls.push('vx'); json(route, api.vx(route.request().url().match(/(\d+)$/)[1]));
  });
  await ctx.route('https://video.twimg.com/**', (route) => {
    calls.push('video');
    // Like the real host: any Referer but X's own gets a 403 (that's what broke saving on iPhone).
    const ref = route.request().headers()['referer'];
    if (ref) { referers.push(ref); return route.fulfill({ status: 403, body: '' }); }
    // Stands in for a blocked request (content blocker, network error).
    if (/Blocked/.test(route.request().url())) return route.abort('failed');
    route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(CLIP) });
  });
  await ctx.route('https://pbs.twimg.com/**', (route) => {
    calls.push('photo');
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG_1PX });
  });

  const ev = (f, a) => page.evaluate(f, a);
  const open = async (qs = '') => {
    await page.goto(BASE + '?debug=1' + qs);
    await page.waitForFunction(() => window.__gifGrab, null, { timeout: 5000 });
  };
  const status = () => page.textContent('#status');
  const submit = async (text) => { await page.fill('#url', text); await page.click('#go'); };
  const waitStatus = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), re.source, { timeout: 10000 });
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  const noHScroll = async () => assert(!(await ev(() => document.documentElement.scrollWidth > innerWidth)), 'page scrolls horizontally');

  return { browser, ctx, page, errors, api, calls, referers, ev, open, status, submit, waitStatus, shot, noHScroll };
}

module.exports = { launch, assert, sleep, fxPost, fxGif, vxGif, CLIP, VIDEO_URL, PHOTO_URL };
