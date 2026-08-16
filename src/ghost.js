import * as THREE from '../vendor/three.module.js';
import { createAircraft, disposeAircraft } from './aircraft.js';
import { store } from './store.js';

/**
 * The ghost: your best run at this challenge, flying alongside the one you are
 * flying now.
 *
 * A time on a results card tells you that you were four seconds slower. A ghost
 * tells you WHERE — that you were still with it at the second gate and lost the
 * lot in the turn after it — which is the only version of that information a
 * player can act on. It is the cheapest coaching in games.
 *
 * What is kept is a sampled flight path, not an input recording. Replaying
 * inputs would be exact and would also be a promise the physics cannot keep:
 * the air breathes on its own clock, and a stored stick position replayed into
 * a thermal that has moved on produces a ghost that flies into a hill. A path
 * is what was actually flown and always replays as what was actually flown.
 *
 * ---------------------------------------------------------------- storage ---
 *
 * Eight samples a second, quantised, base64 in localStorage. A ninety second
 * run is 720 samples of sixteen bytes, so about fifteen kilobytes encoded, and
 * twelve challenges' worth fits inside two hundred — comfortably inside the
 * budget for a store that also has to hold the medals and be allowed to fail.
 *
 * Positions are Int16 in half-metres from the run's own origin, which gives
 * 0.5 m of resolution over sixteen kilometres either way: finer than the ghost
 * can be seen to be wrong, and wider than the longest distance run. Attitude is
 * four Int16, because a ghost that jitters in roll is a ghost you stop
 * believing. The score at each sample rides along in the same record so the
 * instruments can say how far ahead of it you are without replaying anything.
 */

/** Samples per second. Eight is smooth once interpolated and cheap to store. */
const HZ = 8;
/** Position quantum, metres. */
const STEP = 0.5;
/** Anything longer than this is not a challenge; the cap is a storage guard. */
const MAX_SAMPLES = 900;
const KEY = 'windward.ghosts.v1';
/** Bytes per sample: 3 position, 4 attitude, 1 score. */
const STRIDE = 16;

// ------------------------------------------------------------- recording ---
/**
 * Watches a run and hands back a track when it finishes. Sampling is on the
 * run's own clock rather than on frames, so a hitch cannot stretch a ghost.
 */
export class Recorder {
  constructor() {
    this.reset();
  }

  reset() {
    this.origin = null;
    this.pos = [];
    this.rot = [];
    this.score = [];
  }

  /** @param {number} elapsed seconds into the run @param {object} glider */
  sample(elapsed, glider, score) {
    const n = this.score.length;
    if (n >= MAX_SAMPLES) return;
    // Sample n is due at n/HZ, worked out from the count each time rather than
    // carried in a cursor: self-correcting, and it cannot drift.
    if (elapsed < n / HZ) return;
    if (!this.origin) this.origin = glider.position.clone();
    this.pos.push(
      glider.position.x - this.origin.x,
      glider.position.y - this.origin.y,
      glider.position.z - this.origin.z
    );
    const q = glider.quaternion;
    this.rot.push(q.x, q.y, q.z, q.w);
    this.score.push(score);
  }

  /** @returns {string|null} the encoded track, or null if there is nothing worth keeping. */
  encode() {
    const n = this.score.length;
    if (n < 4 || !this.origin) return null;
    // One scale for the whole track, so a roll count and six kilometres of
    // distance both survive being squeezed into an Int16.
    const peak = Math.max(1e-3, ...this.score.map(Math.abs));
    const scale = peak / 32000;
    const head = new Float32Array([this.origin.x, this.origin.y, this.origin.z, scale]);
    const body = new Int16Array(n * 8);
    const clamp16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v)));
    for (let i = 0; i < n; i++) {
      body[i * 8 + 0] = clamp16(this.pos[i * 3] / STEP);
      body[i * 8 + 1] = clamp16(this.pos[i * 3 + 1] / STEP);
      body[i * 8 + 2] = clamp16(this.pos[i * 3 + 2] / STEP);
      body[i * 8 + 3] = clamp16(this.rot[i * 4] * 32767);
      body[i * 8 + 4] = clamp16(this.rot[i * 4 + 1] * 32767);
      body[i * 8 + 5] = clamp16(this.rot[i * 4 + 2] * 32767);
      body[i * 8 + 6] = clamp16(this.rot[i * 4 + 3] * 32767);
      body[i * 8 + 7] = clamp16(this.score[i] / scale);
    }
    const bytes = new Uint8Array(16 + body.byteLength);
    bytes.set(new Uint8Array(head.buffer), 0);
    bytes.set(new Uint8Array(body.buffer), 16);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
}

/** @returns {{origin:THREE.Vector3, scale:number, n:number, body:Int16Array}|null} */
export function decode(text) {
  if (!text) return null;
  try {
    const raw = atob(text);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (bytes.length < 16 + STRIDE) return null;
    const head = new Float32Array(bytes.buffer.slice(0, 16));
    const body = new Int16Array(bytes.buffer.slice(16));
    const n = Math.floor(body.length / 8);
    if (!n || !isFinite(head[3])) return null;
    return { origin: new THREE.Vector3(head[0], head[1], head[2]), scale: head[3], n, body };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- the book ---
function load() {
  try {
    const raw = JSON.parse(store.get(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function loadGhost(id) {
  return decode(load()[id]);
}

/**
 * Keep a track against a challenge id. A ghost is worth strictly less than the
 * medals it sits beside, so a full store must never cost a medal: the write is
 * tried, and if it is refused the oldest ghosts are dropped and it is tried
 * again before giving up quietly.
 */
export function saveGhost(id, encoded) {
  if (!encoded) return;
  const book = load();
  book[id] = encoded;
  const keys = Object.keys(book);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(book));
      return;
    } catch {
      // Drop somebody else's ghost, never this one.
      const victim = keys.find((k) => k !== id && book[k]);
      if (!victim) return;
      delete book[victim];
    }
  }
}

// -------------------------------------------------------------- playback ---
/**
 * The aeroplane the ghost flies. One instance for the session: it is the same
 * ship every time, so it is built once and moved rather than rebuilt per run.
 */
export class Ghost {
  constructor(scene, sky, spec) {
    this.mesh = createAircraft(sky, spec, { ghost: true });
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.track = null;
    this.score = 0;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
  }

  /** Put a challenge's best run on the field. @returns whether there was one. */
  load(id) {
    this.track = loadGhost(id);
    this.score = 0;
    this.mesh.visible = false;
    return !!this.track;
  }

  clear() {
    this.track = null;
    this.mesh.visible = false;
  }

  /**
   * Move the ghost to where it was this far into its run. Past the end it holds
   * its last attitude rather than vanishing — a ghost that disappears the
   * instant it finishes takes the answer with it.
   */
  seek(elapsed) {
    const t = this.track;
    if (!t) return;
    const at = Math.min(elapsed * HZ, t.n - 1);
    const i = Math.max(0, Math.floor(at));
    const j = Math.min(t.n - 1, i + 1);
    const f = at - i;
    const b = t.body;
    this._a.set(b[i * 8] * STEP, b[i * 8 + 1] * STEP, b[i * 8 + 2] * STEP).add(t.origin);
    this._b.set(b[j * 8] * STEP, b[j * 8 + 1] * STEP, b[j * 8 + 2] * STEP).add(t.origin);
    this.mesh.position.copy(this._a).lerp(this._b, f);
    this._qa.set(b[i * 8 + 3] / 32767, b[i * 8 + 4] / 32767, b[i * 8 + 5] / 32767, b[i * 8 + 6] / 32767).normalize();
    this._qb.set(b[j * 8 + 3] / 32767, b[j * 8 + 4] / 32767, b[j * 8 + 5] / 32767, b[j * 8 + 6] / 32767).normalize();
    this.mesh.quaternion.copy(this._qa).slerp(this._qb, f);
    this.score = b[i * 8 + 7] * t.scale;
    this.mesh.visible = true;
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of this.mesh.userData.materials) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }

  dispose() {
    disposeAircraft(this.mesh);
  }
}
