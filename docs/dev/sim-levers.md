# /sim policy levers

The engine behind `/sim` (plan 2 of 5; FZP-only since the sim runs plan 1, Task 1, spec `docs/superpowers/specs/2026-10-31-sim-runs-design.md`). Source: `src/lib/sim/levers/`; protocol: `src/lib/sim/scenario/types.ts`. The plan (`docs/superpowers/plans/2026-10-29-sim-policy-engine.md`, "Rulings") holds the reasons in full. Everything here is worker-safe and pure except the worker session.

## The lever document

`SimLevers` (schema 2, `types.ts`) is a sibling of the editor's `Plan`, not new `PlanOp`s: levers are mostly static configuration, and rules and paint name lots by `ParcelId`, so the document survives row reordering. `parseSimLevers` validates it (hand-written guards; `LeverFormatError` names the first bad field). A schema-1 document fails on `schema`; the schema-1 fields (`stock`, `assumeAlternativePlanKept`, `user`) are unknown keys.

| Field                     | Default (`DEFAULT_LEVERS`)        | Meaning                                                                   |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `rules`                   | `[]`                              | `{lots, stories}`: each lot takes `max(FZP, N)`, uncapped where it raises |
| `paint`                   | `[]`                              | `{lots, stories}`: sets `N` uncapped, in document order (later wins)      |
| `protect`                 | none                              | `{rentControl, historic, newerThanYears}`                                 |
| `timers`                  | `[]`                              | `{pathway, stage, scale, reach: all/new}`; scale in [0.05, 10]            |
| `routeShares`             | `null` (observed `pathwayForNew`) | Pathway shares for new projects, normalised                               |
| `localProgramStreamlined` | `true`                            | Local Program lots forced onto streamlined                                |
| `compare`                 | `'preFzp'`                        | Twin: `'preFzp'` zoning, or `'fzp'` (FZP as written)                      |

Stories are integers from 0 to 255 (one byte in the packed columns). `DEFAULT_LEVERS` is FZP as written compared with pre-FZP zoning: under it `/sim` reproduces `/fzp`. Construction and completion are locked: no timer edits them. There is no stock blend, no current law and no law switch: the plan always starts from FZP as written (`fzpYieldCap`) for the whole window.

The page's `SimPolicy` (`src/lib/sim-page/policy.ts`, schema 2) compiles to these levers in `compileLevers`: its zoning rules become `rules` (a transit rule one edit per band), its custom paint becomes `paint` in stroke order (an erase removing earlier paint), its category protections `protect`, and `compare` is `'preFzp'` for the default policy and `'fzp'` for any other ([sim-page.md](sim-page.md), "The recipe and its compile rules").

## Resolution order

`resolveEnvelopes(ctx, levers, asOf)` (`resolve.ts`) builds the plan table from a copy of the FZP table (`stockTable(ctx, 'fzp')`), then:

1. **Rules.** For each lot the rules name, `n` is the highest rule; if `n` is above the lot's FZP stories, the lot gets `n` stories and no cap (`NULL_CAP`). A rule at or below FZP leaves the FZP row, cap included. Rules are order-free: only the maximum matters, so nothing depends on their order (transit bands included).
2. **Paint.** Each paint edit, in document order, sets its lots to `N` stories, uncapped, raising or lowering. A later stroke wins.
3. **Protections.** A protected lot is not redevelopable: it is reset to its FZP row with `hostable` 0 and makes no `Need` (see "Protections and the capacity metric").

The table keeps the allowed `N`; the generator builds at most the lot's physical max stories (`physicalMaxStories`, `src/lib/generator/physical.ts`), so a recomputed row's built height is min(allowed `N`, physical max), then the typology cascade. Recorded projects are not capped.

A touched row whose final `(stories, cap)` is its FZP row is left as it is; one at 0 stories hosts nothing. One that matches the lot's FZP or pre-FZP (`base`) row reuses that row's yields and `hostable`. Any other becomes a `Need` (`row:stories:cap`); `fillNeeds` writes the recomputed rows in. The SB 79 and current-law rows in `policy.bin` are not candidates: they follow other yield rules than `envelopeRow` (`sb79Yield` zeroes fill levels below `MIN_UNITS`, `hostableSb79` is `sb79Status = 'applies'`), so reusing them would give an uncapped edit yields a `Need` would not. `policy.bin`'s `currentStories` and `sb79*` columns stay in the data.

`Resolution` is `{ plan, unprotected, protectedRows, unknownLots }`, each table a `ResolvedTable { table, needs }`; `unprotected === plan` when no row is protected. `unknownLots` counts distinct ids named in `rules` and `paint` that are not in the dataset, with one shared set, so an id named in both counts once.

## Protections and the capacity metric

Protection works by category only (`rentControl`, `historic`, `newerThanYears`); `protectedRows` reads the categories from the dataset. A protected lot is **not redevelopable** (partner ruling 2026-10-29): it is reset to its FZP row (stories, cap and yields, discarding any rule or paint) with `hostable` 0, so no new project initiates there and it makes no `Need`. In-flight projects on a protected lot carry on, on the FZP envelope; protection gates only new initiation, through `hostable` (partner Call 21). Since `netCapacity` counts only hostable rows, `withoutProtections - plan` is the protected rows' unprotected capacity and is never negative. `leverCapacity` reports `{ plan, withoutProtections, protectedLots }`: static net capacity (sum over hostable lots of `max(0, full-fill yield - existing homes)`, the same measure as `policy.current.net_capacity`) for the plan with and without protections. Reason: "how much capacity the protections removed" is a capacity, and a third simulated twin would double the band cost.

## Timer reach

A timer's `reach` says who counts as new. The policy start date is `calibration.asOf` (the simulation has no earlier start).

- `'new'`: simulated projects, and pipeline rows whose current stage is `preApplication` (they have not filed).
- `'all'`: everything, including in-flight rows.
- Route shares apply to new projects only (already how `pathwayForNew` works).

`scaleTable(edits, 'inFlight')` multiplies the `'all'` edits; `'new'` multiplies every edit. Stacked edits on one pathway and stage multiply, and the product is **clamped to [0.05, 10]**.

## Rescale construction and bounds

`rescaleTransition` (`timers.ts`) stretches every cumulative-incidence column of a stage in time together, then fits the tail so the eventual shares from month 0 are exact ("spread kept, exit shares unchanged"), staying inside `parseCalibration`'s limits (K <= 240 months, C(K) <= 1 - 1e-6). `MIN_SCALE = 0.05` and `MAX_SCALE = 10` are numerical bounds only (at 0.05 every live and fixture table keeps C(K') <= 1 - 1e-6). Sourced physical floors are plan 4's.

## In-flight remaining-time rule

For an in-flight row in a rescaled stage, the engine samples the rescaled transition conditioned on `round(m * s)` months, then maps the draw back onto the real elapsed time. Conditioning on `m` in the rescaled curve would treat the project as `m / s` months old.

The speedup is **statistical, not per-row**. The redraw loop is unchanged, so a sped-up draw that lands on or before `asOf` takes a fresh independent draw. About 5% of near-term pairs (due within roughly 47 days) therefore leave later than in the base run, while the aggregate is faster. Do not assert a per-row "leaves no later".

## Route shares and Local Program forcing

`routeSharesOp` replaces `pathwayForNew` with the normalised shares (provenance kept; `null` is identity). `localProgramColumn(ctx, levers)` (`view.ts`) gives the Local Program column (partner Call 22): the decoded `parcels.localProgram` when `localProgramStreamlined` is set, so Local Program lots are forced onto streamlined, otherwise all zero, as in `baseZoning`.

## Twins and the references rule

`twinInput(base, ctx, compare)` builds the comparison run and never carries the plan's timers.

- `'preFzp'` (default): `baseZoning` on the base calibration.
- `'fzp'`: the plan of `DEFAULT_LEVERS` (FZP as written: no rules, paint, protections or timers) on the base calibration. It has no `Need`s (`twinInput` throws if it had), and its envelopes and runs are the base FZP input's.

Every lever field (`newProjects`, `inFlightScale`) is set explicitly, because `applyPolicies` copies the whole input. Twins are memoised on (base, ctx, compare), so lever documents that differ elsewhere share one twin (and its precompute). `applyLevers(base, ctx, levers, filled)` takes no horizon: nothing in the engine depends on one.

**References.** The existing `REFERENCES` (`score.ts`) are FZP-versus-pre-FZP estimates on `planEffect.*`, so they are all shown under `compare: 'preFzp'`. Under `compare: 'fzp'` only the `completedNet` ones are kept. RHNA targets come from `targetsOf`, unchanged.

## Protocol

Requests (`ScenarioRequest`): `initScenario` carries an optional `levers` (absent means `/fzp`, which never fetches `policy.bin`). `setLevers { rev, levers }` is a barrier rev like `reroll`, needs a session initialised with levers, and the latest one wins.

Responses (`LeversResponse`, `type: 'levers'`), where `rev` is the `initScenario` or `setLevers` that named the levers:

- `phase: 'resolving'` with `done`, `total`, `failedCells`: touched-lot yields are being recomputed in budgeted slices (`createYieldRecompute`). `failedCells` are needed chunks that failed to load; `retryChunks` re-wants them. Until complete the result is "out of date" (`leversPending`).
- `phase: 'current'` with `lookups` (`{ inFlight, fresh }`, each `{ chance, typicalMonths }`; `fresh === inFlight` when there is no `'new'` timer), `capacity` and `unknownLots`: the levers are in force, before any timeline computed on them. A superseded revision never gets `current`.
- `fog` (`FogGrid`, `src/lib/map/fog/grid.ts`; map overlays plan, Task 2): the revision's smoothed 50 m height-limit grid, built from the resolved stories at the revision's first step, before any yield recompute. It rides on the revision's first `resolving` (a copy) and on every `current` (`heightM.buffer` transferred), so a revision waiting on chunks, or held by a failed one, still shows its heights. A revision with no Needs posts no `resolving`, so its fog comes with `current`. FzpMode's `onfog` fires once per kept rev (the first fog it sees; both are the same grid), dropping messages below the latest rev sent as `leversMessage` does.

Brushes (plan 3): `resolveBrush { reqId, query }` answers `brushLots { reqId, result }` (`BrushLotsResult`: `{ ok: true, lots, points }` with `points` the lots' label points as lng/lat pairs, transferred; or `{ ok: false, reason }`), and `brushCatalog { reqId }` answers `brushCatalog { reqId, catalog }`.

- Only a session initialised with levers answers; otherwise `no-session` (catalog `null`). The router answers both itself outside scenario mode.
- A request that arrives before the load waits for it. When the session ends (a new `initScenario`, a failed load, `dispose`), every waiting request is answered `no-session`.
- The host validates each query (`brushQueryProblem`, `load.ts`): radii and `maxM` positive and finite, coordinates finite, kinds and stop types known; otherwise `bad-request`.
- `transit.json` (`transit`) and `neighborhoods.geojson` (`neighborhoods`) are fetched once per session, on the first request needing them (transit, area-with-neighborhoods; the catalog needs both). A missing manifest key, a failed fetch or a bad file gives `data-missing` for the queries needing it and `has.<file> = false` in the catalog. A missing key, a 4xx (not retried) or a bad file is cached for the session; a network error, 5xx or failed body read (after the session's retries) is not, so the next request needing the file fetches it again. `/fzp` never fetches them.
- The `LotIndex` is built once per session, on the base (as-loaded) parcels.
- The client resolves pending brush promises with `no-session` / `null` on crash, `restart` and `dispose`.

## Disapproval exception

The spec (`docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`, Goals 3) allows one
narrow exception to "the chances of advancing are shown, not editable": a preset that legally
removes the city's ability to deny a compliant project may set the **disapproved** exit to zero
for the projects it covers. "The builder first measures the disapproved share. If it is
negligible, drop the exception."

Measured with `npx tsx scripts/disapproval-share.ts <calibration.json>`
(`disapprovedShare` in `src/lib/sim/levers/timers.ts`): per pathway, the eventual share of new
projects that end disapproved, folding `eventualProbabilities(t, 0)` over the pathway's stages
after `preApplication`. The threshold is `DISAPPROVAL_NEGLIGIBLE = 0.01` (plan ruling 3).

Dataset `2026-10-29-0fd62c4d` (`scenarios/fzp/calibration.json`, live on staging):

| Pathway       | Disapproved share |
| ------------- | ----------------- |
| discretionary | 0.0082            |
| streamlined   | 0.0034            |
| permitOnly    | 0.0012            |

Every value is below 0.01.

Dataset `2026-10-29-0fd62c4d` (production and staging), 2026-10-30: re-measured for plan 4: still
negligible; no exception (0.0082 / 0.0034 / 0.0012; fixture-0 0 / 0 / 0).

**Decision:** the disapproval exception is dropped (spec: "If it is negligible, drop the
exception"). No lever or op is added; no exit column is editable. Re-measure if a future
calibration changes the disapproved columns.

## Performance

The touched-lot recompute (`src/lib/sim/levers/recompute.ts`) buckets its needs by cell. `step`
skips a whole bucket while its cell is not loaded (`cellLoaded`), so each need's record is read
once, not once per need per slice. A need whose cell is loaded but whose record is absent gets a
zero row (yield 0 at every fill level, not hostable) and is listed in `missing`; the host warns
once per lot (Call 19) and the revision still reaches `current`.

Measured with `npx tsx scripts/bench-levers.ts <datasetDir>` on dataset `2026-10-29-0fd62c4d`
(2026-10-30, Apple M5 Pro, 15 cores, 24 GB, Node v24.2.0). The script first runs every brush once
as a JIT warm-up, then measures each brush with a fresh lot index and an empty gross cache. Since
the sim runs plan 1 (Task 1) each brush is compiled to one zoning **rule** (`max(FZP, N)`,
uncapped where it raises); the table below was measured before that, on the schema-1 user edits
(brush (b) was a capped `set`), and has not been re-measured.

What it measures: for each brush, every needed chunk is loaded first, then the recompute runs as
one unsliced `step(Infinity)`. So "Recompute ms" is the compute cost of the touched-lot yields
only. It does not show the speed-up from bucketing (that is in the slice-to-slice rescans, which
one step never makes), nor the wall time to `current` on the page, which adds scheduler slices and
the chunk fetches.

"scenarioYield ms (est.)" replays every gross the recompute cached; "Other ms (est.)" is
"Recompute ms" minus that. Both are estimates: the replay runs without the recompute's
interleaving, so the split can be off in either direction. "Resolve ms" is `createLotIndex` +
`resolveBrushRows`.

| Brush                                                           | Lots    | Resolve ms | resolveEnvelopes ms | Needs (unique) | Cells | Chunk bytes | Recompute ms | scenarioYield ms (est.) | Other ms (est.) | Gross computed | Missing | fillNeeds + applyLevers ms |
| --------------------------------------------------------------- | ------- | ---------- | ------------------- | -------------- | ----- | ----------- | ------------ | ----------------------- | --------------- | -------------- | ------- | -------------------------- |
| (a) every `RH-1` family lot, raise to 4, limits off             | 72,992  | 17         | 35                  | 49,196         | 80    | 15.7 MB     | 3,362        | 3,317                   | 45              | 161,791        | 0       | 20                         |
| (b) `metro` and `rapidBus` within 1,609 m, set to 8 (limits on) | 149,736 | 120        | 51                  | 141,082        | 126   | 21.1 MB     | 22,660       | 22,496                  | 164             | 705,410        | 0       | 19                         |
| (c) `regionalRail` within 805 m, raise to 8 (limits off)        | 23,639  | 18         | 20                  | 21,190         | 44    | 7.3 MB      | 3,369        | 3,352                   | 17              | 105,890        | 0       | 10                         |

Row (b) was re-measured on 2026-11-01 for the transit-only brush (`npx tsx scripts/bench-levers.ts <datasetDir>`, dataset `2026-10-29-14e0eccb`, Node 24.2.0, Apple M5 Pro, rule to 8, limits as the script sets them); rows (a) and (c) are the earlier plan 3 run. Row (b) recomputes 141,082 needs in 22,660 ms, over the 20,000 ms gate set for brush (a) (the gate applies to (a)).

The gate (Call 20) was 20,000 ms for brush (a): it passes at 3,362 ms, so no per-lot yield-table
fallback is needed. By the estimate, `scenarioYield` is nearly all of the recompute's cost.

## The builder's calls

Rulings 1 to 3 of the plan, each with its reason.

- **Law switch (ruling 1):** retired by the sim runs plan 1: the engine is FZP-only, with no current law and no 2032 switch (Task 1 stopped producing one; Task 8 removed `SimInput.lawSwitch` and `Schedule.afterSwitch` from the engine).
- **207.11 null cap and height (ruling 2):** a lot with no density cap has unlimited density, meets any minimum, and fails ordinance condition (b)(8), so it never qualifies (`s207Envelope` takes a non-null cap; `s207Row` throws on an `applies` row with a null cap). The under-40 ft test reads `lpFt` on a Local Program lot and `baseFt` elsewhere (input `fzpHeightFt`), because every project on a Local Program lot uses the Local Program. No shipped row changes (V33 stays OK).
- **Sibling document, not `PlanOp`s (ruling 3):** see "The lever document".
- **Edit semantics (rules and paint, sim runs plan 1), protection (amended by the 2026-10-29 rulings), Local Program forcing, policy start, rescale, scale bounds, references, capacity metric, disapproval threshold (ruling 3):** each is stated with its reason in the sections above.

## Notes for plans 3 and 4

- **Plan 3, reroll while resolving.** Done in plan 3, Task 1. `levers` messages keep the `setLevers` rev across a reroll-while-resolving. Do not treat a `levers` message below the reroll barrier as stale: the worker's `current` still names the `setLevers` rev, and the client clears `leversPending` when `current.rev >= leversRev`. The page's lever status (`src/lib/sim-page/lever-status.ts`, `leversMessage`) keeps any message at or above the rev it sent and never consults the timeline barrier.
- **Plan 3, load failure.** Done in plan 3, Task 1. If the load fails after a `setLevers` sent before load, the error is posted at the `initScenario` rev, which is below `leversRev`. `ScenarioClient` now tracks the session's `initScenario` rev and clears `leversPending` on an error that ended the session; `leversError` likewise fails the page's lever status.
- **Plan 3, in-flight card chances under `'all'` timers.** Done in plan 3, Task 2. `ProjectCard` carries `lookups` (`'inFlight'` or `'fresh'`, the cohort's table) and `chanceShift`; for an in-flight project in a rescaled stage, `cardStatus` reads the chance at `inFlightMonths(m, s)` months, not `m` (see "In-flight remaining-time rule"). The map's bars read their cohort's lookups since plan 4 Call 15 (`Schedule.inFlight`, `slotCohort`, the 36-row chance texture; [fzp-mode.md](fzp-mode.md)), but are not shifted by `chanceShift`: an in-flight bar in a rescaled stage reads the in-flight table at `m` months.
- **Plan 4, timeline UI.** Done in plan 4 (Tasks 3 to 5; see [sim-timers.md](sim-timers.md)). Stacked timer edits are clamped to [0.05, 10] (`scaleTable`). The UI must show a clamped stacked edit as clamped, not silently limit it.
- **Performance.** Done in plan 3, Task 11: measured on real records, with the recompute bucketed by cell. See "Performance".
