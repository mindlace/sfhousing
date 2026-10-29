// Scenario file paths (scenario-data spec §4.8), kept free of the DuckDB step so the invariant
// checker can import them cheaply.

/** The T11 file, relative to the dataset's out dir. */
export const PARCELS_BIN = 'scenarios/fzp/parcels.bin';
/** sfh-policy/1 per-lot policy inputs, in parcels.bin row order (sim data layers). */
export const POLICY_BIN = 'scenarios/fzp/policy.bin';
/** sfh-frontage/1 lot-to-street frontage (sim data layers). */
export const FRONTAGE_BIN = 'scenarios/fzp/frontage.bin';
