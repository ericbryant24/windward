import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';

/**
 * Waterfalls.
 *
 * The Lauterbrunnen valley is named for them — seventy-two of them come off
 * those walls — and the Staubbach is the tallest free-falling fall in
 * Switzerland at 297 m. Every one of them was a place name on the minimap with
 * nothing standing where it pointed: a ribbon of water two metres wide is not
 * something a 25 m heightfield can ever contain. They have to be put there by
 * hand.
 *
 * A fall is two things: a ribbon of water laid down the face, and a cone of
 * mist where what is left of it lands. Both are one draw call and no texture —
 * the water is a noise field in the fragment shader — so the map can have as
 * many as the map really has.
 *
 * ------------------------------------------------------------- the shape ---
 *
 * The ribbon is a strip that FOLLOWS THE GROUND, sampled off the heightfield
 * between a foot and a head that are themselves found by walking the terrain.
 * It was a flat vertical quad standing at the authored point, and that is the
 * one thing the data cannot support. Measured on the baked Jungfrau: at the
 * Staubbach the valley floor is 789 m and the lip is 1316 m, but the wall
 * between them is a 28-degree RAMP, not a wall — 415 m of climb over 300 m of
 * ground. The 25 m grid cannot hold a vertical face and the bake smooths what
 * is left, so there is no vertical surface anywhere for a vertical ribbon to
 * lie against.
 *
 * A vertical quad on that ramp can do one of two things and both are wrong: put
 * its foot on the valley floor and its head is four hundred metres out in
 * clear air, or put its head on the rock and its foot is buried a hundred
 * metres inside the hill. The old code did neither — it took its base from the
 * terrain at the authored point, which is halfway up the ramp, so the fall
 * started 57 m above the meadow, stopped 150 m short of the lip, and hung in
 * the air off the cliff.
 *
 * Laid ON the surface it cannot float, whatever the terrain does. It reads as a
 * steep cascade rather than a free drop, which is a fair description of what
 * this DEM has to offer, and it is right from every angle.
 */

/** Rows up the face. Enough that the strip follows a ramp without faceting. */
const ROWS = 18;
/** How far off the rock the water sits, along the surface normal, in metres. */
const STANDOFF = 7;

/** The falls a region puts on its walls, in the order they read best. */
export function createFalls(heightfield, sky, list = []) {
  const group = new THREE.Group();
  const materials = [];
  if (!list.length) return Object.assign(group, { userData: { setLighting: () => {}, update: () => {} } });

  for (const fall of list) {
    const line = fallLine(heightfield, fall);
    if (!line) continue;

    const mat = makeFallMaterial(sky, fall);
    materials.push(mat);
    const ribbon = new THREE.Mesh(ribbonGeometry(heightfield, line, fall), mat);
    ribbon.renderOrder = 18;
    group.add(ribbon);

    // The mist at the bottom, at the foot the walk found rather than at the
    // authored point. A cone rather than a sphere so it reads as something
    // thrown up off the ground instead of a ball of fog.
    const mistMat = makeMistMaterial(sky);
    materials.push(mistMat);
    const mist = new THREE.Mesh(
      new THREE.ConeGeometry((fall.width ?? 22) * 1.6, Math.min(90, line.drop * 0.22), 10, 1, true),
      mistMat
    );
    mist.position.set(line.foot.x, line.foot.y + Math.min(45, line.drop * 0.11), line.foot.z);
    mist.renderOrder = 19;
    group.add(mist);
  }

  group.userData.setLighting = (sunRadiance, skyAmbient) => {
    for (const m of materials) {
      m.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
  };
  group.userData.update = (dt) => {
    for (const m of materials) m.uniforms.uTime.value += dt;
  };
  return group;
}

function toLocal(hf, lat, lon) {
  const meta = hf.meta;
  return {
    x: (lon - meta.centerLon) * 111320 * Math.cos((meta.centerLat * Math.PI) / 180),
    z: (meta.centerLat - lat) * 111320,
  };
}

/**
 * Where a fall starts and stops, read off the terrain rather than authored.
 *
 * `faces` is the compass direction the water is thrown, so walking that way is
 * walking out from the wall and walking back against it is climbing the face.
 * Two walks:
 *
 *   the foot   out from the authored point until the ground stops falling —
 *              the gradient dropping under about a tenth is the bottom of the
 *              face, whether that is twenty-five metres out (Trümmelbach) or
 *              six hundred (Schmadribach, which drains a hanging valley).
 *   the head   back up the face from the foot until it has climbed the drop
 *              the fall is credited with, or until the face stops climbing,
 *              whichever comes first.
 *
 * Doing it this way rather than from authored endpoints means the falls stay
 * put when the terrain is re-baked, which has happened twice.
 */
function fallLine(hf, fall) {
  const start = toLocal(hf, fall.lat, fall.lon);
  const a = THREE.MathUtils.degToRad(fall.faces);
  const ux = Math.sin(a);
  const uz = -Math.cos(a);
  const at = (d) => {
    const x = start.x + ux * d;
    const z = start.z + uz * d;
    return { x, z, y: hf.heightAt(x, z), d };
  };

  const STEP = 25;
  let foot = at(0);
  for (let d = STEP; d <= 900; d += STEP) {
    const p = at(d);
    // Rising again, or flattening out: the face has ended.
    if (p.y > foot.y - STEP * 0.1) break;
    foot = p;
  }

  let head = foot;
  for (let d = foot.d - STEP; d >= foot.d - 1200; d -= STEP) {
    const p = at(d);
    if (p.y <= head.y) break; // stopped climbing: the top of the face
    head = p;
    if (head.y - foot.y >= fall.drop) break;
  }

  const drop = head.y - foot.y;
  if (drop < 25) return null; // nothing here worth drawing water down
  return { foot, head, drop, run: Math.hypot(head.x - foot.x, head.z - foot.z) };
}

/**
 * The ribbon: a strip of quads climbing the face, each row sitting a few metres
 * off the rock along the surface normal so it never z-fights and never sinks
 * in. Wider at the bottom, where the fall has stopped being water.
 */
function ribbonGeometry(hf, line, fall) {
  const width = fall.width ?? 22;
  const spread = fall.spread ?? 1.4;
  // Across the fall line in plan, which is the direction the ribbon has width.
  const dx = (line.head.x - line.foot.x) / (line.run || 1);
  const dz = (line.head.z - line.foot.z) / (line.run || 1);
  const px = -dz;
  const pz = dx;

  // Bowed off the face in the middle and planted at both ends. Water leaving
  // the lip does not hug the rock on the way down, and a strip that does reads
  // as a pale gully painted on the hillside; carrying the middle rows a little
  // way downhill without taking their height with them lifts them clear of the
  // slope, which is the free-falling part of a fall. Both ends still touch, so
  // it cannot go back to floating.
  const bow = fall.bow ?? Math.min(45, line.drop * 0.1);

  const pos = new Float32Array((ROWS + 1) * 2 * 3);
  const uv = new Float32Array((ROWS + 1) * 2 * 2);
  const nrm = new THREE.Vector3();
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS; // 0 at the foot, 1 at the head
    const ax = line.foot.x + (line.head.x - line.foot.x) * t;
    const az = line.foot.z + (line.head.z - line.foot.z) * t;
    const half = (width * (1 + (1 - t) * spread)) / 2;
    hf.normalAt(ax, az, 40, nrm);
    // Height from where the row sits ON the line; position from where the bow
    // carries it. That difference is the air under the water.
    const y = hf.heightAt(ax, az) + nrm.y * STANDOFF;
    const out = bow * Math.sin(Math.PI * t);
    const cx = ax - dx * out;
    const cz = az - dz * out;
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      const o = (i * 2 + k) * 3;
      pos[o] = cx + px * half * s + nrm.x * STANDOFF;
      pos[o + 1] = y;
      pos[o + 2] = cz + pz * half * s + nrm.z * STANDOFF;
      uv[(i * 2 + k) * 2] = k;
      uv[(i * 2 + k) * 2 + 1] = t;
    }
  }
  const index = [];
  for (let i = 0; i < ROWS; i++) {
    const b = i * 2;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(index);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Falling water. Vertical scroll at two rates so the sheet does not read as one
 * moving texture, torn into strands by a second noise field, and going from
 * water at the lip to spray at the bottom — which is what a 300 m fall actually
 * does long before it lands.
 */
function makeFallMaterial(sky, fall) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      ...sky.uniforms,
      uSunRadiance: { value: new THREE.Vector3(20, 19, 18) },
      uSkyAmbient: { value: new THREE.Vector3(0.6, 0.8, 1.2) },
      uTime: { value: 0 },
      uFall: { value: fall.rate ?? 1 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      out vec3 vWorld;
      void main(){
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      in vec2 vUv;
      in vec3 vWorld;
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      uniform float uTime;
      uniform float uFall;
      out vec4 fragColour;

      void main(){
        // uv.y is 0 at the foot and 1 at the lip.
        float down = 1.0 - vUv.y;
        float t = uTime * uFall;
        // Two scrolls at different rates, so no single band can be followed
        // down the whole face.
        float a = fbm(vec2(vUv.x * 7.0, vUv.y * 22.0 + t * 2.4), 3);
        float b = fbm(vec2(vUv.x * 3.0 + 11.0, vUv.y * 9.0 + t * 1.3), 2);
        float water = 0.55 * a + 0.45 * b;

        // Solid at the lip, torn into strands and then into dust on the way
        // down. Staubbach means dust brook, and this is the whole reason it
        // does: hardly any of it is still water when it lands.
        float strand = smoothstep(0.34, 0.66, water + 0.30 - down * 0.55);
        float body = mix(strand, 1.0, smoothstep(0.55, 1.0, vUv.y));
        // Feathered at the edges so the quad never shows itself.
        float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
        float alpha = body * edge * (0.30 + 0.62 * (1.0 - down * 0.55));
        if (alpha < 0.01) discard;

        // Lit as spray rather than as a surface: it scatters far more than it
        // reflects, so most of what reaches the eye is sky.
        vec3 tint = mix(vec3(0.86, 0.92, 0.98), vec3(1.0), down * 0.6);
        vec3 col = tint * (uSkyAmbient * 1.25 + uSunRadiance * 0.055);
        fragColour = outputColor(col, alpha);
      }
    `,
  });
}

/** The mist at the foot, which is mostly there to hide where the ribbon ends. */
function makeMistMaterial(sky) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      ...sky.uniforms,
      uSunRadiance: { value: new THREE.Vector3(20, 19, 18) },
      uSkyAmbient: { value: new THREE.Vector3(0.6, 0.8, 1.2) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY}
      ${OUTPUT}
      in vec2 vUv;
      uniform vec3 uSunRadiance;
      uniform vec3 uSkyAmbient;
      uniform float uTime;
      out vec4 fragColour;

      void main(){
        float n = fbm(vec2(vUv.x * 5.0 + uTime * 0.35, vUv.y * 4.0 - uTime * 0.5), 3);
        float alpha = smoothstep(0.35, 0.85, n) * (1.0 - vUv.y) * 0.5;
        if (alpha < 0.01) discard;
        vec3 col = vec3(0.93, 0.96, 1.0) * (uSkyAmbient * 1.4 + uSunRadiance * 0.03);
        fragColour = outputColor(col, alpha);
      }
    `,
  });
}
