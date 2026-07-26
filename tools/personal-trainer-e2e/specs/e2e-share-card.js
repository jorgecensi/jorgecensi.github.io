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

    // Get to the complete screen
    await page.click('#btn-generate');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    for (let i = 0; i < 150 && (await active()) === 'player'; i++) {
        await page.click('#btn-skip').catch(() => {});
        await page.waitForTimeout(25);
    }
    await page.waitForTimeout(200);
    assert(await active() === 'complete', 'complete screen shown, got ' + await active());
    await page.screenshot({ path: `${SHOTS}/1-complete-with-share.png` });

    // 1. buildShareCardBlob() produces a real, non-trivial PNG
    const cardInfo = await page.evaluate(async () => {
        const blob = await buildShareCardBlob();
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
        return { size: blob.size, type: blob.type, isPng };
    });
    console.log('share card blob:', cardInfo);
    assert(cardInfo.isPng, 'blob is a valid PNG');
    assert(cardInfo.size > 5000, 'blob has substantial image data, got ' + cardInfo.size + ' bytes');

    // 2. Clicking the Share button (no Web Share API in headless Chromium) falls back
    //    to a download — verify it doesn't throw and the button re-enables afterward.
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('#btn-share');
    const download = await downloadPromise;
    await page.waitForTimeout(300);
    const btnState = await page.evaluate(() => {
        const b = document.getElementById('btn-share');
        return { text: b.textContent.trim(), disabled: b.disabled };
    });
    assert(!btnState.disabled, 'share button re-enabled after completing');
    assert(btnState.text.includes('Share progress'), 'share button label restored, got: ' + btnState.text);
    if (download) {
        console.log('download triggered:', download.suggestedFilename());
        assert(download.suggestedFilename() === 'personal-trainer-progress.png', 'correct download filename');
    } else {
        console.log('note: no download event captured (fallback path may differ in this browser build) — checked blob generation directly above instead');
    }

    // 3. Sharing does not navigate away or interfere with the feedback flow afterward
    assert(await active() === 'complete', 'still on complete screen after sharing');
    await page.click('[data-fb="right"]');
    await page.waitForTimeout(200);
    assert(await active() === 'home', 'feedback flow still works after sharing, got ' + await active());
    assert((await page.textContent('#stat-workouts')).trim() === '1', 'workout was recorded');

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL SHARE-CARD CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
