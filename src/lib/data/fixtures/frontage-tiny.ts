import type { Provenance } from '../../timelapse/types';
import { idsHash } from '../column-file';
import type { Frontage } from '../frontage-codec';
import type { ScenarioParcels } from '../scenario-codec';

type Tiny = Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion'>;

const NAMES = ['FIXTURE AVE', 'MISSION ST'];
// Fixture values only (tier 4, made up for the codec tests): not data. Segments 0 and 1 are
// MISSION ST (arterial), segment 2 is FIXTURE AVE (residential).
const SEG_CNN = [1001, 1002, 2001];
const SEG_NAME = [1, 1, 0];
const SEG_CLASS = [3, 3, 5];
/** Row 1 is the corner lot: fronts MISSION ST (seg 0) and FIXTURE AVE (seg 2), both at depth 0. */
export const CORNER_ROW = 1;
/** Row 3 sits one lot back from MISSION ST (seg 1). Every other row has no entries. */
export const DEEP_ROW = 3;
const ENTRIES: Record<number, [seg: number, depth: number][]> = {
  [CORNER_ROW]: [
    [0, 0],
    [2, 0]
  ],
  [DEEP_ROW]: [[1, 1]]
};

const provenance: Provenance = {
  tier: 4,
  label: 'Frontage',
  sources: [{ label: 'frontage-tiny fixture', url: 'https://example.org/fixture' }],
  method: 'Hand-written codec fixture; not data.'
};

/** A frontage file for `tiny` (any row count above DEEP_ROW). */
export function frontageTiny(tiny: Tiny): Frontage {
  if (tiny.count <= DEEP_ROW) throw new Error(`frontageTiny needs more than ${DEEP_ROW} parcels`);
  const rowStart = new Uint32Array(tiny.count + 1);
  const seg: number[] = [];
  const depth: number[] = [];
  for (let i = 0; i < tiny.count; i++) {
    for (const [s, d] of ENTRIES[i] ?? []) {
      seg.push(s);
      depth.push(d);
    }
    rowStart[i + 1] = seg.length;
  }
  return {
    format: 'sfh-frontage/1',
    datasetVersion: tiny.datasetVersion,
    count: tiny.count,
    idsHash: idsHash(tiny.id),
    provenance,
    names: NAMES,
    segCnn: Uint32Array.from(SEG_CNN),
    segName: Uint16Array.from(SEG_NAME),
    segClass: Uint8Array.from(SEG_CLASS),
    rowStart,
    frontSeg: Uint16Array.from(seg),
    frontDepth: Uint8Array.from(depth)
  };
}
