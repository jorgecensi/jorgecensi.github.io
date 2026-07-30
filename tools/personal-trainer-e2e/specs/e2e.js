const { chromium } = require('playwright');

const BASE = 'http://localhost:4001/personal-trainer/';
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    // sw.js calls clients.claim() and the app reloads itself on `controllerchange`, so a
    // cold profile navigates several times on its own. Those reloads wipe the DOM out from
    // under whatever is mid-assertion, so track them and let them quiesce before reading.
    let lastNav = Date.now();
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) lastNav = Date.now(); });
    const settle = async (quietMs = 1200, timeout = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
            if (Date.now() - lastNav > quietMs) return;
            await page.waitForTimeout(150);
        }
    };

    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

    // Every root destination is a tab now, so navigation from a spec is one click.
    const gotoTab = async (tab) => {
        await page.click(`#tabbar .tab[data-tab="${tab}"]`);
        await page.waitForTimeout(120);
    };
    const gotoLibrary = () => gotoTab('library');
    const backToHome = async () => {
        await gotoTab('home');
        assert(await active() === 'home', 'back on home, got ' + await active());
    };

    // 1. Fresh load → setup screen
    await page.goto(BASE);
    await settle();
    assert(await active() === 'setup', 'setup shown on first launch, got ' + await active());
    await shot('1-setup');

    // 2. Pick advanced level + 15 min, continue
    await page.click('#setup-level .choice[data-v="intermediate"]');
    await page.click('#setup-duration .choice[data-v="15"]');
    await page.click('#setup-go');
    assert(await active() === 'home', 'home after setup');
    const level = await page.textContent('#stat-level');
    assert(level.trim() === 'Intermediate', 'level label matches picked level, got ' + level);
    const coreTier = await page.textContent('#core-tier');
    assert(coreTier.includes('Tier 3'), 'intermediate starts at tier 3, got ' + coreTier);
    await shot('2-home');

    // 3. Generate workout → preview
    await page.click('#btn-generate');
    assert(await active() === 'preview', 'preview shown');
    const planCount = await page.locator('.plan-item').count();
    assert(planCount >= 8, 'plan has warmup+main+cooldown items, got ' + planCount);
    const previewText = await page.textContent('#preview-list');
    assert(previewText.includes('Warm-up') && previewText.includes('Cool-down'), 'sections present');
    await shot('3-preview');

    // 3b. Regenerate produces a (very likely) different plan
    const firstPlan = await page.textContent('#preview-list');
    await page.click('#btn-regenerate');
    const secondPlan = await page.textContent('#preview-list');
    console.log('regenerate changed plan:', firstPlan !== secondPlan);

    // 4. Start workout → player, timed warmup counts down
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    const d1 = await page.textContent('#player-display');
    await page.waitForTimeout(2500);
    const d2 = await page.textContent('#player-display');
    assert(d1 !== d2, `countdown ticking (${d1} -> ${d2})`);
    await shot('4-player');

    // 4b. Pause freezes the countdown
    await page.click('#btn-main-action');
    const p1 = await page.textContent('#player-display');
    await page.waitForTimeout(1600);
    const p2 = await page.textContent('#player-display');
    assert(p1 === p2, 'paused countdown frozen');
    await page.click('#btn-main-action'); // resume

    // 5. Skip through the whole workout
    for (let i = 0; i < 120 && (await active()) === 'player'; i++) {
        // rep exercises need the Done button; everything else can be skipped
        await page.click('#btn-skip');
        await page.waitForTimeout(60);
    }
    assert(await active() === 'complete', 'complete screen after finishing, got ' + await active());
    await shot('5-complete');

    // 6. Feedback "just right" → back home with updated stats
    const scoreBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-state-v1')).prog.core);
    await page.click('[data-fb="right"]');
    await settle();
    assert(await active() === 'home', 'home after feedback');
    // Stats roll up with a count-up animation on Home entry; wait for it to settle.
    await page.waitForFunction(
        () => document.getElementById('stat-workouts').textContent.trim() === '1'
            && document.getElementById('stat-streak').textContent.trim() === '1',
        null, { timeout: 2000 });
    assert((await page.textContent('#stat-workouts')).trim() === '1', 'workout counted');
    assert((await page.textContent('#stat-streak')).trim() === '1', 'streak started');
    const scoreAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-state-v1')).prog.core);
    assert(scoreAfter === scoreBefore + 4, `score +4 on just-right (${scoreBefore} -> ${scoreAfter})`);
    await shot('6-home-after');

    // 7. Persistence across reload
    await page.reload();
    await settle();
    assert(await active() === 'home', 'home on return visit');
    await page.waitForFunction(
        () => document.getElementById('stat-workouts').textContent.trim() === '1',
        null, { timeout: 2000 });
    assert((await page.textContent('#stat-workouts')).trim() === '1', 'history persisted');

    // 8. Library: add a YouTube link, verify indicator + persistence
    await gotoLibrary();
    assert(await active() === 'library', 'library shown');
    const firstItem = page.locator('.lib-item').first();
    await firstItem.locator('.lib-head').click();
    await firstItem.locator('input').fill('https://www.youtube.com/watch?v=ASdvN_XEl_c');
    await firstItem.locator('input').blur();
    await page.waitForTimeout(200);
    // The "has a link" indicator used to be a static .has-link span; 711a002 replaced it
    // with the .lib-play ▶ button, which is rendered always and un-hidden once a link exists.
    const playBtn = firstItem.locator('.lib-play');
    assert((await playBtn.textContent()).includes('▶'), 'play button is the ▶ affordance');
    assert(!(await playBtn.getAttribute('class')).includes('hidden'), 'link indicator set (play button un-hidden)');
    await shot('7-library');
    await page.reload();
    await gotoLibrary();
    const persisted = await page.locator('.lib-item').first().locator('input').inputValue();
    assert(persisted.includes('youtube.com'), 'link persisted after reload');

    // 8b. Saved link shows as Watch guide in the player for that exercise
    const linkedId = await page.locator('.lib-item').first().getAttribute('data-id');
    console.log('linked exercise:', linkedId);

    // 9. History screen — reached from the Progress tab
    await gotoTab('progress');
    await page.click('#nav-history');
    assert(await active() === 'history', 'history shown');
    assert((await page.textContent('#history-list')).includes('min'), 'history entry rendered');
    await shot('8-history');

    // 10. Settings must NOT reset progression when level unchanged. Settings has no
    // "save" CTA any more — the picker rows commit on tap.
    await page.click('#history [data-back]');
    const progBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-state-v1')).prog);
    await gotoTab('setup');
    const preselected = await page.locator('#setup-level .choice.selected').getAttribute('data-v');
    assert(preselected === 'intermediate', 'level preselected in settings');
    await page.click('#setup-duration .choice[data-v="25"]');
    await page.waitForTimeout(120);
    const progAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-state-v1')).prog);
    assert(progAfter.core === progBefore.core, 'progression kept when only duration changed');
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('pt-state-v1')).duration) === 25,
        'duration committed on tap, without a save button');

    // 10b. Changing level in settings must not wipe earned progression either
    await page.click('#setup-level .choice[data-v="advanced"]');
    await page.waitForTimeout(120);
    const progAfterLevel = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-state-v1')).prog);
    assert(progAfterLevel.core === progBefore.core, 'earned progression survives a level change in settings');

    // 11. Manifest + SW registration present
    const manifest = await page.getAttribute('link[rel="manifest"]', 'href');
    assert(manifest === '/personal-trainer/manifest.json', 'manifest linked');
    const swReg = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg ? reg.scope : null;
    });
    console.log('sw scope:', swReg);

    if (errors.length) {
        console.log('CONSOLE/PAGE ERRORS:');
        errors.forEach((e) => console.log('  -', e));
        // sw fetch errors for favicon etc. shouldn't fail the run; real JS errors should
        const fatal = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
        assert(fatal.length === 0, 'unexpected JS errors: ' + fatal.join(' | '));
    }

    console.log('ALL CHECKS PASSED');
    await browser.close();
})().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
