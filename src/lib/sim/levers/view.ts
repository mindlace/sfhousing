/**
 * Presents a resolved envelope table to the existing simulation: a `ScenarioParcels` view and a
 * `PolicyOp` (plan 2 Task 5). Follows `baseZoning`: no source column is mutated, and the view
 * reuses the source columns except the envelope, the cap and the hosting flag (and an all-zero
 * Local Program column when streamlining is off). The engine reads the envelope through the `fzp`
 * slots, so the table lands there; the start features come from the choice row at that envelope
 * and cap (`precomputeOf`). Worker-safe.
 */
import type { OptionTable } from '$lib/data/option-table';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { allowedCount, capFrom, mostHomes } from '$lib/sim/choice/choose';
import type { PolicyOp } from '../world/input/policy';
import type { EnvelopeTable, LayerCtx } from './layers';
import type { SimLevers } from './types';

/**
 * The Local Program column (partner Call 22): the decoded column when Local Program lots are
 * forced onto streamlined (`localProgramStreamlined`), otherwise all zero, as in `baseZoning`.
 */
export function localProgramColumn(ctx: LayerCtx, levers: SimLevers): Uint8Array {
  return levers.localProgramStreamlined
    ? ctx.parcels.localProgram
    : new Uint8Array(ctx.parcels.count);
}

/**
 * `parcels` with the table's envelope and cap in the `fzp` slots, hosting where the table allows
 * it and some option the envelope allows gains a home over the existing ones after the cap (so a
 * lot whose cap is at or below its homes, or whose envelope allows no option, hosts nothing).
 */
export function parcelsView(
  parcels: ScenarioParcels,
  t: EnvelopeTable,
  localProgram: Uint8Array,
  options: OptionTable
): ScenarioParcels {
  const n = parcels.count;
  const hostable = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (t.hostable[i] !== 1) continue;
    const allowed = allowedCount(options, i, t.stories[i]);
    const best = mostHomes(options, i, allowed, capFrom(t.cap[i]), parcels.existingUnits[i]);
    hostable[i] = best >= 0 ? 1 : 0;
  }
  return {
    ...parcels,
    envelopeStories: t.stories,
    fzpCap: t.cap,
    hostable,
    localProgram
  };
}

/** The op: the calibration is returned as the same object. */
export function envelopeOp(
  t: EnvelopeTable,
  localProgram: Uint8Array,
  options: OptionTable
): PolicyOp {
  return (cal, parcels) => ({ cal, parcels: parcelsView(parcels, t, localProgram, options) });
}
