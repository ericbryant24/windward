import * as THREE from '../vendor/three.module.js';

/**
 * Air mass and glider dynamics.
 *
 * The air is the actual game: thermals over sun-facing slopes, ridge lift on
 * windward faces, sink everywhere else. Altitude is the only fuel there is, so
 * the interesting decisions are all about where to spend and where to earn it.
 */

const G = 9.80665;
const RHO0 = 1.225;
/** How far the water has to keep going before it sinks you like a lake. */
const OPEN_WATER = 260;

/** Alpine defaults; a region overrides what differs. */
const AIR_DEFAULTS = {
  cloudBase: 2950,
  thermalCount: 46,
  groundMin: 570,
  groundMax: 2750,
  radius: [250, 490],
  strength: [2.6, 4.4],
  ridgeLift: true,
  waterSink: 0,
  shoreLift: null,
  wind: { x: 0.55, z: 0.84, speed: 6.5 },
};

export class Air {
  constructor(heightfield, sky, options = {}) {
    this.hf = heightfield;
    this.sky = sky;
    this.opt = { ...AIR_DEFAULTS, ...options };
    this.windDir = new THREE.Vector2(this.opt.wind.x, this.opt.wind.z).normalize(); // blowing toward
    this.windSpeed = this.opt.wind.speed;
    this.thermals = [];
    this.time = 0;
    this._n = new THREE.Vector3();
  }

  static density(altitude) {
    return RHO0 * Math.exp(-altitude / 8420);
  }

  /**
   * Scatter thermals where they would really form: sun-facing slopes, rock and
   * meadow rather than snow or water, spread out enough to be worth hunting.
   */
  seedThermals(count = this.opt.thermalCount, rng = mulberry32(0x51ce)) {
    const hf = this.hf;
    const o = this.opt;
    const sun = this.sky.sunDir;
    const margin = Math.min(2200, hf.halfSize * 0.16);
    const spacing = Math.min(1900, hf.halfSize * 0.13);
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 220) {
      const x = (rng() * 2 - 1) * (hf.halfSize - margin);
      const z = (rng() * 2 - 1) * (hf.halfSize - margin);
      const h = hf.heightAt(x, z);
      if (h > o.groundMax || h < o.groundMin || hf.isWater(x, z)) continue;
      // On a slope, the sun-facing side cooks first. On the flat there is no
      // aspect to prefer, so every site is as good as the next and what
      // matters is only that they are spread out.
      let facing = 1;
      if (o.ridgeLift) {
        const n = hf.normalAt(x, z, 120, this._n);
        facing = n.x * sun.x + n.z * sun.z + n.y * sun.y * 0.35;
        if (facing < 0.12) continue;
      }
      if (out.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < spacing ** 2)) continue;
      const strength = o.strength[0] + facing * (o.strength[1] - o.strength[0]) + rng() * 1.8;
      out.push({
        x,
        z,
        ground: h,
        radius: o.radius[0] + rng() * (o.radius[1] - o.radius[0]),
        strength,
        top: Math.min(o.cloudBase + rng() * 350, h + 1500 + strength * 260),
        phase: rng() * 100,
      });
    }
    this.thermals = out;
    return out;
  }

  /** Nearest thermal to a point, for HUD hints. */
  nearestThermal(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const t of this.thermals) {
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best ? { thermal: best, distance: Math.sqrt(bestD) } : null;
  }

  /** Wind vector (m/s, world space) including terrain-driven vertical air. */
  sample(pos, out = new THREE.Vector3()) {
    const hf = this.hf;
    const ground = hf.heightAt(pos.x, pos.z);
    const agl = pos.y - ground;

    // horizontal wind strengthens with altitude
    const gradient = 0.55 + 0.45 * Math.min(1, (pos.y - 500) / 2600);
    out.set(this.windDir.x * this.windSpeed * gradient, 0, this.windDir.y * this.windSpeed * gradient);

    // ---- ridge lift: air forced up a windward slope ----------------------
    if (this.opt.ridgeLift) {
      const n = hf.normalAt(pos.x, pos.z, 90, this._n);
      const into = -(n.x * this.windDir.x + n.z * this.windDir.y);
      if (into > 0 && agl < 900) {
        const steep = Math.min(1, Math.hypot(n.x, n.z) / 0.72);
        const decay = Math.exp(-Math.max(agl, 0) / 320);
        out.y += this.windSpeed * into * steep * 1.35 * decay;
      }
    }

    // ---- the lake breeze front ------------------------------------------
    // Cool air coming off the water meets warm air rising over the city, and
    // the convergence line sits a few hundred metres inland. On a map with no
    // hills this is the only lift you can count on finding twice.
    const shore = this.opt.shoreLift;
    const overWater = hf.isWater(pos.x, pos.z);
    if (shore && !overWater && agl < shore.ceiling) {
      let nearWater = false;
      for (let k = 0; k < 8 && !nearWater; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (hf.isWater(pos.x + Math.cos(a) * shore.radius, pos.z + Math.sin(a) * shore.radius)) nearWater = true;
      }
      if (nearWater) out.y += shore.strength * (1 - agl / shore.ceiling);
    }
    // Nothing rises over cold water — but that is the lake's doing, and a
    // river eighty metres wide between two rows of towers is not the lake.
    if (overWater && this.opt.waterSink && this.#openWater(pos.x, pos.z)) out.y -= this.opt.waterSink;

    // ---- thermals --------------------------------------------------------
    let lift = 0;
    for (const t of this.thermals) {
      const dx = pos.x - t.x;
      const dz = pos.z - t.z;
      const r2 = dx * dx + dz * dz;
      const R = t.radius;
      if (r2 > (R * 2.6) ** 2) continue;
      // A broad plateau rather than a sharp Gaussian: a thermal you can only
      // use by flying through its exact centre is a thermal nobody can use.
      const core = smoothstep(1.4, 0.45, Math.sqrt(r2) / R);
      // thermals lean downwind and pinch out at the top
      const above = pos.y - t.ground;
      if (above < -20) continue;
      const cap = 1 - smoothstep(t.top - 320, t.top, pos.y);
      const ramp = smoothstep(0, 180, above);
      const breathe = 0.82 + 0.18 * Math.sin(this.time * 0.35 + t.phase);
      lift += t.strength * core * cap * ramp * breathe;
      // gentle sink in the collar around a working thermal
      const collar = Math.exp(-((Math.sqrt(r2) - R * 1.9) ** 2) / (R * R * 0.55));
      lift -= t.strength * 0.16 * collar * cap;
    }
    out.y += lift;

    // background sink and a little texture in the air
    out.y -= 0.42;
    const t = this.time;
    out.y += 0.35 * Math.sin(pos.x * 0.0021 + t * 0.7) * Math.sin(pos.z * 0.0018 - t * 0.5);
    return out;
  }

  /**
   * Still water in every direction, which is what tells a lake from a river or
   * a harbour slip. Wider than the widest reach of the Chicago River at Wolf
   * Point, narrow enough that the lake keeps its teeth to within a wingspan or
   * two of the shore.
   */
  #openWater(x, z) {
    const r = OPEN_WATER;
    const hf = this.hf;
    return hf.isWater(x + r, z) && hf.isWater(x - r, z) && hf.isWater(x, z + r) && hf.isWater(x, z - r);
  }

  update(dt) {
    this.time += dt;
  }
}

/** Configuration of the ship the player flies. */
export const GLIDER = {
  mass: 330, // kg, ballasted two-seater with pilot
  wingArea: 12.4, // m^2
  aspectRatio: 19.5,
  cd0: 0.0112,
  oswald: 0.9,
  clSlope: 5.1, // per radian
  alphaStallDeg: 14.5,
  alphaMaxDeg: 17.5,
  alphaMinDeg: -7,
  trimAlphaDeg: 4.6,
  trimSpeed: 33, // m/s the ship settles at hands-off
  speedStability: 0.34, // extra degrees of alpha per m/s above trim
  maxRollRate: 2.2, // rad/s
  maxBankDeg: 72, // full stick deflection
  brakeDragFactor: 7.0,
  brakeLiftLoss: 0.28,
  boostThrust: 1750, // N — a motorglider's get-out-of-jail card
  boostBurn: 1 / 7, // full tank lasts 7 s
  boostRecharge: 1 / 26,
  vne: 74, // m/s
};

export class Glider {
  constructor(air) {
    this.air = air;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.airVelocity = new THREE.Vector3();
    this.wind = new THREE.Vector3();

    this.alpha = 0;
    this.beta = 0;
    this.airspeed = 0;
    this.loadFactor = 1;
    this.stalled = false;
    this.boost = 1;
    this.boosting = false;
    this.brake = 0;
    this.vario = 0;
    this.varioSmooth = 0;
    this.gForce = 1;

    this._f = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._prevY = 0;
  }

  /** Place the glider heading in a compass direction, trimmed and flying. */
  reset(position, headingDeg = 0, speed = 32) {
    this.position.copy(position);
    // Yaw about +Y runs anticlockwise seen from above; compass bearings run
    // clockwise. Without the sign the ship ends up on the reciprocal.
    const yaw = THREE.MathUtils.degToRad(-headingDeg);
    this.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.forward(this._f);
    this.velocity.copy(this._f).multiplyScalar(speed);
    this.boost = 1;
    this.brake = 0;
    this.stalled = false;
    this.vario = 0;
    this.varioSmooth = 0;
    this._prevY = position.y;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  up(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  right(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  get headingDeg() {
    const f = this.forward(this._tmp);
    return (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
  }

  /** Positive to the right, in radians. */
  get bankRad() {
    const up = this.up(this._up);
    const right = this.right(this._right);
    return -Math.atan2(right.y, up.y);
  }

  get bankDeg() {
    return THREE.MathUtils.radToDeg(this.bankRad);
  }

  /**
   * @param {{roll:number, pitch:number, brake:number, boost:boolean}} input
   */
  update(dt, input) {
    const cfg = GLIDER;

    this.air.sample(this.position, this.wind);
    this.airVelocity.copy(this.velocity).sub(this.wind);
    const V = this.airVelocity.length();
    this.airspeed = V;

    // ---- body frame ------------------------------------------------------
    const inv = this._q.copy(this.quaternion).invert();
    const vb = this._tmp.copy(this.airVelocity).applyQuaternion(inv);
    const alpha = V > 0.5 ? Math.atan2(-vb.y, Math.max(-vb.z, 0.5)) : 0;
    const beta = V > 0.5 ? Math.asin(THREE.MathUtils.clamp(vb.x / V, -1, 1)) : 0;
    this.alpha = alpha;
    this.beta = beta;

    // ---- controls: roll is a rate, pitch commands angle of attack --------
    // Commanding alpha rather than pitch rate is what makes this flyable with
    // one thumb: the stick asks for an attitude relative to the air, and the
    // ship sorts out the rest.
    // The stick asks for a bank angle rather than a roll rate. On a phone that
    // is the difference between carving a turn around a ridge and ending up
    // inverted in a valley wondering which way is up.
    const speedAuthority = THREE.MathUtils.clamp((V - 8) / 26, 0.12, 1);
    const bankTarget = input.roll * THREE.MathUtils.degToRad(cfg.maxBankDeg);
    const rollRate =
      THREE.MathUtils.clamp((bankTarget - this.bankRad) * 2.3, -cfg.maxRollRate, cfg.maxRollRate) *
      speedAuthority;
    this.#rotate(this._f.set(0, 0, -1), rollRate * dt);

    // Trim holds a speed, not an attitude: fly faster than trim and the wing
    // asks for a little more alpha, which is what damps the phugoid instead of
    // leaving the player porpoising across the valley.
    const speedTrim = THREE.MathUtils.clamp((V - cfg.trimSpeed) * cfg.speedStability, -3.5, 5.0);
    const span = input.pitch > 0 ? cfg.alphaMaxDeg - cfg.trimAlphaDeg : cfg.trimAlphaDeg - cfg.alphaMinDeg;
    const alphaTarget = THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp(cfg.trimAlphaDeg + speedTrim + input.pitch * span, cfg.alphaMinDeg, cfg.alphaMaxDeg)
    );
    const pitchRate = THREE.MathUtils.clamp((alphaTarget - alpha) * 3.4, -1.6, 1.6) * speedAuthority;
    this.#rotate(this._f.set(1, 0, 0), pitchRate * dt);

    // yaw weathervane: kill sideslip so turns coordinate themselves
    const yawRate = THREE.MathUtils.clamp(-beta * 2.6, -1.2, 1.2) * speedAuthority;
    this.#rotate(this._f.set(0, 1, 0), yawRate * dt);

    // ---- aerodynamics ----------------------------------------------------
    this.brake = THREE.MathUtils.damp(this.brake, input.brake, 8, dt);
    const rho = Air.density(this.position.y);
    const q = 0.5 * rho * V * V * cfg.wingArea;

    const stallA = THREE.MathUtils.degToRad(cfg.alphaStallDeg);
    let cl = cfg.clSlope * alpha;
    if (alpha > stallA) {
      // past the break lift falls away rather than cliff-edging to zero
      const over = (alpha - stallA) / THREE.MathUtils.degToRad(10);
      cl = cfg.clSlope * stallA * Math.max(0.42, 1 - 0.72 * over * over);
    } else if (alpha < -stallA) {
      cl = -cfg.clSlope * stallA;
    }
    cl *= 1 - cfg.brakeLiftLoss * this.brake;
    this.stalled = alpha > stallA * 0.97 && V < 45;

    const k = 1 / (Math.PI * cfg.aspectRatio * cfg.oswald);
    const cd = cfg.cd0 * (1 + cfg.brakeDragFactor * this.brake) + k * cl * cl + 0.09 * beta * beta;

    const lift = q * cl;
    const drag = q * cd;

    const force = this._f.set(0, 0, 0);
    if (V > 0.4) {
      // lift is perpendicular to the airflow, in the wing's plane
      const dragDir = this._tmp.copy(this.airVelocity).multiplyScalar(-1 / V);
      const rightB = this.right(this._right);
      // perpendicular to the relative wind and to the span: drag x right
      const liftDir = new THREE.Vector3().crossVectors(dragDir, rightB).normalize();
      force.addScaledVector(liftDir, lift);
      force.addScaledVector(dragDir, drag);
      // side force resisting sideslip
      force.addScaledVector(rightB, -q * 1.7 * beta);
      this.loadFactor = lift / (cfg.mass * G);
    }

    // ---- boost -----------------------------------------------------------
    this.boosting = !!input.boost && this.boost > 0.02;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - cfg.boostBurn * dt);
      force.addScaledVector(this.forward(this._up), cfg.boostThrust);
    } else {
      this.boost = Math.min(1, this.boost + cfg.boostRecharge * dt);
    }

    force.y -= cfg.mass * G;

    this.velocity.addScaledVector(force, dt / cfg.mass);

    // never exceed never-exceed by much: model the airframe's drag rise
    const spd = this.velocity.length();
    if (spd > cfg.vne) this.velocity.multiplyScalar(THREE.MathUtils.damp(1, cfg.vne / spd, 6, dt));

    this.position.addScaledVector(this.velocity, dt);

    this.vario = (this.position.y - this._prevY) / Math.max(dt, 1e-4);
    this._prevY = this.position.y;
    this.varioSmooth = THREE.MathUtils.damp(this.varioSmooth, this.vario, 3.2, dt);
    this.gForce = THREE.MathUtils.damp(this.gForce, this.loadFactor, 8, dt);
  }

  #rotate(axisLocal, angle) {
    if (!angle) return;
    this._q.setFromAxisAngle(axisLocal, angle);
    this.quaternion.multiply(this._q).normalize();
  }
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
