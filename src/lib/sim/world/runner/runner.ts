// The timeline runner (ensemble-runner spec rules 3 to 11, 18 to 21; plan D2, D3, D5 to D7, D9 to
// D12): two compiles, two ensembles (the plan and its comparison), the map stream of the plan's
// world 1, and the posts, in slices of a macrotask each.
//
// A slice runs units in this order: for the ensemble with the lower month (the plan on a tie,
// rules 6 and 16), a compile step when its next frame is not ready (rule 11), else its next unit;
// a world steps only while it is not ahead of the other ensemble. When neither has a unit, an
// unfinished compile steps on, so its `ScoreStatics` arrive (D2). A unit of a kind runs only when
// the time used plus the largest of that kind's last 4 costs fits in `SLICE_PLAN_MS`; the first
// unit of a slice always runs (D7). After the units: one `compiling` if the progress changed;
// statics for a compile that finished (and `compiled` for the plan's); at most one `filled`
// (rule 8); `lookups` when the frame in view changed its permitting (D10).
//
// A flush of the map stream is a macrotask of its own (D6), at most every `FLUSH_EVERY_MS`, never
// while a restore re-steps quietly; when filling ends the stream is drained until an update says
// `complete` (D5). Warm units mass world 1's started and revised projects on the shared generator
// memo just before a flush (D12), in slices of their own. A throw in a unit posts `error`
// `'timeline'` and stops filling; the lookups (`viewFrame`, `card`) keep answering (rule 21).
//
// Edits (`setPolicy`) are Task 6; this file holds what opening needs.
// Worker-bundle module: zod-free, DOM-free, $app-free.
import type { ParcelId } from '$lib/data/parcel';
import { packTimedTransferables } from '$lib/map/pack-timed';
import { LeverFormatError } from '$lib/sim/levers/types';
import type { Rev } from '$lib/sim/protocol';
import { massingFor } from '$lib/sim/scenario/massing';
import { SLICE_PLAN_MS } from '$lib/sim/scenario/scenario-host';
import type { TimelineErrorCode, TimelineResponse } from '$lib/sim/timeline-protocol';
import type { Day } from '$lib/timelapse/time';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { createMapStream, type MapStream } from '../map-stream';
import { monthLastDay, monthOfDay } from '../months';
import { comparisonOf } from '../policy/compare';
import { compileTimeline, type TimelineCompile } from '../policy/compile';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { lookupsAt } from '../policy/lookups';
import { scheduleAt } from '../read';
import * as scoreModule from '../score';
import type { MoneyFeed, ScoreStatics, WorldSeries } from '../score';
import { finalTable } from '../score/statics';
import type { World, WorldEvent } from '../types';
import type { Dataset } from './dataset';
import { COPY_MONTHS, createEnsemble, type Ensemble, type UnitKind } from './ensemble';
import { scheduleReady } from './lookups';

// Bound once, as world-core's hot modules do (docs/dev/world-core.md, Cost).
const { chunkOf, scoreStaticsOf } = scoreModule;

/** Budget of one compile step (rule 11). */
export const COMPILE_STEP_MS = 20;
/** Flushes of the map stream are at least this far apart (rule 9). */
export const FLUSH_EVERY_MS = 250;
/** Budget of one flush (rule 9). */
export const FLUSH_BUDGET_MS = 20;
/** A kind's cost estimate is the largest of its last this many costs (D7, as scenario-host.ts). */
const COST_WINDOW = 4;

export interface RunnerDeps {
  dataset: Dataset;
  post(msg: TimelineResponse, transfer: ArrayBuffer[]): void;
  now(): number;
  later(fn: () => void, ms: number): unknown;
  warn(msg: string): void;
  logOnce(k: string, m: string): void;
}

export interface Runner {
  open(
    rev: Rev,
    policy: SimPolicy4,
    lots: Record<string, ParcelId[]>,
    worlds: number,
    months: number
  ): void;
  /** Task 6. */
  setPolicy(rev: Rev, policy: SimPolicy4, lots: Record<string, ParcelId[]>): void;
  viewMonth(month: number): void;
  resyncMap(): void;
  /** A chunk loaded or the loader's report changed: a stalled compile or a waiting cell may move. */
  chunkArrived(): void;
  /** A viewport's cells: the loader also wants the cells of the projects anchored in them (S17). */
  wantCells(cells: Iterable<string>): void;
  /** Plan frame at the last viewMonth (clamped to 1..readyThrough), or null before month 1's frame. */
  viewFrame(): PolicyFrame | null;
  /** World 1 of the plan as it stands and the frame of the model month holding `day` (clamped, rule 18). */
  card(day: Day): { world: World; frame: PolicyFrame; day: Day } | null;
  /** The plan and comparison ensembles (null before their month 1 frame); for Task 6 and tests. */
  ensembles(): { plan: Ensemble | null; comp: Ensemble | null };
  dispose(): void;
}

type Kind = UnitKind | 'compile' | 'warm';

/** One ensemble with its compile and its statics. */
interface Side {
  readonly isPlan: boolean;
  base: 'plan' | 'preFzp';
  compile: TimelineCompile;
  /** The compile's timeline, once month 1's frame exists. */
  timeline: PolicyTimeline | null;
  ensemble: Ensemble | null;
  statics: ScoreStatics | null;
  /** Every frame of the window exists. */
  done: boolean;
  /** Finished in this slice: statics and `compiled` are due after it. */
  justDone: boolean;
  /** The last step made no progress: it waits on chunks until `chunkArrived`. */
  stalled: boolean;
}

interface Unit {
  kind: Kind;
  side: Side | null;
}

/** A compile step's `LeverFormatError`: the document is rejected, `bad-request` (rule 12, D11). */
class Rejected extends Error {
  constructor(readonly reason: LeverFormatError) {
    super(reason.message);
  }
}

export function createRunner(deps: RunnerDeps): Runner {
  const ds = deps.dataset;
  const asOf = ds.loaded.fzp.asOf;

  let rev: Rev = 0;
  let months = 0;
  let worlds = 0;
  let plan: Side | null = null;
  let comp: Side | null = null;
  let stream: MapStream | null = null;
  /** The last calendar month posted in a `filled`. */
  let posted = -1;
  /** `finalTable` of the plan's statics. */
  let final: Int32Array | null = null;
  /** The plan's frames carry money (D9). */
  let money = false;
  let lastProgress: string | null = null;
  /** Filling stopped by a throw (rule 21) or a rejected document. */
  let failed = false;
  let disposed = false;
  let pending = false;

  /** The last `viewMonth` received (month 1 before any). */
  let view = 1;
  /** The permitting of the frame whose lookups were posted last (D10). */
  let lookedAt: Pick<PolicyFrame, 'calibration' | 'newCalibration' | 'speed' | 'speedNew'> | null =
    null;

  // the map stream
  let lastFlushAt = -Infinity;
  /** World 1 sent an event or a chunk arrived since the last flush. */
  let dirty = false;
  /** The last update said `complete`. */
  let complete = false;
  /** World 1's rows started or revised, to mass before the next flush (D12). */
  const warm = new Set<number>();

  const costs = new Map<Kind, number[]>();

  const post = (msg: TimelineResponse, transfer: ArrayBuffer[] = []) => {
    if (!disposed) deps.post(msg, transfer);
  };

  function fail(e: unknown, code: TimelineErrorCode = 'timeline'): void {
    failed = true;
    post({ type: 'error', rev, code, message: String(e) });
  }

  // --- choosing units ---

  /** -1 until every world of the side exists. */
  const monthOf = (s: Side): number => (s.ensemble ? s.ensemble.month : -1);
  const otherOf = (s: Side): Side => (s === plan ? comp! : plan!);

  /** The frame this side's next step needs is not compiled yet (rule 11). */
  function needsFrame(s: Side): boolean {
    if (s.done || s.stalled) return false;
    if (s.timeline === null) return true;
    return s.timeline.readyThrough() < Math.min(months, Math.max(monthOf(s), 0) + 1);
  }

  function pick(): Unit | null {
    if (plan === null || comp === null) return null;
    const order = monthOf(comp) < monthOf(plan) ? [comp, plan] : [plan, comp];
    for (const s of order) {
      if (needsFrame(s)) return { kind: 'compile', side: s };
      const k = s.ensemble?.next() ?? null;
      if (k === null) continue;
      // rule 6: a world steps only while its ensemble is not ahead of the other
      if ((k === 'step' || k === 'quiet') && monthOf(s) > monthOf(otherOf(s))) continue;
      return { kind: k, side: s };
    }
    for (const s of order) if (!s.done && !s.stalled) return { kind: 'compile', side: s };
    return null;
  }

  function estimate(kind: Kind): number | undefined {
    const recent = costs.get(kind);
    return recent === undefined ? undefined : Math.max(...recent);
  }

  function measure(kind: Kind, ms: number): void {
    let recent = costs.get(kind);
    if (recent === undefined) costs.set(kind, (recent = []));
    recent.push(ms);
    if (recent.length > COST_WINDOW) recent.shift();
  }

  // --- units ---

  /** The timeline once month 1's frame exists; `result()` throws before that, and only then. */
  function timelineOf(c: TimelineCompile): PolicyTimeline | null {
    try {
      return c.result();
    } catch {
      return null;
    }
  }

  /**
   * One compile step. The side is stalled (it waits for `chunkArrived`) only when the step said
   * "waiting on cells": it returned false before its budget was spent, with neither the frames
   * nor the recompute count moved. A step returns false for exactly two reasons: its budget is
   * spent (compile.ts:380, :383; zoning-view.ts:155-156), or a view job's recompute could not
   * finish (zoning-view.ts:124-128, the only unit that returns false); a recompute step computes
   * every ready need it can, so one that returns at once with nothing done waits on chunks
   * (scenario-host.ts:960-962). The other view-job units (twin, resolve, apply, precompute) move
   * neither count and can each spend the whole budget on the live city: that is progress.
   */
  function compileUnit(s: Side): void {
    const before = s.timeline === null ? 0 : s.timeline.readyThrough();
    const doneBefore = s.compile.progress().done;
    const t0 = deps.now();
    let finished: boolean;
    try {
      finished = s.compile.step(COMPILE_STEP_MS);
    } catch (e) {
      if (e instanceof LeverFormatError) throw new Rejected(e);
      throw e;
    }
    const spent = deps.now() - t0 >= COMPILE_STEP_MS;
    if (finished) {
      s.done = true;
      s.justDone = true;
    }
    if (s.timeline === null) {
      s.timeline = timelineOf(s.compile);
      if (s.timeline !== null) s.ensemble = ensembleOf(s, s.timeline);
    }
    const after = s.timeline === null ? 0 : s.timeline.readyThrough();
    if (!finished && !spent && after === before && s.compile.progress().done === doneBefore)
      s.stalled = true;
  }

  function ensembleOf(s: Side, t: PolicyTimeline): Ensemble {
    return createEnsemble({
      statics: ds.statics,
      timeline: t,
      worlds,
      months,
      copyMonths: COPY_MONTHS,
      world1: s.isPlan ? { stream, onEvent } : undefined
    });
  }

  /** World 1's events outside quiet steps (the stream has them already). */
  function onEvent(e: WorldEvent): void {
    dirty = true;
    if (e.kind === 'start' || e.kind === 'revise') warm.add(e.row);
  }

  /** Masses one of world 1's queued rows on the generator memo the stream's massings share. */
  function warmUnit(): void {
    const row: number = warm.values().next().value!;
    warm.delete(row);
    const w = plan?.ensemble?.worlds[0];
    if (w === undefined) return;
    const s = scheduleAt(w, ds.statics, row, monthLastDay(asOf, w.month));
    // a cell waiting on its chunk is massed by the flush once ready
    if (s === null || !scheduleReady(ds, s)) return;
    for (let k = 0; k < s.revisions.length; k++) massingFor(s, k, ds.massing);
  }

  function run(u: Unit): void {
    if (u.kind === 'compile') compileUnit(u.side!);
    else if (u.kind === 'warm') warmUnit();
    else u.side!.ensemble!.unit();
  }

  // --- after a slice ---

  function moneyOf(through: number): MoneyFeed | null {
    if (!money) return null;
    const e = plan!.ensemble!;
    // A9: the frame object from the timeline in use
    const m = Math.max(1, Math.min(months, final![through]));
    return {
      ledger: e.ledger!,
      finance: plan!.timeline!.frameAt(m).finance!,
      world: e.worlds[0],
      statics: ds.statics
    };
  }

  function afterSlice(): void {
    const p = plan!.compile.progress();
    const q = comp!.compile.progress();
    const failedCells = [...new Set([...p.failedCells, ...q.failedCells])].sort();
    const progress = { done: p.done + q.done, total: p.total + q.total, failedCells };
    const key = JSON.stringify(progress);
    if (key !== lastProgress) {
      lastProgress = key;
      post({ type: 'compiling', rev, ...progress });
    }
    for (const s of [plan!, comp!]) {
      if (!s.justDone) continue;
      s.justDone = false;
      // D2, D3: each ensemble's own statics, the very object (a clone throws)
      const st = scoreStaticsOf(
        ds.loaded.fzp,
        s.timeline!,
        s.base,
        months,
        ds.loaded.projects.rhnaCompletedNet
      );
      s.statics = st;
      s.ensemble!.setStatics(st);
      if (!s.isPlan) continue;
      final = finalTable(st);
      const fin = s.timeline!.frameAt(1).finance;
      money = fin !== null && fin.pools.length > 0;
      const missing = s.compile.missingLots();
      if (missing > 0)
        deps.warn(`compile: ${missing} lots changed zoning with no yield record; their yield is 0`);
      post({
        type: 'compiled',
        rev,
        capacity: s.compile.capacity(),
        unknownLots: s.compile.unknownLots(),
        statics: st
      });
    }
    postFilled();
    postLookups();
  }

  /** At most one `filled`: the months final in both ensembles and not posted yet (rule 8). */
  function postFilled(): void {
    const a = plan!.ensemble;
    const b = comp!.ensemble;
    if (!a || !b || plan!.statics === null || comp!.statics === null) return;
    const through = Math.min(a.finalThrough(), b.finalThrough());
    if (through <= posted) return;
    const series = chunkOf(
      a.series as WorldSeries[],
      b.series as WorldSeries[],
      moneyOf(through),
      posted + 1,
      through
    );
    posted = through;
    post({ type: 'filled', rev, through, series });
  }

  const viewMonthOf = (t: PolicyTimeline) => Math.min(Math.max(view, 1), t.readyThrough());

  /** D10: `lookups` when the permitting of the frame in view is not the one last posted. */
  function postLookups(): void {
    const t = plan?.timeline;
    if (!t) return;
    const m = viewMonthOf(t);
    const f = t.frameAt(m);
    const l = lookedAt;
    if (
      l !== null &&
      l.calibration === f.calibration &&
      l.newCalibration === f.newCalibration &&
      l.speed === f.speed &&
      l.speedNew === f.speedNew
    )
      return;
    lookedAt = {
      calibration: f.calibration,
      newCalibration: f.newCalibration,
      speed: f.speed,
      speedNew: f.speedNew
    };
    post({ type: 'lookups', month: m, lookups: { ...lookupsAt(f) } });
  }

  // --- the map stream ---

  const world1 = (): World | undefined => plan?.ensemble?.worlds[0];

  /** Filling has ended: the plan's worlds stand at `months`. */
  const ended = () => (plan?.ensemble?.month ?? -1) >= months;

  /** A flush would have something to say, whenever it is due. */
  function streamWants(): boolean {
    if (stream === null || world1() === undefined || plan!.ensemble!.quiet) return false;
    return dirty || (ended() && !complete);
  }

  const flushDue = () => streamWants() && deps.now() - lastFlushAt >= FLUSH_EVERY_MS;

  function sendCells(u: ReturnType<MapStream['snapshot']>): void {
    complete = u.complete === true;
    post({ type: 'cells', render: u }, u.cells.flatMap(packTimedTransferables));
    // S17: the chunks of projects anchored in the wanted cells, so their anchor cells can go
    const extra = stream!.cellsFor(ds.chunks.wanted);
    if (extra.size > 0) ds.chunks.wantAlso(extra);
  }

  function flush(): void {
    const t0 = deps.now();
    const u = stream!.flush(world1()!, ds.statics, FLUSH_BUDGET_MS);
    lastFlushAt = deps.now();
    // A flush that spent its budget may have left ready dirty cells: flush again when due.
    dirty = lastFlushAt - t0 >= FLUSH_BUDGET_MS;
    if (u !== null) sendCells(u);
  }

  // --- the task loop ---

  const unfinished = (s: Side | null): s is Side => s !== null && !s.done && !s.stalled;
  /** Ahead compiles that did not fit their slice: each is the first unit of a later slice. */
  const owed: Side[] = [];
  /** The last slice's first unit was an owed compile. */
  let owedLast = false;

  function slice(warmOnly: boolean): void {
    const start = deps.now();
    // Controller rulings (Task 5 fix rounds 1 and 2): while a side's compile is unfinished it gets
    // one compile unit in every slice with room, besides rule 11's step on demand, so `compiled`
    // and the first `filled` do not wait for the worlds to reach the last change. These follow the
    // slice's first unit, so filling continues meanwhile. One that does not fit does not end the
    // slice (other units go on filling it): it is owed, and an owed compile is the first unit of
    // the next slice, but never of two slices in a row, so filling keeps every other slice.
    let firstUnit: Unit | null = null;
    if (!warmOnly) {
      while (owed.length > 0 && !unfinished(owed[0])) owed.shift();
      if (owed.length > 0 && !owedLast) firstUnit = { kind: 'compile', side: owed.shift()! };
      owedLast = firstUnit !== null;
    }
    const ahead: Side[] = warmOnly
      ? []
      : [plan, comp].filter((s): s is Side => unfinished(s) && s !== firstUnit?.side);
    for (let first = true; ; first = false) {
      let u: Unit | null;
      const isAhead = !first && ahead.length > 0;
      if (first && firstUnit !== null) u = firstUnit;
      else if (isAhead) {
        const s = ahead.shift()!;
        if (!unfinished(s)) continue;
        u = { kind: 'compile', side: s };
      } else if (warmOnly) u = warm.size > 0 ? { kind: 'warm', side: null } : null;
      else u = pick();
      if (u === null) break; // `pick` offers an unfinished compile itself when nothing else runs
      if (!first) {
        const est = estimate(u.kind);
        if (est === undefined || deps.now() - start + est > SLICE_PLAN_MS) {
          if (!isAhead) break;
          if (!owed.includes(u.side!)) owed.push(u.side!);
          continue;
        }
      }
      const t0 = deps.now();
      run(u);
      measure(u.kind, deps.now() - t0);
    }
    afterSlice();
  }

  function tick(): void {
    pending = false;
    if (disposed || failed) return;
    try {
      if (flushDue()) {
        // D12: warm before the flush, in slices of their own; then the flush, a task of its own
        if (warm.size > 0) slice(true);
        else flush();
      } else slice(false);
    } catch (e) {
      if (e instanceof Rejected) fail(e.reason, 'bad-request');
      else fail(e);
      return;
    }
    schedule();
  }

  function kick(ms = 0): void {
    if (pending || disposed || failed) return;
    pending = true;
    deps.later(tick, ms);
  }

  /** The next task: a slice when there is work, else a flush when one will be due. */
  function schedule(): void {
    if (pick() !== null || flushDue()) return kick();
    if (streamWants()) kick(Math.max(0, lastFlushAt + FLUSH_EVERY_MS - deps.now()));
  }

  return {
    open(r, policy, lots, w, m) {
      rev = r;
      worlds = w;
      months = m;
      const ctx = ds.ctx(months);
      stream = createMapStream(
        {
          massing: ds.massing,
          cellReady: (cellId) => ds.chunks.byCell.has(cellId),
          warnOnce: (k, msg) => deps.logOnce(`stream:${k}`, msg),
          now: deps.now
        },
        months
      );
      const sideOf = (isPlan: boolean, base: 'plan' | 'preFzp', c: TimelineCompile): Side => ({
        isPlan,
        base,
        compile: c,
        timeline: null,
        ensemble: null,
        statics: null,
        done: false,
        justDone: false,
        stalled: false
      });
      try {
        const c = comparisonOf(policy);
        plan = sideOf(true, 'plan', compileTimeline(policy, lots, ctx, 'plan'));
        comp = sideOf(false, c.base, compileTimeline(c.doc, lots, ctx, c.base));
      } catch (e) {
        // D11: a document the compiler rejects is `bad-request`; any other throw `timeline`
        return fail(e, e instanceof LeverFormatError ? 'bad-request' : 'timeline');
      }
      kick();
    },
    setPolicy() {
      throw new Error('setPolicy: policy edits are not built yet (ensemble-runner Task 6)');
    },
    viewMonth(month) {
      view = Number.isFinite(month) ? Math.trunc(month) : 1;
      postLookups();
    },
    resyncMap() {
      // rule 20: the snapshot, not `rewind`
      const w = world1();
      if (stream === null || w === undefined) return;
      dirty = false;
      sendCells(stream.snapshot(w, ds.statics));
      lastFlushAt = deps.now();
      kick();
    },
    chunkArrived() {
      for (const s of [plan, comp]) if (s) s.stalled = false;
      dirty = true;
      if (plan !== null) kick();
    },
    wantCells(cells) {
      if (stream === null) return;
      const extra = stream.cellsFor(cells);
      if (extra.size > 0) ds.chunks.wantAlso(extra);
    },
    viewFrame() {
      const t = plan?.timeline;
      return t ? t.frameAt(viewMonthOf(t)) : null;
    },
    card(day) {
      const t = plan?.timeline;
      const w = world1();
      if (!t || w === undefined) return null;
      // rule 18: a day past the last month stepped reads the last day stepped
      const d = Math.min(day, monthLastDay(asOf, w.month));
      const m = Math.min(Math.max(1, monthOfDay(asOf, d)), Math.max(1, w.month), t.readyThrough());
      return { world: w, frame: t.frameAt(m), day: d };
    },
    ensembles() {
      return { plan: plan?.ensemble ?? null, comp: comp?.ensemble ?? null };
    },
    dispose() {
      disposed = true;
    }
  };
}
