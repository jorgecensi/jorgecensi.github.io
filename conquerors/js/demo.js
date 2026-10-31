// Believable city-grid routes so the app can be explored without a Strava account.
import { encodePolyline, offset } from './geo.js';

export const DEMO_CENTER = [52.5163, 13.3777];

/** SplitMix64-style generator (32-bit variant) so demo data is identical on every load. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPORTS = [
  { type: 'Run', name: 'Morning Run', step: 25, speed: 3.0 },
  { type: 'Run', name: 'Evening Run', step: 25, speed: 3.0 },
  { type: 'Ride', name: 'Lunch Ride', step: 55, speed: 6.5 },
  { type: 'Walk', name: 'Afternoon Walk', step: 20, speed: 1.4 },
  { type: 'Hike', name: 'Weekend Hike', step: 22, speed: 1.3 },
];

export function demoActivities(count = 90, now = Date.now()) {
  const rand = seeded(2024);
  const between = (a, b) => a + rand() * (b - a);
  const activities = [];
  for (let i = 0; i < count; i++) {
    const sport = SPORTS[Math.floor(rand() * SPORTS.length)];
    const radius = Math.sqrt(rand()) * 3500;
    const angle = rand() * 2 * Math.PI;
    const start = offset(DEMO_CENTER, radius * Math.cos(angle), radius * Math.sin(angle));
    const points = route(start, Math.floor(between(120, 300)), sport.step, rand);
    const dist = (points.length - 1) * sport.step;
    const daysAgo = i * 4 + between(0, 3);
    activities.push({
      id: i + 1,
      name: sport.name,
      sportType: sport.type,
      startDate: now - daysAgo * 86400000,
      distance: dist,
      movingTime: Math.round(dist / sport.speed),
      polyline: encodePolyline(points),
    });
  }
  return activities;
}

/** A Manhattan-style walk along a street grid that heads back home in its second half. */
function route(start, steps, stepMeters, rand) {
  const points = [start];
  let north = 0, east = 0;
  let heading = Math.floor(rand() * 4);
  let untilTurn = 4 + Math.floor(rand() * 11);
  for (let step = 0; step < steps; step++) {
    if (--untilTurn <= 0) {
      untilTurn = 4 + Math.floor(rand() * 11);
      if (step > steps / 2) {
        heading = Math.abs(north) > Math.abs(east) ? (north > 0 ? 2 : 0) : (east > 0 ? 3 : 1);
      } else {
        heading = (heading + (rand() < 0.5 ? 1 : 3)) % 4;
      }
    }
    const jitter = (rand() - 0.5) * 4;
    if (heading === 0) { north += stepMeters; east += jitter; }
    else if (heading === 1) { east += stepMeters; north += jitter; }
    else if (heading === 2) { north -= stepMeters; east += jitter; }
    else { east -= stepMeters; north += jitter; }
    points.push(offset(start, north, east));
  }
  return points;
}
