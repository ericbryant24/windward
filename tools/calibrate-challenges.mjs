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
 *      choice, motor or no motor — and keeps every outcome, because the spread
 *      between the best and the worst run is what says whether a ladder has
 *      room in it.
 *   4. Proposes bronze, silver, gold and the fail limit off the best SOARED
 *      run, and prints enough of the working for a human to disagree.
 *
 * Anchoring on the best run flown WITHOUT the motor is deliberate. Every ship
 * has thrust and a player may hold the button down; a ladder measured off a
 * motor run would quietly make the motor compulsory, which is the opposite of
 * the deal ("the motor as the margin rather than the entry fee"). Where a task
 * genuinely cannot be flown without thrust, the report says so and anchors on
 * the powered run instead.
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
import { Challenges, medalFor, challengeMetric, shipFor } from '../src/challenges.js';
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

/** The physics step the game runs at. Anything coarser is a different game. */
const TICK = 1 / 120;

/**
 * How long a run is allowed to take while being measured, which is not the
 * challenge's own limit: the limit is one of the numbers being calibrated, and
 * flying against it would only ever confirm whatever it already says. Runs are
 * flown against a generous horizon and the clock is proposed afterwards.
 */
const horizonFor = (def) => clamp(def.limit * 2.2, 180, 2400);

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
/**
 * Climbing is looser on purpose. A gate is in a fixed place and a thermal is
 * not: centring one costs a human turns that the tool, which is handed the
 * column's exact address by the survey, never spends.
 */
const CLIMB_LADDER = { gold: 1.22, silver: 1.5, bronze: 1.85, limit: 2.5 };
/**
 * A low pass is scored between two fixed points rather than off one: the lowest
 * mean height anybody managed, and the ceiling the task sets. Gold sits just
 * above the first, bronze comfortably below the second — because a bronze at
 * the ceiling would be handed out for merely holding the pass, and a gold at
 * the measured floor would want a run with no margin in it at all.
 */
const LOWPASS = { goldPad: [1.15, 4], bronzeOfCeiling: 0.8, minGap: 5 };

/**
 * Every challenge starts at this multiple of its ship's trim speed — read out
 * of game.js rather than copied, because a calibration flown from a different
 * entry speed than the game uses is a calibration of nothing.
 */
const START_SPEED = await readStartSpeed();

async function readStartSpeed() {
  const src = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const m = src.match(/START_SPEED\s*=\s*([\d.]+)/);
  if (!m) {
    console.error('! could not find START_SPEED in src/game.js — falling back to 1.33');
    return 1.33;
  }
  return Number(m[1]);
}

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

  /** @returns the control input for this step, aimed at `target`. */
  fly(dt, target, speedTarget, { boost = false } = {}) {
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
    const bankCmd = clamp(err * 2.1, -bankMax, bankMax);
    const roll = clamp((bankCmd - bank) * 1.9 - bankRate * 0.32, -1, 1);

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
    const speedErr = clamp((g.airspeed - speedTarget) * 0.02, -0.35, holdOnStick ? 0.3 : 0);
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
    const brake = holdOnStick
      ? vneGuard
      : Math.max(vneGuard, steeper, clamp((g.airspeed - speedTarget * 1.05) / (speedTarget * 0.3), 0, 1));
    return { roll, pitch, brake, boost: boost && g.boost > 0.05 };
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
  glider.reset(spawn.position, spawn.heading, spec.trimSpeed * START_SPEED);

  air.time = 0;
  challenges.abort();
  const run = challenges.arm(def);
  // See horizonFor: the authored clock is an output of this tool, not an input.
  const horizon = horizonFor(def);
  run.limit = horizon;
  const pilot = new Pilot(glider, policy);
  const state = {
    ctx,
    def,
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
      trace.push(`      t${state.t.toFixed(0).padStart(4)}s  ${(glider.position.y).toFixed(0).padStart(5)} m (${agl.toFixed(0).padStart(4)} agl)  ${glider.airspeed.toFixed(0).padStart(3)} m/s  ${(challenges.hudState()?.progress ?? '').padEnd(12)} boost ${(glider.boost * 100).toFixed(0)}%`);
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
  const progress = challenges.hudState()?.progress ?? null;
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
    gain: def.type === 'climb' ? glider.position.y - state.startY : null,
    held: def.type === 'lowpass' ? (challenges.active?.hold ?? state.bestHold ?? 0) : null,
  };
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
  } else if (run?.def.type === 'collect') {
    [target, next] = pickTarget(state, run);
    // PICKUP_RADIUS in challenges.js: what counts as having collected one.
    state.capture = 34;
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

  // Cut the corner. Flying at each point in turn and only then looking at the
  // next one is what makes a machine slower than a person round a course: the
  // human is already leaning into the following gate. The aim point leans with
  // the leg ahead until close in, where it snaps back to the thing itself so
  // that a 34 m pickup is still actually collected.
  // Only where there is room for it. Leaning into the next leg early is free
  // speed over open ground and suicide in a canyon, where the inside of the
  // corner is a building — so a gate course flies its own line and lets the
  // overshoot happen, and a collect over the parks cuts.
  if (next && run?.def.type === 'collect') {
    const d = Math.hypot(target.x - g.position.x, target.z - g.position.z);
    const lean = clamp((d - 90) / 320, 0, 1) * 0.3;
    if (lean > 0) target = target.clone().lerp(next, lean);
  }
  // A gate flown or a pickup taken ends any go-around that was in progress and
  // starts a new leg. Watching the challenge's own progress rather than how far
  // the aim point jumped is what makes that exact: two pickups can be a hundred
  // metres apart, and inheriting the last one's go-around throws the next away.
  const progress = challenges.hudState()?.progress;
  if (progress !== state.progress) {
    state.progress = progress;
    state.escape = null;
  }
  target = avoid(state, reattack(state, target, run?.def.type === 'slalom' ? challenges.world.gates[run.gateIndex] : null));
  return state.pilot.fly(dt, target, cornerSpeed(state, next), { boost: wantsBoost(state, target) });
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
  for (const [yaw, lift] of [[0, 70], [0.26, 30], [-0.26, 30], [0, 160], [0.5, 40], [-0.5, 40], [0.9, 60], [-0.9, 60]]) {
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
 * When the motor earns its noise: below the line to the next thing, or slower
 * than the policy wants to be flying. Policies that fly unpowered never call it.
 */
function wantsBoost(state, target) {
  if (!state.policy.boost) return false;
  const g = state.glider;
  if (g.airspeed < state.policy.speed * 0.94) return true;
  const dy = target.y - g.position.y;
  const D = Math.hypot(target.x - g.position.x, target.z - g.position.z);
  return dy > -D / 22;
}

/** Circling: chase a point around the rim of the lift, a little ahead of the ship. */
function orbitGuide(state, dt) {
  const g = state.glider;
  const p = state.policy;
  const ang = Math.atan2(g.position.z - p.centre.z, g.position.x - p.centre.x) + p.lead;
  const target = new THREE.Vector3(
    p.centre.x + Math.cos(ang) * p.radius,
    g.position.y + 18,
    p.centre.z + Math.sin(ang) * p.radius
  );
  return state.pilot.fly(dt, avoid(state, target), p.speed, { boost: p.boost });
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
  return state.pilot.fly(dt, avoid(state, target), p.speed, { boost: p.boost });
}

/**
 * The low pass: hold a hard deck over ground that is not flat.
 *
 * The task is to be low, so the target sits at a fixed height over the HIGHEST
 * ground within the next few seconds rather than over the ground underneath —
 * a trench floor that rises at 1 in 20 will otherwise fly the ship into itself.
 * The heading is chosen the same way a pilot reads a valley: of the headings
 * near the one the task runs on, take the one whose ground stays lowest.
 */
function lowGuide(state, dt) {
  const { hf } = state.ctx;
  const g = state.glider;
  const p = state.policy;
  const f = g.forward(new THREE.Vector3());
  const psi = Math.atan2(f.x, -f.z);
  const reach = Math.max(220, g.airspeed * 6);

  let bestHeading = p.heading;
  let bestScore = Infinity;
  for (let k = -4; k <= 4; k++) {
    const h = p.heading + (k / 4) * p.spread;
    // Only ever a small correction away from where the ship is pointed: a
    // sixty-degree change of mind at 40 m over a river is not a low pass.
    if (Math.abs(wrap(h - psi)) > 0.9) continue;
    let worst = -Infinity;
    for (let s = 0.35; s <= 1.001; s += 0.325) {
      const x = g.position.x + Math.sin(h) * reach * s;
      const z = g.position.z - Math.cos(h) * reach * s;
      worst = Math.max(worst, hf.heightAt(x, z));
    }
    const score = worst + Math.abs(wrap(h - p.heading)) * 40;
    if (score < bestScore) {
      bestScore = score;
      bestHeading = h;
    }
  }
  state.heading = bestHeading;

  let ahead = hf.heightAt(g.position.x, g.position.z);
  for (let s = 0.25; s <= 1.001; s += 0.25) {
    ahead = Math.max(ahead, hf.heightAt(g.position.x + Math.sin(bestHeading) * reach * s, g.position.z - Math.cos(bestHeading) * reach * s));
  }
  const target = new THREE.Vector3(
    g.position.x + Math.sin(bestHeading) * reach,
    ahead + p.deck,
    g.position.z - Math.cos(bestHeading) * reach
  );
  // The ultralight holds a deck on the throttle, which is what it is for; the
  // sailplanes have to arrive with the height already spent.
  const low = g.position.y - hf.heightAt(g.position.x, g.position.z) < p.deck * 1.1;
  return state.pilot.fly(dt, avoid(state, target), p.speed, { boost: p.boost && low });
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
  if (!state.arrived && d > (p.kind === 'beat' ? 260 : p.radius * 1.35)) {
    const target = new THREE.Vector3(p.centre.x, Math.max(g.position.y, p.centre.y ?? g.position.y), p.centre.z);
    return state.pilot.fly(dt, avoid(state, target), p.transitSpeed, { boost: p.boost });
  }
  state.arrived = true;
  return p.kind === 'beat' ? beatGuide(state, dt) : orbitGuide(state, dt);
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
  // The same lift challenges.js applies when it arms a collect: a pickup is
  // never allowed to sit inside a roof, so the height flown to is not always
  // the height in the table.
  const at = (p) => {
    const y = hf.heightAt(p.x, p.z) + p.agl;
    const roof = def.type === 'collect' ? buildings?.topNear(p.x, p.z) ?? -Infinity : -Infinity;
    return { x: p.x, y: isFinite(roof) ? Math.max(y, roof + 25) : y, z: p.z };
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
  const orders = def.type === 'collect' ? ['authored', 'nearest'] : ['course'];
  for (const speed of speedLadder(spec)) {
    for (const bankMax of [1.0, 1.2, 1.4]) {
      for (const order of orders) {
        for (const boost of [false, true]) {
          out.push({ kind: 'course', speed, bankMax, order, boost, label: `${speed} m/s · ${Math.round((bankMax * 180) / Math.PI)}° · ${order}${boost ? ' · motor' : ''}` });
        }
      }
    }
  }
  return out;
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
    for (const boost of [false, true]) {
      for (const radius of [170, 240, 320]) {
        out.push({
          kind: 'climb',
          type: 'orbit',
          centre,
          radius,
          lead: 0.95,
          speed: Math.round(book.minSinkSpeed * 1.12),
          transitSpeed: Math.round(book.bestLDSpeed),
          bankMax: 1.1,
          brakes: false,
          clearance: 90,
          boost,
          site,
          label: `orbit ${Math.round(site.distance)} m out · r${radius}${boost ? ' · motor' : ''}`,
        });
      }
      // A face is beaten, not circled: half of a circle over a ridge is spent in
      // the sink behind it. Which axis to run is either the one the lift itself
      // stays strong along, or — on a map with ridge lift at all — the contour,
      // which is where the slope keeps pushing air up at the same rate.
      const axes = [];
      if (band.banded) axes.push(band.axis);
      if (ctx.region.air.ridgeLift) axes.push(contourAt(ctx, site));
      for (const axis of axes) {
        for (const half of [420, 700]) {
          out.push({
            kind: 'climb',
            type: 'beat',
            centre,
            radius: 200,
            ends: [
              { x: site.x + axis.x * half, z: site.z + axis.z * half },
              { x: site.x - axis.x * half, z: site.z - axis.z * half },
            ],
            speed: Math.round(book.minSinkSpeed * 1.2),
            transitSpeed: Math.round(book.bestLDSpeed),
            bankMax: 1.15,
            brakes: false,
            clearance: 90,
            boost,
            site,
            label: `beat ${Math.round(site.distance)} m out · ±${half}${boost ? ' · motor' : ''}`,
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
  for (const deck of [10, 16, 24, 34, 44]) {
    if (deck > def.ceiling * 0.95) continue;
    for (const speed of speeds) {
      for (const boost of [false, true]) {
        out.push({
          kind: 'low',
          deck,
          speed,
          heading,
          clearance: 0,
          spread: 0.7,
          bankMax: 0.7,
          boost,
          label: `deck ${deck} m · ${speed} m/s${boost ? ' · motor' : ''}`,
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
  // clear margin past bronze rather than on top of it.
  const limit = Math.max(roundUp(best * ladder.limit, to), roundUp(bronze * 1.25, to));
  return { medals: [bronze, silver, gold], limit };
}

function lowpassLadder(best, def, worstElapsed) {
  const gold = Math.max(4, Math.round(Math.max(best * LOWPASS.goldPad[0], best + LOWPASS.goldPad[1])));
  const bronze = Math.round(def.ceiling * LOWPASS.bronzeOfCeiling);
  const silver = Math.round((gold + bronze) / 2);
  // The clock only has to allow the hold plus the run-in and one spoiled pass.
  const limit = roundUp(Math.max(def.hold * 2.5, worstElapsed * 1.6), 5);
  return {
    medals: [bronze, silver, gold],
    limit,
    // Say so rather than quietly shuffling the numbers: if the best pass anybody
    // can fly is already most of the way to the ceiling, the rungs are on top of
    // each other and it is the ceiling that wants changing, not the ladder.
    tight: silver - gold < LOWPASS.minGap || bronze - silver < LOWPASS.minGap,
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
    if (def.type === 'climb' || def.type === 'lowpass') {
      survey = surveyLift(ctx, spec, marker, {
        radius: def.type === 'climb' ? 2600 : 900,
        step: def.type === 'climb' ? 130 : 90,
        heights: def.type === 'climb' ? [0, 200, 400, 700] : [0, 60],
      });
      const here = survey.sites.find((s) => s.distance < 120) ?? survey.best;
      note(`   air at the marker: ${fmt(here?.mean, 2)} m/s · best within ${def.type === 'climb' ? '2.6 km' : '900 m'}: ${fmt(survey.best?.mean, 2)} m/s at ${fmt(survey.best?.distance, 0)} m`);
      note(`   the ship sinks at ${fmt(survey.circling, 2)} m/s circling, so net there is ${fmt(survey.best?.net, 2)} m/s`);
      // Where the good air actually is, in the coordinates the table is written
      // in — so that moving a marker onto it is a copy rather than a hunt.
      for (const site of survey.sites.slice(0, 1).concat(pickSites(survey, 2))) {
        const ll = toLatLon(ctx, site);
        note(`   lift at ${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}: ${fmt(site.mean, 2)} m/s mean, ${fmt(site.worst, 2)} m/s at its weakest, ${fmt(site.distance, 0)} m out`);
      }
      if (def.type === 'climb' && (survey.best?.net ?? -1) <= 0) {
        problems.push(`${def.id}: no air within 2.6 km of the marker beats the ${spec.name}'s own sink — the task cannot be climbed`);
      }
    }

    if (def.type === 'slalom' || def.type === 'collect') {
      // The arithmetic budget, before anything is flown: what the line costs at
      // best glide against what the marker hands you. Being short here does not
      // prove the task impossible — there may be lift on the line — but it is
      // the first thing to look at when every run runs out of height.
      const points = def.type === 'slalom'
        ? def.gates.map((g) => ({ ...ctx.world.toLocal(g.lat, g.lon), agl: g.agl, name: g.name }))
        : def.picks.map((p, i) => ({ ...ctx.world.toLocal(p.lat, p.lon), agl: p.agl, name: `pickup ${i + 1}` }));
      let length = 0;
      let prev = { x: marker.x, z: marker.z };
      for (const p of points) {
        length += Math.hypot(p.x - prev.x, p.z - prev.z);
        prev = p;
      }
      const last = points[points.length - 1];
      const lastY = ctx.hf.heightAt(last.x, last.z) + last.agl;
      const budget = marker.y - lastY;
      const cost = length / book.bestLD;
      note(`   line ${fmt(length / 1000, 2)} km · costs ${fmt(cost, 0)} m at best glide · the course gives ${fmt(budget, 0)} m`);
      // Whether the steepest leg is steeper than the ship can glide, and
      // whether the straight line between two points goes through a tower. Both
      // are course-design errors rather than pilot errors, and neither shows up
      // as anything but a pile of identical crashes once you start flying.
      for (const bad of blockedLegs(ctx, def, marker, points)) note(`   → ${bad}`);
      if (cost > budget) note(`   → short by ${fmt(cost - budget, 0)} m on the glide alone: it has to come off the air or the motor`);
      policies = coursePolicies(def, spec);
      guide = courseGuide;
    } else if (def.type === 'climb') {
      policies = climbPolicies(ctx, def, spec, survey, marker);
      guide = climbGuide;
      note(`   asks for ${def.gain} m, which at that net is ${fmt(def.gain / Math.max(survey.best?.net ?? 0.01, 0.01), 0)} s of circling before any transit`);
    } else {
      policies = lowpassPolicies(def, spec);
      guide = lowGuide;
      note(`   hold ${def.hold} s under ${def.ceiling} m`);
    }

    // ---- fly it -----------------------------------------------------------
    const results = policies.map((p) => fly(ctx, def, p, guide));
    const done = results.filter((r) => r.finished).sort((a, b) => a.value - b.value);
    const soared = done.filter((r) => !r.policy.boost);
    const anchor = soared[0] ?? done[0] ?? null;
    const failures = {};
    for (const r of results) if (!r.finished) failures[r.reason] = (failures[r.reason] ?? 0) + 1;

    note(`   flew ${results.length} lines · ${done.length} finished${Object.keys(failures).length ? ` · ${Object.entries(failures).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`);
    if (!done.length) {
      problems.push(`${def.id}: not one of ${results.length} lines finished — the challenge is not completable as authored`);
      note('   !! NOT COMPLETABLE as authored');
      if (VERBOSE) for (const r of results.slice(0, 6)) note(`      ${r.policy.label}: ${r.reason}${r.where ? ` at ${r.where}` : ''} after ${fmt(r.seconds)} s${r.progress ? ` (${r.progress})` : ''}`);
      console.log(lines.join('\n'));
      continue;
    }

    const unit = challengeMetric(def) === 'height' ? 'm' : 's';
    const median = done[Math.floor(done.length / 2)];
    note(`   best ${fmt(anchor.value)} ${unit} (${anchor.policy.label})${soared.length ? '' : ' — only with the motor'}`);
    note(`   median finish ${fmt(median.value)} ${unit} · worst ${fmt(done[done.length - 1].value)} ${unit}`);
    if (soared.length && done[0] !== soared[0]) note(`   the motor is worth ${fmt(soared[0].value - done[0].value)} ${unit} here`);
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
    const proposal =
      def.type === 'lowpass'
        ? lowpassLadder(anchor.value, def, Math.max(...done.map((r) => r.seconds)))
        : timedLadder(anchor.value, def.type === 'climb' ? CLIMB_LADDER : LADDER);
    proposals[def.id] = proposal;

    if (proposal.tight) {
      problems.push(
        `${def.id}: the best pass flown is ${fmt(anchor.value)} m against a ${def.ceiling} m ceiling — there is not enough room between them for three rungs`
      );
    }
    const [b, s, g] = proposal.medals;
    const cur = def.medals;
    note(`   proposed  bronze ${b} · silver ${s} · gold ${g} · limit ${proposal.limit}`);
    note(`   current   bronze ${cur[0]} · silver ${cur[1]} · gold ${cur[2]} · limit ${def.limit}`);

    // The table as it stands, judged against what was just measured. These are
    // the failures that make a ladder meaningless rather than merely wrong.
    if (challengeMetric(def) === 'time') {
      if (cur[0] >= def.limit) problems.push(`${def.id}: bronze (${cur[0]}) is not under the fail limit (${def.limit}) — finishing and bronzing are the same event`);
      if (anchor.value > def.limit) problems.push(`${def.id}: the best line takes ${fmt(anchor.value)} s and the limit is ${def.limit} s — nobody finishes`);
      if (anchor.value > cur[2]) problems.push(`${def.id}: gold (${cur[2]} s) is quicker than the best line flown (${fmt(anchor.value)} s) — unreachable`);
    } else {
      if (cur[0] >= def.ceiling) problems.push(`${def.id}: bronze (${cur[0]} m) is at or above the ${def.ceiling} m ceiling — holding the pass bronzes it by itself`);
      if (anchor.value > cur[2]) problems.push(`${def.id}: gold (${cur[2]} m) is lower than the best pass flown (${fmt(anchor.value)} m) — unreachable`);
      if (anchor.seconds > def.limit) problems.push(`${def.id}: the best pass needed ${fmt(anchor.seconds)} s and the limit is ${def.limit} s`);
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
