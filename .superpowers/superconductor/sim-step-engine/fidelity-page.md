# Fidelity review: page, score, band, comparison, protocol, map, other

Reviewer's share: every clause of `scratch/source-clauses.md` whose topic is page, score, band, comparison, protocol, map or other. That is 459 clauses (page 208, score 67, band 13, comparison 26, protocol 55, map 58, other 32).

The package checked: the design `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md` and the seven specs `docs/superpowers/specs/2026-11-13-*-design.md`. Every GAP below was checked against the original sentence in its source file, not against the checklist's condensed text.

Classes: **U** untouched (framing (a); includes clauses an earlier old document had already superseded before this package), **CA** carried (b), **CH** changed on purpose (c), **DR** dropped on purpose (c), **GAP**.

## 1. Counts

| § | Source document | Clauses | U | CA | CH | DR | GAP |
|---|---|---|---|---|---|---|---|
| 1 | design/2026-10-16-1903-fzp-timelapse.md | 75 | 28 | 25 | 12 | 0 | 10 |
| 2 | design/2026-11-09-1911-sim-financing.md | 23 | 5 | 15 | 2 | 0 | 1 |
| 3 | specs/2026-10-16-fzp-mode-design.md | 81 | 8 | 37 | 8 | 6 | 22 |
| 4 | specs/2026-10-16-stage-calibration-design.md | 9 | 7 | 1 | 0 | 0 | 1 |
| 5 | specs/2026-10-16-timelapse-render-design.md | 47 | 33 | 5 | 0 | 0 | 9 |
| 6 | specs/2026-10-16-timelapse-sim-design.md | 55 | 8 | 27 | 13 | 1 | 6 |
| 7 | specs/2026-10-28-sim-policy-levers-design.md | 9 | 5 | 3 | 1 | 0 | 0 |
| 8 | specs/2026-10-31-sim-runs-design.md | 34 | 9 | 6 | 5 | 8 | 6 |
| 9 | specs/2026-11-09-finance-engine-design.md | 12 | 6 | 4 | 2 | 0 | 0 |
| 10 | specs/2026-11-09-finance-levers-design.md | 9 | 3 | 5 | 0 | 0 | 1 |
| 11 | specs/2026-11-09-finance-score-design.md | 33 | 4 | 20 | 3 | 0 | 6 |
| 12 | specs/2026-11-09-funding-ui-design.md | 46 | 21 | 12 | 4 | 1 | 8 |
| 13 | specs/2026-11-09-market-baseline-design.md | 3 | 0 | 2 | 0 | 0 | 1 |
| 14 | specs/2026-11-10-paired-draw-fix-design.md | 4 | 1 | 2 | 0 | 0 | 1 |
| 15 | specs/2026-11-10-run-slider-design.md | 19 | 0 | 0 | 1 | 18 | 0 |
| | **Total** | **459** | **138** | **164** | **51** | **34** | **72** |

The 72 GAP clauses group into 21 findings: **6 blockers** (31 clauses), **9 should-fix** (35 clauses), **6 notes** (6 clauses). Section 4 lists them.

## 2. Changed on purpose (51) and dropped on purpose (34)

### Changed on purpose

| Clause | Citation in the new package |
|---|---|
| C23 | S14 (new messages); design 3.6. "Scrubbing never round-trips to the worker" still holds |
| C25 | timeline-ui Purpose and rule 28 (the scrubber becomes the timeline); reroll goes by R6 |
| C46 | S14 replaces `initScenario`/`reroll`; seed `null` (representative) goes by R6 and OD-4 |
| C47 | S14; ensemble-runner rule 17 adds code `'timeline'`; the provisional band goes because months are final (design 3.6) |
| C48 | S14 (`filled` replaces band-only updates) |
| C64 | world-score rule 8 (mean of paired differences, ±1.2816 sd); OD-3 |
| C65 | OD-3; world-score rule 6 |
| C94 | R8, R9; timeline-ui rules 3 and 4 |
| C117 | timeline-ui rule 20, OD-4 (seed leaves the URL). The sources dialog stays under rule 26 |
| C129 | design 3.6 (a month is final once every world reaches it); S15 |
| C146 | S14 drops `bandRunsTotal`; OD-3 |
| C170 | S14 (no revision-0 score); timeline-ui rule 21 ("calculating" text) |
| C224 | design 3.5 row "Money owed after 2066, added borrowing, limit statements"; world-score rule 10 |
| C289 | world-score rule 10; design 3.5 |
| C322 | timeline-ui "Defined here" (`TimelineMode` replaces `FzpMode` types) |
| C330 | S14; ensemble-runner rule 18 (drops messages from an older rev) |
| C332 | S14 (`filled`, `cells`) |
| C341 | R9; timeline-ui rule 3 |
| C350 | timeline-ui rule 29 |
| C400 | design 3.6 (no provisional band) |
| C404 | timeline-ui "Tests that must pass" replace fzp-mode's acceptance criteria |
| C405 | timeline-ui rule 20, OD-4 |
| C567 | S14 |
| C571 | ensemble-runner Scope ("`router.ts`, `protocol.ts` and `worker.ts` ... may change") |
| C583 | ensemble-runner rule 18 (`TimelineClient`); the resync part is GAP F3 |
| C584 | S14 (new messages; `openTimeline` validation unstated, see note F19) |
| C622 | T1; world-score rule 1 (events filed by calendar month, not prefix sums of schedules) |
| C625 | world-score rule 8; OD-3 |
| C629 | OD-3 (48 worlds) |
| C630 | OD-3, OD-4 (seeds 1..W, mean ± 1.28 sd) |
| C632 | design 3.6, OD-3 |
| C633, C634 | ensemble-runner rules 5 to 8; R6 for reroll |
| C658 | world-score "Tests that must pass" |
| C662 | ensemble-runner rule 18 and tests |
| C671 | timeline-ui rule 20, OD-4 |
| C711 | design section 1 ("Policy has dates") and OD-9 reverse "no policy changes partway through a run"; "pre-FZP is never drawn" is carried (design 3.6) |
| C717 | ensemble-runner rules 6 and 16 |
| C720 | timeline-ui rule 14 (debounced `setPolicy`) |
| C725 | timeline-ui rule 21, design section 1, OD-14 (the headline is the window-end average). The baseline question is GAP F6 |
| C746 | R2; timeline-ui rules 2, 5 to 7 |
| C766 | ensemble-runner rule 17 |
| C793 | R5; world-funding rules 9 and 12 |
| C895 | world-score rule 10; design 3.5 |
| C905 | ensemble-runner rule 7; world-score rule 10 |
| C912 | timeline-ui rule 29 |
| C923 | timeline-ui rules 1 and 9 (inspector or sheet in place of the dock tab) |
| C931 | timeline-ui rule 7 (fixed row "City funding today") |
| C951 | OD-5 (the high-water mark goes) |
| C961 | timeline-ui rule 15 (view mode shows the timeline read-only) |
| C1032 | OD-3 (48 worlds); R6 (no median run) |

### Dropped on purpose

| Clause | Citation |
|---|---|
| C335, C358, C367, C368, C369, C401 | R6, OD-4; timeline-ui rule 20 (representative flag, "This future: #seed", `?seed=`, "Another future", "Back to the representative future") |
| C631 | R6; design 3.5 row "The representative run ..."; section 11 "Representative seed; ranks; run slider: Dropped by R6" |
| C706, C713, C714, C715, C716, C718, C719, C721 | OD-9; timeline-ui rule 13 (the lock and the Setup and Run phases go). The overlay rules inside C713/C714 are GAP F9; C721's initial page state is part of GAP F8 |
| C922 | OD-9 (the Funding tab is no longer read-only during a run) |
| C1033 to C1054 (C1033, C1034, C1035, C1036, C1038, C1039, C1040, C1041, C1042, C1043, C1046, C1047, C1048, C1049, C1051, C1052, C1053, C1054) | R6; timeline-ui rules 20 and 28 (the run slider, ranks, swap mode, slider URL) |

## 3. Untouched and carried (for audit)

**Untouched (138):** §1 C1, C3, C5, C22, C28, C29, C32, C55, C57, C71, C74, C79, C87, C90, C92, C110, C113, C115, C118, C119, C120, C123, C131, C159, C165, C167, C169, C171; §2 C301, C302, C304, C305, C314; §3 C328, C329, C338, C339, C344, C394, C395, C398; §4 C408, C412, C413, C418, C422, C424, C441; §5 C510, C511, C513, C514, C515, C516, C525, C526, C527, C528, C529, C530, C531, C532, C534, C535, C540, C541, C542, C543, C547, C548, C549, C550, C551, C552, C553, C556, C558, C559, C560, C561, C565; §6 C566, C568, C573, C575, C580, C602, C639, C661; §7 C669, C678, C683, C693, C701; §8 C705, C738, C739, C740, C743, C748, C749, C750, C751; §9 C757, C758, C759, C825, C827, C828; §10 C834, C836, C847; §11 C893, C910, C911, C913; §12 C915, C916, C918, C919, C920, C925, C929, C933, C937 to C947, C965, C967; §14 C1031.

**Carried (164), with where:**

- Cards (projectCard, chooseProject, visibility, labels, stories tiers, massing note, stages filtered by day, chance): world-score rule 12, S8, S14 (`parcelSummary` keeps its meaning and gains `lookups`). C49, C50, C51, C52, C53, C107, C112, C137, C144, C162, C172, C174, C370 to C383, C406, C425, C574, C640 to C647, C659, C809.
- Score series, months, baseline, phasing, targets, references: world-score rules 1, 2, 9, `ScoreStatics`. C62, C63, C66, C67, C108, C109, C126, C399, C590, C618, C623, C624, C626, C627, C628, C682, C894.
- Comparison and pairing: design 3.6; S13 `comparisonOf`; policy-timeline rules 18 and 19; world-score rule 8. C70, C147, C200, C279, C296, C315, C579, C621, C656, C708, C724, C726, C728, C848, C854, C855, C1012, C1028 (the last two through the global constraint "A lever that changes only timing ...").
- Tiers and money functions reused for world 1: world-score rule 10. C182, C223, C225, C232, C233, C281, C286, C287, C288, C290, C292, C792, C811, C876, C877, C879 to C888, C890, C891, C892, C896, C901, C909, C914.
- Old host and dataset loading: ensemble-runner rules 1 to 3. C45, C582, C585, C586, C587.
- Map packing and massing through map-stream: C127, C507, C509, C512, C517, C520, C636, C637, C660.
- Page: C80 and C340, C403, C963 (global WCAG 2.2 AA); C116, C345, C346 (rule 16); C321, C324, C331 (`TimelineMode` keeps the load and error props; rows reused); C351, C952, C953, C954, C964 (rule 22, results "as today"); C356 (rule 22 targets); C359, C360, C385 to C393, C949, C958, C959, C1002 (rule 26: texts behind a disclosure stay); C396; C687, C846, C858 (policy-timeline 21 and 22, timeline-ui 15 and 27); C698; C729 (rule 1); C736, C934 (rules 9 and 11); C765 (policy-timeline 5); C930 (rule 25 coverage figure); C948 (rule 13); C962 (rule 25 notices); C1003 (`REFERENCES` unchanged).

## 4. GAPs

Blocker: a user-visible behaviour, guarantee or number would change or vanish without a decision, or a team could not build the spec as written. Each finding lists its clauses; the quote is from the source document.

### F1 (blocker). Demolitions cannot reach the map after the first update

- **Clauses:** C24 (fzp-timelapse :97), C54 (fzp-timelapse :116, T7), C114 (fzp-timelapse :282), C508 (timelapse-render :15), C521 (timelapse-render :184), C554 (timelapse-render :521, PC-6), C564 (timelapse-render :669).
- **Original:** "It hides each existing building from its project's construction start." (:97) T7: "`demolish: { parcelId: ParcelId; day: Day }[] /* complete list in revision 0 (needs no geometry); empty afterwards */`". "**Late demolish entries.** `demolish` must be empty after revision 0 (T7). A non-empty list on a later revision is ignored, with one `console.error`." (render :184). "The existing building on each `demolish` parcel shows the `replaced` footprint from its day, and returns when scrubbed earlier." (render :669)
- **What the package says:** map-stream rule 7: "`demolish` lists, in revision 0, every demolition known so far, and in later revisions is empty, with demolitions carried by the cells as today." The cells do not carry demolitions. In the renderer, an existing building is hidden only by the `demolish` list (the demolish pump in render section 4.5). Under streaming, revision 0 holds only the demolitions known when it is sent: pipeline projects already under construction. Every construction start the world reaches later never reaches the map, so the old building stays standing inside the new one. After a `rewind`, a demolition that no longer happens cannot be taken back, because map-stream sends revision 0 only "if nothing is on the map yet". The map-stream referee test compares cells only, so it would not catch this. The package also says "the map itself does not change", which rules out the obvious fix.
- **Proposed fix:** record a decision in the design and in map-stream. Either (a) change T7/PC-6 so later revisions can add and retract demolish entries, an admitted map change with its own test; or (b) have map-stream send a revision-0 snapshot (all cells and the full demolish list) whenever the demolish set changes or after every rewind, with that cost measured. Add a map-stream test: a simulated project that enters construction in month 30 hides its parcel's existing building from that day, and the building returns after a rewind that removes the project.

### F2 (blocker). The map's lookups (bar colour, bar fill, construction floors) lose their source

- **Clauses:** C61 (fzp-timelapse :117, T12), C506 (stage-calibration :812), C533 (timelapse-render :307-311), C536 (timelapse-render :318), C1024 (paired-draw-fix :70).
- **Original:** "Pipeline validation, the worker, the renderer (lookups uploaded once) and the card all use these; nothing re-implements them. The bar colour and the card's "chance of finishing" both come from `chanceTable`." (T12). "**Before lookups arrive**, bars are not drawn, construction shows no solid floors until completion, and dev builds warn once." (render :318). "The card keeps its chance shift from the rescaled display table ... My call: the card must agree with the engine." (paired-draw :70)
- **What the package says:** Today the map's lookups arrive in the worker's `levers` message (`phase: 'current'`, `lookups: LeverLookups`, `src/lib/sim/scenario/types.ts:260-276`; `docs/dev/sim-page.md` "Map lookups (Call 13): the map gets the worker's posted `lookups.fresh`"). S14 removes `levers`. Its replacement, `compiled`, carries only `capacity` and `unknownLots`. Only `ParcelSummary` gains `lookups`: the frame's tables, for the card. No spec says what `setTimelineLookups` receives, or when. With dated permitting policies the stage tables differ by month, while the map takes one set. PC-4 (render :519) adds a trap: a new lookups object re-encodes `tlC` (construction timing), but "the same object sent again ... skips the `tlC` re-encode, so construction-floor timing stays stale until the next revision 0", and map-stream rarely sends revision 0. Bar colour and the card's chance no longer have one agreed source.
- **Proposed fix:** S14 is a D row, so the orchestrator can amend it. Add the map's lookups to `compiled` (or to a new `lookups` message), say in timeline-ui which frame they describe (for example the frame in force at the playhead, re-sent as a fresh object when the playhead crosses a permitting change), and record whether a bar and a card may disagree across a dated timer change. Add a test: the map receives lookups before the first `cells`.

### F3 (blocker). Map revision gaps freeze the map; there is no resync path

- **Clauses:** C173 (fzp-timelapse :654, IA-23), C334 (fzp-mode :141), C518 (timelapse-render :168-171), C652 (timelapse-sim :745).
- **Original:** "otherwise the revision must equal `last + 1`, or the update is discarded and the shared `onResyncNeeded` callback fires" (render :169). "**Resync** (`onResyncNeeded`): call `client.resync()` ... the same seed gives a fresh revision-0 snapshot." (fzp-mode :141). "The worker posts only updates that satisfy T7, in revision order per `(rev, seed)`." (timelapse-sim :745)
- **What the package says:** map-stream rule 7 numbers revisions as one sequence across rewinds. ensemble-runner rule 18 has the client drop "any message whose `rev` is older than the last `setPolicy` it sent, except `filled`, `cells` and `refill` for a timeline rule 13 kept". A `cells` message posted under rev n that arrives after the page sent rev n+1 is dropped whenever the plan timeline will restore, and the worker cannot know that before the message arrives. The map then sees a revision gap, discards every later update and fires `onResyncNeeded`. No message in S14 asks for a fresh snapshot, and timeline-ui does not mention `onResyncNeeded`. The map would stay frozen until reload.
- **Proposed fix:** in ensemble-runner, never drop `cells` by `rev`: the map's revision sequence is separate from the policy's, so let the client forward every `cells` message in order. Also add a message that asks for a snapshot (for example `{ type: 'resyncMap' }`), answered by map-stream with revision 0 (every cell and the full demolish list, which F1 needs too). Wire `onResyncNeeded` to it in timeline-ui. Test: two `setPolicy` messages in quick succession, then the map still applies every later update.

### F4 (blocker). No error, crash, loading or no-data states for the timeline page

- **Clauses:** C130 (fzp-timelapse :335), C325 (fzp-mode :117), C326 (fzp-mode :119), C327 (fzp-mode :120), C336 (fzp-mode :149-151), C337 (fzp-mode :153-159), C648 (timelapse-sim :677-685), C857 (finance-levers :205), C955 (funding-ui :378-385).
- **Original:** "`failed`: "The simulation couldn't load." plus a **Retry** button (≥ 44×44 px ...)". "`no-scenario`: the map still renders (existing buildings only). A panel says: ... There is no scrubber, scoreboard or "Another future" button, and the worker is never started." "After `ready`: ... A status chip reads "Part of the simulation stopped. Retry". Card requests resolve `null`, and the card shows "Details unavailable"." "Crash Retry sends only `initScenario`." "on a `LeverFormatError` it posts `{ type: 'error', ... code: 'bad-request' ... }` ... and leaves `w.loaded`, `w.run` and the band as they were, so the previous revision stays in force". "A revision failed ... The rows keep the last run's numbers under the existing line "These numbers are from before your latest policy change."" (funding-ui :385)
- **What the package says:** ensemble-runner rule 17 posts `error` with code `'timeline'` and "stops filling until the next `setPolicy` or `openTimeline`". `TimelineClient` has `onError` and `onCrash`. timeline-ui has no failure rule. It does not say what the page shows on a failed load, on a dataset without scenario data, on a crash, or on a `'timeline'` error; what Retry sends (presumably `openTimeline` with the current document, which reproduces the same worlds); what happens to the `compiling` message's `failedCells` (today an "Updating the simulation for your policy" notice with Retry); or what an invalid document does. Rule 18 makes Play unavailable "until the forecast has been refilled to the end of the window", so after an error stops filling, Play never comes back. "Loading the simulation…" before the first `filled` is not stated either: rule 21 covers only the headline.
- **Proposed fix:** add a "Failure and loading" section to timeline-ui. It should list each state (loading, no-scenario, failed load, crash after ready, `'timeline'` error, compile failure with `failedCells`, invalid document), its copy, where it shows (a notice or the status slot, not among the buttons), what Retry sends, what Play does, and what an open card shows. In ensemble-runner, say that an invalid document answers `bad-request` and keeps the previous timeline filling.

### F5 (blocker). The Results face loses its honesty rows

- **Clauses:** C84 (fzp-timelapse :148), C353 (fzp-mode :237-242), C357 (fzp-mode :253-254), C950 (funding-ui :344-352).
- **Original:** "**Honesty of numbers.** ... Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown." (fzp-timelapse :148). Results order: "1. The headline and "built by today" ... 4. The chart and the RHNA rows ... 6. Pipeline and new projects, homes in progress, stopped projects (unchanged). 7. Sources (unchanged ...)" (funding-ui :346-353).
- **What the package says:** timeline-ui rule 22: "The results face shows, for the playhead's month: this city's count, and the typical count with its range (ruling OD-14); what the plan adds ...; targets; money and income tiers". It reads as a complete list and leaves out several existing rows: "Actually completed, to {asOf}" (the baseline), the split into today's pipeline and new projects, homes in progress by stage, homes in stopped projects, the chart and RHNA rows, and Sources. No ruling drops them. `MonthRow` still carries every field (S15), so the data exists. The new face also has two bases (the mean and world 1), and nothing says which one each kept row uses.
- **Proposed fix:** timeline-ui rule 22 should list every row of today's `SimResults` and give each its basis: the mean (with the band, where one exists) or "this city". Any row that goes needs a recorded decision. If `SimResults` is reused, say so and name the props it reads from `TimelineView`.

### F6 (blocker). The header score's formula and its comparison delta are undecided

- **Clauses:** C352 (fzp-mode :234-236), C908 (finance-score :279).
- **Original:** "**Headline:** `formatCount(baseline.completedNet + shown[i].completedNet)` and "net new homes since {Mon D, YYYY of baseline.since}"." (fzp-mode :236). "The headline stays "{n} homes added" with "vs FZP ±N" (`score-view.ts:149-161`; `docs/dev/sim-page.md` item 1)." (finance-score :279). Today's header also has a 4 px RHNA progress meter and a paused-only polite announcement (`docs/dev/sim-page.md`, Layout item 1).
- **What the package says:** timeline-ui rule 21 decides when the headline is read: "the average of completed net homes at the end of the window, with the end year: "148,000 homes by 2066"" (also design section 1 and OD-14). It does not decide three things. (1) Whether the baseline is included. `completedNet` excludes the baseline (T8), and world-score's `mean` and `band` are on `completedNet`, so read literally the headline drops the actual completions since 2022-06-30 (8,709 live). (2) The "vs FZP ±N" delta under the count, and the month it is read at. (3) The RHNA meter. The same baseline question applies to the band shown beside the headline (today shown as p10 + baseline to p90 + baseline, fzp-mode :243).
- **Proposed fix:** timeline-ui rule 21 should give the formula (`baseline.completedNet` + mean `completedNet` at the last window month, and the band on the same basis). It should keep the delta and the meter or drop them by a recorded decision, saying which month each is read at, and restate the button's name and description and the announcement.

### F7 (should-fix). The chart loses the plan effect, the reference lines and its text alternative

- **Clauses:** C140 (fzp-timelapse :370-374), C362 to C366 (fzp-mode :267-299).
- **Original:** "Both published estimates are increments over prior zoning, so the reference lines compare with it" (:370). Marks include "plan effect, completed ... plan-effect band ... plan effect, approved ... each T8 reference: dotted horizontal line ... labelled "(compare with: {series name})"". "Every stroke has ≥ 3:1 contrast ... told apart by its dash pattern, plus a legend in text". "The chart is a `<figure>` whose SVG has `role="img"` and an `aria-label` summary ... A `<details>` "Show as table" ..."
- **What the package says:** timeline-ui rule 4's chart draws the average, the band, "this city" and the target marker. Rule 25 moves the reference-legend sentence "Behind the reference lines' legend entry", but rule 4 draws no reference lines. No rule says whether the Results face keeps `ScoreChart` with the plan-effect series and references. Rule 23 (hover or focus a point) is the timeline chart's only text equivalent, with no summary or table.
- **Proposed fix:** say whether `ScoreChart` stays in Results, fed from `TimelineView` (`planEffect`, `planEffectBand`, `references`). Give the timeline chart an accessible name with a summary and a table or list equivalent, and keep the 3:1 contrast and dash rules.

### F8 (should-fix). Playhead controls lose their keyboard map, markers, readout and autoplay rule

- **Clauses:** C89 (fzp-timelapse :153), C342 (fzp-mode :183-196), C343 (fzp-mode :197-201), C347 (fzp-mode :208-209), C361 (fzp-mode :262), C712 (sim-runs :40), C747 (sim-runs :236-241).
- **Original:** "The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works." `aria-label="Date in the simulation"` and `aria-valuetext`; "Home / End | `asOf` / `horizon`"; "Any key, drag or marker jump **pauses** playback." Markers "RHNA deadline" and "2045", named "Jump to RHNA deadline, January 2031". Autoplay unless `prefers-reduced-motion`. Anti-goal: "The timeline bar or header moving as the month changes." "the month readout sized to the widest month-year label ... with `tabular-nums`".
- **What the package says:** timeline-ui rule 16: "Play, pause, the speeds and "back to today" behave as today's scrubber does. The playhead can be dragged along the ruler and moved with the arrow keys." Rule 28 deletes `TimeScrubber.svelte`. Nothing gives the playhead's role, name and value text, Page Up/Down, Home/End (to the window's end or the filled mark?), the month readout, the jump markers, autoplay on open and its reduced-motion exception, where the playhead starts on open (the old Setup pinned it at the present day, C721), whether a key or drag pauses, or the paused-only announcement. Rule 19 also changes the status-slot text as the fill moves ("Forecast filled to 2047", then nothing, then "updating"), but reserves no width for it.
- **Proposed fix:** add to timeline-ui rule 16 the key table, the slider semantics and value text, the readout and its fixed width, the markers (or a recorded drop), the autoplay and reduced-motion rule, the starting day, and the paused announcement. Rule 19 should reserve the status slot's width.

### F9 (should-fix). Overlays and map taps were tied to Setup and Run, and nothing replaces that

- **Clauses:** C710 (sim-runs :23-25), C742 (sim-runs :200-202), C744 (sim-runs :210-218), C745 (sim-runs :219-220).
- **Original:** "Height fog ... Its height at each point is the effective limit there: FZP as written plus your painting. ... It is toggled in the view menu and shown in Setup only." "Transit: the same view menu as `/` ... is mounted on `/sim`, shown in Setup only." "The paint feedback and the lot tooltip show what can be built: "Allowed: 40 · Buildable here: 6"."
- **What the package says:** OD-9 removes the phases, and timeline-ui rule 28 says only that `SimPage` "keeps the map tools". Nothing says when the view menu and its overlays are shown (today a run hides them: `view = run.phase === 'setup' ? viewPrefs : HIDDEN_VIEW`, `docs/dev/sim-page.md` "Map overlays"). Nothing says which month's zoning the height limits, `heightLids` and the lot tooltip describe now that zoning is dated. And nothing says what a map tap does: today it selects the policy layer in Set Policy and opens a project card in a run (`cards` is `run.phase === 'run'`).
- **Proposed fix:** add a timeline-ui rule. Overlays are offered at all times (or under a stated condition). Limits, lids and the tooltip show the zoning in force at the playhead (or at the selected policy's span), and the worker answers `heights`/`heightLids` for that month. A tap with the Move tool opens the card, and selecting a policy goes through the timeline (or the reverse), recorded.

### F10 (should-fix). Money series definitions do not survive the event engine

- **Clauses:** C291 (sim-financing :214, F14), C898 (finance-score :208-212), C900 (finance-score :220-224), C902 (finance-score :229), C904 (finance-score :246-255).
- **Original:** "`displacedHomes[i]`: Σ of `funding.displaced` (F10) over the same schedules ... The displaced start's own completion date is not tracked; its homes are counted in the month the funded project completes". `MONEY_SOURCES`: "... counted when the funded project completes. Homes displaced by funded projects that dropped out or are still being built at the end of the run are not counted." "`limits = limitStatements(addedBorrowing(plan.finance, baseline, asOf, horizon))` ... computed from the inflows, the policy's input, and not from the ledger, so the statements are the same in every seed".
- **What the package says:** world-score rule 10 says money and tiers are "built from its ledger and its completions with today's functions". But today's functions read `Schedule.funding.displaced` at the funded project's completion month. The new engine sends `displaced` as its own event in the month the shadow passes (world-funding rule 17), which can fall before or after completion, or happen for a project that never completes. So `displacedHomes`, `perAddedHome` and the `MONEY_SOURCES` sentence change meaning without a stated rule. `addedBorrowing` takes one undated `SimInput.finance` and a horizon. A schema 4 document has dated money frames, and rule 10's "which limit binds ... read at `filledThrough`" does not say which `plan.finance` or which horizon, or that limits stay independent of the ledger and of the seed.
- **Proposed fix:** add world-score rules. `fundedHomes` counts `'end'`/`complete` events of funded rows. `displacedHomes` counts `'displaced'` events by their own month, or by the funded completion, chosen and recorded. `addedBorrowing` takes the pools of the timeline's `FinanceFrame` union with arrivals through `filledThrough` (or the window). Then reword the `MONEY_SOURCES` per-home sentence, listed in the timeline-ui rule-25 table.

### F11 (should-fix). The standing-text inventory is incomplete, and two kept texts contradict R1

- **Clauses:** C355 (fzp-mode :247-251), C924 (funding-ui :166), C935 (funding-ui :212), C957 (funding-ui :393-394), C1001 (market-baseline :360-367).
- **Original:** the twin paragraph: "To see what the plan itself does, each future is run twice ... The twin paragraph is always shown." The Sources paragraph "One possible future … not a forecast." (market-baseline :360) and `marketSentence` "... This holds today's market; it is not a forecast." "Whether the money lasts, and how many homes it pays for, is what a run shows." "Starting a run with a draft open discards it, and the run's announcement adds "An unfinished item was discarded.""
- **What the package says:** the global constraint requires the timeline-ui and world-score specs to "list each text they carry over from today's page with where it goes". Rule 25's table lists eight texts and leaves out these, along with the stale line, the per-home "high early" detail, the band label (note F17) and the `MONEY_SOURCES` sentence (F10). Rule 26 keeps the "not a forecast" sentences unchanged behind their disclosure, which contradicts design section 1 and R1 ("The page claims a forecast ... under current policy"). The funding texts refer to "a run", which no longer exists. A draft is discarded on "starting a run", so with no runs it has no discard trigger.
- **Proposed fix:** complete rule 25's table, give new wording for the "not a forecast" sentences under R1, reword the run-referring funding copy, and give drafts a trigger (for example, an edit elsewhere or closing the editor).

### F12 (should-fix). When the Public money row exists is unstated

- **Clauses:** C921 (funding-ui :122), C966 (funding-ui :531).
- **Original:** "Funding needs a calibration with both `market` and `baselineFunding`, the same condition on which `buildSimInput` sets `finance` (F9) ... an empty tab would mislead." Acceptance 1: "`/sim` offers a fifth tab, Funding ..., exactly when the calibration has `market` and `baselineFunding`; otherwise the tab is absent".
- **What the package says:** timeline-ui rule 2 always shows "Public money" and rule 7 always shows the fixed row "City funding today". Nothing covers a calibration without funding, or a document whose `FundingLoadReport.unusable` is set (funding-ui :441: "with `unusable` no Funding tab, run has no public money"). policy-timeline does not say that money policies compile to `finance: null` in that case.
- **Proposed fix:** timeline-ui: the Public money kind and its fixed row appear exactly when the calibration has both; when the data is unusable, money policies are drawn dimmed and read-only. policy-timeline: those policies give `finance: null`.

### F13 (should-fix). An open card is not refreshed after an edit's refill

- **Clauses:** C349 (fzp-mode :223), C384 (fzp-mode :388).
- **Original:** "When the month index changes, it re-requests `parcelSummary(parcelId, day, projectId)` ...". "On reroll the card re-requests its parcel."
- **What the package says:** an edit can remove or change the project under an open card. ensemble-runner rule 17a answers a request "for a day past the last month stepped ... for the last day stepped". No rule re-requests on `refill` or `filled`, and rule 18's stale marking covers the map and figures but not the card.
- **Proposed fix:** timeline-ui: an open card re-requests when a `filled` message, after a `refill` from or before its day, covers its day, and it is marked stale until then.

### F14 (should-fix). No first-paint budget

- **Clauses:** C635 (timelapse-sim :592), C665 (timelapse-sim :935-983; budget rows :701-702).
- **Original:** "Revision 0 ... plus every ready anchored cell packed within 2.5 s of the request." Budget rows: "`initScenario(null)`: from fetched files to the first timeline (the shown FZP run) ... ≤ 3 s"; "`reroll` → revision 0 ... ≤ 3 s".
- **What the package says:** ensemble-runner gives a whole-window bar (about 4.3 s) and map-stream gives a per-flush bar. Nothing bounds the time from `openTimeline` to the first map paint or to the first `filled` month, and rule 21 holds the headline at "calculating" until the window is full.
- **Proposed fix:** have ensemble-runner rule 4 and map-stream rule 1 measure and state the times to first cells and to first `filled`, with budgets at or under today's 3 s.

### F15 (should-fix). map-stream rule 2 places cells by the wrong parcel

- **Clauses:** C128 (fzp-timelapse :333), C522 (timelapse-render :188).
- **Original:** "Cell placement uses the smallest `ParcelId`. The slot's pick parcel is the largest-area parcel. Both rules are deliberate and stated in their specs."
- **What the package says:** map-stream rule 2: "Its cell is the cell of its pick parcel (the project's largest-area parcel), as `createGeometry` assigns it." The rule contradicts itself, since `createGeometry` places by the smallest id. A builder who follows its words fails map-stream's own cell-for-cell test.
- **Proposed fix:** "A project's cell is the cell of its smallest `ParcelId` (`createGeometry`'s placement); its slot's pick parcel is the largest-area parcel."

### Notes

- **F16 (note).** C651 (timelapse-sim :728): "Memo cap | 60,000". map-stream rule 9 keeps each massing "until the project's row changes" and gives no cap, and does not say whether rows removed by a rewind are evicted. State a bound.
- **F17 (note).** C354 (fzp-mode :243): "**Band:** "In 8 of 10 simulated futures: {p10 + baseline}–{p90 + baseline}"". The band is now mean ± 1.2816 sd over 48 worlds (OD-3), which design section 2 shows is within 3% of p10 to p90. Record whether the "8 of 10" wording stays. The "(still calculating)" suffix goes by design 3.6.
- **F18 (note).** C889 (finance-score :137): "the four tier fractions, weighted by their targets, sum to less than the total's progress by exactly ...". Tiers now describe world 1 (world-score rule 10) while the RHNA total target uses the mean (rule 9), so that relation no longer holds on one face. Rule 22's "in this city" label covers it in part; add a sentence to the explanation.
- **F19 (note).** C581 (timelapse-sim :215-218): "An `init` disposes the scenario state, and an `initScenario` disposes the editor state", and shared requests go to the host of the latest init. ensemble-runner rule 2 does not say how `openTimeline` fits that routing, or how `openTimeline` is validated (cf. C584).
- **F20 (note).** C537 (timelapse-render :320-330): the declutter and bar rebuild run "on each bar rebuild". Streaming sends `cells` throughout filling and after every edit, during playback, while timeline-ui's `bench:map` test covers only a docked timeline at rest. Add a bench while filling.
- **F21 (note).** C960 (funding-ui :409-417): "Funded by" names are resolved "against the run on show's levers plus `calibration.baselineFunding`". With schema 4 they come from money policies. `FundedStart.programmes` holds indices into the `FinanceFrame` union (S12), while `ProjectCard.funding.programmes` holds ids, so `fundingName` must be defined against the document.

## Appendix

**Read in full:** the design `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md`; the seven specs `docs/superpowers/specs/2026-11-13-{world-core,world-funding,policy-timeline,ensemble-runner,world-score,map-stream,timeline-ui}-design.md`; every my-topic row of `scratch/source-clauses.md` (459 rows), its appendix, and its header.

**Read in part (cited lines only):** fzp-timelapse design :97, :116-117, :148, :153, :281-283, :333, :335, :370-374, :654; fzp-mode :117-120, :141, :149-159, :183-209, :223, :234-263, :267-299, :388-389; timelapse-render :15, :168-189, :307-330, :516-523, :669 and its `demolish` passages; stage-calibration :812; timelapse-sim :185, :215-218, :563-565, :590-599, :677-685, :701-702, :728-751; sim-runs :23-25, :40-42, :85-89, :200-241; finance-levers :205; finance-score :133-139, :208-229, :246-255, :277-279; funding-ui :22, :120-122, :166, :212-213, :344-354, :378-394, :409-417, :531-533; market-baseline :360-367; paired-draw-fix :70. For context (not in the clause set): `docs/dev/sim-page.md` lines 1-60 and its overlay section; `src/lib/sim/scenario/types.ts:255-300` (the `levers` message); `src/lib/fzp/score-view.ts` (`homesAdded`). Mockup: `mockups/tracks-v3.png`.

**Not examined:** `mockups/policy-tracks-v2.html`, `policy-tracks-v3.html` and `tracks-v2-light.png` (beyond the v3 screenshot); the other reviewer's topics; the source documents beyond the cited lines (the checklist's condensed text was relied on for non-GAP clauses); the ledger.

**Clauses I could not classify with confidence:**

- C746 (policy pane sections). I counted it as changed on purpose by R2. Its rule that "both zoning sections open, others collapsed" has no direct counterpart; timeline-ui rule 8 ("Rows are closed by default") covers phones only.
- C1028 (the per-month "plan minus twin ≥ 0" acceptance for speed-ups). I counted it as carried by the global constraint, but no new test restates it.
- C961 (the read-only `PolicySummary` money section on `/s/<id>`). I counted it as changed by rule 15. Its coverage line has no stated home.
