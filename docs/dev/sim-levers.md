# /sim policy levers

The engine behind `/sim` (plan 2 of 5; FZP-only since the sim runs plan 1, Task 1, spec `docs/superpowers/specs/2026-10-31-sim-runs-design.md`). Source: `src/lib/sim/levers/`; protocol: `src/lib/sim/scenario/types.ts`. The plan (`docs/superpowers/plans/2026-10-29-sim-policy-engine.md`, "Rulings") holds the reasons in full. Everything here is worker-safe and pure except the worker session.

## The lever document

`SimLevers` (schema 3, `types.ts`) is a sibling of the editor's `Plan`, not new `PlanOp`s: levers are mostly static configuration, and rules and paint name lots by `ParcelId`, so the document survives row reordering. `parseSimLevers` validates it (hand-written guards; `LeverFormatError` names the first bad field). A schema-1 or schema-2 document fails on `schema` (`expected 3, got 2`); lever documents are never stored, and the page and worker ship in one bundle, so no lever loader exists. The schema-1 fields (`stock`, `assumeAlternativePlanKept`, `user`) are unknown keys.

| Field                     | Default (`DEFAULT_LEVERS`)        | Meaning                                                                   |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `rules`                   | `[]`                              | `{lots, stories}`: each lot takes `max(FZP, N)`, uncapped where it raises |
| `paint`                   | `[]`                              | `{lots, stories}`: sets `N` uncapped, in document order (later wins)      |
| `protect`                 | none                              | `{rentControl, historic, newerThanYears}`                                 |
| `timers`                  | `[]`                              | `{pathway, stage, scale, reach: all/new}`; scale in [0.05, 10]            |
| `routeShares`             | `null` (observed `pathwayForNew`) | Pathway shares for new projects, normalised                               |
| `localProgramStreamlined` | `true`                            | Local Program lots forced onto streamlined                                |
| `compare`                 | `'preFzp'`                        | Twin: `'preFzp'` zoning, or `'fzp'` (FZP as written)                      |
| `finance`                 | empty `FinanceLevers`             | Funding levers: baseline scale, added pools and programmes, typed terms   |

Stories are integers from 0 to 255 (one byte in the packed columns). `DEFAULT_LEVERS` is FZP as written compared with pre-FZP zoning: under it `/sim` reproduces `/fzp`. Construction and completion are locked: no timer edits them. There is no stock blend, no current law and no law switch: the plan always starts from FZP as written (`fzpYieldCap`) for the whole window.

The page's `SimPolicy` (`src/lib/sim-page/policy.ts`, schema 3) compiles to these levers in `compileLevers`: its zoning rules become `rules` (a transit rule one edit per band), its custom paint becomes `paint` in stroke order (an erase removing earlier paint), its category protections `protect`, its `funding` is copied into `finance`, and `compare` is `'preFzp'` for the default policy and `'fzp'` for any other ([sim-page.md](sim-page.md), "The recipe and its compile rules").

Dated policies (schema 4) compile to these levers month by month: see [policy-timeline.md](policy-timeline.md).

## Funding levers

`SimLevers.finance` is a `FinanceLevers` (`{ baselineScale, pools, programmes, terms }`, `finance.ts`). The full rules are in [finance-levers.md](finance-levers.md); in brief:

- **Parse.** `parseFinanceLevers` throws `LeverFormatError` on the first bad field. Pool checks are shared with the dataset through `checkPool` (`src/lib/timelapse/model.ts`); an added programme is checked by `validateInstrument` and its own rules, not `checkProgramme`. Limits: 12 added pools, 12 inflows a pool, 24 added programmes, 24 scale entries (`FINANCE_LIMITS`).
- **Ids.** Every id matches `^[a-z0-9][a-z0-9-]{0,39}$`; an added pool or programme id starts `u-`, a baseline id never does, so a scale entry names a baseline pool and a programme's `u-` pool must be an added one.
- **Typed `terms`** are any of the five market terms, each bounded by `resolveTerms`' input range (the parser calls it with that key alone). A term an instrument needs but nothing sources is not a parse error: it is dropped on load, refused on publish, and guarded in `buildFinance`.
- **`buildFinance(base, f, asOf)`**, called by `planOf`: no model returns undefined; empty levers return `base` itself; the id check against the baseline; resolved terms and the missing-term guard; scaling with `inflowArrivals` windows (a capped pool's inflows rebuilt per run, never before `asOf`); one `off` span per stretch of scale-0 entries; then baseline pools, added pools, programmes and spans in order.
- **The twin and `bare()`.** `market` and `finance` pass through `applyPolicies` and `bare()`; both twins run the unscaled baseline on the sourced terms, so typed terms and scales reach the plan only.
- **The worker.** A baseline-id failure in `leverStep` is a `bad-request` (`levers <path>: <message>`) on that revision's rev; the previous revision stays in force.

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

## Timers scale time, never outcomes

The plan runs on the unscaled calibration: `applyLevers` passes timers to the engine only as scales (`inFlightScale` for in-flight rows, the `'all'` timers; `newProjects.scale` for new projects, every timer). The engine samples every stage from the unscaled transition: the kind from `P.STAGE` (`sampleKind`), the time from `P.STAGE_TIME` (`sampleTime`), and multiplies the time in stage by s (`scaledTransition`, `engine.ts`). In flight, the kind is conditioned on the exact days survived at `asOf`, and only the remaining time is scaled. So a timing-only lever never changes an outcome, and every event moves monotonically, **per row**: a faster stage never makes a project leave later or end differently. `pairing.spec.ts` checks this on every row of the mini city, pipeline and simulated (`sim:<parcel>:<k>` ids match across runs, since the initiation draws are untouched). One row-level difference is allowed: a simulated project can start before the horizon in the plan only, because a faster stage freed its lot earlier and a lot's risk starts at its release (`simulatedPass`, `engine.ts`).

`rescaleTransition` is the display view: `lookupsOf` builds each cohort's chance and typical-months tables from its calibration rescaled by its own scale (`timersOp`), and the typical months, timeline and card read them. The engine never reads them. The display view agrees with the engine within the month grid: the engine floors s·d on whole days, so a month boundary moves by at most s + 1 days (`display-engine.spec.ts`).

One measure is not monotone per month: `completedNet` subtracts a project's existing homes when it enters construction (`addNet`, `score.ts`). A faster stage brings the demolition forward with the completion, so between the plan's construction entry and the twin's, plan − twin is −existingUnits. Completions alone never fall behind, and the test allows a `completedNet` shortfall only up to the existing homes of the rows whose construction entry came earlier.

## Route shares and Local Program forcing

`routeSharesOp` replaces `pathwayForNew` with the normalised shares (provenance kept; `null` is identity). `localProgramColumn(ctx, levers)` (`view.ts`) gives the Local Program column (partner Call 22): the decoded `parcels.localProgram` when `localProgramStreamlined` is set, so Local Program lots are forced onto streamlined, otherwise all zero, as in `baseZoning`.

## Twins and the references rule

`twinInput(base, ctx, compare)` builds the comparison run and never carries the plan's timers.

- `'preFzp'` (default): `baseZoning` on the base calibration.
- `'fzp'`: the plan of `DEFAULT_LEVERS` (FZP as written: no rules, paint, protections or timers) on the base calibration. It has no `Need`s (`twinInput` throws if it had), and its envelopes and runs are the base FZP input's.

`bare()` and both twins keep `market` (and `finance`): the market is the world, not the policy, so the plan and its twin run on the same market ([market.md](market.md)). `bare()` strips only `newProjects` and `inFlightScale`. `finance` and `market` pass through every `PolicyOp` and `bare()` unchanged; what the engine does with `finance` is in [finance-engine.md](finance-engine.md).

Every lever field (`newProjects`, `inFlightScale`) is set explicitly, because `applyPolicies` copies the whole input. Twins are memoised on (base, ctx, compare), so lever documents that differ elsewhere share one twin (and its precompute). `applyLevers(base, ctx, levers, filled)` takes no horizon: nothing in the engine depends on one.

**References.** The existing `REFERENCES` (`score.ts`) are FZP-versus-pre-FZP estimates on `planEffect.*`, so they are all shown under `compare: 'preFzp'`. Under `compare: 'fzp'` only the `completedNet` ones are kept. RHNA targets come from `targetsOf`, unchanged.

## Protocol

Requests (`ScenarioRequest`): `initScenario` carries an optional `levers` (absent means `/fzp`, which never fetches `policy.bin`). `setLevers { rev, levers }` is a barrier rev like `reroll`, needs a session initialised with levers, and the latest one wins.

`initScenario.awaitLevers` (optional boolean, valid only with `levers`: otherwise `bad-request` `'awaitLevers needs levers'`, or `'awaitLevers must be a boolean'`) opens a session whose real levers are still being resolved, such as `/s/<id>`, which must resolve its brushes before it can send them. The host loads as usual but runs no revision from the init levers: no city, no recompute, no shown run, no band runs. The first `setLevers`, sent before or after the load finishes, is the session's first revision.

- Until that revision is `current` the host posts only `ready`, `error` and request answers (`brushLots`, `brushCatalog`, `lotAt`, `heightLids`, `lotOutlines`, `parcelSummary`, `previewBuildings`). Nothing goes out at the init rev except `ready`: no `levers`, `heights` or `timeline`, and no `chunks` report before the `setLevers`. After the `setLevers`, its revision posts as any other does: `heights`, then `current`, and on the fallback (no `gross.bin`) `resolving` and the `chunks` reports of the cells it needs.
- `prefetch` is held: it stores the latest bbox and fetches nothing. The first `current` replays that bbox, and from then on `prefetch` works as usual.
- A `reroll` while waiting posts nothing; its seed becomes the seed of the first revision's run.
- `heightLids` waits for limits, which the first revision builds; `lotAt` answers with a null `owner` until then.

Responses (`LeversResponse`, `type: 'levers'`), where `rev` is the `initScenario` or `setLevers` that named the levers:

- `phase: 'resolving'` with `done`, `total`, `failedCells`: posted only on the fallback, a dataset whose manifest has no `scenarios.fzp.gross`. Touched-lot yields are being recomputed in budgeted slices (`createYieldRecompute`). `failedCells` are needed chunks that failed to load; `retryChunks` re-wants them. Until complete the result is "out of date" (`leversPending`). With `scenarios.fzp.gross` the session loads `gross.bin` with `policy.bin` (a bad or mismatched table fails the load as `scenario-invalid`) and resolves each revision from it (`createTableRecompute`): the city builds first, then the lookups finish in the next `recompute` job, with no `resolving` post and no chunk fetch: the revision posts `heights`, then `current`.
- `phase: 'current'` with `lookups` (`{ inFlight, fresh }`, each `{ chance, typicalMonths }`; `fresh === inFlight` when there is no `'new'` timer), `capacity` and `unknownLots`: the levers are in force, before any timeline computed on them. A superseded revision never gets `current`.

Height limits (height-lids plan, Task 8; `src/lib/map/height/`):

- `heights { rev, city }` (`HeightCity`): the revision's city-wide height regions and contour chains. The revision's resolve step starts a staged city build (`createCityBuild`) on its resolved stories (a protected lot at FZP), `limitSources` and `countableMask`; its slices (job kind `'heights'`) run before the yield recompute, so `heights` goes out before the revision's `current`, and a revision waiting on chunks, or held by a failed one, still shows its heights. A revision superseded before its city is done posts none. The chain and label buffers are transferred. The finished city becomes the session's `limits`. FzpMode's `onheights` forwards a `heights` at or above the latest levers rev sent.
- `heightLids { reqId, bbox }` answers `heightLids { reqId, result }` (`HeightLidsResult`): `{ ok: true, lids, missing }` with `lids.limitsRev` and `lids.sourceIds` from the limits it was built on, or `{ ok: false, reason: 'no-session' | 'superseded' | 'too-large' }`. It waits for limits, then runs a staged lid build (`createLidBuild`) on the loaded records of the cells around the bbox padded by `LID_PAD_M` whose label point is inside; `missing` counts the bbox's cells not loaded. A newer request answers the older `superseded`; a new city restarts a running lid build on its limits, so an answer never mixes revisions. Only a session initialised with levers answers (the router answers `no-session` outside scenario mode); a session end answers a waiting request `no-session`. `levers` responses no longer carry a fog grid.
- `StoryEdit.source` (`src/lib/sim/levers/types.ts`) is the optional rule id a rule edit came from (absent on paint). `limitSources` (`src/lib/sim/levers/source.ts`) turns it into a per-lot code: `SRC_FZP` 0, `SRC_PAINT` 1, `SRC_RULE0 + k` for `ruleIds[k]`, `SRC_NONE` for no source. The city and lids carry the codes and the `sourceIds` they index, so the page can restyle a rule selection without a new request.
- `lotAt { reqId, point }` (sim-ux plan 4, Task 3) answers `lotAt { reqId, result }` (`LotAtResult`) at once from the limits the worker holds (it never waits on a pending revision): `{ ok: true, parcelId, owner }`, with `parcelId` null off every loaded lot and `owner` (`LimitOwner`, `ownerOf` in `source.ts`: `fzp`, `paint` or `{ kind: 'rule', ruleId }`) null when the session has no limits yet; a code `ownerOf` cannot name (out of range, `SRC_NONE`, an edit with no `source`) reads `fzp`. `{ ok: false, reason: 'no-session' }` without a session with levers. The same owner rides on `parcelSummary`'s `limits.owner` (a protected lot reads `fzp`). `/sim` uses it to select a layer from a map click ([sim-page.md](sim-page.md), "Map selection").

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

With `scenarios.fzp.gross` a lever revision fetches no chunk and generates no building: each
Need's yield is a lookup in the pipeline-built gross table (`src/lib/data/gross-table.ts`), so the
revision costs its resolve, its city build and the lookups. The table stores gross units per
story count clamped to `0xFFFF` (`clampGross`), and the fallback recompute applies the same clamp,
so both paths give the same yields.

Measured on dataset `2026-11-08-d15bdf2d` (2026-11-08, Apple M5 Pro, 15 cores, 24 GB, Node
v24.2.0) with `npx tsx scripts/bench-levers.ts pipeline/out/<v>`. "Table ms" answers the same needs
from `gross.bin` with the table recompute (`createTableRecompute`, one unsliced step): the cost a
revision pays on the table path. The other columns are the fallback's, as described below.

| Brush                                                | Lots    | Resolve ms | resolveEnvelopes ms | Needs (unique) | Cells | Chunk bytes | Recompute ms | scenarioYield ms (est.) | Other ms (est.) | Gross computed | Missing | fillNeeds + applyLevers ms | Table ms |
| ---------------------------------------------------- | ------- | ---------- | ------------------- | -------------- | ----- | ----------- | ------------ | ----------------------- | --------------- | -------------- | ------- | -------------------------- | -------- |
| (a) every `RH-1` family lot, rule to 4               | 72,935  | 20         | 14                  | 10             | 4     | 1.1 MB      | 13           | 14                      | 0               | 40             | 0       | 2                          | 0        |
| (b) `metro` and `rapidBus` within 1,609 m, rule to 8 | 148,798 | 123        | 55                  | 140,204        | 126   | 21.1 MB     | 22,332       | 22,204                  | 128             | 701,020        | 0       | 20                         | 86       |
| (c) `regionalRail` within 805 m, rule to 8           | 23,258  | 18         | 9                   | 20,187         | 41    | 7.1 MB      | 3,273        | 3,266                   | 7               | 100,935        | 0       | 4                          | 9        |

Brush (b), the largest, costs 86 ms of lookups on the table against 22,332 ms of recompute. As a
`max(FZP, 4)` rule, brush (a) has 10 needs on this dataset.

Cold loads on the same dataset, a production build (`npm run preview`, the dataset in local R2,
no `.dev.vars` override), measured with
`node scripts/profile-sim-load.mjs --origin http://localhost:4173 --runs 3` on an idle machine.
"Ready" is the first `timeline` the worker posts at or after the last levers revision the page
sent, in ms from navigation; median of 3 cold loads (each run in brackets):

| Case             | Median ms | Runs ms             | Bar ms |
| ---------------- | --------- | ------------------- | ------ |
| A `/sim`         | 933       | 993, 933, 928       | 1,125  |
| B `/sim?seed=72` | 635       | 638, 635, 617       | 857    |
| C `/s/<id>`      | 1,044     | 1,044, 1,040, 1,053 | 2,500  |

The A and B bars are 10% over the medians recorded on `2026-11-08-91736640` (1,023 and 779 ms).
C publishes `scripts/profile-sim-load.policy.json` and opens it.

The rest of this section is about the fallback.

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
- **Dated regimes:** the engine's `regimes` and `reservedFrom` inputs (`SimInput`, `src/lib/sim/scenario/types.ts`) exist for the `/lesscars` pipeline step only ([lesscars.md](lesscars.md)); `/sim` never sets them.
- **207.11 null cap and height (ruling 2):** a lot with no density cap has unlimited density, meets any minimum, and fails ordinance condition (b)(8), so it never qualifies (`s207Envelope` takes a non-null cap; `s207Row` throws on an `applies` row with a null cap). The under-40 ft test reads `lpFt` on a Local Program lot and `baseFt` elsewhere (input `fzpHeightFt`), because every project on a Local Program lot uses the Local Program. No shipped row changes (V33 stays OK).
- **Sibling document, not `PlanOp`s (ruling 3):** see "The lever document".
- **Edit semantics (rules and paint, sim runs plan 1), protection (amended by the 2026-10-29 rulings), Local Program forcing, policy start, rescale, scale bounds, references, capacity metric, disapproval threshold (ruling 3):** each is stated with its reason in the sections above.

## Notes for plans 3 and 4

- **Plan 3, reroll while resolving.** Done in plan 3, Task 1. `levers` messages keep the `setLevers` rev across a reroll-while-resolving. Do not treat a `levers` message below the reroll barrier as stale: the worker's `current` still names the `setLevers` rev, and the client clears `leversPending` when `current.rev >= leversRev`. The page's lever status (`src/lib/sim-page/lever-status.ts`, `leversMessage`) keeps any message at or above the rev it sent and never consults the timeline barrier.
- **Plan 3, load failure.** Done in plan 3, Task 1. If the load fails after a `setLevers` sent before load, the error is posted at the `initScenario` rev, which is below `leversRev`. `ScenarioClient` now tracks the session's `initScenario` rev and clears `leversPending` on an error that ended the session; `leversError` likewise fails the page's lever status.
- **Plan 3, in-flight card chances under `'all'` timers.** Done in plan 3, Task 2. `ProjectCard` carries `lookups` (`'inFlight'` or `'fresh'`, the cohort's table) and `chanceShift`; for an in-flight project in a rescaled stage, `cardStatus` reads the chance at `inFlightMonths(m, s)` months, not `m`. The paired-draw fix keeps this shift: the engine draws the kind from the unscaled table at about m months, and the card reads the rescaled display table, whose month round(m·s) is the unscaled curve at about m, so the shifted card shows the twin's eventual chance within the month grid (see "Timers scale time, never outcomes"). The map's bars read their cohort's lookups since plan 4 Call 15 (`Schedule.inFlight`, `slotCohort`, the 36-row chance texture; [fzp-mode.md](fzp-mode.md)), but are not shifted by `chanceShift`: an in-flight bar in a rescaled stage reads the in-flight table at `m` months.
- **Plan 4, timeline UI.** Done in plan 4 (Tasks 3 to 5; see [sim-timers.md](sim-timers.md)). Stacked timer edits are clamped to [0.05, 10] (`scaleTable`). The UI must show a clamped stacked edit as clamped, not silently limit it.
- **Performance.** Done in plan 3, Task 11: measured on real records, with the recompute bucketed by cell. See "Performance".
