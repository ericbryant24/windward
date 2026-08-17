/**
 * The regions the game can be baked for.
 *
 * Everything geographic lives here so the baking tools stay generic: give one
 * of these to bake-terrain, fetch-buildings, bake-buildings, fetch-network or
 * bake-network and it produces that region's data files.
 *
 *   node tools/bake-terrain.mjs chicago
 *
 * A region's `water` block is the one place the two regions genuinely differ in
 * kind. In the Alps the lakes sit in deep basins, so flood-filling the DEM from
 * a seed traces the real shoreline for free. Chicago is flat — the ground by
 * the river is within a metre of the river itself — so a flood fill would
 * swallow the whole city. There the lake comes from a depth cutoff (the DEM
 * carries Lake Michigan's bathymetry) and the river is rasterised from its
 * surveyed OSM outline.
 */

export const REGIONS = {
  jungfrau: {
    id: 'jungfrau',
    name: 'Jungfrau',
    subtitle: 'Bernese Oberland, Switzerland',
    centerLat: 46.6,
    centerLon: 7.93,
    halfSize: 19000, // metres; play area is 38 x 38 km
    // 3072 rather than 1536, which is 12.4 m a sample instead of 24.8.
    //
    // The old field was coarser than the mesh drawn over it: the CDLOD leaves
    // bottom out at 18.6 m between vertices, so every patch was interpolating a
    // field it could already out-resolve, and no amount of quality tier could
    // show a shape the data did not carry. It is also why the waterfalls had to
    // be hand-placed — a three-hundred-metre Lauterbrunnen wall is twelve
    // samples wide at 24.8 m and bakes as a smooth ramp.
    //
    // Costs about 8 MB of download and 47 MB of typed array. Chicago stays at
    // 1536: 9.1 m over a 14 km box is already finer than its source.
    size: 3072,
    // Zoom 13 is 13.1 m a pixel at this latitude — coarser than the 12.4 m the
    // new field wants, so the extra samples would be interpolation rather than
    // survey. Zoom 14 is 6.6 m, which keeps the same ~2:1 downsample the old
    // bake had and means every new sample is a measured one.
    sourceZoom: 14,
    water: {
      mode: 'flood',
      seeds: [
        { name: 'Thunersee', lat: 46.6805, lon: 7.7365, level: 558 },
        { name: 'Brienzersee', lat: 46.7245, lon: 7.9705, level: 564 },
      ],
    },
    // The Alpine forests used to be invented at runtime: a tree line at about
    // 1,980 m, an fbm patch mask and a slope term. Plausible, and wrong
    // everywhere it mattered — the wooded shoulder above Wengen, the bare
    // avalanche paths cut through it, the treeless floor of the Lauterbrunnen
    // trench. Switzerland has surveyed all of it and the baker already knew how
    // to rasterise a survey; this region simply never asked it to.
    vegetation: {
      mode: 'osm',
      // Forest and wood are the same thing under two schemas and both are used
      // heavily in the Alps. Scrub is the krummholz band just under the tree
      // line, which is the edge that reads from the air.
      tags: ['landuse=forest', 'natural=wood', 'natural=scrub'],
    },
    buildings: {
      // Almost nothing in the Alps carries a height tag, so these fall back to
      // footprint area and building type. The 14 m2 floor keeps the woodsheds
      // and single garages that make a hamlet look inhabited.
      minArea: 14,
      simplifyTo: 24,
    },
  },

  chicago: {
    id: 'chicago',
    name: 'Chicago',
    subtitle: 'Illinois, United States',
    // Millennium Park, nudged north-west so the box reaches Wrigley Field
    // without giving up the lakefront.
    centerLat: 41.888,
    centerLon: -87.635,
    halfSize: 7000, // 14 x 14 km — dense city, so a tighter box
    size: 1536,
    sourceZoom: 14,
    water: {
      mode: 'cutoff+osm',
      // Lake Michigan's surface is 176.5 m; the DEM carries its bathymetry, so
      // anything meaningfully below the shore is lake.
      level: 176.5,
      cutoff: 179.0,
      name: 'Lake Michigan',
      // The river is locked to within a few centimetres of the lake, so one
      // surface covers both.
      rivers: true,
    },
    vegetation: {
      // Chicago's greenery is parks, not forest, and it is where the city says
      // it is. Rasterise it rather than inventing a tree line.
      mode: 'osm',
      tags: [
        'leisure=park',
        'leisure=garden',
        'leisure=nature_reserve',
        'landuse=forest',
        'landuse=grass',
        'landuse=cemetery',
        'landuse=recreation_ground',
        'natural=wood',
        'natural=scrub',
      ],
    },
    buildings: {
      minArea: 30,
      simplifyTo: 24,
    },
  },

  flam: {
    id: 'flam',
    name: 'Flåm',
    subtitle: 'Aurland, Sogn og Fjordane, Norway',
    // The box is drawn to hold four things: Flåm at the head of the
    // Aurlandsfjord, Myrdal at the top of the railway, Gudvangen at the head of
    // the Nærøyfjord, and the Lærdal end of the tunnel thirty kilometres
    // north-east. The tunnel is the whole reason it reaches that far.
    centerLat: 60.904,
    centerLon: 7.1365,
    halfSize: 22000, // 44 x 44 km
    size: 3072, // 14.3 m a sample
    // 9.3 m a pixel at this latitude, so the source is finer than the field it
    // is being averaged into. Zoom 14 would be four times the tiles for detail
    // the field cannot hold.
    sourceZoom: 13,
    water: {
      mode: 'sea',
      name: 'Aurlandsfjord',
      level: 0,
      // Norway has no land below sea level, so a threshold at a metre is the
      // coastline and nothing else. The fjord is 1,300 m deep in places and the
      // DEM knows it.
      cutoff: 1.0,
    },
    vegetation: {
      // Birch and pine up to about 900 m on these walls, and surveyed, like
      // everywhere else that has a survey.
      mode: 'osm',
      tags: ['landuse=forest', 'natural=wood', 'natural=scrub'],
    },
    buildings: {
      // Hamlets and farmsteads. Same floor as the Alps — the barns are what
      // make a Norwegian valley floor look lived in.
      minArea: 14,
      simplifyTo: 24,
    },
  },

  maui: {
    id: 'maui',
    name: 'Maui',
    subtitle: 'Hawaii, United States',
    // Sixty kilometres, which is what it takes to hold Lahaina on the west
    // shore and the Hana road as far as Keānae on the east, with Haleakalā and
    // the whole West Maui massif between them. Hana town itself is seventeen
    // kilometres off the east edge and stays there; the good half of that road
    // is the half in the box.
    centerLat: 20.8,
    centerLon: -156.4,
    halfSize: 30000, // 60 x 60 km
    size: 3072, // 19.5 m a sample
    // 8.9 m a pixel here, a clean 2:1 into the field.
    sourceZoom: 14,
    water: {
      mode: 'sea',
      name: 'Pacific',
      level: 0,
      cutoff: 1.0,
    },
    vegetation: {
      // Rainforest on the windward slopes, cane and pasture on the isthmus,
      // bare lava above the tree line on Haleakalā. All three are surveyed and
      // the difference between them is most of what the island looks like.
      mode: 'osm',
      tags: [
        'landuse=forest',
        'natural=wood',
        'natural=scrub',
        'landuse=meadow',
        'leisure=park',
        'landuse=orchard',
        'landuse=farmland',
      ],
    },
    buildings: {
      minArea: 30,
      simplifyTo: 24,
    },
  },
};

export function region(name) {
  const key = String(name || 'jungfrau').toLowerCase();
  const r = REGIONS[key];
  if (!r) throw new Error(`unknown region "${name}" — have ${Object.keys(REGIONS).join(', ')}`);
  return r;
}

/** The region named on the command line, defaulting to Jungfrau. */
export function regionFromArgv() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  return region(arg);
}

export const MPD_LAT = 111320;
export const mpdLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** WGS84 -> the region's local metric frame (x east, z south). */
export function projector(r) {
  const mLon = mpdLon(r.centerLat);
  return (lat, lon) => [(lon - r.centerLon) * mLon, (r.centerLat - lat) * MPD_LAT];
}

/** The lat/lon bounding box that encloses the region's square play area. */
export function bbox(r, marginM = 0) {
  const h = r.halfSize + marginM;
  const dLat = h / MPD_LAT;
  const dLon = h / mpdLon(r.centerLat);
  return {
    south: r.centerLat - dLat,
    north: r.centerLat + dLat,
    west: r.centerLon - dLon,
    east: r.centerLon + dLon,
  };
}

/** Where a region's baked files live. */
export const paths = (r) => ({
  terrain: `data/${r.id}.png`,
  meta: `data/${r.id}.json`,
  buildings: `data/${r.id}-buildings.bin.gz`,
  buildingsMeta: `data/${r.id}-buildings.json`,
  network: `data/${r.id}-network.bin.gz`,
  networkMeta: `data/${r.id}-network.json`,
  osmBuildings: `.cache/osm-${r.id}-buildings.json`,
  osmNetwork: `.cache/osm-${r.id}-network.json`,
  osmWater: `.cache/osm-${r.id}-water.json`,
  osmVegetation: `.cache/osm-${r.id}-vegetation.json`,
  vegetation: `data/${r.id}-vegetation.png`,
});
