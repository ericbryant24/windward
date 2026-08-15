/**
 * Winding checks for the geometry emitters.
 *
 * This exists because the same bug has now shipped three times. Roads were
 * invisible for a release because their quads were wound clockwise seen from
 * above; buildings shipped "three-sided" because every wall and roof triangle
 * faced inwards, so back-face culling removed the near wall and left you
 * looking at the inside of the far ones. Both had correct attribute normals,
 * which is why both looked plausible in a screenshot until you were in the
 * wrong place.
 *
 * The invariant is simple and mechanical: for every triangle, the geometric
 * normal implied by its vertex order must agree with the normal the shader is
 * told to light it by. Nothing about that needs a browser.
 *
 *   node tools/geometry-test.mjs
 */
import { emitWalls, emitFlatRoof, emitRoof, emitApexRoof, emitSkillionRoof, emitSkirtRoof, emitGableRoof, emitRoofClutter } from '../src/buildings.js';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Rings wound the way the baker guarantees (signedArea > 0), in x,z pairs. */
const RINGS = {
  square: [-10, -10, 10, -10, 10, 10, -10, 10],
  rect: [-24, -8, 24, -8, 24, 8, -24, 8],
  L: [-15, -15, 5, -15, 5, 0, 15, 0, 15, 15, -15, 15],
  hexagon: Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return [Math.cos(a) * 12, Math.sin(a) * 12];
  }).flat(),
};

/** The baker's own orientation test, so the fixtures match real data. */
function signedArea(ring, n) {
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += (ring[j * 2] - ring[i * 2]) * (ring[j * 2 + 1] + ring[i * 2 + 1]);
  }
  return a / 2;
}

let failures = 0;
let checked = 0;

function check(name, run) {
  const pos = [];
  const nrm = [];
  const style = [];
  run(pos, nrm, style);
  const tris = pos.length / 9;
  if (tris === 0) {
    console.log(`  ??   ${name}: emitted nothing`);
    failures++;
    return;
  }
  let bad = 0;
  let degenerate = 0;
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const v0 = [pos[o], pos[o + 1], pos[o + 2]];
    const v1 = [pos[o + 3], pos[o + 4], pos[o + 5]];
    const v2 = [pos[o + 6], pos[o + 7], pos[o + 8]];
    const g = cross(sub(v1, v0), sub(v2, v0));
    if (len(g) < 1e-6) {
      degenerate++;
      continue;
    }
    // The attribute normal is per-vertex but constant across these triangles.
    const a = [nrm[o], nrm[o + 1], nrm[o + 2]];
    if (dot(g, a) <= 0) bad++;
  }
  checked += tris;
  const ok = bad === 0;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ${tris} triangles` +
      (bad ? `, ${bad} wound inside-out` : '') +
      (degenerate ? `, ${degenerate} degenerate` : '')
  );
}

console.log('winding: geometric normal must agree with the shaded normal\n');

for (const [shape, ring] of Object.entries(RINGS)) {
  const n = ring.length / 2;
  if (signedArea(ring, n) < 0) throw new Error(`fixture "${shape}" is wound the wrong way for the baker`);

  check(`walls / ${shape}`, (p, nr, st) => emitWalls(p, nr, st, ring, n, 0, 20, 1));
  check(`flat roof / ${shape}`, (p, nr, st) => emitFlatRoof(p, nr, st, ring, n, 20, 1));
  check(`apex roof / ${shape}`, (p, nr, st) => emitApexRoof(p, nr, st, ring, n, 20, 6, 1));
  check(`skillion roof / ${shape}`, (p, nr, st) => emitSkillionRoof(p, nr, st, ring, n, 20, 4, 0.3, 1));
  check(`mansard roof / ${shape}`, (p, nr, st) => emitSkirtRoof(p, nr, st, ring, n, 20, 5, 1));
  check(`gable roof / ${shape}`, (p, nr, st) => emitGableRoof(p, nr, st, ring, n, 20, 6, 0.3, 1));
  check(`roof clutter / ${shape}`, (p, nr, st) => emitRoofClutter(p, nr, st, ring, n, 20, 100, 200, 1, 1));
}

// Every roof kind the baker can emit must route to something that winds right.
console.log('');
for (let kind = 0; kind <= 8; kind++) {
  const ring = RINGS.rect;
  check(`emitRoof kind ${kind}`, (p, nr, st) => emitRoof(p, nr, st, ring, ring.length / 2, 20, 6, kind, 0.4, 1));
}

console.log(`\n${checked} triangles checked`);
if (failures) {
  console.log(`${failures} emitter(s) wound inside-out — back-face culling will eat them`);
  process.exit(1);
}
console.log('all emitters wound so the visible side faces out');
