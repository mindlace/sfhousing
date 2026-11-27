// The mini city's options.bin: per T11 row, the pruned candidates (choice/options.ts) of its
// scenario record, as the pipeline's options step builds them, and a location value. Fixture
// values only (tier 4, made up): the location values are spread over 0.8 to 1.2 so the choice
// differs between lots. Browser-safe (the cross-engine golden runs in Chromium): no `node:`
// imports.
import { optionTableOf, type OptionTable } from '$lib/data/option-table';
import { scenarioRecordOf } from '$lib/data/scenario-codec';
import { fnv1a32 } from '$lib/generator/seed';
import { candidatesOf, pruneOptions } from '$lib/sim/choice/options';
import { MINI_VERSION, type MiniCity } from './mini-parcels';

/** Where `miniDataset` serves the mini options.bin (in the manifest under `options`). */
export const MINI_OPTIONS_URL = `/data/${MINI_VERSION}/scenarios/fzp/options.bin`;

/** Five tier-4 location values, cycled over the rows. */
const LOCATION_VALUES = [0.8, 0.9, 1, 1.1, 1.2] as const;

let memo: OptionTable | null = null;

/** The mini city's option table (every mini city is the same, so it is built once). */
export function miniOptions(city: MiniCity): OptionTable {
  if (memo) return memo;
  const p = city.parcels;
  const rows = p.id.map((id, i) => {
    const rec = city.records.get(id);
    const options = rec
      ? pruneOptions(candidatesOf(scenarioRecordOf(p, i, rec), fnv1a32(rec.id)))
      : [];
    return { options, locationValue: LOCATION_VALUES[i % LOCATION_VALUES.length] };
  });
  memo = optionTableOf(p.datasetVersion, rows);
  return memo;
}
