/**
 * In-flight fields, the staleness / in-flight decision and the T4d history extras (spec 4.3 net
 * units, 4.7 in flight and stale-open, 4.8 label, units, existing units, stories, sources).
 * Pure functions over a `LinkedProject`; deriveProjects composes them.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { InFlightProject } from '../../src/lib/timelapse/projects';
import type { Day } from '../../src/lib/timelapse/time';
import { STAGE_ORDER } from '../../src/lib/timelapse/types';
import type { ProjectHistory, Stage } from '../../src/lib/timelapse/types';
import { MIN_GROSS_M2_PER_UNIT } from '../lib/quality';
import { isNewConstruction } from './classify';
import { permitCompletionDay, pipelineStage } from './stages';
import { DATASET } from './types';
import type { LinkedProject, Permit, ProjectRecordsInput } from './types';

/** Tier 1: 92 days is one quarter, the pipeline dataset's published refresh cadence. */
export const STALE_WINDOW_DAYS = 92;

/** Reconciliation: parsed stories outside 1..MAX_STORIES are discarded. */
export const MAX_STORIES = 80;

export type SourceRef = InFlightProject['sources'][number];

/** Spec 4.8 label rule 1: '123 MAIN ST' to '123 Main St'; ordinals stay lower-case ('16TH' to '16th'). */
export function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function nonBlank(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === '' ? null : t;
}

/** Spec 4.8 label rules 0 to 4; `curated` is the multiphase.json label for a PRX row. */
export function labelOf(proj: LinkedProject, curated: string | null): string | null {
  const first = proj.pipelineRows[0];
  if (curated !== null && proj.kind === 'pipelineOnly' && first !== undefined && first.prx) {
    return curated;
  }
  const primaryRow = proj.lead?.rows.find((r) => r.primary);
  if (primaryRow !== undefined) {
    const parts = [primaryRow.streetNumber, primaryRow.streetName, primaryRow.streetSuffix]
      .map(nonBlank)
      .filter((p): p is string => p !== null);
    if (parts.length > 0) return titleCase(parts.join(' '));
  }
  const address = nonBlank(proj.primary?.address);
  if (address !== null) return address;
  for (const r of proj.pipelineRows) {
    // Not from a row linked under DQ-2 (spec 4.2 step 10).
    if (r.linkedNoDate) continue;
    const name = nonBlank(r.nameaddr);
    if (name !== null) return name;
  }
  return null;
}

/**
 * Spec 4.8 capacity (`pr.units.capacity`): false when the permit's `proposed_units` exceeds
 * `Σ areaM2(parcelIds) x max(stories, 1) / MIN_GROSS_M2_PER_UNIT`, i.e. cannot physically fit. The
 * check needs the permit's own recorded stories and units and at least one parcel; without them it
 * passes. `parcelIds` are the permit's project parcels.
 */
export function capacityOk(
  permit: Permit,
  parcelIds: readonly ParcelId[],
  areaM2: ProjectRecordsInput['areaM2']
): boolean {
  if (permit.stories === null || permit.proposedUnits === null || parcelIds.length === 0) {
    return true;
  }
  let area = 0;
  for (const id of parcelIds) area += areaM2(id);
  return permit.proposedUnits <= (area * Math.max(permit.stories, 1)) / MIN_GROSS_M2_PER_UNIT;
}

/** A project after the capacity rule, with what the `pr.units.capacity` tally needs. */
export interface Capacity {
  /** The project with every failing permit's `proposedUnits` set to null (same object if none). */
  proj: LinkedProject;
  /** The project as linked. */
  original: LinkedProject;
  /** Permits with recorded stories and units on a project with parcels (original units). */
  checked: Permit[];
  /** The `checked` permits that fail `capacityOk` (original units). */
  failing: Permit[];
}

/**
 * Applies `capacityOk` once per permit, before any consumer reads units (rule 1 and `unitsAt`
 * here, the phase-size medians and `permits.parquet` in assemble). A failing permit is replaced
 * by a copy with null units in `permits`, `live` and `lead`; nothing else changes.
 */
export function applyCapacity(
  proj: LinkedProject,
  areaM2: ProjectRecordsInput['areaM2']
): Capacity {
  const checked: Permit[] = [];
  const failing: Permit[] = [];
  if (proj.parcelIds.length > 0) {
    for (const q of proj.permits) {
      if (q.stories === null || q.proposedUnits === null) continue;
      checked.push(q);
      if (!capacityOk(q, proj.parcelIds, areaM2)) failing.push(q);
    }
  }
  if (failing.length === 0) return { proj, original: proj, checked, failing };
  const voided = new Map(failing.map((q) => [q, { ...q, proposedUnits: null }]));
  const swap = (q: Permit): Permit => voided.get(q) ?? q;
  return {
    proj: {
      ...proj,
      permits: proj.permits.map(swap),
      live: proj.live.map(swap),
      lead: proj.lead === null ? null : swap(proj.lead)
    },
    original: proj,
    checked,
    failing
  };
}

/** The live set, else (all permits dead) the non-superseded permits. */
export function unitBearingPermits(proj: LinkedProject): Permit[] {
  if (proj.live.length > 0) return proj.live;
  return proj.permits.filter((q) => !proj.superseded.has(q.number));
}

function sumProposed(permits: Permit[]): number | null {
  let sum = 0;
  let any = false;
  for (const q of permits) {
    if (q.proposedUnits !== null) {
      sum += q.proposedUnits;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Spec 4.8 units (gross). Null when no rule yields a number. */
export function grossUnits(proj: LinkedProject): number | null {
  if (proj.kind === 'pipelineOnly') return proj.pipelineRows[0]?.newUnits ?? null;
  const permitSum = sumProposed(unitBearingPermits(proj));
  if (permitSum !== null) return permitSum;
  const prop = proj.primary?.unitsProp ?? null;
  if (prop !== null && prop > 0) return prop;
  // Rule 3 stops short of a row linked under DQ-2 (spec 4.2 step 10).
  for (const r of proj.pipelineRows) if (!r.linkedNoDate && r.newUnits !== null) return r.newUnits;
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
};

const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';

/**
 * Spec 4.8 stories rule 2. The lookbehinds keep the match to a whole number: no digit or letter
 * before it, and no tens word before a units word ('eighty-one-story' is a compound this rule
 * cannot read, so it yields nothing instead of 'one').
 */
const STORIES_RE = new RegExp(
  `(?<![a-z0-9])(?<!(?:${TENS})[\\s-])(\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})[\\s-]*stor(?:y|ies)`,
  'i'
);
const FEET_RE = /(?<!\d)(\d{2,3})[\s-]*(?:foot|feet|ft)\b/i;
const KEYWORD_RE = /\b(construct|erect|new|build)\b/i;

function inRange(n: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= MAX_STORIES ? n : null;
}

/** Spec 4.8 stories rules 2 and 3 on one text, before the 1..80 range check; null if none. */
export function parseStoriesValue(text: string | null): number | null {
  if (text === null) return null;
  const kw = KEYWORD_RE.exec(text);
  if (kw === null) return null;
  const rest = text.slice(kw.index + kw[0].length);
  const s = STORIES_RE.exec(rest);
  if (s !== null) {
    const token = s[1].toLowerCase();
    return NUMBER_WORDS[token] ?? Number(token);
  }
  const f = FEET_RE.exec(rest);
  if (f !== null) return Math.floor(Number(f[1]) / 10);
  return null;
}

/** Spec 4.8 stories rules 2 and 3 on one text; null when nothing in 1..80 is found. */
export function parseStories(text: string | null): number | null {
  const n = parseStoriesValue(text);
  return n === null ? null : inRange(n);
}

/**
 * Spec 4.8 `stories` and `storiesTier`, with the `pr.stories.parse-range` tally of the texts read:
 * `parsed` values read from text and `discarded` ones outside 1..80 (the next text is then tried).
 */
export function storiesDetail(proj: LinkedProject): {
  stories: number | null;
  tier: 0 | 3 | null;
  parsed: number;
  discarded: number;
} {
  let max = 0;
  for (const q of unitBearingPermits(proj)) {
    if (q.stories !== null && q.stories > max) max = q.stories;
  }
  if (max > 0) return { stories: max, tier: 0, parsed: 0, discarded: 0 };
  const anchors = [...proj.anchors].sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  const ordered = proj.primary === null ? anchors : [proj.primary, ...anchors];
  const texts = [
    ...ordered.map((a) => a.description),
    // A row linked under DQ-2 contributes only its source and the pipeline match (spec 4.2 step 10).
    ...proj.pipelineRows.filter((r) => !r.linkedNoDate).map((r) => r.description)
  ];
  let parsed = 0;
  let discarded = 0;
  for (const t of texts) {
    const raw = parseStoriesValue(t);
    if (raw === null) continue;
    parsed++;
    const n = inRange(raw);
    if (n !== null) return { stories: n, tier: 3, parsed, discarded };
    discarded++;
  }
  return { stories: null, tier: null, parsed, discarded };
}

/** Spec 4.8 `stories` and `storiesTier`. */
export function storiesOf(proj: LinkedProject): { stories: number | null; tier: 0 | 3 | null } {
  const { stories, tier } = storiesDetail(proj);
  return { stories, tier };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Spec 4.8 `sources`: every linked record, with the key table, sorted and unique. */
export function sourcesOf(proj: LinkedProject): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  const add = (dataset: string, id: string, key?: string): void => {
    const k = `${dataset}\0${id}\0${key ?? ''}`;
    if (seen.has(k)) return;
    seen.set(k, key === undefined ? { dataset, id } : { dataset, id, key });
  };
  for (const a of proj.anchors) add(DATASET['datasf-planning-projects'], a.recordId);
  for (const a of proj.satellites) add(DATASET['datasf-planning-projects'], a.recordId);
  for (const c of proj.children) add(DATASET['datasf-planning-records'], c.recordId);
  for (const c of proj.sourceOnlyChildren) add(DATASET['datasf-planning-records'], c.recordId);
  for (const r of proj.reviews) add(DATASET['datasf-planning-review'], r.recordId, 'b1_alt_id');
  for (const q of proj.permits) add(DATASET['datasf-permits-newcon'], q.number, 'permit_number');
  for (const c of proj.completions) {
    add(DATASET['datasf-unit-completions'], c.permit, 'building_permit_application');
  }
  for (const r of proj.pipelineRows) {
    if (r.caseNo !== null) add(DATASET['datasf-dev-pipeline'], r.caseNo, 'case_no');
    else if (r.bpaNo !== null) add(DATASET['datasf-dev-pipeline'], r.bpaNo, 'bpa_no');
  }
  return [...seen.values()].sort(
    (a, b) => cmp(a.dataset, b.dataset) || cmp(a.id, b.id) || cmp(a.key ?? '', b.key ?? '')
  );
}

/** Spec 4.8 `existingUnits`: Σ over parcels of the assessor units, null as 0. */
export function existingUnitsAt(
  ids: ParcelId[],
  rollYear: number,
  f: ProjectRecordsInput['assessorUnits']
): number {
  let sum = 0;
  for (const id of ids) sum += f(id, rollYear) ?? 0;
  return sum;
}

/** The roll year of a day: its UTC year clamped to `[2007, latest]`. */
export function rollYearOf(day: Day, latest: number): number {
  const year = new Date(day * 86_400_000).getUTCFullYear();
  return Math.min(Math.max(year, 2007), latest);
}

/** Spec 4.8 `unitsAt` (tier 2: current values across records, not snapshots). */
export function unitsAt(proj: LinkedProject): Partial<Record<Stage, number>> {
  const out: Partial<Record<Stage, number>> = {};
  const filed = proj.primary?.unitsProp ?? null;
  if (filed !== null) out.filed = filed;
  const bearing = unitBearingPermits(proj);
  const permitFiled = sumProposed(bearing);
  if (permitFiled !== null) out.permitFiled = permitFiled;

  const withUnits = bearing.filter((q) => q.proposedUnits !== null && q.proposedUnits > 0);
  if (
    withUnits.length > 0 &&
    withUnits.every((q) => permitCompletionDay(q, proj.completions) !== null)
  ) {
    let total = 0;
    for (const q of withUnits) {
      let tco = 0;
      let cfc = 0;
      for (const c of proj.completions) {
        if (c.permit !== q.number || c.units === null) continue;
        if (c.kind === 'TCO') tco += c.units;
        else if (c.kind === 'CFC' && c.units > cfc) cfc = c.units;
      }
      total += Math.max(tco, cfc);
    }
    if (total > 0) out.complete = total;
  }
  return out;
}

/** Spec 4.8 `baseStoriesAtFiling`: max over parcels of the panel base stories, else null. */
export function baseStoriesAt(
  ids: ParcelId[],
  rollYear: number,
  f: ProjectRecordsInput['baseStories']
): number | null {
  let max: number | null = null;
  for (const id of ids) {
    const v = f(id, rollYear);
    if (v !== null && (max === null || v > max)) max = v;
  }
  return max;
}

/**
 * Spec 4.3 population: new construction with net units (units minus assessor units at filing)
 * >= 1; PPA-only projects always; pipeline-only rows when they have >= 1 new unit.
 */
export function isPopulation(
  proj: LinkedProject,
  units: number | null,
  existingAtFiling: number
): boolean {
  if (proj.kind === 'ppaOnly') return true;
  if (proj.kind === 'pipelineOnly') return units !== null && units >= 1;
  return isNewConstruction(proj) && units !== null && units - existingAtFiling >= 1;
}

export type InFlightStatus =
  'inFlight' | 'staleOpen' | 'netDropped' | 'ended' | 'noUnits' | 'noParcels' | 'notPopulation';

/** Spec 4.7 in-flight decision; the first failing check names the status. `end` is null for pipeline-only. */
export function inFlightStatus(
  proj: LinkedProject,
  c: {
    inPopulation: boolean;
    end: ProjectHistory['end'] | null;
    units: number | null;
    existingLatest: number;
    firstEntered: Day | null;
    pipelineCutoff: Day;
    multiPhase: boolean;
  }
): InFlightStatus {
  if (!c.inPopulation) return 'notPopulation';
  if (proj.kind !== 'pipelineOnly' && c.end !== null && c.end.kind !== 'open') return 'ended';
  if (
    proj.pipelineRows.length === 0 &&
    (c.firstEntered === null || c.firstEntered <= c.pipelineCutoff - STALE_WINDOW_DAYS)
  ) {
    return 'staleOpen';
  }
  if (c.units === null || c.units < 1) return 'noUnits';
  if (proj.parcelIds.length === 0) return 'noParcels';
  if (!c.multiPhase && c.units - c.existingLatest < 1) return 'netDropped';
  return 'inFlight';
}

/**
 * Spec 4.7 records win (`pr.pipeline.records-win`): the project holds a pipeline row and its
 * history ends complete or exit, or its last entered stage differs from the stage a row's
 * `current_status` maps to. A status that maps to no stage is not a mismatch.
 */
export function pipelineConflict(
  proj: LinkedProject,
  end: ProjectHistory['end'] | null,
  entered: Partial<Record<Stage, Day>>
): boolean {
  if (proj.pipelineRows.length === 0) return false;
  if (end !== null && end.kind !== 'open') return true;
  let last: Stage | null = null;
  for (const s of STAGE_ORDER) if (entered[s] !== undefined) last = s;
  if (last === null) return false;
  return proj.pipelineRows.some((r) => {
    const s = pipelineStage(r.status);
    return s !== null && s !== last;
  });
}
