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
  // Generous: Chicago buckets 145,000 buildings before the first frame, and
  // the software renderer here needs a while to produce one.
  await page.waitForSelector('.menu.open', { timeout: 30000 });
});

await step('level select lists both maps', async () => {
  const tabs = await page.$$eval('.level-tab', (els) => els.map((e) => e.dataset.value));
  if (tabs.length !== 2) throw new Error(`level tabs: ${tabs.join(',') || 'none'}`);
  // The other map's challenges have to be readable from here, or the two maps
  // are still two games.
  await page.click(`.level-tab[data-value="${map === 'jungfrau' ? 'chicago' : 'jungfrau'}"]`);
  const away = await page.$$eval('.task-list .task-row', (els) => els.length);
  if (away < 7) throw new Error(`other level shows ${away} rows`);
  if (!(await page.$('[data-action="goto"]'))) throw new Error('no way to travel to the other level');
  await page.click(`.level-tab[data-value="${map}"]`);
});

await step('one button and you are flying', async () => {
  await page.click('[data-action="fly"]');
  await page.waitForSelector('.flight.open', { timeout: 5000 });
  const s = await page.evaluate(() => window.WINDWARD.stats());
  if (s.phase !== 'flying') throw new Error(`phase ${s.phase}`);
  if (s.challenge) throw new Error(`flying started a challenge: ${s.challenge}`);
});

await step('glider stays airborne and controllable', async () => {
  const before = await page.evaluate(() => ({
    ...window.WINDWARD.stats(),
    hdg: window.WINDWARD.game.glider.headingDeg,
  }));
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
  const turned = Math.abs(((heading - before.hdg + 540) % 360) - 180);
  console.log(
    `        alt ${before.alt}->${after.alt} m, speed ${after.speed} km/h, bank ${bank.toFixed(0)}deg, turned ${turned.toFixed(0)}deg`
  );
  // The stick is a roll rate, not a bank angle: held over for two and a half
  // seconds it can go all the way round, so the sign and the magnitude of the
  // bank at the end are not the question. Whether the aeroplane responded is.
  if (Math.abs(bank) < 12 && turned < 25) {
    throw new Error(`stick right produced bank ${bank.toFixed(1)}deg, turn ${turned.toFixed(1)}deg`);
  }
  if (!isFinite(after.alt) || after.alt < 400) throw new Error(`altitude ${after.alt}`);
});

await step('pause and resume', async () => {
  await page.click('[data-action="pause"]');
  await page.waitForSelector('.results.open', { timeout: 3000 });
  await page.click('[data-action="resume"]');
  await page.waitForFunction(() => window.WINDWARD.stats().phase === 'flying', { timeout: 3000 });
});

await step('later challenges are locked behind medals', async () => {
  await page.click('[data-action="pause"]');
  await page.click('[data-action="menu"]');
  await page.waitForSelector('.menu.open', { timeout: 3000 });
  // A fresh profile has medals nowhere, so both levels must be holding
  // something back — and a held-back row must not be pressable.
  const locked = await page.$$eval('.task-row.locked', (els) => els.map((e) => e.dataset.action ?? ''));
  if (!locked.length) throw new Error('nothing is locked on a fresh profile');
  if (locked.some(Boolean)) throw new Error('a locked row is still a button');
});

await step('a challenge starts from the level select, in its own ship', async () => {
  const id = await page.$eval('[data-action="challenge"]', (el) => el.dataset.value);
  await page.click(`[data-action="challenge"][data-value="${id}"]`);
  await page.waitForFunction((want) => window.WINDWARD.stats().challenge === want, id, { timeout: 5000 });
  const s = await page.evaluate(() => window.WINDWARD.stats());
  const want = await page.evaluate((cid) => window.WINDWARD.game.challenges.defs.find((d) => d.id === cid).ship, id);
  if (s.aircraft !== want) throw new Error(`${id} flew ${s.aircraft}, not ${want}`);
});

await step('gates can be passed', async () => {
  // Whatever the level select happened to open may not be a gate course, and
  // on this map every gate course may still be locked. The lock is the menu's
  // job and was just tested; this step is about the gates themselves.
  await page.evaluate(() => {
    const g = window.WINDWARD.game;
    g.startChallenge(g.challenges.defs.find((d) => d.type === 'slalom'));
  });

  // Line the ship up on the gate's own axis and let it fly through under its
  // own power. Nudging the velocity alone is not enough — the flight model
  // pulls velocity back towards where the nose is pointing, so an unturned
  // glider stalls short of the plane.
  const passed = await page.evaluate(() => {
    const g = window.WINDWARD.game;
    const run = g.challenges.active;
    const gate = g.world.gates[run.gateIndex];
    const before = run.gateIndex;
    const heading = (Math.atan2(gate.normal.x, -gate.normal.z) * 180) / Math.PI;
    const start = gate.position.clone().addScaledVector(gate.normal, -50);
    g.glider.reset(start, heading, Math.max(55, g.spec.trimSpeed));
    // Step the simulation directly instead of sleeping. Software rendering
    // manages about a frame a second and main.js advances the sim by at most
    // 0.2 s per frame, so a wall-clock wait buys a fraction of the flight time
    // this needs — the test would be measuring the renderer, not the game.
    for (let i = 0; i < 720 && run.gateIndex === before; i++) g.update(1 / 120);
    return run.gateIndex > before;
  });
  if (!passed) throw new Error('gate was not registered');
});

await step('the menu carries no difficulty knob', async () => {
  await page.click('[data-action="pause"]');
  await page.click('[data-action="menu"]');
  // Time of day was one wearing a lighting label: thermals seed off the sun,
  // so it set the strength of every column on the map and moved the medal
  // ladder under a player who thought they were choosing a colour.
  if (await page.$('[data-action="time"]')) throw new Error('the time of day control is back');
  const err = await page.evaluate(() => window.WINDWARD.error);
  if (err) throw new Error(err);
});

await step('rotate to the other orientation', async () => {
  await page.setViewportSize(portrait ? { width: 932, height: 430 } : { width: 430, height: 932 });
  await page.waitForTimeout(800);
  const fov = await page.evaluate(() => window.WINDWARD.camera.fov);
  if (!(fov > 40 && fov < 90)) throw new Error(`fov ${fov}`);
});

await step('every challenge names a ship that exists', async () => {
  const bad = await page.evaluate(async () => {
    const { CHALLENGES } = await import('/src/regions.js');
    const { FLEET } = await import('/src/fleet.js');
    const ids = new Set(FLEET.map((s) => s.id));
    return Object.values(CHALLENGES)
      .flat()
      .filter((d) => !ids.has(d.ship))
      .map((d) => `${d.id}:${d.ship}`);
  });
  if (bad.length) throw new Error(bad.join(', '));
});

const stats = await page.evaluate(() => window.WINDWARD.stats());
console.log('  stats', JSON.stringify(stats));

await browser.close();

if (problems.length) {
  console.log('\nFAILURES:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nall good');
