import * as THREE from '../vendor/three.module.js';

function bytesFromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * The baked Jungfrau heightfield: CPU copy for physics and placement, plus a
 * mip pyramid of R32F textures the terrain shader samples in the vertex stage.
 *
 * World space is metres: +X east, +Z south, +Y up, origin at the region centre.
 */
export class Heightfield {
  constructor(meta, heights, water, vegetation = null) {
    this.meta = meta;
    this.size = meta.size;
    this.step = meta.step;
    this.halfSize = meta.halfSize;
    this.minHeight = meta.minHeight;
    this.maxHeight = meta.maxHeight;
    this.heights = heights;
    this.water = water;
    this.vegetation = vegetation; // { data: Uint8Array, size } from the region's own survey, or null

    this.mips = [];
    this.mipTextures = [];
    this.#buildMips();
    this.#buildForestMask();
    this.#buildSurfaceTexture();
  }

  /**
   * Where the forest grows: below a wandering treeline, off the cliffs, in
   * patches. Baked on a coarse grid so the terrain shader and the instanced
   * trees agree about which slopes are wooded — the shader reads it out of the
   * surface texture, the tree placer samples it directly.
   */
  #buildForestMask() {
    // A region that ships a surveyed vegetation mask uses it verbatim: the
    // parks in a city are where the city put them, and no treeline rule is
    // going to guess Lincoln Park.
    if (this.vegetation) {
      const n = this.vegetation.size;
      const mask = new Float32Array(n * n);
      const src = this.vegetation.data;
      for (let p = 0; p < mask.length; p++) mask[p] = src[p] / 255;
      this.forestMask = mask;
      this.forestSize = n;
      this.forestStep = (this.halfSize * 2) / (n - 1);
      return;
    }

    const n = 768;
    const mask = new Float32Array(n * n);
    const step = (this.halfSize * 2) / (n - 1);
    const nrm = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      const z = -this.halfSize + j * step;
      for (let i = 0; i < n; i++) {
        const x = -this.halfSize + i * step;
        const h = this.heightAt(x, z);
        if (h < 600 || this.isWater(x, z)) continue;
        const treeLine = 1980 + fbm2(x * 0.00028, z * 0.00028, 4) * 240;
        const alt = 1 - smoothstep(treeLine - 220, treeLine + 60, h);
        if (alt <= 0) continue;
        this.normalAt(x, z, 60, nrm);
        const slope = smoothstep(0.22, 0.5, nrm.y) * (1 - smoothstep(0.97, 1.0, nrm.y) * 0.35);
        const patch = smoothstep(0.4, 0.78, fbm2(x * 0.00085, z * 0.00085, 4) * 0.5 + 0.6);
        mask[j * n + i] = alt * slope * patch;
      }
    }
    this.forestMask = mask;
    this.forestSize = n;
    this.forestStep = step;
  }

  /** Forest density 0..1 at a world position. */
  forestAt(x, z) {
    const n = this.forestSize;
    const fx = Math.min(n - 1.001, Math.max(0, (x + this.halfSize) / this.forestStep));
    const fz = Math.min(n - 1.001, Math.max(0, (z + this.halfSize) / this.forestStep));
    const i = fx | 0;
    const j = fz | 0;
    const dx = fx - i;
    const dz = fz - j;
    const m = this.forestMask;
    const a = m[j * n + i];
    const b = m[j * n + i + 1];
    const c = m[(j + 1) * n + i];
    const d = m[(j + 1) * n + i + 1];
    return (a * (1 - dx) + b * dx) * (1 - dz) + (c * (1 - dx) + d * dx) * dz;
  }

  /**
   * Surface map for shading, mipmapped so distant slopes filter instead of
   * shimmering. Deriving normals from the height texture per fragment gave
   * blocky bands (the bilinear derivative is piecewise constant); one filtered
   * lookup is both smoother and cheaper.
   *
   *   R,G  terrain gradient, signed-sqrt encoded for precision near flat
   *   B    water mask
   *   A    forest density
   */
  #buildSurfaceTexture() {
    const n = this.size;
    const h = this.heights;
    const step = this.step;
    const data = new Uint8Array(n * n * 4);
    const GMAX = 8;
    const enc = (g) => {
      const u = Math.sign(g) * Math.sqrt(Math.min(Math.abs(g) / GMAX, 1));
      return Math.max(0, Math.min(255, Math.round((u * 0.5 + 0.5) * 255)));
    };
    for (let j = 0; j < n; j++) {
      const jm = j > 0 ? j - 1 : 0;
      const jp = j < n - 1 ? j + 1 : n - 1;
      for (let i = 0; i < n; i++) {
        const im = i > 0 ? i - 1 : 0;
        const ip = i < n - 1 ? i + 1 : n - 1;
        const c = j * n + i;
        const gx = (h[j * n + ip] - h[j * n + im]) / ((ip - im) * step);
        const gz = (h[jp * n + i] - h[jm * n + i]) / ((jp - jm) * step);
        const q = c * 4;
        data[q] = enc(gx);
        data[q + 1] = enc(gz);
        data[q + 2] = this.water[c] * 255;
        data[q + 3] = Math.round(
          255 * this.forestAt(-this.halfSize + i * step, -this.halfSize + j * step)
        );
      }
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.surfaceTexture = tex;
    this.gradientMax = GMAX;
  }

  /**
   * @param {string} url PNG to fetch; the metadata sits beside it as .json.
   * @param {(fraction:number)=>void} onProgress
   * @param {{meta:object, png:string}} [embedded] base64 payload instead of a
   *   fetch, for the single-file build where there is nothing to fetch from.
   */
  static async load(url = 'data/jungfrau.png', onProgress = () => {}, embedded = null) {
    let meta;
    let blob;

    if (embedded) {
      meta = embedded.meta;
      const bin = atob(embedded.png);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: 'image/png' });
      onProgress(1);
    } else {
      meta = await fetch(url.replace(/\.png$/, '.json')).then((r) => r.json());

      // Stream the PNG so the loading bar reflects reality on a slow phone.
      const res = await fetch(url);
      if (!res.ok) throw new Error(`heightfield: HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 2.8e6;
      const chunks = [];
      let received = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(Math.min(0.98, received / total));
      }
      onProgress(1);
      blob = new Blob(chunks, { type: 'image/png' });
    }

    const bitmap = await createImageBitmap(blob);
    const { size } = meta;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, size, size).data;
    bitmap.close?.();

    const { bias, scale } = meta.encoding;
    const heights = new Float32Array(size * size);
    const water = new Uint8Array(size * size);
    for (let p = 0, q = 0; p < heights.length; p++, q += 4) {
      heights[p] = (px[q] * 256 + px[q + 1]) / scale - bias;
      water[p] = px[q + 2] > 127 ? 1 : 0;
    }

    let vegetation = null;
    const vegSize = meta.vegetation?.size;
    if (vegSize) {
      const vegBlob = embedded?.vegetation
        ? new Blob([bytesFromBase64(embedded.vegetation)], { type: 'image/png' })
        : await fetch(meta.vegetation.file).then((r) => r.blob());
      const vbm = await createImageBitmap(vegBlob);
      canvas.width = vegSize;
      canvas.height = vegSize;
      ctx.drawImage(vbm, 0, 0);
      const vpx = ctx.getImageData(0, 0, vegSize, vegSize).data;
      vbm.close?.();
      const data = new Uint8Array(vegSize * vegSize);
      for (let p = 0, q = 0; p < data.length; p++, q += 4) data[p] = vpx[q];
      vegetation = { data, size: vegSize };
    }

    return new Heightfield(meta, heights, water, vegetation);
  }

  #buildMips() {
    let level = { size: this.size, step: this.step, data: this.heights };
    this.mips.push(level);
    while (level.size > 48 && level.size % 2 === 0) {
      const n = level.size / 2;
      const data = new Float32Array(n * n);
      const src = level.data;
      const s = level.size;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          // Keep peaks from melting away: bias the box filter toward the max.
          const a = src[j * 2 * s + i * 2];
          const b = src[j * 2 * s + i * 2 + 1];
          const c = src[(j * 2 + 1) * s + i * 2];
          const d = src[(j * 2 + 1) * s + i * 2 + 1];
          const avg = (a + b + c + d) * 0.25;
          const max = Math.max(a, b, c, d);
          data[j * n + i] = avg * 0.78 + max * 0.22;
        }
      }
      level = { size: n, step: (this.halfSize * 2) / (n - 1), data };
      this.mips.push(level);
    }

    for (const mip of this.mips) {
      const tex = new THREE.DataTexture(mip.data, mip.size, mip.size, THREE.RedFormat, THREE.FloatType);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.internalFormat = 'R32F';
      tex.needsUpdate = true;
      this.mipTextures.push(tex);
    }
  }

  /** Grid coordinates (continuous, clamped to the valid bilinear range). */
  gridX(x) {
    return Math.min(this.size - 1.001, Math.max(0, (x + this.halfSize) / this.step));
  }

  gridZ(z) {
    return Math.min(this.size - 1.001, Math.max(0, (z + this.halfSize) / this.step));
  }

  /** Bilinear terrain height in metres at world (x, z). */
  heightAt(x, z) {
    const fx = this.gridX(x);
    const fz = this.gridZ(z);
    const i = fx | 0;
    const j = fz | 0;
    const dx = fx - i;
    const dz = fz - j;
    const s = this.size;
    const h = this.heights;
    const a = h[j * s + i];
    const b = h[j * s + i + 1];
    const c = h[(j + 1) * s + i];
    const d = h[(j + 1) * s + i + 1];
    return (a * (1 - dx) + b * dx) * (1 - dz) + (c * (1 - dx) + d * dx) * dz;
  }

  /** Surface normal at world (x, z), sampled over `spread` metres. */
  normalAt(x, z, spread = this.step, out = new THREE.Vector3()) {
    const hl = this.heightAt(x - spread, z);
    const hr = this.heightAt(x + spread, z);
    const hd = this.heightAt(x, z - spread);
    const hu = this.heightAt(x, z + spread);
    return out.set(hl - hr, 2 * spread, hd - hu).normalize();
  }

  isWater(x, z) {
    const i = Math.round(this.gridX(x));
    const j = Math.round(this.gridZ(z));
    return this.water[j * this.size + i] === 1;
  }

  inBounds(x, z, margin = 0) {
    const lim = this.halfSize - margin;
    return x > -lim && x < lim && z > -lim && z < lim;
  }
}

// ---------------------------------------------------------------- noise ---
// Small deterministic value-noise, used only for the baked masks.
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

export function fbm2(x, y, octaves = 4) {
  let amp = 0.5;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (vnoise2(x, y) * 2 - 1);
    const nx = 0.8 * x + 0.6 * y;
    const ny = -0.6 * x + 0.8 * y;
    x = nx * 2.02;
    y = ny * 2.02;
    amp *= 0.5;
  }
  return sum;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
