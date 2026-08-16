/**
 * Flies every challenge, in the aeroplane it names, and measures what is
 * actually achievable — then proposes the medal ladder from the measurement.
 *
 * Medal thresholds are the one number in the game that cannot be reasoned out
 * on paper. They depend on the ship's polar, on the air along the line, on how
 * much height each gate leaves you and on what the control law will let a pilot
 * do with the stick. All four of those have moved, so all of them have to be
 * re-measured rather than adjusted.
 *
 * What this does, per challenge:
 *
 *   1. Surveys the site. For a climb or a low pass that means sampling the real
 *      Air on a grid around the marker: a marker standing in dead air cannot be
 *      climbed out of however generous the clock, and no threshold makes that
 *      task finishable. For a glide task it means the arithmetic budget — what
 *      the line costs at best glide against what the marker hands you.
 *   2. Flies it. The real Glider, the real Air, the real Heightfield, the real
 *      buildings and the real Challenges scoring — nothing here re-implements
 *      a rule, so a rule change in the game shows up here as a different
 *      measurement rather than as agreement with a stale copy.
 *   3. Sweeps a fixed set of pilot policies — cruise speed, bank limit, line
 *      choice — and keeps every outcome, because the spread between the best
 *      and the worst run is what says whether a ladder has room in it.
 *   4. Proposes bronze, silver, gold and the fail limit off the best SOARED
 *      run, and prints enough of the working for a human to disagree.
 *
 * There is no thrust to sweep any more. The ladder is anchored on the best
 * glide anybody flew, because a glide is the only thing anybody can fly — which
 * is also why six of these had to be re-cut when the boost button went: their
 * best measured lines had all been flown with a thumb on it.
 *
 *   node tools/calibrate-challenges.mjs                  both maps
 *   node tools/calibrate-challenges.mjs --map=chicago
 *   node tools/calibrate-challenges.mjs --only=heat-island --verbose
 *   node tools/calibrate-challenges.mjs --only=wengen-boomer --trace
 *   node tools/calibrate-challenges.mjs --time=morning    a different sun
 *   node tools/calibrate-challenges.mjs --json           just the numbers
 *
 * --time is a survey tool, not a check the shipped game has to pass. Thermals
 * are seeded off the sun, so a column worth 3 m/s on an afternoon is worth
 * nothing on a morning, and standing the alpine climbs on faces rather than
 * over meadows only softens that — measured, the Oberland Ceiling's marker
 * reads 3.4 m/s on an afternoon and 1.9 at midday, where its gold is 47 s
 * quicker than any line this tool can fly. That spread is why the sun is fixed
 * at afternoon in the game and why the table below is calibrated against that
 * hour alone. Run the others to see how much of the ladder the weather owns.
 *
 * It exits non-zero when a challenge cannot be finished at all, or when the
 * table it is checking against has a ladder that cannot be climbed — those are
 * content bugs, not opinions.
 */
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { Heightfield } from '../src/heightfield.js';
import { Air, Glider } from '../src/flight.js';
import { REGIONS, CHALLENGES } from '../src/regions.js';
import { World } from '../src/world.js';
import {
  Challenges,
  TYPES,
  medalFor,
  challengeMetric,
  entrySpeed,
  shipFor,
  onCorridor,
  corridorAt,
} from '../src/challenges.js';
import { loadBuildings, Buildings } from '../src/buildings.js';
import { polar } from '../src/fleet.js';
import { TIME_PRESETS } from '../src/sky.js';

// ---------------------------------------------------------------- setup ---
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const MAPS = arg('map') ? [arg('map')] : ['jungfrau', 'chicago'];
const ONLY = arg('only');
const VERBOSE = flag('verbose');
const TRACE = flag('trace');
const AS_JSON = flag('json');
const TIME_OF_DAY = arg('time', 'afternoon');
/** Fly only the policies whose label contains this, for looking at one line. */
const POLICY = arg('policy');

/** The physics step the game runs at. Anything coarser is a different game. */
const TICK = 1 / 120;

/**
 * How long a run is allowed to take while being measured, which is not the
 * challenge's own limit: the limit is one of the numbers being calibrated, and
 * flying against it would only ever confirm whatever it already says. Runs are
 * flown against a generous horizon and the clock is proposed afterwards.
 */
const horizonFor = (def) => (TYPES[def.type].windowed ? def.window + 2 : clamp(def.limit * 2.2, 120, 400));

/**
 * The medal ladder, as multiples of the best run this tool could fly.
 *
 * The autopilot below is a steady pilot with perfect information and no thumbs:
 * it never misses a gate and never panics, but it also never cuts a corner it
 * was not told about. Treating its best run as "what a very good human does"
 * and padding from there is the only honest way to place gold — a threshold set
 * ON the machine optimum is a threshold nobody reaches.
 *
 * Gold at +10% is a run where nothing was thrown away. Silver at +28% is a
 * clean run with one slow corner in it. Bronze at +52% is a finish. The limit
 * sits half again past bronze so that finishing and medalling stay two
 * different events — if they were equal the ladder would have two rungs.
 */
const LADDER = { gold: 1.10, silver: 1.28, bronze: 1.52, limit: 2.05 };
/** Nothing in the game runs longer than this. See the note on CHALLENGES. */
const SLALOM_CAP = 90;
/**
 * The windowed three are quantities rather than clocks, and more is better, so
 * their ladder runs the other way: gold just under the best measured, bronze a
 * good way below it. Looser than the slalom ladder because the machine below is
 * a steady pilot with perfect information — it never misjudges a thermal or a
 * roll, and it never has to look for anything.
 */
const YIELD_LADDER = { gold: 0.9, silver: 0.72, bronze: 0.52 };

// ------------------------------------------------------------- the world ---
/** The baked region, read the way the browser reads it but without a browser. */
async function loadHeightfield(id) {
  const meta = JSON.parse(await readFile(new URL(`../data/${id}.json`, import.meta.url), 'utf8'));
  const png = PNG.sync.read(await readFile(new URL(`../data/${id}.png`, import.meta.url)));
  const n = meta.size;
  const heights = new Float32Array(n * n);
  const water = new Uint8Array(n * n);
  const { bias, scale } = meta.encoding;
  for (let p = 0, q = 0; p < heights.length; p++, q += 4) {
    heights[p] = (png.data[q] * 256 + png.data[q + 1]) / scale - bias;
    water[p] = png.data[q + 2] > 127 ? 1 : 0;
  }
  return new Heightfield(meta, heights, water, null);
}

/** Enough of a Sky for the materials and for where the thermals form. */
function stubSky(timeName) {
  const p = TIME_PRESETS[timeName] ?? TIME_PRESETS.afternoon;
  const el = THREE.MathUtils.degToRad(p.elevation);
  const az = THREE.MathUtils.degToRad(p.azimuth);
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  return {
    sunDir,
    uniforms: {
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uHaze: { value: p.haze },
      uExposure: { value: p.exposure },
      uTime: { value: 0 },
      uCloudCover: { value: 0.3 },
      uCloudQuality: { value: 1 },
    },
  };
}

/**
 * One loaded region, with the same objects the game builds: the challenge
 * markers, their gate courses and their pickups all come from the real
 * Challenges, so the thing being flown is the thing that ships.
 */
async function loadRegion(id, timeName = TIME_OF_DAY) {
  const region = REGIONS[id];
  const hf = await loadHeightfield(id);
  const sky = stubSky(timeName);
  const air = new Air(hf, sky, region.air);
  air.seedThermals();

  const scene = new THREE.Scene();
  const world = new World(hf, sky, scene, id);
  const b64 = (await readFile(new URL(`../data/${id}-buildings.bin.gz`, import.meta.url))).toString('base64');
  // Landmarks are meshes, not colliders: the hit tests read the footprint data.
  const buildings = new Buildings(hf, sky, await loadBuildings(null, b64), world.places, {
    ...region.buildings,
    landmarks: null,
  });
  const challenges = new Challenges(world, hf, sky, scene, id, buildings);
  return { id, region, hf, air, sky, world, buildings, challenges };
}

// -------------------------------------------------------------- the pilot ---
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A pilot that flies a point in the sky.
 *
 * The stick commands rates now, so this is two nested loops rather than a
 * setpoint: heading error asks for a bank angle, the bank error asks for
 * aileron; the line to the target and the speed error ask for a pitch
 * attitude, and the attitude error asks for elevator. Damping terms on both
 * axes stop the loops arguing with the airframe's own stability, which is
 * strong on the trainer and nearly absent on the jet.
 *
 * It is deliberately not a great pilot. It flies one line, holds one speed and
 * never changes its mind, which is why the sweep over policies rather than the
 * gains is what finds the fast run.
 */
class Pilot {
  constructor(glider, policy) {
    this.g = glider;
    this.p = policy;
    this.prevBank = 0;
    this.prevPitch = 0;
    this.f = new THREE.Vector3();
  }

  /**
   * @param {THREE.Vector3} target where to point
   * @param {number} speedTarget the speed to hold
   * @param {{bank?: number}} [opts] a bank angle to hold instead of steering at
   *   the target — circling, where the radius is arithmetic rather than
   *   something to feed back towards.
   * @returns the control input for this step.
   */
  fly(dt, target, speedTarget, opts = {}) {
    const g = this.g;
    const spec = g.spec;
    const f = g.forward(this.f);
    const dx = target.x - g.position.x;
    const dz = target.z - g.position.z;
    const dy = target.y - g.position.y;
    const D = Math.hypot(dx, dz);

    // ---- roll: heading error asks for bank, bank error asks for aileron ---
    const psi = Math.atan2(f.x, -f.z);
    const err = wrap(Math.atan2(dx, -dz) - psi);
    const bank = g.bankRad;
    const bankRate = wrap(bank - this.prevBank) / dt;
    this.prevBank = bank;
    // Bank costs lift: a turn at 1/cos(phi) g stalls at sqrt of that times the
    // straight stall speed. Without this cap the policy sweep's steepest option
    // simply mushes, and what it measures is the stall rather than the corner.
    const book = this.book ?? (this.book = polar(spec));
    const margin = Math.min(1, (book.stallSpeed * 1.18 / Math.max(g.airspeed, 1)) ** 2);
    const bankMax = Math.min(this.p.bankMax, Math.acos(clamp(margin, 0.08, 1)));
    const bankCmd = clamp(opts.bank ?? err * 2.1, -bankMax, bankMax);
    // The stick is a bank-angle command scaled by the ship's own maxBankDeg —
    // see the roll law in flight.js — so the honest way to ask for a bank is to
    // divide by it, and let a small error term take out the lag. Feeding back
    // on bank error alone, as this did, leaves a steady-state offset that the
    // gain can never close: the ballasted ship settled 16 degrees shallow of
    // every command, which turns a 180 m circle into a 330 m one and flies
    // every corner of every course wide. Kept clear of the pinned-stick
    // threshold, which is the aerobatic roll and not something a pilot wants
    // to trigger by asking for a steep turn.
    const stickForBank = bankCmd / THREE.MathUtils.degToRad(spec.maxBankDeg);
    const roll = clamp(stickForBank + (bankCmd - bank) * 0.7 - bankRate * 0.12, -0.92, 0.92);

    // ---- pitch: the line to the target, corrected for the speed we want ---
    // Fast means nose down and slow means nose up, so the speed error goes in
    // with the sign of the path angle. Bank steals lift from the vertical, so
    // the turn compensation puts it back before the nose can drop out of it.
    const pitchAtt = Math.asin(clamp(f.y, -1, 1));
    const pitchRate = (pitchAtt - this.prevPitch) / dt;
    this.prevPitch = pitchAtt;
    // Pitch flies the LINE and the brakes hold the speed — the way a glider is
    // actually flown on a descending course. Trying to hold a cruise number on
    // the elevator instead is what makes an autopilot sail over the top of a
    // gate it was diving at: the speed error simply outvotes the geometry.
    // Circling is the exception, where a brake is the last thing you want and
    // attitude is all there is, so those policies ask for it back.
    const path = clamp(Math.atan2(dy, Math.max(D, 30)), -0.75, 0.5);
    const holdOnStick = this.p.brakes === false;
    // A third mode, for the deck runs: fly the LINE and let the speed be
    // whatever the air leaves you. On a task scored in seconds under a ceiling
    // there is no cruise number to hold — the corridor is flown on the energy
    // you arrived with, and any loop that trades the line for a speed puts the
    // nose down into the river to buy back three knots. All that is kept is a
    // floor, so the ship does not mush to a stop.
    const speedErr = this.p.floor
      ? Math.min(0, (g.airspeed - this.p.floor) * 0.02) < -0.35
        ? -0.35
        : Math.min(0, (g.airspeed - this.p.floor) * 0.02)
      : clamp((g.airspeed - speedTarget) * 0.02, -0.35, holdOnStick ? 0.3 : 0);
    const turnComp = 0.5 * (1 / Math.max(Math.cos(bank), 0.3) - 1);
    const attCmd = clamp(path + speedErr, -0.7, 0.5);
    let pitch = clamp((attCmd - pitchAtt) * 2.6 - pitchRate * 0.22 + turnComp * 0.35, -1, 1);
    // Nobody good flies into the buffet on purpose. Without this the elevator
    // is the only brake the model has, and every policy that wants to slow down
    // ends up mushing along at thirty degrees of alpha instead.
    const stallA = THREE.MathUtils.degToRad(spec.alphaStallDeg);
    if (g.alpha > stallA * 0.88) pitch = Math.min(pitch, -(g.alpha - stallA * 0.88) * 6);

    // Airbrakes are how you actually lose a speed you do not want — the Javelin
    // arrives at the river doing 120 m/s and has to be at fifty for Wolf Point,
    // and no amount of stick will do that without them.
    const vneGuard = clamp((g.airspeed - spec.vne * 0.88) / (spec.vne * 0.08), 0, 1);
    // And the other thing boards are for: getting DOWN. A ship whose best glide
    // is flatter than the line it has been given arrives above everything —
    // over a rooftop course, thirty metres above is a pickup missed. Comparing
    // the flight path being flown with the one being asked for turns that into
    // a brake setting, which is what a pilot does with the same information.
    const flown = g.velocity.length() > 1 ? Math.asin(clamp(g.velocity.y / g.velocity.length(), -1, 1)) : 0;
    const steeper = clamp((flown - path) * 3, 0, 1);
    // In path mode the cruise term goes and `steeper` becomes a policy, because
    // the two deck runs want opposite answers and both are real flying.
    //
    // Under the Falls arrives forty per cent over trim with ninety metres to
    // lose: asked to descend at nine degrees the ship simply does not — the
    // stick alone cannot spend that much energy, and it CLIMBED eleven metres
    // over the first six seconds of every line flown with the aim point below
    // it. Boards are how a glider goes down. River Level is the other case
    // entirely: sixty seconds in air that is not giving anything back, where
    // every joule spent on drag is a second off the deck at the far end, and
    // the same boards cost it the whole run. So the sweep flies both.
    const brake = holdOnStick
      ? vneGuard
      : this.p.floor
        ? Math.max(vneGuard, this.p.boards ? steeper : 0)
        : Math.max(vneGuard, steeper, clamp((g.airspeed - speedTarget * 1.05) / (speedTarget * 0.3), 0, 1));
    // A lever, for the ships that have one. Wide open, backed off only when the
    // ship is running away from the speed it was asked to hold — which is the
    // whole of what a throttle does on a course. Zero on a sailplane, where the
    // flight model never reads it.
    const throttle = this.p.power ? clamp(1 - (g.airspeed - speedTarget) / (speedTarget * 0.25), 0, 1) : 0;
    return { roll, pitch, brake, throttle };
  }
}

// --------------------------------------------------------------- the run ---
/**
 * Fly one attempt, exactly as the game would run it: the ship the challenge
 * names, dropped on the marker at the game's own entry speed, scored by the
 * real Challenges. Everything this loop does to the ship between steps —
 * region bounds, structures, ground contact — mirrors Game#simulate; if that
 * changes, this has to change with it.
 */
function fly(ctx, def, policy, guide) {
  const { hf, air, buildings, challenges } = ctx;
  const spec = shipFor(def);
  const glider = new Glider(air, spec);
  const spawn = challenges.spawnFor(def);
  // The game's own entry speed, imported rather than copied: a calibration
  // flown from a different one than the game uses is a calibration of nothing.
  glider.reset(spawn.position, spawn.heading, entrySpeed(def, spec));

  air.time = 0;
  challenges.abort();
  const run = challenges.arm(def);
  const horizon = horizonFor(def);
  // See horizonFor: for a slalom the authored clock is an output of this tool
  // and must not be flown against, so the run gets a generous one instead. For
  // the windowed three the clock IS the task and overriding it would measure a
  // different challenge.
  if (!TYPES[def.type].windowed) run.limit = horizon;
  // The pilot has to know whether the aeroplane has an engine before it flies
  // one, and a policy is the only thing it is handed.
  const pilot = new Pilot(glider, { ...policy, power: !!spec.power });
  const state = {
    ctx,
    def,
    // A deck run's corridor, built by Challenges with the marker. Read from
    // there rather than rebuilt here, so the tool scores against the same
    // geometry the game does.
    line: challenges.markers.find((m) => m.def === def)?.line ?? null,
    policy,
    glider,
    run,
    pilot,
    t: 0,
    minAgl: Infinity,
    maxAgl: 0,
    peakSpeed: 0,
    startY: glider.position.y,
    lowY: glider.position.y,
  };

  const prev = new THREE.Vector3();
  const hit = {};
  const lim = hf.halfSize - 900;
  let out = null;
  const trace = [];

  for (let step = 0; step < Math.ceil(horizon / TICK); step++) {
    prev.copy(glider.position);
    air.update(TICK);
    const input = guide(state, TICK);
    glider.update(TICK, input);
    state.t += TICK;
    state.peakSpeed = Math.max(state.peakSpeed, glider.airspeed);
    state.lowY = Math.min(state.lowY, glider.position.y);

    if (Math.abs(glider.position.x) > lim || Math.abs(glider.position.z) > lim) {
      out = { reason: 'out of bounds' };
      break;
    }
    if (glider.broken) {
      out = { reason: 'airframe failed' };
      break;
    }
    if (buildings?.hitSegment(prev, glider.position, hit)) {
      out = { reason: 'structure', where: `${Math.round(hit.x)},${Math.round(hit.y)},${Math.round(hit.z)}` };
      break;
    }
    const ground = hf.heightAt(glider.position.x, glider.position.z);
    const agl = glider.position.y - ground;
    state.minAgl = Math.min(state.minAgl, agl);
    state.maxAgl = Math.max(state.maxAgl, agl);
    // A run nobody can watch is hard to argue with, so --trace keeps a coarse
    // log of the winning line: where it was, how high, how fast, how far on.
    if (TRACE && step % Math.round(2 / TICK) === 0) {
      const off = Math.hypot(glider.position.x - spawn.position.x, glider.position.z - spawn.position.z);
      trace.push(
        `      t${state.t.toFixed(0).padStart(4)}s  ${glider.position.y.toFixed(0).padStart(5)} m (${agl.toFixed(0).padStart(4)} agl)  ` +
          `${glider.airspeed.toFixed(0).padStart(3)} m/s  air ${glider.nettoSmooth.toFixed(1).padStart(5)}  ` +
          `${off.toFixed(0).padStart(5)} m out  ${readout(challenges.hudState()) ?? ''}`
      );
    }
    if (agl < 3.5) {
      out = { reason: hf.isWater(glider.position.x, glider.position.z) ? 'water' : 'ground' };
      break;
    }

    for (const ev of challenges.update(TICK, glider.position, prev, agl)) {
      if (ev.kind === 'done') out = { finished: true, value: ev.value, elapsed: state.t };
      else if (ev.kind === 'failed') out = { reason: ev.reason === 'time' ? 'out of time' : ev.reason };
    }
    if (out) break;
  }
  const progress = readout(challenges.hudState());
  challenges.abort();
  if (!out) out = { reason: 'out of time' };
  out.progress = out.progress ?? progress;
  return {
    ...out,
    policy,
    trace,
    seconds: state.t,
    minAgl: state.minAgl,
    heightUsed: state.startY - state.lowY,
    peakSpeed: state.peakSpeed,
  };
}

/**
 * The band as the player sees it, except for a deck run, where the band shows
 * the state in words and keeps the seconds on the clock beside it. A tool
 * report that says "too high" where it used to say how much was banked is a
 * tool report with the measurement taken out of it.
 */
function readout(hud) {
  if (!hud) return null;
  return hud.flag ? `${fmt(hud.clock)} s on the deck` : hud.progress;
}

// ------------------------------------------------------------- guidance ---
/**
 * Slalom and collect: fly at whatever the game itself says is next. Using
 * Challenges.objective rather than a private copy of the ordering means the
 * tool chases exactly the thing the HUD arrow points at.
 */
function courseGuide(state, dt) {
  const { challenges } = state.ctx;
  const g = state.glider;
  const run = challenges.active;
  let target = null;
  let next = null;

  if (run?.def.type === 'slalom') {
    const gate = challenges.world.gates[run.gateIndex];
    const after = challenges.world.gates[run.gateIndex + 1];
    if (gate) target = gate.position.clone();
    if (after) next = after.position;
    state.capture = gate?.radius ?? 40;
    // Take the inside of a hoop at a corner. A gate is a disc, not a point, and
    // at Wolf Point the difference between crossing it on the apex and crossing
    // it in the middle is the difference between coming out of the turn on the
    // branch and coming out of it in the west bank.
    if (gate && after && state.legFrom) {
      const inA = new THREE.Vector3().subVectors(gate.position, state.legFrom).setY(0).normalize();
      const inB = new THREE.Vector3().subVectors(after.position, gate.position).setY(0).normalize();
      const apex = inB.sub(inA);
      if (apex.lengthSq() > 1e-4) target.addScaledVector(apex.normalize(), gate.radius * 0.45);
    }
  }
  if (!target) target = g.position.clone().addScaledVector(g.forward(new THREE.Vector3()), 400);

  // Fly the LEG, not the thing at the end of it. A pursuit curve bulges outside
  // the line on every turn, and outside the line in Chicago is the Board of
  // Trade — while the straight leg between two points is the one line the
  // course was checked against. So the aim point is a carrot on that line, a
  // couple of seconds ahead of where the ship has got to along it.
  if (target) {
    if (!state.legTo || state.legTo.distanceToSquared(target) > 120 * 120) {
      // The leg starts where the last one ended — at the gate just flown
      // through, not at wherever the ship happened to be when the target
      // changed. That is what makes the line being tracked the same line the
      // course was checked against.
      state.legFrom = state.legTo ?? g.position.clone();
      state.legTo = target.clone();
    }
    const along = new THREE.Vector3().subVectors(target, state.legFrom);
    const len = along.length();
    if (len > 1) {
      along.divideScalar(len);
      // Allowed to run past the end of the leg by the size of the thing there,
      // so the ship flies THROUGH a hoop rather than at it and does not have to
      // turn back for a plane it is already on.
      const reach = Math.max(60, g.airspeed * 1.7);
      const t = clamp(new THREE.Vector3().subVectors(g.position, state.legFrom).dot(along) + reach, 0, len + (state.capture ?? 0) * 0.8);
      target = state.legFrom.clone().addScaledVector(along, t);
    }
  }

  // A gate flown ends any go-around that was in progress and starts a new leg.
  // Watching the challenge's own progress rather than how far the aim point
  // jumped is what makes that exact.
  const progress = challenges.hudState()?.progress;
  if (progress !== state.progress) {
    state.progress = progress;
    state.escape = null;
  }
  target = avoid(state, reattack(state, target, run?.def.type === 'slalom' ? challenges.world.gates[run.gateIndex] : null));
  return state.pilot.fly(dt, target, cornerSpeed(state, next));
}

/**
 * Arrive at a sharp corner slower than you cruised to it.
 *
 * Turn radius goes with the square of the speed, so the whole difference
 * between making the left at Wolf Point and ending up in the west bank is
 * thirty knots on the way in. Anybody who races anything does this; a pilot
 * model that holds one number all the way round is not modelling a good pilot,
 * it is modelling a bad one.
 */
function cornerSpeed(state, next) {
  const g = state.glider;
  if (!next || !state.legFrom || !state.legTo) return state.policy.speed;
  const legX = state.legTo.x - state.legFrom.x;
  const legZ = state.legTo.z - state.legFrom.z;
  const outX = next.x - state.legTo.x;
  const outZ = next.z - state.legTo.z;
  const a = Math.hypot(legX, legZ);
  const b = Math.hypot(outX, outZ);
  if (a < 1 || b < 1) return state.policy.speed;
  const turn = Math.acos(clamp((legX * outX + legZ * outZ) / (a * b), -1, 1));
  const d = Math.hypot(state.legTo.x - g.position.x, state.legTo.z - g.position.z);
  const close = clamp(1 - d / 320, 0, 1);
  // Never below a speed the ship can actually turn at: slowing into a corner is
  // only quicker while the wing is still flying.
  const floor = polar(g.spec).stallSpeed * 1.3;
  // Only for corners that are actually corners: a fifteen-degree kink down the
  // river is not worth a metre of speed, and treating it as one leaves the ship
  // mushing between every pair of gates.
  return Math.max(floor, state.policy.speed * (1 - 0.35 * clamp((turn - 0.85) / 0.6, 0, 1) * close));
}

/**
 * Which pickup to go for. `order: 'authored'` takes them in table order, which
 * is the route a human reads off the map; `nearest` is what the HUD arrow does
 * and is sometimes quicker and sometimes a zigzag. Both get flown.
 */
function pickTarget(state, run) {
  const left = [];
  for (let i = 0; i < run.points.length; i++) if (!run.taken[i]) left.push(run.points[i]);
  if (!left.length) return [null, null];
  if (state.policy.order === 'authored') return [left[0], left[1] ?? null];
  left.sort((a, b) => a.distanceToSquared(state.glider.position) - b.distanceToSquared(state.glider.position));
  return [left[0], left[1] ?? null];
}

/**
 * Look where you are going.
 *
 * Chicago's tasks are flown between three-hundred-metre towers, and a pilot
 * model that only knows about the next gate will fly into the Board of Trade
 * every time — which measures the autopilot, not the challenge. So: probe the
 * line ahead against the real collision data, and if it is blocked, take the
 * smallest deviation that is not. Steering around is preferred to climbing
 * over, because height is the currency and a glider that zooms over every
 * building arrives at the next gate with nothing left.
 *
 * Re-probed a few times a second rather than every step: at 1/120 s the answer
 * cannot have changed, and the hit test is the expensive thing here.
 */
const AVOID_INTERVAL = 0.12;

/**
 * Keep the aim point off the rock.
 *
 * In the Alps this matters more than the buildings do: a marker on the far side
 * of a shoulder, or the low half of a circle beside a face, will fly a ship
 * into the hill with the aim point still perfectly valid. Sampling the ground
 * under the line and lifting the target so the whole line clears it is a crude
 * model of a pilot's eyes, and the difference between the tool measuring a
 * challenge and the tool measuring how well it can be crashed.
 *
 * The margin is not generous. Ridge lift dies off exponentially above the
 * slope, so a pilot who keeps three hundred metres of air under the wing does
 * not climb; fifty metres is close flying, which is the game.
 */
function overTerrain(state, target, margin = state.policy.clearance ?? 55) {
  if (margin <= 0) return target;
  const { hf } = state.ctx;
  const g = state.glider;
  const dx = target.x - g.position.x;
  const dz = target.z - g.position.z;
  const span = Math.hypot(dx, dz);
  if (span < 1) return target;
  // The final-glide question, asked every step: to clear a ridge four
  // kilometres away I have to be high enough NOW, because between here and
  // there I can only go down. So every point on the way is worth its own ground
  // clearance plus the height the glide to it will cost, and the aim never goes
  // below the worst of them. Without this the ship follows the straight line to
  // the next gate, descends early, and flies into the col it should have
  // crossed a thousand feet higher.
  const glide = (state.book ?? (state.book = polar(g.spec))).bestLD * 0.8;
  const steps = clamp(Math.round(span / 220), 4, 26);
  let need = -Infinity;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ground = hf.heightAt(g.position.x + dx * t, g.position.z + dz * t);
    need = Math.max(need, ground + margin - ((1 - t) * span) / glide);
  }
  // Only ever lifts the aim: a target already well clear is left exactly where
  // the task put it, so this cannot quietly turn a low pass into a high one.
  return need > target.y ? new THREE.Vector3(target.x, need, target.z) : target;
}

/** Is the arc the ship is currently flying clear for the next three seconds? */
function turning(g, buildings, hit) {
  const V = Math.max(g.airspeed, 1);
  const rate = (9.80665 * Math.tan(g.bankRad)) / V;
  let psi = Math.atan2(g.velocity.x, -g.velocity.z);
  const a = g.position.clone();
  const b = new THREE.Vector3();
  const stepT = 0.75;
  for (let i = 0; i < 4; i++) {
    psi += rate * stepT;
    b.set(a.x + Math.sin(psi) * V * stepT, a.y + g.velocity.y * stepT, a.z - Math.cos(psi) * V * stepT);
    if (buildings.hitSegment(a, b, hit)) return false;
    a.copy(b);
  }
  return true;
}

function avoid(state, target) {
  const { buildings } = state.ctx;
  const g = state.glider;
  target = overTerrain(state, target);
  if (!buildings) return target;
  if (state.t < (state.avoidUntil ?? 0)) return state.avoidTarget ?? target;
  state.avoidUntil = state.t + AVOID_INTERVAL;
  state.avoidTarget = null;

  const to = new THREE.Vector3().subVectors(target, g.position);
  const range = Math.min(to.length(), Math.max(150, g.airspeed * 4.5));
  if (range < 1) return target;
  const hit = {};
  const probe = new THREE.Vector3();
  const test = (yaw, lift) => {
    const dir = to.clone().setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    probe.set(g.position.x + dir.x * range, g.position.y + (to.y * range) / Math.max(to.length(), 1) + lift, g.position.z + dir.z * range);
    return buildings.hitSegment(g.position, probe, hit) ? null : probe.clone();
  };

  // Two questions, and both have to be clear. Where the ship is POINTED is the
  // straight line to the aim point; where it is actually GOING, banked over in
  // a turn, is an arc, and an arc curves into things a straight probe never
  // crosses. Missing that is how the jet keeps arriving inside a bank on the
  // outside of the bend at Wolf Point.
  if (turning(g, buildings, hit) && test(0, 0)) {
    state.avoidTarget = null;
    return target;
  }
  // Straight ahead but higher first, then progressively wider. In a canyon
  // there is nowhere to the side to go — the way out is up, over the parapet —
  // and over open ground the small yaw wins before the climb is ever tried.
  // A deck run's entire score is being low, so an escape that buys clearance by
  // climbing seventy metres is not an escape — it is a failure with a survivor.
  // Those policies look sideways first and only go up with nowhere left to go.
  const escapes = state.policy.hugs
    ? [[0.22, 6], [-0.22, 6], [0.45, 12], [-0.45, 12], [0.85, 22], [-0.85, 22], [0, 60], [0, 150]]
    : [[0, 70], [0.26, 30], [-0.26, 30], [0, 160], [0.5, 40], [-0.5, 40], [0.9, 60], [-0.9, 60]];
  for (const [yaw, lift] of escapes) {
    const clear = test(yaw, lift);
    if (clear) {
      state.avoidTarget = clear;
      return clear;
    }
  }
  // Nothing to the side: go up. The roof it just found is the floor to clear.
  const over = new THREE.Vector3(target.x, Math.max(target.y, (hit.top ?? g.position.y) + 60), target.z);
  state.avoidTarget = over;
  return over;
}

/**
 * A thing inside your own turning circle cannot be turned onto: chasing it just
 * spirals around the outside of it forever, which is the classic way an
 * autopilot turns a sixty-second course into a three-minute one. Recognise it,
 * fly away to make room, and come back — which is exactly what a pilot who has
 * blown an approach does.
 */
function reattack(state, target, gate) {
  const g = state.glider;
  // On a gate course there is only one test that matters: is the gate behind
  // you? A hoop you are lined up on but slightly off is still a hoop you are
  // about to fly through, and going round for it — down a river, with a bank
  // on each side — is how a run that was working ends up in an office block.
  if (gate) {
    const behind =
      (g.position.x - gate.position.x) * gate.normal.x +
      (g.position.y - gate.position.y) * gate.normal.y +
      (g.position.z - gate.position.z) * gate.normal.z;
    if (behind < gate.radius * 0.5) {
      state.escape = null;
      return target;
    }
  }
  const dx = target.x - g.position.x;
  const dz = target.z - g.position.z;
  const d = Math.hypot(dx, dz);
  const f = g.forward(new THREE.Vector3());
  const err = Math.abs(wrap(Math.atan2(dx, -dz) - Math.atan2(f.x, -f.z)));
  const turnRadius = (g.airspeed * g.airspeed) / (9.80665 * Math.tan(state.policy.bankMax));
  // A gate you are lined up on is not a gate you have missed, however close it
  // is: what matters is how far off to the side you will pass, against how big
  // the thing is. Going round again from thirty metres out would throw away
  // the one pass that was going to work.
  if (d * Math.sin(err) < (state.capture ?? 40) * 0.9) {
    state.escape = null;
    return target;
  }

  // Once committed to going round again, stay committed until there is room to
  // turn in. Deciding afresh every step just flip-flops on the boundary, which
  // is slower than either choice.
  if (state.escape) {
    if (d > turnRadius * 2.6) state.escape = null;
    else return new THREE.Vector3(state.escape.x, target.y, state.escape.z);
  } else if (d < turnRadius * 2.0 && err > 0.6) {
    state.escape = { x: g.position.x + f.x * 1200, z: g.position.z + f.z * 1200 };
    return new THREE.Vector3(state.escape.x, target.y, state.escape.z);
  }
  return target;
}

/**
 * Circling. Two things it has to get right, and the old version got neither.
 *
 * The bank. A circle of radius r at speed v is a bank of atan(v^2 / g r) and
 * nothing else — it is arithmetic, not a thing to feed back towards. Steering
 * at a point on the rim through a proportional heading loop settles at whatever
 * error balances the gain: measured, a policy asking for a 140 m circle flew a
 * 340 m one at a steady 38 degrees and spent every turn outside the thermal,
 * which is why every climb on the ladder read as impossible the moment the
 * motor was taken away. The bank is commanded outright now.
 *
 * The centre. A column leans, breathes and is never quite where the survey put
 * it, and a bank-commanded circle starts tangent to wherever the ship entered
 * rather than around anything. Both are answered by the heuristic every pilot
 * is taught: remember where in the turn the air was going up hardest, and shove
 * the circle that way. Netto rather than the ship's own vario — vario is mostly
 * the last pitch correction, and centring on it chases the phugoid.
 */
function orbitGuide(state, dt) {
  const g = state.glider;
  const p = state.policy;
  const c = (state.orbit ??= { cx: p.centre.x, cz: p.centre.z, bestW: -Infinity, bx: 0, bz: 0, last: null, swept: 0 });

  // Two corrections, and both are needed. A bank-commanded circle is tangent
  // to wherever the ship entered, so its centre starts a full radius off the
  // core and the far side of the first turn is two radii out — which for a
  // 300 m thermal is outside it. So: pull the centre towards the ship
  // continuously while the air is going up, which keeps the circle where the
  // lift is found rather than where the survey said it was...
  if (g.nettoSmooth > 0.8) {
    const k = Math.min(1, g.nettoSmooth / 3) * dt * 0.5;
    c.cx += (g.position.x - c.cx) * k;
    c.cz += (g.position.z - c.cz) * k;
  }
  // ...and once a turn, shove it at the best air of that turn, which is the
  // correction a pilot makes and the one that finds a core the circle is only
  // clipping. Netto rather than the ship's own vario: vario is mostly the last
  // pitch correction, and centring on it chases the phugoid.
  if (g.nettoSmooth > c.bestW) {
    c.bestW = g.nettoSmooth;
    c.bx = g.position.x;
    c.bz = g.position.z;
  }
  const ang = Math.atan2(g.position.z - c.cz, g.position.x - c.cx);
  if (c.last == null) c.last = ang;
  c.swept += Math.abs(wrap(ang - c.last));
  c.last = ang;
  if (c.swept > Math.PI) {
    c.swept = 0;
    if (isFinite(c.bestW)) {
      c.cx += (c.bx - c.cx) * 0.5;
      c.cz += (c.bz - c.cz) * 0.5;
    }
    c.bestW = -Infinity;
  }

  // Nose a little above the horizon so the pitch loop has a line to hold; the
  // speed it is asked for does the rest.
  const f = g.forward(new THREE.Vector3());
  const target = new THREE.Vector3(
    g.position.x + f.x * 140,
    g.position.y + 20,
    g.position.z + f.z * 140
  );
  const bank = Math.atan((g.airspeed * g.airspeed) / (9.80665 * p.radius));
  return state.pilot.fly(dt, avoid(state, target), p.speed, { bank });
}

/**
 * Beating a face: shuttle between two ends of a band of lift, turning back at
 * each end. What a ridge asks for, and nothing a circle can do — half of a
 * circle over a ridge is spent in the sink behind it.
 */
function beatGuide(state, dt) {
  const g = state.glider;
  const p = state.policy;
  if (state.leg == null) state.leg = 0;
  const end = p.ends[state.leg];
  if (Math.hypot(end.x - g.position.x, end.z - g.position.z) < 160) state.leg = 1 - state.leg;
  const to = p.ends[state.leg];
  const target = new THREE.Vector3(to.x, g.position.y + 18, to.z);
  return state.pilot.fly(dt, avoid(state, target), p.speed);
}

/**
 * Distance: ninety seconds, and the only question is how far from the hoop the
 * ship can be at the end of them.
 *
 * There is nothing to steer at, so the policy IS the line — a heading and a
 * speed — and the sweep over headings is the tool asking the terrain which way
 * pays. Held straight on purpose: turning is how you lose a distance task, and
 * a pilot who wanders looking for lift in ninety seconds arrives nowhere.
 */
function dashGuide(state, dt) {
  const g = state.glider;
  const p = state.policy;
  const reach = Math.max(400, g.airspeed * 12);
  // Aim down the glide slope the requested speed actually flies at. Aiming
  // level and asking for sixty-six metres a second gets neither: the pitch loop
  // holds the line it is given and the boards take the speed back off, so every
  // policy flew at the same forty and the sweep measured nothing.
  const target = new THREE.Vector3(
    g.position.x + Math.sin(p.heading) * reach,
    g.position.y - reach / glideAt(g.spec, p.speed),
    g.position.z - Math.cos(p.heading) * reach
  );
  return state.pilot.fly(dt, avoid(state, target), p.speed);
}

/** Still-air glide ratio at a given speed, from the same coefficients as polar(). */
function glideAt(spec, v) {
  const w = (spec.mass * 9.80665) / spec.wingArea;
  const k = 1 / (Math.PI * spec.aspectRatio * spec.oswald);
  const cl = (2 * w) / (1.225 * v * v);
  return cl / (spec.cd0 + k * cl * cl);
}

/**
 * Deck run: sixty seconds, a corridor and a ceiling, and the clock only runs
 * while both hold.
 *
 * Two loops, and they pull against each other, which is the task. Laterally the
 * pilot aims at a point a few hundred metres up the corridor, biased back
 * towards the centreline by however far off it has drifted — a pure carrot
 * cuts every corner and a pure centreline chase weaves. Vertically it holds a
 * height above the ground UNDER THE AIM POINT rather than under the ship, so it
 * starts climbing at a rising floor before it arrives at it instead of after.
 *
 * The target height is the policy. Flying at the ceiling scores from the first
 * second and loses the lot on the first bump; flying well under it never loses
 * a second and has no room for the terrain. Which of those pays is the thing
 * being measured, so both are on the list.
 */
function deckGuide(state, dt) {
  const g = state.glider;
  const p = state.policy;
  const { hf } = state.ctx;
  const line = state.line;
  const here = onCorridor(line, g.position.x, g.position.z);

  // Look further ahead the faster you are going: a fixed carrot is a twitch at
  // sixty metres a second and a shortcut at thirty.
  const reach = clamp(g.airspeed * p.lead, 180, 900);
  const ahead = corridorAt(line, here.at + reach, (state.aim ??= {}));
  const target = (state.target ??= new THREE.Vector3()).set(ahead.x, 0, ahead.z);
  // Pulled back onto the line in proportion to how far off it is, capped so a
  // ship that has been thrown wide does not turn ninety degrees to the corridor
  // and fly across it.
  if (here.off > 1) {
    const on = corridorAt(line, here.at, (state.onLine ??= {}));
    const k = clamp((here.off / Math.max(line.width, 1)) * p.centre, 0, 0.85);
    target.x += (on.x - target.x) * k;
    target.z += (on.z - target.z) * k;
  }

  // The floor under where it is GOING, and under the halfway point too: a
  // corridor that rises between here and there is one to start climbing for
  // now rather than on arrival.
  const floorAhead = Math.max(
    hf.heightAt(ahead.x, ahead.z),
    hf.heightAt((ahead.x + g.position.x) / 2, (ahead.z + g.position.z) / 2)
  );
  const floorHere = hf.heightAt(g.position.x, g.position.z);
  const nowAgl = g.position.y - floorHere;
  const wantAgl = line.ceiling * p.hold;

  // Vertically the aim is a flight path ANGLE, not a point, and this is the
  // whole difference between a deck run and a crash. The lateral aim point is
  // six hundred metres away because that is what steers smoothly — but at that
  // range a twenty metre height error bends the line to it by two degrees, so
  // the pitch loop corrects at under two metres a second while the valley floor
  // moves twenty metres in two hundred. Every line flown that way either flew
  // through the deck into the ground or porpoised across it. So: work out the
  // angle wanted, then put the aim point on it at whatever range steering wants.
  //
  //   the floor's own slope   what it takes just to stay parallel to the ground
  //   the error term          closes the height error over p.tau seconds
  const away = Math.max(Math.hypot(target.x - g.position.x, target.z - g.position.z), 30);
  const floorSlope = clamp((floorAhead - floorHere) / Math.max(reach, 1), -0.2, 0.2);
  const closing = clamp((wantAgl - nowAgl) / Math.max(g.airspeed * p.tau, 1), -0.13, 0.1);
  let gamma = clamp(floorSlope + closing, -0.16, 0.1);
  // Then the other half: scan the corridor a long way out and take the
  // shallowest angle that still arrives over every rising metre of it at the
  // working height. The Narrows has a fifty metre step in it where the 25 m
  // grid bridges the gorge at Zweilütschinen, and it climbs at 17 per cent —
  // faster than this ship can pull up from thirty metres. Seen only at the aim
  // point it is unflyable; seen seven hundred metres out it is a gentle climb
  // begun early, which is what a pilot does with the same information.
  // Then the ground, scanned along the corridor in two ranges, because the two
  // ranges answer different questions.
  const q = (state.scan ??= {});
  const safety = line.ceiling * 0.35;
  const ask = (d) => {
    corridorAt(line, here.at + d, q);
    return (hf.heightAt(q.x, q.z) + safety - g.position.y) / d;
  };
  // Near — the next three seconds, over which a straight line is a fair model
  // of what the ship is going to do. This one may limit a descent, because out
  // to there the ship really is committed to the angle it is flying.
  const near = Math.max(140, g.airspeed * 3);
  for (let d = 60; d <= near; d += 60) gamma = Math.max(gamma, Math.min(0.26, ask(d)));
  // Far — rising ground and nothing else. The Narrows falls a hundred metres
  // over its length, so out at nine hundred metres the shallowest angle that
  // "clears" the floor is shallower than the descent the ship wants; read as a
  // constraint rather than as a climb demand it pins a ship that arrived high
  // up at sixty metres for half the window, which is measured, and is exactly
  // what it did. Only a positive reading means anything out here.
  const scan = clamp(g.airspeed * 15, 450, 950);
  for (let d = near + 90; d <= scan; d += 90) {
    const need = ask(d);
    if (need > 0) gamma = Math.max(gamma, Math.min(0.26, need));
  }
  // Finally, trim onto the path actually being flown. The pitch loop holds an
  // ATTITUDE, and attitude is not flight path: the air over the Chicago river
  // sinks at 1.9 m/s, so a wings-level ship there descends at three degrees
  // while believing it is holding the line, and every line the calibrator flew
  // down the branch went into the water at twenty-five seconds doing exactly
  // that. This is the integral that finds the extra attitude the air is
  // charging, and it costs speed, which is the honest price.
  const speed = g.velocity.length();
  const flying = speed > 1 ? Math.asin(clamp(g.velocity.y / speed, -1, 1)) : 0;
  state.trim = clamp((state.trim ?? 0) + (gamma - flying) * dt * 1.6, -0.16, 0.16);
  target.y = g.position.y + clamp(gamma + state.trim, -0.16, 0.26) * away;
  // And never aim into the dirt whatever the arithmetic says.
  target.y = Math.max(target.y, floorAhead + safety);
  return state.pilot.fly(dt, avoid(state, target), p.speed);
}

/**
 * A climb starts wherever the marker is and the lift is usually somewhere else,
 * so the first leg is a glide to the site and only then does the circling or
 * the beat begin. Switching on arrival rather than on a clock keeps a distant
 * site honest: the transit is part of the time.
 */
function climbGuide(state, dt) {
  const g = state.glider;
  const p = state.policy;
  const d = Math.hypot(p.centre.x - g.position.x, p.centre.z - g.position.z);
  if (!state.arrived && d > (p.type === 'beat' ? 260 : p.radius * 1.35)) {
    const target = new THREE.Vector3(p.centre.x, Math.max(g.position.y, p.centre.y ?? g.position.y), p.centre.z);
    return state.pilot.fly(dt, avoid(state, target), p.transitSpeed);
  }
  state.arrived = true;
  return p.type === 'beat' ? beatGuide(state, dt) : orbitGuide(state, dt);
}

// ------------------------------------------------------------ the survey ---
/**
 * What the air over a place is worth, to this ship, at the heights the task
 * will be flown at.
 *
 * Net climb, not lift: a 2 m/s column the Draco sinks through at 1.4 is worth
 * 0.6, and a marker whose best net is negative is a marker in dead air. Sink
 * is taken at the ship's minimum-sink speed in a thirty-five degree turn,
 * where the load factor costs about a fifth again.
 */
function surveyLift(ctx, spec, centre, { radius = 2600, step = 130, heights = [0, 200, 400, 700] } = {}) {
  const { air, hf } = ctx;
  const book = polar(spec);
  const circling = book.minSink * 1.22;
  const v = new THREE.Vector3();
  const sites = [];
  const at = (x, z, y) => {
    // The thermals breathe, so a single sample flatters or libels a site by up
    // to a fifth. Three phases of the cycle, averaged, is the site itself.
    let sum = 0;
    for (const t of [0, 3, 6]) {
      const now = air.time;
      air.time = t;
      air.sample({ x, y, z }, v);
      air.time = now;
      sum += v.y;
    }
    return sum / 3;
  };

  for (let dx = -radius; dx <= radius; dx += step) {
    for (let dz = -radius; dz <= radius; dz += step) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const x = centre.x + dx;
      const z = centre.z + dz;
      if (Math.abs(x) > hf.halfSize - 400 || Math.abs(z) > hf.halfSize - 400) continue;
      const ground = hf.heightAt(x, z);
      let worst = Infinity;
      let mean = 0;
      for (const h of heights) {
        const w = at(x, z, Math.max(centre.y, ground + 60) + h);
        worst = Math.min(worst, w);
        mean += w / heights.length;
      }
      sites.push({ x, z, ground, mean, worst, net: mean - circling, distance: Math.hypot(dx, dz) });
    }
  }
  sites.sort((a, b) => b.net - a.net);
  return { circling, sites, best: sites[0] ?? null };
}

/**
 * A band of lift, or a bubble? A ridge holds its lift along the face and loses
 * it either side; a thermal falls away in every direction. The answer decides
 * whether the pilot circles or beats, and getting it wrong costs half the climb.
 */
function bandAxis(ctx, spec, site, y) {
  const { air } = ctx;
  const v = new THREE.Vector3();
  const at = (x, z) => {
    air.sample({ x, y, z }, v);
    return v.y;
  };
  const peak = at(site.x, site.z);
  let bestAxis = null;
  let bestHold = -Infinity;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const hold = Math.min(
      at(site.x + dirX * 420, site.z + dirZ * 420),
      at(site.x - dirX * 420, site.z - dirZ * 420)
    );
    if (hold > bestHold) {
      bestHold = hold;
      bestAxis = { x: dirX, z: dirZ };
    }
  }
  return { peak, hold: bestHold, axis: bestAxis, banded: bestHold > peak * 0.72 && bestHold > 0.8 };
}

/**
 * The legs of a course that no ship can fly: the ones that pass through a
 * building, and the ones that ask for a flatter glide than the ship has.
 *
 * A course is a promise that its own line is flyable. Checking it here means a
 * gate authored into the side of a tower reads as a sentence in the report
 * rather than as thirty-six identical crashes with no explanation.
 */
function blockedLegs(ctx, def, marker, points) {
  const { hf, buildings } = ctx;
  const book = polar(shipFor(def));
  const out = [];
  const at = (p) => {
    const y = hf.heightAt(p.x, p.z) + p.agl;
    return { x: p.x, y, z: p.z };
  };
  let a = { x: marker.x, y: marker.y, z: marker.z };
  let name = 'the marker';
  for (const p of points) {
    const b = at(p);
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    const label = p.name ?? `${Math.round(b.y)} m`;
    if (buildings?.hitSegment(a, b, {})) out.push(`${name} → ${label} passes through a building`);
    // Only downhill legs can be too flat; a leg that climbs is a different
    // question, and one the air rather than the polar has to answer.
    const slope = run / Math.max(a.y - b.y, 0.001);
    if (a.y > b.y && slope > book.bestLD * 1.05) {
      out.push(`${name} → ${label} needs ${slope.toFixed(0)}:1 and the ship glides ${book.bestLD.toFixed(0)}:1`);
    }
    a = b;
    name = label;
  }
  return out;
}

/** The horizontal direction along the hill rather than up or down it. */
function contourAt(ctx, site) {
  const n = ctx.hf.normalAt(site.x, site.z, 120, new THREE.Vector3());
  const slope = Math.hypot(n.x, n.z);
  if (slope < 1e-3) return { x: 1, z: 0 };
  return { x: -n.z / slope, z: n.x / slope };
}

/** Local metres back to the latitude and longitude the challenge table uses. */
function toLatLon(ctx, p) {
  const meta = ctx.hf.meta;
  return {
    lat: meta.centerLat - p.z / 111320,
    lon: meta.centerLon + p.x / (111320 * Math.cos((meta.centerLat * Math.PI) / 180)),
  };
}

/** The best few sites that are not the same site twice. */
function pickSites(survey, count, apart = 420) {
  const out = [];
  for (const s of survey.sites) {
    if (s.net <= 0.05) break;
    if (out.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < apart)) continue;
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

// ------------------------------------------------------------- policies ---
/** The cruise speeds worth trying, from just off the stall to just off the redline. */
function speedLadder(spec) {
  const book = polar(spec);
  const lo = Math.max(book.minSinkSpeed, book.stallSpeed * 1.18);
  const hi = Math.min(spec.vne * 0.82, spec.trimSpeed * 1.75);
  const out = [];
  for (let i = 0; i < 6; i++) out.push(Math.round(lo + ((hi - lo) * i) / 5));
  return [...new Set(out)];
}

function coursePolicies(def, spec) {
  const out = [];
  for (const speed of speedLadder(spec)) {
    for (const bankMax of [1.0, 1.2, 1.4]) {
      out.push({ kind: 'course', speed, bankMax, label: `${speed} m/s · ${Math.round((bankMax * 180) / Math.PI)}°` });
    }
  }
  return out;
}

/**
 * Distance: every heading worth trying, at every speed worth flying. Which one
 * wins is the tool telling you what the terrain under that hoop is for — and if
 * the authored heading is not close to the winner, the hoop is pointed the
 * wrong way.
 */
function dashPolicies(def, spec) {
  const out = [];
  const authored = THREE.MathUtils.degToRad(def.marker.heading);
  for (let k = -3; k <= 3; k++) {
    const heading = authored + (k / 3) * 0.9;
    for (const speed of speedLadder(spec).slice(1)) {
      out.push({
        kind: 'dash',
        heading,
        speed,
        bankMax: 0.9,
        brakes: false,
        clearance: 70,
        label: `${Math.round(((heading * 180) / Math.PI + 360) % 360)}° · ${speed} m/s`,
      });
    }
  }
  return out;
}

/**
 * Deck run: how low to aim, how far ahead to look, and how hard to pull back
 * onto the line. The slow end of the speed ladder is on the list and usually
 * wins — a corridor is worth seconds, not metres, and the ship that covers it
 * in forty seconds banks forty rather than the twenty-eight a fast one does.
 *
 * `clearance` is fourteen metres against the usual fifty-five. The terrain
 * guard exists to stop an autopilot flying into a col it should have crossed
 * high; on this task the whole point is to be under it, and left at its default
 * it lifts every aim point clean through the ceiling and scores nothing.
 */
function deckPolicies(spec) {
  const book = polar(spec);
  const out = [];
  for (const hold of [0.45, 0.65, 0.85]) {
    for (const lead of [7, 11]) {
      for (const tau of [1.6, 3.2]) {
        for (const floor of [book.stallSpeed * 1.25, book.stallSpeed * 1.6]) {
          for (const boards of [false, true]) {
            out.push({
              kind: 'deck',
              speed: spec.trimSpeed,
              floor: Math.round(floor),
              boards,
              hold,
              lead,
              tau,
              centre: 0.8,
              bankMax: 1.1,
              clearance: 14,
              hugs: true,
              label: `hold ${Math.round(hold * 100)}% · lead ${lead}s · flare ${tau}s · floor ${Math.round(floor)} m/s${boards ? ' · boards' : ''}`,
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * How fast to fly a circle of a given radius, which is not min-sink speed.
 *
 * A turn costs load factor, and load factor costs stall speed: the ballasted
 * ship stalls at 26 m/s wings-level and at 33 in a fifty-degree bank. Circling
 * at the book's 28 m/s minimum-sink speed therefore does not circle — it
 * mushes, and the ship comes down inside the strongest thermal on the map.
 * That is what made every climb on the ladder measure as impossible the moment
 * the motor was taken away, and it had been hidden for as long as there was a
 * motor to push through it with.
 *
 * Steady turn: tan(bank) = v^2 / (g r), load factor n = 1/cos(bank), and the
 * stall speed goes as sqrt(n). Solved by iteration because v appears on both
 * sides, then flown a quarter over the stall it lands on.
 */
function circlingSpeed(spec, radius) {
  const book = polar(spec);
  let v = book.minSinkSpeed;
  for (let i = 0; i < 40; i++) {
    const n = Math.sqrt(1 + (v * v / (9.80665 * radius)) ** 2);
    const want = Math.max(book.minSinkSpeed, book.stallSpeed * Math.sqrt(n) * 1.25);
    v += (want - v) * 0.4;
  }
  const n = Math.sqrt(1 + (v * v / (9.80665 * radius)) ** 2);
  // Past about sixty-five degrees the sum runs away — every extra knot the
  // stall demands buys the bank that demands the next one — which is the
  // arithmetic saying this ship cannot hold a circle that small at all. The
  // ballasted nineteen-metre bottoms out near a 120 m radius, so a thermal
  // narrower than a quarter of a kilometre is no use to it whatever it says on
  // the vario. Radii it cannot fly are dropped rather than flown badly.
  if (n > 2.4 || v > spec.vne * 0.62) return null;
  return v;
}

function climbPolicies(ctx, def, spec, survey, marker) {
  const book = polar(spec);
  const out = [];
  // Only sites that beat the ship's own sink are worth flying to, only a few of
  // those, and only ones the ship can actually GET to: a column standing on
  // ground higher than the marker, half a kilometre away, is not a place a
  // glider goes — it is a hill it flies into. The marker's own patch of air is
  // always a candidate, because standing still and working what is here is what
  // a ridge task asks for.
  const here = survey.sites.find((s) => s.distance < 90);
  const reachable = pickSites(survey, 4).filter(
    (s) => s.ground + 80 < marker.y - s.distance / (book.bestLD * 0.8)
  );
  const picked = [];
  for (const s of [here, ...reachable]) if (s && !picked.includes(s)) picked.push(s);
  for (const site of picked) {
    const centre = new THREE.Vector3(site.x, Math.max(site.ground + 120, marker.y - site.distance / (book.bestLD * 0.8)), site.z);
    const band = bandAxis(ctx, spec, site, site.ground + 260);
    // Radii the ship can actually hold, not just ones a thermal is wide enough
    // for. A 240 m circle inside a 300 m column spends most of itself in the
    // weak outer air and some of it in the sink collar — measured, that was the
    // whole reason a 350 m climb in 5.6 m/s of lift took five and a half
    // minutes. At best-sink speed and sixty-three degrees the ballasted ship
    // turns inside sixty metres, so the tight circles belong on the list.
    {
      for (const radius of [110, 140, 180, 240, 320]) {
        const speed = circlingSpeed(spec, radius);
        if (speed === null) continue;
        out.push({
          kind: 'climb',
          type: 'orbit',
          centre,
          radius,
          lead: 0.95,
          speed: Math.round(speed),
          transitSpeed: Math.round(book.bestLDSpeed),
          bankMax: 1.1,
          brakes: false,
          clearance: 90,
          site,
          label: `orbit ${Math.round(site.distance)} m out · r${radius}`,
        });
      }
      // A face is beaten, not circled: half of a circle over a ridge is spent in
      // the sink behind it. Which axis to run is either the one the lift itself
      // stays strong along, or — on a map with ridge lift at all — the contour,
      // which is where the slope keeps pushing air up at the same rate.
      // Always try the contour. A sixty-second window is too short for this
      // ship to centre a thermal — measured, it loses height trying — so the
      // beat along a face or a convergence line is the whole answer, and it
      // has to be on the list whether or not the region declares ridge lift.
      // Chicago's lake breeze is a band like any other.
      // The way the author pointed the hoop, always: over Chicago the ground
      // is flat, so contourAt has no slope to read and answers due east —
      // straight out over the lake and its 1.9 m/s of sink. The marker heading
      // is the one piece of data that knows which way the band runs.
      const along = THREE.MathUtils.degToRad(def.marker.heading);
      const axes = [{ x: Math.sin(along), z: -Math.cos(along) }, contourAt(ctx, site)];
      if (band.banded) axes.push(band.axis);
      for (const axis of axes) {
        for (const half of [420, 700, 1100]) {
          out.push({
            kind: 'climb',
            type: 'beat',
            centre,
            radius: 200,
            ends: [
              { x: site.x + axis.x * half, z: site.z + axis.z * half },
              { x: site.x - axis.x * half, z: site.z - axis.z * half },
            ],
            speed: Math.round(circlingSpeed(spec, 320) ?? book.bestLDSpeed),
            transitSpeed: Math.round(book.bestLDSpeed),
            bankMax: 1.15,
            brakes: false,
            clearance: 90,
            site,
            label: `beat ${Math.round(site.distance)} m out · ±${half}`,
          });
        }
      }
    }
  }
  return out;
}

function lowpassPolicies(def, spec) {
  const out = [];
  const book = polar(spec);
  const heading = THREE.MathUtils.degToRad(def.marker.heading);
  // Duplicates would only fly the same line twice: on a draggy ship min sink
  // and best glide round to the same number.
  const speeds = [...new Set([book.minSinkSpeed * 1.05, book.bestLDSpeed, book.bestLDSpeed * 1.3].map(Math.round))];
  // Including decks that only just clear the ground: a ballasted ship holding a
  // hard deck over a valley floor has nowhere to put a mistake, and a pass that
  // survives at 60 m and scores badly still says the task is finishable.
  for (const deck of [10, 16, 24, 34, 44, 60, 80]) {
    if (deck > def.ceiling * 0.95) continue;
    for (const speed of speeds) {
      {
        out.push({
          kind: 'low',
          deck,
          speed,
          heading,
          clearance: 0,
          spread: 0.7,
          bankMax: 0.7,
          label: `deck ${deck} m · ${speed} m/s`,
        });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------- the maths ---
const round = (v, to) => Math.round(v / to) * to;
/** Clocks always round up: a limit rounded down is a limit somebody misses by a second. */
const roundUp = (v, to) => Math.ceil(v / to) * to;

/** Seconds ladder off the anchor run, with the rungs kept apart. */
function timedLadder(best, ladder) {
  const to = best > 240 ? 10 : best > 90 ? 5 : 1;
  const gold = round(best * ladder.gold, to);
  const silver = Math.max(gold + to, round(best * ladder.silver, to));
  const bronze = Math.max(silver + to, round(best * ladder.bronze, to));
  // Finishing and bronzing must stay different events, so the clock sits a
  // clear margin past bronze rather than on top of it — but nothing in the game
  // runs longer than ninety seconds, and that cap wins. A course whose bronze
  // will not fit underneath it is a course with a gate too many, and the caller
  // says so rather than quietly shipping a limit nobody can meet.
  const limit = Math.min(SLALOM_CAP, Math.max(roundUp(best * ladder.limit, to), roundUp(bronze * 1.25, to)));
  // The cap is the hard constraint, so the ladder gets squeezed under it rather
  // than the other way round: a bronze that would land past ninety seconds is
  // pulled back to just inside. Only when that would put it on top of silver is
  // the course actually too long, and then the caller says so.
  const fitted = Math.min(bronze, limit - to);
  return { medals: [fitted, silver, gold], limit, tooLong: fitted <= silver };
}

/**
 * Quantity ladder for the windowed three, where more is better and the window
 * is fixed. Anchored under the best measured yield rather than over it, and the
 * rungs are held apart so a task with a narrow spread reads as three rungs
 * rather than three names for the same number.
 */
function yieldLadder(best, unit) {
  const to = unit === 'count' ? 1 : best > 2000 ? 100 : best > 400 ? 10 : 5;
  const gold = Math.max(to, round(best * YIELD_LADDER.gold, to));
  const silver = Math.min(gold - to, round(best * YIELD_LADDER.silver, to));
  const bronze = Math.min(silver - to, round(best * YIELD_LADDER.bronze, to));
  return {
    medals: [bronze, silver, gold],
    limit: null,
    // Three rungs need somewhere to live. A roll counter that tops out at two
    // cannot carry a ladder, and saying so beats shipping bronze = silver.
    tight: bronze < (unit === 'count' ? 1 : to),
  };
}

// ------------------------------------------------------------ the report ---
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));
const problems = [];
const proposals = {};

for (const mapId of MAPS) {
  if (!REGIONS[mapId]) {
    console.error(`unknown region ${mapId}`);
    process.exit(1);
  }
  const ctx = await loadRegion(mapId);
  const defs = (CHALLENGES[mapId] ?? []).filter((d) => !ONLY || d.id === ONLY);
  if (!defs.length) continue;

  if (!AS_JSON) {
    console.log(`\n${'='.repeat(78)}`);
    console.log(`${ctx.region.name} — ${defs.length} challenges · ${TIME_OF_DAY} · ${ctx.air.thermals.length} thermals`);
    console.log('='.repeat(78));
  }

  for (const def of defs) {
    const spec = shipFor(def);
    const book = polar(spec);
    const marker = ctx.challenges.markers.find((m) => m.def === def).position;
    const lines = [];
    const note = (s) => lines.push(s);

    note(`\n── ${def.name} (${def.id}) ──`);
    note(`   ${def.type} · ${spec.name} · best L/D ${fmt(book.bestLD)} at ${fmt(book.bestLDSpeed, 0)} m/s · min sink ${fmt(book.minSink, 2)} m/s`);

    // ---- the site ---------------------------------------------------------
    let policies;
    let guide;
    let survey = null;
    if (def.type === 'height') {
      survey = surveyLift(ctx, spec, marker, { radius: 2600, step: 130, heights: [0, 200, 400, 700] });
      const here = survey.sites.find((s2) => s2.distance < 120) ?? survey.best;
      note(`   air at the marker: ${fmt(here?.mean, 2)} m/s · best within 2.6 km: ${fmt(survey.best?.mean, 2)} m/s at ${fmt(survey.best?.distance, 0)} m`);
      note(`   the ship sinks at ${fmt(survey.circling, 2)} m/s circling, so net there is ${fmt(survey.best?.net, 2)} m/s`);
      for (const site of survey.sites.slice(0, 1).concat(pickSites(survey, 2))) {
        const ll = toLatLon(ctx, site);
        note(`   lift at ${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}: ${fmt(site.mean, 2)} m/s mean, ${fmt(site.worst, 2)} m/s at its weakest, ${fmt(site.distance, 0)} m out`);
      }
      if ((survey.best?.net ?? -1) <= 0) {
        problems.push(`${def.id}: no air within 2.6 km of the marker beats the ${spec.name}'s own sink — the window cannot be climbed`);
      }
      note(`   ${def.window} s at that net is ${fmt((survey.best?.net ?? 0) * def.window, 0)} m if it were all circling`);
      policies = climbPolicies(ctx, def, spec, survey, marker);
      guide = climbGuide;
    } else if (def.type === 'slalom') {
      // The arithmetic budget, before anything is flown: what the line costs at
      // best glide against what the marker hands you. Being short here does not
      // prove the task impossible — there may be lift on the line — but it is
      // the first thing to look at when every run runs out of height.
      const points = def.gates.map((gt) => ({ ...ctx.world.toLocal(gt.lat, gt.lon), agl: gt.agl, name: gt.name }));
      let length = 0;
      let prev = { x: marker.x, z: marker.z };
      for (const pt of points) {
        length += Math.hypot(pt.x - prev.x, pt.z - prev.z);
        prev = pt;
      }
      const last = points[points.length - 1];
      const lastY = ctx.hf.heightAt(last.x, last.z) + last.agl;
      const budget = marker.y - lastY;
      const cost = length / book.bestLD;
      note(`   line ${fmt(length / 1000, 2)} km · costs ${fmt(cost, 0)} m at best glide · the course gives ${fmt(budget, 0)} m`);
      // Whether the steepest leg is steeper than the ship can glide, and
      // whether the straight line between two points goes through a tower.
      for (const bad of blockedLegs(ctx, def, marker, points)) note(`   → ${bad}`);
      if (cost > budget) note(`   → short by ${fmt(cost - budget, 0)} m on the glide alone: it has to come off the air`);
      policies = coursePolicies(def, spec);
      guide = courseGuide;
    } else if (def.type === 'distance') {
      policies = dashPolicies(def, spec);
      guide = dashGuide;
      note(`   ${def.window} s; at best glide from ${fmt(marker.y - ctx.hf.heightAt(marker.x, marker.z), 0)} m over the ground the still-air reach is ${fmt(((marker.y - ctx.hf.heightAt(marker.x, marker.z)) * book.bestLD) / 1000, 2)} km`);
    } else {
      policies = deckPolicies(spec);
      guide = deckGuide;
      const line = ctx.challenges.markers.find((m) => m.def === def).line;
      const entry = entrySpeed(def, spec);
      note(
        `   ${def.window} s under ${line.ceiling} m agl, inside ${line.width} m of a ${fmt(line.length / 1000, 2)} km line`
      );
      // A corridor shorter than the window can cover is a task that runs out of
      // ground before it runs out of clock, which caps the score at something
      // no ladder can be hung off.
      const reach = entry * def.window;
      note(`   ${fmt(entry, 0)} m/s for the whole window would cover ${fmt(reach / 1000, 2)} km of it`);
      if (line.length < reach * 0.55) {
        problems.push(
          `${def.id}: the corridor is ${fmt(line.length / 1000, 2)} km and the window reaches ${fmt(reach / 1000, 2)} km — the line runs out mid-run`
        );
      }
    }

    // ---- fly it -----------------------------------------------------------
    if (POLICY) policies = policies.filter((p) => p.label.includes(POLICY));
    const results = policies.map((p) => fly(ctx, def, p, guide));
    // Sorted so that done[0] is the BEST run, which is not the smallest number
    // for three of the four types: a distance task's best line is its longest.
    // Getting this backwards anchored every windowed ladder on the worst run
    // anybody flew, and reported it as the best.
    const better = TYPES[def.type].wins === 'high' ? (a, b) => b.value - a.value : (a, b) => a.value - b.value;
    const done = results.filter((r) => r.finished).sort(better);
    const anchor = done[0] ?? null;
    const failures = {};
    for (const r of results) if (!r.finished) failures[r.reason] = (failures[r.reason] ?? 0) + 1;

    note(`   flew ${results.length} lines · ${done.length} finished${Object.keys(failures).length ? ` · ${Object.entries(failures).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`);
    if (!done.length) {
      problems.push(`${def.id}: not one of ${results.length} lines finished — the challenge is not completable as authored`);
      note('   !! NOT COMPLETABLE as authored');
      // Longest-lived first. When nothing finished, the six lines that got
      // nearest are the diagnosis and the six that died first are noise — and
      // policy order puts the slowest speed at the top, which is neither.
      if (VERBOSE) {
        for (const r of [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 8)) {
          note(`      ${r.policy.label}: ${r.reason}${r.where ? ` at ${r.where}` : ''} after ${fmt(r.seconds)} s${r.progress ? ` (${r.progress})` : ''}`);
        }
      }
      // The run that got furthest, said out loud. A challenge nobody finished
      // is the one place a trace is most worth having, and printing only the
      // winner's meant --trace went silent exactly when it was needed.
      if (TRACE) {
        const nearest = [...results].sort((a, b) => b.seconds - a.seconds)[0];
        note(`   the longest line was ${nearest.policy.label} — ${nearest.reason} after ${fmt(nearest.seconds)} s`);
        note(nearest.trace.join('\n'));
      }
      console.log(lines.join('\n'));
      continue;
    }

    const unit = { time: 's', height: 'm', distance: 'm' }[challengeMetric(def)];
    const median = done[Math.floor(done.length / 2)];
    note(`   best ${fmt(anchor.value)} ${unit} (${anchor.policy.label})`);
    note(`   median finish ${fmt(median.value)} ${unit} · worst ${fmt(done[done.length - 1].value)} ${unit}`);
    if (VERBOSE) {
      for (const r of results.filter((x) => !x.finished).slice(0, 6)) {
        note(`      failed: ${r.policy.label} — ${r.reason}${r.where ? ` at ${r.where}` : ''} after ${fmt(r.seconds)} s${r.progress ? ` (${r.progress})` : ''}`);
      }
      for (const r of done.slice(0, 8)) {
        note(`      ${fmt(r.value)} ${unit}  ${r.policy.label}  (min AGL ${fmt(r.minAgl, 0)} m, peak ${fmt(r.peakSpeed, 0)} m/s)`);
      }
    }
    if (TRACE) note(anchor.trace.join('\n'));

    // ---- the ladder -------------------------------------------------------
    const windowed = TYPES[def.type].windowed;
    const proposal = windowed
      ? yieldLadder(anchor.value, challengeMetric(def))
      : timedLadder(anchor.value, LADDER);
    proposals[def.id] = proposal;

    if (proposal.tooLong) {
      problems.push(
        `${def.id}: the best line takes ${fmt(anchor.value)} s, so bronze lands at ${proposal.medals[0]} s and there is no room under the ninety second cap — the course wants a gate taken off it`
      );
    }
    if (proposal.tight) {
      problems.push(
        `${def.id}: the best the tool managed in ${def.window} s is ${fmt(anchor.value)} — too little to hang three rungs off`
      );
    }
    const [b, s2, g] = proposal.medals;
    const cur = def.medals;
    note(`   proposed  bronze ${b} · silver ${s2} · gold ${g}${proposal.limit ? ` · limit ${proposal.limit}` : ''}`);
    note(`   current   bronze ${cur[0]} · silver ${cur[1]} · gold ${cur[2]}${def.limit ? ` · limit ${def.limit}` : ''}`);

    // The table as it stands, judged against what was just measured. These are
    // the failures that make a ladder meaningless rather than merely wrong.
    if (windowed) {
      if (!(cur[0] < cur[1] && cur[1] < cur[2])) {
        problems.push(`${def.id}: the ladder does not climb — bronze ${cur[0]}, silver ${cur[1]}, gold ${cur[2]}`);
      }
      if (anchor.value < cur[2]) {
        problems.push(`${def.id}: gold (${cur[2]}) is more than the best the tool managed (${fmt(anchor.value)}) — unreachable`);
      }
    } else {
      if (def.limit > 90) problems.push(`${def.id}: a limit of ${def.limit} s breaks the ninety second cap`);
      if (cur[0] >= def.limit) problems.push(`${def.id}: bronze (${cur[0]}) is not under the fail limit (${def.limit}) — finishing and bronzing are the same event`);
      if (anchor.value > def.limit) problems.push(`${def.id}: the best line takes ${fmt(anchor.value)} s and the limit is ${def.limit} s — nobody finishes`);
      if (anchor.value > cur[2]) problems.push(`${def.id}: gold (${cur[2]} s) is quicker than the best line flown (${fmt(anchor.value)} s) — unreachable`);
    }
    const medal = medalFor(def, anchor.value);
    note(`   the best line flown scores ${['nothing', 'bronze', 'silver', 'gold'][medal]} against the table as it stands`);
    console.log(AS_JSON ? '' : lines.join('\n'));
  }
}

if (AS_JSON) {
  console.log(JSON.stringify(proposals, null, 2));
} else {
  console.log(`\n${'='.repeat(78)}`);
  if (problems.length) {
    console.log(`${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ! ${p}`);
  } else {
    console.log('Every challenge finishes, and every ladder has three rungs under its limit.');
  }
}
process.exit(problems.length ? 1 : 0);
