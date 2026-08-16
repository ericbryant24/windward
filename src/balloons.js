import * as THREE from '../vendor/three.module.js';
import { makeLitMaterial } from './materials.js';
import { mulberry32 } from './flight.js';
import { OUTPUT } from './shaders/lib.js';

/**
 * Barrage balloons: the things there are to shoot at.
 *
 * A balloon is a target that cannot move, cannot shoot back and cannot be
 * argued with — which is exactly what this game wants. The whole point of
 * putting them in is that nothing here has ever cared where the NOSE points.
 * Flight path was everything; a gun makes attitude matter on its own axis, and
 * a balloon is the cheapest honest thing to point it at.
 *
 * Placement is generated, not authored. A field is a path down a valley or a
 * shore with a lateral spread and a height band, and the balloons are scattered
 * along it by a seeded generator — so the field is identical on every run, on
 * every device, for every player, which is what medals and ghosts require. Ten
 * hand-typed lat/lon/height triples per challenge would be the same field with
 * more ways to get it wrong.
 *
 * Each one stands on a tether from the ground, and the tether is most of what
 * makes it readable: a bright shape hanging in front of a green valley wall is
 * hard to range, and the same shape on a visible string to a point on the
 * ground is not.
 */

/**
 * How big they are, in metres. The hit sphere is this; the mesh is longer.
 *
 * Was 7, which is a real barrage balloon and the wrong number. A real one is
 * moored a few hundred feet up and looked at from the ground; these are strung
 * down three kilometres of valley and looked at from an aeroplane, and at seven
 * metres the far end of a field is a dozen pixels of orange in a green valley
 * full of orange-brown roofs. Legibility beats the reference photograph: at
 * eleven the mesh is a thirty-metre airship and it reads as a thing to shoot
 * from the far end of the line, which is the only place the reading matters.
 */
const RADIUS = 11;
/** Pops take this long to play out, then the balloon is gone. */
const POP = 0.45;

/**
 * Where a field's balloons stand. Deterministic in the challenge id, so the
 * same task is the same task everywhere.
 */
export function fieldPositions(world, hf, def) {
  const t = def.targets;
  const pts = t.path.map(([lat, lon]) => world.toLocal(lat, lon));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const length = cum[cum.length - 1];
  // Seeded off the id so two fields on one map never coincide, and off nothing
  // else so a field never moves.
  let seed = 0x9e3779b9;
  for (let i = 0; i < def.id.length; i++) seed = (seed * 31 + def.id.charCodeAt(i)) >>> 0;
  const rng = mulberry32(seed);

  const out = [];
  for (let k = 0; k < t.count; k++) {
    // Evenly spaced along the line and then jittered, so they are neither a
    // row of skittles nor a heap.
    const s = ((k + 0.5) / t.count + (rng() - 0.5) * 0.5 / t.count) * length;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1];
    const b = pts[i];
    const span = cum[i] - cum[i - 1] || 1;
    const f = (s - cum[i - 1]) / span;
    const cx = a.x + (b.x - a.x) * f;
    const cz = a.z + (b.z - a.z) * f;
    // Across the line, so no two are on the same pass.
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const px = -(b.z - a.z) / len;
    const pz = (b.x - a.x) / len;
    const off = (rng() * 2 - 1) * t.spread;
    const x = cx + px * off;
    const z = cz + pz * off;
    const ground = hf.heightAt(x, z);
    const agl = t.height[0] + rng() * (t.height[1] - t.height[0]);
    out.push({ x, z, ground, agl, position: new THREE.Vector3(x, ground + agl, z), radius: RADIUS, alive: true });
  }
  return out;
}

/** The meshes: one group of balloons, one LineSegments of every tether. */
export class BalloonField {
  constructor(scene, sky, targets) {
    this.targets = targets;
    // A round that hits knows only the target it hit, and the thing that has
    // to be told is the field it belongs to.
    for (const t of targets) t.field = this;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // A fat ellipsoid with three tail lobes. High-vis, and emissive enough to
    // stay legible against a shaded valley wall — which is where half of them
    // hang and where an unlit grey shape simply disappears.
    this.material = makeLitMaterial(sky, {
      color: new THREE.Color(0.72, 0.19, 0.03),
      emissive: new THREE.Color(0.95, 0.25, 0.03),
      // Lit hard enough to hold its colour in shadow. Half the Grindelwald
      // field hangs under the Wetterhorn's own shade, and a shaded orange
      // against a shaded green valley is a smudge.
      emissiveStrength: 0.95,
      roughness: 0.62,
    });
    const body = new THREE.SphereGeometry(RADIUS, 14, 10);
    const lobe = new THREE.SphereGeometry(RADIUS * 0.34, 8, 6);

    this.shells = targets.map((t) => {
      const shell = new THREE.Group();
      const hull = new THREE.Mesh(body, this.material);
      hull.scale.set(1, 0.86, 1.45);
      shell.add(hull);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const fin = new THREE.Mesh(lobe, this.material);
        fin.position.set(Math.cos(a) * RADIUS * 0.55, Math.sin(a) * RADIUS * 0.5, RADIUS * 1.2);
        shell.add(fin);
      }
      shell.position.copy(t.position);
      this.group.add(shell);
      return shell;
    });

    // Every tether in one draw call.
    const cable = new Float32Array(targets.length * 6);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(cable, 3).setUsage(THREE.DynamicDrawUsage));
    this.cableData = cable;
    this.cableMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: { ...sky.uniforms },
      vertexShader: 'void main(){ gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: `precision highp float;
        uniform float uExposure;
        ${OUTPUT}
        out vec4 fragColour;
        // Pale, not the near-black a steel cable would be. The tether is the
        // one part of a balloon that tells you where it is when the balloon
        // itself is a speck — a bright line standing off the valley floor is
        // visible from the far end of the field, and the dark one was not.
        void main(){ fragColour = outputColor(vec3(1.05, 0.86, 0.6), 0.42); }`,
    });
    this.cables = new THREE.LineSegments(geom, this.cableMat);
    this.cables.frustumCulled = false;
    this.group.add(this.cables);

    this.t = 0;
    this.reset();
  }

  /** Every balloon back up, which is what arming a run does. */
  reset() {
    for (const t of this.targets) {
      t.alive = true;
      t.pop = 0;
    }
    for (const s of this.shells) {
      s.visible = true;
      s.scale.setScalar(1);
    }
    this.#cables();
  }

  get remaining() {
    return this.targets.filter((t) => t.alive).length;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  /** @returns whether it was still up, so a second round cannot score twice. */
  pop(target) {
    if (!target.alive) return false;
    target.alive = false;
    target.pop = POP;
    return true;
  }

  update(dt) {
    this.t += dt;
    let moved = false;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const s = this.shells[i];
      if (t.pop > 0) {
        t.pop -= dt;
        // Burst outward and vanish. Gas, not shrapnel.
        const f = 1 - Math.max(0, t.pop) / POP;
        s.scale.setScalar(1 + f * 1.8);
        s.visible = t.pop > 0;
        moved = true;
        continue;
      }
      if (!t.alive) continue;
      // A slow lean on the tether, so a field of them is not a diagram.
      const sway = Math.sin(this.t * 0.5 + i * 1.7) * 0.06;
      s.position.set(t.position.x + sway * t.agl * 0.3, t.position.y, t.position.z + sway * t.agl * 0.2);
      s.rotation.set(sway * 0.5, 0, -sway);
      moved = true;
    }
    if (moved) this.#cables();
  }

  #cables() {
    const d = this.cableData;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const s = this.shells[i];
      const up = t.alive ? 1 : 0;
      d[i * 6] = t.x;
      d[i * 6 + 1] = t.ground;
      d[i * 6 + 2] = t.z;
      d[i * 6 + 3] = up ? s.position.x : t.x;
      d[i * 6 + 4] = up ? s.position.y - RADIUS : t.ground;
      d[i * 6 + 5] = up ? s.position.z : t.z;
    }
    this.cables.geometry.attributes.position.needsUpdate = true;
  }

  setLighting(sunRadiance, skyAmbient) {
    this.material.uniforms.uSunRadiance.value.copy(sunRadiance);
    this.material.uniforms.uSkyAmbient.value.copy(skyAmbient);
  }
}
