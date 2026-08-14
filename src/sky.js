import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';
import { ATMO } from './shaders/atmosphere-constants.js';

/** Times of day the player can pick, tuned for how the Alps actually read. */
export const TIME_PRESETS = {
  // `exposure` stands in for the eye adapting: without it a low sun renders a
  // technically correct scene that is simply too dark to fly in.
  morning: { elevation: 17, azimuth: 96, haze: 0.88, exposure: 1.0, name: 'Alpine Morning' },
  midday: { elevation: 58, azimuth: 172, haze: 0.62, exposure: 0.85, name: 'High Noon' },
  afternoon: { elevation: 32, azimuth: 232, haze: 0.85, exposure: 0.95, name: 'Afternoon' },
  golden: { elevation: 8.5, azimuth: 283, haze: 1.05, exposure: 1.0, name: 'Golden Hour' },
};

export class Sky {
  constructor(renderer) {
    this.sunDir = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uHaze: { value: 0.9 },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uCloudCover: { value: 0.30 },
      uCloudQuality: { value: 1 },
    };

    const geometry = new THREE.SphereGeometry(30000, 32, 20);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */ `
        out vec3 vWorld;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${NOISE}
        ${SKY}
        ${OUTPUT}
        uniform float uTime;
        uniform float uCloudCover;
        uniform float uCloudQuality;
        in vec3 vWorld;
        out vec4 fragColor;

        // Thin cirrus / altocumulus sheet, intersected on a flat deck.
        vec4 highClouds(vec3 d, vec3 origin){
          if (uCloudQuality < 0.5 || d.y < 0.012) return vec4(0.0);
          float deck = 7200.0;
          float t = (deck - origin.y) / d.y;
          if (t < 0.0 || t > 260000.0) return vec4(0.0);
          vec2 p = (origin.xz + d.xz * t) * 0.000105;
          p += vec2(uTime * 0.0018, uTime * 0.0009);
          float n = fbm(p * 1.7, 5) * 0.5 + 0.5;
          float streak = fbm(vec2(p.x * 0.6, p.y * 4.5), 3) * 0.5 + 0.5;
          float density = smoothstep(0.52 - uCloudCover * 0.25, 0.86, n * 0.65 + streak * 0.35);
          density *= smoothstep(0.012, 0.16, d.y);          // fade at grazing angles
          density *= exp(-t * 0.0000035);                    // and into the haze
          float lit = 0.55 + 0.45 * clamp(dot(d, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = uSunColor * sunTransmittance(uSunDir) * lit * 0.42;
          c += skyRadiance(vec3(0.0, 1.0, 0.0), uSunDir) * 0.5;
          return vec4(c, density * 0.55);
        }

        void main(){
          vec3 d = normalize(vWorld - cameraPosition);
          vec3 col = skyRadiance(d, uSunDir);

          // solar disc (0.53 deg) with a soft limb and forward glow
          float c = dot(d, uSunDir);
          float disc = smoothstep(0.99985, 0.99995, c);
          vec3 sunCol = uSunColor * sunTransmittance(uSunDir);
          col += sunCol * disc * 26.0;
          col += sunCol * pow(max(c, 0.0), 900.0) * 3.0;

          vec4 cl = highClouds(d, cameraPosition);
          col = mix(col, cl.rgb, cl.a);

          fragColor = outputColor(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.renderer = renderer;
    this.setTime('afternoon');
  }

  setTime(preset) {
    const p = typeof preset === 'string' ? TIME_PRESETS[preset] : preset;
    this.preset = p;
    const el = THREE.MathUtils.degToRad(p.elevation);
    const az = THREE.MathUtils.degToRad(p.azimuth);
    // azimuth 0 = north (-Z), 90 = east (+X)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.uniforms.uHaze.value = p.haze;

    // Solar radiance stays constant; the atmosphere does the reddening.
    const s = 2.55;
    this.uniforms.uSunColor.value.set(1.0 * s, 0.975 * s, 0.94 * s);
    this.uniforms.uExposure.value = p.exposure ?? 1;
    this.changed = true;
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camera.position);
  }

  /** Directional light colour (already through the atmosphere) for the scene. */
  sunRadiance(out = new THREE.Vector3()) {
    const t = transmittance(this.sunDir.y, this.uniforms.uHaze.value);
    const c = this.uniforms.uSunColor.value;
    return out.set(c.x * t[0], c.y * t[1], c.z * t[2]);
  }

  /**
   * Hemispherical sky light on an up-facing surface. Mirrors the GLSL model so
   * the ambient term the meshes receive matches the dome they sit under.
   */
  skyAmbient(out = new THREE.Vector3()) {
    const s = this.sunDir;
    const dirs = [
      [0, 1, 0, 0.4],
      [s.x, 0.35, s.z, 0.24],
      [-s.x, 0.35, -s.z, 0.18],
      [s.z, 0.35, -s.x, 0.09],
      [-s.z, 0.35, s.x, 0.09],
    ];
    out.set(0, 0, 0);
    for (const [x, y, z, w] of dirs) {
      const len = Math.hypot(x, y, z) || 1;
      const c = skyRadianceJS(x / len, y / len, z / len, this);
      out.x += c[0] * w;
      out.y += c[1] * w;
      out.z += c[2] * w;
    }
    // Empirical: the analytic dome under-reports the light bouncing between
    // snowfields and haze, and shaded slopes read as black without it.
    return out.multiplyScalar(2.1);
  }
}

const { betaR: BETA_R, betaM: BETA_M, gain: SKY_GAIN } = ATMO;

function airMassJS(cosZenith) {
  const c = Math.max(0, Math.min(1, cosZenith));
  const zDeg = (Math.acos(c) * 180) / Math.PI;
  return 1 / (c + 0.50572 * Math.pow(Math.max(96.07995 - zDeg, 0.05), -1.6364));
}

function transmittance(sunY, haze) {
  const m = airMassJS(sunY);
  return BETA_R.map((b) => Math.exp(-(b + BETA_M * haze) * m));
}

function skyRadianceJS(dx, dy, dz, sky) {
  const s = sky.sunDir;
  const haze = sky.uniforms.uHaze.value;
  const cosT = Math.max(-1, Math.min(1, dx * s.x + dy * s.y + dz * s.z));
  const m = airMassJS(dy);
  const t = transmittance(s.y, haze);
  const sc = sky.uniforms.uSunColor.value;
  const sun = [sc.x * t[0], sc.y * t[1], sc.z * t[2]];
  const phaseR = 0.05968310365 * (1 + cosT * cosT);
  const g = ATMO.mieG;
  const phaseM =
    (0.07957747 * (1 - g * g)) / Math.pow(Math.max(1 + g * g - 2 * g * cosT, 1e-4), 1.5);
  const msTint = ATMO.msTint;
  const msK = ATMO.msFill * (0.3 + 0.7 * smoothstepJS(-0.1, 0.3, s.y));
  const mScat = Math.min(m, ATMO.scatterAirMassCap);
  const sunColor = [sc.x, sc.y, sc.z];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const inR = (1 - Math.exp(-BETA_R[i] * mScat)) * phaseR * (1 - ATMO.mieShare);
    const inM = (1 - Math.exp(-BETA_M * mScat * haze)) * phaseM * ATMO.mieShare;
    out[i] =
      sun[i] * (inR + inM) * SKY_GAIN +
      sunColor[i] * msTint[i] * (1 - Math.exp(-BETA_R[i] * mScat * 0.55)) * msK;
  }
  const pale = smoothstepJS(ATMO.paleFrom, ATMO.paleTo, m) * ATMO.paleAmount;
  const lum = out[0] * 0.29 + out[1] * 0.53 + out[2] * 0.18;
  const warm = [1.06, 1.0, 0.94];
  for (let i = 0; i < 3; i++) out[i] += (lum * warm[i] - out[i]) * pale;
  return out;
}

function smoothstepJS(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Test hook: evaluate the JS mirror of the sky model in a given direction. */
export function skyRadianceAt(sky, dir) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return skyRadianceJS(dir[0] / l, dir[1] / l, dir[2] / l, sky);
}
