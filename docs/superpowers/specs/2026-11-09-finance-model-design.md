# `finance-model`: sourced constants and the arithmetic of public money

Status: derived from the approved composition design [2026-11-09-1911-sim-financing.md](../design/2026-11-09-1911-sim-financing.md) (rulings R0 to R12). Research: [the financing evidence digest](../research/2026-11-09-financing-evidence.md). Package ledger: `.superpowers/superconductor/sim-financing/ledger.md`.

Evidence tiers throughout: 0 per-record data, 1 official aggregate or law, 2 inference, 3 literature or a research model, 4 invented. "Verified" means read in the primary document for this spec on 2026-11-09, at the page given. "Inferred" means a conclusion of this spec, with its reason.

## 1. Scope

The design's Subsystems table row:

| Slug | Scope |
| --- | --- |
| `finance-model` | Pure, worker-safe functions and sourced constants: the prototypes, uncovered cost, grant-equivalents, coverage, the odds shift, debt service, the legal-limit arithmetic. Every constant is `Sourced` or `Unsourced` with a `Provenance`, as `timing-sources.ts` does. No engine or UI code. |

### In

- A new directory `src/lib/sim/finance/`, pure TypeScript, relative imports only (no `$lib`, no zod, no DOM, no `Intl` with a default locale), so that the worker, the page and the data pipeline can all import it. Files (names are internal; the exports are not):
  - `evidence.ts`: the shared helper types `Sourced<T>`, `Unsourced`, `Evidence<T>`, moved out of the page (row F4; section 4.1).
  - `prototypes.ts`: the five prototypes, `PROTOTYPES`, `PROTOTYPE_BINNING`, `prototypeFor`, `LAND_PER_HOME`, `AFFORDABLE`, `uncoveredPerHome`, `costPerHome` (row F4).
  - `terms.ts`: `MarketTerms`, `MARKET_TERMS`, `TYPED_TERM_RANGES`, `resolveTerms`, `CONSTRUCTION_LOAN_TO_COST`, `DRAW_UP_FRONT`, `AVERAGE_DRAWN`, and a re-export of `TermKey` and `ResolvedTerms`, which step 0 declares in `src/lib/timelapse/types.ts` (row F8).
  - `instruments.ts`: `grantEquivalentPerHome`, `coverage`, `oddsShift`, `CERTAIN_TOLERANCE`, `isCertain`, `termsNeeded`, `missingTerms`, `validateInstrument`, `fundBundle`, `projectDollars` (row F8).
  - `tiers.ts`: `AMI_TIER_BOUNDS`, `tierOfAmi`, `INCLUSIONARY`, `inclusionaryUnits`, `DISPLACEMENT_RANGE`.
  - `debt.ts`: `debtService`, the legal-limit constants and `limitStatements`.
  - `index.ts`: re-exports all of the above.
- The re-export in `src/lib/sim-page/timing-sources.ts` that keeps its current importers working after the move.
- `docs/dev/finance-model.md` and its `CLAUDE.md` link.

### Out

- The engine's use of these functions (funded starts, the queue, pools, the ledger): `finance-engine` (F9 to F11).
- Choosing which programmes form a project's bundle, whether a pool can pay, and the award loop that leaves out programmes whose pools cannot pay and prices the rest again: `finance-engine` (F9 (b), (c), (f)). This spec supplies the one pricing rule the loop calls, `fundBundle` (F8).
- The arrival dates of inflows, `inflowArrivals`: `finance-engine` (F5).
- Results, tier counts per schedule (`tiersOf`, which weights a funded affordable project's tiers by `fundBundle`'s per-item grant-equivalents), the `money` series and the list of borrowing the policy adds that `limitStatements` measures: `finance-score` (F13, F14).
- Parsing levers (including `FinanceLevers.terms`), presets and the twin: `finance-levers` (F7, F15 to F17). This spec supplies `validateInstrument`, `TYPED_TERM_RANGES` and `resolveTerms`, which that subsystem calls.
- Adding `src/lib/sim/finance` to the hashed paths in `pipeline/lib/version.ts`: `market-baseline` (global constraint "The engine is in the dataset version").
- Declaring `TermKey` and `ResolvedTerms`: step 0, in `src/lib/timelapse/types.ts`, with the shape of section 2 (row F8).
- Computing the market level and the slope: `market-baseline` (F2). This spec supplies the prototypes and `uncoveredPerHome` it needs.
- The baseline funding's pools and shares: `finance-data` (F12). This spec supplies `AFFORDABLE`, `uncoveredPerHome('affordable', …)` and `tierOfAmi`, which that subsystem uses.
- Any page, component or text shown on a page other than the strings this spec fixes (`LimitStatement.text`, the error texts, each `Provenance`).

### Hand-offs

| To | What |
| --- | --- |
| `market-baseline` | `PROTOTYPES`, `prototypeFor`, `uncoveredPerHome('market', p)`, `p.costPerHome` for `typicalUncoveredShare` (F2). |
| `finance-data` | `AFFORDABLE`, `uncoveredPerHome('affordable', p)` (the denominator of each baseline grant's `share`), `tierOfAmi` for the MOHCD income bands. |
| `finance-engine` | `prototypeFor`, `uncoveredPerHome`, `costPerHome`, `grantEquivalentPerHome`, `fundBundle`, `coverage`, `isCertain`, `CERTAIN_TOLERANCE`, `oddsShift`, `projectDollars`, `MARKET_TERMS` and `resolveTerms` (for `buildSimInput`, F9), `ResolvedTerms` (with `lossOnExit`). |
| `finance-score` | `prototypeFor`, `fundBundle` (tier weights, F13), `INCLUSIONARY`, `inclusionaryUnits`, `tierOfAmi`, `DISPLACEMENT_RANGE`, `debtService`, `limitStatements`. |
| `finance-levers` | `MARKET_TERMS`, `resolveTerms` (F17), `TYPED_TERM_RANGES` (to validate `FinanceLevers.terms`, F7), `missingTerms`, `validateInstrument`, `CONSTRUCTION_LOAN_TO_COST`, the `Evidence` types for presets. |
| `funding-ui` | `fundBundle`, `prototypeFor`, `resolveTerms` and `missingTerms` for the coverage line and the typed-term field; every `Provenance` and `Unsourced.reason` above, for "Sources and tiers". |

## 2. Interfaces

Rows copied verbatim from the design's interface table. "Owns" and "consumes" follow the design's "Row ownership". Rows F9, F13 and F14 are owned by other subsystems; they are copied because they name functions and constants this spec owns (`resolveTerms`, `fundBundle`, `oddsShift`, `uncoveredPerHome` and `terms.lossOnExit` in F9; `fundBundle`, `INCLUSIONARY` and `inclusionaryUnits` in F13; `debtService`, `LimitStatement` and `DISPLACEMENT_RANGE` in F14). Row F7 (owned by `finance-levers`) is not copied; this spec reads one field of it, `FinanceLevers.terms: Partial<Record<TermKey, number>>`, which `applyLevers` passes to `resolveTerms` (F17).

| Row | | Interface | This spec |
| --- | --- | --- | --- |
| F1 | D | `type Dollars = number` is whole constant dollars of the dataset's `asOf` year. `type IncomeTier = 'veryLow' \| 'low' \| 'moderate' \| 'aboveModerate'`; `INCOME_TIERS` lists them in that order. `type TierUnits = Record<IncomeTier, number> & { unrecorded: number }`: `unrecorded` is income-restricted homes whose tier the records do not give. `type ProjectKind = 'market' \| 'affordable'`. These, and the types of rows F2, F5, F6 and F12, live in `src/lib/timelapse/types.ts` (relative imports only; the pipeline imports it by path, and `calibration.json` carries them). |
| F4 | M | `interface Prototype { id: 'A' \| 'B' \| 'C' \| 'D' \| 'E'; stories: number; homes: number; costPerHome: Dollars; shortfallPerHome: Dollars; provenance: Provenance }`: `costPerHome` is the Controller's total cost excluding land, `shortfallPerHome` the negated residual land value under current requirements. `PROTOTYPES: readonly Prototype[]` lists A to E. `prototypeFor(stories: number, homes: number): Prototype`: fewer than 25 homes is E; otherwise up to 6 stories A, up to 10 B, up to 18 C, above that D (binning tier 4, stated in the provenance). `LAND_PER_HOME: Sourced<Dollars>`. `AFFORDABLE: Sourced<{ costPerHome: Dollars; ownPerHome: Dollars }>` (the Budget Analyst's average; `ownPerHome` is permanent loans plus other). `uncoveredPerHome(kind: ProjectKind, p: Prototype): Dollars` is `p.shortfallPerHome + LAND_PER_HOME` for `market` and `AFFORDABLE.costPerHome − AFFORDABLE.ownPerHome` for `affordable`. `costPerHome(kind, p)` is `p.costPerHome` for `market` and `AFFORDABLE.costPerHome` for `affordable`. `src/lib/sim/finance/` has no `$lib` import, because the pipeline imports it by path; `Sourced`, `Unsourced` and `Evidence` are declared in `src/lib/sim/finance/evidence.ts` and re-exported from `src/lib/sim-page/timing-sources.ts`. |
| F5 | M | `type Inflow = { kind: 'once'; day: Day; dollars: Dollars } \| { kind: 'yearly'; from: Day; to: Day \| null; dollarsPerYear: Dollars }`; a yearly inflow arrives on `from` and on the same month and day of each later year (29 February becomes 28 February in a common year), up to `to` inclusive, and an arrival before the run's `asOf` is never received. `inflowArrivals(inflow: Inflow, asOf: Day, horizon: Day): Day[]` in `src/lib/sim/scenario/funding.ts` (`finance-engine`) is the one implementation; `finance-levers` imports it. `type PoolKind = 'goBond' \| 'cop' \| 'generalRevenue' \| 'dedicatedTax' \| 'state' \| 'federal' \| 'bank'`. `interface Pool { id: string; kind: PoolKind; label: string; inflows: Inflow[]; uncapped: boolean; debt: { rate: number; termYears: number } \| null; leverage: number }`: an `uncapped` pool can always pay and has no inflows (in the baseline, only the federal tax-credit pool); `debt` is non-null exactly for `goBond` and `cop`, with `rate` above 0 and at most 0.25 and `termYears` 1 to 40 (the bounds every validator and `debtService` share); `leverage` is the dollars a pool may have committed or out per dollar received: 1 for every kind but `bank`, where it is a sourced or typed number that may be below 1 (the SF plans lend 0.67 to 0.82 per City dollar and take no deposits). |
| F6 | M | `type Instrument = { kind: 'grant'; share: number } \| { kind: 'loan'; costShare: number; rate: number; requiredReturn: number \| null } \| { kind: 'guarantee'; costShare: number; reserve: number }`. A grant pays `share` (0 < share ≤ 1) of the project's uncovered cost per home. A loan lends `costShare` of cost per home at `rate`, repaid to its pool on the project's completion day; `requiredReturn`, when set, is the return the lent capital accepts in place of the market's, between 0.01 and 0.25. A guarantee covers a private loan of `costShare` of cost per home and holds `reserve` (a share of that loan) in its pool until completion. `interface Programme { id: string; label: string; pool: string; reach: ProjectKind; instrument: Instrument; from: Day; to: Day \| null; minHomes: number; tiers: Record<IncomeTier, number> \| null }`: `minHomes` is a whole number of 0 or more (at most 10,000), and an instrument is valid when `finance-model`'s `validateInstrument` accepts it, the one check every validator calls; `tiers` (shares summing to 1) is required for `reach: 'affordable'` and null otherwise. |
| F8 | M | `grantEquivalentPerHome(inst: Instrument, kind: ProjectKind, p: Prototype, terms: MarketTerms \| ResolvedTerms): Dollars`. Grant: `share × uncoveredPerHome`. Loan: principal `costShare × costPerHome`, times `max(0, terms.constructionRate − rate)`, times `terms.constructionYears`, times `AVERAGE_DRAWN`; plus, when `requiredReturn` is set and below `terms.requiredReturn`, `costShare × ownValuePerHome × (terms.requiredReturn ÷ requiredReturn − 1)`, where `ownValuePerHome` is `costPerHome − shortfallPerHome` for `market` and `AFFORDABLE.ownPerHome` for `affordable`. Guarantee: `costShare × costPerHome × terms.guaranteeRateCut × terms.constructionYears × AVERAGE_DRAWN`. `AVERAGE_DRAWN: Sourced<number>` is the average share of a construction loan that is out over the construction period, `DRAW_UP_FRONT + (1 − DRAW_UP_FRONT) ÷ 2` = 0.55, with `DRAW_UP_FRONT: Sourced<number>` = 0.10 drawn at the start and the rest drawn evenly (ruling R11; a tier 4 assumption, labelled as one). It changes only the saving: a pool still commits a loan's whole principal at the start (F9 (g)). A loan's grant-equivalent is never more than its principal. `MarketTerms` are `Evidence` constants keyed by `TermKey = 'constructionRate' \| 'constructionYears' \| 'requiredReturn' \| 'guaranteeRateCut' \| 'lossOnExit'`. `resolveTerms(MARKET_TERMS, typed)` gives `ResolvedTerms`: each term a number, or null when it is unsourced and not typed, with `custom: TermKey[]` naming the typed ones (both types are declared in `src/lib/timelapse/types.ts` at step 0). An instrument that needs a null term cannot be compiled or offered; on a typed term it runs labelled "custom, not sourced". `coverage(g: Dollars, kind, p): number` is `g ÷ uncoveredPerHome`. `oddsShift(g: Dollars, kind, p, slope: number): number` is `slope × g ÷ costPerHome(kind, p)`. `fundBundle(items: readonly { instrument: Instrument; poolKind: PoolKind }[], kind, p, terms): { items: { grantEquivalent: number; granted: number; lent: number; guaranteed: number; reserve: number }[]; grantEquivalent: number; coverage: number; certain: boolean }` prices a bundle per home (OD-F10), in three tiers by pool kind: `federal` pools, then `state` pools, then the City's (`bank`, `dedicatedTax`, `generalRevenue`, `goBond`, `cop`). Within a tier, loans and guarantees count first, in input order, at their full grant-equivalent; the tier's grants then each pay `share × uncoveredPerHome` when they fit in what remains of the uncovered cost, and otherwise the same fraction of it, so that the tier covers exactly what remains. Grants never pay more than the uncovered cost, outside money counts before the City's, and the City's sources share what is left in proportion, so that money added to one relieves all of them. A project is **certain** when `isCertain(coverage)`: the coverage of its bundle is at least 1 − 10⁻⁹ (a floating-point tolerance, not a model number). Every comparison of two coverages in F9 (b) and (c) allows the same tolerance. |
| F9 | M | Engine input: `SimInput.finance?: { pools: Pool[]; programmes: Programme[]; off: { pool: string; from: Day; to: Day \| null }[]; slope: number; terms: ResolvedTerms }` (the baseline's pools and programmes after `baselineScale`, then the added ones; `off` lists the spans in which a pool is switched off, F7, `to` inclusive); absent means no public money at all, and the run is the run the engine makes without this package under the same `market`. Rules the engine implements: (a) a lot always keeps its ordinary start (kind `market`, no bundle, the engine's existing draws). For each project kind that some programme reaches, it has in addition one funded latent start: its size is the lot's size draw, made first; in each month its log-odds are the lot's under `market`, plus `oddsShift` of the bundle active in that month, and it is certain in a month whose bundle's coverage is at least 1; the `market` kind's funded start uses the ordinary start's draws (so it is never later than the ordinary start), and the `affordable` kind's uses its own (F11), with unshifted log-odds the lot's less `slope × (uncoveredPerHome('affordable') − uncoveredPerHome('market', p)) ÷ costPerHome('affordable')`; (b) a month's bundle is the programmes reaching the kind, in `finance.programmes` order, that are active on the month's first day, whose pool is not off that day and whose `minHomes` the project's drawn size meets; it is priced by `fundBundle` (F8); a latent start that falls in a month whose bundle is empty makes no application; a waiting application is re-made in place, keeping its place in line, on each day a programme starts or ends, a pool goes off or on, or a regime begins, and it lapses (its latent start is drawn again as a new spell from that day, on the same draws) when its re-made bundle is empty or its coverage, counted up to 1, is lower than before; (c) the ordinary start starts at once on its day; a funded start applies on its day and is awarded when its bundle can be paid for the whole project at its start size: the programmes whose pools cannot pay their part are left out and the rest priced again by `fundBundle`, repeatedly, until every pool left can pay; it is awarded with the programmes left when their coverage, counted up to 1, is not below the whole bundle's, and otherwise it waits (OD-F10: a short pool is made up by the others only as far as their shares allow, and a project never starts on less than it applied for); (d) on each day a pool changes, or an application is made or re-made, the waiting line is served in order of application day, then the first day of the latent start month the lot's own draw for that kind gives at the lot's unshifted hazard, then parcel id, taking each project its pools can pay (OD-F9b: a funded project's site is drawn the way a private project's is, on a separate draw); (e) the earliest of a lot's latent starts wins, and a lot that starts leaves every line; (f) a capped pool's available money is `leverage × received − committed − spent − out − lost` (`committed` is what is promised and not yet paid, with the guarantee reserves held; `spent` is grants paid; `out` is loan principal outstanding; `lost` is the losses on loans and guarantees), and an uncapped pool can always pay; (g) grants and loan principal are committed at the start day, become spent or out at `entered.construction`, and are released if the project exits before construction; guarantee reserves are held from the start day to the end; (h) a loan returns on the completion day; a funded project that exits after construction began loses `terms.lossOnExit` of what was spent or out, and a guarantee loses that share of the guaranteed principal, at most its reserve; (i) a certain project never exits: each of its stage steps draws the stage's time to advance, conditional on advancing (`sampleAdvance(t: Transition, u: number): { days: number }` in `timelapse/model.ts`, the advance column of the same table, renormalised), and its size is not revised; a partly covered project is revised as today, and its commitments stay at its start size; (j) a certain `affordable` project's pathway is drawn from `Calibration.affordableRoutes` (F12); every other project's pathway is drawn as today; (k) funded starts obey `regimes` and `reservedFrom` exactly as ordinary simulated starts do (the hazard, size row and envelope of the view in force in the month); (l) pipeline rows never apply and never draw on a pool: they are taken as already funded (a tier 4 assumption, exported by the engine as `PIPELINE_FUNDED`, a `Provenance`, and stated in the results' sources). `buildSimInput` sets `finance` from `Calibration.baselineFunding` (with `off: []`, the market's `slope` and `resolveTerms(MARKET_TERMS)`) when the calibration has both `baselineFunding` and `market`, from `finance-engine` on; before that, or without either, it sets none. The twin's `finance` is the unscaled baseline alone. |
| F13 | M | `Target` gains `tier?: IncomeTier`. `RHNA_TIER_TARGETS: readonly Target[]` (very low 20,867; low 12,014; moderate 13,717; above moderate 35,471; tier 1). `tiersOf(sc: Schedule, ctx): TierUnits` gives a completed schedule's homes by tier: a funded affordable schedule by the `tiers` of the programmes that pay it, weighted by the grant-equivalent each pays (`fundBundle` on `funding.programmes`) and rounded to whole homes by largest remainder, ties to the earlier tier (OD-F10); any other simulated project of 10 homes or more its on-site share by `INCLUSIONARY` (a `Sourced` table of rates and tiers by size and tenure, read through `finance-model`'s `inclusionaryUnits(homes: number, tenure?: Tenure): Record<IncomeTier, number>`), the rest `aboveModerate`; a pipeline project `affordableHomes` as `unrecorded` and the rest `aboveModerate` (the Planning field is never blank, so a recorded 0 may mean "not stated", and the provenance says so). |
| F14 | M | `TimelineScore.tiers?: { completed: TierUnits[]; baseline: TierUnits; targets: TargetProgressAt[] }` (`completed[i]` cumulative net new homes by tier at the end of month `i`; `targets` one entry per `RHNA_TIER_TARGETS` row, whose `fraction[i]` is that tier's baseline plus `completed[i]`, over its target). `TimelineScore.money?: { pools: { id: string; label: string; kind: PoolKind; received: number[]; committed: number[]; out: number[]; spent: number[]; repaid: number[]; lost: number[]; lostCredit: number[] }[]; fundedHomes: number[]; displacedHomes: number[]; publicSpent: number[]; owed: { pool: string; principal: Dollars; repayment: number; nominal: true }[]; limits: LimitStatement[] }`, all series per month from the shown run, at the month's end: `committed` and `out` are the amounts outstanding, the others are cumulative. `lost` counts every `loss` event: loan principal and guarantee reserves lost, and grants paid to projects that then dropped out (OD-F8; such a grant is also in `spent`). `lostCredit` is the part of `lost` that is loan principal and guarantee reserves: the part that enters F9 (f), and the part added to `spent` when public money spent is totalled, so a lost grant is never counted twice. `owed` uses `finance-model`'s `debtService(principal: Dollars, debt: { rate: number; termYears: number }): { annual: Dollars; total: Dollars }`. `limits` are computed from the borrowing the policy adds (the added `goBond` and `cop` pools, and what a scaled baseline debt pool receives above its unscaled amount), not from the run's outcomes; `goVote.exceeded` is true whenever that statement is shown. Public money per added home is derived, not stored: money spent over `fundedHomes − displacedHomes` (`perAddedHome`, for all public money and for the City's pools alone). `LimitStatement = { id: 'goRate' \| 'goCap' \| 'goVote' \| 'copCap'; exceeded: boolean; text: string; provenance: Provenance }`. `fundedHomes[i]` and `displacedHomes[i]` count net homes of funded projects completed by month `i` and the `displaced` homes of those projects. `DISPLACEMENT_RANGE: Sourced<{ low: number; high: number }>` (0.115 to 0.8 of subsidised homes; national studies, tier 3; no San Francisco estimate) is shown beside them. `tiers` is present on every run; `money` only on a run with at least one pool. The band stays on `completedNet`. |

### Internal types and exports

These are new. None alters a row; where a row is insufficient the gap is listed under "Interface concerns" (section 10).

```ts
// evidence.ts (moved from src/lib/sim-page/timing-sources.ts, unchanged in shape)
export interface Sourced<T> { value: T; provenance: Provenance }
export interface Unsourced { value: null; reason: string }
export type Evidence<T> = Sourced<T> | Unsourced;

// prototypes.ts
export type PrototypeId = Prototype['id'];
export const PROTOTYPES: readonly Prototype[];            // A, B, C, D, E in that order, frozen
export const PROTOTYPE_BINNING: Sourced<null>;             // tier 4 provenance of prototypeFor's bins

// src/lib/timelapse/types.ts (declared by step 0 with exactly this shape, row F8; no behaviour)
export type TermKey =
  'constructionRate' | 'constructionYears' | 'requiredReturn' | 'guaranteeRateCut' | 'lossOnExit';
export type ResolvedTerms = {
  constructionRate: number | null; constructionYears: number | null; requiredReturn: number | null;
  guaranteeRateCut: number | null; lossOnExit: number | null;   // as step 0 declared it (row F8: each term a number or null); `MARKET_TERMS.lossOnExit` is `Sourced`, so the resolved value is never null
  custom: TermKey[];   // keys whose value the user typed ("custom, not sourced"), sorted
};

// terms.ts
export type { TermKey, ResolvedTerms } from '../../timelapse/types';
export type MarketTerms = {
  constructionRate: Evidence<number>; constructionYears: Evidence<number>;
  requiredReturn: Evidence<number>; guaranteeRateCut: Evidence<number>; lossOnExit: Sourced<number>;
};
export const MARKET_TERMS: MarketTerms;
export const TYPED_TERM_RANGES: Readonly<Record<TermKey, readonly [lo: number, hi: number]>>;
export function resolveTerms(m?: MarketTerms, typed?: Partial<Record<TermKey, number>>): ResolvedTerms;
export const CONSTRUCTION_LOAN_TO_COST: Sourced<number>;   // for presets; not read by F8
export const DRAW_UP_FRONT: Sourced<number>;               // 0.10, tier 4, the partner's assumption (R11)
export const AVERAGE_DRAWN: Sourced<number>;               // 0.55 = DRAW_UP_FRONT + (1 − DRAW_UP_FRONT) ÷ 2, tier 4 (F8)

// instruments.ts
export const CERTAIN_TOLERANCE = 1e-9;
export function isCertain(coverage: number): boolean;      // coverage >= 1 - CERTAIN_TOLERANCE
export function termsNeeded(inst: Instrument): TermKey[];
export function missingTerms(inst: Instrument, terms: MarketTerms | ResolvedTerms): TermKey[];
export const INSTRUMENT_BOUNDS: {                         // the one set of instrument bounds (F6), inclusive
  share: { gt: 0; max: 1 }; costShare: { gt: 0; max: 1 }; rate: { min: 0; max: 0.25 };
  requiredReturn: { min: 0.01; max: 0.25 }; reserve: { min: 0; max: 1 };
};
export function validateInstrument(inst: Instrument): string | null;  // error text or null
export interface BundleItem { instrument: Instrument; poolKind: PoolKind }
export interface ItemFunding {
  grantEquivalent: number;  // exact dollars per home this item is worth to the project
  granted: number;          // exact grant dollars per home this item pays (after the cap)
  lent: number;             // exact loan principal per home
  guaranteed: number;       // exact guaranteed private principal per home
  reserve: number;          // exact reserve per home held in the pool
}
export interface BundleFunding { items: ItemFunding[]; grantEquivalent: number; coverage: number; certain: boolean }
export function fundBundle(items: readonly BundleItem[], kind: ProjectKind, p: Prototype,
  terms: MarketTerms | ResolvedTerms): BundleFunding;
export function projectDollars(perHome: number, homes: number): Dollars;

// tiers.ts
export const AMI_TIER_BOUNDS: Sourced<{ veryLow: number; low: number; moderate: number }>;
export function tierOfAmi(amiShare: number): IncomeTier;
export type Tenure = 'rental' | 'ownership';
export interface InclusionaryBand { minHomes: number; maxHomes: number | null; ami: number[]; basisPoints: number[] }
export const INCLUSIONARY: Sourced<Record<Tenure, InclusionaryBand[]>>;
export const ASSUMED_TENURE: Sourced<Tenure>;              // 'rental', tier 2
export function inclusionaryUnits(homes: number, tenure?: Tenure): Record<IncomeTier, number>;
export const DISPLACEMENT_RANGE: Sourced<{ low: number; high: number }>;

// debt.ts
export function debtService(principal: Dollars, debt: { rate: number; termYears: number }): { annual: Dollars; total: Dollars };   // row F14, exactly
export const DEBT_BOUNDS: { rate: { gt: 0; max: 0.25 }; termYears: { min: 1; max: 40; integer: true } };  // F5
export function validateDebt(debt: { rate: number; termYears: number }): string | null;  // error text or null
export interface Borrowing { pool: string; kind: 'goBond' | 'cop'; principal: Dollars; debt: { rate: number; termYears: number } }
export const DEBT_LIMITS: { /* section 4.8 */ };
export function limitStatements(borrowing: readonly Borrowing[]): LimitStatement[];
```

`Provenance` is `src/lib/timelapse/types.ts:53-60`. `Dollars`, `IncomeTier`, `INCOME_TIERS`, `ProjectKind`, `Instrument`, `PoolKind`, `TermKey` and `ResolvedTerms` come from step 0 in `src/lib/timelapse/types.ts` (F1, F5, F6, F8); `LimitStatement` is declared by step 0 in `src/lib/timelapse/types.ts` too (design, "Dependency order" item 0), because this module builds it and may not import `$lib`. This spec declares none of these types; it adds the behaviour behind them. All are imported by relative path. `BundleItem`, `ItemFunding` and `BundleFunding` are names for the exact parameter and result shapes F8 prints for `fundBundle`; they add no field.

## 3. Global constraints

Copied verbatim from the design.

- **Evidence hierarchy.** Every number the simulation uses carries a `Provenance` with its tier and source, and the interface can show both. A value that cannot be sourced is `Unsourced` with a reason; what depends on it is unavailable, or runs on a value labelled "custom, not sourced" that the user typed. No tier 3 or 4 number is presented as data.
- **Money never decides alone.** A funded project needs a lot the user's zoning makes hostable and free, takes its size from the same draw, and passes through the same stage tables as every other project. Only a fully funded project is exempt from drop-out (R6).
- **Deterministic and paired.** A run is a pure function of (dataset, levers, seed). The plan and the twin share draws: no existing draw purpose changes, and a lot's draws do not depend on the order lots are processed in.
- **No public money means no change.** With `finance` absent, the engine's output is identical, schedule for schedule, to its output before `finance-engine` under the same `market`. A test asserts it. The site's default is not that case: it runs the baseline funding.
- **The engine is in the dataset version.** `src/lib/sim/scenario`, `src/lib/sim/levers`, `src/lib/scoreboard`, `src/lib/timelapse` and `pipeline/` are hashed into the dataset version. The finance model shapes published data too, because the `/lesscars` build step runs the baseline funding: `src/lib/sim/finance/` (the functions and constants of F4 and F8) is added to the hashed paths in `pipeline/lib/version.ts` by `market-baseline`, the first subsystem whose pipeline code imports it. Any change in a hashed path needs a dataset build and upload before signoff ([pipeline.md](../../dev/pipeline.md), "Finishing a branch that changes the dataset"). The page's code stays outside them, in `src/lib/sim-page/`.
- **Goldens change only at the two releases.** The pipeline fixture goldens, the lesscars fixture goldens and `fixture-0` are regenerated by their documented commands for Release 1 (`market-baseline` with `finance-data`) and for Release 2 (`finance-engine`, when the default starts running the baseline funding), each reviewed as an engine or data change. The fixture build emits a fixture market model and fixture baseline funding, labelled tier 4, so the page and its e2e tests have both. `golden-seed1.json` and `model-golden.json` (the mini city and the small calibration, which have no market model and no funding) never change: they are the lock on "no public money means no change".
- **Open data only.** The dataset stays ODbL and PDDL. New sources go in the lock and the attribution list.
- **Worker-safe and client-side.** The simulation stays in the worker; nothing here adds a server computation or a binding. Shared policies stay in the `plan` table's `body`: no migration.
- **Stored documents keep loading.** A schema-2 policy, saved locally or published, opens with default funding. It is never treated as corrupt.
- **Constant dollars.** Every dollar figure is in the dataset year's dollars except bond repayment, which is nominal and labelled.
- **House rules.** Svelte 5 runes, Tailwind 4, colocated Vitest with `expect.requireAssertions`, Playwright e2e, WCAG 2.2 AA, compact results with detail on demand, status apart from controls, Conventional Commits, work in worktrees, signoff as the only merge gate.

## 4. Behaviour

### 4.1 Where the evidence types live

This follows row F4. Today `Sourced<T>`, `Unsourced` and `Evidence<T>` are declared in the page's own folder, `src/lib/sim-page/timing-sources.ts:9-17`, and imported by `src/lib/sim-page/timing.ts:40` (`type Evidence`, from `./timing-sources`). The finance model must not import from the page, and has no `$lib` import because the pipeline imports it by path (F4). The three types move, unchanged in shape, to `src/lib/sim/finance/evidence.ts`, and `timing-sources.ts` replaces its declarations with `export type { Sourced, Unsourced, Evidence } from '../sim/finance/evidence';`, so every existing importer compiles unchanged.

`TermKey` and `ResolvedTerms` are different: `SimInput.finance` (F9) carries a `ResolvedTerms`, so step 0 declares both in `src/lib/timelapse/types.ts` beside the other engine types, with the shape printed in section 2, and `terms.ts` re-exports them (F8). `MarketTerms` stays in `terms.ts`, because it is built from `Evidence` and only this module and its callers read it.

### 4.2 Prototypes (row F4)

All values are tier 1, Controller, *Inclusionary Housing: Triennial Review of Economic Feasibility, 2026*, 2026-04-30, corrected 2026-05-19 (https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf), verified: stories and homes p. 11 rows 1 and 5 (also p. 8); `costPerHome` p. 11 row 11 "Total Costs (Total / Unit)", which excludes land (footnote (a) as printed in the February 2026 draft, TAC meeting 2 deck slide 14, https://media.api.sf.gov/documents/TAC_Meeting_2_Presentation_-_2-11-2026.pdf; the final report prints no notes); `shortfallPerHome` the negation of p. 4 "Residual Land Value per Unit", apartments, row 1 "Base - Current Projects". "Current" is "the requirements that will apply, absent legislative action, on November 1, 2026" (p. 3, footnote 2).

| `id` | Building | `stories` | `homes` | `costPerHome` | `shortfallPerHome` |
| --- | --- | --- | --- | --- | --- |
| A | low-rise, Type V, 55 ft | 5 | 45 | 729,700 | 177,000 |
| B | mid-rise, Type III, 85 ft | 8 | 130 | 736,700 | 152,000 |
| C | high-rise, Type I, 135 ft | 13 | 227 | 857,700 | 206,000 |
| D | high-rise, Type I, 245 ft | 24 | 341 | 918,700 | 292,000 |
| E | small low-rise, Type V, 45 ft | 4 | 13 | 929,700 | 353,000 |

What else in the report was considered and left out, with the reason:

- **The net-income identity.** Net operating income ÷ homes ÷ 6.00% − cost (p. 11 rows 13, 5, 14, 11) gives −173,600, −150,900, −205,200, −291,300 and −311,000. Cases A to D match p. 4 within $3,000; E does not (−353,000 published). The published residuals are the constants; the identity is used only for the required-return term (4.4), where its inputs are published values.
- **Condominiums** (p. 4 second table, p. 12). The simulation does not know tenure; the rental tables are used throughout (4.6, `ASSUMED_TENURE`). Condominiums give smaller shortfalls in all five prototypes (164,000, 42,000, 184,000, 269,000 and 249,000 against 177,000, 152,000, 206,000, 292,000 and 353,000, p. 4), most for B; the choice of the rental tables does not rest on which is larger.
- **The State Density Bonus tables** (p. 4 row 4, pp. 9 and 11). The simulation's envelope does not record whether a project used the bonus, so the base programmes are used.
- **The 100% market-rate row** (p. 4 row 6). Illustrative only in the report's words (p. 3); not used.
- **Land** (p. 3): "only 1 market rate land sale transaction was identified at a land cost per unit of $68,000, which falls within the previously estimated land cost per unit range of $60,000 - $70,000". The TAC deck (slide 22) lists that sale as the only entitled sale of 2023 to 2025.

`PROTOTYPES` is a frozen array in the order A to E. Each prototype object is frozen and is the same object on every call (the engine may key caches on identity or on `id`). Each `provenance` has tier 1, the label "Controller feasibility prototype <id>", the source above, and a `method` that names the page and row of each value and ends: "Assigning a project to this prototype by its stories and homes is a tier 4 binning (PROTOTYPE_BINNING)."

`PROTOTYPE_BINNING` is `{ value: null, provenance }` with tier 4: "Invented binning: fewer than 25 homes is E; otherwise up to 6 stories A, up to 10 B, up to 18 C, above that D. The bins split the stories halfway between neighbouring prototypes and put every project under 25 homes with the 13-home prototype, the only one in the report's 10 to 24 home band."

**`prototypeFor(stories, homes)`**:

1. If either argument is not a finite number, throw `RangeError('prototypeFor needs finite stories and homes; got <stories>, <homes>')`.
2. `homes < 25` (including 0, 1, negative and fractional values) returns E.
3. Otherwise `stories <= 6` returns A (including 0 and negative stories), `<= 10` B, `<= 18` C, else D. Fractional values compare as given; no rounding.

Inputs are not rounded because the engine passes integers and the pipeline passes recorded integers; a fractional input is still classified deterministically.

**`LAND_PER_HOME`** = **65,000**, tier 2: the midpoint of the Controller's published range of $60,000 to $70,000 a home (p. 3, tier 1); the one recorded sale, $68,000, is in the method. The design's quoted uncovered costs (about $217,000 for B, $418,000 for E) are reproduced with this value.

**`AFFORDABLE`** = `{ costPerHome: 954,127, ownPerHome: 92,602 }`, tier 1: Budget and Legislative Analyst, *Funding and Incentivizing Affordable Housing in San Francisco*, 2026-06-05 (https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf), Exhibit F, p. 7, verified: average funding per home in 2024 tax-credit projects, $954,127; permanent loans $87,431 plus other $5,171 = $92,602 (tier 2 sum of tier 1 values, stated in the method).

**`uncoveredPerHome(kind, p)`** and **`costPerHome(kind, p)`** are exactly as row F4 says. Results (integers, so no rounding arises):

| | A | B | C | D | E |
| --- | --- | --- | --- | --- | --- |
| `uncoveredPerHome('market', p)` | 242,000 | 217,000 | 271,000 | 357,000 | 418,000 |
| `uncoveredPerHome('affordable', p)` | 861,525 | 861,525 | 861,525 | 861,525 | 861,525 |
| `costPerHome('affordable', p)` | 954,127 | 954,127 | 954,127 | 954,127 | 954,127 |

For `affordable`, the prototype is ignored: there is one average affordable home. Both functions throw `RangeError('unknown project kind: <kind>')` for any other `kind`.

### 4.3 Market terms and `ResolvedTerms`

A **market term** is a number about private finance that an instrument's value is measured against. `MARKET_TERMS`:

| Key | Value | Tier | Source and reading |
| --- | --- | --- | --- |
| `constructionRate` | 0.085 | 3 | Terner Center, *Making It Pencil*, December 2023, p. 12, verified: "we have assumed a total interest rate of 8.5 percent for the construction loan and 6 percent for the permanent loan across each prototype" (https://ternercenter.berkeley.edu/wp-content/uploads/2023/12/Making-It-Pencil-December-2023.pdf). California prototypes (East Bay, South Bay, Sacramento, Los Angeles), not San Francisco, and rates of late 2023. No San Francisco or official figure was found: the Controller's feasibility review and its TAC deck give no financing terms (both read in full). |
| `constructionYears` | 1.917 | 2 | The median month by which half of the eventual completions from construction have happened, 23 months, in the fitted construction-stage table of dataset `2026-11-08-d15bdf2d` (`calibration.json`, `transitions.discretionary.construction.advance`, n = 1,274, window 2007-01-01 to 2026-10-19; 23 for streamlined, 21 for permit-only), computed for this spec; 23 ÷ 12 rounded to three decimals. Tier 0 data; reading the stage time as the life of the construction loan is an inference (tier 2). The saving is counted on the average share of the loan that is out, `AVERAGE_DRAWN` (below). |
| `requiredReturn` | 0.06 | 1 | Controller, Triennial 2026, p. 11 row 14, "Untrended Return-on-Cost" 6.00% for every prototype; the February draft's note (c) calls it the "return-on-cost target to derive residual land value" (TAC deck slide 14, which used 5.25%). |
| `guaranteeRateCut` | `Unsourced` | n/a | Reason (exact text): "No source gives the cut in a private construction loan's rate that a public guarantee earns. The evidence search found no evaluation of any public loan guarantee or revolving fund (financing evidence digest, section 7), and no published spread between guaranteed and unguaranteed multifamily construction loans in San Francisco. A guarantee has no sourced grant-equivalent; it can be offered only with a rate cut the user types, labelled custom, not sourced." |
| `lossOnExit` | 1 | 4 | Invented, as the design rules (OD-F8): a funded project that exits after construction began loses the whole amount spent or out. The method records what was found and not used: FDIC net charge-off rates on construction and development loans of 5.40% (2009), 5.45% (2010) and −0.01% (2019), and the public-bank plans' 2.5% loss allowance, are portfolio rates per year, not the loss on one abandoned project. |

Each `Sourced` entry carries a full `Provenance` (tier, label, sources with URLs, method with the page and quoted words, "accessed 2026-11-09").

**The draw schedule (row F8, ruling R11, OD-F12).** A construction loan is drawn as the building rises, so its average balance is below its principal. The partner ruled (R11) that a construction loan is drawn 10% at the start and the rest evenly over the construction period. Two constants in `terms.ts` carry it; they are not market terms (not a `TermKey`, not typed by the user):

| Constant | Value | Tier | Provenance |
| --- | --- | --- | --- |
| `DRAW_UP_FRONT` | 0.10 | 4 | Label "Share of a construction loan drawn at the start". Source: the partner's assumption, R11 (design, "Partner rulings"). Method: "The partner's assumption, R11: 10% of a construction loan is drawn at the start to get building under way, and the rest evenly over the construction period. No source for a draw schedule was found." |
| `AVERAGE_DRAWN` | 0.55 | 4 | Label "Average share of a construction loan that is out". Computed as `DRAW_UP_FRONT.value + (1 − DRAW_UP_FRONT.value) ÷ 2` (the average balance of a draw of 10% up front and 90% at an even rate is 0.10 + 0.90 ÷ 2), not typed as a literal. Method: "The partner's assumption, R11: arithmetic on DRAW_UP_FRONT. A loan's and a guarantee's interest saving is counted on this share of the principal over the construction period. A pool still commits the whole principal at the start." |

Both are `Sourced<number>` with tier 4, so every result that shows a loan's or a guarantee's saving can say the draw schedule is an assumption (global constraint "Evidence hierarchy"). `AVERAGE_DRAWN` changes only the saving: `fundBundle`'s `lent`, `guaranteed` and `reserve` stay the whole principal, because the pool still commits a loan's whole principal at the start (F8, F9 (g)).

`CONSTRUCTION_LOAN_TO_COST` = **0.55**, tier 3: Terner Center, same report, p. 13, verified: "Typically, in California, we found that lenders currently require an approximately 55 percent LTC ratio." It is not read by any F8 formula; `finance-levers` may use it as the starting `costShare` of a loan or guarantee preset.

**`resolveTerms(m = MARKET_TERMS, typed = {})`** returns a new `ResolvedTerms` (row F8). Its callers: `buildSimInput` calls `resolveTerms(MARKET_TERMS)` for the baseline (F9); `applyLevers` calls `resolveTerms(MARKET_TERMS, levers.finance.terms)` with the market terms the user typed (F7, F17). Each key takes `typed[key]` when present, else `m[key].value` (null for `Unsourced`). A typed value replaces a sourced one too: a typed term always wins, and is labelled. `custom` lists the keys taken from `typed`, sorted alphabetically; a key whose typed value equals the sourced value is still listed, because the user typed it. `custom` is what drives the label "custom, not sourced" on every result that reads one of those terms (F7, F8). Keys of `typed` that are not a `TermKey`, and `undefined` values, are ignored. Typed values are range-checked against `TYPED_TERM_RANGES`; a non-finite value or one outside its range throws `RangeError('<key> must be between <lo> and <hi>; got <v>')`. That throw is a programming error: `parseSimLevers` (`finance-levers`, F7) checks `FinanceLevers.terms` against the same exported `TYPED_TERM_RANGES` and rejects the lever first, so a parsed policy never reaches it. The ranges:

| Key | Allowed typed range | Reason |
| --- | --- | --- |
| `constructionRate` | 0 to 0.25 | A rate, not a percent; 25% bounds any construction loan in the FDIC and Terner records. |
| `constructionYears` | 0.25 to 10 | A loan of three months to ten years. |
| `requiredReturn` | 0.01 to 0.25 | The same bounds row F6 sets for a loan's own `requiredReturn`; F8 divides by it (4.4). |
| `guaranteeRateCut` | 0 to 0.05 | A cut of up to five points. |
| `lossOnExit` | 0 to 1 | A share of what was spent. |

These ranges are input bounds, not evidence; they carry no tier.

### 4.4 Grant-equivalents (row F8)

A **grant-equivalent** is the dollars per home a grant would have to pay to be worth the same to the project as the instrument. `grantEquivalentPerHome(inst, kind, p, terms)` takes `terms: MarketTerms | ResolvedTerms`, as row F8 writes it; a `MarketTerms` argument (told apart by the absence of a `custom` field) is resolved with `resolveTerms(terms)` first, and a `ResolvedTerms` argument is read as given. The engine passes the `ResolvedTerms` of `SimInput.finance` (F9). Let `U = uncoveredPerHome(kind, p)`, `C = costPerHome(kind, p)`, and `V` (own value per home) `= C − p.shortfallPerHome` for `market` and `AFFORDABLE.ownPerHome` for `affordable`. Exactly as F8:

- **Grant**: `share × U`.
- **Loan**: `P = costShare × C`; interest saving `P × max(0, constructionRate − rate) × constructionYears × AVERAGE_DRAWN`; plus (with no draw factor, because it is a change in the value the project's income supports, not interest on a balance), when `requiredReturn` is set and below `terms.requiredReturn`, `costShare × V × (terms.requiredReturn ÷ requiredReturn − 1)`. The sum is then **capped at `P`**, as row F8 says ("a loan's grant-equivalent is never more than its principal"): a loan is never worth more to the project than giving it the same money outright. At the market's construction rate, the cap binds for B with `costShare` 1 only when the accepted return is below about 2.65% (`0.06 ÷ (1 + 736,700 ÷ 584,700)`, arithmetic on the tier 1 values above). Tier 2 reasoning.
- **Guarantee**: `costShare × C × guaranteeRateCut × constructionYears × AVERAGE_DRAWN`, with no cap (F8 caps only the loan). Within `TYPED_TERM_RANGES` the factor `guaranteeRateCut × constructionYears × AVERAGE_DRAWN` is at most 0.05 × 10 × 0.55 = 0.275, so a guarantee is worth at most 27.5% of the principal it covers.

The result is rounded once, at the end, with `Math.round` (half up), and returned as `Dollars`. It is never negative.

**Missing terms.** `termsNeeded(inst)`: grant `[]`; loan `['constructionRate', 'constructionYears']`, plus `'requiredReturn'` when `inst.requiredReturn !== null`; guarantee `['constructionYears', 'guaranteeRateCut']`. `missingTerms(inst, terms)` returns those whose resolved value is null, in that order. `grantEquivalentPerHome` and `fundBundle` throw `RangeError('<instrument kind> needs <key>, which is not sourced')` (first missing key) when any is missing. This is a programming error, not a user state: `finance-levers` must not compile a programme for which `missingTerms` is non-empty, and the page must not offer it (F8: "An instrument that needs a null term cannot be compiled or offered; on a typed term it runs labelled 'custom, not sourced'"). With today's `MARKET_TERMS` alone every guarantee is unavailable, because `guaranteeRateCut` is `Unsourced`. Once the user types a rate cut into `FinanceLevers.terms` (F7), `resolveTerms` fills it, `missingTerms` is empty, the guarantee is priced, and `custom` contains `'guaranteeRateCut'`, so every result that reads it is labelled "custom, not sourced". A result "reads" a term when the instrument's `termsNeeded` contains it; the caller labels by intersecting `termsNeeded(inst)` with `terms.custom`.

**`validateInstrument(inst)`** returns the first failing message, or null. Row F6 makes it the one instrument check: an instrument is valid when it accepts it, and every validator calls it (`finance-data`'s `checkProgramme`, `finance-levers`'s parser and presets, the engine's input checks, the page's fields). The bounds below are complete for every field of every instrument kind, and are exported as `INSTRUMENT_BOUNDS` so that a field can show its range; no caller keeps its own. A field that is not a finite number, or an instrument whose `kind` is not `grant`, `loan` or `guarantee`, fails with the message of the first check it fails ("Unknown instrument kind." for the kind). Values are accepted at full precision: no step, no rounding (a preset's share of 0.348251 is valid). `finance-levers` shows these texts and rejects the lever; the arithmetic functions throw `RangeError` with the same text if called on an invalid instrument. `minHomes` (a whole number from 0 to 10,000, F6) is a programme field, not an instrument field; its check belongs to the programme validators.

| Check | Message |
| --- | --- |
| grant `share` finite, `0 < share <= 1` | "A grant pays more than 0% and at most 100% of the uncovered cost." |
| loan or guarantee `costShare` finite, `0 < costShare <= 1` | "A loan or guarantee covers more than 0% and at most 100% of the cost." |
| loan `rate` finite, `0 <= rate <= 0.25` | "A loan's rate is between 0% and 25%." |
| loan `requiredReturn` null, or finite with `0.01 <= requiredReturn <= 0.25` | "The return the lent money accepts is between 1% and 25%." |
| guarantee `reserve` finite, `0 <= reserve <= 1` | "A guarantee's reserve is between 0% and 100% of the loan." |

These bounds are input bounds, not evidence, and carry no tier; the `requiredReturn` bounds are F6's. A `requiredReturn` of 0 is therefore invalid (it would divide by zero); one at or above the market's adds nothing; a loan rate at or above the market's saves no interest. None of these is an error beyond the table.

**Worked values** (the design's own examples, exact, all unit tests):

- A grant of $50,000 a home on B: `share = 50000 / 217000`; grant-equivalent 50,000; `50000 / 736700 = 0.067870…`, "6.8% of cost".
- A loan of 100% of B's cost at the market rate accepting 5.25% in place of 6.00%: `1 × 584,700 × (0.06 / 0.0525 − 1) = 83,528.57…` → **83,529** ("about $84,000 a home", design section 4).
- A loan of 60% of B's cost at 4%, no accepted return: `0.6 × 736,700 × 0.045 × 1.917 × 0.55 = 20,971.97` → **20,972**.

### 4.5 Coverage, certainty, the odds shift and bundles

`coverage(g, kind, p)` = `g ÷ uncoveredPerHome(kind, p)`, unrounded; `oddsShift(g, kind, p, slope)` = `slope × g ÷ costPerHome(kind, p)`, unrounded, as F8. Neither caps: `oddsShift` returns the formula's value even at coverage above 1, and the engine must test certainty first and not use the shift of a certain project. Both throw `RangeError('grant-equivalent must be a finite number of 0 or more; got <g>')` for a negative or non-finite `g`. `oddsShift(0, …)` is 0.

**Certain.** This follows row F8: a project is certain when `isCertain(coverage)`, that is `coverage >= 1 − CERTAIN_TOLERANCE` with `CERTAIN_TOLERANCE = 1e-9`. Shares are stored as fractions (F12 sets each baseline grant's `share` to its source's dollars over $861,525), so a bundle that pays exactly the uncovered cost can sum to 0.9999999999999999 in floating point. The tolerance is numerical, below a thousandth of a dollar a home, not a model number, and carries no tier. Every certainty test in the package uses `isCertain`; F9 (a)'s "certain in a month whose bundle's coverage is at least 1" means `isCertain` of that bundle's coverage.

**Bundles.** This follows row F8, which makes `fundBundle` the one pricing rule (OD-F10). A project's bundle may mix grants, loans and guarantees from several pools (F9 (b)). An item's **tier** is fixed by its pool's kind: `federal` is the federal tier; `state` the state tier; `bank`, `dedicatedTax`, `generalRevenue`, `goBond` and `cop` the City tier. `fundBundle(items, kind, p, terms)`:

1. Every item is validated and its terms checked (throws as above).
2. Let `R = U`, what remains of the uncovered cost. The tiers are priced in the order federal, state, City; a tier with no items is skipped.
3. Within a tier, its loans and guarantees count first, each at its full grant-equivalent (exact, before rounding; a loan's capped at its principal), even where that is more than `R`. They are never reduced: the principal lent or guaranteed is what the programme offers, and it is repaid or released. With `L_t` their sum, accumulated in input order starting from 0, `R` becomes `max(0, R − L_t)`. Then the tier's grants: let `g_j = share_j × U` and `S = Σ g_j` (summed in input order). If `S <= R`, the grants **fit**: each pays `g_j`, the grants' total is `S`, and `R` becomes `R − S`. Otherwise they are **scaled**: with `f = R ÷ S` (computed once), each grant pays `g_j × f`, the grants' total is taken as `R` itself (not the floating-point sum of its grants), and `R` becomes 0, so every later tier's grants pay 0 (its loans and guarantees still count in full).
4. `grantEquivalent` is accumulated tier by tier from 0, adding the tier's `L_t` and then its grants' total as defined in step 3; `coverage` is `grantEquivalent ÷ U`; `certain` is `isCertain(coverage)`. Coverage exceeds 1 only through loans and guarantees.
5. Per item, all exact per-home dollars: for a grant, `grantEquivalent` and `granted` both equal what it pays (`g_j` or `g_j × f`), and `lent`, `guaranteed`, `reserve` are 0; for a loan, `grantEquivalent` is its capped value, `lent` is `costShare × C`, the rest 0; for a guarantee, `grantEquivalent` is its value, `guaranteed` is `costShare × C`, `reserve` is `inst.reserve × guaranteed`, the rest 0.
6. The result's `items` has the input's length, and `items[i]` is the pricing of input `items[i]`. An empty input returns `{ items: [], grantEquivalent: 0, coverage: 0, certain: false }`.

**Floating-point sums.** The rule says a scaled tier "covers exactly what remains". The products `g_j × f` summed in floating point land within a few units in the last place of `R`, not exactly on it. Step 3 therefore takes a scaled tier's total as `R` by definition, so a bundle whose grants bind has `grantEquivalent` equal to `U` up to rounding in the running sums (the earlier tiers' totals and `R` are themselves rounded, so the result can miss `U` by a unit or two in the last place), and `coverage` within the tolerance of 1. Certainty and every comparison of two coverages therefore go through `isCertain` and `CERTAIN_TOLERANCE` (F8), never through an exact test for 1. The items' own amounts then sum to `grantEquivalent` within about 10⁻¹⁰ dollars a home (relative error of order n × 2⁻⁵³), far inside `CERTAIN_TOLERANCE`; `projectDollars` rounds each item to whole dollars anyway. In a tier that fits, the sum of `g_j` can differ from the intended dollars in the last place (the baseline's shares are dollars over $861,525), which is what `isCertain`'s tolerance absorbs. The "fits" test is the exact comparison `S <= R`: when noise puts `S` a hair above `R`, the tier is scaled by `f` within 10⁻¹⁵ of 1, which changes no whole dollar.

Reasons. Without a cap, two grants of 100% would each pay the whole uncovered cost and the public would pay twice for one home. Outside money, loans and guarantees included, counts before the City's because that is the design's stacking: "the City's cost per home falls when state or federal money is present" (section 3). Within the City tier the sources share what is left in proportion, so money added to any City source relieves all of them: each City pool's draw per project falls, the same pools fund more projects, and added City money buys homes wherever a City pool binds. A fixed order among City kinds would not: an added `generalRevenue` grant would pay before the baseline's `goBond` programme and only displace bond money that is then never spent, while the earlier City pools still bind (found by `finance-levers`; row F8). Loans and guarantees count inside their own pool's tier for the same reason: if every loan counted before every grant, an added City loan on a project the baseline already covers would shrink the uncapped federal grant, which relieves nothing because that pool never binds, while the City pool commits the whole principal (F9 (g)); counted in the City tier, it relieves the City's own grants instead. The tier rule is tier 2 reasoning, now row text (F8, OD-F10, ruled by R12), and stated in `docs/dev/finance-model.md`.

**Worked bundles** (affordable, `U` = 861,525; all unit tests):

- **The baseline alone** (federal `443108/861525`, state `118390/861525`, City `300027/861525`): every tier fits; the grants pay 443,108, 118,390 and 300,027 (to within 10⁻⁶ dollars); nothing is scaled; coverage is 1 within the tolerance.
- **An added City loan** of 60% of the affordable cost at 4%, no accepted return, stacked on the baseline: worth `0.6 × 954,127 × 0.045 × 1.917 × 0.55` = 27,161.56 a home. Federal and state pay in full (443,108 and 118,390; the federal grant is not touched). In the City tier the loan counts first, leaving `R` = 272,865.44 against the City grant's 300,027, so `f` = 0.909470: the City grant pays 272,865.44, the City saves 27,161.56 of grant a home, and coverage is 1 within the tolerance. `lent` is 572,476.2, the whole principal.
- **An added City grant of the City's whole share** (`300027/861525`) stacked on the baseline: after federal and state, `R` = 300,027 and the City tier's `S` = 600,054, so `f` = 0.5: the baseline City grant and the added one each pay 150,013.5, half their shares. Coverage is 1 within the tolerance.
- **An added federal grant of `100000/861525`** on a baseline whose City money is split between two City grants (fixture: `dedicatedTax` `150000/861525` and `goBond` `150027/861525`, a test split, not data): the federal tier pays 543,108, state 118,390, `R` = 200,027 against the City tier's `S` = 300,027, so `f` = 200,027 ÷ 300,027 = 0.66669666…: the City grants pay 100,004.4996 and 100,022.5004, each scaled by the same fraction, 200,027 in all.

**How the other subsystems call it.** Two callers price more than one bundle per project, and the contract above is written for them:

- **The engine's award loop** (F9 (c)) prices the whole bundle, leaves out the programmes whose pools cannot pay their part, and prices the rest again, repeatedly, until every pool left can pay. It may therefore call `fundBundle` on any subset of a month's bundle. A pool's part for item `i` is `projectDollars(granted + lent + reserve, homes)` of `items[i]` (F9 (f), (g)); which of those the pool commits, spends or holds is the engine's. Three properties hold and are tested, so the loop needs no defensive code: (i) the result depends only on which items are present, not on what was left out nor on input order; (ii) leaving an item out never lowers any remaining grant's `granted` (in its own tier `S` falls, so `f` rises or the grants now fit; later tiers see a larger `R`; leaving out a loan raises `R` in its tier and every later one); (iii) a subset's `grantEquivalent` is never above the whole bundle's: adding a grant or a loan of `Δ` to a tier raises that tier's total by `Δ` less any part it takes from that tier's or later tiers' grants, and what it takes is never more than `Δ`, so the total never falls. So "coverage, counted up to 1, not below the whole bundle's" (F9 (c)) holds when the programmes left out were not needed, and the loop ends, because each round removes at least one item. Where the whole bundle and a subset both bind, both totals equal `U` within the tolerance; F9 (b) and (c) compare every pair of coverages with `CERTAIN_TOLERANCE`, as row F8 says.
- **`finance-score`'s tier weights** (F13) call `fundBundle` once per completed funded affordable schedule, on the instruments of `funding.programmes` with the prototype `prototypeFor` gives for the schedule's start size, and weight each programme's `tiers` by `items[i].grantEquivalent`. Because the inputs are those of the award, the weights are the dollars the award priced. A weight can be 0: a loan at or above the market rate with no accepted return is worth nothing (4.4), yet lends, so it is among the programmes that pay; and all weights can be 0 when only such loans pay. How `tiersOf` treats a zero total is `finance-score`'s (F13). Under the tier rule, City programmes that share a scaled tier are weighted in proportion to their shares.

**`projectDollars(perHome, homes)`** = `Math.round(perHome × homes)`: the one place exact per-home amounts become whole project `Dollars` (F10's `granted`, `lent`, `guaranteed`, and every pool debit). Per-home amounts are never rounded before multiplying.

**Cost and memoising.** Every function in 4.2 to 4.5 is pure in its arguments (it reads no clock, no global state and no random draw) and never mutates them, allocation-free except `fundBundle`'s result, and O(1) except `fundBundle`, which is O(n): one pass to sum each tier's `L_t` and `S`, one to price; n is at most 24 added programmes plus the baseline's. A call on the largest bundle allowed is a few microseconds, so the award loop's at most n calls per application are cheap. Callers may memoise: an item's pricing depends only on the set of items present (kind, prototype id and terms fixed), not on their order, so a key of the sorted programme ids with the kind and prototype id is sound within one `SimInput` (whose terms do not change); the result's `items` must still be returned in the caller's input order. The only order effect is in the last place: `S` is summed in input order, so two orders of the same items can differ by a unit in the last place, which changes no whole dollar. A programme's own grant-equivalent depends only on (instrument, kind, prototype id, terms), so a table of at most 2 kinds × 5 prototypes per programme can also be built once per `SimInput`. `prototypeFor` is two comparisons. Whether to memoise is internal to each caller; the F18 budgets (30 ms and 45 ms for `simulateNet`) are `finance-engine`'s to meet.

### 4.6 Income tiers and the inclusionary table

**`AMI_TIER_BOUNDS`** = `{ veryLow: 0.5, low: 0.8, moderate: 1.2 }`, tier 1, and `tierOfAmi(s)`: `s <= 0.5` very low; `<= 0.8` low; `<= 1.2` moderate; above, above moderate. Throws `RangeError` for a non-finite or negative `s`. Sources: HCD, *2026 State Income Limits Briefing Materials* (https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/income-limits-2026.pdf), pp. 2–4, verified: the very low-income limit "typically reflects 50 percent of median family income", the low-income limit "80 percent", and HCD "sets the maximum moderate-income limit to equal 120 percent" of area median income, under Health and Safety Code section 50093. The RHNA tiers in the Budget Analyst's Exhibit D (p. 5, verified) are labelled "< 50% AMI", "50-<80% AMI", "80-120% AMI", ">120% AMI". The two disagree only at exactly 80%; this spec follows HCD (80% is low income) because the RHNA categories are defined by the state's income limits. Mapping San Francisco's programme percentages (which use MOHCD's area median income) onto the state categories by percentage is a tier 2 inference, stated in the method.

**`INCLUSIONARY`**, tier 1: Controller, Triennial 2026, p. 7 (rental) and p. 8 (ownership), "2023 Ordinance (Post Reduction)" on-site column, verified; Budget Analyst Exhibit J, p. 11, verified, gives the same rental totals for "Future Projects" (15% and 18%, effective November 1, 2026). Stored as integer basis points to keep the arithmetic exact:

| Tenure | Homes | Area median income → tier | Basis points |
| --- | --- | --- | --- |
| rental | 10 to 24 | 55% → low | 1,500 |
| rental | 25 or more | 55% → low; 80% → low; 110% → moderate | 1,000; 400; 400 |
| ownership | 10 to 24 | 80% → low | 1,500 |
| ownership | 25 or more | 80% → low; 105% → moderate; 130% → above moderate | 1,000; 500; 500 |

So a private rental project of 25 or more homes owes 14% low-income and 4% moderate-income homes, and never very low (55% of area median income is above the 50% line).

The table holds the rates in force on November 1, 2026 for the whole run. Exhibit J's note says the 25-or-more rental rate rises "0.5 percent each year starting Jan 1, 2028, until reaching a cap of 24 percent"; no verified source splits the rise between income tiers, and the prototypes' shortfalls were computed at the November 2026 rate, so applying the rise would count homes the feasibility arithmetic did not pay for. The method states that the scheduled rise is not applied (open question 3).

**`ASSUMED_TENURE`** = `'rental'`, tier 2: the simulation does not know a project's tenure; the Controller's apartment prototypes are the ones used for the shortfall (4.2), so the same tenure is used for the homes it must provide.

**`inclusionaryUnits(homes, tenure = 'rental')`** returns on-site homes by `IncomeTier` for a private project of `homes` homes (integer 0 or more, else `RangeError`). Fewer than 10 homes: all zeros. Otherwise, with the band's total basis points `b`, the total is `floor((homes × b + 5000) ÷ 10000)` (fractions of one half or more round up; the Planning Code's section 415.6 is reported to state this rule, but its current text was not read, so `INCLUSIONARY`'s provenance labels the rounding rule tier 4, an assumption, while the rates stay tier 1), and it is split across income tiers (the band's basis points summed per tier first) by largest remainder of `homes × bp ÷ 10000`, ties to the lower-income tier. Examples (tests): 130 homes rental → total 23 (23.4), low 18, moderate 5; 13 homes → low 2 (1.95); 25 homes → 5 (4.5 rounds up): low 4 (3.5), moderate 1 (1.0); 9 homes → zeros. The signature is row F13's exactly, `inclusionaryUnits(homes: number, tenure?: Tenure): Record<IncomeTier, number>`; an omitted `tenure` means `ASSUMED_TENURE.value`, `'rental'`. `finance-score`'s `tiersOf` reads `INCLUSIONARY` only through this function, for "any other simulated project of 10 homes or more" (F13), and counts the remaining homes as above moderate; it keeps no rate table of its own.

### 4.7 Displacement range

**`DISPLACEMENT_RANGE`** = `{ low: 0.115, high: 0.8 }`, tier 3, shown beside the run's displaced homes (F14). Both verified:

- Low: Ferreira, Meyer and Turner, "The Effect of LIHTC on Housing Markets", NBER Summer Institute slides, 2026-07-29 (https://conference.nber.org/conf_papers/f240610/f240610.slides.pdf), slide 17: "89 LIHTC units allocated ⇒ 87 placed-in-service ⇒ 77 ACS multi-family units … 1 − 77/87 = 11.5% crowd-out, CI95[−6%, 28%]". Local: the block group.
- High: Soltas, "Tax Incentives and the Supply of Low-Income Housing", working paper dated May 11, 2024 (https://economics.sas.upenn.edu/system/files/2024-08/Empirical%20Micro%2010312024.pdf), p. 4: "For every ten LIHTC units, I find about eight units displace private housing that would have otherwise been built within ten years"; Table 5 (p. 39) gives the model's displacement rate as 0.777 (standard error 0.018). Soltas counts later tax-credit projects on a losing site as displacement (Ferreira, Meyer and Turner, slide 8).

The method states: national studies; neither measured San Francisco or any supply-constrained coastal market; no San Francisco estimate exists.

### 4.8 Debt service and the legal limits

**`debtService(principal, { rate, termYears })`**, with row F14's signature exactly, `debtService(principal: Dollars, debt: { rate: number; termYears: number }): { annual: Dollars; total: Dollars }` (the `debt` argument is a pool's non-null `Pool['debt']`, F5): level annual payment `annual = principal × rate ÷ (1 − (1 + rate)^−termYears)`; `total = annual × termYears`. Both rounded once with `Math.round` from the exact annual value. Nominal dollars (labelled so by `finance-score`, F14 `nominal: true`). Throws `RangeError` unless `principal` is finite and `>= 0` and `debt` passes `validateDebt`, whose bounds are row F5's: `rate` above 0 and at most 0.25, `termYears` a whole number from 1 to 40 (`DEBT_BOUNDS`). `validateDebt` returns "A borrowing rate is above 0% and at most 25%." or "A borrowing term is a whole number of years from 1 to 40.", or null; `finance-data`'s `checkPool` and `finance-levers`'s parser call it for every non-null `Pool.debt`, so a pool that passes them never makes `debtService` throw. Check against the source (tests): $410,442,573 at 6% over 20 years gives 35,784,254 a year and 715,685,078 in all (Budget Analyst Exhibit 40, p. 106, verified, to the dollar); $1,668,752,923 at 6.5% over 20 years gives 151,450,000 a year (Exhibit 42, p. 108, verified). The design's "$1.74 repaid per $1" is `715,685,078 ÷ 410,442,573`.

**`DEBT_LIMITS`** (all Budget Analyst, 2026-06-05, verified on the pages given; tier 1 unless marked):

| Constant | Value | Page and words |
| --- | --- | --- |
| `goPolicyRate` | 0.1201 (% of assessed value) | p. 104: "it is City policy to keep property taxes at or below their 2006 level. This amounts to 0.1201 percent of assessed value" |
| `goRateToday` | 0.1105 | p. 104: "The FY 2025-26 property tax rate to repay G.O. bonds is 0.1105 percent" |
| `goPolicyReachedFy` | "FY 2031-32" | p. 104: the City "will approach the 2006 property tax rate in approximately FY 2031-32"; Exhibit 39, p. 105, shows the planned programme at the line that year |
| `goRatePerAnnualDollar` | 0.01 ÷ 35,784,254 (points of rate per dollar a year) | Exhibit 40, p. 106: 0.01% of added rate supports $35,784,254 of annual debt service |
| `goCapShare` | 0.03 | p. 104: "The City Charter limits the total Citywide bond debt to three percent of the City's net assessed value" |
| `assessedValue` | 353,600,000,000 | p. 104, FY 2025-26, "approximately $353.6 billion" |
| `goOutstanding` | 2,670,000,000 | p. 104: outstanding "(including anticipated issuances) was approximately $2.67 billion" at December 2025 |
| `copCapShare` | 0.0325 | p. 107: "the annual debt service paid on COPs may not exceed 3.25 percent of General Fund aggregate discretionary revenue"; codified in Administrative Code section 10.62(b)(3) |
| `discretionaryRevenue` | 4,660,000,000 | Exhibit 42, p. 108, FY 2025-26 |
| `copReachedFy` | "FY 2028-29" | pp. 105, 107: COPs "reach its debt capacity constraint in approximately FY 2028-29" |
| `goVote` | two thirds | San Francisco Board of Supervisors Resolution 562-24 (https://sfbos.org/sites/default/files/r0562-24.pdf), p. 2, verified: "the requisite two-thirds of all voters voting on the proposition approved" the 2024 affordable-housing bond. The constitutional text (California Constitution article XVI, section 18) returned 403 and was not read. |

The Charter limit is `goCapShare × assessedValue` = 10,608,000,000. The report's own sentence that $2.67 billion is "approximately $8.07 billion below the $10.6 billion Charter limit" (p. 104) does not match its numbers (10.608 − 2.67 = 7.938); this spec uses the arithmetic and notes the discrepancy in the provenance.

**`limitStatements(borrowing)`.** This follows row F14: the statements are computed from the borrowing the policy adds, not from the run's outcomes. `borrowing` is that borrowing, one entry per pool of kind `goBond` or `cop`: each `goBond` or `cop` pool the user added, with `principal` the sum of its inflows that arrive in the run's window, and each scaled baseline debt pool, with `principal` what it receives above its unscaled amount (an entry is left out when that is 0 or less). `finance-score` builds the list (F14); this function measures what it is given and reads nothing else, so a default policy, which adds no borrowing, gives `[]` even when a baseline pool is of kind `goBond`. Each `principal` is constant dollars, as the inflows are. Let `G` be the sum of `goBond` principals, `Ag` the sum of their `debtService(…).annual`, `Ac` the same for `cop`. Statements are returned in the order `goRate`, `goCap`, `goVote`, `copCap`; the three `go*` statements only when `G > 0`, `copCap` only when `Ac > 0`. An empty input returns `[]`.

Number formats (fixed, no locale lookup): money below $1 billion as "$X million" with one decimal ("$26.2 million"), from $1 billion as "$X billion" with two decimals ("$10.61 billion"); a tax rate in percent with four decimals ("0.0073%"); dollars per $100,000 of assessed value with two decimals ("$7.31"); a share of revenue in percent with two decimals ("0.19%").

| `id` | `exceeded` when | `text` |
| --- | --- | --- |
| `goRate` | always (whenever present) | "Repaying {G} of general-obligation bonds takes {Ag} a year, about {Ag × goRatePerAnnualDollar}% on the property tax rate ({per100k} per $100,000 of assessed value). City policy keeps the bond tax rate at or below its 2006 level, 0.1201%. It is 0.1105% in FY 2025-26, and bonds already planned reach 0.1201% about FY 2031-32, so this borrowing needs that policy changed." |
| `goCap` | `goOutstanding + G > 10,608,000,000` | "General-obligation debt would reach {goOutstanding + G}: $2.67 billion outstanding or planned (December 2025) plus {G} in this run. The Charter caps it at 3% of assessed value, about $10.61 billion (FY 2025-26). " then "This is over the cap." or "This is within the cap." |
| `goVote` | always (whenever present) | "City general-obligation bonds need a two-thirds vote of the people voting on them. This run assumes {G} of new bonds that no vote has approved." |
| `copCap` | always (whenever present) | "Certificates of participation in this run take {Ac} a year, {Ac ÷ 4.66 billion}% of General Fund discretionary revenue ($4.66 billion, FY 2025-26). City policy caps their debt service at 3.25% ($151.45 million a year), which certificates already planned reach about FY 2028-29, so this borrowing needs Administrative Code section 10.62(b)(3) changed." |

`exceeded` means "this borrowing needs a policy change, a vote, or a Charter change that the run assumes". It is always true for `goRate` and `copCap` because the source shows the existing programmes using the whole headroom by FY 2031-32 and FY 2028-29 (Exhibits 39 and 41, pp. 105 and 107, verified); reading that as no headroom for added debt is a tier 2 inference, stated in each provenance. `goCap` is conservative: it ignores amortisation of both existing and new debt, so it may report "over" a few years early; the provenance says so. Each statement's `provenance` cites the pages above; `goRate` and `goCap` are tier 2 (arithmetic on tier 1 values), `goVote` tier 1, `copCap` tier 2. Nothing is enforced (OD-F6).

What the source gives and this spec leaves out: the costs of issuing COPs, "15 to 20 percent … closer to 25 percent for a smaller COPs issuance" (p. 108). Not modelled (open question 2).

### 4.9 Rounding summary

Every `Dollars` result is rounded once, at the end, with `Math.round`: `grantEquivalentPerHome`, `projectDollars`, `debtService`. Exact (unrounded) numbers: `fundBundle`'s per-home amounts, `coverage`, `oddsShift`, and the `ResolvedTerms`. Constants are stored as published (whole dollars; rates as fractions; `constructionYears` to three decimals; inclusionary rates in basis points).

### 4.10 The dataset version

This follows the global constraint "The engine is in the dataset version". `src/lib/sim/finance/` shapes published data once the pipeline imports it (the slope, F2; the `/lesscars` build with the baseline funding). This branch does not add it to `PATHS` in `pipeline/lib/version.ts:40-50`; `market-baseline`, the first subsystem whose pipeline code imports it, adds it. This branch creates `src/lib/sim/finance/` and edits `src/lib/sim-page/timing-sources.ts`, both outside the hashed paths today, so on its own it changes no dataset version. It merges into the Release 1 integration branch when its tests pass, with no dataset upload and no signoff of its own; the release branch builds and uploads the dataset and runs signoff once (design, "How a release is built"). Once `market-baseline` has added the path, any later change here is a dataset change, made at its release, on the release branch. It does not edit `src/lib/timelapse/types.ts`: the declarations of `TermKey` and `ResolvedTerms` there are step 0's change, and the version change that file's hash brings is step 0's (the paths are hashed by content, `pipeline/lib/version.ts:85-107`).

## 5. Seams

- **Market scenarios and a market control (R7).** Terms are not dated and this spec adds no scenario. It keeps the seam open in one way only: every function takes its terms and its prototype as arguments, and `resolveTerms` accepts typed values, so a later package can pass terms per scenario (for example a different construction rate in a contraction) without changing a function.
- **The pipeline and drop-out (R1, R8).** No function here reads a project's stage or touches drop-out. `prototypeFor` and `uncoveredPerHome` work for any stories and homes, so a later package that reaches pipeline projects needs nothing new from this module. `lossOnExit` is a term, so a sourced loss can replace the tier 4 value without an interface change.
- **A rent model (R4).** Prototypes are data, and every function reads `p.costPerHome` and `p.shortfallPerHome` rather than a table by id; a later rent model can supply prototypes with computed shortfalls. Nothing else is done now.

## 6. Testing

All in the Vitest **server** project (`src/**/*.{test,spec}.ts`, `vite.config.ts:46-53`), colocated, each test calling `expect` (`expect.requireAssertions`). No client, e2e, pipeline or accessibility tests: this subsystem has no page and no pipeline code. Fixtures: `src/lib/sim/finance/test/fixtures.ts` exports `B = PROTOTYPES[1]`, `TERMS = resolveTerms()`, `TERMS_CUT = resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01 })` (a typed rate cut, standing in for a user's), `SLOPE_FIXTURE = 1.75` (the design's "about 1.75", section 2 and OD-F11, standing in for `market-baseline`'s computed `slope.perCostShare`; a fixture value, tier 4 as a test input), and `BASELINE_BUNDLE` (federal grant `443108/861525`, state grant `118390/861525`, City `generalRevenue` grant `300027/861525`, all `affordable`, in that input order), and `BASELINE_SPLIT` (the same, with the City grant split into `dedicatedTax` `150000/861525` and `goBond` `150027/861525`, a test split, not data).

`prototypes.spec.ts`

- The five prototypes' values equal section 4.2's table; `PROTOTYPES` and each entry are frozen; every provenance has tier 1 and names p. 4 and p. 11; `PROTOTYPE_BINNING.provenance.tier` is 4.
- `prototypeFor`: (5, 45) A; (6, 25) A; (0, 25) A; (7, 25) B; (10, 100) B; (11, 100) C; (18, 300) C; (19, 300) D; (40, 24) E; (0, 0) E; (1, 1) E; `prototypeFor(8, 130) === PROTOTYPES[1]`; NaN and Infinity throw the 4.2 message.
- `uncoveredPerHome` and `costPerHome` equal the 4.2 table for every prototype and both kinds; every uncovered cost is positive; an unknown kind throws.

`terms.spec.ts`

- `MARKET_TERMS` values and tiers equal 4.3; `guaranteeRateCut` is `Unsourced` with the exact reason; `lossOnExit.provenance.tier` is 4.
- `DRAW_UP_FRONT.value` is 0.1 and `AVERAGE_DRAWN.value` is 0.55 (to 12 places), both with tier 4 and a method containing "the partner's assumption, R11".
- `resolveTerms()` gives `guaranteeRateCut: null`, `custom: []`; `TERMS_CUT` gives 0.01 and `custom: ['guaranteeRateCut']`; a typed `constructionRate` of 0.07 replaces the sourced 0.085 and is listed in `custom`; two typed keys are listed alphabetically; an unknown key is ignored; each `TYPED_TERM_RANGES` bound is accepted, and just outside it, and NaN, throw the 4.3 message.

`instruments.spec.ts`

- Worked values of 4.4: grant $50,000 on B → 50,000 and cost share rounding to 0.068; return 6.00% → 5.25% on B at the market rate → 83,529 (no draw factor); loan 60% at 4% on B → 20,972.
- `grantEquivalentPerHome` gives the same result for `MARKET_TERMS` and for `resolveTerms(MARKET_TERMS)` on a grant and a loan.
- `oddsShift(50000, 'market', B, SLOPE_FIXTURE)` is 0.1187729 (to 7 places) and `Math.exp` of it is 1.1261 (to 4), "about 12%" (design section 2).
- Edges: loan rate above market and accepted return above market → 0; accepted return of 0.02 with `costShare` 1 at the market rate on B → capped at 736,700; guarantee with `TERMS` throws "guarantee needs guaranteeRateCut, which is not sourced"; with `TERMS_CUT`, 60% of B → `round(0.6 × 736700 × 0.01 × 1.917 × 0.55)` = 4,660; affordable loan uses `V = 92,602`.
- `termsNeeded` and `missingTerms` for each instrument (a guarantee's `missingTerms` is `['guaranteeRateCut']` under `TERMS` and `[]` under `TERMS_CUT`); `validateInstrument` returns each 4.4 message for its failing case (both sides of every bound, NaN, and an unknown kind) and null for a valid one, including a share of 0.348251; `INSTRUMENT_BOUNDS` equals the 4.4 table.
- `coverage` and `oddsShift` throw for −1 and NaN; `oddsShift(0, …)` is 0.
- `isCertain(1 − 1e-12)` true, `isCertain(0.999)` false; `CERTAIN_TOLERANCE` is 1e-9.
- `fundBundle(BASELINE_BUNDLE, 'affordable', B, TERMS)` (the baseline alone): every tier fits and nothing is scaled; each grant's `granted` is within 1e-6 of `share × U`, giving 443,108 / 118,390 / 300,027 after `projectDollars(…, 1)`; coverage within 1e-12 of 1; `certain` true; each item's `grantEquivalent` equals its `granted`.
- `fundBundle([], …)` is `{ items: [], grantEquivalent: 0, coverage: 0, certain: false }`.
- An added City grant of the City's whole share (`300027/861525`, kind `goBond`) stacked on `BASELINE_BUNDLE`: the baseline City grant and the added one each pay 150,013.5 (to 1e-6), half their shares; `certain` true (coverage within `CERTAIN_TOLERANCE` of 1).
- An added federal grant of `100000/861525` on `BASELINE_SPLIT`: federal pays 543,108 in all, state 118,390; the two City grants pay 100,004.4996 and 100,022.5004 (to 1e-4), both `share × U × 200027 ÷ 300027`, the same fraction; `certain` true.
- An added City loan (60% of the affordable cost at 4%, kind `generalRevenue`) on `BASELINE_BUNDLE`: federal and state `granted` unchanged (443,108 and 118,390); the City grant pays 272,865.44 (to 1e-2); `certain` true; `lent` 572,476.2.
- Tiers: a federal grant of 1 alone pays 861,525 and leaves every state and City grant at 0; two `goBond` grants of 1 each pay 430,762.5; a City loan plus a City grant of 1 on B → the grant pays `217,000 − loan grant-equivalent`; a City loan worth more than what the federal and state grants leave still counts in full, and the City grants pay 0; grants given in the order `cop`, `state`, `federal` fill federal, then state, then City, and `items[i]` still matches input `i`.
- Floating point: a City tier of three grants with shares 0.1, 0.2 and 0.7 on top of a federal grant of 1/3 (so the City tier is scaled by an `f` that is not a short binary fraction): `certain` true, `coverage` within `CERTAIN_TOLERANCE` of 1, and the items' `granted` sum to `U` within 1e-6. A randomised check (10,000 seeded draws of a federal share, a state share and an oversubscribed City tier) asserts `isCertain` on every bundle whose grants bind, never `coverage === 1`.
- A loan item's `lent` is `costShare × C` (the whole principal, not multiplied by `AVERAGE_DRAWN`); a guarantee item's `guaranteed` is `costShare × C` and `reserve` is `inst.reserve × guaranteed`.
- Subsets (the award loop, F9 (c)), on a fixture bundle of a `federal` loan of 60% at 4% (worth 20,971.970415 a home unrounded, which `grantEquivalentPerHome` returns as 20,972), a federal grant of 0.5, a `generalRevenue` grant of 0.5 and a `goBond` grant of 0.5 on B (`fundBundle` works on unrounded amounts, so after the loan and the federal grant 217,000 − 20,971.970415 − 108,500 = 87,528.029585 remains, and the two City grants each pay half of it, 43,764.0147925; amended 2026-11-10, the first version gave these as 87,528 and 43,764): for every one of its 16 subsets, (i) the result equals that of a fresh call on the same subset (no hidden state); (ii) every remaining grant's `granted` is at least its `granted` in the whole bundle; (iii) `grantEquivalent` is at most the whole bundle's plus 1e-9. Leaving out the `generalRevenue` grant, the `goBond` grant pays 87,528.029585 and `isCertain(coverage)` stays true.
- Order: every permutation of that four-item bundle gives each item the same `granted` within 1e-9 (the memoising key may sort the ids), with `items[i]` matching input `i`.
- `projectDollars(300027 / 1, 130)` is 39,003,510; `projectDollars(0.5, 1)` is 1.

`tiers.spec.ts`

- `tierOfAmi`: 0.5 very low; 0.55 low; 0.8 low; 0.81 moderate; 1.1 moderate; 1.2 moderate; 1.3 above moderate; −0.1 throws.
- `INCLUSIONARY` equals 4.6's table; `ASSUMED_TENURE.value` is 'rental' with tier 2.
- `inclusionaryUnits`: 9 → zeros; 13 → low 2; 25 → low 4, moderate 1; 130 → low 18, moderate 5; `inclusionaryUnits(130)` equals `inclusionaryUnits(130, 'rental')`; ownership 130 → low 13, moderate 7, above moderate 6 (13 + 6.5 + 6.5 = 26: tie between moderate and above moderate goes to moderate); 1.5 throws.
- `DISPLACEMENT_RANGE` is { 0.115, 0.8 }, tier 3, both URLs present.

`debt.spec.ts`

- Exhibit 40 and 42 checks of 4.8, to the dollar; `validateDebt` accepts rate 0.25 and terms 1 and 40, and returns its messages for rate 0, rate 0.2501, term 0, term 41 and term 20.5; `debtService` throws for each of those and for a negative principal.
- `limitStatements([])` is `[]`; one $300M `goBond` at 6% over 20 years → three statements in order, `goRate` text contains "$26.2 million a year", "0.0073%" and "$7.31", `goCap` "within the cap", `goVote.exceeded` true, all `exceeded` as 4.8; $8,000M of `goBond` → `goCap` "over the cap" and `exceeded` true; one $100M `cop` at 6.5% → only `copCap`, text contains "$9.1 million a year" and "0.19%".

`imports.spec.ts`

- Every file under `src/lib/sim/finance/` imports only by relative path and nothing from `src/lib/sim-page/`, `$lib`, `svelte`, `zod` or the DOM (reads the files and checks their import lines).

`timing-sources.spec.ts` (existing) keeps passing unchanged, proving the re-export.

**Goldens and fixtures.** This branch changes none: it adds no engine or pipeline behaviour, and its own tests have no golden. Its values reach goldens through other subsystems, regenerated at the release, on the release branch, by their documented commands: at Release 1, `market-baseline`'s slope reads `PROTOTYPES` and `uncoveredPerHome`, so the pipeline fixture goldens (the calibration's `market`) and, through them, `fixture-0` and the lesscars fixture goldens move; at Release 2, the engine's funded starts price bundles with `fundBundle`, `oddsShift` and `isCertain`, so the same goldens move again. `golden-seed1.json` and `model-golden.json` never move (no market model, no funding), consistent with "Goldens change only at the two releases". `AVERAGE_DRAWN` reaches published numbers only through the engine's baseline run, which `finance-engine` regenerates at Release 2; the baseline has no loan or guarantee programme (F12), so it does not move them there either.

## 7. Acceptance criteria

1. `src/lib/sim/finance/` exists, imports only by relative path, and imports nothing from `src/lib/sim-page/`, `$lib`, `svelte`, `zod` or the DOM (`imports.spec.ts`). (F4; global "Worker-safe".)
2. `PROTOTYPES` is exported, and the prototype values, `LAND_PER_HOME`, `AFFORDABLE`, `uncoveredPerHome` and `costPerHome` equal 4.2; `prototypeFor` follows F4's bins. (F4.)
3. `Sourced`, `Unsourced` and `Evidence` are declared in `src/lib/sim/finance/evidence.ts`, `timing-sources.ts` re-exports them, and its importers are unchanged. (F4.)
4. `TermKey` and `ResolvedTerms` are imported from `src/lib/timelapse/types.ts` (declared by step 0 with section 2's shape) and re-exported by `terms.ts`; this branch declares neither. (F8.)
5. `grantEquivalentPerHome` takes `MarketTerms | ResolvedTerms` and follows F8's formulas, with `AVERAGE_DRAWN` on the loan's interest saving and on the guarantee and not on the `requiredReturn` part, the loan's cap at its principal, and the rounding of 4.4; it reproduces 83,529, 20,972 and 4,660; `coverage` and `oddsShift` reproduce the 6.8% and "about 12%" examples. (F8; R11; design sections 2 and 4.)
6. `DRAW_UP_FRONT` is 0.10 and `AVERAGE_DRAWN` is `DRAW_UP_FRONT + (1 − DRAW_UP_FRONT) ÷ 2` = 0.55, both `Sourced` with tier 4 and the provenance "the partner's assumption, R11"; a loan's `lent` stays its whole principal. (F8; R11; OD-F12.)
7. Every constant is `Sourced` with a complete `Provenance` or `Unsourced` with a reason; no tier 3 or 4 value lacks a provenance naming its tier. (Global "Evidence hierarchy".)
8. A guarantee cannot be priced on `MARKET_TERMS` alone: `missingTerms` reports `guaranteeRateCut`, and pricing it throws. On a typed rate cut it is priced and `custom` names `guaranteeRateCut`. (F7 `terms`; F8.)
9. `resolveTerms` lets a typed term replace any term, lists typed keys in `custom`, and rejects values outside `TYPED_TERM_RANGES`, whose `requiredReturn` bounds are F6's 0.01 to 0.25. (F6, F7, F8, F17.)
10. `lossOnExit` is 1 with tier 4. (OD-F8.)
11. `fundBundle` has F8's signature and prices by tier (federal, state, City): within a tier, loans and guarantees count first at full value, then the tier's grants each pay their share when they fit and the same fraction of it otherwise, so scaled grants cover what remains (a binding bundle is certain by `isCertain`, never by an exact test for 1); sums are accumulated in the order 4.5 fixes; an added City loan relieves the City's grants, not the federal one; it returns `items[i]` for input `i`, gives the same pricing in any input order, and on any subset satisfies the three properties of 4.5; the baseline bundle is certain by `isCertain` with tolerance 10⁻⁹, and an added City grant halves or scales every City grant alike (4.5 worked bundles). (F8; F9 (c); F13; OD-F10; R2, R9.)
12. `INCLUSIONARY`, `inclusionaryUnits` (with F13's signature) and `tierOfAmi` follow 4.6. (F13; design section 5.)
13. `DISPLACEMENT_RANGE` is 0.115 to 0.8, tier 3, with both sources. (F14.)
14. `debtService` has F14's signature and reproduces Exhibits 40 and 42 to the dollar; `limitStatements` measures only the borrowing it is given, returns the 4.8 texts and `exceeded` values (`goVote.exceeded` always true), and enforces nothing. (F14; OD-F6; design section 6.)
15. This branch changes no hashed path and no golden or fixture, and has no dataset upload or signoff of its own: it merges into the Release 1 branch. (Global "The engine is in the dataset version", "Goldens change only at the two releases"; design "How a release is built".)

## 8. Developer documentation

Write `docs/dev/finance-model.md`, and add to `CLAUDE.md`'s "Scoped reference docs" list: "**Finance model (prototypes, market terms, grant-equivalents, bundles, income tiers, debt and legal limits)** — [docs/dev/finance-model.md](docs/dev/finance-model.md)". The doc must say:

- What the module is for, that it is pure and relative-import only, and that the pipeline imports it by path (hashed once `market-baseline` adds the path, 4.10).
- Where the shared types live: `Sourced`, `Unsourced`, `Evidence` in `evidence.ts`; `TermKey` and `ResolvedTerms` in `src/lib/timelapse/types.ts`, re-exported by `terms.ts`.
- Each exported function with its formula, rounding and errors (4.2 to 4.8). For `grantEquivalentPerHome`, the draw schedule: the loan's interest saving and the guarantee's saving are counted on `AVERAGE_DRAWN` (0.55) of the principal, the partner's assumption (R11, tier 4), while the pool commits the whole principal.
- `fundBundle`'s tier rule with its reason (why loans and guarantees count inside their own tier, and why City sources share pro rata rather than fill in a fixed order), the floating-point definition of a scaled tier's total, the four worked bundles, and its contract for callers: any subset, `items[i]` for input `i`, independence from input order, the three subset properties, the memoising key, and the two callers (the engine's award loop, `finance-score`'s tier weights).
- How a typed market term works: `FinanceLevers.terms`, `TYPED_TERM_RANGES`, `custom`, and the label "custom, not sourced".
- The "Evidence" table: every constant, its value, tier, source with URL and page, and status, in the format of `docs/dev/sim-timers.md` "Evidence". At least: prototypes A to E (tier 1, Triennial pp. 4, 11), `PROTOTYPE_BINNING` (4), `LAND_PER_HOME` 65,000 (2, p. 3), `AFFORDABLE` (1, BLA p. 7), `constructionRate` 0.085 (3, Terner p. 12), `constructionYears` 1.917 (2, dataset `2026-11-08-d15bdf2d`), `requiredReturn` 0.06 (1, Triennial p. 11), `guaranteeRateCut` (Unsourced), `lossOnExit` 1 (4), `DRAW_UP_FRONT` 0.10 (4, R11), `AVERAGE_DRAWN` 0.55 (4, R11), `CONSTRUCTION_LOAN_TO_COST` 0.55 (3, Terner p. 13), `AMI_TIER_BOUNDS` (1, HCD 2026 pp. 2–4), `INCLUSIONARY` (1, Triennial pp. 7–8; BLA p. 11), `ASSUMED_TENURE` (2), `DISPLACEMENT_RANGE` (3, slide 17; Soltas p. 4), every `DEBT_LIMITS` entry (1, BLA pp. 104–108; Resolution 562-24 p. 2).
- What was read and not used, and why (4.2's list, the FDIC rates, COP issuance costs, the inclusionary rise).
- That `CONSTRUCTION_LOAN_TO_COST` (0.55, Terner) and `AVERAGE_DRAWN` (0.55, R11) are equal by coincidence and mean different things: the first is a loan's share of cost, used only as a preset's starting value; the second is the average share of a loan that is out, used in every loan and guarantee saving.
- The one set of bounds: `INSTRUMENT_BOUNDS` with `validateInstrument` (F6) and `DEBT_BOUNDS` with `validateDebt` (F5), which every validator calls; values at full precision.
- That `INCLUSIONARY` is pinned to the Triennial table for this package, and that its rounding rule is a tier 4 assumption.
- That `docs/dev/sim-timers.md` "Evidence" types now live in `src/lib/sim/finance/evidence.ts` (one sentence added there).

## 9. Open questions

1. **A current construction-loan rate.** The only source is Terner's 8.5% for California in late 2023 (tier 3). Recommended: ship it as is, labelled; replace it if a tier 1 current figure (for example a Federal Reserve series on construction lending rates) is found, with no interface change.
2. **COP issuance costs** (15% to 25% of proceeds, Budget Analyst p. 108). Recommended: not modelled; a COP pool's inflow is the money the City can spend, and its principal is taken as equal. The `copCap` provenance says so.
3. **The scheduled rise of the rental inclusionary rate from 2028.** Recommended: hold the November 2026 rates (4.6), because the shortfalls assume them and no tier split is published.
4. **Inclusionary rules changed after the Triennial.** The Triennial's "current" rates hold "absent legislative action" on November 1, 2026, and the TAC recommended 5% or 10%. Decided: `INCLUSIONARY` is pinned to the Triennial table for this package. If a later ordinance is found, it is recorded in the package ledger for the conductor, and the table is not changed in this build.

## 10. Interface concerns

Still open:

1. **The design's section 4 lists loan-to-cost as a market term**, but no F8 formula reads one. It is exported as `CONSTRUCTION_LOAN_TO_COST` for presets only. No row change needed (reconciliation); kept here so the design's prose can be aligned when next edited.

Resolved at reconciliation (now row text, or ruled):

- `terms: MarketTerms | ResolvedTerms` (former concern 1): row F8.
- A typed market term, so a guarantee runs on a typed rate cut labelled "custom, not sourced" (former 2): row F7 (`FinanceLevers.terms`), row F8, row F17.
- `fundBundle` as the one pricing rule (former 3): row F8 (OD-F10, ruled by R12), now filling grants by tier, pro rata within a tier; its callers in F9 (c) and F13.
- Comparing two coverages in F9 (b) and (c) with the tolerance (raised in the previous revision of this spec): row F8's last sentence.
- A City loan or guarantee displacing outside grant money first (raised in the previous revision of this spec): row F8 now counts loans and guarantees inside their pool's tier, ahead of that tier's grants.
- A loan's grant-equivalent capped at its principal, and `requiredReturn` between 0.01 and 0.25 (former 4): rows F8 and F6.
- `isCertain` with tolerance 10⁻⁹ (former 5): row F8.
- `TermKey` and `ResolvedTerms` declared at step 0 in `src/lib/timelapse/types.ts`, re-exported by `terms.ts` (former 6): row F8; design "Dependency order", step 0.
- `limitStatements` takes the borrowing the policy adds, and `finance-score` builds the list (former 7): row F14.
- `market-baseline` adds `src/lib/sim/finance` to the hashed paths (former 8): global constraint "The engine is in the dataset version"; design "Dependency order".
- Interest on the whole principal (former 9): OD-F12, ruled by R11; row F8 multiplies the loan's interest saving and the guarantee's saving by `AVERAGE_DRAWN` (4.3, 4.4).
- `Sourced`, `Unsourced`, `Evidence` in `src/lib/sim/finance/evidence.ts` (former 11): row F4.
- The Budget Analyst's "$8.07 billion" against the arithmetic's $7.94 billion (former 12): no row change; this spec uses the arithmetic and the provenance notes the discrepancy (4.8).
