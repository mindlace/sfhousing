// The Funding tab's view model (funding-ui spec 4.5, 4.7, 4.8, 4.8a): baseline groups, the
// bundle on a day and its coverage steps, pool and programme previews, sentences and field
// sources. Pure. The page never adds shares itself: every coverage and per-home split here is
// `fundBundle`, the function the engine prices bundles with.
import {
  AVERAGE_DRAWN,
  CERTAIN_TOLERANCE,
  DEBT_LIMITS,
  DRAW_UP_FRONT,
  MARKET_TERMS,
  PROTOTYPES,
  coverage,
  debtService,
  fundBundle,
  grantEquivalentPerHome,
  isCertain,
  missingTerms,
  oddsShift,
  resolveTerms,
  termsNeeded,
  uncoveredPerHome,
  type BundleFunding,
  type BundleItem
} from '$lib/sim/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { CITY_POOL_KINDS } from '$lib/sim/scenario/finance-score';
import { inflowArrivals } from '$lib/sim/scenario/funding';
import {
  formatDollars,
  formatDollarsExact,
  formatMonthYear,
  formatOddsChange
} from '$lib/fzp/format';
import { HORIZON } from '$lib/fzp/time';
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import {
  INCOME_TIERS,
  type Calibration,
  type Day,
  type Dollars,
  type IncomeTier,
  type Instrument,
  type Pool,
  type PoolKind,
  type Programme,
  type ProjectKind,
  type Provenance,
  type TermKey
} from '$lib/timelapse/types';
import { GROUP_NAME, GUARANTEE_NEEDS_TERM, TERM_NAME, ratePercent } from './funding-copy';
import {
  valueSource,
  type FundingPreset,
  type PoolField,
  type ProgrammeField
} from './funding-presets';
import { POOL_KIND_DEFAULTS } from './funding-sources';

export type Baseline = NonNullable<Calibration['baselineFunding']>;
export type GroupId = 'city' | 'state' | 'federal';

/** The selected row in the tab. */
export type FundingRowId =
  { kind: 'baselineGroup'; group: 'city' | 'state' | 'federal' } | { kind: 'pool'; id: string };

/** The affordable bundle from a day on, priced by `fundBundle`, ignoring pool balances. */
export interface CoverageStep {
  from: Day;
  coverage: number;
  certain: boolean;
  /** Whole dollars: the sum of the City items' `grantEquivalent`. */
  cityPerHome: Dollars;
  /** Whole dollars: the sum of the City items' `lent`, shown apart. */
  cityLentPerHome: Dollars;
  /** The largest `minHomes` among the step's programmes. */
  minHomes: number;
}

export interface PoolPreview {
  perYear: Dollars | null;
  once: Dollars;
  repayment: { perYear: number; total: number } | null;
  lendingCap: Dollars | null;
}

export interface ProgrammePreview {
  kind: ProjectKind;
  perHome: { low: Dollars; high: Dollars };
  /** The item's `grantEquivalent` in today's bundle; null for private reach. */
  inBundle: Dollars | null;
  /** The item's `lent` in today's bundle; null for private reach. */
  lentInBundle: Dollars | null;
  coverage: { low: number; high: number };
  /** Log-odds shifts (format with `formatOddsChange`); null without a slope. */
  oddsChange: { low: number; high: number } | null;
  sourced: boolean;
  needsTerm: TermKey | null;
}

export type FieldSource =
  { kind: 'sourced'; provenance: Provenance } | { kind: 'custom' } | { kind: 'choice' };

/** City is `CITY_POOL_KINDS`; `state` and `federal` are their own groups. */
export function groupOf(kind: PoolKind): GroupId {
  if (CITY_POOL_KINDS.has(kind)) return 'city';
  return kind === 'state' ? 'state' : 'federal';
}

/** Baseline pools, then the added ones. */
export function poolsOf(f: FinanceLevers, baseline: Baseline | undefined): Pool[] {
  return [...(baseline?.pools ?? []), ...f.pools];
}

/** The latest `baselineScale` entry for `pool` at or before `day`, or undefined. */
function entryAt(f: FinanceLevers, pool: string, day: Day) {
  let best: FinanceLevers['baselineScale'][number] | undefined;
  for (const e of f.baselineScale) {
    if (e.pool === pool && e.from <= day && (best === undefined || e.from >= best.from)) best = e;
  }
  return best;
}

/** A pool is off on `day` when its latest entry at or before `day` has scale 0 (F7). */
export function isOff(f: FinanceLevers, pool: string, day: Day): boolean {
  return entryAt(f, pool, day)?.scale === 0;
}

const termsOf = (f: FinanceLevers) => resolveTerms(MARKET_TERMS, f.terms);

/**
 * The affordable bundle on `day`: baseline then added programmes reaching affordable homes,
 * active on `day`, whose pool is not off. A programme needing a term that resolves to null goes
 * to `needsTerm` instead of `items`, since pricing it would throw.
 */
export function bundleOn(
  f: FinanceLevers,
  baseline: Baseline | undefined,
  day: Day
): { programmes: Programme[]; items: BundleItem[]; needsTerm: { id: string; term: TermKey }[] } {
  const pools = new Map(poolsOf(f, baseline).map((p) => [p.id, p]));
  const terms = termsOf(f);
  const programmes: Programme[] = [];
  const items: BundleItem[] = [];
  const needsTerm: { id: string; term: TermKey }[] = [];
  for (const g of [...(baseline?.programmes ?? []), ...f.programmes]) {
    if (g.reach !== 'affordable' || g.from > day || (g.to !== null && g.to < day)) continue;
    const pool = pools.get(g.pool);
    if (pool === undefined || isOff(f, pool.id, day)) continue;
    const missing = missingTerms(g.instrument, terms);
    if (missing.length > 0) {
      needsTerm.push({ id: g.id, term: missing[0] });
      continue;
    }
    programmes.push(g);
    items.push({ instrument: g.instrument, poolKind: pool.kind });
  }
  return { programmes, items, needsTerm };
}

/** `bundleOn(day)` priced by `fundBundle` for an affordable home. */
export function priceOn(
  f: FinanceLevers,
  baseline: Baseline | undefined,
  day: Day
): { programmes: Programme[]; funding: BundleFunding } {
  const { programmes, items } = bundleOn(f, baseline, day);
  return { programmes, funding: fundBundle(items, 'affordable', PROTOTYPES[0], termsOf(f)) };
}

/** Sums of `grantEquivalent` and `lent` over the priced items whose pool is in `group`. */
function groupSums(
  f: FinanceLevers,
  baseline: Baseline | undefined,
  priced: { programmes: Programme[]; funding: BundleFunding },
  group: GroupId
): { perHome: number; lent: number } {
  const kinds = new Map(poolsOf(f, baseline).map((p) => [p.id, p.kind]));
  let perHome = 0;
  let lent = 0;
  priced.programmes.forEach((g, i) => {
    const kind = kinds.get(g.pool);
    if (kind === undefined || groupOf(kind) !== group) return;
    perHome += priced.funding.items[i].grantEquivalent;
    lent += priced.funding.items[i].lent;
  });
  return { perHome, lent };
}

function stepOn(f: FinanceLevers, baseline: Baseline, day: Day): CoverageStep {
  const priced = priceOn(f, baseline, day);
  const city = groupSums(f, baseline, priced, 'city');
  return {
    from: day,
    coverage: priced.funding.coverage,
    certain: isCertain(priced.funding.coverage),
    cityPerHome: Math.round(city.perHome),
    cityLentPerHome: Math.round(city.lent),
    minHomes: priced.programmes.reduce((m, g) => Math.max(m, g.minHomes), 0)
  };
}

/**
 * One step per day the affordable bundle changes, from `asOf` to `horizon`: candidate days are
 * every programme's `from`, every day after a `to`, and every `baselineScale` date; a step is
 * written only when the coverage or the City's part changes.
 */
export function coverageSteps(
  f: FinanceLevers,
  baseline: Baseline,
  asOf: Day,
  horizon: Day
): CoverageStep[] {
  const days = new Set<Day>();
  for (const g of [...baseline.programmes, ...f.programmes]) {
    if (g.reach !== 'affordable') continue;
    days.add(g.from);
    if (g.to !== null) days.add(g.to + 1);
  }
  for (const e of f.baselineScale) days.add(e.from);
  const candidates = [...days].filter((d) => d > asOf && d <= horizon).sort((a, b) => a - b);
  const steps = [stepOn(f, baseline, asOf)];
  for (const day of candidates) {
    const s = stepOn(f, baseline, day);
    const last = steps[steps.length - 1];
    if (
      Math.abs(s.coverage - last.coverage) > CERTAIN_TOLERANCE ||
      s.cityPerHome !== last.cityPerHome
    ) {
      steps.push(s);
    }
  }
  return steps;
}

/** Whether the bundle on `day` holds programmes of different `minHomes` (4.5, project size). */
export function coverageSizeMixed(
  f: FinanceLevers,
  baseline: Baseline | undefined,
  day: Day
): boolean {
  return new Set(bundleOn(f, baseline, day).programmes.map((g) => g.minHomes)).size > 1;
}

export interface BaselineGroup {
  group: GroupId;
  name: string;
  pools: Pool[];
  /** The yearly inflows in force at the present; null for the uncapped group. */
  perYear: Dollars | null;
  /** Every pool of the group is off at the present. */
  off: boolean;
  perHome: Dollars;
  lentPerHome: Dollars;
  /** The earliest dated change on the group's pools. */
  changesFrom: Day | null;
  /** The group's baseline programmes. */
  programmes: Programme[];
}

const GROUPS: GroupId[] = ['city', 'state', 'federal'];

/** Today's funding by group (4.5); groups with no pool are left out. */
export function baselineGroups(f: FinanceLevers, baseline: Baseline, asOf: Day): BaselineGroup[] {
  const priced = priceOn(f, baseline, asOf);
  const out: BaselineGroup[] = [];
  for (const group of GROUPS) {
    const pools = baseline.pools.filter((p) => groupOf(p.kind) === group);
    if (pools.length === 0) continue;
    const ids = new Set(pools.map((p) => p.id));
    let perYear: number | null = null;
    if (!pools.every((p) => p.uncapped)) {
      perYear = 0;
      for (const p of pools) {
        const scale = entryAt(f, p.id, asOf)?.scale ?? 1;
        for (const x of p.inflows) {
          if (x.kind === 'yearly' && x.from <= asOf && (x.to === null || x.to >= asOf)) {
            perYear += x.dollarsPerYear * scale;
          }
        }
      }
      perYear = Math.round(perYear);
    }
    const sums = groupSums(f, baseline, priced, group);
    const dates = f.baselineScale.filter((e) => ids.has(e.pool)).map((e) => e.from);
    out.push({
      group,
      name: GROUP_NAME[group],
      pools,
      perYear,
      off: pools.every((p) => isOff(f, p.id, asOf)),
      perHome: Math.round(sums.perHome),
      lentPerHome: Math.round(sums.lent),
      changesFrom: dates.length === 0 ? null : Math.min(...dates),
      programmes: baseline.programmes.filter((g) => ids.has(g.pool))
    });
  }
  return out;
}

export interface ScaleLine {
  group: GroupId;
  pools: string[];
  name: string;
  from: Day;
  scale: number;
  text: string;
}

const pctOfScale = (scale: number): string => ratePercent(scale);

/**
 * The dated changes on a group's pools, in date order (4.5 item 2). On the City group, entries
 * with the same `from` and `scale` on every City pool are one line, "City money".
 */
export function scaleLines(f: FinanceLevers, baseline: Baseline, group: GroupId): ScaleLine[] {
  const pools = baseline.pools.filter((p) => groupOf(p.kind) === group);
  const order = new Map(pools.map((p, i) => [p.id, i]));
  const byId = new Map(pools.map((p) => [p.id, p]));
  const entries = f.baselineScale.filter((e) => order.has(e.pool));
  const used = new Set<(typeof entries)[number]>();
  const raw: Omit<ScaleLine, 'text'>[] = [];
  if (group === 'city') {
    for (const e of entries) {
      if (used.has(e)) continue;
      const set = pools.map((p) =>
        entries.find((x) => x.pool === p.id && x.from === e.from && x.scale === e.scale)
      );
      if (set.every((x) => x !== undefined)) {
        set.forEach((x) => used.add(x!));
        raw.push({
          group,
          pools: pools.map((p) => p.id),
          name: 'City money',
          from: e.from,
          scale: e.scale
        });
      }
    }
  }
  for (const e of entries) {
    if (used.has(e)) continue;
    raw.push({
      group,
      pools: [e.pool],
      name: byId.get(e.pool)!.label,
      from: e.from,
      scale: e.scale
    });
  }
  raw.sort((a, b) => a.from - b.from || order.get(a.pools[0])! - order.get(b.pools[0])!);
  return raw.map((l) => {
    const when = `From ${formatMonthYear(l.from)}`;
    const uncapped = l.pools.every((id) => byId.get(id)!.uncapped);
    const prevZero = l.pools.every((id) => entryAt(f, id, l.from - 1)?.scale === 0);
    let text: string;
    if (l.scale === 0) text = `${when}: switched off`;
    else if (uncapped) text = `${when}: switched back on`;
    else
      text = `${when}: ${prevZero ? 'switched back on, ' : ''}${pctOfScale(l.scale)} of today's amount`;
    return { ...l, text };
  });
}

const TIER_WORD: Record<IncomeTier, string> = {
  veryLow: 'very low',
  low: 'low',
  moderate: 'moderate',
  aboveModerate: 'above moderate'
};

/** "52% very low, 31% low, 17% moderate": largest remainder, ties earlier, zeros dropped. */
export function tiersText(t: Record<IncomeTier, number>): string {
  const exact = INCOME_TIERS.map((k) => t[k] * 100);
  const whole = exact.map((x) => Math.floor(x + 1e-9));
  const total = Math.round(exact.reduce((s, x) => s + x, 0));
  let left = total - whole.reduce((s, x) => s + x, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, r: x - whole[i] }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    whole[i]++;
    left--;
  }
  return INCOME_TIERS.flatMap((k, i) =>
    whole[i] === 0 ? [] : [`${whole[i]}% ${TIER_WORD[k]}`]
  ).join(', ');
}

const firstInflowDay = (pool: Pool): Day | null =>
  pool.inflows.length === 0
    ? null
    : Math.min(...pool.inflows.map((x) => (x.kind === 'once' ? x.day : x.from)));

const INSTRUMENT_NAME: Record<Instrument['kind'], string> = {
  grant: 'Grant',
  loan: 'Loan',
  guarantee: 'Loan guarantee'
};

function instrumentTerms(inst: Instrument): string {
  switch (inst.kind) {
    case 'grant':
      return `${formatPercent(inst.share)} of the uncovered cost`;
    case 'loan':
      return (
        `${ratePercent(inst.costShare)} of the building cost at ${ratePercent(inst.rate)}` +
        (inst.requiredReturn === null
          ? ''
          : `, accepting a ${ratePercent(inst.requiredReturn)} return`)
      );
    case 'guarantee':
      return `${ratePercent(inst.costShare)} of the building cost, ${ratePercent(inst.reserve)} reserve`;
  }
}

/**
 * "{Instrument} to {reach} of {minHomes} homes or more{, from Month Year}{ until Month Year}:
 * {terms}" (4.8). The `from` clause is left out when it equals the pool's first inflow day.
 */
export function programmeSentence(g: Programme, pool: Pool): string {
  const reach = g.reach === 'affordable' ? 'affordable homes' : 'private projects';
  const from = g.from === firstInflowDay(pool) ? '' : `, from ${formatMonthYear(g.from)}`;
  const until = g.to === null ? '' : ` until ${formatMonthYear(g.to)}`;
  return (
    `${INSTRUMENT_NAME[g.instrument.kind]} to ${reach} of ${formatCount(g.minHomes)} homes or ` +
    `more${from}${until}: ${instrumentTerms(g.instrument)}`
  );
}

function inflowPhrase(x: Pool['inflows'][number]): string {
  if (x.kind === 'once') return `${formatDollars(x.dollars)} in ${formatMonthYear(x.day)}`;
  const until = x.to === null ? '' : ` until ${formatMonthYear(x.to)}`;
  return `${formatDollars(x.dollarsPerYear)} a year from ${formatMonthYear(x.from)}${until}`;
}

/** "$300 million in July 2028; repaid at 6% over 20 years" (4.14 item 3). */
export function poolMoneySentence(pool: Pool): string {
  const money =
    pool.uncapped && pool.inflows.length === 0
      ? 'no limit'
      : pool.inflows.map(inflowPhrase).join(', ');
  const debt =
    pool.debt === null
      ? ''
      : `; repaid at ${ratePercent(pool.debt.rate)} over ${pool.debt.termYears} years`;
  return `${money}${debt}`;
}

/**
 * The pool preview (4.7): yearly and once amounts, the repayment of what arrives from `asOf` to
 * the horizon, a bank's lending capacity on the same sum, and the preview's sentences. `sources`
 * holds the vote rule's provenance for a general-obligation bond.
 */
export function poolPreview(
  pool: Pool,
  asOf: Day
): PoolPreview & { lines: string[]; sources: Provenance[] } {
  let received = 0;
  let once = 0;
  let perYear: number | null = null;
  for (const x of pool.inflows) {
    const amount = x.kind === 'once' ? x.dollars : x.dollarsPerYear;
    received += inflowArrivals(x, asOf, HORIZON).length * amount;
    if (x.kind === 'once') once += x.dollars;
    else perYear = (perYear ?? 0) + x.dollarsPerYear;
  }
  const ds = pool.debt !== null && received > 0 ? debtService(received, pool.debt) : null;
  const repayment = ds === null ? null : { perYear: ds.annual, total: ds.total };
  const lendingCap = pool.kind === 'bank' ? Math.round(pool.leverage * received) : null;
  const lines = pool.inflows.slice(0, 3).map((x) => `Brings in ${inflowPhrase(x)}.`);
  if (pool.inflows.length > 3) {
    lines[2] = `${lines[2].slice(0, -1)}, and ${pool.inflows.length - 3} more.`;
  }
  if (repayment !== null && pool.debt !== null) {
    lines.push(
      `Repaying it costs about ${formatDollars(repayment.perYear)} a year for ` +
        `${pool.debt.termYears} years, ${formatDollars(repayment.total)} in all, in the dollars ` +
        'of the years it is paid (not adjusted for inflation).'
    );
  }
  const sources: Provenance[] = [];
  if (pool.kind === 'goBond') {
    lines.push('A City general-obligation bond needs two-thirds of voters.');
    sources.push(DEBT_LIMITS.goVote.provenance);
  }
  if (lendingCap !== null) lines.push(`Can have up to ${formatDollars(lendingCap)} lent at once.`);
  return { perYear, once, repayment, lendingCap, lines, sources };
}

const range = (lo: string, hi: string): string => (lo === hi ? lo : `${lo} to ${hi}`);

/** `f` with `g` in it (replacing the programme of the same id) and `pool` among its pools. */
function withProgramme(
  f: FinanceLevers,
  baseline: Baseline,
  g: Programme,
  pool: Pool
): FinanceLevers {
  const isBaseline = baseline.programmes.some((x) => x.id === g.id);
  const known = poolsOf(f, baseline).some((p) => p.id === pool.id);
  const programmes = isBaseline
    ? f.programmes
    : f.programmes.some((x) => x.id === g.id)
      ? f.programmes.map((x) => (x.id === g.id ? g : x))
      : [...f.programmes, g];
  return { ...f, pools: known ? f.pools : [...f.pools, pool], programmes };
}

/**
 * The programme preview (4.8). Affordable: exact per home alone, and its item in the bundle on
 * the later of `asOf` and its `from`. Private: a range over the prototypes, with the odds change
 * from `slope`. `sources` are the sourced, untyped terms it reads, then the draw assumption for a
 * loan or guarantee.
 */
export function programmePreview(
  g: Programme,
  pool: Pool,
  f: FinanceLevers,
  baseline: Baseline,
  asOf: Day,
  slope: number | null
): ProgrammePreview & { lines: string[]; sources: Provenance[] } {
  const terms = termsOf(f);
  const kind: ProjectKind = g.reach === 'affordable' ? 'affordable' : 'market';
  const inst = g.instrument;
  const needed = termsNeeded(inst);
  const sourced = needed.every((k) => !terms.custom.includes(k));
  const missing = missingTerms(inst, terms);
  if (missing.length > 0) {
    const term = missing[0];
    return {
      kind,
      perHome: { low: 0, high: 0 },
      inBundle: null,
      lentInBundle: null,
      coverage: { low: 0, high: 0 },
      oddsChange: null,
      sourced,
      needsTerm: term,
      lines: [
        term === 'guaranteeRateCut'
          ? GUARANTEE_NEEDS_TERM
          : `This programme needs a ${TERM_NAME[term]}: enter one under Market terms you set.`
      ],
      sources: []
    };
  }

  const sources: Provenance[] = [];
  for (const k of needed) {
    const e = MARKET_TERMS[k];
    if ('provenance' in e && !terms.custom.includes(k)) sources.push(e.provenance);
  }
  const lendsOrGuarantees = inst.kind !== 'grant';
  if (lendsOrGuarantees) sources.push(DRAW_UP_FRONT.provenance, AVERAGE_DRAWN.provenance);

  const lines: string[] = [];
  let out: ProgrammePreview;
  if (kind === 'affordable') {
    const p = PROTOTYPES[0];
    const perHome = grantEquivalentPerHome(inst, 'affordable', p, terms);
    const cov = coverage(perHome, 'affordable', p);
    lines.push(
      `On its own it pays ${formatDollarsExact(perHome)} of each affordable home, ` +
        `${formatPercent(cov)} of its uncovered cost.`
    );
    const day = Math.max(asOf, g.from);
    const priced = priceOn(withProgramme(f, baseline, g, pool), baseline, day);
    const i = priced.programmes.findIndex((x) => x.id === g.id);
    let inBundle: number | null = null;
    let lentInBundle: number | null = null;
    if (i >= 0) {
      inBundle = Math.round(priced.funding.items[i].grantEquivalent);
      lentInBundle = Math.round(priced.funding.items[i].lent);
      const when = formatMonthYear(day);
      if (inBundle === 0) {
        lines.push(
          `With the other money on offer from ${when}, it pays nothing: federal and state money ` +
            'already cover the whole cost.'
        );
      } else {
        lines.push(
          `With the other money on offer from ${when}, it pays ${formatDollarsExact(inBundle)}.`
        );
        if (inst.kind === 'loan') {
          lines.push(`It lends ${formatDollarsExact(lentInBundle)} a home, repaid at completion.`);
        }
        // Compare exact amounts, with half a dollar of slack, so rounding never reads as a cut.
        const alone = inst.kind === 'grant' ? inst.share * uncoveredPerHome('affordable', p) : 0;
        if (inst.kind === 'grant' && priced.funding.items[i].grantEquivalent < alone - 0.5) {
          lines.push(
            groupOf(pool.kind) === 'city'
              ? "Federal and state money count first, and the City's sources share what is " +
                  `left, so in this bundle it pays ${formatDollarsExact(inBundle)} of its ` +
                  `${formatDollarsExact(perHome)}.`
              : `Its tier covers more than is left, so it pays ${formatDollarsExact(inBundle)}.`
          );
        }
      }
    }
    out = {
      kind,
      perHome: { low: perHome, high: perHome },
      inBundle,
      lentInBundle,
      coverage: { low: cov, high: cov },
      oddsChange: null,
      sourced,
      needsTerm: null
    };
  } else {
    const rows = PROTOTYPES.map((p) => {
      const ge = grantEquivalentPerHome(inst, 'market', p, terms);
      const cov = coverage(ge, 'market', p);
      return { p, ge, cov, shift: slope === null ? null : oddsShift(ge, 'market', p, slope) };
    });
    const ges = rows.map((r) => r.ge);
    const covs = rows.map((r) => r.cov);
    const open = rows.filter((r) => !isCertain(r.cov) && r.shift !== null);
    const shifts = open.map((r) => r.shift as number);
    const oddsChange =
      shifts.length === 0 ? null : { low: Math.min(...shifts), high: Math.max(...shifts) };
    const lo = Math.min(...ges);
    const hi = Math.max(...ges);
    lines.push(
      `Worth ${range(formatDollarsExact(lo), formatDollarsExact(hi))} a home to a private ` +
        `project, ${range(formatPercent(Math.min(...covs)), formatPercent(Math.max(...covs)))} ` +
        'of what it is short.'
    );
    if (oddsChange !== null) {
      lines.push(
        `Raises its chance of starting by ${range(
          formatOddsChange(oddsChange.low),
          formatOddsChange(oddsChange.high)
        )}.`
      );
    }
    for (const r of rows) {
      if (!isCertain(r.cov)) continue;
      lines.push(
        `It fully covers a ${r.p.stories}-storey building of ${formatCount(r.p.homes)} homes: ` +
          'it gets built if a lot is free.'
      );
    }
    out = {
      kind,
      perHome: { low: lo, high: hi },
      inBundle: null,
      lentInBundle: null,
      coverage: { low: Math.min(...covs), high: Math.max(...covs) },
      oddsChange,
      sourced,
      needsTerm: null
    };
  }
  if (lendsOrGuarantees) {
    lines.push(
      'Counted for what it saves the project in interest while the loan is drawn, by arithmetic ' +
        "on market terms; no study has measured a public loan's effect on building."
    );
  }
  return { ...out, lines, sources };
}

const PRESET_SUFFIX = /^\d+$/;

const isPresetMade = (id: string, presets: FundingPreset[]): boolean =>
  presets.some((p) => {
    const prefix = `u-${p.id}-`;
    return id.startsWith(prefix) && PRESET_SUFFIX.test(id.slice(prefix.length));
  });

/**
 * Where a field's value comes from (4.7): on a preset-made item, `valueSource`; on a hand-made
 * item, an evidence field (debt rate and term, lending per dollar, a loan's rate) is sourced
 * while it equals a `Sourced` `POOL_KIND_DEFAULTS[poolKind]` entry, else custom; every other
 * field of a hand-made item is a choice. A hand-made programme's `tiers` also returns `choice`
 * here: spec 4.8 makes the income mix evidence while it equals the baseline tiers, and the caller
 * (the programme editor) makes that comparison, since this function has no baseline.
 */
export function fieldSource(
  item: Pool | Programme,
  field: PoolField | ProgrammeField,
  presets: FundingPreset[],
  poolKind: PoolKind
): FieldSource {
  if (isPresetMade(item.id, presets)) {
    const v = valueSource(item, field, presets);
    return v === 'custom' ? { kind: 'custom' } : { kind: 'sourced', provenance: v };
  }
  const d = POOL_KIND_DEFAULTS[poolKind];
  const isPool = 'inflows' in item;
  if (field === 'debt.rate' || field === 'debt.termYears') {
    const key = field === 'debt.rate' ? 'rate' : 'termYears';
    const e = d.debt;
    if (!isPool || e === null || !('provenance' in e) || item.debt === null)
      return { kind: 'custom' };
    return item.debt[key] === e.value[key]
      ? { kind: 'sourced', provenance: e.provenance }
      : { kind: 'custom' };
  }
  if (field === 'leverage') {
    const e = d.leverage;
    if (!isPool || e === null || !('provenance' in e)) return { kind: 'custom' };
    return item.leverage === e.value
      ? { kind: 'sourced', provenance: e.provenance }
      : { kind: 'custom' };
  }
  if (field === 'instrument.rate') {
    const e = d.loanRate;
    if (isPool || item.instrument.kind !== 'loan' || !('provenance' in e))
      return { kind: 'custom' };
    return item.instrument.rate === e.value
      ? { kind: 'sourced', provenance: e.provenance }
      : { kind: 'custom' };
  }
  return { kind: 'choice' };
}

const TERM_KEYS = Object.keys(MARKET_TERMS) as TermKey[];

/** One instrument of each kind, shaped so `termsNeeded` lists every term that kind can read. */
const SAMPLE: Record<Instrument['kind'], Instrument> = {
  grant: { kind: 'grant', share: 1 },
  loan: { kind: 'loan', costShare: 1, rate: 0, requiredReturn: 0.05 },
  guarantee: { kind: 'guarantee', costShare: 1, reserve: 0 }
};

/**
 * The rows of "Market terms you set" (4.8a): a term is offered when it is `Unsourced` and some
 * offered instrument needs it, or when the policy holds a typed value for it. `inUse` is whether
 * an added programme's instrument reads it.
 */
export function termRows(
  f: FinanceLevers,
  offered: readonly Instrument['kind'][]
): {
  key: TermKey;
  typed: number | null;
  sourced: Provenance | null;
  sourcedValue: number | null;
  inUse: boolean;
}[] {
  const needed = new Set(offered.flatMap((k) => termsNeeded(SAMPLE[k])));
  return TERM_KEYS.flatMap((key) => {
    const e = MARKET_TERMS[key];
    const typed = f.terms[key] ?? null;
    if (!((e.value === null && needed.has(key)) || typed !== null)) return [];
    return [
      {
        key,
        typed,
        sourced: 'provenance' in e ? e.provenance : null,
        sourcedValue: e.value,
        inUse: f.programmes.some((g) => termsNeeded(g.instrument).includes(key))
      }
    ];
  });
}

/**
 * The baseline provenance a group's editor lists (4.5 item 5): the entries the pipeline labels
 * "{pool label}: …" for the group's pools, then the entries that name no baseline pool (the
 * income mix and smallest size), which hold for every group.
 */
export function groupProvenance(baseline: Baseline, group: GroupId): Provenance[] {
  const names = (pools: Pool[]) => pools.map((p) => `${p.label}:`);
  const own = names(baseline.pools.filter((p) => groupOf(p.kind) === group));
  const all = names(baseline.pools);
  const has = (pv: Provenance, prefixes: string[]) => prefixes.some((n) => pv.label.includes(n));
  return [
    ...baseline.provenance.filter((pv) => has(pv, own)),
    ...baseline.provenance.filter((pv) => !has(pv, all))
  ];
}
