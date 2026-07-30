const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const assert = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); };

    // --- main pass -------------------------------------------------------------
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const snap = () => page.evaluate(() => ({
        phase: document.getElementById('player-phase').textContent,
        upnext: document.getElementById('player-upnext').textContent,
        name: document.getElementById('player-exname').textContent,
        cueCount: document.getElementById('player-cues').children.length,
        cuesSingle: document.getElementById('player-cues').classList.contains('single'),
        mistake: document.getElementById('player-mistake').textContent.trim(),
        footerNext: document.getElementById('player-next').textContent,
        videoActive: document.getElementById('player-video').classList.contains('active'),
        noRing: document.getElementById('player-timer').classList.contains('no-ring'),
        resting: document.getElementById('player-timer').classList.contains('resting'),
    }));

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }
    if (errors.length) assert(false, 'clean load: ' + errors.join(' | '));

    await page.click('#btn-generate');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    await page.waitForTimeout(1400);

    // 1. WORK is stripped: one rotating cue, no mistake paragraph, ring live
    const work = await snap();
    console.log('work:', JSON.stringify(work));
    assert(work.upnext === '', 'work shows no "next up" eyebrow');
    assert(work.cueCount === 1, 'work shows exactly one cue at a time, got ' + work.cueCount);
    assert(work.cuesSingle, 'work applies the .single cue class');
    assert(work.mistake === '', 'work does NOT render the common-mistake paragraph');
    assert(work.footerNext.startsWith('Next:'), 'work keeps the footer next-up line');
    assert(!work.resting, 'work ring is not in resting colour');
    const ringMoved = await page.evaluate(() => document.getElementById('timer-ring-fill').style.strokeDashoffset);
    assert(parseFloat(ringMoved) > 0, 'countdown ring has begun draining, offset=' + ringMoved);

    // 2. The cue actually rotates (>1 cue exercises cycle every 5s)
    const cueA = await page.evaluate(() => document.getElementById('player-cues').textContent);
    const multi = await page.evaluate(() => {
        const it = currentWorkout.items[player.idx];
        return it && it.ex ? it.ex.cues.length : 0;
    });
    if (multi > 1) {
        await page.waitForTimeout(5200);
        const cueB = await page.evaluate(() => document.getElementById('player-cues').textContent);
        assert(cueA !== cueB, 'cue rotated after 5s ("' + cueA + '" -> "' + cueB + '")');
        console.log('cue rotation ok:', cueA.trim(), '->', cueB.trim());
    } else {
        console.log('note: current exercise has a single cue, rotation not exercised here');
    }

    // 3. PREP is a distinct coaching beat previewing the NEXT exercise
    let prep = null;
    for (let i = 0; i < 40 && !prep; i++) {
        await page.click('#btn-skip');
        await page.waitForTimeout(110);
        const s = await snap();
        if (s.phase === 'Get into position') prep = s;
    }
    assert(prep, 'reached a prep interval labelled "Get into position" (not "Rest")');
    console.log('prep:', JSON.stringify(prep));
    assert(prep.upnext === 'Next up', 'prep shows the "Next up" eyebrow');
    assert(prep.name !== 'Breathe', 'prep headlines the next exercise, not "Breathe"');
    assert(prep.cueCount >= 1 && !prep.cuesSingle, 'prep shows the FULL cue list');
    assert(prep.resting, 'prep ring uses the resting colour');
    assert(prep.footerNext === '', 'prep suppresses the redundant footer next-up line');

    // 4. Video pre-rolled in prep carries into the work interval without reloading
    const beforeId = await page.evaluate(() => player.videoExId);
    const iframeBefore = await page.evaluate(() => {
        const f = document.querySelector('#player-video iframe');
        return f ? f.getAttribute('src') : null;
    });
    await page.click('#btn-skip');
    await page.waitForTimeout(300);
    const afterWork = await snap();
    const afterId = await page.evaluate(() => player.videoExId);
    const iframeAfter = await page.evaluate(() => {
        const f = document.querySelector('#player-video iframe');
        return f ? f.getAttribute('src') : null;
    });
    console.log('carry-over:', { beforeId, afterId, same: iframeBefore === iframeAfter });
    assert(afterWork.name === prep.name, 'the work interval runs the exercise prep previewed');
    assert(afterId === beforeId, 'videoExId unchanged across prep->work');
    assert(iframeBefore === iframeAfter, 'the same iframe src is retained (no reload/flicker)');
    assert(afterWork.mistake === '', 'mistake paragraph is gone again once work resumes');

    // 5. Complete screen: feedback leads, share follows, confetti waits for commit
    for (let i = 0; i < 300 && (await active()) === 'player'; i++) {
        await page.click('#btn-skip').catch(() => {});
        await page.waitForTimeout(12);
    }
    await page.waitForTimeout(400);
    assert(await active() === 'complete', 'reached complete, got ' + await active());
    assert(await page.evaluate(() => document.querySelectorAll('canvas.confetti').length) === 0,
        'confetti does NOT fire on arrival at complete');
    assert(await page.evaluate(() => {
        const fb = document.querySelector('#complete .feedback-row');
        const sh = document.getElementById('btn-share');
        return !!(fb && sh && (fb.compareDocumentPosition(sh) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), 'feedback row precedes the share button');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/player-complete.png` });

    await page.click('[data-fb="right"]');
    await page.waitForTimeout(250);
    assert(await active() === 'home', 'feedback commits and returns home');
    assert(await page.evaluate(() => document.querySelectorAll('canvas.confetti').length) > 0,
        'confetti fires on commit');
    assert((await page.textContent('#stat-workouts')).trim() === '1', 'workout recorded');

    if (errors.length) assert(false, 'no page errors: ' + errors.join(' | '));
    await page.close();

    // --- offline pass: video slot must explain itself, not go black -------------
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const off = await ctx.newPage();
    await off.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await off.waitForLoadState('networkidle');
    const activeOff = () => off.evaluate(() => document.querySelector('.screen.active').id);
    if (await activeOff() === 'setup') {
        await off.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await off.click('#setup-go');
    }
    await ctx.setOffline(true);
    await off.click('#btn-generate');
    // Not every exercise ships a preset form-guide video (users paste their own), so
    // the first move of a random workout may have no video slot at all. This pass is
    // about the *offline* behaviour of a slot that does exist, so guarantee one by
    // giving the first exercise a link before it plays.
    await off.evaluate(() => {
        const first = currentWorkout.items.find((it) => it.kind === 'work');
        state.links = state.links || {};
        state.links[first.ex.id] = 'https://www.youtube.com/watch?v=ASdvN_XEl_c';
        saveState();
    });
    await off.click('#btn-start');
    await off.waitForSelector('#player.active', { timeout: 5000 });
    await off.waitForTimeout(600);
    const offline = await off.evaluate(() => ({
        hasNote: !!document.querySelector('#player-video .video-offline'),
        hasIframe: !!document.querySelector('#player-video iframe'),
        active: document.getElementById('player-video').classList.contains('active'),
        cues: document.getElementById('player-cues').children.length,
    }));
    console.log('offline:', JSON.stringify(offline));
    assert(offline.hasNote, 'offline shows an explanatory note in the video slot');
    assert(!offline.hasIframe, 'offline does not embed a doomed iframe');
    assert(offline.cues >= 1, 'cues still coach the user while offline');
    if (SHOTS) await off.screenshot({ path: `${SHOTS}/player-offline.png` });

    console.log('ALL PLAYER-REDESIGN CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
