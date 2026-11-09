import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, scenarioRecordOf, type ScenarioParcels } from '$lib/data/scenario-codec';
import { NULL_CAP } from '$lib/data/policy-codec';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { miniPolicy } from '../scenario/fixtures/mini-policy';
import { needKey, type Need } from './resolve';
import { createTableRecompute, createYieldRecompute, type GrossCache } from './recompute';
import { grossRowOf, grossTableOf } from '$lib/data/gross-table';

const city = miniCity();
const policy = miniPolicy(city);
const P = city.parcels;
const F = FILL_LEVELS.length;
const fzpNeeds = (): Need[] =>
  Array.from({ length: P.count }, (_, row) => ({
    row,
    stories: P.envelopeStories[row],
    cap: policy.fzpYieldCap[row] === NULL_CAP ? null : policy.fzpYieldCap[row]
  }));
const all = (id: ParcelId) => city.records.get(id);
const loaded = () => true;
const clock = () => {
  let t = 0;
  return () => (t += 1);
};
const idOf = (n: Need) => P.id[n.row] as ParcelId;

describe('createYieldRecompute', () => {
  it('reproduces parcels.bin yield and hostable at the FZP stories and cap', () => {
    const needs = fzpNeeds();
    const r = createYieldRecompute(
      P,
      needs,
      { record: all, cellLoaded: loaded, now: clock() },
      new Map()
    );
    expect(r.step(1e9)).toBe(true);
    expect(r.done).toBe(needs.length);
    for (const n of needs) {
      const e = r.result().get(needKey(n))!;
      expect(e.yield).toEqual(Array.from(P.yield.subarray(n.row * F, n.row * F + F)));
      expect(e.hostable).toBe(P.hostable[n.row] === 1);
    }
  });

  it('clamps a gross above 0xFFFF before it reaches a yield', () => {
    const row = Array.from({ length: P.count }, (_, i) => i).find((i) => P.eligible[i] === 1)!;
    const need: Need = { row, stories: 4, cap: null };
    const cache: GrossCache = new Map();
    const r = createYieldRecompute(
      P,
      [need],
      { record: all, cellLoaded: loaded, now: clock(), grossOf: () => 162_730 },
      cache
    );
    expect(r.step(1e9)).toBe(true);
    expect(r.result().get(needKey(need))!.yield).toEqual([65535, 65535, 65535, 65535, 65535]);
    expect(cache.get(`${row}:4`)).toBe(65535);
  });

  it('gives the same result map whatever order cells arrive in', () => {
    const needs = fzpNeeds();
    const cells = P.cells.map((c) => c.cellId);
    const orders = [cells, [...cells].reverse(), [...cells.slice(2), ...cells.slice(0, 2)]];
    const outcomes = orders.map((seq) => {
      const avail = new Set<string>();
      const cellOfId = (id: ParcelId) => P.cells[P.cell[P.index.get(id)!]].cellId;
      const rc = createYieldRecompute(
        P,
        needs,
        {
          record: (id) => (avail.has(cellOfId(id)) ? city.records.get(id) : undefined),
          cellLoaded: (c) => avail.has(c),
          now: clock()
        },
        new Map()
      );
      for (const c of seq) {
        avail.add(c);
        rc.step(1e9);
      }
      expect(rc.step(1e9)).toBe(true);
      expect(rc.missing).toEqual([]);
      return [...rc.result()].sort(([a], [b]) => (a < b ? -1 : 1));
    });
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  });

  it('lists only the cells of needs not yet loaded', () => {
    const needs = fzpNeeds();
    const have = new Set(needs.filter((n) => P.cell[n.row] === 0).map(idOf));
    const r = createYieldRecompute(
      P,
      needs,
      {
        record: (id) => (have.has(id) ? city.records.get(id) : undefined),
        cellLoaded: (c) => c === P.cells[0].cellId,
        now: clock()
      },
      new Map()
    );
    const want = P.cells.map((c) => c.cellId).filter((_, k) => k !== 0);
    expect(r.cellsNeeded().sort()).toEqual(want.sort());
    expect(r.step(1e9)).toBe(false);
    expect(r.done).toBeLessThan(r.total);
  });

  it('computes at least one ready need per step on a zero budget', () => {
    const needs = fzpNeeds().slice(0, 5);
    const r = createYieldRecompute(
      P,
      needs,
      { record: all, cellLoaded: loaded, now: clock() },
      new Map()
    );
    expect(r.step(0)).toBe(false);
    expect(r.done).toBe(1);
  });

  it('a shared GrossCache makes no new gross computations', () => {
    class Counting extends Map<string, number> {
      sets = 0;
      override set(k: string, v: number) {
        this.sets++;
        return super.set(k, v);
      }
    }
    const cache: GrossCache = new Counting();
    const run = () =>
      createYieldRecompute(
        P,
        fzpNeeds(),
        { record: all, cellLoaded: loaded, now: clock() },
        cache
      ).step(1e9);
    run();
    const first = (cache as Counting).sets;
    expect(first).toBeGreaterThan(0);
    run();
    expect((cache as Counting).sets).toBe(first);
  });

  it('bucketed step: reads each record about once, not once per need per step', () => {
    const CELLS = 100;
    const PER = 100;
    const big = syntheticParcels(CELLS, PER);
    const needs: Need[] = Array.from({ length: CELLS * PER }, (_, row) => ({
      row,
      stories: 0,
      cap: null
    }));
    const template = city.records.get(P.id[0] as ParcelId)!;
    const avail = new Set<string>();
    let calls = 0;
    const r = createYieldRecompute(
      big,
      needs,
      {
        record: (id) => {
          calls++;
          const row = big.index.get(id)!;
          return avail.has(big.cells[big.cell[row]].cellId) ? { ...template, id } : undefined;
        },
        cellLoaded: (c) => avail.has(c),
        now: clock()
      },
      new Map()
    );
    let steps = 0;
    for (const c of big.cells) {
      avail.add(c.cellId);
      r.step(1e9);
      steps++;
    }
    expect(r.done).toBe(r.total);
    expect(r.total).toBe(CELLS * PER);
    expect(calls).toBeLessThanOrEqual(r.total + CELLS * steps);
  });

  it('a budget break inside a cell resumes there: every need computed exactly once', () => {
    const CELLS = 3;
    const PER = 10;
    const big = syntheticParcels(CELLS, PER);
    const needs: Need[] = Array.from({ length: CELLS * PER }, (_, row) => ({
      row,
      stories: 0,
      cap: null
    }));
    const template = city.records.get(P.id[0] as ParcelId)!;
    const reads = new Map<ParcelId, number>();
    const r = createYieldRecompute(
      big,
      needs,
      {
        record: (id) => {
          reads.set(id, (reads.get(id) ?? 0) + 1);
          return { ...template, id };
        },
        cellLoaded: () => true,
        now: clock() // each call moves 1 ms, so a 4 ms budget breaks part-way through a cell
      },
      new Map()
    );
    const doneAfter: number[] = [];
    while (!r.step(4)) doneAfter.push(r.done);
    expect(doneAfter.some((d) => d % PER !== 0)).toBe(true); // at least one break mid-cell
    expect(r.done).toBe(r.total);
    expect(r.result().size).toBe(CELLS * PER);
    for (const n of needs) expect(r.result().has(needKey(n))).toBe(true);
    expect(reads.size).toBe(CELLS * PER);
    expect([...reads.values()].every((c) => c === 1)).toBe(true);
  });

  it('missing record: a loaded cell without a need record fills it with zeros', () => {
    const needs = fzpNeeds();
    const gone = idOf(needs[0]);
    const r = createYieldRecompute(
      P,
      needs,
      { record: (id) => (id === gone ? undefined : all(id)), cellLoaded: loaded, now: clock() },
      new Map()
    );
    expect(r.cellsNeeded()).toEqual([]);
    expect(r.step(1e9)).toBe(true);
    expect(r.missing).toEqual([gone]);
    expect(r.result().get(needKey(needs[0]))).toEqual({
      stories: needs[0].stories,
      cap: needs[0].cap,
      yield: Array.from({ length: F }, () => 0),
      hostable: false
    });
  });
});

const miniTable = () =>
  grossTableOf(
    'mini',
    Array.from({ length: P.count }, (_, row) => {
      const rec = city.records.get(P.id[row] as ParcelId);
      return grossRowOf(rec && scenarioRecordOf(P, row, rec));
    })
  );

describe('createTableRecompute', () => {
  it('needs no cells and reproduces parcels.bin at the FZP stories and cap', () => {
    const needs = fzpNeeds();
    const r = createTableRecompute(P, needs, miniTable(), { now: clock() });
    expect(r.cellsNeeded()).toEqual([]);
    expect(r.step(1e9)).toBe(true);
    expect(r.done).toBe(needs.length);
    expect(r.missing).toEqual([]);
    for (const n of needs) {
      const e = r.result().get(needKey(n))!;
      expect(e.yield).toEqual(Array.from(P.yield.subarray(n.row * F, n.row * F + F)));
      expect(e.hostable).toBe(P.hostable[n.row] === 1);
    }
  });

  it('honours the budget: one need per step when every need costs the budget', () => {
    const needs = fzpNeeds().slice(0, 4);
    const r = createTableRecompute(P, needs, miniTable(), { now: clock() });
    expect(r.total).toBe(4);
    expect(r.step(1)).toBe(false);
    expect(r.done).toBe(1);
    expect(r.step(1)).toBe(false);
    expect(r.done).toBe(2);
    expect(r.step(0)).toBe(false);
    expect(r.done).toBe(3);
    expect(r.step(1e9)).toBe(true);
    expect(r.done).toBe(4);
  });

  it('a table row above 0xFFFF stays 65535 through capScenarioYield', () => {
    const row = Array.from({ length: P.count }, (_, i) => i).find((i) => P.eligible[i] === 1)!;
    const t = grossTableOf(
      'big',
      Array.from({ length: P.count }, (_, i) =>
        i === row ? { first: 1, plateau: 1, values: [65535], clamped: 1 } : grossRowOf(undefined)
      )
    );
    const run = (cap: number | null) => {
      const n: Need = { row, stories: 4, cap };
      const r = createTableRecompute(P, [n], t, { now: clock() });
      r.step(1e9);
      return r.result().get(needKey(n))!.yield;
    };
    expect(run(null)).toEqual([65535, 65535, 65535, 65535, 65535]);
    expect(run(100)).toEqual([100, 100, 100, 100, 100]);
  });
});

/** `cells` × `per` rows, each cell `per` consecutive rows; only the columns the recompute reads. */
function syntheticParcels(cells: number, per: number): ScenarioParcels {
  const n = cells * per;
  const id = Array.from({ length: n }, (_, i) => `S${i}`);
  return {
    count: n,
    cells: Array.from({ length: cells }, (_, c) => ({
      cellId: `c${c}`,
      start: c * per,
      count: per
    })),
    id,
    index: new Map(id.map((v, i) => [v as ParcelId, i])),
    cell: Uint16Array.from({ length: n }, (_, i) => Math.floor(i / per)),
    eligible: new Uint8Array(n).fill(1),
    existingUnits: new Uint16Array(n),
    existingFloorAreaM2: new Uint32Array(n),
    existingStories: new Uint8Array(n)
  } as unknown as ScenarioParcels;
}
