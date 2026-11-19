// End to end: link → lookup → save MP4 → convert to .gif, plus the fallbacks and errors.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch, assert, fxPost, fxGif, CLIP, PHOTO_URL } = require('./_helpers');

(async () => {
  const t = await launch();
  const { page, api, calls, ev, open, status, submit, waitStatus, shot, noHScroll } = t;
  try {
    await open();

    // ── Link parsing ──
    const ids = await ev(() => [
      'https://x.com/someone/status/1790000000000000001?s=20',
      'https://twitter.com/someone/status/1790000000000000002/photo/1',
      'Look at this https://x.com/someone/status/1790000000000000003',
      'https://mobile.twitter.com/i/web/status/1790000000000000004',
      'https://fxtwitter.com/a/status/1790000000000000005',
      '1790000000000000006',
      'https://x.com/someone',
      'hello',
    ].map(window.__gifGrab.parseId));
    assert(JSON.stringify(ids) === JSON.stringify(['1790000000000000001', '1790000000000000002', '1790000000000000003', '1790000000000000004', '1790000000000000005', '1790000000000000006', null, null]), 'parseId: ' + JSON.stringify(ids));

    await submit('https://x.com/someone');
    assert(/doesn’t look like a link/.test(await status()), 'bad link message: ' + await status());
    await submit('https://t.co/abc123');
    assert(/t\.co/.test(await status()), 't.co message: ' + await status());
    console.log('ok parse + bad links');

    // ── Happy path ──
    await submit('https://x.com/tester/status/1790000000000000001?s=20');
    await waitStatus(/Found a GIF/);
    assert(calls[0] === 'fx', 'asked FxTwitter first');
    assert(await page.isVisible('.media[data-kind="gif"] video'), 'preview video shown');
    assert(/Test Person/.test(await page.textContent('.post-meta')), 'author shown');
    await noHScroll();
    await shot('found');

    const [mp4] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save-mp4"]')]);
    assert(mp4.suggestedFilename() === 'tester-1790000000000000001.mp4', 'mp4 name ' + mp4.suggestedFilename());
    const mp4Path = path.join(os.tmpdir(), `gg-${process.pid}.mp4`);
    await mp4.saveAs(mp4Path);
    assert(fs.statSync(mp4Path).size === fs.statSync(CLIP).size, 'mp4 bytes match the source');
    console.log('ok save mp4');

    await page.selectOption('[data-opt="size"]', '320');
    await page.selectOption('[data-opt="fps"]', '10');
    await page.click('[data-act="make-gif"]');
    await page.waitForSelector('.result:not([hidden]) img', { timeout: 60000 });
    const info = await page.textContent('[data-gif-info]');
    assert(/320 × 180/.test(info), 'gif info ' + info);
    assert(!/\bnull\b|undefined/.test(await page.textContent('.result')), 'stray null/undefined in the result card');
    await noHScroll();
    await shot('converted');

    const [gif] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save-gif"]')]);
    assert(gif.suggestedFilename() === 'tester-1790000000000000001.gif', 'gif name ' + gif.suggestedFilename());
    const gifPath = path.join(os.tmpdir(), `gg-${process.pid}.gif`);
    await gif.saveAs(gifPath);
    const head = fs.readFileSync(gifPath).subarray(0, 6).toString('latin1');
    assert(head === 'GIF89a', 'gif header ' + head);
    // Independent decode with Pillow, compared frame by frame with ffmpeg's decode of the clip.
    const check = JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, '..', 'check_gif.py'), gifPath, CLIP, '10', '320']).toString());
    assert(check.frames >= 10 && Math.abs(check.ms - 2000) <= 20, 'gif frames/duration ' + JSON.stringify(check));
    // Chromium decodes it too.
    const decoded = await ev(async () => {
      const img = document.querySelector('.result img');
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
    assert(decoded[0] === 320 && decoded[1] === 180, 'chromium decode ' + decoded);
    console.log('ok make gif', JSON.stringify(check), fs.statSync(gifPath).size, 'bytes');

    // ── Cancel ──
    await page.selectOption('[data-opt="size"]', '720');
    await page.click('[data-act="make-gif"]');
    await page.click('[data-act="cancel"]');
    await page.waitForFunction(() => /Cancelled/.test(document.querySelector('.progress').textContent), null, { timeout: 10000 });
    console.log('ok cancel');

    // ── FxTwitter down → vxTwitter ──
    calls.length = 0;
    api.fx = () => ({ status: 500, body: {} });
    await submit('https://x.com/tester/status/1790000000000000002');
    await waitStatus(/Found a GIF/);
    const apis = calls.filter((c) => c === 'fx' || c === 'vx').join();
    assert(apis === 'fx,vx', 'fell back to vx: ' + apis);
    console.log('ok vx fallback');

    // ── Not found on both ──
    api.fx = () => ({ status: 404, body: { code: 404, message: 'NOT_FOUND' } });
    api.vx = () => ({ status: 404, body: {} });
    await submit('https://x.com/tester/status/1790000000000000003');
    await waitStatus(/Couldn’t find that post/);
    assert((await page.$$('.media')).length === 0, 'no media after not found');
    console.log('ok not found');

    // ── Photo-only post ──
    api.fx = (id) => ({ status: 200, body: fxPost(id, [{ type: 'photo', url: PHOTO_URL, width: 1, height: 1 }]) });
    await submit('https://x.com/tester/status/1790000000000000004');
    await waitStatus(/No GIF in that post/);
    const [pic] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save-photo"]')]);
    assert(pic.suggestedFilename() === 'tester-1790000000000000004.png', 'photo name ' + pic.suggestedFilename());
    assert(calls.includes('photo'), 'photo fetched');
    console.log('ok photo post');

    // ── Text-only post ──
    api.fx = (id) => ({ status: 200, body: fxPost(id, []) });
    await submit('https://x.com/tester/status/1790000000000000005');
    await waitStatus(/no GIF, video or image/);
    console.log('ok no media');

    // ── Video host without CORS → open-in-new-tab fallback ──
    api.fx = (id) => ({ status: 200, body: fxPost(id, [{ type: 'gif', url: 'https://video.twimg.com/tweet_video/NoCors.mp4', width: 320, height: 180 }]) });
    await submit('https://x.com/tester/status/1790000000000000006');
    await waitStatus(/Found a GIF/);
    await page.click('[data-act="save-mp4"]');
    await page.waitForSelector('.warn a[target="_blank"]', { timeout: 10000 });
    console.log('ok no-cors fallback');

    // ── Android share target ──
    api.fx = (id) => ({ status: 200, body: fxGif(id) });
    await open('&text=' + encodeURIComponent('Check this out https://x.com/tester/status/1790000000000000007?s=46'));
    await waitStatus(/Found a GIF/);
    assert(await page.inputValue('#url') === 'https://x.com/tester/status/1790000000000000007?s=46', 'share text put into the box');
    assert(!/text=/.test(page.url()), 'share params cleared from the address');
    console.log('ok share target');

    const real = t.errors.filter((e) => !/Failed to load resource|CORS|Access-Control/i.test(e));
    assert(real.length === 0, 'page errors: ' + real.join(' | '));
    console.log('PASS smoke');
  } finally {
    await t.browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
