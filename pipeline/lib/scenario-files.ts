// Scenario file paths (scenario-data spec §4.8) and the parcels.bin reader, kept free of the DuckDB
// step so the invariant checker and the gross workers can import them cheaply.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { decodeScenarioPayload, type ScenarioParcels } from '../../src/lib/data/scenario-codec';

/** The T11 file, relative to the dataset's out dir. */
export const PARCELS_BIN = 'scenarios/fzp/parcels.bin';
/** sfh-policy/1 per-lot policy inputs, in parcels.bin row order (sim data layers). */
export const POLICY_BIN = 'scenarios/fzp/policy.bin';
/** sfh-gross/1 per-lot gross units by story count, in parcels.bin row order (pipeline/steps/gross.ts). */
export const GROSS_BIN = 'scenarios/fzp/gross.bin';
/** /lesscars outputs (docs/dev/lesscars.md), relative to the dataset's out dir. */
export const LESSCARS_FILES = {
  plan: 'scenarios/lesscars/plan.json',
  sites: 'scenarios/lesscars/sites.json',
  summary: 'scenarios/lesscars/summary.json',
  timeline: 'scenarios/lesscars/timeline.bin'
} as const;
/** The golden's canonical dump of the decoded timeline. */
export const LESSCARS_TIMELINE_DUMP = 'scenarios/lesscars/timeline.decoded.json';

/** Inflate and decode a written parcels.bin; throws an Error naming the file if it fails. */
export function readParcelsBin(file: string): ScenarioParcels {
  try {
    return decodeScenarioPayload(new Uint8Array(inflateRawSync(readFileSync(file))));
  } catch (e) {
    throw new Error(`scenario: ${file} does not decode: ${(e as Error).message}`, { cause: e });
  }
}
