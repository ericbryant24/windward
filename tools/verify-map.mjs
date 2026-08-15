/**
 * Checks a baked region against ground truth.
 *
 * A heightfield can look plausible in a screenshot and still put the shoreline
 * a kilometre inland, so the interesting question is never "does it render"
 * but "is it where the real thing is". This asserts named places are on the
 * right surface, and — the stronger test — that every river centreline node
 * OSM knows about lands on a cell the water mask calls wet.
 *
 *   node tools/verify-map.mjs chicago
 */
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { regionFromArgv, projector, bbox, paths } from './regions.mjs';
import { cachedQuery } from './overpass.mjs';

const R = regionFromArgv();
const OUT = paths(R);
const png = PNG.sync.read(await readFile(OUT.terrain));
const meta = JSON.parse(await readFile(OUT.meta, 'utf8'));
const size = png.width;
const step = meta.step;
const half = R.halfSize;
const proj = projector(R);

/** Named places that must sit on land, on water, or on a river. */
const PLACES = {
  chicago: [
    ['Willis Tower', 41.8789, -87.6359, 'land'],
    ['Grant Park lawn', 41.8768, -87.622, 'land'],
    ['Buckingham Fountain', 41.8758, -87.6189, 'water'],
    ['Northerly Island', 41.8639, -87.6078, 'land'],
    ['Navy Pier', 41.8917, -87.606, 'land'],
    ['Wrigley Field', 41.9484, -87.6553, 'land'],
    ['Soldier Field', 41.8623, -87.6167, 'land'],
    ['State & Madison', 41.8819, -87.6278, 'land'],
    ['Lincoln Park', 41.925, -87.637, 'land'],
    ['Lake, 4 km out', 41.888, -87.56, 'water'],
    ['Lake off Oak St Beach', 41.903, -87.615, 'water'],
    ['Wolf Point', 41.8887, -87.6386, 'river'],
  ],
  jungfrau: [
    ['Jungfraujoch', 46.5474, 7.9806, 'land'],
    ['Interlaken', 46.686, 7.863, 'land'],
    ['Thunersee', 46.6805, 7.7365, 'water'],
    ['Brienzersee', 46.7245, 7.9705, 'water'],
    ['Lauterbrunnen', 46.5936, 7.9088, 'land'],
  ],
};

const cell = (lat, lon) => {
  const [x, z] = proj(lat, lon);
  const cx = Math.round((x + half) / step);
  const cy = Math.round((z + half) / step);
  if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
  const i = (cy * size + cx) * 4;
  return {
    cx,
    cy,
    water: png.data[i + 2] > 0,
    veg: null,
    h: (png.data[i] * 256 + png.data[i + 1]) / meta.encoding.scale - meta.encoding.bias,
  };
};

const nearestWater = (cx, cy, maxR) => {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (png.data[(y * size + x) * 4 + 2] > 0) return r * step;
      }
    }
  }
  return Infinity;
};

let bad = 0;
console.log(`${R.name}: ${size}^2 at ${step.toFixed(2)} m/cell, ${meta.minHeight}..${meta.maxHeight} m`);
console.log('\nnamed places');
for (const [name, lat, lon, want] of PLACES[R.id] ?? []) {
  const c = cell(lat, lon);
  if (!c) {
    console.log(`  FAIL ${name.padEnd(24)} outside the map`);
    bad++;
    continue;
  }
  // A 60 m river is a handful of cells wide, so ask whether water is within
  // half a block rather than whether one exact cell landed wet.
  const ok = want === 'river' ? nearestWater(c.cx, c.cy, 12) < 45 : c.water === (want === 'water');
  if (!ok) bad++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(24)} ${(c.water ? 'water' : 'land').padEnd(5)} want ${want.padEnd(5)} ${c.h.toFixed(1)} m${c.veg ? ' veg' : ''}`
  );
}

// ---- every river OSM knows about must be wet ------------------------------
// Only where the region actually bakes rivers. Jungfrau's water is flood-filled
// lakes alone: the Aare and the Lutschine are not in its mask, because a river
// falling 2,000 m down a valley cannot be one flat surface the way the Chicago
// River can.
if (R.water.rivers) {
  const b = bbox(R);
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  const d = await cachedQuery(
    `.cache/osm-${R.id}-rivercentre.json`,
    `[out:json][timeout:200];(way["waterway"~"^(river|canal)$"](${bb}););out geom;`,
    { label: 'river centrelines' }
  );
  let on = 0;
  let off = 0;
  const misses = [];
  for (const w of d.elements) {
    for (const p of w.geometry ?? []) {
      const [x, z] = proj(p.lat, p.lon);
      if (Math.abs(x) > half - 20 || Math.abs(z) > half - 20) continue;
      const c = cell(p.lat, p.lon);
      if (c?.water) on++;
      else {
        off++;
        if (misses.length < 5) misses.push(`${w.tags?.name ?? '—'} ${p.lat.toFixed(4)},${p.lon.toFixed(4)}`);
      }
    }
  }
  if (on + off > 0) {
    const pct = (100 * on) / (on + off);
    const ok = pct > 97;
    if (!ok) bad++;
    console.log(`\nriver centrelines\n  ${ok ? 'ok  ' : 'FAIL'} ${on}/${on + off} nodes on water (${pct.toFixed(1)}%)`);
    if (misses.length) console.log(`       missed: ${misses.join(' | ')}`);
  }
}

console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exit(bad ? 1 : 0);
