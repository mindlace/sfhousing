import { describe, expect, it } from 'vitest';
import { DISPLACEMENT_RANGE } from '$lib/sim/finance';
import {
  cityOf,
  displacedShare,
  owedAt,
  perAddedHome,
  type Money
} from '$lib/sim/scenario/finance-score';
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import { INCOME_TIERS } from '$lib/timelapse/types';
import { MARKET_FUNDING_SENTENCE } from '$lib/sim-page/funding-copy';
import { fixtureCalibration } from './fixtures/calibration';
import { MONEY_LAST, MONEY_SCORE } from './fixtures/money';
import { formatDollars, formatDollarsExact, formatSourcePercent } from './format';
import { marketSentence } from './market-view';
import {
  affordableLine,
  allLine,
  bySourceColumns,
  cityLine,
  displacementLine,
  fundedLine,
  limitLines,
  lostGrantsLine,
  marketText,
  moneyAt,
  owedLines,
  tiersAt,
  TIERS_FUNDED_SENTENCE,
  TIERS_UNRECORDED_SENTENCE,
  uncappedPoolIds
} from './money-view';
import type { Pool } from '$lib/timelapse/types';

const money = MONEY_SCORE.money as Money;
const tiers = MONEY_SCORE.tiers!;
const L = MONEY_LAST;

describe('moneyAt and tiersAt', () => {
  it('moneyAt and tiersAt at month 0 and the last month', () => {
    for (const i of [0, L]) {
      const m = moneyAt(money, i);
      expect(m.spent).toBe(money.publicSpent[i]);
      expect(m.citySpent).toBe(cityOf(money, i));
      expect(m.perAddedHome).toBe(perAddedHome(money, i, 'all'));
      expect(m.cityPerAddedHome).toBe(perAddedHome(money, i, 'city'));
      expect(m.fundedHomes).toBe(money.fundedHomes[i]);
      expect(m.displacedHomes).toBe(money.displacedHomes[i]);
      expect(m.pools.map((p) => p.id)).toEqual(money.pools.map((p) => p.id));
      m.pools.forEach((p, k) => {
        const s = money.pools[k];
        expect(p).toEqual({
          id: s.id,
          label: s.label,
          kind: s.kind,
          received: s.received[i],
          spent: s.spent[i],
          out: s.out[i],
          repaid: s.repaid[i],
          lost: s.lost[i],
          lostCredit: s.lostCredit[i]
        });
      });

      const t = tiersAt(tiers, i);
      expect(t.rows.map((r) => r.tier)).toEqual([...INCOME_TIERS]);
      t.rows.forEach((r, k) => {
        const target = tiers.targets.find((x) => x.target.tier === r.tier)!;
        expect(r.homes).toBe(tiers.baseline[r.tier] + tiers.completed[i][r.tier]);
        expect(r.target).toBe(target.target.units);
        expect(r.fraction).toBe(target.fraction[i]);
        expect(k).toBe(INCOME_TIERS.indexOf(r.tier));
      });
      expect(t.unrecorded).toBe(tiers.baseline.unrecorded + tiers.completed[i].unrecorded);
      const c = tiers.completed[i];
      const b = tiers.baseline;
      expect(t.affordable).toBe(
        b.veryLow +
          b.low +
          b.moderate +
          b.unrecorded +
          c.veryLow +
          c.low +
          c.moderate +
          c.unrecorded
      );
    }
    // The fixture changes at the last month, so the two reads differ.
    expect(moneyAt(money, L).fundedHomes).not.toBe(moneyAt(money, L - 1).fundedHomes);
  });

  it('month 0 has no NaN', () => {
    const m = moneyAt(money, 0);
    const t = tiersAt(tiers, 0);
    const texts = [
      cityLine(m),
      allLine(m, money.publicSpent[0]),
      lostGrantsLine(m, 1),
      fundedLine(m),
      displacementLine(money, 0),
      ...owedLines(money, 0),
      ...limitLines(money.limits).map((l) => `${l.word} ${l.text}`),
      affordableLine(t)
    ].filter((s): s is string => s !== null);
    for (const s of texts) expect(s).not.toMatch(/NaN|Infinity/);
    expect(cityLine(m)).toBe('City money: no homes added yet · $0 spent so far');
    expect(allLine(m, money.publicSpent[0])).toBe(
      'All public money: no homes added yet · $0 spent so far'
    );
  });
});

describe('row texts', () => {
  it('lost-grants line: everything at 1, 50% at 0.5, absent at 0', () => {
    const m = moneyAt(money, L);
    const sum = m.pools.reduce((s, p) => s + p.lost - p.lostCredit, 0);
    expect(sum).toBe(500_000);
    expect(lostGrantsLine(m, 1)).toBe(
      `Grants paid to projects that stopped after construction began, counted as lost (assumption): ${formatDollars(sum)}. They are in Spent.`
    );
    expect(lostGrantsLine(m, 0.5)).toBe(
      `Grants paid to projects that stopped after construction began, ${formatPercent(0.5)} counted as lost (assumption): ${formatDollars(sum)}. They are in Spent.`
    );
    expect(lostGrantsLine(m, 0.5)).toContain('50% counted as lost');
    expect(lostGrantsLine(m, 0)).toBeNull();
    // No lost grants before the last month: no line.
    expect(lostGrantsLine(moneyAt(money, L - 1), 1)).toBeNull();
  });

  it('repayment line from owedAt(entry, received[i])', () => {
    expect(owedLines(money, 0)).toEqual([]);
    for (const i of [12, L]) {
      const entry = money.owed[0];
      const pool = money.pools.find((p) => p.id === entry.pool)!;
      const received = pool.received[i];
      expect(owedLines(money, i)).toEqual([
        `${pool.label}: ${formatDollars(received)} borrowed, ${formatDollars(owedAt(entry, received))} to repay over the years it is paid (not adjusted for inflation).`
      ]);
    }
  });

  it('City line first and its figure is perAddedHome(money, i, "city")', () => {
    const m = moneyAt(money, L);
    const city = perAddedHome(money, L, 'city')!;
    expect(city).not.toBeNull();
    expect(cityLine(m)).toBe(
      `City money: ${formatDollarsExact(city)} per added home · ${formatDollars(cityOf(money, L))} spent so far`
    );
    const noCity: Money = {
      ...money,
      pools: money.pools.filter((p) => p.kind === 'state' || p.kind === 'federal')
    };
    expect(cityLine(moneyAt(noCity, L))).toBeNull();
  });

  it('all line uses perAddedHome(money, i, "all")', () => {
    const m = moneyAt(money, L);
    const all = perAddedHome(money, L, 'all')!;
    expect(all).not.toBeNull();
    expect(allLine(m, money.publicSpent[L])).toBe(
      `All public money: ${formatDollarsExact(all)} per added home · ${formatDollars(money.publicSpent[L])} spent so far`
    );
  });

  it('funded line', () => {
    expect(fundedLine(moneyAt(money, L))).toBe('Funded homes finished: 3. Added homes: 2.');
  });

  it('displacement with and without funded homes', () => {
    const range = `${formatSourcePercent(DISPLACEMENT_RANGE.value.low)} to ${formatSourcePercent(DISPLACEMENT_RANGE.value.high)} (tier ${DISPLACEMENT_RANGE.provenance.tier})`;
    expect(range).toBe('11.5% to 80% (tier 3)');
    const tail = `Studies outside San Francisco find ${range}; none has measured San Francisco.`;
    expect(displacementLine(money, L)).toBe(
      `Private homes these projects took the place of: ${formatCount(1)} (${formatPercent(displacedShare(money, L)!)} of funded homes). ${tail}`
    );
    expect(displacementLine(money, 0)).toBe(
      `Private homes these projects took the place of: 0. ${tail}`
    );
  });

  it('limits ordered exceeded first', () => {
    expect(money.limits.map((l) => l.exceeded)).toEqual([false, true]);
    const lines = limitLines(money.limits);
    expect(lines.map((l) => l.word)).toEqual(['Over:', 'Within:']);
    expect(lines[0].text).toBe(money.limits[1].text);
    expect(lines[0].provenance).toBe(money.limits[1].provenance);
    expect(lines[1].text).toBe(money.limits[0].text);
    expect(limitLines([])).toEqual([]);
  });

  it('by-source columns drop the zero ones', () => {
    expect(bySourceColumns(moneyAt(money, 0))).toEqual(['received']);
    expect(bySourceColumns(moneyAt(money, L - 1))).toEqual(['received', 'spent', 'out']);
    expect(bySourceColumns(moneyAt(money, L))).toEqual([
      'received',
      'spent',
      'out',
      'repaid',
      'lostCredit'
    ]);
  });

  it('by-source columns keep Received when a pool is uncapped, even at 0 everywhere', () => {
    const m = moneyAt(money, 0);
    const none = { ...m, pools: m.pools.map((p) => ({ ...p, received: 0 })) };
    expect(bySourceColumns(none)).not.toContain('received');
    expect(bySourceColumns(none, new Set(['federal']))).toContain('received');
    // An uncapped id that is not among the run's pools keeps nothing.
    expect(bySourceColumns(none, new Set(['elsewhere']))).not.toContain('received');
  });

  it('uncapped pool ids come from Pool.uncapped, baseline and levers, never from the kind', () => {
    const pool = (id: string, kind: Pool['kind'], uncapped: boolean): Pool => ({
      id,
      kind,
      label: id,
      inflows: [],
      uncapped,
      debt: null,
      leverage: 1
    });
    const baseline = fixtureCalibration().baselineFunding!.pools;
    expect([...uncappedPoolIds(baseline)]).toEqual(
      baseline.filter((p) => p.uncapped).map((p) => p.id)
    );
    expect([...uncappedPoolIds(baseline)]).toEqual(['federal-tax-credits']);
    const ids = uncappedPoolIds(
      [pool('fed', 'federal', false), pool('a', 'state', true)],
      undefined,
      [pool('b', 'goBond', true), pool('c', 'cop', false)]
    );
    expect([...ids].sort()).toEqual(['a', 'b']);
    expect(uncappedPoolIds().size).toBe(0);
  });

  it('the two F13 tier sentences', () => {
    expect(TIERS_FUNDED_SENTENCE).toBe(
      "A funded affordable project's homes are counted in the income levels of the programmes that pay it, in proportion to what each pays."
    );
    expect(TIERS_UNRECORDED_SENTENCE).toBe(
      'Homes in real projects whose records give no income level are counted here and never guessed into a level. Private projects of 10 homes or more count their on-site affordable homes at the legal rate, assuming they build them on site (tier 2).'
    );
  });

  it('affordable line', () => {
    const t = tiersAt(tiers, L);
    expect(affordableLine(t)).toBe(`Affordable homes so far: ${formatCount(t.affordable)}`);
  });
});

describe('marketText', () => {
  it('ends with MARKET_FUNDING_SENTENCE under private, the Release 1 text under all', () => {
    const cal = fixtureCalibration();
    expect(cal.market && cal.baselineFunding).toBeTruthy();
    expect(marketText(cal)).toBe(`${marketSentence(cal, 'private')} ${MARKET_FUNDING_SENTENCE}`);
    const all = structuredClone(cal);
    delete all.baselineFunding;
    expect(marketText(all)).toBe(marketSentence(all, 'all'));
    expect(marketText(all)).not.toContain(MARKET_FUNDING_SENTENCE);
    const none = structuredClone(cal);
    delete none.market;
    expect(marketText(none)).toBeNull();
  });
});
