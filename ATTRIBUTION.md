# Attribution

## Elevation data

`data/jungfrau.png` is derived from the **AWS Terrain Tiles** public dataset
(`s3://elevation-tiles-prod`, "terrarium" encoding), fetched at zoom 13 and
resampled onto a 38 × 38 km local metric grid by `tools/bake-terrain.mjs`.

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

## Buildings

`data/buildings.bin.gz` is derived from **OpenStreetMap**, © OpenStreetMap
contributors, made available under the Open Database Licence (ODbL).

<https://www.openstreetmap.org/copyright>

42,372 building footprints inside the play area were downloaded from the
Overpass API by `tools/fetch-buildings.mjs` and baked into the game's format by
`tools/bake-buildings.mjs`. Footprint outlines, positions and orientations are
the surveyed data, simplified to at most 24 corners each. **Heights are not
from OSM** — only 46 of these buildings carry a `height` tag and 551 carry
`building:levels`, so every other height is inferred from the building's type
and the area of its footprint, and roof pitch likewise except where
`roof:shape` is tagged. Treat the skyline as characteristic rather than
surveyed.

The ODbL requires that this attribution travel with the data and with any
work produced from it. It is also shown in the game's menu.

## Roads, railways, aerialways and paths

`data/network.bin.gz` is likewise derived from **OpenStreetMap**, © OpenStreetMap
contributors, ODbL. `tools/fetch-network.mjs` downloads the region's highways,
railways and aerialways; `tools/bake-network.mjs` classifies and simplifies
them, and chains fragments that share an endpoint into continuous runs so that
trains and cable cars have a line to follow.

The centrelines are the surveyed data. Everything drawn around them is not:
carriageway widths, rail and cable heights, pylon heights, cable sag, and the
timetable — which vehicles run where, how many, and how fast — are all
invented to look right from the air.

## Software

- **three.js** — MIT licence, © 2010–present three.js authors. A copy of the
  build (`three.module.js`, `three.core.js`) is vendored in `vendor/` so the
  game runs without a package install or a CDN.
- **pngjs** — MIT licence. Used only by the offline baking tool, not shipped.
- **Playwright** — Apache 2.0. Used only by the test tools, not shipped.

## Place names and geography

Place names, coordinates and summit elevations are from public geographic
reference data for the Jungfrau region, Canton of Bern, Switzerland. The
Jungfrau Circuit course is invented for the game and does not correspond to any
real airspace, route or permission — it is not a navigation aid.
