// Sourced constants for the /sim funding presets and the starting values of a pool added by hand
// (finance-levers spec 2026-11-09 section 4.7). Every number a preset presents as a fact is a
// `Sourced` constant here, with its tier and where it was read; a number the user is left to
// choose is a starting value at tier 4, labelled "custom, not sourced". `funding-presets.ts` reads
// these by name, and `valueSource` (Task 8) reads the same names to say where a stored value came
// from.
import { dayOf } from '$lib/sim/scenario/dates';
import type { Dollars, Inflow, PoolKind, Provenance } from '$lib/timelapse/types';
import type { Evidence, Sourced } from './timing-sources';

export type { Evidence, Sourced, Unsourced } from './timing-sources';

const VERIFIED = 'verified 2026-11-09';

const BLA = {
  label:
    'Budget and Legislative Analyst, "Financing Affordable Housing", report to the Board of ' +
    'Supervisors, 2026',
  url: 'https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf'
};
const CONTROLLER_PROP_C = {
  label: 'Controller, Proposition C: Contributions to the Housing Fund, statement of 2026-08-10',
  url: 'https://media.api.sf.gov/documents/Proposition_C__Contributions_to_the_Housing_Fund_-_Signed.pdf'
};
const HRA_CORPORATION = {
  label: 'HR&A Advisors, Municipal Finance Corporation Business and Governance Plan, 2023-05-10',
  url: 'https://lafco.archive.sf.gov/sites/default/files/rwg051823_MFC-Final.pdf'
};
const HRA_BANK = {
  label:
    'HR&A Advisors, San Francisco Public Bank Business and Governance Plan and Viability Study, ' +
    '2023',
  url: 'https://lafco.archive.sf.gov/sites/default/files/rwg051823_PublicBankFinal.pdf'
};
export const LAO_PROP_1 = {
  label: 'Legislative Analyst, Proposition 1 (November 2026), ballot analysis',
  url: 'https://lao.ca.gov/BallotAnalysis/Proposition?number=1&year=2026'
};

/** What a starting value the user is left to choose is labelled. Tier 4. */
const customStart = (label: string, method: string): Provenance => ({
  tier: 4,
  label: `${label} (custom, not sourced)`,
  sources: [],
  method: `Custom, not sourced: ${method}`
});

/** City and County funding per home in 2024 tax-credit projects: the City's part of a home. */
export const CITY_PER_HOME: Sourced<Dollars> = {
  value: 300_027,
  provenance: {
    tier: 1,
    label: 'City and County funding per affordable home, 2024 tax-credit projects',
    sources: [BLA],
    method: `BLA 2026 Exhibit F, p. 7 (${VERIFIED}; digest [V]).`
  }
};

/** `cityGrant`'s share: CITY_PER_HOME over the uncovered cost of an affordable home. */
export const CITY_GRANT_SHARE_PROVENANCE: Provenance = {
  tier: 2,
  label: "The City's share of an affordable home's uncovered cost",
  sources: [BLA],
  method:
    '$300,027 (tier 1, BLA 2026 Exhibit F, p. 7) divided by the uncovered cost of an affordable ' +
    "home in finance-model's constants (tier 1 inputs), rounded to six decimals: tier 2 arithmetic."
};

/** The principal that 0.01 point on the bond property-tax rate supports. */
export const BOND_PRINCIPAL: Sourced<Dollars> = {
  value: 410_442_573,
  provenance: {
    tier: 2,
    label: 'A bond of what 0.01 point on the bond tax rate supports',
    sources: [BLA],
    method:
      `BLA 2026 Exhibit 40, p. 106 (${VERIFIED}): the Budget Analyst's estimate of the principal ` +
      '0.01 point on the bond property-tax rate supports, "Assumes 6.0 percent interest rate on ' +
      '20-year bonds" (ruling R19). Its size and date are starting values you can change.'
  }
};

/** General Fund spending on multifamily grants and loans, FY2024-25. */
export const GENERAL_FUND_FY25: Sourced<Dollars> = {
  value: 36_700_000,
  provenance: {
    tier: 1,
    label: 'As much again as the General Fund spent on multifamily grants and loans in 2024-25',
    sources: [BLA],
    method: `BLA 2026 Exhibit E, p. 6 (digest [V]). The yearly amount is a starting value.`
  }
};

const PROP_C_METHOD =
  'Controller\'s statement, 2026-08-10, p. 1 (verified 2026-11-09): "+$6 million in FY2028-29 ' +
  'and $13 million in FY2029-30", then "grow by an additional $9 million annually, reaching ' +
  'approximately $60 million … by FY2034-35"; the mandate is extended "from 2043 to 2058". The ' +
  '2030-31 to 2033-34 amounts are that rule (tier 1 arithmetic); FY2034-35 uses the stated $60 ' +
  'million; the last arrival is FY2057-58 (tier 2 reading of "2058"). These are the ' +
  "Controller's projected dollars, used as constant dollars (tier 2 approximation). The Fund " +
  'may also pay for down-payment loans and infrastructure (p. 2), so counting it all as ' +
  'building money is an upper bound.';

/** Proposition C (November 2026): six rising amounts, then $60 million a year to 2057. */
export const PROP_C_SCHEDULE: Sourced<Inflow[]> = {
  value: [
    ...[6, 13, 22, 31, 40, 49].map((m, k): Inflow => ({
      kind: 'once',
      day: dayOf(2028 + k, 7, 1),
      dollars: m * 1_000_000
    })),
    { kind: 'yearly', from: dayOf(2034, 7, 1), to: dayOf(2057, 7, 1), dollarsPerYear: 60_000_000 }
  ],
  provenance: {
    tier: 2,
    label: 'Housing Trust Fund increase, Proposition C (2026)',
    sources: [CONTROLLER_PROP_C],
    method: PROP_C_METHOD
  }
};

/** The fund's size: Montgomery County's Housing Production Fund as the BLA describes it. */
export const REVOLVING_FUND_SIZE: Sourced<Dollars> = {
  value: 100_000_000,
  provenance: {
    tier: 1,
    label: "A $100 million revolving construction-loan fund, as in Montgomery County's",
    sources: [BLA],
    method:
      "BLA 2026 pp. 78-79 (verified 2026-11-09): Montgomery County's Housing Production Fund, " +
      'five-year construction loans to mixed-income projects. Tier 1 for the description; the ' +
      "fund is the County's. No completed revolve has been reported. Its 30% affordable " +
      'condition cannot be expressed (a market programme has no tiers). Neither the BLA nor the ' +
      'County figures it cites give a rate or a share of cost lent.'
  }
};
/** The fund's loan rate: the City's own borrowing rate. A starting value. */
export const REVOLVING_RATE: Sourced<number> = {
  value: 0.06,
  provenance: customStart(
    'Lends at what the City pays to borrow',
    "the City's own borrowing rate (BLA 2026 p. 106, 6.0 percent on 20-year bonds), chosen as " +
      "the fund's rate because no source gives one."
  )
};
/** The share of cost the fund lends. A starting value. */
export const REVOLVING_COST_SHARE: Sourced<number> = {
  value: 0.1,
  provenance: customStart('A tenth of the building cost', 'no source gives a share of cost lent.')
};

/** The public bank's housing share of City money, by year, years 1 to 5. Dollars. */
export const PUBLIC_BANK_HOUSING: Sourced<number[]> = {
  value: [8_666_667, 11_333_333, 10_000_000, 26_666_667, 13_333_333],
  provenance: {
    tier: 3,
    label: "The public bank's City money for housing, years 1 to 5",
    sources: [HRA_CORPORATION, HRA_BANK],
    method:
      'HR&A Advisors, Municipal Finance Corporation plan pp. 54-58 (verified): City capital ' +
      '$20M, $10M, $10M and funding $6M, $24M, $20M in years 1 to 3; lending "70% through ' +
      'participations and 10% to affordable housing, 10% to local enterprise, and 10% to green ' +
      'investments directly", participation loans split across the three lending areas, so the ' +
      'housing share is 0.10 + 0.70 / 3 = 1/3 (tier 2: the even split is an inference). Years 4 ' +
      'and 5: HR&A bank plan, Table 10 (PDF p. 68, verified 2026-11-09), City money added $80M ' +
      'and $40M (tier 3 projection, tier 2 differences), the housing share staying one third ' +
      '(same plan, PDF p. 32: "a roughly equal share" across the three lending areas, ' +
      'verified). The table gives year 1 capital as $19.5M where the corporation plan gives ' +
      "$20M; the corporation plan is kept for years 1 to 3. The bank plan's years 6 to 8 are " +
      'left out. "Proposition B (November 2026) authorises it but carries no money, and was not ' +
      'certified on 2026-11-09."'
  }
};
/** The share of cost the bank lends. A starting value. */
export const PUBLIC_BANK_COST_SHARE: Sourced<number> = {
  value: 0.1,
  provenance: customStart('A tenth of the building cost', 'the plan gives no loan-to-cost.')
};

/** Federal support's yearly amount: the user's; its start is as much as the state gives today. */
export const FEDERAL_SUPPORT_AMOUNT_PROVENANCE: Provenance = customStart(
  'A federal grant as large as the state gives today',
  'no enacted programme gives an amount (digest section 6: the 2026 ROAD to Housing Act ' +
    "appropriates nothing). The start is the baseline state pool's first yearly amount (tier 2, " +
    'F12), so it reads "as much as the state gives today".'
);
/** The first year federal support starts: the partner's example, ruling R5. A starting value. */
export const FEDERAL_SUPPORT_START_PROVENANCE: Provenance = customStart(
  'Federal support from 2028 at the earliest',
  "the year follows the partner's example (ruling R5)."
);
/** The default date of a bond, a fund or a bank's first inflow. A starting value. */
export const NEXT_FISCAL_START_PROVENANCE: Provenance = customStart(
  'From the start of the next fiscal year',
  'the date is yours to change.'
);

/** What `loanRate` says when no source gives a rate for a kind of money. */
export const NO_LOAN_RATE =
  'No source gives the rate a public loan programme funded from this kind of money charges in ' +
  'San Francisco; a rate you type is custom, not sourced.';

const unsourcedRate: Evidence<number> = { value: null, reason: NO_LOAN_RATE };

const BLA_COP_METHOD =
  'BLA 2026 p. 108, "This model assumes that COPs are issued at a 6.5 percent interest rate ' +
  `for a term of 20 years" (${VERIFIED} in the local copy of the report; tier 2, the Budget ` +
  "Analyst's assumption; ruling R19)";

/** One starting value for a debt term, a bank's leverage and a loan rate, by pool kind. */
export const POOL_KIND_DEFAULTS: Record<
  PoolKind,
  {
    /** Non-null exactly for goBond and cop (F5). */
    debt: Evidence<{ rate: number; termYears: number }> | null;
    /** Null where F5 fixes leverage at 1 (every kind but bank): a definition, not a choice. */
    leverage: Evidence<number> | null;
    /** The rate a loan programme on this kind of pool starts at. */
    loanRate: Evidence<number>;
  }
> = {
  goBond: {
    debt: {
      value: { rate: 0.06, termYears: 20 },
      provenance: {
        tier: 2,
        label: 'Bond interest rate and term',
        sources: [BLA],
        method:
          `BLA 2026 Exhibit 40, p. 106, "Assumes 6.0 percent interest rate on 20-year bonds" ` +
          `(${VERIFIED}; tier 2, the Budget Analyst's assumption; ruling R19).`
      }
    },
    leverage: null,
    loanRate: unsourcedRate
  },
  cop: {
    debt: {
      value: { rate: 0.065, termYears: 20 },
      provenance: {
        tier: 2,
        label: 'Certificates of participation interest rate and term',
        sources: [BLA],
        method: `${BLA_COP_METHOD}.`
      }
    },
    leverage: null,
    loanRate: unsourcedRate
  },
  bank: {
    debt: null,
    leverage: {
      value: 0.67,
      provenance: {
        tier: 2,
        label: 'Dollars lent per City dollar received, the public bank plan',
        sources: [HRA_CORPORATION],
        method:
          'HR&A 2023 plan pp. 54-58 (verified): $59,948,000 of loans at the end of year 3 on ' +
          '$90 million of City money. Tier 2 arithmetic on a tier 3 projection.'
      }
    },
    loanRate: {
      value: 0.0613,
      provenance: {
        tier: 3,
        label: 'Rate on affordable-housing loans, year 1 of the public bank plan',
        sources: [HRA_CORPORATION],
        method:
          'HR&A 2023 plan pp. 54-58 (verified): 6.13% on affordable-housing loans in year 1, ' +
          'falling to 5.38% by year 3. A consultant projection, so tier 3.'
      }
    }
  },
  generalRevenue: { debt: null, leverage: null, loanRate: unsourcedRate },
  dedicatedTax: { debt: null, leverage: null, loanRate: unsourcedRate },
  state: { debt: null, leverage: null, loanRate: unsourcedRate },
  federal: { debt: null, leverage: null, loanRate: unsourcedRate }
};
