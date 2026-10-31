# /sim: the policy simulation page

Developer notes for `src/routes/sim/` and `src/lib/sim-page/` (plan 3 of 5, `docs/superpowers/plans/2026-10-29-sim-page.md`; the calls below are that plan's "Calls made in this plan"). The page is `FzpMode` (`src/lib/fzp/`, see [fzp-mode.md](fzp-mode.md)) running the lever engine ([sim-levers.md](sim-levers.md)) on a policy the user edits in a panel. `/fzp` is a 307 redirect to `/sim` with every query parameter kept and `start=fzp` added (Call 14); `start=fzp` opens `FZP_COMPAT_LEVERS` (FZP map, pre-FZP comparison, empty user layer), otherwise the page opens on `DEFAULT_LEVERS` (current law).

## Layout (approved 2026-10-29)

The partner approved the proposal with the changes below (partner direction, the coordinator's rulings and the controller's adjustments, 2026-10-29).

1. **Score bar in the top bar.** On `/sim` the header shows a button "{n} homes added". It shows the net new homes at the scrubber's date, the timelapse headline count (`at.total`), and never `planEffect`, which reads 0 on open under the current-law comparison. The button has `aria-expanded` and opens the score details under the header: the existing `FzpScorePanel` content (RHNA targets, references, "What your policy added", the protections line). The details are a popover on md+ (top right, `w-96`, ending above the scrubber) and a full-width disclosure below md. Escape or the button closes them and returns focus to the button.
   - The top-right scoreboard card and `FzpScoreboard`'s compact phone bar and sheet go away: the header bar replaces both. With no bottom score bar, the scrubber sits at the bottom on phones and `--scorebar-h` is gone.
   - **Announcements:** the button text is not a live region (it changes every frame during play). One polite `sr-only` region keeps `FzpScoreboard`'s rule: it speaks "{n} homes added by {Month Year}" only while paused, 1000 ms after the day settles ([fzp-mode.md](fzp-mode.md), scrubber contract).
2. **Phone menu.** Below md, the shell header shows the site name, the page's pinned item (the score bar on `/sim`) and one "Menu" button (`aria-expanded`). The menu holds the nav links and every other header action ("Policy", "Another future", and `/`'s actions). It opens as a panel under the header, Escape closes it, and choosing an item closes it. This lives in the shared shell, so `/` gets it too. From md, the header is unchanged except for the pinned slot.
3. **Panel docking.** The left Policy panel (`w-80`) docks from md; below md it is a modal sheet. From md the project card sits right of the open panel (`md:left-[calc(var(--sim-panel-w,0px)+1rem)]`): 320 + 320 px fit in 768 px now that the top right is free. Lever notices join the notice row above the scrubber.
4. **Sections:** "Zoning layers", "Your zoning", "Protections", "Permitting timelines", each a disclosure. Only "Zoning layers" is open by default. The timelines section's toggle is named "Permitting timelines, <the set's label>" (compact header, details on demand); inside it: a preset picker, the label with "Save timelines" and "Revert to saved" / "Revert to <preset name>", then for each route its share input and timeline, and the Local Program line. See [sim-timers.md](sim-timers.md).
5. **Phone floating tool bar** (after picking a stroke tool closes the sheet): tool, stories (a pop-over button, as on `/`), radius (pop-over), Done. Mode and Density need the sheet reopened.
6. **Protections** has a row "Protected with the brush · {n} lots" with Clear. Clear is one store change, so Undo restores it.
7. **Undo and Redo** buttons sit at the top of "Your zoning". Their labels name the change ("Undo: Raised arterials to 8 stories"), and the announcement names what was undone. They are the non-drag way back.
8. While the Protect or Unprotect tool is active, Mode, Stories and Density are hidden.
9. **On phone, "Add a brush"** replaces the sheet's contents with the form, which has a Back button. There is no second dialog.

What the build added to that layout:

- **The panel's default** (controller's ruling): open and docked from md, so `/sim` reads as a policy tool; closed below md, so the phone opens on the map. The default open does not move focus; opening by the "Policy" button does. Closing (the Close button, Escape, the Policy button) returns focus to the Policy button, or to the Menu button when Policy waits in the closed phone Menu.
- **Header overlays are mutually exclusive** (`headerOverlay` in `src/lib/shell/header-actions.svelte.ts`): the phone Menu, the score details and the phone sheet each close the others when they open, by any input. The docked md+ panel is not a header overlay (it never overlaps the score details).
- **The map's navigation control stays uncovered** (WCAG 2.2 2.4.11 Focus Not Obscured). `SimMap` puts its zoom and compass control (fine pointers only) at the map's bottom left. While the docked panel is open, `PolicyPanel` moves it right by `--sim-panel-w`; while the phone tool bar shows (below md, so a narrow desktop window), `PhoneToolBar` lifts it 4rem above the map inset, clear of the 54 px bar. Both rules key on `.sfh-fzp:has(…)`, so they end when the panel or bar goes. `e2e/sim.spec.ts` checks each button's box against the panel and the bar.
- **ScoreBar assumes a 48 px header** (`h-12`): the score details' `max-height` is `--fzp-dock-top` minus 3rem and a 1rem gap ([fzp-mode.md](fzp-mode.md), "Layout variables").
- Closing the sheet, or crossing md, discards an open brush form, so the panel reopens on the brush list.

## The recipe and its compile rules

The page edits a `SimPolicy` (`src/lib/sim-page/policy.ts`), a recipe of brush parameters, not lot lists (Call 1). `compileLevers` turns it into plan 2's `SimLevers` once every brush query has resolved (`null` until then). The recipe is what plan 5 autosaves and publishes (inside a `SimDoc`, "Autosave, publish and the read-only view" below); `timing` is plan 4's, edited in "Permitting timelines".

| Field                       | Meaning                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `stock`                     | The stock layers ("Zoning layers"); at least one stays on                                                                                 |
| `assumeAlternativePlanKept` | "Assume the City keeps an alternative plan after 2031" (no 2032 switch)                                                                   |
| `compare`                   | `'currentLaw'` or `'preFzp'`                                                                                                              |
| `brushes`                   | The ordered zoning brushes: `freehand`, `erase`, `transit`, `street`, `area`                                                              |
| `protect`                   | `rentControl`, `historic`, `newerThanYears`, and protect / unprotect `strokes`                                                            |
| `timing`                    | `current` (preset, preset timers and shares, custom edits and shares, Local Program) and `saved` (plan 4; [sim-timers.md](sim-timers.md)) |

Compile rules, with the plan's calls:

- **Brushes resolve in the worker** (Call 2) to scenario-eligible lots only (Call 3). A freehand stroke covers a lot whose label point is within the radius of the path, as on `/`.
- **Order:** brushes compile in list order and a later brush wins (Call 4). Move up and Move down reorder them. An **erase** brush removes its lots from the edits already emitted, never from later ones. A transit brush compiles outermost band first, so the inner band wins. An edit left with no lots is not emitted, so a brush that selects nothing sends no edit.
- **Density defaults** (Call 5): `raise` starts with density limits off; `lower` and `set` start with them on.
- **Stories** are the editor's 1 to 80 (Call 6).
- **Transit, area and street** brushes: see "Stop types and bands" below, Calls 8 to 10.
- **Protection** (Call 11) is the categories plus the protect strokes: `protect.lots` is the protect runs minus later unprotect runs, in order. A protected lot is **not redevelopable** (partner ruling 2026-10-29): protection beats every brush, and unprotecting a lot that a category still protects leaves it protected. Projects already in the pipeline on a protected lot carry on (Call 21).
- **Map feedback** (Call 12): lots in the user layer and brush-protected lots are dots at their label points (`lot-overlay.ts`), coloured by mode, protected lots drawn as a ring, with a map key in "Your zoning". `lotRoles` marks only brush-protected lots as protected, so a lot protected only by a category shows its brush role (raise, lower, set) on the map, not the ring. The engine still treats it as protected.
- **Map lookups** (Call 13): the map gets the worker's posted `lookups.fresh`; each card picks `inFlight` or `fresh` for its project.
- **No local persistence** (Call 15): **superseded by plan 5.** The policy autosaves and publishes; see "Autosave, publish and the read-only view" below.
- **Lever sends are debounced 250 ms** after the last change once every lot is resolved (Call 18); the worker lets the latest `setLevers` win.

`PolicyStore` (`policy-store.svelte.ts`) keeps the recipe with undo and redo: every change is one labelled store change, so the Undo and Redo buttons name it and Ctrl+Z / Ctrl+Shift+Z (the `/` editor's keys, through `BrushController`) step through the same history.

## Autosave, publish and the read-only view

Plan 5 (`docs/superpowers/plans/2026-10-30-sim-publish.md`; "Call n" in this section is that plan's). The document is `SimDoc` with `SIM_CODEC` (`src/lib/sim-page/sim-doc.ts`); the server side, limits and redirects are in [plan-sharing.md](plan-sharing.md), "Policies (`/sim`)". `src/routes/sim/+page.svelte` and `src/routes/s/[id]/+page.svelte` both render `SimRoute` (`src/lib/sim-page/SimRoute.svelte`: the seed handling and `{#key}` remounts), which renders `SimPage` with a `mode` and a `persist` setting.

- **Autosave** (`persist: 'restore'`, plain `/sim`). Every change (undo and redo included, and the title) is written under `sfhousing:sim:v1`, debounced 500 ms. On mount, `restore()` reads it: `store.reset(policy)` (not an undoable change), `levers = compileLevers(policy, () => [])` until the brushes resolve, then the full levers (Call 12). `restoreSimDoc` (`sim-session.ts`) reconciles the timings with the page's calibration and builds the notices: N1 to N3 in the policy wording, the timing refit, and the Remix toast. The header's status slot shows the save state ("Saving…", "Saved", "Autosave off").
- **Over-limit policies are not autosaved** (ruling R4). A document that fails `simDocProblems` (over `OPS_MAX` strokes or `MAX_PLAN_BYTES`) is never written, because it would load back as corrupt. The last valid write stays, and the header shows "Autosave off" until a valid write succeeds. Its popover still gives the storage reason (N4), not the size (known gap).
- **`start=fzp` defers** (`persist: 'deferred'`, Call 13). `/fzp` links open the FZP comparison with an empty user layer, so nothing is restored and nothing is written until the first change. If a non-default policy is saved, the `fzp-kept` notice says "Showing the Family Zoning Plan comparison. Your saved policy is kept until you change something here." with "Open your policy" (`/sim`). Before its first write, `Autosave.guard()` reads the stored record again (at mount and at the first change, since another tab may have written). A corrupt or future record is then kept under `sfhousing:sim:corrupt:<ISO>` before it is replaced, as after a restore.
- **Publish** sits in the header beside Policy. It is disabled on the default policy ("Change the policy first.", Call 14) and posts `SIM_CODEC.publishable(doc)` (the Save snapshot stripped) to `/api/policies`. The link is `/s/<id>`.
- **The read-only view** (`/s/<id>`, `mode: 'view'`, `persist: 'off'`). The shared banner sits above the map. The panel shows `PolicySummary` under "Policy (read-only)" (Call 15): the layers, comparison and alternative-plan toggle, the brushes, the protections, the timing label and the shares and changed stages behind a disclosure. There are no tools, no undo, no Publish and no autosave; the lot dots still draw. The shared policy is reconciled with the calibration it runs on, and the timing notice shows when anything moved. Viewing never writes the local policy: only Remix does, then goes to `/sim`.
- **Notices** (`SimNotices.svelte`) render in FzpMode's notice row above the scrubber, one line each with Details where there is a list. Toasts dismiss after 8 s. The polite status region mounts empty with the ready-phase notice row and takes the notices present on load 100 ms later (`LIVE_DELAY_MS`), so a notice present on load (the timing refit on `/s/<id>`, a restore or Remix notice) is announced: a screen reader announces a change to a live region, not one that mounts already populated. `SimNotices.svelte.spec.ts` and `e2e/sim-share.spec.ts` check that the region is in the document empty before the notice is inserted.

## Stop types and bands

Transit stop types (Call 7, `src/lib/sim/levers/brushes.ts`), read from `transit.json` patterns:

| Stop type      | Rule                                                                                                 | Tier                                           |
| -------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `regionalRail` | a stop on a `heavy-rail` or `commuter-rail` pattern (BART, Caltrain)                                 | 0                                              |
| `metro`        | a stop on a `light-rail` pattern (Muni Metro; the F streetcar and cable cars are not Metro)          | 0                                              |
| `rapidBus`     | a Muni stop on a bus route whose id matches `RAPID_ROUTE` (`/^\d+R$/`: 5R, 9R, 14R, ...)             | 1                                              |
| `frequentBus`  | a bus stop whose summed peak trips per hour over its bus patterns is at least `FREQUENT_BUS_TPH = 6` | 4 (no SFMTA frequent-network definition cited) |

- **Distance** is straight-line from the lot's label point to the stop. Tier 4: SB 79 measures from the parcel edge, and `parcels.bin` carries no outline.
- **Bands** (`DEFAULT_BANDS`, tier 4): a quarter mile (402 m) at 6 stories and a half mile (805 m) at 4 stories, SB 79's band edges. Each band has its own height; two bands at one distance are rejected in the form (the second could never select a lot).
- **Area by neighborhood** (Call 8): the lot's label point is in a `neighborhoods.geojson` polygon (the 41 analysis neighborhoods). Tier 3.
- **Area by zoning district** (Call 9): the components of `policy.useDistricts` (split codes broken at `|`), grouped by family (`RH-1(D)` under `RH-1`). Choosing a family chooses its members; a lot matches if any component of its code is chosen.
- **Commercial corridor** (Call 10): a Street brush preset to arterial frontage intersected with `isNeighborhoodCommercial` (NC and NCT; CRNC is not counted, Open question 1).
- **Street:** a segment matches by class or by name, at depth 0 (fronting) or 1 (one lot deep), from `frontage.bin` (`frontingRows`).

## Request flow

- **Resolution.** `LeverSync` (`policy-store.svelte.ts`) asks the worker for each query the recipe needs (`queriesOf`, keyed by canonical JSON) with `resolveBrush { reqId, query }`, and caches the answers (`brushLots`: lots and their label points). A `no-session` answer (no client yet, a crash, an ended session) is parked, not a failure, until `resume()` on the next session; a brush card then reads "Finding lots…". Other failures read "Couldn't find lots" with Retry.
- **Catalog.** The pickers read `brushCatalog` (street names, district families with lot counts, neighborhoods, stop counts, and `has.*` for each optional file). SimPage asks for it once, when the panel first opens, and again after a session restart if it came back null. A brush kind whose file is missing is disabled with its reason.
- **Lazy files.** The worker fetches `frontage.bin`, `transit.json` and `neighborhoods.geojson` once per session, on the first request that needs them (the catalog needs all three). `policy.bin` is fetched with the scenario, because `/sim` always initialises with levers. So on md+, where the panel opens by default, the first catalog request fetches `frontage.bin` soon after load; on a phone nothing fetches it until the sheet opens.
- **Sending.** Once every query is resolved, `compileLevers` runs and, 250 ms after the last change, the new `SimLevers` goes to FzpMode's `levers`, which sends `setLevers` (it waits while a reroll is in flight). The lever status (`lever-status.ts`) goes `resolving` (with done / total lots) and then `current`; meanwhile the notice row above the scrubber shows "Updating the simulation for your policy… {done} of {total} lots", with a Retry chip when chunks failed, and the score bar is `aria-busy`.
- **A failed revision.** If the worker cannot apply a revision (an exception in a recompute slice ends the session and posts `internal` at its rev, `scenario-host.ts`), the status goes `failed`. The notice row then shows an alert, "Couldn't update the simulation for your policy.", with Retry (`data-testid="fzp-lever-failed"`, a `role="alert"` region rendered even while empty so it stays in the accessibility tree). Retry is FzpMode's `retry()`: in the ready phase it re-sends `initScenario` with the latest levers and the shown seed, and `onclient` resumes the parked brush queries. The score keeps the last run's numbers, not `aria-busy` (a busy score that never settles could be withheld by a screen reader), and the score details say "These numbers are from before your latest policy change." until a revision is current. Later edits while failed get `bad-request` and stay failed until Retry. A `bad-request` above the latest levers' rev answers a refused reroll, not the levers, so it leaves the lever status alone (`lever-status.ts`).

## Dataset requirement

`/sim` needs a dataset with `policy.bin` and `frontage.bin`, the first being `MIN_SIM_DATASET = '2026-10-29-0fd62c4d'` (`scripts/wrangler-config.spec.ts`). That test fails `test:unit` if production's or staging's `PUBLIC_DATASET_VERSION` predates it (versions are date-prefixed, so the date orders them). There is no missing-data fallback (Call 16): a dataset without `policy.bin` gets the worker's `scenario-missing` answer, shown as "The simulation data for dataset … is missing or damaged" with Retry.

**Ordering (Task 0B).** Production deploys only on a release, and a release ships whatever is on `main`. So a data bump that `/sim` needs merges to `main`, and is released, **before** the code that needs it merges. Any release that contains the code then also contains the bump, even when the two land in one release. If a later change needs a newer dataset, promote it the same way first ([deploy.md](deploy.md), "Promoting a datasetVersion").

## The debug hook's `levers` field

`window.__sfhFzp` (VITE_E2E builds only, [fzp-mode.md](fzp-mode.md)) has a `levers` field on `/sim`:

| Field     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `status`  | `'off'` (a session without levers), `'resolving'`, `'current'` or `'failed'` |
| `done`    | lots recomputed so far while resolving (0 otherwise)                         |
| `total`   | lots to recompute while resolving (0 otherwise)                              |
| `sentRev` | the revision of the latest levers sent, or null                              |

A test waits for a policy change with `status === 'current'` and a `sentRev` above the one read before the change. The lever notices are in `data-testid="fzp-lever-status"`, the session notices in `data-testid="sim-notices"`. The e2e specs are `e2e/sim.spec.ts` and, for autosave, publish and `/s/<id>`, `e2e/sim-share.spec.ts`; it reads the street name and its lot count from fixture-0's `frontage.bin` and `parcels.bin` with the shared codecs.

## Performance

Citywide brushes (every RH-1 lot, arterial frontage, rail within 805 m) were measured on real records in plan 3: see [sim-levers.md](sim-levers.md), "Performance".

## Known gaps

- **Follow a street** (Open question 2). The freehand brush cannot follow a street: no segment geometry ships (`frontage.bin` holds lot-to-street matches only). The named-street brush paints every lot along a street, one lot deep if asked. A street-geometry file at a dataset bump would allow it.
- **Neighborhood edges** (Call 8). Neighborhood membership is the label point in the polygon, which can differ from DataSF's `analysis_neighborhood` at polygon edges. A `neighborhood` column in `policy.bin` is the exact fix at the next dataset bump.
- **In-flight `chanceShift` on the map.** The map's bars read the cohort's lookups, but the in-flight `chanceShift` for the stage a project is in at `asOf` under `'all'` timers is not applied on the map; cards apply it (Call 15).
- **No keyboard access to cards** (unchanged from `/fzp`): map picking is pointer-only ([fzp-mode.md](fzp-mode.md)). Freehand strokes have keyboard and non-drag alternatives (the rule brushes, and the keyboard stamp `BrushController.stampAtCenter`).
