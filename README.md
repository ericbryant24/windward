# Windward

A browser flight game set over the real Jungfrau region of the Bernese Alps.
You fly a sailplane, and the only fuel you have is altitude.

Portrait phone is the primary target — one thumb on the stick, two buttons for
airbrakes and boost — but it plays fine in landscape and on a desktop keyboard.

```
python3 -m http.server 8080      # or any static file server
open http://localhost:8080
```

There is no build step. The whole thing is ES modules, a vendored copy of
three.js, and one 2.6 MB terrain file.

## The place

The map is 38 × 38 km of real terrain centred on 46.60 N, 7.93 E, resampled to
a 25 m grid from public SRTM-derived elevation tiles. Everything is where it
should be: the Eiger's north face above Grindelwald, the Lauterbrunnen valley
with its 400-metre walls, Jungfraujoch on the saddle, Thunersee and Brienzersee
either side of Interlaken. Summit heights land within a few tens of metres of
the surveyed figures — the residual is the 25 m grid rounding off the summits,
not an error in placement.

`tools/bake-terrain.mjs` regenerates `data/jungfrau.png` from the source tiles
if you want a different region or resolution.

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
  flight.js           air mass and glider dynamics
  aircraft.js         the sailplane, built procedurally
  game.js             modes, scoring, camera, progression
  controls.js         touch stick, keyboard, gamepad, tilt
  hud.js              instruments and menus
  audio.js            procedural wind and variometer
  materials.js        shared lit material and lofting helpers
  shaders/            GLSL shared between modules
tools/
  bake-terrain.mjs    regenerate the heightfield from source tiles
  flight-test.mjs     headless flight model checks
  smoke.mjs           end-to-end browser test
  shot.mjs, crop.mjs  screenshot helpers
```

## Testing

```
node tools/flight-test.mjs                 # flight model, no browser needed
python3 -m http.server 8080 &
node tools/smoke.mjs --portrait            # boots, flies, checks for errors
```

The flight model runs headless, which is how the interesting bugs got caught —
lift resolving downward and an undamped phugoid are both obvious in a table of
numbers and nearly invisible in a screenshot.

## Attribution

Elevation data from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/);
see [ATTRIBUTION.md](ATTRIBUTION.md). Rendering with [three.js](https://threejs.org)
(MIT), vendored in `vendor/`.
