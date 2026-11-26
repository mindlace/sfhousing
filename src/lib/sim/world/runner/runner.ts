// The timeline runner (ensemble-runner spec rules 3 to 11, 18 to 21; plan D2, D3, D5 to D7, D9 to
// D12): two compiles, two ensembles (the plan and its comparison), the map stream of the plan's
// world, and the posts, in slices of a macrotask each.
//
// A slice runs units in this order: first, the height
// limits of the zoning in force at the last `viewMonth` (S14): a city build's inputs
// (`cityInputAt`), its steps (posting `heights`), then a wanted `heightLids` view's lid build on
// that city; these also run while an edit compiles (for the timeline in use) and after a throw
// stopped filling; a throw in one is rule 21's like any unit's. Then, for the ensemble with the lower
// month (the plan on a tie, rules 6 and 16), a compile step when its next frame is not ready
// (rule 11), else its next unit; a world steps only while it is not ahead of the other ensemble.
// When neither has a unit, an unfinished compile steps on, so its `ScoreStatics` arrive (D2). A
// unit of a kind runs only when the time used plus the largest of that kind's last 4 costs fits in
// `SLICE_PLAN_MS`; the first unit of a slice always runs (D7). After the units: one `compiling` if
// the progress changed; statics for a compile that finished (and `compiled` for the plan's); at
// most one `filled` (rule 8); `lookups` when the frame in view changed its permitting (D10); a
// city build when the zoning view or the limit attribution in view is not the one whose `heights`
// went out last.
//
// A flush of the map stream is a macrotask of its own (D6), at most every `FLUSH_EVERY_MS`, never
// while a restore re-steps quietly; when filling ends the stream is drained until an update says
// `complete` (D5). Warm units mass the plan world's started and revised projects on the shared
// generator memo just before a flush (D12), in slices of their own. A throw in a unit posts
// `error` `'timeline'` and stops filling; the lookups (`viewFrame`, `card`) keep answering
// (rule 21).
//
// Edits (rules 12 to 17; D2, D4). `setPolicy` replaces any edit not yet accepted (nothing more is
// posted for its `rev` unless the new one is rejected) and starts the new plan compile and, unless
// `comparisonOf` gives the same document and base (D4), the comparison's. While an edit is pending
// nothing steps: slices run only its compiles, posting `compiling` at its `rev`. A
// `LeverFormatError` from them posts `bad-request` at that `rev` and drops the edit; the newest
// edit it superseded (never rejected, so accepted as far as the page knows) is taken up again,
// its compile started over (S14); with none, filling resumes under the timelines in use. A
// document rejected at once in `setPolicy` leaves a pending edit pending. The
// edit is accepted once each new timeline is ready through its ensemble's `steppedThrough` (or
// complete): then, at once, for each recompiled side, the gate closes (`setStatics(null)`, D2),
// and `m = firstDifference(old, new)` keeps the ensemble (null or past `steppedThrough`) or
// restores it from its copy. The `rev` becomes the edit's, so every later post carries it (rule
// 17). The ensemble with the lower month steps first and the other waits (rules 6, 16). When the
// plan's quiet re-step ends, its slice stops; the next task (a map task, like a flush, D6) rewinds
// the plan's map stream and answers a `resyncMap` that came during the re-step. Every accepted
// edit is answered by one `refill` at its rev (S14), once the `compiled` at that rev is out, the
// comparison's compile has finished, no ensemble re-steps quietly and no rewind waits: from the first calendar month not final at
// min(m) - 1 when a side restored (the posted mark drops to just before it), else from the first
// calendar month not posted yet (it withdraws nothing). No `filled` goes out between the
// acceptance and that `refill`. An edit accepted and superseded before its `refill` gets none of
// its own: the next accepted edit's (a higher rev) answers both; so does an edit superseded before
// acceptance. So after a rejected edit the timelines are the last accepted `setPolicy`'s, and it
// gets its `refill` at its own rev. Acceptance keeps the document in use before it and those it
// superseded (`kept`, documents only) until both compiles in use finish: a compile that rejects
// its document at a later month posts `bad-request` at the rev in use and takes the newest kept
// document up again as an edit at its own rev. A throw (rule 21) after an acceptance and before the `refill`
// stops filling: that edit gets no `refill`; the next accepted edit's or an open settles the page.
// Map flushes go on while an edit compiles (the plan's world waits).
// `setPolicy` rejects at once a document whose queries (`queriesOf4`, its own or its
// comparison's) are not all in `lots`.
//
// After a throw (rule 21) the next accepted edit recompiles both sides and re-creates every
// world: a world whose step threw is not trusted.
// Worker-bundle module: zod-free, DOM-free, $app-free.
import type { ParcelId } from '$lib/data/parcel';
import {
  createCityBuild,
  type CityModel,
  type CityResult,
  type StagedBuild
} from '$lib/map/height/city';
import { createLidBuild, LidTooLarge, type LidBuild } from '$lib/map/height/lids';
import { cityTransferables } from '$lib/map/city-delta';
import { packTimedTransferables } from '$lib/map/pack-timed';
import { LeverFormatError } from '$lib/sim/levers/types';
import type { Rev } from '$lib/sim/protocol';
import { massingFor } from '$lib/sim/scenario/massing';
import { SLICE_PLAN_MS } from '$lib/sim/world/runner/budget';
import type { HeightLidsResult } from '$lib/sim/timeline-protocol';
import type { TimelineErrorCode, TimelineHostResponse } from '$lib/sim/timeline-protocol';
import type { Day } from '$lib/timelapse/time';
import { canonicalJson } from '$lib/sim-page/policy';
import { queriesOf4, type SimPolicy4 } from '$lib/timeline/policy4';
import { createMapStream, type MapStream } from '../map-stream';
import { monthLastDay, monthOfDay } from '../months';
import { comparisonOf, firstDifference } from '../policy/compare';
import { compileTimeline, type CompileCtx, type TimelineCompile } from '../policy/compile';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { cityInputAt, type FrameCityInput } from '../policy/limits';
import { lookupsAt } from '../policy/lookups';
import { scheduleAt } from '../read';
import * as scoreModule from '../score';
import type { MoneyFeed, ScoreStatics } from '../score';
import { finalTable } from '../score/statics';
import type { World, WorldEvent } from '../types';
import type { Dataset } from './dataset';
import { COPY_MONTHS, createEnsemble, type Ensemble, type UnitKind } from './ensemble';
import { slotFlags } from './flags';
import { cityTransfer, lidLotsOf, lidsTransfer, scheduleReady } from './lookups';
import { createWarmQueue } from './warm';

// Bound once, as world-core's hot modules do (docs/dev/world-core.md, Cost).
const { chunkOf, scoreStaticsOf } = scoreModule;

/** Budget of one compile step (rule 11). */
export const COMPILE_STEP_MS = 20;
/** Flushes of the map stream are at least this far apart (rule 9). */
export const FLUSH_EVERY_MS = 250;
/** Budget of one flush (rule 9). */
export const FLUSH_BUDGET_MS = 20;
/** A kind's cost estimate is the largest of its last this many costs (D7). */
const COST_WINDOW = 4;

export interface RunnerDeps {
  dataset: Dataset;
  /** The runner's own messages, `heights` and `heightLids` answers. */
  post(msg: TimelineHostResponse, transfer: ArrayBuffer[]): void;
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
    months: number,
    /** The document is an accepted `setPolicy`'s (taken before the load): a `refill` is owed. */
    edited?: boolean
  ): void;
  /**
   * Rules 12 to 17: compile the edit; keep or restore each ensemble once it is accepted. S14: one
   * `refill` at the edit's rev answers it, after that rev's `compiled` and before its `filled`.
   */
  setPolicy(rev: Rev, policy: SimPolicy4, lots: Record<string, ParcelId[]>): void;
  /** The `rev` of the timelines in use: the open's, or the last accepted edit's. */
  readonly rev: Rev;
  viewMonth(month: number): void;
  resyncMap(): void;
  /** A chunk loaded or the loader's report changed: a stalled compile or a waiting cell may move. */
  chunkArrived(): void;
  /**
   * S14: the height lids of `bbox` for the zoning in force at the last `viewMonth`. Answers the
   * one it replaces `superseded`; the answer comes from a staged build in later slices.
   */
  heightLids(reqId: number, bbox: readonly number[]): void;
  /** The waiting `heightLids` request, taken (the session ends: the host answers it). */
  takeLids(): number | null;
  /** A viewport's cells: the loader also wants the cells of the projects anchored in them (S17). */
  wantCells(cells: Iterable<string>): void;
  /** Plan frame at the last viewMonth (clamped to 1..readyThrough), or null before month 1's frame. */
  viewFrame(): PolicyFrame | null;
  /** The plan's world as it stands and the frame of the month holding `day` (clamped, rule 18). */
  card(day: Day): { world: World; frame: PolicyFrame; day: Day } | null;
  /** The plan and comparison ensembles (null before their month 1 frame); for Task 6 and tests. */
  ensembles(): { plan: Ensemble | null; comp: Ensemble | null };
  /** Test-only: what the runner holds between tasks, to check nothing superseded stays (B6). */
  internals(): RunnerInternals;
  dispose(): void;
}

export interface RunnerInternals {
  /** Each side's timeline, plan first (null before its month 1 frame). */
  timelines: (PolicyTimeline | null)[];
  /** Each side's compile, plan first. */
  compiles: (TimelineCompile | null)[];
  /** The compiles of an edit not yet accepted, or null. */
  pending: TimelineCompile[] | null;
  /** The model month a `refill` is due from, or null. */
  refillAt: number | null;
  /** An accepted edit's `refill` is not posted yet. */
  refillDue: boolean;
  /** Superseded edits that a rejection would take up again. */
  superseded: number;
  /** Documents a late rejection of the compiles in use would take up again. */
  kept: number;
  /** Owed compile units. */
  owed: number;
  /** The permitting last posted in `lookups` (D10), or null. */
  lookedAt: object | null;
}

/** `cityInput`: a city build's inputs (`cityInputAt`); `heights`: a city or lid build's step. */
type Kind = UnitKind | 'compile' | 'warm' | 'cityInput' | 'heights';

/**
 * Which frame a city is for: the timeline in use and the frame id at the last `viewMonth`. The
 * limit attribution (`cityInputAt`) is per zoning state per compile, so either changing may change
 * it; the input unit then compares the attribution itself.
 */
interface FrameKey {
  timeline: PolicyTimeline;
  id: number;
}

/** A city build for the frame `key` (S14), until done; `build` null until its inputs exist. */
interface CityWork {
  key: FrameKey;
  view: object;
  rev: Rev;
  input: FrameCityInput | null;
  build: StagedBuild<CityResult> | null;
}

/** The latest complete city: the frame and view it was built for, its inputs and its model. */
interface Limits {
  key: FrameKey;
  view: object;
  rev: Rev;
  input: FrameCityInput;
  model: CityModel;
}

/** A compile being stepped, and its timeline once month 1's frame exists. */
interface Compiling {
  base: 'plan' | 'preFzp';
  compile: TimelineCompile;
  /** The compile's timeline, once month 1's frame exists. */
  timeline: PolicyTimeline | null;
  /** Every frame of the window exists. */
  done: boolean;
  /** The last step made no progress: it waits on chunks until `chunkArrived`. */
  stalled: boolean;
}

/** One ensemble with its compile and its statics. */
interface Side extends Compiling {
  readonly isPlan: boolean;
  /** `canonicalJson` of what the side compiles (D4 compares the comparison's). */
  key: string;
  ensemble: Ensemble | null;
  statics: ScoreStatics | null;
  /** Finished in this slice: statics and `compiled` are due after it. */
  justDone: boolean;
}

/** An edit not yet accepted (rule 12). */
interface Edit {
  rev: Rev;
  plan: Compiling;
  /** Null: the comparison does not change (D4). */
  comp: Compiling | null;
  compKey: string;
  /** Its document, to take it up again should the edit that superseded it be rejected (S14). */
  doc: EditDoc;
}

/** A `setPolicy`'s document. */
interface EditDoc {
  rev: Rev;
  policy: SimPolicy4;
  lots: Record<string, ParcelId[]>;
}

/** What `comparisonOf` gives, as D4 compares it. */
const keyOf = (c: { doc: SimPolicy4; base: 'plan' | 'preFzp' }) =>
  canonicalJson({ doc: c.doc, base: c.base });

/** Throws `LeverFormatError` for the first query of `doc` (`queriesOf4`) with no entry in `lots`. */
function missingQuery(doc: SimPolicy4, lots: Record<string, ParcelId[]>): void {
  for (const { key } of queriesOf4(doc))
    if (!Object.hasOwn(lots, key)) throw new LeverFormatError('lots', `no lots for query ${key}`);
}

interface Unit {
  kind: Kind;
  side: Side | null;
}

/** A throw in a city or lid build: rule 21 at the current `rev`; a pending edit stays pending. */
class HeightsFailed extends Error {
  constructor(readonly reason: unknown) {
    super(String(reason));
  }
}

/** A compile step's `LeverFormatError`: the document is rejected, `bad-request` (rule 12, D11). */
class Rejected extends Error {
  constructor(
    readonly reason: LeverFormatError,
    /** The side whose compile rejected it. */
    readonly side: object
  ) {
    super(reason.message);
  }
}

export function createRunner(deps: RunnerDeps): Runner {
  const ds = deps.dataset;
  const asOf = ds.loaded.fzp.asOf;

  let rev: Rev = 0;
  let months = 0;
  let ctx: CompileCtx | null = null;
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
  /** A unit threw: the next accepted edit re-creates every world (rule 21). */
  let broken = false;
  let disposed = false;
  let pending = false;

  /** An edit not yet accepted (rule 12). */
  let edit: Edit | null = null;
  /**
   * The documents of the edits superseded before acceptance since the last accepted one, oldest
   * first, none rejected: when the edit pending is rejected, the newest is taken up again (S14).
   */
  const superseded: EditDoc[] = [];
  /**
   * The documents the timelines in use could fall back to, oldest first, none rejected: the one in
   * use before each accepted edit and the edits it superseded. Kept until both compiles in use have
   * finished, since either can still reject its document at a later month (S14).
   */
  const kept: EditDoc[] = [];
  /** The document of the timelines in use (null after a late rejection, until the next accepts). */
  let inUse: EditDoc | null = null;
  /** An accepted edit's `refill` is not posted yet (S14: one answers every accepted edit). */
  let refillDue = false;
  /** The lowest first difference of the restores whose `refill` is not posted yet (rule 14). */
  let refillAt: number | null = null;
  /** The rev of the last `compiled` posted: a `refill` waits for its rev's (S14). */
  let compiledRev: Rev | null = null;
  /** The plan restored: rewind the map stream once its quiet re-step is over (rule 14). */
  let rewindDue = false;
  /** A `resyncMap` that came while the plan re-stepped quietly (answered after it). */
  let resyncDue = false;

  /** The last `viewMonth` received (month 1 before any). */
  let view = 1;
  /** The permitting of the frame whose lookups were posted last (D10). */
  let lookedAt: Pick<PolicyFrame, 'calibration' | 'newCalibration' | 'speed' | 'speedNew'> | null =
    null;

  // the map stream
  let lastFlushAt = -Infinity;
  /** The plan's world sent an event or a chunk arrived since the last flush. */
  let dirty = false;
  /** The last update said `complete`. */
  let complete = false;
  /** The plan world's rows started or revised, massed a revision per unit before a flush (D12). */
  const warm = createWarmQueue(
    (row) => {
      const w = plan?.ensemble?.world;
      if (!w) return null;
      const s = scheduleAt(w, ds.statics, row, monthLastDay(asOf, w.month));
      return s !== null && scheduleReady(ds, s) ? s : null;
    },
    (s, k) => massingFor(s, k, ds.massing)
  );

  // the height limits (S14)
  /** The city build of the zoning in view, until done. */
  let city: CityWork | null = null;
  /** The latest complete city, whose `heights` went out last. */
  let limits: Limits | null = null;
  /** The `heightLids` waiting for its answer. */
  let lidWant: { reqId: number; bbox: [number, number, number, number] } | null = null;
  /** The running lid build of `lidWant`, on `limits`. */
  let lid: { reqId: number; limits: Limits; build: LidBuild; missing: number } | null = null;
  /** A city or lid build threw: no more heights until the next accepted edit. */
  let heightsBroken = false;
  /** When the running slice started (a staged build's budget is what is left of it). */
  let sliceStart = 0;

  const costs = new Map<Kind, number[]>();

  const post = (msg: TimelineHostResponse, transfer: ArrayBuffer[] = []) => {
    if (!disposed) deps.post(msg, transfer);
  };

  function fail(e: unknown, code: TimelineErrorCode = 'timeline', at: Rev = rev): void {
    failed = true;
    // M2: a rejected document leaves every world as it was
    if (code === 'timeline') broken = true;
    post({ type: 'error', rev: at, code, message: String(e) });
  }

  // --- choosing units ---

  /** -1 until the side's world exists. */
  const monthOf = (s: Side): number => (s.ensemble ? s.ensemble.month : -1);
  const otherOf = (s: Side): Side => (s === plan ? comp! : plan!);

  /** The frame this side's next step needs is not compiled yet (rule 11). */
  function needsFrame(s: Side): boolean {
    if (s.done || s.stalled) return false;
    if (s.timeline === null) return true;
    return s.timeline.readyThrough() < Math.min(months, Math.max(monthOf(s), 0) + 1);
  }

  function pick(): Unit | null {
    // a city, then a wanted lid view, before the timeline
    const hk = heightsKind();
    if (hk !== null) return { kind: hk, side: null };
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
   * every ready need it can, so one that returns at once with nothing done waits on chunks. The other view-job units (twin, resolve, apply, precompute) move
   * neither count and can each spend the whole budget on the live city: that is progress.
   */
  function stepCompile(c: Compiling): boolean {
    const before = c.timeline === null ? 0 : c.timeline.readyThrough();
    const doneBefore = c.compile.progress().done;
    const t0 = deps.now();
    const finished = c.compile.step(COMPILE_STEP_MS);
    const spent = deps.now() - t0 >= COMPILE_STEP_MS;
    if (finished) c.done = true;
    if (c.timeline === null) c.timeline = timelineOf(c.compile);
    const after = c.timeline === null ? 0 : c.timeline.readyThrough();
    if (!finished && !spent && after === before && c.compile.progress().done === doneBefore)
      c.stalled = true;
    return finished;
  }

  function compileUnit(s: Side): void {
    const had = s.timeline !== null;
    try {
      if (stepCompile(s)) s.justDone = true;
    } catch (e) {
      if (e instanceof LeverFormatError) throw new Rejected(e, s);
      throw e;
    }
    if (!had && s.timeline !== null) s.ensemble = ensembleOf(s, s.timeline);
  }

  // --- edits ---

  /** The edit's compiles that can step now and are not ready for their side yet. */
  function editWork(): Compiling | null {
    if (edit === null) return null;
    for (const [c, s] of [
      [edit.plan, plan!],
      [edit.comp, comp!]
    ] as const) {
      if (c !== null && !c.stalled && !readyFor(c, s)) return c;
    }
    return null;
  }

  /**
   * Rule 13: the new timeline is ready through the side's last month stepped, or complete. A side
   * with no world yet needs month 1's frame (an edit then replaces its compile).
   */
  function readyFor(c: Compiling, s: Side): boolean {
    if (c.done) return true;
    if (c.timeline === null) return false;
    const e = s.ensemble;
    if (e === null || broken) return true;
    return c.timeline.readyThrough() >= Math.min(months, e.steppedThrough);
  }

  /**
   * A pending edit of `d` (its compiles created, none stepped). Throws `LeverFormatError` for a
   * document rejected at once, anything else for a failure (M4).
   */
  function editOf(d: EditDoc): Edit {
    const c = comparisonOf(d.policy);
    const compKey = keyOf(c);
    // every query either document needs is in `lots` (S14): else rejected now, not at the
    // month that first needs it, after the old timelines are gone (the late path stays)
    missingQuery(d.policy, d.lots);
    missingQuery(c.doc, d.lots);
    const compiling = (base: 'plan' | 'preFzp', doc: SimPolicy4): Compiling => ({
      base,
      compile: compileTimeline(doc, d.lots, ctx!, base),
      timeline: null,
      done: false,
      stalled: false
    });
    return {
      rev: d.rev,
      plan: compiling('plan', d.policy),
      // D4; after a throw both sides are compiled again
      comp: broken || compKey !== comp!.key ? compiling(c.base, c.doc) : null,
      compKey,
      doc: d
    };
  }

  /** No edit pending, none to take up again (rule 21, a reopen). */
  function dropEdits(): void {
    edit = null;
    superseded.length = 0;
    kept.length = 0;
  }

  /**
   * A compile in use rejected its document at a month past the one stepped, after acceptance
   * (S14): `bad-request` at the rev in use, and the newest kept document is taken up as an edit at
   * its own rev, compiled afresh against the timelines in use. False when nothing is kept (the
   * open's document): rule 21 then stops filling.
   */
  function lateRejection(e: Rejected): boolean {
    if (kept.length === 0) return false;
    post({ type: 'error', rev, code: 'bad-request', message: String(e.reason) });
    // the side's compile is spent: the comparison is compiled again whatever its key (D4)
    if (e.side === comp) comp!.key = '';
    inUse = null;
    superseded.push(...kept);
    kept.length = 0;
    takeUpSuperseded();
    if (edit === null && !failed) failed = true;
    return true;
  }

  /**
   * The edit pending was rejected: the newest superseded edit, which the page counts as accepted
   * (it got no `bad-request`), is taken up again, so the timelines in use end as the last accepted
   * `setPolicy`'s (S14). Its compile starts over.
   */
  function takeUpSuperseded(): void {
    while (edit === null && superseded.length > 0) {
      const d = superseded.pop()!;
      try {
        edit = editOf(d);
      } catch (e) {
        const reject = e instanceof LeverFormatError;
        post({
          type: 'error',
          rev: d.rev,
          code: reject ? 'bad-request' : 'timeline',
          message: String(e)
        });
        if (!reject) {
          failed = broken = true;
          dropEdits();
        }
      }
    }
  }

  /** One step of the edit's compile `c`; a rejected document drops the edit (rule 12). */
  function editUnit(c: Compiling): void {
    const ed = edit!;
    try {
      stepCompile(c);
    } catch (e) {
      if (!(e instanceof LeverFormatError)) throw e;
      edit = null;
      post({ type: 'error', rev: ed.rev, code: 'bad-request', message: String(e) });
      takeUpSuperseded();
      return;
    }
    if (readyFor(ed.plan, plan!) && (ed.comp === null || readyFor(ed.comp, comp!))) accept();
  }

  /** The edit becomes the timelines in use (rules 13 to 17, D2, D4). */
  function accept(): void {
    const ed = edit!;
    edit = null;
    // S14: what this edit's compiles may still reject at a later month falls back to, newest last
    if (inUse !== null) kept.push(inUse);
    kept.push(...superseded);
    superseded.length = 0;
    inUse = ed.doc;
    rev = ed.rev;
    // S14: the `compiled` a `refill` waits for is this rev's, even when an earlier one had this rev
    compiledRev = null;
    failed = false;
    const fresh = broken;
    broken = false;
    heightsBroken = false;
    // S14: one `refill` answers this edit (and any accepted one it superseded before its own)
    refillDue = true;
    replace(plan!, ed.plan, fresh);
    if (ed.comp !== null) {
      comp!.key = ed.compKey;
      replace(comp!, ed.comp, fresh);
    }
    // D10: the new plan timeline's lookups go out once; nothing of the old one stays
    lookedAt = null;
    lastProgress = null;
    owed.length = 0;
    owedLast = false;
    settle();
  }

  /** Side `s` takes the compile `c`: its ensemble keeps its world or restores (rules 13, 14). */
  function replace(s: Side, c: Compiling, fresh: boolean): void {
    const e = s.ensemble;
    s.base = c.base;
    s.compile = c.compile;
    s.timeline = c.timeline;
    s.done = c.done;
    s.justDone = c.done;
    s.stalled = c.stalled;
    s.statics = null;
    if (e === null) {
      if (c.timeline !== null) s.ensemble = ensembleOf(s, c.timeline);
      return;
    }
    const t = c.timeline!;
    // D2: the gate closes; it reopens with the new statics when this compile finishes
    e.setStatics(null);
    // B2: against the ensemble's own last month stepped
    const m = fresh ? 1 : firstDifference(e.timeline, t);
    if (m === null || m > e.steppedThrough) {
      e.keep(t);
      return;
    }
    e.restore(t, m);
    refillAt = Math.min(refillAt ?? m, m);
    if (s.isPlan) {
      rewindDue = true;
      warm.clear(); // rows of the world being replaced
    }
  }

  /** The plan re-steps quietly (a restore re-creating the world is quiet until it exists). */
  const planQuiet = () => plan?.ensemble?.quiet ?? false;

  /**
   * The rewind of the plan's map stream (rule 14) or a waiting `resyncMap` answer (B7) can run:
   * the plan's quiet re-step is over. Each runs as a task of its own, like a flush (D6, I1).
   */
  const mapTaskDue = () =>
    (rewindDue || resyncDue) && (plan?.ensemble ?? null) !== null && !planQuiet();

  function mapTask(): void {
    if (rewindDue) {
      rewindDue = false;
      stream!.rewind(plan!.ensemble!.world!, ds.statics);
      dirty = true;
      complete = false;
    }
    if (resyncDue) {
      resyncDue = false;
      answerResync();
    }
    settle();
  }

  /**
   * After an acceptance, a unit, a map task or a `compiled`: once the `compiled` at the rev in use
   * is out, no ensemble re-steps quietly and the plan's stream is rewound, post the `refill` (rule
   * 14, S14). A restore's is from the first calendar month not final at min(m) - 1 (by the new
   * statics); a kept edit's withdraws nothing: from the first calendar month not posted yet.
   */
  function settle(): void {
    if (!refillDue || compiledRev !== rev) return;
    // and the comparison's compile has finished too, so neither can still reject this rev after it
    // (a `filled` waits for its statics anyway)
    if (comp === null || comp.statics === null) return;
    if (rewindDue || (comp?.ensemble?.quiet ?? false) || planQuiet()) return;
    const from =
      refillAt === null ? posted + 1 : final === null ? 0 : firstAfter(final, refillAt - 1);
    refillDue = false;
    refillAt = null;
    post({ type: 'refill', rev, from });
    posted = Math.min(posted, from - 1);
  }

  /** The first calendar month whose last day is after model month `m`: not final at `m`. */
  function firstAfter(table: Int32Array, m: number): number {
    for (let i = 0; i < table.length; i++) if (table[i] > m) return i;
    return table.length;
  }

  /** The edit's `compiling` (rule 12): its own compiles, and the comparison kept under D4. */
  function postEditProgress(ed: Edit): void {
    const p = ed.plan.compile.progress();
    const q = (ed.comp ?? comp!).compile.progress();
    postProgress(ed.rev, p, q);
  }

  function postProgress(
    r: Rev,
    p: ReturnType<TimelineCompile['progress']>,
    q: ReturnType<TimelineCompile['progress']>
  ): void {
    const failedCells = [...new Set([...p.failedCells, ...q.failedCells])].sort();
    const progress = { done: p.done + q.done, total: p.total + q.total, failedCells };
    const key = JSON.stringify({ r, ...progress });
    if (key === lastProgress) return;
    lastProgress = key;
    post({ type: 'compiling', rev: r, ...progress });
  }

  function ensembleOf(s: Side, t: PolicyTimeline): Ensemble {
    return createEnsemble({
      core: ds.core,
      // only the plan's cars reach the chunks (`chunkOf`)
      snapshotCars: s.isPlan,
      statics: ds.statics,
      timeline: t,
      months,
      copyMonths: COPY_MONTHS,
      map: s.isPlan ? { stream, onEvent } : undefined
    });
  }

  /** The plan world's events outside quiet steps (the stream has them already). */
  function onEvent(e: WorldEvent): void {
    dirty = true;
    if (e.kind === 'start' || e.kind === 'revise') warm.add(e.row);
  }

  /** Rows queued, or a row being warmed, remain (D12). */
  const warmPending = () => warm.pending();

  function run(u: Unit): void {
    if (u.kind === 'compile') compileUnit(u.side!);
    else if (u.kind === 'warm')
      warm.unit(); // one (row, revision): the estimator gates each
    else if (u.kind === 'cityInput' || u.kind === 'heights') heightsUnit();
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
      world: e.world!,
      statics: ds.statics
    };
  }

  function afterSlice(): void {
    postProgress(rev, plan!.compile.progress(), comp!.compile.progress());
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
      compiledRev = rev;
    }
    // S14: both compiles in use finished, so neither can reject its document any more
    if (kept.length > 0 && plan!.done && comp!.done) kept.length = 0;
    // S14: an edit's `refill` follows its `compiled`, and goes before any `filled` at its rev
    if (refillDue) settle();
    postFilled();
    postLookups();
    checkHeights();
  }

  /** At most one `filled`: the months final in both ensembles and not posted yet (rule 8). */
  function postFilled(): void {
    const a = plan!.ensemble;
    const b = comp!.ensemble;
    if (!a || !b || plan!.statics === null || comp!.statics === null) return;
    // an accepted edit's `refill` goes first (rule 14, S14)
    if (refillDue) return;
    const through = Math.min(a.finalThrough(), b.finalThrough());
    if (through <= posted) return;
    const series = chunkOf(a.series!, b.series!, moneyOf(through), posted + 1, through);
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

  const planWorld = (): World | undefined => plan?.ensemble?.world ?? undefined;

  /** Filling has ended: the plan's world stands at `months`. */
  const ended = () => (plan?.ensemble?.month ?? -1) >= months;

  /** A flush would have something to say, whenever it is due. */
  function streamWants(): boolean {
    // M1: an edit compiling leaves the world as it is; only a rewind not yet run blocks the stream
    if (rewindDue) return false;
    if (stream === null || planWorld() === undefined || plan!.ensemble!.quiet) return false;
    return dirty || (ended() && !complete);
  }

  const flushDue = () => streamWants() && deps.now() - lastFlushAt >= FLUSH_EVERY_MS;

  function sendCells(u: ReturnType<MapStream['snapshot']>): void {
    complete = u.complete === true;
    post({ type: 'cells', render: u }, [
      ...u.cells.flatMap(packTimedTransferables),
      ...(u.city ? cityTransferables(u.city) : [])
    ]);
    // S17: the chunks of projects anchored in the wanted cells, so their anchor cells can go
    const extra = stream!.cellsFor(ds.chunks.wanted);
    if (extra.size > 0) ds.chunks.wantAlso(extra);
  }

  function flush(): void {
    const t0 = deps.now();
    const u = stream!.flush(planWorld()!, ds.statics, FLUSH_BUDGET_MS);
    lastFlushAt = deps.now();
    // A flush that spent its budget may have left ready dirty cells: flush again when due.
    dirty = lastFlushAt - t0 >= FLUSH_BUDGET_MS;
    if (u !== null) sendCells(u);
  }

  // --- the height limits (S14) ---

  /** What is left of the slice plan (a staged build always runs at least one unit). */
  const sliceLeft = () => Math.max(0, SLICE_PLAN_MS - (deps.now() - sliceStart));
  const clock = () => deps.now();

  /** The next height unit: the city of the zoning in view, then a wanted lid view on its limits. */
  function heightsKind(): 'cityInput' | 'heights' | null {
    if (heightsBroken) return null;
    if (city !== null) return city.build === null ? 'cityInput' : 'heights';
    if (lidWant !== null && limits !== null) return 'heights';
    return null;
  }

  const sameKey = (a: FrameKey, t: PolicyTimeline, id: number) => a.timeline === t && a.id === id;

  /**
   * D2: an input unit when the frame at the last `viewMonth` (the timeline in use, its frame id)
   * is not the one whose `heights` went out last. Cheap: the unit decides whether the zoning view
   * or the limit attribution changed. Back on that frame, a city build of another stops.
   */
  function checkHeights(): void {
    const t = plan?.timeline;
    if (heightsBroken || !t) return;
    const f = t.frameAt(viewMonthOf(t));
    if (city !== null && sameKey(city.key, t, f.id)) return;
    if (limits !== null && sameKey(limits.key, t, f.id)) {
      city = null;
      return;
    }
    city = { key: { timeline: t, id: f.id }, view: f.view, rev, input: null, build: null };
  }

  function sameArray(x: ArrayLike<number>, y: ArrayLike<number>): boolean {
    if (x === y) return true;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  /** The same city inputs: rule ids, winning source, stories and countable mask per lot. */
  function sameInput(a: FrameCityInput, b: FrameCityInput): boolean {
    if (a === b) return true;
    const r = a.sources.ruleIds;
    const s = b.sources.ruleIds;
    if (r.length !== s.length || r.some((id, i) => id !== s[i])) return false;
    return (
      sameArray(a.sources.source, b.sources.source) &&
      sameArray(a.stories, b.stories) &&
      sameArray(a.countable, b.countable)
    );
  }

  /**
   * One height unit. A throw is rule 21's (`HeightsFailed`, posted by the task loop): the waiting
   * lid is answered `no-session` and no height unit runs until the next accepted edit.
   */
  function heightsUnit(): void {
    try {
      if (city !== null) cityStep(city);
      else lidStep();
    } catch (e) {
      heightsBroken = true;
      city = null;
      lid = null;
      const w = lidWant;
      lidWant = null;
      const message = `height lids are not available: ${String(e)}`;
      if (w) postLids(w.reqId, { ok: false, reason: 'no-session', message });
      throw new HeightsFailed(e);
    }
  }

  /**
   * The city build of the zoning in view: its inputs in a unit of
   * their own (`cityInputAt` on the plan frame in view, read now: never a frame held from an older
   * timeline), then its steps; once done, `heights` goes out and the city becomes `limits`. The
   * same view with the same attribution as `limits` needs no build and posts nothing (D2).
   */
  function cityStep(c: CityWork): void {
    if (c.build === null) {
      const t = plan!.timeline!;
      const f = t.frameAt(viewMonthOf(t));
      const key = { timeline: t, id: f.id };
      const input = cityInputAt(f);
      if (limits !== null && limits.view === f.view && sameInput(limits.input, input)) {
        limits = { ...limits, key, input };
        city = null;
        return;
      }
      const parcels = ds.loaded.fzp.parcels;
      c.key = key;
      c.view = f.view;
      c.rev = rev;
      c.input = input;
      c.build = createCityBuild({
        rev,
        labelPoint: parcels.labelPoint,
        lotAreaM2: parcels.lotAreaM2,
        existingStories: parcels.existingStories,
        stories: input.stories,
        countable: input.countable,
        sources: input.sources
      });
      return;
    }
    if (!c.build.step(sliceLeft(), clock)) return;
    const { city: built, model } = c.build.result();
    city = null;
    limits = { key: c.key, view: c.view, rev: c.rev, input: c.input!, model };
    // a lid build on older limits starts again on these
    lid = null;
    post({ type: 'heights', rev, city: built }, cityTransfer(built));
  }

  /**
   * One slice of the wanted lid view. With none running, the job
   * starts one on the current limits (gathers its lots, allocates its raster) and ends: its units
   * run from the next one.
   */
  function lidStep(): void {
    const want = lidWant!;
    const lim = limits!;
    if (lid === null) {
      const { lots, missing } = lidLotsOf(
        ds.manifest,
        ds.chunks.byCell,
        ds.loaded.fzp.parcels.index,
        want.bbox
      );
      let build: LidBuild;
      try {
        build = createLidBuild({
          limitsRev: lim.rev,
          sourceIds: lim.input.sources.ruleIds,
          bbox: want.bbox,
          lots,
          stories: lim.input.stories,
          sources: lim.input.sources.source,
          model: lim.model
        });
      } catch (e) {
        if (!(e instanceof LidTooLarge)) throw e;
        lidWant = null;
        return postLids(want.reqId, { ok: false, reason: 'too-large', message: e.message });
      }
      lid = { reqId: want.reqId, limits: lim, build, missing };
      return;
    }
    if (!lid.build.step(sliceLeft(), clock)) return;
    const lids = lid.build.result();
    const { reqId, missing } = lid;
    lid = null;
    lidWant = null;
    postLids(reqId, { ok: true, lids, missing }, lidsTransfer(lids));
  }

  function postLids(reqId: number, result: HeightLidsResult, transfer: ArrayBuffer[] = []): void {
    post({ type: 'heightLids', reqId, result }, transfer);
  }

  /** After a throw stopped filling (rule 21): a slice of height units only. */
  function heightsSlice(): void {
    sliceStart = deps.now();
    for (let first = true; ; first = false) {
      const k = heightsKind();
      if (k === null) break;
      if (!first) {
        const est = estimate(k);
        if (est === undefined || deps.now() - sliceStart + est > SLICE_PLAN_MS) break;
      }
      const t0 = deps.now();
      heightsUnit();
      measure(k, deps.now() - t0);
    }
  }

  // --- the task loop ---

  const unfinished = (s: Side | null): s is Side => s !== null && !s.done && !s.stalled;
  /** Ahead compiles that did not fit their slice: each is the first unit of a later slice. */
  const owed: Side[] = [];
  /** The last slice's first unit was an owed compile. */
  let owedLast = false;

  function slice(warmOnly: boolean): void {
    const start = deps.now();
    sliceStart = start;
    // Controller rulings (Task 5 fix rounds 1 and 2): while a side's compile is unfinished it gets
    // one compile unit in every slice with room, besides rule 11's step on demand, so `compiled`
    // and the first `filled` do not wait for the world to reach the last change. These follow the
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
      } else if (warmOnly) u = warmPending() ? { kind: 'warm', side: null } : null;
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
      if (refillDue) settle();
      // a quiet re-step that just ended: its rewind is the next task, before any loud step (I1)
      if (mapTaskDue()) break;
    }
    // a warm-only slice changes nothing posted; during an edit it must not post at the old rev
    if (!warmOnly || edit === null) afterSlice();
  }

  /**
   * A slice of an edit's compiles (rule 12): nothing steps; the edit may be accepted in it. Height
   * units for the timeline in use run first, ahead of a pending revision: a `heightLids` never waits on an edit's compile.
   */
  function editSlice(): void {
    const start = deps.now();
    sliceStart = start;
    const ed = edit!;
    for (let first = true; edit === ed; first = false) {
      const hk = heightsKind();
      const c = hk === null ? editWork() : null;
      if (hk === null && c === null) break;
      const kind: Kind = hk ?? 'compile';
      if (!first) {
        const est = estimate(kind);
        if (est === undefined || deps.now() - start + est > SLICE_PLAN_MS) break;
      }
      const t0 = deps.now();
      if (hk !== null) heightsUnit();
      else editUnit(c!);
      measure(kind, deps.now() - t0);
    }
    if (edit === ed) postEditProgress(ed);
    // accepted: the new rev's `compiling`, `compiled`, `lookups` (and a `filled` when kept)
    else if (plan!.compile === ed.plan.compile) afterSlice();
  }

  function tick(): void {
    pending = false;
    if (disposed) return;
    try {
      if (failed && edit === null) {
        // rule 21: filling stopped; the height limits still answer
        if (heightsKind() === null) return;
        heightsSlice();
        return schedule();
      }
      if (mapTaskDue()) mapTask();
      else if (flushDue()) {
        // D12: warm before the flush, in slices of their own; then the flush, a task of its own
        if (warmPending()) slice(true);
        else flush();
      } else if (edit !== null) editSlice();
      else slice(false);
    } catch (e) {
      // rule 21 for a city or lid build: at the rev in use; a pending edit goes on (and its
      // acceptance re-creates every world)
      if (e instanceof HeightsFailed) {
        fail(e.reason);
        return schedule();
      }
      // a compile in use rejecting its document late: the last accepted document is taken up (S14)
      if (e instanceof Rejected && lateRejection(e)) return schedule();
      // an edit's compile that throws other than `LeverFormatError`: at the edit's rev (D11)
      const ed = edit;
      dropEdits();
      if (e instanceof Rejected) {
        // the document in use is rejected: nothing to fall back to it
        inUse = null;
        fail(e.reason, 'bad-request');
      } else fail(e, 'timeline', ed?.rev ?? rev);
      return;
    }
    schedule();
  }

  function kick(ms = 0): void {
    if (pending || disposed || (failed && edit === null && heightsKind() === null)) return;
    pending = true;
    deps.later(tick, ms);
  }

  /** The next task: a slice when there is work, else a flush when one will be due. */
  function schedule(): void {
    if (mapTaskDue() || flushDue()) return kick();
    if (edit !== null) {
      // a stalled edit compile waits for `chunkArrived`; height units run meanwhile
      if (editWork() !== null || heightsKind() !== null) return kick();
    } else if (failed) {
      if (heightsKind() !== null) kick();
      return;
    } else if (pick() !== null) return kick();
    if (streamWants()) kick(Math.max(0, lastFlushAt + FLUSH_EVERY_MS - deps.now()));
  }

  const sideOf = (isPlan: boolean, base: 'plan' | 'preFzp', c: TimelineCompile, key: string) =>
    ({
      isPlan,
      base,
      key,
      compile: c,
      timeline: null,
      ensemble: null,
      statics: null,
      done: false,
      justDone: false,
      stalled: false
    }) satisfies Side as Side;

  /**
   * Both sides from nothing: the open, or an edit after an open whose document was rejected.
   * `edited`: the document is an accepted `setPolicy`'s, so its `refill` is owed (S14).
   */
  function start(policy: SimPolicy4, lots: Record<string, ParcelId[]>, edited: boolean): void {
    try {
      const c = comparisonOf(policy);
      plan = sideOf(true, 'plan', compileTimeline(policy, lots, ctx!, 'plan'), '');
      comp = sideOf(false, c.base, compileTimeline(c.doc, lots, ctx!, c.base), keyOf(c));
    } catch (e) {
      plan = comp = null;
      // D11: a document the compiler rejects is `bad-request`; any other throw `timeline`
      return fail(e, e instanceof LeverFormatError ? 'bad-request' : 'timeline');
    }
    failed = false;
    broken = false;
    refillDue = edited;
    compiledRev = null;
    inUse = { rev, policy, lots };
    kick();
  }

  /** The answer to `resyncMap` (rule 20): the snapshot of the plan's world, not `rewind`. */
  function answerResync(): void {
    const w = planWorld();
    if (stream === null || w === undefined) return;
    dirty = false;
    sendCells(stream.snapshot(w, ds.statics));
    lastFlushAt = deps.now();
  }

  return {
    get rev() {
      return rev;
    },
    open(r, policy, lots, m, edited = false) {
      rev = r;
      months = m;
      ctx = ds.ctx(months);
      const basePools = new Set(ds.loaded.fzp.finance?.pools.map((p) => p.id) ?? []);
      stream = createMapStream(
        {
          massing: ds.massing,
          cellReady: (cellId) => ds.chunks.byCell.has(cellId),
          warnOnce: (k, msg) => deps.logOnce(`stream:${k}`, msg),
          now: deps.now,
          // the plan side's timeline in use: `limitsAt` reads only its frames
          flagsOf: (w, st, row) =>
            plan?.timeline
              ? slotFlags(w, st, row, { frameAt: (m) => plan!.timeline!.frameAt(m), basePools })
              : 0
        },
        months
      );
      start(policy, lots, edited);
    },
    setPolicy(r, policy, lots) {
      if (disposed || ctx === null) return;
      if (plan === null || comp === null) {
        // the open's document was rejected: this one opens
        dropEdits();
        rev = r;
        return start(policy, lots, true);
      }
      let ed: Edit;
      try {
        // M4: inside the try, so a throw is answered at this rev
        ed = editOf({ rev: r, policy, lots });
      } catch (e) {
        // rule 12: the timelines in use go on filling; S14: a rejected document leaves the edit
        // pending as it is (the page's last accepted document)
        const reject = e instanceof LeverFormatError;
        post({
          type: 'error',
          rev: r,
          code: reject ? 'bad-request' : 'timeline',
          message: String(e)
        });
        if (!reject) {
          failed = broken = true;
          dropEdits();
        }
        return kick();
      }
      // rule 12: replaces an edit not yet accepted; nothing more is posted for its rev unless this
      // one is rejected, when it is taken up again (S14)
      if (edit !== null) superseded.push(edit.doc);
      edit = ed;
      kick();
    },
    viewMonth(month) {
      view = Number.isFinite(month) ? Math.trunc(month) : 1;
      postLookups();
      // D3: the city build runs in the slices, never here
      checkHeights();
      if (heightsKind() !== null) kick();
    },
    heightLids(reqId, bbox) {
      if (disposed) return;
      if (heightsBroken) {
        const message = 'height lids are not available: the height limits failed';
        return postLids(reqId, { ok: false, reason: 'no-session', message });
      }
      const prev = lidWant;
      if (prev) {
        const message = 'a newer heightLids replaced this one';
        postLids(prev.reqId, { ok: false, reason: 'superseded', message });
      }
      lidWant = { reqId, bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] };
      lid = null;
      kick();
    },
    takeLids() {
      const w = lidWant;
      lidWant = null;
      lid = null;
      return w === null ? null : w.reqId;
    },
    resyncMap() {
      // B7: during a quiet re-step (or before its rewind) the answer waits for the restored world
      const pe = plan?.ensemble;
      if (rewindDue || (pe && pe.quiet)) {
        resyncDue = true;
        return kick();
      }
      answerResync();
      kick();
    },
    chunkArrived() {
      for (const s of [plan, comp, edit?.plan, edit?.comp]) if (s) s.stalled = false;
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
      const w = planWorld();
      if (!t || w === undefined) return null;
      // rule 18: a day past the last month stepped reads the last day stepped
      const d = Math.min(day, monthLastDay(asOf, w.month));
      const m = Math.min(Math.max(1, monthOfDay(asOf, d)), Math.max(1, w.month), t.readyThrough());
      return { world: w, frame: t.frameAt(m), day: d };
    },
    ensembles() {
      return { plan: plan?.ensemble ?? null, comp: comp?.ensemble ?? null };
    },
    internals() {
      return {
        timelines: [plan?.timeline ?? null, comp?.timeline ?? null],
        compiles: [plan?.compile ?? null, comp?.compile ?? null],
        pending: edit && [edit.plan.compile, ...(edit.comp ? [edit.comp.compile] : [])],
        refillAt,
        refillDue,
        superseded: superseded.length,
        kept: kept.length,
        owed: owed.length,
        lookedAt
      };
    },
    dispose() {
      disposed = true;
    }
  };
}
