// A funded project awarded and completed inside one step: world-funding sends the 'award' after
// the chain `startProject` began, so the row's 'end' 'complete' reaches the series first. Tiers
// must not assume the award precedes completion (comprehension gate, row 20).
import { beforeAll, describe, expect, it } from 'vitest';
import { tierContext, tierSeries, tiersOf } from '$lib/sim/scenario/finance-score';
import { MIN_SCALE } from '$lib/sim/levers/types';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { Calibration, Transition } from '$lib/timelapse/types';
import { fundedMini, oneMoneyTimeline } from '../funding/test/fixtures';
import { monthFirstDay, monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { scheduleAt } from '../read';
import { staticsOf, type Statics } from '../statics';
import { everyStage } from '../test/timeline';
import { NO_DAY, type World, type WorldEvent } from '../types';
import { SERIES_FIELDS, createWorldSeries, extrasOf } from './series';
import { horizonOf } from './statics';
import { feedFunded, timelineStatics, type FeedMode } from './test/feed';
import type { ScoreStatics, WorldSeries } from './types';

/** `cal` with every stage of a new project advancing within its first month, no exits. */
function swift(cal: Calibration): Calibration {
  const transitions = {} as Calibration['transitions'];
  for (const [path, stages] of Object.entries(cal.transitions)) {
    const out: Partial<Record<string, Transition>> = {};
    for (const [stage, t] of Object.entries(stages)) {
      out[stage] = {
        ...t!,
        months: 1,
        advance: [0.99],
        exit: {},
        tail: { advance: 0.99, exit: {} }
      };
    }
    transitions[path as keyof Calibration['transitions']] = out;
  }
  return { ...cal, transitions };
}

/**
 * `oneMoneyTimeline` with every timed stage at the fastest speed the levers allow and new
 * projects' stages drawn within a month: a stage then lasts at most a day, so a funded project
 * can pass every stage inside the step it is awarded in.
 */
function fastTimeline(input: SimInput): PolicyTimeline {
  const base = oneMoneyTimeline(input, input.finance!);
  const fast = everyStage(MIN_SCALE);
  const newCalibration = swift(input.calibration);
  const frames = new Map<number, PolicyFrame>();
  return {
    ...base,
    frameAt(m) {
      let f = frames.get(m);
      if (f === undefined) {
        frames.set(m, (f = { ...base.frameAt(m), speed: fast, newCalibration }));
      }
      return f;
    }
  };
}

const MONTHS = 240;

interface Fed {
  series: WorldSeries;
  world: World;
  /** Every event in the order the series got it, with the model month that sent it. */
  events: { e: WorldEvent; month: number }[];
}

describe('award after completion in the same step', () => {
  let input: SimInput;
  let statics: Statics;
  let timeline: PolicyTimeline;
  let score: ScoreStatics;
  const fed = new Map<string, Fed>();
  const feed = (mode: FeedMode, seed = 1, drop = false): Fed => {
    const key = `${mode}|${seed}|${drop}`;
    let r = fed.get(key);
    if (r !== undefined) return r;
    const series = createWorldSeries(score);
    const events: Fed['events'] = [];
    const into: WorldSeries = drop
      ? { ...series, add: (e, w, s) => (e.kind === 'award' ? undefined : series.add(e, w, s)) }
      : series;
    const got = feedFunded(
      statics,
      timeline,
      seed,
      MONTHS,
      into,
      (e, _w, m) => events.push({ e, month: m }),
      mode
    );
    r = { series, world: got.world, events };
    fed.set(key, r);
    return r;
  };

  beforeAll(() => {
    input = fundedMini();
    statics = staticsOf(input);
    timeline = fastTimeline(input);
    score = timelineStatics(input, timeline, MONTHS);
  });

  /** Funded rows whose 'end' 'complete' the series got before their 'award', in one step. */
  function completedFirst(r: Fed): number[] {
    const done = new Map<number, number>();
    const out: number[] = [];
    for (const { e, month } of r.events) {
      if (e.kind === 'end' && e.how === 'complete') done.set(e.row, month);
      if (e.kind === 'award' && done.get(e.row) === month) out.push(e.row);
    }
    return out;
  }

  it('the engine completes a funded project before its award arrives', () => {
    const r = feed('live');
    const rows = completedFirst(r);
    expect(rows.length).toBeGreaterThan(0);
    // The award and the completion fall in one model month.
    for (const row of rows) {
      const sc = scheduleAt(r.world, statics, row, horizonOf(score))!;
      expect(sc.end.kind).toBe('complete');
      expect(r.world.projects.funded[row]).toBe(1);
    }
  });

  it.each(['live', 'buffered', 'after'] as const)(
    '%s: tiers equal tierSeries of the schedules at the horizon',
    (mode) => {
      const r = feed(mode);
      const last = score.lastIndex;
      expect(r.series.finalThrough()).toBe(last);
      const H = horizonOf(score);
      const schedules = [];
      for (let row = 0; row < r.world.projects.n; row++) {
        const sc = scheduleAt(r.world, statics, row, H);
        if (sc) schedules.push(sc);
      }
      const want = tierSeries(schedules, tierContext(input), input.asOf, H, score.months);
      expect(extrasOf(r.series).tiers(0, last)).toEqual(want);
      expect(extrasOf(r.series).unawarded()).toBe(0);
    }
  );

  it('live, buffered and after feeds give equal data', () => {
    const last = score.lastIndex;
    const summed = (r: Fed) => (r.series.rows(0, last), r.series.data());
    const live = summed(feed('live'));
    expect(summed(feed('buffered'))).toEqual(live);
    expect(summed(feed('after'))).toEqual(live);
  });

  it("the award day is recorded for a row that completed before its 'award'", () => {
    const r = feed('live');
    const d = r.series.data();
    for (const row of completedFirst(r)) {
      const award = r.events.find((x) => x.e.kind === 'award' && x.e.row === row)!.e.day;
      expect(d.award[row]).toBe(award);
      expect(monthOfDay(input.asOf, award)).toBe(monthOfDay(input.asOf, d.done[row]));
    }
  });

  it("a funded row that never gets its 'award' does not throw and is counted", () => {
    const r = feed('live', 1, true);
    const withAward = feed('live');
    const last = score.lastIndex;
    // Filed by the completion month's definitions: the programmes never change here, so the
    // tiers are those of the fed run.
    expect(extrasOf(r.series).tiers(0, last)).toEqual(extrasOf(withAward.series).tiers(0, last));
    let funded = 0;
    for (let row = 0; row < r.world.projects.n; row++) {
      if (r.world.projects.funded[row] === 1 && r.series.data().done[row] !== NO_DAY) funded++;
    }
    expect(funded).toBeGreaterThan(0);
    expect(extrasOf(r.series).unawarded()).toBe(funded);
  });

  it('a series saved mid-step, before the award, restores exactly', () => {
    const ref = feed('live');
    const row = completedFirst(ref)[0];
    // Save right after the row's completion, before its award; restore and feed on.
    let into: WorldSeries = createWorldSeries(score);
    let saved = false;
    const proxy: WorldSeries = {
      add(e, w, s) {
        into.add(e, w, s);
        if (!saved && e.kind === 'end' && e.how === 'complete' && e.row === row) {
          saved = true;
          into = createWorldSeries(score, structuredClone(into.data()));
          awaitingAtSave = into.data().award[row];
        }
      },
      stepped: (m) => into.stepped(m),
      finalThrough: () => into.finalThrough(),
      rows: (a, b) => into.rows(a, b),
      data: () => into.data()
    };
    let awaitingAtSave = 0;
    feedFunded(statics, timeline, 1, MONTHS, proxy);
    expect(saved).toBe(true);
    // Saved while the row awaited its award (`AWAITING`).
    expect(awaitingAtSave).toBe(NO_DAY + 1);
    const last = score.lastIndex;
    expect(extrasOf(into).tiers(0, last)).toEqual(extrasOf(ref.series).tiers(0, last));
    into.rows(0, last);
    ref.series.rows(0, last);
    expect(into.data()).toEqual(ref.series.data());
  });
});

/** Programme tiers every affordable programme takes from the change on (test values). */
const LATER_TIERS = { veryLow: 0, low: 0, moderate: 1, aboveModerate: 0 };

/** `t` with every affordable programme's `tiers` replaced by `LATER_TIERS` from month `m` on. */
function tiersLaterAt(t: PolicyTimeline, m: number): PolicyTimeline {
  const frames = new Map<number, PolicyFrame>();
  const changes = [...new Set([...t.changes(), m])].sort((a, b) => a - b);
  return {
    ...t,
    changes: () => changes,
    frameAt(month) {
      if (month < m) return t.frameAt(month);
      let f = frames.get(month);
      if (f === undefined) {
        const b = t.frameAt(month);
        const programmes = b.finance!.programmes.map((g) =>
          g.tiers ? { ...g, tiers: { ...LATER_TIERS } } : g
        );
        f = { ...b, id: frameIdOf(`tiers-later|${b.id}`), finance: { ...b.finance!, programmes } };
        frames.set(month, f);
      }
      return f;
    }
  };
}

const TIER_KEYS = ['veryLow', 'low', 'moderate', 'aboveModerate', 'unrecorded'] as const;

describe("an 'award' of a later step than its row's completion", () => {
  it("re-files the row's tiers by the award month's definitions, in the completion's month", () => {
    const M = 120;
    const input = fundedMini();
    const statics = staticsOf(input);
    const timeline = tiersLaterAt(fastTimeline(input), M);
    const score = timelineStatics(input, timeline, MONTHS);
    const fin = input.finance!;
    const before = tierContext(input);
    const after = tierContext({
      projects: input.projects,
      finance: {
        ...fin,
        programmes: fin.programmes.map((g) => (g.tiers ? { ...g, tiers: { ...LATER_TIERS } } : g))
      }
    });
    // A recorded run: its events with the model month that sent each, and its world.
    const events: { e: WorldEvent; month: number }[] = [];
    const got = feedFunded(statics, timeline, 1, MONTHS, createWorldSeries(score), (e, _w, m) =>
      events.push({ e, month: m })
    );
    const w = got.world;
    // A funded row completed before month M whose split the later definitions move.
    let row = -1;
    let sc: Schedule | null = null;
    for (const { e, month } of events) {
      if (month >= M || e.kind !== 'end' || e.how !== 'complete') continue;
      if (w.projects.funded[e.row] !== 1) continue;
      const s = scheduleAt(w, statics, e.row, e.day)!;
      if (JSON.stringify(tiersOf(s, before)) !== JSON.stringify(tiersOf(s, after))) {
        row = e.row;
        sc = s;
        break;
      }
    }
    expect(row).toBeGreaterThanOrEqual(0);
    // Fed by hand, against the final world, through the row's completion with its award held
    // back; the completion's step is not stepped.
    const series = createWorldSeries(score);
    let done = NO_DAY;
    let month = 0;
    for (const x of events) {
      for (; month < x.month; month++) if (month > 0) series.stepped(month);
      if (x.e.kind === 'award' && x.e.row === row) continue;
      series.add(x.e, w, statics);
      if (x.e.kind === 'end' && x.e.how === 'complete' && x.e.row === row) {
        done = x.e.day;
        break;
      }
    }
    expect(series.data().award[row]).toBe(NO_DAY + 1);
    const was = series.data().delta;
    const awardDay = monthFirstDay(input.asOf, M);
    series.add({ kind: 'award', row, day: awardDay }, w, statics);
    const now = series.data();
    expect(now.award[row]).toBe(awardDay);
    let i = 0;
    while (i + 1 < score.months.length && score.months[i + 1] <= done) i++;
    const a = tiersOf(sc!, before);
    const b = tiersOf(sc!, after);
    const tier0 = SERIES_FIELDS - TIER_KEYS.length;
    const moved = TIER_KEYS.map((_, k) => {
      const at = i * SERIES_FIELDS + tier0 + k;
      return now.delta[at] - was[at];
    });
    expect(moved).toEqual(TIER_KEYS.map((k) => b[k] - a[k]));
    // Nothing else moved.
    let other = 0;
    for (let f = 0; f < was.length; f++) if (now.delta[f] !== was[f]) other++;
    expect(other).toBe(moved.filter((v) => v !== 0).length);
  });
});
