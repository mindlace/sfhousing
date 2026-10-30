// One envelope row, shared by the pipeline (parcels.bin, policy.bin) and the /sim worker's user layer.
import { FILL_LEVELS, fillStories } from './scenario-codec';
import { capScenarioYield } from './scenario-yield';

export interface EnvelopeRow {
  stories: number;
  cap: number | null;
  yield: number[];
  hostable: boolean;
}

/**
 * One envelope as parcels.bin computes FZP's: each fill level's yield is `capScenarioYield` of
 * the gross at `fillStories(fill, stories)` (0 with no envelope); `hostable` is eligible, at
 * least one story and an uncapped full-fill gross above 0.
 */
export function envelopeRow(a: {
  stories: number;
  cap: number | null;
  eligible: boolean;
  existingUnits: number;
  grossAt: (stories: number) => number;
}): EnvelopeRow {
  const at = (f: number) => (a.stories === 0 ? 0 : a.grossAt(fillStories(f, a.stories)));
  return {
    stories: a.stories,
    cap: a.cap,
    yield: FILL_LEVELS.map((f) => capScenarioYield(at(f), a.cap, a.existingUnits)),
    hostable: a.eligible && a.stories >= 1 && at(FILL_LEVELS[FILL_LEVELS.length - 1]) > 0
  };
}
