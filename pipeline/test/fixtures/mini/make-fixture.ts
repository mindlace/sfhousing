/**
 * Generates the mini fixture raw sources + sources.lock.json (deterministic; output committed).
 * Run: npm run pipeline:... no — `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`.
 * Shapes are placed in local metres relative to O, projected through EPSG:7131.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { BASEMAP_BUILD, FONTS_COMMIT, FONT_STACKS } from '../../../config';
import { archiveKeyFor, type Lock, type LockEntry, sha256File, writeLock } from '../../../lib/lock';
import { GTFS_FEEDS } from '../../../transit-config';
import { every, tripTables, type TripSpec } from '../../gtfs-builder';

proj4.defs(
  'EPSG:7131',
  '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);
const [OX, OY] = proj4('EPSG:4326', 'EPSG:7131', [-122.4195, 37.76]);

type Ring = [number, number][];
type Poly = Ring[];
type Props = Record<string, unknown>;

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
const ll = ([x, y]: [number, number]): [number, number] => {
  const [lng, lat] = proj4('EPSG:7131', 'EPSG:4326', [OX + x, OY + y]);
  return [r7(lng), r7(lat)];
};
const ringLL = (r: Ring) => r.map(ll);
/** Outer ring CCW, closed. */
const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0]
];
/** Hole ring CW, closed. */
const hole = (x0: number, y0: number, x1: number, y1: number): Ring =>
  rect(x0, y0, x1, y1).reverse();
const polygon = (...rings: Ring[]) => ({
  type: 'Polygon' as const,
  coordinates: rings.map(ringLL)
});
const multi = (...polys: Poly[]) => ({
  type: 'MultiPolygon' as const,
  coordinates: polys.map((p) => p.map(ringLL))
});
type Geom = ReturnType<typeof polygon> | ReturnType<typeof multi>;
const feature = (properties: Props, geometry: Geom) => ({ type: 'Feature', properties, geometry });
/** SODA serialises numbers as strings. */
const s = (v: number) => String(v);

/** Lot i spans x in [10(i-1), 10i], y in [0, 30]. */
const lotRect = (i: number) => rect(10 * (i - 1), 0, 10 * i, 30);
const lotId = (i: number) => `35120${String(i).padStart(2, '0')}`;
// Lots 3 and 4 use the odd-shaped (alphanumeric) ids; the rest are 35120NN.
const LOT_IDS: Record<number, string> = {
  ...Object.fromEntries(Array.from({ length: 14 }, (_, k) => [k + 1, lotId(k + 1)])),
  3: '8711023C',
  4: '0026T001A'
};
const nhoodOf = (i: number) => (i <= 8 ? 'Mission' : 'Noe Valley');

function parcelProps(mapblklot: string | null, blklot: string, active: boolean, nh?: string) {
  const p: Props = {};
  if (mapblklot !== null) p.mapblklot = mapblklot;
  p.blklot = blklot;
  if (mapblklot !== null) {
    p.block_num = mapblklot.slice(0, 4);
    p.lot_num = mapblklot.slice(4);
  }
  p.active = active;
  if (nh !== undefined) p.analysis_neighborhood = nh;
  return p;
}

// ---- parcels ----
const parcels = [];
for (let i = 1; i <= 14; i++) {
  const id = LOT_IDS[i];
  if (i === 2) {
    const nh = nhoodOf(2);
    parcels.push(feature(parcelProps(id, '3512101', true, nh), polygon(lotRect(2))));
    parcels.push(feature(parcelProps(id, '3512102', true, nh), polygon(lotRect(2))));
    // slightly different polygon (warning): 0.2 m shorter
    parcels.push(feature(parcelProps(id, '3512103', true, nh), polygon(rect(10, 0, 20, 29.8))));
  } else if (i === 5) {
    parcels.push(
      feature(
        parcelProps(id, id, true, nhoodOf(5)),
        multi([rect(40, 0, 50, 18)], [rect(40, 22, 50, 30)])
      )
    );
  } else if (i === 6) {
    parcels.push(
      feature(parcelProps(id, id, true, nhoodOf(6)), polygon(lotRect(6), hole(53, 10, 57, 20)))
    );
  } else {
    const nh = i === 9 ? undefined : nhoodOf(i);
    parcels.push(feature(parcelProps(id, id, true, nh), polygon(lotRect(i))));
  }
}
// retired parcels
parcels.push(
  feature(parcelProps('3512099', '3512099', false, 'Noe Valley'), polygon(rect(111, 26, 119, 29)))
);
parcels.push(
  feature(parcelProps('3512098', '3512098', false, 'Mission'), polygon(rect(1, 26, 9, 29)))
);
// active parcel with null mapblklot
parcels.push(
  feature(parcelProps(null, '3512097', true, 'Noe Valley'), polygon(rect(150, 0, 160, 30)))
);

// ---- land use ----
function lu(
  mapblklot: string,
  landuse: string | null,
  resunits: number,
  res: number,
  totalcomm: number,
  g: Geom
) {
  const p: Props = { mapblklot };
  if (landuse !== null) p.landuse = landuse;
  p.resunits = s(resunits);
  p.res = s(res);
  p.totalcomm = s(totalcomm);
  return feature(p, g);
}
const lot = (i: number) => polygon(lotRect(i));
const landuse = [
  lu(LOT_IDS[1], 'RESIDENT', 2, 2000, 0, lot(1)),
  lu(LOT_IDS[2], 'RESIDENT', 6, 0, 0, lot(2)),
  lu(LOT_IDS[3], 'MIXRES', 4, 3000, 500, lot(3)),
  lu(LOT_IDS[3], 'RETAIL/ENT', 0, 0, 4000, lot(3)),
  lu(LOT_IDS[4], 'MIXED', 3, 0, 0, lot(4)),
  lu(LOT_IDS[5], 'RESIDENT', 1, 0, 0, multi([rect(40, 0, 50, 18)], [rect(40, 22, 50, 30)])),
  lu(LOT_IDS[6], 'RESIDENT', 2, 0, 0, polygon(lotRect(6), hole(53, 10, 57, 20))),
  lu(LOT_IDS[7], 'OPENSPACE', 0, 0, 0, lot(7)),
  lu(LOT_IDS[8], null, 12, 0, 0, lot(8)),
  lu(LOT_IDS[10], 'RESIDENT', 3, 0, 0, lot(10)),
  lu(LOT_IDS[11], 'RESIDENT', 3, 0, 0, lot(11)),
  lu(LOT_IDS[13], 'RESIDENT', 5, 0, 0, lot(13)),
  lu(LOT_IDS[14], 'MIXRES', 40, 30000, 5000, lot(14)),
  lu('3512099', 'RESIDENT', 7, 0, 0, polygon(rect(111, 26, 119, 29))),
  lu('3512098', 'RESIDENT', 9, 0, 0, polygon(rect(1, 26, 9, 29)))
];

// ---- DataSF footprints ----
const b13 = rect(122, 5, 128, 25);
const footprints = [
  feature(
    { mblr: 'SF' + LOT_IDS[13], sf16_bldgid: '201006.0000013', hgt_median_m: '21.3' },
    polygon(b13)
  ),
  feature(
    { mblr: 'SF' + LOT_IDS[1], sf16_bldgid: '201006.0000001', hgt_median_m: '30.5' },
    polygon(rect(5, 10, 9, 20))
  ),
  feature(
    { mblr: 'CN0000001', sf16_bldgid: '201006.0000099', hgt_median_m: '0' },
    polygon(rect(0, -10, 10, -2))
  )
];

// ---- neighborhoods ----
const neighborhoods = [
  feature({ nhood: 'Mission' }, polygon(rect(-60, -100, 75, 100))),
  feature({ nhood: 'Noe Valley' }, polygon(rect(75, -100, 220, 100)))
];

// ---- Overture ----
function ov(
  id: string,
  height: number | null,
  numFloors: number | null,
  datasets: string[],
  g: Geom,
  underground = false
) {
  return feature(
    {
      id,
      height,
      num_floors: numFloors,
      min_height: null,
      is_underground: underground,
      datasets
    },
    g
  );
}
const overture = [
  ov('b01', 12, null, ['OpenStreetMap'], polygon(rect(2, 5, 8, 25))),
  ov('b02', 15, null, ['OpenStreetMap'], polygon(rect(12, 5, 18, 25))),
  ov('b03', null, 0, ['OpenStreetMap'], polygon(rect(22, 5, 28, 25))),
  ov('b04', null, 4, ['OpenStreetMap'], polygon(rect(32, 5, 38, 25))),
  ov('b06', 9, null, ['OpenStreetMap'], polygon(rect(51, 5, 59, 25), hole(54, 12, 56, 18))),
  ov('b10', 18, null, ['OpenStreetMap'], polygon(rect(95, 5, 105, 25))),
  ov('b13', null, null, ['OpenStreetMap'], polygon(b13)),
  ov('b14', 60, null, ['USGS Lidar'], polygon(rect(132, 5, 138, 25))),
  ov('bpier', 6, null, ['Microsoft ML Buildings'], polygon(rect(20, -40, 40, -32))),
  ov('bunder', 5, null, ['OpenStreetMap'], polygon(rect(3, 6, 5, 8)), true),
  ov('bmarin', 8, null, ['OpenStreetMap'], polygon(rect(0, 400, 10, 410))),
  ov('besri', 4, null, ['Esri Community Maps'], polygon(rect(57.5, 26, 58.7, 27.2)))
];

// ---- GTFS (transit spec §4.4) ----
// Local metres from O like the lots. Expected: 8 kept stops (m1 m2 m3 m4 m5 FX-1 70011 70012);
// mx, FAR and far_ct lie > 1 km outside the neighborhoods and are clipped. Muni's 2026-10-13 is
// removed by calendar_dates, so Muni counts 2026-10-20 while BART and Caltrain count 2026-10-13.
// m4 ("Metro Fixture Station") and FX-1 (station "Fixture Station") share a place.
interface FxStop {
  id: string;
  name: string;
  at: [number, number];
  station?: boolean;
  parent?: string;
}
const CAL =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'WKDY,1,1,1,1,1,0,0,20260901,20261231\n';
function gtfs(f: { routes: string; stops: FxStop[]; trips: TripSpec[]; dates?: string }) {
  const stops = ['stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station'];
  for (const s of f.stops) {
    const [lng, lat] = ll(s.at);
    stops.push(`${s.id},"${s.name}",${lat},${lng},${s.station ? 1 : 0},${s.parent ?? ''}`);
  }
  return {
    'calendar.txt': CAL,
    'calendar_dates.txt': f.dates ?? 'service_id,date,exception_type\n',
    'routes.txt': f.routes,
    'stops.txt': stops.join('\n') + '\n',
    ...tripTables(f.trips, 'WKDY')
  };
}
const GTFS: Record<string, Record<string, string>> = {
  'gtfs-muni': gtfs({
    routes:
      'route_id,route_short_name,route_long_name,route_type\n22,22,FILLMORE,3\n14,14,MISSION,3\nN,N,JUDAH,0\n',
    stops: [
      { id: 'm1', name: 'Mission St & 20th St', at: [0, -50] },
      { id: 'm2', name: 'Mission St & 22nd St', at: [0, -250] },
      { id: 'm3', name: 'Valencia St & 20th St', at: [170, -50] },
      { id: 'm4', name: 'Metro Fixture Station/Downtown', at: [100, 100] },
      { id: 'm5', name: 'Church St & 24th St', at: [300, 300] },
      { id: 'mx', name: 'Far Away St & Nowhere Ave', at: [3000, 0] }
    ],
    trips: [
      { route: '22', dir: 0, stops: ['m1', 'm2'], starts: [...every(7, 0, 10, 12), 12 * 3600] },
      { route: '22', dir: 1, stops: ['m2', 'm1'], starts: [...every(7, 0, 10, 12), 12 * 3600] },
      { route: '14', dir: 0, stops: ['m3', 'm1', 'mx'], starts: every(7, 0, 15, 8) },
      { route: 'N', dir: 0, stops: ['m4', 'm5'], starts: every(7, 0, 12, 10) }
    ],
    dates: 'service_id,date,exception_type\nWKDY,20261013,2\n'
  }),
  'gtfs-bart': gtfs({
    routes:
      'route_id,route_short_name,route_long_name,route_type\n7,Red-S,Richmond to SFO,1\nBB-A,BridgeA,Bus Bridge,3\n',
    stops: [
      { id: 'FXST', name: 'Fixture Station', at: [120, 110], station: true },
      { id: 'FX-1', name: 'Fixture Station', at: [120, 110], parent: 'FXST' },
      { id: 'FAR', name: 'Far Station', at: [6000, 0] }
    ],
    trips: [{ route: '7', dir: 0, stops: ['FX-1', 'FAR'], starts: every(7, 0, 15, 8) }]
  }),
  'gtfs-caltrain': gtfs({
    routes: 'route_id,route_short_name,route_long_name,route_type\n77119,Local Weekday,,2\n',
    stops: [
      { id: 'fixture_ct', name: 'Fixture Caltrain Station', at: [-40, -80], station: true },
      { id: '70011', name: 'Fixture Caltrain Northbound', at: [-40, -78], parent: 'fixture_ct' },
      { id: '70012', name: 'Fixture Caltrain Southbound', at: [-40, -82], parent: 'fixture_ct' },
      { id: 'far_ct', name: 'Far Caltrain', at: [0, -8000] }
    ],
    // 40 trains each way (80/day at the station: SB 79 tier 1), 5 in the peak window -> 2.5 tph.
    trips: [
      { route: '77119', dir: 0, stops: ['70012', 'far_ct'], starts: every(5, 0, 25, 40) },
      { route: '77119', dir: 1, stops: ['far_ct', '70011'], starts: every(5, 0, 25, 40) }
    ]
  })
};

// ---- write ----
const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, 'raw');
fs.mkdirSync(rawDir, { recursive: true });
for (const [id, files] of Object.entries(GTFS)) {
  fs.mkdirSync(path.join(rawDir, id), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(rawDir, id, name), body);
  }
}

const SOURCES = [
  {
    id: 'datasf-parcels',
    features: parcels,
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/acdm-wktn',
    label: 'DataSF Parcels (Active and Retired)'
  },
  {
    id: 'datasf-landuse-2023',
    features: landuse,
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/fdfd-xptc',
    label: 'DataSF Land Use 2023'
  },
  {
    id: 'datasf-footprints',
    features: footprints,
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/ynuv-fyni',
    label: 'DataSF Building Footprints'
  },
  {
    id: 'datasf-neighborhoods',
    features: neighborhoods,
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/j2bu-swwd',
    label: 'DataSF Analysis Neighborhoods'
  },
  {
    id: 'overture-buildings',
    features: overture,
    license: 'ODbL-1.0',
    homepage: 'https://overturemaps.org',
    label: 'Overture Maps Buildings'
  }
];

const entries: LockEntry[] = [];
for (const src of SOURCES) {
  const name = `${src.id}.page-000.geojson`;
  const file = path.join(rawDir, name);
  const body = JSON.stringify({ type: 'FeatureCollection', features: src.features }) + '\n';
  fs.writeFileSync(file, body);
  const sha256 = await sha256File(file);
  entries.push({
    id: src.id,
    files: [
      {
        url: `https://fixture.invalid/${name}`,
        sha256,
        bytes: fs.statSync(file).size,
        archiveKey: archiveKeyFor(sha256, name),
        name
      }
    ],
    retrievedAt: '2026-10-10T00:00:00.000Z',
    upstreamVersion: 'fixture',
    rowCount: src.features.length,
    license: src.license,
    label: src.label,
    homepage: src.homepage
  });
}

// Non-vector sources: the committed basemap extract and glyph PBFs (downloaded once, see README).
async function binaryEntry(
  id: string,
  names: string[],
  meta: Pick<LockEntry, 'license' | 'homepage' | 'label' | 'upstreamVersion'>,
  url: (name: string) => string
): Promise<LockEntry> {
  const files = [];
  for (const name of names) {
    const file = path.join(rawDir, name);
    const sha256 = await sha256File(file);
    files.push({
      url: url(name),
      sha256,
      bytes: fs.statSync(file).size,
      archiveKey: archiveKeyFor(sha256, name),
      name
    });
  }
  return { id, files, retrievedAt: '2026-10-10T00:00:00.000Z', rowCount: files.length, ...meta };
}
entries.push(
  await binaryEntry(
    'protomaps-basemap',
    ['protomaps-basemap.pmtiles'],
    {
      upstreamVersion: BASEMAP_BUILD,
      license: 'ODbL-1.0',
      homepage: 'https://protomaps.com',
      label: 'Protomaps basemap (OpenStreetMap)'
    },
    () => `https://build.protomaps.com/${BASEMAP_BUILD}.pmtiles`
  )
);
const fontFiles = [
  'protomaps-fonts/OFL.txt',
  ...Object.keys(FONT_STACKS).map((s) => `protomaps-fonts/${s}/0-255.pbf`)
];
entries.push(
  await binaryEntry(
    'protomaps-fonts',
    fontFiles,
    {
      upstreamVersion: FONTS_COMMIT,
      license: 'OFL-1.1',
      homepage: 'https://github.com/protomaps/basemaps-assets',
      label: 'Noto Sans glyphs'
    },
    (name) =>
      `https://raw.githubusercontent.com/protomaps/basemaps-assets/${FONTS_COMMIT}/${name.replace('protomaps-fonts/', 'fonts/').replaceAll(' ', '%20')}`
  )
);
for (const spec of Object.values(GTFS_FEEDS)) {
  entries.push(
    await binaryEntry(
      spec.lockId,
      Object.keys(GTFS[spec.lockId])
        .sort()
        .map((n) => `${spec.lockId}/${n}`),
      {
        upstreamVersion: 'fixture',
        license: spec.license,
        homepage: spec.homepage,
        label: spec.label
      },
      (name) => `https://fixture.invalid/${name}`
    )
  );
}
const lock: Lock = { sources: entries };
writeLock(path.join(here, 'sources.lock.json'), lock);
console.log(entries.map((e) => `${e.id}: ${e.rowCount}`).join('\n'));
