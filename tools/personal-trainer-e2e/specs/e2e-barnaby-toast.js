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

    // 1. Toast includes the mascot image, loads successfully, and is fully contained
    //    within the toast's box (no overflow past the rounded pill).
    await page.evaluate(() => { showAchievementToasts([{ emoji: '🔥', name: 'On a roll' }]); });
    await page.waitForTimeout(400);

    const info = await page.evaluate(() => {
        const toast = document.querySelector('.toast');
        const img = document.querySelector('.toast-mascot');
        const tr = toast.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        return {
            toast: tr, img: ir,
            imgSrc: img.getAttribute('src'),
            imgLoaded: img.naturalWidth > 0 && img.naturalHeight > 0,
            visible: toast.classList.contains('show'),
        };
    });
    console.log('toast/img rects:', info);
    assert(info.imgSrc === '/img/pt/barnaby-victory.png', 'toast mascot points at barnaby-victory.png, got ' + info.imgSrc);
    assert(info.imgLoaded, 'mascot image actually loaded (not a broken link)');
    assert(info.visible, 'toast has the .show class after triggering');
    assert(info.img.top >= info.toast.top && info.img.bottom <= info.toast.bottom,
        `mascot image is vertically contained within the toast (img ${info.img.top}-${info.img.bottom}, toast ${info.toast.top}-${info.toast.bottom})`);
    assert(info.img.left >= info.toast.left && info.img.right <= info.toast.right,
        'mascot image is horizontally contained within the toast');
    await page.screenshot({ path: `${SHOTS}/barnaby-toast.png` });

    // 2. Multiple simultaneous unlocks still queue correctly (one toast at a time, in order)
    await page.waitForTimeout(2600); // let the first toast fully dismiss
    const queueResult = await page.evaluate(async () => {
        showAchievementToasts([{ emoji: '🥇', name: 'First' }, { emoji: '🥈', name: 'Second' }]);
        await new Promise((r) => setTimeout(r, 300));
        const firstText = document.querySelector('.toast div')?.textContent || '';
        return { firstText, toastCount: document.querySelectorAll('.toast').length };
    });
    console.log('queue check:', queueResult);
    assert(queueResult.toastCount === 1, 'only one toast shown at a time even with 2 unlocks queued, got ' + queueResult.toastCount);
    assert(queueResult.firstText.includes('First'), 'first queued achievement shown first, got: ' + queueResult.firstText);

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL BARNABY-TOAST CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
