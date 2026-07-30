const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');

    // 0. Every exercise in the data model has a non-trivial mistake string.
    const dataCheck = await page.evaluate(() => {
        const bad = EXERCISES.filter((e) => !e.mistake || e.mistake.length < 20);
        return { total: EXERCISES.length, bad: bad.map((e) => e.id) };
    });
    assert(dataCheck.total === 92, 'all 92 exercises present, got ' + dataCheck.total);
    assert(dataCheck.bad.length === 0, 'exercises missing a mistake note: ' + dataCheck.bad.join(', '));

    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }

    // 1. Player, WORK: the mistake note is deliberately NOT shown. A 3-line paragraph
    //    is unreadable mid-exercise, so it was moved to the preceding rest/prep beat
    //    where attention is actually available (see the player redesign).
    await page.click('#btn-generate');
    await page.click('#btn-start');
    await page.waitForSelector('#player.active', { timeout: 5000 });
    await page.waitForTimeout(150);
    const onWork = await page.evaluate(() => {
        const el = document.getElementById('player-mistake');
        return { text: el.textContent.trim(), display: getComputedStyle(el).display };
    });
    assert(onWork.display === 'none', 'mistake note hidden during work, display=' + onWork.display);
    assert(onWork.text === '', 'mistake note empty during work, got: ' + onWork.text.slice(0, 40));
    await page.screenshot({ path: `${SHOTS}/player-mistake-work.png` });

    // 2. Player, REST/PREP: the mistake note for the NEXT exercise is shown here.
    let seenOnRest = false;
    for (let i = 0; i < 40 && !seenOnRest; i++) {
        await page.click('#btn-skip');
        await page.waitForTimeout(120);
        const s = await page.evaluate(() => {
            const el = document.getElementById('player-mistake');
            return {
                phase: document.getElementById('player-phase').textContent.trim(),
                upnext: document.getElementById('player-upnext').textContent.trim(),
                text: el.textContent.trim(),
                display: getComputedStyle(el).display,
            };
        });
        if (s.phase === 'Rest' || s.phase === 'Get into position') {
            assert(s.upnext === 'Next up', 'rest/prep previews the next exercise');
            assert(s.display === 'flex', 'mistake note visible during rest/prep, display=' + s.display);
            assert(s.text.includes('Common mistake:'), 'mistake note includes label, got: ' + s.text.slice(0, 40));
            seenOnRest = true;
            await page.screenshot({ path: `${SHOTS}/player-mistake-rest.png` });
        }
    }
    assert(seenOnRest, 'reached a rest/prep interval showing the next exercise mistake note');

    page.on('dialog', (d) => d.accept());
    await page.click('#btn-quit');
    await page.waitForTimeout(200);

    // 3. Library: expanding an exercise shows its mistake note
    await page.click('#tabbar .tab[data-tab="library"]');
    assert(await active() === 'library', 'library shown');
    const firstItem = page.locator('.lib-item').first();
    await firstItem.locator('.lib-head').click();
    await page.waitForTimeout(150);
    const libMistake = await firstItem.locator('.lib-mistake').textContent();
    assert(libMistake.includes('Common mistake:'), 'library shows mistake note, got: ' + libMistake.slice(0, 40));
    await page.screenshot({ path: `${SHOTS}/library-mistake.png` });

    console.log('ALL COMMON-MISTAKE CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
