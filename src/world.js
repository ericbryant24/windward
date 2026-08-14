import * as THREE from '../vendor/three.module.js';
import { makeLitMaterial } from './materials.js';
import { NOISE, SKY } from './shaders/lib.js';
import { mulberry32 } from './flight.js';

/**
 * Places in the Jungfrau region, in WGS84. Converted to the game's local metric
 * frame at load, so the map and the labels can never disagree.
 */
export const PLACES = [
  { name: 'Jungfrau', lat: 46.5367, lon: 7.9625, kind: 'peak', height: 4158 },
  { name: 'Mönch', lat: 46.5586, lon: 7.9961, kind: 'peak', height: 4107 },
  { name: 'Eiger', lat: 46.5775, lon: 8.0053, kind: 'peak', height: 3967 },
  { name: 'Wetterhorn', lat: 46.6403, lon: 8.1128, kind: 'peak', height: 3692 },
  { name: 'Schreckhorn', lat: 46.5897, lon: 8.1181, kind: 'peak', height: 4078 },
  { name: 'Schilthorn', lat: 46.5556, lon: 7.8347, kind: 'peak', height: 2970 },
  { name: 'Männlichen', lat: 46.6142, lon: 7.9394, kind: 'peak', height: 2343 },
  { name: 'Schynige Platte', lat: 46.6553, lon: 7.9067, kind: 'peak', height: 2076 },
  { name: 'Niesen', lat: 46.6456, lon: 7.6519, kind: 'peak', height: 2362 },
  { name: 'Jungfraujoch', lat: 46.5474, lon: 7.9806, kind: 'landmark', height: 3454 },
  { name: 'Kleine Scheidegg', lat: 46.5853, lon: 7.9614, kind: 'landmark', height: 2061 },
  { name: 'Staubbach Falls', lat: 46.5906, lon: 7.9058, kind: 'landmark', height: 900 },
  { name: 'Interlaken', lat: 46.686, lon: 7.863, kind: 'town', height: 567 },
  { name: 'Lauterbrunnen', lat: 46.5936, lon: 7.9088, kind: 'town', height: 796 },
  { name: 'Grindelwald', lat: 46.6242, lon: 8.0413, kind: 'town', height: 1034 },
  { name: 'Wengen', lat: 46.6053, lon: 7.9219, kind: 'town', height: 1274 },
  { name: 'Mürren', lat: 46.5586, lon: 7.8925, kind: 'town', height: 1638 },
  { name: 'Thunersee', lat: 46.6805, lon: 7.7365, kind: 'water', height: 558 },
  { name: 'Brienzersee', lat: 46.7245, lon: 7.9705, kind: 'water', height: 564 },
];

/** The race line: down Lauterbrunnen, up to the Joch, around the Eiger, home. */
const CIRCUIT = [
  { name: 'Lauterbrunnen Valley', lat: 46.6019, lon: 7.9088, agl: 260, radius: 100 },
  { name: 'Staubbach Falls', lat: 46.5906, lon: 7.9058, agl: 210, radius: 95 },
  { name: 'Mürren Terrace', lat: 46.5586, lon: 7.8925, agl: 230, radius: 105 },
  { name: 'Sefinental', lat: 46.5411, lon: 7.8681, agl: 320, radius: 115 },
  { name: 'Lauterbrunnen Wall', lat: 46.5453, lon: 7.9236, agl: 420, radius: 120 },
  { name: 'Jungfraujoch', lat: 46.5474, lon: 7.9806, agl: 260, radius: 130 },
  { name: 'Eigergletscher', lat: 46.5747, lon: 7.9739, agl: 300, radius: 120 },
  { name: 'Eiger North Face', lat: 46.5861, lon: 8.0053, agl: 520, radius: 130 },
  { name: 'Grindelwald Basin', lat: 46.6242, lon: 8.0413, agl: 340, radius: 115 },
  { name: 'Männlichen Ridge', lat: 46.6142, lon: 7.9394, agl: 200, radius: 105 },
  { name: 'Wengen', lat: 46.6053, lon: 7.9219, agl: 260, radius: 100 },
];

export class World {
  constructor(heightfield, sky, scene) {
    this.hf = heightfield;
    this.sky = sky;
    this.scene = scene;
    this.mpdLon = 111320 * Math.cos((heightfield.meta.centerLat * Math.PI) / 180);

    this.places = PLACES.map((p) => {
      const v = this.toLocal(p.lat, p.lon);
      return { ...p, x: v.x, z: v.z, y: heightfield.heightAt(v.x, v.z) };
    });

    this.gates = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.#buildGates();
  }

  toLocal(lat, lon) {
    const meta = this.hf.meta;
    return {
      x: (lon - meta.centerLon) * this.mpdLon,
      z: (meta.centerLat - lat) * 111320,
    };
  }

  // ------------------------------------------------------------- gates ---
  #buildGates() {
    this.gateMaterial = makeLitMaterial(this.sky, {
      color: new THREE.Color(0.05, 0.35, 0.55),
      emissive: new THREE.Color(0.15, 0.75, 1.0),
      emissiveStrength: 2.4,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    this.gatePassedMaterial = makeLitMaterial(this.sky, {
      color: new THREE.Color(0.1, 0.14, 0.16),
      emissive: new THREE.Color(0.1, 0.3, 0.22),
      emissiveStrength: 0.25,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });

    const points = CIRCUIT.map((g) => {
      const v = this.toLocal(g.lat, g.lon);
      const ground = this.hf.heightAt(v.x, v.z);
      return { ...g, x: v.x, z: v.z, y: ground + g.agl };
    });

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const next = points[(i + 1) % points.length];
      const prev = points[(i - 1 + points.length) % points.length];
      // face the gate along the course so you fly through, not past
      const dir = new THREE.Vector3(next.x - prev.x, next.y - prev.y, next.z - prev.z).normalize();

      const geom = new THREE.TorusGeometry(p.radius, p.radius * 0.055, 8, 40);
      const mesh = new THREE.Mesh(geom, this.gateMaterial);
      mesh.position.set(p.x, p.y, p.z);
      mesh.lookAt(p.x + dir.x, p.y + dir.y, p.z + dir.z);
      mesh.frustumCulled = true;
      this.group.add(mesh);

      this.gates.push({
        index: i,
        name: p.name,
        position: new THREE.Vector3(p.x, p.y, p.z),
        normal: dir,
        radius: p.radius,
        mesh,
        passed: false,
      });
    }
  }

  resetGates() {
    for (const g of this.gates) {
      g.passed = false;
      g.mesh.material = this.gateMaterial;
      g.mesh.visible = true;
    }
  }

  markGatePassed(gate) {
    gate.passed = true;
    gate.mesh.material = this.gatePassedMaterial;
  }

  /**
   * Did the segment from `a` to `b` cross the gate disc this frame? Testing the
   * swept segment rather than the instantaneous position is what stops a fast
   * pass from tunnelling straight through.
   */
  crossedGate(gate, a, b) {
    const n = gate.normal;
    const p = gate.position;
    const da = (a.x - p.x) * n.x + (a.y - p.y) * n.y + (a.z - p.z) * n.z;
    const db = (b.x - p.x) * n.x + (b.y - p.y) * n.y + (b.z - p.z) * n.z;
    if (da === db || da * db > 0) return null;
    const t = da / (da - db);
    const hx = a.x + (b.x - a.x) * t - p.x;
    const hy = a.y + (b.y - a.y) * t - p.y;
    const hz = a.z + (b.z - a.z) * t - p.z;
    const r = Math.hypot(hx, hy, hz);
    if (r > gate.radius) return null;
    return { offset: r / gate.radius, forward: db > da };
  }

  update(dt, camera) {
    this.gateMaterial.uniforms.uPulse.value += dt * 3.4;
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of [this.gateMaterial, this.gatePassedMaterial]) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }
}

/**
 * Cumulus that mark the working thermals. Each is a cluster of soft sprites at
 * cloudbase — cheap, and it turns "where is the lift" into something you read
 * off the sky instead of the HUD.
 */
export function createThermalClouds(air, sky) {
  const tex = puffTexture();
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...sky.uniforms,
      uMap: { value: tex },
      uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
    },
    vertexShader: /* glsl */ `
      in vec3 aOffset;
      in vec2 aParams;    // x = size, y = shade
      out vec2 vUv;
      out float vShade;
      out vec3 vWorld;
      void main(){
        vUv = uv;
        vShade = aParams.y;
        vec3 centre = aOffset;
        vec3 toEye = normalize(cameraPosition - centre);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toEye));
        vec3 up = cross(toEye, right);
        vec3 world = centre + (right * position.x + up * position.y) * aParams.x;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      uniform sampler2D uMap;
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      in vec2 vUv;
      in float vShade;
      in vec3 vWorld;
      out vec4 fragColor;
      void main(){
        float a = texture(uMap, vUv).r;
        if (a < 0.004) discard;
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        // lit crown, shaded base, and a bright rim toward the sun
        float lit = mix(0.42, 1.0, vShade);
        vec3 col = uSunRadiance * lit * 0.80 + uSkyAmbient * 0.55;
        col += uSunRadiance * pow(clamp(dot(vdir, uSunDir), 0.0, 1.0), 5.0) * 0.35 * a;
        col = aerial(col, dist, vdir, vWorld.y, uSunDir);
        fragColor = vec4(col * uExposure, a * 0.92);
      }
    `,
  });

  const rng = mulberry32(0x9e37);
  const quads = [];
  for (const t of air.thermals) {
    const base = t.top - 60;
    const puffs = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < puffs; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = rng() * t.radius * 1.15;
      quads.push({
        x: t.x + Math.cos(ang) * rad,
        y: base + rng() * 120 + (1 - rad / (t.radius * 1.2)) * 90,
        z: t.z + Math.sin(ang) * rad,
        size: t.radius * (0.55 + rng() * 0.55),
        shade: 0.25 + 0.75 * (i / puffs),
      });
    }
  }
  quads.sort((a, b) => a.y - b.y);

  const geom = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(2, 2);
  geom.setAttribute('position', quad.getAttribute('position'));
  geom.setAttribute('uv', quad.getAttribute('uv'));
  geom.setIndex(quad.getIndex());
  const offsets = new Float32Array(quads.length * 3);
  const params = new Float32Array(quads.length * 2);
  quads.forEach((q, i) => {
    offsets[i * 3] = q.x;
    offsets[i * 3 + 1] = q.y;
    offsets[i * 3 + 2] = q.z;
    params[i * 2] = q.size;
    params[i * 2 + 1] = q.shade;
  });
  geom.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geom.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 2));
  geom.instanceCount = quads.length;
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  mesh.userData.setLighting = (sunRadiance, skyAmbient) => {
    material.uniforms.uSunRadiance.value.copy(sunRadiance);
    material.uniforms.uSkyAmbient.value.copy(skyAmbient);
  };
  return mesh;
}

function puffTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) * 2;
      const dy = (y / size - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      let a = Math.max(0, 1 - r);
      a = a * a * (3 - 2 * a);
      const i = (y * size + x) * 4;
      const v = Math.round(a * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
