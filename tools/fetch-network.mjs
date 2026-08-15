/**
 * Downloads the transport network — roads, tracks, footpaths, railways and
 * aerialways — for a region into .cache/.
 *
 *   node tools/fetch-network.mjs chicago
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { regionFromArgv, paths, bbox } from './regions.mjs';
import { tiledQuery } from './overpass.mjs';

const R = regionFromArgv();
const OUT = paths(R);
const TILES = R.id === 'chicago' ? 5 : 4;

const FILTER = `
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service|track|path|footway|steps|bridleway|cycleway|pedestrian)$"](BBOX);
  way["railway"~"^(rail|narrow_gauge|funicular|light_rail|tram|subway|miniature|monorail)$"](BBOX);
  way["aerialway"](BBOX);
`;

const elements = await tiledQuery(
  `.cache/osm-${R.id}`,
  bbox(R, 200),
  TILES,
  (bb) => `[out:json][timeout:300];\n(${FILTER.replaceAll('BBOX', bb)});\nout tags geom;`,
  { label: 'network' }
);

console.log(`total ${elements.length} unique ways`);
await mkdir('.cache', { recursive: true });
await writeFile(OUT.osmNetwork, JSON.stringify(elements));
console.log(`wrote ${OUT.osmNetwork}`);
