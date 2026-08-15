/**
 * Turns the raw OpenStreetMap dump into the compact footprint file the game
 * loads.
 *
 *   node tools/fetch-buildings.mjs chicago && node tools/bake-buildings.mjs chicago
 *
 * What is surveyed and what is invented differs sharply between regions, and
 * the baker reports the split so the claim in ATTRIBUTION stays honest. In the
 * Alps almost nothing carries a height, so heights are inferred from building
 * type and footprint area. Downtown Chicago tags around half of them, and the
 * towers that matter are mapped under Simple 3D Buildings — a `type=building`
 * relation with an outline that carries no height, and `building:part` members
 * that each stop at a different level. Those parts are the setbacks. Extrude
 * the outline instead and Willis Tower is a flat slab.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { regionFromArgv, paths, projector } from './regions.mjs';
import { assembleRings, signedArea, centroid, pointInRing, simplify, orientedBox, parseLength } from './geometry.mjs';

const R = regionFromArgv();
const OUT = paths(R);
const META = JSON.parse(await readFile(OUT.meta, 'utf8'));
const HALF = META.halfSize;
const project = projector(R);

/**
 * Structures modelled by hand in src/buildings.js; drop the OSM footprint so
 * they do not double up. A radius clears a whole site — the alpine summit
 * stations are half a dozen ways apiece and nothing else is within a hundred
 * metres of either.
 */
const HAND_MODELLED = {
  jungfrau: [
    { lat: 46.5474, lon: 7.9806, radius: 90 }, // Jungfraujoch / Sphinx
    { lat: 46.5556, lon: 7.8347, radius: 70 }, // Schilthorn / Piz Gloria
  ],
  chicago: [],
};

/**
 * The same, named by OSM id instead.
 *
 * Downtown has no room for a radius. Soldier Field's colonnades stand inside
 * the stadium's own outline, so no circle reaches them without taking the bowl
 * as well; Navy Pier's wheel has a carousel 34 m away and a footprint whose
 * far corner is 31 m out. Naming the way is exact, and it fails loudly — an id
 * that matches nothing is reported below, where a radius that has drifted off
 * its target silently leaves the slab standing.
 */
const HAND_MODELLED_IDS = {
  chicago: [
    'way/686996484', // Centennial Wheel
    'way/137060274', // Cloud Gate
    'way/766776875', // Soldier Field, east colonnade
    'way/766776876', // Soldier Field, west colonnade
  ],
};

export const ROOF = {
  FLAT: 0,
  GABLED: 1,
  HIPPED: 2,
  PYRAMIDAL: 3,
  DOME: 4,
  SKILLION: 5,
  MANSARD: 6,
  BARREL: 7,
  SPIRE: 8,
};

const ROOF_TAGS = {
  flat: ROOF.FLAT,
  gabled: ROOF.GABLED,
  'gambrel': ROOF.MANSARD,
  hipped: ROOF.HIPPED,
  'half-hipped': ROOF.HIPPED,
  pyramidal: ROOF.PYRAMIDAL,
  dome: ROOF.DOME,
  onion: ROOF.DOME,
  round: ROOF.BARREL,
  barrel: ROOF.BARREL,
  skillion: ROOF.SKILLION,
  'lean_to': ROOF.SKILLION,
  mansard: ROOF.MANSARD,
  spherical: ROOF.DOME,
  cone: ROOF.SPIRE,
  spire: ROOF.SPIRE,
  'quadruple_saltbox': ROOF.GABLED,
  saltbox: ROOF.GABLED,
};

/** Facade classes the renderer knows how to shade. */
export const MATERIAL = {
  RENDER: 0, // painted render / stucco — the alpine default
  GLASS: 1, // curtain wall
  STONE: 2, // limestone, terracotta, cut masonry
  BRICK: 3,
  CONCRETE: 4,
  METAL: 5, // industrial cladding
  TIMBER: 6,
};

const MATERIAL_TAGS = {
  glass: MATERIAL.GLASS,
  mirror: MATERIAL.GLASS,
  brick: MATERIAL.BRICK,
  brick_block: MATERIAL.BRICK,
  stone: MATERIAL.STONE,
  limestone: MATERIAL.STONE,
  sandstone: MATERIAL.STONE,
  marble: MATERIAL.STONE,
  granite: MATERIAL.STONE,
  concrete: MATERIAL.CONCRETE,
  cement_block: MATERIAL.CONCRETE,
  metal: MATERIAL.METAL,
  steel: MATERIAL.METAL,
  metal_sheet: MATERIAL.METAL,
  wood: MATERIAL.TIMBER,
  timber_framing: MATERIAL.TIMBER,
  plaster: MATERIAL.RENDER,
  stucco: MATERIAL.RENDER,
};

/**
 * Storey heights and roof style per building type. Alpine barns and chalets
 * are low and steeply pitched; the hotels in the valley towns are not.
 */
const TYPES = {
  //                    id, storeys, floorH, roof, pitch
  barn: [1, 1, 5.2, ROOF.GABLED, 0.55],
  farm: [1, 2, 3.2, ROOF.GABLED, 0.5],
  farm_auxiliary: [1, 1, 4.2, ROOF.GABLED, 0.5],
  stable: [1, 1, 4.2, ROOF.GABLED, 0.5],
  cowshed: [1, 1, 4.2, ROOF.GABLED, 0.5],
  shed: [2, 1, 2.8, ROOF.GABLED, 0.42],
  garage: [2, 1, 2.7, ROOF.GABLED, 0.3],
  garages: [2, 1, 2.9, ROOF.GABLED, 0.3],
  carport: [2, 1, 2.6, ROOF.SKILLION, 0.25],
  hut: [2, 1, 2.9, ROOF.GABLED, 0.5],
  cabin: [3, 1, 3.0, ROOF.GABLED, 0.5],
  chapel: [4, 1, 6.5, ROOF.GABLED, 0.6],
  church: [4, 1, 11.0, ROOF.GABLED, 0.7],
  cathedral: [4, 1, 14.0, ROOF.GABLED, 0.7],
  house: [3, 2, 3.1, ROOF.GABLED, 0.5],
  detached: [3, 2, 3.1, ROOF.GABLED, 0.5],
  semidetached_house: [3, 2, 3.1, ROOF.GABLED, 0.5],
  terrace: [3, 3, 3.1, ROOF.GABLED, 0.4],
  bungalow: [3, 1, 3.2, ROOF.HIPPED, 0.45],
  residential: [3, 2, 3.1, ROOF.GABLED, 0.48],
  apartments: [5, 4, 3.0, ROOF.GABLED, 0.35],
  hotel: [5, 4, 3.1, ROOF.GABLED, 0.35],
  dormitory: [5, 5, 3.1, ROOF.FLAT, 0.1],
  commercial: [5, 3, 3.6, ROOF.FLAT, 0.1],
  retail: [5, 2, 4.0, ROOF.FLAT, 0.1],
  supermarket: [5, 1, 6.0, ROOF.FLAT, 0.1],
  office: [5, 3, 3.4, ROOF.FLAT, 0.1],
  tower: [5, 6, 3.4, ROOF.FLAT, 0.1],
  skyscraper: [5, 20, 3.6, ROOF.FLAT, 0.1],
  industrial: [6, 1, 7.0, ROOF.FLAT, 0.1],
  warehouse: [6, 1, 7.5, ROOF.FLAT, 0.1],
  manufacture: [6, 1, 7.5, ROOF.FLAT, 0.1],
  parking: [6, 4, 3.0, ROOF.FLAT, 0.1],
  school: [5, 3, 3.6, ROOF.GABLED, 0.3],
  university: [5, 4, 3.8, ROOF.FLAT, 0.15],
  college: [5, 3, 3.8, ROOF.FLAT, 0.15],
  hospital: [5, 4, 3.5, ROOF.FLAT, 0.1],
  train_station: [5, 2, 4.5, ROOF.GABLED, 0.3],
  civic: [5, 2, 4.0, ROOF.GABLED, 0.35],
  public: [5, 2, 4.0, ROOF.GABLED, 0.35],
  stadium: [6, 1, 22.0, ROOF.FLAT, 0.1],
  roof: [7, 1, 3.2, ROOF.SKILLION, 0.25],
  greenhouse: [7, 1, 3.4, ROOF.GABLED, 0.3],
  yes: [0, 2, 3.1, ROOF.GABLED, 0.48],
};
const DEFAULT_TYPE = TYPES.yes;

/**
 * An untagged building means something different in each place. In the Alps it
 * is a chalet with a steep pitched roof; in Chicago it is a flat-roofed block,
 * and pitching them all turned the Loop into a village.
 */
const ROOF_OVERRIDES = {
  chicago: {
    yes: ROOF.FLAT,
    apartments: ROOF.FLAT,
    hotel: ROOF.FLAT,
    residential: ROOF.FLAT,
    terrace: ROOF.FLAT,
    school: ROOF.FLAT,
    civic: ROOF.FLAT,
    public: ROOF.FLAT,
    train_station: ROOF.FLAT,
    house: ROOF.HIPPED,
    detached: ROOF.HIPPED,
    semidetached_house: ROOF.HIPPED,
    bungalow: ROOF.HIPPED,
    garage: ROOF.SKILLION,
    garages: ROOF.SKILLION,
    shed: ROOF.SKILLION,
  },
};
const ROOF_OVERRIDE = ROOF_OVERRIDES[R.id] ?? {};

/**
 * Where the tags are silent, guess the facade from height and use.
 *
 * This is invention, and it is the largest invented thing in the Chicago map:
 * only a few hundred buildings tag `building:material`. The rule is the crude
 * one a person would use from the air — a 150 m office tower is glass, a
 * three-flat is brick, a warehouse is metal — and it is recorded as inferred.
 */
function inferMaterial(tags, totalHeight, typeName, rand) {
  const tagged = MATERIAL_TAGS[tags['building:material'] ?? tags['building:facade:material']];
  if (tagged !== undefined) return tagged;
  if (R.id !== 'chicago') return MATERIAL.RENDER;

  if (typeName === 'industrial' || typeName === 'warehouse' || typeName === 'manufacture') return MATERIAL.METAL;
  if (typeName === 'parking') return MATERIAL.CONCRETE;
  if (totalHeight > 120) return MATERIAL.GLASS;
  if (totalHeight > 70) return rand() < 0.62 ? MATERIAL.GLASS : MATERIAL.STONE;
  if (totalHeight > 38) return rand() < 0.4 ? MATERIAL.STONE : MATERIAL.CONCRETE;
  if (totalHeight > 14) return rand() < 0.75 ? MATERIAL.BRICK : MATERIAL.STONE;
  return MATERIAL.BRICK;
}

/** Does anything in these tags claim a height above the street? */
function aboveGround(tags) {
  return Boolean(
    tags.height ?? tags['building:height'] ?? tags['building:levels'] ?? tags['building:levels:aboveground']
  );
}

/** Deterministic per-building jitter, so a re-bake does not reshuffle the city. */
function hashRand(x, z) {
  let h = (Math.round(x * 7.3) * 374761393 + Math.round(z * 11.7) * 668265263) | 0;
  return () => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h >>> 0) % 100000) / 100000;
  };
}

// ------------------------------------------------------------------ read ---
const raw = JSON.parse(await readFile(OUT.osmBuildings, 'utf8'));
console.log(`read ${raw.length} OSM elements`);

/** Everything becomes {tags, ring} in the local frame before anything else. */
function ringsOf(el) {
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 4) return [];
    const closed = el.geometry[0].lat === el.geometry.at(-1).lat && el.geometry[0].lon === el.geometry.at(-1).lon;
    const pts = (closed ? el.geometry.slice(0, -1) : el.geometry).map((p) => project(p.lat, p.lon));
    return pts.length >= 3 ? [pts] : [];
  }
  if (!el.members) return [];
  // A type=building relation bundles an outline with its parts. Only the
  // outline describes the ground footprint; the parts arrive separately and
  // chaining them into the same ring produces a knot.
  let members = el.members.filter((m) => m.type === 'way' && m.geometry);
  if (el.tags?.type === 'building') {
    const outlines = members.filter((m) => m.role === 'outline' || m.role === '');
    if (outlines.length) members = outlines;
  } else {
    members = members.filter((m) => m.role !== 'inner');
  }
  return assembleRings(members.map((m) => m.geometry.map((p) => project(p.lat, p.lon))));
}

const outlines = [];
const parts = [];
for (const el of raw) {
  const tags = el.tags ?? {};
  const isPart = tags['building:part'] !== undefined && tags['building:part'] !== 'no';
  const isBuilding = tags.building !== undefined && tags.building !== 'no';
  if (!isPart && !isBuilding) continue;
  for (const ring of ringsOf(el)) {
    if (ring.length < 3) continue;
    (isPart ? parts : outlines).push({ tags, ring, id: el.id, osm: `${el.type}/${el.id}` });
  }
}
console.log(`  ${outlines.length} outlines, ${parts.length} parts`);

// ---------------------------------------------- parts replace their outline ---
// Simple 3D Buildings: where a building has parts, the parts *are* the
// building and the outline must not also be extruded, or every tower gets a
// slab wrapped around it.
const CELL = 250;
const grid = new Map();
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
outlines.forEach((o, i) => {
  const [cx, cz] = centroid(o.ring);
  o.centre = [cx, cz];
  const k = cellKey(cx, cz);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});

let orphanParts = 0;
for (const part of parts) {
  const [px, pz] = centroid(part.ring);
  part.centre = [px, pz];
  let host = null;
  for (let dx = -1; dx <= 1 && !host; dx++) {
    for (let dz = -1; dz <= 1 && !host; dz++) {
      for (const i of grid.get(cellKey(px + dx * CELL, pz + dz * CELL)) ?? []) {
        if (pointInRing(px, pz, outlines[i].ring)) {
          host = outlines[i];
          break;
        }
      }
    }
  }
  if (host) {
    host.replaced = true;
    // A part often tags only its own height and inherits everything else.
    part.tags = { ...host.tags, ...part.tags };
  } else orphanParts++;
}
const replaced = outlines.filter((o) => o.replaced).length;
console.log(`  ${parts.length} parts replace ${replaced} outlines (${orphanParts} parts had no host outline)`);

// ------------------------------------------------------------------ bake ---
const handModelled = HAND_MODELLED[R.id] ?? [];
const handModelledIds = new Set(HAND_MODELLED_IDS[R.id] ?? []);
const handMatched = new Set();
const minArea = R.buildings?.minArea ?? 24;
const maxCorners = R.buildings?.simplifyTo ?? 24;

const buildings = [];
const stats = { tiny: 0, outside: 0, hand: 0, underground: 0, tagged: 0, levels: 0, inferred: 0, parts: 0, tallest: [] };

for (const item of [...outlines.filter((o) => !o.replaced), ...parts]) {
  const tags = item.tags;
  let ring = item.ring;

  if (handModelledIds.has(item.osm)) {
    handMatched.add(item.osm);
    stats.hand++;
    continue;
  }

  if (
    handModelled.some((h) => {
      const [hx, hz] = project(h.lat, h.lon);
      return Math.hypot(ring[0][0] - hx, ring[0][1] - hz) < h.radius;
    })
  ) {
    stats.hand++;
    continue;
  }

  // A building wholly below the street is not a building from the air, and
  // extruding it puts a 16 m brick block on the plaza next to Cloud Gate.
  if (tags.location === 'underground' || (tags['building:levels:underground'] && !aboveGround(tags))) {
    stats.underground++;
    continue;
  }

  if (signedArea(ring) < 0) ring = ring.slice().reverse();
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
  if (ring.length > maxCorners) {
    const stride = Math.ceil(ring.length / maxCorners);
    ring = ring.filter((_, i) => i % stride === 0);
  }

  const area = Math.abs(signedArea(ring));
  // The area floor exists to drop bin stores and single garages. It also drops
  // masts: Willis Tower's twin antennas are 17 m2 at the base and carry the
  // building from its 442 m roof to 527 m, which is most of what makes that
  // silhouette recognisable. Anything tagged tall enough is kept whatever its
  // footprint, and the test is deferred until the height is known.
  const slender =
    parseLength(tags.height ?? tags['building:height']) > 45 || parseFloat(tags['building:levels']) > 14;
  if (area < minArea && !slender) {
    stats.tiny++;
    continue;
  }

  const box = orientedBox(ring);
  if (!box) continue;

  const [cx, cz] = centroid(ring);
  if (Math.abs(cx) > HALF - 50 || Math.abs(cz) > HALF - 50) {
    stats.outside++;
    continue;
  }

  const typeName = tags.building && tags.building !== 'yes' ? tags.building : tags['building:part'];
  const known = TYPES[typeName] ?? TYPES[tags.building] ?? (tags.amenity === 'place_of_worship' ? TYPES.church : null);
  const spec = known ?? DEFAULT_TYPE;
  const [typeId, storeys, floorH, specRoof, defaultPitch] = spec;
  // An unrecognised building=* value is no more a chalet than an untagged one,
  // so where a region overrides the untagged default it overrides the unknown
  // one too. Six hundred Chicago buildings turn on this, Wrigley Field among
  // them: building=historic was landing a 14 m gable across a 176 m grandstand.
  const defaultRoof =
    ROOF_OVERRIDE[typeName] ?? ROOF_OVERRIDE[tags.building] ?? (known ? specRoof : ROOF_OVERRIDE.yes ?? specRoof);
  const rand = hashRand(cx, cz);

  // ---- roof shape first: it decides how much of the total is roof --------
  const shape = tags['roof:shape'] ?? tags['building:roof:shape'];
  let roofKind = ROOF_TAGS[shape] ?? (shape ? ROOF.GABLED : defaultRoof);
  let pitch = defaultPitch;
  if (roofKind === ROOF.PYRAMIDAL || roofKind === ROOF.DOME || roofKind === ROOF.SPIRE) pitch = 0.85;
  if (tags['roof:levels']) pitch = Math.max(pitch, parseFloat(tags['roof:levels']) * 0.35);

  // ---- height: the tag is to the top, including the roof -----------------
  const tagged = parseLength(tags.height ?? tags['building:height']);
  const levels = parseFloat(tags['building:levels'] ?? tags['building:levels:aboveground']);
  let total;
  if (isFinite(tagged) && tagged > 1.5) {
    total = tagged;
    stats.tagged++;
  } else if (isFinite(levels) && levels >= 1) {
    total = levels * floorH + 1.0;
    stats.levels++;
  } else {
    total = storeys * floorH + 1.0;
    // a big footprint is rarely a low building
    total *= 1 + Math.min(0.35, Math.max(0, (area - 180) / 2600));
    stats.inferred++;
  }

  let roofHeight = parseLength(tags['roof:height']);
  if (!isFinite(roofHeight)) {
    roofHeight = roofKind === ROOF.FLAT ? 0.6 : Math.min(box.depth * 0.5 * pitch * 2, 14);
  }
  // The roof cannot eat the building.
  roofHeight = Math.min(roofHeight, Math.max(0.6, total * 0.55));

  // ---- base: parts float, which is what makes a setback a setback --------
  let base = parseLength(tags.min_height);
  if (!isFinite(base)) {
    const minLevel = parseFloat(tags['building:min_level']);
    base = isFinite(minLevel) ? minLevel * floorH : 0;
  }
  base = Math.max(0, Math.min(base, total - 1.5));

  const wallHeight = Math.max(1.5, total - roofHeight - base);
  if (tags['building:part']) stats.parts++;

  const material = inferMaterial(tags, total, typeName, rand);
  const name = tags.name;
  if (total > 120) stats.tallest.push({ name: name ?? '—', total: Math.round(total), tagged: isFinite(tagged) });

  buildings.push({ ring, cx, cz, box, base, wallHeight, roofHeight, roofKind, typeId, material, area });
}

buildings.sort((a, b) => a.cz - b.cz || a.cx - b.cx);
console.log(
  `kept ${buildings.length} (dropped ${stats.tiny} under ${minArea} m2, ${stats.outside} outside, ` +
    `${stats.hand} hand-modelled, ${stats.underground} underground)`
);
for (const id of handModelledIds) {
  if (!handMatched.has(id)) console.warn(`  WARNING ${id} is listed as hand-modelled but is not in the OSM dump`);
}
console.log(
  `  heights: ${stats.tagged} from a height tag, ${stats.levels} from levels, ${stats.inferred} inferred ` +
    `(${((100 * (stats.tagged + stats.levels)) / buildings.length).toFixed(0)}% surveyed)`
);
stats.tallest.sort((a, b) => b.total - a.total);
console.log('  tallest:');
for (const t of stats.tallest.slice(0, 12)) {
  console.log(`    ${String(t.total).padStart(4)} m  ${t.tagged ? 'tagged  ' : 'inferred'}  ${t.name}`);
}

// ---------------------------------------------------------------- encode ---
// int16 everywhere: origin in metres from the region centre, corners in
// 5 cm steps from that origin, heights in decimetres. Five centimetres is far
// below anything visible on a wall and quantising to it costs a third of the
// file, because the low bytes stop being noise and start repeating.
const VERT_SCALE = 20;
let vertexTotal = 0;
for (const b of buildings) vertexTotal += b.ring.length;

const bytes = 16 + buildings.length * 16 + vertexTotal * 4;
const buf = Buffer.alloc(bytes);
let o = 0;
buf.write('WBLD', o);
o += 4;
buf.writeUInt16LE(2, o); // format 2: adds base height, roof kinds, materials
o += 2;
buf.writeUInt16LE(0, o);
o += 2;
buf.writeUInt32LE(buildings.length, o);
o += 4;
buf.writeUInt32LE(vertexTotal, o);
o += 4;

for (const b of buildings) {
  const ox = Math.round(b.cx);
  const oz = Math.round(b.cz);
  buf.writeInt16LE(ox, o);
  o += 2;
  buf.writeInt16LE(oz, o);
  o += 2;
  buf.writeUInt16LE(Math.min(65535, Math.round(b.base * 10)), o);
  o += 2;
  buf.writeUInt16LE(Math.min(65535, Math.round(b.wallHeight * 10)), o);
  o += 2;
  buf.writeUInt16LE(Math.min(65535, Math.round(b.roofHeight * 10)), o);
  o += 2;
  buf.writeInt16LE(Math.round((b.box.angle * 10000) / Math.PI), o);
  o += 2;
  buf.writeUInt8(b.ring.length, o);
  o += 1;
  buf.writeUInt8(b.typeId, o);
  o += 1;
  buf.writeUInt8(b.roofKind, o);
  o += 1;
  buf.writeUInt8(b.material, o);
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
await writeFile(OUT.buildings, gz);

const meta = {
  generator: 'tools/bake-buildings.mjs',
  region: R.id,
  source: 'OpenStreetMap contributors, ODbL — see ATTRIBUTION.md',
  format: 2,
  count: buildings.length,
  vertices: vertexTotal,
  vertexScale: VERT_SCALE,
  parts: stats.parts,
  heights: {
    fromHeightTag: stats.tagged,
    fromLevels: stats.levels,
    inferred: stats.inferred,
    surveyedPercent: +((100 * (stats.tagged + stats.levels)) / buildings.length).toFixed(1),
  },
  note:
    'Footprints, positions, orientations and building:part massing are surveyed data. ' +
    'Heights are surveyed where tagged and inferred from type and footprint area otherwise. ' +
    'Facade materials are inferred from height and use except where building:material is tagged.',
};
await writeFile(OUT.buildingsMeta, JSON.stringify(meta, null, 2));

console.log(`raw ${(bytes / 1048576).toFixed(2)} MB -> gzip ${(gz.length / 1048576).toFixed(2)} MB`);
console.log(`${vertexTotal} corners, ${(vertexTotal / buildings.length).toFixed(1)} per building`);
