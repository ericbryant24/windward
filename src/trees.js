import * as THREE from '../vendor/three.module.js';
import { NOISE, SKY, OUTPUT } from './shaders/lib.js';

/**
 * Near-field conifers.
 *
 * The terrain shader already paints the forest as a mass of colour, which is
 * all you can see from altitude. These are the trees you get close enough to
 * pick out individually — a single instanced draw whose buffer is rebuilt as
 * the player moves, placed from the same baked forest mask the shader reads,
 * so the trees always stand where the woods are.
 */
export class Trees {
  constructor(
    heightfield,
    sky,
    { radius = 1150, spacing = 15, maxInstances = 3800, broadleaf = false, densityScale = 1, height = [11, 24] } = {}
  ) {
    this.hf = heightfield;
    this.radius = radius;
    this.spacing = spacing;
    this.max = maxInstances;
    this.broadleaf = broadleaf;
    this.densityScale = densityScale;
    this.height = height;
    // The buffer only covers a disc around wherever it was last rebuilt, so the
    // fade has to finish inside that disc with room for the player to fly on
    // before the next rebuild — otherwise trees wink into existence at the rim.
    this.rebuildStep = 90;
    this.fadeEnd = radius - this.rebuildStep - 30;
    // Half the trees stop well short: the far field is thinned on a stable
    // checkerboard rather than by distance, so nothing pops as you approach.
    this.nearFadeEnd = Math.min(this.fadeEnd * 0.42, 480);
    this._last = new THREE.Vector3(1e9, 0, 1e9);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...sky.uniforms,
        uSunRadiance: { value: new THREE.Vector3(2.2, 2, 1.6) },
        uSkyAmbient: { value: new THREE.Vector3(0.5, 0.7, 1.1) },

        uSway: { value: 0 },
        // The wind the air model is actually running just above this ground,
        // in m/s. A whole hillside leaning one way is the cheapest wind sock
        // there is, and it costs one vec2.
        uWind: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: /* glsl */ `
        in vec4 aTree;   // xyz = base, w = height
        in vec3 aTint;   // x = colour jitter, y = lean, z = distance it fades out at
        uniform float uSway;
        uniform vec2 uWind;
        out vec3 vWorld;
        out vec3 vNormal;
        out float vTint;
        void main(){
          float dist = distance(cameraPosition.xz, aTree.xz);
          // grow up out of the ground over a long band instead of appearing
          float fade = 1.0 - smoothstep(aTint.z * 0.74, aTint.z, dist);
          if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float h = aTree.w * fade;

          vec3 p = position;
          p.xz *= h * 0.34;
          p.y *= h;
          // lean and sway, strongest at the crown
          float k = position.y * position.y;
          p.x += (aTint.y + sin(uSway + aTree.x * 0.05) * 0.06) * k * h;
          p.z += cos(uSway * 0.83 + aTree.z * 0.05) * 0.05 * k * h;

          // Bent downwind by however hard it is blowing, with gusts running
          // across the stand in the same direction — the wave has to travel
          // with the wind or the hillside reads as breathing rather than blown.
          float speed = length(uWind);
          if (speed > 0.05) {
            vec2 dir = uWind / speed;
            // Two waves, both travelling at about the wind speed: a long swell
            // that bends whole stands and a short shimmer across the crowns.
            float along = dot(aTree.xz, dir);
            float gust = 0.62 + 0.24 * sin(along * 0.012 - uSway * 0.107)
                              + 0.14 * sin(along * 0.35 - uSway * 3.1);
            p.xz += dir * (clamp(speed / 14.0, 0.0, 1.0) * 0.30 * gust) * k * h;
          }

          vec3 world = aTree.xyz + p;
          vWorld = world;
          vNormal = normalize(vec3(normal.x, normal.y * 0.55, normal.z));
          vTint = aTint.x;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${NOISE}
        ${SKY}
        ${OUTPUT}
        uniform vec3 uSunRadiance;
        uniform vec3 uSkyAmbient;
        in vec3 vWorld;
        in vec3 vNormal;
        in float vTint;
        out vec4 fragColor;
        void main(){
          vec3 v = vWorld - cameraPosition;
          float dist = length(v);
          vec3 vdir = v / dist;
          vec3 n = normalize(vNormal);

          vec3 albedo = mix(vec3(0.020, 0.038, 0.016), vec3(0.050, 0.072, 0.028), vTint);
          float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
          // needles scatter forward, so a lit crown glows a little
          vec3 col = albedo * uSunRadiance * (ndl * 0.85 + 0.15);
          col += albedo * uSkyAmbient * (0.35 + 0.5 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
          col += albedo * uSunRadiance * pow(clamp(dot(vdir, uSunDir), 0.0, 1.0), 4.0) * 0.35;

          col = aerial(col, dist, vdir, vWorld.y, uSunDir);
          fragColor = outputColor(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.#geometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
  }

  /**
   * A two-tier tree, 24 triangles, unit height and unit radius. Narrow and
   * pointed for a spruce; wide and round for the street trees and park oaks of
   * a city, which read completely differently from the air.
   */
  #geometry() {
    const pos = [];
    const nrm = [];
    const idx = [];
    const seg = 6;
    const tier = (y0, y1, r) => {
      const base = pos.length / 3;
      pos.push(0, y1, 0);
      nrm.push(0, 1, 0);
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        pos.push(cx * r, y0, cz * r);
        const ny = r / Math.max(y1 - y0, 1e-3);
        const l = Math.hypot(cx, ny, cz);
        nrm.push(cx / l, ny / l, cz / l);
      }
      for (let i = 0; i < seg; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % seg));
    };
    if (this.broadleaf) {
      tier(0.34, 0.92, 1.0);
      tier(0.14, 0.74, 0.86);
    } else {
      tier(0.18, 0.68, 1.0);
      tier(0.55, 1.0, 0.62);
    }
    // trunk
    const base = pos.length / 3;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      pos.push(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
      nrm.push(Math.cos(a), 0, Math.sin(a));
      pos.push(Math.cos(a) * 0.1, 0.3, Math.sin(a) * 0.1);
      nrm.push(Math.cos(a), 0, Math.sin(a));
    }
    for (let i = 0; i < 3; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % 3) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }

    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geom.setIndex(idx);

    this.treeData = new Float32Array(this.max * 4);
    this.tintData = new Float32Array(this.max * 3);
    this.treeAttr = new THREE.InstancedBufferAttribute(this.treeData, 4);
    this.tintAttr = new THREE.InstancedBufferAttribute(this.tintData, 3);
    this.treeAttr.setUsage(THREE.DynamicDrawUsage);
    this.tintAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aTree', this.treeAttr);
    geom.setAttribute('aTint', this.tintAttr);
    geom.instanceCount = 0;
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    return geom;
  }

  update(dt, position) {
    this.material.uniforms.uSway.value += dt * 0.9;
    // Rebuilding on every frame would be wasted work; the buffer only needs to
    // change once the player has actually moved into new ground.
    if (position.distanceToSquared(this._last) < this.rebuildStep * this.rebuildStep) return;
    this._last.copy(position);
    this.#rebuild(position);
  }

  /**
   * Fill the buffer near-field first. If the cap is ever reached it is the
   * distant, already-thinned trees that get dropped, never the ones under the
   * wingtip — filling in raw scan order would leave a lopsided wedge of forest
   * on whichever side of the map the loop happened to start.
   */
  #rebuild(centre) {
    this.count = 0;
    this.#scatter(centre, false);
    this.#scatter(centre, true);
    this.treeAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
    this.mesh.geometry.instanceCount = this.count;
  }

  #scatter(centre, far) {
    const hf = this.hf;
    const s = this.spacing;
    const r = far ? this.fadeEnd : this.nearFadeEnd;
    const gx0 = Math.floor((centre.x - r) / s);
    const gx1 = Math.ceil((centre.x + r) / s);
    const gz0 = Math.floor((centre.z - r) / s);
    const gz1 = Math.ceil((centre.z + r) / s);
    let n = this.count;

    for (let gz = gz0; gz <= gz1 && n < this.max; gz++) {
      for (let gx = gx0; gx <= gx1 && n < this.max; gx++) {
        // Beyond the near field only every fourth cell is used, on a fixed
        // lattice rather than by distance, so thinning never pops.
        const isFar = gx % 2 === 0 && gz % 2 === 0;
        if (far !== isFar) continue;

        // deterministic jitter so trees do not crawl as the buffer rebuilds
        const h1 = hash2i(gx, gz);
        const h2 = hash2i(gx + 9871, gz - 3313);
        const x = (gx + h1) * s;
        const z = (gz + h2) * s;
        const dx = x - centre.x;
        const dz = z - centre.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (far && d2 < this.nearFadeEnd * this.nearFadeEnd * 0.25) continue;

        const density = hf.forestAt(x, z) * this.densityScale;
        if (density < 0.06) continue;
        // the far field is already sparse; trim it a little further
        if (hash2i(gx - 517, gz + 2281) > density * (far ? 1.15 : 1.5)) continue;

        const y = hf.heightAt(x, z);
        this.treeData[n * 4] = x;
        this.treeData[n * 4 + 1] = y - 0.6;
        this.treeData[n * 4 + 2] = z;
        this.treeData[n * 4 + 3] =
          this.height[0] + hash2i(gx + 71, gz + 137) * (this.height[1] - this.height[0]) + density * 2;
        this.tintData[n * 3] = hash2i(gx * 3 + 5, gz * 7 - 11);
        this.tintData[n * 3 + 1] = (h2 - 0.5) * 0.16;
        this.tintData[n * 3 + 2] = far ? this.fadeEnd : this.nearFadeEnd;
        n++;
      }
    }
    this.count = n;
  }

  setLighting(sunRadiance, skyAmbient) {
    this.material.uniforms.uSunRadiance.value.copy(sunRadiance);
    this.material.uniforms.uSkyAmbient.value.copy(skyAmbient);
  }

  /** @param {THREE.Vector3} wind the sampled wind near the ground, m/s. */
  setWind(wind) {
    this.material.uniforms.uWind.value.set(wind.x, wind.z);
  }
}

function hash2i(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
