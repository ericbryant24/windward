import * as THREE from '../vendor/three.module.js';
import { Heightfield } from './heightfield.js';
import { Sky, TIME_PRESETS } from './sky.js';
import { Terrain } from './terrain.js';
import { createLakes } from './water.js';
import { Hud } from './hud.js';
import { Controls } from './controls.js';
import { Game } from './game.js';
import { loadBuildings } from './buildings.js';
import { loadNetwork } from './network.js';
import { getRegion, DEFAULT_REGION } from './regions.js';
import { findChallenge, regionOfChallenge } from './challenges.js';
import { store } from './store.js';
import { Audio } from './audio.js';
import { Offline, formatBytes } from './offline.js';

const canvas = document.getElementById('view');
const uiRoot = document.getElementById('ui');
const params = new URLSearchParams(location.search);
const isMobile =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;

const QUALITY = {
  low: { gridN: 12, maxDepth: 7, baseRange: 1400, lightmapSize: 512, detail: 0, pixelRatio: 1, trees: false, buildings: false },
  med: {
    gridN: 16,
    maxDepth: 7,
    baseRange: 1400,
    lightmapSize: 768,
    detail: 1,
    pixelRatio: 1.5,
    treeOptions: { radius: 850, spacing: 17, maxInstances: 3000 },
    buildingOptions: { maxDistance: 1900 },
    networkOptions: { ribbonDistance: 1400, moverDistance: 2600, maxMovers: 1400 },
  },
  high: {
    gridN: 20,
    maxDepth: 7,
    baseRange: 1700,
    lightmapSize: 1024,
    detail: 1,
    pixelRatio: 2,
    treeOptions: { radius: 1150, spacing: 15, maxInstances: 5200 },
    buildingOptions: { maxDistance: 2800 },
    networkOptions: { ribbonDistance: 2000, moverDistance: 3600, maxMovers: 4200 },
  },
};

const state = { ready: false };
window.WINDWARD = state;

const hud = new Hud(uiRoot);
const offline = new Offline();
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobile,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
// The custom shaders tone-map and encode themselves; see OUTPUT in shaders/lib.js.
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 4, 90000);

let baseFov = 60;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // Portrait phones are narrow. Holding the horizontal field of view roughly
  // constant means a tall screen gains sky and ground rather than cropping the
  // world down to a letterbox slot.
  const targetH = THREE.MathUtils.degToRad(56);
  baseFov = THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(targetH / 2) / camera.aspect)),
    54,
    86
  );
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
  state.game?.setBaseFov(baseFov);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 150));

async function boot() {
  // The standalone build embeds exactly one region; on the web the URL or the
  // last choice decides.
  const embeddedRegion = window.WINDWARD_REGION ?? null;
  const wantRegion = embeddedRegion ?? params.get('map') ?? store.get('windward.region') ?? DEFAULT_REGION;
  let region = getRegion(wantRegion);

  // A map that is neither downloaded nor reachable cannot be flown, and finding
  // that out four megabytes into the loading bar is the worst way to learn it.
  // The probe is the region's own metadata file — a kilobyte, and the very next
  // thing the heightfield asks for anyway.
  // Offline play is an enhancement; nothing in it gets to stop the game booting.
  const attached = await offline.attach().catch(() => false);
  let offlineNote = null;
  if (!embeddedRegion && !(await offline.available(region.id))) {
    const spare = offline.cachedRegions().filter((id) => id !== region.id);
    if (!spare.length) {
      blockOffline(region);
      return;
    }
    // Do not persist the fallback: the choice they made still stands for the
    // next time there is a network.
    offlineNote = `No connection — flying ${getRegion(spare[0]).name}, the map on this device`;
    region = getRegion(spare[0]);
  }

  state.region = region;
  document.title = `Windward — ${region.name}`;

  // Before anything loads, so the loading screen names the right place.
  hud.setRegion(region);
  hud.setProgress(0.02, region.loading[0]);
  const hf = await Heightfield.load(
    region.data.terrain,
    (p) => hud.setProgress(p * 0.5, region.loading[0]),
    window.WINDWARD_EMBED ?? null
  );
  await frame();

  hud.setProgress(0.55, region.loading[1]);
  const sky = new Sky(renderer);
  scene.add(sky.mesh);

  let qualityName = params.get('q') || store.get('windward.quality') || (isMobile ? 'med' : 'high');
  if (!QUALITY[qualityName]) qualityName = 'med';
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[qualityName].pixelRatio));
  resize();

  const terrain = new Terrain(renderer, hf, sky, { ...QUALITY[qualityName], urban: region.palette === 'city' });
  scene.add(terrain.group);
  await frame();

  const lakes = createLakes(hf, sky);
  scene.add(lakes.group);

  // Fixed at afternoon for players. Thermals are seeded off the sun, so the
  // hour is not lighting — it is the strength of every column on the map, and
  // the medal ladder is calibrated against one of them: at midday the Oberland
  // Ceiling's gold is 47 s quicker than the best line anyone can fly. ?time=
  // survives for the calibrator and the screenshot tool, which want the sweep.
  const timeName = params.get('time') || 'afternoon';
  sky.setTime(TIME_PRESETS[timeName] ? timeName : 'afternoon');

  hud.setProgress(0.66, region.loading[2]);
  await bakeLight(terrain, 0.66, 0.92);

  hud.setProgress(0.94, region.loading[3]);
  let buildingData = null;
  if (QUALITY[qualityName].buildings !== false) {
    try {
      buildingData = await loadBuildings(region.data.buildings, window.WINDWARD_BUILDINGS ?? null);
    } catch (err) {
      // A browser without DecompressionStream still gets a playable game.
      console.warn('buildings unavailable:', err.message);
    }
  }

  let networkData = null;
  if (QUALITY[qualityName].buildings !== false) {
    try {
      networkData = await loadNetwork(region.data.network, window.WINDWARD_NETWORK ?? null);
    } catch (err) {
      console.warn('network unavailable:', err.message);
    }
  }

  hud.setRegion(region);
  hud.setProgress(0.96, 'checking the wind…');
  const controls = new Controls(uiRoot);
  controls.setVisible(false);
  const audio = new Audio();
  const game = new Game({ renderer, scene, camera, hud, controls, heightfield: hf, sky, terrain, lakes, audio, quality: QUALITY[qualityName], buildingData, networkData, region });
  game.setBaseFov(baseFov);

  const applyLighting = () => {
    const sun = sky.sunRadiance();
    const amb = sky.skyAmbient();
    terrain.setLighting(sun, amb);
    lakes.setLighting(sun, amb);
    game.setLighting(sun, amb);
  };
  applyLighting();

  Object.assign(state, {
    hf,
    sky,
    terrain,
    game,
    renderer,
    camera,
    stats: () => ({
      challenge: game.challenges.active?.def.id ?? null,
      phase: game.state,
      alt: Math.round(game.glider.position.y),
      speed: Math.round(game.glider.airspeed * 3.6),
      vario: +game.glider.varioSmooth.toFixed(2),
      trees: game.trees?.count ?? 0,
      buildingTiles: game.buildings?.built.size ?? 0,
      movers: game.network?.moverCount ?? 0,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      aircraft: game.spec.id,
      crashing: game.wreck.active ? +game.wreck.severity.toFixed(2) : 0,
      build: offline.state.buildId ?? 'none',
      offlineMaps: offline.cachedRegions().join('+') || 'none',
    }),
    offline,
  });

  // ------------------------------------------------------------- input ---
  /**
   * Cross to the other level. A region is a different terrain, a different city
   * and a different sky bake, so the document really does have to be replaced —
   * but the seam is hidden: the destination's loading screen goes up here,
   * before this page is torn down, and the arriving page raises the same one
   * with the same brand on it and finishes the bar.
   */
  function travel(id, { challenge = null, start = false } = {}) {
    if (!id || id === region.id) return;
    store.set('windward.region', id);
    const url = new URL(location.href);
    url.searchParams.set('map', id);
    if (challenge) url.searchParams.set('challenge', challenge);
    else url.searchParams.delete('challenge');
    if (start) url.searchParams.set('start', '1');
    else url.searchParams.delete('start');
    hud.showTransition(getRegion(id));
    // One frame, so the browser paints the destination's loading screen before
    // the navigation freezes this document. Without it the last thing on screen
    // is the menu of the map being left, and the seam shows.
    requestAnimationFrame(() => requestAnimationFrame(() => (location.href = url.toString())));
  }

  hud.onAction = async (action, value, btn) => {
    switch (action) {
      case 'fly':
        // The level select says where. If that is somewhere else, going there
        // is part of pressing Fly rather than a button of its own that had to
        // be found first — the arriving document opens straight into the air.
        if (value && value !== region.id) {
          travel(value, { start: true });
          break;
        }
        audio.start();
        game.startFlight();
        break;
      case 'level':
        hud.selectLevel(value);
        break;
      case 'challenge': {
        const def = findChallenge(value);
        if (!def) break;
        // The level select lists both maps, so half the things on it are not in
        // memory. Pressing one of those is a journey, not an error: hand the
        // challenge id to the next document and it opens straight into it.
        if (regionOfChallenge(value) !== region.id) {
          travel(regionOfChallenge(value), { challenge: value });
          break;
        }
        audio.start();
        game.startChallenge(def);
        break;
      }
      case 'sound':
        selectSegment(btn);
        audio.start();
        audio.setEnabled(value === '1');
        store.set('windward.sound', value);
        break;
      case 'resume':
      case 'pause':
        game.togglePause();
        break;
      case 'menu':
        game.toMenu();
        break;
      case 'restart':
        game.restart();
        break;
      case 'challenge-retry':
        game.retryChallenge();
        break;
      case 'challenge-resume':
        game.resumeFree();
        break;
      case 'challenge-dismiss':
        game.dismissChallenge();
        break;
      case 'quality':
        selectSegment(btn);
        store.set('windward.quality', value);
        hud.toast('Quality changes apply on reload');
        break;
      case 'input':
        if (value === 'tilt') {
          if (!(await controls.enableTilt())) {
            hud.toast('This device will not share its motion sensors', 'bad');
            return;
          }
          controls.recentreTilt();
        } else {
          controls.useTilt = false;
        }
        selectSegment(btn);
        break;
      case 'invert':
        selectSegment(btn);
        controls.invertPitch = value === '1';
        break;
      case 'aircraft':
        // The mesh, the physics and the numbers on the card are all the one
        // spec, so the game swaps the whole aeroplane and re-parks it.
        game.setAircraft(value);
        break;
      case 'offline-download':
        try {
          await offline.download(value);
          hud.toast(`${getRegion(value).name} will fly with no network`);
        } catch (err) {
          hud.toast(`Could not store ${getRegion(value).name}: ${err.message}`, 'bad');
        }
        drawOffline();
        break;
      case 'offline-remove':
        await offline.remove(value);
        hud.toast(`${getRegion(value).name} removed from this device`);
        drawOffline();
        break;
      case 'offline-update':
        await offline.applyUpdate();
        break;
    }
  };

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') game.cycleCamera();
    else if (e.code === 'KeyR' && game.state === 'flying') game.restart();
    else if (e.code === 'Escape' || e.code === 'KeyP') game.togglePause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'flying') game.togglePause();
  });
  // Double-tap for the camera, on the half WITHOUT the stick on it. That was
  // the right; the stick moved there so the trigger and the throttle could go
  // under the left thumb, and this has to move with it — otherwise every quick
  // pair of stick inputs cycles the camera. Taps that land on one of the two
  // controls are not taps on the screen.
  let lastTap = 0;
  addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!t || t.clientX > innerWidth * 0.45 || game.state !== 'flying') return;
    if (e.target?.closest?.('.round-btn, .throttle')) return;
    const now = performance.now();
    if (now - lastTap < 300) game.cycleCamera();
    lastTap = now;
  });

  selectByValue('quality', qualityName);
  const soundPref = store.get('windward.sound', '1');
  audio.setEnabled(soundPref === '1');
  selectByValue('sound', soundPref);

  hud.setProgress(1, 'ready');
  hud.hideLoading();
  if (offlineNote) hud.toast(offlineNote);
  // Arriving with a challenge named in the URL is the other half of travel():
  // the player pressed a row on the level select for a map that was not loaded,
  // and what they asked for was the challenge, not the loading screen.
  const wanted = params.get('challenge');
  const arriving = wanted && regionOfChallenge(wanted) === region.id ? findChallenge(wanted) : null;
  game.toMenu();
  if (arriving) game.startChallenge(arriving);
  else if (params.get('start')) game.startFlight();
  // Both of those are one-shot instructions from the document that sent us
  // here, and they have now been carried out. Leaving them on the address bar
  // means a reload from the menu silently launches a flight nobody asked for,
  // and the map is the only part of the URL worth bookmarking.
  if (wanted || params.get('start')) {
    const clean = new URL(location.href);
    clean.searchParams.delete('challenge');
    clean.searchParams.delete('start');
    history.replaceState(null, '', clean);
  }

  // Only now. Precaching the 2.4 MB shell while the player is still waiting on
  // four megabytes of terrain would make the thing they asked for slower to
  // buy them something they have not asked for yet.
  offline.onChange = drawOffline;
  drawOffline();
  if (offline.supported) {
    offline
      .install()
      .then(() => drawOffline())
      // A shell that installed one second ago cannot be out of date, so the
      // update check only runs for a visit that arrived already installed.
      .then(() => attached && offline.checkForUpdate())
      .then((changed) => changed && hud.toast('A new version is ready — <b>reload</b> to take it'))
      .catch((err) => console.warn('offline unavailable:', err.message));
  }

  // -------------------------------------------------------------- loop ---
  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 120;
  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    state.frames = (state.frames ?? 0) + 1;

    if (game.state === 'menu') {
      game.updateMenuCamera(now / 1000);
      camera.updateMatrixWorld();
      game.update(0);
    } else {
      // Fixed steps keep the flight model stable when a frame hitches.
      acc = Math.min(acc + dt, 0.2);
      while (acc >= STEP) {
        game.update(STEP);
        acc -= STEP;
      }
    }

    sky.update(dt, camera);
    camera.updateMatrixWorld();
    terrain.update(camera, dt);
    lakes.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  state.ready = true;
}

/**
 * There is no map and no network, which is a dead end rather than an error.
 * Say so on the loading screen — there is no world behind it yet to show a
 * menu over — and wire up the one button it needs, since the main action
 * handler is installed much later in boot.
 */
function blockOffline(region) {
  state.blocked = 'offline';
  state.ready = true;
  hud.showOfflineBlock(
    `${region.name} is not stored on this device and there is no network to fetch it from. ` +
      'Connect once, then keep a map with Offline play in the menu.',
    [{ action: 'offline-retry', label: 'Try again', primary: true }]
  );
  hud.onAction = (action) => {
    if (action === 'offline-retry') location.reload();
  };
}

let offlineFrame = 0;
let offlineSpace = null;

/** Repaint the offline shelf. Coalesced, because download progress fires per chunk. */
function drawOffline() {
  if (offlineFrame) return;
  offlineFrame = requestAnimationFrame(async () => {
    offlineFrame = 0;
    if (!offline.supported) {
      hud.setOffline({ note: 'This browser will not store the game for offline play.', maps: [] });
      return;
    }
    // estimate() is not free, and nothing it reports moves mid-download.
    if (!offline.busy) offlineSpace = await offline.storage();
    const maps = [];
    for (const { id, name } of offline.regions()) {
      const cached = offline.cached(id);
      const busy = offline.busy === id;
      const size = await offline.sizeOf(id);
      maps.push({
        id,
        name,
        cached,
        busy,
        progress: offline.progress,
        label: busy ? 'downloading…' : cached ? `${formatBytes(size)} · on this device` : formatBytes(size),
      });
    }
    hud.setOffline({
      note: offline.state.buildId
        ? 'The game itself is kept automatically. Download a map and it flies with no network at all.'
        : 'Storing the game on this device…',
      space: offlineSpace?.usage ? `${formatBytes(offlineSpace.usage)} used` : '',
      maps,
      updateReady: offline.updateReady,
    });
  });
}

function selectByValue(group, value) {
  const btn = uiRoot.querySelector(`[data-group="${group}"] [data-value="${value}"]`);
  if (btn) selectSegment(btn);
}

function selectSegment(btn) {
  const group = btn.closest('.segmented');
  if (!group) return;
  for (const b of group.children) b.classList.toggle('on', b === btn);
}

async function bakeLight(terrain, from = 0, to = 0) {
  for (const p of terrain.bakeLightmap(8)) {
    if (to > from) hud.setProgress(from + (to - from) * p);
    await frame();
  }
}

function frame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

boot().catch((err) => {
  console.error(err);
  state.error = String(err?.stack ?? err);
  hud.setProgress(1, 'something went wrong — see the console');
});
