/**
 * Presents a resolved envelope table to the existing simulation: a `ScenarioParcels` view and a
 * `PolicyOp` (plan 2 Task 5). Follows `baseZoning`: no source column is copied or mutated. The
 * engine reads features only through the `fzp` slots, so the table lands there. Worker-safe.
 */
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { PolicyOp } from '../scenario/policy';
import type { EnvelopeTable } from './layers';
import type { SimLevers } from './types';

/**
 * The Local Program column (ruling 3). Local Program lots are forced onto streamlined when
 * `localProgramStreamlined` is set and `fzp` or `currentLaw` is on, since current law contains
 * the FZP map. Otherwise all zero, as in `baseZoning`.
 */
export function localProgramColumn(parcels: ScenarioParcels, levers: SimLevers): Uint8Array {
  const on =
    levers.localProgramStreamlined &&
    (levers.stock.includes('fzp') || levers.stock.includes('currentLaw'));
  return on ? parcels.localProgram : new Uint8Array(parcels.count);
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
