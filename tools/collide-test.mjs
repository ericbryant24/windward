/**
 * Building collision checks, in a real browser against real map data.
 *
 * A screenshot cannot tell you whether a hit test fires — the ship either
 * stops or it does not, and at 74 m/s with a clamped timestep it can cross a
 * whole city block between frames. So this drives the collision directly:
 * pick the tallest buildings out of the loaded data, fire segments through
 * them and past them, and assert what should and should not register.
 *
 *   node tools/collide-test.mjs [chicago|jungfrau]
 */
import { chromium } from 'playwright';

const map = process.argv[2] ?? 'chicago';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:8080/index.html?map=${map}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 120000 });

const report = await page.evaluate(() => {
  const g = window.WINDWARD.game;
  const B = g.buildings;
  const d = B.data;
  const out = { cases: [], grid: B.hitGrid ? B.hitGrid.size : 0, count: d.count };

  // The tallest buildings, which are the ones a player will actually hit.
  // Taken by rank, not by an absolute height: Jungfrau's biggest is a hotel.
  const tall = [];
  for (let i = 0; i < d.count; i++) tall.push({ i, h: d.baseH[i] + d.wallH[i] + d.roofH[i] });
  tall.sort((a, b) => b.h - a.h);
  out.tallest = Math.round(tall[0].h);
  out.tallCount = tall.filter((t) => t.h > 60).length;

  const V = (x, y, z) => ({ x, y, z });
  const sample = tall.slice(0, 24);

  let through = 0;
  let noTunnel = 0;
  let over = 0;

  // Every assertion is about the target building. Downtown is dense enough
  // that "is anything hit" says nothing useful — a segment passing a tower
  // four hundred metres to the side is supposed to hit its neighbours.
  for (const { i } of sample) {
    const ox = d.origin[i * 2];
    const oz = d.origin[i * 2 + 1];
    const ground = g.hf.heightAt(ox, oz);
    const mid = ground + d.baseH[i] + d.wallH[i] * 0.5;
    const r = Math.max(d.radius[i], 6);
    const top = ground + d.baseH[i] + d.wallH[i] + d.roofH[i];

    // 1. a short run at the wall, ending inside the footprint. Any hit counts:
    //    the tall ones are Willis Tower's own bundled tubes, so a ray through
    //    one of them properly registers against a sibling part first.
    const near = B.hitSegment(V(ox - (r + 4), mid, oz), V(ox, mid, oz));
    if (near) through++;

    // 2. the same building approached in one step half a kilometre long: the
    //    tunnelling case, and the reason the test is swept rather than a point
    const far = B.hitSegment(V(ox - 500, mid, oz), V(ox + 500, mid, oz));
    if (far) noTunnel++;

    // 3. clearing its roof must not register against it, though a taller
    //    neighbour on the same line legitimately might
    const above = B.hitSegment(V(ox - (r + 4), top + 40, oz), V(ox, top + 40, oz));
    if (!above || above.index !== i) over++;
  }

  out.cases.push({ name: 'a wall registers when flown into', got: through, want: sample.length });
  out.cases.push({ name: 'a 1 km step cannot tunnel through', got: noTunnel, want: sample.length });
  out.cases.push({ name: 'clearing the roof does not register', got: over, want: sample.length });

  // the hit reports a usable outward normal
  let normals = 0;
  for (const { i } of sample) {
    const ox = d.origin[i * 2];
    const oz = d.origin[i * 2 + 1];
    const ground = g.hf.heightAt(ox, oz);
    const mid = ground + d.baseH[i] + d.wallH[i] * 0.5;
    const hit = B.hitSegment(V(ox - 400, mid, oz), V(ox + 400, mid, oz));
    if (hit && Math.abs(Math.hypot(hit.nx, hit.nz) - 1) < 0.01) normals++;
  }
  out.cases.push({ name: 'hit carries a unit wall normal', got: normals, want: sample.length });

  // 5. cost: this runs every frame, so it has to be cheap
  const t0 = performance.now();
  const N = 400;
  for (let k = 0; k < N; k++) {
    const { i } = sample[k % sample.length];
    const ox = d.origin[i * 2];
    const oz = d.origin[i * 2 + 1];
    B.hitSegment(V(ox - 30, g.hf.heightAt(ox, oz) + 40, oz - 30), V(ox + 30, g.hf.heightAt(ox, oz) + 40, oz + 30));
  }
  out.microseconds = ((performance.now() - t0) / N) * 1000;

  return out;
});

console.log(
  `${map}: ${report.count} buildings, tallest ${report.tallest} m, ${report.tallCount} over 60 m, ${report.grid} collision cells`
);
let bad = 0;
for (const c of report.cases) {
  const ok = c.got === c.want;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(42)} ${c.got}/${c.want}`);
}
const budget = 260;
const fast = report.microseconds < budget;
if (!fast) bad++;
console.log(`  ${fast ? 'ok  ' : 'FAIL'} ${'cost per test'.padEnd(42)} ${report.microseconds.toFixed(1)} us (budget ${budget})`);

await browser.close();
if (problems.length) {
  console.log('\n' + problems.join('\n'));
  bad++;
}
console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exit(bad ? 1 : 0);
