/**
 * End-to-end smoke test: boots the game in headless Chromium, drives the menu,
 * flies for a bit with simulated stick input, and fails on any console error.
 *
 *   node tools/smoke.mjs [--portrait]
 */
import { chromium } from 'playwright';

const portrait = process.argv.includes('--portrait');
const mapArg = process.argv.find((a) => a.startsWith('--map='));
const map = mapArg ? mapArg.slice(6) : 'jungfrau';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: portrait ? { width: 430, height: 932 } : { width: 1280, height: 720 },
  hasTouch: true,
});

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
};

await page.goto(`http://localhost:8080/index.html?map=${map}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 120000 });

console.log(`${map} — ${portrait ? 'portrait 430x932' : 'landscape 1280x720'}`);

await step('boot without error', async () => {
  const err = await page.evaluate(() => window.WINDWARD.error);
  if (err) throw new Error(err);
});

await step('menu is showing', async () => {
  // Generous: Chicago buckets 104,000 buildings before the first frame, and
  // the software renderer here needs a while to produce one.
  await page.waitForSelector('.menu.open', { timeout: 30000 });
});

await step('start free flight', async () => {
  await page.click('[data-action="start"][data-value="free"]');
  await page.waitForSelector('.flight.open', { timeout: 5000 });
  const s = await page.evaluate(() => window.WINDWARD.stats());
  if (s.phase !== 'flying') throw new Error(`phase ${s.phase}`);
});

await step('glider stays airborne and controllable', async () => {
  const before = await page.evaluate(() => window.WINDWARD.stats());
  // hold the stick over to the right for a couple of seconds
  const box = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(box.w * 0.2, box.h * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.w * 0.2 + 70, box.h * 0.75, { steps: 5 });
  await page.waitForTimeout(2500);
  await page.mouse.up();
  const after = await page.evaluate(() => window.WINDWARD.stats());
  const heading = await page.evaluate(() => window.WINDWARD.game.glider.headingDeg);
  const bank = await page.evaluate(() => window.WINDWARD.game.glider.bankDeg);
  console.log(
    `        alt ${before.alt}->${after.alt} m, speed ${after.speed} km/h, bank ${bank.toFixed(0)}deg, hdg ${heading.toFixed(0)}`
  );
  if (bank < 12) throw new Error(`stick right produced bank ${bank.toFixed(1)}deg`);
  if (!isFinite(after.alt) || after.alt < 400) throw new Error(`altitude ${after.alt}`);
});

await step('pause and resume', async () => {
  await page.click('[data-action="pause"]');
  await page.waitForSelector('.results.open', { timeout: 3000 });
  await page.click('[data-action="resume"]');
  await page.waitForFunction(() => window.WINDWARD.stats().phase === 'flying', { timeout: 3000 });
});

await step('back to menu and into the circuit', async () => {
  await page.click('[data-action="pause"]');
  await page.click('[data-action="menu"]');
  await page.waitForSelector('.menu.open', { timeout: 3000 });
  await page.click('[data-action="start"][data-value="circuit"]');
  await page.waitForFunction(() => window.WINDWARD.stats().mode === 'circuit', { timeout: 3000 });
});

await step('gates can be passed', async () => {
  // Line the ship up on the gate's own axis and let it fly through under its
  // own power. Two things this has to respect. Nudging the velocity alone is
  // not enough — the flight model pulls velocity back towards where the nose
  // is pointing, so an unturned glider stalls short of the plane. And software
  // rendering here runs at about a frame a second, so the run-in has to be
  // short and the wait long, or the glider simply never arrives.
  const passed = await page.evaluate(async () => {
    const g = window.WINDWARD.game;
    const gate = g.world.gates[g.gateIndex];
    const before = g.gateIndex;
    const heading = (Math.atan2(gate.normal.x, -gate.normal.z) * 180) / Math.PI;
    const start = gate.position.clone().addScaledVector(gate.normal, -50);
    g.glider.reset(start, heading, 55);
    for (let i = 0; i < 100 && g.gateIndex === before; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return g.gateIndex > before;
  });
  if (!passed) throw new Error('gate was not registered');
});

await step('change time of day', async () => {
  await page.click('[data-action="pause"]');
  await page.click('[data-action="menu"]');
  await page.click('[data-action="time"][data-value="golden"]');
  await page.waitForTimeout(2500);
  const err = await page.evaluate(() => window.WINDWARD.error);
  if (err) throw new Error(err);
});

await step('rotate to the other orientation', async () => {
  await page.setViewportSize(portrait ? { width: 932, height: 430 } : { width: 430, height: 932 });
  await page.waitForTimeout(800);
  const fov = await page.evaluate(() => window.WINDWARD.camera.fov);
  if (!(fov > 40 && fov < 90)) throw new Error(`fov ${fov}`);
});

const stats = await page.evaluate(() => window.WINDWARD.stats());
console.log('  stats', JSON.stringify(stats));

await browser.close();

if (problems.length) {
  console.log('\nFAILURES:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nall good');
