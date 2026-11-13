// Properties of a frame change in mid-run (spec "Tests that must pass", plan Review Focus 2, 3, 5):
// a speed change moves days one way and changes no outcome; a zoning change leaves what came
// before it and the lots it does not touch alone; the view a start takes; replanning a lot freed on
// a month's last day; a re-anchored stage that ends in the change month.
import { beforeAll, describe, expect, it } from 'vitest';
import { FILL_LEVELS } from '$lib/data/scenario-codec';
import type { StageScale } from '$lib/sim/levers/timers';
import { precomputeOf } from '$lib/sim/scenario/input';
import { seedHash } from '$lib/sim/scenario/rng';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import { emptyWorld, ensureLot, lotRow } from './columns';
import { DueList, planDue } from './due';
import { monthFirstDay, monthLastDay, monthOfDay } from './months';
import type { PolicyFrame, PolicyTimeline } from './policy/frame';
import { ordinaryStart } from './rates';
import { masterAt, scheduleAt } from './read';
import { reanchor, rowSpeed } from './stage';
import { staticsOf, type Statics } from './statics';
import { benchInput } from './test/cities.node';
import { Recorder, SEEDS, horizonMonth, runWorld } from './test/run';
import {
  changingAt,
  frameOf,
  limited,
  marketAt,
  oneFrame,
  touchedRows,
  upzoned
} from './test/timeline';
import { END_ALIVE, LOT_DONE, LOT_FREE, ORIGIN_SIM, type World, type WorldEvent } from './types';
import { createWorld, step } from './world';

const M = 121;
const FAR: Day = 0x7fffffff;
const F = FILL_LEVELS.length;
const PROPERTY_SEEDS = [1, 2, 3, 4, 5];

/** An event without its row (`Omit` spread over the union). */
type NoRow = (WorldEvent extends infer E ? (E extends unknown ? Omit<E, 'row'> : never) : never) & {
  month: number;
};

/** Every timed stage of every route scaled by `v`. */
function everyStage(v: number): StageScale {
  const out = { discretionary: {}, streamlined: {}, permitOnly: {} } as Record<
    string,
    Record<string, number>
  >;
  for (const p of PATHWAYS) for (const s of STAGE_ORDER) if (s !== 'complete') out[p][s] = v;
  return out as unknown as StageScale;
}

/** Each row's project id, read through the readers. */
function idsOf(w: World, statics: Statics): string[] {
  const out: string[] = [];
  for (let row = 0; row < w.projects.n; row++) {
    const id =
      masterAt(w, statics, row, FAR)?.masterId ?? scheduleAt(w, statics, row, FAR)?.projectId;
    if (id === undefined) throw new Error(`row ${row} has no project id`);
    out.push(id);
  }
  return out;
}

/** Each project's events in order, without the row they were sent for. */
function byId(rec: Recorder, ids: string[]): Map<string, NoRow[]> {
  const out = new Map<string, NoRow[]>();
  for (const e of rec.events) {
    const { row, ...rest } = e;
    const id = ids[row];
    let list = out.get(id);
    if (!list) out.set(id, (list = []));
    list.push(rest);
  }
  return out;
}

function endOf(w: World, statics: Statics, row: number) {
  return masterAt(w, statics, row, FAR)?.end ?? scheduleAt(w, statics, row, FAR)!.end;
}

interface Run {
  w: World;
  rec: Recorder;
  ids: string[];
  events: Map<string, NoRow[]>;
  rowOf: Map<string, number>;
}

function run(statics: Statics, t: PolicyTimeline, seed: number, through: number): Run {
  const rec = new Recorder();
  const w = runWorld(statics, t, seed, through, rec);
  const ids = idsOf(w, statics);
  return { w, rec, ids, events: byId(rec, ids), rowOf: new Map(ids.map((id, row) => [id, row])) };
}

/** Each stage's entry day of one project, from its events. */
function enteredOf(events: NoRow[]): Map<Stage, Day> {
  const out = new Map<Stage, Day>();
  for (const e of events) if (e.kind === 'enter') out.set(e.stage, e.day);
  return out;
}

describe('a frame change in mid-run, bench city', () => {
  let input: SimInput;
  let statics: Statics;
  let f: PolicyFrame;
  beforeAll(() => {
    input = benchInput();
    statics = staticsOf(input);
    f = frameOf(input);
  });

  it.each(PROPERTY_SEEDS)(
    'a speed change moves days one way and changes no outcome (seed %i)',
    (seed) => {
      const through = horizonMonth(input.asOf);
      const a = run(statics, oneFrame(f), seed, through);
      for (const [v, faster] of [
        [0.5, true],
        [1.5, false]
      ] as const) {
        const g = { ...f, id: 1, speed: everyStage(v) };
        const b = run(statics, changingAt(M, f, g, new Int32Array(0)), seed, through);
        // Everything before the change is identical, rows included.
        const before = (r: Run) => r.rec.events.filter((e) => e.month < M);
        expect(before(b)).toEqual(before(a));
        let compared = 0;
        let moved = 0;
        for (const [id, evA] of a.events) {
          const evB = b.events.get(id);
          if (!evB) continue;
          const endA = endOf(a.w, statics, a.rowOf.get(id)!);
          const endB = endOf(b.w, statics, b.rowOf.get(id)!);
          if (endA.kind !== 'open' && endB.kind !== 'open') {
            const { day: _a, ...ka } = endA;
            const { day: _b, ...kb } = endB;
            void _a;
            void _b;
            expect(kb, id).toEqual(ka);
          }
          const ea = enteredOf(evA);
          const eb = enteredOf(evB);
          const [slow, fast] = faster ? [ea, eb] : [eb, ea];
          for (const [stage, d] of slow) {
            expect(fast.has(stage), `${id} ${stage}`).toBe(true);
            expect(fast.get(stage)!, `${id} ${stage}`).toBeLessThanOrEqual(d);
            compared++;
            if (fast.get(stage)! < d) moved++;
          }
        }
        expect(compared).toBeGreaterThan(0);
        expect(moved).toBeGreaterThan(0);
      }
    }
  );

  it.each(PROPERTY_SEEDS)(
    'a zoning change leaves events before it and untouched lots alone (seed %i)',
    (seed) => {
      const through = horizonMonth(input.asOf);
      const p2 = upzoned(
        input,
        precomputeOf(input).candidates.filter((_, i) => i % 10 === 0)
      );
      const touched = touchedRows(input.parcels, p2);
      const isTouched = new Set(touched);
      const g = frameOf(input, {
        id: 1,
        view: { parcels: p2, pre: precomputeOf({ ...input, parcels: p2 }) }
      });
      const a = run(statics, oneFrame(f), seed, through);
      const b = run(statics, changingAt(M, f, g, touched), seed, through);
      const before = (r: Run) => r.rec.events.filter((e) => e.month < M);
      expect(before(b)).toEqual(before(a));
      let differs = 0;
      const ids = new Set([...a.events.keys(), ...b.events.keys()]);
      for (const id of ids) {
        const row = a.rowOf.get(id) ?? b.rowOf.get(id)!;
        const w = a.rowOf.has(id) ? a.w : b.w;
        const sim = w.projects.origin[row] === ORIGIN_SIM;
        if (sim && isTouched.has(w.projects.src[row])) {
          if (JSON.stringify(a.events.get(id)) !== JSON.stringify(b.events.get(id))) differs++;
          continue;
        }
        expect(b.events.get(id), id).toEqual(a.events.get(id));
      }
      expect(differs).toBeGreaterThan(0);
    }
  );

  it('a start straddling the change takes its lot-month’s view', () => {
    const p2 = upzoned(
      input,
      precomputeOf(input).candidates.filter((_, i) => i % 10 === 0)
    );
    const touched = touchedRows(input.parcels, p2);
    const isTouched = new Set(touched);
    const g = frameOf(input, {
      id: 1,
      view: { parcels: p2, pre: precomputeOf({ ...input, parcels: p2 }) }
    });
    const t = changingAt(M, f, g, touched);
    const asOf = input.asOf;
    let found = 0;
    for (const seed of SEEDS) {
      // Stopped after month m, each lot's row still holds the free day and attempt of the start on it.
      const w = runWorld(statics, t, seed, M);
      const p = w.projects;
      for (let row = 0; row < p.n; row++) {
        if (p.origin[row] !== ORIGIN_SIM) continue;
        const lot = p.src[row];
        if (!isTouched.has(lot)) continue;
        const s = scheduleAt(w, statics, row, FAR)!;
        const day = Math.min(...(Object.values(s.entered) as number[]));
        if (monthOfDay(asOf, day) !== M) continue;
        const li = w.lots.lot.indexOf(lot);
        const plan = ordinaryStart(statics, t, M, seedHash(seed), lot, w.lots.r[li], w.lots.k[li]);
        expect(plan?.day).toBe(day);
        if (plan!.frameMonth !== M - 1) continue;
        const level = p.level[row];
        expect(s.revisions[0].units).toBe(input.parcels.yield[lot * F + level]);
        if (p2.yield[lot * F + level] !== input.parcels.yield[lot * F + level]) found++;
      }
      if (found > 0) break;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a lot freed on a month’s last day is planned again at the next change', () => {
    const asOf = input.asOf;
    const s0 = marketAt(input, asOf);
    const g = frameOf(input, { id: 1, market: s0 + 0.4 });
    const t = changingAt(M, f, g, null);
    const lim = limited(t, () => M - 1);
    const r = monthLastDay(asOf, M - 1);
    const candidates = precomputeOf(input).candidates;
    // A lot whose plan made in month m - 1 differs from the one read through month m.
    let lot = -1;
    let seed = 0;
    let want = null as ReturnType<typeof ordinaryStart>;
    for (let s = 1; s <= 20 && lot < 0; s++) {
      for (const i of candidates) {
        const old = ordinaryStart(statics, lim, M - 1, seedHash(s), i, r, 1);
        const now = ordinaryStart(statics, t, M, seedHash(s), i, r, 1);
        if (old === null || now === null || old.day === now.day || now.month > M + 24) continue;
        expect(old.month).toBeGreaterThanOrEqual(M);
        lot = i;
        seed = s;
        want = now;
        break;
      }
    }
    expect(lot).toBeGreaterThanOrEqual(0);
    // A hand-built world after month m - 1 holding only this lot, freed on that month's last day
    // and planned (as system 3 would have) on month m - 1's frame.
    // Every other lot already holds a finished project, so nothing else is free.
    const w = emptyWorld(f.id);
    for (let i = 0; i < statics.parcelId.length; i++) {
      w.lots.state[ensureLot(w.lots, i, asOf)] = i === lot ? LOT_FREE : LOT_DONE;
    }
    const li = lotRow(w.lots, lot);
    w.lots.r[li] = r;
    w.lots.k[li] = 1;
    w.month = M - 1;
    const due = new DueList(M + 24);
    due.put(lot, ordinaryStart(statics, lim, M - 1, seedHash(seed), lot, r, 1)!.month);
    const rec = new Recorder();
    let startDay: Day | null = null;
    for (let m = M; m <= want!.month; m++) {
      rec.month = m;
      step(w, due, statics, t, seed, rec);
    }
    for (const e of rec.events) {
      if (e.kind === 'start' && w.projects.src[e.row] === lot && w.projects.sub[e.row] === 1)
        startDay = e.day;
    }
    expect(startDay).toBe(want!.day);
  });

  it('a re-anchored stage ending this month is stepped this month', () => {
    const asOf = input.asOf;
    const g = { ...f, id: 1, speed: everyStage(0.05) };
    const t = changingAt(M, f, g, new Int32Array(0));
    const first = monthFirstDay(asOf, M);
    const last = monthLastDay(asOf, M);
    let checked = 0;
    for (const seed of SEEDS) {
      const w = createWorld(statics, t, seed, { event() {} });
      const due = planDue(w, statics, t, seed, horizonMonth(asOf));
      for (let m = 1; m < M; m++) step(w, due, statics, t, seed, { event() {} });
      // The rows whose stage, carried to the new speed, now ends inside month m.
      const copy = structuredClone(w);
      const rows: number[] = [];
      const p = copy.projects;
      for (let row = 0; row < p.n; row++) {
        if (p.endKind[row] !== END_ALIVE || p.outcome[row] !== 0 || p.leave[row] <= last) continue;
        const s = rowSpeed(copy, row, g);
        if (s === p.speed[row]) continue;
        reanchor(copy, row, first, s);
        if (p.leave[row] <= last) rows.push(row);
      }
      const rec = new Recorder();
      rec.month = M;
      step(w, due, statics, t, seed, rec);
      for (const row of rows) {
        const next = rec.events.find((e) => e.row === row && e.kind === 'enter');
        expect(next, `row ${row}`).toBeDefined();
        expect(next!.month).toBe(M);
        expect(next!.day).toBe(copy.projects.leave[row]);
        checked++;
      }
      if (checked > 0) break;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
