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
    maxBankDeg: 72, // full stick deflection
    brakeDragFactor: 7.0,
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
      sweep: 0.26,
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
    brakeDragFactor: 5.5,
    brakeLiftLoss: 0.24,
    boostThrust: 1200,
    boostBurn: 1 / 9,
    boostRecharge: 1 / 22,
    vne: 48,
    look: {
      span: 7.4,
      chord: 1.34,
      taperPower: 0.55, // nearly constant chord, rounded off at the tip
      dihedral: 0.95,
      sweep: 0.1,
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
    brakeDragFactor: 6.0,
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
      sweep: 0.3,
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
    brakeDragFactor: 4.0,
    brakeLiftLoss: 0.2,
    // Not a boost at all but an engine: less shove than the gliders get, and
    // a tank you can run for the better part of a minute.
    boostThrust: 620,
    boostBurn: 1 / 45,
    boostRecharge: 1 / 34,
    vne: 38,
    look: {
      span: 5.05,
      chord: 1.5,
      taperPower: 0.4,
      dihedral: 0.3,
      sweep: 0.04,
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
