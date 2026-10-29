// Policy build step (sim data layers, plan 1): runs the policy SQL and writes
// `scenarios/fzp/policy.bin` (codec `sfh-policy/1`), one row per parcel in parcels.bin order: the
// zoning use district, the historic resource status, the SB 79 exemptions, the FZP yield cap, and
// the SB 79 and current-law columns. SB 79 as written is the statute envelope at the parcel's best
// TOD stop standard, capped at the statute density; current law is FZP plus Planning Code §207.11
// (Ord. 082-26 §5) with the City's exemptions.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import {
  HISTORIC_CODES,
  HISTORIC_PROTECTED,
  NULL_CAP,
  POLICY_FORMAT,
  S207_STATUSES,
  SB79_STATUSES,
  decodePolicyPayload,
  encodePolicyPayload,
  type PolicyParcels
} from '../../src/lib/data/policy-codec';
import { idsHash } from '../../src/lib/data/column-file';
import {
  FILL_LEVELS,
  scenarioRecordOf,
  type ScenarioParcels
} from '../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../src/lib/data/scenario-yield';
import { decodeTransit } from '../../src/lib/data/transit-codec';
import type { Day } from '../../src/lib/timelapse/time';
import type { Provenance } from '../../src/lib/timelapse/types';
import { currentLawRow, envelopeRow, s207Row } from '../lib/current-law';
import { fzpYieldCapOf } from '../lib/density-caps';
import type { Duck } from '../lib/duck';
import { parseHeightDistrict } from '../lib/heights';
import { recordQuality } from '../lib/quality';
import { bestStandard, sb79Row, stopTiers, zoneClassOf } from '../lib/sb79';
import { PARCELS_BIN, POLICY_BIN } from '../lib/scenario-files';
import {
  CURRENT_LAW_RULE,
  EXEMPTION_HOMEPAGE,
  MUNI_TIER2_CITE,
  S207,
  STANDARDS_CITE,
  TIER_SOURCE,
  type Sb79Tier
} from '../sb79-config';
import { GTFS_FEEDS } from '../transit-config';
import { SFBOS_EXEMPTIONS_LABEL } from '../sources/sfbos';
import { POLICY_SQL_RULES, runPolicySql } from './policy-sql';
import { readParcelsBin } from './scenario';

export { POLICY_BIN };
/** The T14 rules writePolicy counts in TS (82_policy.sql tallies POLICY_SQL_RULES). */
export const POLICY_TS_RULES = ['sd.sb79.zone-unlisted'] as const;
/** The golden's canonical dump of the decoded policy payload. */
export const POLICY_DUMP = 'scenarios/fzp/policy.decoded.json';

const FIXTURE_RE = /^fixture-\d+$/;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const homepage = (id: string) => `https://data.sf.gov/d/${id}`;
const SRC = {
  attrs: { label: 'DataSF Parcels (attributes, active and retired)', url: homepage('acdm-wktn') },
  historic: { label: 'DataSF Historic Resource Status by Parcel', url: homepage('3tsw-4idn') },
  exemptions: { label: SFBOS_EXEMPTIONS_LABEL, url: EXEMPTION_HOMEPAGE },
  height: { label: 'DataSF Zoning Map – Height and Bulk Districts', url: homepage('h9wh-cg3m') },
  roll: {
    label: 'DataSF Assessor Historical Secured Property Tax Rolls',
    url: homepage('wv5m-vpq2')
  },
  statute: { label: STANDARDS_CITE.source, url: STANDARDS_CITE.url! },
  muniTier2: { label: MUNI_TIER2_CITE.source, url: MUNI_TIER2_CITE.url! },
  ordinance: { label: S207.cite.source, url: S207.cite.url! },
  planningMemo: { label: S207.minDensityCite.source, url: S207.minDensityCite.url! },
  gtfs: Object.values(GTFS_FEEDS).map((f) => ({ label: f.label, url: f.homepage }))
};

/** A Provenance with a fixed key order (tier, label, sources, method), so payloads are stable. */
const prov = (
  tier: Provenance['tier'],
  label: string,
  sources: Provenance['sources'],
  method: string
): Provenance => ({
  tier,
  label,
  sources: sources.map((s) => ({ label: s.label, url: s.url })),
  method
});

function provenance(capDay: Day): PolicyParcels['provenance'] {
  const capDate = new Date(capDay * 86400000).toISOString().slice(0, 10);
  return {
    useDistrict: prov(
      0,
      'Zoning use district',
      [SRC.attrs],
      'The parcel’s acdm-wktn zoning_code (the active row of its map lot, the row whose lot is ' +
        'the map lot first), as the scenario step reads it; empty when it has none. A split code ' +
        'such as RH-1|RM-1 is kept whole.'
    ),
    historic: prov(
      0,
      'Historic resource status',
      [SRC.historic, SRC.attrs],
      'The most protective ceqacodea10a11 of the parcel’s 3tsw-4idn rows, ranked A* > A > B > C, ' +
        'each row joined by apn to an active acdm-wktn blklot and its map lot; empty when the ' +
        'parcel has none (sd.historic.no-row, 4 / 4). Historic protection is A or A* (ruling 4).'
    ),
    exemptions: prov(
      0,
      'SB 79 exemptions (Ord. 082-26)',
      [SRC.exemptions, SRC.attrs],
      'The §3 Table of Permanent Exclusions and the §4 Table of Temporary Exemptions of Board ' +
        'File 260132, transcribed to pipeline/enrichment/sb79-exemptions.csv and checked ' +
        'against the originals’ sha256 at normalise. A parcel is exempt when one of its active ' +
        'blklots is listed; a row that matches no active parcel is dropped (sd.exempt.unmatched).'
    ),
    sb79: prov(
      3,
      'SB 79 as written',
      [SRC.statute, ...SRC.gtfs, SRC.muniTier2, SRC.attrs],
      'Gov. Code §65912.157 as written, ignoring the City’s exemptions and Density Bonus Law. ' +
        'TOD stops come from the GTFS feeds (tier source gtfs): heavy rail is tier 1, commuter ' +
        'rail tier 1 at 72 or more trains a day at the station and tier 2 at 48, light rail, ' +
        'streetcar and the Muni stops MTC designates current tier 2 (planned stops left out) ' +
        'tier 2. The band is the straight-line distance from the DataSF parcel outline to the ' +
        'nearest stop point of each tier (200 ft, ¼ mile, ½ mile); the tallest standard wins. ' +
        'Stories are 10 ft each of its height and the cap is its du/ac × lot acres, rounded up. ' +
        'The lot must be scenario-eligible, zoned residential, mixed or commercial, not hold more ' +
        'than 2 homes likely rent-controlled (built before 1979; occupancy not modelled), and yield at least 5 homes at full fill; fill levels below 5 are 0.'
    ),
    currentLaw: prov(
      3,
      'Current law (FZP + §207.11)',
      [
        SRC.ordinance,
        SRC.exemptions,
        SRC.planningMemo,
        SRC.statute,
        ...SRC.gtfs,
        SRC.muniTier2,
        SRC.height,
        SRC.roll,
        SRC.attrs,
        SRC.historic
      ],
      'The FZP envelope, cap and yields of parcels.bin (the FZP yield cap is none on Local ' +
        `Program parcels and the base-zoning cap on ${capDate} elsewhere), raised by Planning ` +
        'Code §207.11 (Ord. 082-26 §5) where it applies. §207.11 applies within ½ mile of an ' +
        'SB 79 TOD stop (the SB 79 tiers and bands), on a scenario-eligible lot that is in ' +
        'neither Board File 260132 exemption table, zoned for principally permitted residential ' +
        'use, with a numeric density cap or a base height under 40 ft, outside R-4, not an ' +
        'Article 10 or 11 resource (historic status A*), and whose cap is below half the SB 79 ' +
        'density of its tier and band (Planning’s reading of (b)(8)); the density-bonus ' +
        'condition (b)(5) is not modelled. There a base height under 40 ft becomes 40 ft (4 ' +
        'stories) and the cap is the larger of the FZP cap and half the SB 79 density × lot ' +
        'acres, rounded half up. A lot takes §207.11 when its full-fill yield is larger and it ' +
        'can host a project; a tie keeps FZP.'
    )
  };
}

/** Canonical JSON form of a decoded policy payload: plain arrays, fixed key order. */
export function policyDump(p: PolicyParcels): unknown {
  const a = (x: ArrayLike<number>) => Array.from(x);
  const keys = ['useDistrict', 'historic', 'exemptions', 'sb79', 'currentLaw'] as const;
  return {
    format: p.format,
    datasetVersion: p.datasetVersion,
    count: p.count,
    idsHash: p.idsHash,
    fillLevels: [...p.fillLevels],
    currentLawRule: p.currentLawRule,
    tierSource: p.tierSource,
    useDistricts: [...p.useDistricts],
    provenance: Object.fromEntries(
      keys.map((k) => {
        const v = p.provenance[k];
        return [k, prov(v.tier, v.label, v.sources, v.method)];
      })
    ),
    useDistrict: a(p.useDistrict),
    historic: a(p.historic),
    fzpYieldCap: a(p.fzpYieldCap),
    todTier: a(p.todTier),
    todBand: a(p.todBand),
    sb79Status: a(p.sb79Status),
    sb79Stories: a(p.sb79Stories),
    sb79Cap: a(p.sb79Cap),
    sb79Yield: a(p.sb79Yield),
    s207Status: a(p.s207Status),
    currentStories: a(p.currentStories),
    currentCap: a(p.currentCap),
    currentYield: a(p.currentYield),
    hostableSb79: a(p.hostableSb79),
    hostableCurrent: a(p.hostableCurrent),
    currentFromS207: a(p.currentFromS207),
    exemptPermanent: a(p.exemptPermanent),
    exemptTemporary: a(p.exemptTemporary),
    historicProtected: a(p.historicProtected)
  };
}

/** The dump as the golden file stores it. */
export function formatPolicyDump(p: PolicyParcels): string {
  return JSON.stringify(policyDump(p), null, 2) + '\n';
}

/** Inflate and decode a written policy.bin against its parcels.bin; throws naming the file. */
export function readPolicyBin(file: string, parcels: ScenarioParcels): PolicyParcels {
  try {
    return decodePolicyPayload(new Uint8Array(inflateRawSync(readFileSync(file))), parcels);
  } catch (e) {
    throw new Error(`policy: ${file} does not decode: ${(e as Error).message}`, { cause: e });
  }
}

interface PolicyRow {
  id: string;
  zoning_code: string | null;
  r4: boolean;
  base_ft: number | null;
  historic: string;
  permanent: boolean;
  temporary: boolean;
}

/**
 * The policy build step. Needs the scenario step's tables (sc_zoning, sc_district) and its
 * `scenarios/fzp/parcels.bin`, and `records` as writeScenario took them. Runs runPolicySql, writes
 * `<outDir>/scenarios/fzp/policy.bin` and reports sd.historic.no-row and sd.exempt.unmatched into
 * `buildCounts` (T14), and sd.sb79.zone-unlisted. Reads `<outDir>/transit.json` (the transit step's)
 * for the SB 79 TOD stops. Returns the policy.* counts and warnings. Throws when the written file does
 * not decode.
 */
export async function writePolicy(a: {
  db: Duck;
  outDir: string;
  datasetVersion: string;
  records: { rec: ParcelRecord; cellId: string }[];
  capDay: Day;
  buildCounts: Record<string, number>;
}): Promise<{ counts: Record<string, number>; warnings: string[] }> {
  const { db } = a;
  const warnings: string[] = [];
  const s = readParcelsBin(join(a.outDir, PARCELS_BIN));
  if (a.records.length !== s.count)
    throw new Error(`policy: ${a.records.length} records but parcels.bin has ${s.count}`);
  const recOf = new Map(a.records.map((r) => [r.rec.id, r.rec]));

  // SB 79 TOD stops from the transit step's network (TIER_SOURCE 'gtfs').
  const net = decodeTransit(readFileSync(join(a.outDir, 'transit.json'), 'utf8'));
  const stops = [...stopTiers(net)]
    .map(([i, tier]) => ({
      id: net.stops[i].id,
      tier,
      lng: net.stops[i].lngLat[0],
      lat: net.stops[i].lngLat[1]
    }))
    .sort((x, y) => cmp(x.id, y.id));
  await runPolicySql(db, stops);
  const tod = await db.all<{ id: string; tier: number; dist_m: number }>(
    'SELECT id, tier, dist_m FROM pol_tod ORDER BY id, tier'
  );
  const reach = new Map<string, Partial<Record<Sb79Tier, number>>>();
  for (const t of tod) {
    const m = reach.get(t.id) ?? {};
    m[t.tier as Sb79Tier] = t.dist_m;
    reach.set(t.id, m);
  }

  const rows = await db.all<PolicyRow>(
    `SELECT z.id, z.zoning_code, d.r4, d.base_ft, h.code AS historic, e.permanent, e.temporary
     FROM sc_zoning z JOIN sc_district d USING (id) JOIN pol_historic h USING (id)
     JOIN pol_exempt e USING (id) ORDER BY z.id`
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rowOf = (id: string): PolicyRow => {
    const r = byId.get(id);
    if (!r) throw new Error(`policy: parcel ${id} has no policy row`);
    return r;
  };
  const n = s.count;
  const F = s.fillLevels.length;
  const codeOf = (r: PolicyRow) => r.zoning_code ?? '';
  const useDistricts = [...new Set(s.id.map((id) => codeOf(rowOf(id))))].sort(cmp);
  const districtIdx = new Map(useDistricts.map((d, i) => [d, i]));
  const historicIdx = new Map<string, number>(HISTORIC_CODES.map((c, i) => [c, i]));
  const protectedCodes: readonly string[] = HISTORIC_PROTECTED;

  const p: PolicyParcels = {
    format: POLICY_FORMAT,
    datasetVersion: a.datasetVersion,
    count: n,
    idsHash: idsHash(s.id),
    fillLevels: [...FILL_LEVELS],
    currentLawRule: CURRENT_LAW_RULE,
    tierSource: TIER_SOURCE,
    useDistricts,
    provenance: provenance(a.capDay),
    useDistrict: new Uint16Array(n),
    historic: new Uint8Array(n),
    fzpYieldCap: new Uint16Array(n),
    todTier: new Uint8Array(n),
    todBand: new Uint8Array(n),
    sb79Status: new Uint8Array(n).fill(SB79_STATUSES.indexOf('outside')),
    sb79Stories: new Uint8Array(n),
    sb79Cap: new Uint16Array(n).fill(NULL_CAP),
    sb79Yield: new Uint16Array(n * F),
    s207Status: new Uint8Array(n).fill(S207_STATUSES.indexOf('outside')),
    currentStories: new Uint8Array(n),
    currentCap: new Uint16Array(n).fill(NULL_CAP),
    currentYield: new Uint16Array(n * F),
    hostableSb79: new Uint8Array(n),
    hostableCurrent: new Uint8Array(n),
    currentFromS207: new Uint8Array(n),
    exemptPermanent: new Uint8Array(n),
    exemptTemporary: new Uint8Array(n),
    historicProtected: new Uint8Array(n)
  };

  const c: Record<string, number> = {};
  const inc = (k: string) => (c[`policy.${k}`] = (c[`policy.${k}`] ?? 0) + 1);
  for (const k of [
    ...HISTORIC_CODES.map((h) => `historic.${h || 'none'}`),
    'historic.protected',
    'exempt.permanent',
    'exempt.temporary',
    ...SB79_STATUSES.map((st) => `sb79.${st}`),
    'sb79.cap_binds',
    'sb79.net_capacity',
    ...S207_STATUSES.map((st) => `s207.${st}`),
    's207.base_ft_mismatch',
    'current.from_s207',
    'current.net_capacity',
    'current.yield_mismatch'
  ])
    c[`policy.${k}`] = 0;
  c['policy.sb79.stops.tier1'] = stops.filter((x) => x.tier === 1).length;
  c['policy.sb79.stops.tier2'] = stops.filter((x) => x.tier === 2).length;
  const statusIdx = new Map<string, number>(SB79_STATUSES.map((st, k) => [st, k]));
  const s207Idx = new Map<string, number>(S207_STATUSES.map((st, k) => [st, k]));
  let inReach = 0;
  const zoneUnlisted: string[] = [];

  for (let i = 0; i < n; i++) {
    const r = rowOf(s.id[i]);
    p.useDistrict[i] = districtIdx.get(codeOf(r))!;
    const h = historicIdx.get(r.historic);
    if (h === undefined) throw new Error(`policy: parcel ${s.id[i]} historic ${r.historic}`);
    p.historic[i] = h;
    inc(`historic.${r.historic || 'none'}`);
    if (protectedCodes.includes(r.historic)) {
      p.historicProtected[i] = 1;
      inc('historic.protected');
    }
    if (r.permanent) {
      p.exemptPermanent[i] = 1;
      inc('exempt.permanent');
    }
    if (r.temporary) {
      p.exemptTemporary[i] = 1;
      inc('exempt.temporary');
    }
    // Exactly the cap writeScenario capped `yield` with (same zoning, lot area, R-4 and LP flag).
    const cap = fzpYieldCapOf(
      r.zoning_code,
      s.lotAreaM2[i],
      r.r4,
      s.localProgram[i] === 1,
      a.capDay
    );
    if (cap !== null && !(Number.isInteger(cap) && cap >= 0 && cap < NULL_CAP))
      throw new Error(`policy: parcel ${s.id[i]} fzpYieldCap ${cap} does not fit u16`);
    p.fzpYieldCap[i] = cap === null ? NULL_CAP : cap;

    // SB 79 as written (ruling 3: the exemption flags are not read here).
    const best = bestStandard(reach.get(s.id[i]) ?? {});
    const zone = zoneClassOf(r.zoning_code).zoneClass;
    if (best) {
      inReach++;
      p.todTier[i] = best.tier;
      p.todBand[i] = best.band;
      if (zone === 'unlisted') zoneUnlisted.push(s.id[i]);
    }
    const rec = recOf.get(s.id[i]);
    if (!rec) throw new Error(`policy: parcel ${s.id[i]} has no record`);
    const view = scenarioRecordOf(s, i, rec);
    const gross = new Map<number, number>();
    const grossAt = (stories: number) => {
      let g = gross.get(stories);
      if (g === undefined) gross.set(stories, (g = scenarioYield(view, stories, null)));
      return g;
    };
    const sb = sb79Row({
      best,
      eligible: s.eligible[i] === 1,
      zone,
      rentControlLikely: s.rentControlLikely[i] === 1,
      lotAreaM2: s.lotAreaM2[i],
      existingUnits: s.existingUnits[i],
      grossAt
    });
    p.sb79Status[i] = statusIdx.get(sb.status)!;
    inc(`sb79.${sb.status}`);
    p.sb79Stories[i] = sb.stories;
    if (sb.cap !== null && !(sb.cap >= 0 && sb.cap < NULL_CAP))
      throw new Error(`policy: parcel ${s.id[i]} sb79Cap ${sb.cap} does not fit u16`);
    p.sb79Cap[i] = sb.cap === null ? NULL_CAP : sb.cap;
    for (let k = 0; k < F; k++) {
      if (sb.yield[k] > 0xffff)
        throw new Error(`policy: parcel ${s.id[i]} sb79Yield ${sb.yield[k]} does not fit u16`);
      p.sb79Yield[i * F + k] = sb.yield[k];
    }
    if (sb.status === 'applies') {
      p.hostableSb79[i] = 1;
      if (sb.uncappedTop > sb.yield[F - 1]) inc('sb79.cap_binds');
      c['policy.sb79.net_capacity'] += Math.max(0, sb.yield[F - 1] - s.existingUnits[i]);
    }

    // Current law: FZP plus §207.11 (ruling 1). The FZP row is parcels.bin's; the step also
    // recomputes it with envelopeRow and counts any difference (policy.current.yield_mismatch).
    const fzp = {
      stories: s.envelopeStories[i],
      cap,
      yield: Array.from(s.yield.subarray(i * F, (i + 1) * F)),
      hostable: s.hostable[i] === 1
    };
    const again = envelopeRow({
      stories: fzp.stories,
      cap,
      eligible: s.eligible[i] === 1,
      existingUnits: s.existingUnits[i],
      grossAt
    });
    if (again.hostable !== fzp.hostable || again.yield.some((y, k) => y !== fzp.yield[k]))
      inc('current.yield_mismatch');
    // V33 reads the base height and R-4 flag from parcels.bin's district string.
    const hd = parseHeightDistrict(s.districts[s.district[i]]);
    const binBaseFt = hd.kind === 'height' ? hd.baseFt : null;
    const binR4 = hd.kind === 'height' && hd.r4;
    if (binBaseFt !== r.base_ft || binR4 !== r.r4) inc('s207.base_ft_mismatch');
    const s207 = s207Row({
      best,
      eligible: s.eligible[i] === 1,
      principallyResidential: zoneClassOf(r.zoning_code).principallyResidential,
      r4: r.r4,
      historic: r.historic,
      exempt: r.permanent || r.temporary,
      fzpStories: fzp.stories,
      fzpBaseFt: r.base_ft,
      fzpCap: cap,
      lotAreaM2: s.lotAreaM2[i],
      existingUnits: s.existingUnits[i],
      grossAt
    });
    p.s207Status[i] = s207Idx.get(s207.status)!;
    inc(`s207.${s207.status}`);
    const cur = currentLawRow(fzp, s207);
    if (cur.stories > 0xff) throw new Error(`policy: parcel ${s.id[i]} currentStories too large`);
    p.currentStories[i] = cur.stories;
    if (cur.cap !== null && !(cur.cap >= 0 && cur.cap < NULL_CAP))
      throw new Error(`policy: parcel ${s.id[i]} currentCap ${cur.cap} does not fit u16`);
    p.currentCap[i] = cur.cap === null ? NULL_CAP : cur.cap;
    for (let k = 0; k < F; k++) {
      if (cur.yield[k] > 0xffff)
        throw new Error(`policy: parcel ${s.id[i]} currentYield ${cur.yield[k]} does not fit u16`);
      p.currentYield[i * F + k] = cur.yield[k];
    }
    p.hostableCurrent[i] = cur.hostable ? 1 : 0;
    p.currentFromS207[i] = cur.fromS207 ? 1 : 0;
    if (cur.fromS207) inc('current.from_s207');
    if (cur.hostable)
      c['policy.current.net_capacity'] += Math.max(0, cur.yield[F - 1] - s.existingUnits[i]);
  }
  c['policy.sb79.tod_share'] = n === 0 ? 0 : Math.round((1e4 * inReach) / n);

  // ---- File: encode, deflate, write, then decode what was written ----
  const payload = encodePolicyPayload(p);
  const file = join(a.outDir, POLICY_BIN);
  mkdirSync(dirname(file), { recursive: true });
  const body = deflateRawSync(payload, { level: 9 });
  writeFileSync(file, body);
  c['policy.bytes.payload'] = payload.length;
  // Deflate bytes may differ across zlib builds, so fixture reports omit them (as parcels.bin's).
  if (!FIXTURE_RE.test(a.datasetVersion)) c['policy.bytes.file'] = body.length;
  const decoded = readPolicyBin(file, s);
  let mismatch = 0;
  for (let i = 0; i < n; i++)
    if (decoded.useDistricts[decoded.useDistrict[i]] !== codeOf(rowOf(s.id[i]))) mismatch++;
  c['policy.use_district_mismatch'] = mismatch;

  // ---- T14: report the policy SQL tallies once (82_policy.sql) ----
  const ruleList = POLICY_SQL_RULES.map((id) => `'${id}'`).join(', ');
  const tally = await db.all<{ rule_id: string; fired: number; of: number }>(
    `SELECT rule_id, fired, "of" FROM quality_tally WHERE rule_id IN (${ruleList}) ORDER BY rule_id`
  );
  const samples = await db.all<{ rule_id: string; record_id: string }>(
    `SELECT rule_id, record_id FROM quality_sample WHERE rule_id IN (${ruleList})
     ORDER BY rule_id, record_id`
  );
  for (const id of POLICY_SQL_RULES) {
    const t = tally.filter((x) => x.rule_id === id);
    if (t.length !== 1) throw new Error(`policy: ${t.length} quality_tally rows for ${id}`);
    recordQuality(a.buildCounts, id, {
      fired: t[0].fired,
      of: t[0].of,
      sample: samples.filter((x) => x.rule_id === id).map((x) => x.record_id)
    });
  }
  // ---- T14: the TS-side rule (sd.sb79.zone-unlisted, over parcels within ½ mile) ----
  recordQuality(a.buildCounts, POLICY_TS_RULES[0], {
    fired: zoneUnlisted.length,
    of: inReach,
    sample: zoneUnlisted
  });

  const counts = Object.fromEntries(Object.entries(c).sort(([x], [y]) => cmp(x, y)));
  return { counts, warnings };
}
