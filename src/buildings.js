import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { makeLitMaterial } from './materials.js';

/**
 * Every building in the region, from OpenStreetMap.
 *
 * Footprints, positions and orientations are surveyed data — 42,372 of them,
 * so Interlaken has its actual street grid and the barns above Grindelwald
 * stand in their actual fields. Heights are inferred: OSM carries a height tag
 * for 46 of these, so the rest come from building type and footprint area.
 *
 * Buildings are bucketed into a kilometre grid and each tile's geometry is
 * merged and built on demand, one tile per frame, then thrown away when it
 * falls out of range. Building all of them eagerly would be tens of megabytes
 * of vertex data for a view that only ever shows a valley's worth.
 */

const TILE = 1000;

/** Wall and roof albedo per building type id, matching the baker's table. */
const PALETTE = {
  wall: [
    [0.115, 0.086, 0.056], // 0 unspecified — weathered timber
    [0.062, 0.042, 0.028], // 1 barn / farm
    [0.135, 0.100, 0.065], // 2 shed / garage
    [0.150, 0.120, 0.082], // 3 house / cabin
    [0.400, 0.385, 0.350], // 4 church — rendered white
    [0.330, 0.315, 0.290], // 5 apartments / hotel / civic
    [0.230, 0.230, 0.225], // 6 industrial
    [0.280, 0.270, 0.250], // 7 open roof / greenhouse
  ],
  roof: [
    [0.040, 0.036, 0.034],
    [0.048, 0.045, 0.044],
    [0.055, 0.048, 0.042],
    [0.062, 0.028, 0.020], // warm tile
    [0.032, 0.032, 0.036],
    [0.038, 0.037, 0.038],
    [0.070, 0.070, 0.072],
    [0.058, 0.056, 0.052],
  ],
};

/** Decompress and parse the baked footprint file. */
export async function loadBuildings(url = 'data/buildings.bin.gz', embedded = null) {
  let buffer;
  if (embedded) {
    const bin = atob(embedded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buffer = await gunzip(bytes);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`buildings: HTTP ${res.status}`);
    buffer = await gunzip(new Uint8Array(await res.arrayBuffer()));
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'WBLD') throw new Error('buildings: bad file');
  const count = view.getUint32(8, true);

  const origin = new Int16Array(count * 2);
  const wallH = new Float32Array(count);
  const roofH = new Float32Array(count);
  const angle = new Float32Array(count);
  const style = new Uint8Array(count);
  const first = new Uint32Array(count + 1);

  // one pass to read headers, collecting corner offsets as we go
  let o = 12;
  const corners = [];
  for (let i = 0; i < count; i++) {
    origin[i * 2] = view.getInt16(o, true);
    origin[i * 2 + 1] = view.getInt16(o + 2, true);
    wallH[i] = view.getUint16(o + 4, true) / 10;
    roofH[i] = view.getUint16(o + 6, true) / 10;
    angle[i] = (view.getInt16(o + 8, true) * Math.PI) / 10000;
    const n = view.getUint8(o + 10);
    style[i] = view.getUint8(o + 11);
    o += 12;
    first[i] = corners.length / 2;
    for (let k = 0; k < n; k++) {
      corners.push(view.getInt16(o, true) / 100, view.getInt16(o + 2, true) / 100);
      o += 4;
    }
  }
  first[count] = corners.length / 2;

  return { count, origin, wallH, roofH, angle, style, first, corners: Float32Array.from(corners) };
}

async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('buildings: no DecompressionStream');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Buildings {
  constructor(heightfield, sky, data, places, { maxDistance = 2600, tileBudget = 1 } = {}) {
    this.hf = heightfield;
    this.data = data;
    this.maxDistance = maxDistance;
    this.tileBudget = tileBudget;
    this.group = new THREE.Group();
    this.material = makeBuildingMaterial(sky);
    this.tiles = new Map();
    this.built = new Map();
    this._pending = [];

    this.#bucket();
    this.#buildLandmarks(sky, places);
  }

  #bucket() {
    const { count, origin } = this.data;
    for (let i = 0; i < count; i++) {
      const key = `${Math.floor(origin[i * 2] / TILE)},${Math.floor(origin[i * 2 + 1] / TILE)}`;
      let list = this.tiles.get(key);
      if (!list) this.tiles.set(key, (list = []));
      list.push(i);
    }
  }

  update(cameraPosition) {
    const r = this.maxDistance;
    const cx = Math.floor(cameraPosition.x / TILE);
    const cz = Math.floor(cameraPosition.z / TILE);
    const span = Math.ceil(r / TILE);

    const wanted = new Set();
    for (let j = cz - span; j <= cz + span; j++) {
      for (let i = cx - span; i <= cx + span; i++) {
        const key = `${i},${j}`;
        if (!this.tiles.has(key)) continue;
        // nearest point of the tile to the camera
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

    // Build at most a tile per frame; a valley-floor tile is thousands of
    // buildings and doing several at once shows up as a stutter.
    let budget = this.tileBudget;
    for (const key of wanted) {
      if (budget <= 0) break;
      if (this.built.has(key)) continue;
      const mesh = this.#buildTile(key);
      if (mesh) {
        this.built.set(key, mesh);
        this.group.add(mesh);
      }
      budget--;
    }
  }

  #buildTile(key) {
    const ids = this.tiles.get(key);
    if (!ids || !ids.length) return null;
    const d = this.data;
    const hf = this.hf;

    const pos = [];
    const nrm = [];
    const style = [];
    let minY = Infinity;
    let maxY = -Infinity;

    const ring = [];
    for (const id of ids) {
      const ox = d.origin[id * 2];
      const oz = d.origin[id * 2 + 1];
      const start = d.first[id];
      const n = d.first[id + 1] - start;
      if (n < 3) continue;

      ring.length = 0;
      let groundMin = Infinity;
      let groundMax = -Infinity;
      for (let k = 0; k < n; k++) {
        const x = ox + d.corners[(start + k) * 2];
        const z = oz + d.corners[(start + k) * 2 + 1];
        ring.push(x, z);
        const g = hf.heightAt(x, z);
        if (g < groundMin) groundMin = g;
        if (g > groundMax) groundMax = g;
      }

      // A real building has a level floor: set it at the uphill ground and let
      // the walls run down into the slope on the downhill side.
      const base = groundMin - 1.2;
      const eaves = groundMax + d.wallH[id];
      const typeId = d.style[id] & 0x0f;
      const gabled = (d.style[id] >> 4) === 1;

      emitWalls(pos, nrm, style, ring, n, base, eaves, typeId);
      if (gabled && d.roofH[id] > 0.4) {
        emitGableRoof(pos, nrm, style, ring, n, eaves, d.roofH[id], d.angle[id], typeId);
      } else {
        emitFlatRoof(pos, nrm, style, ring, n, eaves + 0.35, typeId);
      }

      if (base < minY) minY = base;
      if (eaves + d.roofH[id] > maxY) maxY = eaves + d.roofH[id];
    }
    if (!pos.length) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geom.setAttribute('aStyle', new THREE.Float32BufferAttribute(style, 2));

    const [ti, tj] = key.split(',').map(Number);
    geom.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(ti * TILE + TILE / 2, (minY + maxY) / 2, tj * TILE + TILE / 2),
      Math.hypot(TILE, maxY - minY, TILE) * 0.72
    );

    const mesh = new THREE.Mesh(geom, this.material);
    mesh.renderOrder = 11;
    mesh.name = `buildings:${key}`;
    return mesh;
  }

  /**
   * The two structures the region is known by, which no footprint conveys: the
   * Sphinx observatory above Jungfraujoch and Piz Gloria on the Schilthorn.
   * Their OSM outlines are dropped at bake time so nothing is drawn twice.
   */
  #buildLandmarks(sky, places) {
    const concrete = makeLitMaterial(sky, { color: new THREE.Color(0.36, 0.36, 0.35), roughness: 0.72, fresnel: 0.15 });
    const glass = makeLitMaterial(sky, {
      color: new THREE.Color(0.06, 0.1, 0.13),
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
      const base = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 9, 16), concrete);
      base.position.y = 2;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(13, 11, 7, 16), glass);
      drum.position.y = 8;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 14, 6), concrete);
      mast.position.y = 18;
      g.add(base, drum, mast);
      g.position.set(schilthorn.x, this.hf.heightAt(schilthorn.x, schilthorn.z) - 3, schilthorn.z);
      this.group.add(g);
    }
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of [this.material, ...(this.landmarkMaterials ?? [])]) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }
}

// --------------------------------------------------------------- geometry ---
function push(pos, nrm, style, x, y, z, nx, ny, nz, typeId, part) {
  pos.push(x, y, z);
  nrm.push(nx, ny, nz);
  style.push(typeId, part);
}

function emitWalls(pos, nrm, style, ring, n, base, top, typeId) {
  for (let k = 0; k < n; k++) {
    const ax = ring[k * 2];
    const az = ring[k * 2 + 1];
    const j = (k + 1) % n;
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const len = Math.hypot(ex, ez);
    if (len < 0.05) continue;
    // ring is wound counter-clockwise, so this points out of the wall
    const nx = ez / len;
    const nz = -ex / len;
    push(pos, nrm, style, ax, base, az, nx, 0, nz, typeId, 0);
    push(pos, nrm, style, bx, base, bz, nx, 0, nz, typeId, 0);
    push(pos, nrm, style, bx, top, bz, nx, 0, nz, typeId, 0);
    push(pos, nrm, style, ax, base, az, nx, 0, nz, typeId, 0);
    push(pos, nrm, style, bx, top, bz, nx, 0, nz, typeId, 0);
    push(pos, nrm, style, ax, top, az, nx, 0, nz, typeId, 0);
  }
}

function emitFlatRoof(pos, nrm, style, ring, n, y, typeId) {
  for (const [a, b, c] of earcut(ring, n)) {
    push(pos, nrm, style, ring[a * 2], y, ring[a * 2 + 1], 0, 1, 0, typeId, 1);
    push(pos, nrm, style, ring[b * 2], y, ring[b * 2 + 1], 0, 1, 0, typeId, 1);
    push(pos, nrm, style, ring[c * 2], y, ring[c * 2 + 1], 0, 1, 0, typeId, 1);
  }
}

/**
 * Gabled roof over the footprint's principal axis, with an eaves overhang.
 * The ridge runs along the long side, which is what a real alpine roof does.
 */
function emitGableRoof(pos, nrm, style, ring, n, eaves, height, angle, typeId) {
  let ux = Math.cos(angle);
  let uz = Math.sin(angle);
  let ext = extents(ring, n, ux, uz);
  // The ridge runs the long way. If the principal axis came out across the
  // building, turn the frame a quarter turn rather than roofing it sideways.
  if (ext.uMax - ext.uMin < ext.vMax - ext.vMin) {
    ux = Math.cos(angle + Math.PI / 2);
    uz = Math.sin(angle + Math.PI / 2);
    ext = extents(ring, n, ux, uz);
  }

  const over = 0.45;
  const uMin = ext.uMin - over;
  const uMax = ext.uMax + over;
  const vMin = ext.vMin - over;
  const vMax = ext.vMax + over;
  const vMid = (vMin + vMax) / 2;

  const P = (u, v, y) => [u * ux - v * uz, y, u * uz + v * ux];
  const a = P(uMin, vMin, eaves);
  const b = P(uMax, vMin, eaves);
  const c = P(uMax, vMax, eaves);
  const d = P(uMin, vMax, eaves);
  const r0 = P(uMin, vMid, eaves + height);
  const r1 = P(uMax, vMid, eaves + height);

  const slope = height / Math.max((vMax - vMin) / 2, 0.1);
  const inv = 1 / Math.hypot(1, slope);
  const nearN = [uz * slope * inv, inv, -ux * slope * inv];
  const farN = [-uz * slope * inv, inv, ux * slope * inv];

  const quad = (p0, p1, p2, p3, nv) => {
    push(pos, nrm, style, ...p0, ...nv, typeId, 1);
    push(pos, nrm, style, ...p1, ...nv, typeId, 1);
    push(pos, nrm, style, ...p2, ...nv, typeId, 1);
    push(pos, nrm, style, ...p0, ...nv, typeId, 1);
    push(pos, nrm, style, ...p2, ...nv, typeId, 1);
    push(pos, nrm, style, ...p3, ...nv, typeId, 1);
  };
  quad(a, b, r1, r0, nearN);
  quad(c, d, r0, r1, farN);

  // gable ends take the wall colour, the way rendered or boarded ends do
  push(pos, nrm, style, ...a, -ux, 0, -uz, typeId, 0);
  push(pos, nrm, style, ...r0, -ux, 0, -uz, typeId, 0);
  push(pos, nrm, style, ...d, -ux, 0, -uz, typeId, 0);
  push(pos, nrm, style, ...b, ux, 0, uz, typeId, 0);
  push(pos, nrm, style, ...c, ux, 0, uz, typeId, 0);
  push(pos, nrm, style, ...r1, ux, 0, uz, typeId, 0);
}

function extents(ring, n, ux, uz) {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let k = 0; k < n; k++) {
    const x = ring[k * 2];
    const z = ring[k * 2 + 1];
    const u = x * ux + z * uz;
    const v = -x * uz + z * ux;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  return { uMin, uMax, vMin, vMax };
}

/** Ear clipping for a simple counter-clockwise polygon. */
function earcut(ring, n) {
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 16) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      const ax = ring[a * 2];
      const az = ring[a * 2 + 1];
      const bx = ring[b * 2];
      const bz = ring[b * 2 + 1];
      const cx = ring[c * 2];
      const cz = ring[c * 2 + 1];
      // convex corner in a CCW ring
      if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) <= 0) continue;
      let contains = false;
      for (const p of idx) {
        if (p === a || p === b || p === c) continue;
        if (pointInTriangle(ring[p * 2], ring[p * 2 + 1], ax, az, bx, bz, cx, cz)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate ring; take what we have
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function pointInTriangle(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const posv = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && posv);
}

// --------------------------------------------------------------- material ---
function makeBuildingMaterial(sky) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...sky.uniforms,
      uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
      uWall: { value: PALETTE.wall.flat() },
      uRoof: { value: PALETTE.roof.flat() },
    },
    vertexShader: /* glsl */ `
      in vec2 aStyle;   // x = building type, y = 0 wall / 1 roof
      out vec3 vWorld;
      out vec3 vNormal;
      out vec2 vStyle;
      void main(){
        vWorld = position;
        vNormal = normal;
        vStyle = aStyle;
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
      uniform vec3 uWall[${PALETTE.wall.length}];
      uniform vec3 uRoof[${PALETTE.roof.length}];
      in vec3 vWorld;
      in vec3 vNormal;
      in vec2 vStyle;
      out vec4 fragColor;

      void main(){
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        vec3 n = normalize(vNormal);

        int t = int(vStyle.x + 0.5);
        bool roof = vStyle.y > 0.5;
        vec3 albedo = roof ? uRoof[t] : uWall[t];
        // no two houses in a village are quite the same shade
        float jitter = hash12(floor(vWorld.xz * 0.08)) * 0.36 + 0.82;
        albedo *= jitter;

        float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
        vec3 col = albedo * uSunRadiance * ndl;
        col += albedo * uSkyAmbient * (0.38 + 0.55 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0));

        vec3 h = normalize(uSunDir - vdir);
        float gloss = roof ? 0.30 : 0.10;
        col += uSunRadiance * pow(clamp(dot(n, h), 0.0, 1.0), 34.0) * gloss * 0.12;

        col = aerial(col, dist, vdir, vWorld.y, uSunDir);
        fragColor = outputColor(col, 1.0);
      }
    `,
  });
}
