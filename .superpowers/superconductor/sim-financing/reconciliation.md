# Reconciliation of the spec writers' interface concerns (2026-11-09)

The seven spec writers checked the design's rows against the code and the sources and returned their concerns. This file records what the orchestrator decided for each, and what each spec must now say. The design document is already amended, and its rows and global constraints are already copied into every spec by `sync-rows.mjs` (do not edit an embedded row or constraint by hand; run the script with `--check` to confirm).

## What changed in the design

Read the amended design (`docs/superpowers/design/2026-11-09-1911-sim-financing.md`), in particular its status note, "The model" sections 1 to 3 and 5, open decisions OD-F10 to OD-F12, "Row ownership", "Dependency order", "Out of scope", and rows F2 to F10 and F12 to F17.

### Model-level (all three ruled by the partner: R11 and R12)

- **OD-F10, how funding sources combine on one project.** Found by `finance-levers`, `funding-ui` and `finance-model` independently.
  - `fundBundle` (F8, `finance-model`) is the one pricing rule, in three tiers by pool kind: `federal` pools, then `state` pools, then the City's (`bank`, `dedicatedTax`, `generalRevenue`, `goBond`, `cop`). Within a tier, its loans and guarantees count first; then each of its grants pays its share when the tier fits in what remains of the uncovered cost, and otherwise the same fraction of its share, so the tier covers exactly what remains. **Amended in the sync round** (`finance-levers` N2): the first version filled grants in a fixed order of pool kind, and added general revenue then displaced the baseline's bond money, which stranded. Pro rata among the City's sources means money added to one relieves all of them.
  - Award (F9 (c)): programmes whose pools cannot pay their part are left out and the rest priced again, repeatedly, until every pool left can pay. The project is awarded with the programmes left when their coverage, counted up to 1, is not below the whole bundle's. Otherwise it waits. A project never starts on less than it applied for.
  - Waiting applications are re-made in place on each day a programme starts or ends, a pool goes off or on, or a regime begins (F9 (b)). An application lapses, and its latent start is drawn again as a new spell on the same draws, when its re-made bundle is empty **or its coverage, counted up to 1, is lower than before**.
  - A pool can be switched off (F7, F9 `off`): a `baselineScale` of 0 on **any** baseline pool, capped or not, stops its inflows and takes its programmes out of every bundle until a later entry above 0. A pool that is on but short keeps projects waiting. `applyLevers` emits `off` spans; programme ids are never split.
  - `Schedule.funding.programmes` lists the programmes that pay the project: those of the awarded set with a non-zero grant, loan or guarantee, in `finance.programmes` order.
  - A funded affordable project's tiers (F13) are those of the programmes that pay it, weighted by the grant-equivalent each pays, rounded to whole homes by largest remainder, ties to the earlier tier.
  - Known limit, in "Out of scope": an application waits for a pool that is short even when no more money is due to it.
- **OD-F11, the market level.** Found by `market-baseline`. `today.all` and `today.private` are measured against the **published** model on the last three panel years (129 observed against 245.5 implied, −0.644 on build `2026-11-04-bbb2eba1`; verified by the orchestrator in the calibration report's "Plausibility" table). The hold-out (386.4) is report-only. The slope falls to about 1.75. F2's `today` gains `years`, `observed` and `implied`.
- **OD-F12, interest on the whole principal** (`finance-model` concern 9). **Ruled by the partner (R11), after this file was first written.** A construction loan is drawn 10% at the start and the rest evenly over construction, so on average 55% of it is out. Row F8 now multiplies the loan's interest saving and the guarantee's saving by `AVERAGE_DRAWN` (`DRAW_UP_FRONT + (1 − DRAW_UP_FRONT) ÷ 2` = 0.55, `DRAW_UP_FRONT` = 0.10; both `Sourced`, tier 4, "the partner's assumption, R11"). The `requiredReturn` part of a loan's worth is not affected. The pool side is not affected: a loan's whole principal is still committed at the start. Nothing is an "upper bound" any more; wherever the saving is shown, its sources say the draw schedule is an assumption.

### Decomposition-level (decided)

- **Order.** `finance-model`, then `market-baseline`, then `finance-data`, in sequence (the last two edit the same calibration step and report). `market-baseline` owns `calibration.market` (after `phaseGap`), report section 11, the flag for a start whose Planning record proposes at least 95% affordable homes, and the addition of `src/lib/sim/finance` to the hashed paths. `finance-data` reuses the flag and owns `affordableRoutes` and `baselineFunding` (after `market`) and report sections 12 and 13. `finance-engine`, `finance-score`, `finance-levers` and `funding-ui` reach `main` together as Release 2.
- **Step 0** declares the types of rows F1 to F3, F5 to F10 and F12 to F14, with `TermKey` and `ResolvedTerms`, in `src/lib/timelapse/types.ts`.
- **F2, F3.** `today.years`, `observed`, `implied` for the page's sentence. A month falls under the step in force on its first day.
- **F4.** `PROTOTYPES` exported. `src/lib/sim/finance/` has no `$lib` import; `Sourced`, `Unsourced`, `Evidence` live in `src/lib/sim/finance/evidence.ts`, re-exported from `src/lib/sim-page/timing-sources.ts`.
- **F5.** One arrival rule, `inflowArrivals(inflow, asOf, horizon): Day[]`, in `src/lib/sim/scenario/funding.ts`, owned by `finance-engine`, imported by `finance-levers`.
- **F6.** `requiredReturn`, when set, between 0.01 and 0.25.
- **F7.** `terms: Partial<Record<TermKey, number>>` for typed market terms (without it every guarantee is unavailable, because the guarantee rate cut is unsourced). At most 12 inflows a pool. Added ids start `u-`; every id matches `^[a-z0-9][a-z0-9-]{0,39}$`.
- **F8.** `terms: MarketTerms | ResolvedTerms`; a loan's grant-equivalent is capped at its principal; `isCertain` with a 10⁻⁹ tolerance.
- **F9.** (d) keys on the first day of the latent month. (f) available money is `leverage × received − committed − spent − out − lost`. (l) the pipeline assumption is exported as `PIPELINE_FUNDED`. `buildSimInput` sets `finance` only when the calibration has both `baselineFunding` and `market`.
- **F10.** Ledger events carry `programme: string | null`, one event per programme of a project. `finance-score` collects the ledger in `simulateDetailed`; the engine adds no collector. `ProjectCard` gains `kind?` and `funding?: { programmes; certain }`, added by `finance-engine`.
- **F12.** The four new fields are optional in the types. `provenance` order fixed. Baseline ids are stable across dataset versions and never start `u-`. `byTier`: above moderate is the net total less the income-restricted tiers, and the tiers sum to `units`.
- **F13.** `INCLUSIONARY` is read through `inclusionaryUnits(homes, tenure?)`. A pipeline project's recorded 0 may mean "not stated".
- **F14.** `committed` and `out` are amounts outstanding; the others cumulative. A tier target's `fraction` defined. `owed` uses `debtService`. `limits` come from the borrowing the policy adds, not from outcomes; `goVote.exceeded` is true whenever shown. Per added home is derived (`perAddedHome`), not stored. No tiers for the twin.
- **F15.** The loader's report shape is `finance-levers`'s to fix; `funding-ui` owns the notices' text. Publishing a schema-2 document is refused.
- **F16.** Preset ids `u-<presetId>-<n>` and `valueSource`.
- **F17.** `applyLevers` emits `off` spans and `resolveTerms(MARKET_TERMS, levers.finance.terms)`.
- **Not changed.** `PoolKind` gains no kind for fees (`finance-data` 7). An uncapped pool is on or off, not scaled (`funding-ui` 10; the design's prose now says so).

## What each spec must now do

Every writer: bring Behaviour, Seams, Testing, Acceptance criteria and Developer documentation into line with the amended rows. In "Interface concerns", keep only what is still open; move what is settled into a short "Resolved at reconciliation" list that names the row. Do not edit embedded rows or the global constraints. Stay Prettier-clean. No commit.

### `market-baseline`

- Measure `today.*` against the published model; keep the hold-out as a report-only diagnostic; emit `years`, `observed`, `implied`. Update every number, tolerance, fixture, test and acceptance criterion that rested on −1.10 or on the old slope.
- Own and export the ≥ 95% affordable flag for `finance-data`. Calibration key `market` after `phaseGap`; report section 11.
- Add `src/lib/sim/finance` to `PATHS` in `pipeline/lib/version.ts`.
- New scope: state today's market level in the results' sources in Release 1 (the sentence with the observed and implied counts and its provenance). `funding-ui` section 4.12 drafted that sentence; take it over, and say that `funding-ui` extends it for the private level in Release 2.
- You run before `finance-data`, not beside it.

### `finance-data`

- You run after `market-baseline`: reuse its flag; your keys follow `market`; report sections 12 and 13.
- Pool kinds now decide the order in which grants fill (F8 `fundBundle`). State each baseline pool's kind and the order that follows.
- Check the baseline ids against the id rule now in F12. Keep the fixture's funding shape as `funding-ui` needs it: a City pool, the state pool and the uncapped federal pool, each with a programme, shares summing to 1, and a market.
- The optional fields, the provenance order and the `byTier` rule are now in the row.

### `finance-model`

- `fundBundle`, the terms union, the loan cap, `isCertain`, `TermKey` and `ResolvedTerms` (declared at step 0 in `src/lib/timelapse/types.ts`, re-exported from `terms.ts`) are now row text. Make your sections agree with the row exactly, signatures included.
- `resolveTerms` takes `FinanceLevers.terms`; a guarantee runs on a typed rate cut, labelled custom.
- `inclusionaryUnits` and `debtService` are named in rows F13 and F14: signatures must match the rows.
- `limitStatements` takes the borrowing the policy adds (`finance-score` builds the list).
- You do not add the hashed path. `inflowArrivals` is not yours.
- OD-F12 is ruled (R11): add `DRAW_UP_FRONT` and `AVERAGE_DRAWN` as `Sourced` tier 4 constants, apply `AVERAGE_DRAWN` to the loan's interest saving and to the guarantee's saving, and update every worked number and test that depends on them.

### `finance-engine`

- F9 `off`: the activity test, the segment bounds and the re-pricing days include pool off and on days.
- F9 (b): lapse also when coverage, counted up to 1, falls. F9 (c): the award rule above, in place of "every pool must pay". Say what it costs in the serve pass and whether the F18 budgets still hold.
- `funding.programmes`, the dollars, `certain` and the ledger come from the awarded set's pricing.
- `ProjectCard.kind` and `ProjectCard.funding`; `PIPELINE_FUNDED`; `inflowArrivals` is yours.
- Tests: a bond stacked on the baseline adds homes; a programme that opens later reaches waiting applications; a pool switched off lowers coverage, and the application lapses and is drawn again; a short pool is made up by another only as far as its share allows; an application waits on a spent pool (the stated limit).

### `finance-score`

- F13: tiers by the programmes that pay, weighted by grant-equivalent (`fundBundle` on `funding.programmes`, with the prototype of the schedule's start size), largest remainder.
- Use `inclusionaryUnits(homes, tenure?)` and `debtService`; drop your own `inclusionaryFor` and `totalRepayment`.
- Ledger `programme` field; you collect the ledger; the stocks wording; `fraction`; `limits` from added borrowing, passed to `limitStatements`; `perAddedHome`.
- List `PIPELINE_FUNDED` among the money sources. Label tier progress "completed since 30 June 2022 (net)". Programme ids are never split.

### `finance-levers`

- F7: parse and validate `terms`; 12 inflows a pool; a scale of 0 switches off any pool.
- `buildFinance` emits `off` spans; remove the `#k` programme pieces and `programmeBaseId`.
- Import `inflowArrivals` from the engine; remove your own definition.
- `applyLevers` resolves the terms. `isDefaultPolicy` covers `terms`.
- Say what each preset does under OD-F10's fill order.
- Fix the loader's report shape explicitly, for `funding-ui` to consume.
- Reuse `finance-data`'s `checkPool` and `checkProgramme` where the checks are the same.

### `funding-ui`

- The coverage line uses `fundBundle`, the engine's own pricing. Remove the as-written arithmetic and its warning. Added programmes on baseline pools are allowed (F7).
- A scale of 0 reads as "switched off" for any pool. An uncapped pool is on or off.
- A field for a typed market term where an instrument needs an unsourced one, labelled "custom, not sourced".
- The card line reads `ProjectCard.kind` and `funding`. Sourced-or-custom comes from `valueSource`. The loader's report is `finance-levers`'s shape.
- The market sentence ships in Release 1 from `market-baseline`; you extend it.
- Results: `perAddedHome` (lead with City money per added home), limits as consequences of the policy, `PIPELINE_FUNDED`, and a line saying that a funded affordable project's tiers follow its programmes in proportion to what each pays.
