import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';

/**
 * Lit material for scene objects (the glider, gates, markers). Uses the same
 * atmosphere as the terrain so nothing looks pasted on top of the world.
 */
export function makeLitMaterial(sky, options = {}) {
  const {
    color = new THREE.Color(0.8, 0.8, 0.82),
    roughness = 0.4,
    metalness = 0.0,
    emissive = new THREE.Color(0, 0, 0),
    emissiveStrength = 0,
    opacity = 1,
    transparent = false,
    side = THREE.FrontSide,
    fresnel = 0.35,
  } = options;

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent,
    side,
    depthWrite: !transparent,
    uniforms: {
      ...sky.uniforms,
      uColor: { value: new THREE.Vector3(color.r, color.g, color.b) },
      uEmissive: { value: new THREE.Vector3(emissive.r, emissive.g, emissive.b) },
      uEmissiveStrength: { value: emissiveStrength },
      uRoughness: { value: roughness },
      uMetalness: { value: metalness },
      uOpacity: { value: opacity },
      uFresnel: { value: fresnel },
      uSunRadiance: { value: new THREE.Vector3(2.2, 2.0, 1.6) },
      uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },
      uPulse: { value: 0 },
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
      uniform vec3 uColor;
      uniform vec3 uEmissive;
      uniform float uEmissiveStrength;
      uniform float uRoughness;
      uniform float uMetalness;
      uniform float uOpacity;
      uniform float uFresnel;
      uniform float uPulse;
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
        if (dot(n, vdir) > 0.0) n = -n;   // two-sided shading for thin panels

        float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);

        vec3 diffuse = uColor * (1.0 - uMetalness);
        vec3 col = diffuse * uSunRadiance * ndl;
        col += diffuse * uSkyAmbient * (0.45 + 0.55 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0));

        vec3 h = normalize(uSunDir - vdir);
        float shine = mix(8.0, 240.0, 1.0 - uRoughness);
        vec3 specCol = mix(vec3(1.0), uColor, uMetalness);
        col += specCol * uSunRadiance * pow(clamp(dot(n, h), 0.0, 1.0), shine) * (1.0 - uRoughness) * 0.7;

        // sky reflection along the fuselage edges reads as polished gelcoat
        float f = pow(1.0 - clamp(dot(-vdir, n), 0.0, 1.0), 4.0) * uFresnel;
        vec3 r = reflect(vdir, n);
        col = mix(col, skyRadiance(normalize(vec3(r.x, abs(r.y), r.z)), uSunDir), f);

        col += uEmissive * uEmissiveStrength * (0.75 + 0.25 * sin(uPulse));

        col = aerial(col, dist, vdir, (vWorld.y + cameraPosition.y) * 0.5, uSunDir);
        fragColor = outputColor(col, uOpacity);
      }
    `,
  });
  return mat;
}

/**
 * Loft a surface through cross-sections. Each section is
 * `{ points: [[x, y], ...], origin: Vector3, scale: number }` in a local frame
 * where the section lies in the XY plane and sections advance along Z.
 */
export function loft(sections) {
  const positions = [];
  const indices = [];
  const n = sections[0].points.length;
  for (const s of sections) {
    for (const [px, py] of s.points) {
      positions.push(s.origin.x + px * s.scaleX, s.origin.y + py * s.scaleY, s.origin.z);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const a = i * n + j;
      const b = i * n + j2;
      const c = (i + 1) * n + j;
      const d = (i + 1) * n + j2;
      indices.push(a, c, b, b, c, d);
    }
  }
  // cap the ends so the shape reads as solid
  const capStart = positions.length / 3;
  const first = sections[0];
  const lastS = sections[sections.length - 1];
  positions.push(first.origin.x, first.origin.y, first.origin.z);
  for (let j = 0; j < n; j++) indices.push(capStart, (j + 1) % n, j);
  const capEnd = positions.length / 3;
  positions.push(lastS.origin.x, lastS.origin.y, lastS.origin.z);
  const base = (sections.length - 1) * n;
  for (let j = 0; j < n; j++) indices.push(capEnd, base + j, base + ((j + 1) % n));

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/** Symmetric-ish airfoil outline, returned as a closed loop of [x, y]. */
export function airfoil(steps = 14, thickness = 0.13, camber = 0.02) {
  const pts = [];
  const y = (t) =>
    (thickness / 0.2) *
    (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1015 * t ** 4);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([t - 0.25, y(t) + camber * Math.sin(Math.PI * t)]);
  }
  for (let i = steps - 1; i > 0; i--) {
    const t = i / steps;
    pts.push([t - 0.25, -y(t) * 0.72 + camber * Math.sin(Math.PI * t)]);
  }
  return pts;
}
