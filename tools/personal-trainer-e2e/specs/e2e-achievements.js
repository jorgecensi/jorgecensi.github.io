const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }
    assert(await active() === 'home', 'home reached');
    await page.screenshot({ path: `${SHOTS}/1-home.png` });

    // The achievements and records cards live on the Progress tab.
    const gotoProgress = async () => {
        await page.click('#tabbar .tab[data-tab="progress"]');
        await page.waitForTimeout(120);
        assert(await active() === 'progress', 'progress tab shown, got ' + await active());
    };
    await gotoProgress();

    // 1. Clicking the achievements CARD body (not the "All" span) navigates
    await page.click('#ach-card');
    await page.waitForTimeout(150);
    assert(await active() === 'achievements', 'clicking anywhere on ach-card navigates to achievements, got ' + await active());
    await page.screenshot({ path: `${SHOTS}/2-achievements-full.png` });

    // 2. Every achievement row now has a progress bar and fraction
    const rowCount = await page.locator('#ach-grid .ach').count();
    const barCount = await page.locator('#ach-grid .ach .mini-bar').count();
    const fracCount = await page.locator('#ach-grid .ach .ach-frac').count();
    assert(rowCount > 0 && barCount === rowCount && fracCount === rowCount,
        `every achievement row has a bar+fraction (${rowCount} rows, ${barCount} bars, ${fracCount} fracs)`);
    const firstFrac = await page.locator('#ach-grid .ach .ach-frac').first().textContent();
    console.log('first achievement fraction text:', firstFrac);
    assert(/^\d+\/\d+$/.test(firstFrac.trim()), 'fraction format looks like N/M, got ' + firstFrac);

    // 3. Back to progress, click the records card
    await page.click('#achievements [data-back]');
    assert(await active() === 'progress', 'back to progress');
    await page.click('#rec-card');
    await page.waitForTimeout(150);
    assert(await active() === 'records', 'clicking anywhere on rec-card navigates to records, got ' + await active());
    await page.screenshot({ path: `${SHOTS}/3-records.png` });

    // 4. Keyboard accessibility: focus + Enter on ach-card
    await page.click('#records [data-back]');
    assert(await active() === 'progress', 'back on progress again');
    await page.evaluate(() => document.getElementById('ach-card').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert(await active() === 'achievements', 'Enter key on focused ach-card navigates, got ' + await active());

    // 5. cursor:pointer affordance present
    const cursor = await page.evaluate(() => getComputedStyle(document.getElementById('ach-card')).cursor);
    assert(cursor === 'pointer', 'clickable card shows pointer cursor, got ' + cursor);

    console.log('ALL ACHIEVEMENTS/RECORDS CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
