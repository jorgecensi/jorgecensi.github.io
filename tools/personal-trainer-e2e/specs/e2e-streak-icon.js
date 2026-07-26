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

    // 1. streak=0 renders the dim/desaturated "ember" look, plain default ring, no pulse/shine.
    const zeroState = await page.evaluate(() => {
        state.streak = 0;
        renderHome();
        const ico = document.getElementById('stat-streak-ico');
        const badge = document.getElementById('stat-streak-badge');
        return {
            filter: ico.style.filter,
            hasPulse: badge.classList.contains('streak-pulse'),
            hasShine: badge.classList.contains('streak-shine'),
            borderColor: badge.style.borderColor,
        };
    });
    assert(zeroState.filter.includes('grayscale'), 'streak=0 uses the desaturated ember filter, got: ' + zeroState.filter);
    assert(!zeroState.hasPulse, 'streak=0 has no pulse animation');
    assert(!zeroState.hasShine, 'streak=0 has no sparkle');
    assert(zeroState.borderColor === '', 'streak=0 ring uses the default CSS border (no inline override), got: ' + zeroState.borderColor);

    // 2. streakGlowProgress(streak) shape unchanged: constant through day 10, then decelerates.
    const curve = await page.evaluate(() => {
        const pts = {};
        for (let s = 0; s <= 60; s++) pts[s] = streakGlowProgress(s);
        return pts;
    });
    const earlySteps = [];
    for (let s = 1; s <= 10; s++) earlySteps.push(+(curve[s] - curve[s - 1]).toFixed(6));
    const allEqual = earlySteps.every((v) => Math.abs(v - earlySteps[0]) < 1e-9);
    assert(allEqual, 'day-over-day progress delta is constant for streak 1..10, got: ' + JSON.stringify(earlySteps));
    const laterDeltas = [];
    for (let s = 11; s <= 40; s++) laterDeltas.push(curve[s] - curve[s - 1]);
    for (let i = 1; i < laterDeltas.length; i++) {
        assert(laterDeltas[i] < laterDeltas[i - 1] + 1e-9, 'progress delta should shrink after day 10');
    }
    assert(laterDeltas[0] < earlySteps[0], 'first post-day-10 delta is smaller than the constant early step');
    console.log('curve shape confirmed: constant 0-10, then decelerating');

    // 3. Ring border/glow gets visibly stronger with streak (alpha channel + blur radius climb)
    const ringAt = await page.evaluate(() => {
        const extract = (s) => {
            state.streak = s;
            renderHome();
            const badge = document.getElementById('stat-streak-badge');
            return { border: badge.style.borderColor, shadow: badge.style.boxShadow || getComputedStyle(badge).getPropertyValue('--ring-glow-a') };
        };
        return { s1: extract(1), s2: extract(2), s5: extract(5), s10: extract(10), s30: extract(30) };
    });
    console.log('ring style by streak:', ringAt);
    const alphaOf = (hsla) => parseFloat(hsla.match(/,\s*([\d.]+)\)$/)[1]);
    assert(alphaOf(ringAt.s1.border) < alphaOf(ringAt.s2.border), 'border alpha grows from streak 1 to 2');
    assert(alphaOf(ringAt.s2.border) < alphaOf(ringAt.s5.border), 'border alpha grows from streak 2 to 5');
    assert(alphaOf(ringAt.s5.border) < alphaOf(ringAt.s10.border), 'border alpha grows from streak 5 to 10');
    const blurOf = (shadow) => {
        // box-shadow's two 0px offsets plus the blur radius all show up as "Npx" —
        // order differs depending on whether this was read back from a parsed inline
        // style (browser reorders to color-first) or a raw custom-property string
        // (kept as-authored), so take the one non-zero px value: the blur radius.
        const pxValues = (shadow.match(/(\d+)px/g) || []).map((v) => parseInt(v, 10));
        const blurVal = pxValues.find((v) => v !== 0);
        return blurVal === undefined ? 0 : blurVal;
    };
    assert(blurOf(ringAt.s1.shadow) < blurOf(ringAt.s10.shadow), 'glow blur grows from streak 1 to 10');
    assert(blurOf(ringAt.s10.shadow) < blurOf(ringAt.s30.shadow), 'glow blur grows from streak 10 to 30');

    // 4. Pulse activates at streak >= 20, sparkle (streak-shine) at streak >= 60
    const thresholds = await page.evaluate(() => {
        const results = {};
        [1, 19, 20, 21, 59, 60, 61].forEach((s) => {
            state.streak = s;
            renderHome();
            const badge = document.getElementById('stat-streak-badge');
            results[s] = { pulse: badge.classList.contains('streak-pulse'), shine: badge.classList.contains('streak-shine') };
        });
        return results;
    });
    console.log('thresholds:', thresholds);
    assert(thresholds[19].pulse === false && thresholds[20].pulse === true, 'pulse turns on exactly at streak 20');
    assert(thresholds[59].shine === false && thresholds[60].shine === true, 'sparkle turns on exactly at streak 60');
    assert(thresholds[61].pulse === true && thresholds[61].shine === true, 'both active together at streak 61');

    // 5. Badge element sits where the old icon did (still inside .stat.accent-orange), and
    //    the flame image element itself is unchanged/still present
    const structure = await page.evaluate(() => {
        const stat = document.querySelector('.stat.accent-orange');
        return {
            hasBadge: !!stat.querySelector('#stat-streak-badge'),
            hasIcoInsideBadge: !!document.querySelector('#stat-streak-badge #stat-streak-ico'),
        };
    });
    assert(structure.hasBadge, 'streak badge lives inside the accent-orange stat card');
    assert(structure.hasIcoInsideBadge, 'flame icon lives inside the badge');

    // Screenshots for visual review across the curve
    const shotStreaks = [0, 1, 2, 5, 10, 20, 30, 60, 100];
    for (const s of shotStreaks) {
        await page.evaluate((v) => { state.streak = v; renderHome(); }, s);
        await page.waitForTimeout(400);
        const el = await page.$('.stat.accent-orange');
        await el.screenshot({ path: `${SHOTS}/streak-badge-${String(s).padStart(3, '0')}.png` });
    }

    // stat value text stays in sync
    const valueText = await page.evaluate(() => { state.streak = 7; renderHome(); return document.getElementById('stat-streak').textContent; });
    assert(valueText === '7', 'stat-streak value text in sync, got ' + valueText);

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL STREAK-ICON CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
