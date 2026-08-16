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
 * Chicago has 145,000 of them, so tiles past the first kilometre drop their
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
   *
   * The region names the ones it wants; LANDMARKS below holds the builders.
   * Every material is made whether or not this region uses it, so that
   * setLighting has one list to walk — a ShaderMaterial that never reaches a
   * mesh never gets compiled either.
   */
  #buildLandmarks(sky, places, which) {
    const concrete = makeLitMaterial(sky, { color: new THREE.Color(0.36, 0.36, 0.35), roughness: 0.72, fresnel: 0.15 });
    const glass = makeLitMaterial(sky, { color: new THREE.Color(0.06, 0.1, 0.13), roughness: 0.05, fresnel: 0.85 });
    const steel = makeLitMaterial(sky, {
      color: new THREE.Color(0.6, 0.62, 0.65),
      roughness: 0.34,
      metalness: 0.5,
      fresnel: 0.4,
    });
    const limestone = makeLitMaterial(sky, { color: new THREE.Color(0.50, 0.47, 0.41), roughness: 0.85, fresnel: 0.1 });
    // Thrown water, seen from above and from a long way off: nearly white, very
    // rough, and half transparent so the stone shows through the bottom of it.
    const water = makeLitMaterial(sky, {
      color: new THREE.Color(0.86, 0.91, 0.96),
      emissive: new THREE.Color(0.5, 0.56, 0.62),
      emissiveStrength: 0.35,
      roughness: 0.95,
      opacity: 0.55,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const mirror = makeMirrorMaterial(sky);
    this.landmarkMaterials = [concrete, glass, steel, limestone, water, mirror];

    const meta = this.hf.meta;
    const mLon = 111320 * Math.cos((meta.centerLat * Math.PI) / 180);
    const kit = {
      hf: this.hf,
      places,
      // Landmarks are surveyed to the metre. PLACES is a table of labels, and
      // a label may sit anywhere in the thing it names, so anything positioned
      // this precisely carries its own coordinates instead.
      local: (lat, lon) => ({ x: (lon - meta.centerLon) * mLon, z: (meta.centerLat - lat) * 111320 }),
      topNear: (x, z) => this.topNear(x, z),
      concrete,
      glass,
      steel,
      limestone,
      water,
      mirror,
    };

    for (const name of which) {
      const build = LANDMARKS[name];
      if (!build) {
        console.warn(`buildings: no landmark builder called "${name}"`);
        continue;
      }
      const object = build(kit);
      if (object) this.group.add(object);
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

// -------------------------------------------------------------- landmarks ---
/**
 * The hand-modelled structures, keyed by the name a region lists in
 * buildings.landmarks. Adding one is adding an entry here and an entry in the
 * baker's HAND_MODELLED, so the OSM footprint stops being extruded underneath
 * it.
 *
 * A builder is handed the kit #buildLandmarks assembles and returns an object
 * already placed in world space, or null when its anchor is missing.
 *
 * Nothing here is touched by the tile LOD: whatever a builder returns is drawn
 * from anywhere in the region, at every distance, forever. So each one merges
 * down to a couple of draw calls and stays inside a few thousand triangles.
 */
const LANDMARKS = {
  sphinx: ({ hf, places, concrete, glass }) => {
    const joch = places.find((p) => p.name === 'Jungfraujoch');
    if (!joch) return null;
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 26, 10), concrete);
    tower.position.y = 13;
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(11, 9, 5, 12), concrete);
    deck.position.y = 28;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(7.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.position.y = 30;
    g.add(tower, deck, dome);
    g.position.set(joch.x, hf.heightAt(joch.x, joch.z) - 2, joch.z);
    return g;
  },

  pizgloria: ({ hf, places, concrete, glass }) => {
    const schilthorn = places.find((p) => p.name === 'Schilthorn');
    if (!schilthorn) return null;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 9, 16), concrete);
    base.position.y = 2;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(13, 11, 7, 16), glass);
    drum.position.y = 8;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 14, 6), concrete);
    mast.position.y = 18;
    g.add(base, drum, mast);
    g.position.set(schilthorn.x, hf.heightAt(schilthorn.x, schilthorn.z) - 3, schilthorn.z);
    return g;
  },

  /**
   * Navy Pier's Centennial Wheel. OSM surveys it as a 4.4 by 58.9 m footprint
   * 59.7 m tall, which is exactly true from directly overhead and a stone slab
   * from anywhere else. Its plane runs north-south, so from the map's start
   * position out on the lake it stands edge-on: a billboarded disc would be
   * invisible and the spokes have to actually be there.
   */
  'centennial-wheel': ({ hf, local, steel }) => {
    const { x, z } = local(41.891689, -87.607476);
    const R = 27.4; // rim radius, which puts the top of the wheel at 59.7 m
    const HUB = 32.3;
    const GAP = 2.2; // half of the 4.4 m between the two rims

    // The A-frames, which do not turn. They splay to the ends of the surveyed
    // footprint, so the 58.9 m is the legs rather than the wheel.
    const fixed = [];
    for (const sx of [-1, 1]) {
      const px = sx * (GAP + 1.5);
      for (const sz of [-1, 1]) fixed.push(strut(px, 0, sz * 28.6, px, HUB, 0, 0.75));
      fixed.push(strut(px, 3.2, -28.6, px, 3.2, 28.6, 0.35, 4));
      fixed.push(new THREE.BoxGeometry(4.4, 2.2, 7.0).translate(px, 1.1, 0));
    }

    // Everything below is built about the hub, not the ground, so the spin
    // group can turn it in place.
    const turning = [new THREE.CylinderGeometry(1.75, 1.75, GAP * 2 + 3.4, 12).rotateZ(Math.PI / 2)];
    for (const sx of [-GAP, GAP]) {
      turning.push(new THREE.TorusGeometry(R, 0.45, 5, 44).rotateY(Math.PI / 2).translate(sx, 0, 0));
    }
    // Twenty-one bars straight through the hub rather than forty-two arms out
    // of it: half the geometry for the same wheel.
    for (let i = 0; i < 21; i++) {
      const a = (i / 21) * Math.PI;
      const cy = Math.cos(a) * R;
      const cz = Math.sin(a) * R;
      turning.push(strut(0, cy, cz, 0, -cy, -cz, 0.15, 4));
    }
    // Forty-two gondolas, drawn as pods turned about the wheel's own axis.
    // Riding round with the rim then leaves them looking upright, which
    // forty-two counter-rotating groups would also do at forty-two times the
    // cost.
    for (let i = 0; i < 42; i++) {
      const a = (i / 42) * Math.PI * 2;
      turning.push(
        new THREE.CylinderGeometry(1.3, 1.3, 2.6, 7)
          .rotateZ(Math.PI / 2)
          .translate(0, Math.cos(a) * (R - 2.5), Math.sin(a) * (R - 2.5))
      );
    }

    const spin = new THREE.Group();
    spin.position.y = HUB;
    const wheel = new THREE.Mesh(mergeParts(turning), steel);
    // Nothing ticks a landmark, so the one landmark that moves drives itself
    // off the render. Five minutes a turn, as the real one does.
    wheel.onBeforeRender = () => {
      spin.rotation.x = performance.now() * 2.1e-5;
    };
    spin.add(wheel);

    const g = new THREE.Group();
    g.add(new THREE.Mesh(mergeParts(fixed), steel), spin);
    g.position.set(x, standOn(hf, x, z, 26), z);
    return g;
  },

  /**
   * Cloud Gate. OSM tags it building=yes with roof:shape=dome and height 10,
   * which bakes into a brick lump with a hat. Its surveyed outline is a clean
   * ellipse 19.6 m north-south by 14.8 east-west and the sculpture is 20 by 13
   * by 10, so the two agree that the long axis runs north-south.
   *
   * The mirror is the entire point of the object and gets its own material.
   */
  'cloud-gate': ({ hf, local, mirror }) => {
    // Baked into the geometry rather than set on the mesh: the lit shaders
    // rotate normals by the model matrix alone, so a non-uniform mesh scale
    // would shear every reflection across it.
    const geom = new THREE.SphereGeometry(1, 34, 22).scale(6.6, 5.8, 9.8);
    const bean = new THREE.Mesh(geom, mirror);
    const { x, z } = local(41.882686, -87.623331);
    // The underside curves up into the arch instead of meeting the plaza, so
    // the ellipsoid is set into the ground: 10 m of sculpture standing on a
    // footprint narrower than its waist.
    bean.position.set(x, standOn(hf, x, z, 10) + 4.2, z);
    return bean;
  },

  /**
   * Soldier Field's two colonnades. OSM has them as 30 m slabs, which is the
   * right envelope around the wrong building: what stands there is thirty-two
   * Doric columns a side under an entablature, and the gaps between the
   * columns are most of what makes the stadium recognisable from the air.
   *
   * Only these two parts are dropped in the bake. The bowl, the 60 m glass
   * superstructure and the rest of the stadium's parts are good massing and
   * are left exactly as OSM has them.
   */
  'soldier-field-colonnade': ({ hf, local, limestone }) => {
    const o = local(41.8623, -87.6167);
    const g = new THREE.Group();
    // Ends taken off the surveyed footprints, as offsets from the stadium
    // centre. The west run bows seven metres out over its length, which is why
    // each is a line and not a box.
    for (const [ax, az, bx, bz] of [
      [104.0, -61.2, 104.0, 43.4],
      [-101.9, -47.5, -94.9, 57.8],
    ]) {
      const len = Math.hypot(bx - ax, bz - az);
      const angle = Math.atan2(bx - ax, bz - az);
      // Stylobate and entablature, with the hundred-foot colonnade between.
      const parts = [
        new THREE.BoxGeometry(8.6, 2.6, len + 3).rotateY(angle).translate(0, 1.3, 0),
        new THREE.BoxGeometry(9.2, 5.0, len + 3).rotateY(angle).translate(0, 27.5, 0),
      ];
      for (let i = 0; i < 32; i++) {
        const t = (i + 0.5) / 32 - 0.5;
        // Open-ended: both caps sit inside the stone above and below them.
        parts.push(
          new THREE.CylinderGeometry(0.92, 1.04, 22.4, 8, 1, true).translate(
            Math.sin(angle) * len * t,
            13.8,
            Math.cos(angle) * len * t
          )
        );
      }
      const cx = o.x + (ax + bx) / 2;
      const cz = o.z + (az + bz) / 2;
      const run = new THREE.Mesh(mergeParts(parts), limestone);
      run.position.set(cx, standOn(hf, cx, cz, 50), cz);
      g.add(run);
    }
    return g;
  },

  /**
   * The dome over the Aon Grand Ballroom, at the far end of Navy Pier. OSM has
   * the hall but nothing about its roof, and the dome is half of what the pier
   * reads as from out on the lake.
   *
   * This one adds to the OSM building rather than replacing it, so no footprint
   * is dropped for it: it stands on whatever roof the bake gives the hall.
   */
  'grand-ballroom': ({ hf, local, topNear, steel }) => {
    const { x, z } = local(41.891847, -87.599301);
    const ground = standOn(hf, x, z, 18);
    // topNear reaches across a couple of hundred metres of pier, so it is
    // capped: a taller neighbour must not lift the dome off its own hall.
    const roof = Math.min(topNear(x, z), ground + 22);
    const dome = new THREE.Mesh(
      mergeParts([
        new THREE.CylinderGeometry(16.5, 16.5, 3.4, 22, 1, true).translate(0, 1.2, 0),
        new THREE.SphereGeometry(16.5, 22, 9, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.64, 1).translate(0, 2.8, 0),
        new THREE.CylinderGeometry(0.3, 0.3, 5.0, 5).translate(0, 15.0, 0),
      ]),
      steel
    );
    dome.position.set(x, Math.max(roof, ground + 8) - 1.6, z);
    return dome;
  },

  /**
   * Buckingham Fountain, in the middle of Grant Park and directly on the line
   * of the Loop circuit. OSM has it as a pond outline and nothing else, which
   * from the air is a grey disc in a lawn — but the thing that makes it
   * legible from a thousand feet is the centre jet, which throws water 46 m
   * and is the tallest thing for four hundred metres in any direction.
   *
   * Three tiers, a rim, and the plume. The plume is a cone rather than
   * particles: it is seen from above and from a long way off, where a cone of
   * white against grass is exactly what a fountain looks like and a particle
   * system is a frame budget.
   */
  'buckingham-fountain': ({ hf, local, limestone, water }) => {
    const { x, z } = local(41.875779, -87.618937);
    const ground = standOn(hf, x, z, 90);
    const g = new THREE.Group();
    const stone = new THREE.Mesh(
      mergeParts([
        // The outer basin, 85 m across, and the three tiers stepping up it.
        new THREE.CylinderGeometry(42.5, 43.5, 1.6, 30, 1, true),
        new THREE.TorusGeometry(42.5, 1.1, 5, 30).rotateX(Math.PI / 2).translate(0, 1.0, 0),
        new THREE.CylinderGeometry(17.0, 19.0, 2.4, 22).translate(0, 1.4, 0),
        new THREE.CylinderGeometry(8.4, 10.2, 2.6, 18).translate(0, 3.6, 0),
        new THREE.CylinderGeometry(3.4, 4.8, 3.0, 14).translate(0, 6.0, 0),
      ]),
      limestone
    );
    g.add(stone);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(4.2, 46, 12, 1, true), water);
    plume.position.y = 30;
    g.add(plume);
    g.position.set(x, ground, z);
    return g;
  },

  /**
   * The Chicago Harbor Lighthouse, out at the end of the breakwater. It is the
   * first thing off the wingtip when a free flight opens over the lake, it is
   * the only structure in four square kilometres of water, and OSM has no
   * footprint for it at all — so without this there is simply nothing there.
   */
  'harbor-lighthouse': ({ hf, local, limestone, steel }) => {
    const { x, z } = local(41.889569, -87.590556);
    // Standing on the breakwater rather than in the lake: the DEM has the lake
    // floor under it, so the pier deck is authored.
    const deck = Math.max(hf.heightAt(x, z), 176.5) + 2.0;
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(
        mergeParts([
          new THREE.BoxGeometry(26, 3.2, 13).translate(0, 1.6, 0),
          new THREE.CylinderGeometry(3.1, 3.9, 17.0, 14).translate(0, 11.5, 0),
          new THREE.CylinderGeometry(4.3, 4.3, 1.4, 14).translate(0, 20.6, 0),
          // The keeper's house alongside, which is most of its silhouette.
          new THREE.BoxGeometry(9.5, 6.4, 7.0).translate(-8.5, 6.4, 0),
        ]),
        limestone
      )
    );
    const lantern = new THREE.Mesh(
      mergeParts([
        new THREE.CylinderGeometry(2.6, 2.6, 3.4, 10, 1, true).translate(0, 22.9, 0),
        new THREE.ConeGeometry(3.0, 2.6, 10).translate(0, 25.9, 0),
      ]),
      steel
    );
    g.add(lantern);
    g.position.set(x, deck, z);
    return g;
  },
};

/**
 * The ground a landmark stands on: the highest of a ring of samples across its
 * footprint, and never below the water.
 *
 * Both halves earn their keep in Chicago. The DEM carries the river bed and
 * the lake floor, so a footprint that reaches over a bank samples 172.5 m
 * against a 176.5 m surface, and anchoring on that wades the landmark four
 * metres into the water it is meant to stand beside.
 */
function standOn(hf, x, z, radius) {
  let y = hf.heightAt(x, z);
  let wet = hf.isWater(x, z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const sx = x + Math.cos(a) * radius;
    const sz = z + Math.sin(a) * radius;
    y = Math.max(y, hf.heightAt(sx, sz));
    wet = wet || hf.isWater(sx, sz);
  }
  const level = hf.meta.lakes?.[0]?.level;
  return wet && level !== undefined ? Math.max(y, level) : y;
}

const UP = new THREE.Vector3(0, 1, 0);

/** A cylinder running from a to b, in the frame it was given, ready to merge. */
function strut(ax, ay, az, bx, by, bz, radius, sides = 6) {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const length = dir.length();
  return new THREE.CylinderGeometry(radius, radius, length, sides, 1)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()))
    .translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
}

/**
 * Concatenate parts so a landmark costs one draw call rather than fifty. A
 * ferris wheel is sixty-odd primitives and it is on screen from every corner
 * of the map.
 */
function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let at = 0;
  for (const g of flat) {
    pos.set(g.getAttribute('position').array, at * 3);
    nrm.set(g.getAttribute('normal').array, at * 3);
    at += g.getAttribute('position').count;
  }
  for (const g of new Set([...parts, ...flat])) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * A near-mirror, for Cloud Gate.
 *
 * makeLitMaterial reflects the sky at grazing angles only, which is right for
 * a gelcoat wing and wrong for polished stainless: shaded that way the Bean is
 * a black lump with a bright rim, and the reflection is the only thing anyone
 * would know it by. There is no cube map to sample here, so what it returns is
 * the analytic sky in the reflected direction and the plaza below the horizon.
 */
function makeMirrorMaterial(sky, { tint = new THREE.Color(0.87, 0.88, 0.89), roughness = 0.02 } = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...sky.uniforms,
      uTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
      uRoughness: { value: roughness },
      uSunRadiance: { value: new THREE.Vector3(2.2, 2.0, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
    },
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      out vec3 vNormal;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      uniform vec3 uTint;
      uniform float uRoughness;
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      in vec3 vWorld;
      in vec3 vNormal;
      out vec4 fragColor;

      void main(){
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        vec3 vdir = v / dist;
        vec3 n = normalize(vNormal);
        vec3 r = reflect(vdir, n);

        vec3 col = skyRadiance(r, uSunDir) * uTint;
        // Below the horizon the real thing shows the plaza and the crowd on
        // it, which the sky model knows about only as a flat grey floor.
        col = mix(col, uSkyAmbient * 0.16, smoothstep(0.02, -0.45, r.y));
        // A polished surface returns the solar disc as a small, fierce spot.
        float shine = mix(140.0, 4000.0, 1.0 - uRoughness);
        col += uSunRadiance * pow(clamp(dot(r, uSunDir), 0.0, 1.0), shine) * 9.0;

        col = aerial(col, dist, vdir, (vWorld.y + cameraPosition.y) * 0.5, uSunDir);
        fragColor = outputColor(col, 1.0);
      }
    `,
  });
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
