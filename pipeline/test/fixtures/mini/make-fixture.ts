/**
 * Generates the mini fixture raw sources + sources.lock.json (deterministic; output committed).
 * Run: npm run pipeline:... no — `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`.
 * Shapes are placed in local metres relative to O, projected through EPSG:7131.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { archiveKeyFor, type Lock, type LockEntry, sha256File, writeLock } from '../../../lib/lock';

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

// ---- write ----
const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, 'raw');
fs.mkdirSync(rawDir, { recursive: true });

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
const lock: Lock = { sources: entries };
writeLock(path.join(here, 'sources.lock.json'), lock);
console.log(entries.map((e) => `${e.id}: ${e.rowCount}`).join('\n'));
