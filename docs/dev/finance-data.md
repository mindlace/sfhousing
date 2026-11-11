# Finance data

The data behind the public-funding model: how much of each project is affordable, how many homes
were completed in each income tier, how the 100% affordable projects move through the stages, and
today's public funding as pools and grant programmes. This page covers what the pipeline computes
and ships. The arithmetic that spends it is [finance-model.md](finance-model.md). Design:
`docs/superpowers/specs/2026-11-09-finance-data-design.md`.

Four things are new in the dataset, plus one source and one hand-transcribed file:

| What                                        | Where it is computed                                             | Where it ships                            |
| ------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `affordableHomes` on each in-flight project | `affordableHomesOf`, `pipeline/project-records/derive.ts`        | `projects.json`                           |
| `rhnaCompletedNet.byTier`                   | `rhnaCompletedNet`, `pipeline/project-records/rhna.ts`           | `projects.json`                           |
| `calibration.affordableRoutes`              | `affordableRoutes`, `pipeline/lib/fzp-cal/affordable.ts`         | `calibration.json`                        |
| `calibration.baselineFunding`               | `baselineFunding`, `pipeline/lib/fzp-cal/funding.ts`             | `calibration.json`                        |
| `datasf-mohcd-pipeline`                     | `pipeline/sources/datasf.ts`                                     | the lock, the manifest and `/attribution` |
| `pipeline/enrichment/funding.json`          | hand-transcribed; schema `pipeline/enrichment/funding-schema.ts` | read by `build`, never uploaded           |

Live values are measured on the Release 1 build, dataset `2026-11-10-3532a348` (2026-11-10). Where
a measurement differs from the design's expectation (the research queries of 2026-11-09), the
expectation is kept beside it. The fixture values are exact.

## `affordableHomes` (in-flight projects)

The proposed affordable homes of the project's **primary Planning record**
(`number_affordable_units_prop`), clamped to the project's `units`. The same record sets the
project's size and its exemption from drop-out, so the three cannot disagree on which record speaks.
Satellite and other anchor records never speak.

It is `null` for:

- a split part (`PRJ:<id>:BP:<permit>`): the record's count is the whole PRJ's, not the part's;
- a multi-phase master (`multiPhase` true): a DA's Planning count describes the whole agreement;
- a pipeline-only (`BP:`, `CASE:`) or PPA-only (`PPA:`) project, and any project with no primary
  Planning record.

**A recorded 0 may mean "not stated".** The field is never blank in the locked Planning rows (about
53,700 rows hold 0 and about 950 a positive count), so a 0 reads as "the record proposes none or does
not say". It ships as 0, not null, and the provenance says so. Do not treat 0 as a measured "no
affordable homes".

When the record's count exceeds `units` (the permit's units are below the proposal) the value is
clamped and the project gains the quality id `pr.affordable.over-units`. On the 2026-10-17 lock no
record does this, so the rule is a guard. `parseProjectsFile` (V20) accepts absent or null, and
otherwise an integer in `[0, units]`: `projects[<i>].affordableHomes: must be null or an integer in
[0, units]`.

The cohort below reads a different field, `planningProposed` on the histories (`market-baseline`'s),
which carries the primary record's own pair unclamped, and which is also set on split parts.

## `rhnaCompletedNet.byTier`

Net homes completed since 30 June 2022, by income tier, from the housing-production rows (forms 1,
2, 3, 6 and 8, `first_completion_date` from 2022-06-30 to `asOf`). The source has four income
columns (extremely low, very low, low, moderate) and **no above-moderate column**. Above moderate is
therefore a remainder: the row's net completed homes less the restricted tiers. That also lets net
losses (demolitions) be netted against it, so the five values sum to `units` exactly. For each row,
with `n = net_units_completed`, the first rule that applies decides:

0. `n <= 0` (a loss, form 6 among others): `aboveModerate += n`, nothing else, whatever the tier
   columns hold. The records give no tier for demolished homes, and scaling to a zero or negative
   total has no meaning.
1. Tiers known: `veryLow = extremely_low + very_low` (California's very-low category includes
   extremely low), `low`, `moderate` as recorded; `a` is their sum. If `a <= n`, add them and
   `aboveModerate += n - a`. If `a > n` (a partly completed building), the counts are scaled to `n`
   by `largestRemainder`, ties to the earlier tier, and `aboveModerate += 0`.
2. Tiers missing (a blank column): if `affordable_units > 0`, `unrecorded += min(affordable_units, n)`
   and the rest goes to above moderate; the rule `pr.rhna.tier-unrecorded` counts it. Otherwise
   `aboveModerate += n`.

V22 (and V20 through `parseProjectsFile`) check `veryLow + low + moderate + aboveModerate +
unrecorded === units`; the message is `rhnaCompletedNet.byTier: must sum to units`. A file without
`byTier` validates. Planning estimates some rows' tiers from similar projects
(`affordable_is_estimate`, one row since 2023); they count in their stated tiers.

`byTier` counts completions. The Budget Analyst's Exhibit D counts progress by permits, so it is not
a check on these numbers; the scoreboard labels tier progress "completed since 30 June 2022 (net)".

|                                                                                               | very low | low   | moderate | above moderate | unrecorded |
| --------------------------------------------------------------------------------------------- | -------- | ----- | -------- | -------------- | ---------- |
| Fixture (`fixture-0`, units 4)                                                                | 0        | 0     | 0        | 3              | 1          |
| Live, since 30 Jun 2022 (`2026-11-10-3532a348`, units 8,723)                                  | 2,203    | 1,352 | 559      | 4,609          | 0          |
| Expected, since 2023-01-01 (the design's research query; a shorter window, so not comparable) | 1,670    | 1,252 | 557      | the remainder  | 0          |

## The cohort and `calibration.affordableRoutes`

The cohort is the 100% affordable projects. It **reuses `market-baseline`'s affordable-cohort flag**
(`isAffordableCohort`, 95% of the primary Planning record's proposed homes affordable; see
[market.md](market.md#the-affordable-cohort-flag)). This code defines no test of its own. It adds
one condition of its own: the history's `planningProposed.units` is at least 10 (the 10-home floor of
F12). The flag is a proxy for "publicly funded": no record carries a funding field.

`affordableRoutes(norm, forNew, asOf, minProjects = 30)` returns the pathway shares (discretionary,
streamlined, permitOnly) of the cohort's qualifying histories with a known pathway whose first
record lies in `[PLANNING_START, asOf]`: the same window and counting as `pathwayForNew`.

- `n >= 30`: shares from `roundShares`, tier 0.
- `n < 30`: `pathwayForNew`'s three shares copied, tier 4, method starting "Only <n> 100% affordable
  histories (fewer than 30)". On a live build this also adds a warning to `CalOutput.warnings` and
  the report: `affordableRoutes: only <n> 100% affordable histories (fewer than 30); the pathway mix
of all new projects is used, labelled tier 4`.

The threshold is a function argument, not in the profile, so the fixture (empty cohort) takes the
fallback by design, is labelled tier 4, and does not warn. The fixture value is the fallback.
Live (`2026-11-10-3532a348`): 53 histories, tier 0; discretionary 0.301887, streamlined
0.679245, permitOnly 0.018868 (expected: about 54 histories, about two thirds streamlined). `parseCalibration` validates it with `checkPathwayMap(v, 'affordableRoutes',
true)`.

## `calibration.baselineFunding`

Six City pools, one `state` pool and one uncapped `federal` pool, with one grant programme per pool,
in pool order. Every programme is `reach: 'affordable'`, `from` the build's `asOf` and `to` null. Each
pool's first inflow arrives on `asOf` and then each anniversary. Dollars are FY2024-25 dollars, not
adjusted. Shares are in millionths and sum to exactly 1,000,000 (the programme
share is `perHome.<source> ÷ 861,525`, the uncovered cost of an affordable home,
`uncoveredPerHome('affordable')`).

| Pool id                   | Programme id                       | Pool kind        | Fill tier  | Dollars a year | Live share (`2026-11-10-3532a348`; as expected) |
| ------------------------- | ---------------------------------- | ---------------- | ---------- | -------------- | ----------------------------------------------- |
| `federal-tax-credits`     | `baseline-federal-tax-credits`     | `federal`        | 1, federal | uncapped       | 0.51433                                         |
| `state`                   | `baseline-state`                   | `state`          | 2, state   | 150,000,000    | 0.137419                                        |
| `city-debt`               | `baseline-city-debt`               | `goBond`         | 3, City    | 80,500,000     | 0.119804                                        |
| `city-ocoh`               | `baseline-city-ocoh`               | `dedicatedTax`   | 3, City    | 48,600,000     | 0.072329                                        |
| `city-general-fund`       | `baseline-city-general-fund`       | `generalRevenue` | 3, City    | 36,700,000     | 0.054619                                        |
| `city-impact-fees`        | `baseline-city-impact-fees`        | `dedicatedTax`   | 3, City    | 34,800,000     | 0.051791                                        |
| `city-housing-trust-fund` | `baseline-city-housing-trust-fund` | `generalRevenue` | 3, City    | 27,400,000     | 0.040778                                        |
| `city-redevelopment`      | `baseline-city-redevelopment`      | `dedicatedTax`   | 3, City    | 6,000,000      | 0.00893                                         |

The pools in `calibration.json` run in the City sources' Exhibit E order, then `state`, then
`federal-tax-credits`; the table lists them by fill tier. Impact fees are classed `dedicatedTax`
because `PoolKind` has no fee kind; the pool's `note` says it is a fee.

**Every pool entry is evidence tier 2** (ruling R14). An entry of `baselineFunding.provenance` has
one tier, the tier of the weakest number it states. The dollars behind a share are tier 1 (the
Budget Analyst's Exhibits E and F), but the share itself is an inference: it applies Exhibit F's
average over the tax-credit projects of 2024 to each funded home of the run, and a City share also
rests on a split the report does not give (Exhibit F has one figure for the City, $300,027 a home,
and the share takes each source to pay in proportion to its FY2024-25 spending in Exhibit E). So a
City entry's method has two marked parts, in this order: `Recorded (tier 1): ` (this source's
dollars and the City's total, Exhibit E; the City's dollars a home, Exhibit F), then
`Inferred (tier 2): ` (the slice and share arithmetic, and the held-level assumption), followed by
the inflow dates, "FY2024-25 dollars, not adjusted", the source's `note` and, for `city-debt`, the
debt sentence. No entry is tier 1. A City entry's `window` is `city.fiscalYear` (`FYyyyy-yy`, two
consecutive years; the schema rejects any other form) read as July to June, and its `n` is 1.

### Why the federal pool has no ceiling

The federal pool is uncapped: the simulation pays its share for any number of funded homes. Its
provenance entry (label `Federal: low-income housing tax credits: uncapped`, tier 2) lists the
Exhibit F cite and then the three allocation records in `federal.uncapped.cites`; its `n` is
`federal.uncapped.rounds` (3) and its `window` is `federal.uncapped.window` (2026-01-01 to
2026-09-14), so both describe the claim. The records, read in the primary documents on 2026-11-10:

1. CDLAC Exhibit A, _Pool and Set-Aside Recommendation of 2026 State Debt Ceiling_ (updated
   2026-09-14): California's 2026 bond ceiling for rental housing is $4.83 billion, divided among
   state-wide pools and six regions, with no San Francisco line. The Bay Area Region used $75.2
   million of $128.6 million in round 1 and $170.1 million of $181.9 million in round 2.
2. CTCAC, _Allocation Process for Set Asides and Geographic Regions, Estimated for Calendar Year
   2026_ (updated 2026-09-02): the 9% credit **does** have a San Francisco share, $2,861,626 of
   annual federal credit (3.7% of the regions').
3. CTCAC, _2026 First Round 9% Final Approved Recommendations_ (2026-06-22): no San Francisco project
   was recommended, and $3,437,486 was left.

Almost all of San Francisco's new-construction tax-credit awards use the 4% credit (the method adds
a sentence computed from the award rows; live: 14 of the 15 new-construction awards of 2024–2025,
1,925 of 1,960 homes). Those take a share of the state's bond ceiling, of which San Francisco has no
share of its own, and money was left in the Bay Area's share after both 2026 bond rounds. So "no
ceiling binds San Francisco today" is an inference (tier 2) from those three rounds, not a law. Its
limits, which the method states: the Bay Area's round 2 share was 93% used; San Francisco projects
also compete in the state-wide pools, at least one of which was fully used; and the records do not
say which pool paid for any San Francisco award. A policy that funds many more homes than today
could meet the bond ceiling, and the simulation does not show that.

**What the $443,108 is.** Exhibit F's slice is "Federal", not tax credits alone: the Analyst says
federal funding "includes the Low-Income Housing Tax Credit" (p. 6) and gives no split. The pool
keeps its id and label and treats the whole amount as money that follows the project, as the credit
does; its method says so.

**Fill tiers.** The tier table above is the order in which `fundBundle` spends the pools: federal,
then state, then the City's pools pro rata. With the whole baseline on and nothing added, every grant
pays its full share, so the tiers change no dollar. The arithmetic is in
[finance-model.md](finance-model.md).

`debt` is set exactly for `goBond` and `cop`: `city-debt` carries rate 0.06 and term 20 years (the
Analyst's assumption, tier 2). `leverage` is 1 on every pool. A pool with debt has its terms in its
provenance: the method ends "Debt terms: rate 6.0%, 20 years (p. 106, Exhibit 40: '…'), the
Analyst's assumption (tier 2); repayment is nominal.", and the debt cite is added to its `sources`.

### `tiers` and `minHomes` (MOHCD)

Both come from the `datasf-mohcd-pipeline` rows with `general_housing_program = 'MOHCD 100%
Affordable (New Development)'` and `project_type = 'New Construction'`: the City's own 100%
affordable building, which the baseline programmes fund. Inclusionary and rehabilitation rows are
left out.

Each AMI band is a ceiling, mapped by its upper bound to California's income categories:

| AMI bands                                                 | Tier            |
| --------------------------------------------------------- | --------------- |
| `_20_ami`, `_30_ami`, `_40_ami`, `_50_ami`                | `veryLow`       |
| `_55_ami`, `_60_ami`, `_80_ami`                           | `low`           |
| `_90_ami`, `_100_ami`, `_105_ami`, `_110_ami`, `_120_ami` | `moderate`      |
| `_130_ami`, `_150_ami`                                    | `aboveModerate` |

`tiers` is the four sums divided by their total, through `roundShares` (the one-millionth residual
goes to the first largest). `ami_undeclared` homes are left out of the mix; `sc.funding.ami-undeclared`
counts them. MOHCD's AMI is the City's published AMI table, not the state's income limits (inferred,
and the provenance says so). `minHomes` is the nearest-rank 10th percentile of `total_project_units`
over the same rows (sorted index `ceil(0.1 × n) - 1`, rows with 0 or blank homes left out). No
qualifying row with a band-coded home aborts the build with a `CalibrationError`: `funding: no MOHCD
100% affordable new-construction rows with income bands`. Qualifying rows none of which has
`total_project_units` above 0 abort it the same way: `funding: no MOHCD row with
total_project_units above 0`. A lock with no `datasf-mohcd-pipeline` entry is a `BuildError` too (`lock has no
datasf-mohcd-pipeline entry (run fetch --only datasf-mohcd-pipeline)`).

|                                           | veryLow  | low      | moderate | aboveModerate | `minHomes` | MOHCD rows | undeclared homes |
| ----------------------------------------- | -------- | -------- | -------- | ------------- | ---------- | ---------- | ---------------- |
| Fixture (tier 4)                          | 0.428572 | 0.428571 | 0.142857 | 0             | 2          | 2          | 1 of 8           |
| Live (`2026-11-10-3532a348`; as expected) | 0.483439 | 0.433384 | 0.076402 | 0.006775      | 70         | 45         | 1,023 of 6,304   |

**Known limit: small affordable projects below `minHomes`** (ruling R22, accepted by the partner).
The private-development level `today.private` (row F2; [market.md](market.md)) is measured with
every affordable-cohort start left out of the observed starts, whatever its size: `startCohort` in
`pipeline/lib/affordable-cohort.ts` marks a start affordable when its primary Planning record
proposes at least 95% affordable homes, with no size floor. From Release 2, a run whose
`buildSimInput` sets `finance` runs at that private level (F3), so affordable starts have to come
back through the funded `affordable` start. But a month's bundle holds only the programmes whose
`minHomes` the project's drawn size meets (F9 (b)), and every baseline programme (F12) carries the
same `minHomes`, 70 homes live and 2 in the fixture. A lot whose drawn size is below it has an empty
baseline bundle, makes no application, and cannot be funded by the baseline at all. Affordable
projects smaller than `minHomes` are therefore taken out of the private level and never put back by
today's funding: the run under-counts them. Only a programme the user adds with a lower `minHomes`
can reach them.

### The check and its warning

`check` holds two whole numbers and its provenance (tier 2):

- `impliedHomesPerYear`: over the capped pools with a share above 0, the least of
  `dollarsPerYear ÷ (share × 861,525)`, rounded half up. The City pools all give about the same
  quotient by construction, and they bind (the state gives more).
- `observedHomesPerYear`: the sum of `homes` over the award rows with `newConstruction: true`,
  divided by the number of `awards.years`, rounded half up. Award homes are total units, managers'
  homes included.

**The warning** `baselineFunding: the capped pools fully fund <i> affordable homes a year; the
<y0>–<y1> bond and tax-credit awards show <o> (new construction); they differ by more than half`
fires when `|implied − observed| > 0.5 × observed`. It goes into `CalOutput.warnings` and the
report. It is never a failure. It means the shares and dollars in `funding.json` no longer agree
with the award records: either a source's dollars or the award list was transcribed wrongly, or the
programme really changed. Re-read the primary sources before trusting a rebuilt baseline.

|                                           | implied | observed | warning           |
| ----------------------------------------- | ------- | -------- | ----------------- |
| Fixture                                   | 20      | 25       | none              |
| Live (`2026-11-10-3532a348`; as expected) | 780     | 980      | none (ratio 0.80) |

### Fixture mode

On a `fixture-<n>` build `funding.json` is the twin
`pipeline/test/fixtures/mini/enrichment/funding.json`: the live `perHome` (so `AFFORDABLE` agrees),
the live ids and kinds, City sources of 1,500,000, 1,200,000, 1,000,000, 1,000,000, 800,000 and
500,000 (total 6,000,000), state 3,000,000, two invented award rows (`FIXTURE-1`, 20 homes in 2024;
`FIXTURE-2`, 30 homes in 2025), an invented `federal.uncapped` (one round, window 2026-01-01 to
2026-01-01, one cite), and every `cite.label` beginning "Fixture:". The MOHCD rows come
from the mini raw page. Every provenance entry of `baselineFunding`, and `check.provenance`, is tier
4, labelled with the prefix `Fixture (tier 4): `. Stored fixture policies therefore name the same
pool ids as the live site.

## `pipeline/enrichment/funding.json`

Hand-transcribed, committed, read directly by `build` (not fetched, not in the lock) and part of the
dataset-version hash because it sits under `pipeline/`. The pipeline's other enrichment file in this
style is `multiphase.json` ([pipeline.md](pipeline.md#funding-enrichment)).

Contents: `perHome` (Exhibit F, average funding per home), `city` (Exhibit E, six sources with `kind`,
`dollarsPerYear`, `debt`, `note`, `cite`), `state`, `federal` (with `uncapped`: `rounds`,
`window` and `cites`, the allocation records behind the pool's missing ceiling), `awards` (`years`
and `rows`) and `retiredIds`. Every number carries a citation with a page. The schema rejects a
`federal.uncapped` with no cite, a `rounds` that is not a whole number of 1 or more, or a `window`
that runs backwards.

### Stable ids

Stored policies name baseline pools in `baselineScale` and baseline programmes by id, so ids are
stable across dataset versions:

- **Never rename an id.** A later transcription of a new Budget Analyst report keeps every id whose
  source continues, even if its label or amount changes.
- **Never reuse an id** for a different source.
- A source that ends is removed from `funding.json` and its id moved to `retiredIds`; the schema
  rejects a current id that is retired.
- Ids match `^[a-z0-9][a-z0-9-]{0,30}$` and do not start `u-` (the 31-character bound plus
  `baseline-` stays within F12's 40; `u-` is the prefix of ids the user adds).

A pipeline test pins the live file's ids to the eight above, so a rename fails a test and is
reviewed. A stored policy that names a retired id loads with that entry dropped and a notice
(`finance-levers`' job).

**A `baselineScale` of 0 switches a pool off in the levers** (F7), the uncapped federal pool
included, from its day. That is applied by the levers and the engine; it changes nothing in the data
this pipeline emits.

### Updating `funding.json`

When the Budget Analyst, CDLAC or CTCAC publish new figures:

1. Re-read each number in its primary source. Cite the page (the printed page equals the PDF page in
   the Budget Analyst's report), the URL and the retrieval date, with a `quote` where a figure
   rests on a sentence.
2. Edit `funding.json`. Keep every ongoing id (see Stable ids), move an ended source to
   `retiredIds`, and keep `perHome` equal to `AFFORDABLE` in `src/lib/sim/finance`
   (`perHome.total` is `costPerHome`; `permanentLoans + other` is `ownPerHome`). A disagreement is a
   `BuildError`, because a silent divergence would make the shares wrong.
3. Update the award rows by the rule below, and `awards.years` (complete calendar years only: a part
   year would understate).
4. Each year, update `federal.uncapped`: re-read the two committees' allocation tables (CDLAC's
   Exhibit A for the bond ceiling, CTCAC's credit estimates and each round's final recommendations
   for the 9% credit), replace the cites, the round count and the window, and rewrite the figures in
   `federal.method`. Review whether the Bay Area's share of the bond ceiling was used up. If it was,
   the claim that no ceiling binds San Francisco no longer holds and the design must be reopened.
5. Run `npx prettier --write pipeline/enrichment/funding.json`, then the pipeline funding tests, then
   rebuild the dataset and read report section 12 (below), especially the check and its warning.
6. A change here changes the dataset version, so the branch follows "Finishing a branch that changes
   the dataset" in [pipeline.md](pipeline.md).

**Award rows.** `awards.rows` is every San Francisco row of the five CDLAC _Qualified Residential
Rental Projects_ final lists of awards (2024 rounds 1 and 2; 2025 rounds 1, 2 and 3), plus every
San Francisco 9% row of the CTCAC _List of Projects_ workbook (sheet "San Francisco") whose
application number begins `CA-2024-` or `CA-2025-`. The six lists are listed with their URLs in the
`cite` of each row. For a new year, add that year's lists on the same pattern. The fields, so that no
row needs a judgement:

- County filter: only rows whose County column is "San Francisco".
- `year`: the CDLAC list's programme year; for a 9% row, the year in its CTCAC application number.
- `application`: the CDLAC application number as printed (`CA-24-535`, `24-737`); for a 9% row the
  CTCAC number (`CA-2024-003`).
- `credit`: `'4%'` for a CDLAC row, `'9%'` for a CTCAC 9% row.
- `homes`: the CDLAC list's "Total Units". The 2024 round 1 list prints no unit column, so its rows,
  and the 9% rows, take "Total Units" from the CTCAC workbook's row for the same project.
- `newConstruction`: true exactly when the CTCAC workbook's "Construction Type" is "New
  Construction" (the CDLAC lists do not print it).
- `cite`: the list's URL; `page` is the application number (the lists have no page numbers).

Live rows today: 19 (2024 new construction 1,274 homes, 2025 new construction 686, four
rehabilitation rows with `newConstruction: false`), giving `observedHomesPerYear` 980.

### Held-level sources (OD-F3)

The six City sources are held at their FY2024-25 amounts: "funding as the recent records show it,
held level". That is a ruled assumption, not a forecast, and the user can scale any pool from a date
in the levers. Three of them are one-off by the report's own account, and each pool's provenance
says so:

- `city-impact-fees`: FY2024-25 spending came mostly from earlier years' fee balances; fee revenue
  was $422,048 in FY2024-25 against an $18.0 million average.
- `city-redevelopment`: "that source has now been spent down" (p. 73).
- `city-debt`: bonds need voter approval each time (p. 72).

Two more caveats are held level as if they paid for new building, and they do not:

- `city-debt` includes the 2016 Preservation and Seismic Safety (PASS) bond, which funds
  preservation, not new building (p. 43).
- `city-general-fund` includes $14.5 million work-ordered from the Department of Homelessness and
  Supportive Housing for homeless housing (p. 44).

The implied 780 homes a year sits close to the observed completions a year, which supports the total
even if its parts shift.

## Report sections 12 and 13

`calibration-report.md` (build-internal; the fixture's golden is
`pipeline/test/fixtures/mini/golden/derived/calibration-report.md`) gains two sections after
section 11. Nothing in them ships except what is already in `calibration.json`.

**Section 12, "Publicly funded housing: routes, stages and baseline funding".** Read it top to
bottom:

1. The `affordableRoutes` line: shares, tier, `n`, and "fallback" when it fell back.
2. The pathways by group: qualifying histories with a Planning pair of 10 homes or more and a
   recorded affordable count, split into 100% affordable (the cohort), some affordable (`0 < a`, not
   flagged) and none (`a = 0`). A line gives how many histories were left out (no pair, blank or
   fewer than 10 homes, or a blank affordable count).
3. Stages by group, for `filed`, `entitled`, `permitFiled`, `permitIssued` and `construction`:
   spells, observed advances and exits, Aalen-Johansen eventual advance and exit, and the median
   months to advance. These are the transition tables' estimator on the calibration's own spells,
   pooled over pathways, without the fallback ladder and tail, so the comparison is descriptive: use
   it to ask whether 100% affordable projects move differently from the others, not to read off a
   fitted rate. A cell with no spells prints "none".
4. The baseline funding table, in pool order: fill tier, programme, pool, kind, dollars a year (or
   "uncapped"), share, implied homes a year; the fill-tier sentence; then `tiers`, `minHomes`, MOHCD
   rows used, homes by AMI band, undeclared homes, the check, and the check warning ("none" when it
   does not fire).

**Section 13, "Where publicly funded housing starts" (OD-F9b).** It tests the draw of F9 (d): that
funded projects start on lots like those private projects chose. For the cohort and for the private
group (every qualifying history not flagged, of any size) it takes each start (the first entered
day among preApplication, filed and permitFiled, from 2015-01 to 2025-12), the start's primary
parcel and the panel row of the start's roll year, and computes the published initiation hazard
there. The table has, per group: histories, starts on the panel, off panel (the lot has no row, or
its row is not hostable under the base zoning), and the mean and median monthly hazard × 1,000.
Under it: histories flagged 100% affordable but under 10 homes (in neither group), and the ratio of
means, 100% affordable ÷ private ("none" with no event in a group). Read the ratio by the section's
fixed sentence: near 1, funded projects started on lots like private ones; well above 1, they took
the likeliest lots; well below 1, lots private projects pass over. No San Francisco estimate of
displacement exists. Watch the off-panel count: City-owned sites can be non-hostable under the base
zoning. The section is report-only.

## The MOHCD source

`datasf-mohcd-pipeline` (`aaxw-2cb8`, "DataSF MOHCD Affordable Housing Pipeline", PDDL-1.0) is a
DataSF source in the lock. Its lock entry, with label, licence and homepage, is its credit on
`/attribution` (the page reads the manifest). It is a 2023 snapshot ("all projects as of September
30, 2023", 190 rows) and has **no above-moderate or market-rate column**. It is not normalised into
DuckDB: the calibration step reads its locked pages with `readRows`. It is **not an as-of source**
(it is not in `PROJECT_SOURCE_IDS`), so fetching it does not move `asOf`. The combined fetch command
is in [pipeline.md](pipeline.md). The Budget Analyst report, the CDLAC lists and the CTCAC workbook
are not dataset sources; they are cited in the provenance of the values transcribed from them.

`datasf-housing-production` (`xdht-4php`) is an as-of source whose `select` was widened to the tier
columns and `affordable_units`. Changing its URL means its lock entry must be fetched again with the
other project sources.

## Data-quality rules and invariants

- `pr.affordable.over-units`: an affordable count capped at the project's homes.
- `pr.rhna.tier-unrecorded`: completed affordable homes counted as tier not recorded.
- `sc.funding.ami-undeclared`: MOHCD homes with no income band, left out of the mix (warn 0.25, fail
  0.50 of affordable homes in the rows used).

They appear in the generated Data quality section of [pipeline.md](pipeline.md#data-quality). The
V20, V22 and V25 additions are described under Invariants there. V25 also fails a build whose
`baselineFunding` has not one `baseline-<pool id>` programme per pool in pool order, whose shares do
not sum to 1,000,000 millionths, or whose live `affordableRoutes` is neither tier 0 nor the warned
fallback.

## Dataset

`pipeline/` and `src/lib/timelapse` are hashed into the dataset version, so a change here needs a
dataset build and upload before signoff. The package is built and uploaded once, on the Release 1
branch, from the refreshed lock. The pipeline goldens and `fixture-0` change at that release only.
