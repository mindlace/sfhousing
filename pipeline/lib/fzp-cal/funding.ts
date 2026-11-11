/**
 * `calibration.baselineFunding` (finance-data spec 4.6): today's public funding of affordable
 * homes as pools and grant programmes, from the hand-transcribed `funding.json` (spec 4.5) and the
 * MOHCD affordable pipeline's income bands and sizes. A pure function of its inputs.
 */
import { fiscalYearWindow, type FundingFile } from '../../enrichment/funding-schema';
import { isoOf, num } from '../../project-records/parse';
import type { RawRow } from '../../project-records/types';
import { tierOf } from '../../../src/lib/sim/finance/instruments';
import { PROTOTYPES, uncoveredPerHome } from '../../../src/lib/sim/finance/prototypes';
import type { Day } from '../../../src/lib/timelapse/time';
import {
  INCOME_TIERS,
  type Calibration,
  type IncomeTier,
  type Pool,
  type PoolKind,
  type Programme,
  type Provenance
} from '../../../src/lib/timelapse/types';
import { datasf } from './provenance';
import { roundShares } from './round';
import { CalibrationError, type CalProfile, type RuleTally } from './types';

export const AMI_BANDS = [
  '_20_ami',
  '_30_ami',
  '_40_ami',
  '_50_ami',
  '_55_ami',
  '_60_ami',
  '_80_ami',
  '_90_ami',
  '_100_ami',
  '_105_ami',
  '_110_ami',
  '_120_ami',
  '_130_ami',
  '_150_ami'
] as const;
export type AmiBand = (typeof AMI_BANDS)[number];

/** Each band is a ceiling, mapped by its upper bound to California's income categories. */
export const BAND_TIER: Record<AmiBand, IncomeTier> = {
  _20_ami: 'veryLow',
  _30_ami: 'veryLow',
  _40_ami: 'veryLow',
  _50_ami: 'veryLow',
  _55_ami: 'low',
  _60_ami: 'low',
  _80_ami: 'low',
  _90_ami: 'moderate',
  _100_ami: 'moderate',
  _105_ami: 'moderate',
  _110_ami: 'moderate',
  _120_ami: 'moderate',
  _130_ami: 'aboveModerate',
  _150_ami: 'aboveModerate'
};

export const MOHCD_PROGRAM = 'MOHCD 100% Affordable (New Development)';
const NEW_CONSTRUCTION = 'New Construction';
/** The MOHCD pipeline is a snapshot of this date. */
const MOHCD_SNAPSHOT = '2023-09-30';
const NO_ROWS = 'funding: no MOHCD 100% affordable new-construction rows with income bands';
const FIXTURE_PREFIX = 'Fixture (tier 4): ';

export interface MohcdRow {
  projectId: string;
  program: string | null;
  projectType: string | null;
  totalUnits: number | null;
  affordableUnits: number | null;
  bands: Record<AmiBand, number>;
  undeclared: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Typed MOHCD rows; a blank band or `ami_undeclared` reads as 0, a blank size as null. */
export function parseMohcdRows(raw: RawRow[]): MohcdRow[] {
  return raw.map((r) => {
    const bands = {} as Record<AmiBand, number>;
    for (const b of AMI_BANDS) bands[b] = num(r[b]) ?? 0;
    return {
      projectId: str(r.project_id) ?? '',
      program: str(r.general_housing_program),
      projectType: str(r.project_type),
      totalUnits: num(r.total_project_units),
      affordableUnits: num(r.mohcd_affordable_units),
      bands,
      undeclared: num(r.ami_undeclared) ?? 0
    };
  });
}

/** nearest-rank: sorted[ceil(0.1 × n) − 1], after dropping null and ≤ 0 */
export function nearestRankP10(xs: (number | null)[]): number {
  const sorted = xs.filter((x): x is number => x !== null && x > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    throw new CalibrationError('funding: no MOHCD row with total_project_units above 0');
  }
  return sorted[Math.ceil(0.1 * sorted.length) - 1];
}

export interface MohcdMix {
  used: number;
  tiers: Record<IncomeTier, number>;
  minHomes: number;
  byBand: Record<AmiBand, number>;
  declared: number;
  undeclared: number;
  affordable: number;
}

const isUsed = (r: MohcdRow): boolean =>
  r.program === MOHCD_PROGRAM && r.projectType === NEW_CONSTRUCTION;

/** The income mix and smallest size of the City's own 100% affordable new building. */
export function mohcdMix(rows: MohcdRow[]): MohcdMix {
  const used = rows.filter(isUsed);
  const byBand = {} as Record<AmiBand, number>;
  for (const b of AMI_BANDS) byBand[b] = used.reduce((a, r) => a + r.bands[b], 0);
  const sums: Record<IncomeTier, number> = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0 };
  for (const b of AMI_BANDS) sums[BAND_TIER[b]] += byBand[b];
  const declared = INCOME_TIERS.reduce((a, t) => a + sums[t], 0);
  if (used.length === 0 || declared <= 0) throw new CalibrationError(NO_ROWS);
  const shares = roundShares(INCOME_TIERS.map((t) => sums[t]));
  const tiers = {} as Record<IncomeTier, number>;
  INCOME_TIERS.forEach((t, i) => (tiers[t] = shares[i]));
  return {
    used: used.length,
    tiers,
    minHomes: nearestRankP10(used.map((r) => r.totalUnits)),
    byBand,
    declared,
    undeclared: used.reduce((a, r) => a + r.undeclared, 0),
    affordable: used.reduce((a, r) => a + (r.affordableUnits ?? 0), 0)
  };
}

/** The check's warning, or null when implied and observed differ by at most half of observed. */
export function fundingWarning(
  implied: number,
  observed: number,
  years: [number, number]
): string | null {
  if (Math.abs(implied - observed) <= 0.5 * observed) return null;
  return (
    `baselineFunding: the capped pools fully fund ${implied} affordable homes a year; the ` +
    `${years[0]}–${years[1]} bond and tax-credit awards show ${observed} (new construction); ` +
    'they differ by more than half'
  );
}

export interface FundingReport {
  rows: {
    programme: string;
    pool: string;
    kind: PoolKind;
    fillTier: 1 | 2 | 3;
    dollarsPerYear: number | null;
    share: number;
    impliedHomesPerYear: number | null;
  }[];
  mix: MohcdMix;
  check: { impliedHomesPerYear: number; observedHomesPerYear: number };
  warning: string | null;
  awardRows: number;
}

const halfUp = (x: number): number => Math.floor(x + 0.5);
/** Whole dollars with thousands separators, without Intl (deterministic across runtimes). */
const money = (d: number): string => `$${String(Math.round(d)).replace(/\B(?=(\d{3})+$)/g, ',')}`;
const millions = (d: number): string => `$${(d / 1e6).toFixed(1)} million`;

/** One baseline pool before it is emitted: what the shares, check and provenance need. */
interface PoolSpec {
  pool: Pool;
  perHome: number;
  /** null for the uncapped federal pool */
  dollarsPerYear: number | null;
}

export function baselineFunding(
  file: FundingFile,
  mohcd: RawRow[],
  asOf: Day,
  profile: CalProfile
): {
  baselineFunding: NonNullable<Calibration['baselineFunding']>;
  report: FundingReport;
  /**
   * sc.funding.ami-undeclared: fired = undeclared homes, of = mohcd_affordable_units of the rows
   * used
   */
  tally: RuleTally;
  warnings: string[];
} {
  const { perHome, city } = file;
  const uncovered = uncoveredPerHome('affordable', PROTOTYPES[0]);
  const perHomeSum = perHome.city + perHome.state + perHome.federal;
  if (perHomeSum !== uncovered) {
    throw new CalibrationError(
      `funding: perHome city + state + federal ${perHomeSum} is not the uncovered cost ${uncovered}`
    );
  }
  const yearly = (dollarsPerYear: number) => [
    { kind: 'yearly' as const, from: asOf, to: null, dollarsPerYear }
  ];

  const specs: PoolSpec[] = [
    ...city.sources.map((s) => ({
      pool: {
        id: s.id,
        kind: s.kind,
        label: s.label,
        inflows: yearly(s.dollarsPerYear),
        uncapped: false,
        debt: s.debt === null ? null : { rate: s.debt.rate, termYears: s.debt.termYears },
        leverage: 1
      },
      perHome: (perHome.city * s.dollarsPerYear) / city.total,
      dollarsPerYear: s.dollarsPerYear
    })),
    {
      pool: {
        id: file.state.id,
        kind: 'state',
        label: file.state.label,
        inflows: yearly(file.state.dollarsPerYear),
        uncapped: false,
        debt: null,
        leverage: 1
      },
      perHome: perHome.state,
      dollarsPerYear: file.state.dollarsPerYear
    },
    {
      pool: {
        id: file.federal.id,
        kind: 'federal',
        label: file.federal.label,
        inflows: [],
        uncapped: true,
        debt: null,
        leverage: 1
      },
      perHome: perHome.federal,
      dollarsPerYear: null
    }
  ];
  const shares = roundShares(specs.map((s) => s.perHome));

  const mohcdRows = parseMohcdRows(mohcd);
  const mix = mohcdMix(mohcdRows);
  const programmes: Programme[] = specs.map(({ pool }, i) => ({
    id: `baseline-${pool.id}`,
    label: `${pool.label}: grant toward an affordable home`,
    pool: pool.id,
    reach: 'affordable',
    instrument: { kind: 'grant', share: shares[i] },
    from: asOf,
    to: null,
    minHomes: mix.minHomes,
    tiers: { ...mix.tiers }
  }));

  const implied = specs.map((s, i) =>
    s.dollarsPerYear === null || shares[i] <= 0 ? null : s.dollarsPerYear / (shares[i] * uncovered)
  );
  const capped = implied.filter((x): x is number => x !== null);
  const impliedHomesPerYear = halfUp(Math.min(...capped));
  const years = file.awards.years;
  const span: [number, number] = [years[0], years[years.length - 1]];
  const newRows = file.awards.rows.filter((r) => r.newConstruction);
  const observedHomesPerYear = halfUp(newRows.reduce((a, r) => a + r.homes, 0) / years.length);
  const warning = fundingWarning(impliedHomesPerYear, observedHomesPerYear, span);
  const awardWindow: [string, string] = [`${span[0]}-01-01`, `${span[1]}-12-31`];

  const fixture = profile.name === 'fixture';
  const mark = (p: Provenance): Provenance =>
    fixture ? { ...p, tier: 4, label: `${FIXTURE_PREFIX}${p.label}` } : p;

  const fy = city.fiscalYear;
  const inflowText = `First inflow on asOf (${isoOf(asOf)}), then each anniversary.`;
  const shareText = (i: number, dollarsPerHome: string) =>
    `Share: ${dollarsPerHome} a home ÷ ${money(uncovered)} uncovered (Exhibit F: cost ` +
    `${money(perHome.total)} less permanent loans and other ${money(perHome.permanentLoans + perHome.other)}) = ${shares[i]}.`;
  const blaSource = {
    label: `${city.cite.label}, p. 6, Exhibit E; p. 7, Exhibit F`,
    url: city.cite.url
  };

  const fyWindow = fiscalYearWindow(fy);
  const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

  const poolProvenance: Provenance[] = specs.map((s, i) => {
    if (i < city.sources.length) {
      const src = city.sources[i];
      const debt = src.debt;
      const debtText =
        debt === null
          ? ''
          : ` Debt terms: rate ${percent(debt.rate)}, ${debt.termYears} years (${debt.cite.page}` +
            `${debt.cite.quote === undefined ? '' : `: '${debt.cite.quote}'`}), the Analyst's ` +
            'assumption (tier 2); repayment is nominal.';
      return mark({
        tier: 1,
        label: `${src.label}: ${millions(src.dollarsPerYear)} a year, ${fy} (held level)`,
        sources:
          debt === null
            ? [blaSource]
            : [blaSource, { label: `${debt.cite.label}, ${debt.cite.page}`, url: debt.cite.url }],
        method:
          `Exhibit E (p. 6): ${money(src.dollarsPerYear)} of the City's ${money(city.total)} ` +
          `multifamily spending in ${fy}. Its slice of the City's ${money(perHome.city)} a home ` +
          `(Exhibit F, p. 7): ${money(perHome.city)} × ${money(src.dollarsPerYear)} ÷ ` +
          `${money(city.total)} = ${money(Math.round(s.perHome))}. ` +
          shareText(i, money(Math.round(s.perHome))) +
          ` ${inflowText} ${fy} dollars, not adjusted. ${src.note}${debtText}`,
        n: 1,
        window: fyWindow
      });
    }
    if (s.pool.kind === 'state') {
      return mark({
        tier: 2,
        label: `${file.state.label}: ${millions(file.state.dollarsPerYear)} a year (a lower bound)`,
        sources: [
          { label: `${file.state.cite.label}, ${file.state.cite.page}`, url: file.state.cite.url }
        ],
        method: `${file.state.method} ${shareText(i, money(perHome.state))} ${inflowText}`,
        n: 8,
        window: ['2018-01-01', '2025-12-31']
      });
    }
    return mark({
      tier: 2,
      label: `${file.federal.label}: uncapped`,
      sources: [
        {
          label: `${file.federal.cite.label}, ${file.federal.cite.page}`,
          url: file.federal.cite.url
        }
      ],
      method:
        `${file.federal.method} ${shareText(i, money(perHome.federal))} ` +
        'uncapped: no ceiling binds San Francisco in the 2026 award records. That claim rests ' +
        "on the design's evidence digest, not on a source listed here; n and window describe " +
        `the ${span[0]}–${span[1]} new-construction award rows of the check. ` +
        `${fy} dollars, not adjusted.`,
      n: newRows.length,
      window: awardWindow
    });
  });

  const bandText = INCOME_TIERS.map(
    (t) =>
      `${t} ${AMI_BANDS.filter((b) => BAND_TIER[b] === t)
        .map((b) => b.replace(/^_/, ''))
        .join(', ')}`
  ).join('; ');
  const mixProvenance = mark({
    tier: 0,
    label: "Income mix and smallest size of the City's 100% affordable new construction",
    sources: [datasf('mohcdPipeline')],
    method:
      `The ${mix.used} MOHCD pipeline rows with general_housing_program '${MOHCD_PROGRAM}' and ` +
      `project_type '${NEW_CONSTRUCTION}'. Each AMI band is a ceiling, mapped by its upper bound ` +
      `to California's income categories (Health and Safety Code): ${bandText}. tiers are the ` +
      `four sums over ${mix.declared} band-coded homes, rounded to 6 decimals summing to 1; ` +
      `undeclared AMI: ${mix.undeclared} homes, left out. minHomes ${mix.minHomes} is the ` +
      'nearest-rank 10th percentile of total_project_units (sorted index ceil(0.1 × n) − 1), ' +
      "rows with 0 or blank homes left out. MOHCD's AMI is the City's published AMI table, not " +
      "the state's income limits (inferred).",
    n: mix.used,
    window: [MOHCD_SNAPSHOT, MOHCD_SNAPSHOT]
  });

  const awardSources: { label: string; url: string }[] = [];
  for (const r of file.awards.rows) {
    if (!awardSources.some((s) => s.url === r.cite.url)) {
      awardSources.push({ label: r.cite.label, url: r.cite.url });
    }
  }
  const checkProvenance = mark({
    tier: 2,
    label: 'Homes a year the baseline funding pays for, against award records',
    sources: awardSources,
    method:
      'Implied: over the capped pools with a share above 0, the least of dollarsPerYear ÷ ' +
      `(share × ${money(uncovered)}), rounded half up: ${impliedHomesPerYear}. Observed: the ` +
      `homes of the ${newRows.length} new-construction rows among the ${file.awards.rows.length} ` +
      `bond and tax-credit award rows of ${years.join(', ')}, divided by the ${years.length} ` +
      `years, rounded half up: ${observedHomesPerYear}. Award homes are total units (managers' ` +
      'homes included).',
    n: newRows.length,
    window: awardWindow
  });

  const report: FundingReport = {
    rows: specs.map((s, i) => {
      const homes = implied[i];
      return {
        programme: programmes[i].id,
        pool: s.pool.id,
        kind: s.pool.kind,
        fillTier: (tierOf(s.pool.kind) + 1) as 1 | 2 | 3,
        dollarsPerYear: s.dollarsPerYear,
        share: shares[i],
        impliedHomesPerYear: homes === null ? null : halfUp(homes)
      };
    }),
    mix,
    check: { impliedHomesPerYear, observedHomesPerYear },
    warning,
    awardRows: file.awards.rows.length
  };

  const sample = mohcdRows
    .filter((r) => isUsed(r) && r.undeclared > 0)
    .map((r) => r.projectId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    baselineFunding: {
      pools: specs.map((s) => s.pool),
      programmes,
      provenance: [...poolProvenance, mixProvenance],
      check: { impliedHomesPerYear, observedHomesPerYear, provenance: checkProvenance }
    },
    report,
    tally: { fired: mix.undeclared, of: mix.affordable, sample },
    warnings: warning === null ? [] : [warning]
  };
}
