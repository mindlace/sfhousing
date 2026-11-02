// lesscars plan 1 Task 4: the retired law switch generalised to K dated regimes (a project keeps
// the regime of the month it initiated in), and dated parcel reservations (`reservedFrom`).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { log } from '$lib/timelapse/math';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import { dayOf } from './dates';
import { runEngine } from './engine';
import golden from './fixtures/golden-seed1.json';
import { piecewiseMonth, precomputeOf, regimeMonths } from './input';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { simulate, simulateDetailed } from './simulate';
import type { Schedule, SimInput } from './types';

const H = GOLDEN_HORIZON;
const MID = dayOf(2032, 1, 31);
const LATE = dayOf(2040, 6, 1);
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const base = goldenInput();

/** A copy of the base parcels with `edit` applied to fresh copies of the columns it names. */
function viewOf(edit: (p: ScenarioParcels) => void): ScenarioParcels {
  const p: ScenarioParcels = {
    ...base.parcels,
    hostable: base.parcels.hostable.slice(),
    yield: base.parcels.yield.slice()
  };
  edit(p);
  return p;
}

/** No hostable row: every hazard is 0. */
const closed = viewOf((p) => p.hostable.fill(0));
/** Every positive yield doubled. */
const doubled = viewOf((p) => {
  for (let j = 0; j < p.yield.length; j++) p.yield[j] *= 2;
});

/** The initiation month T (from `r`) that contains `d`. */
function monthOf(r: Day, d: Day): number {
  let T = 1;
  while (r + 1 + Math.floor(T * MONTH_DAYS) <= d) T++;
  return T;
}

const startDay = (s: Schedule): Day => s.revisions[0].day;

/** The simulated schedules on lot `id`, by k, with the day each was at risk from. */
function onLot(
  ss: Schedule[],
  id: ParcelId,
  asOf: Day,
  held: Day | null
): { s: Schedule; r: Day }[] {
  const mine = ss
    .filter((s) => s.origin === 'simulated' && s.parcelIds[0] === id)
    .sort((a, b) => Number(a.projectId.split(':')[2]) - Number(b.projectId.split(':')[2]));
  let r = held === null ? asOf : Math.max(asOf, held);
  return mine.map((s) => {
    const out = { s, r };
    if (s.end.kind === 'exit') r = s.end.day;
    return out;
  });
}

/** Each simulated schedule with the day its lot was at risk from (pipeline exits included). */
function withRisk(input: SimInput, ss: Schedule[]): { s: Schedule; r: Day }[] {
  const lastExit = new Map<ParcelId, Day>();
  for (const s of ss) {
    if (s.origin !== 'pipeline' || s.end.kind !== 'exit') continue;
    for (const id of s.parcelIds) lastExit.set(id, Math.max(lastExit.get(id) ?? 0, s.end.day));
  }
  const ids = new Set(ss.filter((s) => s.origin === 'simulated').map((s) => s.parcelIds[0]));
  return [...ids].flatMap((id) => onLot(ss, id, input.asOf, lastExit.get(id) ?? null));
}

/** The view index month T from `r` runs on. */
function viewAt(r: Day, days: Day[], T: number): number {
  const b = regimeMonths(r, days);
  let j = 0;
  while (j < b.length && b[j] < T) j++;
  return j;
}

const strip = (ss: Schedule[]) => ss.map(({ regime: _, ...s }) => s);

/** Rows no in-flight project (or phase) names. */
function freeRows(input: SimInput): Set<number> {
  const held = new Set<ParcelId>();
  for (const p of input.projects) {
    for (const id of p.parcelIds) held.add(id);
    for (const ph of p.phases ?? []) for (const id of ph.parcelIds) held.add(id);
  }
  const out = new Set<number>();
  for (let i = 0; i < input.parcels.count; i++) if (!held.has(input.parcels.id[i])) out.add(i);
  return out;
}

/** One run's schedules (simulate order) and its reservation calls by row. */
function runWith(input: SimInput, seed: number) {
  const calls = new Map<number, boolean[]>();
  let n = 0;
  runEngine(input, seed, H, {
    schedule() {
      n++;
    },
    master() {},
    reservation(row, kept) {
      calls.set(row, [...(calls.get(row) ?? []), kept]);
    }
  });
  return { schedules: simulate(input, seed, H), calls, n };
}

describe('engine regimes', () => {
  it('no regimes, no reservedFrom: equals the golden', () => {
    const now = JSON.parse(JSON.stringify(simulateDetailed(goldenInput(), 1, H).schedules));
    expect(now).toEqual(golden.schedules);
  });

  it('one regime whose view is the base parcels: same schedules, each simulated one tagged', () => {
    const input: SimInput = { ...base, regimes: [{ day: MID, parcels: { ...base.parcels } }] };
    let pre = 0;
    let post = 0;
    for (const seed of seeds(20)) {
      const was = simulate(base, seed, H);
      const now = simulate(input, seed, H);
      expect(strip(now)).toEqual(was);
      for (const s of now) if (s.origin === 'pipeline') expect(s.regime).toBeUndefined();
      for (const { s, r } of withRisk(input, now)) {
        const want = viewAt(r, [MID], monthOf(r, startDay(s)));
        expect(s.regime).toBe(want);
        if (want === 1) post++;
        else pre++;
      }
    }
    expect(pre).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(0);
  });

  it('a regime with every hazard 0 stops initiations from its first month, seeds 1-20', () => {
    const input: SimInput = { ...base, regimes: [{ day: MID, parcels: closed }] };
    let sims = 0;
    for (const seed of seeds(20)) {
      const ss = simulate(input, seed, H);
      for (const { s, r } of withRisk(input, ss)) {
        expect(monthOf(r, startDay(s))).toBeLessThanOrEqual(regimeMonths(r, [MID])[0]);
        expect(startDay(s)).toBeLessThan(MID + 31);
        expect(s.regime).toBe(0);
        sims++;
      }
    }
    expect(sims).toBeGreaterThan(0);
  });

  it('two regimes reduce to one when the second view equals the first', () => {
    const one: SimInput = { ...base, regimes: [{ day: MID, parcels: doubled }] };
    const two: SimInput = {
      ...base,
      regimes: [
        { day: MID, parcels: doubled },
        { day: LATE, parcels: doubled }
      ]
    };
    let tagged2 = 0;
    for (const seed of seeds(20)) {
      const a = simulate(one, seed, H);
      const b = simulate(two, seed, H);
      expect(strip(b)).toEqual(strip(a));
      tagged2 += b.filter((s) => s.regime === 2).length;
    }
    expect(tagged2).toBeGreaterThan(0);
  });

  it('piecewiseMonth: one segment, an empty -Infinity segment, all-zero rates', () => {
    const L = log(1 - 0.37);
    const l = log(1 - 0.02);
    expect(piecewiseMonth(L, [], [l])).toBe(Math.max(1, Math.ceil(L / l)));
    // an empty first segment (bound 0) with l = -Infinity adds nothing: no NaN
    expect(piecewiseMonth(L, [0], [-Infinity, l])).toBe(Math.max(1, Math.ceil(L / l)));
    expect(piecewiseMonth(L, [5, 9], [0, 0, 0])).toBe(0);
  });

  it('piecewiseMonth walks segments with the accumulated log-survival', () => {
    const l1 = log(1 - 0.01);
    const l2 = log(1 - 0.2);
    const L = log(1 - 0.5);
    // L/l1 ≈ 69 > 10, so it lands in the second segment
    expect(piecewiseMonth(L, [10], [l1, l2])).toBe(10 + Math.max(1, Math.ceil((L - 10 * l1) / l2)));
    // a zero-hazard middle segment shifts the draw by its length
    expect(piecewiseMonth(L, [10, 30], [l1, 0, l2])).toBe(
      30 + Math.max(1, Math.ceil((L - 10 * l1) / l2))
    );
  });

  it('skipAbove never skips a parcel that initiates by the horizon, 3 regimes, seeds 1-50', () => {
    const regimes = [
      { day: MID, parcels: closed },
      { day: dayOf(2036, 3, 1), parcels: doubled },
      { day: LATE, parcels: closed }
    ];
    const input: SimInput = { ...base, regimes };
    const forced: SimInput = { ...base, regimes };
    const pre = precomputeOf(forced);
    pre.skipAbove = () => new Float64Array(pre.candidates.length).fill(Infinity);
    let sims = 0;
    for (const seed of seeds(50)) {
      const a = simulate(input, seed, H);
      expect(a).toEqual(simulate(forced, seed, H));
      sims += a.filter((s) => s.origin === 'simulated').length;
    }
    expect(sims).toBeGreaterThan(0);
  });

  it('candidates are the union of every view', () => {
    const only = viewOf((p) => p.hostable.fill(1));
    const input: SimInput = { ...base, regimes: [{ day: MID, parcels: only }] };
    const a = new Set(precomputeOf(base).candidates);
    const u = new Set(precomputeOf(input).candidates);
    const b = precomputeOf(input).regimes[0].candidates;
    for (const i of a) expect(u.has(i)).toBe(true);
    for (const i of b) expect(u.has(i)).toBe(true);
    expect(u.size).toBe(new Set([...a, ...b]).size);
    expect(precomputeOf(base).regimes).toEqual([]);
  });

  it('reservedFrom: kept, voided by an active project, kept after an exit, seeds 1-50', () => {
    const pre = precomputeOf(base);
    const free = freeRows(base);
    const d = LATE;
    const reservedFrom = new Int32Array(base.parcels.count);
    for (const i of pre.candidates) reservedFrom[i] = d;
    // a non-candidate row is reported too
    const nonCandidate = [...free].find((i) => !pre.candidates.includes(i))!;
    reservedFrom[nonCandidate] = d;
    const input: SimInput = { ...base, reservedFrom };
    const idRow = (id: ParcelId) => base.parcels.index.get(id)!;
    let kept = 0;
    let voided = 0;
    let keptAfterExit = 0;
    let cut = 0;
    for (const seed of seeds(50)) {
      const was = simulate(base, seed, H);
      const now = runWith(input, seed);
      // each reserved row reported exactly once, no other row
      for (let i = 0; i < reservedFrom.length; i++) {
        if (reservedFrom[i] > 0) expect(now.calls.get(i)?.length).toBe(1);
        else expect(now.calls.has(i)).toBe(false);
      }
      expect(now.calls.get(nonCandidate)).toEqual([true]);
      // the expected run: the unreserved one less the kept rows' initiations on or after d
      const keptRow = (i: number) => now.calls.get(i)?.[0] === true;
      const want = was.filter(
        (s) =>
          !(
            s.origin === 'simulated' &&
            reservedFrom[idRow(s.parcelIds[0])] > 0 &&
            keptRow(idRow(s.parcelIds[0])) &&
            startDay(s) >= d
          )
      );
      cut += was.length - want.length;
      expect(now.schedules).toEqual(want);
      expect(now.n).toBe(want.length);
      // on free rows the verdict follows the rule from the unreserved run's schedules
      for (const i of pre.candidates) {
        if (!free.has(i)) continue;
        const mine = was.filter(
          (s) => s.origin === 'simulated' && s.parcelIds[0] === base.parcels.id[i]
        );
        const active = mine.some(
          (s) => startDay(s) < d && (s.end.kind !== 'exit' || s.end.day >= d)
        );
        expect(keptRow(i)).toBe(!active);
        if (active) voided++;
        else {
          kept++;
          if (mine.some((s) => s.end.kind === 'exit' && s.end.day < d)) keptAfterExit++;
        }
      }
    }
    expect(kept).toBeGreaterThan(0);
    expect(voided).toBeGreaterThan(0);
    expect(keptAfterExit).toBeGreaterThan(0);
    expect(cut).toBeGreaterThan(0);
  });

  it('a pipeline-held row with lastExit >= d is voided; a blocked row is voided', () => {
    const ss = simulate(base, 1, H);
    const single = ss.filter((s) => s.origin === 'pipeline' && s.parcelIds.length === 1);
    const exited = single.find((s) => s.end.kind === 'exit' && s.end.day > base.asOf + 1)!;
    const done = single.find((s) => s.end.kind === 'complete')!;
    expect(exited).toBeDefined();
    expect(done).toBeDefined();
    const rowOf = (s: Schedule) => base.parcels.index.get(s.parcelIds[0])!;
    const holders = (i: number) =>
      ss.filter((s) => s.origin === 'pipeline' && s.parcelIds.includes(base.parcels.id[i])).length;
    const x = (exited.end as { day: Day }).day;
    const verdict = (row: number, day: Day) => {
      const reservedFrom = new Int32Array(base.parcels.count);
      reservedFrom[row] = day;
      return runWith({ ...base, reservedFrom }, 1).calls.get(row);
    };
    expect(verdict(rowOf(exited), x)).toEqual([false]);
    expect(verdict(rowOf(exited), x - 1)).toEqual([false]);
    if (holders(rowOf(exited)) === 1) {
      // exited the day before d, nothing else on it: kept (unless a simulated project was active)
      const after = simulate(base, 1, H).filter(
        (s) =>
          s.origin === 'simulated' &&
          s.parcelIds[0] === exited.parcelIds[0] &&
          startDay(s) < x + 1 &&
          (s.end.kind !== 'exit' || s.end.day >= x + 1)
      );
      expect(verdict(rowOf(exited), x + 1)).toEqual([after.length === 0]);
    }
    expect(verdict(rowOf(done), dayOf(2049, 1, 1))).toEqual([false]);
  });

  it('a Sink without reservation ignores reservedFrom calls', () => {
    const reservedFrom = new Int32Array(base.parcels.count).fill(LATE);
    const input: SimInput = { ...base, reservedFrom };
    expect(() => simulate(input, 3, H)).not.toThrow();
  });

  it('throws RangeError on a bad regime day, unsorted days, a short view or bad reservedFrom', () => {
    const at = (day: Day) => ({ day, parcels: doubled });
    const bad: SimInput[] = [
      { ...base, regimes: [at(base.asOf)] },
      { ...base, regimes: [at(LATE), at(MID)] },
      { ...base, regimes: [at(MID), at(MID)] },
      { ...base, regimes: [{ day: MID, parcels: { ...doubled, count: doubled.count - 1 } }] },
      { ...base, reservedFrom: new Int32Array(base.parcels.count - 1) },
      { ...base, reservedFrom: new Int32Array(base.parcels.count).fill(base.asOf) }
    ];
    for (const input of bad) expect(() => simulate(input, 1, H)).toThrow(RangeError);
  });
});
