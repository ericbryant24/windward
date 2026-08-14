/**
 * One source of truth for the atmosphere. These values are injected into the
 * GLSL sky model and used by the JavaScript mirror that computes the sun and
 * ambient light the meshes receive, so the dome and the lighting can never
 * drift apart.
 */
export const ATMO = {
  /** Vertical optical depth at sea level, one air mass, R/G/B. */
  betaR: [0.053, 0.104, 0.235],
  /** Aerosol optical depth at sea level, one air mass (grey). */
  betaM: 0.021,
  /** Mie asymmetry: how tight the solar aureole is. */
  mieG: 0.74,
  /**
   * Fraction of scattering that is aerosol. Weighting the two phase functions
   * by their share of the total is what keeps the aureole from outshining the
   * rest of the dome.
   */
  mieShare: 0.17,
  /** Converts single-scatter fractions into the renderer's radiance units. */
  gain: 13.0,
  /** Multiple-scattering fill, which lifts the dome and the anti-solar sky. */
  msFill: 0.34,
  msTint: [0.44, 0.58, 0.86],
  /**
   * Single scattering along a flat-earth ray would brighten without limit
   * toward the horizon; curvature and the sun's own longer path cap it.
   */
  scatterAirMassCap: 5.5,
  /** Where the horizon starts washing out to grey, and how far it goes. */
  paleFrom: 1.5,
  paleTo: 7.0,
  paleAmount: 0.6,
};

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(', ')})`;
const f = (x) => x.toFixed(5);

/** GLSL declarations matching ATMO. */
export const ATMO_GLSL = /* glsl */ `
const vec3 BETA_R = ${v3(ATMO.betaR)};
const float BETA_M = ${f(ATMO.betaM)};
const float MIE_G = ${f(ATMO.mieG)};
const float MIE_SHARE = ${f(ATMO.mieShare)};
const float SKY_GAIN = ${f(ATMO.gain)};
const float MS_FILL = ${f(ATMO.msFill)};
const vec3 MS_TINT = ${v3(ATMO.msTint)};
const float SCATTER_AM_CAP = ${f(ATMO.scatterAirMassCap)};
const float PALE_FROM = ${f(ATMO.paleFrom)};
const float PALE_TO = ${f(ATMO.paleTo)};
const float PALE_AMOUNT = ${f(ATMO.paleAmount)};
`;
