import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS } from '$lib/data/scenario-codec';
import { NULL_CAP } from '$lib/data/policy-codec';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { miniPolicy } from '../scenario/fixtures/mini-policy';
import { needKey, type Need } from './resolve';
import { createYieldRecompute, type GrossCache } from './recompute';

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
const clock = () => {
  let t = 0;
  return () => (t += 1);
};
const idOf = (n: Need) => P.id[n.row] as ParcelId;

describe('createYieldRecompute', () => {
  it('reproduces parcels.bin yield and hostable at the FZP stories and cap', () => {
    const needs = fzpNeeds();
    const r = createYieldRecompute(P, needs, { record: all, now: clock() }, new Map());
    expect(r.step(1e9)).toBe(true);
    expect(r.done).toBe(needs.length);
    for (const n of needs) {
      const e = r.result().get(needKey(n))!;
      expect(e.yield).toEqual(Array.from(P.yield.subarray(n.row * F, n.row * F + F)));
      expect(e.hostable).toBe(P.hostable[n.row] === 1);
    }
  });

  it('gives the same result map whatever order records arrive in', () => {
    const needs = fzpNeeds().slice(0, 12);
    const ids = needs.map(idOf);
    const orders = [ids, [...ids].reverse(), [...ids.slice(6), ...ids.slice(0, 6)]];
    const outcomes = orders.map((seq) => {
      const avail = new Set<ParcelId>();
      const rc = createYieldRecompute(
        P,
        needs,
        { record: (id) => (avail.has(id) ? city.records.get(id) : undefined), now: clock() },
        new Map()
      );
      for (const id of seq) {
        avail.add(id);
        rc.step(1e9);
      }
      expect(rc.step(1e9)).toBe(true);
      return [...rc.result()].sort(([a], [b]) => (a < b ? -1 : 1));
    });
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  });

  it('lists only the cells of needs with no record yet', () => {
    const needs = fzpNeeds();
    const have = new Set(needs.filter((n) => P.cell[n.row] === 0).map(idOf));
    const r = createYieldRecompute(
      P,
      needs,
      { record: (id) => (have.has(id) ? city.records.get(id) : undefined), now: clock() },
      new Map()
    );
    const want = P.cells.map((c) => c.cellId).filter((_, k) => k !== 0);
    expect(r.cellsNeeded().sort()).toEqual(want.sort());
    expect(r.step(1e9)).toBe(false);
    expect(r.done).toBeLessThan(r.total);
  });

  it('computes at least one ready need per step on a zero budget', () => {
    const needs = fzpNeeds().slice(0, 5);
    const r = createYieldRecompute(P, needs, { record: all, now: clock() }, new Map());
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
      createYieldRecompute(P, fzpNeeds(), { record: all, now: clock() }, cache).step(1e9);
    run();
    const first = (cache as Counting).sets;
    expect(first).toBeGreaterThan(0);
    run();
    expect((cache as Counting).sets).toBe(first);
  });
});
