import * as THREE from '../vendor/three.module.js';
import { getAircraft, DEFAULT_AIRCRAFT } from './fleet.js';

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

/**
 * Where the airframe starts to talk back, as a fraction of Vne. Real gliders
 * are placarded well below the demonstrated flutter speed, so there is a band
 * below the redline where the ship is buzzing and heavy but not yet dying.
 */
const FLUTTER_ONSET = 0.86;
/** Fraction of the airframe used up per second at twice Vne, undamaged. */
const OVERSPEED_DAMAGE = 0.26;
/**
 * What is left once the wing folds: a fuselage, some stubs, and no lift at all.
 * As a drag coefficient and the fraction of the planform still making drag —
 * small, because a wingless airframe does not float down, it goes in. The Vela
 * arrives at about 85 m/s, which is both what really happens and short enough
 * that a break-up is a fall rather than a wait.
 */
const BREAK_CD = 0.85;
const BREAK_AREA = 0.07;

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
    // A breakwater is not a heat island. The water mask calls the stone walls
    // out in Lake Michigan dry ground — they are — and a candidate can land on
    // one, which puts a 5 m/s climb three kilometres offshore on a map whose
    // whole premise is that the lake will kill you. Filtering here rather than
    // inside the loop leaves every other site exactly where it was.
    this.thermals = out.filter((t) => this.#hasGround(t.x, t.z));
    return this.thermals;
  }

  /**
   * Is there warm ground around this point, or only a wall in the water? Sun on
   * a hundred-metre strip of rock does not make a column; sun on a city block
   * does. Sites either have most of the compass dry or almost none of it, so
   * the threshold has room on both sides of every real one.
   */
  #hasGround(x, z) {
    let land = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (!this.hf.isWater(x + Math.cos(a) * 260, z + Math.sin(a) * 260)) land++;
    }
    return land >= 3;
  }

  /**
   * Nearest thermal to a point, by plan distance alone. Deliberately not what
   * the HUD points at any more — nearest is not the same as reachable, or as
   * still working at the height you would arrive. See AirField.bestLift.
   */
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

/** The ship flown when nobody has chosen one. See fleet.js for the roster. */
export const GLIDER = getAircraft(DEFAULT_AIRCRAFT);

export class Glider {
  constructor(air, spec = GLIDER) {
    this.air = air;
    this.spec = spec;
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
    this.netto = 0;
    this.nettoSmooth = 0;
    this.gForce = 1;

    /** 0 below the flutter onset, 1 at Vne, and it keeps climbing past. */
    this.buffet = 0;
    /** How much of the airframe has been used up. Does not come back. */
    this.damage = 0;
    /** The wing has gone. From here it is a falling shape, not an aeroplane. */
    this.broken = false;
    this.spin = new THREE.Vector3();
    this._flutter = 0;

    this._f = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._prevY = 0;
  }

  /**
   * Swap the airframe. Everything the model knows about the ship lives in the
   * spec, so there is nothing else to reset but the state that describes how
   * this particular one is flying right now.
   */
  setAircraft(spec) {
    this.spec = spec;
    this.boost = 1;
    this.brake = 0;
    this.stalled = false;
    this.#mend();
  }

  /** A fresh airframe. Only ever a new flight, never a reward mid-flight. */
  #mend() {
    this.buffet = 0;
    this.damage = 0;
    this.broken = false;
    this.spin.set(0, 0, 0);
  }

  /**
   * What the ship most wants to tell the pilot, worst first. Overspeed outranks
   * the stall because you have less time to do something about it.
   */
  get warning() {
    if (this.broken) return 'AIRFRAME FAILED';
    if (this.damage > 0.6) return 'AIRFRAME';
    if (this.airspeed > this.spec.vne) return 'OVERSPEED';
    if (this.buffet > 0.12) return 'VNE';
    return this.stalled ? 'STALL' : '';
  }

  /** Place the glider heading in a compass direction, trimmed and flying. */
  reset(position, headingDeg = 0, speed = this.spec.trimSpeed) {
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
    this.netto = 0;
    this.nettoSmooth = 0;
    this._prevY = position.y;
    this.#mend();
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
    const cfg = this.spec;
    if (this.broken) return this.#fall(dt);

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

    // ---- the top of the envelope -----------------------------------------
    // Nothing here holds the ship back. Point one of these at the ground and
    // it accelerates until parasite drag balances its weight, which for the
    // Vela is 195 m/s against a 74 m/s redline — the dive is the fastest way
    // to spend height there is, and the bill arrives as flutter.
    //
    // A structure already working loose lets go earlier, so the onset walks
    // down as damage accumulates and a second dive is nothing like the first.
    const onset = cfg.vne * (FLUTTER_ONSET - 0.16 * this.damage);
    this.buffet = Math.max(0, (V - onset) / (cfg.vne - onset));
    if (this.buffet > 0) {
      // Two close frequencies beating against each other, so it reads as the
      // airframe ringing rather than as a vibration. Integrated sinusoids stay
      // bounded and average to nothing, which is what keeps this a buzz you
      // fly through rather than a hand on the stick: about two degrees of roll
      // at the redline and four at the worst of it. Any more and the shake
      // flies the aeroplane out of the dive for you, which is not the deal.
      this._flutter += dt;
      const a = Math.min(this.buffet, 2);
      this.#rotate(this._f.set(1, 0, 0), Math.sin(this._flutter * 37) * 0.65 * a * dt);
      this.#rotate(this._f.set(0, 0, -1), Math.sin(this._flutter * 29.3 + 1.3) * a * dt);
    }

    // ---- controls: the stick moves surfaces, the airframe does the rest ---
    // The stick commands rates, not attitudes. An earlier version asked for a
    // bank ANGLE, clamped to maxBankDeg, which flew beautifully with one thumb
    // and was a lie in two ways: you could not roll past the clamp however
    // long you held it, and banking without pulling produced almost no turn
    // because nothing ever loaded the wing.
    //
    // What makes a rate command flyable on a phone is not an autopilot, it is
    // that a glider is genuinely stable. Left alone it rolls back towards level
    // and returns to its trim speed. Those two effects are modelled below, so
    // hands off still flies straight while a held stick rolls all the way round.
    //
    // Authority comes from dynamic pressure, so it is read against the ship's
    // own trim speed: 30 m/s is a wallowing trainer and a brisk open-class ship.
    const speedAuthority = THREE.MathUtils.clamp((V - cfg.trimSpeed * 0.24) / (cfg.trimSpeed * 0.79), 0.12, 1);

    // Control authority does not keep rising with dynamic pressure. Past the
    // flutter onset the surfaces are up against their hinge moments and the
    // stick goes solid, which is what makes waiting expensive in a dive: the
    // longer it runs, the wider the pull-out and the more sky it needs. It is
    // deliberately not enough to make recovery impossible — the ship is still
    // flyable at terminal velocity, just heavy and unwilling.
    const stiff = 1 / (1 + 1.9 * Math.max(0, V / cfg.vne - FLUTTER_ONSET) ** 2);

    // Ailerons. No clamp on bank: hold full stick and the ship keeps rolling.
    let rollRate = input.roll * cfg.maxRollRate * speedAuthority * stiff;

    // Dihedral and the spiral mode. A glider banked and left alone slips, and
    // the slip rolls it back upright. Modelling the whole chain would fight the
    // yaw damper below, which kills the slip before it can act, so the roll-back
    // is applied directly: about five seconds from forty-five degrees to level,
    // which is what the real thing does. It fades out as the stick goes over so
    // it never argues with a deliberate roll.
    const held = Math.abs(input.roll);
    if (held < 0.98) {
      // -sin(bank) already takes the short way round: past ninety degrees it
      // keeps pushing the same way, so an abandoned roll finishes rather than
      // reversing. Inverted is a knife-edge the first disturbance breaks, which
      // is what a cambered wing does anyway.
      rollRate += -Math.sin(this.bankRad) * cfg.rollStability * (1 - held) * speedAuthority;
    }
    this.#rotate(this._f.set(0, 0, -1), rollRate * dt);

    // Elevator. Also a rate, which is what lets the ship go over the top of a
    // loop instead of levelling out at whatever angle of attack was asked for.
    const elevator = input.pitch * cfg.maxPitchRate * speedAuthority * stiff;

    // Static longitudinal stability, in two parts.
    //
    // The wing wants its trim angle of attack whichever way up the ship is, and
    // that term is never switched off — it is what recovers an abandoned roll.
    // Left inverted with the stick centred the wing sits at a large negative
    // alpha, pushes hard, and the nose drops into a split-S, which is exactly
    // what a cambered wing does and why a glider cannot loiter upside down.
    // Killing this term when inverted made inverted a stable attitude to fly
    // hands-off, which is the opposite of the truth.
    //
    // The speed term — fly faster than trim and the nose rises — damps the
    // phugoid, but its sign only makes sense the right way up, so that half
    // fades out as the ship rolls over. Both relax under a deliberate pull so
    // they cannot flatten a manoeuvre.
    const speedError = THREE.MathUtils.clamp((V - cfg.trimSpeed) / cfg.trimSpeed, -0.6, 1.2);
    const alphaError = THREE.MathUtils.degToRad(cfg.trimAlphaDeg) - alpha;
    const upright = THREE.MathUtils.clamp(this.up(this._up).y, 0, 1);
    const stability =
      (alphaError * 2.6 + speedError * cfg.speedStability * 0.9 * upright) * (1 - 0.7 * Math.abs(input.pitch));

    const pitchRate = THREE.MathUtils.clamp(elevator + stability * speedAuthority, -2.4, 2.4);
    this.#rotate(this._f.set(1, 0, 0), pitchRate * dt);

    // yaw weathervane: kill sideslip so turns coordinate themselves. It backs
    // off while rolling hard, where a fin fighting the manoeuvre is exactly
    // what stops a roll going round.
    const yawDamp = 2.6 * (1 - 0.55 * Math.min(1, Math.abs(rollRate) / cfg.maxRollRate));
    const yawRate = THREE.MathUtils.clamp(-beta * yawDamp, -1.2, 1.2) * speedAuthority;
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
    this.stalled = alpha > stallA * 0.97 && V < cfg.trimSpeed * 1.36;

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
    this.position.addScaledVector(this.velocity, dt);

    // Past the redline the airframe is being taken apart rather than merely
    // flown fast, and what is already loose gives way faster — so the last
    // tenth goes several times quicker than the first. Nothing repairs it: a
    // dive is spent airframe, and the only way to stop spending is to slow
    // down, which is what the airbrakes are for.
    const over = V / cfg.vne - 1;
    if (over > 0) {
      this.damage = Math.min(1, this.damage + OVERSPEED_DAMAGE * over ** 1.6 * (1 + 2 * this.damage) * dt);
      if (this.damage >= 1) this.#breakUp();
    }

    this.#instruments(dt);
  }

  /**
   * The wing lets go.
   *
   * Nothing else in the game has to know: what is left keeps the glider's own
   * position, velocity and attitude, so the ground and the buildings collide
   * with it exactly as before and hand it to the wreck. A break-up at three
   * thousand feet is a long fall, which is the honest outcome and by some
   * distance the most expensive arrival in the game.
   */
  #breakUp() {
    this.broken = true;
    this.stalled = false;
    this.buffet = 0;
    this.loadFactor = 0;
    this.spin.crossVectors(this.up(this._up), this.airVelocity);
    // A pure vertical climb leaves those two parallel and the cross degenerate.
    if (this.spin.lengthSq() < 1e-6) this.spin.copy(this.right(this._right));
    this.spin.normalize().multiplyScalar(2.2 + 4.5 * (this.airspeed / this.spec.vne));
    this.spin.addScaledVector(this.forward(this._tmp), 1.8);
  }

  /**
   * Ballistic and tumbling: gravity, a little drag, and no wing. It arrives far
   * quicker than the ship ever landed, and much too quick for the touchdown
   * test in game.js to mistake it for one.
   */
  #fall(dt) {
    const cfg = this.spec;
    this.air.sample(this.position, this.wind);
    this.airVelocity.copy(this.velocity).sub(this.wind);
    const V = this.airVelocity.length();
    this.airspeed = V;
    this.alpha = 0;
    this.beta = 0;
    this.loadFactor = 0;

    if (V > 0.4) {
      const drag = 0.5 * Air.density(this.position.y) * V * V * cfg.wingArea * BREAK_AREA * BREAK_CD;
      this.velocity.addScaledVector(this.airVelocity, -(drag * dt) / (cfg.mass * V));
    }
    this.velocity.y -= G * dt;
    this.position.addScaledVector(this.velocity, dt);

    const rate = this.spin.length();
    if (rate > 1e-3) {
      this._q.setFromAxisAngle(this._tmp.copy(this.spin).divideScalar(rate), rate * dt);
      this.quaternion.premultiply(this._q).normalize();
    }

    this.#instruments(dt);
  }

  /** Everything the panel reads, driven the same way whatever is flying. */
  #instruments(dt) {
    this.vario = (this.position.y - this._prevY) / Math.max(dt, 1e-4);
    this._prevY = this.position.y;
    this.varioSmooth = THREE.MathUtils.damp(this.varioSmooth, this.vario, 3.2, dt);
    // Netto: what the air was doing where the ship was, with the airframe's own
    // sink taken out of it. The vario says whether you are going up; this says
    // whether it is worth turning round to stay here.
    this.netto = this.wind.y;
    this.nettoSmooth = THREE.MathUtils.damp(this.nettoSmooth, this.netto, 3.2, dt);
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
