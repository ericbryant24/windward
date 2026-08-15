/**
 * Bakes the OSM transport network into the game's format.
 *
 * OSM stores a railway as dozens of disconnected fragments, split wherever a
 * tag changes. A train needs a line to run along, so fragments of the same
 * kind that share an endpoint are chained into continuous routes here, at bake
 * time, rather than every frame at runtime.
 *
 *   node tools/fetch-network.mjs && node tools/bake-network.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const META = JSON.parse(await readFile('data/jungfrau.json', 'utf8'));
const MPD_LAT = 111320;
const MPD_LON = 111320 * Math.cos((META.centerLat * Math.PI) / 180);
const HALF = META.halfSize;

export const KIND = {
  MAJOR_ROAD: 0,
  MINOR_ROAD: 1,
  TRACK: 2,
  PATH: 3,
  NARROW_GAUGE: 4,
  RAIL: 5,
  FUNICULAR: 6,
  CABLE_CAR: 7,
  CHAIRLIFT: 8,
};

/** Simplification tolerance in metres, and whether movers can use the kind. */
const KIND_INFO = {
  0: { tol: 2.0, chain: true, movers: 'car' },
  1: { tol: 2.5, chain: true, movers: 'car' },
  2: { tol: 5.0, chain: false, movers: null },
  3: { tol: 6.0, chain: false, movers: null },
  4: { tol: 1.5, chain: true, movers: 'train' },
  5: { tol: 1.5, chain: true, movers: 'train' },
  6: { tol: 1.5, chain: true, movers: 'train' },
  7: { tol: 0.5, chain: true, movers: 'cabin' },
  8: { tol: 0.5, chain: true, movers: 'chair' },
};

function classify(tags) {
  if (tags.aerialway) {
    const a = tags.aerialway;
    if (a === 'cable_car' || a === 'gondola' || a === 'mixed_lift' || a === 'goods') return KIND.CABLE_CAR;
    if (a === 'chair_lift') return KIND.CHAIRLIFT;
    return null; // drag lifts and rope tows are invisible from the air
  }
  if (tags.railway) {
    const r = tags.railway;
    if (r === 'funicular') return KIND.FUNICULAR;
    if (r === 'narrow_gauge' || r === 'tram' || r === 'light_rail' || r === 'miniature') return KIND.NARROW_GAUGE;
    if (r === 'rail' || r === 'subway' || r === 'monorail') return KIND.RAIL;
    return null;
  }
  const h = tags.highway;
  if (!h) return null;
  if (/^(motorway|trunk|primary|secondary)(_link)?$/.test(h)) return KIND.MAJOR_ROAD;
  if (/^(tertiary(_link)?|residential|unclassified|living_street|service|pedestrian|cycleway)$/.test(h)) {
    return KIND.MINOR_ROAD;
  }
  if (h === 'track') return KIND.TRACK;
  if (/^(path|footway|steps|bridleway)$/.test(h)) return KIND.PATH;
  return null;
}

const project = (lat, lon) => [(lon - META.centerLon) * MPD_LON, (META.centerLat - lat) * MPD_LAT];

/** Douglas-Peucker. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[a][0];
    const az = pts[a][1];
    const bx = pts[b][0];
    const bz = pts[b][1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ------------------------------------------------------------------ read ---
const raw = JSON.parse(await readFile('.cache/osm-network.json', 'utf8'));
console.log(`read ${raw.length} OSM ways`);

const segments = [];
for (const el of raw) {
  const kind = classify(el.tags ?? {});
  if (kind === null || !el.geometry || el.geometry.length < 2) continue;
  const pts = el.geometry.map((p) => project(p.lat, p.lon));
  // clip to the play area rather than letting ribbons run off the map edge
  if (pts.every((p) => Math.abs(p[0]) > HALF || Math.abs(p[1]) > HALF)) continue;
  segments.push({ kind, pts, name: el.tags?.name });
}
console.log(`classified ${segments.length} ways`);

// ----------------------------------------------------------------- chain ---
/**
 * Join fragments that share an endpoint into continuous runs. At a junction
 * the straightest continuation wins, which keeps a railway following its own
 * line instead of turning off down a siding.
 */
function chainAll(list) {
  const key = (p) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`;
  const ends = new Map();
  list.forEach((seg, i) => {
    for (const p of [seg.pts[0], seg.pts[seg.pts.length - 1]]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });

  const used = new Uint8Array(list.length);
  const routes = [];
  const heading = (pts, fromEnd) => {
    const n = pts.length;
    const [a, b] = fromEnd ? [pts[n - 2], pts[n - 1]] : [pts[1], pts[0]];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };

  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let pts = list[i].pts.slice();
    const name = list[i].name;

    // extend from both ends
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? pts[pts.length - 1] : pts[0];
        const dir = heading(pts, forward);
        const candidates = (ends.get(key(tip)) ?? []).filter((j) => !used[j]);
        let best = -1;
        let bestDot = 0.2; // reject sharp turns; that is a junction, not a continuation
        let bestFlip = false;
        for (const j of candidates) {
          const other = list[j].pts;
          const atStart = key(other[0]) === key(tip);
          const d = heading(atStart ? other : other.slice().reverse(), false);
          const dot = -(dir[0] * d[0] + dir[1] * d[1]);
          if (dot > bestDot) {
            bestDot = dot;
            best = j;
            bestFlip = !atStart;
          }
        }
        if (best < 0) break;
        used[best] = 1;
        const add = bestFlip ? list[best].pts.slice().reverse() : list[best].pts.slice();
        if (forward) pts = pts.concat(add.slice(1));
        else pts = add.slice(0, -1).reverse().concat(pts);
      }
    }
    routes.push({ kind: list[i].kind, pts, name });
  }
  return routes;
}

const byKind = new Map();
for (const s of segments) {
  if (!byKind.has(s.kind)) byKind.set(s.kind, []);
  byKind.get(s.kind).push(s);
}

const ways = [];
for (const [kind, list] of byKind) {
  const info = KIND_INFO[kind];
  const chained = info.chain ? chainAll(list) : list;
  for (const w of chained) {
    let pts = simplify(w.pts, info.tol);
    if (pts.length < 2) continue;
    // split anything too long for the int16 offsets to reach
    const chunks = [];
    let current = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      current.push(pts[i]);
      const ox = current[0][0];
      const oz = current[0][1];
      if (Math.abs(pts[i][0] - ox) > 14000 || Math.abs(pts[i][1] - oz) > 14000 || current.length >= 1200) {
        chunks.push(current);
        current = [pts[i]];
      }
    }
    if (current.length > 1) chunks.push(current);
    for (const c of chunks) {
      let length = 0;
      for (let i = 1; i < c.length; i++) length += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
      ways.push({ kind, pts: c, length, name: w.name });
    }
  }
  console.log(`  kind ${kind}: ${list.length} fragments -> ${chained.length} runs`);
}

ways.sort((a, b) => a.kind - b.kind || b.length - a.length);
const pointTotal = ways.reduce((s, w) => s + w.pts.length, 0);
console.log(`${ways.length} ways, ${pointTotal} points`);

// ---------------------------------------------------------------- encode ---
const SCALE = 2; // half-metre resolution
const bytes = 16 + ways.length * 8 + pointTotal * 4;
const buf = Buffer.alloc(bytes);
let o = 0;
buf.write('WNET', o);
o += 4;
buf.writeUInt16LE(1, o);
o += 2;
buf.writeUInt16LE(0, o);
o += 2;
buf.writeUInt32LE(ways.length, o);
o += 4;
buf.writeUInt32LE(pointTotal, o);
o += 4;

const routeCounts = {};
for (const w of ways) {
  const info = KIND_INFO[w.kind];
  const minRoute = w.kind >= KIND.CABLE_CAR ? 150 : w.kind >= KIND.NARROW_GAUGE ? 500 : 700;
  const canMove = info.movers && w.length > minRoute ? 1 : 0;
  if (canMove) routeCounts[info.movers] = (routeCounts[info.movers] ?? 0) + 1;

  const ox = Math.round(w.pts[0][0]);
  const oz = Math.round(w.pts[0][1]);
  buf.writeUInt8(w.kind, o);
  o += 1;
  buf.writeUInt8(canMove, o);
  o += 1;
  buf.writeUInt16LE(w.pts.length, o);
  o += 2;
  buf.writeInt16LE(ox, o);
  o += 2;
  buf.writeInt16LE(oz, o);
  o += 2;
  for (const [px, pz] of w.pts) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((px - ox) * SCALE))), o);
    o += 2;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((pz - oz) * SCALE))), o);
    o += 2;
  }
}

const gz = gzipSync(buf, { level: 9 });
await mkdir('data', { recursive: true });
await writeFile('data/network.bin.gz', gz);
await writeFile(
  'data/network.json',
  JSON.stringify(
    {
      generator: 'tools/bake-network.mjs',
      source: 'OpenStreetMap contributors, ODbL — see ATTRIBUTION.md',
      ways: ways.length,
      points: pointTotal,
      pointScale: SCALE,
      kinds: KIND,
      routes: routeCounts,
      note: 'Fragments sharing an endpoint are chained into continuous runs so trains and cable cars have a line to follow.',
    },
    null,
    2
  )
);
console.log(`routes for movers: ${JSON.stringify(routeCounts)}`);
console.log(`raw ${(bytes / 1048576).toFixed(2)} MB -> gzip ${(gz.length / 1048576).toFixed(2)} MB`);
