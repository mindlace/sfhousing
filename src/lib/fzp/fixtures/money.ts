/**
 * A `TimelineScore` with `money` and `tiers` for the Results rows (funding-ui spec 4.11, section 6).
 * The base is `makeTimelineScore()` (291 months, its `tiers` unchanged); `money` has four pools,
 * every series a formula of the month index `i` so a test derives its expectation. `L` is the last
 * month (290):
 *
 *   city-general (generalRevenue)  received[i] 10,000,000 x (floor(i / 12) + 1)
 *                                  spent[i] 100,000 x i, plus 500,000 at L (a grant lost at L:
 *                                  lost[L] 500,000, lostCredit 0)
 *   state (state)                  received[i] 5,000,000 x (floor(i / 12) + 1), spent[i] 50,000 x i
 *   federal (federal, uncapped)    received 0, spent[i] 80,000 x i
 *   u-bond (goBond, 'Added bond')  received[i] 60,000,000 from month 12, else 0; a loan of
 *                                  2,000,000 out from month 12; at L: repaid 1,000,000, lost and
 *                                  lostCredit 250,000, out 750,000
 *   fundedHomes   0 before month 100, 2 from it, 3 at L
 *   displacedHomes 0, 1 at L
 *   publicSpent[i] the sum over pools of spent[i] + lostCredit[i]
 *   owed          u-bond, principal received[L], repayment debtService(principal, 6%, 20 y).total
 *   limits        from limitStatements on that borrowing: goCap (within) then goRate (exceeded),
 *                 in that order, so "exceeded first" is the page's doing
 */
import { debtService, limitStatements } from '$lib/sim/finance';
import type { TimelineScore } from '$lib/sim/protocol';
import { makeTimelineScore } from './timeline-score';

export const MONEY_MONTHS = 291;
export const MONEY_LAST = MONEY_MONTHS - 1;
const L = MONEY_LAST;

const BOND_DEBT = { rate: 0.06, termYears: 20 };
export const BOND_PRINCIPAL = 60_000_000;

type Money = NonNullable<TimelineScore['money']>;
type PoolSeries = Money['pools'][number];

const idx = Array.from({ length: MONEY_MONTHS }, (_, i) => i);
const zeros = () => idx.map(() => 0);
const yearly = (n: number) => idx.map((i) => n * (Math.floor(i / 12) + 1));

function makeMoney(): Money {
  const pools: PoolSeries[] = [
    {
      id: 'city-general',
      label: 'General fund',
      kind: 'generalRevenue',
      received: yearly(10_000_000),
      committed: zeros(),
      out: zeros(),
      spent: idx.map((i) => 100_000 * i + (i === L ? 500_000 : 0)),
      repaid: zeros(),
      lost: idx.map((i) => (i === L ? 500_000 : 0)),
      lostCredit: zeros()
    },
    {
      id: 'state',
      label: 'State housing programmes',
      kind: 'state',
      received: yearly(5_000_000),
      committed: zeros(),
      out: zeros(),
      spent: idx.map((i) => 50_000 * i),
      repaid: zeros(),
      lost: zeros(),
      lostCredit: zeros()
    },
    {
      id: 'federal',
      label: 'Federal tax credits',
      kind: 'federal',
      received: zeros(),
      committed: zeros(),
      out: zeros(),
      spent: idx.map((i) => 80_000 * i),
      repaid: zeros(),
      lost: zeros(),
      lostCredit: zeros()
    },
    {
      id: 'u-bond',
      label: 'Added bond',
      kind: 'goBond',
      received: idx.map((i) => (i >= 12 ? BOND_PRINCIPAL : 0)),
      committed: zeros(),
      out: idx.map((i) => (i === L ? 750_000 : i >= 12 ? 2_000_000 : 0)),
      spent: zeros(),
      repaid: idx.map((i) => (i === L ? 1_000_000 : 0)),
      lost: idx.map((i) => (i === L ? 250_000 : 0)),
      lostCredit: idx.map((i) => (i === L ? 250_000 : 0))
    }
  ];
  const statements = limitStatements([
    { pool: 'u-bond', kind: 'goBond', principal: BOND_PRINCIPAL, debt: BOND_DEBT }
  ]);
  const pick = (id: string) => {
    const s = statements.find((x) => x.id === id);
    if (!s) throw new Error(`limitStatements gave no ${id}`);
    return s;
  };
  return {
    pools,
    fundedHomes: idx.map((i) => (i === L ? 3 : i >= 100 ? 2 : 0)),
    displacedHomes: idx.map((i) => (i === L ? 1 : 0)),
    publicSpent: idx.map((i) => pools.reduce((s, p) => s + p.spent[i] + p.lostCredit[i], 0)),
    owed: [
      {
        pool: 'u-bond',
        principal: BOND_PRINCIPAL,
        repayment: debtService(BOND_PRINCIPAL, BOND_DEBT).total,
        nominal: true
      }
    ],
    limits: [pick('goCap'), pick('goRate')]
  };
}

/** The base score with `money` (and the base's `tiers`). */
export function makeMoneyScore(): TimelineScore {
  return { ...makeTimelineScore(), money: makeMoney() };
}

export const MONEY_SCORE: TimelineScore = makeMoneyScore();
