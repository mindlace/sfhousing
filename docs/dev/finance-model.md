# Finance model

`src/lib/sim/finance/` holds the sourced constants and the arithmetic of public money for the
financing work: the Controller's feasibility prototypes, the private-finance terms an instrument is
measured against, grant-equivalents, coverage, bundle pricing, income tiers and the inclusionary
table, debt service and the legal limits on City borrowing. Design:
`docs/superpowers/specs/2026-11-09-finance-model-design.md`.

The module is pure: no clock, no global state, no random draws, no mutation of arguments. It
imports by relative path only (no `$lib`, `svelte`, `zod`, DOM, nothing from `src/lib/sim-page/`,
no `Intl` or `toLocaleString`; numbers are formatted with `toFixed`), so the worker, the page and
the data pipeline can all import it. `imports.spec.ts` guards this. The pipeline imports it by path.
It is in the dataset version (`PATHS` in `pipeline/lib/version.ts`), so any change here is a
dataset change, made at a release.

Everything public is re-exported from `src/lib/sim/finance/index.ts`.

## Where the types live

- `Sourced<T>`, `Unsourced` and `Evidence<T>` are in `evidence.ts`. `src/lib/sim-page/timing-sources.ts`
  re-exports them, so existing importers compile unchanged.
- `TermKey` and `ResolvedTerms` are declared in `src/lib/timelapse/types.ts` (`SimInput.finance`
  carries a `ResolvedTerms`); `terms.ts` re-exports them. `ResolvedTerms` is
  `Record<TermKey, number | null> & { custom: TermKey[] }`, so every field is nullable, including
  `lossOnExit`; `resolveTerms` always gives a number for `lossOnExit`.
- `MarketTerms` is in `terms.ts` because it is built from `Evidence`.

## Prototypes (`prototypes.ts`)

`PROTOTYPES` is a frozen array of five frozen objects, A to E, the same objects on every call (a
cache may key on identity or `id`). All values are tier 1 (Controller, Triennial 2026; see the
Evidence table).

| `id` | Building                      | `stories` | `homes` | `costPerHome` | `shortfallPerHome` |
| ---- | ----------------------------- | --------- | ------- | ------------- | ------------------ |
| A    | low-rise, Type V, 55 ft       | 5         | 45      | 729,700       | 177,000            |
| B    | mid-rise, Type III, 85 ft     | 8         | 130     | 736,700       | 152,000            |
| C    | high-rise, Type I, 135 ft     | 13        | 227     | 857,700       | 206,000            |
| D    | high-rise, Type I, 245 ft     | 24        | 341     | 918,700       | 292,000            |
| E    | small low-rise, Type V, 45 ft | 4         | 13      | 929,700       | 353,000            |

`costPerHome` excludes land. `shortfallPerHome` is the negation of the Controller's residual land
value per unit.

- `prototypeFor(stories, homes)`: `homes < 25` is E (including 0, negative and fractional values);
  otherwise `stories <= 6` is A, `<= 10` B, `<= 18` C, else D. Fractions compare as given. The
  binning is tier 4 (`PROTOTYPE_BINNING`). Throws `RangeError('prototypeFor needs finite stories
and homes; got <stories>, <homes>')` for a non-finite argument.
- `uncoveredPerHome(kind, p)`: what public money must cover per home. `market`:
  `p.shortfallPerHome + LAND_PER_HOME` (242,000 / 217,000 / 271,000 / 357,000 / 418,000 for A to
  E). `affordable`: `AFFORDABLE.costPerHome - AFFORDABLE.ownPerHome` = 861,525, whatever the
  prototype.
- `costPerHome(kind, p)`: `p.costPerHome` for `market`, `AFFORDABLE.costPerHome` (954,127) for
  `affordable`.
- Both throw `RangeError('unknown project kind: <kind>')` for any other `kind`. Results are
  integers, so no rounding arises.

## Market terms (`terms.ts`)

A market term is a number about private finance that an instrument's value is measured against.
`MARKET_TERMS` (deep-frozen): `constructionRate` 0.085, `constructionYears` 1.917, `requiredReturn`
0.06, `guaranteeRateCut` (`Unsourced`), `lossOnExit` 1. See the Evidence table.

`guaranteeRateCut` has no source: no evaluation of a public loan guarantee or published spread was
found. A guarantee is therefore unavailable until a rate cut is typed.

**`resolveTerms(m = MARKET_TERMS, typed = {})`** returns a new `ResolvedTerms` every call (mutating
its `custom` array changes nothing later). Each key takes `typed[key]` when present, else
`m[key].value` (null for `Unsourced`). A typed value replaces a sourced one, and a key whose typed
value equals the sourced one is still listed, because the user typed it. `custom` lists the typed
keys in alphabetical order; it drives the label "custom, not sourced" on every result that reads
one of those terms. Keys of `typed` that are not a `TermKey`, and `undefined` values, are ignored.
A non-finite value or one outside its range throws `RangeError('<key> must be between <lo> and
<hi>; got <v>')`; that is a programming error, because the lever parser checks
`FinanceLevers.terms` against the same ranges first.

**A typed market term.** A user types a term into `FinanceLevers.terms` (defined by
`finance-levers`). The parser checks it against `TYPED_TERM_RANGES`, which this module exports:

| Key                 | Typed range  |
| ------------------- | ------------ |
| `constructionRate`  | 0 to 0.25    |
| `constructionYears` | 0.25 to 10   |
| `requiredReturn`    | 0.01 to 0.25 |
| `guaranteeRateCut`  | 0 to 0.05    |
| `lossOnExit`        | 0 to 1       |

The ranges are input bounds, not evidence, and carry no tier. `resolveTerms` fills the term and
lists it in `custom`, and every result that reads it is labelled "custom, not sourced". A
`guaranteeRateCut` typed this way is the only way a guarantee gets a price.

`isResolvedTerms(t)` tells a `ResolvedTerms` from a `MarketTerms` by the presence of `custom`.
Every function that takes `MarketTerms | ResolvedTerms` resolves a `MarketTerms` with
`resolveTerms(terms)` first.

**The draw schedule.** A construction loan is drawn as the building rises. The partner's
assumption (R11, tier 4): 10% is drawn at the start (`DRAW_UP_FRONT` 0.10) and the rest evenly
over the construction period, so the average share out is `AVERAGE_DRAWN` =
`0.10 + 0.90 / 2` = 0.55 (computed, not typed). A loan's interest saving and a guarantee's saving
are counted on `AVERAGE_DRAWN` of the principal, while a pool commits the whole principal at the
start. Neither is a `TermKey`; the user cannot type them.

**Two 0.55s that are different things.** `CONSTRUCTION_LOAN_TO_COST` (0.55, Terner p. 13) is a
loan's share of project cost; it is read by no formula and is only a preset's starting `costShare`.
`AVERAGE_DRAWN` (0.55, R11) is the average share of a loan that is out, used in every loan and
guarantee saving. They are equal by coincidence.

## Grant-equivalents and coverage (`instruments.ts`)

A grant-equivalent is the dollars per home a grant would have to pay to be worth the same to the
project as the instrument. Let `U = uncoveredPerHome(kind, p)`, `C = costPerHome(kind, p)`, and `V`
(the project's own value per home) `= C - p.shortfallPerHome` for `market`, `AFFORDABLE.ownPerHome`
for `affordable`.

**`grantEquivalentPerHome(inst, kind, p, terms)`**:

- Grant: `share x U`.
- Loan: `P = costShare x C`. Interest saving
  `P x max(0, constructionRate - rate) x constructionYears x AVERAGE_DRAWN`. When the loan's
  `requiredReturn` is set and below the market's, add `costShare x V x (marketReturn / requiredReturn - 1)`
  (no draw factor: it is a change in the value the project's income supports, not interest on a
  balance). The sum is capped at `P`.
- Guarantee: `costShare x C x guaranteeRateCut x constructionYears x AVERAGE_DRAWN`, uncapped.
  Within the typed ranges it is at most 27.5% of the principal covered.

**The draw schedule applies to the interest saving only.** A loan's interest saving and a
guarantee's saving are counted on `AVERAGE_DRAWN` (0.55) of the principal; the pool still commits
the whole principal.

Rounded once, at the end, with `Math.round` (half up), returned as `Dollars`; never negative.
Throws `RangeError` with `validateInstrument`'s text for an invalid instrument (never returns NaN),
and `RangeError('<kind> needs <key>, which is not sourced')` for the first missing term.

Worked values (unit tests): a grant of $50,000 on B is 50,000 (`50000 / 736700` = 6.8% of cost); a
loan of 100% of B's cost at the market rate accepting 5.25% instead of 6.00% is
`584,700 x (0.06 / 0.0525 - 1)` = 83,529; a loan of 60% of B's cost at 4% with no accepted return is
`0.6 x 736,700 x 0.045 x 1.917 x 0.55` = 20,972.

**Missing terms.** `termsNeeded(inst)`: grant `[]`; loan `['constructionRate', 'constructionYears']`
plus `'requiredReturn'` when the loan's `requiredReturn` is not null; guarantee
`['constructionYears', 'guaranteeRateCut']`. `missingTerms(inst, terms)` returns those whose
resolved value is null, in that order. A caller must not compile or offer an instrument with a
non-empty `missingTerms`. A result "reads" a term when `termsNeeded` contains it; label it by
intersecting `termsNeeded(inst)` with `terms.custom`.

**One set of bounds.** `INSTRUMENT_BOUNDS` with `validateInstrument` (F6) is the one instrument
check, and every validator calls it. Values at full precision (no step, no rounding):

| Field                                   | Bound                     | Message                                                               |
| --------------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| grant `share`                           | `0 < share <= 1`          | A grant pays more than 0% and at most 100% of the uncovered cost.     |
| loan or guarantee `costShare`           | `0 < costShare <= 1`      | A loan or guarantee covers more than 0% and at most 100% of the cost. |
| loan `rate`                             | `0 <= rate <= 0.25`       | A loan's rate is between 0% and 25%.                                  |
| loan `requiredReturn`                   | null, or `0.01` to `0.25` | The return the lent money accepts is between 1% and 25%.              |
| guarantee `reserve`                     | `0 <= reserve <= 1`       | A guarantee's reserve is between 0% and 100% of the loan.             |
| any other `kind`, or a non-finite field | n/a                       | Unknown instrument kind. (or the message of the first failing check)  |

`validateInstrument` returns the first failing message or null. These are input bounds, not
evidence, and carry no tier.

**Coverage and certainty.** `coverage(g, kind, p)` = `g / U`; `oddsShift(g, kind, p, slope)` =
`slope x g / C`; both unrounded and uncapped (test certainty first and do not use the shift of a
certain project). Both throw `RangeError('grant-equivalent must be a finite number of 0 or more;
got <g>')` for a negative or non-finite `g`. `isCertain(c)` is `c >= 1 - CERTAIN_TOLERANCE` with
`CERTAIN_TOLERANCE = 1e-9`: shares are stored as fractions, so a bundle that pays exactly the
uncovered cost can sum to 0.9999999999999999. The tolerance is numerical (below a thousandth of a
dollar a home), not a model number, and carries no tier. Every certainty test and every comparison
of two coverages uses `isCertain` and `CERTAIN_TOLERANCE`, never an exact test for 1.

**`projectDollars(perHome, homes)`** = `Math.round(perHome x homes)`: the one place exact per-home
amounts become whole project `Dollars`. Per-home amounts are never rounded before multiplying.

## Bundles: `fundBundle(items, kind, p, terms)`

A project's bundle may mix grants, loans and guarantees from several pools. Each `BundleItem` is
`{ instrument, poolKind }`. An item's tier is fixed by its pool's kind: `federal` is tier 0,
`state` tier 1, and `bank`, `dedicatedTax`, `generalRevenue`, `goBond` and `cop` are the City tier
(2). An unknown `poolKind` throws `RangeError('Unknown pool kind: <kind>')`. `tierOf(poolKind)`
is exported and gives that tier (0, 1 or 2); the pipeline's baseline funding report uses it.

1. Every item is validated and its terms checked (throws as above).
2. Let `R = U`, what remains of the uncovered cost. Tiers are priced federal, state, City; an empty
   tier is skipped.
3. Within a tier, loans and guarantees count first, each at its full exact grant-equivalent (a
   loan's capped at its principal), even where that exceeds `R`. They are never reduced. With `L`
   their sum (input order, from 0), `R` becomes `max(0, R - L)`. Then the tier's grants: let
   `g_j = share_j x U` and `S = sum g_j` (input order). If `S <= R` the grants fit: each pays `g_j`
   and `R` becomes `R - S`. Otherwise they are scaled by one fraction `f = R / S` (computed once):
   each pays `g_j x f`, the grants' total is taken as `R` itself, and `R` becomes 0, so every
   later tier's grants pay 0 (its loans and guarantees still count in full).
4. `grantEquivalent` accumulates tier by tier from 0, adding `L` then the grants' total from step 3. `coverage = grantEquivalent / U`; `certain = isCertain(coverage)`. Coverage exceeds 1 only
   through loans and guarantees.
5. Per item (`ItemFunding`, all exact per-home dollars): a grant has `grantEquivalent` and
   `granted` equal to what it pays, and `lent`, `guaranteed`, `reserve` 0. A loan has its capped
   `grantEquivalent` and `lent = costShare x C`. A guarantee has its `grantEquivalent`,
   `guaranteed = costShare x C` and `reserve = reserve x guaranteed`.
6. `items[i]` is the pricing of input `i`. An empty input returns
   `{ items: [], grantEquivalent: 0, coverage: 0, certain: false }`. A bundle whose loans alone
   exceed `U` has coverage above 1, `certain` true, every grant pays 0, and nothing is negative.

**The floating-point definition of a scaled tier's total.** The products `g_j x f` summed in
floating point land within a few units in the last place of `R`, not exactly on it. A scaled tier's
total is therefore taken as `R` by definition, so a bundle whose grants bind has `grantEquivalent`
equal to `U` up to rounding in the running sums, and `coverage` within the tolerance of 1. Items'
own amounts sum to `grantEquivalent` within about 10^-10 dollars a home. The "fits" test is the
exact comparison `S <= R`.

**Why this tier rule.** Without a cap, two grants of 100% would each pay the whole uncovered cost
and the public would pay twice for one home. Outside money, loans and guarantees included, counts
before the City's because that is the design's stacking: the City's cost per home falls when state
or federal money is present. Within the City tier the sources share what is left in proportion
(pro rata), so money added to any City source relieves all of them: each City pool's draw per
project falls, and added City money buys homes wherever a City pool binds. A fixed order among
City kinds would not: an added `generalRevenue` grant would pay before the baseline's `goBond`
programme and only displace bond money that is then never spent, while the earlier City pools
still bind. Loans and guarantees count inside their own pool's tier for the same reason: if every
loan counted before every grant, an added City loan on a project the baseline already covers would
shrink the uncapped federal grant, which relieves nothing because that pool never binds while the
City pool commits the whole principal; counted in the City tier, it relieves the City's own
grants. This is tier 2 reasoning (F8, OD-F10, ruled by R12).

**The four worked bundles** (affordable, `U` = 861,525; all unit tests in `bundle.spec.ts`):

- The baseline alone (federal `443108/861525`, state `118390/861525`, City `300027/861525`): every
  tier fits; the grants pay 443,108, 118,390 and 300,027; nothing is scaled; coverage is 1 within
  the tolerance.
- An added City loan of 60% of the affordable cost at 4%, no accepted return: worth
  `0.6 x 954,127 x 0.045 x 1.917 x 0.55` = 27,161.56 a home. Federal and state pay in full. In the
  City tier the loan counts first, leaving `R` = 272,865.44 against the City grant's 300,027, so
  `f` = 0.909470 and the City grant pays 272,865.44. `lent` is 572,476.2, the whole principal.
- An added City grant of the City's whole share stacked on the baseline: `R` = 300,027 and the
  City tier's `S` = 600,054, so `f` = 0.5; the two City grants pay 150,013.5 each.
- An added federal grant of `100000/861525` on a baseline whose City money is split between
  `dedicatedTax` `150000/861525` and `goBond` `150027/861525` (a test split, not data): federal pays
  543,108, state 118,390, `R` = 200,027 against `S` = 300,027, so `f` = 0.66669666...; the City
  grants pay 100,004.4996 and 100,022.5004.

**Contract for callers.**

- It may be called on any subset of a bundle; `items[i]` is the pricing of input `i`; the result
  does not depend on input order (apart from one unit in the last place in `S`, which changes no
  whole dollar).
- Three subset properties hold and are tested, so a caller needs no defensive code: (i) the result
  depends only on which items are present, not on what was left out nor on order; (ii) leaving an
  item out never lowers any remaining grant's `granted`; (iii) a subset's `grantEquivalent` is
  never above the whole bundle's (within 1e-9).
- Subset example: on B, a federal loan of 60% at 4% (worth 20,971.97), a federal grant of 0.5
  (108,500) and `generalRevenue` and `goBond` grants of 0.5 each. After the loan and the federal
  grant, `R` is 217,000 - 20,971.97 - 108,500 = **87,528.03**; `fundBundle` counts loans at their
  exact (unrounded) grant-equivalent, so the City grants each pay 43,764.01 and, with one City
  grant left out, the other pays 87,528.03. The 87,528 and 43,764 in the design prose are rounded.
- A memoising key is sound within one `SimInput` (terms fixed): the sorted programme ids with the
  kind and prototype id. The result's `items` must still be returned in the caller's input order.
- The two callers: the engine's award loop (prices the whole bundle, leaves out programmes whose
  pools cannot pay, prices again until every pool left can pay; a pool's part for item `i` is
  `projectDollars(granted + lent + reserve, homes)`), and `finance-score`'s tier weights (one call
  per completed funded affordable schedule, weighting each programme's tiers by
  `items[i].grantEquivalent`; a weight can be 0).

## Income tiers and the inclusionary table (`tiers.ts`)

`AMI_TIER_BOUNDS` = `{ veryLow: 0.5, low: 0.8, moderate: 1.2 }` (shares of area median income).
`tierOfAmi(s)`: `s <= 0.5` very low; `<= 0.8` low; `<= 1.2` moderate; above that, above moderate.
Throws `RangeError` for a non-finite or negative `s`. Eighty percent is low income (HCD), where the
Budget Analyst's RHNA labels put it in the next band.

`INCLUSIONARY` is stored as integer basis points, per tenure and size band:

| Tenure    | Homes      | Area median income (tier)                         | Basis points    |
| --------- | ---------- | ------------------------------------------------- | --------------- |
| rental    | 10 to 24   | 55% (low)                                         | 1,500           |
| rental    | 25 or more | 55% (low); 80% (low); 110% (moderate)             | 1,000; 400; 400 |
| ownership | 10 to 24   | 80% (low)                                         | 1,500           |
| ownership | 25 or more | 80% (low); 105% (moderate); 130% (above moderate) | 1,000; 500; 500 |

`INCLUSIONARY` is pinned to the Triennial table for this package (the rates in force on November 1,
2026, held for the whole run; the scheduled rise of the 25-or-more rental rate from 2028 is not
applied). Its rounding rule is a tier 4 assumption. `ASSUMED_TENURE` is `'rental'` (tier 2).

**`inclusionaryUnits(homes, tenure = ASSUMED_TENURE.value)`** returns on-site homes by income tier
(`Record<IncomeTier, number>`). `homes` must be an integer of 0 or more, else `RangeError`. Fewer
than 10 homes returns all zeros. Otherwise, with the band's total basis points `b`, the total is
`floor((homes x b + 5000) / 10000)` (a fraction of one half or more rounds up). It is split across
income tiers (the band's basis points summed per tier first) by largest remainder of
`homes x bp / 10000`, ties to the lower-income tier. Examples: 130 homes rental is 23 (23.4), low
18, moderate 5; 10 homes is low 2 (1.5 rounds up); 13 homes is low 2; 24 homes is low 4 (3.6); 25
homes switches band, total 5 (4.5 rounds up): low 4, moderate 1; 9 homes is zeros. `finance-score`
reads `INCLUSIONARY` only through this function.

`DISPLACEMENT_RANGE` = `{ low: 0.115, high: 0.8 }` (tier 3): the share of subsidised homes that
displace private housing that would have been built. National studies; neither measured San
Francisco, and no San Francisco estimate exists.

## Debt service and legal limits (`debt.ts`)

**One set of bounds.** `DEBT_BOUNDS` with `validateDebt` (F5), which every validator calls: a rate
above 0 and at most 0.25, a term of a whole number of years from 1 to 40. `validateDebt` returns
the message ("A borrowing rate is above 0% and at most 25%." or "A borrowing term is a whole number
of years from 1 to 40.") or null. Values at full precision.

**`debtService(principal, { rate, termYears })`**: level annual payment
`principal x rate / (1 - (1 + rate)^-termYears)`; total `annual x termYears`. Both rounded once
with `Math.round` from the exact annual value; nominal dollars. `debtService(0, ...)` is
`{ annual: 0, total: 0 }`. Throws `RangeError` unless `principal` is finite and 0 or more and the
debt passes `validateDebt`.

**`DEBT_LIMITS`**: eleven entries, each tier 1 (Budget Analyst, pp. 104 to 108; Resolution 562-24
p. 2); see the Evidence table. The Charter limit is `goCapShare x assessedValue` = 10,608,000,000.
The report's own sentence that $2.67 billion is "approximately $8.07 billion below the $10.6
billion Charter limit" does not match its numbers (10.608 - 2.67 = 7.938); this uses the
arithmetic and the provenance notes the discrepancy.

**`limitStatements(borrowing)`** takes the borrowing the policy adds, one `Borrowing` per
`goBond` or `cop` pool (`finance-score` builds the list), and returns `LimitStatement`s in the
order `goRate`, `goCap`, `goVote`, `copCap`; only those the borrowing triggers are present.
`goRate`, `goVote` and `copCap` are always `exceeded` when present (the existing programmes use the
whole headroom by FY 2031-32 and FY 2028-29; reading that as no headroom is a tier 2 inference);
`goCap` is `exceeded` when `goOutstanding + G > 10,608,000,000` and ignores amortisation, so it may
report "over" a few years early. Money below $1 billion is "$X million" with one decimal, from
$1 billion "$X billion" with two; a tax rate in percent has four decimals; dollars per $100,000 two
decimals; a share of revenue in percent two decimals (all `toFixed`, no locale).

## Rounding

Every `Dollars` result is rounded once, at the end, with `Math.round`: `grantEquivalentPerHome`,
`projectDollars`, `debtService`. Exact (unrounded): `fundBundle`'s per-home amounts, `coverage`,
`oddsShift` and the `ResolvedTerms`. Constants are stored as published (whole dollars; rates as
fractions; `constructionYears` to three decimals; inclusionary rates in basis points).

## Evidence

All sources accessed 2026-11-09. Tiers follow the evidence hierarchy: 0 per-record data, 1 official
aggregates and law, 2 inferences, 3 literature and research models, 4 invented. A page given is the
page read for this module.

Sources: Controller, ["Inclusionary Housing: Triennial Review of Economic Feasibility,
2026"](https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf),
2026-04-30, corrected 2026-05-19 (Triennial); Controller, [TAC meeting 2
presentation](https://media.api.sf.gov/documents/TAC_Meeting_2_Presentation_-_2-11-2026.pdf),
2026-02-11 (TAC deck); Budget and Legislative Analyst, ["Funding and Incentivizing Affordable Housing in San
Francisco"](https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf),
2026-06-05 (BLA); Terner Center, ["Making It
Pencil"](https://ternercenter.berkeley.edu/wp-content/uploads/2023/12/Making-It-Pencil-December-2023.pdf),
December 2023 (Terner).

| Constant                            | Value                                         | Tier | Source                                                                                                                                                                                                                                                        | Status                                                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROTOTYPES` A to E                 | table above                                   | 1    | Triennial pp. 4, 11 (stories and homes p. 11 rows 1 and 5; `costPerHome` p. 11 row 11; shortfall the negation of p. 4 row 1); [TAC deck](https://media.api.sf.gov/documents/TAC_Meeting_2_Presentation_-_2-11-2026.pdf) slide 14                              | Sourced. Cost excludes land (footnote (a) of the February draft; the final report prints no notes). "Current" is the requirements applying on November 1, 2026 (p. 3 fn 2).               |
| `PROTOTYPE_BINNING`                 | under 25 homes E; stories 6 / 10 / 18 for A-D | 4    | Triennial (the prototypes' stories and homes)                                                                                                                                                                                                                 | Invented binning; labelled tier 4.                                                                                                                                                        |
| `LAND_PER_HOME`                     | 65,000                                        | 2    | Triennial p. 3                                                                                                                                                                                                                                                | Sourced. Midpoint of the published $60,000 to $70,000; the one recorded sale was $68,000 (TAC deck slide 22).                                                                             |
| `AFFORDABLE`                        | cost 954,127; own 92,602                      | 1    | BLA Exhibit F, p. 7                                                                                                                                                                                                                                           | Sourced. Average funding per home, 2024 tax-credit projects; own is permanent loans 87,431 plus other 5,171 (a tier 2 sum of tier 1 values).                                              |
| `constructionRate`                  | 0.085                                         | 3    | Terner p. 12                                                                                                                                                                                                                                                  | Sourced. "a total interest rate of 8.5 percent for the construction loan"; California prototypes, late 2023, not San Francisco. No San Francisco or official figure found.                |
| `constructionYears`                 | 1.917                                         | 2    | Dataset `2026-11-08-d15bdf2d`, `scenarios/fzp/calibration.json`, `transitions.discretionary.construction.advance` (n = 1,274, 2007-01-01 to 2026-10-19)                                                                                                       | Sourced. 23 months (median month by which half of eventual completions have happened) over 12. Tier 0 data; reading it as the loan's life is an inference.                                |
| `requiredReturn`                    | 0.06                                          | 1    | Triennial p. 11 row 14, "Untrended Return-on-Cost"                                                                                                                                                                                                            | Sourced. 6.00% for every prototype.                                                                                                                                                       |
| `guaranteeRateCut`                  | null                                          | n/a  | none found                                                                                                                                                                                                                                                    | Unsourced: no evaluation of a public loan guarantee and no published spread. A guarantee runs only on a typed rate cut, labelled "custom, not sourced".                                   |
| `lossOnExit`                        | 1                                             | 4    | none (FDIC and public-bank figures found, not used)                                                                                                                                                                                                           | Invented (OD-F8): a funded project that exits after construction began loses the whole amount spent or out. FDIC charge-off rates and a 2.5% loss allowance are portfolio rates per year. |
| `DRAW_UP_FRONT`                     | 0.10                                          | 4    | The partner's assumption, R11                                                                                                                                                                                                                                 | Invented. No source for a draw schedule was found.                                                                                                                                        |
| `AVERAGE_DRAWN`                     | 0.55                                          | 4    | The partner's assumption, R11                                                                                                                                                                                                                                 | Invented; `DRAW_UP_FRONT + (1 - DRAW_UP_FRONT) / 2`.                                                                                                                                      |
| `CONSTRUCTION_LOAN_TO_COST`         | 0.55                                          | 3    | Terner p. 13                                                                                                                                                                                                                                                  | Sourced. "approximately 55 percent LTC"; California. Read by no formula; a preset's starting cost share.                                                                                  |
| `AMI_TIER_BOUNDS`                   | 0.5 / 0.8 / 1.2                               | 1    | [HCD, 2026 State Income Limits Briefing Materials](https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/income-limits-2026.pdf), pp. 2-4; BLA Exhibit D, p. 5                                                                                   | Sourced. Health and Safety Code section 50093. Mapping San Francisco's programme percentages onto state categories by percentage is a tier 2 inference.                                   |
| `INCLUSIONARY`                      | table above (basis points)                    | 1    | Triennial pp. 7-8 (post-reduction on-site column); BLA Exhibit J, p. 11                                                                                                                                                                                       | Sourced. Rates in force November 1, 2026; the 2028 rise is not applied. The rounding rule is a tier 4 assumption (Planning Code section 415.6 reported, not read).                        |
| `ASSUMED_TENURE`                    | rental                                        | 2    | Triennial (rental apartment prototypes)                                                                                                                                                                                                                       | Inferred: the simulation does not know a project's tenure.                                                                                                                                |
| `DISPLACEMENT_RANGE`                | 0.115 to 0.8                                  | 3    | [Ferreira, Meyer and Turner, NBER slides, 2026-07-29](https://conference.nber.org/conf_papers/f240610/f240610.slides.pdf) slide 17; [Soltas, 2024](https://economics.sas.upenn.edu/system/files/2024-08/Empirical%20Micro%2010312024.pdf) p. 4, Table 5 p. 39 | Sourced. National studies; neither measured San Francisco or a supply-constrained coastal market.                                                                                         |
| `DEBT_LIMITS.goPolicyRate`          | 0.1201 (% of assessed value)                  | 1    | BLA p. 104                                                                                                                                                                                                                                                    | Sourced. City policy keeps property taxes at or below the 2006 level.                                                                                                                     |
| `DEBT_LIMITS.goRateToday`           | 0.1105                                        | 1    | BLA p. 104                                                                                                                                                                                                                                                    | Sourced. FY 2025-26 rate to repay G.O. bonds.                                                                                                                                             |
| `DEBT_LIMITS.goPolicyReachedFy`     | FY 2031-32                                    | 1    | BLA p. 104; Exhibit 39, p. 105                                                                                                                                                                                                                                | Sourced. "approximately".                                                                                                                                                                 |
| `DEBT_LIMITS.goRatePerAnnualDollar` | 0.01 / 35,784,254                             | 1    | BLA Exhibit 40, p. 106                                                                                                                                                                                                                                        | Sourced. 0.01% of added rate supports $35,784,254 of annual debt service.                                                                                                                 |
| `DEBT_LIMITS.goCapShare`            | 0.03                                          | 1    | BLA p. 104                                                                                                                                                                                                                                                    | Sourced. Charter limit on Citywide bond debt, share of net assessed value.                                                                                                                |
| `DEBT_LIMITS.assessedValue`         | 353,600,000,000                               | 1    | BLA p. 104                                                                                                                                                                                                                                                    | Sourced. FY 2025-26, "approximately $353.6 billion".                                                                                                                                      |
| `DEBT_LIMITS.goOutstanding`         | 2,670,000,000                                 | 1    | BLA p. 104                                                                                                                                                                                                                                                    | Sourced. December 2025, including anticipated issuances. The report's "$8.07 billion below" does not match 10.608 - 2.67 = 7.938; the arithmetic is used.                                 |
| `DEBT_LIMITS.copCapShare`           | 0.0325                                        | 1    | BLA p. 107; Administrative Code section 10.62(b)(3)                                                                                                                                                                                                           | Sourced. Cap on COP debt service, share of General Fund aggregate discretionary revenue.                                                                                                  |
| `DEBT_LIMITS.discretionaryRevenue`  | 4,660,000,000                                 | 1    | BLA Exhibit 42, p. 108                                                                                                                                                                                                                                        | Sourced. FY 2025-26.                                                                                                                                                                      |
| `DEBT_LIMITS.copReachedFy`          | FY 2028-29                                    | 1    | BLA pp. 105, 107                                                                                                                                                                                                                                              | Sourced. COPs "reach its debt capacity constraint in approximately FY 2028-29".                                                                                                           |
| `DEBT_LIMITS.goVote`                | two thirds                                    | 1    | [Resolution 562-24](https://sfbos.org/sites/default/files/r0562-24.pdf), p. 2                                                                                                                                                                                 | Sourced. The constitutional text (article XVI, section 18) returned 403 and was not read.                                                                                                 |

## Read and not used

- **The net-income identity** (net operating income / homes / 6.00% - cost; Triennial p. 11 rows 13,
  5, 14, 11) gives -173,600, -150,900, -205,200, -291,300 and -311,000. A to D match p. 4 within
  $3,000; E does not (-353,000 published). The published residuals are the constants.
- **Condominiums** (Triennial p. 4 second table, p. 12): the simulation does not know tenure and
  uses the rental tables; condominiums give smaller shortfalls in all five prototypes.
- **The State Density Bonus tables** (p. 4 row 4): the envelope does not record whether a project
  used the bonus, so the base programmes are used.
- **The 100% market-rate row** (p. 4 row 6): illustrative only in the report's words.
- **FDIC net charge-off rates** on construction and development loans (5.40% 2009, 5.45% 2010,
  -0.01% 2019) and the public-bank plans' 2.5% loss allowance: portfolio rates per year, not the
  loss on one abandoned project (`lossOnExit`).
- **COP issuance costs** (15% to 25% of proceeds, BLA p. 108): not modelled; a COP pool's inflow is
  the money the City can spend and its principal is taken as equal.
- **The scheduled inclusionary rise from 2028** (BLA Exhibit J note, 0.5 percent a year to a cap of
  24 percent): not applied, because no verified source splits it between income tiers and the
  shortfalls assume the November 2026 rate.
