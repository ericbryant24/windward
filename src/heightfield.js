import * as THREE from '../vendor/three.module.js';

/**
 * The baked Jungfrau heightfield: CPU copy for physics and placement, plus a
 * mip pyramid of R32F textures the terrain shader samples in the vertex stage.
 *
 * World space is metres: +X east, +Z south, +Y up, origin at the region centre.
 */
export class Heightfield {
  constructor(meta, heights, water) {
    this.meta = meta;
    this.size = meta.size;
    this.step = meta.step;
    this.halfSize = meta.halfSize;
    this.minHeight = meta.minHeight;
    this.maxHeight = meta.maxHeight;
    this.heights = heights;
    this.water = water;

    this.mips = [];
    this.mipTextures = [];
    this.#buildMips();
    this.#buildSurfaceTexture();
  }

  /**
   * Surface map for shading, mipmapped so distant slopes filter instead of
   * shimmering. Deriving normals from the height texture per fragment gave
   * blocky bands (the bilinear derivative is piecewise constant); one filtered
   * lookup is both smoother and cheaper.
   *
   *   R,G  terrain gradient, signed-sqrt encoded for precision near flat
   *   B    water mask
   *   A    local relief over a 3x3 cell, for texture variation
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
        let lo = Infinity;
        let hi = -Infinity;
        for (const jj of [jm, j, jp]) {
          for (const ii of [im, i, ip]) {
            const v = h[jj * n + ii];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        const q = c * 4;
        data[q] = enc(gx);
        data[q + 1] = enc(gz);
        data[q + 2] = this.water[c] * 255;
        data[q + 3] = Math.min(255, Math.round(((hi - lo) / step) * 90));
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

  static async load(url = 'data/jungfrau.png', onProgress = () => {}) {
    const meta = await fetch(url.replace(/\.png$/, '.json')).then((r) => r.json());

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

    const blob = new Blob(chunks, { type: 'image/png' });
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
    return new Heightfield(meta, heights, water);
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
