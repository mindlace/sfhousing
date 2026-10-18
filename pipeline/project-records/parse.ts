/**
 * Parses the seven DataSF row sets into typed records (spec 4.1 Parsing). Every raw array is
 * sorted by canonical JSON first, so results do not depend on row order.
 */
import { canonicalJson, type Lock } from '../lib/lock';
import type { Day } from '../../src/lib/timelapse/time';
import {
  PROJECT_SOURCE_IDS,
  type AddressRow,
  type Child,
  type Completion,
  type HousingRow,
  type Parsed,
  type Permit,
  type PipelineRow,
  type Prj,
  type ProjectSourceId,
  type RawRow,
  type Review
} from './types';

const DAY_MS = 86_400_000;
const DATE_RE = /^\s*(\d{4})-(\d{2})-(\d{2})/;

/**
 * Leading `YYYY-MM-DD` of a SODA floating timestamp as a UTC day number; null when missing,
 * not a real calendar date, or outside `[0, asOf]` (clips junk such as 1909 and 2205 dates).
 */
export function dayOf(v: unknown, asOf: Day): Day | null {
  if (typeof v !== 'string') return null;
  const m = DATE_RE.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  const day = ms / DAY_MS;
  return day >= 0 && day <= asOf ? day : null;
}

/** 'YYYY-MM-DD' of a day number. */
export function isoOf(d: Day): string {
  return new Date(d * DAY_MS).toISOString().slice(0, 10);
}

/** SODA numbers are strings; non-finite, missing or empty become null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Splits a `building_permits` value on commas, semicolons and whitespace. */
export function splitPermits(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return v.split(/[,;\s]+/).filter((s) => s !== '');
}

/** `document_type`: any TCO is 'TCO'; a lone CFC (either case) is 'CFC'. */
export function docKind(v: unknown): 'TCO' | 'CFC' | null {
  if (typeof v !== 'string') return null;
  if (/tco/i.test(v)) return 'TCO';
  if (/^\s*cfc\s*$/i.test(v)) return 'CFC';
  return null;
}

/** UTC day of the newest `retrievedAt` in the lock. */
export function asOfFromLock(lock: Lock): Day {
  let newest = -Infinity;
  for (const e of lock.sources) {
    const t = Date.parse(e.retrievedAt);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (newest === -Infinity) throw new Error('lock has no valid retrievedAt');
  return Math.floor(newest / DAY_MS);
}

/** Trimmed string; null when missing or blank. */
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function blklotOf(block: unknown, lot: unknown): string | null {
  const b = str(block);
  const l = str(lot);
  return b !== null && l !== null ? b + l : null;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalSort(rows: readonly RawRow[]): RawRow[] {
  return rows
    .map((r) => [canonicalJson(r), r] as const)
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([, r]) => r);
}

/**
 * The `pr.date.valid-range` tally (spec §4.1): every non-empty date value read, the values
 * `dayOf` treated as missing, the source ids of the records that held one, and those records.
 */
interface DateCtx {
  asOf: Day;
  of: number;
  fired: number;
  ids: Set<string>;
  clipped: Set<object>;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Reads one record's dates through `dayOf`, counting each non-empty value and each one it
 * clips; `done` marks the record (and its source id) when any value was clipped.
 */
function dateReader(ctx: DateCtx) {
  let hit = false;
  return {
    day(v: unknown): Day | null {
      const d = dayOf(v, ctx.asOf);
      if (!isEmpty(v)) {
        ctx.of++;
        if (d === null) {
          ctx.fired++;
          hit = true;
        }
      }
      return d;
    },
    done<T extends object>(rec: T, id: string | null): T {
      if (hit) {
        ctx.clipped.add(rec);
        if (id !== null) ctx.ids.add(id);
      }
      return rec;
    }
  };
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function addressRow(r: RawRow): AddressRow {
  return {
    blklot: blklotOf(r.block, r.lot),
    streetNumber: str(r.street_number),
    streetName: str(r.street_name),
    streetSuffix: str(r.street_suffix),
    primary: r.primary_address_flag === 'Y'
  };
}

function compareAddress(a: AddressRow, b: AddressRow): number {
  return (
    cmp(a.blklot ?? '', b.blklot ?? '') ||
    cmp(a.streetNumber ?? '', b.streetNumber ?? '') ||
    cmp(a.streetName ?? '', b.streetName ?? '') ||
    cmp(a.streetSuffix ?? '', b.streetSuffix ?? '') ||
    Number(b.primary) - Number(a.primary)
  );
}

function parsePermits(
  rows: RawRow[],
  dates: DateCtx,
  counts: Record<string, number>
): Map<string, Permit> {
  const id: ProjectSourceId = 'datasf-permits-newcon';
  const groups = new Map<string, RawRow[]>();
  for (const r of rows) {
    const number = str(r.permit_number);
    if (number === null) {
      bump(counts, `parse.dropped.${id}`);
      continue;
    }
    const g = groups.get(number);
    if (g) g.push(r);
    else groups.set(number, [r]);
  }
  const permits = new Map<string, Permit>();
  for (const number of [...groups.keys()].sort(cmp)) {
    const group = groups.get(number)!; // already in canonical order
    const lead = group.find((r) => r.primary_address_flag === 'Y') ?? group[0];
    const d = dateReader(dates);
    const permit: Permit = {
      number,
      sitePermit: lead.site_permit === 'Y',
      status: (str(lead.status) ?? '').toLowerCase(),
      statusDay: d.day(lead.status_date),
      filedDay: d.day(lead.filed_date) ?? d.day(lead.permit_creation_date),
      issuedDay: d.day(lead.issued_date),
      fcdDay: d.day(lead.first_construction_document_date),
      completedDateDay: d.day(lead.completed_date),
      lastActivityDay: d.day(lead.last_permit_activity_date),
      stories: num(lead.number_of_proposed_stories),
      existingUnits: num(lead.existing_units),
      proposedUnits: num(lead.proposed_units),
      // Ruling E2: the valuation that sets the Table B bracket is the value after project review
      // when present, else the estimate at filing.
      valuation: num(lead.revised_cost) ?? num(lead.estimated_cost),
      rows: group.map(addressRow).sort(compareAddress)
    };
    permits.set(number, d.done(permit, number));
  }
  return permits;
}

function parsePrjs(
  rows: RawRow[],
  dates: DateCtx,
  counts: Record<string, number>
): Map<string, Prj> {
  const id: ProjectSourceId = 'datasf-planning-projects';
  const found: Prj[] = [];
  for (const r of rows) {
    const recordId = str(r.record_id);
    if (recordId === null) {
      bump(counts, `parse.dropped.${id}`);
      continue;
    }
    const d = dateReader(dates);
    const prj: Prj = {
      recordId,
      status: str(r.record_status),
      address: str(r.project_address),
      blklot: blklotOf(r.block, r.lot),
      openDay: d.day(r.open_date),
      closeDay: d.day(r.close_date),
      permits: splitPermits(r.building_permits),
      decision: str(r.project_decision),
      decisionDay: d.day(r.project_decision_date),
      unitsProp: num(r.number_of_units_prop),
      unitsExist: num(r.number_of_units_exist),
      newConstruction: r.new_construction === 'CHECKED',
      sb35: r.sb35 === 'CHECKED',
      hsd: r.housing_sustainability_dist === 'CHECKED',
      ab2162: r.ab2162 === 'CHECKED',
      description: str(r.description)
    };
    found.push(d.done(prj, recordId));
  }
  // Stable sort: ties keep canonical order, so the first duplicate is the canonical-first row.
  found.sort((a, b) => cmp(a.recordId, b.recordId));
  const prjs = new Map<string, Prj>();
  for (const p of found) {
    if (prjs.has(p.recordId)) bump(counts, `parse.duplicate.${id}`);
    else prjs.set(p.recordId, p);
  }
  return prjs;
}

/**
 * Parses all seven row sets. `asOf` bounds every date: a non-empty date outside
 * `[1970-01-01, asOf]` or not a calendar date is missing (rule `pr.date.valid-range`), counted in
 * `dates` and its record put in `clipped`.
 */
export function parseAll(raw: Record<ProjectSourceId, RawRow[]>, asOf: Day): Parsed {
  const counts: Record<string, number> = {};
  const dates: DateCtx = { asOf, of: 0, fired: 0, ids: new Set(), clipped: new Set() };
  const sorted = {} as Record<ProjectSourceId, RawRow[]>;
  for (const id of PROJECT_SOURCE_IDS) sorted[id] = canonicalSort(raw[id] ?? []);

  const permits = parsePermits(sorted['datasf-permits-newcon'], dates, counts);
  const prjs = parsePrjs(sorted['datasf-planning-projects'], dates, counts);

  const children: Child[] = [];
  for (const r of sorted['datasf-planning-records']) {
    const recordId = str(r.record_id);
    if (recordId === null) {
      bump(counts, 'parse.dropped.datasf-planning-records');
      continue;
    }
    const d = dateReader(dates);
    const child: Child = {
      recordId,
      type: str(r.record_type) ?? '',
      status: str(r.record_status),
      blklot: blklotOf(r.block, r.lot),
      parentId: str(r.parent_id),
      openDay: d.day(r.open_date),
      closeDay: d.day(r.close_date)
    };
    children.push(d.done(child, recordId));
  }

  const reviews: Review[] = [];
  for (const r of sorted['datasf-planning-review']) {
    const recordId = str(r.b1_alt_id);
    if (recordId === null) {
      bump(counts, 'parse.dropped.datasf-planning-review');
      continue;
    }
    const d = dateReader(dates);
    const review: Review = {
      recordId,
      startType: str(r.start_event_type),
      startDay: d.day(r.start_event_date),
      endType: str(r.end_event_type),
      endDay: d.day(r.end_event_date)
    };
    reviews.push(d.done(review, recordId));
  }

  const completions: Completion[] = [];
  for (const r of sorted['datasf-unit-completions']) {
    const permit = str(r.building_permit_application);
    if (permit === null) {
      bump(counts, 'parse.dropped.datasf-unit-completions');
      continue;
    }
    const d = dateReader(dates);
    const completion: Completion = {
      permit,
      day: d.day(r.date_issued),
      kind: docKind(r.document_type),
      units: num(r.number_of_units_certified)
    };
    completions.push(d.done(completion, permit));
  }

  const housing: HousingRow[] = sorted['datasf-housing-production'].map((r) => {
    const d = dateReader(dates);
    const row: HousingRow = {
      bpa: str(r.bpa),
      blklot: str(r.blocklot),
      form: str(r.form_no),
      netUnits: num(r.net_units_completed),
      firstCompletionDay: d.day(r.first_completion_date)
    };
    return d.done(row, row.bpa);
  });

  const pipeline: PipelineRow[] = sorted['datasf-dev-pipeline'].map((r, idx) => {
    const caseNo = str(r.case_no);
    const bpaNo = str(r.bpa_no);
    const d = dateReader(dates);
    const row: PipelineRow = {
      idx,
      blklot: str(r.blklot),
      nameaddr: str(r.nameaddr),
      status: str(r.current_status),
      statusDay: d.day(r.current_status_date),
      approvedDay: d.day(r.approved_date_planning),
      caseNo,
      bpaNo,
      newUnits: num(r.new_pipeline_units),
      existingUnits: num(r.existing_units),
      proposedUnits: num(r.proposed_units),
      completedNewUnits: num(r.completed_new_units),
      netUnits: num(r.net_pipeline_units),
      description: str(r.description_planning),
      da: str(r.da),
      prx: caseNo !== null && caseNo.endsWith('PRX')
    };
    return d.done(row, caseNo ?? bpaNo);
  });

  return {
    asOf,
    permits,
    prjs,
    children,
    reviews,
    completions,
    housing,
    pipeline,
    counts,
    dates: { of: dates.of, fired: dates.fired, sample: [...dates.ids].sort(cmp) },
    clipped: dates.clipped
  };
}
