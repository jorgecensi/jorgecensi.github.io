const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

// The muscle-balance system: recency-weighted per-region training volume that
// (a) accrues from finished workouts, (b) decays over time, (c) biases the
// generator toward lagging regions, and (d) shows up on the Progress tab.
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
    assert(await active() === 'home', 'reached home, got ' + await active());

    // 1. Fresh state ships the four regions, zeroed.
    const initial = await page.evaluate(() => state.muscleLoad);
    assert(initial && ['abs', 'obliques', 'back', 'glutes'].every((g) => initial[g] === 0),
        'muscleLoad starts at zero for all four regions, got ' + JSON.stringify(initial));

    // 2. Crediting a session's work accrues load — to the primary region and, via
    //    synergist shares, its secondary. Warm-ups/stretches don't count.
    const credited = await page.evaluate(() => {
        creditMuscleLoad([
            { kind: 'work', secs: 40, ex: { disc: 'core', focus: 'abs' } },
            { kind: 'work', secs: 30, ex: { disc: 'pilates', focus: 'glutes' } },
            { kind: 'work', secs: 30, ex: { disc: 'warmup', focus: 'full' } }, // ignored
            { kind: 'rest', secs: 15 },                                        // ignored
        ]);
        return state.muscleLoad;
    });
    // abs set: abs += 40*1.0, back += 40*0.15 = 6. glutes set: glutes += 30, back += 30*0.25 = 7.5.
    // The warm-up 'full' set and the rest are excluded, so abs is exactly 40 (not 40 + a full share).
    assert(Math.abs(credited.abs - 40) < 0.001, 'abs load is exactly the abs set, warm-up excluded, got ' + credited.abs);
    assert(Math.abs(credited.glutes - 30) < 0.001, 'glutes load is exactly the glutes set, got ' + credited.glutes);
    assert(Math.abs(credited.back - 13.5) < 0.001, 'posterior synergist (back) picked up 6+7.5 from the two sets, got ' + credited.back);

    // 3. Decay: two half-lives (~24 days) roughly quarters the stored load.
    const decayed = await page.evaluate(() => {
        state.muscleLoad = { abs: 100, obliques: 0, back: 0, glutes: 0 };
        state.muscleLoadTs = Date.now() - 24 * 86400000; // 2 x 12-day half-life
        return muscleBalance().load.abs;
    });
    assert(decayed > 20 && decayed < 30, 'abs load ~quarters after two half-lives, got ' + decayed);

    // 4. The bias flips selection: a region that's flooded gets picked less than the
    //    same region when it's starved. Compare glute picks across many generations
    //    under both states — robust to the random twist.
    const bias = await page.evaluate(() => {
        state.prog.core = 40; state.prog.pilates = 40; // mid tiers → full focus variety in pool
        const countGlutes = (setup) => {
            setup();
            let g = 0, runs = 40;
            for (let i = 0; i < runs; i++) {
                state.lastExerciseIds = [];
                state.lastTwist = null;
                const w = generateWorkout();
                g += w.main.filter((e) => e.focus === 'glutes').length;
            }
            return g;
        };
        const now = Date.now();
        const flooded = countGlutes(() => {
            state.muscleLoad = { abs: 50, obliques: 50, back: 50, glutes: 600 };
            state.muscleLoadTs = now;
        });
        const starved = countGlutes(() => {
            state.muscleLoad = { abs: 600, obliques: 600, back: 600, glutes: 20 };
            state.muscleLoadTs = now;
        });
        return { flooded, starved };
    });
    console.log('glute picks — flooded vs starved:', JSON.stringify(bias));
    assert(bias.starved > bias.flooded,
        `starving glutes yields more glute picks than flooding them (starved ${bias.starved} > flooded ${bias.flooded})`);

    // 5. Progress tab renders the balance card: four bars + an evenness score once
    //    there's data, an explanatory empty state before.
    await page.evaluate(() => { state.muscleLoad = { abs: 0, obliques: 0, back: 0, glutes: 0 }; state.muscleLoadTs = 0; saveState(); });
    await page.click('#tabbar .tab[data-tab="progress"]');
    await page.waitForTimeout(150);
    const empty = await page.evaluate(() => ({
        hasCard: !!document.getElementById('balance-card'),
        bars: document.querySelectorAll('#balance-bars .bal-row').length,
        note: document.getElementById('balance-note').textContent,
        score: document.getElementById('balance-score').textContent,
    }));
    assert(empty.hasCard, 'balance card present on Progress');
    assert(empty.bars === 0, 'no bars before any training, got ' + empty.bars);
    assert(/muscle balance/i.test(empty.note), 'empty state explains itself, got: ' + empty.note);
    assert(empty.score === '', 'no score before any training, got ' + empty.score);

    const filled = await page.evaluate(() => {
        state.muscleLoad = { abs: 400, obliques: 200, back: 120, glutes: 80 };
        state.muscleLoadTs = Date.now();
        renderBalance();
        return {
            bars: document.querySelectorAll('#balance-bars .bal-row').length,
            low: document.querySelectorAll('#balance-bars .bal-fill.low').length,
            score: document.getElementById('balance-score').textContent,
            note: document.getElementById('balance-note').textContent,
        };
    });
    assert(filled.bars === 4, 'four region bars once trained, got ' + filled.bars);
    assert(/%\s*even/.test(filled.score), 'evenness score shown, got ' + filled.score);
    assert(filled.low >= 1, 'the neglected regions (glutes/back) flag as lagging, got ' + filled.low);
    assert(/lagging/i.test(filled.note), 'coaching line names the lag, got: ' + filled.note);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/muscle-balance.png` });

    // 6. Finishing a real workout moves the balance (end-to-end through the UI).
    await page.evaluate(() => { state.muscleLoad = { abs: 0, obliques: 0, back: 0, glutes: 0 }; state.muscleLoadTs = 0; saveState(); });
    await page.click('#tabbar .tab[data-tab="home"]');
    await page.click('#btn-generate');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    for (let i = 0; i < 200 && (await active()) === 'player'; i++) {
        await page.click('#btn-skip').catch(() => {});
        await page.waitForTimeout(20);
    }
    assert(await active() === 'complete', 'reached complete, got ' + await active());
    await page.click('[data-fb="right"]');
    await page.waitForTimeout(200);
    const afterWorkout = await page.evaluate(() => {
        const l = state.muscleLoad;
        return { total: ['abs', 'obliques', 'back', 'glutes'].reduce((t, g) => t + l[g], 0), ts: state.muscleLoadTs };
    });
    assert(afterWorkout.total > 0, 'a finished workout records muscle load, got ' + afterWorkout.total);
    assert(afterWorkout.ts > 0, 'muscleLoadTs stamped on completion');

    if (errors.length) {
        const fatal = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
        assert(fatal.length === 0, 'unexpected JS errors: ' + fatal.join(' | '));
    }

    console.log('ALL MUSCLE-BALANCE CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
