const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);
    const isOpen = () => page.evaluate(() => document.getElementById('generator-info-modal').classList.contains('open'));

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }
    await page.click('#btn-generate');
    assert(await active() === 'preview', 'preview shown');
    assert(!(await isOpen()), 'modal closed by default');

    // 1. Trigger button opens it
    await page.click('#btn-generator-info');
    assert(await isOpen(), 'modal opens on ⓘ tap');
    await page.screenshot({ path: `${SHOTS}/modal-open.png` });
    const heading = await page.textContent('#generator-info-modal .modal-head h2');
    assert(heading.includes('Generator'), 'modal heading present, got ' + heading);
    const bodyText = await page.textContent('#generator-info-modal .modal-body');
    assert(bodyText.includes('Warm-up') && bodyText.includes('twist') && bodyText.includes('tier'),
        'modal body mentions key generator concepts');

    // 2. X button closes it
    await page.click('#close-generator-info');
    assert(!(await isOpen()), 'X button closes modal');

    // 3. Backdrop click closes it
    await page.click('#btn-generator-info');
    assert(await isOpen(), 'reopened');
    await page.mouse.click(5, 5); // corner of the overlay, outside the card (bottom-sheet, so card is near bottom)
    assert(!(await isOpen()), 'backdrop click closes modal');

    // 4. Escape key closes it
    await page.click('#btn-generator-info');
    assert(await isOpen(), 'reopened again');
    await page.keyboard.press('Escape');
    assert(!(await isOpen()), 'Escape closes modal');

    // 5. Clicking inside the card does NOT close it
    await page.click('#btn-generator-info');
    await page.click('#generator-info-modal .modal-head h2');
    assert(await isOpen(), 'clicking inside the card keeps modal open');
    await page.click('#close-generator-info');

    // 6. Navigating away auto-closes it (defensive: back button / swipe-back edge case).
    // The overlay correctly blocks clicks on the page beneath it, so simulate a real
    // browser back navigation (native popstate) rather than clicking a covered button.
    await page.click('#btn-generator-info');
    assert(await isOpen(), 'reopened before navigation test');
    await page.goBack();
    await page.waitForTimeout(150);
    assert(await active() === 'home', 'back to home');
    assert(!(await isOpen()), 'modal auto-closed after navigating away');

    console.log('ALL GENERATOR-INFO MODAL CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
