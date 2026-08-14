/**
 * Bakes a heightfield for the Jungfrau region from AWS "terrarium" terrain tiles
 * into a compact RGB PNG the game can decode in the browser.
 *
 *   R,G  -> elevation, packed big-endian as round((h + 512) * 2)  [0.5 m steps]
 *   B    -> water mask (255 = lake surface)
 *
 * Usage: node tools/bake-terrain.mjs
 */
import { PNG } from 'pngjs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// ---------------------------------------------------------------- region ---
export const REGION = {
  centerLat: 46.6,
  centerLon: 7.93,
  halfSize: 19000, // metres; play area is 38 x 38 km
  size: 1536, // heightfield resolution
};

const Z = 13; // source tile zoom (~13 m/px at this latitude)
const TILE = 256;
const CACHE = path.join(process.cwd(), '.cache/tiles');
const MPD_LAT = 111320; // metres per degree of latitude

const mpdLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

// local ENU <-> WGS84 (equirectangular around the centre; fine at this scale)
export function metresToLatLon(x, z) {
  const lat = REGION.centerLat - z / MPD_LAT;
  const lon = REGION.centerLon + x / mpdLon(REGION.centerLat);
  return [lat, lon];
}

const lon2tile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2tile = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

// ----------------------------------------------------------------- tiles ---
async function fetchTile(z, x, y) {
  const key = `${z}_${x}_${y}.png`;
  const file = path.join(CACHE, key);
  try {
    await stat(file);
    return PNG.sync.read(await readFile(file));
  } catch {}
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, buf);
      return PNG.sync.read(buf);
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

// ------------------------------------------------------------------ bake ---
async function main() {
  const { size, halfSize } = REGION;

  // tile span covering the region (plus a margin for bilinear taps)
  const corners = [
    metresToLatLon(-halfSize, -halfSize),
    metresToLatLon(halfSize, -halfSize),
    metresToLatLon(-halfSize, halfSize),
    metresToLatLon(halfSize, halfSize),
  ];
  const lats = corners.map((c) => c[0]);
  const lons = corners.map((c) => c[1]);
  const tx0 = Math.floor(lon2tile(Math.min(...lons), Z)) - 1;
  const tx1 = Math.floor(lon2tile(Math.max(...lons), Z)) + 1;
  const ty0 = Math.floor(lat2tile(Math.max(...lats), Z)) - 1;
  const ty1 = Math.floor(lat2tile(Math.min(...lats), Z)) + 1;

  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;
  console.log(`fetching ${cols}x${rows} = ${cols * rows} tiles at z${Z}...`);

  // stitch into one big elevation buffer
  const W = cols * TILE;
  const H = rows * TILE;
  const src = new Float32Array(W * H);
  let done = 0;
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push({ tx, ty });
    }
  }
  const CONC = 12;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (jobs.length) {
        const { tx, ty } = jobs.pop();
        const png = await fetchTile(Z, tx, ty);
        const ox = (tx - tx0) * TILE;
        const oy = (ty - ty0) * TILE;
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const i = (y * png.width + x) * 4;
            const h = (png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256) - 32768;
            src[(oy + y) * W + ox + x] = h;
          }
        }
        if (++done % 25 === 0) console.log(`  ${done} tiles`);
      }
    })
  );
  console.log(`stitched ${W}x${H} source samples`);

  // resample into the local metric grid
  const heights = new Float32Array(size * size);
  const step = (halfSize * 2) / (size - 1);
  const sampleSrc = (fx, fy) => {
    const x = Math.min(W - 1.001, Math.max(0, fx));
    const y = Math.min(H - 1.001, Math.max(0, fy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const a = src[y0 * W + x0];
    const b = src[y0 * W + x0 + 1];
    const c = src[(y0 + 1) * W + x0];
    const d = src[(y0 + 1) * W + x0 + 1];
    return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy;
  };

  // supersample 2x2 so we average rather than alias the 13 m source
  const SS = 2;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < size; j++) {
    const zm = -halfSize + j * step;
    for (let i = 0; i < size; i++) {
      const xm = -halfSize + i * step;
      let acc = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const ox = ((si + 0.5) / SS - 0.5) * step;
          const oz = ((sj + 0.5) / SS - 0.5) * step;
          const [lat, lon] = metresToLatLon(xm + ox, zm + oz);
          acc += sampleSrc(lon2tile(lon, Z) * TILE - tx0 * TILE, lat2tile(lat, Z) * TILE - ty0 * TILE);
        }
      }
      const h = acc / (SS * SS);
      heights[j * size + i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  console.log(`elevation range ${minH.toFixed(1)} .. ${maxH.toFixed(1)} m`);

  // ------------------------------------------------------------- water ---
  // Flood fill flat regions from known lake seeds so the shoreline follows
  // the real DEM instead of a naive height cutoff.
  const water = new Uint8Array(size * size);
  const seeds = [
    { name: 'Thunersee', lat: 46.6805, lon: 7.7365, level: 558 },
    { name: 'Brienzersee', lat: 46.7245, lon: 7.9705, level: 564 },
  ];
  const toGrid = (lat, lon) => {
    const x = (lon - REGION.centerLon) * mpdLon(REGION.centerLat);
    const z = (REGION.centerLat - lat) * MPD_LAT;
    return [Math.round((x + halfSize) / step), Math.round((z + halfSize) / step)];
  };
  const lakes = [];
  for (const s of seeds) {
    const [sx, sy] = toGrid(s.lat, s.lon);
    if (sx < 0 || sy < 0 || sx >= size || sy >= size) {
      console.warn(`  seed ${s.name} outside region, skipped`);
      continue;
    }
    const stack = [sy * size + sx];
    let filled = 0;
    let x0 = size;
    let x1 = 0;
    let y0 = size;
    let y1 = 0;
    while (stack.length) {
      const p = stack.pop();
      if (water[p]) continue;
      if (heights[p] > s.level + 2.5) continue;
      water[p] = 255;
      filled++;
      const px = p % size;
      const py = (p / size) | 0;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      heights[p] = Math.min(heights[p], s.level - 1.5); // flatten the bed a touch
      if (px > 0) stack.push(p - 1);
      if (px < size - 1) stack.push(p + 1);
      if (py > 0) stack.push(p - size);
      if (py < size - 1) stack.push(p + size);
    }
    const toM = (g) => -halfSize + g * step;
    lakes.push({
      name: s.name,
      level: s.level,
      cells: filled,
      bounds: { minX: toM(x0) - step, maxX: toM(x1) + step, minZ: toM(y0) - step, maxZ: toM(y1) + step },
    });
    console.log(`  ${s.name}: ${filled} cells`);
  }

  // ------------------------------------------------------------ encode ---
  const png = new PNG({ width: size, height: size, colorType: 2 });
  const BIAS = 512;
  const SCALE = 2; // 0.5 m steps — below the DEM's own noise floor, keeps the file lean
  for (let p = 0; p < size * size; p++) {
    const v = Math.max(0, Math.min(65535, Math.round((heights[p] + BIAS) * SCALE)));
    png.data[p * 4] = v >> 8;
    png.data[p * 4 + 1] = v & 255;
    png.data[p * 4 + 2] = water[p];
    png.data[p * 4 + 3] = 255;
  }
  const out = PNG.sync.write(png, { deflateLevel: 9, filterType: 4 });
  await mkdir('data', { recursive: true });
  await writeFile('data/jungfrau.png', out);
  console.log(`wrote data/jungfrau.png (${(out.length / 1048576).toFixed(2)} MB)`);

  const meta = {
    generator: 'tools/bake-terrain.mjs',
    source: 'AWS Terrain Tiles (terrarium) — SwissALTI3D/SRTM et al, see ATTRIBUTION.md',
    sourceZoom: Z,
    centerLat: REGION.centerLat,
    centerLon: REGION.centerLon,
    halfSize,
    size,
    step,
    encoding: { bias: BIAS, scale: SCALE, waterChannel: 'b' },
    minHeight: Math.round(minH * 10) / 10,
    maxHeight: Math.round(maxH * 10) / 10,
    lakes,
    sha256: createHash('sha256').update(out).digest('hex').slice(0, 16),
  };
  await writeFile('data/jungfrau.json', JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
