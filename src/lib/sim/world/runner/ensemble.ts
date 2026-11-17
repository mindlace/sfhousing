// One side's world on seed 1, advanced one unit at a time (ensemble-runner spec rules 6, 7, 14,
// 15, S16; plan D2, D8). The runner drives two of these, the plan and the comparison.
//
// The world sends its events and `stepped` marks to a feed log. While the series gate is open
// (`setStatics`), `feed` units drain the log into the world's `WorldSeries` (a buffered feed
// gives the same series, docs/dev/world-score.md "Feeding a series").
import type { LedgerEvent } from '$lib/sim/scenario/money';
import * as fundingModule from '../funding';
import type { MapStream } from '../map-stream';
import type { PolicyTimeline } from '../policy/frame';
import * as scoreModule from '../score';
import type { ScoreStatics, WorldSeries, WorldSeriesData } from '../score';
import type { Statics } from '../statics';
import type { Due, StepSink, World, WorldEvent } from '../types';
import * as worldModule from '../world';

// Imports are bound once, here, as world-core's hot modules do (docs/dev/world-core.md, Cost).
const { createFundingSystem } = fundingModule;
const { createWorldSeries } = scoreModule;
const { createWorld, step, planDue } = worldModule.withFunding(createFundingSystem());

/** The model months after which the world is copied (S16). The one place the schedule lives. */
export const COPY_MONTHS: readonly number[] = [0];

/** The seed of both sides' world. */
export const SEED = 1;

/** One entry of the world's feed log: an event, or the model month just stepped. */
export type FeedEntry = { e: WorldEvent } | { stepped: number };

export interface EnsembleOpts {
  statics: Statics;
  timeline: PolicyTimeline;
  /** Filling stops at this model month; the due list is planned through it. */
  months: number;
  /** Copies are taken after each of these model months (the runner passes `COPY_MONTHS`). */
  copyMonths: readonly number[];
  /** The plan's world keeps a ledger and feeds this stream and `onEvent`, outside quiet steps. */
  map?: { stream: MapStream | null; onEvent?(e: WorldEvent): void };
}

export type UnitKind = 'create' | 'restore' | 'copy' | 'feed' | 'quiet' | 'step';

export interface Ensemble {
  /** The world has stepped this month; -1 until it exists. */
  readonly month: number;
  readonly timeline: PolicyTimeline;
  /** Null until created. */
  readonly world: World | null;
  /** The world's ledger (one array for the ensemble's life), or null without `map`. */
  readonly ledger: LedgerEvent[] | null;
  /** Null while the gate is closed, the world is not created or it awaits restore. */
  readonly series: WorldSeries | null;
  /** Next unit kind, or null when the ensemble waits (at `months`, or the next frame not ready). */
  next(): UnitKind | null;
  /** Runs one unit of the kind `next()` gives; throws when `next()` is null. */
  unit(): void;
  /** Opens the series gate with `s` (re-creating the series from its data), or closes it (null). */
  setStatics(s: ScoreStatics | null): void;
  /**
   * The series' `finalThrough()`; -1 while the gate is closed, the world is not created or the
   * series awaits restore. A log not fed yet only holds it back (series only grow).
   */
  finalThrough(): number;
  /**
   * The last model month whose frame this ensemble has used or will re-step quietly: the "last
   * month stepped" of rule 13. It counts the months left to step quietly, and the month after the
   * one a fresh due list was planned at (`planDue` reads that frame; `createWorld` reads month
   * 1's). An edit whose first difference is after it is applied with `keep`; any other with
   * `restore`.
   */
  readonly steppedThrough: number;
  /** Rule 13: carry on under `t`. Only for a first difference after `steppedThrough`. */
  keep(t: PolicyTimeline): void;
  /**
   * Rule 14, for a first difference m at or before `steppedThrough`: restore from the last copy at
   * or before m - 1 and drop later copies; cut the ledger. Then `next()` gives `restore` (the
   * world cloned and its due list rebuilt with `planDue`), then `quiet` until month m - 1. When
   * the world still stands at or before m - 1 inside a quiet re-step whose due list reads no frame
   * from m on, only the timeline and the quiet end change. With m = 1, or no copy at or before
   * m - 1, the world is created again, quietly.
   */
  restore(t: PolicyTimeline, m: number): void;
  /** Restore or quiet units remain. */
  readonly quiet: boolean;
  /** Model months whose copy is taken, ascending. */
  copiedMonths(): number[];
}

interface Feed {
  data: WorldSeriesData | null;
  log: FeedEntry[];
}

interface Copy {
  month: number;
  world: World;
  feed: Feed;
  ledgerLength: number;
}

export function createEnsemble(o: EnsembleOpts): Ensemble {
  const { statics, months } = o;
  const copyMonths = new Set(o.copyMonths);
  const map = o.map ?? null;
  const ledger: LedgerEvent[] | null = map ? [] : null;

  let timeline = o.timeline;
  let scoreStatics: ScoreStatics | null = null;
  /** The month the world has stepped; -1 until it exists. */
  let month = -1;
  /** Quiet steps run through this month. */
  let quietThrough = -1;
  /** The month the due list was last planned at with `planDue` (0 at creation). */
  let plannedAt = 0;
  /** The copy the next `restore` unit restores the world from. */
  let restoring: Copy | null = null;
  /** Inside a quiet step: nothing goes to the stream or `onEvent`. */
  let quietNow = false;

  let world: World | null = null;
  let due: Due | null = null;
  let series: WorldSeries | null = null;
  /** The world's series data while the gate is closed or its series awaits restore. */
  let data: WorldSeriesData | null = null;
  let log: FeedEntry[] = [];
  /** The first entry of the log not fed yet. */
  let head = 0;
  const copies = new Map<number, Copy>();

  /** The world's sink; with `map` it also feeds the ledger, the stream and `onEvent`. */
  const sink: StepSink = !map
    ? { event: (e) => log.push({ e }) }
    : {
        event(e) {
          log.push({ e });
          if (!quietNow) {
            map.stream?.onEvent(e, world!, statics);
            map.onEvent?.(e);
          }
        },
        ledger: (e) => ledger!.push(e)
      };

  const seriesOf = (s: ScoreStatics, d: WorldSeriesData | null) =>
    d === null ? createWorldSeries(s) : createWorldSeries(s, d);

  function reset(): void {
    month = -1;
    quietThrough = -1;
    plannedAt = 0;
    restoring = null;
    copies.clear();
    world = null;
    due = null;
    if (ledger) ledger.length = 0;
    series = null;
    data = null;
    log = [];
    head = 0;
  }

  /** A copy of `month` is due and not taken: the world stands at a listed month. */
  const copyDue = (): boolean => month >= 0 && copyMonths.has(month) && !copies.has(month);

  const feedable = (): boolean => scoreStatics !== null && series !== null && head < log.length;

  function next(): UnitKind | null {
    if (world === null) return timeline.readyThrough() >= 1 ? 'create' : null;
    if (restoring) return 'restore';
    if (copyDue()) return 'copy';
    if (feedable()) return 'feed';
    if (month >= months || timeline.readyThrough() < month + 1) return null;
    return month + 1 <= quietThrough ? 'quiet' : 'step';
  }

  function steppedThrough(): number {
    return Math.max(month, quietThrough, plannedAt + 1);
  }

  function createUnit(): void {
    const buf: WorldEvent[] = [];
    const w = createWorld(statics, timeline, SEED, {
      event: (e) => buf.push(e),
      ledger: sink.ledger
    });
    world = w;
    // `createWorld`'s events, replayed once it returns (map-stream.md, "Host calls"); quiet when
    // the world is created again by a restore.
    quietNow = month < quietThrough;
    try {
      for (const e of buf) sink.event(e);
    } finally {
      quietNow = false;
    }
    due = planDue(w, statics, timeline, SEED, months);
    if (scoreStatics !== null && series === null) series = seriesOf(scoreStatics, data);
    month = 0;
  }

  function restoreUnit(): void {
    const c = restoring!;
    const w = structuredClone(c.world);
    world = w;
    due = planDue(w, statics, timeline, SEED, months);
    data = c.feed.data;
    log = c.feed.log.slice();
    head = 0;
    series = scoreStatics === null ? null : seriesOf(scoreStatics, data);
    restoring = null;
  }

  function copyUnit(): void {
    copies.set(month, {
      month,
      world: structuredClone(world!),
      feed: { data: series ? series.data() : data, log: log.slice(head) },
      ledgerLength: ledger ? ledger.length : 0
    });
  }

  /** Feeds the log up to and including its first `stepped` mark: one world-month (rule 5). */
  function feedUnit(): void {
    const s = series!;
    const w = world!;
    let i = head;
    while (i < log.length) {
      const f = log[i++];
      if ('e' in f) s.add(f.e, w, statics);
      else {
        s.stepped(f.stepped);
        break;
      }
    }
    if (i === log.length) {
      log = [];
      head = 0;
    } else head = i;
  }

  function stepUnit(quiet: boolean): void {
    const w = world!;
    quietNow = quiet;
    try {
      step(w, due!, statics, timeline, SEED, sink);
    } finally {
      quietNow = false;
    }
    log.push({ stepped: w.month });
    month++;
  }

  return {
    get month() {
      return month;
    },
    get timeline() {
      return timeline;
    },
    get world() {
      return world;
    },
    get ledger() {
      return ledger;
    },
    get series() {
      return series;
    },
    get steppedThrough() {
      return steppedThrough();
    },
    get quiet() {
      return restoring !== null || month < quietThrough;
    },
    next,
    unit() {
      const kind = next();
      if (kind === null) throw new Error(`ensemble: no unit to run at month ${month}`);
      if (kind === 'create') createUnit();
      else if (kind === 'restore') restoreUnit();
      else if (kind === 'copy') copyUnit();
      else if (kind === 'feed') feedUnit();
      else stepUnit(kind === 'quiet');
    },
    setStatics(s) {
      if (series) data = series.data();
      // A world not yet created, or awaiting restore, gets its series when it is.
      series = s !== null && world !== null && restoring === null ? seriesOf(s, data) : null;
      scoreStatics = s;
    },
    finalThrough() {
      if (scoreStatics === null || series === null) return -1;
      return series.finalThrough();
    },
    keep(t) {
      timeline = t;
    },
    restore(t, m) {
      if (!Number.isInteger(m) || m < 1) throw new RangeError(`ensemble: restore to month ${m}`);
      const through = steppedThrough();
      if (m > through) {
        throw new RangeError(`ensemble: restore to month ${m} past month ${through}; keep instead`);
      }
      timeline = t;
      if (month <= m - 1 && m - 1 <= quietThrough && plannedAt < m - 1) {
        // Inside a quiet re-step that has not reached m: the world and due list read frames
        // before m only, which `t` shares. Steps from m on are loud again.
        quietThrough = m - 1;
        for (const c of [...copies.keys()]) if (c > m - 1) copies.delete(c);
        return;
      }
      let from: Copy | null = null;
      for (const c of copies.values()) {
        if (c.month <= m - 1 && (from === null || c.month > from.month)) from = c;
      }
      // `createWorld` reads month 1's frame: a change there re-creates the world.
      if (from === null || m === 1) {
        reset();
        quietThrough = m - 1;
        return;
      }
      for (const c of [...copies.keys()]) if (c > from.month) copies.delete(c);
      if (ledger) ledger.length = from.ledgerLength;
      restoring = from;
      month = from.month;
      quietThrough = m - 1;
      plannedAt = from.month;
      series = null;
    },
    copiedMonths() {
      return [...copies.keys()].sort((a, b) => a - b);
    }
  };
}
