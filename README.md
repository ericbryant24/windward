# Windward

A browser flight game set over the real Jungfrau region of the Bernese Alps.
You fly a sailplane, and the only fuel you have is altitude.

Portrait phone is the primary target — one thumb on the stick, one button for
the airbrakes — but it plays fine in landscape and on a desktop keyboard.

Play it at **https://ericbryant24.github.io/windward/** — the branch deploys
itself to GitHub Pages on every push.

To run it locally:

```
python3 -m http.server 8080      # or any static file server
open http://localhost:8080
```

There is no build step. The whole thing is ES modules, a vendored copy of
three.js, and one 2.6 MB terrain file. `node tools/build-standalone.mjs` folds
all of that into a single 4 MB HTML file if you need one that fetches nothing.

## The places

Two levels of one game, picked from the level select or with `?map=`. Switching
reloads — four megabytes of terrain really do have to be swapped — but nothing
you have earned belongs to a map: one medal tally, one aeroplane, one list of
things left to do, and the level select shows both of them whichever one is in
memory.

**Jungfrau** — 38 × 38 km centred on 46.60 N, 7.93 E, resampled to a 25 m grid
from public SRTM-derived elevation tiles. Everything is where it should be: the
Eiger's north face above Grindelwald, the Lauterbrunnen valley with its
400-metre walls, Jungfraujoch on the saddle, Thunersee and Brienzersee either
side of Interlaken. Summit heights land within a few tens of metres of the
surveyed figures — the residual is the 25 m grid rounding off the summits, not
an error in placement.

**Chicago** — 14 × 14 km centred on 41.888 N, 87.635 W at a 9 m grid, reaching
from Bronzeville to Wrigley Field and four kilometres out into the lake. The
terrain is almost beside the point here; the map is its 145,386 buildings. Half
of them carry a surveyed height, and the towers are built from their
`building:part` records, so Willis Tower has its real setbacks at 355 m under a
442 m roof, with its antennas carrying on to 527 m, rather than being a single
slab. The lakefront and the river come from surveyed outlines rather than
contours, because Chicago is flat enough that elevation tells you nothing about
where the water is. The L runs on its viaduct, because OSM records which
sections are elevated.

Everything geographic lives in `tools/regions.mjs` (baking) and
`src/regions.js` (runtime). Adding a third map means adding an entry to each
and running the bakers.

## Flying

Altitude is currency, and it is the only one — there is no thrust in the game
at all. Straight and level costs you about 1.3 m/s, so the whole of it is
finding the places where the air is going up faster than you are going down:

- **Thermals** form over sun-facing slopes and are marked by cumulus at
  cloudbase. Circle inside one and you climb. Where they form depends on which
  slopes the sun is on, which is why the sun does not move: the medal ladder is
  calibrated against one sky, and an hour that halves the lift would quietly be
  a difficulty setting. They are standing columns tied to the ground that makes
  them, and they hold their own air — the free stream blowing through one would
  carry a circling glider out of it inside a single turn, which for a long time
  it silently did.
- **Ridge lift** runs up any face the wind is hitting. Fly along a windward
  ridge, low, and you can stay up indefinitely without circling.
- **Sink** is everywhere else, and there is a ring of it around every thermal.

The variometer — the bar on the right, and the beeping — is the instrument that
matters. Faster, higher beeps mean better lift. Next to the speed, the glide
ratio the ship is actually achieving against the book figure underneath it:
36:1 on the card and 19:1 through the sink you are in is the difference
between reaching the next ridge and not.

### Controls

| | Touch | Keyboard |
|---|---|---|
| Bank | Drag anywhere on the left half | ← → or A D |
| Pitch | Same stick, up/down | ↑ ↓ or W S |
| Airbrakes | BRAKE button | B, Shift or Space |
| Camera | Double-tap the right half | C |
| Pause | ❚❚ | Esc or P |

The stick moves **surfaces**: sideways is aileron and commands a roll rate,
fore and aft is elevator and commands a pitch rate. There is no bank limit, so
a pinned stick keeps rolling. What keeps the ship the right way up when you let
go is modelled dihedral and static longitudinal stability, not an autopilot. Tilt
steering is available in the menu if you prefer it.

### Flying, and challenges

There are no game modes and no scoreboard. There is one button on the menu; it
puts you in the air over whichever level the list is pointing at, with no clock
and nothing to accumulate but the map itself — nineteen landmarks to find, and
whatever you can reach before you run out of height.

Everything else is a **challenge** — twelve of them, six per level, standing out
in the world as hoops with a light column under them. Fly through one and it
starts; or press it on the level select and you are taken to it. Four kinds, and
nothing runs longer than ninety seconds:

| | |
|---|---|
| slalom | gates threaded through the terrain, against the clock |
| height | sixty seconds — how much of it can you turn into altitude? |
| distance | ninety seconds — how far from the hoop can you be at the end? |
| deck | sixty seconds, a corridor and a ceiling — how much of the window can you hold down on the deck? |

A slalom is seconds and lower wins. The other three are quantities and more is
better, and all three are fixed windows: the clock closing IS the score, so they
cannot be failed by running out of time and only hitting something ends a run
early. That is the point of the ninety second cap — a challenge you can lose in
a minute and a half is one you press Retry on.

Two rules make a challenge a designed thing rather than a stopwatch:

- **Every attempt starts identically.** Same place, same heading, same speed,
  whether you crossed the hoop or pressed the row on the level select — so a
  time flown off the menu and a time flown off the map are the same time. The
  entry speed is a third over trim for everything except a height run, which
  arms at trim: a task scored on metres gained must not be winnable by cashing
  in the speed it was handed.
- **They unlock on medals earned anywhere.** Two are open on a fresh save; the
  rest raise their markers as the count climbs, and the count spans both levels,
  so golds over the Alps open the lakefront.

**Your best run flies with you.** Beat a challenge and the path is kept; every
attempt after that has a translucent copy of it on the field, starting when you
start and flying exactly what you flew. A results card tells you that you were
four seconds slower — a ghost tells you where you lost them. On the three
windowed kinds the instruments also carry the difference as a number, because
"eighteen metres up on your best" is the thing you want at second forty.

What is stored is the flown path rather than the inputs: replaying a stick
position into air that has breathed on since would fly the ghost into a hill.
Eight samples a second, quantised into about ten kilobytes a run, and the write
gives up quietly rather than ever costing you a medal. See `src/ghost.js`.

Landing counts: put it down slowly on gentle ground and it is a landing rather
than a wreck.

Two things the measurements decided rather than the design. A **height** run is
a ridge beat, not a thermal — this aeroplane takes thirty-seven seconds to fly
one turn, so a minute of circling loses height, while a windward face pays from
the moment you are on it. And the two **deck** runs want opposite flying: Under
the Falls hands you forty per cent over trim with ninety metres to lose, and the
boards are the only way down in time; River Level is sixty seconds in air that
gives nothing back, where the same boards cost you the far end of the run.

A deck run is the one rule in the game with no edge you can see out of the
window, so the corridor is drawn on the minimap and the band says which of the
two ways you are off it — *too high* or *off the line* — in the colour rather
than in a number. Both corridors were traced out of the baked data rather than
off a map: the Chicago river out of the water mask, the Lauterbrunnen floor as
the centroid of everything within forty metres of the lowest ground. Under the
Falls stops at Zweilütschinen because the 25 m grid bridges the gorge there and
bakes a sixty metre step at a 25 per cent grade, which measurably nothing can
climb from the deck.

### The waterfalls

Lauterbrunnen is named for them and there are seventy-two off those walls. A
25 m heightfield cannot hold a ribbon of water two metres wide down a vertical
face, so the five that matter are placed by hand in `src/falls.js` — the
Staubbach at 297 m, the Mürrenbach, the Trümmelbach coming out of the rock at
the valley floor, the Sefinen and the Schmadribach.

Each one is a strip that **follows the ground**, between a foot and a head the
code finds by walking the terrain outward and then back up the face. It has to
be: measured on the baked map, the wall under the Staubbach is a 28-degree
ramp, not a wall — 415 m of climb over 300 m of ground, because the grid cannot
hold a vertical face and the bake smooths what is left. A vertical quad on that
ramp either buries its foot in the hill or hangs its head four hundred metres
out in clear air, and for a while it did the second. The middle rows are bowed
a little way off the rock so the water leaves the cliff the way water does, and
both ends stay planted. Each is one quad and a
noise field, standing just out from the wall because the DEM bakes the cliff as
a steep ramp and anything drawn on the rock would be inside it.

### The aeroplane

There is one, the **Draco 19** — a ballasted nineteen-metre glider that runs and
does not float. `src/fleet.js` still describes five, and everything that reads a
spec still reads it, but the game issues this one for free flight and for every
challenge; there is no hangar and nothing changes aeroplane underneath you.
Unset `ISSUED_AIRCRAFT` in that file and the fleet comes back — but the medal
ladder below is measured against the Draco, so it would want re-calibrating.

## How it renders

Everything is drawn in one forward pass with custom shaders; there is no
post-processing stack and no asset pipeline.

**Terrain** is a CDLOD quadtree. Each selected node is one instance of a shared
grid, displaced in the vertex shader by the baked heightfield, with vertices
morphing onto the next coarser lattice as they approach their LOD range — that
morph is what removes the seams without any stitching geometry. Two details
matter for correctness: the CPU's node-selection metric and the GPU's morph
metric have to be *exactly* the same function, and each level's coarse mip has
to be precisely the next level's fine mip. Node skirts backstop the rest.

**Light** is ray-marched into a texture once at load: sun shadow in one channel,
sky occlusion in the other. Over 38 km of relief that beats a real-time shadow
map on both quality and cost, and it is what makes the Eiger's north face read
as a north face. `?time=` re-bakes it in about a second, which is how the
calibrator and the screenshot tool see the other hours.

**Forests** are baked once into a density mask that both the terrain shader and
the tree placer read, so the painted canopy and the conifers standing on it can
never disagree about where the woods are. The trees are one instanced draw
whose buffer is rebuilt as the player moves; the fade has to finish inside the
rebuilt disc with room to fly on before the next rebuild, or trees wink into
existence at the rim. Beyond the near field they thin onto a fixed lattice
rather than by distance, so approaching a forest never makes trees pop in.

**Buildings** are the real ones: 42,372 OpenStreetMap footprints, so Interlaken
has its actual street grid and the barns above Grindelwald stand in their
actual fields. Outlines, positions and orientations are surveyed data; heights
are inferred, because OSM carries a height for 46 of them. Each building gets
walls extruded from its real outline and a gabled roof along the footprint's
principal axis, with the floor set at the uphill ground so nothing perches on
stilts. They are bucketed into a kilometre grid and merged one tile per frame
as you approach, then discarded behind you — building all of them at once
would be tens of megabytes of vertex data for a view that only ever shows one
valley. A handful of structures are modelled by hand, because a plan-view
footprint cannot describe them however good the survey is: the Sphinx
observatory and Piz Gloria in the Alps, and in Chicago the Centennial Wheel on
Navy Pier, Cloud Gate, Soldier Field's colonnades and the Grand Ballroom dome.
Chicago also drops six buildings that are entirely underground, which OSM
records but which were being extruded into the air.

**The transport network** is real too: roads, farm tracks, hiking paths,
railways and aerialways, all from OSM. Surfaces are ribbons draped on the
terrain and tiled like the buildings. Cables hang between their pylons with a
little sag, drawn as camera-facing ribbons with a minimum apparent width — a
real 40 mm cable is far thinner than a pixel and would strobe in and out of
existence otherwise. OSM stores a railway as dozens of fragments split wherever
a tag changes, so the baker chains fragments that share an endpoint (taking the
straightest continuation at junctions) into continuous runs, which is what
gives the trains, cars and cable cars a line to run along.

Traffic is a headway rather than a count — one car per fifty-five metres of
arterial, one per hundred and thirty of street, one train per three kilometres
of track — so a road is as busy as it is long. It used to be a flat four cars
per route however long the route was, which put ninety-six cars on Chicago's
363 km of arterial and none at all on the Jungfrau's main roads, because a
route whose midpoint was out of range got nothing even while it passed under
the wing. Vehicles are drawn nearest-first with a bias towards where the camera
is pointed, so when the pool runs out it is the traffic behind you that goes;
they keep to their own side of the road, and they are painted the colours a car
park is, because one flat grey against grey asphalt is invisible from a
thousand feet.

**Shading normals** come from a mipmapped gradient map baked from the
heightfield, not from per-fragment height derivatives — the derivative of a
bilinear patch is piecewise constant, which shows up as blocky bands. One
filtered lookup is both smoother and cheaper, and it lets distant faces keep
their real relief on cheap geometry.

**The atmosphere** is an analytic Rayleigh + Mie model, weighted by each
species' share of the scattering so the solar aureole does not outshine the rest
of the dome. The same function is evaluated per fragment for aerial
perspective, so distant ridges fade into exactly the colour the sky is behind
them. Its constants live in one module shared by the GLSL and the JavaScript
that computes scene lighting, so the dome and the lighting cannot drift apart.

## Layout

```
index.html            entry point; import map for three
data/                 baked heightfield + metadata
src/
  main.js             boot, quality, frame loop
  heightfield.js      decode, mip pyramid, CPU sampling, surface map
  terrain.js          CDLOD quadtree, terrain shader, lightmap bake
  sky.js              sun position, sky dome, JS mirror of the sky model
  water.js            the two lakes
  world.js            landmarks, gate courses, thermal cumulus
  trees.js            near-field instanced conifers
  buildings.js        OSM footprints, tiled and extruded on demand
  network.js          roads, rails, cables, and the traffic on them
  binary.js           shared loaders for the packed data files
  flight.js           air mass and glider dynamics
  aircraft.js         the sailplane, built procedurally
  game.js             rules, scoring, camera, progression
  challenges.js       the fourteen tasks, their markers, and the medal book
  controls.js         touch stick, keyboard, gamepad, tilt
  hud.js              instruments, level select, menus
  audio.js            procedural wind and variometer
  materials.js        shared lit material and lofting helpers
  shaders/            GLSL shared between modules
tools/
  regions.mjs         every geographic constant, for both maps
  overpass.mjs        cached, retrying OSM client
  geometry.mjs        rings, simplification, oriented boxes
  bake-terrain.mjs    heightfield, water mask and vegetation mask
  fetch-buildings.mjs download OSM footprints, parts and relations
  bake-buildings.mjs  turn those into the game's compact format
  fetch-network.mjs   download roads, railways and aerialways
  bake-network.mjs    classify, simplify and chain them into routes
  verify-map.mjs      check a baked map against ground truth
  flight-test.mjs     headless flight model checks
  smoke.mjs           end-to-end browser test
  shot.mjs, crop.mjs  screenshot helpers
```

Each baking tool takes a region name:

```
node tools/bake-terrain.mjs chicago
node tools/fetch-buildings.mjs chicago && node tools/bake-buildings.mjs chicago
node tools/fetch-network.mjs chicago && node tools/bake-network.mjs chicago
node tools/verify-map.mjs chicago
```

## Testing

```
node tools/flight-test.mjs                 # flight model, no browser needed
node tools/verify-map.mjs chicago          # is the map where the real place is?
python3 -m http.server 8080 &
node tools/smoke.mjs --portrait            # boots, flies, checks for errors
node tools/smoke.mjs --map=chicago         # the other map, same checks
```

The flight model runs headless, which is how the interesting bugs got caught —
lift resolving downward and an undamped phugoid are both obvious in a table of
numbers and nearly invisible in a screenshot.

## Attribution

Elevation data from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/);
see [ATTRIBUTION.md](ATTRIBUTION.md). Rendering with [three.js](https://threejs.org)
(MIT), vendored in `vendor/`.
