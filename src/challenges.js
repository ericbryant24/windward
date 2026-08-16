import * as THREE from '../vendor/three.module.js';
import { makeLitMaterial } from './materials.js';
import { CHALLENGES, REGIONS } from './regions.js';
import { getAircraft, ISSUED_AIRCRAFT, polar } from './fleet.js';
import { store } from './store.js';

/**
 * The challenge layer: markers standing in the world, the rules for the four
 * task types, and the medals you keep.
 *
 * Challenges are deliberately not a game mode. They are things you fly into
 * while flying, which is the whole point — you finish one over the Loop and the
 * next marker is already two kilometres down the river. A mode would mean a
 * menu, a teleport and a reload between every sixty-second task.
 *
 * Everything scores on one number, and which direction wins is a property of
 * the type rather than of the challenge, so a single medal rule serves all
 * four. See CHALLENGES in regions.js for the content.
 *
 * The medal book at the bottom of this file is deliberately map-blind. One
 * store, keyed by challenge id, read the same way whichever terrain happens to
 * be loaded — which is what lets a level select on the Jungfrau tell you the
 * truth about Chicago, and lets a gold over the Alps unlock a marker on the
 * lakefront.
 */

/** The ring you fly through to start one, in metres — see markerGeometry. */
const MARKER_RADIUS = 52;
/** And how far back out before it will trigger again. */
const REARM_RADIUS = 300;
/** Height of the light column that makes a marker findable from far off. */
const BEACON_HEIGHT = 460;

export const MEDAL_NAMES = ['None', 'Bronze', 'Silver', 'Gold'];

/** Bronze, silver, gold — and the unearned marker colour at index 0. */
const MEDAL_TINTS = [
  { color: [0.05, 0.3, 0.45], emissive: [0.2, 0.8, 1.0] },
  { color: [0.35, 0.19, 0.08], emissive: [1.0, 0.52, 0.22] },
  { color: [0.3, 0.33, 0.36], emissive: [0.82, 0.88, 0.95] },
  { color: [0.4, 0.3, 0.06], emissive: [1.0, 0.81, 0.28] },
];

/**
 * The four kinds of challenge, and what each one is scored on.
 *
 *   slalom     a run of gates threaded through the terrain, against the clock.
 *              The only type where the run ends when you finish it, and the
 *              only one that can be failed by being slow.
 *   height     sixty seconds. How much of it can you turn into altitude?
 *   distance   ninety seconds. How far from here can you be at the end of it?
 *   deck       sixty seconds, a corridor and a ceiling: how much of the window
 *              can you spend down on the deck inside it? The only score in the
 *              game that is a measure of nerve.
 *
 * Three of the four are fixed windows, and that is the shape of the whole set:
 * the clock is the task rather than a deadline attached to one. You cannot fail
 * them except by hitting something — the window closes and whatever you have is
 * the score — which is what makes them worth pressing Retry on.
 *
 * `wins` is which direction is better. A slalom is seconds and lower wins; the
 * other three are quantities and more is better. Everything downstream — the
 * medal rule, the running standing on the HUD, the calibrator's ladder — reads
 * this rather than knowing the types.
 */
export const TYPES = {
  slalom: { wins: 'low', unit: 'time', windowed: false },
  height: { wins: 'high', unit: 'height', windowed: true },
  distance: { wins: 'high', unit: 'distance', windowed: true },
  deck: { wins: 'high', unit: 'time', windowed: true },
};

/** Which medal a result earns. Thresholds are [bronze, silver, gold]. */
export function medalFor(def, value) {
  const [bronze, silver, gold] = def.medals;
  if (TYPES[def.type].wins === 'high') {
    if (value >= gold) return 3;
    if (value >= silver) return 2;
    if (value >= bronze) return 1;
    return 0;
  }
  if (value <= gold) return 3;
  if (value <= silver) return 2;
  if (value <= bronze) return 1;
  return 0;
}

/** What the number on a result card means. */
export function challengeMetric(def) {
  return TYPES[def.type].unit;
}

/** The clock a run gets: the window for the windowed types, the limit for a slalom. */
export function runClock(def) {
  return TYPES[def.type].windowed ? def.window : def.limit;
}

/**
 * A slalom is over in ninety seconds and reads best in seconds; a circuit takes
 * nine minutes, and "548.3 s" is a number nobody can picture.
 */
export function formatClock(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—';
  if (seconds < 100) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function formatMetric(def, value) {
  if (value == null || !isFinite(value)) return '—';
  switch (challengeMetric(def)) {
    case 'height':
      return `${Math.round(value)} m`;
    case 'distance':
      return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;
    default:
      return formatClock(value);
  }
}

// ------------------------------------------------------- the medal book ---
/**
 * One store for the whole game. It was per-region, which is most of why two
 * maps read as two games: the same player had two unrelated tallies and no
 * screen that could add them up. Challenge ids are unique across regions, so
 * the region never has to appear in the key at all.
 *
 * The version suffix is what throws the book away when the numbers underneath
 * it stop meaning anything. `.v4` is the challenge set being re-cut to four
 * kinds and a ninety second cap: half the ids are gone, the rest measure a
 * different thing over a different course, and three of the four now score
 * upwards. There is nothing in a v3 book worth carrying forward.
 */
const MEDAL_KEY = 'windward.medals.v4';

export function loadMedals() {
  try {
    const raw = JSON.parse(store.get(MEDAL_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function saveMedals(best) {
  store.set(MEDAL_KEY, JSON.stringify(best));
}

/** Every challenge in the game, grouped by the level it stands in. */
export function levels() {
  return Object.values(REGIONS).map((region) => ({ region, defs: CHALLENGES[region.id] ?? [] }));
}

/** Which region a challenge belongs to, for the level select's cross-map jumps. */
export function regionOfChallenge(id) {
  for (const [regionId, defs] of Object.entries(CHALLENGES)) {
    if (defs.some((d) => d.id === id)) return regionId;
  }
  return null;
}

export function findChallenge(id) {
  for (const defs of Object.values(CHALLENGES)) {
    const def = defs.find((d) => d.id === id);
    if (def) return def;
  }
  return null;
}

/**
 * The aeroplane a challenge is flown in. Never the player's choice — and while
 * the game issues one ship, never the challenge's either: `def.ship` is kept in
 * the table because it says what each task was designed around, but nothing
 * changes aeroplane underneath the player any more.
 */
export function shipFor(def) {
  return getAircraft(ISSUED_AIRCRAFT ?? def.ship);
}

// ----------------------------------------------------------- the corridor ---
/**
 * A deck run's line: the river, or the floor of the valley, as a chain of
 * points with the running distance along it.
 *
 * Everything a deck run needs is one of two questions about this — how far off
 * the line am I, and what is the line doing a few hundred metres ahead — so it
 * is built once per challenge and both answers are a walk along the same array.
 * Plan view only: the corridor is a shape on the map and the ceiling is the
 * other half of the rule.
 */
export function buildCorridor(world, def) {
  const pts = def.deck.path.map(([lat, lon]) => world.toLocal(lat, lon));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { pts, cum, length: cum[cum.length - 1], width: def.deck.width, ceiling: def.deck.ceiling };
}

/** How far off the line, and how far along it, the nearest point is. */
export function onCorridor(line, x, z) {
  let best = Infinity;
  let at = 0;
  for (let i = 1; i < line.pts.length; i++) {
    const a = line.pts[i - 1];
    const b = line.pts[i];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const len2 = vx * vx + vz * vz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / len2)) : 0;
    const dx = x - (a.x + vx * t);
    const dz = z - (a.z + vz * t);
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      at = line.cum[i - 1] + Math.sqrt(len2) * t;
    }
  }
  return { off: Math.sqrt(best), at };
}

/** The point this far along the line, clamped to its ends. */
export function corridorAt(line, s, out = { x: 0, z: 0 }) {
  const d = Math.max(0, Math.min(line.length, s));
  let i = 1;
  while (i < line.cum.length - 1 && line.cum[i] < d) i++;
  const a = line.pts[i - 1];
  const b = line.pts[i];
  const span = line.cum[i] - line.cum[i - 1];
  const t = span > 0 ? (d - line.cum[i - 1]) / span : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** How far ahead a deck run's arrow points, and the calibrator aims. */
export const CORRIDOR_LOOKAHEAD = 620;

/** Every task but a height run drops you in at this multiple of trim speed. */
const START_SPEED = 1.33;

/**
 * How fast you are going when a task arms. Everything is dropped on its marker
 * at the same speed every time, whether it was started from the hoop or from
 * the level select, because otherwise a medal time says as much about the
 * approach as about the run.
 *
 * A height run is the exception, and it has to be. Arriving at a third over trim is
 * free height — the ballasted ship carries 140 m of it in the speed alone — and
 * a task scored on metres gained will happily hand out a gold for converting
 * that back into altitude without ever finding a thermal — and on a sixty
 * second window that free height is most of the answer.
 *
 * Hands-off trim speed is the answer rather than best-sink speed, which was
 * tried first: entering at 28 m/s left the ship slow, low and on a slope, and
 * every measured line flew into the hill before it could get a turn
 * established. Trim leaves about sixty metres of zoom in the tank against a
 * task that asks for four hundred, which is a margin rather than a shortcut.
 */
export function entrySpeed(def, spec = shipFor(def)) {
  if (def?.type === 'height') return spec.trimSpeed;
  return spec.trimSpeed * START_SPEED;
}

/**
 * The one number the whole progression turns on: how many challenges anywhere
 * carry a medal. Golds are the trophy, but medals are the currency — a player
 * who bronzes everything should still see the map open up.
 */
export function tally(best = loadMedals()) {
  let total = 0;
  let medalled = 0;
  let golds = 0;
  for (const { defs } of levels()) {
    for (const def of defs) {
      total++;
      const m = best[def.id] == null ? 0 : medalFor(def, best[def.id]);
      if (m > 0) medalled++;
      if (m === 3) golds++;
    }
  }
  return { total, medalled, golds };
}

/** A locked challenge has no marker in the world and no row to press. */
export function unlocked(def, medalled) {
  return medalled >= (def.needs ?? 0);
}

export class Challenges {
  constructor(world, heightfield, sky, scene, regionId, buildings = null) {
    this.world = world;
    this.hf = heightfield;
    this.buildings = buildings;
    this.defs = CHALLENGES[regionId] ?? [];
    this.best = loadMedals();

    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.materials = MEDAL_TINTS.map((t) =>
      makeLitMaterial(sky, {
        color: new THREE.Color(...t.color),
        emissive: new THREE.Color(...t.emissive),
        emissiveStrength: 2.2,
        roughness: 0.3,
        side: THREE.DoubleSide,
      })
    );
    // The beacons are the same four colours seen from four kilometres away.
    // Emissive is pushed well past the sky's own radiance on purpose: a
    // half-transparent column darker than what is behind it reads as a dark
    // bar against the sky and vanishes entirely against the ground, and it has
    // to work against both.
    this.beaconMaterials = MEDAL_TINTS.map((t) =>
      makeLitMaterial(sky, {
        color: new THREE.Color(...t.color),
        emissive: new THREE.Color(...t.emissive),
        emissiveStrength: 4.5,
        roughness: 0.9,
        opacity: 0.26,
        transparent: true,
        side: THREE.DoubleSide,
      })
    );

    const markerGeom = markerGeometry();
    const beaconGeom = beaconGeometry();
    this.markers = this.defs.map((def) => {
      const v = world.toLocal(def.marker.lat, def.marker.lon);
      const position = new THREE.Vector3(v.x, heightfield.heightAt(v.x, v.z) + def.marker.agl, v.z);
      // The heading in the table is the way the task runs, so the hoop stands
      // across it: what you see is the plane you have to cross to start.
      const hdg = THREE.MathUtils.degToRad(def.marker.heading);
      const normal = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
      const medal = this.medalOf(def);
      const mesh = new THREE.Mesh(markerGeom, this.materials[medal]);
      mesh.position.copy(position);
      mesh.lookAt(position.x + normal.x, position.y, position.z + normal.z);
      this.group.add(mesh);
      const facing = mesh.quaternion.clone();
      // Rooted on the ground and running up past the hoop, rather than hanging
      // off it: what it is for is telling you a task is over there, from a long
      // way off and from below, which is where most of a flight is spent.
      const ground = heightfield.heightAt(v.x, v.z);
      const height = position.y - ground + 90;
      const beacon = new THREE.Mesh(beaconGeom, this.beaconMaterials[medal]);
      beacon.position.set(v.x, ground + height * 0.5, v.z);
      beacon.scale.setY(height / BEACON_HEIGHT);
      beacon.renderOrder = 20;
      this.group.add(beacon);
      // A deck run's corridor is fixed geometry, so it is built with the marker
      // rather than when the task arms: the minimap and the HUD arrow both want
      // it, and the calibrator wants it without flying anything.
      const line = def.type === 'deck' ? buildCorridor(world, def) : null;
      // `ground` is where the light column stands. The label layer wants it: a
      // hoop four hundred metres up projects off the top of the screen while
      // its column is still filling the middle of it, and a column nobody has
      // put a name on is the thing players ask about.
      return { def, position, ground, normal, radius: MARKER_RADIUS, mesh, beacon, facing, line, locked: false };
    });
    this.refreshUnlocks();

    this.active = null;
    this.lastDef = null;
    this.events = [];
    this.spin = 0;
  }

  // ------------------------------------------------------------ medals ---
  medalOf(def) {
    const v = this.best[def.id];
    return v == null ? 0 : medalFor(def, v);
  }

  /**
   * Hide the markers of challenges that have not been earned yet, and report
   * the ones that just appeared. A hoop you are not allowed to fly through is
   * litter; a hoop that was not there last flight is a reason to go and look.
   */
  refreshUnlocks() {
    const { medalled } = tally(this.best);
    const opened = [];
    for (const m of this.markers) {
      const open = unlocked(m.def, medalled);
      if (open && m.mesh.visible === false) opened.push(m.def);
      m.mesh.visible = open;
      m.beacon.visible = open;
    }
    return opened;
  }

  #record(def, value) {
    const prev = this.best[def.id];
    if (prev != null && prev <= value) return false;
    this.best[def.id] = value;
    saveMedals(this.best);
    const marker = this.markers.find((m) => m.def === def);
    if (marker) {
      const medal = this.medalOf(def);
      marker.mesh.material = this.materials[medal];
      marker.beacon.material = this.beaconMaterials[medal];
    }
    return true;
  }

  // ------------------------------------------------------------- state ---
  setVisible(show) {
    this.group.visible = show;
  }

  /** Where a retry drops you: back at the marker, lined up on the task. */
  spawnFor(def) {
    const marker = this.markers.find((m) => m.def === def);
    return { position: marker.position.clone(), heading: def.marker.heading };
  }

  arm(def) {
    this.abort();
    this.lastDef = def;
    const run = { def, elapsed: 0, limit: runClock(def), value: 0 };
    this.active = run;
    // Held down until you fly clear, so finishing inside the hoop — which a
    // retry always does — does not instantly re-arm it.
    const marker = this.markers.find((m) => m.def === def);
    marker.locked = true;

    if (def.type === 'slalom') {
      this.world.setCourse(def.gates, def.id);
      this.world.resetGates();
      this.world.group.visible = true;
      run.gateIndex = 0;
    } else if (def.type === 'height') {
      // Measured from the marker rather than from wherever the ship crossed it,
      // so the task is the same height whether you arrive high, arrive low, or
      // take the Retry button.
      run.startY = marker.position.y;
    } else if (def.type === 'distance') {
      run.from = marker.position.clone();
    } else if (def.type === 'deck') {
      run.line = marker.line;
      run.on = false;
      run.flip = 0;
      run.off = 0;
      run.at = 0;
      run.agl = 0;
    }
    return run;
  }

  /** Put the world back the way plain flying expects it. */
  abort() {
    this.active = null;
    this.world.clearCourse();
  }

  /**
   * Abort, and give up the run as well. A lost or finished task stays retryable
   * — that is what lastDef is for — right up until the player says they are
   * done with it by flying on, so only that says so.
   */
  forget() {
    this.abort();
    this.lastDef = null;
  }

  /**
   * Called when the ship stops flying. A challenge whose clock keeps running
   * after a crash is worse than no challenge at all.
   */
  crashed() {
    const run = this.active;
    if (!run) return null;
    this.abort();
    return { kind: 'failed', def: run.def, reason: 'crash' };
  }

  // -------------------------------------------------------------- loop ---
  update(dt, position, prevPos, agl) {
    this.events.length = 0;
    this.spin += dt * 0.6;
    // About the hoop's own axis, so the ring stays across the course and only
    // the gem inside it turns.
    for (const m of this.markers) {
      if (!m.mesh.visible) continue;
      m.mesh.quaternion.copy(m.facing);
      m.mesh.rotateZ(this.spin);
    }
    for (const m of this.materials) m.uniforms.uPulse.value += dt * 2.6;
    for (const m of this.beaconMaterials) m.uniforms.uPulse.value += dt * 2.6;

    if (this.active) this.#step(dt, position, prevPos, agl);
    else this.#checkMarkers(position, prevPos);
    return this.events;
  }

  /**
   * You start a task by flying through its hoop, not by drifting past it. A
   * proximity sphere would arm on the ferry glide to somewhere else, and there
   * would be no way to say no; the same swept-disc test the race gates use
   * makes it a thing you did on purpose.
   */
  #checkMarkers(position, prevPos) {
    for (const m of this.markers) {
      if (!m.mesh.visible) continue;
      if (m.locked) {
        if (m.position.distanceToSquared(position) > REARM_RADIUS * REARM_RADIUS) m.locked = false;
        continue;
      }
      if (!this.world.crossedGate(m, prevPos, position)) continue;
      this.arm(m.def);
      this.events.push({ kind: 'armed', def: m.def });
      return;
    }
  }

  #step(dt, position, prevPos, agl) {
    const run = this.active;
    const def = run.def;
    run.elapsed += dt;

    if (def.type === 'slalom') {
      const gate = this.world.gates[run.gateIndex];
      const hit = gate && this.world.crossedGate(gate, prevPos, position);
      if (hit) {
        this.world.markGatePassed(gate);
        run.gateIndex++;
        if (run.gateIndex >= this.world.gates.length) return this.#finish(run.elapsed);
        this.events.push({
          kind: 'note',
          def,
          text: `Gate ${run.gateIndex}/${this.world.gates.length}`,
          cue: 'gate',
        });
      }
      // A slalom is the one type with a deadline, because it is the one type
      // that can be left unfinished.
      if (run.elapsed >= run.limit) {
        this.abort();
        this.events.push({ kind: 'failed', def, reason: 'time' });
      }
      return;
    }

    // ---- the windowed three ------------------------------------------------
    if (def.type === 'height') {
      run.value = position.y - run.startY;
    } else if (def.type === 'distance') {
      run.value = Math.hypot(position.x - run.from.x, position.z - run.from.z);
    } else if (def.type === 'deck') {
      // Two conditions, and the clock only runs while both hold: under the
      // ceiling, and over the line. Neither alone is the task — a hundred
      // metres up the river is a sightseeing flight, and thirty metres over
      // the railyard is a field.
      const { off, at } = onCorridor(run.line, position.x, position.z);
      run.off = off;
      run.at = at;
      run.agl = agl;
      const on = agl <= run.line.ceiling && off <= run.line.width;
      // The bank is what you keep. Coming off the deck does not cost you the
      // seconds already flown — that would make one bump the end of the run,
      // and the whole point of a window is that there is always a score.
      if (on) run.value += dt;
      // The state the HUD shows lags the raw test by a third of a second, so a
      // wing bobbing across the ceiling does not strobe the band or fire the
      // cue thirty times. The SCORE is not debounced — every frame under the
      // line counts, which is the honest way to measure it.
      if (on === run.on) run.flip = 0;
      else if ((run.flip += dt) >= 0.35) {
        run.on = on;
        run.flip = 0;
        this.events.push({ kind: 'note', def, text: on ? 'On the deck' : 'Off the deck', cue: on ? 'gate' : undefined });
      }
    }
    // The window closing is the end of the task, not a failure: whatever is on
    // the counter is the score, and there is always a score.
    if (run.elapsed >= run.limit) return this.#finish(run.value);
  }

  #finish(value) {
    const def = this.active.def;
    this.abort();
    const improved = this.#record(def, value);
    this.events.push({
      kind: 'done',
      def,
      value,
      medal: medalFor(def, value),
      best: this.best[def.id],
      improved,
      // A first medal can put new hoops in the sky, and the moment to say so is
      // the results card that earned them.
      opened: this.refreshUnlocks(),
    });
  }

  // ---------------------------------------------------------------- HUD ---
  /** The arrow target: the next thing to fly at, or the marker you are near. */
  objective(position) {
    const run = this.active;
    if (run) {
      if (run.def.type === 'slalom') {
        const gate = this.world.gates[run.gateIndex];
        if (gate) return { name: `Gate ${run.gateIndex + 1} · ${gate.name}`, position: gate.position };
      }
      // A deck corridor has nothing standing in it to aim at, and it is the one
      // task where not knowing where the line goes next is the whole failure.
      // So the arrow gets a point on it, six hundred metres on — far enough to
      // be a direction rather than a twitch, near enough to show the bend.
      if (run.def.type === 'deck') {
        const p = corridorAt(run.line, run.at + CORRIDOR_LOOKAHEAD, this._ahead ??= {});
        const at = (this._aheadPos ??= new THREE.Vector3());
        at.set(p.x, this.hf.heightAt(p.x, p.z) + run.line.ceiling * 0.6, p.z);
        return { name: run.def.name, position: at };
      }
      return null;
    }
    // Not running one: point at a nearby task still worth flying, so leaving
    // one leads into the next. Never at a challenge already golded — the arrow
    // is for unfinished business. Flagged as a hint because the caller weighs
    // it against the lift, which on a flat map matters more than any task.
    let near = null;
    let nearD = 2600 * 2600;
    for (const m of this.markers) {
      if (!m.mesh.visible || this.medalOf(m.def) === 3) continue;
      const d = m.position.distanceToSquared(position);
      if (d < nearD) {
        nearD = d;
        near = m;
      }
    }
    return near ? { name: near.def.name, position: near.position, hint: true } : null;
  }

  /** Name, progress and clock for the in-flight challenge band. */
  hudState() {
    const run = this.active;
    if (!run) return null;
    const def = run.def;
    let progress = '';
    let flag = null;
    if (def.type === 'slalom') progress = `Gate ${run.gateIndex}/${def.gates.length}`;
    else if (def.type === 'height') progress = `${run.value > 0 ? '+' : ''}${Math.round(run.value)} m`;
    else if (def.type === 'distance') progress = `${(run.value / 1000).toFixed(2)} km`;
    else {
      // Why the clock is or is not running, in three words, because there are
      // exactly two ways to be off the deck and they want opposite
      // corrections. An invisible corridor with no readout is a rule nobody
      // can learn. It is the whole of the progress line rather than sitting
      // beside a count of seconds: a deck run's SCORE is seconds, so a band
      // reading "12.4 s" next to a clock reading "26.6 s" is two numbers in
      // the same units meaning different things.
      progress = run.on ? 'on the deck' : run.off > run.line.width ? 'off the line' : 'too high';
      flag = progress;
    }
    // What the run is on for as it stands. A slalom's is its clock, because
    // that is what it will be scored on; the windowed three are already
    // carrying their own score in `progress`, so the standing is that.
    const scored = def.type === 'slalom' ? run.elapsed : run.value;
    return {
      name: def.name,
      progress,
      flag,
      // The big tinted figure. Time into the run for everything else, because
      // that is the number those tasks are read against — and for a deck run
      // the seconds actually banked, because those are the score and the
      // elapsed clock is already on screen counting down beside it.
      clock: def.type === 'deck' ? run.value : run.elapsed,
      standing: medalFor(def, scored),
      remaining: Math.max(0, run.limit - run.elapsed),
    };
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of [...this.materials, ...this.beaconMaterials]) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }
}

/** A hoop standing across the course, with a gem turning inside it. */
function markerGeometry() {
  return mergeParts([new THREE.TorusGeometry(MARKER_RADIUS, 3, 5, 22), new THREE.OctahedronGeometry(20, 0)]);
}

/**
 * The light column under a marker. Open-ended and tapered so it reads as a
 * shaft rather than a post, and thin enough that flying through one is not a
 * thing that can happen by accident.
 */
function beaconGeometry() {
  return new THREE.CylinderGeometry(3, 11, BEACON_HEIGHT, 5, 1, true);
}

/** Concatenate small parts so a marker costs one draw call, not several. */
function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let at = 0;
  for (const g of flat) {
    pos.set(g.getAttribute('position').array, at * 3);
    nrm.set(g.getAttribute('normal').array, at * 3);
    at += g.getAttribute('position').count;
  }
  for (const g of new Set([...parts, ...flat])) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
