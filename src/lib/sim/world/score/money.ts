// The plan world's money by calendar month (world-score rule 9): its ledger filed as `poolSeries`
// files it, and the funded and displaced homes its series counted (rule 2).
import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import { poolSeries } from '$lib/sim/scenario/finance-score';
import { monthsOf } from '$lib/sim/scenario/score';
import { fundOf } from '../funding/columns';
import { NO_DAY } from '../types';
import type { Extras } from './series';
import type { MoneyFeed, MoneyRow } from './types';

/**
 * The plan world's money rows for final months `from..through`. The pools' series come from all of
 * its ledger (`feed.ledger`, since month 0) through the last day of month `through`; the
 * pools, programmes, slope and terms are `feed.finance`'s (the same ids and order in every frame)
 * with no off spans, which `poolSeries` does not read. Each pool's `closed` and `shut` are read
 * from the world's shut rows at the last day of the month: `closed` is the first shut row's
 * `shutFrom` once its spent day (`shutFrom - 1`) is within the month, `shut` holds while some such
 * row is not yet open again; a world without funding columns gives null and false. `publicSpent` is `spent + lostCredit` over
 * every pool, summed as `moneyOf` sums it.
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
  // Each pool's shut rows, oldest first, as the world's columns hold them; none on a world
  // without funding columns.
  const shuts = new Map<string, { from: number; to: number }[]>();
  const columns = feed.world.pools;
  if ('shutN' in columns) {
    const p = fundOf(feed.world).pools;
    for (let k = 0; k < p.shutN; k++) {
      const id = p.id[p.shutRow[k]];
      const rows = shuts.get(id) ?? shuts.set(id, []).get(id)!;
      rows.push({ from: p.shutFrom[k], to: p.shutTo[k] });
    }
  }
  const out: MoneyRow[] = [];
  for (let i = from; i <= through; i++) {
    let publicSpent = 0;
    for (const q of pools) publicSpent = publicSpent + q.spent[i] + q.lostCredit[i];
    const h = homes[i - from];
    const last = addMonths(firstOfMonth(asOf), i + 1) - 1;
    out.push({
      pools: pools.map((q) => {
        let closed: number | null = null;
        let shut = false;
        for (const s of shuts.get(q.id) ?? []) {
          if (s.from - 1 > last) continue;
          closed ??= s.from;
          if (s.to === NO_DAY || s.to > last) shut = true;
        }
        return {
          id: q.id,
          label: q.label,
          kind: q.kind,
          received: q.received[i],
          committed: q.committed[i],
          out: q.out[i],
          spent: q.spent[i],
          repaid: q.repaid[i],
          lost: q.lost[i],
          lostCredit: q.lostCredit[i],
          closed,
          shut
        };
      }),
      fundedHomes: h.funded,
      displacedHomes: h.displaced,
      displacedHomesCompleted: h.displacedCompleted,
      publicSpent
    });
  }
  return out;
}
