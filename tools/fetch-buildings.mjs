/**
 * Downloads OpenStreetMap building data for a region into .cache/.
 *
 * Three things are needed, not one. The plain `building` ways are the bulk of
 * it. But the towers that actually define a skyline are usually mapped under
 * Simple 3D Buildings: Willis Tower is a `type=building` relation carrying no
 * height at all, with its nine bundled tubes as separate `building:part` ways
 * that each terminate at a different level. Fetch only the outlines and you get
 * a flat slab where the Sears Tower should be.
 *
 *   node tools/fetch-buildings.mjs chicago
 *
 * The query ends `out geom;` rather than `out tags geom;`. That one word cost
 * the city its multipolygons: with `tags` named explicitly, Overpass returns a
 * relation's tags but not its members' geometry, so all 191 relation buildings
 * in Chicago — Soldier Field, the Shedd Aquarium, the Wrigley Building, Aqua —
 * arrived with nothing to extrude and were silently dropped. The cache label is
 * versioned so the broken tiles are not reused.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { regionFromArgv, paths, bbox } from './regions.mjs';
import { tiledQuery } from './overpass.mjs';

const R = regionFromArgv();
const OUT = paths(R);
// Dense cities need finer tiles or Overpass times out on the query.
const TILES = R.id === 'chicago' ? 6 : 4;

const elements = await tiledQuery(
  `.cache/osm-${R.id}`,
  bbox(R, 400),
  TILES,
  (bb) => `[out:json][timeout:300];
(
  way["building"](${bb});
  relation["building"](${bb});
  way["building:part"](${bb});
  relation["building:part"](${bb});
);
out geom;`,
  { label: 'buildings-v2' }
);

const kinds = { way: 0, relation: 0, part: 0 };
for (const el of elements) {
  kinds[el.type] = (kinds[el.type] ?? 0) + 1;
  if (el.tags?.['building:part']) kinds.part++;
}
console.log(`total ${elements.length} elements (${kinds.way} ways, ${kinds.relation} relations, ${kinds.part} tagged as parts)`);

await mkdir('.cache', { recursive: true });
await writeFile(OUT.osmBuildings, JSON.stringify(elements));
console.log(`wrote ${OUT.osmBuildings}`);
