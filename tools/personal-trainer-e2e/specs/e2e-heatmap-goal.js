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

    // Seed history: weeklyGoal=3, workouts on Mon/Tue/Wed of a fully-PAST week (3 weeks back,
    // so all three days are guaranteed to be before "today" regardless of what weekday it is).
    // Expect: Mon='on', Tue='on', Wed='goal' (the day the 3rd workout crosses the goal).
    const seedResult = await page.evaluate(() => {
        state.weeklyGoal = 3;
        const now = new Date();
        now.setHours(12, 0, 0, 0);
        const monday = new Date(now);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 21);
        const days = [0, 1, 2]; // Mon, Tue, Wed offsets
        days.forEach((offset) => {
            const d = new Date(monday);
            d.setDate(d.getDate() + offset);
            state.history.push({ ts: d.getTime(), count: 5, mins: 20, level: 'Intermediate', fb: 'right', rounds: 1 });
        });
        saveState();
        renderHome();
        return { historyLen: state.history.length, mondayTs: monday.setHours(0, 0, 0, 0) };
    });
    console.log('seed result:', seedResult);

    await page.waitForTimeout(100);
    await page.screenshot({ path: `${SHOTS}/1-heatmap-goal-tiles.png` });

    const tileClasses = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('#home-heatmap .hm > div'));
        // The grid is column-major: 7 rows per week, 12 weeks. Last week's Mon/Tue/Wed are
        // the last 7 cells' first 3 entries (index depends on how many weeks are visible).
        // Find cells with 'on' or 'goal' class and report their relative order.
        return cells.map((c, i) => ({ i, cls: c.className })).filter((c) => c.cls.includes('on') || c.cls.includes('goal'));
    });
    console.log('lit tiles:', tileClasses);

    assert(tileClasses.length === 3, 'exactly 3 lit tiles (Mon, Tue, Wed), got ' + tileClasses.length);
    const goalTiles = tileClasses.filter((c) => c.cls.includes('goal'));
    const onTiles = tileClasses.filter((c) => c.cls.includes('on') && !c.cls.includes('goal'));
    assert(goalTiles.length === 1, 'exactly one tile marked as goal-reached, got ' + goalTiles.length);
    assert(onTiles.length === 2, 'exactly two tiles marked as plain on (not goal), got ' + onTiles.length);
    // The goal tile should be the last (chronologically latest) of the three lit tiles —
    // cells are laid out column-major (grid-auto-flow: column) so index order == date order
    // within a week block.
    const maxIdx = Math.max(...tileClasses.map((c) => c.i));
    const goalIdx = goalTiles[0].i;
    assert(goalIdx === maxIdx, 'the goal tile is the chronologically last (3rd) lit day, goalIdx=' + goalIdx + ' maxIdx=' + maxIdx);

    // Sanity: history screen no longer shows any heatmap at all (already verified in prior suite,
    // re-check quickly here since we just seeded fresh data). #nav-history lives on Progress.
    await page.click('#tabbar .tab[data-tab="progress"]');
    await page.waitForTimeout(120);
    await page.click('#nav-history');
    await page.waitForTimeout(200);
    const historyHasHm = await page.evaluate(() => !!document.querySelector('#history-list .hm'));
    assert(!historyHasHm, 'history screen still has no .hm tile grid after seeding');

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL HEATMAP-GOAL-TILE CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
