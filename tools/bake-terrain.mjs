/**
 * Bakes a region's heightfield from AWS "terrarium" terrain tiles into a
 * compact PNG the game can decode in the browser.
 *
 *   R,G  -> elevation, packed big-endian as round((h + 512) * 2)  [0.5 m steps]
 *   B    -> water mask (255 = water surface)
 *
 * Stays three-channel deliberately. A vegetation mask in the alpha channel
 * would be free storage but not free data: the browser decodes a PNG into a
 * canvas through premultiplied alpha, so every height sample under a
 * transparent pixel comes back as zero. Regions that bake vegetation get their
 * own greyscale file alongside.
 *
 * Usage: node tools/bake-terrain.mjs [jungfrau|chicago]
 */
import { PNG } from 'pngjs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { regionFromArgv, paths, bbox, projector, MPD_LAT, mpdLon } from './regions.mjs';
import { cachedQuery } from './overpass.mjs';

const REGION = regionFromArgv();
const DEBUG = !!process.env.RASTER_DEBUG;
const OUT = paths(REGION);
const TILE = 256;
const CACHE = path.join(process.cwd(), '.cache/tiles');
const Z = REGION.sourceZoom;

// local ENU <-> WGS84 (equirectangular around the centre; fine at this scale)
export function metresToLatLon(x, z) {
  return [REGION.centerLat - z / MPD_LAT, REGION.centerLon + x / mpdLon(REGION.centerLat)];
}

const lon2tile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2tile = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

// ----------------------------------------------------------------- tiles ---
async function fetchTile(z, x, y) {
  const file = path.join(CACHE, `${z}_${x}_${y}.png`);
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

// ------------------------------------------------------------ OSM shapes ---
/**
 * Chain a multipolygon's member ways into closed rings.
 *
 * This is the part that cannot be skipped. Lake Michigan is a single relation
 * whose outer boundary arrives as 742 separate ways; treating each fragment as
 * a closed polygon fills 742 meaningless triangles instead of a lake. Members
 * that share an endpoint belong to the same ring, so join them until the ring
 * closes on itself.
 */
function assembleRings(members) {
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const open = members.filter((m) => m.length >= 2);
  const byEnd = new Map();
  open.forEach((way, i) => {
    for (const p of [way[0], way[way.length - 1]]) {
      const k = key(p);
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(i);
    }
  });

  const used = new Uint8Array(open.length);
  const rings = [];
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let ring = open[i].slice();
    // Grow from both ends. Members do not arrive in ring order, so a way that
    // happens to sit in the middle of its ring would otherwise chain forwards,
    // run out, and leave the ring open — which fills as a torn shape or not at
    // all.
    for (const forward of [true, false]) {
      for (;;) {
        if (ring.length > 2 && key(ring[0]) === key(ring[ring.length - 1])) break; // closed
        const tip = forward ? ring[ring.length - 1] : ring[0];
        const next = (byEnd.get(key(tip)) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const w = open[next];
        const aligned = key(w[0]) === key(tip) ? w : w.slice().reverse();
        ring = forward ? ring.concat(aligned.slice(1)) : aligned.slice(0, -1).concat(ring);
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * Fetch areas for a set of `key=value` selectors as polygons in the local
 * metric frame. A polygon is a list of rings — outer boundary first, holes
 * after — which an even-odd fill handles without needing to know which is which.
 */
async function fetchPolygons(cacheFile, selectors, label) {
  const box = bbox(REGION, 500);
  const bb = `${box.south},${box.west},${box.north},${box.east}`;
  const filter = selectors
    .map((s) => {
      const [k, v] = s.split('=');
      return `way["${k}"="${v}"](${bb});relation["${k}"="${v}"](${bb});`;
    })
    .join('\n  ');
  const json = await cachedQuery(cacheFile, `[out:json][timeout:300];\n(${filter}\n);\nout geom;`, {
    label,
  });
  const project = projector(REGION);
  const polygons = [];
  let rings = 0;
  for (const el of json.elements) {
    if (el.type === 'way' && el.geometry) {
      polygons.push([el.geometry.map((p) => project(p.lat, p.lon))]);
      rings++;
    } else if (el.type === 'relation' && el.members) {
      const parts = el.members
        .filter((m) => m.type === 'way' && m.geometry)
        .map((m) => m.geometry.map((p) => project(p.lat, p.lon)));
      const assembled = assembleRings(parts);
      if (assembled.length) {
        polygons.push(assembled);
        rings += assembled.length;
      }
    }
  }
  console.log(`  ${label}: ${json.elements.length} elements -> ${polygons.length} polygons, ${rings} rings`);
  return polygons;
}

/**
 * Even-odd scanline fill. Every ring of a polygon is crossed in the same pass,
 * so holes punch themselves out without the caller tracking outer from inner.
 */
function rasterise(polygons, mask, size, halfSize, step, value = 255) {
  const toCol = (x) => (x + halfSize) / step;
  const toRow = (z) => (z + halfSize) / step;
  let painted = 0;
  let pi = 0;
  for (const poly of polygons) {
    let polyPainted = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const ring of poly) {
      for (const p of ring) {
        const r = toRow(p[1]);
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
    }
    const y0 = Math.max(0, Math.floor(lo));
    const y1 = Math.min(size - 1, Math.ceil(hi));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ay = toRow(ring[j][1]);
          const by = toRow(ring[i][1]);
          if (ay === by) continue;
          if (yc >= Math.min(ay, by) && yc < Math.max(ay, by)) {
            const t = (yc - ay) / (by - ay);
            xs.push(toCol(ring[j][0]) + t * (toCol(ring[i][0]) - toCol(ring[j][0])));
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
        const x1 = Math.min(size - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = x0; x <= x1; x++) {
          if (!mask[y * size + x]) painted++;
          mask[y * size + x] = value;
          if (DEBUG) polyPainted++;
        }
      }
    }
    if (DEBUG && polyPainted > 0) console.log(`    poly#${pi} rings=${poly.length} pts=${poly.reduce((s,r)=>s+r.length,0)} painted=${polyPainted}`);
    pi++;
  }
  return painted;
}

/** Widen a mask by one cell in each direction, n times. */
function dilate(mask, size, n) {
  for (let pass = 0; pass < n; pass++) {
    const copy = mask.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (copy[y * size + x]) continue;
        const up = y > 0 && copy[(y - 1) * size + x];
        const dn = y < size - 1 && copy[(y + 1) * size + x];
        const lf = x > 0 && copy[y * size + x - 1];
        const rt = x < size - 1 && copy[y * size + x + 1];
        if (up || dn || lf || rt) mask[y * size + x] = 255;
      }
    }
  }
}

// ------------------------------------------------------------------ bake ---
async function main() {
  const { size, halfSize } = REGION;
  console.log(`baking ${REGION.name}: ${(2 * halfSize) / 1000} km square at ${size}^2, source z${Z}`);

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

  const W = cols * TILE;
  const H = rows * TILE;
  const src = new Float32Array(W * H);
  let done = 0;
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ tx, ty });
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
            const h = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
            src[(oy + y) * W + ox + x] = h;
          }
        }
        if (++done % 25 === 0) console.log(`  ${done} tiles`);
      }
    })
  );
  console.log(`stitched ${W}x${H} source samples`);

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
  const water = new Uint8Array(size * size);
  const lakes = [];
  const toM = (g) => -halfSize + g * step;
  const cfg = REGION.water;

  if (cfg.mode === 'flood') {
    // Deep basins: flood-fill from a seed and let the DEM draw the shoreline.
    const toGrid = (lat, lon) => {
      const x = (lon - REGION.centerLon) * mpdLon(REGION.centerLat);
      const z = (REGION.centerLat - lat) * MPD_LAT;
      return [Math.round((x + halfSize) / step), Math.round((z + halfSize) / step)];
    };
    for (const s of cfg.seeds) {
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
        heights[p] = Math.min(heights[p], s.level - 1.5);
        if (px > 0) stack.push(p - 1);
        if (px < size - 1) stack.push(p + 1);
        if (py > 0) stack.push(p - size);
        if (py < size - 1) stack.push(p + size);
      }
      lakes.push({
        name: s.name,
        level: s.level,
        cells: filled,
        bounds: { minX: toM(x0) - step, maxX: toM(x1) + step, minZ: toM(y0) - step, maxZ: toM(y1) + step },
      });
      console.log(`  ${s.name}: ${filled} cells`);
    }
  } else if (cfg.mode === 'sea') {
    // An island, or a fjord. The sea is not a basin to be found — it is
    // everything at or below zero, and the terrarium DEM carries real
    // bathymetry, so a threshold draws a coastline more accurate than any
    // outline could. One pass, no stack.
    //
    // Flood-filling this would work and would be a mistake: the ocean round
    // Maui is four million cells and the fill pushes four neighbours per pop,
    // so the frontier peaks in the millions of entries for an answer a single
    // comparison per cell already gives.
    let filled = 0;
    for (let p = 0; p < heights.length; p++) {
      if (heights[p] > cfg.cutoff) continue;
      water[p] = 255;
      filled++;
      // Sink the bed so the shader's depth ramp has somewhere to go, but leave
      // the real bathymetry alone where it is already deeper — the drop-off
      // outside a fjord mouth is worth seeing.
      heights[p] = Math.min(heights[p], cfg.level - 4.0);
    }
    lakes.push({
      name: cfg.name,
      level: cfg.level,
      cells: filled,
      // One surface over the whole region. Sea level is sea level everywhere.
      bounds: { minX: -halfSize, maxX: halfSize, minZ: -halfSize, maxZ: halfSize },
    });
    console.log(`  ${cfg.name}: ${filled} cells (${((100 * filled) / water.length).toFixed(1)}% of the map)`);
  } else if (cfg.mode === 'cutoff+osm') {
    // Flat city: the lakefront is landfill and the river sits at the same
    // height as the streets beside it, so neither can be found by looking at
    // elevation. Both come from their surveyed outlines instead. That is the
    // whole point of this map — Grant Park and Northerly Island are where the
    // city built them, not where a contour line happens to fall.
    const polys = await fetchPolygons(
      OUT.osmWater,
      ['natural=water', 'waterway=riverbank', 'water=river', 'water=canal', 'landuse=reservoir'],
      'water'
    );
    const painted = rasterise(polys, water, size, halfSize, step);
    // The narrow branches are only a few cells across at this resolution; one
    // dilation keeps them from breaking into a dotted line.
    dilate(water, size, 1);
    console.log(`  ${cfg.name}, river and inland water: ${painted} cells painted`);

    // Sink the bed so the shader's depth ramp has something to work with, and
    // hold the surface flat.
    for (let p = 0; p < heights.length; p++) {
      if (water[p]) heights[p] = Math.min(heights[p], cfg.level - 4.0);
    }

    lakes.push({
      name: cfg.name,
      level: cfg.level,
      cells: water.reduce((s, v) => s + (v ? 1 : 0), 0),
      // One surface spans the whole region: the mask carves the lake and every
      // branch of the river out of it, and they share a level to within a few
      // centimetres in reality.
      bounds: { minX: -halfSize, maxX: halfSize, minZ: -halfSize, maxZ: halfSize },
    });
  }

  // -------------------------------------------------------- vegetation ---
  let vegetation = null;
  const veg = new Uint8Array(size * size).fill(255);
  if (REGION.vegetation?.mode === 'osm') {
    veg.fill(0);
    const polys = await fetchPolygons(OUT.osmVegetation, REGION.vegetation.tags, 'vegetation');
    const painted = rasterise(polys, veg, size, halfSize, step);
    for (let p = 0; p < veg.length; p++) if (water[p]) veg[p] = 0;
    vegetation = { mode: 'osm', cells: painted, tags: REGION.vegetation.tags };
    console.log(`  vegetation: ${painted} cells (${((100 * painted) / veg.length).toFixed(1)}% of the map)`);
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
  await writeFile(OUT.terrain, out);
  console.log(`wrote ${OUT.terrain} (${(out.length / 1048576).toFixed(2)} MB)`);

  // Vegetation goes in its own greyscale file, at the resolution the runtime
  // forest mask actually uses.
  if (vegetation) {
    // Half the terrain's resolution, capped. At 1536 that is the 768 this
    // always wrote; at 3072 it is 1536, which is 24.8 m a forest cell instead
    // of 49.5 — and a forest EDGE is most of what a wooded slope looks like
    // from the air, so it is the edge that has to be worth the kilobytes.
    const VN = Math.min(1536, size >> 1);
    const vpng = new PNG({ width: VN, height: VN, colorType: 0 });
    // Every source cell into exactly one bin, rather than a fixed 2x2 window
    // walked at whatever stride the ratio happens to be.
    //
    // The old version sampled a 2x2 box at a stride of (size-1)/(VN-1). At
    // 1536 that stride was 2 and the box covered the block exactly. At 3072 it
    // is 4 and the box still covered 2x2 — four of every sixteen source cells
    // read and twelve thrown away. The average came out unbiased and the EDGES
    // came out as staircases, because whether a boundary cell survived
    // depended on which quarter of the block it fell in.
    const acc = new Float64Array(VN * VN);
    const cnt = new Uint32Array(VN * VN);
    for (let y = 0; y < size; y++) {
      const j = Math.min(VN - 1, Math.floor((y * VN) / size));
      for (let x = 0; x < size; x++) {
        const k = j * VN + Math.min(VN - 1, Math.floor((x * VN) / size));
        acc[k] += veg[y * size + x];
        cnt[k]++;
      }
    }
    for (let p = 0; p < VN * VN; p++) {
      vpng.data[p * 4] = cnt[p] ? Math.round(acc[p] / cnt[p]) : 0;
      vpng.data[p * 4 + 3] = 255;
    }
    const vout = PNG.sync.write(vpng, { deflateLevel: 9, filterType: 4 });
    await writeFile(OUT.vegetation, vout);
    vegetation.size = VN;
    vegetation.file = OUT.vegetation;
    console.log(`wrote ${OUT.vegetation} (${(vout.length / 1024).toFixed(0)} kB, ${VN}^2)`);
  }

  const meta = {
    generator: 'tools/bake-terrain.mjs',
    region: REGION.id,
    name: REGION.name,
    source: 'AWS Terrain Tiles (terrarium) — see ATTRIBUTION.md',
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
    vegetation,
    sha256: createHash('sha256').update(out).digest('hex').slice(0, 16),
  };
  await writeFile(OUT.meta, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ ...meta, vegetation: vegetation && { ...vegetation, tags: undefined } }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
