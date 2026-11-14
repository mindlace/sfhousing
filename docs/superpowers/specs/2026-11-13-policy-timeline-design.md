# policy-timeline: policies with dates

Part of the step-engine package. Design: [2026-11-12-2305-sim-step-engine.md](../design/2026-11-12-2305-sim-step-engine.md), approved 2026-11-13. Release A. Depends on nothing in the package.

## Purpose

Today a `/sim` policy is one undated recipe (schema 3): zoning rules, painting, protections, a permitting timing set and funding levers. It is compiled to `SimLevers` and applied from the dataset date. This subsystem gives every policy dates. It defines the dated document (schema 4), opens old documents as new ones, and compiles a document into the month-by-month frames the step reads.

## Scope

- The schema 4 document: its types, its parser, its default, its canonical form, its limits.
- Opening a schema 3 (or 2) document as schema 4, and reconciling a stored document with the dataset it is opened on.
- Compiling a document into a `PolicyTimeline`, in slices.
- The comparison.
- The codec for saving and sharing the document (built here, switched on by `timeline-ui`).

Not in scope: the timeline's look and editing gestures (`timeline-ui`); resolving a brush query to lots (today's `resolveBrush`, unchanged; the page passes the lots in); the step (`world-core`).

The document's types and parser live in `src/lib/timeline/policy4.ts`, pure TypeScript with no Svelte and no DOM, so the server can use them. The compiler lives in `src/lib/sim/world/policy/`. Both import from `src/lib/sim/levers`, `src/lib/sim-page/policy.ts` and `src/lib/sim-page/timing.ts` and change no hashed file. `src/lib/sim-page` is not hashed: the builder may export `parseRule`, `parseCustom` and `parseTimingSet` from `sim-page/policy.ts`.

## Interfaces

**S10** (model commitment; owner `policy-timeline`). Policy document schema 4: `interface SimPolicy4 { schema: 4; kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] } }`, `interface Policy { id: string; label: string; preset: string | null; on: boolean; where: Selector; spans: { from: Day; to: Day | null; what: Effect }[] }`. `from` is the first day of a model month and `to` the last day of one (null = no end); spans of one policy do not overlap and are ascending. A policy that is `on: false` has no effect. `Selector` and `Effect` are tagged unions with one tag per lever that exists today; `policy-timeline`'s spec lists them. Order inside a kind's list is the order of the rows on the page and, for painted zoning and route shares, decides which wins. `function queriesOf4(doc: SimPolicy4): { key: string; query: BrushQuery }[]` lists the brush queries a document needs, keyed as today's `queryKey` keys them.

**S4** (model commitment; owner `policy-timeline`). `interface PolicyFrame { id: number; view: ZoningView; calibration: Calibration; newCalibration: Calibration; speed: StageScale; speedNew: { from: Day; scale: StageScale }[]; market: number; finance: FinanceFrame | null }`: everything the step reads for one month. `interface ZoningView { parcels: ScenarioParcels; pre: Precompute }` is the lot table and start rates under the zoning in force. `calibration` serves rows in flight, masters and phases; `newCalibration` (route shares, the Local Program switch) serves a project at the moment its route is drawn. A project's time in a stage is scaled by `speed` times every `speedNew[i].scale` whose `from` is before the day the project filed (or which finds it not yet filed), the product clamped to `[MIN_SCALE, MAX_SCALE]` of `levers/timers.ts`. `market` is the shift in the log-odds of starting. `id` is the same for two frames, from any compile in one worker, exactly when their content is equal, `finance.arrivals` apart.

**S5** (model commitment; owner `policy-timeline`). `interface FinanceFrame { pools: Pool[]; programmes: Programme[]; offered: Uint8Array; slope: number; terms: ResolvedTerms; arrivals: { pool: number; day: Day; dollars: number }[] }`. `pools` and `programmes` list the same ids in the same order in every frame of one timeline, and an entry's definition is the one in force that month; `offered[g]` is 1 when programme g is in force on the first day of this month and its pool is not switched off that day. `arrivals` is the money reaching each pool on a day of this month, and month 1's list also holds what arrives on the dataset date itself; the step reads inflows from it and never from `pools[q].inflows`.

**S6** (model commitment; owner `policy-timeline`). `interface PolicyTimeline { frameAt(month: number): PolicyFrame; changes(): number[]; touched(month: number): Int32Array | null; readyThrough(): number }`. `frameAt` is synchronous for 1 <= month <= `readyThrough()`. `changes()` lists, ascending, the months whose frame id differs from the month before. `touched(month)` gives, for a month in `changes()`, the lot rows whose row of the zoning view differs from the month before (empty when the zoning did not change; null when every lot may differ). `function firstDifference(a: PolicyTimeline, b: PolicyTimeline): number | null` is the first month at which the two give frames with different ids or different `finance.arrivals`, or null.

**S13** (decomposition choice; owner `policy-timeline`). `function compileTimeline(doc: SimPolicy4, lots: Record<string, ParcelId[]>, ctx: CompileCtx, base: 'plan' | 'preFzp'): TimelineCompile`, `interface TimelineCompile { step(budgetMs: number): boolean; progress(): { done: number; total: number; failedCells: string[] }; result(): PolicyTimeline; capacity(): LeverCapacity; unknownLots(): number; missingLots(): number }`. `missingLots()` counts the lots whose zoning changed and that have no yield record (they get a yield of 0, as today); the runner logs it as `leverStep` does today (`scenario-host.ts:966-970`; added 2026-11-13 by the conductor). `step` does at most about `budgetMs` of work and returns true when every frame is compiled; `result()` may be called once the first frame is ready and its `readyThrough()` grows as `step` is called. `capacity()` and `unknownLots()` are those of the frame in force in the last month of the window and are valid once `step` has returned true. `function comparisonOf(doc: SimPolicy4): { doc: SimPolicy4; base: 'plan' | 'preFzp' }` gives what the comparison ensemble runs: for a document with no policy in force in any month, the same document on the zoning before the plan (`base: 'preFzp'`, today's `twinInput(…, 'preFzp')`); for any other, the default document on the plan (today's rule, `sim-page/policy.ts:571`, `levers/apply.ts:91-110`). `interface CompileCtx { input: SimInput; layers: LayerCtx; windowMonths: number; yields: YieldSource; now?: () => number }` is the worker's loaded dataset. `interface YieldSource { recompute(parcels: ScenarioParcels, needs: Needs): YieldRecompute; failedCells(): readonly string[] }` gives the compiler the lot yields a changed zoning needs, as today's `createTableRecompute` or `createYieldRecompute` (`levers/recompute.ts`) give them to `leverStep`; the host builds it from the gross table or the chunk records it already holds (amended 2026-11-13 by the conductor, decomposition choice). `now` is the clock that bounds a slice (default `performance.now`). `function lookupsAt(frame: PolicyFrame): LeverLookups` gives the stage tables the map's bars and the cards read for that frame, computed as today's `lookupsOf` computes them, with `speed` for rows in flight and `speed` times every `speedNew` for new projects. `function newScale(frame: PolicyFrame): StageScale` gives the scale a new project runs at in that frame. `function limitsAt(frame: PolicyFrame, row: number): FrameLimits` and `function limitsOf(frame: PolicyFrame, parcelId: ParcelId): FrameLimits | null` give which policy sets a lot's story limit under the zoning in force in that frame, as today's `limitSources` and `ownerOf` do (`levers/source.ts`): `interface FrameLimits { owner: PolicyLimitOwner; protected: boolean }`, `type PolicyLimitOwner = { kind: 'fzp' } | { kind: 'paint'; policy: string } | { kind: 'rule'; ruleId: string; policy: string }`. The caller passes the frame object it got from `frameAt` of the timeline in use; attribution belongs to the compile, not to the frame's id (the three added 2026-11-13 by the conductor for the project card). `function cityInputAt(frame: PolicyFrame): FrameCityInput` with `interface FrameCityInput { readonly stories: Uint8Array; readonly countable: Uint8Array; readonly sources: LimitSources }` gives the city inputs the host needs for `heights` and `heightLids` under that frame's zoning (the unfilled envelope stories, the countable mask and the limit sources, as today's host builds them); keyed on the frame object like `limitsAt` (a frame no compile handed out throws); the arrays are shared and must not be mutated or transferred (added 2026-11-13 by the conductor).

## The document

`Selector` and `Effect` come in pairs. Each pair below carries exactly what its schema 3 field carries today.

| Kind | `where` | `what` | From schema 3 |
| --- | --- | --- | --- |
| zoning | `{ tag: 'transit'; stopTypes: StopType[] }` | `{ tag: 'bands'; bands: TransitBand[] }` | one policy per `rules[i]` |
| zoning | `{ tag: 'painted' }` | `{ tag: 'brushes'; brushes: CustomBrush[] }` | one policy holding the whole `custom` list, when it is not empty |
| zoning | `{ tag: 'category'; category: 'rentControl' \| 'historic' \| 'newerThan' }` | `{ tag: 'protect'; years: number \| null }` | one policy per protection that is on; `years` only for `newerThan` |
| permitting | `{ tag: 'routes' }` | `{ tag: 'timing'; set: TimingSet }` | one policy from `timing.current`; a second, `on: false`, from `timing.saved` when there is one (its label is the saved label) |
| money | `{ tag: 'baseline' }` | `{ tag: 'scales'; entries: { pool: string; from: Day; scale: number }[] }` | one policy holding `funding.baselineScale` unchanged, when it is not empty |
| money | `{ tag: 'fund'; pool: string }` | `{ tag: 'fund'; pool: Pool \| null; programmes: Programme[] }` | one policy per added pool with its programmes (`pool` set), and one per baseline pool that has added programmes (`pool: null`) |
| money | `{ tag: 'terms' }` | `{ tag: 'terms'; terms: Partial<Record<TermKey, number>> }` | one policy when `funding.terms` is not empty |

Rules of the document:

1. `preset` is the timing preset id for a permitting policy and null for every other policy (today's funding levers record no preset).
2. A policy made from schema 3 has one span, from the day after the dataset date with no end.
3. Ids are unique across the document: policy ids, and also the ids of added pools and of added programmes across `fund` policies. Inside one policy, every span names the same pool and programme ids (a later span may change their settings, not their ids). `label` is at most 80 characters.
4. A span's `from` is the first day of a model month and its `to` the last day of one. The parser rejects any other day, a span before the dataset date's next day, overlapping spans, and spans out of order. Model month m covers days `asOf + floor((m - 1) × 30.436875) + 1` to `asOf + floor(m × 30.436875)`.
5. Every `what` is checked by the parser that checks its schema 3 field today (`parseRule`, `parseCustom`, `parseTimingSet`, `parseFinanceLevers`), so nothing a schema 3 document rejects is accepted here. Today's `FINANCE_LIMITS` (added pools, inflows a pool, added programmes, scale entries) apply to the whole document's union, not to each policy. `MAX_PLAN_BYTES` applies to the canonical document, with today's `too-large` path.
6. Days inside a `what` keep their own meaning and are not month starts (design ruling T15): a baseline scale entry applies from its `from` (from the dataset date if earlier), exactly as `buildFinance` treats it today; a programme's own `from` and `to`, and a pool's inflow dates, likewise. Spans cut them: an entry, a programme or an inflow counts only on days inside a span of its policy while the policy is on.
7. A programme is offered in a month when rule 6 holds for the month's first day and its pool is not switched off that day (a scale of 0 in force that day).
8. The default document has empty lists in all three kinds. It means: the plan as adopted, observed permitting times, today's City funding. The page draws those three as fixed rows; they are not in the document.
9. `canonicalJson` of a document is its identity for saving and sharing. "Nothing in force" (no policy that is on has a span) is what the comparison and the page mean by "the default".

Opening an old document: `upgradePolicy(p: SimPolicy, asOf: Day): SimPolicy4` applies the table. It is done in memory on load, as schema 2 is opened as schema 3 today; publishing always writes schema 4. A schema 2 document is first opened as schema 3 by today's parser.

Reconciling: `reconcilePolicy4(doc, cal): { doc: SimPolicy4; report: … }` does for a stored schema 4 document what `reconcileTiming` and `reconcileFunding` do for schema 3 today: re-fits each permitting policy's preset layer to the calibration, drops scale entries and programmes that name a baseline pool the dataset lacks or need a term that is not sourced, and reports what it changed in today's report shapes, so today's notices can be shown. It never rejects a document. The compiler is only ever given a reconciled document; given anything else it throws `LeverFormatError`, which the runner reports as `bad-request`.

## How policies in force combine

For one month, the policies in force are those that are `on` with a span covering the month's first day. They combine into one undated `SimLevers` exactly as a schema 3 document does today (`compileLevers`, `sim-page/policy.ts:561-574`), with these rules for what schema 3 could not express:

10. Zoning rules: each lot takes the highest rule that names it, as today.
11. Painted policies: inside one policy, today's order (a later brush wins, an erase removes earlier paint of that policy only). Between painted policies in force, the lower in the list wins on a lot both name (design ruling T5).
12. Protections: a protection is on when any policy in force turns it on; `newerThan` takes the largest `years` among them, which protects every building any of them protects.
13. Permitting timers: each policy's set keeps its own floors, as `resolvePreset` gives them today. Across the policies in force, timers with reach `all` multiply into `speed`, clamped per route and stage to `[MIN_SCALE, MAX_SCALE]` as `scaleTable` does. Each timer with reach `new`, in a span that begins on day d, becomes a `speedNew` entry `{ from: d, scale }` for as long as that span is in force. The step clamps a project's product (S4).
14. Route shares come from the lowest policy in the list, among those in force, that sets them, else observed. The Local Program is streamlined unless some policy in force says it is not. Both go into `newCalibration` as `routeSharesOp` and the law switch do today.
15. Money: the scale entries, added pools and programmes, and terms in force build `SimInput.finance` as `buildFinance` does today (`levers/finance.ts:370-412`). `FinanceFrame.pools` and `programmes` hold one entry per id over the whole document, in a fixed order (baseline first, then added, in document order), each with the definition in force that month (the last one in force, for a month in which it is not offered); `offered` is rule 7; `terms` and `slope` are the month's; `arrivals` is the month's dated inflows after scaling (`inflowArrivals`' rule: once, or yearly on the same month and day), with month 1 also holding those dated on the dataset date. Frames have `finance: null` when the calibration lacks `market` or `baselineFunding`, as `buildSimInput` decides today; money policies then have no effect.

## Compiling

16. A frame is a maximal run of months with the same content: the same zoning state, calibrations, `speed`, `speedNew`, `market`, and the same money in force: the ids and definitions of the programmes on offer, the ids and definitions (other than inflows) of the pools they draw on, `terms` and `slope`. A programme or pool that is not on offer that month is not part of the month's identity, so a fund that opens in month m leaves every earlier frame as it was. `arrivals` differ month to month and are not part of a frame's identity; `frameAt(m)` returns the frame with month m's `arrivals`.
17. Frame ids and zoning views are interned by content for the life of the worker: two frames of equal content, from any two compiles, have the same `id` and, while both timelines are alive, share the same `view`. This is what lets an edit dated 2040 leave every earlier month's frame untouched. The table of ids lives as long as the worker; a view is kept only while a timeline in use (the plan's, the comparison's, or a compile in progress) refers to it, so a long session of edits does not grow the heap.
18. For each distinct zoning state (the zoning policies in force and their `what`, with their lots), `compileTimeline` resolves envelopes and recomputes the touched lots with today's code (`resolveEnvelopes`, `createYieldRecompute`, `applyLevers`), giving one `ZoningView`. With `base: 'preFzp'` the starting table is the zoning before the plan (`baseZoning`, `scenario/policy.ts:23`, as `twinInput(…, 'preFzp')`).
19. `step(budgetMs)` never runs longer than about `budgetMs` plus one lot-cell's recompute. Frames are compiled in month order; `result()` may be called once month 1's frame exists, and `readyThrough()` is the last month whose frame exists. `progress()` reports the cells resolved, as today's `levers` `resolving` phase does.
20. `touched(m)` is the lots whose `parcels` row or start rate differs between the views of months m - 1 and m, found when the second view is built.
21. `market` is the dataset's market shift for the month (`SimInput.market`; one step at the dataset date today).
22. `comparisonOf(doc)`: when nothing is in force (rule 9), `{ doc, base: 'preFzp' }`; otherwise `{ doc: the default document, base: 'plan' }`. The comparison never has permitting or money policies beyond today's defaults.
23. `capacity()` and `unknownLots()` are `leverCapacity` and the unknown-lot count for the frame of the last month of the window (design ruling T14).
24. First task: on the live city (when a local copy is present, else the bench city, marked so), measure the compile of one added transit rule and of one painted policy of 500 lots: time to the first frame, time to all frames. Report to the conductor. This is the wait a person sees after an edit.

## Saving and sharing

Release A builds and tests rules 25 and 26 as a second codec beside the schema 3 one, without switching anything a user can reach. `timeline-ui` switches the page, the autosave key and the `/api/policies` parser in Release B.

25. The schema 4 `SimDoc` is `{ schema: 4; kind: 'sim'; datasetVersion; title?; policy: SimPolicy4 }`. Its strict parser accepts schema 4 only and refuses 2 and 3 with today's kind of message; its reconcile parser opens 2 and 3 through `upgradePolicy`, reports `upgradedFrom`, and runs `reconcilePolicy4`. The D1 table does not change. The autosave key is `sfhousing:sim:v2`; a document found under the old key is opened and re-saved under the new one.
26. `/s/<id>` links made before the switch keep opening, with today's "upgraded" notice path.

## Tests that must pass

Assert, in signoff:

- Round trip: for a set of schema 3 documents (the default, each preset, a document with rules, paint, erase, protections, custom timers with reach `all` and `new`, route shares, baseline scales including one dated before the dataset date and one of 0, added pools and programmes, typed terms), the frames of `compileTimeline(upgradePolicy(p), …, 'plan')` reproduce what `applyLevers(compileLevers(p))` gives today: the same `parcels` columns; the same calibrations; `speed` equal to today's `inFlightScale`, and `speed` times the `speedNew` entry, clamped, equal to today's `newProjects.scale`; `buildFinance`'s pools, programmes and terms; `offered` equal to `isOffered` on each month's first day; and each month's `arrivals` equal to `inflowArrivals` over that month's days.
- A policy with two spans gives three frames (before, between settings, after) and `changes()` lists their first months.
- Rule 17: compiling a document, then an edit of it dated month m, gives the same frame ids for every month before m; `firstDifference` is m. An edit that raises one inflow dated in month m gives `firstDifference` m; so does adding a fund whose span begins in month m, and changing a programme's setting in a span that begins in month m. An edit that changes only a label, or a policy that is off, gives null.
- `touched` for an added paint policy is exactly the lots whose row changed.
- Rules 11, 12, 13 and 14 each have a hand-built case.
- The parser rejects every case in rules 3 to 5 and names the field.
- `comparisonOf`: nothing in force gives `preFzp` and frames equal to `twinInput(…, 'preFzp')`; anything in force gives the default on the plan; adding a policy that is off does not change the answer.
- `reconcilePolicy4` drops a programme naming an unknown baseline pool and reports it; the compiler throws on the unreconciled document.
- Strict publish refuses schema 3; reconcile opens it; a stored schema 3 body loads.
- A calibration without `baselineFunding` gives `finance: null` in every frame.

`test:perf`: a compile `step(20)` on the bench city never exceeds 50 ms.

Docs: a "Policies with dates" section in `docs/dev/step-engine.md`; `docs/dev/sim-levers.md` gains a pointer to it.

## Left to the builder

- The compiler's memo keys.
- File layout inside the two folders.
- The exact wording of parser errors.

Decided here, not left: the table of pairs, the document's limits (rules 3 to 5), how days inside a setting meet spans (rule 6), how policies in force combine (rules 10 to 15), what a frame's identity covers and that ids are interned by content (rules 16 and 17), the comparison (rule 22), which month capacity describes (rule 23), and the storage rules (25 and 26).

## Global constraints

- The calibration file, the dataset and the pipeline do not change. No file under the folders hashed into the dataset version (`pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard`) is added, changed or removed in Release A. In Release B the one exception is `src/lib/sim/scenario/scenario-host.ts`, which `ensemble-runner` may change or move so that the new host can use the dataset it loads, without changing any result of the old engine; that branch then follows "Finishing a branch that changes the dataset" in `docs/dev/pipeline.md`. New code imports from the hashed folders. A builder who finds any other change necessary stops and reports.
- The step and everything it calls may read the policy of the month being stepped and of earlier months, never of a later one.
- Agreement with today's engine (OD-2). Without public money and under one frame: for every seed tested, `scheduleAt` and `masterAt` over every row at the horizon day equal `simulateDetailed`'s schedules and masters, and each world's calendar-month series equals `shownSeries`. With public money, over seeds 1 to 200 on the bench city and on the live city with baseline funding, at years 5, 10, 20 and 40: the mean of completed net homes within 1% of today's mean, its standard deviation within 15% of today's, and the mean number of awards and of funded homes within 3%. The ledger identities hold after every step in every world. A miss is reported with its numbers; no rule is changed to meet it.
- `exp` and `log` only from `src/lib/timelapse/math.ts`. `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` and the `**` operator are never used under `src/lib/sim/world/`, and the determinism ESLint rule's `files` gains `src/lib/sim/world/**` (`world-core` adds it; `eslint.config.js` is not hashed).
- The same inputs give the same world, in Node and in the browser.
- No slice of worker work longer than 50 ms.
- `step`, the world and every function they call take no horizon, read no end date and keep nothing laid out to one. Only the runner and the page hold the window.
- One month for every world of both ensembles, scoring included, on the live city: at most 9 ms on the reference machine. (Playback at its fastest covers 36 months a second; the forecast must fill at least three times faster.) The spike measured 0.31 ms for 48 worlds without public money; the funded path is unmeasured, and `world-funding` measures it first.
- No user setting may decide directly how much gets built (levers spec anti-goal, kept).
- A lever that changes only timing never changes any project's outcome, and moves its days in one direction (paired-draw fix, kept). This holds exactly without public money. With public money a timer can still change which applications are awarded and when, because releases and repayments fall on stage days; that is an effect of the money and is not to be "fixed".
- Tests that run in signoff assert behaviour and order, never wall-clock time. Every timing bar lives in `test:perf`.
- WCAG 2.2 AA for the timeline, including keyboard control of every bar.
- Explanation waits for interest (OD-12). At rest the page shows numbers, short labels and controls. Sentences that explain a number, a caveat or a method appear only when the reader points at, focuses or taps the thing they explain. What appears on pointing also appears on keyboard focus and on tap, stays while pointed at, and can be dismissed (WCAG 1.4.13). An explanation is itself short: it says what the reader cannot infer and stops (partner, 2026-11-13: "A forecast if nothing changes" is sufficiently unambiguous; "if you can infer it don't belabor it"). No new standing paragraph is added to `/sim`, and the specs for `timeline-ui` and `world-score` list each text they carry over from today's page with where it goes.
