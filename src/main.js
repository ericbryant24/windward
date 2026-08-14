import * as THREE from '../vendor/three.module.js';
import { Heightfield } from './heightfield.js';
import { Sky, TIME_PRESETS } from './sky.js';
import { Terrain } from './terrain.js';
import { createLakes } from './water.js';

const canvas = document.getElementById('view');

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobile,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 2 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 5, 90000);

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // Portrait phones are narrow: widen the vertical FOV so the horizon and the
  // ground ahead both stay in frame instead of squeezing to a letterbox.
  const targetH = THREE.MathUtils.degToRad(52);
  const fov = 2 * Math.atan(Math.tan(targetH / 2) / camera.aspect);
  camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(fov), 52, 84);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const state = {};
window.WINDWARD = state;

async function boot() {
  const hf = await Heightfield.load('data/jungfrau.png', () => {});
  state.hf = hf;

  const debug = params.get('debug') || '';
  const sky = new Sky(renderer);
  sky.setTime(params.get('time') || 'afternoon');
  if (debug !== 'nosky') scene.add(sky.mesh);
  else scene.background = new THREE.Color(1, 0, 1);

  const quality = isMobile
    ? { gridN: 14, maxDepth: 7, baseRange: 900, lightmapSize: 768, detail: 1 }
    : { gridN: 16, maxDepth: 7, baseRange: 900, lightmapSize: 1024, detail: 1 };
  const terrain = new Terrain(renderer, hf, sky, quality);
  scene.add(terrain.group);

  if (debug === 'node') {
    for (const m of terrain.meshes) {
      m.mat.vertexShader = m.mat.vertexShader.replace('out float vDist;', 'out float vDist;\nout vec3 vNodeId;');
      m.mat.vertexShader = m.mat.vertexShader.replace(
        'vDist = distance(cameraPosition, vWorld);',
        'vDist = distance(cameraPosition, vWorld);\n  vNodeId = vec3(hash12(aNode.xy * 0.01), hash12(aNode.xy * 0.01 + 7.3), hash12(aNode.xy * 0.01 + 19.1));'
      );
      m.mat.fragmentShader = m.mat.fragmentShader.replace('in float vDist;', 'in float vDist;\nin vec3 vNodeId;');
      m.mat.fragmentShader = m.mat.fragmentShader.replace(
        'fragColor = vec4(col * uExposure, 1.0);',
        'fragColor = vec4(vNodeId * (0.4 + 0.6 * vMorph), 1.0);'
      );
      m.mat.needsUpdate = true;
    }
  }

  if (debug === 'lod') {
    for (const m of terrain.meshes) {
      const c = new THREE.Color().setHSL((m.level * 0.17) % 1, 0.75, 0.5);
      m.mat.fragmentShader = m.mat.fragmentShader.replace(
        'fragColor = vec4(col * uExposure, 1.0);',
        `fragColor = vec4(vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}) * (0.35 + 0.65 * vMorph), 1.0);`
      );
      m.mat.needsUpdate = true;
    }
  }

  const lakes = createLakes(hf, sky);
  scene.add(lakes.group);

  for (const _ of terrain.bakeLightmap(8)) {
    /* baked synchronously at boot for now */
  }

  const sunRad = sky.sunRadiance();
  const amb = sky.skyAmbient();
  terrain.setLighting(sunRad, amb);
  lakes.setLighting(sunRad, amb);

  state.sky = sky;
  state.terrain = terrain;
  state.lakes = lakes;
  state.camera = camera;
  state.scene = scene;
  state.renderer = renderer;

  // debug camera: ?cam=x,y,z&look=x,y,z
  const cam = (params.get('cam') || '2600,2600,3200').split(',').map(Number);
  const look = (params.get('look') || '1500,2200,-2000').split(',').map(Number);
  camera.position.set(cam[0], cam[1], cam[2]);
  camera.lookAt(look[0], look[1], look[2]);

  resize();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    camera.updateMatrixWorld();
    sky.update(dt, camera);
    terrain.update(camera, dt);
    lakes.update(dt);
    renderer.render(scene, camera);
    state.frames = (state.frames || 0) + 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  state.ready = true;
}

boot().catch((err) => {
  console.error(err);
  state.error = String(err && err.stack ? err.stack : err);
  document.getElementById('ui').textContent = String(err);
});
