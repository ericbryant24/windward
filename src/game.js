import * as THREE from '../vendor/three.module.js';
import { Air, Glider } from './flight.js';
import { createAircraft } from './aircraft.js';
import { World, createThermalClouds } from './world.js';
import { formatTime } from './hud.js';

const CAMERA_MODES = ['chase', 'far', 'cockpit'];
const STORE_KEY = 'windward.progress.v1';

/**
 * Mode rules, scoring, camera and the frame loop. The glider physics live in
 * flight.js; this is everything that turns flying into a game.
 */
export class Game {
  constructor({ renderer, scene, camera, hud, controls, heightfield, sky, terrain, lakes, audio }) {
    this.audio = audio;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.hud = hud;
    this.controls = controls;
    this.hf = heightfield;
    this.sky = sky;
    this.terrain = terrain;
    this.lakes = lakes;

    this.air = new Air(heightfield, sky);
    this.air.seedThermals();
    this.glider = new Glider(this.air);

    this.world = new World(heightfield, sky, scene);
    this.aircraft = createAircraft(sky);
    scene.add(this.aircraft);

    this.clouds = createThermalClouds(this.air, sky);
    scene.add(this.clouds);

    this.state = 'menu';
    this.mode = 'free';
    this.cameraMode = 0;
    this.timer = 0;
    this.score = 0;
    this.streak = 1;
    this.maxAltitude = 0;
    this.gateIndex = 0;
    this.respawnTimer = 0;
    this.lowTime = 0;
    this.progress = loadProgress();

    this._camPos = new THREE.Vector3();
    this._camAim = new THREE.Vector3();
    this._prevPos = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.labels = new LabelLayer(document.getElementById('ui'), this.world.places);

    // Park the ship somewhere sane so nothing sits at the world origin while
    // the menu camera drifts over the peaks.
    const start = this.spawnFor('free');
    this.glider.reset(start.position, start.heading, start.speed);
  }

  // ------------------------------------------------------------- setup ---
  startMode(mode) {
    this.mode = mode;
    this.state = 'flying';
    this.timer = mode === 'climb' ? 300 : 0;
    this.score = 0;
    this.streak = 1;
    this.maxAltitude = 0;
    this.gateIndex = 0;
    this.lowTime = 0;
    this.respawnTimer = 0;
    this.world.resetGates();
    this.world.group.visible = mode === 'circuit';

    const spawn = this.spawnFor(mode);
    this.glider.reset(spawn.position, spawn.heading, spawn.speed);
    this._prevPos.copy(this.glider.position);
    this.#placeCamera(true);

    this.hud.setMode(mode);
    this.hud.showMenu(false);
    this.hud.showFlight(true);
    this.hud.hideResults();
    this.controls.setVisible(true);

    const intro = {
      free: 'Find the lift. Cumulus marks the thermals.',
      circuit: 'Eleven gates. Fly clean, fly low, fly fast.',
      climb: 'Five minutes. Take everything the air will give.',
    }[mode];
    this.hud.toast(intro);
  }

  spawnFor(mode) {
    if (mode === 'circuit') {
      const g0 = this.world.gates[0];
      const back = this._v.copy(g0.normal).multiplyScalar(-950);
      const pos = new THREE.Vector3().copy(g0.position).add(back);
      pos.y = Math.max(pos.y, this.hf.heightAt(pos.x, pos.z) + 220);
      const heading = (THREE.MathUtils.radToDeg(Math.atan2(g0.normal.x, -g0.normal.z)) + 360) % 360;
      return { position: pos, heading, speed: 40 };
    }
    if (mode === 'climb') {
      const p = this.world.places.find((q) => q.name === 'Interlaken');
      return { position: new THREE.Vector3(p.x, 1250, p.z), heading: 150, speed: 34 };
    }
    // Free flight opens at Kleine Scheidegg, nose pointed at the Eiger.
    const ks = this.world.places.find((p) => p.name === 'Kleine Scheidegg');
    const eiger = this.world.places.find((p) => p.name === 'Eiger');
    const heading = (THREE.MathUtils.radToDeg(Math.atan2(eiger.x - ks.x, -(eiger.z - ks.z))) + 360) % 360;
    return { position: new THREE.Vector3(ks.x, ks.y + 780, ks.z), heading, speed: 36 };
  }

  toMenu() {
    this.state = 'menu';
    this.controls.setVisible(false);
    this.hud.showFlight(false);
    this.hud.hideResults();
    this.labels.clear();
    this.hud.showMenu(true, {
      discovered: this.progress.discovered.length,
      total: this.world.places.length,
      best: this.progress.best,
    });
  }

  togglePause() {
    if (this.state === 'flying') {
      this.state = 'paused';
      this.controls.setVisible(false);
      this.hud.showResults('Paused', [['Mode', modeName(this.mode)], ['Score', Math.round(this.score).toLocaleString('en-US')]], [
        { label: 'Resume', action: 'resume', primary: true },
        { label: 'Menu', action: 'menu' },
      ]);
    } else if (this.state === 'paused') {
      this.state = 'flying';
      this.controls.setVisible(true);
      this.hud.hideResults();
    }
  }

  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % CAMERA_MODES.length;
    this.hud.toast(`Camera: ${CAMERA_MODES[this.cameraMode]}`);
  }

  // -------------------------------------------------------------- loop ---
  update(dt) {
    this.air.update(dt);
    this.world.update(dt);

    if (this.state === 'flying') this.#simulate(dt);
    if (this.state !== 'menu') this.#placeCamera(false, dt);

    this.aircraft.position.copy(this.glider.position);
    this.aircraft.quaternion.copy(this.glider.quaternion);
    this.aircraft.visible = this.state !== 'menu' && CAMERA_MODES[this.cameraMode] !== 'cockpit';

    if (this.state !== 'menu') {
      const ground = this.hf.heightAt(this.glider.position.x, this.glider.position.z);
      this.hud.update({
        glider: this.glider,
        ground,
        objective: this.#objective(),
        camera: this.camera,
        mode: this.mode,
        timer: this.timer,
        score: this.score,
        streak: this.streak,
      });
      this.controls.setBoostCharge(this.glider.boost);
      this.audio?.update(dt, {
        airspeed: this.glider.airspeed,
        vario: this.glider.varioSmooth,
        boosting: this.glider.boosting,
        brake: this.glider.brake,
      });
      this.labels.update(this.camera, this.glider.position, this.progress.discovered);
    }
  }

  #simulate(dt) {
    const g = this.glider;
    this._prevPos.copy(g.position);

    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.#respawn();
      return;
    }

    g.update(dt, this.controls.sample());

    // keep the player inside the baked region
    const lim = this.hf.halfSize - 900;
    if (Math.abs(g.position.x) > lim || Math.abs(g.position.z) > lim) {
      const push = this._v.set(-Math.sign(g.position.x) * (Math.abs(g.position.x) > lim ? 1 : 0), 0, -Math.sign(g.position.z) * (Math.abs(g.position.z) > lim ? 1 : 0));
      g.velocity.addScaledVector(push, 26 * dt);
      this.hud.setWarning('TURN BACK');
    } else {
      this.hud.setWarning(g.stalled ? 'STALL' : '');
    }

    const ground = this.hf.heightAt(g.position.x, g.position.z);
    const agl = g.position.y - ground;

    // ---- terrain contact ---------------------------------------------------
    if (agl < 3.5) {
      const slope = this.hf.normalAt(g.position.x, g.position.z, 30, this._v).y;
      const gentle = slope > 0.93;
      const slow = g.airspeed < 26 && Math.abs(g.vario) < 6;
      if (gentle && slow && !this.hf.isWater(g.position.x, g.position.z)) this.#land();
      else this.#crash();
      return;
    }

    // ---- ridge running: reward flying close, but only while quick ----------
    if (agl < 90 && g.airspeed > 24) {
      const closeness = 1 - agl / 90;
      this.streak = Math.min(4, this.streak + closeness * dt * 0.55);
      this.score += closeness * this.streak * 26 * dt;
      this.lowTime = 0;
    } else {
      this.lowTime += dt;
      if (this.lowTime > 1.6) this.streak = Math.max(1, this.streak - dt * 1.4);
    }

    if (g.position.y > this.maxAltitude) this.maxAltitude = g.position.y;

    // ---- discovery ---------------------------------------------------------
    for (const p of this.world.places) {
      if (this.progress.discovered.includes(p.name)) continue;
      const dx = p.x - g.position.x;
      const dz = p.z - g.position.z;
      if (dx * dx + dz * dz < 800 * 800 && Math.abs(g.position.y - p.y) < 900) {
        this.progress.discovered.push(p.name);
        saveProgress(this.progress);
        this.score += 500;
        this.hud.toast(`<b>${p.name}</b> discovered · +500`, 'discovery');
        this.audio?.cue('discovery');
      }
    }

    // ---- mode rules --------------------------------------------------------
    if (this.mode === 'circuit') {
      this.timer += dt;
      this.#checkGates();
    } else if (this.mode === 'climb') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        this.#finishClimb();
      }
    }
  }

  #checkGates() {
    const gate = this.world.gates[this.gateIndex];
    if (!gate) return;
    const hit = this.world.crossedGate(gate, this._prevPos, this.glider.position);
    if (!hit) return;
    this.world.markGatePassed(gate);
    const accuracy = 1 - hit.offset;
    const bonus = Math.round(300 + accuracy * 700);
    this.score += bonus;
    this.gateIndex++;
    this.audio?.cue('gate');
    if (this.gateIndex >= this.world.gates.length) {
      this.#finishCircuit();
    } else {
      const label = accuracy > 0.75 ? 'Clean line!' : 'Gate';
      this.hud.toast(`${label} ${this.gateIndex}/${this.world.gates.length} · +${bonus}`);
    }
  }

  #objective() {
    if (this.mode === 'circuit') {
      const g = this.world.gates[this.gateIndex];
      return g ? { name: `Gate ${this.gateIndex + 1} · ${g.name}`, position: g.position } : null;
    }
    const near = this.air.nearestThermal(this.glider.position.x, this.glider.position.z);
    if (!near) return null;
    const t = near.thermal;
    return { name: 'Nearest lift', position: this._v2.set(t.x, t.ground + 400, t.z) };
  }

  #land() {
    this.state = 'done';
    this.audio?.cue('finish');
    this.controls.setVisible(false);
    const lines = [
      ['Landed at', `${Math.round(this.hf.heightAt(this.glider.position.x, this.glider.position.z))} m`],
      ['Score', Math.round(this.score + 1500).toLocaleString('en-US')],
      ['Highest point', `${Math.round(this.maxAltitude)} m`],
    ];
    this.score += 1500;
    this.#recordBest();
    this.hud.showResults('Safe landing', lines, [
      { label: 'Fly again', action: 'restart', primary: true },
      { label: 'Menu', action: 'menu' },
    ]);
  }

  #crash() {
    this.streak = 1;
    this.score = Math.max(0, this.score - 250);
    this.respawnTimer = 1.4;
    this.glider.velocity.multiplyScalar(0.1);
    this.hud.toast('Terrain! Resetting…', 'bad');
    this.audio?.cue('crash');
    this.hud.setWarning('');
  }

  #respawn() {
    const g = this.glider;
    let base;
    let heading = g.headingDeg;
    if (this.mode === 'circuit' && this.gateIndex > 0) {
      const gate = this.world.gates[this.gateIndex - 1];
      base = this._v.copy(gate.position);
      heading = (THREE.MathUtils.radToDeg(Math.atan2(gate.normal.x, -gate.normal.z)) + 360) % 360;
    } else if (this.mode === 'circuit') {
      const s = this.spawnFor('circuit');
      base = s.position;
      heading = s.heading;
    } else {
      base = this._v.copy(g.position);
      base.y = this.hf.heightAt(base.x, base.z) + 420;
    }
    g.reset(base, heading, 38);
    this._prevPos.copy(g.position);
    this.#placeCamera(true);
  }

  #finishCircuit() {
    this.state = 'done';
    this.audio?.cue('finish');
    this.controls.setVisible(false);
    const timeBonus = Math.max(0, Math.round((420 - this.timer) * 12));
    this.score += timeBonus;
    const best = this.progress.best.circuit;
    const isBest = !best || this.timer < best;
    if (isBest) this.progress.best.circuit = this.timer;
    this.#recordBest();
    this.hud.showResults(isBest ? 'New best circuit!' : 'Circuit complete', [
      ['Time', formatTime(this.timer)],
      ['Best', formatTime(this.progress.best.circuit)],
      ['Time bonus', `+${timeBonus.toLocaleString('en-US')}`],
      ['Score', Math.round(this.score).toLocaleString('en-US')],
    ], [
      { label: 'Race again', action: 'restart', primary: true },
      { label: 'Menu', action: 'menu' },
    ]);
  }

  #finishClimb() {
    this.state = 'done';
    this.audio?.cue('finish');
    this.controls.setVisible(false);
    const best = this.progress.best.altitude;
    const isBest = !best || this.maxAltitude > best;
    if (isBest) this.progress.best.altitude = this.maxAltitude;
    this.score += Math.round(this.maxAltitude);
    this.#recordBest();
    this.hud.showResults(isBest ? 'New altitude record!' : "Time's up", [
      ['Highest point', `${Math.round(this.maxAltitude)} m`],
      ['Best ever', `${Math.round(this.progress.best.altitude)} m`],
      ['Score', Math.round(this.score).toLocaleString('en-US')],
    ], [
      { label: 'Try again', action: 'restart', primary: true },
      { label: 'Menu', action: 'menu' },
    ]);
  }

  #recordBest() {
    this.progress.best.score = Math.max(this.progress.best.score ?? 0, Math.round(this.score));
    saveProgress(this.progress);
  }

  // ------------------------------------------------------------ camera ---
  #placeCamera(snap, dt = 0.016) {
    const g = this.glider;
    const mode = CAMERA_MODES[this.cameraMode];

    if (mode === 'cockpit') {
      const fwd = g.forward(this._v);
      const up = g.up(this._v2);
      this.camera.position.copy(g.position).addScaledVector(fwd, 0.3).addScaledVector(up, 0.42);
      this.camera.quaternion.copy(g.quaternion);
      return;
    }

    const dist = mode === 'far' ? 46 : 24;
    const height = mode === 'far' ? 13 : 6.4;

    // Follow the heading, but let a little of the bank through so hard turns
    // feel like turns rather than the world sliding sideways.
    const fwd = g.forward(this._v).normalize();
    const flat = this._v2.set(fwd.x, fwd.y * 0.55, fwd.z).normalize();
    const desired = this._camPos
      .copy(g.position)
      .addScaledVector(flat, -dist)
      .addScaledVector(g.up(new THREE.Vector3()).lerp(new THREE.Vector3(0, 1, 0), 0.55).normalize(), height);

    // never let the camera end up inside a mountain
    const ground = this.hf.heightAt(desired.x, desired.z) + 6;
    if (desired.y < ground) desired.y = ground;

    if (snap) this.camera.position.copy(desired);
    else {
      const k = 1 - Math.exp(-dt * (6 + g.airspeed * 0.06));
      this.camera.position.lerp(desired, k);
    }

    const aim = this._camAim.copy(g.position).addScaledVector(fwd, 16).addScaledVector(g.velocity, 0.12);
    this.camera.lookAt(aim);

    const target = THREE.MathUtils.clamp(this._baseFov + (g.airspeed - 32) * 0.24 + (g.boosting ? 5 : 0), this._baseFov - 3, this._baseFov + 12);
    this.camera.fov = snap ? target : THREE.MathUtils.damp(this.camera.fov, target, 3, dt);
    this.camera.updateProjectionMatrix();
  }

  setBaseFov(fov) {
    this._baseFov = fov;
    if (this.state === 'menu') {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Slow drift over the peaks behind the main menu. */
  updateMenuCamera(t) {
    const r = 5200;
    const a = t * 0.035;
    const centre = this.world.places.find((p) => p.name === 'Eiger');
    this.camera.position.set(centre.x + Math.cos(a) * r, 3950 + Math.sin(a * 1.7) * 240, centre.z + Math.sin(a) * r);
    this.camera.lookAt(centre.x, centre.y * 0.86, centre.z);
  }

  setLighting(sunRadiance, skyAmbient) {
    this.world.setLighting(sunRadiance, skyAmbient);
    this.clouds.userData.setLighting(sunRadiance, skyAmbient);
    for (const m of this.aircraft.userData.materials) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }

  /** Thermals depend on which slopes the sun is on, so re-seed with the hour. */
  reseedAir() {
    this.air.seedThermals();
    this.scene.remove(this.clouds);
    this.clouds.geometry.dispose();
    this.clouds = createThermalClouds(this.air, this.sky);
    this.scene.add(this.clouds);
  }
}

function modeName(mode) {
  return { free: 'Free Flight', circuit: 'Jungfrau Circuit', climb: 'Height Hunt' }[mode] ?? mode;
}

/** Floating place names, so the region reads as somewhere rather than terrain. */
class LabelLayer {
  constructor(root, places) {
    this.places = places;
    this.el = document.createElement('div');
    this.el.className = 'labels';
    Object.assign(this.el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
    root.appendChild(this.el);
    this.pool = [];
    this._v = new THREE.Vector3();
  }

  clear() {
    for (const el of this.pool) el.style.opacity = '0';
  }

  update(camera, from, discovered) {
    const candidates = [];
    for (const p of this.places) {
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d > 11000 || d < 220) continue;
      this._v.set(p.x, p.y + (p.kind === 'peak' ? 60 : 30), p.z);
      const proj = this._v.clone().project(camera);
      if (proj.z > 1 || Math.abs(proj.x) > 0.85 || Math.abs(proj.y) > 0.8) continue;
      candidates.push({ p, d, proj });
    }
    candidates.sort((a, b) => a.d - b.d);
    const show = candidates.slice(0, 6);

    while (this.pool.length < show.length) {
      const el = document.createElement('div');
      el.className = 'place-label';
      this.el.appendChild(el);
      this.pool.push(el);
    }
    this.pool.forEach((el, i) => {
      const item = show[i];
      if (!item) {
        el.style.opacity = '0';
        return;
      }
      const { p, d, proj } = item;
      const known = discovered.includes(p.name);
      el.innerHTML = `<i></i><span>${p.name}</span>${p.kind === 'peak' ? `<em>${p.height} m</em>` : ''}`;
      el.classList.toggle('unknown', !known);
      el.style.left = `${(proj.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-proj.y * 0.5 + 0.5) * innerHeight}px`;
      el.style.opacity = String(Math.max(0.18, Math.min(0.95, 1 - d / 13000)));
    });
  }
}

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { discovered: raw.discovered ?? [], best: raw.best ?? {} };
  } catch {
    return { discovered: [], best: {} };
  }
}

function saveProgress(p) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode; progress just won't persist */
  }
}
