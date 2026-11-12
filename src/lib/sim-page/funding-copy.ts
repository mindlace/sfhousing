// Every string of the Funding tab, the policy summary and the card line (funding-ui spec 4.1):
// kind names, coverage sentences, validation messages and the undo labels of table 4.9. Pure.
import { formatDollars, formatDollarsExact, formatMonthYear } from '$lib/fzp/format';
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import type { Day, PoolKind, TermKey } from '$lib/timelapse/types';
import type { FundingLoadReport } from './funding-reconcile';
import type { CoverageStep, GroupId } from './funding-view';
import type { SimNotice } from './sim-session';

const plain = (max: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: max });
const upTo2 = plain(2);
const upTo6 = plain(6);

/** A rate or a stored fraction as a percent with up to two decimals: 0.0613 is "6.13%". */
export const ratePercent = (x: number): string => `${upTo2.format(x * 100)}%`;

/** Kind names: the "Kind of money" select's options (4.7). */
export const KIND_NAME: Record<PoolKind, string> = {
  goBond: 'City housing bond (general obligation)',
  cop: 'City lease financing (certificates of participation)',
  generalRevenue: 'City general fund',
  dedicatedTax: 'A dedicated City tax',
  bank: 'Public bank',
  state: 'State money',
  federal: 'Federal money'
};

/** Short kinds for generated pool names, "City bond, 2028" (4.9). */
export const SHORT_KIND: Record<PoolKind, string> = {
  goBond: 'City bond',
  cop: 'City lease financing',
  generalRevenue: 'City general fund',
  dedicatedTax: 'City tax',
  bank: 'Public bank',
  state: 'State money',
  federal: 'Federal money'
};

/** The three baseline groups' row names (4.5). */
export const GROUP_NAME: Record<GroupId, string> = {
  city: 'City',
  state: 'State',
  federal: 'Federal tax credits'
};

/** Who a programme on a baseline group's pool is "Added to" (4.13, 4.14). */
export const GROUP_OWNER: Record<GroupId, string> = {
  city: 'the City',
  state: 'the state',
  federal: 'federal tax credits'
};

/** Market term names (4.8a, 4.15). */
export const TERM_NAME: Record<TermKey, string> = {
  constructionRate: 'construction loan rate',
  constructionYears: 'construction years',
  requiredReturn: 'required return',
  guaranteeRateCut: 'guarantee rate cut',
  lossOnExit: 'loss on exit'
};

// --- The coverage line and its disclosure (4.5) ---

/** The line at the top of the tab, for the step in force at the present. */
export function coverageLineText(step: CoverageStep): string {
  return step.certain
    ? 'Affordable homes: fully funded today'
    : `Affordable homes: ${formatPercent(step.coverage)} of the cost is covered today; they start only by chance`;
}

/**
 * One line of "Coverage over time". `sizeClause` adds "for projects of {minHomes} homes or more",
 * for a step whose programmes have different `minHomes` (`coverageSizeMixed`).
 */
export function coverageStepText(step: CoverageStep, sizeClause = false): string {
  const size = sizeClause ? `, for projects of ${step.minHomes} homes or more` : '';
  const head = step.certain ? 'fully funded' : `${formatPercent(step.coverage)}, not fully funded`;
  const lends =
    step.cityLentPerHome > 0
      ? `; it also lends ${formatDollarsExact(step.cityLentPerHome)} a home, repaid at completion`
      : '';
  return (
    `From ${formatMonthYear(step.from)}${size}: ${head}; the City pays ` +
    `${formatDollarsExact(step.cityPerHome)} of each home${lends}`
  );
}

export const COVERAGE_RUN_SENTENCE =
  'Whether the money lasts, and how many homes it pays for, is what a run shows.';
export const COVERAGE_RULE_SENTENCE =
  "Federal and state money count first. The City's sources share what is left.";
export const COVERAGE_OFF_SHORT_SENTENCE =
  'Switching a source off takes it out of every offer, so projects go ahead on the rest, at ' +
  'lower odds. A source that is on but has run short makes projects wait for it; how long is ' +
  'what a run shows.';
export const COVERAGE_SIZE_SENTENCE =
  'Smaller projects get only the programmes that reach their size.';
export const COVERAGE_PRIVATE_SENTENCE =
  "Private projects are not covered by today's funding; programmes you add for them show " +
  'their own effect.';

/** Appended to the market paragraph when the private level runs (4.12), verbatim. */
export const MARKET_FUNDING_SENTENCE =
  "Today's public funding is part of every run, including the comparison with FZP as written, " +
  'and the 100% affordable homes it pays for start because of it, so nothing is counted twice; ' +
  'the comparison shows what your changes add.';

// --- Group rows and their editor (4.5) ---

export const groupPaysText = (perHome: number): string =>
  `pays ${formatDollarsExact(perHome)} of each home`;
export const groupLendsText = (lent: number): string =>
  `lends ${formatDollarsExact(lent)} a home, repaid at completion`;
export const groupChangesText = (from: Day): string => `Changes from ${formatMonthYear(from)}`;
export const perYearText = (dollars: number): string => `${formatDollars(dollars)} a year`;
export const NO_LIMIT = 'no limit';
export const SWITCHED_OFF = 'switched off';
export const NOTHING_ADDED = 'Nothing added yet.';
export const SCALE_AMOUNT_DESC = '0% switches the source off: its programmes leave every offer.';
export const scaleLimitDesc = (n: number): string =>
  `A policy can hold 24 dated changes; this one needs ${n}. Remove one first.`;
export const removeChangeName = (from: Day): string =>
  `Remove change from ${formatMonthYear(from)}`;
/** "+ What it pays for"'s name: it starts with the visible label (WCAG 2.5.3). */
export const addProgrammeName = (name: string): string =>
  `What it pays for: add a programme to ${name}`;

/**
 * A baseline grant in its group's editor (4.5 item 4): "Grants to affordable homes of {minHomes}
 * or more: {pct} of the uncovered cost ({tiers})"; `tiers` is `tiersText` of its mix, or null.
 */
export const baselineProgrammeText = (
  minHomes: number,
  share: number,
  tiers: string | null
): string =>
  `Grants to affordable homes of ${formatCount(minHomes)} or more: ${formatPercent(share)} of ` +
  `the uncovered cost${tiers ? ` (${tiers})` : ''}`;

// --- Adding money and drafts (4.6) ---

export const POOL_LIMIT_DESC =
  'A policy can hold 12 added sources of money. Remove one to add another.';
export const DRAFT_OPEN_DESC = 'Finish or discard the item you are adding first.';
export const DRAFT_LINE =
  'Not added yet: fill in every field to add it. It is lost if you reload or leave the page.';
export const PAST_LINE = 'Before the simulation starts: not counted.';
export const discardName = (name: string): string => `Discard ${name}`;
export type LimitKind = 'pools' | 'programmes' | 'baselineScale';
const LIMIT_TEXT: Record<LimitKind, string> = {
  pools: '12 added sources of money',
  programmes: '24 programmes',
  baselineScale: '24 dated changes'
};
export const limitAlert = (k: LimitKind): string =>
  `This would pass the limit of ${LIMIT_TEXT[k]}. Remove one first.`;

// --- Validation messages and descriptions (4.7, 4.8, 4.8a) ---

export const NAME_ERROR = 'Enter a name of up to 48 characters.';
export const AMOUNT_ERROR = 'Enter an amount above $0 and at most $100,000 million.';
export const dateRangeError = (asOf: Day): string =>
  `Choose a month from ${formatMonthYear(asOf)} to December 2066.`;
export const UNTIL_ERROR = 'The end must come after the start.';
export const INFLOW_LIMIT_DESC = 'A source can have 12 rows of money in.';
export const INFLOW_MIN_DESC = 'A source needs at least one row of money in.';
export const DEBT_RATE_ERROR = 'Enter a rate above 0% and at most 25%.';
export const YEARS_ERROR = 'Enter a whole number of years from 1 to 40.';
export const LEVERAGE_ERROR = 'Enter a number above 0 and at most 10.';
export const SHARE_ERROR = 'Enter a percent above 0 and at most 100.';
export const LOAN_RATE_ERROR = 'Enter a rate from 0% to 25%.';
export const RETURN_ERROR = 'Enter a return from 1% to 25%.';
export const RESERVE_ERROR = 'Enter a percent from 0 to 100.';
export const MIN_HOMES_ERROR = 'Enter a whole number of homes from 0 to 10,000.';
export const TIER_ERROR = 'Enter a whole percent from 0 to 100.';
export const PROGRAMME_LIMIT_DESC = 'A policy can hold 24 programmes. Remove one to add another.';
export const GUARANTEE_DISABLED_DESC =
  "No source gives how much a guarantee lowers a lender's rate. Type one under Market terms you " +
  'set to offer guarantees.';
export const GO_TO_TERMS = 'Go to Market terms you set';
export const INCOME_MIX_DESC =
  "When several programmes pay one project, its homes follow each programme's mix in " +
  'proportion to what that programme pays.';
export const RATE_CUT_DESC =
  "No source gives how much a public guarantee lowers a private lender's rate. Type a " +
  'value to offer guarantees; it is labelled custom, not sourced.';
export const RATE_CUT_ERROR = 'Enter a rate cut from 0 to 5 percentage points.';
export const TERM_IN_USE_DESC =
  'A guarantee in this policy is valued with this rate cut. Change or remove the guarantee first.';
export const GUARANTEE_NEEDS_TERM =
  'This guarantee needs a rate cut: enter one under Market terms you set.';
export const USE_SOURCED = 'Use the sourced value';
export const clearTermName = (key: TermKey): string => `Clear ${TERM_NAME[key]}`;

// --- Source lines (4.7, 4.8a) ---

/** "From {label} (tier {n})"; a tier 3 source says it is a consultant's projection (4.7). */
export const sourcedLine = (label: string, tier: number): string =>
  tier === 3
    ? `From ${label} (tier 3: a consultant's projection, not San Francisco records)`
    : `From ${label} (tier ${tier})`;
export const customLine = (value: string, label: string): string =>
  `Your value (custom, not sourced). Sourced: ${value} from ${label}.`;
export const CUSTOM_LINE = 'Custom, not sourced.';
export const YOUR_VALUE_LINE = 'Your value (custom, not sourced).';
export const YOUR_MIX_LINE = 'Your mix (custom, not sourced)';

// --- Undo labels, one builder per row of table 4.9 ---

const scaleText = (scale: number): string => `${upTo2.format(scale * 100)}%`;
const millions = (dollars: number): string => `$${upTo6.format(dollars / 1e6)} million`;

/** Preset added. */
export const labelPresetAdded = (presetLabel: string): string => `Added: ${presetLabel}`;

/** Your own pool. */
export const labelOwnPoolAdded = (): string => 'Added: your own pool';

/** Pool removed, with the count of programmes removed with it. */
export const labelPoolRemoved = (name: string, programmes: number): string =>
  programmes === 0
    ? `Removed: ${name}`
    : programmes === 1
      ? `Removed: ${name} and its programme`
      : `Removed: ${name} and its ${programmes} programmes`;

/** Name. */
export const labelRenamed = (name: string): string => `Renamed: ${name}`;

/** Kind. */
export const labelKindChanged = (name: string, kind: PoolKind): string =>
  `Changed kind: ${name} is ${KIND_NAME[kind]}`;

/** Amount; `row` counts from 1, `dollars` whole dollars. */
export const labelAmountChanged = (name: string, row: number, dollars: number): string =>
  `Changed amount: ${name}, row ${row}, ${millions(dollars)}`;

/** Once / every year. */
export const labelInflowKindChanged = (
  name: string,
  row: number,
  kind: 'once' | 'yearly'
): string => `Changed: ${name}, row ${row}, ${kind === 'once' ? 'once' : 'every year'}`;

/** Dates of a pool or a programme; a null `day` is an "Until" cleared to no end. */
export const labelDateChanged = (
  name: string,
  field: 'From' | 'When' | 'Until',
  day: Day | null
): string =>
  day === null
    ? `Changed date: ${name}, no end`
    : `Changed date: ${name}, ${field} ${formatMonthYear(day)}`;

/** Money-in row added. */
export const labelInflowAdded = (name: string): string => `Added money in: ${name}`;

/** Money-in row removed; `row` counts from 1. */
export const labelInflowRemoved = (name: string, row: number): string =>
  `Removed money in: ${name}, row ${row}`;

/** Rate (a fraction), years to repay, lending per dollar. */
export const labelPoolNumberChanged = (
  field: 'rate' | 'termYears' | 'leverage',
  name: string,
  value: number
): string => {
  switch (field) {
    case 'rate':
      return `Changed interest rate: ${name}, ${ratePercent(value)}`;
    case 'termYears':
      return `Changed years to repay: ${name}, ${value} years`;
    case 'leverage':
      return `Changed lending per dollar: ${name}, ${upTo6.format(value)}`;
  }
};

/** Programme added. */
export const labelProgrammeAdded = (sentence: string): string => `Added: ${sentence}`;

/** Programme removed. */
export const labelProgrammeRemoved = (sentence: string): string => `Removed: ${sentence}`;

/** Any programme number. */
export const labelProgrammeNumberChanged = (sentence: string): string => `Changed: ${sentence}`;

/** Programme reach or instrument (also an instrument draft completed). */
export const labelProgrammeKindChanged = (sentence: string): string => `Changed: ${sentence}`;

/** Income mix. */
export const labelIncomeMixChanged = (sentence: string): string =>
  `Changed income mix: ${sentence}`;

/**
 * Dated change applied, named by group or source. A scale of 0 is "switched off" on any pool;
 * on the uncapped pool any scale above 0 is "switched back on".
 */
export const labelScaleApplied = (
  name: string,
  from: Day,
  scale: number,
  uncapped: boolean
): string => {
  const when = formatMonthYear(from);
  if (scale === 0) return `Today's funding: ${name} switched off from ${when}`;
  if (uncapped) return `Today's funding: ${name} switched back on from ${when}`;
  return `Today's funding: ${name} ${scaleText(scale)} from ${when}`;
};

/** Market term typed; `fraction` as stored (0.005 is "0.5 points"). */
export const labelTermTyped = (key: TermKey, fraction: number): string =>
  `Market term: ${TERM_NAME[key]} ${upTo6.format(Math.round(fraction * 100 * 1e6) / 1e6)} points`;

/** Market term cleared. */
export const labelTermCleared = (key: TermKey): string => `Cleared market term: ${TERM_NAME[key]}`;

/** Dated change removed, named by group or source. */
export const labelScaleRemoved = (name: string, from: Day): string =>
  `Removed change: ${name} from ${formatMonthYear(from)}`;

// --- Notices on load (4.15) and the engine's two known limits (R22, R24) ---

/**
 * The three funding notices, in the order of 4.15. A dropped item always names a pool this
 * calibration lacks, so pools are named by id.
 */
export function fundingNotices(report: FundingLoadReport): SimNotice[] {
  const out: SimNotice[] = [];
  if (report.upgradedFrom === 2)
    out.push({
      id: 'funding-added',
      text: "This policy was saved before public money could be added. It opens with today's public funding and nothing added.",
      tone: 'info'
    });
  if (report.droppedScales.length > 0 || report.droppedProgrammes.length > 0) {
    const lines = [
      ...report.droppedScales.map(
        (s) =>
          `Change to ${s.pool} from ${formatMonthYear(s.from)}: removed (this data has no such source)`
      ),
      ...report.droppedProgrammes.map((g) =>
        g.reason === 'pool'
          ? `${g.label}: removed (it pays from ${g.pool}, which this data doesn't have)`
          : `${g.label}: removed (it needs ${g.term === null ? 'a market term' : TERM_NAME[g.term]}, which has no source and no value you typed)`
      )
    ];
    out.push({
      id: 'funding-dropped',
      text: "Some changes to public money didn't fit the data this simulation runs on and were removed.",
      details: [...new Set(lines)],
      tone: 'info'
    });
  }
  if (report.unusable)
    out.push({
      id: 'funding-off',
      text: "This data can't simulate public money, so your changes to it are kept but not used.",
      tone: 'info'
    });
  return out;
}

/** R22: shown beside the baseline programmes when their smallest project size is above 0. */
export const smallProjectsCaveat = (minHomes: number): string =>
  `Today's funding pays only for affordable projects of ${minHomes} homes or more, so smaller affordable projects get none of it and the simulation counts too few of them. A programme you add for smaller projects can reach them.`;

/** R24: the first-day bundle of a partly funded project. */
export const MONTH_OFFER_CAVEAT =
  "A partly funded project keeps the offer it had on the first day of its month, so for up to about a month it can still draw on a source you switched off, or a programme that ended, during that month. Fully funded projects and today's funding as it stands are not affected.";

// --- Announcements and the "Sources and tiers" lines of the tab (4.9, 4.10) ---

/**
 * The coverage line and its later steps, spoken after an edit that changes it (4.9): "Affordable
 * homes: fully funded today; from July 2027, 86%."
 */
export function coverageSummaryText(steps: readonly CoverageStep[]): string {
  const later = steps
    .slice(1)
    .map(
      (s) =>
        `from ${formatMonthYear(s.from)}, ${s.certain ? 'fully funded' : formatPercent(s.coverage)}`
    );
  return `${[coverageLineText(steps[0]), ...later].join('; ')}.`;
}

/** Spoken when a run discards an unfinished pool or programme (4.6). */
export const DRAFT_DISCARDED = 'An unfinished item was discarded.';

/** The baseline's check line (4.10). */
export const checkLineText = (implied: number, observed: number): string =>
  `Today's City money funds about ${formatCount(implied)} affordable homes a year by this ` +
  `arithmetic; San Francisco's bond and tax-credit awards show about ${formatCount(observed)}.`;

/** An affordable home's cost line (4.10), from `AFFORDABLE`. */
export const affordableCostText = (cost: number, own: number, tier: number): string =>
  `Affordable homes' cost: ${formatDollarsExact(cost)} a home, of which ${formatDollarsExact(own)} ` +
  `is paid by the project's own loans and other income (Budget Analyst, Exhibit F, tier ${tier})`;

/** A preset the page does not offer, with its reason (4.10). */
export const notOfferedText = (label: string, reason: string): string =>
  `Not offered yet: ${label}: ${reason}`;

/** A market term with no source (4.10). */
export const noSourcedValueText = (reason: string): string => `No sourced value: ${reason}`;

/** A dated change's amount out of range (4.5 item 3: 0% to 1,000% of today's amount). */
export const SCALE_PCT_ERROR = 'Enter a percent from 0 to 1,000.';

// --- Programmes and market terms (4.8, 4.8a, 4.10) ---

/** A term name as the start of a sentence: "Guarantee rate cut". */
export const termTitle = (key: TermKey): string =>
  TERM_NAME[key].charAt(0).toUpperCase() + TERM_NAME[key].slice(1);

/** A typed market term in a preview or in "Sources and tiers" (4.8, 4.10). */
export const typedTermText = (key: TermKey): string =>
  `${termTitle(key)}: your value (custom, not sourced)`;

/** An evidence field holding a custom value, in "Sources and tiers" (4.10). */
export const customValueText = (name: string, field: string): string =>
  `${name}: ${field} is your value (custom, not sourced)`;

/** The draw assumption of ruling R11 (4.8), its numbers from the constants. */
export const drawAssumptionText = (upFront: number, averageDrawn: number): string =>
  `Assumption (tier 4): ${ratePercent(upFront)} of the loan drawn at the start, the rest evenly ` +
  `over construction, so ${ratePercent(averageDrawn)} is out on average.`;

/** A draft programme that has no sentence yet (a new one whose rate is empty). */
export const NEW_PROGRAMME = 'new programme';
