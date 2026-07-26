const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const active = () => page.evaluate(() => document.querySelector('.screen.active').id);

    await page.goto('http://localhost:4001/personal-trainer/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    if (await active() === 'setup') {
        await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
        await page.click('#setup-go');
    }

    const shotTiers = [0, 1, 2, 5, 10, 20, 30, 60, 100];
    for (const s of shotTiers) {
        await page.evaluate((v) => { state.streak = v; renderHome(); }, s);
        await page.waitForTimeout(400);
        const el = await page.$('.stat.accent-orange');
        await el.screenshot({ path: `${SHOTS}/streak-v2-${String(s).padStart(3, '0')}.png` });
    }
    await browser.close();
})();
