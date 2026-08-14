import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, HEIGHT_SAMPLER } from './shaders/lib.js';

/**
 * CDLOD terrain.
 *
 * The map is a quadtree; each selected node is drawn as an instance of one
 * N x N grid, displaced in the vertex shader by the baked heightfield. Vertices
 * morph onto the next coarser lattice as they approach their LOD range, which
 * is what keeps neighbouring levels crack-free without any stitching geometry.
 *
 * Sun shadows and sky occlusion are ray-marched once into a texture at load
 * time — over a 38 km map that beats any real-time shadow map, and it is what
 * gives the Eiger its north face.
 */

const EDGE_BASE = 500;

export class Terrain {
  constructor(renderer, heightfield, sky, quality = {}) {
    this.renderer = renderer;
    this.hf = heightfield;
    this.sky = sky;
    this.gridN = quality.gridN ?? 16;
    this.maxDepth = quality.maxDepth ?? 7;
    this.baseRange = quality.baseRange ?? 1400;
    this.lightmapSize = quality.lightmapSize ?? 1024;
    this.detail = quality.detail ?? 1;

    this.group = new THREE.Group();
    this.levels = this.maxDepth + 1;
    this.ranges = Array.from({ length: this.levels }, (_, l) => this.baseRange * 2 ** l);

    this.#buildMinMax();
    this.#buildLightmapTarget();
    this.#buildGeometry();
    this.#buildSkirt();

    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._selected = Array.from({ length: this.levels }, () => []);
  }

  // ------------------------------------------------------------ quadtree ---
  /** Per-node height bounds so LOD selection and culling use real boxes. */
  #buildMinMax() {
    const hf = this.hf;
    this.nodeBounds = [];
    // finest quadtree level first, then pair upward
    const leafCount = 2 ** this.maxDepth;
    const cell = (hf.halfSize * 2) / leafCount;
    let mn = new Float32Array(leafCount * leafCount);
    let mx = new Float32Array(leafCount * leafCount);
    for (let j = 0; j < leafCount; j++) {
      for (let i = 0; i < leafCount; i++) {
        const x0 = -hf.halfSize + i * cell;
        const z0 = -hf.halfSize + j * cell;
        let lo = Infinity;
        let hi = -Infinity;
        const s = 4;
        for (let b = 0; b <= s; b++) {
          for (let a = 0; a <= s; a++) {
            const h = hf.heightAt(x0 + (a / s) * cell, z0 + (b / s) * cell);
            if (h < lo) lo = h;
            if (h > hi) hi = h;
          }
        }
        mn[j * leafCount + i] = lo - 12;
        mx[j * leafCount + i] = hi + 12;
      }
    }
    this.nodeBounds[this.maxDepth] = { n: leafCount, mn, mx };
    for (let d = this.maxDepth - 1; d >= 0; d--) {
      const n = 2 ** d;
      const pmn = new Float32Array(n * n);
      const pmx = new Float32Array(n * n);
      const c = this.nodeBounds[d + 1];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let b = 0; b < 2; b++) {
            for (let a = 0; a < 2; a++) {
              const k = (j * 2 + b) * c.n + i * 2 + a;
              if (c.mn[k] < lo) lo = c.mn[k];
              if (c.mx[k] > hi) hi = c.mx[k];
            }
          }
          pmn[j * n + i] = lo;
          pmx[j * n + i] = hi;
        }
      }
      this.nodeBounds[d] = { n, mn: pmn, mx: pmx };
    }
  }

  // ----------------------------------------------------------- lightmap ---
  #buildLightmapTarget() {
    const s = this.lightmapSize;
    this.lightmap = new THREE.WebGLRenderTarget(s, s, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    });

    const march = this.hf.mipTextures[1] ?? this.hf.mipTextures[0];
    const coarse = this.hf.mipTextures[Math.min(3, this.hf.mipTextures.length - 1)];
    this.bakeMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSunDir: { value: this.sky.sunDir },
        uHalfSize: { value: this.hf.halfSize },
        uEdgeBase: { value: EDGE_BASE },
        uMarch: { value: march },
        uMarchSize: { value: march.image.width },
        uMarchStep: { value: (this.hf.halfSize * 2) / (march.image.width - 1) },
        uCoarse: { value: coarse },
        uCoarseSize: { value: coarse.image.width },
        uCoarseStep: { value: (this.hf.halfSize * 2) / (coarse.image.width - 1) },
        uTileY: { value: new THREE.Vector2(0, 1) },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec2 uTileY;
        out vec2 vUv;
        void main(){
          float y = mix(uTileY.x, uTileY.y, position.y + 0.5);
          vUv = vec2(position.x + 0.5, y + 0.5);
          gl_Position = vec4(position.x * 2.0, y * 2.0, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${HEIGHT_SAMPLER}
        uniform vec3 uSunDir;
        uniform sampler2D uMarch; uniform float uMarchSize; uniform float uMarchStep;
        uniform sampler2D uCoarse; uniform float uCoarseSize; uniform float uCoarseStep;
        in vec2 vUv;
        out vec4 fragColor;

        float terrainAt(vec2 w, int lod){
          float h = lod == 0
            ? sampleHeightTex(uMarch, uMarchSize, uMarchStep, w)
            : sampleHeightTex(uCoarse, uCoarseSize, uCoarseStep, w);
          return mix(uEdgeBase, h, edgeFade(w));
        }

        void main(){
          vec2 world = (vUv - 0.5) * 2.0 * uHalfSize;
          float h0 = terrainAt(world, 0);
          vec3 origin = vec3(world.x, h0 + 1.5, world.y);

          // ---- direct sun: march until something rises above the ray -------
          float shadow = 1.0;
          if (uSunDir.y <= 0.015) {
            shadow = 0.0;
          } else {
            vec2 dh = normalize(uSunDir.xz + vec2(1e-6));
            float slope = uSunDir.y / max(length(uSunDir.xz), 1e-4);
            float t = 25.0;
            float step = 26.0;
            for (int i = 0; i < 72; i++){
              vec2 p = world + dh * t;
              float ray = origin.y + slope * t;
              float ter = terrainAt(p, i < 24 ? 0 : 1);
              if (ter > ray) {
                // soften with how deep below the ridge we sit
                shadow = min(shadow, clamp(1.0 - (ter - ray) / 55.0, 0.0, 1.0));
                if (shadow <= 0.001) break;
              }
              t += step;
              step *= 1.075;
              if (t > 14000.0) break;
            }
          }

          // ---- sky visibility: horizon angle in 8 directions ---------------
          float vis = 0.0;
          const int DIRS = 8;
          for (int k = 0; k < DIRS; k++){
            float a = (float(k) + 0.5) * 6.2831853 / float(DIRS);
            vec2 dh = vec2(cos(a), sin(a));
            float maxSlope = 0.0;
            float t = 30.0;
            float step = 46.0;
            for (int i = 0; i < 14; i++){
              float ter = terrainAt(world + dh * t, i < 5 ? 0 : 1);
              maxSlope = max(maxSlope, (ter - origin.y) / t);
              t += step;
              step *= 1.42;
            }
            float horizon = atan(maxSlope);
            vis += cos(horizon) * cos(horizon); // cosine-weighted sky above the horizon
          }
          vis /= float(DIRS);

          fragColor = vec4(shadow, vis, 0.0, 1.0);
        }
      `,
    });

    this.bakeScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.bakeMaterial);
    quad.frustumCulled = false;
    this.bakeScene.add(quad);
    this.bakeCamera = new THREE.Camera();
  }

  /** Bake the lightmap in horizontal strips so no single frame stalls. */
  *bakeLightmap(tiles = 8) {
    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.lightmap);
    for (let i = 0; i < tiles; i++) {
      this.bakeMaterial.uniforms.uTileY.value.set(-0.5 + i / tiles, -0.5 + (i + 1) / tiles);
      this.renderer.render(this.bakeScene, this.bakeCamera);
      yield (i + 1) / tiles;
    }
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
  }

  // ----------------------------------------------------------- geometry ---
  #buildGeometry() {
    const N = this.gridN;
    const verts = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) verts.push(i, 0, j);
    const idx = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
    }

    // A skirt hangs off each node's border. The LOD ranges are wide enough that
    // morphing should close every seam on its own, but a node edge grazed
    // almost edge-on turns a centimetre of disagreement into a visible line of
    // sky, and the apron costs a handful of triangles to make that impossible.
    // position.y flags a skirt vertex; the vertex shader drops it.
    const vi = (i, j) => j * (N + 1) + i;
    let next = (N + 1) * (N + 1);
    const addSkirt = (pts) => {
      const bottom = [];
      for (const [i, j] of pts) {
        verts.push(i, 1, j);
        bottom.push(next++);
      }
      for (let k = 0; k < pts.length - 1; k++) {
        const a = vi(...pts[k]);
        const b = vi(...pts[k + 1]);
        idx.push(a, bottom[k], b, b, bottom[k], bottom[k + 1]);
      }
    };
    const along = (fn) => Array.from({ length: N + 1 }, (_, k) => fn(k));
    addSkirt(along((k) => [k, 0]));
    addSkirt(along((k) => [k, N]));
    addSkirt(along((k) => [0, k]));
    addSkirt(along((k) => [N, k]));

    const maxInstances = 256;
    this.meshes = [];
    for (let l = 0; l < this.levels; l++) {
      const geom = new THREE.InstancedBufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geom.setIndex(idx);
      const data = new Float32Array(maxInstances * 3);
      const attr = new THREE.InstancedBufferAttribute(data, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('aNode', attr);
      geom.instanceCount = 0;
      geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

      // A level's coarse mip must be exactly the next level's fine mip,
      // otherwise a fully morphed vertex lands on a different height than the
      // neighbouring patch and the seam opens up.
      const last = this.hf.mipTextures.length - 1;
      const mipFor = (k) => Math.min(Math.max(k - 1, 0), last);
      const mat = this.#makeMaterial(l, mipFor(l), mipFor(l + 1));
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 - l; // fine levels first: cheap early-z for the rest
      this.group.add(mesh);
      this.meshes.push({ mesh, geom, attr, mat, level: l, count: 0 });
    }
  }

  #makeMaterial(level, mipA, mipB) {
    const hf = this.hf;
    const texA = hf.mipTextures[mipA];
    const texB = hf.mipTextures[mipB];
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      uniforms: {
        ...this.sky.uniforms,
        uHalfSize: { value: hf.halfSize },
        uEdgeBase: { value: EDGE_BASE },
        uGridN: { value: this.gridN },
        uRange: { value: this.ranges[level] },
        uCamDY: { value: 0 },
        uHeightA: { value: texA },
        uSizeA: { value: texA.image.width },
        uStepA: { value: (hf.halfSize * 2) / (texA.image.width - 1) },
        uHeightB: { value: texB },
        uSizeB: { value: texB.image.width },
        uStepB: { value: (hf.halfSize * 2) / (texB.image.width - 1) },
        uSurface: { value: hf.surfaceTexture },
        uGradMax: { value: hf.gradientMax },
        uLightmap: { value: this.lightmap.texture },
        uSunRadiance: { value: new THREE.Vector3(20, 19, 18) },
        uSkyAmbient: { value: new THREE.Vector3(0.6, 0.8, 1.2) },
        uSnowLine: { value: 2760 },
        uTreeLine: { value: 1950 },
        uDetail: { value: this.detail },
        uTime: { value: 0 },
      },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    });
  }

  #buildSkirt() {
    // A hazy lowland apron so the baked square does not end in mid-air.
    const h = this.hf.halfSize;
    const outer = 130000;
    const pos = [];
    const idx = [];
    const ring = (r, y) => {
      const base = pos.length / 3;
      const steps = 4;
      for (let s = 0; s <= steps; s++) pos.push(-r + (2 * r * s) / steps, y, -r);
      for (let s = 1; s <= steps; s++) pos.push(r, y, -r + (2 * r * s) / steps);
      for (let s = 1; s <= steps; s++) pos.push(r - (2 * r * s) / steps, y, r);
      for (let s = 1; s < steps; s++) pos.push(-r, y, r - (2 * r * s) / steps);
      return base;
    };
    const inner = ring(h, EDGE_BASE);
    const outerBase = ring(outer, EDGE_BASE - 40);
    const count = outerBase - inner;
    for (let i = 0; i < count; i++) {
      const a = inner + i;
      const b = inner + ((i + 1) % count);
      const c = outerBase + i;
      const d = outerBase + ((i + 1) % count);
      idx.push(a, c, b, b, c, d);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setIndex(idx);
    geom.computeVertexNormals();

    this.skirtMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...this.sky.uniforms,
        uSunRadiance: { value: new THREE.Vector3(20, 19, 18) },
        uSkyAmbient: { value: new THREE.Vector3(0.6, 0.8, 1.2) },
      },
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
        uniform vec3 uSunRadiance;
        uniform vec3 uSkyAmbient;
        in vec3 vWorld;
        out vec4 fragColor;
        void main(){
          vec3 v = vWorld - cameraPosition;
          float dist = length(v);
          vec3 dir = v / dist;
          float n = fbm(vWorld.xz * 0.00035, 4) * 0.5 + 0.5;
          vec3 albedo = mix(vec3(0.055, 0.075, 0.040), vec3(0.10, 0.115, 0.070), n);
          vec3 col = albedo * (uSunRadiance * max(uSunDir.y, 0.0) * 0.85 + uSkyAmbient);
          col = aerial(col, dist, dir, 520.0, uSunDir);
          fragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skirt = new THREE.Mesh(geom, this.skirtMat);
    this.skirt.frustumCulled = false;
    this.skirt.renderOrder = 20;
    this.group.add(this.skirt);
  }

  // ---------------------------------------------------------- selection ---
  /**
   * Distance driving LOD choice. The vertical term deliberately uses the map's
   * global height band rather than each node's own: if a valley node and the
   * peak beside it disagreed by two LOD levels, the single-step morph could not
   * close the seam and daylight would show through the ridge.
   */
  #nodeDistance(cx, cz, size, d, i, j) {
    const x0 = -this.hf.halfSize + i * size;
    const z0 = -this.hf.halfSize + j * size;
    const dx = Math.max(x0 - cx, 0, cx - (x0 + size));
    const dz = Math.max(z0 - cz, 0, cz - (z0 + size));
    const dy = this.camDY;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  #visible(d, i, j, size) {
    const b = this.nodeBounds[d];
    const k = j * b.n + i;
    const x0 = -this.hf.halfSize + i * size;
    const z0 = -this.hf.halfSize + j * size;
    this._box.min.set(x0, b.mn[k], z0);
    this._box.max.set(x0 + size, b.mx[k], z0 + size);
    return this._frustum.intersectsBox(this._box);
  }

  /**
   * Top-down descent. A node is drawn at its own level as soon as it is far
   * enough away for the next finer level's range, so every drawn node keeps
   * the lattice its level implies — that, plus the morph, is what removes the
   * need for stitching strips between levels.
   */
  #select(d, i, j, cx, cz) {
    const size = (this.hf.halfSize * 2) / 2 ** d;
    if (!this.#visible(d, i, j, size)) return;
    const level = this.maxDepth - d;
    if (level === 0 || this.#nodeDistance(cx, cz, size, d, i, j) > this.ranges[level - 1]) {
      this._selected[level].push(-this.hf.halfSize + i * size, -this.hf.halfSize + j * size, size);
      return;
    }
    for (let b = 0; b < 2; b++) {
      for (let a = 0; a < 2; a++) this.#select(d + 1, i * 2 + a, j * 2 + b, cx, cz);
    }
  }

  update(camera, dt = 0) {
    if (!this._box) this._box = new THREE.Box3();
    this.camY = camera.position.y;
    this.camDY = Math.max(0, camera.position.y - this.hf.maxHeight, this.hf.minHeight - camera.position.y);
    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    for (const s of this._selected) s.length = 0;
    this.#select(0, 0, 0, camera.position.x, camera.position.z);

    for (const m of this.meshes) {
      const list = this._selected[m.level];
      const cap = (m.attr.array.length / 3) | 0;
      const n = Math.min((list.length / 3) | 0, cap);
      for (let k = 0; k < n * 3; k++) m.attr.array[k] = list[k];
      m.attr.needsUpdate = true;
      m.geom.instanceCount = n;
      m.mesh.visible = n > 0;
      m.mat.uniforms.uCamDY.value = this.camDY;
      m.mat.uniforms.uTime.value += dt;
    }
    this.skirt.position.set(0, 0, 0);
  }

  setLighting(sunRadiance, skyAmbient) {
    for (const m of this.meshes) {
      m.mat.uniforms.uSunRadiance.value.copy(sunRadiance);
      m.mat.uniforms.uSkyAmbient.value.copy(skyAmbient);
    }
    this.skirtMat.uniforms.uSunRadiance.value.copy(sunRadiance);
    this.skirtMat.uniforms.uSkyAmbient.value.copy(skyAmbient);
  }
}

// ------------------------------------------------------------- shaders ---

const TERRAIN_COMMON = /* glsl */ `
${NOISE}
${SKY}
${HEIGHT_SAMPLER}
uniform sampler2D uHeightA; uniform float uSizeA; uniform float uStepA;
uniform sampler2D uHeightB; uniform float uSizeB; uniform float uStepB;

float terrainA(vec2 w){ return mix(uEdgeBase, sampleHeightTex(uHeightA, uSizeA, uStepA, w), edgeFade(w)); }
float terrainB(vec2 w){ return mix(uEdgeBase, sampleHeightTex(uHeightB, uSizeB, uStepB, w), edgeFade(w)); }
`;

const TERRAIN_VERT = /* glsl */ `
precision highp float;
${TERRAIN_COMMON}
uniform float uGridN;
uniform float uRange;
uniform float uCamDY;   // vertical part of the LOD metric, shared by every node
in vec3 aNode;        // xz = node origin, z = node size

out vec3 vWorld;
out float vMorph;
out float vDist;

void main(){
  float cell = aNode.z / uGridN;
  vec2 fine = aNode.xy + position.xz * cell;
  vec2 coarse = aNode.xy + floor(position.xz * 0.5 + 0.001) * 2.0 * cell;

  // Must match Terrain#nodeDistance exactly: if the CPU picks levels with one
  // metric and the GPU morphs with another, the seams tear open.
  vec2 dxz = fine - cameraPosition.xz;
  float d = sqrt(dot(dxz, dxz) + uCamDY * uCamDY);
  float morph = clamp((d / uRange - 0.86) / 0.12, 0.0, 1.0);

  vec2 world = mix(fine, coarse, morph);
  float h = mix(terrainA(world), terrainB(world), morph);
  h -= position.y * min(cell * 2.5 + 10.0, 420.0);   // position.y == 1 -> skirt

  vWorld = vec3(world.x, h, world.y);
  vMorph = morph;
  vDist = distance(cameraPosition, vWorld);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;


const TERRAIN_FRAG = /* glsl */ `
precision highp float;
${TERRAIN_COMMON}
uniform sampler2D uSurface;     // rg = gradient, b = water, a = local relief
uniform float uGradMax;
uniform sampler2D uLightmap;
uniform vec3 uSunRadiance;
uniform vec3 uSkyAmbient;
uniform float uSnowLine;
uniform float uTreeLine;
uniform float uDetail;
uniform float uTime;

in vec3 vWorld;
in float vMorph;
in float vDist;
out vec4 fragColor;

float decodeGrad(float v){
  float u = v * 2.0 - 1.0;
  return sign(u) * u * u * uGradMax;
}

void main(){
  vec3 view = vWorld - cameraPosition;
  float dist = length(view);
  vec3 vdir = view / dist;
  vec2 uv = vWorld.xz / (2.0 * uHalfSize) + 0.5;

  vec4 surf = texture(uSurface, uv);
  float fade = edgeFade(vWorld.xz);
  vec3 macro = normalize(vec3(-decodeGrad(surf.r) * fade, 1.0, -decodeGrad(surf.g) * fade));
  float water = surf.b;
  float relief = surf.a;

  vec3 n = macro;
  float alt = vWorld.y;
  float slope = clamp(macro.y, 0.0, 1.0);
  float steep = 1.0 - slope;

  // ---- procedural relief -------------------------------------------------
  // Two bands: eroded gullies that read from a few kilometres out, and a fine
  // grain that only matters when a wingtip is about to touch.
  if (uDetail > 0.5) {
    float mid = clamp(1.0 - dist / 7000.0, 0.0, 1.0);
    float near = clamp(1.0 - dist / 1400.0, 0.0, 1.0);
    vec2 p = vWorld.xz;
    vec3 dn = vec3(0.0);
    if (mid > 0.001) {
      float amp = mid * mid * (0.30 + 1.7 * steep) * (0.35 + 0.9 * relief);
      float e = 3.0;
      float r0 = ridged(p * 0.0075, 4);
      dn += vec3(-(ridged((p + vec2(e, 0.0)) * 0.0075, 4) - r0),
                 0.0,
                 -(ridged((p + vec2(0.0, e)) * 0.0075, 4) - r0)) * (95.0 * amp);
    }
    if (near > 0.001) {
      float amp = near * near * (0.5 + 1.2 * steep);
      float e = 0.7;
      float f0 = fbm(p * 0.10, 3);
      dn += vec3(-(fbm((p + vec2(e, 0.0)) * 0.10, 3) - f0),
                 0.0,
                 -(fbm((p + vec2(0.0, e)) * 0.10, 3) - f0)) * (5.0 * amp);
    }
    n = normalize(n + dn);
  }

  vec2 lm = texture(uLightmap, uv).rg;
  float shadow = lm.r;
  float skyVis = clamp(lm.g, 0.04, 1.0);

  // ---- surface mix ---------------------------------------------------------
  float varLarge = fbm(vWorld.xz * 0.00028, 4);
  float varMid = fbm(vWorld.xz * 0.0035, 4);
  float varFine = fbm(vWorld.xz * 0.038, 3);

  // north faces (-Z) hold their snow a few hundred metres lower
  float aspect = clamp(-macro.z, -1.0, 1.0);
  float snowLine = uSnowLine - aspect * 240.0 + varLarge * 210.0 + varMid * 70.0;
  float snow = smoothstep(snowLine, snowLine + 190.0, alt);
  snow *= smoothstep(0.28, 0.55, slope + varFine * 0.09);   // it slides off cliffs
  float glacier = smoothstep(0.72, 0.92, slope) * smoothstep(2650.0, 3050.0, alt);

  float treeLine = uTreeLine + varLarge * 200.0 + varMid * 110.0;
  float forest = (1.0 - smoothstep(treeLine - 200.0, treeLine + 70.0, alt));
  forest *= smoothstep(0.42, 0.72, fbm(vWorld.xz * 0.00085, 4) * 0.5 + 0.60);
  forest *= smoothstep(0.20, 0.46, slope);
  forest *= smoothstep(575.0, 640.0, alt) * (1.0 - water);

  float rock = smoothstep(0.66, 0.34, slope + varFine * 0.10);
  rock = max(rock, smoothstep(2700.0, 3200.0, alt) * smoothstep(0.58, 0.32, slope));
  rock = max(rock, smoothstep(0.55, 0.85, relief) * 0.75);
  float scree = smoothstep(1700.0, 2200.0, alt) * (1.0 - rock) * (1.0 - snow) * smoothstep(0.80, 0.50, slope);

  // ---- albedos (linear) ---------------------------------------------------
  vec3 meadow = mix(vec3(0.048, 0.082, 0.028), vec3(0.098, 0.128, 0.042), varMid * 0.5 + 0.5);
  meadow = mix(meadow, vec3(0.125, 0.135, 0.055),
               smoothstep(0.30, 0.72, varLarge) * smoothstep(1600.0, 850.0, alt));
  meadow *= 0.85 + 0.30 * (varFine * 0.5 + 0.5);

  vec3 treeCol = mix(vec3(0.014, 0.026, 0.012), vec3(0.028, 0.044, 0.019), varFine * 0.5 + 0.5);
  // canopy grain: breaks the flat green when skimming the treetops
  treeCol *= 0.7 + 0.6 * (fbm(vWorld.xz * 0.55, 2) * 0.5 + 0.5) * clamp(1.0 - dist / 900.0, 0.0, 1.0);

  float strata = fbm(vec2(alt * 0.055, (vWorld.x + vWorld.z) * 0.0035), 3);
  vec3 rockCol = mix(vec3(0.085, 0.078, 0.072), vec3(0.230, 0.214, 0.196), varFine * 0.5 + 0.5);
  rockCol *= 0.80 + 0.36 * (strata * 0.5 + 0.5);
  vec3 screeCol = vec3(0.150, 0.140, 0.128) * (0.85 + 0.32 * varFine);
  vec3 snowCol = vec3(0.74, 0.78, 0.85);
  vec3 iceCol = vec3(0.40, 0.55, 0.68);
  vec3 lakeBed = vec3(0.030, 0.045, 0.038);

  vec3 albedo = meadow;
  albedo = mix(albedo, treeCol, forest);
  albedo = mix(albedo, screeCol, scree);
  albedo = mix(albedo, rockCol, rock);
  albedo = mix(albedo, snowCol, snow);
  albedo = mix(albedo, iceCol, glacier * snow * 0.6);
  albedo = mix(albedo, lakeBed, water);

  // ---- lighting -----------------------------------------------------------
  float ndl = dot(n, uSunDir);
  float wrap = mix(0.02, 0.32, snow);          // snow scatters light around
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  // keep the macro shape shadowing even where detail normals face the sun
  float macroShade = clamp(dot(macro, uSunDir) * 5.0 + 0.12, 0.0, 1.0);
  float sun = diff * shadow * macroShade;

  vec3 col = albedo * uSunRadiance * sun;
  col += albedo * uSkyAmbient * skyVis * (0.40 + 0.60 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  // bounce off the valley floor and the surrounding snowfields
  col += albedo * uSunRadiance * 0.05 * skyVis * clamp(1.0 - n.y, 0.0, 1.0) * shadow;

  // specular: snow sparkle, wet rock, glacier ice
  float gloss = mix(0.05, 0.5, snow) + glacier * 0.35 + water * 0.5;
  vec3 hv = normalize(uSunDir - vdir);
  float spec = pow(clamp(dot(n, hv), 0.0, 1.0), mix(16.0, 110.0, snow)) * gloss;
  col += uSunRadiance * spec * shadow * 0.10;

  // forward-scattered glow through snow crystals
  col += snowCol * uSunRadiance * pow(clamp(dot(vdir, uSunDir), 0.0, 1.0), 6.0) * snow * 0.03 * shadow;

  col = aerial(col, dist, vdir, (vWorld.y + cameraPosition.y) * 0.5, uSunDir);
  fragColor = vec4(col * uExposure, 1.0);
}
`;
