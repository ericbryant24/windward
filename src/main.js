import * as THREE from '../vendor/three.module.js';
import { Heightfield } from './heightfield.js';
import { Sky, TIME_PRESETS } from './sky.js';
import { Terrain } from './terrain.js';
import { createLakes } from './water.js';
import { Hud } from './hud.js';
import { Controls } from './controls.js';
import { Game } from './game.js';
import { Audio } from './audio.js';

const canvas = document.getElementById('view');
const uiRoot = document.getElementById('ui');
const params = new URLSearchParams(location.search);
const isMobile =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;

const QUALITY = {
  low: { gridN: 12, maxDepth: 7, baseRange: 1400, lightmapSize: 512, detail: 0, pixelRatio: 1, trees: false },
  med: {
    gridN: 16,
    maxDepth: 7,
    baseRange: 1400,
    lightmapSize: 768,
    detail: 1,
    pixelRatio: 1.5,
    treeOptions: { radius: 500, spacing: 17, maxInstances: 1600 },
  },
  high: {
    gridN: 20,
    maxDepth: 7,
    baseRange: 1700,
    lightmapSize: 1024,
    detail: 1,
    pixelRatio: 2,
    treeOptions: { radius: 700, spacing: 14, maxInstances: 3200 },
  },
};

const state = { ready: false };
window.WINDWARD = state;

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
  hud.setProgress(0.02, 'reading the terrain…');
  const hf = await Heightfield.load('data/jungfrau.png', (p) =>
    hud.setProgress(p * 0.5, 'reading the terrain…')
  );
  await frame();

  hud.setProgress(0.55, 'raising the Bernese Alps…');
  const sky = new Sky(renderer);
  scene.add(sky.mesh);

  let qualityName = params.get('q') || localStorage.getItem('windward.quality') || (isMobile ? 'med' : 'high');
  if (!QUALITY[qualityName]) qualityName = 'med';
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[qualityName].pixelRatio));
  resize();

  const terrain = new Terrain(renderer, hf, sky, QUALITY[qualityName]);
  scene.add(terrain.group);
  await frame();

  const lakes = createLakes(hf, sky);
  scene.add(lakes.group);

  const timeName = params.get('time') || localStorage.getItem('windward.time') || 'afternoon';
  sky.setTime(TIME_PRESETS[timeName] ? timeName : 'afternoon');

  hud.setProgress(0.66, 'tracing the shadows…');
  await bakeLight(terrain, 0.66, 0.92);

  hud.setProgress(0.94, 'checking the wind…');
  const controls = new Controls(uiRoot);
  controls.setVisible(false);
  const audio = new Audio();
  const game = new Game({ renderer, scene, camera, hud, controls, heightfield: hf, sky, terrain, lakes, audio, quality: QUALITY[qualityName] });
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
        localStorage.setItem('windward.sound', value);
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
        localStorage.setItem('windward.time', value);
        hud.toast(`${TIME_PRESETS[value].name} — re-lighting…`);
        await frame();
        await bakeLight(terrain);
        applyLighting();
        game.reseedAir();
        break;
      }
      case 'quality':
        selectSegment(btn);
        localStorage.setItem('windward.quality', value);
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
  const soundPref = localStorage.getItem('windward.sound') ?? '1';
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
