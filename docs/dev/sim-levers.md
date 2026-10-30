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
- **Window:** the "after" period is resolved whenever `asOf < switchDay <= horizon` and `assumeAlternativePlanKept` is false, whatever the stock layers, protections or edits. It is dropped (`after` is null, so the plan has no `lawSwitch`) when its table equals the "before" table row for row (stories, cap, yields and hostable), and likewise for the unprotected view. So a run switches exactly when the switch changes an envelope: `currentLaw` in the stock, or a user edit with `densityLimits: true` whose current-law cap changes at the switch. An FZP-only plan with no capped edits has no switch, whatever its protections. If `switchDay <= asOf`, the "before" period already uses after-switch law.
- **Vesting:** a project keeps the regime of the month it initiated in, for both its hazard and its envelope (a filed application vests the standards in force, as SB 330's preliminary application does, Gov. Code section 65941.1). In-flight projects keep their current envelope.
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

## The builder's calls

Rulings 1 to 3 of the plan, each with its reason.

- **Law switch (ruling 1):** no pipeline change and no dataset bump, because `policy.bin` carries everything the switch needs. A project keeps the regime of the month it initiated in, because a filed application vests the standards in force.
- **207.11 null cap and height (ruling 2):** a lot with no density cap has unlimited density, meets any minimum, and fails ordinance condition (b)(8), so it never qualifies (`s207Envelope` takes a non-null cap; `s207Row` throws on an `applies` row with a null cap). The under-40 ft test reads `lpFt` on a Local Program lot and `baseFt` elsewhere (input `fzpHeightFt`), because every project on a Local Program lot uses the Local Program. No shipped row changes (V33 stays OK).
- **Sibling document, not `PlanOp`s (ruling 3):** see "The lever document".
- **Blend order, edit semantics, protection (amended by the 2026-10-29 rulings), Local Program forcing, policy start, rescale, scale bounds, references, capacity metric, disapproval threshold (ruling 3):** each is stated with its reason in the sections above.

## Notes for plans 3 and 4

- **Plan 3, reroll while resolving.** `levers` messages keep the `setLevers` rev across a reroll-while-resolving. Do not treat a `levers` message below the reroll barrier as stale: the worker's `current` still names the `setLevers` rev, and the client clears `leversPending` when `current.rev >= leversRev`.
- **Plan 3, load failure.** If the load fails after a `setLevers` sent before load, the error is posted at the `initScenario` rev, which is below `leversRev`, so the client's `leversPending` can stay set. Clear it on any error for the session.
- **Plan 3, project cards.** Cards read `localProgram` from the before-switch view (`card.ts:195`). Where the before and after views differ, a post-switch project card can show a stale Local Program flag.
- **Plan 3, in-flight card chances under `'all'` timers.** `lookups.inFlight.chance` is the rescaled table, but the engine conditions an in-flight row in a rescaled stage on `inFlightMonths(m, s)` = `round(m * s)` months (see "In-flight remaining-time rule"). A card for an in-flight project must look up the chance at `inFlightMonths(m, s)` months, not `m`, or it shows the chance for a project `m / s` months old.
- **Plan 4, timeline UI.** Stacked timer edits are clamped to [0.05, 10] (`scaleTable`). The UI must show a clamped stacked edit as clamped, not silently limit it.
- **Performance.** The recompute rescans all pending needs per slice, which is O(n^2/k) for a citywide brush (n needs, k per slice). Weigh it against the spec's "fallback table if too slow" before shipping brushes.
- **Carried from plan 1** (spec, "Carried from plan 1"): the commercial-corridor brush counts NC and NCT districts but not CRNC (241 parcels), and the partner decides whether CRNC counts. "Follow a street" needs street segment geometry (`frontage.bin` holds lot-to-street matches only).
