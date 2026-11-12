/**
 * The Results rows' public money and income tiers at one month (funding-ui spec 4.11), and the
 * market paragraph's text (4.12). Pure. Every value is read at the month index the caller passes,
 * the scrubbed month, never past the high-water mark; only the limit statements are not series.
 * The per-home figures are `finance-score`'s `perAddedHome`: nothing here divides.
 */
import { DISPLACEMENT_RANGE } from '$lib/sim/finance';
import { marketLevel } from '$lib/sim/scenario/market';
import {
  CITY_POOL_KINDS,
  cityOf,
  displacedShare,
  owedAt,
  perAddedHome,
  type Money
} from '$lib/sim/scenario/finance-score';
import type { TimelineScore } from '$lib/sim/protocol';
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import { MARKET_FUNDING_SENTENCE } from '$lib/sim-page/funding-copy';
import {
  INCOME_TIERS,
  type Calibration,
  type Dollars,
  type IncomeTier,
  type LimitStatement,
  type Pool,
  type PoolKind,
  type Provenance
} from '$lib/timelapse/types';
import { formatDollars, formatDollarsExact, formatSourcePercent } from './format';
import { marketSentence } from './market-view';

export interface MoneyAt {
  spent: Dollars;
  citySpent: Dollars;
  perAddedHome: Dollars | null;
  cityPerAddedHome: Dollars | null;
  fundedHomes: number;
  displacedHomes: number;
  pools: {
    id: string;
    label: string;
    kind: PoolKind;
    received: Dollars;
    spent: Dollars;
    out: Dollars;
    repaid: Dollars;
    lost: Dollars;
    lostCredit: Dollars;
  }[];
}

export interface TiersAt {
  rows: { tier: IncomeTier; homes: number; target: number; fraction: number }[];
  unrecorded: number;
  affordable: number;
}

type Tiers = NonNullable<TimelineScore['tiers']>;

/** The money series at month `i`. */
export function moneyAt(money: Money, i: number): MoneyAt {
  return {
    spent: money.publicSpent[i],
    citySpent: cityOf(money, i),
    perAddedHome: perAddedHome(money, i, 'all'),
    cityPerAddedHome: perAddedHome(money, i, 'city'),
    fundedHomes: money.fundedHomes[i],
    displacedHomes: money.displacedHomes[i],
    pools: money.pools.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      received: p.received[i],
      spent: p.spent[i],
      out: p.out[i],
      repaid: p.repaid[i],
      lost: p.lost[i],
      lostCredit: p.lostCredit[i]
    }))
  };
}

/** Homes by income tier at month `i`: the dataset's baseline plus what the run completed. */
export function tiersAt(tiers: Tiers, i: number): TiersAt {
  const c = tiers.completed[i];
  const b = tiers.baseline;
  const rows = INCOME_TIERS.map((tier) => {
    const t = tiers.targets.find((x) => x.target.tier === tier);
    if (!t) throw new Error(`tiers.targets has no ${tier} target`);
    return { tier, homes: b[tier] + c[tier], target: t.target.units, fraction: t.fraction[i] };
  });
  const unrecorded = b.unrecorded + c.unrecorded;
  const affordable = b.veryLow + c.veryLow + b.low + c.low + b.moderate + c.moderate + unrecorded;
  return { rows, unrecorded, affordable };
}

/** "Very low", "Low", ...: the tier table's row names. */
export const TIER_NAME: Record<IncomeTier, string> = {
  veryLow: 'Very low',
  low: 'Low',
  moderate: 'Moderate',
  aboveModerate: 'Above moderate'
};

const perHome = (x: Dollars | null): string =>
  x === null ? 'no homes added yet' : `${formatDollarsExact(x)} per added home`;

/** The City's line, or null when no pool is the City's. */
export function cityLine(m: MoneyAt): string | null {
  if (!m.pools.some((p) => CITY_POOL_KINDS.has(p.kind))) return null;
  return `City money: ${perHome(m.cityPerAddedHome)} · ${formatDollars(m.citySpent)} spent so far`;
}

/** All public money's line; `publicSpent` is `money.publicSpent[i]`, as F14 defines it. */
export function allLine(m: MoneyAt, publicSpent: number): string {
  return `All public money: ${perHome(m.perAddedHome)} · ${formatDollars(publicSpent)} spent so far`;
}

/**
 * Grants paid to projects that stopped after construction began (OD-F8): the sum over pools of
 * `lost - lostCredit`. Null when that is 0 or when nothing is counted as lost (`lossOnExit` 0).
 */
export function lostGrantsLine(m: MoneyAt, lossOnExit: number): string | null {
  const sum = m.pools.reduce((s, p) => s + p.lost - p.lostCredit, 0);
  if (sum <= 0 || lossOnExit <= 0) return null;
  const counted =
    lossOnExit >= 1 ? 'counted as lost' : `${formatPercent(lossOnExit)} counted as lost`;
  return `Grants paid to projects that stopped after construction began, ${counted} (assumption): ${formatDollars(sum)}. They are in Spent.`;
}

/** Funded and added homes; "added" is funded less displaced (F14), a subtraction only. */
export function fundedLine(m: MoneyAt): string {
  return `Funded homes finished: ${formatCount(m.fundedHomes)}. Added homes: ${formatCount(m.fundedHomes - m.displacedHomes)}.`;
}

/** The displaced homes beside the published range; the share is `displacedShare`. */
export function displacementLine(money: Money, i: number): string {
  const share = displacedShare(money, i);
  const pct = share === null ? '' : ` (${formatPercent(share)} of funded homes)`;
  const { low, high } = DISPLACEMENT_RANGE.value;
  const tier = DISPLACEMENT_RANGE.provenance.tier;
  return (
    `Private homes these projects took the place of: ${formatCount(money.displacedHomes[i])}${pct}. ` +
    `Studies outside San Francisco find ${formatSourcePercent(low)} to ${formatSourcePercent(high)} ` +
    `(tier ${tier}); none has measured San Francisco.`
  );
}

/** One line per `owed` entry whose pool has borrowed by month `i`, read through `owedAt`. */
export function owedLines(money: Money, i: number): string[] {
  const out: string[] = [];
  for (const entry of money.owed) {
    const pool = money.pools.find((p) => p.id === entry.pool);
    if (!pool) continue;
    const received = pool.received[i];
    if (received <= 0) continue;
    out.push(
      `${pool.label}: ${formatDollars(received)} borrowed, ${formatDollars(owedAt(entry, received))} to repay over the years it is paid (not adjusted for inflation).`
    );
  }
  return out;
}

/** The limit statements, exceeded first, each with its visible word. Not series: no month. */
export function limitLines(
  limits: readonly LimitStatement[]
): { word: 'Over:' | 'Within:'; text: string; provenance: Provenance }[] {
  const line = (l: LimitStatement) => ({
    word: l.exceeded ? ('Over:' as const) : ('Within:' as const),
    text: l.text,
    provenance: l.provenance
  });
  return [...limits.filter((l) => l.exceeded), ...limits.filter((l) => !l.exceeded)].map(line);
}

export type SourceColumn = 'received' | 'spent' | 'out' | 'repaid' | 'lostCredit';

const COLUMNS: readonly SourceColumn[] = ['received', 'spent', 'out', 'repaid', 'lostCredit'];

/** The "By source" table's header for each column. */
export const COLUMN_NAME: Record<SourceColumn, string> = {
  received: 'Received',
  spent: 'Spent',
  out: 'Lent out',
  repaid: 'Repaid',
  lostCredit: 'Loans and guarantees lost'
};

/**
 * The "By source" columns at the month, a column whose every value is 0 dropped, except that
 * Received stays while a pool of the run is uncapped: its cell reads "no limit" (4.11).
 */
export function bySourceColumns(
  m: MoneyAt,
  uncapped: ReadonlySet<string> = new Set()
): SourceColumn[] {
  const anyUncapped = m.pools.some((p) => uncapped.has(p.id));
  return COLUMNS.filter(
    (c) => (c === 'received' && anyUncapped) || m.pools.some((p) => p[c] !== 0)
  );
}

/**
 * The ids of the pools that can always pay, read from `Pool.uncapped` (F5): pass the calibration's
 * baseline pools and the shown levers' added pools. The run's money series carries no flag.
 */
export function uncappedPoolIds(...lists: (readonly Pool[] | undefined)[]): ReadonlySet<string> {
  return new Set(
    lists
      .flatMap((l) => l ?? [])
      .filter((p) => p.uncapped)
      .map((p) => p.id)
  );
}

/** "Homes by income level", F13 and OD-F10: funded homes go to the paying programmes' levels. */
export const TIERS_FUNDED_SENTENCE =
  "A fully funded affordable project's homes are counted in the income levels of the programmes that pay it, in proportion to what each pays.";

/** "Homes by income level", F13: unrecorded levels are never guessed; inclusionary homes. */
export const TIERS_UNRECORDED_SENTENCE =
  'Homes in real projects whose records give no income level are counted here and never guessed into a level. Private projects of 10 homes or more count their on-site affordable homes at the legal rate, assuming they build them on site (tier 2).';

/** "Affordable homes so far: {n}": very low, low, moderate and not recorded. */
export function affordableLine(t: TiersAt): string {
  return `Affordable homes so far: ${formatCount(t.affordable)}`;
}

/**
 * The Results' market paragraph (4.12): `marketSentence` at `marketLevel`'s level, with
 * `MARKET_FUNDING_SENTENCE` appended when the private level runs. Null without a market model.
 */
export function marketText(cal: Calibration): string | null {
  const level = marketLevel(cal);
  const s = marketSentence(cal, level);
  if (s === null) return null;
  return level === 'private' ? `${s} ${MARKET_FUNDING_SENTENCE}` : s;
}
