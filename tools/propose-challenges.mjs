/**
 * Proposes challenges from the terrain, instead of me typing coordinates.
 *
 * Every hand-authored course in this game has been wrong at least once, and
 * always in a way no diff shows: a slalom gate inside a cliff, a deck corridor
 * wider than the river it was drawn down, a marker a kilometre above the tunnel
 * portal it was named after, a ballpark outside the flyable box. Each was found
 * by a tool afterwards. Asking for "way more challenges" by hand is asking for
 * proportionally more of that.
 *
 * So this reads the region and proposes. The terrain, the water mask, the
 * surveyed road and rail network and the buildings are all already baked; what
 * they describe is where an aeroplane can go, and a challenge is a line an
 * aeroplane can go along. In particular a ROAD is a solved flight path — it was
 * routed through the same valley for the same reason — which is why most of what
 * comes out of here is hung off the network.
 *
 * What it does NOT do is decide the medals. It emits a def with a placeholder
 * ladder and `calibrate: true`; tools/calibrate-challenges.mjs flies each one
 * and the numbers come from that, exactly like every hand-authored one. A
 * proposal that cannot be flown is dropped rather than shipped.
 *
 *   node tools/propose-challenges.mjs maui
 *   node tools/propose-challenges.mjs flam --slalom=6 --deck=4
 *   node tools/propose-challenges.mjs jungfrau --json > /tmp/j.json
 */
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { Heightfield } from '../src/heightfield.js';
import { Air } from '../src/flight.js';
import { REGIONS as APP_REGIONS, CHALLENGES } from '../src/regions.js';
import { World } from '../src/world.js';
import { loadBuildings, Buildings } from '../src/buildings.js';
import { loadNetwork } from '../src/network.js';
import { TIME_PRESETS } from '../src/sky.js';
import { getAircraft, polar } from '../src/fleet.js';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? Number(hit.slice(n.length + 3)) : d;
};
const REGION_ID = argv.find((a) => !a.startsWith('-')) ?? 'jungfrau';
const WANT = {
  slalom: arg('slalom', 5),
  deck: arg('deck', 3),
  gunnery: arg('gunnery', 2),
  height: arg('height', 2),
  distance: arg('distance', 2),
};
const JSON_OUT = argv.includes('--json');

const KIND = { MAJOR_ROAD: 0, MINOR_ROAD: 1, TRACK: 2, PATH: 3, NARROW_GAUGE: 4, RAIL: 5 };
/** Ways worth hanging a course on: things routed through a valley on purpose. */
const COURSE_KINDS = new Set([KIND.MAJOR_ROAD, KIND.MINOR_ROAD, KIND.NARROW_GAUGE, KIND.RAIL]);

// ------------------------------------------------------------------ load ---
const R = APP_REGIONS[REGION_ID];
if (!R) throw new Error(`unknown region ${REGION_ID}`);
const meta = JSON.parse(await readFile(new URL(`../data/${REGION_ID}.json`, import.meta.url), 'utf8'));
const png = PNG.sync.read(await readFile(new URL(`../data/${REGION_ID}.png`, import.meta.url)));
const N = meta.size;
const heights = new Float32Array(N * N);
const wet = new Uint8Array(N * N);
{
  const { bias, scale } = meta.encoding;
  for (let p = 0, q = 0; p < heights.length; p++, q += 4) {
    heights[p] = (png.data[q] * 256 + png.data[q + 1]) / scale - bias;
    wet[p] = png.data[q + 2] > 127 ? 1 : 0;
  }
}
const hf = new Heightfield(meta, heights, wet, null);
const HALF = hf.halfSize;
const LIM = HALF - 1200;
const STEP = meta.step;

const p = TIME_PRESETS.afternoon;
const el = THREE.MathUtils.degToRad(p.elevation);
const az = THREE.MathUtils.degToRad(p.azimuth);
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
const sky = { sunDir, uniforms: { uSunDir: { value: sunDir }, uTime: { value: 0 } } };
const air = new Air(hf, sky, R.air);
air.seedThermals();
const scene = new THREE.Scene();
const world = new World(hf, sky, scene, REGION_ID);

let buildings = null;
try {
  const b64 = (await readFile(new URL(`../data/${REGION_ID}-buildings.bin.gz`, import.meta.url))).toString('base64');
  buildings = new Buildings(hf, sky, await loadBuildings(null, b64), world.places, { ...R.buildings, landmarks: null });
} catch {
  /* a region without baked buildings still proposes; nothing to clear */
}
let ways = [];
try {
  const b64 = (await readFile(new URL(`../data/${REGION_ID}-network.bin.gz`, import.meta.url))).toString('base64');
  ways = await loadNetwork(null, b64);
} catch {
  /* no network: slaloms will come from water channels instead */
}

const SPEC = getAircraft('shrike');
const BOOK = polar(SPEC);
const mLat = 111320;
const mLon = 111320 * Math.cos(meta.centerLat * (Math.PI / 180));
const toLL = (x, z) => [+(meta.centerLat - z / mLat).toFixed(4), +(meta.centerLon + x / mLon).toFixed(4)];
const inBox = (x, z) => Math.abs(x) <= LIM && Math.abs(z) <= LIM;
const nrm = new THREE.Vector3();
const vec = new THREE.Vector3();

/** The tallest roof within r of a point, above the ground it stands on. */
function roofNear(x, z, r) {
  if (!buildings?.hitGrid) return -Infinity;
  const d = buildings.data;
  let top = -Infinity;
  const cells = Math.ceil(r / 128);
  for (let gx = -cells; gx <= cells; gx++) {
    for (let gz = -cells; gz <= cells; gz++) {
      const list = buildings.hitGrid.get(
        Math.floor((x + gx * 128) / 128) * 4096 + Math.floor((z + gz * 128) / 128)
      );
      if (!list) continue;
      for (const i of list) {
        const ox = d.origin[i * 2];
        const oz = d.origin[i * 2 + 1];
        if ((ox - x) ** 2 + (oz - z) ** 2 > r * r) continue;
        if (buildings.colTop[i] > top) top = buildings.colTop[i];
      }
    }
  }
  return top;
}

/** Highest ground within r, so a gate can be put above everything near it. */
function peakNear(x, z, r) {
  let hi = -Infinity;
  for (let a = 0; a < 12; a++) {
    for (let k = 1; k <= 2; k++) {
      const rad = (r * k) / 2;
      const gx = x + Math.cos((a / 12) * Math.PI * 2) * rad;
      const gz = z + Math.sin((a / 12) * Math.PI * 2) * rad;
      hi = Math.max(hi, hf.heightAt(gx, gz));
    }
  }
  return Math.max(hi, hf.heightAt(x, z));
}

// -------------------------------------------------------------- chaining ---
/** Chain network fragments that share an endpoint into continuous runs. */
function chains(kinds) {
  const segs = [];
  for (const w of ways) {
    if (!kinds.has(w.kind)) continue;
    const pts = [];
    for (let i = 0; i < w.pts.length; i += 2) pts.push({ x: w.pts[i], z: w.pts[i + 1] });
    if (pts.length > 1) segs.push(pts);
  }
  const key = (q) => `${Math.round(q.x / 6)},${Math.round(q.z / 6)}`;
  const ends = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s[0]), key(s[s.length - 1])]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Set();
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let chain = segs[i].slice();
    let grew = true;
    while (grew) {
      grew = false;
      for (const head of [false, true]) {
        const q = chain[head ? 0 : chain.length - 1];
        for (const j of ends.get(key(q)) ?? []) {
          if (used.has(j)) continue;
          const s = segs[j];
          const atStart = key(s[0]) === key(q);
          const add = atStart ? s.slice(1) : s.slice(0, -1).reverse();
          used.add(j);
          chain = head ? [...add.reverse(), ...chain] : [...chain, ...add];
          grew = true;
          break;
        }
        if (grew) break;
      }
    }
    out.push(chain);
  }
  return out;
}

const runLength = (c) => {
  let l = 0;
  for (let i = 1; i < c.length; i++) l += Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z);
  return l;
};
/** Resample a polyline to a fixed spacing, so gates and corridors are even. */
function resample(c, spacing) {
  const out = [c[0]];
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    let seg = Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z);
    let from = c[i - 1];
    while (acc + seg >= spacing) {
      const t = (spacing - acc) / seg;
      const q = { x: from.x + (c[i].x - from.x) * t, z: from.z + (c[i].z - from.z) * t };
      out.push(q);
      from = q;
      seg = Math.hypot(c[i].x - q.x, c[i].z - q.z);
      acc = 0;
    }
    acc += seg;
  }
  const last = c[c.length - 1];
  if (Math.hypot(out[out.length - 1].x - last.x, out[out.length - 1].z - last.z) > spacing * 0.4) out.push(last);
  return out;
}
const bearing = (a, b) => (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
const spread = (used, x, z, r) => !used.some((u) => Math.hypot(u.x - x, u.z - z) < r);

/**
 * Where the challenges already in the table start, in local metres.
 *
 * Seeded into every candidate's `used` list, so a proposal can never land on top
 * of a course somebody already flew. The first batch had no idea what was
 * already there and it showed: two of its slaloms opened within a few hundred
 * metres of hand-authored ones.
 */
const EXISTING = (CHALLENGES[REGION_ID] ?? []).map((d) => {
  const v = world.toLocal(d.marker.lat, d.marker.lon);
  return { x: v.x, z: v.z };
});

// ---------------------------------------------------------------- slalom ---
/**
 * Gate courses along roads and railways.
 *
 * A road is a flight path somebody else already solved: it goes along the
 * valley, it does not go through the mountain, and it is where the interesting
 * ground is. The gates go a fixed height above the highest ground near each
 * point, so a course through a gorge sits in the gorge and one over a pass
 * clears the pass.
 */
function slaloms(limit) {
  const cands = [];
  for (const c of chains(COURSE_KINDS)) {
    const len = runLength(c);
    // Measured from the first batch: 3.7 km of gates flies in 67 s and 4.5 km
    // in 87, so anything past about four kilometres cannot fit a bronze under
    // the ninety-second cap and gets thrown away after being calibrated. Sizing
    // the proposal to the cap up front is free; discovering it afterwards costs
    // a calibration run per course.
    if (len < 2100 || len > 4300) continue;
    if (!c.every((q) => inBox(q.x, q.z))) continue;
    const gates = resample(c, len / 4).slice(0, 5);
    if (gates.length < 4) continue;
    // Straightness: a course that doubles back on itself is not a course, and a
    // dead-straight one is not a slalom either.
    const end = Math.hypot(gates[gates.length - 1].x - gates[0].x, gates[gates.length - 1].z - gates[0].z);
    const wiggle = end / len;
    if (wiggle < 0.45 || wiggle > 0.97) continue;
    let relief = 0;
    let ok = true;
    const built = [];
    for (const q of gates) {
      const g = hf.heightAt(q.x, q.z);
      const peak = peakNear(q.x, q.z, 320);
      const roof = roofNear(q.x, q.z, 260);
      // Clear the local ground AND anything standing on it.
      const agl = Math.max(180, peak - g + 120, roof > -Infinity ? roof - g + 110 : 0);
      if (agl > 900) ok = false;
      relief = Math.max(relief, peak - g);
      built.push({ ...q, agl: Math.round(agl / 10) * 10 });
    }
    if (!ok) continue;
    // Something has to be near it, or it is a course through nowhere.
    const near = world.places.reduce(
      (best, pl) => Math.min(best, Math.hypot(pl.x - gates[0].x, pl.z - gates[0].z)),
      Infinity
    );
    cands.push({ gates: built, len, relief, near, score: relief * 2 + len * 0.05 - near * 0.04 });
  }
  cands.sort((a, b) => b.score - a.score);
  const used = [...EXISTING];
  const out = [];
  for (const c of cands) {
    if (out.length >= limit) break;
    if (!spread(used, c.gates[0].x, c.gates[0].z, 1500)) continue;
    used.push(c.gates[0]);
    out.push(c);
  }
  return out;
}

// ------------------------------------------------------------------ deck ---
/** Distance to the nearest dry cell, so a channel's middle can be found. */
function wetDepth() {
  const d = new Int16Array(N * N).fill(-1);
  let f = [];
  for (let q = 0; q < N * N; q++) if (!wet[q]) { d[q] = 0; f.push(q); }
  let step = 0;
  while (f.length && step < 40) {
    step++;
    const nx = [];
    for (const q of f) {
      const i = q % N;
      const j = (q / N) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const k = b * N + a;
        if (d[k] < 0) { d[k] = step; nx.push(k); }
      }
    }
    f = nx;
  }
  return d;
}

/**
 * Low corridors. Over water where there is water — a fjord or a shoreline is
 * the safest deck run there is — and otherwise along a valley road, which is by
 * construction the lowest flat line through the terrain.
 */
function decks(limit) {
  const depth = wetDepth();
  const out = [];
  const used = [...EXISTING];
  // Water first, walking the widest channel from each of a few seeds.
  const seeds = [];
  for (let j = 4; j < N; j += 24) {
    for (let i = 4; i < N; i += 24) {
      const q = j * N + i;
      if (!wet[q] || depth[q] < 4) continue;
      seeds.push({ i, j, w: depth[q] * STEP });
    }
  }
  seeds.sort((a, b) => b.w - a.w);
  for (const s of seeds) {
    if (out.length >= Math.ceil(limit * 0.7)) break;
    const x0 = -HALF + s.i * STEP;
    const z0 = -HALF + s.j * STEP;
    if (!inBox(x0, z0) || !spread(used, x0, z0, 2600)) continue;
    // Walk both ways along the channel, always to the widest neighbour ahead.
    const path = [{ x: x0, z: z0 }];
    for (const dir of [1, -1]) {
      let cur = { x: x0, z: z0 };
      let head = null;
      for (let n = 0; n < 20; n++) {
        let best = null;
        for (let a = 0; a < 24; a++) {
          const th = (a / 24) * Math.PI * 2;
          const nx2 = cur.x + Math.cos(th) * 420;
          const nz = cur.z + Math.sin(th) * 420;
          if (!inBox(nx2, nz)) continue;
          const i2 = Math.round((nx2 + HALF) / STEP);
          const j2 = Math.round((nz + HALF) / STEP);
          if (i2 < 0 || j2 < 0 || i2 >= N || j2 >= N) continue;
          const q2 = j2 * N + i2;
          if (!wet[q2]) continue;
          const turn = head ? Math.cos(th - head) : 1;
          if (turn < 0.55) continue;
          const score = depth[q2] * STEP + turn * 260;
          if (!best || score > best.score) best = { x: nx2, z: nz, score, th };
        }
        if (!best) break;
        head = best.th;
        cur = { x: best.x, z: best.z };
        if (dir > 0) path.push(cur);
        else path.unshift(cur);
      }
    }
    if (path.length < 7) continue;
    const len = runLength(path);
    if (len < 3200) continue;
    let halfW = Infinity;
    for (const q of path) {
      const i2 = Math.round((q.x + HALF) / STEP);
      const j2 = Math.round((q.z + HALF) / STEP);
      halfW = Math.min(halfW, (depth[j2 * N + i2] ?? 0) * STEP);
    }
    if (halfW < 60) continue;
    used.push(path[0]);
    out.push({ path, len, width: Math.round(Math.min(320, Math.max(80, halfW * 0.85)) / 10) * 10, ceiling: 40, water: true });
  }
  // Then valley roads, for maps whose water is a puddle.
  for (const c of chains(COURSE_KINDS)) {
    if (out.length >= limit) break;
    const len = runLength(c);
    if (len < 4200 || len > 12000) continue;
    if (!c.every((q) => inBox(q.x, q.z))) continue;
    const path = resample(c, 420);
    if (path.length < 9) continue;
    // Must be genuinely low and genuinely clear: a corridor with a roof in it is
    // the Chicago river mistake all over again.
    let ok = true;
    let climb = 0;
    let prev = null;
    for (const q of path) {
      const g = hf.heightAt(q.x, q.z);
      if (roofNear(q.x, q.z, 90) > g + 45) ok = false;
      if (prev != null) climb = Math.max(climb, Math.abs(g - prev) / 420);
      prev = g;
    }
    if (!ok || climb > 0.14) continue;
    if (!spread(used, path[0].x, path[0].z, 2600)) continue;
    used.push(path[0]);
    out.push({ path: path.slice(0, 14), len, width: 130, ceiling: 55, water: false });
  }
  return out.slice(0, limit);
}

// --------------------------------------------------------------- gunnery ---
/** A straight line of open air with nothing under it worth hitting. */
function gunneries(limit) {
  const out = [];
  const used = [...EXISTING];
  const cands = [];
  for (let j = 8; j < N; j += 16) {
    for (let i = 8; i < N; i += 16) {
      const x = -HALF + i * STEP;
      const z = -HALF + j * STEP;
      if (!inBox(x, z)) continue;
      for (const hdg of [0, 45, 90, 135]) {
        const rad = (hdg * Math.PI) / 180;
        const fx = Math.sin(rad);
        const fz = -Math.cos(rad);
        let ok = true;
        let ground = -Infinity;
        for (let d = 0; d <= 3000; d += 250) {
          const px = x + fx * d;
          const pz = z + fz * d;
          if (!inBox(px, pz)) { ok = false; break; }
          const g = hf.heightAt(px, pz);
          if (roofNear(px, pz, 260) > g + 120) { ok = false; break; }
          ground = Math.max(ground, g);
        }
        if (!ok) continue;
        const base = hf.heightAt(x, z);
        // The whole line has to sit under the field, or the balloons are in rock.
        if (ground - base > 220) continue;
        cands.push({ x, z, hdg, base, score: -Math.abs(ground - base) });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) {
    if (out.length >= limit) break;
    if (!spread(used, c.x, c.z, 4200)) continue;
    const rad = (c.hdg * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fz = -Math.cos(rad);
    used.push(c);
    out.push({
      marker: { x: c.x, z: c.z, hdg: c.hdg },
      path: [800, 1900, 3000].map((d) => ({ x: c.x + fx * d, z: c.z + fz * d })),
    });
  }
  return out;
}

// ---------------------------------------------------------- height, dash ---
/** Where the air actually goes up, sampled honestly. */
function heights_(limit) {
  const cands = [];
  for (let j = 6; j < N; j += 14) {
    for (let i = 6; i < N; i += 14) {
      const x = -HALF + i * STEP;
      const z = -HALF + j * STEP;
      if (!inBox(x, z) || wet[j * N + i]) continue;
      const g = hf.heightAt(x, z);
      // Sampled as a BAND, not a point, and against a margin the calibrator's
      // own survey will still agree with. One sample at ground+240 beating min
      // sink by 1.1 m/s passed six sites the calibrator then reported as
      // unclimbable — a speck of ridge lift on one cell is not a site, and the
      // survey looks for air a real climb policy can work within 2.6 km.
      const w = air.sample(vec.set(x, g + 240, z), new THREE.Vector3()).y;
      if (w < BOOK.minSink + 2.2) continue;
      let band = 0;
      for (let a = 0; a < 6; a++) {
        const th = (a / 6) * Math.PI * 2;
        const bx = x + Math.cos(th) * 400;
        const bz = z + Math.sin(th) * 400;
        if (!inBox(bx, bz)) continue;
        const bw = air.sample(vec.set(bx, hf.heightAt(bx, bz) + 240, bz), new THREE.Vector3()).y;
        if (bw > BOOK.minSink + 1.2) band++;
      }
      if (band < 3) continue;
      cands.push({ x, z, w, g });
    }
  }
  cands.sort((a, b) => b.w - a.w);
  const out = [];
  const used = [...EXISTING];
  for (const c of cands) {
    if (out.length >= limit) break;
    if (!spread(used, c.x, c.z, 3600)) continue;
    used.push(c);
    out.push(c);
  }
  return out;
}

/** A high start with a long way to fall. Downwind, because that is furthest. */
function dashes(limit) {
  const w = R.air.wind;
  const hdg = Math.round((Math.atan2(w.x, -w.z) * 180) / Math.PI + 360) % 360;
  const cands = [];
  for (let j = 6; j < N; j += 14) {
    for (let i = 6; i < N; i += 14) {
      const x = -HALF + i * STEP;
      const z = -HALF + j * STEP;
      if (!inBox(x, z) || wet[j * N + i]) continue;
      // Room to run: eight kilometres of box in the chosen direction.
      const fx = Math.sin((hdg * Math.PI) / 180);
      const fz = -Math.cos((hdg * Math.PI) / 180);
      if (!inBox(x + fx * 8000, z + fz * 8000)) continue;
      cands.push({ x, z, g: hf.heightAt(x, z), hdg });
    }
  }
  cands.sort((a, b) => b.g - a.g);
  const out = [];
  const used = [...EXISTING];
  for (const c of cands) {
    if (out.length >= limit) break;
    if (!spread(used, c.x, c.z, 5200)) continue;
    used.push(c);
    out.push(c);
  }
  return out;
}

// ----------------------------------------------------------------- emit ---
/** The nearest named place, which is what a challenge should be called after. */
function placeNear(x, z) {
  let best = null;
  let bd = Infinity;
  for (const pl of world.places) {
    const d = Math.hypot(pl.x - x, pl.z - z);
    if (d < bd) { bd = d; best = pl; }
  }
  return { name: best?.name ?? REGION_ID, distance: bd };
}
const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const taken = new Set((CHALLENGES[REGION_ID] ?? []).map((d) => d.id));
function idFor(base, kind) {
  let id = `${slug(base)}-${kind}`;
  let n = 2;
  while (taken.has(id)) id = `${slug(base)}-${kind}-${n++}`;
  taken.add(id);
  return id;
}

const defs = [];
for (const c of slaloms(WANT.slalom)) {
  const pl = placeNear(c.gates[0].x, c.gates[0].z);
  defs.push({
    id: idFor(pl.name, 'run'),
    type: 'slalom',
    name: `${pl.name} Run`,
    where: `${c.gates.length} gates, ${(c.len / 1000).toFixed(1)} km`,
    blurb: `${c.gates.length} gates along ${(c.len / 1000).toFixed(1)} km of valley, ${Math.round(c.relief)} m of wall beside you.`,
    marker: { ...toLLObj(c.gates[0], Math.round(c.gates[0].agl + 220)), heading: ((Math.round(bearing(c.gates[0], c.gates[1])) % 360) + 360) % 360 },
    limit: 90,
    medals: [80, 68, 58],
    calibrate: true,
    gates: c.gates.map((q, i) => ({
      name: `Gate ${i + 1}`,
      ...toLLObj(q, q.agl),
      radius: 110,
    })),
  });
}
for (const c of decks(WANT.deck)) {
  const pl = placeNear(c.path[0].x, c.path[0].z);
  defs.push({
    id: idFor(pl.name, c.water ? 'water' : 'floor'),
    type: 'deck',
    name: `${pl.name} ${c.water ? 'Water' : 'Floor'}`,
    where: `${(c.len / 1000).toFixed(1)} km ${c.water ? 'of open water' : 'of valley floor'}`,
    blurb: `Sixty seconds under ${c.ceiling} m along ${(c.len / 1000).toFixed(1)} km ${c.water ? 'of water' : 'of valley'}.`,
    marker: { ...toLLObj(c.path[0], c.ceiling + 20), heading: ((Math.round(bearing(c.path[0], c.path[1])) % 360) + 360) % 360 },
    window: 60,
    deck: { ceiling: c.ceiling, width: c.width, path: c.path.map((q) => toLL(q.x, q.z)) },
    medals: [25, 35, 45],
    calibrate: true,
  });
}
for (const c of gunneries(WANT.gunnery)) {
  const pl = placeNear(c.marker.x, c.marker.z);
  defs.push({
    id: idFor(pl.name, 'field'),
    type: 'gunnery',
    name: `The ${pl.name} Field`,
    where: 'A line of balloons',
    blurb: 'A line of balloons. Ninety seconds and three hundred rounds.',
    rounds: 300,
    marker: { ...toLLObj(c.marker, 240), heading: c.marker.hdg },
    window: 90,
    targets: { count: 12, height: [180, 260], spread: 35, path: c.path.map((q) => toLL(q.x, q.z)) },
    medals: [3, 4, 5],
    calibrate: true,
  });
}
for (const c of heights_(WANT.height)) {
  const pl = placeNear(c.x, c.z);
  defs.push({
    id: idFor(pl.name, 'lift'),
    type: 'height',
    name: `${pl.name} Lift`,
    where: `Surveyed at ${c.w.toFixed(1)} m/s`,
    blurb: `Engine shut. Sixty seconds on air surveyed at ${c.w.toFixed(1)} m/s.`,
    marker: { ...toLLObj({ x: c.x, z: c.z }, 240), heading: 90 },
    window: 60,
    medals: [50, 70, 90],
    calibrate: true,
  });
}
for (const c of dashes(WANT.distance)) {
  const pl = placeNear(c.x, c.z);
  defs.push({
    id: idFor(pl.name, 'dash'),
    type: 'distance',
    name: `${pl.name} Dash`,
    where: 'Ninety seconds, one direction',
    blurb: 'Ninety seconds. Take the line the ground gives you and do not turn.',
    marker: { ...toLLObj({ x: c.x, z: c.z }, 900), heading: c.hdg },
    window: 90,
    medals: [3000, 4200, 5400],
    calibrate: true,
  });
}

function toLLObj(q, agl) {
  const [lat, lon] = toLL(q.x, q.z);
  return { lat, lon, agl: Math.round(agl) };
}

// Stagger the unlocks across whatever the map ends up holding.
const existing = (CHALLENGES[REGION_ID] ?? []).length;
defs.forEach((d, i) => {
  d.needs = Math.min(existing + defs.length - 1, Math.round(((i + 1) / defs.length) * (existing + defs.length) * 0.7));
});

if (JSON_OUT) {
  console.log(JSON.stringify(defs, null, 2));
} else {
  console.log(`// ${R.name}: ${defs.length} proposals — ladders are placeholders, calibrate before shipping`);
  for (const d of defs) console.log(fmt(d));
  const by = {};
  for (const d of defs) by[d.type] = (by[d.type] ?? 0) + 1;
  console.error(`${R.name}: proposed ${defs.length} — ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}`);
}

/** Print a def the way regions.js writes them. */
function fmt(d) {
  const j = (v) => JSON.stringify(v);
  const lines = [
    '    {',
    `      id: '${d.id}',`,
    `      type: '${d.type}',`,
    `      name: ${j(d.name)},`,
    `      where: ${j(d.where)},`,
    `      blurb: ${j(d.blurb)},`,
    `      needs: ${d.needs},`,
    `      marker: { lat: ${d.marker.lat}, lon: ${d.marker.lon}, agl: ${d.marker.agl}, heading: ${d.marker.heading} },`,
  ];
  if (d.rounds) lines.push(`      rounds: ${d.rounds},`);
  if (d.limit) lines.push(`      limit: ${d.limit},`);
  if (d.window) lines.push(`      window: ${d.window},`);
  if (d.deck) {
    lines.push('      deck: {');
    lines.push(`        ceiling: ${d.deck.ceiling},`);
    lines.push(`        width: ${d.deck.width},`);
    lines.push('        path: [');
    for (const q of d.deck.path) lines.push(`          [${q[0]}, ${q[1]}],`);
    lines.push('        ],');
    lines.push('      },');
  }
  if (d.targets) {
    lines.push('      targets: {');
    lines.push(`        count: ${d.targets.count},`);
    lines.push(`        height: [${d.targets.height.join(', ')}],`);
    lines.push(`        spread: ${d.targets.spread},`);
    lines.push('        path: [');
    for (const q of d.targets.path) lines.push(`          [${q[0]}, ${q[1]}],`);
    lines.push('        ],');
    lines.push('      },');
  }
  if (d.gates) {
    lines.push('      gates: [');
    for (const g of d.gates) {
      lines.push(`        { name: ${j(g.name)}, lat: ${g.lat}, lon: ${g.lon}, agl: ${g.agl}, radius: ${g.radius} },`);
    }
    lines.push('      ],');
  }
  // The flag tools/apply-calibration.mjs looks for. Without it in the emitted
  // text the applier has no way to tell a proposal from a ladder somebody
  // argued over, so it refuses to touch anything — which is what happened the
  // first time this ran.
  if (d.calibrate) lines.push('      calibrate: true,');
  lines.push(`      medals: [${d.medals.join(', ')}],`);
  lines.push('    },');
  return lines.join('\n');
}
