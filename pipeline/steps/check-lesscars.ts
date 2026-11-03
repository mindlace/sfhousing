// Invariant V35 over the /lesscars files (docs/dev/lesscars.md): the published plan, sites,
// summary and timeline are present, decode, agree with parcels.bin and with each other. Kept out
// of check.ts like check-policy.ts; checkDataset calls checkV35 after V33.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  LESSCARS_FORMAT,
  SOURCES,
  decodeTimelinePayload,
  parsePlanFile,
  parseSitesFile,
  parseSummary
} from '../../src/lib/data/lesscars/codec';
import { TRANSIT_KINDS, type PlanProject } from '../../src/lib/data/lesscars/plan';
import {
  LESSCARS_HORIZON,
  checkPlan,
  schedulePlan,
  type ProjectTimes
} from '../../src/lib/data/lesscars/schedule';
import { parseManifest } from '../../src/lib/data/manifest';
import { reservationsOf } from '../lib/lesscars/runs';
import { LESSCARS_FILES, PARCELS_BIN } from '../lib/scenario-files';
import { readParcelsBin } from './scenario';
import type { InvariantResult } from './check';

/** V35 fails above this size for timeline.bin (tier 4 budget, as V19's). */
export const LESSCARS_TIMELINE_MAX_BYTES = 3e6;
/** V35 warns (still passes) above this size. */
export const LESSCARS_TIMELINE_WARN_BYTES = 2e6;

/** Plan projects that give a freed or converted site (the only kinds that carry homes). */
const SITE_KINDS: readonly PlanProject['kind'][] = [
  'highway-truncation',
  'street-removal',
  'parking-conversion'
];

const sameTimes = (a: ProjectTimes, b: ProjectTimes) =>
  a.id === b.id &&
  a.startDay === b.startDay &&
  a.openDay === b.openDay &&
  a.closeDay === b.closeDay &&
  a.availableDay === b.availableDay &&
  a.build?.startDay === b.build?.startDay &&
  a.build?.completeDay === b.build?.completeDay;

const isoDay = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10);

/**
 * The first year end at which the summary's integer source sums (mean × seeds) do not add to the
 * difference of plan and baseline (`extra.mean` × seeds), as a message naming the year; null when
 * they all do, or when the summary is too malformed to tell (parseSummary then reports it).
 */
function sourceSumProblem(raw: unknown): string | null {
  const s = raw as {
    seeds?: number;
    yearEnds?: number[];
    extra?: { mean?: number[] };
    bySource?: Record<string, number[]>;
  };
  if (!s || typeof s.seeds !== 'number' || !Array.isArray(s.yearEnds)) return null;
  const mean = s.extra?.mean;
  if (!Array.isArray(mean)) return null;
  for (let i = 0; i < s.yearEnds.length; i++) {
    let sum = 0;
    let integral = true;
    for (const k of SOURCES) {
      const col = s.bySource?.[k];
      if (!Array.isArray(col) || typeof col[i] !== 'number') return null;
      const v = col[i] * s.seeds;
      if (Math.abs(v - Math.round(v)) > 1e-6) integral = false;
      sum += Math.round(v);
    }
    const want = mean[i] * s.seeds;
    if (!integral || Math.abs(sum - want) > 1e-6)
      return `year ${isoDay(s.yearEnds[i]).slice(0, 4)}: source sums ${sum} ≠ extra ${Math.round(want * 1e6) / 1e6}`;
  }
  return null;
}

/**
 * V35: OK with "no plan" when the manifest has no `scenarios.lesscars`. Otherwise every named
 * file exists and decodes; timeline.bin binds to parcels.bin; the plan passes checkPlan and its
 * times equal schedulePlan's; no site belongs to a project that is not a site kind; parking and
 * garage parcels hold no homes and every parking conversion depends directly on transit; a held
 * site's `heldBy` is an edge garage on one of its `parcels`; every freewayLand parcel is in some
 * site's `parcels` (one per polygon part) and is scenario-ineligible in parcels.bin; no timeline
 * build is on a held site; the timeline's reservation rows are exactly reservationsOf's reserved
 * rows; the
 * summary's source sums equal its differences at every year end and it has 41 year ends ending
 * 2068-12-31; timeline.bin is at most 3 MB, warning above 2 MB. Never throws.
 */
export function checkV35(outDir: string, counts: Record<string, number>): InvariantResult {
  void counts;
  const problems: string[] = [];
  const fail = (): InvariantResult => ({ id: 'V35', ok: false, detail: problems.join('; ') });
  let manifestHas: boolean;
  try {
    const mf = join(outDir, 'manifest.json');
    manifestHas =
      parseManifest(JSON.parse(readFileSync(mf, 'utf8'))).scenarios?.lesscars !== undefined;
  } catch (e) {
    problems.push(`manifest unreadable: ${(e as Error).message}`);
    return fail();
  }
  if (!manifestHas) return { id: 'V35', ok: true, detail: 'no plan' };

  const missing = Object.values(LESSCARS_FILES).filter((f) => !existsSync(join(outDir, f)));
  for (const f of missing) problems.push(`${f} is missing`);
  if (missing.length) return fail();

  try {
    const json = (f: string): unknown => JSON.parse(readFileSync(join(outDir, f), 'utf8'));
    const parcels = readParcelsBin(join(outDir, PARCELS_BIN));
    const planFile = parsePlanFile(json(LESSCARS_FILES.plan));
    const sites = parseSitesFile(json(LESSCARS_FILES.sites));
    const rawSummary = json(LESSCARS_FILES.summary);
    // Before parseSummary, which also rejects a bad sum but without naming the year.
    const badSum = sourceSumProblem(rawSummary);
    if (badSum) {
      problems.push(badSum);
      return fail();
    }
    const summary = parseSummary(rawSummary);
    const timelineFile = join(outDir, LESSCARS_FILES.timeline);
    const timeline = decodeTimelinePayload(
      new Uint8Array(inflateRawSync(readFileSync(timelineFile))),
      parcels
    );
    const { plan } = planFile;

    // The plan: rules and times.
    const sched = schedulePlan(plan);
    for (const pr of checkPlan(plan, sched)) problems.push(`${pr.project}: ${pr.code}`);
    if (planFile.times.length !== plan.projects.length)
      problems.push(`plan has ${planFile.times.length} times for ${plan.projects.length} projects`);
    for (const t of planFile.times) {
      const want = sched.times.get(t.id);
      if (!want || !sameTimes(t, want)) problems.push(`${t.id}: times differ from schedulePlan`);
    }

    // Sites and parking.
    const byId = new Map(plan.projects.map((p) => [p.id, p]));
    for (const s of sites.sites) {
      const p = byId.get(s.projectId);
      if (!p) problems.push(`site ${s.siteId}: unknown project ${s.projectId}`);
      else if (!SITE_KINDS.includes(p.kind))
        problems.push(`site ${s.siteId}: project ${p.id} is an amenity (${p.kind})`);
    }
    for (const p of plan.projects) {
      const parcel =
        p.kind === 'parking-conversion'
          ? p.parcel
          : p.kind === 'edge-garage' && 'parcel' in p.site
            ? p.site.parcel
            : null;
      if (parcel !== null) {
        const row = parcels.index.get(parcel);
        if (row === undefined) problems.push(`${p.id}: parcel ${parcel} is not in parcels.bin`);
        else if (parcels.existingUnits[row] !== 0)
          problems.push(`${p.id}: parcel ${parcel} has ${parcels.existingUnits[row]} homes`);
      }
      if (p.kind === 'parking-conversion') {
        const direct = p.dependsOn.some((d) => {
          const q = byId.get(d);
          return q !== undefined && TRANSIT_KINDS.includes(q.kind);
        });
        if (!direct) problems.push(`${p.id}: no direct transit dependency`);
      }
    }

    // Freed parcels and held sites.
    for (const s of sites.sites) {
      if (s.heldBy !== undefined) {
        const g = byId.get(s.heldBy);
        const on = g?.kind === 'edge-garage' && 'parcel' in g.site ? g.site.parcel : null;
        if (on === null || !(s.parcels ?? []).includes(on))
          problems.push(
            `site ${s.siteId} is held by ${s.heldBy}, which is no edge garage on its parcels`
          );
      }
      for (const id of s.parcels ?? []) {
        const row = parcels.index.get(id);
        if (row === undefined) problems.push(`freed parcel ${id} is not in parcels.bin`);
        else if (parcels.eligible[row] !== 0)
          problems.push(`freed parcel ${id} is scenario-eligible: its homes would count twice`);
      }
    }
    for (const p of plan.projects) {
      if (p.kind !== 'highway-truncation' || !p.freewayLand) continue;
      for (const id of p.freewayLand.parcels) {
        const n = sites.sites.filter((s) => s.parcels?.includes(id)).length;
        // A parcel of several polygon parts is one site per part (docs/dev/lesscars.md).
        if (n === 0) problems.push(`freed parcel ${id} is in ${n} sites`);
      }
    }
    const held = new Set(sites.sites.filter((s) => s.heldBy !== undefined).map((s) => s.siteId));
    for (const b of timeline.builds)
      if (b.parcelRow === null && held.has(b.siteId))
        problems.push(`timeline builds on held site ${b.siteId}`);

    // The timeline's reservation verdicts cover exactly the plan's reserved parcels.
    let reserved: Int32Array | null = null;
    try {
      reserved = reservationsOf(plan, sched, parcels);
    } catch (e) {
      problems.push((e as Error).message);
    }
    if (reserved !== null) {
      const want: number[] = [];
      reserved.forEach((d, row) => {
        if (d !== 0) want.push(row);
      });
      const got = timeline.reservations.map((r) => r.row);
      if (want.length !== got.length || want.some((row, i) => row !== got[i]))
        problems.push(
          `timeline reservations ≠ plan's reserved parcels (rows ${got.join(',') || 'none'} vs ` +
            `${want.join(',') || 'none'})`
        );
    }

    // The summary.
    const y = summary.yearEnds.length;
    if (y !== 41) problems.push(`summary has ${y} year ends, not 41`);
    if (summary.yearEnds[y - 1] !== LESSCARS_HORIZON)
      problems.push(`summary ends ${isoDay(summary.yearEnds[y - 1])}, not 2068-12-31`);
    if (summary.format !== LESSCARS_FORMAT) problems.push('summary format');

    // Size.
    const bytes = statSync(timelineFile).size;
    if (bytes > LESSCARS_TIMELINE_MAX_BYTES)
      problems.push(`timeline.bin is ${bytes} B, over ${LESSCARS_TIMELINE_MAX_BYTES / 1e6} MB`);
    if (problems.length === 0) {
      const warn =
        bytes > LESSCARS_TIMELINE_WARN_BYTES
          ? `; warn: timeline.bin over ${LESSCARS_TIMELINE_WARN_BYTES / 1e6} MB`
          : '';
      return {
        id: 'V35',
        ok: true,
        detail: `${plan.projects.length} projects, ${sites.sites.length} sites, ${y} year ends${warn}`
      };
    }
  } catch (e) {
    problems.push((e as Error).message);
  }
  return fail();
}
