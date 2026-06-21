#!/usr/bin/env node
// Fetches FIFA World Cup 2026 results from api-sports.io (api-football.com)
// and writes worldcup-2026/scores.json so the app can auto-apply them.
// Requires env var API_FOOTBALL_KEY (free account at api-football.com).

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY = process.env.API_FOOTBALL_KEY;
if (!API_KEY) { console.error('API_FOOTBALL_KEY not set'); process.exit(1); }

// api-sports team name → app team name (add entries as needed)
const NORMALIZE = {
  'USA':                      'United States',
  'Korea Republic':           'South Korea',
  'Korea South':              'South Korea',
  'Iran':                     'Iran',
  'IR Iran':                  'Iran',
  "Bosnia & Herzegovina":     'Bosnia',
  "Bosnia and Herzegovina":   'Bosnia',
  "Cabo Verde":               'Cape Verde',
  "Côte D'Ivoire":            'Ivory Coast',
  "Cote D'Ivoire":            'Ivory Coast',
  "Ivory Coast":              'Ivory Coast',
  'Congo DR':                 'DR Congo',
  'Congo [DRC]':              'DR Congo',
  'Czech Republic':           'Czechia',
  'Curaçao':                  'Curacao',
};
function norm(name) { return NORMALIZE[name] || name; }

// Group match lookup: sorted("Home|Away") → { id, home }
const GROUP_MATCHES = (() => {
  const GROUPS = {
    A:["Mexico","South Africa","South Korea","Czechia"],
    B:["Canada","Bosnia","Qatar","Switzerland"],
    C:["Brazil","Morocco","Haiti","Scotland"],
    D:["United States","Paraguay","Australia","Turkey"],
    E:["Germany","Curacao","Ivory Coast","Ecuador"],
    F:["Netherlands","Japan","Sweden","Tunisia"],
    G:["Belgium","Egypt","Iran","New Zealand"],
    H:["Spain","Cape Verde","Saudi Arabia","Uruguay"],
    I:["France","Senegal","Iraq","Norway"],
    J:["Argentina","Algeria","Austria","Jordan"],
    K:["Portugal","DR Congo","Uzbekistan","Colombia"],
    L:["England","Croatia","Ghana","Panama"],
  };
  const SCHED = {
    A:[[0,1],[2,3],[3,1],[0,2],[3,0],[1,2]],
    B:[[0,1],[2,3],[3,1],[0,2],[3,0],[1,2]],
    C:[[0,1],[2,3],[3,1],[0,2],[3,0],[1,2]],
    D:[[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]],
    E:[[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]],
    F:[[0,1],[2,3],[0,2],[3,1],[1,2],[3,0]],
    G:[[0,1],[2,3],[0,2],[3,1],[1,2],[3,0]],
    H:[[0,1],[2,3],[0,2],[3,1],[1,2],[3,0]],
    I:[[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]],
    J:[[0,1],[2,3],[0,2],[3,1],[1,2],[3,0]],
    K:[[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]],
    L:[[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]],
  };
  const map = {};
  for (const [g, teams] of Object.entries(GROUPS)) {
    SCHED[g].forEach(([hi, ai], idx) => {
      const home = teams[hi], away = teams[ai];
      map[[home, away].sort().join('|')] = { id: `${g}-${idx}`, home };
    });
  }
  return map;
})();

// api-sports round string → app KO round key
const ROUND_MAP = {
  'Round of 32':    'r32',
  'Round of 16':    'r16',
  'Quarter-finals': 'qf',
  'Quarter-Final':  'qf',
  'Semi-finals':    'sf',
  'Semi-Final':     'sf',
  '3rd Place Final':'third',
  'Final':          'final',
};

function fetch_json(urlPath) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'v3.football.api-sports.io',
      path: urlPath,
      headers: { 'x-apisports-key': API_KEY },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error(`JSON parse: ${e.message}\nBody: ${raw.slice(0,300)}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const outPath = path.join(__dirname, '..', 'scores.json');
  let existing = { updated: null, group: {}, ko: {} };
  try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch(_) {}

  // Only fetch finished matches to avoid partial scores
  const data = await fetch_json('/fixtures?league=1&season=2026&status=FT-AET-PEN');
  const fixtures = data.response || [];
  console.log(`Fetched ${fixtures.length} finished fixtures.`);

  const newGroup = { ...existing.group };
  const newKO    = { ...existing.ko };
  let changed = false;

  for (const f of fixtures) {
    const statusShort = f.fixture?.status?.short;
    const finished = ['FT', 'AET', 'PEN'].includes(statusShort);
    if (!finished) continue;

    const apiHome = norm(f.teams?.home?.name || '');
    const apiAway = norm(f.teams?.away?.name || '');

    // Regulation/ET score (NOT including penalty shootout)
    const scoreH = f.goals?.home;
    const scoreA = f.goals?.away;
    if (scoreH == null || scoreA == null) continue;

    // Penalty shootout goals (null if no shootout)
    const penH = f.score?.penalty?.home ?? null;
    const penA = f.score?.penalty?.away ?? null;

    const round = f.league?.round || '';
    const isGroup = round.toLowerCase().includes('group');

    if (isGroup) {
      const key   = [apiHome, apiAway].sort().join('|');
      const entry = GROUP_MATCHES[key];
      if (!entry) { console.warn(`Unknown group pair: "${apiHome}" vs "${apiAway}"`); continue; }

      const [h, a] = apiHome === entry.home ? [scoreH, scoreA] : [scoreA, scoreH];
      if (newGroup[entry.id]?.homeScore !== h || newGroup[entry.id]?.awayScore !== a) {
        newGroup[entry.id] = { homeScore: h, awayScore: a };
        changed = true;
      }
    } else {
      const appRound = ROUND_MAP[round];
      if (!appRound) { console.warn(`Unknown round: "${round}"`); continue; }

      // Store by sorted team pair; the app resolves to the correct match at read time
      const key  = [apiHome, apiAway].sort().join('|');
      const prev = newKO[key] || {};
      const next = { scoreA: scoreH, scoreB: scoreA, penA: penH, penB: penA };
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        newKO[key] = next;
        changed = true;
      }
    }
  }

  if (!changed) { console.log('No score changes.'); return; }

  fs.writeFileSync(outPath, JSON.stringify({
    updated: new Date().toISOString(),
    group: newGroup,
    ko: newKO,
  }) + '\n');
  console.log(`scores.json updated — group: ${Object.keys(newGroup).length}, KO: ${Object.keys(newKO).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
