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

    // The heatmap moved to the Progress tab in the nav restructure.
    const gotoProgress = async () => {
        await page.click('#tabbar .tab[data-tab="progress"]');
        await page.waitForTimeout(120);
    };
    await gotoProgress();
    assert(await active() === 'progress', 'reached progress tab, got ' + await active());

    // 1. Heatmap tile grid present, inside #streak-card, before #ach-card in DOM order
    const homeInfo = await page.evaluate(() => {
        const streakCard = document.getElementById('streak-card');
        const achCard = document.getElementById('ach-card');
        const hm = document.querySelector('#home-heatmap .hm');
        const cellCount = hm ? hm.children.length : 0;
        const streakBeforeAch = streakCard && achCard &&
            (streakCard.compareDocumentPosition(achCard) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        return { hasStreakCard: !!streakCard, hasHm: !!hm, cellCount, streakBeforeAch };
    });
    console.log('home heatmap info:', homeInfo);
    assert(homeInfo.hasStreakCard, '#streak-card exists on progress');
    assert(homeInfo.hasHm, '.hm tile grid rendered inside #home-heatmap');
    assert(homeInfo.cellCount === 84, 'heatmap has 12 weeks x 7 days = 84 cells, got ' + homeInfo.cellCount);
    assert(homeInfo.streakBeforeAch, 'streak-card appears before ach-card in DOM order');
    await page.screenshot({ path: `${SHOTS}/1-progress-with-heatmap.png` });

    // 2. History screen no longer contains the heatmap
    await page.click('#nav-history');
    await page.waitForTimeout(200);
    assert(await active() === 'history', 'navigated to history, got ' + await active());
    const historyHasHm = await page.evaluate(() => !!document.querySelector('#history-list .hm'));
    assert(!historyHasHm, 'history screen no longer contains the .hm tile grid');
    await page.screenshot({ path: `${SHOTS}/2-history-no-heatmap.png` });
    await page.click('#history [data-back]');
    await page.waitForTimeout(200);
    assert(await active() === 'progress', 'back to progress, got ' + await active());

    // 3. Do one workout and confirm the heatmap's "today" cell lights up
    await page.click('#tabbar .tab[data-tab="home"]');
    await page.waitForTimeout(120);
    await page.click('#btn-generate');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    for (let i = 0; i < 150 && (await active()) === 'player'; i++) {
        await page.click('#btn-skip').catch(() => {});
        await page.waitForTimeout(25);
    }
    await page.waitForTimeout(200);
    assert(await active() === 'complete', 'complete screen shown, got ' + await active());
    await page.click('[data-fb="right"]');
    await page.waitForTimeout(200);
    assert(await active() === 'home', 'back on home after feedback, got ' + await active());
    const todayLit = await page.evaluate(() => {
        const td = document.querySelector('#home-heatmap .hm .td');
        return td ? td.classList.contains('on') : null;
    });
    console.log('today cell lit after workout:', todayLit);
    assert(todayLit === true, 'today cell in the heatmap lights up after logging a workout');

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL HOME-HEATMAP CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
