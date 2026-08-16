import * as THREE from '../vendor/three.module.js';
import { OUTPUT } from './shaders/lib.js';

/**
 * The guns.
 *
 * Two wing-mounted barrels, and rounds that are real objects rather than a
 * raycast. That is the whole design decision and everything else follows from
 * it: a round leaves the wing at six hundred metres a second WITH the
 * aeroplane's own velocity already in it, it falls on the way, and it takes
 * half a second to reach anything worth shooting at.
 *
 * A hitscan gun would be simpler and would make the game worse. Half of
 * gunnery is that where the nose points is not where the rounds go — the
 * aeroplane is sliding sideways through its own turn, and the sight has to
 * know that. With travel time the player can see the stream curve away and
 * correct; without it there is nothing to learn.
 *
 * Rounds are drawn as one LineSegments with a dynamic buffer: two vertices
 * each, one draw call for the lot, and a line IS what a tracer looks like.
 * There is no lighting on them — a tracer is a lit thing, not a lit-upon one.
 */

/** Hard ceiling on rounds in the air. At 14/s and 2.5 s of life, 40 is plenty. */
const MAX_ROUNDS = 96;
/** How long a round lives, seconds. Beyond this it has missed. */
const LIFE = 2.4;
const G = 9.80665;
/** Where the two barrels are harmonised to cross, in metres. */
const CONVERGE = 250;

export class Guns {
  constructor(scene, sky, spec) {
    this.spec = spec;
    this.n = 0;
    // Flat arrays rather than objects: this is swept every frame against every
    // target and the allocation would be the expensive part of it.
    this.x = new Float32Array(MAX_ROUNDS);
    this.y = new Float32Array(MAX_ROUNDS);
    this.z = new Float32Array(MAX_ROUNDS);
    this.vx = new Float32Array(MAX_ROUNDS);
    this.vy = new Float32Array(MAX_ROUNDS);
    this.vz = new Float32Array(MAX_ROUNDS);
    this.age = new Float32Array(MAX_ROUNDS);

    this.rounds = spec.gun?.rounds ?? 0;
    this._since = 0;
    this._barrel = 0;

    this.positions = new Float32Array(MAX_ROUNDS * 6);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: { ...sky.uniforms },
      vertexShader: /* glsl */ `
        out float vTip;
        void main(){
          // The second vertex of each pair is the leading end; brighten it.
          vTip = float(gl_VertexID % 2);
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uExposure;
        ${OUTPUT}
        in float vTip;
        out vec4 fragColour;
        void main(){
          // Hot at the head and cooling down the trail, which is what burning
          // phosphor does and what makes a stream of them readable as a stream.
          vec3 hot = vec3(9.0, 5.2, 1.6);
          vec3 cool = vec3(2.4, 0.7, 0.15);
          fragColour = outputColor(mix(cool, hot, vTip), 0.35 + 0.55 * vTip);
        }
      `,
    });
    this.mesh = new THREE.LineSegments(geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    scene.add(this.mesh);

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._aim = new THREE.Vector3();
  }

  setAircraft(spec) {
    this.spec = spec;
    this.n = 0;
    this.rounds = spec.gun?.rounds ?? 0;
  }

  /** A full magazine. Called on every takeoff and every retry. */
  reload() {
    this.rounds = this.spec.gun?.rounds ?? 0;
    this.n = 0;
  }

  get armed() {
    return !!this.spec.gun;
  }

  /**
   * Hold the trigger. Rate-limited here rather than by the caller, so the gun
   * fires at its own cadence whatever the frame rate is doing.
   * @returns {number} how many rounds went off this step, for the noise.
   */
  trigger(dt, glider, down) {
    const gun = this.spec.gun;
    if (!gun) return 0;
    const interval = 1 / gun.rate;
    this._since += dt;
    // Ready the instant the trigger comes down, but never MORE than ready: an
    // unclamped counter banks a round for every frame the trigger is up, and
    // the first squeeze after a few seconds off pays it all out at once.
    // Measured, that was thirty-five rounds in the first second of an
    // eighteen-a-second gun.
    if (!down || this.rounds <= 0) {
      if (this._since > interval) this._since = interval;
      return 0;
    }
    let fired = 0;
    while (this._since >= interval && this.rounds > 0 && fired < 4) {
      this._since -= interval;
      this.#round(glider, gun);
      this.rounds--;
      fired++;
    }
    return fired;
  }

  #round(glider, gun) {
    const i = this.n < MAX_ROUNDS ? this.n++ : (this._oldest = (this._oldest ?? 0) + 1) % MAX_ROUNDS;
    const fwd = glider.forward(this._fwd);
    const right = glider.right(this._right);
    const up = glider.up(this._up);
    // Alternate barrels, harmonised to cross at CONVERGE. A pair of streams
    // that meet is how you know the range without being told it.
    this._barrel = 1 - this._barrel;
    const side = (this._barrel ? 1 : -1) * (gun.mount ?? 1.6);
    this._muzzle
      .copy(glider.position)
      .addScaledVector(right, side)
      .addScaledVector(fwd, gun.nose ?? 1.2)
      .addScaledVector(up, gun.drop ?? -0.05);
    // Point it at the convergence point rather than straight ahead.
    this._aim.copy(fwd).multiplyScalar(CONVERGE).addScaledVector(right, -side).normalize();
    // Dispersion, so a held trigger is a cone rather than a laser.
    const s = gun.spread ?? 0.003;
    this._aim
      .addScaledVector(right, (Math.random() * 2 - 1) * s)
      .addScaledVector(up, (Math.random() * 2 - 1) * s)
      .normalize();

    this.x[i] = this._muzzle.x;
    this.y[i] = this._muzzle.y;
    this.z[i] = this._muzzle.z;
    // The aeroplane's own velocity goes with it. This is the whole reason a
    // gunsight is not a dot in the middle of the screen.
    this.vx[i] = glider.velocity.x + this._aim.x * gun.muzzle;
    this.vy[i] = glider.velocity.y + this._aim.y * gun.muzzle;
    this.vz[i] = glider.velocity.z + this._aim.z * gun.muzzle;
    this.age[i] = 0;
  }

  /**
   * Advance every round and see what it went through.
   *
   * @param {object[]} targets things with `position`, `radius` and `alive`
   * @param {object} hf the heightfield, so a round that misses buries itself
   * @returns {object[]} the targets hit this step
   */
  update(dt, targets, hf) {
    const hits = [];
    let v = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= LIFE) continue;
      const px = this.x[i];
      const py = this.y[i];
      const pz = this.z[i];
      this.vy[i] -= G * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      this.age[i] += dt;

      // Into the ground, or out of the sky.
      if (hf && this.y[i] < hf.heightAt(this.x[i], this.z[i])) {
        this.age[i] = LIFE;
        continue;
      }
      for (const t of targets) {
        if (!t.alive) continue;
        if (!segmentHitsSphere(px, py, pz, this.x[i], this.y[i], this.z[i], t.position, t.radius)) continue;
        hits.push(t);
        this.age[i] = LIFE;
        break;
      }
      if (this.age[i] >= LIFE) continue;

      // The drawn streak is the last slice of flight, not the whole round.
      const tail = this.spec.gun?.tracer ?? 24;
      const speed = Math.hypot(this.vx[i], this.vy[i], this.vz[i]) || 1;
      const k = tail / speed;
      this.positions[v++] = this.x[i] - this.vx[i] * k;
      this.positions[v++] = this.y[i] - this.vy[i] * k;
      this.positions[v++] = this.z[i] - this.vz[i] * k;
      this.positions[v++] = this.x[i];
      this.positions[v++] = this.y[i];
      this.positions[v++] = this.z[i];
    }
    // Compact the pool once everything has expired, so `n` cannot creep up to
    // the cap and start overwriting live rounds while most of them are dead.
    if (v === 0) this.n = 0;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, v / 3);
    return hits;
  }

  /**
   * Where the rounds will actually be after CONVERGE metres of flight, in
   * world space — which is the only honest thing to draw a gunsight on. It is
   * not where the nose points: the aeroplane's velocity is in every round, so
   * in a turn the pipper sits well off the nose, and that is the lesson.
   */
  aimPoint(glider, out = new THREE.Vector3()) {
    const gun = this.spec.gun;
    if (!gun) return out.copy(glider.position);
    const fwd = glider.forward(this._fwd);
    const vx = glider.velocity.x + fwd.x * gun.muzzle;
    const vy = glider.velocity.y + fwd.y * gun.muzzle;
    const vz = glider.velocity.z + fwd.z * gun.muzzle;
    const t = CONVERGE / Math.max(Math.hypot(vx, vy, vz), 1);
    return out.set(
      glider.position.x + vx * t,
      glider.position.y + vy * t - 0.5 * G * t * t,
      glider.position.z + vz * t
    );
  }

  clear() {
    this.n = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  setLighting() {}

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Does the swept segment a→b pass within `r` of `c`? */
function segmentHitsSphere(ax, ay, az, bx, by, bz, c, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - c.x;
  const ey = ay + dy * t - c.y;
  const ez = az + dz * t - c.z;
  return ex * ex + ey * ey + ez * ez <= r * r;
}
