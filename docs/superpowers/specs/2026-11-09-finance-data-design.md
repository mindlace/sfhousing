# `finance-data`: per-record and transcribed data for the funding model

Package: `sim-financing` ([design](../design/2026-11-09-1911-sim-financing.md), [evidence digest](../research/2026-11-09-financing-evidence.md)). This spec owns interface row F12 and consumes F1, F2, F4, F5, F6 and F8. It is built **after** `market-baseline` (design, "Dependency order", step 1): both extend the calibration step and its report, so they run in sequence, and this spec reuses that subsystem's affordable-cohort flag. The two ship together in Release 1, as one dataset release.

Revised on 2026-11-09 to agree with the amended design (status note; "The model" section 3; OD-F10; rows F5 to F9 and F12; "Row ownership"; "Dependency order").

Terms used throughout:

- **Primary Planning record**: the Planning project record (`qvu5-m3a2`) that the project-records linker picks as a project's `primary` (`pipeline/project-records/types.ts:235-236`); the same record already gives a project's filing-stage size (`pipeline/project-records/inflight.ts:238`) and the affordable exemption (`pipeline/project-records/lapse.ts:189`).
- **Planning pair**: a primary Planning record's `number_of_units_prop` and `number_affordable_units_prop`.
- **The affordable-cohort flag**: `market-baseline`'s classification of a project history by its Planning pair (its spec, section 4.1 "Which starts are private", and its "Internal types"). It adds to each history the Planning pair of its primary record (null when there is none) and a predicate that marks the history `'affordable'` when the record proposes a positive number of homes and at least 95% of them affordable. This spec reuses both, under whatever names that spec gives them, and never computes the test a second time. Where this spec writes `pair`, it means that history field; where it writes "flagged", it means the predicate returns its affordable value.
- **The cohort**: qualifying project histories that are flagged and whose pair proposes at least 10 homes. The design calls these "100% affordable"; they are the proxy for publicly funded housing (no record carries a funding field). The 95% test is the flag's; the 10-home floor is F12's.
- **Uncovered cost of an affordable home**: `AFFORDABLE.costPerHome − AFFORDABLE.ownPerHome` (row F4), $861,525 on the Budget Analyst's numbers.

## 1. Scope

The design's Subsystems row, verbatim:

| Slug | Scope |
| --- | --- |
| `finance-data` | Per-record and transcribed data the funding model needs. Pipeline: ship each pipeline project's affordable homes; widen the housing-production source to its income-tier columns and ship progress to date by tier; fit the routes of 100% affordable projects and report their stage behaviour beside the others'; transcribe the baseline funding (City, state, federal, with page references) into a committed enrichment file, emit it as `calibration.baselineFunding`, and check the homes a year it implies against the homes a year the award records show. |

**In:**

1. `projects.json`: `affordableHomes` on every project; `rhnaCompletedNet.byTier`.
2. The housing-production source (`datasf-housing-production`, `xdht-4php`) widened to its tier columns.
3. A new locked source, `datasf-mohcd-pipeline` (`aaxw-2cb8`, PDDL-1.0).
4. `calibration.affordableRoutes` and `calibration.baselineFunding`, emitted after `calibration.market`, with their validators in `parseCalibration` and the exported `checkPool` and `checkProgramme`.
5. `pipeline/enrichment/funding.json`, its zod schema, and its fixture twin, with stable pool ids.
6. Calibration report sections 12 and 13: the cohort's routes and stages beside the other projects', with the baseline funding, its fill tiers and its check; and the site-choice check (OD-F9b).
7. Three data-quality rules, the extensions of invariants V20, V22 and V25, the fixture values, and the developer documentation.
8. The Release 1 source fetch (section 4.1).

**Out:** `calibration.market`, report section 11, the affordable-cohort flag on histories, and the addition of `src/lib/sim/finance` to the hashed paths (all `market-baseline`); the prototypes, `AFFORDABLE`, `uncoveredPerHome`, `fundBundle`, `isCertain` and every other function or constant of rows F4 and F8 (`finance-model`); anything that reads the new fields at run time: `buildSimInput`, the engine, the score, the levers and the page (`finance-engine`, `finance-score`, `finance-levers`, `funding-ui`). Nothing in this spec changes what the site shows.

**Hand-offs:**

- To `finance-engine`: `Calibration.affordableRoutes` (F9 (j)) and `Calibration.baselineFunding`. `buildSimInput` sets `finance` from `baselineFunding` only when the calibration has both `baselineFunding` and `market` (F9), from Release 2.
- To `finance-score`: `affordableHomes` (F13 pipeline projects) and `rhnaCompletedNet.byTier` (F14 `tiers.baseline`).
- To `finance-levers` and `funding-ui`: the baseline pool and programme ids, labels and kinds (`baselineScale` names the pools; the Funding tab lists them), and `checkPool` (and `checkProgramme` for the baseline only) for `finance-levers` to reuse.
- From `finance-model`: `AFFORDABLE` and `uncoveredPerHome('affordable', ·)` (F4), imported by path from `src/lib/sim/finance/`. `finance-model` precedes this subsystem in the dependency order.
- From `market-baseline`: the affordable-cohort flag (its section 4.1), `calibration.market` (whose key this spec's two keys follow) and report section 11 (which this spec's sections 12 and 13 follow). `market-baseline` precedes this subsystem.

## 2. Interfaces

Rows copied verbatim from the design's interface table.

| Row | | Interface | This spec |
| --- | --- | --- | --- |
| F1 | D | `type Dollars = number` is whole constant dollars of the dataset's `asOf` year. `type IncomeTier = 'veryLow' \| 'low' \| 'moderate' \| 'aboveModerate'`; `INCOME_TIERS` lists them in that order. `type TierUnits = Record<IncomeTier, number> & { unrecorded: number }`: `unrecorded` is income-restricted homes whose tier the records do not give. `type ProjectKind = 'market' \| 'affordable'`. These, and the types of rows F2, F5, F6 and F12, live in `src/lib/timelapse/types.ts` (relative imports only; the pipeline imports it by path, and `calibration.json` carries them). |
| F2 | M | `interface MarketStep { from: Day; logOdds: number }`: from `from` on, `logOdds` is added to every lot's initiation log-odds; steps are strictly ascending by `from` and the first is at or before `asOf`. `interface MarketModel { today: { all: number; private: number; years: [number, number]; observed: { all: number; private: number }; implied: number; provenance: Provenance }; crossCheck: { logOdds: number; provenance: Provenance }; slope: { perCostShare: number; provenance: Provenance; crossChecks: { costCoefficient: number; priceCoefficient: number; provenance: Provenance } } }`. `today.all` is the natural log of observed starts over implied starts in the last three panel years (`years`, first and last), where the implied starts are the sum of the published model's hazard over those years' lot-months: the published model is the one the engine runs, so the shifted engine reproduces those years' count closely, which the pipeline checks (OD-F11). `today.private` is the same with the observed count restricted to starts whose Planning record does not propose at least 95% affordable homes. `observed` and `implied` are those counts, for the page's sentence. The hold-out (the model fitted on the years before them, against the same observed count) is in the calibration report as evidence of the cycle, and is never applied. `crossCheck.logOdds` is the Controller's coefficients on its own indices: reported, never applied. `slope.perCostShare` is the log-odds shift for public money equal to 100% of a project's construction cost. It is `−today.private ÷ typicalUncoveredShare`, where `typicalUncoveredShare` is the mean of `uncoveredPerHome('market', p) ÷ p.costPerHome` over the prototypes (F4), weighted by the share of the last five panel years' private starts that fall in each prototype: closing a typical private project's whole uncovered cost returns its odds to the 2007–2025 average (tier 2; OD-F9a). `crossChecks` are the same quantity from the Controller's cost coefficient and from its price coefficient: reported, never applied. `Calibration.market?: MarketModel`; absent means no market term (shift 0) and no slope, so no programme can be compiled. `marketSteps(m: MarketModel \| undefined, asOf: Day, level: 'all' \| 'private'): MarketStep[]` returns the one step this package ships, `[{ from: asOf, logOdds }]`, or `[]` without a model. `parseCalibration` validates `market` when present. |
| F4 | M | `interface Prototype { id: 'A' \| 'B' \| 'C' \| 'D' \| 'E'; stories: number; homes: number; costPerHome: Dollars; shortfallPerHome: Dollars; provenance: Provenance }`: `costPerHome` is the Controller's total cost excluding land, `shortfallPerHome` the negated residual land value under current requirements. `PROTOTYPES: readonly Prototype[]` lists A to E. `prototypeFor(stories: number, homes: number): Prototype`: fewer than 25 homes is E; otherwise up to 6 stories A, up to 10 B, up to 18 C, above that D (binning tier 4, stated in the provenance). `LAND_PER_HOME: Sourced<Dollars>`. `AFFORDABLE: Sourced<{ costPerHome: Dollars; ownPerHome: Dollars }>` (the Budget Analyst's average; `ownPerHome` is permanent loans plus other). `uncoveredPerHome(kind: ProjectKind, p: Prototype): Dollars` is `p.shortfallPerHome + LAND_PER_HOME` for `market` and `AFFORDABLE.costPerHome − AFFORDABLE.ownPerHome` for `affordable`. `costPerHome(kind, p)` is `p.costPerHome` for `market` and `AFFORDABLE.costPerHome` for `affordable`. `src/lib/sim/finance/` has no `$lib` import, because the pipeline imports it by path; `Sourced`, `Unsourced` and `Evidence` are declared in `src/lib/sim/finance/evidence.ts` and re-exported from `src/lib/sim-page/timing-sources.ts`. |
| F5 | M | `type Inflow = { kind: 'once'; day: Day; dollars: Dollars } \| { kind: 'yearly'; from: Day; to: Day \| null; dollarsPerYear: Dollars }`; a yearly inflow arrives on `from` and on the same month and day of each later year (29 February becomes 28 February in a common year), up to `to` inclusive, and an arrival before the run's `asOf` is never received. `inflowArrivals(inflow: Inflow, asOf: Day, horizon: Day): Day[]` in `src/lib/sim/scenario/funding.ts` (`finance-engine`) is the one implementation; `finance-levers` imports it. `type PoolKind = 'goBond' \| 'cop' \| 'generalRevenue' \| 'dedicatedTax' \| 'state' \| 'federal' \| 'bank'`. `interface Pool { id: string; kind: PoolKind; label: string; inflows: Inflow[]; uncapped: boolean; debt: { rate: number; termYears: number } \| null; leverage: number }`: an `uncapped` pool can always pay and has no inflows (in the baseline, only the federal tax-credit pool); `debt` is non-null exactly for `goBond` and `cop`, with `rate` above 0 and at most 0.25 and `termYears` 1 to 40 (the bounds every validator and `debtService` share); `leverage` is the dollars a pool may have committed or out per dollar received: 1 for every kind but `bank`, where it is a sourced or typed number that may be below 1 (the SF plans lend 0.67 to 0.82 per City dollar and take no deposits). |
| F6 | M | `type Instrument = { kind: 'grant'; share: number } \| { kind: 'loan'; costShare: number; rate: number; requiredReturn: number \| null } \| { kind: 'guarantee'; costShare: number; reserve: number }`. A grant pays `share` (0 < share ≤ 1) of the project's uncovered cost per home. A loan lends `costShare` of cost per home at `rate`, repaid to its pool on the project's completion day; `requiredReturn`, when set, is the return the lent capital accepts in place of the market's, between 0.01 and 0.25. A guarantee covers a private loan of `costShare` of cost per home and holds `reserve` (a share of that loan) in its pool until completion. `interface Programme { id: string; label: string; pool: string; reach: ProjectKind; instrument: Instrument; from: Day; to: Day \| null; minHomes: number; tiers: Record<IncomeTier, number> \| null }`: `minHomes` is a whole number of 0 or more (at most 10,000), and an instrument is valid when `finance-model`'s `validateInstrument` accepts it, the one check every validator calls; `tiers` (shares summing to 1) is required for `reach: 'affordable'` and null otherwise. |
| F8 | M | `grantEquivalentPerHome(inst: Instrument, kind: ProjectKind, p: Prototype, terms: MarketTerms \| ResolvedTerms): Dollars`. Grant: `share × uncoveredPerHome`. Loan: principal `costShare × costPerHome`, times `max(0, terms.constructionRate − rate)`, times `terms.constructionYears`, times `AVERAGE_DRAWN`; plus, when `requiredReturn` is set and below `terms.requiredReturn`, `costShare × ownValuePerHome × (terms.requiredReturn ÷ requiredReturn − 1)`, where `ownValuePerHome` is `costPerHome − shortfallPerHome` for `market` and `AFFORDABLE.ownPerHome` for `affordable`. Guarantee: `costShare × costPerHome × terms.guaranteeRateCut × terms.constructionYears × AVERAGE_DRAWN`. `AVERAGE_DRAWN: Sourced<number>` is the average share of a construction loan that is out over the construction period, `DRAW_UP_FRONT + (1 − DRAW_UP_FRONT) ÷ 2` = 0.55, with `DRAW_UP_FRONT: Sourced<number>` = 0.10 drawn at the start and the rest drawn evenly (ruling R11; a tier 4 assumption, labelled as one). It changes only the saving: a pool still commits a loan's whole principal at the start (F9 (g)). A loan's grant-equivalent is never more than its principal. `MarketTerms` are `Evidence` constants keyed by `TermKey = 'constructionRate' \| 'constructionYears' \| 'requiredReturn' \| 'guaranteeRateCut' \| 'lossOnExit'`. `resolveTerms(MARKET_TERMS, typed)` gives `ResolvedTerms`: each term a number, or null when it is unsourced and not typed, with `custom: TermKey[]` naming the typed ones (both types are declared in `src/lib/timelapse/types.ts` at step 0). An instrument that needs a null term cannot be compiled or offered; on a typed term it runs labelled "custom, not sourced". `coverage(g: Dollars, kind, p): number` is `g ÷ uncoveredPerHome`. `oddsShift(g: Dollars, kind, p, slope: number): number` is `slope × g ÷ costPerHome(kind, p)`. `fundBundle(items: readonly { instrument: Instrument; poolKind: PoolKind }[], kind, p, terms): { items: { grantEquivalent: number; granted: number; lent: number; guaranteed: number; reserve: number }[]; grantEquivalent: number; coverage: number; certain: boolean }` prices a bundle per home (OD-F10), in three tiers by pool kind: `federal` pools, then `state` pools, then the City's (`bank`, `dedicatedTax`, `generalRevenue`, `goBond`, `cop`). Within a tier, loans and guarantees count first, in input order, at their full grant-equivalent; the tier's grants then each pay `share × uncoveredPerHome` when they fit in what remains of the uncovered cost, and otherwise the same fraction of it, so that the tier covers exactly what remains. Grants never pay more than the uncovered cost, outside money counts before the City's, and the City's sources share what is left in proportion, so that money added to one relieves all of them. A project is **certain** when `isCertain(coverage)`: the coverage of its bundle is at least 1 − 10⁻⁹ (a floating-point tolerance, not a model number). Every comparison of two coverages in F9 (b) and (c) allows the same tolerance. |
| F12 | M | `projects.json`: each project gains `affordableHomes?: number \| null` (the Planning record's proposed affordable homes; null or absent when not recorded). `rhnaCompletedNet` gains `byTier?: TierUnits` (net homes completed since `since`, from the housing-production records; above moderate is the net total less the income-restricted tiers, so losses are netted against it and the tiers sum to `units`, a pipeline invariant). `calibration.json` gains `affordableRoutes?: Record<Pathway, number> & { provenance: Provenance }`: the pathway shares of projects of 10 homes or more, first recorded in the planning-side window, whose Planning record proposes at least 95% affordable homes (shares sum to 1; fewer than 30 such projects falls back to `pathwayForNew` with a tier 4 label). It also gains `baselineFunding?: { pools: Pool[]; programmes: Programme[]; provenance: Provenance[]; check: { impliedHomesPerYear: number; observedHomesPerYear: number; provenance: Provenance } }`: today's public funding of affordable homes, transcribed with page references in `pipeline/enrichment/funding.json`. The four new fields are optional in the types, because older dataset versions and the hand fixtures lack them; an absent `baselineFunding` means no baseline funding. `provenance` holds one entry per pool in `pools` order, then one for the programmes' `tiers` and `minHomes`. Baseline pool and programme ids match `^[a-z0-9][a-z0-9-]{0,39}$`, never start `u-`, and stay the same from one dataset version to the next, because stored policies name them. It holds one City pool per source in the Budget Analyst's Exhibit E (yearly inflows), one `state` pool (the yearly average to San Francisco), one uncapped `federal` pool, and one grant programme per pool with `reach: 'affordable'`, whose `share` is that source's dollars per home over the uncovered cost per home. The programmes' `tiers` and `minHomes` come from a new locked source, the MOHCD affordable pipeline (`aaxw-2cb8`, PDDL): the income-band mix of its homes, and the 10th percentile of homes per project. `check` compares the homes a year the capped pools can fully fund with the homes a year in San Francisco's bond and tax-credit awards; when they differ by more than half the pipeline warns and the calibration report says so. The calibration report also gains two sections: the 100% affordable cohort's stage durations and exits beside the other projects', fitted with the same method as the transition tables; and the mean fitted start hazard of the lots where that cohort's projects started, over the mean for the lots where private projects started (R10, OD-F9b: whether funded projects sit on lots like those private projects choose). Both are report-only. |

**How this spec reads F12 on loading.** Step 0 declares the four new fields, optional, in the types (design, "Dependency order", item 0); this spec adds their behaviour: computing, emitting and validating them. F12 makes them optional because a dataset built before this package has none of them and `/s/<id>` opens a policy on its own dataset version (`docs/dev/plan-sharing.md:190`). So the validators treat an absent `affordableHomes` as null, an absent `byTier` as "no tier data", and absent `affordableRoutes` and `baselineFunding` as "not in this dataset" (no baseline funding). The pipeline always writes all four.

### Internal types

These do not alter any row. This spec adds no history field: the cohort reads `market-baseline`'s (see "The affordable-cohort flag" above).

- `HousingRow` (`pipeline/project-records/types.ts:137-144`) gains `affordable: number | null` and `tiers: { extremelyLow: number; veryLow: number; low: number; moderate: number } | null`. `tiers` is null when any of the four columns is blank.
- `FundingFile`: the parsed `funding.json` (section 4.5), with a zod schema in `pipeline/enrichment/funding-schema.ts`.
- `MohcdRow`: one `aaxw-2cb8` row, typed in `pipeline/lib/fzp-cal/funding.ts`.
- `AffordableReport`: the report-only results of section 4.7 and 4.8, passed to `calibrationReport` as `ReportInput.affordable`.

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

### 4.1 Sources and the lock

**Housing production, widened.** The entry at `pipeline/sources/datasf.ts:135-142` selects `bpa,blocklot,form_no,net_units_completed,first_completion_date`. Its `select` becomes:

`bpa,blocklot,form_no,net_units_completed,first_completion_date,extremely_low_income,very_low_income,low_income,moderate_income,affordable_units`

All of these columns exist (verified by query, 2026-11-09: `https://data.sf.gov/api/views/xdht-4php.json` and `…/resource/xdht-4php.json?$where=first_completion_date>='2023-01-01'`). Facts the design rests on, each verified by that query:

- The dataset has **no above-moderate column** and **no "tier unknown" column**.
- `market_rate` is "net units minus affordable units".
- On all 999 rows completed since 2023-01-01, the four tier columns sum exactly to `affordable_units`, and tiers plus `market_rate` equal `net_units`.
- The licence is "Public Domain U.S. Government". The lock's `public-domain` stays.
- The dataset description says that where AMI levels are unknown, Planning estimates them from similar projects. Such rows carry `affordable_is_estimate` (one row since 2023). They are counted in their stated tiers, and the provenance says so.

**MOHCD affordable pipeline, new.** A new `DatasfId` `'datasf-mohcd-pipeline'`:

```ts
'datasf-mohcd-pipeline': {
  dataset: 'aaxw-2cb8',
  format: 'json',
  select:
    'project_id,project_name,project_status,general_housing_program,project_type,housing_tenure,' +
    'total_project_units,mohcd_affordable_units,_20_ami,_30_ami,_40_ami,_50_ami,_55_ami,_60_ami,' +
    '_80_ami,_90_ami,_100_ami,_105_ami,_110_ami,_120_ami,_130_ami,_150_ami,ami_undeclared',
  license: 'PDDL-1.0',
  homepage: 'https://data.sf.gov/d/aaxw-2cb8',
  label: 'DataSF MOHCD Affordable Housing Pipeline'
}
```

These facts were verified by query on 2026-11-09 (`https://data.sf.gov/api/views/aaxw-2cb8.json`):

- Licence: "Open Data Commons Public Domain Dedication and License".
- Attribution: "Mayor's Office of Housing and Community Development".
- 190 rows, with "Data reflects all projects as of September 30, 2023".
- Every selected field exists.
- There is no unit column for managers or market-rate homes.

**Attribution.** The `/attribution` page lists data sources from the manifest, and the manifest lists every lock entry (`pipeline/steps/manifest.ts:39-41`, `src/routes/attribution/+page.server.ts:7`). So the lock entry, with its label, licence and homepage, *is* the attribution credit. `src/lib/attribution.ts` lists software only (`SOFTWARE`, line 1) and does not change. The Budget Analyst report, the CDLAC lists and the CTCAC list are not data sources in the dataset. They are cited in the provenance of the values transcribed from them.

**Not an as-of source.** `datasf-mohcd-pipeline` stays out of `PROJECT_SOURCE_IDS` (`pipeline/project-records/types.ts:20`), which `AS_OF_SOURCE_IDS` is (`pipeline/project-records/parse.ts:84`: `AS_OF_SOURCE_IDS = PROJECT_SOURCE_IDS`), so it is not an as-of source and the project-records step never reads it. It is a 2023 snapshot that adds no project events, so fetching it must not move `asOf`. `datasf-housing-production` *is* an as-of source. Widening its `select` changes its URL, so the lock entry must be fetched again, and refreshing it alone would move `asOf` past the other sources' data (`docs/dev/pipeline.md`, "Lock and `datasetVersion`").

The Release 1 fetch is therefore one command that refreshes the eight project sources together with the new source:

```
npm run pipeline -- fetch --only datasf-permits-newcon,datasf-permits-named,datasf-planning-projects,datasf-planning-records,datasf-planning-review,datasf-unit-completions,datasf-housing-production,datasf-dev-pipeline,datasf-mohcd-pipeline
```

This spec's builder runs that fetch once and commits the refreshed lock to this spec's branch, after `market-baseline` has been merged into the Release 1 branch (design, "Dependency order", "How a release is built"). The Release 1 dataset is then built once, on the Release 1 branch, from the refreshed lock, so `market-baseline`'s values (its `today.*` counts among them) are re-measured on it; that spec's live acceptance criterion already allows a stated difference from its reference build. Refreshing the project sources at the same time keeps `asOf` consistent across them, which a refresh of the housing-production source alone would not.

**Reading.** The new source is not normalised into DuckDB. The calibration step reads its locked pages as rows, with the same reader the project-records step uses. `readRows` (`pipeline/steps/projects.ts:64`, today private and typed on `ProjectSourceId`) is exported with the signature `export function readRows(lock: Lock, rawDir: string, byName: boolean, id: DatasfId): RawRow[]` (`DatasfId`, `pipeline/sources/datasf.ts:7`); its body does not change, and its existing callers pass a `ProjectSourceId`, which is a `DatasfId`. Before calling it, the calibration step checks the lock and throws its own `BuildError` when the entry is missing: `lock has no datasf-mohcd-pipeline entry (run fetch --only datasf-mohcd-pipeline)`.

### 4.2 `affordableHomes` on in-flight projects

`affordableHomes` is computed in `deriveProjects` where the T3 project is assembled (`pipeline/project-records/derive.ts:1302-1325`). `orderProject` emits it after `existingUnits` (`pipeline/project-records/assemble.ts:209-229`).

| Project | `affordableHomes` | Reason |
| --- | --- | --- |
| A project whose primary Planning record has `number_affordable_units_prop` | `min(affordableProp, units)` | Same record as the size rule (`inflight.ts:238`) and the exemption (`lapse.ts:189`), so the three cannot disagree on which record speaks. |
| A split part (`PRJ:<id>:BP:<permit>`) | `null` | The record's count is the whole PRJ's, not the part's. Same reasoning as Ruling S2 for `unitsAt.filed` (`derive.ts:356-359`). |
| `multiPhase` true (DA masters) | `null` | A DA's Planning count, when there is one, describes the whole agreement, not the remaining phases. The DA's affordable commitments are in no per-record field. |
| Pipeline-only (`BP:`, `CASE:`) and PPA-only (`PPA:`) projects, and any project with no primary Planning record | `null` | No Planning record. |

Several Planning records on one project do not matter: only the primary speaks, and satellites and other anchors are sources only.

**Clamp.** When `affordableProp > units`, the value is clamped to `units` and the project gains the quality id `pr.affordable.over-units` (section 4.9). `units` is the project's gross units after netting. A clamp can happen when the permit units are below the Planning record's proposal. On the 2026-10-17 lock no Planning record has `affordable > units` (read-only count over the 54,692 locked rows), so the rule is a guard.

**Zero versus not recorded.** The field is never blank in the locked rows: 53,747 records hold 0, 945 a positive count, and none is blank. A recorded 0 therefore means "the record proposes none or does not say". It ships as 0, not null. The provenance and `docs/dev/finance-data.md` say this; row F13 now tells `finance-score` the same.

**Validation (V20).** `parseProjectsFile` (`src/lib/timelapse/projects.ts:311-375`):

- absent `affordableHomes`: accepted, read as null;
- otherwise it must be null or an integer in `[0, units]`;
- error text: `projects[<i>].affordableHomes: must be null or an integer in [0, units]`.

Step 0 declares `InFlightProject.affordableHomes?: number | null` (F12; design, "Dependency order", item 0); this spec adds its behaviour: the computation above, the emitted order and the validation.

**Histories.** The cohort reads `market-baseline`'s history field, which carries the primary Planning record's own pair, unclamped, so the share is not distorted by a permit-side size. That field is set on split parts too (a split part keeps its PRJ's primary record, `derive.ts:357-360`), unlike `affordableHomes` above. For the cohort this is right: a split part's Planning pair is its PRJ's, so its share classifies the PRJ, and each part counts as one history, exactly as `pathwayForNew` counts it (`pipeline/lib/fzp-cal/pathway-mix.ts:63-94`). `affordableHomes`, by contrast, is a count of this project's homes, which the PRJ's pair does not give for a part.

### 4.3 `rhnaCompletedNet.byTier`

`rhnaCompletedNet` (`pipeline/project-records/rhna.ts:22-83`) keeps its window, forms and `units`. For each counted row (forms 1, 2, 3, 6 and 8, `first_completion_date` in `[2022-06-30, asOf]`), with `n = net_units_completed`, the first rule that applies decides. This is F12's rule: above moderate is the net total less the income-restricted tiers, so losses are netted against it and the tiers sum to `units`.

0. **No net homes** (`n ≤ 0`, a demolition or loss, form 6 among others). The row adds `n` to `aboveModerate` and nothing to any other tier, whatever its tier columns hold. Scaling restricted counts to a zero or negative total has no meaning, and the records give no tier for demolished homes.
1. **Tiers known** (`tiers` non-null). The row's tier counts are:
   - `veryLow = extremely_low_income + very_low_income`. California's very-low category includes extremely low, and RHNA has four tiers.
   - `low = low_income`.
   - `moderate = moderate_income`.
   - Let `a` be their sum. If `a ≤ n`, the row adds those counts and `aboveModerate += n − a`.
   - If `a > n` (a partly completed building whose restricted homes exceed the homes completed so far), the four counts are scaled to `n` by `largestRemainder` (`pipeline/project-records/multiphase.ts:68`), ties to the earlier tier in `INCOME_TIERS` order, and `aboveModerate += 0`.
2. **Tiers missing** (`tiers` null). If `affordable_units > 0`, the row adds `unrecorded += min(affordable_units, n)` and `aboveModerate += n − that`, and the rule `pr.rhna.tier-unrecorded` counts it. If `affordable_units` is null or 0, `aboveModerate += n`.

Rule 0 is stated in the provenance: net losses are charged to above moderate.

**Invariant.** `veryLow + low + moderate + aboveModerate + unrecorded === units` exactly. V22 gains this check, with detail `byTier sums to <s>, units <u>`.

`orderProjectsFile` emits `byTier` after `since`, in `INCOME_TIERS` order then `unrecorded`. Older files without `byTier` validate. When present, each of the five values must be an integer and they must sum to `units`. The error text is `rhnaCompletedNet.byTier: must sum to units`.

**Provenance.** The existing `rhnaCompletedNet.provenance.method` (`rhna.ts:74-75`) gains this sentence:

> "By tier: extremely low plus very low income as very low, low and moderate income as recorded, the rest of each row's net completed homes as above moderate (the source has no above-moderate column; net losses fall there); a row whose tier columns are blank counts its affordable homes as not recorded; Planning estimates some rows' tiers from similar projects (affordable_is_estimate)."

The tier stays 0.

**Expected live values.** These are for orientation only, not test values. Since 2023-01-01: very low 1,670; low 1,252; moderate 557 (the research query). Those rows show `unrecorded` 0. The BLA's Exhibit D (p. 5) counts progress by permits ("Source: 2025 Housing Inventory"), not completions, and is not a check on these numbers; `finance-score` labels tier progress "completed since 30 June 2022 (net)" (reconciliation, `finance-score`).

### 4.4 `calibration.affordableRoutes`

A new function, `affordableRoutes(norm, forNew, asOf, minProjects = 30)`, lives in `pipeline/lib/fzp-cal/affordable.ts` and is called in `calibrate` after `pathwayForNew` (`pipeline/lib/fzp-cal/calibrate.ts:132`).

**Population.** The population is the qualifying normalised histories with a non-null pathway, whose first record (any stage, `firstRecord` in `pathway-mix.ts:23`) lies in `[PLANNING_START, asOf]`, and that are in the cohort (flagged by `market-baseline`'s predicate, and `pair.units ≥ 10`). This is the same window and the same counting as `pathwayForNew` (`pathway-mix.ts:63-94`). The flag's 95% test (`affordable ≥ 0.95 × units` in floating point) and the integer test `20 × affordable ≥ 19 × units` agree on every pair with `units` up to 2,000 (checked exhaustively, 2026-11-09), so the cohort is the same whichever form a reader uses.

**`n ≥ 30` (the measured case).** Shares come from `roundShares` (`pipeline/lib/fzp-cal/round.ts:16`), so they sum to 1 in millionths. The provenance is:

- `tier: 0`;
- `label`: `"SF Planning & permit records <from>–<to>: pathway of 100% affordable projects (tier 0)"`;
- `method`: `"Pathway shares among <n> qualifying histories with a known pathway, first recorded <from> to <to>, whose primary Planning record proposes 10 homes or more and at least 95% of them affordable (a proxy for publicly funded: no record carries a funding field); <counts>; shares rounded to 6 decimals, the residual to the largest"`;
- `sources: [datasf('planningProjects'), datasf('permits')]`, with `n` and `window` set.

**`n < 30` (the fallback).** The three shares are `pathwayForNew`'s, copied. The provenance is:

- `tier: 4`;
- `label`: `"Pathway mix of 100% affordable projects (tier 4: the mix of all new projects)"`;
- `method`: `"Only <n> 100% affordable histories (fewer than 30); the pathway mix of all new projects is used in their place"`;
- `n` and `window` set.

On a live build (`cal.name !== 'fixture'`) the fallback also adds this warning to `CalOutput.warnings` and the report: `affordableRoutes: only <n> 100% affordable histories (fewer than 30); the pathway mix of all new projects is used, labelled tier 4`. A fixture build takes the fallback by design and does not warn.

The threshold 30 is the design's (F12) and matches `LIVE_CAL.nSpellsMin` (`pipeline/lib/fzp-cal/config.ts:9`). It is a function argument and not in the profile, so the fixture build, whose cohort is empty, takes the fallback and labels it tier 4, as the design requires.

**Expected live value** (orientation): about 54 histories, two thirds streamlined (digest section 1). The fitted value is whatever the build measures.

**Order and validation.** `Calibration` keys are emitted in declaration order (`src/lib/timelapse/types.ts:71`). The order becomes `…, phaseGap, market?, affordableRoutes?, baselineFunding?` (design, "Dependency order"). `market` is `market-baseline`'s and is already in place when this spec is built; these two keys follow it. `parseCalibration` (`src/lib/timelapse/model.ts:767-781`) validates `affordableRoutes` when present with the existing `checkPathwayMap(v, 'affordableRoutes', true)` (`model.ts:740`).

### 4.5 `pipeline/enrichment/funding.json`

The file is committed and hand-transcribed. It is read directly by `build` (not fetched, not locked) and is part of the dataset-version hash because it sits under `pipeline/`. Its zod schema is `pipeline/enrichment/funding-schema.ts`, in the style of `construction-schema.ts`: `strictObject`, a `YYYY-MM-DD` refinement, and non-empty text. A parse failure is a `BuildError` naming the zod path. Paths:

```ts
const FUNDING = {
  live: 'pipeline/enrichment/funding.json',
  fixture: 'pipeline/test/fixtures/mini/enrichment/funding.json'
};
```

They are placed beside `MULTIPHASE` in `pipeline/steps/build.ts:76-84`, and the fixture is chosen on a `fixture-<n>` version.

**Schema** (every dollar a whole number):

```ts
interface Cite { label: string; url: string; page: string; retrieved: IsoDate; quote?: string }
interface FundingFile {
  schema: 1;
  /** Exhibit F: average funding per home, tax-credit projects, 2024 */
  perHome: { total: number; city: number; federal: number; state: number;
             permanentLoans: number; other: number; tier: 1; cite: Cite };
  /** Exhibit E: local MOHCD multifamily spending by source, FY2024-25 */
  city: { fiscalYear: string; total: number; tier: 1; cite: Cite;
          sources: { id: string; label: string; kind: 'goBond' | 'cop' | 'generalRevenue' | 'dedicatedTax';
                     dollarsPerYear: number; debt: { rate: number; termYears: number; cite: Cite } | null;
                     note: string; cite: Cite }[] };
  state: { id: string; label: string; dollarsPerYear: number; tier: 2; method: string; cite: Cite };
  federal: { id: string; label: string; tier: 2; method: string; cite: Cite };
  /** awards whose homes give check.observedHomesPerYear */
  awards: { years: number[]; rows: { year: number; application: string; project: string;
            credit: '4%' | '9%'; newConstruction: boolean; homes: number; cite: Cite }[] };
  /** pool ids of sources that have ended; never reused (empty today) */
  retiredIds: string[];
}
```

**Refinements.** Each failure is a `BuildError` with the message shown:

- `perHome` parts sum to `total`: "perHome parts must sum to total".
- `city.sources` dollars sum to `city.total`: "city sources must sum to total".
- Ids (`city.sources[].id`, `state.id`, `federal.id`) are unique, match `^[a-z0-9][a-z0-9-]{0,30}$` and do not start `u-`: "funding ids must be unique, at most 31 characters of a-z, 0-9 and -, and not start u-". The 31-character bound is F12's 40 less the 9 characters of `baseline-`, so every programme id `baseline-<pool id>` also matches F12's `^[a-z0-9][a-z0-9-]{0,39}$`.
- No current id is in `retiredIds`: "funding id <x> is retired and cannot be reused".
- `debt` is non-null exactly when `kind` is `goBond` or `cop`.
- Every award row's `year` is in `awards.years`.
- `awards.years` is non-empty, ascending and unique.

**Cross-check with F4.** `perHome.total` must equal `AFFORDABLE.costPerHome`, and `perHome.permanentLoans + perHome.other` must equal `AFFORDABLE.ownPerHome`. Otherwise the step throws `BuildError('funding.json perHome disagrees with AFFORDABLE (src/lib/sim/finance)')`. Both transcribe the same exhibit, and a silent divergence would make the shares wrong.

**Live content.** Each number was re-read in its primary source.

| Field | Value | Source (verified) |
| --- | --- | --- |
| `perHome` | total 954,127; city 300,027; federal 443,108; state 118,390; permanent loans 87,431; other 5,171 | Budget and Legislative Analyst, *Funding and Incentivizing Affordable Housing in San Francisco*, 2026-06-05, Exhibit F, p. 7 (printed page = PDF page); same figures p. 40–41, Exhibit 13. Tier 1. The exhibit gives no project count or year range; its own source is Planning's 2024 pipeline flyer, which gives none either. |
| `city.sources` | `city-debt` 80,500,000; `city-ocoh` 48,600,000; `city-general-fund` 36,700,000; `city-impact-fees` 34,800,000; `city-housing-trust-fund` 27,400,000; `city-redevelopment` 6,000,000; total 234,000,000 | Same report, Exhibit E, p. 6 (and Exhibit 14a, p. 43), FY2024-25 expenditures. Tier 1. |
| `city-debt.debt` | rate 0.06, termYears 20 | Same report, p. 106 and Exhibit 40: "Assuming G.O. bonds are issued at a 6.0 percent interest rate for a 20-year term". Tier 2 (the Analyst's assumption). |
| `state.dollarsPerYear` | 150,000,000 | Same report, p. 42: HCD and CalHFA programmes "have provided more than $1.2 billion in funding for affordable housing in San Francisco since 2018, according to MOHCD staff". $1.2 billion over the eight calendar years 2018–2025 (the report's data end in 2025). Tier 2; "more than" makes it a lower bound, and the method says so. |
| `federal` | no amount; uncapped | Exhibit F federal $443,108 a home (p. 7). The design's ruling that no ceiling binds San Francisco rests on the 2026 award records (digest section 6). Tier 2. |
| `awards.years` | [2024, 2025] | The complete calendar years with published award lists. 2026 has two of its rounds and is left out, because a part year would understate. |
| `awards.rows` | 19 rows, listed in full under "Award rows" below: 2024 new construction 1,274 homes (ten rows), 2025 new construction 686 homes (five rows), and four rehabilitation rows with `newConstruction: false`. | CDLAC final lists of awards and CTCAC's *List of Projects* workbook, by the rule below. Tier 0. Verified by reading each list on 2026-11-09. |

**City source kinds.** Labels are what a user sees.

| id | label | kind | Why |
| --- | --- | --- | --- |
| `city-debt` | City: general-obligation bonds and other debt | `goBond` | p. 43: the 2016, 2019 and 2024 GO bonds; commercial paper and certificates of participation are named as other tools, with no split. GO bonds dominate, so it is `goBond` with GO terms. |
| `city-ocoh` | City: Our City, Our Home fund | `dedicatedTax` | Voter-approved 2018 fund (p. 44). |
| `city-general-fund` | City: General Fund | `generalRevenue` | p. 44 (includes the Housing Stability Fund, spent down by February 2026, p. 100). |
| `city-impact-fees` | City: affordable-housing impact fees | `dedicatedTax` | `PoolKind` has no fee kind. A dedicated revenue is the nearest, and the `note` says it is a fee, not a tax. |
| `city-housing-trust-fund` | City: Housing Trust Fund | `generalRevenue` | p. 109: "an annual allocation from the General Fund of approximately $52 million". |
| `city-redevelopment` | City: former Redevelopment Agency housing assets | `dedicatedTax` | p. 44: the Low- and Moderate-Income Housing Asset Fund, a special revenue fund. |

The state pool is `state` ("State of California: housing programmes", kind `state`). The federal pool is `federal-tax-credits` ("Federal: low-income housing tax credits", kind `federal`).

**Stable ids.** Stored policies name baseline pools in `baselineScale` and baseline programmes by id (F7, F12), so these eight pool ids, and the programme ids `baseline-<pool id>` derived from them, are fixed. All sixteen match `^[a-z0-9][a-z0-9-]{0,39}$` and none starts `u-` (checked: the longest, `baseline-city-housing-trust-fund`, has 32 characters). A later transcription of a new Budget Analyst report keeps every id whose source continues, even if its label or amount changes. An id is never reused for a different source. A source that ends is removed from `funding.json` and its id moved to the file's `retiredIds` list (section 4.5 schema), so none is reused. A pipeline test (section 6) pins the live file's ids to the eight above, so a rename fails a test and is reviewed. A stored policy that names a retired id loads with that entry dropped and a notice (F15: "A `baselineScale` entry or a programme naming a baseline pool the page's dataset does not have is dropped on load with a notice"); that is `finance-levers`'s.

**Fill tiers (F8 `fundBundle`, OD-F10).** Grants fill what remains of a project's uncovered cost in three tiers: `federal` pools, then `state` pools, then the City's (`bank`, `dedicatedTax`, `generalRevenue`, `goBond`, `cop`). Within a tier each grant pays its share when the tier's shares fit in what remains, and otherwise the same fraction of its share (pro rata). The baseline pools fall in these tiers:

| Tier | Programme | Pool kind |
| --- | --- | --- |
| 1, federal | `baseline-federal-tax-credits` | `federal` |
| 2, state | `baseline-state` | `state` |
| 3, City | `baseline-city-debt` | `goBond` |
| 3, City | `baseline-city-ocoh` | `dedicatedTax` |
| 3, City | `baseline-city-general-fund` | `generalRevenue` |
| 3, City | `baseline-city-impact-fees` | `dedicatedTax` |
| 3, City | `baseline-city-housing-trust-fund` | `generalRevenue` |
| 3, City | `baseline-city-redevelopment` | `dedicatedTax` |

With every baseline pool on and nothing added, the eight shares sum to 1, so each grant pays its whole share and the tiers change no dollar. Once the user adds grants (their shares then sum above 1), federal and state money still pays its full share, and the City's pools share what is left in proportion to their shares; no City source pays before another. Among the City's pools the kind decides only the debt terms (`goBond` and `cop` carry `debt`, F5) and the grouping in the results. This spec only fixes the kinds; the arithmetic is `finance-model`'s and the award rule `finance-engine`'s.

**Switching a pool off.** A `baselineScale` entry of 0 switches any baseline pool off from its day, the uncapped federal pool included (F7; F9 `off`). That is applied by `finance-levers` and the engine; the data this spec emits does not change.

**Award rows.** `awards.rows` is every San Francisco row of these five CDLAC *Qualified Residential Rental Projects* final lists of awards (the rows whose County column is "San Francisco"), plus every San Francisco 9% row of the CTCAC workbook whose application number begins `CA-2024-` or `CA-2025-`:

| List | URL |
| --- | --- |
| CDLAC 2024 round 1 | https://www.treasurer.ca.gov/sites/default/files/2025-12/05_Qualified_Residential_Rental_Projects_Round_1_Final_List_Of_Awards.pdf |
| CDLAC 2024 round 2 | https://www.treasurer.ca.gov/sites/default/files/2025-12/04_Qualified_Residential_Rental_Projects_Round_2_Final_List_of_Awards.pdf |
| CDLAC 2025 round 1 | https://www.treasurer.ca.gov/sites/default/files/2026-03/04_Qualified_Residential_Rental_Projects_Round%20_1_Final_List_of_Awards.pdf |
| CDLAC 2025 round 2 | https://www.treasurer.ca.gov/sites/default/files/cdlac/04_Qualified_Residential_Rental_Projects_Round_2_Final_List_of_Awards.pdf |
| CDLAC 2025 round 3 | https://www.treasurer.ca.gov/sites/default/files/cdlac/06_QRRP_Round_3_Final_List_of_Awards.pdf |
| CTCAC *List of Projects*, sheet "San Francisco" | https://www.treasurer.ca.gov/sites/default/files/ctcac/List%20of%20Projects_1.xlsx |

The rule for each field, so no row needs a judgement:

- `year`: the CDLAC list's programme year; for a 9% row, the year in its CTCAC application number.
- `application`: the CDLAC application number as printed (for example `CA-24-535`, `24-737`, `25-446`); for a 9% row, the CTCAC number (`CA-2024-003`).
- `credit`: `'4%'` for a CDLAC row, `'9%'` for a CTCAC 9% row.
- `homes`: the CDLAC list's "Total Units". The 2024 round 1 list prints no unit column, so its three rows, and the 9% rows, take "Total Units" from the CTCAC workbook's row for the same project. Where both sources give units, they agree on every row below (checked 2026-11-09).
- `newConstruction`: true exactly when the CTCAC workbook's "Construction Type" is "New Construction" (the CDLAC lists do not print it).
- `cite`: the list's URL; `page` is the application number, the row's locator in a list without printed page numbers.

The rows (verified 2026-11-09, tier 0):

| year | application | project | credit | new | homes | source of homes |
| --- | --- | --- | --- | --- | --- | --- |
| 2024 | CA-24-535 | Casa Adelante | 4% | yes | 168 | CTCAC CA-2024-535 |
| 2024 | CA-24-494 | Sutter Street | 4% | yes | 102 | CTCAC CA-2024-494 |
| 2024 | CA-24-490 | Golden Gate Avenue Phase 1 LIHTC | 4% | yes | 55 | CTCAC CA-2024-490 |
| 2024 | 24-737 | Larkin Pine Senior Housing | 4% | no | 63 | CDLAC 2024 round 2 |
| 2024 | 24-670 | Balboa Reservoir - Building E | 4% | yes | 128 | CDLAC 2024 round 2 |
| 2024 | 24-653 | 850 Turk Street | 4% | yes | 92 | CDLAC 2024 round 2 |
| 2024 | 24-686 | Sunnydale HOPE SF Block 9 | 4% | yes | 95 | CDLAC 2024 round 2 |
| 2024 | 24-719 | Sunnydale HOPE SF Block 7 | 4% | yes | 89 | CDLAC 2024 round 2 |
| 2024 | 24-767 | 160 Freelon | 4% | yes | 85 | CDLAC 2024 round 2 |
| 2024 | 24-745 | 300 De Haro | 4% | yes | 425 | CDLAC 2024 round 2 |
| 2024 | CA-2024-003 | 3300 Mission Street | 9% | yes | 35 | CTCAC |
| 2024 | CA-2024-087 | Sierra Madre Apartments | 9% | no | 47 | CTCAC |
| 2025 | 25-446 | 967 Mission | 4% | yes | 95 | CDLAC 2025 round 1 |
| 2025 | 25-634 | 2970 16th Street | 4% | yes | 136 | CDLAC 2025 round 2 |
| 2025 | 25-600 | Balboa Reservoir - Building A | 4% | yes | 159 | CDLAC 2025 round 2 |
| 2025 | 25-646 | 960 Howard Street | 4% | yes | 202 | CDLAC 2025 round 2 |
| 2025 | 25-809 | 1687 Market Residences | 4% | yes | 94 | CDLAC 2025 round 3 |
| 2025 | 25-796 | Golden Gate Apartments | 4% | no | 72 | CDLAC 2025 round 3 |
| 2025 | CA-2025-097 | 125 Mason Street Apartments | 9% | no | 81 | CTCAC |

Expected sums, which the funding test asserts on the live file: new construction 2024 = 1,274 (the nine 4% rows, 1,239, plus 3300 Mission, 35); new construction 2025 = 686; all rows 2024 = 1,384 and 2025 = 839. Sierra Madre Apartments (`CA-2024-087`, a 9% rehabilitation) was missing from the earlier draft; it does not change `observedHomesPerYear`.

**Texts the file carries** (`note` for each City source, `method` for the state and federal pools; each is repeated in its pool's provenance). Every City source has a `note`:

- `city-debt`: "General-obligation bonds and other debt, FY2024-25 (p. 43). It includes the 2016 Preservation and Seismic Safety (PASS) bond, which funds preservation, not new building (p. 43), and commercial paper and certificates of participation, with no split given. Future bonds 'will require periodic City authorization and voter approval' (p. 72). Held level (OD-F3)."
- `city-ocoh`: "Our City, Our Home Fund, approved by voters in 2018; it funds affordable housing and three service areas for people experiencing homelessness (p. 44). Held level (OD-F3)."
- `city-general-fund`: "General Fund, from unrestricted tax revenue (p. 44). It includes $14.9 million from the Housing Stability Fund (Proposition I, 2020), spent down by February 2026 (p. 100), and $14.5 million work-ordered from the Department of Homelessness and Supportive Housing for homeless housing (p. 44). Held level (OD-F3)."
- `city-impact-fees`: "Affordable-housing impact fees: a fee, not a tax (classed with dedicated revenue because no fee kind exists). FY2024-25 spending was 'spending from prior year fee collections and loan repayments' (p. 44), while fee revenue was $422,048 in FY2024-25 against an $18.0 million average (Exhibit I, p. 9). Held level (OD-F3)."
- `city-housing-trust-fund`: "Housing Trust Fund, a charter baseline approved in 2012 (Proposition C) and running to 2043, about $52 million a year in all, of which $27.4 million went to multifamily housing in FY2024-25 (p. 44). Held level (OD-F3)."
- `city-redevelopment`: "Former Redevelopment Agency housing assets (the Low- and Moderate-Income Housing Asset Fund, p. 44); 'that source has now been spent down' (p. 73). Held level (OD-F3)."
- `state.method`: "HCD and CalHFA programmes 'have provided more than $1.2 billion in funding for affordable housing in San Francisco since 2018, according to MOHCD staff' (p. 42). Spread over the eight calendar years 2018 to 2025: $150 million a year. 'More than' makes this a lower bound. FY2024-25 dollars, not adjusted."
- `federal.method`: "Federal low-income housing tax credits pay $443,108 of an affordable home (Exhibit F, p. 7). The pool has no ceiling: no ceiling binds San Francisco in the 2026 award records, and none is published for the City."

The six City sources are held level per OD-F3 (see Open question 1).

### 4.6 `calibration.baselineFunding`

`baselineFunding(file, mohcdRows, asOf, profile)` lives in `pipeline/lib/fzp-cal/funding.ts` and is called in `calibrate`. `CalInput` (`calibrate.ts:46-55`) gains `funding: FundingFile` and `mohcd: RawRow[]`. `writeCalibration` (`pipeline/steps/calibration.ts:88-160`) reads them through new options `fundingPath`, `lock`, `rawDir` and `byName`, passed from `build`. The step's double computation for V29 covers them unchanged.

**Pools**, in this order: the six City sources in Exhibit E order, then `state`, then `federal-tax-credits`.

| Pool | `kind` | `inflows` | `uncapped` | `debt` | `leverage` |
| --- | --- | --- | --- | --- | --- |
| City | from the file | `[{ kind: 'yearly', from: asOf, to: null, dollarsPerYear }]` | false | from the file | 1 |
| `state` | `'state'` | `[{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 150000000 }]` | false | null | 1 |
| `federal-tax-credits` | `'federal'` | `[]` | true | null | 1 |

**First inflow on `asOf`.** The first inflow arrives on `asOf` and then each anniversary. Reason: the run starts on `asOf`, and a fiscal-year date (1 July) would leave the City pools empty for up to a year after the start, an artefact no record supports. The file carries no dates; `asOf` is the build's (`calibrate.ts:103`).

**Programmes**: one per pool, in pool order.

| Field | Value |
| --- | --- |
| `id` | `baseline-<pool id>` |
| `label` | `<pool label>: grant toward an affordable home` |
| `pool` | the pool id |
| `reach` | `'affordable'` |
| `instrument` | `{ kind: 'grant', share }` |
| `from` | `asOf` |
| `to` | null |
| `minHomes` | from MOHCD, below |
| `tiers` | from MOHCD, below |

**Shares.** Dollars per home for each programme:

- a City pool: `perHome.city × source.dollarsPerYear ÷ city.total` (its slice of the City's $300,027);
- `state`: `perHome.state`;
- federal: `perHome.federal`.

The eight values are passed together to `roundShares`, which divides by their total, `perHome.city + perHome.state + perHome.federal` = 861,525 = `uncoveredPerHome('affordable')`. The shares therefore sum to exactly 1,000,000 millionths. The step asserts that total equals `uncoveredPerHome('affordable', ·)` before rounding.

Expected live shares:

| Programme | Share |
| --- | --- |
| `baseline-city-debt` | 0.119804 |
| `baseline-city-ocoh` | 0.072329 |
| `baseline-city-general-fund` | 0.054619 |
| `baseline-city-impact-fees` | 0.051791 |
| `baseline-city-housing-trust-fund` | 0.040778 |
| `baseline-city-redevelopment` | 0.00893 |
| `baseline-state` | 0.137419 |
| `baseline-federal-tax-credits` | 0.51433 |

These are tier 1 and tier 2 arithmetic, computed here. Their floating-point sum may fall a hair below 1; F8's `isCertain` (coverage at least 1 − 10⁻⁹, a floating-point tolerance, not a model number) makes a project with the whole baseline certain all the same.

**Tiers and `minHomes` (MOHCD).**

*Rows used.* The rows used are those with `general_housing_program = 'MOHCD 100% Affordable (New Development)'` and `project_type = 'New Construction'`. This is the City's own 100% affordable new building, which is what the baseline programmes fund. Inclusionary rows are private projects' below-market homes and are left out, and so are rehabilitation rows.

*Band to tier.* Each AMI band is a ceiling, so it is mapped by its upper bound against California's income categories:

| AMI bands | Tier |
| --- | --- |
| `_20_ami`, `_30_ami`, `_40_ami`, `_50_ami` | `veryLow` |
| `_55_ami`, `_60_ami`, `_80_ami` | `low` |
| `_90_ami`, `_100_ami`, `_105_ami`, `_110_ami`, `_120_ami` | `moderate` |
| `_130_ami`, `_150_ami` | `aboveModerate` |

`tiers` is the four sums divided by their total, rounded with `roundShares`. `ami_undeclared` homes are left out of the mix, and the observation rule `sc.funding.ami-undeclared` counts them. The mapping is a definition (Health and Safety Code categories), the counts are tier 0, and the provenance says MOHCD's AMI is the City's published AMI table, not the state's income limits (inferred, stated).

*`minHomes`.* `minHomes` is the nearest-rank 10th percentile of `total_project_units` over the same rows: the value at sorted index `ceil(0.1 × n) − 1`, with a row with 0 or blank homes left out. Reason: the programme's floor is the size below which the City rarely builds a funded project. The drawn size it is compared with (F9 (b)) is total homes.

*Expected live values* (query of 2026-11-09, n = 45): `tiers` veryLow 0.483439, low 0.433384, moderate 0.076402, aboveModerate 0.006775 (the one-millionth residual goes to the largest, very low); `minHomes` 70; 1,023 homes undeclared.

*Failure.* No qualifying row with a band-coded home is a `BuildError`: `funding: no MOHCD 100% affordable new-construction rows with income bands`.

**Check.**

- `impliedHomesPerYear`: over the capped pools with `share > 0`, the minimum of `dollarsPerYear ÷ (share × 861,525)`, rounded to the nearest integer (half up). Every City pool gives about the same quotient by construction (after 6-decimal rounding of the shares they differ in the fourth significant digit, all about 779.9), about 780; the state gives about 1,267. So the City binds. Expected 780.
- `observedHomesPerYear`: the sum of `homes` over award rows with `newConstruction: true`, divided by the number of `awards.years`, rounded half up. Expected (1,274 + 686) ÷ 2 = 980.
- **Warning** when `|implied − observed| > 0.5 × observed`: `baselineFunding: the capped pools fully fund <i> affordable homes a year; the <y0>–<y1> bond and tax-credit awards show <o> (new construction); they differ by more than half`. The warning goes into `CalOutput.warnings` and the report. It is never a failure. Expected: no warning (780 against 980, ratio 0.80).
- `check.provenance`: tier 2; `label` "Homes a year the baseline funding pays for, against award records"; `method` states both formulas, the years, the number of award rows, and that award homes are total units (managers' homes included).

**Provenance list.** `baselineFunding.provenance` has `pools.length + 1` entries:

- One per pool, in pool order. A City pool's entry is tier 1. Its label is `"<label>: <$M> a year, FY2024-25 (held level)"`, its method states Exhibit E, the share arithmetic, the inflow dates, and the pool's note, and its sources are the BLA report URL with "p. 6, Exhibit E; p. 7, Exhibit F".
- The state entry is tier 2 and states the $1.2 billion ÷ 8 years arithmetic and the lower bound.
- The federal entry is tier 2 and states "uncapped: no ceiling binds San Francisco in the 2026 award records".
- The last entry describes the programmes' `tiers` and `minHomes`: tier 0, sources the `aaxw-2cb8` homepage, `n` the row count, and window `['2023-09-30', '2023-09-30']` (the snapshot date).

**Rounding.** Dollars are whole numbers as transcribed. Shares are 6 decimals (millionths). `tiers` are 6 decimals. `minHomes` and the two homes-a-year values are integers. Dollars are taken as constant dollars of the `asOf` year without adjustment (inflation is out of scope); the methods say "FY2024-25 dollars, not adjusted".

**Fixture mode** (`cal.name === 'fixture'`). `funding.json` is the fixture twin, with the same schema:

- `perHome` equals the live one (so `AFFORDABLE` agrees);
- the live ids and kinds (the six City sources, `state` and `federal-tax-credits`), so e2e tests and stored fixture policies name the same pools as the live site;
- city sources of 1,500,000, 1,200,000, 1,000,000, 1,000,000, 800,000 and 500,000 in Exhibit E order (total 6,000,000; tier 4, invented);
- state 3,000,000 (tier 4, invented);
- two award rows, both 4% new construction (2024, application `FIXTURE-1`, 20 homes; 2025, `FIXTURE-2`, 30 homes; tier 4, invented);
- every `cite.label` beginning "Fixture:".

MOHCD rows come from the fixture's raw page (section 6): two 100% affordable new-construction rows of 2 and 6 homes, so the fixture's `minHomes` is 2 (nearest-rank 10th percentile of [2, 6], index `ceil(0.2) − 1 = 0`) and the baseline programmes reach the mini city's lots, whose largest yield is 11 homes (`pipeline/test/fixtures/mini/golden/scenarios/fzp/parcels.decoded.json`). Their band counts give `tiers` veryLow 0.428572, low 0.428571, moderate 0.142857, aboveModerate 0 (3, 3 and 1 of 7 declared homes; the one-millionth residual goes to the first largest, very low, `round.ts:16-23`) and one undeclared home of 8 (12.5%, below the rule's 0.25 warning). All tier 4, invented. In a fixture build every `baselineFunding` provenance entry, and `check.provenance`, is tier 4, with the label prefixed `"Fixture (tier 4): "`. These are the design's "fixture baseline funding, labelled tier 4".

**The fixture's funding shape**, which `funding-ui` and its e2e tests need: at least one City pool (six), the capped `state` pool and the uncapped `federal` pool, each with exactly one grant programme reaching `affordable`, the shares summing to 1,000,000 millionths, and a `market` model in the same `calibration.json` (`market-baseline`'s fixture market, "Fixture profile" in its section 4.4, tier 4). With both keys present, `buildSimInput` sets `finance` on `fixture-0` from Release 2 (F9). `finance-engine` checks that a seed-1 run of `fixture-0` makes at least one funded start (fidelity decision FD-3). Expected fixture check: `impliedHomesPerYear` 20 (every City pool gives 6,000,000 ÷ 300,027 ≈ 20.0; the state 3,000,000 ÷ 118,390 ≈ 25.3), `observedHomesPerYear` 25 ((20 + 30) ÷ 2), no warning; tier 4, computed from the invented values above.

**Validation in `parseCalibration`**, when `baselineFunding` is present. Each failure uses the existing `fail(path, 'expected …')` form:

- `pools`:
  - non-empty;
  - ids unique and matching `^[a-z0-9][a-z0-9-]{0,39}$` (F12), and not starting `u-` (`expected a baseline id not starting u-, got <x>`);
  - `kind` a `PoolKind`;
  - `label` non-empty;
  - each inflow well-formed (`once`: integer `day`, integer `dollars ≥ 0`; `yearly`: integer `from`, `to` null or an integer ≥ `from`, integer `dollarsPerYear ≥ 0`);
  - `uncapped` implies `inflows` is empty;
  - `debt` is non-null exactly for `goBond` and `cop`, with `rate` above 0 and at most 0.25 and `termYears` a whole number from 1 to 40 (F5: the bounds `debtService` shares);
  - `leverage` finite and > 0, and equal to 1 unless `kind` is `bank`.
- `programmes`:
  - ids unique, matching the same pattern, and not starting `u-`;
  - `pool` names a pool: `expected a pool id, got <x>`;
  - `reach` a `ProjectKind`;
  - the instrument accepted by `finance-model`'s `validateInstrument` (F6: the one check every validator calls), imported by relative path from `src/lib/sim/finance/`; its rejection text is used as the message;
  - `from` an integer, `to` null or ≥ `from`;
  - `minHomes` a whole number from 0 to 10,000 (F6);
  - `tiers` required and summing to 1 (`checkSumsToOne`, `model.ts:541`) when `reach` is `'affordable'`, and null otherwise.
- baseline only: every instrument is a `grant` (F12: "one grant programme per pool"): `expected a grant, got <kind>`.
- `provenance`: length `pools.length + 1` (F12's order: one per pool in `pools` order, then one for the programmes' `tiers` and `minHomes`), each passing `checkProvenance`.
- `check`: the two counts are non-negative integers; the provenance is valid.

The pool and programme checks are exported as `checkPool(v, path)` and `checkProgramme(v, path, poolIds)` from `src/lib/timelapse/model.ts`. `finance-levers` reuses `checkPool` for added pools; `checkProgramme` is used for the baseline only, because `finance-levers` validates added programmes in its own parser (its spec), with the same `validateInstrument`. They check what the rows state for every pool and programme: shape, the id pattern, the debt bounds of F5 (those of `debtService`), the `minHomes` bound of F6 and the instrument through `validateInstrument`, and the pool rules of F5. They do not check the id prefix (baseline ids never start `u-`, added ids always do), the grant-only rule, or `finance-levers`'s limits (F7: 12 inflows a pool and the counts); each caller adds those.

### 4.7 Report section 12: publicly funded housing (routes, stages, baseline funding)

Heading: `## 12. Publicly funded housing: routes, stages and baseline funding`. Section 11 is `market-baseline`'s and is already in place when this spec is built (design, "Dependency order"). `REPORT_SECTIONS` (`pipeline/lib/fzp-cal/report.ts:79-90`) gains these two headings after section 11's, and `calibrationReport` (`report.ts:737-751`) appends `fundedSection(x)` and `siteChoiceSection(x)` after the section 11 content. Each adds its own entries to `provenanceIndex` (`report.ts:574`), after `market-baseline`'s.

**Groups.** Qualifying, normalised histories whose pair is non-null with `units ≥ 10` and `affordable` non-null, and whose first record lies in `[PLANNING_START, asOf]`, split by the pair (`u` its units, `a` its affordable homes):

| Group | Test |
| --- | --- |
| 100% affordable | flagged (the cohort) |
| Some affordable | `0 < a`, not flagged |
| None | `a = 0` |

Histories with no pair, or with blank or zero units or a blank affordable count, are left out of the stage table, and the section prints how many.

**Contents, in order:**

1. **The `affordableRoutes` line**: shares, tier, `n`, and "fallback" when it fell back.
2. **Pathway table**: counts per group, discretionary / streamlined / permitOnly / null.
3. **Stage table.** For each stage `filed`, `entitled`, `permitFiled`, `permitIssued` and `construction`, and each group, computed on the calibration's own spells (`buildSpells` output, the purge-censored, window-cut, no-FCD-weighted spells the transition tables are fitted on, `calibrate.ts:109`), filtered by `projectId` to the group and pooled over pathways:
   - spells;
   - observed advances and exits;
   - Aalen–Johansen eventual advance and eventual exit (`ajEnd`, `report.ts:128-145`);
   - median months to advance: the smallest event duration at which the advance cumulative incidence reaches half its end value, divided by `MONTH_DAYS` (`src/lib/timelapse/time.ts:10`), printed by `num`.

   A cell with no spells prints "none". These are the transition tables' estimator (left truncation, censoring, competing exits) on the same spells, without the fallback ladder and tail, because the comparison is descriptive. The section says so in one line.
4. **Baseline funding table**: per programme, in pool order, its fill tier (section 4.5), the pool id, kind, dollars a year (or "uncapped"), programme share, and implied homes a year. One line under it says: "Grants fill a project's uncovered cost in three tiers: federal, then state, then the City's pools in proportion to their shares; with the whole baseline and nothing added, every grant pays its full share." Then `tiers`, `minHomes`, MOHCD rows used, and undeclared homes; then `check` and, when it warns, the warning text verbatim.

No number in this section is shipped except those already in `calibration.json`.

### 4.8 Report section 13: where publicly funded housing starts (OD-F9b)

Heading: `## 13. Where publicly funded housing starts`.

`siteChoice(panel, model, norm, lotArea)` lives in `pipeline/lib/fzp-cal/affordable.ts`.

**Events.** For each history in the cohort (the 100% affordable group of section 4.7), and in the "private" group: every qualifying history that is not flagged, of any size, with or without a pair. This is `market-baseline`'s meaning of a private start (its section 4.1, "Counting": a start is private unless flagged), so the two sections compare the same populations. A flagged history under 10 homes is in neither group, and the section prints how many there are.

- the start is the history's first entered day among preApplication, filed and permitFiled (`firstEntered`, `pipeline/lib/fzp-cal/panel.ts:99`, exported);
- the start must lie in 2015-01 to 2025-12, the record-basis months of the panel;
- the lot is `primaryParcel(parcelIds, lotArea)` (`panel.ts:109`, exported);
- the roll year is the UTC year of the start (months of year Y use roll Y, `panel.ts:230-233`).

**Hazard.** The panel row of that lot and roll year is read through `PanelSource.read`, one roll year at a time and only for years with events. The hazard is `initiationHazard(calibration.initiation, row.features)` (`src/lib/timelapse/model.ts:394-398`), the published, basis-0 model the simulation uses. A start whose lot has no row, or whose row has `hostableBase` false, is counted as "off panel" and left out.

**Printed, per group:**

- histories;
- starts on the panel;
- off panel;
- mean monthly hazard and median monthly hazard, each × 1,000.

Then the ratio: mean (100% affordable) ÷ mean (private). Then one fixed sentence: "A ratio near 1 means funded projects started on lots like those private projects chose (the draw of F9 (d)); well above 1 means they took the likeliest lots; well below 1, lots private projects pass over. No San Francisco estimate of displacement exists." With no event in either group, the ratio prints "none".

The section is report-only and never shipped. Its off-panel count matters: City-owned sites can be non-hostable under the base zoning, and the count shows how often.

### 4.9 Data-quality rules

All three are registered with the existing defaults unless stated. `npm run pipeline -- quality-doc` regenerates the section of `docs/dev/pipeline.md`.

| id | owner | source | field | kind | action | tier | valueTier | label | denominator | shares |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pr.affordable.over-units` | project-records | datasf-planning-projects | affordableHomes | bound | replace | 2 | 0 | "A project's proposed affordable homes were capped at its homes" | in-flight projects with a recorded affordable count | warn 0.01, fail 0.10 |
| `pr.rhna.tier-unrecorded` | project-records | datasf-housing-production | byTier | missing | none | 2 | null | "Completed affordable homes whose income tier the records do not give were counted as tier not recorded" | counted housing-production rows with affordable homes | warn 0.05, fail 0.10 (the `missing` defaults) |
| `sc.funding.ami-undeclared` | stage-calibration | datasf-mohcd-pipeline | tiers | missing | none | 2 | null | "Affordable homes with no income band were left out of the baseline programmes' income mix" | affordable homes in the rows used; `unitsWeighted: false` | warn 0.25, fail 0.50 (departure: about 16% of these homes are undeclared today, almost all in pre-construction projects; a mix from three quarters of the homes is still the best available) |

**Tallies.** The third rule extends `SC_RULE_IDS` (`pipeline/lib/fzp-cal/types.ts:27`) and `Tallies` with one entry. The calibration step records it like the other `sc.*` rules (`pipeline/steps/calibration.ts:134`).

**Owner.** `pr.affordable.over-units` appears in a project's `quality`, so `projects.json` `qualityRules` lists it whenever it fires.

### 4.10 Invariants

No new invariant number is introduced: these are extensions of existing checks, so nothing collides with the numbers `market-baseline` adds before this spec.

- **V20**: the `affordableHomes` and `byTier` validation of sections 4.2 and 4.3, through `parseProjectsFile`.
- **V22**: `byTier` sums to `units`.
- **V25**: the `affordableRoutes` and `baselineFunding` validation of sections 4.4 and 4.6, through `parseCalibration`, plus three build-side checks the validator cannot see:
  - every pool has exactly one programme (`baseline-<id>`), in pool order;
  - shares sum to 1,000,000 millionths;
  - a live build has `affordableRoutes.provenance.tier === 0` *or* a warning naming the fallback.

  The detail lists the three outcomes.

`funding.json` failures are `BuildError`s before any step runs, as `multiphase.json`'s are. `docs/dev/pipeline.md` "Invariants" is updated to describe the additions to V20, V22 and V25.

## 5. Seams

- **Market scenarios and a market control (R7).** Nothing in this spec reads the market. The baseline pools carry dated `Inflow`s and `funding.json` has a `schema` number, so a later package can add dated funding changes (the OD-F3 presets) as data. This spec ships none.
- **The pipeline and drop-out (R1, R8).** `affordableHomes` ships on every pipeline project, so a later package that reaches the pipeline can identify its publicly funded projects without a new dataset field. The report's stage table (section 4.7) is the evidence such a package would need on drop-out by funding. This spec feeds nothing from it into the engine: `affordableRoutes` is the only shipped cohort parameter, and it is used only for certain projects (F9 (j)).
- **A rent model (R4).** The MOHCD band counts are printed in section 12 per band (all 14 bands plus undeclared), not only per tier, so a later rent model can see the band structure. Nothing per band is shipped.

## 6. Testing

Every test calls `expect`. Fixtures are named.

**Pipeline (`npm run test:pipeline`)**, colocated under `pipeline/test/` as the existing tests are:

1. `project-records/parse.test.ts`: a housing row with all four tier columns parses to `tiers`; one blank tier column gives `tiers: null`; `affordable_units` parses. Fixture: `derive-input.ts` rows extended with tier columns.
2. `project-records/rhna.test.ts`:
   - a known-tier row splits as stated;
   - a row with `a > n` is scaled by largest remainder (rows: n = 3, tiers 2/2/0/0 gives 2/1/0/0 and above moderate 0);
   - a blank-tier row with `affordable_units` 2 and n 5 gives `unrecorded` 2 and above moderate 3;
   - a demolition (n = −1) gives above moderate −1, and so does a row with n = −1 whose tier columns hold 1 very low (rule 0 comes first);
   - a row with n = 0 and tier columns 2/0/0/0 adds nothing to any tier;
   - the five values sum to `units` on a mixed list.
3. `project-records/derive.test.ts`:
   - `affordableHomes` from the primary record and not from a satellite;
   - clamped to `units`, with `pr.affordable.over-units` in `quality` and in `qualityRules`;
   - null on a split part, a `multiPhase` master, a `BP:` project and a `PPA:` project;
   - 0 stays 0.
4. `lib/fzp-cal/affordable.test.ts` (histories built with `market-baseline`'s history field):
   - the cohort boundary, through `market-baseline`'s predicate: units 100 with affordable 95 is in, 94 is out, units 9 with affordable 9 is out (flagged, but under 10 homes);
   - a split part whose PRJ's pair is flagged counts once in the cohort, beside its sibling part;
   - `affordableRoutes` with 30 cohort histories (tier 0, shares from counts) and with 29 (tier 4, `pathwayForNew`'s shares copied);
   - the stage table on hand spells against a hand-computed Aalen–Johansen value; a history with no pair is left out and counted;
   - `siteChoice` with a fake `PanelSource` (two roll years, a non-hostable row counted off panel, the ratio of two known hazards); a history with no pair falls in the private group; a flagged 8-home history falls in neither.
5. `lib/fzp-cal/funding.test.ts`:
   - the live-shaped file gives the eight expected shares and they sum to 1,000,000 millionths;
   - the pool ids are exactly the eight of section 4.5, in that order, with the kinds of section 4.5; the programme ids are `baseline-<pool id>` in the same order; all sixteen match `^[a-z0-9][a-z0-9-]{0,39}$` and none starts `u-`;
   - mapping each programme's pool kind to F8's tiers gives the tier table of section 4.5 (federal, state, and the six City pools in tier 3);
   - `debt` only on `city-debt`;
   - inflows start at `asOf`;
   - the federal pool is uncapped with no inflows;
   - `impliedHomesPerYear` 780 and `observedHomesPerYear` 980 on the live-shaped values;
   - the warning fires at observed 500 (implied 780 differs from 500 by more than 250) and not at 600;
   - the band mapping (one row per band);
   - nearest-rank p10 (n = 45 gives index 4; the fixture's [2, 6] gives 2);
   - the live file's award rows are the 19 rows of section 4.5, with new-construction sums 1,274 (2024) and 686 (2025) and all-row sums 1,384 and 839;
   - the fixture's MOHCD rows give `tiers` 0.428572 / 0.428571 / 0.142857 / 0 and `minHomes` 2, and the inclusionary row is left out;
   - the six City sources and both outside pools carry their `note` or `method` text of section 4.5 in their provenance;
   - a live-mode fallback of `affordableRoutes` adds the warning of section 4.4, and a fixture-mode fallback does not;
   - no qualifying rows gives a `BuildError`;
   - `perHome` against `AFFORDABLE` throws on a one-dollar difference;
   - fixture mode labels every provenance tier 4;
   - the fixture file gives six City pools, the capped `state` pool and the uncapped `federal` pool, one grant programme each reaching `affordable`, shares summing to 1,000,000 millionths, `impliedHomesPerYear` 20, `observedHomesPerYear` 25 and no warning.
6. `enrichment/funding-schema.test.ts`: the live file parses with `retiredIds` empty; each refinement of section 4.5 rejects with its message, including a 32-character id, an id starting `u-`, an id with a capital letter, and a current id that is also in `retiredIds`.
7. `golden.test.ts` (existing), with the regenerated goldens below.

**Server Vitest** (pure TypeScript in `src/`):

1. `src/lib/timelapse/model.spec.ts`:
   - `parseCalibration` accepts a calibration without the new keys;
   - it accepts the fixture's with them;
   - it accepts a calibration with `baselineFunding` and no `market` (whether `finance` is then set is `buildSimInput`'s rule, F9, not the validator's);
   - it rejects, with the stated paths and messages: a pool with `debt` on `generalRevenue`, an uncapped pool with inflows, a pool id `u-city`, a pool id `City-debt`, a programme naming an unknown pool, a baseline programme with a loan instrument, `affordable` reach with null `tiers`, tiers summing to 0.9, a `provenance` list of the wrong length, and `affordableRoutes` not summing to 1;
   - `checkPool` and `checkProgramme` alone accept an id `u-bond` (the prefix is the caller's rule), a loan that `validateInstrument` accepts and `minHomes` 0; they reject what `validateInstrument` rejects (for example `requiredReturn` 0.30) with its text, `minHomes` 10,001, a debt `rate` of 0.26 and a `termYears` of 41 (F5, F6).
2. `src/lib/timelapse/projects.spec.ts`:
   - `affordableHomes` absent is accepted, null is accepted, `units + 1` is rejected, −1 is rejected;
   - `byTier` absent is accepted, and a sum off by one is rejected.
3. The model golden (`model.golden.shared.ts`) and the engine golden (`simulate.golden.shared.ts`) pass **unchanged**, proving the new fields are optional for their consumers.

**Client and e2e.** This subsystem has no component and no page; nothing is shown in Release 1. The existing e2e suite runs on the regenerated `fixture-0` and must pass unchanged. No accessibility test is added, because no page changes.

**Goldens and fixtures that change**, at Release 1 only, regenerated at the release on the Release 1 branch (design, "How a release is built"):

1. `pipeline/test/fixtures/mini/projects-raw.ts` changes:
   - the housing-production rows gain tier columns: form 2 (+3) gets `very_low_income: '1'`, `affordable_units: '1'`, the others `'0'`; form 3 (+2) gets zeros; one row has a blank `low_income` to exercise `unrecorded`;
   - a new `datasf-mohcd-pipeline` list of three rows: two 'MOHCD 100% Affordable (New Development)' 'New Construction' rows, and one 'Inclusionary Housing' row of 10 homes (`_80_ami` 10) that must be left out. The first has `total_project_units` and `mohcd_affordable_units` 2, with `_30_ami` 1 and `_60_ami` 1; the second has 6 and 6, with `_50_ami` 2, `_80_ami` 2, `_120_ami` 1 and `ami_undeclared` 1. Every other band is 0. Tier 4, invented; values in section 4.6, "Fixture mode".

   `pipeline/test/fixtures/mini/enrichment/funding.json` is added. `npx tsx pipeline/test/fixtures/mini/make-fixture.ts` regenerates `raw/` and the mini `sources.lock.json`.
2. `npm run pipeline -- fixture --update-golden`, run once on the Release 1 branch after every Release 1 subsystem has merged into it, regenerates under `pipeline/test/fixtures/mini/golden/`:
   - `scenarios/fzp/projects.json` (`affordableHomes`, `byTier`, provenance text);
   - `scenarios/fzp/calibration.json` (two keys, after `market`);
   - `derived/calibration-report.md` (sections 12 and 13, after section 11);
   - `manifest.json` (the new source);
   - `report.json` (counts and quality rows).

   It also regenerates `e2e/fixtures/data/fixture-0/`. `derived/project-histories.json` does not change from this spec (the history field is `market-baseline`'s). The lesscars goldens do not change from this spec, because nothing on that path reads the new fields before Release 2; they change in Release 1 only with `market-baseline`. The regeneration is reviewed as the one Release 1 data change. This subsystem's change is expected to move exactly the files listed in this item and `fixture-0`.
3. `src/lib/sim/scenario/fixtures/golden-seed1.json`, `src/lib/timelapse/fixtures/model-golden.json` and the hand fixtures `src/lib/sim/scenario/fixtures/mini-projects.ts` and `src/lib/fzp/fixtures/projects.ts` do **not** change.

**Dataset.** `pipeline/` and `src/lib/timelapse` are hashed, so this change needs a dataset build and upload ([pipeline.md](../../dev/pipeline.md), "Finishing a branch that changes the dataset"). This branch merges into the Release 1 branch when its own tests pass, with no upload and no signoff of its own; the Release 1 branch builds and uploads the dataset once, from the refreshed lock of section 4.1, carrying `market` and this spec's keys together, and signs off once (design, "How a release is built").

## 7. Acceptance criteria

1. A live `projects.json` has `affordableHomes` on every project, null exactly for split parts, multi-phase masters and projects with no primary Planning record, and never above `units`. (F12; section 4.2)
2. `rhnaCompletedNet.byTier` exists, its five values sum to `units`, and V22 checks it. (F12, F1 `TierUnits`)
3. `pipeline/sources.lock.json` has `datasf-mohcd-pipeline` with licence `PDDL-1.0`, and `/attribution` lists "DataSF MOHCD Affordable Housing Pipeline". (F12; global constraint "Open data only")
4. `asOf` is unchanged by fetching `datasf-mohcd-pipeline` alone. (Section 4.1)
5. `calibration.affordableRoutes` sums to 1 and is tier 0 on the live build, or tier 4 with `pathwayForNew`'s shares when fewer than 30 cohort histories exist. Its cohort is the histories `market-baseline`'s flag marks, of 10 homes or more; this spec contains no second copy of the 95% test. (F12, R6; design, "Dependency order")
6. `calibration.baselineFunding` holds six City pools in Exhibit E order with the kinds of section 4.5, one `state` pool, and one uncapped `federal` pool. It also holds one grant programme per pool, in pool order, with `reach: 'affordable'`, shares summing to 1,000,000 millionths, the MOHCD `tiers` and `minHomes`, and a provenance entry per pool plus one, in F12's order. (F12, F5, F6, R9)
7. Every baseline pool and programme id matches `^[a-z0-9][a-z0-9-]{0,39}$`, none starts `u-`, and the live ids are the eight pool ids of section 4.5 and their `baseline-` programmes; a test fails if any is renamed. (F12, F7)
8. Each baseline pool's kind places it in the F8 tier of section 4.5's table (`federal-tax-credits` federal, `state` state, the six City pools City), and `docs/dev/finance-data.md` prints it. (F8 `fundBundle`, OD-F10)
9. In `calibration.json` the keys run `…, phaseGap, market, affordableRoutes, baselineFunding`, and the report's sections 12 and 13 follow section 11. (Design, "Dependency order")
10. `fixture-0`'s `calibration.json` has `market` and a `baselineFunding` with six City pools, the capped `state` pool and the uncapped `federal` pool, one programme each, shares summing to 1, and `minHomes` 2, no more than the mini city's largest lot yield (11). (Global constraint "Goldens change only at the two releases"; `funding-ui`'s fixture needs)
11. Every number in `funding.json` carries a citation with a page, and `perHome` equals `AFFORDABLE`. (Global constraint "Evidence hierarchy"; F4)
12. `check` holds `impliedHomesPerYear` and `observedHomesPerYear` by the formulas of section 4.6, and the build warns when they differ by more than half. `awards.rows` is the 19 rows of section 4.5, giving `observedHomesPerYear` 980. (F12)
13. `calibration-report.md` has sections 12 and 13 with the contents of sections 4.7 and 4.8, and V29 holds. (F12, OD-F9b, R10)
14. The fixture build emits `affordableRoutes` (fallback, tier 4) and a fixture `baselineFunding` labelled tier 4. (Global constraint "Goldens change only at the two releases")
15. `golden-seed1.json` and `model-golden.json` are byte-identical before and after. (Same constraint; "No public money means no change")
16. A dataset built before this package still loads: its `projects.json` and `calibration.json` pass the extended validators. (Global constraint "Stored documents keep loading")
17. The three quality rules appear in the generated section of `docs/dev/pipeline.md`. (Data quality conventions)
18. `checkPool` and `checkProgramme` use F5's debt bounds and F6's `minHomes` bound, and call `validateInstrument` for every instrument. (F5, F6)
19. The dataset is built, uploaded and signed off once, on the Release 1 branch, not on this subsystem's branch. (Design, "How a release is built")

## 8. Developer documentation

- **New `docs/dev/finance-data.md`**, linked from `CLAUDE.md`'s scoped list as: "**Finance data (`affordableHomes`, `byTier`, `affordableRoutes`, `baselineFunding`, `funding.json`, the MOHCD source)** — [docs/dev/finance-data.md](docs/dev/finance-data.md)". It must say:
  - what each new field is and where it is computed;
  - the primary-record rule and its nulls;
  - that a recorded 0 may mean "not stated";
  - the tier arithmetic of `byTier` and why above moderate is a remainder;
  - the cohort definition, and that it reuses `market-baseline`'s affordable-cohort flag (link to `docs/dev/market.md`'s account of it) with F12's 10-home floor;
  - the pool and programme table with ids, kinds and shares, and the tier table of section 4.5 with one sentence on what it means (federal, then state, then the City's pools pro rata; with the whole baseline every grant pays its full share);
  - that baseline ids are stable across dataset versions because stored policies name them: never rename one, never reuse one, and move an ended source's id to `retiredIds`;
  - that a `baselineScale` of 0 switches a pool off in the levers (F7) and changes nothing in the data;
  - how to update `funding.json` when the Budget Analyst, CDLAC or CTCAC publish new figures (re-read, cite the page, rebuild, review the check), including the award-row rule of section 4.5 (which lists, which filter, where `homes` and `newConstruction` come from);
  - the meaning of the check warning;
  - how to read report sections 12 and 13;
  - that the three held-level sources (impact fees, redevelopment, debt) are a ruled assumption (OD-F3), not a forecast, and that `city-debt` includes the 2016 PASS preservation bond and `city-general-fund` $14.5 million of homeless housing (p. 43-44), both held level as if they paid for new building.
- **`docs/dev/pipeline.md`**:
  - the new source in the project-records source paragraph (line 9), with the combined `fetch --only` command of section 4.1 and the note that it is not an as-of source;
  - a "Funding enrichment" subsection beside "Multi-phase enrichment";
  - the V20, V22 and V25 additions in "Invariants";
  - the regenerated quality section.

## 9. Open questions

The design leaves these to this subsystem. Builders follow the recommended answer by default.

1. **Held-level sources that the report itself calls one-off.** FY2024-25 impact-fee spending came mostly from balances (revenue $0.4 million, Exhibit I). The redevelopment source "has now been spent down" (p. 73). Bonds need voter approval each time (p. 72). **Recommended:** hold all six at their FY2024-25 amounts, as OD-F3 rules ("funding as the recent records show it, held level"), and state each caveat in its pool's provenance. The user can scale any of them from a date (F7). The implied 780 homes a year sits close to the observed 720 completions a year (design, "What the evidence search settled"), which supports the total even if its parts shift.
2. **The period behind the state's "$1.2 billion since 2018".** **Recommended:** 2018–2025, eight years, $150 million a year, tier 2, labelled a lower bound. The report gives no end year, and its data end in 2025.
3. **Whether `observedHomesPerYear` counts 9% awards.** **Recommended:** yes, new-construction 9% awards count beside the 4% bond awards. Both are tax-credit awards that bring federal money to a new building, and the design names "bond and tax-credit awards".

## 10. Interface concerns

None open.

### Resolved at reconciliation

- Optional new fields (F12: "The four new fields are optional in the types").
- `baselineFunding.provenance` order (F12: "one entry per pool in `pools` order, then one for the programmes' `tiers` and `minHomes`").
- `byTier` rule, losses netted against above moderate and tiers summing to `units` (F12).
- Stable baseline ids and the id pattern (F12; F7 for added ids). A stored policy naming a retired baseline id drops that entry on load with a notice (F15).
- Validation bounds: `checkPool` uses F5's debt bounds (those of `debtService`); `checkProgramme` calls `validateInstrument` and allows `minHomes` 0 to 10,000 (F5, F6). `finance-levers` reuses `checkPool`; `checkProgramme` serves the baseline only.
- The Release 1 fetch and `market-baseline`'s values: the Release 1 dataset is built once, on the release branch, from the refreshed lock, so every Release 1 value is measured on the same lock (design, "How a release is built").
- Rows built against but not embedded: F2 and F8 are now embedded here (design, "Row ownership").
- Certainty tolerance (F8 `isCertain`, 1 − 10⁻⁹).
- A recorded `affordableHomes` of 0 may mean "not stated" (F13; `finance-score`).
- `byTier` is completions, not Exhibit D's permits: `finance-score` labels tier progress "completed since 30 June 2022 (net)" (reconciliation, `finance-score`).
- Report sections and key order (design, "Dependency order": `market-baseline` first, its `market` and section 11; this spec's keys after `market`, sections 12 and 13).
- No change needed: `PoolKind` gains no fee kind (impact fees and former redevelopment assets stay `dedicatedTax`; among the City's pools the kind no longer affects the fill, F8); Exhibit F's unstated sample is stated in the provenance.
