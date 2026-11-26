# Finance engine

The engine's funded starts: a second possible start per lot and project kind, the line of applications
waiting for money, the pools that pay them, the ledger of that money and the card fields that say
what paid a project. This page covers `SimInput.finance`, `off`, the latents of an attempt, the
line and its order, the award rule, re-pricing and lapse, the ledger protocol, `sampleAdvance` and
`buildSimInput`'s table. The step engine runs on months: its line order, once-a-month serving, re-making and respelling are rules 9 to 19 in [world-funding.md](world-funding.md), which wins where the two differ. This page holds what both share: the award rule, the key's parts, lapse conditions, event amounts and the ledger identities. Design:
`docs/superpowers/specs/2026-11-09-finance-engine-design.md`. The prices come from the finance model
([finance-model.md](finance-model.md)); the baseline pools and programmes from the dataset
([finance-data.md](finance-data.md)); the market shift from [market.md](market.md).

Code:

| File                                      | Holds                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/sim/world/rules/funding.ts`      | `inflowArrivals`, `PIPELINE_FUNDED`, `coverageLevel`, `cappedShift`, `below`, pool state, `FinanceIndex`, `awardSet`, `lineKey` |
| `src/lib/sim/world/rules/stages.ts`       | `pathwayFrom` and the stage rules a funded start shares with an ordinary one                                                    |
| `src/lib/sim/world/input/build.ts`        | `buildSimInput`, `Precompute.logit`, `parcelRankOf`                                                                             |
| `src/lib/sim/world/input/market.ts`       | `marketLevel`                                                                                                                   |
| `src/lib/sim/world/score/project-card.ts` | `projectCard` copies `kind` and `funding`                                                                                       |
| `src/lib/timelapse/model.ts`              | `sampleAdvance`                                                                                                                 |
| `src/lib/sim/world/funding/`              | the funding system: the line, serving, re-making, the ledger events                                                             |

## The latents of an attempt

A lot's attempt k has its ordinary start and one **funded latent start** for each project
kind (`market`, `affordable`) that some programme reaches. All draws are on the attempt's stream
`streamOf(sh, entity, k)` (`rng.ts`):

| Draw                | Purpose               | Number | Used by                                        |
| ------------------- | --------------------- | ------ | ---------------------------------------------- |
| `uO` (month)        | `INIT`                | 1      | the ordinary start and the market funded start |
| `vO` (day in month) | `INIT_DAY`            | 2      | the same                                       |
| `uA` (month)        | `INIT_AFFORDABLE`     | 7      | the affordable funded start                    |
| `vA` (day in month) | `INIT_DAY_AFFORDABLE` | 10     | the same                                       |
| `uS` (size level)   | `SIZE`                | 5      | every start; made first                        |

(The numbers of `INIT`, `INIT_DAY` and `SIZE` are those in `rng.ts` `P`; the two affordable purposes
are the ones the paired-draw fix reserved, and no existing draw moved.) So a market funded start is
never later than the ordinary start: it is the same draw at a rate that is never above the ordinary
one.

**Segments.** A spell's months split into segments where the policy frame changes (`world/funding/clocks.ts`). A lot-month takes the view, the market step and the offer of the frame in force on its first day (`viewMonth` is that frame's model month, `frameMoney` its offers and bundles). A programme's or an `off` entry's day dates reach a clock only through the frames compiled from them. The clocks store nothing: each is recomputed from the spell over the frames the lot has lived through.

**Rates per segment.** `z` is the lot's log-odds in the segment's frame (`Precompute.logit`) and `m`
the frame's market step:

- Market kind: `z + m` (plus the frame's parking shift, `frame.parking`, in the world engine;
  `world-core.md`, The car hook), plus the bundle's shift when the bundle is not empty. The
  rate used is `min(ordinary rate, shifted rate)` (the min-rate rule, below).
- Affordable kind: `z + m − slope × (uncoveredPerHome('affordable') − uncoveredPerHome('market')) ÷
costPerHome('affordable')`, plus the bundle's shift when the bundle is not empty.
- The bundle's shift is `cappedShift` (`funding.ts`): `oddsShift` of the grant-equivalent
  capped at the uncovered cost, so coverage above 1 shifts as coverage 1. Every rate is finite: a
  fully funded bundle starts at the ordinary odds at full coverage, not at once (the funding award
  rule, R2 and its clamp). A segment where the view has no size, or the lot has no hazard, gives no
  start.

`piecewiseMonth` turns the draw and the rates into the latent lot-month `T`. Every latent starts on
`r + 1 + floor((T − 1 + v) × MONTH_DAYS)`: there is no first-day rule, so fully funded
applications spread over their month like any other.

A certain bundle starts at the ordinary odds at full coverage (`world/funding/clocks.ts`).

**No application in a month without a bundle.** The month's bundle is the programmes of its kind
that the frame in force on the month's first day offers (active, pool not off) and whose `minHomes`
the drawn size meets. A latent that falls in a month where that bundle is empty makes no application, so money
that is not on offer moves nothing. (Spec 4.3's letter is kept: the application uses its month's
first-day bundle and is not re-made on joining.)

**Memo of prices.** The bundle is priced with `fundBundle`, memoised per input by (kind, programme
set, prototype id; the affordable price ignores the prototype). The engine always passes items in
`finance.programmes` order, so a set fixes the order and the memo key may be the set.

## What `off` does

`finance.off` is a list of `{ pool, from, to }` spans (`to` inclusive, null for no end; overlapping
spans of one pool mean their union).

- A programme is **offered** on day d when it is active (`from ≤ d` and `to` null or `d ≤ to`) and
  its pool is not off on d. Only offered programmes enter a bundle. Switching a pool off never
  splits or renames a programme.
- A programme's or an off span's dates change the frames compiled from them; the clocks read the frame in force on a lot-month's first day.
- An arrival on a day its pool is off is not received: no `in` event, `received` unchanged.
- A pool's commitments run on while it is off: what is committed stays committed and is spent,
  repaid, released or lost as scheduled, and what is left stays unspent. Nothing new is committed
  from it, because it is in no bundle.

## The line key

The line holds the applications waiting for money, across all lots and both kinds. Applications
compare, in this order (`lineKey` in `world/rules/funding.ts`):

1. The month applied: a month's applications join after every waiting row ([world-funding.md](world-funding.md), rule 9); `applied` orders nothing.
2. `keyDay`, the first day of the month the lot's own draw for that kind gives at the lot's
   unshifted hazard (no bundle shift, not certain; for the market kind, the ordinary start's
   month). A month never reached, and any day after 2^28 (`NEVER_KEY_DAY`), compare equal, after
   every other day. The first day of the month and not the month count is used because lots at
   risk from different days count months from different `r`. For the market kind this serves
   applicants in the order they would have started without money. For the affordable kind it is
   the lot's site odds on its own draw: a funded project's site is drawn the way a private
   project's is, on a separate draw.
3. The parcel id, through `parcelRankOf(ids)` (each row's position in the JavaScript string order,
   memoised by the id array). Never a row index, so permuting rows changes nothing.
4. The kind, `market` before `affordable`, for a lot with two applications on equal keys.

`lineKey(keyDay, rank, kind)` packs the key's parts, 2 to 4, into one number below 2^53 (`keyDay` capped at 2^28
times 2^20, plus rank × 2 plus the kind bit; the rank must be below 2^19).

## The award rule

Terms. The **coverage level** is `coverageLevel(c)` = `isCertain(c) ? 1 : c`: coverage counted up to
1, with `isCertain`'s tolerance (`CERTAIN_TOLERANCE`, 1e-9). `below(x, y)` is `x < y − 1e-9`; every
comparison of two levels uses it. A **bundle** B is an application's programmes; **certain** is
level 1. An **ask** of a set S on a pool is the sum, over S's items on that pool, of
`projectDollars` of the item's `granted`, `lent` and `reserve` at the application's start size. A
pool is **short for S** when `available < ask`. A pool S asks nothing of is never short. Every pool
pays only from what it has received, the federal pool included.

`awardSet` (`funding.ts`) for an application with bundle B:

1. S₀ = B.
2. Price the current set and find the short pools. If none, stop. Otherwise remove **every
   programme of every short pool at once**, then repeat. If the set becomes empty, stop with
   nothing.
3. The application is **awarded with S** when S is not empty and `level(S)` is above 0 (the
   fallback award: rule 16 as amended on 2026-11-25,
   [spec](../superpowers/specs/2026-11-25-funding-award-rule-design.html)). S may be below B: the
   application is read as formed at award time from the pools that can pay. Otherwise it waits,
   and nothing is taken from any pool.

Why each part:

- All short pools leave in the same round, so a round is a function of the set and the money, with
  no order among pools. The result does not depend on the order of `finance.pools` or
  `finance.programmes`.
- Leaving a grant out raises what remains for the later tiers and, when its own tier was
  oversubscribed, the fraction every other grant of its tier pays. So a pool that could pay in one
  round may be short in the next; that is why the rule repeats. No pool is added back.
- It ends: each round that does not stop removes at least one pool, and none returns. With the
  baseline there are at most 7 pools in a bundle (the five City pools with a programme, the state
  pool and the federal pool).
- "Above level 0": a short pool is left out and the application is awarded on the pools that can
  pay, at the level they give. A certain application whose set loses a pool starts as a partly
  covered project unless the remaining set is still certain (coverage above 1 through loans and
  guarantees counts as 1, so leaving out a loan that only pushed coverage past 1 keeps it certain).
  Money in the other pools is never left idle because one pool is short.
- An empty set, or a set at level 0 (a loan worth nothing as a grant-equivalent, alone or left
  alone), is never awarded, whole or partial. The lot keeps its ordinary start.
- Everything about the award comes from S's price: the commitments, the ledger, `funding.programmes`,
  the dollars, the certainty and the stage rule. Pools outside S are not touched.

Worked examples (the design's tier 1 baseline per-home figures: federal 443,108, state 118,390,
City 300,027, over an uncovered cost of 861,525; the City's six pools folded into one for brevity):

- **A bond stacked on the City tier.** Federal and state leave 300,027 for the City tier. An added
  `goBond` grant of share 0.5 asks 430,762.5, so the tier's grants (730,789.5) exceed what remains
  and each pays the fraction 300,027 ÷ 730,789.5 ≈ 0.4106 of its share: the City grant 123,176.65 a
  home and the bond 176,850.35. Coverage stays 1; each home takes less City money.
- **City short, bond share 0.5: awarded.** The City programme leaves. The bond, alone in its tier,
  pays `min(430,762.5, 300,027)` = 300,027: coverage 1, awarded, certain, and the bond pool commits
  300,027 a home (the City's part, not its 430,762.5 share).
- **City short, bond share 0.2: awarded, not certain.** The bond alone pays its full share,
  172,305; S covers (443,108 + 118,390 + 172,305) ÷ 861,525 ≈ 0.852. The project is awarded on the
  federal, state and bond grants at 0.852 and is not certain.
- **Bond short.** The bond leaves; the City grant, alone in its tier, pays its full share again:
  awarded, certain.

### The monotonicity argument

Within one pass the pools only lose money, and a larger project asks more. The award test ("the
left set is not empty, and its level is above 0") is monotone in both: if it fails with available money a it fails with any smaller amount, pool by
pool, and if it fails at `units` it fails at any larger size with the same bundle and prototype.
The proof rests on two `fundBundle` properties that [finance-model.md](finance-model.md) states and
tests: leaving an item out never lowers any remaining grant's `granted`, and a loan's `lent`, a
guarantee's `guaranteed` and its reserve do not depend on the set; and a subset's grant-equivalent
is never above the set's. So every pool left in a smaller set is asked as much or more, the set
left under less money is a subset of the set left under more, and its level is not higher, so if
it is empty or at level 0, so is the smaller one. The same two properties give the property the
fallback award is for: adding a programme on its own pool never turns an award into a wait, and
never lowers the awarded level (`funding.spec.ts`, "adding a programme never turns an award into
a wait (property)", 500 random cases).
Termination needs none of it: pools leave and never return. This is exact in real arithmetic; in
floating point a difference of one ulp could move a rounded dollar; the confirming `awardPasses` call decides each award.

## Serving

The line is served once a month, in key order within the month's order: each application is tested by the award rule against the money available at that moment. One that passes is awarded and its asks reduce the pools before the next is tested. One that fails stays in line; a later, smaller application, or one whose bundle leans on other pools, may be awarded in the same scan. Serving is grouped by default: per award group the largest passing size H is found by bisection, which relies on the monotonicity above, and every member is confirmed with `awardPasses` at its own size. Money returned during a scan waits for the next month's scan ([world-funding.md](world-funding.md), rule 10).

**Leaving the line**: awarded; the lot started by another route (its other kind's award, or its ordinary start); lapsed; or the horizon.

### A short pool

A pool that is short for an application, a spent pool with no later inflow included, is left out
of its award: the application is awarded at once on the pools that can pay, at their level, and
waits only when nothing is left or what is left is at level 0. So no application waits on one
spent pool while others hold money. Test: `world/funding/funded.spec.ts`, "rule 16 as amended".

### Monotonicity check

More public money must never build fewer homes. `scripts/money-monotone.ts` runs every subset of the offered funding presets on a dataset and fails when adding a preset costs a set more than 5 homes on net, funded or affordable homes at a deadline year. A change under the funding paths runs it by hand before signoff and records its last line in the PR (rule and paths in [pipeline.md](pipeline.md), "Changes on the funding paths"; the check in [testing.md](testing.md), "The money monotonicity check"). It does not pass yet and is not a gate: today's drops come from the all-or-nothing certainty of an award at level 1 ([finance-data.md](finance-data.md), "What current law builds against the check").

### Known limit: a partly covered application keeps its month's first-day bundle (ruling R24)

The bundle of an application is the one active on the first day of its latent month. A switched-off
span, or a programme `to`, that falls later in that month does not reach the application before
the next re-making, so for up to about a month a partly covered application can still draw on
a source switched off, or a programme that ended, during that month. The bound is that month.
Certain applications (fully covered) and the baseline as it stands are unaffected. The partner
accepted this as an approximation; it is not to be "fixed" without a ruling. The Funding tab states
it in its caveats (`MONTH_OFFER_CAVEAT`, `funding-copy.ts`).

## Re-making, lapse, reservations, regimes

A policy change that alters a waiting application's money or view re-makes it in the month of the change, and a lapsed kind's spell starts again on the month's first day (rules 17 to 19, [world-funding.md](world-funding.md)). A market step changes no bundle and no size, so it re-makes nothing. A re-made application has its view of that month, its size the attempt's size draw in that view, and its bundle B' the programmes of its kind offered then whose `minHomes` it meets. Unless it lapses it **keeps its place in line** (`keyDay` unchanged) and B' becomes its bundle.

**Lapse.** An application lapses when any of these holds:

1. its re-made bundle B' is empty;
2. its lot has no size or no hazard in the view in force;
3. `level(B')` is below `level(B)`, B being its bundle just before. Example: a certain application whose `state` pool is switched off goes from level 1 to about 0.863 (the federal and City shares, (443,108 + 300,027) / 861,525) and lapses.

A level that stays within 1e-9 or rises keeps its place, even if dollars or programmes change (an added City bond on a certain baseline lowers what every City grant pays, pro rata, but the level stays 1). The comparison is with the bundle just before the change, not the first one.

**New spells.** A lapsed application leaves the line and that kind's latent is computed again as a new spell from the month's first day, on the same draws `u` and `v` (so no new purpose), with the rates from then on and a fresh `keyDay`. `respell` is in `world/funding/policy.ts`.

**Reservations** (`reservedFrom`). No application is made on or after the reservation day while it is kept, no award happens on or after it, and on that day every waiting application of the lot lapses for good (no new spell). An award before it voids the reservation unless the project exits before it, as an ordinary start does.

**Regimes.** The latents use each month's view; a funded project runs on the view of its award day.

## The pool state, availability and the events

The pool counters (`FundPools`, `world/funding/columns.ts`), whole dollars: `received`, `committed`, `spentGrant`, `outLoan`,
`lostLoan`, `lostGuarantee`. A pool's availability, F9 (f) term for term, for every pool:

`available = leverage × received − committed − spentGrant − outLoan − lostLoan − lostGuarantee`

`committed` includes the guarantee reserves held. It is always finite. The check is one product less integer sums, so no
comparison depends on floating-point summation order. For a `bank` pool, a grant removes a whole
dollar of headroom, not `leverage` of one, which is conservative.

**The events**, for one awarded project of `u` homes, with the items of its awarded set priced as in
the award rule, `λ = terms.lossOnExit`, a grant's dollars `G`, a loan's principal `P`, a guarantee's
reserve `H` and guaranteed principal `Q`:

| Moment                        | Grant item                                       | Loan item                                  | Guarantee item                                                     |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| Award day                     | `commit` G                                       | `commit` P                                 | `commit` H                                                         |
| `entered.construction`        | `spend` G (committed to spentGrant)              | `spend` P (committed to outLoan)           | nothing                                                            |
| Exit before construction      | `release` G                                      | `release` P                                | `release` H                                                        |
| Completion                    | nothing                                          | `repay` P (outLoan −P)                     | `release` H                                                        |
| Exit after construction began | `loss` round(λG), a mark: `spentGrant` unchanged | `loss` round(λP) and `repay` P − round(λP) | `release` H, then `loss` X = min(round(λQ), H) (lostGuarantee + X) |
| Open at the horizon           | stays committed or spent                         | stays committed or out                     | stays held                                                         |

Events of zero dollars are not emitted; nothing after the horizon is emitted. Rounding is
`Math.round`, as `projectDollars`. A guarantee's loss is at most its reserve, so a guarantee pool
never pays more than it set aside. With λ = 1 (tier 4) a guarantee loses its whole reserve.

**One event per programme.** The ledger event is emitted per programme of the awarded set, not merged
per pool, and every event except `in` carries its `programme` id (`null` on `in`). Only the
programmes of the awarded set are in the ledger.

**Inflows.** Each arrival of a pool on a day the pool is not off emits `in` with its dollars
and `programme: null`, and adds to `received`. Zero-dollar arrivals emit nothing.

**Order of events.** Within a model month the world orders events by system, not by day ([world-score.md](world-score.md)). Within one project's events a guarantee's release precedes its loss (the conductor's ruling, 2026-11-11): when a guarantee exits after construction began, `release H` is emitted before `loss X`, so the pool's availability identity (E4) holds after every event, including when the pool was fully held beforehand. Every other case keeps spend, repay, loss, release; each by programme in `finance.programmes` order.

### The ledger identities and `finance-score`'s numbers

For each pool, summing its events from `asOf` to any event inclusive: `C`, `R`, `Sg`, `Sl`, `P`,
`Lg`, `Ll`, `Lh` are the sums of `commit`, `release`, `spend` on grants, `spend` on loans, `repay`,
and `loss` on grants, loans and guarantees (the programme's instrument says which).

| Engine | `finance-score` | Statement                                                                                                                                                                             |
| ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1     | I1              | Every cumulative sum never decreases; `committed ≥ 0` and `outLoan ≥ 0`.                                                                                                              |
| E2     | I2              | `C = R + Sg + Sl + committed`: guarantee reserves are committed and released, never spent.                                                                                            |
| E3     | I3              | `Sl = outLoan + P + Ll`: every lent dollar is outstanding, repaid or lost.                                                                                                            |
| E4     | I4              | For every pool, `leverage × received − committed − Sg − outLoan − Ll − Lh ≥ 0`, equal to the engine's value after every event.                                                        |
| E5     | I5              | `Lg ≤ Sg`; and `Lh` over one project's guarantee never exceeds its reserve.                                                                                                           |
| E6     | I6              | Retired (finite funding, 2026-11-22): every pool receives its arrivals. The other identities keep their numbers.                                                                      |
| E7     | none            | Per project and programme: Σ `commit` = Σ `release` + Σ `spend` + still committed; a loan that ended has `spend` = `repay` + `loss`; a guarantee that ended has `release` = `commit`. |

`world/score/test/money-identities.ts` asserts these after every event. E7 there is checked per
programme, as the ledger carries no project id.

## The funded project

On award day D the lot leaves every line and the project is built. It is **certain**
when `level(S) = 1`; a certain bundle awarded without a short pool is certain, one awarded after a
short pool left is certain only when what is left still reaches level 1.

- **Stream and id**: the attempt's stream, so later draws are those the attempt's ordinary start
  would have used; `projectId` is `sim:<parcel id>:<k>`.
- **Pathway**: a Local Program lot takes `streamlined`. Otherwise a certain `affordable`
  project draws it from `Calibration.affordableRoutes` (`pathwayFrom`, on `P.PATHWAY`); every other
  funded project uses `pathwayForNew`.
- **First stage and size**: as an ordinary start; `revisions[0]` is the award day's size in the
  application's view.
- **Stages, partly covered**: the ordinary stage rules with the simulated revision rule; its
  commitments stay at the start size.
- **Stages, certain**: certain stages: revisions off, never an exit. See `sampleAdvance`.
- **Next attempt**: a funded project that exits on day x frees the lot, and attempt k + 1 begins at
  r = x on stream `(entity, k + 1)`, as after an ordinary exit. The next attempt is computed when
  the project starts, not when its exit day is reached (its output is the same).

### `sampleAdvance`

`sampleAdvance(t: Transition, u: number): { days: number }` in `src/lib/timelapse/model.ts` is
`sampleTime(t, 'advance', u, 0)`: the advance column of the transition's table, renormalised to the
advances. A transition whose advance has no mass (all-zero table and a tail advance of 0) never
advances, and the function returns `ceil(MAX_EVENT_MONTH × MONTH_DAYS) − 1`, a day beyond every
horizon, so the project stays open. It tests the mass condition and does not call `sampleTime` and
catch. `u` outside [0, 1) throws `RangeError('u must be in [0, 1), got <u>')`, checked first.

A certain project's stage entered on day e is left on day
`e + floor(x × sampleAdvance(t, u).days)` (`world/stage.ts`): `t` is the unscaled transition for the project's pathway and stage, `u` the project's stage-time draw, `x` its timer scale for that stage (1 for a stage it does not name). The outcome is always `advance`, and `P.STAGE`, the
kind draw, is not read. That is the ordinary stage time with the kind fixed to advance. So a certain
project spends the same days in a stage as an uncertain project with the same stream, pathway,
stage and scale that advances, and a timer scales a certain project's stages as it scales any
other's. `model-golden.json` does not carry `sampleAdvance`; a test ties it to `sampleTime`.

## The schedule and the card

Both fields appear only on simulated schedules of a run with `finance`, and only on funded
projects; an ordinary start in such a run has neither.

- `Schedule.kind`: `'affordable'` for an affordable funded start, absent for market.
- `Schedule.funding.programmes`: the **paying programmes** of the awarded set: those whose exact
  per-home `granted`, `lent` or `guaranteed` (from `fundBundle`, before rounding) is above 0, in
  `finance.programmes` order. A programme of the bundle left out at the award, and a grant that
  pays 0 because earlier tiers already met the uncovered cost, are not listed. The exact amount
  decides, not the rounded project dollars: such a programme can be listed with 0 project dollars
  and no ledger event, which needs a typed share below about one dollar over the project's homes,
  never a baseline one.
- `funding.applied`: the application's `applied` day (the current spell's).
- `funding.granted`, `lent`, `guaranteed`: the sums over the awarded set of `projectDollars` of the
  items' `granted`, `lent` and `guaranteed` (the guaranteed private principal, not the reserve),
  at the start size.
- `funding.certain`: `level(S) = 1`, exactly the flag that makes the project's stages certain.
- `funding.displaced`: the homes of the ordinary start this funded start pre-empted: if the
  attempt's ordinary start exists, is on or before the horizon and is before a kept reservation
  day, that start's size level's units less the attempt's existing homes; otherwise 0. A market
  funded start whose ordinary start would have come before the horizon displaces its own
  counterpart: those homes would have been built without the money.

**Re-pricing `funding.programmes` gives the same dollars.** `finance-score` prices
`funding.programmes` again with `fundBundle`, at `prototypeFor(revisions[0].stories,
revisions[0].units)`, the start size the engine priced. Under the tier rule a grant with a share
above 0 pays exactly 0 only when nothing remains for its tier, and then every grant of its tier
and of later tiers pays 0 too, so dropping it changes no other item; loans and guarantees do not
depend on the set. The listed programmes keep `finance.programmes` order, so the floating-point
sums match too. `score/finance.spec.ts` asserts the equality.

`ProjectCard.kind` and `ProjectCard.funding` (`{ programmes, certain }`) are copied from the
schedule by `projectCard` (`score/project-card.ts`) for simulated schedules only; the card does no pricing and a
hand-built schedule's `certain` is copied whatever the input holds.

## Rule (l): pipeline rows, `PIPELINE_FUNDED`, `inflowArrivals`

Pipeline rows and phases never apply and never touch a pool. The pools start at `asOf` with no
commitments, so money the City has already committed to projects in the pipeline is not taken off.
That overstates what the pools can fund in the first years, by up to the pipeline's outstanding City
commitments (inferred; no open dataset gives City funding per project). `world/rules/funding.ts` exports the
statement, a `Provenance`, for the results' sources:

```ts
export const PIPELINE_FUNDED: Provenance = {
  tier: 4,
  label: 'Projects already in the pipeline are taken as funded',
  sources: [],
  method:
    'The simulation’s funding pools pay only for projects that start after the data date. ' +
    'Projects already in the pipeline are assumed to have their funding already, outside the ' +
    'pools, so the pools start with nothing committed: money the City has already committed to ' +
    'them is not subtracted. This overstates what the pools can fund in the first years.'
};
```

`finance-score` lists it among the money results' sources, and `funding-ui` shows it with them.

`inflowArrivals(inflow, asOf, horizon)` in `world/rules/funding.ts` is the one arrival rule, and
`finance-levers` imports it. A `once` inflow arrives on its `day`; a `yearly` one on `from` and the
same UTC month and day of each later year (29 February becomes 28 February in a common year), up to
`to` inclusive. Only arrivals with `asOf ≤ day ≤ horizon` are received, an arrival on `asOf`
included; one before `asOf` never arrives.

## `buildSimInput` and `marketLevel`

`buildSimInput` (`input/build.ts`) sets `market` and `finance` from the calibration:

| `calibration.market` | `calibration.baselineFunding` | `marketLevel` | `market`                          | `finance`                                                                                                                                 | Warnings (via `warn`, in order)                                                                                                                                         |
| -------------------- | ----------------------------- | ------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| present              | present                       | `'private'`   | `marketSteps(m, asOf, 'private')` | `{ pools, programmes }` of `baselineFunding` (deep-copied), `off: []`, `slope: m.slope.perCostShare`, `terms: resolveTerms(MARKET_TERMS)` | none                                                                                                                                                                    |
| present              | absent                        | `'all'`       | `marketSteps(m, asOf, 'all')`     | absent                                                                                                                                    | none                                                                                                                                                                    |
| absent               | present                       | `'all'`       | absent                            | absent                                                                                                                                    | `calibration.json: no market model; the run uses the 2007-2025 average market`, then `calibration.json: baselineFunding without a market model; the run has no funding` |
| absent               | absent                        | `'all'`       | absent                            | absent                                                                                                                                    | the no-market warning only                                                                                                                                              |

`marketLevel(calibration)` (`input/market.ts`) is `'private'` exactly when the calibration has both
`market` and `baselineFunding`, else `'all'`. That is exactly when `buildSimInput` sets `finance`, so
the engine and the page change level together. `buildSimInput` and the page's statement of the
market (`marketSentence`, About's "In force" line) all call it, and nothing names a
level itself, so the page can never state a level the engine is not running. The reasons for the
table: a dataset from before Release 1 has neither field and its saved plans keep loading as they
did; without a market model there is no slope, so no programme can be priced. The mini calibration
has neither, so the mini input gets neither. The site's
default run and the twin both run the baseline funding on the private-starts level.

## Determinism

Every per-lot quantity is a pure function of (seed, entity, k, purpose). Every choice in the funded
step is ordered by day, then the fixed step order, then the line key or the parcel rank, never visit
order or a row index; so permuting the rows of `parcels` (same ids) gives the same schedules and
ledger. The award rule is a function of the bundle, the size, the prototype and the money, with no
order among pools.

## Tests and fixtures

See [testing.md](testing.md) for the commands. The award rule and its monotonicity are in
`src/lib/sim/world/rules/funding.spec.ts` (arrivals, validation, levels, `isOff`, `available`); the
funded step is in `world/funding/` (`funded.spec.ts`, the golden `funded.golden.test.ts`, and the
specs for serving, re-pricing and closing); `score/project-card.spec.ts` covers the card.

The mini fixture (`miniFinance()`, `world/fixtures/mini-finance.ts`) has three pools: `m-city`, yearly
20,000,000 from `asOf`; `m-bank`, a `bank` pool with one 5,000,000 inflow on `asOf + 400`; and
`federal`, one yearly inflow of 10,000,000,000,000 from `asOf` (`LEGACY_UNCAPPED_DOLLARS`), which no
test reaches.
