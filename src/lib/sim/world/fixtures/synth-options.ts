// Synthetic option tables for the fixtures with no parcel records (the bench city, the tiny
// queue, the compile fixtures): one option per story count, typed by height. Fixture values only
// (tier 4, made up): not the generator's buildings. Browser-safe.
import { optionTableOf, type OptionTable } from '$lib/data/option-table';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { Option } from '$lib/sim/choice/types';

/** Type V to 6 stories, Type III to 8, Type I above (the types' story ranges). */
function optionAt(stories: number, homes: number): Option {
  if (stories <= 6) return { type: 'V', form: 'walkup', stories, homes, plates: 0 };
  if (stories <= 8) return { type: 'III', form: 'midrise', stories, homes, plates: 0 };
  return { type: 'I', form: 'block', stories, homes, plates: 0 };
}

/**
 * Per row of `p`, one option for each story count from 1 to `top(i)` with `homes(i, stories)`
 * homes (an option with no home is left out), at location value `locationValue`.
 */
export function synthOptions(
  p: ScenarioParcels,
  top: (i: number) => number,
  homes: (i: number, stories: number) => number,
  locationValue = 1
): OptionTable {
  const rows = p.id.map((_, i) => {
    const options: Option[] = [];
    for (let s = 1; s <= top(i); s++) {
      const h = homes(i, s);
      if (h > 0) options.push(optionAt(s, h));
    }
    return { options, locationValue };
  });
  return optionTableOf(p.datasetVersion, rows);
}
