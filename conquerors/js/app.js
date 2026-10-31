import { DOMINATION, DISTRICT_TILES, tileCenter, tileX, tileY, districtOf, distance, bearing, compass, centroid } from './geo.js';
import {
  computeConquest, level, achievements, newTilesSince, nearestFrontier, squareQuest, districtQuests, XP,
} from './engine.js';
import { demoActivities, DEMO_CENTER } from './demo.js';
import { loadActivities, saveActivities, clearActivities, prefs } from './store.js';
import * as strava from './strava.js';
import { createMap, heatColor, HEAT_LEGEND } from './map.js';

// ---------- State ----------

const CATEGORIES = [
  { id: 'run', title: 'Runs', icon: '🏃', types: ['Run', 'TrailRun'] },
  { id: 'ride', title: 'Rides', icon: '🚴', types: ['Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'Velomobile', 'Handcycle'] },
  { id: 'walk', title: 'Walks', icon: '🚶', types: ['Walk', 'Wheelchair'] },
  { id: 'hike', title: 'Hikes', icon: '🥾', types: ['Hike'] },
  { id: 'other', title: 'Other', icon: '🤸', types: [] },
];
const categoryOf = (sportType) => (CATEGORIES.find((c) => c.types.includes(sportType)) || CATEGORIES[4]).id;

const state = {
  session: 'signedOut',
  activities: [],
  conquest: null,
  tab: 'map',
  layers: { tiles: true, routes: true, frontier: true },
  highlighted: new Set(),
  syncing: false,
  synced: 0,
  location: null,
  categories: new Set(prefs.get('categories', CATEGORIES.map((c) => c.id))),
  weeklyGoal: prefs.get('weeklyGoal', 15),
};

const $ = (selector) => document.querySelector(selector);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Math.round(n).toLocaleString();

function formatDistance(meters) {
  const km = meters >= 1000;
  return new Intl.NumberFormat(undefined, {
    style: 'unit', unit: km ? 'kilometer' : 'meter', maximumFractionDigits: km && meters < 10000 ? 1 : 0,
  }).format(km ? meters / 1000 : meters);
}

function relativeTime(ms) {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const seconds = (ms - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  return 'just now';
}

function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

// ---------- Map ----------

const mapView = createMap($('#map'), { center: DEMO_CENTER, onTileTap: (k) => showTileSheet(k) });
let didInitialFit = false;

function updateMap() {
  mapView.update(state.conquest, state.layers, state.highlighted);
  if (!didInitialFit && state.conquest && state.conquest.home) {
    didInitialFit = true;
    mapView.map.setView(state.conquest.home, 14);
  }
}

// ---------- Game state ----------

function recompute() {
  const input = state.activities.filter((a) => state.categories.has(categoryOf(a.sportType)));
  state.conquest = computeConquest(input);
  render();
}

function render() {
  renderHUD();
  renderTabs();
  renderPanel();
  updateMap();
  $('#highlight-chip').hidden = state.highlighted.size === 0;
  $('#highlight-chip').textContent = `✕ ${state.highlighted.size} target tile${state.highlighted.size === 1 ? '' : 's'}`;
  $('#sync-button').hidden = state.session !== 'strava';
  $('#sync-button').classList.toggle('spinning', state.syncing);
  $('#sync-status').hidden = !state.syncing;
  $('#sync-status').textContent = `Syncing… ${state.synced} activities`;
}

function renderHUD() {
  const c = state.conquest;
  const lv = level(c ? c.xp : 0);
  $('#hud').innerHTML = `
    <div class="badge">${lv.number}</div>
    <div class="hud-level">
      <strong>${lv.title}</strong>
      <div class="bar"><span style="width:${(lv.progress * 100).toFixed(1)}%"></span></div>
      <small>${fmt(lv.toNext)} XP to level ${lv.number + 1}</small>
    </div>
    <div class="hud-tiles">
      <strong>${fmt(c ? c.owned.size : 0)}</strong>
      <small>tiles</small>
      <em>+${c ? newTilesSince(c, weekStart()) : 0} this week</em>
    </div>`;
}

function renderTabs() {
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#panel').hidden = state.tab === 'map';
  document.body.dataset.tab = state.tab;
}

function renderPanel() {
  if (state.tab === 'map') return;
  const html = { quests: questsHTML, stats: statsHTML, settings: settingsHTML }[state.tab]();
  $('#panel').innerHTML = `<div class="panel-inner">${html}</div>`;
}

// ---------- Quests ----------

function questsHTML() {
  const c = state.conquest;
  const done = newTilesSince(c, weekStart());
  const goal = state.weeklyGoal;
  const origin = state.location || c.home;
  let html = `<h1>Quests</h1>
    <section class="card goal">
      ${ring(done / goal, done)}
      <div><h3>${done >= goal ? 'Goal complete! 🎉' : `Conquer ${goal - done} more tile${goal - done === 1 ? '' : 's'}`}</h3>
      <p class="muted">Weekly goal: ${goal} new tiles</p></div>
    </section>`;

  if (!c.owned.size) {
    html += `<section class="card empty"><h3>No territory yet</h3><p class="muted">Record an outdoor activity on Strava and sync to claim your first tiles.</p></section>`;
  }

  if (origin && c.frontier.size) {
    const nearby = nearestFrontier(c, origin, 6);
    html += `<h2>${state.location ? 'Frontier near you' : 'Frontier near home'}</h2><section class="card list">`;
    for (const k of nearby) {
      const center = tileCenter(k);
      const b = bearing(origin, center);
      html += `<button class="row" data-action="show" data-tiles="${k}">
        <span class="arrow" style="transform:rotate(${b}deg)">➤</span>
        <span class="grow"><strong>${formatDistance(distance(origin, center))}</strong><small>Head ${compass(b)} · unclaimed tile</small></span>
        <span class="chev">›</span></button>`;
    }
    html += `<button class="row link" data-action="show" data-tiles="${nearby.join(',')}">Show all ${nearby.length} on the map</button>`;
    if (!state.location) html += `<button class="row link" data-action="locate">📍 Use my location</button>`;
    html += `</section><p class="footnote">Every new tile is worth ${XP.tile} XP.</p>`;
  }

  const sq = squareQuest(c);
  if (sq && sq.missing.length) {
    html += `<h2>Grow your square</h2><section class="card list">
      <button class="row" data-action="show" data-tiles="${sq.missing.join(',')}">
        <span class="icon gold">⬚</span>
        <span class="grow"><strong>Build a ${sq.size}×${sq.size} square</strong><small>${sq.missing.length} tile${sq.missing.length === 1 ? '' : 's'} missing · +${fmt(sq.bonus)} XP</small></span>
        <span class="chev">›</span></button></section>
      <p class="footnote">Your largest fully-conquered square is outlined in gold on the map.</p>`;
  }

  const districts = districtQuests(c, 5);
  if (districts.length) {
    html += `<h2>Districts to dominate</h2><section class="card list">`;
    for (const d of districts) {
      const where = origin ? `${formatDistance(distance(origin, d.center))} ${compass(bearing(origin, d.center))}` : 'District';
      html += `<button class="row" data-action="show" data-tiles="${d.targets.join(',')}">
        <span class="icon">⭐</span>
        <span class="grow"><strong>${DOMINATION - d.conquered} tiles to dominate</strong><small>${where}</small>
        <span class="bar"><span style="width:${(d.conquered / DOMINATION) * 100}%"></span></span></span>
        <span class="chev">›</span></button>`;
    }
    html += `</section><p class="footnote">Conquer half of a district's ${DISTRICT_TILES} tiles to dominate it for +${fmt(XP.district)} XP.</p>`;
  }
  return html;
}

function ring(progress, label) {
  const r = 24, circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(1, progress));
  return `<svg class="ring" viewBox="0 0 60 60" aria-hidden="true">
    <circle cx="30" cy="30" r="${r}" class="ring-bg"/>
    <circle cx="30" cy="30" r="${r}" class="ring-fg" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
    <text x="30" y="35" text-anchor="middle">${label}</text></svg>`;
}

// ---------- Stats ----------

function statsHTML() {
  const c = state.conquest;
  const lv = level(c.xp);
  const athlete = (strava.token() || {}).athlete;
  const name = state.session === 'demo' ? 'Demo Commander' : athlete ? [athlete.firstname, athlete.lastname].filter(Boolean).map(esc).join(' ') : 'Strava athlete';
  const sub = state.session === 'demo' ? 'Exploring the demo city' : esc((athlete && athlete.city) || 'Connected to Strava');
  const avatar = athlete && /^https:\/\//.test(athlete.profile || '') ? `<img src="${esc(athlete.profile)}" alt="">` : '<span>👤</span>';
  const sq = c.square ? c.square.size : 0;
  const max = Math.max(1, ...c.monthly.map((m) => m.count));
  const list = achievements(c);

  return `<h1>Conquest</h1>
    <div class="profile"><div class="avatar">${avatar}</div><div><strong>${name}</strong><small class="muted">${sub}</small></div></div>
    <section class="card level-card">
      <div class="badge big">${lv.number}</div>
      <div class="grow"><h3>${lv.title}</h3><div class="bar"><span style="width:${(lv.progress * 100).toFixed(1)}%"></span></div>
      <small class="muted">${fmt(c.xp)} XP · ${fmt(lv.toNext)} to level ${lv.number + 1}</small></div>
    </section>
    <div class="stats">
      ${stat('🟧', fmt(c.owned.size), 'Tiles conquered')}
      ${stat('🔗', fmt(c.territory.size), 'Largest territory')}
      ${stat('⬚', `${sq}×${sq}`, 'Largest square')}
      ${stat('⭐', fmt(c.dominated), 'Districts dominated')}
      ${stat('👟', fmt(c.activityCount), 'Activities')}
      ${stat('🛣️', formatDistance(c.totalDistance), 'Distance')}
    </div>
    ${c.monthly.some((m) => m.count) ? `<section class="card"><h3>New tiles per month</h3><div class="chart">
      ${c.monthly.map((m) => `<div class="col" title="${m.count}"><span style="height:${(m.count / max) * 100}%"></span>
        <small>${m.month.toLocaleDateString(undefined, { month: 'narrow' })}</small></div>`).join('')}
    </div></section>` : ''}
    <h2>Achievements <span class="muted">${list.filter((a) => a.unlocked).length}/${list.length}</span></h2>
    <div class="achievements">
      ${list.map((a) => `<div class="achievement ${a.unlocked ? 'unlocked' : ''}" title="${a.detail}">
        <div class="medal">${a.icon}</div><strong>${a.title}</strong>
        ${a.unlocked ? '<small class="gold">Unlocked</small>' : `<div class="bar small"><span style="width:${a.progress * 100}%"></span></div><small class="muted">${fmt(a.current)}/${fmt(a.target)}</small>`}
      </div>`).join('')}
    </div>`;
}

const stat = (icon, value, label) => `<div class="stat"><span>${icon}</span><strong>${value}</strong><small>${label}</small></div>`;

// ---------- Settings ----------

function settingsHTML() {
  const lastSync = prefs.get('lastSync');
  const athlete = (strava.token() || {}).athlete;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const account = state.session === 'strava'
    ? `<div class="row static"><span class="grow">Strava</span><span class="muted">${athlete ? esc(athlete.firstname || 'Connected') : 'Connected'}</span></div>
       <div class="row static"><span class="grow">Activities</span><span class="muted">${fmt(state.activities.length)}</span></div>
       <div class="row static"><span class="grow">Last sync</span><span class="muted">${lastSync ? relativeTime(lastSync) : 'Never'}</span></div>
       <button class="row link" data-action="sync" ${state.syncing ? 'disabled' : ''}>Sync now</button>
       <button class="row link" data-action="full-sync" ${state.syncing ? 'disabled' : ''}>Re-download all activities</button>`
    : `<div class="row static"><span class="grow">Mode</span><span class="muted">Demo city</span></div>
       <p class="footnote inset">You're exploring generated routes. Exit the demo to connect your own Strava account.</p>`;

  return `<h1>Settings</h1>
    ${standalone ? '' : `<section class="card install"><h3>📲 Install on your phone</h3>
      <p class="muted">On iPhone, tap <b>Share</b> → <b>Add to Home Screen</b>. On Android, use the browser menu → <b>Install app</b>.</p></section>`}
    <h2>Account</h2><section class="card list">${account}</section>
    <h2>Activities that conquer</h2><section class="card list">
      ${CATEGORIES.map((cat) => `<label class="row"><span class="grow">${cat.icon} ${cat.title}</span>
        <input type="checkbox" class="switch" data-category="${cat.id}" ${state.categories.has(cat.id) ? 'checked' : ''}></label>`).join('')}
    </section>
    <p class="footnote">Indoor, manual and virtual activities never count — they have no real-world route.</p>
    <h2>Weekly goal</h2><section class="card list"><div class="row static">
      <span class="grow">${state.weeklyGoal} new tiles per week</span>
      <span class="stepper"><button data-action="goal" data-delta="-5">−</button><button data-action="goal" data-delta="5">+</button></span>
    </div></section>
    <h2>How it works</h2><section class="card rules">
      <p>🟧 The world is divided into tiles of about 200 m. Pass through one during an activity to conquer it (+${XP.tile} XP).</p>
      <p>🔥 Tile colors show how often you visit — yellow once, magenta for your home turf (+${XP.revisit} XP per revisit).</p>
      <p>🔗 Connected tiles form your territory (+${XP.territory} XP per tile in your largest one).</p>
      <p>⬚ Your largest fully-conquered square is outlined in gold (+${XP.square} XP × size²).</p>
      <p>⭐ Conquer half of a district's ${DISTRICT_TILES} tiles to dominate it (+${fmt(XP.district)} XP).</p>
    </section>
    ${state.session === 'strava' ? '<section class="card list"><button class="row link" data-action="credentials">Change Strava API credentials</button></section>' : ''}
    <section class="card list"><button class="row danger" data-action="sign-out">${state.session === 'strava' ? 'Disconnect Strava' : 'Exit demo'}</button></section>
    <p class="footnote center">Activity data powered by Strava · Map © OpenStreetMap, CARTO</p>`;
}

// ---------- Tile sheet ----------

function showTileSheet(k) {
  const c = state.conquest;
  if (!c) return;
  const record = c.tiles.get(k);
  const frontier = c.frontier.has(k);
  const districtCount = c.districts.get(districtOf(k)) || 0;
  const title = record ? 'Conquered' : frontier ? 'Frontier' : 'Unexplored';
  const color = record ? heatColor(record.visits) : '#777';
  openSheet(`
    <div class="sheet-head"><span class="flag" style="color:${color}">${record ? '⚑' : '⚐'}</span>
      <div><h3>${title}</h3><small class="muted mono">Tile ${tileX(k)} · ${tileY(k)}</small></div></div>
    ${record ? `<dl>
      <dt>Visits</dt><dd>${fmt(record.visits)}</dd>
      <dt>Conquered</dt><dd>${new Date(record.first).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd>
      <dt>Claimed by</dt><dd>${esc(record.name)}</dd>
      <dt>Last visit</dt><dd>${relativeTime(record.last)}</dd></dl>`
    : `<p class="muted">${frontier
      ? `This tile borders your territory. Pass through it on your next activity to claim it for +${XP.tile} XP.`
      : `Uncharted ground. Plan a route through it to claim it for +${XP.tile} XP.`}</p>`}
    <div class="district"><div class="row-between"><strong>District control</strong>
      <small class="muted">${districtCount >= DOMINATION ? `Dominated · ${districtCount}/${DISTRICT_TILES} tiles` : `${districtCount}/${DOMINATION} to dominate`}</small></div>
      <div class="bar ${districtCount >= DOMINATION ? 'gold' : ''}"><span style="width:${Math.min(1, districtCount / DOMINATION) * 100}%"></span></div></div>
    ${record ? '' : `<button class="primary" data-action="show" data-tiles="${k}">🎯 Mark as target</button>`}`);
}

function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  requestAnimationFrame(() => $('#sheet').classList.add('open'));
}

function closeSheet() {
  $('#sheet').classList.remove('open');
  setTimeout(() => { $('#sheet').hidden = true; }, 200);
}

// ---------- Welcome / setup ----------

function showWelcome() {
  $('#welcome').hidden = false;
  $('#welcome-actions').innerHTML = `
    <button class="strava" data-action="connect">Connect with Strava</button>
    <button class="ghost" data-action="demo">Explore the demo city</button>`;
  $('#setup').hidden = true;
  fillSetup();
}

function showSetup() {
  $('#welcome').hidden = false;
  $('#setup').hidden = false;
  fillSetup();
}

function fillSetup() {
  const creds = strava.credentials();
  $('#client-id').value = creds ? creds.clientId : '';
  $('#client-secret').value = creds ? creds.clientSecret : '';
  $('#callback-domain').textContent = location.hostname || 'localhost';
}

function hideWelcome() {
  $('#welcome').hidden = true;
}

// ---------- Actions ----------

function show(tiles) {
  if (!tiles.length) return;
  state.highlighted = new Set(tiles);
  const centers = tiles.map(tileCenter);
  const center = centroid(centers);
  const radius = Math.max(500, Math.max(...centers.map((p) => distance(p, center))) + 300);
  setTab('map');
  closeSheet();
  mapView.focus(center, radius);
}

function setTab(tab) {
  state.tab = tab;
  render();
  if (tab === 'map') setTimeout(() => mapView.map.invalidateSize(), 0);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 6000);
}

function locate({ focus = true } = {}) {
  if (!navigator.geolocation) return toast('Location is not available in this browser.');
  navigator.geolocation.getCurrentPosition((pos) => {
    state.location = [pos.coords.latitude, pos.coords.longitude];
    mapView.showMe(state.location);
    if (focus) mapView.focus(state.location, 1200);
    if (state.tab === 'quests') renderPanel();
    if (!locate.watching) {
      locate.watching = true;
      navigator.geolocation.watchPosition((p) => {
        state.location = [p.coords.latitude, p.coords.longitude];
        mapView.showMe(state.location);
      }, () => {}, { enableHighAccuracy: false, maximumAge: 30000 });
    }
  }, () => toast('Couldn’t get your location. Check the browser’s location permission.'), { timeout: 10000 });
}

async function sync(full = false) {
  if (state.session !== 'strava' || state.syncing) return;
  state.syncing = true;
  state.synced = 0;
  render();
  const after = full || !state.activities.length ? null : Math.max(...state.activities.map((a) => a.startDate));
  const fetched = [];
  let failed = false;
  try {
    for (let page = 1; ; page++) {
      const result = await strava.activitiesPage(page, after);
      fetched.push(...result.activities);
      state.synced += result.rawCount;
      render();
      if (result.rawCount < strava.PAGE_SIZE) break;
    }
  } catch (error) {
    failed = true;
    if (error.kind === 'unauthorized') {
      state.syncing = false;
      await signOut();
      toast(error.message);
      return;
    }
    // Keep whatever was downloaded before the failure (e.g. a rate limit mid-history).
    toast(error.message);
  }
  state.syncing = false;
  if (fetched.length || !failed) {
    const byId = new Map((full ? [] : state.activities).map((a) => [a.id, a]));
    for (const a of fetched) byId.set(a.id, a);
    state.activities = [...byId.values()].sort((a, b) => b.startDate - a.startDate);
    await saveActivities(state.activities).catch(() => {});
    prefs.set('lastSync', Date.now());
    if (fetched.length && !failed) toast(`Synced ${fetched.length} new activit${fetched.length === 1 ? 'y' : 'ies'}.`);
  }
  recompute();
}

async function signOut() {
  if (state.session === 'strava') strava.signOut();
  prefs.set('demo', false);
  prefs.set('lastSync', null);
  await clearActivities().catch(() => {});
  Object.assign(state, { session: 'signedOut', activities: [], highlighted: new Set(), tab: 'map' });
  didInitialFit = false;
  recompute();
  showWelcome();
}

function startDemo() {
  prefs.set('demo', true);
  state.session = 'demo';
  state.activities = demoActivities();
  hideWelcome();
  recompute();
}

function connect() {
  if (!strava.credentials()) return showSetup();
  try {
    strava.beginAuthorization();
  } catch (error) {
    toast(error.message);
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action], [data-tab]');
  if (!target) return;
  if (target.dataset.tab) return setTab(target.dataset.tab);
  const action = target.dataset.action;
  if (action === 'show') show(target.dataset.tiles.split(',').map(Number));
  else if (action === 'clear-highlight') { state.highlighted = new Set(); render(); }
  else if (action === 'locate') locate();
  else if (action === 'sync') sync();
  else if (action === 'full-sync') sync(true);
  else if (action === 'demo') startDemo();
  else if (action === 'connect') connect();
  else if (action === 'credentials') showSetup();
  else if (action === 'close-setup') { $('#setup').hidden = true; if (state.session !== 'signedOut') hideWelcome(); }
  else if (action === 'close-sheet') closeSheet();
  else if (action === 'goal') {
    state.weeklyGoal = Math.max(5, Math.min(200, state.weeklyGoal + Number(target.dataset.delta)));
    prefs.set('weeklyGoal', state.weeklyGoal);
    render();
  } else if (action === 'sign-out') {
    const message = state.session === 'strava'
      ? 'Disconnect Strava? Your conquered map will be removed from this device.'
      : 'Exit the demo city?';
    if (confirm(message)) signOut();
  } else if (action === 'toggle-layers') {
    $('#layers-menu').hidden = !$('#layers-menu').hidden;
  }
});

document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.dataset.category) {
    if (input.checked) state.categories.add(input.dataset.category);
    else state.categories.delete(input.dataset.category);
    prefs.set('categories', [...state.categories]);
    recompute();
  } else if (input.dataset.layer) {
    state.layers[input.dataset.layer] = input.checked;
    updateMap();
  }
});

$('#setup').addEventListener('submit', (event) => {
  event.preventDefault();
  const clientId = $('#client-id').value.trim();
  const clientSecret = $('#client-secret').value.trim();
  if (!/^\d+$/.test(clientId) || clientSecret.length < 20) {
    toast('Check the Client ID (a number) and Client Secret from strava.com/settings/api.');
    return;
  }
  strava.setCredentials(clientId, clientSecret);
  strava.beginAuthorization();
});

// ---------- Startup ----------

async function start() {
  let justConnected = false;
  try {
    justConnected = await strava.completeAuthorization();
  } catch (error) {
    toast(error.message);
  }

  if (strava.token()) {
    state.session = 'strava';
    prefs.set('demo', false);
    state.activities = justConnected ? [] : await loadActivities().catch(() => []);
    if (justConnected) await clearActivities().catch(() => {});
    hideWelcome();
    recompute();
    const lastSync = prefs.get('lastSync', 0);
    if (justConnected || Date.now() - lastSync > 30 * 60 * 1000) sync();
  } else if (prefs.get('demo', false)) {
    startDemo();
  } else {
    recompute();
    showWelcome();
  }

  $('#legend').innerHTML = HEAT_LEGEND.map((label, i) =>
    `<span><i style="background:${heatColor(2 ** i)}"></i>${label}</span>`).join('') + '<small>visits</small>';
}

start();
