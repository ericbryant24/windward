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
import { Audio } from './audio.js';

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
    networkOptions: { ribbonDistance: 1400, moverDistance: 2600 },
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
    networkOptions: { ribbonDistance: 2000, moverDistance: 3600 },
  },
};

const state = { ready: false };
window.WINDWARD = state;

// Sandboxed frames and private browsing can make storage throw on access, not
// just on write, so every read goes through here too.
const store = {
  get(key, fallback = null) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* preferences just will not persist */
    }
  },
};

const hud = new Hud(uiRoot);
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
  const region = getRegion(wantRegion);
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

  const timeName = params.get('time') || store.get('windward.time') || 'afternoon';
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
      mode: game.mode,
      phase: game.state,
      alt: Math.round(game.glider.position.y),
      speed: Math.round(game.glider.airspeed * 3.6),
      vario: +game.glider.varioSmooth.toFixed(2),
      score: Math.round(game.score),
      trees: game.trees?.count ?? 0,
      buildingTiles: game.buildings?.built.size ?? 0,
      movers: game.network?.moverCount ?? 0,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    }),
  });

  // ------------------------------------------------------------- input ---
  hud.onAction = async (action, value, btn) => {
    switch (action) {
      case 'start':
        audio.start();
        game.startMode(value);
        break;
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
        game.startMode(game.mode);
        break;
      case 'time': {
        selectSegment(btn);
        sky.setTime(value);
        store.set('windward.time', value);
        hud.toast(`${TIME_PRESETS[value].name} — re-lighting…`);
        await frame();
        await bakeLight(terrain);
        applyLighting();
        game.reseedAir();
        break;
      }
      case 'quality':
        selectSegment(btn);
        store.set('windward.quality', value);
        hud.toast('Quality changes apply on reload');
        break;
      case 'map': {
        // A region is a different terrain, a different city and a different
        // sky bake. Reloading is honest about that rather than pretending it
        // can be swapped in place.
        if (value === region.id) break;
        selectSegment(btn);
        store.set('windward.region', value);
        const url = new URL(location.href);
        url.searchParams.set('map', value);
        hud.toast(`Loading ${getRegion(value).name}…`);
        location.href = url.toString();
        break;
      }
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
    }
  };

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') game.cycleCamera();
    else if (e.code === 'KeyR' && game.state === 'flying') game.startMode(game.mode);
    else if (e.code === 'Escape' || e.code === 'KeyP') game.togglePause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'flying') game.togglePause();
  });
  let lastTap = 0;
  addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!t || t.clientX < innerWidth * 0.55 || game.state !== 'flying') return;
    const now = performance.now();
    if (now - lastTap < 300) game.cycleCamera();
    lastTap = now;
  });

  selectByValue('time', timeName);
  selectByValue('quality', qualityName);
  const soundPref = store.get('windward.sound', '1');
  audio.setEnabled(soundPref === '1');
  selectByValue('sound', soundPref);

  hud.setProgress(1, 'ready');
  hud.hideLoading();
  const autostart = params.get('start');
  if (autostart) game.startMode(autostart);
  else game.toMenu();

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
