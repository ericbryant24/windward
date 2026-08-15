import * as THREE from '../vendor/three.module.js';
import { LIFT_MIN } from './airviz.js';

/**
 * The moving map.
 *
 * A glider pilot's plan view is not a street map. What decides the next ten
 * minutes is where the air goes up, where it goes down, where the water is —
 * because water is cold, sinking and unlandable — and where the ground is high
 * enough to reach out and hit you. Roads and place names are how you keep track
 * of all that; they are not the point of the picture. So this draws, in order
 * of how much it matters: the lift and sink field, the water, the relief, the
 * city, and only then the labels.
 *
 * Everything expensive is baked once into two offscreen rasters at load:
 *
 *   ground  Relief, water, forest, the built-up area and the arterial roads,
 *           at 512 px across the whole region. Never changes.
 *   air     A coarse plan of the vertical air, every cell an honest Air.sample
 *           at a working height above the ground under it. The sun is fixed,
 *           so the thermals never move and this is baked once.
 *
 * On top of the baked plan go the two things that are only true of right now:
 * how far this ship can still glide, and which columns it has already climbed
 * out of the top of. Both are a handful of paths, because per frame this map
 * has to stay two drawImage calls and a few dozen small ones — it sits on top
 * of a scene already drawing a hundred and forty-five thousand buildings, on a
 * phone.
 */

/** Whole-region rasters. Both maps bake to the same size; only the metres change. */
const GROUND = 512;
const AIR = 128;
/**
 * Height above ground the air plan is read at. High enough that a thermal has
 * spun up (they ramp over the first 180 m), low enough that the ridge band —
 * which decays with an e-fold of 320 m — and the shore convergence, which is
 * capped at 900 m, are both still there to be found.
 */
const AIR_AGL = 260;
/** Below this the air is taking you down hard enough to be worth marking, m/s. */
const SINK_MIN = -1.1;
/**
 * Height to arrive over the far edge of the inner glide ring with. The outer
 * ring is the deck — where the still-air glide runs out and you are landing,
 * wherever you happen to be. Nobody plans to that one.
 */
const ARRIVAL = 150;
/**
 * What still-air best glide is worth in practice. Best L/D is measured at one
 * speed in air that is not going anywhere; a ring drawn at the book figure
 * promises ground the ship does not reach through real sink.
 */
const GLIDE_REALISM = 0.75;
/** The sim runs at 120 Hz. The map moves a pixel every 50 ms; draw it then. */
const REDRAW = 1 / 20;
const TAU = Math.PI * 2;

/** Bronze, silver, gold and the unearned ring, matching the world labels. */
const MEDAL_INK = ['#61d2ff', '#b06f3c', '#e2ecf5', '#ffcf70'];

/**
 * Hypsometric ramp, valley floor to summit snow, and deliberately almost
 * colourless: a green pasture and a warm brown scree are pretty, but the only
 * thing on this map that has any business being a strong warm colour is the
 * lift. Enough green stays in the low ground to tell a meadow from a glacier.
 * Used in full only where the region has relief worth colouring — see below.
 */
const RAMP = [
  [0.0, 44, 58, 50],
  [0.3, 60, 68, 58],
  [0.55, 78, 80, 76],
  [0.75, 102, 104, 104],
  [0.88, 152, 160, 168],
  [1.0, 214, 224, 234],
];

export class Minimap {
  constructor(canvas, { heightfield, air, world, challenges, buildingData, networkData }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hf = heightfield;
    this.air = air;
    this.world = world;
    this.challenges = challenges;
    this.half = heightfield.halfSize;

    // One presentation, two regions that differ by a factor of three. Tying the
    // window to the region rather than fixing it keeps the same *sort* of view
    // on both — a good part of the map, not a postage stamp of it and not the
    // whole thing shrunk past reading — and the clamps stop either extreme.
    // Chicago lands on 3 km, which is the Loop and the lakefront; the Jungfrau
    // on 7.5 km, which is Interlaken to the Eiger.
    this.range = Math.round(THREE.MathUtils.clamp(this.half * 0.45, 3000, 7500) / 500) * 500;

    this.ground = this.#bakeGround(buildingData, networkData);
    this.airPlan = document.createElement('canvas');
    this.rebake();
    this._acc = REDRAW; // draw on the very first update, not a twentieth late
  }

  /** One honest Air.sample per cell. Costly, and the sky it describes is fixed. */
  rebake() {
    const n = AIR;
    const half = this.half;
    const step = (half * 2) / n;
    const cv = this.airPlan;
    cv.width = cv.height = n;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(n, n);
    const d = img.data;
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();

    for (let j = 0; j < n; j++) {
      const z = -half + (j + 0.5) * step;
      for (let i = 0; i < n; i++) {
        const x = -half + (i + 0.5) * step;
        const w = this.air.sample(p.set(x, this.hf.heightAt(x, z) + AIR_AGL, z), v).y;
        const q = (j * n + i) * 4;
        if (w >= LIFT_MIN) {
          // The same gold the shafts of haze and the cumulus are drawn in, so a
          // glance up and a glance down are describing the one thing.
          //
          // The curve is bent toward the weak end on purpose. Linear, the four
          // metres a second in a thermal core saturate the scale and the one
          // and a bit along the Chicago convergence line — the only lift on
          // that map you can count on finding twice — comes out as a smudge.
          const a = Math.min(1, (w - LIFT_MIN) / 2.2) ** 0.6;
          d[q] = 255;
          d[q + 1] = 206;
          d[q + 2] = 116;
          d[q + 3] = Math.round(38 + 168 * a);
        } else if (w <= SINK_MIN) {
          // Sink is drawn as darkness rather than a colour: it needs to read
          // instantly as somewhere you do not go, and over Lake Michigan it
          // covers half the map, which no colour survives. Background sink is
          // -0.42 everywhere, so the threshold is well clear of "ordinary air"
          // and what lights up is the lake and nothing else.
          const a = Math.min(1, (SINK_MIN - w) / 1.5);
          d[q] = 2;
          d[q + 1] = 7;
          d[q + 2] = 14;
          d[q + 3] = Math.round(28 + 118 * a);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /**
   * @param {object} state position, headingDeg, the objective the HUD is
   *   pointing at, and which landmarks have been found.
   */
  update(dt, state) {
    this._acc += dt;
    if (this._acc < REDRAW) return;
    this._acc = 0;
    this.#draw(state);
  }

  // -------------------------------------------------------------- bake ---
  #bakeGround(buildingData, networkData) {
    const n = GROUND;
    const hf = this.hf;
    const half = this.half;
    const step = (half * 2) / n;

    // Sampled up front rather than inside the shading loop, because the hill
    // shade needs each cell's neighbours and re-reading the heightfield four
    // times per pixel to get them costs more than the array.
    const height = new Float32Array(n * n);
    const water = new Uint8Array(n * n);
    const wood = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = -half + (j + 0.5) * step;
      for (let i = 0; i < n; i++) {
        const x = -half + (i + 0.5) * step;
        const p = j * n + i;
        height[p] = hf.heightAt(x, z);
        water[p] = hf.isWater(x, z) ? 1 : 0;
        wood[p] = hf.forestAt(x, z);
      }
    }

    // The city, from the same footprints the world stands up: how much is built
    // here, and how tall the tallest of it is. On a map this flat that is the
    // only terrain there is — the Loop has more vertical relief in it than the
    // whole of the ground underneath — and it doubles as the hazard map.
    const built = new Uint16Array(n * n);
    const tallest = new Float32Array(n * n);
    if (buildingData) {
      const { count, origin, wallH, roofH } = buildingData;
      for (let k = 0; k < count; k++) {
        const i = ((origin[k * 2] + half) / step) | 0;
        const j = ((origin[k * 2 + 1] + half) / step) | 0;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const p = j * n + i;
        if (built[p] < 0xffff) built[p]++;
        const top = wallH[k] + roofH[k];
        if (top > tallest[p]) tallest[p] = top;
      }
    }

    const lo = hf.minHeight;
    const hi = hf.maxHeight;
    // How much of the ramp and the hill shading this region has earned. Three
    // and a half kilometres of Oberland gets all of it; thirty-five metres of
    // Illinois gets a flat slate, because a colour ramp stretched over a river
    // bluff is a lie that looks exactly like a mountain range.
    const relief = THREE.MathUtils.clamp((hi - lo) / 900, 0, 1);
    const lut = rampLut(relief);

    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(n, n);
    const d = img.data;
    // North-west, the convention every relief map has used for two centuries:
    // read it lit from anywhere else and the valleys pop out as ridges.
    const lx = -0.55;
    const ly = 0.63;
    const lz = -0.55;

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p = j * n + i;
        const q = p * 4;
        d[q + 3] = 255;
        if (water[p]) {
          d[q] = 11;
          d[q + 1] = 28;
          d[q + 2] = 48;
          continue;
        }

        const t = THREE.MathUtils.clamp((height[p] - lo) / Math.max(1, hi - lo), 0, 1);
        const band = ((t * 255) | 0) * 3;
        let r = lut[band];
        let g = lut[band + 1];
        let b = lut[band + 2];

        // Forest, from the region's own survey where it has one: in Chicago
        // this is Lincoln Park and Jackson Park, which are how you know which
        // stretch of lakefront you are over.
        const f = wood[p] * 0.8;
        if (f > 0.01) {
          r += (32 - r) * f;
          g += (56 - g) * f;
          b += (44 - b) * f;
        }

        const dense = Math.min(1, built[p] * 0.75);
        if (dense > 0.01) {
          r += (96 - r) * dense;
          g += (94 - g) * dense;
          b += (92 - b) * dense;
          const sky = Math.min(1, tallest[p] / 170);
          if (sky > 0.01) {
            r += (188 - r) * sky;
            g += (196 - g) * sky;
            b += (208 - b) * sky;
          }
        }

        const im = i > 0 ? i - 1 : 0;
        const ip = i < n - 1 ? i + 1 : n - 1;
        const jm = j > 0 ? j - 1 : 0;
        const jp = j < n - 1 ? j + 1 : n - 1;
        const gx = (height[j * n + ip] - height[j * n + im]) / ((ip - im) * step);
        const gz = (height[jp * n + i] - height[jm * n + i]) / ((jp - jm) * step);
        // Exaggerated, or a 30-degree alpine face and a 20-degree one shade the
        // same. Scaled by relief so a flat map is not shaded by its own noise.
        const nx = -gx * 2.4;
        const nz = -gz * 2.4;
        const inv = 1 / Math.hypot(nx, 1, nz);
        const shade = (nx * lx + ly + nz * lz) * inv;
        const lum = 1 + (shade - 0.62) * (0.15 + 1.05 * relief);

        d[q] = clamp255(r * lum);
        d[q + 1] = clamp255(g * lum);
        d[q + 2] = clamp255(b * lum);
      }
    }
    ctx.putImageData(img, 0, 0);

    // The arterials and the railways, and nothing below them: at 27 metres to
    // the pixel every residential street in Chicago would collapse into one
    // grey smear, whereas the half-mile grid is legible and is what the city is
    // actually laid out on. In the Alps the same two classes draw the valley
    // floors, which is where the roads are and where you land.
    if (networkData) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(184, 202, 222, 0.17)';
      ctx.beginPath();
      for (const way of networkData) {
        if (way.kind !== 0 && way.kind !== 5) continue;
        const pts = way.pts;
        ctx.moveTo((pts[0] + half) / step, (pts[1] + half) / step);
        for (let k = 1; k < pts.length / 2; k++) {
          ctx.lineTo((pts[k * 2] + half) / step, (pts[k * 2 + 1] + half) / step);
        }
      }
      ctx.stroke();
    }
    return cv;
  }

  // -------------------------------------------------------------- draw ---
  #draw({ position, headingDeg, bestLD, objective, discovered }) {
    const cv = this.canvas;
    const size = cv.clientWidth;
    if (!size) return; // the flight HUD is not up

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const pixels = Math.round(size * dpr);
    if (cv.width !== pixels) cv.width = cv.height = pixels;

    const ctx = this.ctx;
    const s = pixels / size;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const c = size / 2;
    const r = c - 1.5;
    const mpp = this.range / r;
    const at = (x, z) => [c + (x - position.x) / mpp, c + (z - position.z) / mpp];

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.clip();

    // Beyond the baked region there is nothing to fly to, and seeing that edge
    // arrive is the only warning before the game turns you around.
    ctx.fillStyle = '#05090f';
    ctx.fillRect(0, 0, size, size);

    const span = (this.half * 2) / mpp;
    const [ox, oy] = at(-this.half, -this.half);
    ctx.drawImage(this.ground, ox, oy, span, span);
    this.#drawAir(ctx, size, s, ox, oy, span, mpp, position.y);

    // Half the window, so a glance converts pixels to kilometres.
    ctx.strokeStyle = 'rgba(190, 216, 238, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, r * 0.5, 0, TAU);
    ctx.stroke();

    this.#drawGlide(ctx, position, bestLD, mpp, r, c);
    const named = this.#drawPlaces(ctx, at, position, discovered, r, c);
    this.#drawTasks(ctx, at, r, c);
    // After the hoops. A marker is worth more than a name, but not worth the
    // first letter of one: over Kleine Scheidegg the ring lands on the K.
    if (named) this.#drawPlaceName(ctx, named, r, c);
    if (objective?.position) this.#drawObjective(ctx, at, objective.position, r, c);
    this.#drawShip(ctx, c, headingDeg);
    ctx.restore();

    // The rim, and the north mark on it. North-up: the map holds still and the
    // ship turns inside it, which is what builds a memory of the place. Which
    // way the nose is pointing is on the compass tape anyway.
    ctx.strokeStyle = 'rgba(150, 190, 220, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(226, 240, 252, 0.75)';
    ctx.beginPath();
    ctx.moveTo(c, 1);
    ctx.lineTo(c - 3.4, 6.5);
    ctx.lineTo(c + 3.4, 6.5);
    ctx.closePath();
    ctx.fill();

    ctx.font = '600 9px ui-rounded, -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(196, 214, 232, 0.62)';
    ctx.fillText(
      `${this.range % 1000 ? (this.range / 1000).toFixed(1) : this.range / 1000} km`,
      size - 1,
      size - 1
    );
  }

  /**
   * The air plan, minus the columns that have finished with you.
   *
   * The plan is baked once at a working height, so a thermal is painted the
   * same gold whether its top is two thousand metres above you or five hundred
   * below. That is the mistake the HUD arrow was rewritten to stop making: lift
   * you have already climbed out of the top of is not lift, and a map that
   * cannot tell the difference is sending you at it.
   *
   * A thermal carries its own top, so the correction is a handful of discs
   * scrubbed out of a copy of the plan rather than a re-bake — the ridge and
   * shore bands, which have no top and simply thin out, are left alone.
   */
  #drawAir(ctx, size, s, ox, oy, span, mpp, altitude) {
    const spent = this.air.thermals.filter((t) => t.top < altitude);
    if (!spent.length) {
      ctx.drawImage(this.airPlan, ox, oy, span, span);
      return;
    }
    const scratch = (this._scratch ??= document.createElement('canvas'));
    const pixels = Math.max(1, Math.round(size * s));
    if (scratch.width !== pixels) scratch.width = scratch.height = pixels;
    const sx = scratch.getContext('2d');
    sx.setTransform(s, 0, 0, s, 0, 0);
    sx.clearRect(0, 0, size, size);
    sx.drawImage(this.airPlan, ox, oy, span, span);
    // Not erased outright: the column is still there, and it still marks warm
    // ground worth coming back over lower down. It fades to a ghost.
    sx.globalCompositeOperation = 'destination-out';
    sx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    for (const t of spent) {
      sx.beginPath();
      sx.arc(ox + (t.x + this.half) / mpp, oy + (t.z + this.half) / mpp, Math.max(1.5, t.radius / mpp), 0, TAU);
      sx.fill();
    }
    sx.globalCompositeOperation = 'source-over';
    ctx.drawImage(scratch, 0, 0, size, size);
  }

  /**
   * How far this ship can still go, which is the question a moving map exists
   * to answer and the one this one did not. Two rings: the outer is the deck,
   * where the glide runs out and you land wherever you are; the inner is the
   * same glide with 150 m in hand, which is the one you actually plan to.
   *
   * Still air over the height under the ship now — not a terrain march. The
   * honest version of that would cost a thousand heightfield reads a frame on
   * a phone already drawing a hundred and forty-five thousand buildings, and a
   * ring that is 25 per cent pessimistic is the same warning at a hundredth of
   * the price.
   */
  #drawGlide(ctx, position, bestLD, mpp, r, c) {
    if (!bestLD) return;
    const above = position.y - this.hf.heightAt(position.x, position.z);
    if (above <= 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(111, 242, 168, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const height of [above, above - ARRIVAL]) {
      if (height <= 0) continue;
      const rr = (height * bestLD * GLIDE_REALISM) / mpp;
      // Off the rim it says nothing the rim does not already say, and high up
      // it is always off the rim — which is itself the answer: everything you
      // can see from here is reachable.
      if (rr < 4 || rr > r) continue;
      ctx.beginPath();
      ctx.arc(c, c, rr, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([2, 5]); // the inner ring is the quieter of the two
    }
    ctx.restore();
  }

  /**
   * Named places. A mark for every one in range, because the scatter of towns
   * along a valley is itself navigation — and a name for exactly one of them,
   * the nearest, and only when you are actually near it.
   *
   * Two names cost half the width of the map, which is most of the map. The
   * world is already writing them across the horizon in three dimensions; what
   * this has to answer is the narrower question of what that mark under the
   * wing is called.
   *
   * Nothing here is warm. Somewhere you have not been yet is a hollow mark, the
   * same distinction the floating labels make with their question mark — put in
   * gold, it would be indistinguishable from a thermal.
   *
   * @returns the place to name, for #drawPlaceName to write once the markers
   *   that would otherwise land on top of it are down.
   */
  #drawPlaces(ctx, at, from, discovered, r, c) {
    const near = [];
    for (const p of this.world.places) {
      if (p.kind === 'water') continue; // the lake is already drawn, in blue
      const [x, y] = at(p.x, p.z);
      if (Math.hypot(x - c, y - c) > r - 2) continue;
      near.push({ p, x, y, found: discovered.includes(p.name), d: Math.hypot(p.x - from.x, p.z - from.z) });
    }
    near.sort((a, b) => a.d - b.d);

    ctx.lineWidth = 1;
    for (const { p, x, y, found } of near) {
      ctx.beginPath();
      if (p.kind === 'peak') {
        ctx.moveTo(x, y - 3.2);
        ctx.lineTo(x + 2.9, y + 2.3);
        ctx.lineTo(x - 2.9, y + 2.3);
        ctx.closePath();
      } else {
        ctx.rect(x - 1.7, y - 1.7, 3.4, 3.4);
      }
      if (found) {
        ctx.fillStyle = 'rgba(232, 244, 255, 0.9)';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(232, 244, 255, 0.75)';
        ctx.stroke();
      }
    }

    const label = near[0];
    return label && label.d <= this.range * 0.65 ? label : null;
  }

  #drawPlaceName(ctx, { p, x, y, found }, r, c) {
    ctx.font = '600 7.5px ui-rounded, -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 2.5;
    // Pulled back inside the disc, or the clip eats the half of the name that
    // would have told you which town it was.
    const w = ctx.measureText(p.name).width;
    const lx = THREE.MathUtils.clamp(x, c - r + w / 2 + 2, c + r - w / 2 - 2);
    // High enough above the mark to clear the ship when you are right over it,
    // which is exactly when the name is being read.
    const ly = y - 8;
    ctx.strokeStyle = 'rgba(4, 9, 15, 0.9)';
    ctx.strokeText(p.name, lx, ly);
    ctx.fillStyle = found ? 'rgba(232, 244, 255, 0.95)' : 'rgba(232, 244, 255, 0.7)';
    ctx.fillText(p.name, lx, ly);
  }

  /**
   * The challenges, in their medal colours. One that has fallen outside the
   * window becomes a tick on the rim rather than disappearing — half of what
   * this map is for is knowing that there is something over that way.
   */
  #drawTasks(ctx, at, r, c) {
    for (const m of this.challenges.markers) {
      if (!m.mesh.visible) continue; // not unlocked; it is not standing there yet
      const medal = this.challenges.medalOf(m.def);
      const ink = MEDAL_INK[medal];
      const [x, y] = at(m.position.x, m.position.z);
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > r - 3) {
        const k = (r - 4.5) / (d || 1);
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(c + dx * k, c + dy * k, 1.8, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      // A hoop with a dark hole in it, always: filled solid, a gold marker and
      // a gold thermal are the same yellow circle, and the one you can land in
      // is not the one you can climb in. Nothing else on this map is a crisp
      // ring around a dark centre.
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, TAU);
      ctx.fillStyle = 'rgba(4, 9, 15, 0.62)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4, 9, 15, 0.75)';
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = ink;
      ctx.stroke();
      // The pip is the medal. No pip is a task standing there unflown, which is
      // the same thing an unlit hoop says out of the window.
      if (medal) {
        ctx.beginPath();
        ctx.arc(x, y, 1.7, 0, TAU);
        ctx.fillStyle = ink;
        ctx.fill();
      }
    }
  }

  /**
   * Whatever the HUD arrow is pointing at, which is usually the nearest lift
   * this ship can reach. Drawn as a reticle rather than a ring: an unflown
   * challenge is a cyan ring here because it is a cyan hoop out there, and two
   * cyan rings meaning different things is one too many.
   */
  #drawObjective(ctx, at, target, r, c) {
    const [x, y] = at(target.x, target.z);
    const dx = x - c;
    const dy = y - c;
    const d = Math.hypot(dx, dy);
    ctx.strokeStyle = '#61d2ff';
    ctx.lineWidth = 1.4;
    if (d > r - 6) {
      const k = (r - 7) / (d || 1);
      ctx.save();
      ctx.translate(c + dx * k, c + dy * k);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath();
      ctx.moveTo(-3, -3.4);
      ctx.lineTo(3, 0);
      ctx.lineTo(-3, 3.4);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      ctx.moveTo(x + cs * 3.5, y + sn * 3.5);
      ctx.lineTo(x + cs * 7.5, y + sn * 7.5);
    }
    ctx.stroke();
  }

  #drawShip(ctx, c, headingDeg) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(THREE.MathUtils.degToRad(headingDeg));
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(4.6, 5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.6, 5);
    ctx.closePath();
    ctx.fillStyle = '#eef5fc';
    ctx.strokeStyle = 'rgba(4, 9, 15, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
}

/** Ground with no story to tell in its elevation. */
const SLATE = [46, 54, 60];

/** 256 entries of the hypsometric ramp, faded toward slate on a flat region. */
function rampLut(relief) {
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = RAMP.length - 1;
    while (k > 0 && RAMP[k][0] > t) k--;
    const a = RAMP[k];
    const b = RAMP[Math.min(RAMP.length - 1, k + 1)];
    const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    for (let ch = 0; ch < 3; ch++) {
      const ramped = a[ch + 1] + (b[ch + 1] - a[ch + 1]) * f;
      lut[i * 3 + ch] = SLATE[ch] + (ramped - SLATE[ch]) * relief;
    }
  }
  return lut;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
