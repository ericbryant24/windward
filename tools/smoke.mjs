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
  // Watch the roll axis for the duration of the hold rather than reading the
  // bank at the end of it. On a rate stick three seconds of full deflection is
  // three and a half rolls, and where that leaves the wings is arbitrary — it
  // landed on 2.9 degrees once, which looked exactly like an aeroplane that
  // had ignored the stick. What is actually being asked is whether the roll
  // axis moved, and that is the same question for either control law.
  await page.evaluate(() => {
    const gl = window.WINDWARD.game.glider;
    window.__swept = 0;
    let prev = gl.bankRad;
    const orig = gl.update.bind(gl);
    gl.update = (dt, input) => {
      orig(dt, input);
      let d = gl.bankRad - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      window.__swept += Math.abs(d);
      prev = gl.bankRad;
    };
    window.__unwatch = () => (gl.update = orig);
  });
  // The right half: that is where the stick lives now, so that the trigger and
  // the throttle can sit under the other thumb.
  await page.mouse.move(box.w * 0.75, box.h * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.w * 0.75 + 70, box.h * 0.75, { steps: 5 });
  await page.waitForTimeout(2500);
  await page.mouse.up();
  const swept = await page.evaluate(() => {
    const s = (window.__swept * 180) / Math.PI;
    window.__unwatch?.();
    return s;
  });
  const after = await page.evaluate(() => window.WINDWARD.stats());
  console.log(
    `        alt ${before.alt}->${after.alt} m, speed ${after.speed} km/h, ${swept.toFixed(0)}deg of roll swept`
  );
  if (swept < 25) throw new Error(`right stick swept only ${swept.toFixed(1)}deg of roll`);
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
  // The level select opens onto the briefing, not onto the run. Pressing Start
  // is the click under test as much as pressing the row was.
  await page.waitForSelector('[data-action="brief-start"]', { timeout: 3000 });
  await page.click('[data-action="brief-start"]');
  await page.waitForFunction(() => window.WINDWARD.stats().phase === 'flying', { timeout: 3000 });
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
    // Entering a challenge stands a briefing card in front of it; pressing
    // Start is part of entering one now.
    g.beginBriefed();
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

await step('every challenge is one of the five kinds, with a ladder that climbs', async () => {
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

await step('a challenge briefs first, holds everything still, and starts on the button', async () => {
  const out = await page.evaluate(async () => {
    const g = window.WINDWARD.game;
    const def = g.challenges.defs.find((d) => d.type === 'deck') ?? g.challenges.defs[0];
    g.startChallenge(def);
    const card = document.querySelector('.results.open');
    const brief = {
      state: g.state,
      shown: !!card,
      title: card?.querySelector('h2')?.textContent,
      // The rule has to be on the card in the task's own numbers, not in the
      // abstract: a briefing that says "fly it well" is not a briefing.
      note: card?.querySelector('.results-note')?.textContent ?? '',
      rungs: card?.querySelectorAll('.rung').length ?? 0,
      start: !!card?.querySelector('[data-action="brief-start"]'),
    };
    // Nothing moves while the card is up, and the clock does not start.
    const before = g.glider.position.clone();
    for (let i = 0; i < 240; i++) g.update(1 / 120);
    const drifted = g.glider.position.distanceTo(before);
    const clock = g.challenges.active?.elapsed ?? 0;

    g.beginBriefed();
    const flying = { after: g.state, gone: !document.querySelector('.results.open'), armed: g.challenges.active?.def === def };
    for (let i = 0; i < 120; i++) g.update(1 / 120);
    const ran = g.challenges.active?.elapsed ?? 0;
    // Going again must not brief. You read it thirty seconds ago, and a card
    // between attempts would be the most tiresome thing in the game.
    g.retryChallenge();
    const retry = { retryState: g.state, retryCard: !!document.querySelector('.results.open') };
    g.resumeFree();
    return { id: def.id, name: def.name, ...brief, drifted, clock, ...flying, ran, ...retry };
  });
  if (!out.shown) throw new Error('no briefing card appeared');
  if (out.state !== 'briefing') throw new Error(`entering a challenge left the game in "${out.state}"`);
  if (out.title !== out.name) throw new Error(`the card is headed "${out.title}", not "${out.name}"`);
  if (out.rungs !== 3) throw new Error(`${out.rungs} medal rungs on the card, not 3`);
  if (!out.start) throw new Error('the card has no Start button');
  if (!/\d/.test(out.note)) throw new Error(`the rule quotes no numbers: "${out.note}"`);
  if (out.drifted > 0.01) throw new Error(`the ship moved ${out.drifted.toFixed(2)} m during the briefing`);
  if (out.clock > 0.01) throw new Error(`the clock ran ${out.clock.toFixed(2)} s during the briefing`);
  if (out.gone !== true) throw new Error('the card stayed up after Start');
  if (out.after !== 'flying' || !out.armed) throw new Error(`Start left the game in "${out.after}", armed: ${out.armed}`);
  if (!(out.ran > 0.9)) throw new Error(`the clock ran ${out.ran.toFixed(2)} s in the first second after Start`);
  if (out.retryCard) throw new Error('Retry briefed again instead of going straight round');
  if (out.retryState !== 'flying') throw new Error(`Retry left the game in "${out.retryState}"`);
  console.log(`        ${out.id}: card up, ship still, ${out.ran.toFixed(1)} s on the clock a second after Start`);
});

await step("a deck run's clock runs under the ceiling, on the line, and nowhere else", async () => {
  const out = await page.evaluate(async () => {
    const { corridorAt } = await import('/src/challenges.js');
    const g = window.WINDWARD.game;
    g.startFlight();
    const def = g.challenges.defs.find((d) => d.type === 'deck');
    const run = g.challenges.arm(def);
    const line = run.line;
    const V = g.glider.position.constructor;
    // Scored straight through Challenges with made-up positions rather than by
    // flying: what is under test is the rule, and a flown ship cannot be put
    // three corridor widths sideways without hitting the wall that is there.
    const hold = (x, z, agl) => {
      const before = run.value;
      const p = new V(x, g.hf.heightAt(x, z) + agl, z);
      for (let i = 0; i < 60; i++) g.challenges.update(1 / 60, p, p, agl);
      return run.value - before;
    };
    const on = corridorAt(line, line.length * 0.4, {});
    const next = corridorAt(line, line.length * 0.4 + 120, {});
    const dx = next.x - on.x;
    const dz = next.z - on.z;
    const len = Math.hypot(dx, dz) || 1;
    const wide = { x: on.x - (dz / len) * line.width * 3, z: on.z + (dx / len) * line.width * 3 };
    const banked = {
      low: hold(on.x, on.z, line.ceiling * 0.5),
      high: hold(on.x, on.z, line.ceiling * 3),
      off: hold(wide.x, wide.z, line.ceiling * 0.5),
    };
    g.challenges.abort();
    return { ...banked, id: def.id, ceiling: line.ceiling, width: line.width };
  });
  if (Math.abs(out.low - 1) > 0.05) throw new Error(`a second under the ceiling banked ${out.low.toFixed(2)} s`);
  if (out.high > 0.01) throw new Error(`${out.ceiling * 3} m up still banked ${out.high.toFixed(2)} s`);
  if (out.off > 0.01) throw new Error(`${out.width * 3} m off the line still banked ${out.off.toFixed(2)} s`);
  console.log(`        ${out.id}: under ${out.ceiling} m within ${out.width} m counts, nothing else does`);
});

await step('a balloon shot down scores, and the magazine runs down', async () => {
  const out = await page.evaluate(async () => {
    const g = window.WINDWARD.game;
    const def = g.challenges.defs.find((d) => d.type === 'gunnery');
    if (!def) return { skip: true };
    g.startChallenge(def);
    g.beginBriefed();
    const run = g.challenges.active;
    const V = g.glider.position.constructor;
    // Line up three hundred metres behind a balloon, level, pointing at it.
    const t = run.field.targets[0];
    const back = 320;
    const hdg = 40;
    const rad = (hdg * Math.PI) / 180;
    const p = new V(t.position.x - Math.sin(rad) * back, t.position.y, t.position.z + Math.cos(rad) * back);
    g.glider.reset(p, hdg, g.spec.trimSpeed);
    const ammo0 = g.guns.rounds;
    const real = g.controls.sample.bind(g.controls);
    g.controls.sample = () => ({ roll: 0, pitch: 0, brake: 0, throttle: 0.4, fire: true });
    for (let i = 0; i < 2.2 * 120 && g.challenges.active; i++) g.update(1 / 120);
    g.controls.sample = real;
    const popped = run.field.targets.filter((x) => !x.alive).length;
    return { id: def.id, popped, score: run.value, spent: ammo0 - g.guns.rounds, balloons: run.field.targets.length };
  });
  if (out.skip) throw new Error('no gunnery challenge on this map');
  if (!(out.spent > 20)) throw new Error(`only ${out.spent} rounds went off in two seconds`);
  if (!out.popped) throw new Error(`${out.spent} rounds at a balloon three hundred metres ahead and it is still up`);
  if (out.score !== out.popped) throw new Error(`${out.popped} popped but the run scored ${out.score}`);
  console.log(`        ${out.id}: ${out.popped} of ${out.balloons} down for ${out.spent} rounds`);
});

await step('it lands on its wheels, rolls out, and takes off again', async () => {
  const out = await page.evaluate(async (map) => {
    const g = window.WINDWARD.game;
    const V = g.glider.position.constructor;
    // Flat, building-free ground on each map, checked with the same heightfield
    // the game flies over. Placed on short final rather than flown there: what
    // is under test is the contact rule and the roll, not an autopilot.
    // Chicago is a city and has almost no clear dry run in it; this is
    // Northerly Island, which is where Meigs Field was, and about the only
    // strip on that map with no buildings along it.
    const [lat, lon, hdg] = map === 'chicago' ? [41.8555, -87.6085, 0] : [46.677, 7.855, 60];
    const real = g.controls.sample.bind(g.controls);
    const site = () => {
      const v = g.world.toLocal(lat, lon);
      return { v, gr: g.hf.heightAt(v.x, v.z) };
    };
    const flare = (kmh, sink) => {
      g.startFlight();
      const { v, gr } = site();
      g.glider.reset(new V(v.x, gr + 4.4, v.z), hdg, kmh / 3.6);
      g.glider.velocity.y = sink;
      g.controls.sample = () => ({ roll: 0, pitch: 0, brake: 0, throttle: 0.3, fire: false });
      let n = 0;
      while (n < 3 * 120 && g.state === 'flying' && !g.glider.onGround && !g.wreck.active) {
        g.update(1 / 120);
        n++;
      }
      return g.glider.onGround ? 'landed' : g.wreck.active ? 'crash' : 'flying';
    };
    const gentle = flare(160, -2);
    const hard = flare(160, -10);
    if (flare(150, -2) !== 'landed') {
      g.controls.sample = real;
      return { gentle, hard, rolled: 0 };
    }
    // Lever shut: the wheel brakes are the bottom of the throttle.
    const p0 = g.glider.position.clone();
    g.controls.sample = () => ({ roll: 0, pitch: 0, brake: 0, throttle: 0, fire: false });
    let n = 0;
    while (n < 40 * 120 && Math.hypot(g.glider.velocity.x, g.glider.velocity.z) > 0.5) {
      g.update(1 / 120);
      n++;
    }
    const rolled = Math.round(g.glider.position.distanceTo(p0));
    const stopped = g.state;
    // And away again.
    const p1 = g.glider.position.clone();
    g.controls.sample = () => ({ roll: 0, pitch: 1, brake: 0, throttle: 1, fire: false });
    n = 0;
    while (n < 30 * 120 && g.glider.onGround) {
      g.update(1 / 120);
      n++;
    }
    const run = Math.round(g.glider.position.distanceTo(p1));
    for (let i = 0; i < 10 * 120; i++) g.update(1 / 120);
    const agl = Math.round(g.glider.position.y - g.hf.heightAt(g.glider.position.x, g.glider.position.z));
    // Hand the stick back, or every step after this one flies with the pitch
    // pinned and loops its way through whatever it was trying to measure.
    g.controls.sample = real;
    return { gentle, hard, rolled, stopped, run, agl, state: g.state };
  }, map);
  if (out.gentle !== 'landed') throw new Error(`a two metre a second arrival was a ${out.gentle}`);
  if (out.hard !== 'crash') throw new Error(`a ten metre a second arrival was a ${out.hard}`);
  if (!(out.rolled > 40 && out.rolled < 600)) throw new Error(`landing roll ${out.rolled} m`);
  // The whole point: a landing is not the end of the flight any more.
  if (out.stopped !== 'flying') throw new Error(`stopping on the runway ended the flight (${out.stopped})`);
  if (!(out.run > 20 && out.run < 500)) throw new Error(`take-off run ${out.run} m`);
  if (!(out.agl > 80)) throw new Error(`ten seconds after take-off it is only ${out.agl} m up`);
  console.log(`        down in ${out.rolled} m, off again in ${out.run} m, ${out.agl} m up ten seconds later`);
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
      // Well clear of the ground: a step before this one may have left the
      // aeroplane parked on it, and resetting onto the grass puts it back on
      // its wheels, where the heading comes off the wheels and not the stick.
      g.glider.reset(new V(p.x, g.hf.heightAt(p.x, p.z) + 900, p.z), hdg, 44);
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
    // A distance run: ninety seconds at altitude with nothing to hit. What is
    // under test is the recorder and the replay, and a deck run — sixty metres
    // over a gorge floor with a wandering stick — tests the wall.
    const def = g.challenges.defs.find((d) => d.type === 'distance') ?? g.challenges.defs[0];
    g.startChallenge(findChallenge(def.id));
    g.beginBriefed();
    // Step the sim directly: software rendering manages about a frame a second
    // and this needs a whole run's worth of flight time.
    const real = g.controls.sample.bind(g.controls);
    let t = 0;
    // Hold height rather than a fixed stick. The aeroplane used to climb away
    // hands-off at full power and this flew ninety seconds on that alone; now
    // that the trim follows the throttle it cruises instead, and cruising due
    // north out of the Oberland Dash marker meets a mountain.
    g.controls.sample = () => {
      t += 1 / 120;
      return {
        // Straight and level. The wander used to be harmless because the ship
        // climbed away from everything at full power; now that it cruises,
        // ninety seconds of wandering out of the Oberland Dash marker finds a
        // valley wall. What is under test is the recorder, not the terrain.
        roll: Math.sin(t * 0.5) * 0.06,
        pitch: Math.max(-0.4, Math.min(0.7, 0.1 - g.glider.velocity.y * 0.05)),
        brake: 0,
        throttle: 0.7,
      };
    };
    for (let i = 0; i < 95 * 120 && g.state === 'flying'; i++) g.update(1 / 120);
    g.controls.sample = real;
    const recorded = g.recorder.score.length;
    const stored = (localStorage.getItem('windward.ghosts.v1') || '').length;

    // Go again: the ghost must load, be on screen, and move with the clock.
    g.resumeFree();
    g.startChallenge(findChallenge(def.id));
    g.beginBriefed();
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
