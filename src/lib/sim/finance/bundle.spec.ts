import { describe, expect, it } from 'vitest';
import type { Instrument, PoolKind } from '../../timelapse/types';
import {
  CERTAIN_TOLERANCE,
  fundBundle,
  isCertain,
  projectDollars,
  type BundleItem
} from './instruments';
import { AVERAGE_DRAWN, MARKET_TERMS } from './terms';
import { costPerHome } from './prototypes';
import { B, BASELINE_BUNDLE, BASELINE_SPLIT, TERMS, TERMS_CUT } from './test/fixtures';

const U = 861525;
const UB = 217000;

const grant = (share: number, poolKind: PoolKind): BundleItem => ({
  instrument: { kind: 'grant', share },
  poolKind
});
const loan = (
  costShare: number,
  rate: number,
  requiredReturn: number | null,
  poolKind: PoolKind
): BundleItem => ({ instrument: { kind: 'loan', costShare, rate, requiredReturn }, poolKind });

/** mulberry32: a small seeded PRNG, so the randomised check is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])
  );
}

describe('fundBundle worked bundles', () => {
  it('prices the baseline alone: every tier fits', () => {
    const r = fundBundle(BASELINE_BUNDLE, 'affordable', B, TERMS);
    expect(r.items).toHaveLength(3);
    BASELINE_BUNDLE.forEach((item, i) => {
      const share = (item.instrument as { share: number }).share;
      expect(Math.abs(r.items[i].granted - share * U)).toBeLessThan(1e-6);
      expect(r.items[i].grantEquivalent).toBe(r.items[i].granted);
      expect(r.items[i].lent).toBe(0);
      expect(r.items[i].guaranteed).toBe(0);
      expect(r.items[i].reserve).toBe(0);
    });
    expect(r.items.map((it) => projectDollars(it.granted, 1))).toEqual([443108, 118390, 300027]);
    expect(Math.abs(r.coverage - 1)).toBeLessThan(1e-12);
    expect(r.certain).toBe(true);
  });

  it('returns the empty result for an empty bundle', () => {
    expect(fundBundle([], 'affordable', B, TERMS)).toEqual({
      items: [],
      grantEquivalent: 0,
      coverage: 0,
      certain: false
    });
  });

  it('halves two City grants of the whole City share', () => {
    const r = fundBundle([...BASELINE_BUNDLE, grant(300027 / U, 'goBond')], 'affordable', B, TERMS);
    expect(Math.abs(r.items[2].granted - 150013.5)).toBeLessThan(1e-6);
    expect(Math.abs(r.items[3].granted - 150013.5)).toBeLessThan(1e-6);
    expect(Math.abs(r.coverage - 1)).toBeLessThan(CERTAIN_TOLERANCE);
    expect(r.certain).toBe(true);
  });

  it('scales a split City tier by one fraction under an added federal grant', () => {
    const r = fundBundle([...BASELINE_SPLIT, grant(100000 / U, 'federal')], 'affordable', B, TERMS);
    expect(r.items[0].granted + r.items[4].granted).toBeCloseTo(543108, 4);
    expect(r.items[1].granted).toBeCloseTo(118390, 4);
    expect(Math.abs(r.items[2].granted - 100004.4996)).toBeLessThan(1e-4);
    expect(Math.abs(r.items[3].granted - 100022.5004)).toBeLessThan(1e-4);
    const f = 200027 / 300027;
    expect(r.items[2].granted).toBeCloseTo((150000 / U) * U * f, 6);
    expect(r.items[3].granted).toBeCloseTo((150027 / U) * U * f, 6);
    expect(r.certain).toBe(true);
  });

  it('counts an added City loan in the City tier', () => {
    const r = fundBundle(
      [...BASELINE_BUNDLE, loan(0.6, 0.04, null, 'generalRevenue')],
      'affordable',
      B,
      TERMS
    );
    expect(r.items[0].granted).toBeCloseTo(443108, 6);
    expect(r.items[1].granted).toBeCloseTo(118390, 6);
    expect(Math.abs(r.items[2].granted - 272865.44)).toBeLessThan(1e-2);
    expect(Math.abs(r.items[3].grantEquivalent - 27161.56)).toBeLessThan(1e-2);
    expect(r.items[3].lent).toBeCloseTo(572476.2, 6);
    expect(r.items[3].granted).toBe(0);
    expect(r.certain).toBe(true);
  });
});

describe('fundBundle tiers', () => {
  it('a federal grant of 1 alone leaves every state and City grant at 0', () => {
    const r = fundBundle(
      [grant(1, 'federal'), grant(0.3, 'state'), grant(0.3, 'goBond'), grant(0.2, 'cop')],
      'affordable',
      B,
      TERMS
    );
    expect(r.items.map((it) => it.granted)).toEqual([U, 0, 0, 0]);
    expect(r.certain).toBe(true);
  });

  it('two goBond grants of 1 each pay half', () => {
    const r = fundBundle([grant(1, 'goBond'), grant(1, 'goBond')], 'affordable', B, TERMS);
    expect(r.items[0].granted).toBeCloseTo(430762.5, 6);
    expect(r.items[1].granted).toBeCloseTo(430762.5, 6);
  });

  it('a City loan plus a City grant of 1 on B: the grant pays U less the loan', () => {
    const r = fundBundle(
      [loan(0.6, 0.04, null, 'generalRevenue'), grant(1, 'goBond')],
      'market',
      B,
      TERMS
    );
    const ge = 0.6 * 736700 * 0.045 * 1.917 * AVERAGE_DRAWN.value;
    expect(r.items[0].grantEquivalent).toBeCloseTo(ge, 6);
    expect(r.items[1].granted).toBeCloseTo(UB - r.items[0].grantEquivalent, 6);
    expect(r.certain).toBe(true);
  });

  it('a City loan worth more than what remains counts in full and City grants pay 0', () => {
    const r = fundBundle(
      [
        grant(0.6, 'federal'),
        grant(0.39, 'state'),
        loan(0.6, 0.04, null, 'generalRevenue'),
        grant(0.5, 'goBond')
      ],
      'affordable',
      B,
      TERMS
    );
    expect(r.items[2].grantEquivalent).toBeCloseTo(27161.56, 2);
    expect(r.items[3].granted).toBe(0);
    expect(r.grantEquivalent).toBeCloseTo(0.99 * U + r.items[2].grantEquivalent, 6);
    expect(r.coverage).toBeGreaterThan(1);
  });

  it('fills federal, then state, then City, whatever the input order', () => {
    const r = fundBundle(
      [grant(0.5, 'cop'), grant(0.3, 'state'), grant(0.4, 'federal')],
      'affordable',
      B,
      TERMS
    );
    expect(r.items[2].granted).toBeCloseTo(0.4 * U, 6);
    expect(r.items[1].granted).toBeCloseTo(0.3 * U, 6);
    expect(r.items[0].granted).toBeCloseTo(0.3 * U, 6);
    expect(r.certain).toBe(true);
  });
});

describe('fundBundle floating point', () => {
  it('a scaled City tier of 0.1, 0.2 and 0.7 over a federal third is certain', () => {
    const r = fundBundle(
      [grant(1 / 3, 'federal'), grant(0.1, 'goBond'), grant(0.2, 'cop'), grant(0.7, 'bank')],
      'affordable',
      B,
      TERMS
    );
    expect(r.certain).toBe(true);
    expect(Math.abs(r.coverage - 1)).toBeLessThan(CERTAIN_TOLERANCE);
    const sum = r.items.reduce((s, it) => s + it.granted, 0);
    expect(Math.abs(sum - U)).toBeLessThan(1e-6);
  });

  it('every bundle whose grants bind is certain (10,000 seeded draws)', () => {
    const rand = mulberry32(20261110);
    const city: PoolKind[] = ['bank', 'dedicatedTax', 'generalRevenue', 'goBond', 'cop'];
    let failures = 0;
    for (let n = 0; n < 10000; n++) {
      const fed = 0.01 + rand() * 0.49;
      const st = 0.01 + rand() * 0.39;
      const left = 1 - fed - st;
      // the first City grant alone is above what remains, so the City tier is oversubscribed
      const c1 = left + (1 - rand()) * (1 - left);
      const c2 = 0.01 + rand() * 0.99;
      const items = [
        grant(fed, 'federal'),
        grant(st, 'state'),
        grant(c1, city[n % 5]),
        grant(c2, city[(n + 2) % 5])
      ];
      const r = fundBundle(items, 'affordable', B, TERMS);
      if (!isCertain(r.coverage) || !r.certain) failures++;
    }
    expect(failures).toBe(0);
  });
});

describe('fundBundle per-item fields', () => {
  it('a loan lends its whole principal', () => {
    const r = fundBundle([loan(0.6, 0.04, null, 'federal')], 'market', B, TERMS);
    expect(r.items[0].lent).toBe(0.6 * costPerHome('market', B));
    expect(r.items[0]).toMatchObject({ granted: 0, guaranteed: 0, reserve: 0 });
  });

  it('a guarantee guarantees its principal and holds its reserve', () => {
    const inst: Instrument = { kind: 'guarantee', costShare: 0.6, reserve: 0.2 };
    const r = fundBundle([{ instrument: inst, poolKind: 'bank' }], 'market', B, TERMS_CUT);
    const guaranteed = 0.6 * costPerHome('market', B);
    expect(r.items[0].guaranteed).toBe(guaranteed);
    expect(r.items[0].reserve).toBe(0.2 * guaranteed);
    expect(projectDollars(r.items[0].grantEquivalent, 1)).toBe(4660);
    expect(r.items[0]).toMatchObject({ granted: 0, lent: 0 });
  });
});

describe('fundBundle subsets and order (the award loop)', () => {
  const FOUR: BundleItem[] = [
    loan(0.6, 0.04, null, 'federal'),
    grant(0.5, 'federal'),
    grant(0.5, 'generalRevenue'),
    grant(0.5, 'goBond')
  ];
  // Ruling (operator): 87,528 and 43,764 in spec 6 are rounded prose; the exact remainder governs.
  const REMAINDER = UB - 0.6 * 736700 * 0.045 * 1.917 * 0.55 - 108500;

  it('prices the four-item fixture as the spec says', () => {
    const r = fundBundle(FOUR, 'market', B, TERMS);
    expect(projectDollars(r.items[0].grantEquivalent, 1)).toBe(20972);
    expect(r.items[1].granted).toBeCloseTo(108500, 6);
    for (const it of [r.items[2], r.items[3]]) {
      expect(Math.abs(it.granted - REMAINDER / 2)).toBeLessThan(1e-6);
      expect(projectDollars(it.granted, 1)).toBe(43764);
    }
    expect(UB - r.items[0].grantEquivalent - 108500).toBeCloseTo(
      r.items[2].granted + r.items[3].granted,
      6
    );
  });

  it('every subset obeys properties (i) to (iii)', () => {
    const whole = fundBundle(FOUR, 'market', B, TERMS);
    for (let mask = 0; mask < 16; mask++) {
      const idx = [0, 1, 2, 3].filter((i) => mask & (1 << i));
      const sub = idx.map((i) => FOUR[i]);
      const r = fundBundle(sub, 'market', B, TERMS);
      expect(fundBundle(sub, 'market', B, TERMS)).toEqual(r);
      idx.forEach((orig, j) => {
        expect(r.items[j].granted).toBeGreaterThanOrEqual(whole.items[orig].granted);
      });
      expect(r.grantEquivalent).toBeLessThanOrEqual(whole.grantEquivalent + 1e-9);
    }
  });

  it('leaving out the generalRevenue grant, the goBond grant pays what remains', () => {
    const r = fundBundle([FOUR[0], FOUR[1], FOUR[3]], 'market', B, TERMS);
    expect(Math.abs(r.items[2].granted - REMAINDER)).toBeLessThan(1e-6);
    expect(projectDollars(r.items[2].granted, 1)).toBe(87528);
    expect(isCertain(r.coverage)).toBe(true);
  });

  it('every permutation gives each item the same granted', () => {
    const whole = fundBundle(FOUR, 'market', B, TERMS);
    const perms = permutations([0, 1, 2, 3]);
    expect(perms).toHaveLength(24);
    for (const perm of perms) {
      const r = fundBundle(
        perm.map((i) => FOUR[i]),
        'market',
        B,
        TERMS
      );
      perm.forEach((orig, j) => {
        expect(Math.abs(r.items[j].granted - whole.items[orig].granted)).toBeLessThan(1e-9);
        expect(r.items[j].lent).toBe(whole.items[orig].lent);
      });
    }
  });
});

describe('fundBundle guards', () => {
  it('throws validateInstrument text for an invalid item', () => {
    expect(() => fundBundle([grant(0, 'goBond')], 'affordable', B, TERMS)).toThrow(
      new RangeError('A grant pays more than 0% and at most 100% of the uncovered cost.')
    );
    expect(() =>
      fundBundle([...BASELINE_BUNDLE, loan(0.6, Number.NaN, null, 'cop')], 'affordable', B, TERMS)
    ).toThrow(new RangeError("A loan's rate is between 0% and 25%."));
  });

  it('throws when a term the item needs is not sourced', () => {
    const inst: Instrument = { kind: 'guarantee', costShare: 0.6, reserve: 0.2 };
    expect(() => fundBundle([{ instrument: inst, poolKind: 'bank' }], 'market', B, TERMS)).toThrow(
      new RangeError('guarantee needs guaranteeRateCut, which is not sourced')
    );
  });

  it('accepts MarketTerms as well as ResolvedTerms', () => {
    expect(fundBundle(BASELINE_BUNDLE, 'affordable', B, MARKET_TERMS)).toEqual(
      fundBundle(BASELINE_BUNDLE, 'affordable', B, TERMS)
    );
  });

  it('returns a fresh result and never mutates its input', () => {
    const input = structuredClone(BASELINE_BUNDLE);
    const first = fundBundle(input, 'affordable', B, TERMS);
    const original = first.items[0].granted;
    first.items[0].granted = -1;
    first.items.push(first.items[0]);
    const second = fundBundle(input, 'affordable', B, TERMS);
    expect(second.items[0].granted).toBe(original);
    expect(second.items).toHaveLength(3);
    expect(input).toEqual(BASELINE_BUNDLE);
  });

  it('loans alone above U: coverage above 1, certain, grants 0, nothing negative', () => {
    const r = fundBundle(
      [
        loan(1, 0, 0.01, 'federal'),
        loan(1, 0, 0.01, 'federal'),
        grant(1, 'federal'),
        grant(1, 'state'),
        grant(1, 'goBond'),
        grant(1, 'cop')
      ],
      'market',
      B,
      TERMS
    );
    expect(r.coverage).toBeGreaterThan(1);
    expect(r.certain).toBe(true);
    for (const it of r.items.slice(2)) expect(it.granted).toBe(0);
    for (const it of r.items) {
      for (const v of Object.values(it)) expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(r.grantEquivalent).toBeGreaterThanOrEqual(0);
  });
});
