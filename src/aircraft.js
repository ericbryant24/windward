import * as THREE from '../vendor/three.module.js';
import { makeLitMaterial, loft, airfoil } from './materials.js';

/**
 * The ship: a 15-metre sailplane built procedurally so it ships as code rather
 * than a model file. Nose points down -Z to match the flight model.
 */
export function createAircraft(sky) {
  const group = new THREE.Group();

  const shell = makeLitMaterial(sky, {
    color: new THREE.Color(0.78, 0.79, 0.80),
    roughness: 0.16,
    fresnel: 0.5,
  });
  const trim = makeLitMaterial(sky, {
    color: new THREE.Color(0.55, 0.09, 0.06),
    roughness: 0.22,
    fresnel: 0.4,
  });
  const canopyMat = makeLitMaterial(sky, {
    color: new THREE.Color(0.05, 0.09, 0.13),
    roughness: 0.03,
    fresnel: 0.95,
    opacity: 0.62,
    transparent: true,
    side: THREE.DoubleSide,
  });

  // ---- fuselage: pod and boom ------------------------------------------
  const fuseProfile = [];
  const ring = 12;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    fuseProfile.push([Math.cos(a), Math.sin(a)]);
  }
  const stations = [
    [-3.4, 0.05, 0.05, 0.02],
    [-3.0, 0.22, 0.2, 0.0],
    [-2.3, 0.36, 0.34, -0.03],
    [-1.2, 0.42, 0.44, -0.05],
    [0.0, 0.40, 0.46, -0.02],
    [1.2, 0.30, 0.34, 0.03],
    [2.6, 0.17, 0.18, 0.06],
    [4.2, 0.09, 0.10, 0.09],
    [5.4, 0.07, 0.09, 0.11],
  ];
  const fuse = loft(
    stations.map(([z, sx, sy, oy]) => ({
      points: fuseProfile,
      origin: new THREE.Vector3(0, oy, z),
      scaleX: sx,
      scaleY: sy,
    }))
  );
  group.add(new THREE.Mesh(fuse, shell));

  // ---- wings -------------------------------------------------------------
  const foil = airfoil(12, 0.115, 0.022);
  // Slight dihedral and taper toward the tip, swept just enough to look right.
  const WING = [
    [0.0, 0.95, 0.0, 0.0],
    [1.6, 0.92, 0.06, 0.02],
    [4.2, 0.80, 0.20, 0.06],
    [6.3, 0.62, 0.38, 0.12],
    [7.35, 0.34, 0.52, 0.2],
    [7.55, 0.10, 0.58, 0.26],
  ];
  const buildWing = (sign) => {
    const secs = WING.map(([span, chord, rise, sweep]) => ({
      points: foil,
      origin: new THREE.Vector3(0, -0.03 + rise, -0.15 + sweep),
      scaleX: chord,
      scaleY: chord,
      spanAt: sign * span,
    }));
    const positions = [];
    const indices = [];
    const n = foil.length;
    for (const s of secs) {
      for (const [px, py] of s.points) {
        // px runs along the chord (world Z), py is thickness (world Y)
        positions.push(s.spanAt, s.origin.y + py * s.scaleY * 0.9, s.origin.z + px * s.scaleX);
      }
    }
    for (let i = 0; i < secs.length - 1; i++) {
      for (let j = 0; j < n; j++) {
        const j2 = (j + 1) % n;
        const a = i * n + j;
        const b = i * n + j2;
        const c = (i + 1) * n + j;
        const d = (i + 1) * n + j2;
        if (sign > 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
    const root = positions.length / 3;
    positions.push(secs[0].spanAt, secs[0].origin.y, secs[0].origin.z);
    for (let j = 0; j < n; j++) {
      if (sign > 0) indices.push(root, (j + 1) % n, j);
      else indices.push(root, j, (j + 1) % n);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  };
  group.add(new THREE.Mesh(buildWing(1), shell));
  group.add(new THREE.Mesh(buildWing(-1), shell));

  // ---- tail --------------------------------------------------------------
  const finGeom = buildPanel(
    [
      [4.5, 0.1, 0.62],
      [5.35, 1.45, 0.32],
    ],
    0.05,
    'vertical'
  );
  group.add(new THREE.Mesh(finGeom, shell));

  const stabGeom = buildPanel(
    [
      [5.15, 1.5, 0.42],
      [5.3, 1.5, 0.42],
    ],
    0.05,
    'horizontal',
    1.35
  );
  group.add(new THREE.Mesh(stabGeom, shell));

  // ---- canopy ------------------------------------------------------------
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), canopyMat);
  canopy.scale.set(0.36, 0.34, 1.35);
  canopy.position.set(0, 0.24, -1.55);
  group.add(canopy);

  // ---- nose flash and wingtip trim --------------------------------------
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), trim);
  nose.scale.set(0.23, 0.22, 0.55);
  nose.position.set(0, 0.02, -3.15);
  group.add(nose);

  for (const sign of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), trim);
    tip.scale.set(0.16, 0.07, 0.34);
    tip.position.set(sign * 7.5, 0.24, 0.08);
    group.add(tip);
  }

  group.userData.materials = [shell, trim, canopyMat];
  return group;
}

/**
 * Flat tapered panel used for the tail surfaces.
 * spec: [[z, extent, chord], ...] from root to tip.
 */
function buildPanel(spec, thickness, orientation, sweepScale = 1) {
  const positions = [];
  const indices = [];
  const foil = airfoil(8, 0.14, 0);
  const n = foil.length;
  const sections = [];
  if (orientation === 'vertical') {
    const [[z0, y0, c0], [z1, y1, c1]] = spec;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      sections.push({
        along: y0 + (y1 - y0) * t,
        z: z0 + (z1 - z0) * t,
        chord: c0 + (c1 - c0) * t,
      });
    }
    for (const s of sections) {
      for (const [px, py] of foil) positions.push(py * thickness * 8, s.along, s.z + px * s.chord);
    }
  } else {
    const [[z0, span, chord]] = spec;
    const steps = 4;
    for (let i = -steps; i <= steps; i++) {
      const t = i / steps;
      sections.push({
        along: t * span * sweepScale * 0.5,
        z: z0 + Math.abs(t) * 0.12,
        chord: chord * (1 - 0.45 * Math.abs(t)),
      });
    }
    for (const s of sections) {
      for (const [px, py] of foil) positions.push(s.along, 1.32 + py * thickness * 6, s.z + px * s.chord);
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
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}
