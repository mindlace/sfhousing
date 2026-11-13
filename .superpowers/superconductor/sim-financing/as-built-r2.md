# sim-financing as built, after Release 2

Read-only comprehension check at `fe35208e` ("test(e2e): sources parameter list includes the market
slope, not public money entries"). Part 1 was written from the code alone, before the design, the
specs or `as-built-r1.md` were opened. Part 2 diffs it against the design's "The model" sections
1–6, the Partner rulings, rows F2–F17, and `as-built-r1.md`.

Paths are relative to the repository root. `scenario/` means `src/lib/sim/scenario/`, `finance/`
means `src/lib/sim/finance/`, `levers/` means `src/lib/sim/levers/`, `sim-page/` means
`src/lib/sim-page/`.

---

## Part 1: how public money works in the simulation, as the code has it

### 1.0 Where the money comes from (the data and the input)

**Baseline funding** is built by the pipeline (`pipeline/lib/fzp-cal/funding.ts:186-443`) from
the hand-transcribed `funding.json` and the MOHCD affordable pipeline:

- One **pool** per City source in `funding.json` (`city.sources`), each with a yearly inflow of its
  fiscal-year dollars from `asOf`, open-ended, leverage 1, and debt terms only for bond kinds
  (`:213-226`). One **state** pool, yearly, capped (`:227-239`). One **federal** pool, uncapped and
  with no inflows: the tax-credit pool (`:240-252`).
- One **grant programme per pool** (`baseline-<pool id>`), reach `affordable`, `from: asOf`,
  `to: null` (`:258-268`). Its `share` is that source's dollars per home over the affordable
  uncovered cost; the City's per-home part is split across City sources in proportion to their
  yearly dollars (`:224`), and the shares are rounded to sum to exactly 1 (`roundShares`, `:254`).
  The pipeline refuses data whose city + state + federal per-home dollars do not equal the
  uncovered cost (`:203-208`). So **today's bundle covers exactly 100%: every affordable project
  it reaches is fully funded** while all its pools can pay.
- Every baseline programme has the same `minHomes` (the 10th-percentile size of MOHCD 100%
  affordable new construction, nearest rank, `:97-104`, `:134`) and the same income `tiers` (the
  MOHCD AMI-band homes mapped to state income categories by each band's upper bound, `:44-59`,
  `:120-140`).
- A **check** compares the homes a year the capped pools could fully fund (the least of
  `dollarsPerYear / (share × uncovered)` over capped pools) with the homes a year of recent
  new-construction bond and tax-credit awards; it warns if they differ by more than half
  (`:142-154`, `:270-279`). It changes nothing.

**`SimInput.finance`** (`scenario/types.ts:126-132`) is `{ pools, programmes, off, slope, terms }`.
`buildSimInput` (`scenario/input.ts:72-95`) sets it only when the calibration has **both** a market
model and `baselineFunding`: pools and programmes are cloned from the baseline, `off` is empty,
`slope` is `market.slope.perCostShare`, and `terms` are the sourced market terms. Baseline funding
without a market model warns and the run has no money (`scenario/market.ts:28-29`).

**The market step.** `marketLevel` (`scenario/market.ts:19-23`) is `'private'` exactly when both
the market model and the baseline funding are present, else `'all'`. The run gets one market step
at `asOf` whose log-odds is `market.today[level]` (`marketSteps`, `:7-13`). The point: when the
baseline funding is modelled, the initiation hazard is shifted to the level of *private* starts
only, since 100% affordable starts are now produced by the funding mechanism; otherwise they would
be counted twice.

The engine runs the funded pass whenever `input.finance` is present (`scenario/engine.ts:1206`);
without it, today's simulated pass is unchanged.

### 1.1 How a project is funded

#### Two kinds of project per lot

Every lot that can host new building has, per attempt, its **ordinary start** (today's hazard
arithmetic on draws `uO`, `vO`) and up to two **funded latent starts**, one per *kind* some
programme reaches: `market` (draws `uO`, `vO`, shared with the ordinary start) and `affordable`
(separate draws `uA`, `vA`) (`scenario/funded.ts:350-372`, `:824-833`). The size draw `uS` is
shared, so all three see the same building size in a given view.

A kind is only computed for a lot whose largest size level, in some view where it has a hazard,
reaches the least `minHomes` of that kind's programmes (`eligibleOf`, `:231-255`). A lot never
eligible never applies for that kind.

#### Finance segments, the bundle and its level

Time after `asOf` is cut into **finance segments** at every regime day, later market-step day,
programme `from` / `to + 1` and `off` span `from` / `to + 1` (`financePreOf`, `:129-216`). In a
segment the view, market step and **offered programmes** are constant. A programme is *offered* on
a day when it is active (`from ≤ d ≤ to`) and its pool is not switched off
(`isOffered`, `scenario/funding.ts:331-335`).

A lot's **bundle** for a kind in a segment is the offered programmes of that kind whose `minHomes`
the lot's size meets (`bundleOf`, `funded.ts:446-472`). The bundle is priced per home by
`fundBundle` (`finance/instruments.ts:236-302`):

- Programmes are taken in three **tiers**: federal, then state, then the City (all City kinds:
  `bank`, `dedicatedTax`, `generalRevenue`, `goBond`, `cop`) (`tierOf`, `:214-229`).
- Within a tier, loans and guarantees count first, at their full grant-equivalent; the tier's
  grants then fit into what remains of the uncovered cost, or are all scaled by one factor to fill
  it exactly (`:278-298`). Loans and guarantees can push the total above the uncovered cost; grants
  never do.
- The bundle's **grant-equivalent** `G` is the total; **coverage** is `G / U`, with `U` the
  uncovered cost per home; it is **certain** when coverage ≥ 1 − 1e-9 (`:13-18`, `:300-301`). The
  **level** used in comparisons is coverage capped at 1 (`coverageLevel`, `funding.ts:197-199`).

Uncovered and total cost per home (`finance/prototypes.ts:140-151`): for `market`, `U` is the
prototype's shortfall plus land ($65,000) and `C` the prototype's cost excluding land; for
`affordable`, `C` is the 2024 tax-credit average ($954,127) and `U` is `C` less the permanent
loans and other own money ($92,602). The prototype comes from stories and homes (`prototypeFor`,
`:95-104`); it matters for `market` only.

Grant-equivalents (`exactGrantEquivalent`, `instruments.ts:125-161`): a grant is `share × U`; a
loan is the interest saving `costShare × C × max(0, marketRate − rate) × years × averageDrawn`,
plus, when it sets a `requiredReturn` below the market's, an equity-return term, capped at the
principal; a guarantee is `costShare × C × guaranteeRateCut × years × averageDrawn`. A guarantee
needs `guaranteeRateCut`, which is unsourced, so a guarantee cannot run unless the user types that
term.

#### The odds shift

A bundle shifts the kind's monthly log-odds by `slope × G / C` (`oddsShift`,
`instruments.ts:188-191`), with `slope` the market model's shift for money equal to 100% of cost.
Per segment (`segValue`, `funded.ts:487-513`):

- `market`: base log-odds `z + m` (the lot's linear predictor plus the market step). With an empty
  bundle the rate is the ordinary rate. With a bundle the rate is `min(ordinary, shifted)`, so the
  funded start is never later than the ordinary one (also enforced on the month,
  `kindLatent`, `:651-664`). A **certain** bundle makes the hazard 1 (rate −∞).
- `affordable`: base log-odds `z + m − slope × (U_affordable − U_market(p)) / C_affordable`: an
  affordable project of that size is less likely than a private one by the extra cost public money
  must find. A bundle adds `slope × G / C_affordable`; a certain bundle makes the hazard 1.

So under today's 100% baseline, every eligible lot (affordable size, positive hazard) has an
affordable latent start in **month 1** and applies on the **first day of the run**
(`startOf`, `funded.ts:375`, `:669-673`; `FundedRunStats.firstDayApplications`). How many actually
start is then decided by the money in the pools, through the queue.

The latent's **bundle and level** are those of the segment holding the first day of its month T
(`:665-687`); the application day within the month is drawn on `v` unless certain (first day).

#### Parking a lot

In the **eager phase** (`fundedPass`, `funded.ts:1299-1344`), each candidate's attempts are walked
as today while the ordinary start comes before every funded application; the first attempt with a
funded application on or before its ordinary start **parks** the lot: its applications (one per
kind) and its ordinary start go into a day calendar (`walk`, `:1142-1197`). Held lots start from
their hold's last exit; reserved lots cut every day at or after the reservation day. Shortcuts
(`marketSkip`, `affordableSkip`, tables) skip lots whose draws cannot produce anything by the
horizon; they are exact by construction.

#### The day loop

For each calendar day D up to the horizon (`funded.ts:1359-1427`):

1. **Inflows** arrive (`Treasury.receive`, `scenario/money.ts:82-94`).
2. **Money events** dated D of earlier awards settle (`Treasury.settle`, `money.ts:166-201`).
3. A kept **reservation**'s day: the lot's waiting applications leave the line for good.
4. On a **re-pricing day** (programme `from`/`to + 1`, `off` `from`/`to + 1`, regime day; not
   market-step days) every waiting application is re-made under the new offer: the view in force,
   the attempt's size in it, the new bundle `B′` (`remake`, `:1227-1246`). It **lapses** if the
   view gives no size or no hazard, `B′` is empty, or `B′`'s level is below the application's
   level; a lapsed application leaves the line and the kind's latent is recomputed as a new spell
   from D on the same draws (`lapse`, `respell`, `:874-892`, `:1253-1264`). A surviving one keeps
   its place in the line.
5. **New applications** dated D join the line in line-key order.
6. **Serving** (`:1408-1416`): one pass over the line in key order, awarding every application the
   award rule passes against the money now; then events dated D (from awards today) settle; if any
   capped pool got money back (a `release` or `repay`), serve again.
7. **Ordinary starts** dated D of parked lots that were not awarded: the lot leaves the line and
   its ordinary (unfunded) project starts (`:1418-1425`). A waiting application therefore loses to
   the ordinary start if no award comes first.

#### The queue

The **line** is ordered by `applied` day, then the **line key** (`lineKey`, `funded.ts:898-902`):
`keyDay` (for `market`, the first day of the ordinary month; for `affordable`, the first day of the
month the *unshifted* affordable rate would give; never → last), then parcel rank, then `market`
before `affordable`. Serving is a **scan, not a head-of-line queue**: an application that cannot be
awarded waits and the scan goes on to later ones, which may be awarded from the same pools
(`scanLine`, `scenario/line.ts:50-110`). The default serving (`groupedLine`, `:185-387`) is a
bisection over groups of applications with the same kind, bundle and prototype; it is documented
and tested as giving the same awards as the scan.

#### The award rule

`awardSet` (`scenario/funding.ts:401-415`), for a bundle at a size:

1. The **ask** of each capped pool is the sum over its programmes of whole project dollars of
   grant + loan principal + guarantee reserve (`asksOf`, `:345-365`). Uncapped pools ask nothing.
2. **Leave out** every programme of every pool whose available money is below its ask; repeat with
   the smaller set (re-priced: grants of later tiers may scale up into the gap) until no pool is
   short or the set is empty (`leaveOut`, `:372-395`). Pools are never added back.
3. **Award** iff the remaining set is not empty and its level is not below the whole bundle's
   level. Otherwise the application waits.

So a fully funded project is awarded only if it can still be fully funded from the pools that can
pay; a partly funded one only at its full partial level. On award (`take`, `funded.ts:1267-1297`)
the lot leaves the line (both kinds), and a project starts **that day**:

- **certain** (level 1): its stage steps always advance and it is never revised
  (`scenario/engine.ts:519-523`, `Job.certain`); an affordable certain project draws its pathway
  from the calibration's `affordableRoutes` (`funded.ts:1275-1277`); a Local Program lot is
  streamlined either way;
- **partly funded**: today's stage arithmetic, so it can be revised and can drop out;
- an `affordable` award marks the schedule `kind: 'affordable'`;
- `Schedule.funding` records the paying programmes (those whose item granted, lent or guaranteed
  anything), `applied`, whole-dollar granted, lent and guaranteed, `certain`, and **displaced**:
  the homes the lot's ordinary start would have built (its size in the ordinary view less existing
  homes), 0 if the ordinary start is beyond the horizon or cut by a reservation
  (`fundingOf`, `:1200-1218`).

If the funded project exits, the lot's next attempt is walked from the exit day.

### 1.2 What a pool receives and when

- A **once** inflow arrives on its day; a **yearly** one on `from` and each anniversary (29 Feb →
  28 Feb in common years) up to `to`, all within `asOf ≤ day ≤ horizon` (`inflowArrivals`,
  `funding.ts:32-48`).
- Arrivals are scheduled up front for capped pools only; **an arrival on a day the pool is off is
  dropped** (`money.ts:60-71`). Within a day, pools receive in `finance.pools` order.
- **Available** money of a capped pool is
  `leverage × received − committed − spentGrant − outLoan − lostLoan − lostGuarantee`
  (`funding.ts:228-238`); an uncapped pool always has `Infinity`. Leverage is 1 for every pool but
  a public bank's.
- Pools start with **nothing committed**: projects already in the pipeline are taken as funded
  outside the pools (`PIPELINE_FUNDED`, tier 4, `funding.ts:50-59`).

### 1.3 Loans, guarantees, losses, the ledger and its order

On award, each programme of the awarded set **commits** to its pool (`Treasury.award`,
`money.ts:97-163`): a grant its whole-project grant `G`, a loan its principal `P`, a guarantee its
reserve `H` (`reserve × guaranteed principal`). Then the project's later events are scheduled
(only on or before the horizon, never for 0 dollars), with `λ = terms.lossOnExit`:

| Instrument | Construction starts | Completes | Exits after construction began | Exits before construction |
|---|---|---|---|---|
| Grant | `spend G` (committed → spent) | — | `loss round(λG)` (ledger only; already spent) | `release G` |
| Loan | `spend P` (committed → out) | `repay P` | `repay P − L`, `loss L`, `L = round(λP)` (out → lost) | `release P` |
| Guarantee | — | `release H` | `loss min(round(λQ), H)` and `release H` | `release H` |

A project still open at the horizon schedules nothing at its end. A certain project never exits,
so its loans are always repaid and its grants never lost.

**Ledger** (`Sink.ledger`, `engine.ts:71-78`): one event per programme of a project per money
movement: `in` (programme null), `commit`, `release`, `spend`, `repay`, `loss`, in day order.
**Order within a day**: inflows; then earlier awards' events, by project in award order, then
`spend < repay < loss < release`, then programme index, then a tie-break that puts a guarantee's
release (sorted at the loss rank) ahead of its loss (`money.ts:24-30`, `:158-160`, `:170-172`);
then the day's awards' commits; then the events those awards date on the same day.

### 1.4 How tiers and the money series are scored

**Homes by income tier** (`scenario/finance-score.ts:215-274`). Each completed schedule's final
units are split:

- `affordable` kind with paying programmes: by the programmes' `tiers`, each programme weighted by
  its share of the bundle's grant-equivalent (re-priced with `fundBundle` on revision 0's size);
  equal weights if none has any value; a programme with no tiers goes to `unrecorded`; split to
  whole homes by largest remainder (`affordableShares`, `:171-209`). `affordable` with no paying
  programme: all `unrecorded`.
- Other simulated projects (funded market or unfunded): the **inclusionary** on-site requirement
  for rentals at the November 2026 rates (10–24 homes: 15% at 55% AMI; 25+: 10% at 55%, 4% at 80%,
  4% at 110%), each AMI share mapped to a tier (≤50% very low, ≤80% low, ≤120% moderate), rounded
  half up, then by largest remainder; the rest above moderate (`finance/tiers.ts:89-163`).
- Pipeline projects (and phases): the recorded affordable homes as `unrecorded`, the rest above
  moderate (`:229-230`).
- Existing homes demolished at a construction start after `asOf` come off above moderate.

The series is cumulative by month, with the same month rules as `completedNet` (it sums to it).
Results add the dataset's `rhnaCompletedNet.byTier` baseline and compare with the RHNA tier targets.

**Money series** (`poolSeries`, `:382-447`), per pool per month end: `received`; `committed`
(commits − releases − spends); `out` (loan spends − repays − loan losses); `spent` (grant spends);
`repaid`; `lost` (every loss, grant losses included); `lostCredit` (loan and guarantee losses
only). Then (`moneyOf`, `:496-536`):

- `fundedHomes`: net new homes (final − existing) of schedules with `funding` that **completed**,
  at their completion month; `displacedHomes`: their `funding.displaced`, same month.
- `publicSpent`: Σ over pools of `spent + lostCredit` (grants paid plus credit lost; a grant's loss
  is not counted again).
- `owed`: for each debt pool, principal = all it received by the horizon, repayment = level annual
  payments × term (`finance/debt.ts:27-38`), nominal; the page scales it by the month's received.
- `limits`: legal-limit statements on the **added** borrowing (`addedBorrowing`, `:468-487`):
  per `goBond`/`cop` pool, what it receives over the run less what the same pool receives in the
  baseline (twin) finance (a new pool counts whole); arrivals on its off days skipped. G.O. bonds
  get the property-tax-rate, Charter-cap and two-thirds-vote statements, COPs the debt-service cap
  statement (`finance/debt.ts:183-287`); none is enforced.
- Results helpers: per added home = `publicSpent / (fundedHomes − displacedHomes)` (City version
  over City pools only); null when that is ≤ 0 (`:560-565`).

### 1.5 What the levers and presets change

`FinanceLevers` (`levers/finance.ts`, parsed by `parseFinanceLevers`, `:240-272`) has four parts:

- `baselineScale`: per baseline pool, dated scale entries 0–10, sorted. `buildFinance`
  (`:370-412`) cuts each pool's time into runs and **rewrites its inflows** with the run's scale
  (rounded; a closed run becomes `once` inflows, the open run restarts a yearly inflow on a true
  anniversary) (`scaleInflows`, `:315-347`), and turns each stretch of scale 0 into an **off span**
  (`:350-362`). An uncapped (federal) pool's scale only switches it off; a non-zero scale changes
  nothing for it.
- `pools`: added pools (ids `u-…`, always capped, 1–12 inflows, leverage ≤ 10 for a bank).
- `programmes`: added programmes on baseline or added pools, any instrument, reach `market` or
  `affordable` (tiers required exactly for affordable).
- `terms`: typed market terms within their ranges, which replace sourced values (and supply
  unsourced ones such as `guaranteeRateCut`).

`buildFinance` returns the baseline unchanged for empty levers, appends added pools and
programmes after the baseline's, keeps the baseline `slope`, and throws a `LeverFormatError` for
a baseline id the data lacks or a programme needing an unresolved term. The plan input carries the
built finance (`levers/apply.ts:74-79`); **the twin always runs today's baseline finance** (both
the pre-FZP twin and FZP-as-written keep `base.finance`), so the comparison isolates the policy's
money.

A loaded policy is **reconciled** with the data (`sim-page/funding-reconcile.ts:33-64`): scales
and programmes on baseline pools the data lacks, and programmes needing an unsourced, untyped
term, are dropped and reported; funding on data that cannot run money is kept but flagged unused.

**Presets** (`sim-page/funding-presets.ts:106-448`), each a bundle of lever entries with sourced
constants:

| Preset | What it adds | Available |
|---|---|---|
| A housing bond | `goBond` pool, one `once` inflow of the bond principal on 1 July next year, G.O. debt terms; a City grant programme | yes (needs model + baseline affordable programme) |
| General revenue, yearly | `generalRevenue` pool, yearly from 1 July next year; a City grant | yes |
| Housing Trust Fund increase (Prop C 2026) | `generalRevenue` pool on the Prop C schedule; a City grant | no: not certified (content kept) |
| Revolving construction-loan fund | `generalRevenue` pool, $100M once; a **market** loan programme (`minHomes` 0) | yes if the loan's terms are sourced |
| Public bank, as planned | `bank` pool with five yearly `once` inflows and bank leverage; an **affordable** loan programme | yes if terms sourced |
| State bond (Prop 1 2026) | — | no |
| No state money from a date | `baselineScale` 0 on the state pool from 1 July next year | yes |
| State money doubled | `baselineScale` 2 on the state pool | yes |
| Federal support from a year | `federal` (capped) pool, yearly at today's state amount from 2028; a City-share grant | yes |
| Federal tax credits withdrawn | `baselineScale` 0 on the federal pool from 1 January next year | yes |
| A regional bond | — | no |

A **City grant** (`cityGrant`, `:69-79`) pays `CITY_PER_HOME / U_affordable` of the uncovered cost,
from the pool's first arrival, with the baseline's `minHomes` and `tiers`. Added to today's 100%
bundle, a City grant **overfills** the City tier, so all City grants (baseline and added) are scaled
down to share the City's part; the added pool thus lets more affordable projects be fully funded
while baseline City pools are short, rather than raising coverage. `addPreset` gives ids
`u-<preset>-<n>` and keeps scale entries sorted (`:463-484`).

### 1.6 What the page shows

- **The Funding tab** (`sim-page/tabs.ts:23-28`) appears only when the calibration has both the
  market model and baseline funding. It shows (`sim-page/FundingTab.svelte:445-617`): the
  **coverage line** (today's coverage of the affordable bundle, priced with `fundBundle`, ignoring
  pool balances) and "Coverage over time", one step per date the bundle's coverage or City part
  changes (`sim-page/funding-view.ts:216-247`), with sentences on the tier rule, switching off
  versus running short, smaller projects, private projects, and the month-offer caveat; **Today's
  funding** by group (City, State, Federal), each with an editor for dated changes; **Money you
  add** (added pools with their programmes, presets via "Add money", own pools); **Market terms you
  set**; and **Sources and tiers** (baseline provenance, the check line, preset provenance, custom
  values, typed terms, the coverage rule, the affordable cost, unsourced terms, the draw
  assumption, presets not offered).
- **Results, "Public money"** (`src/lib/fzp/MoneyResults.svelte`, `src/lib/fzp/money-view.ts`):
  all public money per added home and spent so far; the City's line; a by-source table (Received,
  Spent, Lent out, Repaid, Loans and guarantees lost; zero columns dropped; uncapped "no limit");
  grants lost on projects that stopped after construction (when `lossOnExit` > 0); funded homes
  finished and added homes; displaced private homes beside the published 11.5%–80% range; repayment
  owed per borrowing pool (nominal); legal-limit statements, "Over:" first. All read at the
  scrubbed month.
- **Results, "Who the homes are for"**: affordable homes so far, a tier table against the RHNA tier
  targets (baseline plus run), and two sentences on how funded and unrecorded homes are counted.
- **The market paragraph** says which market level runs and, at the private level, that today's
  funding is in every run, the comparison included, so nothing is counted twice.
- **The parcel card**: "Funded by: {who} · fully funded / partly funded", where {who} names the
  owners of the paying programmes' pools ("the City", "the state", "federal tax credits", or an
  added pool's label) (`src/lib/fzp/card.ts:350-357`, `fundingName`,
  `sim-page/funding-view.ts:1081-1101`); an affordable start adds "100% affordable homes."
  (`src/lib/fzp/ProjectCardPanel.svelte:178`).
- **The read-only summary** (`/s/<id>`) lists the policy's public money rows
  (`funding-view.ts:1024`).

---

## Part 2: Drift

Classes, as in `as-built-r1.md`:

- **model-drift**: the code contradicts a model section (1–6), a Partner ruling or an M row;
- **decomposition-drift**: the code contradicts a D row or a spec detail;
- **doc-drift**: a developer doc or page text says something the code does not do;
- **gap**: the model requires it for Release 2 and it is not there.

**V** means both sides were read; **U** means unverified.

### Known, accepted (not findings)

Each was seen in the code during this check and matches its ruling or adjudication.

- **R22.** Affordable projects below `minHomes` are never baseline-funded: every baseline programme
  carries the MOHCD 10th-percentile `minHomes` (`pipeline/lib/fzp-cal/funding.ts:266`), and a lot is
  not even eligible for the affordable kind below the least `minHomes` (`scenario/funded.ts:231-255`),
  while the private market level leaves out every ≥ 95% affordable start.
- **R24.** A partly covered application keeps its month's first-day bundle (`kindLatent` takes
  `bundles[segOf(T)]`, `funded.ts:665-687`; re-pricing only re-makes applications already in the
  line, `:1373-1377`), so it can draw for up to about a month from a pool switched off, or a
  programme ended, mid-month. Stated on the page (`MONTH_OFFER_CAVEAT`,
  `sim-page/funding-copy.ts:369-370`) and in `docs/dev/finance-engine.md:254`.
- **A guarantee's release precedes its loss within a day** (`scenario/money.ts:158-160`, sorted at
  the loss rank with a lower tie-break, `:123`, `:170-172`), against the spec's
  spend < repay < loss < release order.
- **`addedBorrowing` skips off days** (`scenario/finance-score.ts:478-481`), so `limits` agrees with
  the engine dropping off-day arrivals (`money.ts:65`).
- **Undo discards a stranded programme draft** (`sim-page/FundingTab.svelte`, commit
  `4c2e7628`).
- **The paired-draw demolition-timing exception (issue #98).** `tierSeries` takes demolished homes
  off above moderate at the construction month (`finance-score.ts:252`), exactly as `addNet` does,
  so the tier series inherit whatever #98 decides.

### Model-drift

1. **A certain affordable project on a Local Program lot takes `streamlined`, not a pathway drawn
   from `affordableRoutes`.** V. Severity: low, arguable.
   - Code: `scenario/funded.ts:1274-1277`: `if (vp.localProgram[lot.i] === 1) pathway =
     'streamlined'; else if (certain && app.kind === 'affordable') pathway = pathwayFrom(...)`.
   - Model: row F9 (j), "a certain `affordable` project's pathway is drawn from
     `Calibration.affordableRoutes` (F12); every other project's pathway is drawn as today"; ruling
     R6, "where SF's records of publicly funded housing show different stage behaviour, the
     records are followed".
   - The finance-engine spec made the carve-out ("the route is the lot's law", spec 4.9, line 317;
     its acceptance item 11), and `docs/dev/finance-engine.md:385` documents it. No ledger entry or
     ruling covers it, so the M row and the spec disagree. Effect: on Local Program lots, certain
     affordable projects are always streamlined instead of about two thirds streamlined; the
     `P.PATHWAY` draw is not read there. The spec's reading is defensible (the Local Program is
     law), but the row's text should say so, or the partner should rule.

### Decomposition-drift

None found beyond the known items above. The spec-text fixes the ledger already lists as owed to
composition (finance-engine 4.7 for the guarantee order, finance-score 4.8 for off days, funding-ui
4.6 for undo) are the accepted items.

### Doc-drift

2. **The Results sentence on funded tiers says "fully funded"; the code splits every affordable
   project with paying programmes, partly funded ones included.** V. Severity: low (page copy).
   - Code: `tiersOf` (`scenario/finance-score.ts:217-223`) splits any `kind: 'affordable'`
     schedule with non-empty `funding.programmes` by the programmes' tiers; a partly funded
     affordable start (for example with federal credits switched off) is `kind: 'affordable'`
     (`funded.ts:1291`) and has paying programmes.
   - Page: `TIERS_FUNDED_SENTENCE` (`src/lib/fzp/money-view.ts:218-219`), "A fully funded
     affordable project's homes are counted in the income levels of the programmes that pay it".
   - Model section 5 and row F13 say "a funded affordable project", which matches the code; only the
     page narrows it. `TIER_SOURCES[1]` (`finance-score.ts:316-326`) says "A funded affordable
     project's", correctly.

### Gaps

None found. Every rule of model sections 1–6 that applies to Release 2 has code behind it (see the
list below).

### Checked and found to agree (no drift)

V unless marked.

- **Section 1 / F2, F3.** `marketLevel` is `'private'` exactly when the calibration has both the
  market model and `baselineFunding` (`scenario/market.ts:19-23`), and `buildSimInput` sets
  `finance` under the same condition (`scenario/input.ts:72-95`); the page's market paragraph reads
  the same function (`src/lib/fzp/money-view.ts:234-239`). The twin keeps `market` and `finance`
  (`levers/apply.ts:55-63`).
- **Section 2 / F8, F9 (a).** Grant-equivalents, coverage, `oddsShift = slope × G / C`, certainty at
  coverage ≥ 1 − 1e-9; the market kind on the ordinary draws and never later than the ordinary
  start; the affordable kind on its own draws with the unshifted log-odds
  `z + m − slope × (U_aff − U_mkt(p)) / C_aff` (`funded.ts:487-513`). The `min(ordinary, shifted)`
  is a builder's guard: the shift is never negative.
- **Section 2 / F9 (i), (j).** Certain projects always advance on `P.STAGE_TIME` with the job's
  scale and are never revised (`engine.ts:519-523`, `funded.ts:1278-1290`); certain affordable
  projects off Local Program lots draw from `affordableRoutes`.
- **Section 3 / F9 (b).** The bundle is the offered programmes of the kind whose `minHomes` the size
  meets, in `finance.programmes` order, on the first day of the month (`funded.ts:446-472`,
  `:665-687`); an empty bundle makes no application (`:669`). Re-pricing days are programme
  `from`/`to + 1`, `off` `from`/`to + 1` and regime days (`:129-216`); a re-made application keeps
  `applied` and its key and lapses when `B′` is empty or its level falls (`:1227-1264`). The extra
  lapse when the new view gives no size or no hazard follows F9 (k).
- **Section 3 / F9 (c).** `leaveOut` and `awardSet` (`scenario/funding.ts:372-415`): short pools
  out, re-priced, repeated, award iff the level is not below the whole bundle's. Grant factors never
  exceed 1, so others make up a short pool only "as far as their shares allow".
- **Section 3 / F9 (d), (e).** Serving in order of `applied`, `keyDay`, parcel rank (the id's string
  order), then market before affordable (`funded.ts:898-902`; the kind bit is a spec detail F9 (d)
  leaves open); a scan with no head-of-line blocking (`line.ts:50-110`); served whenever a pool's
  money changes or an application is made or re-made (`funded.ts:1363-1416`); an ordinary start on
  D removes the lot from the line (`:1418-1425`).
- **Section 3 / F9 (f), (g), (h).** `available` (`funding.ts:228-238`) and the event table
  (`money.ts:97-163`). On a loan whose project exits after construction began, the code repays
  `P − L` on the exit day; F9 (h) is silent on the remainder, and repaying it is the only reading
  consistent with (f).
- **Section 3, R9 / F12.** Baseline City, state and federal grant shares sum to exactly 1
  (`pipeline/lib/fzp-cal/funding.ts:203-208`, `:254`), so today's affordable bundle is certain; City
  shares are proportional to Exhibit E spending (`:224`); the federal pool is uncapped and its
  provenance lists the 2026 allocation records and states the limit (`:348-361`,
  `pipeline/enrichment/funding.json:143-155`).
- **Section 3, "The user changes the baseline".** `baselineScale` scales arrivals from `from` and
  makes off spans from scales of 0; a non-zero scale leaves an uncapped pool unchanged
  (`levers/finance.ts:396-403`); off pools leave every bundle (`funding.ts:331-335`); off-day
  arrivals are not received (`money.ts:65`).
- **Section 3 / F9 (l).** Pipeline rows never apply; `PIPELINE_FUNDED` is tier 4 and listed first in
  the money sources (`funding.ts:50-59`, `finance-score.ts:579-580`).
- **Section 4 / F8.** Loan saving on the 55% average drawn, the required-return term, the cap at
  principal, the guarantee formula; a whole principal committed at the start (`money.ts:112`). A
  guarantee needs the unsourced `guaranteeRateCut`, so no guarantee preset is offered and a typed
  value is required (`levers/finance.ts:388-394`).
- **Section 5 / F13.** Funded affordable homes by the paying programmes' tiers weighted by
  grant-equivalent, largest remainder with ties to the earlier tier; private projects of 10 or more
  by `INCLUSIONARY` at the rental rate, the on-site assumption stated on the page (tier 2,
  `money-view.ts:222-223`, which closes the R1 observation); pipeline affordable homes as
  `unrecorded`.
- **Section 6 / F14.** The seven pool series, `publicSpent = spent + lostCredit`, `owed` from
  `debtService` (nominal, labelled), limits from the added borrowing only, `perAddedHome` derived
  and never stored, `tiers` on every run and `money` only with a pool (`scenario-host.ts:1164-1180`).
- **F7, F16, F17.** Limits 12/12/24/24, `u-` ids, `parseFinanceLevers`; presets with
  `u-<presetId>-<n>` ids, unavailable presets held back with their reason, descriptions as the
  accessible description (`sim-page/AddMoney.svelte:4-7`); `applyLevers` builds `plan.finance`
  with `buildFinance` and the twin keeps the base finance.
- **Presets against the design's list.** Housing bond, general revenue, the Prop C increase (held:
  not certified), the revolving fund (its provenance states no completed revolve,
  `sim-page/funding-sources.ts:121-135`), the public bank (`bank` leverage, loan size a guess),
  state bond (held: no SF share), state off and doubled, federal support (amount labelled custom:
  `valueSource` has no source for it), federal credits withdrawn, regional bond (held).
- **F11.** `P.INIT_AFFORDABLE` 7, `P.INIT_DAY_AFFORDABLE` 10, `P.STAGE_TIME` 12
  (`scenario/rng.ts:22-31`).
- **U.** F15 (schema 3 and the schema-2 upgrade), F18 (performance budgets) and `/lesscars` running
  with the baseline funding were not traced.

### Status of the `as-built-r1.md` findings

| R1 # | Finding | Now |
| --- | --- | --- |
| 1 | City pool provenance tier 1 | Fixed (R14): City entries are tier 2 with recorded and inferred parts separated (`pipeline/lib/fzp-cal/funding.ts:315-334`). |
| 2 | "No MOHCD rows" is a `CalibrationError` | Unchanged in code; the spec was amended (reappraisal 1, change 7). Closed. |
| 3 | `lossOnExit` nullable | Unchanged type; the engine's input check rejects a null or out-of-range value (`scenario/funding.ts:156-159`). Closed. |
| 4 | Unparseable `market.json` | Not re-checked here (Release 1 pipeline, reappraisal 1 change 5). U. |
| 5 | Release 1 docs placeholders | Not re-checked here. U. |
| 6 | Release regeneration not done | Release 2's regeneration is in release prep (`r2-golden-diff.md` exists); not checked here. U. |
| 7 | Federal "uncapped" unsourced | Fixed: three allocation records listed and the limit stated (`funding.json:143-155`). |
| Obs. | Small ≥ 95% affordable projects in neither cohort | Ruled R22 (known, accepted). |
| Obs. | On-site inclusionary assumption unstated | Stated on the page, tier 2 (`money-view.ts:222-223`). |

### Observations (not drift)

- **Opening a programme on an empty pool can hold back an application that would otherwise be
  awarded.** A re-made application takes the larger bundle and its higher level (`funded.ts:1236-1240`);
  the award then needs that level, so if the new programme's pool cannot pay yet and the others
  cannot make up its share, the application waits where it would have been awarded at its old
  level. This is the model's "a pool that is on but short keeps projects waiting" and
  `docs/dev/finance-engine.md:241-252` states the related waiting limit. The presets avoid it by
  starting each programme on its pool's first arrival (`cityGrant(firstArrival(...))`,
  `funding-presets.ts:69-79`, `:198`), and an added City grant on a certain bundle cannot cause it
  (the City factor rises to fill the gap). A user programme dated before its pool's money can.
- **`committed` is scored but not shown.** The per-pool `committed` series (F14) feeds no Results row
  or column (`money-view.ts:177-188`). Section 6 lists it among what is computed, not what is
  displayed, so this is a page choice.
- **A funded application and an ordinary start on the same day: the funded one wins** (applications
  are served before the day's ordinary starts, and a lot parks when its application day is not after
  the ordinary day, `funded.ts:1178`). F9 (e) does not rule ties.
- **Under today's baseline, every eligible lot applies on the first day** (a certain bundle gives
  hazard 1 in month 1), so the line, ordered by each lot's unshifted affordable draw, decides which
  affordable projects start, at the rate the capped pools allow. This is the intended reading of R9
  and OD-F9b, and is what makes the first-day line large
  (`docs/dev/finance-engine.md:530`).

### Counts

model-drift 1, decomposition-drift 0, doc-drift 1, gap 0. Known, accepted: 6.
