// Winterfell: procedural sound. Everything is synthesised with the Web Audio
// API; there are no audio files. Every public method is a silent no-op until
// unlock() has run inside a user gesture, and wherever AudioContext is missing.

const MASTER = 0.7;
const MAX_VOICES = 16;        // simultaneous one-shots; new ones beyond this are dropped
const HARD_MAX_VOICES = 18;   // ceiling for the rare long cues that skip MAX_VOICES
const SAME_NAME_MS = 40;      // minimum gap between two plays of one name
const RAMP_TC = 0.13;         // time constant: about 0.4 s to settle
const TICK_MS = 100;
const LOOKAHEAD = 0.25;       // seconds of pattern scheduled ahead of the clock

const LAYERS = ['wind', 'battle', 'fire', 'gallop', 'drums', 'heart', 'crowd'];
const LAYER_GAIN = { wind: 0.5, battle: 0.6, fire: 0.5, gallop: 0.9, drums: 0.9, heart: 0.9, crowd: 0.7 };
// How much of each layer feeds the reverb send (the heartbeat stays dry, it is inside the head).
const LAYER_SEND = { wind: 0.35, battle: 0.6, fire: 0.3, gallop: 0.5, drums: 0.7, heart: 0, crowd: 0.45 };
const ONE_SHOT_SEND = 0.8;

// Reverb spaces. `rt` is the time to fall 60 dB, `damp` the one-pole low-pass
// coefficient at the start and end of the tail (small = dark), `early` the
// discrete reflections as [seconds, gain]. `wet` is the return level.
const SPACES = {
  field: { dur: 2.6, rt: 1.8, damp: [0.35, 0.04], pre: 0.04, early: [], wet: 0.1 },
  yard: { dur: 1.2, rt: 0.9, damp: [0.5, 0.1], pre: 0.012, early: [[0.05, 0.5], [0.095, 0.35], [0.16, 0.2]], wet: 0.34 },
  hall: { dur: 2.9, rt: 2.2, damp: [0.28, 0.04], pre: 0.02, early: [[0.021, 0.4], [0.043, 0.3], [0.07, 0.25]], wet: 0.5 },
  grove: { dur: 0.7, rt: 0.45, damp: [0.22, 0.05], pre: 0.006, early: [], wet: 0.2 },
};
const SPACE_FADE = 0.6;

let ctx = null;
let master = null;
let noiseBuf = null;
let crackleBuf = null;
let distCurve = null;
let clipCurve = null;
let oneBus = null;            // every one-shot except ui feeds this
let sendIn = null;            // reverb send input
let spaceName = 'field';
const rev = {};               // space name -> { conv, out, wet }, created lazily
let muted = false;
let timer = null;
let resumeGraceUntil = 0;     // wall clock: lets play() through right after unlock()
let listening = false;

const levels = { wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0, heart: 0, crowd: 0 };
const buses = {};             // layer name -> GainNode
const wind = { filter: null, mod: null, gust: null, gustF: null, whistle: null, whistleF: null };
const fire = { mod: null, s1: null, s2: null };
const crowd = { mod: null };
let rumble = null;            // gallop ground rumble gain
const next = { wind: 0, battle: 0, gallop: 0, drums: 0, fire: 0, heart: 0, crowd: 0, crowdMod: 0 };
const lastPlayed = {};        // name -> Date.now() of the last accepted play
let voiceEnds = [];           // ctx time at which each live one-shot ends

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── Small graph helpers ──────────────────────────────────────────────────────

// The voice being built. Sources register here so the one that ends last can
// tear the voice down.
let cur = null;

function track(node, t0, t1) {
  node.stop(t1);
  if (cur && t1 > cur.end) { cur.end = t1; cur.last = node; }
  return node;
}

function nz(t, dur, rate = 1, buf = noiseBuf) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, Math.random() * (buf.duration - 0.1));
  return track(s, t, t + dur);
}

function os(type, freq, t, dur) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  return track(o, t, t + dur);
}

function filt(type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(v = 0) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

// Attack to `peak` in `a` seconds, then exponential decay over `d` seconds.
function env(t, a, peak, d) {
  const g = gain(0);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  return g;
}

function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function shaper() {
  const w = ctx.createWaveShaper();
  w.curve = distCurve;
  return w;
}

// Build one voice into `dest`. Returns the ctx time it ends at (0 if nothing
// was started). The whole sub-graph hangs off one gain node, so disconnecting
// that node when the last source ends releases every node of the voice.
function spawn(dest, vol, pan, build) {
  const out = gain(vol);
  let pn = null;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    pn = ctx.createStereoPanner();
    pn.pan.value = clamp(pan, -1, 1);
    out.connect(pn);
    pn.connect(dest);
  } else {
    out.connect(dest);
  }
  const v = { end: 0, last: null };
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    try { out.disconnect(); if (pn) pn.disconnect(); } catch (e) { /* already gone */ }
  };
  const prev = cur;
  cur = v;
  try {
    build(out);
  } catch (e) {
    cur = prev;
    done();
    return 0;
  }
  cur = prev;
  if (v.last) v.last.onended = done; else done();
  return v.end;
}

// ── One-shots ────────────────────────────────────────────────────────────────
// Each builder gets (t, out, r): start time, the voice's output node, and the
// pitch rate.

const SOUNDS = {
  swing(t, o, r, opt) {
    const w = opt && opt.weapon;
    if (w === 'spear') {
      // Short thrusting whoosh: quick rise, little fall.
      const f = filt('bandpass', 900 * r, 2);
      f.frequency.setValueAtTime(900 * r, t);
      f.frequency.exponentialRampToValueAtTime(rnd(2600, 3200) * r, t + 0.07);
      f.frequency.exponentialRampToValueAtTime(1500 * r, t + 0.13);
      chain(nz(t, 0.15), f, env(t, 0.035, 0.5, 0.09), o);
    } else if (w === 'sword') {
      // Longer, heavier: lower sweep plus a body of low air.
      const f = filt('bandpass', 320 * r, 1.1);
      f.frequency.setValueAtTime(320 * r, t);
      f.frequency.exponentialRampToValueAtTime(rnd(1500, 1900) * r, t + 0.16);
      f.frequency.exponentialRampToValueAtTime(380 * r, t + 0.38);
      chain(nz(t, 0.4), f, env(t, 0.12, 0.65, 0.24), o);
      chain(nz(t, 0.35, 0.5), filt('lowpass', 420), env(t, 0.1, 0.35, 0.22), o);
    } else if (w === 'torch') {
      // Fluttering fiery whoosh with crackle riding on it.
      const f = filt('bandpass', 500 * r, 1);
      f.frequency.setValueAtTime(500 * r, t);
      f.frequency.exponentialRampToValueAtTime(rnd(1400, 1900) * r, t + 0.12);
      f.frequency.exponentialRampToValueAtTime(600 * r, t + 0.32);
      const fl = gain(0.55);
      chain(os('sine', rnd(24, 34), t, 0.36), gain(0.45), fl.gain);
      chain(nz(t, 0.36), f, fl, env(t, 0.1, 0.55, 0.22), o);
      chain(nz(t, 0.36, 1.2, crackleBuf), filt('highpass', 1400), env(t, 0.06, 0.4, 0.22), o);
    } else if (w === 'dagger') {
      // Quick thin flick.
      const f = filt('bandpass', 2600 * r, 2.2);
      f.frequency.setValueAtTime(2600 * r, t);
      f.frequency.exponentialRampToValueAtTime(rnd(5200, 6200) * r, t + 0.05);
      f.frequency.exponentialRampToValueAtTime(3000 * r, t + 0.1);
      chain(nz(t, 0.12), f, env(t, 0.025, 0.4, 0.07), o);
    } else {
      const f = filt('bandpass', 500 * r, 1.4);
      f.frequency.setValueAtTime(500 * r, t);
      f.frequency.exponentialRampToValueAtTime(rnd(2100, 2700) * r, t + 0.09);
      f.frequency.exponentialRampToValueAtTime(700 * r, t + 0.22);
      chain(nz(t, 0.24), f, env(t, 0.07, 0.55, 0.15), o);
    }
  },

  hit(t, o, r, opt) {
    const w = opt && opt.weapon;
    if (w === 'torch') {
      // Soft thump and a burst of sparks.
      const th = os('sine', 120 * r, t, 0.16);
      th.frequency.exponentialRampToValueAtTime(55 * r, t + 0.12);
      chain(th, env(t, 0.004, 0.7, 0.12), o);
      chain(nz(t, 0.07), filt('lowpass', 900), env(t, 0.002, 0.4, 0.05), o);
      chain(nz(t, 0.3, 1.4, crackleBuf), filt('highpass', 1500), env(t, 0.003, 0.9, 0.26), o);
      return;
    }
    if (w === 'dagger') {
      // Glassy tick on the dragonglass, with a small thud under it.
      const a = rnd(3800, 4600) * r;
      chain(os('sine', a, t, 0.1), env(t, 0.001, 0.3, 0.08), o);
      chain(os('sine', a * 1.5, t, 0.08), env(t, 0.001, 0.14, 0.06), o);
      chain(nz(t, 0.03), filt('highpass', 5000), env(t, 0.001, 0.4, 0.02), o);
      const th = os('sine', 130 * r, t, 0.1);
      th.frequency.exponentialRampToValueAtTime(60 * r, t + 0.07);
      chain(th, env(t, 0.003, 0.4, 0.08), o);
      return;
    }
    const heavy = w === 'sword';
    const stab = w === 'spear';
    chain(nz(t, 0.08), filt('highpass', 1700 * r), env(t, 0.002, stab ? 0.35 : 0.55, 0.06), o);
    chain(nz(t, 0.07), filt('bandpass', rnd(800, 1100) * r, 3), env(t, 0.002, 0.5, 0.05), o);
    const th = os('sine', (heavy ? 120 : stab ? 170 : 150) * r, t, heavy ? 0.3 : 0.18);
    th.frequency.exponentialRampToValueAtTime((heavy ? 40 : 52) * r, t + (heavy ? 0.2 : 0.12));
    chain(th, env(t, 0.003, heavy ? 0.95 : 0.8, heavy ? 0.26 : 0.15), o);
    if (stab) chain(nz(t, 0.1), filt('lowpass', 700), env(t, 0.004, 0.45, 0.08), o);
    if (heavy) {
      const ring = rnd(850, 1100) * r;
      chain(os('sine', ring, t, 0.35), env(t, 0.002, 0.12, 0.3), o);
      chain(os('sine', ring * 2.76, t, 0.2), env(t, 0.002, 0.06, 0.16), o);
    }
  },

  kill(t, o, r) {
    // Dry bone clatter: short woody knocks with a gritty click on each.
    const n = 3 + Math.floor(Math.random() * 3);
    let at = t;
    for (let i = 0; i < n; i++) {
      const f = rnd(380, 1100) * r;
      const k = os('sine', f, at, 0.07);
      k.frequency.exponentialRampToValueAtTime(f * 0.7, at + 0.05);
      chain(k, env(at, 0.001, rnd(0.25, 0.45), 0.045), o);
      chain(nz(at, 0.05), filt('bandpass', f * 2.4, 6), env(at, 0.001, rnd(0.7, 1.2), 0.035), o);
      at += rnd(0.03, 0.11);
    }
    // Icy tinkle on top.
    for (let i = 0; i < 4; i++) {
      const a = t + rnd(0.02, 0.4);
      const d = rnd(0.12, 0.3);
      chain(os('sine', rnd(4200, 9000) * r, a, d + 0.02), env(a, 0.002, rnd(0.04, 0.09), d), o);
    }
    const th = os('sine', 110 * r, t, 0.16);
    th.frequency.exponentialRampToValueAtTime(55 * r, t + 0.12);
    chain(th, env(t, 0.004, 0.35, 0.13), o);
  },

  hurt(t, o, r) {
    const th = os('sine', 115 * r, t, 0.32);
    th.frequency.exponentialRampToValueAtTime(42 * r, t + 0.22);
    chain(th, env(t, 0.004, 0.95, 0.28), o);
    const d = os('sawtooth', 170 * r, t, 0.26);
    d.frequency.exponentialRampToValueAtTime(68 * r, t + 0.22);
    chain(d, gain(2.5), shaper(), filt('lowpass', 650), env(t, 0.005, 0.24, 0.22), o);
    chain(nz(t, 0.06), filt('lowpass', 400), env(t, 0.002, 0.5, 0.05), o);
  },

  horn(t, o, r) {
    const f = 98 * r;
    const dur = 2.6;
    const lp = filt('lowpass', 220, 1.2);
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.linearRampToValueAtTime(680, t + 1.0);
    lp.frequency.setValueAtTime(680, t + 1.9);
    lp.frequency.linearRampToValueAtTime(240, t + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.3);   // slow swell: a breathy start
    g.gain.linearRampToValueAtTime(0.42, t + 1.1);
    g.gain.setValueAtTime(0.42, t + 1.9);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    chain(lp, g, o);
    const oscs = [];
    for (const cents of [-9, 0, 8]) {
      const s = os('sawtooth', f * 0.94, t, dur + 0.05);
      s.detune.value = cents;
      s.frequency.exponentialRampToValueAtTime(f, t + 0.45);
      s.frequency.setValueAtTime(f, t + 1.9);
      s.frequency.exponentialRampToValueAtTime(f * 0.93, t + dur);   // droop as the breath gives out
      s.connect(lp);
      oscs.push(s);
    }
    // Vibrato that arrives late, like a tiring player.
    const vib = gain(0);
    vib.gain.setValueAtTime(0, t);
    vib.gain.linearRampToValueAtTime(1.6, t + 2);
    chain(os('sine', 4.8, t, dur + 0.05), vib);
    for (const s of oscs) vib.connect(s.frequency);
    const sub = os('sine', f / 2, t, dur + 0.05);
    chain(sub, gain(0.9), g);
    // Breath: noise that rides the same swell.
    const bg = gain(0);
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(0.16, t + 0.25);
    bg.gain.linearRampToValueAtTime(0.06, t + 1.2);
    bg.gain.linearRampToValueAtTime(0.0001, t + dur);
    chain(nz(t, dur + 0.05), filt('bandpass', 900 * r, 0.8), bg, o);
  },

  screech(t, o, r) {
    const dur = rnd(0.5, 0.9);
    const lo = rnd(800, 1100) * r;
    const hi = rnd(2600, 3600) * r;
    const peakAt = t + dur * rnd(0.3, 0.45);
    const f = filt('bandpass', lo, 9);
    f.frequency.setValueAtTime(lo, t);
    f.frequency.exponentialRampToValueAtTime(hi, peakAt);
    f.frequency.exponentialRampToValueAtTime(lo * 1.3, t + dur);
    const g = env(t, 0.06, 0.5, dur - 0.06);
    chain(f, g, o);
    chain(nz(t, dur), gain(1.6), f);
    const v = os('sawtooth', lo / 2, t, dur);
    v.frequency.exponentialRampToValueAtTime(hi / 2, peakAt);
    v.frequency.exponentialRampToValueAtTime(lo * 0.65, t + dur);
    const lfo = os('sine', rnd(17, 26), t, dur);
    chain(lfo, gain(45), v.frequency);
    chain(v, gain(0.5), f);
  },

  whinny(t, o, r) {
    const dur = 1.05;
    const v = os('sawtooth', 1350 * r, t, dur);
    v.frequency.exponentialRampToValueAtTime(rnd(1800, 2000) * r, t + 0.11);
    v.frequency.exponentialRampToValueAtTime(620 * r, t + dur);
    const lfo = os('sine', 11, t, dur);
    const depth = gain(0);
    depth.gain.setValueAtTime(15, t);
    depth.gain.linearRampToValueAtTime(110, t + 0.5);
    chain(lfo, depth, v.frequency);
    const bp = filt('bandpass', 1700 * r, 1.1);
    bp.frequency.setValueAtTime(1900 * r, t);
    bp.frequency.exponentialRampToValueAtTime(900 * r, t + dur);
    chain(v, bp, env(t, 0.05, 0.4, dur - 0.06), o);
    chain(nz(t, dur * 0.8), filt('bandpass', 2400, 2), env(t, 0.08, 0.1, dur * 0.7), o);
  },

  ignite(t, o, r) {
    const dur = 1.5;
    const lp = filt('lowpass', 150, 0.9);
    lp.frequency.setValueAtTime(150, t);
    lp.frequency.exponentialRampToValueAtTime(2600 * r, t + 0.85);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.75, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    chain(nz(t, dur), lp, g, o);
    chain(nz(t + 0.15, dur - 0.15, 1.2, crackleBuf), filt('highpass', 1200),
      env(t + 0.15, 0.3, 0.7, dur - 0.5), o);
  },

  extinguish(t, o, r) {
    const lp = filt('lowpass', 9000, 0.7);
    lp.frequency.setValueAtTime(rnd(7500, 10000) * r, t);
    lp.frequency.exponentialRampToValueAtTime(2200, t + 0.24);
    chain(nz(t, 0.28), filt('highpass', 2800), lp, env(t, 0.012, 0.22, 0.24), o);
  },

  dragon(t, o, r) {
    const dur = 2;
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const trem = gain(0.65);
    chain(os('sine', rnd(21, 27), t, dur), gain(0.35), trem.gain);
    chain(trem, g, o);
    const lp = filt('lowpass', 90, 4);
    lp.frequency.setValueAtTime(90 * r, t);
    lp.frequency.exponentialRampToValueAtTime(280 * r, t + 0.6);
    lp.frequency.exponentialRampToValueAtTime(100 * r, t + dur);
    chain(nz(t, dur, 0.6), lp, trem);
    const v = os('sawtooth', 52 * r, t, dur);
    v.frequency.linearRampToValueAtTime(72 * r, t + 0.6);
    v.frequency.linearRampToValueAtTime(40 * r, t + dur);
    chain(v, gain(3), shaper(), filt('lowpass', 380), gain(0.45), trem);
  },

  shatter(t, o, r) {
    chain(nz(t, 0.35), filt('highpass', 3500), env(t, 0.002, 0.6, 0.3), o);
    chain(nz(t, 0.12), filt('bandpass', 1800 * r, 2), env(t, 0.002, 0.35, 0.1), o);
    for (let i = 0; i < 7; i++) {
      const at = t + (i === 0 ? 0 : rnd(0.03, 0.75));
      const d = rnd(0.15, 0.42);
      chain(os('sine', rnd(2500, 7500) * r, at, d + 0.02), env(at, 0.002, rnd(0.05, 0.11), d), o);
    }
  },

  step(t, o, r, opt) {
    const s = opt && opt.surface;
    if (s === 'stone') {
      // Short hard tap with a little grit.
      const f = rnd(1500, 2300) * r;
      chain(nz(t, 0.05), filt('bandpass', f, 1.6), env(t, 0.001, 0.5, 0.03), o);
      chain(os('sine', rnd(150, 200) * r, t, 0.08), env(t, 0.001, 0.35, 0.05), o);
      chain(os('sine', rnd(2400, 3200) * r, t, 0.05), env(t, 0.001, 0.05, 0.03), o);
      for (let i = 0; i < 3; i++) {
        const at = t + rnd(0.015, 0.07);
        chain(nz(at, 0.02), filt('highpass', 3500), env(at, 0.001, rnd(0.05, 0.14), 0.012), o);
      }
    } else if (s === 'wood') {
      // Hollow knock: two body modes.
      const f = rnd(170, 230) * r;
      const k = os('sine', f, t, 0.18);
      k.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.14);
      chain(k, env(t, 0.002, 0.6, 0.14), o);
      chain(os('sine', f * 1.85, t, 0.1), env(t, 0.002, 0.18, 0.07), o);
      chain(nz(t, 0.08), filt('bandpass', rnd(450, 650) * r, 7), env(t, 0.001, 0.8, 0.06), o);
      chain(nz(t, 0.02), filt('highpass', 2500), env(t, 0.001, 0.08, 0.015), o);
    } else if (s === 'mud') {
      // Wet squelch: a sucking band sweep with a low plop.
      const f = filt('bandpass', rnd(350, 500) * r, 4);
      f.frequency.setValueAtTime(rnd(350, 500) * r, t);
      f.frequency.exponentialRampToValueAtTime(rnd(900, 1400) * r, t + 0.12);
      f.frequency.exponentialRampToValueAtTime(300 * r, t + 0.2);
      chain(nz(t, 0.24), f, env(t, 0.02, 0.7, 0.17), o);
      const p = os('sine', 140 * r, t, 0.16);
      p.frequency.exponentialRampToValueAtTime(65 * r, t + 0.1);
      chain(p, env(t, 0.004, 0.5, 0.11), o);
      chain(nz(t, 0.1), filt('lowpass', 600), env(t, 0.004, 0.35, 0.08), o);
    } else {
      // Snow: soft body, a handful of tiny crunch pops and sometimes a squeak.
      chain(nz(t, 0.12), filt('lowpass', 800 * r), env(t, 0.012, 0.25, 0.09), o);
      const n = 4 + Math.floor(Math.random() * 3);
      let at = t + 0.005;
      for (let i = 0; i < n; i++) {
        chain(nz(at, 0.03), filt('bandpass', rnd(1800, 3800) * r, 1.2), env(at, 0.001, rnd(0.12, 0.3), 0.02), o);
        at += rnd(0.01, 0.028);
      }
      if (Math.random() < 0.6) {
        const f = rnd(2600, 4200) * r;
        const q = os('sine', f, t + 0.01, 0.1);
        q.frequency.exponentialRampToValueAtTime(f * rnd(0.8, 1.25), t + 0.09);
        chain(q, env(t + 0.01, 0.012, 0.04, 0.07), o);
      }
    }
  },

  gate(t, o, r) {
    const b = os('sine', 78 * r, t, 0.85);
    b.frequency.exponentialRampToValueAtTime(31 * r, t + 0.5);
    chain(b, env(t, 0.004, 1, 0.8), o);
    chain(nz(t, 0.45, 0.5), filt('lowpass', 210), env(t, 0.004, 0.8, 0.4), o);
    for (const [dt, v] of [[0, 0.7], [0.075, 0.35], [0.17, 0.16]]) {
      chain(nz(t + dt, 0.12), filt('bandpass', rnd(380, 470) * r, 5), env(t + dt, 0.002, v * 2, 0.09), o);
    }
    const k = os('triangle', 190 * r, t, 0.1);
    k.frequency.exponentialRampToValueAtTime(120 * r, t + 0.08);
    chain(k, env(t, 0.002, 0.4, 0.08), o);
  },

  clang(t, o, r) {
    // Steel (or ice) on steel: inharmonic ringing partials plus a bright strike.
    const f = rnd(1100, 1700) * r;
    const parts = [[1, 0.34, 0.5], [2.76, 0.24, 0.36], [5.4, 0.14, 0.24], [8.93, 0.08, 0.14]];
    for (const [k, a, d] of parts) {
      chain(os('sine', f * k, t, d + 0.02), env(t, 0.001, a, d), o);
      chain(os('sine', f * k * 1.006, t, d * 0.8 + 0.02), env(t, 0.001, a * 0.5, d * 0.8), o);
    }
    chain(nz(t, 0.04), filt('highpass', 2500), env(t, 0.001, 0.5, 0.025), o);
    chain(nz(t, 0.05), filt('bandpass', f * 1.3, 3), env(t, 0.001, 0.4, 0.04), o);
  },

  thud(t, o, r) {
    // A heavy body or door hitting the ground.
    const b = os('sine', 95 * r, t, 0.5);
    b.frequency.exponentialRampToValueAtTime(34 * r, t + 0.32);
    chain(b, env(t, 0.004, 1, 0.42), o);
    chain(nz(t, 0.3, 0.6), filt('lowpass', 260), env(t, 0.003, 0.8, 0.22), o);
    chain(nz(t, 0.6, 0.3), filt('lowpass', 110), env(t, 0.02, 0.9, 0.5), o);
    chain(nz(t, 0.05), filt('bandpass', 700 * r, 2), env(t, 0.001, 0.3, 0.04), o);
  },

  door(t, o, r) {
    // Heavy wooden door creaking open: stick-slip creak, scrape, final knock.
    const dur = 1.3;
    const saw = os('sawtooth', 120 * r, t, dur);
    for (let k = 1; k <= 12; k++) saw.frequency.linearRampToValueAtTime(rnd(90, 210) * r * (1 + k * 0.012), t + k * (dur / 12));
    const slip = gain(0.5);
    chain(os('sawtooth', rnd(11, 16), t, dur), gain(0.5), slip.gain);
    const cg = gain(0);
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.linearRampToValueAtTime(0.55, t + 0.3);
    cg.gain.setValueAtTime(0.55, t + 0.9);
    cg.gain.linearRampToValueAtTime(0.0001, t + dur);
    chain(saw, filt('bandpass', 650 * r, 5), slip, cg, o);
    const hi = os('triangle', 330 * r, t + 0.1, dur - 0.1);
    for (let k = 1; k <= 8; k++) hi.frequency.linearRampToValueAtTime(rnd(260, 520) * r, t + 0.1 + k * ((dur - 0.1) / 8));
    chain(hi, filt('bandpass', 1100 * r, 6), slip, gain(0.5), cg);
    const rg = gain(0);
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.linearRampToValueAtTime(0.5, t + 0.35);
    rg.gain.linearRampToValueAtTime(0.0001, t + dur);
    chain(nz(t, dur, 0.5), filt('lowpass', 220), rg, o);
    // The leaf comes to rest against the wall.
    const kt = t + dur - 0.12;
    const kk = os('sine', 100 * r, kt, 0.2);
    kk.frequency.exponentialRampToValueAtTime(52 * r, kt + 0.14);
    chain(kk, env(kt, 0.003, 0.5, 0.16), o);
    chain(nz(kt, 0.08), filt('bandpass', 500 * r, 3), env(kt, 0.002, 0.3, 0.06), o);
  },

  breath(t, o, r) {
    // One strained exhale.
    const dur = 0.85;
    const bp = filt('bandpass', 1000 * r, 0.8);
    bp.frequency.setValueAtTime(1000 * r, t);
    bp.frequency.linearRampToValueAtTime(1700 * r, t + 0.25);
    bp.frequency.linearRampToValueAtTime(900 * r, t + dur);
    chain(nz(t, dur), filt('highpass', 280), bp, env(t, 0.16, 0.55, dur - 0.18), o);
    chain(nz(t, dur, 0.6), filt('lowpass', 520), env(t, 0.2, 0.3, dur - 0.22), o);
  },

  roar(t, o, r) {
    // A giant: sub-heavy growl with vocal formants and a rough amplitude flutter.
    const dur = 1.5;
    const v = os('sawtooth', 58 * r, t, dur);
    v.frequency.linearRampToValueAtTime(84 * r, t + 0.45);
    v.frequency.linearRampToValueAtTime(40 * r, t + dur);
    const am = gain(0.6);
    chain(os('sine', 27, t, dur), gain(0.4), am.gain);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    chain(v, gain(2.5), shaper(), am);
    const f1 = filt('bandpass', 480 * r, 3);
    f1.frequency.linearRampToValueAtTime(380 * r, t + dur);
    const f2 = filt('bandpass', 900 * r, 3);
    f2.frequency.linearRampToValueAtTime(700 * r, t + dur);
    chain(am, f1, gain(1.4), g);
    chain(am, f2, gain(0.8), g);
    chain(am, filt('lowpass', 160), gain(0.8), g);
    chain(nz(t, dur, 0.7), filt('lowpass', 500), gain(0.5), am, g);
    chain(g, o);
  },

  iceCrack(t, o, r) {
    chain(nz(t, 0.06), filt('highpass', 2500), env(t, 0.001, 0.8, 0.04), o);
    for (let i = 0; i < 3; i++) {
      const at = t + rnd(0.02, 0.2);
      chain(nz(at, 0.03), filt('bandpass', rnd(3000, 6500) * r, 4), env(at, 0.001, 0.4, 0.02), o);
    }
    // A short creak as the sheet gives.
    const c = os('sawtooth', 300 * r, t + 0.03, 0.4);
    c.frequency.exponentialRampToValueAtTime(150 * r, t + 0.4);
    chain(os('sine', 38, t + 0.03, 0.4), gain(35), c.frequency);
    chain(c, filt('bandpass', 900 * r, 8), env(t + 0.03, 0.04, 0.4, 0.3), o);
    const th = os('sine', 150 * r, t, 0.22);
    th.frequency.exponentialRampToValueAtTime(60 * r, t + 0.18);
    chain(th, env(t, 0.003, 0.35, 0.17), o);
  },

  charge(t, o, r) {
    // A mass war cry: noise and a cluster of detuned voices through three vowel
    // formants that open and close, rising then falling over three seconds.
    const dur = 3;
    const src = gain(1);
    const mix = gain(1);
    chain(os('sine', rnd(5, 8), t, dur), gain(0.12), mix.gain);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.5);
    g.gain.linearRampToValueAtTime(0.9, t + 1.4);
    g.gain.linearRampToValueAtTime(0.7, t + 2.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    chain(mix, g, o);
    for (const [fc, q, w] of [[650, 5, 1], [1150, 6, 0.8], [2700, 7, 0.5]]) {
      const bp = filt('bandpass', fc * 0.8 * r, q);
      bp.frequency.setValueAtTime(fc * 0.8 * r, t);
      bp.frequency.exponentialRampToValueAtTime(fc * 1.25 * r, t + 1.4);
      bp.frequency.exponentialRampToValueAtTime(fc * 0.85 * r, t + dur);
      chain(src, bp, gain(w), mix);
    }
    chain(nz(t, dur, 0.8), gain(7), src);
    chain(nz(t, dur, 1.15), gain(5), src);
    for (let i = 0; i < 5; i++) {
      const f = rnd(105, 170) * r;
      const s = os('sawtooth', f, t, dur + 0.05);
      s.frequency.linearRampToValueAtTime(f * 1.4, t + 1.4);
      s.frequency.linearRampToValueAtTime(f * 0.85, t + dur);
      chain(s, gain(0.07), src);
    }
  },

  ui(t, o, r) {
    const s = os('sine', 700 * r, t, 0.08);
    s.frequency.exponentialRampToValueAtTime(430 * r, t + 0.05);
    chain(s, env(t, 0.003, 0.22, 0.06), o);
    chain(nz(t, 0.02), filt('highpass', 3000), env(t, 0.001, 0.06, 0.015), o);
  },
};

// Rough loudness balance between the cues.
const BASE = {
  swing: 0.8, hit: 0.6, kill: 0.6, hurt: 0.8, horn: 0.9, screech: 0.6, whinny: 0.5,
  ignite: 0.9, extinguish: 0.35, dragon: 0.9, shatter: 0.7, step: 0.8, gate: 0.9, ui: 0.6,
  clang: 0.7, thud: 0.9, door: 0.8, breath: 0.35, roar: 0.6, iceCrack: 0.7, charge: 0.4,
};

// Rare, long cues the game leans on: these skip the normal cap.
const PRIORITY = { horn: 1, dragon: 1, shatter: 1, gate: 1, ignite: 1, roar: 1, charge: 1, door: 1 };

// ── Ambience ─────────────────────────────────────────────────────────────────

function hoof(t, vol, low) {
  spawn(buses.gallop, vol, 0, (o) => {
    const f = (low ? 82 : 105) * rnd(0.93, 1.07);
    const th = os('sine', f, t, 0.12);
    th.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.07);
    chain(th, env(t, 0.003, 0.9, 0.09), o);
    chain(nz(t, 0.05), filt('lowpass', low ? 420 : 600), env(t, 0.002, 0.4, 0.035), o);
    chain(nz(t, 0.06), filt('bandpass', rnd(1500, 2600), 1), env(t, 0.002, 0.12, 0.04), o);
  });
}

function drum(t, vol) {
  spawn(buses.drums, vol, 0, (o) => {
    const th = os('sine', 64, t, 0.75);
    th.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    chain(th, env(t, 0.005, 1, 0.65), o);
    chain(nz(t, 0.2, 0.5), filt('lowpass', 190), env(t, 0.004, 0.6, 0.16), o);
  });
}

function battleEvent(t) {
  const pan = rnd(-0.8, 0.8);
  if (Math.random() < 0.55) {
    // A faint blade-on-blade clink.
    spawn(buses.battle, 1, pan, (o) => {
      const f = rnd(1800, 4200);
      const d = rnd(0.1, 0.25);
      chain(os('sine', f, t, d + 0.02), env(t, 0.001, 0.06, d), o);
      chain(os('sine', f * rnd(1.4, 1.6), t, d * 0.7 + 0.02), env(t, 0.001, 0.035, d * 0.7), o);
      if (Math.random() < 0.3) {
        const t2 = t + rnd(0.09, 0.16);
        chain(os('sine', f * 0.9, t2, 0.12), env(t2, 0.001, 0.04, 0.1), o);
      }
    });
  } else {
    // A far-off shout: a noise burst through a gliding vocal formant.
    spawn(buses.battle, 1, pan, (o) => {
      const d = rnd(0.3, 0.6);
      const f0 = rnd(450, 900);
      const bp = filt('bandpass', f0, 5);
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(f0 * rnd(0.7, 1.3), t + d);
      chain(nz(t, d + 0.05), bp, env(t, 0.08, 0.5, d - 0.08), o);
    });
  }
}

function heartBeat(t, period) {
  spawn(buses.heart, 1, 0, (o) => {
    const lub = os('sine', 68, t, 0.2);
    lub.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    chain(lub, env(t, 0.006, 0.9, 0.15), o);
    chain(os('triangle', 130, t, 0.12), env(t, 0.004, 0.25, 0.08), o);
    chain(nz(t, 0.08), filt('lowpass', 300), env(t, 0.003, 0.25, 0.06), o);
    const t2 = t + Math.min(0.2, period * 0.3);
    const dub = os('sine', 58, t2, 0.18);
    dub.frequency.exponentialRampToValueAtTime(38, t2 + 0.12);
    chain(dub, env(t2, 0.006, 0.6, 0.13), o);
    chain(os('triangle', 112, t2, 0.1), env(t2, 0.004, 0.15, 0.07), o);
  });
}

function crowdEvent(t) {
  const pan = rnd(-0.9, 0.9);
  const k = Math.random();
  spawn(buses.crowd, 1, pan, (o) => {
    if (k < 0.45) {
      // Shuffling feet and cloth.
      const n = 2 + Math.floor(Math.random() * 3);
      let at = t;
      for (let i = 0; i < n; i++) {
        chain(nz(at, 0.12), filt('bandpass', rnd(900, 2200), 0.9), env(at, 0.012, rnd(0.12, 0.25), rnd(0.04, 0.09)), o);
        at += rnd(0.05, 0.12);
      }
    } else if (k < 0.7) {
      // Leather creak.
      const d = rnd(0.15, 0.35);
      const f = rnd(180, 420);
      const s = os('sawtooth', f, t, d + 0.02);
      s.frequency.linearRampToValueAtTime(f * rnd(0.7, 1.4), t + d);
      chain(s, filt('bandpass', rnd(700, 1400), 9), env(t, 0.03, 0.12, d - 0.03), o);
    } else if (k < 0.85) {
      // A clink of metal.
      const f = rnd(2200, 5200);
      chain(os('sine', f, t, 0.16), env(t, 0.001, 0.07, 0.13), o);
      chain(os('sine', f * 1.51, t, 0.1), env(t, 0.001, 0.04, 0.08), o);
    } else {
      // A snort from a horse or a man.
      chain(nz(t, 0.22), filt('bandpass', rnd(600, 1100), 1.5), env(t, 0.02, 0.25, 0.14), o);
      chain(nz(t, 0.14), filt('lowpass', 300), env(t, 0.01, 0.2, 0.1), o);
    }
  });
}

function tick() {
  if (!ctx || muted || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const horizon = now + LOOKAHEAD;

  if (levels.wind > 0 && now >= next.wind) {
    wind.filter.frequency.setTargetAtTime(rnd(260, 950), now, rnd(0.6, 1.4));
    wind.mod.gain.setTargetAtTime(rnd(0.4, 1), now, rnd(0.5, 1.2));
    // Gusts: a band of air that swells and dies, wandering in pitch.
    const gusting = Math.random() < 0.55;
    wind.gust.gain.setTargetAtTime(gusting ? rnd(0.8, 2.6) : 0, now, rnd(0.4, 1.0));
    wind.gustF.frequency.setTargetAtTime(rnd(250, 900), now, 0.8);
    // A faint whistle through the cracks, here and gone.
    wind.whistle.gain.setTargetAtTime(Math.random() < 0.4 ? rnd(0.6, 1.6) : 0, now, rnd(0.5, 1.2));
    wind.whistleF.frequency.setTargetAtTime(rnd(1200, 2300), now, 0.7);
    next.wind = now + rnd(0.8, 2.6);
  }

  if (levels.fire > 0 && now >= next.fire) {
    fire.mod.gain.setTargetAtTime(rnd(0.3, 1.3), now, 0.15);
    fire.s1.playbackRate.setTargetAtTime(rnd(0.85, 1.15), now, 0.3);
    fire.s2.playbackRate.setTargetAtTime(rnd(0.55, 0.72), now, 0.3);
    next.fire = now + rnd(0.3, 1.1);
  }

  if (levels.crowd > 0) {
    if (next.crowd < now) next.crowd = now + rnd(0.05, 0.4);
    while (next.crowd < horizon) {
      crowdEvent(next.crowd);
      next.crowd += rnd(0.12, 0.6) / (0.5 + 0.5 * levels.crowd);
    }
    if (now >= next.crowdMod) {
      crowd.mod.gain.setTargetAtTime(rnd(0.4, 1), now, 1.2);
      next.crowdMod = now + rnd(1.5, 3.5);
    }
  }

  if (levels.heart > 0) {
    if (next.heart < now) next.heart = now + 0.03;
    while (next.heart < horizon) {
      const period = 60 / (70 + 60 * levels.heart);
      heartBeat(next.heart, period);
      next.heart += period;
    }
  }

  // A pattern whose next beat is already in the past (tab was hidden, timers
  // throttled) restarts from now. It never catches up on what it missed.
  if (levels.battle > 0) {
    if (next.battle < now) next.battle = now + rnd(0.05, 0.5);
    while (next.battle < horizon) {
      battleEvent(next.battle);
      next.battle += rnd(0.35, 1.6) / (0.4 + 0.6 * levels.battle);
    }
  }

  if (levels.gallop > 0) {
    if (next.gallop < now) next.gallop = now + 0.03;
    while (next.gallop < horizon) {
      const period = 1 / (2.2 + 0.8 * levels.gallop);
      const t = next.gallop;
      hoof(t, 0.65, false);
      hoof(t + period * 0.2, 0.75, false);
      hoof(t + period * 0.42, 1, true);
      next.gallop += period;
    }
  }

  if (levels.drums > 0) {
    if (next.drums < now) next.drums = now + 0.03;
    while (next.drums < horizon) {
      drum(next.drums, 1);
      drum(next.drums + 0.65, 0.4);
      next.drums += 1.3;
    }
  }
}

function syncTimer() {
  const need = !!ctx && !muted && LAYERS.some((n) => levels[n] > 0);
  if (need && timer === null) {
    timer = setInterval(() => { try { tick(); } catch (e) { /* never throw from audio */ } }, TICK_MS);
  } else if (!need && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function applyLevel(name) {
  const g = buses[name].gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(levels[name] * LAYER_GAIN[name], now, RAMP_TC);
  if (name === 'gallop' && rumble) {
    // The ground rumble grows faster than the hoofbeats as the charge builds.
    rumble.gain.cancelScheduledValues(now);
    rumble.gain.setTargetAtTime(7 * Math.pow(levels.gallop, 1.5), now, RAMP_TC);
  }
}

function loopSource(buf, rate) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start();
  return s;
}

// ── Setup ────────────────────────────────────────────────────────────────────

function makeBuffers() {
  const sr = ctx.sampleRate;

  noiseBuf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
  const n = noiseBuf.getChannelData(0);
  for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

  // Three seconds of pops with a wandering density and occasional bursts, looped
  // for the fire. Looping a buffer costs nothing per pop.
  crackleBuf = ctx.createBuffer(1, Math.floor(sr * 3), sr);
  const c = crackleBuf.getChannelData(0);
  let amp = 0;
  let decay = 0.97;
  let dens = 1;
  let target = 1;
  let burst = 0;
  const step = Math.floor(sr / 8);
  for (let i = 0; i < c.length; i++) {
    if (i % step === 0) target = Math.random() < 0.15 ? rnd(3, 6) : rnd(0.1, 1.3);
    dens += (target - dens) / (0.1 * sr);
    const chance = (22 / sr) * dens * (burst > 0 ? 25 : 1);
    if (Math.random() < chance) {
      const a2 = Math.random();
      amp = Math.max(amp, 0.12 + 0.88 * a2 * a2);
      decay = Math.pow(0.001, 1 / (sr * rnd(0.0015, 0.014)));
      if (burst > 0) burst--; else if (a2 > 0.7 && Math.random() < 0.5) burst = 2 + Math.floor(Math.random() * 3);
    }
    c[i] = amp > 0.001 ? (Math.random() * 2 - 1) * amp : 0;
    amp *= decay;
  }

  distCurve = new Float32Array(257);
  for (let i = 0; i < 257; i++) distCurve[i] = Math.tanh(3 * (i / 128 - 1));

  // Final soft clip: linear to 0.7, then bends toward about 0.92, so nothing
  // can reach full scale even when many loud cues stack.
  clipCurve = new Float32Array(1025);
  for (let i = 0; i < 1025; i++) {
    const x = i / 512 - 1;
    const ax = Math.abs(x);
    clipCurve[i] = ax < 0.7 ? x : Math.sign(x) * (0.7 + 0.28 * Math.tanh((ax - 0.7) / 0.28));
  }
}

// One impulse response per space: decaying noise that gets darker as it dies,
// with a few early reflections. Different noise per channel for width.
function makeIR(sp) {
  const sr = ctx.sampleRate;
  const len = Math.floor(Math.min(3, sp.dur) * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sp.pre * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const k = sp.damp[0] + (sp.damp[1] - sp.damp[0]) * Math.min(1, t / sp.rt);
      lp += k * ((Math.random() * 2 - 1) * Math.pow(0.001, t / sp.rt) - lp);
      d[i] = lp;
    }
    for (const [at, g] of sp.early) {
      const j = Math.floor((at + (ch ? 0.004 : 0)) * sr);
      if (j < len) d[j] += (Math.random() < 0.5 ? -1 : 1) * g;
    }
    const fade = Math.floor(len * 0.06);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  return buf;
}

function reverb(name) {
  let r = rev[name];
  if (r) return r;
  const sp = SPACES[name];
  const conv = ctx.createConvolver();
  conv.buffer = makeIR(sp);
  const out = gain(0);
  conv.connect(out);
  out.connect(master);
  r = rev[name] = { conv, out, wet: sp.wet };
  return r;
}

// Crossfade to the current space. Convolvers are created on first use, and a
// space that has faded out is unplugged from the send so it costs nothing.
function applySpace(instant) {
  if (!ctx || !sendIn) return;
  const now = ctx.currentTime;
  const fade = instant ? 0.01 : SPACE_FADE;
  const live = reverb(spaceName);
  sendIn.connect(live.conv);
  for (const n of Object.keys(rev)) {
    const g = rev[n].out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(n === spaceName ? rev[n].wet : 0, now + fade);
    if (n !== spaceName) {
      setTimeout(() => {
        try { if (spaceName !== n && ctx && rev[n]) sendIn.disconnect(rev[n].conv); } catch (e) { /* ignore */ }
      }, fade * 1000 + 250);
    }
  }
}

function build() {
  makeBuffers();

  master = gain(muted ? 0 : MASTER);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  const clip = ctx.createWaveShaper();
  clip.curve = clipCurve;
  chain(master, comp, clip, ctx.destination);

  sendIn = gain(1);
  oneBus = gain(1);
  oneBus.connect(master);
  const os1 = gain(ONE_SHOT_SEND);
  chain(oneBus, os1, sendIn);

  for (const name of LAYERS) {
    buses[name] = gain(0);
    buses[name].connect(master);
    if (LAYER_SEND[name] > 0) chain(buses[name], gain(LAYER_SEND[name]), sendIn);
  }

  wind.filter = filt('lowpass', 500, 2.4);
  wind.mod = gain(0.7);
  chain(loopSource(noiseBuf, 0.8), wind.filter, wind.mod, buses.wind);
  wind.gustF = filt('bandpass', 400, 0.9);
  wind.gust = gain(0);
  chain(loopSource(noiseBuf, 0.5), wind.gustF, wind.gust, buses.wind);
  wind.whistleF = filt('bandpass', 1700, 30);
  wind.whistle = gain(0);
  chain(loopSource(noiseBuf, 1), wind.whistleF, wind.whistle, buses.wind);

  chain(loopSource(noiseBuf, 0.45), filt('lowpass', 130, 0.8), gain(1.1), buses.battle);

  chain(loopSource(noiseBuf, 0.7), filt('highpass', 250), filt('lowpass', 1700), gain(0.12), buses.fire);
  fire.mod = gain(1);
  fire.mod.connect(buses.fire);
  fire.s1 = loopSource(crackleBuf, 1);
  fire.s2 = loopSource(crackleBuf, 0.63);
  chain(fire.s1, filt('highpass', 900), gain(0.7), fire.mod);
  chain(fire.s2, filt('bandpass', 700, 0.8), gain(0.5), fire.mod);

  rumble = gain(0);
  chain(loopSource(noiseBuf, 0.25), filt('lowpass', 80, 0.7), rumble, buses.gallop);

  crowd.mod = gain(0.7);
  chain(loopSource(noiseBuf, 0.5), filt('bandpass', 350, 0.6), gain(1.6), crowd.mod, buses.crowd);
  chain(loopSource(noiseBuf, 0.9), filt('bandpass', 1800, 0.5), gain(0.1), crowd.mod);

  for (const name of LAYERS) applyLevel(name);
  applySpace(true);
}

function resume() {
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  resumeGraceUntil = Date.now() + 400;
  const p = ctx.resume();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

// ── Public API ───────────────────────────────────────────────────────────────

export const Sfx = {
  // Call from a user gesture. Creates the AudioContext once and resumes it.
  unlock() {
    try {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        const made = new AC();
        ctx = made;
        try {
          build();
        } catch (e) {
          ctx = null;
          master = null;
          try { made.close(); } catch (e2) { /* ignore */ }
          return;
        }
        if (!listening && typeof document !== 'undefined' && document.addEventListener) {
          listening = true;
          // iOS suspends the context when the page is backgrounded.
          document.addEventListener('visibilitychange', () => {
            if (!document.hidden) { try { resume(); } catch (e) { /* ignore */ } }
          });
        }
      }
      resume();
      syncTimer();
    } catch (e) { /* stay silent */ }
  },

  get muted() { return muted; },

  setMuted(on) {
    muted = !!on;
    try {
      if (ctx) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setTargetAtTime(muted ? 0 : MASTER, now, 0.03);
      }
      syncTimer();
    } catch (e) { /* stay silent */ }
  },

  play(name, opts) {
    try {
      if (!ctx || muted) return;
      if (!Object.prototype.hasOwnProperty.call(SOUNDS, name)) return;
      const wall = Date.now();
      // A suspended context would queue these and fire them all on resume.
      if (ctx.state !== 'running' && wall > resumeGraceUntil) return;
      if (wall - (lastPlayed[name] || 0) < SAME_NAME_MS) return;

      const now = ctx.currentTime;
      if (voiceEnds.length) voiceEnds = voiceEnds.filter((e) => e > now);
      if (voiceEnds.length >= (PRIORITY[name] ? HARD_MAX_VOICES : MAX_VOICES)) return;
      lastPlayed[name] = wall;

      const o = opts || {};
      const vol = Number.isFinite(o.vol) ? clamp(o.vol, 0, 4) : 1;
      const pan = Number.isFinite(o.pan) ? clamp(o.pan, -1, 1) : 0;
      const rate = Number.isFinite(o.rate) && o.rate > 0 ? clamp(o.rate, 0.25, 4) : 1;
      if (vol === 0) return;

      const end = spawn(name === 'ui' ? master : oneBus, vol * BASE[name], pan, (out) => SOUNDS[name](now, out, rate, o));
      if (end) voiceEnds.push(end);
    } catch (e) { /* stay silent */ }
  },

  // 'field' | 'yard' | 'hall' | 'grove': the room every cue and layer is heard in.
  setSpace(name) {
    try {
      if (!Object.prototype.hasOwnProperty.call(SPACES, name) || name === spaceName) return;
      spaceName = name;
      applySpace(false);
    } catch (e) { /* stay silent */ }
  },

  // levels = partial { wind, battle, fire, gallop, drums, heart, crowd }, each 0..1.
  setAmbience(lv) {
    try {
      if (!lv) return;
      for (const name of LAYERS) {
        const v = lv[name];
        if (v === undefined || v === null) continue;
        const x = Number(v);
        if (!Number.isFinite(x)) continue;
        levels[name] = clamp(x, 0, 1);
        if (ctx) applyLevel(name);
      }
      syncTimer();
    } catch (e) { /* stay silent */ }
  },

  stopAll() {
    try {
      for (const name of LAYERS) {
        levels[name] = 0;
        if (ctx) applyLevel(name);
      }
      syncTimer();
    } catch (e) { /* stay silent */ }
  },
};
