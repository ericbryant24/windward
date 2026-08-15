import * as THREE from '../vendor/three.module.js';
import { makeLitMaterial } from './materials.js';
import { CHALLENGES } from './regions.js';
import { store } from './store.js';

/**
 * The challenge layer: markers standing in the world, the rules for the four
 * task types, and the medals you keep.
 *
 * Challenges are deliberately not a game mode. They are things you fly into
 * while free flying, which is the whole point — you finish one over the Loop
 * and the next marker is already two kilometres down the river. A mode would
 * mean a menu, a teleport and a reload between every sixty-second task.
 *
 * Everything scores on one number and lower always wins, so a single medal
 * rule serves all four types. See CHALLENGES in regions.js for the content.
 */

/** The ring you fly through to start one, in metres — see markerGeometry. */
const MARKER_RADIUS = 52;
/** And how far back out before it will trigger again. */
const REARM_RADIUS = 300;
const PICKUP_RADIUS = 34;

export const MEDAL_NAMES = ['None', 'Bronze', 'Silver', 'Gold'];

/** Bronze, silver, gold — and the unearned marker colour at index 0. */
const MEDAL_TINTS = [
  { color: [0.05, 0.3, 0.45], emissive: [0.2, 0.8, 1.0] },
  { color: [0.35, 0.19, 0.08], emissive: [1.0, 0.52, 0.22] },
  { color: [0.3, 0.33, 0.36], emissive: [0.82, 0.88, 0.95] },
  { color: [0.4, 0.3, 0.06], emissive: [1.0, 0.81, 0.28] },
];

/** Which medal a result earns. Thresholds are [bronze, silver, gold]. */
export function medalFor(def, value) {
  const [bronze, silver, gold] = def.medals;
  if (value <= gold) return 3;
  if (value <= silver) return 2;
  if (value <= bronze) return 1;
  return 0;
}

/** Seconds for the timed types, metres of mean height for a low pass. */
export function challengeMetric(def) {
  return def.type === 'lowpass' ? 'height' : 'time';
}

export function formatMetric(def, value) {
  if (value == null || !isFinite(value)) return '—';
  return challengeMetric(def) === 'height' ? `${Math.round(value)} m` : `${value.toFixed(1)} s`;
}

export class Challenges {
  constructor(world, heightfield, sky, scene, regionId, buildings = null) {
    this.world = world;
    this.hf = heightfield;
    this.buildings = buildings;
    this.defs = CHALLENGES[regionId] ?? [];
    this.storeKey = `windward.medals.${regionId}`;
    this.best = loadBest(this.storeKey);

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

    const markerGeom = markerGeometry();
    this.markers = this.defs.map((def) => {
      const v = world.toLocal(def.marker.lat, def.marker.lon);
      const position = new THREE.Vector3(v.x, heightfield.heightAt(v.x, v.z) + def.marker.agl, v.z);
      // The heading in the table is the way the task runs, so the hoop stands
      // across it: what you see is the plane you have to cross to start.
      const hdg = THREE.MathUtils.degToRad(def.marker.heading);
      const normal = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
      const mesh = new THREE.Mesh(markerGeom, this.materials[this.medalOf(def)]);
      mesh.position.copy(position);
      mesh.lookAt(position.x + normal.x, position.y, position.z + normal.z);
      this.group.add(mesh);
      const facing = mesh.quaternion.clone();
      return { def, position, normal, radius: MARKER_RADIUS, mesh, facing, locked: false };
    });

    // One shared blob, repositioned per run: only one collect is ever live, and
    // building the meshes on arm would allocate mid-flight. Sized from the data
    // so adding a longer collect cannot quietly overrun the pool.
    const pickGeom = new THREE.IcosahedronGeometry(15, 0);
    const poolSize = Math.max(0, ...this.defs.map((d) => d.picks?.length ?? 0));
    this.pickups = Array.from({ length: poolSize }, () => {
      const mesh = new THREE.Mesh(pickGeom, this.materials[3]);
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    });

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

  /** The menu checklist: every challenge on this map, with what you have won. */
  summary() {
    const rows = this.defs.map((def) => ({
      def,
      medal: this.medalOf(def),
      best: this.best[def.id] ?? null,
    }));
    return {
      rows,
      total: rows.length,
      golds: rows.filter((r) => r.medal === 3).length,
      medalled: rows.filter((r) => r.medal > 0).length,
    };
  }

  #record(def, value) {
    const prev = this.best[def.id];
    if (prev != null && prev <= value) return false;
    this.best[def.id] = value;
    store.set(this.storeKey, JSON.stringify(this.best));
    const marker = this.markers.find((m) => m.def === def);
    if (marker) marker.mesh.material = this.materials[this.medalOf(def)];
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
    const run = { def, elapsed: 0, limit: def.limit };
    this.active = run;
    // Held down until you fly clear, so finishing inside the hoop — which a
    // retry always does — does not instantly re-arm it.
    const marker = this.markers.find((m) => m.def === def);
    marker.locked = true;

    if (def.type === 'slalom') {
      this.world.setCourse(def.gates, false, def.id);
      this.world.resetGates();
      this.world.group.visible = true;
      run.gateIndex = 0;
    } else if (def.type === 'collect') {
      run.taken = def.picks.map(() => false);
      run.points = def.picks.map((p, i) => {
        const v = this.world.toLocal(p.lat, p.lon);
        let y = this.hf.heightAt(v.x, v.z) + p.agl;
        // A pickup sitting inside the twentieth floor of a tower is not a
        // pickup. The roofs are surveyed data; trust them over the table.
        const roof = this.buildings?.topNear(v.x, v.z) ?? -Infinity;
        if (isFinite(roof)) y = Math.max(y, roof + 25);
        const mesh = this.pickups[i];
        mesh.position.set(v.x, y, v.z);
        mesh.visible = true;
        return new THREE.Vector3(v.x, y, v.z);
      });
    } else if (def.type === 'climb') {
      // Measured from the marker rather than from wherever the ship crossed
      // it, so the task is the same height whether you arrive high, arrive low
      // or take the Retry button. Arriving below the hoop starts you negative.
      run.startY = marker.position.y;
      run.gain = 0;
    } else if (def.type === 'lowpass') {
      run.hold = 0;
      run.heightSum = 0;
    }
    return run;
  }

  /** Put the world back the way free flight expects it. */
  abort() {
    this.active = null;
    for (const mesh of this.pickups) mesh.visible = false;
    if (this.world.courseId !== 'circuit') {
      this.world.setCourse(this.world.circuit, true, 'circuit');
      this.world.group.visible = false;
    }
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
      m.mesh.quaternion.copy(m.facing);
      m.mesh.rotateZ(this.spin);
    }
    for (const m of this.materials) m.uniforms.uPulse.value += dt * 2.6;

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
    } else if (def.type === 'collect') {
      for (let i = 0; i < run.points.length; i++) {
        if (run.taken[i]) continue;
        if (run.points[i].distanceToSquared(position) > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        run.taken[i] = true;
        this.pickups[i].visible = false;
        const got = run.taken.filter(Boolean).length;
        if (got >= run.points.length) return this.#finish(run.elapsed);
        this.events.push({ kind: 'note', def, text: `${got}/${run.points.length}`, cue: 'gate' });
      }
    } else if (def.type === 'climb') {
      run.gain = position.y - run.startY;
      if (run.gain >= def.gain) return this.#finish(run.elapsed);
    } else if (def.type === 'lowpass') {
      if (agl <= def.ceiling) {
        run.hold += dt;
        run.heightSum += Math.max(0, agl) * dt;
        if (run.hold >= def.hold) return this.#finish(run.heightSum / run.hold);
      } else if (run.hold > 0) {
        // Only worth saying out loud if there was a run to lose.
        if (run.hold > 3) this.events.push({ kind: 'note', def, text: 'Too high — hold reset', tone: 'bad' });
        run.hold = 0;
        run.heightSum = 0;
      }
    }

    if (run.elapsed >= run.limit) {
      this.abort();
      this.events.push({ kind: 'failed', def, reason: 'time' });
    }
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
      if (run.def.type === 'collect') {
        let best = null;
        let bestD = Infinity;
        for (let i = 0; i < run.points.length; i++) {
          if (run.taken[i]) continue;
          const d = run.points[i].distanceToSquared(position);
          if (d < bestD) {
            bestD = d;
            best = run.points[i];
          }
        }
        if (best) return { name: run.def.name, position: best };
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
      if (this.medalOf(m.def) === 3) continue;
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
    if (def.type === 'slalom') progress = `Gate ${run.gateIndex}/${def.gates.length}`;
    else if (def.type === 'collect') progress = `${run.taken.filter(Boolean).length}/${def.picks.length}`;
    else if (def.type === 'climb') progress = `${Math.max(0, Math.round(run.gain))}/${def.gain} m`;
    else progress = `${run.hold.toFixed(1)}/${def.hold} s`;
    return { name: def.name, progress, remaining: Math.max(0, run.limit - run.elapsed) };
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of this.materials) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }
}

/** A hoop standing across the course, with a gem turning inside it. */
function markerGeometry() {
  return mergeParts([new THREE.TorusGeometry(MARKER_RADIUS, 3, 5, 22), new THREE.OctahedronGeometry(20, 0)]);
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

function loadBest(key) {
  try {
    const raw = JSON.parse(store.get(key) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}
