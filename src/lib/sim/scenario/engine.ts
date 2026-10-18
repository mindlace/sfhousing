// The deterministic schedule engine behind `simulate` (spec §4.4). Pure and worker-safe: every
// number comes from the SimInput, every uniform from the counter-based `draw`, and `exp`/`log`
// only from `src/lib/timelapse/math.ts` (via T12).
//
// A run is a sequence of passes over one `Run`:
//   1. the pipeline pass: every runnable unphased T3 row becomes a Schedule (§4.4.3), and the
//      parcels it holds are recorded in `Holds` (how each holder ends, its first construction);
//   2. the multi-phase pass (§4.4.3a): masters and their phase sub-projects;
//   3. the simulated pass (§4.4.4): initiation over the hostable parcels, reading `Holds`.
// Every pass steps stages with `runStages` and revises with `pushRevision`, and hands each result
// to the `Sink`, so the detailed and the net consumers share one engine.
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
import { precomputeOf, sizeCumAgainst, type Precompute } from './input';
import { P, draw, jobEntity, simEntity, stageRedraw } from './rng';
import type { Master } from './simulate';
import type { Schedule, SimInput } from './types';

/** Where the engine hands its results. */
export interface Sink {
  schedule(s: Schedule): void;
  master(m: Master): void;
}

type End = Schedule['end'];
type Revision = Schedule['revisions'][number];
type Histogram = RevisionModel['at'][number]['ratio'];

const STAGE_INDEX = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i])) as Record<Stage, number>;
const CONSTRUCTION = STAGE_INDEX.construction;
/** In-flight redraws after the first attempt (8 attempts in all; tier 4, numerical only). */
const REDRAWS = 7;

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

/** One run's constants. */
interface Run {
  seed: number;
  horizon: Day;
  asOf: Day;
  cal: Calibration;
  parcels: ScenarioParcels;
  input: SimInput;
  /** the per-input precompute (memoised by input identity): hazards, log(1 − h), size rows */
  pre: Precompute;
  /** by STAGE_ORDER index: the first `revision.at` entry for the stage, if any */
  revisionAt: (RevisionModel['at'][number] | undefined)[];
}

function runOf(input: SimInput, seed: number, horizon: Day): Run {
  const revisionAt: Run['revisionAt'] = STAGE_ORDER.map(() => undefined);
  for (const a of input.calibration.revision.at) {
    const i = STAGE_INDEX[a.stage];
    if (revisionAt[i] === undefined) revisionAt[i] = a;
  }
  return {
    seed,
    horizon,
    asOf: input.asOf,
    cal: input.calibration,
    parcels: input.parcels,
    input,
    pre: precomputeOf(input),
    revisionAt
  };
}

/** units' and stories' of a revision, from the current last entry and the drawn ratio. */
type Resize = (
  units: number,
  stories: number | null,
  ratio: number
) => { units: number; stories: number | null };

/** A project being stepped: its draw stream and the record the steps fill. */
interface Job {
  entity: number;
  k: number;
  pathway: Pathway;
  entered: Partial<Record<Stage, Day>>;
  /** never empty: [0] is the initial proposal */
  revisions: Revision[];
  resize: Resize;
}

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
 * The pipeline rescaling rule (§4.4.5 steps 3-4) for a project on `parcelIds`. A parcel absent
 * from T11 contributes nothing to either cap (Review Focus 1).
 */
function pipelineResize(parcels: ScenarioParcels, parcelIds: readonly ParcelId[]): Resize {
  const F = FILL_LEVELS.length;
  let yieldCap = 0;
  let envelope = 0;
  for (const id of parcelIds) {
    const i = parcels.index.get(id);
    if (i === undefined) continue;
    yieldCap += parcels.yield[i * F + F - 1];
    envelope = Math.max(envelope, parcels.envelopeStories[i]);
  }
  return (units, stories, ratio) => {
    const next = Math.min(Math.max(1, Math.round(ratio * units)), Math.max(units, yieldCap));
    if (stories === null) return { units: next, stories: null };
    let s = Math.max(1, Math.round((stories * next) / units));
    if (next > units) s = Math.min(s, Math.max(stories, envelope));
    return { units: next, stories: s };
  };
}

/** A revision on entering stage `n` on `day` (§4.4.5 steps 1-5); none from construction on. */
function revise(run: Run, job: Job, n: Stage, day: Day): void {
  const i = STAGE_INDEX[n];
  if (i >= CONSTRUCTION) return;
  const at = run.revisionAt[i];
  if (at === undefined) return;
  if (!(draw(run.seed, job.entity, job.k, P.REV, i) < at.probability)) return;
  const ratio = revisionRatio(at.ratio, draw(run.seed, job.entity, job.k, P.REV_RATIO, i));
  const last = job.revisions[job.revisions.length - 1];
  const next = job.resize(last.units, last.stories, ratio);
  if (next.units !== last.units) pushRevision(job.revisions, day, next.units, next.stories);
}

/**
 * One stage step (§4.4.2 steps 1-2): the outcome of leaving `s`, entered on day `e`, and its day.
 * `inFlight` marks an in-flight project's current stage: it is conditioned on the months already
 * survived, and redrawn (up to 8 attempts) until the day is after `asOf`; if every attempt lands
 * on or before `asOf`, the last outcome is kept at `asOf + 1`.
 */
function stageStep(
  run: Run,
  job: Job,
  s: Stage,
  e: Day,
  inFlight: boolean
): { kind: 'advance' | ExitReason; day: Day } {
  const t = s === 'complete' ? undefined : run.cal.transitions[job.pathway][s];
  if (t === undefined) throw new Error(`calibration has no ${job.pathway} ${s} transition`);
  const idx = STAGE_INDEX[s];
  if (!inFlight) {
    const r = sampleTransition(t, draw(run.seed, job.entity, job.k, P.STAGE, idx), 0);
    return { kind: r.kind, day: e + Math.floor(r.days) };
  }
  const m = monthsIn(e, run.asOf);
  let kind: 'advance' | ExitReason = 'advance';
  for (let j = 0; j <= REDRAWS; j++) {
    const purpose = j === 0 ? P.STAGE : stageRedraw(j as 1 | 2 | 3 | 4 | 5 | 6 | 7);
    const r = sampleTransition(t, draw(run.seed, job.entity, job.k, purpose, idx), m);
    const day = e + Math.floor(r.days);
    if (day > run.asOf) return { kind: r.kind, day };
    kind = r.kind;
  }
  return { kind, day: run.asOf + 1 };
}

/**
 * Steps `job` from stage `stage`, entered on day `e`, until it exits, completes or passes the
 * horizon (§4.4.2 step 3), filling `job.entered` and revising on each later entry. `inFlight`
 * conditions the first step only.
 */
function runStages(run: Run, job: Job, stage: Stage, e: Day, inFlight: boolean): End {
  let s = stage;
  let from = e;
  let conditioned = inFlight;
  for (;;) {
    const { kind, day } = stageStep(run, job, s, from, conditioned);
    if (day > run.horizon) return { kind: 'open' };
    if (kind !== 'advance') return { kind: 'exit', stage: s, reason: kind, day };
    const n = nextStage(job.pathway, s);
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

/** Adds one holder's end and construction day to each of its parcels present in T11. */
export function addHold(
  holds: Holds,
  parcels: ScenarioParcels,
  parcelIds: readonly ParcelId[],
  entered: Partial<Record<Stage, Day>>,
  end: End
): void {
  const built = entered.construction;
  for (const id of parcelIds) {
    const i = parcels.index.get(id);
    if (i === undefined) continue;
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

/** Rows the engine does not run (§4.4.3): already complete, or permitOnly at a Planning stage. */
function isSkipped(p: InFlightProject): boolean {
  return (
    p.stage === 'complete' ||
    (p.pathway === 'permitOnly' && (p.stage === 'filed' || p.stage === 'entitled'))
  );
}

/** A multi-phase row with phases: a master plus phase sub-projects (§4.4.3a), not a Schedule. */
function isPhased(p: InFlightProject): boolean {
  return p.multiPhase && p.phases !== null;
}

const loggedSkips = new WeakSet<SimInput>();

function logSkips(input: SimInput): void {
  if (loggedSkips.has(input)) return;
  loggedSkips.add(input);
  let n = 0;
  for (const p of input.projects) if (isSkipped(p)) n++;
  if (n > 0) {
    console.warn(
      `[sim] projects.json: skipped ${n} project(s) the simulation does not run ` +
        '(complete, or permitOnly at filed or entitled)'
    );
  }
}

/**
 * One pipeline row (§4.4.3): history days clamped to `asOf`, the current stage entered on its
 * history day (or `asOf`, unconditioned, when absent), stepped from there with the in-flight
 * conditioning. Entity `'j:' + id`, k = 0.
 */
function pipelineRow(run: Run, p: InFlightProject): Schedule {
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
  const job: Job = {
    entity: jobEntity(p.id),
    k: 0,
    pathway: p.pathway,
    entered,
    revisions: [{ day: first, units: p.units, stories: p.stories }],
    resize: pipelineResize(run.parcels, p.parcelIds)
  };
  const end = runStages(run, job, p.stage, e, true);
  return {
    projectId: p.id,
    origin: 'pipeline',
    parcelIds: [...p.parcelIds],
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
function pipelinePass(run: Run, projects: readonly InFlightProject[], holds: Holds, sink: Sink) {
  for (const p of projects) {
    if (isSkipped(p)) {
      addHold(holds, run.parcels, p.parcelIds, p.history, HELD);
      continue;
    }
    if (isPhased(p)) continue;
    const s = pipelineRow(run, p);
    addHold(holds, run.parcels, s.parcelIds, s.entered, s.end);
    sink.schedule(s);
  }
}

/**
 * The simulated rescaling rule (§4.4.5 steps 3-4) on T11 row i with `existing` units left:
 * `min(yield[F−1], max(existing + 1, round(r·u)))`, stories from the smallest level whose yield
 * reaches the new units.
 */
function simulatedResize(parcels: ScenarioParcels, i: number, existing: number): Resize {
  const F = FILL_LEVELS.length;
  const env = parcels.envelopeStories[i];
  const top = parcels.yield[i * F + F - 1];
  return (units, _stories, ratio) => {
    const next = Math.min(top, Math.max(existing + 1, Math.round(ratio * units)));
    let f = 0;
    while (f < F - 1 && parcels.yield[i * F + f] < next) f++;
    return { units: next, stories: fillStories(FILL_LEVELS[f], env) };
  };
}

/** A new project's pathway from the normalised `pathwayForNew`, in `PATHWAYS` order (§4.4.4). */
function newPathway(run: Run, entity: number, k: number): Pathway {
  const w = run.cal.pathwayForNew;
  let total = 0;
  for (const p of PATHWAYS) if (w[p] > 0) total += w[p];
  const x = draw(run.seed, entity, k, P.PATHWAY, 0) * total;
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
 * The k-th initiation day on a parcel at risk from day `r` (§4.4.4 steps 1-3): the geometric
 * month `T = max(1, ceil(log(1 − u) / log(1 − h)))` by inverse CDF, placed uniformly within the
 * month. Null when it falls after the horizon. `log1mh` must be < 0 (h > 0).
 */
function initiationDay(run: Run, entity: number, k: number, log1mh: number, r: Day): Day | null {
  const u = draw(run.seed, entity, k, P.INIT, 0);
  const T = Math.max(1, Math.ceil(log(1 - u) / log1mh));
  const v = draw(run.seed, entity, k, P.INIT_DAY, 0);
  const day = r + 1 + Math.floor((T - 1 + v) * MONTH_DAYS);
  return day > run.horizon ? null : day;
}

/**
 * The k-th simulated project on T11 row i, initiated on `day` with `existing` units on the parcel
 * (0 once it has been demolished in the run): pathway, first stage and size (§4.4.4), then the
 * ordinary stage steps with the simulated revision rule. Null if no size level gains a home.
 */
function simulatedProject(
  run: Run,
  i: number,
  entity: number,
  k: number,
  day: Day,
  existing: number
): Schedule | null {
  const p = run.parcels;
  const F = FILL_LEVELS.length;
  const pathway: Pathway = p.localProgram[i] === 1 ? 'streamlined' : newPathway(run, entity, k);
  const first: Stage =
    draw(run.seed, entity, k, P.PPA, 0) < run.cal.ppaShare[pathway]
      ? 'preApplication'
      : pathway === 'permitOnly'
        ? 'permitFiled'
        : 'filed';
  // the precomputed row is against T11 existingUnits; a demolished parcel needs its own (rare)
  const own = existing === p.existingUnits[i];
  const cum = own ? run.pre.sizeCum : sizeCumAgainst(run.input, i, existing);
  const at = own ? i * F : 0;
  const u = draw(run.seed, entity, k, P.SIZE, 0);
  let f = 0;
  while (f < F && !(u < cum[at + f])) f++;
  if (f === F) return null;
  const entered: Partial<Record<Stage, Day>> = {};
  entered[first] = day;
  const job: Job = {
    entity,
    k,
    pathway,
    entered,
    revisions: [
      { day, units: p.yield[i * F + f], stories: fillStories(FILL_LEVELS[f], p.envelopeStories[i]) }
    ],
    resize: simulatedResize(p, i, existing)
  };
  const end = runStages(run, job, first, day, false);
  return {
    projectId: `sim:${p.id[i]}:${k}`,
    origin: 'simulated',
    parcelIds: [p.id[i]],
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
 * hostable parcel with a hazard is at risk from `asOf` (no hold) or from its holders' last exit,
 * with k = 0, unless a holder blocks it. After a simulated exit on day x it is at risk again from
 * x with k + 1; a completion or an open end finishes it. The parcel is demolished at the first
 * construction entry of any project on it, and every later project on it has 0 existing units.
 */
function simulatedPass(run: Run, holds: Holds, sink: Sink): void {
  const { parcels, pre } = run;
  for (let i = 0; i < parcels.count; i++) {
    // log1mh is 0 for h = 0, and for an h so small that 1 − h rounds to 1: never initiates
    if (parcels.hostable[i] !== 1 || !(pre.hazard[i] > 0) || !(pre.log1mh[i] < 0)) continue;
    const hold = holds.get(i);
    if (hold?.blocked) continue;
    let r = Math.max(run.asOf, hold?.lastExit ?? run.asOf);
    let demolished = hold !== undefined && hold.demolished !== null;
    const entity = simEntity(parcels.id[i]);
    for (let k = 0; ; k++) {
      const day = initiationDay(run, entity, k, pre.log1mh[i], r);
      if (day === null) break;
      const s = simulatedProject(run, i, entity, k, day, demolished ? 0 : parcels.existingUnits[i]);
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
 * particular order. Pure apart from the once-per-input skipped-rows log.
 */
export function runEngine(input: SimInput, seed: number, horizon: Day, sink: Sink): void {
  logSkips(input);
  const run = runOf(input, seed, horizon);
  const holds: Holds = new Map();
  pipelinePass(run, input.projects, holds, sink);
  // Task 6: the multi-phase pass goes here, recording master and phase parcels with addHold.
  simulatedPass(run, holds, sink);
}
