# timeline-ui: policies as tracks on the simulation's timeline

Part of the step-engine package. Design: [2026-11-12-2305-sim-step-engine.md](../design/2026-11-12-2305-sim-step-engine.md), approved 2026-11-13. Release B, last. Depends on `policy-timeline` (the document and its codec), `ensemble-runner` (the client and its messages), `world-score` (`TimelineView`), `map-stream` (through the runner).

## Purpose

Today `/sim` has two phases. In setup you edit one undated policy in tabs; then you press Run, the policy locks, and a scrubber plays one precomputed future. This subsystem replaces both with one screen: a timeline under the map on which every policy is a bar over the months it is in force, a playhead, and a mark showing how far the forecast has been filled. Policies can be edited at any time; an edit takes effect from its own date.

The look is the accepted mockup: `.superpowers/superconductor/sim-step-engine/mockups/policy-tracks-v3.html` for the rows, `policy-tracks-v2.html` for the inspector and the phone layout (screenshots beside them). Numbers in the mockups are made up.

## Scope

- The timeline component and its parts, in `src/lib/timeline/`.
- The editor for a selected policy, reusing today's editors.
- Playback, the playhead, the filled mark, the results.
- Loading, failure and stale states.
- Switching `/sim`, `/s/<id>` and `/api/policies` to the schema 4 document and the new worker messages; removing the lock, the run phases, the run slider and the high-water mark from `/sim`.
- Moving today's standing explanations behind interest.

Not in scope: the engine and the worker (other specs); `/lesscars` (keeps its own mode and every file it imports); new kinds of policy; editors for what the fixed rows assume (design ruling R3: leave room, build nothing).

## Interfaces

Used, owned elsewhere:

{{ROW S10}}

{{ROW S14}}

{{ROW S15}}

`TimelineView` and `ScoreStatics` are defined in the `world-score` spec; `TimelineClient`, `WORLDS` and `WINDOW_MONTHS` in the `ensemble-runner` spec; `reconcilePolicy4`, `upgradePolicy` and the schema 4 codec in the `policy-timeline` spec.

Defined here: `TimelineMode.svelte` takes the place of `FzpMode.svelte` on `/sim` and `/s/<id>`, with the same data props (`manifest`, `calibration`, `datasetVersion`, the load and error props, `noScenario`, `reload`, `createWorker`, `view`, `cards`, `ownerName`, `fundingName`, the snippets) and, in place of `levers`, `runPhase`, `onrun`, `onrewind`, `urlSeed` and `onurlseed`: `policy: SimPolicy4`, `lots: Record<string, ParcelId[]> | null` (null while a query is unresolved), `readonly: boolean`, `onedit(change, label)`.

## The screen

1. Top to bottom: the header (unchanged shell; the header score; the save state and the fill state in the status slot), the map, the timeline. On desktop the editor is a side inspector that leaves the timeline visible; on a phone it is a sheet.
2. The timeline's rows, top to bottom: the ruler with the playhead and the filled mark; the chart; one row per kind (Zoning, Permitting, Public money); "The world".
3. **Ruler.** Years from the dataset date's year to forty years on (ruling R9: the window does not move or zoom). The filled mark is a bar along the ruler from the start to the last final month (`TimelineView.filledThrough`); the unfilled part of every row is hatched. Two jump markers stay, as today: "RHNA deadline" and "2045".
4. **Chart row.** Completed net homes with the baseline added, as today's headline counts them: the average as a line, the band as a shaded area, world 1 as a thinner line labelled "this city", the state target as a dashed marker at its deadline. Everything filled is drawn, on both sides of the playhead (ruling OD-5); the part after the playhead is drawn lighter. Nothing is drawn past the filled mark. Strokes keep today's rules: at least 3:1 contrast, told apart by dash pattern as well as colour. The row is a `<figure>` with an accessible name and a one-sentence summary; its text alternative is the table in Results (rule 26).
5. **A kind's row, closed.** A miniature of its policies: one thin bar per policy over its spans. Its label carries the count and a "+" to add a policy.
6. **A kind's row, open** (ruling R7). The row becomes a heading and each policy gets a full row beneath it: its label, and a bar per span carrying the span's short setting ("30% faster", "$500M"). The miniature is not shown while open. A policy that is off is drawn dimmed in place. A span with no end fades out at the right edge.
7. **Fixed rows.** Each kind's first row is what holds without any policy: "Family Zoning Plan, as adopted", "Permitting times, as observed", "City funding today". They span the whole window, cannot be moved or removed, and selecting one shows what it is (read-only). "The world" has one fixed row, "Market conditions" (ruling OD-11); the level it names comes from `marketLevel(cal)`, as every market text does today.
8. **Public money** and its fixed row appear exactly when the calibration has both `market` and `baselineFunding`, today's condition for the Funding tab. Without them the kind is absent; money policies in an opened document are kept, and today's notice says they are not used.
9. **Phone.** Rows are closed by default. Tapping a kind opens it as a full-height sheet with its policies as rows over the same ruler; the playhead and the chart stay visible above the sheet's handle.

## Editing

10. Selecting a bar or a policy's label opens its editor. The editor has two parts: **When** (the spans, each with a from month, a to month or "no end", and add, split and remove) and **What**, which is today's editor for that lever, unchanged in behaviour: the transit rule editor (`TransitTab`), painting (`PaintTab` and the palette), protections (`ProtectionsSection`), the permitting timing set (`PermittingSection`, `RouteTimeline`), and the funding editors (`FundingTab`'s pool, programme, baseline-scale and terms editors). Each edits the `what` of the selected span. Figures an editor prices (the coverage figure, a programme's cost per home) are priced on the month the playhead is in.
11. Dates snap to model-month starts and are shown as month and year. A bar's edges can be dragged. Every drag has a non-drag way to the same result: the month fields in the editor, and on a focused bar the arrow keys move its nearer edge by a month, with Shift by a year, and Alt+arrows move the whole span (WCAG 2.5.7, 2.1.1).
12. "+" on a kind offers what today's tabs offer for it: a transit rule, a painted area, a protection; a permitting preset or a custom timing; a funding preset, a new fund, baseline scales, terms. A new policy starts on the month the playhead is in, with no end, and is selected.
13. A policy has an on/off switch and Remove in its editor. Reordering inside a kind is by a "Move up / Move down" pair in the editor (order matters for painted zoning and for route shares).
14. Undo and redo keep working through `PolicyStore` (now holding a `SimPolicy4`). `PolicyStore.locked`, `RunPhase` and every use of them are removed from `/sim` (ruling OD-9). Known sites: `SimPage.svelte:108, 342, 361, 399, 485, 502-512, 520, 657, 696, 919, 1016, 1018, 1044, 1048, 1058`, `policy-store.svelte.ts:27, 62, 89, 101`, `stroke-adapter.ts:81`, `fzp/debug.ts:4, 23, 90`; the builder greps for the rest.
15. An unfinished funding draft, which today is discarded when a run starts, is discarded when another policy is selected or the editor closes, with today's announcement ("An unfinished item was discarded.").
16. Edits reach the worker as today: debounced 250 ms, the brush queries of `queriesOf4(policy)` resolved through `resolveBrush`, then `TimelineClient.setPolicy(policy, lots)`.
17. In view mode (`/s/<id>`, `readonly`), nothing can be edited; selecting a policy shows its settings read-only, and "Remix" works as today.

## The map

18. The view menu and its overlays (height limits, transit) are offered at all times. Height limits, lids, the paint preview and the lot tooltip ("Allowed … · Buildable here …") show the zoning in force in the month the playhead is in: the page sends `viewMonth` when the playhead enters another month (at most four times a second while playing), and the worker answers for that month.
19. A tap on the map: with a paint or erase tool active, the tool acts, as today. Otherwise a tap on a project that exists on the playhead's day opens its card (`cards` is always on); a tap on a lot with no project there selects the policy whose rule or paint sets that lot's limit, if any, as today's layer selection does.
20. The map's bars read the `lookups` the worker posts (`onLookups` → `SimMap`'s lookups), and the card reads the lookups in its own answer. Both are for the playhead's month, so they agree.
21. An open card asks again whenever the playhead's month changes, as today, and after an edit once a `filled` message covers its day; until then it is marked stale with the rest (rule 31). "Funded by" names are resolved by `fundingName` against the document's money policies and the calibration's baseline funding.
22. `onResyncNeeded` from the map calls `TimelineClient.resyncMap()`.

## Playing

23. The playhead is a slider: `aria-label="Date in the simulation"`, its value text the month and year. Left and Right move a month, Page Up and Page Down a year, Home goes to the dataset date and End to the filled mark. A key, a drag or a marker jump pauses playback. The month readout beside it has a fixed width (the widest month-year label, `tabular-nums`), so nothing in the timeline or the header moves as the month changes.
24. On open the playhead is at the dataset date and playback is paused. Nothing plays by itself (today's autoplay belonged to the Run button, which is gone); Play is always the reader's act, so reduced motion needs no special case. Play, pause, the speeds and "back to today" otherwise behave as today's scrubber does. Playback stops at the filled mark and resumes by itself when the mark moves on.
25. Any edit pauses playback. Play is unavailable until the forecast has been refilled to the end of the window, `filledThrough === lastIndex` (ruling OD-13), unless an error has stopped the filling (rule 35), when Play is available inside the filled part. The playhead does not move. `?seed=` is ignored and removed from the URL (ruling OD-4); the run slider, the run switcher and "another possible future" are removed from `/sim` (ruling R6).

## Results

26. The Results face is today's `SimResults`, fed from `TimelineView`, with every row it has today. Basis of each: the headline, "Actually completed" (the baseline), pipeline and new homes, homes in progress by stage, stopped projects, the housing-target rows: the average, at the playhead's month. The range: the band at that month, with today's wording "In 8 of 10 simulated futures: … to …" (the band is the 10 to 90 range of the 48 worlds). A new row, "This city": world 1's completed homes at that month (ruling OD-14). "What the plan adds": the mean of the paired differences with its band, against the comparison named as today (`scoreCopy`, from `ScoreStatics.compare`). `ScoreChart` stays, with the plan-effect series, the reference lines and its "Show as table". Income tiers and money: world 1, each headed "In this city". Sources stay. `HighWater` is not used: rows show the playhead's month whatever has been played.
27. The header score keeps today's parts. The number is `baseline.completedNet + mean.completedNet` at `lastIndex`, shown as "{n} homes by {year of the last month}"; until `filledThrough === lastIndex` it shows today's "calculating" text. The "vs FZP ±N" delta is the plan effect's mean `completedNetNew` at `lastIndex`, shown under today's condition. The housing-target meter reads the average at the target's deadline month, once filled that far. Its accessible name and description are today's with "by {year}" added; the paused-only announcement stays and reads the playhead's month.
28. Hovering or focusing a point of the chart row shows that month's three numbers.
29. The view is built once `compiled` has arrived (it carries `ScoreStatics`); `filled` chunks that arrive before it are kept and joined then.

## Loading, failure and stale states

30. Before the worker: today's load states are kept as they are (the manifest and calibration load with its "couldn't load" text and Retry; a dataset with no scenario data shows the map and today's message, the timeline is not rendered, and the worker is never started).
31. Stale: from an edit until the refill passes the playhead's month, the map, the Results rows, an open card and the header score are dimmed, and the status slot says "Updating". Today's line "These numbers are from before your latest policy change." is the explanation behind that status.
32. The status slot also carries the fill state: "Forecast filled to 2047" while filling, nothing when full. The slot reserves the width of its longest text. It is polite live text, updated at most once a second. Status is never placed among the buttons.
33. `compiling` with `failedCells`: today's notice and its Retry (`retryChunks`).
34. `error` with `bad-request` (a document the compiler rejects): a notice, "That change couldn't be applied."; the store undoes to the last document the worker accepted; the stale state ends when the previous forecast is whole again.
35. `error` with any other code: a notice with today's "The simulation couldn't load." or, after the first fill, "Part of the simulation stopped.", each with Retry, which sends `openTimeline` with the current document. Play stays available inside the filled part. An open card shows today's "Details unavailable".
36. A worker crash: today's status chip and Retry, which restarts the worker and opens the current document.

## Explanations wait for interest

37. No sentence that explains a number, a caveat or a method is on screen at rest. Each is reached from the thing it explains by hover, focus and tap, stays while pointed at, and closes with Escape. One shared component does this (`Explain.svelte`: wraps its target; a popover on desktop, an inline sheet line on phone). An explanation, once asked for, is still as short as it can be without being ambiguous: it does not spell out what the reader can infer. The partner's example (2026-11-13): "A forecast if nothing changes" is enough; adding which market and which policies, or what it is not, is belabouring it. New wording in rule 38 follows that, and when the builder carries an old text over it is cut the same way.
38. Today's texts and where they go. "Stays" means it is already behind a disclosure, a dialog or a selection and keeps its place.

| Text today (source) | Where it goes |
| --- | --- |
| The selected permitting preset's summary (`PermittingSection.svelte:124`, `timing.ts:99-138`) | Behind the preset's name in the editor |
| "Family Zoning Plan Local Program lots use / do not use the streamlined route." (`PermittingSection.svelte:168`) | The switch keeps a short label ("Local Program lots streamlined"); the sentence goes behind it |
| "Affordable homes: … of the cost is covered today; they start only by chance" (`FundingTab.svelte:449`) | A short figure stays ("Affordable homes: 62% covered"); the rest goes behind it |
| The guarantee-rate note (`MarketTerms.svelte:156`) | Behind the empty field |
| "Compare them with the violet lines…" (`ScoreChart.svelte:226`) | Behind the reference lines' legend entry |
| The twin paragraph, "To see what the plan itself does, each future is run twice…" (`SimResults.svelte:275`) | Behind "What the plan adds", cut to one sentence: "Each simulated city is run twice, with and without it." |
| "One possible future … not a forecast." (`SimResults.svelte:259`, Sources) and the market sentence "…it is not a forecast." | Reworded, since the page now claims a forecast (ruling R1), to the partner's wording: "A forecast if nothing changes." Behind the headline and in Sources |
| "Whether the money lasts, and how many homes it pays for, is what a run shows." and other funding copy that says "a run" (`funding-copy.ts`) | "run" becomes "the forecast"; each stays behind its disclosure |
| The per-home sentence of `MONEY_SOURCES` ("…counted when the funded project completes…") | Reworded to rule 2 of the `world-score` spec: displaced homes are counted in the month the start they replaced would have happened; stays in Sources |
| The band's "(still calculating)" suffix | Gone: a month's range is final when shown |
| The three notices (`sim-session.ts:33`, `funding-copy.ts:350, 358`) | Stay as notices: they report something that happened to the reader's document |
| New (ruling OD-12): "Chance only. A few large sites carry most of it." | Behind the range, in Results and on the band |
| New: "One of 48 simulated cities." | Behind each "this city" label |
| New: "Capacity in {last year}." | Behind the capacity figure |

39. Every other text of 12 words or more that today's page shows at rest, if the builder finds one not in the table, goes behind the thing it explains; the test of rule 37 finds them.

## Switching over

40. The switch has four parts, all made here: `/sim` and `/s/<id>` load, autosave, publish and remix through the schema 4 codec; the autosave key moves to `sfhousing:sim:v2` with the old key's document carried over; `/api/policies` validates with the schema 4 strict parser; on load, `reconcilePolicy4` runs and its report feeds today's notices and the "upgraded" notice.
41. `SimPage.svelte` keeps the map tools, the notices, publish and history buttons; its tabbed dock is replaced by the timeline and the editor. `FzpMode.svelte`, `TimeScrubber.svelte`, `RunSlider.svelte`, `run-slider.ts`, `run-switch.ts`, `seed.ts` and `high-water.svelte.ts` are deleted if nothing else imports them after the switch, and kept untouched if `/lesscars` does.
42. The e2e hook `window.__sfhFzp` keeps its name and gains what the tests need (`filledThrough`, the playhead day, the policy); `e2e/helpers/run.ts` stops reading ranks.
43. Docs: `docs/dev/sim-page.md`, `fzp-mode.md`, `sim-timers.md` and `sim-funding.md` are brought up to date, and `docs/dev/sim-timeline.md` (the timeline, the document, the worker messages) is created or completed and linked from `CLAUDE.md`.

## Tests that must pass

Assert, in signoff:

- Component tests for: closed and open rows from a document; the fixed rows; the Public money kind absent without funding data; a bar's keyboard moves (rule 11) producing the expected document; adding, switching off, removing and reordering a policy; undo and redo across those.
- The playhead's slider semantics and keys (rule 23); playback stops at the filled mark and resumes; an edit pauses it and Play is unavailable until `filledThrough === lastIndex`; nothing plays on open.
- With a fake client: a `refill` drops months from that index and hatches them; the stale state begins on edit and ends when the refill passes the playhead; an open card re-requests then; `bad-request` undoes the edit and shows the notice; an error shows Retry and Retry sends `openTimeline`; a crash restarts.
- The header score's number is baseline plus the average at `lastIndex`, and "calculating" before that.
- Results renders every row of rule 26 from a fixture view, and the "this city" row.
- `viewMonth` is sent when the playhead changes month; `onResyncNeeded` calls `resyncMap`.
- View mode renders no editable control.
- `expectNoA11yViolations` on `/sim` with a kind open and the editor open, light and dark; every bar reachable and operable by keyboard; focus returns to the bar when the editor closes.
- Rule 37: a test that renders `/sim` at rest and fails on any text node of 12 words or more outside a notice, a dialog or an open explanation.
- e2e: open `/sim`, see the headline settle; add a transit rule from 2031 and see the forecast refill from 2031 with months before it unchanged; publish, open the `/s` link, see the same timeline; open a stored schema 3 link and see the "upgraded" notice.

`test:perf`: `npm run bench:map` still meets its bar with the timeline docked.

## Left to the builder

- Component boundaries inside `src/lib/timeline/`, and how today's editors are hosted in the inspector.
- Exact colours and spacing, taken from the mockups and the existing tokens.
- The wording of short labels, within rule 37.

Decided here, not left: the rows and their order (rule 2), open and closed behaviour (rules 5 and 6), the fixed rows and when Public money exists (rules 7 and 8), keyboard equivalents (rules 11 and 23), where a new policy starts (rule 12), which month the overlays and prices describe (rules 10 and 18), what a map tap does (rule 19), that nothing autoplays (rule 24), playback after an edit (rule 25), the basis of every Results row and of the header score (rules 26 and 27), every failure state (rules 30 to 36), and where each standing text goes and its new wording (rule 38), and that explanations are cut to what cannot be inferred (rule 37).

## Global constraints

{{CONSTRAINTS}}
