# Finance score

Homes by income tier and public money in the results: `TimelineScore.tiers` (on every shown run)
and `TimelineScore.money` (on a shown run whose input has `finance` with a pool), and the helpers a
page calls on them. This page covers how a completed home gets a tier, the tier series and the
baseline, the ledger series and their identities, funded and displaced homes, public money per
added home, repayment owed, the legal-limit statements, which runs carry what, the sources and the
budget. Design: `docs/superpowers/specs/2026-11-09-finance-score-design.md`. The ledger comes from
the engine ([finance-engine.md](finance-engine.md)); the prices, `inclusionaryUnits` and the limit
statements from the finance model ([finance-model.md](finance-model.md)); the baseline pools and
`byTier` from the dataset ([finance-data.md](finance-data.md)).

Code, all in `src/lib/sim/scenario/finance-score.ts` unless noted:

| Export                                                                  | Holds                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `tierContext`, `TierCtx`                                                | a run's context, built once per loaded input                                |
| `tiersOf`, `splitByShares`, `allocatePhases`                            | one schedule's final units by tier; the rounding rule; the phase allocation |
| `tierSeries`                                                            | cumulative homes by tier per month                                          |
| `tierBaselineOf`, `tierBaselineLabel`, `TIER_SOURCES`                   | the baseline by tier, its label, the page's Sources                         |
| `poolSeries`, `moneyOf`, `addedBorrowing`                               | the seven series per pool, the whole `money`, the borrowing the policy adds |
| `cityOf`, `perAddedHome`, `displacedShare`, `owedAt`, `CITY_POOL_KINDS` | the derived figures, pure functions of the posted `money`                   |
| `MONEY_SOURCES`                                                         | the page's Sources under "Money details"                                    |
| `src/lib/sim/scenario/simulate.ts`                                      | `simulateDetailed`: the one ledger collector                                |
| `src/lib/sim/scenario/scenario-host.ts`                                 | `shownRun` computes `tiers` and `money`; `postTimeline` posts them          |

`LedgerEvent` is declared in `money.ts` (the engine's type) and re-exported from `finance-score.ts`
rather than declared again: the two are the identical type.

## How a completed home gets a tier

`tiersOf(sc, ctx)` splits a schedule's **final** units (the last revision: the homes counted are the
homes built) into a `TierUnits` whose five fields (`veryLow`, `low`, `moderate`, `aboveModerate`,
`unrecorded`) sum exactly to them. It is gross: existing homes are netted in the series, never
here. The cases, in this order:

1. **A funded affordable project** (`sc.kind === 'affordable'`): the homes go by the `tiers` of the
   programmes that pay it (`sc.funding.programmes`), each weighted by the grant-equivalent it pays.
   One paying programme has weight 1 and `fundBundle` is not called. Several are priced by
   `fundBundle` at the schedule's start size (`revisions[0]`), the size the money was awarded at,
   and the weight of programme `k` is its `grantEquivalent` over the bundle's. When every weight
   is 0 (every paying item a loan or guarantee that saves the project nothing), the programmes
   count equally: this is a tier 4 convention, named so in `TIER_SOURCES`. The shares are
   memoised in `ctx.weights` by the sorted ids. No `funding`, or no paying programmes, makes every
   home `unrecorded`; an id missing from `ctx.programmes` throws, because the ids come from the
   same input and a miss is a defect.
2. **Any other simulated project** (a private one, funded or not): `inclusionaryUnits(units)` of the
   finance model, the rest `aboveModerate`. The rates are held at their November 2026 level for the
   whole run and the tenure is rental (`ASSUMED_TENURE`), so the schedule's dates do not enter.
3. **A pipeline project** (a phase and an unenriched multi-phase row included):
   `unrecorded = min(affordableHomes, units)`, the rest `aboveModerate`. A null or absent
   `affordableHomes` counts as none: the homes are above moderate, because counting them as
   `unrecorded` would claim they are income-restricted and the record does not say that either.
   A recorded 0 is also none, but the Planning field is never blank in the source (53,747 zeros,
   945 positives on the 2026-10-17 lock), so a 0 may mean "not stated" rather than "none". A
   master's count is allocated over its phases in proportion to `phases[j].units`, by largest
   remainder, ties to the lower phase (`allocatePhases`; a phase's id is `<id>:phase:<j + 1>`); an
   unenriched multi-phase row takes its count whole.

**Worked example.** A 101-home affordable project is paid by programme `a` (grant-equivalent
600,000 a home; `tiers` very low 0.6, low 0.4) and `b` (200,000 a home; very low 0.2, low 0.5,
moderate 0.3). The weights are 0.75 and 0.25; the shares very low 0.5, low 0.425, moderate 0.075.
Exact homes 50.5, 42.925, 7.575; the floors 50, 42, 7 (99); the two homes left go to the largest
remainders, low (0.925) and moderate (0.575): 50 / 43 / 8 / 0 / 0, summing to 101. A tie: 3 homes,
two programmes of equal weight with `tiers` all very low and all low, exact 1.5 and 1.5; the home
left over goes to the earlier tier: 2 and 1.

**The rounding rule** (`splitByShares`): each field gets `floor(n × share + 1e-9)`; the homes left go
one each to the largest fractional remainders, remainders within 1e-9 a tie, ties to the earlier
field in the order above (`unrecorded` last). The 1e-9 is a floating-point tolerance, not a model
number.

**Existing homes** are netted against above moderate, in the series: the dataset carries counts of
existing homes, not their income restriction, and netting them against any other tier would be a
guess. So `aboveModerate` can be negative in a month, as `completedNet` can.

## The tier series and the baseline

`tierSeries(schedules, ctx, asOf, horizon, months)` has exactly the month rules of `addNet`
(`score.ts`): at a construction start after `asOf`, `existingUnits` come off `aboveModerate`; at
completion `tiersOf` is added; both at `idx(day)` with no clamp. The five fields of month `i` sum
to `shownSeries(...)[i].completedNet`: the equivalence with `completedNet`, asserted by the tests
and by the e2e case. Nothing is added for a master.

`unrecorded` homes belong to no tier's fraction. They count in the total (so in the RHNA total's
progress) and a page may show them as their own line; they are never spread over the tiers. The
four tier fractions, weighted by their targets, sum to less than the total's progress by
`(baseline.unrecorded + completed[i].unrecorded) / 82,069`.

There are no twin tiers: the twin and the band run through `simulateNet`, which computes none; the
"vs FZP" comparison stays on the total.

**The baseline.** `tierBaselineOf(rhnaCompletedNet)` passes `rhnaCompletedNet.byTier` through (all
zeros when a file has none). It is net completions since 30 June 2022 from the housing-production
records, and `tierBaselineLabel(since)` says so: "completed since 30 June 2022 (net)". It will
not match the Budget Analyst's Exhibit D, which reports 9,581 homes of progress "as of 2025" where
this baseline is 8,709 on the live data: the two measure different things (Exhibit D's figures are,
by inference, the City's annual progress reports, which count permits). Exhibit D is not used as
data. Each tier's `fraction[i]` is `(baseline + completed[i]) / target.units`, uncapped, against
`RHNA_TIER_TARGETS` (82,069 in all), with the RHNA deadline.

## The ledger and its series

`simulateDetailed` collects the engine's ledger (see [finance-engine.md](finance-engine.md), "The
ledger protocol"). The events, one per programme of a project, `in` with `programme: null`:

| Moment                            | Event                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| An inflow arrives                 | `in`                                                                                 |
| A funded project is awarded       | `commit` of its grant, loan principal and guarantee reserve                          |
| It enters construction            | `spend` (the grant is paid, the loan principal goes out)                             |
| It exits before construction      | `release` of what is committed                                                       |
| It completes                      | `repay` (loan), `release` (guarantee reserve)                                        |
| It exits after construction began | grant: `loss`; loan: `loss` and `repay` of the rest; guarantee: `loss` and `release` |

An event is classed by the instrument of its `programme` in `finance.programmes` (`poolSeries`
throws on an unknown pool or programme: a defect). Within a day the engine orders them `in`, then
the money events of awarded projects (`spend`, `repay`, `loss`, release), then `commit`; a
guarantee's release comes before its loss, so the availability identity holds after every event.
Only that order of events within a day matters to the series, which are end-of-month sums.

Each pool gets seven series, one value per month at its end, in whole constant dollars, in
`finance.pools` order. With `C, R, S, P, L` the cumulative `commit`, `release`, `spend`, `repay`,
`loss` and a subscript for the instrument:

| Series       | Kind       | Definition                                        |
| ------------ | ---------- | ------------------------------------------------- |
| `received`   | cumulative | `in`                                              |
| `committed`  | stock      | `C - R - S`: committed, not yet spent or released |
| `out`        | stock      | `S_loan - P - L_loan`: loan principal outstanding |
| `spent`      | cumulative | `S_grant`: grants paid                            |
| `repaid`     | cumulative | `P`                                               |
| `lost`       | cumulative | `L_grant + L_loan + L_guarantee`: every `loss`    |
| `lostCredit` | cumulative | `L_loan + L_guarantee`                            |

`committed` and `out` are amounts outstanding; the other five are cumulative. **`lost` counts every
`loss` event**, grants paid to projects that then dropped out during construction included (they are
also in `spent`; the series says how much was spent on homes never finished). **`lostCredit`** holds
only loan and guarantee losses and is what `publicSpent`, the City helpers and the engine's
available-money identity use, so a lost grant is never counted twice.

**Identities**, asserted on every pool and month by the property tests:

- I1. `received`, `spent`, `repaid`, `lost` and `lostCredit` never decrease; `committed` and `out`
  are never negative.
- I2. `C = R + S + committed`.
- I3. `S_loan = out + repaid + L_loan`.
- I4. For a capped pool, `leverage x received - committed - spent - out - lostCredit >= 0`.
- I5. `lost = lostCredit + L_grant`, and `L_grant <= spent`.
- I6. An uncapped pool's `received` is 0 in every month.

(The engine page's table maps its E5 to I6 and E6 to I5; by the definitions above E5 is I5 and E6
is I6. A label swap only.)

## Funded and displaced homes

`fundedHomes[i]` sums `finalUnits - existingUnits` over every schedule **with `funding`** that
completed by month `i`, counted at completion (unlike `completedNet`, which takes existing homes
off at the construction start). The rule keys on `funding`, never on `origin`. `displacedHomes[i]`
sums `funding.displaced` over the same schedules. **`displacedHomes` counts only funded projects
that completed**: homes displaced by funded projects that dropped out, or are still being built at
the end of the run, are not counted (the interface as written). The displaced start's own
completion date is not tracked; its homes are counted in the month the funded project completes (a
tier 2 simplification). `displacedShare(money, i)` is displaced over funded, null with none
funded, for the page to set beside `DISPLACEMENT_RANGE`.

## Public money per added home

`publicSpent[i]` is `spent + lostCredit` over **every** pool (City, state, federal, public bank):
the money that is gone, grants paid plus loans and guarantee calls not recovered. Outstanding loans
and committed money are not in it. `cityOf(money, i)` is the same sum over `CITY_POOL_KINDS` (`goBond`,
`cop`, `generalRevenue`, `dedicatedTax`, `bank`; `state` and `federal` are not the City's).

`perAddedHome(money, i, 'all' | 'city')` is that money over `fundedHomes[i] - displacedHomes[i]`.
Builder's call: the quotient is rounded to whole dollars with `Math.round` (the spec says "rounded
to whole dollars (half up)"; the values are non-negative, so that is half up; if the spec meant
the numerator only, which is already whole dollars, this is a one-line change). A denominator of 0
or less gives null (the page says "no homes added yet"); a numerator of 0 over a positive
denominator gives 0.

**"Added" is measured within the shown run, not against the twin.** The twin carries the unscaled
baseline, so in the default run the twin and the plan spend the same money and add the same homes:
a twin difference would be 0 over 0 exactly when the user most wants to know what today's funding
buys. The run's own counterfactual per lot (`displaced`) already nets out the private homes the
money pre-empted. The figure is taken at the scrubbed month. **It reads high early in a run:**
money spent on projects not yet complete is in the numerator while their homes are not yet in the
denominator, and the figure settles as projects complete.

## Repayment owed

`owed` has one entry per pool with `debt` (the `goBond` and `cop` pools), in pool order, a pool of
principal 0 included: `principal` is the pool's last `received` (money borrowed is owed whether
or not it was spent), `repayment` is `debtService(principal, debt).total` (the level yearly payments, payments after
the horizon included) and `nominal: true`: the one figure not in constant dollars. **`owed` covers
every debt pool**, the baseline's `city-debt` bond pool included: money borrowed is owed whoever
decided to borrow it. `owedAt(entry, received)` scales the repayment by `received / principal`
(0 when the principal is 0), within a dollar of `debtService` at that principal, so the page needs
no debt terms.

## The limit statements

**`limits` measure only the borrowing the policy adds**, never the baseline's own bond programme
(already authorised and held level). `limits = limitStatements(addedBorrowing(plan, baseline,
asOf, horizon))`; the statements, their order and their texts are the finance model's. They are
consequences, never limits: nothing here changes a run.

`addedBorrowing(plan, baseline, asOf, horizon)`, for each `goBond` or `cop` pool of `plan.pools`
with a `debt`, in order: what the pool receives from `asOf` to `horizon` (the sum over its inflows
of the dollars of each `inflowArrivals` arrival), less what the same pool in `baseline` (the
twin's unscaled pools) receives, never below 0; a pool not in `baseline` is added whole. It is the
**net over the whole run, computed from the inflows**, not arrival by arrival, because a bond
authorisation and the Charter cap are totals: a scale of 0.5 until 2029 and 2 after it adds only
the net. An entry is emitted only when the principal is above 0. It is computed from the policy's
input and not from the ledger, so the statements are the same in every seed.

**Off days are skipped, as the engine does.** For a pool of `plan.pools`, `addedBorrowing` drops
every arrival on a day inside that pool's `plan.off` spans (`to` inclusive, null no end,
overlapping spans their union, the engine's `isOff` rule, which needs a whole `FinanceIndex` the
score's partial plans do not always have). The baseline pools have no off spans of
their own, so their arrivals all count. `limits` therefore agree with `owed` (from the ledger)
whatever F7 does to the inflows: the result is identical when F7 zeroes them.

**The default policy states no limit:** `plan.finance` equals the twin's, every baseline
difference is 0, and `limits` is `[]`.

## Sources

`TIER_SOURCES` (the page's "Homes by income level"), in order: the RHNA tier targets (tier 1); funded
affordable homes (tier 2; the equal-weight fallback named a tier 4 convention); private projects
(`INCLUSIONARY` and `ASSUMED_TENURE` provenance from the finance model; tier 2, the weaker of the two); pipeline projects (tier
0, the `affordableHomes` convention above); existing homes (tier 2); the baseline. **Builder's
call:** entry 6 is a constant tier 0 statement, because a constant cannot hold dataset data: the
dataset's own `rhnaCompletedNet.provenance` and `tierBaselineLabel(since)` are rendered beside it
by the page. If that is wrong, the alternative is a function `tierSources(rhna)`, which
changes the export's shape.

`MONEY_SOURCES` (the page's "Money details"), in order: the engine's `PIPELINE_FUNDED` (pipeline
projects are taken as already funded, tier 4; imported from the engine, not copied); the definition
of public money per added home (tier 2); `DISPLACEMENT_RANGE.provenance` (tier 3); repayment owed
(tier 2: level yearly payments, the Budget Analyst's Exhibit 40 method, nominal dollars). The limit
statements carry their own provenance.

## Which runs carry what

| Run                           | `tiers`        | `money`                   | Computed by                                       |
| ----------------------------- | -------------- | ------------------------- | ------------------------------------------------- |
| Shown run (`/sim`, `/s/<id>`) | yes, every run | when `finance` has a pool | `shownRun`, once per run, from `simulateDetailed` |
| Twin                          | no             | no                        | `simulateNet`, unchanged                          |
| Band runs                     | no             | no                        | `simulateNet`, unchanged                          |
| `/lesscars` build             | no             | no                        | `addNet` and `runEngine`, unchanged               |

**`simulateDetailed` is the one ledger collector**: it passes a `ledger` sink that pushes each event
in arrival order, and only when the input has `finance` (otherwise `ledger` is `[]` and no sink
is passed, so a run without finance is untouched). **The fast path is untouched:** `addNet`,
`NetAcc` and `simulateNet` are unchanged, so the band, the twin and `/lesscars` cost what they
cost before. `shownRun` computes `tiers` with `tierSeries` and `money` with `moneyOf` (the twin's
`finance.pools` as `baseline`), after `shownSeries`; `postTimeline` posts the same objects on every
post. `TierCtx` is built when the loaded input changes (a lever revision), not per run.

`pipeline/lib/lesscars/runs.ts` calls `runEngine` with its own sinks (`runs.ts:336`, `:339`, `:448`)
and passes no `ledger` sink, so it collects no ledger; its outputs are unchanged.
`src/lib/sim/scenario` and `src/lib/scoreboard` are hashed into the dataset version
(`pipeline/lib/version.ts`), so this subsystem changes the dataset version; the dataset is built
and uploaded once, at the release.

## The budget

On the bench city with the bench funding set, `tierSeries` plus `moneyOf` add at most 15 ms to the
shown run (`scenario.bench.spec.ts`, "finance-score: tierSeries + moneyOf add ≤ 15 ms to the shown
run"; `npm run test:perf`, not in signoff). Tiers are linear in schedules and months plus one
`fundBundle` call per distinct set of paying programmes; money is linear in events and in
7 x pools x months. The posted money is at most 20 pools x 7 series x 483 months, about 68,000
numbers a post. **Measured (BALLPARK):** median 2.6 ms (nine runs, 2.4 to 3.4 ms), load average
1.45 on a machine with other agents running.

The e2e case (`e2e/sim.spec.ts`, "a run carries homes by tier and, with the baseline funding, money
with no limits") runs the shipped path against `fixture-0`: four tier targets, the five fields of
the last month summing to `completedNet`, pools present and `limits` empty.
