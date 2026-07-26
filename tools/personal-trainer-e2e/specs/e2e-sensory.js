const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

// Phase 3 — sensory & coaching layer.
//
// Headless Chromium has no real vibration motor, no speech engine and (usually) no
// Screen Wake Lock, so every one of these APIs is installed as a recording stub via
// addInitScript before any page script runs. That means this spec verifies *our*
// call sites — that the right thing fires at the right interval boundary, and that
// the settings toggles actually gate it — not the browser's implementation.
const INSTALL_STUBS = () => {
    window.__sensory = { vibrations: [], spoken: [], wakeRequests: 0 };

    // speechSynthesis and wakeLock are read-only accessors on the prototype in Chromium,
    // so plain assignment fails silently (non-strict) and you get a stub that never
    // records anything. defineProperty is required; do the same for vibrate for symmetry.
    const define = (obj, prop, value) =>
        Object.defineProperty(obj, prop, { configurable: true, get: () => value });

    define(navigator, 'vibrate', (pattern) => {
        window.__sensory.vibrations.push(Array.isArray(pattern) ? pattern.join(',') : String(pattern));
        return true;
    });

    // Minimal SpeechSynthesis surface: the app only uses speak() and cancel().
    define(window, 'SpeechSynthesisUtterance', function (text) { this.text = text; this.rate = 1; });
    define(window, 'speechSynthesis', {
        speak: (u) => window.__sensory.spoken.push(u.text),
        cancel: () => window.__sensory.spoken.push('<cancel>')
    });

    // A sentinel that reports release, so re-acquisition is observable.
    let sentinel = null;
    define(navigator, 'wakeLock', {
        request: async () => {
            window.__sensory.wakeRequests += 1;
            const listeners = [];
            sentinel = {
                released: false,
                addEventListener: (_, fn) => listeners.push(fn),
                release: async () => { sentinel.released = true; listeners.forEach((f) => f()); },
                __fireRelease: () => { sentinel.released = true; listeners.forEach((f) => f()); }
            };
            window.__sensory.sentinel = sentinel;
            return sentinel;
        }
    });
};

(async () => {
    const browser = await chromium.launch();
    const assert = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); };

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(INSTALL_STUBS);

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const sensory = () => page.evaluate(() => window.__sensory);
    const reset = () => page.evaluate(() => {
        window.__sensory.vibrations = [];
        window.__sensory.spoken = [];
    });

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }
    assert(await active() === 'home', 'reached home, got ' + await active());
    if (errors.length) assert(false, 'clean load: ' + errors.join(' | '));

    // 1. Defaults are on, so an upgrading user is never silently muted.
    const defaults = await page.evaluate(() => ({ sound: state.sound, voice: state.voice, haptics: state.haptics }));
    console.log('defaults:', JSON.stringify(defaults));
    assert(defaults.sound === true && defaults.voice === true && defaults.haptics === true,
        'sound/voice/haptics all default to on, got ' + JSON.stringify(defaults));

    // 2. Starting a workout takes the wake lock and announces the first exercise.
    await page.click('#btn-generate');
    await reset();
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    await page.waitForTimeout(600);

    const start = await sensory();
    console.log('at work start — vibrations:', start.vibrations, 'spoken:', start.spoken);
    assert(start.wakeRequests === 1, 'wake lock requested once on start, got ' + start.wakeRequests);
    assert(start.vibrations.includes('60'), 'work-start haptic fired, got ' + JSON.stringify(start.vibrations));
    const firstName = await page.textContent('#player-exname');
    assert(start.spoken.some((s) => s.includes(firstName.trim())),
        `announced the exercise name "${firstName.trim()}", got ` + JSON.stringify(start.spoken));
    await page.screenshot({ path: `${SHOTS}/1-sensory-work.png` });

    // 3. The final three seconds tick individually, and the count is not interrupted
    //    (interrupting is what makes a spoken countdown audibly skip numbers).
    await reset();
    await page.evaluate(() => { player.remaining = 4; });
    await page.waitForTimeout(3400);
    const countdown = await sensory();
    console.log('countdown — vibrations:', countdown.vibrations, 'spoken:', countdown.spoken);
    assert(countdown.vibrations.filter((v) => v === '15').length >= 3,
        'a countdown haptic per second for the final three, got ' + JSON.stringify(countdown.vibrations));
    ['3', '2', '1'].forEach((n) => {
        assert(countdown.spoken.includes(n), `spoke "${n}" in the countdown, got ` + JSON.stringify(countdown.spoken));
    });
    const countIdx = countdown.spoken.indexOf('3');
    assert(!countdown.spoken.slice(countIdx, countdown.spoken.indexOf('1')).includes('<cancel>'),
        'the 3-2-1 count is not interrupted mid-sequence, got ' + JSON.stringify(countdown.spoken));

    // 4. Crossing into rest names what is coming next, which is the point of the beat.
    //    The countdown above already advanced us into a rest, so step off it first —
    //    otherwise the loop below exits immediately and reset() has wiped the evidence.
    const kind = () => page.evaluate(() => currentWorkout.items[player.idx].kind);
    for (let i = 0; i < 20 && (await kind()) === 'rest'; i++) {
        await page.click('#btn-skip');
        await page.waitForTimeout(120);
    }
    await reset();
    for (let i = 0; i < 20 && (await kind()) !== 'rest'; i++) {
        await page.click('#btn-skip');
        await page.waitForTimeout(120);
    }
    assert(await kind() === 'rest', 'reached a rest interval');
    await page.waitForTimeout(300);
    const rest = await sensory();
    console.log('rest — vibrations:', rest.vibrations, 'spoken:', rest.spoken);
    assert(rest.vibrations.includes('25'), 'rest haptic is distinct from work, got ' + JSON.stringify(rest.vibrations));
    const upNext = await page.textContent('#player-exname');
    assert(rest.spoken.some((s) => s.includes(upNext.trim())),
        `rest announces the upcoming exercise "${upNext.trim()}", got ` + JSON.stringify(rest.spoken));

    // 5. Wake lock is re-acquired after the page is backgrounded. This is the bug the
    //    phase fixes: the browser drops the lock on hide and nothing ever asked again,
    //    so the screen began sleeping mid-workout after an app switch.
    const before = (await sensory()).wakeRequests;
    await page.evaluate(() => {
        window.__sensory.sentinel.__fireRelease();          // what the browser does on hide
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    const after = (await sensory()).wakeRequests;
    console.log(`wake lock requests: ${before} -> ${after}`);
    assert(after === before + 1, `wake lock re-acquired on return to foreground, got ${before} -> ${after}`);

    // 6. Each toggle actually gates its channel. Quit out to settings first.
    page.once('dialog', (d) => d.accept());
    await page.click('#btn-quit');
    await page.waitForTimeout(300);
    assert(await active() === 'home', 'back home after quitting, got ' + await active());

    await page.click('#nav-settings');
    await page.click('#setup-voice .choice[data-v="off"]');
    await page.click('#setup-haptics .choice[data-v="off"]');
    const off = await page.evaluate(() => ({ voice: state.voice, haptics: state.haptics, sound: state.sound }));
    assert(off.voice === false && off.haptics === false, 'toggles flipped in state, got ' + JSON.stringify(off));
    assert(off.sound === true, 'sound is independent of the other two, got ' + JSON.stringify(off));
    await page.screenshot({ path: `${SHOTS}/2-sensory-settings.png` });

    // 7. They persist across a reload — the settings are in saved state, not just memory.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const persisted = await page.evaluate(() => ({ voice: state.voice, haptics: state.haptics, sound: state.sound }));
    console.log('after reload:', JSON.stringify(persisted));
    assert(persisted.voice === false && persisted.haptics === false && persisted.sound === true,
        'toggles persisted across reload, got ' + JSON.stringify(persisted));

    // 8. And with them off, a workout fires neither channel — while sound still works.
    await reset();
    await page.click('#btn-generate');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    await page.waitForTimeout(600);
    const silenced = await sensory();
    console.log('with voice+haptics off:', JSON.stringify(silenced.vibrations), JSON.stringify(silenced.spoken));
    assert(silenced.vibrations.length === 0, 'no haptics when disabled, got ' + JSON.stringify(silenced.vibrations));
    assert(silenced.spoken.filter((s) => s !== '<cancel>').length === 0,
        'no speech when disabled, got ' + JSON.stringify(silenced.spoken));

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(false, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL SENSORY CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
