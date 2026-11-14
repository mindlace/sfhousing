// `WorldSeries` filing on the fixture city (fixture-0): feed order, same-day revisions, the guard on
// final months and the range of `rows`.
import { beforeAll, describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import { monthIndexer, monthsOf, shownSeries } from '$lib/sim/scenario/score';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { scheduleAt } from '../read';
import { staticsOf, type Statics } from '../statics';
import { benchInput, fixtureInput } from '../test/cities.node';
import { Recorder, horizonMonth, runWorld } from '../test/run';
import { everyStage, frameOf, oldInputOf, oneFrame } from '../test/timeline';
import { END_ALIVE, ORIGIN_MASTER, ORIGIN_SIM, type WorldEvent } from '../types';
import { createWorldSeries } from './series';
import { horizonOf } from './statics';
import { feedWorld, testStatics, type FeedMode } from './test/feed';

let input: SimInput;
let statics: Statics;
beforeAll(async () => {
  input = await fixtureInput();
  statics = staticsOf(input);
});

/** The units of the revision current on `day` (score.ts `unitsOn`). */
function unitsOn(revs: Schedule['revisions'], day: Day): number {
  let u = revs[0].units;
  for (let k = 1; k < revs.length && revs[k].day <= day; k++) u = revs[k].units;
  return u;
}

describe('WorldSeries on the fixture', () => {
  it('live, buffered and after feeds give equal rows', () => {
    const W = horizonMonth(input.asOf);
    for (const seed of [1, 2, 3]) {
      const s = testStatics(input, W);
      const out = (['live', 'buffered', 'after'] as FeedMode[]).map((mode) => {
        const series = createWorldSeries(s);
        feedWorld(statics, oneFrame(frameOf(input)), seed, W, series, mode);
        expect(series.finalThrough(), mode).toBe(s.lastIndex);
        return series.rows(0, s.lastIndex);
      });
      expect(out[1]).toEqual(out[0]);
      expect(out[2]).toEqual(out[0]);
    }
  });

  // The fixture revises nothing; the bench city (synthCity) revises at permitFiled and
  // permitIssued, so the feed orders are also compared where revisions happen.
  it('bench seed 1: live, buffered and after feeds give equal rows', () => {
    const bench = benchInput();
    const bStatics = staticsOf(bench);
    const W = horizonMonth(bench.asOf);
    const s = testStatics(bench, W);
    const out = (['live', 'buffered', 'after'] as FeedMode[]).map((mode) => {
      const series = createWorldSeries(s);
      feedWorld(bStatics, oneFrame(frameOf(bench)), 1, W, series, mode);
      return series.rows(0, s.lastIndex);
    });
    expect(out[1]).toEqual(out[0]);
    expect(out[2]).toEqual(out[0]);
  });

  // The fixture's calibration revises with probability 0 and a ratio of 1, and the bench's only at
  // permitFiled and permitIssued, so no stock city revises on the entitled day (nor would a faster
  // frame make one). This fixture variant also revises on entering `entitled`, always by a ratio
  // in [0.5, 0.75) (a raise would be capped at the lot's top, which the fixture's simulated rows
  // already draw), and stays fixture-0 otherwise.
  it('a same-day revise on entitled day counts the revised units in entitledNew', () => {
    const W = horizonMonth(input.asOf);
    const cal = structuredClone(input.calibration);
    const edges = cal.revision.at[0].ratio.edges;
    const probs = edges.slice(1).map((_, k): number => (edges[k] === 0.5 ? 1 : 0));
    expect(probs.reduce((a, b) => a + b, 0)).toBe(1);
    cal.revision.at = [
      { stage: 'entitled', probability: 1, ratio: { edges, probs } },
      ...cal.revision.at
    ];
    const varied: SimInput = { ...input, calibration: cal };
    const vStatics = staticsOf(varied);
    const s = testStatics(varied, W);
    const idx = monthIndexer(s.months, horizonOf(s));
    let found = 0;
    const tryFrame = (speed: number | null) => {
      const frame = frameOf(varied, speed === null ? {} : { speed: everyStage(speed) });
      for (let seed = 1; seed <= 10; seed++) {
        const rec = new Recorder();
        const w = runWorld(vStatics, oneFrame(frame), seed, W, rec);
        let here = 0;
        const byRow = new Map<number, (WorldEvent & { month: number })[]>();
        for (const e of rec.events) {
          if (!byRow.has(e.row)) byRow.set(e.row, []);
          byRow.get(e.row)!.push(e);
        }
        for (const [row, events] of byRow) {
          if (w.projects.origin[row] !== ORIGIN_SIM) continue;
          const ent = events.find((e) => e.kind === 'enter' && e.stage === 'entitled');
          if (!ent || ent.day <= input.asOf || ent.day > HORIZON) continue;
          if (!events.some((e) => e.kind === 'revise' && e.day === ent.day)) continue;
          const sc = scheduleAt(w, vStatics, row, HORIZON)!;
          // This row's events alone, month by month as the runner sends them.
          const one = createWorldSeries(s);
          for (let m = 0; m <= W; m++) {
            for (const e of events) if (e.month === m) one.add(e, w, vStatics);
            if (m > 0) one.stepped(m);
          }
          const i = idx(ent.day);
          const rows = one.rows(0, s.lastIndex);
          const delta = rows[i].entitledNew - (i > 0 ? rows[i - 1].entitledNew : 0);
          expect(delta, `seed ${seed} row ${row}`).toBe(
            unitsOn(sc.revisions, ent.day) - sc.existingUnits
          );
          expect(rows[s.lastIndex].entitledNew).toBe(delta);
          here++;
        }
        if (here === 0) continue;
        found += here;
        // The whole world, fed live and after the run, agrees on this variant too.
        const out = (['live', 'after'] as FeedMode[]).map((mode) => {
          const series = createWorldSeries(s);
          feedWorld(vStatics, oneFrame(frame), seed, W, series, mode);
          return series.rows(0, s.lastIndex);
        });
        expect(out[1]).toEqual(out[0]);
        // And today's engine on the same calibration (rule 5 with entitled-day revisions).
        const old = simulateDetailed(oldInputOf(varied), seed, HORIZON);
        expect(out[0]).toEqual(
          shownSeries(old, varied.asOf, HORIZON, monthsOf(varied.asOf, HORIZON))
        );
      }
    };
    tryFrame(null);
    if (found === 0) tryFrame(0.05);
    expect(found).toBeGreaterThan(0);
  });

  it('throws when a delta lands in a final month', () => {
    const s = testStatics(input, horizonMonth(input.asOf));
    const series = createWorldSeries(s);
    const w = feedWorld(statics, oneFrame(frameOf(input)), 1, 20, series, 'live');
    expect(series.finalThrough()).toBeGreaterThan(0);
    const p = w.projects;
    let row = -1;
    for (let r = 0; r < p.n && row < 0; r++) {
      if (p.endKind[r] === END_ALIVE && p.origin[r] !== ORIGIN_MASTER && p.units[r] > 0) row = r;
    }
    expect(row).toBeGreaterThanOrEqual(0);
    // The last day of calendar month 0, after the dataset date: the exit files into month 0.
    const day = s.months[1] - 1;
    expect(day).toBeGreaterThan(input.asOf);
    const e: WorldEvent = { kind: 'end', row, day, how: 'exit' };
    expect(() => series.add(e, w, statics)).toThrow(/final/);
  });

  it('rows outside 0..finalThrough throw', () => {
    const s = testStatics(input, horizonMonth(input.asOf));
    const series = createWorldSeries(s);
    expect(series.finalThrough()).toBe(-1);
    expect(() => series.rows(0, 0)).toThrow(RangeError);
    feedWorld(statics, oneFrame(frameOf(input)), 1, 20, series, 'live');
    const f = series.finalThrough();
    expect(f).toBeGreaterThan(0);
    expect(series.rows(0, f)).toHaveLength(f + 1);
    expect(series.rows(f, f)).toHaveLength(1);
    expect(() => series.rows(-1, 0)).toThrow(RangeError);
    expect(() => series.rows(1, 0)).toThrow(RangeError);
    expect(() => series.rows(0, f + 1)).toThrow(RangeError);
  });
});
