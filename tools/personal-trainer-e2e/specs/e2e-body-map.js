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

    // 6. Tapping a muscle shows the exercise list for that region.
    const absPath = page.locator('.body-chart-muscle').filter({ has: page.locator('title', { hasText: 'Abs' }) }).first();
    const box = await absPath.boundingBox();
    assert(box, 'abs muscle path has a bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    const regionPanel = await page.evaluate(() => {
        const el = document.getElementById('body-map-region');
        return {
            hasHead: !!el.querySelector('.bm-region-head'),
            headText: el.querySelector('.bm-region-head') ? el.querySelector('.bm-region-head').textContent : '',
            hasPct: !!el.querySelector('.bm-region-pct'),
            listItems: el.querySelectorAll('.bm-ex-list li').length,
            hasTag: !!el.querySelector('.bm-ex-tag'),
            firstExName: el.querySelector('.bm-ex-name') ? el.querySelector('.bm-ex-name').textContent : '',
        };
    });
    assert(regionPanel.hasHead, 'region panel shows a heading after tapping a muscle');
    assert(regionPanel.headText === 'Abs', 'heading is Abs, got ' + regionPanel.headText);
    assert(regionPanel.hasPct, 'region panel shows percentage');
    assert(regionPanel.listItems > 0, 'region panel lists exercises, got ' + regionPanel.listItems);
    assert(regionPanel.hasTag, 'exercises show discipline tag');
    assert(regionPanel.firstExName.length > 0, 'exercise names are populated');

    // 7. Front/back toggle changes the view.
    // Clear the region panel first so the toggle test starts clean.
    await page.evaluate(() => { document.getElementById('body-map-region').innerHTML = ''; });
    await page.click('#bodymap-view .choice[data-v="back"]');
    await page.waitForTimeout(300);
    const backView = await page.evaluate(() => ({
        hasSvg: !!document.querySelector('#body-map-container svg'),
        selectedBtn: document.querySelector('#bodymap-view .choice.selected').dataset.v,
    }));
    assert(backView.hasSvg, 'SVG still present after switching to back view');
    assert(backView.selectedBtn === 'back', 'back toggle is selected, got ' + backView.selectedBtn);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/body-map-back.png` });

    // 8. Switching back to front works too.
    await page.click('#bodymap-view .choice[data-v="front"]');
    await page.waitForTimeout(300);
    const frontAgain = await page.evaluate(() =>
        document.querySelector('#bodymap-view .choice.selected').dataset.v
    );
    assert(frontAgain === 'front', 'front toggle reselected');

    // 8b. Face photo editor: choosing a photo opens the fit editor; saving places
    // an overlay that stays inside the head and never shows on the back view.
    await page.evaluate(() => new Promise((res) => {
        const c = document.createElement('canvas');
        c.width = 120; c.height = 160;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#cc9977'; ctx.fillRect(0, 0, 120, 160);
        const img = new Image();
        img.onload = () => { openFaceEditor(img); res(); };
        img.src = c.toDataURL('image/jpeg', 0.9);
    }));
    assert(await page.evaluate(() =>
        document.getElementById('face-editor-modal').classList.contains('open')),
        'face editor opens after choosing a photo');
    // Zoom in, then save the crop.
    await page.evaluate(() => {
        faceEditor.scale = 2; faceEditor.zoom.value = 2;
        faceEditorClamp(); faceEditorRender();
        saveFaceEditor();
    });
    const faceState = await page.evaluate(() => ({
        editorClosed: !document.getElementById('face-editor-modal').classList.contains('open'),
        hasPhoto: !!state.facePhoto,
        overlay: !!document.querySelector('.bm-face-img'),
        adjustShown: document.getElementById('btn-face-adjust').style.display !== 'none',
        removeShown: document.getElementById('btn-face-remove').style.display !== 'none',
        uploadText: document.getElementById('btn-face-upload').textContent,
    }));
    assert(faceState.editorClosed, 'editor closes after save');
    assert(faceState.hasPhoto, 'photo saved to state');
    assert(faceState.overlay, 'face overlay appears on the front view');
    assert(faceState.adjustShown, 'Adjust button shown when a photo exists');
    assert(faceState.removeShown, 'Remove button shown when a photo exists');
    assert(/Change/.test(faceState.uploadText), 'upload button reads Change photo');

    // The photo is an <image> spanning the head bounding box, clipped to the real
    // head silhouette: its box matches the head width, sits at the crown, and
    // reaches down past the cranium to the chin (the "Face" path's lower edge).
    const headFit = await page.evaluate(() => {
        const svg = document.querySelector('#body-map-container svg');
        const head = Array.from(svg.querySelectorAll('.body-chart-muscle'))
            .find((p) => { const t = p.querySelector('title'); return t && t.textContent === 'Head'; });
        const hr = head.getBoundingClientRect();
        const imgEl = document.querySelector('.bm-face-img');
        const or = imgEl.getBoundingClientRect();
        const clip = svg.querySelector('#bm-head-clip');
        return {
            widthMatch: Math.abs(or.width - hr.width) <= 1,
            topMatch: Math.abs(or.top - hr.top) <= 1,
            withinX: or.left >= hr.left - 1 && or.right <= hr.right + 1,
            reachesChin: or.bottom > hr.bottom,
            clipped: imgEl.getAttribute('clip-path') === 'url(#bm-head-clip)',
            clipPaths: clip ? clip.querySelectorAll('path').length : 0,
        };
    });
    assert(headFit.widthMatch, 'overlay box matches the head width');
    assert(headFit.topMatch, 'overlay top sits at the crown');
    assert(headFit.withinX, 'overlay stays within the head width');
    assert(headFit.reachesChin, 'overlay extends below the cranium toward the chin');
    assert(headFit.clipped, 'photo is clipped to the head silhouette');
    assert(headFit.clipPaths === 2, 'silhouette clip is built from the Head + Face paths, got ' + headFit.clipPaths);

    // Back view hides the face; front restores it.
    await page.click('#bodymap-view .choice[data-v="back"]');
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => !document.querySelector('.bm-face-img')),
        'face overlay is hidden on the back view');
    await page.click('#bodymap-view .choice[data-v="front"]');
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => !!document.querySelector('.bm-face-img')),
        'face overlay returns on the front view');

    // Removing clears the photo, overlay, and the Adjust button.
    await page.click('#btn-face-remove');
    await page.waitForTimeout(100);
    const removed = await page.evaluate(() => ({
        noPhoto: !state.facePhoto,
        noOverlay: !document.querySelector('.bm-face-img'),
        adjustHidden: document.getElementById('btn-face-adjust').style.display === 'none',
    }));
    assert(removed.noPhoto && removed.noOverlay, 'removing clears the photo and overlay');
    assert(removed.adjustHidden, 'Adjust hidden when no photo');

    // 9. Back button returns to Progress.
    await page.click('#bodymap [data-back]');
    await page.waitForTimeout(200);
    assert(await active() === 'progress', 'back returns to progress, got ' + await active());

    // 10. Zero muscle load: all intensities are 0.
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
