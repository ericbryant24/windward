import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { loadPacked, readMagic } from './binary.js';

/**
 * Roads, tracks, footpaths, railways and aerialways — and the things moving
 * along them.
 *
 * Ribbons are draped on the terrain and bucketed per kilometre tile, built on
 * demand exactly like the buildings. Cables hang between their pylons and are
 * drawn as camera-facing ribbons with a minimum screen width, because a real
 * 40 mm cable is far thinner than a pixel and would strobe in and out of
 * existence otherwise.
 *
 * Trains, cars and cable cars run along the routes the baker chained together,
 * and only exist while the player is near enough to see them.
 */

const TILE = 1000;

const KIND = {
  MAJOR_ROAD: 0,
  MINOR_ROAD: 1,
  TRACK: 2,
  PATH: 3,
  NARROW_GAUGE: 4,
  RAIL: 5,
  FUNICULAR: 6,
  CABLE_CAR: 7,
  CHAIRLIFT: 8,
};

/** Ribbon width in metres, surface colour, and how far out it stays drawn. */
const STYLE = [
  { width: 7.5, colour: [0.055, 0.054, 0.056], range: 1.0 }, // major road
  { width: 5.0, colour: [0.062, 0.060, 0.061], range: 0.85 }, // minor road
  { width: 3.0, colour: [0.115, 0.098, 0.074], range: 0.6 }, // farm track
  { width: 1.3, colour: [0.135, 0.115, 0.088], range: 0.45 }, // footpath
  { width: 3.4, colour: [0.048, 0.044, 0.042], range: 0.9 }, // narrow gauge
  { width: 4.2, colour: [0.045, 0.042, 0.040], range: 1.0 }, // standard gauge
  { width: 3.0, colour: [0.050, 0.046, 0.044], range: 0.8 }, // funicular
];

const MOVERS = {
  [KIND.NARROW_GAUGE]: { speed: 9.5, cars: 3, size: [2.7, 3.4, 15], colour: [0.28, 0.045, 0.035], lift: 1.9, gap: 1.5 },
  [KIND.RAIL]: { speed: 17, cars: 4, size: [3.0, 3.8, 22], colour: [0.10, 0.11, 0.13], lift: 2.1, gap: 1.6 },
  [KIND.FUNICULAR]: { speed: 5, cars: 1, size: [2.8, 3.6, 12], colour: [0.22, 0.09, 0.03], lift: 2.0, gap: 0 },
  [KIND.MAJOR_ROAD]: { speed: 17, cars: 1, size: [1.9, 1.6, 4.4], colour: [0.20, 0.20, 0.22], lift: 0.9, gap: 0, many: 4 },
  [KIND.MINOR_ROAD]: { speed: 11, cars: 1, size: [1.8, 1.6, 4.2], colour: [0.18, 0.18, 0.19], lift: 0.9, gap: 0, many: 2 },
  [KIND.CABLE_CAR]: { speed: 7.5, cars: 1, size: [3.0, 3.2, 4.6], colour: [0.16, 0.05, 0.04], hang: 3.6, many: 2 },
  [KIND.CHAIRLIFT]: { speed: 2.6, cars: 1, size: [1.9, 1.3, 1.5], colour: [0.05, 0.06, 0.09], hang: 2.4, many: 9 },
};

export async function loadNetwork(url = 'data/network.bin.gz', embedded = null) {
  const view = await loadPacked(url, embedded);
  if (readMagic(view) !== 'WNET') throw new Error('network: bad file');
  const wayCount = view.getUint32(8, true);

  const ways = [];
  let o = 16;
  for (let i = 0; i < wayCount; i++) {
    const kind = view.getUint8(o);
    const canMove = view.getUint8(o + 1) === 1;
    const n = view.getUint16(o + 2, true);
    const ox = view.getInt16(o + 4, true);
    const oz = view.getInt16(o + 6, true);
    o += 8;
    const pts = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      pts[k * 2] = ox + view.getInt16(o, true) / 2;
      pts[k * 2 + 1] = oz + view.getInt16(o + 2, true) / 2;
      o += 4;
    }
    ways.push({ kind, canMove, pts });
  }
  return ways;
}

export class Network {
  constructor(heightfield, sky, ways, { ribbonDistance = 1800, moverDistance = 3200 } = {}) {
    this.hf = heightfield;
    this.ways = ways;
    this.ribbonDistance = ribbonDistance;
    this.moverDistance = moverDistance;
    this.group = new THREE.Group();

    this.surfaceMaterial = makeSurfaceMaterial(sky);
    this.cableMaterial = makeCableMaterial(sky);
    this.moverMaterial = makeMoverMaterial(sky);

    this.tiles = new Map();
    this.built = new Map();
    this.#bucketSegments();
    this.#buildAerialways();
    this.#prepareRoutes();
    this.#buildMoverPool();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._scale = new THREE.Vector3();
    this.time = 0;
  }

  // ------------------------------------------------------------ ribbons ---
  /**
   * Bucket by segment rather than by way: a chained road can be kilometres
   * long, and a whole road appearing when its first point comes into range
   * would be worse than the seam between two quads.
   */
  #bucketSegments() {
    for (const way of this.ways) {
      if (way.kind > KIND.FUNICULAR) continue;
      const p = way.pts;
      for (let i = 0; i + 1 < p.length / 2; i++) {
        const mx = (p[i * 2] + p[(i + 1) * 2]) / 2;
        const mz = (p[i * 2 + 1] + p[(i + 1) * 2 + 1]) / 2;
        const key = `${Math.floor(mx / TILE)},${Math.floor(mz / TILE)}`;
        let list = this.tiles.get(key);
        if (!list) this.tiles.set(key, (list = []));
        list.push(way.kind, p[i * 2], p[i * 2 + 1], p[(i + 1) * 2], p[(i + 1) * 2 + 1]);
      }
    }
  }

  #buildTile(key, budgetRange) {
    const list = this.tiles.get(key);
    if (!list) return null;
    const hf = this.hf;
    const pos = [];
    const col = [];
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < list.length; i += 5) {
      const kind = list[i];
      const style = STYLE[kind];
      if (style.range < budgetRange) continue;
      const ax = list[i + 1];
      const az = list[i + 2];
      const bx = list[i + 3];
      const bz = list[i + 4];
      let dx = bx - ax;
      let dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      dx /= len;
      dz /= len;
      // overlap the ends by half a width so bends do not open up a notch
      const ext = style.width * 0.5;
      const x0 = ax - dx * ext;
      const z0 = az - dz * ext;
      const x1 = bx + dx * ext;
      const z1 = bz + dz * ext;
      const hw = style.width / 2;
      const nx = -dz * hw;
      const nz = dx * hw;

      const corners = [
        [x0 - nx, z0 - nz],
        [x1 - nx, z1 - nz],
        [x1 + nx, z1 + nz],
        [x0 + nx, z0 + nz],
      ];
      const ys = corners.map(([x, z]) => hf.heightAt(x, z) + 0.45);
      for (const y of ys) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const quad = (a, b, c) => {
        for (const k of [a, b, c]) {
          pos.push(corners[k][0], ys[k], corners[k][1]);
          col.push(kind);
        }
      };
      // wound so the face points up: these are only ever seen from above
      quad(0, 2, 1);
      quad(0, 3, 2);
    }
    if (!pos.length) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('aKind', new THREE.Float32BufferAttribute(col, 1));
    const [ti, tj] = key.split(',').map(Number);
    geom.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(ti * TILE + TILE / 2, (minY + maxY) / 2, tj * TILE + TILE / 2),
      Math.hypot(TILE, Math.max(maxY - minY, 1), TILE) * 0.72
    );
    const mesh = new THREE.Mesh(geom, this.surfaceMaterial);
    mesh.renderOrder = 12;
    return mesh;
  }

  // ---------------------------------------------------------- aerialways ---
  /**
   * Cable geometry. OSM puts a node at each pylon, so the span between two
   * nodes is a real span: lift both ends to the tower tops and let it sag.
   */
  #buildAerialways() {
    const hf = this.hf;
    const cablePos = [];
    const cableDir = [];
    const pylonPos = [];
    const pylonCol = [];
    this.cables = [];

    for (const way of this.ways) {
      if (way.kind !== KIND.CABLE_CAR && way.kind !== KIND.CHAIRLIFT) continue;
      const n = way.pts.length / 2;
      if (n < 2) continue;
      const towerH = way.kind === KIND.CABLE_CAR ? 17 : 9;
      const tops = [];
      for (let i = 0; i < n; i++) {
        const x = way.pts[i * 2];
        const z = way.pts[i * 2 + 1];
        const ground = hf.heightAt(x, z);
        const isEnd = i === 0 || i === n - 1;
        const h = isEnd ? towerH * 0.55 : towerH;
        tops.push(new THREE.Vector3(x, ground + h, z));
        if (!isEnd || n === 2) {
          pylonPos.push(x, ground, z, x, ground + h, z);
          pylonCol.push(way.kind);
        }
      }

      // sample the sagging cable so it reads as a curve, not a taut wire
      const samples = [];
      for (let i = 0; i + 1 < tops.length; i++) {
        const a = tops[i];
        const b = tops[i + 1];
        const span = a.distanceTo(b);
        const sag = Math.min(span * 0.022, 9);
        const steps = Math.max(2, Math.min(8, Math.round(span / 60)));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          samples.push(
            new THREE.Vector3(
              a.x + (b.x - a.x) * t,
              a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * sag,
              a.z + (b.z - a.z) * t
            )
          );
        }
      }
      samples.push(tops[tops.length - 1]);
      this.cables.push({ kind: way.kind, samples });

      for (let i = 0; i + 1 < samples.length; i++) {
        const a = samples[i];
        const b = samples[i + 1];
        // two triangles per span, widened into a camera-facing ribbon in the shader
        cablePos.push(a.x, a.y, a.z, b.x, b.y, b.z, a.x, a.y, a.z);
        cableDir.push(-1, 1, 1);
        cablePos.push(b.x, b.y, b.z, b.x, b.y, b.z, a.x, a.y, a.z);
        cableDir.push(-1, 1, 1);
      }
    }

    if (cablePos.length) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(cablePos, 3));
      geom.setAttribute('aSide', new THREE.Float32BufferAttribute(cableDir, 1));
      const other = [];
      for (let i = 0; i < cablePos.length; i += 9) {
        // each triangle needs the segment's other end to build its ribbon
        const ax = cablePos[i];
        const ay = cablePos[i + 1];
        const az = cablePos[i + 2];
        const bx = cablePos[i + 3];
        const by = cablePos[i + 4];
        const bz = cablePos[i + 5];
        other.push(bx, by, bz, ax, ay, az, bx, by, bz);
      }
      geom.setAttribute('aOther', new THREE.Float32BufferAttribute(other, 3));
      geom.computeBoundingSphere();
      const mesh = new THREE.Mesh(geom, this.cableMaterial);
      mesh.renderOrder = 13;
      this.group.add(mesh);
    }

    if (pylonPos.length) {
      const geom = new THREE.BufferGeometry();
      const pos = [];
      const kinds = [];
      for (let i = 0; i < pylonPos.length; i += 6) {
        const x = pylonPos[i];
        const y0 = pylonPos[i + 1];
        const y1 = pylonPos[i + 4];
        const z = pylonPos[i + 2];
        const r = 0.6;
        for (let s = 0; s < 3; s++) {
          const a0 = (s / 3) * Math.PI * 2;
          const a1 = ((s + 1) / 3) * Math.PI * 2;
          const p0 = [x + Math.cos(a0) * r, z + Math.sin(a0) * r];
          const p1 = [x + Math.cos(a1) * r, z + Math.sin(a1) * r];
          pos.push(p0[0], y0, p0[1], p1[0], y0, p1[1], p1[0], y1, p1[1]);
          pos.push(p0[0], y0, p0[1], p1[0], y1, p1[1], p0[0], y1, p0[1]);
          for (let k = 0; k < 6; k++) kinds.push(pylonCol[i / 6] ?? KIND.CABLE_CAR);
        }
      }
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geom.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
      geom.computeBoundingSphere();
      const mesh = new THREE.Mesh(geom, this.surfaceMaterial);
      mesh.renderOrder = 12;
      this.group.add(mesh);
    }
  }

  // -------------------------------------------------------------- movers ---
  #prepareRoutes() {
    this.routes = [];
    for (const way of this.ways) {
      if (!way.canMove || !MOVERS[way.kind]) continue;
      const n = way.pts.length / 2;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        cum[i] =
          cum[i - 1] + Math.hypot(way.pts[i * 2] - way.pts[(i - 1) * 2], way.pts[i * 2 + 1] - way.pts[(i - 1) * 2 + 1]);
      }
      const total = cum[n - 1];
      if (total < 60) continue;

      // cable routes carry their sagging samples so cabins hang from the wire
      const cable = this.cables?.find((c) => c.kind === way.kind && near(c.samples[0], way.pts));
      this.routes.push({
        kind: way.kind,
        pts: way.pts,
        cum,
        total,
        cable: cable ?? null,
        mid: new THREE.Vector3(way.pts[(n >> 1) * 2], 0, way.pts[(n >> 1) * 2 + 1]),
        movers: [],
      });
    }
    console.info(`network: ${this.routes.length} routes with traffic`);
  }

  #buildMoverPool() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute('position', box.getAttribute('position'));
    geom.setAttribute('normal', box.getAttribute('normal'));
    geom.setIndex(box.getIndex());
    this.maxMovers = 260;
    this.moverMatrix = new Float32Array(this.maxMovers * 16);
    this.moverColour = new Float32Array(this.maxMovers * 3);
    const m = new THREE.InstancedBufferAttribute(this.moverMatrix, 16);
    const c = new THREE.InstancedBufferAttribute(this.moverColour, 3);
    m.setUsage(THREE.DynamicDrawUsage);
    c.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aMatrix', m);
    geom.setAttribute('aColour', c);
    geom.instanceCount = 0;
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.moverAttr = { m, c };
    this.moverMesh = new THREE.Mesh(geom, this.moverMaterial);
    this.moverMesh.frustumCulled = false;
    this.moverMesh.renderOrder = 14;
    this.group.add(this.moverMesh);
  }

  /** Position along a route: returns the point and the tangent. */
  #sample(route, s, out, tangent) {
    const { pts, cum } = route;
    const n = cum.length;
    let lo = 0;
    let hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = Math.max(cum[hi] - cum[lo], 1e-3);
    const t = Math.min(1, Math.max(0, (s - cum[lo]) / seg));
    const ax = pts[lo * 2];
    const az = pts[lo * 2 + 1];
    const bx = pts[hi * 2];
    const bz = pts[hi * 2 + 1];
    out.set(ax + (bx - ax) * t, 0, az + (bz - az) * t);
    tangent.set(bx - ax, 0, bz - az).normalize();

    if (route.cable) {
      // follow the wire, including its sag
      const samples = route.cable.samples;
      const u = (s / route.total) * (samples.length - 1);
      const i = Math.max(0, Math.min(samples.length - 2, Math.floor(u) || 0));
      const f = u - i;
      const a = samples[i];
      const b = samples[i + 1];
      out.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      tangent.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    } else {
      out.y = this.hf.heightAt(out.x, out.z);
    }
    return out;
  }

  update(dt, cameraPosition) {
    this.time += dt;
    this.#updateRibbons(cameraPosition);
    this.#updateMovers(dt, cameraPosition);
  }

  #updateRibbons(cameraPosition) {
    const r = this.ribbonDistance;
    const cx = Math.floor(cameraPosition.x / TILE);
    const cz = Math.floor(cameraPosition.z / TILE);
    const span = Math.ceil(r / TILE);
    const wanted = new Set();
    for (let j = cz - span; j <= cz + span; j++) {
      for (let i = cx - span; i <= cx + span; i++) {
        const key = `${i},${j}`;
        if (!this.tiles.has(key)) continue;
        const dx = Math.max(i * TILE - cameraPosition.x, 0, cameraPosition.x - (i + 1) * TILE);
        const dz = Math.max(j * TILE - cameraPosition.z, 0, cameraPosition.z - (j + 1) * TILE);
        if (dx * dx + dz * dz > r * r) continue;
        wanted.add(key);
      }
    }
    for (const [key, mesh] of this.built) {
      if (wanted.has(key)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.built.delete(key);
    }
    // Ribbon tiles are cheap compared with a tile of buildings, so a few per
    // frame is fine and the network keeps up with the aircraft.
    let budget = 3;
    for (const key of wanted) {
      if (budget <= 0) break;
      if (this.built.has(key)) continue;
      const mesh = this.#buildTile(key, 0);
      if (mesh) {
        this.built.set(key, mesh);
        this.group.add(mesh);
      }
      budget--;
    }
  }

  #updateMovers(dt, cameraPosition) {
    const far = this.moverDistance;
    let count = 0;
    const pos = this._v;
    const tan = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const m = this._m;
    const q = this._q;

    for (const route of this.routes) {
      const dx = route.mid.x - cameraPosition.x;
      const dz = route.mid.z - cameraPosition.z;
      const near = dx * dx + dz * dz < far * far;
      if (!near) {
        route.movers.length = 0;
        continue;
      }
      const spec = MOVERS[route.kind];
      if (!route.movers.length) {
        const many = spec.many ?? 1;
        for (let i = 0; i < many; i++) {
          route.movers.push({ s: (route.total * (i + 0.5)) / many, dir: i % 2 === 0 ? 1 : -1 });
        }
      }

      for (const mover of route.movers) {
        mover.s += spec.speed * mover.dir * dt;
        if (mover.s > route.total) {
          mover.s = route.total;
          mover.dir = -1;
        } else if (mover.s < 0) {
          mover.s = 0;
          mover.dir = 1;
        }

        for (let carIndex = 0; carIndex < spec.cars; carIndex++) {
          if (count >= this.maxMovers) break;
          const offset = carIndex * (spec.size[2] + (spec.gap ?? 0)) * mover.dir;
          const s = Math.min(route.total, Math.max(0, mover.s - offset));
          this.#sample(route, s, pos, tan);
          const y = spec.hang ? pos.y - spec.hang : pos.y + spec.lift;
          const yaw = Math.atan2(tan.x, tan.z);
          q.setFromAxisAngle(up, yaw);
          this._scale.set(spec.size[0], spec.size[1], spec.size[2]);
          m.compose(pos.set(pos.x, y, pos.z), q, this._scale);
          m.toArray(this.moverMatrix, count * 16);
          this.moverColour[count * 3] = spec.colour[0];
          this.moverColour[count * 3 + 1] = spec.colour[1];
          this.moverColour[count * 3 + 2] = spec.colour[2];
          count++;
        }
      }
    }

    this.moverMesh.geometry.instanceCount = count;
    this.moverAttr.m.needsUpdate = true;
    this.moverAttr.c.needsUpdate = true;
    this.moverCount = count;
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const mat of [this.surfaceMaterial, this.cableMaterial, this.moverMaterial]) {
      mat.uniforms.uSunRadiance.value.copy(sunRadiance);
      mat.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }
}

function near(v, pts) {
  return Math.abs(v.x - pts[0]) < 2 && Math.abs(v.z - pts[1]) < 2;
}

// -------------------------------------------------------------- materials ---
function makeSurfaceMaterial(sky) {
  const colours = STYLE.map((s) => s.colour).flat();
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
    uniforms: {
      ...sky.uniforms,
      uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
      uColours: { value: colours },
    },
    vertexShader: /* glsl */ `
      in float aKind;
      out vec3 vWorld;
      out float vKind;
      void main(){
        vWorld = position;
        vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      uniform vec3 uColours[${STYLE.length}];
      in vec3 vWorld;
      in float vKind;
      out vec4 fragColor;
      void main(){
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        vec3 albedo = uColours[int(vKind + 0.5)];
        albedo *= 0.85 + 0.3 * (fbm(vWorld.xz * 0.6, 2) * 0.5 + 0.5);
        // laid on the ground, so light it as a horizontal surface
        vec3 col = albedo * uSunRadiance * max(uSunDir.y, 0.0) * 0.9;
        col += albedo * uSkyAmbient * 0.85;
        col = aerial(col, dist, vdir, vWorld.y, uSunDir);
        fragColor = outputColor(col, 1.0);
      }
    `,
  });
}

function makeCableMaterial(sky) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    uniforms: {
      ...sky.uniforms,
      uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
    },
    vertexShader: /* glsl */ `
      in float aSide;
      in vec3 aOther;
      out vec3 vWorld;
      void main(){
        vec3 along = normalize(aOther - position);
        vec3 toEye = normalize(cameraPosition - position);
        vec3 side = normalize(cross(along, toEye));
        // hold a minimum apparent thickness or the cable strobes at distance
        float w = max(0.09, distance(cameraPosition, position) * 0.0011);
        vec3 world = position + side * aSide * w;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      in vec3 vWorld;
      out vec4 fragColor;
      void main(){
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 col = vec3(0.030, 0.031, 0.034) * (uSunRadiance * 0.55 + uSkyAmbient);
        col = aerial(col, dist, v / dist, vWorld.y, uSunDir);
        fragColor = outputColor(col, 1.0);
      }
    `,
  });
}

function makeMoverMaterial(sky) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...sky.uniforms,
      uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
    },
    vertexShader: /* glsl */ `
      in mat4 aMatrix;
      in vec3 aColour;
      out vec3 vWorld;
      out vec3 vNormal;
      out vec3 vColour;
      void main(){
        vec4 wp = aMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(aMatrix) * normal);
        vColour = aColour;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      in vec3 vWorld;
      in vec3 vNormal;
      in vec3 vColour;
      out vec4 fragColor;
      void main(){
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        vec3 n = normalize(vNormal);
        float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
        vec3 col = vColour * uSunRadiance * ndl;
        col += vColour * uSkyAmbient * (0.4 + 0.5 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
        vec3 h = normalize(uSunDir - vdir);
        col += uSunRadiance * pow(clamp(dot(n, h), 0.0, 1.0), 48.0) * 0.10;
        col = aerial(col, dist, vdir, vWorld.y, uSunDir);
        fragColor = outputColor(col, 1.0);
      }
    `,
  });
}
