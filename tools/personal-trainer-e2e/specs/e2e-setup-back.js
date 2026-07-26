const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // 1. Fresh (first-run) load: setup is the root screen and has NO visible back button.
    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    assert(await active() === 'setup', 'fresh load lands on setup (onboarding), got ' + await active());
    const onboardingBack = await page.evaluate(() => {
        const btn = document.getElementById('setup-back');
        return { display: getComputedStyle(btn).display };
    });
    assert(onboardingBack.display === 'none', 'back button hidden during first-run onboarding, got display=' + onboardingBack.display);
    await page.screenshot({ path: `${SHOTS}/1-onboarding-no-back.png` });

    // Complete onboarding
    await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
    await page.click('#setup-go');
    await page.waitForTimeout(200);
    assert(await active() === 'home', 'reached home after onboarding, got ' + await active());
    if (errors.length) assert(false, 'no page errors so far: ' + errors.join(' | '));

    // 2. Reach setup via the gear icon: back button now visible and styled like a button.
    await page.click('#nav-settings');
    await page.waitForTimeout(150);
    assert(await active() === 'setup', 'gear icon navigates to setup, got ' + await active());
    const settingsBack = await page.evaluate(() => {
        const btn = document.getElementById('setup-back');
        const cs = getComputedStyle(btn);
        return {
            display: cs.display,
            background: cs.backgroundColor,
            borderWidth: cs.borderTopWidth,
            text: btn.textContent.trim(),
        };
    });
    console.log('settings-page back button style:', settingsBack);
    assert(settingsBack.display !== 'none', 'back button visible when setup reached via gear icon');
    assert(settingsBack.background !== 'rgba(0, 0, 0, 0)' && settingsBack.background !== 'transparent', 'back button has a visible background (looks like a button), got ' + settingsBack.background);
    assert(parseFloat(settingsBack.borderWidth) > 0, 'back button has a visible border, got ' + settingsBack.borderWidth);
    assert(settingsBack.text.includes('Back'), 'back button has the expected label, got: ' + settingsBack.text);
    await page.screenshot({ path: `${SHOTS}/2-settings-with-back.png` });

    // 3. Clicking it returns to home without disturbing state.
    await page.click('#setup-back');
    await page.waitForTimeout(150);
    assert(await active() === 'home', 'back button returns to home, got ' + await active());

    // 4. Re-entering setup a second time still shows the button (not a one-shot fluke).
    await page.click('#nav-settings');
    await page.waitForTimeout(150);
    const secondVisit = await page.evaluate(() => getComputedStyle(document.getElementById('setup-back')).display);
    assert(secondVisit !== 'none', 'back button still visible on a second visit to settings');
    await page.click('#setup-back');
    await page.waitForTimeout(150);
    assert(await active() === 'home', 'back works again on second visit, got ' + await active());

    // 5. Every other data-back button in the app is now styled like a real button too
    //    (visible background + border), not just plain text.
    const otherBackButtons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.back-btn[data-back]')).map((b) => {
            const cs = getComputedStyle(b);
            return { id: b.id || '(no id)', bg: cs.backgroundColor, borderWidth: cs.borderTopWidth };
        });
    });
    console.log('all data-back buttons:', otherBackButtons);
    assert(otherBackButtons.length >= 7, 'expected at least 7 data-back buttons (6 existing + setup), got ' + otherBackButtons.length);
    otherBackButtons.forEach((b) => {
        assert(b.bg !== 'rgba(0, 0, 0, 0)', `back button ${b.id} has a visible background`);
        assert(parseFloat(b.borderWidth) > 0, `back button ${b.id} has a visible border`);
    });

    // 6. Icon-only topbar buttons that are NOT "back" actions keep their plain look
    //    (settings gear was already visited but let's check btn-generator-info / btn-regenerate
    //    on the preview screen).
    await page.click('#btn-generate');
    await page.waitForTimeout(150);
    assert(await active() === 'preview', 'reached preview, got ' + await active());
    const plainIconButtons = await page.evaluate(() => {
        return ['btn-generator-info', 'btn-regenerate'].map((id) => {
            const b = document.getElementById(id);
            const cs = getComputedStyle(b);
            return { id, bg: cs.backgroundColor };
        });
    });
    console.log('plain icon buttons (should stay transparent):', plainIconButtons);
    plainIconButtons.forEach((b) => {
        assert(b.bg === 'rgba(0, 0, 0, 0)', `${b.id} keeps its plain transparent look (unaffected by the back-button style), got ${b.bg}`);
    });

    if (errors.length) {
        console.log('PAGE ERRORS:', errors);
        assert(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));
    }

    console.log('ALL SETUP-BACK-BUTTON CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
