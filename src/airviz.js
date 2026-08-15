import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { mulberry32 } from './flight.js';

/**
 * Making the air visible.
 *
 * The air model already knows everything worth knowing — where it rises, where
 * it falls, which way it is running — and almost none of that used to reach the
 * player. This layer is the eyes for it, and it has exactly one rule: every
 * mark on the screen is placed by a real Air.sample at the point it is drawn.
 * Nothing here models the air a second time, approximates it, or remembers what
 * it used to be. Draw lift where there is none and the player learns to ignore
 * the sky, which is worse than drawing nothing at all.
 *
 * Two cues, from the same sampler:
 *
 *   motes    Specks of dust and vapour in the near field, moved by the wind
 *            vector at their own position. They stream downwind, rise in a
 *            thermal and fall in sink, because that is literally what the air
 *            at that point is doing to them. How solid one looks is how hard
 *            the air is working; its colour is which way.
 *
 *   columns  A coarse grid swept a few cells per tick, probing several heights
 *            above the ground. Cells where the air is genuinely going up get a
 *            standing shaft of haze from the lowest to the highest probe that
 *            qualified. On the Alps that draws the windward ridge bands low and
 *            the thermal cores tall; over Chicago it draws the lake-breeze
 *            convergence as a line along the shore, and nothing whatsoever over
 *            the water.
 *
 * AirField is the data and carries no renderer; AirViz is the mesh around it.
 * That split is what lets tools/air-test.mjs put the field under a microscope
 * in node and check it against the physics, sample for sample.
 */

/** Net rising air worth marking, m/s. Comfortably clear of the background sink. */
export const LIFT_MIN = 0.8;
/** Heights above ground the scan asks about. Low enough to catch a ridge band. */
const PROBE_AGL = [70, 230, 500, 880];
/** Field ticks per second. The air changes slowly; sampling it faster is waste. */
const TICK = 1 / 30;

export class AirField {
  constructor(air, heightfield, { motes = 170, columns = 30, moteRadius = 280, scanCells = 22 } = {}) {
    this.air = air;
    this.hf = heightfield;
    this.moteRadius = moteRadius;
    this.maxColumns = columns;
    this.n = scanCells;
    this.scanRadius = Math.min(4200, heightfield.halfSize * 0.42);
    this.step = (this.scanRadius * 2) / (this.n - 1);
    // A full sweep every second and a bit: fast enough that a column appears
    // while you can still glide to it, slow enough to disappear in the budget.
    this.cellsPerTick = Math.max(4, Math.ceil((this.n * this.n) / 40));
    // The lid on the mote field. Cloudbase is the natural one, but on a map
    // with 4,000 m summits cloudbase is underground for a third of the terrain,
    // and a mote seeded below the rock it stands on is culled and re-scattered
    // every single tick.
    this.ceiling = Math.max((air.opt?.cloudBase ?? 3000) + 220, heightfield.maxHeight + 450);

    this.cells = [];
    for (let i = 0; i < this.n * this.n; i++) {
      // `t` is the air's clock at the moment this cell was read. Nothing in the
      // renderer needs it; it is what lets a test re-run the exact sample the
      // cell claims to be, instead of a different one taken later.
      this.cells.push({ x: 0, z: 0, w: -9, probeY: 0, baseY: 0, topY: 0, t: 0, ready: false });
    }
    this.columns = [];

    this.motes = [];
    for (let i = 0; i < motes; i++) {
      this.motes.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        w: 0,
        size: 5,
        life: 0,
        ttl: 0,
        t: 0,
        ready: false,
      });
    }

    /** Wind just above the ground under the player — what the trees and the water read. */
    this.surfaceWind = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.origin = new THREE.Vector2();
    this.rng = mulberry32(0x41725a);
    this._cursor = 0;
    this._acc = 0;
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.#anchor();
  }

  /**
   * Sweep the whole grid and scatter every mote at once, for the moments when
   * the player is somewhere else entirely: a launch, a respawn, a re-seeded
   * sky. Without it the first seconds of a flight are flown over a grid that
   * still describes where the last one ended.
   */
  prime(focus) {
    this.focus.copy(focus);
    this.#anchor();
    for (let i = 0; i < this.cells.length; i++) this.#scanCell(i);
    this.#rebuildColumns();
    this._cursor = 0;
    for (const m of this.motes) {
      this.#seedMote(m);
      this.air.sample(m.pos, m.vel);
      m.w = m.vel.y;
      m.t = this.air.time;
    }
  }

  /**
   * @returns {boolean} whether anything moved, so the renderer can skip the
   *   buffer upload on the frames between ticks.
   */
  update(dt, focus) {
    this.focus.copy(focus);
    this._acc += dt;
    if (this._acc < TICK) return false;
    // A long frame is a dropped frame, not a reason to run the field four times
    // over: the air is allowed to skip ahead with the clock.
    let steps = 0;
    while (this._acc >= TICK && steps < 3) {
      this._acc -= TICK;
      steps++;
    }
    if (this._acc >= TICK) this._acc = 0;
    this.#tick(TICK * steps);
    return true;
  }

  #tick(dt) {
    this.#advect(dt);
    this.#scanSlice();
    const ground = this.hf.heightAt(this.focus.x, this.focus.z);
    this.air.sample(this._p.set(this.focus.x, ground + 25, this.focus.z), this.surfaceWind);
  }

  // -------------------------------------------------------------- motes ---
  /**
   * Move every mote by the wind where it currently is, then re-read the air at
   * the place it arrived. Sampling after the move rather than before is what
   * makes `mote.w` a statement about `mote.pos` — the thing the shader colours
   * it by — instead of about where it used to be.
   */
  #advect(dt) {
    for (const m of this.motes) {
      m.life += dt;
      if (m.ready) m.pos.addScaledVector(m.vel, dt);
      if (!m.ready || m.life > m.ttl || this.#strayed(m)) this.#seedMote(m);
      this.air.sample(m.pos, m.vel);
      m.w = m.vel.y;
      m.t = this.air.time;
    }
  }

  /** The lid, never below the ship: fly over it and the air must not empty out. */
  #lid() {
    return Math.max(this.ceiling, this.focus.y + 300);
  }

  #strayed(m) {
    const dx = m.pos.x - this.focus.x;
    const dz = m.pos.z - this.focus.z;
    if (dx * dx + dz * dz > this.moteRadius * this.moteRadius) return true;
    if (m.pos.y > this.#lid()) return true;
    return m.pos.y < this.hf.heightAt(m.pos.x, m.pos.z) + 6;
  }

  #seedMote(m) {
    const r = this.rng;
    const a = r() * Math.PI * 2;
    // sqrt keeps the disc evenly covered instead of crowding the centre
    const rad = Math.sqrt(r()) * this.moteRadius;
    const x = this.focus.x + Math.cos(a) * rad;
    const z = this.focus.z + Math.sin(a) * rad;
    const ground = this.hf.heightAt(x, z);
    const y = Math.min(Math.max(this.focus.y + (r() - 0.5) * 520, ground + 25), this.#lid() - 20);
    m.pos.set(x, y, z);
    m.size = 2.0 + r() * 3.4;
    m.ttl = 7 + r() * 10;
    m.life = 0;
    m.ready = true;
  }

  // --------------------------------------------------------------- scan ---
  /** Snap the grid to a world lattice so cells do not crawl as the player moves. */
  #anchor() {
    const s = this.step;
    this.origin.set(
      Math.round((this.focus.x - this.scanRadius) / s) * s,
      Math.round((this.focus.z - this.scanRadius) / s) * s
    );
  }

  #scanSlice() {
    for (let k = 0; k < this.cellsPerTick; k++) {
      if (this._cursor >= this.cells.length) {
        // Columns change only on a whole sweep, and the grid only re-anchors
        // between sweeps: half a pass at one origin and half at another is a
        // set of cells that never existed together.
        this.#rebuildColumns();
        this._cursor = 0;
        this.#anchor();
      }
      this.#scanCell(this._cursor++);
    }
  }

  #scanCell(i) {
    const cell = this.cells[i];
    const x = this.origin.x + (i % this.n) * this.step;
    const z = this.origin.y + Math.floor(i / this.n) * this.step;
    const ground = this.hf.heightAt(x, z);
    cell.x = x;
    cell.z = z;
    cell.w = -9;
    cell.baseY = 0;
    cell.topY = 0;
    cell.probeY = ground + PROBE_AGL[0];
    cell.t = this.air.time;
    // Probed relative to the ground and never clipped to cloudbase: a windward
    // face at 3,500 m is above the cumulus and still working, and a cell left
    // unprobed would carry a number no sample ever produced.
    for (const agl of PROBE_AGL) {
      const y = ground + agl;
      const w = this.air.sample(this._p.set(x, y, z), this._v).y;
      if (w > cell.w) {
        cell.w = w;
        cell.probeY = y;
      }
      if (w >= LIFT_MIN) {
        if (!cell.baseY) cell.baseY = y;
        cell.topY = y;
      }
    }
    cell.ready = true;
  }

  #rebuildColumns() {
    const found = [];
    for (const c of this.cells) {
      if (!c.ready || c.w < LIFT_MIN || !c.baseY) continue;
      found.push(c);
    }
    // Strongest first, so a crowded sky keeps the columns worth flying to.
    found.sort((a, b) => b.w - a.w);
    this.columns.length = 0;
    for (const c of found.slice(0, this.maxColumns)) {
      this.columns.push({ x: c.x, z: c.z, w: c.w, probeY: c.probeY, baseY: c.baseY, topY: c.topY, t: c.t });
    }
  }

  // ------------------------------------------------------------ hunting ---
  /**
   * The nearest lift this ship can actually use, or null.
   *
   * "Nearest thermal" is not the same question. A column you would arrive under
   * the base of, one whose top is below you, one across the lake you cannot
   * reach with the height you have — each is nearer than the answer and none of
   * them is the answer. So every candidate is asked the only honest version of
   * the question: fly there, arrive at the height this glide leaves you at, and
   * sample the air *there*. If it will not out-climb the ship's own sink, it is
   * not lift, whatever the map says is underneath it.
   *
   * @param {number} sink  the ship's still-air sink rate, m/s
   * @param {number} glide the glide ratio to plan the run at
   */
  bestLift(pos, { sink = 0.8, glide = 24 } = {}) {
    let best = null;
    const consider = (x, z) => {
      const dist = Math.hypot(x - pos.x, z - pos.z);
      if (best && dist >= best.distance) return;
      const floor = this.hf.heightAt(x, z) + 90;
      const arrive = pos.y - dist / glide;
      if (arrive < floor) return;
      const w = this.air.sample(this._p.set(x, arrive, z), this._v).y;
      if (w <= sink) return;
      best = { x, y: arrive, z, w, distance: dist };
    };
    for (const t of this.air.thermals) consider(t.x, t.z);
    for (const c of this.columns) consider(c.x, c.z);
    return best;
  }
}

/**
 * The mesh: one instanced draw for both cues, because they differ only in how
 * the quad is oriented and shaded, and Chicago has no draw calls to spare.
 */
export class AirViz {
  constructor(air, heightfield, sky, options = {}) {
    this.field = new AirField(air, heightfield, options);
    const far = this.field.scanRadius;

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...sky.uniforms,
        uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
        uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
        uTime: { value: 0 },
        uFar: { value: far },
        uNear: { value: this.field.moteRadius },
      },
      vertexShader: /* glsl */ `
        in vec3 aPos;      // mote centre, or the foot of a column
        in vec3 aDir;      // mote: the wind on it. column: (0, height, 0)
        in vec3 aParams;   // x = size, y = vertical air speed, z = kind
        uniform float uFar;
        uniform float uNear;
        out vec2 vUv;
        out float vW;
        out float vKind;
        out float vFade;
        out vec3 vWorld;
        void main(){
          vUv = uv;
          vW = aParams.y;
          vKind = aParams.z;
          vec3 c = aPos;
          vec3 toEye = cameraPosition - c;
          float dist = length(toEye);
          toEye /= max(dist, 1e-3);
          vec3 world;
          if (aParams.z < 0.5) {
            // A mote is drawn as the streak it would leave: stretched along the
            // wind that is carrying it, so a glance reads direction and speed.
            float v = length(aDir);
            vec3 dir = v > 0.05 ? aDir / v : vec3(0.0, 1.0, 0.0);
            vec3 right = cross(dir, toEye);
            float rl = length(right);
            right = rl > 1e-3 ? right / rl : vec3(1.0, 0.0, 0.0);
            float len = aParams.x * (1.0 + clamp(v * 0.7, 0.0, 5.0));
            world = c + right * position.x * aParams.x + dir * position.y * len;
            // Out at the rim of the disc they fade rather than vanish; at the
            // lens they fade too, or one drifts past close enough to read as a
            // scratch on the canopy instead of a speck in the air.
            vFade = (1.0 - smoothstep(uNear * 0.55, uNear, dist)) * smoothstep(8.0, 34.0, dist);
          } else {
            vec3 right = cross(vec3(0.0, 1.0, 0.0), toEye);
            float rl = length(right);
            right = rl > 1e-3 ? right / rl : vec3(1.0, 0.0, 0.0);
            world = c + right * position.x * aParams.x + vec3(0.0, (position.y * 0.5 + 0.5) * aDir.y, 0.0);
            // Thin out the one you are flying through: from inside, a shaft of
            // haze is a grey screen rather than a mark on the map.
            vFade = (1.0 - smoothstep(uFar * 0.62, uFar * 1.15, dist)) * smoothstep(120.0, 540.0, dist);
          }
          vWorld = world;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${NOISE}
        ${SKY}
        ${OUTPUT}
        uniform vec3 uSunRadiance;
        uniform vec3 uSkyAmbient;
        uniform float uTime;
        in vec2 vUv;
        in float vW;
        in float vKind;
        in float vFade;
        in vec3 vWorld;
        out vec4 fragColor;
        void main(){
          if (vFade <= 0.001) discard;
          float a;
          bool mote = vKind < 0.5;
          if (mote) {
            vec2 d = vUv * 2.0 - 1.0;
            a = clamp(1.0 - dot(d, d), 0.0, 1.0);
            a = a * a * 0.85;
          } else {
            float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
            across *= across;
            a = across * smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
            // Most of a column quad is its own empty corners, and a phone
            // should not pay for noise it is about to multiply by nothing.
            if (a < 0.02) discard;
            // The grain crawls upward, which is the direction the air in here is
            // going: a still column would read as a post rather than a draught.
            a *= (0.45 + 0.55 * fbm(vec2(vUv.x * 3.0, vUv.y * 4.0 - uTime * 0.22), 2)) * 0.62;
          }
          // Colour is which way the air is going, alpha is how hard.
          float rise = clamp(vW / 2.6, -1.0, 1.0);
          a *= vFade * (0.30 + 0.70 * abs(rise));
          if (a < 0.004) discard;

          vec3 v = vWorld - cameraPosition;
          float dist = length(v);
          vec3 vdir = v / dist;
          vec3 col;
          if (mote) {
            // Specks of stuff in the air, lit like the stuff they are. Pale on
            // purpose: a dark speck at arm's length reads as dirt on the lens.
            vec3 tint = mix(vec3(0.60, 0.68, 0.80), vec3(1.0, 0.88, 0.66), rise * 0.5 + 0.5);
            col = tint * (uSunRadiance * 0.18 + uSkyAmbient * 0.42);
          } else {
            // A column is deliberately darker than the sky it stands against.
            // Dust lit to the same value as the haze behind it is invisible,
            // and this has to be readable from a couple of kilometres out.
            vec3 tint = mix(vec3(0.34, 0.42, 0.55), vec3(1.0, 0.78, 0.44), rise * 0.5 + 0.5);
            col = tint * (uSunRadiance * 0.055 + uSkyAmbient * 0.22);
            col += uSunRadiance * pow(clamp(dot(vdir, uSunDir), 0.0, 1.0), 8.0) * 0.16;
          }
          // Only a third of the haze the distance is worth. These are marks on
          // the map as much as they are objects in it, and at full aerial a
          // column two kilometres out is exactly the colour of the sky behind
          // it — which is to say, gone.
          col = aerial(col, dist * 0.35, vdir, vWorld.y, uSunDir);
          fragColor = outputColor(col, a);
        }
      `,
    });

    const max = this.field.motes.length + this.field.maxColumns;
    const geom = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    geom.setAttribute('position', quad.getAttribute('position'));
    geom.setAttribute('uv', quad.getAttribute('uv'));
    geom.setIndex(quad.getIndex());
    this.posData = new Float32Array(max * 3);
    this.dirData = new Float32Array(max * 3);
    this.parData = new Float32Array(max * 3);
    this.posAttr = new THREE.InstancedBufferAttribute(this.posData, 3).setUsage(THREE.DynamicDrawUsage);
    this.dirAttr = new THREE.InstancedBufferAttribute(this.dirData, 3).setUsage(THREE.DynamicDrawUsage);
    this.parAttr = new THREE.InstancedBufferAttribute(this.parData, 3).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aPos', this.posAttr);
    geom.setAttribute('aDir', this.dirAttr);
    geom.setAttribute('aParams', this.parAttr);
    geom.instanceCount = 0;
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.frustumCulled = false;
    // Behind the cumulus, in front of the terrain and the water.
    this.mesh.renderOrder = 29;
  }

  prime(focus) {
    this.field.prime(focus);
    this.#write();
  }

  update(dt, focus) {
    this.material.uniforms.uTime.value += dt;
    if (this.field.update(dt, focus)) this.#write();
  }

  #write() {
    let n = 0;
    for (const m of this.field.motes) {
      if (!m.ready) continue;
      this.posData[n * 3] = m.pos.x;
      this.posData[n * 3 + 1] = m.pos.y;
      this.posData[n * 3 + 2] = m.pos.z;
      this.dirData[n * 3] = m.vel.x;
      this.dirData[n * 3 + 1] = m.vel.y;
      this.dirData[n * 3 + 2] = m.vel.z;
      this.parData[n * 3] = m.size;
      this.parData[n * 3 + 1] = m.w;
      this.parData[n * 3 + 2] = 0;
      n++;
    }
    for (const c of this.field.columns) {
      // Foot and head are the lowest and highest probes that came back with
      // lift. Where only one did, the shaft is drawn shorter than the gap to
      // the probe above it, so it never claims ground the scan did not test.
      const height = Math.max(c.topY - c.baseY, 80);
      this.posData[n * 3] = c.x;
      this.posData[n * 3 + 1] = c.baseY;
      this.posData[n * 3 + 2] = c.z;
      this.dirData[n * 3] = 0;
      this.dirData[n * 3 + 1] = height;
      this.dirData[n * 3 + 2] = 0;
      this.parData[n * 3] = this.field.step * 0.42;
      this.parData[n * 3 + 1] = c.w;
      this.parData[n * 3 + 2] = 1;
      n++;
    }
    this.posAttr.needsUpdate = true;
    this.dirAttr.needsUpdate = true;
    this.parAttr.needsUpdate = true;
    this.mesh.geometry.instanceCount = n;
  }

  setLighting(sunRadiance, skyAmbient) {
    this.material.uniforms.uSunRadiance.value.copy(sunRadiance);
    this.material.uniforms.uSkyAmbient.value.copy(skyAmbient);
  }
}
