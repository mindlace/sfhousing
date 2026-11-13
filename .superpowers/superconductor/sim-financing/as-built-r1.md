# Release 1 as built (sim-financing), and its drift from the model

Reader: a fresh comprehension pass, read-only, on `superconductor/sim-financing` at `77f16560`
(worktree `.claude/worktrees/comprehension-r1`, base `5d62260b`). The branch holds step 0
(`b59c0731`), `finance-model`, `market-baseline` and `finance-data`. The goldens, `fixture-0` and the
live dataset have not been regenerated or built: `pipeline/test/fixtures/mini/golden/scenarios/fzp/calibration.json`
and `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json` contain no `market` key.

Section 1 was written from the code before reading the design and specs, which were read for section 2
only. Nothing was run: every claim rests on reading the code and tests. No operator plan or review was read.

Citations are `path:line` at `77f16560`.

---

## 1. Explained as built

### 1.1 Today's market: how it is measured and how it reaches a lot's hazard

**What counts as a start.** The initiation panel already places one event per project history: the
first Planning record from 2015 on, and the first new-construction permit filing before that. The
branch keeps a record of each counted event. `initiationEvents` attaches a `StartMeta` to each event
it places. That meta is the history's cohort, its gross homes (the first positive of
`unitsAt.filed/permitFiled/complete`) and its `storiesProposed` (`pipeline/lib/fzp-cal/panel.ts:217-232`,
`startHomes` at `:80-87`). `aggregatePanel` then pushes a `PanelStart { year, basis, cohort, homes, stories }`
for exactly the events the fit counts, and throws if a counted event has no meta
(`panel.ts:347-357`).

**Cohort.** `startCohort` (`pipeline/lib/affordable-cohort.ts:9-13`) reads the history's new
`planningProposed` pair, the primary Planning record's `number_of_units_prop` and
`number_affordable_units_prop` (set in `pipeline/project-records/derive.ts:578-580`):

- null gives `noRecord`;
- units null or ≤ 0, or affordable null, gives `unknown`;
- affordable ≥ 0.95 × units gives `affordable`;
- anything else gives `private`.

Only `affordable` is removed from the private count. `noRecord` and `unknown` count as private
(`market.ts:142-143`).

**The quantities** (`pipeline/lib/fzp-cal/market.ts:102-222`, `marketToday`). The recent years are
`[L−2, L]`, where L is the largest key of `impliedPerYear` (`:79-87`). Those keys run 2007 to 2025, so
the recent years are 2023 to 2025.

- `O` = Σ `observedPerYear` over the recent years. That is every panel event of both bases, from
  the initiation report (`pipeline/lib/fzp-cal/initiation.ts:409-412`).
- The count of recent `PanelStart`s must equal O, or the build throws (`market.ts:137-141`).
- `A` = the recent starts in the affordable cohort, and `O_p = O − A`.
- `I = sig6(Σ impliedPerYear)`. Each year's implied value is Σ exposure × the published model's
  basis-0 hazard over that year's cells (`initiation.ts:373, 409-411`). So `I` is measured against
  the published model, the one the engine runs.
- `today.all = sig6(ln(O/I))` and `today.private = sig6(ln(O_p/I))` (`market.ts:150-151`).
- A reproduction check `X = Σ exposure × logistic(z + all)` runs over `recentCells`. These are the
  cells of 2023 to 2025 with their basis-0 linear predictor (`initiation.ts:413-415`). `X` is only a
  warning at 2% (`market.ts:152-163`).
- The hold-out is passed in but goes only into the report and warnings (`market.ts:166-182`). It
  is not in `today` or its provenance method.
- `today.provenance` is tier 2, with n = O and the window 2023-01-01 to 2025-12-31
  (`market.ts:198-212`).
- A fixture build returns invented counts instead (10 observed, 9 private, 20 implied), giving
  ln 0.5 and ln 0.45, at tier 4 (`market.ts:41, 110-133`).

**Into `calibration.json`.** `calibrate()` calls `marketModel` after `fitInitiation`
(`pipeline/lib/fzp-cal/calibrate.ts:145-154`). It emits `market` after `phaseGap` (`:187`), and
`parseCalibration` validates it (`src/lib/timelapse/model.ts:788-850, 1064`). The validation checks:

- the exact key sets;
- `years[1] = years[0] + 2`;
- the counts are integers ≥ 1, with `private ≤ all`;
- `implied > 0`;
- each level lies in [−10, 10] and within 1e-5 of ln(count ÷ implied);
- `perCostShare > 0`.

**Into the engine.** `buildSimInput` (`src/lib/sim/scenario/input.ts:52-75`) warns once when
`calibration.market` is absent (`:65`). It then calls
`marketSteps(calibration.market, projects.asOf, marketLevel(calibration))` (`:66`).
`src/lib/sim/scenario/market.ts:7-13` gives `[{ from: asOf, logOdds: today[level] }]`, or `[]`. The
key is omitted when the result is empty (`input.ts:73`).

`precomputeOf` (`input.ts:313-413`) then does the following:

- It takes `s0`, the last step at or before `asOf` (`:325-333`).
- It computes `z = initiationLogit(model, features)` (new, `src/lib/timelapse/model.ts:395-399`) and
  sets `hazard[i] = 1/(1+exp(−(z+s0)))` (`input.ts:354-356`).
- Each later step gets its own `stepLog1mh` array (`:357-359`).
- A row is a candidate when it is hostable and some step gives a positive hazard (`:372-379`).
- `segmentsOf` merges the regime days and the later market days into one boundary list. Each
  segment records which regime view and which step's log(1−h) it uses (`:421-444`).

`simulatedPass` reads `segments.log1mh` for the piecewise month and `segments.view` for the view
(`src/lib/sim/scenario/engine.ts:1022-1060`). `checkInput` rejects a non-finite step, steps not in
ascending order, or a first step after `asOf` (`engine.ts:249-266`).

In Release 1 there is exactly one step, at `asOf`, so the shift is a constant added to every lot's
log-odds. The monthly start hazard of lot i is `logistic(z_i + today.all)`. In-flight rows, sizes,
revisions and stage steps do not read it.

**Which level runs, and who decides.** `marketLevel(calibration)` (`src/lib/sim/scenario/market.ts:20-23`)
returns `'all'` unconditionally in Release 1. The same function is called by `buildSimInput`
(`input.ts:66`), by the Results sentence (`src/lib/fzp/FzpMode.svelte:1029`) and by the dialog's
"In force" line (`src/lib/fzp/provenance.ts:230`).

**Who gets it.** These all carry `market`:

- `/sim` and `/s/<id>`, through `load.ts:402` → `buildSimInput`;
- the twin, through `applyPolicies` and `bare()`, which strips only `newProjects` and `inFlightScale`
  (`src/lib/sim/levers/apply.ts:43-50`);
- `/lesscars`, whose `pipeline/steps/lesscars.ts:474` base comes from `buildSimInput`, spread into
  `planInput` and `baselineInput` at `pipeline/lib/lesscars/runs.ts:293-305`.

### 1.2 The public-money slope

`marketModel` (`market.ts:322-525`) computes `slope.perCostShare = sig6(−today.private ÷ typicalUncoveredShare)` (`:420`).

- **Weights** (`:374-405`): the private starts (cohort ≠ `affordable`) of the last five panel years
  (`WEIGHT_YEARS = 5`, 2021 to 2025), binned to a prototype by `prototypeFor`.
  - Homes < 25 gives E whatever the stories, passed as stories 0 (`:261-270`).
  - Homes null, or homes ≥ 25 with stories null, is unbinned and left out (counted in the report).
  - `w_p` is the binned starts in prototype p over all binned starts.
  - The fixture with no binned start falls back to equal weights of 0.2. A live build with no binned
    start throws (`:384-387`).
- `typicalUncoveredShare = Σ w_p × uncoveredPerHome('market', p) ÷ costPerHome('market', p)`, which
  is `(shortfall + 65,000) ÷ cost` (`:406-412`). The same loop computes `typicalCostOverValue`.
- **Cross-checks** are reported only:
  - `costCoefficient = −β_c × C̄_H`;
  - `priceCoefficient = β_p × P̄_H × typicalCostOverValue` (`:421-422`);
  - `crossCheck.logOdds = β_c(C̄_H − C̄_R) + β_p(P̄_H − P̄_R)`, on indices lagged two years from
    `pipeline/enrichment/market.json`. The price index enters only as two period means, and the code
    asserts their periods (`:285-314, 334-339`). On the committed readings this is about −1.29.
- **Tiers**: the slope is tier 2 and the cross-checks are tier 3 (tier 4 in the fixture). No code
  path reads `slope` or the cross-checks into a run.

### 1.3 What `finance-model` computes (`src/lib/sim/finance/`, pure, relative imports only)

**Evidence types.** `Sourced`, `Unsourced` and `Evidence` now live in `evidence.ts:5-13`, and
`src/lib/sim-page/timing-sources.ts:5,10` re-exports them.

**Prototypes and uncovered cost** (`prototypes.ts`).
- Prototypes A to E carry the Controller's stories, homes, cost and shortfall (tier 1) (`:72-78`).
- `PROTOTYPE_BINNING` is tier 4 (`:80-93`).
- `prototypeFor`: under 25 homes is E; otherwise ≤ 6 stories A, ≤ 10 B, ≤ 18 C, else D (`:95-104`).
- `LAND_PER_HOME` = 65,000, tier 2 (`:106-118`).
- `AFFORDABLE` = { cost 954,127; own 92,602 }, tier 1 (`:120-132`).
- `uncoveredPerHome`: market is shortfall + land; affordable is 954,127 − 92,602 = 861,525
  (`:140-145`).
- `costPerHome`: market is the prototype's cost; affordable is 954,127 (`:148-151`).

**Market terms** (`terms.ts`).

| Term | Value | Tier |
| --- | --- | --- |
| `constructionRate` | 0.085 | 3 (Terner) |
| `constructionYears` | 1.917 | 2 (from an earlier dataset's construction table) |
| `requiredReturn` | 0.06 | 1 |
| `guaranteeRateCut` | Unsourced, with a reason | n/a |
| `lossOnExit` | 1 | 4 |

The table is `terms.ts:48-118`. The other constants:

- `CONSTRUCTION_LOAN_TO_COST` 0.55 (tier 3, presets only);
- `DRAW_UP_FRONT` 0.10 (tier 4);
- `AVERAGE_DRAWN` = 0.10 + 0.90 ÷ 2 = 0.55 (tier 4) (`:130-168`).

`resolveTerms` lets a typed value, range-checked, replace a term, and sorts the typed keys into
`custom` (`:170-191`).

**Grant-equivalents** (`instruments.ts:125-173`).
- A grant is worth `share × U`.
- A loan's saving is `costShare·C × max(0, rate_T − rate) × years × 0.55`. When the loan's accepted
  return is below the market's, it adds `costShare·V·(r_T ÷ r − 1)`, with V = C − shortfall for
  market and 92,602 for affordable. The total is capped at the principal.
- A guarantee is worth `costShare·C × rateCut × years × 0.55`.
- The result is rounded once.
- `validateInstrument` is the single bounds check (`:41-85`). `termsNeeded` and `missingTerms` guard
  null terms (`:88-119`).

**Coverage and odds.** `coverage = g ÷ U` and `oddsShift = slope × g ÷ C`. Both are unrounded and
uncapped (`:182-191`).

**`isCertain`** is `coverage ≥ 1 − 1e-9`, a floating-point tolerance (`:13-18`).

**`fundBundle`** (`:236-302`) prices a bundle per home.
- `tierOf` places each pool kind in a fill tier: federal 0, state 1, the City 2 (`:214-229`).
- The first pass sums each tier's loan and guarantee grant-equivalents `L_t` and its grant amounts
  `S_t`.
- The second pass walks the tiers in order with `R` = what remains of U. Loans and guarantees count
  in full (`R = max(0, R − L_t)`). If the tier's grants fit (`S_t ≤ R`), each pays its full share.
  Otherwise every grant in that tier is scaled by `R ÷ S_t`, the tier's total is taken as R, and R
  becomes 0. This is how the City's sources share what is left in proportion to their shares.
- It returns per-item `{ grantEquivalent, granted, lent, guaranteed, reserve }` (exact, per home),
  plus the total, `coverage` and `certain`.
- `projectDollars` is the one place per-home amounts become whole dollars (`:305-307`).

**Inclusionary tiers** (`tiers.ts`).
- `AMI_TIER_BOUNDS` 0.5 / 0.8 / 1.2 and `tierOfAmi`, tier 1 (`:35-65`).
- `INCLUSIONARY` (`:89-119`), tier 1 rates stored as basis points:
  - rental 10 to 24 homes: 15% at 55% AMI;
  - rental 25 or more: 10% at 55%, 4% at 80%, 4% at 110%;
  - ownership 10 to 24: 15% at 80%;
  - ownership 25 or more: 10% at 80%, 5% at 105%, 5% at 130%.
- The rounding rule is labelled tier 4.
- `ASSUMED_TENURE` is rental, tier 2 (`:121-132`).
- `inclusionaryUnits`: the total is `floor((homes × bp + 5000) ÷ 10000)`, split by largest remainder,
  ties to the lower tier (`:134-163`).
- `DISPLACEMENT_RANGE` 0.115 to 0.8, tier 3 (`:165-182`).

**Debt service and the legal limits** (`debt.ts`).
- `validateDebt` accepts a rate in (0, 0.25] and a whole-number term of 1 to 40 years (`:11-24`).
- `debtService` gives the level annual payment and the total repaid, each rounded once (`:27-38`).
- `DEBT_LIMITS`: 11 tier 1 constants from the Budget Analyst and Resolution 562-24 (`:67-172`).
- `limitStatements(borrowing)` (`:183-287`):
  - when general-obligation principal is above 0, it states `goRate` (always exceeded, tier 2),
    `goCap` (exceeded when $2.67 billion plus the principal is over 3% × $353.6 billion, tier 2) and
    `goVote` (always, tier 1);
  - when certificate-of-participation debt service is above 0, it states `copCap` (always, tier 2).
  - Nothing is enforced.

### 1.4 What the calibration and `projects.json` now carry

**`calibration.market`**: `today`, `crossCheck` and `slope`, as in 1.1 and 1.2.

**`calibration.affordableRoutes`** (`pipeline/lib/fzp-cal/affordable.ts:63-117`). These are the pathway
shares of cohort histories, where the cohort is: flagged `affordable`, `planningProposed.units` ≥ 10
(`:31-35`), a known pathway, and a first record in `[PLANNING_START, asOf]`.
- With n ≥ 30 the shares come from `roundShares`, tier 0.
- With n < 30 they are copied from `pathwayForNew` at tier 4. A live build also warns
  (`calibrate.ts:253`).

**`calibration.baselineFunding`** (`pipeline/lib/fzp-cal/funding.ts:185-437`), built from
`pipeline/enrichment/funding.json` (schema and the cross-check against `AFFORDABLE` in
`pipeline/enrichment/funding-schema.ts:143-262`) and the locked MOHCD rows.
- **Pools** (`:212-252`):
  - six City pools, one per Exhibit E source, each with one yearly inflow from `asOf` with no end,
    held level. `city-debt` is `goBond` with debt 6% over 20 years;
  - `state`, $150 million a year;
  - `federal-tax-credits`, uncapped, with no inflows.
  - Every pool has leverage 1.
- **Programmes** (`:257-267`): one grant per pool, `baseline-<pool id>`, reaching affordable
  projects, from `asOf` with no end.
  - The share is `roundShares` of the per-home dollars. A City pool's per-home dollars are
    $300,027 × its slice of $234 million; the state's are $118,390 and the federal $443,108. They
    sum to 861,525, which the code asserts before rounding (`:200-207`).
  - `tiers` and `minHomes` come from the MOHCD rows with program "MOHCD 100% Affordable (New
    Development)" and type "New Construction".
  - The AMI bands are mapped to tiers by their upper bound (`:44-59`), summed and normalised by
    `roundShares`. Undeclared homes are left out and tallied in `sc.funding.ami-undeclared`.
  - `minHomes` is the nearest-rank 10th percentile of `total_project_units` (`:97-140`).
- **`provenance`** has `pools.length + 1` entries (`:298-379`):
  - the City pools at tier 1 (FY2024-25, held level; the debt terms are written into the text as
    tier 2);
  - the state at tier 2 (a lower bound);
  - the federal pool at tier 2 ("uncapped", with the text admitting the claim rests on the digest);
  - the MOHCD mix at tier 0.
  - A fixture build relabels every entry tier 4.
- **`check`** (`:269-278, 387-400`):
  - implied = the least of `dollarsPerYear ÷ (share × 861,525)` over the capped pools;
  - observed = the new-construction award homes ÷ the number of award years;
  - it warns when they differ by more than half of observed. The check is tier 2.

**Validation and reporting.** `parseCalibration` validates both new keys
(`src/lib/timelapse/model.ts:1065-1067`). `checkPool` and `checkProgramme` are exported (`:905-990`).
`checkBaselineFunding` adds the baseline rules: grants only, no `u-` ids, unique ids, and the
provenance length (`:992-1060`). V25 adds build-side checks in `pipeline/lib/fzp-cal/invariants.ts`
(`fundingOutcomes`). Report sections 11 to 13 are listed at `pipeline/lib/fzp-cal/report.ts:103-105`.

**`projects.json`.**
- `InFlightProject.affordableHomes?` (`src/lib/timelapse/projects.ts:34`, validated at `:359-364`)
  comes from `affordableHomesOf` (`pipeline/project-records/derive.ts:621-631`). It is the primary
  Planning record's `affordableProp`, clamped to `units` (the clamp raises `pr.affordable.over-units`).
  It is null for split parts, multi-phase masters and projects with no primary record. A recorded 0
  ships as 0.
- `rhnaCompletedNet.byTier?` (`projects.ts:101`, which checks the five values sum to `units`,
  `:427-436`) comes from `addTiers` (`pipeline/project-records/rhna.ts:104-138`):
  - a row with n ≤ 0 goes to above moderate;
  - a row with known tiers adds extremely low plus very low, low and moderate, with the rest above
    moderate, scaled by largest remainder when the tiers exceed n;
  - a row with blank tiers adds `min(affordable_units, n)` to `unrecorded`, with the rest above
    moderate.

### 1.5 What reaches the user in Release 1

- **The Results paragraph.** `SimResults.svelte:233-237` renders `data-testid="fzp-market"`, the
  `marketSentence` (`src/lib/fzp/market-view.ts:18-34`). The text reads: "It runs on today's market.
  In 2023 to 2025, {n} new projects started, where the start model … expected {e}. So every lot's
  chance of starting is set to about {pct} …". The percent comes from the counts. On `/sim` and
  `/s/<id>` it is shown through `FzpMode.svelte:1029`.
- **The sources dialog** (`provenance.ts:219, 228-247, 422`):
  - "Where new projects start" gains an intro sentence;
  - a new section `src-market`, "Today's market", has the hold sentence and one tier-2 entry;
  - the entry's lines give the all-starts level ("In force."), the private level ("Not in force until
    public funding is modelled.") and the Controller cross-check (labelled tier 3, "not used").
- **The Controller references** are re-sourced to the primary report, slide 18, with a method that
  says the simulation holds today's market (`src/lib/sim/scenario/score.ts:311-378`).
- **Every number on the site moves.** The engine runs `logistic(z + today.all)` on `/sim`, on
  `/s/<id>` (where the dataset has a market) and in the `/lesscars` build.
- **No funding is visible.** No file under `src/` outside the type and validator files
  (`timelapse/types.ts`, `model.ts`, `projects.ts`) and a test fixture reads `baselineFunding`,
  `affordableRoutes`, `affordableHomes` or `byTier` (grep). `buildSimInput` never sets `finance`,
  and the engine has no code that reads `SimInput.finance`. `marketLevel` is `'all'`, so the private
  level and the slope are unused.

### 1.6 With no market and no finance, is the engine unchanged?

Yes, by construction and by test.

**By construction:**
- Without a market, `s0 = 0`, and `z + 0` is `z` exactly, so
  `1/(1+exp(−(z+0)))` = `initiationHazard`'s `1/(1+exp(−z))` (`model.ts:407-411`).
- There are no later steps, so `segments` reduce to the regime days. `view[j]` is j, and
  `log1mh[j]` is the base or regime arrays (`input.ts:421-444`). The candidate rule is the old one.
- `buildSimInput` omits the `market` key, so old inputs are deep-equal to before (`input.ts:73`).
- `SimInput.finance` is declared (`src/lib/sim/scenario/types.ts:123-129`) but nothing reads it.

**Tests that lock this:**
- `src/lib/sim/scenario/input.spec.ts:418`, "market absent or []: every hazard is bit-identical to
  initiationHazard". It also asserts the segments equal `{days: [], view: [0], log1mh: [log1mh]}`.
- `src/lib/timelapse/model.test.ts:81-99`: `initiationLogit` composes to `initiationHazard` bit for
  bit.
- `src/lib/sim/scenario/simulate.golden.shared.ts:31`, "reproduces every schedule exactly", against
  `fixtures/golden-seed1.json`. The mini calibration has no market, and that fixture is unchanged on
  the branch.
- `src/lib/timelapse/model.golden.shared.ts:43`, against `fixtures/model-golden.json` (unchanged).
- `src/lib/sim/scenario/engine-market.spec.ts:61`, test (a): one step equals an intercept shift.
  The same file's "in-flight rows do not read the market" is at `:231`.
- Pass-through tests: `src/lib/sim/levers/apply.spec.ts:193-194`,
  `src/lib/sim/scenario/policy.spec.ts:244` and `pipeline/test/lesscars-runs.test.ts:569-570`.

The F9 test ("finance absent equals the engine before `finance-engine`") belongs to `finance-engine`
and does not exist yet. In Release 1 the two goldens stand in for it.

---

## 2. Drift

Classes:
- **M** (model-drift): contradicts a model section, an M row or a global constraint;
- **D** (decomposition-drift): contradicts a D row or a spec detail;
- **Doc** (doc-drift): a developer doc says something the code does not do;
- **G** (gap): the model requires it for Release 1 and it is not there.

**V** means verified (both sides read). **U** means unverified.

### Model-drift

1. **M, V, arguable. The City pools' provenance is tier 1, but each pool's share is an inference.**
   - Code: `funding.ts:308-324` labels each City pool tier 1.
   - The pool's `share` is the City's Exhibit F $300,027 split in proportion to Exhibit E spending.
     The finance-data spec calls the shares "tier 1 and tier 2 arithmetic" (spec 4.6, "Shares").
   - The inflow held level with no end is the OD-F3 assumption.
   - For `city-debt`, the tier 2 debt terms are embedded in that tier 1 entry (`:302-307`).
   - Design, global constraint "Evidence hierarchy": "Every number … carries a `Provenance` with
     its tier". The shipped share has no entry at its own tier.
   - The code follows the spec ("A City pool's entry is tier 1", spec 4.6, "Provenance list"). The
     drift is the spec's against the global constraint.

### Decomposition-drift

2. **D, V. The "no MOHCD rows" failure is a `CalibrationError`, not a `BuildError`.**
   - Spec 4.6, "Failure": "No qualifying row with a band-coded home is a `BuildError`".
   - Code: `funding.ts:65, 127` and `:101` throw `CalibrationError`. That class is not a
     `BuildError` (`pipeline/lib/fzp-cal/types.ts:184`; `pipeline/lib/build-error.ts:2`).
   - `docs/dev/finance-data.md:166-169` matches the code, so the doc was moved to the code and the
     spec was not.
   - Practical effect: none. The build still fails.
3. **D, V. `ResolvedTerms.lossOnExit` is nullable.**
   - finance-model spec section 2 declares `lossOnExit: number`.
   - Step 0 declares `Record<TermKey, number | null> & { custom }` (`src/lib/timelapse/types.ts:292`),
     so `lossOnExit` is `number | null`.
   - Row F8's wording ("each term a number, or null when it is unsourced") allows the code's form,
     and `MARKET_TERMS.lossOnExit` is always `Sourced`, so the value is never null. This only matters
     for `finance-engine`'s types.

### Doc-drift

4. **Doc, V. Not every unparseable `market.json` is a `CalibrationError`.**
   - `docs/dev/market.md:205-208` lists "an unparseable `market.json`" among the `CalibrationError`
     live failures.
   - Code: `pipeline/steps/calibration.ts` calls `JSON.parse(readFileSync(marketPath))` before
     `parseMarketFile`. A JSON syntax error therefore escapes as a bare `SyntaxError` with no path.
     Only schema failures are `CalibrationError` (`pipeline/enrichment/market-schema.ts:64-68`).
   - `funding.json` wraps its syntax errors (`readFundingFile`, `calibration.ts`). The spec form
     `market: <path>: <zod message>` covers only zod failures.
5. **Doc, V. The Release 1 records in the docs are still placeholders.**
   - `docs/dev/market.md:103-111` (live values, acceptance 7.3) and `docs/dev/lesscars.md` ("Release
     1 rebuild: today's market") hold placeholders.
   - Every "Live (expected …)" row in `docs/dev/finance-data.md` (for example `:82, :117-126, :175,
     :198`) is the spec's expectation, not a measurement.
   - This is honest and labelled, but these must be filled at the release (spec market-baseline
     sections 7.3 and 8).

### Gaps

6. **G, V. The Release 1 regeneration and build have not been done.**
   - Design "Dependency order" 2 and "How a release is built"; global constraint "Goldens change only
     at the two releases".
   - The pipeline golden calibration and `fixture-0` lack `market`, `affordableRoutes` and
     `baselineFunding` (grep shows 0 occurrences).
   - So `e2e/fzp.spec.ts:928` ("Results' Sources state today's market", which expects
     `calibration.market` to be defined), `pipeline/test/golden.test.ts` and the lesscars fixture
     goldens are expected to fail on this branch.
   - The live dataset has not been built, uploaded or verified, and `/lesscars` has not been
     rebuilt. Acceptance 7.3 (|today.all − (−0.6436)| ≤ 0.10) and the expected values (slope about
     1.75, implied 780 against observed 980, about 54 cohort histories) are therefore unmeasured.
   - This is expected by the task brief. It is listed because the model requires it for Release 1.
7. **G, V, minor. The federal pool's "uncapped" claim has no source in its provenance.**
   - Design section 3: "a pool without a ceiling, because the records show none binding San
     Francisco today". Row F12: the federal pool is uncapped.
   - Code: the provenance cites only BLA Exhibit F (the $443,108), and its method says the claim
     "rests on the design's evidence digest, not on a source listed here" (`funding.ts:338-355`). The
     `n` and `window` there describe the award rows, not the claim.
   - Global constraint "Evidence hierarchy": every number carries its tier and source. The uncapped
     flag shapes Release 2 arithmetic with no listed source, though it is honestly labelled.

### Checked and found to agree (no drift)

Each of these was read on both sides (V) unless marked.

- F2: `today` against the published model, the hold-out kept out of `market`, the three-year window,
  the five-year weights, `−today.private ÷ typicalUncoveredShare`, cross-checks never applied, and
  the provenance tiers (2, 3, 2, 3; 4 in the fixture).
- F3: `marketLevel` is the one rule and returns `'all'`. Steps compose with regimes on the merged
  segments, and a month falls under the step in force on its first day. Nothing else reads the
  market.
- F4 and F8 constants and formulas match the finance-model spec's tables and worked values
  (prototypes, land, the affordable figures, terms, `AVERAGE_DRAWN`, the loan cap, the `fundBundle`
  tiers and proportional sharing, `isCertain`, inclusionary, debt).
- F12 field shapes, the id rules, the stable ids and the `checkPool`/`checkProgramme` exports.
- MOHCD is in the lock with PDDL-1.0, and `/attribution` reads the manifest (`src/routes/attribution/+page.server.ts:2-14`).
- "No public money means no change": `finance` is never set, and both goldens are untouched.
- Hashed paths:
  - `src/lib/sim/finance` is in `PATHS` (`pipeline/lib/version.ts:51`), in chreode's dataset rule
    (`chreode.config.ts:26`) and in the pipeline workflow's path filters.
  - Every new pipeline import (`sim/finance`, `timelapse`, `enrichment/*`) is under a hashed path.
  - `src/lib/timelapse/model.ts` now imports `../sim/finance/{debt,instruments}`, which is hashed
    too.
  - The page code (`src/lib/fzp/market-view.ts`) is unhashed, as the spec places it (design says
    "`src/lib/sim-page/`"; the intent, keeping page code outside the hash, holds).
- Release 1 visibility: only the market shift and its sentence are shown; no funding is visible.
- `/s/<id>` uses the same `load.ts` path (U: not traced through `scenario-host` for `/s` specifically).
- The F18 performance budgets were not run (U).

### Observations (not drift; for the conductor)

- **The slope's provenance is tier 2 but rests on a tier 4 binning.** Its weights use the tier 4
  `PROTOTYPE_BINNING` and the tier 2 `LAND_PER_HOME`, and its method does not name the binning's
  tier (`market.ts:434-467`). The design itself sets the slope at tier 2 (F2, OD-F9a), so this is
  not drift.
- **Two cohort rules may drop homes in Release 2.**
  - The private level removes every start whose Planning record is ≥ 95% affordable, of any size
    (F2).
  - The baseline programmes reach only drawn sizes of at least `minHomes`, about 70 homes live (F12).
  - So in Release 2, small ≥ 95% affordable projects leave the private odds and cannot be funded by
    the baseline. R9's "nothing counted twice" also needs "nothing dropped". This is a design-level
    tension between F2 and F12, not a code difference.
- **The on-site inclusionary assumption has no constant yet.** Model section 5 says the on-site
  option is a tier 2 assumption "and says so". No Release 1 constant carries it: `INCLUSIONARY`'s
  provenance names the on-site column but not the assumption. It is worded in the funding-ui spec,
  Release 2.
- **The test fixture `miniMarket` is not self-consistent.** `src/lib/sim/scenario/fixtures/mini-market.ts`
  has `today.private` −0.7 against ln(200/447) = −0.804, and `miniFunding` has no pools. Both would
  fail `parseCalibration`. They are never parsed, so this is test-only.
- **The outstanding G.O. debt differs between the design and the code.** The design's evidence
  bullet says "about $2.5 billion outstanding". `DEBT_LIMITS.goOutstanding` is $2.67 billion,
  including anticipated issuances (verified by the spec, p. 104). The prose is not a model
  commitment.

### Counts

model-drift 1, decomposition-drift 2, doc-drift 2, gap 2.
