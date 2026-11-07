// Plays every quiz mission in the Training Grounds through the debug API: tiers unlock in
// order, each boss unlocks the next tier, a boss question times out, and XP reaches the top rank.
const { launch, assert } = require('./_helpers');

(async () => {
  const { browser, page, errors, ev, open, openGrounds, screen, noHScroll } = await launch();
  const reload = async () => { await open(); await openGrounds(); };
  await reload();
  assert(await page.isDisabled('[data-mission="headers"]'), 'intermediate starts locked');
  assert(await page.isDisabled('[data-mission="webapp"]'), 'advanced starts locked');

  for (const id of await ev(() => window.__cyberQuest.missions)) {
    await page.click(`[data-mission="${id}"]`);
    await page.click('#b-start');
    let wrongDone = false;
    while ((await screen()) === 'play') {
      const kind = await ev(() => window.__cyberQuest.state.kind);
      if (kind === 'forge') {
        await page.fill('#pw', 'biscuit1998');
        assert(await page.isDisabled('#pw-lock'), 'a password with personal info is rejected');
        await page.fill('#pw', 'lamp-orbit-pickle-canyon');
        await page.click('#pw-lock');
      } else if (!wrongDone && !id.startsWith('boss') && (kind === 'order' || kind === 'lines')) {
        wrongDone = true;
        await ev(() => window.__cyberQuest.answerWrong());
        assert(/Not quite/.test(await page.innerText('#feedback h4')), kind + ': a wrong answer is marked wrong');
      } else await ev(() => window.__cyberQuest.answerCorrect());
      await page.click('#next');
    }
    const title = await page.innerText('#r-title');
    assert(!/Breached/.test(title), id + ' should be cleared, got ' + title);
    console.log('  ', id, '→', title);
    await reload();
  }
  await page.click('[data-mission="boss-adv"]');
  await page.click('#b-start');
  await page.waitForSelector('#feedback.show', { timeout: 35000 });
  assert(/Time's up/.test(await page.innerText('#feedback h4')), 'boss questions time out');
  await reload();
  assert(/Cyber Sentinel/.test(await page.innerText('#rank-name')), 'the top rank is reachable');
  await noHScroll();
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  console.log('PASS missions');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
