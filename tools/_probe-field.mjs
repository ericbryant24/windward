import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { Heightfield } from '../src/heightfield.js';

async function load(id) {
  const meta = JSON.parse(await readFile(new URL(`../data/${id}.json`, import.meta.url), 'utf8'));
  const png = PNG.sync.read(await readFile(new URL(`../data/${id}.png`, import.meta.url)));
  const n = meta.size;
  const h = new Float32Array(n * n);
  const w = new Uint8Array(n * n);
  const { bias, scale } = meta.encoding;
  for (let p = 0, q = 0; p < h.length; p++, q += 4) {
    h[p] = (png.data[q] * 256 + png.data[q + 1]) / scale - bias;
    w[p] = png.data[q + 2] > 127 ? 1 : 0;
  }
  return new Heightfield(meta, h, w, null);
}
const CAND = {
  jungfrau: {
    'grindelwald basin': [[46.6335, 8.0205], [46.628, 8.0405], [46.6205, 8.0605], [46.6135, 8.0755]],
    'kleine scheidegg shelf': [[46.5853, 7.9614], [46.5895, 7.9805], [46.5905, 8.0], [46.5865, 8.019]],
  },
  chicago: {
    'the harbour': [[41.8665, -87.6095], [41.8755, -87.6075], [41.8845, -87.6065], [41.8925, -87.6045], [41.9015, -87.6265]],
    'lincoln park shore': [[41.9095, -87.6295], [41.9215, -87.634], [41.9335, -87.6385]],
  },
};
for (const [map, sets] of Object.entries(CAND)) {
  const hf = await load(map);
  const toLocal = (lat, lon) => ({
    x: (lon - hf.meta.centerLon) * 111320 * Math.cos((hf.meta.centerLat * Math.PI) / 180),
    z: (hf.meta.centerLat - lat) * 111320,
  });
  console.log(`\n=== ${map} (half ${hf.halfSize}) ===`);
  for (const [name, path] of Object.entries(sets)) {
    const pts = path.map(([a, b]) => toLocal(a, b));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const rows = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s < L; s += 120) {
        const x = a.x + ((b.x - a.x) * s) / L;
        const z = a.z + ((b.z - a.z) * s) / L;
        // and 300 m either side, since balloons scatter laterally
        const side = [-300, 0, 300].map((o) => {
          const px = x - ((b.z - a.z) / L) * o;
          const pz = z + ((b.x - a.x) / L) * o;
          return { h: hf.heightAt(px, pz), w: hf.isWater(px, pz) };
        });
        rows.push(side);
      }
    }
    const flat = rows.flat();
    const hs = flat.map((r) => r.h);
    console.log(
      `  ${name}: ${(len / 1000).toFixed(2)} km · ground ${Math.min(...hs).toFixed(0)}–${Math.max(...hs).toFixed(0)} m · water ${((flat.filter((r) => r.w).length / flat.length) * 100).toFixed(0)}%`
    );
    console.log('   centreline: ' + rows.map((r) => r[1].h.toFixed(0) + (r[1].w ? 'w' : '')).join(' '));
  }
}
