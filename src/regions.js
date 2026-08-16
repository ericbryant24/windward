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
      // The trench only drops 154 m in 4.3 km, so at a constant height above it
      // the last three legs asked for a glide no ship has and the run mushed
      // into the meadow short of the village. The gates step DOWN through the
      // trench instead, at about twenty to one: the same six places and the
      // same flying, on a line the ship can hold to the end of. Twenty rather
      // than the twenty-four they were cut at for the Vela, and with thirty
      // metres more air under each one — the ballasted ship arrives faster and
      // sinks harder, and half the measured lines were landing short.
      limit: 190,
      medals: [140, 120, 100],
      gates: [
        { name: 'Trümmelbach', lat: 46.562, lon: 7.906, agl: 237, radius: 80 },
        { name: 'Mürren Cliff', lat: 46.568, lon: 7.9114, agl: 220, radius: 80 },
        { name: 'Wengen Wall', lat: 46.574, lon: 7.9078, agl: 220, radius: 80 },
        { name: 'Staubbach Falls', lat: 46.58, lon: 7.9138, agl: 172, radius: 80 },
        { name: 'Kirche', lat: 46.586, lon: 7.912, agl: 136, radius: 80 },
        { name: 'Lauterbrunnen', lat: 46.592, lon: 7.9102, agl: 107, radius: 80 },
      ],
    },
    {
      // This ran the other way — north from the village, back up the trench —
      // and that is the one direction a heavy ship cannot hold a deck in. The
      // Lauterbrunnen floor climbs 150 m in the four kilometres south, so a
      // fixed height above it is a shallow climb, and a glider entering at
      // 58 m/s has nothing to climb with: two of thirty measured lines finished
      // and the rest mushed into the meadow. Turned round, the floor falls away
      // under you, which is the only thing a glider does for free — and the
      // trench is the one corridor on the map straight enough to fly this in.
      // The ceiling went 70 → 110 m with it: four hundred metres of wall either
      // side is the drama, and forty is not a margin at this speed.
      id: 'valley-floor',
      type: 'lowpass',
      name: 'Valley Floor',
      where: 'The trench, Trümmelbach to the village',
      blurb: 'Hold it under 110 m down the trench, four hundred metres of wall either side.',
      ship: 'kite',
      needs: 4,
      marker: { lat: 46.5645, lon: 7.907, agl: 210, heading: 14 },
      ceiling: 110,
      hold: 20,
      limit: 60,
      medals: [88, 71, 53],
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
      needs: 2,
      marker: { lat: 46.5861, lon: 8.011, agl: 420, heading: 270 },
      limit: 179,
      medals: [132, 111, 96],
      // Every one of these is about 300 m higher than it was. The first marker
      // used to hang 29 m clear of the north face on the line in from the hoop,
      // which is not a margin — it is why sixty-four of seventy-two measured
      // lines ended on the wall. They now step down off the face at fourteen to
      // one with a hundred metres of air under the line the whole way.
      picks: [
        { lat: 46.5861, lon: 8.0053, agl: 699 },
        { lat: 46.5804, lon: 7.9896, agl: 611 },
        { lat: 46.5747, lon: 7.9739, agl: 562 },
        { lat: 46.58, lon: 7.966, agl: 666 },
        { lat: 46.5853, lon: 7.9614, agl: 699 },
      ],
    },
    {
      id: 'wengen-boomer',
      type: 'climb',
      name: 'Wetterhorn Boomer',
      where: 'The wall above Grindelwald',
      blurb: 'Three hundred and fifty metres off the face. Nothing else on this side of the map.',
      ship: 'cadet',
      needs: 5,
      // This stood on the Männlichen flank above Wengen for as long as the game
      // issued a trainer to fly it in. Surveyed for the ballasted ship the face
      // is worth 1.6 m/s against 0.95 of circling sink, which is a 200 m climb
      // that takes five minutes and reads as a punishment — and every second
      // line flown at it went into the hill. The Wetterhorn wall on the far side
      // of the Grindelwald basin surveys at 4.2, it is the strongest air on the
      // eastern half of the map, and nothing else on the ladder goes there.
      marker: { lat: 46.6, lon: 8.0294, agl: 280, heading: 232 },
      gain: 350,
      limit: 230,
      medals: [170, 140, 110],
    },
    {
      id: 'jungfraujoch-descent',
      type: 'slalom',
      name: 'Jungfraujoch Descent',
      where: 'The Joch down to Kleine Scheidegg',
      blurb: 'Six gates and 1,300 m of glacier, straight down. Nowhere to turn round.',
      // Thirteen hundred metres of height and a straight line to spend it on.
      ship: 'javelin',
      // Open from the first flight, and it used to be the last thing on the
      // map. Every one of thirty-six measured lines finishes it, it is a
      // minute and a half long, and it is the best-looking piece of flying in
      // the game — which is a hook rather than a reward for grinding out six
      // medals somewhere else first.
      needs: 0,
      marker: { lat: 46.545, lon: 7.988, agl: 350, heading: 326 },
      limit: 172,
      medals: [127, 107, 92],
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
      blurb: 'Thirty-three kilometres and 2,300 m of height. The whole map in one glide.',
      ship: 'draco',
      needs: 9,
      // South-west of the Joch on the course axis, out over the Jungfraufirn
      // with enough height to reach the first gate on the glide.
      marker: { lat: 46.5375, lon: 7.9743, agl: 495, heading: 24 },
      limit: 1280,
      medals: [950, 800, 680],
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
      blurb: 'Four hundred and fifty metres off the lowest ground on the map, in the thinnest band.',
      ship: 'cadet',
      needs: 7,
      // On the windward slope above the Thunersee rather than over the town:
      // sampled, the town's air runs at -0.3 m/s and the nearest thing that
      // beats the trainer's sink is two and a half kilometres away, which is a
      // marker standing in dead air and a task nobody can finish.
      //
      // This face is the honest one, and it is a slope rather than a column on
      // purpose: a thermal is a property of the hour, and the one over the
      // Lütschine is worth 2.7 m/s on an afternoon and nothing at all on a
      // morning. The slope is worth 3.1 m/s at the marker — not the 4.7 this
      // once claimed, and not the same at every hour either: it surveys 1.9 at
      // midday, which is why the sun is fixed at afternoon and the ladder below
      // is calibrated against that one sky. It also pinches out with height,
      // which is what makes the last hundred metres of this the hard part.
      //
      // The hoop stands 480 m over the slope rather than the 150 it did for the
      // trainer. That is not for the lift — it is weaker up there — but for the
      // turn: a ballasted ship working a face needs a circle a hundred and
      // thirty metres across, and at 150 m over a 30-degree slope most of that
      // circle is inside the hill.
      marker: { lat: 46.6679, lon: 7.8438, agl: 480, heading: 316 },
      gain: 450,
      limit: 435,
      medals: [320, 260, 210],
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
      // fits an eighty-metre canyon: it entered at 120 m/s, could not fly below
      // about 45, and even there its turn was 175 m wide — half as wide again
      // as the river. Two hundred lines were flown at it and every one ended in
      // a building. The ballasted ship turns inside eighty at cruise and
      // thirty-three of thirty-six measured lines get round Wolf Point, which
      // is why this is the first thing the map hands you.
      ship: 'vela',
      needs: 0,
      // On the river axis at the mouth, and clear of the line the free flight
      // start already runs down, so arriving from the lake is a choice.
      marker: { lat: 41.8889, lon: -87.614, agl: 250, heading: 268 },
      limit: 71,
      medals: [53, 44, 38],
      // Two things were wrong with this course and both were measured rather
      // than argued about.
      //
      // The gates sat almost flat — two legs asked for 37:1 and 68:1 from a
      // ship that glides 36:1 at its very best and nothing like that at racing
      // speed — so the run mushed into the water below Wells Street. They now
      // step down at about twenty-four to one, which is a glide the ship holds
      // at the speed the bends are flyable at.
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
      where: 'Willis Tower back to the river',
      blurb: 'Five markers over the big roofs. You arrive above all of them once.',
      // One arrival, five roofs, no second chance to climb: a ship that runs
      // and does not float is the whole brief.
      ship: 'draco',
      needs: 3,
      // South-west of the tower and above the lot of them, which is what the
      // task says on the tin: arriving underneath the Willis marker meant
      // opening the run with a climb the ballasted ship has no way to make.
      marker: { lat: 41.876, lon: -87.646, agl: 700, heading: 40 },
      limit: 205,
      medals: [150, 125, 110],
      // High to low, in the order they are actually flown: Willis, out to
      // Trump, back along Michigan Avenue, then down over Marina City to the
      // Mart. It used to run Willis, Aon, St Regis, Trump, which asks for 78 m
      // of climb in the middle of the Loop with nothing under the wing to
      // provide it — and it used to put the last two pickups 180 m apart, which
      // is three seconds at this ship's cruise and rather less than the room it
      // needs to turn.
      //
      // Heights step down at eighteen to one with at least ninety metres over
      // everything the leg passes, checked against the collider rather than
      // against the roof heights: the tallest thing within a couple of hundred
      // metres of a line is not what the line has to clear, but the thing
      // directly under it is.
      picks: [
        { lat: 41.8789, lon: -87.6359, agl: 647 },
        { lat: 41.8892, lon: -87.6266, agl: 574 },
        { lat: 41.8869, lon: -87.6199, agl: 541 },
        { lat: 41.8881, lon: -87.6288, agl: 500 },
        { lat: 41.8885, lon: -87.6354, agl: 467 },
      ],
    },
    {
      id: 'lakefront-skim',
      type: 'lowpass',
      name: 'Lakefront Skim',
      where: 'Grant Park to the museums',
      blurb: 'Twenty-two seconds under 110 m, down the shore. The breeze front will hold you up.',
      ship: 'kite',
      needs: 4,
      // Fifty metres for twenty-two seconds was a powered ultralight's task and
      // not one line in thirty finished it in the ballasted ship — the deck is
      // a question of how much room there is under you when something goes
      // wrong, and at 58 m/s fifty metres is none.
      marker: { lat: 41.881, lon: -87.618, agl: 130, heading: 190 },
      ceiling: 110,
      hold: 22,
      limit: 65,
      medals: [88, 65, 42],
    },
    {
      id: 'heat-island',
      type: 'climb',
      name: 'Heat Island',
      where: 'The hot roofs north of the river',
      blurb: 'No hills. Find the roof that is cooking and take 300 m off it.',
      ship: 'cadet',
      needs: 6,
      // air.seedThermals is deterministic, so the good column is at a fixed
      // address and the marker can be authored onto it. Over the West Loop,
      // where this used to stand, the ship sits in the sink collar of a
      // thermal it cannot reach and the task simply cannot be completed. It
      // now stands on the core itself, surveyed at 5.8 m/s, and high enough
      // that a circle of the ballasted ship's radius has nothing in it.
      marker: { lat: 41.9123, lon: -87.6265, agl: 430, heading: 190 },
      gain: 300,
      limit: 152,
      medals: [112, 91, 74],
    },
    {
      id: 'museum-campus',
      type: 'collect',
      name: 'Museum Campus',
      where: 'Grant Park round the museum campus',
      blurb: 'Five markers round the campus. One arrival, and the ground is flat.',
      ship: 'vela',
      needs: 1,
      // A lap of the campus rather than a knot inside it. The Field Museum,
      // the Shedd and the Adler sit inside eight hundred metres of each other,
      // which is a course with two legs shorter than this ship's turning
      // circle: one measured line in seventy-two finished, and the rest spent
      // the clock going round again for a pickup they had just missed. Spread
      // over Grant Park and Northerly Island, every leg is over five hundred
      // metres and eleven lines in seventy-two get round.
      //
      // The other half of it is height. The lakefront is flat, so nothing on
      // the ground gives any back — the marker is the entire budget, and 180 m
      // of it left nothing for a mistake.
      marker: { lat: 41.885, lon: -87.618, agl: 380, heading: 172 },
      limit: 177,
      medals: [131, 111, 95],
      picks: [
        { lat: 41.8758, lon: -87.6189, agl: 334 },
        { lat: 41.8663, lon: -87.6169, agl: 269 },
        { lat: 41.8663, lon: -87.6072, agl: 229 },
        { lat: 41.86, lon: -87.6088, agl: 199 },
        { lat: 41.8623, lon: -87.6167, agl: 172 },
      ],
    },
    {
      // The old race mode, re-cut the same way as the alpine one: it starts
      // over the Willis mast and never has to climb back to it. The whole
      // downtown is flat, so the height it opens with is the height it has.
      //
      // The gate that had to go is South Branch. It sat last, south-west of
      // Soldier Field, and getting to it meant a leg back north through the
      // Loop from the lowest point on the course: measured, it asked for 116:1
      // from a ship that glides 36:1 at its very best. Shedd Aquarium takes its
      // place, on the lakefront run south, and the course now falls all the way
      // from the tower to Soldier Field with no leg that climbs.
      //
      // It opens at 1,130 m over Grant Park, which is most of the way to
      // cloudbase and deliberate: ten kilometres of gates at a glide this ship
      // can hold flat out is seven hundred metres of height, and a hoop you
      // have to climb to is the right way to gate the longest thing on the map.
      id: 'loop-circuit',
      type: 'slalom',
      name: 'The Loop Circuit',
      where: 'The tower, the river, the museums',
      blurb: 'Over the Willis mast, down the river, out to the pier, back through the museums.',
      ship: 'vela',
      needs: 10,
      // A kilometre east over the park, above everything the city has, on the
      // axis of the run that opens the course.
      marker: { lat: 41.8789, lon: -87.625, agl: 1130, heading: 270 },
      limit: 860,
      medals: [630, 530, 460],
      gates: [
        { name: 'Willis Tower', lat: 41.8789, lon: -87.6359, agl: 1068, radius: 115 },
        { name: 'Union Station', lat: 41.8789, lon: -87.6398, agl: 1046, radius: 95 },
        { name: 'Wolf Point', lat: 41.8887, lon: -87.6386, agl: 970, radius: 95 },
        { name: 'Michigan Avenue Bridge', lat: 41.8887, lon: -87.6247, agl: 893, radius: 90 },
        { name: 'Navy Pier', lat: 41.8917, lon: -87.6086, agl: 789, radius: 95 },
        { name: 'Lake Point Tower', lat: 41.8938, lon: -87.6127, agl: 765, radius: 90 },
        { name: 'Millennium Park', lat: 41.8826, lon: -87.6226, agl: 654, radius: 100 },
        { name: 'Buckingham Fountain', lat: 41.8758, lon: -87.6189, agl: 600, radius: 95 },
        { name: 'Shedd Aquarium', lat: 41.8672, lon: -87.614, agl: 512, radius: 95 },
        { name: 'Adler Planetarium', lat: 41.8663, lon: -87.6072, agl: 474, radius: 100 },
        { name: 'Soldier Field', lat: 41.8623, lon: -87.6167, agl: 412, radius: 105 },
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
      blurb: 'Two hundred and fifty metres over the flattest city there is, off one column and nothing else.',
      ship: 'cadet',
      needs: 8,
      // On the south end of the park rather than the middle, which is the
      // difference between being in the convergence and being just inland of
      // it: the old spot sampled 0.39 m/s at the deck, well under the ship's
      // own sink, and a marker you cannot climb out of is not a climb.
      //
      // Six hundred metres was the ask, and the band cannot supply it: the
      // convergence tapers to nothing by 900 m and the marker sits inside it,
      // so the last stretch was flown in dead air and took longer than the
      // whole climb below it. Three fifty tops out just under the ceiling.
      marker: { lat: 41.8713, lon: -87.6185, agl: 330, heading: 350 },
      gain: 250,
      limit: 565,
      medals: [415, 335, 275],
    },
  ],
};

export const DEFAULT_REGION = 'jungfrau';

export function getRegion(id) {
  return REGIONS[id] ?? REGIONS[DEFAULT_REGION];
}
