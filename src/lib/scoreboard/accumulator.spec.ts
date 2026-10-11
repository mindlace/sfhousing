import { describe, expect, it } from 'vitest';
import { createScoreAccumulator, score, UNASSIGNED } from './accumulator';
import { M1_TARGETS } from './targets';
import type { Target } from './types';
import {
  aduBuilding,
  aduLot,
  building,
  nullLot,
  parcel,
  replBuilding,
  replLot,
  unassignedBuilding,
  unassignedLot,
  vacantBuilding,
  vacantLot
} from './score-fixtures';

const ONE: readonly Target[] = [
  { id: 't', label: 'T', units: 100, source: { label: 's', url: 'https://example.org' } }
];

describe('formulas (spec §4.1)', () => {
  it('ADU on a 1-unit lot: gross 1, demolished 0, net 1', () => {
    const s = score([[aduLot, aduBuilding]], ONE);
    expect(s).toMatchObject({ grossUnits: 1, demolishedUnits: 0, netUnits: 1, parcelsChanged: 1 });
    expect(s.byNeighborhood).toEqual({ Sunset: 1 });
  });

  it('replacement 9 over 1: net 8', () => {
    const s = score([[replLot, replBuilding]], ONE);
    expect(s).toMatchObject({ grossUnits: 9, demolishedUnits: 1, netUnits: 8 });
  });

  it('vacant replacement 2 over 0: net 2', () => {
    const s = score([[vacantLot, vacantBuilding]], ONE);
    expect(s).toMatchObject({ grossUnits: 2, demolishedUnits: 0, netUnits: 2 });
  });

  it('null building: no change', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(nullLot, null);
    expect(acc.snapshot()).toEqual({
      grossUnits: 0,
      demolishedUnits: 0,
      netUnits: 0,
      targets: [{ target: ONE[0], fraction: 0 }],
      parcelsChanged: 0,
      byNeighborhood: {}
    });
  });

  it('empty neighborhood (and whitespace-only) → "Unassigned"', () => {
    const blank = parcel('1000006', 0, '   ');
    const s = score(
      [
        [unassignedLot, unassignedBuilding],
        [blank, building(blank, 3, true)]
      ],
      ONE
    );
    expect(UNASSIGNED).toBe('Unassigned');
    expect(s.byNeighborhood).toEqual({ Unassigned: 7 });
  });

  it('totals over mixed parcels; neighborhoods sum net; absent when unchanged', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(aduLot, aduBuilding);
    acc.set(replLot, replBuilding);
    acc.set(vacantLot, vacantBuilding);
    acc.set(nullLot, null);
    const s = acc.snapshot();
    expect(s).toMatchObject({
      grossUnits: 12,
      demolishedUnits: 1,
      netUnits: 11,
      parcelsChanged: 3
    });
    expect(s.byNeighborhood).toEqual({ Mission: 10, Sunset: 1 });
    expect('Richmond' in s.byNeighborhood).toBe(false);
  });
});

describe('accumulator replace and remove', () => {
  it('set twice on the same parcel replaces rather than adds', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(replLot, replBuilding);
    acc.set(replLot, building(replLot, 5, true));
    expect(acc.snapshot()).toMatchObject({
      grossUnits: 5,
      demolishedUnits: 1,
      netUnits: 4,
      parcelsChanged: 1
    });
    expect(acc.snapshot().byNeighborhood).toEqual({ Mission: 4 });
  });

  it('set(p, null) removes the parcel and deletes the neighborhood key at zero parcels', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(aduLot, aduBuilding);
    acc.set(replLot, replBuilding);
    acc.set(aduLot, null);
    expect(acc.snapshot().byNeighborhood).toEqual({ Mission: 8 });
    acc.set(replLot, null);
    expect(acc.snapshot()).toMatchObject({
      grossUnits: 0,
      netUnits: 0,
      parcelsChanged: 0,
      byNeighborhood: {}
    });
  });

  it('set(p, null) on a never-set parcel is a no-op', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(aduLot, aduBuilding);
    const before = acc.snapshot();
    acc.set(nullLot, null);
    expect(acc.snapshot()).toEqual(before);
  });

  it('a neighborhood whose net sums to 0 stays present (count-based, defensive)', () => {
    const shrink = parcel('1000007', 5, 'Bayview');
    const acc = createScoreAccumulator(ONE);
    acc.set(shrink, building(shrink, 5, true)); // net 0; impossible under I8, handled anyway
    expect(acc.snapshot().byNeighborhood).toEqual({ Bayview: 0 });
  });

  it('negative net is carried, not clamped (defensive)', () => {
    const shrink = parcel('1000008', 10, 'Bayview');
    const s = score([[shrink, building(shrink, 4, true)]], ONE);
    expect(s.netUnits).toBe(-6);
    expect(s.targets[0].fraction).toBe(-0.06);
    expect(s.byNeighborhood).toEqual({ Bayview: -6 });
  });

  it('clear() resets everything', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(replLot, replBuilding);
    acc.clear();
    expect(acc.snapshot()).toEqual(score([], ONE));
    acc.set(aduLot, aduBuilding);
    expect(acc.snapshot().netUnits).toBe(1);
  });
});

describe('fractions (uncapped, registry order)', () => {
  function manyNet(net: number): ReturnType<typeof score> {
    const p = parcel('2000000', 0, 'Mission');
    return score([[p, building(p, net, true)]], M1_TARGETS);
  }

  it('net 164,138 → rhna fraction exactly 2.0', () => {
    const s = manyNet(164138);
    expect(s.targets.map((t) => t.target.id)).toEqual(['rhna', 'rhna-buffer']);
    expect(s.targets[0].fraction).toBe(2);
    expect(s.targets[1].fraction).toBe(164138 / 94379);
    expect(s.targets[0].target).toBe(M1_TARGETS[0]);
  });

  it('net 0 → 0', () => {
    expect(score([], M1_TARGETS).targets.map((t) => t.fraction)).toEqual([0, 0]);
  });

  it('renders N targets generically (zero targets too)', () => {
    expect(score([[aduLot, aduBuilding]], []).targets).toEqual([]);
  });
});

describe('score() edge inputs', () => {
  it('duplicate parcel ids: last entry wins and equals the accumulator', () => {
    const entries: [typeof replLot, typeof replBuilding][] = [
      [replLot, replBuilding],
      [aduLot, aduBuilding],
      [replLot, building(replLot, 3, true)]
    ];
    const s = score(entries, ONE);
    expect(s).toMatchObject({ grossUnits: 4, demolishedUnits: 1, netUnits: 3, parcelsChanged: 2 });
    const acc = createScoreAccumulator(ONE);
    for (const [p, b] of entries) acc.set(p, b);
    expect(s).toEqual(acc.snapshot());
  });

  it('prototype-named neighborhoods are own keys with correct sums', () => {
    const names = ['__proto__', 'constructor', 'toString'];
    const ps = names.map((n, i) => parcel(`300000${i}`, 0, n));
    const s = score(
      ps.map((p, i) => [p, building(p, i + 1, true)] as [typeof p, ReturnType<typeof building>]),
      ONE
    );
    expect(Object.getPrototypeOf(s.byNeighborhood)).toBe(Object.prototype);
    expect(Object.keys(s.byNeighborhood)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getOwnPropertyDescriptor(s.byNeighborhood, '__proto__')?.value).toBe(1);
    expect(s.byNeighborhood.constructor).toBe(2);
    expect(s.byNeighborhood.toString).toBe(3);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('isolation and determinism', () => {
  it('snapshots are independent of later sets and of mutation', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(replLot, replBuilding);
    const a = acc.snapshot();
    a.byNeighborhood.Mission = 999;
    a.targets.pop();
    acc.set(aduLot, aduBuilding);
    const b = acc.snapshot();
    expect(b.byNeighborhood).toEqual({ Mission: 8, Sunset: 1 });
    expect(b.targets).toHaveLength(1);
    expect(a.netUnits).toBe(8);
  });

  it('byNeighborhood keys are sorted whatever the insertion order', () => {
    const z = parcel('4000001', 0, 'Zeta');
    const a = parcel('4000002', 0, 'Alpha');
    const acc = createScoreAccumulator(ONE);
    acc.set(z, building(z, 1, true));
    acc.set(a, building(a, 1, true));
    expect(Object.keys(acc.snapshot().byNeighborhood)).toEqual(['Alpha', 'Zeta']);
    expect(JSON.stringify(acc.snapshot())).toBe(
      JSON.stringify(
        score(
          [
            [a, building(a, 1, true)],
            [z, building(z, 1, true)]
          ],
          ONE
        )
      )
    );
  });
});
