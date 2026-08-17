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
// Pinning the stick to the stop for this long promotes that axis from an
// attitude command to a rate, which is what makes a roll or a loop possible
// without making one reachable by accident.
/**
 * Stick to commanded bank, in radians.
 *
 * Straight multiplication is right for a ship whose stick tops out at a steep
 * turn, and wrong for one that can ask for inverted: 176 degrees across one
 * axis puts a 90-degree bank at half deflection, and then every ordinary turn
 * in the game is flown in the first quarter of the travel with no resolution
 * left in it.
 *
 * So the inner sixty per cent of the stick covers nought to sixty degrees —
 * which is every turn anybody flies — and the outer forty covers sixty to
 * inverted. That is also how it reads under a thumb: turns live near the
 * middle, and going upside down means taking it out to the rim.
 */
const BANK_KNEE = 0.6;
const BANK_KNEE_DEG = 60;
export function bankCommand(roll, maxBankDeg) {
  if (maxBankDeg <= 90) return roll * THREE.MathUtils.degToRad(maxBankDeg);
  const a = Math.min(1, Math.abs(roll));
  const deg =
    a <= BANK_KNEE
      ? (a / BANK_KNEE) * BANK_KNEE_DEG
      : BANK_KNEE_DEG + ((a - BANK_KNEE) / (1 - BANK_KNEE)) * (maxBankDeg - BANK_KNEE_DEG);
  return Math.sign(roll) * THREE.MathUtils.degToRad(deg);
}
/**
 * The inverse: what deflection asks for this bank. Lives next to the curve so
 * there is exactly one place that knows the shape of it — the calibrator's
 * pilot and the flight test both need to invert it, and a second copy of the
 * knee is a second thing to get wrong.
 */
export function stickForBank(rad, maxBankDeg) {
  const max = THREE.MathUtils.degToRad(maxBankDeg);
  if (maxBankDeg <= 90) return max > 0 ? rad / max : 0;
  const s = Math.sign(rad);
  const deg = THREE.MathUtils.radToDeg(Math.abs(rad));
  const a =
    deg <= BANK_KNEE_DEG
      ? (deg / BANK_KNEE_DEG) * BANK_KNEE
      : BANK_KNEE + ((deg - BANK_KNEE_DEG) / (maxBankDeg - BANK_KNEE_DEG)) * (1 - BANK_KNEE);
  return s * Math.min(1, a);
}

/** Past this much bank the atan2 wrap is close enough to matter. 120 degrees. */
const WRAP_GUARD = 2.094;

/** How much of the free-stream wind a thermal's column keeps out. See sample(). */
const THERMAL_SHELTER = 1.0;

const PIN_STICK = 0.94;
const PIN_DELAY = 0.35;

const FLUTTER_ONSET = 0.86;
/**
 * The speed below which propeller thrust stops rising, m/s. Thrust is power
 * over speed and that runs away towards zero; a real prop stalls its own blades
 * long before then, and `staticThrust` is where it actually tops out.
 */
const THRUST_FLOOR = 14;
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

/** Rolling resistance on grass, as a fraction of weight. */
const ROLL_MU = 0.045;
/** And what the wheel brakes add on top, fully on. */
const BRAKE_MU = 0.5;
/**
 * Below this throttle setting the brakes come on, hard at zero. There is no
 * separate brake control on a ship with a lever — an aerobatic monoplane has
 * no airbrakes and the button is gone — and chopping the throttle to stop is
 * what a hand does anyway.
 */
const BRAKE_BELOW = 0.08;
/** How hard a touchdown has to be before it is an arrival rather than a landing. */
const GEAR_LIMIT = 4.5;

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
    /** How deep inside a working column we are, 0..1. See the shelter below. */
    let core0 = 0;
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
      // Sheltered across the whole plume, not just the strong middle of it: a
      // thermal is a column of air on the move, and the ship circling inside
      // it is in that air whether or not it is in the best of it.
      core0 = Math.max(core0, smoothstep(1.5, 0.8, Math.sqrt(r2) / R) * cap * ramp);
      // Gentle sink in the collar around a working thermal — ramped by the
      // same height the lift is, and it was not. A column takes 180 m to spin
      // up, so down at thirty metres the core is worth almost nothing; the
      // collar, left unramped, was worth all of its sink. Over the Loop that
      // put the whole river between 1 and 2.9 m/s DOWN at deck height with no
      // lift anywhere to pay for it, which is not a city on a hot afternoon,
      // it is an arithmetic accident. The return flow around a thermal is what
      // happens above it; at the surface the air is converging inwards and
      // going up, and neither of those is a metre a second of sink.
      const collar = Math.exp(-((Math.sqrt(r2) - R * 1.9) ** 2) / (R * R * 0.55));
      lift -= t.strength * 0.16 * collar * cap * ramp;
    }
    out.y += lift;

    // A thermal here is a standing column: it forms over one patch of sunlit
    // ground, it stays over it, and the air inside it is going up rather than
    // downwind. Without that the free stream blows a circling glider straight
    // out of it — six and a half metres a second is a three-hundred-metre
    // column crossed inside a single turn — and every thermal on both maps is
    // scenery. Measured, that is exactly what was happening: no climb on the
    // ladder could be finished without holding the motor down, and taking the
    // motor away made four of them impossible. The columns were never the
    // problem, and the fix belongs here rather than in the challenge table.
    //
    // Real thermals drift with the airmass and are modelled that way in
    // cross-country sims, where the pilot drifts with them. These are tied to
    // the slopes that make them, so they are the standing kind — and a standing
    // column has to hold its own air or it is not standing at all.
    if (core0 > 0) {
      const shelter = 1 - THERMAL_SHELTER * core0;
      out.x *= shelter;
      out.z *= shelter;
    }

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
    this.rollPin = 0;
    this.pitchPin = 0;
    this.rolling = false;
    this.looping = false;
    this.brake = 0;
    /** Wheels down and rolling. See #roll. */
    this.onGround = false;
    /** How far the nose is held up off the ground, radians. */
    this.rotation = 0;
    /** Where the wheels are pointed while rolling, radians. */
    this._groundHdg = 0;
    /** Where the lever is, 0..1, damped. Always 0 on a ship with no engine. */
    this.throttle = 0;
    /** And what that is worth right now, in newtons. */
    this.thrust = 0;
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
    // Its own vector: `_tmp` is holding the drag direction where thrust is
    // added, and quietly reusing it would push the aeroplane sideways.
    this._thrustDir = new THREE.Vector3();
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
   *
   * In words a pilot would use to a passenger, not words a pilot would use to
   * another pilot. This used to say VNE — velocity never exceed, the redline —
   * which is exactly right and told nobody anything. A warning that has to be
   * looked up is not a warning. The escalation has to read as an escalation
   * too: ease off, then you are past it, then it is coming apart.
   */
  get warning() {
    if (this.broken) return 'WING FAILED';
    if (this.damage > 0.6) return 'AIRFRAME DAMAGED';
    if (this.airspeed > this.spec.vne) return 'TOO FAST · BREAKING UP';
    // Gated on actually being fast, not on the buffet alone. Buffet is damped
    // and decays over a few seconds, so after a dive it is still reading while
    // the ship is back at cruise — under the old wording that put a cryptic
    // "VNE" on screen at fifty knots, which was merely odd. "SLOW DOWN" at
    // fifty knots is wrong, and renaming it is what made that visible.
    if (this.buffet > 0.12 && this.airspeed > this.spec.vne * 0.8) return 'SLOW DOWN';
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
    this.brake = 0;
    this.onGround = false;
    this.rotation = 0;
    // Full power on a reset. A ship dropped on a marker with the lever shut is
    // a ship that starts every challenge behind.
    this.throttle = this.spec.power ? 1 : 0;
    this.thrust = 0;
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
   * @param {{roll:number, pitch:number, brake:number}} input
   */
  update(dt, input) {
    const cfg = this.spec;
    if (this.broken) return this.#fall(dt);
    if (this.onGround) return this.#roll(dt, input);

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

    // ---- controls: the stick asks for an attitude, until you insist ------
    // Two laws, and which one is running depends on how hard you are holding
    // the stick.
    //
    // Normally the stick asks for a bank ANGLE and an angle of attack. That is
    // not what a real control column does, but it is what makes a glider
    // flyable with one thumb on a phone: you put the stick somewhere and the
    // ship holds an attitude instead of needing to be nursed back. A pure rate
    // command was tried and it is more honest and worse to fly.
    //
    // Pinning the stick to the stop is how you say you meant it. Hold either
    // axis at full deflection and after a beat it becomes a rate: the bank
    // clamp comes off and the ship keeps rolling, or the nose keeps coming up
    // and over. Let go and the attitude law recaptures. So a barrel roll and a
    // loop are always one deliberate gesture away, and neither can happen by
    // accident, which is the whole reason the clamp existed.
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

    // How long each axis has been pinned. PIN_DELAY is short enough to feel
    // like part of the same gesture and long enough that carving a hard turn
    // against the stop does not tip you inverted.
    this.rollPin = Math.abs(input.roll) > PIN_STICK ? this.rollPin + dt : 0;
    this.pitchPin = Math.abs(input.pitch) > PIN_STICK ? this.pitchPin + dt : 0;
    this.rolling = this.rollPin > PIN_DELAY;
    this.looping = this.pitchPin > PIN_DELAY;

    // Three things off one axis, and every ship gets all three:
    //
    //   a little stick   a bank, held, and released it levels
    //   near the rim     up to 176 degrees on the ships that reach it, so
    //                    almost-inverted can be PARKED
    //   pinned to the rim after PIN_DELAY it promotes to a continuous roll
    //
    // The middle one was the whole of the last change and the third one was
    // switched off to make room for it, which was the wrong trade: the first
    // report from play was "I can't roll it". They do not conflict — 158
    // degrees is what 0.94 of deflection asks for, so the parked attitude and
    // the promotion sit either side of the same threshold, and letting go
    // levels the wings out of either of them.
    const canInvert = cfg.maxBankDeg > 90;

    let rollRate;
    if (cfg.rollRateStick) {
      // A RATE stick: the aileron is a roll rate and nothing puts the wings
      // back for you. Centre it and the aeroplane stays exactly where it was
      // left, knife-edge or upside down.
      //
      // Nothing in the issued fleet flies this any more and the Shrike used to.
      // It is the most honest model of an unlimited monoplane and it is too
      // hard to fly with a thumb: every turn ends with the wings still over,
      // and putting them back is a second deliberate input that a player on a
      // phone has to remember to make. The attitude law below reaches inverted
      // too — it just needs the stick HELD there.
      rollRate = input.roll * cfg.maxRollRate * speedAuthority * stiff;
    } else if (this.rolling) {
      rollRate = Math.sign(input.roll) * cfg.maxRollRate * speedAuthority * stiff;
    } else {
      const bankTarget = bankCommand(input.roll, cfg.maxBankDeg);
      let err = bankTarget - this.bankRad;
      // bankRad comes out of an atan2 and therefore wraps at +-180, so sitting
      // on inverted sits on the discontinuity: a hair past it the measurement
      // flips sign, the error flips with it and the aeroplane chases its own
      // tail. Take the short way round — but only up here, because wrapping
      // everywhere would answer full right stick from a slight left bank by
      // rolling LEFT to inverted, which is not what the stick asked for.
      if (Math.abs(this.bankRad) > WRAP_GUARD) {
        if (err > Math.PI) err -= 2 * Math.PI;
        else if (err < -Math.PI) err += 2 * Math.PI;
      }
      rollRate =
        THREE.MathUtils.clamp(err * 2.3, -cfg.maxRollRate, cfg.maxRollRate) * speedAuthority * stiff;
    }
    this.#rotate(this._f.set(0, 0, -1), rollRate * dt);

    // Trim holds a speed, not an attitude: fly faster than trim and the wing
    // asks for a little more alpha, which damps the phugoid instead of leaving
    // the player porpoising across the valley.
    //
    // On a powered ship the trim follows the throttle, which is what a pilot
    // does by hand after every power change. Without it the aeroplane holds
    // one speed whatever the lever is doing and every watt of excess goes into
    // climb — measured, the Shrike sat at 61 m/s from idle to full and only
    // the vertical speed moved, from -7.2 to +10.9. That is correct, it is
    // what "throttle controls altitude, elevator controls speed" means, and in
    // a game with no trim wheel it means you can never simply cruise.
    const trimV = cfg.trimSpeed * (1 + (cfg.throttleTrim ?? 0) * this.throttle);
    const trimA = cfg.trimAlphaDeg - (cfg.throttleAlpha ?? 0) * this.throttle;
    const speedTrim = THREE.MathUtils.clamp((V - trimV) * cfg.speedStability, -3.5, 5.0);

    // Banking without pulling unloads the wing, and an unloaded bank barely
    // turns — which made the natural diagonal thumb gesture a spiral dive
    // rather than a turn. Feed in the back pressure a pilot would: enough
    // alpha to hold the load factor a level turn needs. Capped, because near
    // ninety degrees the real answer goes to infinity.
    // ...and only while the aeroplane is the right way up. Past about seventy
    // degrees there is no level turn left to compensate for, and beyond ninety
    // the honest answer changes sign: an inverted wing holds its height on
    // NEGATIVE alpha. Left un-faded it commanded eleven degrees of nose-up
    // while upside down, which pitched the ship straight out of the bank —
    // measured, a parked 145 degrees sagged to 65 in six seconds. Holding
    // inverted is the player's job; this term is for turns.
    const upright = THREE.MathUtils.clamp(Math.cos(this.bankRad) / 0.35, 0, 1);
    const loadTrim = THREE.MathUtils.clamp(1 / Math.max(0.25, Math.cos(this.bankRad)) - 1, 0, 2.6) * 4.5 * upright;

    let pitchRate;
    if (this.looping) {
      pitchRate = Math.sign(input.pitch) * cfg.maxPitchRate * speedAuthority * stiff;
    } else {
      const span = input.pitch > 0 ? cfg.alphaMaxDeg - trimA : trimA - cfg.alphaMinDeg;
      const alphaTarget = THREE.MathUtils.degToRad(
        THREE.MathUtils.clamp(trimA + speedTrim + loadTrim + input.pitch * span, cfg.alphaMinDeg, cfg.alphaMaxDeg)
      );
      pitchRate = THREE.MathUtils.clamp((alphaTarget - alpha) * 3.4, -1.6, 1.6) * speedAuthority * stiff;
    }
    this.#rotate(this._f.set(1, 0, 0), pitchRate * dt);

    // Coming out of a roll or a loop the attitude law has to recapture from
    // wherever the manoeuvre left the ship, and past ninety degrees of bank it
    // would otherwise drive the long way round. -sin(bank) takes the short way.
    if (!cfg.rollRateStick && !canInvert && !this.rolling && Math.abs(this.bankRad) > Math.PI / 2) {
      this.#rotate(this._f.set(0, 0, -1), -Math.sin(this.bankRad) * cfg.rollStability * speedAuthority * dt);
    }

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

    // ---- thrust ------------------------------------------------------------
    // A propeller converts power to thrust, and thrust is power over speed —
    // which is why a prop pulls hardest standing still and falls away as the
    // ship runs. `staticThrust` caps the low-speed end, where the arithmetic
    // would otherwise go to infinity, and is also the honest figure for what
    // the aeroplane can pull against a rope.
    //
    // Normally aspirated, so it thins out with the air: the same throttle is
    // worth a fifth less over the Jungfraujoch than over Lake Michigan, which
    // is a real thing about flying high and costs nothing to model.
    //
    // A ship with no `power` never reaches any of this and flies exactly as it
    // always did — the sailplanes are untouched.
    this.throttle = cfg.power ? THREE.MathUtils.damp(this.throttle, input.throttle ?? 0, 7, dt) : 0;
    this.thrust = 0;
    if (cfg.power && this.throttle > 1e-3) {
      this.thrust =
        Math.min(cfg.staticThrust, cfg.power / Math.max(V, THRUST_FLOOR)) * this.throttle * (rho / 1.225);
      force.addScaledVector(this.forward(this._thrustDir), this.thrust);
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
   * Put it on the wheels. The game decides whether an arrival was a landing —
   * it owns the slope test and knows about water — and this is what it calls
   * when it was.
   */
  touchDown() {
    if (this.onGround || this.broken) return;
    this.onGround = true;
    this.rotation = 0;
    this._groundHdg = Math.atan2(this.velocity.x, -this.velocity.z);
    this.velocity.y = 0;
  }

  /**
   * Rolling.
   *
   * Not a special case bolted onto flight: it is its own short model, because
   * an aeroplane on its wheels is a different machine. The wing is still there
   * and still making lift, but the wheels own the attitude — they hold it
   * level with the slope and pointed where the nose is pointed — and what
   * decides everything is a one-dimensional sum along the ground: thrust,
   * rolling resistance, brakes and drag.
   *
   * Coming off is not a decision, it is arithmetic. Hold the stick back and
   * the nose comes up as far as the gear allows; when the wing at that angle
   * makes more lift than the aeroplane weighs, it flies. On the Shrike that
   * happens at about 32 m/s after some sixty metres of grass, which is what a
   * one-to-one aerobatic monoplane really does.
   */
  #roll(dt, input) {
    const cfg = this.spec;
    const hf = this.air.hf;
    const gear = cfg.gear ?? 0.9;
    const x = this.position.x;
    const z = this.position.z;
    const ground = hf.heightAt(x, z);
    const n = hf.normalAt(x, z, 30, this._up);

    // ---- attitude: the wheels own it ---------------------------------------
    // Steering falls away with speed, because a nosewheel that could still
    // swing the aeroplane at eighty metres a second would be a car.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const authority = 1 / (1 + (speed / 22) ** 2);
    // Read back off the velocity while there is one, so a swing on landing is
    // real; held from the last frame once stopped, where velocity says nothing.
    if (speed > 0.5) this._groundHdg = Math.atan2(this.velocity.x, -this.velocity.z);
    this._groundHdg += input.roll * (cfg.steerRate ?? 0.9) * authority * dt;

    this.rotation = THREE.MathUtils.damp(
      this.rotation,
      Math.max(0, input.pitch) * THREE.MathUtils.degToRad(cfg.rotateDeg ?? 11),
      6,
      dt
    );

    // Forward along the slope, nose lifted by however much the stick asked
    // for, wings level with the ground under them.
    const f = this._f.set(Math.sin(this._groundHdg), 0, -Math.cos(this._groundHdg));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const right = this._right.crossVectors(f, n).normalize();
    f.applyAxisAngle(right, this.rotation).normalize();
    const up = this._tmp.crossVectors(right, f).normalize();
    this._m ??= new THREE.Matrix4();
    this._m.makeBasis(right, up, f.multiplyScalar(-1));
    this.quaternion.setFromRotationMatrix(this._m);

    // ---- along the ground --------------------------------------------------
    const rho = Air.density(this.position.y);
    const q = 0.5 * rho * speed * speed * cfg.wingArea;
    const thrust = cfg.power
      ? Math.min(cfg.staticThrust, cfg.power / Math.max(speed, THRUST_FLOOR)) * this.throttle * (rho / RHO0)
      : 0;
    this.throttle = cfg.power ? THREE.MathUtils.damp(this.throttle, input.throttle ?? 0, 7, dt) : 0;
    // Brakes off the bottom of the lever. There is nowhere else to put them.
    const wheelBrake = cfg.power ? THREE.MathUtils.clamp((BRAKE_BELOW - this.throttle) / BRAKE_BELOW, 0, 1) : input.brake;
    // Twice the clean drag: the gear is down and the wing is at no useful angle.
    const drag = q * cfg.cd0 * 2;
    const friction = cfg.mass * G * (ROLL_MU + BRAKE_MU * wheelBrake);
    const along = (thrust - drag - Math.min(friction, speed > 0.4 ? friction : 0)) / cfg.mass;

    const nextSpeed = Math.max(0, speed + along * dt);
    this.velocity.set(Math.sin(this._groundHdg) * nextSpeed, 0, -Math.cos(this._groundHdg) * nextSpeed);
    this.position.addScaledVector(this.velocity, dt);
    this.position.y = hf.heightAt(this.position.x, this.position.z) + gear;

    // ---- and whether it is still on the ground -----------------------------
    this.airVelocity.copy(this.velocity).sub(this.air.sample(this.position, this.wind));
    this.airspeed = this.airVelocity.length();
    this.alpha = this.rotation;
    this.beta = 0;
    const lift = 0.5 * rho * this.airspeed * this.airspeed * cfg.wingArea * cfg.clSlope * this.rotation;
    this.loadFactor = lift / (cfg.mass * G);
    if (lift > cfg.mass * G) {
      this.onGround = false;
      // Off the wheels with the climb it has actually earned, so the first
      // instant of flight is continuous with the last instant of the roll.
      this.velocity.y = ((lift - cfg.mass * G) / cfg.mass) * dt;
    }

    this.stalled = false;
    this.buffet = 0;
    this.rollPin = 0;
    this.pitchPin = 0;
    this.rolling = false;
    this.looping = false;
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
