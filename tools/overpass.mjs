/**
 * A small Overpass client shared by the fetch tools.
 *
 * The public instances rate-limit hard and fail in a dozen different ways —
 * HTML error pages, gateway resets, plain timeouts — so every query rotates
 * across mirrors, backs off, and caches its answer on disk. Re-running a bake
 * should not re-download the city.
 */
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

export const UA = 'windward-game/1.0 (offline map baking; github.com/ericbryant24/windward)';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run one Overpass query, retrying across mirrors. Returns the parsed JSON. */
export async function query(ql, { attempts = 12, label = 'query' } = {}) {
  let lastErr = 'unknown';
  for (let a = 0; a < attempts; a++) {
    const endpoint = ENDPOINTS[a % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: ql,
        headers: { 'User-Agent': UA, 'Content-Type': 'text/plain' },
      });
      const text = await res.text();
      if (!text.startsWith('{')) throw new Error(text.slice(0, 100).replace(/\s+/g, ' '));
      return JSON.parse(text);
    } catch (err) {
      lastErr = String(err.message).slice(0, 90);
      const wait = Math.min(30000, 2500 * (a + 1));
      console.log(`  ${label} attempt ${a + 1}: ${lastErr} — retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

/** As `query`, but memoised to a file so repeat bakes are free. */
export async function cachedQuery(file, ql, opts = {}) {
  try {
    const s = await stat(file);
    if (s.size > 200) return JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  const json = await query(ql, opts);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json;
}

/**
 * Split a bounding box into a grid and run the same query over each cell.
 * A single query for a whole dense city times out; a 4x4 grid of them does not.
 */
export async function tiledQuery(cacheDir, box, tiles, buildQl, { label = 'tile' } = {}) {
  const byId = new Map();
  for (let j = 0; j < tiles; j++) {
    for (let i = 0; i < tiles; i++) {
      const south = box.south + ((box.north - box.south) * j) / tiles;
      const north = box.south + ((box.north - box.south) * (j + 1)) / tiles;
      const west = box.west + ((box.east - box.west) * i) / tiles;
      const east = box.west + ((box.east - box.west) * (i + 1)) / tiles;
      const bb = `${south},${west},${north},${east}`;
      const json = await cachedQuery(path.join(cacheDir, `${label}-${i}-${j}.json`), buildQl(bb), {
        label: `${label} ${i},${j}`,
      });
      for (const el of json.elements) byId.set(`${el.type[0]}${el.id}`, el);
      console.log(`  ${label} ${i},${j}: ${json.elements.length} elements (${byId.size} unique)`);
    }
  }
  return [...byId.values()];
}
