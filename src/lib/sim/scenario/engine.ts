// The deterministic schedule engine behind `simulate` (spec §4.4). Pure and worker-safe: every
// number comes from the SimInput, every uniform from the counter-based draws, and `exp`/`log`
// only from `src/lib/timelapse/math.ts` (via T12).
//
// A run is a sequence of passes over one `Run`:
//   1. the pipeline pass: every runnable unphased T3 row becomes a Schedule (§4.4.3), and the
//      parcels it holds are recorded in `Holds` (how each holder ends, its first construction);
//   2. the multi-phase pass (§4.4.3a): masters and their phase sub-projects;
//   3. the simulated pass (§4.4.4): initiation over the hostable parcels, reading `Holds`.
// Every pass steps stages with `runStages` and revises with `revise`, and hands each result to
// the `Sink`, so the detailed and the net consumers share one engine.
//
// Cost (spec §4.11: a band run is ≤ 15 ms on the bench city). What depends on the input only is
// computed once per input (`staticOf` here, `precomputeOf` in input.ts): project entities, T11
// rows and revision caps, the candidate rows and their entities. A run hoists its seed's mix
// (`seedHash`) and each project its stream (`streamOf`), so a draw is one mix. Stage steps call
// T12's `sampleTransition` itself (nothing here re-implements it). The simulated pass rejects
// most parcels on their first initiation draw against a precomputed bound (`skipAbove`) instead
// of evaluating the geometric month. None of this changes a value.
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, fillStories, type ScenarioParcels } from '$lib/data/scenario-codec';
import { log } from '$lib/timelapse/math';
import { sampleTransition } from '$lib/timelapse/model';
import type { InFlightProject } from '$lib/timelapse/projects';
import { MONTH_DAYS, monthsIn, type Day } from '$lib/timelapse/time';
import {
  PATHWAYS,
  STAGE_ORDER,
  type Calibration,
  type ExitReason,
  type Pathway,
  type RevisionModel,
  type Stage
} from '$lib/timelapse/types';
import type { StageScale } from '../levers/timers';
import { precomputeOf, sizeCumAgainst, type Precompute } from './input';
import { P, drawOn, jobEntity, seedHash, stageRedraw, streamOf } from './rng';
import type { Master } from './simulate';
import type { Schedule, SimInput } from './types';

/** Where the engine hands its results. */
export interface Sink {
  /**
   * False when the sink never reads a Schedule's `projectId` or `parcelIds` (the net fast path):
   * the engine then leaves a simulated Schedule's `projectId` '' and every `parcelIds` [] rather
   * than build them. Default true.
   */
  readonly ids?: boolean;
  schedule(s: Schedule): void;
  master(m: Master): void;
}

type End = Schedule['end'];
type Revision = Schedule['revisions'][number];
type Histogram = RevisionModel['at'][number]['ratio'];
type Kind = 'advance' | ExitReason;

const STAGE_INDEX = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i])) as Record<Stage, number>;
const CONSTRUCTION = STAGE_INDEX.construction;
const F = FILL_LEVELS.length;
/** In-flight redraws after the first attempt (8 attempts in all; tier 4, numerical only). */
const REDRAWS = 7;
/** The `parcelIds` of every Schedule a sink without `ids` receives. */
const NO_IDS: ParcelId[] = [];

/** The stage after `s` on pathway `p` (§4.4.2). */
export function nextStage(p: Pathway, s: Stage): Stage {
  switch (s) {
    case 'preApplication':
      return p === 'permitOnly' ? 'permitFiled' : 'filed';
    case 'filed':
      return 'entitled';
    case 'entitled':
      return 'permitFiled';
    case 'permitFiled':
      return 'permitIssued';
    case 'permitIssued':
      return 'construction';
    case 'construction':
      return 'complete';
    case 'complete':
      throw new Error('nextStage: complete is the last stage');
  }
}

/** The pipeline revision caps of a project on some T11 rows (§4.4.5 steps 3-4). */
interface Caps {
  /** Σ yield[F−1] of its parcels */
  yieldCap: number;
  /** max envelope stories of its parcels */
  envelope: number;
}

/** What one T3 row needs from the input, once per input. */
interface RowStatic extends Caps {
  entity: number; // jobEntity(id)
  rows: Int32Array; // T11 rows of `parcelIds` present in T11, in order
  /** phased rows only (§4.4.3a) */
  phased: {
    /** every parcel of the master and its phases, de-duplicated */
    all: Int32Array;
    /** the master's parcels in no phase */
    rest: Int32Array;
    phases: PhaseStatic[];
  } | null;
}

/** One phase sub-project of a phased row (§4.4.3a). */
interface PhaseStatic extends Caps {
  projectId: string; // '<masterId>:phase:<i>'
  entity: number; // jobEntity(projectId)
  rows: Int32Array;
  /** the T11 assessor units of its parcels */
  existing: number;
}

interface Static {
  rows: RowStatic[]; // index-aligned with input.projects
  /** 1 for a T11 row that some project names (only those can have a Hold) */
  held: Uint8Array;
}

const statics = new WeakMap<SimInput, Static>();

function rowsOf(parcels: ScenarioParcels, ids: readonly ParcelId[]): Int32Array {
  const out: number[] = [];
  for (const id of ids) {
    const i = parcels.index.get(id);
    if (i !== undefined) out.push(i);
  }
  return Int32Array.from(out);
}

/** A parcel absent from T11 contributes nothing to either cap (Review Focus 1). */
function capsOf(parcels: ScenarioParcels, rows: Int32Array): Caps {
  let yieldCap = 0;
  let envelope = 0;
  for (const i of rows) {
    yieldCap += parcels.yield[i * F + F - 1];
    envelope = Math.max(envelope, parcels.envelopeStories[i]);
  }
  return { yieldCap, envelope };
}

function staticOf(input: SimInput): Static {
  const hit = statics.get(input);
  if (hit) return hit;
  const parcels = input.parcels;
  const held = new Uint8Array(parcels.count);
  const mark = (rows: Int32Array) => {
    for (const i of rows) held[i] = 1;
  };
  const rows = input.projects.map((p): RowStatic => {
    const own = rowsOf(parcels, p.parcelIds);
    mark(own);
    let phased: RowStatic['phased'] = null;
    if (isPhased(p)) {
      const phases = p.phases ?? [];
      const inPhase = new Set(phases.flatMap((ph) => ph.parcelIds));
      phased = {
        all: rowsOf(parcels, [
          ...new Set([...p.parcelIds, ...phases.flatMap((ph) => ph.parcelIds)])
        ]),
        rest: rowsOf(
          parcels,
          p.parcelIds.filter((id) => !inPhase.has(id))
        ),
        phases: phases.map((ph, j) => {
          const projectId = `${p.id}:phase:${j + 1}`;
          const r = rowsOf(parcels, ph.parcelIds);
          mark(r);
          let existing = 0;
          for (const i of r) existing += parcels.existingUnits[i];
          return {
            projectId,
            entity: jobEntity(projectId),
            rows: r,
            existing,
            ...capsOf(parcels, r)
          };
        })
      };
    }
    return { entity: jobEntity(p.id), rows: own, phased, ...capsOf(parcels, own) };
  });
  const st = { rows, held };
  statics.set(input, st);
  return st;
}

/** One run's constants. */
interface Run {
  seed: number;
  /** `seedHash(seed)`: the seed's part of every draw */
  sh: number;
  horizon: Day;
  asOf: Day;
  /** `input.calibration`: in-flight transitions, and initiation, size, revision and phaseGap */
  cal: Calibration;
  /** `input.inFlightScale`; null = 1 */
  inFlightScale: StageScale | null;
  /** new projects' calibration (`input.newProjects`, else `cal`), and their scale; null = 1 */
  newCal: Calibration;
  newScale: StageScale | null;
  parcels: ScenarioParcels;
  input: SimInput;
  /** the per-input precompute (memoised by input identity): hazards, log(1 − h), size rows */
  pre: Precompute;
  st: Static;
  /** by STAGE_ORDER index: the first `revision.at` entry for the stage, if any */
  revisionAt: (RevisionModel['at'][number] | undefined)[];
  /** build `projectId` and `parcelIds` (Sink.ids) */
  ids: boolean;
}

function runOf(input: SimInput, seed: number, horizon: Day, ids: boolean): Run {
  const revisionAt: Run['revisionAt'] = STAGE_ORDER.map(() => undefined);
  for (const a of input.calibration.revision.at) {
    const i = STAGE_INDEX[a.stage];
    if (revisionAt[i] === undefined) revisionAt[i] = a;
  }
  return {
    seed,
    sh: seedHash(seed),
    horizon,
    asOf: input.asOf,
    cal: input.calibration,
    inFlightScale: input.inFlightScale ?? null,
    newCal: input.newProjects?.calibration ?? input.calibration,
    newScale: input.newProjects?.scale ?? null,
    parcels: input.parcels,
    input,
    pre: precomputeOf(input),
    st: staticOf(input),
    revisionAt,
    ids
  };
}

/** The revision rule (§4.4.5 steps 3-4): none (a master), pipeline or simulated. */
const NONE = 0;
const PIPELINE = 1;
const SIMULATED = 2;

/**
 * A project being stepped: its draw stream, the record the steps fill and its revision rule.
 * One per pass, reset for each project (`entered` and `revisions` are always fresh: they go into
 * the Schedule).
 */
interface Job {
  stream: number; // streamOf(sh, entity, k)
  pathway: Pathway;
  /** the transitions and new-project shares it runs on (ruling 3, "Policy start date") */
  cal: Calibration;
  /** its in-flight stage's remaining-time scale; null = 1 */
  scale: StageScale | null;
  entered: Partial<Record<Stage, Day>>;
  /** never empty: [0] is the initial proposal */
  revisions: Revision[];
  rule: typeof NONE | typeof PIPELINE | typeof SIMULATED;
  /** pipeline rule */
  yieldCap: number;
  envelope: number;
  /** simulated rule: T11 row, existing units left, top yield, envelope stories */
  row: number;
  existing: number;
  top: number;
  env: number;
}

const newJob = (run: Run): Job => ({
  stream: 0,
  pathway: 'discretionary',
  cal: run.cal,
  scale: null,
  entered: {},
  revisions: [],
  rule: NONE,
  yieldCap: 0,
  envelope: 0,
  row: 0,
  existing: 0,
  top: 0,
  env: 0
});

/**
 * The ratio for one uniform (§4.4.5 step 2): bin i is the slot of u in the cumulative `probs`,
 * and u's position within bin i's mass places the ratio uniformly in [edges[i], edges[i+1]). A u
 * at or above a total that rounded below 1 takes the top of the last bin with mass; a histogram
 * with no mass gives 1 (no change).
 */
export function revisionRatio(h: Histogram, u: number): number {
  let acc = 0;
  let last = -1;
  let lastFrom = 0;
  for (let i = 0; i < h.probs.length; i++) {
    const p = h.probs[i];
    if (!(p > 0)) continue;
    if (u < acc + p) return h.edges[i] + ((u - acc) / p) * (h.edges[i + 1] - h.edges[i]);
    last = i;
    lastFrom = acc;
    acc += p;
  }
  if (last < 0) return 1;
  const residual = Math.min((u - lastFrom) / h.probs[last], 1);
  return h.edges[last] + residual * (h.edges[last + 1] - h.edges[last]);
}

/**
 * Records a revision with the same-day merge (§4.4.5 step 6): a revision due on the last entry's
 * day replaces that entry's units and stories, keeping its day; if the merged entry then equals
 * its predecessor in both fields it is removed. `revisions[0]` is never removed. Revision days
 * therefore stay strictly ascending. A day before the last entry's is a caller bug and throws.
 */
export function pushRevision(
  revisions: Revision[],
  day: Day,
  units: number,
  stories: number | null
): void {
  const last = revisions[revisions.length - 1];
  if (day > last.day) {
    revisions.push({ day, units, stories });
    return;
  }
  if (day < last.day) {
    throw new Error(`pushRevision: day ${day} is before the last revision day ${last.day}`);
  }
  last.units = units;
  last.stories = stories;
  const n = revisions.length;
  if (n >= 2 && revisions[n - 2].units === units && revisions[n - 2].stories === stories) {
    revisions.pop();
  }
}

/**
 * A revision on entering stage `n` on `day` (§4.4.5 steps 1-5); none from construction on.
 * Pipeline: `units' = max(1, round(r·u))` capped at `max(u, yieldCap)`; known stories scale with
 * the units, capped when upsizing at `max(stories, envelope)`. Simulated, with `existing` units
 * left: `min(top, max(existing + 1, round(r·u)))` (ruling: the cap is the largest level's yield,
 * for non-monotone yields), stories from the smallest level whose yield reaches it.
 */
function revise(run: Run, job: Job, n: Stage, day: Day): void {
  const i = STAGE_INDEX[n];
  if (i >= CONSTRUCTION || job.rule === NONE) return;
  const at = run.revisionAt[i];
  if (at === undefined) return;
  if (!(drawOn(job.stream, P.REV, i) < at.probability)) return;
  const ratio = revisionRatio(at.ratio, drawOn(job.stream, P.REV_RATIO, i));
  const last = job.revisions[job.revisions.length - 1];
  const units = last.units;
  let next: number;
  let stories: number | null;
  if (job.rule === PIPELINE) {
    next = Math.min(Math.max(1, Math.round(ratio * units)), Math.max(units, job.yieldCap));
    if (last.stories === null) stories = null;
    else {
      let s = Math.max(1, Math.round((last.stories * next) / units));
      if (next > units) s = Math.min(s, Math.max(last.stories, job.envelope));
      stories = s;
    }
  } else {
    const y = run.parcels.yield;
    next = Math.min(job.top, Math.max(job.existing + 1, Math.round(ratio * units)));
    let f = 0;
    while (f < F - 1 && y[job.row * F + f] < next) f++;
    stories = fillStories(FILL_LEVELS[f], job.env);
  }
  if (next !== units) pushRevision(job.revisions, day, next, stories);
}

/**
 * The months an in-flight project is conditioned on in a stage rescaled by `s`, after `m` real
 * months in it (ruling 3, "Remaining-time rescale for in-flight stages").
 */
export function inFlightMonths(m: number, s: number): number {
  return s === 1 ? m : Math.round(m * s);
}

/** The outcome of the last `stageStep` (scratch, so a step allocates nothing). */
const step = { kind: 'advance' as Kind, day: 0 };

/**
 * One stage step (§4.4.2 steps 1-2) into `step`: the outcome of leaving `s`, entered on day `e`,
 * and its day. `inFlight` marks an in-flight project's current stage: it is conditioned on the
 * months already survived, and redrawn (up to 8 attempts) until the day is after `asOf`; if
 * every attempt lands on or before `asOf`, the last outcome is kept at `asOf + 1`. With the job's
 * scale x ≠ 1 on `s`, the draw is conditioned on m' = `inFlightMonths(m, x)` months of the
 * (rescaled) transition and mapped back onto the real m months: the remaining time is rescaled.
 */
function stageStep(run: Run, job: Job, s: Stage, e: Day, inFlight: boolean): void {
  const t = s === 'complete' ? undefined : job.cal.transitions[job.pathway][s];
  if (t === undefined) throw new Error(`calibration has no ${job.pathway} ${s} transition`);
  const idx = STAGE_INDEX[s];
  if (!inFlight) {
    const r = sampleTransition(t, drawOn(job.stream, P.STAGE, idx), 0);
    step.kind = r.kind;
    step.day = e + Math.floor(r.days);
    return;
  }
  const m = monthsIn(e, run.asOf);
  // A stage the scale does not name, construction (never timed) included, is at 1.
  const x = (job.scale?.[job.pathway] as Partial<Record<Stage, number>> | undefined)?.[s] ?? 1;
  const m2 = inFlightMonths(m, x);
  // e − ceil(m'·MONTH_DAYS) + ceil(m·MONTH_DAYS); exactly e with x = 1
  const from = x === 1 ? e : e - Math.ceil(m2 * MONTH_DAYS) + Math.ceil(m * MONTH_DAYS);
  let kind: Kind = 'advance';
  for (let j = 0; j <= REDRAWS; j++) {
    const purpose = j === 0 ? P.STAGE : stageRedraw(j as 1 | 2 | 3 | 4 | 5 | 6 | 7);
    const r = sampleTransition(t, drawOn(job.stream, purpose, idx), m2);
    const day = from + Math.floor(r.days);
    if (day > run.asOf) {
      step.kind = r.kind;
      step.day = day;
      return;
    }
    kind = r.kind;
  }
  step.kind = kind;
  step.day = run.asOf + 1;
}

/** `runStages` stopped on entering a stage at or past its `stopAt`, on `day`. */
interface Reached {
  kind: 'reached';
  day: Day;
}

/**
 * Steps `job` from stage `stage`, entered on day `e`, until it exits, completes or passes the
 * horizon (§4.4.2 step 3), filling `job.entered` and revising on each later entry. `inFlight`
 * conditions the first step only. With `stopAt`, it also stops on entering a stage at or past
 * `stopAt` (an unentitled master stops on entering `entitled`, §4.4.3a); that entry is recorded
 * in `job.entered` unless it is past `stopAt` (permitOnly, which never enters `entitled`).
 */
function runStages(run: Run, job: Job, stage: Stage, e: Day, inFlight: boolean): End;
function runStages(
  run: Run,
  job: Job,
  stage: Stage,
  e: Day,
  inFlight: boolean,
  stopAt: Stage
): End | Reached;
function runStages(
  run: Run,
  job: Job,
  stage: Stage,
  e: Day,
  inFlight: boolean,
  stopAt?: Stage
): End | Reached {
  const stop = stopAt === undefined ? Infinity : STAGE_INDEX[stopAt];
  let s = stage;
  let from = e;
  let conditioned = inFlight;
  for (;;) {
    stageStep(run, job, s, from, conditioned);
    const { kind, day } = step;
    if (day > run.horizon) return { kind: 'open' };
    if (kind !== 'advance') return { kind: 'exit', stage: s, reason: kind, day };
    const n = nextStage(job.pathway, s);
    if (STAGE_INDEX[n] >= stop) {
      if (STAGE_INDEX[n] === stop) job.entered[n] = day;
      return { kind: 'reached', day };
    }
    job.entered[n] = day;
    if (n === 'complete') return { kind: 'complete', day };
    revise(run, job, n, day);
    s = n;
    from = day;
    conditioned = false;
  }
}

/**
 * How the in-flight projects on one T11 parcel end (for the simulated pass's risk set). A parcel
 * with no Hold is free at `asOf`.
 */
export interface Hold {
  /** latest exit day among holders that exited; null if none did */
  lastExit: Day | null;
  /**
   * a holder completed or is still open at the horizon, or the holder never ends in the run (a
   * row the engine skips): the parcel is never at risk
   */
  blocked: boolean;
  /** first `entered.construction` of any project on the parcel (its demolition); null if none */
  demolished: Day | null;
}
/** Keyed by T11 row. */
export type Holds = Map<number, Hold>;

/** Adds one holder's end and construction day to each of the T11 `rows` it holds. */
function holdRows(
  holds: Holds,
  rows: Int32Array,
  entered: Partial<Record<Stage, Day>>,
  end: End
): void {
  const built = entered.construction;
  for (const i of rows) {
    let h = holds.get(i);
    if (!h) {
      h = { lastExit: null, blocked: false, demolished: null };
      holds.set(i, h);
    }
    if (end.kind === 'exit')
      h.lastExit = h.lastExit === null ? end.day : Math.max(h.lastExit, end.day);
    else h.blocked = true;
    if (built !== undefined)
      h.demolished = h.demolished === null ? built : Math.min(h.demolished, built);
  }
}

/** Adds one holder's end and construction day to each of its parcels present in T11. */
export function addHold(
  holds: Holds,
  parcels: ScenarioParcels,
  parcelIds: readonly ParcelId[],
  entered: Partial<Record<Stage, Day>>,
  end: End
): void {
  holdRows(holds, rowsOf(parcels, parcelIds), entered, end);
}

/**
 * Rows the engine does not run (§4.4.3): already complete, or permitOnly at a Planning stage.
 * `loadScenario` counts them once per load for its log line; the engine itself writes nothing.
 */
export function isSkipped(p: InFlightProject): boolean {
  return (
    p.stage === 'complete' ||
    (p.pathway === 'permitOnly' && (p.stage === 'filed' || p.stage === 'entitled'))
  );
}

/** A multi-phase row with phases: a master plus phase sub-projects (§4.4.3a), not a Schedule. */
function isPhased(p: InFlightProject): boolean {
  return p.multiPhase && p.phases !== null;
}

/**
 * One pipeline row (§4.4.3): history days clamped to `asOf`, the current stage entered on its
 * history day (or `asOf`, unconditioned, when absent), stepped from there with the in-flight
 * conditioning. Entity `'j:' + id`, k = 0.
 */
function pipelineRow(run: Run, job: Job, p: InFlightProject, rs: RowStatic): Schedule {
  const entered: Partial<Record<Stage, Day>> = {};
  let first = Infinity;
  for (const s of STAGE_ORDER) {
    const d = p.history[s];
    if (d === undefined) continue;
    entered[s] = Math.min(d, run.asOf);
    first = Math.min(first, entered[s]);
  }
  let e = entered[p.stage];
  if (e === undefined) {
    e = run.asOf;
    entered[p.stage] = e;
    first = Math.min(first, e);
  }
  job.stream = streamOf(run.sh, rs.entity, 0);
  job.pathway = p.pathway;
  // not yet filed at asOf: a new project (ruling 3, "Policy start date")
  const isNew = p.stage === 'preApplication';
  job.cal = isNew ? run.newCal : run.cal;
  job.scale = isNew ? run.newScale : run.inFlightScale;
  job.entered = entered;
  job.revisions = [{ day: first, units: p.units, stories: p.stories }];
  job.rule = PIPELINE;
  job.yieldCap = rs.yieldCap;
  job.envelope = rs.envelope;
  const end = runStages(run, job, p.stage, e, true);
  return {
    projectId: p.id,
    origin: 'pipeline',
    parcelIds: run.ids ? [...p.parcelIds] : NO_IDS,
    pathway: p.pathway,
    entered,
    end,
    revisions: job.revisions,
    existingUnits: p.existingUnits,
    multiPhase: p.multiPhase,
    phase: null
  };
}

/** A holder end that never frees its parcels (see `Hold.blocked`). */
const HELD: End = { kind: 'open' };

/**
 * The pipeline pass: every runnable unphased row, its parcels recorded in `holds`. A skipped row
 * holds its parcels for the whole run: a complete row is a completion on them, and a permitOnly
 * row at a Planning stage is in flight but never ends here (risk table, §4.4.4).
 */
function pipelinePass(run: Run, holds: Holds, sink: Sink) {
  const projects = run.input.projects;
  const job = newJob(run);
  for (let k = 0; k < projects.length; k++) {
    const p = projects[k];
    const rs = run.st.rows[k];
    if (isSkipped(p)) {
      holdRows(holds, rs.rows, p.history, HELD);
      continue;
    }
    if (isPhased(p)) continue;
    const s = pipelineRow(run, job, p, rs);
    holdRows(holds, rs.rows, s.entered, s.end);
    sink.schedule(s);
  }
}

const ENTITLED = STAGE_INDEX.entitled;
const PLANNING: readonly Stage[] = ['preApplication', 'filed', 'entitled'];

/**
 * A master's Planning-side entitlement (§4.4.3a). An entitled row (`history.entitled` set, or a
 * stage at or past `entitled`) ends at E = `history.entitled`, else its earliest permit-side
 * history day, else `asOf`. Any other row runs the §4.4.2 steps from its current stage (in-flight
 * conditioned, entity `'j:' + masterId`, k = 0, no revisions) and stops on entering `entitled`.
 * `entered` holds the Planning-side days, and `entitled = E` once entitled (not for permitOnly,
 * which never enters `entitled`).
 */
function masterOf(run: Run, job: Job, p: InFlightProject, rs: RowStatic): Master {
  const entered: Partial<Record<Stage, Day>> = {};
  for (const s of PLANNING) {
    const d = p.history[s];
    if (d !== undefined) entered[s] = Math.min(d, run.asOf);
  }
  const phases = p.phases ?? [];
  const master = (end: Master['end']): Master => ({
    masterId: p.id,
    pathway: p.pathway,
    entered,
    end,
    phaseUnits: phases.map((ph) => ph.units),
    phaseFiled: phases.map(() => null)
  });
  if (p.history.entitled !== undefined || STAGE_INDEX[p.stage] >= ENTITLED) {
    let E = entered.entitled;
    if (E === undefined) {
      for (let i = ENTITLED + 1; i < STAGE_ORDER.length && E === undefined; i++) {
        const d = p.history[STAGE_ORDER[i]];
        if (d !== undefined) E = Math.min(d, run.asOf);
      }
      E ??= run.asOf;
      if (p.pathway !== 'permitOnly') entered.entitled = E;
    }
    return master({ kind: 'entitled', day: E });
  }
  let e = entered[p.stage];
  if (e === undefined) {
    e = run.asOf;
    entered[p.stage] = e;
  }
  job.stream = streamOf(run.sh, rs.entity, 0);
  job.pathway = p.pathway;
  job.cal = run.cal;
  job.scale = run.inFlightScale;
  job.entered = entered;
  job.revisions = [{ day: e, units: p.units, stories: p.stories }];
  job.rule = NONE;
  const end = runStages(run, job, p.stage, e, true, 'entitled');
  if (end.kind === 'reached') return master({ kind: 'entitled', day: end.day });
  if (end.kind === 'complete') throw new Error(`master ${p.id} completed before entitlement`);
  return master(end);
}

/**
 * Phase i's filing day F_i (§4.4.3a): its plan date if after `asOf` (not before E + 1), else one
 * empirical gap after `base` (max(E, asOf) for phase 1, max(F_{i−1}, asOf) after).
 */
function phaseFiledDay(
  run: Run,
  masterEntity: number,
  i: number,
  plan: Day | null,
  E: Day,
  prev: Day
): Day {
  if (plan !== null && plan > run.asOf) return Math.max(plan, E + 1);
  const days = run.cal.phaseGap.days;
  const u = drawOn(streamOf(run.sh, masterEntity, i), P.PHASE_GAP, 0);
  const base = Math.max(i === 1 ? E : prev, run.asOf);
  return base + 1 + days[Math.floor(u * days.length)];
}

/**
 * The multi-phase pass (§4.4.3a): each phased row becomes a Master and, once entitled, one phase
 * sub-project per entry of `phases` that files by the horizon. Holds: an exited master frees all
 * its parcels (and its phases') from the exit day; an open master blocks them; after entitlement
 * each phase holds its own parcels with its real end, an unfiled phase blocks them, and a master
 * parcel in no phase stays blocked.
 */
function multiPhasePass(run: Run, holds: Holds, sink: Sink) {
  const projects = run.input.projects;
  const job = newJob(run);
  for (let k = 0; k < projects.length; k++) {
    const p = projects[k];
    if (isSkipped(p) || !isPhased(p)) continue;
    const rs = run.st.rows[k];
    const ps = rs.phased!;
    const phases = p.phases ?? [];
    const m = masterOf(run, job, p, rs);
    if (m.end.kind !== 'entitled') {
      holdRows(holds, ps.all, {}, m.end.kind === 'exit' ? m.end : HELD);
      sink.master(m);
      continue;
    }
    const E = m.end.day;
    holdRows(holds, ps.rest, {}, HELD);
    let prev = E;
    for (const [j, ph] of phases.entries()) {
      const i = j + 1;
      const F_i = phaseFiledDay(run, rs.entity, i, ph.plannedPermitFiled, E, prev);
      prev = F_i;
      const pst = ps.phases[j];
      if (F_i > run.horizon) {
        holdRows(holds, pst.rows, {}, HELD);
        continue;
      }
      m.phaseFiled[j] = F_i;
      const s = phaseSchedule(run, job, p, i, F_i, pst);
      holdRows(holds, pst.rows, s.entered, s.end);
      sink.schedule(s);
    }
    sink.master(m);
  }
}

/**
 * Phase i (1-based) of master `p`, filing on `F_i`: entered from `permitFiled` only, stepped fresh
 * with entity `'j:' + projectId`, revised by the pipeline rule on its own parcels; `existingUnits`
 * is the T11 sum of its parcels (§4.4.3a).
 */
function phaseSchedule(
  run: Run,
  job: Job,
  p: InFlightProject,
  i: number,
  F_i: Day,
  pst: PhaseStatic
): Schedule {
  const ph = (p.phases ?? [])[i - 1];
  const entered: Partial<Record<Stage, Day>> = { permitFiled: F_i };
  job.stream = streamOf(run.sh, pst.entity, 0);
  job.pathway = p.pathway;
  job.cal = run.cal;
  job.scale = run.inFlightScale;
  job.entered = entered;
  job.revisions = [{ day: F_i, units: ph.units, stories: null }];
  job.rule = PIPELINE;
  job.yieldCap = pst.yieldCap;
  job.envelope = pst.envelope;
  const end = runStages(run, job, 'permitFiled', F_i, false);
  const plan = ph.plannedPermitFiled;
  const scheduled = plan !== null && plan > run.asOf && F_i === plan;
  return {
    projectId: pst.projectId,
    origin: 'pipeline',
    parcelIds: run.ids ? [...ph.parcelIds] : NO_IDS,
    pathway: p.pathway,
    entered,
    end,
    revisions: job.revisions,
    existingUnits: pst.existing,
    multiPhase: true,
    phase: {
      masterId: p.id,
      index: i,
      of: (p.phases ?? []).length,
      start: scheduled ? 'scheduled' : 'estimated'
    }
  };
}

/** A new project's pathway from the normalised `pathwayForNew`, in `PATHWAYS` order (§4.4.4). */
function newPathway(cal: Calibration, stream: number): Pathway {
  const w = cal.pathwayForNew;
  let total = 0;
  for (const p of PATHWAYS) if (w[p] > 0) total += w[p];
  const x = drawOn(stream, P.PATHWAY, 0) * total;
  let acc = 0;
  let last: Pathway | null = null;
  for (const p of PATHWAYS) {
    if (!(w[p] > 0)) continue;
    acc += w[p];
    last = p;
    if (x < acc) return p;
  }
  if (last === null) throw new Error('calibration pathwayForNew has no positive share');
  return last; // x at a total that rounded up
}

/**
 * The k-th initiation day on a parcel at risk from day `r` (§4.4.4 steps 1-3), on the parcel's
 * `(entity, k)` stream: the geometric month `T = max(1, ceil(log(1 − u) / log(1 − h)))` by
 * inverse CDF, placed uniformly within the month. Null when it falls after the horizon.
 * `log1mh` must be < 0 (h > 0).
 */
function initiationDay(run: Run, stream: number, log1mh: number, r: Day): Day | null {
  const u = drawOn(stream, P.INIT, 0);
  const T = Math.max(1, Math.ceil(log(1 - u) / log1mh));
  const v = drawOn(stream, P.INIT_DAY, 0);
  const day = r + 1 + Math.floor((T - 1 + v) * MONTH_DAYS);
  return day > run.horizon ? null : day;
}

/**
 * The k-th simulated project on T11 row i, initiated on `day` with `existing` units on the parcel
 * (0 once it has been demolished in the run), on its `(entity, k)` stream: pathway, first stage
 * and size (§4.4.4), then the ordinary stage steps with the simulated revision rule. Null if no
 * size level gains a home.
 */
function simulatedProject(
  run: Run,
  job: Job,
  i: number,
  stream: number,
  k: number,
  day: Day,
  existing: number
): Schedule | null {
  const p = run.parcels;
  const cal = run.newCal;
  const pathway: Pathway = p.localProgram[i] === 1 ? 'streamlined' : newPathway(cal, stream);
  const first: Stage =
    drawOn(stream, P.PPA, 0) < cal.ppaShare[pathway]
      ? 'preApplication'
      : pathway === 'permitOnly'
        ? 'permitFiled'
        : 'filed';
  // the precomputed row is against T11 existingUnits; a demolished parcel needs its own (rare)
  const own = existing === p.existingUnits[i];
  const cum = own ? run.pre.sizeCum : sizeCumAgainst(run.input, i, existing);
  const at = own ? i * F : 0;
  const u = drawOn(stream, P.SIZE, 0);
  let f = 0;
  while (f < F && !(u < cum[at + f])) f++;
  if (f === F) return null;
  const entered: Partial<Record<Stage, Day>> = {};
  entered[first] = day;
  let top = 0;
  for (let g = 0; g < F; g++) top = Math.max(top, p.yield[i * F + g]);
  job.stream = stream;
  job.pathway = pathway;
  job.cal = cal;
  job.scale = run.newScale; // never read: a simulated project is never in flight
  job.entered = entered;
  job.revisions = [
    { day, units: p.yield[i * F + f], stories: fillStories(FILL_LEVELS[f], p.envelopeStories[i]) }
  ];
  job.rule = SIMULATED;
  job.row = i;
  job.existing = existing;
  job.top = top;
  job.env = p.envelopeStories[i];
  const end = runStages(run, job, first, day, false);
  return {
    projectId: run.ids ? `sim:${p.id[i]}:${k}` : '',
    origin: 'simulated',
    parcelIds: run.ids ? [p.id[i]] : NO_IDS,
    pathway,
    entered,
    end,
    revisions: job.revisions,
    existingUnits: existing,
    multiPhase: false,
    phase: null
  };
}

/**
 * The simulated pass (§4.4.4, §4.4.6), after every in-flight pass has filled `holds`. Each
 * hostable parcel with a hazard (`candidates`) is at risk from `asOf` (no hold) or from its
 * holders' last exit, with k = 0, unless a holder blocks it. After a simulated exit on day x it
 * is at risk again from x with k + 1; a completion or an open end finishes it. The parcel is
 * demolished at the first construction entry of any project on it, and every later project on
 * it has 0 existing units. A parcel no project holds, whose first initiation draw is above its
 * `skipAbove` bound, cannot initiate by the horizon and is passed over on that one draw.
 */
function simulatedPass(run: Run, holds: Holds, sink: Sink): void {
  const { parcels, pre, st } = run;
  const { candidates, entity, log1mh } = pre;
  const skip = pre.skipAbove(run.horizon);
  const job = newJob(run);
  for (let c = 0; c < candidates.length; c++) {
    const i = candidates[c];
    let r = run.asOf;
    let demolished = false;
    let stream = streamOf(run.sh, entity[c], 0);
    if (st.held[i] === 1) {
      const hold = holds.get(i);
      if (hold?.blocked) continue;
      r = Math.max(run.asOf, hold?.lastExit ?? run.asOf);
      demolished = hold !== undefined && hold.demolished !== null;
    } else if (drawOn(stream, P.INIT, 0) > skip[c]) continue;
    for (let k = 0; ; k++) {
      if (k > 0) stream = streamOf(run.sh, entity[c], k);
      const day = initiationDay(run, stream, log1mh[i], r);
      if (day === null) break;
      const existing = demolished ? 0 : parcels.existingUnits[i];
      const s = simulatedProject(run, job, i, stream, k, day, existing);
      if (s === null) break;
      sink.schedule(s);
      if (s.entered.construction !== undefined) demolished = true;
      if (s.end.kind !== 'exit') break;
      r = s.end.day;
    }
  }
}

/**
 * Runs the engine for one seed and horizon, handing every Schedule and Master to `sink` in no
 * particular order. Pure: the skipped-rows count is logged by `loadScenario`, not here.
 */
export function runEngine(input: SimInput, seed: number, horizon: Day, sink: Sink): void {
  const run = runOf(input, seed, horizon, sink.ids ?? true);
  const holds: Holds = new Map();
  pipelinePass(run, holds, sink);
  multiPhasePass(run, holds, sink);
  simulatedPass(run, holds, sink);
}
