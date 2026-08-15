import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { makeLitMaterial } from './materials.js';
import { loadPacked, readMagic } from './binary.js';

/**
 * Every building in the region, from OpenStreetMap.
 *
 * Footprints, positions, orientations and — where the city maps them —
 * building:part setbacks are surveyed data. Heights are surveyed where tagged
 * and inferred otherwise; the split differs enormously by region and is
 * reported in each region's buildings.json.
 *
 * Buildings are bucketed into a kilometre grid and each tile's geometry is
 * merged and built on demand, then thrown away when it falls out of range.
 * Chicago has 104,000 of them, so tiles past the first kilometre drop their
 * smallest buildings and keep the towers: a bungalow at four kilometres is a
 * pixel, but the Loop skyline has to still be there.
 */

const TILE = 1000;
const HIT_CELL = 128;
const hitKey = (x, z) => Math.floor(x / HIT_CELL) * 4096 + Math.floor(z / HIT_CELL);

/** Facade classes, matching the baker's MATERIAL table. */
const MATERIAL = { RENDER: 0, GLASS: 1, STONE: 2, BRICK: 3, CONCRETE: 4, METAL: 5, TIMBER: 6 };

/** Base albedo per facade class. */
const FACADE = [
  [0.185, 0.170, 0.148], // render
  [0.052, 0.068, 0.082], // glass curtain wall — dark, most of its colour is reflection
  [0.235, 0.215, 0.186], // stone / limestone / terracotta
  [0.128, 0.062, 0.046], // brick
  [0.205, 0.200, 0.192], // concrete
  [0.175, 0.180, 0.184], // metal cladding
  [0.135, 0.098, 0.062], // timber
];

/** Roof albedo per facade class. Flat city roofs are tar and gravel. */
const ROOFCOL = [
  [0.042, 0.038, 0.035],
  [0.048, 0.050, 0.054],
  [0.055, 0.052, 0.048],
  [0.050, 0.036, 0.030],
  [0.062, 0.062, 0.062],
  [0.078, 0.080, 0.082],
  [0.052, 0.040, 0.032],
];

/** Alpine wall colours stay keyed to building type, as they were. */
const TYPE_TINT = [
  [0.62, 0.58, 0.52], // 0 unspecified
  [0.34, 0.26, 0.19], // 1 barn / farm
  [0.72, 0.62, 0.46], // 2 shed / garage
  [0.80, 0.70, 0.54], // 3 house / cabin
  [1.35, 1.32, 1.24], // 4 church — rendered white
  [1.10, 1.06, 1.00], // 5 apartments / hotel / civic
  [0.86, 0.86, 0.86], // 6 industrial
  [0.95, 0.92, 0.88], // 7 open roof / greenhouse
];

const ROOF_KIND = {
  FLAT: 0,
  GABLED: 1,
  HIPPED: 2,
  PYRAMIDAL: 3,
  DOME: 4,
  SKILLION: 5,
  MANSARD: 6,
  BARREL: 7,
  SPIRE: 8,
};

/** Decompress and parse the baked footprint file. */
export async function loadBuildings(url, embedded = null) {
  const view = await loadPacked(url, embedded);
  if (readMagic(view) !== 'WBLD') throw new Error('buildings: bad file');
  const format = view.getUint16(4, true);
  if (format !== 2) throw new Error(`buildings: format ${format}, expected 2`);
  const count = view.getUint32(8, true);
  const vertexTotal = view.getUint32(12, true);

  const origin = new Int16Array(count * 2);
  const baseH = new Float32Array(count);
  const wallH = new Float32Array(count);
  const roofH = new Float32Array(count);
  const angle = new Float32Array(count);
  const typeId = new Uint8Array(count);
  const roofKind = new Uint8Array(count);
  const material = new Uint8Array(count);
  const first = new Uint32Array(count + 1);
  const corners = new Float32Array(vertexTotal * 2);
  const radius = new Float32Array(count);

  let o = 16;
  let c = 0;
  for (let i = 0; i < count; i++) {
    origin[i * 2] = view.getInt16(o, true);
    origin[i * 2 + 1] = view.getInt16(o + 2, true);
    baseH[i] = view.getUint16(o + 4, true) / 10;
    wallH[i] = view.getUint16(o + 6, true) / 10;
    roofH[i] = view.getUint16(o + 8, true) / 10;
    angle[i] = (view.getInt16(o + 10, true) * Math.PI) / 10000;
    const n = view.getUint8(o + 12);
    typeId[i] = view.getUint8(o + 13);
    roofKind[i] = view.getUint8(o + 14);
    material[i] = view.getUint8(o + 15);
    o += 16;
    first[i] = c;
    let r2 = 0;
    for (let k = 0; k < n; k++) {
      const px = view.getInt16(o, true) / 20;
      const pz = view.getInt16(o + 2, true) / 20;
      corners[c * 2] = px;
      corners[c * 2 + 1] = pz;
      const d = px * px + pz * pz;
      if (d > r2) r2 = d;
      o += 4;
      c++;
    }
    radius[i] = Math.sqrt(r2);
  }
  first[count] = c;

  return { count, origin, baseH, wallH, roofH, angle, typeId, roofKind, material, first, corners, radius };
}

export class Buildings {
  /**
   * `bands` trades detail for distance: each entry drops buildings shorter than
   * `minHeight` beyond `from` metres. Regions that do not need it pass none and
   * every building is drawn out to maxDistance, as before.
   */
  constructor(
    heightfield,
    sky,
    data,
    places,
    { maxDistance = 2600, tileBudget = 1, bands = [], roofClutter = false, landmarks = null } = {}
  ) {
    this.hf = heightfield;
    this.data = data;
    this.maxDistance = maxDistance;
    this.tileBudget = tileBudget;
    this.bands = bands;
    this.roofClutter = roofClutter;
    this.group = new THREE.Group();
    this.material = makeBuildingMaterial(sky);
    this.tiles = new Map();
    this.built = new Map();

    this.#bucket();
    this.#buildCollisionGrid();
    if (landmarks) this.#buildLandmarks(sky, places, landmarks);
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

  /**
   * A second, much finer grid, for hit tests rather than for drawing.
   *
   * The draw grid is a kilometre across, which in Chicago is five hundred
   * buildings — far too many to test every frame. At 128 m a lookup returns a
   * handful, and since a query checks the 3x3 block around a point, anything
   * whose centre is within 128 m is still found. Buildings wider than that are
   * rare enough to accept.
   */
  #buildCollisionGrid() {
    const d = this.data;
    const { count, origin } = d;
    this.hitGrid = new Map();
    this.colBase = new Float32Array(count);
    this.colTop = new Float32Array(count);
    this.maxTop = -Infinity;

    for (let i = 0; i < count; i++) {
      const ox = origin[i * 2];
      const oz = origin[i * 2 + 1];
      const key = hitKey(ox, oz);
      let list = this.hitGrid.get(key);
      if (!list) this.hitGrid.set(key, (list = []));
      list.push(i);

      // The renderer stands a building on the HIGHEST ground under its
      // footprint, not on its centroid. On an alpine slope those differ by
      // several metres, and taking the centroid would put the collider below
      // the roof you can see.
      const start = d.first[i];
      const n = d.first[i + 1] - start;
      let ground = -Infinity;
      for (let k = 0; k < n; k++) {
        const g = this.hf.heightAt(ox + d.corners[(start + k) * 2], oz + d.corners[(start + k) * 2 + 1]);
        if (g > ground) ground = g;
      }
      // A part with a min_height floats, and flying under one is allowed.
      this.colBase[i] = d.baseH[i] > 0.05 ? ground + d.baseH[i] : ground - 4;
      this.colTop[i] = ground + d.baseH[i] + d.wallH[i] + d.roofH[i];
      if (this.colTop[i] > this.maxTop) this.maxTop = this.colTop[i];
    }
  }

  /**
   * The highest roof near a point. Respawning has to clear it: dropping the
   * player back in at a fixed height above the terrain puts them inside Willis
   * Tower, where they crash again, forever.
   */
  topNear(x, z) {
    let top = -Infinity;
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const list = this.hitGrid?.get(hitKey(x + gx * HIT_CELL, z + gz * HIT_CELL));
        if (!list) continue;
        for (const i of list) if (this.colTop[i] > top) top = this.colTop[i];
      }
    }
    return top;
  }

  /**
   * Does the path from a to b run into a building?
   *
   * Swept rather than instantaneous. The simulation runs at a fixed 1/120 s
   * step, so a single call only ever spans about 0.6 m even at VNE and
   * tunnelling is not the live risk — but the loop runs up to 24 times per
   * rendered frame, which is the real budget, and a swept test costs nothing
   * over a point test at that length. It stays swept so that raising the
   * timestep later cannot silently reintroduce the hole.
   */
  hitSegment(a, b, out = {}) {
    if (!this.hitGrid) return null;
    // Above everything in the region there is nothing to test, and a glider
    // spends most of its life there. One compare beats 216 map lookups.
    if (a.y > this.maxTop && b.y > this.maxTop) return null;
    const d = this.data;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const span = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.min(24, Math.ceil(span / 2.5)));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const pz = a.z + dz * t;

      for (let gx = -1; gx <= 1; gx++) {
        for (let gz = -1; gz <= 1; gz++) {
          const list = this.hitGrid.get(hitKey(px + gx * HIT_CELL, pz + gz * HIT_CELL));
          if (!list) continue;
          for (const i of list) {
            const ox = d.origin[i * 2];
            const oz = d.origin[i * 2 + 1];
            const rx = px - ox;
            const rz = pz - oz;
            const r = d.radius[i];
            if (rx * rx + rz * rz > r * r) continue;

            if (py < this.colBase[i] || py > this.colTop[i]) continue;

            const start = d.first[i];
            const n = d.first[i + 1] - start;
            if (n < 3 || !pointInFootprint(d.corners, start, n, rx, rz)) continue;

            out.x = px;
            out.y = py;
            out.z = pz;
            out.index = i;
            out.top = this.colTop[i];
            out.t = t;
            edgeNormal(d.corners, start, n, rx, rz, out);
            return out;
          }
        }
      }
    }
    return null;
  }

  /** The shortest building worth drawing at this distance. */
  #cutoff(distance) {
    let min = 0;
    for (const b of this.bands) if (distance >= b.from) min = b.minHeight;
    return min;
  }

  update(cameraPosition) {
    const r = this.maxDistance;
    const cx = Math.floor(cameraPosition.x / TILE);
    const cz = Math.floor(cameraPosition.z / TILE);
    const span = Math.ceil(r / TILE);

    const wanted = new Map();
    for (let j = cz - span; j <= cz + span; j++) {
      for (let i = cx - span; i <= cx + span; i++) {
        const key = `${i},${j}`;
        if (!this.tiles.has(key)) continue;
        const dx = Math.max(i * TILE - cameraPosition.x, 0, cameraPosition.x - (i + 1) * TILE);
        const dz = Math.max(j * TILE - cameraPosition.z, 0, cameraPosition.z - (j + 1) * TILE);
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        wanted.set(key, this.#cutoff(Math.sqrt(d2)));
      }
    }

    for (const [key, mesh] of this.built) {
      // Rebuild when the tile crosses a band, so towers do not pop in as a
      // whole neighbourhood the moment you drift closer.
      if (wanted.has(key) && wanted.get(key) === mesh.userData.cutoff) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.built.delete(key);
    }

    let budget = this.tileBudget;
    for (const [key, cutoff] of wanted) {
      if (budget <= 0) break;
      if (this.built.has(key)) continue;
      const mesh = this.#buildTile(key, cutoff);
      if (mesh) {
        mesh.userData.cutoff = cutoff;
        this.built.set(key, mesh);
        this.group.add(mesh);
      } else {
        // Remember the empty result so we do not retry it every frame.
        this.built.set(key, emptyMesh(cutoff));
      }
      budget--;
    }
  }

  #buildTile(key, cutoff) {
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
      const total = d.baseH[id] + d.wallH[id] + d.roofH[id];
      if (total < cutoff) continue;

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
      // the walls run down into the slope on the downhill side. A part with a
      // min_height starts where the tag says, which is what makes a setback
      // read as a setback rather than a second tower beside the first.
      const ground = groundMax;
      const base = d.baseH[id] > 0.05 ? ground + d.baseH[id] : groundMin - 1.2;
      const eaves = ground + d.baseH[id] + d.wallH[id];
      const sty = packStyle(d.typeId[id], d.material[id], 0, ox, oz);
      const roofSty = packStyle(d.typeId[id], d.material[id], 1, ox, oz);

      emitWalls(pos, nrm, style, ring, n, base, eaves, sty);
      emitRoof(pos, nrm, style, ring, n, eaves, d.roofH[id], d.roofKind[id], d.angle[id], roofSty);

      if (this.roofClutter && d.roofKind[id] === ROOF_KIND.FLAT) {
        emitRoofClutter(pos, nrm, style, ring, n, eaves + 0.35, ox, oz, sty, roofSty);
      }

      if (base < minY) minY = base;
      const top = eaves + d.roofH[id];
      if (top > maxY) maxY = top;
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
   * Structures no footprint conveys, modelled by hand. Their OSM outlines are
   * dropped at bake time so nothing is drawn twice.
   */
  #buildLandmarks(sky, places, which) {
    const concrete = makeLitMaterial(sky, { color: new THREE.Color(0.36, 0.36, 0.35), roughness: 0.72, fresnel: 0.15 });
    const glass = makeLitMaterial(sky, { color: new THREE.Color(0.06, 0.1, 0.13), roughness: 0.05, fresnel: 0.85 });
    this.landmarkMaterials = [concrete, glass];

    if (which.includes('sphinx')) {
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
    }

    if (which.includes('pizgloria')) {
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
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of [this.material, ...(this.landmarkMaterials ?? [])]) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  }

  setNight(amount) {
    this.material.uniforms.uNight.value = amount;
  }
}

function emptyMesh(cutoff) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), undefined);
  m.visible = false;
  m.userData.cutoff = cutoff;
  return m;
}

// --------------------------------------------------------------- geometry ---
/**
 * One float carries type, facade material, whether this is a roof, and a seed.
 * Packing beats extra attributes: a dense city tile is a quarter of a million
 * vertices and every float is a megabyte.
 */
export function packStyle(typeId, material, part, ox, oz) {
  let h = (Math.imul(ox | 0, 374761393) + Math.imul(oz | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const seed = (h >>> 0) % 256;
  return (typeId & 7) + (material & 7) * 8 + (part ? 64 : 0) + seed * 128;
}

function push(pos, nrm, style, x, y, z, nx, ny, nz, sty, u) {
  pos.push(x, y, z);
  nrm.push(nx, ny, nz);
  style.push(sty, u);
}

export function emitWalls(pos, nrm, style, ring, n, base, top, sty) {
  let run = 0;
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
    const u0 = run;
    const u1 = run + len;
    run = u1;
    // Wound so the outward face is the front face. The ring is
    // counter-clockwise in x/z, which puts the geometric normal of a
    // naively-ordered triangle on the inside — see tools/geometry-test.mjs.
    push(pos, nrm, style, ax, base, az, nx, 0, nz, sty, u0);
    push(pos, nrm, style, bx, top, bz, nx, 0, nz, sty, u1);
    push(pos, nrm, style, bx, base, bz, nx, 0, nz, sty, u1);
    push(pos, nrm, style, ax, base, az, nx, 0, nz, sty, u0);
    push(pos, nrm, style, ax, top, az, nx, 0, nz, sty, u0);
    push(pos, nrm, style, bx, top, bz, nx, 0, nz, sty, u1);
  }
}

export function emitFlatRoof(pos, nrm, style, ring, n, y, sty) {
  for (const [a, b, c] of earcut(ring, n)) {
    push(pos, nrm, style, ring[a * 2], y, ring[a * 2 + 1], 0, 1, 0, sty, 0);
    push(pos, nrm, style, ring[c * 2], y, ring[c * 2 + 1], 0, 1, 0, sty, 0);
    push(pos, nrm, style, ring[b * 2], y, ring[b * 2 + 1], 0, 1, 0, sty, 0);
  }
}

export function emitRoof(pos, nrm, style, ring, n, eaves, height, kind, angle, sty) {
  if (height < 0.4 || kind === ROOF_KIND.FLAT) {
    emitFlatRoof(pos, nrm, style, ring, n, eaves + 0.35, sty);
    return;
  }
  switch (kind) {
    case ROOF_KIND.PYRAMIDAL:
    case ROOF_KIND.DOME:
    case ROOF_KIND.SPIRE:
      emitApexRoof(pos, nrm, style, ring, n, eaves, height, sty);
      break;
    case ROOF_KIND.SKILLION:
      emitSkillionRoof(pos, nrm, style, ring, n, eaves, height, angle, sty);
      break;
    case ROOF_KIND.MANSARD:
      // A steep skirt around a flat cap. Two thirds of the rise is skirt.
      emitSkirtRoof(pos, nrm, style, ring, n, eaves, height, sty);
      break;
    case ROOF_KIND.HIPPED:
    case ROOF_KIND.BARREL:
    case ROOF_KIND.GABLED:
    default:
      emitGableRoof(pos, nrm, style, ring, n, eaves, height, angle, sty);
      break;
  }
}

/** Fan every edge up to a single apex over the centroid: pyramids and spires. */
export function emitApexRoof(pos, nrm, style, ring, n, eaves, height, sty) {
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < n; k++) {
    cx += ring[k * 2];
    cz += ring[k * 2 + 1];
  }
  cx /= n;
  cz /= n;
  const ay = eaves + height;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const ax = ring[k * 2];
    const az = ring[k * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const nx = (bz - az) * height;
    const nz = -(bx - ax) * height;
    const ny = Math.hypot(bx - ax, bz - az) * 0.6;
    const l = Math.hypot(nx, ny, nz) || 1;
    push(pos, nrm, style, ax, eaves, az, nx / l, ny / l, nz / l, sty, 0);
    push(pos, nrm, style, cx, ay, cz, nx / l, ny / l, nz / l, sty, 0);
    push(pos, nrm, style, bx, eaves, bz, nx / l, ny / l, nz / l, sty, 0);
  }
}

/** One flat plane tilted along the building's short axis. */
export function emitSkillionRoof(pos, nrm, style, ring, n, eaves, height, angle, sty) {
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  const ext = extents(ring, n, ux, uz);
  const span = Math.max(ext.vMax - ext.vMin, 0.5);
  const yAt = (x, z) => {
    const v = -x * uz + z * ux;
    return eaves + ((v - ext.vMin) / span) * height;
  };
  const inv = 1 / Math.hypot(1, height / span);
  const nx = (uz * (height / span)) * inv;
  const nz = (-ux * (height / span)) * inv;
  for (const [a, b, c] of earcut(ring, n)) {
    for (const i of [a, c, b]) {
      const x = ring[i * 2];
      const z = ring[i * 2 + 1];
      push(pos, nrm, style, x, yAt(x, z), z, nx, inv, nz, sty, 0);
    }
  }
}

/** Mansard: a steep skirt inset to a flat cap. */
export function emitSkirtRoof(pos, nrm, style, ring, n, eaves, height, sty) {
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < n; k++) {
    cx += ring[k * 2];
    cz += ring[k * 2 + 1];
  }
  cx /= n;
  cz /= n;
  const capY = eaves + height;
  const inset = 0.72;
  const cap = [];
  for (let k = 0; k < n; k++) {
    cap.push(cx + (ring[k * 2] - cx) * inset, cz + (ring[k * 2 + 1] - cz) * inset);
  }
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const ax = ring[k * 2];
    const az = ring[k * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const cxa = cap[k * 2];
    const cza = cap[k * 2 + 1];
    const cxb = cap[j * 2];
    const czb = cap[j * 2 + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const l = Math.hypot(ex, ez) || 1;
    const nx = ez / l;
    const nz = -ex / l;
    const ny = 0.45;
    const k2 = 1 / Math.hypot(nx, ny, nz);
    push(pos, nrm, style, ax, eaves, az, nx * k2, ny * k2, nz * k2, sty, 0);
    push(pos, nrm, style, cxb, capY, czb, nx * k2, ny * k2, nz * k2, sty, 0);
    push(pos, nrm, style, bx, eaves, bz, nx * k2, ny * k2, nz * k2, sty, 0);
    push(pos, nrm, style, ax, eaves, az, nx * k2, ny * k2, nz * k2, sty, 0);
    push(pos, nrm, style, cxa, capY, cza, nx * k2, ny * k2, nz * k2, sty, 0);
    push(pos, nrm, style, cxb, capY, czb, nx * k2, ny * k2, nz * k2, sty, 0);
  }
  emitFlatRoof(pos, nrm, style, cap, n, capY, sty);
}

/**
 * Gabled roof over the footprint's principal axis, with an eaves overhang.
 * The ridge runs along the long side, which is what a real alpine roof does.
 */
export function emitGableRoof(pos, nrm, style, ring, n, eaves, height, angle, sty) {
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

  // Reversed for the same reason the walls are: the outward face has to be
  // the front face or culling removes exactly the side you are looking at.
  const tri = (p, q, r, nn) => {
    push(pos, nrm, style, p[0], p[1], p[2], nn[0], nn[1], nn[2], sty, 0);
    push(pos, nrm, style, r[0], r[1], r[2], nn[0], nn[1], nn[2], sty, 0);
    push(pos, nrm, style, q[0], q[1], q[2], nn[0], nn[1], nn[2], sty, 0);
  };
  tri(a, r1, r0, nearN);
  tri(a, b, r1, nearN);
  tri(d, r0, r1, farN);
  tri(d, r1, c, farN);

  // gable ends
  const endN0 = [-ux, 0, -uz];
  const endN1 = [ux, 0, uz];
  tri(a, r0, d, endN0);
  tri(b, c, r1, endN1);
}

/**
 * A mechanical penthouse on a big flat roof. Downtown reads as a city from
 * above largely because of this clutter — an unbroken plane of tar is the
 * giveaway that a skyline was generated rather than photographed.
 */
export function emitRoofClutter(pos, nrm, style, ring, n, y, ox, oz, wallSty, roofSty) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const x = ring[k * 2];
    const z = ring[k * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const w = maxX - minX;
  const d = maxZ - minZ;
  if (w * d < 320 || w < 12 || d < 12) return;

  let h = (Math.imul(ox | 0, 2246822519) + Math.imul(oz | 0, 3266489917)) | 0;
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    return ((h >>> 0) % 10000) / 10000;
  };
  const cx = minX + w * (0.32 + rnd() * 0.36);
  const cz = minZ + d * (0.32 + rnd() * 0.36);
  const bw = Math.min(w * 0.3, 9 + rnd() * 7);
  const bd = Math.min(d * 0.3, 9 + rnd() * 7);
  const bh = 2.6 + rnd() * 3.4;
  const box = [cx - bw / 2, cz - bd / 2, cx + bw / 2, cz - bd / 2, cx + bw / 2, cz + bd / 2, cx - bw / 2, cz + bd / 2];
  emitWalls(pos, nrm, style, box, 4, y, y + bh, wallSty);
  emitFlatRoof(pos, nrm, style, box, 4, y + bh, roofSty);
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
export function earcut(ring, n) {
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

/** Point-in-polygon against a footprint stored as origin-relative corners. */
function pointInFootprint(corners, start, n, px, pz) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = corners[(start + i) * 2];
    const zi = corners[(start + i) * 2 + 1];
    const xj = corners[(start + j) * 2];
    const zj = corners[(start + j) * 2 + 1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Outward normal of the wall nearest the impact, so a crash can slide along
 * the face it hit rather than stopping dead in the air.
 */
function edgeNormal(corners, start, n, px, pz, out) {
  let bestD = Infinity;
  out.nx = 0;
  out.nz = 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = corners[(start + i) * 2];
    const zi = corners[(start + i) * 2 + 1];
    const xj = corners[(start + j) * 2];
    const zj = corners[(start + j) * 2 + 1];
    const ex = xi - xj;
    const ez = zi - zj;
    const l2 = ex * ex + ez * ez;
    if (l2 < 1e-6) continue;
    let t = ((px - xj) * ex + (pz - zj) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = xj + ex * t - px;
    const cz = zj + ez * t - pz;
    const d = cx * cx + cz * cz;
    if (d < bestD) {
      bestD = d;
      const l = Math.sqrt(l2);
      out.nx = ez / l;
      out.nz = -ex / l;
    }
  }
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
      uFacade: { value: FACADE.flat() },
      uRoofCol: { value: ROOFCOL.flat() },
      uTypeTint: { value: TYPE_TINT.flat() },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      in vec2 aStyle;   // x = packed type|material|part|seed, y = metres along the wall
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
      uniform vec3 uFacade[${FACADE.length}];
      uniform vec3 uRoofCol[${ROOFCOL.length}];
      uniform vec3 uTypeTint[${TYPE_TINT.length}];
      uniform float uNight;
      in vec3 vWorld;
      in vec3 vNormal;
      in vec2 vStyle;
      out vec4 fragColor;

      void main(){
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        vec3 n = normalize(vNormal);

        // ---- unpack ------------------------------------------------------
        float s = vStyle.x;
        float seed = floor(s / 128.0);
        float rest = s - seed * 128.0;
        float part = floor(rest / 64.0);
        rest -= part * 64.0;
        float matf = floor(rest / 8.0);
        int mi = int(matf + 0.5);
        int ti = int(rest - matf * 8.0 + 0.5);
        bool roof = part > 0.5;
        float r1 = fract(seed * 0.61803399);
        float r2 = fract(seed * 0.31830989 + 0.37);

        vec3 albedo = roof ? uRoofCol[mi] : uFacade[mi];
        albedo *= uTypeTint[ti];
        albedo *= 0.82 + r1 * 0.36;

        float glassness = 0.0;

        if (!roof) {
          // ---- windows ---------------------------------------------------
          // Storey height and bay spacing vary per building; a city where every
          // facade shares one grid looks stamped out.
          float floorH = 3.1 + r1 * 1.5;
          float bayW = 1.9 + r2 * 1.6;
          float u = vStyle.y;
          float h = vWorld.y;

          // Fade the grid out once a storey is only a pixel or two tall,
          // otherwise the whole city shimmers as you fly.
          float px = max(fwidth(h), fwidth(u));
          float detail = 1.0 - smoothstep(floorH * 0.16, floorH * 0.55, px);

          if (detail > 0.001) {
            float fy = fract(h / floorH);
            float fx = fract(u / bayW);
            bool glass = mi == 1;
            // Curtain wall is nearly all glazing; punched openings are not.
            float winH = glass ? 0.74 : 0.46;
            float winW = glass ? 0.82 : 0.44;
            float win =
              smoothstep(0.5 - winH * 0.5 - 0.06, 0.5 - winH * 0.5 + 0.06, fy) *
              (1.0 - smoothstep(0.5 + winH * 0.5 - 0.06, 0.5 + winH * 0.5 + 0.06, fy)) *
              smoothstep(0.5 - winW * 0.5 - 0.06, 0.5 - winW * 0.5 + 0.06, fx) *
              (1.0 - smoothstep(0.5 + winW * 0.5 - 0.06, 0.5 + winW * 0.5 + 0.06, fx));
            win *= detail;

            vec3 glazing = glass ? vec3(0.035, 0.055, 0.075) : vec3(0.020, 0.026, 0.034);
            albedo = mix(albedo, glazing, win);
            glassness = win;

            // Ground floor is taller and mostly shopfront.
            float storey = floor(h / floorH);

            // Lit windows after dark, a different set per building.
            if (uNight > 0.001) {
              float lit = step(0.62, hash12(vec2(storey + seed * 7.0, floor(u / bayW) + seed * 13.0)));
              vec3 lamp = mix(vec3(1.0, 0.82, 0.55), vec3(0.85, 0.92, 1.0), r2);
              albedo += lamp * lit * win * uNight * 0.85;
            }
          }
        }

        float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
        vec3 col = albedo * uSunRadiance * ndl;
        col += albedo * uSkyAmbient * (0.38 + 0.55 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0));

        // Glass takes its colour from what it reflects, which is mostly sky.
        if (glassness > 0.001) {
          vec3 refl = reflect(vdir, n);
          float fres = 0.05 + 0.95 * pow(1.0 - clamp(dot(-vdir, n), 0.0, 1.0), 4.0);
          col = mix(col, skyRadiance(normalize(refl), uSunDir), clamp(fres * glassness * 0.8, 0.0, 0.85));
        }

        vec3 hv = normalize(uSunDir - vdir);
        float gloss = roof ? 0.30 : (mi == 1 ? 1.4 : 0.10);
        col += uSunRadiance * pow(clamp(dot(n, hv), 0.0, 1.0), 34.0) * gloss * 0.12;

        col = aerial(col, dist, vdir, vWorld.y, uSunDir);
        fragColor = outputColor(col, 1.0);
      }
    `,
  });
}
