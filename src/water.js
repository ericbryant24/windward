import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, HEIGHT_SAMPLER, OUTPUT } from './shaders/lib.js';

/**
 * Thunersee and Brienzersee. Each lake is a quad over its baked bounding box;
 * the flood-filled mask carves the real shoreline out of it in the fragment
 * shader, and terrain depth drives the glacial-flour turquoise near the shore.
 */
export function createLakes(heightfield, sky) {
  const hf = heightfield;
  const maskData = new Uint8Array(hf.size * hf.size);
  for (let i = 0; i < maskData.length; i++) maskData[i] = hf.water[i] * 255;
  const mask = new THREE.DataTexture(maskData, hf.size, hf.size, THREE.RedFormat, THREE.UnsignedByteType);
  mask.minFilter = THREE.LinearFilter;
  mask.magFilter = THREE.LinearFilter;
  mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  mask.needsUpdate = true;

  const heightTex = hf.mipTextures[0];
  const group = new THREE.Group();
  const materials = [];

  for (const lake of hf.meta.lakes ?? []) {
    const b = lake.bounds;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const geom = new THREE.PlaneGeometry(w, d, 24, 24);
    geom.rotateX(-Math.PI / 2);
    geom.translate((b.minX + b.maxX) / 2, lake.level, (b.minZ + b.maxZ) / 2);

    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...sky.uniforms,
        uHalfSize: { value: hf.halfSize },
        uEdgeBase: { value: 500 },
        uMask: { value: mask },
        uHeight: { value: heightTex },
        uHeightSize: { value: heightTex.image.width },
        uHeightStep: { value: (hf.halfSize * 2) / (heightTex.image.width - 1) },
        uLevel: { value: lake.level },
        uSunRadiance: { value: new THREE.Vector3(20, 19, 18) },
        uSkyAmbient: { value: new THREE.Vector3(0.6, 0.8, 1.2) },
        uTime: { value: 0 },
        // The wind the air model is running over this water, m/s. A lake is the
        // one surface big enough to show it: streaks lie along the wind and the
        // gusts walk downwind across them.
        uWind: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: /* glsl */ `
        out vec3 vWorld;
        void main(){
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${NOISE}
        ${SKY}
        ${HEIGHT_SAMPLER}
        ${OUTPUT}
        uniform sampler2D uMask;
        uniform sampler2D uHeight;
        uniform float uHeightSize;
        uniform float uHeightStep;
        uniform float uLevel;
        uniform vec3 uSunRadiance;
        uniform vec3 uSkyAmbient;
        uniform float uTime;
        uniform vec2 uWind;
        in vec3 vWorld;
        out vec4 fragColor;

        /**
         * Ripples in the wind's own frame: the noise is squashed across the
         * wind and stretched along it, which is what turns a uniform chop into
         * the streaks that give a lake its direction from the air. The whole
         * field is carried downwind at the same time.
         */
        float ripples(vec2 p, float t, vec2 dir, float speed){
          vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
          q.x -= t * speed;
          vec2 a = vec2(q.x * 0.34, q.y);
          return fbm(a * 0.055 + vec2(t * 0.35, t * 0.11), 3) +
                 0.6 * fbm(vec2(q.x * 0.5, q.y) * 0.21 - vec2(t * 0.6, t * 0.2), 2);
        }

        /** Cat's paws: long thin patches of roughened water walking downwind. */
        float catspaw(vec2 p, float t, vec2 dir, float speed){
          vec2 q = vec2(dot(p, dir) * 0.16 - t * speed * 1.35, dot(p, vec2(-dir.y, dir.x)));
          return smoothstep(0.06, 0.42, fbm(q * 0.0052, 3));
        }

        void main(){
          vec2 uv = vWorld.xz / (2.0 * uHalfSize) + 0.5;
          float m = texture(uMask, uv).r;
          if (m < 0.42) discard;
          float shore = smoothstep(0.42, 0.78, m);

          vec3 view = vWorld - cameraPosition;
          float dist = length(view);
          vec3 vdir = view / dist;

          // ---- ripples ------------------------------------------------------
          float fade = clamp(1.0 - dist / 9000.0, 0.0, 1.0);
          vec2 p = vWorld.xz;
          float t = uTime;
          float e = 0.9;
          float speed = length(uWind);
          vec2 dir = speed > 0.05 ? uWind / speed : vec2(1.0, 0.0);
          float cat = catspaw(p, t, dir, speed);
          // Harder wind, steeper chop; and steeper still inside a gust front.
          float chop = 0.55 * fade * (0.45 + 0.55 * clamp(speed / 9.0, 0.0, 1.0)) * (0.7 + 0.85 * cat);
          float w0 = ripples(p, t, dir, speed);
          float wx = ripples(p + vec2(e, 0.0), t, dir, speed);
          float wz = ripples(p + vec2(0.0, e), t, dir, speed);
          vec3 n = normalize(vec3(-(wx - w0) * chop, 1.0, -(wz - w0) * chop));

          // ---- depth --------------------------------------------------------
          float bed = sampleHeightTex(uHeight, uHeightSize, uHeightStep, vWorld.xz);
          float depth = clamp(uLevel - bed, 0.0, 60.0);
          float shallow = 1.0 - smoothstep(0.5, 26.0, depth);

          vec3 deepCol = vec3(0.006, 0.028, 0.045);
          vec3 shallowCol = vec3(0.055, 0.180, 0.185); // glacial flour turquoise
          vec3 body = mix(deepCol, shallowCol, shallow);

          // ---- reflection ---------------------------------------------------
          vec3 r = reflect(vdir, n);
          r.y = abs(r.y);
          vec3 refl = skyRadiance(r, uSunDir);
          float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(-vdir, n), 0.0, 1.0), 5.0);

          vec3 col = body * (uSkyAmbient * 0.35 + uSunRadiance * max(uSunDir.y, 0.0) * 0.06);
          col = mix(col, refl, clamp(fres, 0.0, 1.0));

          vec3 hv = normalize(uSunDir - vdir);
          float spec = pow(clamp(dot(n, hv), 0.0, 1.0), 260.0);
          col += uSunRadiance * spec * 1.6 * fade;
          // Roughened water scatters instead of mirroring, so a gust reads as a
          // dull patch drawn across the reflection.
          col += uSkyAmbient * cat * 0.045 * fade;

          col = aerial(col, dist, vdir, (uLevel + cameraPosition.y) * 0.5, uSunDir);
          fragColor = outputColor(col, shore);
        }
      `,
      transparent: true,
      depthWrite: true,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 12;
    mesh.name = lake.name;
    group.add(mesh);
    materials.push(mat);
  }

  return {
    group,
    materials,
    update(dt) {
      for (const m of materials) m.uniforms.uTime.value += dt;
    },
    setLighting(sunRadiance, skyAmbient) {
      for (const m of materials) {
        m.uniforms.uSunRadiance.value.copy(sunRadiance);
        m.uniforms.uSkyAmbient.value.copy(skyAmbient);
      }
    },
    /** @param {THREE.Vector3} wind the sampled wind over the water, m/s. */
    setWind(wind) {
      for (const m of materials) m.uniforms.uWind.value.set(wind.x, wind.z);
    },
  };
}
