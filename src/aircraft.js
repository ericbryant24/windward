import * as THREE from '../vendor/three.module.js';
import { makeLitMaterial, loft, airfoil } from './materials.js';
import { getAircraft } from './fleet.js';

/**
 * The ship, built procedurally from the chosen aircraft's `look` block so it
 * ships as code rather than as four model files. Nose points down -Z to match
 * the flight model.
 *
 * Everything here is driven off the same spec the physics reads, so a 29-metre
 * open-class ship really does have twice the span of the trainer on screen.
 */
export function createAircraft(sky, spec = getAircraft()) {
  const look = spec.look;
  const group = new THREE.Group();

  const shell = makeLitMaterial(sky, {
    color: new THREE.Color(...look.body),
    roughness: look.matte ? 0.42 : 0.16,
    fresnel: look.matte ? 0.2 : 0.5,
  });
  const trim = makeLitMaterial(sky, {
    color: new THREE.Color(...look.trim),
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
  const materials = [shell, trim, canopyMat];

  const L = look.fuseLength;
  const W = look.fuseWidth;

  // ---- fuselage: pod and boom ------------------------------------------
  const fuseProfile = [];
  const ring = 12;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    fuseProfile.push([Math.cos(a), Math.sin(a)]);
  }
  const stations = look.fuse ?? [
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
      origin: new THREE.Vector3(0, oy, z * L),
      scaleX: sx * W,
      scaleY: sy * W,
    }))
  );
  group.add(new THREE.Mesh(fuse, shell));

  // ---- wings -------------------------------------------------------------
  const foil = airfoil(12, look.foil ?? 0.115, 0.022);
  // Fractions of half-span, root chord, tip rise and tip sweep. One shape for
  // every ship; the spec stretches it. taperPower under 1 fattens the tip into
  // a trainer's near-constant chord, over 1 draws it out into a racing planform.
  // The sweep column now ends at 1 like the rise column, so look.sweep is
  // simply where the tip ends up. It used to stop at 0.274 while the tip trim
  // and the winglet were hung at the full value, so they sat behind their own
  // wing; harmless at a glider's 0.26 and unmissable at the Javelin's two
  // metres. Each ship's sweep was scaled by the same 3.65 to keep it put.
  const PLANFORM = [
    [0.0, 1.0, 0.0, 0.0],
    [0.212, 0.968, 0.104, 0.077],
    [0.556, 0.842, 0.345, 0.23],
    [0.834, 0.653, 0.655, 0.46],
    [0.974, 0.358, 0.897, 0.77],
    [1.0, 0.105, 1.0, 1.0],
  ];
  const buildWing = (sign) => {
    const secs = PLANFORM.map(([f, chordF, riseF, sweepF]) => {
      const chord = look.chord * Math.pow(chordF, look.taperPower);
      return {
        points: foil,
        origin: new THREE.Vector3(0, look.wingY + riseF * look.dihedral, look.wingZ + sweepF * look.sweep),
        scaleX: chord,
        scaleY: chord,
        spanAt: sign * f * look.span,
      };
    });
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
  const T = look.tail;
  const finGeom = buildPanel(
    [
      [4.5 * L, 0.1, 0.62 * T],
      [5.35 * L, 1.45 * T, 0.32 * T],
    ],
    0.05,
    'vertical'
  );
  group.add(new THREE.Mesh(finGeom, shell));

  const stabGeom = buildPanel(
    [[5.15 * L, 1.5 * T, 0.42 * T]], 0.05, 'horizontal', 1.35, 1.32 * T);
  group.add(new THREE.Mesh(stabGeom, shell));

  // ---- canopy ------------------------------------------------------------
  const C = look.canopy;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), canopyMat);
  canopy.scale.set(0.36 * W * C, 0.34 * C, 1.35 * L * C);
  canopy.position.set(0, 0.24, -1.55 * L);
  group.add(canopy);

  // ---- nose flash and wingtip trim --------------------------------------
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), trim);
  nose.scale.set(0.23 * W, 0.22 * W, 0.55 * L);
  nose.position.set(0, 0.02, -3.15 * L);
  group.add(nose);

  const tipChord = look.chord * Math.pow(0.105, look.taperPower);
  for (const sign of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), trim);
    tip.scale.set(0.16, 0.07, tipChord * 0.6 + 0.1);
    tip.position.set(sign * look.span * 0.995, look.wingY + look.dihedral, look.wingZ + look.sweep);
    group.add(tip);

    // A winglet is what a long thin wing does instead of a wingtip: it reads
    // at a distance as the extra span it effectively is.
    if (look.winglet) {
      const wl = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), shell);
      wl.scale.set(0.05, look.winglet, tipChord * 0.75);
      wl.position.set(sign * look.span, look.wingY + look.dihedral + look.winglet * 0.85, look.wingZ + look.sweep);
      wl.rotation.z = -sign * 0.12;
      group.add(wl);
    }
  }

  // ---- struts: what a parasol wing sits on -------------------------------
  if (look.strut) {
    for (const sign of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), trim);
      const top = new THREE.Vector3(sign * look.span * 0.5, look.wingY + look.dihedral * 0.5, look.wingZ + 0.2);
      const foot = new THREE.Vector3(sign * 0.28 * W, -0.32, -0.4 * L);
      strut.position.copy(top).add(foot).multiplyScalar(0.5);
      strut.scale.y = top.distanceTo(foot);
      strut.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3().subVectors(top, foot).normalize()
      );
      group.add(strut);
    }
  }

  // ---- turbine: intakes, tailpipe, and the flame out the back ------------
  // What tells a jet from a glider at half a kilometre is the holes, so the
  // intake mouths and the nozzle are their own near-black discs rather than
  // shading on the fairing.
  let flame = null;
  let flameMat = null;
  if (look.jet) {
    const duct = makeLitMaterial(sky, {
      color: new THREE.Color(0.04, 0.045, 0.055),
      roughness: 0.75,
      fresnel: 0.08,
    });
    materials.push(duct);

    for (const sign of [-1, 1]) {
      const trunk = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), shell);
      trunk.scale.set(0.26 * W, 0.25 * W, 1.35 * L);
      trunk.position.set(sign * 0.6 * W, 0.04, -0.45 * L);
      group.add(trunk);

      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.2 * W, 14), duct);
      mouth.position.set(sign * 0.6 * W, 0.04, -1.72 * L);
      mouth.rotation.y = Math.PI; // facing the airflow, which comes down -Z
      group.add(mouth);
    }

    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * W, 0.28 * W, 1.0 * L, 14, 1, true), shell);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(0, 0.06, 5.1 * L);
    group.add(pipe);

    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.27 * W, 14), duct);
    nozzle.position.set(0, 0.06, 5.58 * L);
    group.add(nozzle);

    // A hot nozzle rather than a rocket plume. Anything longer reads as a paper
    // dart taped to the tail — the turbine has to say "lit" at chase-camera
    // distance and then get out of the way of the aeroplane.
    flameMat = makeLitMaterial(sky, {
      color: new THREE.Color(0.5, 0.16, 0.03),
      emissive: new THREE.Color(1.0, 0.44, 0.12),
      emissiveStrength: 2.4,
      roughness: 1,
      fresnel: 0,
      opacity: 0,
      transparent: true,
    });
    materials.push(flameMat);
    flame = new THREE.Mesh(new THREE.ConeGeometry(0.2 * W, 0.85 * L, 12, 1, true), flameMat);
    flame.rotation.x = -Math.PI / 2; // apex aft, so it tapers away from the ship
    flame.position.set(0, 0.06, 5.62 * L + 0.42 * L);
    group.add(flame);
  }

  // ---- pusher propeller --------------------------------------------------
  let prop = null;
  let discMat = null;
  if (look.prop) {
    prop = new THREE.Group();
    prop.position.set(0, look.wingY * 0.4 + 0.1, 1.35 * L);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), trim);
    prop.add(hub);
    for (const sign of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), trim);
      blade.scale.set(0.34, 0.07, 0.045);
      blade.position.set(sign * 0.38, 0, 0);
      blade.rotation.z = sign * 0.3;
      prop.add(blade);
    }
    discMat = makeLitMaterial(sky, {
      color: new THREE.Color(0.7, 0.72, 0.75),
      roughness: 0.5,
      opacity: 0.06,
      transparent: true,
      side: THREE.DoubleSide,
    });
    materials.push(discMat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.72, 20), discMat);
    prop.add(disc);
    group.add(prop);
  }

  group.userData.materials = materials;
  group.userData.spec = spec;
  /** Only the engine moves, and only when there is fuel going through it. */
  group.userData.animate = (dt, glider) => {
    if (prop) {
      const rate = glider.boosting ? 46 : 6 + glider.airspeed * 0.3;
      prop.rotation.z += rate * dt;
      discMat.uniforms.uOpacity.value = glider.boosting ? 0.34 : 0.08;
    }
    if (flame) {
      // Lit or out, with nothing in between, and never quite steady while lit.
      flameMat.uniforms.uPulse.value += dt * 47;
      const want = glider.boosting ? 0.62 : 0;
      flameMat.uniforms.uOpacity.value = THREE.MathUtils.damp(flameMat.uniforms.uOpacity.value, want, 14, dt);
      flame.visible = flameMat.uniforms.uOpacity.value > 0.01;
    }
  };
  return group;
}

/** Free every buffer and program the ship owns, so swapping ships cannot leak. */
export function disposeAircraft(group) {
  group.traverse((o) => o.geometry?.dispose());
  for (const m of group.userData.materials) m.dispose();
}

/**
 * Flat tapered panel used for the tail surfaces.
 * spec: [[z, extent, chord], ...] from root to tip.
 */
function buildPanel(spec, thickness, orientation, sweepScale = 1, stabY = 1.32) {
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
      for (const [px, py] of foil) positions.push(s.along, stabY + py * thickness * 6, s.z + px * s.chord);
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
