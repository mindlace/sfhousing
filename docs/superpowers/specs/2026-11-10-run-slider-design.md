# Run slider: browse the 101 simulated futures on /sim

Status: draft for review, 2026-11-10.

## Intent

/sim runs every policy 101 times (`BAND_RUNS`, seeds 1..101, `src/lib/sim/scenario/band.ts`).
Each run is the same city under the same rules with different luck on every lot. Each lot
independently rolls whether and when it starts, its pathway, size, stage durations, dropouts,
revisions and phase gaps (`src/lib/sim/scenario/rng.ts`). Today the page shows one of those
runs, the median by final total, plus a p10–p90 band on the chart. People can't see what
the good-luck and bad-luck futures look like on the map.

The run slider lets a viewer walk through all 101 runs, ranked from best to worst. They see
the best case, the worst case and everything in between, on the map, in the headline and on
the chart.

## Goals

- In run mode, a vertical slider on the right edge of the map has one tick per band run: 101
  ticks.
- Runs are ranked by **net homes completed by the horizon (2066-12-31)**: the existing
  `finals()` order that `representativeIndex` already sorts by. The slider order is the exact
  reverse of `representativeIndex`'s ascending order (ties included), so the middle tick is always
  `representativeSeed()` (builder's call).
  The top of the slider is the most homes ("Best"), the bottom is the fewest ("Worst"), and the
  middle tick (rank 51) is the median run shown today.
- The slider starts on the median run, so the default view is unchanged.
- Moving to a tick switches the map buildings, the headline number, the chart's shown line, the
  Results face and tap cards to that run.
- **Switching takes roughly constant time**: a switch should feel about the same whether it is one
  tick or a jump from Best to Worst, zoomed in or at the default whole-city camera. Predictability
  matters more than a hard budget (owner's preference). Aim for ~300 ms to the first new buildings
  and a steady cadence while dragging, with a ceiling of 3 s for the full switch at the default
  camera on the live SF dataset. Some variation is unavoidable, because higher-ranked runs have
  more buildings to draw.
- **A mixed map mid-switch is acceptable** (owner's call). While a switch or a fast drag is in
  progress, some areas may still show the previous run(s) while others show the new one. The
  headline and chart may update ahead of the map.
- **Dragging is live, with adaptive skipping**: while the handle moves, the page shows the most
  recent run it can finish. A fast drag skips runs and a slow drag shows each one. On release the
  view always lands on the run under the handle. Superseded requests are dropped (latest wins),
  so skipping comes from the real switch cost and there is no fixed speed threshold.
- Labels: "Best" at the top end, "Worst" at the bottom end, and the run number next to the handle.
  Nothing else on the slider: the headline, map and chart changing is the feedback.

## Non-goals

- /lesscars. Its variants are precomputed in the pipeline and ship only the representative run's
  timeline. A slider there is a separate project.
- Ranking by any other measure (deadline totals, plan effect). Ranking is by the 2066 total only.
- Showing per-run statistics on the slider (percentile labels, totals per tick, a histogram).
- Changing how runs are generated, how many there are, or the band/p10–p90 display.

## Anti-goals

- The map blanking or flashing empty between runs. Old buildings stay until new ones replace
  them.
- A drag that queues up switches and keeps playing runs after the user has let go.
- A slider that holds off policy (lever) changes, or leaves the page stuck "busy".
- Browser history filling with one entry per tick.

## Decisions made with the owner

- All 101 runs are individually selectable; every tick is a distinct run.
- "Ideal"/"worst" means most/fewest net homes by the end (2066).
- Live update while dragging, skipping runs as speed rises.
- End labels "Best"/"Worst", run number by the handle, nothing more.
- **Remove "Another future".** Its random 32-bit seed is statistically the same as any band run
  but has no rank. The slider replaces it. Remove the header button, its Menu entry and
  `anotherFuture()` (`src/lib/fzp/FzpMode.svelte:489`, header button ~:992-1004).

## Constraints and facts the design rests on

From recon and a latency profile on the synthetic bench city (live-SF numbers not yet taken):

- The worker already keeps every band run's final total. `finals()` is available once all 101
  FZP runs are set, about 1 s after revision 0. Before that the ranking does not exist.
- Recomputing one run in the worker is cheap: `simulateDetailed` + `shownSeries` ≈ 17–20 ms.
  Caching detailed runs is not worth it (≈ 5 MB each, 525 MB for 101).
- Building generation is ≈ 25 µs per building on a memo miss. Two seeds share only ~3 % of
  simulated buildings (pipeline projects ~92 %), so the memo doesn't help across runs.
- The bulk of today's felt delay is on the main thread. `TimelineController.snapshot()`
  (`src/lib/map/timeline-controller.ts:301`) clears all cells first, so the map goes blank. It
  then installs 4 cells per frame (`MAX_CELLS_PER_SLICE`, `src/lib/map/hide.ts:28`), so the whole
  city takes ≈ 1 s. `DemolishPump.replace()` clears and re-applies all feature-state.
- One shared geometry for the union of all runs was considered and rejected. The union is ~30× one
  run on the bench city, around 170 MB packed, with a new shader path.

## Design

### Ranking

When the band completes, the worker posts the rank order: the 101 seeds sorted best to worst by
`finals()`, as the reverse of the existing ascending order. It is reposted whenever a lever change rebuilds the band.
The slider is disabled, with the handle on the middle tick, until the current band's order arrives.
After a lever change the slider goes back to the median, because rank r under new levers is a
different run.

### Switching path ("fast switch")

1. **Page.** A tick change asks the worker for that seed. Requests are latest-wins. A new tick
   supersedes an in-flight one, and the page ignores responses for superseded seeds. This replaces
   the `canReroll`/`rerollBusy` blocking for slider use. Lever sends must never wait on a slider
   request.
2. **Worker.** Recompute the run on demand (no per-run cache). Pack the cells in the current
   viewport first, then the rest. Drop work for a superseded seed between slices (the scheduler
   already slices at ≤ 50 ms). The plan-effect (twin) series for the headline either comes from
   data the band already holds (add the needed series to the band state) or is computed on the
   same tick. Builder's choice, as long as the headline is complete within the switch budget.
3. **Map.** Add a swap mode to the timeline controller. It installs the new run's cells over the
   old ones without clearing first, viewport cells first, with a larger per-frame budget than 4
   cells. Old cells outside the new run are removed once their replacements are in. Change the
   demolish feature-state by a diff against the previous run's list, not a clear-and-reapply.
4. **URL.** Keep `?seed=N`. A slider move replaces the URL (`replaceState`) after the drag
   settles. It never pushes. The median run keeps a clean URL (no `seed`), as today.
5. **Kept as-is across a switch:** the scrubber day, the high-water mark (it is day-based), play
   state and the band.

### If live measurement misses

Pre-warming neighbouring ranks (hidden layer sets for ranks ±k) was considered and set aside. It
makes one-tick moves instant and jumps slow, which works against the constant-time preference, and
at the default camera each neighbour is close to a whole city in memory. If the full switch exceeds
3 s at the default camera, or the switch time varies a lot between runs, raise the per-frame install
budget and cut per-switch main-thread work (encoding, tessellation, demolish diff) first. Bring
anything beyond that back to the owner.

### Slider UI

- Vertical, on the right edge of the map, vertically within the map area above the scrubber. Its
  bottom clears `--map-controls-br-block-size` (the attribution plus bottom insets, see
  `docs/dev/map-interfaces.md`).
- Shown only in run mode (`run.phase === 'run'`), not in Setup.
- "Best" label at the top end, "Worst" at the bottom. The handle carries the run number: the
  seed, matching the "This future: #seed" line on the Results face.
- 101 discrete steps. Keyboard: Up/Right = better, Down/Left = worse, Page Up/Down = ±10,
  Home = Best, End = Worst. Native `role="slider"` semantics with `aria-valuetext` such as
  "Run 37, rank 12 of 101". Meets WCAG 2.2 AA (`docs/dev/accessibility.md`), including the
  target size of the handle and the dragging-movements alternative (the keys, plus clicking a
  point on the track).
- Phone (< 768 px): same right-edge placement, sized to the map area left above the dock sheet.
  While the project card's bottom sheet is open, the slider is hidden.
- The Results face's "Back to the representative future" button moves the slider to the median.
  The "This future: #seed (representative)" line follows the selected run.

### Old links

A `?seed=` outside 1..101 (from the removed "Another future") still loads that run. The slider
then shows no selected tick until the user moves it. The handle starts at the middle position.

## Verification

Owner's rule: **every test that runs in signoff must pass on a heavily loaded machine.** Signoff
tests assert behaviour and ordering, never wall-clock time. They wait on events or conditions, not
fixed sleeps, and use generous timeouts. All latency and baseline measurement (switch time,
install cadence, worker cold-switch cost) goes in the non-signoff suites: `test:perf`
(perf / client-perf projects) or `bench:map`.

- Unit: rank order is the reverse of `representativeIndex`'s ascending order, and the median rank equals
  `representativeSeed()`. A latest-wins request drops superseded seeds. Demolish diffing gives the
  same feature-state as a full replace.
- Perf suite (not signoff): worker cold switch to revision 0, and main-thread install cadence for
  a swap, as baselines.
- Browser/e2e on the fixture: slider absent in Setup, present in run mode. Disabled until the band
  is ready. Moving it changes the headline and URL `seed` without adding history entries. Keyboard
  operation works. `expectNoA11yViolations` passes.
- Live measurement: tick-to-on-screen latency on the real SF dataset (`npm run data:local`),
  at the default camera and zoomed in, for one-tick moves and Best↔Worst jumps. Report time to
  first new buildings and to full switch (p50/p95) on the M2 Air class reference machine that
  `docs/dev/map-perf.md` uses. Measure early, before polishing the UI.

## Left to the builder

- The exact message shapes (rank-order post, slider request), and whether the twin series comes
  from band state or is computed per switch.
- The per-frame install budget and viewport-first ordering mechanics.
- Visual styling of the slider within the existing design language and both themes.
- Updating `docs/dev/fzp-mode.md`, `docs/dev/sim-page.md` and `docs/dev/map-interfaces.md` (if
  the slider publishes a footprint) to match.
