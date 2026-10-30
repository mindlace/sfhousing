// Invariants over the sim data-layer files (plan 1): V31 to V33 for `scenarios/fzp/policy.bin`,
// V34 for `scenarios/fzp/frontage.bin`.
// Kept out of check.ts so the policy and frontage checks sit together; checkDataset calls
// checkPolicy after V30.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { decodeFrontagePayload, encodeFrontagePayload } from '../../src/lib/data/frontage-codec';
import type { Manifest } from '../../src/lib/data/manifest';
import {
  HISTORIC_CODES,
  NULL_CAP,
  S207_STATUSES,
  SB79_STATUSES,
  decodePolicyPayload,
  encodePolicyPayload,
  type PolicyParcels
} from '../../src/lib/data/policy-codec';
import { decodeTransit } from '../../src/lib/data/transit-codec';
import { FILL_LEVELS, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { InvariantProfile } from '../config';
import { mostPermissive } from '../../src/lib/data/stock-layers';
import { s207Envelope, s207Status } from '../lib/current-law';
import { parseHeightDistrict, storiesFromFt } from '../lib/heights';
import { reportedQuality } from '../lib/quality';
import { rentControlExcluded, stopTiers, unitsFor, zoneClassOf } from '../lib/sb79';
import { FRONTAGE_BIN, POLICY_BIN } from '../lib/scenario-files';
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
 * profile minimums; at least `muniTier2MatchMin` of MUNI_TIER2_STOP_IDS match a stop
 * (`sd.sb79.tier2-unmatched`); each `transitHeavyRailStations` name has a tier-1 stop in `transit.json`.
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
  const list = reportedQuality(counts, 'sd.sb79.tier2-unmatched');
  const listed = list?.of ?? 0;
  const listMatched = listed - (list?.fired ?? 0);
  const listShare = listMatched / listed;
  let listDetail = '';
  if (!(listed > 0)) problems.push(`${listed} Muni tier-2 list ids`);
  else if (!(listShare >= profile.muniTier2MatchMin))
    problems.push(
      `Muni tier-2 list ids matched ${listMatched}/${listed} = ${pct(listShare)} < ${thr(profile.muniTier2MatchMin)}`
    );
  else
    listDetail = `; Muni tier-2 list ids matched ${listMatched}/${listed} ≥ ${thr(profile.muniTier2MatchMin)}`;
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
      `tier 2 ${t2} ≥ ${profile.sb79MinT2Stops}${listDetail}; tod share ${pct(share)}${warn}`
  );
}

/**
 * V33, current law (FZP + §207.11): for every row, recomputes `s207Status` (s207Status) from
 * parcels.bin (eligibility, lot area, FZP stories, and the applicable height (`lpFt` on a Local
 * Program lot, else `baseFt`) and R-4 flag of its height district string), the policy columns (TOD
 * tier and band, historic code, exemption flags, `fzpYieldCap`) and `zoneClassOf(useDistrict)`. A
 * `currentFromS207` row must be `applies`, have the s207Envelope stories and cap, and be the more
 * permissive layer (`mostPermissive` over the full-fill yield and hostable flag); every other row's
 * current columns must equal the FZP row (`envelopeStories`, `fzpYieldCap`, `yield`, `hostable`).
 * No `applies` row may have `fzpYieldCap` none (`applies with no FZP cap`).
 * `policy.s207.base_ft_mismatch` (the step's applicable height or R-4 flag ≠ the district string's)
 * and `policy.current.yield_mismatch` (the step's FZP recompute ≠ parcels.bin) must be 0: yields
 * are not regenerated here. Never throws.
 */
function checkV33(
  outDir: string,
  counts: Record<string, number>,
  p: ScenarioParcels | null
): InvariantResult {
  const problems: string[] = [];
  const done = (ok: string): InvariantResult => ({
    id: 'V33',
    ok: problems.length === 0,
    detail: problems.length === 0 ? ok : problems.join('; ')
  });
  const pol = decodedPolicy(outDir, p);
  let applies = 0;
  let from = 0;
  if (typeof pol === 'string') problems.push(pol);
  else {
    const F = pol.fillLevels.length;
    const bad = new Map<string, string[]>();
    const flag = (what: string, i: number) => {
      const ids = bad.get(what) ?? [];
      ids.push(p!.id[i]);
      bad.set(what, ids);
    };
    for (let i = 0; i < pol.count; i++) {
      const hd = parseHeightDistrict(p!.districts[p!.district[i]]);
      const tier = pol.todTier[i] as Sb79Tier;
      const band = pol.todBand[i] as TodBand;
      const best = STANDARDS[tier]?.[band] ? { tier, band } : null; // todBand 0: outside
      const fzpCap = pol.fzpYieldCap[i] === NULL_CAP ? null : pol.fzpYieldCap[i];
      // The height of the envelope the project uses: lpFt on a Local Program lot, else baseFt.
      const fzpHeightFt =
        hd.kind !== 'height' ? null : p!.localProgram[i] === 1 ? (hd.lpFt ?? hd.baseFt) : hd.baseFt;
      const want = s207Status({
        best,
        eligible: p!.eligible[i] === 1,
        principallyResidential: zoneClassOf(pol.useDistricts[pol.useDistrict[i]])
          .principallyResidential,
        r4: hd.kind === 'height' && hd.r4,
        historic: HISTORIC_CODES[pol.historic[i]],
        exempt: pol.exemptPermanent[i] === 1 || pol.exemptTemporary[i] === 1,
        fzpHeightFt,
        fzpCap,
        lotAreaM2: p!.lotAreaM2[i]
      });
      const got = S207_STATUSES[pol.s207Status[i]];
      if (got !== want) flag(`s207Status ${want} expected, ${got} found`, i);
      if (want === 'applies') applies++;
      if (got === 'applies' && fzpCap === null) flag('applies with no FZP cap', i);
      const top = (ys: ArrayLike<number>, k: number) => ys[k * F + F - 1];
      if (pol.currentFromS207[i] === 1) {
        from++;
        if (got !== 'applies' || best === null) {
          flag(`currentFromS207 on a ${got} row`, i);
          continue;
        }
        if (fzpCap === null) {
          flag('applies with no FZP cap', i);
          continue;
        }
        const env = s207Envelope({
          tier,
          band,
          fzpStories: p!.envelopeStories[i],
          fzpHeightFt,
          fzpCap,
          lotAreaM2: p!.lotAreaM2[i]
        });
        if (pol.currentStories[i] !== env.stories) flag('§207.11 stories ≠ currentStories', i);
        if (pol.currentCap[i] !== env.cap) flag('§207.11 cap ≠ currentCap', i);
        const fzpTop = { yieldTop: top(p!.yield, i), hostable: p!.hostable[i] === 1 };
        const curTop = {
          yieldTop: top(pol.currentYield, i),
          hostable: pol.hostableCurrent[i] === 1
        };
        if (mostPermissive(fzpTop, curTop) !== 'b')
          flag('currentFromS207 not more permissive than FZP', i);
        continue;
      }
      let same =
        pol.currentStories[i] === p!.envelopeStories[i] &&
        pol.currentCap[i] === pol.fzpYieldCap[i] &&
        pol.hostableCurrent[i] === p!.hostable[i];
      for (let k = i * F; same && k < (i + 1) * F; k++) same = pol.currentYield[k] === p!.yield[k];
      if (!same) flag('current ≠ FZP without §207.11', i);
    }
    for (const [what, ids] of bad)
      problems.push(
        `${what}: ${ids.length} rows (${ids.slice(0, NAMED).join(', ')}${ids.length > NAMED ? ', …' : ''})`
      );
    for (const k of ['policy.s207.base_ft_mismatch', 'policy.current.yield_mismatch'])
      if (counts[k] !== 0) problems.push(`${k} ${counts[k]} ≠ 0`);
    return done(
      `${pol.count} rows match §207.11 over FZP; ${applies} applies, ${from} from §207.11`
    );
  }
  return done('');
}

/**
 * V34 over `frontage.bin`: present and named in the manifest; inflates and decodes against the
 * decoded parcels.bin `p`; datasetVersion is the manifest's; re-encoding is byte-identical;
 * `frontage.depth1_orphan` is 0; at least `frontageMin` of eligible parcels have a depth-0 entry;
 * at most `frontageMaxBytes` on disk, warning above `warnBytes`. `stableDetail` leaves byte counts
 * out. Never throws.
 */
function checkV34(
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
    id: 'V34',
    ok: problems.length === 0,
    detail: problems.length === 0 ? ok : problems.join('; ')
  });
  const file = join(outDir, FRONTAGE_BIN);
  const present = existsSync(file);
  const url = m?.scenarios?.fzp.frontage;
  if (!m) problems.push('no manifest to compare');
  else if (present && url === undefined)
    problems.push(`${FRONTAGE_BIN} is not named in the manifest`);
  else if (url !== undefined && url !== `/data/${m.datasetVersion}/${FRONTAGE_BIN}`)
    problems.push(`manifest names ${url}, not ${FRONTAGE_BIN}`);
  if (!present) {
    problems.push(
      `${FRONTAGE_BIN} is missing${url !== undefined ? ' but named in the manifest' : ''}`
    );
    return done('');
  }
  if (!p) {
    problems.push(`${FRONTAGE_BIN} cannot be checked: parcels.bin does not decode`);
    return done('');
  }
  const body = readFileSync(file);
  let detail = '';
  try {
    const payload = new Uint8Array(inflateRawSync(body));
    const f = decodeFrontagePayload(payload, p);
    if (m && f.datasetVersion !== m.datasetVersion)
      problems.push(`datasetVersion ${f.datasetVersion} ≠ ${m.datasetVersion}`);
    try {
      if (!sameBytes(encodeFrontagePayload(f), payload))
        problems.push('re-encoding the decoded payload differs');
    } catch (e) {
      problems.push(`re-encoding the decoded payload fails: ${(e as Error).message}`);
    }
    let eligible = 0;
    let fronting = 0;
    for (let i = 0; i < f.count; i++) {
      if (p.eligible[i] !== 1) continue;
      eligible++;
      // Entries are sorted by (depth, seg): a depth-0 entry, if any, comes first.
      if (f.rowStart[i + 1] > f.rowStart[i] && f.frontDepth[f.rowStart[i]] === 0) fronting++;
    }
    const share = eligible === 0 ? NaN : fronting / eligible;
    if (!(share >= profile.frontageMin))
      problems.push(
        `fronting ${fronting}/${eligible} = ${pct(share)} < ${thr(profile.frontageMin)}`
      );
    detail = `${f.count} parcels decode; re-encode byte-identical; ${f.segCnn.length} segments; fronting ${fronting}/${eligible} eligible ≥ ${thr(profile.frontageMin)}`;
  } catch (e) {
    problems.push(`${FRONTAGE_BIN} does not decode: ${(e as Error).message}`);
  }
  const orphan = counts['frontage.depth1_orphan'];
  if (orphan !== 0) problems.push(`frontage.depth1_orphan ${orphan} ≠ 0`);
  const max = profile.frontageMaxBytes;
  if (body.length > max)
    problems.push(
      stableDetail ? `${FRONTAGE_BIN} over budget` : `${FRONTAGE_BIN} ${body.length}/${max} B`
    );
  const warn = body.length > warnBytes ? `; warn: over ${warnBytes / 1e6} MB` : '';
  detail += stableDetail
    ? `; frontage.bin within budget${warn}`
    : `; frontage.bin ${body.length}/${max} B${warn}`;
  return done(detail);
}

/**
 * The sim data-layer invariants (V31 to V34), in id order. `opts.policyWarnBytes` and
 * `opts.frontageWarnBytes` override POLICY_WARN_BYTES and FRONTAGE_WARN_BYTES (tests). Never throws.
 */
export function checkPolicy(
  outDir: string,
  profile: InvariantProfile,
  counts: Record<string, number>,
  p: ScenarioParcels | null,
  m: Manifest | null,
  stableDetail: boolean,
  opts: { policyWarnBytes?: number; frontageWarnBytes?: number } = {}
): InvariantResult[] {
  const warnBytes = opts.policyWarnBytes ?? POLICY_WARN_BYTES;
  const frontageWarn = opts.frontageWarnBytes ?? FRONTAGE_WARN_BYTES;
  return [
    checkV31(outDir, profile, counts, p, m, stableDetail, warnBytes),
    checkV32(outDir, profile, counts, p, m),
    checkV33(outDir, counts, p),
    checkV34(outDir, profile, counts, p, m, stableDetail, frontageWarn)
  ];
}
