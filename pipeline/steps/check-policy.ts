// Invariants over the sim data-layer files (plan 1): V31 for `scenarios/fzp/policy.bin`. Kept out
// of check.ts so the policy and frontage checks sit together; checkDataset calls checkPolicy
// after V30.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { Manifest } from '../../src/lib/data/manifest';
import {
  HISTORIC_CODES,
  decodePolicyPayload,
  encodePolicyPayload
} from '../../src/lib/data/policy-codec';
import { FILL_LEVELS, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { InvariantProfile } from '../config';
import { reportedQuality } from '../lib/quality';
import { POLICY_BIN } from '../lib/scenario-files';
import type { InvariantResult } from './check';

/** V31 warns (still passes) above this size (plan Budget decision, tier 4). */
export const POLICY_WARN_BYTES = 0.75e6;
/** V32 warns (still passes) above this size (plan Budget decision, tier 4). */
export const FRONTAGE_WARN_BYTES = 0.75e6;

const thr = (x: number) => `${Number((x * 100).toFixed(4))}%`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * V31 over `policy.bin`: present and named in the manifest; inflates and decodes against the
 * decoded parcels.bin `p`; datasetVersion is the manifest's; re-encoding is byte-identical;
 * fillLevels are FILL_LEVELS; `policy.use_district_mismatch` is 0; at least `historicJoinMin` of
 * parcels have a historic code; at least `exemptJoinMin` of the exemption table rows match a parcel
 * (0 rows fails); at most `policyMaxBytes` on disk, warning above POLICY_WARN_BYTES.
 * `stableDetail` leaves byte counts out. Never throws.
 */
function checkV31(
  outDir: string,
  profile: InvariantProfile,
  counts: Record<string, number>,
  p: ScenarioParcels | null,
  m: Manifest | null,
  stableDetail: boolean,
  warnBytes: number
): InvariantResult {
  const problems: string[] = [];
  const done = (ok: string): InvariantResult => ({
    id: 'V31',
    ok: problems.length === 0,
    detail: problems.length === 0 ? ok : problems.join('; ')
  });
  const file = join(outDir, POLICY_BIN);
  const present = existsSync(file);
  const url = m?.scenarios?.fzp.policy;
  if (!m) problems.push('no manifest to compare');
  else if (present && url === undefined)
    problems.push(`${POLICY_BIN} is not named in the manifest`);
  else if (url !== undefined && url !== `/data/${m.datasetVersion}/${POLICY_BIN}`)
    problems.push(`manifest names ${url}, not ${POLICY_BIN}`);
  if (!present) {
    problems.push(
      `${POLICY_BIN} is missing${url !== undefined ? ' but named in the manifest' : ''}`
    );
    return done('');
  }
  if (!p) {
    problems.push(`${POLICY_BIN} cannot be checked: parcels.bin does not decode`);
    return done('');
  }
  const body = readFileSync(file);
  let detail = '';
  try {
    const payload = new Uint8Array(inflateRawSync(body));
    const pol = decodePolicyPayload(payload, p);
    if (m && pol.datasetVersion !== m.datasetVersion)
      problems.push(`datasetVersion ${pol.datasetVersion} ≠ ${m.datasetVersion}`);
    try {
      if (!sameBytes(encodePolicyPayload(pol), payload))
        problems.push('re-encoding the decoded payload differs');
    } catch (e) {
      problems.push(`re-encoding the decoded payload fails: ${(e as Error).message}`);
    }
    const fl = pol.fillLevels;
    if (fl.length !== FILL_LEVELS.length || FILL_LEVELS.some((v, k) => fl[k] !== v))
      problems.push(`fillLevels [${fl.join(', ')}] ≠ FILL_LEVELS`);
    const none = HISTORIC_CODES.indexOf('');
    const withCode = pol.historic.filter((h) => h !== none).length;
    const share = pol.count === 0 ? NaN : withCode / pol.count;
    if (!(share >= profile.historicJoinMin))
      problems.push(
        `historic ${withCode}/${pol.count} = ${pct(share)} < ${thr(profile.historicJoinMin)}`
      );
    detail = `${pol.count} parcels decode; re-encode byte-identical; historic ${withCode}/${pol.count} ≥ ${thr(profile.historicJoinMin)}`;
  } catch (e) {
    problems.push(`${POLICY_BIN} does not decode: ${(e as Error).message}`);
  }
  const mismatch = counts['policy.use_district_mismatch'];
  if (mismatch !== 0) problems.push(`policy.use_district_mismatch ${mismatch} ≠ 0`);
  // The live vendored transcription is header-only until it is filled in: 0 rows is a failure,
  // not a vacuous pass (controller ruling).
  const exempt = reportedQuality(counts, 'sd.exempt.unmatched');
  const rows = exempt?.of ?? 0;
  const unmatched = exempt?.fired ?? 0;
  if (!(rows > 0)) problems.push(`${rows} exemption table rows`);
  else {
    const matched = (rows - unmatched) / rows;
    if (!(matched >= profile.exemptJoinMin))
      problems.push(
        `exemption rows matched ${rows - unmatched}/${rows} = ${pct(matched)} < ${thr(profile.exemptJoinMin)}`
      );
    else
      detail += `; exemption rows matched ${rows - unmatched}/${rows} ≥ ${thr(profile.exemptJoinMin)}`;
  }
  const max = profile.policyMaxBytes;
  if (body.length > max)
    problems.push(
      stableDetail ? `${POLICY_BIN} over budget` : `${POLICY_BIN} ${body.length}/${max} B`
    );
  const warn = body.length > warnBytes ? `; warn: over ${warnBytes / 1e6} MB` : '';
  detail += stableDetail
    ? `; policy.bin within budget${warn}`
    : `; policy.bin ${body.length}/${max} B${warn}`;
  return done(detail);
}

/**
 * The policy-file invariants (V31), in id order. `opts.policyWarnBytes` overrides
 * POLICY_WARN_BYTES (tests). Never throws.
 */
export function checkPolicy(
  outDir: string,
  profile: InvariantProfile,
  counts: Record<string, number>,
  p: ScenarioParcels | null,
  m: Manifest | null,
  stableDetail: boolean,
  opts: { policyWarnBytes?: number } = {}
): InvariantResult[] {
  const warnBytes = opts.policyWarnBytes ?? POLICY_WARN_BYTES;
  return [checkV31(outDir, profile, counts, p, m, stableDetail, warnBytes)];
}
