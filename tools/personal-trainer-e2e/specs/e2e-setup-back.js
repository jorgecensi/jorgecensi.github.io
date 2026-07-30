const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

// #setup serves both first-run onboarding and the Settings tab. This spec covers the
// split between those two modes — it used to cover the #setup-back button, which the
// tab bar replaced (a root screen has nothing to go back to).
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // 1. Fresh (first-run) load: setup is the root screen, in onboarding mode, and the
    //    tab bar is hidden — there is nowhere else to go yet.
    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    assert(await active() === 'setup', 'fresh load lands on setup (onboarding), got ' + await active());
    const onboarding = await page.evaluate(() => ({
        settingsMode: document.getElementById('setup').classList.contains('settings-mode'),
        tabbarVisible: getComputedStyle(document.getElementById('tabbar')).display !== 'none',
        goVisible: getComputedStyle(document.getElementById('setup-go')).display !== 'none'
    }));
    assert(!onboarding.settingsMode, 'setup is in onboarding mode on first run');
    assert(!onboarding.tabbarVisible, 'tab bar hidden during first-run onboarding');
    assert(onboarding.goVisible, '"Let\'s go" CTA shown during onboarding');
    await page.screenshot({ path: `${SHOTS}/1-onboarding-no-tabbar.png` });

    // Complete onboarding
    await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
    await page.click('#setup-go');
    await page.waitForTimeout(200);
    assert(await active() === 'home', 'reached home after onboarding, got ' + await active());
    if (errors.length) assert(false, 'no page errors so far: ' + errors.join(' | '));

    // 2. The tab bar appears once setup is done, with Today marked current.
    const afterOnboarding = await page.evaluate(() => ({
        tabbarVisible: getComputedStyle(document.getElementById('tabbar')).display !== 'none',
        current: document.querySelector('#tabbar .tab[aria-current="page"]').dataset.tab,
        tabCount: document.querySelectorAll('#tabbar .tab').length
    }));
    assert(afterOnboarding.tabbarVisible, 'tab bar visible once onboarding is done');
    assert(afterOnboarding.current === 'home', 'Today tab marked current on home, got ' + afterOnboarding.current);
    assert(afterOnboarding.tabCount === 4, 'four tabs, got ' + afterOnboarding.tabCount);

    // 3. Settings tab shows the same section in settings mode: no CTA, no back button.
    await page.click('#tabbar .tab[data-tab="setup"]');
    await page.waitForTimeout(150);
    assert(await active() === 'setup', 'Settings tab navigates to setup, got ' + await active());
    const settings = await page.evaluate(() => ({
        settingsMode: document.getElementById('setup').classList.contains('settings-mode'),
        goVisible: getComputedStyle(document.getElementById('setup-go')).display !== 'none',
        hasBackBtn: !!document.querySelector('#setup [data-back]'),
        current: document.querySelector('#tabbar .tab[aria-current="page"]').dataset.tab
    }));
    assert(settings.settingsMode, 'setup flips into settings mode once onboarding is done');
    assert(!settings.goVisible, '"Let\'s go" CTA hidden in settings mode');
    assert(!settings.hasBackBtn, 'settings has no back button — it is a root tab');
    assert(settings.current === 'setup', 'Settings tab marked current, got ' + settings.current);
    await page.screenshot({ path: `${SHOTS}/2-settings-mode.png` });

    // 4. Picker rows commit on tap, since there is no save button to press.
    await page.click('#setup-goal .choice[data-v="5"]');
    await page.waitForTimeout(150);
    const savedGoal = await page.evaluate(() => JSON.parse(localStorage.getItem('pt-state-v1')).weeklyGoal);
    assert(savedGoal === 5, 'weekly goal committed on tap, got ' + savedGoal);

    // 5. Tab switches replace the root entry rather than stacking history: after
    //    hopping between tabs, a single back leaves the app rather than replaying them.
    const depthBefore = await page.evaluate(() => history.length);
    for (const t of ['home', 'progress', 'library', 'home', 'setup', 'home']) {
        await page.click(`#tabbar .tab[data-tab="${t}"]`);
        await page.waitForTimeout(80);
    }
    const depthAfter = await page.evaluate(() => history.length);
    assert(depthAfter === depthBefore, `tab switches don't push history (${depthBefore} -> ${depthAfter})`);
    assert(await active() === 'home', 'ended on the Today tab, got ' + await active());

    // 6. A sub-screen keeps its parent tab lit, and back returns to that tab.
    await page.click('#tabbar .tab[data-tab="progress"]');
    await page.waitForTimeout(120);
    await page.click('#nav-info');
    await page.waitForTimeout(150);
    assert(await active() === 'info', 'reached the info sub-screen, got ' + await active());
    const subCurrent = await page.evaluate(() => document.querySelector('#tabbar .tab[aria-current="page"]').dataset.tab);
    assert(subCurrent === 'progress', 'sub-screen keeps its parent tab lit, got ' + subCurrent);
    await page.goBack();
    await page.waitForTimeout(200);
    assert(await active() === 'progress', 'back from a sub-screen returns to its tab, got ' + await active());

    // 7. The tab bar gets out of the way during a workout and its feedback step.
    await page.click('#tabbar .tab[data-tab="home"]');
    await page.waitForTimeout(120);
    await page.click('#btn-generate');
    await page.waitForTimeout(150);
    assert(await active() === 'preview', 'reached preview, got ' + await active());
    assert(await page.evaluate(() => getComputedStyle(document.getElementById('tabbar')).display !== 'none'),
        'tab bar still visible on preview');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    assert(await page.evaluate(() => getComputedStyle(document.getElementById('tabbar')).display === 'none'),
        'tab bar hidden during the workout');
    page.on('dialog', (d) => d.accept());
    await page.click('#btn-quit');
    await page.waitForTimeout(250);

    // 8. Back buttons on sub-screens still read as real buttons, and icon-only topbar
    //    actions stay plain.
    const backButtons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.back-btn[data-back]')).map((b) => {
            const cs = getComputedStyle(b);
            return { id: b.id || '(no id)', bg: cs.backgroundColor, borderWidth: cs.borderTopWidth };
        }));
    console.log('data-back buttons:', backButtons);
    assert(backButtons.length >= 5, 'expected at least 5 data-back buttons, got ' + backButtons.length);
    backButtons.forEach((b) => {
        assert(b.bg !== 'rgba(0, 0, 0, 0)', `back button ${b.id} has a visible background`);
        assert(parseFloat(b.borderWidth) > 0, `back button ${b.id} has a visible border`);
    });

    await page.click('#btn-generate');
    await page.waitForTimeout(150);
    assert(await active() === 'preview', 'reached preview again, got ' + await active());
    const plainIconButtons = await page.evaluate(() =>
        ['btn-generator-info', 'btn-regenerate'].map((id) => ({
            id, bg: getComputedStyle(document.getElementById(id)).backgroundColor
        })));
    console.log('plain icon buttons (should stay transparent):', plainIconButtons);
    plainIconButtons.forEach((b) => {
        assert(b.bg === 'rgba(0, 0, 0, 0)', `${b.id} keeps its plain transparent look, got ${b.bg}`);
    });

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL SETUP/SETTINGS-MODE CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
