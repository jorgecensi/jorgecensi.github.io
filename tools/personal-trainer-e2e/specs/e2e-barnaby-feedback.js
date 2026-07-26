const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }
    if (errors.length) assert(false, 'no page errors on load: ' + errors.join(' | '));

    // 1. Feedback button images point to the new Barnaby assets and load successfully
    // (naturalWidth > 0 means the browser actually decoded the image, not a broken link).
    await page.click('#btn-generate');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    for (let i = 0; i < 150 && (await active()) === 'player'; i++) {
        await page.click('#btn-skip').catch(() => {});
        await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);
    assert(await active() === 'complete', 'reached complete screen, got ' + await active());

    const imgInfo = await page.evaluate(() => {
        return ['easy', 'right', 'hard'].map((fb) => {
            const img = document.querySelector(`[data-fb="${fb}"] .fb-ico`);
            return { fb, src: img.getAttribute('src'), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
        });
    });
    console.log('feedback icons:', imgInfo);
    imgInfo.forEach((i) => {
        assert(i.src === `/img/pt/barnaby-${i.fb}.png`, `${i.fb} icon points at the barnaby asset, got ${i.src}`);
        assert(i.naturalWidth > 0 && i.naturalHeight > 0, `${i.fb} icon actually loaded (not broken), got ${i.naturalWidth}x${i.naturalHeight}`);
    });
    await page.screenshot({ path: `${SHOTS}/barnaby-feedback-row.png` });

    // 2. Icons render undistorted (aspect ratio preserved) within the max-width/max-height box
    const renderedInfo = await page.evaluate(() => {
        return ['easy', 'right', 'hard'].map((fb) => {
            const img = document.querySelector(`[data-fb="${fb}"] .fb-ico`);
            const rect = img.getBoundingClientRect();
            const naturalRatio = img.naturalWidth / img.naturalHeight;
            const renderedRatio = rect.width / rect.height;
            return { fb, naturalRatio, renderedRatio, w: rect.width, h: rect.height };
        });
    });
    console.log('rendered aspect ratios:', renderedInfo);
    renderedInfo.forEach((i) => {
        assert(Math.abs(i.naturalRatio - i.renderedRatio) < 0.02, `${i.fb} icon aspect ratio preserved (undistorted), natural=${i.naturalRatio.toFixed(3)} rendered=${i.renderedRatio.toFixed(3)}`);
        assert(i.w <= 64.5 && i.h <= 56.5, `${i.fb} icon fits within the 64x56 box, got ${i.w}x${i.h}`);
    });

    // 3. Clicking a feedback button still submits correctly and returns home (existing behavior)
    await page.click('[data-fb="right"]');
    await page.waitForTimeout(200);
    assert(await active() === 'home', 'feedback submission still navigates home, got ' + await active());
    assert((await page.textContent('#stat-workouts')).trim() === '1', 'workout was recorded');

    // 4. The "How Progression Works" info screen's small reference icons are UNCHANGED
    //    (still the original flat feedback-*.png icons, not swapped to Barnaby) — this was
    //    a deliberate scope boundary, checked directly against the static markup.
    const infoIcons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#info .info-ico')).map((img) => img.getAttribute('src'));
    });
    console.log('info-screen reference icons (should stay as feedback-*.png):', infoIcons);
    assert(infoIcons.some((s) => s === '/img/pt/feedback-easy.png'), 'info screen still references the original feedback-easy icon');
    assert(infoIcons.some((s) => s === '/img/pt/feedback-right.png'), 'info screen still references the original feedback-right icon');
    assert(infoIcons.some((s) => s === '/img/pt/feedback-hard.png'), 'info screen still references the original feedback-hard icon');

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL BARNABY-FEEDBACK CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
