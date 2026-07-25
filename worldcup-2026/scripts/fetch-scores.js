#!/usr/bin/env node
// Fetches FIFA World Cup 2026 results from football-data.org
// and writes worldcup-2026/scores.json so the app can auto-apply them.
// Requires env var FOOTBALL_DATA_API_KEY (free account at football-data.org).

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
if (!API_KEY) { console.error('FOOTBALL_DATA_API_KEY not set'); process.exit(1); }

// football-data.org team name → app team name (add entries as needed)
const NORMALIZE = {
  'USA':                           'United States',
  'Korea Republic':                'South Korea',
  'IR Iran':                       'Iran',
  "Bosnia & Herzegovina":          'Bosnia',
  "Bosnia and Herzegovina":        'Bosnia',
  "Bosnia-Herzegovina":            'Bosnia',
  "Cabo Verde":                    'Cape Verde',
  "Cape Verde Islands":            'Cape Verde',
  "Côte d'Ivoire":                 'Ivory Coast',
  "Ivory Coast":                   'Ivory Coast',
  'Democratic Republic of Congo':  'DR Congo',
  'Congo DR':                      'DR Congo',
  'Czech Republic':                'Czechia',
  'Curaçao':                       'Curacao',
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

// football-data.org stage → app KO round key
const STAGE_MAP = {
  'ROUND_OF_32':    'r32',
  'ROUND_OF_16':    'r16',
  'QUARTER_FINALS': 'qf',
  'SEMI_FINALS':    'sf',
  'THIRD_PLACE':    'third',
  'FINAL':          'final',
};

function fetch_json(urlPath) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.football-data.org',
      path: urlPath,
      headers: { 'X-Auth-Token': API_KEY },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`API request failed: ${res.statusCode}\nBody: ${raw.slice(0,300)}`));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error(`JSON parse: ${e.message}\nBody: ${raw.slice(0,300)}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const outPath = path.join(__dirname, '..', 'scores.json');
  let existing = { updated: null, group: {}, ko: {} };
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (e) {
      throw new Error(`Refusing to continue: ${outPath} exists but is not valid JSON (${e.message}). Fix or remove it manually before re-running.`);
    }
  }

  const data = await fetch_json('/v4/competitions/WC/matches?status=FINISHED');
  const matches = data.matches || [];
  console.log(`Fetched ${matches.length} finished matches.`);

  const newGroup = { ...existing.group };
  const newKO    = { ...existing.ko };
  let changed = false;

  for (const m of matches) {
    const stage   = m.stage;
    const apiHome = norm(m.homeTeam?.name || m.homeTeam?.shortName || '');
    const apiAway = norm(m.awayTeam?.name || m.awayTeam?.shortName || '');

    // extraTime score is cumulative (includes 90-min goals); use it when present.
    // fullTime is regulation score (90 min).
    const scoreH = m.score?.extraTime?.home ?? m.score?.fullTime?.home;
    const scoreA = m.score?.extraTime?.away ?? m.score?.fullTime?.away;
    if (scoreH == null || scoreA == null) continue;

    // Penalty shootout goals only (null if no shootout)
    const penH = m.score?.penalties?.home ?? null;
    const penA = m.score?.penalties?.away ?? null;

    if (stage === 'GROUP_STAGE') {
      const key   = [apiHome, apiAway].sort().join('|');
      const entry = GROUP_MATCHES[key];
      if (!entry) { console.warn(`Unknown group pair: "${apiHome}" vs "${apiAway}"`); continue; }

      const [h, a] = apiHome === entry.home ? [scoreH, scoreA] : [scoreA, scoreH];
      if (newGroup[entry.id]?.homeScore !== h || newGroup[entry.id]?.awayScore !== a) {
        newGroup[entry.id] = { homeScore: h, awayScore: a };
        changed = true;
      }
    } else {
      const appRound = STAGE_MAP[stage];
      if (!appRound) { console.warn(`Unknown stage: "${stage}"`); continue; }

      // Store by sorted team pair, with scoreA/scoreB relative to that sorted
      // order (not home/away) — the app looks up by sorted key and has no
      // other way to know which team was home.
      const sorted = [apiHome, apiAway].sort();
      const key    = sorted.join('|');
      const [sA, sB] = apiHome === sorted[0] ? [scoreH, scoreA] : [scoreA, scoreH];
      const [pA, pB] = apiHome === sorted[0] ? [penH, penA] : [penA, penH];
      const prev = newKO[key] || {};
      const next = { scoreA: sA, scoreB: sB, penA: pA, penB: pB };
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
