// Battle of Winterfell: procedural textures, painted on 2D canvases at load.
// No dependencies and no image files. Everything is seeded, so every load
// gives the same pixels.
//
//   makeTextures() -> { stone, darkStone, wood, door, snow, mud, floor, bark, sky }
//
// All of them tile in both directions except `door` (one leaf, 256 x 512) and
// `sky` (2048 x 1024 equirectangular: wraps in x only, zenith on the top row,
// horizon on the middle row, flat fog colour below).
//
// Intended world size of one tile (set texture.repeat from these):
//   stone, darkStone  3 m      (blocks about 1 m x 0.75 m)
//   floor             3 m      (slabs about 0.6 m to 1.5 m)
//   wood              1.2 m    (planks about 24 cm wide)
//   snow              4 m
//   mud               2.5 m
//   bark              1 m around the trunk, 1 m up it

const TAU = Math.PI * 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function sstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Fractal value noise on a w x h grid, 0..1. The lattice has fx x fy cells in
// the first octave and its coordinates are taken modulo the period, so the
// field wraps in both directions.
function fbm(w, h, fx, fy, oct, seed, gain = 0.5) {
  const out = new Float32Array(w * h);
  const rnd = mulberry32(seed);
  const x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float32Array(w);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const cx = fx << o, cy = fy << o;
    if (cx > w || cy > h) break;
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let x = 0; x < w; x++) {
      const u = (x * cx) / w, i = Math.floor(u), t = u - i;
      tx[x] = t * t * (3 - 2 * t);
      x0[x] = i % cx; x1[x] = (i + 1) % cx;
    }
    for (let y = 0; y < h; y++) {
      const v = (y * cy) / h, j = Math.floor(v), t = v - j;
      const ty = t * t * (3 - 2 * t);
      const r0 = (j % cy) * cx, r1 = ((j + 1) % cy) * cx;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const a = lat[r0 + x0[x]], b = lat[r0 + x1[x]];
        const c = lat[r1 + x0[x]], d = lat[r1 + x1[x]];
        const top = a + (b - a) * tx[x], bot = c + (d - c) * tx[x];
        out[row + x] += amp * (top + (bot - top) * ty);
      }
    }
    tot += amp; amp *= gain;
  }
  const k = 1 / tot;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

// The same, computed at 1/k resolution and stretched back up (still wrapping).
// For smooth, low-frequency fields this is several times cheaper.
function fbmLo(w, h, fx, fy, oct, seed, gain, k = 4) {
  const sw = w / k, sh = h / k;
  const src = fbm(sw, sh, fx, fy, oct, seed, gain);
  const out = new Float32Array(w * h);
  const x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = x / k, i = Math.floor(u);
    x0[x] = i; x1[x] = (i + 1) % sw; tx[x] = u - i;
  }
  for (let y = 0; y < h; y++) {
    const v = y / k, j = Math.floor(v), ty = v - j;
    const r0 = j * sw, r1 = ((j + 1) % sh) * sw, row = y * w;
    for (let x = 0; x < w; x++) {
      const a = src[r0 + x0[x]], b = src[r0 + x1[x]];
      const c = src[r1 + x0[x]], d = src[r1 + x1[x]];
      const top = a + (b - a) * tx[x], bot = c + (d - c) * tx[x];
      out[row + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

// Adds a soft oriented ellipse to a float buffer, wrapping at the edges.
function splat(buf, w, h, cx, cy, rx, ry, ang, amt) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const R = Math.ceil(Math.max(rx, ry)) + 1;
  const bx = Math.round(cx), by = Math.round(cy);
  for (let j = -R; j <= R; j++) {
    const yy = (((by + j) % h) + h) % h;
    for (let i = -R; i <= R; i++) {
      const dx = bx + i - cx, dy = by + j - cy;
      const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
      const q = u * u + v * v;
      if (q >= 1) continue;
      const xx = (((bx + i) % w) + w) % w;
      const f = 1 - q;
      buf[yy * w + xx] += amt * f * f;
    }
  }
}

// Runs a canvas drawing at the nine wrapped offsets so features cross edges.
function wrapDraw(ctx, w, h, fn) {
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    ctx.save(); ctx.translate(ox * w, oy * h); fn(); ctx.restore();
  }
}

// ---------------------------------------------------------------- masonry

function stoneLayout(S, rnd) {
  const rows = [];
  const b = [0];
  for (let k = 1; k < 4; k++) b.push(k * S / 4 + (rnd() - 0.5) * 14);
  b.push(S);
  for (let r = 0; r < 4; r++) {
    const off = (r % 2) * 0.5 + (rnd() - 0.5) * 0.12;
    const joints = [];
    for (let i = 0; i < 3; i++) {
      const x = ((i + off) * S / 3 + (rnd() - 0.5) * 30 + S) % S;
      joints.push(x);
    }
    joints.sort((p, q) => p - q);
    rows.push({ y: b[r], joints });
  }
  return { rows, end: S };
}

function floorLayout(S, rnd) {
  const heights = [100, 132, 84, 112, 84];
  const counts = [3, 2, 4, 3, 3];
  const rows = [];
  let y = 0;
  for (let r = 0; r < heights.length; r++) {
    const n = counts[r], start = rnd() * S, joints = [];
    for (let i = 0; i < n; i++) {
      joints.push((start + (i + (rnd() - 0.5) * 0.5) * S / n + S) % S);
    }
    joints.sort((p, q) => p - q);
    rows.push({ y, joints });
    y += heights[r];
  }
  return { rows, end: S };
}

function masonry(o) {
  const S = o.size, mask = S - 1, rnd = mulberry32(o.seed);
  const { rows } = o.layout(S, rnd);
  const nr = rows.length;
  const rowY = rows.map((r) => r.y); rowY.push(S);

  // Per-block tone, tint and noise offset.
  const blocks = rows.map((r) => r.joints.map(() => ({
    tone: 1 + (rnd() - 0.5) * o.toneVar,
    tint: (rnd() - 0.5) * o.tintVar,
    ox: (rnd() * S) | 0, oy: (rnd() * S) | 0,
  })));

  const WA = fbmLo(S, S, 6, 6, 3, o.seed + 11);
  const WB = fbmLo(S, S, 6, 6, 3, o.seed + 12);
  const MW = fbmLo(S, S, 7, 7, 2, o.seed + 13);         // mortar width
  const FN = fbm(S, S, 16, 16, 5, o.seed + 14, 0.62);  // surface grain
  const LO = fbmLo(S, S, 4, 4, 4, o.seed + 15);         // stains, lichen
  const FR = fbmLo(S, S, 20, 20, 3, o.seed + 16, 0.5, 2);        // frost break-up
  const ST = o.streak ? fbmLo(S, S, 17, 1, 4, o.seed + 17, 0.55, 2) : null;

  const cv = canvas(S, S), ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), px = img.data;
  const [br, bg, bb] = o.base, [mr, mg, mb] = o.mortar;
  const wamp = o.warp, mw = o.mortarW;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let wx = x + (WA[i] - 0.5) * wamp;
      let wy = y + (WB[i] - 0.5) * wamp + o.yoff;
      wx = ((wx % S) + S) % S; wy = ((wy % S) + S) % S;

      let r = 0;
      while (r < nr - 1 && wy >= rowY[r + 1]) r++;
      const dT = wy - rowY[r], dB = rowY[r + 1] - wy;
      const J = rows[r].joints, n = J.length;
      let k = n - 1, left = J[n - 1] - S, right = J[0];
      if (wx >= J[0]) {
        k = 0;
        while (k < n - 1 && wx >= J[k + 1]) k++;
        left = J[k]; right = k < n - 1 ? J[k + 1] : J[0] + S;
      }
      const dL = wx - left, dR = right - wx;
      const g = FN[i];
      const d = Math.min(dL, dR, dT, dB) + (g - 0.5) * o.edgeRough;
      const m = mw * (0.5 + MW[i]);
      const mort = 1 - sstep(m - 1.3, m + 1.3, d);

      const B = blocks[r][k];
      const fine = FN[(((y + B.oy) & mask) * S) + ((x + B.ox) & mask)];
      const lo = LO[i];
      let v = B.tone * (1 + (fine - 0.5) * o.grain + (lo - 0.5) * o.stain);
      v *= 1 - o.edgeDark * (1 - sstep(m, m + o.bevel, d));
      if (o.dir) {
        v *= 1 + 0.08 * sstep(m + 9, m, dT) - 0.10 * sstep(m + 9, m, dB);
      }
      const sp = rnd();
      if (sp < o.speck) v *= 0.80;
      else if (sp > 1 - o.speck) v *= 1.16;
      else v *= 0.97 + sp * 0.06;

      let R = br * v * (1 + B.tint), G = bg * v, Bl = bb * v * (1 - B.tint);

      if (o.wear && lo > 0.45) {   // polished, paler tread in the middle of slabs
        const w = o.wear * sstep(0.45, 0.7, lo) * sstep(m, m + 30, d);
        R += (150 - R) * w; G += (143 - G) * w; Bl += (132 - Bl) * w;
      }
      if (o.lichen && lo > 0.38) {
        const top = 0.3 + 0.7 * sstep(60, 6, dT);
        const l = o.lichen * sstep(0.56, 0.68, lo + (fine - 0.5) * 0.35) * top;
        R += (160 - R) * l; G += (165 - G) * l; Bl += (140 - Bl) * l;
      }

      // Mortar: dark and recessed, a little gritty.
      const mv = 0.75 + g * 0.5;
      R += (mr * mv - R) * mort; G += (mg * mv - G) * mort; Bl += (mb * mv - Bl) * mort;

      if (o.frost && dT < 24 + m) {  // frost settles on the ledge at each block top
        const f = o.frost * sstep(20, 1, dT - m * 0.5) * sstep(0.4, 0.62, FR[i] * 0.6 + fine * 0.4 + (lo - 0.5) * 0.5);
        R += (186 - R) * f; G += (195 - G) * f; Bl += (208 - Bl) * f;
      }
      if (ST) {
        // Damp runs down in a few places, not everywhere.
        const s = 1 - o.streak * sstep(0.52, 0.7, ST[i]) * sstep(0.4, 0.62, WA[(i + 131 * S + 77) % (S * S)]) * (0.7 + 0.3 * g);
        R *= s; G *= s; Bl *= s;
      }
      const p = i * 4;
      px[p] = R; px[p + 1] = G; px[p + 2] = Bl; px[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Cracks.
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let c = 0; c < o.cracks; c++) {
    let x = rnd() * S, y = rnd() * S, a = Math.PI / 2 + (rnd() - 0.5) * 1.6;
    const pts = [[x, y]], steps = 6 + ((rnd() * 8) | 0);
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 1.1;
      x += Math.cos(a) * (5 + rnd() * 8); y += Math.sin(a) * (5 + rnd() * 8);
      pts.push([x, y]);
    }
    wrapDraw(ctx, S, S, () => {
      const line = (dx, dy) => {
        ctx.beginPath();
        pts.forEach((q, j) => (j ? ctx.lineTo(q[0] + dx, q[1] + dy) : ctx.moveTo(q[0] + dx, q[1] + dy)));
        ctx.stroke();
      };
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; line(1, 1);
      ctx.strokeStyle = 'rgba(18,18,20,0.55)'; ctx.lineWidth = 1.3; line(0, 0);
    });
  }
  return cv;
}

// ------------------------------------------------------------------ planks

function planks(w, h, o) {
  const rnd = mulberry32(o.seed);
  const n = o.count;
  const edges = [0];
  for (let i = 1; i < n; i++) edges.push(Math.round(i * w / n + (rnd() - 0.5) * (w / n) * 0.3));
  edges.push(w);
  const P = [];
  for (let i = 0; i < n; i++) {
    const pw = edges[i + 1] - edges[i];
    const knots = [];
    if (rnd() < o.knots) {
      knots.push({ x: pw * (0.3 + rnd() * 0.4), y: rnd() * h, r: 4 + rnd() * 5 });
    }
    P.push({
      x: edges[i], w: pw,
      tone: 1 + (rnd() - 0.5) * o.toneVar,
      tint: (rnd() - 0.5) * 0.06,
      offY: (rnd() * h) | 0,
      wk: 1 + ((rnd() * 2) | 0), wph: rnd() * TAU, wamp: 1 + rnd() * 2.5,
      gOff: rnd() * 400,
      joint: o.joints && rnd() < 0.6 ? (rnd() * h) | 0 : -1,
      knots,
    });
  }
  const tab = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) tab[i] = rnd();
  const n1 = (t) => {
    const i = Math.floor(t), f = t - i;
    const a = tab[i & 1023], b = tab[(i + 1) & 1023];
    return a + (b - a) * f * f * (3 - 2 * f);
  };
  const A = fbm(w, h, 64, 2, 3, o.seed + 21);   // along-grain streaks
  const LO = fbmLo(w, h, 3, 3, 4, o.seed + 22, 0.5, 2);   // weathering
  const plankAt = new Uint8Array(w);
  for (let i = 0; i < n; i++) for (let x = edges[i]; x < edges[i + 1]; x++) plankAt[x] = i;

  const cv = canvas(w, h), ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h), px = img.data;
  const [br, bg, bb] = o.base;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = P[plankAt[x]];
      const u = x - p.x;
      const yy = (y + p.offY) % h;
      let gc = u + Math.sin((yy / h) * TAU * p.wk + p.wph) * p.wamp;
      let knot = 0;
      for (const k of p.knots) {
        let dy = Math.abs(y - k.y); if (dy > h / 2) dy = h - dy;
        if (dy > k.r * 9) continue;
        const dx = u - k.x;
        const d = Math.sqrt(dx * dx + dy * dy * 0.3);
        // Grain bends round the knot and turns into rings inside it.
        const bend = sstep(k.r * 4, k.r * 0.8, d);
        gc = gc + (k.x + (dx < 0 ? -d : d) * 1.25 - gc) * bend;
        knot = Math.max(knot, sstep(k.r * 1.1, k.r * 0.2, d));
      }
      const t = gc + p.gOff;
      const prof = 0.55 * n1(t * 0.33) + 0.45 * n1(t * 1.15);
      const a = A[yy * w + x];
      let v = p.tone * (1 + (prof - 0.5) * o.grain + (a - 0.5) * o.streak);
      v *= 1 - 0.5 * knot;
      const e = Math.min(u, p.w - 1 - u);
      v *= 0.3 + 0.7 * sstep(0.2, 2.6, e);                // plank gap
      v *= 1 + 0.05 * sstep(5, 2.6, e) * sstep(1.5, 2.6, e);
      if (p.joint >= 0) {
        let dj = Math.abs(y - p.joint); if (dj > h / 2) dj = h - dj;
        v *= 0.4 + 0.6 * sstep(0.3, 2.2, dj);
      }
      v *= 0.975 + rnd() * 0.05;
      const lo = LO[yy * w + ((x + p.offY) % w)];
      v *= 0.9 + lo * 0.2;
      let R = br * v * (1 + p.tint), G = bg * v, Bl = bb * v * (1 - p.tint);
      // Weathered patches go grey.
      const grey = o.grey * sstep(0.4, 0.7, lo), L = R * 0.3 + G * 0.5 + Bl * 0.2;
      R += (L - R) * grey; G += (L - G) * grey; Bl += (L * 1.04 - Bl) * grey;
      const q = (y * w + x) * 4;
      px[q] = R; px[q + 1] = G; px[q + 2] = Bl; px[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function makeDoor() {
  const W = 256, H = 512;
  const cv = planks(W, H, {
    seed: 4101, count: 5, base: [176, 124, 72], toneVar: 0.16, grain: 0.34,
    streak: 0.2, knots: 0.5, grey: 0.12, joints: false,
  });
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(4102);

  // Shadow round the leaf, where it sits in the frame.
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(10,7,4,0.6)'); g.addColorStop(1, 'rgba(10,7,4,0)');
    ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, 9, 0, 0, 0, 9, H); edge(W, 0, W - 9, 0, W - 9, 0, 9, H);
  edge(0, 0, 0, 9, 0, 0, W, 9); edge(0, H, 0, H - 9, 0, H - 9, W, 9);

  const stud = (x, y, r) => {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(x + 1.2, y + 1.8, r + 0.8, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#5d6068'); g.addColorStop(0.45, '#2c2d32'); g.addColorStop(1, '#101114');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  };

  const strapYs = [76, 256, 436], SH = 34;
  for (const sy of strapYs) {
    const top = sy - SH / 2, bot = sy + SH / 2;
    const shape = (dy) => {
      ctx.beginPath();
      ctx.moveTo(0, top + dy); ctx.lineTo(206, top + dy);
      ctx.lineTo(220, top - 7 + dy); ctx.lineTo(246, sy + dy); ctx.lineTo(220, bot + 7 + dy);
      ctx.lineTo(206, bot + dy); ctx.lineTo(0, bot + dy); ctx.closePath();
    };
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; shape(3.5); ctx.fill();
    const g = ctx.createLinearGradient(0, top - 7, 0, bot + 7);
    g.addColorStop(0, '#34363c'); g.addColorStop(0.25, '#232428');
    g.addColorStop(0.8, '#17181b'); g.addColorStop(1, '#0e0f11');
    ctx.fillStyle = g; shape(0); ctx.fill();
    ctx.strokeStyle = 'rgba(150,160,180,0.16)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, top + 1); ctx.lineTo(206, top + 1); ctx.lineTo(220, top - 6); ctx.stroke();
    // Hammer marks.
    for (let i = 0; i < 26; i++) {
      const hx = rnd() * 205, hy = top + 4 + rnd() * (SH - 8);
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(120,125,140,0.10)';
      ctx.beginPath(); ctx.ellipse(hx, hy, 3 + rnd() * 5, 1.5 + rnd() * 2.5, rnd() * 3, 0, TAU); ctx.fill();
    }
    for (const rx of [22, 66, 110, 154, 198]) stud(rx, sy, 5.2);
    stud(226, sy, 4.2);
  }

  // Studs along the edges, skipping the straps.
  for (let y = 28; y < H - 10; y += 38) {
    if (strapYs.some((s) => Math.abs(s - y) < SH / 2 + 12)) continue;
    stud(13, y, 4); stud(W - 13, y, 4);
  }
  for (let x = 51; x < W - 30; x += 51) { stud(x, 14, 4); stud(x, H - 14, 4); }

  // Ring handle hanging just under the middle strap, near the right edge.
  const hx = 206, hy = 296, rr = 21;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(hx + 3, hy + rr + 4, rr, 0, TAU); ctx.stroke();
  const pg = ctx.createRadialGradient(hx - 4, hy - 5, 2, hx, hy, 15);
  pg.addColorStop(0, '#44464d'); pg.addColorStop(0.6, '#1f2024'); pg.addColorStop(1, '#0d0e10');
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(hx + 2, hy + 3, 15, 0, TAU); ctx.fill();
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.arc(hx, hy, 14, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#131417'; ctx.lineWidth = 6.5;
  ctx.beginPath(); ctx.arc(hx, hy + rr, rr, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(125,132,148,0.55)'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(hx, hy + rr, rr + 1.4, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
  ctx.beginPath(); ctx.arc(hx, hy + rr, rr - 1.6, Math.PI * 0.1, Math.PI * 0.7); ctx.stroke();
  stud(hx, hy, 5);

  // Break up the drawn iron so nothing is a flat fill.
  const N = fbm(W, H, 24, 48, 3, 4103);
  const img = ctx.getImageData(0, 0, W, H), px = img.data;
  for (let i = 0; i < W * H; i++) {
    const k = 0.86 + N[i] * 0.24 + rnd() * 0.05, p = i * 4;
    px[p] *= k; px[p + 1] *= k; px[p + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// -------------------------------------------------------------------- snow

function makeSnow() {
  const S = 512, rnd = mulberry32(5201);
  const D = fbmLo(S, S, 3, 3, 4, 5202);
  const F = fbm(S, S, 28, 28, 3, 5203);
  const T = fbmLo(S, S, 5, 5, 3, 5204);      // where it has been trampled
  const dent = new Float32Array(S * S);

  // A few walking trails.
  for (let t = 0; t < 5; t++) {
    let x = rnd() * S, y = rnd() * S;
    const a = rnd() * TAU, steps = 6 + ((rnd() * 6) | 0);
    for (let s = 0; s < steps; s++) {
      const side = s % 2 ? 1 : -1, aa = a + (rnd() - 0.5) * 0.3;
      const fx = x + Math.cos(a + Math.PI / 2) * 8 * side, fy = y + Math.sin(a + Math.PI / 2) * 8 * side;
      splat(dent, S, S, fx, fy, 24, 14, aa, 0.3);
      splat(dent, S, S, fx, fy, 17, 8.5, aa, -0.85);
      x += Math.cos(a) * (36 + rnd() * 8); y += Math.sin(a) * (36 + rnd() * 8);
    }
  }
  // Hoof churn in loose clusters.
  for (let c = 0; c < 9; c++) {
    const cx = rnd() * S, cy = rnd() * S;
    for (let k = 0; k < 7; k++) {
      const hx = cx + (rnd() - 0.5) * 110, hy = cy + (rnd() - 0.5) * 110;
      const r = 6 + rnd() * 4;
      splat(dent, S, S, hx, hy, r * 1.7, r * 1.5, rnd() * 3, 0.3);
      splat(dent, S, S, hx, hy, r * 1.2, r, rnd() * 3, -(0.45 + rnd() * 0.4));
    }
  }

  const cv = canvas(S, S), ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), px = img.data;
  for (let i = 0; i < S * S; i++) {
    const tr = sstep(0.4, 0.65, T[i]);
    let v = (D[i] - 0.5) * 19 + (F[i] - 0.5) * (7 + 9 * tr) - tr * 4;
    const d = dent[i];
    v += d * 11;
    const s = rnd();
    if (s < 0.004) v += 15; else if (s < 0.02) v += 6; else v += (s - 0.5) * 3;
    const blue = d < 0 ? -d * 5 : 0;      // shadowed hollows go bluer
    const p = i * 4;
    px[p] = 199 + v - blue; px[p + 1] = 210 + v - blue * 0.4; px[p + 2] = 225 + v * 0.8;
    px[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// --------------------------------------------------------------------- mud

function makeMud() {
  const S = 256, rnd = mulberry32(6301);
  const A = fbm(S, S, 6, 6, 5, 6302);
  const Bf = fbm(S, S, 14, 14, 4, 6303, 0.6);
  const Rg = fbm(S, S, 6, 6, 4, 6304);
  const dent = new Float32Array(S * S);
  for (let k = 0; k < 26; k++) {
    const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 6, a = rnd() * 3;
    splat(dent, S, S, x, y, r * 1.8, r * 1.5, a, 0.35);
    splat(dent, S, S, x, y, r, r * 0.75, a, -1);
  }
  const cv = canvas(S, S), ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), px = img.data;
  for (let i = 0; i < S * S; i++) {
    const b = Bf[i], ridge = Math.abs(Rg[i] - 0.5) * 2;
    let v = 0.72 + b * 0.56;
    v *= 0.82 + 0.18 * sstep(0, 0.3, ridge);        // ruts
    v *= 1 + dent[i] * 0.22;
    const s = rnd();
    if (s < 0.012) v *= 1.3; else if (s > 0.985) v *= 0.72; else v *= 0.96 + s * 0.08;
    let R = 101 * v, G = 87 * v, Bl = 73 * v;
    // Dirty snow and ice lie in the smoother patches.
    const ice = 0.72 * sstep(0.51, 0.72, A[i] + (b - 0.5) * 0.55 + Math.min(0, dent[i]) * 0.12);
    const iv = 0.86 + b * 0.26 + (s - 0.5) * 0.05;
    R += (140 * iv - R) * ice; G += (146 * iv - G) * ice; Bl += (154 * iv - Bl) * ice;
    const p = i * 4;
    px[p] = R; px[p + 1] = G; px[p + 2] = Bl; px[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// -------------------------------------------------------------------- bark

function makeBark() {
  const S = 256, rnd = mulberry32(7401);
  const S1 = fbm(S, S, 14, 1, 4, 7402, 0.45);
  const S2 = fbm(S, S, 5, 5, 3, 7403);
  const S3 = fbm(S, S, 64, 6, 2, 7404);
  const cv = canvas(S, S), ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), px = img.data;
  for (let i = 0; i < S * S; i++) {
    const lo = S2[i];
    const f = S1[i] + (lo - 0.5) * 0.35;
    const t = f * 4.5; const fr = t - Math.floor(t);
    const fiss = sstep(0.075, 0.0, Math.abs(fr - 0.5)) * (0.35 + 0.65 * sstep(0.35, 0.6, S3[i]));
    let v = 0.9 + lo * 0.16 + (S3[i] - 0.5) * 0.12 + (rnd() - 0.5) * 0.04;
    // Each plate of bark is slightly raised: lighter one side of a fissure.
    v += 0.05 * sstep(0.5, 0.75, fr) * sstep(1, 0.75, fr);
    let R = 192 * v, G = 186 * v, Bl = 175 * v;
    const k = fiss * 0.62;
    R += (104 - R) * k; G += (102 - G) * k; Bl += (104 - Bl) * k;
    const p = i * 4;
    px[p] = R; px[p + 1] = G; px[p + 2] = Bl; px[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// --------------------------------------------------------------------- sky

function makeSky() {
  const W = 2048, H = 1024, HH = 512, rnd = mulberry32(8501);
  const HOR = [7, 11, 22], ZEN = [2, 4, 11];
  const MX = Math.round(W / 3), MY = HH - 128, MR = 14;
  const mk = 1 / Math.cos(((HH - MY) / HH) * Math.PI / 2);   // x stretch at the moon's height

  // Two lattices of different pitch, so the cloud shapes don't follow a grid.
  const C = fbmLo(W, HH, 7, 2, 5, 8502, 0.56, 2);
  const C2 = fbmLo(W, HH, 11, 3, 4, 8504, 0.56, 2);
  for (let i = 0; i < C.length; i++) C[i] = C[i] * 0.58 + C2[i] * 0.42;
  const M = fbmLo(W, HH, 40, 10, 3, 8503, 0.5, 2);
  // A bank of cloud across the lower part of the moon.
  for (let y = MY - 60; y < MY + 90; y++) for (let x = MX - 220; x < MX + 220; x++) {
    const dx = (x - (MX + 44)) / 200, dy = (y - (MY + 20)) / 46, q = dx * dx + dy * dy;
    if (q < 1) C[y * W + x] += 0.2 * (1 - q) * (1 - q);
  }
  // Threshold from the field itself, so about a third of the sky is covered.
  const samp = [];
  for (let i = 0; i < C.length; i += 97) samp.push(C[i]);
  samp.sort((a, b) => a - b);
  const th = samp[(samp.length * 0.5) | 0];
  const cloudAt = (x, y) => {
    if (C[y * W + x] <= th - 0.05) return 0;
    const c = sstep(th - 0.05, th + 0.1, C[y * W + x]);
    return c * (0.15 + 0.85 * sstep(40, 150, y));     // thin out at the pinched zenith
  };

  const incl = Math.tan(58 * Math.PI / 180), lon0 = 3.9;
  const bandE = new Float32Array(W);
  for (let x = 0; x < W; x++) bandE[x] = Math.atan(incl * Math.sin((x / W) * TAU - lon0));

  const cv = canvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, W, H);
  const img = ctx.createImageData(W, HH), px = img.data;

  let dseed = 8505;
  for (let y = 0; y < HH; y++) {
    const t = y / (HH - 1), elev = (1 - t) * Math.PI / 2;
    const gt = Math.pow(t, 1.5);
    const sr = ZEN[0] + (HOR[0] - ZEN[0]) * gt, sg = ZEN[1] + (HOR[1] - ZEN[1]) * gt, sb = ZEN[2] + (HOR[2] - ZEN[2]) * gt;
    const haze = sstep(0.78, 1, t);
    const nearMoonY = Math.abs(y - MY) < 260;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = cloudAt(x, y);
      // Milky band along a tilted great circle.
      const dE = (elev - bandE[x]) / 0.15;
      const milk = dE > -3 && dE < 3 ? Math.exp(-dE * dE) * (0.35 + 1.3 * M[i] * M[i]) : 0;
      let R = sr + 7 * milk, G = sg + 8 * milk, B = sb + 12 * milk;

      let glow = 0, disc = 0;
      if (nearMoonY) {
        const dx = (x - MX) / mk, dy = y - MY;
        if (dx > -420 && dx < 420) {
          const d = Math.sqrt(dx * dx + dy * dy), e = Math.max(0, d - MR);
          glow = (0.34 * Math.exp(-e / 26) + 0.13 * Math.exp(-e / 105)) * sstep(255, 130, d);
          disc = sstep(MR + 1, MR - 1, d);
          R += 105 * glow; G += 120 * glow; B += 155 * glow;
          if (disc > 0) {
            const mv = 0.74 + 0.5 * M[(y * W + ((x * 3) % W))] - 0.16 * sstep(0.45, 0.6, C[i - 37 * W + 90]);
            const sh = 0.86 + 0.14 * sstep(MR, MR * 0.3, d);   // limb darkening
            R += (206 * mv * sh - R) * disc; G += (212 * mv * sh - G) * disc; B += (220 * mv * sh - B) * disc;
          }
        }
      }
      // Clouds: dark masses with a faint grey edge, silvered near the moon.
      if (c > 0) {
        const rim = c * (1 - c) * 4, lit = glow * 1.3;
        const cr = sr * 0.68 + 2 * rim + 70 * lit, cg = sg * 0.7 + 2.5 * rim + 80 * lit, cb = sb * 0.72 + 4 * rim + 104 * lit;
        const k = c * (disc > 0 ? 0.72 : 0.94);
        R += (cr - R) * k; G += (cg - G) * k; B += (cb - B) * k;
      }
      R += (HOR[0] - R) * haze; G += (HOR[1] - G) * haze; B += (HOR[2] - B) * haze;
      dseed = (Math.imul(dseed, 1664525) + 1013904223) | 0;
      const dth = (dseed >>> 8) / 16777216 * 0.9 - 0.45;   // dither against banding
      const p = i * 4;
      px[p] = R + dth; px[p + 1] = G + dth; px[p + 2] = B + dth; px[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Stars, spread evenly over the dome and widened towards the zenith so
  // they stay round once the texture is wrapped on the sphere.
  const star = (x, y, r, a, col) => {
    const elev = (1 - y / (HH - 1)) * Math.PI / 2;
    const sx = Math.min(1 / Math.cos(elev), 8);
    const xi = ((Math.round(x) % W) + W) % W, yi = Math.min(HH - 1, Math.max(0, Math.round(y)));
    const veil = 1 - cloudAt(xi, yi);
    const dm = Math.hypot((x - MX) / mk, y - MY);
    a *= veil * veil * (1 - sstep(0.7, 0.97, y / (HH - 1))) * sstep(MR + 8, 120, dm);
    if (a < 0.02) return;
    for (const ox of [-W, 0, W]) {
      if (x + ox < -r * sx * 4 || x + ox > W + r * sx * 4) continue;
      if (r > 1.25) {
        ctx.globalAlpha = a * 0.1; ctx.fillStyle = col;
        ctx.beginPath(); ctx.ellipse(x + ox, y, r * 2.4 * sx, r * 2.4, 0, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = a; ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(x + ox, y, r * sx, r, 0, 0, TAU); ctx.fill();
    }
  };
  const tints = ['#ffffff', '#dfe8ff', '#cfdcff', '#fff1dc', '#ffe6cc'];
  let made = 0;
  while (made < 420) {
    const e = Math.asin(rnd());                       // even over the hemisphere
    const keep = 0.12 + 0.88 * sstep(0.03, 0.55, e / (Math.PI / 2));
    const x = rnd() * W, b = Math.pow(rnd(), 3.2), tint = tints[(rnd() * tints.length) | 0];
    if (rnd() > keep) continue;
    made++;
    star(x, (1 - e / (Math.PI / 2)) * (HH - 1), 0.55 + 1.25 * b, 0.3 + 0.7 * b, tint);
  }
  for (let k = 0; k < 260; k++) {                     // faint dust in the milky band
    const x = rnd() * W, e = bandE[x | 0] + (rnd() + rnd() + rnd() - 1.5) * 0.16;
    const a = 0.14 + rnd() * 0.22;
    if (e < 0.06 || e > 1.5) continue;
    star(x, (1 - e / (Math.PI / 2)) * (HH - 1), 0.5, a, '#dfe6ff');
  }
  ctx.globalAlpha = 1;
  return cv;
}

// ------------------------------------------------------------------ export

export function makeTextures() {
  const stone = masonry({
    size: 512, seed: 1101, layout: stoneLayout, yoff: 37,
    base: [134, 133, 136], mortar: [50, 48, 48], mortarW: 4.2, warp: 11, edgeRough: 5,
    toneVar: 0.3, tintVar: 0.05, grain: 0.85, stain: 0.3, bevel: 9, edgeDark: 0.26,
    dir: true, speck: 0.05, lichen: 0.6, frost: 0.55, streak: 0, cracks: 6,
  });
  const darkStone = masonry({
    size: 512, seed: 2201, layout: stoneLayout, yoff: 91,
    base: [93, 93, 97], mortar: [34, 33, 35], mortarW: 5, warp: 14, edgeRough: 7,
    toneVar: 0.34, tintVar: 0.04, grain: 0.9, stain: 0.5, bevel: 12, edgeDark: 0.32,
    dir: true, speck: 0.04, lichen: 0.3, frost: 0.3, streak: 0.38, cracks: 10,
  });
  const floor = masonry({
    size: 512, seed: 3301, layout: floorLayout, yoff: 23,
    base: [128, 119, 107], mortar: [52, 46, 40], mortarW: 2.4, warp: 5, edgeRough: 2.5,
    toneVar: 0.22, tintVar: 0.05, grain: 0.3, stain: 0.26, bevel: 14, edgeDark: 0.2,
    dir: false, speck: 0.015, lichen: 0, frost: 0, streak: 0, wear: 0.4, cracks: 4,
  });
  const wood = planks(256, 256, {
    seed: 4001, count: 5, base: [98, 79, 62], toneVar: 0.26, grain: 0.42,
    streak: 0.26, knots: 0.7, grey: 0.5, joints: true,
  });
  return {
    stone, darkStone, wood, door: makeDoor(), snow: makeSnow(), mud: makeMud(),
    floor, bark: makeBark(), sky: makeSky(),
  };
}
