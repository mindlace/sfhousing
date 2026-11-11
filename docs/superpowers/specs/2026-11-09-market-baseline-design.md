# Today's market (`market-baseline`): design spec

Package: `sim-financing` ([composition design](../design/2026-11-09-1911-sim-financing.md), approved 2026-11-09). Research: [financing evidence digest](../research/2026-11-09-financing-evidence.md). This spec ships in **Release 1**, together with `finance-data`. In the build order it runs after `finance-model` (whose prototypes its pipeline code imports) and **before** `finance-data`, not beside it: both extend the calibration step and its report, so they run in sequence (design, "Dependency order", step 1).

Revised on 2026-11-09 to follow the reconciliation of the spec writers' interface concerns: today's levels are measured against the published model (OD-F11), F2's `today` carries `years`, `observed` and `implied`, this spec owns and exports the affordable-cohort flag and adds `src/lib/sim/finance` to the hashed paths, and it states today's market in the results' sources in Release 1.

Terms used throughout:

- **Start** (or initiation): a new project's first record, the event the start model (`calibration.initiation`) predicts. From 2015 it is the first Planning record (record basis); before 2015 the first new-construction permit filing (permit basis) (`pipeline/lib/fzp-cal/panel.ts:98-173`).
- **Panel years**: the calendar years of the initiation panel, 2007 to 2025 (`panel.ts:16-17`, `initiation.ts:43-44`).
- **Recent years**: the last three panel years, 2023 to 2025. F2's `today.years` is `[2023, 2025]`. **Weight years**: the last five panel years, 2021 to 2025 (F2's slope weights).
- **Published model**: the start model fitted on all panel years, the one `calibration.json` ships and the engine runs.
- **Implied starts** of a year: the sum over that year's panel cells of exposure (parcel-months) times the published model's monthly hazard on the engine's basis (basis 0). This is the existing `impliedPerYear` (`pipeline/lib/fzp-cal/initiation.ts:399-402`, using `pub`, `initiation.ts:363`) and the "implied (published hazard)" column of the calibration report's "Plausibility" table.
- **Hold-out model**: the same model refitted on 2007 to 2022 only (`initiation.ts:48`, `HOLD_OUT_LAST_FIT = 2022`; `initiation.ts:409-439`). Its prediction for the recent years is a report-only diagnostic of the cycle and is never applied (F2, OD-F11).
- **Affordable cohort**: projects whose primary Planning record proposes at least 95% affordable homes. **Private start**: any start not in the affordable cohort. The **affordable-cohort flag** is the test that decides it (section 4.1); this spec owns it and `finance-data` reuses it.
- **Market shift**: a number added to every lot's monthly start log-odds.

**Amended on 2026-11-10 (reappraisal 1, after Release 1):** a `market.json` that is not valid JSON fails with a `CalibrationError` that names the file (section 4.4; "Amendment of 2026-11-10" near the end).

## 1. Scope

The design's Subsystems row:

> `market-baseline` | The market shift. Pipeline: compute today's two levels against the published model (all starts; private starts), report the hold-out beside them, transcribe the Controller's coefficient and cost index into a committed enrichment file, emit `calibration.market` with provenance, add it to the calibration report. Engine: piecewise-constant hazard shift over time, composing with the existing dated regimes. Everything that builds a `SimInput` applies today's level. Re-source the Controller references, and state today's market level in the results' sources: the first release moves every number, and the page must say why. Add `src/lib/sim/finance` to the hashed paths. Regenerate the goldens and the fixture; rebuild and publish the dataset. This subsystem ships in the first release.

**In scope**

1. Project histories carry their primary Planning record's proposed homes and proposed affordable homes, and the start panel keeps, for each counted start, its year, cohort, homes and stories.
2. The affordable-cohort flag, owned and exported here (`pipeline/lib/affordable-cohort.ts`, section 4.1). `finance-data` imports it and defines no test of its own.
3. `pipeline/lib/fzp-cal/market.ts`: `today` (`all`, `private`, `years`, `observed`, `implied`) measured against the published model, `crossCheck`, `slope` and their provenance, live and fixture; `calibration.market`, emitted after `phaseGap`; calibration report section 11, "Today's market", which carries the hold-out as a report-only diagnostic and a check that the shifted published model reproduces the recent years; counts and warnings.
4. `pipeline/enrichment/market.json` and its schema: the Controller's two coefficients, the cost index and two price-index period means, with page references.
5. The validation of `Calibration.market?` in `parseCalibration`; `marketSteps`; and `marketLevel` (F3: the one rule for which level runs), shipped returning `'all'`. Step 0 declares `MarketStep`, `MarketModel`, `Calibration.market?` and `SimInput.market?` (design, "Dependency order", item 0); this spec adds their behaviour, not the declarations.
6. The engine's behaviour for `SimInput.market`: per-step hazards in `precomputeOf`, the combined segments in `simulatedPass`, `skipAbove` under steps, input checks.
7. `buildSimInput` applies `marketLevel(calibration)`, which is `'all'` throughout Release 1; every policy operation, the twin and the `/lesscars` build step pass `market` through (tests prove it).
8. `src/lib/sim/finance` added to `PATHS` in `pipeline/lib/version.ts:40-50` (global constraint "The engine is in the dataset version"; this spec's pipeline code is the first to import that directory).
9. Wording: the initiation provenance; **today's market stated in the results' sources** in Release 1 (a paragraph in the Results face's Sources disclosure, built by `marketSentence`, and a `src-market` section in the sources dialog), taken over from `funding-ui`'s section 4.12, because the release that moves every number must say why; the re-sourced Controller references in `score.ts`; the developer docs.
10. Release 1: the goldens and fixture this change moves (section 6), and the acceptance check on `today.all`. The regeneration, the live build, the upload and signoff happen once, at the release, on the Release 1 branch (design, "How a release is built"); this subsystem's branch merges into it with no upload or signoff of its own.

**Out of scope**: market scenarios and a page control (R7); any use of `slope` (no programme exists before `finance-engine`); switching the level to `'private'` (`finance-engine` changes `marketLevel`, Release 2); the private-level wording of the market paragraph, the slope's entry in the sources and the public-money section (`funding-ui`, Release 2); the affordable cohort's routes, its stage report and the baseline funding (`finance-data`, F12); the prototypes and their constants (`finance-model`, F4); shipping any price series (tension 7).

**Hand-offs**

- To `finance-engine`: `SimInput.market` composing with `regimes`, and `slope.perCostShare` in the calibration. It changes `marketLevel` to F3's rule (`'private'` when `buildSimInput` also sets `finance`), which moves the engine and the page's sentence together.
- To `finance-data`: the history field, `startCohort` and `isAffordableCohort` of section 4.1, which its `affordableRoutes`, its cohort report and `projects.json`'s affordable homes reuse. `calibration.market` precedes its keys `affordableRoutes` and `baselineFunding`; report section 11 precedes its sections 12 and 13.
- To `funding-ui`: `marketSentence` and the `src-market` dialog section (section 4.11). In Release 2 `funding-ui` extends them for the private level (its own wording of the private form, the sentence on today's public funding, the slope and its cross-checks). It reads the level through `marketLevel`, never through a rule of its own.

## 2. Interfaces

Rows copied verbatim from the design's interface table.

**Consumes F1:**

| Row | | Interface |
| --- | --- | --- |
| F1 | D | `type Dollars = number` is whole constant dollars of the dataset's `asOf` year. `type IncomeTier = 'veryLow' \| 'low' \| 'moderate' \| 'aboveModerate'`; `INCOME_TIERS` lists them in that order. `type TierUnits = Record<IncomeTier, number> & { unrecorded: number }`: `unrecorded` is income-restricted homes whose tier the records do not give. `type ProjectKind = 'market' \| 'affordable'`. These, and the types of rows F2, F5, F6 and F12, live in `src/lib/timelapse/types.ts` (relative imports only; the pipeline imports it by path, and `calibration.json` carries them). |

**Owns F2:**

| Row | | Interface |
| --- | --- | --- |
| F2 | M | `interface MarketStep { from: Day; logOdds: number }`: from `from` on, `logOdds` is added to every lot's initiation log-odds; steps are strictly ascending by `from` and the first is at or before `asOf`. `interface MarketModel { today: { all: number; private: number; years: [number, number]; observed: { all: number; private: number }; implied: number; provenance: Provenance }; crossCheck: { logOdds: number; provenance: Provenance }; slope: { perCostShare: number; provenance: Provenance; crossChecks: { costCoefficient: number; priceCoefficient: number; provenance: Provenance } } }`. `today.all` is the natural log of observed starts over implied starts in the last three panel years (`years`, first and last), where the implied starts are the sum of the published model's hazard over those years' lot-months: the published model is the one the engine runs, so the shifted engine reproduces those years' count closely, which the pipeline checks (OD-F11). `today.private` is the same with the observed count restricted to starts whose Planning record does not propose at least 95% affordable homes. `observed` and `implied` are those counts, for the page's sentence. The hold-out (the model fitted on the years before them, against the same observed count) is in the calibration report as evidence of the cycle, and is never applied. `crossCheck.logOdds` is the Controller's coefficients on its own indices: reported, never applied. `slope.perCostShare` is the log-odds shift for public money equal to 100% of a project's construction cost. It is `−today.private ÷ typicalUncoveredShare`, where `typicalUncoveredShare` is the mean of `uncoveredPerHome('market', p) ÷ p.costPerHome` over the prototypes (F4), weighted by the share of the last five panel years' private starts that fall in each prototype: closing a typical private project's whole uncovered cost returns its odds to the 2007–2025 average (tier 2; OD-F9a). `crossChecks` are the same quantity from the Controller's cost coefficient and from its price coefficient: reported, never applied. `Calibration.market?: MarketModel`; absent means no market term (shift 0) and no slope, so no programme can be compiled. `marketSteps(m: MarketModel \| undefined, asOf: Day, level: 'all' \| 'private'): MarketStep[]` returns the one step this package ships, `[{ from: asOf, logOdds }]`, or `[]` without a model. `parseCalibration` validates `market` when present. |

**Owns F3:**

| Row | | Interface |
| --- | --- | --- |
| F3 | M | `SimInput.market?: MarketStep[]`; absent or `[]` means shift 0. `buildSimInput` sets it with `marketSteps`: level `'private'` when it also sets `finance` from the calibration's baseline funding (F12), else level `'all'`. That rule lives in one function, `marketLevel(calibration): 'all' \| 'private'` (`market-baseline`; it returns `'all'` until `finance-engine` changes its body to this rule), which `buildSimInput` and the page's statement of the market both call, so the page can never state a level the engine is not running. The engine evaluates initiation at `logistic(z + logOdds)` piecewise over the steps, with the same draws, for any number of steps (ruling R7: later scenarios need no engine change); a step composes with `regimes` (a month's rate is its view's features under its step's shift), and a month falls under the step in force on its first day, the rule the dated regimes use. In-flight rows, size, revision and stage steps do not read it. |

**Consumes F4:**

| Row | | Interface |
| --- | --- | --- |
| F4 | M | `interface Prototype { id: 'A' \| 'B' \| 'C' \| 'D' \| 'E'; stories: number; homes: number; costPerHome: Dollars; shortfallPerHome: Dollars; provenance: Provenance }`: `costPerHome` is the Controller's total cost excluding land, `shortfallPerHome` the negated residual land value under current requirements. `PROTOTYPES: readonly Prototype[]` lists A to E. `prototypeFor(stories: number, homes: number): Prototype`: fewer than 25 homes is E; otherwise up to 6 stories A, up to 10 B, up to 18 C, above that D (binning tier 4, stated in the provenance). `LAND_PER_HOME: Sourced<Dollars>`. `AFFORDABLE: Sourced<{ costPerHome: Dollars; ownPerHome: Dollars }>` (the Budget Analyst's average; `ownPerHome` is permanent loans plus other). `uncoveredPerHome(kind: ProjectKind, p: Prototype): Dollars` is `p.shortfallPerHome + LAND_PER_HOME` for `market` and `AFFORDABLE.costPerHome − AFFORDABLE.ownPerHome` for `affordable`. `costPerHome(kind, p)` is `p.costPerHome` for `market` and `AFFORDABLE.costPerHome` for `affordable`. `src/lib/sim/finance/` has no `$lib` import, because the pipeline imports it by path; `Sourced`, `Unsourced` and `Evidence` are declared in `src/lib/sim/finance/evidence.ts` and re-exported from `src/lib/sim-page/timing-sources.ts`. |

**Consumes F12** (this spec builds against its `baselineFunding`, which `marketLevel` reads from Release 2, and against its cohort of projects proposing at least 95% affordable homes, whose flag this spec owns):

| Row | | Interface |
| --- | --- | --- |
| F12 | M | `projects.json`: each project gains `affordableHomes?: number \| null` (the Planning record's proposed affordable homes; null or absent when not recorded). `rhnaCompletedNet` gains `byTier?: TierUnits` (net homes completed since `since`, from the housing-production records; above moderate is the net total less the income-restricted tiers, so losses are netted against it and the tiers sum to `units`, a pipeline invariant). `calibration.json` gains `affordableRoutes?: Record<Pathway, number> & { provenance: Provenance }`: the pathway shares of projects of 10 homes or more, first recorded in the planning-side window, whose Planning record proposes at least 95% affordable homes (shares sum to 1; fewer than 30 such projects falls back to `pathwayForNew` with a tier 4 label). It also gains `baselineFunding?: { pools: Pool[]; programmes: Programme[]; provenance: Provenance[]; check: { impliedHomesPerYear: number; observedHomesPerYear: number; provenance: Provenance } }`: today's public funding of affordable homes, transcribed with page references in `pipeline/enrichment/funding.json`. The four new fields are optional in the types, because older dataset versions and the hand fixtures lack them; an absent `baselineFunding` means no baseline funding. `provenance` holds one entry per pool in `pools` order, then one for the programmes' `tiers` and `minHomes`. Baseline pool and programme ids match `^[a-z0-9][a-z0-9-]{0,39}$`, never start `u-`, and stay the same from one dataset version to the next, because stored policies name them. It holds one City pool per source in the Budget Analyst's Exhibit E (yearly inflows), one `state` pool (the yearly average to San Francisco), one uncapped `federal` pool, and one grant programme per pool with `reach: 'affordable'`, whose `share` is that source's dollars per home over the uncovered cost per home. The programmes' `tiers` and `minHomes` come from a new locked source, the MOHCD affordable pipeline (`aaxw-2cb8`, PDDL): the income-band mix of its homes, and the 10th percentile of homes per project. `check` compares the homes a year the capped pools can fully fund with the homes a year in San Francisco's bond and tax-credit awards; when they differ by more than half the pipeline warns and the calibration report says so. The calibration report also gains two sections: the 100% affordable cohort's stage durations and exits beside the other projects', fitted with the same method as the transition tables; and the mean fitted start hazard of the lots where that cohort's projects started, over the mean for the lots where private projects started (R10, OD-F9b: whether funded projects sit on lots like those private projects choose). Both are report-only. |

### Internal types

These are new and do not alter a row.

```ts
// src/lib/timelapse/types.ts, on ProjectHistory (pipeline-internal T4d):
/** The primary Planning record's `number_of_units_prop` and `number_affordable_units_prop`;
 * null when the project has no primary Planning record. Absent (hand-built histories) = null. */
planningProposed?: { units: number | null; affordable: number | null } | null;

// pipeline/lib/affordable-cohort.ts: the affordable-cohort flag, exported for finance-data
export const AFFORDABLE_COHORT_SHARE = 0.95;
export type StartCohort = 'affordable' | 'private' | 'noRecord' | 'unknown';
export function startCohort(p: ProjectHistory['planningProposed']): StartCohort;
/** startCohort(p) === 'affordable': the flag finance-data reads. */
export function isAffordableCohort(p: ProjectHistory['planningProposed']): boolean;

// pipeline/lib/fzp-cal/panel.ts
export interface PanelStart {
  year: number;
  basis: 0 | 1;
  cohort: StartCohort;
  homes: number | null;   // gross homes, section 4.3
  stories: number | null; // ProjectHistory.storiesProposed
}
// PanelResult gains `starts: PanelStart[]`, in (year, parcel id, month) order.

// pipeline/enrichment/market-schema.ts (zod), for pipeline/enrichment/market.json: section 4.5.

// pipeline/lib/fzp-cal/initiation.ts: InitiationReport gains, for the recent years' cells only,
// recentCells: { exposure: number; z: number }[]  (z = the published linear predictor, basis 0)

// pipeline/lib/fzp-cal/market.ts
export const RECENT_YEARS = 3; // F2: the last three panel years
export const WEIGHT_YEARS = 5; // F2: the last five panel years
export function marketModel(x: MarketInput): { market: MarketModel; report: MarketReport };

// src/lib/timelapse/model.ts
export function initiationLogit(m: InitiationModel, f: Record<FeatureId, number>): number;

// src/lib/sim/scenario/market.ts
export function marketSteps(m: MarketModel | undefined, asOf: Day, level: 'all' | 'private'): MarketStep[];
// marketLevel(calibration): 'all' | 'private' is named by row F3; this spec ships it returning
// 'all', and finance-engine gives it F3's rule.

// src/lib/fzp/market-view.ts (page code; not a hashed path)
export const MARKET_INTRO_SENTENCE: string;
export const MARKET_HOLD_SENTENCE: string;
export function marketSentence(cal: Calibration, level: 'all' | 'private'): string | null;
```

`MarketInput` and `MarketReport` are internal to the pipeline; their fields are whatever section 4 needs.

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

### 4.1 Which starts are private: the affordable-cohort flag

This spec owns the flag for a start whose Planning record proposes at least 95% affordable homes (design, "Dependency order", step 1). `finance-data` imports it from `pipeline/lib/affordable-cohort.ts` and defines no test of its own.

**The history field.** `history()` in `pipeline/project-records/derive.ts:554-578` sets `planningProposed` from `a.proj.primary` (`pipeline/project-records/types.ts:236`): `{ units: primary.unitsProp, affordable: primary.affordableProp }`, or `null` when `primary` is null. `affordableProp` is `number_affordable_units_prop` as parsed (`pipeline/project-records/parse.ts:300`). The field is emitted after `quality` in `project-histories.json`. It is the primary record's value, the same record whose `unitsProp` already sets `unitsAt.filed` (`derive.ts:394-396`), so one record decides both.

**The predicate.** `startCohort(p)`:

- `p` null or absent → `'noRecord'`.
- `p.units` null or ≤ 0 (a 0 is "not recorded" under ruling F1a, `derive.ts:361-365`), or `p.affordable` null → `'unknown'`.
- `p.affordable ≥ 0.95 × p.units` → `'affordable'`. 19 of 20 is in; 18 of 20 is out. The 95% comes from the design (F2, F12; tier 2 proxy for "publicly funded": the records carry no funding field).
- otherwise → `'private'`.

`isAffordableCohort(p)` is `startCohort(p) === 'affordable'`. Both are pure and exported; the constant `AFFORDABLE_COHORT_SHARE = 0.95` is exported with them so no other module repeats the number.

**Counting.** A start counts as private unless its cohort is `'affordable'`. `'noRecord'` and `'unknown'` count as private. Reason: the flag is a positive identification of the affordable cohort; City-funded 100% affordable projects file a Planning record with proposed counts (of about 184 histories starting in 2023-2025, 18 are in the cohort, 11 have no Planning record, 3 have no recorded unit count, and none has units but a blank affordable count; inferred, from the read-only history tabulation described at the end of this spec). The report states how many starts fell in each cohort so the choice is visible.

**Pre-2015 permit-basis starts.** A permit-basis start is classified by the same rule (its history's primary Planning record, if any). Only the recent years (2023-2025) and the weight years (2021-2025) read the cohort; the few permit-basis starts there (one in 2025, three in 2022 on build `2026-11-04-bbb2eba1`, calibration report section 5, "Back-cast"; verified) are usually `'noRecord'` and so private. Starts outside those years are classified but never read.

### 4.2 The panel keeps its starts

`initiationEvents` (`panel.ts:130-195`) records, with each event it places (only when `t[e.month] === 0`, `panel.ts:189-193`), the history's cohort, homes and stories, keyed by (parcel, month). `aggregatePanel` (`panel.ts:234-359`) appends a `PanelStart` exactly when it counts an event (`v > 0` on a `hostableBase` row with exposure, `panel.ts:296-303`), with the row's roll year and the event's basis. So `starts.length === events.record + events.permit`, and covered and off-panel events are absent, as they are from the fit. `PanelStart` order is (year, parcel id, month), so the result does not depend on input order.

### 4.3 Homes and stories of a start

- **Homes**: the first of `unitsAt.filed`, `unitsAt.permitFiled`, `unitsAt.complete` that is a positive number, else `null`. These are gross proposed homes (`src/lib/timelapse/types.ts:136`), which is what a prototype's `homes` counts. Net homes would misclassify replacement projects.
- **Stories**: `storiesProposed` (`types.ts:138`), else `null`.
- **Prototype**: `prototypeFor(stories, homes)` (F4) when it can decide: homes < 25 gives E whatever the stories (so a missing stories value does not matter there); homes ≥ 25 needs stories. A start is **unbinned** when homes is null, or homes ≥ 25 and stories is null. Unbinned starts are left out of the weights and counted in the report ("homes not recorded", "stories not recorded"). Reason: there is no sourced way to place them, and imputing a prototype would invent a mix. On build `2026-11-04-bbb2eba1` the read-only history tabulation (not the panel) gives 2021-2025 private starts E 236, B 21, D 14, C 8, A 4, homes missing 22, stories missing 18 (inferred, histories rather than panel events; tier 0 records).

### 4.4 The quantities

All live values are rounded with `sig6` (`pipeline/lib/fzp-cal/tail.ts`, 6 significant digits) as the initiation model's numbers are (`initiation.ts:350-354`). `implied` is rounded first, the two levels are computed from the rounded `implied`, and every later quantity from the rounded `today.private`, so the shipped fields agree with each other exactly (section 4.10 checks it).

**`today.years`** is `[L − 2, L]` with `L` the last panel year, the largest key of `impliedPerYear` (`initiation.ts:374-379`): `[2023, 2025]` (`RECENT_YEARS = 3`, F2).

**`today.implied`** (tier 2, our records). `I = sig6(Σ impliedPerYear[y])` over the recent years: the starts the published model, the one the engine runs, implies for those years. On build `2026-11-04-bbb2eba1`: 81.6109 + 81.7087 + 82.2016 = **245.521** (calibration report section 5, "Plausibility"; verified; the report's per-year values are themselves rounded to 6 significant digits, so the shipped value may differ in the last digit).

**`today.observed.all`** (tier 0 records). `O = Σ observedPerYear[y]` over the recent years, every panel event of both bases (`initiation.ts:399-402`). On build `2026-11-04-bbb2eba1`: 33 + 40 + 56 = **129** (same table; verified). `marketModel` also counts the recent years' `PanelStart`s and throws if the two counts differ (errors below), so the cohort split is always of the same events.

**`today.observed.private`** (tier 0 records, tier 2 proxy). `O_p = O − A`, `A` the recent-year `PanelStart`s whose cohort is `'affordable'`. Expected about 116 on current data (inferred: about 18 of 184 histories starting in 2023-2025 are in the cohort; the panel count decides).

**`today.all`** (tier 2). `sig6(ln(O ÷ I))`. On build `2026-11-04-bbb2eba1`: ln(129 ÷ 245.521) = **−0.643571**, a factor of 0.525 on the odds (verified arithmetic on the verified counts; the design's −0.64, OD-F11).

**`today.private`** (tier 2). `sig6(ln(O_p ÷ I))`, the same denominator. Expected about ln(116 ÷ 245.521) = **−0.750** (inferred, from the cohort estimate above). The denominator stays the implied starts of every kind: the published model was fitted on all starts, and the private level must restore all starts' average when public money closes the gap (F2's slope anchor).

**The reproduction check** (report only; F2: "the shifted engine reproduces those years' count"). `X = Σ exposure × logistic(z + today.all)` over the recent years' cells (`recentCells`, with `z` the published linear predictor on basis 0). Because `logistic(z + s)` is not exactly `e^s × logistic(z)`, `X` is close to `O` but not equal; for monthly hazards near 5 × 10⁻⁵ (about 82 implied starts a year over about 146,549 hostable parcels, calibration report section 5; verified) the gap is under 0.01% (inferred). `X` is printed in the report and a warning fires when `|X − O| > 0.02 × O` (the 2% tolerance is the back-cast's existing `BACKCAST_TOL`, `initiation.ts:50`, tier 4).

**The hold-out diagnostic** (report only; never in `calibration.market`). `ln(holdOut.observed ÷ holdOut.predicted)` from the existing hold-out (`initiation.ts:409-439`). On build `2026-11-04-bbb2eba1`: ln(129 ÷ 386.399) = −1.09706 (calibration report section 5, "Hold-out"; verified). It is evidence of the cycle: fitted only on 2007-2022, the model expected about three times today's starts. It is not applied, because the published model already contains part of the slowdown and adding −1.097 to it would count that part twice (about 82 starts for 2023-2025 against 129 observed; OD-F11). If the hold-out refit failed (`holdOut` is `{ error }`), the report prints the error in its place and a warning fires; the build does not fail, because no shipped number depends on it.

**`crossCheck.logOdds`** (tier 3, the Controller's model; never applied). `β_c × (C̄_H − C̄_R) + β_p × (P̄_H − P̄_R)`, where `β_c = −0.0992` and `β_p = +0.0143` are the Controller's coefficients on `Construc_Cost_Real` and `Zillow_Price_Real` (verified, *Family Zoning Plan: Economic Impact Report*, Items 250700 and 250701, 2025-10-29, slide 31), and the bars are means of the two indices **lagged two years, as the Controller's model uses them** (slide 30: "2 years prior") over the same years `today.all` compares: `H` = the recent years 2023-2025 (index years 2021-2023) and `R` = all panel years 2007-2025 (index years 2005-2023), because `today.all` is measured against the published model, whose level is the 2007-2025 average. `P̄_R` is the year-weighted mean of the file's two period means, `(16 × P̄_2005-2020 + 3 × P̄_2021-2023) ÷ 19`, which is exact for an equal-weight mean. On this spec's chart readings (section 4.5): `C̄_R` = 101.747, `C̄_H` = 115.267, `P̄_R` = 85.879, `P̄_H` = 89.5, so −0.0992 × 13.519 + 0.0143 × 3.621 = −1.341 + 0.052 = **−1.29** (tier 3, chart-read, approximate; within the design's "about −1.2 to −1.5", model section 1).

**`slope.perCostShare`** (tier 2; OD-F9a). As F2 states: `−today.private ÷ typicalUncoveredShare`, with `typicalUncoveredShare = Σ_p w_p × uncoveredPerHome('market', p) ÷ p.costPerHome`, `w_p` = the binned private starts of the weight years in prototype p ÷ all binned private starts of the weight years. The prototypes are `PROTOTYPES` (F4), iterated in id order A to E, imported by relative path from `src/lib/sim/finance/` (F4: that directory has no `$lib` import). On the history tabulation of section 4.3 and F4's expected constants (cost and shortfall from the Controller's *Triennial Review 2026*, pp. 4 and 11; land $65,000, the midpoint of p. 3's $60,000-$70,000, which `finance-model` owns), `typicalUncoveredShare` ≈ 0.430 and the slope ≈ 0.750 ÷ 0.430 ≈ **1.74** (inferred, approximate; the design's "about 1.75", OD-F11).

**`slope.crossChecks`** (tier 3; never applied). The same quantity, a log-odds shift per 100% of construction cost, from each Controller coefficient:

- `costCoefficient = −β_c × C̄_H`. A grant paying share s of construction cost is read as a proportional cut of s in the cost index, `s × C̄_H` index points. ≈ 0.0992 × 115.27 = **11.4**.
- `priceCoefficient = β_p × P̄_H × typicalCostOverValue`, `typicalCostOverValue = Σ_p w_p × p.costPerHome ÷ (p.costPerHome − p.shortfallPerHome)`. A grant of g a home is read as a price rise of g on a building worth `costPerHome − shortfallPerHome` a home (the Controller's own identity: residual land value = value − cost; F8 uses the same `ownValuePerHome`). ≈ 0.0143 × 89.5 × 1.566 = **2.0**.

For a $50,000 grant on prototype B (6.8% of $736,700) the three give about +12.6% (ours), +14.6% (price) and +117% (cost) on the odds (inferred arithmetic). Ours lies just below the price figure and far below the cost figure, as the design's OD-F9a states ("about 12% more … within the range of the Controller's price coefficient and far below its cost coefficient").

**Errors (live).** Each throws `CalibrationError` and fails the build, because the market is load-bearing:

- `market: no starts in <y0>-<y1>` when O = 0; `market: no private starts in <y0>-<y1>` when O_p = 0; `market: implied starts <I> in <y0>-<y1> are not positive` when I is not a finite positive number.
- `market: <n> panel starts in <y0>-<y1> do not match <O> initiation events` when the `PanelStart` count of the recent years differs from O.
- `market: no private start in <y0>-<y1> has a prototype` (weight years) when no start is binned.
- `market: typicalUncoveredShare <x> is not positive` and `market: prototype <id> has no positive value per home` (cost ≤ shortfall) as guards; with sourced F4 constants neither can fire.
- `market: <path>: <zod message>` when `market.json` is valid JSON that fails its schema, and `market: <path>: price periods <periods> do not match the panel years minus lagYears (<expected>)` (section 4.5).
- `market: <path>: <the JSON parser's message>` when `market.json` is not valid JSON (amendment of 2026-11-10). The calibration step reads the file through `readMarketFile(path)` in `pipeline/steps/calibration.ts`, beside `readFundingFile`: it reads the file, parses the text inside a `try`, rethrows a parser error as this `CalibrationError`, and then calls `parseMarketFile`. A file that cannot be read at all (missing, no permission) is not wrapped: Node's error already names the path. Fixture builds read the same file, so the rule holds for them too. The class is `CalibrationError`, not the `BuildError` that `funding.json` uses, so that every failure of this file has one class and one `market: <path>: ` prefix.

**Warnings (live; listed in the report's warnings and the build's).** Neither fails the build:

- `today.all` outside [ln 0.1, ln 2] = [−2.303, 0.693] (tier 4 sanity band);
- `|today.all − crossCheck.logOdds| > 1` (tier 4; about 0.65 on current readings);
- `|X − O| > 0.02 × O` (the reproduction check);
- `market: the hold-out refit failed: <message>; the report has no hold-out diagnostic`.

**Fixture profile.** `FIXTURE_CAL.fixtureInitiation` is true and there is no hold-out (`initiation.ts:410-411`). The fixture's start model is a fixed hazard of 0.05 a month (`initiation.ts:53`), so its implied starts are not a measurement of anything; the fixture market is fixed (tier 4, invented):

- `years = [2023, 2025]`, `observed = { all: 10, private: 9 }`, `implied = 20`; so `today.all = −0.693147` (ln 0.5) and `today.private = −0.798508` (ln 0.45). The counts are chosen to give round factors: the fixture's simulated starts fall visibly but still appear within the e2e horizon (shifted hazards about 0.026 and 0.023 a month), and the page's sentence shows whole numbers.
- No reproduction check and no hold-out diagnostic.
- `crossCheck` from `market.json` as live.
- `slope` and `crossChecks` by the live formulas on the fixture panel's binned private starts of 2021-2025 when there is at least one; otherwise equal weights of 0.2 (tier 4). The mini panel has three starts, in 2024 and 2025 (golden calibration report, section 5).
- Every fixture provenance is tier 4 with a label beginning `fixture:`.

### 4.5 The enrichment file

`pipeline/enrichment/market.json`, committed; schema `pipeline/enrichment/market-schema.ts` (zod, pipeline only, as `pipeline/enrichment/schema.ts` and `construction-schema.ts`). Fixture builds read the same file: the cross-check does not depend on the mini city.

```json
{
  "schema": 1,
  "source": {
    "label": "SF Controller, Office of Economic Analysis: Family Zoning Plan: Economic Impact Report (Items 250700 and 250701), 2025-10-29",
    "url": "https://newspack-missionlocal.s3.amazonaws.com/mission/wp-content/uploads/2025/10/250700_economic_impact_final.pdf",
    "retrieved": "2026-11-09"
  },
  "lagYears": { "value": 2, "locator": "slide 30: \"2 years prior\"" },
  "coefficients": {
    "cost": { "variable": "Construc_Cost_Real", "value": -0.0992, "se": 0.0129, "locator": "slide 31" },
    "price": { "variable": "Zillow_Price_Real", "value": 0.0143, "se": 0.0053, "locator": "slide 31" }
  },
  "costIndex": {
    "locator": "slide 16, Blended Construction Cost Index (inflation-adjusted, 2016 = 100), read from the chart",
    "values": { "2005": 92.7, "2006": 95.8, "...": "one value per year 2005 to 2023" }
  },
  "priceIndex": {
    "locator": "slide 15, 10-Neighborhood Average, Historical (inflation-adjusted, 2016 = 100), read from the chart; period means only",
    "means": [
      { "from": 2005, "to": 2020, "mean": 85.2 },
      { "from": 2021, "to": 2023, "mean": 89.5 }
    ]
  }
}
```

Rules:

- **Coefficients** are verified values (slide 31, read by this spec's first author). The builder re-reads slide 31 and records them exactly.
- **The cost index** is one value per index year 2005 to 2023 inclusive, one decimal. Its sources are the Bureau of Economic Analysis and the Census Quarterly Workforce Indicators (slide 16 footer), public data, so a yearly series may be committed. This spec's reading behind the numbers above (2005 92.7, 2006 95.8, 2007 97.0, 2008 100.0, 2009 97.2, 2010 97.5, 2011 97.1, 2012 98.2, 2013 98.0, 2014 98.2, 2015 99.4, 2016 100.0, 2017 102.0, 2018 104.0, 2019 104.3, 2020 106.0, 2021 116.8, 2022 116.7, 2023 112.3) are the committed values (tier 3, chart-read). The builder commits them as written. A re-read of the chart changes a value only where it differs from this reading by more than 1 index point (tier 4 reading tolerance), and each such change is logged in the Release 1 PR and in `docs/dev/market.md` with the old and new values. The schema rejects a missing year.
- **The price index is Zillow's** (slide 30) and is not openly licensed (tension 7). The file holds **only two period means**, read from slide 15. This spec's readings, 2005-2020 mean 85.2 and 2021-2023 mean 89.5 (tier 3, chart-read), are the committed values, under the same rule as the cost index: changed only where a re-read differs by more than 1 index point, and logged. No yearly price value is committed, shipped or printed. The schema requires exactly two periods. The code asserts that the second is the recent years minus `lagYears` (`[2021, 2023]`) and the first is the panel years before them minus `lagYears` (`[2005, 2020]`), so that together they cover the reference period 2005-2023 and their year-weighted mean is its mean (section 4.4). Two adjacent periods are kept, not one 2005-2023 mean, so the file stays a plain quotation of what the chart shows for each period. A change of either period needs a new reading.
- The calibration ships only the derived scalars (`crossCheck.logOdds`, `crossChecks.priceCoefficient`). The provenance `method` text may state the coefficients, the cost means and the price means, which is quotation of published figures, not a series.

### 4.6 `calibration.market`

`calibrate()` (`pipeline/lib/fzp-cal/calibrate.ts:97-235`) calls `marketModel` after `fitInitiation` and before assembly. `CalInput` gains the parsed enrichment; the calibration step (`pipeline/steps/calibration.ts`) reads `pipeline/enrichment/market.json`, because `calibrate` does no I/O. `market` is emitted **after `phaseGap`** (`calibrate.ts:145-156`; the type's comment says keys are emitted in declaration order, `src/lib/timelapse/types.ts:69`). `finance-data`, which runs after this spec, emits `affordableRoutes` and `baselineFunding` after `market`. `parseCalibration` then validates it as part of the existing check (`calibrate.ts:157-165`).

The key order inside `market.today` is `all`, `private`, `years`, `observed`, `implied`, `provenance`, as F2 declares them.

Provenance (each a `Provenance`, `types.ts:52-59`):

- **`today.provenance`**: tier 2. Label: `Today's market: new-project filings in 2023-2025 against the starts the start model, fitted on 2007-2025, implies for those years (tier 2)`. Sources: the four `datasf` sources of the initiation model (`initiation.ts:542-547`). Method states O, O_p, A, I, both logarithms, the cohort rule ("a start is private unless its primary Planning record proposes at least 95% affordable homes; N starts had no Planning record and M no recorded counts, and count as private"), and the reproduction check X. It does not mention the hold-out, which stays in report section 11 only, so no field of `calibration.json` depends on it (acceptance criterion 5). `n` = O; `window` = `['2023-01-01', '2025-12-31']`.
- **`crossCheck.provenance`**: tier 3. Label: `The Controller's development model on its cost and price indices (tier 3, a cross-check; not used)`. Source: `market.json`'s `source`. Method: the formula, coefficients, periods (index years 2021-2023 against 2005-2023), the four means, "chart-read, approximate", and "the Controller's model is annual, on a lot producing housing; ours is monthly, on a project's first filing; the two shifts are comparable only as odds ratios".
- **`slope.provenance`**: tier 2. Label: `Odds shift for public money: closing a typical private project's uncovered cost returns its odds to the 2007-2025 average (tier 2)`. Sources: our records plus F4's sources. Method: the weights per prototype with counts, the unbinned counts, `typicalUncoveredShare`, the formula. `n` = binned private starts; `window` = `['2021-01-01', '2025-12-31']`.
- **`slope.crossChecks.provenance`**: tier 3, the Controller's source, with both conversions written out.

Fixture: the same shapes, tier 4, labels prefixed `fixture:`; `today.provenance.method` states that the counts are invented.

**Counts** added to the build's counts object: `calibration.market.recentStarts` (O), `calibration.market.recentPrivate` (O_p), `calibration.market.recentAffordable` (A), `calibration.market.recentNoRecord`, `calibration.market.recentUnknown`, `calibration.market.weightStarts` (binned), `calibration.market.unbinnedHomes`, `calibration.market.unbinnedStories`.

### 4.7 The calibration report: section 11

A new section `## 11. Today's market`, appended after section 10. `REPORT_SECTIONS` (`pipeline/lib/fzp-cal/report.ts:78-90`) gains it as its last entry and its comment says eleven headings; `finance-data` then adds sections 12 and 13. Section 5 is unchanged: its hold-out line and table (`report.ts:454-490`) and its "Plausibility" table stay where they are. Section 11 holds, in order:

1. A table, one row per recent year: `year | observed | affordable cohort | private | implied (published hazard) | hold-out predicted`. "Implied" is `impliedPerYear`; "hold-out predicted" is the hold-out row's `predicted`, or `none`.
2. `today.all` and `today.private` (6 significant digits), `years`, `observed`, `implied`, and the cohort counts of the recent starts (affordable, private, no Planning record, counts not recorded).
3. **Reproduction check**: "The published model shifted by today.all predicts X starts for 2023-2025 against O observed." On build `2026-11-04-bbb2eba1` X is expected to print as about 129 (inferred).
4. **Hold-out, report only**: "Fitted on 2007-2022 only, the model predicts E starts for 2023-2025: ln(O ÷ E) = h. This is evidence of the cycle and is not applied: the published model already contains part of the slowdown (OD-F11)." On build `2026-11-04-bbb2eba1`, E = 386.399 and h = −1.09706. Or the hold-out's error.
5. The weights table: `prototype | rule | private starts 2021-2025 | weight | uncovered per home | cost per home | uncovered share`, then the unbinned counts, `typicalUncoveredShare`, `slope.perCostShare`, `typicalCostOverValue`, both cross-check slopes.
6. `crossCheck.logOdds` with the four means and the gap to `today.all`.
7. Any market warning.

In fixture mode the section says `Mode: fixture (today's levels fixed at ln 0.5 and ln 0.45 from 10 and 9 observed against 20 implied; tier 4)` and prints items 5 and 6.

### 4.8 The engine

**Validation** (`checkInput`, `src/lib/sim/scenario/engine.ts:238`, memoised as today). For `input.market` present and non-empty, `runEngine` throws a `RangeError`:

- `market: logOdds of step <k> is not finite`;
- `market: steps must be strictly ascending by from (step <k>)`;
- `market: the first step must be on or before asOf (<iso> > <iso>)`.

`[]` and absent are valid and mean shift 0.

**Steps in force.** Let `s0` be the `logOdds` of the last step with `from ≤ input.asOf`, and `D = [d1 < … < dM]` with shifts `s1 … sM` the steps with `from > asOf`. Steps before the last one at or before `asOf` have no effect. F3's rule, "a month falls under the step in force on its first day", is applied as `regimes` already apply it (`input.ts:156-164`): an initiation month T of a lot at risk from day r runs on the step in force on the month's first day, `r + 1 + floor((T − 1) × MONTH_DAYS)`.

**Precompute** (`precomputeOf`, `input.ts:292-370`).

- `initiationLogit(m, f)` (new, `src/lib/timelapse/model.ts`) returns the linear predictor z. `initiationHazard` (`model.ts:394-398`) is unchanged, since `model-golden.json` locks it.
- `hazard[i] = 1 / (1 + exp(−(z_i + s0)))` with `exp` from `math.ts`, and `log1mh[i] = ln(1 − hazard[i])`. With `s0 = 0` (market absent or `[]`) `z + 0` is `z` exactly, so every hazard is bit-identical to `initiationHazard`. A test asserts this.
- For each later step m = 1..M, `stepLog1mh[m − 1][i] = ln(1 − 1 / (1 + exp(−(z_i + s_m))))`. That is one `Float64Array` per later step, empty with M = 0 (Release 1 has M = 0, so it adds no memory).
- Each regime view's precompute (`regimeInputsOf`, `input.ts:115-124`, which spreads `market` into each view's input) does the same for its own view.
- **Candidates**: a row is a candidate when it is hostable, has a size row and finite features, and in some view some step gives `hazard > 0` and `log1mh < 0`. Under any finite shift this is the unshifted rule (`input.ts:332-334`) unless a hazard underflows to 0. Rows whose hazard is 0 in every step and view stay out.
- Memoisation is unchanged: by `SimInput` identity. A different `market` array means a different input object, hence its own precompute.

**Segments.** The segment boundaries are the union of the regime days and D, sorted, with equal days merged into one boundary. Precompute holds, per input, the static list of boundary days with, for each segment, its `(view, step)` pair: view = the last regime whose day ≤ the segment start (0 before the first), step = the last market step in force. `simulatedPass` (`engine.ts:994-1048`) fills `rates[j]` for candidate i as the `log1mh` of segment j's view at segment j's step. It calls `piecewiseMonth(log(1 − u), regimeMonths(r, days), rates)` (`input.ts:162-194`) with `days` the merged boundaries, and takes the project's view from the segment containing T (`engine.ts:1033`'s loop, generalised to the segment list). With M = 0 the boundaries are the regime days, the code path is today's, and the first segment is the unswitched expression, so draws before the first boundary are unchanged. Days at or before r give empty segments, which `piecewiseMonth` already skips (`input.ts:184`).

**`skipAbove` stays a safe bound.** `skipBounds` (`input.ts:206-230`) receives the merged boundaries and, per segment, the same rate arrays, so `u* = 1 − exp(Σ_j n_j × l_j)` is the exact probability of a start by month Tmax from `asOf` under the piecewise hazard the exact path uses, widened as today (×(1 + 1e-6) + 1e-12). Because both paths read the same segments and the same arrays, a u at or below the bound always goes through the exact computation. It stays memoised per horizon.

**What does not read the market**: in-flight rows, multi-phase masters and phases, size draws, revisions and stage steps (F3). Only the initiation month of simulated starts does.

**Cost.** With one step (Release 1) the per-input precompute does one extra addition per hostable row and nothing else changes. The existing budgets (spec §4.11 band ≤ 15 ms; `scenario.bench.spec.ts`) must hold unchanged. With M later steps, per run per candidate, filling `rates` costs O(views + M).

### 4.9 Building inputs

- **`marketLevel(calibration)`** (`src/lib/sim/scenario/market.ts`; named by row F3) returns the level the engine runs. In Release 1 it returns `'all'` for every calibration, including one that already carries `finance-data`'s `baselineFunding`: no funding runs before `finance-engine`. `finance-engine` changes its body to F3's rule (`'private'` exactly when `buildSimInput` also sets `finance`). It is the one place the rule lives: `buildSimInput` and the page's sentence (section 4.11) both call it, so the engine and the page cannot state different levels.
- **`buildSimInput`** (`input.ts:51-71`) adds `market: marketSteps(calibration.market, projects.asOf, marketLevel(calibration))` when that is non-empty and **omits the key** otherwise. Omitting it keeps every existing input deep-equal to today's, so `golden-seed1.json` (mini calibration, no market) is untouched. When `calibration.market` is absent it calls `warn?.('calibration.json: no market model; the run uses the 2007-2025 average market')` once per call.
- **`marketSteps`** (`src/lib/sim/scenario/market.ts`): `[]` for `undefined`; else `[{ from: asOf, logOdds: m.today[level] }]`. Pure; returns a fresh array each call.
- **Pass-through.** `applyPolicies` spreads the input (`src/lib/sim/scenario/policy.ts:40-45`), `bare()` strips only `newProjects` and `inFlightScale` (`src/lib/sim/levers/apply.ts:44-48`), `twinInput` builds both twins from the base (`apply.ts:78-97`), `load.ts:402-419` builds the twin with `applyPolicies([baseZoning], fzp)`, and `/lesscars` spreads its base into the plan and baseline inputs (`pipeline/lib/lesscars/runs.ts:293-301`; base from `buildSimInput`, `pipeline/steps/lesscars.ts:474-483`). All of these already carry `market` with no code change. This spec adds tests that pin it (section 6) and a comment on `bare()` saying `market` and `finance` must survive it (F17).

### 4.10 `parseCalibration`

`parseCalibration` (`src/lib/timelapse/model.ts:767-781`) validates `market` when present (absent is valid) and still does **not** reject unknown top-level keys. Reason: `finance-data` adds keys in the same release, and an older page reading a newer calibration must not fail. Checks, in order, through the existing helpers (`fail`, `record`, `finite`, `checkKeys`, `checkProvenance`; `model.ts:491-583`):

- `market`: an object with exactly `today`, `crossCheck`, `slope` (missing → `market.<k>: missing`; extra → `unexpected key`).
- `market.today`: exactly `all`, `private`, `years`, `observed`, `implied`, `provenance`.
  - `years`: an array of two integers with `years[1] === years[0] + 2` (`market.today.years: expected [first, first + 2], got <json>`), because F2 measures the last three panel years.
  - `observed`: exactly `all` and `private`, each an integer ≥ 1 (`expected a positive integer, got <x>`), and `private ≤ all` (`market.today.observed.private: expected at most <all>, got <private>`). Both are at least 1 because the build refuses zero (section 4.4), and a logarithm of 0 is not finite.
  - `implied`: finite and > 0 (`expected a positive number, got <x>`).
  - `all` and `private`: finite and within [−10, 10] (`expected a number in [-10, 10], got <x>`), and each within 1e-5 of the logarithm of its count over `implied` (`market.today.all: expected ln(observed.all ÷ implied) = <x>, got <all>`; the same for `private`). The tolerance covers `sig6` rounding (at most 5e-6 for a magnitude below 10). This makes the page's sentence, which prints the counts, always agree with the shift the engine applies.
- `market.crossCheck`: exactly `logOdds` (finite) and `provenance`.
- `market.slope`: exactly `perCostShare`, `provenance`, `crossChecks`. `perCostShare` finite and > 0 (`expected a positive number, got <x>`). `crossChecks`: exactly `costCoefficient`, `priceCoefficient` (finite) and `provenance`.

### 4.11 Wording, and today's market in the results' sources

**Initiation provenance** (`initiation.ts:551`). Replace "so the published level is set by 2015+ first-record events; this is not a market adjustment" with "so the published level is set by 2015+ first-record events: it is the average market of the panel years. Today's market is a separate shift, `calibration.market.today`, which the simulation adds to every lot's log-odds". This changes live output only; the fixture uses `FIXTURE_LABEL`.

**The Results face's Sources paragraph** (Release 1; taken over from `funding-ui` section 4.12). The release that moves every number to today's market says so where the results are explained.

- **Where.** In `SimResults.svelte`, inside the Sources disclosure (`data-testid="fzp-sources"`, `SimResults.svelte:221-277`), directly after its first paragraph ("One possible future … not a forecast.", `:225-229`) and before the band line (`:230-235`): one `<p>` with the same classes as its neighbours (`mt-2 text-sm text-ink-muted dark:text-ink-dark-muted`) and `data-testid="fzp-market"`. `SimResults` gains the prop `market?: string | null` (default `null`; `null` renders nothing). `FzpMode` passes `market={calibration ? marketSentence(calibration, marketLevel(calibration)) : null}` (`FzpMode.svelte:1008-1027`). `SimResults` is the Results face of both `/sim` and `/s/<id>` (`src/lib/sim-page/SimPage.svelte`, through `FzpMode`), so both show it. It is static text in a closed disclosure: no `aria-live`.
- **Text** (`marketSentence(cal, level)`, `src/lib/fzp/market-view.ts`), `null` when `cal.market` is absent. With `{y0}`, `{y1}` = `today.years`; `{n}` = `formatCount(today.observed[level])`; `{e}` = `formatCount(Math.round(today.implied))`; `{pct}` = `formatPercent(today.observed[level] ÷ today.implied)` (`src/lib/scoreboard/format.ts:27`); `{from}` = the first four characters of `cal.initiation.provenance.window[0]`:
  - level `'all'`: "It runs on today's market. In {y0} to {y1}, {n} new projects started, where the start model, fitted on the city's records from {from} to {y1}, expected {e}. So every lot's chance of starting is set to about {pct} of that average, to the end of the timeline. This holds today's market; it is not a forecast."
  - level `'private'`: "It runs on today's market. In {y0} to {y1}, {n} new projects started other than those proposing nearly all homes affordable, where the start model, fitted on the city's records from {from} to {y1}, expected {e} of every kind. So every lot's chance of starting a project without public money is set to about {pct} of that average, to the end of the timeline. This holds today's market; it is not a forecast."
  - When the initiation provenance has no `window` (the fixture's has none, `initiation.ts:338-343`), "fitted on the city's records from {from} to {y1}" reads "fitted on the city's records".
  - Live, Release 1: "In 2023 to 2025, 129 new projects started, where the start model, fitted on the city's records from 2007 to 2025, expected 246. So every lot's chance of starting is set to about 52% of that average …" (from the verified counts). Fixture: "In 2023 to 2025, 10 new projects started, where the start model, fitted on the city's records, expected 20. So every lot's chance of starting is set to about 50% …".
  - Reasons: the percent is computed from the counts, not from `exp(level)`, so the sentence's three numbers agree by construction and a `sig6`-rounded logarithm cannot floor 45% to 44% (`formatPercent` floors). "Chance" stands for odds, which is accurate to well under 1% at hazards this small (section 4.4); "about" says so. The implied count is rounded to a whole start because it is printed beside a count.
  - In Release 1 `marketLevel` returns `'all'`, so only the first form is shown. The second form exists so the function is total; `funding-ui` owns its wording in Release 2 and may reword it, and adds after it its sentence on today's public funding (its section 4.12).

**The sources dialog** (`provenanceSections`, `src/lib/fzp/provenance.ts:362-407`). When `cal.market` is present:

- The "Where new projects start" section (`initiationSection`, `provenance.ts:197-222`) gets `intro: [MARKET_INTRO_SENTENCE]`: "The chance of starting below is the average over 2007 to 2025. The simulation runs on today's market instead: see 'Today's market'."
- A new section follows it: `id: 'src-market'`, heading "Today's market", `intro: [MARKET_HOLD_SENTENCE]` ("This round holds today's market to the end of the simulation; it does not forecast a recovery or a downturn."), no tables, and one entry, `entry('src-market-today', "Today's level", cal.market.today.provenance, { after })`. Its tier label is `TIER_LABEL[2]`, "Inferred from San Francisco records" (tier 4, "Assumption, not data", on the fixture). `after` holds three lines:
  - `All starts: ${pct} of the average (log-odds ${coefText(today.all)}). In force.`, with `pct` as in the paragraph for `'all'` (live "52%" and "−0.64");
  - `Private starts only: ${pct} of the average (log-odds ${coefText(today.private)}). Not in force until public funding is modelled.`;
  - `Cross-check, not used: the Controller's development model, on its cost and price indices, puts today's odds at ${formatPercent(exp(crossCheck.logOdds))} of the 2007 to 2025 average (research or literature, tier 3).` (live about "27%").
  - "In force" follows `marketLevel(cal)`: the line of the level it returns says "In force."; the other says "Not in force until public funding is modelled." in Release 1. `funding-ui` rewords the second for Release 2.
- The cross-check is a line, not an entry: as an entry its tier 3 would add `NOT_SF_NOTE` ("Not from San Francisco records.", `provenance.ts:84`), which is false for a model fitted on San Francisco lots.
- The slope and its cross-checks are not shown in Release 1: nothing uses them before `finance-engine`, and showing an unused number would read as one the simulation applies. `funding-ui` adds them in Release 2.
- Without `cal.market` there is no intro sentence, no section and no paragraph.

**Controller references** (`src/lib/sim/scenario/score.ts:308-376`). Both entries drop "(via press coverage)" from `label` and "(tier 1 via secondary: KQED)" from `provenance.label`.

- Source: `market.json`'s `source` (label and URL), slide 18.
- Tier stays 1, as `planning-citywide`'s does. Reason: these are official published estimates used as comparison targets, not parameters the simulation uses, and a tier 3 label would add the false "Not from San Francisco records" note.
- `controllerMethod` becomes: "The Controller's Office of Economic Analysis, *Family Zoning Plan: Economic Impact Report*, 2025-10-29, slide 18: net additional units from the rezoning beyond existing zoning over 20 years, ${scenario} scenario. From is the plan's effective date (2026-01-12), by is the end of 2045 (inferred: the report forecasts 2026-2045). Both of the Controller's scenarios assume housing prices grow from 2025 (slides 12 and 15). This simulation holds today's market to the end of the timeline, so its plan effect is expected to fall below both. Compared with planEffect.completedNetNew (completions, net units)."
- The `KQED` constant is deleted.
- The comparison itself (`measure`, `units`, dates) is unchanged.

### 4.12 The hashed paths

`PATHS` in `pipeline/lib/version.ts:40-50` gains `'src/lib/sim/finance'`, after `'src/lib/sim/levers'`, and the comment above it (`version.ts:33-39`) says why: the calibration step imports the prototypes for the slope, and from Release 2 the `/lesscars` build step runs the baseline funding through `src/lib/sim/finance/` (global constraint "The engine is in the dataset version"). `src/lib/fzp/market-view.ts` is page code and stays outside the hashed paths. The change itself gives a new dataset version, which Release 1 needs anyway.

**Developer docs**: section 8.

## 5. Seams

- **Market scenarios and a market control (R7).** The engine takes any number of steps (section 4.8), and a test runs three. `marketSteps` returns one step. The page names the market through one function, `marketSentence`, and the dialog through one section, `src-market`. This spec adds no scenario data, no page control, and no field beyond `SimInput.market`. A later package adds scenario steps (from `calibration.market` or a new file), a control, and its own wording in `marketSentence`, with no engine change.
- **The pipeline and drop-out (R1, R8).** The shift reaches only simulated starts' initiation months. In-flight rows, stage tables and revision never read it (section 4.8). Nothing else is done.
- **A rent model (R4).** None. The price coefficient is used only in a reported cross-check, and no price series exists in the dataset or the repository beyond two period means.
- **Release 2 (R9).** `today.private`, `observed.private` and `slope` ship now, unused, so `finance-engine` can switch the level by changing `marketLevel`'s body, with no dataset change of this subsystem's. Because `buildSimInput`, the paragraph and the dialog's "In force" line all call `marketLevel`, that one change moves the engine and the page together; `funding-ui` then extends the wording.

## 6. Testing

Every test calls `expect` (`expect.requireAssertions`).

**Pipeline (`npm run test:pipeline`)**

- `pipeline/test/project-records/planning-proposed.test.ts`: a history with a primary PRJ carries `{ units, affordable }` from it, including nulls; one without a primary carries `null`; a satellite PRJ's counts are never used.
- `pipeline/test/fzp-cal/affordable-cohort.test.ts`: `startCohort` on 19/20 → affordable, 18/20 → private, 20/20 and 21/20 → affordable, units 0 → unknown, affordable null → unknown, null → noRecord, absent → noRecord; `isAffordableCohort` is true exactly for the affordable cases; `AFFORDABLE_COHORT_SHARE` is 0.95.
- `pipeline/test/fzp-cal/panel-starts.test.ts`: on hand-built histories and a fake `PanelSource`, `starts.length` equals counted events; a covered event and an off-panel event are absent; a permit-basis start carries basis 1 and its cohort; homes take `filed`, then `permitFiled`, then `complete`; the order is independent of input order.
- `pipeline/test/fzp-cal/market.test.ts`, on a hand-built `MarketInput` (per-year implied and observed counts, recent cells, panel starts, a hold-out):
  - `years` is `[2023, 2025]`; `implied = sig6(Σ implied of 2023-2025)`; `observed.all` = Σ observed; `today.all = sig6(ln(observed.all ÷ implied))`; `today.private` with 2 affordable starts out of 10 uses the same `implied`;
  - **the hold-out never reaches `market`**: two inputs differing only in the hold-out give deep-equal `market`; a hold-out `{ error }` gives a warning and the same `market`;
  - the reproduction check: on cells with hazard 10⁻⁴, `X` is within 0.01% of O and no warning fires; on hand-built cells with hazard 0.3, `X` differs from O by more than 2% and the warning fires;
  - each live error of section 4.4 with its exact message, including the panel-count mismatch;
  - each warning threshold;
  - weights and slope with hand-placed starts in A, B, E plus one unbinned start of each kind, against `PROTOTYPES` by the formula;
  - the cross-check from a hand-built enrichment, with the reference mean the year-weighted mean of the two price periods; a file whose periods do not match the panel years minus `lagYears` throws;
  - the fixture values (`years [2023, 2025]`, `observed { all: 10, private: 9 }`, `implied 20`, −0.693147, −0.798508, tier 4, `fixture:` labels) and the equal-weights fallback.
- `pipeline/test/enrichment/market-json.test.ts`: the committed `market.json` parses; the coefficients are exactly −0.0992 and 0.0143; the cost index has every year 2005-2023; the two price periods are `[2005, 2020]` and `[2021, 2023]`; no price key other than `means` exists.
- `pipeline/test/fzp-cal/calibrate.test.ts` (extended): `market` is present, its key follows `phaseGap`, the keys of `market.today` are in F2's order, `parseCalibration` accepts the output, the run is deterministic (V29), and `REPORT_SECTIONS` ends with `## 11. Today's market`, which the report contains.
- `pipeline/test/version.test.ts` (extended): the `it.each` of hashed directories (`version.test.ts:88-105`) gains `['src/lib/sim/finance', 'src/lib/sim/finance/prototypes.ts']` (the temp repository seeds that file), and `does not cover other sim code` still passes.
- `pipeline/test/lesscars-runs.test.ts` (extended): the base input from `buildSimInput` carries `market`, and the plan and baseline inputs keep the same array.
- `pipeline/test/golden.test.ts`: unchanged code; it now compares the regenerated goldens.
- `pipeline/test/fzp-cal/calibration-step.test.ts` (amendment of 2026-11-10): the existing test "reads the market enrichment from marketPath and rejects one that does not parse" keeps its schema case (`{}`) and gains a syntax case: a `market.json` holding `{` is rejected with a `CalibrationError` whose message starts `market: <that path>: `, and nothing is written.

**Server project (Vitest, node)**

- `src/lib/timelapse/model.test.ts` (extended): `parseCalibration` accepts a valid `market` (the live shape and the fixture shape) and an absent one, and accepts an unknown top-level key. It rejects, with the exact path and message: each missing key, each extra key, `years` not three years apart, a non-integer or zero count, `observed.private > observed.all`, a non-positive `implied`, a level more than 1e-5 from the logarithm of its counts, a non-finite or out-of-range level, a non-positive `perCostShare`, a bad provenance. `initiationLogit` composes with `initiationHazard`: `1 / (1 + exp(−z))` equals it bit for bit on the mini calibration.
- `src/lib/sim/scenario/market.spec.ts`: `marketSteps(undefined, …)` is `[]`; levels `'all'` and `'private'` give one step at `asOf` with that value; each call returns a fresh array. `marketLevel` returns `'all'` for a calibration without a market, with a market, and with a market and a `baselineFunding` key (`finance-engine` changes that last case to `'private'` when it gives `marketLevel` F3's rule).
- `src/lib/sim/scenario/input.spec.ts` (extended): `buildSimInput` sets `market` from a calibration with a market at level `'all'` (also when the calibration carries `baselineFunding`), omits the key without one, and warns once. With market absent, precompute hazards are bit-identical to `initiationHazard`. With one step `s`, `hazard[i] === 1 / (1 + exp(−(z_i + s)))`. Candidates are the same under s = −3 and s = 0.
- `src/lib/sim/scenario/engine-market.spec.ts`:
  - (a) **identity**: on the mini input with a terms-free initiation model, one step `s` at `asOf` gives schedules deep-equal to a run with no market whose intercept is shifted by `s`, for three seeds;
  - (b) a later step at day d with shift −50 gives no simulated start whose initiation month begins on or after d;
  - (c) composition: with a regime day and a market day (distinct, then equal), a candidate's initiation month equals `piecewiseMonth` on hand-built merged bounds and rates, and the project's view is the segment's view;
  - (d) three steps run and are deterministic;
  - (e) each `RangeError` message;
  - (f) a `skipAbove` property under random steps: no u ≤ bound is skipped and no u > bound would start by the horizon (extending `initiation.property.spec.ts`).
- `src/lib/sim/scenario/policy.spec.ts` and `src/lib/sim/levers` apply tests (extended): `applyPolicies`, `bare()`, `twinInput('preFzp')` and `twinInput('fzp')` keep the base input's `market` array (same identity).
- `src/lib/sim/scenario/score.spec.ts` (extended): the Controller references carry the primary source URL and slide 18, no "press" or KQED text, tier 1, and units 8,504 and 14,646 unchanged.
- **Locks that must not change**: `src/lib/sim/scenario/fixtures/golden-seed1.json` (`simulate.golden.svelte.spec.ts`) and `src/lib/timelapse/fixtures/model-golden.json` pass untouched.

**Client project (Vitest, browser)**

- `src/lib/fzp/market-view.spec.ts` (new): `marketSentence` on a calibration fragment with the live counts (`years [2023, 2025]`, `observed { all: 129, private: 116 }`, `implied 245.521`, initiation window from 2007) gives exactly the `'all'` text of section 4.11 with "129", "246" and "52%"; on the fixture shape (no window) the short form with "10", "20" and "50%", and for `'private'` "9" and "45%"; `null` without a market.
- `src/lib/fzp/SimResults.svelte.spec.ts` (extended): with `market` set, the Sources disclosure (`SimResults.svelte.spec.ts:78`'s helper opens it) contains `fzp-market` with the text, directly after the first paragraph; with `market` absent or `null`, no `fzp-market` element.
- `src/lib/fzp/provenance.spec.ts` and `SourcesDialog.svelte.spec.ts` (extended): with a calibration carrying `market`, "Where new projects start" has `MARKET_INTRO_SENTENCE`, and `src-market` follows it with `MARKET_HOLD_SENTENCE`, the "Today's level" entry with tier 2's label, the all-starts line marked "In force.", the private line marked "Not in force until public funding is modelled.", the cross-check line, and no "Not from San Francisco records" note. Without `market`, none of them appears. Label text updates in `src/lib/fzp/fixtures/timeline-score.ts` and `chart.spec.ts` follow the new reference labels.

**Playwright e2e**

- `e2e/fzp.spec.ts` (extended), on `fixture-0` through `FZP_PATH` (`/sim`): `openScore` (`e2e/fzp.spec.ts:91-101`) opens the Results' Sources; `fzp-market` contains `observed.all`, `Math.round(implied)` and the percent, each read from `fixture-0/scenarios/fzp/calibration.json` through `readJson` (`e2e/fzp.spec.ts:31-32`), never hard-coded (`docs/dev/fzp-mode.md:118`). "Where these numbers come from" opens the dialog, which shows "Today's market" with "Assumption, not data" (tier 4 on the fixture), and `expectNoA11yViolations` passes on the open disclosure and on the open dialog.

**Goldens and fixtures (Release 1 only; one reviewed change)**

Following the design's "How a release is built", this subsystem's branch does not regenerate goldens, build, upload or sign off on its own: it merges into the Release 1 branch when its own tests pass. The tests that compare against goldens it moves (`golden.test.ts` and the lesscars fixture goldens) are expected to fail on this branch alone, and pass once the release branch regenerates. On the release branch, after `finance-data` has merged, `npm run pipeline -- fixture --update-golden` regenerates the goldens once. This subsystem's change is expected to move:

- `pipeline/test/fixtures/mini/golden/scenarios/fzp/calibration.json` (gains `market`, with `years`, `observed`, `implied`);
- `golden/derived/calibration-report.md` (section 11, the counts);
- `golden/derived/project-histories.json` (`planningProposed`);
- `golden/scenarios/lesscars/**` (the base runs now shift by −0.693147);
- `e2e/fixtures/data/fixture-0/**`.

`finance-data` moves some of the same files (its calibration keys, report sections 12 and 13, `projects.json`); the one regeneration covers both. The diff is reviewed as an engine and data change. The release branch then builds the live dataset (the new `PATHS` entry and every hashed change give a new version), uploads and verifies it, rebuilds `/lesscars` in that build, and runs signoff once. `golden-seed1.json` and `model-golden.json` do not change.

## 7. Acceptance criteria

1. `calibration.json` of the Release 1 live build has `market` after `phaseGap`, `parseCalibration` accepts it, and its four provenances have tiers 2, 3, 2 and 3 (F2; evidence hierarchy).
2. `market.today.years` is `[2023, 2025]`; `observed.all` and `implied` equal the sums of the "Plausibility" table's observed and implied columns over those years; `today.all = sig6(ln(observed.all ÷ implied))`; `today.private` uses the same `implied` with affordable-cohort starts removed (F2; OD-F11).
3. **The live value**: `|today.all − (−0.643571)| ≤ 0.10` (tier 4 tolerance; −0.643571 = ln(129 ÷ 245.521) on dataset `2026-11-04-bbb2eba1`, calibration report section 5, "Plausibility"), or the Release 1 PR and `docs/dev/market.md` state the difference with the per-year table of section 11 and its cause (a source refresh adding events, the road-lots change of `docs/dev/road-lots.md:462-463`, or another named change) (F2; R3).
4. The reproduction check in section 11 prints X within 2% of `observed.all`, and no reproduction warning fires (F2: "the shifted engine reproduces those years' count").
5. The hold-out ratio is printed in section 11 and is in no field of `calibration.json`; changing the hold-out does not change `market` (test) (F2; OD-F11).
6. `crossCheck.logOdds` and both `crossChecks` are in the calibration and the report, and no code path reads them into a run (F2; tension 7).
7. No yearly price value is in the repository, the calibration or the report (tension 7; open data only).
8. `isAffordableCohort`, `startCohort` and `AFFORDABLE_COHORT_SHARE` are exported from `pipeline/lib/affordable-cohort.ts`, and `today.private` is computed with them (design, "Dependency order", step 1).
9. With `market` absent, every engine output is identical to today's: `golden-seed1.json` and `model-golden.json` unchanged, and the hazard bit-identity test passes (global constraint "Goldens change only at the two releases").
10. A single step at `asOf` is equivalent to an intercept shift (test 6a), later steps compose with `regimes` (6c), any number of steps runs (6d), and `skipAbove` is safe (6f) (F3; R7).
11. The `/sim` FZP input, both twins, `/s/<id>` and the `/lesscars` base, plan and baseline inputs all carry the same `market`, at the level `marketLevel` returns, which is `'all'` in Release 1 (F3; "the twin runs on the same market"; "everything that runs the engine gets it").
12. In-flight rows, stages, sizes and revisions are unchanged by a market (F3; R8).
13. The existing performance budgets hold unchanged (F18's "with `finance` absent").
14. The Controller references cite the primary report, slide 18, and say the comparison assumes a recovery the simulation does not model (tension 6).
15. On `/sim` and `/s/<id>`, the Results face's Sources disclosure states today's market with the observed and implied counts and the percent, as section 4.11 words it; the sources dialog shows "Today's market" with its tier; the a11y gate passes on both (design, Subsystems row: "the page must say why"; evidence hierarchy; house rules).
16. `PATHS` in `pipeline/lib/version.ts` includes `src/lib/sim/finance`, and the version test covers it (global constraint "The engine is in the dataset version").
17. Release 1, on the Release 1 branch: the goldens and `fixture-0` are regenerated once by `fixture --update-golden`; the live dataset is built, uploaded and verified once, before the release's single signoff; `/lesscars` is rebuilt in that build; this subsystem's own branch did none of these (R3; "Goldens change only at the two releases"; "The engine is in the dataset version").

## 8. Developer documentation

- **New `docs/dev/market.md`** ("Today's market"), linked from `CLAUDE.md`'s scoped list as: "**Today's market (`calibration.market`, the start-odds shift, `market.json`, `SimInput.market` steps, the affordable-cohort flag)** — [docs/dev/market.md](docs/dev/market.md)". It must say:
  - the quantities and their formulas, periods and tiers: `today` measured against the published model on the last three panel years, with `years`, `observed` and `implied`, and why not against the hold-out (OD-F11);
  - the affordable-cohort flag, its counting choices, and that `finance-data` imports it;
  - the live and fixture values of the Release 1 build;
  - the enrichment file's rules (coefficients verified; cost index yearly; price as two period means only, and why; the reference mean as their year-weighted mean);
  - the engine contract (steps, month granularity, composition with `regimes`, `skipAbove`, memoisation, what does not read it);
  - `marketLevel` as the one rule for the level, `'all'` until Release 2;
  - report section 11, the reproduction check and the hold-out diagnostic;
  - the acceptance check of section 7.3 and its outcome.
- **`docs/dev/pipeline.md`**: "Where things land" gains `pipeline/enrichment/market.json`; `calibration.json`'s entry says it carries `market`; the list of hashed code in the `datasetVersion` paragraph (`pipeline.md:78`) gains `src/lib/sim/finance/`.
- **`docs/dev/sim-levers.md`**: `bare()` and both twins keep `market` (the market is the world, not the policy).
- **`docs/dev/lesscars.md`**: one dated note for the Release 1 rebuild: the dataset version, that the base input now runs on today's market, and the changed headline numbers of the published plan.
- **`docs/dev/fzp-mode.md`**: the Results' Sources paragraph (`fzp-market`, `marketSentence`, the `market` prop) and the dialog's `src-market` section, and that `funding-ui` extends both in Release 2.

## 9. Open questions

1. **The report's official URL.** The verified copy is hosted by Mission Local, not by the City. *Default*: cite it as the Controller's report (Items 250700 and 250701) at that URL. If the builder finds the same PDF on sf.gov or the Board's Legistar, use that URL in `market.json`, which also re-sources `score.ts`.
2. **Starts with no Planning record or no recorded counts.** *Default*: count as private (section 4.1), reported by count.
3. **The acceptance tolerance on `today.all`.** *Default*: 0.10 in log-odds (about 10% on the odds), tier 4.
4. **`MIN_SIM_DATASET`** (`scripts/dataset-version.spec.ts:11`). *Default*: unchanged. `/sim` runs on a calibration without `market` (shift 0, and no market paragraph), so no older dataset becomes unusable.

## 10. Interface concerns

None open.

**Resolved** (at reconciliation and in the fidelity round; no longer open):

- `today.*` measured against a different model from the one it shifts: settled by OD-F11 and row F2 (published model; hold-out report-only; `years`, `observed`, `implied`).
- No exported list of prototypes and no `$lib`-free home for `Sourced`: settled by row F4 (`PROTOTYPES`; `src/lib/sim/finance/evidence.ts`).
- Adding `src/lib/sim/finance` to `PATHS`: settled by the global constraint "The engine is in the dataset version" (this spec does it, section 4.12).
- The shared affordable-cohort flag: settled by "Dependency order" step 1 (owned here, reused by `finance-data`; row F12).
- Calibration key order: settled by "Dependency order" step 1 (`market` after `phaseGap`; `finance-data`'s keys after `market`).
- The design's illustrative numbers: settled by OD-F11 and OD-F9a (−0.64; slope about 1.75; about 12% for $50,000), which this spec's estimates match; the matched-period cross-check (−1.29) lies within the design's "about −1.2 to −1.5".
- Month granularity of "from `from` on": settled by row F3 ("a month falls under the step in force on its first day").
- What the market sentence can cite (`funding-ui` concern 5): settled by row F2 (`years`, `observed`, `implied`); the sentence ships in Release 1 here.
- F2's "lot-years" against a monthly hazard: settled by row F2, which now says "lot-months" (`impliedPerYear` sums parcel-months, `initiation.ts:400`).
- The shifted engine reproducing the recent years only approximately: settled by row F2 ("reproduces those years' count closely, which the pipeline checks"); the check is section 4.4's reproduction check.
- `funding-ui` choosing the level by its own rule: settled by row F3, which names `marketLevel` as the one rule that `buildSimInput` and the page both call.
- `funding-ui` showing the cross-check as a dialog entry with the false "Not from San Francisco records" note: settled in `funding-ui`, which keeps it a line of `src-market`, as section 4.11 does.
- The step-0 declarations (`MarketStep`, `MarketModel`, `Calibration.market?`, `SimInput.market?`): settled by "Dependency order" item 0; this spec adds their behaviour, not the declarations.
- How Release 1 is built and signed off: settled by "Dependency order", "How a release is built" (section 6, "Goldens and fixtures").
- Row F12 built against but not embedded: settled by "Row ownership" (`market-baseline` consumes F12); the row is embedded in section 2.

## Amendment of 2026-11-10 (reappraisal 1)

Release 1 shipped with one gap between this spec's developer documentation and the code (`.superpowers/superconductor/sim-financing/as-built-r1.md`, section 2, finding 4). `docs/dev/market.md`, "Live failures", lists "an unparseable `market.json`" as a `CalibrationError`. The step called `JSON.parse` before `parseMarketFile`, so a file that is not valid JSON escaped as a bare `SyntaxError` with no path. The build still failed; only the message was poor. The first version of section 4.4 said "does not parse" and did not say which of the two cases it meant.

Section 4.4 now names both cases and gives the reader function, and section 6 gains the test. `docs/dev/market.md` needs no change: its sentence becomes true. The fix is in `pipeline/`, a hashed path, so it was deferred from Release 1 (a rebuild for a message was not worth it) and is built as the design's "Dependency order" item 2a, in Release 2's dataset build. It changes no dataset value.

## Note on the cited records

Numbers marked "inferred, history tabulation" come from a read-only script over `project-histories.json` and the locked Planning-project pages of build `2026-11-04-bbb2eba1`, which counts histories rather than panel events. The pipeline's panel decides the shipped values.
