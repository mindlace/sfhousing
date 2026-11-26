# Finance data

The data behind the public-funding model: how much of each project is affordable, how many homes
were completed in each income tier, how the 100% affordable projects move through the stages, and
today's public funding as pools and grant programmes. This page covers what the pipeline computes
and ships. The arithmetic that spends it is [finance-model.md](finance-model.md). Design:
`docs/superpowers/specs/2026-11-09-finance-data-design.md`.

Four things are new in the dataset, plus one source and one hand-transcribed file:

| What                                        | Where it is computed                                             | Where it ships                                 |
| ------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `affordableHomes` on each in-flight project | `affordableHomesOf`, `pipeline/project-records/derive.ts`        | `projects.json`                                |
| `rhnaCompletedNet.byTier`                   | `rhnaCompletedNet`, `pipeline/project-records/rhna.ts`           | `projects.json`                                |
| `calibration.affordableRoutes`              | `affordableRoutes`, `pipeline/lib/fzp-cal/affordable.ts`         | `calibration.json`                             |
| `calibration.baselineFunding`               | `baselineFunding`, `pipeline/lib/fzp-cal/funding.ts`             | `calibration.json`                             |
| `datasf-mohcd-pipeline`                     | `pipeline/sources/datasf.ts`                                     | the lock, the manifest and `/about#about-data` |
| `pipeline/enrichment/funding.json`          | hand-transcribed; schema `pipeline/enrichment/funding-schema.ts` | read by `build`, never uploaded                |

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

Nine pools: seven City pools, one `state` pool and one `federal` pool, built by `baselineFunding`
(`pipeline/lib/fzp-cal/funding.ts`) one per source of `funding.json`. Each pool's inflows follow its
source's `bound` (below). Every pool with at least one inflow has one grant programme
`baseline-<pool id>`, in pool order; a pool with no inflow has none. Every programme is
`reach: 'affordable'`, `from` the build's `asOf` and `to` null, under every bound: ending a programme
on its pool's last inflow would strand the last year's money. Dollars are FY2024-25 dollars, not
adjusted. The federal pool is built like the state pool (`kind: 'federal'`, `debt: null`,
`leverage: 1`) with one yearly inflow of its ceiling.

Shares are in millionths, computed with `roundShares` over all nine sources (those with no programme
included), so they sum to exactly 1,000,000 over the nine. A programme's share is
`perHome.<source> ÷ 861,525`, the uncovered cost of an affordable home,
`uncoveredPerHome('affordable')`. A pool with no programme takes its share out of every bundle, so
projects go ahead on what is left at lower odds, as when a source is switched off.

**Inflows from a bound.** Anniversary k is the k-th arrival of a yearly inflow from `asOf` (k from
0), `inflowArrivals`' rule: the same UTC month and day k years later, 29 February becoming 28
February in a common year (`anniversary(asOf, k)`; a pipeline test checks it against
`inflowArrivals`). The first year is the days from `asOf` to the day before anniversary 1.
`boundInflows(bound, dollarsPerYear, asOf)` gives:

- `none`: `[{ kind: 'yearly', from: asOf, to: null, dollarsPerYear }]`.
- `ends` with `on` on or after `asOf`: `[{ kind: 'yearly', from: asOf, to: day(on), dollarsPerYear }]`
  (an `on` equal to `asOf` gives one arrival).
- `ends` with `on` before `asOf`: `[]`.
- `remaining` with `dollars` above 0: one `once` inflow on each anniversary of
  `min(dollarsPerYear, left)` until nothing is left (an exact multiple gives no trailing 0-dollar
  inflow; less than a year's amount gives one inflow of what is left).
- `remaining` with `dollars` 0: `[]`.

A yearly inflow of 0 dollars (a `none` or `ends` source of 0 a year) stays; it makes no arrival.
One example per kind, live, `asOf` 2026-11-10:

```ts
// none: city-ocoh
inflows: [{ kind: 'yearly', from: day('2026-11-10'), to: null, dollarsPerYear: 48_600_000 }];
// ends: city-housing-trust-fund, on 2043-06-30 (17 arrivals, 2026-11-10 to 2042-11-10)
inflows: [
  { kind: 'yearly', from: day('2026-11-10'), to: day('2043-06-30'), dollarsPerYear: 27_400_000 }
];
// remaining 260,310,000 at 80,500,000 a year: city-debt
inflows: [
  { kind: 'once', day: day('2026-11-10'), dollars: 80_500_000 },
  { kind: 'once', day: day('2027-11-10'), dollars: 80_500_000 },
  { kind: 'once', day: day('2028-11-10'), dollars: 80_500_000 },
  { kind: 'once', day: day('2029-11-10'), dollars: 18_810_000 }
];
// remaining 0: city-housing-stability-fund, city-redevelopment
inflows: []; // no programme
```

| Pool id                       | Programme id                       | Pool kind        | Fill tier  | Dollars a year        | End                 | Live share |
| ----------------------------- | ---------------------------------- | ---------------- | ---------- | --------------------- | ------------------- | ---------- |
| `federal-tax-credits`         | `baseline-federal-tax-credits`     | `federal`        | 1, federal | 564,519,592 (ceiling) | no end              | 0.51433    |
| `state`                       | `baseline-state`                   | `state`          | 2, state   | 150,000,000           | no end              | 0.137419   |
| `city-debt`                   | `baseline-city-debt`               | `goBond`         | 3, City    | 80,500,000            | $260.3 million left | 0.119804   |
| `city-ocoh`                   | `baseline-city-ocoh`               | `dedicatedTax`   | 3, City    | 48,600,000            | no end              | 0.072329   |
| `city-general-fund`           | `baseline-city-general-fund`       | `generalRevenue` | 3, City    | 21,800,000            | no end              | 0.032444   |
| `city-housing-stability-fund` | none                               | `generalRevenue` | 3, City    | 14,900,000            | spent               | 0.022175   |
| `city-impact-fees`            | `baseline-city-impact-fees`        | `dedicatedTax`   | 3, City    | 34,800,000            | $45.2 million left  | 0.051791   |
| `city-housing-trust-fund`     | `baseline-city-housing-trust-fund` | `generalRevenue` | 3, City    | 27,400,000            | ends 2043-06-30     | 0.040778   |
| `city-redevelopment`          | none                               | `dedicatedTax`   | 3, City    | 6,000,000             | spent               | 0.00893    |

The pools in `calibration.json` run in the City sources' Exhibit E order, then `state`, then
`federal-tax-credits`; the table lists them by fill tier. Impact fees are classed `dedicatedTax`
because `PoolKind` has no fee kind; the pool's `note` says it is a fee.

**Provenance of a bound.** Each pool's entry states its end with the bound's citation. A City label
reads "{label}: $X.X million a year, FY2024-25 ({end})", the state's "{label}: $X.X million a year
(a lower bound; {end})", the federal "{label}: at most $X.X million a year ({end})", where `end` is
"ends {on}", "ended {on}", "$X.X million left", "spent" or "no end" (`boundEnd`). The method carries
`boundSentence`, one of five templates (ends, ended, remaining, spent, no end), each ending with
"(tier {t}; {cite label}, {page})"; the inflow sentence is left out for a pool with no inflow. The
bound's cite is added to `sources` unless an equal source is there. An entry's tier is the larger
of 2 and the bound's tier.

**Every pool entry is evidence tier 2** (ruling R14). An entry of `baselineFunding.provenance` has
one tier, the tier of the weakest number it states. The dollars behind a share are tier 1 (the
Budget Analyst's Exhibits E and F), but the share itself is an inference: it applies Exhibit F's
average over the tax-credit projects of 2024 to each funded home of the run, and a City share also
rests on a split the report does not give (Exhibit F has one figure for the City, $300,027 a home,
and the share takes each source to pay in proportion to its FY2024-25 spending in Exhibit E). So a
City entry's method has two marked parts, in this order: `Recorded (tier 1): ` (this source's
dollars and the City's total, Exhibit E; the City's dollars a home, Exhibit F), then
`Inferred (tier 2): ` (the slice and share arithmetic), followed by the bound's sentence, the inflow
dates (when the pool has an inflow), "FY2024-25 dollars, not adjusted", the source's `note` and,
for `city-debt`, the debt sentence. No entry is tier 1. A City entry's `window` is `city.fiscalYear` (`FYyyyy-yy`, two
consecutive years; the schema rejects any other form) read as July to June, and its `n` is 1.

### The federal ceiling

The federal pool receives one yearly inflow of `federal.dollarsPerYear`, its ceiling, with no end
(its bound is `none`: California sets both credits' ceilings every calendar year). The ceiling is
read from the award rows: the most new-construction homes San Francisco won in one year of
`awards.years` (1,274 in 2024), times `perHome.federal` ($443,108): $564,519,592 a year. Its label is
`Federal: low-income housing tax credits: at most $564.5 million a year (no end)`, tier 2.

**Why the best year.** The award rows give two readings, the average year (980 homes, $434,245,840)
and the best year (1,274 homes, $564,519,592). A ceiling below a year the records show was reached
would contradict per-record data, so the best year is the ceiling. Like every pool, it pays from
all it has received less what is committed, so credits not awarded in their year stay in the pool.

**Its check in the schema.** `parseFundingFile` refuses a file whose `federal.dollarsPerYear` is not
the largest, over `awards.years`, of that year's new-construction award homes times
`perHome.federal`: "federal.dollarsPerYear must be the most new-construction homes awarded in one
year times perHome.federal". A new award year that beats the best moves the ceiling, and the file
must be edited to match.

The entry's `n` is the number of new-construction award rows (live 15) and its `window` the award
window, 1 January of the first award year to 31 December of the last. Its method is
`federal.method`, then a sentence computed from the award rows (live: 14 of the 15 new-construction
awards of 2024–2025 used the 4% credit, 1,925 of 1,960 homes), the share sentence, the bound's
sentence and "FY2024-25 dollars, not adjusted."

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

### Older datasets

A plan or policy runs on the dataset it was published on while that dataset exists. Every dataset
built before finite funding has `uncapped: true` and no inflows on its federal pool. `parseCalibration`
(`src/lib/timelapse/model.ts`) reads any baseline pool that has an `uncapped` key before it checks the
funding: a non-boolean is refused at `baselineFunding.pools[i].uncapped` ("expected a boolean"); the
pool is returned without the key; and `true` with no inflows becomes one yearly inflow from `asOf`
with no end of `LEGACY_UNCAPPED_DOLLARS` (ten trillion dollars, above `MAX_DOLLARS`, so no added pool reaches it). The calibration then loads and is
never refused for it. When a pool has the key, the loader returns a copy (new calibration,
`baselineFunding` and pools array; every other object is the input's); otherwise it returns the
input. `checkPool` has no `uncapped` key.

`isNoCeiling(dollars)` is the one test for such a pool: a yearly amount at or above
`LEGACY_UNCAPPED_DOLLARS`. Where a yearly amount is shown it reads "No ceiling": the funding row, the
By source table and the pool sentence. The money bar gets no level for it. A scale entry on the pool
scales the amount as on any pool, so a policy that switched it off and back on plays as it did.
`src/lib/timelapse/fixtures/calibration-uncapped.json` is fixture-0's calibration before finite
funding, kept for the loader's test.

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

- `impliedHomesPerYear`: over the pools with a programme and a share above 0, the least of their
  first year's dollars `÷ (share × 861,525)`, rounded half up (`firstYearDollars`: the dollars
  arriving from `asOf` to the day before anniversary 1). The federal pool counts like any other. The
  City pools all give about the same quotient by construction, and they bind (the state and the
  federal ceiling give more). A `remaining` under one year's amount makes its pool's first year, and
  so possibly the least, smaller.
- `observedHomesPerYear`: the sum of `homes` over the award rows with `newConstruction: true`,
  divided by the number of `awards.years`, rounded half up. Award homes are total units, managers'
  homes included.

**The warning** `baselineFunding: the baseline pools fully fund <i> affordable homes a year; the
<y0>–<y1> bond and tax-credit awards show <o> (new construction); they differ by more than half`
fires when `|implied − observed| > 0.5 × observed`. It goes into `CalOutput.warnings` and the
report. It is never a failure. It means the shares and dollars in `funding.json` no longer agree
with the award records: either a source's dollars or the award list was transcribed wrongly, or the
programme really changed. Re-read the primary sources before trusting a rebuilt baseline.

|                                           | implied | observed | warning           |
| ----------------------------------------- | ------- | -------- | ----------------- |
| Fixture                                   | 20      | 25       | none              |
| Live (`2026-11-10-3532a348`; as expected) | 780     | 980      | none (ratio 0.80) |

### What current law builds against the check

The model's own affordable output, beside the 780 implied and 980 observed homes a year. Measured
2026-11-25 on dataset `2026-11-25-76c90397` (cars on), current law (`docFor([], cal, asOf)`, the
empty document), one `engine.view` through `scripts/lib/engine-runner.ts`. Affordable homes are
very low, low and moderate income homes (`view.tiers`); funded homes are `view.money.fundedHomes`.
The award rule is the fallback award with full-coverage odds and the closing fix (spec
[funding award rule](../superpowers/specs/2026-11-25-funding-award-rule-design.html), R3 with M4).

|                                        | Before the rule (d0aebfb6) | Fallback award (R3)      |
| -------------------------------------- | -------------------------- | ------------------------ |
| Affordable completions a year, 2031-40 | 626                        | 687                      |
| Dec 2035: net / funded / affordable    | 30,715 / 1,891 / 2,204     | 31,553 / 2,729 / 3,037   |
| Dec 2060: net / funded / affordable    | 68,665 / 12,989 / 15,604   | 72,058 / 16,262 / 19,245 |
| Goal (82,069) reached                  | Jun 2065                   | Oct 2061                 |

Affordable homes a year are (Dec 2040 − Dec 2030) ÷ 10: 32 at Dec 2030, 6,903 at Dec 2040. The spec
measured about 560 a year under the old rule on the pre-cars dataset `2026-11-14-09ca30c8`. The
model stays below the 780 implied and 980 observed homes a year; per the owner's ruling the gap is
recorded, not refitted.

**Money monotonicity, not yet met.** `npx tsx scripts/money-monotone.ts --version 2026-11-25-76c90397`
on the same code: `Not monotone: 132 drops on 44 edges` (60 net, 40 funded, 32 affordable), the
worst `net Dec 2040, [housing-bond, federal-support] + general-revenue: 49890 -> 49815 (-75)`
(64 sets in 74 s). Before the rule it was 568 drops on 64 edges, the worst −11,796. The remaining
drops have one cause, R6's all-or-nothing certainty: an award whose set reaches level 1 never exits
and takes no size revision, any other can. A preset added to a set moves the point where a yearly
or one-off pool's last dollars run out by $0.1 to $1 million, which decides which single project
is certain; one project is worth 30 to 790 homes, far above the 5-home tolerance. Until
[money-limited affordable production](../superpowers/specs/2026-11-25-money-limited-funding-design.html)
(spec 2) is measured and lands with the check as its acceptance gate, `money-monotone` is a
report: it is run and its last line recorded, and its exit 1 blocks nothing.

### Fixture mode

On a `fixture-<n>` build `funding.json` is the twin
`pipeline/test/fixtures/mini/enrichment/funding.json`: the live `perHome` (so `AFFORDABLE` agrees),
the live ids, kinds and order, two invented award rows (`FIXTURE-1`, 20 homes in 2024; `FIXTURE-2`,
30 homes in 2025), every bound tier 2 with a method or reason beginning "Fixture: invented", and
every `cite.label` beginning "Fixture:". Its values and bounds:

| Source                        | Dollars a year | Bound               | Inflows (`asOf` A)                 |
| ----------------------------- | -------------- | ------------------- | ---------------------------------- |
| `city-debt`                   | 1,500,000      | remaining 3,500,000 | once 1,500,000, 1,500,000, 500,000 |
| `city-ocoh`                   | 1,200,000      | none                | yearly, no end                     |
| `city-general-fund`           | 600,000        | none                | yearly, no end                     |
| `city-housing-stability-fund` | 400,000        | remaining 0         | none (no programme)                |
| `city-impact-fees`            | 1,000,000      | remaining 2,000,000 | once 1,000,000, 1,000,000          |
| `city-housing-trust-fund`     | 800,000        | ends 2043-06-30     | yearly to 2043-06-30               |
| `city-redevelopment`          | 500,000        | remaining 0         | none (no programme)                |
| `state`                       | 3,000,000      | none                | yearly, no end                     |
| `federal-tax-credits`         | 13,293,240     | none (30 × 443,108) | yearly, no end                     |

The City sources total 6,000,000. The `once` inflows fall on A and its anniversaries. The MOHCD rows
come from the mini raw page. Every provenance entry of `baselineFunding`, and `check.provenance`, is tier
4, labelled with the prefix `Fixture (tier 4): `. Stored fixture policies therefore name the same
pool ids as the live site.

## `pipeline/enrichment/funding.json`

Hand-transcribed, committed, read directly by `build` (not fetched, not in the lock) and part of the
dataset-version hash because it sits under `pipeline/`. The pipeline's other enrichment file in this
style is `multiphase.json` ([pipeline.md](pipeline.md#funding-enrichment)).

Schema 2 (`pipeline/enrichment/funding-schema.ts`). Contents: `perHome` (Exhibit F, average funding
per home), `city` (Exhibit E, seven sources with `kind`, `dollarsPerYear`, `debt`, `note`, `cite`,
`bound`), `state` and `federal` (each with `dollarsPerYear`, `tier`, `method`, `cite`, `bound`;
federal's `dollarsPerYear` is its ceiling), `awards` (`years` and `rows`) and `retiredIds`. Every
number carries a citation with a page. A schema-1 file is refused: "funding.json is schema 1: every
source needs a bound (schema 2)".

**Bounds.** Every City source, `state` and `federal` has a `bound`, which says when its money ends:

- `{ kind: 'ends', on, method, tier, cite }`: `on` is a real ISO date; the source's last yearly
  arrival is the last one on or before it.
- `{ kind: 'remaining', dollars, method, tier, cite }`: the dollars the source has left in total, as
  of the citation (an authorisation not yet issued, a balance being spent down); a whole number of 0
  or more. A source with `dollars` above 0 needs `dollarsPerYear` above 0 ("a source with money
  remaining needs a yearly amount").
- `{ kind: 'none', reason, tier, cite }`: law sets no end; `reason` says what was read that shows it.

Each kind is a strict object holding exactly its own keys; a missing bound, an unknown kind or an
extra key is refused at the bound's path. **No bound has tier 4**: the tier is 1, 2 or 3, else "a
bound's tier is 1, 2 or 3: an end nobody has read in a source is not written". `state.tier` and
`federal.tier` are 1, 2 or 3 too. **A source whose money has
ended stays in the file with its bound** (`remaining` 0, or an `ends` in the past), so stored
policies that name its pool keep loading; its pool has no inflow and no programme.

### Stable ids

Stored policies name baseline pools in `baselineScale` and baseline programmes by id, so ids are
stable across dataset versions:

- **Never rename an id.** A later transcription of a new Budget Analyst report keeps every id whose
  source continues, even if its label or amount changes.
- **Never reuse an id** for a different source.
- A source whose money is spent or ended stays in `funding.json` with its bound. `retiredIds` is
  for sources removed from the file: a removed source's id moves there, and the schema rejects a
  current id that is retired.
- Ids match `^[a-z0-9][a-z0-9-]{0,30}$` and do not start `u-` (the 31-character bound plus
  `baseline-` stays within F12's 40; `u-` is the prefix of ids the user adds).

A pipeline test pins the live file's ids to the nine above (`city-housing-stability-fund`, after
`city-general-fund`, is the ninth), so a rename fails a test and is reviewed. A stored policy that
names a retired id loads with that entry dropped and a notice (`finance-levers`' job).

**A `baselineScale` of 0 switches a pool off in the levers** (F7), the federal pool included, from
its day. That is applied by the levers and the engine; it changes nothing in the data
this pipeline emits.

### Updating `funding.json`

When the Budget Analyst, CDLAC or CTCAC publish new figures:

1. Re-read each number in its primary source. Cite the page (the printed page equals the PDF page in
   the Budget Analyst's report), the URL and the retrieval date, with a `quote` where a figure
   rests on a sentence.
2. Edit `funding.json`. Keep every id (see Stable ids), keep a spent or ended source with its
   bound, and keep `perHome` equal to `AFFORDABLE` in `src/lib/sim/finance`
   (`perHome.total` is `costPerHome`; `permanentLoans + other` is `ownPerHome`). A disagreement is a
   `BuildError`, because a silent divergence would make the shares wrong.
3. Update the award rows by the rule below, and `awards.years` (complete calendar years only: a part
   year would understate).
4. Each year, re-read each bound's primary at its cited page and update the bound (`on`,
   `dollars`, `reason`, the cite and its retrieval date): the City's bond summary for `city-debt`'s
   unissued authorisation, the Charter and the Controller for the Housing Trust Fund's last year,
   and the impact-fee balance from MOHCD's yearly annual report (Table 2, Affordable Housing Fund
   Summary). Recompute the federal ceiling from the new award year (the most new-construction
   homes in one year times `perHome.federal`) and rewrite its figures in `federal.method`; the
   schema refuses a ceiling that disagrees with the award rows.
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

### Level sources (OD-F3)

Each source follows its `bound` (the table above): `ends` stops on a date, `remaining` pays until
the stated balance is spent, and only `none` keeps paying its yearly amount for the whole run. That
level is "funding as the recent records show it", a ruled assumption, not a forecast; the user can
scale any pool from a date in the levers. Each pool's provenance states its bound and its cite.

Two caveats on what a City source's dollars pay for:

- `city-debt` includes the 2016 Preservation and Seismic Safety (PASS) bond, which funds
  preservation, not new building (p. 43).
- `city-general-fund` includes $14.5 million work-ordered from the Department of Homelessness and
  Supportive Housing for homeless housing (p. 44).

The implied 780 homes a year sits close to the observed completions a year, which supports the total
even if its parts shift. The model's own output under current law is lower, 687 affordable homes a
year over 2031 to 2040 ("What current law builds against the check", above).

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
4. The baseline funding table, in pool order: fill tier, programme, pool, kind, dollars in the
   first year, share, implied homes a year, end (a pool with no programme prints "none" for its
   programme and implied homes); the fill-tier sentence; then `tiers`, `minHomes`, MOHCD
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
DataSF source in the lock. Its lock entry, with label, licence and homepage, is its credit in
About's Data and licences (`/about#about-data`, which reads the manifest). It is a 2023 snapshot ("all projects as of September
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
V20, V22 and V25 additions are described under Invariants there.

**V25's funding rule** (`fundingOutcomes(cal, live)`, `pipeline/lib/fzp-cal/invariants.ts`) reports a
problem when any of these fails:

- The programmes are exactly one `baseline-<pool id>` per pool that has at least one inflow, in pool
  order, each with `pool` that pool's id; a pool with no inflow has none. "baselineFunding
  programmes [..] are not one baseline-<pool id> per pool with an inflow, in pool order [..]".
- At least one programme exists. "baselineFunding has no programme".
- Every programme's grant share is above 0. "baselineFunding programme {id} has a share of 0".
- The shares, in millionths, sum to at most 1,000,000. "baselineFunding shares sum to {n}
  millionths, over 1000000".
- When every pool has an inflow, they sum to exactly 1,000,000. "baselineFunding shares sum to {n}
  millionths, not 1000000".

The detail reads "baselineFunding {p} pools, {g} programmes; shares {n} millionths", followed by
"; no programme for {ids}" when a pool has none (fixture: `baselineFunding 9 pools, 7 programmes;
shares 947762 millionths; no programme for city-housing-stability-fund, city-redevelopment`). V25
also fails a live build whose `affordableRoutes` is neither tier 0 nor the warned fallback.

## Dataset

`pipeline/` and `src/lib/timelapse` are hashed into the dataset version, so a change here needs a
dataset build and upload before signoff. The package is built and uploaded once, on the Release 1
branch, from the refreshed lock. The pipeline goldens and `fixture-0` change at that release only.
