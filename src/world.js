import * as THREE from '../vendor/three.module.js';
import { makeLitMaterial } from './materials.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { mulberry32 } from './flight.js';

import { PLACES } from './regions.js';

export class World {
  constructor(heightfield, sky, scene, regionId = 'jungfrau') {
    this.hf = heightfield;
    this.sky = sky;
    this.scene = scene;
    this.regionId = regionId;
    this.mpdLon = 111320 * Math.cos((heightfield.meta.centerLat * Math.PI) / 180);

    this.places = (PLACES[regionId] ?? []).map((p) => {
      const v = this.toLocal(p.lat, p.lon);
      return { ...p, x: v.x, z: v.z, y: heightfield.heightAt(v.x, v.z) };
    });

    this.gates = [];
    this.group = new THREE.Group();
    scene.add(this.group);

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

    this.group.visible = false;
  }

  toLocal(lat, lon) {
    const meta = this.hf.meta;
    return {
      x: (lon - meta.centerLon) * this.mpdLon,
      z: (meta.centerLat - lat) * 111320,
    };
  }

  // ------------------------------------------------------------- gates ---
  /**
   * Lay out a run of gates. Only one gate course exists at a time and it always
   * belongs to a running challenge, so it is built when that challenge arms and
   * torn down when it ends — there is no standing course to go back to.
   *
   * Every course is a run rather than a lap: both of the long ones descend the
   * region end to end, and the short ones never did loop.
   */
  setCourse(defs, courseId = null) {
    for (const g of this.gates) {
      this.group.remove(g.mesh);
      g.mesh.geometry.dispose();
    }
    this.gates.length = 0;
    this.courseId = courseId;

    const points = defs.map((g) => {
      const v = this.toLocal(g.lat, g.lon);
      const ground = this.hf.heightAt(v.x, v.z);
      return { ...g, x: v.x, z: v.z, y: ground + g.agl };
    });

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // No wrap-around, so each end takes its heading from the single
      // neighbour it has.
      const next = points[Math.min(i + 1, points.length - 1)];
      const prev = points[Math.max(i - 1, 0)];
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

  /** No course at all: what the sky looks like when you are just flying. */
  clearCourse() {
    if (this.gates.length) this.setCourse([]);
    this.group.visible = false;
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

  update(dt) {
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
      ${OUTPUT}
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
        fragColor = outputColor(col, a * 0.92);
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
