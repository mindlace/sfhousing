// The Controller's feasibility prototypes (row F4) and the two per-home cost functions the engine
// and the pipeline's market slope read. Pure; relative imports only.
import type { Dollars, ProjectKind, Provenance } from '../../timelapse/types';
import type { Sourced } from './evidence';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export interface Prototype {
  id: 'A' | 'B' | 'C' | 'D' | 'E';
  stories: number;
  homes: number;
  costPerHome: Dollars;
  shortfallPerHome: Dollars;
  provenance: Provenance;
}
export type PrototypeId = Prototype['id'];

const CONTROLLER = {
  label:
    'Controller, "Inclusionary Housing: Triennial Review of Economic Feasibility, 2026", ' +
    '2026-04-30, corrected 2026-05-19',
  url: 'https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf'
};
const TAC_DECK = {
  label: 'Controller, TAC meeting 2 presentation, 2026-02-11, slide 14 (cost footnote (a))',
  url: 'https://media.api.sf.gov/documents/TAC_Meeting_2_Presentation_-_2-11-2026.pdf'
};
const BLA = {
  label:
    'Budget and Legislative Analyst, "Funding and Incentivizing Affordable Housing in San ' +
    'Francisco", 2026-06-05',
  url: 'https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf'
};

function prototype(
  id: PrototypeId,
  stories: number,
  homes: number,
  costPerHome: Dollars,
  shortfallPerHome: Dollars
): Prototype {
  return Object.freeze<Prototype>({
    id,
    stories,
    homes,
    costPerHome,
    shortfallPerHome,
    provenance: {
      tier: 1,
      label: `Controller feasibility prototype ${id}`,
      sources: [CONTROLLER, TAC_DECK],
      method:
        `Read from the Controller's report, accessed 2026-11-09: stories and homes p. 11 rows 1 ` +
        `and 5 (also p. 8); costPerHome p. 11 row 11 "Total Costs (Total / Unit)", which ` +
        `excludes land (footnote (a) as printed in the February 2026 draft, TAC meeting 2 deck ` +
        `slide 14; the final report prints no notes); shortfallPerHome the negation of p. 4 ` +
        `"Residual Land Value per Unit", apartments, row 1 "Base - Current Projects", with ` +
        `"current" the requirements that will apply, absent legislative action, on November 1, ` +
        `2026 (p. 3, footnote 2). ` +
        `Assigning a project to this prototype by its stories and homes is a tier 4 binning ` +
        `(PROTOTYPE_BINNING).`
    }
  });
}

export const PROTOTYPES: readonly Prototype[] = Object.freeze([
  prototype('A', 5, 45, 729_700, 177_000),
  prototype('B', 8, 130, 736_700, 152_000),
  prototype('C', 13, 227, 857_700, 206_000),
  prototype('D', 24, 341, 918_700, 292_000),
  prototype('E', 4, 13, 929_700, 353_000)
]);

export const PROTOTYPE_BINNING: Sourced<null> = deepFreeze({
  value: null,
  provenance: {
    tier: 4,
    label: 'Prototype binning by stories and homes',
    sources: [CONTROLLER],
    method:
      'Invented binning: fewer than 25 homes is E; otherwise up to 6 stories A, up to 10 B, up ' +
      'to 18 C, above that D. The bins split the stories halfway between neighbouring ' +
      'prototypes and put every project under 25 homes with the 13-home prototype, the only one ' +
      "in the report's 10 to 24 home band."
  }
});

/** The prototype a project of `stories` and `homes` is priced as. Fractions compare as given. */
export function prototypeFor(stories: number, homes: number): Prototype {
  if (!Number.isFinite(stories) || !Number.isFinite(homes)) {
    throw new RangeError(`prototypeFor needs finite stories and homes; got ${stories}, ${homes}`);
  }
  if (homes < 25) return PROTOTYPES[4];
  if (stories <= 6) return PROTOTYPES[0];
  if (stories <= 10) return PROTOTYPES[1];
  if (stories <= 18) return PROTOTYPES[2];
  return PROTOTYPES[3];
}

export const LAND_PER_HOME: Sourced<Dollars> = deepFreeze({
  value: 65_000,
  provenance: {
    tier: 2,
    label: 'Market-rate land cost per home',
    sources: [CONTROLLER],
    method:
      "The midpoint of the Controller's published range of $60,000 to $70,000 a home (p. 3, " +
      'tier 1). The one recorded market-rate land sale was $68,000 a home (p. 3), within that ' +
      'range; the TAC deck (slide 22) lists it as the only entitled sale of 2023 to 2025. ' +
      'Accessed 2026-11-09.'
  }
});

export const AFFORDABLE: Sourced<{ costPerHome: Dollars; ownPerHome: Dollars }> = deepFreeze({
  value: { costPerHome: 954_127, ownPerHome: 92_602 },
  provenance: {
    tier: 1,
    label: 'Average funding per home, 2024 tax-credit affordable projects',
    sources: [BLA],
    method:
      'Exhibit F, p. 7: average funding per home in 2024 tax-credit projects, $954,127 ' +
      '(costPerHome); permanent loans $87,431 plus other $5,171 = $92,602 (ownPerHome; a tier 2 ' +
      'sum of tier 1 values). Accessed 2026-11-09.'
  }
});

function checkKind(kind: ProjectKind): void {
  if (kind !== 'market' && kind !== 'affordable') {
    throw new RangeError(`unknown project kind: ${kind}`);
  }
}

/** What public money must cover per home: the shortfall plus land, or the affordable average. */
export function uncoveredPerHome(kind: ProjectKind, p: Prototype): Dollars {
  checkKind(kind);
  return kind === 'market'
    ? p.shortfallPerHome + LAND_PER_HOME.value
    : AFFORDABLE.value.costPerHome - AFFORDABLE.value.ownPerHome;
}

/** Total cost per home, excluding land for market homes; the prototype is ignored for affordable. */
export function costPerHome(kind: ProjectKind, p: Prototype): Dollars {
  checkKind(kind);
  return kind === 'market' ? p.costPerHome : AFFORDABLE.value.costPerHome;
}
