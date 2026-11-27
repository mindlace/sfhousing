# Building choice

A lot no longer has one building per height. The pipeline lists the buildings the lot could hold,
each a construction type, a form, a story count and the homes the generator masses for it, and a
developer's choice picks one at run time from those the cap allows. This page covers the option
set, the pruning the dataset bakes, the tiers of the choice's parameters and the `sfh-options/1`
codec. Design: `docs/superpowers/specs/2026-11-26-building-choice-design.html`; plan:
`docs/superpowers/plans/2026-11-26-building-choice.html`.

## The option set (`src/lib/sim/choice/options.ts`)

`candidatesOf(rec, seed)` (`seed = fnv1a32(rec.id)`) gives every option of a lot, unpruned and
uncapped: for each type, each of its forms (`TYPE_FORMS`) at each story count of the type's range
(`TYPE_STORIES`), up to the lot's physical maximum (`physicalMaxStories`; 80 for a district),
the building `generateForm` masses. A form that does not fit, gains no home, or comes back lower
than the stories asked gives no option there, so each (type, form, stories) appears once. The
list is sorted by (stories, type code, form code). It is the input to capacity and `hostable`,
which pruning never changes.

| Type | Forms                 | Stories                                  |
| ---- | --------------------- | ---------------------------------------- |
| V    | plex, walkup, podium  | 1 to 6                                   |
| III  | podium, midrise       | 4 to 8                                   |
| I    | midrise, block, tower | 1 to the physical maximum; tower from 13 |

`block` is the midrise massing at `BLOCK_COVERAGE` to any height; `tower` is a podium with
as many plates as the lot holds (`plates` counts them; 1 for a single tower). Types II and IV are
not modelled. A district masses every lot at the same type, form and stories and sums them, so a
district row has one option per (type, form, stories), not each lot's own set.

## Pruning

`pruneOptions(options)` is what the dataset bakes. It drops an option only when another option of
the same type, the same form and the same cost series has homes ≥ and stories ≤ its own; of two
equal options the lower index survives, and the order is kept. The cost series
(`costSeriesOf`) is `E` for Type V under 25 homes and the type otherwise, so the survivor is
always priced on the same dated step series as the option it drops and is allowed at every cap
that allows it: no price step can change the drop. Pruning never compares cost or value across
types or forms, and it keeps the most-homes option at every cap. It still removes the tower
cliff: a taller option of the same type and form with fewer homes always goes.

Two helpers exist for the report only and never shape a baked row:

- `eCrossings(options)`: how many more options would go if the 25-home line were ignored
  (`options.e_crossings`).
- `pruneByCost(options, prices, time, upTo)`: the cost-based pruning the spec first proposed
  (stories ≤, homes ≥, cost per home with carrying ≤, value per home ≥ and construction months ≤,
  at one price step), to report how much the rows grow without it. Quadratic in the row.

`lotConstants(options, prices, time, upTo)` gives a lot's constants at one price and
height-time step, over all its options whatever the cap: `breakEvenValue`, the least
(costPerHome + carryPerHome) ÷ valuePerHome; `meanOptionHomes`; and `meanOptionCost`, the
mean cost per home without carrying. An empty row gives `Infinity`, 0 and 0.

## The choice rule (`src/lib/sim/choice/choose.ts`)

For an option on a lot, with its homes after the unit cap (`optionHomes`, `capHomes`: clipped
to the cap, none when the cap is at or below the homes there now) and its `costPerHome`, `valuePerHome` and `carryPerHome` at the cost step:

```
residualLandValue(o, v) = homes × (v × valuePerHome − costPerHome − carryPerHome)
choiceValue(lot)        = max(locationValue, breakEvenValue)
share(o)                ∝ exp(residualLandValue(o, choiceValue) ÷ (choiceSpread × meanOptionHomes × meanOptionCost))
margin(lot)             = max over gaining options of residualLandValue(o, choiceValue) ÷ (meanOptionHomes × meanOptionCost)
```

`breakEvenValue`, `meanOptionHomes` and `meanOptionCost` are `lotConstants`, taken over all
the lot's options whatever the cap, so a higher cap never moves `choiceValue` and never changes
the odds between options already allowed. `meanOptionCost` is the mean `costPerHome` without
carrying: it only makes `choiceSpread` unitless, and the spec names it apart from
`carryPerHome`. A lot below break-even is treated as at it (a developer who starts knows
something the model does not), so there the option that pays best per dollar wins; above it the
margin times homes decides. The row maximum is subtracted before `exp`, so the row stays finite
at any `locationValue` and size, and as `choiceSpread` goes to 0 the rule becomes the argmax.

- `choiceCtxOf(t, m, ht)` is memoised per table and models. Its steps start on `from`, the
  union of the price and height-time series' `from` days; `step(i)` resolves each series at
  `from[i]` on its own through `stepAt` and holds `price` (`costPerHome`, `valuePerHome`,
  `carryPerHome` per option, 3 × total) and the three lot constants. It is built on first use.
  `choiceStepAt(ctx, day)` is the step in force on a day. With one shipped step each, there is
  one step.
- `allowedCount(t, lot, stories)`: the options a story cap allows, the row's prefix.
- `choiceRow(ctx, step, lot, n, cap, existing, rule, out)` fills `out[0..n)` with cumulative
  probabilities over the first n options. An option gaining no home over `existing` has
  probability 0; the last gaining option and every one after it are exactly 1. It returns false,
  with the row 0, when none gains. `'market'` is the share above; `'most-homes'` (rule A, the
  affordable rule when the cohort check calls for it) puts 1 on the first gaining option with the
  most homes.
- `pickOption(cum, n, u)`: the first k with `u < cum[k]`, or -1. The world draws `u` from the
  lot's size stream (`drawOn(stream, P.SIZE, 0)`).
- `expectations(ctx, step, lot, n, cap, existing)`: the expected homes after the cap and stories
  under the market row, and `margin`; all 0, with `gains: false`, when no option gains.
- `mostHomes(t, lot, n, cap, existing)`: the most-homes option's index in the row, or -1.
  Capacity is `max(0, homes − existing)` of that option.

## Parameters and their tiers

Tiers: 0 per-record, 1 official aggregate, 2 inference, 3 literature, 4 invented. Costs, values,
durations, `choiceSpread` and `locationValue` are data (`calibration.json`, `options.bin`),
not constants read at run time; the Controller's figures stay sourced in
`src/lib/sim/finance/prototypes.ts`.

| Parameter                                  | Value                                                                                                                                                                                                                         | Source                                                                                                                                                                                       | Tier                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Type V stories                             | 1 to 6                                                                                                                                                                                                                        | DBI permits of 10 or more homes issued 2005 on: Type V maximum 6, p95 5 (n = 213); IBC 2021 Table 504.4                                                                                      | 0 (limit), 3 (code)                            |
| Type III stories                           | 4 to 8                                                                                                                                                                                                                        | DBI: Type III maximum 8, p95 7 (n = 77)                                                                                                                                                      | 0                                              |
| Type I stories                             | 1 to the physical maximum                                                                                                                                                                                                     | DBI: every building of 13 stories or more is Type I (n = 105); Type I also at 5 to 12 (267 of 427)                                                                                           | 0                                              |
| Type I tower                               | 13 and above                                                                                                                                                                                                                  | as Type I                                                                                                                                                                                    | 0                                              |
| Cost per home, Type V                      | 729,700 (A, 5 stories, 45 homes); 929,700 under 25 homes (E)                                                                                                                                                                  | Controller, Triennial Review of Economic Feasibility 2026 (`PROTOTYPES`)                                                                                                                     | 1                                              |
| Cost per home, Type III                    | 736,700 (B, 8 stories)                                                                                                                                                                                                        | Controller 2026                                                                                                                                                                              | 1                                              |
| Cost per home, Type I at 13 and 24 stories | 857,700 (C), 918,700 (D)                                                                                                                                                                                                      | Controller 2026                                                                                                                                                                              | 1                                              |
| Cost per home, Type I below 13 stories     | C's value                                                                                                                                                                                                                     | same construction type as C; cross-check Terner Center, The Hard Costs of Construction (2020), Table 3                                                                                       | 2 (3 for the cross-check)                      |
| Cost per home, Type I, 13 to 24 stories    | linear from C to D                                                                                                                                                                                                            | interpolation                                                                                                                                                                                | 2                                              |
| Cost per home, Type I above 24 stories     | D × `aboveTopCostRatio`, the ratio of median permit valuation per home above 24 stories to 13 to 24, fitted in the pipeline                                                                                                   | DBI permit valuation (only the ratio is used)                                                                                                                                                | 2, weak: flagged                               |
| Value per home                             | cost − shortfall: A 552,700; B 584,700; C 651,700; D 626,700; E 576,700; interpolated by stories as cost                                                                                                                      | Controller 2026 residual land value (`shortfallPerHome`)                                                                                                                                     | 1                                              |
| `locationValue` per lot                    | the neighbourhood median of assessed value per m² of buildings of 5 or more homes completed 2015 on, each ÷ its roll year's median (3-year window under 10 buildings), shrunk to 1 by n ÷ (n + 10); 1 without a neighbourhood | Assessor roll (wv5m-vpq2), Analysis Neighborhoods (j2bu-swwd); `pipeline/lib/location-value.ts`                                                                                              | 0 data, 2 index, 4 (invented) the shrinkage 10 |
| Construction time by height band           | per stage interval, refitted; raw pull, first construction document to completion: 26.2 (≤ 4 stories), 29.3 (5 to 7), 28.6 (8 to 12), 27.4 (13 to 20), 34.7 (21+) months                                                      | DBI permits (n = 705, censored); the pipeline refits with `completed_date`                                                                                                                   | 0                                              |
| Carrying cost of time                      | `constructionRate` 0.085 on `AVERAGE_DRAWN` 0.55 of cost, for the months beyond the anchor's own band                                                                                                                         | `MARKET_TERMS` (`terms.ts`); `AVERAGE_DRAWN` is the partner's assumption R11                                                                                                                 | as sourced there (R11 is 4)                    |
| `choiceSpread`                             | fitted                                                                                                                                                                                                                        | DBI and Planning records: built stories ÷ `baseStoriesAtFiling`                                                                                                                              | 2                                              |
| Block coverage above 12 stories            | `BLOCK_COVERAGE` 0.92                                                                                                                                                                                                         | median footprint ÷ lot of the 32 lots with a 13 to 80 story building built 2005 to 2016: DataSF footprints (ynuv-fyni, 2016 LiDAR) over the roll (wv5m-vpq2), `pipeline/lib/coverage-fit.ts` | 0                                              |
| Several towers: plate size                 | `TOWERS_PLATE_MAX_M2` 12,000 gross ft² (1,114.8 m²)                                                                                                                                                                           | Planning Code Sec. 270(h)(3)(A)(i)                                                                                                                                                           | 1                                              |
| Several towers: spacing                    | `TOWERS_SEPARATION_M` 115 ft (35.05 m)                                                                                                                                                                                        | Planning Code Sec. 132.4(d)(3)(A), Central SoMa (Ord. 296-18); Rincon Hill Area Plan Policy 3.4                                                                                              | 1                                              |
| Single tower plate and spacing             | `TOWER_PLATE_MAX_M2` 900, `TOWER_SEPARATION_M` 6                                                                                                                                                                              | existing generator constants                                                                                                                                                                 | 4: invented                                    |

The spec's table gave 0.75 (tier 4) for block coverage and the single-tower constants for several
towers; Task 2 fitted the coverage and sourced the several-tower constants, as the spec asked.

## Fits from the permit records

Both permit sources select DBI `proposed_construction_type`; the parse reads the codes `1` to `5`
(and the numerals) as I to V (`constructionTypeOf`), and `permits.parquet` carries
`proposed_stories`, `valuation` (Rulings E2, PV1) and `construction_type` per permit.

**Stage time by height band** (`fitHeightTime`, `pipeline/lib/fzp-cal/height-time.ts`, tier 0).
Bands of proposed stories ≤ 4, 7, 12, 20 and 999 (`HEIGHT_BANDS`, the raw pull's bands). The
multipliers scale the model's own permit-side stages (ruling F8): `permitIssued`, issued to first
construction document, and `construction`, first construction document to completion. For each
stage a band's multiplier is the median of its completed spells over the pooled median of that
stage; `constructionMonths` is the band's construction median in months (`carryPerHome` reads
it). Spells are the calibration's (`buildSpells`), entered in the fit window, joined to their
history's `storiesProposed`; censored spells, exits, histories without stories and spells whose
start or end the records do not hold (a gap the normalisation imputed) are left out, and a no-FCD
completion has no spell. A pooled median of 0 days gives multiplier 1. A band with fewer than `sizeMinN` completed spells in
either stage merges into the band below (the first into the one above), the rule the retired
fill-level size model used.
The model has one step, from `asOf`. `filedToIssued` reports the filing-to-issue medians on the
same bands; no multiplier is fitted for it. With no completed spell at all: one band, multiplier
1, 0 months, tier 4.

**Cost above 24 stories** (`aboveTopCostRatio`, `pipeline/lib/building-records.ts`, tier 2, weak).
The median valuation per home of permits for 10 or more homes issued 2015 on above 24 stories,
over that at 13 to 24; each permit counts once (its first row) and superseded permits are left
out. Fewer than 10 permits on either side gives 1 (tier 4). On the raw pull, one row per permit,
this is about 1.21 (n = 10 and 30). The raw pull repeats a permit once per address: counted per
row it gives 1.99, and the spec's 1.39 (21+ against 13 to 20 stories) is also a per-row figure
(1.21 per permit). The build fits it on `permits.parquet` (linked permits, one row each,
superseded ones out).

**Record targets** (`recordTargets`, `pipeline/lib/building-records.ts`). The calibration step
writes `pipeline/.cache/derived/<v>/record-targets.json` (never uploaded) for the record check.
Its window is the latest ten record years to `asOf`, not before 2015. Each target holds
`stat`, `n`, `se` and `tol`, and `checked` is false (report only) below n = 30:

| Target                                           | Records                                                                                                                                     | SE and tolerance                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `heightRatio` by limit bucket ≤ 4, 6, 8, 12, 999 | histories first recorded in the window: `storiesProposed ÷ baseStoriesAtFiling` (uncapped; `overLimit` counts r > 1)                        | mean: SD ÷ √n, tolerance 0.10; share ≥ 0.9: binomial, 2 SE |
| `constructionType`                               | issued permits by height band and type; `recordsOver` counts V above 6 and III above 8; `typeIShare8to12`                                   | binomial √(p(1−p)/n), 2 SE                                 |
| `stageMonths`                                    | completed `permitIssued` and `construction` spells by height band, in months                                                                | 1.25 × IQR ÷ (1.35 √n), 2 SE                               |
| `homesPerProject`                                | issued permits for 10 or more homes, median homes by height band                                                                            | as above                                                   |
| `largeLotTypeI`                                  | issued permits on lots of 1,500 m² or more (summed over the permit's parcels) with a base limit of 13 or more: Type I at 13 or more stories | binomial, 2 SE                                             |
| `cohort`                                         | `heightRatio` records split by `startCohort`: affordable and private means, `diff` = affordable − private, `se` = √(SEₐ² + SEₚ²)            | report only; Task 8's affordable rule reads it             |

Permit targets read permits issued in the window, not superseded, with stories of at least 1.

## Calibration: the spread, the affordable rule and the start features

The calibration step (`pipeline/lib/fzp-cal/calibrate.ts`) writes `calibration.choice` and
`calibration.heightTime`, one step each from `calibration.asOf` (the shipped step,
`shipped-step.ts`, the same one the options step's cost-pruned report prices on). It reads
`scenarios/fzp/options.bin`, `<derivedDir>/panel-options.bin` and the location value's
provenance; `scenario_panel.option_row` points each panel parcel-year into panel-options.bin.
The fill-level size model (`calibration.size`, `size.ts`) is retired (Task 9b): the calibration
no longer writes it and `parseCalibration` ignores a `size` key an older file carries.
`calibration.method.sizeOverEnvelope` counts the choice records over their limit.

**Choice spread** (`fitChoiceSpread`, `pipeline/lib/fzp-cal/choice-fit.ts`, tier 2). Maximum
likelihood of each record's built stories under the market choice among its lot's options
allowed at its base stories at filing, scored through `choiceRow` itself (preflight F13), on the
shipped step; golden-section search on ln choiceSpread in [0.001, 100]. Records
(`choiceRecords`): histories first recorded from 2015-01-01 to `asOf` with proposed and base
stories at filing of at least 1, on their largest parcel's panel row of the first record's roll
year, with that year's existing homes and base cap. A record over its limit is left out and
counted (`excludedOver`, the same histories `sizeOverEnvelope` counts); under the affordable
rule 'most-homes', records whose project is in the affordable cohort are left out and counted
(`marketRecords`), since they choose by rule A; a record whose stories
no gaining option has takes the options at the nearest stories. The panel options carry today's
locationValue, not the roll year's: the index is against each roll year's median, so the fit
assumes neighbourhoods kept their rank. Under `sizeMinN` records the spread is 1, tier 4
(invented). The report prints the log-likelihood at 0.01, 0.1, 1, 10 and 100: where most lots sit
at break-even (choiceValue = breakEvenValue), options differ little in residual and the
likelihood is flat above a few tenths, so the records fix only a lower bound. A fit at the upper
bound says so in its provenance.

**The affordable rule** (`affordableRule`). 'most-homes' (rule A) exactly when the affordable
cohort's mean built height ÷ limit exceeds the private mean by more than 2 SE of the difference
(`record-targets.json` `cohort`), else 'market'. Without a measurable difference (no cohort
records) it is 'market' at tier 4.

**Start features** (`choiceFeatures` in `choose.ts`, one function for the panel, the fits and the
run time): `potentialRatio` = expected homes ÷ max(existing, 1), `storiesGap` =
expected stories − existing stories, and the new `choiceMargin` = the best allowed option's
residual land value at choiceValue ÷ (meanOptionHomes × meanOptionCost). The panel takes them at
each row's base stories and base cap (`withChoiceFeatures`, `panel.ts`); the FZP application at
the envelope, with no cap on Local Program parcels and the base cap elsewhere. With no gaining
option all three come from empty expectations: ratio 0, gap −existing stories, margin 0.
`choiceMargin` bins start `[-100, 0, 0.001, 0.02, 0.05, 0.1, 0.2, 0.5]` (tier 4): a lot at
break-even whose best-per-dollar option is allowed has margin exactly 0.

## The run time

The world engine reads `options.bin` (`SimInput.options`, loaded and checked against parcels.bin
by `loadSimInput`) and `calibration.choice` and `heightTime` (`buildSimInput` refuses a
calibration without them). A view's cap per lot is `ScenarioParcels.fzpCap` (`NULL_CAP` none), the
parcels.bin column (`sfh-scenario/2`); `baseZoning` sets it to `baseCap`, a lever view to its
table's cap.

- **Precompute** (`precomputeOf`, `world/input/build.ts`). The choice context is
  `choiceCtxOf(options, choice, heightTime)`; its steps are the union of the price and
  height-time `from` days. Per step (`byStep`, the memo keyed by (lot, step)), every hosting lot
  keeps `expectations` at its envelope and cap against its existing homes (`expHomes`,
  `expStories`, `margin`, `gains`, `best`) and its initiation logit on `featuresOf` those
  expectations. A lot no allowed option gains on has no logit. `logit` is the step in force at
  the dataset date; later cost-step days join `segments.days`, each segment reading its own
  step's rates (`stepRates`). Frames carry `choiceStep` (the compiler's step on the month's first
  day), and start odds read that step's logits (`rates.ts` `logitsAt`); a change of step replans
  every free lot, as a market change does.
- **A start** (`world.ts`) builds the market choice row for the cost step of the frame of its
  lot-month's first day (`choiceStep`, the step the funded clocks and the shadows read) against
  the homes there now (0 once demolished), draws `u = drawOn(stream, P.SIZE, 0)` and starts
  `pickOption`'s option: units its clipped homes, stories and type its own. The row keeps the
  option index (`level`, Uint16), `btype` and `optCap`; `top` is the most homes an allowed
  option holds. No gaining option makes the lot `LOT_DONE`.
- **Revisions** (`stage.ts`) keep the ratio draw: units = clamp(round(ratio × units), existing +
  1, most homes of the row's type among the allowed options); the row moves to the same-type
  option with the fewest homes that holds them.
- **Durations** (`heightMultiplier`): the band multiplier of the row's latest stories, on the
  `heightTime` step in force on the stage entry, scales the time still to run of `permitIssued`
  and `construction` (rows with unknown stories: 1).
- **Capacity** is rule A (`lotCapacity`, `netCapacity`, `capacityOf` in
  `levers/resolve.ts`): the most homes an allowed option holds after the cap less the homes there
  now. The room box, `leverCapacity` and the runner's `capacity()` all count it. A lever view
  hosts a lot only where an allowed option gains a home after the cap (`parcelsView`).
- **Levers** need no recompute: the gross table, the chunk recompute (`levers/recompute.ts`) and
  the compiler's `YieldSource` are gone; a lever envelope reads the same option rows.
- **Funded sizes, prices and parking**: a funded market latent's size is the market choice row's
  pick at the frame's step (`funding/clocks.ts` `sizeIn`); an affordable one's follows
  `affordableRule` ('most-homes': `mostHomes`). The largest a funded lot can take is `topHomes`
  (`funding/apply.ts`). A line row is priced by its option on the price step of the cost step
  its size was drawn at (`funding/line-price.ts`, [world-funding.md](world-funding.md)), and
  parking reads the priced prototype of the lot's most likely option (`byStep[choiceStep].best`,
  [cars.md](cars.md)). Only recorded projects with no type keep `prototypeFor`'s binning; the
  build counts them as `projects.no_type`.

**The formats** (Task 9b). parcels.bin (`sfh-scenario/2`) carries `fzpCap` and no fill-level
yields, `potentialRatio` or `storiesGap`; policy.bin (`sfh-policy/2`) no yields and no FZP cap;
gross.bin is gone. Each decoder refuses the major before. The pipeline's hostable flags, the
panel's `base_yield` and `hostable_base`, the SB 79 and current-law layers and V17, V32 and V33
read the option rows (`envelope-row.ts` `topHomesAt` and `envelopeRow`). The hostable flags stay
cap-free (partner ruling, option c): a lot hosts where an option at or below its envelope has
more homes than now; the run time's view applies the cap (rule A).

**The drawn building** (Task 11). Each simulated revision carries its option (`Schedule.revisions[k].option`, from the revision table's `revLevel`), and `massingFor` masses it with
`generateForm` at the option's form and stories, so the map and the card draw exactly the
option's homes, stories and plates (`massing.footprint.spec.ts` checks every option of the mini
city). The memo key is `simKey(parcelId, form, stories, plates)`. A unit cap or a revision's
ratio draw can leave a project fewer homes than its option holds; the building drawn is still
the option's. Recorded projects keep `generateForUnits` at their stories. The paint preview draws
each lot's `mostHomes` option at the painted stories.

**The margin and the market slope.** Both read cost against value, so they can count one change
twice once costs move over time (spec, Non-goals). The report (section 16) gives the Pearson
correlation, over the at-risk panel parcel-years, of `choiceMargin` with the slope's cost share
of the row's best option (`uncoveredPerHome ÷ costPerHome` of the prototype it prices as, the
per-project share behind `typicalUncoveredShare`). `calibration.market` is recomputed from the
refitted model by the unchanged `market.ts`.

**Live figures** (build `2026-11-27-6264ccf1`, uncommitted tree, not uploaded):

- choiceSpread 99.99, at the search's upper bound, from 562 records (817 measured, 2 without a
  panel row, 49 affordable-cohort records left out under 'most-homes', 144 over their limit, 60
  with no gaining option). Log-likelihood -1853.9 at 0.01, -813.1 at 0.1, -792.5 at 1, -789.2 at
  10, -788.9 at 100: the records rule out a sharp choice but do not identify the spread above
  about 1. A fit at either bound ships as tier 4, "invented (fit at search bound)", and the build
  warns. On the first build's 581 records the mean built stories ÷ limit is 0.81; a uniform draw
  over the allowed gaining options gives 0.68; the tallest allowed option matches 43% of records
  and the most-homes option 24%.
- Affordable rule 'most-homes': affordable mean 1.228 (n = 38), private 1.014 (n = 481),
  difference 0.214 against 2 SE = 0.1995.
- `choiceMargin` bins merge to `[-100, 0, 0.001, 0.02]`, coefficients 0.720, -1.833, 0.827,
  0.287: a lot exactly at break-even starts least often. Its correlation with the slope's cost
  share is r = -0.0046.
- Height bands merge to ≤ 4, 5 to 7 and 8+; construction months 23.6, 25.8, 23.6.
- `today.all` -0.545606, `today.private` -0.619108 (docs/dev/market.md).

**V25** (`choiceOutcomes`, `invariants.ts`) checks both keys: one step each from `asOf`, a
spread above 0, a known affordable rule, positive anchors and cost ratio, carrying in [0, 1],
band edges ascending to 999 with one positive multiplier and non-negative months per band, and
every provenance at tier 0 to 4 with tier 4 labelled invented.

## The record check and the cap report (`scripts/record-check.ts`, `scripts/cap-measure.ts`)

`record-check` is the spec's acceptance test. It loads a dataset directory with the timeline host's
loader (`loadDataset`), compiles the empty document as the host does (brush lots resolved by
`resolveBrushRows`, as the host's brush service resolves them), and steps one world with the
dataset's core (funding and cars) on the host's seed through model month 120. Every simulated row
(`ORIGIN_SIM`) becomes a `SimProject`: its first stage's day, stories and homes now, the envelope
stories its start was allowed (`env`), its type (`btype`), its lot's area, its cohort (`kind`) and
the days it entered `permitIssued`, `construction` and `complete`. `simStats` then computes each
statistic over the window of those 120 months as `recordTargets` computes it over the records:

| Check                    | Simulated population                                                                                                                                       | Status                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Height ÷ limit by bucket | starts in the window: stories ÷ `env` (uncapped, as Task 5's records), by `LIMIT_BUCKETS`; mean (± 0.10) and share ≥ 0.9 (2 SE)                            | checked where the records' n ≥ 30        |
| Code limits              | starts in the window: Type V above 6, Type III above 8                                                                                                     | exact: any one misses                    |
| Type I at 8 to 12        | permits issued in the window (entered `permitIssued`) at 8 to 12 stories                                                                                   | checked (2 SE)                           |
| Type shares by band      | the same permits by `HEIGHT_BANDS` and type                                                                                                                | report                                   |
| Stage medians by band    | `permitIssued` (issued to construction) and `construction` (construction to completion): spells entered in the window and completed by its end (ruling F8) | checked (2 SE)                           |
| Issued to completion     | the two stages summed per project, beside the raw pull's 28.4, 36.8, 36.5, 33.7 and 40.1 months                                                            | report                                   |
| Homes per project        | permits issued in the window for 10 or more homes, median by band                                                                                          | checked (2 SE)                           |
| Large lots               | permits issued on lots of 1,500 m² or more with `env` ≥ 13: Type I at 13 or more stories                                                                   | checked (2 SE) where n ≥ 30; report here |
| Cohorts                  | height ÷ limit, affordable (`kind` 1) and private, and their difference                                                                                    | report                                   |

A checked target that the simulation has no project for misses. `checkLines(targets, sim)` and
`recordExit(lines)` are the pure parts its spec tests.

`cap-measure` runs the same runner over the whole window (480 months) with the score series fed
as the ensemble's plain loop feeds it, so `rows[i].completedNet` is the view's row for row (its spec
checks this against `openEngine` on fixture-0; on `2026-11-27-3abc9cb0` the 480 current-law rows
agree exactly). The transit rule is `GAME_TRANSIT_ID` with all four stop types at 805 m; the full
tree is `fullTree(cal)` with every band of its transit rule set to the cap. The old figures
(`OLD_FIGURES`) are the taller-caps report's engine runs on `2026-11-25-76c90397`.

**Live figures** (build `2026-11-27-3abc9cb0`, uncommitted tree, not uploaded; records 2016-11-27
to 2026-11-27). Record check: 9 pass, 11 miss, 32 report, exit 1. Height ÷ limit misses in every
checked bucket: sim mean 0.759, 0.709, 0.631 and 0.459 against records 1.027, 1.296, 1.145 and 0.904
(≤ 4, ≤ 6, ≤ 8, above 12), share ≥ 0.9 0.436, 0.221, 0.114 and 0.071 against 0.760, 0.713, 0.568 and
0.421, the near-uniform choice the spread at its search bound gives (see "Calibration" above). 116
of the 433 starts face an envelope above their base stories; divided by base stories instead, the
≤ 4 mean is 0.824, still a miss. The code limits pass (no V above 6, no III above 8 among 433
starts). Type I at 8 to 12: 0.909 (n 11) against 0.984 ± 0.032, a miss. Permit-issued medians pass
at ≤ 4, ≤ 7 and ≤ 12; construction ≤ 4 misses (23.7 against 26.2 ± 1.3 months), ≤ 7 and ≤ 12 pass.
Homes per project pass at ≤ 4 and ≤ 12 and miss at ≤ 7 (33 against 57 ± 16.9). Large lots are
report only (records n 28).

Cap report (`completedNet` 2040 / 2066, old figures in brackets; share of starts V / III / I):

| Run          | 12 stories                                    | 13                                            | 16                                            | 20                                            | 40                                             | 80                                             |
| ------------ | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Transit rule | 58,529 / 122,720 (63,092 / 138,298); 51/21/28 | 58,499 / 129,385 (60,832 / 126,709); 50/21/29 | 60,811 / 145,700 (61,648 / 135,976); 46/19/35 | 64,039 / 165,625 (63,950 / 140,339); 43/18/39 | 89,948 / 269,160 (68,106 / 156,754); 38/14/48  | 113,934 / 372,896 (73,248 / 182,282); 37/14/49 |
| Full tree    | 74,100 / 139,893 (80,685 / 165,058); 50/21/29 | 76,082 / 146,228 (75,920 / 157,445); 49/20/30 | 81,707 / 172,669 (79,489 / 167,549); 45/19/36 | 88,325 / 196,614 (83,391 / 171,072); 42/17/41 | 118,495 / 327,730 (89,249 / 197,592); 37/14/49 | 154,893 / 447,756 (97,777 / 222,488); 36/14/50 |

Current law: 47,218 / 82,765 (47,502 / 79,338); starts 77% V, 12% III, 10% I (n 1,651). Transit at
13 stories builds 30 fewer homes than at 12 by 2040 (58,499 against 58,529), within noise; every
other step up builds more.

## Location value (`pipeline/lib/location-value.ts`, `86_location_value.sql`)

`locationValueByLot(db)` runs after the scenario SQL, on `parcels` and `sc_roll_agg` (one row per
current parcel and roll year, condo units summed, `80_scenario.sql`). A building is a parcel whose
roll shows 5 or more homes (`LOCATION_VALUE.minHomes`: a multi-home developer does not sell
single-family homes) built in or after 2015 (`minYearBuilt`), read on its first roll after the
completion year: the roll of that year can assess a part-built building, and the next lien date
assesses it complete, at market value. Hotels, non-taxable parcels (status N) and parcels with no
assessed value are left out; a building with no floor area is counted
(`locationValue.no_area`) and left out.

Its value is (land + improvement) per m² of floor area (the roll's `property_area`), not per home:
unit sizes differ by neighbourhood, and an option's homes already carry its size. Its index is
that value over the reference of its roll year: the median of the buildings first assessed that
year, or, for a year with fewer than 10 (`poolMinN`), of those in the 3-year window centred on
it (at the ends of the roll, the years that exist). So prices over time drop out and the citywide
figure is 1.

Per Analysis Neighborhood the median index (`raw`, 1 with no building) is shrunk to 1:
`shrunk = (n × raw + 10) ÷ (n + 10)`. The 10 (`LOCATION_VALUE.shrink`) is tier 4, invented: it
keeps an area with a few new buildings near the citywide figure without a cliff. Every lot takes
its neighbourhood's `shrunk`; a lot with no neighbourhood takes 1. The build reports
`locationValue.buildings`, `locationValue.neighborhoods`, `locationValue.thin` (neighbourhoods
with n < 10) and `locationValue.no_area`.

The build calls it in the options step, which writes each lot's value into `options.bin`. A
district parcel is one lot id, so it takes its own value; no rule across its member lots is needed.
On `2026-11-27-b3038992` (live, unpublished): `locationValue.buildings` 114,
`locationValue.no_area` 9, `locationValue.neighborhoods` 41, `locationValue.thin` 38. Lot values
run from 0.919 to 1.378 over 155,020 lots; 25,552 lots sit at exactly 1 (no neighbourhood, or a
neighbourhood with no building).

## The codec (`src/lib/data/option-table.ts`, `sfh-options/1`)

`optionTableOf(datasetVersion, rows)` packs one row per scenario row, each `{ options,
locationValue }`, into flat columns: `offset` (count + 1), per option `type` and `form`
(codes into `BUILDING_TYPES` and `BUILDING_FORMS`), `stories`, `plates` and `homes`
(`Uint16Array`; plates too, since a district tower sums its lots' plates), and per row
`locationValue` (`Float32Array`). It throws a RangeError for a row of more than
`OPTIONS_MAX_PER_LOT` (1,023) options, homes or plates above 65,535, stories above 255, or a
row whose stories fall; the run time reads a row's allowed options as the prefix
up to the cap.

Wire format (deflate-raw): ASCII `SFHO`, u8 version (1), u8 length and the ASCII
`datasetVersion`, u32le row count, then per row u16le n, f32le `locationValue` and n options
of (u8 type, u8 form, u8 stories, LEB128 plates, LEB128 homes). `decodeOptionPayload` throws
`options: truncated …` on a short payload and rejects bad magic, versions, codes, row lengths,
story order and trailing bytes. `readOptionTable(body)` inflates and decodes;
`optionTableProblem(t, parcels)` names a table from another build (row count or
`datasetVersion`).
