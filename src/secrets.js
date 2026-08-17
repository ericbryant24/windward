import * as THREE from '../vendor/three.module.js';
import { onCorridor } from './challenges.js';

/**
 * The things nobody told you to do.
 *
 * The map already had sixty-nine named places and a discovery system, and that
 * system was a checklist: fly within eight hundred metres of a mountain and it
 * ticks. Nothing was hidden, nothing rewarded going where the game had not
 * pointed, and every place put a label on the horizon before you reached it.
 *
 * A secret is the opposite of that. It is not signposted, it does not appear on
 * the map, and the only thing the menu will tell you about one you have not
 * found is a sentence that is true and unhelpful. Finding it has to be a thing
 * you DID — a line flown, a place landed at, a gap gone through — rather than a
 * radius entered while going somewhere else.
 *
 * Three verbs, and no more until a fourth secret actually needs one:
 *
 *   place  be inside a small radius, within a height band, optionally upside
 *          down. The band is what stops it triggering on the ferry glide over.
 *   land   wheels down and stopped inside a radius. Landing works now, and
 *          almost nowhere on either map is worth landing at.
 *   trace  hold under a ceiling along a path for so many seconds. This is the
 *          deck-run rule with the scoring taken off, and it is the one that
 *          turns the surveyed railway and river lines into something to fly.
 *
 * There was going to be a fourth — chase a train or a cable car — and it is not
 * here because the movers are generated inside Network's draw loop and culled
 * against the camera, so a secret hung off one would fire or not fire depending
 * on where you were looking. That is worth doing properly or not at all.
 */

/** How close counts as "at" a place, when the def does not say. */
const PLACE_RADIUS = 220;
/** Bank beyond this is upside down for the purpose of an `inverted` secret. */
const INVERTED_BANK = 120;
/** A trace has to be flown in one go; drop off the line for longer and it resets. */
const TRACE_GRACE = 2.5;

export class Secrets {
  /**
   * @param {object} world     for lat/lon -> local
   * @param {object} hf        the heightfield, for ground under a place
   * @param {object[]} defs    the region's authored secrets
   * @param {string[]} found   ids already in the player's profile
   */
  constructor(world, hf, defs = [], found = []) {
    this.hf = hf;
    this.found = new Set(found);
    this.events = [];
    this._v = new THREE.Vector3();

    this.defs = defs.map((def) => {
      const s = { def, id: def.id };
      if (def.kind === 'trace') {
        const pts = def.path.map(([lat, lon]) => world.toLocal(lat, lon));
        const cum = [0];
        for (let i = 1; i < pts.length; i++) {
          cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        }
        // Same shape buildCorridor makes, so onCorridor can read it.
        s.line = { pts, cum, length: cum[cum.length - 1], width: def.width, ceiling: def.ceiling };
        s.held = 0;
        s.slack = 0;
      } else {
        const v = world.toLocal(def.lat, def.lon);
        s.x = v.x;
        s.z = v.z;
        s.ground = hf.heightAt(v.x, v.z);
        s.radius = def.radius ?? PLACE_RADIUS;
      }
      return s;
    });
  }

  /** Everything authored for this region, found or not — the menu's list. */
  get all() {
    return this.defs.map((s) => ({ def: s.def, found: this.found.has(s.id) }));
  }

  get count() {
    return this.defs.filter((s) => this.found.has(s.id)).length;
  }

  /** Forget the in-progress state of every trace. Called when a flight restarts. */
  reset() {
    for (const s of this.defs) {
      if (s.line) {
        s.held = 0;
        s.slack = 0;
      }
    }
  }

  /**
   * @param {object} g the glider — position, bankDeg, onGround, airspeed
   * @param {number} agl height over the ground right now
   * @returns {object[]} `{kind:'found', def}` for anything earned this step
   */
  update(dt, g, agl) {
    this.events.length = 0;
    const p = g.position;
    for (const s of this.defs) {
      if (this.found.has(s.id)) continue;
      if (s.line ? this.#trace(dt, s, p, agl) : this.#at(s, g, p, agl)) {
        this.found.add(s.id);
        this.events.push({ kind: 'found', def: s.def });
      }
    }
    return this.events;
  }

  #at(s, g, p, agl) {
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    if (dx * dx + dz * dz > s.radius * s.radius) return false;
    const def = s.def;
    if (def.kind === 'land') {
      // Down, and actually stopped. Touching a wheel at ninety knots on the
      // way past is not landing somewhere.
      return g.onGround && g.airspeed < (def.speed ?? 12);
    }
    // A height band measured off the ground under the POINT rather than under
    // the aeroplane: the interesting ones are beside a cliff, where the ground
    // under you and the ground under the thing are hundreds of metres apart.
    const band = def.agl;
    if (band) {
      const h = p.y - s.ground;
      if (h < band[0] || h > band[1]) return false;
    }
    if (def.inverted && Math.abs(g.bankDeg) < INVERTED_BANK) return false;
    if (def.below != null && agl > def.below) return false;
    return true;
  }

  #trace(dt, s, p, agl) {
    const { off } = onCorridor(s.line, p.x, p.z);
    const on = off <= s.line.width && agl <= s.line.ceiling;
    if (on) {
      s.slack = 0;
      s.held += dt;
      return s.held >= s.def.seconds;
    }
    // A short break is a bump, not a failure. A long one means you left.
    s.slack += dt;
    if (s.slack > TRACE_GRACE) s.held = 0;
    return false;
  }
}
