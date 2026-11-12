# Funding levers: `FinanceLevers` and `buildFinance`

The funding part of the lever document, and how it compiles onto the dataset's baseline funding for the plan. Source: `src/lib/sim/levers/finance.ts` (parser, limits, `buildFinance`), `types.ts` (`FinanceLevers`, schema 3), `apply.ts` (`planOf`, `bare()`, `twinInput`), and `src/lib/sim/scenario/scenario-host.ts` (the worker's guard and the warm task). Spec: `docs/superpowers/specs/2026-11-09-finance-levers-design.md` (sections 4.1 and 4.4). Everything here is worker-safe and pure except the host. The page side (the policy, the schema-3 loader, presets) is in [sim-funding.md](sim-funding.md) and [plan-sharing.md](plan-sharing.md); the engine that consumes the result is in [finance-engine.md](finance-engine.md).

## The document

```ts
interface FinanceLevers {
  baselineScale: { pool: string; from: Day; scale: number }[];
  pools: Pool[];
  programmes: Programme[];
  terms: Partial<Record<TermKey, number>>;
}
```

`SimLevers.finance` carries it, and `DEFAULT_LEVERS.finance` is `{ baselineScale: [], pools: [], programmes: [], terms: {} }`: the baseline as the dataset gives it. `baselineScale` multiplies the inflows of a baseline pool that arrive on or after `from` (scale 0 to 10; the latest entry at or before a day applies). `pools` and `programmes` are the user's additions. `terms` are market terms the user typed (`finance-model`): a typed term replaces the sourced or unsourced one and is labelled "custom, not sourced" wherever it is read.

## Parse rules in brief

`parseFinanceLevers(v, path)` uses the house guards (`record()` rejects unknown and missing keys) and throws `LeverFormatError(path, message)` on the first bad field. Under a policy the same error is re-pathed to `funding.…` (`viaLevers`), and under a stored document to `/policy/funding/…` (`pointer`, `sim-doc.ts`).

- **Limits** (`FINANCE_LIMITS`, tier 4): 12 added pools, 12 inflows a pool, 24 added programmes, 24 scale entries, labels of 1 to 80 characters (stored trimmed), ids of at most 40 characters.
- **Ids.** Every id matches `^[a-z0-9][a-z0-9-]{0,39}$`. An added id (a pool or a programme) also starts `u-` and is unique in its own list (pools and programmes are separate id spaces). Baseline ids never start `u-`, so the parser tells an added pool reference from a baseline one without the dataset: a scale entry's `pool` must **not** start `u-`; a programme's `pool` that starts `u-` must name an added pool. An added id can never equal a baseline id, so there is no collision check.
- **Days** are integers from `FIRST_DAY` 10957 (2000-01-01) to `LAST_DAY` 47482 (2100-01-01). The parser cannot see `asOf`, so it never compares a day with it.
- **Pools** go through the shared `checkPool` (`src/lib/timelapse/model.ts`) after the key check: the one function the dataset's baseline pools and an added pool are checked by (kind, inflow shapes, `to` null or at least `from`, `debt` non-null exactly for `goBond` and `cop`, leverage above 0 and 1 unless `bank`). Its `CalibrationFormatError` is rethrown as a `LeverFormatError` with the same path and text. Then the added-only rules: `uncapped` is `false`, inflows are 1 to 12, dollars are integers from 1 to `MAX_DOLLARS` (100 billion), a bank's leverage is at most 10. A fractional inflow `dollars` fails the shared `checkPool` first (`expected an integer`), so the table's whole-dollars message (`expected whole dollars from 1 to 100000000000`) shows only for an out-of-range integer.
- **Programmes** do not use `checkProgramme` (that one validates the grants-only baseline, with `minHomes` of at least 1). An added programme may be a loan or a guarantee, may have `minHomes` 0 (0 to 10,000), and may name a baseline pool. The instrument must have exactly the keys of its `kind`, then `validateInstrument` (`finance-model`) must return null. `tiers` are non-null exactly for `affordable` reach: the four income tiers, each at least 0, summing to 1 within 1e-9, stored as given. An invalid `pool` id gives `expected a pool id`; a negative tier gives `expected a number of 0 or more`.
- **Scale entries** are sorted by `pool` (code-unit order), then strictly ascending `from`, with no two on one day. An order error is reported at the **later** of the two entries (`finance.baselineScale[i]` with `i` the second).
- **Terms.** Each key is one of the five `TermKey`s, optional. A typed term is a finite number that `resolveTerms(MARKET_TERMS, { [key]: x })` accepts (ranges are `finance-model`'s input bounds: `constructionRate` 0 to 0.25, `constructionYears` 0.25 to 10, `requiredReturn` 0.01 to 0.25, `guaranteeRateCut` 0 to 0.05, `lossOnExit` 0 to 1); a `RangeError` becomes a `LeverFormatError` at `terms.<key>`. A typed term is kept even when it equals the sourced value.
- **A term an instrument needs is not a parse rule.** `MARKET_TERMS` is code and a later release may un-source a term; a stored policy must not turn corrupt when it does. Missing terms are dropped on load with a report entry ([sim-funding.md](sim-funding.md)), refused on publish ([plan-sharing.md](plan-sharing.md)), and guarded in `buildFinance`.

## `buildFinance(base, f, asOf)`

`planOf` sets `finance: buildFinance(base.finance, levers.finance, base.asOf)` on the plan, and leaves the key out when the result is undefined, so a run without public money is unchanged. The steps, in order:

1. **No model.** `base` undefined (the dataset has no `baselineFunding` or `market`, so `buildSimInput` set none): return undefined whatever `f` holds. The funding stays in the policy but is not used, and the loader reports it as `unusable`. Without a market model there is no slope, so no programme can be priced; refusing the levers instead would leave a policy from a newer dataset unable to run on an older one.
2. **Identity.** `f` with no scale entry, no added pool, no added programme and no typed term returns `base` itself (the same object), so a run with no funding changes has an input identical to the twin's, and the memoised precompute is shared. This is exact: `base.terms` is `resolveTerms(MARKET_TERMS)`.
3. **The id check**, throwing `LeverFormatError`: `finance.baselineScale[i].pool` and then `finance.programmes[i].pool` (not starting `u-`) with `no baseline pool <id> in this data`.
4. **Terms and the missing-term guard.** `terms = resolveTerms(MARKET_TERMS, f.terms)`. Every programme, baseline and added, whose `missingTerms(instrument, terms)` is non-empty throws at `finance.programmes[i].instrument` (a baseline one at `base.programmes[i].instrument`) with `<kind> needs <key>, which is not sourced`. The page drops such programmes on load and never sends one.
5. **Scaling.** A baseline pool with no entry keeps its object. For one with entries, the entries cut time into runs from `asOf` (run 0 up to the day before the first entry, then one run from each entry's `from`, the last open). Arrivals always come from `inflowArrivals(inflow, lo, hi)` (the engine's own function, `lo` never below `asOf`, `hi` the run's last day or `LAST_DAY`), so the plan gets exactly the arrivals the engine would, and none before `asOf`.
   - A capped pool's `once` inflow becomes a `once` of `round(dollars × scale)` on its arrival day, dropped at 0. A `yearly` inflow becomes, per bounded run at a scale above 0, one `once` per arrival; for the open run, a `yearly` inflow restarted at `a`, the first arrival that falls on the inflow's own month and day (so a 29 February inflow never restarts from a 28 February), with earlier arrivals of the run as `once`s. New inflows are in day order.
   - An uncapped pool has no inflows; any scale above 0 leaves it on.
   - **Off spans** (below).
6. **Order.** Pools are the baseline's in dataset order, then the added ones in document order; programmes likewise; `off` is `base.off` then the new spans by baseline pool order and then `from`; `slope` is `base.slope`; `terms` is step 4's. Added pools pass as written (the engine's `inflowArrivals` clips an inflow dated before `asOf`). The result is a new object; `base` is never mutated.

### Off spans (F7)

For a stretch of a baseline pool's `baselineScale` entries at scale 0, `buildFinance` emits one `off` span `{ pool, from, to }`: `from` is the first zero entry's `from` (not clipped at `asOf`), `to` the day before the next entry above 0, or null. A capped pool's arrivals inside the span are scaled to 0 and dropped, so they are absent from `plan.finance` inflows; the engine and the score skip off days themselves as well. An uncapped pool keeps its object; only the span is emitted. Programme ids are never split or renamed.

The test that pins it is `'scale 0 then 1 on a capped pool: one off span, no arrival inside it'` in `src/lib/sim/levers/finance.spec.ts`. Its neighbours pin scale 0 to the end (`to: null`) and scale 0 on the uncapped federal pool.

## The twin and `bare()`

`bare()` in `apply.ts` keeps stripping only `newProjects` and `inFlightScale`; `market` and `finance` pass through `applyPolicies` and `bare()` unchanged, and a test asserts both survive `baseZoning` and `planOf` by identity with timers set. `twinInput` is unchanged in form: the `'preFzp'` twin is `bare(applyPolicies([baseZoning], base))`, carrying `base.finance`; the `'fzp'` twin is `planOf(base, ctx, DEFAULT_LEVERS, r)`, whose empty `finance` returns `base.finance` by identity (step 2). So both twins run the unscaled baseline on the sourced terms with no `off` span, under the same market, and the memo key stays (base, ctx, compare): the twin depends on the levers only through `compare`. Typed terms reach the plan only.

`compileLevers` keeps `compare: isDefaultPolicy(p) ? 'preFzp' : 'fzp'`; `funding` is part of the policy, so any scale entry, added pool or programme, or typed term makes it non-default and compares it with FZP as written on the baseline funding (a typed term alone changes the plan: `lossOnExit` applies to the baseline's grants too).

## The worker

`initScenario` and `setLevers` parse with `parseSimLevers`; a schema-2 or malformed `finance` is a `bad-request` with `levers <path>: <message>`. The baseline check runs where the baseline is known: `applyLevers` in `leverStep`. On a `LeverFormatError` (the only error it catches; any other ends the session as `internal`) `leverStep` sets `lw.pending = null`, posts `{ type: 'error', rev, code: 'bad-request', message: 'levers ' + message }`, and leaves `w.loaded`, `w.run` and the band as they were, so the previous revision stays in force. A session whose first revision fails runs nothing until the next `setLevers`: `LeverWork.inForce` is false until a revision becomes `current`, and the host picks no further job while it is.

What a failing revision has already done by then (guard paths the page never takes, so they are tested in the host only):

- Its `heights` post still goes out, because the city builds ahead of the recompute, and its limits replace `lw.limits`: the lid views, `lotAt` and `parcelSummary` follow the failing revision's limits, while the run, the band and the timelines stay on the previous revision.
- A `reroll` folded into a failing pending revision is dropped with it.

## The finance warm task

`financePreOf(input)` (per-input precompute, memoised on the input) is cold-expensive: roughly 85 to 140 ms. It used to run inside the first band task, which broke the 50 ms macrotask budget there. The host now runs it in a load-phase macrotask of its own, job kind `'warm'`: `warmOf(loaded)` lists the distinct inputs of `fzp` and `twin` that have a `finance` (none when `deps.warmFinance === false`, the test seam that shows warming changes no output), and each `'warm'` slice builds one input's `financePreOf` and its `marketSkip` and `affordableSkip` for the session's horizon. A non-lever session warms at load; a lever session warms after each lever `current` (the plan input is new then), before revision 0's runs. The warm slice has a slice of its own, as the shown run does.

Limits: the warm task itself can still exceed 50 ms (the cold precompute is roughly 85 to 140 ms); it moves the cost out of the band window, it does not remove it. Splitting `financePreOf` is `finance-engine`'s code. `tablesOf(fp)` is still built in the first funded run's task.

## The bench levers

Host bench cases 4 and 5 (`scenario.bench.spec.ts`, [finance-engine.md](finance-engine.md), "Performance") put the bench funding on the plan through `levers.finance`: `benchFundingLevers(asOf)` in `fixtures/bench-finance.ts` is `benchFunding(asOf)` with every pool and programme id prefixed `u-` (and programme `pool` references following), no baseline scale and no terms. The twin stays on the unscaled bench baseline (`compare: 'fzp'`). The host serves a `policy.bin` (decoded to `synthPolicy`: FZP as written) because levers need one.

## Tests

`finance.spec.ts` (parser tables, `buildFinance` steps, spans, leap days), `apply.spec.ts` (identity of `finance` and `market` through `baseZoning` and `planOf`, twins), `types.spec.ts`, `scenario-host.levers.spec.ts` and `scenario-host.finance.spec.ts` (the guard and the warm task). `maxFunding()` and `fundingOnly()` are in `src/lib/sim/levers/fixtures/finance.ts`; `maxFunding()` sits at every limit and `sim-doc.spec.ts` asserts it serialises under 32,768 bytes.
