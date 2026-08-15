import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { makeLitMaterial } from './materials.js';

/**
 * Villages and mountain stations.
 *
 * Settlements are placed once at load, one instanced draw per settlement so the
 * frustum can throw away the ones behind you. Chalets sit with their ridge
 * along the contour the way they actually do on a slope, which is most of what
 * makes a scatter of boxes read as a Swiss village rather than a suburb.
 */

/** Where people live, how much of it there is, and what kind of place it is. */
const SETTLEMENTS = [
  { name: 'Interlaken', radius: 1500, count: 320, style: 'town', spread: 1.0 },
  { name: 'Grindelwald', radius: 1000, count: 190, style: 'village', spread: 0.95 },
  { name: 'Lauterbrunnen', radius: 620, count: 105, style: 'village', spread: 0.7 },
  { name: 'Wengen', radius: 470, count: 95, style: 'village', spread: 0.85 },
  { name: 'Mürren', radius: 430, count: 78, style: 'village', spread: 0.8 },
  { name: 'Kleine Scheidegg', radius: 190, count: 16, style: 'station', spread: 0.9 },
  { name: 'Jungfraujoch', radius: 130, count: 7, style: 'station', spread: 0.9 },
];

const PALETTE = {
  // linear albedos: weathered larch through to rendered white
  walls: [
    [0.055, 0.036, 0.024],
    [0.085, 0.058, 0.038],
    [0.30, 0.28, 0.25],
    [0.42, 0.40, 0.36],
    [0.16, 0.13, 0.10],
  ],
  roofs: [
    [0.028, 0.028, 0.030],
    [0.045, 0.044, 0.046],
    [0.090, 0.032, 0.022],
    [0.055, 0.050, 0.045],
  ],
};

export class Buildings {
  constructor(heightfield, sky, places, { maxDistance = 9000 } = {}) {
    this.hf = heightfield;
    this.maxDistance = maxDistance;
    this.group = new THREE.Group();
    this.chunks = [];

    this.material = makeBuildingMaterial(sky);
    const geometry = chaletGeometry();

    for (const spec of SETTLEMENTS) {
      const place = places.find((p) => p.name === spec.name);
      if (!place) continue;
      const chunk = this.#buildSettlement(geometry, place, spec);
      if (chunk) {
        this.chunks.push(chunk);
        this.group.add(chunk.mesh);
      }
    }

    this.#buildLandmarks(sky, places);
  }

  #buildSettlement(geometry, place, spec) {
    const hf = this.hf;
    const rng = mulberry32(hashString(spec.name));
    const nrm = new THREE.Vector3();
    const base = hf.heightAt(place.x, place.z);

    const inst = [];
    let guard = 0;
    while (inst.length < spec.count && guard++ < spec.count * 60) {
      // cluster toward the centre rather than filling a disc evenly
      const a = rng() * Math.PI * 2;
      const r = spec.radius * Math.pow(rng(), 0.62) * spec.spread;
      const x = place.x + Math.cos(a) * r;
      const z = place.z + Math.sin(a) * r;

      const h = hf.heightAt(x, z);
      if (hf.isWater(x, z)) continue;
      // nobody builds on the cliff above the village, or down in the gorge
      if (Math.abs(h - base) > (spec.style === 'town' ? 130 : 240)) continue;
      hf.normalAt(x, z, 30, nrm);
      if (nrm.y < 0.87) continue;
      if (inst.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < 15 * 15)) continue;

      // ridge line follows the contour, which is across the fall line
      const yaw = Math.atan2(nrm.x, -nrm.z) + (rng() - 0.5) * 0.55;
      const big = spec.style === 'town' ? rng() < 0.30 : rng() < 0.10;
      const station = spec.style === 'station';

      const width = station ? 12 + rng() * 16 : big ? 15 + rng() * 11 : 8 + rng() * 6.5;
      const depth = width * (0.62 + rng() * 0.3);
      const height = station ? 8 + rng() * 7 : big ? 12 + rng() * 8 : 6 + rng() * 3.6;

      inst.push({
        x,
        y: h,
        z,
        width,
        depth,
        height,
        yaw,
        // white render for the bigger buildings, timber for the chalets
        wall: big || station ? 2 + Math.floor(rng() * 2) : Math.floor(rng() * 2),
        roof: Math.floor(rng() * PALETTE.roofs.length),
        slope: Math.hypot(nrm.x, nrm.z) / Math.max(nrm.y, 0.2),
      });
    }
    if (!inst.length) return null;

    // one church per real village, on the near side of the centre
    if (spec.style !== 'station') {
      const c = inst[0];
      c.church = true;
      c.width = 9;
      c.depth = 15;
      c.height = 11;
      c.wall = 3;
      c.roof = 0;
    }

    const n = inst.length;
    const posArr = new Float32Array(n * 4);
    const sizeArr = new Float32Array(n * 4);
    const colArr = new Float32Array(n * 4);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    inst.forEach((b, i) => {
      posArr[i * 4] = b.x;
      posArr[i * 4 + 1] = b.y;
      posArr[i * 4 + 2] = b.z;
      posArr[i * 4 + 3] = b.yaw;
      sizeArr[i * 4] = b.width;
      sizeArr[i * 4 + 1] = b.height;
      sizeArr[i * 4 + 2] = b.depth;
      // bury the uphill side so nothing perches on a stilt of air
      sizeArr[i * 4 + 3] = 1.5 + b.slope * Math.max(b.width, b.depth) * 0.6;
      colArr[i * 4] = b.wall;
      colArr[i * 4 + 1] = b.roof;
      colArr[i * 4 + 2] = b.church ? 1 : 0;
      colArr[i * 4 + 3] = 0.82 + (i % 7) * 0.05;
      minX = Math.min(minX, b.x - b.width);
      maxX = Math.max(maxX, b.x + b.width);
      minZ = Math.min(minZ, b.z - b.depth);
      maxZ = Math.max(maxZ, b.z + b.depth);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y + b.height * 2);
    });

    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute('position', geometry.getAttribute('position'));
    geom.setAttribute('normal', geometry.getAttribute('normal'));
    geom.setAttribute('aPart', geometry.getAttribute('aPart'));
    geom.setIndex(geometry.getIndex());
    geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(posArr, 4));
    geom.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizeArr, 4));
    geom.setAttribute('aStyle', new THREE.InstancedBufferAttribute(colArr, 4));
    geom.instanceCount = n;

    const centre = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    geom.boundingSphere = new THREE.Sphere(centre, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);

    const mesh = new THREE.Mesh(geom, this.material);
    mesh.frustumCulled = true;
    mesh.renderOrder = 11;
    mesh.name = `settlement:${spec.name}`;
    return { mesh, centre, name: spec.name };
  }

  /**
   * Two buildings the region is known by: the Sphinx observatory on the ridge
   * above Jungfraujoch, and Piz Gloria's revolving drum on the Schilthorn.
   */
  #buildLandmarks(sky, places) {
    const concrete = makeLitMaterial(sky, {
      color: new THREE.Color(0.36, 0.36, 0.35),
      roughness: 0.72,
      fresnel: 0.15,
    });
    const glass = makeLitMaterial(sky, {
      color: new THREE.Color(0.06, 0.10, 0.13),
      roughness: 0.05,
      fresnel: 0.85,
    });
    this.landmarkMaterials = [concrete, glass];

    const joch = places.find((p) => p.name === 'Jungfraujoch');
    if (joch) {
      const g = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 26, 10), concrete);
      tower.position.y = 13;
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(11, 9, 5, 12), concrete);
      deck.position.y = 28;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
      dome.position.y = 30;
      g.add(tower, deck, dome);
      g.position.set(joch.x, this.hf.heightAt(joch.x, joch.z) - 2, joch.z);
      this.group.add(g);
    }

    const schilthorn = places.find((p) => p.name === 'Schilthorn');
    if (schilthorn) {
      const g = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(13, 11, 7, 16), glass);
      drum.position.y = 8;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 9, 16), concrete);
      base.position.y = 2;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 14, 6), concrete);
      mast.position.y = 18;
      g.add(base, drum, mast);
      g.position.set(schilthorn.x, this.hf.heightAt(schilthorn.x, schilthorn.z) - 3, schilthorn.z);
      this.group.add(g);
    }
  }

  update(cameraPosition) {
    for (const c of this.chunks) {
      c.mesh.visible = c.centre.distanceTo(cameraPosition) < this.maxDistance;
    }
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of [this.material, ...(this.landmarkMaterials ?? [])]) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }
}

/**
 * A chalet: walls plus a gabled roof with eaves, built with flat normals so the
 * faces stay crisp. `aPart` is 0 on the walls and 1 on the roof.
 */
function chaletGeometry() {
  const pos = [];
  const nrm = [];
  const part = [];
  const idx = [];

  const quad = (a, b, c, d, n, p) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
      part.push(p);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (a, b, c, n, p) => {
    const base = pos.length / 3;
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
      part.push(p);
    }
    idx.push(base, base + 1, base + 2);
  };

  // walls: unit box, x/z in [-0.5, 0.5], y from -1 (buried) to 1
  const w = 0.5;
  const y0 = -1;
  const y1 = 1;
  quad([-w, y0, w], [w, y0, w], [w, y1, w], [-w, y1, w], [0, 0, 1], 0);
  quad([w, y0, -w], [-w, y0, -w], [-w, y1, -w], [w, y1, -w], [0, 0, -1], 0);
  quad([w, y0, w], [w, y0, -w], [w, y1, -w], [w, y1, w], [1, 0, 0], 0);
  quad([-w, y0, -w], [-w, y0, w], [-w, y1, w], [-w, y1, -w], [-1, 0, 0], 0);

  // roof: ridge running along X, eaves overhanging on all four sides
  const e = 0.62; // eave half-width
  const ry = 1.0;
  const peak = 1.58;
  const ex = 0.58;
  const s = Math.hypot(peak - ry, e) || 1;
  const nUp = [0, e / s, (peak - ry) / s];
  quad([-ex, ry, e], [ex, ry, e], [ex, peak, 0], [-ex, peak, 0], nUp, 1);
  quad([ex, ry, -e], [-ex, ry, -e], [-ex, peak, 0], [ex, peak, 0], [0, nUp[1], -nUp[2]], 1);
  tri([ex, ry, e], [ex, ry, -e], [ex, peak, 0], [1, 0, 0], 1);
  tri([-ex, ry, -e], [-ex, ry, e], [-ex, peak, 0], [-1, 0, 0], 1);
  // underside of the eaves, so the overhang reads as thickness from below
  quad([-ex, ry, -e], [ex, ry, -e], [ex, ry, e], [-ex, ry, e], [0, -1, 0], 1);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geom.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geom.setIndex(idx);
  return geom;
}

function makeBuildingMaterial(sky) {
  const walls = PALETTE.walls.flat();
  const roofs = PALETTE.roofs.flat();
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...sky.uniforms,
      uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
      uWallColors: { value: walls },
      uRoofColors: { value: roofs },
    },
    vertexShader: /* glsl */ `
      in vec4 aPos;     // xyz = ground position, w = yaw
      in vec4 aSize;    // width, height, depth, how far to bury the base
      in vec4 aStyle;   // wall index, roof index, church flag, shade
      in float aPart;
      out vec3 vWorld;
      out vec3 vNormal;
      out float vPart;
      out vec3 vStyle;

      void main(){
        float church = aStyle.z;
        vec3 p = position;
        // a church keeps a narrow plan and grows a spire instead of a ridge
        if (church > 0.5 && aPart > 0.5) p.y += (p.y - 1.0) * 2.2;

        p.x *= aSize.x;
        p.z *= aSize.z;
        p.y = p.y < 0.0 ? p.y * aSize.w : p.y * aSize.y;

        float c = cos(aPos.w), s = sin(aPos.w);
        mat2 rot = mat2(c, -s, s, c);
        p.xz = rot * p.xz;
        vec3 n = normal;
        n.xz = rot * n.xz;

        vWorld = aPos.xyz + p;
        vNormal = normalize(n);
        vPart = aPart;
        vStyle = vec3(aStyle.x, aStyle.y, aStyle.w);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      uniform vec3 uWallColors[${PALETTE.walls.length}];
      uniform vec3 uRoofColors[${PALETTE.roofs.length}];
      in vec3 vWorld;
      in vec3 vNormal;
      in float vPart;
      in vec3 vStyle;
      out vec4 fragColor;

      void main(){
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        vec3 n = normalize(vNormal);

        vec3 albedo = vPart > 0.5
          ? uRoofColors[int(vStyle.y + 0.5)]
          : uWallColors[int(vStyle.x + 0.5)];
        albedo *= vStyle.z;

        float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
        vec3 col = albedo * uSunRadiance * ndl;
        col += albedo * uSkyAmbient * (0.40 + 0.55 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0));

        vec3 h = normalize(uSunDir - vdir);
        float gloss = vPart > 0.5 ? 0.35 : 0.12;
        col += uSunRadiance * pow(clamp(dot(n, h), 0.0, 1.0), 30.0) * gloss * 0.10;

        col = aerial(col, dist, vdir, vWorld.y, uSunDir);
        fragColor = outputColor(col, 1.0);
      }
    `,
  });
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
