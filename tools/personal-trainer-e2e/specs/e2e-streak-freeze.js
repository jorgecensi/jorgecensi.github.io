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

    // 1. Fresh account: no freezes earned yet, button disabled with the right hint text.
    const freshState = await page.evaluate(() => {
        renderHome();
        const btn = document.getElementById('btn-freeze');
        return { text: btn.textContent, disabled: btn.disabled, earned: freezesEarned(), available: freezesAvailable() };
    });
    console.log('fresh state:', freshState);
    assert(freshState.earned === 0, 'no freezes earned with 0 workouts logged');
    assert(freshState.available === 0, 'no freezes available with 0 workouts logged');
    assert(freshState.disabled, 'freeze button disabled with 0 freezes available');
    assert(freshState.text.includes('No freezes yet'), 'button explains how to earn one, got: ' + freshState.text);
    await page.screenshot({ path: `${SHOTS}/1-freeze-none-earned.png` });

    // 2. Seed 7 past workouts (not today) to earn exactly 1 freeze, confirm button activates.
    const afterSeed = await page.evaluate(() => {
        const now = Date.now();
        for (let i = 1; i <= 7; i++) {
            state.history.push({ ts: now - i * 86400000 * 3, mins: 20, count: 5, rounds: 1, fb: 'right', level: 'Intermediate' });
        }
        state.history.sort((a, b) => a.ts - b.ts);
        saveState();
        renderHome();
        const btn = document.getElementById('btn-freeze');
        return { text: btn.textContent, disabled: btn.disabled, earned: freezesEarned(), available: freezesAvailable(), hasWorkedOutToday: hasWorkedOutToday() };
    });
    console.log('after seeding 7 workouts:', afterSeed);
    assert(afterSeed.earned === 1, '1 freeze earned after 7 logged workouts, got ' + afterSeed.earned);
    assert(afterSeed.available === 1, '1 freeze available, got ' + afterSeed.available);
    assert(!afterSeed.hasWorkedOutToday, 'none of the seeded workouts are today');
    assert(!afterSeed.disabled, 'freeze button enabled once a freeze is available');
    assert(afterSeed.text.includes('1 left'), 'button shows the correct remaining count, got: ' + afterSeed.text);
    await page.screenshot({ path: `${SHOTS}/2-freeze-available.png` });

    // 3. Click the freeze button: consumes the freeze, records today, button reflects it.
    await page.click('#btn-freeze');
    await page.waitForTimeout(150);
    const afterFreeze = await page.evaluate(() => {
        const btn = document.getElementById('btn-freeze');
        return {
            text: btn.textContent,
            disabled: btn.disabled,
            available: freezesAvailable(),
            isFrozenToday: isFrozenToday(),
            frozenDatesLen: (state.frozenDates || []).length,
        };
    });
    console.log('after clicking freeze:', afterFreeze);
    assert(afterFreeze.frozenDatesLen === 1, 'today recorded in state.frozenDates');
    assert(afterFreeze.isFrozenToday, 'isFrozenToday() true after freezing');
    assert(afterFreeze.available === 0, 'freeze consumed, 0 left');
    assert(afterFreeze.disabled, 'button disabled after freezing (no more freezes)');
    assert(afterFreeze.text.includes('frozen for today'), 'button confirms the freeze, got: ' + afterFreeze.text);
    await page.screenshot({ path: `${SHOTS}/3-freeze-used-today.png` });

    // 4. Clicking again does nothing (already frozen / no freezes left) — idempotent, no throw.
    await page.click('#btn-freeze', { force: true }).catch(() => {});
    const stillOne = await page.evaluate(() => (state.frozenDates || []).length);
    assert(stillOne === 1, 'clicking a disabled/already-frozen button does not double-record, got ' + stillOne);

    // 5. Core behavior: a streak survives a gap that spans the frozen day, but would NOT
    //    survive the same gap without a freeze recorded for the missed day. Uses fixed,
    //    now-independent timestamps so the >48h fast path can't accidentally paper over
    //    what we're actually testing (freeze bridging, not the existing grace period).
    const bridging = await page.evaluate(() => {
        // Mon Jan 5 2026, 08:00 -> Wed Jan 7 2026, 19:00 = 59h gap (unambiguously > 48h).
        // Only Tue Jan 6 (day-start) sits strictly between them.
        const monday = new Date(2026, 0, 5, 8, 0, 0).getTime();
        const tuesday = new Date(2026, 0, 6, 0, 0, 0).getTime();
        const wednesday = new Date(2026, 0, 7, 19, 0, 0).getTime();

        state.frozenDates = [];
        const notBridgedFirst = streakContinues(monday, wednesday) === false;
        state.frozenDates = [tuesday];
        const bridged = streakContinues(monday, wednesday);
        state.frozenDates = [];
        const notBridgedAgain = streakContinues(monday, wednesday) === false;
        return { notBridgedFirst, bridged, notBridgedAgain };
    });
    console.log('gap bridging check:', bridging);
    assert(bridging.notBridgedFirst, 'a 59h gap is NOT bridged without a freeze recorded for the missed day');
    assert(bridging.bridged, 'the same 59h gap IS bridged once the missed day is frozen');
    assert(bridging.notBridgedAgain, 'removing the freeze breaks the bridge again (gap unresolved)');

    // 6. Un-bridged gap: 2 missed days, only 1 frozen -> still breaks.
    const partialBridge = await page.evaluate(() => {
        // Mon Jan 5 2026, 08:00 -> Thu Jan 8 2026, 19:00. Tue 6th and Wed 7th are both
        // strictly between them; only Tuesday is frozen, so the gap should NOT bridge.
        const monday = new Date(2026, 0, 5, 8, 0, 0).getTime();
        const tuesday = new Date(2026, 0, 6, 0, 0, 0).getTime();
        const thursday = new Date(2026, 0, 8, 19, 0, 0).getTime();
        state.frozenDates = [tuesday];
        const result = streakContinues(monday, thursday);
        state.frozenDates = [];
        return result;
    });
    assert(partialBridge === false, 'a 2-missed-day gap with only 1 day frozen still breaks the streak');

    // 7. Heatmap renders a distinct "frozen" tile for a frozen day with no workout
    const heatmapCheck = await page.evaluate(() => {
        const d = new Date(); d.setDate(d.getDate() - 5); d.setHours(0, 0, 0, 0);
        state.frozenDates = [...(state.frozenDates || []), d.getTime()];
        const html = heatmapHtml();
        return html.includes('frozen');
    });
    assert(heatmapCheck, 'heatmapHtml() includes a frozen-day tile when state.frozenDates has an entry');

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL STREAK-FREEZE CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
