// Zone transit access: the homes-weighted mean of the access grid (src/lib/transit/grid.ts) at the
// zone's lots, the choice model's access covariate.
import type { TransitNetwork } from '../../../src/lib/data/transit';
import { accessAt, buildAccessGrid, type AccessGrid } from '../../../src/lib/transit/grid';
import type { TransitYears } from '../../steps/transit';
import type { OperatorId } from '../../transit-config';

/**
 * Per zone: sum(homes x access at the lot) / sum(homes) over its lots. A zone with lots but no
 * homes takes the plain mean over its lots; a zone with no lot gets 0.
 */
export function zoneAccess(
  grid: AccessGrid,
  lotZone: Int32Array,
  homes: Int32Array,
  lngLat: Float64Array,
  zones: number
): Float64Array {
  const sum = new Float64Array(zones);
  const weight = new Float64Array(zones);
  const plain = new Float64Array(zones);
  const lots = new Int32Array(zones);
  for (let i = 0; i < lotZone.length; i++) {
    const z = lotZone[i];
    if (z < 0) continue;
    const a = accessAt(grid, [lngLat[2 * i], lngLat[2 * i + 1]]);
    sum[z] += homes[i] * a;
    weight[z] += homes[i];
    plain[z] += a;
    lots[z]++;
  }
  const out = new Float64Array(zones);
  for (let z = 0; z < zones; z++)
    out[z] = weight[z] > 0 ? sum[z] / weight[z] : lots[z] > 0 ? plain[z] / lots[z] : 0;
  return out;
}

export interface YearAccess {
  year: number;
  /** Per zone, as `zoneAccess`. */
  access: Float64Array;
  /** The year of the feeds used (a year without one holds at the earliest later year). */
  sourceYear: number;
  sources: Partial<Record<OperatorId, number>>;
}

/**
 * Zone access for each year of the back-cast, from the network that stands for it
 * (`transitByYear`). Years sharing a network share one grid; each year gets its own array.
 */
export function accessByYear(
  db: TransitYears,
  years: number[],
  lotZone: Int32Array,
  homes: Int32Array,
  lngLat: Float64Array,
  zones: number
): YearAccess[] {
  const done = new Map<TransitNetwork, Float64Array>();
  return years.map((year) => {
    const { network, sourceYear, sources } = db.networkFor(year);
    let access = done.get(network);
    if (!access) {
      access = zoneAccess(buildAccessGrid(network), lotZone, homes, lngLat, zones);
      done.set(network, access);
    }
    return { year, access: Float64Array.from(access), sourceYear, sources };
  });
}
