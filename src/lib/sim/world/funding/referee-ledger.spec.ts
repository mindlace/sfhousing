// The always-on half of the tolerance referee (signoff): the ledger identities E1 to E7 of the
// finance-engine spec after every step, to month 480, on the bench city (`synthCity`) with its
// baseline money and with the bench funding set, and on the e2e fixture city (fixture-0) with its
// baseline funding. Nothing statistical and no comparison with today's engine: that is the full
// 200-seed referee, held pending the partner's ruling on the bench-set awards miss; it will land as
// `tolerance.referee.spec.ts` behind `SFH_WORLD_FUNDING_REFEREE=1` (with `SFH_WORLD_LIVE` for the
// live case). See docs/dev/world-funding.md, Tolerance referee.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SimInput } from '$lib/sim/scenario/types';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { fixtureInput } from '../test/cities.node';
import { benchFunded } from './test/cities.node';
import { moneyTimeline, runFunded, withBaselineMoney } from './test/fixtures';
import { checkStep, type StepSums } from './test/identities';

const SEEDS = [1, 2, 3];
/** 40 years of model months. */
const MONTHS = 480;

interface City {
  statics: Statics;
  timeline: PolicyTimeline;
}

const cityOf = (input: SimInput, doc: SimPolicy4): City => ({
  statics: staticsOf(input),
  timeline: moneyTimeline(input, doc)
});

/** Seed `seed` to month 480 with E1 to E7 checked after every step; the ledger's commits. */
function checkedRun(c: City, seed: number): { steps: number; commits: number } {
  let prev: StepSums | null = null;
  let steps = 0;
  const { ledger } = runFunded(c.statics, c.timeline, seed, MONTHS, {
    afterStep(w, m, ledger) {
      prev = checkStep(ledger, w, c.timeline.frameAt(m).finance!, prev);
      steps++;
    }
  });
  return { steps, commits: ledger.filter((e) => e.kind === 'commit').length };
}

describe.each([['baseline'], ['bench']] as const)('synthCity, %s money', (set) => {
  let c: City;
  beforeAll(() => {
    const { input, doc } = benchFunded(set);
    c = cityOf(input, doc);
  });

  it.each(SEEDS)(`synthCity ${set} seed %i: E1-E7 after every step to month 480`, (seed) => {
    const got = checkedRun(c, seed);
    expect(got.steps).toBe(MONTHS);
    // Not vacuous: money is awarded on the bench city in every seed.
    expect(got.commits).toBeGreaterThan(0);
  });
});

describe('fixture-0, baseline funding', () => {
  let c: City;
  beforeAll(async () => {
    const input = withBaselineMoney(await fixtureInput());
    expect(input.finance).toBeDefined();
    c = cityOf(input, DEFAULT_POLICY4);
  });

  it.each(SEEDS)('fixture-0 seed %i: E1-E7 after every step to month 480', (seed) => {
    const got = checkedRun(c, seed);
    expect(got.steps).toBe(MONTHS);
    expect(c.timeline.frameAt(MONTHS).finance).not.toBeNull();
    // Not vacuous: the fixture city's baseline money is awarded too.
    expect(got.commits).toBeGreaterThan(0);
  });
});
