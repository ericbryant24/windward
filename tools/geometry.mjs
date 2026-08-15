/** Polygon helpers shared by the baking tools. */

/**
 * Chain a multipolygon's member ways into closed rings.
 *
 * Members do not arrive in ring order and a single ring is often split across
 * dozens of ways — Lake Michigan's outer boundary is 742 of them — so each ring
 * has to be grown from both ends until it closes on itself. Filling the
 * fragments individually paints nonsense.
 */
export function assembleRings(members) {
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const open = members.filter((m) => m.length >= 2);
  const byEnd = new Map();
  open.forEach((way, i) => {
    for (const p of [way[0], way[way.length - 1]]) {
      const k = key(p);
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(i);
    }
  });

  const used = new Uint8Array(open.length);
  const rings = [];
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let ring = open[i].slice();
    for (const forward of [true, false]) {
      for (;;) {
        if (ring.length > 2 && key(ring[0]) === key(ring[ring.length - 1])) break;
        const tip = forward ? ring[ring.length - 1] : ring[0];
        const next = (byEnd.get(key(tip)) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const w = open[next];
        const aligned = key(w[0]) === key(tip) ? w : w.slice().reverse();
        ring = forward ? ring.concat(aligned.slice(1)) : aligned.slice(0, -1).concat(ring);
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

export function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

export function pointInRing(px, pz, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Drop duplicate and near-collinear corners; OSM rings carry plenty of both. */
export function simplify(ring, tolerance = 0.35) {
  let out = ring.filter((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > tolerance;
  });
  if (out.length < 3) return out;
  for (let pass = 0; pass < 3 && out.length > 4; pass++) {
    const keep = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const ax = c[0] - a[0];
      const az = c[1] - a[1];
      const len = Math.hypot(ax, az) || 1;
      const d = Math.abs((b[0] - a[0]) * az - (b[1] - a[1]) * ax) / len;
      if (d > tolerance) keep.push(b);
    }
    if (keep.length < 4 || keep.length === out.length) break;
    out = keep;
  }
  return out;
}

/** Minimum-area enclosing rectangle, brute-forced over edge directions. */
export function orientedBox(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const ex = ring[j][0] - ring[i][0];
    const ez = ring[j][1] - ring[i][1];
    const len = Math.hypot(ex, ez);
    if (len < 0.2) continue;
    const ux = ex / len;
    const uz = ez / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [px, pz] of ring) {
      const u = px * ux + pz * uz;
      const v = -px * uz + pz * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uz, minU, maxU, minV, maxV };
  }
  if (!best) return null;
  const cu = (best.minU + best.maxU) / 2;
  const cv = (best.minV + best.maxV) / 2;
  return {
    cx: cu * best.ux - cv * best.uz,
    cz: cu * best.uz + cv * best.ux,
    width: best.maxU - best.minU,
    depth: best.maxV - best.minV,
    angle: Math.atan2(best.uz, best.ux),
  };
}

/**
 * Parse an OSM length: bare metres, "23 m", or feet as `12'6"` / "40 ft".
 * Returns NaN for anything unparseable so callers can fall back to inference.
 */
export function parseLength(value) {
  if (value === undefined || value === null) return NaN;
  const s = String(value).trim().replace(/,/g, '');
  let m = s.match(/^([\d.]+)\s*'\s*(?:([\d.]+)\s*")?$/);
  if (m) return (parseFloat(m[1]) * 12 + parseFloat(m[2] ?? '0')) * 0.0254;
  m = s.match(/^([\d.]+)\s*(?:ft|feet)$/i);
  if (m) return parseFloat(m[1]) * 0.3048;
  m = s.match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : NaN;
}
