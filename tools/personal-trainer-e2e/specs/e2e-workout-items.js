const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');

    // Generate a lot of workouts and inspect the raw item list the engine builds,
    // independent of level/duration randomness, to check structural invariants.
    const results = await page.evaluate(() => {
        // Force deterministic, broad coverage: run generateWorkout() many times
        // across all durations/levels so every exercise in the pool gets exercised.
        const durations = [15, 25, 40];
        const levels = ['beginner', 'intermediate', 'advanced'];
        const issues = [];
        let sampleWorkout = null;
        let totalRuns = 0;

        for (const level of levels) {
            state.level = level;
            state.prog.core = LEVEL_START[level];
            state.prog.pilates = LEVEL_START[level];
            for (const dur of durations) {
                state.duration = dur;
                for (let i = 0; i < 8; i++) {
                    const w = generateWorkout();
                    totalRuns++;
                    if (!sampleWorkout) sampleWorkout = w;

                    // Invariant 1: no work item should still be one of the "fixed" exercises
                    // with side !== null (they should no longer split into Left/Right).
                    const shouldNotBePerSide = ['co-deadbug', 'co-birddog', 'co-heeltap', 'co-bicycle',
                        'co-shouldertap', 'co-russtwist', 'co-plankupdown', 'co-wipers',
                        'pi-toetap', 'pi-singleleg', 'pi-crisscross', 'pi-saw', 'pi-scissors'];
                    w.items.forEach((it) => {
                        if (it.kind === 'work' && shouldNotBePerSide.includes(it.ex.id) && it.side !== null) {
                            issues.push(`${it.ex.id} still has a side (${it.side}) — should be a single set now`);
                        }
                        if (it.kind === 'work' && it.ex.perSide && it.side === null) {
                            issues.push(`${it.ex.id} is perSide but item has no side label`);
                        }
                    });

                    // Invariant 2: every work item except the very first should be preceded
                    // by a rest item (either the main-circuit rest or the new prep gap) —
                    // i.e. no two 'work' items are ever adjacent.
                    for (let k = 1; k < w.items.length; k++) {
                        if (w.items[k].kind === 'work' && w.items[k - 1].kind === 'work') {
                            issues.push(`adjacent work items with no gap: ${w.items[k - 1].ex.name} -> ${w.items[k].ex.name} (level=${level}, dur=${dur})`);
                        }
                    }

                    // Invariant 3: the very first item must be 'work' (no rest before the workout starts).
                    if (w.items[0].kind !== 'work') {
                        issues.push(`workout does not start with a work item (level=${level}, dur=${dur})`);
                    }
                }
            }
        }
        return { issues, totalRuns, sampleItems: sampleWorkout.items.slice(0, 12).map(it => it.kind === 'work' ? `WORK ${it.ex.name}${it.side ? ' ('+it.side+')' : ''} dose=${it.dose}` : `REST ${it.secs}s`) };
    });

    console.log('Total generateWorkout() runs:', results.totalRuns);
    console.log('Sample item sequence (first 12):');
    results.sampleItems.forEach((s) => console.log('  ', s));

    if (results.issues.length) {
        console.log('ISSUES FOUND:');
        [...new Set(results.issues)].slice(0, 30).forEach((i) => console.log('  -', i));
    }
    assert(results.issues.length === 0, `${results.issues.length} structural issues found`);

    console.log('ALL WORKOUT-ITEM STRUCTURAL CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
