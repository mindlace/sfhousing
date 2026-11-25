// Zone transit access: the homes-weighted mean of the access grid (src/lib/transit/grid.ts) at the
// zone's lots, the choice model's access covariate.
import { accessAt, type AccessGrid } from '../../../src/lib/transit/grid';

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
