// Policy build step (sim data layers, plan 1): runs the policy SQL and writes
// `scenarios/fzp/policy.bin` (codec `sfh-policy/1`), one row per parcel in parcels.bin order: the
// zoning use district, the historic resource status, the SB 79 exemptions, the FZP yield cap, and
// the SB 79 and current-law columns. In this step SB 79 is not yet computed (every parcel
// `outside`) and current law is a copy of FZP.
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
import { FILL_LEVELS, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { Day } from '../../src/lib/timelapse/time';
import type { Provenance } from '../../src/lib/timelapse/types';
import { fzpYieldCapOf } from '../lib/density-caps';
import type { Duck } from '../lib/duck';
import { recordQuality } from '../lib/quality';
import { PARCELS_BIN, POLICY_BIN } from '../lib/scenario-files';
import { CURRENT_LAW_RULE, EXEMPTION_HOMEPAGE, TIER_SOURCE } from '../sb79-config';
import { SFBOS_EXEMPTIONS_LABEL } from '../sources/sfbos';
import { POLICY_SQL_RULES, runPolicySql } from './policy-sql';
import { readParcelsBin } from './scenario';

export { POLICY_BIN };
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
  }
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
      4,
      'SB 79 as written',
      [],
      'Not computed in this dataset: every parcel is outside, with no stories, cap or yield.'
    ),
    currentLaw: prov(
      3,
      'Current law (FZP + §207.11)',
      [SRC.height, SRC.roll, SRC.attrs],
      'The FZP envelope, cap and yields of parcels.bin. The FZP yield cap is none on Local ' +
        `Program parcels and the base-zoning cap on ${capDate} elsewhere. §207.11 is not applied ` +
        'in this dataset.'
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
  historic: string;
  permanent: boolean;
  temporary: boolean;
}

/**
 * The policy build step. Needs the scenario step's tables (sc_zoning, sc_district) and its
 * `scenarios/fzp/parcels.bin`, and `records` as writeScenario took them. Runs runPolicySql, writes
 * `<outDir>/scenarios/fzp/policy.bin` and reports sd.historic.no-row and sd.exempt.unmatched into
 * `buildCounts` (T14). Returns the policy.* counts and warnings. Throws when the written file does
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
  await runPolicySql(db, []);

  const rows = await db.all<PolicyRow>(
    `SELECT z.id, z.zoning_code, d.r4, h.code AS historic, e.permanent, e.temporary
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
    currentStories: Uint8Array.from(s.envelopeStories),
    currentCap: new Uint16Array(n),
    currentYield: Uint16Array.from(s.yield),
    hostableSb79: new Uint8Array(n),
    hostableCurrent: Uint8Array.from(s.hostable),
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
    'exempt.temporary'
  ])
    c[`policy.${k}`] = 0;

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
  }
  p.currentCap.set(p.fzpYieldCap);

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

  const counts = Object.fromEntries(Object.entries(c).sort(([x], [y]) => cmp(x, y)));
  return { counts, warnings };
}
