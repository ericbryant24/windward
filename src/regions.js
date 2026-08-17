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
  maui: [],
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
      medals: [110, 155, 190],
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
  ],

  chicago: [
    {
      id: 'river-run',
      type: 'slalom',
      name: 'Chicago River Run',
      where: 'The mouth to Wolf Point',
      blurb: 'Five gates up the main stem, and finish in the turn at Wolf Point.',
      needs: 0,
      // On the river axis at the mouth, and clear of the line the free flight
      // start already runs down, so arriving from the lake is a choice.
      marker: { lat: 41.8889, lon: -87.614, agl: 250, heading: 268 },
      limit: 70,
      medals: [52, 44, 38],
      gates: [
        { name: 'Columbus Drive', lat: 41.8887, lon: -87.6212, agl: 215, radius: 60 },
        { name: 'Michigan Avenue', lat: 41.8889, lon: -87.6238, agl: 205, radius: 60 },
        { name: 'State Street', lat: 41.88776, lon: -87.62742, agl: 195, radius: 55 },
        { name: 'Wells Street', lat: 41.88751, lon: -87.63346, agl: 175, radius: 60 },
        // A sixty-degree turn that no glider takes at cruise. Placed in the
        // widest water of the junction, 200 m wide against the 80 m branch
        // below it, so the arc has somewhere to go.
        { name: 'Wolf Point', lat: 41.88656, lon: -87.6379, agl: 155, radius: 70 },
      ],
    },
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
      medals: [125, 175, 215],
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
      id: 'river-level',
      type: 'deck',
      name: 'River Level',
      where: 'The South Branch out to the lake',
      blurb: 'Sixty seconds under forty metres, between the towers. Wolf Point is a right-angle at river level.',
      needs: 1,
      marker: { lat: 41.8706, lon: -87.635, agl: 55, heading: 346 },
      window: 60,
      deck: {
        ceiling: 40,
        width: 110,
        path: [
          [41.8706, -87.635],
          [41.8742, -87.6362],
          [41.8778, -87.6378],
          [41.8812, -87.6382],
          [41.8845, -87.6386],
          [41.887, -87.638],
          [41.8875, -87.635],
          [41.8875, -87.63],
          [41.888, -87.627],
          [41.8888, -87.624],
          [41.8885, -87.619],
          [41.889, -87.6155],
          [41.8876, -87.6122],
        ],
      },
      // Measured at 43.3 s of the 60, and the winning line uses no boards at
      // all — the opposite of Under the Falls. Sixty seconds down here is an
      // energy problem: the air gives nothing back, the ship arrives with all
      // it is ever going to have, and every joule spent on drag is a second
      // short at the far end.
      medals: [20, 30, 40],
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
      needs: 2,
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
