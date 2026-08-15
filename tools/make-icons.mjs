/**
 * Draws the home-screen icons from the same 32-unit artwork as the favicon in
 * index.html, so an installed Windward looks like the tab it came from.
 *
 * They are generated rather than hand-drawn because the set has to stay in
 * sync: four sizes, one of them maskable with a different safe area. Committing
 * the generator means the next person can change the mark once.
 *
 *   node tools/make-icons.mjs
 */
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';

// The favicon mark from index.html, redrawn in its own 32x32 space. Same
// elements, different stacking: at 16 px the glider and the skyline overlap
// into one glyph, but at 512 px the ridge has to sit behind the wing or the
// icon reads as a shattered triangle.
const BG = [11, 26, 42, 255];
const WING = [222, 240, 255, 255];
const RIDGE = [97, 210, 255, 74];

const ART = [
  { fill: RIDGE, poly: [[-1, 33], [-1, 27], [6, 19], [12, 24], [19, 15], [26, 23], [33, 18], [33, 33]] },
  { fill: WING, poly: [[3.5, 15], [28.5, 15], [26.9, 17.4], [5.1, 17.4]] },
  { fill: WING, poly: [[15, 5], [17, 5], [18.4, 15], [13.6, 15]] },
];

/** Coverage of one polygon over a pixel grid, 4x supersampled for clean edges. */
function coverage(poly, size, scale, offset, out) {
  const S = 4;
  out.fill(0);
  const pts = poly.map(([x, y]) => [x * scale + offset, y * scale + offset]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const y0 = Math.max(0, Math.floor(minY * S));
  const y1 = Math.min(size * S - 1, Math.ceil(maxY * S));
  const xs = [];
  for (let sy = y0; sy <= y1; sy++) {
    const y = (sy + 0.5) / S;
    xs.length = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % n];
      if (ay === by || y < Math.min(ay, by) || y >= Math.max(ay, by)) continue;
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx0 = Math.max(0, Math.round(xs[k] * S));
      const sx1 = Math.min(size * S, Math.round(xs[k + 1] * S));
      for (let sx = sx0; sx < sx1; sx++) out[(sy >> 2) * size + (sx >> 2)] += 1 / (S * S);
    }
  }
  return out;
}

/** Rounded-rect coverage, so the plain icons are not naked squares. */
function roundedRect(size, radius, out) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - (x + 0.5), x + 0.5 - (size - radius), 0);
      const dy = Math.max(radius - (y + 0.5), y + 0.5 - (size - radius), 0);
      const d = Math.hypot(dx, dy);
      out[y * size + x] = Math.min(1, Math.max(0, radius - d + 0.5));
    }
  }
  return out;
}

function draw(size, { maskable }) {
  const png = new PNG({ width: size, height: size });
  const px = png.data;
  const cov = new Float32Array(size * size);

  // A maskable icon is cropped to whatever shape the launcher likes, so the
  // background runs to the bleed and the mark shrinks into the safe circle.
  const bg = maskable ? new Float32Array(size * size).fill(1) : roundedRect(size, size * 0.22, new Float32Array(size * size));
  for (let i = 0; i < size * size; i++) {
    const a = bg[i];
    px[i * 4] = BG[0];
    px[i * 4 + 1] = BG[1];
    px[i * 4 + 2] = BG[2];
    px[i * 4 + 3] = Math.round(a * 255);
  }

  const artScale = maskable ? 0.62 : 1;
  const scale = (size / 32) * artScale;
  const offset = (size - 32 * scale) / 2;
  for (const { fill, poly } of ART) {
    coverage(poly, size, scale, offset, cov);
    for (let i = 0; i < cov.length; i++) {
      const a = Math.min(1, cov[i]) * (fill[3] / 255) * (px[i * 4 + 3] / 255);
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(px[i * 4 + c] * (1 - a) + fill[c] * a);
    }
  }
  return PNG.sync.write(png);
}

await mkdir('icons', { recursive: true });
const jobs = [
  ['icons/icon-192.png', 192, { maskable: false }],
  ['icons/icon-512.png', 512, { maskable: false }],
  ['icons/icon-maskable-512.png', 512, { maskable: true }],
  // iOS composites its own rounded mask over an opaque square.
  ['icons/apple-touch-icon.png', 180, { maskable: true }],
];
for (const [path, size, opts] of jobs) {
  const buf = draw(size, opts);
  await writeFile(path, buf);
  console.log(`  ${path.padEnd(30)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} kB`);
}
