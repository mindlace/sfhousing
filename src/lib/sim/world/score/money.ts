// World 1's money by calendar month (world-score rule 9): its ledger filed as `poolSeries` files it,
// and the funded and displaced homes its series counted (rule 2).
import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import { poolSeries } from '$lib/sim/scenario/finance-score';
import { monthsOf } from '$lib/sim/scenario/score';
import type { Extras } from './series';
import type { MoneyFeed, MoneyRow } from './types';

/**
 * World 1's money rows for final months `from..through`. The pools' series come from all of world
 * 1's ledger (`feed.ledger`, since month 0) through the last day of month `through`; the pools,
 * programmes, slope and terms are `feed.finance`'s (the same ids and order in every frame) with no
 * off spans, which `poolSeries` does not read. `publicSpent` is `spent + lostCredit` over every
 * pool, summed as `moneyOf` sums it.
 */
export function moneyRowsOf(
  feed: MoneyFeed,
  extras: Extras,
  from: number,
  through: number
): MoneyRow[] {
  const homes = extras.homes(from, through);
  const asOf = feed.statics.asOf;
  const horizon = addMonths(firstOfMonth(asOf), through + 1) - 1;
  const f = feed.finance;
  const pools = poolSeries(
    feed.ledger,
    { pools: f.pools, programmes: f.programmes, off: [], slope: f.slope, terms: f.terms },
    monthsOf(asOf, horizon),
    horizon
  );
  const out: MoneyRow[] = [];
  for (let i = from; i <= through; i++) {
    let publicSpent = 0;
    for (const q of pools) publicSpent = publicSpent + q.spent[i] + q.lostCredit[i];
    const h = homes[i - from];
    out.push({
      pools: pools.map((q) => ({
        id: q.id,
        label: q.label,
        kind: q.kind,
        received: q.received[i],
        committed: q.committed[i],
        out: q.out[i],
        spent: q.spent[i],
        repaid: q.repaid[i],
        lost: q.lost[i],
        lostCredit: q.lostCredit[i]
      })),
      fundedHomes: h.funded,
      displacedHomes: h.displaced,
      publicSpent
    });
  }
  return out;
}
