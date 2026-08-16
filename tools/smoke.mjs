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
  const other = map === 'jungfrau' ? 'chicago' : 'jungfrau';
  const tabs = await page.$$eval('.level-tab', (els) => els.map((e) => e.dataset.value));
  if (tabs.length !== 2) throw new Error(`level tabs: ${tabs.join(',') || 'none'}`);
  // The other map's challenges have to be readable from here, or the two maps
  // are still two games.
  await page.click(`.level-tab[data-value="${other}"]`);
  const away = await page.$$eval('.task-list .task-row', (els) => els.length);
  if (away < 6) throw new Error(`other level shows ${away} rows`);
  // Picking a level is the only step: Fly goes wherever the list is pointing,
  // rather than to a second button that has to be found underneath it.
  const flyTo = await page.$eval('.fly-btn', (el) => el.dataset.value);
  if (flyTo !== other) throw new Error(`Fly still points at ${flyTo}`);
  if (await page.$('[data-action="goto"]')) throw new Error('the extra travel button is back');
  await page.click(`.level-tab[data-value="${map}"]`);
  if ((await page.$eval('.fly-btn', (el) => el.dataset.value)) !== map) {
    throw new Error('Fly did not follow the level back');
  }
});

await step('the menu offers one aeroplane and no way to change it', async () => {
  const { issued, shown } = await page.evaluate(async () => {
    const { ISSUED_AIRCRAFT } = await import('/src/fleet.js');
    return {
      issued: ISSUED_AIRCRAFT,
      shown: [...document.querySelectorAll('[data-action="aircraft"]')].filter(
        (el) => el.offsetParent !== null
      ).length,
    };
  });
  if (!issued) throw new Error('no ship is issued — the hangar is back');
  if (shown) throw new Error(`${shown} aircraft cards are on screen`);
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

await step('a challenge starts from the level select, in the issued ship', async () => {
  const id = await page.$eval('[data-action="challenge"]', (el) => el.dataset.value);
  await page.click(`[data-action="challenge"][data-value="${id}"]`);
  await page.waitForFunction((want) => window.WINDWARD.stats().challenge === want, id, { timeout: 5000 });
  const s = await page.evaluate(() => window.WINDWARD.stats());
  // Whatever the table says a task was designed around, nothing swaps the
  // aeroplane underneath the player while one ship is issued.
  const want = await page.evaluate(async (cid) => {
    const { shipFor } = await import('/src/challenges.js');
    return shipFor(window.WINDWARD.game.challenges.defs.find((d) => d.id === cid)).id;
  }, id);
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

await step('every challenge is one of the four kinds, with a ladder that climbs', async () => {
  const bad = await page.evaluate(async () => {
    const { CHALLENGES } = await import('/src/regions.js');
    const { TYPES } = await import('/src/challenges.js');
    const out = [];
    for (const def of Object.values(CHALLENGES).flat()) {
      const t = TYPES[def.type];
      if (!t) {
        out.push(`${def.id}: unknown kind "${def.type}"`);
        continue;
      }
      const [b, s, g] = def.medals;
      // A slalom's rungs descend and carry a clock; the windowed three ascend
      // and carry a window. Getting either backwards is a ladder nobody climbs.
      if (t.wins === 'low' ? !(b > s && s > g) : !(b < s && s < g)) {
        out.push(`${def.id}: ladder does not climb (${b}/${s}/${g})`);
      }
      if (t.windowed && !(def.window > 0)) out.push(`${def.id}: no window`);
      if (!t.windowed && !(def.limit > 0 && def.limit <= 90)) out.push(`${def.id}: limit ${def.limit}`);
      if (!t.windowed && b >= def.limit) out.push(`${def.id}: bronze ${b} is not under the limit ${def.limit}`);
    }
    return out;
  });
  if (bad.length) throw new Error(bad.join(', '));
});

await step('there is traffic on the roads', async () => {
  const out = await page.evaluate(async (m) => {
    const g = window.WINDWARD.game;
    // In the air, and over the busiest ground on the map rather than wherever
    // the last step left us: the point is the density, not the draw distance.
    // In the menu the camera is orbiting a mountain and there is no traffic
    // anywhere near it, which is correct and measures nothing.
    g.startFlight();
    const [la, lo] = m === 'chicago' ? [41.8819, -87.6278] : [46.686, 7.863];
    const v = g.world.toLocal(la, lo);
    g.glider.reset(new g.glider.position.constructor(v.x, g.hf.heightAt(v.x, v.z) + 450, v.z), 90, 44);
    for (let i = 0; i < 30; i++) g.update(1 / 120);
    const fwd = new g.camera.position.constructor(0, 0, -1).applyQuaternion(g.camera.quaternion);
    g.network.update(1 / 60, g.camera.position, fwd);
    const kinds = new Set(g.network.routes.filter((r) => r.movers.length).map((r) => r.kind));
    return { movers: g.network.moverCount, kinds: [...kinds].sort() };
  }, map);
  // A city block is a car or two; an alpine valley road is busier than empty.
  const floor = map === 'chicago' ? 700 : 250;
  if (out.movers < floor) throw new Error(`only ${out.movers} vehicles over the middle of ${map}`);
  // Roads AND rails, not just whichever kind happens to sort first.
  if (out.kinds.length < 2) throw new Error(`traffic on only one kind of way: ${out.kinds}`);
  console.log(`        ${out.movers} vehicles, kinds ${out.kinds.join(',')}`);
});

await step('the minimap is track-up and comes round to the nose', async () => {
  const out = await page.evaluate(() => {
    const g = window.WINDWARD.game;
    const V = g.glider.position.constructor;
    g.startFlight();
    const seen = [];
    for (const hdg of [40, 215]) {
      const p = g.glider.position;
      g.glider.reset(new V(p.x, p.y, p.z), hdg, 44);
      // Two seconds of sim is eight e-folds of the map's turn filter, so what
      // is left is where it settles rather than how it got there.
      for (let i = 0; i < 2 * 120; i++) g.update(1 / 120);
      const want = -g.glider.headingDeg;
      const got = (g.minimap._rot * 180) / Math.PI;
      seen.push({ hdg, off: ((((got - want) % 360) + 540) % 360) - 180 });
    }
    return seen;
  });
  for (const { hdg, off } of out) {
    // The map is turned by minus the heading; anything else and the nose is not
    // up the screen. A degree or two of filter lag is the design.
    if (Math.abs(off) > 4) throw new Error(`on ${hdg}deg the map sat ${off.toFixed(1)}deg out`);
  }
  console.log(`        lag ${out.map((o) => `${o.hdg}deg:${o.off.toFixed(1)}`).join(', ')}`);
});

await step('a finished run leaves a ghost, and the next attempt races it', async () => {
  const out = await page.evaluate(async () => {
    const g = window.WINDWARD.game;
    const { findChallenge } = await import('/src/challenges.js');
    const def = g.challenges.defs.find((d) => d.type === 'aerobatic') ?? g.challenges.defs[0];
    g.startChallenge(findChallenge(def.id));
    // Step the sim directly: software rendering manages about a frame a second
    // and this needs a whole run's worth of flight time.
    const real = g.controls.sample.bind(g.controls);
    let t = 0;
    g.controls.sample = () => ((t += 1 / 120), { roll: t % 8 < 3 ? 1 : 0, pitch: 0.1, brake: 0 });
    for (let i = 0; i < 95 * 120 && g.state === 'flying'; i++) g.update(1 / 120);
    g.controls.sample = real;
    const recorded = g.recorder.score.length;
    const stored = (localStorage.getItem('windward.ghosts.v1') || '').length;

    // Go again: the ghost must load, be on screen, and move with the clock.
    g.resumeFree();
    g.startChallenge(findChallenge(def.id));
    const loaded = !!g.ghost.track;
    const a = g.ghost.mesh.position.clone();
    for (let i = 0; i < 6 * 120; i++) g.update(1 / 120);
    return { id: def.id, recorded, stored, loaded, visible: g.ghost.mesh.visible, moved: g.ghost.mesh.position.distanceTo(a) };
  });
  if (out.recorded < 50) throw new Error(`only ${out.recorded} samples recorded`);
  if (!out.stored) throw new Error('nothing was written to the ghost book');
  if (!out.loaded) throw new Error('the ghost did not load on the second attempt');
  if (!out.visible) throw new Error('the ghost is not on screen');
  if (!(out.moved > 20)) throw new Error(`the ghost moved ${out.moved.toFixed(0)} m in six seconds`);
  await page.evaluate(() => window.WINDWARD.game.toMenu());
  await page.waitForSelector('.menu.open', { timeout: 5000 });
});

await step('picking the other level and pressing Fly puts you over it', async () => {
  const other = map === 'jungfrau' ? 'chicago' : 'jungfrau';
  await page.waitForSelector('.menu.open', { timeout: 5000 });
  await page.click(`.level-tab[data-value="${other}"]`);
  await page.click('[data-action="fly"]');
  // Crossing is a real reload of four megabytes of terrain, on a software
  // renderer, so this is the slowest step in the file.
  await page.waitForFunction((m) => location.search.includes(`map=${m}`), other, { timeout: 20000 });
  await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 180000 });
  await page.waitForSelector('.flight.open', { timeout: 30000 });
  const s = await page.evaluate(() => window.WINDWARD.stats());
  if (s.phase !== 'flying') throw new Error(`arrived in phase ${s.phase}`);
  // The launch instruction is spent. Left on the address bar it would relaunch
  // on every reload from the menu.
  await page.click('[data-action="pause"]');
  await page.click('[data-action="menu"]');
  await page.waitForSelector('.menu.open', { timeout: 5000 });
  if (page.url().includes('start=')) throw new Error(`start flag survived: ${page.url()}`);
});

const stats = await page.evaluate(() => window.WINDWARD.stats());
console.log('  stats', JSON.stringify(stats));

await browser.close();

if (problems.length) {
  console.log('\nFAILURES:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nall good');
