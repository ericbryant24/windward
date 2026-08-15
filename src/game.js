import * as THREE from '../vendor/three.module.js';
import { Air, Glider } from './flight.js';
import { createAircraft, disposeAircraft } from './aircraft.js';
import { FLEET, getAircraft, polar } from './fleet.js';
import { AirViz } from './airviz.js';
import { Wreck } from './wreck.js';
import { World, createThermalClouds } from './world.js';
import { Trees } from './trees.js';
import { Buildings } from './buildings.js';
import { Network } from './network.js';
import { Challenges, MEDAL_NAMES, formatMetric, challengeMetric } from './challenges.js';
import { store } from './store.js';
import { formatTime } from './hud.js';

const CAMERA_MODES = ['chase', 'far', 'cockpit'];
const STORE_KEY = 'windward.progress.v1';
const SHIP_KEY = 'windward.aircraft';

/**
 * Mode rules, scoring, camera and the frame loop. The glider physics live in
 * flight.js; this is everything that turns flying into a game.
 */
export class Game {
  constructor({ renderer, scene, camera, hud, controls, heightfield, sky, terrain, lakes, audio, quality, buildingData, networkData, region }) {
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

    this.region = region;
    this.air = new Air(heightfield, sky, region.air);
    this.air.seedThermals();
    this.spec = getAircraft(store.get(SHIP_KEY));
    this.polar = polar(this.spec);
    this.glider = new Glider(this.air, this.spec);

    this.world = new World(heightfield, sky, scene, region.id);
    this.aircraft = createAircraft(sky, this.spec);
    scene.add(this.aircraft);

    this.clouds = createThermalClouds(this.air, sky);
    scene.add(this.clouds);

    // How much air to draw is a device question, and main.js owns the quality
    // table this must not add a row to — so read the tier off what it already
    // says about the machine.
    const tier = quality?.trees === false ? 0 : quality?.pixelRatio >= 2 ? 2 : 1;
    this.airviz = new AirViz(this.air, heightfield, sky, {
      motes: [90, 170, 250][tier],
      columns: [18, 30, 40][tier],
    });
    scene.add(this.airviz.mesh);

    if (quality?.trees !== false) {
      this.trees = new Trees(heightfield, sky, { ...quality?.treeOptions, ...region.trees });
      scene.add(this.trees.mesh);
    }
    if (networkData) {
      this.network = new Network(heightfield, sky, networkData, quality?.networkOptions);
      scene.add(this.network.group);
    }
    if (buildingData) {
      this.buildings = new Buildings(heightfield, sky, buildingData, this.world.places, {
        ...quality?.buildingOptions,
        ...region.buildings,
      });
      scene.add(this.buildings.group);
    }

    // After the buildings, which the collect tasks consult so that no pickup
    // ends up buried inside a tower.
    this.challenges = new Challenges(this.world, heightfield, sky, scene, region.id, this.buildings);
    this.wreck = new Wreck(scene, sky, heightfield, this.buildings);

    this.state = 'menu';
    this.mode = 'free';
    this.cameraMode = 0;
    this.timer = 0;
    this.score = 0;
    this.streak = 1;
    this.maxAltitude = 0;
    this.gateIndex = 0;
    this.lowTime = 0;
    this.progress = loadProgress();

    this._camPos = new THREE.Vector3();
    this._camAim = new THREE.Vector3();
    this._prevPos = new THREE.Vector3();
    this._hit = {};
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._camShake = new THREE.Vector3();
    this._liftPos = new THREE.Vector3();
    this._lift = null;
    this._liftAge = 0;
    this._crashCam = new THREE.Vector3();
    this._crashAim = new THREE.Vector3();
    this.labels = new LabelLayer(document.getElementById('ui'), this.world.places);

    this.hud.setFleet(FLEET, this.spec.id);
    // Park the ship somewhere sane so nothing sits at the world origin while
    // the menu camera drifts over the peaks.
    const start = this.spawnFor('free');
    this.glider.reset(start.position, start.heading, start.speed);
  }

  // ------------------------------------------------------------- setup ---
  /**
   * Swap aeroplanes from the menu. The spec is the whole aircraft — physics,
   * mesh and the numbers the HUD quotes — so everything that reads it has to
   * be handed the new one.
   */
  setAircraft(id) {
    const spec = getAircraft(id);
    if (spec === this.spec) return;
    this.spec = spec;
    this.polar = polar(spec);
    this.glider.setAircraft(spec);
    this.scene.remove(this.aircraft);
    disposeAircraft(this.aircraft);
    this.aircraft = createAircraft(this.sky, spec);
    this.scene.add(this.aircraft);
    if (this._sun) this.setLighting(this._sun, this._amb);
    store.set(SHIP_KEY, spec.id);
    this.hud.setFleet(FLEET, spec.id);
    const start = this.spawnFor('free');
    this.glider.reset(start.position, start.heading, start.speed);
  }

  startMode(mode) {
    this.mode = mode;
    this.state = 'flying';
    this.timer = mode === 'climb' ? 300 : 0;
    this.score = 0;
    this.streak = 1;
    this.maxAltitude = 0;
    this.gateIndex = 0;
    this.lowTime = 0;
    this.wreck.end();
    // Puts the circuit course back if a slalom had swapped it out, so the
    // gates below are the ones this mode expects.
    this.challenges.abort();
    this.challenges.setVisible(mode === 'free');
    this.world.resetGates();
    this.world.group.visible = mode === 'circuit';

    const spawn = this.spawnFor(mode);
    this.glider.reset(spawn.position, spawn.heading, spawn.speed);
    this._prevPos.copy(this.glider.position);
    this.#placeCamera(true);
    this.#surveyAir();

    this.hud.setMode(mode);
    this.hud.showMenu(false);
    this.hud.showFlight(true);
    this.hud.hideResults();
    this.controls.setVisible(true);

    const intro = {
      free: 'Find the lift. Fly into a marker to start a challenge.',
      circuit: 'Eleven gates. Fly clean, fly low, fly fast.',
      climb: 'Five minutes. Take everything the air will give.',
    }[mode];
    this.hud.toast(intro);
  }

  /**
   * Spawn speeds are multiples of the ship's trim speed, not absolutes. A
   * trainer launched at the sailplane's 40 m/s arrives at the first gate
   * already past its never-exceed speed.
   */
  spawnFor(mode) {
    const trim = this.spec.trimSpeed;
    if (mode === 'circuit') {
      const g0 = this.world.gates[0];
      const back = this._v.copy(g0.normal).multiplyScalar(-950);
      const pos = new THREE.Vector3().copy(g0.position).add(back);
      pos.y = Math.max(pos.y, this.hf.heightAt(pos.x, pos.z) + 220);
      const heading = (THREE.MathUtils.radToDeg(Math.atan2(g0.normal.x, -g0.normal.z)) + 360) % 360;
      return { position: pos, heading, speed: trim * 1.21 };
    }
    // Free flight and the climb task each open where the region says.
    const s = (mode === 'climb' ? this.region.climbStart : null) ?? this.region.start;
    const v = this.world.toLocal(s.lat, s.lon);
    const ground = this.hf.heightAt(v.x, v.z);
    return {
      position: new THREE.Vector3(v.x, ground + s.agl, v.z),
      heading: s.heading,
      speed: trim * (mode === 'climb' ? 1.03 : 1.09),
    };
  }

  toMenu() {
    this.state = 'menu';
    this.wreck.end();
    this.challenges.abort();
    this.challenges.setVisible(false);
    this.controls.setVisible(false);
    this.hud.showFlight(false);
    this.hud.hideResults();
    this.labels.clear();
    this.hud.setChallenges(this.challenges.summary());
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

    // The air layer follows the ship, not the camera: what has to be legible is
    // the air the player is flying in.
    this.airviz.mesh.visible = this.state !== 'menu';
    if (this.state !== 'menu') {
      this.airviz.update(dt, this.glider.position);
      // One sampled vector, read by everything on the ground that shows wind.
      const wind = this.airviz.field.surfaceWind;
      this.trees?.setWind(wind);
      this.lakes?.setWind(wind);
      // Hunting for lift walks every thermal on the map; the answer changes far
      // too slowly to be worth doing at the physics rate.
      this._liftAge -= dt;
      if (this._liftAge <= 0) {
        this._liftAge = 0.25;
        this._lift = this.airviz.field.bestLift(this.glider.position, {
          sink: this.polar.minSink + 0.15,
          glide: this.polar.bestLD * 0.75,
        });
      }
    }

    this.trees?.update(dt, this.camera.position);
    this.buildings?.update(this.camera.position);
    this.network?.update(dt, this.camera.position);
    this.wreck.tick(dt);
    this.aircraft.position.copy(this.glider.position);
    this.aircraft.quaternion.copy(this.glider.quaternion);
    this.aircraft.userData.animate?.(dt, this.glider);
    // Watching your own wreck from inside the cockpit you are no longer in is
    // not the shot; a crash always plays from outside.
    this.aircraft.visible =
      this.state !== 'menu' && (this.wreck.active || CAMERA_MODES[this.cameraMode] !== 'cockpit');

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
        challenge: this.challenges.hudState(),
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

    // A wreck flies itself: it tumbles, scrapes and slides to a halt, and only
    // when it has stopped and been looked at for a beat does the game move on.
    if (this.wreck.active) {
      if (this.wreck.update(dt, g)) {
        this.wreck.end();
        this.#respawn();
      }
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

    // ---- structures --------------------------------------------------------
    // Tested against the swept path, before the terrain, because in Chicago
    // the thing you hit is almost never the ground.
    if (this.buildings && this.state === 'flying') {
      const hit = this.buildings.hitSegment(this._prevPos, g.position, this._hit);
      if (hit) {
        // A roof taken from above is a flat surface; a wall is the edge normal
        // hitSegment worked out from the footprint.
        const overRoof = this._prevPos.y > hit.top - 0.4;
        this.#crash('structure', {
          normal: overRoof ? this._v.set(0, 1, 0) : this._v.set(hit.nx, 0, hit.nz).normalize(),
          point: this._v2.set(hit.x, overRoof ? hit.top : hit.y, hit.z),
        });
        return;
      }
    }

    const ground = this.hf.heightAt(g.position.x, g.position.z);
    const agl = g.position.y - ground;

    // ---- terrain contact ---------------------------------------------------
    if (agl < 3.5) {
      const water = this.hf.isWater(g.position.x, g.position.z);
      const normal = this.hf.normalAt(g.position.x, g.position.z, 30, this._v);
      const gentle = normal.y > 0.93;
      // Touching down is a speed relative to the ship: the trainer arrives at
      // 20 m/s and the open-class ship cannot get below 26 without stalling.
      const trim = this.spec.trimSpeed;
      const slow = g.airspeed < trim * 0.79 && Math.abs(g.vario) < trim * 0.18;
      if (gentle && slow && !water) this.#land();
      else this.#crash(water ? 'water' : 'terrain', { normal, point: this._v2.set(g.position.x, ground, g.position.z) });
      return;
    }

    // ---- ridge running: reward flying close, but only while quick ----------
    if (agl < 90 && g.airspeed > this.spec.trimSpeed * 0.73) {
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
    } else if (this.mode === 'free') {
      // Challenges are a sub-state of free flight rather than a mode of their
      // own: that is what lets you leave one and fly straight into the next.
      for (const ev of this.challenges.update(dt, g.position, this._prevPos, agl)) {
        if (ev.kind === 'armed') this.#announceChallenge(ev.def);
        else if (ev.kind === 'note') this.#noteChallenge(ev);
        else if (ev.kind === 'done') this.#finishChallenge(ev);
        else if (ev.kind === 'failed') this.#failChallenge(ev);
      }
    }
  }

  // -------------------------------------------------------- challenges ---
  #announceChallenge(def) {
    const target = challengeMetric(def) === 'height'
      ? `under ${def.ceiling} m for ${def.hold} s`
      : `gold in ${def.medals[2]} s`;
    this.hud.toast(`<b>${def.name}</b> · ${target}`);
    this.audio?.cue('gate');
  }

  #noteChallenge(ev) {
    this.hud.toast(ev.text, ev.tone ?? '');
    if (ev.cue) this.audio?.cue(ev.cue);
  }

  #finishChallenge(ev) {
    const { def, value, medal, improved } = ev;
    this.state = 'done';
    this.audio?.cue('finish');
    this.controls.setVisible(false);
    this.score += 500 + medal * 700;
    this.#recordBest();
    const label = challengeMetric(def) === 'height' ? 'Mean height' : 'Time';
    this.hud.showResults(medal ? `${MEDAL_NAMES[medal]} — ${def.name}` : def.name, [
      [label, formatMetric(def, value)],
      ['Your best', formatMetric(def, ev.best) + (improved ? ' · new' : '')],
      ['Gold at', formatMetric(def, def.medals[2])],
      ['Score', Math.round(this.score).toLocaleString('en-US')],
    ], this.#challengeButtons());
  }

  /**
   * Losing a task must not stop the flight. The modal card is for a medal you
   * want to look at; a failure that takes the sky away from you is the map
   * interrupting a free flight you never asked it to interrupt.
   */
  #failChallenge(ev) {
    const why = ev.reason === 'crash' ? 'you crashed' : 'out of time';
    this.hud.toast(`<b>${ev.def.name}</b> — ${why}`, 'bad');
  }

  #challengeButtons() {
    return [
      { label: 'Retry', action: 'challenge-retry', primary: true },
      { label: 'Keep flying', action: 'challenge-resume' },
      { label: 'Menu', action: 'menu' },
    ];
  }

  /** Straight back to the marker with the clock zeroed. Nothing reloads. */
  retryChallenge() {
    const def = this.challenges.lastDef;
    if (!def) return this.resumeFree();
    this.hud.hideResults();
    this.state = 'flying';
    this.wreck.end();
    this.controls.setVisible(true);
    const spawn = this.challenges.spawnFor(def);
    this.glider.reset(spawn.position, spawn.heading, this.spec.trimSpeed * 1.33);
    this._prevPos.copy(this.glider.position);
    this.#placeCamera(true);
    this.#surveyAir();
    this.challenges.arm(def);
    this.#announceChallenge(def);
  }

  /** Put the results card away and carry on from where the task ended. */
  resumeFree() {
    this.hud.hideResults();
    this.state = 'flying';
    this.controls.setVisible(true);
  }

  /** R, and the results-screen button: retry the task if one is running. */
  restart() {
    if (this.challenges.active) this.retryChallenge();
    else this.startMode(this.mode);
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
    // A task you are actually flying owns the arrow. A marker you merely
    // happen to be near does not: over Chicago the markers cluster downtown
    // and would hide the thermal that is the only thing keeping you up, so
    // whichever of the two is closer wins.
    let task = null;
    if (this.mode === 'free') {
      task = this.challenges.objective(this.glider.position);
      if (task && !task.hint) return task;
    }
    // Not the nearest thermal: the nearest lift this ship can reach and use.
    // "Nearest thermal" pointed just as confidently at a column whose top was
    // below you, or at one across four kilometres of lake you had no height to
    // cross, and a readout that does that is worse than an empty one.
    const p = this.glider.position;
    const lift = this._lift;
    if (!lift) return task ?? { name: 'No lift within glide', position: null };
    if (task && Math.hypot(task.position.x - p.x, task.position.z - p.z) < lift.distance) return task;
    return { name: `Lift ${lift.w.toFixed(1)} m/s`, position: this._liftPos.set(lift.x, lift.y, lift.z) };
  }

  #land() {
    this.state = 'done';
    this.challenges.abort();
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

  /**
   * Hand the ship over to the wreck. Everything that follows — the tumble, the
   * dust, the shaken camera, the pause before the game says anything — is the
   * wreck's, and #simulate brings it back here through #respawn when it stops.
   */
  #crash(cause = 'terrain', impact = null) {
    const g = this.glider;
    const normal = impact?.normal ?? this._v.set(0, 1, 0);
    const point = impact?.point ?? this._v2.copy(g.position);
    const severity = this.wreck.begin(g, { cause, normal, point });
    // The camera stops flying too: it keeps the frame it had at the moment of
    // the bang and lets the wreck fall through it.
    this._crashCam.copy(this.camera.position);
    // Looking slightly down on the site from the off, so a crash on a hillside
    // is not filmed from inside the hillside.
    this._crashCam.y = Math.max(this._crashCam.y, point.y + 5);
    this._crashAim.copy(g.position);

    this.streak = 1;
    // A scrape costs less than arriving flat out into a tower. Severity is
    // uncapped here on purpose: a redline dive into Willis Tower is the most
    // expensive thing in the game, not a tie with a mediocre 45-degree arrival.
    this.score = Math.max(0, this.score - Math.round(80 + 450 * severity));
    this.audio?.cue('crash');
    this.hud.setWarning('');
    this.hud.impact(severity);
    // A running challenge has to die with the ship, not keep counting while
    // the wreck waits to respawn.
    const failed = this.challenges.crashed();
    if (failed) this.#failChallenge(failed);
    else this.hud.toast(crashLine(cause, severity), 'bad');
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
      // Clear of the terrain AND of whatever is standing on it. A fixed height
      // above the ground drops you back inside Willis Tower, which crashes you
      // again on the next step, which respawns you inside it again.
      const skyline = this.buildings?.topNear(base.x, base.z) ?? -Infinity;
      base.y = Math.max(this.hf.heightAt(base.x, base.z) + 420, skyline + 150);
    }
    g.reset(base, heading, this.spec.trimSpeed * 1.15);
    this._prevPos.copy(g.position);
    this.#placeCamera(true);
    this.#surveyAir();
  }

  /**
   * Sweep the air where the ship now is. The field fills itself in a cell at a
   * time as you fly, which is right while you are flying and wrong the instant
   * you are somewhere else: without this the first seconds after a launch or a
   * respawn are flown over a survey of wherever the last one ended.
   */
  #surveyAir() {
    this.airviz.prime(this.glider.position);
    this._liftAge = 0;
    this._lift = null;
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
    if (this.wreck.active) {
      this.#crashCamera(snap ? 1 : dt);
      return;
    }
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

    // Speed reads as speed relative to what this ship calls fast.
    const rush = (g.airspeed - this.spec.trimSpeed) * (8 / this.spec.trimSpeed);
    const target = THREE.MathUtils.clamp(this._baseFov + rush + (g.boosting ? 5 : 0), this._baseFov - 3, this._baseFov + 12);
    this.camera.fov = snap ? target : THREE.MathUtils.damp(this.camera.fov, target, 3, dt);
    this.camera.updateProjectionMatrix();
  }

  /**
   * A crash is the one time the camera is not a chase camera. It holds where
   * it was, shakes, and only drifts if the wreck is about to leave the frame —
   * the ship falls away from you instead of the world sliding calmly past.
   */
  #crashCamera(dt) {
    const g = this.glider;
    const cam = this.camera;
    const base = this._crashCam;

    const to = this._v.copy(g.position).sub(base);
    const d = to.length() || 1;
    const want = THREE.MathUtils.clamp(d, 19, 46);
    // Give ground quickly to a wreck coming at the lens; only drift after one
    // that is getting away.
    base.addScaledVector(to.divideScalar(d), (d - want) * Math.min(1, dt * (d < want ? 12 : 2.2)));
    // Clear of the ground, and never below the wreck: from underneath, a crash
    // on a hillside is a view of the inside of the hillside.
    const floor = Math.max(this.hf.heightAt(base.x, base.z) + 6, g.position.y + 1.5);
    if (base.y < floor) base.y += (floor - base.y) * Math.min(1, dt * 5);

    // Two frequencies so it reads as a knock rather than a vibration.
    const s = this.wreck.shake;
    const t = this.wreck.t;
    this._camShake
      .set(
        Math.sin(t * 47.3) + 0.6 * Math.sin(t * 91.7),
        Math.sin(t * 38.1 + 1.7) + 0.6 * Math.sin(t * 103.3),
        Math.sin(t * 53.9 + 3.1) + 0.6 * Math.sin(t * 87.1)
      )
      .multiplyScalar(s * 1.1 * Math.min(1, d / 19));
    cam.position.copy(base).add(this._camShake);

    this._crashAim.lerp(g.position, 1 - Math.exp(-dt * 9));
    cam.lookAt(this._crashAim);

    const target = this._baseFov + s * 13;
    cam.fov = THREE.MathUtils.damp(cam.fov, target, 9, dt);
    cam.updateProjectionMatrix();
  }

  setBaseFov(fov) {
    this._baseFov = fov;
    if (this.state === 'menu') {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Slow orbit of whatever the region is known for, behind the main menu. */
  updateMenuCamera(t) {
    const cam = this.region.menuCamera;
    const centre = this.world.places.find((p) => p.name === cam.focus) ?? this.world.places[0];
    if (!centre) return;
    const a = t * 0.035;
    this.camera.position.set(
      centre.x + Math.cos(a) * cam.radius,
      cam.height + Math.sin(a * 1.7) * cam.radius * 0.046,
      centre.z + Math.sin(a) * cam.radius
    );
    this.camera.lookAt(centre.x, cam.lookAtY ?? centre.y * (cam.lookAtScale ?? 1), centre.z);
  }

  setLighting(sunRadiance, skyAmbient) {
    // Kept so a ship swapped in from the menu can be lit like everything else.
    this._sun = sunRadiance;
    this._amb = skyAmbient;
    this.world.setLighting(sunRadiance, skyAmbient);
    this.challenges.setLighting(sunRadiance, skyAmbient);
    this.wreck.setLighting(sunRadiance, skyAmbient);
    this.clouds.userData.setLighting(sunRadiance, skyAmbient);
    this.airviz.setLighting(sunRadiance, skyAmbient);
    this.trees?.setLighting(sunRadiance, skyAmbient);
    this.buildings?.setLighting(sunRadiance, skyAmbient);
    this.network?.setLighting(sunRadiance, skyAmbient);
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
    // The columns standing in the old sky belong to thermals that no longer
    // exist; nothing may survive a re-seed but the sampler itself.
    this.#surveyAir();
  }
}

function modeName(mode) {
  return { free: 'Free Flight', circuit: 'Circuit', climb: 'Height Hunt' }[mode] ?? mode;
}

/** What the toast says depends on how hard you arrived. */
function crashLine(cause, severity) {
  const where = { structure: 'the building', water: 'the water', terrain: 'the ground' }[cause] ?? 'the ground';
  if (severity < 0.14) return `Clipped ${where}. Resetting…`;
  if (severity < 0.5) return `You went into ${where}. Resetting…`;
  // Only reachable near the redline, which is the point of having it.
  if (severity < 0.95) return `You arrived at ${where} all at once. Resetting…`;
  return `You put the ship into ${where} at redline. Resetting…`;
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
    const raw = JSON.parse(store.get(STORE_KEY) ?? '{}');
    return { discovered: raw.discovered ?? [], best: raw.best ?? {} };
  } catch {
    return { discovered: [], best: {} };
  }
}

function saveProgress(p) {
  store.set(STORE_KEY, JSON.stringify(p));
}
