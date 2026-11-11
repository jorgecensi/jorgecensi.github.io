// Winterfell: procedural sound. Everything is synthesised with the Web Audio
// API; there are no audio files. Every public method is a silent no-op until
// unlock() has run inside a user gesture, and wherever AudioContext is missing.

const MASTER = 0.7;
const MAX_VOICES = 14;        // simultaneous one-shots; new ones beyond this are dropped
const HARD_MAX_VOICES = 20;   // ceiling for the rare long cues that skip MAX_VOICES
const SAME_NAME_MS = 40;      // minimum gap between two plays of one name
const RAMP_TC = 0.13;         // time constant: about 0.4 s to settle
const TICK_MS = 100;
const LOOKAHEAD = 0.25;       // seconds of pattern scheduled ahead of the clock

const LAYERS = ['wind', 'battle', 'fire', 'gallop', 'drums'];
const LAYER_GAIN = { wind: 0.5, battle: 0.6, fire: 0.5, gallop: 0.9, drums: 0.9 };

let ctx = null;
let master = null;
let noiseBuf = null;
let crackleBuf = null;
let distCurve = null;
let muted = false;
let timer = null;
let resumeGraceUntil = 0;     // wall clock: lets play() through right after unlock()
let listening = false;

const levels = { wind: 0, battle: 0, fire: 0, gallop: 0, drums: 0 };
const buses = {};             // layer name -> GainNode
const wind = { filter: null, mod: null };
const next = { wind: 0, battle: 0, gallop: 0, drums: 0 };
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
  swing(t, o, r) {
    const f = filt('bandpass', 500 * r, 1.4);
    f.frequency.setValueAtTime(500 * r, t);
    f.frequency.exponentialRampToValueAtTime(rnd(2100, 2700) * r, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(700 * r, t + 0.22);
    chain(nz(t, 0.24), f, env(t, 0.07, 0.55, 0.15), o);
  },

  hit(t, o, r) {
    chain(nz(t, 0.08), filt('highpass', 1700 * r), env(t, 0.002, 0.55, 0.06), o);
    chain(nz(t, 0.07), filt('bandpass', rnd(800, 1100) * r, 3), env(t, 0.002, 0.5, 0.05), o);
    const th = os('sine', 150 * r, t, 0.18);
    th.frequency.exponentialRampToValueAtTime(52 * r, t + 0.12);
    chain(th, env(t, 0.003, 0.8, 0.15), o);
  },

  kill(t, o, r) {
    const n = Math.random() < 0.5 ? 2 : 3;
    let at = t;
    for (let i = 0; i < n; i++) {
      const f = rnd(900, 2600) * r;
      chain(nz(at, 0.08), filt('bandpass', f, 7), env(at, 0.001, rnd(0.9, 1.4), 0.055), o);
      const k = os('triangle', f * 0.5, at, 0.05);
      chain(k, env(at, 0.001, 0.12, 0.035), o);
      at += rnd(0.05, 0.1);
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
    const dur = 2.5;
    const lp = filt('lowpass', 220, 1.2);
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.linearRampToValueAtTime(680, t + 0.7);
    lp.frequency.setValueAtTime(680, t + 1.9);
    lp.frequency.linearRampToValueAtTime(260, t + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.6);
    g.gain.setValueAtTime(0.42, t + 1.9);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    chain(lp, g, o);
    for (const cents of [-9, 0, 8]) {
      const s = os('sawtooth', f * 0.94, t, dur + 0.05);
      s.detune.value = cents;
      s.frequency.exponentialRampToValueAtTime(f, t + 0.35);
      s.connect(lp);
    }
    const sub = os('sine', f / 2, t, dur + 0.05);
    chain(sub, gain(0.9), g);
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

  step(t, o, r) {
    const f = filt('bandpass', rnd(800, 1400) * r, 0.8);
    chain(nz(t, 0.1), f, env(t, 0.006, 0.3, 0.07), o);
    chain(nz(t + 0.025, 0.06), filt('highpass', 2500), env(t + 0.025, 0.004, 0.08, 0.04), o);
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
};

// Rare, long cues the game leans on: these skip the normal cap.
const PRIORITY = { horn: 1, dragon: 1, shatter: 1, gate: 1, ignite: 1 };

// ── Ambience ─────────────────────────────────────────────────────────────────

function hoof(t, vol, low) {
  spawn(buses.gallop, vol, 0, (o) => {
    const f = (low ? 82 : 105) * rnd(0.93, 1.07);
    const th = os('sine', f, t, 0.12);
    th.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.07);
    chain(th, env(t, 0.003, 0.9, 0.09), o);
    chain(nz(t, 0.05), filt('lowpass', low ? 420 : 600), env(t, 0.002, 0.4, 0.035), o);
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

function tick() {
  if (!ctx || muted || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const horizon = now + LOOKAHEAD;

  if (levels.wind > 0 && now >= next.wind) {
    wind.filter.frequency.setTargetAtTime(rnd(260, 950), now, rnd(0.6, 1.4));
    wind.mod.gain.setTargetAtTime(rnd(0.4, 1), now, rnd(0.5, 1.2));
    next.wind = now + rnd(0.8, 2.6);
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
  const need = !!ctx && !muted &&
    (levels.wind > 0 || levels.battle > 0 || levels.gallop > 0 || levels.drums > 0);
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

  // Three seconds of sparse pops with random size and decay, looped for the
  // fire. Looping a buffer costs nothing per pop.
  crackleBuf = ctx.createBuffer(1, Math.floor(sr * 3), sr);
  const c = crackleBuf.getChannelData(0);
  const popChance = 26 / sr;
  let amp = 0;
  let decay = 0.97;
  for (let i = 0; i < c.length; i++) {
    if (Math.random() < popChance) {
      const a = Math.random();
      amp = Math.max(amp, 0.15 + 0.85 * a * a);
      decay = Math.pow(0.001, 1 / (sr * rnd(0.002, 0.014)));
    }
    c[i] = amp > 0.001 ? (Math.random() * 2 - 1) * amp : 0;
    amp *= decay;
  }

  distCurve = new Float32Array(257);
  for (let i = 0; i < 257; i++) distCurve[i] = Math.tanh(3 * (i / 128 - 1));
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
  chain(master, comp, ctx.destination);

  for (const name of LAYERS) {
    buses[name] = gain(0);
    buses[name].connect(master);
  }

  wind.filter = filt('lowpass', 500, 2.4);
  wind.mod = gain(0.7);
  chain(loopSource(noiseBuf, 0.8), wind.filter, wind.mod, buses.wind);

  chain(loopSource(noiseBuf, 0.45), filt('lowpass', 130, 0.8), gain(1.1), buses.battle);

  chain(loopSource(noiseBuf, 0.7), filt('highpass', 250), filt('lowpass', 1700), gain(0.12), buses.fire);
  chain(loopSource(crackleBuf, 1), filt('highpass', 900), gain(0.7), buses.fire);
  chain(loopSource(crackleBuf, 0.63), filt('bandpass', 700, 0.8), gain(0.5), buses.fire);

  for (const name of LAYERS) applyLevel(name);
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

      const end = spawn(master, vol * BASE[name], pan, (out) => SOUNDS[name](now, out, rate));
      if (end) voiceEnds.push(end);
    } catch (e) { /* stay silent */ }
  },

  // levels = partial { wind, battle, fire, gallop, drums }, each 0..1.
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
