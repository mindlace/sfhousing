import type { Provenance } from '../../timelapse/types';
import { FILL_LEVELS, type ScenarioParcels } from '../scenario-codec';

interface Row {
  id: string;
  cell: number;
  lngLat: [number, number];
  district: number;
  envelopeStories: number;
  baseStories: number;
  localProgram: number;
  hostable: number;
  split: number;
  imputed: number;
  baseCap: number;
  existingUnits: number;
  existingStories: number;
  lotAreaM2: number;
  yearBuilt: number;
  improvementShare: number;
  rentControlLikely: number;
  landUseClass: number;
  hostableBase: number;
  baseYield: number[];
  yield: number[];
}

// Fixture values only (tier 4, made up for the codec tests): not data.
const ROWS: Row[] = [
  // Local Program parcel: FZP yield (no cap, 6 stories) differs from the capped base yield.
  {
    id: '0026T001A',
    cell: 0,
    lngLat: [-122.4194155, 37.7749295],
    district: 2,
    envelopeStories: 6,
    baseStories: 4,
    localProgram: 1,
    hostable: 1,
    split: 0,
    imputed: 0,
    baseCap: 12,
    existingUnits: 2,
    existingStories: 2,
    lotAreaM2: 450,
    yearBuilt: 1925,
    improvementShare: 70 / 200,
    rentControlLikely: 1,
    landUseClass: 1,
    hostableBase: 1,
    baseYield: [0, 3, 4, 4, 4],
    yield: [0, 4, 8, 8, 10]
  },
  // No roll row: every imputed bit set (0, 1, 2, 4); no density cap.
  {
    id: '3512001',
    cell: 0,
    lngLat: [-122.4103, 37.7621],
    district: 1,
    envelopeStories: 4,
    baseStories: 4,
    localProgram: 0,
    hostable: 1,
    split: 1,
    imputed: 0b10111,
    baseCap: 0xffff,
    existingUnits: 0,
    existingStories: 0,
    lotAreaM2: 230,
    yearBuilt: 0,
    improvementShare: 0,
    rentControlLikely: 0,
    landUseClass: 5,
    hostableBase: 1,
    baseYield: [2, 3, 5, 6, 6],
    yield: [2, 3, 5, 6, 6]
  },
  // Vacant lot.
  {
    id: '3512002',
    cell: 0,
    lngLat: [-122.4102, 37.762],
    district: 1,
    envelopeStories: 4,
    baseStories: 4,
    localProgram: 0,
    hostable: 1,
    split: 0,
    imputed: 0b00100,
    baseCap: 3,
    existingUnits: 0,
    existingStories: 0,
    lotAreaM2: 210,
    yearBuilt: 0,
    improvementShare: 1 / 200,
    rentControlLikely: 0,
    landUseClass: 4,
    hostableBase: 1,
    baseYield: [1, 2, 3, 3, 3],
    yield: [1, 2, 3, 3, 3]
  },
  // First row of the second cell: front-coded against 3512002 across the cell boundary.
  {
    id: '3512008',
    cell: 1,
    lngLat: [-122.4099, 37.7618],
    district: 1,
    envelopeStories: 4,
    baseStories: 4,
    localProgram: 0,
    hostable: 0,
    split: 0,
    imputed: 0,
    baseCap: 2,
    existingUnits: 6,
    existingStories: 3,
    lotAreaM2: 280,
    yearBuilt: 1962,
    improvementShare: 120 / 200,
    rentControlLikely: 1,
    landUseClass: 0,
    hostableBase: 0,
    baseYield: [0, 0, 0, 0, 0],
    yield: [0, 0, 0, 0, 0]
  },
  // Commercial Local Program parcel with a tall envelope and no base cap.
  {
    id: '3512010',
    cell: 1,
    lngLat: [-122.4097, 37.7617],
    district: 2,
    envelopeStories: 24,
    baseStories: 8,
    localProgram: 1,
    hostable: 1,
    split: 0,
    imputed: 0b00010,
    baseCap: 0xffff,
    existingUnits: 1,
    existingStories: 1,
    lotAreaM2: 1800,
    yearBuilt: 1950,
    improvementShare: 15 / 200,
    rentControlLikely: 0,
    landUseClass: 2,
    hostableBase: 1,
    baseYield: [8, 16, 24, 28, 32],
    yield: [40, 90, 135, 160, 182]
  },
  // Outside every height district: no envelope, not hostable.
  {
    id: '8711023C',
    cell: 1,
    lngLat: [-122.3901234, 37.7301234],
    district: 0,
    envelopeStories: 0,
    baseStories: 0,
    localProgram: 0,
    hostable: 0,
    split: 0,
    imputed: 0,
    baseCap: 0xffff,
    existingUnits: 0,
    existingStories: 0,
    lotAreaM2: 95,
    yearBuilt: 1990,
    improvementShare: 200 / 200,
    rentControlLikely: 0,
    landUseClass: 3,
    hostableBase: 0,
    baseYield: [0, 0, 0, 0, 0],
    yield: [0, 0, 0, 0, 0]
  }
];

const prov = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [{ label: 'scenario-tiny fixture', url: 'https://example.org/fixture' }],
  method: 'Hand-written codec fixture; not data.'
});

/** Six rows over two cells, every column populated, derived arrays and `index` filled in. */
export function scenarioTiny(): ScenarioParcels {
  const n = ROWS.length;
  const f = FILL_LEVELS.length;
  const col = <T extends { [k: number]: number }>(
    make: new (len: number) => T,
    pick: (r: Row) => number
  ): T => {
    const a = new make(n);
    ROWS.forEach((r, i) => (a[i] = pick(r)));
    return a;
  };
  const perFill = (pick: (r: Row) => number[]) => {
    const a = new Uint16Array(n * f);
    ROWS.forEach((r, i) => a.set(pick(r), i * f));
    return a;
  };
  const yieldCol = perFill((r) => r.yield);
  const baseYield = perFill((r) => r.baseYield);
  const ratio = (y: Uint16Array) =>
    col(Float32Array, (r) => y[ROWS.indexOf(r) * f + f - 1] / Math.max(r.existingUnits, 1));
  return {
    format: 'sfh-scenario/1',
    datasetVersion: 'fixture-0',
    scenario: 'fzp',
    rollYear: 2025,
    count: n,
    fillLevels: [...FILL_LEVELS],
    cells: [
      { cellId: '-1_0', start: 0, count: 3 },
      { cellId: '0_0', start: 3, count: 3 }
    ],
    districts: ['', '40-X', '65-A'],
    provenance: {
      envelope: prov('Envelope'),
      localProgram: prov('Local Program'),
      features: prov('Features'),
      existingUnits: { ...prov('Existing units'), n: 6, window: ['2025-01-01', '2025-12-31'] },
      yield: prov('Yield')
    },
    id: ROWS.map((r) => r.id),
    index: new Map(ROWS.map((r, i) => [r.id, i])),
    labelPoint: Float64Array.from(ROWS.flatMap((r) => r.lngLat)),
    cell: col(Uint16Array, (r) => r.cell),
    district: col(Uint16Array, (r) => r.district),
    envelopeStories: col(Uint8Array, (r) => r.envelopeStories),
    baseStories: col(Uint8Array, (r) => r.baseStories),
    localProgram: col(Uint8Array, (r) => r.localProgram),
    hostable: col(Uint8Array, (r) => r.hostable),
    split: col(Uint8Array, (r) => r.split),
    imputed: col(Uint8Array, (r) => r.imputed),
    baseCap: col(Uint16Array, (r) => r.baseCap),
    existingUnits: col(Uint16Array, (r) => r.existingUnits),
    existingStories: col(Uint8Array, (r) => r.existingStories),
    lotAreaM2: col(Uint32Array, (r) => r.lotAreaM2),
    yearBuilt: col(Uint16Array, (r) => r.yearBuilt),
    improvementShare: col(Float32Array, (r) => r.improvementShare),
    rentControlLikely: col(Uint8Array, (r) => r.rentControlLikely),
    landUseClass: col(Uint8Array, (r) => r.landUseClass),
    hostableBase: col(Uint8Array, (r) => r.hostableBase),
    baseYield,
    yield: yieldCol,
    potentialRatio: { fzp: ratio(yieldCol), base: ratio(baseYield) },
    storiesGap: {
      fzp: col(Int16Array, (r) => r.envelopeStories - r.existingStories),
      base: col(Int16Array, (r) => r.baseStories - r.existingStories)
    }
  };
}
