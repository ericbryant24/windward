# Windward

A browser flight game set over the real Jungfrau region of the Bernese Alps.
You fly a sailplane, and the only fuel you have is altitude.

Portrait phone is the primary target — one thumb on the stick, two buttons for
airbrakes and boost — but it plays fine in landscape and on a desktop keyboard.

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

Two maps, picked from the menu or with `?map=`.

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

Altitude is currency. Straight and level costs you about 1.3 m/s, so the game
is about finding the places where the air is going up faster than you are going
down:

- **Thermals** form over sun-facing slopes and are marked by cumulus at
  cloudbase. Circle inside one and you climb. Where they form depends on the
  time of day, because it depends on which slopes the sun is on.
- **Ridge lift** runs up any face the wind is hitting. Fly along a windward
  ridge, low, and you can stay up indefinitely without circling.
- **Sink** is everywhere else, and there is a ring of it around every thermal.

The variometer — the bar on the right, and the beeping — is the instrument that
matters. Faster, higher beeps mean better lift.

### Controls

| | Touch | Keyboard |
|---|---|---|
| Bank | Drag anywhere on the left half | ← → or A D |
| Pitch | Same stick, up/down | ↑ ↓ or W S |
| Airbrakes | BRAKE button | B or Shift |
| Boost | BOOST button | Space |
| Camera | Double-tap the right half | C |
| Pause | ❚❚ | Esc or P |

The stick commands a **bank angle** and an **angle of attack**, not raw rates.
Centre it and the ship rolls level and flies itself. That is a deliberate
choice: on a phone you cannot afford to be fighting an attitude you did not ask
for. Tilt steering is available in the menu if you prefer it.

### Modes

- **Free Flight** — no clock. Nineteen landmarks to find, and a ridge-proximity
  multiplier that pays for flying close to the rock.
- **Jungfrau Circuit** — eleven gates from the Lauterbrunnen valley, over the
  Joch, around the Eiger's north face and back. Against the clock.
- **Height Hunt** — five minutes to get as high as the air will let you.

Landing counts: put it down slowly on gentle ground and you get the bonus
instead of the wreck.

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
as a north face. Changing the time of day re-bakes it in about a second.

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
gives the trains, cars and cable cars a line to run along. Traffic only exists
within a few kilometres of the aircraft.

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
  world.js            landmarks, race gates, thermal cumulus
  trees.js            near-field instanced conifers
  buildings.js        OSM footprints, tiled and extruded on demand
  network.js          roads, rails, cables, and the traffic on them
  binary.js           shared loaders for the packed data files
  flight.js           air mass and glider dynamics
  aircraft.js         the sailplane, built procedurally
  game.js             modes, scoring, camera, progression
  controls.js         touch stick, keyboard, gamepad, tilt
  hud.js              instruments and menus
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
