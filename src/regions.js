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
    tagline: '145,386 real buildings · 14 × 14 km of the lakefront',
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
      // 145,000 buildings will not all draw. Past a kilometre the bungalow belt
      // goes; past three, everything but the towers.
      bands: [
        { from: 1100, minHeight: 13 },
        { from: 2400, minHeight: 42 },
        { from: 3800, minHeight: 95 },
      ],
      roofClutter: true,
      // Things a plan-view footprint cannot describe: a ferris wheel, a
      // mirrored ellipsoid and a row of columns all bake into slabs.
      landmarks: ['centennial-wheel', 'cloud-gate', 'soldier-field-colonnade', 'grand-ballroom'],
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
    // The towers themselves. This used to carry the Merchandise Mart's
    // coordinates, which put the label 470 m west of the corncobs and on top
    // of the Mart's own.
    { name: 'Marina City', lat: 41.8881, lon: -87.6288, kind: 'landmark', height: 179 },
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
    { name: 'Cloud Gate', lat: 41.8827, lon: -87.6233, kind: 'landmark', height: 10 },
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

/**
 * Short tasks scattered through the map, in the spirit of a skate game's goal
 * list: you find them while free flying, they take a minute, and you chip away
 * at the medals across runs.
 *
 * Every type scores on one number and lower is always better — seconds for
 * slalom, collect and climb, mean height above ground for lowpass — so one
 * medal rule covers all four. `medals` is [bronze, silver, gold] and `limit`
 * is the clock that ends the attempt. The limit sits well above bronze on
 * purpose: if the two were equal, finishing and medalling would be the same
 * event and the bottom of the ladder would carry no information.
 *
 * Coordinates are checked against the baked terrain: every river gate lands on
 * water, every alpine gate in open air over the valley floor. The times are
 * measured rather than guessed — the ship's polar, the air along the line and
 * the altitude each gate leaves you have to add up to a task a glider can fly
 * without the motor, with the motor as the margin rather than the entry fee.
 */
export const CHALLENGES = {
  jungfrau: [
    {
      id: 'lauterbrunnen-slalom',
      type: 'slalom',
      name: 'Lauterbrunnen Slalom',
      where: 'Trümmelbach to the village',
      blurb: 'Six gates north down the valley floor, wall to wall.',
      marker: { lat: 46.557, lon: 7.902, agl: 220, heading: 29 },
      // The trench only drops 154 m in 4.3 km and the air over it is flat, so
      // the whole task is a glide against the clock: gold is a straight line
      // held at 41 m/s, which spends every metre the gate radii allow.
      limit: 195,
      medals: [150, 125, 105],
      gates: [
        { name: 'Trümmelbach', lat: 46.562, lon: 7.906, agl: 130, radius: 75 },
        { name: 'Mürren Cliff', lat: 46.568, lon: 7.9114, agl: 125, radius: 75 },
        { name: 'Wengen Wall', lat: 46.574, lon: 7.9078, agl: 140, radius: 75 },
        { name: 'Staubbach Falls', lat: 46.58, lon: 7.9138, agl: 130, radius: 75 },
        { name: 'Kirche', lat: 46.586, lon: 7.912, agl: 125, radius: 75 },
        { name: 'Lauterbrunnen', lat: 46.592, lon: 7.9102, agl: 130, radius: 75 },
      ],
    },
    {
      // Deliberately parked at the far end of the slalom: you come out of the
      // gates at the village and the next marker is right there.
      id: 'valley-floor',
      type: 'lowpass',
      name: 'Valley Floor',
      where: 'Lauterbrunnen, running south',
      blurb: 'Hold it under 70 m back up the trench, against the rising floor.',
      marker: { lat: 46.596, lon: 7.909, agl: 130, heading: 188 },
      ceiling: 70,
      hold: 26,
      limit: 85,
      medals: [52, 38, 26],
    },
    {
      id: 'eiger-traverse',
      type: 'collect',
      name: 'Eiger Traverse',
      where: 'The north face down to Kleine Scheidegg',
      blurb: 'Five markers off the wall and along the shelf. Never turn back.',
      marker: { lat: 46.5861, lon: 8.011, agl: 380, heading: 270 },
      limit: 155,
      medals: [118, 98, 82],
      picks: [
        { lat: 46.5861, lon: 8.0053, agl: 420 },
        { lat: 46.5804, lon: 7.9896, agl: 400 },
        { lat: 46.5747, lon: 7.9739, agl: 300 },
        { lat: 46.58, lon: 7.966, agl: 320 },
        { lat: 46.5853, lon: 7.9614, agl: 300 },
      ],
    },
    {
      id: 'wengen-boomer',
      type: 'climb',
      name: 'Wengen Boomer',
      where: 'The Männlichen wall, above Wengen',
      blurb: 'Beat along the windward face for 250 m. Over the village the air is dead.',
      // And it is: nothing within 600 m of Wengen beats the ship's own sink,
      // so the marker stands instead on the north-west flank of the Männlichen
      // ridge, pointed at the summit. A beat along that face holds 3.3 m/s
      // from 200 to 500 m above the rock, and being terrain rather than
      // thermals it is there at every hour of the day.
      marker: { lat: 46.6251, lon: 7.9402, agl: 200, heading: 183 },
      gain: 250,
      limit: 250,
      medals: [190, 150, 120],
    },
    {
      id: 'jungfraujoch-descent',
      type: 'slalom',
      name: 'Jungfraujoch Descent',
      where: 'The Joch down to Kleine Scheidegg',
      blurb: 'Six gates, 1,300 m of descent. Climb high before you start.',
      marker: { lat: 46.545, lon: 7.988, agl: 250, heading: 326 },
      limit: 145,
      medals: [108, 90, 76],
      // Heights are set so the straight line between any two gates clears the
      // glacier below it by at least a hundred metres.
      gates: [
        { name: 'Jungfraujoch', lat: 46.549, lon: 7.984, agl: 210, radius: 95 },
        { name: 'Guggi Glacier', lat: 46.556, lon: 7.98, agl: 270, radius: 95 },
        { name: 'Mönchsjoch', lat: 46.564, lon: 7.976, agl: 300, radius: 95 },
        { name: 'Eigergletscher', lat: 46.572, lon: 7.973, agl: 230, radius: 95 },
        { name: 'Salzegg', lat: 46.58, lon: 7.966, agl: 180, radius: 95 },
        { name: 'Kleine Scheidegg', lat: 46.586, lon: 7.96, agl: 150, radius: 95 },
      ],
    },
  ],

  chicago: [
    {
      id: 'river-run',
      type: 'slalom',
      name: 'Chicago River Run',
      where: 'The mouth to the South Branch',
      blurb: 'Eight gates up the main stem, hard left at Wolf Point. All downhill.',
      // On the river axis at the mouth, and clear of the line the free flight
      // start already runs down, so arriving from the lake is a choice.
      //
      // High, because the river is a one-way trade of height for distance.
      // Even with the lake's sink kept off it the line costs 220 m at bronze
      // pace and 270 at gold, so the marker hands you that much to spend and
      // the gates step down the canyon instead of sitting flat on the water.
      marker: { lat: 41.8889, lon: -87.614, agl: 340, heading: 268 },
      limit: 145,
      medals: [110, 92, 80],
      gates: [
        { name: 'Columbus Drive', lat: 41.8887, lon: -87.6215, agl: 190, radius: 55 },
        { name: 'Michigan Avenue', lat: 41.8889, lon: -87.6244, agl: 175, radius: 55 },
        { name: 'State Street', lat: 41.8878, lon: -87.6273, agl: 160, radius: 55 },
        { name: 'Wells Street', lat: 41.8876, lon: -87.634, agl: 145, radius: 55 },
        // A sixty-degree turn that no glider takes at cruise. Placed in the
        // widest water of the junction, 200 m wide against the 80 m branch
        // below it, so the arc has somewhere to go.
        { name: 'Wolf Point', lat: 41.8866, lon: -87.6379, agl: 140, radius: 70 },
        { name: 'Randolph Street', lat: 41.8817, lon: -87.63835, agl: 120, radius: 55 },
        { name: 'Union Station', lat: 41.8772, lon: -87.6377, agl: 100, radius: 55 },
        { name: 'Roosevelt Road', lat: 41.8727, lon: -87.6357, agl: 85, radius: 60 },
      ],
    },
    {
      id: 'loop-rooftops',
      type: 'collect',
      name: 'Loop Rooftops',
      where: 'Willis Tower to Streeterville',
      blurb: 'Five markers over the big roofs. You arrive above all of them once.',
      marker: { lat: 41.883, lon: -87.643, agl: 500, heading: 100 },
      limit: 145,
      medals: [110, 88, 72],
      // Ordered high to low along a route that never asks for a dive through
      // the middle of the Loop: Willis, the Aon pair, Trump, then down to the
      // river. Heights are the surveyed roofs plus a little air.
      picks: [
        { lat: 41.8789, lon: -87.6359, agl: 470 },
        { lat: 41.8858, lon: -87.6215, agl: 375 },
        { lat: 41.8869, lon: -87.6199, agl: 395 },
        { lat: 41.8892, lon: -87.6266, agl: 452 },
        { lat: 41.8885, lon: -87.6345, agl: 280 },
      ],
    },
    {
      id: 'lakefront-skim',
      type: 'lowpass',
      name: 'Lakefront Skim',
      where: 'Grant Park to the museums',
      blurb: 'Thirty seconds under 50 m. The shore band will hold you up.',
      marker: { lat: 41.881, lon: -87.618, agl: 130, heading: 190 },
      ceiling: 50,
      hold: 30,
      limit: 90,
      medals: [38, 27, 18],
    },
    {
      id: 'heat-island',
      type: 'climb',
      name: 'Heat Island',
      where: 'North Michigan Avenue',
      blurb: 'No hills. Find the roof that is cooking and take 250 m off it.',
      // air.seedThermals is deterministic, so the good column is at a fixed
      // address and the marker can be authored onto it. Over the West Loop,
      // where this used to stand, the ship sits in the sink collar of a
      // thermal it cannot reach and the task simply cannot be completed.
      marker: { lat: 41.9018, lon: -87.6265, agl: 230, heading: 190 },
      gain: 250,
      limit: 200,
      medals: [155, 120, 95],
    },
    {
      id: 'museum-campus',
      type: 'collect',
      name: 'Museum Campus',
      where: 'Field Museum to Soldier Field',
      blurb: 'Five markers low between the museums. Tight and quick.',
      marker: { lat: 41.871, lon: -87.62, agl: 180, heading: 170 },
      limit: 110,
      medals: [85, 68, 56],
      picks: [
        { lat: 41.8663, lon: -87.6169, agl: 90 },
        { lat: 41.8676, lon: -87.614, agl: 80 },
        { lat: 41.8663, lon: -87.6072, agl: 70 },
        { lat: 41.8639, lon: -87.6078, agl: 60 },
        { lat: 41.8623, lon: -87.6167, agl: 95 },
      ],
    },
  ],
};

export const DEFAULT_REGION = 'jungfrau';

export function getRegion(id) {
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION];
}
