// Paired plan/baseline runs, source attribution, the summary and the representative timeline
// (lesscars Task 8), on the engine's mini city (src/lib/sim/scenario/fixtures/mini-parcels.ts)
// with small hand-built regimes and few seeds.
import { describe, expect, it } from 'vitest';
import { idsHash } from '../../src/lib/data/column-file';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import {
  FREED,
  OTHER,
  PARKING,
  SOURCES,
  TRANSIT_UNLOCKED,
  parseSummary,
  type InitiativeBuild,
  type LessCarsSummary
} from '../../src/lib/data/lesscars/codec';
import type { LessCarsPlan } from '../../src/lib/data/lesscars/plan';
import { LESSCARS_HORIZON, schedulePlan } from '../../src/lib/data/lesscars/schedule';
import { TINY_PLAN } from '../../src/lib/data/lesscars/fixtures/tiny-plan';
import type { EnvelopeRow } from '../../src/lib/data/envelope-row';
import { bandSeed, nearestRank, representativeIndex } from '../../src/lib/sim/scenario/band';
import { dayOf } from '../../src/lib/sim/scenario/dates';
import { runEngine } from '../../src/lib/sim/scenario/engine';
import { precomputeOf } from '../../src/lib/sim/scenario/input';
import { buildSimInput } from '../../src/lib/sim/scenario/input';
import { miniMarket } from '../../src/lib/sim/scenario/fixtures/mini-market';
import { goldenInput } from '../../src/lib/sim/scenario/simulate.golden.cases';
import { simulate, simulateDetailed, simulateNet } from '../../src/lib/sim/scenario/simulate';
import type { Schedule, SimInput } from '../../src/lib/sim/scenario/types';
import type { Day } from '../../src/lib/timelapse/time';
import {
  baselineInput,
  garageCosts,
  initiativeBuilds,
  lesscarsYearEnds,
  planInput,
  representativeTimeline,
  reservationsOf,
  runPairs,
  sourceOfRows,
  summarise
} from '../lib/lesscars/runs';
import { miniLessCarsPlan } from './lesscars-helpers';

const base = goldenInput();
const n = base.parcels.count;
const H = LESSCARS_HORIZON;
const YE = lesscarsYearEnds();
const Y = YE.length;
const SW = dayOf(2032, 1, 31);
const SEEDS = 9;
const pre = precomputeOf(base);

function viewOf(edit: (p: ScenarioParcels) => void): ScenarioParcels {
  const p: ScenarioParcels = {
    ...base.parcels,
    hostable: base.parcels.hostable.slice(),
    yield: base.parcels.yield.slice()
  };
  edit(p);
  return p;
}
const F = base.parcels.fillLevels.length;
const doubled = viewOf((p) => {
  for (let j = 0; j < p.yield.length; j++) p.yield[j] *= 2;
});
/** Rows the plan regime unlocks: every third candidate, yields ×4 instead of ×2. */
const UNLOCK = pre.candidates.filter((_, k) => k % 3 === 0);
const unlockedView = viewOf((p) => {
  for (let j = 0; j < p.yield.length; j++) p.yield[j] *= 2;
  for (const i of UNLOCK) for (let f = 0; f < F; f++) p.yield[i * F + f] *= 2;
});
const unlocked = new Uint8Array(n);
for (const i of UNLOCK) unlocked[i] = 1;

const same = { baseline: [{ day: SW, parcels: doubled }], plan: [{ day: SW, parcels: doubled }] };
const richer = {
  baseline: [{ day: SW, parcels: doubled }],
  plan: [{ day: SW, parcels: unlockedView }]
};
const none = new Int32Array(n);

function freed(units: number, completeDay: Day, siteId = 'lc:x:0'): InitiativeBuild {
  return {
    siteId,
    projectId: 'x',
    parcelRow: null,
    units,
    stories: 5,
    existing: 0,
    startDay: completeDay - 600,
    completeDay
  };
}
function parking(row: number, units: number, completeDay: Day): InitiativeBuild {
  return {
    siteId: base.parcels.id[row],
    projectId: `park:${row}`,
    parcelRow: row,
    units,
    stories: 4,
    existing: base.parcels.existingUnits[row],
    startDay: completeDay - 500,
    completeDay
  };
}

type Pairs = ReturnType<typeof runPairs>;
function pairs(
  regimes: typeof same,
  reservedFrom: Int32Array,
  builds: InitiativeBuild[],
  seeds = SEEDS
): Pairs {
  return runPairs({
    base,
    regimes,
    reservedFrom,
    builds,
    source: sourceOfRows(n, reservedFrom, regimes === richer ? unlocked : new Uint8Array(n)),
    seeds,
    yearEnds: YE,
    horizon: H
  });
}
const meta = (regimes: typeof same) => ({
  datasetVersion: 'fixture-60',
  planId: 'test',
  switchDay: SW,
  regimeDays: regimes.plan.map((g) => g.day),
  yearEnds: YE
});
const totalOf = (bySource: Int32Array[], y: number) => bySource.reduce((a, s) => a + s[y], 0);

/** The engine's own completedNet at each year end (simulateNet buckets end the day after). */
function engineTotal(input: SimInput, seed: number): number[] {
  const months = [input.asOf, ...YE.map((d) => d + 1)];
  return Array.from(simulateNet(input, seed, H, months).completedNet.subarray(0, Y));
}
/** Cumulative net (addNet's rule) per year end of the schedules whose first sorted parcel is `id`. */
function netOn(ss: Schedule[], id: string): number[] {
  const out = new Array<number>(Y).fill(0);
  const add = (d: Day, v: number) => {
    for (let y = 0; y < Y; y++) if (d <= YE[y]) out[y] += v;
  };
  for (const s of ss) {
    if ([...s.parcelIds].sort()[0] !== id) continue;
    const c = s.entered.construction;
    if (c !== undefined && c > base.asOf) add(c, -s.existingUnits);
    if (s.end.kind === 'complete') add(s.end.day, s.revisions[s.revisions.length - 1].units);
  }
  return out;
}
/** Per year end, units − existing of the builds counted by `d`. */
function buildNet(bs: InitiativeBuild[]): number[] {
  return YE.map((ye) =>
    bs.reduce((a, b) => a + (b.completeDay <= ye ? b.units - b.existing : 0), 0)
  );
}
/** Which rows' reservations a plan-arm run keeps. */
function keptIn(input: SimInput, seed: number): Map<number, boolean> {
  const kept = new Map<number, boolean>();
  runEngine(input, seed, H, {
    schedule() {},
    master() {},
    reservation(row, k) {
      kept.set(row, k);
    }
  });
  return kept;
}
function sumOfSources(s: LessCarsSummary): number[] {
  return YE.map((_, y) => SOURCES.reduce((a, k) => a + s.bySource[k][y], 0));
}

describe('lesscars runs', () => {
  it('identical arms give zero difference in every source and year', () => {
    const r = pairs(same, none, []);
    expect(r.perSeed.map((p) => p.seed)).toEqual(
      Array.from({ length: SEEDS }, (_, i) => bandSeed(i))
    );
    for (const p of r.perSeed) expect(p.plan).toEqual(p.baseline);
    const s = summarise(r, meta(same));
    const zeros = new Array(Y).fill(0);
    for (const k of SOURCES) expect(s.bySource[k]).toEqual(zeros);
    expect(s.extra).toEqual({ mean: zeros, p10: zeros, p50: zeros, p90: zeros });
    expect(s.plan).toEqual(s.baseline);
    expect(s.plan[Y - 1]).toBeGreaterThan(0);
    expect(s.seeds).toBe(SEEDS);
  });

  it('parts sum to the total exactly per seed', () => {
    const rf = new Int32Array(n);
    const reservedRows = [UNLOCK[0], pre.candidates[1]];
    for (const i of reservedRows) rf[i] = dayOf(2034, 1, 1);
    const builds = [
      freed(40, dayOf(2038, 6, 1)),
      parking(reservedRows[0], 25, dayOf(2036, 6, 1)),
      parking(reservedRows[1], 18, dayOf(2037, 3, 1))
    ];
    const r = pairs(richer, rf, builds);
    const s = summarise(r, meta(richer));
    let unlockedSeen = 0;
    for (const p of r.perSeed) {
      const planIn: SimInput = { ...base, regimes: richer.plan, reservedFrom: rf };
      const baseIn: SimInput = { ...base, regimes: richer.baseline };
      const kept = keptIn(planIn, p.seed);
      const counted = builds.filter((b) => b.parcelRow === null || kept.get(b.parcelRow));
      const planTotal = engineTotal(planIn, p.seed).map((v, y) => v + buildNet(counted)[y]);
      const baseTotal = engineTotal(baseIn, p.seed);
      for (let y = 0; y < Y; y++) {
        expect(totalOf(p.plan, y)).toBe(planTotal[y]);
        expect(totalOf(p.baseline, y)).toBe(baseTotal[y]);
        const parts = SOURCES.reduce((a, _, k) => a + p.plan[k][y] - p.baseline[k][y], 0);
        expect(parts).toBe(planTotal[y] - baseTotal[y]);
      }
      // freed land is exactly the freed build; baseline has none
      expect(Array.from(p.plan[FREED])).toEqual(buildNet([builds[0]]));
      expect(Array.from(p.baseline[FREED])).toEqual(new Array(Y).fill(0));
      if (p.plan[TRANSIT_UNLOCKED][Y - 1] !== p.baseline[TRANSIT_UNLOCKED][Y - 1]) unlockedSeen++;
    }
    expect(unlockedSeen).toBeGreaterThan(0);
    // the summary's integer sums add exactly, and it survives its own parser
    expect(parseSummary(JSON.parse(JSON.stringify(s)))).toEqual(s);
    for (let y = 0; y < Y; y++) {
      const parts = SOURCES.reduce((a, k) => a + Math.round(s.bySource[k][y] * SEEDS), 0);
      expect(parts).toBe(Math.round(s.extra.mean[y] * SEEDS));
    }
  });

  it('negative difference: parts still sum', () => {
    // garage reservations on every candidate from 2030: the baseline builds there, the plan cannot
    const rf = new Int32Array(n);
    for (const i of pre.candidates) rf[i] = dayOf(2030, 1, 1);
    const r = pairs(same, rf, []);
    const s = summarise(r, meta(same));
    expect(Math.min(...s.extra.p10)).toBeLessThan(0);
    expect(sumOfSources(s).map((v) => Math.round(v * 1e6))).toEqual(
      s.extra.mean.map((v) => Math.round(v * 1e6))
    );
    expect(s.bySource.parking[Y - 1]).toBeLessThan(0);
    expect(s.bySource.freed).toEqual(new Array(Y).fill(0));
  });

  it('an initiative build counts on its completion year end and not before', () => {
    const mid = dayOf(2036, 7, 1);
    const onYearEnd = YE[12]; // 31 Dec 2040
    const r = pairs(same, none, [freed(40, mid), freed(7, onYearEnd, 'lc:x:1')]);
    const y36 = YE.indexOf(dayOf(2036, 12, 31));
    for (const p of r.perSeed) {
      for (let y = 0; y < Y; y++) {
        const want = (y >= y36 ? 40 : 0) + (y >= 12 ? 7 : 0);
        expect(p.plan[FREED][y]).toBe(want);
        expect(totalOf(p.plan, y) - totalOf(p.baseline, y)).toBe(want);
      }
    }
    const s = summarise(r, meta(same));
    expect(s.extra.mean[y36 - 1]).toBe(0);
    expect(s.extra.mean[y36]).toBe(40);
    expect(s.extra.mean[12]).toBe(47);
  });

  const planOf = (rf: Int32Array): SimInput => ({
    ...base,
    regimes: same.plan,
    reservedFrom: rf
  });
  /**
   * A candidate row and day where the plan arm keeps the reservation in some seeds and voids it in
   * others; `kept[i]` is seed bandSeed(i)'s verdict.
   */
  function findMixedReservation(): { row: number; rf: Int32Array; kept: boolean[] } {
    for (const day of [dayOf(2030, 1, 1), dayOf(2034, 1, 1), dayOf(2040, 1, 1)]) {
      for (const row of pre.candidates) {
        const rf = new Int32Array(n);
        rf[row] = day;
        const kept = Array.from({ length: SEEDS }, (_, i) =>
          keptIn(planOf(rf), bandSeed(i)).get(row)!
        );
        if (kept.some((k) => k) && kept.some((k) => !k)) return { row, rf, kept };
      }
    }
    throw new Error('no candidate row is kept in some seeds and voided in others');
  }

  it('a voided conversion has no build in that seed', () => {
    const { row, rf, kept } = findMixedReservation();
    expect(kept).toContain(false);
    const build = parking(row, 30, dayOf(2045, 1, 1));
    const r = pairs(same, rf, [build]);
    const id = base.parcels.id[row];
    for (const [i, p] of r.perSeed.entries()) {
      const free = simulate({ ...base, regimes: same.plan }, p.seed, H);
      const held = simulate(planOf(rf), p.seed, H);
      if (!kept[i]) {
        // no build, and the row runs exactly as in the unreserved plan run
        expect(held.filter((s) => s.parcelIds.includes(id))).toEqual(
          free.filter((s) => s.parcelIds.includes(id))
        );
        expect(Array.from(p.plan[PARKING])).toEqual(netOn(free, id));
      } else {
        const want = netOn(held, id).map((v, y) => v + buildNet([build])[y]);
        expect(Array.from(p.plan[PARKING])).toEqual(want);
      }
      const planTotal = engineTotal(planOf(rf), p.seed).map(
        (v, y) => v + (kept[i] ? buildNet([build])[y] : 0)
      );
      for (let y = 0; y < Y; y++) expect(totalOf(p.plan, y)).toBe(planTotal[y]);
    }
  });

  it('amenities add nothing: a plan with only street changes and bus lanes before the switch gives 0', () => {
    const plan: LessCarsPlan = {
      ...TINY_PLAN,
      projects: TINY_PLAN.projects
        .filter((p) => p.kind === 'street-change' || p.kind === 'bus-lane')
        .map((p) => ({ ...p, startYear: 2028 }))
    };
    expect(plan.projects.map((p) => p.kind).sort()).toEqual(['bus-lane', 'street-change']);
    const s = schedulePlan(plan);
    const rf = reservationsOf(plan, s, base.parcels);
    expect(rf.some((d) => d !== 0)).toBe(false);
    const rows = {
      siteRowAt: (): EnvelopeRow => {
        throw new Error('no site');
      },
      parcelRowAt: (): EnvelopeRow => {
        throw new Error('no parcel');
      }
    };
    const builds = initiativeBuilds(plan, s, [], base.parcels, rows);
    expect(builds).toEqual([]);
    // the bus lanes move no lot's SB 79 standard here, so the plan regime is the baseline's
    const r = pairs(same, rf, builds);
    const sum = summarise(r, meta(same));
    const zeros = new Array(Y).fill(0);
    expect(sum.extra.mean).toEqual(zeros);
    for (const k of SOURCES) expect(sum.bySource[k]).toEqual(zeros);
  });

  it('runPairs is deterministic', () => {
    const rf = new Int32Array(n);
    rf[pre.candidates[2]] = dayOf(2033, 1, 1);
    const builds = [freed(12, dayOf(2040, 1, 1)), parking(pre.candidates[2], 9, dayOf(2036, 1, 1))];
    expect(pairs(richer, rf, builds, 5)).toEqual(pairs(richer, rf, builds, 5));
  });

  it('representativeSeed is the median-difference pair', () => {
    const r = pairs(richer, none, []);
    const s = summarise(r, meta(richer));
    const finals = r.perSeed.map((p) => totalOf(p.plan, Y - 1) - totalOf(p.baseline, Y - 1));
    expect(s.representativeSeed).toBe(bandSeed(representativeIndex(finals)));
    const sorted = [...finals].sort((a, b) => a - b);
    expect(s.extra.p50[Y - 1]).toBe(nearestRank(sorted, 0.5));
    expect(s.extra.p10[Y - 1]).toBe(nearestRank(sorted, 0.1));
    expect(s.extra.p90[Y - 1]).toBe(nearestRank(sorted, 0.9));
    const rep = r.perSeed.find((p) => p.seed === s.representativeSeed)!;
    expect(totalOf(rep.plan, Y - 1) - totalOf(rep.baseline, Y - 1)).toBe(s.extra.p50[Y - 1]);
    // means: plan and baseline, and the source sums
    const planSum = r.perSeed.reduce((a, p) => a + totalOf(p.plan, Y - 1), 0);
    expect(s.plan[Y - 1]).toBe(planSum / SEEDS);
    expect(s.yearEnds).toEqual(YE);
    expect(s.provenance.n).toBe(SEEDS);
  });

  it('representativeTimeline is the plan arm of the seed with the builds kept there', () => {
    const rf = new Int32Array(n);
    for (const i of pre.candidates.slice(0, 6)) rf[i] = dayOf(2034, 1, 1);
    const builds = [
      freed(40, dayOf(2038, 6, 1)),
      ...Array.from(pre.candidates.slice(0, 6), (i) => parking(i, 20, dayOf(2037, 1, 1)))
    ];
    const seed = 3;
    const t = representativeTimeline({
      base,
      regimes: richer,
      reservedFrom: rf,
      builds,
      seed,
      horizon: H,
      datasetVersion: 'fixture-60'
    });
    const planIn: SimInput = { ...base, regimes: richer.plan, reservedFrom: rf };
    expect(t.schedules).toEqual(simulateDetailed(planIn, seed, H).schedules);
    const kept = keptIn(planIn, seed);
    expect(t.builds).toEqual(builds.filter((b) => b.parcelRow === null || kept.get(b.parcelRow)));
    expect(t.builds[0]).toEqual(builds[0]);
    expect(t.builds.length).toBeGreaterThan(1);
    expect(t).toMatchObject({ seed, count: n, idsHash: idsHash(base.parcels.id) });
  });

  it('representativeTimeline records every reserved row, kept and voided', () => {
    const { row, rf, kept } = findMixedReservation();
    const other = pre.candidates.find((r) => r !== row)!;
    rf[other] = dayOf(2034, 1, 1); // a second reserved row, so the column has more than one entry
    const tl = (i: number) =>
      representativeTimeline({
        base,
        regimes: same,
        reservedFrom: rf,
        builds: [],
        seed: bandSeed(i),
        horizon: H,
        datasetVersion: 'fixture-0'
      });
    const voided = tl(kept.indexOf(false));
    expect(voided.reservations.map((r) => r.row)).toEqual([row, other].sort((a, b) => a - b));
    expect(voided.reservations.find((r) => r.row === row)?.kept).toBe(false);
    expect(tl(kept.indexOf(true)).reservations.find((r) => r.row === row)?.kept).toBe(true);
  });

  it('reservationsOf: conversion clearance start; garage on a parcel its start; on freed land none', () => {
    const plan = miniLessCarsPlan();
    const s = schedulePlan(plan);
    const ids = ['3512001', '3512015', '3512017'];
    const parcels = { count: ids.length, index: new Map(ids.map((id, i) => [id, i])) };
    const rf = reservationsOf(plan, s, parcels);
    expect(Array.from(rf)).toEqual([
      0,
      s.times.get('garage')!.startDay,
      s.times.get('parking')!.startDay
    ]);
    // the conversion's clearance start, not its build start
    expect(rf[2]).not.toBe(s.times.get('parking')!.build!.startDay);
    const onFreed: LessCarsPlan = {
      ...plan,
      projects: plan.projects.map((p) =>
        p.kind === 'edge-garage' ? { ...p, site: { project: 'hwy' } } : p
      )
    };
    expect(reservationsOf(onFreed, s, parcels)[1]).toBe(0);
    expect(() => reservationsOf(plan, s, { count: 1, index: new Map([['3512001', 0]]) })).toThrow(
      /3512015/
    );
  });

  it('sourceOfRows: reserved rows are parking, then transit-unlocked, else other', () => {
    const rf = Int32Array.from([0, 5, 0, 7]);
    const un = Uint8Array.from([1, 1, 0, 0]);
    expect(Array.from(sourceOfRows(4, rf, un))).toEqual([
      TRANSIT_UNLOCKED,
      PARKING,
      OTHER,
      PARKING
    ]);
  });

  it('initiativeBuilds: freed builds per site and the parking build at its build start', () => {
    const plan = miniLessCarsPlan();
    const s = schedulePlan(plan);
    const ids = ['3512001', '3512015', '3512017'];
    const parcels = {
      count: 3,
      index: new Map(ids.map((id, i) => [id, i])),
      existingUnits: Uint16Array.from([0, 0, 2])
    };
    const asked: string[] = [];
    const row = (stories: number, top: number): EnvelopeRow => ({
      stories,
      cap: null,
      yield: [1, 2, 3, top].slice(-F),
      hostable: true
    });
    const rows = {
      siteRowAt: (id: string, day: Day) => {
        asked.push(`${id}@${day}`);
        return id === 'lc:hwy:1' ? row(0, 0) : row(6, 50);
      },
      parcelRowAt: (r: number, day: Day) => {
        asked.push(`${r}@${day}`);
        return row(4, 21);
      }
    };
    const sites = [
      { siteId: 'lc:hwy:0', projectId: 'hwy', heldBy: null },
      { siteId: 'lc:hwy:1', projectId: 'hwy', heldBy: null }
    ];
    const hwy = s.times.get('hwy')!.build!;
    const park = s.times.get('parking')!.build!;
    const out = initiativeBuilds(plan, s, sites, parcels, rows);
    expect(out).toEqual([
      {
        siteId: 'lc:hwy:0',
        projectId: 'hwy',
        parcelRow: null,
        units: 50,
        stories: 6,
        existing: 0,
        startDay: hwy.startDay,
        completeDay: hwy.completeDay
      },
      {
        siteId: '3512017',
        projectId: 'parking',
        parcelRow: 2,
        units: 21,
        stories: 4,
        existing: 2,
        startDay: park.startDay,
        completeDay: park.completeDay
      }
    ]);
    // the zero-yield site is asked and dropped; rows are read at each build's start
    expect(asked).toEqual([
      `lc:hwy:0@${hwy.startDay}`,
      `lc:hwy:1@${hwy.startDay}`,
      `2@${park.startDay}`
    ]);
  });

  describe('held sites', () => {
    const plan = miniLessCarsPlan();
    const s = schedulePlan(plan);
    const ids = ['3512001', '3512015', '3512017'];
    const parcels = {
      count: 3,
      index: new Map(ids.map((id, i) => [id, i])),
      existingUnits: Uint16Array.from([0, 0, 2])
    };
    const row = (stories: number, top: number): EnvelopeRow => ({
      stories,
      cap: null,
      yield: [1, 2, 3, top].slice(-F),
      hostable: true
    });
    const freed = { siteId: 'lc:hwy:2', projectId: 'hwy', heldBy: null };
    const held = { siteId: 'lc:hwy:1', projectId: 'hwy', heldBy: 'garage' };
    const asked: string[] = [];
    const rows = {
      siteRowAt: (id: string, day: Day) => {
        asked.push(`${id}@${day}`);
        return id === held.siteId ? row(5, 37) : row(6, 50);
      },
      parcelRowAt: () => row(4, 21)
    };

    it('a site held by a garage gets no build and its homes are the garage’s cost', () => {
      const hwy = s.times.get('hwy')!.build!;
      const builds = initiativeBuilds(plan, s, [freed, held], parcels, rows);
      expect(builds.filter((b) => b.projectId === 'hwy').map((b) => b.siteId)).toEqual([
        freed.siteId
      ]);
      asked.length = 0;
      expect(garageCosts(plan, s, [freed, held], rows)).toEqual([
        { projectId: 'garage', homes: 37 }
      ]);
      // read at the holding project's build start: the row initiativeBuilds would have built
      expect(asked).toEqual([`${held.siteId}@${hwy.startDay}`]);
    });

    it('garageCosts: the open day without a build; sums per garage; none held, none listed', () => {
      const noBuild: LessCarsPlan = {
        ...plan,
        projects: plan.projects.map((p) =>
          p.kind === 'highway-truncation' ? { ...p, build: null } : p
        )
      };
      const sNo = schedulePlan(noBuild);
      const open = sNo.times.get('hwy')!.openDay;
      asked.length = 0;
      const two = [held, { ...held, siteId: 'lc:hwy:3' }];
      expect(garageCosts(noBuild, sNo, two, rows)).toEqual([{ projectId: 'garage', homes: 87 }]);
      expect(asked).toEqual([`lc:hwy:1@${open}`, `lc:hwy:3@${open}`]);
      expect(garageCosts(plan, s, [freed], rows)).toEqual([]);
    });
  });
});

describe('market pass-through', () => {
  it('planInput and baselineInput keep base.market', () => {
    const g = goldenInput();
    const withMarket = buildSimInput({
      parcels: g.parcels,
      projects: { asOf: g.asOf, projects: g.projects, districtMaxStories: null } as never,
      calibration: { ...g.calibration, market: miniMarket() }
    });
    expect(withMarket.market).toEqual([{ from: g.asOf, logOdds: miniMarket().today.all }]);
    expect(planInput(withMarket, same, none).market).toBe(withMarket.market);
    expect(baselineInput(withMarket, same).market).toBe(withMarket.market);
  });

  // Deterministic and paired, under today's market and a later step: the arms differ only where
  // the plan differs (here, reserved rows); every other row draws the same projects in both.
  it('pairing holds under market steps: only reserved rows differ between the arms', () => {
    const market = [
      { from: base.asOf, logOdds: -0.693147 },
      { from: dayOf(2031, 1, 1), logOdds: -1.2 }
    ];
    const mb: SimInput = { ...base, market };
    const run = (rf: Int32Array, input: SimInput = mb) =>
      runPairs({
        base: input,
        regimes: same,
        reservedFrom: rf,
        builds: [],
        source: sourceOfRows(n, rf, new Uint8Array(n)),
        seeds: SEEDS,
        yearEnds: YE,
        horizon: H
      });
    // no reservation: the arms are identical, seed for seed
    for (const p of run(none).perSeed) expect(p.plan).toEqual(p.baseline);
    // the market moves the runs (the check is not vacuous)
    const unshifted = run(none, base).perSeed.map((p) => totalOf(p.baseline, Y - 1));
    expect(run(none).perSeed.map((p) => totalOf(p.baseline, Y - 1))).not.toEqual(unshifted);
    // reserve every other candidate from 2030: only the parking source may differ
    const rf = new Int32Array(n);
    pre.candidates.forEach((i, c) => {
      if (c % 2 === 0) rf[i] = dayOf(2030, 1, 1);
    });
    let parkingDiffers = 0;
    for (const p of run(rf).perSeed) {
      for (const k of [FREED, TRANSIT_UNLOCKED, OTHER])
        expect(Array.from(p.plan[k])).toEqual(Array.from(p.baseline[k]));
      if (p.plan[PARKING].some((v, y) => v !== p.baseline[PARKING][y])) parkingDiffers++;
    }
    expect(parkingDiffers).toBeGreaterThan(0);
  });
});
