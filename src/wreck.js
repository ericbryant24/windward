import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { mulberry32 } from './flight.js';

/**
 * What happens after you hit something.
 *
 * The ship keeps its momentum through the impact instead of stopping dead in
 * the air: it bounces, scrapes, tumbles and slides to a halt, throwing up
 * whatever the surface is made of. Severity comes out of the closing speed
 * measured against the ship's own redline, so clipping a wingtip and arriving
 * flat out are different events on every aircraft in the roster.
 *
 * The wreck flies the glider's own position, velocity and attitude — nothing
 * downstream has to know the difference, so the camera, the HUD and the
 * respawn path all keep working unchanged.
 */

const G = 9.80665;
const MAX_PARTICLES = 320;
/** Longest a single particle can live, and so how long a burst hangs about. */
const MAX_LIFE = 3.4;

const SURFACES = {
  terrain: { dust: [0.44, 0.39, 0.3], chip: [0.26, 0.23, 0.18], bounce: 0.24, friction: 0.42 },
  structure: { dust: [0.56, 0.56, 0.57], chip: [0.32, 0.32, 0.34], bounce: 0.2, friction: 0.5 },
  water: { dust: [0.82, 0.88, 0.94], chip: [0.9, 0.94, 0.97], bounce: 0.12, friction: 0.9 },
};

export class Wreck {
  constructor(scene, sky, hf, buildings = null) {
    this.hf = hf;
    this.buildings = buildings;
    this.head = 0;
    this.clock = 0;
    this.phase = 'idle';
    this.severity = 0;
    this.rawSeverity = 0;
    this.jolt = 0;
    this.t = 0;
    this.hold = 0;
    this.cause = 'terrain';
    this.restY = -Infinity;
    this.spin = new THREE.Vector3();
    this.rng = mulberry32(0x7c3a);

    this._n = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._hit = {};
    this._aliveUntil = -1;
    this._scrapeAt = -1;

    this.mesh = buildParticles(sky);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get active() {
    return this.phase !== 'idle';
  }

  /** Camera shake, 0..1, decaying from the last bang rather than the first. */
  get shake() {
    return this.active || this.jolt > 0.01 ? this.jolt : 0;
  }

  /**
   * @param {object} glider the ship, whose state this takes over
   * @param {{cause:string, normal:THREE.Vector3, point:THREE.Vector3}} impact
   * @returns {number} severity, uncapped — the physics and the shake use the
   *   0..1 clamp, but the score and the wording want the worst arrivals in the
   *   game to still outrank the merely bad ones.
   */
  begin(glider, { cause, normal, point }) {
    const v = glider.velocity;
    const n = this._n.copy(normal).normalize();
    const vn = v.dot(n);
    const closing = Math.max(0, -vn);
    const tangential = Math.sqrt(Math.max(0, v.lengthSq() - vn * vn));
    // Measured against the ship's own never-exceed speed rather than its trim
    // speed: arriving at 40 is a bad day in the trainer and an ordinary
    // approach speed in the open-class ship, but the redline is where the
    // scale has to top out or the whole upper half of the envelope reads the
    // same. A fixed reference is blended in so absolute violence still counts
    // for something — 44 m/s in the Draco outranks 22 in the Kite.
    const hit = closing + tangential * 0.26;
    const x = hit / (glider.spec.vne * 0.7 + 62 * 0.3);
    // Part speed, part energy. Pure speed flattens the top of the range; pure
    // energy turns every shallow arrival into a non-event.
    const raw = x * (0.55 + 0.45 * x);
    this.rawSeverity = raw;
    this.severity = THREE.MathUtils.clamp(raw, 0.08, 1);
    this.cause = cause;
    this.surface = SURFACES[cause] ?? SURFACES.terrain;
    this.phase = 'tumble';
    this.t = 0;
    this.jolt = this.severity;
    this.hold = 0;
    this._scrapeAt = -1;
    this.rng = mulberry32((Math.abs(point.x * 131 + point.z * 17) | 0) + 1);

    glider.position.copy(point).addScaledVector(n, 0.9);
    this.#absorb(v, n, this.severity);
    // What the airframe folding up takes out of it, over and above the surface.
    v.multiplyScalar(1 - 0.2 * this.severity);
    this.#spinUp(glider, n, closing + tangential * 0.5);
    this.#splash(point, n, this.severity, glider.spec);
    return raw;
  }

  /** Runs in place of the flight model. Returns true when the wreck is done. */
  update(dt, glider) {
    this.t += dt;
    this.jolt = Math.max(0, this.jolt - this.jolt * 3.0 * dt);

    if (this.phase === 'rest') {
      this.hold -= dt;
      // Still creeping to a stop under the camera rather than frozen mid-slide,
      // and still falling if the five-second guard caught it in the air.
      const k = Math.exp(-3.5 * dt);
      glider.velocity.x *= k;
      glider.velocity.z *= k;
      glider.velocity.y -= G * dt;
      glider.position.addScaledVector(glider.velocity, dt);
      this.#settleOnGround(glider);
      this.#driveInstruments(glider, dt);
      return this.hold <= 0;
    }

    const v = glider.velocity;
    this._prev.copy(glider.position);
    v.y -= G * dt;
    // A tumbling airframe is nothing but drag.
    v.multiplyScalar(Math.exp(-0.35 * dt));
    glider.position.addScaledVector(v, dt);

    let roof = 0;
    const hitWall = this.buildings?.hitSegment(this._prev, glider.position, this._hit);
    if (hitWall) {
      // Coming down onto a roof is a landing, not a wall strike, and the edge
      // normal hitSegment hands back would fling the wreck out sideways.
      const onRoof = this._prev.y > hitWall.top - 0.4;
      glider.position.set(hitWall.x, onRoof ? hitWall.top + 0.9 : hitWall.y, hitWall.z);
      this.#contact(glider, onRoof ? this._n.set(0, 1, 0) : this._n.set(hitWall.nx, 0, hitWall.nz).normalize(),
        SURFACES.structure, 0.5, dt);
      if (onRoof) roof = hitWall.top + 0.9;
    }

    const ground = this.hf.heightAt(glider.position.x, glider.position.z);
    const grounded = !roof && glider.position.y < ground + 0.9;
    if (grounded) {
      glider.position.y = ground + 0.9;
      const water = this.hf.isWater(glider.position.x, glider.position.z);
      this.#contact(glider, this.hf.normalAt(glider.position.x, glider.position.z, 24, this._n),
        water ? SURFACES.water : SURFACES.terrain, 0.9, dt);
    }
    const onGround = grounded || roof > 0;
    // Ploughing: a folded-up airframe digging in takes far more out of a slide
    // than sliding friction alone, and a wreck that keeps going for five
    // seconds stops being a crash and starts being a wait.
    if (onGround) v.multiplyScalar(Math.exp(-1.6 * dt));

    // tumble
    const rate = this.spin.length();
    if (rate > 1e-3) {
      this._q.setFromAxisAngle(this._v.copy(this.spin).divideScalar(rate), rate * dt);
      glider.quaternion.premultiply(this._q).normalize();
    }
    this.spin.multiplyScalar(Math.exp(-(onGround ? 2.4 : 0.5) * dt));

    this.#driveInstruments(glider, dt);

    const flat = Math.hypot(v.x, v.z);
    // The guard is short on purpose: a wreck that skids for five seconds stops
    // being a crash and starts being a wait.
    if ((onGround && flat < 4 && Math.abs(v.y) < 3) || this.t > 3.2) {
      this.phase = 'rest';
      this.restY = onGround ? glider.position.y : -Infinity;
      // The beat before the game says anything. A big one earns a longer look.
      this.hold = 0.45 + 0.75 * this.severity;
    }
    return false;
  }

  /** Particles outlive the wreck, so this runs every frame whatever the state. */
  tick(dt) {
    this.clock += dt;
    this.mesh.material.uniforms.uTime.value = this.clock;
    if (this.clock > this._aliveUntil) this.mesh.visible = false;
    if (!this.active) this.jolt = Math.max(0, this.jolt - this.jolt * 3.0 * dt);
  }

  /** Abandon a crash in progress — restart, retry, or back to the menu. */
  end() {
    this.phase = 'idle';
    this.severity = 0;
    this.rawSeverity = 0;
    this.jolt = 0;
    this.spin.set(0, 0, 0);
    this.mesh.visible = false;
    this._aliveUntil = -1;
  }

  // ------------------------------------------------------------ physics ---
  /**
   * Reflect and scrub.
   *
   * Friction is Coulomb rather than a flat percentage, which is what makes a
   * shallow arrival skid half a field while a vertical one stops where it hit:
   * the surface can only take away as much sideways speed as it was pressed
   * with. A percentage per step would instead stop everything dead in three
   * hundredths of a second, because contact is re-tested every step.
   */
  #absorb(v, n, severity, surface = this.surface, dt = 0) {
    const vn = v.dot(n);
    this._tan.copy(v).addScaledVector(n, -vn);
    const across = this._tan.length();
    if (vn < 0) {
      const impulse = -(1 + surface.bounce * (1 - 0.7 * severity)) * vn;
      v.addScaledVector(n, impulse);
      if (across > 1e-4) v.addScaledVector(this._tan, -Math.min(across, surface.friction * impulse) / across);
    } else if (dt > 0 && across > 1e-4) {
      // Resting on it: weight on the surface, scrubbing off with time.
      v.addScaledVector(this._tan, -Math.min(across, surface.friction * G * dt) / across);
    }
  }

  #spinUp(glider, n, energy) {
    const r = this.rng;
    this.spin
      .crossVectors(n, glider.velocity)
      .normalize()
      .multiplyScalar((0.9 + 6.5 * this.severity) * (0.75 + r() * 0.5));
    // A pure cartwheel looks staged; give it some roll about its own axis too.
    this.spin.addScaledVector(glider.forward(this._v), (r() - 0.5) * (1.5 + energy * 0.16));
  }

  /** A bounce, a scrape, or the wreck hitting a wall on the way down. */
  #contact(glider, n, surface, minSpeed, dt) {
    const v = glider.velocity;
    const closing = Math.max(0, -v.dot(n));
    const bump = THREE.MathUtils.clamp(closing / (glider.spec.trimSpeed * 0.6), 0.05, 1);
    this.#absorb(v, n, this.severity, surface, dt);
    if (this._tan.lengthSq() > 1e-6) {
      this.spin.addScaledVector(this._tan.normalize(), (this.rng() - 0.5) * 4 * bump);
    }
    // A long scrape along a slope is one contact per step; only the first of
    // them, and only a real bang, is worth a cloud of its own.
    if (closing < minSpeed || this.clock - this._scrapeAt < 0.18) return;
    this._scrapeAt = this.clock;
    this.jolt = Math.max(this.jolt, bump * this.severity);
    this.#splash(glider.position, n, bump * (0.35 + 0.5 * this.severity), glider.spec, surface);
  }

  #settleOnGround(glider) {
    const floor = Math.max(this.restY, this.hf.heightAt(glider.position.x, glider.position.z) + 0.9);
    if (glider.position.y < floor) {
      glider.position.y = floor;
      glider.velocity.y = Math.max(0, glider.velocity.y);
    }
  }

  /** Keep the instruments telling the truth about the wreck, not the flight. */
  #driveInstruments(glider, dt) {
    glider.airspeed = glider.velocity.length();
    glider.vario = glider.velocity.y;
    glider.varioSmooth = THREE.MathUtils.damp(glider.varioSmooth, glider.velocity.y, 4, dt);
    glider.stalled = false;
    glider.loadFactor = 0;
  }

  // ---------------------------------------------------------- particles ---
  /**
   * One burst: what the surface throws up, plus pieces of the aeroplane in the
   * aeroplane's own colour.
   */
  #splash(point, n, strength, spec, surface = this.surface) {
    const r = this.rng;
    const wet = surface === SURFACES.water;
    const puffs = Math.round((wet ? 18 : 22) + 78 * strength);
    const chips = Math.round(6 + 26 * strength);
    const push = 3 + 15 * strength;

    for (let i = 0; i < puffs; i++) {
      // A cone off the surface, widened by how hard the hit was.
      const dir = this._v
        .copy(n)
        .multiplyScalar(0.35 + r() * 0.75)
        .add(randomUnit(r, this._tan).multiplyScalar(0.85));
      this.#spawn(
        point,
        dir.normalize().multiplyScalar(push * (0.35 + r())),
        wet ? surface.chip : surface.dust,
        0.45 + r() * (wet ? 0.5 : 1.0) * (0.5 + strength),
        1.0 + r() * (wet ? 0.7 : 1.6) + strength * 0.8,
        wet ? 1 : 0
      );
    }
    for (let i = 0; i < chips; i++) {
      const dir = randomUnit(r, this._v).addScaledVector(n, 0.8).normalize();
      // Half the debris is the surface, half is the ship coming apart.
      const tint = i % 2 ? surface.chip : spec.look.body;
      this.#spawn(point, dir.multiplyScalar(push * (0.6 + r() * 1.4)), tint, 0.12 + r() * 0.3, 1.1 + r() * 1.4, 2);
    }
    this.mesh.visible = true;
    this._aliveUntil = this.clock + MAX_LIFE;
  }

  #spawn(at, vel, tint, size, life, kind) {
    const a = this.mesh.geometry.attributes;
    const i = this.head % MAX_PARTICLES;
    this.head++;
    a.aOrigin.setXYZ(i, at.x, at.y, at.z);
    a.aVel.setXYZ(i, vel.x, vel.y, vel.z);
    a.aTint.setXYZ(i, tint[0], tint[1], tint[2]);
    a.aParams.setXYZW(i, size, Math.min(life, MAX_LIFE), this.clock, kind);
    a.aOrigin.needsUpdate = true;
    a.aVel.needsUpdate = true;
    a.aTint.needsUpdate = true;
    a.aParams.needsUpdate = true;
  }

  setLighting(sunRadiance, skyAmbient) {
    this.mesh.material.uniforms.uSunRadiance.value.copy(sunRadiance);
    this.mesh.material.uniforms.uSkyAmbient.value.copy(skyAmbient);
  }
}

/** A unit vector with no preferred direction, from the burst's own stream. */
function randomUnit(rng, out) {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(Math.cos(a) * s, z, Math.sin(a) * s);
}

/**
 * Camera-facing quads, positioned entirely on the GPU: a burst writes each
 * particle's launch state once and the shader integrates it from there, so a
 * crash costs one buffer update rather than three hundred per frame.
 */
function buildParticles(sky) {
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...sky.uniforms,
      uTime: { value: 0 },
      uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
    },
    vertexShader: /* glsl */ `
      in vec3 aOrigin;
      in vec3 aVel;
      in vec3 aTint;
      in vec4 aParams;   // size, life, birth, kind (0 dust, 1 spray, 2 debris)
      uniform float uTime;
      out vec2 vUv;
      out vec3 vWorld;
      out vec3 vTint;
      out float vFade;
      out float vKind;
      void main(){
        float age = uTime - aParams.z;
        float life = aParams.y;
        if (age < 0.0 || age > life) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // behind the far plane
          return;
        }
        float t = age / life;
        float k = aParams.w;
        float solid = step(0.5, k);
        vUv = uv;
        vTint = aTint;
        vKind = k;

        // Launch, then drag: dust stops almost at once, a chip keeps going.
        float drag = mix(2.6, 0.55, solid);
        vec3 p = aOrigin + aVel * (1.0 - exp(-drag * age)) / drag;
        // Dust is hot and rises; everything with mass in it falls.
        p.y += mix(1.4 * age * (1.0 - 0.45 * t), -4.9 * age * age, solid);

        float size = aParams.x * mix(0.45 + 1.5 * t, 1.0, solid);
        vec3 toEye = normalize(cameraPosition - p);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toEye));
        vec3 up = cross(toEye, right);
        float spin = step(1.5, k) * age * 7.0;
        vec2 q = vec2(
          position.x * cos(spin) - position.y * sin(spin),
          position.x * sin(spin) + position.y * cos(spin)
        );
        vWorld = p + (right * q.x + up * q.y) * size;

        float in_ = clamp(t / 0.05, 0.0, 1.0);
        float out_ = mix(pow(1.0 - t, 1.7), smoothstep(1.0, 0.72, t), step(1.5, k));
        vFade = in_ * out_;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      in vec2 vUv;
      in vec3 vWorld;
      in vec3 vTint;
      in float vFade;
      in float vKind;
      out vec4 fragColor;
      void main(){
        vec2 q = abs(vUv * 2.0 - 1.0);
        float a;
        if (vKind > 1.5) {
          a = 1.0 - step(0.92, max(q.x, q.y) * 0.55 + (q.x + q.y) * 0.45);   // a chip
        } else {
          a = smoothstep(1.0, 0.15, length(vUv * 2.0 - 1.0));
          a *= 0.68 + 0.32 * hash12(floor(vUv * 6.0) + vTint.xy * 37.0);     // ragged edge
        }
        // Dust reads as a cloud only if it layers; a wall of it reads as paint.
        a *= vFade * mix(0.42, 1.0, step(1.5, vKind));
        if (a < 0.012) discard;

        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        vec3 col = vTint * (uSunRadiance * 0.45 + uSkyAmbient * 0.5);
        // sun coming through the cloud of it
        col += uSunRadiance * vTint * pow(clamp(dot(vdir, uSunDir), 0.0, 1.0), 8.0) * 0.3;
        col = aerial(col, dist, vdir, vWorld.y, uSunDir);
        fragColor = outputColor(col, a);
      }
    `,
  });

  const geom = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(2, 2);
  geom.setAttribute('position', quad.getAttribute('position'));
  geom.setAttribute('uv', quad.getAttribute('uv'));
  geom.setIndex(quad.getIndex());
  const params = new Float32Array(MAX_PARTICLES * 4);
  for (let i = 0; i < MAX_PARTICLES; i++) params[i * 4 + 2] = -1e6; // born long ago, already dead
  geom.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  geom.setAttribute('aVel', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  geom.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  geom.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  geom.instanceCount = MAX_PARTICLES;

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false; // the shader decides where these end up, not the CPU
  mesh.renderOrder = 3;
  return mesh;
}
