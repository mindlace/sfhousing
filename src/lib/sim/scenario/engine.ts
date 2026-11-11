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
// T12's `sampleTransition` on the unscaled transition (nothing here re-implements it) and scale
// only the time in stage (`scaledTransition`). The simulated pass
// rejects most parcels on their first initiation draw against a precomputed bound (`skipAbove`)
// instead of evaluating the geometric month. None of this changes a value.
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, fillStories, type ScenarioParcels } from '$lib/data/scenario-codec';
import { log } from '$lib/timelapse/math';
import { sampleAdvance, sampleTransition } from '$lib/timelapse/model';
import type { InFlightProject } from '$lib/timelapse/projects';
import { MONTH_DAYS, stageMonths, type Day } from '$lib/timelapse/time';
import type { Transition } from '$lib/timelapse/types';
import {
  PATHWAYS,
  STAGE_ORDER,
  type Calibration,
  type Dollars,
  type ExitReason,
  type Pathway,
  type RevisionModel,
  type Stage
} from '$lib/timelapse/types';
import type { StageScale } from '../levers/timers';
import { isoOf } from './dates';
import { fundedPass } from './funded';
import { checkFinance } from './funding';
import type { App } from './line';
import {
  piecewiseMonth,
  precomputeOf,
  regimeInputsOf,
  regimeMonths,
  sizeCumAgainst,
  type Precompute
} from './input';
import { P, drawOn, jobEntity, seedHash, streamOf } from './rng';
import type { LedgerEvent } from './money';
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
  /**
   * Once per run for each row with `input.reservedFrom[row]` > 0 (candidate or not): whether the
   * reservation was kept. Optional: a sink without it ignores reservations.
   */
  reservation?(row: number, kept: boolean): void;
  /** F10: one event per programme of a project, called in day order; `programme` is null on `in`. */
  ledger?(e: {
    day: Day;
    pool: string;
    programme: string | null;
    kind: 'in' | 'commit' | 'release' | 'spend' | 'repay' | 'loss';
    dollars: Dollars;
  }): void;
}

type End = Schedule['end'];
type Revision = Schedule['revisions'][number];
type Histogram = RevisionModel['at'][number]['ratio'];
type Kind = 'advance' | ExitReason;

const STAGE_INDEX = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i])) as Record<Stage, number>;
const CONSTRUCTION = STAGE_INDEX.construction;
const F = FILL_LEVELS.length;
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

/** One run's constants. @internal exported for the funded pass (`funded.ts`) */
export interface Run {
  seed: number;
  /** `seedHash(seed)`: the seed's part of every draw */
  sh: number;
  horizon: Day;
  asOf: Day;
  /**
   * `input.calibration` (unscaled): in-flight transitions, and initiation, size, revision and
   * phaseGap
   */
  cal: Calibration;
  /** `input.inFlightScale`: time in stage of every stage of in-flight jobs; null = 1 */
  inFlightScale: StageScale | null;
  /**
   * new projects' unscaled calibration (`input.newProjects`, else `cal`), and their time-in-stage
   * scale; null = 1
   */
  newCal: Calibration;
  newScale: StageScale | null;
  parcels: ScenarioParcels;
  input: SimInput;
  /** the per-input precompute (memoised by input identity): hazards, log(1 − h), size rows */
  pre: Precompute;
  /** `input.regimes`, each with its view's input and precompute; [] = none */
  regimes: { day: Day; parcels: ScenarioParcels; input: SimInput; pre: Precompute }[];
  /** `input.reservedFrom`; null = none */
  reservedFrom: Int32Array | null;
  st: Static;
  /** by STAGE_ORDER index: the first `revision.at` entry for the stage, if any */
  revisionAt: (RevisionModel['at'][number] | undefined)[];
  /** build `projectId` and `parcelIds` (Sink.ids) */
  ids: boolean;
}

/** Inputs whose `regimes`, `reservedFrom` and `market` passed `checkInput`. */
const checked = new WeakSet<SimInput>();

/**
 * Throws a RangeError on bad `regimes`, `reservedFrom` or `market` (see `SimInput`; spec §4.8);
 * memoised by input.
 */
function checkInput(input: SimInput): void {
  if (checked.has(input)) return;
  const n = input.parcels.count;
  const steps = input.market ?? [];
  for (let k = 0; k < steps.length; k++) {
    if (!Number.isFinite(steps[k].logOdds)) {
      throw new RangeError(`market: logOdds of step ${k} is not finite`);
    }
    if (k > 0 && !(steps[k].from > steps[k - 1].from)) {
      throw new RangeError(`market: steps must be strictly ascending by from (step ${k})`);
    }
  }
  if (steps.length > 0 && !(steps[0].from <= input.asOf)) {
    throw new RangeError(
      `market: the first step must be on or before asOf ` +
        `(${isoOf(steps[0].from)} > ${isoOf(input.asOf)})`
    );
  }
  let prev = input.asOf;
  for (const [k, g] of (input.regimes ?? []).entries()) {
    if (!(g.day > prev)) {
      throw new RangeError(
        `regimes[${k}].day ${g.day} must be after ${k === 0 ? 'asOf' : 'the previous day'} ${prev}`
      );
    }
    if (g.parcels.count !== n || g.parcels.id.length !== input.parcels.id.length) {
      throw new RangeError(`regimes[${k}].parcels has ${g.parcels.count} rows, not ${n}`);
    }
    prev = g.day;
  }
  const rf = input.reservedFrom;
  if (rf) {
    if (rf.length !== n) throw new RangeError(`reservedFrom has ${rf.length} rows, not ${n}`);
    for (let i = 0; i < n; i++) {
      if (rf[i] !== 0 && !(rf[i] > input.asOf)) {
        throw new RangeError(`reservedFrom[${i}] ${rf[i]} must be 0 or after asOf ${input.asOf}`);
      }
    }
  }
  checked.add(input);
}

/** @internal exported for the funded pass (`funded.ts`) and its tests */
export function runOf(input: SimInput, seed: number, horizon: Day, ids: boolean): Run {
  checkInput(input);
  if (input.finance) checkFinance(input);
  const pre = precomputeOf(input);
  const regimeInputs = regimeInputsOf(input);
  const regimes = regimeInputs.map((ri, k) => ({
    day: input.regimes![k].day,
    parcels: ri.parcels,
    input: ri,
    pre: pre.regimes[k]
  }));
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
    pre,
    regimes,
    reservedFrom: input.reservedFrom ?? null,
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
 * the Schedule). @internal exported for the funded pass (`funded.ts`)
 */
export interface Job {
  stream: number; // streamOf(sh, entity, k)
  pathway: Pathway;
  /** the transitions and new-project shares it runs on (ruling 3, "Policy start date") */
  cal: Calibration;
  /** its time-in-stage scale, applied to every stage step (paired-draw fix); null = 1 */
  scale: StageScale | null;
  entered: Partial<Record<Stage, Day>>;
  /** never empty: [0] is the initial proposal */
  revisions: Revision[];
  rule: typeof NONE | typeof PIPELINE | typeof SIMULATED;
  /**
   * a fully funded project (finance-engine spec 4.9): every stage step advances, on the stage's
   * time draw (`sampleAdvance`), and it is never revised (rule NONE)
   */
  certain: boolean;
  /** pipeline rule */
  yieldCap: number;
  envelope: number;
  /** simulated rule: the parcels view it initiated under (ruling 1), T11 row, existing units
   * left, top yield, envelope stories */
  parcels: ScenarioParcels;
  row: number;
  existing: number;
  top: number;
  env: number;
}

/** @internal exported for the funded pass (`funded.ts`) */
export const newJob = (run: Run): Job => ({
  stream: 0,
  pathway: 'discretionary',
  cal: run.cal,
  scale: null,
  entered: {},
  revisions: [],
  rule: NONE,
  certain: false,
  yieldCap: 0,
  envelope: 0,
  parcels: run.parcels,
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
    const y = job.parcels.yield;
    next = Math.min(job.top, Math.max(job.existing + 1, Math.round(ratio * units)));
    let f = 0;
    while (f < F - 1 && y[job.row * F + f] < next) f++;
    stories = fillStories(FILL_LEVELS[f], job.env);
  }
  if (next !== units) pushRevision(job.revisions, day, next, stories);
}

/**
 * One stage step on the unscaled transition `t` (paired-draw fix), `survived` whole days already
 * spent in the stage (0 when fresh): the kind from `uKind` and the time from `uTime`, both
 * conditioned on tau = `stageMonths(survived)`, and the time in stage past `survived` scaled by
 * `s`. Returns the kind and the integer days from stage entry, >= `survived`; with s = 1, exactly
 * `sampleTime`'s day. The scale is applied in days (floor(s * k) is monotone in s for k >= 0), so
 * the kind never depends on s and the day is monotone in it.
 */
export function scaledTransition(
  t: Transition,
  uKind: number,
  uTime: number,
  survived: number,
  s: number
): { kind: Kind; days: number } {
  const tau = stageMonths(survived);
  const { kind, days } = sampleTransition(t, uKind, uTime, tau);
  return { kind, days: survived + Math.floor(s * (days - survived)) };
}

/** The outcome of the last `stageStep` (scratch, so a step allocates nothing). */
const step = { kind: 'advance' as Kind, day: 0 };

/**
 * One stage step (§4.4.2 steps 1-2, paired-draw fix) into `step`: the outcome of leaving `s`,
 * entered on day `e`, and its day. The kind is drawn on `P.STAGE` and the time on `P.STAGE_TIME`
 * from the job's unscaled transition, and the job's scale on `s` multiplies the time in stage,
 * fresh or in flight. `inFlight` marks an in-flight project's current stage: it is conditioned on
 * the `asOf + 1 − e` whole days survived (>= 1, as e <= asOf), so its day is after `asOf`. A
 * certain job (finance-engine spec 4.9, never in flight) always advances: the time is
 * `sampleAdvance` on the same time draw, with the same scale, and `P.STAGE` is not read.
 */
function stageStep(run: Run, job: Job, s: Stage, e: Day, inFlight: boolean): void {
  const t = s === 'complete' ? undefined : job.cal.transitions[job.pathway][s];
  if (t === undefined) throw new Error(`calibration has no ${job.pathway} ${s} transition`);
  const idx = STAGE_INDEX[s];
  // A stage the scale does not name, construction (never timed) included, is at 1.
  const x = (job.scale?.[job.pathway] as Partial<Record<Stage, number>> | undefined)?.[s] ?? 1;
  if (job.certain) {
    step.kind = 'advance';
    step.day = e + Math.floor(x * sampleAdvance(t, drawOn(job.stream, P.STAGE_TIME, idx)).days);
    return;
  }
  const r = scaledTransition(
    t,
    drawOn(job.stream, P.STAGE, idx),
    drawOn(job.stream, P.STAGE_TIME, idx),
    inFlight ? run.asOf + 1 - e : 0,
    x
  );
  step.kind = r.kind;
  step.day = e + r.days;
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
 * history day (or `asOf` when absent, so conditioned on 1 day survived), stepped from there with
 * the in-flight conditioning. Entity `'j:' + id`, k = 0.
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
  job.certain = false;
  job.yieldCap = rs.yieldCap;
  job.envelope = rs.envelope;
  const end = runStages(run, job, p.stage, e, true);
  const s: Schedule = {
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
  // only on a run with `newProjects`, so every other Schedule (and every golden) is unchanged
  if (!isNew && run.input.newProjects !== undefined) s.inFlight = true;
  return s;
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
  job.certain = false;
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
  job.certain = false;
  job.yieldCap = pst.yieldCap;
  job.envelope = pst.envelope;
  const end = runStages(run, job, 'permitFiled', F_i, false);
  const plan = ph.plannedPermitFiled;
  const scheduled = plan !== null && plan > run.asOf && F_i === plan;
  const s: Schedule = {
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
  // a phase always runs on `calibration` (see pipelineRow)
  if (run.input.newProjects !== undefined) s.inFlight = true;
  return s;
}

/** A new project's pathway from the normalised `pathwayForNew`, in `PATHWAYS` order (§4.4.4). */
function newPathway(cal: Calibration, stream: number): Pathway {
  return pathwayFrom(cal.pathwayForNew, stream);
}

/**
 * A pathway drawn on `drawOn(stream, P.PATHWAY, 0)` from the normalised shares `w`, in `PATHWAYS`
 * order (`pathwayForNew`, or `affordableRoutes` for a certain affordable project, finance-engine
 * spec 4.9). @internal exported for the funded pass (`funded.ts`)
 */
export function pathwayFrom(w: Record<Pathway, number>, stream: number): Pathway {
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
  if (last === null) throw new Error('pathway shares have no positive share');
  return last; // x at a total that rounded up
}

/**
 * The k-th initiation month on a parcel at risk from day `r` (§4.4.4 steps 1-2), on the parcel's
 * `(entity, k)` stream: the geometric month `T = max(1, ceil(log(1 − u) / l1))` by inverse CDF,
 * with `l1 = log(1 − h)` < 0. With segments (regimes or later market steps: `bounds` =
 * `regimeMonths(r, segments.days)`, `rates` each segment's log(1 − h)), the piecewise hazard
 * (ruling 1, generalised): `piecewiseMonth(L, bounds, rates)`, L = log(1 − u), 0 = never. Its
 * first segment is the unswitched expression, so draws before the first boundary are unchanged.
 */
function initiationMonth(
  stream: number,
  l1: number,
  bounds: number[] | null,
  rates: number[]
): number {
  return ordinaryMonth(drawOn(stream, P.INIT, 0), l1, bounds, rates);
}

/**
 * `initiationMonth`'s arithmetic on a given draw `u`.
 * @internal exported for the funded latents (`funded.ts`), which read the ordinary month here
 */
export function ordinaryMonth(
  u: number,
  l1: number,
  bounds: readonly number[] | null,
  rates: readonly number[]
): number {
  if (bounds === null) return Math.max(1, Math.ceil(log(1 - u) / l1));
  return piecewiseMonth(log(1 - u), bounds, rates);
}

/**
 * The initiation day in month T from `r` (§4.4.4 step 3), placed uniformly within the month on
 * the same stream. Null when T is 0 (never) or the day falls after the horizon.
 */
function initiationDay(run: Run, stream: number, T: number, r: Day): Day | null {
  if (T === 0) return null;
  const v = drawOn(stream, P.INIT_DAY, 0);
  const day = r + 1 + Math.floor((T - 1 + v) * MONTH_DAYS);
  return day > run.horizon ? null : day;
}

/**
 * The k-th simulated project on T11 row i, initiated on `day` with `existing` units on the parcel
 * (0 once it has been demolished in the run), on its `(entity, k)` stream: its size (§4.4.4),
 * then `startSimulated`. Null if no size level gains a home. `view`: the regime its initiation
 * month ran on (0 = `run.parcels`, k = `run.regimes[k − 1]`), whose size row, yields, envelope and
 * Local Program it takes (ruling 1: a project keeps the regime of the month it initiated in).
 * @internal exported for the funded pass (`funded.ts`)
 */
export function simulatedProject(
  run: Run,
  job: Job,
  i: number,
  stream: number,
  k: number,
  day: Day,
  existing: number,
  view: number
): Schedule | null {
  const sw = view > 0 ? run.regimes[view - 1] : null;
  const p = sw ? sw.parcels : run.parcels;
  // the precomputed row is against T11 existingUnits; a demolished parcel needs its own (rare)
  const own = existing === p.existingUnits[i];
  const cum = own ? (sw ?? run).pre.sizeCum : sizeCumAgainst((sw ?? run).input, i, existing);
  const at = own ? i * F : 0;
  const u = drawOn(stream, P.SIZE, 0);
  let f = 0;
  while (f < F && !(u < cum[at + f])) f++;
  if (f === F) return null;
  return startSimulated(run, job, i, stream, k, day, existing, view, f, null, false);
}

/**
 * The simulated project of size level `f` on T11 row i in view `view`, started on `day` (see
 * `simulatedProject`): pathway (`pathway`, or null to draw it as today: `streamlined` on a Local
 * Program lot, else from `pathwayForNew`), first stage and the stage steps. A `certain` project
 * (finance-engine spec 4.9) runs its stage steps with `Job.certain` and no revisions; any other
 * runs the ordinary steps with the simulated revision rule.
 * @internal exported for the funded pass (`funded.ts`)
 */
export function startSimulated(
  run: Run,
  job: Job,
  i: number,
  stream: number,
  k: number,
  day: Day,
  existing: number,
  view: number,
  f: number,
  pathway: Pathway | null,
  certain: boolean
): Schedule {
  const sw = view > 0 ? run.regimes[view - 1] : null;
  const p = sw ? sw.parcels : run.parcels;
  const cal = run.newCal;
  const path: Pathway =
    pathway ?? (p.localProgram[i] === 1 ? 'streamlined' : newPathway(cal, stream));
  const first: Stage =
    drawOn(stream, P.PPA, 0) < cal.ppaShare[path]
      ? 'preApplication'
      : path === 'permitOnly'
        ? 'permitFiled'
        : 'filed';
  const entered: Partial<Record<Stage, Day>> = {};
  entered[first] = day;
  let top = 0;
  for (let g = 0; g < F; g++) top = Math.max(top, p.yield[i * F + g]);
  job.stream = stream;
  job.pathway = path;
  job.cal = cal;
  job.scale = run.newScale; // scales every stage's time (paired-draw fix)
  job.entered = entered;
  job.revisions = [
    { day, units: p.yield[i * F + f], stories: fillStories(FILL_LEVELS[f], p.envelopeStories[i]) }
  ];
  job.rule = certain ? NONE : SIMULATED;
  job.certain = certain;
  job.parcels = p;
  job.row = i;
  job.existing = existing;
  job.top = top;
  job.env = p.envelopeStories[i];
  const end = runStages(run, job, first, day, false);
  const s: Schedule = {
    projectId: run.ids ? `sim:${p.id[i]}:${k}` : '',
    origin: 'simulated',
    parcelIds: run.ids ? [p.id[i]] : NO_IDS,
    pathway: path,
    entered,
    end,
    revisions: job.revisions,
    existingUnits: existing,
    multiPhase: false,
    phase: null
  };
  // only on a run with regimes, so every other Schedule (and every golden) is unchanged
  if (run.regimes.length > 0) s.regime = view;
  return s;
}

/**
 * Whether a row's holders void its reservation from day `d`: one never ends (a completion, an open
 * end or a skipped row: `blocked`) or exited on or after `d`.
 * @internal exported for the funded pass (`funded.ts`)
 */
export function holdVoids(hold: Hold | undefined, d: Day): boolean {
  return hold !== undefined && (hold.blocked || (hold.lastExit !== null && hold.lastExit >= d));
}

/**
 * The simulated pass (§4.4.4, §4.4.6), after every in-flight pass has filled `holds`. Each
 * hostable parcel with a hazard (`candidates`) is at risk from `asOf` (no hold) or from its
 * holders' last exit, with k = 0, unless a holder blocks it. After a simulated exit on day x it
 * is at risk again from x with k + 1; a completion or an open end finishes it. The parcel is
 * demolished at the first construction entry of any project on it, and every later project on
 * it has 0 existing units. A parcel no project holds, whose first initiation draw is above its
 * `skipAbove` bound, cannot initiate by the horizon and is passed over on that one draw. With
 * regimes or later market steps, each initiation month runs on its segment's view and market
 * step (`initiationMonth`, `simulatedProject`; spec §4.8).
 *
 * A row reserved from day d (`reservedFrom`) keeps its reservation unless a project began on it
 * before d and had not exited before d: a holder that voids it (`holdVoids`), or a simulated
 * project initiated before d that completes, stays open or exits on or after d. While kept, the
 * row's loop stops at the first initiation day ≥ d; once voided it runs exactly as unreserved.
 * Every reserved row, candidate or not, is reported once to `sink.reservation`.
 */
function simulatedPass(run: Run, holds: Holds, sink: Sink): void {
  const { parcels, pre, st, reservedFrom } = run;
  const { candidates, entity, log1mh, segments } = pre;
  const skip = pre.skipAbove(run.horizon);
  const job = newJob(run);
  // regime days and later market days, merged (spec §4.8); without market steps, the regime days
  const { days } = segments;
  const K = days.length;
  const rates = new Array<number>(K + 1);
  for (let c = 0; c < candidates.length; c++) {
    const i = candidates[c];
    let r = run.asOf;
    let demolished = false;
    let stream = streamOf(run.sh, entity[c], 0);
    // the reservation day while it is still kept; 0 = none or voided
    let d = reservedFrom === null ? 0 : reservedFrom[i];
    const reserved = d > 0;
    if (st.held[i] === 1) {
      const hold = holds.get(i);
      if (d > 0 && holdVoids(hold, d)) d = 0;
      if (hold?.blocked) {
        if (reserved) sink.reservation?.(i, false);
        continue;
      }
      r = Math.max(run.asOf, hold?.lastExit ?? run.asOf);
      demolished = hold !== undefined && hold.demolished !== null;
    } else if (drawOn(stream, P.INIT, 0) > skip[c]) {
      if (reserved) sink.reservation?.(i, true);
      continue;
    }
    if (K > 0) for (let j = 0; j <= K; j++) rates[j] = segments.log1mh[j][i];
    for (let k = 0; ; k++) {
      if (k > 0) stream = streamOf(run.sh, entity[c], k);
      const bounds = K > 0 ? regimeMonths(r, days) : null;
      const T = initiationMonth(stream, log1mh[i], bounds, rates);
      const day = initiationDay(run, stream, T, r);
      if (day === null) break;
      if (d > 0 && day >= d) break;
      let seg = 0;
      if (bounds !== null) while (seg < K && bounds[seg] < T) seg++;
      const view = segments.view[seg];
      const existing = demolished ? 0 : parcels.existingUnits[i];
      const s = simulatedProject(run, job, i, stream, k, day, existing, view);
      if (s === null) break;
      sink.schedule(s);
      // initiated before d (or there is no live reservation): void it unless it exits before d
      if (d > 0 && (s.end.kind !== 'exit' || s.end.day >= d)) d = 0;
      if (s.entered.construction !== undefined) demolished = true;
      if (s.end.kind !== 'exit') break;
      r = s.end.day;
    }
    if (reserved) sink.reservation?.(i, d > 0);
  }
  if (reservedFrom !== null) reservationsOff(run, holds, sink, candidates);
}

/**
 * Reports the reserved rows that are not candidates: kept unless a holder voids them.
 * @internal exported for the funded pass (`funded.ts`)
 */
export function reservationsOff(run: Run, holds: Holds, sink: Sink, candidates: Int32Array): void {
  const rf = run.reservedFrom!;
  let c = 0;
  for (let i = 0; i < rf.length; i++) {
    while (c < candidates.length && candidates[c] < i) c++;
    if (rf[i] === 0 || (c < candidates.length && candidates[c] === i)) continue;
    sink.reservation?.(i, !holdVoids(holds.get(i), rf[i]));
  }
}

/** Options of `runEngineWith` (tests only; `runEngine` passes none). */
export interface EngineOpts {
  /** how the line is served: `'scan'` (the definition, spec 4.6) or `'grouped'` (spec 4.17) */
  serving?: 'scan' | 'grouped';
  /** after every ledger event: the event and every pool's available money as the engine holds it */
  probe?: (e: LedgerEvent, available: readonly number[]) => void;
  /**
   * The waiting line in key order: after each day the funded day loop processes, then once at the
   * end of the run with the horizon as its day. The applications are live: copy what you keep.
   */
  lineProbe?: (day: Day, apps: readonly App[]) => void;
}

/**
 * Runs the engine for one seed and horizon, handing every Schedule and Master to `sink` in no
 * particular order. Pure: the skipped-rows count is logged by `loadScenario`, not here. With
 * `input.finance` absent the simulated pass is today's (`simulatedPass`); with it, `fundedPass`
 * (finance-engine spec 4.1).
 */
export function runEngine(input: SimInput, seed: number, horizon: Day, sink: Sink): void {
  runEngineWith(input, seed, horizon, sink, {});
}

/** `runEngine` with test-only options (`EngineOpts`). */
export function runEngineWith(
  input: SimInput,
  seed: number,
  horizon: Day,
  sink: Sink,
  opts: EngineOpts
): void {
  const run = runOf(input, seed, horizon, sink.ids ?? true);
  const holds: Holds = new Map();
  pipelinePass(run, holds, sink);
  multiPhasePass(run, holds, sink);
  if (input.finance) fundedPass(run, holds, sink, opts);
  else simulatedPass(run, holds, sink);
}
