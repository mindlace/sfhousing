// Market terms (row F8): the private-finance numbers an instrument's value is measured against,
// each with its provenance, and `resolveTerms`, which lets a typed value replace a sourced one.
// Pure; relative imports only.
import type { ResolvedTerms, TermKey } from '../../timelapse/types';
import type { Sourced, Unsourced } from './evidence';

export type { TermKey, ResolvedTerms };

export type MarketTerms = {
  constructionRate: Sourced<number> | Unsourced;
  constructionYears: Sourced<number> | Unsourced;
  requiredReturn: Sourced<number> | Unsourced;
  guaranteeRateCut: Sourced<number> | Unsourced;
  lossOnExit: Sourced<number>;
};

const TERNER = {
  label: 'Terner Center, "Making It Pencil: The Math Behind Housing Development", December 2023',
  url: 'https://ternercenter.berkeley.edu/wp-content/uploads/2023/12/Making-It-Pencil-December-2023.pdf'
};
const CONTROLLER = {
  label:
    'Controller, "Inclusionary Housing: Triennial Review of Economic Feasibility, 2026", ' +
    '2026-04-30, corrected 2026-05-19',
  url: 'https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf'
};
const TAC_DECK = {
  label: 'Controller, TAC meeting 2 presentation, 2026-02-11, slide 14',
  url: 'https://media.api.sf.gov/documents/TAC_Meeting_2_Presentation_-_2-11-2026.pdf'
};

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const GUARANTEE_REASON =
  "No source gives the cut in a private construction loan's rate that a public guarantee earns. " +
  'The evidence search found no evaluation of any public loan guarantee or revolving fund ' +
  '(financing evidence digest, section 7), and no published spread between guaranteed and ' +
  'unguaranteed multifamily construction loans in San Francisco. A guarantee has no sourced ' +
  'grant-equivalent; it can be offered only with a rate cut the user types, labelled custom, ' +
  'not sourced.';

export const MARKET_TERMS: MarketTerms = deepFreeze({
  constructionRate: {
    value: 0.085,
    provenance: {
      tier: 3,
      label: 'Construction loan interest rate',
      sources: [TERNER],
      method:
        'Terner Center, Making It Pencil, December 2023, p. 12, verified, accessed 2026-11-09: ' +
        '"we have assumed a total interest rate of 8.5 percent for the construction loan and 6 ' +
        'percent for the permanent loan across each prototype". California prototypes (East ' +
        'Bay, South Bay, Sacramento, Los Angeles), not San Francisco, and rates of late 2023. ' +
        "No San Francisco or official figure was found: the Controller's feasibility review " +
        'and its TAC deck give no financing terms (both read in full).'
    }
  },
  constructionYears: {
    value: 1.917,
    provenance: {
      tier: 2,
      label: 'Construction loan life, in years',
      sources: [
        {
          label: 'Dataset 2026-11-08-d15bdf2d, scenarios/fzp/calibration.json',
          url: 'https://sfhousing.mindlace.net/data/2026-11-08-d15bdf2d/scenarios/fzp/calibration.json'
        }
      ],
      method:
        'The median month by which half of the eventual completions from construction have ' +
        'happened, 23 months, in the fitted construction-stage table of dataset ' +
        '2026-11-08-d15bdf2d (calibration.json, transitions.discretionary.construction.advance, ' +
        'n = 1,274, window 2007-01-01 to 2026-10-19; 23 for streamlined, 21 for permit-only), ' +
        'computed for this spec, accessed 2026-11-09; 23 ÷ 12 rounded to three decimals. Tier 0 ' +
        'data; reading the stage time as the life of the construction loan is an inference ' +
        '(tier 2). The saving is counted on the average share of the loan that is out, ' +
        'AVERAGE_DRAWN.',
      n: 1274,
      window: ['2007-01-01', '2026-10-19']
    }
  },
  requiredReturn: {
    value: 0.06,
    provenance: {
      tier: 1,
      label: 'Return-on-cost that private capital requires',
      sources: [CONTROLLER, TAC_DECK],
      method:
        'Controller, Triennial 2026, p. 11 row 14, "Untrended Return-on-Cost" 6.00% for every ' +
        "prototype, accessed 2026-11-09; the February draft's note (c) calls it the " +
        '"return-on-cost target to derive residual land value" (TAC deck slide 14, which used ' +
        '5.25%).'
    }
  },
  guaranteeRateCut: { value: null, reason: GUARANTEE_REASON },
  lossOnExit: {
    value: 1,
    provenance: {
      tier: 4,
      label:
        'Share of what was spent that a funded project loses if it exits after construction began',
      sources: [],
      method:
        'Invented, as the design rules (OD-F8): a funded project that exits after construction ' +
        'began loses the whole amount spent or out. Found and not used, accessed 2026-11-09: ' +
        'FDIC Quarterly Banking Profile, Table V-A, net charge-off rates on ' +
        'construction and development loans of 5.40% (2009), ' +
        "5.45% (2010) and −0.01% (2019), and the public-bank plans' 2.5% loss allowance, are " +
        'portfolio rates per year, not the loss on one abandoned project.'
    }
  }
});

export const TYPED_TERM_RANGES: Readonly<Record<TermKey, readonly [number, number]>> = deepFreeze({
  constructionRate: [0, 0.25],
  constructionYears: [0.25, 10],
  requiredReturn: [0.01, 0.25],
  guaranteeRateCut: [0, 0.05],
  lossOnExit: [0, 1]
});

const TERM_KEYS = Object.keys(TYPED_TERM_RANGES) as TermKey[];

export const CONSTRUCTION_LOAN_TO_COST: Sourced<number> = deepFreeze({
  value: 0.55,
  provenance: {
    tier: 3,
    label: 'Construction loan-to-cost ratio lenders require',
    sources: [TERNER],
    method:
      'Terner Center, Making It Pencil, December 2023, p. 13, verified, accessed 2026-11-09: ' +
      '"Typically, in California, we found that lenders currently require an approximately 55 ' +
      'percent LTC ratio." California, not San Francisco. Not read by any grant-equivalent ' +
      "formula; a preset's starting cost share."
  }
});

export const DRAW_UP_FRONT: Sourced<number> = deepFreeze({
  value: 0.1,
  provenance: {
    tier: 4,
    label: 'Share of a construction loan drawn at the start',
    sources: [],
    method:
      "The partner's assumption, R11: 10% of a construction loan is drawn at the start to get " +
      'building under way, and the rest evenly over the construction period. No source for a ' +
      'draw schedule was found.'
  }
});

export const AVERAGE_DRAWN: Sourced<number> = deepFreeze({
  value: DRAW_UP_FRONT.value + (1 - DRAW_UP_FRONT.value) / 2,
  provenance: {
    tier: 4,
    label: 'Average share of a construction loan that is out',
    sources: [],
    method:
      "The partner's assumption, R11: arithmetic on DRAW_UP_FRONT. A loan's and a " +
      "guarantee's interest saving is counted on this share of the principal over the " +
      'construction period. A pool still commits the whole principal at the start.'
  }
});

export function resolveTerms(
  m: MarketTerms = MARKET_TERMS,
  typed: Partial<Record<TermKey, number>> = {}
): ResolvedTerms {
  const out = {} as Record<TermKey, number | null>;
  const custom: TermKey[] = [];
  for (const key of TERM_KEYS) {
    const v = typed[key];
    if (v === undefined) {
      out[key] = m[key].value;
      continue;
    }
    const [lo, hi] = TYPED_TERM_RANGES[key];
    if (!Number.isFinite(v) || v < lo || v > hi) {
      throw new RangeError(`${key} must be between ${lo} and ${hi}; got ${v}`);
    }
    out[key] = v;
    custom.push(key);
  }
  custom.sort();
  return { ...out, custom };
}

export function isResolvedTerms(t: MarketTerms | ResolvedTerms): t is ResolvedTerms {
  return 'custom' in t;
}
