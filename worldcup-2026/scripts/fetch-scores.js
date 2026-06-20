#!/usr/bin/env node
// Fetches FIFA World Cup 2026 match results from football-data.org and writes
// worldcup-2026/scores.json so the app can auto-apply them.
// Requires env var FOOTBALL_DATA_API_KEY.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
if (!API_KEY) { console.error('FOOTBALL_DATA_API_KEY not set'); process.exit(1); }

// football-data.org team name → app team name
const NORMALIZE = {
  'USA':                      'United States',
  'United States':            'United States',
  'Korea Republic':           'South Korea',
  'IR Iran':                  'Iran',
  'Bosnia and Herzegovina':   'Bosnia',
  'Cabo Verde':               'Cape Verde',
  "Côte d'Ivoire":            'Ivory Coast',
  "Cote d'Ivoire":            'Ivory Coast',
  'Congo DR':                 'DR Congo',
  'DR Congo':                 'DR Congo',
  'Czech Republic':           'Czechia',
  'Curaçao':                  'Curacao',
};
function norm(name) { return NORMALIZE[name] || name; }

// Group match ID lookup: sorted("Home|Away") → { id, home }
// home = scheduled home team (to assign homeScore/awayScore correctly)
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
  // [homeIdx, awayIdx] per matchIdx — mirrors GROUP_SCHEDULE in index.html
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
      const key  = [home, away].sort().join('|');
      map[key] = { id: `${g}-${idx}`, home };
    });
  }
  return map;
})();

const STAGE_TO_ROUND = {
  ROUND_OF_32:     'r32',
  ROUND_OF_16:     'r16',
  QUARTER_FINALS:  'qf',
  SEMI_FINALS:     'sf',
  THIRD_PLACE:     'third',
  FINAL:           'final',
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
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${raw.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const outPath = path.join(__dirname, '..', 'scores.json');

  let existing = { updated: null, group: {}, ko: {} };
  try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch(_) {}

  const data = await fetch_json('/v4/competitions/WC/matches');
  const matches = data.matches || [];

  const newGroup = { ...existing.group };
  const newKO    = { ...existing.ko };
  let changed = false;

  for (const m of matches) {
    if (m.status !== 'FINISHED' && m.status !== 'AWARDED') continue;

    const homeRaw  = m.homeTeam?.shortName || m.homeTeam?.name || '';
    const awayRaw  = m.awayTeam?.shortName || m.awayTeam?.name || '';
    const apiHome  = norm(homeRaw);
    const apiAway  = norm(awayRaw);
    const scoreH   = m.score?.fullTime?.home;
    const scoreA   = m.score?.fullTime?.away;
    if (scoreH == null || scoreA == null) continue;

    const stage = m.stage;
    if (stage === 'GROUP_STAGE') {
      const key   = [apiHome, apiAway].sort().join('|');
      const entry = GROUP_MATCHES[key];
      if (!entry) { console.warn(`Unknown group pair: ${apiHome} vs ${apiAway}`); continue; }

      // Align home/away score with our scheduled home team
      const [h, a] = apiHome === entry.home ? [scoreH, scoreA] : [scoreA, scoreH];
      if (newGroup[entry.id]?.homeScore !== h || newGroup[entry.id]?.awayScore !== a) {
        newGroup[entry.id] = { homeScore: h, awayScore: a };
        changed = true;
      }
    } else {
      const round = STAGE_TO_ROUND[stage];
      if (!round) continue;

      const penH = m.score?.penalties?.home ?? null;
      const penA = m.score?.penalties?.away ?? null;

      // Key by sorted team pair — the app looks up by (teamA|teamB sorted) at read time
      const key = [apiHome, apiAway].sort().join('|');
      const prev = newKO[key] || {};
      const next = { scoreA: scoreH, scoreB: scoreA, penA: penH, penB: penA };
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        newKO[key] = next;
        changed = true;
      }
    }
  }

  if (!changed) { console.log('No score changes.'); return; }

  const out = { updated: new Date().toISOString(), group: newGroup, ko: newKO };
  fs.writeFileSync(outPath, JSON.stringify(out) + '\n');
  console.log(`scores.json updated: ${Object.keys(newGroup).length} group, ${Object.keys(newKO).length} KO.`);
}

main().catch(e => { console.error(e); process.exit(1); });
