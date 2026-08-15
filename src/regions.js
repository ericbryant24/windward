/**
 * The maps you can fly, and everything that differs between them.
 *
 * Keeping this in one table is what stops "add a region" from meaning "edit
 * nine files". A region owns its data files, its named places, its race
 * course, and its air — which is not decoration: the Alps fly on ridge lift off
 * 2,000 m faces, and Chicago is flat, so its lift has to come from somewhere
 * else or the map is unflyable.
 */

export const REGIONS = {
  jungfrau: {
    id: 'jungfrau',
    name: 'Jungfrau',
    subtitle: 'Bernese Oberland',
    blurb: 'Ridge lift off the big north faces, thermals over the meadows.',
    tagline: 'Real terrain · 38 × 38 km of the Bernese Oberland',
    loadingTagline: 'Soaring the Bernese Alps',
    mapSub: '38 × 38 km · Switzerland',
    circuitName: 'Jungfrau Circuit',
    circuitDesc: 'Eleven gates from Lauterbrunnen to the Eiger. Beat the clock.',
    freeDesc: 'Hunt thermals, ride the ridges, find every landmark.',
    data: {
      terrain: 'data/jungfrau.png',
      buildings: 'data/jungfrau-buildings.bin.gz',
      network: 'data/jungfrau-network.bin.gz',
    },
    loading: ['reading the terrain…', 'raising the Bernese Alps…', 'tracing the shadows…', 'surveying the villages…'],
    // Kleine Scheidegg, nose pointed at the Eiger.
    start: { lat: 46.5853, lon: 7.9614, agl: 780, heading: 104 },
    climbStart: { lat: 46.686, lon: 7.863, agl: 683, heading: 150 },
    air: {
      cloudBase: 2950,
      thermalCount: 46,
      groundMin: 570,
      groundMax: 2750,
      radius: [250, 490],
      strength: [2.6, 4.4],
      ridgeLift: true,
      waterSink: 0,
      shoreLift: null,
      wind: { x: 0.55, z: 0.84, speed: 6.5 },
    },
    menuCamera: { focus: 'Eiger', radius: 5200, height: 3950, lookAtScale: 0.86 },
    trees: {},
    buildings: { maxDistance: 2600, bands: [], roofClutter: false, landmarks: ['sphinx', 'pizgloria'] },
    // Ground colours are tuned for rock, snow and pasture in terrain.js.
    palette: 'alpine',
  },

  chicago: {
    id: 'chicago',
    name: 'Chicago',
    subtitle: 'Illinois',
    blurb: 'No hills to lean on. Thermals off hot roofs, and the lake kills you.',
    tagline: '103,769 real buildings · 14 × 14 km of the lakefront',
    loadingTagline: 'Soaring the Chicago lakefront',
    mapSub: '14 × 14 km · Illinois',
    circuitName: 'The Loop Circuit',
    circuitDesc: 'Eleven gates up the river and back down the lakefront.',
    freeDesc: 'Thermals off hot roofs. Stay off the lake — nothing rises over it.',
    data: {
      terrain: 'data/chicago.png',
      buildings: 'data/chicago-buildings.bin.gz',
      network: 'data/chicago-network.bin.gz',
    },
    loading: ['reading the lakefront…', 'laying out the grid…', 'tracing the shadows…', 'raising the Loop…'],
    // Over the lake off Navy Pier, pointed at the skyline.
    start: { lat: 41.8917, lon: -87.5905, agl: 520, heading: 265 },
    // Low over the West Loop, with the whole downtown to climb through.
    climbStart: { lat: 41.883, lon: -87.652, agl: 240, heading: 88 },
    air: {
      // A Midwest summer afternoon: lower cloudbase than the Alps, but the city
      // is one big heat island and the roofs cook.
      cloudBase: 1500,
      thermalCount: 54,
      groundMin: 176,
      groundMax: 220,
      radius: [220, 420],
      strength: [2.4, 4.2],
      // Flat: there is no slope to force air up, so ridge lift is switched off
      // entirely rather than left to produce noise from DEM roughness.
      ridgeLift: false,
      // Lake Michigan in summer is far colder than the city. Nothing rises over
      // it, and crossing it low is a one-way decision.
      waterSink: 1.9,
      // The lake breeze front: cool air pushing inland collides with rising
      // city air a few hundred metres back from the shore, and the convergence
      // line is the one reliable band of lift on the map.
      shoreLift: { radius: 520, strength: 2.4, ceiling: 900 },
      wind: { x: -0.82, z: -0.57, speed: 5.2 },
    },
    // Orbiting the Loop from the south-east, which is the postcard angle.
    menuCamera: { focus: 'Willis Tower', radius: 2600, height: 760, lookAtScale: 1.0, lookAtY: 240 },
    // Park oaks and street trees, not spruce, and scattered rather than
    // packed: a city park is grass with trees on it.
    trees: { broadleaf: true, densityScale: 0.5, height: [7, 15] },
    buildings: {
      maxDistance: 5200,
      // 104,000 buildings will not all draw. Past a kilometre the bungalow belt
      // goes; past three, everything but the towers.
      bands: [
        { from: 1100, minHeight: 13 },
        { from: 2400, minHeight: 42 },
        { from: 3800, minHeight: 95 },
      ],
      roofClutter: true,
      landmarks: null,
    },
    palette: 'city',
  },
};

/** Places worth naming on the map. */
export const PLACES = {
  jungfrau: [
    { name: 'Jungfrau', lat: 46.5367, lon: 7.9625, kind: 'peak', height: 4158 },
    { name: 'Mönch', lat: 46.5586, lon: 7.9961, kind: 'peak', height: 4107 },
    { name: 'Eiger', lat: 46.5775, lon: 8.0053, kind: 'peak', height: 3967 },
    { name: 'Wetterhorn', lat: 46.6403, lon: 8.1128, kind: 'peak', height: 3692 },
    { name: 'Schreckhorn', lat: 46.5897, lon: 8.1181, kind: 'peak', height: 4078 },
    { name: 'Schilthorn', lat: 46.5556, lon: 7.8347, kind: 'peak', height: 2970 },
    { name: 'Männlichen', lat: 46.6142, lon: 7.9394, kind: 'peak', height: 2343 },
    { name: 'Schynige Platte', lat: 46.6553, lon: 7.9067, kind: 'peak', height: 2076 },
    { name: 'Niesen', lat: 46.6456, lon: 7.6519, kind: 'peak', height: 2362 },
    { name: 'Jungfraujoch', lat: 46.5474, lon: 7.9806, kind: 'landmark', height: 3454 },
    { name: 'Kleine Scheidegg', lat: 46.5853, lon: 7.9614, kind: 'landmark', height: 2061 },
    { name: 'Staubbach Falls', lat: 46.5906, lon: 7.9058, kind: 'landmark', height: 900 },
    { name: 'Interlaken', lat: 46.686, lon: 7.863, kind: 'town', height: 567 },
    { name: 'Lauterbrunnen', lat: 46.5936, lon: 7.9088, kind: 'town', height: 796 },
    { name: 'Grindelwald', lat: 46.6242, lon: 8.0413, kind: 'town', height: 1034 },
    { name: 'Wengen', lat: 46.6053, lon: 7.9219, kind: 'town', height: 1274 },
    { name: 'Mürren', lat: 46.5586, lon: 7.8925, kind: 'town', height: 1638 },
    { name: 'Thunersee', lat: 46.6805, lon: 7.7365, kind: 'water', height: 558 },
    { name: 'Brienzersee', lat: 46.7245, lon: 7.9705, kind: 'water', height: 564 },
  ],
  chicago: [
    { name: 'Willis Tower', lat: 41.8789, lon: -87.6359, kind: 'landmark', height: 442 },
    { name: '875 N Michigan', lat: 41.8988, lon: -87.6229, kind: 'landmark', height: 344 },
    { name: 'Trump Tower', lat: 41.8892, lon: -87.6266, kind: 'landmark', height: 423 },
    { name: 'St. Regis Chicago', lat: 41.8869, lon: -87.6199, kind: 'landmark', height: 365 },
    { name: 'Aon Center', lat: 41.8858, lon: -87.6215, kind: 'landmark', height: 346 },
    { name: 'Marina City', lat: 41.8885, lon: -87.6345, kind: 'landmark', height: 179 },
    { name: 'Merchandise Mart', lat: 41.8885, lon: -87.6354, kind: 'landmark', height: 99 },
    { name: 'Navy Pier', lat: 41.8917, lon: -87.6086, kind: 'landmark', height: 55 },
    { name: 'Soldier Field', lat: 41.8623, lon: -87.6167, kind: 'landmark', height: 55 },
    { name: 'Wrigley Field', lat: 41.9484, lon: -87.6553, kind: 'landmark', height: 45 },
    { name: 'Field Museum', lat: 41.8663, lon: -87.6169, kind: 'landmark', height: 40 },
    { name: 'Adler Planetarium', lat: 41.8663, lon: -87.6072, kind: 'landmark', height: 30 },
    { name: 'The Loop', lat: 41.8819, lon: -87.6278, kind: 'town', height: 181 },
    { name: 'River North', lat: 41.8925, lon: -87.634, kind: 'town', height: 181 },
    { name: 'Streeterville', lat: 41.8925, lon: -87.618, kind: 'town', height: 180 },
    { name: 'West Loop', lat: 41.883, lon: -87.648, kind: 'town', height: 182 },
    { name: 'Millennium Park', lat: 41.8826, lon: -87.6226, kind: 'landmark', height: 179 },
    { name: 'Grant Park', lat: 41.8755, lon: -87.6205, kind: 'landmark', height: 179 },
    { name: 'Lincoln Park', lat: 41.925, lon: -87.637, kind: 'landmark', height: 180 },
    { name: 'Lake Michigan', lat: 41.888, lon: -87.575, kind: 'water', height: 176 },
    { name: 'Chicago River', lat: 41.8887, lon: -87.6386, kind: 'water', height: 176 },
  ],
};

/** The race line for each region. */
export const CIRCUITS = {
  jungfrau: [
    { name: 'Lauterbrunnen Valley', lat: 46.6019, lon: 7.9088, agl: 260, radius: 100 },
    { name: 'Staubbach Falls', lat: 46.5906, lon: 7.9058, agl: 210, radius: 95 },
    { name: 'Mürren Terrace', lat: 46.5586, lon: 7.8925, agl: 230, radius: 105 },
    { name: 'Sefinental', lat: 46.5411, lon: 7.8681, agl: 320, radius: 115 },
    { name: 'Lauterbrunnen Wall', lat: 46.5453, lon: 7.9236, agl: 420, radius: 120 },
    { name: 'Jungfraujoch', lat: 46.5474, lon: 7.9806, agl: 260, radius: 130 },
    { name: 'Eigergletscher', lat: 46.5747, lon: 7.9739, agl: 300, radius: 120 },
    { name: 'Eiger North Face', lat: 46.5861, lon: 8.0053, agl: 520, radius: 130 },
    { name: 'Grindelwald Basin', lat: 46.6242, lon: 8.0413, agl: 340, radius: 115 },
    { name: 'Männlichen Ridge', lat: 46.6142, lon: 7.9394, agl: 200, radius: 105 },
    { name: 'Wengen', lat: 46.6053, lon: 7.9219, agl: 260, radius: 100 },
  ],
  // Out along the lakefront, up the river through the Loop, back over the
  // museums. Gates are tighter and lower than the alpine course: the obstacles
  // here are 300 m tall and made of glass.
  chicago: [
    { name: 'Navy Pier', lat: 41.8917, lon: -87.6086, agl: 110, radius: 90 },
    { name: 'Lake Point Tower', lat: 41.8938, lon: -87.6127, agl: 170, radius: 85 },
    { name: 'Michigan Avenue Bridge', lat: 41.8887, lon: -87.6247, agl: 95, radius: 80 },
    { name: 'Wolf Point', lat: 41.8887, lon: -87.6386, agl: 105, radius: 90 },
    { name: 'Willis Tower', lat: 41.8789, lon: -87.6359, agl: 470, radius: 110 },
    { name: 'Union Station', lat: 41.8789, lon: -87.6398, agl: 130, radius: 85 },
    { name: 'South Branch', lat: 41.867, lon: -87.63, agl: 120, radius: 90 },
    { name: 'Soldier Field', lat: 41.8623, lon: -87.6167, agl: 150, radius: 100 },
    { name: 'Adler Planetarium', lat: 41.8663, lon: -87.6072, agl: 130, radius: 95 },
    { name: 'Buckingham Fountain', lat: 41.8758, lon: -87.6189, agl: 130, radius: 90 },
    { name: 'Millennium Park', lat: 41.8826, lon: -87.6226, agl: 160, radius: 95 },
  ],
};

export const DEFAULT_REGION = 'jungfrau';

export function getRegion(id) {
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION];
}
