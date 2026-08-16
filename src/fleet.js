/**
 * The roster.
 *
 * Every ship here is described by the same numbers the flight model reads, so
 * a spec is the whole aeroplane: nothing about how one flies is hidden in a
 * special case somewhere else. The `look` block is the same idea for the mesh.
 *
 * The numbers are chosen to be self-consistent rather than merely different.
 * trimAlphaDeg is the angle of attack that actually holds trimSpeed at the
 * ship's own wing loading, which is why each one settles where its card says
 * it will instead of drifting off to some other speed the moment you let go.
 */

const G = 9.80665;
const RHO0 = 1.225;
/** Fraction of maximum lift coefficient a trimmed glide can actually hold. */
const USABLE_CL = 0.82;

export const FLEET = [
  {
    id: 'vela',
    name: 'Vela 15',
    kind: 'Modern 15-metre',
    blurb: 'The all-rounder. Runs, climbs, forgives a little.',
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
    // How briskly the airframe picks itself up when the stick is centred, in
    // rad/s per radian of bank — about five seconds from forty-five degrees.
    // Slower than it wants to be on purpose: any quicker and it argues with
    // you every second you are trying to hold a thermalling turn.
    maxBankDeg: 72, // full stick deflection, before the pinned-stick roll
    rollStability: 0.30,
    maxPitchRate: 1.5, // rad/s at full elevator
    // Sized off the dive, not the circuit: fully out, these hold a vertical
    // dive below Vne, which is the only thing that does. Six to one on
    // approach, which is what a modern glider's boards really give.
    brakeDragFactor: 9.5,
    brakeLiftLoss: 0.28,
    boostThrust: 1750, // N — a motorglider's get-out-of-jail card
    boostBurn: 1 / 7, // full tank lasts 7 s
    boostRecharge: 1 / 26,
    vne: 74, // m/s
    look: {
      span: 7.55,
      chord: 0.95,
      taperPower: 1,
      dihedral: 0.58,
      sweep: 0.95,
      wingY: -0.03,
      wingZ: -0.15,
      fuseLength: 1,
      fuseWidth: 1,
      tail: 1,
      canopy: 1,
      body: [0.78, 0.79, 0.8],
      trim: [0.55, 0.09, 0.06],
    },
  },
  {
    id: 'cadet',
    name: 'Cadet 15',
    kind: 'Club trainer',
    blurb: 'Slow, floaty and hard to frighten. Weak air is its air.',
    mass: 285,
    wingArea: 16.0,
    aspectRatio: 14.0,
    cd0: 0.014,
    oswald: 0.85,
    clSlope: 4.8,
    // A fat, docile section: it will hang on to nearly seventeen degrees, and
    // the break when it comes is soft.
    alphaStallDeg: 16.5,
    alphaMaxDeg: 20,
    alphaMinDeg: -6,
    trimAlphaDeg: 5.9,
    trimSpeed: 24,
    speedStability: 0.42,
    maxRollRate: 2.6,
    maxBankDeg: 60,
    rollStability: 0.44, // a trainer is built to right itself
    maxPitchRate: 1.6,
    brakeDragFactor: 11.0, // barn doors, and the ship they are bolted to is slow
    brakeLiftLoss: 0.24,
    boostThrust: 1200,
    boostBurn: 1 / 9,
    boostRecharge: 1 / 22,
    vne: 54,
    look: {
      span: 7.4,
      chord: 1.34,
      taperPower: 0.55, // nearly constant chord, rounded off at the tip
      dihedral: 0.95,
      sweep: 0.37,
      wingY: 0.16, // shoulder-mounted, sat up on the pod
      wingZ: -0.1,
      fuseLength: 0.9,
      fuseWidth: 1.16,
      tail: 1.15,
      canopy: 1.1,
      foil: 0.13,
      body: [0.88, 0.84, 0.5],
      trim: [0.09, 0.28, 0.62],
    },
  },
  {
    id: 'draco',
    name: 'Draco 19',
    kind: 'Ballasted 18-metre',
    blurb: 'Nineteen metres of water and glass. It runs; it does not float.',
    mass: 700,
    wingArea: 15.0,
    aspectRatio: 24.0,
    cd0: 0.0125,
    oswald: 0.88,
    clSlope: 5.4,
    alphaStallDeg: 12.0,
    alphaMaxDeg: 15,
    alphaMinDeg: -8,
    trimAlphaDeg: 4.1,
    trimSpeed: 44,
    speedStability: 0.3,
    // All that span and all that water does not snap from bank to bank.
    maxRollRate: 1.45,
    maxBankDeg: 68,
    rollStability: 0.20, // nineteen metres of wing takes its time
    maxPitchRate: 1.15,
    brakeDragFactor: 9.5,
    brakeLiftLoss: 0.3,
    boostThrust: 2600,
    boostBurn: 1 / 6,
    boostRecharge: 1 / 30,
    vne: 92,
    look: {
      span: 9.4,
      chord: 0.82,
      taperPower: 1.5,
      dihedral: 1.5, // the span bends visibly under all that water
      sweep: 1.1,
      wingY: -0.02,
      wingZ: -0.12,
      fuseLength: 1.18,
      fuseWidth: 0.92,
      tail: 0.95,
      canopy: 1.05,
      foil: 0.095,
      winglet: 0.62,
      body: [0.74, 0.76, 0.8],
      trim: [0.05, 0.12, 0.36],
    },
  },
  {
    id: 'kite',
    name: 'Kite 10',
    kind: 'Powered ultralight',
    blurb: 'Glides like a brick, climbs whenever it likes. Wires and a motor.',
    mass: 210,
    wingArea: 15.0,
    aspectRatio: 7.0,
    // Struts, wires and a pilot in the breeze: the drag is the whole story.
    cd0: 0.042,
    oswald: 0.78,
    clSlope: 4.4,
    alphaStallDeg: 15.0,
    alphaMaxDeg: 18,
    alphaMinDeg: -6,
    trimAlphaDeg: 6.0,
    trimSpeed: 22,
    speedStability: 0.5,
    maxRollRate: 2.0,
    maxBankDeg: 55,
    rollStability: 0.48, // light, short-span, very stable
    maxPitchRate: 1.8,
    brakeDragFactor: 5.0,
    brakeLiftLoss: 0.2,
    // Not a boost at all but an engine: less shove than the gliders get, and
    // a tank you can run for the better part of a minute.
    boostThrust: 620,
    boostBurn: 1 / 45,
    boostRecharge: 1 / 34,
    // Wires and struts, but the engine can push it to 142 km/h in level flight
    // and a redline underneath that would leave it permanently in the buzz.
    vne: 46,
    look: {
      span: 5.05,
      chord: 1.5,
      taperPower: 0.4,
      dihedral: 0.3,
      sweep: 0.15,
      wingY: 0.78, // parasol wing on struts, pilot underneath
      wingZ: -0.35,
      fuseLength: 0.62,
      fuseWidth: 1.25,
      tail: 1.05,
      canopy: 0.45,
      foil: 0.15,
      matte: true, // doped fabric, not gelcoat
      strut: true,
      prop: true,
      body: [0.86, 0.32, 0.09],
      trim: [0.12, 0.12, 0.14],
    },
  },
  {
    id: 'javelin',
    name: 'Javelin 9',
    kind: 'Jet-assisted racer',
    blurb: 'All turbine and no wing. It accelerates; it does not climb.',
    // A tonne of aeroplane on nine square metres — nearly three times the
    // Draco's wing loading, which is where every one of its manners comes
    // from. It cannot circle in anything, and it does not need to.
    mass: 1150,
    wingArea: 9.5,
    aspectRatio: 8.53,
    // An intake, a fat body and a wing thick enough to hold fuel. Draggy for a
    // sailplane; slippery for anything with an engine in it.
    cd0: 0.018,
    oswald: 0.78,
    clSlope: 5.0,
    // A thin fast section stalls early and means it.
    alphaStallDeg: 11.0,
    alphaMaxDeg: 13,
    alphaMinDeg: -7,
    trimAlphaDeg: 2.74,
    // 324 km/h hands off and 437 with the turbine lit. Deliberately clear of
    // the redline: game.js puts a retried challenge back in the air at a third
    // over trim, and on this ship that has to still be an airspeed, not a
    // structural event.
    trimSpeed: 90,
    speedStability: 0.16,
    // Short stiff wings snap between banks — it rolls faster than anything
    // else here and still turns like a barge, because a six-hundred-metre
    // circle at trim is arithmetic and no amount of aileron argues with it.
    maxRollRate: 2.8,
    maxBankDeg: 80, // it will hold a knife-edge if you ask
    rollStability: 0.16, // almost no dihedral: it stays where you put it
    maxPitchRate: 1.1,
    brakeDragFactor: 11.0, // proper speedbrake panels, and it needs them
    brakeLiftLoss: 0.22,
    // An engine, not a get-out-of-jail card: half a minute of it, and a long
    // wait afterwards. Thrust is what this ship soars on.
    boostThrust: 1900,
    boostBurn: 1 / 34,
    boostRecharge: 1 / 46,
    vne: 140, // 504 km/h — flat out and level sits right on the edge of the buzz
    look: {
      span: 4.5,
      chord: 1.75,
      taperPower: 0.8, // broad to the tip: a clipped delta, not a sailplane
      dihedral: 0.1,
      sweep: 2.1, // the tip sits two metres behind the root: about thirty degrees
      wingY: -0.2, // low-mounted, under the intake trunks
      wingZ: 0.1,
      fuseLength: 1.15,
      fuseWidth: 1.5,
      tail: 1.2, // a fin big enough to hold a short body straight at 120 m/s
      canopy: 0.72,
      foil: 0.075,
      matte: true, // satin paint, not gelcoat: without it the dark grey reads white
      jet: true,
      // A stout, area-ruled body with an engine down the middle of it, rather
      // than the glider's pod and boom.
      fuse: [
        [-3.4, 0.10, 0.10, 0.0],
        [-2.9, 0.34, 0.30, -0.02],
        [-2.1, 0.52, 0.46, -0.04],
        [-1.0, 0.62, 0.56, -0.04],
        [0.4, 0.66, 0.58, -0.01],
        [1.8, 0.60, 0.54, 0.02],
        [3.2, 0.50, 0.48, 0.05],
        [4.4, 0.42, 0.42, 0.07],
        [5.4, 0.38, 0.38, 0.08],
      ],
      body: [0.17, 0.19, 0.23],
      trim: [0.86, 0.21, 0.03],
    },
  },
];

export const DEFAULT_AIRCRAFT = FLEET[0].id;

/** Wing span in metres, which is what the aspect ratio and the area mean. */
export function wingSpan(spec) {
  return Math.sqrt(spec.aspectRatio * spec.wingArea);
}

export function getAircraft(id) {
  return FLEET.find((a) => a.id === id) ?? FLEET[0];
}

/**
 * The ship's glide polar, from the same coefficients the flight model uses.
 *
 * Steady glide: lift carries the weight, so the speed at a given CL falls out
 * of the wing loading, and the sink is that speed divided by the lift-to-drag
 * ratio there. What the HUD and the menu card quote comes from here, which is
 * the only way those numbers can be honest — tools/flight-test.mjs flies each
 * ship and checks the measurements against this.
 */
export function polar(spec, rho = RHO0) {
  const w = (spec.mass * G) / spec.wingArea;
  const k = 1 / (Math.PI * spec.aspectRatio * spec.oswald);
  const clMax = spec.clSlope * (spec.alphaStallDeg * Math.PI) / 180;
  const out = { bestLD: 0, bestLDSpeed: 0, minSink: Infinity, minSinkSpeed: 0, stallSpeed: 0 };
  out.stallSpeed = Math.sqrt((2 * w) / (rho * clMax));
  for (let i = 1; i <= 400; i++) {
    // Stop short of the break. The last fifth of the lift coefficient is not
    // available in a steady glide — the ship mushes and the sink gets worse
    // again — so quoting min sink from it would promise a number nobody can
    // fly. USABLE_CL is where the measured polar in flight-test.mjs turns.
    const cl = (clMax * USABLE_CL * i) / 400;
    const ld = cl / (spec.cd0 + k * cl * cl);
    const v = Math.sqrt((2 * w) / (rho * cl));
    const sink = v / ld;
    if (ld > out.bestLD) {
      out.bestLD = ld;
      out.bestLDSpeed = v;
    }
    if (sink < out.minSink) {
      out.minSink = sink;
      out.minSinkSpeed = v;
    }
  }
  return out;
}
