# The /sim timeline

Developer notes for `src/lib/timeline/` and `src/lib/sim-page/SimPage.svelte`. Spec: `docs/superpowers/specs/2026-11-13-timeline-ui-design.md` (rules cited "rule N"); plan: `docs/superpowers/plans/2026-11-14-timeline-ui.md`. `/sim` and `/s/<id>` show one screen: the map, a timeline of dated policies under it, an inspector beside it. There is no Setup, no Run, no run slider and no high-water mark. The document is schema 4 ([policy-timeline.md](policy-timeline.md)); the worker is the ensemble runner ([ensemble-runner.md](ensemble-runner.md)); the numbers come from `TimelineView` ([world-score.md](world-score.md)). The page shell is in [sim-page.md](sim-page.md).

## Pieces

| Piece                     | File                                                                        | Owns                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SimPage`                 | `src/lib/sim-page/SimPage.svelte`                                           | the store, autosave, publish, the map tools, notices, the inspector's hosting                                  |
| `TimelineMode`            | `src/lib/timeline/TimelineMode.svelte`                                      | takes `FzpMode`'s place: header score, status, notices, map, card, tooltip, timeline, over a `TimelineSession` |
| `TimelineSession`         | `src/lib/timeline/session.svelte.ts`                                        | the client's events in arrival order, stale state, kept documents, notices, the card's refresh                 |
| `fill.ts`, `chunk-log.ts` | same folder                                                                 | pure rules for stale, Play and the fill text; the arrival-ordered log behind `viewOfLog`                       |
| `PolicySync`              | `src/lib/timeline/policy-sync.svelte.ts`                                    | resolves `queriesOf4(policy)` through `resolveBrush`, settles `lots` 250 ms after the last change (rule 16)    |
| `Inspector`               | `src/lib/timeline/Inspector.svelte` (`WhenEditor`, `WhatEditor`, `AddMenu`) | the selected span's editor, hosting today's editors through `lens.ts`                                          |
| `PolicyStore<SimPolicy4>` | `src/lib/sim-page/policy-store.svelte.ts`                                   | undo and redo; takes an optional `normalize(next, prev)` run inside `apply` and `undoTo`                       |

`src/lib/fzp/debug.ts` keeps `window.__sfhFzp`, now with `phase`, `day`, `asOf`, `playing`, `speed`, `filledThrough`, `lastIndex`, `policy`, `stale`, `refills` (every `refill`'s `from`, in arrival order) and `mean()` (VITE_E2E builds only). `e2e/helpers/run.ts` waits on it (`waitFilled`, `openKind`, `addPolicy`). `window.__sfhSim.preview` is unchanged.

## The screen

- **Rows**, top to bottom: the ruler (with the playhead and the filled mark), the chart, Zoning, Permitting, Public money, "The world". Public money exists only when the calibration has `market` and `baselineFunding` (`rows.ts`, `add.ts`).
- **The window** is `WINDOW_MONTHS = 480` months from the dataset date's year, `WORLDS = 48` (`src/lib/sim/timeline-client.ts`); it never moves or zooms. Every row is hatched past the filled mark.
- **A closed kind** shows one thin bar per policy; open (in place from md, a sheet below md) it shows a row per policy with a bar per span. The fixed rows ("Family Zoning Plan, as adopted", "Permitting times, as observed", "City funding today", "Market conditions") are selectable and read-only. Their refs have `span: -1` (`FIXED_SPAN`, `rows.ts`), an index no policy has, so a document policy named `fixed` cannot alias one.
- **The playhead** is a slider named "Date in the simulation". Left/Down and Right/Up move a month, Page Down/Up a year, Home goes to the dataset date, End to the filled mark; Alt, Ctrl and Meta keys are ignored. A key, a drag or a marker jump pauses playback. Nothing plays on open; playback stops at the filled mark and resumes when it moves on.
- **A bar** moves by drag or, focused, by arrows: the edge nearer the playhead's month (ties and an open end: the start) by a month, with Shift by a year, with Alt the whole span (`spans.ts`). The month fields in the inspector reach both edges.
- **A new policy** starts on the model month the playhead is in, with no end. The model's months start on the first of a calendar month, so with the playhead on 1 Jan 2031 a new policy's bar may read "December 2030" (the model month 1 Jan 2031 falls in is the one starting 1 Dec 2030).
- **The header score** is `TimelineHeaderScore` (`src/lib/scoreboard/HeaderScore.svelte` is hashed and untouched). Its number is `baseline.completedNet + mean.completedNet` at `lastIndex`, "calculating" until the window is filled; the RHNA meter reads the average at the target's deadline month once filled that far.
- **Rule 32, as amended (a55d50ea).** The fill state ("Forecast filled to 2047", or "Updating" while stale) shows in the header's status slot from 2xl. Below 2xl the slot is too narrow, so it is a line under the header bar (`data-testid="tl-status-line"`, min height always kept, so nothing moves). One `role="status"` live region (`tl-status-live`) speaks at every width, at most one change a second (`statusMs`, a test seam). Status is never placed among the buttons.
- **Explanations** (`Explain.svelte`) wait for hover, focus or tap; texts are in `copy.ts`. The `*4` sentences there duplicate `funding-copy.ts` texts that say "a run": `/lesscars` imports the original, so it is not edited.

## The worker messages as the page uses them

`TimelineClient` (`src/lib/sim/timeline-client.ts`) replaces `initScenario`, `reroll`, `setLevers`, `timeline`, `ranks` and `levers` on `/sim`; nothing on `/sim` sends them; the router and worker still route them (removal waits for the `/lesscars` cut-over). `TimelineSession` takes its own client from `createWorker()` (also what a crash restart uses).

- `open(manifest, doc, lots)` and `setPolicy(doc, lots)` return the rev the client used. `viewMonth(m)` goes through `MonthGate` (`playhead.ts`): at most four a second, only when the model month changes. `resyncMap()` is the map's `onResyncNeeded`. `retryChunks()` answers the "failed cells" notice.
- `compiled`, `filled` and `refill` are applied in arrival order into a `ChunkLog`; `rev` is never assumed to rise, and `compiled` and `refill` are never deduped by `rev` (one `refill` per acceptance; an edit taken up again after a later one was rejected gets a second `compiled` and `refill`). A `filled` chunk belongs to the statics of the last `compiled` before it. The view exists once `compiled` has arrived.
- `cells`, `lookups`, `heights` and `chunks` carry no rev and are forwarded as they come. The map's bars read the posted lookups, the card reads its own answer's.
- `error`: `bad-request` is the page's rule 34; any other code is rule 35. A crash is rule 36.

## The session's rules

- **Stale.** From an edit at rev R the page shows the held view (the one before the first unsettled edit), dimmed, with "Updating". An accepted edit ends it when a `refill` at rev >= R has arrived and the filled part reaches the playhead's month (`fill.ts`, `shownAt`). `compiled` never settles it: it precedes the `refill`. A `refill` at any rev puts the page back in stale for that rev's document.
- **Rejection.** A `bad-request` (rule 34, "That change couldn't be applied.") undoes the store to the newest kept document not answered `bad-request`. The session keeps every document sent since the last rev answered by a `refill`, that rev's included (`#kept`); an older rev's `bad-request` can follow a newer one. After a rejection the page stays stale until `filledThrough` is back to the held view's and passes the playhead (`floor` in `EditState`).
- **Play** is unavailable from an edit until `filledThrough === lastIndex`, unless an error stopped the fill, when it plays inside the filled part. Any edit pauses playback; the playhead does not move.
- **The provisional open (OQ-3).** The worker resolves brushes only after its dataset loads, so an `open` cannot carry the lots of a restored document with painted or transit policies. With `lots` null the session opens the document without those zoning policies (`provisionalOf`), then sends the full pair as its next `setPolicy`, as part of opening, not an edit. Until a `refill` at that rev or later has come and the window is whole, `provisional` is true: the headline stays "calculating" and the results stay stale. With the dataset loaded and lots resolved before the first open, one open carries the full document.
- **The carry-6 restart.** If the full document stands rejected after a provisional open, the stripped document stays what the forecast shows. A crash restart or the rule 35 Retry then re-opens and immediately sends a `setPolicy` of the stripped pair, keeps `provisional`, and posts the full document again only after the user's next edit. Never undo to the stripped document: that would drop the user's brushes.
- **A restart** re-opens with the last pair posted to the client.
- **The card** asks again after an edit once a `filled` covers its day, and whenever the playhead's month changes.

## Commit path and load notices

- **Commit-path reconcile.** Every store change passes `PolicyStore`'s `normalize`, which `SimPage` wires to `reconcilePolicy4(doc, calibration, asOf)`. The reconciled document is what is committed, sent and undone to. A programme or baseline scale an edit leaves without a source is dropped, with today's funding notice (`fundingNotices`, [sim-funding.md](sim-funding.md)). `spans.ts` is pure and keeps only the span structure valid, so the funding reconcile happens here. `TimelineSession` reconciles again before sending and warns once if that changed anything (it is a bug upstream).
- **Load.** `restoreSim4` and `openShared` (`session4.ts`, over `openSimDoc4` in `sim-doc4.ts`) reconcile and turn the report into today's notices in order, then the **"dates moved"** notice ("Some policy dates moved to fit this data."; one line per moved, trimmed or removed span, behind Details, `dates-moved`), then "upgraded" for a schema 2 or 3 document. The autosave is `sfhousing:sim:v2`; a `sfhousing:sim:v1` record is carried over once. Publish, `/s/<id>`, `/api/policies` and Remix are in [plan-sharing.md](plan-sharing.md).
- **`?seed=`** is dropped from the address with `replaceState` (`SimRoute.svelte`, `address.ts`), other parameters kept.

## Editing

- **Drafts.** An unfinished funding draft (`FundingDrafts`, in `SimPage`, outside the store) is discarded, with "An unfinished item was discarded.", when another policy is selected, "+" opens, the editor is closed or it unmounts. A change of span inside the same policy keeps it.
- **Funding** is hosted per policy: `FundingTab` with `only` (a baseline, one fund, or the terms), priced on the playhead's day.
- **Permitting** is `PermittingSection snapshot={false}`: no Save or "Revert to saved"; Revert returns the span's set to its preset's. The preset is the policy's: on a policy of several spans the preset select is disabled (`PRESET_PER_POLICY`, behind a tap). Custom timing keeps preset `observed` with the label `CUSTOM_TIMING_LABEL`.
- **Zoning.** A transit policy's stop types belong to the policy, its bands to the span. A stroke goes into the selected painted policy's span (else its selected span); with none selected a new painted policy is added from the playhead month and selected.
- **Edits in place on an offer** (an existing fund policy): the pool name (label); the kind of money; each money-in row (Once / Every year, amount, start, Until); adding and removing money-in rows; leverage (bank); programmes (add, edit, remove; the programme set is policy-wide, so the lens writes it to every span). **Debt terms (rate, term) are read-only**; end the policy and add a new one to change them (`TERMS_HINT`, behind a tap).

## Known limits

- **The early-edit guess.** The worker does not mark the rejection of an edit sent before the dataset loaded, so the page guesses. An early edit's rejection shows rule 35 ("The simulation couldn't load.") briefly, then flips to rule 34 ("That change couldn't be applied." plus the undo) when a post at an older rev arrives. Pressing Retry inside that window can leave the rule 35 notice up.
- **The restart rev.** `TimelineClient.restart` returns no rev, so the session assumes the client's next rev.
- **Debt terms.** A hand-edited /s link can still carry two sets of terms on one pool id (`parse4` checks only that every span names the same pool); world-score then prices the statements on month W's terms.
- **The engine's limits** (ruling 8), listed with their numbers in [ensemble-runner.md](ensemble-runner.md): worker memory about +394 MB with no copies and +526 MB with the month-0 copy (live city); some worker slices 52 to 63 ms; one cold massing of about 636 ms; planning with rich public money over the per-slice bar. The page shows no state for them.

## For the composer

The two places the page guesses about the worker (`src/lib/timeline/session.svelte.ts`):

- The early-edit classification: `early: !this.#sawCompile` at `:447`, handled at `:546-552` (`#earlyRejected`, `#stop()`), undone by `#fillWentOn` when an older-rev post arrives. A marker on the worker's `bad-request` for an edit sent before the load would remove it.
- The restart rev: `this.#rev += 1` at `:467-469`. A rev returned by `TimelineClient.restart` would remove it.

## Measurements

Task 22's operator fills these (machine, date, load average, lock held). Commands are in [map-perf.md](map-perf.md).

| Measure                                                                                         | Value     |
| ----------------------------------------------------------------------------------------------- | --------- |
| Apply a `cells` update, 22 cells, median of 5                                                   | (pending) |
| Apply a `cells` update, 121 cells, median of 5                                                  | (pending) |
| `bench:map` with the timeline docked, p50 / p95                                                 | (pending) |
| Live city, empty document: first results / whole window                                         | (pending) |
| Live city, painted document (the provisional open's extra refill): first results / whole window | (pending) |
