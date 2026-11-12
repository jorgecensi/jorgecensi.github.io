// Procedural low-poly models for the Battle of Winterfell.
// buildModels(THREE) returns plain non-indexed BufferGeometries (position, normal, color).
// Units are metres, +Y up, every figure faces +Z. Nothing here touches the scene.
//
// Everything is built from one primitive, tube(): a list of rings swept along a spine
// (a ring of radius 0 is a pole). Heads, torsos, limbs, blades, bowls and trees are all tubes
// with a profile, a warp and a colour function. Normals are smoothed per piece by welding
// equal positions, or left flat for blades and crystals.

export function buildModels(THREE) {
    // ── Small vector kit (arrays of 3) ──
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = (a) => Math.hypot(a[0], a[1], a[2]);
    const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const lerp = (a, b, t) => a + (b - a) * t;
    const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const TAU = Math.PI * 2;
    const g = (v) => [v, v, v];
    const tint = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    const mixc = (a, b, t) => lerp3(a, b, clamp(t, 0, 1));
    function rotX(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
    function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
    function rotZ(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }

    // Seeded PRNG (mulberry32). Each model takes its own stream so editing one never reshuffles another.
    function prng(seed) {
        let a = seed >>> 0;
        const r = () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        r.range = (lo, hi) => lo + (hi - lo) * r();
        return r;
    }

    // ── Pieces: flat arrays of triangle positions and colours; normals are added by shade()/flat() ──
    const piece = () => ({ p: [], c: [], n: null });
    function tri(m, a, b, c, ca, cb, cc) {
        const cr = cross(sub(b, a), sub(c, a));
        if (dot(cr, cr) < 1e-18) return;
        m.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        m.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    }
    /** Smooth normals: weld equal positions inside this piece and average area-weighted face normals. */
    function shade(m) {
        const P = m.p, n = P.length / 3, acc = new Map(), keys = new Array(n);
        const q = (v) => Math.round(v * 2e4);
        for (let t = 0; t < n; t += 3) {
            const a = [P[t * 3], P[t * 3 + 1], P[t * 3 + 2]], b = [P[t * 3 + 3], P[t * 3 + 4], P[t * 3 + 5]], c = [P[t * 3 + 6], P[t * 3 + 7], P[t * 3 + 8]];
            const fn = cross(sub(b, a), sub(c, a));
            for (let k = 0; k < 3; k++) {
                const i = t + k, key = q(P[i * 3]) + ',' + q(P[i * 3 + 1]) + ',' + q(P[i * 3 + 2]);
                keys[i] = key;
                const s = acc.get(key);
                if (s) { s[0] += fn[0]; s[1] += fn[1]; s[2] += fn[2]; } else acc.set(key, [fn[0], fn[1], fn[2]]);
            }
        }
        m.n = new Array(n * 3);
        for (let i = 0; i < n; i++) {
            const s = acc.get(keys[i]), l = len(s);
            const v = l > 1e-12 ? [s[0] / l, s[1] / l, s[2] / l] : [0, 1, 0];
            m.n[i * 3] = v[0]; m.n[i * 3 + 1] = v[1]; m.n[i * 3 + 2] = v[2];
        }
        return m;
    }
    /** Hard edges: every triangle keeps its own face normal. */
    function flat(m) {
        const P = m.p, n = P.length / 3;
        m.n = new Array(n * 3);
        for (let t = 0; t < n; t += 3) {
            const a = [P[t * 3], P[t * 3 + 1], P[t * 3 + 2]], b = [P[t * 3 + 3], P[t * 3 + 4], P[t * 3 + 5]], c = [P[t * 3 + 6], P[t * 3 + 7], P[t * 3 + 8]];
            const f = norm(cross(sub(b, a), sub(c, a)));
            for (let k = 0; k < 3; k++) { m.n[(t + k) * 3] = f[0]; m.n[(t + k) * 3 + 1] = f[1]; m.n[(t + k) * 3 + 2] = f[2]; }
        }
        return m;
    }
    /** Two-sided cloth: append a mirrored copy (reversed winding, negated normals). Call after shade(). */
    function dbl(m) {
        const n = m.p.length / 9, P = m.p.slice(), C = m.c.slice(), N = m.n.slice();
        for (let t = 0; t < n; t++) {
            for (const k of [0, 2, 1]) {
                const i = t * 3 + k;
                m.p.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
                m.c.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
                m.n.push(-N[i * 3], -N[i * 3 + 1], -N[i * 3 + 2]);
            }
        }
        return m;
    }
    /** Recolour every vertex from its position and normal (snow on upper faces and so on). */
    function recolor(m, fn) {
        for (let i = 0; i < m.p.length / 3; i++) {
            const c = fn([m.p[i * 3], m.p[i * 3 + 1], m.p[i * 3 + 2]], [m.n[i * 3], m.n[i * 3 + 1], m.n[i * 3 + 2]], [m.c[i * 3], m.c[i * 3 + 1], m.c[i * 3 + 2]]);
            m.c[i * 3] = c[0]; m.c[i * 3 + 1] = c[1]; m.c[i * 3 + 2] = c[2];
        }
        return m;
    }

    /**
     * Join rings of points into a surface. A ring is { pts: [{p, c}], ctr } or { pole: {p, c}, ctr }.
     * orient: 'auto' (normals away from the spine), 'first' (decide from the first bands only, for
     * lathes that fold back inside themselves), 'in' (towards the spine). Ends are capped unless told not to.
     */
    function loft(rings, o = {}) {
        const m = piece(), out = [];
        const N = rings.find((r) => r.pts).pts.length;
        const jn = o.openLoop ? N - 1 : N;
        for (let i = 0; i < rings.length - 1; i++) {
            const A = rings[i], B = rings[i + 1];
            if (A.pole && B.pole) continue;
            const mid = lerp3(A.ctr, B.ctr, 0.5);
            for (let j = 0; j < jn; j++) {
                const j2 = (j + 1) % N;
                if (A.pole) out.push([A.pole, B.pts[j], B.pts[j2], i, mid]);
                else if (B.pole) out.push([A.pts[j], B.pole, A.pts[j2], i, mid]);
                else {
                    out.push([A.pts[j], B.pts[j], B.pts[j2], i, mid]);
                    out.push([A.pts[j], B.pts[j2], A.pts[j2], i, mid]);
                }
            }
        }
        const mode = o.orient || 'auto', firstBands = o.firstBands || 1;
        let S = 0;
        for (const [a, b, c, i, mid] of out) {
            if (mode === 'first' && i >= firstBands) continue;
            const cen = mul(add(add(a.p, b.p), c.p), 1 / 3);
            S += dot(cross(sub(b.p, a.p), sub(c.p, a.p)), sub(cen, mid));
        }
        let flip = S < 0;
        if (mode === 'in') flip = !flip;
        for (const [a, b, c] of out) {
            if (flip) tri(m, a.p, c.p, b.p, a.c, c.c, b.c); else tri(m, a.p, b.p, c.p, a.c, b.c, c.c);
        }
        const cap = (R, nb, want) => {
            if (!want || R.pole) return;
            const cc = [0, 0, 0], cp = [0, 0, 0];
            for (const q of R.pts) { cc[0] += q.c[0] / N; cc[1] += q.c[1] / N; cc[2] += q.c[2] / N; cp[0] += q.p[0] / N; cp[1] += q.p[1] / N; cp[2] += q.p[2] / N; }
            const dir = sub(R.ctr, nb.ctr);
            for (let j = 0; j < N; j++) {
                const a = R.pts[j], b = R.pts[(j + 1) % N];
                const f = cross(sub(a.p, cp), sub(b.p, cp));
                let outw = dot(f, dir) > 0;
                if (mode === 'in') outw = !outw;
                if (outw) tri(m, cp, a.p, b.p, cc, a.c, b.c); else tri(m, cp, b.p, a.p, cc, b.c, a.c);
            }
        };
        cap(rings[0], rings[1], o.capStart !== false && o.caps !== false);
        cap(rings[rings.length - 1], rings[rings.length - 2], o.capEnd !== false && o.caps !== false);
        return m;
    }

    /**
     * Sweep rings along a spine. spine: [{ p, r | rx, ry, c?, sq? }]; n points per ring.
     * Frame: u is `ref` (default: the axis least aligned with the spine) made perpendicular to the
     * tangent T, v = u × T. A point is ctr + u·cos(a)·rx + v·sin(a)·ry, so for a spine going up +Y,
     * u = +X and v = +Z (a = 90° is the front). With `vAxis`, v is fixed and u = T × vAxis instead.
     * Options: phase, sq (superellipse exponent), prof(a, i) radius multiplier, warp(p, a, i) → p,
     * col(p, a, i) → colour, c (constant colour), T (fixed tangent), orient, caps.
     */
    function tube(spine, n, o = {}) {
        const L = spine.length;
        let ref = o.ref;
        if (!ref && !o.vAxis) {
            const d = norm(sub(spine[L - 1].p, spine[0].p));
            const axes = [[1, 0, 0], [0, 0, 1], [0, 1, 0]];
            let best = 2;
            for (const ax of axes) { const v = Math.abs(dot(ax, d)); if (v < best - 1e-6) { best = v; ref = ax; } }
        }
        const rings = [];
        for (let i = 0; i < L; i++) {
            const s = spine[i], c = s.p;
            const nx = o.loop ? (i + 1) % L : Math.min(i + 1, L - 1), pv = o.loop ? (i - 1 + L) % L : Math.max(i - 1, 0);
            const T = o.T || norm(sub(spine[nx].p, spine[pv].p));
            let u, v;
            if (o.vAxis) { u = norm(cross(T, o.vAxis)); v = cross(u, T); }
            else { u = norm(sub(ref, mul(T, dot(ref, T)))); v = cross(u, T); }
            const rx = s.rx ?? s.r ?? 0, ry = s.ry ?? s.r ?? 0;
            const colAt = (p, a) => (o.col ? o.col(p, a, i, s) : s.c || o.c || [1, 1, 1]);
            if (rx === 0 && ry === 0) {
                const p = o.warp ? o.warp(c.slice(), NaN, i, s) : c;
                rings.push({ pole: { p, c: colAt(p, NaN) }, ctr: c });
                continue;
            }
            const pts = [], sq = s.sq || o.sq || 2;
            for (let j = 0; j < n; j++) {
                const a = (o.phase || 0) + (TAU * j) / n;
                let ca = Math.cos(a), sa = Math.sin(a);
                if (sq !== 2) { ca = Math.sign(ca) * Math.abs(ca) ** (2 / sq); sa = Math.sign(sa) * Math.abs(sa) ** (2 / sq); }
                const k = o.prof ? o.prof(a, i, s) : 1;
                let p = add(c, add(mul(u, ca * rx * k), mul(v, sa * ry * k)));
                if (o.warp) p = o.warp(p, a, i, s);
                pts.push({ p, c: colAt(p, a) });
            }
            rings.push({ pts, ctr: c });
        }
        if (o.loop) rings.push(rings[0]);
        return loft(rings, o.loop ? { ...o, caps: false } : o);
    }
    /** An ellipsoid-ish blob as a tube: rows of latitude along Y. */
    function blob(c, rx, ry, rz, n, rows, o = {}) {
        const sp = [];
        for (let k = 0; k <= rows; k++) {
            const ph = (Math.PI * k) / rows, s = Math.sin(ph);
            sp.push({ p: [c[0], c[1] - Math.cos(ph) * ry, c[2]], rx: k === 0 || k === rows ? 0 : rx * s, ry: k === 0 || k === rows ? 0 : rz * s });
        }
        return tube(sp, n, { T: [0, 1, 0], ref: [1, 0, 0], ...o });
    }
    /** A convex little solid from points and faces, each face turned away from `inside`. */
    function hull(pts, faces, inside, col) {
        const m = piece();
        for (const [a, b, c] of faces) {
            const A = pts[a], B = pts[b], C = pts[c];
            const f = cross(sub(B, A), sub(C, A)), cen = mul(add(add(A, B), C), 1 / 3);
            const ca = col(A), cb = col(B), cc = col(C);
            if (dot(f, sub(cen, inside)) >= 0) tri(m, A, B, C, ca, cb, cc); else tri(m, A, C, B, ca, cc, cb);
        }
        return m;
    }
    /** A grid surface (rows × columns of {p, c} or null for holes). One-sided; use dbl() for cloth. */
    function sheet(grid) {
        const m = piece();
        for (let r = 0; r < grid.length - 1; r++) {
            for (let k = 0; k < grid[r].length - 1; k++) {
                const a = grid[r][k], b = grid[r + 1][k], c = grid[r + 1][k + 1], d = grid[r][k + 1];
                if (a && b && c) tri(m, a.p, b.p, c.p, a.c, b.c, c.c);
                if (a && c && d) tri(m, a.p, c.p, d.p, a.c, c.c, d.c);
                else if (a && b && d && !c) tri(m, a.p, b.p, d.p, a.c, b.c, d.c);
            }
        }
        return m;
    }
    /** Concatenate pieces into one non-indexed BufferGeometry. */
    function geo(list) {
        let n = 0;
        for (const m of list) n += m.p.length;
        const P = new Float32Array(n), N = new Float32Array(n), C = new Float32Array(n);
        let o = 0;
        for (const m of list) {
            if (!m.n) shade(m);
            P.set(m.p, o); N.set(m.n, o);
            for (let i = 0; i < m.c.length; i++) C[o + i] = clamp(m.c[i], 0, 1);
            o += m.p.length;
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(P, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        out.setAttribute('color', new THREE.BufferAttribute(C, 3));
        out.computeBoundingSphere();
        return out;
    }

    // ════════════════════════════ HUMAN ════════════════════════════
    // Vertex colours are multipliers (instance colour × these).
    function buildHuman() {
        const R = prng(101);
        const jit = (c, k = 0.04) => tint(c, 1 + (R() - 0.5) * k);
        // Torso: pelvis to neck base. Rings: [y, rx, rz, zc]. Gambeson quilting alternates ring shades.
        const TOR = [
            [0.775, 0, 0, 0], [0.8, 0.12, 0.085, 0], [0.86, 0.172, 0.118, -0.005], [0.94, 0.178, 0.122, 0],
            [1.0, 0.163, 0.113, 0.005], [1.065, 0.166, 0.116, 0.008], [1.15, 0.186, 0.125, 0.012], [1.25, 0.205, 0.133, 0.016],
            [1.33, 0.222, 0.133, 0.012], [1.4, 0.272, 0.122, 0], [1.455, 0.205, 0.102, -0.008], [1.49, 0.085, 0.07, -0.008]
        ];
        const torso = tube(TOR.map(([y, rx, rz, z]) => ({ p: [0, y, z], rx, ry: rz, sq: y > 1.38 ? 2.2 : 2.6 })), 10, {
            T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2,
            col: (p, a, i) => {
                const y = p[1];
                if (y > 0.99 && y < 1.07) return jit(g(0.42));                       // belt
                if (y >= 1.39) return jit(g(0.74));                                  // leather over the shoulders
                if (y < 0.99) return jit(g(0.72));
                return jit(g(i % 2 ? 0.93 : 0.8));                                   // quilted chest
            }
        });
        // Skirt of the jerkin: flares from the belt to mid-thigh with a few folds, hemmed inside.
        const SK = [[1.0, 0.172, 0.121, 0.006, 0], [0.93, 0.19, 0.134, 0, 0.3], [0.8, 0.212, 0.153, 0, 0.7], [0.695, 0.224, 0.166, 0, 1], [0.712, 0.208, 0.151, 0, 1], [0.86, 0.181, 0.127, 0, 0.5]];
        const skirt = tube(SK.map(([y, rx, rz, z, f]) => ({ p: [0, y, z], rx, ry: rz, f })), 10, {
            T: [0, -1, 0], ref: [1, 0, 0], orient: 'first', capStart: false, phase: 0.3,
            prof: (a, i, s) => 1 + s.f * 0.045 * Math.sin(5 * a),
            col: (p, a, i, s) => {
                if (i >= 4) return g(0.42);
                const fold = Math.sin(5 * a) * s.f;
                return jit(g((i === 3 ? 0.6 : 0.8) + fold * 0.1));
            }
        });
        const buckle = flat(hull([[-0.026, 1.006, 0.118], [0.026, 1.006, 0.118], [0.026, 1.058, 0.12], [-0.026, 1.058, 0.12], [0, 1.032, 0.134]],
            [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [0, 1, 2], [0, 2, 3]], [0, 1.032, 0.1], () => g(0.95)));

        // Head: an ellipsoid warped into skull, jaw, brow and cheeks; hair is a darker, raised cap.
        const HC = [0, 1.635, 0.012], AX = 0.082, AY = 0.118, AZ = 0.098;
        const DYS = [-1, -0.88, -0.68, -0.42, -0.15, 0.1, 0.35, 0.6, 0.82, 0.96, 1];
        const hairy = (dy, dz) => dy > -0.3 + ((dz + 1) / 2) * 0.88;
        const headSp = DYS.map((dy) => { const s = Math.sqrt(Math.max(0, 1 - dy * dy)); return { p: [HC[0], HC[1] + dy * AY, HC[2]], rx: AX * s, ry: AZ * s, dy }; });
        const head = tube(headSp, 10, {
            T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2,
            warp: (p, a, i, s) => {
                const dy = s.dy, dx = p[0] / AX, dz = (p[2] - HC[2]) / AZ;
                const low = clamp((-dy - 0.05) / 0.95, 0, 1);
                let x = p[0] * (1 - 0.24 * low), z = p[2];
                if (dz < 0) z = HC[2] + (z - HC[2]) * (1 - 0.5 * low) - 0.012 * Math.max(0, dy) * -dz;
                else z += 0.016 * low * dz - 0.006 * Math.max(0, dz - 0.5);
                if (dz > 0.6 && dy > 0.3 && dy < 0.4) z += 0.009;                    // brow ridge
                if (dz > 0.6 && Math.abs(dx) > 0.3 && dy > 0 && dy < 0.2) z -= 0.008; // eye hollows
                if (dz > 0.4 && Math.abs(dx) > 0.55 && dy < 0 && dy > -0.3) x *= 1.04; // cheekbones
                let q = [x, p[1], z];
                if (!Number.isNaN(a) && hairy(dy, dz)) q = add(q, mul(norm(sub(q, HC)), 0.007));
                return q;
            },
            col: (p, a, i, s) => {
                const dy = s.dy, dz = (p[2] - HC[2]) / AZ, dx = p[0] / AX;
                if (Number.isNaN(a)) return dy > 0 ? g(0.4) : g(0.8);
                if (hairy(dy, dz)) return jit(g(0.4), 0.1);
                if (dz > 0.6 && Math.abs(dx) > 0.3 && dy > 0 && dy < 0.2) return g(0.66);
                if (dz > 0.7 && dy > -0.5 && dy < -0.35) return g(0.78);              // mouth
                if (dy < -0.8) return g(0.82);
                return jit(g(0.95), 0.05);
            }
        });
        const nose = flat(hull([[0, 1.648, 0.106], [0, 1.606, 0.13], [-0.017, 1.598, 0.104], [0.017, 1.598, 0.104], [0, 1.596, 0.113]],
            [[0, 2, 1], [0, 1, 3], [2, 4, 1], [4, 3, 1]], [0, 1.615, 0.09], () => g(0.92)));
        const ear = (sx) => tube([
            { p: [sx * 0.081, 1.66, -0.006], r: 0 }, { p: [sx * 0.083, 1.645, -0.008], rx: 0.011, ry: 0.02 },
            { p: [sx * 0.082, 1.612, -0.004], rx: 0.011, ry: 0.016 }, { p: [sx * 0.078, 1.592, 0], r: 0 }
        ], 4, { ref: [1, 0, 0], T: [0, 1, 0], c: g(0.85) });
        const neck = tube([{ p: [0, 1.462, -0.012], rx: 0.062, ry: 0.058 }, { p: [0, 1.53, -0.008], rx: 0.058, ry: 0.055 }, { p: [0, 1.6, -0.004], rx: 0.055, ry: 0.052 }], 6, {
            T: [0, 1, 0], ref: [1, 0, 0], col: (p) => g(p[1] < 1.5 ? 0.78 : 0.86)
        });

        // Limbs: rounded at both ends so the joints never open, whatever the swing.
        const limb = (rows, n, col) => tube(rows.map(([y, rx, rz, z = 0]) => ({ p: [0, y, z], rx, ry: rz })), n, { T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2, col });
        const upperArm = limb([[0.085, 0, 0], [0.05, 0.058, 0.06], [0, 0.07, 0.07], [-0.08, 0.064, 0.066], [-0.19, 0.054, 0.056], [-0.29, 0.047, 0.05], [-0.33, 0, 0]], 7,
            (p) => jit(g(p[1] > 0.02 ? 0.74 : p[1] < -0.26 ? 0.72 : 0.85)));
        const foreArm = [
            limb([[0.06, 0, 0], [0.035, 0.05, 0.052], [0, 0.054, 0.056], [-0.07, 0.05, 0.052], [-0.16, 0.043, 0.042], [-0.235, 0.034, 0.033], [-0.265, 0, 0]], 7,
                (p) => jit(g(p[1] > -0.05 ? 0.84 : p[1] > -0.23 ? 0.55 : 0.88))),
            // Closed fist, knuckles forward.
            tube([{ p: [0, -0.247, 0.002], r: 0 }, { p: [0, -0.262, 0.004], rx: 0.036, ry: 0.044 }, { p: [0, -0.3, 0.008], rx: 0.042, ry: 0.052 },
                { p: [0, -0.338, 0.006], rx: 0.035, ry: 0.044 }, { p: [0, -0.35, 0.004], r: 0 }], 6, {
                T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2, sq: 2.6,
                col: (p) => jit(g(p[2] > 0.04 ? 0.82 : 0.93))
            })
        ];
        const thigh = limb([[0.09, 0, 0], [0.06, 0.072, 0.075], [0, 0.088, 0.093], [-0.13, 0.085, 0.09, 0.006], [-0.39, 0.063, 0.065], [-0.46, 0, 0]], 7,
            (p) => jit(g(p[1] < -0.36 ? 0.74 : 0.82)));
        const shin = [
            limb([[0.065, 0, 0], [0.035, 0.059, 0.062], [-0.11, 0.063, 0.07, -0.012], [-0.17, 0.073, 0.08, -0.006], [-0.29, 0.056, 0.06, -0.002], [-0.37, 0.05, 0.054], [-0.405, 0.04, 0.044]], 7,
                (p) => jit(g(p[1] > -0.16 ? 0.8 : 0.47))),
            // Boot foot along +Z, sole flattened at y = -0.43.
            tube([{ p: [0, -0.385, -0.078], r: 0 }, { p: [0, -0.39, -0.06], rx: 0.045, ry: 0.043 }, { p: [0, -0.392, 0.0], rx: 0.05, ry: 0.042 },
                { p: [0, -0.404, 0.09], rx: 0.048, ry: 0.029 }, { p: [0, -0.412, 0.16], rx: 0.034, ry: 0.02 }, { p: [0, -0.418, 0.186], r: 0 }], 7, {
                ref: [1, 0, 0], phase: -Math.PI / 2,
                warp: (p) => [p[0], Math.max(p[1], -0.43), p[2]],
                col: (p) => g(p[1] < -0.425 ? 0.3 : 0.47)
            })
        ];
        return {
            torso: geo([torso, skirt, buckle]),
            head: geo([head, nose, ear(1), ear(-1), neck]),
            upperArm: geo([upperArm]), foreArm: geo(foreArm), thigh: geo([thigh]), shin: geo(shin)
        };
    }

    // ════════════════════════════ WIGHT ════════════════════════════
    function buildWight() {
        const R = prng(202);
        const jit = (c, k = 0.06) => tint(c, 1 + (R() - 0.5) * k);
        // Torso along a stooped spine: pelvis upright, chest leaning forward to the shoulders at z 0.08.
        const W = [
            [0.78, 0, 0, 0, 'p'], [0.81, 0, 0.11, 0.075, 'p'], [0.87, 0, 0.155, 0.1, 'p'], [0.93, 0.005, 0.148, 0.094, 'p'],
            [0.99, 0.016, 0.1, 0.068, 'b'], [1.05, 0.026, 0.118, 0.08, 'b']
        ];
        for (let k = 0; k < 8; k++) {
            const t = k / 7;
            W.push([1.09 + t * 0.235, 0.03 + t * 0.045, lerp(0.15, 0.185, t), lerp(0.11, 0.116, t), k % 2 ? 'g' : 'r']);
        }
        W.push([1.365, 0.08, 0.245, 0.1, 's'], [1.405, 0.09, 0.185, 0.084, 's'], [1.432, 0.102, 0.07, 0.055, 's']);
        const torso = tube(W.map(([y, z, rx, rz, k]) => ({ p: [0, y, z], rx, ry: rz, k })), 10, {
            ref: [1, 0, 0], phase: Math.PI / 2, sq: 2.3,
            warp: (p, a, i, s) => {
                // Ribs run down from the spine towards the breastbone.
                if ((s.k === 'g' || s.k === 'r') && !Number.isNaN(a)) p[1] -= 0.03 * (Math.sin(a) + 1) / 2;
                return p;
            },
            prof: (a, i, s) => {
                const front = Math.sin(a);
                if (s.k === 'g') return front > 0.97 ? 0.97 : front > -0.6 ? 0.92 : 1;  // the gaps between ribs, not over the breastbone
                if (s.k === 'r' && front < -0.95) return 1.09;                       // spine knobs
                if (s.k === 'b' && front > 0.5) return 0.88;                         // sunken belly
                return 1;
            },
            col: (p, a, i, s) => {
                if (Number.isNaN(a)) return g(0.7);
                const front = Math.sin(a);
                if (s.k === 'g') return front > 0.97 ? g(0.75) : front > -0.6 ? g(0.55) : g(0.8);
                if (s.k === 'b') return jit(g(0.72));
                if (s.k === 'r') return jit(g(front < -0.95 ? 1 : 0.94));
                return jit(g(0.86));
            }
        });
        // Rags: tattered strips from a cord around the hips, and a torn shawl over the right shoulder.
        const rags = piece();
        const NS = 7;
        for (let k = 0; k < NS; k++) {
            const a0 = (k / NS) * TAU + R.range(-0.12, 0.12), a1 = a0 + TAU / NS * R.range(0.65, 0.95);
            const L = R.range(0.2, 0.36), shade = R.range(0.55, 0.72);
            const pt = (a, t, w) => {
                const rr = 1.05 + t * 0.35;
                return { p: [Math.cos(a) * 0.152 * rr, 0.955 - t * L, Math.sin(a) * 0.1 * rr + 0.004], c: g(shade * (1 - t * 0.25)) };
            };
            const am = (a0 + a1) / 2;
            const grid = [[pt(a0, 0), pt(a1, 0)], [pt(a0, 0.45), pt(a1, 0.45)], [pt(a0 + 0.08, 0.8), pt(a1 - 0.06, 0.75)], [pt(am, 1), null]];
            const m = sheet(grid);
            rags.p.push(...m.p); rags.c.push(...m.c);
        }
        shade(rags); dbl(rags);
        const shawlPath = [[0.13, 1.18, 0.17], [0.2, 1.33, 0.15], [0.22, 1.43, 0.06], [0.2, 1.36, -0.05], [0.17, 1.17, -0.09], [0.15, 0.98, -0.1]];
        const shawlGrid = [[], []];
        shawlPath.forEach((q, i) => {
            const w = 0.065 - i * 0.004, sx = [0.06, 0.07, 0.08, 0.08, 0.07, 0.05][i];
            shawlGrid[0].push({ p: [q[0] - sx, q[1] - (i === 2 ? 0 : 0.01), q[2]], c: g(0.6) });
            shawlGrid[1].push({ p: [q[0] + w, q[1] - 0.02 - (i > 3 ? 0.06 * (i - 3) : 0), q[2]], c: g(0.5) });
        });
        const shawl = dbl(shade(sheet(shawlGrid)));

        // Skull: high cranium, face pushed forward, cheeks sunken, eye sockets at (±0.045, 1.57, 0.33).
        // Ring i and column j pick the features: column 0 is the front, 1 and 11 are the eye columns.
        const HC = [0, 1.55, 0.23], AX = 0.082, AY = 0.108, AZ = 0.1;
        const DYS = [-1, -0.86, -0.66, -0.45, -0.22, 0, 0.17, 0.33, 0.52, 0.72, 0.9, 1];
        const col12 = (a) => ((Math.round(((a - Math.PI / 2) / TAU) * 12) % 12) + 12) % 12;
        const skull = tube(DYS.map((dy) => { const s = Math.sqrt(Math.max(0, 1 - dy * dy)); return { p: [HC[0], HC[1] + dy * AY, HC[2]], rx: AX * s, ry: AZ * s, dy }; }), 12, {
            T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2,
            warp: (p, a, i, s) => {
                if (Number.isNaN(a)) return p;
                const dy = s.dy, dz = (p[2] - HC[2]) / AZ, j = col12(a);
                const eye = j === 1 || j === 11, mid = j === 0, cheek = j === 2 || j === 10;
                const low = clamp((-dy - 0.05) / 0.95, 0, 1);
                let x = p[0] * (1 - 0.25 * low), z = p[2];
                if (dz > 0) z += (i <= 2 ? 0.012 : 0.024) * dz;
                else z = HC[2] + (z - HC[2]) * (1 - 0.45 * low) - 0.015 * Math.max(0, dy) * -dz;
                if (i <= 3 && dz > -0.2) x *= 0.78;                                  // narrow upper jaw
                if (i === 4 && (eye || cheek)) x *= 0.82;                            // hollow cheeks
                if ((i === 6 || i === 7 || i === 8) && (j === 3 || j === 9)) x *= 0.93; // temples
                if (i === 6 && eye) z -= 0.022;                                      // eye sockets
                if ((i === 5 || i === 7) && eye) z -= 0.008;
                if (i === 4 && mid) z -= 0.02;                                       // nose hole
                if (i === 7 && (eye || mid)) z += 0.006;                             // brow
                return [x, p[1], z];
            },
            col: (p, a, i, s) => {
                if (Number.isNaN(a)) return s.dy < 0 ? g(0.2) : g(0.85);
                const j = col12(a), eye = j === 1 || j === 11, mid = j === 0, dz = (p[2] - HC[2]) / AZ;
                if (i === 6 && eye) return g(0.1);
                if ((i === 5 || i === 7) && eye) return g(0.45);
                if (i === 4 && mid) return g(0.15);
                if (i === 5 && mid) return g(0.6);
                if (i === 2 && dz > 0.5) return g(1);                                // upper teeth
                if (i === 1) return dz > 0.2 ? g(0.2) : g(0.6);                      // the open mouth
                if (i === 4 && (eye || j === 2 || j === 10)) return g(0.6);
                return jit(g(0.9));
            }
        });
        // The lower jaw hangs open: a U of bone from the hinges to the chin.
        const jaw = tube([[-0.062, 1.512, 0.205], [-0.052, 1.458, 0.255], [0, 1.436, 0.3], [0.052, 1.458, 0.255], [0.062, 1.512, 0.205]].map((p, i) => ({ p, rx: 0.009, ry: i === 2 ? 0.022 : 0.019 })), 4, {
            vAxis: [0, 1, 0], phase: Math.PI / 4, col: (p) => g(p[1] > 1.45 && p[2] > 0.24 ? 0.98 : 0.8)
        });
        const neck = tube([{ p: [0, 1.38, 0.082], r: 0.034 }, { p: [0, 1.43, 0.112], r: 0.028 }, { p: [0, 1.47, 0.15], r: 0.033 }, { p: [0, 1.515, 0.19], r: 0.03 }], 6, {
            ref: [1, 0, 0], col: (p, a, i) => g(i % 2 ? 0.7 : 0.85)
        });

        const limb = (rows, n, col) => tube(rows.map(([y, rx, rz, z = 0]) => ({ p: [0, y, z], rx, ry: rz })), n, { T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2, col });
        const upperArm = limb([[0.06, 0, 0], [0.03, 0.045, 0.045], [-0.03, 0.04, 0.042], [-0.27, 0.031, 0.033], [-0.315, 0.038, 0.04], [-0.34, 0, 0]], 6, (p) => jit(g(p[1] < -0.27 ? 0.8 : 0.9)));
        // Forearm, then a long clawed hand: palm at (0, -0.30, 0), five hooked fingers.
        const fa = limb([[0.045, 0, 0], [0.02, 0.04, 0.042], [-0.05, 0.034, 0.036], [-0.24, 0.024, 0.027], [-0.27, 0, 0]], 6, (p) => jit(g(p[1] > 0 ? 0.8 : 0.9)));
        const palm = blob([0, -0.295, 0.004], 0.018, 0.042, 0.032, 5, 4, { col: () => g(0.86) });
        const claws = [];
        for (const [x, z, l] of [[-0.012, 0.024, 0.085], [-0.004, 0.012, 0.095], [0.004, -0.002, 0.09], [0.011, -0.016, 0.075], [-0.012, 0.03, 0.05]]) {
            const thumb = l < 0.06;
            const b = [x, -0.315, z * 0.7], m = [x * 1.3, -0.315 - l * 0.55, z + (thumb ? 0.02 : 0.012)], t = [x * 1.4, -0.315 - l, z + (thumb ? 0.035 : 0.04)];
            claws.push(tube([{ p: b, r: 0.0085 }, { p: m, r: 0.0065 }, { p: t, r: 0 }], 3, { c: g(0.8), col: (p, a, i) => g(i === 2 ? 0.45 : 0.8) }));
        }
        const thigh = limb([[0.075, 0, 0], [0.05, 0.06, 0.062], [-0.05, 0.056, 0.06], [-0.37, 0.04, 0.042], [-0.41, 0.048, 0.05], [-0.455, 0, 0]], 6,
            (p) => jit(g(p[1] > -0.1 ? 0.62 : 0.88)));
        const shin = [
            limb([[0.05, 0, 0], [0.025, 0.046, 0.05], [-0.04, 0.041, 0.046, -0.006], [-0.12, 0.04, 0.046, -0.012], [-0.32, 0.027, 0.03], [-0.37, 0.032, 0.034], [-0.395, 0.03, 0.03]], 6,
                (p, a, i) => jit(g(i === 1 || i === 5 ? 0.95 : 0.84))),
            tube([{ p: [0, -0.395, -0.06], r: 0 }, { p: [0, -0.4, -0.045], rx: 0.03, ry: 0.03 }, { p: [0, -0.405, 0.04], rx: 0.036, ry: 0.024 },
                { p: [0, -0.415, 0.13], rx: 0.04, ry: 0.014 }, { p: [0, -0.418, 0.165], r: 0 }], 6, {
                ref: [1, 0, 0], phase: -Math.PI / 2,
                warp: (p) => [p[0], Math.max(p[1], -0.43), p[2]],
                col: (p) => g(p[2] > 0.11 ? 0.65 : 0.85)
            })
        ];
        return {
            torso: geo([torso, rags, shawl]),
            head: geo([skull, jaw, neck]),
            upperArm: geo([upperArm]), foreArm: geo([fa, palm, ...claws]), thigh: geo([thigh]), shin: geo(shin)
        };
    }

    // ════════════════════════════ GEAR ════════════════════════════
    // Vertex colours are the albedo (white material). Muted mid-tones, linear values.
    const STEEL = [0.32, 0.34, 0.37], STEEL_HI = [0.46, 0.48, 0.52], OAK = [0.2, 0.12, 0.065], LEATHER = [0.11, 0.07, 0.045], IRON = [0.09, 0.09, 0.1];
    function buildGear() {
        const R = prng(303);
        const out = {};
        // Spear: ash shaft along +Z through the fist, iron butt, leaf-shaped head.
        {
            const y = -0.3;
            const shaft = tube([[-0.53, 0], [-0.5, 0.019], [-0.42, 0.017], [1.9, 0.016], [1.93, 0.021], [2.0, 0.014]].map(([z, r]) => ({ p: [0, y, z], r })), 6, {
                ref: [1, 0, 0], col: (p) => (p[2] < -0.41 || p[2] > 1.92 ? IRON : Math.abs(p[2]) < 0.1 ? LEATHER : tint(OAK, 1.15))
            });
            const head = flat(tube([[1.985, 0.012], [2.06, 0.031], [2.13, 0.036], [2.25, 0.022], [2.37, 0]].map(([z, r]) => ({ p: [0, y, z], rx: r, ry: 0.007 + r * 0.12 })), 4, {
                ref: [1, 0, 0], col: (p, a) => (Number.isNaN(a) || Math.abs(Math.cos(a)) > 0.5 ? STEEL_HI : STEEL)
            }));
            out.spear = geo([shaft, head]);
        }
        // Grip shared by the swords: pommel, wrapped grip through the fist.
        const grip = (pommelCol, gripCol) => [
            blob([0, -0.222, 0], 0.022, 0.017, 0.022, 6, 3, { c: pommelCol }),
            tube([-0.232, -0.26, -0.3, -0.34, -0.37].map((y, i) => ({ p: [0, y, 0], rx: 0.016, ry: 0.014 })), 6, {
                T: [0, -1, 0], ref: [1, 0, 0], col: (p, a, i) => tint(gripCol, i % 2 ? 0.8 : 1.1)
            })
        ];
        // Longsword: crossguard along X, blade 0.9 m down -Y with its flat facing ±Z.
        {
            const guard = tube([[-0.105, -0.388], [-0.06, -0.376], [0, -0.372], [0.06, -0.376], [0.105, -0.388]].map(([x, y]) => ({ p: [x, y, 0], rx: 0.011, ry: 0.014 })), 5, {
                vAxis: [0, 0, 1], c: IRON
            });
            const blade = flat(tube([[-0.378, 0.03], [-0.5, 0.0275], [-1.0, 0.022], [-1.19, 0.015], [-1.28, 0]].map(([y, r]) => ({ p: [0, y, 0], rx: r, ry: 0.0055 })), 4, {
                T: [0, -1, 0], ref: [1, 0, 0], col: (p, a) => (Number.isNaN(a) || Math.abs(Math.cos(a)) > 0.5 ? STEEL_HI : STEEL)
            }));
            out.sword = geo([...grip(IRON, LEATHER), guard, blade]);
        }
        // Arakh: a Dothraki sickle-sword curving forward (+Z) towards the tip, flat facing ±X.
        {
            const ring = tube([{ p: [0, -0.37, 0], r: 0.03 }, { p: [0, -0.384, 0], r: 0.03 }], 8, { T: [0, -1, 0], ref: [1, 0, 0], c: tint(IRON, 1.3), sq: 2 });
            const C = [[0, -0.384, 0], [0, -0.62, -0.012], [0, -0.86, 0.02], [0, -1.05, 0.1], [0, -1.19, 0.23], [0, -1.265, 0.37], [0, -1.3, 0.45]];
            const W = [0.018, 0.026, 0.034, 0.043, 0.042, 0.026, 0];
            const spine = C.map((p, i) => ({ p, rx: W[i], ry: W[i] ? 0.006 : 0 }));
            const blade = flat(tube(spine, 4, {
                vAxis: [1, 0, 0],
                warp: (p, a, i) => {
                    // Push the belly out on the convex side (away from the curve's centre, i.e. back/down).
                    if (Number.isNaN(a) || Math.cos(a) > -0.5) return p;
                    const k = W[i] * 0.35;
                    const T = norm(sub(C[Math.min(i + 1, 6)], C[Math.max(i - 1, 0)])), u = norm(cross(T, [1, 0, 0]));
                    return add(p, mul(u, -k));
                },
                col: (p, a) => (Number.isNaN(a) || Math.abs(Math.cos(a)) > 0.5 ? STEEL_HI : STEEL)
            }));
            out.arakh = geo([...grip(tint(STEEL, 0.8), LEATHER), ring, blade]);
        }
        // Ice sword: a jagged crystal blade 1.1 m long, pale blue-white.
        {
            const ICE = [0.55, 0.72, 0.85], ICE_HI = [0.78, 0.88, 0.95], ICE_DK = [0.3, 0.42, 0.55];
            const RI = prng(304);
            const ys = [-0.36, -0.42, -0.55, -0.7, -0.84, -0.98, -1.12, -1.26, -1.38, -1.46];
            const jag = ys.map(() => [0, 1, 2, 3, 4].map(() => RI.range(0.75, 1.25)));
            const blade = flat(tube(ys.map((y, i) => ({ p: [RI.range(-0.004, 0.004), y, 0], rx: i === ys.length - 1 ? 0 : lerp(0.038, 0.018, i / 8) * (i === 0 ? 0.7 : 1), ry: i === ys.length - 1 ? 0 : 0.012 })), 5, {
                T: [0, -1, 0], ref: [1, 0, 0], phase: 0.2,
                prof: (a, i) => jag[i][Math.round(((a - 0.2) / TAU) * 5) % 5],
                col: (p, a) => (Number.isNaN(a) ? ICE_HI : Math.abs(Math.cos(a)) > 0.7 ? ICE_HI : mixc(ICE, ICE_HI, RI() * 0.5))
            }));
            const gripI = tube([-0.215, -0.25, -0.3, -0.35, -0.365].map((y, i) => ({ p: [0, y, 0], r: i === 0 ? 0 : 0.017 })), 5, { T: [0, -1, 0], ref: [1, 0, 0], col: (p, a, i) => (i % 2 ? ICE_DK : tint(ICE_DK, 1.3)) });
            const shard = (base, dir, l, w) => {
                const d = norm(dir), s = norm(cross(d, [0, 0, 1])), t = cross(s, d);
                const P = [add(base, mul(s, w)), add(base, mul(t, w)), add(base, mul(s, -w)), add(base, mul(t, -w)), add(base, mul(d, l))];
                return flat(hull(P, [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [0, 1, 2], [0, 2, 3]], base, (q) => (q === P[4] ? ICE_HI : ICE)));
            };
            const shards = [
                shard([0.02, -0.37, 0], [1, 0.5, 0], 0.07, 0.012), shard([-0.02, -0.37, 0], [-1, 0.6, 0], 0.08, 0.012),
                shard([0.024, -0.62, 0], [1, -1.2, 0], 0.07, 0.01), shard([-0.022, -0.83, 0], [-1, -1.4, 0], 0.06, 0.009),
                shard([0.02, -1.04, 0], [1, -1.6, 0], 0.055, 0.008), shard([0, -0.37, 0.012], [0, 0.4, 1], 0.04, 0.01)
            ];
            out.iceBlade = geo([blade, gripI, ...shards]);
        }
        // Round shield, face +Z, centred at (0, -0.15, 0.1): planks, iron rim and boss.
        {
            const cx = 0, cy = -0.15;
            const prof = [[0.058, 0], [0.06, 0.325], [0.07, 0.342], [0.086, 0.338], [0.091, 0.31], [0.106, 0.105], [0.112, 0.085], [0.135, 0.068], [0.15, 0.032], [0.153, 0]];
            const RS = prng(305);
            const plank = [0, 1, 2, 3, 4, 5, 6].map(() => RS.range(0.8, 1.15));
            const shieldG = tube(prof.map(([z, r]) => ({ p: [cx, cy, z], r })), 13, {
                T: [0, 0, 1], ref: [1, 0, 0],
                col: (p, a, i) => {
                    if (i <= 1 || i === 3 || i === 2) return i === 0 ? tint(OAK, 0.6) : tint(IRON, 1.4);
                    if (i >= 6) return tint(IRON, i === 6 ? 1.2 : 1.7);
                    const k = plank[clamp(Math.floor((p[0] + 0.34) / 0.1), 0, 6)];
                    return tint([0.24, 0.16, 0.09], k);
                }
            });
            // A leather strap behind, across the forearm.
            const strap = tube([[-0.07, 0.058], [-0.05, 0.02], [0, -0.002], [0.05, 0.02], [0.07, 0.058]].map(([x, z]) => ({ p: [x, -0.2, z], rx: 0.004, ry: 0.025 })), 4, { vAxis: [0, 1, 0], c: LEATHER });
            out.shield = geo([shieldG, strap]);
        }

        // Helm (root space, fits human.head): a bronze-dark cap with cheek guards, a lip and a short spike.
        {
            const BR = [0.2, 0.15, 0.09];
            const C = [0, 1.642, 0.006], ax = 0.097, ay = 0.13, az = 0.114, n = 14, K = 6;
            const edge = (a) => { const dz = Math.sin(a); return dz > 0.62 ? 0.3 : dz > -0.25 ? -0.58 : -0.22; };
            const ptAt = (a, dy) => { const s = Math.sqrt(Math.max(0, 1 - dy * dy)); return [C[0] + Math.cos(a) * s * ax, C[1] + dy * ay, C[2] + Math.sin(a) * s * az * (dy < 0 && Math.sin(a) < 0 ? 0.92 : 1)]; };
            const rings = [{ pole: { p: [C[0], C[1] + ay, C[2]], c: tint(BR, 1.2) }, ctr: [C[0], C[1] + ay, C[2]] }];
            const angs = [...Array(n).keys()].map((j) => Math.PI / 2 + (TAU * j) / n);
            for (let k = 1; k <= K; k++) {
                const t = k / K;
                const pts = angs.map((a) => {
                    const dy = lerp(1, edge(a), t);
                    const p = ptAt(a, dy);
                    const crest = Math.abs(Math.cos(a)) < 0.25 ? 1.25 : 1;
                    return { p, c: tint(BR, k === K ? 0.7 : (k === K - 1 ? 1.15 : 1) * crest) };
                });
                rings.push({ pts, ctr: [C[0], C[1] + lerp(1, -0.2, t) * ay, C[2]] });
            }
            const last = rings[K];
            rings.push({ pts: last.pts.map((q) => ({ p: add(C, mul(sub(q.p, C), 0.9)), c: tint(BR, 0.5) })), ctr: last.ctr });
            const shell = loft(rings, { orient: 'first', caps: false });
            const spike = flat(tube([{ p: [0, 1.76, 0.004], r: 0.022 }, { p: [0, 1.79, 0.004], r: 0.012 }, { p: [0, 1.85, 0.0], r: 0 }], 5, { T: [0, 1, 0], ref: [1, 0, 0], c: tint(BR, 1.3) }));
            out.helm = geo([shell, spike]);
        }
        // Cloak (root space): a fur mantle round the shoulders and a wool cape down the back to y 0.45.
        {
            const RC = prng(306);
            const FUR = [0.13, 0.11, 0.09], WOOL = [0.085, 0.08, 0.085];
            const loop = [];
            const NL = 10;
            for (let k = 0; k < NL; k++) {
                const a = (k / NL) * TAU, s = Math.sin(a);
                loop.push({ p: [Math.cos(a) * 0.255, 1.445 - Math.max(0, s) * 0.035 + (s < 0 ? -0.012 * -s : 0), -0.015 + s * (s > 0 ? 0.13 : 0.15)], rx: 0.064, ry: 0.052 });
            }
            const mantle = tube(loop, 6, {
                ref: [0, 1, 0], loop: true,
                prof: () => RC.range(0.85, 1.15),
                col: () => tint(FUR, RC.range(0.75, 1.25))
            });
            const cols = 6, rows = 5, grid = [];
            for (let r = 0; r <= rows; r++) {
                const t = r / rows, row = [];
                const y = lerp(1.44, 0.45, t);
                for (let k = 0; k <= cols; k++) {
                    const u = k / cols, th = lerp(Math.PI * 1.13, Math.PI * 1.87, u);
                    const fold = Math.sin(u * Math.PI * 5) * 0.03 * t;
                    const rx = lerp(0.21, 0.33, t) + Math.abs(fold), rz = lerp(0.135, 0.29, Math.sqrt(t)) + fold;
                    row.push({ p: [Math.cos(th) * rx, y - (r === rows ? RC.range(0, 0.06) : 0), Math.sin(th) * rz - 0.015], c: tint(WOOL, 1 + fold * 6 - t * 0.15) });
                }
                grid.push(row);
            }
            const cape = dbl(shade(sheet(grid)));
            out.cloak = geo([mantle, cape]);
        }
        // Braid (root space, fits human.head): a hair cap and a long plait down the back.
        {
            const HAIR = [0.05, 0.036, 0.026];
            const C = [0, 1.638, 0.008], ax = 0.091, ay = 0.127, az = 0.106, n = 12, K = 5;
            const edge = (a) => { const dz = Math.sin(a); return dz > 0.55 ? 0.55 : dz > -0.3 ? 0.12 : -0.38; };
            const rings = [{ pole: { p: [C[0], C[1] + ay, C[2]], c: HAIR }, ctr: [C[0], C[1] + ay, C[2]] }];
            const angs = [...Array(n).keys()].map((j) => Math.PI / 2 + (TAU * j) / n);
            for (let k = 1; k <= K; k++) {
                const t = k / K;
                const pts = angs.map((a) => {
                    const dy = lerp(1, edge(a), t), s = Math.sqrt(Math.max(0, 1 - dy * dy));
                    const back = Math.sin(a) < 0 && dy < 0 ? 1 - 0.3 * -dy : 1;
                    return { p: [Math.cos(a) * s * ax, C[1] + dy * ay, C[2] + Math.sin(a) * s * az * back], c: tint(HAIR, 0.85 + (k % 2) * 0.3) };
                });
                rings.push({ pts, ctr: [C[0], C[1] + lerp(1, 0, t) * ay, C[2]] });
            }
            rings.push({ pts: rings[K].pts.map((q) => ({ p: add(C, mul(sub(q.p, C), 0.9)), c: HAIR })), ctr: rings[K].ctr });
            const cap = loft(rings, { orient: 'first', caps: false });
            const B = [];
            for (let k = 0; k <= 9; k++) {
                const t = k / 9;
                B.push({ p: [0.004 * Math.sin(k * 2), lerp(1.6, 1.08, t), lerp(-0.096, -0.165, Math.sqrt(t)) - 0.02 * Math.sin(t * Math.PI)], r: k === 9 ? 0 : lerp(0.03, 0.017, t) * (k % 2 ? 0.8 : 1.1) });
            }
            const plait = tube(B, 5, { ref: [1, 0, 0], col: (p, a, i) => (i === 7 ? [0.16, 0.1, 0.06] : tint(HAIR, i % 2 ? 0.8 : 1.3)) });
            out.braid = geo([cap, plait]);
        }
        // Crown (wight root space): short ice horns growing from the skull centred at (0, 1.55, 0.23).
        {
            const ICE = [0.5, 0.66, 0.8], TIP = [0.75, 0.85, 0.93];
            const C = [0, 1.55, 0.23], list = [];
            const NH = 11;
            for (let k = 0; k < NH; k++) {
                const a = (k / NH) * TAU + 0.3;
                const front = Math.sin(a);
                const dy = 0.52, s = Math.sqrt(1 - dy * dy);
                const base = [Math.cos(a) * s * 0.078, C[1] + dy * 0.108, C[2] + Math.sin(a) * s * 0.1 + (front > 0 ? 0.02 * front : 0)];
                const radial = norm([Math.cos(a), 0, Math.sin(a)]);
                const h = lerp(0.07, 0.17, (1 - front) / 2) * (k % 2 ? 0.8 : 1);
                const d1 = norm(add(mul(radial, 0.45), [0, 1, 0])), d2 = norm(add(mul(radial, 0.15), [0, 1, 0]));
                const mid = add(base, mul(d1, h * 0.5)), tip = add(mid, mul(d2, h * 0.5));
                list.push(flat(tube([{ p: add(base, mul(d1, -0.012)), r: 0.016 }, { p: mid, r: 0.009 }, { p: tip, r: 0 }], 4, { col: (p, aa, i) => (i === 2 ? TIP : ICE) })));
            }
            out.crown = geo(list);
        }
        return out;
    }

    // ════════════════════════════ HORSE ════════════════════════════
    function buildHorse() {
        const R = prng(404);
        const jit = (c, k = 0.05) => tint(c, 1 + (R() - 0.5) * k);
        // Barrel from the rump to the chest along +Z. Frame: u = +X, v = -Y (a = 90° is the belly).
        const BODY = [
            [-0.94, 1.2, 0, 0], [-0.9, 1.26, 0.15, 0.22], [-0.8, 1.29, 0.24, 0.3], [-0.62, 1.3, 0.285, 0.33], [-0.38, 1.28, 0.295, 0.31],
            [-0.1, 1.27, 0.29, 0.3], [0.2, 1.27, 0.288, 0.305], [0.45, 1.27, 0.275, 0.325], [0.64, 1.27, 0.235, 0.32], [0.78, 1.29, 0.17, 0.25], [0.86, 1.31, 0, 0]
        ];
        const body = tube(BODY.map(([z, y, rx, ry]) => ({ p: [0, y, z], rx, ry })), 14, {
            ref: [1, 0, 0], sq: 2.15,
            warp: (p) => {
                // Withers: the back rises a little in front of the saddle; a crease runs down the rump.
                const top = clamp((p[1] - 1.45) / 0.15, 0, 1);
                p[1] += top * 0.05 * smooth(0.15, 0.4, p[2]) * (1 - smooth(0.55, 0.75, p[2]));
                if (p[2] < -0.75 && Math.abs(p[0]) < 0.05 && p[1] > 1.0) p[2] += 0.025;
                return p;
            },
            col: (p) => {
                const belly = p[1] < 1.05 ? 0.82 : 1;
                return jit(g(0.92 * belly * (p[2] > 0.6 && p[1] < 1.2 ? 0.9 : 1)));
            }
        });
        // Neck: deep and narrow, arching up and forward to the poll.
        const neck = tube([
            { p: [0, 1.38, 0.55], rx: 0.16, ry: 0.28 }, { p: [0, 1.62, 0.82], rx: 0.13, ry: 0.22 },
            { p: [0, 1.84, 1.04], rx: 0.1, ry: 0.17 }, { p: [0, 1.97, 1.18], rx: 0.085, ry: 0.13 }, { p: [0, 2.02, 1.24], rx: 0.07, ry: 0.09 }
        ], 10, { ref: [1, 0, 0], col: (p) => jit(g(0.9)) });
        // Head: from the poll down to the muzzle, with a deep jowl.
        const HP = [
            [0, 2.07, 1.19, 0, 0], [0, 2.04, 1.24, 0.075, 0.09], [0, 1.95, 1.3, 0.1, 0.14], [0, 1.83, 1.375, 0.076, 0.095],
            [0, 1.71, 1.445, 0.062, 0.074], [0, 1.61, 1.5, 0.066, 0.07], [0, 1.55, 1.53, 0.052, 0.05], [0, 1.53, 1.545, 0, 0]
        ];
        const headG = tube(HP.map(([x, y, z, rx, ry]) => ({ p: [x, y, z], rx, ry })), 10, {
            ref: [1, 0, 0], phase: 0,
            warp: (p, a, i, s) => {
                // The jowl hangs below and behind the cheek.
                if (i === 2 && !Number.isNaN(a)) {
                    const d = sub(p, s.p), j = norm([0, -0.55, -0.85]), k = dot(d, j) / len(d);
                    if (k > 0) return add(p, mul(j, 0.04 * k));
                }
                return p;
            },
            col: (p, a, i) => {
                if (Number.isNaN(a)) return g(0.5);
                const side = Math.abs(Math.cos(a)), up = -Math.sin(a);
                if ((i === 2 || i === 3) && side > 0.75 && up > 0.3) return i === 2 ? g(0.22) : g(0.6); // eyes
                if (i >= 5) return up < 0.3 && side > 0.75 && i === 5 ? g(0.3) : g(0.66);   // muzzle, nostrils
                return jit(g(0.92));
            }
        });
        const ear = (sx) => flat(tube([{ p: [sx * 0.045, 2.04, 1.2], rx: 0.026, ry: 0.017 }, { p: [sx * 0.056, 2.12, 1.2], rx: 0.021, ry: 0.014 }, { p: [sx * 0.064, 2.2, 1.19], r: 0 }], 4, {
            ref: [1, 0, 0], col: (p, a, i) => g(i === 2 ? 0.6 : 0.85)
        }));
        // Mane along the crest, falling to the right; a forelock; a long tail.
        const crest = [[0, 1.6, 0.4, 0.03, 0.06], [0, 1.82, 0.64, 0.042, 0.08], [0, 1.97, 0.89, 0.038, 0.075], [0, 2.07, 1.07, 0.032, 0.06], [0, 2.1, 1.17, 0.025, 0.04], [0, 2.07, 1.26, 0, 0]];
        const mane = tube(crest.map(([x, y, z, rx, ry]) => ({ p: [x + 0.025, y, z], rx, ry })), 5, {
            ref: [1, 0, 0], prof: (a, i) => (Math.cos(a) > 0.3 ? 1.5 : 1), col: () => tint(g(0.35), R.range(0.8, 1.2))
        });
        const TL = [[0, 1.5, -0.88, 0.05], [0, 1.4, -1.0, 0.05], [0, 1.18, -1.06, 0.065], [0, 0.92, -1.07, 0.07], [0, 0.72, -1.04, 0.06], [0, 0.6, -1.0, 0]];
        const tail = tube(TL.map(([x, y, z, r]) => ({ p: [x, y, z], r })), 6, { ref: [1, 0, 0], col: (p) => g(p[1] > 1.4 ? 0.45 : 0.33), prof: (a, i) => 1 + 0.15 * Math.sin(3 * a + i) });
        const bodyG = geo([body, neck, headG, ear(1), ear(-1), mane, tail]);

        // Leg: gaskin/forearm muscle, knee, slim cannon, fetlock, pastern, dark hoof at y = -0.95.
        const LG = [[0.12, 0, 0, 0], [0.04, 0.085, 0.115, 0], [-0.16, 0.075, 0.095, -0.005], [-0.34, 0.052, 0.062, 0], [-0.45, 0.05, 0.062, 0.006],
            [-0.6, 0.036, 0.045, 0], [-0.79, 0.04, 0.052, -0.012], [-0.865, 0.036, 0.04, 0.008], [-0.88, 0.05, 0.052, 0.014], [-0.95, 0.06, 0.064, 0.022]];
        const leg = tube(LG.map(([y, rx, rz, z]) => ({ p: [0, y, z], rx, ry: rz })), 6, {
            T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2,
            col: (p, a, i) => (i >= 8 ? g(0.28) : i === 7 ? g(0.6) : jit(g(i <= 2 ? 0.92 : 0.82)))
        });
        return { body: bodyG, leg: geo([leg]) };
    }

    // ════════════════════════════ PROPS ════════════════════════════
    function buildProps() {
        const out = {};
        // Brazier: three scrolled iron legs, a brace ring, a round bowl with a rolled lip, coals.
        {
            const R = prng(501);
            const IR = [0.07, 0.068, 0.072];
            const parts = [];
            for (let k = 0; k < 3; k++) {
                const a = (k / 3) * TAU + 0.5, d = [Math.cos(a), 0, Math.sin(a)];
                const P = (r, y) => [d[0] * r, y, d[2] * r];
                parts.push(tube([{ p: P(0.12, 1.02), r: 0.026 }, { p: P(0.2, 0.7), r: 0.024 }, { p: P(0.26, 0.35), r: 0.022 }, { p: P(0.33, 0.08), r: 0.024 }, { p: P(0.42, 0.04), r: 0.02 }, { p: P(0.44, 0.12), r: 0.016 }], 4, {
                    c: IR, phase: Math.PI / 4
                }));
            }
            const brace = [];
            for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; brace.push({ p: [Math.cos(a) * 0.235, 0.52, Math.sin(a) * 0.235], r: 0.014 }); }
            parts.push(tube(brace, 3, { ref: [0, 1, 0], loop: true, c: IR }));
            const BP = [[0.92, 0], [0.94, 0.13], [1.03, 0.3], [1.14, 0.4], [1.22, 0.44], [1.255, 0.448], [1.26, 0.425], [1.22, 0.405], [1.12, 0.33], [1.06, 0.22], [1.04, 0]];
            parts.push(tube(BP.map(([y, r]) => ({ p: [0, y, 0], r })), 12, {
                T: [0, 1, 0], ref: [1, 0, 0], orient: 'first', firstBands: 3,
                col: (p, a, i) => (i >= 7 ? [0.05, 0.04, 0.035] : i === 5 || i === 4 ? tint(IR, 1.6) : tint(IR, R.range(0.9, 1.2)))
            }));
            for (let k = 0; k < 4; k++) {
                const a = R() * TAU, r = R.range(0.05, 0.25);
                parts.push(blob([Math.cos(a) * r, 1.1 + (0.25 - r) * 0.25, Math.sin(a) * r], R.range(0.06, 0.1), R.range(0.03, 0.05), R.range(0.06, 0.09), 4, 3, {
                    col: () => (R() < 0.3 ? [0.35, 0.09, 0.03] : [0.05, 0.04, 0.035])
                }));
            }
            out.brazier = geo(parts);
        }
        // Pines: trunk plus drooping tiers of boughs with jagged tips; snow lies on the upper faces.
        {
            const PINE = [0.035, 0.065, 0.045], PINE_DK = [0.02, 0.038, 0.028], SNOW = [0.6, 0.63, 0.68], BARK = [0.11, 0.075, 0.055];
            out.pines = [[9.5, 7, 601], [8.2, 6, 602], [10, 8, 603]].map(([H, tiers, seed]) => {
                const R = prng(seed);
                const parts = [];
                parts.push(tube([{ p: [0, 0, 0], r: 0.3 }, { p: [0, 2.4, 0], r: 0.2 }, { p: [0, H, 0], r: 0 }], 6, { T: [0, 1, 0], ref: [1, 0, 0], c: BARK }));
                const n = tiers >= 8 ? 10 : 11;
                for (let k = 0; k < tiers; k++) {
                    const t = k / (tiers - 1);
                    const y = lerp(2.0, H - 1.3, Math.pow(t, 0.9));
                    const Rb = lerp(2.7, 0.75, t) * R.range(0.9, 1.1);
                    const droop = Rb * 0.42, apex = y + lerp(1.2, 1.4, t);
                    const ph = R() * TAU;
                    const tips = [...Array(n)].map(() => R.range(0.85, 1.15));
                    const sn = [...Array(n)].map(() => R());
                    const ring = (f, dy, col) => ({
                        pts: [...Array(n).keys()].map((j) => {
                            const a = ph + (TAU * j) / n, rr = Rb * f * (f > 0.9 ? tips[j] : 1);
                            return { p: [Math.cos(a) * rr, y + dy * (f > 0.9 ? tips[j] : 1), Math.sin(a) * rr], c: col(j) };
                        }), ctr: [0, y + dy, 0]
                    });
                    const rings = [
                        { pole: { p: [0, apex, 0], c: SNOW }, ctr: [0, apex, 0] },
                        ring(0.5, 0.15, (j) => (sn[j] < 0.75 ? tint(SNOW, 0.95) : PINE)),
                        ring(1, -droop, (j) => (sn[j] < 0.3 ? tint(SNOW, 0.8) : PINE)),
                        { pole: { p: [0, y - droop * 0.35, 0], c: PINE_DK }, ctr: [0, y - droop * 0.35, 0] }
                    ];
                    parts.push(loft(rings, { orient: 'first' }));
                }
                return geo(parts);
            });
        }
        // Weirwood: pale fluted trunk with flaring roots, a red-carved face on the +Z side, twisting limbs.
        let tips = [];
        {
            const R = prng(701);
            const BONE = [0.62, 0.6, 0.55], GROOVE = [0.38, 0.36, 0.33], RED = [0.3, 0.035, 0.03];
            const rad = (y) => lerp(1.3, 0.8, smooth(0, 7, y) ** 0.8) + 0.7 * Math.exp(-y / 0.35);
            const lobe = (a, y) => {
                const tw = y * 0.35;
                const faceDamp = 1 - 0.85 * Math.exp(-((Math.sin(a) - 1) ** 2) / 0.08) * smooth(2.4, 3.0, y) * (1 - smooth(4.8, 5.4, y));
                const L = (0.16 + 0.45 * Math.exp(-y / 0.6)) * faceDamp;
                return 1 + L * (0.75 * Math.sin(5 * a + tw) + 0.25 * Math.sin(9 * a + 1.3 - tw));
            };
            const sway = (y) => 0.18 * Math.sin(y * 0.55);
            const YS = [0, 0.2, 0.5, 0.9, 1.5, 2.2, 2.8, 3.3, 3.8, 4.3, 4.8, 5.4, 6.0, 6.5, 7.0];
            const trunk = tube(YS.map((y) => ({ p: [sway(y), y, 0], r: rad(y), y })), 16, {
                T: [0, 1, 0], ref: [1, 0, 0], phase: Math.PI / 2, capStart: false,
                prof: (a, i, s) => lobe(a, s.y),
                warp: (p, a, i, s) => (s.y === 0 ? [p[0], -0.05, p[2]] : p),
                col: (p, a, i, s) => {
                    const v = Math.sin(5 * a + s.y * 0.35);
                    return mixc(BONE, GROOVE, (0.5 - v * 0.5) * 0.7 + (R() - 0.5) * 0.15);
                }
            });
            const front = (y) => rad(y) * lobe(Math.PI / 2, y);
            const parts = [trunk];
            // The face: eye hollows, a gaping mouth, red sap weeping from the eyes.
            const carve = (x, y, rx, ry, depth, col = RED) => {
                const z = front(y) - depth;
                return blob([x + sway(y), y, z], rx, ry, Math.max(rx, ry) * 0.55, 8, 4, { c: col });
            };
            parts.push(carve(-0.36, 4.1, 0.24, 0.12, 0.075), carve(0.36, 4.1, 0.24, 0.12, 0.075), carve(0, 3.3, 0.36, 0.15, 0.065));
            parts.push(carve(-0.4, 3.7, 0.05, 0.38, 0.03), carve(0.37, 3.62, 0.045, 0.45, 0.03));
            parts.push(carve(0, 3.72, 0.11, 0.3, 0.06, tint(BONE, 0.9)));                           // nose
            // Limbs: six heavy branches twisting out and up, each with a smaller fork.
            for (let k = 0; k < 6; k++) {
                const a = (k / 6) * TAU + R.range(-0.3, 0.3) + 0.4;
                const d = [Math.cos(a), 0, Math.sin(a)];
                const reach = R.range(3.6, 5.2), top = R.range(8.6, 10.2);
                const base = [sway(6.5) + d[0] * 0.35, R.range(5.6, 6.6), d[2] * 0.35];
                const pts = [];
                const NP = 6;
                for (let i = 0; i <= NP; i++) {
                    const t = i / NP;
                    const r = reach * (1 - (1 - t) ** 1.6);
                    const wob = Math.sin(t * 5 + k) * 0.35 * t;
                    pts.push({
                        p: [base[0] + d[0] * r - d[2] * wob, lerp(base[1], top, t ** 0.75) + Math.sin(t * 7 + k) * 0.2 * t, base[2] + d[2] * r + d[0] * wob],
                        r: i === NP ? 0 : lerp(0.48, 0.09, t ** 0.8)
                    });
                }
                parts.push(tube(pts, 7, { col: () => mixc(BONE, GROOVE, R() * 0.4) }));
                tips.push(pts[NP].p, pts[3].p);
                const fb = pts[3].p, fa = a + (k % 2 ? 0.9 : -0.9), fd = [Math.cos(fa), 0, Math.sin(fa)];
                const fork = [{ p: fb, r: 0.16 }, { p: add(fb, [fd[0] * 0.9, 0.7, fd[2] * 0.9]), r: 0.1 }, { p: add(fb, [fd[0] * 1.8, 1.1, fd[2] * 1.8]), r: 0.05 }, { p: add(fb, [fd[0] * 2.4, 1.5, fd[2] * 2.4]), r: 0 }];
                parts.push(tube(fork, 4, { col: () => mixc(BONE, GROOVE, R() * 0.4) }));
                tips.push(fork[3].p);
            }
            out.weirwood = geo(parts);
        }
        // Weirwood canopy: lumpy clusters of dark red leaves around the branch tips, 8–11 m up.
        {
            const R = prng(702);
            const LEAF = [0.36, 0.05, 0.04], LEAF_HI = [0.52, 0.09, 0.05], LEAF_DK = [0.17, 0.025, 0.02];
            const ico = new THREE.IcosahedronGeometry(1, 1).attributes.position.array;
            const centres = [[0, 9.8, 0, 3.0, 1.6]];
            const picks = tips.filter((_, i) => i % 3 === 0);
            for (const p of picks) centres.push([p[0] * 0.85, clamp(p[1], 9.2, 9.8), p[2] * 0.85, R.range(2.0, 2.4), R.range(1.3, 1.6)]);
            const parts = [];
            for (const [cx, cy, cz, r, ry] of centres) {
                const m = piece(), seen = new Map();
                const disp = (x, y, z) => {
                    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
                    if (!seen.has(key)) seen.set(key, R.range(0.78, 1.18));
                    const k = seen.get(key);
                    return [cx + x * r * k, cy + y * ry * k * (y < 0 ? 0.8 : 1), cz + z * r * k];
                };
                for (let i = 0; i < ico.length; i += 9) {
                    const P = [0, 1, 2].map((v) => disp(ico[i + v * 3], ico[i + v * 3 + 1], ico[i + v * 3 + 2]));
                    const Cs = P.map((q) => (q[1] < cy - ry * 0.4 ? LEAF_DK : mixc(LEAF, LEAF_HI, R())));
                    tri(m, P[0], P[1], P[2], Cs[0], Cs[1], Cs[2]);
                }
                parts.push(flat(m));
            }
            out.weirwoodLeaves = geo(parts);
        }
        // Barricade: a log across X with sharpened stakes crossed through it.
        {
            const R = prng(801);
            const WOOD = [0.16, 0.11, 0.07], RAW = [0.42, 0.33, 0.22];
            const parts = [];
            const yc = 0.64;
            parts.push(tube([-1.55, -1.0, -0.3, 0.4, 1.0, 1.55].map((x, i) => ({ p: [x, yc + Math.sin(i) * 0.02, 0], r: 0.15 - Math.abs(x) * 0.012 })), 8, {
                ref: [0, 1, 0], col: () => tint(WOOD, R.range(0.85, 1.15))
            }));
            const stake = (x, ang, l) => {
                // Through the log's axis, lower tip on the ground.
                const d = [0, Math.cos(ang), Math.sin(ang)], t = yc / d[1];
                const A = [x, 0, -d[2] * t], B = [x, d[1] * (l - t), d[2] * (l - t)];
                const P = (t) => lerp3(A, B, t);
                return flat(tube([{ p: P(0), r: 0 }, { p: P(0.1), r: 0.05 }, { p: P(0.82), r: 0.052 }, { p: P(1), r: 0 }], 5, {
                    ref: [1, 0, 0], col: (p, a, i) => (i === 3 || i === 0 ? RAW : tint(WOOD, R.range(0.9, 1.2)))
                }));
            };
            for (const x of [-1.25, -0.62, 0, 0.62, 1.25]) {
                const j = R.range(-0.08, 0.08);
                parts.push(stake(x - 0.06, 0.78 + j, 2.5), stake(x + 0.06, -0.78 + j, 2.5));
            }
            out.barricade = geo(parts);
        }
        // Dead tree: a crooked bare trunk with forking limbs and twigs.
        {
            const R = prng(901);
            const BARK = [0.15, 0.13, 0.115], PALE = [0.3, 0.28, 0.25];
            const parts = [];
            const col = (p, a, i) => mixc(BARK, PALE, R() * 0.35);
            const T = [[0, 0, 0, 0.32], [0.05, 0.4, 0.02, 0.24], [0.1, 1.2, 0.05, 0.2], [0.02, 2.0, 0.12, 0.17], [-0.1, 2.7, 0.08, 0.14], [-0.05, 3.3, 0.02, 0.11]];
            parts.push(tube(T.map(([x, y, z, r]) => ({ p: [x, y, z], r, y })), 7, {
                T: [0, 1, 0], ref: [1, 0, 0], capStart: false,
                prof: (a, i, s) => 1 + 0.35 * Math.exp(-s.y / 0.3) * Math.sin(4 * a + 0.6), col
            }));
            const branch = (from, dir, l, r0, segs, n) => {
                const pts = [];
                let p = from, d = norm(dir);
                for (let i = 0; i <= segs; i++) {
                    pts.push({ p, r: i === segs ? 0 : r0 * (1 - i / segs * 0.85) });
                    d = norm(add(d, [R.range(-0.35, 0.35), R.range(0, 0.25), R.range(-0.35, 0.35)]));
                    p = add(p, mul(d, l / segs));
                }
                parts.push(tube(pts, n, { col }));
                return pts;
            };
            const crown = [-0.05, 3.3, 0.02];
            const limbs = [branch(crown, [0.5, 1, 0.1], 1.9, 0.1, 4, 5), branch(crown, [-0.6, 1, -0.2], 1.7, 0.09, 4, 5), branch(crown, [0.1, 1, -0.7], 1.5, 0.08, 4, 5)];
            const sides = [branch([0.04, 1.9, 0.12], [1, 0.6, 0.3], 1.5, 0.08, 3, 5), branch([0.0, 2.4, 0.1], [-1, 0.7, 0.5], 1.4, 0.07, 3, 5),
                branch([-0.08, 2.75, 0.07], [0.3, 0.5, 1], 1.2, 0.06, 3, 5), branch([0.08, 1.4, 0.04], [-0.4, 0.4, -1], 1.1, 0.06, 3, 5)];
            for (const L of [...limbs, ...sides]) {
                const at = L[2].p;
                branch(at, [R.range(-1, 1), 1, R.range(-1, 1)], 0.7, 0.03, 2, 4);
            }
            out.deadTree = geo(parts);
        }
        // Banner: a 5 m pole, a crossbar and a tattered grey cloth with a dark wolf's head.
        {
            const R = prng(1001);
            const WOODB = [0.13, 0.09, 0.06], CLOTH = [0.3, 0.3, 0.31], DARK = [0.05, 0.05, 0.055];
            const parts = [];
            parts.push(tube([{ p: [0, 0, 0], r: 0.05 }, { p: [0, 4.9, 0], r: 0.04 }], 6, { T: [0, 1, 0], ref: [1, 0, 0], c: WOODB }));
            parts.push(flat(tube([{ p: [0, 4.9, 0], r: 0.055 }, { p: [0, 5.0, 0], r: 0.03 }, { p: [0, 5.18, 0], r: 0 }], 5, { T: [0, 1, 0], ref: [1, 0, 0], c: tint(IRON, 1.5) })));
            parts.push(tube([{ p: [-0.72, 4.7, 0.06], r: 0.028 }, { p: [0.72, 4.7, 0.06], r: 0.028 }], 5, { ref: [0, 1, 0], c: WOODB }));
            // Wolf head: an inside test in cloth coordinates (u across -1..1, v down 0..1).
            const wolf = (u, v) => {
                const head = (u / 0.42) ** 2 + ((v - 0.4) / 0.2) ** 2 < 1;
                const snout = Math.abs(u) < 0.18 * (1 - (v - 0.45) / 0.25) && v > 0.42 && v < 0.68;
                const ear = (s) => { const du = u - s * 0.26, dv = 0.3 - v; return dv > -0.05 && dv < 0.14 && Math.abs(du) < 0.12 * (1 - dv / 0.14); };
                return head || snout || ear(1) || ear(-1);
            };
            const cols = 9, rows = 12, grid = [];
            const cut = [...Array(cols + 1)].map(() => R.range(0.82, 1));
            for (let r = 0; r <= rows; r++) {
                const v = r / rows, row = [];
                for (let k = 0; k <= cols; k++) {
                    const u = (k / cols) * 2 - 1;
                    if (v > cut[k] + 0.02 && r === rows) { row.push(null); continue; }
                    const vv = Math.min(v, cut[k]);
                    const x = u * 0.6 * (1 - vv * 0.05), y = 4.66 - vv * 2.2;
                    const z = 0.075 + Math.sin(u * 4 + vv * 3) * 0.05 * vv + vv * 0.04;
                    let c = wolf(u, vv) ? DARK : tint(CLOTH, R.range(0.9, 1.1) * (1 - vv * 0.25));
                    if (vv > cut[k] - 0.04) c = tint(c, 0.7);
                    row.push({ p: [x, y, z], c });
                }
                grid.push(row);
            }
            parts.push(dbl(shade(sheet(grid))));
            out.banner = geo(parts);
        }
        return out;
    }

    const human = buildHuman();
    const wight = buildWight();
    const gear = buildGear();
    const horse = buildHorse();
    const props = buildProps();
    return { human, wight, gear, horse, props };
}
