// The mini city's gross table (`scenarios/fzp/gross.bin`): every row built by the pipeline rule,
// `grossRowOf` on `scenarioRecordOf(p, i, rec)`, so a table lookup equals the recompute's yield.
// Fixture values derived from the made-up mini city (tier 4): not data. Browser-safe (no `node:`).
import type { ParcelId } from '$lib/data/parcel';
import { grossRowOf, grossTableOf, type GrossTable } from '$lib/data/gross-table';
import { scenarioRecordOf } from '$lib/data/scenario-codec';
import { MINI_VERSION, type miniCity } from './mini-parcels';

/** Where the harness serves the mini gross.bin (in the manifest with its `gross` option). */
export const MINI_GROSS_URL = `/data/${MINI_VERSION}/scenarios/fzp/gross.bin`;

export function miniGross(city: ReturnType<typeof miniCity>): GrossTable {
  const p = city.parcels;
  const rows = Array.from({ length: p.count }, (_, i) => {
    const id = p.id[i] as ParcelId;
    const rec = city.records.get(id);
    if (!rec) throw new Error(`mini-gross: no record for ${id}`);
    return grossRowOf(scenarioRecordOf(p, i, rec));
  });
  return grossTableOf(p.datasetVersion, rows);
}
