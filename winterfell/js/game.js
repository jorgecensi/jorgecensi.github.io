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
import { buildModels } from './models.js';

const $ = (id) => document.getElementById(id);
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const DEBUG = new URLSearchParams(location.search).has('debug');
const STORE_KEY = 'winterfell-progress-v1';
// High quality (moon shadows, normal maps) is the default on desktop; phones get the lighter path. `?q=high` or `?q=low` overrides.
const QUALITY = new URLSearchParams(location.search).get('q');
const HQ = QUALITY ? QUALITY === 'high' : !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

// ── World layout (metres). North, where the dead come from, is -Z. ──
const Z_MUSTER = -30;      // where the horde starts
const Z_CLASH = -250;      // where the horde meets the dead
const Z_LINE = -14;        // front rank of the Unsullied
const TRENCH_Z0 = 8, TRENCH_Z1 = 12, BRIDGE_HALF = 4;
const WALL_Z = 40, GATE_HALF = 5;
// The castle follows the fan map of Winterfell, at about a third of its size: the North Gate at x = 0, the godswood
// inside the walls to the west, the yard and its buildings to the east, the Great Keep in the middle of the yard.
const CASTLE = [[-68, 40], [59, 40], [96, 74], [96, 223], [-15.5, 223], [-68, 173]];     // wall corners, clockwise from the north-west
const KEEP_DOOR = [63, 124];            // the Great Keep's door, on its north face
const WOOD_WALL_X = -10, WOOD_WALL_Z = 130;     // the godswood's inner walls (east side and south side)
const MM = { walls: [], blds: [], rounds: [], gates: [[0, 40], [21.7, 223], [96, 90], [-68, 138]] };      // what the minimap draws
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
const GROVE = { x: -38, z: 88, r: 27, treeX: -38, treeZ: 78 };
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
renderer.shadowMap.enabled = HQ;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
// The light comes from where the moon is painted in the sky (see textures.js): low in the south-east, behind the castle.
const MOON_DIR = new THREE.Vector3(0.5, 0.45, 0.866).normalize();
moon.position.copy(MOON_DIR).multiplyScalar(120);
moon.castShadow = HQ;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = moon.shadow.camera.bottom = -46;
moon.shadow.camera.right = moon.shadow.camera.top = 46;
moon.shadow.camera.near = 1; moon.shadow.camera.far = 260;
moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.06;
scene.add(moon);
scene.add(moon.target);
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
    const tinted = parts.some((g) => g.attributes.color), col = tinted ? new Float32Array(n * 3).fill(1) : null;
    let o = 0;
    for (const g of parts) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        if (g.attributes.color) col.set(g.attributes.color.array, o * 3);
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
    if (tinted) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
}
/** A copy of a model geometry placed in the world: scaled, turned about Y, then moved. */
function at(geo, x, y, z, ry = 0, sc = 1) {
    const g = geo.clone();
    if (sc !== 1) g.scale(sc, sc, sc);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return g;
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
const MD = buildModels(THREE);
function tex(canvas, rx = 1, ry = 1, linear = false) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
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
const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
/** Relief from a normal map, on the high-quality path only. */
function relief(mat, canvas, rx, ry, strength = 1) {
    if (!HQ || !canvas) return;
    mat.normalMap = tex(canvas, rx, ry, true);
    mat.normalScale.set(strength, strength);
}
relief(stone, TX.stoneN, 1.33, 1.33, 1.2);
relief(darkStone, TX.darkStoneN, 1.33, 1.33, 1.2);
relief(wood, TX.woodN, 3.3, 3.3, 0.8);
relief(doorMat, TX.doorN, 1, 1, 1);
relief(floorMat, TX.floorN, 1, 1, 1);
function addMesh(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = HQ && !mat.isMeshBasicMaterial;
    scene.add(m);
    return m;
}

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
    const snowMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: snowTex });
    relief(snowMat, TX.snowN, 90, 130, 0.7);
    if (TX.snowDetail) { snowMat.aoMap = tex(TX.snowDetail, 520, 740, true); snowMat.aoMapIntensity = 1.2; }
    const ground = addMesh(new THREE.PlaneGeometry(700, 1000), snowMat);
    ground.castShadow = false;
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -150);
    // The yard is trampled mud, not snow.
    const mudMat = new THREE.MeshLambertMaterial({ color: 0xb0aca6, map: tex(TX.mud, 17, 30) });
    relief(mudMat, TX.mudN, 17, 30, 1);
    const yard = addMesh(new THREE.PlaneGeometry(105, 183), mudMat);
    yard.castShadow = false;
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(43.5, 0.02, 131.5);

    const H = 14, stoneG = [], darkG = [], roofG = [], glowG = [];
    /** A stretch of wall between two points, with merlons, collision and a line on the minimap. */
    const wall = (x0, z0, x1, z1, h = H, th = 3, crenellated = true) => {
        const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
        const g = new THREE.BoxGeometry(th, h, len); g.rotateY(ang); g.translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
        stoneG.push(g);
        if (crenellated) for (let d = 1.6; d < len - 1; d += 3.2) {
            const m = new THREE.BoxGeometry(th * 0.5, 1.5, 1.7); m.rotateY(ang);
            m.translate(x0 + dx / len * d, h + 0.75, z0 + dz / len * d);
            stoneG.push(m);
        }
        if (Math.abs(dx) < 0.01 || Math.abs(dz) < 0.01) obstacle(Math.min(x0, x1) - th / 2, Math.max(x0, x1) + th / 2, Math.min(z0, z1) - th / 2, Math.max(z0, z1) + th / 2);
        else for (let d = 0; d <= len; d += 1.5) { const x = x0 + dx / len * d, z = z0 + dz / len * d; obstacle(x - 1.6, x + 1.6, z - 1.6, z + 1.6); }
        MM.walls.push([x0, z0, x1, z1]);
    };
    const tower = (x, z, r, h, solid = true) => {
        const g = new THREE.CylinderGeometry(r, r * 1.08, h, 10); g.translate(x, h / 2, z); darkG.push(g);
        const roof = new THREE.ConeGeometry(r * 1.15, r * 1.3, 10); roof.translate(x, h + r * 0.65, z); roofG.push(roof);
        if (solid) obstacle(x - r * 0.8, x + r * 0.8, z - r * 0.8, z + r * 0.8);
        MM.rounds.push([x, z, r]);
    };
    /** A rectangular building with a hipped roof and a few lit windows on its long sides. */
    const building = (x0, x1, z0, z1, h, lit = 2) => {
        const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        darkG.push(box(w, h, d, cx, h / 2, cz));
        const roof = new THREE.CylinderGeometry(0, 0.7071, 1, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(w * 1.1, Math.min(w, d) * 0.45, d * 1.1);
        roof.translate(cx, h + Math.min(w, d) * 0.225, cz); roofG.push(roof);
        for (let i = 0; i < lit; i++) {
            const t = (i + 0.5) / lit;
            if (w >= d) { glowG.push(box(0.7, 1.3, 0.1, x0 + w * t, h * 0.62, z0 - 0.06), box(0.7, 1.3, 0.1, x0 + w * t, h * 0.62, z1 + 0.06)); }
            else { glowG.push(box(0.1, 1.3, 0.7, x0 - 0.06, h * 0.62, z0 + d * t), box(0.1, 1.3, 0.7, x1 + 0.06, h * 0.62, z0 + d * t)); }
        }
        obstacle(x0, x1, z0, z1);
        MM.blds.push([x0, x1, z0, z1]);
    };
    /** A plain door on a building face, for show. `ry` turns it to face along X. */
    const door = (x, z, ry = 0, w = 2.2, h = 3.4) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), doorMat);
        m.position.set(x, h / 2, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = HQ;
        scene.add(m);
    };

    // Curtain wall: north wall either side of the gate, then round the corners of the map.
    wall(CASTLE[0][0], WALL_Z + 0.5, -GATE_HALF, WALL_Z + 0.5);
    wall(GATE_HALF, WALL_Z + 0.5, CASTLE[1][0], WALL_Z + 0.5);
    stoneG.push(box(GATE_HALF * 2, 6, 3, 0, H - 3, WALL_Z + 0.5));
    for (let i = 1; i < CASTLE.length; i++) { const a = CASTLE[i], b = CASTLE[(i + 1) % CASTLE.length]; wall(a[0], a[1], b[0], b[1]); }
    // Nobody walks round the outside of the castle.
    obstacle(-95, CASTLE[0][0], WALL_Z - 1, WALL_Z + 2);
    obstacle(CASTLE[1][0], 95, WALL_Z - 1, WALL_Z + 2);
    // Gate towers, a tower on every corner, and a few along the long walls.
    tower(-9, 39, 4, 19, false); tower(9, 39, 4, 19, false);
    obstacle(-13, -GATE_HALF, 35.5, 42); obstacle(GATE_HALF, 13, 35.5, 42);
    for (const [x, z] of CASTLE) tower(x, z, 5, 20);
    for (const [x, z] of [[-34, 40], [30, 40], [96, 122], [96, 172], [40, 223], [-68, 106]]) tower(x, z, 3.6, 18);
    // The other three gates stay shut: South Gate, East Gate, Hunter's Gate.
    tower(12.5, 223, 4, 19); tower(31, 223, 4, 19);
    door(21.7, 221.3, 0, 9, 7.5); door(94.3, 90, Math.PI / 2, 8, 7); door(-66.3, 138, Math.PI / 2, 7, 6.5);
    tower(96, 83, 3.4, 18); tower(96, 97, 3.4, 18); tower(-68, 131.5, 3.2, 17); tower(-68, 144.5, 3.2, 17);

    // The godswood's own walls, lower than the curtain wall, with one door to the yard.
    wall(WOOD_WALL_X, 42, WOOD_WALL_X, WOOD_WALL_Z, 8, 1.6);
    wall(CASTLE[0][0] + 1.5, WOOD_WALL_Z, WOOD_WALL_X, WOOD_WALL_Z, 8, 1.6);
    door(WOOD_WALL_X + 0.9, 104, Math.PI / 2);

    // Buildings of the yard, placed as on the map.
    building(15, 25, 48, 56, 4.5, 0);            // Crypts (4): low, by the north wall
    door(20, 56.1);
    tower(60, 60, 9, 22);                        // First Keep (5): the old round drum
    tower(50, 45, 4, 9);                         // Broken Tower (2)
    building(36, 52, 76, 84, 7);                 // Guards Hall (7)
    building(17, 27, 95, 105, 8);                // Armory (9)
    door(22, 94.9);
    building(5, 19, 117, 127, 7, 3);             // Guest House (12)
    building(50, 76, 124, 146, 24, 3);           // Great Keep (14)
    tower(76, 146, 7, 32);
    building(80, 91, 150, 205, 9, 5);            // the long range by the east wall
    building(46, 78, 168, 188, 13, 4);           // Great Hall (22)
    door(62, 167.9, 0, 3, 4.4);
    tower(40, 157, 3, 8);                        // Sept (20)
    building(2, 10, 192, 200, 5, 1);             // Smithy (23)
    building(-36, -14, 180, 187, 5, 0);          // Stables (21)
    building(-36, -22, 134, 140, 4, 0);          // Kennels (11)
    tower(-44, 156, 6, 9);                       // Kitchens (16)
    building(-59.5, -54.5, 159.5, 164.5, 24, 0); // Bell Tower (18)
    tower(-12, 150, 4, 19);                      // Library Tower (19)
    tower(-58, 148, 3, 16);                      // Maester's Turret (15)
    // The covered bridge from the armory to the Great Keep (13), overhead.
    { const g = new THREE.BoxGeometry(2.6, 3, 34); g.rotateY(Math.atan2(50 - 27, 128 - 104)); g.translate(38.5, 9.5, 116); darkG.push(g); }
    // Glass Gardens (3): a pale glasshouse in the corner of the godswood.
    { const m = addMesh(box(18, 5, 9, -55, 2.5, 49.5), new THREE.MeshPhongMaterial({ color: 0x9fb8a0, emissive: 0x1c2a14, transparent: true, opacity: 0.55, shininess: 90 }));
      m.castShadow = false; obstacle(-64, -46, 45, 54); MM.blds.push([-64, -46, 45, 54]); }

    addMesh(merge(stoneG), stone);
    addMesh(merge(darkG), darkStone);
    addMesh(merge(roofG), new THREE.MeshLambertMaterial({ color: 0x23262d }));
    addMesh(merge(glowG), new THREE.MeshBasicMaterial({ color: 0xffb060 }));

    // The Great Keep's door: a pale stone porch, two oak leaves, and firelight behind them once they open.
    { const [kx, kz] = KEEP_DOOR;
      addMesh(merge([box(1, 5.8, 1.2, kx - 3.2, 2.9, kz - 0.5), box(1, 5.8, 1.2, kx + 3.2, 2.9, kz - 0.5), box(7.6, 1.1, 1.5, kx, 6.3, kz - 0.6), box(7, 0.24, 2.2, kx, 0.12, kz - 1.4)], 2.5), stone);
      pair('keep', kx, kz - 0.14, 2.7, 5.2);
      keepGlow = addMesh(new THREE.PlaneGeometry(5.4, 5.2), new THREE.MeshBasicMaterial({ color: 0xffb060, fog: false }));
      keepGlow.rotation.y = Math.PI; keepGlow.position.set(kx, 2.6, kz - 0.03); keepGlow.visible = false; }
    // Gate
    pair('gate', 0, WALL_Z + 0.5, GATE_HALF, 8);
    gateObstacle = obstacle(-GATE_HALF, GATE_HALF, WALL_Z - 0.3, WALL_Z + 1.2, false);
    // Yard clutter
    addMesh(merge([
        box(2.4, 1.2, 1.4, 30, 0.6, 62), box(1.4, 1.4, 1.4, 32.4, 0.7, 63), box(3, 1, 1.6, 44, 0.5, 108, 0, 0.1),
        box(1.3, 1.3, 1.3, 46, 0.65, 105.6), box(2.2, 1.6, 2.2, 0, 0.8, 110), box(4, 0.3, 2, 14, 1.0, 190), box(0.3, 1, 0.3, 12.4, 0.5, 189.4), box(0.3, 1, 0.3, 15.6, 0.5, 190.6)
    ]), wood);
    obstacle(28.7, 33.4, 61.2, 63.8); obstacle(42.4, 46.8, 104.8, 108.9); obstacle(-1.2, 1.2, 108.8, 111.2);

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
        bz.push(at(MD.props.brazier, x, 0, z, rand(TAU)));
    };
    for (const x of [-30, -10, 10, 30]) place(x, -5, false);
    place(-7.5, 33.5, false); place(7.5, 33.5, false);
    for (const [x, z] of [[10, 58], [40, 62], [-2, 92], [30, 112], [KEEP_DOOR[0] - 4.8, 122], [KEEP_DOOR[0] + 4.8, 122], [20, 150], [45, 152], [30, 190], [70, 160]]) place(x, z, true);
    for (const [x, z] of [[190, -4], [210, -4], [190, -27], [210, -27], [198.3, -42], [211, -54.3], [221.3, -66]]) place(x, z, true);
    for (const [x, z] of [[GROVE.treeX - 7, GROVE.treeZ + 5], [GROVE.treeX + 7, GROVE.treeZ + 5], [GROVE.x, GROVE.z + 14]]) place(x, z, true);

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

    // Act V: the godswood, inside the walls. Pines fill its corners and edges round a clearing, and the weirwood.
    const pines = [];
    for (let i = 0; i < 260 && pines.length < 70; i++) {
        const x = rand(CASTLE[0][0] + 3, WOOD_WALL_X - 2), z = rand(WALL_Z + 4, WOOD_WALL_Z - 2);
        if (Math.hypot(x - GROVE.x, z - GROVE.z) < GROVE.r + 2) continue;
        if (x > -66 && x < -44 && z < 56) continue;                 // the glasshouse
        if (x > -41 && x < -28 && z < 64) continue;                 // the way Arya comes in
        pines.push(at(MD.props.pines[pines.length % MD.props.pines.length], x, 0, z, rand(TAU), rand(0.7, 1.1)));
        MM.rounds.push([x, z, 1.2, 1]);
    }
    addMesh(merge(pines), propMat);
    addMesh(at(MD.props.weirwood, GROVE.treeX, 0, GROVE.treeZ), propMat);
    addMesh(at(MD.props.weirwoodLeaves, GROVE.treeX, 0, GROVE.treeZ), propMat);
    // Dressing: banners by the gate and the keep door, barricades out on the flanks, dead trees on the field.
    for (const [x, z, ry] of [[-14.5, 35, 0], [14.5, 35, 0], [KEEP_DOOR[0] - 7.5, 123, Math.PI], [KEEP_DOOR[0] + 7.5, 123, Math.PI], [54, 167, Math.PI], [70, 167, Math.PI]]) bz.push(at(MD.props.banner, x, 0, z, ry));
    for (const side of [-1, 1]) for (let x = 44; x <= 84; x += 4) {
        bz.push(at(MD.props.barricade, side * x, 0, -17, rand(-0.12, 0.12)));
        obstacle(side * x - 1.6, side * x + 1.6, -17.6, -16.4);
    }
    for (let i = 0; i < 16; i++) {
        const x = rand(48, 82) * (i % 2 ? 1 : -1), z = rand(-230, -32);
        bz.push(at(MD.props.deadTree, x, 0, z, rand(TAU), rand(0.8, 1.3)));
        obstacle(x - 0.35, x + 0.35, z - 0.35, z + 0.35);
    }
    obstacle(GROVE.treeX - 1.3, GROVE.treeX + 1.3, GROVE.treeZ - 1.3, GROVE.treeZ + 1.3);
    addMesh(merge(bz), propMat);
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
    m.castShadow = HQ && !mat.isMeshBasicMaterial && !mat.transparent;
    m.receiveShadow = m.castShadow;
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
// Figure parts are instanced. Vertex colours bake in creases, belts and boots; the per-instance colour sets cloth or skin.
const figMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const gearMat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x3c444e, shininess: 45 });
const W_CAP = 130, A_CAP = 150, H_CAP = 52;
const UPPER = 0.30, THIGH = 0.43;      // limb segment lengths: shoulder to elbow, hip to knee
const WP = {
    torso: part(MD.wight.torso, figMat, W_CAP, true),
    head: part(MD.wight.head, figMat, W_CAP, true),
    eyes: part(merge([ball(0.017, -0.045, 1.57, 0.322, 1.2, 0.9, 0.6), ball(0.017, 0.045, 1.57, 0.322, 1.2, 0.9, 0.6)]),
        new THREE.MeshBasicMaterial({ color: 0x7fdcff, fog: false }), W_CAP),
    uArm: part(MD.wight.upperArm, figMat, W_CAP * 2, true), fArm: part(MD.wight.foreArm, figMat, W_CAP * 2, true),
    thigh: part(MD.wight.thigh, figMat, W_CAP * 2, true), shin: part(MD.wight.shin, figMat, W_CAP * 2, true),
    // Boss gear: an ice blade in the right hand, and the Night King's crown of horns.
    blade: part(MD.gear.iceBlade, new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 120, emissive: 0x20455e, transparent: true, opacity: 0.9 }), 8),
    crown: part(MD.gear.crown, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x1c3a52 }), 2)
};
const AP = {
    torso: part(MD.human.torso, figMat, A_CAP, true),
    head: part(MD.human.head, figMat, A_CAP, true),
    uArm: part(MD.human.upperArm, figMat, A_CAP * 2, true), fArm: part(MD.human.foreArm, figMat, A_CAP * 2, true),
    thigh: part(MD.human.thigh, figMat, A_CAP * 2, true), shin: part(MD.human.shin, figMat, A_CAP * 2, true),
    // Northmen wear fur at the shoulders and a cloak; riders wear a long braid; Unsullied a spiked helm.
    cloak: part(MD.gear.cloak, propMat, 40), braid: part(MD.gear.braid, propMat, 60), helm: part(MD.gear.helm, gearMat, 100),
    // Held gear lives in forearm space: the hand is 0.30 below the elbow.
    arakh: part(MD.gear.arakh, gearMat, 60), spear: part(MD.gear.spear, gearMat, 100),
    sword: part(MD.gear.sword, gearMat, 30), shield: part(MD.gear.shield, gearMat, 100),
    // A bow held in the left hand (forearm space), and the arrows in flight (world space, pointing +Z).
    bow: part((() => {
        // An arc in the forearm's YZ plane, gripped at the hand, bulging away from the archer, with a straight string.
        const R = 0.62, pts = [], segs = [];
        for (let i = 0; i <= 8; i++) { const a = -0.75 + i * 0.1875; pts.push([-0.3 + R - R * Math.cos(a), R * Math.sin(a)]); }
        for (let i = 0; i < 8; i++) {
            const [y0, z0] = pts[i], [y1, z1] = pts[i + 1];
            segs.push(cyl(0.013, 0.013, Math.hypot(y1 - y0, z1 - z0) + 0.01, 0, (y0 + y1) / 2, (z0 + z1) / 2, Math.atan2(z1 - z0, y1 - y0), 5));
        }
        segs.push(cyl(0.004, 0.004, pts[8][1] * 2, 0, pts[0][0], 0, Math.PI / 2, 3));
        return merge(segs);
    })(), new THREE.MeshLambertMaterial({ color: 0x3a2a1c }), 20),
    arrow: part(merge([cyl(0.008, 0.008, 0.8, 0, 0, 0, Math.PI / 2, 4), cyl(0.001, 0.02, 0.07, 0, 0, 0.43, Math.PI / 2, 4)]),
        new THREE.MeshLambertMaterial({ color: 0x8a7558 }), 48),
    flame: part((() => { const g = new THREE.OctahedronGeometry(0.2); g.scale(1, 2.6, 1); g.translate(0, -1.05, 0.04); return g; })(),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c, fog: false }), 60)
};
const HP = {
    body: part(MD.horse.body, figMat, H_CAP, true),
    leg: part(MD.horse.leg, figMat, H_CAP * 4, true)
};
// A soft dark disc under every figure, so they stand on the ground instead of floating over it.
const shadows = part((() => { const g = new THREE.CircleGeometry(0.5, 14); g.rotateX(-Math.PI / 2); return g; })(),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: HQ ? 0.24 : 0.38, depthWrite: false }), W_CAP + A_CAP + 4);
const _sh = new THREE.Matrix4();
function shadow(x, z, r) {
    _sh.makeScale(r, 1, r);
    _sh.setPosition(x, G.act === 4 ? 0.1 : 0.04, z);
    put(shadows, _sh);
}
const _root = new THREE.Matrix4(), _l = new THREE.Matrix4(), _w = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function setRoot(f, lift, sway = 0) {
    _e.set(f.fall * f.fallDir * 1.5, f.yaw, sway, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(f.x, f.y + lift - f.sink, f.z);
    _s.set(f.scale, f.scale, f.scale);
    _root.compose(_p, _q, _s);
}
const _w2 = new THREE.Matrix4(), _zAxis = new THREE.Vector3(0, 0, 1);
/**
 * Draw a jointed limb. The upper part swings by a1 at (px, py, pz); the lower part hangs `len` below and bends by a2.
 * Positive angles swing backwards. The lower part's matrix is left in _w for whatever the hand holds.
 */
function limb2(up, lo, px, py, pz, a1, a2, len, colour, colour2) {
    _l.makeRotationX(a1);
    _l.setPosition(px, py, pz);
    _w2.multiplyMatrices(_root, _l);
    put(up, _w2, colour);
    _l.makeRotationX(a2);
    _l.setPosition(0, -len, 0);
    _w.multiplyMatrices(_w2, _l);
    put(lo, _w, colour2 || colour);
}
function drawWight(f) {
    setRoot(f, 0, f.moving ? Math.sin(f.t) * 0.07 : 0);
    const s = f.moving ? Math.sin(f.t) : 0, c = f.moving ? Math.cos(f.t) : 0, walk = s * 0.75;
    put(WP.torso, _root, f.col);
    put(WP.head, _root, f.skin);
    put(WP.eyes, _root);
    if (f.king) put(WP.crown, _root);
    if (f.state === 'alive' && f.y < 3) shadow(f.x, f.z, f.scale * (f.heavy ? 1.2 : 0.9));
    // Legs: the knee bends as the leg comes through.
    limb2(WP.thigh, WP.shin, 0.13, 0.86, 0, walk, 0.1 + Math.max(0, c) * 0.9, THIGH, f.col, f.skin);
    limb2(WP.thigh, WP.shin, -0.13, 0.86, 0, -walk, 0.1 + Math.max(0, -c) * 0.9, THIGH, f.col, f.skin);
    // Arms reach for the living; the right one comes down as a blow.
    limb2(WP.uArm, WP.fArm, 0.3, 1.38, 0.08, -1.05 + walk * 0.25, -0.5, UPPER, f.skin);
    let ar = -1.05 - walk * 0.25, elbow = -0.5;
    if (f.atkT > 0) { ar = lerp(-0.3, -2.6, clamp(f.atkT / 0.5, 0, 1)); elbow = -0.25; }
    limb2(WP.uArm, WP.fArm, -0.3, 1.38, 0.08, ar, elbow, UPPER, f.skin);
    if (f.boss) put(WP.blade, _w);
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
            _l.makeRotationX(f.moving ? Math.sin(f.t + i * 1.7) * 0.85 : 0);
            _l.setPosition(sx, 0.95, sz);
            _w.multiplyMatrices(_root, _l);
            put(HP.leg, _w, f.hcol);
        }
    }
    if (f.state === 'alive') shadow(f.x, f.z, riding ? 1.5 : 0.9);
    setRoot(f, riding ? 0.72 + bob : 0);
    const walking = f.moving && !riding;
    const s = walking ? Math.sin(f.t) : 0, c = walking ? Math.cos(f.t) : 0, walk = s * 0.7;
    put(AP.torso, _root, f.col);
    put(AP.head, _root, f.skin);
    if (riding) {       // seated: thighs forward round the barrel, knees bent
        limb2(AP.thigh, AP.shin, 0.26, 0.86, 0, -1.15, 1.2, THIGH, f.col);
        limb2(AP.thigh, AP.shin, -0.26, 0.86, 0, -1.15, 1.2, THIGH, f.col);
    } else {
        limb2(AP.thigh, AP.shin, 0.13, 0.86, 0, walk, 0.06 + Math.max(0, c) * 0.85, THIGH, f.col);
        limb2(AP.thigh, AP.shin, -0.13, 0.86, 0, -walk, 0.06 + Math.max(0, -c) * 0.85, THIGH, f.col);
    }
    const strike = f.atkT > 0 ? Math.sin(clamp(f.atkT / 0.3, 0, 1) * Math.PI) : 0;
    if (riding) {
        put(AP.braid, _root);
        limb2(AP.uArm, AP.fArm, 0.32, 1.42, 0, -0.55, -0.7, UPPER, f.skin);                                  // reins
        limb2(AP.uArm, AP.fArm, -0.32, 1.42, 0, -2.2 + Math.sin(f.t * 0.7) * 0.2, -0.35, UPPER, f.skin);      // arakh held high
        put(AP.arakh, _w);
        if (f.flame) put(AP.flame, _w);
    } else if (f.kind === 'unsullied') {
        put(AP.helm, _root);
        limb2(AP.uArm, AP.fArm, 0.32, 1.42, 0, -0.15, -0.2, UPPER, f.col);
        put(AP.shield, _w);
        limb2(AP.uArm, AP.fArm, -0.32, 1.42, 0, -0.12 - strike * 0.35, -0.2 - strike * 0.3, UPPER, f.col);
        put(AP.spear, _w);
    } else if (f.kind === 'archer') {
        put(AP.cloak, _root);
        // Bow arm straight out, string hand drawn back to the jaw and snapping forward on release.
        limb2(AP.uArm, AP.fArm, 0.32, 1.42, 0, -1.5, -0.05, UPPER, f.col);
        put(AP.bow, _w);
        limb2(AP.uArm, AP.fArm, -0.32, 1.42, 0, -1.25, -1.9 + strike * 1.2, UPPER, f.col);
    } else {
        put(AP.cloak, _root);
        limb2(AP.uArm, AP.fArm, 0.32, 1.42, 0, walk * 0.6, -0.25, UPPER, f.col);
        limb2(AP.uArm, AP.fArm, -0.32, 1.42, 0, -1.2 + strike * 0.9, -0.75 + strike * 0.5, UPPER, f.col);
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
{   // The same horse the riders use, turned to face the way the player looks (-Z).
    const g = MD.horse.body.clone();
    g.rotateY(Math.PI);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x5a4230 }));
    m.castShadow = HQ;
    mount.add(m);
}
scene.add(mount);

// ── Game state ──
const G = {
    mode: 'menu', act: 1, phase: '', t: 0, time: 0, kills: 0, clock: 0,
    cut: false, still: false, qte: null, drop: -1, run: 0,
    hordeZ: Z_MUSTER, hordeV: 0, trenchLit: false, litT: -1, dawn: 0, gap: 0, hgap: 0, spawnT: 0,
    giant: false, uTotal: 0, god: false, bot: false, flags: {}
};
const P = {
    x: 0, z: Z_MUSTER, yaw: 0, pitch: 0, hp: 100, mounted: true, speed: 0, gallop: 0, bobT: 0,
    weapon: 'arakh', swingT: 0, cd: 0, hitPending: false, lastHurt: -99, shake: 0, fallT: 0, flame: 0, vign: 0, stepN: 0
};
const wights = [], allies = [];
const input = { keys: new Set(), sx: 0, sy: 0, attack: false, held: false };

// Wights wear dark rags over grey-blue skin; the living have warmer faces.
const WCOLS = [0x3a3f47, 0x2f3339, 0x45413b, 0x33383f, 0x3d3a36].map((c) => new THREE.Color(c));
const WSKIN = [0x8d98a3, 0x7c8894, 0x9a9f9c, 0x73808c].map((c) => new THREE.Color(c));
const arrows = [];
const SKINS = { rider: [0x8a5c3c, 0x7a4e32, 0x95683f], unsullied: [0x6b4a36, 0x55392a, 0x7a5a44], north: [0xb08c74, 0xa37e68, 0x96705a] };
for (const k in SKINS) SKINS[k] = SKINS[k].map((c) => new THREE.Color(c));
SKINS.archer = SKINS.north;
const BOSS_CLOTH = new THREE.Color(0x3a4756);
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
        speed: o.speed || rand(4.8, 6.2), col: o.col ? BOSS_CLOTH : pick(WCOLS), skin: o.col || pick(WSKIN), tgt: null, moving: false, dieAt: -1, hunter: rand() < 0.3,
        heavy: !!o.heavy, boss: !!(o.walker || o.king), walker: !!o.walker, king: !!o.king,
        dmg: o.dmg || 0, reach: o.reach || 0, windT: o.windT || 0.42, cdB: o.cdB || 1.1, maxHp: o.hp || 1
    };
    wights.push(w);
    return w;
}
function mkAlly(kind, x, z, yaw) {
    const a = {
        kind, x, z, y: 0, yaw, hp: kind === 'unsullied' ? 4 : kind === 'archer' ? 7 : 12, state: 'alive', t: rand(TAU), fall: 0, fallDir: 1, sink: 0, dead: 0,
        atkT: 0, cd: rand(1), scan: rand(0.4), scale: rand(0.96, 1.06), col: kind === 'unsullied' ? UCOL : kind === 'rider' ? pick(RCOLS) : pick(NCOLS),
        skin: pick(SKINS[kind]), hcol: pick(HCOLS), tgt: null, moving: false, flame: false, hx: x, hz: z, ox: 0, oz: 0, dieAt: -1, flee: false
    };
    allies.push(a);
    return a;
}
const aliveAllies = () => { let n = 0; for (const a of allies) if (a.state === 'alive') n++; return n; };

// ── HUD helpers ──
const el = { obj: $('obj'), act: $('act'), bar: $('objbar'), barI: $('objbar').firstElementChild, kills: $('kills'), allies: $('allies'),
    hp: $('hp').firstElementChild, flame: $('flame').firstElementChild, sub: $('sub'), card: $('card'), vign: $('vign'), cross: $('cross'), fade: $('fade'), way: $('way'), wayD: $('way').lastElementChild,
    qte: $('qte'), qteRing: $('qte').firstElementChild, qteLabel: $('qte').lastElementChild };
let subTimer = 0, cardTimer = 0, crossTimer = 0;
function say(text, secs = 4.5) { el.sub.textContent = text; el.sub.classList.add('on'); subTimer = secs; }
function card(small, big) { el.card.firstElementChild.textContent = small; el.card.lastElementChild.textContent = big; el.card.classList.add('on'); cardTimer = 3.4; }
function objective(text, showBar) { el.obj.textContent = text; el.bar.style.display = showBar ? 'block' : 'none'; }
/** Cut to black and fade back in: used when an act moves the player somewhere else. */
function fadeIn() {
    el.fade.style.transition = 'none';
    el.fade.classList.add('on');
    void el.fade.offsetWidth;
    el.fade.style.transition = '';
    el.fade.classList.remove('on');
}
/** Tell the sound module what kind of place this act is, for its reverb. */
function space() { if (Sfx.setSpace) Sfx.setSpace(G.act <= 2 ? 'field' : G.act === 3 ? 'yard' : G.act === 4 ? 'hall' : 'grove'); }
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
    G.cut = false; G.still = false; G.qte = null; G.drop = -1;
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
    space();
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
    space();
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
    space();
    for (let i = wights.length - 1; i >= 0; i--) if (wights[i].z < WALL_Z + 1) wights.splice(i, 1);
    allies.length = 0;
    const posts = [[-2, 50], [12, 64], [32, 50], [44, 66], [4, 74], [24, 76], [-3, 100], [10, 108], [34, 112], [48, 100], [60, 98], [30, 90]];
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
    if (P.hp <= 0) { if (G.act === 5 && G.phase === 'walkers') beginFallen(); else die(); }
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
        if (byPlayer) Sfx.play(w.heavy ? 'clang' : 'hit', { weapon: P.weapon });
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
    if (hits.length) { el.cross.classList.add('hit'); crossTimer = 0.12; P.shake = Math.min(1, P.shake + 0.15); hitStop = 0.045; }
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
    if (G.cut) { P.swingT = 0; return; }      // a scripted scene is moving the camera; it reads input.attack itself
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
        if (stepN !== P.stepN) { P.stepN = stepN; Sfx.play('step', { vol: 0.5, surface: G.act === 4 ? 'stone' : G.act === 3 ? 'mud' : Math.abs(P.z - 10) < 2.5 && G.act < 3 ? 'wood' : 'snow' }); }
        if (G.act === 4) { const nx = P.x, nz = P.z; P.x = px0; P.z = pz0; hallMove(P, nx, nz, 0.45, true); }
        else resolve(P, 0.45);
    }
    if (G.act <= 3) { P.x = clamp(P.x, G.act === 3 ? -9 : -84, G.act === 3 ? 95 : 84); P.z = Math.max(P.z, -335); }
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
        Sfx.play('swing', { weapon: P.weapon });
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
        if (G.still) {      // the dead part and stand; only the Night King moves, to the weirwood
            w.moving = false;
            if (w.king) {
                const dx = KING_SPOT[0] - w.x, dz = KING_SPOT[1] - w.z, d = Math.hypot(dx, dz);
                if (d > 0.15) { w.x += dx / d * w.speed * dt; w.z += dz / d * w.speed * dt; w.yaw = Math.atan2(dx, dz); w.t += w.speed * dt * 1.7; w.moving = true; }
                else w.yaw += clamp(((G.phase === 'leap' && G.t > 0.25 ? Math.atan2(P.x - w.x, P.z - w.z) : 0) - w.yaw), -6 * dt, 6 * dt);
            }
            continue;
        }
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
        if (G.still) { a.moving = false; continue; }      // everyone has stopped to watch the Night King
        if (a.kind === 'archer') {
            a.cd -= dt; a.scan -= dt;
            if (a.scan <= 0) { a.scan = 0.4 + rand(0.3); a.tgt = nearestWight(a.x, a.z, 30); }
            const w = a.tgt;
            if (w && w.state === 'alive') {
                a.yaw = Math.atan2(w.x - a.x, w.z - a.z);
                if (a.cd <= 0) {
                    a.cd = 1.5 + rand(0.9); a.atkT = 0.3;
                    const d = Math.hypot(w.x - a.x, w.z - a.z);
                    if (arrows.length < 46) arrows.push({ x0: a.x, z0: a.z, x: a.x, y: 1.45, z: a.z, dx: 0, dy: 0, dz: 1, w, t: 0, dur: clamp(d / 34, 0.22, 1), arc: d * 0.05 });
                    Sfx.play('swing', { weapon: 'dagger', vol: 0.22, pan: clamp((a.x - P.x) / 14, -1, 1) });
                }
            }
            continue;
        }
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
function simArrows(dt) {
    for (let i = arrows.length - 1; i >= 0; i--) {
        const a = arrows[i], w = a.w;
        a.t += dt;
        const k = Math.min(1, a.t / a.dur), ty = 1.15 * w.scale;
        const nx = lerp(a.x0, w.x, k), nz = lerp(a.z0, w.z, k), ny = lerp(1.45, ty, k) + Math.sin(k * Math.PI) * a.arc;
        a.dx = nx - a.x; a.dy = ny - a.y; a.dz = nz - a.z;
        a.x = nx; a.y = ny; a.z = nz;
        if (k >= 1) {
            if (w.state === 'alive') {
                if (w.boss) debris.burst(w.x, ty, w.z, 3, 2);      // arrows splinter on the Walkers
                else if (rand() < 0.75) damageWight(w, 1, false);
            }
            arrows[i] = arrows[arrows.length - 1]; arrows.pop();
        }
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
            Sfx.play('horn'); Sfx.play('whinny', { vol: 0.6 }); Sfx.play('charge'); Sfx.setAmbience({ crowd: 0 });
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
                    if (side === 0) spawnWight(rand(8, 46), WALL_Z + 3, o);                      // over the north wall
                    else if (side === 1) spawnWight(WOOD_WALL_X + 2.4, rand(48, 124), o);        // over the godswood wall
                    else spawnWight(92.5, rand(82, 146), o);                                     // over the east wall
                }
            }
        }
        if (t > 20 && once('s1')) say('Light your blade at a brazier. Stay near the others.', 5);
        if (t > GIANT_AT && !G.giant) {
            G.giant = true;
            setDoors('gate', 0, 1.5); gateObstacle.on = false;
            Sfx.play('gate'); Sfx.play('thud'); Sfx.play('roar');
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
                setDoors('keep', -1.25); keepGlow.visible = true; Sfx.play('door');
            }
            if (Math.abs(P.x - KEEP_DOOR[0]) < 2.7 && P.z > KEEP_DOOR[1] - 1.2) beginHalls();
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
            G.spawnT = lerp(0.8, 0.32, k);
            if (alive() < lerp(16, 46, k)) { const [x, z] = ring(GROVE.r + 2, 0, TAU); spawnWight(x, z, { hp: rand() < 0.3 ? 2 : 1 }); }
        }
        if (t >= GROVE_SECS) {
            G.phase = 'walkers'; G.t = 0;
            Sfx.play('horn', { rate: 0.6 }); Sfx.setAmbience(AMBIENCE.walkers);
            objective('Hold against the White Walkers', true);
            say('The dead stop. They part. Something else walks out of the trees.', 6);
            for (const w of wights) if (w.state === 'alive' && rand() < 0.7) w.dieAt = rand(0.2, 2);
            for (let i = 0; i < 4; i++) {       // they come from the north, opposite the way you came in
                const [x, z] = ring(GROVE.r + 1, Math.PI - 0.9 + i * 0.6, Math.PI - 0.9 + i * 0.6);
                spawnWight(x, z, { walker: true, heavy: true, hp: 14, scale: 1.22, speed: 3.2, col: ICE, dmg: 24, reach: 2.6, windT: 0.75, cdB: 1.5 });
            }
        }
        return;
    }
    if (G.phase === 'walkers') {
        // This fight is not winnable: the Walkers cut the player down, or the Night King does when he arrives.
        let left = 0;
        for (const w of wights) if (w.walker && w.state === 'alive') left++;
        el.barI.style.width = (4 - left) / 4 * 100 + '%';
        if (G.spawnT <= 0) { G.spawnT = 2.2; if (alive() < 8) { const [x, z] = ring(GROVE.r + 2, 0, TAU); spawnWight(x, z); } }
        if ((left === 0 || t > 32) && once('kingcomes')) {
            Sfx.play('screech'); Sfx.play('horn', { rate: 0.5 });
            say('Then the Night King steps out of the dark, and he does not slow down.', 5);
            spawnKing(P.x + rand(-2, 2), P.z - 16);
        }
        const king = wights.find((w) => w.king);
        if (king && Math.hypot(king.x - P.x, king.z - P.z) < 3.6) beginFallen();
        return;
    }
    if (G.phase === 'fallen') {
        // On the ground, watching him walk to the tree.
        const king = wights.find((w) => w.king);
        if (t > 2.6 && once('f1')) say('The dead stop. They part to let him through.', 4);
        if (t > 6.4 && once('f2')) say('The Night King walks past you, to the weirwood. You cannot stand.', 5);
        if (king) P.yaw += clamp(angTo(king.x, king.z) - P.yaw, -1.2 * dt, 1.2 * dt);
        const there = king && Math.hypot(king.x - KING_SPOT[0], king.z - KING_SPOT[1]) < 0.3;
        if ((there && t > 9) || t > 20) beginArya();
        input.attack = false;
        return;
    }
    if (G.phase === 'arya') {
        // She runs at his back. One press, at the right distance, to leap.
        const d0 = Math.hypot(ARYA_START[0] - KING_SPOT[0], ARYA_START[1] - KING_SPOT[1]);
        const slow = G.run > d0 - 11 ? 0.42 : 1;
        G.run += 8.5 * slow * dt;
        const left = d0 - G.run, k = G.run / d0;
        P.x = lerp(ARYA_START[0], KING_SPOT[0], k) + Math.sin(G.run * 0.22) * 1.2 * (1 - k);
        P.z = lerp(ARYA_START[1], KING_SPOT[1], k);
        P.yaw = angTo(KING_SPOT[0], KING_SPOT[1]);
        P.bobT += 11 * slow * dt;
        const stepN = Math.floor(P.bobT / 2.1);
        if (stepN !== P.stepN) { P.stepN = stepN; Sfx.play('step', { vol: 0.35, surface: 'snow' }); }
        // The ring closes on the target as she nears; it is "go" between 6.5 and 4 metres.
        G.qte = { label: 'JUMP', size: clamp((left - 6.5) / 14, 0, 1), go: left <= 6.5 && left >= 4 };
        const press = input.attack; input.attack = false;
        if (press && left < 16) {
            if (G.qte.go) beginLeap(); else aryaFail('Too soon. Her feet find ice, and the dead turn.');
        } else if (left < 4) aryaFail('Too late. He hears her.');
        return;
    }
    if (G.phase === 'leap') {
        const king = wights.find((w) => w.king);
        if (!king) { beginDawn('Every one of them falls.'); return; }
        const press = input.attack; input.attack = false;
        if (t < 0.55) {      // in the air
            const k = t / 0.55, kx = king.x, kz = king.z;
            const dx = G.leapX - kx, dz = G.leapZ - kz, d = Math.hypot(dx, dz) || 1, r = lerp(d, 1.25, k);
            P.x = kx + dx / d * r; P.z = kz + dz / d * r;
            return;
        }
        if (once('caught')) {
            Sfx.play('hurt'); Sfx.play('iceCrack'); P.shake = 1; P.vign = 1;
            say('He turns. His hand closes on her throat.', 3.5);
        }
        if (t < 1.5) return;
        // The dagger falls from her left hand; press as it reaches the right.
        if (G.drop < 0) { G.drop = 0; if (once('dropline')) say('She lets the dagger fall.', 2.5); }
        G.drop += dt / 1.15;
        G.qte = { label: 'STAB', size: clamp((0.6 - G.drop) / 0.6, 0, 1), go: G.drop >= 0.6 && G.drop <= 0.9 };
        if (press && G.drop > 0.12) {
            if (G.qte.go) {
                G.qte = null; G.drop = -1; G.cut = false;
                Sfx.play('hit', { weapon: 'dagger' }); P.shake = 1; hitStop = 0.12;
                king.state = 'dying'; king.fallDir = -1;
                debris.burst(king.x, 2, king.z, 60, 7);
                G.kills++;
                beginDawn('The dagger drops into her other hand, and into him. The Night King breaks like ice, and every one of them falls.');
                return;
            }
            stabFail();
        } else if (G.drop > 1.05) stabFail();
    }
}
const KING_SPOT = [GROVE.treeX, GROVE.treeZ - 3.6];      // where he stops, facing the tree
const ARYA_START = [GROVE.treeX + 5, GROVE.treeZ - 31];  // she comes out of the trees behind him
const angTo = (x, z) => Math.atan2(-(x - P.x), -(z - P.z));
function spawnKing(x, z) {
    return spawnWight(clampGrove(x, 0), clampGrove(z, 1), { king: true, heavy: true, hp: 999, scale: 1.45, speed: 2.6, col: KING, dmg: 0, reach: 0.01, windT: 9, cdB: 99 });
}
/** The player goes down for good, and from the ground watches the Night King walk to the tree. */
function beginFallen() {
    if (G.phase === 'fallen') return;
    G.phase = 'fallen'; G.t = 0; G.cut = true; G.still = true; G.qte = null;
    P.hp = 1; P.vign = 1; P.shake = 1; P.pitch = 0.12; P.swingT = 0;
    input.attack = false; input.held = false; arrows.length = 0;
    Sfx.play('hurt'); Sfx.play('thud');
    Sfx.setAmbience({ battle: 0, drums: 0.4, wind: 0.9, heart: 1 });
    objective('');
    say('A blow you never saw. You are down.', 3);
    let king = wights.find((w) => w.king);
    if (!king) king = spawnKing(P.x, P.z - 14);
    // He starts beyond the player, so his road to the tree passes an arm's length from where they lie.
    const dx = P.x - KING_SPOT[0], dz = P.z - KING_SPOT[1], d = Math.hypot(dx, dz) || 1;
    king.x = clampGrove(P.x + dx / d * 9 - dz / d * 1.7, 0); king.z = clampGrove(P.z + dz / d * 9 + dx / d * 1.7, 1);
    king.speed = clamp((d + 9) / 10.5, 1.5, 4.2);      // about ten seconds, however far the tree is
    P.yaw = angTo(king.x, king.z);
    for (const w of wights) if (!w.king && w.state === 'alive') w.yaw = Math.atan2(GROVE.treeX - w.x, GROVE.treeZ - w.z);
}
/** The view moves to Arya, already running. */
function beginArya() {
    G.phase = 'arya'; G.t = 0; G.run = 0; G.cut = true; G.still = true; G.drop = -1;
    G.flags.caught = G.flags.dropline = false;
    P.hp = 100; P.pitch = 0; P.vign = 0; P.x = ARYA_START[0]; P.z = ARYA_START[1];
    const king = wights.find((w) => w.king);
    if (king) { king.x = KING_SPOT[0]; king.z = KING_SPOT[1]; king.yaw = 0; }
    // Clear her path of anything standing in it.
    for (const w of wights) if (!w.king && w.state === 'alive' && Math.abs(w.x - lerp(ARYA_START[0], KING_SPOT[0], clamp((ARYA_START[1] - w.z) / (ARYA_START[1] - KING_SPOT[1]), 0, 1))) < 2.5 && w.z < KING_SPOT[1] + 1) w.x += w.x < GROVE.treeX + 3 ? -3.5 : 3.5;
    equip('dagger');
    fadeIn();
    if (once('aryacard')) card('Out of the dark', 'Arya');
    objective('Leap when the ring closes');
    say('Someone else is running. No one sees her.', 4);
    Sfx.setAmbience({ heart: 0.6, wind: 1, drums: 0.9, battle: 0 });
}
function aryaFail(text) {
    say(text, 2.6);
    Sfx.play('hurt', { vol: 0.6 });
    beginArya();
    say(text, 2.6);
}
function beginLeap() {
    G.phase = 'leap'; G.t = 0; G.qte = null; G.leapX = P.x; G.leapZ = P.z;
    Sfx.play('swing', { weapon: 'dagger' }); Sfx.play('breath');
    objective('Strike when the ring closes');
}
function stabFail() {
    G.drop = -0.5;      // a breath before the dagger falls again
    P.vign = 1; P.shake = 0.6;
    Sfx.play('hurt', { vol: 0.5 });
    say('His grip tightens. Again.', 2);
}
function clampGrove(v, axis) { const c = axis ? GROVE.z : GROVE.x; return clamp(v, c - 23, c + 23); }
function beginHalls() {
    G.act = 4; G.phase = 'halls'; G.t = 0; G.spawnT = 3; G.flags = {};
    if (progress.act < 4) { progress.act = 4; save(); }
    el.act.textContent = ACT_NAMES[4];
    space();
    wights.length = 0; allies.length = 0;
    G.trenchLit = false; trenchEmitter.src.on = false;
    Object.assign(P, { x: 200, z: -2.5, yaw: 0, pitch: 0, mounted: false });
    for (let i = 0; i < 9; i++) spawnWight(rand(190, 210), rand(-28, -14), { speed: rand(4.4, 5.4), hp: i % 3 ? 1 : 2 });
    for (let i = 0; i < 5; i++) spawnWight(rand(198.5, 201.5), rand(-48, -36), { speed: rand(4.4, 5.4) });
    fadeIn();
    Sfx.play('gate');
    card('Act IV', 'The Halls');
    objective('Fight through the keep to the godswood', true);
    equip('torch');
    say('You take a torch from the wall. The keep is dark, and it is not empty.', 5.5);
    Sfx.setAmbience(Object.assign({ wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0, crowd: 0, heart: 0 }, AMBIENCE.halls));
}
function beginGrove() {
    G.act = 5; G.phase = 'grove'; G.t = 0; G.spawnT = 2; G.flags = {};
    if (progress.act < 5) { progress.act = 5; save(); }
    el.act.textContent = ACT_NAMES[5];
    space();
    wights.length = 0; allies.length = 0;
    Object.assign(P, { x: GROVE.x, z: GROVE.z + GROVE.r - 3, yaw: 0, pitch: 0, mounted: false });
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        mkAlly('archer', GROVE.treeX + Math.sin(a) * 6, GROVE.treeZ + Math.cos(a) * 6, a);
    }
    G.uTotal = allies.length;
    fadeIn();
    card('Act V', 'The Godswood');
    objective('Defend the weirwood', true);
    equip('dagger');
    say('Archers ring the weirwood. Someone presses a dragonglass dagger into your hand. Keep the dead off them.', 7);
    Sfx.setAmbience(Object.assign({ wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0, crowd: 0, heart: 0 }, AMBIENCE.grove));
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
        if (G.flags.keep) { tx = KEEP_DOOR[0]; tz = KEEP_DOOR[1] - 0.5; }
        else { tx = 10; tz = 78; move = Math.hypot(P.x - tx, P.z - tz) > 3 ? 1 : 0; }
    } else if (G.act === 4) {
        const hi = hallSeg(P.x, P.z)[1];
        if (hi < 3) { tx = HALL_JOINTS[Math.max(0, hi)][0]; tz = HALL_JOINTS[Math.max(0, hi)][1]; } else { tx = 219.5; tz = -82; }
    } else {
        if (G.cut) { input.sy = 0; input.held = false; input.attack = !!(G.qte && G.qte.go); return; }
        tx = GROVE.treeX; tz = GROVE.treeZ + 5;
        move = Math.hypot(P.x - tx, P.z - tz) > 3 ? 1 : 0;
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
    simArrows(dt);
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
        if (G.phase === 'fallen') { eye = 0.42; roll = 0.5; }
        else if (G.phase === 'arya') eye = 1.5 + Math.sin(P.bobT * 1.5) * 0.06;
        else if (G.phase === 'leap') eye = G.t < 0.55 ? lerp(1.5, 2.3, Math.sin(G.t / 0.55 * Math.PI / 2)) : 2.3 + Math.sin(t * 9) * 0.015;
        P.shake = Math.max(0, P.shake - dt * 2.5);
        const sh = P.shake * 0.05;
        camera.position.set(P.x + rand(-sh, sh), eye + rand(-sh, sh), P.z);
        camera.rotation.set(P.pitch + (P.mounted ? Math.sin(P.gallop * 2) * 0.012 : 0), P.yaw, roll);
        // Weapon in hand
        const W = WEAPONS[P.weapon], wg = W.group;
        for (const k in WEAPONS) WEAPONS[k].group.visible = false;
        wg.visible = G.mode !== 'dead' && G.phase !== 'fallen';
        const s = P.swingT > 0 ? 1 - P.swingT / W.swing : -1;
        const idle = Math.sin(t * 1.7) * 0.012 + (P.mounted ? 0 : Math.sin(P.bobT * 1.5) * 0.012);
        if (W.anim === 'thrust') {
            const e = s >= 0 ? Math.sin(s * Math.PI) : 0;
            wg.position.set(lerp(0.3, 0.16, e), -0.4 + idle + e * 0.05, lerp(-0.3, -1.0, e));
            wg.rotation.set(-1.44, 0.05, 0.04);
        } else if (G.drop >= 0) {      // the dagger falling from one hand to the other
            const k = Math.min(1, G.drop);
            wg.position.set(lerp(-0.34, 0.3, k), lerp(0.2, -0.34, k * k), -0.55);
            wg.rotation.set(-0.6 - k * 5, 0.3, -0.3 + k * 2.4);
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
    for (const a of arrows) {
        _p.set(a.dx, a.dy, a.dz);
        if (_p.lengthSq() < 1e-8) continue;
        _q.setFromUnitVectors(_zAxis, _p.normalize());
        _p.set(a.x, a.y, a.z); _s.set(1, 1, 1);
        _root.compose(_p, _q, _s);
        put(AP.arrow, _root);
    }
    flush(shadows);
    for (const k in WP) flush(WP[k]);
    for (const k in AP) flush(AP[k]);
    flush(HP.body); flush(HP.leg);
    // Doors swing towards their targets.
    for (const k in doors) for (const d of doors[k]) {
        d.rotation.y += (d.userData.ry - d.rotation.y) * Math.min(1, dt * 3);
        d.rotation.x += (d.userData.rx - d.rotation.x) * Math.min(1, dt * 5);
    }
    moon.target.position.set(camera.position.x, 0, camera.position.z);
    moon.position.copy(MOON_DIR).multiplyScalar(120).add(moon.target.position);
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
    if (G.act === 3) return G.flags.keep ? [KEEP_DOOR[0], 3, KEEP_DOOR[1]] : null;
    if (G.act === 4) { const hi = hallSeg(P.x, P.z)[1]; return hi >= 0 && hi < 3 ? [HALL_JOINTS[hi][0], 1.6, HALL_JOINTS[hi][1]] : [219.5, 2.6, -81.8]; }
    if (G.phase === 'fallen' || G.phase === 'arya') { const k = wights.find((w) => w.king && w.state === 'alive'); return k ? [k.x, 3.3, k.z] : null; }
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
// ── Minimap: north up, centred on the player ──
const mini = $('mini'), mctx = mini.getContext('2d');
const MINI_PX = 124, MINI_RANGE = 62;       // CSS pixels across, and metres from the centre to the rim
{ const dpr = Math.min(window.devicePixelRatio || 1, 2); mini.width = mini.height = MINI_PX * dpr; mctx.scale(dpr, dpr); }
function drawMini() {
    const c = MINI_PX / 2, k = c / MINI_RANGE, g = mctx;
    g.save();
    g.clearRect(0, 0, MINI_PX, MINI_PX);
    g.beginPath(); g.arc(c, c, c - 1, 0, TAU); g.clip();
    g.fillStyle = 'rgba(10,14,24,.78)'; g.fillRect(0, 0, MINI_PX, MINI_PX);
    g.translate(c, c); g.scale(k, k); g.translate(-P.x, -P.z);          // world metres from here on; +Z (south) is down
    // Ground: the yard, the godswood, the hall floors, the trench.
    g.fillStyle = 'rgba(120,104,88,.35)'; g.fillRect(-9, 41, 105, 182);
    g.fillStyle = 'rgba(70,110,80,.4)'; g.fillRect(CASTLE[0][0], 41, WOOD_WALL_X - CASTLE[0][0], WOOD_WALL_Z - 41);
    g.fillStyle = 'rgba(150,140,130,.55)'; for (const h of HALL) g.fillRect(h.x0, h.z0, h.x1 - h.x0, h.z1 - h.z0);
    g.fillStyle = G.trenchLit ? '#ff9a3c' : '#1d2230'; g.fillRect(-95, TRENCH_Z0, 190, TRENCH_Z1 - TRENCH_Z0);
    g.fillStyle = '#6b5a45'; g.fillRect(-BRIDGE_HALF, TRENCH_Z0, BRIDGE_HALF * 2, TRENCH_Z1 - TRENCH_Z0);
    // Buildings, towers and trees.
    g.fillStyle = '#4c7f86'; for (const b of MM.blds) g.fillRect(b[0], b[2], b[1] - b[0], b[3] - b[2]);
    for (const r of MM.rounds) { g.fillStyle = r[3] ? 'rgba(40,96,56,.9)' : '#3f8f96'; g.beginPath(); g.arc(r[0], r[1], r[2], 0, TAU); g.fill(); }
    g.fillStyle = '#b3262e'; g.beginPath(); g.arc(GROVE.treeX, GROVE.treeZ, 2.4, 0, TAU); g.fill();
    // Walls, then the gates over them.
    g.strokeStyle = '#aab4c6'; g.lineWidth = 2.4; g.beginPath();
    for (const w of MM.walls) { g.moveTo(w[0], w[1]); g.lineTo(w[2], w[3]); }
    g.stroke();
    g.fillStyle = '#d8a35a'; for (const gt of MM.gates) g.fillRect(gt[0] - 3.5, gt[1] - 2, 7, 4);
    g.fillRect(KEEP_DOOR[0] - 2.5, KEEP_DOOR[1] - 1.5, 5, 3);
    // The living and the dead.
    g.fillStyle = '#7fe08a'; for (const a of allies) if (a.state === 'alive') g.fillRect(a.x - 1, a.z - 1, 2, 2);
    for (const w of wights) {
        if (w.state !== 'alive') continue;
        const r = w.heavy ? 2.2 : 1.1;
        g.fillStyle = w.heavy ? '#ffffff' : '#7fd4ff'; g.fillRect(w.x - r, w.z - r, r * 2, r * 2);
    }
    g.restore();
    // Screen-space marks: the objective (pinned to the rim when it is off the map), the player, and north.
    g.save(); g.translate(c, c);
    const t = wayTarget();
    if (t) {
        let dx = (t[0] - P.x) * k, dz = (t[2] - P.z) * k; const d = Math.hypot(dx, dz), lim = c - 7;
        if (d > lim) { dx *= lim / d; dz *= lim / d; }
        g.fillStyle = '#ff9a3c'; g.save(); g.translate(dx, dz); g.rotate(Math.PI / 4); g.fillRect(-3.5, -3.5, 7, 7); g.restore();
    }
    g.rotate(-P.yaw);       // yaw 0 faces north (up); turning left is positive yaw
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = 'rgba(232,237,245,.8)'; g.font = '10px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('N', c, 12);
}
let hudT = 0, heartLvl = 0;
function updateQte() {
    const q = G.mode === 'play' ? G.qte : null;
    el.qte.style.display = q ? 'block' : 'none';
    if (!q) return;
    el.qte.classList.toggle('go', q.go);
    el.qteRing.style.transform = `scale(${(1 + q.size * 2.6).toFixed(3)})`;
    el.qteLabel.textContent = q.label;
}
function updateHud(dt) {
    updateQte();
    if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) el.sub.classList.remove('on'); }
    if (cardTimer > 0) { cardTimer -= dt; if (cardTimer <= 0) el.card.classList.remove('on'); }
    if (crossTimer > 0) { crossTimer -= dt; if (crossTimer <= 0) el.cross.classList.remove('hit'); }
    P.vign = Math.max(0, P.vign - dt * 1.4);
    el.vign.style.opacity = Math.max(P.vign, P.hp < 35 ? 0.35 + 0.15 * Math.sin(G.clock * 5) : 0).toFixed(2);
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.12;
    drawMini();
    // A heartbeat creeps in as health runs out.
    const heart = P.hp < 40 && G.mode === 'play' ? Math.round((40 - P.hp) / 8) / 5 : 0;
    if (heart !== heartLvl) { heartLvl = heart; Sfx.setAmbience({ heart }); }
    el.hp.style.width = clamp(P.hp, 0, 100) + '%';
    const W = WEAPONS[P.weapon];
    el.flame.style.width = (W.lit || (P.mounted && P.flame > 0) ? 100 : W.burns ? clamp(P.flame / 30 * 100, 0, 100) : 0) + '%';
    el.kills.textContent = G.kills;
    const n = aliveAllies();
    el.allies.textContent = G.act === 1 ? (G.phase === 'muster' || G.phase === 'charge' ? 'the horde rides' : '') :
        G.act === 4 ? 'alone' : n + (G.act === 2 ? ' Unsullied' : G.act === 5 ? ' archers' : ' defenders');
}

// ── Main loop ──
let last = performance.now(), acc = 0, manual = false, hitStop = 0;
function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // A landed blow freezes the world for a few hundredths of a second, which gives it weight.
    if (hitStop > 0) hitStop -= dt;
    else if (G.mode === 'play' && !manual) {
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
    muster: { wind: 0.7, drums: 0.25, crowd: 0.8 }, charge: { gallop: 1, drums: 0.8, wind: 0.5 }, clash: { battle: 1, gallop: 0.8, drums: 0.8 },
    retreat: { battle: 0.6, gallop: 1, drums: 0.8 }, afoot: { battle: 0.8, drums: 0.8 }, hold: { wind: 0.4, battle: 0.9, fire: 0.3, drums: 0.7, crowd: 0.5 },
    fallback: { battle: 1, fire: 0.6, drums: 0.8 }, siege: { wind: 0.3, battle: 1, fire: 0.6, drums: 0.6 }, dawn: { wind: 0.4, fire: 0.3 },
    halls: { wind: 0.12, battle: 0.3, fire: 0.5, drums: 0.5 }, grove: { wind: 0.6, battle: 0.7, fire: 0.4, drums: 0.7 },
    walkers: { wind: 0.9, battle: 0.2, fire: 0.3, drums: 0.9 }, fallen: { wind: 0.9, drums: 0.4, heart: 1 },
    arya: { wind: 1, drums: 0.9, heart: 0.6 }, leap: { wind: 1, drums: 0.9, heart: 0.8 }
};
function resume() {
    if (G.mode !== 'paused') return;
    G.mode = 'play';
    Sfx.unlock();
    Sfx.setAmbience(Object.assign({ wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0, crowd: 0, heart: 0 }, AMBIENCE[G.phase]));
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
                qte: G.qte ? { label: G.qte.label, go: G.qte.go } : null,
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
