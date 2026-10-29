// Invariants over the sim data-layer files (plan 1): V31 and V32 for `scenarios/fzp/policy.bin`.
// Kept out of check.ts so the policy and frontage checks sit together; checkDataset calls
// checkPolicy after V30.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { Manifest } from '../../src/lib/data/manifest';
import {
  HISTORIC_CODES,
  NULL_CAP,
  SB79_STATUSES,
  decodePolicyPayload,
  encodePolicyPayload,
  type PolicyParcels
} from '../../src/lib/data/policy-codec';
import { decodeTransit } from '../../src/lib/data/transit-codec';
import { FILL_LEVELS, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { InvariantProfile } from '../config';
import { storiesFromFt } from '../lib/heights';
import { reportedQuality } from '../lib/quality';
import { rentControlExcluded, stopTiers, unitsFor } from '../lib/sb79';
import { POLICY_BIN } from '../lib/scenario-files';
import { MIN_UNITS, STANDARDS, type Sb79Tier, type TodBand } from '../sb79-config';
import type { InvariantResult } from './check';

/** V31 warns (still passes) above this size (plan Budget decision, tier 4). */
export const POLICY_WARN_BYTES = 0.75e6;
/** V34 warns (still passes) above this size (plan Budget decision, tier 4). */
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

/** policy.bin decoded against `p`, or the reason it cannot be. */
function decodedPolicy(outDir: string, p: ScenarioParcels | null): PolicyParcels | string {
  const file = join(outDir, POLICY_BIN);
  if (!existsSync(file)) return `${POLICY_BIN} is missing`;
  if (!p) return `${POLICY_BIN} cannot be checked: parcels.bin does not decode`;
  try {
    return decodePolicyPayload(new Uint8Array(inflateRawSync(readFileSync(file))), p);
  } catch (e) {
    return `${POLICY_BIN} does not decode: ${(e as Error).message}`;
  }
}

/** At most this many row ids are named per V32 problem. */
const NAMED = 5;

/**
 * V32, SB 79 as written: every `applies` row has the stories and statute cap of its tier and band
 * (`storiesFromFt`, `unitsFor` on parcels.bin's lot area) and yields of 0 or MIN_UNITS..cap; every
 * other row has 0 stories, no cap and zero yields; `hostableSb79` is `applies`; `todBand` (and
 * `todTier`) is 0 exactly on `outside` rows; `rent-control` rows, and no `applies` row, satisfy
 * `rentControlExcluded` (more than 2 pre-1979 homes); `policy.sb79.stops.tier1` / `.tier2` reach the
 * profile minimums; each `transitHeavyRailStations` name has a tier-1 stop in `transit.json`.
 * Warns (still passes) when `policy.sb79.tod_share` is outside `todShareWarn`. Never throws.
 */
function checkV32(
  outDir: string,
  profile: InvariantProfile,
  counts: Record<string, number>,
  p: ScenarioParcels | null,
  m: Manifest | null
): InvariantResult {
  const problems: string[] = [];
  const done = (ok: string): InvariantResult => ({
    id: 'V32',
    ok: problems.length === 0,
    detail: problems.length === 0 ? ok : problems.join('; ')
  });
  const pol = decodedPolicy(outDir, p);
  let applies = 0;
  if (typeof pol === 'string') problems.push(pol);
  else {
    const F = pol.fillLevels.length;
    const bad = new Map<string, string[]>();
    const flag = (what: string, i: number) => {
      const ids = bad.get(what) ?? [];
      ids.push(p!.id[i]); // decodePolicyPayload bound the rows to p's ids
      bad.set(what, ids);
    };
    for (let i = 0; i < pol.count; i++) {
      const status = SB79_STATUSES[pol.sb79Status[i]];
      const tier = pol.todTier[i];
      const band = pol.todBand[i];
      const ys = Array.from(pol.sb79Yield.subarray(i * F, (i + 1) * F));
      if ((band === 0) !== (status === 'outside')) flag('todBand 0 iff outside', i);
      if ((tier === 0) !== (band === 0)) flag('todTier 0 iff todBand 0', i);
      if (pol.hostableSb79[i] !== (status === 'applies' ? 1 : 0)) flag('hostableSb79 ≠ applies', i);
      // §65912.157(h) proxy: rent-control exactly where rentControlExcluded, unless an earlier
      // status (outside, not-eligible, zone) took precedence.
      const rc = rentControlExcluded(p!.rentControlLikely[i] === 1, p!.existingUnits[i]);
      if (status === 'rent-control' && !rc) flag('rent-control row not over 2 pre-1979 homes', i);
      if (status === 'applies' && rc) flag('applies row over 2 pre-1979 homes', i);
      if (status !== 'applies') {
        if (pol.sb79Stories[i] !== 0 || pol.sb79Cap[i] !== NULL_CAP || ys.some((y) => y !== 0))
          flag(`${status} row with an envelope`, i);
        continue;
      }
      applies++;
      const std = STANDARDS[tier as Sb79Tier]?.[band as TodBand];
      if (!std) {
        flag('applies with no tier and band', i);
        continue;
      }
      if (pol.sb79Stories[i] !== storiesFromFt(std.heightFt)) flag('sb79Stories ≠ statute', i);
      const cap = unitsFor(std.duPerAcre, p!.lotAreaM2[i]);
      if (pol.sb79Cap[i] !== cap) flag('sb79Cap ≠ statute density', i);
      if (ys.some((y) => y > pol.sb79Cap[i])) flag('sb79Yield above sb79Cap', i);
      if (ys.some((y) => y > 0 && y < MIN_UNITS)) flag(`sb79Yield in 1..${MIN_UNITS - 1}`, i);
    }
    for (const [what, ids] of bad)
      problems.push(
        `${what}: ${ids.length} rows (${ids.slice(0, NAMED).join(', ')}${ids.length > NAMED ? ', …' : ''})`
      );
  }
  const t1 = counts['policy.sb79.stops.tier1'] ?? 0;
  const t2 = counts['policy.sb79.stops.tier2'] ?? 0;
  if (!(t1 >= profile.sb79MinT1Stops))
    problems.push(`${t1} tier-1 stops < ${profile.sb79MinT1Stops}`);
  if (!(t2 >= profile.sb79MinT2Stops))
    problems.push(`${t2} tier-2 stops < ${profile.sb79MinT2Stops}`);
  try {
    if (!m?.transit) throw new Error('manifest has no transit');
    const rel = m.transit.slice(`/data/${m.datasetVersion}/`.length);
    const net = decodeTransit(readFileSync(join(outDir, rel), 'utf8'));
    const tier1 = [...stopTiers(net)].filter(([, t]) => t === 1).map(([i]) => net.stops[i].name);
    const missing = profile.transitHeavyRailStations.filter(
      (name) => !tier1.some((n) => n.toLowerCase().includes(name.toLowerCase()))
    );
    if (missing.length) problems.push(`no tier-1 stop at ${missing.join(', ')}`);
  } catch (e) {
    problems.push(`transit.json cannot be read: ${(e as Error).message}`);
  }
  const share = (counts['policy.sb79.tod_share'] ?? NaN) / 1e4;
  const w = profile.todShareWarn;
  const warn =
    w && !(share >= w[0] && share <= w[1])
      ? `; warn: tod share ${pct(share)} outside [${pct(w[0])}, ${pct(w[1])}]`
      : '';
  return done(
    `${applies} applies rows match the statute envelope; stops tier 1 ${t1} ≥ ${profile.sb79MinT1Stops}, ` +
      `tier 2 ${t2} ≥ ${profile.sb79MinT2Stops}; tod share ${pct(share)}${warn}`
  );
}

/**
 * The policy-file invariants (V31, V32), in id order. `opts.policyWarnBytes` overrides
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
  return [
    checkV31(outDir, profile, counts, p, m, stableDetail, warnBytes),
    checkV32(outDir, profile, counts, p, m)
  ];
}
