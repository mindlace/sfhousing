# Finance engine

The engine's funded starts: a second possible start per lot and project kind, the line of applications
waiting for money, the pools that pay them, the ledger of that money and the card fields that say
what paid a project. This page covers `SimInput.finance`, `off`, the latents of an attempt, the
line and its order, the award rule, re-pricing and lapse, the ledger protocol, `sampleAdvance`,
`buildSimInput`'s table, the bench and its budgets. Design:
`docs/superpowers/specs/2026-11-09-finance-engine-design.md`. The prices come from the finance model
([finance-model.md](finance-model.md)); the baseline pools and programmes from the dataset
([finance-data.md](finance-data.md)); the market shift from [market.md](market.md).

Code, all in `src/lib/sim/scenario/` unless noted:

| File                         | Holds                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `funding.ts`                 | `inflowArrivals`, `PIPELINE_FUNDED`, `checkFinance`, `coverageLevel`, `below`, pool state, `FinanceIndex`, `awardSet` |
| `funded.ts`                  | `fundedPass` (the three phases and the day loop), the latents of an attempt, re-pricing, the shortcuts                |
| `line.ts`                    | the line: `scanLine` (the definition) and `groupedLine` (the implementation)                                          |
| `money.ts`                   | `Treasury`: pool counters, inflows, the money events and the ledger                                                   |
| `engine.ts`                  | the branch in `runEngine`, `Job.certain` in `stageStep`, `startSimulated`, `EngineOpts` (tests only)                  |
| `input.ts`, `market.ts`      | `buildSimInput`, `Precompute.logit`, `parcelRankOf`; `marketLevel`                                                    |
| `card.ts`                    | `projectCard` copies `kind` and `funding`                                                                             |
| `src/lib/timelapse/model.ts` | `sampleAdvance`                                                                                                       |

Where this page and the design differ, the code is described and the ruling that made it so is
named (rulings R-P1, R-P6, R-5a, R-7a, R-11a and the conductor's order for a guarantee's release; see
the end).

## The three phases, and a run without finance

`runEngine` keeps its three passes (pipeline rows, multi-phase masters, simulated). The simulated
pass branches once: with `input.finance` absent it runs today's `simulatedPass`, untouched, so a
run without finance is the run the engine made before this subsystem, schedule for schedule, under
the same `market`. A test holds that (`engine-finance.spec.ts`, "no public money means no change"),
beside `golden-seed1.json`, which has no `finance`. The site's default is not that case: it runs
the baseline funding ([buildSimInput](#buildsiminput-and-marketlevel)).

With `finance` present, `fundedPass` has three phases:

1. **Eager phase**, lot by lot, in any order. Each candidate's attempts are walked as today while
   the ordinary start comes before every funded application of the attempt; those attempts give
   exactly today's schedules and go to the sink at once. The first attempt whose earliest
   application is on or before its ordinary start **parks** the lot: its state goes to the day
   loop's calendar.
2. **Day loop**, in day order from `asOf` to the horizon. On each day, in this order: inflows;
   money events of awarded projects dated that day; re-pricing and lapse on a re-pricing day, and
   reservation lapses; new applications join the line; the line is served; ordinary starts of
   parked lots (in parcel-rank order); the next attempt of a lot whose project exits.
3. **Close**: reservation reports for reserved lots, and `reservationsOff`, as today.

Pipeline rows and multi-phase masters run first and fill `Holds`, as today (rule (l), below).
`checkFinance` runs after `checkInput` and throws a `RangeError` with a path before the first sink
call, so a failed input produces no output. Every message is the design's section 4.2 text.

## The latents of an attempt

A lot's attempt k has its ordinary start, as today, and one **funded latent start** for each project
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

**Segments.** For one attempt the months from its risk start `r` split into segments at the regime
days, the market step days, every programme's `from` and `to + 1`, and every `off` entry's `from`
and `to + 1`. A month falls under the segment of its first day, the rule the dated regimes use.
Within a segment the view, the market step and the offered programmes are constant. `FinancePre`
(`funded.ts`, `financePreOf`, memoised per input) holds the days, the views, the steps and, per kind
and segment, the offered programmes.

**Rates per segment.** `z` is the lot's log-odds in the segment's view (`Precompute.logit`) and `m`
the market step's:

- Market kind: `z + m`, plus `oddsShift` of the bundle when the bundle is not empty. The rate used
  is `min(ordinary rate, shifted rate)` (the min-rate rule, below).
- Affordable kind: `z + m − slope × (uncoveredPerHome('affordable') − uncoveredPerHome('market')) ÷
costPerHome('affordable')`, plus `oddsShift` of the bundle when the bundle is not empty.
- A certain bundle gives rate `−Infinity` (hazard 1). A segment where the view has no size, or the
  lot has no hazard, gives no start.

`piecewiseMonth` turns the draw and the rates into the latent month `T`. A latent that falls in a
**certain** month starts on that month's first day, so every certain application of a cohort is on
one day and the line key, not a uniform, orders them. Any other latent starts on
`r + 1 + floor((T − 1 + v) × MONTH_DAYS)`.

**No application in a month without a bundle.** The month's bundle is the programmes of its kind
that are active on its first day, whose pool is not off that day and whose `minHomes` the drawn size
meets. A latent that falls in a month where that bundle is empty makes no application, so money
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
- Off and on days are segment bounds and re-pricing days, like programme days.
- An arrival on a day its pool is off is not received: no `in` event, `received` unchanged.
  `Treasury` drops those arrivals when it builds its calendar.
- A pool's commitments run on while it is off: what is committed stays committed and is spent,
  repaid, released or lost as scheduled, and what is left stays unspent. Nothing new is committed
  from it, because it is in no bundle.

## The line key

The line holds the applications waiting for money, across all lots and both kinds. Applications
compare, in this order (`App` in `line.ts`; `lineKey` in `funded.ts`):

1. `applied`, the application day. It is kept across re-pricing, so a programme date does not
   reshuffle the queue.
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

`lineKey(keyDay, rank, kind)` packs 2 to 4 into one number below 2^53 (`keyDay` capped at 2^28
times 2^20, plus rank × 2 plus the kind bit; the rank must be below 2^19).

## The award rule

Terms. The **coverage level** is `coverageLevel(c)` = `isCertain(c) ? 1 : c`: coverage counted up to
1, with `isCertain`'s tolerance (`CERTAIN_TOLERANCE`, 1e-9). `below(x, y)` is `x < y − 1e-9`; every
comparison of two levels uses it. A **bundle** B is an application's programmes; **certain** is
level 1. An **ask** of a set S on a capped pool is the sum, over S's items on that pool, of
`projectDollars` of the item's `granted`, `lent` and `reserve` at the application's start size. A
capped pool is **short for S** when `available < ask`. A pool S asks nothing of is never short.

`awardSet` (`funding.ts`) for an application with bundle B:

1. S₀ = B.
2. Price the current set and find the short pools. If none, stop. Otherwise remove **every
   programme of every short pool at once**, then repeat. If the set becomes empty, stop with
   nothing.
3. The application is **awarded with S** when S is not empty and `level(S)` is not below
   `level(B)`. Otherwise it waits, and nothing is taken from any pool.

Why each part:

- All short pools leave in the same round, so a round is a function of the set and the money, with
  no order among pools. The result does not depend on the order of `finance.pools` or
  `finance.programmes`.
- Leaving a grant out raises what remains for the later tiers and, when its own tier was
  oversubscribed, the fraction every other grant of its tier pays. So a pool that could pay in one
  round may be short in the next; that is why the rule repeats. No pool is added back.
- It ends: each round that does not stop removes at least one pool, and none returns. With the
  baseline there are at most 7 capped pools in a bundle (six City pools and the state pool; the
  federal pool is uncapped and never short).
- "Not below, with the tolerance": a certain application is awarded only with a certain set, so it
  never starts as a partly covered project. A partly covered one may be awarded with a set whose
  level is equal within 1e-9 or higher. Coverage above 1 (through loans and guarantees) counts as
  1, so leaving out a loan that only pushed coverage past 1 does not stop the award.
- An empty set is never awarded, even when B's coverage is 0. The lot keeps its ordinary start.
- Everything about the award comes from S's price: the commitments, the ledger, `funding.programmes`,
  the dollars, the certainty and the stage rule. Pools outside S are not touched.

Worked examples (the design's tier 1 baseline per-home figures: federal 443,108, state 118,390,
City 300,027, over an uncovered cost of 861,525; the City's six pools folded into one for brevity;
`engine-finance-stack.spec.ts`, "a short pool is made up by another only as far as its share
allows"):

- **A bond stacked on the City tier.** Federal and state leave 300,027 for the City tier. An added
  `goBond` grant of share 0.5 asks 430,762.5, so the tier's grants (730,789.5) exceed what remains
  and each pays the fraction 300,027 ÷ 730,789.5 ≈ 0.4106 of its share: the City grant 123,176.65 a
  home and the bond 176,850.35. Coverage stays 1; each home takes less City money.
- **City short, bond share 0.5: awarded.** The City programme leaves. The bond, alone in its tier,
  pays `min(430,762.5, 300,027)` = 300,027: coverage 1, awarded, certain, and the bond pool commits
  300,027 a home (the City's part, not its 430,762.5 share).
- **City short, bond share 0.2: waits.** The bond alone pays its full share, 172,305; S covers
  (443,108 + 118,390 + 172,305) ÷ 861,525 ≈ 0.852, below 1. The project waits and nothing is taken.
- **Bond short.** The bond leaves; the City grant, alone in its tier, pays its full share again:
  awarded, certain.

### The monotonicity argument

Within one pass the pools only lose money, and a larger project asks more. The award test is
monotone in both: if it fails with available money a it fails with any smaller amount, pool by
pool, and if it fails at `units` it fails at any larger size with the same bundle and prototype.
The proof rests on two `fundBundle` properties that [finance-model.md](finance-model.md) states and
tests: leaving an item out never lowers any remaining grant's `granted`, and a loan's `lent`, a
guarantee's `guaranteed` and its reserve do not depend on the set; and a subset's grant-equivalent
is never above the set's. So every pool left in a smaller set is asked as much or more, the set
left under less money is a subset of the set left under more, and its level is not higher.
Termination needs none of it: pools leave and never return. This is exact in real arithmetic; in
floating point a difference of one ulp could move a rounded dollar. The definition of serving below
is a single scan, so no award depends on monotonicity to the dollar; only the grouped line uses it
(`line.spec.ts` compares the two on random inputs).

## Serving: one scan, and the grouped bisection

**The definition** (`scanLine`): the line is scanned once in key order and each application is
tested by the award rule against the money available at that moment. One that passes is awarded at
once and its asks reduce the pools before the next is tested. One that fails is skipped and stays in
line; a later, smaller application, or one whose bundle leans on other pools, may be awarded in the
same pass. This is the design's "taking each project its pools can pay". A pass ends at the end of
the line.

**The implementation** (`groupedLine`, the default; `EngineOpts.serving: 'scan'` selects the
definition in tests). Applications with the same kind, bundle and (market only) prototype share a
group. Within a group the award rule depends on an application only through its units and is
monotone in them, so "passes" is "units ≤ H", H being the group's largest passing size against the
money now, found by bisection over whole sizes (about a dozen award tests per group). Each group
keeps a segment tree of units in key order, so its first passing member is found in O(log n). A pass
repeatedly takes the earliest application among the groups' first passes, confirms it with the
award rule at its own units, awards it, and finds H again for the groups that share a capped pool
with it. A group keeps its H across passes when no money moved outside serving and it gained no
member and no size change (the `keep` argument of `Line.serve`).

**When the line is served.** On each day of the loop with an inflow, a money event, a re-pricing or
a new application, after those. A release on the day re-serves the line (ruling R-7a): money events
of the day's awards are settled after each serving pass, and the line is served again while money
returned (`released` or a loan's `repay` on a capped pool). The loop repeats until a pass awards
nothing and no money returned.

**Leaving the line**: awarded; the lot started by another route (its other kind's award, or its
ordinary start); lapsed; or the horizon.

### The known limit

An application waits for a pool that is short even when no more money is due to it. A spent pool with
no later inflow counts as short every day; if the other programmes cannot make up its share, the
application waits until the horizon, until its programme ends or its pool is switched off (a
re-pricing that empties or shrinks its bundle), or until its lot starts otherwise. The engine does
not look ahead at inflows to retire such a programme. The results show each pool's balance, and the
user ends the programme to release its applicants. A test pins this
(`engine-finance-repricing.spec.ts`, "the known limit: an application waits on a spent pool"): the
second application in line is never awarded, never lapses and stays to the horizon, and ending the
City programme later lapses it on `to + 1` and redraws it as a new spell on the federal and state
shares. A later change to this behaviour is deliberate.

### Known limit: a partly covered application keeps its month's first-day bundle (ruling R24)

The bundle of an application is the one active on the first day of its latent month. A switched-off
span, or a programme `to`, that falls later in that month does not reach the application before
the next re-pricing day, so for up to about a month a partly covered application can still draw on
a source switched off, or a programme that ended, during that month. The bound is that month.
Certain applications (fully covered) and the baseline as it stands are unaffected. The partner
accepted this as an approximation; it is not to be "fixed" without a ruling. The Funding tab states
it in its caveats (`MONTH_OFFER_CAVEAT`, `funding-copy.ts`).

## Re-pricing in place, lapse, reservations, regimes

**Re-pricing days** are the days after `asOf`, up to the horizon, in the set of every programme's
`from` and `to + 1`, every `off` entry's `from` and `to + 1`, and every regime day (market step days
are not among them: a step changes no bundle and no size). On such a day D every waiting application
is re-made under D's rules, once however many kinds of change fall on D: its view is the view in
force on D, its size is the attempt's size draw in that view, its bundle B′ the programmes of its
kind offered on D whose `minHomes` it meets. Unless it lapses it **keeps its place in line**
(`applied` and `keyDay` unchanged) and B′ becomes its bundle. Without this, a programme added from
2028 would never reach an application made on the first day; and a reset of the place would
reshuffle the queue on every programme date.

**Lapse.** An application lapses on a re-pricing day when any of these holds:

1. its re-made bundle B′ is empty;
2. its lot has no size or no hazard in the view in force;
3. `level(B′)` is below `level(B)`, B being its bundle just before D. Example: a certain application
   whose `state` pool is switched off from D goes from level 1 to about 0.863 (the federal and City
   shares, (443,108 + 300,027) ÷ 861,525) and lapses.

A level that stays within 1e-9 or rises keeps its place, even if dollars or programmes change (an
added City bond on a certain baseline lowers what every City grant pays, pro rata, but the level
stays 1). The comparison is with the bundle just before D, not the first one: an application whose
offer rose on one re-pricing day and fell back on a later one lapses on the later one.

**New spells.** A lapsed application leaves the line and that kind's latent is computed again as a
new spell from D: months start on D (`r′ = D − 1`), on the same draws `u` and `v` (so no new
purpose), with the rates from D on and a fresh `keyDay`. The result, if it applies, is a new
application with its own `applied`; a lapse on D can give one on D itself when the month starting on
D is certain, and it then joins the line behind every application with an earlier `applied`.
`respell` in `funded.ts`; `fundedRunStats().respells` counts the calls.

**Reservations** (`reservedFrom`). No application is made on or after the reservation day while it
is kept, no award happens on or after it, and on that day every waiting application of the lot lapses
for good (no new spell). An award before it voids the reservation unless the project exits before
it, as an ordinary start does.

**Regimes.** The latents use each month's view; a waiting application is re-made on each regime day;
a funded project runs on the view of its award day, which, by re-pricing, is the view its size was
drawn in.

## The pool state, availability and the events

`PoolState` (`funding.ts`), whole dollars: `received`, `committed`, `spentGrant`, `outLoan`,
`lostLoan`, `lostGuarantee`. A capped pool's availability, F9 (f) term for term:

`available = leverage × received − committed − spentGrant − outLoan − lostLoan − lostGuarantee`

`committed` includes the guarantee reserves held. An uncapped pool is never tested (`Infinity`); its
state is still kept and its events emitted. The check is one product less integer sums, so no
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

**Inflows.** Each arrival of a capped pool on a day the pool is not off emits `in` with its dollars
and `programme: null`, and adds to `received`. Zero-dollar arrivals emit nothing.

**Order within a day** (`Treasury`, `money.ts`):

1. `in` events, by pool in `finance.pools` order, then arrival order.
2. Money events of already-awarded projects dated that day, by award order and, within one project,
   `spend`, `repay`, then `loss` and a guarantee's exit `release`, then `release`, each by
   programme in `finance.programmes` order. **A guarantee's release precedes its loss** (the
   conductor's ruling, 2026-11-11): when a guarantee exits after construction began, `release H`
   is emitted before `loss X`, so the pool's availability identity (E4) holds after every event,
   including when the pool was fully held beforehand. Every other case keeps
   spend, repay, loss, release.
3. `commit` events of the day's awards, in award order, by programme in `finance.programmes` order.
4. Steps 2 and 3 repeat while the day's awards create money events on the same day (a project
   whose stages take 0 days), and a release re-serves the line (R-7a above).

With `sink.ledger` absent the engine keeps the pool state but builds no event objects, and its
decisions are identical.

### The ledger identities and `finance-score`'s numbers

For each pool, summing its events from `asOf` to any event inclusive: `C`, `R`, `Sg`, `Sl`, `P`,
`Lg`, `Ll`, `Lh` are the sums of `commit`, `release`, `spend` on grants, `spend` on loans, `repay`,
and `loss` on grants, loans and guarantees (the programme's instrument says which).

| Engine | `finance-score` | Statement                                                                                                                                                                             |
| ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1     | I1              | Every cumulative sum never decreases; `committed ≥ 0` and `outLoan ≥ 0`.                                                                                                              |
| E2     | I2              | `C = R + Sg + Sl + committed`: guarantee reserves are committed and released, never spent.                                                                                            |
| E3     | I3              | `Sl = outLoan + P + Ll`: every lent dollar is outstanding, repaid or lost.                                                                                                            |
| E4     | I4              | For a capped pool, `leverage × received − committed − Sg − outLoan − Ll − Lh ≥ 0`, equal to the engine's value after every event.                                                     |
| E5     | I5              | `Lg ≤ Sg`; and `Lh` over one project's guarantee never exceeds its reserve.                                                                                                           |
| E6     | I6              | An uncapped pool has no `in` event.                                                                                                                                                   |
| E7     | none            | Per project and programme: Σ `commit` = Σ `release` + Σ `spend` + still committed; a loan that ended has `spend` = `repay` + `loss`; a guarantee that ended has `release` = `commit`. |

`test/finance-harness.ts` (`checkLedger`, `runCollect`) asserts these after every event, with the
engine's own availability from `EngineOpts.probe`. E7 there is checked per programme, as the ledger
carries no project id.

## The funded project

On award day D the lot leaves every line and `startSimulated` builds the project. It is **certain**
when `level(S) = 1`, which the award rule allows exactly when its bundle B was certain.

- **Stream and id**: the attempt's stream, so later draws are those the attempt's ordinary start
  would have used; `projectId` is `sim:<parcel id>:<k>`.
- **Pathway**: a Local Program lot takes `streamlined`, as today. Otherwise a certain `affordable`
  project draws it from `Calibration.affordableRoutes` (`pathwayFrom`, on `P.PATHWAY`); every other
  funded project uses `pathwayForNew`.
- **First stage and size**: as an ordinary start; `revisions[0]` is the award day's size in the
  application's view.
- **Stages, partly covered**: `runStages` as today with the simulated revision rule; its
  commitments stay at the start size.
- **Stages, certain**: `Job.certain = true`, revisions off, never an exit. See `sampleAdvance`.
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
`e + floor(x × sampleAdvance(t, drawOn(s, P.STAGE_TIME, STAGE_INDEX[stage])).days)`: `t` is the
job's unscaled transition for its pathway and stage, `x` the job's timer scale for that stage
(`job.scale`, 1 for a stage it does not name). The outcome is always `advance`, and `P.STAGE`, the
kind draw, is not read. That is `scaledTransition` with the kind fixed to advance. So a certain
project spends the same days in a stage as an uncertain project with the same stream, pathway,
stage and scale that advances, and a timer scales a certain project's stages as it scales any
other's. A test holds it (`engine-finance.spec.ts`, "certain projects keep their counterpart's
stage times"). `model-golden.json` does not carry `sampleAdvance`; a test ties it to `sampleTime`.

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
sums match too. `engine-finance-stack.spec.ts` asserts the equality.

`ProjectCard.kind` and `ProjectCard.funding` (`{ programmes, certain }`) are copied from the
schedule by `projectCard` (`card.ts`) for simulated schedules only; the card does no pricing and a
hand-built schedule's `certain` is copied whatever the input holds.

## Rule (l): pipeline rows, `PIPELINE_FUNDED`, `inflowArrivals`

Pipeline rows and phases never apply and never touch a pool. The pools start at `asOf` with no
commitments, so money the City has already committed to projects in the pipeline is not taken off.
That overstates what the pools can fund in the first years, by up to the pipeline's outstanding City
commitments (inferred; no open dataset gives City funding per project). `funding.ts` exports the
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

`inflowArrivals(inflow, asOf, horizon)` in `funding.ts` is the one arrival rule, and
`finance-levers` imports it. A `once` inflow arrives on its `day`; a `yearly` one on `from` and the
same UTC month and day of each later year (29 February becomes 28 February in a common year), up to
`to` inclusive. Only arrivals with `asOf ≤ day ≤ horizon` are received, an arrival on `asOf`
included; one before `asOf` never arrives.

## `buildSimInput` and `marketLevel`

`buildSimInput` (`input.ts`) sets `market` and `finance` from the calibration:

| `calibration.market` | `calibration.baselineFunding` | `marketLevel` | `market`                          | `finance`                                                                                                                                 | Warnings (via `warn`, in order)                                                                                                                                         |
| -------------------- | ----------------------------- | ------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| present              | present                       | `'private'`   | `marketSteps(m, asOf, 'private')` | `{ pools, programmes }` of `baselineFunding` (deep-copied), `off: []`, `slope: m.slope.perCostShare`, `terms: resolveTerms(MARKET_TERMS)` | none                                                                                                                                                                    |
| present              | absent                        | `'all'`       | `marketSteps(m, asOf, 'all')`     | absent                                                                                                                                    | none                                                                                                                                                                    |
| absent               | present                       | `'all'`       | absent                            | absent                                                                                                                                    | `calibration.json: no market model; the run uses the 2007-2025 average market`, then `calibration.json: baselineFunding without a market model; the run has no funding` |
| absent               | absent                        | `'all'`       | absent                            | absent                                                                                                                                    | the no-market warning only                                                                                                                                              |

`marketLevel(calibration)` (`market.ts`) is `'private'` exactly when the calibration has both
`market` and `baselineFunding`, else `'all'`. That is exactly when `buildSimInput` sets `finance`, so
the engine and the page change level together. `buildSimInput` and the page's statement of the
market (`marketSentence`, the sources dialog's "In force" line) all call it, and nothing names a
level itself, so the page can never state a level the engine is not running. The reasons for the
table: a dataset from before Release 1 has neither field and its saved plans keep loading as they
did; without a market model there is no slope, so no programme can be priced. The mini calibration
has neither, so `goldenInput()` gets neither and `golden-seed1.json` does not change. The site's
default run, the twin, and the `/lesscars` build step ([lesscars.md](lesscars.md)) all run the
baseline funding on the private-starts level.

## Net fast path

`simulateNet` is unchanged: it calls `runEngine` with a sink that folds each schedule through
`addNet` and passes no `ledger`. The engine makes the same decisions with or without `ids` and with
or without a `ledger` sink: the line orders by parcel rank, never by `projectId`, and the pool state
is kept whether or not events are emitted. So the net series of a run with finance equal
`netOf(shownSeries(simulateDetailed(...)))` (`simulate.property.spec.ts`, with `miniFinance()` and
`benchBaseline`). The twin runs `simulateNet` on the unscaled baseline with the same seeds.

## Determinism

Every per-lot quantity is a pure function of (seed, entity, k, purpose). The eager phase treats
each lot alone. The day loop orders every choice by day, then the fixed step order, then the line
key or the parcel rank, never visit order or a row index; so permuting the rows of `parcels` (same
ids) gives the same schedules and ledger. The award rule is a function of the bundle, the size, the
prototype and the money, with no order among pools. Tests: `engine-finance.spec.ts`, "determinism
and lot order".

## Performance: the bench and its budgets (F18)

**Counts on the bench city** (`synthCity()`, `fixtures/synth-city.ts`, measured on seeds 1 to 7):
150,360 lots, 122,681 candidates; lots whose top level yields at least 10 homes 78,129, at least 25
homes 47,471, at least 50 homes 33,505, at least 100 homes 19,005. `simulateNet` with no finance
was 9.1 to 10.5 ms in the design's measurement (budget 15 ms).

**What the baseline adds** (`minHomes` 70 for every baseline programme, every affordable bundle
certain): every candidate that can reach 70 homes in some view draws its size, and those at 70 or
more apply on the first day (inferred 15,000 to 25,000 for the live baseline).

**The shortcuts** (all exact, held by tests that compare runs with them on and off,
`EngineOpts.noShortcuts`): a per-input eligible list (a lot whose largest level never meets any
`minHomes` of a kind has no latent of that kind); a per-input bound on attempt 0's INIT draw for
the market kind, and the same for the affordable draw, built as `skipAbove` from the lowest rate any
bundle can give (`Infinity` where some bundle is certain), so a lot above both is passed over on one
draw without a lot record (`fundedRunStats().passedOver`); canonical bundle arrays so the price
memo and the line find a bundle by identity; one day's new applications sorted once by a 64-bit
float composite key; the grouped line.

**Fallback 1** (design 4.17): per-input tables of the segment values per eligible lot, size level
and segment, so a run does no `exp` or `log` for them. They are `Float64Array`, not the design's
`Float32Array`, because Float32 rounds the rates and changed outputs, and exactness is mandatory.
Each entry's (bundle, level) is an index into the segment's few distinct values, a `Uint8Array`
(255 = not filled) promoted to `Uint16Array` once a segment has 255 values, and to `Uint32Array`
once it has 65,535. Memory on the bench city with the bench funding set: the tables went from
19.63 MB to 15.95 MB per input (Uint8 indexes; the Float64 values are kept). The typed lot table of
a pass (below) is pooled per input at about 18.5 MB.

**The warm** (`financeWarm(input, horizon)`, perf Task 1): one pass over the candidates fills the
skip rates of both kinds and the tables together, one `segValue` per (lot, kind, segment, level
with homes) on the canonical bundle, and then the skip bounds for the horizon. It is resumable
between candidates: `step(maxCandidates)` does the next chunk and returns true once everything is
built; the step that first builds `financePreOf` does only that. The pass is per input, so a
second horizon only adds its bounds. `marketSkip`, `affordableSkip` and the run's tables finish an
unfinished warm synchronously, so a run with no warm (pipeline, lesscars, tests) or a part-done one
gives the same output. A run still fills, lazily, an entry the warm skips (a level with 0 homes).
On the bench funding input the whole warm is about 190 ms in a bundle (250 ms under vitest), in
chunks of `WARM_CHUNK` (16,384 candidates, about 23 ms bundled); before, `marketSkip` and
`affordableSkip` alone took about 460 ms and the tables filled lazily inside runs.

**The typed walk** (perf Task 3): `fundedPass` keeps its lots as records in typed arrays indexed
by candidate (attempt, risk start, reservation day, parked flag and `gen`, the parked attempt's
stream, ordinary day and view, size per view, and per kind the application day, `keyDay`, view,
bundle and level), not objects, and its calendar entries as `c * 4 + tag` in typed arrays chained
per day. A lot's applications are found through the `App`s' `lot` row (at most one per kind). One
kernel, `kindLatentInto`, writes a kind's latent into a reusable record; `kindLatent` (the object
path: `latentsOf`, `respell`, `noShortcuts`) copies it into a `KindLatent`. With the shortcuts the
walk computes the latents in place; with `noShortcuts` it copies `latentsOf`'s objects into the
records, so the on/off tests compare the two paths. Days and `keyDay` are 64-bit floats: a lot with
a tiny hazard can have a `keyDay` far past 2^31, and the line keeps it exactly (`lineKey` caps it).
The table (about 18.5 MB on the bench city) is pooled per precompute and view count and claimed
per pass; a nested or interleaved pass gets a fresh one. Case 3 went from about 72 to 60 ms under vitest
(interleaved, ballpark load).

**The bench funding set** (`benchFunding(asOf)` in `fixtures/bench-finance.ts`; tier 4 values made up
to load the engine, not data): two pools, three programmes, one of them certain.

- pool `bench-bond`: `goBond`, one `once` inflow of 300,000,000 on `asOf + 365`, debt 6% over 20
  years, leverage 1;
- pool `bench-fund`: `generalRevenue`, yearly 50,000,000 from `asOf`, leverage 1;
- programme `bench-certain`: grant share 1, reach `market`, `minHomes` 25, on `bench-bond` (certain:
  every lot of 25 homes or more applies on the first day, the heaviest case);
- programme `bench-loan`: loan `costShare` 0.6, rate 0.04, reach `market`, `minHomes` 0, on
  `bench-fund` (partial);
- programme `bench-afford`: grant share 0.25, reach `affordable`, `minHomes` 0, on `bench-fund`.

**The bench baseline** (`benchBaseline(asOf)`): six City pools at 80.5, 48.6, 36.7, 34.8, 27.4 and
6.0 million dollars a year, a `state` pool at 150 million, an uncapped `federal` pool, one affordable
grant per pool with the Exhibit F shares (City 300,027 split by the Exhibit E amounts, state
118,390, federal 443,108, over 861,525), `minHomes` 70, bench `slope` 3.0 and bench
`affordableRoutes` 16/53, 36/53 and 1/53. The bench input has `market: []`. The slope is above the
live one (about 1.75), so the bench errs heavy. `benchBaseline` adds values beyond the design's
4.17, which a reader would otherwise not know:

- the `city-debt` pool is a `goBond` with debt at 6% over 20 years;
- the shares are rounded to 1e-6, the remainder on the largest, as the pipeline's `roundShares`
  rounds the live baseline's;
- the City pool kinds follow the `funding.json` ids (`dedicatedTax` or `generalRevenue`);
- `terms` is `resolveTerms(MARKET_TERMS)`.

**The warm task.** The host steps each input's `financeWarm` for the horizon in load-phase
macrotasks of their own, job kind `'warm'`, one chunk per task, before revision 0 on a cold input
and after each lever `current`, so the cold cost (precompute, skip rates and tables) no longer
lands in a band task. Details: [finance-levers.md](finance-levers.md), "The finance warm task".

**Budgets** (design F18, tier 4): with `finance` absent the existing budgets hold unchanged; with
the baseline alone `simulateNet` median ≤ 30 ms; with the bench funding set added ≤ 45 ms, and all
101 band pairs ≤ 9 s after revision 0; the existing longest-macrotask bound of 50 ms holds with the
bench funding set (case 5).

**Bench cases** (`scenario.bench.spec.ts`, run by `npm run test:perf`, not by signoff):

1. Every existing budget with `finance` absent.
2. `simulateNet` with the bench baseline, median ≤ 30 ms.
3. `simulateNet` with the bench baseline plus `benchFunding()`, median ≤ 45 ms.
4. The host: all 101 band pairs ≤ 9 s after revision 0.
5. The host: longest macrotask ≤ 50 ms during band and twin work.
6. A fixture check (counts, not time): seed 1 makes at least 10,000 first-day applications and at
   least 100 awards; it also checks that the shortcuts change nothing on the bench city.
7. Reported, not a budget: case 3 with an `off` entry for the bench baseline's `state` pool from
   `asOf + 1,826`.

Cases 4 and 5 run with `benchFundingLevers(asOf)` on the plan (`levers.finance`, ids prefixed
`u-`) and the unscaled bench baseline on the twin (ruling R-P3, met by `finance-levers`; see
[finance-levers.md](finance-levers.md), "The bench levers"). Case 5's window starts at the first
band task, not at the warm: the warm runs in load-phase tasks of its own beforehand.

**Measured medians after the perf round (perf Tasks 1 to 3).** BALLPARK: the machine was shared
(load 3.1 to 6.1 at the start of each run, other agents running), so rely on the ratio. Two
interleaved runs per side, base `736be467` against the branch head, same bench spec on both:

| Case                                         | Base (`736be467`)              | Head             | B/A  | Budget         | Proposal (median + 20%) |
| -------------------------------------------- | ------------------------------ | ---------------- | ---- | -------------- | ----------------------- |
| 1. Finance absent, `simulateNet`             | 10.6 to 12.3 ms                | 11.4 ms          | -    | 15 ms          | none; passes            |
| 2. Bench baseline                            | 35.4 and 34.6 ms               | 26.6 and 27.8 ms | 0.77 | 30 ms          | none; passes now        |
| 3. Plus `benchFunding()`                     | 98.4 and 99.0 ms               | 61.1 and 62.3 ms | 0.62 | 45 ms          | about 74 ms             |
| 4. Host, 101 band pairs after revision 0     | 4.04 and 4.08 s                | 2.68 and 2.75 s  | 0.66 | 9 s            | none; passes            |
| 5. Host, longest macrotask                   | 134.8 and 137.6 ms             | 80.0 and 82.1 ms | 0.60 | 50 ms          | about 98 ms             |
| 6. First-day applications, awards (seed 1)   | 61,239 and 231                 | unchanged        | -    | 10,000 and 100 | none; passes            |
| 7. Reported: `state` off from `asOf + 1,826` | 155.6 and 188.7 ms (older run) | about 100 ms     | -    | none           | about 120 ms, if wanted |

Cases 3 and 5 still miss their budgets; `npm run test:perf` fails on them until the conductor
re-sets them. This is spec fallback 2: the proposals above are the measured median plus 20%
(case 3: about 74 ms from 61.7 ms; case 5: about 98 ms from 81 ms), to be confirmed on a quiet
machine (load below 2) before they are written into `scenario.bench.spec.ts`. No budget number was
edited in the perf round. Case 5's longest task at head is the shown run's task (about 80 ms with
the bench funding), then the first band tasks (80 to 95 ms under load); a quiet-machine run may
come in lower. The one full `npm run test:perf` run at the end of the round (load 7 to 18, so
inflated) gave case 3 at 65.2 ms and case 5 at 105.0 ms.

**Time to revision 0** (`rev0:` cases, perf Task R0). Added to `scenario.bench.spec.ts`:
`rev0: unfunded`, `rev0: funded baseline` and `rev0: bench funding`. Each sends `initScenario`
with a null seed and times the host to its first revision 0, with the split load, warm, FZP band,
shown run and geometry. They report only; no budget is set. The first visible result waits on all
101 FZP band runs, because the representative seed needs all 101 finals, and the order (bands
first, then the representative seed) is fixed by `timelapse-sim-design.md:585`, so it cannot be
reordered without changing outputs. Ballpark medians, base to head: unfunded 1,685 to 1,697 ms
(unchanged: the round touches only the funded path); funded baseline 4,584 to 3,453 ms (x0.75);
bench funding 10,919 to 7,038 ms (x0.64). The FZP band phase is 69%, 81% and 87% of head's time
respectively; load is about 450 to 515 ms in all three. The final A/B pass agrees: bench funding
11.3 to 7.3 s, funded baseline 4.4 to 3.4 s, unfunded 1.7 to 1.7 s.

**Task 4 (cancelled): resumable runs.** The plan's Task 4 would turn `fundedPass`, `runEngineWith`
and `simulateNet` into generators (`fundedSteps`, `engineSteps`, `STEP_CANDIDATES`) so the host
advances a run across macrotask slices instead of running it whole. It is the known route to
case 5 at or under 50 ms (the longest task becomes one step, not one run) should the need appear.
It changes the host's job model, so the conductor ruled it out of this round (case 5 route (b)):
case 5 takes spec fallback 2 instead.

**Case 7 shows 0 respells with this fixture.** The design expected that switching `state` off
lapses the whole certain line at once. With `benchFunding()` stacked on the baseline, `bench-afford`
(a 0.25 grant, `minHomes` 0, on `bench-fund`, which is never off) stays in every affordable bundle
and keeps the bundle certain when `state` is off, so `remake` keeps every application and none
lapses. Case 7's median (155.6 and 188.7 ms) therefore measures an off day that re-makes about
60,000 applications, not the lapse path. The lapse path is covered by
`engine-finance-repricing.spec.ts` and by the cases of `funded.spec.ts` that run the bench baseline
with `state` off.

**Cost of the award rule and of off days** (the design's estimates, inferred from operation counts,
not measured): one run of the award rule is at most 1 + (capped pools in the bundle) rounds, 8 for
the baseline, each a memoised lookup plus a pass over the set's items, under about 100 arithmetic
operations and no `exp` or `log`; per serve the cost is about 10 groups × 12 bisection steps × that
bound. An off or on day is a re-pricing day: O(line), plus one new spell (an `exp` and a `log` per
remaining segment) for each application that lapses. The worst case, a pool every waiting
application uses switched off, lapses the whole line at once, about 20,000 new spells.

## Tests and fixtures

See [testing.md](testing.md) for the commands. The spec files: `funding.spec.ts` (arrivals, the
text, validation, levels, `isOff`, `available`, the award rule and its monotonicity),
`money.spec.ts` (the event table, the within-day order, the guarantee on a fully held pool),
`funded.spec.ts` (the latents, `respell`, `lineKey`, the shortcuts' exactness), `line.spec.ts`
(scan against grouped on random inputs), `engine-finance.spec.ts` (no public money, conservation,
determinism, the queue, certain projects, grouped serving), `engine-finance-stack.spec.ts` (a bond
on the baseline, a short pool, `funding.programmes`), `engine-finance-repricing.spec.ts` (a
programme opening or ending, a pool off, the known limit, regimes), plus `card.spec.ts`,
`input.spec.ts` and `simulate.property.spec.ts`.

The finance golden holds seeds 1 and 4 (ruling R-11a): seed 1 is the design's case (certain affordable
funded starts; `in`, `commit` and `spend` events); seed 4 is added and gives market-funded starts
and releases, so browser and Node parity covers those paths. The `m-bank` off span of `miniFinance()`
changes no bundle in the mini city, so the golden has 0 respells on seeds 1 to 6; the lapse path
is covered by `engine-finance-repricing.spec.ts` (Node only).

## Builder's calls and rulings a reader will hit

- **`Precompute.logit` is unshifted (R-P1).** It stores `z`, the linear predictor with no market
  step, because the latents add the step `m` themselves. A `logit` taken from the asOf-shifted
  hazard would count the step twice.
- **The ordinary start stays on today's path, and the market funded rate is the minimum (R-P6).**
  The ordinary start is computed on `Precompute.segments` exactly as `simulatedPass` does, not on
  the finer finance segments, so an eager attempt gives today's schedule bit for bit. The market
  funded start's per-segment rate is `min(ordinary rate, shifted rate)`; mathematically the same as
  the design, because the shift is never negative, and exactly the ordinary rate where the bundle
  is empty.
- **The market latent month is clamped to the ordinary month (R-5a).** When the market latent comes
  out later than `T_O`, it is `T_O`; when it is earlier but no segment up to it has a rate below the
  ordinary one, it is `T_O` (finer segments can move the sum by an ulp). This enforces "never
  later, and exactly today's where no money shifts it" against floating-point drift.
- **A hazard of exactly 0 and "no hazard" are the same (R-5b).** `logit` is `−Infinity` wherever no
  hazard is computed.
- **Same-day release re-serving (R-7a).** Money events of the day's awards are settled after each
  serving pass, and the line is served again while money returned, not mid-scan: this matches the
  within-day order and keeps key-order fairness.
- **The next attempt is computed at the project's start (R-7b)**, from the lot's state and
  r = exit day; its output is the same as computing it on the exit day.
- **A guarantee's release precedes its loss** (the conductor's ruling, 2026-11-11), above.
- **The finance golden carries seed 4 as well as seed 1 (R-11a)**, above.
- **`affordableSkip` is an addition** to the design's per-input bound, exact on the same argument;
  without it `bench-afford` (`minHomes` 0) would compute an affordable latent for every candidate on
  every run.
- **Ruling R-P3.** The host bench cases 4 and 5 ran with the bench baseline on plan and twin until
  `finance-levers` landed; they now run the bench funding on the plan as `levers.finance`
  (`benchFundingLevers`), with the twin on the unscaled baseline.
- **Perf round, Task 1: one warm pass, in chunks.** The skip rates and tables are filled in one pass
  per input (`financeWarm`, `WARM_CHUNK` 16,384 candidates), because `skipRatesOf` had defeated the
  price memo (about 440 ms cold before). Table indexes are `Uint8Array`, promoted to `Uint16Array`
  and then `Uint32Array`; values stay `Float64Array` (Float32 changes outputs).
- **Perf round, Task 2: line places on the application, and a non-allocating award probe.** `App`
  carries its place in the line, and `awardPasses` answers `awardSet(...) !== null` without
  allocating.
- **Perf round, Task 3: the typed walk.** Lots are typed records, calendar entries are packed
  integers, and `keyDay` stays a 64-bit float (an Int32 `keyDay` wrapped past 2^31 under tiny
  hazards and changed outputs; found in review). The lot table is pooled per precompute and view
  count. `claimLots` resets only what a pass reads before it writes; a stale `lparked` can be read
  but is harmless, because every read is paired with the `lgen === cal.gen` check.
- **Perf round, Task 4: cancelled.** Resumable runs are recorded above as the known route to
  case 5; case 3 and case 5 take fallback 2 (conductor ruling).
- **Perf round, Task R0: time to revision 0.** Measured, not changed: the order is fixed by
  `timelapse-sim-design.md:585`, and no budget is set.
