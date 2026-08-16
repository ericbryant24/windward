/**
 * Flies every ship in the roster and measures what it actually does.
 *
 * The menu card and the HUD quote fleet.js polar(), which is arithmetic. This
 * flies the real model instead and prints both, so a spec that reads well but
 * does not fly shows up as a disagreement rather than as a nice card.
 *
 * The second half flies each ship off the top of its envelope: there is no
 * speed clamp any more, so a dive really does run away, and what the numbers
 * have to show is that it runs away at a rate a pilot can do something about.
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
// A working soaring height. It used to be seven kilometres, to give the old
// full-forward-stick sweep room to run; nothing dives on this bench any more,
// and up there the Javelin's true trim speed is past its own redline. Every
// measurement is corrected back to sea level regardless.
const START = 2500;

function sim(g, input, seconds) {
  const full = { roll: 0, pitch: 0, brake: 0, ...input };
  for (let i = 0; i < seconds / dt; i++) g.update(dt, full);
}

/**
 * Hold an angle of attack and measure the glide.
 *
 * A polar point IS an angle of attack: it fixes the lift coefficient, and the
 * speed and the sink follow from the wing loading. Holding one is also the only
 * way to sweep the whole range. The bench used to hold a stick position, which
 * works while the airframe's own stability can balance the elevator — true of
 * the gliders, and not remotely true of the Javelin, whose stick sweep never
 * got within 20 m/s of the speed its own minimum sink is at. Holding a SPEED
 * is worse still: chasing the ASI works the elevator continuously and the
 * induced drag of all that stirring shows up as a polar two points down.
 *
 * The phugoid in this model is barely damped — a real one is not damped much
 * either — so height alone swings by tens of metres and never settles. Total
 * energy height (altitude plus the height the airspeed is worth) is immune to
 * that trade and leaves only what drag is actually taking.
 */
function glideAt(g, alphaDeg) {
  const spec = g.spec;
  const target = THREE.MathUtils.degToRad(alphaDeg);
  // Launched at the speed that angle of attack asks for, rather than at trim.
  // The elevator can only hold an alpha the ship is already near: told to pull
  // to nine degrees from 100 m/s the Javelin does not slow down, it loops, and
  // twenty seconds later it is still nowhere near the number.
  const cl = spec.clSlope * target;
  const v = Math.sqrt((2 * spec.mass * G) / (spec.wingArea * Air.density(START) * cl));
  g.reset(new THREE.Vector3(0, START, 0), 0, v);
  const pilot = () => THREE.MathUtils.clamp((target - g.alpha) * 20, -1, 1);
  for (let i = 0; i < 20 / dt; i++) g.update(dt, { roll: 0, pitch: pilot(), brake: 0 });
  if (g.broken) return { speed: 0, sink: Infinity, ld: 0, alt: START, broken: true };
  const energy = () => g.position.y + (g.airspeed * g.airspeed) / (2 * G);
  const e0 = energy();
  const y0 = g.position.y;
  const x0 = g.position.x;
  const z0 = g.position.z;
  const span = 18;
  let vSum = 0;
  let n = 0;
  for (let i = 0; i < span / dt; i++) {
    g.update(dt, { roll: 0, pitch: pilot(), brake: 0 });
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
    broken: g.broken,
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
/**
 * A full circle, flown the way a pilot flies one.
 *
 * The stick asks for a bank ANGLE, so a turn is flown by putting it at the
 * fraction of full deflection that bank represents and leaving it there. Do
 * not pin it: past PIN_STICK the axis promotes to a rate and the measurement
 * becomes a barrel roll.
 */
const BANK = (45 * Math.PI) / 180;
const bankStick = (spec) => Math.min(0.9, 45 / spec.maxBankDeg);

function turn360(g) {
  g.reset(new THREE.Vector3(0, START, 0), 0, g.spec.trimSpeed);
  sim(g, {}, 4);
  // roll in and settle on the commanded bank
  const stick = bankStick(g.spec);
  for (let i = 0; i < 600; i++) {
    if (Math.abs(BANK - g.bankRad) < 0.02) break;
    sim(g, { roll: stick, pitch: 0.28 }, dt);
  }
  const y0 = g.position.y;
  let t = 0;
  let turned = 0;
  let path = 0;
  let bankSum = 0;
  let prev = g.headingDeg;
  while (t < 150) {
    sim(g, { roll: stick, pitch: 0.28 }, dt);
    t += dt;
    // Ground track rather than the speed at the finish line: a ship that is
    // still settling into the turn flies a circle its last-instant speed does
    // not describe, and the fast ships take a long time to settle.
    path += Math.hypot(g.velocity.x, g.velocity.z) * dt;
    bankSum += g.bankDeg * dt;
    let d = g.headingDeg - prev;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    turned += d;
    prev = g.headingDeg;
    if (Math.abs(turned) >= 360) break;
  }
  return {
    time: t,
    radius: path / (2 * Math.PI),
    speed: path / t,
    lost: y0 - g.position.y,
    bank: bankSum / t,
    closed: Math.abs(turned) >= 360,
  };
}

// ---- diving ----------------------------------------------------------------
/**
 * Point it down and hold it there.
 *
 * The stick is a rate command and the airframe is genuinely speed-stable, so a
 * dive is something a pilot has to keep doing: let go and the nose comes up on
 * its own. Anything that pins the stick instead measures a bunt into an outside
 * loop, which is what the ship does at full forward stick and is not a dive.
 *
 * Height matters as much as angle. A dive is flown at soaring altitudes, not at
 * the seven kilometres the polar bench uses, because a fifth of the air is a
 * fifth of the drag and the airbrakes are the first thing to notice.
 */
const DIVE_ALT = 3200;
const _fv = new THREE.Vector3();

function diveTest(spec, angleDeg, { brakeAfter = null, pullAfter = null, hands = false } = {}) {
  const g = new Glider(air, spec);
  g.reset(new THREE.Vector3(0, DIVE_ALT, 0), 0, spec.trimSpeed);
  g.quaternion.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-angleDeg), 0, 0, 'YXZ'));
  g.velocity.copy(g.forward(_fv)).multiplyScalar(spec.trimSpeed);
  const target = THREE.MathUtils.degToRad(angleDeg);

  let t = 0;
  let toVne = null;
  let hVne = 0;
  let peak = 0;
  let peakBuffet = 0;
  let brake = 0;
  let pulling = false;
  let recovered = null;
  while (t < 200 && g.position.y > 0) {
    if (toVne === null && g.airspeed > spec.vne) {
      toVne = t;
      hVne = g.position.y;
    }
    if (toVne !== null) {
      if (brakeAfter !== null && t - toVne >= brakeAfter) brake = 1;
      if (pullAfter !== null && t - toVne >= pullAfter) pulling = true;
      if (recovered === null && (brake || pulling || hands) && g.airspeed < spec.vne) recovered = t - toVne;
    }
    // A pilot flying the dive angle, the same way turn360 flies a bank.
    const dive = Math.asin(THREE.MathUtils.clamp(-g.forward(_fv).y, -1, 1));
    const pitch = pulling ? 1 : hands ? 0 : THREE.MathUtils.clamp((dive - target) * 3, -1, 1);
    g.update(dt, { roll: 0, pitch, brake });
    peak = Math.max(peak, g.airspeed);
    peakBuffet = Math.max(peakBuffet, g.buffet);
    t += dt;
    if (g.broken) {
      return { toVne, failedAfter: t - toVne, drop: hVne - g.position.y, peak, peakBuffet, damage: 1, g };
    }
    // Recovered and settled: nothing more to learn from flying it further.
    if (recovered !== null && t - toVne > recovered + 5) break;
  }
  return { toVne, failedAfter: null, drop: toVne === null ? 0 : hVne - g.position.y, peak, peakBuffet, damage: g.damage, recovered, g };
}

/**
 * What is left after the wing goes: it must fall, it must not fly, and it must
 * arrive fast enough that the touchdown test in game.js cannot mistake it for
 * a landing and hand the player a Safe Landing card for a break-up.
 */
function fallTest(g) {
  for (let i = 0; i < 30 / dt; i++) g.update(dt, { roll: 0, pitch: 1, brake: 1 });
  return { speed: g.airspeed, sink: -g.varioSmooth, lift: g.loadFactor, still: g.broken };
}

/** How long after passing Vne a recovery still works, to the quarter second. */
function lastChance(spec, key) {
  const base = diveTest(spec, 90);
  if (base.failedAfter === null) return null;
  let last = null;
  for (let d = 0; d <= base.failedAfter; d += 0.25) {
    if (diveTest(spec, 90, { [key]: d }).failedAfter !== null) break;
    last = d;
  }
  return last;
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
    g.update(dt, { roll: 0, pitch: 0, brake: 0 });
    vSum += g.airspeed;
    n++;
  }
  const trimmed = vSum / n;
  const expected = trimSpeedAt(spec, Air.density(g.position.y));

  // ---- polar -------------------------------------------------------------
  // Swept from just short of the break down to the lowest lift coefficient
  // that still keeps the ship inside its redline at the height the bench flies
  // at. Both ends are the ship's own: no fixed pair of angles suits a trainer
  // that hangs on to sixteen degrees and a jet that lets go at eleven.
  const w = (spec.mass * G) / spec.wingArea;
  const clAtVne = (2 * w) / (Air.density(START) * (spec.vne * 0.92) ** 2);
  const hi = spec.alphaStallDeg * 0.88;
  const lo = Math.min(hi - 1, (THREE.MathUtils.radToDeg(clAtVne / spec.clSlope)));
  let best = { ld: 0 };
  let least = { sink: Infinity };
  let slowest = Infinity;
  let fastest = 0;
  let brokeGliding = false;
  for (let i = 0; i <= 16; i++) {
    const p = glideAt(g, lo + ((hi - lo) * i) / 16);
    brokeGliding ||= p.broken;
    if (p.ld > best.ld) best = p;
    if (p.sink < least.sink) least = p;
    slowest = Math.min(slowest, p.speed);
    fastest = Math.max(fastest, p.speed);
  }
  const book = polar(spec);
  const circle = turn360(g);
  // A ship that out-sinks a weak day is not a soaring machine, and with no
  // thrust in the game there is nothing else for it to be. That single fact
  // decides which of the checks below it has to pass: there is no flag in the
  // spec saying so, because the polar already says it.
  const soarer = least.sink < 2.0;
  const dive = diveTest(spec, 90);
  const braked = diveTest(spec, 90, { brakeAfter: 0 });
  const brakeWindow = lastChance(spec, 'brakeAfter');
  const stickWindow = lastChance(spec, 'pullAfter');

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
    `  360 at 45 deg bank ${f1(circle.time)} s   radius ${f0(circle.radius)} m   bank ${f0(circle.bank)}   height lost ${f0(circle.lost)} m`
  );
  console.log(
    `  envelope       ${f1(book.stallSpeed)} .. ${f0(spec.vne)} m/s   flown ${f1(slowest)} .. ${f1(fastest)}   ${soarer ? 'soars' : 'sinks too fast to soar'}`
  );
  console.log(
    `  span ${f1(wingSpan(spec))} m   ${f0(spec.mass)} kg   ${f1((spec.mass * G) / spec.wingArea)} N/m^2 wing loading`
  );
  console.log(
    `  vertical dive  Vne at ${f1(dive.toVne)} s, airframe fails ${dive.failedAfter === null ? 'never' : f1(dive.failedAfter) + ' s later'} (${f0(dive.drop)} m below Vne), peak ${f0(dive.peak)} m/s`
  );
  console.log(
    `  recovery       brakes work to Vne+${brakeWindow === null ? '—' : f1(brakeWindow)} s, stick alone to Vne+${stickWindow === null ? '—' : f1(stickWindow)} s   brakes at Vne hold ${f0(braked.peak)} m/s`
  );
  const fail = (why) => problems.push(`${spec.name}: ${why}`);
  if (brokeGliding) fail('broke its own airframe inside the gliding half of the stick');
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
  // A 45-degree turn radius is V^2/g and nothing else; no aeroplane argues
  // with that, and a bound in metres would simply outlaw a fast one. What the
  // model has to get right is that the ship holds the bank and flies the
  // circle the arithmetic says it should.
  if (!circle.closed) fail(`never completed a 360 at 45 degrees of bank`);
  const ideal = circle.speed ** 2 / (G * Math.tan(THREE.MathUtils.degToRad(circle.bank)));
  if (circle.radius < ideal * 0.9 || circle.radius > ideal * 1.8) {
    fail(`circles at ${circle.radius.toFixed(0)} m where ${circle.bank.toFixed(0)} deg at ${circle.speed.toFixed(0)} m/s wants ${ideal.toFixed(0)} m`);
  }
  if (circle.time > 90) fail(`360 takes ${circle.time.toFixed(0)} s`);
  // Only a ship that lives on thermals has to fit inside one.
  if (soarer && circle.radius > 400) fail(`too wide to core a thermal: ${circle.radius.toFixed(0)} m radius`);

  // ---- the top of the envelope ------------------------------------------
  // The clamp that used to sit at the bottom of Glider.update pinned every
  // ship at Vne, so a vertical dive was a non-event. These say it is not.
  if (!(dive.peak > spec.vne * 1.3)) {
    fail(`a held vertical dive only reaches ${dive.peak.toFixed(0)} m/s against a ${spec.vne} m/s redline`);
  }
  // How long the airframe lasts is measured on the ship's own clock. Gravity
  // adds half a Vne in vne/2g seconds whatever the aeroplane, so that is the
  // beat a dive is counted in; a fixed number of seconds would call the same
  // behaviour an instant kill in the Kite and a non-event in the Javelin.
  const beat = spec.vne / (2 * G);
  if (dive.failedAfter === null) fail('a held vertical dive never damages the airframe');
  else if (!(dive.failedAfter > beat && dive.failedAfter < beat * 5)) {
    fail(`airframe fails ${dive.failedAfter.toFixed(1)} s after Vne, against a ${beat.toFixed(1)} s beat — an instant kill or a non-event`);
  }
  if (!(dive.peakBuffet > 1)) fail('nothing buffets on the way to the redline');
  // Airbrakes are the answer, and they have to be a better answer than the
  // stick or there is no reason to reach for them.
  if (braked.failedAfter !== null) fail('full brakes at Vne do not stop the dive');
  if (!(braked.peak < spec.vne * 1.12)) {
    fail(`brakes at Vne still let it run to ${braked.peak.toFixed(0)} m/s`);
  }
  if (!(brakeWindow > stickWindow)) {
    fail(`brakes save no more of the dive than the stick does (${brakeWindow} s vs ${stickWindow} s)`);
  }
  if (!(brakeWindow > dive.failedAfter * 0.6)) {
    fail(`brakes only work for the first ${brakeWindow} s of a ${dive.failedAfter.toFixed(1)} s dive`);
  }
  // Letting go has to help. The stick is a rate command, so a dive is only
  // ever held on purpose; taking your hand off it must always buy time, and in
  // a soaring machine — trimmed slow, with a wing that wants its alpha back —
  // it must fly the ship out on its own.
  const abandoned = diveTest(spec, 90, { hands: true });
  if (soarer && abandoned.failedAfter !== null) fail('a vertical dive left alone still breaks the ship');
  if (abandoned.failedAfter !== null && abandoned.failedAfter < dive.failedAfter) {
    fail('letting go of the stick in a dive makes it worse');
  }

  // ---- what is left of it ------------------------------------------------
  // The wreck is game.js's job, but only if the break-up actually arrives as a
  // crash. Full back stick, full brakes and full power on a broken airframe
  // must do exactly nothing.
  const wreckage = fallTest(dive.g);
  console.log(
    `  break-up       wreckage falls at ${f0(wreckage.sink)} m/s, so 500 m of air lasts ${f1(500 / wreckage.sink)} s`
  );
  if (!wreckage.still) fail('the airframe repaired itself after breaking up');
  if (wreckage.lift !== 0) fail('a broken airframe is still making lift');
  if (!(wreckage.sink > 12)) fail(`wreckage floats down at ${wreckage.sink.toFixed(1)} m/s`);
  // The same two-part test game.js touches down on. Failing either is enough,
  // and what saves the heavy ships is the rate of descent rather than the speed.
  if (wreckage.speed < spec.trimSpeed * 0.79 && wreckage.sink < spec.trimSpeed * 0.18) {
    fail(`wreckage arrives at ${wreckage.speed.toFixed(0)} m/s and ${wreckage.sink.toFixed(0)} m/s down — game.js would call that a landing`);
  }

  // Something has to say so before the redline, not after it.
  const warned = diveTest(spec, 45);
  if (warned.peakBuffet < 1 || warned.damage === 0) fail('a 45 degree dive neither buffets nor costs anything');
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

// ---- the dive, angle by angle ----------------------------------------------
// Seconds from passing Vne to the wing letting go, holding each angle. The
// question this table exists to answer is whether a dive is a decision: a row
// of dashes would mean the redline is decoration, and a row of ones would mean
// the game kills you for looking down.
console.log('\ndive — seconds from Vne to airframe failure, holding the angle');
console.log('                ' + [20, 30, 45, 60, 75, 90].map((a) => `${a}deg`.padStart(7)).join('') + '    at Vne');
for (const spec of FLEET) {
  const cells = [20, 30, 45, 60, 75, 90].map((a) => {
    const d = diveTest(spec, a);
    return (d.failedAfter === null ? (d.toVne === null ? 'never' : 'ground') : d.failedAfter.toFixed(1)).padStart(7);
  });
  const d90 = diveTest(spec, 90);
  console.log(`  ${spec.name.padEnd(12)}${cells.join('')}    ${f1(d90.toVne)} s`);
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
    g.loadFactor.toFixed(2),
    'wear',
    g.damage.toFixed(2)
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
// Roll in and hold, rather than pinning the stick — see turn360.
const holdStick = bankStick(g.spec);
for (let i = 0; i < 14 / dt; i++) sim(g, { roll: holdStick, pitch: 0.25 }, dt);
show('45 deg turn, held 14 s');
if (g.bankDeg < 20) problems.push('right stick did not produce a right bank');
// Rolling costs speed control, and the Vela does go past its redline holding
// full aileron for ten seconds. That is the ship, not a bug — but a roll must
// not be a death sentence, and the wear it leaves must be worth noticing.
if (g.broken) problems.push('rolling the ship tore it apart');

// ------------------------------------------------------------ two laws ---
// The whole point of the control model: a stick short of the stop HOLDS a bank,
// and only a stick pinned to it rolls. If the first were false the game would
// be twitchy to fly with a thumb; if the second were, there would be no barrel
// roll. Both have been broken by a refactor before, in opposite directions.
console.log('\ntwo laws — hold a bank, pin the stick to roll');
{
  const step = 1 / 120;
  for (const spec of FLEET) {
    const held = new Glider(air, spec);
    held.reset(new THREE.Vector3(0, 3000, 0), 0, spec.trimSpeed * 1.2);
    const stick = Math.min(0.85, 45 / spec.maxBankDeg);
    let peak = 0;
    for (let i = 0; i < 20 / step; i++) {
      held.update(step, { roll: stick, pitch: 0.25, brake: 0 });
      peak = Math.max(peak, Math.abs(held.bankDeg));
    }

    const pinned = new Glider(air, spec);
    pinned.reset(new THREE.Vector3(0, 3000, 0), 0, spec.trimSpeed * 1.2);
    let prev = pinned.bankRad;
    let swept = 0;
    for (let i = 0; i < 6 / step; i++) {
      pinned.update(step, { roll: 1, pitch: 0, brake: 0 });
      let d = pinned.bankRad - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      swept += d;
      prev = pinned.bankRad;
    }
    const revs = Math.abs(swept) / (2 * Math.PI);

    const holdsOk = peak < 78 && Math.abs(held.bankDeg) > 25;
    const rollsOk = revs > 1;
    if (!holdsOk) problems.push(`${spec.name}: a held stick did not hold a bank (settled ${held.bankDeg.toFixed(0)}, peak ${peak.toFixed(0)})`);
    if (!rollsOk) problems.push(`${spec.name}: a pinned stick did not roll right over (${revs.toFixed(2)} turns in 6 s)`);
    console.log(
      `  ${holdsOk && rollsOk ? 'ok  ' : 'FAIL'} ${spec.name.padEnd(9)} holds ${held.bankDeg.toFixed(0).padStart(3)} deg   pinned: ${revs.toFixed(1)} rolls in 6 s`
    );
  }
}


if (problems.length) {
  console.log('\nFAILURES:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nall good');
