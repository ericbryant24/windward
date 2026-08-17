/**
 * Checks every authored secret against the real terrain, water and buildings.
 *
 * A secret is a lat/lon and a condition, and both halves rot silently. The
 * coordinate was read off a map and might be a hundred metres into a cliff; the
 * height band was reasoned about and might be underground; the flat place you
 * asked somebody to land on might be a lake or a 30-degree slope. None of that
 * shows up as an error at runtime — it shows up as a secret nobody can ever
 * find, which is indistinguishable from a secret nobody has found yet. That is
 * the worst failure mode available, so it gets a tool.
 *
 * What it checks, per verb:
 *
 *   place  in bounds; ground height at the point; if there is an `agl` band,
 *          that the band clears the terrain across the whole radius, so the
 *          window is air rather than rock. Reports the absolute altitudes to
 *          fly at, which is the number a human actually wants.
 *   land   the whole radius sampled: how much of it is water, how much is
 *          steeper than the gear will take, and the biggest clear circle in it.
 *   trace  the centreline walked: terrain clearance, whether the ceiling can be
 *          held against the ground's own climb rate, and building tops beside
 *          and under the line — which is the only thing standing between the
 *          Magnificent Mile and a wall.
 *
 *   node tools/verify-secrets.mjs
 *   node tools/verify-secrets.mjs --map=chicago
 *
 * Exits non-zero when a secret cannot be earned as authored.
 */
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { Heightfield } from '../src/heightfield.js';
import { REGIONS, SECRETS, PLACES } from '../src/regions.js';
import { World } from '../src/world.js';
import { loadBuildings, Buildings } from '../src/buildings.js';
import { getAircraft } from '../src/fleet.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const ONLY_MAP = arg('map');

/** The steepest ground the Shrike's gear will accept, as a normal's y. */
const LANDABLE_NORMAL = 0.93;
/** Buildings.#buildCollisionGrid's bucket size. */
const HIT_CELL = 128;

/**
 * The tallest building whose footprint centre is genuinely within `r`, and how
 * far its roof stands above its own ground.
 *
 * Buildings.topNear is not usable for this: it sweeps a 3x3 of 128 m buckets,
 * so a 95 m question gets a 384 m answer. Asked whether anything tall stands
 * within ninety-five metres of Marina City it reports Trump Tower, which is two
 * hundred metres away, and the check fails a secret that is perfectly flyable.
 * It is the right function for its own job — keeping a respawn out of a roof —
 * and the wrong one for this.
 */
function tallestWithin(ctx, x, z, r) {
  const { buildings: b, hf } = ctx;
  if (!b?.hitGrid) return null;
  const d = b.data;
  let top = -Infinity;
  let over = -Infinity;
  const cells = Math.ceil(r / HIT_CELL);
  for (let gx = -cells; gx <= cells; gx++) {
    for (let gz = -cells; gz <= cells; gz++) {
      const list = b.hitGrid.get(
        Math.floor((x + gx * HIT_CELL) / HIT_CELL) * 4096 + Math.floor((z + gz * HIT_CELL) / HIT_CELL)
      );
      if (!list) continue;
      for (const i of list) {
        const ox = d.origin[i * 2];
        const oz = d.origin[i * 2 + 1];
        if ((ox - x) ** 2 + (oz - z) ** 2 > r * r) continue;
        if (b.colTop[i] > top) top = b.colTop[i];
        // Measured against the ground the building stands on, not the ground
        // under the point being asked about — on an alpine slope those are
        // hundreds of metres apart and the difference is meaningless.
        const h = b.colTop[i] - hf.heightAt(ox, oz);
        if (h > over) over = h;
      }
    }
  }
  return top === -Infinity ? null : { top, over };
}

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
  let vegetation = null;
  if (meta.vegetation?.size) {
    const vp = PNG.sync.read(await readFile(new URL(`../${meta.vegetation.file}`, import.meta.url)));
    const vn = meta.vegetation.size;
    const data = new Uint8Array(vn * vn);
    for (let p = 0; p < data.length; p++) data[p] = vp.data[p * 4];
    vegetation = { data, size: vn };
  }
  return new Heightfield(meta, heights, water, vegetation);
}

async function loadRegion(id) {
  const hf = await loadHeightfield(id);
  const sky = { uniforms: {} };
  const scene = new THREE.Scene();
  const world = new World(hf, sky, scene, id);
  const b64 = (await readFile(new URL(`../data/${id}-buildings.bin.gz`, import.meta.url))).toString('base64');
  const buildings = new Buildings(hf, sky, await loadBuildings(null, b64), world.places, {
    ...REGIONS[id].buildings,
    landmarks: null,
  });
  return { id, hf, world, buildings };
}

const problems = [];
const note = (s) => console.log(s);

function checkPlace(ctx, def) {
  const { hf, world, buildings } = ctx;
  const v = world.toLocal(def.lat, def.lon);
  const lim = hf.halfSize - 900;
  if (Math.abs(v.x) > lim || Math.abs(v.z) > lim) {
    problems.push(`${def.id}: ${Math.round(Math.max(Math.abs(v.x), Math.abs(v.z)) - lim)} m outside the flyable box`);
    return;
  }
  const ground = hf.heightAt(v.x, v.z);
  const r = def.radius ?? 220;

  // The highest ground and the tallest roof anywhere inside the radius. A
  // height band has to clear both or the window is solid.
  let peak = -Infinity;
  for (let a = 0; a < 16; a++) {
    for (let k = 0; k <= 3; k++) {
      const rad = (r * k) / 3;
      const x = v.x + Math.cos((a / 16) * Math.PI * 2) * rad;
      const z = v.z + Math.sin((a / 16) * Math.PI * 2) * rad;
      peak = Math.max(peak, hf.heightAt(x, z));
    }
  }
  const near = tallestWithin(ctx, v.x, v.z, r);
  const roof = near?.top ?? -Infinity;
  const solid = Math.max(peak, roof);

  if (def.agl) {
    const lo = ground + def.agl[0];
    const hi = ground + def.agl[1];
    // Whether there is anywhere in the disc you can BE at that height — not
    // whether the whole disc is clear.
    //
    // Those are very different questions and only the first one is the rule.
    // Every interesting height band here is authored beside something tall on
    // purpose: the Sphinx sits on the col you are flying past, Willis is the
    // reason to be at 500 m, and Marina City is two towers with a gap. Asking
    // whether the tallest thing within the radius clears the band fails all
    // three for the exact feature that makes them worth flying to.
    let bestFloor = Infinity;
    let clearAt = null;
    for (let a = 0; a < 24; a++) {
      for (let k = 0; k <= 4; k++) {
        const rad = (r * k) / 4;
        const x = v.x + Math.cos((a / 24) * Math.PI * 2) * rad;
        const z = v.z + Math.sin((a / 24) * Math.PI * 2) * rad;
        // A column the aeroplane's own width, with margin.
        const col = tallestWithin(ctx, x, z, 30);
        const floor = Math.max(hf.heightAt(x, z), col?.top ?? -Infinity);
        if (floor < bestFloor) {
          bestFloor = floor;
          clearAt = rad;
        }
      }
    }
    if (hi <= bestFloor) {
      problems.push(
        `${def.id}: nowhere inside the ${r} m radius is the ${def.agl[0]}–${def.agl[1]} m band ` +
          `(${Math.round(lo)}–${Math.round(hi)} m) above the ${Math.round(bestFloor)} m of ground and roof under it`
      );
      return;
    }
    const clear = hi - Math.max(lo, bestFloor);
    note(
      `  ok   ${def.id.padEnd(20)} band ${Math.round(lo)}–${Math.round(hi)} m, ${Math.round(clear)} m of open air ` +
        `${clearAt < 1 ? 'over the point' : `${Math.round(clearAt)} m out`}` +
        (roof > peak ? `, ${Math.round(roof)} m rooftops alongside` : '')
    );
    if (clear < 60) note(`       ...only ${Math.round(clear)} m of window — tight, but flyable`);
    return;
  }

  if (def.below != null) {
    // `below` is AGL under the aeroplane, so what matters is whether the
    // buildings actually standing here leave room to be that low.
    const over = near?.over ?? -Infinity;
    if (over > -Infinity && def.below - over < 25) {
      problems.push(
        `${def.id}: buildings inside ${r} m stand ${Math.round(over)} m over their own ground and the rule wants you under ${def.below} m`
      );
      return;
    }
    note(
      `  ok   ${def.id.padEnd(20)} under ${def.below} m agl over ${Math.round(ground)} m ground` +
        (over > -Infinity ? `, tallest building inside ${r} m is ${Math.round(over)} m` : '')
    );
    return;
  }
  note(`  ok   ${def.id.padEnd(20)} ${Math.round(ground)} m ground, radius ${r} m, no height condition`);
}

function checkLand(ctx, def) {
  const { hf, world } = ctx;
  const v = world.toLocal(def.lat, def.lon);
  const r = def.radius ?? 220;
  const nrm = new THREE.Vector3();
  let cells = 0;
  let wet = 0;
  let steep = 0;
  // The biggest run of landable ground through the middle, which is the thing
  // that decides whether a strip exists rather than a scattering of flat spots.
  let best = 0;
  for (let a = 0; a < 12; a++) {
    const th = (a / 12) * Math.PI;
    let run = 0;
    for (let d = -r; d <= r; d += 12) {
      const x = v.x + Math.cos(th) * d;
      const z = v.z + Math.sin(th) * d;
      cells++;
      const water = hf.isWater(x, z);
      hf.normalAt(x, z, 25, nrm);
      const ok = !water && nrm.y >= LANDABLE_NORMAL;
      if (water) wet++;
      else if (nrm.y < LANDABLE_NORMAL) steep++;
      run = ok ? run + 12 : 0;
      if (run > best) best = run;
    }
  }
  const pct = (n) => `${Math.round((100 * n) / cells)}%`;
  // The Shrike lands in about 175 m and needs to stop inside the radius.
  if (best < 180) {
    problems.push(
      `${def.id}: longest landable run through the radius is ${best} m — the Shrike needs about 175 m to stop`
    );
    return;
  }
  note(
    `  ok   ${def.id.padEnd(20)} ${best} m of landable run, ${pct(wet)} water, ${pct(steep)} too steep, ` +
      `${Math.round(hf.heightAt(v.x, v.z))} m`
  );
}

function checkTrace(ctx, def) {
  const { hf, world, buildings } = ctx;
  const pts = def.path.map(([lat, lon]) => world.toLocal(lat, lon));
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);

  // Walk the centreline. Two things can make a trace unflyable: the ground
  // climbing faster than an aeroplane holding the ceiling can climb, and a
  // building standing in the corridor.
  const STEP = 20;
  // Averaged over two hundred metres rather than over one step. A twenty-metre
  // baseline measures the riverbank the Michigan Avenue bridge crosses and
  // calls it a 35% climb; what an aeroplane has to follow is the sustained
  // gradient, and over the Wengernalp line that is the honest question.
  const SMOOTH = Math.max(1, Math.round(200 / STEP));
  const along = [];
  let blocked = 0;
  let blockWorst = 0;
  let blockAt = 0;
  const spec = getAircraft('shrike');
  for (let s = 0; s <= length; s += STEP) {
    // Walk the polyline to the point s along it.
    let d = s;
    let i = 1;
    while (i < pts.length - 1) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      if (d <= seg) break;
      d -= seg;
      i++;
    }
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const t = d / seg;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const ground = hf.heightAt(x, z);
    along.push(ground);
    // Is there anywhere across the corridor you can be, at this point along it,
    // below the ceiling and not inside something?
    //
    // Not "is the corridor clear" — a street canyon is walls by definition and
    // the walls are the reason to fly it. What would make it unflyable is a
    // station where EVERY lateral offset is blocked, which is a building across
    // the road rather than beside it.
    let open = false;
    let lowest = Infinity;
    for (let off = -def.width; off <= def.width; off += 15) {
      const nx = x + (off * -(b.z - a.z)) / seg;
      const nz = z + (off * (b.x - a.x)) / seg;
      const col = tallestWithin(ctx, nx, nz, 22);
      const top = Math.max(hf.heightAt(nx, nz), col?.top ?? -Infinity);
      lowest = Math.min(lowest, top - ground);
      if (top <= ground + def.ceiling) open = true;
    }
    if (!open) {
      blocked++;
      if (lowest > blockWorst) {
        blockWorst = lowest;
        blockAt = s;
      }
    }
  }
  let worstClimb = 0;
  for (let i = SMOOTH; i < along.length; i++) {
    worstClimb = Math.max(worstClimb, (along[i] - along[i - SMOOTH]) / (SMOOTH * STEP));
  }
  // Climbing at the ceiling means matching the ground's gradient. The Shrike
  // climbs about 12 m/s at 58 m/s, so about 0.21 vertical per horizontal.
  const climbable = 12 / spec.trimSpeed;
  note(
    `  ok   ${def.id.padEnd(20)} ${(length / 1000).toFixed(2)} km, ${def.seconds} s of ${def.ceiling} m ceiling ` +
      `in a ${def.width} m corridor, steepest ground ${(worstClimb * 100).toFixed(0)}%`
  );
  if (worstClimb > climbable) {
    problems.push(
      `${def.id}: the ground climbs at ${(worstClimb * 100).toFixed(0)}% and the ship can only manage ` +
        `${(climbable * 100).toFixed(0)}% at trim — the ceiling cannot be held`
    );
  }
  // A canyon run is supposed to have walls. What it must not have is walls in
  // the middle of it.
  if (blocked) {
    problems.push(
      `${def.id}: blocked clean across at ${blocked} point(s) — ${Math.round(blockWorst)} m of building or ground ` +
        `at ${Math.round(blockAt)} m along, against a ${def.ceiling} m ceiling`
    );
  }
  const need = (def.seconds * spec.trimSpeed * 1.2) / length;
  if (need > 1) {
    problems.push(
      `${def.id}: ${def.seconds} s at cruise is ${Math.round(def.seconds * spec.trimSpeed * 1.2)} m of line and there ` +
        `is only ${Math.round(length)} m of it`
    );
  }
}

// ------------------------------------------------------------------ run ---
for (const id of Object.keys(REGIONS)) {
  if (ONLY_MAP && id !== ONLY_MAP) continue;
  const defs = SECRETS[id] ?? [];
  console.log(`\n${'='.repeat(74)}\n${REGIONS[id].name} — ${defs.length} secrets\n${'='.repeat(74)}`);
  if (!defs.length) continue;
  const ctx = await loadRegion(id);
  const seen = new Set();
  for (const def of defs) {
    if (seen.has(def.id)) problems.push(`${def.id}: duplicate id`);
    seen.add(def.id);
    if (!def.name || !def.hint || !def.note) {
      problems.push(`${def.id}: needs a name, a hint and a note`);
      continue;
    }
    // A hint that names the place is a quest marker, not a hint.
    const words = def.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
    const leaks = words.filter((w) => def.hint.toLowerCase().includes(w));
    if (leaks.length) problems.push(`${def.id}: the hint gives away "${leaks.join('", "')}" from the name`);

    if (def.kind === 'trace') checkTrace(ctx, def);
    else if (def.kind === 'land') checkLand(ctx, def);
    else if (def.kind === 'place') checkPlace(ctx, def);
    else problems.push(`${def.id}: unknown kind "${def.kind}"`);
  }
  // A secret named after a labelled place is not a secret. The label layer
  // hangs place names on the horizon from eleven kilometres out and the
  // discovery toast fires within eight hundred metres, so both of them announce
  // it before you have done anything — and the secret then rewards you a second
  // time for a thing the map already rewarded. Caught by the smoke test first,
  // which found "Konkordiaplatz" written across the sky.
  const named = new Set(PLACES[id].map((p) => p.name));
  for (const def of defs) {
    if (named.has(def.name)) problems.push(`${def.id}: "${def.name}" is already a labelled place on this map`);
  }
}

console.log(`\n${'='.repeat(74)}`);
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ! ${p}`);
  process.exit(1);
}
console.log('Every secret can be earned as authored.');
