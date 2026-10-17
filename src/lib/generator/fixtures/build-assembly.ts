// Regenerates the assembly-*.json fixtures. Run deliberately, and commit the result with a reason:
//   npx tsx src/lib/generator/fixtures/build-assembly.ts
// Each lot is defined in absolute EPSG:7131 metres, then stored the way the pipeline stores it:
// the label point is rounded to 1e-7 degrees and projected back to (x0, y0), and every ring is
// `geom - (x0, y0)` quantised to cm (pipeline/lib/rings.ts:7). Neighbouring lots therefore
// disagree about their shared edges by up to a centimetre, as real parcels do.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';

proj4.defs(
  'EPSG:7131',
  '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

type Pt = [number, number];
interface Lot {
  id: string;
  ring: Pt[];
}

/** Origin of every fixture, in EPSG:7131 grid metres (inner Mission). */
const ORIGIN: Pt = [48800, 24300];

const area = (r: Pt[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};

function interiorPoint(r: Pt[]): Pt {
  const a = area(r);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  const p: Pt = [cx / (6 * a), cy / (6 * a)];
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  if (!inside) throw new Error('centroid is outside the lot');
  return p;
}

const q = (v: number): number => Math.round(v * 100) / 100 + 0;

function record(lot: Lot) {
  const abs = lot.ring.map(([x, y]) => [ORIGIN[0] + x, ORIGIN[1] + y] as Pt);
  const [lng, lat] = proj4('EPSG:7131', 'EPSG:4326', interiorPoint(abs));
  const labelPoint: Pt = [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
  const [x0, y0] = proj4('EPSG:4326', 'EPSG:7131', labelPoint);
  const ring = abs.map(([x, y]) => [q(x - x0), q(y - y0)] as Pt);
  return {
    id: lot.id,
    polygon: [ring],
    labelPoint,
    areaM2: Math.round(area(ring) * 100) / 100,
    existingUnits: 0,
    existingFloorAreaM2: 0,
    existingHeightM: 0,
    landUse: 'VACANT',
    eligible: true,
    neighborhood: 'Mission'
  };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
];

const W = 7.62; // 25 ft
const D = 30.48; // 100 ft

const fixtures: Record<string, { parcels: Lot[]; excluded?: Lot }> = {
  // Two lots sharing a long edge; the second is slightly larger.
  pair: {
    parcels: [
      { id: '3604001', ring: rect(0, 0, W, D) },
      { id: '3604002', ring: rect(W, 0, W + 7.9, D) }
    ]
  },
  // Four lots in a row; the third is L-shaped and the fourth fills its notch and runs past it.
  row: {
    parcels: [
      { id: '3605001', ring: rect(0, 0, W, D) },
      { id: '3605002', ring: rect(W, 0, 2 * W, D) },
      {
        id: '3605003',
        ring: [
          [2 * W, 0],
          [25, 0],
          [25, 12],
          [20, 12],
          [20, D],
          [2 * W, D]
        ]
      },
      { id: '3605004', ring: rect(20, 12, 27.62, D) }
    ]
  },
  // Two lots 20 m apart (a street); the first is the larger.
  street: {
    parcels: [
      { id: '3606001', ring: rect(0, 0, 10, 30) },
      { id: '3606002', ring: rect(30, 0, 36, 30) }
    ]
  },
  // Three project lots wrapping a fourth, non-project lot completely: it is a hole in the union.
  courtyard: {
    parcels: [
      {
        id: '3607001',
        ring: [
          [0, 0],
          [30, 0],
          [30, 12],
          [12, 12],
          [12, 30],
          [0, 30]
        ]
      },
      { id: '3607002', ring: rect(12, 22, 30, 30) },
      { id: '3607003', ring: rect(22, 12, 30, 22) }
    ],
    excluded: { id: '3607004', ring: rect(12, 12, 22, 22) }
  }
};

for (const [name, { parcels, excluded }] of Object.entries(fixtures)) {
  const out = { parcels: parcels.map(record), ...(excluded ? { excluded: record(excluded) } : {}) };
  writeFileSync(
    fileURLToPath(new URL(`./assembly-${name}.json`, import.meta.url)),
    JSON.stringify(out, null, 2) + '\n'
  );
  console.log(`assembly-${name}.json: ${out.parcels.length} parcels`);
}
