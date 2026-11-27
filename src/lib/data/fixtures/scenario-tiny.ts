import type { Provenance } from '../../timelapse/types';
import type { ScenarioParcels } from '../scenario-codec';

interface Row {
  id: string;
  cell: number;
  lngLat: [number, number];
  district: number;
  envelopeStories: number;
  baseStories: number;
  localProgram: number;
  hostable: number;
  eligible: number;
  split: number;
  imputed: number;
  baseCap: number;
  existingUnits: number;
  existingFloorAreaM2: number;
  existingStories: number;
  lotAreaM2: number;
  yearBuilt: number;
  improvementShare: number;
  rentControlLikely: number;
  landUseClass: number;
  hostableBase: number;
}

// Fixture values only (tier 4, made up for the codec tests): not data.
const ROWS: Row[] = [
  // Local Program parcel: the FZP envelope (6 stories, no cap) differs from the capped base one.
  {
    id: '0026T001A',
    cell: 0,
    lngLat: [-122.4194155, 37.7749295],
    district: 2,
    envelopeStories: 6,
    baseStories: 4,
    localProgram: 1,
    hostable: 1,
    eligible: 1,
    split: 0,
    imputed: 0,
    baseCap: 12,
    existingUnits: 2,
    existingFloorAreaM2: 186,
    existingStories: 2,
    lotAreaM2: 450,
    yearBuilt: 1925,
    improvementShare: 70 / 200,
    rentControlLikely: 1,
    landUseClass: 1,
    hostableBase: 1
  },
  // No roll row: imputed 95 (bits 0-4 and 6, the RA1 no-row mask); no density cap.
  {
    id: '3512001',
    cell: 0,
    lngLat: [-122.4103, 37.7621],
    district: 1,
    envelopeStories: 4,
    baseStories: 4,
    localProgram: 0,
    hostable: 1,
    eligible: 1,
    split: 1,
    imputed: 0b1011111,
    baseCap: 0xffff,
    existingUnits: 0,
    existingFloorAreaM2: 0,
    existingStories: 0,
    lotAreaM2: 230,
    yearBuilt: 0,
    improvementShare: 0,
    rentControlLikely: 0,
    landUseClass: 5,
    hostableBase: 1
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
    eligible: 1,
    split: 0,
    imputed: 0b00100,
    baseCap: 3,
    existingUnits: 0,
    existingFloorAreaM2: 0,
    existingStories: 0,
    lotAreaM2: 210,
    yearBuilt: 0,
    improvementShare: 1 / 200,
    rentControlLikely: 0,
    landUseClass: 4,
    hostableBase: 1
  },
  // First row of the second cell: front-coded against 3512002 across the cell boundary. Its floor
  // area is the u32 ceiling, 2^32 - 1. Not eligible (an OPENSPACE chunk record), so not hostable.
  {
    id: '3512008',
    cell: 1,
    lngLat: [-122.4099, 37.7618],
    district: 1,
    envelopeStories: 4,
    baseStories: 4,
    localProgram: 0,
    hostable: 0,
    eligible: 0,
    split: 0,
    imputed: 0,
    baseCap: 2,
    existingUnits: 6,
    existingFloorAreaM2: 0xffffffff,
    existingStories: 3,
    lotAreaM2: 280,
    yearBuilt: 1962,
    improvementShare: 120 / 200,
    rentControlLikely: 1,
    landUseClass: 0,
    hostableBase: 0
  },
  // Commercial Local Program parcel with a tall envelope and no base cap. Its chunk record has no
  // land-use row (`landUse` 'NONE', `eligible: false`), but the roll shows a home, so it is
  // eligible in the scenario (T14 sd.landuse.none-with-units, flags bit 5).
  {
    id: '3512010',
    cell: 1,
    lngLat: [-122.4097, 37.7617],
    district: 2,
    envelopeStories: 24,
    baseStories: 8,
    localProgram: 1,
    hostable: 1,
    eligible: 1,
    split: 0,
    imputed: 0b00010,
    baseCap: 0xffff,
    existingUnits: 1,
    existingFloorAreaM2: 1250,
    existingStories: 1,
    lotAreaM2: 1800,
    yearBuilt: 1950,
    improvementShare: 15 / 200,
    rentControlLikely: 0,
    landUseClass: 2,
    hostableBase: 1
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
    eligible: 1,
    split: 0,
    imputed: 0,
    baseCap: 0xffff,
    existingUnits: 0,
    existingFloorAreaM2: 77,
    existingStories: 0,
    lotAreaM2: 95,
    yearBuilt: 1990,
    improvementShare: 200 / 200,
    rentControlLikely: 0,
    landUseClass: 3,
    hostableBase: 0
  }
];

const prov = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [{ label: 'scenario-tiny fixture', url: 'https://example.org/fixture' }],
  method: 'Hand-written codec fixture; not data.'
});

/** Six rows over two cells, every column populated and `index` filled in. */
export function scenarioTiny(): ScenarioParcels {
  const n = ROWS.length;
  const col = <T extends { [k: number]: number }>(
    make: new (len: number) => T,
    pick: (r: Row) => number
  ): T => {
    const a = new make(n);
    ROWS.forEach((r, i) => (a[i] = pick(r)));
    return a;
  };
  return {
    format: 'sfh-scenario/2',
    datasetVersion: 'fixture-0',
    scenario: 'fzp',
    rollYear: 2025,
    count: n,
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
      cap: prov('Cap')
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
    eligible: col(Uint8Array, (r) => r.eligible),
    split: col(Uint8Array, (r) => r.split),
    imputed: col(Uint8Array, (r) => r.imputed),
    baseCap: col(Uint16Array, (r) => r.baseCap),
    existingUnits: col(Uint16Array, (r) => r.existingUnits),
    existingFloorAreaM2: col(Uint32Array, (r) => r.existingFloorAreaM2),
    existingStories: col(Uint8Array, (r) => r.existingStories),
    lotAreaM2: col(Uint32Array, (r) => r.lotAreaM2),
    yearBuilt: col(Uint16Array, (r) => r.yearBuilt),
    improvementShare: col(Float32Array, (r) => r.improvementShare),
    rentControlLikely: col(Uint8Array, (r) => r.rentControlLikely),
    landUseClass: col(Uint8Array, (r) => r.landUseClass),
    hostableBase: col(Uint8Array, (r) => r.hostableBase),
    // the FZP cap: none on a Local Program parcel, the base cap elsewhere
    fzpCap: col(Uint16Array, (r) => (r.localProgram ? 0xffff : r.baseCap))
  };
}
