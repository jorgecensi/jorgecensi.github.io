// Geometry helpers and the tile grid.
// Tiles follow the Web Mercator "slippy map" grid at zoom 17 (roughly 150–300 m per side),
// so they line up exactly with the map. A tile is stored as one number: x * GRID + y.

export const ZOOM = 17;
export const GRID = 2 ** ZOOM;
export const DISTRICT_SHIFT = 3;
export const DISTRICT_SIDE = 1 << DISTRICT_SHIFT;
export const DISTRICT_TILES = DISTRICT_SIDE * DISTRICT_SIDE;
export const DOMINATION = DISTRICT_TILES / 2;
const DISTRICT_GRID = GRID >> DISTRICT_SHIFT;

export const tileKey = (x, y) => x * GRID + y;
export const tileX = (k) => Math.floor(k / GRID);
export const tileY = (k) => k % GRID;

/** Fractional tile coordinates for a point. */
export function fractional(lat, lon) {
  const n = GRID;
  const clamped = Math.min(Math.max(lat, -85.05112878), 85.05112878) * Math.PI / 180;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2 * n;
  return [x, y];
}

/** Inverse of `fractional`: returns [lat, lon]. */
export function tilePoint(x, y) {
  const n = GRID;
  const lon = x / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  return [lat, lon];
}

export function tileAt(lat, lon) {
  const [x, y] = fractional(lat, lon);
  return tileKey(Math.floor(x), Math.floor(y));
}

export const tileCenter = (k) => tilePoint(tileX(k) + 0.5, tileY(k) + 0.5);

export function neighbors(k) {
  const x = tileX(k), y = tileY(k);
  return [tileKey(x + 1, y), tileKey(x - 1, y), tileKey(x, y + 1), tileKey(x, y - 1)];
}

export function districtOf(k) {
  return (tileX(k) >> DISTRICT_SHIFT) * DISTRICT_GRID + (tileY(k) >> DISTRICT_SHIFT);
}

export function districtTiles(d) {
  const ox = Math.floor(d / DISTRICT_GRID) << DISTRICT_SHIFT;
  const oy = (d % DISTRICT_GRID) << DISTRICT_SHIFT;
  const tiles = [];
  for (let dy = 0; dy < DISTRICT_SIDE; dy++) {
    for (let dx = 0; dx < DISTRICT_SIDE; dx++) tiles.push(tileKey(ox + dx, oy + dy));
  }
  return tiles;
}

export function districtCenter(d) {
  const s = DISTRICT_SIDE;
  return tilePoint((Math.floor(d / DISTRICT_GRID) + 0.5) * s, (d % DISTRICT_GRID + 0.5) * s);
}

/** Every tile a GPS trace passes through. Segments are sampled every 0.2 tiles so sparse polylines still mark each tile they cross. */
export function tilesAlong(points) {
  const result = new Set();
  if (!points.length) return result;
  let [px, py] = fractional(points[0][0], points[0][1]);
  result.add(tileKey(Math.floor(px), Math.floor(py)));
  for (let i = 1; i < points.length; i++) {
    const [cx, cy] = fractional(points[i][0], points[i][1]);
    const dx = cx - px, dy = cy - py;
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    // Long jumps are GPS glitches, ferries or paused recordings: don't paint a line across the city.
    if (length > 20) {
      result.add(tileKey(Math.floor(cx), Math.floor(cy)));
    } else {
      const steps = Math.max(1, Math.ceil(length / 0.2));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        result.add(tileKey(Math.floor(px + dx * t), Math.floor(py + dy * t)));
      }
    }
    px = cx; py = cy;
  }
  return result;
}

// Google encoded polyline format, used by Strava's summary_polyline.
export function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0;
    while (index < encoded.length) {
      const chunk = encoded.charCodeAt(index++) - 63;
      result |= (chunk & 0x1f) << shift;
      shift += 5;
      if (chunk < 0x20) return (result & 1) ? ~(result >> 1) : (result >> 1);
    }
    return null;
  };
  while (index < encoded.length) {
    const dLat = next(), dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat; lon += dLon;
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;
}

export function encodePolyline(points) {
  let out = '', prevLat = 0, prevLon = 0;
  const append = (value) => {
    let v = value < 0 ? ~(value << 1) : (value << 1);
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const [la, lo] of points) {
    const lat = Math.round(la * 1e5), lon = Math.round(lo * 1e5);
    append(lat - prevLat); append(lon - prevLon);
    prevLat = lat; prevLon = lon;
  }
  return out;
}

const RAD = Math.PI / 180;

/** Great-circle distance in meters between [lat, lon] pairs. */
export function distance(a, b) {
  const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Initial bearing in degrees (0 = north, clockwise). */
export function bearing(a, b) {
  const la1 = a[0] * RAD, la2 = b[0] * RAD, dLon = (b[1] - a[1]) * RAD;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function compass(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor((deg + 22.5) / 45) % 8];
}

/** Moves a point by meters north/east (flat-earth approximation, fine at city scale). */
export function offset([lat, lon], north, east) {
  return [lat + north / 111320, lon + east / (111320 * Math.cos(lat * RAD))];
}

export function centroid(points) {
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lon = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lon];
}
