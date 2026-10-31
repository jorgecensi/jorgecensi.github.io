// Turns activities into the conquered map: tiles, territory, largest square, districts and XP.
import {
  GRID, DOMINATION, decodePolyline, tilesAlong, neighbors, districtOf, districtTiles, districtCenter,
  tileX, tileY, tileKey, tileCenter, distance,
} from './geo.js';

export const XP = { tile: 100, revisit: 5, territory: 10, square: 25, district: 1000 };

export function computeConquest(activities, now = new Date()) {
  const tiles = new Map();
  const routes = [];
  let totalDistance = 0;

  const sorted = [...activities].sort((a, b) => a.startDate - b.startDate);
  for (const activity of sorted) {
    const points = decodePolyline(activity.polyline);
    if (points.length < 2) continue;
    routes.push(points);
    totalDistance += activity.distance;
    for (const k of tilesAlong(points)) {
      const record = tiles.get(k);
      if (record) {
        record.visits += 1;
        record.last = activity.startDate;
      } else {
        tiles.set(k, { visits: 1, first: activity.startDate, last: activity.startDate, name: activity.name });
      }
    }
  }

  const owned = new Set(tiles.keys());
  const frontier = new Set();
  for (const k of owned) for (const n of neighbors(k)) if (!owned.has(n)) frontier.add(n);

  const districts = new Map();
  for (const k of owned) {
    const d = districtOf(k);
    districts.set(d, (districts.get(d) || 0) + 1);
  }
  let home = null, best = 0;
  for (const [d, count] of districts) if (count > best) { best = count; home = districtCenter(d); }

  let maxVisits = 0, revisits = 0;
  for (const r of tiles.values()) { maxVisits = Math.max(maxVisits, r.visits); revisits += r.visits - 1; }

  const territory = largestTerritory(owned);
  const square = largestSquare(owned);
  const dominated = [...districts.values()].filter((c) => c >= DOMINATION).length;
  const xp = owned.size * XP.tile + revisits * XP.revisit + territory.size * XP.territory
    + (square ? square.size ** 2 : 0) * XP.square + dominated * XP.district;

  return {
    tiles, owned, frontier, territory, square, districts, routes, home, xp, maxVisits, dominated,
    activityCount: routes.length, totalDistance, monthly: monthlyNewTiles(tiles, now),
  };
}

export function largestTerritory(owned) {
  const unvisited = new Set(owned);
  let best = new Set();
  for (const seed of owned) {
    if (!unvisited.has(seed)) continue;
    unvisited.delete(seed);
    const component = new Set();
    const stack = [seed];
    while (stack.length) {
      const k = stack.pop();
      component.add(k);
      for (const n of neighbors(k)) if (unvisited.delete(n)) stack.push(n);
    }
    if (component.size > best.size) best = component;
  }
  return best;
}

/** Classic maximal-square dynamic programming over the sparse tile set. */
export function largestSquare(owned) {
  const order = [...owned].sort((a, b) => (tileY(a) * GRID + tileX(a)) - (tileY(b) * GRID + tileX(b)));
  const sizes = new Map();
  let best = null;
  for (const k of order) {
    const x = tileX(k), y = tileY(k);
    const size = 1 + Math.min(
      sizes.get(tileKey(x - 1, y)) || 0,
      sizes.get(tileKey(x, y - 1)) || 0,
      sizes.get(tileKey(x - 1, y - 1)) || 0,
    );
    sizes.set(k, size);
    if (!best || size > best.size) best = { x: x - size + 1, y: y - size + 1, size };
  }
  return best;
}

function monthlyNewTiles(tiles, now) {
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  const counts = new Map(months.map((m) => [m.getTime(), 0]));
  for (const r of tiles.values()) {
    const d = new Date(r.first);
    const m = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (counts.has(m)) counts.set(m, counts.get(m) + 1);
  }
  return months.map((m) => ({ month: m, count: counts.get(m.getTime()) }));
}

// ---------- Progression ----------

const TITLES = [
  [40, 'Legend'], [30, 'Emperor'], [25, 'Warlord'], [20, 'Conqueror'], [16, 'Cartographer'],
  [12, 'Ranger'], [8, 'Pathfinder'], [5, 'Explorer'], [3, 'Scout'], [1, 'Wanderer'],
];

/** Level n starts at 500·(n−1)² XP. */
export function level(xp) {
  const number = Math.floor(Math.sqrt(xp / 500)) + 1;
  const floor = 500 * (number - 1) ** 2;
  const next = 500 * number ** 2;
  return {
    number, xp, next,
    progress: (xp - floor) / (next - floor),
    toNext: next - xp,
    title: TITLES.find(([n]) => number >= n)[1],
  };
}

export function achievements(c) {
  const square = c.square ? c.square.size : 0;
  const tiles = c.owned.size;
  const list = [
    ['First Flag', 'Conquer your first tile', '🚩', tiles, 1],
    ['Block Captain', 'Conquer 50 tiles', '🧱', tiles, 50],
    ['Local Legend', 'Conquer 250 tiles', '🗺️', tiles, 250],
    ['City Slicker', 'Conquer 1,000 tiles', '🏙️', tiles, 1000],
    ['Metropolitan', 'Conquer 5,000 tiles', '🌎', tiles, 5000],
    ['Square Deal', 'Build a 4×4 square', '⬛', square, 4],
    ['Fortress', 'Build an 8×8 square', '🛡️', square, 8],
    ['Citadel', 'Build a 16×16 square', '👑', square, 16],
    ['Land Grab', 'Connect 100 tiles into one territory', '🔗', c.territory.size, 100],
    ['Empire Builder', 'Connect 500 tiles into one territory', '🏰', c.territory.size, 500],
    ['District Boss', 'Dominate a district', '⭐', c.dominated, 1],
    ['Mayor', 'Dominate 5 districts', '🌟', c.dominated, 5],
    ['Governor', 'Dominate 20 districts', '🏛️', c.dominated, 20],
    ['Regular', 'Record 10 activities', '👟', c.activityCount, 10],
    ['Centurion', 'Record 100 activities', '🏅', c.activityCount, 100],
    ['Home Turf', 'Visit the same tile 50 times', '🏠', c.maxVisits, 50],
  ];
  return list.map(([title, detail, icon, current, target]) => ({
    title, detail, icon, current, target, unlocked: current >= target, progress: Math.min(1, current / target),
  }));
}

// ---------- Quests ----------

export function newTilesSince(c, date) {
  let n = 0;
  for (const r of c.tiles.values()) if (r.first >= date) n++;
  return n;
}

export function nearestFrontier(c, origin, limit) {
  return [...c.frontier]
    .map((k) => [k, distance(origin, tileCenter(k))])
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/** The cheapest way to grow the largest square by one row and column. */
export function squareQuest(c) {
  if (!c.square) return null;
  const size = c.square.size + 1;
  let best = null;
  for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const missing = [];
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const k = tileKey(c.square.x + ox + dx, c.square.y + oy + dy);
        if (!c.owned.has(k)) missing.push(k);
      }
    }
    if (!best || missing.length < best.length) best = missing;
  }
  const bonus = (size ** 2 - (size - 1) ** 2) * XP.square + best.length * XP.tile;
  return { size, missing: best, bonus };
}

/** Districts closest to being dominated, with the frontier tiles inside them as targets. */
export function districtQuests(c, limit) {
  return [...c.districts]
    .filter(([, count]) => count < DOMINATION)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([district, conquered]) => {
      const all = districtTiles(district);
      const frontier = all.filter((k) => c.frontier.has(k));
      return {
        district, conquered, center: districtCenter(district),
        targets: frontier.length ? frontier : all.filter((k) => !c.owned.has(k)),
      };
    });
}
