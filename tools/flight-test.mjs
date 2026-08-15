/**
 * Flies every ship in the roster and measures what it actually does.
 *
 * The menu card and the HUD quote fleet.js polar(), which is arithmetic. This
 * flies the real model instead and prints both, so a spec that reads well but
 * does not fly shows up as a disagreement rather than as a nice card.
 *
 *   node tools/flight-test.mjs
 */
import * as THREE from '../vendor/three.module.js';
import { Air, Glider } from '../src/flight.js';
import { FLEET, polar, wingSpan } from '../src/fleet.js';

const hf = {
  halfSize: 19000,
  minHeight: 500,
  maxHeight: 4200,
  heightAt: () => 500,
  normalAt: (x, z, s, out = new THREE.Vector3()) => out.set(0, 1, 0),
  isWater: () => false,
};
const air = new Air(hf, { sunDir: new THREE.Vector3(0, 1, 0) });
air.thermals = [];
air.windSpeed = 0;
// A polar is a still-air measurement. Left alone the air model adds its
// background sink and its bit of texture to every number below.
air.sample = (pos, out = new THREE.Vector3()) => out.set(0, 0, 0);

const dt = 1 / 120;
const G = 9.80665;
const RHO0 = 1.225;
const problems = [];
// High enough that the fastest ship at full forward stick still has room for a
// forty-second run, and every measurement is corrected back to sea level.
const START = 7000;

function sim(g, input, seconds) {
  const full = { roll: 0, pitch: 0, brake: 0, boost: false, ...input };
  for (let i = 0; i < seconds / dt; i++) g.update(dt, full);
}

/**
 * Hold a stick position and measure the glide.
 *
 * The phugoid in this model is barely damped — a real one is not damped much
 * either — so height alone swings by tens of metres and never settles. Total
 * energy height (altitude plus the height the airspeed is worth) is immune to
 * that trade and leaves only what drag is actually taking.
 */
function glideAt(g, pitch) {
  g.reset(new THREE.Vector3(0, START, 0), 0, g.spec.trimSpeed);
  sim(g, { pitch }, 20);
  const energy = () => g.position.y + (g.airspeed * g.airspeed) / (2 * G);
  const e0 = energy();
  const y0 = g.position.y;
  const x0 = g.position.x;
  const z0 = g.position.z;
  const span = 18;
  let vSum = 0;
  let n = 0;
  for (let i = 0; i < span / dt; i++) {
    g.update(dt, { roll: 0, pitch, brake: 0, boost: false });
    vSum += g.airspeed;
    n++;
  }
  const rawSink = (e0 - energy()) / span;
  const alt = (y0 + g.position.y) / 2;
  // Same lift coefficient at sea level means the speed and the sink both scale
  // with the square root of the density ratio, so this is a conversion rather
  // than an approximation.
  const toSeaLevel = Math.sqrt(Air.density(alt) / RHO0);
  const ground = Math.hypot(g.position.x - x0, g.position.z - z0) / span;
  return {
    speed: (vSum / n) * toSeaLevel,
    sink: rawSink * toSeaLevel,
    ld: rawSink > 0.01 ? ground / rawSink : 0,
    alt,
  };
}

/**
 * The speed the model will actually settle at, at a given density: where the
 * lift coefficient trim asks for equals the one needed to hold the weight up.
 * Not the same as spec.trimSpeed away from sea level, because trim is written
 * against a speed rather than against a pressure.
 */
function trimSpeedAt(spec, rho) {
  const w = (spec.mass * G) / spec.wingArea;
  const clFor = (v) => {
    const bias = Math.max(-3.5, Math.min(5.0, (v - spec.trimSpeed) * spec.speedStability));
    return (spec.clSlope * (spec.trimAlphaDeg + bias) * Math.PI) / 180;
  };
  let lo = 5;
  let hi = spec.vne * 1.3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (clFor(mid) * rho * mid * mid * 0.5 < w) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Time and radius of a full circle at the stop, pulling to hold the turn. */
function turn360(g) {
  g.reset(new THREE.Vector3(0, START, 0), 0, g.spec.trimSpeed);
  sim(g, {}, 4);
  const y0 = g.position.y;
  let t = 0;
  let turned = 0;
  let prev = g.headingDeg;
  while (t < 120) {
    sim(g, { roll: 1, pitch: 0.3 }, dt);
    t += dt;
    let d = g.headingDeg - prev;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    turned += d;
    prev = g.headingDeg;
    if (Math.abs(turned) >= 360) break;
  }
  const ground = Math.hypot(g.velocity.x, g.velocity.z);
  return { time: t, radius: (ground * t) / (2 * Math.PI), lost: y0 - g.position.y, bank: g.bankDeg };
}

const f1 = (v) => v.toFixed(1).padStart(5);
const f0 = (v) => v.toFixed(0).padStart(4);

for (const spec of FLEET) {
  const g = new Glider(air, spec);

  // ---- hands off, low down where the card's numbers are quoted -----------
  g.reset(new THREE.Vector3(0, 400, 0), 0, spec.trimSpeed);
  sim(g, {}, 24);
  let vSum = 0;
  let n = 0;
  for (let i = 0; i < 24 / dt; i++) {
    g.update(dt, { roll: 0, pitch: 0, brake: 0, boost: false });
    vSum += g.airspeed;
    n++;
  }
  const trimmed = vSum / n;
  const expected = trimSpeedAt(spec, Air.density(g.position.y));

  // ---- polar -------------------------------------------------------------
  let best = { ld: 0 };
  let least = { sink: Infinity };
  const points = [];
  for (let i = -10; i <= 10; i++) {
    const p = glideAt(g, i / 10);
    points.push(p);
    if (p.ld > best.ld) best = p;
    if (p.sink < least.sink) least = p;
  }
  const book = polar(spec);
  const circle = turn360(g);

  console.log(`\n${spec.name}  —  ${spec.kind}     (flown numbers corrected to sea level)`);
  console.log(
    `  hands off      ${f1(trimmed)} m/s  (${f0(trimmed * 3.6)} km/h)   trim equilibrium ${f1(expected)}`
  );
  console.log(
    `  best glide     ${f1(best.ld)} : 1  at ${f1(best.speed)} m/s      book ${f1(book.bestLD)} : 1 at ${f1(book.bestLDSpeed)}`
  );
  console.log(
    `  min sink       ${f1(least.sink)} m/s at ${f1(least.speed)} m/s   book ${f1(book.minSink)} at ${f1(book.minSinkSpeed)}`
  );
  console.log(
    `  360 at full stick  ${f1(circle.time)} s   radius ${f0(circle.radius)} m   bank ${f0(circle.bank)}   height lost ${f0(circle.lost)} m`
  );
  console.log(
    `  speed range    ${f1(points[20].speed)} .. ${f1(points[0].speed)} m/s   vne ${spec.vne}   stall ${f1(book.stallSpeed)}`
  );
  console.log(
    `  span ${f1(wingSpan(spec))} m   ${f0(spec.mass)} kg   ${f1((spec.mass * G) / spec.wingArea)} N/m^2 wing loading`
  );

  const fail = (why) => problems.push(`${spec.name}: ${why}`);
  // Weak-day lift in this game runs about 2.6 m/s before the background sink
  // is taken off it. A ship that cannot climb in that cannot be flown.
  if (!(least.sink < 2.0)) fail(`min sink ${least.sink.toFixed(2)} m/s — cannot stay up`);
  if (!(best.ld > 8)) fail(`best glide only ${best.ld.toFixed(1)}:1`);
  if (Math.abs(trimmed - expected) > expected * 0.06) {
    fail(`settles at ${trimmed.toFixed(1)} m/s, its own trim algebra says ${expected.toFixed(1)}`);
  }
  if (Math.abs(trimSpeedAt(spec, RHO0) - spec.trimSpeed) > spec.trimSpeed * 0.06) {
    fail(`trimAlphaDeg holds ${trimSpeedAt(spec, RHO0).toFixed(1)} m/s, not the ${spec.trimSpeed} it claims`);
  }
  if (Math.abs(best.ld - book.bestLD) > book.bestLD * 0.12) {
    fail(`flown glide ${best.ld.toFixed(1)}:1 disagrees with the quoted ${book.bestLD.toFixed(1)}:1`);
  }
  if (Math.abs(least.sink - book.minSink) > book.minSink * 0.18) {
    fail(`flown min sink ${least.sink.toFixed(2)} disagrees with the quoted ${book.minSink.toFixed(2)}`);
  }
  if (!(circle.radius < 400 && circle.time < 60)) fail(`360 takes ${circle.time.toFixed(0)} s`);
  // The number in the name is the span, and the span is what the aspect ratio
  // and the wing area already say it is. A ship cannot be called something the
  // rest of its own numbers contradict.
  const claimed = Number(spec.name.match(/\d+/)?.[0]);
  if (Math.abs(claimed - wingSpan(spec)) > 1) {
    fail(`called ${spec.name} but spans ${wingSpan(spec).toFixed(1)} m`);
  }
  // The mesh is built from look.span as a half-span, tip cap included.
  if (Math.abs(spec.look.span * 2 - wingSpan(spec)) > 0.6) {
    fail(`drawn ${(spec.look.span * 2).toFixed(1)} m across but flies as ${wingSpan(spec).toFixed(1)} m`);
  }
  if (!isFinite(g.position.y)) fail('came apart numerically');
}

// ---- the handling checks the flight model has always had -------------------
const g = new Glider(air, FLEET[0]);
function show(l) {
  console.log(
    l.padEnd(30),
    'V',
    f1(g.airspeed),
    'bank',
    f0(g.bankDeg),
    'hdg',
    f0(g.headingDeg),
    'alt',
    f0(g.position.y),
    'g',
    g.loadFactor.toFixed(2)
  );
}
console.log(`\nhandling — ${FLEET[0].name}`);
g.reset(new THREE.Vector3(0, 3000, 0), 0, 34);
sim(g, {}, 6);
show('trimmed, heading 0');
sim(g, { roll: 1 }, 2);
show('full right stick, 2 s');
sim(g, { roll: 1 }, 8);
show('...held 8 s more');
sim(g, {}, 4);
show('stick released 4 s');
g.reset(new THREE.Vector3(0, 3000, 0), 0, 34);
sim(g, {}, 4);
sim(g, { roll: -1 }, 10);
show('full LEFT stick 10 s');
g.reset(new THREE.Vector3(0, 3000, 0), 90, 45);
sim(g, {}, 3);
sim(g, { roll: 0.55, pitch: 0.25 }, 14);
show('coordinated turn 14 s');
if (g.bankDeg < 20) problems.push('Vela 20: right stick did not produce a right bank');

if (problems.length) {
  console.log('\nFAILURES:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nall good');
