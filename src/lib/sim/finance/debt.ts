// Debt service and the legal limits on City borrowing (spec 4.8).
// Pure; relative imports only; numbers are formatted with toFixed (no locale lookup).
import type { Dollars, LimitStatement, Provenance } from '../../timelapse/types';
import type { Sourced } from './evidence';

export const DEBT_BOUNDS = Object.freeze({
  rate: Object.freeze({ gt: 0 as const, max: 0.25 as const }),
  termYears: Object.freeze({ min: 1 as const, max: 40 as const, integer: true as const })
});

export function validateDebt(debt: { rate: number; termYears: number }): string | null {
  const { rate, termYears } = debt;
  if (!(rate > DEBT_BOUNDS.rate.gt && rate <= DEBT_BOUNDS.rate.max)) {
    return 'A borrowing rate is above 0% and at most 25%.';
  }
  if (
    !Number.isInteger(termYears) ||
    termYears < DEBT_BOUNDS.termYears.min ||
    termYears > DEBT_BOUNDS.termYears.max
  ) {
    return 'A borrowing term is a whole number of years from 1 to 40.';
  }
  return null;
}

/** Level annual payment and total repaid, each rounded once from the exact annual value. */
export function debtService(
  principal: Dollars,
  debt: { rate: number; termYears: number }
): { annual: Dollars; total: Dollars } {
  if (!Number.isFinite(principal) || principal < 0) {
    throw new RangeError(`principal must be a finite number of 0 or more; got ${principal}`);
  }
  const bad = validateDebt(debt);
  if (bad !== null) throw new RangeError(bad);
  const exactAnnual = (principal * debt.rate) / (1 - Math.pow(1 + debt.rate, -debt.termYears));
  return { annual: Math.round(exactAnnual), total: Math.round(exactAnnual * debt.termYears) };
}

export interface Borrowing {
  pool: string;
  kind: 'goBond' | 'cop';
  principal: Dollars;
  debt: { rate: number; termYears: number };
}

const BLA = {
  label:
    'Budget and Legislative Analyst, "Funding and Incentivizing Affordable Housing in San ' +
    'Francisco", 2026-06-05',
  url: 'https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf'
};
const RES_562_24 = {
  label: 'San Francisco Board of Supervisors, Resolution 562-24',
  url: 'https://sfbos.org/sites/default/files/r0562-24.pdf'
};

function bla(label: string, method: string): Provenance {
  return {
    tier: 1,
    label,
    sources: [BLA],
    method: `Budget Analyst, ${method}, accessed 2026-11-09.`
  };
}

export const DEBT_LIMITS: Readonly<
  Record<
    | 'goPolicyRate'
    | 'goRateToday'
    | 'goPolicyReachedFy'
    | 'goRatePerAnnualDollar'
    | 'goCapShare'
    | 'assessedValue'
    | 'goOutstanding'
    | 'copCapShare'
    | 'discretionaryRevenue'
    | 'copReachedFy'
    | 'goVote',
    Sourced<number | string>
  >
> = Object.freeze({
  goPolicyRate: {
    value: 0.1201,
    provenance: bla(
      'City policy ceiling on the bond tax rate, percent of assessed value',
      'p. 104: "it is City policy to keep property taxes at or below their 2006 level. This ' +
        'amounts to 0.1201 percent of assessed value"'
    )
  },
  goRateToday: {
    value: 0.1105,
    provenance: bla(
      'Property tax rate to repay G.O. bonds, FY 2025-26, percent',
      'p. 104: "The FY 2025-26 property tax rate to repay G.O. bonds is 0.1105 percent"'
    )
  },
  goPolicyReachedFy: {
    value: 'FY 2031-32',
    provenance: bla(
      'Fiscal year the planned G.O. programme reaches the policy rate',
      'p. 104: the City "will approach the 2006 property tax rate in approximately FY ' +
        '2031-32"; Exhibit 39, p. 105, shows the planned programme at the line that year'
    )
  },
  goRatePerAnnualDollar: {
    value: 0.01 / 35784254,
    provenance: bla(
      'Points of property tax rate per dollar of annual debt service',
      'Exhibit 40, p. 106: 0.01% of added rate supports $35,784,254 of annual debt service'
    )
  },
  goCapShare: {
    value: 0.03,
    provenance: bla(
      'Charter limit on Citywide bond debt, share of net assessed value',
      'p. 104: "The City Charter limits the total Citywide bond debt to three percent of the ' +
        'City\'s net assessed value"'
    )
  },
  assessedValue: {
    value: 353600000000,
    provenance: bla(
      'Net assessed value, FY 2025-26',
      'p. 104, FY 2025-26, "approximately $353.6 billion"'
    )
  },
  goOutstanding: {
    value: 2670000000,
    provenance: bla(
      'G.O. debt outstanding or planned, December 2025',
      'p. 104: outstanding "(including anticipated issuances) was approximately $2.67 ' +
        'billion" at December 2025'
    )
  },
  copCapShare: {
    value: 0.0325,
    provenance: bla(
      'Cap on COP debt service, share of General Fund aggregate discretionary revenue',
      'p. 107: "the annual debt service paid on COPs may not exceed 3.25 percent of General ' +
        'Fund aggregate discretionary revenue"; codified in Administrative Code section ' +
        '10.62(b)(3)'
    )
  },
  discretionaryRevenue: {
    value: 4660000000,
    provenance: bla(
      'General Fund aggregate discretionary revenue, FY 2025-26',
      'Exhibit 42, p. 108, FY 2025-26'
    )
  },
  copReachedFy: {
    value: 'FY 2028-29',
    provenance: bla(
      'Fiscal year COPs reach their debt capacity constraint',
      'pp. 105, 107: COPs "reach its debt capacity constraint in approximately FY 2028-29"'
    )
  },
  goVote: {
    value: 'two thirds',
    provenance: {
      tier: 1,
      label: 'Vote needed to issue City general-obligation bonds',
      sources: [RES_562_24],
      method:
        'Resolution 562-24, p. 2, verified: "the requisite two-thirds of all voters voting on ' +
        'the proposition approved" the 2024 affordable-housing bond. The constitutional text ' +
        '(California Constitution article XVI, section 18) returned 403 and was not read; ' +
        'accessed 2026-11-09.'
    }
  }
});

const L = DEBT_LIMITS;
const num = (k: keyof typeof DEBT_LIMITS): number => L[k].value as number;

function money(x: number): string {
  return x < 1e9 ? `$${(x / 1e6).toFixed(1)} million` : `$${(x / 1e9).toFixed(2)} billion`;
}

const BASE_SOURCES = [BLA];

export function limitStatements(borrowing: readonly Borrowing[]): LimitStatement[] {
  let G = 0;
  let Ag = 0;
  let Ac = 0;
  for (const b of borrowing) {
    const { annual } = debtService(b.principal, b.debt);
    if (b.kind === 'goBond') {
      G += b.principal;
      Ag += annual;
    } else {
      Ac += annual;
    }
  }
  const out: LimitStatement[] = [];
  if (G > 0) {
    const ratePct = Ag * num('goRatePerAnnualDollar');
    const per100k = (ratePct / 100) * 100000;
    out.push({
      id: 'goRate',
      exceeded: true,
      text:
        `Repaying ${money(G)} of general-obligation bonds takes ${money(Ag)} a year, about ` +
        `${ratePct.toFixed(4)}% on the property tax rate ($${per100k.toFixed(2)} per $100,000 ` +
        `of assessed value). City policy keeps the bond tax rate at or below its 2006 level, ` +
        `0.1201%. It is 0.1105% in FY 2025-26, and bonds already planned reach 0.1201% about ` +
        `FY 2031-32, so this borrowing needs that policy changed.`,
      provenance: {
        tier: 2,
        label: 'Property tax rate cost of the added general-obligation borrowing',
        sources: BASE_SOURCES,
        method:
          'Arithmetic on tier 1 values: annual debt service times the Exhibit 40, p. 106 ' +
          'figure (0.01% of rate per $35,784,254 a year); policy rate 0.1201% and FY 2025-26 ' +
          'rate 0.1105% from p. 104; planned programme reaches the policy rate about FY ' +
          '2031-32 (p. 104, Exhibit 39, p. 105, verified). Reading that as no headroom for ' +
          'added bonds, so "exceeded" is always true, is a tier 2 inference. Nothing is ' +
          'enforced; accessed 2026-11-09.'
      }
    });
    const limit = Math.round(num('goCapShare') * num('assessedValue'));
    const total = num('goOutstanding') + G;
    const over = total > limit;
    out.push({
      id: 'goCap',
      exceeded: over,
      text:
        `General-obligation debt would reach ${money(total)}: $2.67 billion outstanding or ` +
        `planned (December 2025) plus ${money(G)} in this run. The Charter caps it at 3% of ` +
        `assessed value, about $10.61 billion (FY 2025-26). ` +
        (over ? 'This is over the cap.' : 'This is within the cap.'),
      provenance: {
        tier: 2,
        label: 'General-obligation debt against the Charter cap',
        sources: BASE_SOURCES,
        method:
          'Arithmetic on tier 1 values, p. 104: Charter limit = 3% x $353.6 billion = ' +
          "$10,608,000,000; outstanding or planned $2.67 billion plus this run. The report's " +
          'own sentence that $2.67 billion is "approximately $8.07 billion below the $10.6 ' +
          'billion Charter limit" does not match its numbers (10.608 - 2.67 = 7.938); this ' +
          'uses the arithmetic. Conservative: it ignores amortisation of both existing and ' +
          'new debt, so it may report "over" a few years early; accessed 2026-11-09.'
      }
    });
    out.push({
      id: 'goVote',
      exceeded: true,
      text:
        'City general-obligation bonds need a two-thirds vote of the people voting on them. ' +
        `This run assumes ${money(G)} of new bonds that no vote has approved.`,
      provenance: {
        tier: 1,
        label: 'Vote needed for City general-obligation bonds',
        sources: [RES_562_24],
        method: String(L.goVote.provenance.method)
      }
    });
  }
  if (Ac > 0) {
    const share = (Ac / num('discretionaryRevenue')) * 100;
    out.push({
      id: 'copCap',
      exceeded: true,
      text:
        `Certificates of participation in this run take ${money(Ac)} a year, ` +
        `${share.toFixed(2)}% of General Fund discretionary revenue ($4.66 billion, FY ` +
        `2025-26). City policy caps their debt service at 3.25% ($151.45 million a year), ` +
        `which certificates already planned reach about FY 2028-29, so this borrowing needs ` +
        `Administrative Code section 10.62(b)(3) changed.`,
      provenance: {
        tier: 2,
        label: 'Certificate of participation debt service against the policy cap',
        sources: BASE_SOURCES,
        method:
          'Arithmetic on tier 1 values: annual debt service over $4.66 billion discretionary ' +
          'revenue (Exhibit 42, p. 108); cap 3.25% (p. 107, Administrative Code section ' +
          '10.62(b)(3)); existing certificates "reach its debt capacity constraint in ' +
          'approximately FY 2028-29" (pp. 105, 107, verified). Reading that as no headroom ' +
          'for added certificates is a tier 2 inference. COP issuance costs ("15 to 20 percent ' +
          '… closer to 25 percent for a smaller COPs issuance", p. 108) are not modelled: a ' +
          "COP pool's inflow is taken as the money the City can spend; accessed 2026-11-09."
      }
    });
  }
  return out;
}
