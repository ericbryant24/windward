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
      medals: [4, 6, 8],
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

export const DEFAULT_REGION = 'jungfrau';

export function getRegion(id) {
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION];
}
