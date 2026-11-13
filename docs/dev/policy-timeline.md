# Policies with dates

Schema 4 of the `/sim` policy: every policy has spans of days in which it is in force. A schema 4 document compiles to one `PolicyFrame` per model month for the step. Design: `docs/superpowers/specs/2026-11-13-policy-timeline-design.md` (rule numbers below are its rules). The levers each month's policies combine into are those of [sim-levers.md](sim-levers.md).

Release A builds all of this and switches none of it on: `/api/policies`, `/s/[id]`, `SIM_CODEC`, the page and the autosave key `sfhousing:sim:v1` still use schema 3.

## Files

| Where                            | What                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/lib/timeline/policy4.ts`    | Types, `DEFAULT_POLICY4`, `queriesOf4`, `spanAt`, `nothingInForce`                                                |
| `src/lib/timeline/parse4.ts`     | `parsePolicy4`, `checkSpanDays`                                                                                   |
| `src/lib/timeline/upgrade.ts`    | `upgradePolicy(p, asOf)`: schema 3 to 4                                                                           |
| `src/lib/timeline/reconcile4.ts` | `reconcilePolicy4(doc, cal, asOf)`, `Policy4Report`                                                               |
| `src/lib/timeline/sim-doc4.ts`   | `SimDoc4`, `parseSimDoc4`, `openSimDoc4`, `createSimCodec4`, `migrateSimAutosave`                                 |
| `src/lib/sim/world/months.ts`    | `monthFirstDay`, `monthLastDay`, `monthOfDay` (world-core owns it)                                                |
| `src/lib/sim/world/policy/`      | `combine`, `money`, `zoning-view`, `intern`, `compile`, `compare`, `lookups`; `frame.ts` (S4 to S6 types, frozen) |

All pure TypeScript, worker-safe. Under `src/lib/sim/world/` no `Math.exp`, `log`, `pow`, `log1p`, `expm1` or `**`. No hashed file changed.

## The document

`SimPolicy4 = { schema: 4, kinds: { zoning, permitting, money } }`, each kind a list of `Policy { id, label, preset, on, where, spans[] }`, `Span { from, to | null, what }`. `where` and `what` come in pairs, each carrying what its schema 3 field carries:

| Kind       | `where`                                       | `what`                              |
| ---------- | --------------------------------------------- | ----------------------------------- |
| zoning     | `transit` (stop types)                        | `bands`                             |
| zoning     | `painted`                                     | `brushes`                           |
| zoning     | `category` (rentControl, historic, newerThan) | `protect` (`years` for newerThan)   |
| permitting | `routes`                                      | `timing` (a `TimingSet`)            |
| money      | `baseline`                                    | `scales` (`{pool, from, scale}`)    |
| money      | `fund` (pool id)                              | `fund` (`pool` or null, programmes) |
| money      | `terms`                                       | `terms`                             |

Rules the parser enforces (`parsePolicy4`; errors are `PolicyFormatError` naming the path):

- Ids are unique across the document, added pools and programmes included; inside a policy every span names the same pool and programme ids. `label` at most 80 characters.
- Rule 4: `from` is the first day of a model month, `to` the last day of one, spans ascending and not overlapping, none on or before `asOf`. Month m covers `asOf + floor((m - 1) * 30.436875) + 1` to `asOf + floor(m * 30.436875)` (`months.ts`). `asOf: null` skips only the alignment checks.
- Rule 5: each `what` goes through its schema 3 parser, so nothing schema 3 rejects gets in. `FINANCE_LIMITS` apply to the union over the document. `MAX_PLAN_BYTES` applies to the canonical document.
- Rule 6: days inside a `what` (a baseline scale's `from`, a programme's `from` and `to`, inflow dates) are not spans and are not month starts. A span cuts them: one counts only while its policy is on and a span covers it.
- Rule 9: "nothing in force" (`nothingInForce`: no policy that is on has a span) is what the comparison and the page mean by the default. `DEFAULT_POLICY4` has three empty lists: the plan as adopted, observed permitting times, today's City funding.

`canonicalJson` of a document is its identity for saving.

## Opening and reconciling

`upgradePolicy(p, asOf)` applies the pairs table to a schema 3 policy: each policy gets one span, from month 1's first day with no end (rules 1, 2). The default schema 3 document upgrades to nothing in force. In memory only; publishing writes schema 4.

A schema 4 document saved on an earlier dataset has spans that no longer align with the one it opens on (rule 4 counts months from `asOf`). Opening therefore parses with `parsePolicy4(json, { asOf: null, presetLayer: 'reconcile' })`, then `reconcilePolicy4(doc, cal, asOf)`:

- Snaps every span to the model months of the dataset opened on: `from` to the first day of its month (clamped to month 1), a non-null `to` to the last day of its month. A span wholly before month 1, or emptied by the snap, is dropped. Nothing is merged: adjacent spans with equal `what` stay two. If snapping makes two spans of a policy overlap, the earlier span's `to` becomes the day before the later one's `from` (dropped if that empties it). Days inside a `what` are not snapped.
- Re-fits each permitting policy's preset layer to the calibration, drops scale entries and programmes that name a baseline pool the dataset lacks or need a term that is not sourced.
- Reports in `Policy4Report`: `timing` and `funding` in today's shapes (so today's notices work), `spans` (`policy`, `index` in the stored document, `change` moved/trimmed/dropped, `was`, `now`, null when dropped).

It never rejects a document. A document already aligned and clean comes back as the same object with empty lists; the compiler's "reconciled" check is `reconcilePolicy4(doc, cal, asOf).doc === doc`, and it throws `LeverFormatError` on anything else (the runner reports `bad-request`). Strict publish (`parseSimDoc4`) keeps rule 4's alignment checks against its `asOf`.

## How policies in force combine

`inForceAt(doc, day)` picks policies that are on with a span covering the day. Spans start on a month's first day and end on a month's last, so the policies in force are the same on every day of a month, and each month is built from its first day. `combine.ts` reduces them to today's undated lever shapes (`compileLevers`, `buildFinance`) with these rules:

- 10: each lot takes the highest zoning rule that names it.
- 11: inside a painted policy, today's order (later brush wins, an erase removes that policy's earlier paint only). Between painted policies, the lower in the list wins on a lot both name.
- 12: a protection is on when any policy in force turns it on; `newerThan` takes the largest `years`.
- 13: permitting timers with reach `all` multiply into `speed`, clamped per route and stage to `[MIN_SCALE, MAX_SCALE]`. A timer with reach `new`, in a span beginning on day d, is a `speedNew` entry `{ from: d, scale }` while that span is in force. The step clamps a project's product.
- 14: route shares come from the lowest policy in the list that sets them, else observed. The Local Program is streamlined unless some policy in force says otherwise. Route shares go into `newCalibration` (`routeSharesOp`); the Local Program switch lives in the zoning view (`view.parcels.localProgram`), not in `newCalibration`.
- 15: money (`money.ts`). `FinanceFrame.pools` and `programmes` hold one entry per id over the whole document (baseline first, then added in document order, policies off included so the arrays never shift), each with the definition in force that month. `offered[g]` is 1 when programme g is in force on the first day and its pool is not scaled to 0 that day. `arrivals` are the month's dated inflows after scaling, month 1 also holding those dated on `asOf`. `finance` is null when the calibration lacks `market` or `baselineFunding`; money policies then do nothing.

`lookupsAt(frame)` (`lookups.ts`) gives the stage tables for a frame as `lookupsOf` does: `speed` for rows in flight, `speed` times every `speedNew` for new projects, clamped. Memoised by frame id (8 entries).

## Compiling

`compileTimeline(doc, lots, ctx, base)` returns a `TimelineCompile` (`compile.ts`). `step(budgetMs)` compiles frames in month order and returns true when the window is done; `result()` works once month 1 exists and its `readyThrough()` grows.

`CompileCtx = { input, layers, windowMonths, yields: YieldSource, now? }`. `yields` gives the compiler the lot yields a changed zoning needs, as `createTableRecompute` or `createYieldRecompute` give them to `leverStep`; the host builds it from the gross table or the chunk records it holds. `now` is the clock that bounds a slice (default `performance.now`). `TimelineCompile.missingLots()` lists lots whose zoning changed and that have no yield record (yield 0, as today); the runner logs them. Also `progress()` (`done`, `total`, `failedCells`), `capacity()` and `unknownLots()` (the frame of the window's last month, once `step` returned true).

A zoning view is built per distinct zoning state (`zoning-view.ts`): `resolveEnvelopes`, the yield recompute of the needs, `fillNeeds`, `applyLevers`, then `precomputeOf`, in `leverStep`'s order. Under `base: 'preFzp'` it starts from the zoning before the plan, takes no zoning policy (it throws), and its `capacity()` is a new definition not meant to be shown.

### Frame identity and interning

Rule 16: a frame is a maximal run of months with equal content. `frameIdOf` (`intern.ts`) numbers a 128-bit MurmurHash3 digest of this key, for the worker's life, ids from 1:

- the built view's content digest (`viewDigest`: the columns `touchedRows` compares, as bytes; not the lever key, so two lever sets that build equal views share a frame);
- identity of the input and layers (`serialOf`, a per-object serial);
- the permitting key (route shares, `speed`, `speedNew`), the market shift, and the money key (what is on offer, `terms`, `slope`; not `arrivals`, so `frameAt(m)` returns the shared frame with month m's own arrivals).

A programme or pool not on offer is not part of the month's identity, so a fund opening in month m leaves earlier frames as they were. Views are interned by content in `VIEWS`, a weak cache: equal views from any compiles are one object while some timeline holds them; the id table is never cleared and a view lives only while a timeline in use refers to it.

Slicing: a unit (a recompute step, `applyLevers`, `precomputeOf`) runs whole, so `step(budgetMs)` can overrun by one unit; see the risks below.

`touched(m)` (`touchedRows`, memoised per view pair): for a month in `changes()`, the rows whose `envelopeStories`, `yield`, `hostable`, `localProgram`, `potentialRatio.fzp`, `storiesGap.fzp` or start rate (`pre.logit`) differ from the month before; empty when the view is the same object; null for month 1.

## The comparison

`firstDifference(a, b)` (`compare.ts`): the first month whose frames have different ids or different arrivals (compared as pool id, day, dollars), else null. If nothing differs over the months both have, but they are ready through different months, it returns the smaller `readyThrough()` plus one: a runner never keeps a month it has not compared.

`comparisonOf(doc)`: nothing in force gives `{ doc, base: 'preFzp' }` (today's `twinInput(..., 'preFzp')`); anything in force gives `{ doc: DEFAULT_POLICY4, base: 'plan' }`. Policies that are off do not change the answer.

## Saving and sharing

`SimDoc4 = { schema: 4, kind: 'sim', datasetVersion, title?, policy }` (`sim-doc4.ts`). `parseSimDoc4` (strict) takes schema 4 only: 2 and 3 are `unknown-schema`, newer is `future-schema`. `openSimDoc4(text, { asOf, calibration })` opens 2, 3 or 4 as a reconciled schema 4 document, with `upgradedFrom` and the `Policy4Report`. `createSimCodec4` is the `DocCodec`; `SIM_KEY4` is `sfhousing:sim:v2`, and `migrateSimAutosave` copies a v1 autosave to v2 as an upgraded document, leaving v1 alone and never touching an existing v2. The D1 table does not change. Nothing calls these yet.

## Tests

`parse4`, `policy4`, `upgrade`, `reconcile4`, `sim-doc4` specs under `src/lib/timeline/`; `combine`, `money`, `intern`, `zoning-view`, `compile`, `compare` specs under `src/lib/sim/world/policy/`, with fixtures in `policy/test/`. They assert behaviour, not time. The agreement test (schema 3 documents, upgraded and compiled, against today's `applyLevers(compileLevers(p))`) is `src/lib/sim/world/policy/roundtrip.spec.ts`.

The slice bar is `src/lib/sim/world/policy/compile.perf.spec.ts` (project perf, `npm run test:perf`, not signoff). On the bench city (`synthCity`, bench funding) a painted policy of 500 lots from month 1, a transit rule over 2,000 lots from month 61 and the bench funding compile over 480 months; every `step(20)` call is timed and the longest must be 50 ms or less (asserted), with a fixture check that more than one zoning state was built. A second case compiles one metro rule on a live dataset when `SFH_LIVE_DATASET` names a local copy of one (it skips with a logged reason otherwise) and reports the longest slice; it asserts only that the compile completes. `scripts/measure-policy-compile.ts <datasetDir>|--bench` prints the two edits below with `compileTimeline`.

## Measured cost of a compile

Live city (dataset 2026-11-08-3b7fa918, 155,020 parcels), Apple M5 Pro, medians of 5, load 1.8 to 2.0: **ballpark**. Production has no `baselineFunding` or market, so the money loop was run on the pipeline mini-golden baseline.

| Edit from month 1                                                          | First frame | All frames |
| -------------------------------------------------------------------------- | ----------- | ---------- |
| One added metro rule (6 stories at 402 m, 4 at 805 m; 39,202 lots changed) | ~4.4 s      | ~4.4 s     |
| 500 painted lots to 8 stories                                              | ~120 ms     | ~120 ms    |

An edit dated after month 1 reuses the default view for the earlier months (first frame 0). Almost all of the rule's time is the recompute (~4.25 s); resolving lots ~52 ms, `resolveEnvelopes` 14 ms, `precomputeOf` ~45 ms, row diff ~3 ms. The money loop is ~1.2 ms for 480 months.

### Measured again with `compileTimeline`

Same live dataset (2026-11-08-3b7fa918, 155,020 parcels, no gross table, no funding), medians of 5 after a warm-up, `scripts/measure-policy-compile.ts`. Load 2.7 to 3.6 (this operator's runs and another's): **ballpark**. Edit from month 1; lot resolution (55 ms for the metro rule) is included.

| Edit from month 1                                     | First frame | All frames | Longest `step(20)` |
| ----------------------------------------------------- | ----------- | ---------- | ------------------ |
| One added metro rule (6 stories at 402 m, 4 at 805 m) | ~4.7 s      | ~4.7 s     | ~97 to 99 ms       |
| 500 painted lots to 8 stories                         | ~132 ms     | ~132 ms    | ~50 to 60 ms       |

An edit's first frame is also its last: month 1 is the one frame that changes. Against Task 1's numbers (4.4 s, 120 ms; recompute step 93 ms and 20 ms) the compiler adds about 6 to 10 percent, which is the machine's load as much as the code.

On the bench city (`--bench`, no funding; scenario A is two nested bands over 40,000 and 20,000 lots): metro-like edit about 740 ms to the first and last frame, longest slice 35 to 54 ms; 500 painted lots about 68 ms, longest slice 44 to 49 ms. The perf spec's three-policy case (painted from month 1, transit from month 61, bench funding) finished in about 300 ms; its longest call was 43 to 61 ms over seven runs at load 2 to 2.7 (most under 50): ballpark, borderline, and the bar is unchanged.

### Known slice-bar risks

The 50 ms slice bar is not reliably met by two units (a slice runs a unit whole, and a call that begins with budget left can run `applyLevers` and `precomputeOf` back to back):

- `precomputeOf(plan)` is ~43 to 45 ms on the live city, uninterrupted; on the bench city a slice ending a view's build runs 43 to 60 ms. A state that needs its twin as well is ~86 ms. It sits behind the seam `precomputeView` in `zoning-view.ts`.
- The recompute's largest `step(20)` is ~97 ms for the live metro rule and ~50 to 60 ms for painted lots: it works a whole cell bucket at a time. It sits behind `recomputeStep`.

The live case reports these and does not assert them. A finer-sliced version can replace either seam without touching the compiler. ensemble-runner re-measures both on a quiet machine.
