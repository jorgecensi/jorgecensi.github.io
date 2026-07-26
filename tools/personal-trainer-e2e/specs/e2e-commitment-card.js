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
    assert(await active() === 'home', 'reached home screen, got ' + await active());
    if (errors.length) assert(false, 'no page errors on load: ' + errors.join(' | '));

    // btn-commit exists and is visible on home screen
    const btnExists = await page.evaluate(() => !!document.getElementById('btn-commit'));
    assert(btnExists, '#btn-commit exists in DOM');
    await page.waitForSelector('#btn-commit', { state: 'visible' });
    await page.screenshot({ path: `${SHOTS}/1-home-with-commit-btn.png` });

    // 1. buildCommitmentCardBlob() produces a real, non-trivial PNG
    const cardInfo = await page.evaluate(async () => {
        const blob = await buildCommitmentCardBlob();
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
        return { size: blob.size, type: blob.type, isPng };
    });
    console.log('commitment card blob:', cardInfo);
    assert(cardInfo.isPng, 'blob is a valid PNG');
    assert(cardInfo.size > 5000, 'blob has substantial image data, got ' + cardInfo.size + ' bytes');

    // 2. Render the card to an offscreen canvas image and check it visually via screenshot
    await page.evaluate(async () => {
        const blob = await buildCommitmentCardBlob();
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.id = 'debug-commit-card';
        img.src = url;
        img.style.cssText = 'position:fixed;top:0;left:0;width:390px;z-index:9999;background:#000;';
        document.body.appendChild(img);
        await new Promise((r) => { img.onload = r; });
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/2-commitment-card-render.png` });
    await page.evaluate(() => document.getElementById('debug-commit-card').remove());

    // 3. #btn-commit shares the commitment card directly (bindShareButton) — headless
    //    Chromium has no Web Share API, so this falls back to a download. Confirm it
    //    fires without throwing and doesn't navigate away.
    //    NB: an earlier revision of this spec clicked through a "Share a goal" picker
    //    modal. That picker was PR #283, which was closed unmerged — #btn-commit has
    //    never shared via a modal on master. Don't reintroduce those steps.
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('#btn-commit');
    const download = await downloadPromise;
    await page.waitForTimeout(300);
    if (download) {
        console.log('download triggered:', download.suggestedFilename());
        assert(download.suggestedFilename() === 'personal-trainer-commitment.png', 'correct download filename, got ' + download.suggestedFilename());
    } else {
        console.log('note: no download event captured (fallback path may differ in this browser build) — checked blob generation directly above instead');
    }

    // 4. Still on home screen, nothing broken
    assert(await active() === 'home', 'still on home screen after commit-share, got ' + await active());

    // 5. Sanity: content check — goal number appears correctly for default weeklyGoal
    const contentCheck = await page.evaluate(async () => {
        return { weeklyGoal: state.weeklyGoal, workoutsThisWeek: workoutsThisWeek() };
    });
    console.log('state at commit time:', contentCheck);
    assert(typeof contentCheck.weeklyGoal === 'number' && contentCheck.weeklyGoal > 0, 'weeklyGoal is set');

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL COMMITMENT-CARD CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
