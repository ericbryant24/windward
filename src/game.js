import * as THREE from '../vendor/three.module.js';
import { Air, Glider } from './flight.js';
import { createAircraft, disposeAircraft } from './aircraft.js';
import { FLEET, ISSUED_AIRCRAFT, getAircraft, polar } from './fleet.js';
import { AirViz } from './airviz.js';
import { Wreck } from './wreck.js';
import { World, createThermalClouds } from './world.js';
import { Trees } from './trees.js';
import { createFalls } from './falls.js';
import { Ghost, Recorder, saveGhost } from './ghost.js';
import { Buildings } from './buildings.js';
import { Network } from './network.js';
import { Minimap } from './minimap.js';
import {
  Challenges,
  MEDAL_NAMES,
  formatClock,
  formatMetric,
  challengeMetric,
  entrySpeed,
  medalFor,
  levels,
  tally,
  unlocked,
  shipFor,
} from './challenges.js';
import { PLACES } from './regions.js';
import { store } from './store.js';

const CAMERA_MODES = ['chase', 'far', 'cockpit'];
const STORE_KEY = 'windward.progress.v2';
const SHIP_KEY = 'windward.aircraft';

/**
 * Rules, camera and the frame loop. The glider physics live in flight.js; this
 * is everything that turns flying into a game.
 *
 * There are two things you can be doing: flying, and flying a challenge. That
 * is the whole state machine. A challenge is not a mode — it arms when you
 * cross its hoop and it ends where it ends, and either way you are still in the
 * air over the same map with the next marker somewhere off the wingtip.
 *
 * There is no score. There used to be one, paid out for landmarks, for medals,
 * for flying close to the rock and docked for crashing, and it answered no
 * question a player was asking: a high score in an open sky with no clock is a
 * number that goes up if you keep flying. What is kept instead is what was
 * actually done — which landmarks have been found, and what each challenge has
 * been flown in.
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
    // Two aeroplanes to keep track of: the one plain flying uses, and the one
    // currently bolted to the physics. While the game issues a single ship they
    // are always the same aeroplane — but the swap is still real machinery, so
    // putting the hangar back is a matter of unsetting one constant.
    this.freeSpec = getAircraft(ISSUED_AIRCRAFT ?? store.get(SHIP_KEY));
    this.spec = this.freeSpec;
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
    // The waterfalls the map is named for. Two triangles and a noise field
    // each, so they go on at every quality tier that draws anything at all.
    this.falls = createFalls(heightfield, sky, region.falls);
    scene.add(this.falls);
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
    // Your best run at whatever you are flying, flying it again beside you.
    this.ghost = new Ghost(scene, sky, this.spec);
    this.recorder = new Recorder();

    this.state = 'menu';
    this.cameraMode = 0;
    this.timer = 0;
    this.maxAltitude = 0;
    this.progress = loadProgress();

    this._camPos = new THREE.Vector3();
    this._camAim = new THREE.Vector3();
    this._prevPos = new THREE.Vector3();
    this._hit = {};
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._camShake = new THREE.Vector3();
    this._camFwd = new THREE.Vector3();
    this._liftPos = new THREE.Vector3();
    this._lift = null;
    this._liftAge = 0;
    this._crashCam = new THREE.Vector3();
    this._crashAim = new THREE.Vector3();
    this.labels = new LabelLayer(document.getElementById('ui'), this.world.places);
    this.labels.setTasks(this.challenges.markers);

    // Last, because it bakes a plan of the whole region — relief, water, the
    // built-up area and one honest Air sample per cell — and every one of those
    // has to exist first.
    this.minimap = new Minimap(this.hud.minimapCanvas, {
      heightfield,
      air: this.air,
      world: this.world,
      challenges: this.challenges,
      buildingData,
      networkData,
    });

    this.hud.setFleet(FLEET, this.spec.id);
    this.controls.setAircraft(this.spec);
    // Park the ship somewhere sane so nothing sits at the world origin while
    // the menu camera drifts over the peaks.
    const start = this.spawnFor();
    this.glider.reset(start.position, start.heading, start.speed);
  }

  // ------------------------------------------------------------- setup ---
  /**
   * Swap aeroplanes. The spec is the whole aircraft — physics, mesh and the
   * numbers the HUD quotes — so everything that reads it has to be handed the
   * new one.
   *
   * `remember` separates the two callers. The hangar is the player choosing
   * what to fly and that choice outlives the session; a challenge putting them
   * in its own ship is not a choice and must not overwrite theirs.
   */
  setAircraft(id, remember = true) {
    const spec = getAircraft(ISSUED_AIRCRAFT ?? id);
    if (remember && !ISSUED_AIRCRAFT) {
      this.freeSpec = spec;
      store.set(SHIP_KEY, spec.id);
      this.hud.setFleet(FLEET, spec.id);
    }
    if (spec === this.spec) return;
    this.spec = spec;
    this.polar = polar(spec);
    this.hud.setShip(spec);
    // An engine means a lever where the airbrake button was, so the stick is
    // not the only thing that changes when the aeroplane does.
    this.controls.setAircraft(spec);
    this.glider.setAircraft(spec);
    this.scene.remove(this.aircraft);
    disposeAircraft(this.aircraft);
    this.aircraft = createAircraft(this.sky, spec);
    this.scene.add(this.aircraft);
    if (this._sun) this.setLighting(this._sun, this._amb);
  }

  /** The one button on the menu: you are in the air, over this map, doing as you like. */
  startFlight() {
    this.setAircraft(this.freeSpec.id, false);
    this.#takeOff(this.spawnFor());
    // Named for what is on the screen rather than for what the code calls it.
    // "Marker" is this file's word; what the player can see is a ring standing
    // in the air with a shaft of light under it.
    this.hud.toast('Fly through a ring of light to take on the challenge standing there.');
  }

  /**
   * Start a named challenge from the level select. Identical to crossing its
   * hoop — same ship, same place, same speed — so a time flown off the menu and
   * a time flown off the map are the same time.
   */
  startChallenge(def) {
    const spec = shipFor(def);
    this.#takeOff({ ...this.challenges.spawnFor(def), speed: entrySpeed(def, spec) }, spec);
    this.#beginChallenge(def);
  }

  /** Shared by both: put the world in the air and the UI out of the way. */
  #takeOff(spawn, spec = null) {
    if (spec) this.setAircraft(spec.id, false);
    this.state = 'flying';
    this.timer = 0;
    this.maxAltitude = 0;
    this.wreck.end();
    this.challenges.forget();
    this.ghost.clear();
    this.recorder.reset();
    this.challenges.setVisible(true);
    this.hud.dismissAsk();

    this.glider.reset(spawn.position, spawn.heading, spawn.speed ?? this.spec.trimSpeed * 1.09);
    this._prevPos.copy(this.glider.position);
    this.#placeCamera(true);
    this.#surveyAir();

    this.hud.showMenu(false);
    this.hud.showFlight(true);
    this.hud.hideResults();
    this.controls.setVisible(true);
  }

  /**
   * Arm a challenge and say what it is. Everything that starts one comes
   * through here — the hoop, the Retry button and the level select — so the
   * ship is never something a player can arrive in by accident.
   */
  #beginChallenge(def) {
    this.setAircraft(shipFor(def).id, false);
    this.challenges.arm(def);
    this.recorder.reset();
    // Both clocks start here, so the ghost is always at the same point of its
    // run as you are of yours — which is the whole of what makes it readable.
    const racing = this.ghost.load(def.id);
    // What gold asks for, said in the task's own units — "gold in 54 s" for a
    // slalom, "gold at 190 m" for the three that are scored upwards.
    const gold = formatMetric(def, def.medals[2]);
    const target = def.type === 'slalom' ? `gold in ${gold}` : `${def.window} s · gold at ${gold}`;
    this.hud.toast(`<b>${def.name}</b> · ${target}${racing ? ' · your best is out there' : ''}`);
    this.audio?.cue('gate');
  }

  /**
   * Where plain flying opens. Spawn speeds are multiples of the ship's trim
   * speed, not absolutes: a trainer launched at the sailplane's 40 m/s arrives
   * already past its never-exceed speed.
   */
  spawnFor() {
    const s = this.region.start;
    const v = this.world.toLocal(s.lat, s.lon);
    const ground = this.hf.heightAt(v.x, v.z);
    return {
      position: new THREE.Vector3(v.x, ground + s.agl, v.z),
      heading: s.heading,
      speed: this.spec.trimSpeed * 1.09,
    };
  }

  toMenu() {
    this.state = 'menu';
    this.wreck.end();
    this.challenges.forget();
    this.ghost.clear();
    this.challenges.setVisible(false);
    this.hud.dismissAsk();
    this.controls.setVisible(false);
    this.setAircraft(this.freeSpec.id, false);
    this.hud.showFlight(false);
    this.hud.hideResults();
    this.labels.clear();
    this.hud.showMenu(true, this.progressView());
  }

  /**
   * Everything the menu knows: both levels, every challenge in them, and one
   * tally that spans the pair. Built here rather than in the HUD because it is
   * the same question the world asks when it decides which hoops to stand up.
   */
  progressView() {
    // The live book, not storage: private browsing and sandboxed frames make
    // reads throw, and there loadMedals() answers {} while this session's
    // medals are real — the level select would lock hoops already standing in
    // the world. Challenges.best spans both maps, which is what this needs.
    const best = this.challenges.best;
    const medalled = tally(best).medalled;
    // A single-file build carries one map and can never reach the other, so it
    // must not offer a tally over fourteen challenges that only seven of are
    // flyable. Everywhere else this is both levels, which is the point.
    const only = window.WINDWARD_REGION ?? null;
    const shown = levels()
      .filter(({ region }) => !only || region.id === only)
      .map(({ region, defs }) => ({
        id: region.id,
        name: region.name,
        sub: region.mapSub,
        blurb: region.blurb,
        golds: defs.filter((d) => medalOf(d, best) === 3).length,
        total: defs.length,
        // In unlock order, so the list and the pip strip read left to right as
        // the ladder they are, whatever order the table happens to be in.
        rows: [...defs]
          .sort((a, b) => (a.needs ?? 0) - (b.needs ?? 0))
          .map((def) => ({
            def,
            medal: medalOf(def, best),
            best: best[def.id] ?? null,
            open: unlocked(def, medalled),
          })),
      }));
    const rows = shown.flatMap((l) => l.rows);
    return {
      here: this.region.id,
      levels: shown,
      total: rows.length,
      golds: rows.filter((r) => r.medal === 3).length,
      medalled: rows.filter((r) => r.medal > 0).length,
      discovered: this.progress.discovered.length,
      places: (only ? [PLACES[only] ?? []] : Object.values(PLACES)).reduce((n, list) => n + list.length, 0),
    };
  }

  togglePause() {
    if (this.state === 'flying') {
      this.state = 'paused';
      this.controls.setVisible(false);
      const running = this.challenges.active?.def;
      this.hud.showResults('Paused', [
        [running ? 'Challenge' : 'Over', running ? running.name : this.region.name],
        ['Altitude', `${Math.round(this.glider.position.y)} m`],
        ['Highest point', `${Math.round(this.maxAltitude)} m`],
      ], [
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
    this.falls.userData.update(dt);
    this.buildings?.update(this.camera.position);
    this.network?.update(dt, this.camera.position, this._camFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion));
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
      // One answer, read twice: the chevron on the horizon and the mark on the
      // map have to be pointing at the same thing or neither can be trusted.
      const objective = this.#objective();
      this.hud.update({
        glider: this.glider,
        ground,
        objective,
        camera: this.camera,
        challenge: this.#challengeHud(),
      });
      this.audio?.update(dt, {
        airspeed: this.glider.airspeed,
        vario: this.glider.varioSmooth,
        brake: this.glider.brake,
      });
      this.labels.update(this.camera, this.glider.position, this.progress.discovered, (def) =>
        this.challenges.medalOf(def)
      );
      this.minimap.update(dt, {
        position: this.glider.position,
        headingDeg: this.glider.headingDeg,
        // How far this ship can still go is the first question a moving map
        // answers, and it is a different answer in every aeroplane.
        bestLD: this.polar.bestLD,
        objective,
        discovered: this.progress.discovered,
      });
    }
  }

  /**
   * Things the game says exactly once, the first time they are true.
   *
   * A shaft of cyan light standing out of a valley is the most conspicuous
   * thing on either map and the game never said what it was. Neither did the
   * chevron that points at it. Both are obvious after the first challenge and
   * unreadable before it, which is the definition of something worth one
   * sentence — and of something not worth a tutorial. Said once, kept in the
   * profile, never said again.
   */
  #hints() {
    if (this.state !== 'flying' || this.challenges.active) return;
    const seen = this.progress.hints;
    if (seen.includes('marker')) return;
    for (const m of this.challenges.markers) {
      if (!m.mesh.visible) continue;
      if (m.position.distanceToSquared(this.glider.position) > 2200 * 2200) continue;
      seen.push('marker');
      saveProgress(this.progress);
      this.hud.toast(
        `<b>${m.def.name}</b><br>That column of light is a challenge. Fly through the ring to start it.`,
        'discovery'
      );
      return;
    }
  }

  /**
   * The challenge band, with the ghost folded in. How far ahead of your own
   * best you are RIGHT NOW is the number a ghost exists to produce, and for the
   * three types scored on a quantity it is a number rather than a picture — the
   * aeroplane out in front already tells a slalom's story.
   */
  #challengeHud() {
    const state = this.challenges.hudState();
    const run = this.challenges.active;
    if (state && run && this.ghost.track && run.def.type !== 'slalom') {
      state.ghost = run.value - this.ghost.score;
    }
    return state;
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
      this.hud.setWarning(g.warning || '');
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

    if (g.position.y > this.maxAltitude) this.maxAltitude = g.position.y;

    // ---- discovery ---------------------------------------------------------
    for (const p of this.world.places) {
      if (this.progress.discovered.includes(p.name)) continue;
      const dx = p.x - g.position.x;
      const dz = p.z - g.position.z;
      if (dx * dx + dz * dz < 800 * 800 && Math.abs(g.position.y - p.y) < 900) {
        this.progress.discovered.push(p.name);
        saveProgress(this.progress);
        this.hud.toast(`<b>${p.name}</b> discovered`, 'discovery');
        this.audio?.cue('discovery');
      }
    }

    this.#hints();

    this.timer += dt;

    // ---- the ghost ---------------------------------------------------------
    // Driven off the run's own clock rather than the frame's, so a hitch moves
    // the ghost and the ship by exactly the same amount.
    const run = this.challenges.active;
    if (run) {
      this.recorder.sample(run.elapsed, g, run.def.type === 'slalom' ? run.gateIndex : run.value);
      this.ghost.seek(run.elapsed);
    }

    // ---- challenges --------------------------------------------------------
    for (const ev of this.challenges.update(dt, g.position, this._prevPos, agl)) {
      if (ev.kind === 'armed') this.#armFromMarker(ev.def);
      else if (ev.kind === 'note') this.#noteChallenge(ev);
      else if (ev.kind === 'done') this.#finishChallenge(ev);
      else if (ev.kind === 'failed') this.#failChallenge(ev);
    }
  }

  // -------------------------------------------------------- challenges ---
  /**
   * You crossed a hoop. Since the challenge names the ship it is flown in, this
   * cannot simply start a clock — it has to put you in that aeroplane, which
   * means putting you back on the hoop at its own trim speed. You have barely
   * moved; what changes is that everyone attempting this now starts it from the
   * same place at the same speed, which is the only way the medal times mean
   * anything.
   */
  #armFromMarker(def) {
    const spawn = this.challenges.spawnFor(def);
    this.setAircraft(shipFor(def).id, false);
    this.glider.reset(spawn.position, spawn.heading, entrySpeed(def, this.spec));
    this._prevPos.copy(this.glider.position);
    this.#placeCamera(true);
    this.#beginChallenge(def);
  }

  #noteChallenge(ev) {
    this.hud.toast(ev.text, ev.tone ?? '');
    if (ev.cue) this.audio?.cue(ev.cue);
  }

  #finishChallenge(ev) {
    const { def, value, medal, improved, opened } = ev;
    // Only the best run is kept. A ghost of a worse run than the one you have
    // already flown is a ghost you would beat by doing nothing.
    if (improved) saveGhost(def.id, this.recorder.encode());
    this.state = 'done';
    this.audio?.cue('finish');
    this.controls.setVisible(false);
    const label = { time: 'Time', height: 'Height gained', distance: 'Distance', count: 'Rolls' }[
      challengeMetric(def)
    ];
    const totals = tally(this.challenges.best);
    const lines = [
      [label, formatMetric(def, value)],
      ['Your best', formatMetric(def, ev.best) + (improved ? ' · new' : '')],
      ['Gold at', formatMetric(def, def.medals[2])],
      ['Golds', `${totals.golds} of ${totals.total}`],
    ];
    // The reveal is the reward. Say it on the card that earned it, by name, so
    // the next thing to do is already decided before the card is dismissed.
    for (const next of opened ?? []) lines.push(['Unlocked', next.name]);
    this.hud.showResults(medal ? `${MEDAL_NAMES[medal]} — ${def.name}` : def.name, lines, this.#challengeButtons());
    if (opened?.length) this.audio?.cue('discovery');
  }

  /**
   * Losing a task must not stop the flight. The modal card is for a medal you
   * want to look at; a failure that takes the sky away from you is the map
   * interrupting a free flight you never asked it to interrupt.
   */
  #failChallenge(ev) {
    const why = ev.reason === 'crash' ? 'you crashed' : 'out of time';
    // A lost run has to loop as tightly as a finished one, so the offer to go
    // again waits here rather than expiring with the toast that carries it.
    this.hud.ask(`<b>${ev.def.name}</b> — ${why}`, [
      { label: 'Retry', action: 'challenge-retry' },
      { label: 'Fly on', action: 'challenge-dismiss' },
    ]);
  }

  #challengeButtons() {
    return [
      { label: 'Retry', action: 'challenge-retry', primary: true },
      { label: 'Fly on', action: 'challenge-resume' },
      { label: 'Menu', action: 'menu' },
    ];
  }

  /** Straight back to the marker with the clock zeroed. Nothing reloads. */
  retryChallenge() {
    const def = this.challenges.lastDef;
    if (!def) return this.resumeFree();
    this.hud.hideResults();
    this.hud.dismissAsk();
    this.state = 'flying';
    this.wreck.end();
    this.controls.setVisible(true);
    this.#armFromMarker(def);
    this.#surveyAir();
  }

  /**
   * Turn down the offer to go again. Deliberately touches nothing but the run:
   * this is answered while the wreck is still tumbling, and the flight state
   * of a wreck belongs to the wreck.
   */
  dismissChallenge() {
    this.hud.dismissAsk();
    this.challenges.forget();
    this.ghost.clear();
  }

  /** Put the results card away and carry on from where the task ended. */
  resumeFree() {
    this.hud.hideResults();
    this.hud.dismissAsk();
    this.challenges.forget();
    this.ghost.clear();
    this.state = 'flying';
    this.controls.setVisible(true);
  }

  /**
   * R, and the results-screen button: go again at the last task. Not gated on
   * a run being live — a task you just lost has already been aborted, and that
   * is precisely the moment you want it back. Flying on clears the run, so
   * after that R means what it always meant.
   */
  restart() {
    if (this.challenges.lastDef) this.retryChallenge();
    else this.startFlight();
  }

  #objective() {
    // A task you are actually flying owns the arrow. A marker you merely
    // happen to be near does not: over Chicago the markers cluster downtown
    // and would hide the thermal that is the only thing keeping you up, so
    // whichever of the two is closer wins.
    let task = this.challenges.objective(this.glider.position);
    if (task && !task.hint) return task;
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
      ['Highest point', `${Math.round(this.maxAltitude)} m`],
      ['Time aloft', formatClock(this.timer)],
    ];
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

    this.audio?.cue('crash');
    this.hud.setWarning('');
    this.hud.impact(severity);
    // A running challenge has to die with the ship, not keep counting while
    // the wreck waits to respawn.
    const failed = this.challenges.crashed();
    // The run is over, so the ghost stops being a race and becomes an aeroplane
    // hanging in the air next to a wreck.
    if (failed) {
      this.ghost.clear();
      this.#failChallenge(failed);
    }
    else this.hud.toast(crashLine(cause, severity), 'bad');
  }

  #respawn() {
    const g = this.glider;
    const base = this._v.copy(g.position);
    // Clear of the terrain AND of whatever is standing on it. A fixed height
    // above the ground drops you back inside Willis Tower, which crashes you
    // again on the next step, which respawns you inside it again.
    const skyline = this.buildings?.topNear(base.x, base.z) ?? -Infinity;
    base.y = Math.max(this.hf.heightAt(base.x, base.z) + 420, skyline + 150);
    g.reset(base, g.headingDeg, this.spec.trimSpeed * 1.15);
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

    // Framed off the WINGSPAN, not off a constant. 24 m behind an aeroplane is
    // a chase camera on a nineteen-metre sailplane and a speck on a
    // seven-metre monoplane — same distance, forty per cent of the apparent
    // size — and "it feels small on screen" is that arithmetic, not the
    // aeroplane. The multipliers are the old numbers divided by the Draco's
    // span, so nothing about the sailplanes moves.
    const span = Math.max(4, (this.spec.look?.span ?? 9.4) * 2);
    const dist = Math.max(mode === 'far' ? 19 : 10, span * (mode === 'far' ? 2.45 : 1.28));
    const height = span * (mode === 'far' ? 0.69 : 0.34);

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

    const aim = this._camAim.copy(g.position).addScaledVector(fwd, span * 0.85).addScaledVector(g.velocity, 0.12);
    this.camera.lookAt(aim);

    // Speed reads as speed relative to what this ship calls fast.
    const rush = (g.airspeed - this.spec.trimSpeed) * (8 / this.spec.trimSpeed);
    const target = THREE.MathUtils.clamp(this._baseFov + rush, this._baseFov - 3, this._baseFov + 12);
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
    this.ghost.setLighting(sunRadiance, skyAmbient);
    this.clouds.userData.setLighting(sunRadiance, skyAmbient);
    this.airviz.setLighting(sunRadiance, skyAmbient);
    this.trees?.setLighting(sunRadiance, skyAmbient);
    this.falls?.userData.setLighting(sunRadiance, skyAmbient);
    this.buildings?.setLighting(sunRadiance, skyAmbient);
    this.network?.setLighting(sunRadiance, skyAmbient);
    for (const m of this.aircraft.userData.materials) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }

}

function medalOf(def, best) {
  const v = best[def.id];
  return v == null ? 0 : medalFor(def, v);
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

/**
 * Floating labels over the world: place names, so the region reads as somewhere
 * rather than terrain, and challenge markers, so the things you have not done
 * yet are visible from across the valley rather than discovered by accident.
 *
 * The task labels are the reason this exists in its current form. A hoop is
 * fifty metres across and the map is thirty-eight kilometres wide; without a
 * name and a distance hanging off it, a challenge is invisible until you are
 * already past it.
 */
class LabelLayer {
  constructor(root, places) {
    this.places = places;
    this.tasks = [];
    this.el = document.createElement('div');
    this.el.className = 'labels';
    Object.assign(this.el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
    root.appendChild(this.el);
    this.pool = [];
    this.taskPool = [];
    this._v = new THREE.Vector3();
  }

  setTasks(markers) {
    this.tasks = markers;
  }

  clear() {
    for (const el of [...this.pool, ...this.taskPool]) el.style.opacity = '0';
  }

  update(camera, from, discovered, medalOfMarker) {
    // Tasks first, and shown whatever the angle: unlike a mountain, a marker
    // directly in front of you is the one you most need named, because that is
    // the moment you are deciding whether to commit to it.
    const near = [];
    for (const m of this.tasks) {
      if (!m.mesh.visible) continue;
      const d = Math.hypot(m.position.x - from.x, m.position.z - from.z);
      if (d > 6500) continue;
      // Over the hoop first, and failing that at the foot of the light column.
      // A marker four hundred metres above you projects off the top of the
      // screen while its column still fills the middle of it, and an unnamed
      // column is exactly the thing a player has to ask about. Two anchors and
      // one of them is nearly always in frame.
      let proj = null;
      for (const y of [m.position.y + 70, m.ground + 60]) {
        const p = this._v.set(m.position.x, y, m.position.z).clone().project(camera);
        // Kept well inside the frame. A label pinned to the edge is half off
        // the screen and sitting on the airbrake button, and the objective
        // chevron already covers anything out there.
        if (p.z > 1 || Math.abs(p.x) > 0.66 || Math.abs(p.y) > 0.74) continue;
        proj = p;
        break;
      }
      if (!proj) continue;
      near.push({ m, d, proj });
    }
    near.sort((a, b) => a.d - b.d);
    const tasks = near.slice(0, 3);
    this.#draw(this.taskPool, 'task-label', tasks, ({ m, d }) => ({
      html:
        `<i></i><span>${m.def.name}</span>` +
        `<em>${d > 1500 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`}</em>`,
      cls: `m${medalOfMarker(m.def)}`,
      opacity: Math.max(0.35, Math.min(1, 1 - d / 9000)),
    }));

    const candidates = [];
    for (const p of this.places) {
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d > 11000 || d < 220) continue;
      this._v.set(p.x, p.y + (p.kind === 'peak' ? 60 : 30), p.z);
      const proj = this._v.clone().project(camera);
      if (proj.z > 1 || Math.abs(proj.x) > 0.85 || Math.abs(proj.y) > 0.8) continue;
      // A place name written across a challenge's name costs both of them. The
      // challenge is the one with something to do in it, so the mountain moves.
      if (tasks.some((t) => Math.abs(t.proj.x - proj.x) < 0.34 && Math.abs(t.proj.y - proj.y) < 0.055)) continue;
      candidates.push({ p, d, proj });
    }
    candidates.sort((a, b) => a.d - b.d);
    this.#draw(this.pool, 'place-label', candidates.slice(0, 6), ({ p, d }) => ({
      html: `<i></i><span>${p.name}</span>${p.kind === 'peak' ? `<em>${p.height} m</em>` : ''}`,
      cls: discovered.includes(p.name) ? '' : 'unknown',
      opacity: Math.max(0.18, Math.min(0.95, 1 - d / 13000)),
    }));
  }

  #draw(pool, className, items, describe) {
    while (pool.length < items.length) {
      const el = document.createElement('div');
      el.className = className;
      this.el.appendChild(el);
      pool.push(el);
    }
    pool.forEach((el, i) => {
      const item = items[i];
      if (!item) {
        el.style.opacity = '0';
        return;
      }
      const { html, cls, opacity } = describe(item);
      el.className = `${className} ${cls}`;
      el.innerHTML = html;
      el.style.left = `${(item.proj.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-item.proj.y * 0.5 + 0.5) * innerHeight}px`;
      el.style.opacity = String(opacity);
    });
  }
}

function loadProgress() {
  try {
    const raw = JSON.parse(store.get(STORE_KEY) ?? '{}');
    return { discovered: raw.discovered ?? [], hints: raw.hints ?? [] };
  } catch {
    return { discovered: [], hints: [] };
  }
}

function saveProgress(p) {
  store.set(STORE_KEY, JSON.stringify(p));
}
