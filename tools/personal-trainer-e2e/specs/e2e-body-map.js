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
    assert(await active() === 'home', 'reached home, got ' + await active());

    // 1. The body-muscles library loaded from the same origin (no CDN).
    const libCheck = await page.evaluate(() => ({
        defined: typeof BodyMuscles !== 'undefined',
        scriptSrc: Array.from(document.querySelectorAll('script[src]'))
            .map((s) => s.getAttribute('src'))
            .find((s) => s.includes('body-muscles')),
    }));
    assert(libCheck.defined, 'BodyMuscles global is defined');
    assert(libCheck.scriptSrc && libCheck.scriptSrc.startsWith('/personal-trainer/'),
        'body-muscles script is same-origin, got: ' + libCheck.scriptSrc);

    // 2. Seed muscle load: abs high, glutes low — the body map should reflect this.
    await page.evaluate(() => {
        state.muscleLoad = { abs: 400, obliques: 200, back: 120, glutes: 40 };
        state.muscleLoadTs = Date.now();
        saveState();
    });

    // 3. Navigate to Progress, then open the body map.
    await page.click('#tabbar .tab[data-tab="progress"]');
    await page.waitForTimeout(150);
    assert(await active() === 'progress', 'on Progress tab');
    await page.click('#nav-bodymap');
    await page.waitForTimeout(400);
    assert(await active() === 'bodymap', 'on body map screen, got ' + await active());

    // 4. The container has an SVG with muscle paths.
    const svgCheck = await page.evaluate(() => ({
        hasSvg: !!document.querySelector('#body-map-container svg'),
        pathCount: document.querySelectorAll('#body-map-container svg path').length,
    }));
    assert(svgCheck.hasSvg, 'body map container has an SVG');
    assert(svgCheck.pathCount > 10, 'SVG has anatomical paths, got ' + svgCheck.pathCount);

    // 5. muscleBodyState() gives abs IDs higher intensity than glutes IDs.
    const intensities = await page.evaluate(() => {
        const bs = muscleBodyState();
        return {
            absUL: bs['abs-upper-left'] ? bs['abs-upper-left'].intensity : 0,
            gluteMax: bs['gluteus-maximus-left'] ? bs['gluteus-maximus-left'].intensity : 0,
        };
    });
    assert(intensities.absUL > intensities.gluteMax,
        `abs intensity (${intensities.absUL}) > glutes intensity (${intensities.gluteMax})`);
    assert(intensities.absUL === 10, 'abs (max region) maps to intensity 10, got ' + intensities.absUL);
    assert(intensities.gluteMax >= 1, 'glutes (non-zero) maps to at least 1, got ' + intensities.gluteMax);

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/body-map-front.png` });

    // 6. Front/back toggle changes the view.
    await page.click('#bodymap-view .choice[data-v="back"]');
    await page.waitForTimeout(300);
    const backView = await page.evaluate(() => ({
        hasSvg: !!document.querySelector('#body-map-container svg'),
        selectedBtn: document.querySelector('#bodymap-view .choice.selected').dataset.v,
    }));
    assert(backView.hasSvg, 'SVG still present after switching to back view');
    assert(backView.selectedBtn === 'back', 'back toggle is selected, got ' + backView.selectedBtn);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/body-map-back.png` });

    // 7. Switching back to front works too.
    await page.click('#bodymap-view .choice[data-v="front"]');
    await page.waitForTimeout(300);
    const frontAgain = await page.evaluate(() =>
        document.querySelector('#bodymap-view .choice.selected').dataset.v
    );
    assert(frontAgain === 'front', 'front toggle reselected');

    // 8. Back button returns to Progress.
    await page.click('#bodymap [data-back]');
    await page.waitForTimeout(200);
    assert(await active() === 'progress', 'back returns to progress, got ' + await active());

    // 9. Zero muscle load: all intensities are 0.
    const zeroState = await page.evaluate(() => {
        state.muscleLoad = { abs: 0, obliques: 0, back: 0, glutes: 0 };
        state.muscleLoadTs = 0;
        const bs = muscleBodyState();
        return Object.values(bs).every((v) => v.intensity === 0);
    });
    assert(zeroState, 'zero muscle load yields all-zero intensities');

    if (errors.length) {
        const fatal = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
        assert(fatal.length === 0, 'unexpected JS errors: ' + fatal.join(' | '));
    }

    console.log('ALL BODY-MAP CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
