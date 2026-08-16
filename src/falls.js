import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';

/**
 * Waterfalls.
 *
 * The Lauterbrunnen valley is named for them — seventy-two of them come off
 * those walls — and the Staubbach is the tallest free-falling fall in
 * Switzerland at 297 m. Every one of them was a place name on the minimap with
 * nothing standing where it pointed: the terrain is a 25 m grid, so a ribbon of
 * water two metres wide down a vertical face is not something a heightfield can
 * ever contain. They have to be put there by hand.
 *
 * A fall is three things stacked up the wall:
 *
 *   the ribbon   a tapering vertical plane of water, scrolling downward, torn
 *                into strands towards the bottom. The Staubbach's name means
 *                "dust brook" — most of it is airborne long before it lands,
 *                and the shader is written around that rather than around a
 *                sheet of water.
 *   the plume    the drifting veil the wind takes off it, leaning downwind.
 *   the base     a cone of mist where what is left of it hits the meadow.
 *
 * All three are one draw call per fall and no texture: two triangles' worth of
 * geometry each, and the water is a noise field in the fragment shader. Cheap
 * enough that the map can have as many as the map really has.
 */

/** The falls a region puts on its walls, in the order they read best. */
export function createFalls(heightfield, sky, list = []) {
  const group = new THREE.Group();
  const materials = [];
  if (!list.length) return Object.assign(group, { userData: { setLighting: () => {}, update: () => {} } });

  for (const fall of list) {
    const { x, z } = toLocal(heightfield, fall.lat, fall.lon);
    // The ribbon STANDS on the valley floor just out from the wall, rather than
    // hanging off the lip. That is not a shortcut, it is what the data allows:
    // a 25 m grid cannot hold an overhang, so the Lauterbrunnen wall is baked
    // as a steep ramp and anything drawn on the rock is inside it. Standing the
    // fall a little way out puts the whole drop in open air, which is also how
    // it reads from an aeroplane — a white ribbon against a dark wall.
    const base = heightfield.heightAt(x, z);
    const drop = fall.drop;
    // Leaning back towards the wall as it climbs, so the top meets the lip
    // rather than floating in front of it.
    const back = THREE.MathUtils.degToRad(fall.faces);
    const leanX = -Math.sin(back) * (fall.lean ?? 0);
    const leanZ = Math.cos(back) * (fall.lean ?? 0);

    const mat = makeFallMaterial(sky, fall);
    materials.push(mat);

    // One quad, across the face and wider at the bottom where the fall has
    // spread into spray.
    const geom = new THREE.PlaneGeometry(fall.width ?? 22, drop, 1, 10);
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const v = pos.getY(i) / drop + 0.5; // 0 at the foot, 1 at the lip
      pos.setX(i, pos.getX(i) * (1 + (1 - v) * (fall.spread ?? 1.4)));
      pos.setZ(i, v * (fall.lean ?? 0));
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    const ribbon = new THREE.Mesh(geom, mat);
    ribbon.position.set(x + leanX * 0, base + drop / 2, z + leanZ * 0);
    ribbon.rotation.y = -back;
    ribbon.renderOrder = 18;
    group.add(ribbon);

    // The mist at the bottom. A cone rather than a sphere so it reads as
    // something thrown up off the ground instead of a ball of fog.
    const mistMat = makeMistMaterial(sky);
    materials.push(mistMat);
    const mist = new THREE.Mesh(
      new THREE.ConeGeometry((fall.width ?? 22) * 1.6, Math.min(90, drop * 0.22), 10, 1, true),
      mistMat
    );
    mist.position.set(x, base + Math.min(45, drop * 0.11), z);
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
