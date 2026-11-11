import { describe, expect, it } from 'vitest';
import { RHNA_TIER_TARGETS } from '$lib/scoreboard';
import { debtService } from '$lib/sim/finance';
import { checkMoneyIdentities } from '$lib/sim/scenario/test/money-identities';
import { INCOME_TIERS, type Pool } from '$lib/timelapse/types';
import { TIMELINE_SCORE, TIMELINE_SCORE_MONEY } from './timeline-score';

const uBond: Pool = {
  id: 'u-bond',
  kind: 'goBond',
  label: 'Added bond',
  inflows: [],
  uncapped: false,
  debt: { rate: 0.06, termYears: 20 },
  leverage: 1
};
const federal: Pool = {
  id: 'federal',
  kind: 'federal',
  label: 'Federal tax credits',
  inflows: [],
  uncapped: true,
  debt: null,
  leverage: 1
};

describe('TimelineScore fixture: tiers', () => {
  const tiers = TIMELINE_SCORE.tiers!;
  const sum = (t: Record<string, number>) => Object.values(t).reduce((s, x) => s + x, 0);

  it('completed tiers sum to completedNet every month', () => {
    expect(tiers.completed).toHaveLength(TIMELINE_SCORE.shown.length);
    tiers.completed.forEach((c, i) => expect(sum(c)).toBe(TIMELINE_SCORE.shown[i].completedNet));
  });

  it('baseline sums to 12,000 and targets follow RHNA_TIER_TARGETS', () => {
    expect(sum(tiers.baseline)).toBe(12000);
    expect(tiers.targets.map((t) => t.target)).toEqual(RHNA_TIER_TARGETS);
    tiers.targets.forEach((t) => {
      const tier = t.target.tier!;
      expect(INCOME_TIERS).toContain(tier);
      expect(t.fraction[7]).toBe(
        (tiers.baseline[tier] + tiers.completed[7][tier]) / t.target.units
      );
    });
  });
});

describe('TimelineScore fixture: money', () => {
  const money = TIMELINE_SCORE_MONEY.money!;

  it('satisfies I1, I4, I5 and I6 on the series', () => {
    checkMoneyIdentities(money, [uBond, federal]);
  });

  it('publicSpent is the sum of spent and lostCredit over the pools', () => {
    money.publicSpent.forEach((p, i) => {
      const s = money.pools.reduce((a, q) => a + q.spent[i] + q.lostCredit[i], 0);
      expect(p).toBe(s);
    });
  });

  it('owes the last month received, with its debt service', () => {
    expect(money.owed).toEqual([
      {
        pool: 'u-bond',
        principal: 300_000_000,
        repayment: debtService(300_000_000, { rate: 0.06, termYears: 20 }).total,
        nominal: true
      }
    ]);
    expect(money.limits.length).toBeGreaterThan(0);
  });

  it('keeps the other series by formula', () => {
    expect(money.fundedHomes[10]).toBe(40);
    expect(money.displacedHomes[10]).toBe(10);
    expect(money.pools[0].received[12]).toBe(24_000_000);
    expect(TIMELINE_SCORE_MONEY.shown).toEqual(TIMELINE_SCORE.shown);
  });
});
