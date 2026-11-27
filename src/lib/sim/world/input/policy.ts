// The T9 policy-lever seam (spec §5, §4.4.8): a `PolicyOp` rewrites the calibration and the
// decoded parcels; `applyPolicies` is the single place a lever plugs in. This package ships
// exactly one op, `baseZoning`, the old-zoning counterfactual that pairs every FZP run with a
// twin. No user-facing levers. Worker-safe and pure.
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { Calibration } from '$lib/timelapse/types';
import type { SimInput } from './types';

/** One lever: a pure rewrite of the calibration and the parcels. */
export type PolicyOp = (
  cal: Calibration,
  parcels: ScenarioParcels
) => { cal: Calibration; parcels: ScenarioParcels };

/**
 * The old-zoning counterfactual (§4.4.8). The calibration is returned as the same object. The
 * parcels are a view over the same decoded columns (no column is copied or mutated): base
 * envelope, cap and hostability in the `fzp` slots (the engine reads the envelope and cap only
 * through `fzp`, so it needs no 'base' branch; its start features come from the choice row
 * there). The Local Program is off, so new projects
 * take the measured `pathwayForNew`; its all-zero column is the view's only new buffer.
 */
export const baseZoning: PolicyOp = (cal, parcels) => ({
  cal,
  parcels: {
    ...parcels,
    envelopeStories: parcels.baseStories,
    fzpCap: parcels.baseCap,
    hostable: parcels.hostableBase,
    localProgram: new Uint8Array(parcels.count)
  }
});

/**
 * Applies `ops` in order to the input's calibration and parcels and returns a NEW SimInput (so
 * identity-keyed precompute never aliases the original's). Projects and `asOf` are shared.
 */
export function applyPolicies(ops: readonly PolicyOp[], input: SimInput): SimInput {
  let cal = input.calibration;
  let parcels = input.parcels;
  for (const op of ops) ({ cal, parcels } = op(cal, parcels));
  return { ...input, calibration: cal, parcels };
}
