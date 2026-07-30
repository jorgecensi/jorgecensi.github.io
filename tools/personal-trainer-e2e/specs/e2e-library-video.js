const { chromium } = require('playwright');

const BASE = 'http://localhost:4001/personal-trainer/';
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

    await page.goto(BASE);
    console.log('checkpoint: goto done');
    await page.waitForLoadState('networkidle');
    console.log('checkpoint: networkidle, active=', await active());

    // Fresh setup, get to home
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]');
        await page.click('#setup-duration .choice[data-v="25"]');
        await page.click('#setup-go');
    }
    assert(await active() === 'home', 'home reached');

    await page.click('#tabbar .tab[data-tab="library"]');
    assert(await active() === 'library', 'library shown');
    await shot('lib-1-closed');

    // Find items that have a preset link (a visible, non-hidden play button)
    const visibleIds = await page.$$eval('.lib-item .lib-play:not(.hidden)', (btns) =>
        btns.map((b) => b.dataset.play));
    assert(visibleIds.length >= 2, 'at least two exercises have a play button visible, got ' + visibleIds.length);
    const exId = visibleIds[0];
    const playBtn = page.locator(`.lib-play[data-play="${exId}"]`);
    const item = page.locator(`.lib-item[data-id="${exId}"]`);
    console.log('testing exercise:', exId);

    // 1. Tap play -> video loads, autoplaying muted (matches existing preview-screen convention)
    await playBtn.click();
    await page.waitForSelector(`#lv-${exId} iframe`, { timeout: 5000 });
    const src1 = await page.locator(`#lv-${exId} iframe`).getAttribute('src');
    assert(src1.includes('youtube-nocookie.com/embed/'), 'embeds youtube-nocookie iframe, got ' + src1);
    assert(src1.includes('autoplay=1') && src1.includes('mute=1'), 'autoplay+mute set like the existing preview pattern, got ' + src1);
    const isPlayingClass = await item.evaluate((el) => el.classList.contains('playing'));
    assert(isPlayingClass, 'lib-item gets .playing class');
    await shot('lib-2-playing');

    // 2. Tapping the head (name) should NOT close the video (stopPropagation) but SHOULD open cues/link body
    await item.locator('.lib-head').click({ position: { x: 10, y: 10 } }); // click near tier badge, away from button
    const stillPlayingAfterHeadClick = await item.evaluate((el) => el.classList.contains('playing'));
    assert(stillPlayingAfterHeadClick, 'video keeps playing after opening the cues/link accordion');
    const bodyOpen = await item.evaluate((el) => el.classList.contains('open'));
    assert(bodyOpen, 'accordion body opened');
    await shot('lib-3-playing-and-open');

    // 3. Toggle play again -> stops (iframe removed, class removed)
    await playBtn.click();
    const stopped = await page.locator(`#lv-${exId} iframe`).count();
    assert(stopped === 0, 'iframe removed on second tap (stopped)');
    const notPlaying = await item.evaluate((el) => el.classList.contains('playing'));
    assert(!notPlaying, '.playing class removed');

    // 4. Exclusivity: playing one item's video stops another's
    await playBtn.click();
    assert((await page.locator(`#lv-${exId} iframe`).count()) === 1, 'first video playing again');
    const secondId = visibleIds[1];
    const secondBtn = page.locator(`.lib-play[data-play="${secondId}"]`);
    const secondItem = page.locator(`.lib-item[data-id="${secondId}"]`);
    await secondBtn.click();
    await page.waitForSelector(`#lv-${secondId} iframe`, { timeout: 5000 });
    assert((await page.locator(`#lv-${exId} iframe`).count()) === 0, 'first video stopped when second starts');
    assert((await page.locator(`#lv-${secondId} iframe`).count()) === 1, 'second video now playing');

    // 5. Editing the link while playing clears the stale video
    await secondItem.locator('.lib-head').click({ position: { x: 10, y: 10 } }); // open its body too
    const input = secondItem.locator('input[data-link-for]');
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await input.dispatchEvent('change');
    await page.waitForTimeout(150);
    assert((await page.locator(`#lv-${secondId} iframe`).count()) === 0, 'video cleared after editing the link mid-play');
    const stillHasPlayBtn = await secondItem.locator('.lib-play').evaluate((el) => !el.classList.contains('hidden'));
    assert(stillHasPlayBtn, 'play button still visible since a link still exists');

    // 6. Leaving the library (via another tab) stops any playing video
    await secondBtn.click();
    await page.waitForSelector(`#lv-${secondId} iframe`, { timeout: 5000 });
    await page.click('#tabbar .tab[data-tab="home"]');
    assert(await active() === 'home', 'tapping the Today tab leaves the library');
    await page.click('#tabbar .tab[data-tab="library"]');
    assert((await page.locator(`#lv-${secondId} iframe`).count()) === 0, 'video did not persist/autoplay across a return visit to the library');

    // 7. Sanity: the workout-preview screen's existing video toggle still behaves as before (no regression)
    await page.click('#tabbar .tab[data-tab="home"]');
    assert(await active() === 'home', 'back on the Today tab');
    await page.click('#btn-generate');
    assert(await active() === 'preview', 'preview shown');
    const planPlayBtn = page.locator('.plan-play').first();
    if (await planPlayBtn.count() > 0) {
        await planPlayBtn.click();
        await page.waitForSelector('.plan-video iframe', { timeout: 5000 });
        console.log('preview-screen video toggle still works (no regression)');
    }

    if (errors.length) {
        console.log('CONSOLE/PAGE ERRORS:');
        errors.forEach((e) => console.log('  -', e));
        const fatal = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
        assert(fatal.length === 0, 'unexpected JS errors: ' + fatal.join(' | '));
    }

    console.log('ALL LIBRARY VIDEO CHECKS PASSED');
    await browser.close();
})().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});

async function assert2(cond, msg) {
    if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}
