// Node only (reads files through world-core's `test/cities.node.ts`): the cities with public money
// that the tolerance test runs.
import type { SimInput } from '$lib/sim/scenario/types';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import { benchInput, liveInput } from '../../test/cities.node';
import { benchSet, withBaselineMoney } from './fixtures';

/**
 * The bench city with the bench calibration (`compile.perf.spec.ts:140-150`); `'bench'` adds
 * `benchFundingLevers` (`u-` ids) as the money document, which both engines run.
 */
export function benchFunded(set: 'baseline' | 'bench'): { input: SimInput; doc: SimPolicy4 } {
  return benchSet(benchInput(), set);
}

/** A dataset directory with its baseline funding re-added (`scenario/input.ts:85-93`). */
export async function liveFunded(dir: string): Promise<{ input: SimInput; doc: SimPolicy4 }> {
  const input = withBaselineMoney(await liveInput(dir));
  if (input.finance === undefined) throw new Error(`liveFunded: no baseline funding in ${dir}`);
  return { input, doc: DEFAULT_POLICY4 };
}
