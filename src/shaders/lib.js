/**
 * Shared GLSL: hash/noise, the analytic sky model, and the aerial perspective
 * that ties terrain, water and clouds into the same atmosphere.
 *
 * Everything works in linear HDR; the renderer applies ACES + sRGB at the end.
 */
import { ATMO_GLSL } from './atmosphere-constants.js';

export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// value noise, quintic interpolation
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), u.x),
             mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), u.x), u.y) * 2.0 - 1.0;
}

float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y),
    u.z);
  return n * 2.0 - 1.0;
}

float fbm(vec2 p, int octaves){
  float a = 0.5, s = 0.0;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    s += a * vnoise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return s;
}

float fbm3(vec3 p, int octaves){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= octaves) break;
    s += a * vnoise3(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

// ridged noise — the family of shapes that reads as eroded rock
float ridged(vec2 p, int octaves){
  float a = 0.5, s = 0.0;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    s += a * (1.0 - abs(vnoise(p)));
    p = rot * p * 2.07;
    a *= 0.5;
  }
  return s;
}
`;

/**
 * Analytic clear-sky radiance. Not a full Nishita integral — it is a tuned
 * two-term (Rayleigh + Mie) model with an air-mass driven transmittance, which
 * is cheap enough to also evaluate per-fragment for aerial perspective while
 * still reddening believably at low sun angles.
 */
export const SKY = /* glsl */ `
uniform vec3 uSunDir;        // points toward the sun
uniform vec3 uSunColor;      // radiance of the solar disc (pre-extinction)
uniform float uHaze;         // 0.4 crisp .. 1.6 murky
uniform float uExposure;

${ATMO_GLSL}

// Kasten-Young relative air mass; 1 at the zenith, ~34 at the horizon.
float airMass(float cosZenith){
  float c = clamp(cosZenith, 0.0, 1.0);
  float zDeg = degrees(acos(c));
  return 1.0 / (c + 0.50572 * pow(max(96.07995 - zDeg, 0.05), -1.6364));
}

float rayleighPhase(float c){ return 0.05968310365 * (1.0 + c * c); }

float hgPhase(float c, float g){
  float g2 = g * g;
  return 0.07957747 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

/** Sun colour after travelling through the atmosphere to the observer. */
vec3 sunTransmittance(vec3 sunDir){
  float m = airMass(sunDir.y);
  return exp(-(BETA_R + vec3(BETA_M * uHaze)) * m);
}

/** Radiance of the sky in direction d (unit), excluding the solar disc. */
vec3 skyRadiance(vec3 d, vec3 sunDir){
  float cosT = clamp(dot(d, sunDir), -1.0, 1.0);
  float m = airMass(d.y);

  vec3 tSun = sunTransmittance(sunDir);
  vec3 sun = uSunColor * tSun;

  float mScat = min(m, SCATTER_AM_CAP);
  vec3 opticalR = BETA_R * mScat;
  float opticalM = BETA_M * mScat * uHaze;

  // Both phase functions are normalised, so each species contributes in
  // proportion to its share of the scattering.
  vec3 inR = (1.0 - exp(-opticalR)) * rayleighPhase(cosT) * (1.0 - MIE_SHARE);
  float inM = (1.0 - exp(-opticalM)) * hgPhase(cosT, MIE_G) * MIE_SHARE;

  vec3 col = sun * (inR + vec3(inM)) * SKY_GAIN;

  // cheap stand-in for multiple scattering: keeps the anti-solar sky from
  // going black and lifts the whole dome when the sun is low
  col += uSunColor * MS_TINT * (1.0 - exp(-opticalR * 0.55)) * MS_FILL *
         (0.30 + 0.70 * smoothstep(-0.10, 0.30, sunDir.y));

  // the horizon pales out as scattered light is itself scattered again
  float pale = smoothstep(PALE_FROM, PALE_TO, m);
  float lum = dot(col, vec3(0.29, 0.53, 0.18));
  col = mix(col, vec3(lum) * vec3(1.06, 1.00, 0.94), pale * PALE_AMOUNT);

  // ground bounce below the horizon
  float below = smoothstep(0.03, -0.20, d.y);
  vec3 ground = vec3(0.055, 0.062, 0.055) * (0.25 + max(sunDir.y, 0.0));
  col = mix(col, ground + col * 0.30, below);

  return max(col, vec3(0.0));
}

/** Ambient sky light arriving at an up-facing surface. */
vec3 skyAmbient(vec3 sunDir){
  return (skyRadiance(vec3(0.0, 1.0, 0.0), sunDir) * 0.62 +
          skyRadiance(normalize(vec3(sunDir.x, 0.25, sunDir.z)), sunDir) * 0.38);
}

/**
 * Fold distance haze into a surface colour. dist is in metres, viewDir points
 * from eye to surface, hMid is the mean altitude of the path (haze thins with
 * height).
 */
vec3 aerial(vec3 color, float dist, vec3 viewDir, float hMid, vec3 sunDir){
  // Aerosol thins out fast with altitude; molecules more slowly.
  float aer = exp(-max(hMid - 560.0, 0.0) / 1700.0) * uHaze;
  float mol = exp(-max(hMid - 560.0, 0.0) / 8500.0);

  vec3 tau = BETA_R * (dist / 8500.0) * mol + vec3(0.0000125 * dist * aer);
  vec3 T = exp(-tau);

  vec3 hazeCol = skyRadiance(viewDir, sunDir);
  // forward-scattering hot spot: looking toward the sun the haze glows
  float c = clamp(dot(viewDir, sunDir), 0.0, 1.0);
  hazeCol += uSunColor * sunTransmittance(sunDir) * pow(c, 10.0) * 0.55 * aer;

  return color * T + hazeCol * (1.0 - T);
}
`;

/** Height sampling shared by the terrain mesh, its shading and the water. */
export const HEIGHT_SAMPLER = /* glsl */ `
uniform float uHalfSize;
uniform float uEdgeBase;

// Manual bilinear on an R32F texture (linear filtering of float textures is
// not universally available, and we want exact control at patch seams).
float sampleHeightTex(sampler2D tex, float texSize, float texStep, vec2 world){
  vec2 g = (world + uHalfSize) / texStep;
  g = clamp(g, vec2(0.0), vec2(texSize - 1.001));
  vec2 i = floor(g);
  vec2 f = g - i;
  ivec2 c = ivec2(i);
  ivec2 mx = ivec2(int(texSize) - 1);
  float a = texelFetch(tex, min(c, mx), 0).r;
  float b = texelFetch(tex, min(c + ivec2(1, 0), mx), 0).r;
  float cc = texelFetch(tex, min(c + ivec2(0, 1), mx), 0).r;
  float d = texelFetch(tex, min(c + ivec2(1, 1), mx), 0).r;
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

// ...and its analytic derivative, for free normals
vec3 sampleHeightGrad(sampler2D tex, float texSize, float texStep, vec2 world){
  vec2 g = (world + uHalfSize) / texStep;
  g = clamp(g, vec2(0.0), vec2(texSize - 1.001));
  vec2 i = floor(g);
  vec2 f = g - i;
  ivec2 c = ivec2(i);
  ivec2 mx = ivec2(int(texSize) - 1);
  float a = texelFetch(tex, min(c, mx), 0).r;
  float b = texelFetch(tex, min(c + ivec2(1, 0), mx), 0).r;
  float cc = texelFetch(tex, min(c + ivec2(0, 1), mx), 0).r;
  float d = texelFetch(tex, min(c + ivec2(1, 1), mx), 0).r;
  float h = mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
  float dx = mix(b - a, d - cc, f.y) / texStep;
  float dz = mix(cc - a, d - b, f.x) / texStep;
  return vec3(h, dx, dz);
}

// Beyond the baked region the land settles onto a lowland plain so the map
// edge dissolves into haze instead of ending in a cliff.
float edgeFade(vec2 world){
  const float W = 1500.0;
  vec2 q = abs(world) - (uHalfSize - W);
  return 1.0 - smoothstep(0.0, W, max(max(q.x, q.y), 0.0));
}
`;
