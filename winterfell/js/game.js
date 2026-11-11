// Battle of Winterfell: a first-person fan game in three acts.
//   Act I   ride out with the Dothraki, watch the lights go out, ride back
//   Act II  stand with the Unsullied, then fall back across the trench
//   Act III hold the castle courtyard until dawn
// Simulation runs in fixed 60 Hz steps (sim()); rendering is per animation frame.
import * as THREE from '../lib/three.module.min.js';
import { Sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const DEBUG = new URLSearchParams(location.search).has('debug');
const STORE_KEY = 'winterfell-progress-v1';

// ── World layout (metres). North, where the dead come from, is -Z. ──
const Z_MUSTER = -30;      // where the horde starts
const Z_CLASH = -250;      // where the horde meets the dead
const Z_LINE = -14;        // front rank of the Unsullied
const TRENCH_Z0 = 8, TRENCH_Z1 = 12, BRIDGE_HALF = 4;
const WALL_Z = 40, GATE_HALF = 5;
const YARD_X = 44.5, YARD_Z1 = 100;
const HOLD_SECS = 75, SIEGE_SECS = 105, CLASH_SECS = 20, GIANT_AT = 48;
const STEP = 1 / 60;

const NIGHT = new THREE.Color(0x070b16);
const DAWN = new THREE.Color(0xb7a08c);

// ── Progress ──
let progress = { v: 1, act: 1, best: null, muted: false };
try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && saved.v === 1) progress = Object.assign(progress, saved);
} catch (e) { /* private mode: play without saving */ }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ } }

// ── Renderer and scene ──
const canvas = $('view');
let renderer;
try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
    document.querySelector('#menu .lead').textContent = 'This game needs WebGL, which this browser could not start.';
    throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
const scene = new THREE.Scene();
scene.background = NIGHT.clone();
scene.fog = new THREE.FogExp2(NIGHT.getHex(), 0.02);
const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 320);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x8ea4d6, 0x141a26, 1.5);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x7f96cc, 0.9);
moon.position.set(40, 80, -30);
scene.add(moon);
const swordLight = new THREE.PointLight(0xff8a3c, 0, 26, 1.3);
swordLight.position.set(0.2, 0.9, -2.2);
camera.add(swordLight);
const fireLights = [];
for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xff7a2c, 0, 38, 1.3);
    scene.add(l);
    fireLights.push(l);
}

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 86 : 74;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Geometry helpers ──
function box(w, h, d, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return g;
}
function merge(list) {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
}
function canvasTex(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
const flameTex = canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,210,120,.9)');
    r.addColorStop(0.6, 'rgba(255,110,30,.35)');
    r.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
});
const snowTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#c4cedd';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
        const v = 150 + Math.random() * 100 | 0;
        g.fillStyle = `rgba(${v},${v + 6},${v + 18},${0.25 + Math.random() * 0.3})`;
        const r = 1 + Math.random() * 5;
        g.fillRect(Math.random() * s, Math.random() * s, r, r);
    }
});
snowTex.wrapS = snowTex.wrapT = THREE.RepeatWrapping;
snowTex.repeat.set(90, 130);

// ── Static world ──
const obstacles = [];   // axis-aligned boxes walkers cannot enter: { x0, x1, z0, z1, on }
function obstacle(x0, x1, z0, z1, on = true) { const o = { x0, x1, z0, z1, on }; obstacles.push(o); return o; }
const stone = new THREE.MeshLambertMaterial({ color: 0x555b68 });
const darkStone = new THREE.MeshLambertMaterial({ color: 0x3d424d });
const wood = new THREE.MeshLambertMaterial({ color: 0x4a3524 });
const iron = new THREE.MeshLambertMaterial({ color: 0x1c1d22 });
function addMesh(geo, mat) { const m = new THREE.Mesh(geo, mat); scene.add(m); return m; }

const BRAZIERS = [];
let gateDoor, gateObstacle, trenchEmitter;

function buildWorld() {
    const ground = addMesh(new THREE.PlaneGeometry(700, 1000), new THREE.MeshLambertMaterial({ color: 0xffffff, map: snowTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -150);
    // The yard is trampled mud, not snow.
    const yard = addMesh(new THREE.PlaneGeometry(YARD_X * 2, YARD_Z1 - WALL_Z), new THREE.MeshLambertMaterial({ color: 0x4a4640 }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(0, 0.02, (WALL_Z + YARD_Z1) / 2 + 1);

    // Curtain wall with a gate, side walls, back wall.
    const H = 14;
    addMesh(merge([
        box(65, H, 3, -37.5, H / 2, WALL_Z + 0.5), box(65, H, 3, 37.5, H / 2, WALL_Z + 0.5),
        box(GATE_HALF * 2, 6, 3, 0, H - 3, WALL_Z + 0.5),
        box(3, H, 60, -46, H / 2, 71), box(3, H, 60, 46, H / 2, 71),
        box(95, H, 3, 0, H / 2, YARD_Z1 + 1.5)
    ]), stone);
    obstacle(-90, -GATE_HALF, WALL_Z - 1, WALL_Z + 2);
    obstacle(GATE_HALF, 90, WALL_Z - 1, WALL_Z + 2);
    obstacle(-47.5, -YARD_X, WALL_Z, YARD_Z1 + 3);
    obstacle(YARD_X, 47.5, WALL_Z, YARD_Z1 + 3);
    obstacle(-48, 48, YARD_Z1, YARD_Z1 + 3);
    // Towers
    const towers = [];
    for (const [x, z, r, h] of [[-9, 39, 4, 19], [9, 39, 4, 19], [-70, 40, 5, 20], [70, 40, 5, 20], [-46, 101, 5, 22], [46, 101, 5, 22]]) {
        const g = new THREE.CylinderGeometry(r, r * 1.08, h, 10).toNonIndexed();
        g.translate(x, h / 2, z);
        towers.push(g);
        const roof = new THREE.ConeGeometry(r * 1.15, 5, 10).toNonIndexed();
        roof.translate(x, h + 2.5, z);
        towers.push(roof);
    }
    addMesh(merge(towers), darkStone);
    obstacle(-13, -GATE_HALF, 35.5, 42);
    obstacle(GATE_HALF, 13, 35.5, 42);
    // Keep
    addMesh(merge([box(28, 26, 16, 0, 13, 90), box(10, 34, 10, -9, 17, 92), box(8, 6, 3, 0, 3, 81.5)]), darkStone);
    obstacle(-14, 14, 82, 98);
    // Crenellations
    const cren = [];
    for (let x = -68; x <= 68; x += 3.2) cren.push(box(1.7, 1.5, 1.1, x, H + 0.75, WALL_Z - 0.4));
    for (let z = 44; z <= 98; z += 3.2) { cren.push(box(1.1, 1.5, 1.7, -46.9, H + 0.75, z)); cren.push(box(1.1, 1.5, 1.7, 46.9, H + 0.75, z)); }
    addMesh(merge(cren), stone);
    // Gate
    gateDoor = addMesh(merge([box(GATE_HALF * 2, 8, 0.7, 0, 4, WALL_Z + 0.4), box(GATE_HALF * 2, 0.5, 0.9, 0, 2.2, WALL_Z + 0.4), box(GATE_HALF * 2, 0.5, 0.9, 0, 5.6, WALL_Z + 0.4)]), wood);
    gateObstacle = obstacle(-GATE_HALF, GATE_HALF, WALL_Z - 0.3, WALL_Z + 1.2, false);
    // Yard clutter
    addMesh(merge([
        box(2.4, 1.2, 1.4, -30, 0.6, 62), box(1.4, 1.4, 1.4, -32.4, 0.7, 63), box(3, 1, 1.6, 31, 0.5, 70, 0, 0.1),
        box(1.3, 1.3, 1.3, 33, 0.65, 67.6), box(2.2, 1.6, 2.2, -20, 0.8, 94), box(4, 0.3, 2, 22, 1.0, 92), box(0.3, 1, 0.3, 20.4, 0.5, 91.4), box(0.3, 1, 0.3, 23.6, 0.5, 92.6)
    ]), wood);
    obstacle(-33.3, -28.6, 61.2, 63.8); obstacle(29.4, 33.8, 66.8, 70.9); obstacle(-21.2, -18.8, 92.8, 95.2);

    // Trench: a dark cut with stakes, one plank bridge in the middle.
    const pit = new THREE.MeshBasicMaterial({ color: 0x06070a });
    addMesh(merge([box(86, 0.06, 4, -47, 0.03, 10), box(86, 0.06, 4, 47, 0.03, 10)]), pit);
    addMesh(box(BRIDGE_HALF * 2, 0.16, 5, 0, 0.08, 10), wood);
    obstacle(-95, -BRIDGE_HALF, TRENCH_Z0, TRENCH_Z1);
    obstacle(BRIDGE_HALF, 95, TRENCH_Z0, TRENCH_Z1);
    const stakes = [];
    for (let x = -88; x <= 88; x += 1.5) {
        if (Math.abs(x) < BRIDGE_HALF + 0.5) continue;
        const g = new THREE.ConeGeometry(0.12, 2.4, 5).toNonIndexed();
        g.rotateX(-0.9 + rand(-0.15, 0.15));
        g.translate(x + rand(-0.3, 0.3), 0.7, TRENCH_Z0 - 0.3);
        stakes.push(g);
    }
    addMesh(merge(stakes), wood);

    // Braziers
    const bz = [];
    const place = (x, z, yard) => {
        BRAZIERS.push({ x, z, yard, on: true });
        obstacle(x - 0.4, x + 0.4, z - 0.4, z + 0.4);
        bz.push(box(0.14, 1.0, 0.14, x, 0.5, z), box(0.8, 0.25, 0.8, x, 1.1, z));
    };
    for (const x of [-30, -10, 10, 30]) place(x, -5, false);
    place(-7.5, 33.5, false); place(7.5, 33.5, false);
    for (const [x, z] of [[-24, 54], [24, 54], [-26, 80], [26, 80], [0, 66]]) place(x, z, true);
    addMesh(merge(bz), iron);
}
buildWorld();

// ── Fire particles: every brazier, plus the trench once it is lit ──
const fire = (() => {
    const emitters = BRAZIERS.map((b) => ({ x: b.x, y: 1.25, z: b.z, w: 0.3, d: 0.3, h: 1.5, n: 22, src: b }));
    trenchEmitter = { x: 0, y: 0.1, z: 10, w: 88, d: 1.6, h: 3.4, n: 760, src: { on: false } };
    emitters.push(trenchEmitter);
    const total = emitters.reduce((s, e) => s + e.n, 0);
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const em = [], ox = [], oz = [], ph = [], sp = [];
    for (const e of emitters) for (let i = 0; i < e.n; i++) {
        em.push(e); ox.push(rand(-e.w, e.w)); oz.push(rand(-e.d, e.d)); ph.push(rand()); sp.push(rand(0.6, 1.3));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 1.5, map: flameTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    return {
        update(t) {
            for (let i = 0; i < total; i++) {
                const e = em[i];
                if (!e.src.on) { pos[i * 3 + 1] = -60; continue; }
                const life = (ph[i] + t * sp[i]) % 1;
                pos[i * 3] = e.x + ox[i] + Math.sin(t * 3 + i) * 0.12;
                pos[i * 3 + 1] = e.y + life * e.h;
                pos[i * 3 + 2] = e.z + oz[i];
                const k = (1 - life) * (1 - life);
                col[i * 3] = k; col[i * 3 + 1] = k * (0.6 - 0.35 * life); col[i * 3 + 2] = k * 0.12;
            }
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
        }
    };
})();

// ── Snowfall, kept in a box around the camera ──
const snow = (() => {
    const N = 1600, R = 34;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = rand(-R, R); pos[i * 3 + 1] = rand(0, 26); pos[i * 3 + 2] = rand(-R, R); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.11, color: 0xdfe8f5, transparent: true, opacity: 0.85, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return {
        mat,
        update(dt, cx, cz) {
            for (let i = 0; i < N; i++) {
                let x = pos[i * 3] - 2.2 * dt, y = pos[i * 3 + 1] - (2.4 + (i % 5) * 0.3) * dt, z = pos[i * 3 + 2] + 1.2 * dt;
                if (y < 0) y += 26;
                if (x < cx - R) x += R * 2; else if (x > cx + R) x -= R * 2;
                if (z < cz - R) z += R * 2; else if (z > cz + R) z -= R * 2;
                pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
            }
            geo.attributes.position.needsUpdate = true;
        }
    };
})();

// ── The rest of the horde: a sea of far flames that go out ──
const horde = (() => {
    const N = 340;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const ox = [], oz = [], lit = new Uint8Array(N), rank = [];
    for (let i = 0; i < N; i++) { ox.push(rand(-110, 110)); oz.push(rand(-55, 26)); }
    const order = [...Array(N).keys()].sort((a, b) => oz[a] - oz[b]);
    order.forEach((idx, r) => { rank[idx] = r / N; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 1.3, map: flameTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false
    }));
    pts.frustumCulled = false;
    pts.visible = false;
    scene.add(pts);
    return {
        pts, N, ox, oz, lit, rank,
        reset() { lit.fill(0); pts.visible = true; },
        update(t, hz) {
            for (let i = 0; i < N; i++) {
                pos[i * 3] = ox[i]; pos[i * 3 + 1] = 2.7 + Math.sin(t * 9 + i) * 0.12; pos[i * 3 + 2] = hz + oz[i];
                const k = lit[i] ? 0.75 + 0.25 * Math.sin(t * 13 + i * 1.7) : 0;
                col[i * 3] = k; col[i * 3 + 1] = k * 0.5; col[i * 3 + 2] = k * 0.12;
            }
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
        }
    };
})();

// ── Instanced figures. Every figure faces local +Z; yaw θ means forward (sin θ, cos θ). ──
const WHITE = new THREE.Color(1, 1, 1);
function part(geo, mat, cap, coloured) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.cap = cap; m.n = 0; m.count = 0; m.frustumCulled = false;
    if (coloured) for (let i = 0; i < cap; i++) m.setColorAt(i, WHITE);
    scene.add(m);
    return m;
}
function put(m, mat4, colour) {
    if (m.n >= m.cap) return;
    m.setMatrixAt(m.n, mat4);
    if (colour) m.setColorAt(m.n, colour);
    m.n++;
}
function flush(m) {
    m.count = m.n; m.n = 0;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
}
const skin = new THREE.MeshLambertMaterial({ color: 0xffffff });
const steel = new THREE.MeshLambertMaterial({ color: 0x9aa3b2 });
const armGeo = box(0.12, 0.62, 0.12, 0, -0.31, 0);
const legGeo = box(0.16, 0.86, 0.16, 0, -0.43, 0);
const W_CAP = 130, A_CAP = 150, H_CAP = 52;
const WP = {
    body: part(merge([box(0.44, 0.6, 0.24, 0, 1.14, 0.05, 0.25), box(0.23, 0.25, 0.23, 0, 1.55, 0.2)]), skin, W_CAP, true),
    eyes: part(merge([box(0.07, 0.05, 0.03, -0.06, 1.57, 0.32), box(0.07, 0.05, 0.03, 0.06, 1.57, 0.32)]),
        new THREE.MeshBasicMaterial({ color: 0x7fdcff, fog: false }), W_CAP),
    armL: part(armGeo, skin, W_CAP, true), armR: part(armGeo, skin, W_CAP, true),
    legL: part(legGeo, skin, W_CAP, true), legR: part(legGeo, skin, W_CAP, true)
};
const AP = {
    body: part(merge([box(0.5, 0.62, 0.28, 0, 1.16, 0), box(0.24, 0.26, 0.24, 0, 1.62, 0)]), skin, A_CAP, true),
    armL: part(armGeo, skin, A_CAP, true), armR: part(armGeo, skin, A_CAP, true),
    legL: part(legGeo, skin, A_CAP, true), legR: part(legGeo, skin, A_CAP, true),
    arakh: part(merge([box(0.04, 0.6, 0.09, 0, -0.95, 0), box(0.04, 0.45, 0.09, 0, -1.42, 0.08, 0.35)]), steel, 60),
    flame: part((() => { const g = new THREE.OctahedronGeometry(0.2); g.scale(1, 2.6, 1); g.translate(0, -1.25, 0.04); return g; })(),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c, fog: false }), 60),
    spear: part(merge([box(0.05, 0.05, 2.5, 0, -0.58, 0.75), box(0.09, 0.03, 0.34, 0, -0.58, 2.1)]), steel, 100),
    sword: part(box(0.05, 0.9, 0.08, 0, -1.02, 0), steel, 30),
    shield: part(box(0.56, 0.78, 0.06, 0, -0.42, 0.16), new THREE.MeshLambertMaterial({ color: 0x23252c }), 100),
    helm: part((() => { const c = new THREE.ConeGeometry(0.06, 0.26, 5).toNonIndexed(); c.translate(0, 1.9, 0); return merge([box(0.27, 0.1, 0.27, 0, 1.75, 0), c]); })(),
        new THREE.MeshLambertMaterial({ color: 0x30333c }), 100)
};
const HP = {
    body: part(merge([box(0.55, 0.65, 1.7, 0, 1.25, 0), box(0.26, 0.8, 0.32, 0, 1.75, 0.85, 0.6), box(0.24, 0.28, 0.6, 0, 2.08, 1.24, 0.5), box(0.1, 0.6, 0.1, 0, 1.2, -0.95, -0.4)]), skin, H_CAP, true),
    leg: part(box(0.13, 0.95, 0.13, 0, -0.475, 0), skin, H_CAP * 4, true)
};
const _root = new THREE.Matrix4(), _l = new THREE.Matrix4(), _w = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function limb(m, px, py, pz, ang, colour) {
    _l.makeRotationX(ang);
    _l.setPosition(px, py, pz);
    _w.multiplyMatrices(_root, _l);
    put(m, _w, colour);
}
function setRoot(f, lift) {
    _e.set(f.fall * f.fallDir * 1.5, f.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(f.x, f.y + lift - f.sink, f.z);
    _s.set(f.scale, f.scale, f.scale);
    _root.compose(_p, _q, _s);
}
function drawWight(f) {
    setRoot(f, 0);
    const walk = f.moving ? Math.sin(f.t) * 0.75 : 0;
    put(WP.body, _root, f.col);
    put(WP.eyes, _root);
    let ar = -1.25 - walk * 0.25;
    if (f.atkT > 0) ar = lerp(-0.3, -2.8, clamp(f.atkT / 0.5, 0, 1));
    limb(WP.armL, 0.3, 1.38, 0.08, -1.25 + walk * 0.25, f.col);
    limb(WP.armR, -0.3, 1.38, 0.08, ar, f.col);
    limb(WP.legL, 0.13, 0.86, 0, walk, f.col);
    limb(WP.legR, -0.13, 0.86, 0, -walk, f.col);
}
function drawAlly(f) {
    const riding = f.kind === 'rider';
    const bob = riding ? Math.sin(f.t * 2) * 0.06 : 0;
    if (riding) {
        // Horse first, then the rider on top of it.
        _e.set(0, f.yaw, f.fall * f.fallDir * 1.45, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(f.x, bob - f.sink, f.z);
        _s.set(1, 1, 1);
        _root.compose(_p, _q, _s);
        put(HP.body, _root, f.hcol);
        for (let i = 0; i < 4; i++) {
            const sx = i & 1 ? 0.2 : -0.2, sz = i < 2 ? 0.65 : -0.65;
            limb(HP.leg, sx, 0.95, sz, f.moving ? Math.sin(f.t + i * 1.7) * 0.85 : 0, f.hcol);
        }
    }
    setRoot(f, riding ? 0.72 + bob : 0);
    const walk = f.moving && !riding ? Math.sin(f.t) * 0.7 : 0;
    put(AP.body, _root, f.col);
    const legA = riding ? -0.45 : walk;
    limb(AP.legL, riding ? 0.3 : 0.13, 0.86, 0, legA, f.col);
    limb(AP.legR, riding ? -0.3 : -0.13, 0.86, 0, riding ? legA : -walk, f.col);
    const strike = f.atkT > 0 ? Math.sin(clamp(f.atkT / 0.3, 0, 1) * Math.PI) : 0;
    if (riding) {
        limb(AP.armL, 0.32, 1.42, 0, -0.9, f.col);
        limb(AP.armR, -0.32, 1.42, 0, -2.55 + Math.sin(f.t * 0.7) * 0.2, f.col);
        put(AP.arakh, _w);
        if (f.flame) put(AP.flame, _w);
    } else if (f.kind === 'unsullied') {
        put(AP.helm, _root);
        limb(AP.armL, 0.32, 1.42, 0, -0.2, f.col);
        put(AP.shield, _w);
        limb(AP.armR, -0.32, 1.42, 0, -0.28 - strike * 0.5, f.col);
        put(AP.spear, _w);
    } else {
        limb(AP.armL, 0.32, 1.42, 0, walk * 0.6, f.col);
        limb(AP.armR, -0.32, 1.42, 0, -1.9 + strike * 1.3, f.col);
        put(AP.sword, _w);
    }
}

// ── First-person arakh and the horse under the player ──
const weapon = new THREE.Group();
{
    const segs = [box(0.05, 0.32, 0.07, 0, -0.05, 0), box(0.2, 0.04, 0.09, 0, 0.12, 0)];
    let x = 0, y = 0.14, a = 0;
    for (let i = 0; i < 7; i++) {       // a curved blade, built from short straight pieces
        const g = new THREE.BoxGeometry(0.035, 0.2, 0.085 - i * 0.006);
        g.rotateZ(a);
        g.translate(x - Math.sin(a) * 0.1, y + Math.cos(a) * 0.1, 0);
        segs.push(g);
        x -= Math.sin(a) * 0.19; y += Math.cos(a) * 0.19; a += 0.16;
    }
    weapon.add(new THREE.Mesh(merge(segs), new THREE.MeshLambertMaterial({ color: 0xb6bfcc, emissive: 0x15181d })));
}
const bladeFlames = [];
for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, color: 0xffb060 }));
    const t = i / 5;
    s.position.set(-t * t * 0.5, 0.25 + t * 1.0, 0);
    s.userData.base = 0.34 - t * 0.1;
    weapon.add(s);
    bladeFlames.push(s);
}
weapon.scale.setScalar(0.62);
camera.add(weapon);
const mount = new THREE.Group();
mount.add(new THREE.Mesh(merge([
    box(0.62, 0.5, 1.7, 0, 1.3, 0.1), box(0.3, 0.9, 0.38, 0, 1.62, -0.95, -0.7), box(0.27, 0.3, 0.66, 0, 1.92, -1.5, -0.42),
    box(0.06, 0.16, 0.06, -0.09, 2.14, -1.3), box(0.06, 0.16, 0.06, 0.09, 2.14, -1.3)
]), new THREE.MeshLambertMaterial({ color: 0x4a3626 })));
mount.add(new THREE.Mesh(box(0.1, 0.8, 0.3, 0, 1.76, -0.8, -0.7), new THREE.MeshLambertMaterial({ color: 0x17120e })));
scene.add(mount);

// ── Game state ──
const G = {
    mode: 'menu', act: 1, phase: '', t: 0, time: 0, kills: 0, clock: 0,
    hordeZ: Z_MUSTER, hordeV: 0, trenchLit: false, litT: -1, dawn: 0, gap: 0, spawnT: 0,
    giant: false, uTotal: 0, god: false, bot: false, flags: {}
};
const P = {
    x: 0, z: Z_MUSTER, yaw: 0, pitch: 0, hp: 100, mounted: true, speed: 0, gallop: 0, bobT: 0,
    swingT: 0, cd: 0, hitPending: false, lastHurt: -99, shake: 0, fallT: 0, flame: 0, vign: 0, stepN: 0
};
const wights = [], allies = [];
const input = { keys: new Set(), sx: 0, sy: 0, attack: false, held: false };

const WCOLS = [0x7d8791, 0x66707c, 0x8b8f8a, 0x5a6470, 0x77808f].map((c) => new THREE.Color(c));
const HCOLS = [0x3b2a1d, 0x2a211b, 0x57422f, 0x1d1a18, 0x6a5540].map((c) => new THREE.Color(c));
const RCOLS = [0x6e4c33, 0x5c3f2b, 0x7a5a3d].map((c) => new THREE.Color(c));
const UCOL = new THREE.Color(0x3a3d47), NCOLS = [0x5a4d42, 0x4b4f58, 0x62574a].map((c) => new THREE.Color(c));
const pick = (a) => a[(Math.random() * a.length) | 0];

function spawnWight(x, z, o = {}) {
    if (wights.length >= W_CAP - 2) return null;
    const w = {
        x, z, y: o.y || 0, vy: 0, yaw: Math.PI, hp: o.hp || 1, state: 'alive', t: rand(TAU), fall: 0, fallDir: -1, sink: 0, dead: 0,
        atkT: 0, wind: 0, cd: rand(0.2, 0.9), scan: rand(0.4), stagger: 0, scale: o.scale || rand(0.92, 1.08),
        speed: o.speed || rand(4.8, 6.2), col: pick(WCOLS), tgt: null, moving: false, giant: !!o.giant, dieAt: -1, hunter: rand() < 0.3
    };
    wights.push(w);
    return w;
}
function mkAlly(kind, x, z, yaw) {
    const a = {
        kind, x, z, y: 0, yaw, hp: kind === 'unsullied' ? 4 : 12, state: 'alive', t: rand(TAU), fall: 0, fallDir: 1, sink: 0, dead: 0,
        atkT: 0, cd: rand(1), scan: rand(0.4), scale: rand(0.96, 1.06), col: kind === 'unsullied' ? UCOL : kind === 'rider' ? pick(RCOLS) : pick(NCOLS),
        hcol: pick(HCOLS), tgt: null, moving: false, flame: false, hx: x, hz: z, ox: 0, oz: 0, dieAt: -1, flee: false
    };
    allies.push(a);
    return a;
}
const aliveAllies = () => { let n = 0; for (const a of allies) if (a.state === 'alive') n++; return n; };

// ── HUD helpers ──
const el = { obj: $('obj'), act: $('act'), bar: $('objbar'), barI: $('objbar').firstElementChild, kills: $('kills'), allies: $('allies'),
    hp: $('hp').firstElementChild, flame: $('flame').firstElementChild, sub: $('sub'), card: $('card'), vign: $('vign'), cross: $('cross'), fade: $('fade') };
let subTimer = 0, cardTimer = 0, crossTimer = 0;
function say(text, secs = 4.5) { el.sub.textContent = text; el.sub.classList.add('on'); subTimer = secs; }
function card(small, big) { el.card.firstElementChild.textContent = small; el.card.lastElementChild.textContent = big; el.card.classList.add('on'); cardTimer = 3.4; }
function objective(text, showBar) { el.obj.textContent = text; el.bar.style.display = showBar ? 'block' : 'none'; }
function once(key) { if (G.flags[key]) return false; G.flags[key] = true; return true; }
const ACT_NAMES = ['', 'Act I · The Charge', 'Act II · The Line', 'Act III · The Castle'];

function showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
    document.body.classList.toggle('playing', G.mode === 'play');
}
function refreshMenu() {
    const c = $('btn-continue');
    c.hidden = !(progress.act > 1);
    c.textContent = 'Continue · Act ' + ['', 'I', 'II', 'III'][progress.act];
    const label = 'Sound: ' + (progress.muted ? 'off' : 'on');
    $('btn-sound').textContent = label;
    $('btn-sound2').textContent = label;
}

// ── Act setup ──
function resetWorld() {
    wights.length = 0; allies.length = 0;
    G.t = 0; G.trenchLit = false; G.litT = -1; G.dawn = 0; G.gap = 0; G.spawnT = 0; G.giant = false; G.flags = {};
    trenchEmitter.src.on = false;
    gateDoor.visible = false; gateObstacle.on = false;
    horde.pts.visible = false;
    P.hp = 100; P.pitch = 0; P.swingT = 0; P.cd = 0; P.fallT = 0; P.shake = 0; P.flame = 0; P.speed = 0; P.lastHurt = -99; P.vign = 0;
    input.attack = false;
    el.fade.classList.remove('on');
}
function makeUnsullied() {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 24; i++) {
        const x = -34.5 + i * 3 + (row % 2) * 1.5;
        if (Math.abs(x) < 1.2 && row === 0) continue;       // the gap the player steps into
        mkAlly('unsullied', x, Z_LINE + row * 2.2, Math.PI);
    }
    G.uTotal = allies.filter((a) => a.kind === 'unsullied').length;
}
function startAct(n) {
    resetWorld();
    G.act = n;
    if (n > progress.act) { progress.act = n; save(); }
    el.act.textContent = ACT_NAMES[n];
    if (n === 1) {
        G.phase = 'muster'; G.hordeZ = Z_MUSTER; G.hordeV = 0;
        Object.assign(P, { x: 0, z: Z_MUSTER, yaw: 0, mounted: true });
        makeUnsullied();
        for (let i = 0; i < 46; i++) {
            let ox, oz;
            do { ox = rand(-52, 52); oz = rand(-30, 11); } while (Math.abs(ox) < 3 && Math.abs(oz) < 5);
            const r = mkAlly('rider', ox, Z_MUSTER + oz, Math.PI);
            r.ox = ox; r.oz = oz;
        }
        const riders = allies.filter((a) => a.kind === 'rider').sort((a, b) => a.oz - b.oz);
        riders.forEach((r, i) => { r.rank = i; r.survivor = i >= riders.length - 6; });
        horde.reset();
        card('Act I', 'The Charge');
        objective('Wait for the signal');
        Sfx.setAmbience({ wind: 0.7, battle: 0, fire: 0, gallop: 0, drums: 0.25 });
    } else if (n === 2) {
        Object.assign(P, { x: 0, z: Z_LINE - 0.5, yaw: 0, mounted: false });
        makeUnsullied();
        beginHold();
    } else {
        Object.assign(P, { x: 0, z: WALL_Z + 6, yaw: Math.PI, mounted: false });
        beginSiege();
    }
}
function beginHold() {
    G.act = 2; G.phase = 'hold'; G.t = 0; G.spawnT = 0;
    if (progress.act < 2) { progress.act = 2; save(); }
    el.act.textContent = ACT_NAMES[2];
    card('Act II', 'The Line');
    objective('Hold the line until the horn', true);
    say('Stand with the Unsullied. A brazier behind the line will relight your blade.', 6);
    Sfx.setAmbience({ wind: 0.4, battle: 0.9, fire: 0.3, gallop: 0, drums: 0.7 });
}
function beginSiege() {
    G.act = 3; G.phase = 'siege'; G.t = 0; G.spawnT = 0;
    if (progress.act < 3) { progress.act = 3; save(); }
    el.act.textContent = ACT_NAMES[3];
    for (let i = wights.length - 1; i >= 0; i--) if (wights[i].z < WALL_Z + 1) wights.splice(i, 1);
    allies.length = 0;
    const posts = [[-30, 50], [-15, 48], [15, 48], [30, 50], [-36, 66], [36, 66], [-20, 72], [20, 72], [-8, 60], [8, 60], [-34, 86], [34, 86]];
    for (const [x, z] of posts) mkAlly('north', x, z, 0);
    G.uTotal = allies.length;
    gateDoor.visible = true; gateObstacle.on = true;
    P.z = Math.max(P.z, WALL_Z + 2.2);
    Sfx.play('gate');
    card('Act III', 'The Castle');
    objective('Survive until dawn', true);
    say('The gate is shut. Then the dead begin to climb.', 5);
    Sfx.setAmbience({ wind: 0.3, battle: 1, fire: 0.6, gallop: 0, drums: 0.6 });
}

// ── Combat ──
function hurt(d) {
    if (G.god || G.mode !== 'play' || G.phase === 'dawn') return;
    P.hp -= d; P.lastHurt = G.clock; P.shake = Math.min(1, P.shake + 0.5); P.vign = 1;
    Sfx.play('hurt');
    if (P.hp <= 0) die();
}
function die() {
    P.hp = 0; G.mode = 'dead';
    Sfx.stopAll(); Sfx.play('screech', { vol: 0.8 });
    $('dead-text').textContent = pick([
        'Your eyes open, and they are blue.',
        'The cold takes you. Then something else does.',
        'You fall in the snow. You do not stay there.'
    ]);
    el.fade.classList.add('on');
    setTimeout(() => { if (G.mode === 'dead') showScreen('dead'); }, 1300);
    document.body.classList.remove('playing');
    if (document.pointerLockElement) document.exitPointerLock();
}
function damageWight(w, dmg, byPlayer) {
    if (w.state !== 'alive') return;
    w.hp -= dmg; w.stagger = w.giant ? 0.12 : 0.3; w.wind = 0; w.atkT = 0;
    if (w.hp <= 0) {
        w.state = 'dying'; w.fallDir = -1;
        if (byPlayer) { G.kills++; Sfx.play('kill'); }
    } else if (byPlayer) Sfx.play('hit');
}
function strike() {
    const reach = P.mounted ? 3.4 : 2.7, minCos = P.mounted ? -0.25 : 0.3;
    const max = P.mounted || P.flame > 0 ? 3 : 2, dmg = P.flame > 0 ? 2 : 1;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const hits = [];
    for (const w of wights) {
        if (w.state !== 'alive' || w.y > 2.5) continue;
        const dx = w.x - P.x, dz = w.z - P.z, d = Math.hypot(dx, dz), r = reach + (w.scale - 1) * 0.9;
        if (d > r) continue;
        if (d > 0.6 && (dx * fx + dz * fz) / d < minCos) continue;
        hits.push([d, w]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < hits.length && i < max; i++) {
        const w = hits[i][1], d = hits[i][0] || 1;
        damageWight(w, dmg, true);
        if (!w.giant) { w.x += (w.x - P.x) / d * 0.5; w.z += (w.z - P.z) / d * 0.5; }
    }
    if (hits.length) { el.cross.classList.add('hit'); crossTimer = 0.12; P.shake = Math.min(1, P.shake + 0.15); }
}
function resolve(o, r) {
    for (const b of obstacles) {
        if (!b.on) continue;
        if (o.x < b.x0 - r || o.x > b.x1 + r || o.z < b.z0 - r || o.z > b.z1 + r) continue;
        const cx = clamp(o.x, b.x0, b.x1), cz = clamp(o.z, b.z0, b.z1);
        let dx = o.x - cx, dz = o.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 > 1e-6) { const d = Math.sqrt(d2); o.x = cx + dx / d * r; o.z = cz + dz / d * r; continue; }
        // Centre is inside the box: leave by the nearest face.
        const l = o.x - b.x0, rt = b.x1 - o.x, n = o.z - b.z0, s = b.z1 - o.z, m = Math.min(l, rt, n, s);
        if (m === l) o.x = b.x0 - r; else if (m === rt) o.x = b.x1 + r; else if (m === n) o.z = b.z0 - r; else o.z = b.z1 + r;
    }
}

// ── Player ──
function simPlayer(dt) {
    const k = input.keys;
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + input.sy;
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + input.sx;
    const turn = (k.has('KeyE') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyQ') || k.has('ArrowLeft') ? 1 : 0);
    my = clamp(my, -1, 1); mx = clamp(mx, -1, 1);
    P.yaw -= turn * 2.0 * dt;
    if (P.fallT > 0) { P.fallT -= dt; my = mx = 0; }

    if (P.mounted) {
        if (G.phase === 'muster') P.speed = 0;
        else {
            const target = 14 + (my > 0 ? my * 3.5 : my * (G.phase === 'charge' ? 4 : 8));
            P.speed += clamp(target - P.speed, -9 * dt, 9 * dt);
            P.yaw -= mx * 1.3 * dt;
        }
        P.x -= Math.sin(P.yaw) * P.speed * dt;
        P.z -= Math.cos(P.yaw) * P.speed * dt;
        P.gallop += P.speed * dt * 0.55;
    } else {
        const len = Math.hypot(mx, my);
        if (len > 1) { mx /= len; my /= len; }
        const sp = (k.has('ShiftLeft') || k.has('ShiftRight') || len > 0.92) ? 8.4 : 6.4;
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
        P.x += (fx * my + rx * mx) * sp * dt;
        P.z += (fz * my + rz * mx) * sp * dt;
        P.bobT += Math.min(1, len) * sp * dt;
        const stepN = Math.floor(P.bobT / 2.1);
        if (stepN !== P.stepN) { P.stepN = stepN; Sfx.play('step', { vol: 0.5 }); }
        resolve(P, 0.45);
    }
    P.x = clamp(P.x, -84, 84);
    P.z = Math.max(P.z, -335);
    if (G.act === 1 && G.phase !== 'afoot' && G.phase !== 'retreat') P.z = Math.min(P.z, Z_LINE - 8);
    if (G.act === 2 && G.phase === 'hold') P.z = Math.min(P.z, 6);
    if (G.act === 3) P.z = Math.max(P.z, gateObstacle.on ? WALL_Z + 1.7 : WALL_Z - 12);

    // Strike
    P.cd -= dt;
    if ((input.attack || input.held) && P.cd <= 0 && P.fallT <= 0 && G.phase !== 'muster') {
        P.swingT = 0.32; P.cd = 0.44; P.hitPending = true;
        Sfx.play('swing');
    }
    input.attack = false;
    if (P.swingT > 0) {
        P.swingT -= dt;
        if (P.hitPending && P.swingT <= 0.2) { P.hitPending = false; strike(); }
    }
    // Slow recovery when left alone for a while
    if (G.clock - P.lastHurt > 6 && P.hp < 100) P.hp = Math.min(100, P.hp + 5 * dt);
    // A burning blade bites deeper; braziers relight it.
    if (!P.mounted) {
        if (P.flame > 0) P.flame -= dt;
        if (P.flame < 8) for (const b of BRAZIERS) {
            if (b.on && Math.abs(b.x - P.x) < 2 && Math.abs(b.z - P.z) < 2) {
                P.flame = 30; Sfx.play('ignite', { vol: 0.5 });
                if (once('relit')) say('Your blade catches. Fire kills them faster.', 4);
                break;
            }
        }
    }
}

// ── Wights ──
function nearestAlly(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const a of allies) {
        if (a.state !== 'alive' || a.kind === 'rider') continue;
        const d = (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
        if (d < bd) { bd = d; best = a; }
    }
    return best;
}
function nearestWight(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const w of wights) {
        if (w.state !== 'alive' || w.y > 1) continue;
        const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
        if (d < bd) { bd = d; best = w; }
    }
    return best;
}
function simWights(dt) {
    G.gap -= dt;
    const lit = G.trenchLit, n = wights.length;
    for (let i = n - 1; i >= 0; i--) {
        const w = wights[i];
        if (w.dieAt >= 0 && G.t >= w.dieAt && w.state === 'alive') { w.state = 'dying'; w.fallDir = rand() < 0.5 ? 1 : -1; }
        if (w.state !== 'alive') {
            w.fall = Math.min(1, w.fall + dt * 3.4); w.dead += dt;
            if (w.dead > 5 && G.phase !== 'dawn') w.sink += dt * 0.5;
            if (w.dead > 8 && G.phase !== 'dawn') { wights[i] = wights[wights.length - 1]; wights.pop(); }
            continue;
        }
        if (w.atkT > 0) w.atkT -= dt;
        w.cd -= dt;
        if (w.y > 0 || w.vy !== 0) {          // dropping from the wall
            w.vy -= 24 * dt; w.y += w.vy * dt;
            if (w.y <= 0) { w.y = 0; w.vy = 0; w.stagger = 0.5; }
            continue;
        }
        if (w.stagger > 0) { w.stagger -= dt; w.moving = false; continue; }
        w.scan -= dt;
        if (w.scan <= 0) {
            w.scan = 0.4 + rand(0.3);
            const dp = Math.hypot(P.x - w.x, P.z - w.z);
            const a = G.act === 1 ? null : nearestAlly(w.x, w.z, 10);
            w.tgt = a && Math.hypot(a.x - w.x, a.z - w.z) < dp * (G.act === 3 ? 0.6 : 0.85) ? a : null;
        }
        if (w.tgt && w.tgt.state !== 'alive') w.tgt = null;
        let tx = w.tgt ? w.tgt.x : P.x, tz = w.tgt ? w.tgt.z : P.z;
        // In Act II the dead walk at the spear line, not all at the player.
        if (!w.tgt && !w.hunter && G.act === 2 && w.z < Z_LINE - 3 && Math.hypot(P.x - w.x, P.z - w.z) > 9) { tx = w.x; tz = Z_LINE + 1; }
        const reach = w.giant ? 3.6 : (!w.tgt && P.mounted ? 2.2 : 1.55);
        let gx = tx, gz = tz, blocked = false;
        if (G.act >= 2) {       // funnel through the bridge and the gate; stop at a burning trench
            if (w.z < TRENCH_Z0 - 0.3 && (tz > TRENCH_Z0 || lit)) {
                if (lit) { if (tz > TRENCH_Z0 - 1.2) { gx = w.x; gz = TRENCH_Z0 - 1.4; blocked = true; } }
                else if (Math.abs(w.x) > 3.2) { gx = clamp(tx, -2.8, 2.8); gz = TRENCH_Z0 - 1; }
                else gz = Math.max(tz, TRENCH_Z1 + 1.5);
            } else if (w.z < TRENCH_Z1 + 0.5 && w.z >= TRENCH_Z0 - 0.3 && tz > w.z) { gx = clamp(w.x, -3, 3); gz = TRENCH_Z1 + 2; }
            else if (w.z < WALL_Z - 1.5 && tz > WALL_Z) {
                if (Math.abs(w.x) > 3.6) { gx = clamp(tx, -3.2, 3.2); gz = WALL_Z - 2.5; } else gz = Math.max(tz, WALL_Z + 3);
            } else if (w.z < WALL_Z + 2 && w.z >= WALL_Z - 1.5 && tz > w.z) { gx = clamp(w.x, -3.4, 3.4); gz = WALL_Z + 3.5; }
        }
        const dT = Math.hypot(tx - w.x, tz - w.z);
        const dx = gx - w.x, dz = gz - w.z, d = Math.hypot(dx, dz);
        const inReach = dT < reach && !blocked;
        if (w.wind > 0) {
            w.wind -= dt; w.moving = false;
            if (w.wind <= 0) {
                if (w.tgt) {
                    if (dT < reach + 0.7) { w.tgt.hp -= w.giant ? 6 : 1; if (w.tgt.hp <= 0) { w.tgt.state = 'dying'; w.tgt.fallDir = -1; } }
                } else if (dT < reach + 0.6) hurt(w.giant ? 30 : (P.mounted ? 8 : 10));
            }
        } else if (inReach) {
            w.moving = false;
            w.yaw = Math.atan2(tx - w.x, tz - w.z);
            if (w.cd <= 0 && (w.tgt || w.giant || G.gap <= 0)) {
                if (!w.tgt && !w.giant) G.gap = P.mounted ? 0.8 : 0.5;
                w.wind = w.giant ? 0.8 : 0.42; w.atkT = w.wind + 0.12; w.cd = (w.giant ? 2.2 : 1.1) + rand(0.5);
                if (rand() < 0.12) Sfx.play('screech', { vol: 0.35, pan: clamp((w.x - P.x) / 12, -1, 1) });
            }
        } else if (d > 0.25) {
            const sp = w.speed * dt;
            w.x += dx / d * sp; w.z += dz / d * sp;
            w.yaw = Math.atan2(dx, dz); w.t += w.speed * dt * 1.7; w.moving = true;
        } else { w.moving = false; if (blocked) w.yaw = 0; }
        if (lit && w.z > TRENCH_Z0 - 0.4 && w.z < TRENCH_Z1 + 0.4) { w.state = 'dying'; continue; }   // caught on the burning bridge
        if (G.act >= 2 && w.z > 4) resolve(w, w.giant ? 1.2 : 0.35);
    }
    // Keep them from stacking on one spot.
    for (let i = 0; i < wights.length; i++) {
        const a = wights[i];
        if (a.state !== 'alive' || a.y > 0) continue;
        for (let j = i + 1; j < wights.length; j++) {
            const b = wights[j];
            if (b.state !== 'alive' || b.y > 0) continue;
            const dx = b.x - a.x, dz = b.z - a.z;
            if (dx > 0.8 || dx < -0.8 || dz > 0.8 || dz < -0.8) continue;
            const d2 = dx * dx + dz * dz;
            if (d2 > 0.64 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2), push = (0.8 - d) * 0.5;
            if (!a.giant) { a.x -= dx / d * push; a.z -= dz / d * push; }
            if (!b.giant) { b.x += dx / d * push; b.z += dz / d * push; }
        }
    }
}

// ── Allies ──
function simAllies(dt) {
    for (let i = allies.length - 1; i >= 0; i--) {
        const a = allies[i];
        if (a.state !== 'alive') {
            a.fall = Math.min(1, a.fall + dt * 3); a.dead += dt;
            if (a.dead > 9) a.sink += dt * 0.4;
            if (a.dead > 13) { allies[i] = allies[allies.length - 1]; allies.pop(); }
            continue;
        }
        if (a.atkT > 0) a.atkT -= dt;
        if (a.kind === 'rider') { simRider(a, dt); continue; }
        a.cd -= dt; a.scan -= dt;
        if (a.scan <= 0) { a.scan = 0.3 + rand(0.25); a.tgt = nearestWight(a.x, a.z, a.kind === 'north' ? 9 : 3.4); }
        const w = a.tgt;
        a.moving = false;
        if (w && w.state === 'alive') {
            const dx = w.x - a.x, dz = w.z - a.z, d = Math.hypot(dx, dz) || 1;
            a.yaw = Math.atan2(dx, dz);
            const reach = (a.kind === 'north' ? 1.9 : 2.6) + (w.scale - 1);
            if (a.kind === 'north' && d > reach - 0.3) { a.x += dx / d * 3.6 * dt; a.z += dz / d * 3.6 * dt; a.t += dt * 7; a.moving = true; resolve(a, 0.35); }
            if (d < reach && a.cd <= 0) {
                a.cd = 1.15 + rand(0.6); a.atkT = 0.3;
                if (rand() < (a.kind === 'north' ? 0.5 : 0.45)) damageWight(w, 1, false);
            }
        } else if (a.kind === 'north') {
            const dx = a.hx - a.x, dz = a.hz - a.z, d = Math.hypot(dx, dz);
            if (d > 1) { a.x += dx / d * 2.5 * dt; a.z += dz / d * 2.5 * dt; a.yaw = Math.atan2(dx, dz); a.t += dt * 6; a.moving = true; }
        } else a.yaw = Math.PI;
    }
}
function simRider(r, dt) {
    r.t += dt * (r.moving ? 13 : 0);
    if (G.phase === 'muster') { r.moving = false; return; }
    if (r.flee) {
        r.moving = true; r.yaw = 0;
        r.z += 13 * dt;
        if (r.z > -60) r.x += clamp(-r.x, -1, 1) * 4 * dt;
        if (r.z > WALL_Z - 3) r.state = 'gone';
        return;
    }
    r.moving = G.hordeV > 1;
    r.x = r.ox + Math.sin(G.clock * 0.6 + r.rank) * 0.6;
    r.z = G.hordeZ + r.oz;
}

// ── The three acts ──
function ringSpawn(minR, maxR, count, speed) {
    for (let i = 0; i < count; i++) {
        const a = rand(TAU), r = rand(minR, maxR);
        const z = P.z + Math.cos(a) * r;
        if (z > Z_LINE - 30) continue;
        spawnWight(P.x + Math.sin(a) * r, z, { speed: speed || rand(6.5, 9) });
    }
}
function alive() { let n = 0; for (const w of wights) if (w.state === 'alive') n++; return n; }

function simAct1(dt) {
    const t = G.t;
    if (G.phase === 'muster') {
        if (t > 1.2 && once('m1')) say('The horde waits in the dark, blades unlit.', 3.5);
        if (t > 4.2) {
            if (once('m2')) { P.flame = 1e9; Sfx.play('ignite'); say('Then fire takes the first arakh. And the next. And all of them.', 4.5); }
            const r = (t - 4.2) * 34;
            for (const a of allies) if (a.kind === 'rider' && !a.flame && Math.hypot(a.x, a.z - Z_MUSTER) < r) a.flame = true;
            for (let i = 0; i < horde.N; i++) if (!horde.lit[i] && Math.hypot(horde.ox[i], horde.oz[i]) < r) horde.lit[i] = 1;
        }
        if (t > 9.2) {
            G.phase = 'charge'; G.t = 0;
            Sfx.play('horn'); Sfx.play('whinny', { vol: 0.6 });
            say('CHARGE!', 2.5);
            objective('Ride with the horde');
            Sfx.setAmbience({ gallop: 1, drums: 0.8, wind: 0.5 });
        }
        return;
    }
    if (G.phase === 'charge') {
        G.hordeV = Math.min(15, G.hordeV + 9 * dt);
        G.hordeZ -= G.hordeV * dt;
        if (G.hordeZ < Z_CLASH + 70 && once('c1')) { say('Ahead, something is moving in the dark.', 4); Sfx.play('screech', { vol: 0.5 }); }
        if (G.hordeZ <= Z_CLASH) {
            G.phase = 'clash'; G.t = 0; G.spawnT = 0;
            for (const a of allies) if (a.kind === 'rider') a.dieAt = a.survivor ? -1 : 0.4 + a.rank * 0.3 + rand(0.4);
            for (let i = 0; i < 40; i++) spawnWight(P.x + rand(-45, 45), Math.min(P.z, G.hordeZ) - rand(18, 60), { speed: rand(6.5, 9) });
            Sfx.play('screech'); Sfx.setAmbience({ battle: 1, gallop: 0.8 });
            objective('Survive the dead', true);
            say('The dead hit the horde like a wave.', 4);
        }
        return;
    }
    if (G.phase === 'clash') {
        G.hordeV = Math.max(0, G.hordeV - 3 * dt);
        G.hordeZ -= G.hordeV * dt;
        for (const a of allies) {
            if (a.kind !== 'rider' || a.state !== 'alive') continue;
            if (a.dieAt >= 0 && t >= a.dieAt) { a.state = 'dying'; a.flame = false; a.fallDir = rand() < 0.5 ? 1 : -1; Sfx.play('extinguish', { vol: 0.6, pan: clamp((a.x - P.x) / 30, -1, 1) }); }
            if (a.survivor && t > 13 && !a.flee) { a.flee = true; a.flame = false; }
        }
        const frac = t / 15;
        for (let i = 0; i < horde.N; i++) if (horde.lit[i] && horde.rank[i] < frac) { horde.lit[i] = 0; if (i % 6 === 0) Sfx.play('extinguish', { vol: 0.3, pan: clamp(horde.ox[i] / 90, -1, 1) }); }
        if (t > 8 && once('c2')) say('The lights are going out.', 4);
        G.spawnT -= dt;
        if (G.spawnT <= 0) { G.spawnT = 0.5; if (alive() < 50) ringSpawn(26, 44, 3); }
        el.barI.style.width = Math.min(100, t / CLASH_SECS * 100) + '%';
        if (t >= CLASH_SECS) {
            G.phase = 'retreat'; G.t = 0;
            P.flame = 0;
            Sfx.play('horn', { rate: 0.8 });
            say('The horde is gone. FALL BACK to the Unsullied!', 5);
            objective('Ride back to the lines', true);
        }
        return;
    }
    if (G.phase === 'retreat') {
        G.spawnT -= dt;
        if (G.spawnT <= 0) {
            G.spawnT = 1.1;
            const dz = Z_LINE - P.z, dx = -P.x, d = Math.hypot(dx, dz) || 1;
            if (alive() < 48 && P.z < -125) for (let i = 0; i < 3; i++) {
                const side = rand(-13, 13);
                spawnWight(P.x + dx / d * 46 + dz / d * side, P.z + dz / d * 46 - dx / d * side, { speed: rand(6, 8) });
            }
            for (let i = wights.length - 1; i >= 0; i--) if (wights[i].z < P.z - 70) wights.splice(i, 1);
        }
        el.barI.style.width = clamp((P.z - Z_CLASH) / (Z_LINE - Z_CLASH) * 100, 0, 100) + '%';
        if (P.z > -82) {
            // The horse goes down short of the line; the last stretch is on foot.
            G.phase = 'afoot'; G.t = 0;
            P.mounted = false; P.fallT = 1.2; P.speed = 0; P.shake = 1; P.hp = Math.max(25, P.hp - 12); P.lastHurt = G.clock; P.vign = 1;
            Sfx.play('whinny'); Sfx.play('hurt');
            Sfx.setAmbience({ gallop: 0, battle: 0.8 });
            say('Your horse is pulled down. RUN!', 4);
            objective('Run to the Unsullied line', true);
            for (let i = 0; i < 9; i++) spawnWight(P.x + rand(-16, 16), P.z - rand(16, 34), { speed: rand(5.2, 6.1) });
        }
        return;
    }
    if (G.phase === 'afoot') {
        el.barI.style.width = clamp((P.z + 82) / (Z_LINE + 82 - 4) * 100, 0, 100) + '%';
        if (P.z > Z_LINE - 5) {
            for (let i = allies.length - 1; i >= 0; i--) if (allies[i].kind === 'rider') allies.splice(i, 1);
            horde.pts.visible = false;
            beginHold();
        }
    }
}

function simAct2(dt) {
    const t = G.t;
    let u = 0;
    for (const a of allies) if (a.kind === 'unsullied' && a.state === 'alive') u++;
    G.spawnT -= dt;
    if (G.phase === 'hold') {
        const k = t / HOLD_SECS;
        if (G.spawnT <= 0) {
            G.spawnT = lerp(0.6, 0.22, k);
            if (alive() < lerp(34, 86, k)) spawnWight(rand(-44, 44), -68 - rand(16), { hp: rand() < k * 0.35 ? 2 : 1 });
        }
        el.barI.style.width = Math.min(100, k * 100) + '%';
        if (t > 30 && once('h1')) say('They do not tire. They do not stop.', 4);
        if (t >= HOLD_SECS || (t > 25 && u < G.uTotal * 0.3)) {
            G.phase = 'fallback'; G.t = 0;
            Sfx.play('horn'); setTimeout(() => Sfx.play('horn', { rate: 1.12 }), 900);
            say('The line is breaking. FALL BACK! Cross the trench to the gate.', 6);
            objective('Fall back through the castle gate', true);
        }
        return;
    }
    if (G.phase === 'fallback') {
        if (G.spawnT <= 0) { G.spawnT = 0.3; if (alive() < 80) spawnWight(rand(-44, 44), Math.min(-50, P.z - 45) - rand(12), { speed: rand(5.4, 6.6) }); }
        el.barI.style.width = clamp((P.z - Z_LINE) / (WALL_Z + 3 - Z_LINE) * 100, 0, 100) + '%';
        if (!G.trenchLit && P.z > TRENCH_Z1 + 1) {
            if (G.litT < 0) G.litT = 1.3;
            G.litT -= dt;
            if (G.litT <= 0) {
                G.trenchLit = true; trenchEmitter.src.on = true;
                Sfx.play('ignite'); Sfx.setAmbience({ fire: 1 });
                say('The trench catches. The dead stop at the fire. For now.', 5);
            }
        }
        if (P.z > WALL_Z + 3.2) beginSiege();
    }
}

function simAct3(dt) {
    const t = G.t;
    if (G.phase === 'siege') {
        const k = t / SIEGE_SECS;
        el.barI.style.width = Math.min(100, k * 100) + '%';
        G.spawnT -= dt;
        if (t > 4 && G.spawnT <= 0) {
            G.spawnT = lerp(1.0, 0.4, k);
            if (alive() < lerp(16, 48, k)) {
                const o = { hp: rand() < k * 0.4 ? 2 : 1, speed: rand(4.6, 6) };
                if (G.giant && rand() < 0.35) spawnWight(rand(-3, 3), WALL_Z - 8 - rand(6), o);
                else {
                    const side = rand(3) | 0;      // drop from the front wall or either side wall
                    o.y = 13.5;
                    if (side === 0) { const x = rand(8, 42) * (rand() < 0.5 ? -1 : 1); spawnWight(x, WALL_Z + 3, o); }
                    else spawnWight((YARD_X - 1) * (side === 1 ? -1 : 1), rand(46, 96), o);
                }
            }
        }
        if (t > 20 && once('s1')) say('Light your blade at a brazier. Stay near the others.', 5);
        if (t > GIANT_AT && !G.giant) {
            G.giant = true;
            gateDoor.visible = false; gateObstacle.on = false;
            Sfx.play('gate'); Sfx.play('screech');
            P.shake = 1;
            say('THE GATE! Something huge is coming through.', 5);
            spawnWight(0, WALL_Z - 5, { giant: true, scale: 2.7, hp: 14, speed: 2.7 });
        }
        if (t > 78 && once('s2')) { Sfx.play('dragon'); say('Somewhere above the clouds, dragons are screaming.', 4.5); }
        if (t >= SIEGE_SECS) {
            G.phase = 'dawn'; G.t = 0;
            Sfx.play('shatter'); Sfx.setAmbience({ battle: 0, drums: 0, fire: 0.3, wind: 0.4 });
            for (const w of wights) if (w.state === 'alive') w.dieAt = rand(0.1, 1.6);
            say('A cry from the godswood. Then every one of them falls.', 6);
            objective('Dawn');
        }
        return;
    }
    if (G.phase === 'dawn') {
        G.dawn = clamp((t - 1.5) / 6, 0, 1);
        if (t > 8.5) win();
    }
}
function win() {
    G.mode = 'won';
    const secs = Math.round(G.time);
    if (!progress.best || G.kills > progress.best.kills) progress.best = { kills: G.kills, secs };
    progress.act = 1; save();
    $('won-kills').textContent = G.kills;
    $('won-time').textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    $('won-allies').textContent = aliveAllies();
    Sfx.stopAll();
    if (document.pointerLockElement) document.exitPointerLock();
    showScreen('won');
}

// ── Test pilot (debug only): rides and fights well enough to play every act through ──
function pilot() {
    const w = nearestWight(P.x, P.z, P.mounted ? 4 : 5);
    let tx = P.x, tz = P.z - 10, move = 1;
    if (G.act === 1) {
        if (G.phase === 'retreat' || G.phase === 'afoot') { tx = 0; tz = Z_LINE; }
        else if (G.phase === 'clash') { tx = Math.sin(G.t * 0.5) * 40; tz = Z_CLASH + 30 + Math.cos(G.t * 0.5) * 30; }
    }
    else if (G.act === 2 && G.phase === 'hold') { tx = 0; tz = Z_LINE - 0.5; move = Math.hypot(P.x - tx, P.z - tz) > 1.5 ? 1 : 0; }
    else if (G.act === 2) { tx = 0; tz = P.z < TRENCH_Z1 + 1 && Math.abs(P.x) > 2 ? TRENCH_Z0 - 2 : WALL_Z + 8; }
    else { tx = 0; tz = 66; move = Math.hypot(P.x - tx, P.z - tz) > 3 ? 1 : 0; }
    const fleeing = G.phase === 'retreat' || G.phase === 'afoot' || G.phase === 'fallback';
    if (w && !fleeing && !P.mounted) { tx = w.x; tz = w.z; move = Math.hypot(w.x - P.x, w.z - P.z) > 1.9 ? 1 : 0; }
    P.yaw = Math.atan2(-(tx - P.x), -(tz - P.z));
    input.sy = move; input.held = !!w;
}

// ── Simulation step ──
function sim(dt) {
    G.clock += dt; G.t += dt; G.time += dt;
    if (G.bot) pilot();
    simPlayer(dt);
    if (G.mode !== 'play') return;
    simWights(dt);
    simAllies(dt);
    if (G.act === 1) simAct1(dt); else if (G.act === 2) simAct2(dt); else simAct3(dt);
}

// ── Rendering ──
const srcs = [];
function updateLights(t) {
    srcs.length = 0;
    for (const b of BRAZIERS) if (b.on) srcs.push([Math.hypot(b.x - camera.position.x, b.z - camera.position.z), b.x, 2.2, b.z, 46]);
    if (G.trenchLit) for (let i = -1; i <= 1; i++) {
        const x = Math.round(camera.position.x / 16) * 16 + i * 16;
        srcs.push([Math.hypot(x - camera.position.x, 10 - camera.position.z), x, 2.5, 10, 90]);
    }
    srcs.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < fireLights.length; i++) {
        const l = fireLights[i], s = srcs[i];
        if (!s) { l.intensity = 0; continue; }
        l.position.set(s[1], s[2], s[3]);
        l.intensity = s[4] * (0.82 + 0.18 * Math.sin(t * 11 + i * 2.1) * Math.sin(t * 7.3 + i));
    }
}
let menuT = 0;
function render(dt, t) {
    if (G.mode === 'menu') {
        menuT += dt;
        camera.position.set(Math.sin(menuT * 0.07) * 26, 7 + Math.sin(menuT * 0.11) * 2, -24);
        camera.lookAt(0, 9, WALL_Z);
        weapon.visible = false; mount.visible = false; swordLight.intensity = 0;
    } else {
        let eye = P.mounted ? 2.62 + Math.sin(P.gallop * 2) * 0.07 : 1.7 + Math.sin(P.bobT * 1.5) * 0.045;
        let roll = 0;
        if (P.fallT > 0) { const k = Math.sin(clamp(P.fallT / 1.2, 0, 1) * Math.PI); eye = 1.7 - k * 1.05; roll = k * 0.55; }
        if (G.mode === 'dead') { eye = 0.5; roll = 1.1; }
        P.shake = Math.max(0, P.shake - dt * 2.5);
        const sh = P.shake * 0.05;
        camera.position.set(P.x + rand(-sh, sh), eye + rand(-sh, sh), P.z);
        camera.rotation.set(P.pitch + (P.mounted ? Math.sin(P.gallop * 2) * 0.012 : 0), P.yaw, roll);
        // Arakh
        weapon.visible = G.mode !== 'dead';
        const s = P.swingT > 0 ? 1 - P.swingT / 0.32 : -1;
        if (s >= 0) {
            const e = Math.sin(s * Math.PI * 0.5);
            weapon.position.set(lerp(0.5, -0.28, e), lerp(-0.2, -0.5, e), -0.62);
            weapon.rotation.set(lerp(-0.3, -1.25, e), 0.2, lerp(-0.7, 1.35, e));
        } else {
            const idle = Math.sin(t * 1.7) * 0.012;
            weapon.position.set(0.4, -0.46 + idle, -0.66);
            weapon.rotation.set(-0.32, 0.25, -0.22);
        }
        const burning = P.flame > 0;
        for (let i = 0; i < bladeFlames.length; i++) {
            const f = bladeFlames[i];
            f.visible = burning;
            const sc = f.userData.base * (0.8 + 0.4 * Math.abs(Math.sin(t * 14 + i * 1.9)));
            f.scale.set(sc, sc * 1.5, 1);
        }
        swordLight.intensity = burning ? 15 * (0.85 + 0.15 * Math.sin(t * 15)) : 0;
        mount.visible = P.mounted;
        if (P.mounted) { mount.position.set(P.x, Math.sin(P.gallop * 2) * 0.07, P.z); mount.rotation.y = P.yaw; }
    }
    // Sky
    if (G.dawn > 0) {
        scene.background.copy(NIGHT).lerp(DAWN, G.dawn);
        scene.fog.color.copy(scene.background);
        scene.fog.density = lerp(0.02, 0.007, G.dawn);
        hemi.intensity = lerp(1.5, 3.2, G.dawn);
        snow.mat.opacity = 0.85 * (1 - G.dawn);
    } else if (scene.fog.density !== 0.02) {
        scene.background.copy(NIGHT); scene.fog.color.copy(NIGHT); scene.fog.density = 0.02; hemi.intensity = 1.5; snow.mat.opacity = 0.85;
    }
    for (const w of wights) drawWight(w);
    for (const a of allies) if (a.state !== 'gone') drawAlly(a);
    for (const k in WP) flush(WP[k]);
    for (const k in AP) flush(AP[k]);
    flush(HP.body); flush(HP.leg);
    fire.update(t);
    snow.update(dt, camera.position.x, camera.position.z);
    if (horde.pts.visible) horde.update(t, G.hordeZ);
    updateLights(t);
    renderer.render(scene, camera);
}
let hudT = 0;
function updateHud(dt) {
    if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) el.sub.classList.remove('on'); }
    if (cardTimer > 0) { cardTimer -= dt; if (cardTimer <= 0) el.card.classList.remove('on'); }
    if (crossTimer > 0) { crossTimer -= dt; if (crossTimer <= 0) el.cross.classList.remove('hit'); }
    P.vign = Math.max(0, P.vign - dt * 1.4);
    el.vign.style.opacity = Math.max(P.vign, P.hp < 35 ? 0.35 + 0.15 * Math.sin(G.clock * 5) : 0).toFixed(2);
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.12;
    el.hp.style.width = clamp(P.hp, 0, 100) + '%';
    el.flame.style.width = (P.mounted ? (P.flame > 0 ? 100 : 0) : clamp(P.flame / 30 * 100, 0, 100)) + '%';
    el.kills.textContent = G.kills;
    const n = aliveAllies();
    el.allies.textContent = G.act === 1 ? (G.phase === 'muster' || G.phase === 'charge' ? 'the horde rides' : '') :
        n + (G.act === 2 ? ' Unsullied' : ' defenders');
}

// ── Main loop ──
let last = performance.now(), acc = 0, manual = false;
function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (G.mode === 'play' && !manual) {
        acc += dt;
        let n = 0;
        while (acc >= STEP && n < 6) { sim(STEP); acc -= STEP; n++; if (G.mode !== 'play') break; }
        if (n === 6) acc = 0;
    }
    if (G.mode === 'play' || G.mode === 'dead') updateHud(dt);
    render(dt, now / 1000);
}

// ── Flow ──
function lockPointer() {
    if (document.body.classList.contains('touch') || !canvas.requestPointerLock) return;
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not available */ }
}
function begin(act) {
    Sfx.unlock(); Sfx.setMuted(progress.muted); Sfx.play('ui');
    G.kills = 0; G.time = 0;
    G.mode = 'play';
    startAct(act);
    showScreen(null);
    lockPointer();
}
function pause() {
    if (G.mode !== 'play') return;
    G.mode = 'paused';
    Sfx.stopAll();
    $('paused-obj').textContent = ACT_NAMES[G.act] + ' · ' + el.obj.textContent;
    showScreen('paused');
    if (document.pointerLockElement) document.exitPointerLock();
}
const AMBIENCE = {
    muster: { wind: 0.7, drums: 0.25 }, charge: { gallop: 1, drums: 0.8, wind: 0.5 }, clash: { battle: 1, gallop: 0.8, drums: 0.8 },
    retreat: { battle: 0.6, gallop: 1, drums: 0.8 }, afoot: { battle: 0.8, drums: 0.8 }, hold: { wind: 0.4, battle: 0.9, fire: 0.3, drums: 0.7 },
    fallback: { battle: 1, fire: 0.6, drums: 0.8 }, siege: { wind: 0.3, battle: 1, fire: 0.6, drums: 0.6 }, dawn: { wind: 0.4, fire: 0.3 }
};
function resume() {
    if (G.mode !== 'paused') return;
    G.mode = 'play';
    Sfx.unlock();
    Sfx.setAmbience(Object.assign({ wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0 }, AMBIENCE[G.phase]));
    showScreen(null);
    lockPointer();
}
function toTitle() {
    G.mode = 'menu';
    Sfx.stopAll();
    resetWorld();
    makeUnsullied();
    refreshMenu();
    showScreen('menu');
}
function toggleSound() {
    progress.muted = !progress.muted; save();
    Sfx.unlock(); Sfx.setMuted(progress.muted);
    refreshMenu();
}
$('btn-start').onclick = () => begin(1);
$('btn-continue').onclick = () => begin(progress.act);
$('btn-sound').onclick = toggleSound;
$('btn-sound2').onclick = toggleSound;
$('btn-resume').onclick = resume;
$('btn-restart').onclick = () => { const k = G.kills; G.mode = 'play'; startAct(G.act); G.kills = k; showScreen(null); lockPointer(); };
$('btn-retry').onclick = () => { Sfx.unlock(); G.mode = 'play'; startAct(G.act); showScreen(null); lockPointer(); };
$('btn-again').onclick = () => begin(1);
for (const id of ['btn-quit', 'btn-quit2', 'btn-quit3']) $(id).onclick = toTitle;
$('pause').onclick = pause;

// ── Input ──
window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') { if (G.mode === 'play') pause(); else if (G.mode === 'paused') resume(); return; }
    if (e.code === 'KeyM') { toggleSound(); return; }
    if (G.mode !== 'play') return;
    if (e.code === 'Space') { input.attack = true; input.held = true; e.preventDefault(); }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    input.keys.add(e.code);
});
window.addEventListener('keyup', (e) => { input.keys.delete(e.code); if (e.code === 'Space') input.held = false; });
window.addEventListener('blur', () => { input.keys.clear(); input.held = false; });
let dragging = false;
canvas.addEventListener('mousedown', (e) => {
    if (G.mode !== 'play' || e.button !== 0) return;
    if (!document.pointerLockElement) { lockPointer(); dragging = true; }
    input.attack = true; input.held = true;
});
window.addEventListener('mouseup', () => { input.held = false; dragging = false; });
window.addEventListener('mousemove', (e) => {
    if (G.mode !== 'play' || !(document.pointerLockElement === canvas || dragging)) return;
    P.yaw -= e.movementX * 0.0023;
    P.pitch = clamp(P.pitch - e.movementY * 0.0023, -1.1, 1.1);
});
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && G.mode === 'play' && !document.body.classList.contains('touch')) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch: left side is a floating stick, the rest of the screen looks around.
const stickEl = $('stick'), nubEl = $('nub');
let stickId = null, lookId = null, sx0 = 0, sy0 = 0, lx = 0, ly = 0;
function setStick(dx, dy) {
    const d = Math.hypot(dx, dy), m = 50;
    if (d > m) { dx *= m / d; dy *= m / d; }
    input.sx = dx / m; input.sy = -dy / m;
    nubEl.style.transform = `translate(${dx}px,${dy}px)`;
}
window.addEventListener('touchstart', (e) => {
    document.body.classList.add('touch');
    $('keys').style.display = 'none';
    if (G.mode !== 'play' || e.target.closest('button')) return;
    for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && stickId === null) {
            stickId = t.identifier; sx0 = t.clientX; sy0 = t.clientY;
            stickEl.classList.add('live');
            stickEl.style.left = sx0 + 'px'; stickEl.style.top = sy0 + 'px';
        } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
    e.preventDefault();
}, { passive: false });
window.addEventListener('touchmove', (e) => {
    if (G.mode !== 'play') return;
    for (const t of e.changedTouches) {
        if (t.identifier === stickId) setStick(t.clientX - sx0, t.clientY - sy0);
        else if (t.identifier === lookId) {
            P.yaw -= (t.clientX - lx) * 0.0055;
            P.pitch = clamp(P.pitch - (t.clientY - ly) * 0.0055, -1.1, 1.1);
            lx = t.clientX; ly = t.clientY;
        }
    }
    e.preventDefault();
}, { passive: false });
function touchEnd(e) {
    for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; setStick(0, 0); stickEl.classList.remove('live'); stickEl.style.left = ''; stickEl.style.top = ''; }
        if (t.identifier === lookId) lookId = null;
    }
}
window.addEventListener('touchend', touchEnd);
window.addEventListener('touchcancel', touchEnd);
const atk = $('atk');
atk.addEventListener('touchstart', (e) => { input.attack = true; input.held = true; e.preventDefault(); e.stopPropagation(); }, { passive: false });
atk.addEventListener('touchend', (e) => { input.held = false; e.preventDefault(); });
atk.addEventListener('touchcancel', () => { input.held = false; });

// ── Debug API (?debug=1) ──
if (DEBUG) {
    window.__winterfell = {
        G, P, wights, allies, progress,
        get state() {
            return { mode: G.mode, act: G.act, phase: G.phase, t: G.t, hp: P.hp, kills: G.kills, x: P.x, z: P.z, mounted: P.mounted,
                wights: alive(), allies: aliveAllies(), trenchLit: G.trenchLit, flame: P.flame };
        },
        start(act = 1) { begin(act); },
        /** Advance the simulation by n fixed steps. Calling this once stops the real-time loop from simulating. */
        step(n = 1) { manual = true; for (let i = 0; i < n && G.mode === 'play'; i++) sim(STEP); },
        key(code, down) { if (down) input.keys.add(code); else input.keys.delete(code); },
        look(yaw, pitch = 0) { P.yaw = yaw; P.pitch = pitch; },
        attack() { input.attack = true; },
        god(on = true) { G.god = on; },
        bot(on = true) { G.bot = on; if (!on) { input.sy = 0; input.held = false; } },
        spawn(x, z, o) { return spawnWight(x, z, o); }
    };
}

makeUnsullied();
refreshMenu();
requestAnimationFrame(frame);
