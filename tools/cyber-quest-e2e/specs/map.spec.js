// The overworld map on the home screen: nodes lock and unlock with the story, the
// player walks along the roads, the story moving on walks the player to the next
// chapter, and side nodes open the Training Grounds. Reduced motion makes walks instant.
const { launch, assert } = require('./_helpers');

(async () => {
  const { browser, page, errors, ev, open, shot, noHScroll } = await launch();
  await open();
  const at = () => ev(() => window.__cyberQuest.progress.settings.mapAt);
  const cls = (id) => page.getAttribute(`[data-node="${id}"]`, 'class');

  // Every chapter has a node, so a new chapter can't be left off the map.
  const missing = await ev(() => window.__cyberQuest.chapters.filter((id) => !window.__cyberQuest.map.W().nodes.some((n) => n.ch === id)));
  assert(missing.length === 0, 'chapters without a map node: ' + missing.join(', '));

  assert(await at() === 'ch1', 'a fresh player stands on chapter 1');
  assert(/locked/.test(await cls('ch2')), 'chapter 2 starts locked');
  await page.click('[data-node="ch2"]');
  assert(await at() === 'ch1', 'tapping a locked node does not move the player');
  assert(/Finish Chapter 1/.test(await page.innerText('#signpost')), 'the signpost explains the lock');

  await page.click('[data-node="grounds"]');
  assert(await at() === 'grounds', 'the player walks to the Training Grounds');
  assert(await ev(() => document.getElementById('grounds').open), 'one tap walks there and opens the Training Grounds');

  // Clearing chapter 1 walks the player on to chapter 2.
  await ev(() => {
    const p = JSON.parse(localStorage.getItem('cyber-quest-progress-v1'));
    p.story = { ch1: { done: true, stars: 3 } }; p.storyAt = null;
    localStorage.setItem('cyber-quest-progress-v1', JSON.stringify(p));
  });
  await open();
  await page.waitForFunction(() => window.__cyberQuest.progress.settings.mapAt === 'ch2', null, { timeout: 3000 });
  assert(!/locked/.test(await cls('ch2')) && /done/.test(await cls('ch1')), 'chapter 2 opened and chapter 1 shows done');
  assert(/Ch\. 2/.test(await page.innerText('[data-story-play]')), 'the play button offers chapter 2');

  // Keyboard: arrows walk between open chapters.
  await page.keyboard.press('ArrowLeft');
  assert(await at() === 'ch1', 'ArrowLeft walks back to chapter 1');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert(await at() === 'ch2', 'ArrowRight stops at the last open chapter');

  // Arrow keys only walk; Enter opens the node you stand on.
  assert(await ev(() => window.__cyberQuest.state.screen) === 'home', 'walking with the keyboard does not open a chapter');
  await page.keyboard.press('Enter');
  assert(await ev(() => window.__cyberQuest.state.screen) === 'story', 'Enter starts the chapter you stand on');

  // One tap on another open node walks there and starts it.
  await open();
  await page.click('[data-node="ch1"]');
  assert(await at() === 'ch1' && await ev(() => window.__cyberQuest.state.screen) === 'story', 'one tap walks to chapter 1 and starts it');

  await shot('map');
  await noHScroll();
  assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  console.log('PASS map');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
