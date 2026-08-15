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
    tagline: 'Real terrain · 38 × 38 km of the Bernese Oberland',
    loadingTagline: 'Soaring the Bernese Alps',
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
 * Three fields make a challenge a designed thing rather than a stopwatch:
 *
 *   ship   The aeroplane it is flown in, always. One calibrated ladder per
 *          challenge instead of one per aircraft per challenge, and the task
 *          gets to be about a particular aeroplane's manners.
 *   needs  Medals — anywhere in the game, either map — before it appears. The
 *          count is global on purpose: golds over the Alps open the lakefront.
 *
 * Coordinates are checked against the baked terrain: every river gate lands on
 * water, every alpine gate in open air over the valley floor. Medal thresholds
 * are measured rather than guessed — the ship's polar, the air along the line
 * and the altitude each gate leaves you have to add up to a task that ship can
 * fly without the motor, with the motor as the margin rather than the entry fee.
 *
 * Measured by tools/calibrate-challenges.mjs, which flies every one of these in
 * the ship it names against the real physics and the real air, and prints what
 * it managed. Every number below — the medals, the clocks, and a good deal of
 * the geometry — came out of a run of it. When the flight model moves again,
 * run it again: it will say which of these have stopped being true.
 */
export const CHALLENGES = {
  jungfrau: [
    {
      id: 'lauterbrunnen-slalom',
      type: 'slalom',
      name: 'Lauterbrunnen Slalom',
      where: 'Trümmelbach to the village',
      blurb: 'Six gates north down the valley floor, wall to wall.',
      ship: 'vela',
      needs: 0,
      marker: { lat: 46.557, lon: 7.902, agl: 260, heading: 29 },
      // The trench only drops 154 m in 4.3 km, and at a constant height above it
      // the last three legs asked for 311:1, 224:1 and 2,750:1 from a ship that
      // glides 35:1 in still air and about 24:1 in this one — the run simply
      // mushed into the meadow short of the village. The gates now step DOWN
      // through the trench at about twenty-four to one: the same six places and
      // the same flying, on a line the ship can actually hold to the end of.
      limit: 215,
      medals: [160, 135, 115],
      gates: [
        { name: 'Trümmelbach', lat: 46.562, lon: 7.906, agl: 210, radius: 75 },
        { name: 'Mürren Cliff', lat: 46.568, lon: 7.9114, agl: 190, radius: 75 },
        { name: 'Wengen Wall', lat: 46.574, lon: 7.9078, agl: 175, radius: 75 },
        { name: 'Staubbach Falls', lat: 46.58, lon: 7.9138, agl: 135, radius: 75 },
        { name: 'Kirche', lat: 46.586, lon: 7.912, agl: 105, radius: 75 },
        { name: 'Lauterbrunnen', lat: 46.592, lon: 7.9102, agl: 85, radius: 75 },
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
      // The ultralight, because holding a hard deck is a question of flying
      // slowly and precisely and it does nothing else nearly as well.
      ship: 'kite',
      needs: 0,
      marker: { lat: 46.596, lon: 7.909, agl: 130, heading: 188 },
      ceiling: 70,
      hold: 26,
      limit: 65,
      medals: [56, 46, 35],
    },
    {
      id: 'eiger-traverse',
      type: 'collect',
      name: 'Eiger Traverse',
      where: 'The north face down to Kleine Scheidegg',
      blurb: 'Five markers off the wall and along the shelf. Never turn back.',
      // A one-way run with height to spend and no need to circle: the ballasted
      // ship's own description of itself.
      ship: 'draco',
      needs: 3,
      marker: { lat: 46.5861, lon: 8.011, agl: 380, heading: 270 },
      limit: 200,
      medals: [145, 120, 105],
      // The second one is 60 m lower than it was: from the first it sat at 47:1,
      // which is flatter than this ship glides in this air, so the shelf run
      // started by arriving under the marker rather than over it.
      picks: [
        { lat: 46.5861, lon: 8.0053, agl: 420 },
        { lat: 46.5804, lon: 7.9896, agl: 340 },
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
      // The trainer: weak air is its air, and a beat along a face is exactly
      // the flying it was built to make easy.
      ship: 'cadet',
      needs: 2,
      // And it is: nothing within 600 m of Wengen beats the ship's own sink, so
      // the marker stands instead on the north-west flank of the Männlichen
      // ridge, which is the windward one. It used to point at the summit — 183
      // degrees, straight up the slope — and every line flown at it hit the hill
      // inside eleven seconds. It now points along the contour, which is the
      // only direction a beat can start in, and sits lower down the face where
      // the lift is worth 3.7 m/s rather than 3.2.
      marker: { lat: 46.6251, lon: 7.9402, agl: 150, heading: 264 },
      gain: 250,
      limit: 390,
      medals: [285, 230, 190],
    },
    {
      id: 'jungfraujoch-descent',
      type: 'slalom',
      name: 'Jungfraujoch Descent',
      where: 'The Joch down to Kleine Scheidegg',
      blurb: 'Six gates and 1,300 m of glacier, flown in the jet. Nowhere to turn round.',
      // Thirteen hundred metres of height and a straight line to spend it on is
      // the one place a wing that cannot circle is the right wing.
      ship: 'javelin',
      // Last on this map, and it used to be fifth. A ladder whose headline ship
      // is a 434 km/h turbine cannot finish on the trainer doing the most
      // patient task in the game, which is what the two ceiling climbs are —
      // so the jet takes the top slot and the climb drops to the middle.
      needs: 6,
      marker: { lat: 46.545, lon: 7.988, agl: 350, heading: 326 },
      limit: 102,
      medals: [75, 63, 54],
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
    {
      // The old race mode, re-cut as a descent from the Joch: as a loop it
      // demanded four thousand metres of climbing, most of it above a 2,950 m
      // cloudbase, and no ship in the hangar can be relied on to find that.
      id: 'jungfrau-circuit',
      type: 'slalom',
      name: 'Jungfrau Circuit',
      where: 'The Joch, the Eiger, the whole valley',
      blurb: 'Thirty-three kilometres and 2,300 m of height, in the ship that runs.',
      ship: 'draco',
      needs: 5,
      // South-west of the Joch on the course axis, out over the Jungfraufirn
      // with enough height to reach the first gate on the glide.
      marker: { lat: 46.5375, lon: 7.9743, agl: 495, heading: 24 },
      limit: 1300,
      medals: [960, 810, 700],
      // Re-cut again, and this time against the terrain rather than against a
      // map. In the authored order nine of the eleven legs ran into a mountain:
      // Wengen to Grindelwald crossed a 2,192 m ridge from 1,539 m, and
      // Grindelwald to Staubbach a 2,402 m one from 1,397 — a course that could
      // only be flown by climbing two thousand metres through rock the straight
      // line went through. Not one line of thirty-six finished it.
      //
      // The order now runs down the map rather than around it: the Joch, the
      // Eiger's north face, the pass at Eigergletscher, round the head of the
      // Lauterbrunnen valley, across the Männlichen ridge and out over the
      // village. Every gate is high enough that the straight line to the next
      // one clears the ground between by 130 m WITH the ship's glide taken off
      // it, which is what nine of the old eleven legs did not do.
      //
      // Grindelwald is the gate that had to go. It is the only place on the
      // list in the other valley and the lowest of them, and any order that
      // visits it has to climb back over a 2,200 m divide afterwards: the
      // cheapest version of that put the Grindelwald hoop 2,255 m above its own
      // basin and still left twelve kilometres of level flight in the middle of
      // a glide task. Ten gates that can be flown beat eleven that cannot.
      gates: [
        { name: 'Jungfraujoch', lat: 46.5474, lon: 7.9806, agl: 450, radius: 130 },
        { name: 'Eiger North Face', lat: 46.5861, lon: 8.0053, agl: 1180, radius: 130 },
        { name: 'Eigergletscher', lat: 46.5747, lon: 7.9739, agl: 1045, radius: 130 },
        { name: 'Lauterbrunnen Wall', lat: 46.5453, lon: 7.9236, agl: 780, radius: 130 },
        { name: 'Sefinental', lat: 46.5411, lon: 7.8681, agl: 1330, radius: 130 },
        { name: 'Mürren Terrace', lat: 46.5586, lon: 7.8925, agl: 1075, radius: 130 },
        { name: 'Männlichen Ridge', lat: 46.6142, lon: 7.9394, agl: 175, radius: 115 },
        { name: 'Wengen', lat: 46.6053, lon: 7.9219, agl: 850, radius: 110 },
        { name: 'Staubbach Falls', lat: 46.5906, lon: 7.9058, agl: 950, radius: 110 },
        { name: 'Lauterbrunnen Valley', lat: 46.6019, lon: 7.9088, agl: 855, radius: 110 },
      ],
    },
    {
      // The old height hunt, asked as a question with an answer. Interlaken is
      // the bottom of the map, so every metre of this comes off one shallow
      // face with nothing above it and the lake behind.
      id: 'interlaken-ceiling',
      type: 'climb',
      name: 'Oberland Ceiling',
      where: 'Off the deck at Interlaken',
      blurb: 'Four hundred metres off the lowest ground on the map, in the thinnest band.',
      ship: 'cadet',
      needs: 4,
      // On the windward slope above the Thunersee rather than over the town:
      // sampled, the town's air runs at -0.3 m/s and the nearest thing that
      // beats the trainer's sink is two and a half kilometres away, which is a
      // marker standing in dead air and a task nobody can finish.
      //
      // This face is the honest one, and it is a slope rather than a column on
      // purpose: a thermal is a property of the hour, and the one over the
      // Lütschine is worth 2.7 m/s on an afternoon and nothing at all on a
      // morning. The slope is worth 3.4 m/s at the marker — not the 4.7 this
      // once claimed, and not the same at every hour either: it surveys 1.9 at
      // midday, which is why the sun is fixed at afternoon and the ladder below
      // is calibrated against that one sky. It also pinches out with height,
      // which is what makes the last hundred metres of this the hard part.
      marker: { lat: 46.6702, lon: 7.8421, agl: 150, heading: 316 },
      // Less than the lakefront asks for, because the band is shallower: above
      // about 550 m over the slope the lift has decayed to the trainer's own
      // sink and the climb simply stops, whatever the clock says.
      gain: 400,
      limit: 670,
      medals: [500, 400, 330],
    },
  ],

  chicago: [
    {
      id: 'river-run',
      type: 'slalom',
      name: 'Chicago River Run',
      where: 'The mouth to Wolf Point',
      blurb: 'Five gates up the main stem, and finish in the turn at Wolf Point.',
      // Not the jet, which is what this used to be. Nothing about the Javelin
      // fits an eighty-metre canyon: it enters at 120 m/s because the entry
      // speed is a multiple of trim, it cannot fly below about 45, and even
      // there its turn is 175 m wide — half as wide again as the river. Two
      // hundred lines were flown at it and every one of them ended in a
      // building. The Vela turns inside sixty metres at cruise, which is what
      // the bend at Wolf Point actually asks for.
      ship: 'vela',
      needs: 3,
      // On the river axis at the mouth, and clear of the line the free flight
      // start already runs down, so arriving from the lake is a choice.
      marker: { lat: 41.8889, lon: -87.614, agl: 250, heading: 268 },
      limit: 93,
      medals: [69, 58, 50],
      // Two things were wrong with this course and both were measured rather
      // than argued about.
      //
      // The gates sat almost flat — two legs asked for 37:1 and 68:1 from a
      // ship that glides 35:1 at its very best and nothing like that at racing
      // speed — so the run mushed into the water below Wells Street. They now
      // step down at about twenty-four to one, which is the Vela's glide in the
      // low thirties, the speed the bends are flyable at.
      //
      // And it used to carry on down the South Branch. Measured at the authored
      // heights, that stretch leaves twenty metres between the towers and the
      // water: less than half the radius of the hoop hanging in it, on a map
      // where the hoops are the promise that a line exists. Clearing it would
      // mean flying the branch at 280 m, which is not a canyon run at all — so
      // the course ends in the turn instead, where the junction is 200 m wide.
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
      id: 'loop-rooftops',
      type: 'collect',
      name: 'Loop Rooftops',
      where: 'Willis Tower to Streeterville',
      blurb: 'Five markers over the big roofs. You arrive above all of them once.',
      // One arrival, five roofs, no second chance to climb: a ship that runs
      // and does not float is the whole brief.
      ship: 'draco',
      needs: 2,
      // Above the lot of them, which is what the task says on the tin: the
      // Willis marker ends up at 733 m once challenges.js has lifted it clear
      // of the mast, and arriving underneath it meant opening the run with a
      // climb the ballasted ship has no way to make.
      marker: { lat: 41.883, lon: -87.643, agl: 640, heading: 100 },
      limit: 210,
      medals: [155, 130, 110],
      // High to low, in the order they are actually flown: Willis, out to
      // Trump, then the Michigan Avenue pair, then down to the river. It used
      // to run Willis, Aon, St Regis, Trump, which asks for 78 m of climb in
      // the middle of the Loop with nothing under the wing to provide it.
      //
      // Heights are the surveyed roofs plus fifty metres of air, so that a
      // pickup taken a wingspan low is a miss rather than a wreck. Willis is
      // the reason for the margin: challenges.js will not leave a pickup inside
      // a roof, and it lifted the old 470 m one to 25 m above the aerials —
      // exactly where a ship reaching for it hits the aerials.
      picks: [
        { lat: 41.8789, lon: -87.6359, agl: 590 },
        { lat: 41.8892, lon: -87.6266, agl: 482 },
        { lat: 41.8869, lon: -87.6199, agl: 423 },
        { lat: 41.8858, lon: -87.6215, agl: 400 },
        { lat: 41.8885, lon: -87.6345, agl: 300 },
      ],
    },
    {
      id: 'lakefront-skim',
      type: 'lowpass',
      name: 'Lakefront Skim',
      where: 'Grant Park to the museums',
      blurb: 'Thirty seconds under 50 m. The shore band will hold you up.',
      ship: 'kite',
      needs: 0,
      marker: { lat: 41.881, lon: -87.618, agl: 130, heading: 190 },
      ceiling: 50,
      hold: 30,
      limit: 75,
      medals: [40, 32, 23],
    },
    {
      id: 'heat-island',
      type: 'climb',
      name: 'Heat Island',
      where: 'North Michigan Avenue',
      blurb: 'No hills. Find the roof that is cooking and take 250 m off it.',
      ship: 'cadet',
      needs: 4,
      // air.seedThermals is deterministic, so the good column is at a fixed
      // address and the marker can be authored onto it. Over the West Loop,
      // where this used to stand, the ship sits in the sink collar of a
      // thermal it cannot reach and the task simply cannot be completed.
      marker: { lat: 41.9018, lon: -87.6265, agl: 230, heading: 190 },
      gain: 250,
      limit: 142,
      medals: [105, 85, 69],
    },
    {
      id: 'museum-campus',
      type: 'collect',
      name: 'Museum Campus',
      where: 'Field Museum to Soldier Field',
      blurb: 'Five markers low between the museums. Tight and quick.',
      ship: 'vela',
      needs: 0,
      marker: { lat: 41.871, lon: -87.62, agl: 180, heading: 170 },
      limit: 142,
      medals: [105, 89, 76],
      picks: [
        { lat: 41.8663, lon: -87.6169, agl: 90 },
        { lat: 41.8676, lon: -87.614, agl: 80 },
        { lat: 41.8663, lon: -87.6072, agl: 70 },
        { lat: 41.8639, lon: -87.6078, agl: 60 },
        { lat: 41.8623, lon: -87.6167, agl: 95 },
      ],
    },
    {
      // The old race mode, all eleven gates kept, re-cut the same way as the
      // alpine one: it starts over the Willis mast and never has to climb back
      // to it. The whole downtown is flat, so the height it opens with is the
      // height it has, and eleven kilometres of gates is 480 m of it — which is
      // why the gates step down from the tower instead of sitting on the water.
      // Authored flat and low, four of the legs went through buildings and the
      // rest asked for a glide no ship in the hangar has.
      id: 'loop-circuit',
      type: 'slalom',
      name: 'The Loop Circuit',
      where: 'The tower, the river, the museums',
      blurb: 'Over the Willis mast, down the river, out to the pier, back through the museums.',
      ship: 'vela',
      needs: 5,
      // A kilometre east over the park, above everything the city has, on the
      // axis of the run that opens the course.
      marker: { lat: 41.8789, lon: -87.625, agl: 640, heading: 270 },
      limit: 670,
      medals: [500, 420, 360],
      gates: [
        { name: 'Willis Tower', lat: 41.8789, lon: -87.6359, agl: 560, radius: 110 },
        { name: 'Union Station', lat: 41.8789, lon: -87.6398, agl: 545, radius: 85 },
        { name: 'Wolf Point', lat: 41.8887, lon: -87.6386, agl: 495, radius: 90 },
        { name: 'Michigan Avenue Bridge', lat: 41.8887, lon: -87.6247, agl: 443, radius: 80 },
        { name: 'Navy Pier', lat: 41.8917, lon: -87.6086, agl: 380, radius: 90 },
        { name: 'Lake Point Tower', lat: 41.8938, lon: -87.6127, agl: 361, radius: 85 },
        { name: 'Millennium Park', lat: 41.8826, lon: -87.6226, agl: 293, radius: 95 },
        { name: 'Buckingham Fountain', lat: 41.8758, lon: -87.6189, agl: 256, radius: 90 },
        { name: 'Adler Planetarium', lat: 41.8663, lon: -87.6072, agl: 205, radius: 95 },
        { name: 'Soldier Field', lat: 41.8623, lon: -87.6167, agl: 175, radius: 100 },
        { name: 'South Branch', lat: 41.867, lon: -87.63, agl: 165, radius: 90 },
      ],
    },
    {
      // The old height hunt. Starting in the lake-breeze band is deliberate,
      // and the band is thinner than it sounds: it is worth 1.5 m/s at the
      // deck against the trainer's 0.8 of sink, and it tapers to nothing by
      // 900 m, so it is good for the first three hundred metres and no more.
      // Everything above that has to come off a thermal over the city.
      id: 'lakefront-ceiling',
      type: 'climb',
      name: 'Lakefront Ceiling',
      where: 'Grant Park, in the breeze front',
      blurb: 'Six hundred metres over the flattest city there is. The shore only gets you so far.',
      ship: 'cadet',
      needs: 6,
      // Three hundred metres west of where it stood, which is the difference
      // between being in the convergence and being just inland of it: the old
      // spot sampled 0.85 m/s at the deck, which is under the ship's own sink,
      // and a marker you cannot climb out of is not a climb.
      marker: { lat: 41.8806, lon: -87.6216, agl: 150, heading: 350 },
      gain: 600,
      limit: 445,
      medals: [330, 265, 215],
    },
  ],
};

export const DEFAULT_REGION = 'jungfrau';

export function getRegion(id) {
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION];
}
