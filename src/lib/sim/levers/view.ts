/**
 * Presents a resolved envelope table to the existing simulation: a `ScenarioParcels` view and a
 * `PolicyOp` (plan 2 Task 5). Follows `baseZoning`: no source column is mutated, and the view
 * reuses the source columns except the derived ones and an after-switch Local Program column that
 * is masked into a fresh array. The engine reads features only through the `fzp` slots, so the
 * table lands there. Worker-safe.
 */
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { PolicyOp } from '../scenario/policy';
import { sb79WinsAfter, type EnvelopeTable, type LayerCtx, type Period } from './layers';
import type { SimLevers } from './types';

/**
 * The Local Program column for a period (ruling 3, partner Call 22). Local Program lots are
 * forced onto streamlined when `localProgramStreamlined` is set and the `fzp` layer is on, or
 * `currentLaw` is on (it contains the FZP map), except after the switch where current law takes
 * the SB 79 row (`sb79WinsAfter`) and the Alternative Plan is not kept: there the lot follows the
 * route shares. With `fzp` on, forcing applies in both periods. Otherwise all zero, as in
 * `baseZoning`.
 */
export function localProgramColumn(ctx: LayerCtx, levers: SimLevers, period: Period): Uint8Array {
  const { parcels } = ctx;
  const out = new Uint8Array(parcels.count);
  if (!levers.localProgramStreamlined) return out;
  if (levers.stock.includes('fzp')) return parcels.localProgram;
  if (!levers.stock.includes('currentLaw')) return out;
  if (period === 'before' || levers.assumeAlternativePlanKept) return parcels.localProgram;
  const wins = sb79WinsAfter(ctx);
  for (let i = 0; i < out.length; i++) out[i] = wins[i] ? 0 : parcels.localProgram[i];
  return out;
}

/** `parcels` with the table's envelope, yields and hostability in the `fzp` slots. */
export function parcelsView(
  parcels: ScenarioParcels,
  t: EnvelopeTable,
  localProgram: Uint8Array
): ScenarioParcels {
  const n = parcels.count;
  const F = parcels.fillLevels.length;
  // Same formulas as the decoder (scenario-codec.ts), so the columns are bit-identical.
  const ratio = new Float32Array(n);
  const gap = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    ratio[i] = t.yield[i * F + F - 1] / Math.max(parcels.existingUnits[i], 1);
    gap[i] = t.stories[i] - parcels.existingStories[i];
  }
  return {
    ...parcels,
    envelopeStories: t.stories,
    yield: t.yield,
    hostable: t.hostable,
    localProgram,
    potentialRatio: { fzp: ratio, base: parcels.potentialRatio.base },
    storiesGap: { fzp: gap, base: parcels.storiesGap.base }
  };
}

/** The op: the calibration is returned as the same object. */
export function envelopeOp(t: EnvelopeTable, localProgram: Uint8Array): PolicyOp {
  return (cal, parcels) => ({ cal, parcels: parcelsView(parcels, t, localProgram) });
}
