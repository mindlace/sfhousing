// Income tiers, the inclusionary table and the displacement range (spec 4.6, 4.7).
// Pure; relative imports only.
import { INCOME_TIERS, type IncomeTier } from '../../timelapse/types';
import type { Sourced } from './evidence';

const HCD = {
  label: 'HCD, "2026 State Income Limits Briefing Materials"',
  url: 'https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/income-limits-2026.pdf'
};
const BLA = {
  label:
    'Budget and Legislative Analyst, "Funding and Incentivizing Affordable Housing in San ' +
    'Francisco", 2026-06-05',
  url: 'https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf'
};
const CONTROLLER = {
  label:
    'Controller, "Inclusionary Housing: Triennial Review of Economic Feasibility, 2026", ' +
    '2026-04-30, corrected 2026-05-19',
  url: 'https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf'
};
const NBER = {
  label:
    'Ferreira, Meyer and Turner, "The Effect of LIHTC on Housing Markets", NBER Summer ' +
    'Institute slides, 2026-07-29',
  url: 'https://conference.nber.org/conf_papers/f240610/f240610.slides.pdf'
};
const SOLTAS = {
  label:
    'Soltas, "Tax Incentives and the Supply of Low-Income Housing", working paper, ' +
    'May 11, 2024',
  url: 'https://economics.sas.upenn.edu/system/files/2024-08/Empirical%20Micro%2010312024.pdf'
};

export const AMI_TIER_BOUNDS: Sourced<{ veryLow: number; low: number; moderate: number }> = {
  value: Object.freeze({ veryLow: 0.5, low: 0.8, moderate: 1.2 }),
  provenance: {
    tier: 1,
    label: 'Income tier upper bounds, shares of area median income',
    sources: [HCD, BLA],
    method:
      `HCD, pp. 2-4, accessed 2026-11-09: the very low-income limit "typically reflects 50 ` +
      `percent of median family income", the low-income limit "80 percent", and HCD "sets the ` +
      `maximum moderate-income limit to equal 120 percent" of area median income, under Health ` +
      `and Safety Code section 50093. The RHNA tiers in the Budget Analyst's Exhibit D (p. 5) ` +
      `are labelled "< 50% AMI", "50-<80% AMI", "80-120% AMI", ">120% AMI"; the two disagree ` +
      `only at exactly 80%, and this follows HCD (80% is low income) because the RHNA ` +
      `categories are defined by the state's income limits. Mapping San Francisco's programme ` +
      `percentages (which use MOHCD's area median income) onto the state categories by ` +
      `percentage is a tier 2 inference.`
  }
};

export function tierOfAmi(amiShare: number): IncomeTier {
  if (!Number.isFinite(amiShare) || amiShare < 0) {
    throw new RangeError(
      `area median income share must be a finite number of 0 or more; got ${amiShare}`
    );
  }
  const b = AMI_TIER_BOUNDS.value;
  if (amiShare <= b.veryLow) return 'veryLow';
  if (amiShare <= b.low) return 'low';
  if (amiShare <= b.moderate) return 'moderate';
  return 'aboveModerate';
}

export type Tenure = 'rental' | 'ownership';
export interface InclusionaryBand {
  minHomes: number;
  maxHomes: number | null;
  ami: number[];
  basisPoints: number[];
}

function band(
  minHomes: number,
  maxHomes: number | null,
  ami: number[],
  basisPoints: number[]
): InclusionaryBand {
  return Object.freeze({
    minHomes,
    maxHomes,
    ami: Object.freeze(ami) as number[],
    basisPoints: Object.freeze(basisPoints) as number[]
  });
}

export const INCLUSIONARY: Sourced<Record<Tenure, InclusionaryBand[]>> = {
  value: Object.freeze({
    rental: Object.freeze([
      band(10, 24, [0.55], [1500]),
      band(25, null, [0.55, 0.8, 1.1], [1000, 400, 400])
    ]) as InclusionaryBand[],
    ownership: Object.freeze([
      band(10, 24, [0.8], [1500]),
      band(25, null, [0.8, 1.05, 1.3], [1000, 500, 500])
    ]) as InclusionaryBand[]
  }),
  provenance: {
    tier: 1,
    label: 'On-site inclusionary requirement by size and tenure, rates in force November 1, 2026',
    sources: [CONTROLLER, BLA],
    method:
      `Controller, Triennial 2026, p. 7 (rental) and p. 8 (ownership), "2023 Ordinance (Post ` +
      `Reduction)" on-site column; Budget Analyst Exhibit J, p. 11, gives the same rental ` +
      `totals for "Future Projects" (15% and 18%, effective November 1, 2026), accessed ` +
      `2026-11-09. Stored as integer basis points; each share of area median income maps to ` +
      `a tier by tierOfAmi. The rates are tier 1. The rounding rule, floor((homes x basis ` +
      `points + 5000) / 10000), fractions of one half or more rounding up, is tier 4, an ` +
      `assumption: the Planning Code's section 415.6 is reported to state it, but its ` +
      `current text was not read. The total is split across income tiers by largest ` +
      `remainder, ties to the lower-income tier. The table holds the November 1, 2026 rates ` +
      `for the whole run: Exhibit J's note says the 25-or-more rental rate rises "0.5 percent ` +
      `each year starting Jan 1, 2028, until reaching a cap of 24 percent", but no verified ` +
      `source splits the rise between income tiers and the prototypes' shortfalls were ` +
      `computed at the November 2026 rate, so the 2028 rise is not applied.`
  }
};

export const ASSUMED_TENURE: Sourced<Tenure> = {
  value: 'rental',
  provenance: {
    tier: 2,
    label: 'Tenure assumed for a private project',
    sources: [CONTROLLER],
    method:
      `Inferred, accessed 2026-11-09: the simulation does not know a project's tenure; the ` +
      `Controller's apartment prototypes are the ones used for the shortfall, so the same ` +
      `tenure is used for the homes it must provide.`
  }
};

export function inclusionaryUnits(
  homes: number,
  tenure: Tenure = ASSUMED_TENURE.value
): Record<IncomeTier, number> {
  if (!Number.isInteger(homes) || homes < 0) {
    throw new RangeError(`homes must be an integer of 0 or more; got ${homes}`);
  }
  const out: Record<IncomeTier, number> = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0 };
  const b = INCLUSIONARY.value[tenure].find(
    (x) => homes >= x.minHomes && (x.maxHomes === null || homes <= x.maxHomes)
  );
  if (!b) return out;
  const bp: Record<IncomeTier, number> = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0 };
  b.ami.forEach((a, k) => {
    bp[tierOfAmi(a)] += b.basisPoints[k];
  });
  const totalBp = b.basisPoints.reduce((s, x) => s + x, 0);
  const total = Math.floor((homes * totalBp + 5000) / 10000);
  let given = 0;
  const rems: { tier: IncomeTier; rem: number; order: number }[] = [];
  INCOME_TIERS.forEach((tier, order) => {
    const exact = homes * bp[tier];
    out[tier] = Math.floor(exact / 10000);
    given += out[tier];
    rems.push({ tier, rem: exact % 10000, order });
  });
  rems.sort((x, y) => y.rem - x.rem || x.order - y.order);
  for (let i = 0; given < total; i++, given++) out[rems[i].tier] += 1;
  return out;
}

export const DISPLACEMENT_RANGE: Sourced<{ low: number; high: number }> = {
  value: Object.freeze({ low: 0.115, high: 0.8 }),
  provenance: {
    tier: 3,
    label: 'Share of subsidised homes that displace private housing that would have been built',
    sources: [NBER, SOLTAS],
    method:
      `Low, accessed 2026-11-09: Ferreira, Meyer and Turner, slide 17: "89 LIHTC units ` +
      `allocated ⇒ 87 placed-in-service ⇒ 77 ACS multi-family units … 1 − 77/87 = 11.5% ` +
      `crowd-out, CI95[−6%, 28%]"; local, the block group. High: Soltas, p. 4: "For every ten ` +
      `LIHTC units, I find about eight units displace private housing that would have ` +
      `otherwise been built within ten years"; Table 5 (p. 39) gives the model's displacement ` +
      `rate as 0.777 (standard error 0.018). Soltas counts later tax-credit projects on a ` +
      `losing site as displacement (Ferreira, Meyer and Turner, slide 8). National studies; ` +
      `neither measured San Francisco or any supply-constrained coastal market; no San ` +
      `Francisco estimate exists.`
  }
};
