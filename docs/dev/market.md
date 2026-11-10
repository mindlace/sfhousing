# Today's market

The start model in `calibration.json` is fitted on 2007-2025 and so describes the **average
market** of those years. `calibration.market` adds a separate shift to every lot's log-odds of
starting a project, so the simulation runs on today's slower market instead. This page covers that
shift, the enrichment file behind its cross-check, the affordable-cohort flag, the engine contract
and report section 11. Design: `docs/superpowers/specs/2026-11-09-market-baseline-design.md`.

The market is the world, not the policy: it is carried by `SimInput.market`, never by the levers
(see [sim-levers.md](sim-levers.md)).

## The quantities (`calibration.market`)

`market` follows `phaseGap` in `calibration.json` (keys keep declaration order; `finance-data`'s
keys follow `market`). `parseCalibration` validates it when present; absent is valid and means
shift 0. All live values are rounded with `sig6` (6 significant digits). `implied` is rounded first,
the two levels are computed from the rounded `implied`, and every later quantity from the rounded
`today.private`, so the shipped fields agree exactly.

| Field                    | Formula                                                                                                    | Tier |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ---- |
| `today.years`            | `[L - 2, L]`, `L` the last panel year (`RECENT_YEARS = 3`)                                                 | 2    |
| `today.implied`          | `I = sig6(sum of impliedPerYear[y])` over the years: the starts the published model implies (lot-months)   | 2    |
| `today.observed.all`     | `O = sum of observedPerYear[y]`: every panel event, both bases                                             | 0    |
| `today.observed.private` | `O_p = O - A`, `A` the recent panel starts whose cohort is `'affordable'`                                  | 0, 2 |
| `today.all`              | `sig6(ln(O / I))`                                                                                          | 2    |
| `today.private`          | `sig6(ln(O_p / I))`, the same denominator                                                                  | 2    |
| `crossCheck.logOdds`     | `beta_c x (C_H - C_R) + beta_p x (P_H - P_R)`, never applied                                               | 3    |
| `slope.perCostShare`     | `-today.private / typicalUncoveredShare`, unused until Release 2                                           | 2    |
| `slope.crossChecks.*`    | `costCoefficient = -beta_c x C_H`; `priceCoefficient = beta_p x P_H x typicalCostOverValue`; never applied | 3    |

`today` is measured against the **published** model (the one the engine runs), on the last three
panel years, with `years`, `observed` and `implied` shipped so the page can say what it compares.
It is not measured against the hold-out (OD-F11): the hold-out is fitted on 2007-2022 only, so it
expects about three times today's starts, and the published model already contains part of the
slowdown. Applying the hold-out ratio on top would count that part twice. The hold-out ratio is a
report-only diagnostic and is in no field of `calibration.json`; changing the hold-out does not
change `market`.

The denominator of `today.private` stays the implied starts of every kind: the published model was
fitted on all starts, and the private level must restore the all-starts average when public money
closes the gap.

`typicalUncoveredShare = sum over prototypes p of w_p x uncoveredPerHome('market', p) / p.costPerHome`,
where `w_p` is the binned private starts of 2021-2025 in prototype `p` over all binned private
starts of those years. The prototypes are `PROTOTYPES` ([finance-model.md](finance-model.md)),
iterated A to E. `typicalCostOverValue = sum w_p x costPerHome / (costPerHome - shortfallPerHome)`.

`marketModel` also counts the recent years' `PanelStart`s and throws when the count differs from
`O`, so the cohort split is always of the same events.

### Prototype binning of a start

Each panel start carries the history's cohort, gross homes and `storiesProposed`. Homes are the
first positive of `unitsAt.filed`, `unitsAt.permitFiled`, `unitsAt.complete` (gross proposed homes,
which is what a prototype's `homes` counts), else `null`.

- **Homes < 25 with no recorded stories is prototype E**, through `prototypeFor(0, homes)` at one
  named call site: the function's signature takes a number, and homes < 25 gives E whatever the
  stories (spec 4.3). `prototypeFor` itself is untouched.
- **Homes >= 25 and no recorded stories is unbinned**: left out of the weights and counted in the
  report ("stories not recorded"). So is a start whose homes are `null` ("homes not recorded").
  There is no sourced way to place them, and imputing a prototype would invent a mix.

## The affordable-cohort flag

`pipeline/lib/affordable-cohort.ts` exports `startCohort`, `isAffordableCohort` and
`AFFORDABLE_COHORT_SHARE = 0.95`. `finance-data` imports them from there and defines no test of its
own. `history()` in `pipeline/project-records/derive.ts` sets `planningProposed` from the primary
Planning record (`{ units, affordable }`, or `null`), emitted after `quality` in
`project-histories.json`.

`startCohort(p)`:

- `p` null or absent: `'noRecord'`.
- `p.units` null or <= 0 (0 is "not recorded", ruling F1a), or `p.affordable` null: `'unknown'`.
- `p.affordable >= 0.95 x p.units`: `'affordable'` (19 of 20 is in; 18 of 20 is out). Tier 2 proxy
  for "publicly funded": the records carry no funding field.
- otherwise `'private'`.

**Counting.** A start counts as private unless its cohort is `'affordable'`: `'noRecord'` and
`'unknown'` count as private. The flag is a positive identification of the affordable cohort, and
the report states how many starts fell in each cohort so the choice is visible. Only the recent
years and the weight years read the cohort, so pre-2015 permit-basis starts are classified but
never read.

## Live and fixture values

**Fixture** (`fixture-0`, tier 4, labels begin `fixture:`): the fixture's start model is a fixed
hazard of 0.05 a month, so its implied starts measure nothing and the fixture market is fixed:
`years = [2023, 2025]`, `observed = { all: 10, private: 9 }`, `implied = 20`, so
`today.all = -0.693147` (ln 0.5) and `today.private = -0.798508` (ln 0.45). No reproduction check
and no hold-out diagnostic. `crossCheck` comes from `market.json` as live; `slope` and
`crossChecks` use the live formulas on the fixture panel's binned private starts of 2021-2025, or
equal weights of 0.2 when there are none.

**Expectations from the spec** (build `2026-11-04-bbb2eba1`, calibration report section 5,
"Plausibility"; these are the spec's readings, not this release's output): `observed.all` = 33 + 40

- 56 = 129; `implied` = 81.6109 + 81.7087 + 82.2016 = 245.521; `today.all` = ln(129 / 245.521) =
  -0.643571 (a factor of 0.525 on the odds); hold-out expectation 386.399, ln(129 / 386.399) =
  -1.09706 (report only).

**Release 1 live values: placeholder.** The live `today.*`, `observed.private`, the cohort counts,
`slope.perCostShare`, `crossCheck.logOdds` and the outcome of acceptance check 7.3 are filled here
at the Release 1 build, on the release branch, once the live dataset is built. This subsystem's own
branch builds no dataset.

**Acceptance 7.3 (to be recorded at the Release 1 build).** `|today.all - (-0.643571)| <= 0.10`
(tier 4 tolerance), or this page and the release PR state the difference with the per-year table of
report section 11 and its cause (a source refresh adding events, the road-lots change in
[road-lots.md](road-lots.md), or another named change). Outcome: placeholder.

## The enrichment file

`pipeline/enrichment/market.json`, committed; schema `pipeline/enrichment/market-schema.ts` (zod,
pipeline only). The calibration step reads it (`calibrate` does no I/O), and fixture builds read the
same file because the cross-check does not depend on the mini city. It holds the source
(_Family Zoning Plan: Economic Impact Report_, Items 250700 and 250701, 2025-10-29), the lag in
years (2, slide 30), the two coefficients (slide 31, verified) and the two indices.

- **Coefficients** are verified values from slide 31: `Construc_Cost_Real` -0.0992 and
  `Zillow_Price_Real` +0.0143.
- **The cost index is yearly**, one value per index year 2005 to 2023 inclusive, one decimal, read
  from the chart (tier 3, approximate). Its sources (BEA and Census QWI) are public data, so a
  yearly series may be committed. The schema rejects a missing year. A re-read changes a value only
  where it differs from the committed reading by more than 1 index point, and each change is logged
  in the release PR and here with the old and new values.
- **The price index is two period means only**, 2005-2020 and 2021-2023. It is Zillow's, which is
  not openly licensed, so no yearly price value is committed, shipped or printed (acceptance 7.7).
  The schema requires exactly two periods, and the code asserts that the second is the recent years
  minus `lagYears` and the first the panel years before them minus `lagYears`, so together they
  cover 2005-2023.
- **The reference mean `P_R` is their year-weighted mean**, `(16 x mean_2005-2020 + 3 x
mean_2021-2023) / 19`, which is exact for an equal-weight mean. Two adjacent periods are kept,
  not one 2005-2023 mean, so the file stays a plain quotation of what the chart shows.
- The calibration ships only derived scalars (`crossCheck.logOdds`,
  `crossChecks.priceCoefficient`); a provenance `method` may quote the coefficients and means,
  which is quotation of published figures, not a series.

The cross-check uses means of the indices lagged two years, as the Controller's model does:
`H` = recent years (index years 2021-2023) and `R` = all panel years (index years 2005-2023).
It is reported and never read into a run (acceptance 7.6). Its comparison with the simulation is
as odds ratios only: the Controller's model is annual, on a lot producing housing; ours is monthly,
on a project's first filing.

## The engine contract

`SimInput.market?: MarketStep[]` (`{ from, logOdds }`, declared in `src/lib/timelapse/types.ts` and
`src/lib/sim/scenario/types.ts`). `[]` and absent both mean shift 0.

- **Validation** (`checkInput`, memoised as today): `runEngine` throws a `RangeError` when a step's
  `logOdds` is not finite, when steps are not strictly ascending by `from`, or when the first step
  is after `asOf`.
- **Steps in force.** The last step with `from <= asOf` gives the starting shift `s0`; steps after
  `asOf` apply from their `from`. **Month granularity**: a month falls under the step in force on
  its first day, `r + 1 + floor((T - 1) x MONTH_DAYS)`, as `regimes` already apply it.
- **Precompute** (`precomputeOf`): `initiationLogit` (`src/lib/timelapse/model.ts`) returns the
  linear predictor `z`; `initiationHazard` is unchanged because `model-golden.json` locks it.
  `hazard = 1 / (1 + exp(-(z + s0)))`; with `s0 = 0`, `z + 0` is `z`, so hazards are bit-identical
  to today's (a test asserts it). Each later step adds a `Float64Array` of `ln(1 - hazard)`; with
  one step (Release 1) there is nothing extra.
- **Composition with `regimes`.** The segment boundaries are the union of the regime days and the
  later step days, sorted and merged; each segment has a `(view, step)` pair and
  `simulatedPass` fills the per-segment rates from it. With no later steps the path is today's.
- **`skipAbove`** stays a safe bound: `skipBounds` reads the same merged boundaries and rate
  arrays as the exact path, so a draw at or below the bound always takes the exact computation.
- **Memoisation** is by `SimInput` identity: a different `market` array is a different input and
  has its own precompute.
- **What does not read it**: in-flight rows, multi-phase masters and phases, size draws, revisions
  and stage steps. Only the initiation month of simulated starts does.
- **Candidates**: the unshifted rule, unless a hazard underflows to 0 under the shift.

Pass-through: `applyPolicies`, `bare()`, `twinInput` (both twins), `load.ts` and `/lesscars`' plan
and baseline inputs all carry `market` unchanged ([sim-levers.md](sim-levers.md)).

## `marketLevel`: the one rule for the level

`marketLevel(calibration)` (`src/lib/sim/scenario/market.ts`) returns `'all'` or `'private'`. It is
`'all'` in Release 1 for every calibration, including one that already carries `finance-data`'s
`baselineFunding`, because no funding runs before `finance-engine`. `buildSimInput` calls
`marketSteps(calibration.market, projects.asOf, marketLevel(calibration))` and **omits the key**
when that is empty, so existing inputs stay deep-equal to today's and `golden-seed1.json` is
untouched. When `calibration.market` is absent it warns once
(`calibration.json: no market model; the run uses the 2007-2025 average market`). The page's
sentence and the dialog's "In force" line call the same function, so the engine and the page cannot
state different levels. `finance-engine` (Release 2) changes the body to "`'private'` exactly when
`buildSimInput` also sets `finance`", with no dataset change of this subsystem's.

## The report: section 11, "Today's market"

`calibration-report.md` section 11 (after section 10; section 5 is unchanged) holds, in order: a
per-year table (`observed`, affordable cohort, private, implied, hold-out predicted); `today.all`,
`today.private`, years, counts and the cohort counts; the reproduction check; the hold-out
diagnostic; the weights table with the unbinned counts, `typicalUncoveredShare`, the slope and both
cross-check slopes; the cross-check with its four means and the gap to `today.all`; any market
warning. Fixture mode prints its fixed-levels line and the last two items.

- **Reproduction check** (report only): `X = sum exposure x logistic(z + today.all)` over the recent
  years' cells. It is close to `O` but not equal, because `logistic(z + s)` is not exactly
  `e^s x logistic(z)`. A warning fires when `|X - O| > 0.02 x O` (`BACKCAST_TOL`, tier 4); on the
  spec's build `X` is expected near 129. Live builds only.
- **Hold-out diagnostic** (report only, never in `calibration.market`):
  `ln(holdOut.observed / holdOut.predicted)`. If the hold-out refit failed, the report prints the
  error and a warning fires; the build does not fail.
- **Live failures** (`CalibrationError`, the market is load-bearing): no starts, no private starts,
  non-positive `implied`, a `PanelStart` count differing from `O`, no binned private start,
  non-positive `typicalUncoveredShare` or prototype value, an unparseable `market.json`, and price
  periods not matching the panel years minus `lagYears`.
- **Live warnings** (do not fail): `today.all` outside [ln 0.1, ln 2]; `|today.all -
crossCheck.logOdds| > 1`; the reproduction check; the hold-out failure.

Counts added to the build: `calibration.market.recentStarts`, `recentPrivate`, `recentAffordable`,
`recentNoRecord`, `recentUnknown`, `weightStarts`, `unbinnedHomes`, `unbinnedStories`.

## Hashed code

`src/lib/sim/finance/` is in the dataset version (`PATHS` in `pipeline/lib/version.ts`; chreode's
`dataset` rule and the Pipeline workflow's path lists cover it): the calibration step imports the
prototypes for the slope, and from Release 2 the `/lesscars` step runs the baseline funding through
it. Any change there is a dataset change, made at a release. `src/lib/fzp/market-view.ts` is page
code and stays outside the hashed paths.

## The page

See [fzp-mode.md](fzp-mode.md) ("Today's market in the Results' sources"): the Results face's
`fzp-market` paragraph from `marketSentence`, and the dialog's `src-market` section.
