/**
 * Downloads OpenStreetMap building footprints for the region into .cache/.
 * Split into tiles and retried, because Overpass will refuse a single query
 * this size when it is busy.
 *
 *   node tools/fetch-buildings.mjs
 */
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';

const BBOX = { south: 46.4293, west: 7.6817, north: 46.7707, east: 8.1783 };
const TILES = 4;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(i, j) {
  const file = `.cache/osm/tile-${i}-${j}.json`;
  try {
    const s = await stat(file);
    if (s.size > 200) return JSON.parse(await readFile(file, 'utf8'));
  } catch {}

  const south = BBOX.south + ((BBOX.north - BBOX.south) * j) / TILES;
  const north = BBOX.south + ((BBOX.north - BBOX.south) * (j + 1)) / TILES;
  const west = BBOX.west + ((BBOX.east - BBOX.west) * i) / TILES;
  const east = BBOX.west + ((BBOX.east - BBOX.west) * (i + 1)) / TILES;

  const query = `[out:json][timeout:300];
way["building"](${south},${west},${north},${east});
out tags geom;`;

  for (let attempt = 0; attempt < 8; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, { method: 'POST', body: query });
      const text = await res.text();
      if (!text.startsWith('{')) throw new Error(text.slice(0, 160).replace(/\s+/g, ' '));
      const json = JSON.parse(text);
      await mkdir('.cache/osm', { recursive: true });
      await writeFile(file, text);
      console.log(`  tile ${i},${j}: ${json.elements.length} ways`);
      return json;
    } catch (err) {
      const wait = 4000 * (attempt + 1);
      console.log(`  tile ${i},${j} attempt ${attempt + 1} failed (${String(err.message).slice(0, 90)}), retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`tile ${i},${j} failed after all retries`);
}

const all = [];
for (let j = 0; j < TILES; j++) {
  for (let i = 0; i < TILES; i++) {
    const json = await fetchTile(i, j);
    all.push(...json.elements);
  }
}

// tiles overlap on their shared edges, so de-duplicate by way id
const byId = new Map();
for (const el of all) byId.set(el.id, el);
console.log(`total ${byId.size} unique buildings`);
await writeFile('.cache/osm-buildings.json', JSON.stringify([...byId.values()]));
