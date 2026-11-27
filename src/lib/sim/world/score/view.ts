import { debtService } from '$lib/sim/finance';
import { displacedShare, perAddedHome, type Money } from '$lib/sim/world/score/finance';
import { targetsOf, tierTargetsOf } from '$lib/sim/world/score/targets';
import type {
  CarRow,
  CarsView,
  MoneyRow,
  MoneyView,
  ScoreStatics,
  SeriesChunk,
  TimelineView
} from './types';

/**
 * The plan world's money as of month `rows.length - 1` (rule 12): today's
 * `TimelineScore['money']` with its series cut there, `owed` on each debt pool's `received` that
 * month, and `limits` the statics' (fixed as the forecast fills). `perAddedHome` and
 * `displacedShare` are today's, read that month over a money whose displaced homes are those of
 * completed funded projects (`displacedHomesCompleted`), paired with `fundedHomes`; the `ByMonth`
 * series give the same figures read at each month, the last entry the scalar. `closed` is each
 * pool's value in the last row and `shut` its value in every row (a row without them reads as null
 * and false).
 */
function moneyViewOf(rows: MoneyRow[], statics: ScoreStatics): MoneyView {
  const limits = statics.limits;
  const debts = statics.debts;
  if (limits === null || debts === null) {
    throw new Error('world-score: money in the chunks but no finance in the statics');
  }
  const pools: MoneyView['pools'] = rows[0].pools.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    received: [],
    committed: [],
    out: [],
    spent: [],
    repaid: [],
    lost: [],
    lostCredit: []
  }));
  for (const r of rows) {
    r.pools.forEach((p, q) => {
      const s = pools[q];
      s.received.push(p.received);
      s.committed.push(p.committed);
      s.out.push(p.out);
      s.spent.push(p.spent);
      s.repaid.push(p.repaid);
      s.lost.push(p.lost);
      s.lostCredit.push(p.lostCredit);
    });
  }
  const last = rows.length - 1;
  const closed: MoneyView['closed'] = {};
  const shut: MoneyView['shut'] = {};
  rows[0].pools.forEach((p, q) => {
    closed[p.id] = rows[last].pools[q].closed ?? null;
    shut[p.id] = rows.map((r) => r.pools[q].shut ?? false);
  });
  const owed: MoneyView['owed'] = [];
  const debtOf = new Map(debts.map((d) => [d.pool, d.debt]));
  for (const p of pools) {
    const debt = debtOf.get(p.id);
    if (debt === undefined) continue;
    const principal = p.received[last];
    owed.push({
      pool: p.id,
      principal,
      repayment: debtService(principal, debt).total,
      nominal: true
    });
  }
  const money: Money = {
    pools,
    fundedHomes: rows.map((r) => r.fundedHomes),
    displacedHomes: rows.map((r) => r.displacedHomes),
    publicSpent: rows.map((r) => r.publicSpent),
    owed,
    limits
  };
  const displacedHomesCompleted = rows.map((r) => r.displacedHomesCompleted);
  const paired: Money = { ...money, displacedHomes: displacedHomesCompleted };
  const all: (number | null)[] = [];
  const city: (number | null)[] = [];
  const share: (number | null)[] = [];
  for (let i = 0; i <= last; i++) {
    all.push(perAddedHome(paired, i, 'all'));
    city.push(perAddedHome(paired, i, 'city'));
    share.push(displacedShare(paired, i));
  }
  return {
    ...money,
    displacedHomesCompleted,
    perAddedHome: { all: all[last], city: city[last] },
    displacedShare: share[last],
    perAddedHomeByMonth: { all, city },
    displacedShareByMonth: share,
    closed,
    shut
  };
}

function carsViewOf(rows: CarRow[]): CarsView {
  return {
    households: rows.map((r) => r.households),
    cars: rows.map((r) => r.cars),
    carless: rows.map((r) => r.carless),
    perHousehold: rows.map((r) => (r.households === 0 ? null : r.cars / r.households)),
    spacesPerHome: rows.map((r) => r.spacesPerHome),
    zones: rows.map((r) => r.zones)
  };
}

/** Joins contiguous chunks into what the page reads. Throws on a gap, an overlap or a late start. */
export function viewOf(chunks: SeriesChunk[], statics: ScoreStatics): TimelineView {
  const rows: TimelineView['rows'] = [];
  const planEffect: TimelineView['planEffect'] = [];
  const tiers: NonNullable<TimelineView['tiers']> = [];
  const money: MoneyRow[] = [];
  const waiting: number[] = [];
  const carRows: CarRow[] = [];
  let hasCars = chunks.length > 0;
  let anyCars = false;
  let hasTiers = chunks.length > 0;
  let hasMoney = chunks.length > 0;
  let hasWaiting = chunks.length > 0;
  for (const c of chunks) {
    if (c.from !== rows.length) {
      throw new Error(`chunk from ${c.from} does not follow ${rows.length - 1}`);
    }
    for (let i = 0; i < c.rows.length; i++) {
      rows.push(c.rows[i]);
      planEffect.push(c.planEffect[i]);
    }
    if (c.tiers) tiers.push(...c.tiers);
    else hasTiers = false;
    if (c.money) money.push(...c.money);
    else hasMoney = false;
    if (c.waiting) waiting.push(...c.waiting);
    else hasWaiting = false;
    if (c.cars) {
      carRows.push(...c.cars);
      anyCars = true;
    } else hasCars = false;
  }
  if (anyCars && !hasCars) throw new Error('world-score: chunks mix cars and no cars');
  const { units, since, provenance } = statics.baseline;
  const tierSeries = hasTiers ? tiers : null;
  return {
    months: statics.months,
    lastIndex: statics.lastIndex,
    filledThrough: rows.length - 1,
    rows,
    planEffect,
    targets: targetsOf(units, rows),
    tierTargets:
      statics.tierBaseline && tierSeries ? tierTargetsOf(statics.tierBaseline, tierSeries) : null,
    money: hasMoney && money.length > 0 ? moneyViewOf(money, statics) : null,
    tiers: tierSeries,
    cars: hasCars ? carsViewOf(carRows) : null,
    waitingMoney: hasMoney && money.length > 0 && hasWaiting ? waiting : null,
    baseline: { completedNet: units, since, provenance },
    phasing: statics.phasing,
    references: statics.references,
    compare: statics.compare
  };
}

/** The chunks' months before `k`: whole chunks kept, the one straddling `k` trimmed (rule 13). */
export function chunksBefore(chunks: SeriesChunk[], k: number): SeriesChunk[] {
  const out: SeriesChunk[] = [];
  for (const c of chunks) {
    if (c.from >= k) break;
    const n = k - c.from;
    if (n >= c.rows.length) {
      out.push(c);
      continue;
    }
    out.push({
      from: c.from,
      rows: c.rows.slice(0, n),
      planEffect: c.planEffect.slice(0, n),
      money: c.money && c.money.slice(0, n),
      tiers: c.tiers && c.tiers.slice(0, n),
      cars: c.cars && c.cars.slice(0, n),
      waiting: c.waiting ? c.waiting.slice(0, n) : null
    });
  }
  return out;
}
