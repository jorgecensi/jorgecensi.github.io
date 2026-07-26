const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

// The token sets, in the computed px the browser will report at a 16px root.
const FS = [0.72, 0.78, 0.85, 0.95, 1.05, 1.25, 1.5, 1.75, 3.4].map((r) => +(r * 16).toFixed(2));
const RADII = [0, 4, 8, 12, 16];

const near = (v, set, tol = 0.6) => set.some((t) => Math.abs(v - t) <= tol);

(async () => {
    const browser = await chromium.launch();
    const assert = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); };

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }
    // Populate everything so no screen renders an empty state.
    await page.evaluate(() => {
        const now = Date.now();
        state.prog = { core: 38, pilates: 31 };
        state.streak = 6; state.bestStreak = 9;
        state.history = [];
        for (let i = 20; i >= 0; i--) state.history.push({ ts: now - i * 86400000, mins: 22, count: 7, rounds: 1, fb: 'right', level: 'Intermediate' });
        state.records = { 'co-kneeplank': { type: 'secs', best: 45, hist: [{ ts: now, v: 45 }] } };
        checkAchievements(); saveState(); renderHome();
        renderAchievements(); renderRecords(); renderHistory(); renderLibrary();
    });

    // 1. EVERY element on EVERY screen conforms to the token sets. This is the check
    //    that catches anything the find-and-replace sweep missed.
    const offenders = await page.evaluate(({ FS, RADII }) => {
        const nearJs = (v, set, tol = 0.6) => set.some((t) => Math.abs(v - t) <= tol);
        const bad = { fs: [], radius: [] };
        document.querySelectorAll('.screen, .modal-overlay, #install-banner').forEach((screen) => {
            const prev = screen.style.display;
            screen.style.display = 'block'; // force layout for hidden screens
            screen.querySelectorAll('*').forEach((el) => {
                const cs = getComputedStyle(el);
                if (el.textContent && el.children.length === 0) {
                    const f = parseFloat(cs.fontSize);
                    if (f && !nearJs(f, FS)) bad.fs.push(`${el.tagName}.${el.className || '-'}=${f}`);
                }
                ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].forEach((p) => {
                    const raw = cs[p];
                    if (raw.includes('%')) return; // the 24% squircle + 50% circle, deliberate
                    const r = parseFloat(raw);
                    if (r && !nearJs(r, RADII)) bad.radius.push(`${el.tagName}.${el.className || '-'}=${raw}`);
                });
            });
            screen.style.display = prev;
        });
        const uniq = (a) => [...new Set(a)];
        return { fs: uniq(bad.fs), radius: uniq(bad.radius) };
    }, { FS, RADII });

    console.log('off-scale font sizes :', offenders.fs.length ? offenders.fs : 'none');
    console.log('off-scale radii      :', offenders.radius.length ? offenders.radius : 'none');
    assert(offenders.fs.length === 0, 'every font-size is on the scale; offenders: ' + offenders.fs.join(', '));
    assert(offenders.radius.length === 0, 'every radius is on the scale; offenders: ' + offenders.radius.join(', '));

    // 2. A visible focus ring exists (previously: the only :focus rule REMOVED it).
    //    Must be driven by real keyboard input — :focus-visible deliberately does not
    //    match a programmatic .focus(), so el.focus() would report no ring either way.
    await page.evaluate(() => window.scrollTo(0, 0));
    let ring = null;
    for (let i = 0; i < 25 && !ring; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            return {
                el: (el.id ? '#' + el.id : el.tagName + '.' + (el.className || '-')),
                width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset,
                visible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
            };
        });
        if (r && r.visible) ring = r;
    }
    console.log('first keyboard-focused control with a ring:', JSON.stringify(ring));
    assert(ring, 'tabbing reaches a control that shows a visible >=2px focus ring');

    // ...and the library input specifically no longer sets outline:none
    const inputSuppressed = await page.evaluate(() => {
        const el = document.querySelector('.lib-body input');
        if (!el) return null;
        // Read the authored rule rather than the computed idle state.
        return [...document.styleSheets].flatMap((s) => {
            try { return [...s.cssRules]; } catch (e) { return []; }
        }).filter((r) => r.selectorText && r.selectorText.includes('.lib-body input:focus'))
          .map((r) => r.style.outline || r.style.outlineStyle || '');
    });
    console.log('.lib-body input:focus authored outline:', JSON.stringify(inputSuppressed));
    if (inputSuppressed) {
        assert(!inputSuppressed.some((v) => v === 'none'), 'library input no longer sets outline:none');
    }

    // 3. Tokens actually resolve (a self-referential var would compute to empty)
    const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const names = ['--fs-2xs', '--fs-display', '--sp-1', '--sp-8', '--r-xs', '--r-lg',
            '--dur-fast', '--ease-standard', '--app-max-width', '--on-accent', '--accent-rgb', '--bg'];
        return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
    });
    console.log('tokens:', JSON.stringify(tokens));
    Object.entries(tokens).forEach(([k, v]) => {
        assert(v && !v.includes('var('), `${k} resolves to a concrete value, got "${v}"`);
    });

    if (errors.length) assert(false, 'no page errors: ' + errors.join(' | '));
    await page.close();

    // 4. prefers-reduced-motion actually suppresses things, including the JS confetti
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const rm = await ctx.newPage();
    await rm.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await rm.waitForLoadState('networkidle');
    const activeRm = () => rm.evaluate(() => document.querySelector('.screen.active').id);
    if (await activeRm() === 'setup') {
        await rm.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await rm.click('#setup-go');
    }
    const rmState = await rm.evaluate(() => {
        const btn = document.getElementById('btn-generate');
        const badge = document.getElementById('stat-streak-badge');
        return {
            btnTransition: getComputedStyle(btn).transitionDuration,
            badgeAnimation: getComputedStyle(badge).animationDuration,
            matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
    });
    console.log('reduced-motion:', JSON.stringify(rmState));
    assert(rmState.matches, 'context really is in reduced-motion mode');
    assert(parseFloat(rmState.btnTransition) < 0.05, 'transitions collapsed, got ' + rmState.btnTransition);
    assert(parseFloat(rmState.badgeAnimation) < 0.05, 'animations collapsed, got ' + rmState.badgeAnimation);

    const confetti = await rm.evaluate(() => {
        celebrate();
        return document.querySelectorAll('canvas.confetti').length;
    });
    console.log('confetti canvases under reduced-motion:', confetti);
    assert(confetti === 0, 'celebrate() is a no-op under reduced motion (CSS cannot gate a canvas loop)');

    console.log('ALL DESIGN-SYSTEM CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
