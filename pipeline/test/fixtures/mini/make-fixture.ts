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
import { PROJECT_SOURCE_IDS } from '../../../project-records/types';
import { DATASF } from '../../../sources/datasf';
import { GTFS_FEEDS } from '../../../transit-config';
import { every, tripTables, type TripSpec } from '../../gtfs-builder';
import { PROJECT_RAW } from './projects-raw';

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

/** Area-weighted planar centroid in local metres (hole rings are CW, so they subtract). */
function centroid(polys: Poly[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (const ring of polys.flat()) {
    for (let k = 0; k + 1 < ring.length; k++) {
      const [x0, y0] = ring[k];
      const [x1, y1] = ring[k + 1];
      const c = x0 * y1 - x1 * y0;
      a += c;
      cx += (x0 + x1) * c;
      cy += (y0 + y1) * c;
    }
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// ---- parcels ----
// One row per acdm-wktn row; `polys` in local metres, `multi` writes a MultiPolygon.
interface ParcelRow {
  mapblklot: string | null;
  blklot: string;
  active: boolean;
  nh?: string;
  polys: Poly[];
  multi?: boolean;
}
const parcelRows: ParcelRow[] = [];
for (let i = 1; i <= 14; i++) {
  const id = LOT_IDS[i];
  if (i === 2) {
    const nh = nhoodOf(2);
    parcelRows.push({ mapblklot: id, blklot: '3512101', active: true, nh, polys: [[lotRect(2)]] });
    parcelRows.push({ mapblklot: id, blklot: '3512102', active: true, nh, polys: [[lotRect(2)]] });
    // slightly different polygon (warning): 0.2 m shorter
    parcelRows.push({
      mapblklot: id,
      blklot: '3512103',
      active: true,
      nh,
      polys: [[rect(10, 0, 20, 29.8)]]
    });
  } else if (i === 5) {
    parcelRows.push({
      mapblklot: id,
      blklot: id,
      active: true,
      nh: nhoodOf(5),
      polys: [[rect(40, 0, 50, 18)], [rect(40, 22, 50, 30)]],
      multi: true
    });
  } else if (i === 6) {
    parcelRows.push({
      mapblklot: id,
      blklot: id,
      active: true,
      nh: nhoodOf(6),
      polys: [[lotRect(6), hole(53, 10, 57, 20)]]
    });
  } else {
    const nh = i === 9 ? undefined : nhoodOf(i);
    parcelRows.push({ mapblklot: id, blklot: id, active: true, nh, polys: [[lotRect(i)]] });
  }
}
// retired parcels
parcelRows.push({
  mapblklot: '3512099',
  blklot: '3512099',
  active: false,
  nh: 'Noe Valley',
  polys: [[rect(111, 26, 119, 29)]]
});
parcelRows.push({
  mapblklot: '3512098',
  blklot: '3512098',
  active: false,
  nh: 'Mission',
  polys: [[rect(1, 26, 9, 29)]]
});
// active parcel with null mapblklot
parcelRows.push({
  mapblklot: null,
  blklot: '3512097',
  active: true,
  nh: 'Noe Valley',
  polys: [[rect(150, 0, 160, 30)]]
});
const parcels = parcelRows.map((r) =>
  feature(
    parcelProps(r.mapblklot, r.blklot, r.active, r.nh),
    r.multi ? multi(...r.polys) : polygon(...r.polys[0])
  )
);

// ---- height and bulk districts (h9wh-cg3m; scenario-data spec §4.11) ----
const heightBulk = (
  [
    [-60, 44, '40//65-R-4', '65'],
    [44, 97, '65-X', '65'],
    [97, 110, '85//120-R-4', '120'],
    [110, 120, 'Special Height District', '4444'],
    [120, 130, '120/400-R-2  //  140/520-R-2', '520'],
    [130, 140, '120/400//120/650-R4', '650']
  ] as const
).map(([x0, x1, height, gen]) =>
  feature({ height, gen_hght: gen }, polygon(rect(x0, -100, x1, 100)))
);

/** SODA CSV: every header and value quoted, null as an empty unquoted field, LF line ends. */
function sodaCsv(header: string[], rows: (string | null)[][]): string {
  const cell = (v: string | null) => (v === null ? '' : `"${v.replaceAll('"', '""')}"`);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
/** SODA number style for numeric columns: `2` -> `"2.0"`. */
const n1 = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// ---- parcel attributes (acdm-wktn CSV, active and retired) ----
const ZONING: Record<number, string> = {
  1: 'RH-2',
  2: 'RH-2',
  3: 'NCT',
  4: 'NC-1',
  5: 'RH-1',
  6: 'RM-1',
  7: 'P',
  8: 'RH-2',
  9: 'P',
  10: 'RH-3',
  11: 'RH-3',
  12: 'P',
  13: 'C-3-O',
  14: 'C-3-G'
};
const lotOfId = Object.fromEntries(Object.entries(LOT_IDS).map(([i, id]) => [id, Number(i)]));
const DROPPED: Record<string, string> = {
  '3512099': '2024-06-30T00:00:00.000',
  '3512098': '2019-03-01T00:00:00.000'
};
const ATTR_HEADER = [
  'mapblklot',
  'blklot',
  'active',
  'zoning_code',
  'date_rec_add',
  'date_rec_drop',
  'centroid_latitude',
  'centroid_longitude'
];
const parcelAttrs = parcelRows.map((r) => {
  const zoning = r.mapblklot === null ? 'P' : r.active ? ZONING[lotOfId[r.mapblklot]] : 'RH-2';
  const [lng, lat] = ll(centroid(r.polys));
  // date_rec_add is mostly empty in live acdm-wktn; the fixture leaves it empty throughout.
  return [
    r.mapblklot,
    r.blklot,
    String(r.active),
    zoning,
    null,
    r.active ? null : DROPPED[r.blklot],
    String(lat),
    String(lng)
  ];
});

// ---- assessor secured roll (wv5m-vpq2 CSV, roll years 2025, 2024 and 2023) ----
const ROLL_HEADER = [
  'closed_roll_year',
  'parcel_number',
  'use_code',
  'property_class_code',
  'year_property_built',
  'number_of_stories',
  'number_of_units',
  'property_area',
  'assessed_land_value',
  'assessed_improvement_value',
  'status_code'
];
/**
 * One roll row per year in `years`; `built` is SODA text (null = empty), `builtIn` overrides it,
 * and `unitsIn` overrides `units` for one year.
 */
interface RollSpec {
  p: string;
  use: string;
  cls: string;
  built: string | null;
  stories: number;
  units: number;
  area: number;
  land: number;
  impr: number;
  years: number[];
  status: string;
  builtIn: Record<number, string>;
  unitsIn: Record<number, number>;
}
/** Roll years in file order. 2023 has rows for lots 3 and 4 only (spec §4.11, RA1 cases). */
const ROLL_YEARS = [2025, 2024, 2023];
const BOTH = [2025, 2024];
function rr(
  p: string,
  useCls: string,
  built: string | null,
  [stories, units, area]: [number, number, number],
  [land, impr]: [number, number],
  opts: Partial<Pick<RollSpec, 'years' | 'status' | 'builtIn' | 'unitsIn'>> = {}
): RollSpec {
  const [use, cls] = useCls.split('/');
  const { years = BOTH, status = 'NA', builtIn = {}, unitsIn = {} } = opts;
  return { p, use, cls, built, stories, units, area, land, impr, years, status, builtIn, unitsIn };
}
// Scenario-data plan Task 6 table (spec §4.11; lot 2 built 1975, ruled). Lots 3 and 4 carry the
// RA1 units cases: lot 3 has 5,000 units in 2023 and 2025 (no 2024 row) on a 300 m², 3-story lot
// (capacity 90), so no year is plausible; lot 4 has 3, 900, 3 in 2023-2025.
const ROLL: RollSpec[] = [
  rr('3512001', 'SRES/F', '1912', [2, 2, 2000], [400000, 300000]),
  rr('3512101', 'SRES/Z', '1975', [3, 1, 800], [200000, 300000]),
  rr('3512102', 'SRES/Z', '1975', [3, 1, 800], [200000, 300000]),
  rr('3512103', 'SRES/Z', '1975', [3, 1, 800], [200000, 300000]),
  rr('8711023C', 'COMH/H1', '1920', [3, 5000, 3000], [500000, 500000], { years: [2025, 2023] }),
  rr('0026T001A', 'MRES/A', '1925', [3, 3, 3000], [300000, 600000], {
    years: ROLL_YEARS,
    unitsIn: { 2024: 900 }
  }),
  rr('3512005', 'SRES/D', '1950', [1, 1, 1000], [300000, 100000], { builtIn: { 2024: '0' } }),
  rr('3512006', 'MRES/F', '1940', [2, 2, 2200], [350000, 250000]),
  rr('3512007', 'MISC/V', null, [0, 0, 0], [100000, 0]),
  rr('3512008', 'MRES/A', '1960', [4, 12, 10000], [800000, 1200000]),
  rr('3512010', 'MRES/F', '1930', [2, 3, 3000], [400000, 400000]),
  rr('3512011', 'GOVT/X', '1955', [3, 0, 6000], [0, 0], { status: 'N' }),
  rr('3512013', 'MRES/A', '1970', [3, 5, 5000], [500000, 500000], { years: [2024] }),
  rr('3512014', 'MRES/A', '2015', [6, 40, 30000], [3000000, 9000000]),
  rr('3512099', 'MRES/A', '1910', [2, 7, 5600], [300000, 200000], { years: [2024] })
];
const roll = ROLL_YEARS.flatMap((year) =>
  ROLL.filter((r) => r.years.includes(year)).map((r) => [
    String(year),
    r.p,
    r.use,
    r.cls,
    r.builtIn[year] ?? r.built,
    n1(r.stories),
    n1(r.unitsIn[year] ?? r.units),
    n1(r.area),
    n1(r.land),
    n1(r.impr),
    r.status
  ])
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
      { id: 'far_ct', name: 'Far Caltrain', at: [0, -8000] },
      { id: 'far_ct_n', name: 'Far North Caltrain', at: [0, 8000] }
    ],
    // 40 trains each way (80/day at the station: SB 79 tier 1), 5 in the peak window -> 2.5 tph.
    trips: [
      { route: '77119', dir: 0, stops: ['70012', 'far_ct'], starts: every(5, 0, 25, 40) },
      {
        route: '77119',
        dir: 1,
        stops: ['far_ct', '70011', 'far_ct_n'],
        starts: every(5, 0, 25, 40)
      }
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
  },
  {
    id: 'datasf-height-bulk',
    features: heightBulk,
    license: 'public-domain',
    homepage: 'https://data.sf.gov/d/h9wh-cg3m',
    label: 'DataSF Zoning Map – Height and Bulk Districts'
  }
];
const CSV_SOURCES = [
  {
    id: 'datasf-parcel-attrs',
    header: ATTR_HEADER,
    rows: parcelAttrs,
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/acdm-wktn',
    label: 'DataSF Parcels (attributes, active and retired)'
  },
  {
    id: 'datasf-assessor-roll',
    header: ROLL_HEADER,
    rows: roll,
    license: 'PDDL-1.0',
    homepage: 'https://data.sf.gov/d/wv5m-vpq2',
    label: 'DataSF Assessor Historical Secured Property Tax Rolls'
  }
];

// Project-records spec §4.9 Fixture: the seven project sources as SODA JSON row arrays.
const JSON_SOURCES = PROJECT_SOURCE_IDS.map((id) => ({
  id,
  rows: PROJECT_RAW[id],
  license: DATASF[id].license,
  homepage: DATASF[id].homepage,
  label: DATASF[id].label
}));

const pages = [
  ...SOURCES.map((src) => ({
    ...src,
    name: `${src.id}.page-000.geojson`,
    body: JSON.stringify({ type: 'FeatureCollection', features: src.features }) + '\n',
    rowCount: src.features.length
  })),
  ...CSV_SOURCES.map((src) => ({
    ...src,
    name: `${src.id}.page-000.csv`,
    body: sodaCsv(src.header, src.rows),
    rowCount: src.rows.length
  })),
  ...JSON_SOURCES.map((src) => ({
    ...src,
    name: `${src.id}.page-000.json`,
    body: JSON.stringify(src.rows) + '\n',
    rowCount: src.rows.length
  }))
];

const entries: LockEntry[] = [];
for (const src of pages) {
  const name = src.name;
  const file = path.join(rawDir, name);
  fs.writeFileSync(file, src.body);
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
    rowCount: src.rowCount,
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
