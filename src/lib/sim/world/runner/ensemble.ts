// One ensemble of worlds, advanced one unit at a time (ensemble-runner spec rules 6, 7, 14, 15,
// S16; plan D2, D8). The runner drives two of these, the plan and the comparison.
//
// Each world sends its events and `stepped` marks to a feed log. While the series gate is open
// (`setStatics`), `feed` units drain the logs into each world's `WorldSeries` (a buffered feed
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

/** The model months after which every world is copied (S16). The one place the schedule lives. */
export const COPY_MONTHS: readonly number[] = [0];

/** One entry of a world's feed log: an event, or the model month just stepped. */
export type FeedEntry = { e: WorldEvent } | { stepped: number };

export interface EnsembleOpts {
  statics: Statics;
  timeline: PolicyTimeline;
  worlds: number;
  /** Filling stops at this model month; every due list is planned through it. */
  months: number;
  /** Copies are taken after each of these model months (the runner passes `COPY_MONTHS`). */
  copyMonths: readonly number[];
  /** World 1 keeps a ledger and feeds this stream and `onEvent`, outside quiet steps. */
  world1?: { stream: MapStream | null; onEvent?(e: WorldEvent): void };
}

export type UnitKind = 'create' | 'restore' | 'copy' | 'feed' | 'quiet' | 'step';

export interface Ensemble {
  /** Every world has stepped this month; -1 until every world exists. */
  readonly month: number;
  readonly timeline: PolicyTimeline;
  readonly worlds: readonly World[];
  /** World 1's ledger (one array for the ensemble's life), or null without `world1`. */
  readonly ledger: LedgerEvent[] | null;
  readonly series: readonly (WorldSeries | null)[];
  /** Next unit kind, or null when the ensemble waits (all at `months`, or the next frame not ready). */
  next(): UnitKind | null;
  /** Runs one unit of the kind `next()` gives; throws when `next()` is null. */
  unit(): void;
  /** Opens the series gate with `s` (re-creating each series from its data), or closes it (null). */
  setStatics(s: ScoreStatics | null): void;
  /**
   * Min over the series' `finalThrough()`; -1 while the gate is closed, worlds are being created or
   * a series awaits restore. A log not fed yet only holds the minimum back (series only grow).
   */
  finalThrough(): number;
  /**
   * The last model month whose frame this ensemble has used or will re-step quietly: the "last
   * month stepped" of rule 13. It counts a month some worlds have stepped (mid-month), the months
   * left to step quietly, and the month after the one a fresh due list was planned at (`planDue`
   * reads that frame; `createWorld` reads month 1's). An edit whose first difference is after it
   * is applied with `keep`; any other with `restore`.
   */
  readonly steppedThrough: number;
  /** Rule 13: carry on under `t`. Only for a first difference after `steppedThrough`. */
  keep(t: PolicyTimeline): void;
  /**
   * Rule 14, for a first difference m at or before `steppedThrough`: restore from the last copy at
   * or before m - 1 and drop later copies; cut the ledger. Then `next()` gives `restore` (one world
   * cloned and its due list rebuilt with `planDue`), then `quiet` until month m - 1. When every
   * world still stands at or before m - 1 inside a quiet re-step whose due lists read no frame
   * from m on, only the timeline and the quiet end change. With m = 1, or no copy at or before
   * m - 1, the worlds are created again, quietly.
   */
  restore(t: PolicyTimeline, m: number): void;
  /** Restore or quiet units remain. */
  readonly quiet: boolean;
  /** Model months whose copy is complete, ascending. */
  copiedMonths(): number[];
}

interface Feed {
  data: WorldSeriesData | null;
  log: FeedEntry[];
}

interface Copy {
  month: number;
  worlds: World[];
  feeds: Feed[];
  ledgerLength: number;
}

export function createEnsemble(o: EnsembleOpts): Ensemble {
  const W = o.worlds;
  const { statics, months } = o;
  const copyMonths = new Set(o.copyMonths);
  const world1 = o.world1 ?? null;
  const ledger: LedgerEvent[] | null = world1 ? [] : null;

  let timeline = o.timeline;
  let scoreStatics: ScoreStatics | null = null;
  /** Worlds created so far (creation), or W. */
  let created = 0;
  /** The month every world has stepped; -1 while creating. */
  let month = -1;
  /** The next world to step `month + 1`. */
  let nextIdx = 0;
  /** Quiet steps run through this month. */
  let quietThrough = -1;
  /** The month the due lists were last planned at with `planDue` (0 at creation). */
  let plannedAt = 0;
  /** The copy worlds are being restored from, and how many are restored. */
  let restoring: Copy | null = null;
  let restored = 0;
  /** Inside a quiet step: nothing goes to the stream or `onEvent`. */
  let quietNow = false;

  const worlds: World[] = [];
  const dues: Due[] = [];
  const series: (WorldSeries | null)[] = [];
  /** A world's series data while the gate is closed or its series awaits restore. */
  const data: (WorldSeriesData | null)[] = [];
  const logs: FeedEntry[][] = [];
  /** The first entry of each log not fed yet. */
  const heads: number[] = [];
  const copies = new Map<number, Copy & { taken: number }>();

  /** The sink of world `k`; world 1's (k 0) also feeds the ledger, the stream and `onEvent`. */
  const sinkOf = (k: number): StepSink => {
    const log = () => logs[k];
    if (k !== 0 || !world1) return { event: (e) => log().push({ e }) };
    return {
      event(e) {
        log().push({ e });
        if (!quietNow) {
          world1.stream?.onEvent(e, worlds[0], statics);
          world1.onEvent?.(e);
        }
      },
      ledger: (e) => ledger!.push(e)
    };
  };
  const sinks: StepSink[] = [];
  for (let k = 0; k < W; k++) sinks.push(sinkOf(k));

  const seriesOf = (s: ScoreStatics, d: WorldSeriesData | null) =>
    d === null ? createWorldSeries(s) : createWorldSeries(s, d);

  function reset(): void {
    created = 0;
    month = -1;
    nextIdx = 0;
    quietThrough = -1;
    plannedAt = 0;
    restoring = null;
    copies.clear();
    worlds.length = 0;
    dues.length = 0;
    if (ledger) ledger.length = 0;
    for (let k = 0; k < W; k++) {
      series[k] = null;
      data[k] = null;
      logs[k] = [];
      heads[k] = 0;
    }
  }
  reset();

  /** A copy of `month` is due and not complete: every world stands at a listed month. */
  const copyDue = (): boolean => {
    if (month < 0 || nextIdx !== 0 || !copyMonths.has(month)) return false;
    const c = copies.get(month);
    return c === undefined || c.taken < W;
  };

  /** The lowest-index world whose log can be fed now, or -1. */
  const feedable = (): number => {
    if (scoreStatics === null) return -1;
    for (let k = 0; k < W; k++) if (series[k] !== null && heads[k] < logs[k].length) return k;
    return -1;
  };

  function next(): UnitKind | null {
    if (created < W) return timeline.readyThrough() >= 1 ? 'create' : null;
    if (restoring) return 'restore';
    if (copyDue()) return 'copy';
    if (feedable() >= 0) return 'feed';
    if (month >= months || timeline.readyThrough() < month + 1) return null;
    return month + 1 <= quietThrough ? 'quiet' : 'step';
  }

  function steppedThrough(): number {
    const cur = month + (nextIdx > 0 ? 1 : 0);
    return Math.max(cur, quietThrough, plannedAt + 1);
  }

  function createUnit(): void {
    const k = created;
    const seed = k + 1;
    const buf: WorldEvent[] = [];
    const w = createWorld(statics, timeline, seed, {
      event: (e) => buf.push(e),
      ledger: sinks[k].ledger
    });
    worlds[k] = w;
    // `createWorld`'s events, replayed once it returns (map-stream.md, "Host calls"); quiet when
    // the worlds are created again by a restore.
    quietNow = month < quietThrough;
    try {
      for (const e of buf) sinks[k].event(e);
    } finally {
      quietNow = false;
    }
    dues[k] = planDue(w, statics, timeline, seed, months);
    if (scoreStatics !== null && series[k] === null) series[k] = seriesOf(scoreStatics, data[k]);
    created++;
    if (created === W) month = 0;
  }

  function restoreUnit(): void {
    const c = restoring!;
    const k = restored;
    const w = structuredClone(c.worlds[k]);
    worlds[k] = w;
    dues[k] = planDue(w, statics, timeline, k + 1, months);
    data[k] = c.feeds[k].data;
    logs[k] = c.feeds[k].log.slice();
    heads[k] = 0;
    series[k] = scoreStatics === null ? null : seriesOf(scoreStatics, data[k]);
    restored++;
    if (restored === W) restoring = null;
  }

  function copyUnit(): void {
    let c = copies.get(month);
    if (c === undefined) {
      // No world steps until the copy is complete, so the ledger length holds for every unit.
      c = { month, worlds: [], feeds: [], ledgerLength: ledger ? ledger.length : 0, taken: 0 };
      copies.set(month, c);
    }
    const k = c.taken;
    c.worlds[k] = structuredClone(worlds[k]);
    const s = series[k];
    c.feeds[k] = { data: s ? s.data() : data[k], log: logs[k].slice(heads[k]) };
    c.taken++;
  }

  /** Feeds one world's log up to and including its first `stepped` mark: one world-month (rule 5). */
  function feedUnit(): void {
    const k = feedable();
    const s = series[k]!;
    const w = worlds[k];
    const log = logs[k];
    let i = heads[k];
    while (i < log.length) {
      const f = log[i++];
      if ('e' in f) s.add(f.e, w, statics);
      else {
        s.stepped(f.stepped);
        break;
      }
    }
    if (i === log.length) {
      logs[k] = [];
      heads[k] = 0;
    } else heads[k] = i;
  }

  function stepUnit(quiet: boolean): void {
    const k = nextIdx;
    quietNow = quiet;
    try {
      step(worlds[k], dues[k], statics, timeline, k + 1, sinks[k]);
    } finally {
      quietNow = false;
    }
    logs[k].push({ stepped: worlds[k].month });
    nextIdx++;
    if (nextIdx === W) {
      nextIdx = 0;
      month++;
    }
  }

  return {
    get month() {
      return month;
    },
    get timeline() {
      return timeline;
    },
    get worlds() {
      return worlds;
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
      if (s === null) {
        for (let k = 0; k < W; k++) {
          const cur = series[k];
          if (cur) data[k] = cur.data();
          series[k] = null;
        }
        scoreStatics = null;
        return;
      }
      for (let k = 0; k < W; k++) {
        const cur = series[k];
        if (cur) data[k] = cur.data();
        // A world not yet created, or awaiting restore, gets its series when it does.
        const ready = k < created && !(restoring && k >= restored);
        series[k] = ready ? seriesOf(s, data[k]) : null;
      }
      scoreStatics = s;
    },
    finalThrough() {
      if (scoreStatics === null || created < W) return -1;
      let min = Infinity;
      for (let k = 0; k < W; k++) {
        const s = series[k];
        if (s === null) return -1;
        const f = s.finalThrough();
        if (f < min) min = f;
      }
      return min;
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
      const cur = month + (nextIdx > 0 ? 1 : 0);
      if (cur <= m - 1 && m - 1 <= quietThrough && plannedAt < m - 1) {
        // Inside a quiet re-step that has not reached m: the worlds and due lists read frames
        // before m only, which `t` shares. Steps from m on are loud again.
        quietThrough = m - 1;
        for (const c of [...copies.keys()]) if (c > m - 1) copies.delete(c);
        return;
      }
      let from: Copy | null = null;
      for (const c of copies.values()) {
        if (c.taken === W && c.month <= m - 1 && (from === null || c.month > from.month)) from = c;
      }
      // `createWorld` reads month 1's frame: a change there re-creates the worlds.
      if (from === null || m === 1) {
        reset();
        quietThrough = m - 1;
        return;
      }
      for (const c of [...copies.keys()]) if (c > from.month) copies.delete(c);
      if (ledger) ledger.length = from.ledgerLength;
      restoring = from;
      restored = 0;
      month = from.month;
      nextIdx = 0;
      quietThrough = m - 1;
      plannedAt = from.month;
      for (let k = 0; k < W; k++) series[k] = null;
    },
    copiedMonths() {
      return [...copies.values()]
        .filter((c) => c.taken === W)
        .map((c) => c.month)
        .sort((a, b) => a - b);
    }
  };
}
