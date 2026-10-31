// Leaflet map with a canvas grid layer that paints every conquered tile in one pass per map tile.
import { ZOOM, tileX, tileY, tileKey, tileAt } from './geo.js';

const HEAT = ['#ffd166', '#ffa62b', '#ff6b35', '#f0386b', '#c724b1'];
export const HEAT_LEGEND = ['1', '2', '4', '8', '16+'];
export const heatBucket = (visits) => Math.min(HEAT.length - 1, Math.floor(Math.log2(Math.max(1, visits))));
export const heatColor = (visits) => HEAT[heatBucket(visits)];

export function createMap(element, { center, onTileTap }) {
  const map = L.map(element, { zoomControl: false, attributionControl: true, maxZoom: 19, minZoom: 3 })
    .setView(center, 13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    crossOrigin: true,
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  const state = { conquest: null, layers: { tiles: true, routes: true, frontier: true }, highlighted: new Set() };
  const conquestLayer = new ConquestLayer(state);
  conquestLayer.addTo(map);
  const routeRenderer = L.canvas({ padding: 0.5 });
  let routeLayer = null;
  let me = null;

  map.on('click', (e) => onTileTap(tileAt(e.latlng.lat, e.latlng.lng)));

  return {
    map,
    update(conquest, layers, highlighted) {
      const conquestChanged = conquest !== state.conquest;
      const routesToggled = layers.routes !== state.layers.routes;
      Object.assign(state, { conquest, layers: { ...layers }, highlighted });
      conquestLayer.redraw();
      if (conquestChanged || routesToggled) {
        if (routeLayer) routeLayer.remove();
        routeLayer = null;
        if (layers.routes && conquest && conquest.routes.length) {
          routeLayer = L.polyline(conquest.routes, {
            renderer: routeRenderer, color: '#ff8c33', weight: 2, opacity: 0.45, interactive: false, lineJoin: 'round',
          }).addTo(map);
        }
      }
    },
    focus(center, radiusMeters) {
      const bounds = L.latLng(center).toBounds(radiusMeters * 2);
      map.flyToBounds(bounds, { duration: 0.8 });
    },
    showMe(position) {
      if (!me) {
        me = L.circleMarker(position, { radius: 7, color: '#fff', weight: 3, fillColor: '#2b8cff', fillOpacity: 1 }).addTo(map);
      } else {
        me.setLatLng(position);
      }
    },
  };
}

const ConquestLayer = L.GridLayer.extend({
  initialize(state) {
    this.state = state;
    L.GridLayer.prototype.initialize.call(this, { tileSize: 256, pane: 'overlayPane', updateWhenZooming: false });
  },

  createTile(coords) {
    const size = this.getTileSize();
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    draw(ctx, coords, size.x, this.state);
    return canvas;
  },
});

/** Paints the conquered tiles that fall inside one 256 px map tile at zoom `coords.z`. */
function draw(ctx, coords, px, state) {
  const { conquest, layers, highlighted } = state;
  if (!conquest) return;
  const span = 2 ** (ZOOM - coords.z); // conquest tiles per map tile (fractional when zoomed past 17)
  const unit = px / span;              // pixels per conquest tile
  const originX = coords.x * span, originY = coords.y * span;
  const minX = Math.floor(originX), maxX = Math.ceil(originX + span) - 1;
  const minY = Math.floor(originY), maxY = Math.ceil(originY + span) - 1;
  const area = (maxX - minX + 1) * (maxY - minY + 1);

  // Scan the rectangle when zoomed in, the set when zoomed out — whichever is smaller.
  const visible = (set) => {
    const out = [];
    if (area < set.size) {
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const k = tileKey(x, y); if (set.has(k)) out.push(k); }
    } else {
      for (const k of set) { const x = tileX(k), y = tileY(k); if (x >= minX && x <= maxX && y >= minY && y <= maxY) out.push(k); }
    }
    return out;
  };
  const rect = (k) => [(tileX(k) - originX) * unit, (tileY(k) - originY) * unit, unit, unit];

  if (layers.tiles) {
    const owned = visible(conquest.owned);
    ctx.globalAlpha = 0.5;
    for (const k of owned) {
      ctx.fillStyle = heatColor(conquest.tiles.get(k).visits);
      ctx.fillRect(...rect(k));
    }
    ctx.globalAlpha = 1;
    if (unit > 14) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      for (const k of owned) ctx.strokeRect(...rect(k));
    }
  }

  if (layers.frontier && unit > 6) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const k of visible(conquest.frontier)) {
      const [x, y, w, h] = rect(k);
      ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    }
    ctx.setLineDash([]);
  }

  const sq = conquest.square;
  if (sq && sq.size > 1) {
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.strokeRect((sq.x - originX) * unit, (sq.y - originY) * unit, sq.size * unit, sq.size * unit);
  }

  if (highlighted.size) {
    ctx.fillStyle = 'rgba(77,217,255,0.3)';
    ctx.strokeStyle = '#4dd9ff';
    ctx.lineWidth = 2.5;
    for (const k of visible(highlighted)) {
      const [x, y, w, h] = rect(k);
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
  }
}
