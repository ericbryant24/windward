/**
 * Turns the raw OpenStreetMap dump into the compact footprint file the game
 * loads.
 *
 * Footprints, positions and orientations are real. Heights are not: only 46 of
 * the 45,393 buildings carry a height tag and 551 carry building:levels, so
 * everything else is inferred from what kind of building it is and how big its
 * footprint is. Roof pitch is likewise inferred except where roof:shape says
 * otherwise.
 *
 *   node tools/fetch-buildings.mjs && node tools/bake-buildings.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const META = JSON.parse(await readFile('data/jungfrau.json', 'utf8'));
const MPD_LAT = 111320;
const MPD_LON = 111320 * Math.cos((META.centerLat * Math.PI) / 180);
const HALF = META.halfSize;

/** Structures modelled by hand; drop the OSM footprint so they do not double up. */
const HAND_MODELLED = [
  { lat: 46.5474, lon: 7.9806, radius: 90 }, // Jungfraujoch / Sphinx
  { lat: 46.5556, lon: 7.8347, radius: 70 }, // Schilthorn / Piz Gloria
];

/**
 * Storey heights and roof style per building type. Alpine barns and chalets
 * are low and steeply pitched; the hotels in the valley towns are not.
 */
const TYPES = {
  //                    id, storeys, floorH, roof: 0 flat 1 gabled, pitch
  barn: [1, 1, 5.2, 1, 0.55],
  farm: [1, 2, 3.2, 1, 0.5],
  farm_auxiliary: [1, 1, 4.2, 1, 0.5],
  stable: [1, 1, 4.2, 1, 0.5],
  cowshed: [1, 1, 4.2, 1, 0.5],
  shed: [2, 1, 2.8, 1, 0.42],
  garage: [2, 1, 2.7, 1, 0.3],
  garages: [2, 1, 2.9, 1, 0.3],
  carport: [2, 1, 2.6, 1, 0.25],
  hut: [2, 1, 2.9, 1, 0.5],
  cabin: [3, 1, 3.0, 1, 0.5],
  chapel: [4, 1, 6.5, 1, 0.6],
  church: [4, 1, 11.0, 1, 0.7],
  cathedral: [4, 1, 14.0, 1, 0.7],
  house: [3, 2, 3.1, 1, 0.5],
  detached: [3, 2, 3.1, 1, 0.5],
  residential: [3, 2, 3.1, 1, 0.48],
  apartments: [5, 4, 3.0, 1, 0.35],
  hotel: [5, 4, 3.1, 1, 0.35],
  commercial: [5, 3, 3.6, 0, 0.1],
  retail: [5, 2, 4.0, 0, 0.1],
  office: [5, 3, 3.4, 0, 0.1],
  industrial: [6, 1, 7.0, 0, 0.1],
  warehouse: [6, 1, 7.5, 0, 0.1],
  school: [5, 3, 3.6, 1, 0.3],
  hospital: [5, 4, 3.5, 0, 0.1],
  train_station: [5, 2, 4.5, 1, 0.3],
  civic: [5, 2, 4.0, 1, 0.35],
  public: [5, 2, 4.0, 1, 0.35],
  roof: [7, 1, 3.2, 1, 0.25],
  greenhouse: [7, 1, 3.4, 1, 0.3],
  yes: [0, 2, 3.1, 1, 0.48],
};
const DEFAULT_TYPE = TYPES.yes;

const project = (lat, lon) => [(lon - META.centerLon) * MPD_LON, (META.centerLat - lat) * MPD_LAT];

// ------------------------------------------------------------------ shape ---
function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

/** Drop duplicate and near-collinear corners; OSM rings carry plenty of both. */
function simplify(ring, tolerance = 0.35) {
  let out = ring.filter((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > tolerance;
  });
  if (out.length < 3) return out;
  for (let pass = 0; pass < 3 && out.length > 4; pass++) {
    const keep = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      // perpendicular distance of b from the line a->c
      const ax = c[0] - a[0];
      const az = c[1] - a[1];
      const len = Math.hypot(ax, az) || 1;
      const d = Math.abs((b[0] - a[0]) * az - (b[1] - a[1]) * ax) / len;
      if (d > tolerance) keep.push(b);
    }
    if (keep.length < 4 || keep.length === out.length) break;
    out = keep;
  }
  return out;
}

/** Minimum-area enclosing rectangle, brute-forced over edge directions. */
function orientedBox(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const ex = ring[j][0] - ring[i][0];
    const ez = ring[j][1] - ring[i][1];
    const len = Math.hypot(ex, ez);
    if (len < 0.2) continue;
    const ux = ex / len;
    const uz = ez / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [px, pz] of ring) {
      const u = px * ux + pz * uz;
      const v = -px * uz + pz * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, ux, uz, minU, maxU, minV, maxV };
    }
  }
  if (!best) return null;
  const cu = (best.minU + best.maxU) / 2;
  const cv = (best.minV + best.maxV) / 2;
  return {
    cx: cu * best.ux - cv * best.uz,
    cz: cu * best.uz + cv * best.ux,
    width: best.maxU - best.minU,
    depth: best.maxV - best.minV,
    angle: Math.atan2(best.uz, best.ux),
  };
}

// ------------------------------------------------------------------ bake ---
const raw = JSON.parse(await readFile('.cache/osm-buildings.json', 'utf8'));
console.log(`read ${raw.length} OSM ways`);

const buildings = [];
let skippedTiny = 0;
let skippedOutside = 0;
let skippedHandModelled = 0;

for (const el of raw) {
  const geom = el.geometry;
  if (!geom || geom.length < 4) continue;
  const tags = el.tags ?? {};

  // OSM closes the ring by repeating the first node
  let ring = geom.slice(0, -1).map((p) => project(p.lat, p.lon));
  if (ring.length < 3) continue;

  if (
    HAND_MODELLED.some((h) => {
      const [hx, hz] = project(h.lat, h.lon);
      return Math.hypot(ring[0][0] - hx, ring[0][1] - hz) < h.radius;
    })
  ) {
    skippedHandModelled++;
    continue;
  }

  if (signedArea(ring) < 0) ring.reverse(); // normalise to a consistent winding
  ring = simplify(ring);
  if (ring.length < 3) continue;
  // Bounded on purpose: simplify() stops once every remaining corner carries
  // shape, so looping until the ring is short enough never terminates on a
  // genuinely complex outline.
  for (let attempt = 0; ring.length > 16 && attempt < 6; attempt++) {
    const next = simplify(ring, 1.0 + attempt * 1.5);
    if (next.length >= ring.length || next.length < 3) break;
    ring = next;
  }
  if (ring.length > 24) {
    const stride = Math.ceil(ring.length / 24);
    ring = ring.filter((_, i) => i % stride === 0);
  }

  const area = Math.abs(signedArea(ring));
  if (area < 14) {
    skippedTiny++;
    continue;
  }

  const box = orientedBox(ring);
  if (!box) continue;

  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  if (Math.abs(cx) > HALF - 50 || Math.abs(cz) > HALF - 50) {
    skippedOutside++;
    continue;
  }

  const spec = TYPES[tags.building] ?? (tags.amenity === 'place_of_worship' ? TYPES.church : DEFAULT_TYPE);
  const [typeId, storeys, floorH, defaultRoof, defaultPitch] = spec;

  // Real data first, inference only where the tags are silent.
  let wallHeight;
  if (tags.height) wallHeight = parseFloat(tags.height) * 0.8;
  else if (tags['building:levels']) wallHeight = parseFloat(tags['building:levels']) * floorH + 1.0;
  else wallHeight = storeys * floorH + 1.0;
  if (!isFinite(wallHeight) || wallHeight < 2) wallHeight = storeys * floorH + 1.0;
  // a big footprint is rarely a low building
  wallHeight *= 1 + Math.min(0.35, Math.max(0, (area - 180) / 2600));

  const shape = tags['roof:shape'];
  let roofKind = defaultRoof;
  let pitch = defaultPitch;
  if (shape === 'flat') roofKind = 0;
  else if (shape) roofKind = 1;
  if (shape === 'pyramidal' || shape === 'dome') pitch = 0.85;
  if (tags['roof:levels']) pitch = Math.max(pitch, parseFloat(tags['roof:levels']) * 0.35);
  // steep pitch on a wide barn would make a spire; scale by the short side
  const roofHeight = roofKind === 0 ? 0.6 : Math.min(box.depth * 0.5 * pitch * 2, 14);

  buildings.push({ ring, cx, cz, box, wallHeight, roofHeight, roofKind, typeId, area });
}

buildings.sort((a, b) => a.cz - b.cz || a.cx - b.cx);
console.log(
  `kept ${buildings.length} (dropped ${skippedTiny} under 14 m2, ${skippedOutside} outside, ${skippedHandModelled} hand-modelled)`
);

// ---------------------------------------------------------------- encode ---
// int16 everywhere: origin in metres from the region centre, corners in
// centimetres from that origin, heights in decimetres.
const VERT_SCALE = 100;
let vertexTotal = 0;
for (const b of buildings) vertexTotal += b.ring.length;

const bytes = 12 + buildings.length * 12 + vertexTotal * 4;
const buf = Buffer.alloc(bytes);
let o = 0;
buf.write('WBLD', o);
o += 4;
buf.writeUInt16LE(1, o);
o += 2;
buf.writeUInt16LE(0, o);
o += 2;
buf.writeUInt32LE(buildings.length, o);
o += 4;

for (const b of buildings) {
  const ox = Math.round(b.cx);
  const oz = Math.round(b.cz);
  buf.writeInt16LE(ox, o);
  o += 2;
  buf.writeInt16LE(oz, o);
  o += 2;
  buf.writeUInt16LE(Math.min(65535, Math.round(b.wallHeight * 10)), o);
  o += 2;
  buf.writeUInt16LE(Math.min(65535, Math.round(b.roofHeight * 10)), o);
  o += 2;
  buf.writeInt16LE(Math.round((b.box.angle * 10000) / Math.PI), o);
  o += 2;
  buf.writeUInt8(b.ring.length, o);
  o += 1;
  buf.writeUInt8(b.typeId | (b.roofKind << 4), o);
  o += 1;
  for (const [px, pz] of b.ring) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((px - ox) * VERT_SCALE))), o);
    o += 2;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((pz - oz) * VERT_SCALE))), o);
    o += 2;
  }
}

const gz = gzipSync(buf, { level: 9 });
await mkdir('data', { recursive: true });
await writeFile('data/buildings.bin.gz', gz);

const meta = {
  generator: 'tools/bake-buildings.mjs',
  source: 'OpenStreetMap contributors, ODbL — see ATTRIBUTION.md',
  count: buildings.length,
  vertices: vertexTotal,
  vertexScale: VERT_SCALE,
  note: 'Footprints and orientations are surveyed data. Heights are inferred from building type and footprint area; OSM carries a height for only 46 of these.',
};
await writeFile('data/buildings.json', JSON.stringify(meta, null, 2));

console.log(`raw ${(bytes / 1048576).toFixed(2)} MB -> gzip ${(gz.length / 1048576).toFixed(2)} MB`);
console.log(`${vertexTotal} corners, ${(vertexTotal / buildings.length).toFixed(1)} per building`);
