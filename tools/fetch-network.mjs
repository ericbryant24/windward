/**
 * Downloads the transport network — roads, tracks, footpaths, railways and
 * aerialways — for the region into .cache/.
 *
 *   node tools/fetch-network.mjs
 */
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';

const BBOX = { south: 46.4293, west: 7.6817, north: 46.7707, east: 8.1783 };
const TILES = 4;
const UA = 'windward-game/1.0 (offline terrain baking; github.com/ericbryant24/windward)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const FILTER = `
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service|track|path|footway|steps|bridleway|cycleway|pedestrian)$"](BBOX);
  way["railway"~"^(rail|narrow_gauge|funicular|light_rail|tram|subway|miniature|monorail)$"](BBOX);
  way["aerialway"](BBOX);
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(i, j) {
  const file = `.cache/osm/net-${i}-${j}.json`;
  try {
    const s = await stat(file);
    if (s.size > 200) return JSON.parse(await readFile(file, 'utf8'));
  } catch {}

  const south = BBOX.south + ((BBOX.north - BBOX.south) * j) / TILES;
  const north = BBOX.south + ((BBOX.north - BBOX.south) * (j + 1)) / TILES;
  const west = BBOX.west + ((BBOX.east - BBOX.west) * i) / TILES;
  const east = BBOX.west + ((BBOX.east - BBOX.west) * (i + 1)) / TILES;
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:300];\n(${FILTER.replaceAll('BBOX', bbox)});\nout tags geom;`;

  for (let attempt = 0; attempt < 10; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: query,
        headers: { 'User-Agent': UA, 'Content-Type': 'text/plain' },
      });
      const text = await res.text();
      if (!text.startsWith('{')) throw new Error(text.slice(0, 120).replace(/\s+/g, ' '));
      const json = JSON.parse(text);
      await mkdir('.cache/osm', { recursive: true });
      await writeFile(file, text);
      console.log(`  tile ${i},${j}: ${json.elements.length} ways`);
      return json;
    } catch (err) {
      const wait = 3000 * (attempt + 1);
      console.log(`  tile ${i},${j} attempt ${attempt + 1}: ${String(err.message).slice(0, 80)} — retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`tile ${i},${j} failed`);
}

const byId = new Map();
for (let j = 0; j < TILES; j++) {
  for (let i = 0; i < TILES; i++) {
    const json = await fetchTile(i, j);
    for (const el of json.elements) byId.set(el.id, el);
  }
}
console.log(`total ${byId.size} unique ways`);
await writeFile('.cache/osm-network.json', JSON.stringify([...byId.values()]));
