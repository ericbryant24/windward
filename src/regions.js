/**
 * The maps you can fly, and everything that differs between them.
 *
 * Keeping this in one table is what stops "add a region" from meaning "edit
 * nine files". A region owns its data files, its named places, its challenges,
 * and its air — which is not decoration: the Alps fly on ridge lift off
 * 2,000 m faces, and Chicago is flat, so its lift has to come from somewhere
 * else or the map is unflyable.
 *
 * A region is a level, not an app. Everything a player accumulates — medals,
 * landmarks, the aeroplane they fly when nobody is telling them which — is kept
 * across both, so the only thing switching maps changes is which four megabytes
 * of terrain are in memory.
 */

export const REGIONS = {
  jungfrau: {
    id: 'jungfrau',
    name: 'Jungfrau',
    subtitle: 'Bernese Oberland',
    blurb: 'Ridge lift off the big north faces, thermals over the meadows.',
    mapSub: '38 × 38 km · Switzerland',
    data: {
      terrain: 'data/jungfrau.png',
      buildings: 'data/jungfrau-buildings.bin.gz',
      network: 'data/jungfrau-network.bin.gz',
    },
    loading: ['reading the terrain…', 'raising the Bernese Alps…', 'tracing the shadows…', 'surveying the villages…'],
    // Kleine Scheidegg, nose pointed at the Eiger.
    start: { lat: 46.5853, lon: 7.9614, agl: 780, heading: 104 },
    air: {
      cloudBase: 2950,
      thermalCount: 40,
      groundMin: 570,
      groundMax: 2750,
      // Wide, because the ship has to be able to turn inside one. Measured,
      // the ballasted nineteen-metre flies a 45-degree circle at a 267 m
      // radius and loses 71 m going round — so a column 250 m across is one
      // the game says you can climb in and no aeroplane in it can. These are
      // sized so a full turn fits inside the working part with room to
      // re-centre, which is what makes thermalling a skill rather than a lie.
      radius: [450, 720],
      strength: [2.6, 4.4],
      ridgeLift: true,
      waterSink: 0,
      shoreLift: null,
      wind: { x: 0.55, z: 0.84, speed: 6.5 },
    },
    menuCamera: { focus: 'Eiger', radius: 5200, height: 3950, lookAtScale: 0.86 },
    /**
     * The Lauterbrunnen valley is named for its waterfalls — seventy-two of
     * them come off those walls — and a 25 m heightfield cannot hold a ribbon
     * of water two metres wide down a vertical face, so they are placed by
     * hand.
     *
     * Only three fields decide where a fall goes: the point, `faces` — the
     * compass direction the water is thrown, so the opposite of it is the way
     * up the face — and `drop`, how much height the fall is credited with.
     * src/falls.js walks the terrain from the point to find the foot and the
     * head, and lays the water on the ground between them, so these stay right
     * across a re-bake. `width`, `spread` and `rate` are looks.
     */
    falls: [
      // 297 m, and the tallest free-falling fall in Switzerland. Standing just
      // out from the west wall opposite the village, its lip level with the
      // Mürren terrace. Most of it is airborne long before it lands, which is
      // what "dust brook" means and what the shader is written around.
      { name: 'Staubbach', lat: 46.5917, lon: 7.9062, faces: 90, drop: 320, width: 24, spread: 2.2, rate: 1.0 },
      // Off the Mürren terrace further south, on the same wall.
      { name: 'Mürrenbach', lat: 46.5772, lon: 7.9066, faces: 90, drop: 300, width: 18, spread: 1.8, rate: 1.1 },
      // The Trümmelbach runs inside the rock for most of its height; what shows
      // from the air is the last of it coming out of the cliff just above the
      // valley floor. Short and hard rather than tall and soft.
      { name: 'Trümmelbach', lat: 46.5758, lon: 7.9074, faces: 78, drop: 90, width: 11, spread: 0.9, rate: 1.6 },
      // The Sefinen Lütschine coming off the hanging valley to the south-west.
      { name: 'Sefinen', lat: 46.5614, lon: 7.9016, faces: 84, drop: 210, width: 16, spread: 1.7, rate: 1.1 },
      // The Schmadribach at the head of the valley, off the Breithorn cirque.
      { name: 'Schmadribach', lat: 46.5192, lon: 7.9055, faces: 0, drop: 260, width: 20, spread: 2.0, rate: 1.0 },
    ],
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
    mapSub: '14 × 14 km · Illinois',
    data: {
      terrain: 'data/chicago.png',
      buildings: 'data/chicago-buildings.bin.gz',
      network: 'data/chicago-network.bin.gz',
    },
    loading: ['reading the lakefront…', 'laying out the grid…', 'tracing the shadows…', 'raising the Loop…'],
    // Over the lake off Navy Pier, pointed at the skyline.
    start: { lat: 41.8917, lon: -87.5905, agl: 520, heading: 265 },
    air: {
      // A Midwest summer afternoon: lower cloudbase than the Alps, but the city
      // is one big heat island and the roofs cook.
      cloudBase: 1500,
      thermalCount: 38,
      groundMin: 176,
      groundMax: 220,
      // See the alpine note: sized so the issued ship's circle fits inside one.
      // A city thermal on a hot afternoon is a kilometre across anyway, and
      // there are fewer of them than there were because each is now much
      // bigger — the map should not be wall-to-wall lift.
      radius: [430, 680],
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
      landmarks: [
        'centennial-wheel',
        'cloud-gate',
        'soldier-field-colonnade',
        'grand-ballroom',
        'buckingham-fountain',
        'harbor-lighthouse',
      ],
    },
    palette: 'city',
  },

  flam: {
    id: 'flam',
    name: 'Flåm',
    subtitle: 'Aurland, Norway',
    blurb: 'Walls a mile high straight out of the water, and a road that goes under the mountain.',
    mapSub: '44 × 44 km · Norway',
    data: {
      terrain: 'data/flam.png',
      buildings: 'data/flam-buildings.bin.gz',
      network: 'data/flam-network.bin.gz',
    },
    loading: ['reading the terrain…', 'flooding the fjords…', 'tracing the shadows…', 'surveying the farmsteads…'],
    // Over the Aurlandsfjord off Flåm, pointed down it. A verified wet point:
    // the fjord is a kilometre wide here and everything either side of it goes
    // straight up.
    start: { lat: 60.868, lon: 7.1312, agl: 700, heading: 350 },
    air: {
      // Maritime and a long way north, so the base is low and the thermals are
      // weak. What this map flies on is the walls.
      cloudBase: 1500,
      thermalCount: 24,
      groundMin: 0,
      groundMax: 1800,
      radius: [420, 660],
      strength: [1.6, 2.8],
      // The whole point of the place. Thirteen hundred metres of rock rising
      // out of salt water at 40 degrees is the best ridge lift in the game.
      ridgeLift: true,
      // Cold fjord water under a warm afternoon: nothing rises over it.
      waterSink: 1.2,
      shoreLift: null,
      // Blowing east-south-east, so the lift is on the west-facing walls —
      // which on a fjord running north–south is the eastern shore, all 16 km
      // of it.
      wind: { x: 0.86, z: 0.51, speed: 8.0 },
    },
    menuCamera: { focus: 'Aurlandsfjord', radius: 4600, height: 2100, lookAtScale: 0.9 },
    // Deliberately empty, and not because Norway is short of waterfalls — the
    // Kjosfossen alone is 225 m and the railway stops for it. A fall needs the
    // compass direction its water is thrown and the height it is credited with,
    // src/falls.js walks the terrain from there, and nothing in the toolchain
    // checks the result. Guessing those on the Jungfrau map is exactly how the
    // ribbons ended up hanging in mid-air two hundred metres off the cliff.
    // These want a verifier first.
    falls: [],
    trees: {},
    buildings: { maxDistance: 2400, bands: [], roofClutter: false, landmarks: [] },
    palette: 'nordic',
    // Permanent snow from about 1,500 m at 61 degrees north, against 2,760 in
    // the Oberland. Nearly every plateau top on this map is above it.
    snowLine: 1500,
  },

  maui: {
    id: 'maui',
    name: 'Maui',
    subtitle: 'Hawaii',
    blurb: 'A three-thousand-metre volcano out of the sea, and trade winds that climb it.',
    mapSub: '60 × 60 km · Hawaii',
    data: {
      terrain: 'data/maui.png',
      buildings: 'data/maui-buildings.bin.gz',
      network: 'data/maui-network.bin.gz',
    },
    loading: ['reading the terrain…', 'pouring the Pacific…', 'tracing the shadows…', 'surveying the shore…'],
    // Off Kahului on the north shore, pointed at the volcano.
    start: { lat: 20.925, lon: -156.44, agl: 620, heading: 145 },
    air: {
      // The trade-wind inversion sits about here, which is why the summit is
      // above the clouds and the windward slopes are in them.
      cloudBase: 2100,
      thermalCount: 34,
      groundMin: 0,
      groundMax: 3060,
      radius: [400, 640],
      strength: [2.4, 4.0],
      // Orographic lift on the windward flank, which is the whole of why
      // anything grows on this island.
      ridgeLift: true,
      waterSink: 1.0,
      shoreLift: null,
      // The north-east trades, blowing south-west. Steady enough that the
      // windward slope works all afternoon.
      wind: { x: -0.71, z: 0.71, speed: 8.5 },
    },
    menuCamera: { focus: 'Puʻuʻulaʻula', radius: 7000, height: 4200, lookAtScale: 0.9 },
    falls: [],
    // Rainforest below the inversion, cane and pasture on the isthmus, bare
    // cinder above. The surveyed mask carries all three.
    trees: { broadleaf: true, densityScale: 0.8, height: [8, 22] },
    buildings: { maxDistance: 3000, bands: [{ from: 1600, minHeight: 10 }], roofClutter: false, landmarks: [] },
    palette: 'island',
    // Above everything. Haleakalā is bare red cinder to the summit and frost is
    // a news story there, not a snowfield.
    snowLine: 4200,
  },
};

/** Places worth naming on the map. */
export const PLACES = {
  // Every Flåm and Maui row here came out of tools/fetch-places.mjs, which asks
  // Overpass and prints the baked heightfield's own ground height beside each
  // one. The DEM agrees with the surveyed summit elevations to within a few
  // metres on both maps, which is the check that says the terrain is honest.
  flam: [
    { name: 'Flåm', lat: 60.8624, lon: 7.1137, kind: 'town' },
    { name: 'Aurlandsvangen', lat: 60.9058, lon: 7.187, kind: 'town' },
    { name: 'Gudvangen', lat: 60.8791, lon: 6.8396, kind: 'town' },
    { name: 'Undredal', lat: 60.9509, lon: 7.1047, kind: 'town' },
    { name: 'Vassbygdi', lat: 60.8744, lon: 7.3369, kind: 'town' },
    { name: 'Fresvik', lat: 61.0722, lon: 6.934, kind: 'town' },
    { name: 'Bleia', lat: 61.0848, lon: 7.2258, kind: 'peak', height: 1717 },
    { name: 'Tarven', lat: 60.7752, lon: 7.1875, kind: 'peak', height: 1703 },
    { name: 'Storebreen', lat: 60.9062, lon: 6.9406, kind: 'peak', height: 1662 },
    { name: 'Bårdshøgdi', lat: 61.0284, lon: 7.4389, kind: 'peak', height: 1644 },
    { name: 'Fresvikbreen', lat: 61.0352, lon: 6.773, kind: 'peak', height: 1642 },
    { name: 'Klovafjellet', lat: 60.8179, lon: 7.3979, kind: 'peak', height: 1612 },
    { name: 'Torskarnuten', lat: 60.8891, lon: 7.3938, kind: 'peak', height: 1602 },
    { name: 'Skammadalshøgdi', lat: 60.8769, lon: 6.9347, kind: 'peak', height: 1603 },
    { name: 'Grånosi', lat: 60.9508, lon: 7.048, kind: 'peak', height: 1586 },
    // Verified wet against the baked water mask rather than read off a map.
    { name: 'Aurlandsfjord', lat: 60.928, lon: 7.1732, kind: 'water' },
    { name: 'Nærøyfjord', lat: 60.885, lon: 6.85, kind: 'water' },
    { name: 'Sognefjord', lat: 61.09, lon: 6.96, kind: 'water' },
  ],

  maui: [
    { name: 'Kahului', lat: 20.8894, lon: -156.4727, kind: 'town' },
    { name: 'Wailuku', lat: 20.8905, lon: -156.5031, kind: 'town' },
    { name: 'Lahaina', lat: 20.8739, lon: -156.6777, kind: 'town' },
    { name: 'Kihei', lat: 20.7476, lon: -156.455, kind: 'town' },
    { name: 'Paia', lat: 20.9025, lon: -156.3727, kind: 'town' },
    { name: 'Makawao', lat: 20.8539, lon: -156.3104, kind: 'town' },
    { name: 'Kula', lat: 20.792, lon: -156.3237, kind: 'town' },
    { name: 'Kapalua', lat: 21.0009, lon: -156.6632, kind: 'town' },
    { name: 'Kahakuloa', lat: 20.9969, lon: -156.5509, kind: 'town' },
    // Red Hill, the summit. Surveyed at 3,055 m; the DEM has it at 3,045.
    { name: 'Puʻuʻulaʻula', lat: 20.7101, lon: -156.2531, kind: 'peak', height: 3055 },
    { name: 'Pākaʻaoʻao', lat: 20.7138, lon: -156.2498, kind: 'peak', height: 3006 },
    { name: 'Kilohana', lat: 20.7269, lon: -156.2417, kind: 'peak', height: 2906 },
    { name: 'Haupaʻakea Peak', lat: 20.7009, lon: -156.2248, kind: 'peak', height: 2788 },
    // The wettest place in the state, and the top of the West Maui massif.
    { name: 'Puʻu Kukui', lat: 20.8917, lon: -156.5867, kind: 'peak', height: 1764 },
    { name: 'Pacific', lat: 20.95, lon: -156.44, kind: 'water' },
    { name: 'Māʻalaea Bay', lat: 20.792, lon: -156.51, kind: 'water' },
  ],

  jungfrau: [
    { name: 'Jungfrau', lat: 46.5367, lon: 7.9625, kind: 'peak', height: 4158 },
    { name: 'Mönch', lat: 46.5586, lon: 7.9961, kind: 'peak', height: 4107 },
    { name: 'Eiger', lat: 46.5775, lon: 8.0053, kind: 'peak', height: 3967 },
    { name: 'Wetterhorn', lat: 46.6403, lon: 8.1128, kind: 'peak', height: 3692 },
    { name: 'Schreckhorn', lat: 46.5897, lon: 8.1181, kind: 'peak', height: 4078 },
    { name: 'Schilthorn', lat: 46.5556, lon: 7.8347, kind: 'peak', height: 2970 },
    { name: 'Männlichen', lat: 46.6142, lon: 7.9394, kind: 'peak', height: 2343 },
    { name: 'Schynige Platte', lat: 46.6553, lon: 7.9067, kind: 'peak', height: 2076 },
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
    // Summit coordinates are the ones the baked terrain agrees with rather than
    // the ones a gazetteer prints: on a 25 m grid a peak is a cell, and a name
    // pinned to the wrong cell is a label hanging over a valley. Checked — the
    // heights below all read within the grid's own rounding of the surveyed
    // figure, the same margin the original list holds to.
    { name: 'Blüemlisalp', lat: 46.4906, lon: 7.7736, kind: 'peak', height: 3661 },
    { name: 'Schwarzhorn', lat: 46.6855, lon: 8.0751, kind: 'peak', height: 2928 },
    { name: 'Faulhorn', lat: 46.6655, lon: 8.0114, kind: 'peak', height: 2681 },
    // The Lauberhorn, whose downhill course runs off the far side of it into
    // Wengen and is the reason anyone outside Switzerland knows the name.
    { name: 'Lauberhorn', lat: 46.6002, lon: 7.9498, kind: 'peak', height: 2472 },
    // Where the Aletsch begins: four ice streams meeting at Concordia Place,
    // the head of the longest glacier in the Alps.
    { name: 'Konkordiaplatz', lat: 46.5033, lon: 8.05, kind: 'landmark', height: 2780 },
    { name: 'Grosse Scheidegg', lat: 46.6558, lon: 8.1042, kind: 'landmark', height: 1962 },
    { name: 'First', lat: 46.6589, lon: 8.0544, kind: 'landmark', height: 2166 },
    { name: 'Harder Kulm', lat: 46.7003, lon: 7.8639, kind: 'landmark', height: 1322 },
    { name: 'Trümmelbach Falls', lat: 46.5758, lon: 7.9074, kind: 'landmark', height: 810 },
    { name: 'Gimmelwald', lat: 46.5464, lon: 7.8925, kind: 'town', height: 1367 },
    { name: 'Wilderswil', lat: 46.6633, lon: 7.8636, kind: 'town', height: 584 },
    { name: 'Oeschinensee', lat: 46.4989, lon: 7.7269, kind: 'water', height: 1578 },
    { name: 'Bachalpsee', lat: 46.6697, lon: 8.0322, kind: 'water', height: 2265 },
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
    // The rest of what a pilot over this city can actually see and name. Heights
    // are the structure rather than the ground, which is the convention the
    // entries above already use — Chicago is flat enough that the ground is
    // 180 m everywhere and says nothing.
    { name: 'Lake Point Tower', lat: 41.8938, lon: -87.6127, kind: 'landmark', height: 197 },
    { name: 'Board of Trade', lat: 41.8779, lon: -87.6324, kind: 'landmark', height: 184 },
    { name: 'Tribune Tower', lat: 41.8904, lon: -87.6234, kind: 'landmark', height: 141 },
    { name: 'Wrigley Building', lat: 41.8888, lon: -87.6285, kind: 'landmark', height: 130 },
    { name: 'Union Station', lat: 41.8789, lon: -87.6398, kind: 'landmark', height: 65 },
    // One of four buildings inside the burnt district to survive 1871, and the
    // only one anybody looks at.
    { name: 'Water Tower', lat: 41.8971, lon: -87.6247, kind: 'landmark', height: 47 },
    { name: 'United Center', lat: 41.8807, lon: -87.6742, kind: 'landmark', height: 43 },
    { name: 'Shedd Aquarium', lat: 41.8676, lon: -87.614, kind: 'landmark', height: 30 },
    // At the end of the breakwater, a kilometre off Navy Pier — and the first
    // thing off the wingtip when a free flight opens over the lake.
    { name: 'Harbor Lighthouse', lat: 41.8896, lon: -87.5906, kind: 'landmark', height: 24 },
    { name: 'Buckingham Fountain', lat: 41.8758, lon: -87.6189, kind: 'landmark', height: 12 },
    { name: 'Northerly Island', lat: 41.8618, lon: -87.6086, kind: 'landmark', height: 5 },
    { name: 'Old Town', lat: 41.91, lon: -87.635, kind: 'town', height: 181 },
    { name: 'Pilsen', lat: 41.856, lon: -87.657, kind: 'town', height: 182 },
    { name: 'Bronzeville', lat: 41.833, lon: -87.618, kind: 'town', height: 180 },
    { name: 'Humboldt Park', lat: 41.903, lon: -87.701, kind: 'landmark', height: 185 },
    { name: 'Belmont Harbor', lat: 41.9394, lon: -87.635, kind: 'water', height: 177 },
  ],
};

/**
 * The challenges: every designed thing in the game, both maps, one table.
 *
 * There are no game modes. You either fly, or you fly a challenge, and a
 * challenge is a marker standing in the world with rules attached. The long
 * circuits and the ceiling climbs are the same kind of object as the
 * sixty-second slaloms — bigger, later, but nothing special in the code.
 *
 * Every type scores on one number and lower is always better — seconds for
 * slalom, collect and climb, mean height above ground for lowpass — so one
 * medal rule covers all four. `medals` is [bronze, silver, gold] and `limit`
 * is the clock that ends the attempt. The limit sits well above bronze on
 * purpose: if the two were equal, finishing and medalling would be the same
 * event and the bottom of the ladder would carry no information.
 *
 * Two fields make a challenge a designed thing rather than a stopwatch:
 *
 *   ship   What the task was designed around. It is no longer what you fly it
 *          in — see ISSUED_AIRCRAFT in fleet.js — but it is kept because it
 *          says which aeroplane's manners each of these was cut for, and
 *          because unsetting that constant hands the fleet back.
 *   needs  Medals — anywhere in the game, either map — before it appears. The
 *          count is global on purpose: golds over the Alps open the lakefront.
 *
 * Coordinates are checked against the baked terrain: every river gate lands on
 * water, every alpine gate in open air over the valley floor. Medal thresholds
 * are measured rather than guessed — the ship's polar, the air along the line
 * and the altitude each gate leaves you have to add up to a task that ship can
 * fly without the motor, with the motor as the margin rather than the entry fee.
 *
 * Measured by tools/calibrate-challenges.mjs, which flies every one of these
 * against the real physics and the real air and prints what it managed. Every
 * number below — the medals, the clocks, and a good deal of the geometry — came
 * out of a run of it. When the flight model moves again, run it again: it will
 * say which of these have stopped being true.
 *
 * The whole table was re-cut when the game went to one aeroplane. Nine of the
 * fourteen had been sited for a ship that could be flown at thirty knots and
 * turned inside sixty metres, and the ballasted nineteen-metre can do neither:
 * five could not be finished at all, three of the rest had ladders nobody could
 * reach. What changed is heights and spacing rather than places — the courses
 * still go where they went, with the air under them that a heavy ship needs.
 */
/**
 * The challenges: every designed thing in the game, both maps, one table.
 *
 * Four kinds and nothing else — see TYPES in challenges.js for the rules. The
 * shape of the set is deliberate and tight:
 *
 *   slalom     gates threaded through terrain, against the clock. Three per
 *              map, because it is the thing this aeroplane is best at and the
 *              thing the terrain is most useful for.
 *   height     sixty seconds of it. How much altitude can you find?
 *   distance   ninety seconds. How far from the hoop can you be at the end?
 *   deck       sixty seconds, a corridor and a ceiling. How much of the window
 *              can you hold down on the deck inside it?
 *   gunnery    sixty seconds and a field of barrage balloons. How many?
 *
 * A gunnery task carries a `targets` block: how many balloons, the height band
 * they hang in, how far either side of the path they scatter, and the path.
 * Where each one ends up is generated from the challenge id, so the field is
 * identical for every player on every device — which medals and ghosts both
 * require — without ten hand-typed positions per task.
 *
 * A deck run carries a `deck` block: `ceiling` metres above the ground,
 * `width` metres either side of `path`, and the path itself as lat/lon. Both
 * paths were traced out of the baked data — the river out of Chicago's water
 * mask, the valley floor out of the Jungfrau's heightfield — rather than off a
 * map, because what has to be flyable is the terrain as it bakes.
 *
 * Nothing runs longer than ninety seconds. That is the rule the whole table is
 * cut to, and it is why the two map-spanning circuits are gone: the Jungfrau
 * Circuit was thirty-three kilometres and a twelve-minute gold, the Loop
 * Circuit ten and four. What survives of each is its best stretch, flown as a
 * slalom inside the cap — the Joch down the glacier, and the tower down the
 * river to the pier. A challenge you can lose in ninety seconds is one you
 * press Retry on.
 *
 * Three of the four are fixed windows, so they cannot be failed by running out
 * of time — the clock closing IS the score, and only hitting something ends a
 * run early. Only a slalom carries a `limit`, and it is ninety.
 *
 * `medals` is always [bronze, silver, gold] in the order the ladder climbs,
 * which for a slalom is descending seconds and for the other three ascending
 * quantities. `needs` is medals earned anywhere in the game, either map, before
 * a marker is raised — the count is global on purpose: golds over the Alps open
 * the lakefront.
 *
 * Every number here is measured by tools/calibrate-challenges.mjs, which flies
 * each one against the real physics, the real air and the real buildings. When
 * the flight model moves, run it again: it will say which of these have stopped
 * being true.
 */
export const CHALLENGES = {
  flam: [
    {
      // The one the map exists for.
      //
      // Lærdalstunnelen is 24.5 km of road under Aurlandsfjellet — the longest
      // road tunnel in the world, opened in 2000, and it goes straight through
      // a mountain that tops 1,664 m on the line between its portals. A car
      // does it in twenty minutes without seeing daylight. You cannot fly a
      // road tunnel, so the challenge is the other way over: out of the
      // Aurland portal at 55 m, across the plateau, and down to the Lærdal
      // portal at 242 m.
      //
      // Both portal coordinates are the real ones, pulled from OSM by querying
      // for the tunnel way and taking its endpoints — 60.8995/7.2159 and
      // 61.0628/7.4974, 23.7 km apart in a straight line against the tunnel's
      // 24.1. Everything about the box this map is baked in was chosen to hold
      // both of them.
      //
      // It is far and away the longest challenge in the game and that is the
      // point: everything else here is a sixty-second sprint, and this is a
      // crossing. The gates follow the ground the plateau actually offers
      // rather than the straight line, which runs over the two high points.
      id: 'laerdal-tunnel',
      type: 'slalom',
      name: 'The Lærdal Tunnel',
      where: 'Aurland portal to Lærdal, over the top',
      blurb: 'Twenty-four kilometres of road goes under Aurlandsfjellet. You are going over it.',
      needs: 0,
      marker: { lat: 60.8995, lon: 7.2159, agl: 700, heading: 40 },
      // Opts out of the ninety-second cap every other race in the game obeys.
      // The cap is a design belief — a race you can hold in your head is a race
      // you can learn — and this one is deliberately the exception, so it says
      // so in the table rather than the tool making a quiet exception for it.
      crossing: true,
      limit: 420,
      // Measured: the calibrator's best line out of the Aurland portal, over
      // Aurlandsfjellet and down to Lærdal is 277.8 s.
      medals: [340, 310, 285],
      gates: [
        { name: 'Aurland Portal', lat: 60.924, lon: 7.2581, agl: 300, radius: 130 },
        { name: 'Aurlandsfjellet', lat: 60.9485, lon: 7.3003, agl: 250, radius: 130 },
        { name: 'The Saddle', lat: 60.9812, lon: 7.3567, agl: 300, radius: 130 },
        { name: 'Bårdshøgdi', lat: 61.0465, lon: 7.4692, agl: 250, radius: 130 },
        { name: 'Lærdal Portal', lat: 61.0628, lon: 7.4974, agl: 250, radius: 130 },
      ],
    },
    {
      // Sixty seconds down the Aurlandsfjord at forty metres, between walls
      // that go up thirteen hundred either side. The corridor is the channel
      // centreline traced out of the baked water mask, and the fjord is
      // 1,000–3,500 m wide along it, so a 320 m corridor is over salt water for
      // all of it. The Nærøyfjord would have been the obvious choice and the
      // wrong one: at 14.3 m a sample the mask closes to thirty metres across
      // in the narrows, which is not a corridor, it is a crack.
      id: 'aurlandsfjord-deck',
      type: 'deck',
      name: 'Down the Aurlandsfjord',
      where: 'The fjord floor, Flåm to Undredal',
      blurb: 'Sixty seconds on the water. The clock runs only while you are under forty metres and between the walls.',
      needs: 1,
      marker: { lat: 60.868, lon: 7.1312, agl: 60, heading: 350 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [60.868, 7.1312],
          [60.88, 7.1419],
          [60.892, 7.1492],
          [60.904, 7.1624],
          [60.916, 7.174],
          [60.928, 7.1732],
          [60.94, 7.1713],
          [60.952, 7.1372],
          [60.964, 7.098],
        ],
      },
      // Measured: best line banked 53.2 s of the 60.
      medals: [30, 40, 50],
    },
    {
      // Over the Nærøyfjord, which is a UNESCO site and 250 m wide, with the
      // balloons strung above the water between walls that block half the sky.
      id: 'naeroy-balloons',
      type: 'gunnery',
      name: 'The Nærøyfjord Line',
      where: 'Above the narrows, Gudvangen to Beitelen',
      blurb: 'A line of balloons up the narrowest fjord in Europe. Ninety seconds and three hundred rounds.',
      rounds: 300,
      needs: 2,
      marker: { lat: 60.8791, lon: 6.8497, agl: 260, heading: 20 },
      window: 90,
      targets: {
        count: 12,
        height: [200, 280],
        spread: 35,
        path: [
          [60.8911, 6.8592],
          [60.9149, 6.8754],
          [60.9325, 6.891],
          [60.9431, 6.9299],
        ],
      },
      // Re-cut when the Shrike went from a rate stick to an attitude one. The
      // calibrator's gunnery pilot drives roll straight off the target's
      // bearing, which was a proportional rate controller and is now a
      // proportional BANK controller — a different and worse law for tracking —
      // so its best fell from eleven balloons to five on an unchanged field.
      // That is the tool getting worse, not the challenge getting harder: for a
      // player, a stick that holds a bank steady is easier to shoot from.
      //
      // So these are set to be reachable rather than to match a good pilot, and
      // gold sits on the best the tool can still stand behind. The first report
      // from play on the old field was a single balloon; nobody has flown this
      // one yet.
      medals: [3, 4, 5],
    },
    {
      // Up the Flåm valley the way the railway goes: 900 m of climb in fourteen
      // kilometres, and the Flåmsbana does it in twenty tunnels.
      id: 'flam-valley',
      type: 'slalom',
      name: 'The Flåm Valley',
      where: 'Flåm up to Myrdal',
      blurb: 'Four gates up the valley the railway climbs. Nine hundred metres of it, and the walls close in.',
      needs: 3,
      marker: { lat: 60.8624, lon: 7.1137, agl: 420, heading: 178 },
      // Also a crossing, though a far shorter one than the tunnel. Nine
      // hundred metres of climb in nine kilometres takes the ship 128 s
      // measured, and no arrangement of these three gates fits that under
      // ninety. Flåm is the map of long lines; two of its five races say so.
      crossing: true,
      limit: 250,
      // Measured: best line 128.0 s.
      medals: [195, 164, 141],
      // Three gates, not four. With Myrdal on the end the course was 14.2 km
      // and the calibrator's best was 184 s — a second commute on a map that
      // already has one, and the last leg wanted 30:1 from an aeroplane that
      // glides 11:1. Myrdal is a secret instead, which is the better home for
      // it: it has no road, and finding that out should not be a gate.
      gates: [
        { name: 'Brekkefossen', lat: 60.848, lon: 7.1185, agl: 260, radius: 110 },
        { name: 'Blomheller', lat: 60.812, lon: 7.115, agl: 300, radius: 110 },
        { name: 'Kjosfossen', lat: 60.7754, lon: 7.1206, agl: 300, radius: 110 },
      ],
    },
    {
      // North out of the fjord and into the Sognefjord, which is 200 km long
      // and the deepest in the world. Ninety seconds of it.
      id: 'sognefjord-dash',
      type: 'distance',
      name: 'Out to the Sognefjord',
      where: 'The fjord, north past Undredal',
      blurb: 'Ninety seconds. Take the line the fjord gives you and do not turn.',
      needs: 5,
      marker: { lat: 60.916, lon: 7.174, agl: 900, heading: 340 },
      window: 90,
      // Measured: best line reached 7.65 km.
      medals: [4000, 5500, 6900],
    },
    // ---- proposed by tools/propose-challenges.mjs -----------------------
    // Derived from the terrain, the water mask and the surveyed road and rail
    // network, then flown by tools/calibrate-challenges.mjs for their ladders.
    // Nothing in this block was typed off a map.
    {
      id: 'granosi-water',
      type: 'deck',
      name: "Grånosi Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 6,
      marker: { lat: 60.9839, lon: 7.0696, agl: 60, heading: 345 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [60.9839, 7.0696],
          [60.9875, 7.0676],
          [60.9908, 7.0637],
          [60.9944, 7.0617],
          [60.9982, 7.0617],
          [61.002, 7.0617],
          [61.0056, 7.0597],
          [61.0089, 7.0558],
          [61.0115, 7.0503],
          [61.0148, 7.0464],
          [61.0185, 7.0484],
          [61.0222, 7.0484],
          [61.0255, 7.0446],
          [61.0282, 7.0391],
          [61.0308, 7.0336],
          [61.0341, 7.0297],
          [61.0377, 7.0317],
          [61.0415, 7.0317],
          [61.0448, 7.0278],
          [61.0484, 7.0258],
          [61.0517, 7.0297],
          [61.0484, 7.0258],
          [61.0448, 7.0278],
          [61.0415, 7.0317],
          [61.0377, 7.0317],
          [61.0341, 7.0297],
          [61.0308, 7.0336],
          [61.0282, 7.0391],
          [61.0255, 7.0446],
          [61.0222, 7.0484],
          [61.0185, 7.0484],
          [61.0148, 7.0464],
          [61.0115, 7.0503],
          [61.0089, 7.0558],
          [61.0056, 7.0597],
          [61.002, 7.0617],
          [60.9982, 7.0617],
          [60.9944, 7.0617],
          [60.9908, 7.0637],
          [60.9875, 7.0676],
          [60.9839, 7.0696],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'fresvik-water',
      type: 'deck',
      name: "Fresvik Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 7,
      marker: { lat: 61.029, lon: 7.039, agl: 60, heading: 315 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 230,
        path: [
          [61.029, 7.039],
          [61.0316, 7.0335],
          [61.0353, 7.0315],
          [61.0391, 7.0315],
          [61.0391, 7.0237],
          [61.0409, 7.017],
          [61.0446, 7.015],
          [61.0479, 7.0189],
          [61.0488, 7.0264],
          [61.0515, 7.0318],
          [61.0548, 7.0357],
          [61.0584, 7.0377],
          [61.0622, 7.0377],
          [61.0654, 7.0339],
          [61.0687, 7.03],
          [61.0725, 7.03],
          [61.0761, 7.032],
          [61.0798, 7.03],
          [61.0824, 7.0245],
          [61.0851, 7.019],
          [61.0888, 7.017],
          [61.0851, 7.019],
          [61.0824, 7.0245],
          [61.0798, 7.03],
          [61.0761, 7.032],
          [61.0725, 7.03],
          [61.0687, 7.03],
          [61.0654, 7.0339],
          [61.0622, 7.0377],
          [61.0584, 7.0377],
          [61.0548, 7.0357],
          [61.0515, 7.0318],
          [61.0488, 7.0264],
          [61.0479, 7.0189],
          [61.0446, 7.015],
          [61.0409, 7.017],
          [61.0391, 7.0237],
          [61.0391, 7.0315],
          [61.0353, 7.0315],
          [61.0316, 7.0335],
          [61.029, 7.039],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'granosi-water-2',
      type: 'deck',
      name: "Grånosi Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 8,
      marker: { lat: 61.0055, lon: 7.04, agl: 60, heading: 345 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [61.0055, 7.04],
          [61.0091, 7.038],
          [61.0129, 7.038],
          [61.0166, 7.038],
          [61.0204, 7.038],
          [61.0237, 7.0341],
          [61.0264, 7.0286],
          [61.03, 7.0266],
          [61.0333, 7.0305],
          [61.0369, 7.0285],
          [61.0396, 7.023],
          [61.0428, 7.0191],
          [61.0465, 7.0171],
          [61.0501, 7.0191],
          [61.0538, 7.0212],
          [61.0574, 7.0232],
          [61.0607, 7.0193],
          [61.0643, 7.0173],
          [61.068, 7.0153],
          [61.0706, 7.0098],
          [61.0733, 7.0043],
          [61.0706, 7.0098],
          [61.068, 7.0153],
          [61.0643, 7.0173],
          [61.0607, 7.0193],
          [61.0574, 7.0232],
          [61.0538, 7.0212],
          [61.0501, 7.0191],
          [61.0465, 7.0171],
          [61.0428, 7.0191],
          [61.0396, 7.023],
          [61.0369, 7.0285],
          [61.0333, 7.0305],
          [61.03, 7.0266],
          [61.0264, 7.0286],
          [61.0237, 7.0341],
          [61.0204, 7.038],
          [61.0166, 7.038],
          [61.0129, 7.038],
          [61.0091, 7.038],
          [61.0055, 7.04],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'sognefjord-field',
      type: 'gunnery',
      name: "The Sognefjord Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 11,
      marker: { lat: 61.0903, lon: 6.9482, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [61.0903, 6.963],
          [61.0903, 6.9833],
          [61.0903, 7.0036],
        ],
      },
      medals: [5, 6, 8],
    },
    {
      id: 'bleia-field',
      type: 'gunnery',
      name: "The Bleia Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 12,
      marker: { lat: 61.0903, lon: 7.215, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [61.0903, 7.2298],
          [61.0903, 7.2501],
          [61.0903, 7.2704],
        ],
      },
      medals: [1, 2, 3],
    },
    {
      id: 'granosi-lift',
      type: 'height',
      name: "Grånosi Lift",
      where: "Surveyed at 6.4 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 6.4 m/s.",
      needs: 13,
      marker: { lat: 60.9585, lon: 6.9985, agl: 240, heading: 90 },
      window: 60,
      medals: [40, 55, 70],
    },
    {
      id: 'undredal-lift',
      type: 'height',
      name: "Undredal Lift",
      where: "Surveyed at 6.3 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 6.3 m/s.",
      needs: 14,
      marker: { lat: 60.9477, lon: 7.1096, agl: 240, heading: 90 },
      window: 60,
      medals: [35, 50, 60],
    },
    {
      id: 'aurlandsfjord-dash',
      type: 'distance',
      name: "Aurlandsfjord Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 14,
      marker: { lat: 60.9585, lon: 7.2727, agl: 900, heading: 121 },
      window: 90,
      medals: [5000, 6900, 8700],
    },
    {
      id: 'granosi-dash',
      type: 'distance',
      name: "Grånosi Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 15,
      marker: { lat: 60.9297, lon: 7.0133, agl: 900, heading: 121 },
      window: 90,
      medals: [5000, 6900, 8700],
    },
    {
      id: 'fresvik-water-2',
      type: 'deck',
      name: "Fresvik Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 10,
      marker: { lat: 61.029, lon: 7.039, agl: 60, heading: 315 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 230,
        path: [
          [61.029, 7.039],
          [61.0316, 7.0335],
          [61.0353, 7.0315],
          [61.0391, 7.0315],
          [61.0391, 7.0237],
          [61.0409, 7.017],
          [61.0446, 7.015],
          [61.0479, 7.0189],
          [61.0488, 7.0264],
          [61.0515, 7.0318],
          [61.0548, 7.0357],
          [61.0584, 7.0377],
          [61.0622, 7.0377],
          [61.0654, 7.0339],
          [61.0687, 7.03],
          [61.0725, 7.03],
          [61.0761, 7.032],
          [61.0798, 7.03],
          [61.0824, 7.0245],
          [61.0851, 7.019],
          [61.0888, 7.017],
          [61.0851, 7.019],
          [61.0824, 7.0245],
          [61.0798, 7.03],
          [61.0761, 7.032],
          [61.0725, 7.03],
          [61.0687, 7.03],
          [61.0654, 7.0339],
          [61.0622, 7.0377],
          [61.0584, 7.0377],
          [61.0548, 7.0357],
          [61.0515, 7.0318],
          [61.0488, 7.0264],
          [61.0479, 7.0189],
          [61.0446, 7.015],
          [61.0409, 7.017],
          [61.0391, 7.0237],
          [61.0391, 7.0315],
          [61.0353, 7.0315],
          [61.0316, 7.0335],
          [61.029, 7.039],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'granosi-water-3',
      type: 'deck',
      name: "Grånosi Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 11,
      marker: { lat: 61.0055, lon: 7.04, agl: 60, heading: 345 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [61.0055, 7.04],
          [61.0091, 7.038],
          [61.0129, 7.038],
          [61.0166, 7.038],
          [61.0204, 7.038],
          [61.0237, 7.0341],
          [61.0264, 7.0286],
          [61.03, 7.0266],
          [61.0333, 7.0305],
          [61.0369, 7.0285],
          [61.0396, 7.023],
          [61.0428, 7.0191],
          [61.0465, 7.0171],
          [61.0501, 7.0191],
          [61.0538, 7.0212],
          [61.0574, 7.0232],
          [61.0607, 7.0193],
          [61.0643, 7.0173],
          [61.068, 7.0153],
          [61.0706, 7.0098],
          [61.0733, 7.0043],
          [61.0706, 7.0098],
          [61.068, 7.0153],
          [61.0643, 7.0173],
          [61.0607, 7.0193],
          [61.0574, 7.0232],
          [61.0538, 7.0212],
          [61.0501, 7.0191],
          [61.0465, 7.0171],
          [61.0428, 7.0191],
          [61.0396, 7.023],
          [61.0369, 7.0285],
          [61.0333, 7.0305],
          [61.03, 7.0266],
          [61.0264, 7.0286],
          [61.0237, 7.0341],
          [61.0204, 7.038],
          [61.0166, 7.038],
          [61.0129, 7.038],
          [61.0091, 7.038],
          [61.0055, 7.04],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'fresvik-water-3',
      type: 'deck',
      name: "Fresvik Water",
      where: "13.4 km of open water",
      blurb: "Sixty seconds under 40 m along 13.4 km of water.",
      needs: 12,
      marker: { lat: 61.0783, lon: 6.9266, agl: 60, heading: 60 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 230,
        path: [
          [61.0783, 6.9266],
          [61.0802, 6.9333],
          [61.0838, 6.9353],
          [61.0871, 6.9392],
          [61.0898, 6.9447],
          [61.0908, 6.9521],
          [61.0908, 6.9599],
          [61.0898, 6.9674],
          [61.0879, 6.9741],
          [61.086, 6.9808],
          [61.0833, 6.9863],
          [61.0807, 6.9918],
          [61.077, 6.9938],
          [61.0744, 6.9993],
          [61.0725, 7.006],
          [61.0698, 7.0115],
          [61.0671, 7.017],
          [61.0698, 7.0115],
          [61.0725, 7.006],
          [61.0744, 6.9993],
          [61.077, 6.9938],
          [61.0807, 6.9918],
          [61.0833, 6.9863],
          [61.086, 6.9808],
          [61.0879, 6.9741],
          [61.0898, 6.9674],
          [61.0908, 6.9599],
          [61.0908, 6.9521],
          [61.0898, 6.9447],
          [61.0871, 6.9392],
          [61.0838, 6.9353],
          [61.0802, 6.9333],
          [61.0783, 6.9266],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'granosi-water-4',
      type: 'deck',
      name: "Grånosi Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 14,
      marker: { lat: 60.982, lon: 7.0719, agl: 60, heading: 165 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [60.982, 7.0719],
          [60.9784, 7.0739],
          [60.9748, 7.0759],
          [60.9715, 7.0798],
          [60.9688, 7.0852],
          [60.9662, 7.0907],
          [60.9662, 7.0985],
          [60.9635, 7.104],
          [60.9602, 7.1079],
          [60.957, 7.1117],
          [60.9543, 7.1172],
          [60.9516, 7.1227],
          [60.9506, 7.1302],
          [60.9506, 7.138],
          [60.9497, 7.1455],
          [60.9487, 7.153],
          [60.9497, 7.1604],
          [60.9478, 7.1672],
          [60.9468, 7.1747],
          [60.9441, 7.1801],
          [60.9405, 7.1822],
          [60.9441, 7.1801],
          [60.9468, 7.1747],
          [60.9478, 7.1672],
          [60.9497, 7.1604],
          [60.9487, 7.153],
          [60.9497, 7.1455],
          [60.9506, 7.138],
          [60.9506, 7.1302],
          [60.9516, 7.1227],
          [60.9543, 7.1172],
          [60.957, 7.1117],
          [60.9602, 7.1079],
          [60.9635, 7.104],
          [60.9662, 7.0985],
          [60.9662, 7.0907],
          [60.9688, 7.0852],
          [60.9715, 7.0798],
          [60.9748, 7.0759],
          [60.9784, 7.0739],
          [60.982, 7.0719],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'flam-water',
      type: 'deck',
      name: "Flåm Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 15,
      marker: { lat: 60.8803, lon: 7.1431, agl: 60, heading: 15 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [60.8803, 7.1431],
          [60.884, 7.1451],
          [60.8877, 7.1451],
          [60.8914, 7.1471],
          [60.894, 7.1526],
          [60.8973, 7.1565],
          [60.9011, 7.1565],
          [60.9037, 7.162],
          [60.9064, 7.1675],
          [60.9083, 7.1742],
          [60.9116, 7.1781],
          [60.9153, 7.1781],
          [60.918, 7.1836],
          [60.9217, 7.1856],
          [60.9253, 7.1876],
          [60.9289, 7.1856],
          [60.9326, 7.1836],
          [60.9364, 7.1836],
          [60.9401, 7.1836],
          [60.9434, 7.1797],
          [60.9467, 7.1758],
          [60.9434, 7.1797],
          [60.9401, 7.1836],
          [60.9364, 7.1836],
          [60.9326, 7.1836],
          [60.9289, 7.1856],
          [60.9253, 7.1876],
          [60.9217, 7.1856],
          [60.918, 7.1836],
          [60.9153, 7.1781],
          [60.9116, 7.1781],
          [60.9083, 7.1742],
          [60.9064, 7.1675],
          [60.9037, 7.162],
          [60.9011, 7.1565],
          [60.8973, 7.1565],
          [60.894, 7.1526],
          [60.8914, 7.1471],
          [60.8877, 7.1451],
          [60.884, 7.1451],
          [60.8803, 7.1431],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'sognefjord-water',
      type: 'deck',
      name: "Sognefjord Water",
      where: "4.2 km of open water",
      blurb: "Sixty seconds under 40 m along 4.2 km of water.",
      needs: 16,
      marker: { lat: 61.0897, lon: 7.0187, agl: 60, heading: 180 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [61.0897, 7.0187],
          [61.0859, 7.0187],
          [61.0833, 7.0242],
          [61.0806, 7.0297],
          [61.077, 7.0317],
          [61.0733, 7.0297],
          [61.077, 7.0317],
          [61.0806, 7.0297],
          [61.0833, 7.0242],
          [61.0859, 7.0187],
          [61.0897, 7.0187],
        ],
      },
      medals: [25, 30, 40],
    },
    {
      id: 'granosi-water-5',
      type: 'deck',
      name: "Grånosi Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 17,
      marker: { lat: 60.9964, lon: 7.0629, agl: 60, heading: 0 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [60.9964, 7.0629],
          [61.0001, 7.0629],
          [61.0038, 7.0609],
          [61.0071, 7.057],
          [61.0103, 7.0531],
          [61.0136, 7.0492],
          [61.0172, 7.0472],
          [61.0209, 7.0492],
          [61.0242, 7.0454],
          [61.0268, 7.0399],
          [61.0301, 7.036],
          [61.0334, 7.0321],
          [61.0366, 7.0282],
          [61.0393, 7.0227],
          [61.0429, 7.0207],
          [61.0462, 7.0169],
          [61.0498, 7.0189],
          [61.0535, 7.0209],
          [61.0571, 7.0229],
          [61.0604, 7.019],
          [61.064, 7.017],
          [61.0604, 7.019],
          [61.0571, 7.0229],
          [61.0535, 7.0209],
          [61.0498, 7.0189],
          [61.0462, 7.0169],
          [61.0429, 7.0207],
          [61.0393, 7.0227],
          [61.0366, 7.0282],
          [61.0334, 7.0321],
          [61.0301, 7.036],
          [61.0268, 7.0399],
          [61.0242, 7.0454],
          [61.0209, 7.0492],
          [61.0172, 7.0472],
          [61.0136, 7.0492],
          [61.0103, 7.0531],
          [61.0071, 7.057],
          [61.0038, 7.0609],
          [61.0001, 7.0629],
          [60.9964, 7.0629],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'flam-floor',
      type: 'deck',
      name: "Flåm Floor",
      where: "6.2 km of valley floor",
      blurb: "Sixty seconds under 55 m along 6.2 km of valley.",
      needs: 19,
      marker: { lat: 60.8988, lon: 7.0576, agl: 75, heading: 13 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [60.8988, 7.0576],
          [60.9023, 7.0592],
          [60.9057, 7.0618],
          [60.9087, 7.0653],
          [60.9123, 7.0679],
          [60.9157, 7.071],
          [60.9189, 7.0749],
          [60.9224, 7.0776],
          [60.9261, 7.079],
          [60.9297, 7.0814],
          [60.9331, 7.0845],
          [60.9361, 7.0888],
          [60.9399, 7.0891],
          [60.9433, 7.0916],
        ],
      },
      medals: [25, 35, 45],
    },
    {
      id: 'sognefjord-floor',
      type: 'deck',
      name: "Sognefjord Floor",
      where: "5.0 km of valley floor",
      blurb: "Sixty seconds under 55 m along 5.0 km of valley.",
      needs: 20,
      marker: { lat: 61.075, lon: 7.0655, agl: 75, heading: 240 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [61.075, 7.0655],
          [61.0732, 7.059],
          [61.0709, 7.0545],
          [61.0702, 7.0564],
          [61.0688, 7.0596],
          [61.0664, 7.0612],
          [61.0656, 7.067],
          [61.0628, 7.0716],
          [61.0621, 7.0772],
          [61.063, 7.0827],
          [61.0601, 7.0867],
          [61.0567, 7.0882],
          [61.0535, 7.0897],
        ],
      },
      medals: [25, 30, 40],
    },
    {
      id: 'sognefjord-field-2',
      type: 'gunnery',
      name: "The Sognefjord Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 22,
      marker: { lat: 61.0903, lon: 7.0541, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [61.0903, 7.0688],
          [61.0903, 7.0892],
          [61.0903, 7.1095],
        ],
      },
      medals: [4, 6, 7],
    },
    {
      id: 'bleia-field-2',
      type: 'gunnery',
      name: "The Bleia Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 23,
      marker: { lat: 61.0903, lon: 7.342, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [61.0903, 7.3568],
          [61.0903, 7.3771],
          [61.0903, 7.3974],
        ],
      },
      medals: [2, 3, 4],
    },
    {
      id: 'bardsh-gdi-field',
      type: 'gunnery',
      name: "The Bårdshøgdi Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 24,
      marker: { lat: 61.0903, lon: 7.431, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [61.0903, 7.4457],
          [61.0903, 7.4661],
          [61.0903, 7.4864],
        ],
      },
      medals: [4, 5, 6],
    },
    {
      id: 'bleia-field-3',
      type: 'gunnery',
      name: "The Bleia Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 25,
      marker: { lat: 61.0697, lon: 7.1387, agl: 240, heading: 45 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [61.0748, 7.1492],
          [61.0818, 7.1636],
          [61.0888, 7.1779],
        ],
      },
      medals: [4, 5, 6],
    },
    {
      id: 'tarven-dash',
      type: 'distance',
      name: "Tarven Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 28,
      marker: { lat: 60.7747, lon: 7.1875, agl: 900, heading: 121 },
      window: 90,
      medals: [4900, 6800, 8500],
    },
    {
      id: 'tarven-dash-2',
      type: 'distance',
      name: "Tarven Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 29,
      marker: { lat: 60.7549, lon: 7.2838, agl: 900, heading: 121 },
      window: 90,
      medals: [4900, 6800, 8500],
    },
    {
      id: 'fresvikbreen-dash',
      type: 'distance',
      name: "Fresvikbreen Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 30,
      marker: { lat: 61.036, lon: 6.7724, agl: 900, heading: 121 },
      window: 90,
      medals: [5000, 6900, 8600],
    },
    {
      id: 'tarven-dash-3',
      type: 'distance',
      name: "Tarven Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 31,
      marker: { lat: 60.8035, lon: 7.2838, agl: 900, heading: 121 },
      window: 90,
      medals: [4900, 6800, 8600],
    },
    {
      id: 'fresvikbreen-dash-2',
      type: 'distance',
      name: "Fresvikbreen Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 32,
      marker: { lat: 60.9747, lon: 6.7761, agl: 900, heading: 121 },
      window: 90,
      medals: [5000, 6900, 8600],
    },
    {
      id: 'bleia-run',
      type: 'slalom',
      name: "Bleia Run",
      where: "8 gates, 2.0 km",
      blurb: "8 gates along 2.0 km of valley, 176 m of wall beside you.",
      needs: 24,
      marker: { lat: 61.0899, lon: 7.0995, agl: 235, heading: 207 },
      limit: 185,
      gates: [
        { name: "Gate 1", lat: 61.0899, lon: 7.0995, agl: 105, radius: 70 },
        { name: "Gate 2", lat: 61.0877, lon: 7.0971, agl: 90, radius: 70 },
        { name: "Gate 3", lat: 61.0857, lon: 7.094, agl: 80, radius: 70 },
        { name: "Gate 4", lat: 61.0841, lon: 7.0907, agl: 90, radius: 70 },
        { name: "Gate 5", lat: 61.0823, lon: 7.0869, agl: 90, radius: 70 },
        { name: "Gate 6", lat: 61.0808, lon: 7.0825, agl: 80, radius: 70 },
        { name: "Gate 7", lat: 61.0787, lon: 7.0805, agl: 80, radius: 70 },
        { name: "Gate 8", lat: 61.0767, lon: 7.0785, agl: 65, radius: 70 },
      ],
      medals: [135, 115, 100],
    },
  ],

  // Empty on purpose, and not because there is nothing to race here — the five
  // that were drafted are in the branch history: off the Haleakalā summit, the
  // Pali coast at forty metres, the Kihei balloon line, into the Iao
  // amphitheatre, and across the isthmus.
  //
  // They are not in the table because the calibrator cannot fly them yet: the
  // island's buildings and roads are still baking, and a medal ladder that has
  // not been measured against the real physics is a number I made up. Every
  // other ladder in this file was flown for. Maui flies now — the terrain, the
  // surveyed forest, the places and the four secrets are all here and all
  // checked — and it gets its races when the tool can stand behind them.
  maui: [
    // ---- proposed by tools/propose-challenges.mjs -----------------------
    // Derived from the terrain, the water mask and the surveyed road and rail
    // network, then flown by tools/calibrate-challenges.mjs for their ladders.
    // Nothing in this block was typed off a map.
    {
      id: 'kahakuloa-water',
      type: 'deck',
      name: "Kahakuloa Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 0,
      marker: { lat: 20.9624, lon: -156.5108, agl: 60, heading: 330 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.9624, -156.5108],
          [20.9657, -156.5128],
          [20.9693, -156.5139],
          [20.9731, -156.5139],
          [20.9767, -156.5149],
          [20.9804, -156.5159],
          [20.984, -156.517],
          [20.9878, -156.517],
          [20.9904, -156.5198],
          [20.9931, -156.5227],
          [20.995, -156.5262],
          [20.9977, -156.529],
          [20.9996, -156.5325],
          [21.0014, -156.536],
          [21.0041, -156.5389],
          [21.0068, -156.5417],
          [21.0087, -156.5452],
          [21.0096, -156.5491],
          [21.0129, -156.5512],
          [21.0156, -156.554],
          [21.0182, -156.5569],
          [21.0156, -156.554],
          [21.0129, -156.5512],
          [21.0096, -156.5491],
          [21.0087, -156.5452],
          [21.0068, -156.5417],
          [21.0041, -156.5389],
          [21.0014, -156.536],
          [20.9996, -156.5325],
          [20.9977, -156.529],
          [20.995, -156.5262],
          [20.9931, -156.5227],
          [20.9904, -156.5198],
          [20.9878, -156.517],
          [20.984, -156.517],
          [20.9804, -156.5159],
          [20.9767, -156.5149],
          [20.9731, -156.5139],
          [20.9693, -156.5139],
          [20.9657, -156.5128],
          [20.9624, -156.5108],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'kapalua-water',
      type: 'deck',
      name: "Kapalua Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 6,
      marker: { lat: 21.032, lon: -156.6225, agl: 60, heading: 90 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [21.032, -156.6225],
          [21.032, -156.6185],
          [21.033, -156.6146],
          [21.0349, -156.6111],
          [21.0368, -156.6076],
          [21.0386, -156.6041],
          [21.0386, -156.6],
          [21.0377, -156.5961],
          [21.0367, -156.5922],
          [21.0367, -156.5882],
          [21.034, -156.5854],
          [21.0314, -156.5825],
          [21.0281, -156.5805],
          [21.0262, -156.577],
          [21.0243, -156.5735],
          [21.0233, -156.5696],
          [21.0224, -156.5657],
          [21.0205, -156.5622],
          [21.0186, -156.5587],
          [21.0167, -156.5552],
          [21.014, -156.5524],
          [21.0167, -156.5552],
          [21.0186, -156.5587],
          [21.0205, -156.5622],
          [21.0224, -156.5657],
          [21.0233, -156.5696],
          [21.0243, -156.5735],
          [21.0262, -156.577],
          [21.0281, -156.5805],
          [21.0314, -156.5825],
          [21.034, -156.5854],
          [21.0367, -156.5882],
          [21.0367, -156.5922],
          [21.0377, -156.5961],
          [21.0386, -156.6],
          [21.0386, -156.6041],
          [21.0368, -156.6076],
          [21.0349, -156.6111],
          [21.033, -156.6146],
          [21.032, -156.6185],
          [21.032, -156.6225],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'makawao-water',
      type: 'deck',
      name: "Makawao Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 6,
      marker: { lat: 20.8825, lon: -156.1689, agl: 60, heading: 135 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.8825, -156.1689],
          [20.8798, -156.1661],
          [20.8771, -156.1632],
          [20.8739, -156.1612],
          [20.8712, -156.1584],
          [20.8702, -156.1545],
          [20.8702, -156.1504],
          [20.8721, -156.1469],
          [20.8711, -156.143],
          [20.8711, -156.1471],
          [20.8701, -156.151],
          [20.8711, -156.1549],
          [20.8721, -156.1588],
          [20.8748, -156.1616],
          [20.8774, -156.1645],
          [20.8801, -156.1673],
          [20.8828, -156.1702],
          [20.8854, -156.173],
          [20.8873, -156.1765],
          [20.8892, -156.18],
          [20.8919, -156.1829],
          [20.8892, -156.18],
          [20.8873, -156.1765],
          [20.8854, -156.173],
          [20.8828, -156.1702],
          [20.8801, -156.1673],
          [20.8774, -156.1645],
          [20.8748, -156.1616],
          [20.8721, -156.1588],
          [20.8711, -156.1549],
          [20.8701, -156.151],
          [20.8711, -156.1471],
          [20.8711, -156.143],
          [20.8721, -156.1469],
          [20.8702, -156.1504],
          [20.8702, -156.1545],
          [20.8712, -156.1584],
          [20.8739, -156.1612],
          [20.8771, -156.1632],
          [20.8798, -156.1661],
          [20.8825, -156.1689],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'kihei-floor',
      type: 'deck',
      name: "Kihei Floor",
      where: "9.3 km of valley floor",
      blurb: "Sixty seconds under 55 m along 9.3 km of valley.",
      needs: 7,
      marker: { lat: 20.6867, lon: -156.4379, agl: 75, heading: 91 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [20.6867, -156.4379],
          [20.6867, -156.4343],
          [20.6881, -156.4306],
          [20.6914, -156.4309],
          [20.6951, -156.4319],
          [20.6988, -156.4328],
          [20.7024, -156.4338],
          [20.7061, -156.4348],
          [20.7098, -156.4357],
          [20.7135, -156.4365],
          [20.7172, -156.4373],
          [20.7207, -156.4387],
          [20.7242, -156.4402],
          [20.7276, -156.4419],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'kapalua-field',
      type: 'gunnery',
      name: "The Kapalua Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 8,
      marker: { lat: 21.0569, lon: -156.6147, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.607],
          [21.0569, -156.5964],
          [21.0569, -156.5859],
        ],
      },
      medals: [5, 7, 9],
    },
    {
      id: 'kahakuloa-field',
      type: 'gunnery',
      name: "The Kahakuloa Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 8,
      marker: { lat: 21.0569, lon: -156.5456, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.5379],
          [21.0569, -156.5273],
          [21.0569, -156.5168],
        ],
      },
      medals: [5, 7, 9],
    },
    {
      id: 'kahakuloa-field-2',
      type: 'gunnery',
      name: "The Kahakuloa Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 9,
      marker: { lat: 21.0569, lon: -156.4615, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.4538],
          [21.0569, -156.4432],
          [21.0569, -156.4327],
        ],
      },
      medals: [1, 2, 3],
    },
    {
      id: 'wailuku-lift',
      type: 'height',
      name: "Wailuku Lift",
      where: "Surveyed at 4.6 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 4.6 m/s.",
      needs: 10,
      marker: { lat: 20.8866, lon: -156.5321, agl: 240, heading: 90 },
      window: 60,
      medals: [35, 50, 65],
    },
    {
      id: 'pu-u-ula-ula-dash',
      type: 'distance',
      name: "Puʻuʻulaʻula Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 11,
      marker: { lat: 20.7097, lon: -156.2535, agl: 900, heading: 225 },
      window: 90,
      medals: [5100, 7100, 8800],
    },
    {
      id: 'haupa-akea-peak-dash',
      type: 'distance',
      name: "Haupaʻakea Peak Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 12,
      marker: { lat: 20.7367, lon: -156.1694, agl: 900, heading: 225 },
      window: 90,
      medals: [5100, 7000, 8800],
    },
    {
      id: 'lahaina-water',
      type: 'deck',
      name: "Lahaina Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 14,
      marker: { lat: 20.8419, lon: -156.6599, agl: 60, heading: 150 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.8419, -156.6599],
          [20.8387, -156.6579],
          [20.836, -156.6551],
          [20.8333, -156.6522],
          [20.8307, -156.6494],
          [20.828, -156.6465],
          [20.8253, -156.6436],
          [20.8221, -156.6416],
          [20.8194, -156.6388],
          [20.8167, -156.6359],
          [20.8131, -156.6349],
          [20.8104, -156.632],
          [20.8078, -156.6292],
          [20.8051, -156.6263],
          [20.8024, -156.6235],
          [20.8005, -156.62],
          [20.8015, -156.6161],
          [20.7996, -156.6126],
          [20.797, -156.6097],
          [20.796, -156.6058],
          [20.795, -156.6019],
          [20.796, -156.6058],
          [20.797, -156.6097],
          [20.7996, -156.6126],
          [20.8015, -156.6161],
          [20.8005, -156.62],
          [20.8024, -156.6235],
          [20.8051, -156.6263],
          [20.8078, -156.6292],
          [20.8104, -156.632],
          [20.8131, -156.6349],
          [20.8167, -156.6359],
          [20.8194, -156.6388],
          [20.8221, -156.6416],
          [20.8253, -156.6436],
          [20.828, -156.6465],
          [20.8307, -156.6494],
          [20.8333, -156.6522],
          [20.836, -156.6551],
          [20.8387, -156.6579],
          [20.8419, -156.6599],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'kihei-water',
      type: 'deck',
      name: "Kihei Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 15,
      marker: { lat: 20.6932, lon: -156.4536, agl: 60, heading: 345 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.6932, -156.4536],
          [20.6968, -156.4546],
          [20.7006, -156.4546],
          [20.7044, -156.4546],
          [20.708, -156.4536],
          [20.7118, -156.4536],
          [20.7155, -156.4546],
          [20.7192, -156.4546],
          [20.7229, -156.4557],
          [20.7265, -156.4567],
          [20.7298, -156.4587],
          [20.7324, -156.4616],
          [20.7362, -156.4616],
          [20.7395, -156.4636],
          [20.7431, -156.4647],
          [20.7469, -156.4647],
          [20.7505, -156.4657],
          [20.7542, -156.4667],
          [20.758, -156.4667],
          [20.7617, -156.4667],
          [20.7655, -156.4667],
          [20.7617, -156.4667],
          [20.758, -156.4667],
          [20.7542, -156.4667],
          [20.7505, -156.4657],
          [20.7469, -156.4647],
          [20.7431, -156.4647],
          [20.7395, -156.4636],
          [20.7362, -156.4616],
          [20.7324, -156.4616],
          [20.7298, -156.4587],
          [20.7265, -156.4567],
          [20.7229, -156.4557],
          [20.7192, -156.4546],
          [20.7155, -156.4546],
          [20.7118, -156.4536],
          [20.708, -156.4536],
          [20.7044, -156.4546],
          [20.7006, -156.4546],
          [20.6968, -156.4546],
          [20.6932, -156.4536],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'kihei-water-2',
      type: 'deck',
      name: "Kihei Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 16,
      marker: { lat: 20.571, lon: -156.6513, agl: 60, heading: 75 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.571, -156.6513],
          [20.572, -156.6474],
          [20.5739, -156.6439],
          [20.5758, -156.6404],
          [20.5767, -156.6365],
          [20.5786, -156.633],
          [20.5813, -156.6302],
          [20.5832, -156.6267],
          [20.5858, -156.6238],
          [20.5885, -156.621],
          [20.5904, -156.6175],
          [20.5931, -156.6146],
          [20.595, -156.6111],
          [20.5976, -156.6083],
          [20.5986, -156.6044],
          [20.6013, -156.6015],
          [20.6032, -156.598],
          [20.6058, -156.5952],
          [20.6068, -156.5913],
          [20.6087, -156.5878],
          [20.6097, -156.5839],
          [20.6087, -156.5878],
          [20.6068, -156.5913],
          [20.6058, -156.5952],
          [20.6032, -156.598],
          [20.6013, -156.6015],
          [20.5986, -156.6044],
          [20.5976, -156.6083],
          [20.595, -156.6111],
          [20.5931, -156.6146],
          [20.5904, -156.6175],
          [20.5885, -156.621],
          [20.5858, -156.6238],
          [20.5832, -156.6267],
          [20.5813, -156.6302],
          [20.5786, -156.633],
          [20.5767, -156.6365],
          [20.5758, -156.6404],
          [20.5739, -156.6439],
          [20.572, -156.6474],
          [20.571, -156.6513],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'kihei-water-3',
      type: 'deck',
      name: "Kihei Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 17,
      marker: { lat: 20.674, lon: -156.4523, agl: 60, heading: 180 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.674, -156.4523],
          [20.6702, -156.4523],
          [20.6664, -156.4523],
          [20.6626, -156.4523],
          [20.6589, -156.4523],
          [20.6551, -156.4523],
          [20.6513, -156.4523],
          [20.6477, -156.4534],
          [20.6444, -156.4554],
          [20.6408, -156.4564],
          [20.6381, -156.4593],
          [20.6343, -156.4593],
          [20.6305, -156.4593],
          [20.6273, -156.4573],
          [20.624, -156.4553],
          [20.6213, -156.4524],
          [20.6187, -156.4496],
          [20.616, -156.4467],
          [20.6124, -156.4457],
          [20.6091, -156.4477],
          [20.6054, -156.4487],
          [20.6091, -156.4477],
          [20.6124, -156.4457],
          [20.616, -156.4467],
          [20.6187, -156.4496],
          [20.6213, -156.4524],
          [20.624, -156.4553],
          [20.6273, -156.4573],
          [20.6305, -156.4593],
          [20.6343, -156.4593],
          [20.6381, -156.4593],
          [20.6408, -156.4564],
          [20.6444, -156.4554],
          [20.6477, -156.4534],
          [20.6513, -156.4523],
          [20.6551, -156.4523],
          [20.6589, -156.4523],
          [20.6626, -156.4523],
          [20.6664, -156.4523],
          [20.6702, -156.4523],
          [20.674, -156.4523],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'haupa-akea-peak-water',
      type: 'deck',
      name: "Haupaʻakea Peak Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 18,
      marker: { lat: 20.6152, lon: -156.1691, agl: 60, heading: 255 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.6152, -156.1691],
          [20.6143, -156.173],
          [20.6161, -156.1765],
          [20.6188, -156.1794],
          [20.6198, -156.1833],
          [20.6208, -156.1872],
          [20.6217, -156.1911],
          [20.6208, -156.195],
          [20.6198, -156.1989],
          [20.6188, -156.2028],
          [20.6178, -156.2067],
          [20.6178, -156.2107],
          [20.6152, -156.2136],
          [20.6142, -156.2175],
          [20.6123, -156.221],
          [20.6096, -156.2238],
          [20.6077, -156.2273],
          [20.6051, -156.2302],
          [20.6041, -156.2341],
          [20.6022, -156.2376],
          [20.6012, -156.2414],
          [20.6022, -156.2376],
          [20.6041, -156.2341],
          [20.6051, -156.2302],
          [20.6077, -156.2273],
          [20.6096, -156.2238],
          [20.6123, -156.221],
          [20.6142, -156.2175],
          [20.6152, -156.2136],
          [20.6178, -156.2107],
          [20.6178, -156.2067],
          [20.6188, -156.2028],
          [20.6198, -156.1989],
          [20.6208, -156.195],
          [20.6217, -156.1911],
          [20.6208, -156.1872],
          [20.6198, -156.1833],
          [20.6188, -156.1794],
          [20.6161, -156.1765],
          [20.6143, -156.173],
          [20.6152, -156.1691],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'pu-u-ula-ula-water',
      type: 'deck',
      name: "Puʻuʻulaʻula Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 19,
      marker: { lat: 20.5679, lon: -156.3775, agl: 60, heading: 90 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [20.5679, -156.3775],
          [20.5679, -156.3735],
          [20.5689, -156.3696],
          [20.5689, -156.3655],
          [20.5689, -156.3615],
          [20.5708, -156.358],
          [20.5718, -156.3541],
          [20.5736, -156.3506],
          [20.5746, -156.3467],
          [20.5756, -156.3428],
          [20.5737, -156.3393],
          [20.5747, -156.3354],
          [20.5757, -156.3315],
          [20.5757, -156.3275],
          [20.5757, -156.3315],
          [20.5747, -156.3354],
          [20.5737, -156.3393],
          [20.5756, -156.3428],
          [20.5746, -156.3467],
          [20.5736, -156.3506],
          [20.5718, -156.3541],
          [20.5736, -156.3506],
          [20.5746, -156.3467],
          [20.5756, -156.3428],
          [20.5737, -156.3393],
          [20.5747, -156.3354],
          [20.5757, -156.3315],
          [20.5757, -156.3275],
          [20.5757, -156.3315],
          [20.5747, -156.3354],
          [20.5737, -156.3393],
          [20.5756, -156.3428],
          [20.5746, -156.3467],
          [20.5736, -156.3506],
          [20.5718, -156.3541],
          [20.5708, -156.358],
          [20.5689, -156.3615],
          [20.5689, -156.3655],
          [20.5689, -156.3696],
          [20.5679, -156.3735],
          [20.5679, -156.3775],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'kilohana-water',
      type: 'deck',
      name: "Kilohana Water",
      where: "5.9 km of open water",
      blurb: "Sixty seconds under 40 m along 5.9 km of water.",
      needs: 19,
      marker: { lat: 20.8541, lon: -156.124, agl: 60, heading: 0 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 200,
        path: [
          [20.8541, -156.124],
          [20.8579, -156.124],
          [20.8615, -156.1251],
          [20.8642, -156.1279],
          [20.8661, -156.1314],
          [20.867, -156.1353],
          [20.8689, -156.1388],
          [20.8708, -156.1423],
          [20.8689, -156.1388],
          [20.867, -156.1353],
          [20.8661, -156.1314],
          [20.8642, -156.1279],
          [20.8615, -156.1251],
          [20.8579, -156.124],
          [20.8541, -156.124],
        ],
      },
      medals: [20, 25, 35],
    },
    {
      id: 'makawao-floor',
      type: 'deck',
      name: "Makawao Floor",
      where: "11.7 km of valley floor",
      blurb: "Sixty seconds under 55 m along 11.7 km of valley.",
      needs: 20,
      marker: { lat: 20.8368, lon: -156.3296, agl: 75, heading: 322 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [20.8368, -156.3296],
          [20.8397, -156.3321],
          [20.842, -156.3353],
          [20.8443, -156.3385],
          [20.8464, -156.3418],
          [20.8481, -156.3455],
          [20.8493, -156.3493],
          [20.8506, -156.3531],
          [20.8523, -156.3567],
          [20.8545, -156.36],
          [20.8567, -156.3632],
          [20.8588, -156.3665],
          [20.8612, -156.3697],
          [20.8635, -156.3729],
        ],
      },
      medals: [25, 35, 45],
    },
    {
      id: 'paia-floor',
      type: 'deck',
      name: "Paia Floor",
      where: "6.2 km of valley floor",
      blurb: "Sixty seconds under 55 m along 6.2 km of valley.",
      needs: 21,
      marker: { lat: 20.9122, lon: -156.3907, agl: 75, heading: 247 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [20.9122, -156.3907],
          [20.9108, -156.3944],
          [20.9094, -156.3982],
          [20.9082, -156.402],
          [20.907, -156.4058],
          [20.9058, -156.4097],
          [20.9046, -156.4135],
          [20.902, -156.4163],
          [20.8985, -156.4176],
          [20.8952, -156.4196],
          [20.892, -156.4218],
          [20.8889, -156.4241],
          [20.8858, -156.4264],
          [20.8827, -156.4287],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'ma-alaea-bay-floor',
      type: 'deck',
      name: "Māʻalaea Bay Floor",
      where: "5.8 km of valley floor",
      blurb: "Sixty seconds under 55 m along 5.8 km of valley.",
      needs: 22,
      marker: { lat: 20.7909, lon: -156.5144, agl: 75, heading: 204 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [20.7909, -156.5144],
          [20.7874, -156.516],
          [20.7839, -156.5175],
          [20.7814, -156.5204],
          [20.7788, -156.5233],
          [20.7776, -156.5269],
          [20.7761, -156.5305],
          [20.7761, -156.5344],
          [20.7762, -156.5382],
          [20.7788, -156.541],
          [20.7811, -156.544],
          [20.7826, -156.5474],
          [20.7849, -156.5502],
          [20.786, -156.5541],
        ],
      },
      medals: [25, 35, 40],
    },
    {
      id: 'pacific-field',
      type: 'gunnery',
      name: "The Pacific Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 23,
      marker: { lat: 21.0569, lon: -156.4194, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.4117],
          [21.0569, -156.4012],
          [21.0569, -156.3906],
        ],
      },
      medals: [6, 8, 10],
    },
    {
      id: 'pacific-field-2',
      type: 'gunnery',
      name: "The Pacific Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 24,
      marker: { lat: 21.0569, lon: -156.3774, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.3697],
          [21.0569, -156.3591],
          [21.0569, -156.3485],
        ],
      },
      medals: [5, 7, 9],
    },
    {
      id: 'pacific-field-3',
      type: 'gunnery',
      name: "The Pacific Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 25,
      marker: { lat: 21.0569, lon: -156.3353, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.3276],
          [21.0569, -156.3171],
          [21.0569, -156.3065],
        ],
      },
      medals: [3, 4, 5],
    },
    {
      id: 'paia-field',
      type: 'gunnery',
      name: "The Paia Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 26,
      marker: { lat: 21.0569, lon: -156.2933, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.2856],
          [21.0569, -156.275],
          [21.0569, -156.2644],
        ],
      },
      medals: [5, 6, 8],
    },
    {
      id: 'paia-field-2',
      type: 'gunnery',
      name: "The Paia Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 27,
      marker: { lat: 21.0569, lon: -156.2512, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.2435],
          [21.0569, -156.233],
          [21.0569, -156.2224],
        ],
      },
      medals: [6, 8, 10],
    },
    {
      id: 'paia-field-3',
      type: 'gunnery',
      name: "The Paia Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 28,
      marker: { lat: 21.0569, lon: -156.2092, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [21.0569, -156.2015],
          [21.0569, -156.1909],
          [21.0569, -156.1803],
        ],
      },
      medals: [6, 8, 10],
    },
    {
      id: 'pu-u-ula-ula-dash-2',
      type: 'distance',
      name: "Puʻuʻulaʻula Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 31,
      marker: { lat: 20.6876, lon: -156.2981, agl: 900, heading: 225 },
      window: 90,
      medals: [5100, 7000, 8800],
    },
    {
      id: 'kilohana-dash',
      type: 'distance',
      name: "Kilohana Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 32,
      marker: { lat: 20.7515, lon: -156.2246, agl: 900, heading: 225 },
      window: 90,
      medals: [5000, 7000, 8700],
    },
    {
      id: 'haupa-akea-peak-dash-2',
      type: 'distance',
      name: "Haupaʻakea Peak Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 32,
      marker: { lat: 20.7023, lon: -156.2035, agl: 900, heading: 225 },
      window: 90,
      medals: [5100, 7000, 8800],
    },
    {
      id: 'haupa-akea-peak-dash-3',
      type: 'distance',
      name: "Haupaʻakea Peak Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 33,
      marker: { lat: 20.7048, lon: -156.1326, agl: 900, heading: 225 },
      window: 90,
      medals: [5000, 7000, 8700],
    },
    {
      id: 'kilohana-dash-2',
      type: 'distance',
      name: "Kilohana Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 34,
      marker: { lat: 20.7539, lon: -156.2745, agl: 900, heading: 225 },
      window: 90,
      medals: [5000, 6900, 8600],
    },
    {
      id: 'ma-alaea-bay-run',
      type: 'slalom',
      name: "Māʻalaea Bay Run",
      where: "8 gates, 2.1 km",
      blurb: "8 gates along 2.1 km of valley, 196 m of wall beside you.",
      needs: 5,
      marker: { lat: 20.8312, lon: -156.5064, agl: 230, heading: 291 },
      limit: 200,
      gates: [
        { name: "Gate 1", lat: 20.8312, lon: -156.5064, agl: 100, radius: 70 },
        { name: "Gate 2", lat: 20.8322, lon: -156.5091, agl: 100, radius: 70 },
        { name: "Gate 3", lat: 20.8341, lon: -156.5111, agl: 95, radius: 70 },
        { name: "Gate 4", lat: 20.8336, lon: -156.5138, agl: 85, radius: 70 },
        { name: "Gate 5", lat: 20.8346, lon: -156.5156, agl: 75, radius: 70 },
        { name: "Gate 6", lat: 20.8372, lon: -156.5164, agl: 90, radius: 70 },
        { name: "Gate 7", lat: 20.8394, lon: -156.518, agl: 70, radius: 70 },
        { name: "Gate 8", lat: 20.8411, lon: -156.5195, agl: 80, radius: 70 },
      ],
      medals: [170, 145, 125],
    },
    {
      id: 'wailuku-run',
      type: 'slalom',
      name: "Wailuku Run",
      where: "8 gates, 2.1 km",
      blurb: "8 gates along 2.1 km of valley, 181 m of wall beside you.",
      needs: 10,
      marker: { lat: 20.9014, lon: -156.5081, agl: 210, heading: 158 },
      limit: 200,
      gates: [
        { name: "Gate 1", lat: 20.9014, lon: -156.5081, agl: 80, radius: 70 },
        { name: "Gate 2", lat: 20.899, lon: -156.507, agl: 85, radius: 70 },
        { name: "Gate 3", lat: 20.8964, lon: -156.5065, agl: 90, radius: 70 },
        { name: "Gate 4", lat: 20.894, lon: -156.5073, agl: 95, radius: 70 },
        { name: "Gate 5", lat: 20.8923, lon: -156.5095, agl: 95, radius: 70 },
        { name: "Gate 6", lat: 20.8906, lon: -156.5116, agl: 80, radius: 70 },
        { name: "Gate 7", lat: 20.8889, lon: -156.5138, agl: 75, radius: 70 },
        { name: "Gate 8", lat: 20.8891, lon: -156.5165, agl: 75, radius: 70 },
      ],
      medals: [190, 160, 140],
    },
    {
      id: 'wailuku-run-2',
      type: 'slalom',
      name: "Wailuku Run",
      where: "8 gates, 2.1 km",
      blurb: "8 gates along 2.1 km of valley, 158 m of wall beside you.",
      needs: 15,
      marker: { lat: 20.9414, lon: -156.5221, agl: 220, heading: 114 },
      limit: 200,
      gates: [
        { name: "Gate 1", lat: 20.9414, lon: -156.5221, agl: 90, radius: 70 },
        { name: "Gate 2", lat: 20.9404, lon: -156.5195, agl: 80, radius: 70 },
        { name: "Gate 3", lat: 20.9388, lon: -156.5174, agl: 90, radius: 70 },
        { name: "Gate 4", lat: 20.9363, lon: -156.5173, agl: 90, radius: 70 },
        { name: "Gate 5", lat: 20.9338, lon: -156.5171, agl: 85, radius: 70 },
        { name: "Gate 6", lat: 20.9316, lon: -156.5159, agl: 85, radius: 70 },
        { name: "Gate 7", lat: 20.9292, lon: -156.5146, agl: 85, radius: 70 },
        { name: "Gate 8", lat: 20.9265, lon: -156.5141, agl: 85, radius: 70 },
      ],
      medals: [185, 155, 135],
    },
    {
      id: 'kula-run',
      type: 'slalom',
      name: "Kula Run",
      where: "7 gates, 1.7 km",
      blurb: "7 gates along 1.7 km of valley, 159 m of wall beside you.",
      needs: 20,
      marker: { lat: 20.7455, lon: -156.321, agl: 240, heading: 162 },
      limit: 173,
      gates: [
        { name: "Gate 1", lat: 20.7455, lon: -156.321, agl: 110, radius: 70 },
        { name: "Gate 2", lat: 20.7437, lon: -156.3203, agl: 100, radius: 70 },
        { name: "Gate 3", lat: 20.742, lon: -156.3185, agl: 90, radius: 70 },
        { name: "Gate 4", lat: 20.7402, lon: -156.3169, agl: 95, radius: 70 },
        { name: "Gate 5", lat: 20.739, lon: -156.3147, agl: 85, radius: 70 },
        { name: "Gate 6", lat: 20.7372, lon: -156.3135, agl: 70, radius: 70 },
        { name: "Gate 7", lat: 20.7361, lon: -156.3111, agl: 65, radius: 70 },
      ],
      medals: [128, 108, 93],
    },
  ],
  jungfrau: [
    {
      // The trench, wall to wall. Four gates rather than the six it used to
      // carry: six was four and a half kilometres and an eighty-three second
      // best, which is a fine piece of flying and half a minute too long.
      id: 'lauterbrunnen-slalom',
      type: 'slalom',
      name: 'Lauterbrunnen Slalom',
      where: 'Trümmelbach north down the trench',
      blurb: 'Four gates down the valley floor with four hundred metres of wall either side.',
      needs: 0,
      marker: { lat: 46.557, lon: 7.902, agl: 260, heading: 29 },
      limit: 90,
      medals: [83, 70, 60],
      gates: [
        { name: 'Trümmelbach', lat: 46.562, lon: 7.906, agl: 237, radius: 80 },
        { name: 'Mürren Cliff', lat: 46.568, lon: 7.9114, agl: 220, radius: 80 },
        { name: 'Wengen Wall', lat: 46.574, lon: 7.9078, agl: 220, radius: 80 },
        { name: 'Staubbach Falls', lat: 46.58, lon: 7.9138, agl: 172, radius: 80 },
      ],
    },
    {
      // Was a five-marker collect. The places are the same and so is the
      // flying; gates simply read better at this speed than pickups did, and
      // the category went when the set was cut to four.
      id: 'eiger-traverse',
      type: 'slalom',
      name: 'Eiger Traverse',
      where: 'The north face down to Kleine Scheidegg',
      blurb: 'Three gates off the wall and along the shelf. Nowhere to turn back.',
      needs: 2,
      marker: { lat: 46.5861, lon: 8.011, agl: 420, heading: 270 },
      limit: 90,
      medals: [74, 62, 54],
      gates: [
        { name: 'Eiger North Face', lat: 46.5861, lon: 8.0053, agl: 699, radius: 95 },
        { name: 'Eigerwand', lat: 46.5804, lon: 7.9896, agl: 611, radius: 95 },
        { name: 'Eigergletscher', lat: 46.5747, lon: 7.9739, agl: 562, radius: 95 },
      ],
    },
    {
      // What is left of the Jungfrau Circuit: the stretch of it worth flying,
      // which was always the glacier. Every measured line finishes this one.
      id: 'jungfraujoch-descent',
      type: 'slalom',
      name: 'Jungfraujoch Descent',
      where: 'The Joch down the Guggi glacier',
      blurb: 'Four gates and a kilometre of vertical. Nowhere to turn round.',
      needs: 6,
      marker: { lat: 46.545, lon: 7.988, agl: 350, heading: 326 },
      limit: 90,
      medals: [83, 70, 60],
      gates: [
        { name: 'Jungfraujoch', lat: 46.549, lon: 7.984, agl: 210, radius: 95 },
        { name: 'Guggi Glacier', lat: 46.556, lon: 7.98, agl: 270, radius: 95 },
        { name: 'Mönchsjoch', lat: 46.564, lon: 7.976, agl: 300, radius: 95 },
        { name: 'Eigergletscher', lat: 46.572, lon: 7.973, agl: 230, radius: 95 },
      ],
    },
    {
      // The strongest air on the eastern half of the map, and a minute to use
      // it. Sixty seconds is not long enough to centre badly and recover, which
      // is the whole task.
      // A ridge run, not a thermal. Sixty seconds is not enough for this
      // aeroplane to centre a column — measured, it loses forty-five metres
      // trying, because one turn takes thirty-seven seconds — but a windward
      // face gives its lift the instant you are on it and asks for no turns at
      // all. Which is also the point: the terrain IS the task.
      //
      // The Breithorn wall at the head of the valley, surveyed at 6.3 m/s held
      // along a kilometre of contour and the strongest such line on the map.
      id: 'wetterhorn-height',
      type: 'height',
      name: 'Breithorn Wall',
      where: 'The head of the Lauterbrunnen valley',
      blurb: 'Sixty seconds beating the windward face. Stay on the rock and it pays the whole way.',
      needs: 4,
      marker: { lat: 46.5102, lon: 7.9071, agl: 200, heading: 71 },
      window: 60,
      // Re-cut when height runs became engine-off. With the lever open this was
      // meaningless — full throttle and the stick back gains a thousand metres
      // against a gold of 190 — and hung off what a soaring pilot could manage
      // it was unreachable. Shut, the site surveys at 5.23 m/s of lift against
      // the ship's 3.18 m/s of sink, so about 2 m/s net and 120 m in the window.
      // Measured at 121.9. That is now a real number about reading the air.
      medals: [65, 90, 110],
    },
    {
      // Down the Lütschine and out over the lakes, which is the one line on
      // this map where the ground falls away faster than the ship does.
      id: 'oberland-dash',
      type: 'distance',
      name: 'Oberland Dash',
      where: 'The trench, north towards the lakes',
      blurb: 'Ninety seconds. Pick the line the valley gives you and do not turn.',
      needs: 8,
      // Pointed at the line the tool found rather than the one that looked
      // right on a map: swept over every heading, due north down the trench
      // beats the next best by most of a kilometre.
      marker: { lat: 46.57, lon: 7.91, agl: 1200, heading: 3 },
      window: 90,
      medals: [2900, 4100, 5100],
    },
    {
      // The trench floor, traced off the baked heightfield as the CENTROID of
      // everything within forty metres of the lowest ground rather than as the
      // lowest pixel: the argmin wanders from one side of a 750 m valley to the
      // other and makes a centreline that zigzags across it.
      //
      // It stops at Zweilütschinen and that is not arbitrary. The 25 m grid
      // bridges the gorge where the two Lütschine meet, and what it bakes is a
      // sixty metre step at a 25 per cent grade — measured, a glider on the
      // deck at forty metres cannot climb it, and every line the calibrator
      // flew through it hit the wall at forty-four seconds. The corridor ends
      // four hundred metres short of it.
      //
      // The slalom flies the southern half of this trench two hundred metres
      // up and rewards a fast line. This is the same rock at thirty-five and
      // rewards nerve, and it carries on two and a half kilometres past where
      // the gates stop. It also goes under every one of the falls.
      id: 'lauterbrunnen-narrows',
      type: 'deck',
      name: 'Under the Falls',
      where: 'The trench floor, Trümmelbach to Zweilütschinen',
      blurb: 'Sixty seconds on the valley floor. The clock runs only while you are under thirty-five metres and between the walls.',
      needs: 1,
      marker: { lat: 46.568, lon: 7.9091, agl: 60, heading: 8 },
      window: 60,
      deck: {
        ceiling: 35,
        width: 200,
        path: [
          [46.568, 7.9091],
          [46.571, 7.9097],
          [46.574, 7.9094],
          [46.577, 7.9106],
          [46.58, 7.9124],
          [46.583, 7.912],
          [46.586, 7.9117],
          [46.589, 7.9111],
          [46.592, 7.9099],
          [46.595, 7.9096],
          [46.598, 7.9091],
          [46.601, 7.9079],
          [46.604, 7.907],
          [46.607, 7.9052],
        ],
      },
      // Measured: the best line the calibrator flew banked 47.2 s of the 60,
      // and it needed the boards to do it — the hoop hands you forty per cent
      // over trim and ninety metres to lose, and the stick alone cannot spend
      // that. Every line that tried climbed away from the deck instead.
      medals: [25, 35, 45],
    },
    {
      // The Grindelwald basin: an open bowl with the Eiger down one side and
      // the Wetterhorn at the head of it, and the only large piece of the map
      // no other task uses. The floor falls two hundred metres along the line,
      // so the field is not at one height and neither is the run.
      id: 'grindelwald-balloons',
      type: 'gunnery',
      name: 'The Grindelwald Field',
      where: 'The basin under the Wetterhorn',
      blurb: 'A line of balloons strung down the bowl. Ninety seconds and three hundred rounds to walk the stream along it.',
      // The one place the gun is rationed. Everywhere else it is unlimited.
      rounds: 300,
      needs: 0,
      // Set back four hundred metres from the first balloon and level with the
      // line rather than five hundred above it. Arriving on top of a field you
      // are looking DOWN into is the worst possible way to meet it: the
      // targets are below the horizon against a valley floor the same size and
      // colour as they are, and the first one is gone before the sight settles.
      marker: { lat: 46.635, lon: 8.015, agl: 300, heading: 112 },
      window: 90,
      targets: {
        count: 12,
        // A band, not a scatter. Was 150–430, which put a two-hundred-and-
        // eighty-metre climb between neighbours and made every balloon its own
        // separate attack; at 230–310 the line is a thing you fly ALONG, and
        // one good pass is worth several. They still step down with the valley
        // floor, which falls two hundred metres over the run, so holding the
        // line is holding a descent.
        height: [230, 310],
        // Thirty-five metres either side of the line instead of a hundred and
        // fifty. The old field asked for a two-hundred-metre lateral jink
        // between consecutive targets at seventy metres a second, which is not
        // gunnery — it is a slalom you also have to shoot.
        spread: 35,
        path: [
          [46.6335, 8.0205],
          [46.628, 8.0405],
          [46.6225, 8.057],
        ],
      },
      // The one ladder in this table set from PLAY rather than from the tool,
      // and deliberately so. The tool's pilot knows where all twelve are
      // before it starts, flies a perfect intercept on each and never has to
      // find anything; it clears eleven. A player has to read the line out of
      // a valley at two hundred and eighty kilometres an hour, and the first
      // report from one was a single balloon on the field as it stood before
      // this — fourteen of them scattered through a two-hundred-and-eighty-
      // metre height band five hundred metres below the hoop.
      //
      // So: bronze is a first pass that goes tolerably, silver is a pass and a
      // turn, gold wants you to know the line. The tool's eleven is the
      // ceiling the ladder is checked against, not the ladder.
      //
      // And that ceiling is noisy in a way no other measurement in this table
      // is: the gun disperses at random, so the same policy sweep comes back
      // with nine, eleven, eleven on three consecutive runs. Hang a gold off
      // the tool's exact number and it fails its own check next week. These
      // sit two clear of the worst of those runs.
      // Re-cut when the Shrike went from a rate stick to an attitude one. The
      // calibrator's gunnery pilot drives roll straight off the target's
      // bearing, which was a proportional rate controller and is now a
      // proportional BANK controller — a different and worse law for tracking —
      // so its best fell from eleven balloons to five on an unchanged field.
      // That is the tool getting worse, not the challenge getting harder: for a
      // player, a stick that holds a bank steady is easier to shoot from.
      //
      // So these are set to be reachable rather than to match a good pilot, and
      // gold sits on the best the tool can still stand behind. The first report
      // from play on the old field was a single balloon; nobody has flown this
      // one yet.
      medals: [3, 4, 5],
    },
    // ---- proposed by tools/propose-challenges.mjs -----------------------
    // Derived from the terrain, the water mask and the surveyed road and rail
    // network, then flown by tools/calibrate-challenges.mjs for their ladders.
    // Nothing in this block was typed off a map.
    {
      id: 'brienzersee-water',
      type: 'deck',
      name: "Brienzersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 7,
      marker: { lat: 46.736, lon: 8.0136, agl: 60, heading: 240 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.736, 8.0136],
          [46.7341, 8.0089],
          [46.7322, 8.0041],
          [46.7303, 7.9993],
          [46.7285, 7.9946],
          [46.7266, 7.9898],
          [46.7239, 7.9859],
          [46.722, 7.9812],
          [46.7194, 7.9773],
          [46.7175, 7.9726],
          [46.7156, 7.9678],
          [46.7146, 7.9625],
          [46.7119, 7.9586],
          [46.711, 7.9533],
          [46.7091, 7.9486],
          [46.7064, 7.9447],
          [46.7037, 7.9408],
          [46.7011, 7.9369],
          [46.6984, 7.933],
          [46.6974, 7.9277],
          [46.6955, 7.923],
          [46.6974, 7.9277],
          [46.6984, 7.933],
          [46.7011, 7.9369],
          [46.7037, 7.9408],
          [46.7064, 7.9447],
          [46.7091, 7.9486],
          [46.711, 7.9533],
          [46.7119, 7.9586],
          [46.7146, 7.9625],
          [46.7156, 7.9678],
          [46.7175, 7.9726],
          [46.7194, 7.9773],
          [46.722, 7.9812],
          [46.7239, 7.9859],
          [46.7266, 7.9898],
          [46.7285, 7.9946],
          [46.7303, 7.9993],
          [46.7322, 8.0041],
          [46.7341, 8.0089],
          [46.736, 8.0136],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'thunersee-water',
      type: 'deck',
      name: "Thunersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 8,
      marker: { lat: 46.6985, lon: 7.7323, agl: 60, heading: 165 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.6985, 7.7323],
          [46.6948, 7.7338],
          [46.6922, 7.7376],
          [46.6885, 7.7391],
          [46.6849, 7.7405],
          [46.6816, 7.7432],
          [46.6789, 7.7471],
          [46.677, 7.7519],
          [46.6761, 7.7572],
          [46.678, 7.7619],
          [46.678, 7.7674],
          [46.678, 7.7729],
          [46.678, 7.7784],
          [46.678, 7.7729],
          [46.678, 7.7674],
          [46.678, 7.7619],
          [46.6761, 7.7572],
          [46.677, 7.7519],
          [46.6789, 7.7471],
          [46.6816, 7.7432],
          [46.6849, 7.7405],
          [46.6816, 7.7432],
          [46.6789, 7.7471],
          [46.677, 7.7519],
          [46.6761, 7.7572],
          [46.678, 7.7619],
          [46.678, 7.7674],
          [46.678, 7.7729],
          [46.678, 7.7784],
          [46.678, 7.7729],
          [46.678, 7.7674],
          [46.678, 7.7619],
          [46.6761, 7.7572],
          [46.677, 7.7519],
          [46.6789, 7.7471],
          [46.6816, 7.7432],
          [46.6849, 7.7405],
          [46.6885, 7.7391],
          [46.6922, 7.7376],
          [46.6948, 7.7338],
          [46.6985, 7.7323],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'thunersee-water-2',
      type: 'deck',
      name: "Thunersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 9,
      marker: { lat: 46.668, lon: 7.7318, agl: 60, heading: 105 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.668, 7.7318],
          [46.667, 7.7371],
          [46.666, 7.7424],
          [46.6633, 7.7462],
          [46.6614, 7.751],
          [46.6596, 7.7558],
          [46.6586, 7.7611],
          [46.6596, 7.7664],
          [46.6586, 7.7717],
          [46.6605, 7.7764],
          [46.6614, 7.7817],
          [46.6614, 7.7872],
          [46.6641, 7.7911],
          [46.6651, 7.7964],
          [46.667, 7.8012],
          [46.667, 7.8066],
          [46.6651, 7.8114],
          [46.6641, 7.8167],
          [46.6651, 7.822],
          [46.6678, 7.8259],
          [46.6715, 7.8259],
          [46.6678, 7.8259],
          [46.6651, 7.822],
          [46.6641, 7.8167],
          [46.6651, 7.8114],
          [46.667, 7.8066],
          [46.667, 7.8012],
          [46.6651, 7.7964],
          [46.6641, 7.7911],
          [46.6614, 7.7872],
          [46.6614, 7.7817],
          [46.6605, 7.7764],
          [46.6586, 7.7717],
          [46.6596, 7.7664],
          [46.6586, 7.7611],
          [46.6596, 7.7558],
          [46.6614, 7.751],
          [46.6633, 7.7462],
          [46.666, 7.7424],
          [46.667, 7.7371],
          [46.668, 7.7318],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'interlaken-floor',
      type: 'deck',
      name: "Interlaken Floor",
      where: "6.2 km of valley floor",
      blurb: "Sixty seconds under 55 m along 6.2 km of valley.",
      needs: 10,
      marker: { lat: 46.6903, lon: 7.8733, agl: 75, heading: 340 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [46.6903, 7.8733],
          [46.6938, 7.8714],
          [46.6955, 7.8751],
          [46.6977, 7.8792],
          [46.699, 7.8844],
          [46.7001, 7.8896],
          [46.7014, 7.8947],
          [46.704, 7.8986],
          [46.7059, 7.9033],
          [46.707, 7.9085],
          [46.7085, 7.9135],
          [46.7114, 7.917],
          [46.713, 7.9218],
          [46.7155, 7.9258],
        ],
      },
      medals: [25, 40, 45],
    },
    {
      id: 'thunersee-field',
      type: 'gunnery',
      name: "The Thunersee Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 11,
      marker: { lat: 46.7591, lon: 7.6984, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [46.7591, 7.7089],
          [46.7591, 7.7233],
          [46.7591, 7.7376],
        ],
      },
      medals: [5, 6, 8],
    },
    {
      id: 'harder-kulm-field',
      type: 'gunnery',
      name: "The Harder Kulm Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 12,
      marker: { lat: 46.7591, lon: 7.8227, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [46.7591, 7.8331],
          [46.7591, 7.8475],
          [46.7591, 7.8619],
        ],
      },
      medals: [1, 2, 3],
    },
    {
      id: 'wilderswil-lift',
      type: 'height',
      name: "Wilderswil Lift",
      where: "Surveyed at 6.3 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 6.3 m/s.",
      needs: 15,
      marker: { lat: 46.6704, lon: 7.8434, agl: 240, heading: 90 },
      window: 60,
      medals: [40, 60, 70],
    },
    {
      id: 'monch-dash',
      type: 'distance',
      name: "Mönch Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 16,
      marker: { lat: 46.5584, lon: 7.9974, agl: 900, heading: 147 },
      window: 90,
      medals: [5000, 7000, 8700],
    },
    {
      id: 'konkordiaplatz-dash',
      type: 'distance',
      name: "Konkordiaplatz Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 17,
      marker: { lat: 46.5008, lon: 8.0857, agl: 900, heading: 147 },
      window: 90,
      medals: [4000, 5500, 6900],
    },
    {
      id: 'brienzersee-water-2',
      type: 'deck',
      name: "Brienzersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 15,
      marker: { lat: 46.736, lon: 8.0136, agl: 60, heading: 240 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.736, 8.0136],
          [46.7341, 8.0089],
          [46.7322, 8.0041],
          [46.7303, 7.9993],
          [46.7285, 7.9946],
          [46.7266, 7.9898],
          [46.7239, 7.9859],
          [46.722, 7.9812],
          [46.7194, 7.9773],
          [46.7175, 7.9726],
          [46.7156, 7.9678],
          [46.7146, 7.9625],
          [46.7119, 7.9586],
          [46.711, 7.9533],
          [46.7091, 7.9486],
          [46.7064, 7.9447],
          [46.7037, 7.9408],
          [46.7011, 7.9369],
          [46.6984, 7.933],
          [46.6974, 7.9277],
          [46.6955, 7.923],
          [46.6974, 7.9277],
          [46.6984, 7.933],
          [46.7011, 7.9369],
          [46.7037, 7.9408],
          [46.7064, 7.9447],
          [46.7091, 7.9486],
          [46.711, 7.9533],
          [46.7119, 7.9586],
          [46.7146, 7.9625],
          [46.7156, 7.9678],
          [46.7175, 7.9726],
          [46.7194, 7.9773],
          [46.722, 7.9812],
          [46.7239, 7.9859],
          [46.7266, 7.9898],
          [46.7285, 7.9946],
          [46.7303, 7.9993],
          [46.7322, 8.0041],
          [46.7341, 8.0089],
          [46.736, 8.0136],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'harder-kulm-water',
      type: 'deck',
      name: "Harder Kulm Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 16,
      marker: { lat: 46.6946, lon: 7.8918, agl: 60, heading: 60 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 230,
        path: [
          [46.6946, 7.8918],
          [46.6965, 7.8966],
          [46.6991, 7.9004],
          [46.701, 7.9052],
          [46.7029, 7.91],
          [46.7048, 7.9147],
          [46.7074, 7.9186],
          [46.7093, 7.9234],
          [46.712, 7.9272],
          [46.7139, 7.932],
          [46.7166, 7.9359],
          [46.7192, 7.9398],
          [46.7219, 7.9436],
          [46.7238, 7.9484],
          [46.7264, 7.9523],
          [46.7291, 7.9562],
          [46.7318, 7.96],
          [46.7337, 7.9648],
          [46.7356, 7.9696],
          [46.7382, 7.9734],
          [46.7409, 7.9773],
          [46.7382, 7.9734],
          [46.7356, 7.9696],
          [46.7337, 7.9648],
          [46.7318, 7.96],
          [46.7291, 7.9562],
          [46.7264, 7.9523],
          [46.7238, 7.9484],
          [46.7219, 7.9436],
          [46.7192, 7.9398],
          [46.7166, 7.9359],
          [46.7139, 7.932],
          [46.712, 7.9272],
          [46.7093, 7.9234],
          [46.7074, 7.9186],
          [46.7048, 7.9147],
          [46.7029, 7.91],
          [46.701, 7.9052],
          [46.6991, 7.9004],
          [46.6965, 7.8966],
          [46.6946, 7.8918],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'brienzersee-water-3',
      type: 'deck',
      name: "Brienzersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 17,
      marker: { lat: 46.7511, lon: 7.9984, agl: 60, heading: 90 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.7511, 7.9984],
          [46.7511, 8.0039],
          [46.7511, 7.9984],
          [46.7501, 7.9931],
          [46.7475, 7.9892],
          [46.7456, 7.9844],
          [46.7437, 7.9797],
          [46.7404, 7.9769],
          [46.7378, 7.973],
          [46.7351, 7.9692],
          [46.7332, 7.9644],
          [46.7313, 7.9597],
          [46.7287, 7.9558],
          [46.726, 7.9519],
          [46.7233, 7.948],
          [46.7214, 7.9432],
          [46.7188, 7.9394],
          [46.7161, 7.9355],
          [46.7142, 7.9307],
          [46.7115, 7.9268],
          [46.7089, 7.923],
          [46.7115, 7.9268],
          [46.7142, 7.9307],
          [46.7161, 7.9355],
          [46.7188, 7.9394],
          [46.7214, 7.9432],
          [46.7233, 7.948],
          [46.726, 7.9519],
          [46.7287, 7.9558],
          [46.7313, 7.9597],
          [46.7332, 7.9644],
          [46.7351, 7.9692],
          [46.7378, 7.973],
          [46.7404, 7.9769],
          [46.7437, 7.9797],
          [46.7456, 7.9844],
          [46.7475, 7.9892],
          [46.7501, 7.9931],
          [46.7511, 7.9984],
          [46.7511, 8.0039],
          [46.7511, 7.9984],
        ],
      },
      medals: [20, 25, 35],
    },
    {
      id: 'brienzersee-water-4',
      type: 'deck',
      name: "Brienzersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 18,
      marker: { lat: 46.7437, lon: 8.041, agl: 60, heading: 105 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 310,
        path: [
          [46.7437, 8.041],
          [46.7428, 8.0463],
          [46.7428, 8.0518],
          [46.7428, 8.0463],
          [46.7437, 8.041],
          [46.7437, 8.0355],
          [46.7419, 8.0307],
          [46.7409, 8.0254],
          [46.739, 8.0207],
          [46.7371, 8.0159],
          [46.7352, 8.0112],
          [46.7333, 8.0064],
          [46.7315, 8.0016],
          [46.7296, 7.9969],
          [46.7277, 7.9921],
          [46.725, 7.9883],
          [46.7231, 7.9835],
          [46.7205, 7.9796],
          [46.7178, 7.9757],
          [46.7159, 7.971],
          [46.7169, 7.9657],
          [46.7159, 7.971],
          [46.7178, 7.9757],
          [46.7205, 7.9796],
          [46.7231, 7.9835],
          [46.725, 7.9883],
          [46.7277, 7.9921],
          [46.7296, 7.9969],
          [46.7315, 8.0016],
          [46.7333, 8.0064],
          [46.7352, 8.0112],
          [46.7371, 8.0159],
          [46.739, 8.0207],
          [46.7409, 8.0254],
          [46.7419, 8.0307],
          [46.7437, 8.0355],
          [46.7437, 8.041],
          [46.7428, 8.0463],
          [46.7428, 8.0518],
          [46.7428, 8.0463],
          [46.7437, 8.041],
        ],
      },
      medals: [15, 25, 30],
    },
    {
      id: 'thunersee-water-3',
      type: 'deck',
      name: "Thunersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 19,
      marker: { lat: 46.6616, lon: 7.7804, agl: 60, heading: 90 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.6616, 7.7804],
          [46.6616, 7.7859],
          [46.6616, 7.7804],
          [46.6598, 7.7756],
          [46.6588, 7.7703],
          [46.6598, 7.765],
          [46.6588, 7.7597],
          [46.6598, 7.7544],
          [46.6616, 7.7497],
          [46.6643, 7.7458],
          [46.6662, 7.741],
          [46.6672, 7.7357],
          [46.6681, 7.7304],
          [46.67, 7.7257],
          [46.6719, 7.7209],
          [46.6729, 7.7156],
          [46.6748, 7.7108],
          [46.6784, 7.7094],
          [46.6822, 7.7094],
          [46.6849, 7.7055],
          [46.6875, 7.7017],
          [46.6849, 7.7055],
          [46.6822, 7.7094],
          [46.6784, 7.7094],
          [46.6748, 7.7108],
          [46.6729, 7.7156],
          [46.6719, 7.7209],
          [46.67, 7.7257],
          [46.6681, 7.7304],
          [46.6672, 7.7357],
          [46.6662, 7.741],
          [46.6643, 7.7458],
          [46.6616, 7.7497],
          [46.6598, 7.7544],
          [46.6588, 7.7597],
          [46.6598, 7.765],
          [46.6588, 7.7703],
          [46.6598, 7.7756],
          [46.6616, 7.7804],
          [46.6616, 7.7859],
          [46.6616, 7.7804],
        ],
      },
      medals: [20, 30, 40],
    },
    {
      id: 'brienzersee-water-5',
      type: 'deck',
      name: "Brienzersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 20,
      marker: { lat: 46.7409, lon: 7.9773, agl: 60, heading: 30 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.7409, 7.9773],
          [46.7442, 7.9801],
          [46.746, 7.9848],
          [46.7479, 7.9896],
          [46.7498, 7.9943],
          [46.7517, 7.9991],
          [46.7517, 8.0046],
          [46.7527, 8.0099],
          [46.7537, 8.0152],
          [46.7537, 8.0207],
          [46.7537, 8.0152],
          [46.7527, 8.0099],
          [46.7517, 8.0046],
          [46.7517, 7.9991],
          [46.7498, 7.9943],
          [46.7479, 7.9896],
          [46.746, 7.9848],
          [46.7442, 7.9801],
          [46.7409, 7.9773],
          [46.7382, 7.9734],
          [46.7356, 7.9696],
          [46.7382, 7.9734],
          [46.7409, 7.9773],
          [46.7442, 7.9801],
          [46.746, 7.9848],
          [46.7479, 7.9896],
          [46.7498, 7.9943],
          [46.7517, 7.9991],
          [46.7517, 8.0046],
          [46.7527, 8.0099],
          [46.7537, 8.0152],
          [46.7537, 8.0207],
          [46.7537, 8.0152],
          [46.7527, 8.0099],
          [46.7517, 8.0046],
          [46.7517, 7.9991],
          [46.7498, 7.9943],
          [46.7479, 7.9896],
          [46.746, 7.9848],
          [46.7442, 7.9801],
          [46.7409, 7.9773],
        ],
      },
      medals: [25, 40, 45],
    },
    {
      id: 'brienzersee-water-6',
      type: 'deck',
      name: "Brienzersee Water",
      where: "16.8 km of open water",
      blurb: "Sixty seconds under 40 m along 16.8 km of water.",
      needs: 21,
      marker: { lat: 46.7498, lon: 8.0439, agl: 60, heading: 285 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 320,
        path: [
          [46.7498, 8.0439],
          [46.7508, 8.0386],
          [46.7508, 8.0331],
          [46.7518, 8.0278],
          [46.7527, 8.0225],
          [46.7537, 8.0172],
          [46.7527, 8.0119],
          [46.7518, 8.0065],
          [46.7518, 8.0011],
          [46.7508, 7.9958],
          [46.7489, 7.991],
          [46.747, 7.9862],
          [46.7451, 7.9815],
          [46.7425, 7.9776],
          [46.7392, 7.9749],
          [46.7365, 7.971],
          [46.7339, 7.9671],
          [46.7329, 7.9618],
          [46.7302, 7.9579],
          [46.7276, 7.954],
          [46.7249, 7.9501],
          [46.7276, 7.954],
          [46.7302, 7.9579],
          [46.7329, 7.9618],
          [46.7339, 7.9671],
          [46.7365, 7.971],
          [46.7392, 7.9749],
          [46.7425, 7.9776],
          [46.7451, 7.9815],
          [46.747, 7.9862],
          [46.7489, 7.991],
          [46.7508, 7.9958],
          [46.7518, 8.0011],
          [46.7518, 8.0065],
          [46.7527, 8.0119],
          [46.7537, 8.0172],
          [46.7527, 8.0225],
          [46.7518, 8.0278],
          [46.7508, 8.0331],
          [46.7508, 8.0386],
          [46.7498, 8.0439],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'harder-kulm-field-2',
      type: 'gunnery',
      name: "The Harder Kulm Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 25,
      marker: { lat: 46.7591, lon: 7.8848, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [46.7591, 7.8952],
          [46.7591, 7.9096],
          [46.7591, 7.924],
        ],
      },
      medals: [1, 2, 3],
    },
    {
      id: 'schwarzhorn-field',
      type: 'gunnery',
      name: "The Schwarzhorn Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 27,
      marker: { lat: 46.7591, lon: 8.066, agl: 240, heading: 135 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [46.754, 8.0734],
          [46.7471, 8.0835],
          [46.7401, 8.0937],
        ],
      },
      medals: [5, 7, 9],
    },
    {
      id: 'bachalpsee-lift',
      type: 'height',
      name: "Bachalpsee Lift",
      where: "Surveyed at 5.6 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 5.6 m/s.",
      needs: 32,
      marker: { lat: 46.7047, lon: 8.0291, agl: 240, heading: 90 },
      window: 60,
      medals: [45, 60, 75],
    },
    {
      id: 'staubbach-falls-lift',
      type: 'height',
      name: "Staubbach Falls Lift",
      where: "Surveyed at 5.4 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 5.4 m/s.",
      needs: 33,
      marker: { lat: 46.5911, lon: 7.8683, agl: 240, heading: 90 },
      window: 60,
      medals: [50, 70, 90],
    },
    {
      id: 'konkordiaplatz-dash-2',
      type: 'distance',
      name: "Konkordiaplatz Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 37,
      marker: { lat: 46.5459, lon: 8.0676, agl: 900, heading: 147 },
      window: 90,
      medals: [5000, 7000, 8700],
    },
    {
      id: 'schreckhorn-dash',
      type: 'distance',
      name: "Schreckhorn Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 38,
      marker: { lat: 46.6019, lon: 8.1016, agl: 900, heading: 147 },
      window: 90,
      medals: [4900, 6800, 8500],
    },
    {
      id: 'bluemlisalp-dash',
      type: 'distance',
      name: "Blüemlisalp Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 39,
      marker: { lat: 46.5117, lon: 7.8252, agl: 900, heading: 147 },
      window: 90,
      medals: [5000, 7000, 8700],
    },
    {
      id: 'schilthorn-dash',
      type: 'distance',
      name: "Schilthorn Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 40,
      marker: { lat: 46.5584, lon: 7.832, agl: 900, heading: 147 },
      window: 90,
      medals: [4900, 6800, 8500],
    },
    {
      id: 'schwarzhorn-dash',
      type: 'distance',
      name: "Schwarzhorn Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 41,
      marker: { lat: 46.6922, lon: 8.0744, agl: 900, heading: 147 },
      window: 90,
      medals: [4900, 6800, 8500],
    },
    {
      id: 'interlaken-run',
      type: 'slalom',
      name: "Interlaken Run",
      where: "7 gates, 1.7 km",
      blurb: "7 gates along 1.7 km of valley, 356 m of wall beside you.",
      needs: 8,
      marker: { lat: 46.6801, lon: 7.8232, agl: 215, heading: 257 },
      limit: 185,
      gates: [
        { name: "Gate 1", lat: 46.6801, lon: 7.8232, agl: 85, radius: 70 },
        { name: "Gate 2", lat: 46.6796, lon: 7.8196, agl: 90, radius: 70 },
        { name: "Gate 3", lat: 46.6802, lon: 7.8164, agl: 90, radius: 70 },
        { name: "Gate 4", lat: 46.6822, lon: 7.8143, agl: 125, radius: 70 },
        { name: "Gate 5", lat: 46.6826, lon: 7.8108, agl: 175, radius: 70 },
        { name: "Gate 6", lat: 46.6826, lon: 7.8072, agl: 140, radius: 70 },
        { name: "Gate 7", lat: 46.6835, lon: 7.8044, agl: 165, radius: 70 },
      ],
      medals: [135, 115, 100],
    },
    {
      id: 'wilderswil-run',
      type: 'slalom',
      name: "Wilderswil Run",
      where: "7 gates, 1.6 km",
      blurb: "7 gates along 1.6 km of valley, 286 m of wall beside you.",
      needs: 10,
      marker: { lat: 46.6673, lon: 7.8659, agl: 215, heading: 261 },
      limit: 200,
      gates: [
        { name: "Gate 1", lat: 46.6673, lon: 7.8659, agl: 85, radius: 70 },
        { name: "Gate 2", lat: 46.6669, lon: 7.8625, agl: 85, radius: 70 },
        { name: "Gate 3", lat: 46.6679, lon: 7.8596, agl: 95, radius: 70 },
        { name: "Gate 4", lat: 46.6697, lon: 7.8576, agl: 85, radius: 70 },
        { name: "Gate 5", lat: 46.671, lon: 7.8552, agl: 100, radius: 70 },
        { name: "Gate 6", lat: 46.6731, lon: 7.8551, agl: 80, radius: 70 },
        { name: "Gate 7", lat: 46.6753, lon: 7.8542, agl: 85, radius: 70 },
      ],
      medals: [160, 135, 115],
    },
    {
      id: 'kleine-scheidegg-run',
      type: 'slalom',
      name: "Kleine Scheidegg Run",
      where: "7 gates, 1.6 km",
      blurb: "7 gates along 1.6 km of valley, 280 m of wall beside you.",
      needs: 15,
      marker: { lat: 46.5852, lon: 7.9779, agl: 230, heading: 238 },
      limit: 169,
      gates: [
        { name: "Gate 1", lat: 46.5852, lon: 7.9779, agl: 100, radius: 70 },
        { name: "Gate 2", lat: 46.584, lon: 7.9751, agl: 95, radius: 70 },
        { name: "Gate 3", lat: 46.5831, lon: 7.972, agl: 90, radius: 70 },
        { name: "Gate 4", lat: 46.5835, lon: 7.9688, agl: 80, radius: 70 },
        { name: "Gate 5", lat: 46.5843, lon: 7.9657, agl: 85, radius: 70 },
        { name: "Gate 6", lat: 46.5854, lon: 7.9625, agl: 80, radius: 70 },
        { name: "Gate 7", lat: 46.5847, lon: 7.9593, agl: 70, radius: 70 },
      ],
      medals: [125, 105, 90],
    },
    {
      id: 'schwarzhorn-run',
      type: 'slalom',
      name: "Schwarzhorn Run",
      where: "7 gates, 1.9 km",
      blurb: "7 gates along 1.9 km of valley, 335 m of wall beside you.",
      needs: 21,
      marker: { lat: 46.746, lon: 8.0938, agl: 225, heading: 113 },
      limit: 200,
      gates: [
        { name: "Gate 1", lat: 46.746, lon: 8.0938, agl: 95, radius: 70 },
        { name: "Gate 2", lat: 46.7453, lon: 8.0959, agl: 90, radius: 70 },
        { name: "Gate 3", lat: 46.7461, lon: 8.0999, agl: 90, radius: 70 },
        { name: "Gate 4", lat: 46.746, lon: 8.1041, agl: 85, radius: 70 },
        { name: "Gate 5", lat: 46.7457, lon: 8.1083, agl: 85, radius: 70 },
        { name: "Gate 6", lat: 46.7453, lon: 8.1126, agl: 85, radius: 70 },
        { name: "Gate 7", lat: 46.7449, lon: 8.1168, agl: 85, radius: 70 },
      ],
      medals: [195, 190, 165],
    },
    {
      id: 'thunersee-run',
      type: 'slalom',
      name: "Thunersee Run",
      where: "7 gates, 1.5 km",
      blurb: "7 gates along 1.5 km of valley, 171 m of wall beside you.",
      needs: 23,
      marker: { lat: 46.6595, lon: 7.7057, agl: 210, heading: 126 },
      limit: 161,
      gates: [
        { name: "Gate 1", lat: 46.6595, lon: 7.7057, agl: 80, radius: 70 },
        { name: "Gate 2", lat: 46.6582, lon: 7.7084, agl: 80, radius: 70 },
        { name: "Gate 3", lat: 46.6582, lon: 7.7117, agl: 90, radius: 70 },
        { name: "Gate 4", lat: 46.6577, lon: 7.7145, agl: 85, radius: 70 },
        { name: "Gate 5", lat: 46.6567, lon: 7.7175, agl: 85, radius: 70 },
        { name: "Gate 6", lat: 46.6568, lon: 7.7206, agl: 90, radius: 70 },
        { name: "Gate 7", lat: 46.6583, lon: 7.7227, agl: 105, radius: 70 },
      ],
      medals: [119, 101, 86],
    },
    {
      id: 'thunersee-run-2',
      type: 'slalom',
      name: "Thunersee Run",
      where: "9 gates, 2.3 km",
      blurb: "9 gates along 2.3 km of valley, 144 m of wall beside you.",
      needs: 31,
      marker: { lat: 46.7167, lon: 7.7113, agl: 225, heading: 32 },
      limit: 182,
      gates: [
        { name: "Gate 1", lat: 46.7167, lon: 7.7113, agl: 95, radius: 70 },
        { name: "Gate 2", lat: 46.7185, lon: 7.7128, agl: 120, radius: 70 },
        { name: "Gate 3", lat: 46.7197, lon: 7.7161, agl: 100, radius: 70 },
        { name: "Gate 4", lat: 46.7217, lon: 7.7182, agl: 80, radius: 70 },
        { name: "Gate 5", lat: 46.7232, lon: 7.7208, agl: 75, radius: 70 },
        { name: "Gate 6", lat: 46.7251, lon: 7.723, agl: 80, radius: 70 },
        { name: "Gate 7", lat: 46.7276, lon: 7.7239, agl: 85, radius: 70 },
        { name: "Gate 8", lat: 46.7297, lon: 7.726, agl: 70, radius: 70 },
        { name: "Gate 9", lat: 46.7312, lon: 7.7288, agl: 60, radius: 70 },
      ],
      medals: [134, 113, 97],
    },
  ],

  chicago: [
    {
      // Was a five-marker collect over the roofs. Same roofs, gates instead.
      id: 'loop-rooftops',
      type: 'slalom',
      name: 'Loop Rooftops',
      where: 'Willis Tower out to Michigan Avenue',
      blurb: 'Three gates over the big roofs. You arrive above all of them once.',
      needs: 3,
      marker: { lat: 41.876, lon: -87.646, agl: 700, heading: 40 },
      limit: 90,
      medals: [83, 70, 60],
      gates: [
        { name: 'Willis Tower', lat: 41.8789, lon: -87.6359, agl: 647, radius: 100 },
        { name: 'Trump Tower', lat: 41.8892, lon: -87.6266, agl: 574, radius: 95 },
        { name: 'St. Regis', lat: 41.8869, lon: -87.6199, agl: 541, radius: 95 },
      ],
    },
    {
      // What is left of the Loop Circuit: the tower, the river and the pier,
      // which was always the half of it worth flying.
      id: 'loop-circuit',
      type: 'slalom',
      name: 'The Loop Run',
      where: 'The tower, the river, the pier',
      blurb: 'Three gates over the Willis mast, down the river and out to Navy Pier.',
      needs: 6,
      // West of the tower, so the whole run goes one way. It used to open a
      // kilometre EAST of Willis, which made the first leg a reversal before
      // the course had started — and a reversal is the most expensive thing
      // there is in a ninety second budget.
      marker: { lat: 41.8789, lon: -87.648, agl: 950, heading: 90 },
      limit: 90,
      medals: [89, 79, 68],
      // Wolf Point came off it. Going west to the fork and back east to Michigan
      // Avenue is a reversal in the middle of a run that is otherwise one line,
      // and measured it cost forty seconds of a ninety second budget: four gates
      // took 125 s and could not be bronzed inside the cap. Three gates, one
      // direction, tower to pier.
      gates: [
        { name: 'Willis Tower', lat: 41.8789, lon: -87.6359, agl: 849, radius: 115 },
        { name: 'Michigan Avenue Bridge', lat: 41.8887, lon: -87.6247, agl: 707, radius: 90 },
        { name: 'Navy Pier', lat: 41.8917, lon: -87.6086, agl: 620, radius: 95 },
      ],
    },
    {
      // The strongest column on the map, standing over the roofs north of the
      // river. air.seedThermals is deterministic, so it is at a fixed address
      // and the hoop can be authored onto it.
      // The flat map's answer to a ridge: the lake breeze front, where cool air
      // off the water meets the city's own and the convergence runs in a line
      // down the shore. Surveyed at 6.0 m/s held along a kilometre of it, which
      // is the strongest held lift in Chicago — and like a ridge it needs no
      // turns, which is the only way a minute is long enough.
      id: 'heat-island',
      type: 'height',
      name: 'The Breeze Front',
      where: 'The shore line off the museums',
      blurb: 'No hills, one convergence line. Sixty seconds, and it only pays while you are on it.',
      needs: 4,
      marker: { lat: 41.87, lon: -87.6169, agl: 150, heading: 156 },
      window: 60,
      // Engine-off now, like every height run — see the note on the Breithorn
      // Wall. The lake-breeze convergence is weaker than an alpine face, so
      // this is the harder of the two despite being over a city.
      medals: [80, 110, 130],
    },
    {
      // Down the lakefront, where the convergence line runs. The flattest map
      // in the game and the one place on it the air helps you go somewhere.
      id: 'lakefront-dash',
      type: 'distance',
      name: 'Lakefront Dash',
      where: 'Lincoln Park, out across the city',
      blurb: 'Ninety seconds and nothing to turn for. The line that pays is not the one down the shore.',
      needs: 8,
      // Swept over every heading: south-west across the city wins, because the
      // lake takes 1.9 m/s off anything that strays over it and the shore line
      // bends away. The hoop points at the answer.
      marker: { lat: 41.9265, lon: -87.6355, agl: 620, heading: 220 },
      window: 90,
      medals: [3100, 4300, 5400],
    },
    {
      // Chicago has no terrain, so its deck run is made of buildings. The path
      // is the water mask's own centreline — 95 per cent of it is river — and
      // it is flown south to north on purpose: the first fifteen seconds are
      // over the railyards where nothing is taller than twenty-five metres,
      // then Willis and 311 South Wacker close in to four hundred, then the
      // corner at Wolf Point, and only then the straight run out to the lake.
      // Easy, hard, hardest, release.
      //
      // The corridor is 110 m either side of a river 90 m wide, so the banks
      // are inside it. That is deliberate: the corridor decides whether the
      // clock runs and the buildings decide whether you live, and keeping those
      // two rules apart is what stops it being a tunnel with invisible walls.
      // Was a deck run down the Chicago river, and that was the wrong place for
      // it. The channel through the Loop is 46 to 82 m of half-width with
      // 230-to-260-metre towers standing on the bank, so any corridor wide
      // enough for an aeroplane to hold reaches the buildings — and the version
      // that "worked" only worked because a 110 m corridor let the pilot fly
      // over the STREETS instead of the water. Snapping the path to the
      // surveyed channel, narrowing it, raising the ceiling and cutting the
      // dogleg all failed the same way: 48 lines, 48 structures. The map
      // already has river-run down that same water, which is the honest way to
      // fly it — a gate course, not a corridor.
      //
      // So: the lakefront, a kilometre offshore, where the design does work.
      // Every point below is verified wet against the baked mask, there is
      // nothing to hit for five kilometres, and the whole skyline is beside you
      // the entire way. Same shape as the Aurlandsfjord and Pali coast runs.
      id: 'shore-level',
      type: 'deck',
      name: 'Shore Level',
      where: 'A kilometre off the lakefront, south to north',
      blurb: 'Sixty seconds at forty metres over open water, with the whole skyline down your left side.',
      needs: 4,
      marker: { lat: 41.856, lon: -87.598, agl: 55, heading: 12 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 160,
        path: [
          [41.856, -87.598],
          [41.866, -87.594],
          [41.876, -87.591],
          [41.886, -87.589],
          [41.896, -87.59],
          [41.906, -87.593],
          [41.916, -87.596],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      // Moored out in the harbour off the Loop, which is the one large open
      // volume on this map and the only place a fast aeroplane can turn round
      // without a building in the way. The skyline is the backdrop rather than
      // the obstacle — this is where you learn the gun, and the Grindelwald
      // field is where the terrain starts arguing.
      id: 'harbour-balloons',
      type: 'gunnery',
      name: 'The Harbour Line',
      where: 'Moored off the lakefront',
      blurb: 'A line of balloons moored off the shore, with the whole skyline behind them. Ninety seconds and three hundred rounds.',
      rounds: 300,
      needs: 0,
      // Same treatment as Grindelwald: set back from the first balloon and
      // level with the line rather than well above it.
      marker: { lat: 41.8655, lon: -87.6104, agl: 240, heading: 9 },
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [41.8695, -87.6095],
          [41.8785, -87.6075],
          [41.8875, -87.6062],
          [41.8945, -87.605],
        ],
      },
      // A rung above Grindelwald all the way up, because this is the site with
      // nothing in it: open water, no walls to hit, no valley floor coming up
      // to meet the line, and a whole lake to turn round in. The terrain does
      // none of the work here, so the shooting has to.
      medals: [5, 7, 9],
    },
    // ---- proposed by tools/propose-challenges.mjs -----------------------
    // Derived from the terrain, the water mask and the surveyed road and rail
    // network, then flown by tools/calibrate-challenges.mjs for their ladders.
    // Nothing in this block was typed off a map.
    {
      id: 'bronzeville-water',
      type: 'deck',
      name: "Bronzeville Water",
      where: "5.0 km of open water",
      blurb: "Sixty seconds under 40 m along 5.0 km of water.",
      needs: 7,
      marker: { lat: 41.8359, lon: -87.5968, agl: 60, heading: 330 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 260,
        path: [
          [41.8359, -87.5968],
          [41.8392, -87.5993],
          [41.8418, -87.6029],
          [41.8451, -87.6054],
          [41.8489, -87.6054],
          [41.8525, -87.6041],
          [41.8562, -87.6028],
          [41.8525, -87.6041],
          [41.8489, -87.6054],
          [41.8451, -87.6054],
          [41.8418, -87.6029],
          [41.8392, -87.5993],
          [41.8359, -87.5968],
        ],
      },
      medals: [20, 30, 35],
    },
    {
      id: 'belmont-harbor-water',
      type: 'deck',
      name: "Belmont Harbor Water",
      where: "11.8 km of open water",
      blurb: "Sixty seconds under 40 m along 11.8 km of water.",
      needs: 8,
      marker: { lat: 41.9376, lon: -87.6295, agl: 60, heading: 150 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 120,
        path: [
          [41.9376, -87.6295],
          [41.9343, -87.6269],
          [41.9305, -87.6269],
          [41.9269, -87.6256],
          [41.9231, -87.6256],
          [41.9195, -87.6243],
          [41.9168, -87.6207],
          [41.9132, -87.6194],
          [41.9099, -87.6219],
          [41.9063, -87.6206],
          [41.903, -87.6181],
          [41.9003, -87.6145],
          [41.8993, -87.6096],
          [41.8993, -87.6046],
          [41.8975, -87.6002],
          [41.8993, -87.6046],
          [41.8993, -87.6096],
          [41.9003, -87.6145],
          [41.903, -87.6181],
          [41.9063, -87.6206],
          [41.9099, -87.6219],
          [41.9132, -87.6194],
          [41.9168, -87.6207],
          [41.9195, -87.6243],
          [41.9231, -87.6256],
          [41.9269, -87.6256],
          [41.9305, -87.6269],
          [41.9343, -87.6269],
          [41.9376, -87.6295],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'united-center-floor',
      type: 'deck',
      name: "United Center Floor",
      where: "6.3 km of valley floor",
      blurb: "Sixty seconds under 55 m along 6.3 km of valley.",
      needs: 9,
      marker: { lat: 41.8828, lon: -87.6871, agl: 75, heading: 7 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [41.8828, -87.6871],
          [41.8861, -87.6866],
          [41.8899, -87.6867],
          [41.8937, -87.6868],
          [41.8974, -87.6869],
          [41.9012, -87.687],
          [41.905, -87.6871],
          [41.9087, -87.6872],
          [41.9125, -87.6873],
          [41.9163, -87.6874],
          [41.9201, -87.6875],
          [41.9238, -87.6876],
          [41.9276, -87.6877],
          [41.9314, -87.6878],
        ],
      },
      medals: [30, 40, 50],
    },
    {
      id: 'humboldt-park-floor',
      type: 'deck',
      name: "Humboldt Park Floor",
      where: "4.3 km of valley floor",
      blurb: "Sixty seconds under 55 m along 4.3 km of valley.",
      needs: 10,
      marker: { lat: 41.9233, lon: -87.6802, agl: 75, heading: 307 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [41.9233, -87.6802],
          [41.9256, -87.6842],
          [41.9265, -87.6861],
          [41.9242, -87.6822],
          [41.9221, -87.678],
          [41.9198, -87.674],
          [41.9174, -87.6701],
          [41.9142, -87.6674],
          [41.9108, -87.6653],
          [41.9077, -87.6624],
          [41.9042, -87.6612],
        ],
      },
      medals: [20, 25, 30],
    },
    {
      id: 'wrigley-field-field',
      type: 'gunnery',
      name: "The Wrigley Field Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 11,
      marker: { lat: 41.9397, lon: -87.6746, agl: 240, heading: 135 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [41.9347, -87.6677],
          [41.9277, -87.6584],
          [41.9207, -87.649],
        ],
      },
      medals: [5, 6, 8],
    },
    {
      id: 'lincoln-park-field',
      type: 'gunnery',
      name: "The Lincoln Park Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 12,
      marker: { lat: 41.9266, lon: -87.5918, agl: 240, heading: 135 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [41.9215, -87.585],
          [41.9146, -87.5756],
          [41.9076, -87.5662],
        ],
      },
      medals: [4, 6, 8],
    },
    {
      id: 'united-center-field',
      type: 'gunnery',
      name: "The United Center Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 13,
      marker: { lat: 41.8781, lon: -87.7027, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [41.8781, -87.6931],
          [41.8781, -87.6798],
          [41.8781, -87.6665],
        ],
      },
      medals: [6, 8, 10],
    },
    {
      id: 'field-museum-lift',
      type: 'height',
      name: "Field Museum Lift",
      where: "Surveyed at 7.7 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 7.7 m/s.",
      needs: 14,
      marker: { lat: 41.8678, lon: -87.6171, agl: 240, heading: 90 },
      window: 60,
      medals: [60, 85, 110],
    },
    {
      id: 'old-town-lift',
      type: 'height',
      name: "Old Town Lift",
      where: "Surveyed at 7.5 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 7.5 m/s.",
      needs: 15,
      marker: { lat: 41.9148, lon: -87.6664, agl: 240, heading: 90 },
      window: 60,
      medals: [60, 80, 100],
    },
    {
      id: 'soldier-field-dash',
      type: 'distance',
      name: "Soldier Field Dash",
      where: "Ninety seconds, one direction",
      blurb: "Ninety seconds. Take the line the ground gives you and do not turn.",
      needs: 16,
      marker: { lat: 41.8517, lon: -87.614, agl: 900, heading: 305 },
      window: 90,
      medals: [4700, 6500, 8100],
    },
    {
      id: 'pilsen-floor',
      type: 'deck',
      name: "Pilsen Floor",
      where: "7.2 km of valley floor",
      blurb: "Sixty seconds under 55 m along 7.2 km of valley.",
      needs: 13,
      marker: { lat: 41.8568, lon: -87.689, agl: 75, heading: 253 },
      window: 60,
      deck: {
        ceiling: 55,
        width: 130,
        path: [
          [41.8568, -87.689],
          [41.8557, -87.6939],
          [41.856, -87.6922],
          [41.8571, -87.6874],
          [41.8585, -87.6827],
          [41.8594, -87.6777],
          [41.8599, -87.6727],
          [41.86, -87.6677],
          [41.8601, -87.6626],
          [41.8602, -87.6575],
          [41.8604, -87.6525],
          [41.8604, -87.6474],
          [41.8604, -87.6423],
          [41.861, -87.6375],
        ],
      },
      medals: [15, 25, 30],
    },
    {
      id: 'pilsen-field',
      type: 'gunnery',
      name: "The Pilsen Field",
      where: "A line of balloons",
      blurb: "A line of balloons. Ninety seconds and three hundred rounds.",
      needs: 15,
      marker: { lat: 41.8401, lon: -87.6887, agl: 240, heading: 90 },
      rounds: 300,
      window: 90,
      targets: {
        count: 12,
        height: [180, 260],
        spread: 35,
        path: [
          [41.8401, -87.679],
          [41.8401, -87.6657],
          [41.8401, -87.6525],
        ],
      },
      medals: [4, 5, 6],
    },
    {
      id: 'pilsen-lift',
      type: 'height',
      name: "Pilsen Lift",
      where: "Surveyed at 6.9 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 6.9 m/s.",
      needs: 17,
      marker: { lat: 41.838, lon: -87.7049, agl: 240, heading: 90 },
      window: 60,
      medals: [50, 70, 90],
    },
    {
      id: 'pilsen-lift-2',
      type: 'height',
      name: "Pilsen Lift",
      where: "Surveyed at 4.3 m/s",
      blurb: "Engine shut. Sixty seconds on air surveyed at 4.3 m/s.",
      needs: 20,
      marker: { lat: 41.8403, lon: -87.6587, agl: 240, heading: 90 },
      window: 60,
      medals: [45, 65, 80],
    },
    {
      id: 'west-loop-run',
      type: 'slalom',
      name: "West Loop Run",
      where: "8 gates, 2.1 km",
      blurb: "8 gates along 2.1 km of valley, 176 m of wall beside you.",
      needs: 15,
      marker: { lat: 41.8842, lon: -87.6608, agl: 225, heading: 258 },
      limit: 200,
      gates: [
        { name: "Gate 1", lat: 41.8842, lon: -87.6608, agl: 95, radius: 70 },
        { name: "Gate 2", lat: 41.8837, lon: -87.6641, agl: 85, radius: 70 },
        { name: "Gate 3", lat: 41.8833, lon: -87.6672, agl: 85, radius: 70 },
        { name: "Gate 4", lat: 41.8832, lon: -87.6708, agl: 85, radius: 70 },
        { name: "Gate 5", lat: 41.8832, lon: -87.6744, agl: 85, radius: 70 },
        { name: "Gate 6", lat: 41.8831, lon: -87.678, agl: 85, radius: 70 },
        { name: "Gate 7", lat: 41.8831, lon: -87.6815, agl: 85, radius: 70 },
        { name: "Gate 8", lat: 41.8822, lon: -87.684, agl: 85, radius: 70 },
      ],
      medals: [155, 130, 110],
    },
  ],
};

/**
 * The secrets. Nothing points at any of these.
 *
 * The rule for what belongs here: it must be a thing you DID, it must be
 * possible to do it by accident approximately never, and the map must already
 * contain whatever makes it worth doing. Every one of these is hung off
 * surveyed data that was already in the build and that nobody could reach —
 * a rack railway, a bulldozed airfield, a street canyon, two round towers with
 * a gap between them.
 *
 * `hint` is what the menu shows for one you have not found. It has to be true
 * and it has to be useless as an instruction: a hint that names the place is a
 * quest marker with extra steps. `note` is what you get when you find it, and
 * that one can say whatever it likes.
 *
 * See src/secrets.js for the three verbs.
 */
export const SECRETS = {
  flam: [
    {
      // Gudvangatunnelen, 11.4 km on the E16, and the fifth-longest road tunnel
      // in the world. Nobody would ever notice a portal in a cliff at 13 m.
      id: 'gudvanga-portal',
      kind: 'place',
      name: 'The Other Long Tunnel',
      hint: 'The famous one is not the only hole in these mountains. There is a second mouth at the head of the west fjord, down at the water.',
      note: 'Gudvangatunnelen, 11.4 km — the fifth-longest road tunnel anywhere, and the one nobody has heard of.',
      lat: 60.8798,
      lon: 6.847,
      radius: 200,
      below: 110,
    },
    {
      // Where the Naeroyfjord closes to two hundred and fifty metres, walls
      // 1,600 m up both sides. It is a UNESCO site for exactly this.
      id: 'naeroy-narrows',
      kind: 'place',
      name: 'The Narrows',
      hint: 'The west fjord shuts down to a couple of hundred metres across with sixteen hundred either side. Get down in it.',
      note: 'The Nærøyfjord at its narrowest — 250 m of salt water and 1,600 m of rock both sides.',
      lat: 60.9149,
      lon: 6.8754,
      radius: 260,
      below: 90,
    },
    {
      // The top of the Flaamsbana, 866 m up a valley the train climbs in twenty
      // tunnels. Nothing on this map sends you there but the valley slalom.
      id: 'myrdal-station',
      kind: 'place',
      name: 'Myrdal',
      hint: 'The railway out of the fjord ends somewhere near nine hundred metres, in a place with no road to it at all.',
      note: 'Myrdal, 901 m, top of the Flåmsbana. Twenty tunnels and no road in.',
      lat: 60.735,
      lon: 7.125,
      radius: 280,
      below: 140,
    },
    {
      // Aurlandsfjellet, the plateau the tunnel goes under. The Snow Road across
      // it is shut half the year.
      id: 'snow-road',
      kind: 'place',
      name: 'The Snow Road',
      hint: 'There is a way over the top instead of under it. It is shut two-thirds of the year and it is up on the plateau at fourteen hundred metres.',
      note: 'Aurlandsfjellet at 1,400 m — the Snøvegen, open about four months a year, straight over the roof of the tunnel.',
      lat: 60.9485,
      lon: 7.3003,
      radius: 340,
      below: 220,
    },
  ],

  maui: [
    {
      // Inside Haleakala's crater: eleven kilometres across, eight hundred
      // metres deep, and full of cinder cones. The DEM has the floor at 2,210 m.
      id: 'haleakala-crater',
      kind: 'place',
      name: 'Inside the Crater',
      hint: 'The summit is a rim, not a point. There is eight hundred metres of nothing on the other side of it.',
      note: 'Down inside the Haleakalā crater at 2,210 m, cinder cones all round you and the rim eight hundred metres up.',
      lat: 20.725,
      lon: -156.21,
      radius: 420,
      below: 320,
    },
    {
      // The wettest place in Hawaii — about ten metres of rain a year — and the
      // top of the West Maui massif, permanently in cloud.
      id: 'puu-kukui',
      kind: 'place',
      name: 'The Wettest Place',
      hint: 'Something on the western massif takes ten metres of rain a year. You will not see much when you get there.',
      note: 'Puʻu Kukui, 1,764 m. About ten metres of rain a year and in cloud most days of them.',
      lat: 20.8917,
      lon: -156.5867,
      radius: 260,
      agl: [30, 220],
    },
    {
      // The lava peninsula halfway along the Hana road, built by a flow that
      // ran all the way to the sea.
      id: 'keanae-peninsula',
      kind: 'place',
      name: 'Keānae',
      hint: 'A lava flow ran off the windward slope and out into the sea, and made a flat green shelf where there should be cliff.',
      note: 'The Keānae peninsula — a lava flow that reached the water and left a shelf of taro on the windward coast.',
      lat: 20.8608,
      lon: -156.1447,
      radius: 260,
      below: 110,
    },
    {
      // Kahului, which is where the island's runway is, and the only place on
      // this map with enough flat ground to put wheels down on.
      id: 'land-at-kahului',
      kind: 'land',
      name: 'Down at Kahului',
      hint: 'The isthmus is the only flat thing on the island, and the island keeps its runway on it.',
      note: 'Wheels down on the isthmus at Kahului, with both volcanoes over the wingtips.',
      lat: 20.8894,
      lon: -156.4727,
      radius: 420,
    },
  ],

  jungfrau: [
    {
      // The Grütschalp–Mürren railway, which runs along the lip of the
      // Lauterbrunnen west wall at about 1,550 m with seven hundred metres of
      // air off the right-hand side. Mürren has no road to it: you get there by
      // cable car from the valley floor and then this train, and that is the
      // whole reason the line exists.
      //
      // These coordinates are not authored — they are the surveyed track, pulled
      // out of data/jungfrau-network.bin.gz by chaining the NARROW_GAUGE
      // fragments that share endpoints and thinning to 200 m. The first attempt
      // at this secret WAS authored, by eye, aiming at the Wengernalpbahn
      // instead, and tools/verify-secrets.mjs reported the line I had drawn
      // climbing at 123% — I had run it up the face of a cliff rather than along
      // the shelf the railway uses. The tool is the reason this is real track.
      id: 'murren-terrace',
      kind: 'trace',
      name: 'The Mürren Terrace',
      hint: 'A railway runs along the top of the west wall to a village with no road to it. There is a shelf up there wide enough to fly.',
      note: 'The Grütschalp line, along the lip of the Lauterbrunnen wall with seven hundred metres off the wingtip.',
      // Wide enough to be flyable and tight enough that drifting off the shelf
      // ends it: two hundred metres to the right the ground is 700 m down and
      // the ceiling stops counting immediately.
      width: 140,
      ceiling: 110,
      seconds: 18,
      path: [
        [46.57867, 7.8968], // 1608 m — above Mürren
        [46.58049, 7.89562], // 1592 m
        [46.5826, 7.89599], // 1574 m
        [46.58458, 7.89442], // 1562 m
        [46.58641, 7.89301], // 1549 m
        [46.58843, 7.89382], // 1535 m
        [46.59041, 7.8937], // 1531 m
        [46.59276, 7.89289], // 1503 m
        [46.59441, 7.89087], // 1507 m
        [46.59713, 7.89041], // 1501 m — Grütschalp, top of the cable car
      ],
    },
    {
      // The observatory on the rock above the Jungfraujoch, 3,571 m, and one of
      // the two hand-modelled meshes on this map. You could always fly past it.
      // Nothing ever noticed.
      id: 'sphinx-window',
      kind: 'place',
      name: 'The Sphinx',
      hint: 'There is a window at the top of Europe and nobody has ever waved at it.',
      note: 'The Sphinx observatory, 3,571 m. Somebody up there is watching the weather.',
      lat: 46.5474,
      lon: 7.9806,
      radius: 240,
      // Off the col, not off the aeroplane: the ground under you and the ground
      // under the observatory are a long way apart up there.
      agl: [60, 200],
    },
    {
      // Where the Aletsch's four feeder glaciers meet, 2,780 m, behind the
      // Jungfrau. No challenge goes within six kilometres and there is no lift
      // on the way out.
      //
      // This was "be near Konkordiaplatz" and that was wrong twice over:
      // Konkordiaplatz is already a labelled place, so its name hung on the
      // horizon and the discovery toast fired before you had done anything, and
      // "be near it" is not an act. Landing on the ice is. It also means
      // committing to a glacier basin at 2,800 m with nothing to climb out on,
      // which is the real content of going there.
      id: 'aletsch-landing',
      kind: 'land',
      name: 'Down on the Aletsch',
      hint: 'Four glaciers run into one behind the big three. There is no lift out there and the ice is flat.',
      note: 'Wheels down on the Aletsch at 2,800 m, with nine hundred metres of ice underneath you and no lift for six kilometres.',
      lat: 46.5033,
      lon: 8.05,
      radius: 520,
    },
    {
      // The saddle the map opens above, which is flat, grassy, two kilometres
      // long and has never once been landed on.
      id: 'land-at-scheidegg',
      kind: 'land',
      name: 'Down at the Scheidegg',
      hint: 'You start eight hundred metres above somewhere flat.',
      note: 'Wheels down at Kleine Scheidegg, 2,061 m, with the Eiger over your shoulder.',
      lat: 46.5853,
      lon: 7.9614,
      radius: 340,
    },
    {
      // Three hundred metres of water, most of it airborne before it lands.
      // Going under it is easy. The other condition is not.
      id: 'staubbach-inverted',
      kind: 'place',
      name: 'Under the Staubbach, Upside Down',
      hint: 'The tallest fall in the valley throws its water well clear of the rock. There is room behind it, if you are prepared to be the wrong way round.',
      note: 'Inverted under three hundred metres of falling water. Nobody asked you to do that.',
      lat: 46.5906,
      lon: 7.9058,
      radius: 170,
      // Under the ribbon, measured off the ground beneath the aeroplane rather
      // than off the cliff the fall is keyed to.
      below: 140,
      inverted: true,
    },
    {
      // The one fall that comes out of the cliff instead of over it, and it
      // comes out about ninety metres above the valley floor.
      id: 'trummelbach-mouth',
      kind: 'place',
      name: 'The Trümmelbach Mouth',
      hint: 'One of the falls runs inside the mountain and only shows for the last of it. You will have to be low.',
      note: 'The Trümmelbach, coming out of the rock rather than over it.',
      lat: 46.5758,
      lon: 7.9074,
      radius: 180,
      below: 90,
    },
    {
      // The revolving restaurant on top of the Schilthorn at 2,970 m, built for
      // the 1969 film and named after the villain's lair in it. It is one of the
      // two hand-modelled meshes on this map and nothing has ever had a reason
      // to go and look at it.
      //
      // Was Bachalpsee, which is a labelled place and therefore announced itself
      // — same fault as Konkordiaplatz. This is better anyway: the mountain is
      // labelled, the building on it is not, and the building is the point.
      id: 'piz-gloria',
      kind: 'place',
      name: 'Piz Gloria',
      hint: 'Blofeld ran his operation out of a revolving restaurant on an alp. They did not build the set — they used a real one, and it is on this map.',
      note: "Piz Gloria, 2,970 m. The revolving restaurant from On Her Majesty's Secret Service, and it is still up there serving lunch.",
      lat: 46.5556,
      lon: 7.8347,
      radius: 240,
      agl: [30, 170],
    },
  ],

  chicago: [
    {
      // The best easter egg either map can offer, and it was already sitting
      // there as flat ground with nothing on it.
      //
      // Meigs Field, single runway 36/18 on Northerly Island, the default
      // airport that a generation of people learned to fly in front of. The
      // mayor sent bulldozers to cut Xs into it in the middle of the night on
      // 31 March 2003 with aircraft still parked on the apron. The island is
      // in the terrain, it is the only clear strip on this map, and landing on
      // it should mean something.
      id: 'meigs-field',
      kind: 'land',
      name: 'Meigs Field',
      hint: 'There was a runway on the island until somebody sent bulldozers at midnight. The ground is still flat.',
      note: 'Meigs Field, CGX. Closed at 02:00 on 31 March 2003 by six bulldozers and no notice, with sixteen aeroplanes still parked on it. You just landed anyway.',
      lat: 41.8618,
      lon: -87.6086,
      radius: 420,
    },
    {
      // North Michigan Avenue between the river and the Water Tower: a straight
      // kilometre of street with three-hundred-metre buildings down both sides,
      // all of it surveyed footprints and real heights. A canyon run through
      // geometry that will absolutely kill you.
      id: 'magnificent-mile',
      kind: 'trace',
      name: 'The Magnificent Mile',
      hint: 'There is a straight street north of the river with the tallest things in the city down both sides of it.',
      note: 'North Michigan Avenue at rooftop height, river to the Water Tower.',
      width: 80,
      ceiling: 150,
      seconds: 10,
      path: [
        [41.8885, -87.6245],
        [41.892, -87.6244],
        [41.8955, -87.6243],
        [41.899, -87.6242],
      ],
    },
    {
      // 442 m to the roof and 527 to the tips of the two masts.
      id: 'willis-antennas',
      kind: 'place',
      name: 'The Willis Antennas',
      hint: 'The tallest thing on the map is not as tall as the things on top of it.',
      note: 'Level with the Willis Tower masts, 527 m, which is higher than anything else here goes.',
      lat: 41.8789,
      lon: -87.6359,
      radius: 220,
      agl: [430, 580],
    },
    {
      // Two round towers on the river with a gap between them. The footprints
      // are surveyed, so the gap is the real gap.
      id: 'marina-city-gap',
      kind: 'place',
      name: 'Between the Corncobs',
      hint: 'Two round towers stand on the river. They are not touching.',
      note: 'Through the gap at Marina City. The towers are where the survey says they are.',
      lat: 41.8881,
      lon: -87.6288,
      radius: 95,
      agl: [30, 200],
    },
    {
      // Hand-modelled, mirror-polished, and ten metres tall in a park full of
      // nothing else.
      id: 'cloud-gate-low',
      kind: 'place',
      name: 'The Bean',
      hint: 'Something in Millennium Park is polished like a mirror. You would have to be low to be in it.',
      note: 'Low over Cloud Gate. You are in it now, upside down and stretched.',
      lat: 41.8827,
      lon: -87.6233,
      radius: 140,
      below: 90,
    },
    {
      // Was Wrigley Field, which is 624 m outside the flyable box — the ballpark
      // is in the places table and on the map, and the invisible wall that
      // turns you round is inside it. verify-secrets caught that; nothing at
      // runtime would have.
      //
      // Soldier Field instead, which is hand-modelled: the 1924 colonnade with
      // the 2003 seating bowl dropped down between the columns. It cost the
      // stadium its National Historic Landmark listing the following year.
      id: 'soldier-colonnade',
      kind: 'place',
      name: 'The Colonnade',
      hint: 'They lowered a spaceship into a stadium from the twenties and kept the pillars standing round it.',
      note: "Soldier Field's 1924 colonnade. Dropping the new bowl inside it cost the stadium its National Historic Landmark status a year later.",
      lat: 41.8623,
      lon: -87.6167,
      radius: 200,
      below: 110,
    },
    {
      // Hand-modelled, out at the end of the breakwater, and nothing has ever
      // had any reason to go near it.
      id: 'harbour-light',
      kind: 'place',
      name: 'The Harbour Light',
      hint: 'Something small and white sits out where the breakwater ends. It is not a building.',
      note: 'The Chicago Harbor Lighthouse, out at the harbour mouth on its own.',
      lat: 41.8896,
      lon: -87.5906,
      radius: 190,
      below: 130,
    },
  ],
};

export const DEFAULT_REGION = 'jungfrau';

export function getRegion(id) {
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION];
}
