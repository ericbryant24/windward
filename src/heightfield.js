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

  /**
   * March a ray against the heightfield. Returns the hit distance or -1.
   * Coarse steps with a bisection refine — good enough for gameplay probes.
   */
  raycast(origin, dir, maxDist = 4000, step = 12) {
    let prev = origin.y - this.heightAt(origin.x, origin.z);
    for (let t = step; t < maxDist; t += step) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const d = y - this.heightAt(x, z);
      if (d <= 0) {
        const frac = prev / (prev - d);
        return t - step + frac * step;
      }
      prev = d;
    }
    return -1;
  }
}
