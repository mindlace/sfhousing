// What the one chart plots. A leaf module so results.ts and copy.ts can read it without an import
// cycle through chart-model.ts (which re-exports both).

/**
 * Homes, by source (the pipeline and new projects) or the policy's effect alone; Details switches
 * it.
 */
export type ChartLens = 'homes' | 'source' | 'effect';

/** 'effect' without a policy in force falls back to 'homes'. */
export function lensOf(lens: ChartLens, inForce: boolean): ChartLens {
  return lens === 'effect' && !inForce ? 'homes' : lens;
}
