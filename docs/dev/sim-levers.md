# /sim policy levers

The engine behind `/sim` (plan 2 of 5). Source: `src/lib/sim/levers/`; protocol: `src/lib/sim/scenario/types.ts`. The plan (`docs/superpowers/plans/2026-10-29-sim-policy-engine.md`, "Rulings") holds the reasons in full. Everything here is worker-safe and pure except the worker session.

## The lever document

`SimLevers` (schema 1, `types.ts`) is a sibling of the editor's `Plan`, not new `PlanOp`s: levers are mostly static configuration, and user edits name lots by `ParcelId`, so the document survives row reordering. `parseSimLevers` validates it (hand-written guards; `LeverFormatError` names the first bad field).

| Field                       | Default (`DEFAULT_LEVERS`)        | Meaning                                                               |
| --------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `stock`                     | `['currentLaw']`                  | Stock layers blended per lot: `currentLaw`, `fzp`, `sb79`, `base`     |
| `assumeAlternativePlanKept` | `false`                           | `true` keeps FZP + 207.11 throughout (no 2032 switch)                 |
| `user`                      | `[]`                              | Ordered edits `{lots, mode: raise/lower/set, stories, densityLimits}` |
| `protect`                   | none                              | `{rentControl, historic, newerThanYears, lots}`                       |
| `timers`                    | `[]`                              | `{pathway, stage, scale, reach: all/new}`; scale in [0.05, 10]        |
| `routeShares`               | `null` (observed `pathwayForNew`) | Pathway shares for new projects, normalised                           |
| `localProgramStreamlined`   | `true`                            | Local Program lots forced onto streamlined                            |
| `compare`                   | `'currentLaw'`                    | Twin: current law, or `'preFzp'` zoning                               |

`FZP_COMPAT_LEVERS` (`stock: ['fzp']`, `compare: 'preFzp'`) is the document under which `/sim` reproduces `/fzp`. Construction and completion are locked: no timer edits them.

## Resolution order

`resolveEnvelopes` (`resolve.ts`) builds, per lot and per period: the stock blend, then user edits in document order (a later edit wins), then protections (a protected lot is not redevelopable: it is reset to its stock-blend row with `hostable` 0, and makes no `Need`). A user edit that needs a yield `policy.bin` does not hold becomes a `Need` (`row:stories:cap`); `fillNeeds` writes the recomputed rows in. Lots a document names that are not in the dataset are counted in `unknownLots`.

- `raise` gives `max(s, N)`, `lower` gives `min(s, N)`, `set` gives `N`.
- With `densityLimits: true` the cap is the period's current-law cap, so a capped edit follows the switch (see "Window"); with `false` there is no cap. (Raise-defaults-to-off is a UI default, plan 3.)
- An edit whose final `(stories, cap)` matches one of the lot's stock rows (or its after-switch current-law row) reuses that row's yields and `hostable` instead of a `Need`. When the match is the SB 79 row (or the after-switch current-law row copied from it), the yields are SB 79's: `sb79Yield` zeroes fill levels below `MIN_UNITS` (`pipeline/lib/sb79.ts`) and `hostableSb79` is `sb79Status = 'applies'`, neither of which is `envelopeRow`'s rule. So such an edit's low fill levels are zeroed below `MIN_UNITS`, where the same envelope computed as a `Need` would not be. This is plan-mandated (a raise to a lot's SB 79 `(stories, cap)` gives no `Need`) and is correct where that row is current law.

## Stock blend and tie rule

Blending takes the most permissive layer per lot and is order-insensitive. The canonical order is `currentLaw, fzp, sb79, base`, and a tie keeps the earlier layer (plan 1's "a tie keeps FZP").

## The law switch

- **Date:** `CURRENT_LAW_SWITCH.day = 2032-01-31`, one year after the 7th-cycle Housing Element due date (2031-01-31).
- **Provenance:** tier 4, "Assumption: SB 79 as written takes effect one year after the 7th-cycle Housing Element due date". The temporary SB 79 exemptions end on the same date, so they are not applied after it; the permanent exemption (`exemptPermanent`, Ord. 082-26 section 3) is.
- **Rule:** from the switch day, current law per lot is the SB 79 row where `sb79Status = 'applies'`, `exemptPermanent = 0` and SB 79 is more permissive than FZP; otherwise the FZP row. 207.11 lapses with the Alternative Plan. No pipeline change and no dataset bump: `policy.bin` already carries SB 79 as written per lot.
- **Window:** the "after" period is resolved whenever `asOf < switchDay <= horizon` and `assumeAlternativePlanKept` is false, whatever the stock layers, protections or edits. It is dropped (`after` is null, so the plan has no `lawSwitch`) when its table equals the "before" table row for row (stories, cap, yields and hostable), likewise for the unprotected view, and the Local Program column (`localProgramColumn`) is the same in both periods. So a run switches exactly when the switch changes an envelope or the Local Program column: `currentLaw` in the stock (including a stock such as `['currentLaw', 'sb79']` whose envelopes may not change but whose SB-79-wins Local Program lots stop being forced), or a user edit with `densityLimits: true` whose current-law cap changes at the switch. An FZP-only plan with no capped edits has no switch, whatever its protections. If `switchDay <= asOf`, the "before" period already uses after-switch law.
- **Vesting:** a project keeps the regime of the month it initiated in, for both its hazard and its envelope (a filed application vests the standards in force, as SB 330's preliminary application does, Gov. Code section 65941.1). In-flight projects keep their current envelope.
- **The regime is recorded on the Schedule** (plan 3, Task 2, option A). On a run with `lawSwitch`, the engine sets `Schedule.afterSwitch` on each simulated project from its own `T > T0` test (`engine.ts`, `simulatedPass`): true when the initiation month started on or after the switch, so the project ran on the after view (size row, yields, envelope, Local Program). It is absent on every other Schedule, including all of a run without a switch, so `/fzp`'s timelines and the goldens are unchanged. Readers use the flag, never the initiation day: the month grid is anchored at the day the parcel was at risk from (`asOf`, or a previous exit), so a function of the day alone disagrees with the engine near the switch. `projectCard` reads `localProgram` from `lawSwitch.parcels` when the flag is set.
- **Protections alone never switch.** A protected row is its stock-blend row with `hostable` 0 in both periods, so it changes at the switch only when the blend does (`currentLaw` in the stock). With stock `['fzp']` and only protections, `after` is null. `Resolution.beforePeriod` names the law `before` was resolved under (`'after'` when `switchDay <= asOf`).

## Protections and the capacity metric

Protection works by category (`rentControl`, `historic`, `newerThanYears`) and by lot list. A protected lot is **not redevelopable** (partner ruling 2026-10-29): it is reset to its stock-blend row (stories, cap and yields, discarding any user edit) with `hostable` 0, so no new project initiates there and it makes no `Need`. In-flight projects on a protected lot carry on, on the stock-blend envelope; protection gates only new initiation, through `hostable` (partner Call 21). Since `netCapacity` counts only hostable rows, `withoutProtections - plan` is the protected rows' unprotected capacity and is never negative. `leverCapacity` reports static net capacity (sum over hostable lots of `max(0, full-fill yield - existing homes)`, the same measure as `policy.current.net_capacity`) for the plan with and without protections, before and after the switch. Reason: "how much capacity the protections removed" is a capacity, and a third simulated twin would double the band cost.

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

`routeSharesOp` replaces `pathwayForNew` with the normalised shares (provenance kept; `null` is identity). `localProgramColumn(ctx, levers, period)` (`view.ts`) gives the Local Program column per period (partner Call 22). A Local Program lot is forced onto streamlined when `localProgramStreamlined` is set and either:

- `fzp` is on (in both periods: forcing still applies with the FZP map layer on); or
- `currentLaw` is on (current law contains the FZP map), except after the switch where `sb79WinsAfter(ctx)` (`layers.ts`, the lots whose after-switch current law is the SB 79 row) is 1 and `assumeAlternativePlanKept` is false. Those lots follow the route shares after 2032-01-31.

Otherwise the column is all zero, as in `baseZoning`. `planOf` (`apply.ts`) passes `Resolution.beforePeriod` for the plan view and `'after'` for the `lawSwitch` view; the current-law twin goes through `planOf`, so it follows the same rule.

## Twins and the references rule

`twinInput` builds the comparison run and never carries the plan's timers.

- `'preFzp'`: `baseZoning` on the base calibration, no switch.
- `'currentLaw'` (default): the plan of `{ ...DEFAULT_LEVERS, assumeAlternativePlanKept }` on the base calibration, with its own switch, resolved over the same window as the plan (`asOf = base.asOf`, the session horizon, `switchDay = CURRENT_LAW_SWITCH.day`).

Every lever field (`lawSwitch`, `newProjects`, `inFlightScale`) is set explicitly, because `applyPolicies` copies the whole input. Twins are memoised on (base, ctx, compare, `assumeAlternativePlanKept`, horizon).

`applyLevers(base, ctx, levers, filled, horizon)` takes the horizon as a **fifth argument**, because the current-law twin's own switch needs `switchDay <= horizon`.

**References.** The existing `REFERENCES` (`score.ts`) are FZP-versus-pre-FZP estimates on `planEffect.*`, so they are shown only under `compare: 'preFzp'`. Under `compare: 'currentLaw'` there are **no reference lines**: no existing entry measures `completedNet` against current law. RHNA targets come from `targetsOf`, unchanged.

## Protocol

Requests (`ScenarioRequest`): `initScenario` carries an optional `levers` (absent means `/fzp`, which never fetches `policy.bin`). `setLevers { rev, levers }` is a barrier rev like `reroll`, needs a session initialised with levers, and the latest one wins.

Responses (`LeversResponse`, `type: 'levers'`), where `rev` is the `initScenario` or `setLevers` that named the levers:

- `phase: 'resolving'` with `done`, `total`, `failedCells`: touched-lot yields are being recomputed in budgeted slices (`createYieldRecompute`). `failedCells` are needed chunks that failed to load; `retryChunks` re-wants them. Until complete the result is "out of date" (`leversPending`).
- `phase: 'current'` with `lookups` (`{ inFlight, fresh }`, each `{ chance, typicalMonths }`; `fresh === inFlight` when there is no `'new'` timer), `capacity` and `unknownLots`: the levers are in force, before any timeline computed on them. A superseded revision never gets `current`.

Brushes (plan 3): `resolveBrush { reqId, query }` answers `brushLots { reqId, result }` (`BrushLotsResult`: `{ ok: true, lots, points }` with `points` the lots' label points as lng/lat pairs, transferred; or `{ ok: false, reason }`), and `brushCatalog { reqId }` answers `brushCatalog { reqId, catalog }`.

- Only a session initialised with levers answers; otherwise `no-session` (catalog `null`). The router answers both itself outside scenario mode.
- A request that arrives before the load waits for it. When the session ends (a new `initScenario`, a failed load, `dispose`), every waiting request is answered `no-session`.
- The host validates each query (`brushQueryProblem`, `load.ts`): radii and `maxM` positive and finite, coordinates finite, kinds, stop types and street classes known; otherwise `bad-request`.
- `frontage.bin` (`scenarios.fzp.frontage`), `transit.json` (`transit`) and `neighborhoods.geojson` (`neighborhoods`) are fetched once per session, on the first request needing them (street, transit, area-with-neighborhoods; the catalog needs all three). A missing manifest key, a failed fetch or a bad file gives `data-missing` for the queries needing it and `has.<file> = false` in the catalog. A missing key, a 4xx (not retried) or a bad file is cached for the session; a network error, 5xx or failed body read (after the session's retries) is not, so the next request needing the file fetches it again. `/fzp` never fetches them.
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
as a JIT warm-up, then measures each brush with a fresh lot index and an empty gross cache.

What it measures: for each brush, every needed chunk is loaded first, then the recompute runs as
one unsliced `step(Infinity)`. So "Recompute ms" is the compute cost of the touched-lot yields
only. It does not show the speed-up from bucketing (that is in the slice-to-slice rescans, which
one step never makes), nor the wall time to `current` on the page, which adds scheduler slices and
the chunk fetches.

"scenarioYield ms (est.)" replays every gross the recompute cached; "Other ms (est.)" is
"Recompute ms" minus that. Both are estimates: the replay runs without the recompute's
interleaving, so the split can be off in either direction. "Resolve ms" is `createLotIndex` +
`resolveBrushRows`.

| Brush                                                    | Lots   | Resolve ms | resolveEnvelopes ms | Needs (unique) | Cells | Chunk bytes | Recompute ms | scenarioYield ms (est.) | Other ms (est.) | Gross computed | Missing | fillNeeds + applyLevers ms |
| -------------------------------------------------------- | ------ | ---------- | ------------------- | -------------- | ----- | ----------- | ------------ | ----------------------- | --------------- | -------------- | ------- | -------------------------- |
| (a) every `RH-1` family lot, raise to 4, limits off      | 72,992 | 17         | 35                  | 49,196         | 80    | 15.7 MB     | 3,362        | 3,317                   | 45              | 161,791        | 0       | 20                         |
| (b) arterial frontage depth 1, set to 8 (limits on)      | 13,472 | 16         | 39                  | 14,104         | 90    | 15.8 MB     | 2,319        | 2,314                   | 5               | 61,815         | 0       | 9                          |
| (c) `regionalRail` within 805 m, raise to 8 (limits off) | 23,639 | 18         | 20                  | 21,190         | 44    | 7.3 MB      | 3,369        | 3,352                   | 17              | 105,890        | 0       | 10                         |

The gate (Call 20) was 20,000 ms for brush (a): it passes at 3,362 ms, so no per-lot yield-table
fallback is needed. By the estimate, `scenarioYield` is nearly all of the recompute's cost.

## The builder's calls

Rulings 1 to 3 of the plan, each with its reason.

- **Law switch (ruling 1):** no pipeline change and no dataset bump, because `policy.bin` carries everything the switch needs. A project keeps the regime of the month it initiated in, because a filed application vests the standards in force.
- **207.11 null cap and height (ruling 2):** a lot with no density cap has unlimited density, meets any minimum, and fails ordinance condition (b)(8), so it never qualifies (`s207Envelope` takes a non-null cap; `s207Row` throws on an `applies` row with a null cap). The under-40 ft test reads `lpFt` on a Local Program lot and `baseFt` elsewhere (input `fzpHeightFt`), because every project on a Local Program lot uses the Local Program. No shipped row changes (V33 stays OK).
- **Sibling document, not `PlanOp`s (ruling 3):** see "The lever document".
- **Blend order, edit semantics, protection (amended by the 2026-10-29 rulings), Local Program forcing, policy start, rescale, scale bounds, references, capacity metric, disapproval threshold (ruling 3):** each is stated with its reason in the sections above.

## Notes for plans 3 and 4

- **Plan 3, reroll while resolving.** Done in plan 3, Task 1. `levers` messages keep the `setLevers` rev across a reroll-while-resolving. Do not treat a `levers` message below the reroll barrier as stale: the worker's `current` still names the `setLevers` rev, and the client clears `leversPending` when `current.rev >= leversRev`. The page's lever status (`src/lib/sim-page/lever-status.ts`, `leversMessage`) keeps any message at or above the rev it sent and never consults the timeline barrier.
- **Plan 3, load failure.** Done in plan 3, Task 1. If the load fails after a `setLevers` sent before load, the error is posted at the `initScenario` rev, which is below `leversRev`. `ScenarioClient` now tracks the session's `initScenario` rev and clears `leversPending` on an error that ended the session; `leversError` likewise fails the page's lever status.
- **Plan 3, project cards.** Done in plan 3, Task 2. Cards read `localProgram` from the view the engine ran the project on, through `Schedule.afterSwitch` (see "The law switch", option A), so a post-switch card no longer shows a stale Local Program flag.
- **Plan 3, in-flight card chances under `'all'` timers.** Done in plan 3, Task 2. `ProjectCard` carries `lookups` (`'inFlight'` or `'fresh'`, the cohort's table) and `chanceShift`; for an in-flight project in a rescaled stage, `cardStatus` reads the chance at `inFlightMonths(m, s)` months, not `m` (see "In-flight remaining-time rule"). The map's bars are not shifted: it takes `lookups.fresh` only (plan 3 Call 13, a known gap in [sim-page.md](sim-page.md)).
- **Plan 4, timeline UI.** Stacked timer edits are clamped to [0.05, 10] (`scaleTable`). The UI must show a clamped stacked edit as clamped, not silently limit it.
- **Performance.** Done in plan 3, Task 11: measured on real records, with the recompute bucketed by cell. See "Performance".
- **Carried from plan 1** (spec, "Carried from plan 1"): the commercial-corridor brush counts NC and NCT districts but not CRNC (241 parcels), and the partner decides whether CRNC counts. "Follow a street" needs street segment geometry (`frontage.bin` holds lot-to-street matches only).
