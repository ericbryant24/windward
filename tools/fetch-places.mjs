/**
 * Asks OpenStreetMap what the places in a region are called, and where they are.
 *
 * Every named place in src/regions.js used to be typed in by hand off a map,
 * which works right up until you do not know the area. Authoring Flåm from
 * memory put Stegastein in the middle of the fjord, Undredal 1,570 m up a
 * mountain and both ends of the Lærdal tunnel a kilometre above their real
 * portals — and none of that is visible in the diff. It shows up as a label
 * hanging over open water.
 *
 * So: ask. Overpass knows where Undredal is. This prints a table ready to paste
 * into PLACES, with the baked heightfield's own ground height beside every row
 * so anything absurd is obvious before it ships, and anything outside the
 * flyable box marked as such.
 *
 *   node tools/fetch-places.mjs flam
 *   node tools/fetch-places.mjs maui --limit=40
 *   node tools/fetch-places.mjs flam --falls      waterfalls, for the falls table
 *
 * Requires the region's terrain to be baked first — the ground height is the
 * whole point of the sanity check.
 */
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import * as THREE from '../vendor/three.module.js';
import { Heightfield } from '../src/heightfield.js';
import { regionFromArgv, paths, bbox, MPD_LAT, mpdLon } from './regions.mjs';
import { cachedQuery } from './overpass.mjs';

const R = regionFromArgv();
const OUT = paths(R);
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const LIMIT = Number(arg('limit', 34));
const FALLS = argv.includes('--falls');

const box = bbox(R);
const bb = `${box.south},${box.west},${box.north},${box.east}`;

// Settlements, summits, viewpoints and named water. Nodes only: a village's
// label wants one point, and Overpass hands back a relation's geometry when
// asked for its area, which is a lot of coastline for a name.
//
// `out body`, NOT `out tags`. For a node, `out tags` returns the tags and drops
// the latitude and longitude — so the first run of this came back with forty
// kilobytes of correct answers and reported nothing inside the box, which is
// exactly the failure fetch-buildings.mjs already carries a paragraph about.
const ql = FALLS
  ? `[out:json][timeout:180];
     (node["waterway"="waterfall"](${bb}); way["waterway"="waterfall"](${bb}););
     out center tags;`
  : `[out:json][timeout:180];
     (
       node["place"~"^(city|town|village|hamlet)$"](${bb});
       node["natural"="peak"](${bb});
       node["natural"="volcano"](${bb});
       node["tourism"="viewpoint"](${bb});
       node["natural"="bay"](${bb});
       node["natural"="strait"](${bb});
       node["place"="sea"](${bb});
       node["natural"="water"](${bb});
     );
     out body;`;

const raw = await cachedQuery(FALLS ? `.cache/osm-${R.id}-falls.json` : `.cache/osm-${R.id}-places.json`, ql, {
  label: `${R.id} places`,
});

// ---------------------------------------------------------------- terrain ---
const meta = JSON.parse(await readFile(OUT.meta, 'utf8'));
const png = PNG.sync.read(await readFile(OUT.terrain));
const n = meta.size;
const heights = new Float32Array(n * n);
const water = new Uint8Array(n * n);
{
  const { bias, scale } = meta.encoding;
  for (let p = 0, q = 0; p < heights.length; p++, q += 4) {
    heights[p] = (png.data[q] * 256 + png.data[q + 1]) / scale - bias;
    water[p] = png.data[q + 2] > 127 ? 1 : 0;
  }
}
const hf = new Heightfield(meta, heights, water, null);
const mLon = mpdLon(R.centerLat);
const toLocal = (lat, lon) => ({ x: (lon - R.centerLon) * mLon, z: (R.centerLat - lat) * MPD_LAT });
const lim = R.halfSize - 900;
const nrm = new THREE.Vector3();

/** PLACES uses four kinds. Map OSM's vocabulary onto them. */
function kindOf(t) {
  if (t.natural === 'peak' || t.natural === 'volcano') return 'peak';
  if (t.place === 'city' || t.place === 'town' || t.place === 'village' || t.place === 'hamlet') return 'town';
  if (t.natural === 'water' || t.natural === 'bay' || t.natural === 'strait' || t.place === 'sea') return 'water';
  return 'landmark';
}

const rows = [];
for (const el of raw.elements ?? []) {
  const t = el.tags ?? {};
  const name = t.name;
  if (!name) continue;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) continue;
  const v = toLocal(lat, lon);
  const inBox = Math.abs(v.x) <= lim && Math.abs(v.z) <= lim;
  const ground = hf.heightAt(v.x, v.z);
  hf.normalAt(v.x, v.z, 25, nrm);
  const tagged = Number(t.ele ?? t['ele:ft'] ?? NaN);
  rows.push({
    name,
    lat: +lat.toFixed(4),
    lon: +lon.toFixed(4),
    kind: kindOf(t),
    ground: Math.round(ground),
    tagged: isFinite(tagged) ? Math.round(tagged) : null,
    wet: hf.isWater(v.x, v.z),
    slope: +nrm.y.toFixed(2),
    inBox,
    // Settlements first by size, then summits by height. What the menu wants is
    // the places somebody would recognise, not every farmstead with a name.
    rank:
      (t.place === 'city' ? 6e6 : t.place === 'town' ? 5e6 : t.place === 'village' ? 4e6 : t.place === 'hamlet' ? 1e6 : 0) +
      (Number(t.population) || 0) +
      (kindOf(t) === 'peak' ? 2e6 + ground : 0) +
      // Water last, not first. Norway's fjord shore is mapped cove by cove and
      // every one of the forty "-viki" is a named node; the menu wants
      // Naeroyfjord, and the fjord itself is a relation this query cannot see,
      // so the coves must not crowd out the summits.
      (kindOf(t) === 'water' ? -1e6 : 0) +
      (kindOf(t) === 'landmark' ? 1.5e6 : 0),
  });
}

// A summit the terrain does not have, and a settlement the terrain puts on a
// mountainside. Deliberately NOT flagging a flat peak: a Norwegian vidde tops
// out as a plateau, so slope 1.0 at 1,400 m is the landscape being itself.
const bad = rows.filter(
  (r) =>
    r.inBox &&
    !FALLS &&
    ((r.kind === 'town' && r.ground > 1200) ||
      (r.tagged != null && r.kind === 'peak' && r.tagged - r.ground > 250) ||
      (r.kind === 'town' && r.wet))
);
const keep = rows.filter((r) => r.inBox).sort((a, b) => b.rank - a.rank);

console.log(`${R.name}: ${rows.length} named, ${keep.length} inside the flyable box (+-${lim} m)\n`);
if (FALLS) {
  console.log('    // name, lat, lon, ground, tagged height');
  for (const r of keep.slice(0, LIMIT)) {
    console.log(
      `      { name: '${r.name.replace(/'/g, "\\'")}', lat: ${r.lat}, lon: ${r.lon}, faces: 0, drop: 120, width: 16, spread: 1.6, rate: 1.1 },` +
        `   // ground ${r.ground} m${r.tagged ? `, tagged ${r.tagged}` : ''}`
    );
  }
} else {
  for (const r of keep.slice(0, LIMIT)) {
    const h = r.kind === 'peak' || r.kind === 'landmark' ? `, height: ${r.tagged ?? r.ground}` : '';
    console.log(
      `    { name: '${r.name.replace(/'/g, "\\'")}', lat: ${r.lat}, lon: ${r.lon}, kind: '${r.kind}'${h} },` +
        `   // dem ${r.ground} m${r.wet ? ' WET' : ''}${r.tagged && Math.abs(r.tagged - r.ground) > 120 ? ` !! tagged ${r.tagged}` : ''}`
    );
  }
}
if (bad.length) {
  console.log(`\n${bad.length} suspicious:`);
  for (const r of bad) console.log(`  ? ${r.name} (${r.kind}) at ${r.ground} m, slope ${r.slope}`);
}
const out = rows.filter((r) => !r.inBox);
if (out.length) console.log(`\n${out.length} named places fall outside the box, e.g. ${out.slice(0, 6).map((r) => r.name).join(', ')}`);
