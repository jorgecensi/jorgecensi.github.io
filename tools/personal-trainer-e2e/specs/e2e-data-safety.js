const { chromium } = require('playwright');
const SHOTS = process.env.SHOTS_DIR;

const URL = 'http://localhost:4001/personal-trainer/';
const KEY = 'pt-state-v1';
const PREV = 'pt-state-v1-prev';

(async () => {
    const browser = await chromium.launch();
    const assert = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); };

    // Each case needs its own storage, so use a fresh context rather than one page.
    const fresh = async () => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e)));
        return { ctx, page, errs };
    };
    const active = (page) => page.evaluate(() => document.querySelector('.screen.active').id);

    // Drive a real workout so there is genuine history to lose.
    const seed = async (page) => {
        await page.goto(URL, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');
        if (await active(page) === 'setup') {
            await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
            await page.click('#setup-go');
        }
        await page.click('#btn-generate');
        await page.click('#btn-start');
        await page.waitForSelector('#player.active', { timeout: 5000 });
        for (let i = 0; i < 140 && (await active(page)) === 'player'; i++) {
            await page.click('#btn-skip');
            await page.waitForTimeout(40);
        }
        await page.click('[data-fb="right"]');
        assert(await active(page) === 'home', 'committed a workout, got ' + await active(page));
        return page.evaluate(() => state.history.length);
    };

    // --- 1. A corrupt primary key recovers from the rolling backup ----------------
    {
        const { ctx, page, errs } = await fresh();
        const workouts = await seed(page);
        assert(workouts >= 1, 'seeded at least one workout, got ' + workouts);

        // Reload once so the good blob is mirrored into the backup key, then corrupt
        // the primary exactly the way a truncated/interrupted write would.
        await page.reload();
        await page.waitForLoadState('networkidle');
        const mirrored = await page.evaluate((k) => !!localStorage.getItem(k), PREV);
        assert(mirrored, 'a clean load mirrors the blob into the backup key');

        await page.evaluate((k) => localStorage.setItem(k, '{"history":[{"ts":1,'), KEY);
        await page.reload();
        await page.waitForLoadState('networkidle');

        const after = await page.evaluate(() => state.history.length);
        console.log(`corrupt primary: history ${workouts} -> ${after}`);
        assert(after === workouts, `history recovered from the backup key, got ${after} of ${workouts}`);
        const toast = await page.textContent('.toast').catch(() => '');
        assert(/damaged/i.test(toast), 'the recovery is reported, not silent — got: ' + JSON.stringify(toast));
        await page.screenshot({ path: `${SHOTS}/1-recovery-toast.png` });
        if (errs.length) assert(false, 'no page errors during recovery: ' + errs.join(' | '));
        await ctx.close();
    }

    // --- 2. Corrupt primary AND no backup fails loudly rather than silently -------
    {
        const { ctx, page } = await fresh();
        await seed(page);
        await page.evaluate(([k, p]) => {
            localStorage.setItem(k, 'not json at all');
            localStorage.removeItem(p);
        }, [KEY, PREV]);
        await page.reload();
        await page.waitForLoadState('networkidle');
        const toast = await page.textContent('.toast').catch(() => '');
        assert(/could not be recovered/i.test(toast), 'unrecoverable loss is announced, got: ' + JSON.stringify(toast));
        await ctx.close();
    }

    // --- 3. A failing write warns instead of silently dropping progress ----------
    {
        const { ctx, page } = await fresh();
        await page.goto(URL, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');
        if (await active(page) === 'setup') {
            await page.click('#setup-level .choice[data-v="intermediate"]').catch(() => {});
            await page.click('#setup-go');
        }
        // Simulate a full quota the way Safari private mode behaves.
        await page.evaluate(() => {
            localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
        });
        await page.click('#nav-settings');
        await page.click('#setup-haptics .choice[data-v="off"]');
        await page.waitForTimeout(300);
        const toast = await page.textContent('.toast').catch(() => '');
        console.log('save-failure toast:', JSON.stringify(toast));
        assert(/isn.t being saved/i.test(toast), 'a failed write is surfaced, got: ' + JSON.stringify(toast));
        await ctx.close();
    }

    // --- 4. Backup captures everything, and restore round-trips it ---------------
    {
        const { ctx, page } = await fresh();
        const workouts = await seed(page);

        const payload = await page.evaluate(async () => {
            const blob = buildBackupBlob();
            return { text: await blob.text(), type: blob.type };
        });
        assert(payload.type === 'application/json', 'backup blob is JSON, got ' + payload.type);
        const parsed = JSON.parse(payload.text);
        console.log('backup:', parsed.app, 'format', parsed.format, '|', Object.keys(parsed.state).length, 'state keys');
        assert(parsed.app === 'personal-trainer' && parsed.format === 1, 'backup is tagged and versioned');

        // The whole point: this is what the old links-only export threw away.
        ['history', 'prog', 'records', 'achievements', 'streak', 'bestStreak', 'links'].forEach((k) => {
            assert(k in parsed.state, `backup includes "${k}"`);
        });
        assert(parsed.state.history.length === workouts, 'backup carries the full history');

        // Wipe, then restore from that exact payload.
        await page.evaluate(() => { state = defaultState(); saveState(); renderHome(); });
        assert(await page.evaluate(() => state.history.length) === 0, 'wiped before restoring');

        const restored = await page.evaluate((text) => {
            state = parseBackup(text);
            saveState();
            return state.history.length;
        }, payload.text);
        console.log(`restore: 0 -> ${restored}`);
        assert(restored === workouts, `restore round-trips the history, got ${restored} of ${workouts}`);

        // And it survives a reload, i.e. it was actually written.
        await page.reload();
        await page.waitForLoadState('networkidle');
        assert(await page.evaluate(() => state.history.length) === workouts, 'restored data persisted');
        await ctx.close();
    }

    // --- 5. Restore rejects a file that isn't ours -------------------------------
    {
        const { ctx, page } = await fresh();
        await page.goto(URL, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');
        const rejects = await page.evaluate(() => {
            const bad = ['{}', '[]', 'null', '{"foo":1}', '{"state":{"foo":1}}', 'not json'];
            return bad.map((t) => { try { parseBackup(t); return `ACCEPTED ${t}`; } catch (e) { return null; } })
                      .filter(Boolean);
        });
        assert(rejects.length === 0, 'unrelated JSON is rejected, but got: ' + JSON.stringify(rejects));

        // A bare state object (no wrapper) still restores — hand-edited files matter.
        const bare = await page.evaluate(() => parseBackup(JSON.stringify({ history: [{ ts: 1, mins: 5 }], prog: { core: 9, pilates: 3 } })).prog.core);
        assert(bare === 9, 'a bare state object restores, got ' + bare);
        await ctx.close();
    }

    console.log('ALL DATA-SAFETY CHECKS PASSED');
    await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
