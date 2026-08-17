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
 *
 * Five of the six have no thrust, and that used to be all of them. A boost
 * button was tried and removed: on a sailplane it was the one control that
 * could answer a bad decision with something other than flying, every task on
 * the ladder ended up measured with a thumb on it, and a game about height
 * being the only currency had a button that printed money.
 *
 * The Shrike is not that. An engine on an aerobatic monoplane is not a cheat
 * bolted to a glider, it is the aeroplane — and it is described the way the
 * rest of the spec is, by numbers the flight model reads:
 *
 *   power         watts at the propeller, after efficiency. Thrust is power
 *                 over speed, which is why a prop pulls hardest slowest.
 *   staticThrust  the cap on that, for the speeds where the arithmetic would
 *                 otherwise go to infinity. Also what it can pull standing
 *                 still, so `staticThrust / mass·g` is the thrust-to-weight.
 *
 * A ship with no `power` never reads either and flies exactly as it did.
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
    kind: 'Ultralight',
    blurb: 'Glides like a brick and floats like one too. Wires, fabric and no engine.',
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
    // An unlimited aerobatic monoplane: the thing that flies race courses
    // through pylons and spends half its life inverted. Everything about it is
    // the opposite of the sailplanes above — a tenth of the span, five times
    // the roll rate, a third of the glide, and three hundred horsepower to
    // make up for all of it.
    id: 'shrike',
    name: 'Shrike 7',
    kind: 'Unlimited aerobatic',
    blurb: 'Three hundred horsepower and seven metres of wing. It will hold any attitude you put it in.',
    // Numbers from the class: 580 kg all-up on 10.4 m² and a 7.4 m span, so an
    // aspect ratio of 5.3 — a stubby wing that will not glide and does not care.
    mass: 580,
    wingArea: 10.4,
    aspectRatio: 5.27,
    // Fixed gear, a cowl the size of the pilot, wires and a flying wire brace.
    // Draggy by sailplane standards and slippery for what it is.
    cd0: 0.026,
    oswald: 0.75,
    clSlope: 5.0,
    // A thick SYMMETRIC section, which is the whole point: it makes exactly as
    // much lift upside down as it does the right way up, and the alpha limits
    // say so by being symmetric too. Nothing else in the fleet is.
    alphaStallDeg: 16.0,
    alphaMaxDeg: 20,
    alphaMinDeg: -20,
    trimAlphaDeg: 3.04, // holds 58 m/s at this wing loading, engine off
    trimSpeed: 58,
    speedStability: 0.18,
    // Autotrim with the lever — see the pitch law in flight.js. At full power
    // it trims for half again the speed and two degrees less alpha, so hands
    // off at cruise is a cruise instead of a climb.
    throttleTrim: 0.18,
    throttleAlpha: 1.2,
    // 420 degrees a second, which is the real figure for the class and five
    // times the ballasted nineteen-metre. A pinned stick is a continuous roll
    // in a fifth of a second rather than as a slow deliberate event.
    maxRollRate: 7.3,
    // An ATTITUDE stick, not a rate one — see the roll law in flight.js.
    //
    // This flew a rate stick, which is the honest model of an unlimited
    // monoplane and too hard to fly with a thumb. The aileron commanded a roll
    // rate and nothing put the wings back, so every turn ended with them still
    // over and levelling up was a second deliberate input you had to remember
    // to make. On a phone, in a valley, that is most of what "too hard" means.
    //
    // Now the stick says where to point and letting go says level. Inverted did
    // not go away with the rate stick: 176 degrees is what full deflection
    // asks for, so taking it out to the rim still rolls you upside down and
    // holds you there — it just has to be HELD, and releasing flies out
    // straight. Four degrees short of true inverted on purpose, because bank is
    // measured with an atan2 that wraps at 180 and nothing good happens sitting
    // on the discontinuity.
    //
    // What it costs is the continuous aileron roll: one axis cannot go past
    // 176, so a full 360 is no longer a thing this ship does. Nothing in the
    // game asks for one — the roll category was taken out for other reasons —
    // and being able to fly a turn without thinking is worth more.
    maxBankDeg: 176,
    rollStability: 0.0, // no dihedral at all
    // The only thing limiting load factor in this model is how fast the nose
    // can be pulled round, so this is the g limit in disguise: 1.4 rad/s at
    // 70 m/s is ten g, which is the class limit, and it loops in four and a
    // half seconds. At 2.0 it pulled eighteen g and came out of every loop
    // below the stall.
    maxPitchRate: 1.4,
    // No airbrakes. There is a throttle instead, and the two are not the same
    // control — see the throttle in flight.js.
    brakeDragFactor: 0,
    brakeLiftLoss: 0,
    vne: 118, // 425 km/h
    // 152 kW at the prop gives about 1,900 N of excess at trim, which is a
    // 19 m/s climb; and 6.2 kN standing still, which is 1.09 to one and means
    // it will hang on the propeller. Both are what the real ones do.
    power: 152000,
    staticThrust: 6200,
    // Two wing guns. `muzzle` is m/s and `rate` is rounds a second for the
    // pair. There is no magazine here on purpose: ammunition is unlimited
    // unless a CHALLENGE rations it, because counting rounds is a rule a task
    // imposes and outside one it is a number on the screen doing nothing. See
    // src/guns.js and `rounds` on the gunnery tasks in regions.js.
    gun: { muzzle: 620, rate: 18, spread: 0.0032, tracer: 26, mount: 1.7, nose: 1.1 },
    // On the wheels — see #roll in flight.js. `gear` is how high the axles hold
    // it, `rotateDeg` how far the stick can lift the nose before the tail is on
    // the grass, and `steerRate` how fast it swings at a walking pace.
    gear: 1.35,
    rotateDeg: 12,
    steerRate: 1.0,
    look: {
      span: 3.72,
      chord: 1.45,
      taperPower: 0.35, // nearly constant chord to a square tip
      dihedral: 0.05,
      sweep: 0.05,
      wingY: -0.1, // mid-wing, through the middle of the fuselage
      wingZ: 0.15,
      fuseLength: 0.95,
      fuseWidth: 1.0,
      tail: 1.3, // big surfaces, because they have to work at zero airspeed
      canopy: 0.8,
      foil: 0.16, // thick and symmetric
      // A stubby barrel with a cowl on the front, not a pod and a boom.
      fuse: [
        [-3.0, 0.5, 0.5, 0.0],
        [-2.5, 0.6, 0.58, 0.02],
        [-1.6, 0.56, 0.6, 0.02],
        [-0.6, 0.48, 0.58, 0.0],
        [0.6, 0.36, 0.44, 0.0],
        [1.8, 0.24, 0.3, 0.02],
        [3.0, 0.15, 0.2, 0.04],
        [4.0, 0.1, 0.16, 0.05],
      ],
      prop: 'nose',
      propR: 0.95,
      // Deep, because the lit material adds a lot of sky on top: 0.72 red came
      // out of the shader as pink.
      body: [0.4, 0.035, 0.045],
      trim: [0.9, 0.91, 0.95],
    },
  },
  {
    id: 'javelin',
    name: 'Javelin 9',
    kind: 'Clipped-wing racer',
    blurb: 'All ballast and no wing. It runs downhill fast and does nothing else.',
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
    // 324 km/h hands off, and deliberately clear of the redline: a challenge
    // arms at a third over trim, and on this ship that has to still be an
    // airspeed rather than a structural event.
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
    vne: 140, // 504 km/h — reachable in a dive and nowhere else
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

/**
 * The one aeroplane the game issues.
 *
 * The roster above is real and nothing about it has been thrown away — the
 * flight model, the mesh builder and the instruments all still read a spec, and
 * every ship here still flies the way its numbers say it does. What has gone is
 * the choosing: there is no hangar on the menu, challenges no longer hand you a
 * different aeroplane when you cross their hoop, and so there is nothing a
 * player can arrive in by accident. Six aircraft is a decision to make before
 * flying, and the menu has exactly one of those in it.
 *
 * Set this to null and the fleet comes back: the hangar renders, the saved
 * preference is honoured again and `shipFor` goes back to reading the ship each
 * challenge names. Everything downstream keys off this one constant.
 */
export const ISSUED_AIRCRAFT = 'shrike';

export const DEFAULT_AIRCRAFT = ISSUED_AIRCRAFT ?? FLEET[0].id;

/** Wing span in metres, which is what the aspect ratio and the area mean. */
export function wingSpan(spec) {
  return Math.sqrt(spec.aspectRatio * spec.wingArea);
}

export function getAircraft(id) {
  const find = (want) => FLEET.find((a) => a.id === want);
  return find(id) ?? find(DEFAULT_AIRCRAFT) ?? FLEET[0];
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
