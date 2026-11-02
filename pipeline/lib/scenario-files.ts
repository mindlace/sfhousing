// Scenario file paths (scenario-data spec §4.8), kept free of the DuckDB step so the invariant
// checker can import them cheaply.

/** The T11 file, relative to the dataset's out dir. */
export const PARCELS_BIN = 'scenarios/fzp/parcels.bin';
/** sfh-policy/1 per-lot policy inputs, in parcels.bin row order (sim data layers). */
export const POLICY_BIN = 'scenarios/fzp/policy.bin';
/** /lesscars outputs (docs/dev/lesscars.md), relative to the dataset's out dir. */
export const LESSCARS_FILES = {
  plan: 'scenarios/lesscars/plan.json',
  sites: 'scenarios/lesscars/sites.json',
  summary: 'scenarios/lesscars/summary.json',
  timeline: 'scenarios/lesscars/timeline.bin'
} as const;
/** The golden's canonical dump of the decoded timeline. */
export const LESSCARS_TIMELINE_DUMP = 'scenarios/lesscars/timeline.decoded.json';
