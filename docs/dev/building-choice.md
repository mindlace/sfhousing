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

For an option on a lot, with its homes after the unit cap (`optionHomes`, `capScenarioYield`'s
rule) and its `costPerHome`, `valuePerHome` and `carryPerHome` at the cost step:

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

| Parameter                                  | Value                                                                                                                                                                     | Source                                                                                                                                                                                       | Tier                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Type V stories                             | 1 to 6                                                                                                                                                                    | DBI permits of 10 or more homes issued 2005 on: Type V maximum 6, p95 5 (n = 213); IBC 2021 Table 504.4                                                                                      | 0 (limit), 3 (code)                            |
| Type III stories                           | 4 to 8                                                                                                                                                                    | DBI: Type III maximum 8, p95 7 (n = 77)                                                                                                                                                      | 0                                              |
| Type I stories                             | 1 to the physical maximum                                                                                                                                                 | DBI: every building of 13 stories or more is Type I (n = 105); Type I also at 5 to 12 (267 of 427)                                                                                           | 0                                              |
| Type I tower                               | 13 and above                                                                                                                                                              | as Type I                                                                                                                                                                                    | 0                                              |
| Cost per home, Type V                      | 729,700 (A, 5 stories, 45 homes); 929,700 under 25 homes (E)                                                                                                              | Controller, Triennial Review of Economic Feasibility 2026 (`PROTOTYPES`)                                                                                                                     | 1                                              |
| Cost per home, Type III                    | 736,700 (B, 8 stories)                                                                                                                                                    | Controller 2026                                                                                                                                                                              | 1                                              |
| Cost per home, Type I at 13 and 24 stories | 857,700 (C), 918,700 (D)                                                                                                                                                  | Controller 2026                                                                                                                                                                              | 1                                              |
| Cost per home, Type I below 13 stories     | C's value                                                                                                                                                                 | same construction type as C; cross-check Terner Center, The Hard Costs of Construction (2020), Table 3                                                                                       | 2 (3 for the cross-check)                      |
| Cost per home, Type I, 13 to 24 stories    | linear from C to D                                                                                                                                                        | interpolation                                                                                                                                                                                | 2                                              |
| Cost per home, Type I above 24 stories     | D × `aboveTopCostRatio`, the ratio of median permit valuation per home above 24 stories to 13 to 24, fitted in the pipeline                                               | DBI permit valuation (only the ratio is used)                                                                                                                                                | 2, weak: flagged                               |
| Value per home                             | cost − shortfall: A 552,700; B 584,700; C 651,700; D 626,700; E 576,700; interpolated by stories as cost                                                                  | Controller 2026 residual land value (`shortfallPerHome`)                                                                                                                                     | 1                                              |
| `locationValue` per lot                    | the neighbourhood median of assessed value per home of buildings completed 2015 on, each ÷ its roll year's median, shrunk to 1 by n ÷ (n + 10); 1 without a neighbourhood | Assessor roll (wv5m-vpq2), Analysis Neighborhoods (j2bu-swwd); `pipeline/lib/location-value.ts`                                                                                              | 0 data, 2 index, 4 (invented) the shrinkage 10 |
| Construction time by height band           | per stage interval, refitted; raw pull, first construction document to completion: 26.2 (≤ 4 stories), 29.3 (5 to 7), 28.6 (8 to 12), 27.4 (13 to 20), 34.7 (21+) months  | DBI permits (n = 705, censored); the pipeline refits with `completed_date`                                                                                                                   | 0                                              |
| Carrying cost of time                      | `constructionRate` 0.085 on `AVERAGE_DRAWN` 0.55 of cost, for the months beyond the anchor's own band                                                                     | `MARKET_TERMS` (`terms.ts`); `AVERAGE_DRAWN` is the partner's assumption R11                                                                                                                 | as sourced there (R11 is 4)                    |
| `choiceSpread`                             | fitted                                                                                                                                                                    | DBI and Planning records: built stories ÷ `baseStoriesAtFiling`                                                                                                                              | 2                                              |
| Block coverage above 12 stories            | `BLOCK_COVERAGE` 0.92                                                                                                                                                     | median footprint ÷ lot of the 32 lots with a 13 to 80 story building built 2005 to 2016: DataSF footprints (ynuv-fyni, 2016 LiDAR) over the roll (wv5m-vpq2), `pipeline/lib/coverage-fit.ts` | 0                                              |
| Several towers: plate size                 | `TOWERS_PLATE_MAX_M2` 12,000 gross ft² (1,114.8 m²)                                                                                                                       | Planning Code Sec. 270(h)(3)(A)(i)                                                                                                                                                           | 1                                              |
| Several towers: spacing                    | `TOWERS_SEPARATION_M` 115 ft (35.05 m)                                                                                                                                    | Planning Code Sec. 132.4(d)(3)(A), Central SoMa (Ord. 296-18); Rincon Hill Area Plan Policy 3.4                                                                                              | 1                                              |
| Single tower plate and spacing             | `TOWER_PLATE_MAX_M2` 900, `TOWER_SEPARATION_M` 6                                                                                                                          | existing generator constants                                                                                                                                                                 | 4: invented                                    |

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
either stage merges into the band below (the first into the one above), the size model's rule.
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

## Location value (`pipeline/lib/location-value.ts`, `86_location_value.sql`)

`locationValueByLot(db)` runs after the scenario SQL, on `parcels` and `sc_roll_agg` (one row per
current parcel and roll year, condo units summed, `80_scenario.sql`). A building is a parcel whose
roll shows homes built in or after 2015 (`LOCATION_VALUE.minYearBuilt`), read on its first roll
after the completion year: the roll of that year can assess a part-built building, and the next
lien date assesses it complete, at market value. Hotels, non-taxable parcels (status N) and
parcels with no assessed value are left out. Its index is (land + improvement) ÷ units over the
median of the buildings first assessed in the same roll year, so prices over time drop out and
the citywide figure is 1.

Per Analysis Neighborhood the median index (`raw`, 1 with no building) is shrunk to 1:
`shrunk = (n × raw + 10) ÷ (n + 10)`. The 10 (`LOCATION_VALUE.shrink`) is tier 4, invented: it
keeps an area with a few new buildings near the citywide figure without a cliff. Every lot takes
its neighbourhood's `shrunk`; a lot with no neighbourhood takes 1. The build reports
`locationValue.buildings`, `locationValue.neighborhoods` and `locationValue.thin` (neighbourhoods
with n < 10).

On the current sources (an approximation outside the build, Task 6): 313 buildings over 41
neighbourhoods, 29 thin. Buildings of every size count, so single-family homes set the high end:
Pacific Heights shrinks from 57.5 (n = 2) to 10.4, Chinatown from 18.4 (n = 3) to 5.0, Marina
6.7 (n = 13) to 4.2; South of Market is 0.72 (n = 30) and Mission 0.84 (n = 32). Counting only
buildings of 10 or more homes leaves 98 buildings, 38 neighbourhoods thin, and every value between
0.94 and 1.90 (Financial District/South Beach 1.24, n = 7).

## The codec (`src/lib/data/option-table.ts`, `sfh-options/1`)

`optionTableOf(datasetVersion, rows)` packs one row per scenario row, each `{ options,
locationValue }`, into flat columns: `offset` (count + 1), per option `type` and `form`
(codes into `BUILDING_TYPES` and `BUILDING_FORMS`), `stories`, `plates` and `homes`
(`Uint16Array`), and per row `locationValue` (`Float32Array`). It throws a RangeError for a
row of more than `OPTIONS_MAX_PER_LOT` (1,023) options, homes above 65,535, stories or plates
above 255, or a row whose stories fall; the run time reads a row's allowed options as the prefix
up to the cap.

Wire format (deflate-raw): ASCII `SFHO`, u8 version (1), u8 length and the ASCII
`datasetVersion`, u32le row count, then per row u16le n, f32le `locationValue` and n options
of (u8 type, u8 form, u8 stories, u8 plates, LEB128 homes). `decodeOptionPayload` throws
`options: truncated …` on a short payload and rejects bad magic, versions, codes, row lengths,
story order and trailing bytes. `readOptionTable(body)` inflates and decodes;
`optionTableProblem(t, parcels)` names a table from another build (row count or
`datasetVersion`).
