# Attribution

The game ships two maps. Both are built from public data by the tools in
`tools/`; what is surveyed and what is invented differs sharply between them,
and each section says which is which.

## Elevation data

`data/jungfrau.png` and `data/chicago.png` are derived from the **AWS Terrain Tiles** public dataset
(`s3://elevation-tiles-prod`, "terrarium" encoding) and resampled onto a local
metric grid by `tools/bake-terrain.mjs` — Jungfrau at zoom 13 over 38 × 38 km,
Chicago at zoom 14 over 14 × 14 km.

<https://registry.opendata.aws/terrain-tiles/>

That dataset is itself a composite of national and global elevation sources.
For this part of Switzerland the contributing sources are:

- **SRTM** — NASA Shuttle Radar Topography Mission, public domain.
- **EU-DEM / Copernicus** — © European Union, Copernicus Land Monitoring
  Service, European Environment Agency (EEA), free for use with attribution.
- **swisstopo** contributions where present, © swisstopo.

The full source list and terms are published by the Terrain Tiles project at
<https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.

No tile imagery, textures or photographs are used — every surface in the game
is generated procedurally from the heightfield at runtime.

## Water and vegetation

Chicago's shoreline, the Chicago River and the city's parks are **OpenStreetMap**
data, © OpenStreetMap contributors, ODbL. Neither could be found in the
elevation model: the lakefront is landfill and the river sits at the same height
as the streets beside it, so both are rasterised from their surveyed outlines
into the water mask, and the parks into `data/chicago-vegetation.png`.
`tools/verify-map.mjs` checks the result against named places and against every
river centreline node OSM knows about.

Jungfrau's lakes are flood-filled from the elevation model instead, and its
rivers are **not** represented at all.

## Buildings

`data/jungfrau-buildings.bin.gz` and `data/chicago-buildings.bin.gz` are derived
from **OpenStreetMap**, © OpenStreetMap contributors, made available under the
Open Database Licence (ODbL).

<https://www.openstreetmap.org/copyright>

Footprints were downloaded from the Overpass API by `tools/fetch-buildings.mjs`
and baked by `tools/bake-buildings.mjs`. In both regions the footprint outlines,
positions and orientations are surveyed data, simplified to at most 24 corners
each. What differs is the third dimension.

**Jungfrau — 42,372 buildings, 1% with a surveyed height.** 40 carry a `height`
tag and 521 carry `building:levels`. Every other height is inferred from the
building's type and the area of its footprint, and roof pitch likewise except
where `roof:shape` is tagged. Treat that skyline as characteristic rather than
surveyed.

**Chicago — 145,386 buildings, 50% with a surveyed height.** 610 carry a
`height` tag and 72,384 carry `building:levels`. More importantly, 953 of these
are `building:part` records under the Simple 3D Buildings scheme, which is how
the towers that define the skyline are actually mapped: Willis Tower is a
`type=building` relation carrying no height at all, with nine bundled tubes as
separate parts that each stop at a different level. Those parts are the
setbacks, and the baker extrudes them individually — Willis comes out at 527 m
to its antenna tips with 442 m of roof and 355 m shoulders, 875 N Michigan at
457 m, Trump at 400 m, St. Regis at 349 m, all from the tags. The remaining
half of the city's heights are still inferred from type and footprint area.

Two bugs in the download suppressed a third of the city until they were found.
`out tags geom;` returns a relation's tags but not its members' geometry, so
every multipolygon building — Soldier Field, the Shedd Aquarium, the Wrigley
Building — arrived with nothing to extrude. And a busy Overpass mirror answers
a query it cannot afford with a well-formed empty result, which the cache
accepted as truth; four tiles of the city were stored as containing no
buildings at all. Both are fixed, and empty responses are now retried across
mirrors before being believed.

**Facade materials are inferred in Chicago**, not surveyed. Only a few hundred
buildings tag `building:material`, so the rest are guessed from height and use
by the crude rule a person would apply from the air — a 150 m office tower is
glass, a three-flat is brick, a warehouse is metal. Rooftop mechanical
penthouses are invented outright.

The ODbL requires that this attribution travel with the data and with any
work produced from it. It is also shown in the game's menu.

## Roads, railways, aerialways and paths

`data/jungfrau-network.bin.gz` and `data/chicago-network.bin.gz` are likewise
derived from **OpenStreetMap**, © OpenStreetMap contributors, ODbL.
`tools/fetch-network.mjs` downloads each region's highways, railways and
aerialways; `tools/bake-network.mjs` classifies and simplifies them, and chains
fragments that share an endpoint into continuous runs so that trains, cars and
cable cars have a line to follow. Chicago contributes 77,144 ways carrying 910
road routes and 246 rail routes.

Whether a way runs on the ground, in a tunnel or on a viaduct is surveyed too,
from `layer`, `bridge` and `tunnel` — which is what makes Chicago's L the L.
The CTA is tagged `railway=subway` whether it is under State Street or on steel
above Wabash, and 3,525 ways come out elevated. Tunnels are dropped; nothing
underground is visible from a glider.

The centrelines and levels are the surveyed data. Everything drawn around them
is not: carriageway widths, rail and cable heights, pylon heights, viaduct
height, cable sag, and the timetable — which vehicles run where, how many, and
how fast — are all invented to look right from the air.

## Software

- **three.js** — MIT licence, © 2010–present three.js authors. A copy of the
  build (`three.module.js`, `three.core.js`) is vendored in `vendor/` so the
  game runs without a package install or a CDN.
- **pngjs** — MIT licence. Used only by the offline baking tool, not shipped.
- **Playwright** — Apache 2.0. Used only by the test tools, not shipped.

## Place names and geography

Place names, coordinates and summit or building elevations are from public
geographic reference data for the Jungfrau region, Canton of Bern, Switzerland,
and for Chicago, Illinois. The Jungfrau Circuit and Loop Circuit courses are
invented for the game and correspond to no real airspace, route or permission —
they are not navigation aids, and flying either line in reality would be
illegal in most of its length.

The air is invented as well, though it is invented from how the real air
behaves. Jungfrau flies on ridge lift off its north faces. Chicago is flat and
has none, so its lift is thermals over the heat island plus a convergence band
along the lake breeze front, and Lake Michigan sinks — all plausible, none
measured.
