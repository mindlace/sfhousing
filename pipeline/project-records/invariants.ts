/**
 * Invariants V20-V24 (spec 4.9 table). V20 runs on the written `projects.json` bytes; V21-V24 on
 * the in-memory `V2xInputs` that deriveProjects returns. Thresholds are the caller's (they live in
 * `InvariantProfile`): tier-4 check bounds, not model numbers.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import {
  ProjectsFormatError,
  parseProjectsFile,
  type ProjectsFile
} from '../../src/lib/timelapse/projects';
import type { Day } from '../../src/lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER } from '../../src/lib/timelapse/types';
import type { ProjectHistory, Stage } from '../../src/lib/timelapse/types';
import type { InvariantResult } from '../steps/check';
import { SCALE_BOUNDS } from './multiphase';
import { checkRhna } from './rhna';

export interface V2xInputs {
  asOf: Day;
  file: ProjectsFile;
  histories: ProjectHistory[];
  /** V21: in-flight units matched to population pipeline rows, rows the records show ended excluded. */
  coverage: { matchedUnits: number; rowUnits: number; rows: number };
  /** V22: net units per calendar year wholly inside the window, and the headline total. */
  rhna: { byYear: Record<number, number>; total: number };
  multiphase: {
    /** buildPhases problems. */
    problems: string[];
    /** checkMultiphaseFile output. */
    fileProblems: string[];
    /** Ids of in-flight masters left with `phases: null` (last resort). */
    lastResort: string[];
    /** Enriched masters' scale factor R / Σ, by case number. */
    scales: Record<string, number>;
  };
}

/** At most this many problems are spelled out in a detail. */
const DETAIL_LIMIT = 5;

function result(id: InvariantResult['id'], problems: string[], okDetail: string): InvariantResult {
  if (problems.length === 0) return { id, ok: true, detail: okDetail };
  const shown = problems.slice(0, DETAIL_LIMIT).join('; ');
  const more = problems.length > DETAIL_LIMIT ? `; and ${problems.length - DETAIL_LIMIT} more` : '';
  return { id, ok: false, detail: `${problems.length} problem(s): ${shown}${more}` };
}

/** V20: the T3 validator on the file bytes, plus the engineering size budget. */
export function checkV20(
  bytes: Buffer,
  opts: { asOf: Day; parcelIds: ReadonlySet<ParcelId>; maxBytes: number; warnBytes: number }
): InvariantResult {
  const size = bytes.length;
  let file: ProjectsFile;
  try {
    file = parseProjectsFile(JSON.parse(bytes.toString('utf8')), {
      asOf: opts.asOf,
      parcelIds: opts.parcelIds
    });
  } catch (e) {
    if (e instanceof ProjectsFormatError || e instanceof SyntaxError) {
      return { id: 'V20', ok: false, detail: e.message };
    }
    throw e;
  }
  if (size > opts.maxBytes) {
    return {
      id: 'V20',
      ok: false,
      detail: `projects.json is ${size} bytes, exceeds maxBytes ${opts.maxBytes}`
    };
  }
  const warn =
    size > opts.warnBytes
      ? `; warning: ${size} bytes is above the ${opts.warnBytes}-byte budget`
      : '';
  return {
    id: 'V20',
    ok: true,
    detail: `${file.projects.length} projects, ${size} bytes${warn}`
  };
}

/** V21: Σ matched in-flight units ≥ `min` × Σ `new_pipeline_units` of the matched rows. */
export function checkV21(i: V2xInputs, min: number): InvariantResult {
  const { matchedUnits, rowUnits, rows } = i.coverage;
  if (rows === 0 || rowUnits <= 0) {
    return { id: 'V21', ok: false, detail: `no population pipeline rows to cover (${rows} rows)` };
  }
  const ratio = matchedUnits / rowUnits;
  const ok = matchedUnits >= min * rowUnits - 1e-9;
  return {
    id: 'V21',
    ok,
    detail: `coverage ${ratio.toFixed(4)} (${matchedUnits} of ${rowUnits} units, ${rows} rows), min ${min}`
  };
}

/**
 * V22: `rhnaCompletedNet` against the Housing Inventory. Only years wholly inside the window
 * (keys of `rhna.byYear`) with a `hiNet` entry are compared; with none compared, V22 fails.
 */
export function checkV22(
  i: V2xInputs,
  hiNet: Record<number, number>,
  tol: { year: number; total: number }
): InvariantResult {
  const compared: Record<number, number> = {};
  for (const k of Object.keys(hiNet)) {
    if (Object.hasOwn(i.rhna.byYear, k)) compared[Number(k)] = hiNet[Number(k)];
  }
  if (Object.keys(compared).length === 0) {
    return {
      id: 'V22',
      ok: false,
      detail: `no cross-check year compared (records years ${Object.keys(i.rhna.byYear).join(', ') || 'none'}; hiNet years ${Object.keys(hiNet).join(', ') || 'none'})`
    };
  }
  const r = checkRhna(i.rhna.byYear, i.rhna.total, compared, tol);
  return { id: 'V22', ok: r.ok, detail: r.detail };
}

function firstAndLast(entered: Partial<Record<Stage, Day>>): { first: Day; last: Day } | null {
  let first: Day | null = null;
  let last: Day | null = null;
  for (const s of STAGE_ORDER) {
    const d = entered[s];
    if (d === undefined) continue;
    if (first === null) first = d;
    last = d;
  }
  return first === null ? null : { first, last: last as Day };
}

/** V23: history integrity, a history per T3 pathway, and rerun identity. */
export function checkV23(i: V2xInputs, rerunIdentical: boolean): InvariantResult {
  const problems: string[] = [];
  if (!rerunIdentical) problems.push('deriveProjects run twice gave different bytes');
  for (const h of i.histories) {
    const at = `history ${h.id}`;
    const span = firstAndLast(h.entered);
    if (span === null) {
      problems.push(`${at}: entered is empty`);
      continue;
    }
    let prev = -Infinity;
    for (const s of STAGE_ORDER) {
      const d = h.entered[s];
      if (d === undefined) continue;
      if (d < prev) problems.push(`${at}: entered.${s} ${d} precedes an earlier stage`);
      prev = Math.max(prev, d);
    }
    const e = h.end;
    if (e.kind === 'open') {
      if (e.lastObserved < span.first || e.lastObserved > i.asOf) {
        problems.push(
          `${at}: lastObserved ${e.lastObserved} is outside [${span.first}, ${i.asOf}]`
        );
      }
      continue;
    }
    if (e.day < span.last) problems.push(`${at}: end day ${e.day} precedes the last entered day`);
    if (e.kind === 'complete' && h.entered.complete !== e.day) {
      problems.push(`${at}: complete at ${e.day} but entered.complete is ${h.entered.complete}`);
    }
    if (e.kind === 'exit' && h.entered[e.stage] === undefined) {
      problems.push(`${at}: exit stage ${e.stage} was not entered`);
    }
  }
  // Spec V23: each non-null pathway has a history (stage-calibration fits one table per pathway).
  const pathways = new Set(i.histories.map((h) => h.pathway));
  for (const p of PATHWAYS) {
    if (!pathways.has(p)) problems.push(`pathway ${p} has no history`);
  }
  return result('V23', problems, `${i.histories.length} histories`);
}

/** V24: multi-phase phasing (spec 4.10), recomputed from the file plus the build's problems. */
export function checkV24(i: V2xInputs): InvariantResult {
  const problems = [...i.multiphase.problems, ...i.multiphase.fileProblems];
  const lastResort = new Set(i.multiphase.lastResort);

  for (const [caseNo, s] of Object.entries(i.multiphase.scales)) {
    if (!(s >= SCALE_BOUNDS[0] && s <= SCALE_BOUNDS[1])) {
      problems.push(
        `${caseNo}: scale factor ${s} is outside [${SCALE_BOUNDS[0]}, ${SCALE_BOUNDS[1]}]`
      );
    }
  }

  let masters = 0;
  for (const p of i.file.projects) {
    if (!p.multiPhase) continue;
    masters++;
    const at = p.id;
    if (p.phases === null) {
      if (!lastResort.has(p.id)) problems.push(`${at}: phases is null and it is not a last resort`);
      continue;
    }
    if (p.phases.length === 0) {
      problems.push(`${at}: phases is empty`);
      continue;
    }
    const caseNo = p.id.startsWith('CASE:') ? p.id.slice('CASE:'.length) : p.id;
    const enriched = Object.hasOwn(i.multiphase.scales, caseNo);
    const own = new Set(p.parcelIds);
    const others = new Map<string, string>();
    for (const q of i.file.projects) {
      if (q.id === p.id) continue;
      for (const id of q.parcelIds) if (!others.has(id)) others.set(id, q.id);
    }
    const seen = new Set<string>();
    let sum = 0;
    p.phases.forEach((ph, k) => {
      const pa = `${at} phase ${k}`;
      sum += ph.units;
      if (!(ph.units >= 1)) problems.push(`${pa}: units ${ph.units} < 1`);
      if (ph.parcelIds.length === 0) problems.push(`${pa}: no parcels`);
      for (const id of ph.parcelIds) {
        if (!own.has(id)) problems.push(`${pa}: parcel ${id} is not among the master's parcels`);
        if (seen.has(id)) problems.push(`${pa}: parcel ${id} is in an earlier phase`);
        seen.add(id);
        const other = others.get(id);
        if (other !== undefined) problems.push(`${pa}: parcel ${id} is also in ${other}`);
      }
      const entitled = p.history.entitled;
      if (
        ph.plannedPermitFiled !== null &&
        entitled !== undefined &&
        ph.plannedPermitFiled <= entitled
      ) {
        problems.push(
          `${pa}: plannedPermitFiled ${ph.plannedPermitFiled} is not after history.entitled ${entitled}`
        );
      }
      if (enriched && ph.source === null) problems.push(`${pa}: enriched phase has no source`);
      if (!enriched && (ph.source !== null || ph.plannedPermitFiled !== null)) {
        problems.push(`${pa}: fallback phase must have source and plannedPermitFiled null`);
      }
    });
    if (sum !== p.units) problems.push(`${at}: Σ phases.units ${sum} ≠ units ${p.units}`);
  }
  return result('V24', problems, `${masters} multi-phase projects, ${lastResort.size} last resort`);
}
