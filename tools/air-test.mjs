/**
 * Does the air layer tell the truth?
 *
 * Every cue in airviz.js — a drifting mote, a shaft of lift, the arrow that
 * says where to go next — is a claim about what Air.sample would return at a
 * particular place. This flies a path across each real region and re-asks the
 * physics, point for point, so a marker that lies is a failing test rather than
 * an argument about a screenshot.
 *
 * The strong assertions are the negative ones. A lift column standing over Lake
 * Michigan, or an arrow pointing at a thermal whose top is below you, is worse
 * than no cue at all: the player learns to stop reading the sky.
 *
 *   node tools/air-test.mjs [chicago|jungfrau]
 */
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { Heightfield } from '../src/heightfield.js';
import { Air, Glider } from '../src/flight.js';
import { AirField, LIFT_MIN } from '../src/airviz.js';
import { REGIONS } from '../src/regions.js';
import { getAircraft, polar } from '../src/fleet.js';

const only = process.argv[2];
const ids = only ? [only] : ['jungfrau', 'chicago'];
const TICK = 1 / 30;
const problems = [];

/** The baked region, read the way the browser reads it but without a browser. */
async function loadHeightfield(id) {
  const meta = JSON.parse(await readFile(`data/${id}.json`, 'utf8'));
  const png = PNG.sync.read(await readFile(`data/${id}.png`));
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

/**
 * The sample the field says it took, taken again. Air.sample reads the clock
 * for the thermals' breathing and for the texture in the background air, so
 * winding it back to the moment of the claim is what makes the comparison
 * exact rather than approximate.
 */
function resample(air, x, y, z, at, out = new THREE.Vector3()) {
  const now = air.time;
  air.time = at;
  air.sample({ x, y, z }, out);
  air.time = now;
  return out;
}

for (const id of ids) {
  const region = REGIONS[id];
  if (!region) {
    console.log(`unknown region ${id}`);
    process.exit(1);
  }
  const hf = await loadHeightfield(id);
  // The sun only decides which slopes get thermals; any plausible afternoon
  // will do, and seedThermals is deterministic given one.
  const sky = { sunDir: new THREE.Vector3(0.42, 0.66, -0.62).normalize() };
  const air = new Air(hf, sky, region.air);
  air.seedThermals();

  const spec = getAircraft();
  const book = polar(spec);
  const hunt = { sink: book.minSink + 0.15, glide: book.bestLD * 0.75 };
  const field = new AirField(air, hf);

  const mpdLon = 111320 * Math.cos((hf.meta.centerLat * Math.PI) / 180);
  const toLocal = (lat, lon) => ({
    x: (lon - hf.meta.centerLon) * mpdLon,
    z: (hf.meta.centerLat - lat) * 111320,
  });
  const s = region.start;
  const from = toLocal(s.lat, s.lon);
  const start = new THREE.Vector3(from.x, hf.heightAt(from.x, from.z) + s.agl, from.z);

  const cases = [];
  const notes = [];
  const check = (name, got, want) => cases.push({ name, got, want });
  let cellChecks = 0;
  let cellBad = 0;
  let columnChecks = 0;
  let columnBad = 0;
  let columnWet = 0;
  let moteChecks = 0;
  let moteBad = 0;
  let moteDrift = 0;
  let liftAsked = 0;
  let liftAnswered = 0;
  let liftBad = 0;
  let liftMissed = 0;
  let naiveWrong = 0;
  let staleWorst = 0;
  const v = new THREE.Vector3();

  // ---- the whole grid, with the clock held still -------------------------
  // Nothing has moved and nothing has breathed, so agreement here has to be
  // exact: this is the proof that the field is a view of Air.sample and not a
  // second model of the air that happens to look similar.
  field.prime(start);
  for (const c of field.cells) {
    if (!c.ready) continue;
    cellChecks++;
    const w = resample(air, c.x, c.probeY, c.z, c.t, v).y;
    if (Math.abs(w - c.w) > 1e-9) cellBad++;
  }
  check('every scan cell is a real sample of the air', cellChecks - cellBad, cellChecks);
  check('the grid is fully swept by prime()', cellChecks, field.cells.length);

  // ---- and then fly, which is when it gets interesting -------------------
  // A path from the region's own start, across the map and back through the
  // middle, at a height that goes from working altitude down to scratching.
  const legs = [
    new THREE.Vector3(hf.halfSize * 0.42, 0, -hf.halfSize * 0.3),
    new THREE.Vector3(-hf.halfSize * 0.4, 0, hf.halfSize * 0.36),
    new THREE.Vector3(hf.halfSize * 0.15, 0, hf.halfSize * 0.1),
  ];
  const focus = start.clone();
  let step = 0;
  // A mote that is re-scattered every tick is a mote whose domain is wrong —
  // it flickers instead of drifting, and it says nothing about the wind. Over
  // a 4,000 m summit a ceiling pinned to cloudbase does exactly that.
  const was = new Float32Array(field.motes.length * 3);
  let ticks = 0;
  let teleports = 0;
  for (const leg of legs) {
    const target = leg.clone();
    target.y = hf.heightAt(target.x, target.z) + (region.air.cloudBase - hf.heightAt(target.x, target.z)) * 0.55;
    const dist = Math.hypot(target.x - focus.x, target.z - focus.z);
    const steps = Math.max(1, Math.round(dist / (34 * TICK)));
    const from0 = focus.clone();
    for (let i = 1; i <= steps; i++) {
      focus.lerpVectors(from0, target, i / steps);
      air.update(TICK);
      if (field.update(TICK, focus)) {
        ticks++;
        field.motes.forEach((m, k) => {
          if (Math.abs(m.pos.x - was[k * 3]) + Math.abs(m.pos.y - was[k * 3 + 1]) + Math.abs(m.pos.z - was[k * 3 + 2]) > 8) {
            teleports++;
          }
          was[k * 3] = m.pos.x;
          was[k * 3 + 1] = m.pos.y;
          was[k * 3 + 2] = m.pos.z;
        });
      }
      if (++step % 17) continue;

      // Every column, re-asked at the instant it claims to describe.
      for (const c of field.columns) {
        columnChecks++;
        const w = resample(air, c.x, c.probeY, c.z, c.t, v).y;
        if (Math.abs(w - c.w) > 1e-9 || w < LIFT_MIN) columnBad++;
        // Whatever the clock says, air over open water in this model sinks —
        // open water being the lake, by the same reach Air itself uses, not a
        // river between two rows of towers. A shaft of lift standing out on
        // Lake Michigan is a lie at every instant.
        if (openWater(hf, c.x, c.z)) columnWet++;
        staleWorst = Math.max(staleWorst, air.time - c.t);
      }

      // Motes: what the shader colours each one by is the air at the point it
      // draws it, and the height it gained is the air's own doing.
      for (const m of field.motes) {
        if (!m.ready) continue;
        moteChecks++;
        const wind = resample(air, m.pos.x, m.pos.y, m.pos.z, m.t, v);
        if (Math.abs(wind.y - m.w) > 1e-9) moteBad++;
        if (Math.hypot(m.pos.x - focus.x, m.pos.z - focus.z) > field.moteRadius + 1) moteDrift++;
      }

      // The wind the trees lean into and the water streaks with.
      const g = hf.heightAt(focus.x, focus.z);
      air.sample({ x: focus.x, y: g + 25, z: focus.z }, v);
      if (v.distanceTo(field.surfaceWind) > 1e-9) problems.push(`${id}: surface wind is not the sampled wind`);

      // ---- the readout that must not lie ---------------------------------
      liftAsked++;
      const best = field.bestLift(focus, hunt);
      if (best) {
        liftAnswered++;
        const w = air.sample({ x: best.x, y: best.y, z: best.z }, v).y;
        const floor = hf.heightAt(best.x, best.z) + 90;
        const glide = focus.y - best.distance / hunt.glide;
        if (w <= hunt.sink || best.y < floor || Math.abs(glide - best.y) > 1e-6) liftBad++;
      } else {
        // Saying nothing is only honest if there really is nothing: brute-force
        // every thermal on the map under the same rule and expect no takers.
        for (const t of air.thermals) {
          const d = Math.hypot(t.x - focus.x, t.z - focus.z);
          const arrive = focus.y - d / hunt.glide;
          if (arrive < hf.heightAt(t.x, t.z) + 90) continue;
          if (air.sample({ x: t.x, y: arrive, z: t.z }, v).y > hunt.sink) liftMissed++;
        }
      }
      // What the HUD used to point at: the nearest thermal, usable or not.
      const near = air.nearestThermal(focus.x, focus.z);
      if (near) {
        const t = near.thermal;
        const arrive = focus.y - near.distance / hunt.glide;
        const reachable = arrive >= hf.heightAt(t.x, t.z) + 90;
        if (!reachable || air.sample({ x: t.x, y: Math.max(arrive, 0), z: t.z }, v).y <= hunt.sink) naiveWrong++;
      }
    }
  }

  check('columns stand only in rising air', columnChecks - columnBad, columnChecks);
  check('no column over open water', columnWet, 0);
  check('motes carry the air at their own position', moteChecks - moteBad, moteChecks);
  check('motes stay in the near field', moteDrift, 0);
  const churn = teleports / Math.max(ticks * field.motes.length, 1);
  check('motes drift rather than flicker', churn < 0.12 ? 1 : 0, 1);
  check('nearest lift is lift this ship can use', liftBad, 0);
  check('silence means there was nothing to point at', liftMissed, 0);

  // ---- the vector the instruments read -----------------------------------
  // Netto and the wind arrow are drawn from glider.wind, which the flight model
  // fills in at the top of its own step. If that is not Air.sample at the ship,
  // the instruments are describing some other aeroplane's air.
  const glider = new Glider(air, spec);
  glider.reset(start, s.heading, spec.trimSpeed);
  const before = new THREE.Vector3();
  let windBad = 0;
  for (let i = 0; i < 600; i++) {
    before.copy(glider.position);
    glider.update(1 / 120, { roll: 0.15, pitch: 0, brake: 0, boost: false });
    air.sample(before, v);
    if (v.distanceTo(glider.wind) > 1e-9) windBad++;
  }
  check('the instruments read the air the physics flew', windBad, 0);
  // A column outlives the sweep that found it and the sweep after, which is the
  // most the field is allowed to be describing a sky that has since moved on.
  check('columns are never stale', staleWorst < 3 ? 1 : 0, 1);

  // ---- stranded over the lake --------------------------------------------
  // The case the old readout got wrong, and the one that kills you. Low over
  // open water there is nothing but sink for kilometres, and an arrow pointing
  // hopefully at the nearest thermal is an instruction to press on and drown.
  if (region.air.waterSink) {
    // The deepest water on the map, not the first bit of it: close inshore the
    // convergence band is still within glide and the honest answer is a number.
    let lake = null;
    for (let r = 0.78; r > 0.3 && !lake; r -= 0.04) {
      const p = { x: hf.halfSize * r, z: 0 };
      if (openWater(hf, p.x, p.z)) lake = p;
    }
    if (!lake) problems.push(`${id}: no open water to test the lake with`);
    else {
      let wet = 0;
      let rising = 0;
      for (let i = 0; i < 14; i++) {
        for (let k = 0; k < 14; k++) {
          const x = lake.x + (i - 7) * 90;
          const z = lake.z + (k - 7) * 90;
          if (!openWater(hf, x, z)) continue;
          wet++;
          if (air.sample({ x, y: hf.heightAt(x, z) + 60 + k * 40, z }, v).y > 0) rising++;
        }
      }
      check('nothing rises over the lake', rising, 0);
      check('the lake was actually sampled', wet > 40 ? wet : 0, wet);

      const low = new THREE.Vector3(lake.x, hf.heightAt(lake.x, lake.z) + 160, lake.z);
      const answer = field.bestLift(low, hunt);
      const naive = air.nearestThermal(low.x, low.z);
      const naiveArrive = naive ? low.y - naive.distance / hunt.glide : 0;
      const naiveUsable =
        naive &&
        naiveArrive >= hf.heightAt(naive.thermal.x, naive.thermal.z) + 90 &&
        air.sample({ x: naive.thermal.x, y: naiveArrive, z: naive.thermal.z }, v).y > hunt.sink;
      notes.push(
        `  ${(lake.x / 1000).toFixed(1)} km out over the lake at ${Math.round(low.y)} m: the nearest thermal is ` +
          `${(naive.distance / 1000).toFixed(1)} km away and ${naiveUsable ? 'usable' : 'no use whatever'}; ` +
          `the readout says ${answer ? `${(answer.distance / 1000).toFixed(1)} km` : 'nothing'}`
      );
      const honest = !answer || air.sample({ x: answer.x, y: answer.y, z: answer.z }, v).y > hunt.sink;
      check('the lake readout is honest or silent', honest ? 1 : 0, 1);
    }
  }

  // ---- and it has to be worth drawing ------------------------------------
  field.prime(start);
  const shore = field.columns.filter((c) => !hf.isWater(c.x, c.z) && nearWater(hf, c.x, c.z, 700));
  if (region.air.shoreLift) {
    check('the shore convergence band is drawn', shore.length >= 5 ? 1 : 0, 1);
  }
  check('the map has lift to show', field.columns.length >= 6 ? 1 : 0, 1);

  const meanW = field.columns.reduce((a, c) => a + c.w, 0) / Math.max(field.columns.length, 1);
  console.log(
    `\n${region.name} — ${field.cells.length} cells at ${field.step.toFixed(0)} m, ` +
      `${field.motes.length} motes, cloudbase ${region.air.cloudBase} m`
  );
  console.log(
    `  ${field.columns.length} columns, mean ${meanW.toFixed(2)} m/s, ${shore.length} within 700 m of water, ` +
      `worst staleness ${staleWorst.toFixed(2)} s`
  );
  console.log(`  ${(100 * churn).toFixed(1)}% of motes re-scattered per tick over ${ticks} ticks`);
  console.log(
    `  nearest lift answered ${liftAnswered}/${liftAsked} times along the path; ` +
      `the naive nearest thermal would have been unusable ${naiveWrong}/${liftAsked}`
  );
  for (const line of notes) console.log(line);
  for (const c of cases) {
    const ok = c.got === c.want;
    if (!ok) problems.push(`${id}: ${c.name} (${c.got}/${c.want})`);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(48)} ${c.got}/${c.want}`);
  }
}

/** Air's own definition, so the test and the model draw the shoreline alike. */
function openWater(hf, x, z) {
  const r = 260;
  return hf.isWater(x + r, z) && hf.isWater(x - r, z) && hf.isWater(x, z + r) && hf.isWater(x, z - r);
}

function nearWater(hf, x, z, r) {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (hf.isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true;
  }
  return false;
}

if (problems.length) {
  console.log('\nFAILURES:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nall good');
