// Battle of Winterfell: a first-person fan game in three acts.
//   Act I   ride out with the Dothraki, watch the lights go out, ride back
//   Act II  stand with the Unsullied, then fall back across the trench
//   Act III hold the castle courtyard, then fall back into the keep
//   Act IV  fight through the dark halls to the godswood
//   Act V   defend the weirwood, kill the White Walkers, bring down the Night King
// Simulation runs in fixed 60 Hz steps (sim()); rendering is per animation frame.
import * as THREE from '../lib/three.module.min.js';
import { Sfx } from './sfx.js';
import { makeTextures } from './textures.js';

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
const HOLD_SECS = 75, SIEGE_SECS = 80, CLASH_SECS = 20, GIANT_AT = 38, GROVE_SECS = 50;
// Act IV is built off to the east and Act V to the west, where the fog hides them from the field.
// The halls are a union of walkable rectangles that overlap by a metre at each doorway.
const HALL = [
    { x0: 188, x1: 212, z0: -30, z1: 0 },          // great hall
    { x0: 197.5, x1: 202.5, z0: -55, z1: -29 },    // north passage
    { x0: 197.5, x1: 222, z0: -55, z1: -50 },      // east passage
    { x0: 217, x1: 222, z0: -82, z1: -50 }         // passage to the godswood door
];
const HALL_BLOCKS = [{ x0: 193, x1: 195, z0: -24, z1: -7 }, { x0: 205, x1: 207, z0: -24, z1: -7 }];   // the long tables
const HALL_JOINTS = [[200, -30], [200, -52.5], [219.5, -52.5]];
const HALL_EXIT_Z = -80;
const GROVE = { x: -200, z: 0, r: 36, treeX: -200, treeZ: -12 };
const inRect = (r, x, z, m) => x >= r.x0 + m && x <= r.x1 - m && z >= r.z0 + m && z <= r.z1 - m;
function hallOK(x, z, r, tables) {
    let ok = false;
    for (const h of HALL) if (inRect(h, x, z, r)) { ok = true; break; }
    if (!ok) return false;
    if (tables) for (const b of HALL_BLOCKS) if (inRect(b, x, z, -r)) return false;
    return true;
}
/** Move with wall sliding. Only the player is stopped by the tables; the dead scramble over them. */
function hallMove(o, nx, nz, r, tables) {
    if (hallOK(nx, nz, r, tables)) { o.x = nx; o.z = nz; } else if (hallOK(nx, o.z, r, tables)) o.x = nx; else if (hallOK(o.x, nz, r, tables)) o.z = nz;
}
/** First and last hall rectangle that contains a point (they differ inside a doorway). */
function hallSeg(x, z) {
    let lo = -1, hi = -1;
    for (let i = 0; i < HALL.length; i++) if (inRect(HALL[i], x, z, 0)) { if (lo < 0) lo = i; hi = i; }
    return [lo, hi];
}
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
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
const swordLight = new THREE.PointLight(0xffac6a, 0, 26, 1.3);
swordLight.position.set(0.2, 0.9, -2.2);
camera.add(swordLight);
const fireLights = [];
for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffa25e, 0, 38, 1.3);
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
/** Merge geometries into one. UVs are projected from world position (tile metres per repeat), so textures line up across pieces. */
function merge(list, tile = 4) {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of parts) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        o += g.attributes.position.count;
    }
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const ax = Math.abs(nor[i * 3]), ay = Math.abs(nor[i * 3 + 1]), az = Math.abs(nor[i * 3 + 2]);
        if (ay >= ax && ay >= az) { uv[i * 2] = x / tile; uv[i * 2 + 1] = z / tile; }
        else if (ax >= az) { uv[i * 2] = z / tile; uv[i * 2 + 1] = y / tile; }
        else { uv[i * 2] = x / tile; uv[i * 2 + 1] = y / tile; }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
}
function cap(r, len, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
    const g = new THREE.CapsuleGeometry(r, len, 2, 7);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return g;
}
function ball(r, x, y, z, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.SphereGeometry(r, 9, 7);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return g;
}
function cyl(rt, rb, h, x, y, z, rx = 0, seg = 8, sz = 1) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (sz !== 1) g.scale(1, 1, sz);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return g;
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
const TX = makeTextures();
function tex(canvas, rx = 1, ry = 1) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    return t;
}
const snowTex = tex(TX.snow, 90, 130);
// Night sky on the inside of a sphere that follows the camera.
const sky = new THREE.Mesh(new THREE.SphereGeometry(290, 28, 16),
    new THREE.MeshBasicMaterial({ map: tex(TX.sky), side: THREE.BackSide, fog: false, depthWrite: false, transparent: true }));
sky.renderOrder = -1;
scene.add(sky);

// ── Static world ──
const obstacles = [];   // axis-aligned boxes walkers cannot enter: { x0, x1, z0, z1, on }
function obstacle(x0, x1, z0, z1, on = true) { const o = { x0, x1, z0, z1, on }; obstacles.push(o); return o; }
const stone = new THREE.MeshLambertMaterial({ color: 0xc8ccd6, map: tex(TX.stone, 1.33, 1.33) });
const darkStone = new THREE.MeshLambertMaterial({ color: 0xb4b8c4, map: tex(TX.darkStone, 1.33, 1.33) });
const wood = new THREE.MeshLambertMaterial({ color: 0xc9b8a6, map: tex(TX.wood, 3.3, 3.3) });
const doorMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex(TX.door) });
const floorMat = new THREE.MeshLambertMaterial({ color: 0xb8b2aa, map: tex(TX.floor) });
const iron = new THREE.MeshLambertMaterial({ color: 0x1c1d22 });
function addMesh(geo, mat) { const m = new THREE.Mesh(geo, mat); scene.add(m); return m; }

const BRAZIERS = [];
let gateObstacle, trenchEmitter;
// Doors are hinged leaves that swing towards a target angle (see render()).
const doors = {};
function leaf(w, h, hingeX, z, dir) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), doorMat);
    m.position.set(dir * w / 2, h / 2, 0);
    g.add(m);
    g.position.set(hingeX, 0, z);
    g.userData = { ry: 0, rx: 0 };
    scene.add(g);
    return g;
}
function pair(name, cx, z, half, h) { doors[name] = [leaf(half, h, cx - half, z, 1), leaf(half, h, cx + half, z, -1)]; }
/** Swing a pair of doors: `ry` is how far each leaf turns on its hinge (sign = which way), `rx` tips it over (a broken gate). */
function setDoors(name, ry, rx = 0, snap = false) {
    const [l, r] = doors[name];
    l.userData.ry = -ry; r.userData.ry = ry; l.userData.rx = r.userData.rx = rx;
    if (snap) for (const d of [l, r]) d.rotation.set(d.userData.rx, d.userData.ry, 0);
}
let keepGlow;

function buildWorld() {
    const ground = addMesh(new THREE.PlaneGeometry(700, 1000), new THREE.MeshLambertMaterial({ color: 0xffffff, map: snowTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -150);
    // The yard is trampled mud, not snow.
    const yard = addMesh(new THREE.PlaneGeometry(YARD_X * 2, YARD_Z1 - WALL_Z), new THREE.MeshLambertMaterial({ color: 0xb0aca6, map: tex(TX.mud, 14, 9) }));
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
    addMesh(merge([box(28, 26, 16, 0, 13, 90), box(10, 34, 10, -9, 17, 92)]), darkStone);
    // The keep door: a pale stone porch, two oak leaves, and firelight behind them once they open.
    addMesh(merge([box(1, 5.8, 1.2, -3.2, 2.9, 81.5), box(1, 5.8, 1.2, 3.2, 2.9, 81.5), box(7.6, 1.1, 1.5, 0, 6.3, 81.4), box(7, 0.24, 2.2, 0, 0.12, 80.6)], 2.5), stone);
    pair('keep', 0, 81.86, 2.7, 5.2);
    keepGlow = addMesh(new THREE.PlaneGeometry(5.4, 5.2), new THREE.MeshBasicMaterial({ color: 0xffb060, fog: false }));
    keepGlow.rotation.y = Math.PI; keepGlow.position.set(0, 2.6, 81.97); keepGlow.visible = false;
    obstacle(-14, 14, 82, 98);
    // Crenellations
    const cren = [];
    for (let x = -68; x <= 68; x += 3.2) cren.push(box(1.7, 1.5, 1.1, x, H + 0.75, WALL_Z - 0.4));
    for (let z = 44; z <= 98; z += 3.2) { cren.push(box(1.1, 1.5, 1.7, -46.9, H + 0.75, z)); cren.push(box(1.1, 1.5, 1.7, 46.9, H + 0.75, z)); }
    addMesh(merge(cren), stone);
    // Gate
    pair('gate', 0, WALL_Z + 0.5, GATE_HALF, 8);
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
    for (const [x, z] of [[-24, 54], [24, 54], [-26, 80], [26, 80], [0, 66], [-4.8, 80], [4.8, 80]]) place(x, z, true);
    for (const [x, z] of [[190, -4], [210, -4], [190, -27], [210, -27], [198.3, -42], [211, -54.3], [221.3, -66]]) place(x, z, true);
    for (const [x, z] of [[-207, -7], [-193, -7], [-200, 12]]) place(x, z, true);

    // Act IV: the halls. Walls go on every rectangle edge that does not open into another rectangle.
    const anyHall = (x, z) => HALL.some((h) => inRect(h, x, z, 0));
    const hw = [], WH = 6;
    for (const h of HALL) {
        for (let x = h.x0; x < h.x1; x += 1) {
            const cx = Math.min(x + 0.5, h.x1 - 0.5);
            if (!anyHall(cx, h.z0 - 0.3)) hw.push(box(1, WH, 0.5, cx, WH / 2, h.z0 - 0.25));
            if (!anyHall(cx, h.z1 + 0.3)) hw.push(box(1, WH, 0.5, cx, WH / 2, h.z1 + 0.25));
        }
        for (let z = h.z0; z < h.z1; z += 1) {
            const cz = Math.min(z + 0.5, h.z1 - 0.5);
            if (!anyHall(h.x0 - 0.3, cz)) hw.push(box(0.5, WH, 1, h.x0 - 0.25, WH / 2, cz));
            if (!anyHall(h.x1 + 0.3, cz)) hw.push(box(0.5, WH, 1, h.x1 + 0.25, WH / 2, cz));
        }
    }
    addMesh(merge(hw), stone);
    addMesh(merge([box(40, 0.1, 88, 205, 0.03, -41)], 3), floorMat);
    addMesh(merge([box(40, 0.4, 88, 205, WH + 0.2, -41)]), darkStone);
    // Long tables with benches, roof beams, and a stone lintel over every doorway.
    const hallWood = [box(2, 0.12, 17, 194, 0.9, -15.5), box(2, 0.12, 17, 206, 0.9, -15.5)];
    for (const x of [194, 206]) {
        for (const z of [-23, -15.5, -8]) hallWood.push(box(1.6, 0.86, 0.14, x, 0.43, z));
        hallWood.push(box(0.4, 0.08, 16.5, x - 1.25, 0.5, -15.5), box(0.4, 0.08, 16.5, x + 1.25, 0.5, -15.5));
    }
    for (let z = -27; z <= -3; z += 6) hallWood.push(box(24, 0.5, 0.5, 200, WH - 0.3, z));
    addMesh(merge(hallWood, 1.5), wood);
    addMesh(merge([box(6, 1.2, 0.9, 200, 5.4, -29.8), box(0.9, 1.2, 6, 202.3, 5.4, -52.5), box(6, 1.2, 0.9, 219.5, 5.4, -55.2),
        box(6, 1.4, 0.5, 219.5, 5.3, -81.8), box(0.5, 4.6, 0.5, 216.9, 2.3, -81.8), box(0.5, 4.6, 0.5, 222.1, 2.3, -81.8)], 2.5), darkStone);
    pair('hallIn', 200, -0.12, 2.6, 4.8);
    pair('hallOut', 219.5, -81.84, 2.3, 4.6);
    setDoors('hallOut', -0.45, 0, true);     // ajar, with cold light from the godswood behind it
    const cold = addMesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({ color: 0x8fb8e8, fog: false }));
    cold.position.set(219.5, 2.3, -81.97);

    // Act V: the godswood. A ring of pines around a clearing, and the weirwood.
    const trunks = [], pines = [];
    for (let i = 0; i < 120; i++) {
        const a = rand(TAU), r = rand(39.5, 64), x = GROVE.x + Math.sin(a) * r, z = GROVE.z + Math.cos(a) * r, hgt = rand(6, 10);
        const t = new THREE.CylinderGeometry(0.28, 0.4, 3, 6); t.translate(x, 1.5, z); trunks.push(t);
        const c = new THREE.ConeGeometry(rand(2, 3), hgt, 7); c.translate(x, 2.4 + hgt / 2, z); pines.push(c);
    }
    addMesh(merge(trunks), wood);
    addMesh(merge(pines), new THREE.MeshLambertMaterial({ color: 0x1c2e26 }));
    const wt = new THREE.CylinderGeometry(0.8, 1.3, 7, 9); wt.translate(GROVE.treeX, 3.5, GROVE.treeZ);
    addMesh(merge([wt, box(0.5, 4, 0.5, GROVE.treeX - 1.6, 7.2, GROVE.treeZ, 0, 0.7), box(0.5, 4, 0.5, GROVE.treeX + 1.6, 7.2, GROVE.treeZ, 0, -0.7)]),
        new THREE.MeshLambertMaterial({ color: 0xf0ece4, map: tex(TX.bark) }));
    const leaves = [];
    for (const [dx, dy, dz, r] of [[0, 9.5, 0, 3.6], [-3, 8.6, 0.5, 2.8], [3, 8.6, -0.5, 2.8], [0.5, 8.8, 2.6, 2.6], [-0.5, 8.8, -2.6, 2.6]]) {
        const g = new THREE.IcosahedronGeometry(r, 0); g.translate(GROVE.treeX + dx, dy, GROVE.treeZ + dz); leaves.push(g);
    }
    addMesh(merge(leaves), new THREE.MeshLambertMaterial({ color: 0x8c1d1d }));
    obstacle(GROVE.treeX - 1.3, GROVE.treeX + 1.3, GROVE.treeZ - 1.3, GROVE.treeZ + 1.3);
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
        mat, pts,
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
const steel = new THREE.MeshPhongMaterial({ color: 0x9aa3b2, specular: 0x556070, shininess: 50 });
// Limbs hang from their pivot (shoulder or hip) at the origin, so one rotation swings them.
const armGeo = merge([cap(0.055, 0.44, 0, -0.28, 0), ball(0.066, 0, -0.6, 0)]);
const legGeo = merge([cap(0.08, 0.62, 0, -0.39, 0), box(0.13, 0.08, 0.26, 0, -0.82, 0.05)]);
const wArmGeo = merge([cap(0.04, 0.46, 0, -0.28, 0), ball(0.052, 0, -0.6, 0, 1, 1.4, 1)]);
const wLegGeo = merge([cap(0.058, 0.64, 0, -0.39, 0), box(0.1, 0.07, 0.22, 0, -0.82, 0.04)]);
const W_CAP = 130, A_CAP = 150, H_CAP = 52;
const WP = {
    // A wight: thin, stooped, a rag hanging off it.
    body: part(merge([
        cyl(0.2, 0.15, 0.58, 0, 1.14, 0.06, 0.3, 8, 0.6), cap(0.065, 0.34, 0, 1.37, 0.15, 0, Math.PI / 2),
        ball(0.115, 0, 1.55, 0.23, 0.9, 1.12, 1), box(0.12, 0.05, 0.1, 0, 1.45, 0.28), ball(0.16, 0, 0.88, 0, 1, 0.6, 0.7),
        box(0.3, 0.5, 0.02, 0, 0.72, -0.1, 0.15)
    ]), skin, W_CAP, true),
    eyes: part(merge([box(0.05, 0.035, 0.03, -0.045, 1.57, 0.335), box(0.05, 0.035, 0.03, 0.045, 1.57, 0.335)]),
        new THREE.MeshBasicMaterial({ color: 0x7fdcff, fog: false }), W_CAP),
    armL: part(wArmGeo, skin, W_CAP, true), armR: part(wArmGeo, skin, W_CAP, true),
    legL: part(wLegGeo, skin, W_CAP, true), legR: part(wLegGeo, skin, W_CAP, true)
};
const AP = {
    body: part(merge([
        cyl(0.25, 0.19, 0.6, 0, 1.16, 0, 0, 10, 0.62), cap(0.09, 0.42, 0, 1.42, 0, 0, Math.PI / 2), cyl(0.06, 0.07, 0.1, 0, 1.5, 0),
        ball(0.125, 0, 1.63, 0, 0.95, 1.1, 1), ball(0.2, 0, 0.88, 0, 1.05, 0.6, 0.7)
    ]), skin, A_CAP, true),
    armL: part(armGeo, skin, A_CAP, true), armR: part(armGeo, skin, A_CAP, true),
    legL: part(legGeo, skin, A_CAP, true), legR: part(legGeo, skin, A_CAP, true),
    arakh: part(merge([box(0.03, 0.6, 0.08, 0, -0.95, 0), box(0.03, 0.45, 0.07, 0, -1.42, 0.08, 0.35)]), steel, 60),
    flame: part((() => { const g = new THREE.OctahedronGeometry(0.2); g.scale(1, 2.6, 1); g.translate(0, -1.25, 0.04); return g; })(),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c, fog: false }), 60),
    spear: part(merge([cyl(0.018, 0.018, 2.5, 0, -0.58, 0.75, Math.PI / 2, 6), cyl(0.001, 0.045, 0.34, 0, -0.58, 2.15, Math.PI / 2, 6)]), steel, 100),
    sword: part(merge([box(0.045, 0.9, 0.012, 0, -1.02, 0), box(0.2, 0.03, 0.04, 0, -0.6, 0)]), steel, 30),
    shield: part(cyl(0.34, 0.34, 0.05, 0, -0.42, 0.16, Math.PI / 2, 14), new THREE.MeshLambertMaterial({ color: 0x23252c }), 100),
    helm: part((() => { const c = new THREE.ConeGeometry(0.035, 0.24, 6).toNonIndexed(); c.translate(0, 1.9, 0); return merge([ball(0.142, 0, 1.66, -0.01, 1, 1, 1.08), c]); })(),
        new THREE.MeshLambertMaterial({ color: 0x30333c }), 100)
};
const horseGeo = merge([
    cap(0.3, 1.1, 0, 1.27, 0, Math.PI / 2), ball(0.33, 0, 1.3, 0.55, 0.95, 1.05, 1),          // barrel and chest
    cyl(0.13, 0.21, 0.9, 0, 1.78, 0.86, 0.68, 8), cap(0.1, 0.36, 0, 2.08, 1.3, 1.25),          // neck and head
    box(0.05, 0.14, 0.05, -0.07, 2.3, 1.12), box(0.05, 0.14, 0.05, 0.07, 2.3, 1.12),            // ears
    box(0.05, 0.8, 0.16, 0, 1.86, 0.7, 0.68), cap(0.05, 0.55, 0, 1.12, -0.98, -0.35)            // mane and tail
]);
const HP = {
    body: part(horseGeo, skin, H_CAP, true),
    leg: part(merge([cap(0.055, 0.78, 0, -0.45, 0), box(0.1, 0.1, 0.13, 0, -0.92, 0.01)]), skin, H_CAP * 4, true)
};
const _root = new THREE.Matrix4(), _l = new THREE.Matrix4(), _w = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function limb(m, px, py, pz, ang, colour) {
    _l.makeRotationX(ang);
    _l.setPosition(px, py, pz);
    _w.multiplyMatrices(_root, _l);
    put(m, _w, colour);
}
function setRoot(f, lift, sway = 0) {
    _e.set(f.fall * f.fallDir * 1.5, f.yaw, sway, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(f.x, f.y + lift - f.sink, f.z);
    _s.set(f.scale, f.scale, f.scale);
    _root.compose(_p, _q, _s);
}
function drawWight(f) {
    setRoot(f, 0, f.moving ? Math.sin(f.t) * 0.07 : 0);
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

// ── First-person weapons (one per act) and the horse under the player ──
const fpSteel = new THREE.MeshPhongMaterial({ color: 0xb9c2cf, specular: 0x90a0b4, shininess: 70 });
const fpLeather = new THREE.MeshLambertMaterial({ color: 0x3a2a1e });
const fpWood = new THREE.MeshLambertMaterial({ color: 0x6a5038 });
const fpGlass = new THREE.MeshPhongMaterial({ color: 0x15171d, specular: 0xa8c8ff, shininess: 140, emissive: 0x04060c });
const fpSkin = new THREE.MeshLambertMaterial({ color: 0x8a6a52 });
const fpChar = new THREE.MeshLambertMaterial({ color: 0x1a1512 });
/**
 * reach/minCos/max: how far, how wide and how many a blow hits. swing/hitAt/cd: timing in seconds.
 * anim: how it moves on screen. burns: a brazier can light it (+1 damage, +1 target). lit: always burning.
 */
const WEAPONS = {
    arakh: { name: 'Arakh', reach: 2.7, minCos: 0.3, max: 2, dmg: 1, cd: 0.44, swing: 0.32, hitAt: 0.12, anim: 'slash', burns: true, scale: 0.62 },
    spear: { name: 'Spear', reach: 3.5, minCos: 0.8, max: 2, dmg: 2, cd: 0.55, swing: 0.3, hitAt: 0.13, anim: 'thrust', burns: true, scale: 0.6 },
    sword: { name: 'Longsword', reach: 2.9, minCos: 0.15, max: 3, dmg: 1, cd: 0.52, swing: 0.36, hitAt: 0.15, anim: 'slash', burns: true, scale: 0.62 },
    torch: { name: 'Torch', reach: 2.5, minCos: 0.3, max: 2, dmg: 2, cd: 0.46, swing: 0.32, hitAt: 0.12, anim: 'slash', lit: true, scale: 0.62 },
    dagger: { name: 'Dragonglass', reach: 2.3, minCos: 0.45, max: 1, dmg: 2, cd: 0.28, swing: 0.2, hitAt: 0.08, anim: 'stab', scale: 0.8 }
};
function fpWeapon(key, pieces, flames, forearm = true) {
    const W = WEAPONS[key], g = new THREE.Group();
    for (const [geos, mat] of pieces) g.add(new THREE.Mesh(merge(geos), mat));
    const hand = [ball(0.06, 0, -0.02, 0.01, 1, 1.25, 1.1)];
    if (forearm) hand.push(cap(0.045, 0.4, 0.04, -0.3, 0.2, -0.72));
    g.add(new THREE.Mesh(merge(hand), fpSkin));
    W.flames = flames.map(([x, y, z, size]) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, color: 0xffb060 }));
        s.position.set(x, y, z); s.userData.base = size; g.add(s);
        return s;
    });
    g.scale.setScalar(W.scale);
    g.visible = false;
    camera.add(g);
    W.group = g;
}
{
    const blade = [box(0.2, 0.04, 0.09, 0, 0.12, 0)];
    let x = 0, y = 0.14, a = 0;
    for (let i = 0; i < 7; i++) {       // a curved blade, built from short straight pieces
        const g = new THREE.BoxGeometry(0.03, 0.2, 0.085 - i * 0.006);
        g.rotateZ(a);
        g.translate(x - Math.sin(a) * 0.1, y + Math.cos(a) * 0.1, 0);
        blade.push(g);
        x -= Math.sin(a) * 0.19; y += Math.cos(a) * 0.19; a += 0.16;
    }
    fpWeapon('arakh', [[blade, fpSteel], [[cyl(0.024, 0.026, 0.3, 0, -0.05, 0)], fpLeather]],
        [0, 1, 2, 3, 4, 5].map((i) => { const t = i / 5; return [-t * t * 0.5, 0.25 + t, 0, 0.34 - t * 0.1]; }));
    fpWeapon('spear', [
        [[cyl(0.02, 0.02, 2.7, 0, 0.75, 0, 0, 7)], fpWood],
        [[cyl(0.001, 0.05, 0.36, 0, 2.28, 0, 0, 6, 0.4), cyl(0.03, 0.03, 0.08, 0, 2.08, 0, 0, 7)], fpSteel],
        [[ball(0.06, 0, 0.5, 0.01, 1, 1.25, 1.1)], fpSkin]
    ], [[0, 2.2, 0, 0.3], [0, 2.38, 0, 0.22]], false);
    fpWeapon('sword', [
        [[box(0.055, 0.98, 0.014, 0, 0.62, 0), cyl(0.001, 0.028, 0.1, 0, 1.16, 0, 0, 4, 0.3), box(0.28, 0.035, 0.05, 0, 0.11, 0), ball(0.036, 0, -0.17, 0)], fpSteel],
        [[cyl(0.022, 0.024, 0.24, 0, -0.03, 0)], fpLeather]
    ], [0, 1, 2, 3, 4].map((i) => [0, 0.3 + i * 0.2, 0, 0.3 - i * 0.03]));
    fpWeapon('torch', [
        [[cyl(0.026, 0.03, 0.75, 0, 0.22, 0, 0, 7)], fpWood],
        [[cyl(0.06, 0.045, 0.22, 0, 0.68, 0, 0, 8)], fpChar]
    ], [[0, 0.8, 0, 0.55], [0.02, 0.96, 0, 0.46], [-0.02, 1.12, 0, 0.34], [0, 1.26, 0, 0.22]]);
    fpWeapon('dagger', [
        [[cyl(0.001, 0.045, 0.36, 0, 0.3, 0, 0, 5, 0.35)], fpGlass],
        [[cyl(0.02, 0.022, 0.16, 0, 0.02, 0), box(0.1, 0.02, 0.035, 0, 0.11, 0)], fpLeather]
    ], []);
}
function equip(key) {
    P.weapon = key;
    if (!WEAPONS[key].burns) P.flame = 0;
}
const burning = () => { const W = WEAPONS[P.weapon]; return W.lit || (W.burns && P.flame > 0); };

// ── Shards thrown off by a blow: ice and old bone ──
const debris = (() => {
    const N = 180, pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -50;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.075, color: 0xcfe2f2, transparent: true, opacity: 0.9, depthWrite: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    let next = 0;
    return {
        burst(x, y, z, n, power = 3) {
            for (let k = 0; k < n; k++) {
                const i = next; next = (next + 1) % N;
                pos[i * 3] = x + rand(-0.15, 0.15); pos[i * 3 + 1] = y + rand(-0.3, 0.3); pos[i * 3 + 2] = z + rand(-0.15, 0.15);
                vel[i * 3] = rand(-power, power); vel[i * 3 + 1] = rand(0.5, power * 1.2); vel[i * 3 + 2] = rand(-power, power);
                life[i] = rand(0.5, 1.1);
            }
        },
        update(dt) {
            for (let i = 0; i < N; i++) {
                if (life[i] <= 0) continue;
                life[i] -= dt;
                vel[i * 3 + 1] -= 14 * dt;
                pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
                if (pos[i * 3 + 1] < 0.03) { pos[i * 3 + 1] = 0.03; vel[i * 3] = vel[i * 3 + 2] = 0; vel[i * 3 + 1] = 0; }
                if (life[i] <= 0) pos[i * 3 + 1] = -50;
            }
            geo.attributes.position.needsUpdate = true;
        }
    };
})();
const mount = new THREE.Group();
mount.add(new THREE.Mesh(merge([
    cap(0.31, 1.1, 0, 1.3, 0.25, Math.PI / 2), cyl(0.14, 0.21, 0.95, 0, 1.62, -0.95, -0.72, 8), cap(0.105, 0.4, 0, 1.9, -1.52, -1.95),
    box(0.05, 0.15, 0.05, -0.08, 2.12, -1.3), box(0.05, 0.15, 0.05, 0.08, 2.12, -1.3)
]), new THREE.MeshLambertMaterial({ color: 0x4a3626 })));
mount.add(new THREE.Mesh(box(0.07, 0.86, 0.2, 0, 1.76, -0.8, -0.72), new THREE.MeshLambertMaterial({ color: 0x17120e })));
scene.add(mount);

// ── Game state ──
const G = {
    mode: 'menu', act: 1, phase: '', t: 0, time: 0, kills: 0, clock: 0,
    hordeZ: Z_MUSTER, hordeV: 0, trenchLit: false, litT: -1, dawn: 0, gap: 0, hgap: 0, spawnT: 0,
    giant: false, uTotal: 0, god: false, bot: false, flags: {}
};
const P = {
    x: 0, z: Z_MUSTER, yaw: 0, pitch: 0, hp: 100, mounted: true, speed: 0, gallop: 0, bobT: 0,
    weapon: 'arakh', swingT: 0, cd: 0, hitPending: false, lastHurt: -99, shake: 0, fallT: 0, flame: 0, vign: 0, stepN: 0
};
const wights = [], allies = [];
const input = { keys: new Set(), sx: 0, sy: 0, attack: false, held: false };

const WCOLS = [0x7d8791, 0x66707c, 0x8b8f8a, 0x5a6470, 0x77808f].map((c) => new THREE.Color(c));
const HCOLS = [0x3b2a1d, 0x2a211b, 0x57422f, 0x1d1a18, 0x6a5540].map((c) => new THREE.Color(c));
const RCOLS = [0x6e4c33, 0x5c3f2b, 0x7a5a3d].map((c) => new THREE.Color(c));
const ICE = new THREE.Color(0xa9d6ee), KING = new THREE.Color(0x6fa8d8);
const UCOL = new THREE.Color(0x3a3d47), NCOLS = [0x5a4d42, 0x4b4f58, 0x62574a].map((c) => new THREE.Color(c));
const pick = (a) => a[(Math.random() * a.length) | 0];

function spawnWight(x, z, o = {}) {
    if (wights.length >= W_CAP - 2) return null;
    const w = {
        x, z, y: o.y || 0, vy: 0, yaw: Math.PI, hp: o.hp || 1, state: 'alive', t: rand(TAU), fall: 0, fallDir: -1, sink: 0, dead: 0,
        atkT: 0, wind: 0, cd: rand(0.2, 0.9), scan: rand(0.4), stagger: 0, scale: o.scale || rand(0.92, 1.08),
        speed: o.speed || rand(4.8, 6.2), col: o.col || pick(WCOLS), tgt: null, moving: false, dieAt: -1, hunter: rand() < 0.3,
        heavy: !!o.heavy, boss: !!(o.walker || o.king), walker: !!o.walker, king: !!o.king,
        dmg: o.dmg || 0, reach: o.reach || 0, windT: o.windT || 0.42, cdB: o.cdB || 1.1, maxHp: o.hp || 1
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
    hp: $('hp').firstElementChild, flame: $('flame').firstElementChild, sub: $('sub'), card: $('card'), vign: $('vign'), cross: $('cross'), fade: $('fade'), way: $('way'), wayD: $('way').lastElementChild };
let subTimer = 0, cardTimer = 0, crossTimer = 0;
function say(text, secs = 4.5) { el.sub.textContent = text; el.sub.classList.add('on'); subTimer = secs; }
function card(small, big) { el.card.firstElementChild.textContent = small; el.card.lastElementChild.textContent = big; el.card.classList.add('on'); cardTimer = 3.4; }
function objective(text, showBar) { el.obj.textContent = text; el.bar.style.display = showBar ? 'block' : 'none'; }
function once(key) { if (G.flags[key]) return false; G.flags[key] = true; return true; }
const ACT_NAMES = ['', 'Act I · The Charge', 'Act II · The Line', 'Act III · The Castle', 'Act IV · The Halls', 'Act V · The Godswood'];

function showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
    document.body.classList.toggle('playing', G.mode === 'play');
}
function refreshMenu() {
    const c = $('btn-continue');
    c.hidden = !(progress.act > 1);
    c.textContent = 'Continue · Act ' + ['', 'I', 'II', 'III', 'IV', 'V'][progress.act];
    const label = 'Sound: ' + (progress.muted ? 'off' : 'on');
    $('btn-sound').textContent = label;
    $('btn-sound2').textContent = label;
}

// ── Act setup ──
function resetWorld() {
    wights.length = 0; allies.length = 0;
    G.t = 0; G.trenchLit = false; G.litT = -1; G.dawn = 0; G.gap = 0; G.spawnT = 0; G.giant = false; G.flags = {};
    trenchEmitter.src.on = false;
    setDoors('gate', 1.4, 0, true); gateObstacle.on = false;
    setDoors('keep', 0, 0, true); keepGlow.visible = false;
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
        equip('arakh');
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
    } else if (n === 3) {
        Object.assign(P, { x: 0, z: WALL_Z + 6, yaw: Math.PI, mounted: false });
        beginSiege();
    } else if (n === 4) beginHalls();
    else beginGrove();
}
function beginHold() {
    G.act = 2; G.phase = 'hold'; G.t = 0; G.spawnT = 0;
    if (progress.act < 2) { progress.act = 2; save(); }
    el.act.textContent = ACT_NAMES[2];
    card('Act II', 'The Line');
    objective('Hold the line until the horn', true);
    equip('spear');
    say('An Unsullied hands you a spear. Thrust past the shields. A brazier behind the line will light it.', 6.5);
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
    setDoors('gate', 0); gateObstacle.on = true;
    equip('sword');
    P.z = Math.max(P.z, WALL_Z + 2.2);
    Sfx.play('gate');
    card('Act III', 'The Castle');
    objective('Survive until dawn', true);
    say('You pull a longsword from a dead man\'s hand. The gate is shut. Then the dead begin to climb.', 6);
    Sfx.setAmbience({ wind: 0.3, battle: 1, fire: 0.6, gallop: 0, drums: 0.6 });
}

// ── Combat ──
function hurt(d) {
    if (G.god || G.mode !== 'play' || G.phase === 'dawn') return;
    P.hp -= d; P.lastHurt = G.clock; P.shake = Math.min(1, P.shake + 0.5); P.vign = 1;
    Sfx.play('hurt');
    if (P.hp <= 0) die();
}
function die(text) {
    P.hp = 0; G.mode = 'dead';
    Sfx.stopAll(); Sfx.play('screech', { vol: 0.8 });
    $('dead-text').textContent = text || pick([
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
    w.hp -= dmg; w.stagger = w.heavy ? 0.12 : 0.3; if (!w.heavy) { w.wind = 0; w.atkT = 0; }
    if (w.hp <= 0) {
        w.state = 'dying'; w.fallDir = -1;
        debris.burst(w.x, 1.2 * w.scale, w.z, w.heavy ? 26 : 10, w.heavy ? 5 : 3);
        if (byPlayer) { G.kills++; Sfx.play(w.boss ? 'shatter' : 'kill'); }
    } else {
        debris.burst(w.x, 1.3 * w.scale, w.z, 4, 2);
        if (byPlayer) Sfx.play('hit');
    }
}
function strike() {
    const W = WEAPONS[P.weapon], lit = W.burns && P.flame > 0;
    const reach = P.mounted ? 3.4 : W.reach, minCos = P.mounted ? -0.25 : W.minCos;
    const max = (P.mounted ? 3 : W.max) + (lit && !P.mounted ? 1 : 0), dmg = W.dmg + (lit ? 1 : 0);
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
        if (!w.heavy) nudge(w, (w.x - P.x) / d * 0.5, (w.z - P.z) / d * 0.5);
    }
    if (hits.length) { el.cross.classList.add('hit'); crossTimer = 0.12; P.shake = Math.min(1, P.shake + 0.15); }
}
function nudge(o, dx, dz) {
    if (G.act === 4) hallMove(o, o.x + dx, o.z + dz, 0.3); else { o.x += dx; o.z += dz; }
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
    const k = input.keys, px0 = P.x, pz0 = P.z;
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
        if (G.act === 4) { const nx = P.x, nz = P.z; P.x = px0; P.z = pz0; hallMove(P, nx, nz, 0.45, true); }
        else resolve(P, 0.45);
    }
    if (G.act <= 3) { P.x = clamp(P.x, -84, 84); P.z = Math.max(P.z, -335); }
    else if (G.act === 5) {
        const dx = P.x - GROVE.x, dz = P.z - GROVE.z, d = Math.hypot(dx, dz);
        if (d > GROVE.r) { P.x = GROVE.x + dx / d * GROVE.r; P.z = GROVE.z + dz / d * GROVE.r; }
    }
    if (G.act === 1 && G.phase !== 'afoot' && G.phase !== 'retreat') P.z = Math.min(P.z, Z_LINE - 8);
    if (G.act === 2 && G.phase === 'hold') P.z = Math.min(P.z, 6);
    if (G.act === 3) P.z = Math.max(P.z, gateObstacle.on ? WALL_Z + 1.7 : WALL_Z - 12);

    // Strike
    P.cd -= dt;
    if ((input.attack || input.held) && P.cd <= 0 && P.fallT <= 0 && G.phase !== 'muster') {
        const W = WEAPONS[P.weapon];
        P.swingT = W.swing; P.cd = W.cd; P.hitPending = true;
        Sfx.play('swing');
    }
    input.attack = false;
    if (P.swingT > 0) {
        P.swingT -= dt;
        const W = WEAPONS[P.weapon];
        if (P.hitPending && P.swingT <= W.swing - W.hitAt) { P.hitPending = false; strike(); }
    }
    // Slow recovery when left alone for a while
    if (G.clock - P.lastHurt > 6 && P.hp < 100) P.hp = Math.min(100, P.hp + 5 * dt);
    // A burning blade bites deeper; braziers relight it.
    if (!P.mounted && WEAPONS[P.weapon].burns) {
        if (P.flame > 0) P.flame -= dt;
        if (P.flame < 8) for (const b of BRAZIERS) {
            if (b.on && Math.abs(b.x - P.x) < 2 && Math.abs(b.z - P.z) < 2) {
                P.flame = 30; Sfx.play('ignite', { vol: 0.5 });
                if (once('relit')) say('Your ' + WEAPONS[P.weapon].name.toLowerCase() + ' catches. Fire kills them faster.', 4);
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
    G.gap -= dt; G.hgap -= dt;
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
            const a = G.act === 1 || w.king ? null : nearestAlly(w.x, w.z, 10);
            w.tgt = a && Math.hypot(a.x - w.x, a.z - w.z) < dp * (G.act >= 3 ? 0.6 : 0.85) ? a : null;
        }
        if (w.tgt && w.tgt.state !== 'alive') w.tgt = null;
        let tx = w.tgt ? w.tgt.x : P.x, tz = w.tgt ? w.tgt.z : P.z;
        // In Act II the dead walk at the spear line, not all at the player.
        if (!w.tgt && !w.hunter && G.act === 2 && w.z < Z_LINE - 3 && Math.hypot(P.x - w.x, P.z - w.z) > 9) { tx = w.x; tz = Z_LINE + 1; }
        // The Night King walks for the weirwood unless the player gets in his way.
        let passing = false;
        if (w.king && Math.hypot(P.x - w.x, P.z - w.z) > 7) { tx = GROVE.treeX; tz = GROVE.treeZ - 2; passing = true; }
        const reach = w.reach || (!w.tgt && P.mounted ? 2.2 : 1.55);
        let gx = tx, gz = tz, blocked = false;
        if (G.act === 4) {      // follow the passages round the corners
            const ws = hallSeg(w.x, w.z), ps = hallSeg(P.x, P.z);
            if (ws[1] >= 0 && ps[0] >= 0) {
                if (ws[1] < ps[0]) { gx = HALL_JOINTS[ws[1]][0]; gz = HALL_JOINTS[ws[1]][1]; }
                else if (ws[0] > ps[1]) { gx = HALL_JOINTS[ws[0] - 1][0]; gz = HALL_JOINTS[ws[0] - 1][1]; }
            }
        }
        if (G.act === 2 || G.act === 3) {       // funnel through the bridge and the gate; stop at a burning trench
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
        const inReach = dT < reach && !blocked && !passing;
        if (w.wind > 0) {
            w.wind -= dt; w.moving = false;
            if (w.wind <= 0) {
                if (w.tgt) {
                    if (dT < reach + 0.7) { w.tgt.hp -= w.heavy ? 6 : 1; if (w.tgt.hp <= 0) { w.tgt.state = 'dying'; w.tgt.fallDir = -1; } }
                } else if (dT < reach + 0.6) hurt(w.dmg || (P.mounted ? 8 : 10));
            }
        } else if (inReach) {
            w.moving = false;
            w.yaw = Math.atan2(tx - w.x, tz - w.z);
            if (w.cd <= 0 && (w.tgt || (w.heavy ? G.hgap <= 0 : G.gap <= 0))) {
                if (!w.tgt) { if (w.heavy) G.hgap = 1.1; else G.gap = P.mounted ? 0.8 : 0.5; }
                w.wind = w.windT; w.atkT = w.wind + 0.12; w.cd = w.cdB + rand(0.5);
                if (rand() < 0.12) Sfx.play('screech', { vol: 0.35, pan: clamp((w.x - P.x) / 12, -1, 1) });
            }
        } else if (d > 0.25) {
            const sp = w.speed * dt;
            nudge(w, dx / d * sp, dz / d * sp);
            w.yaw = Math.atan2(dx, dz); w.t += w.speed * dt * 1.7; w.moving = true;
        } else { w.moving = false; if (blocked) w.yaw = 0; }
        if (G.act === 2 || G.act === 3) {
            if (lit && w.z > TRENCH_Z0 - 0.4 && w.z < TRENCH_Z1 + 0.4) { w.state = 'dying'; continue; }   // caught on the burning bridge
            if (w.z > 4) resolve(w, w.heavy ? 1.2 : 0.35);
        }
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
            if (!a.heavy) nudge(a, -dx / d * push, -dz / d * push);
            if (!b.heavy) nudge(b, dx / d * push, dz / d * push);
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
                if (!w.boss && rand() < (a.kind === 'north' ? 0.5 : 0.45)) damageWight(w, 1, false);
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
        const k = Math.min(1, t / SIEGE_SECS);
        el.barI.style.width = k * 100 + '%';
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
            setDoors('gate', 0, 1.5); gateObstacle.on = false;
            Sfx.play('gate'); Sfx.play('screech');
            P.shake = 1;
            say('THE GATE! Something huge is coming through.', 5);
            spawnWight(0, WALL_Z - 5, { heavy: true, scale: 2.7, hp: 14, speed: 2.7, dmg: 30, reach: 3.6, windT: 0.8, cdB: 2.2 });
        }
        if (t > 62 && once('s2')) { Sfx.play('dragon'); say('Somewhere above the clouds, dragons are screaming.', 4.5); }
        if (t >= SIEGE_SECS) {
            if (once('keep')) {
                Sfx.play('horn', { rate: 0.9 });
                say('The yard is lost. FALL BACK into the keep!', 6);
                objective('Fall back into the keep');
                setDoors('keep', -1.25); keepGlow.visible = true;
            }
            if (Math.abs(P.x) < 2.7 && P.z > 80.7) beginHalls();
        }
    }
}

function simAct4(dt) {
    const lo = hallSeg(P.x, P.z)[0];
    el.barI.style.width = clamp((-P.z + Math.max(0, P.x - 200)) / 100 * 100, 0, 100) + '%';
    const pack = (n, x0, x1, z0, z1) => { for (let i = 0; i < n; i++) spawnWight(rand(x0, x1), rand(z0, z1), { speed: rand(4.4, 5.6), hp: i % 3 ? 1 : 2 }); };
    if (lo >= 1 && once('h1')) { pack(4, 196, 204, -6, -2); pack(6, 208, 220, -53.5, -51.5); say('They followed you in.', 4); Sfx.play('screech', { vol: 0.6 }); }
    if (lo >= 2 && once('h2')) pack(7, 218.2, 220.8, -68, -57);
    if (lo >= 3 && once('h3')) { pack(7, 218.2, 220.8, -80, -71); say('Cold air ahead. The godswood door.', 4); }
    G.spawnT -= dt;
    if (G.spawnT <= 0) {
        G.spawnT = 3.2;
        const j = lo > 0 ? HALL_JOINTS[lo - 1] : [200, -1.5];
        if (alive() < 14 && Math.hypot(j[0] - P.x, j[1] - P.z) > 8) spawnWight(j[0] + rand(-0.8, 0.8), j[1], { speed: rand(5, 6) });
    }
    if (lo === 3 && P.z < HALL_EXIT_Z) beginGrove();
}

function simAct5(dt) {
    const t = G.t, ring = (r, a0, a1) => { const a = rand(a0, a1); return [GROVE.x + Math.sin(a) * r, GROVE.z + Math.cos(a) * r]; };
    G.spawnT -= dt;
    if (G.phase === 'grove') {
        const k = t / GROVE_SECS;
        el.barI.style.width = Math.min(100, k * 100) + '%';
        if (G.spawnT <= 0) {
            G.spawnT = lerp(0.9, 0.4, k);
            if (alive() < lerp(14, 40, k)) { const [x, z] = ring(39, 0, TAU); spawnWight(x, z, { hp: rand() < 0.3 ? 2 : 1 }); }
        }
        if (t >= GROVE_SECS) {
            G.phase = 'walkers'; G.t = 0;
            Sfx.play('horn', { rate: 0.6 }); Sfx.setAmbience(AMBIENCE.walkers);
            say('The dead stop. They part. Something else walks out of the trees.', 6);
            objective('Kill the White Walkers', true);
            for (const w of wights) if (w.state === 'alive' && rand() < 0.7) w.dieAt = rand(0.2, 2);
            for (let i = 0; i < 4; i++) {       // they come from the north, opposite the way you came in
                const [x, z] = ring(37, Math.PI - 0.9 + i * 0.6, Math.PI - 0.9 + i * 0.6);
                spawnWight(x, z, { walker: true, heavy: true, hp: 12, scale: 1.22, speed: 2.4, col: ICE, dmg: 16, reach: 2.5, windT: 0.9, cdB: 2.2 });
            }
        }
        return;
    }
    if (G.phase === 'walkers') {
        let left = 0;
        for (const w of wights) if (w.walker && w.state === 'alive') left++;
        el.barI.style.width = (4 - left) / 4 * 100 + '%';
        if (G.spawnT <= 0) { G.spawnT = 2.2; if (alive() < 8) { const [x, z] = ring(39, 0, TAU); spawnWight(x, z); } }
        if (left === 0) {
            G.phase = 'king'; G.t = 0; G.spawnT = 9;
            Sfx.play('screech'); Sfx.play('horn', { rate: 0.5 }); Sfx.setAmbience(AMBIENCE.king);
            say('The last one shatters. Then the Night King steps out of the dark.', 6);
            objective('Bring down the Night King before he reaches the tree', true);
            spawnWight(GROVE.x, GROVE.z - 37, { king: true, heavy: true, hp: 60, scale: 1.45, speed: 1.5, col: KING, dmg: 24, reach: 3, windT: 0.9, cdB: 2.2 });
        }
        return;
    }
    if (G.phase === 'king') {
        const king = wights.find((w) => w.king);
        if (!king || king.state !== 'alive') {
            beginDawn('The Night King breaks like ice. Then every one of them falls.');
            return;
        }
        el.barI.style.width = clamp(king.hp / king.maxHp * 100, 0, 100) + '%';
        // He only wins by walking there unopposed; a fight that drifts under the tree does not count.
        if (Math.hypot(king.x - GROVE.treeX, king.z - GROVE.treeZ) < 3.4 && Math.hypot(P.x - king.x, P.z - king.z) > 7) { die('The Night King reaches the weirwood. The long night does not end.'); return; }
        if (G.spawnT <= 0) {
            G.spawnT = 11;
            if (once('raise')) say('He lifts his arms. The dead get back up.', 4.5);
            Sfx.play('screech', { vol: 0.7 });
            for (let i = 0; i < 5; i++) { const a = rand(TAU), r = rand(11, 17); spawnWight(clampGrove(P.x + Math.sin(a) * r, 0), clampGrove(P.z + Math.cos(a) * r, 1)); }
        }
    }
}
function clampGrove(v, axis) { const c = axis ? GROVE.z : GROVE.x; return clamp(v, c - 26, c + 26); }
function beginHalls() {
    G.act = 4; G.phase = 'halls'; G.t = 0; G.spawnT = 3; G.flags = {};
    if (progress.act < 4) { progress.act = 4; save(); }
    el.act.textContent = ACT_NAMES[4];
    wights.length = 0; allies.length = 0;
    G.trenchLit = false; trenchEmitter.src.on = false;
    Object.assign(P, { x: 200, z: -2.5, yaw: 0, pitch: 0, mounted: false });
    for (let i = 0; i < 9; i++) spawnWight(rand(190, 210), rand(-28, -14), { speed: rand(4.4, 5.4), hp: i % 3 ? 1 : 2 });
    for (let i = 0; i < 5; i++) spawnWight(rand(198.5, 201.5), rand(-48, -36), { speed: rand(4.4, 5.4) });
    Sfx.play('gate');
    card('Act IV', 'The Halls');
    objective('Fight through the keep to the godswood', true);
    equip('torch');
    say('You take a torch from the wall. The keep is dark, and it is not empty.', 5.5);
    Sfx.setAmbience(Object.assign({ wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0 }, AMBIENCE.halls));
}
function beginGrove() {
    G.act = 5; G.phase = 'grove'; G.t = 0; G.spawnT = 2; G.flags = {};
    if (progress.act < 5) { progress.act = 5; save(); }
    el.act.textContent = ACT_NAMES[5];
    wights.length = 0; allies.length = 0;
    Object.assign(P, { x: GROVE.x, z: GROVE.z + 33, yaw: 0, pitch: 0, mounted: false });
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        mkAlly('north', GROVE.treeX + Math.sin(a) * 6, GROVE.treeZ + Math.cos(a) * 6, a);
    }
    G.uTotal = allies.length;
    card('Act V', 'The Godswood');
    objective('Defend the weirwood', true);
    equip('dagger');
    say('Someone presses a dragonglass dagger into your hand. Hold the tree.', 6);
    Sfx.setAmbience(Object.assign({ wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0 }, AMBIENCE.grove));
}
function beginDawn(text) {
    G.phase = 'dawn'; G.t = 0;
    Sfx.play('shatter'); Sfx.setAmbience({ battle: 0, drums: 0, fire: 0.3, wind: 0.4 });
    for (const w of wights) if (w.state === 'alive') w.dieAt = rand(0.1, 1.6);
    say(text, 6);
    objective('Dawn');
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
    // Step back out of a heavy blow while it is winding up, as a player would.
    for (const h of wights) {
        if (h.heavy && h.state === 'alive' && h.wind > 0 && !h.tgt && Math.hypot(h.x - P.x, h.z - P.z) < 5) {
            P.yaw = Math.atan2(-(h.x - P.x), -(h.z - P.z)); input.sy = -1; input.held = true; return;
        }
    }
    const w = nearestWight(P.x, P.z, P.mounted ? 4 : 5);
    let tx = P.x, tz = P.z - 10, move = 1;
    if (G.act === 1) {
        if (G.phase === 'retreat' || G.phase === 'afoot') { tx = 0; tz = Z_LINE; }
        else if (G.phase === 'clash') { tx = Math.sin(G.t * 0.5) * 40; tz = Z_CLASH + 30 + Math.cos(G.t * 0.5) * 30; }
    }
    else if (G.act === 2 && G.phase === 'hold') { tx = 0; tz = Z_LINE - 0.5; move = Math.hypot(P.x - tx, P.z - tz) > 1.5 ? 1 : 0; }
    else if (G.act === 2) { tx = 0; tz = P.z < TRENCH_Z1 + 1 && Math.abs(P.x) > 2 ? TRENCH_Z0 - 2 : WALL_Z + 8; }
    else if (G.act === 3) {
        if (G.flags.keep) { tx = 0; tz = 81.5; } else { tx = 2; tz = 64; move = Math.hypot(P.x - tx, P.z - tz) > 3 ? 1 : 0; }
    } else if (G.act === 4) {
        const hi = hallSeg(P.x, P.z)[1];
        if (hi < 3) { tx = HALL_JOINTS[Math.max(0, hi)][0]; tz = HALL_JOINTS[Math.max(0, hi)][1]; } else { tx = 219.5; tz = -82; }
    } else {
        const king = wights.find((k) => k.king && k.state === 'alive');
        tx = king ? king.x : GROVE.treeX; tz = king ? king.z : GROVE.treeZ + 5;
        move = Math.hypot(P.x - tx, P.z - tz) > (king ? 2.4 : 3) ? 1 : 0;
        if (king && P.z > GROVE.treeZ - 2 && king.z < GROVE.treeZ && Math.abs(P.x - GROVE.treeX) < 2.6) { tx = GROVE.treeX + 4.5; tz = GROVE.treeZ - 1; move = 1; }   // go round the trunk
        if (king && !(w && Math.hypot(w.x - P.x, w.z - P.z) < 2.6 && !w.king)) { P.yaw = Math.atan2(-(tx - P.x), -(tz - P.z)); input.sy = move; input.held = true; return; }
    }
    const fleeing = G.phase === 'retreat' || G.phase === 'afoot' || G.phase === 'fallback' || (G.act === 3 && G.flags.keep);
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
    if (G.phase === 'dawn') { G.dawn = clamp((G.t - 1.5) / 6, 0, 1); if (G.t > 8.5) win(); }
    else [null, simAct1, simAct2, simAct3, simAct4, simAct5][G.act](dt);
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
        for (const k in WEAPONS) WEAPONS[k].group.visible = false;
        mount.visible = false; swordLight.intensity = 0;
    } else {
        let eye = P.mounted ? 2.62 + Math.sin(P.gallop * 2) * 0.07 : 1.7 + Math.sin(P.bobT * 1.5) * 0.045;
        let roll = 0;
        if (P.fallT > 0) { const k = Math.sin(clamp(P.fallT / 1.2, 0, 1) * Math.PI); eye = 1.7 - k * 1.05; roll = k * 0.55; }
        if (G.mode === 'dead') { eye = 0.5; roll = 1.1; }
        P.shake = Math.max(0, P.shake - dt * 2.5);
        const sh = P.shake * 0.05;
        camera.position.set(P.x + rand(-sh, sh), eye + rand(-sh, sh), P.z);
        camera.rotation.set(P.pitch + (P.mounted ? Math.sin(P.gallop * 2) * 0.012 : 0), P.yaw, roll);
        // Weapon in hand
        const W = WEAPONS[P.weapon], wg = W.group;
        for (const k in WEAPONS) WEAPONS[k].group.visible = false;
        wg.visible = G.mode !== 'dead';
        const s = P.swingT > 0 ? 1 - P.swingT / W.swing : -1;
        const idle = Math.sin(t * 1.7) * 0.012 + (P.mounted ? 0 : Math.sin(P.bobT * 1.5) * 0.012);
        if (W.anim === 'thrust') {
            const e = s >= 0 ? Math.sin(s * Math.PI) : 0;
            wg.position.set(lerp(0.3, 0.16, e), -0.4 + idle + e * 0.05, lerp(-0.3, -1.0, e));
            wg.rotation.set(-1.44, 0.05, 0.04);
        } else if (W.anim === 'stab') {
            const e = s >= 0 ? Math.sin(s * Math.PI) : 0;
            wg.position.set(lerp(0.32, 0.1, e), lerp(-0.36, -0.26, e) + idle, lerp(-0.52, -0.9, e));
            wg.rotation.set(lerp(-0.6, -1.4, e), 0.3, -0.3);
        } else if (s >= 0) {
            const e = Math.sin(s * Math.PI * 0.5);
            wg.position.set(lerp(0.5, -0.28, e), lerp(-0.2, -0.5, e), -0.62);
            wg.rotation.set(lerp(-0.3, -1.25, e), 0.2, lerp(-0.7, 1.35, e));
        } else {
            wg.position.set(0.4, -0.46 + idle, -0.66);
            wg.rotation.set(-0.32, 0.25, -0.22);
        }
        const alight = burning();
        for (let i = 0; i < W.flames.length; i++) {
            const f = W.flames[i];
            f.visible = alight;
            const sc = f.userData.base * (0.8 + 0.4 * Math.abs(Math.sin(t * 14 + i * 1.9)));
            f.scale.set(sc, sc * 1.5, 1);
        }
        swordLight.intensity = alight ? (W.lit ? 17 : 13) * (0.85 + 0.15 * Math.sin(t * 15)) : 0;
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
    snow.pts.visible = G.act !== 4 || G.mode === 'menu';
    for (const w of wights) drawWight(w);
    for (const a of allies) if (a.state !== 'gone') drawAlly(a);
    for (const k in WP) flush(WP[k]);
    for (const k in AP) flush(AP[k]);
    flush(HP.body); flush(HP.leg);
    // Doors swing towards their targets.
    for (const k in doors) for (const d of doors[k]) {
        d.rotation.y += (d.userData.ry - d.rotation.y) * Math.min(1, dt * 3);
        d.rotation.x += (d.userData.rx - d.rotation.x) * Math.min(1, dt * 5);
    }
    sky.position.copy(camera.position);
    sky.material.opacity = 1 - G.dawn;
    debris.update(dt);
    fire.update(t);
    snow.update(dt, camera.position.x, camera.position.z);
    if (horde.pts.visible) horde.update(t, G.hordeZ);
    updateLights(t);
    renderer.render(scene, camera);
    updateWay();
}
// ── Waypoint: a marker on screen for the door (or the enemy) the objective is about ──
function wayTarget() {
    if (G.act === 1) return G.phase === 'retreat' || G.phase === 'afoot' ? [0, 2, Z_LINE] : null;
    if (G.act === 2) return G.phase !== 'fallback' ? null : P.z < TRENCH_Z1 ? [0, 1.2, 10] : [0, 3, WALL_Z];
    if (G.act === 3) return G.flags.keep ? [0, 3, 81.8] : null;
    if (G.act === 4) { const hi = hallSeg(P.x, P.z)[1]; return hi >= 0 && hi < 3 ? [HALL_JOINTS[hi][0], 1.6, HALL_JOINTS[hi][1]] : [219.5, 2.6, -81.8]; }
    if (G.phase === 'king') { const k = wights.find((w) => w.king && w.state === 'alive'); return k ? [k.x, 3.2, k.z] : null; }
    return null;
}
const _v = new THREE.Vector3();
function updateWay() {
    const w = G.mode === 'play' ? wayTarget() : null;
    if (!w) { el.way.style.display = 'none'; return; }
    const d = Math.hypot(w[0] - P.x, w[2] - P.z);
    _v.set(w[0], w[1], w[2]).project(camera);
    let x = _v.x, y = _v.y;
    const behind = _v.z > 1;
    if (behind) { x = -x; y = -y; }
    const m = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.8);
    if (m > 1) { x /= m; y /= m; } else if (behind) { x = x >= 0 ? 0.88 : -0.88; }
    el.way.style.display = d < 2.5 ? 'none' : 'block';
    el.way.style.transform = `translate(${((x * 0.5 + 0.5) * window.innerWidth).toFixed(1)}px,${((-y * 0.5 + 0.5) * window.innerHeight).toFixed(1)}px)`;
    el.wayD.textContent = Math.round(d) + ' m';
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
    const W = WEAPONS[P.weapon];
    el.flame.style.width = (W.lit || (P.mounted && P.flame > 0) ? 100 : W.burns ? clamp(P.flame / 30 * 100, 0, 100) : 0) + '%';
    el.kills.textContent = G.kills;
    const n = aliveAllies();
    el.allies.textContent = G.act === 1 ? (G.phase === 'muster' || G.phase === 'charge' ? 'the horde rides' : '') :
        G.act === 4 ? 'alone' : n + (G.act === 2 ? ' Unsullied' : G.act === 5 ? ' ironborn' : ' defenders');
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
    fallback: { battle: 1, fire: 0.6, drums: 0.8 }, siege: { wind: 0.3, battle: 1, fire: 0.6, drums: 0.6 }, dawn: { wind: 0.4, fire: 0.3 },
    halls: { wind: 0.12, battle: 0.3, fire: 0.5, drums: 0.5 }, grove: { wind: 0.6, battle: 0.7, fire: 0.4, drums: 0.7 },
    walkers: { wind: 0.9, battle: 0.2, fire: 0.3, drums: 0.9 }, king: { wind: 1, battle: 0.3, fire: 0.3, drums: 1 }
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
            return { mode: G.mode, act: G.act, phase: G.phase, t: G.t, hp: P.hp, kills: G.kills, x: P.x, z: P.z, mounted: P.mounted, weapon: P.weapon,
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
