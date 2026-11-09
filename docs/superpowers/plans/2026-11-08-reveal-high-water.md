# Reveal Only What the User Has Reached — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/sim` (and `/s/[id]`) and `/lesscars`, every outcome the page shows (charts, tables, chart labels, headline and details numbers) stops at the high-water mark. The high-water mark is the latest date the user has reached by playing or scrubbing. Scrubbing back moves the cursor but leaves everything drawn up to that mark.

**Architecture:** A small shared rune class `HighWater` (`src/lib/fzp/high-water.svelte.ts`) holds the max reached `Day`. Each page feeds it from a `$effect` on its `day`. Pure view models (`chartModel`, `tableRows`, `chartLabel`, the `/lesscars` summary helpers) take an explicit reveal index derived from the mark. The future is still computed up front; only what is shown changes.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, inline SVG, Vitest (node + browser), Playwright.

**Spec:** The owner's request (2026-11-08): "While we prerun the simulation, the user should only see things as they happen: the graph should only fill in to the extent the user has gone (high-water, they can scrub back w/o removing graph); this should be true for /sim and /lesscars. If there are any other places where we show the future before the user has reached it, we should sync them to the max date the user has reached." The decisions below fill gaps the request leaves open.

## Decisions (review these first)

1. **Granularity.** On `/sim` the reveal index is `monthIndex(hw, score.months[0], n)`. That matches the existing `at = scoreAt(score, monthIndex(day))` convention: the header already shows end-of-month state. On `/lesscars` the summary is year-end buckets. The reveal index is the **last year end ≤ hw** (floor), or `-1` if none has been reached. This is stricter than `yearIndexAt` (which rounds up a year); `yearIndexAt` stays for the `data-now` cursor.
2. **Setup on `/sim`.** In Setup the day is pinned at asOf, so the mark is asOf. The Results face in Setup therefore shows only the first month: there is no preview of the policy's full outcome. **This changes current behaviour; confirm it.**
3. **Reset points.** `/sim`: the mark resets to asOf whenever the run phase becomes `setup` ("Edit policy", or jumping to Today, which already ends the run). "Another future" / "Back to the representative future" keeps the mark: the user has reached that date, and the new future shows up to it. Crash Retry, resync and progressive revisions keep the mark. `/lesscars`: the mark only resets on remount (a new manifest). Replay at the horizon keeps it at the horizon.
4. **Y domains** come from revealed values only, with the existing floors: `/sim` keeps `max(RHNA_UNITS, references)` (fixed inputs); `/lesscars` keeps 0. Axes may rescale upward during play. The x axis stays fixed asOf→horizon.
5. **Not capped (inputs, not outcomes):** scrubber markers (RHNA deadline, 2045, SB 79 switch, line openings), the `/lesscars` `TimelineDialog` plan schedule, the freed-land hectares, the `/sim` phasing footnote, `SourcesDialog`, and `EvidenceDialog`. The scrubber range and its End button still reach the horizon: they are how the user advances the mark.
6. **`/lesscars` headline** follows the mark: "+N homes by YYYY" at the revealed year. Before the first year end (index `-1`) it reads **"No extra homes yet"**. It stays without a live region (it changes during playback; announcing it would chatter). SSR renders the start state.

## Global Constraints

- Svelte 5 runes; 2-space indent, single quotes, no trailing commas, 100 columns.
- Every Vitest test calls `expect` (`expect.requireAssertions`).
- `*.spec.ts` = node, `*.svelte.spec.ts` = browser.
- Conventional Commits; no Claude attribution in commits or PRs.
- Do not change the worker, the scenario host, the pipeline or the dataset: this is display only.

## Review Focus

1. **Scrub back after play:** play to 2040, drag to 2030. The chart is still drawn to 2040 and the cursor is at 2030. (Task 3 FzpMode spec, Task 5 LessCarsMode spec, Task 6 e2e.)
2. **Reroll mid-run:** after "Another future", the chart redraws the new future only up to the existing mark, not the full horizon. (Task 3.)
3. **Edit policy → Run again:** the mark resets, so the second run starts empty. (Task 3.)
4. **Revision 0 / empty plan series** with a small reveal index: no null-path crash, and the band area is clipped to the same index. (Task 2.)
5. **Deadline line before the deadline:** "At the deadline" is absent until the mark reaches the deadline month, then appears and stays when scrubbing back. (Task 3.)

---

### Task 1: `HighWater` rune class

**Files:**
- Create: `src/lib/fzp/high-water.svelte.ts`
- Test: `src/lib/fzp/high-water.svelte.spec.ts`

**Interfaces:**
- Produces: `class HighWater { constructor(start: Day); readonly value: Day; reach(day: Day): void; reset(day: Day): void }`. `value` is `$state`. `reach` raises `value` to `max(value, day)`. `reset` sets it to `day` unconditionally.

- [ ] **Step 1: Write failing tests:** `reach` raises the value and never lowers it (reach 10, reach 5 → 10); `reset(3)` after reach 10 → 3; and `value` is reactive (read inside `$effect.root` / `flushSync`; assert the effect re-ran).
- [ ] **Step 2: Run** `npx vitest run src/lib/fzp/high-water.svelte.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the class.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fzp): HighWater rune for the latest reached day`

### Task 2: `/sim` chart models take a reveal index

**Files:**
- Modify: `src/lib/fzp/chart.ts` (`chartModel`, `tableRows`, `chartLabel`)
- Modify: `src/lib/fzp/ScoreChart.svelte` (new prop `highWater: Day`)
- Test: `src/lib/fzp/chart.spec.ts`, `src/lib/fzp/ScoreChart.svelte.spec.ts`

**Interfaces:**
- Produces:
  - `chartModel(score, asOf, horizon, width, reveal: number): ChartModel`
  - `tableRows(score, asOf, reveal: number): TableRow[]`
  - `chartLabel(score, reveal: number): string`
  - `reveal` is the last month index to show, clamped to `[0, n-1]`.
  - ScoreChart props become `{ score, asOf, horizon, day, highWater }`. It computes `reveal = monthIndex(highWater, score.months[0], score.months.length)`.

- [ ] **Step 1: Write failing node tests in `chart.spec.ts`** (use `TIMELINE_SCORE` and `makeTimelineScore`):
  - `reveal 0..k draws k+1 points`: count the `L`-separated points in `model.total` (k+1); `planCompleted` has `min(k+1, planEffect.length)` points; `band` has `2*(k+1)` points.
  - `y domain ignores unrevealed values`: build a score whose `shown[n-1].completedNet` is huge. With `reveal = 2`, `yMax === niceCeil(max(RHNA_UNITS, refs, revealed))`, and it is below the full-run yMax.
  - `negative floor only from revealed values`: a negative planEffect only after `reveal` → `yMin === 0`.
  - `tableRows stops at reveal`: every `row.index <= reveal`. The RHNA deadline row is present only if `deadlineIndex <= reveal`. The final row is `reveal` (replacing today's `n - 1` row).
  - `chartLabel at reveal`: names the total at `reveal` with its month-year ("N by Mon YYYY"). It includes the "by the RHNA deadline" and "by 2045" parts only when their index ≤ reveal. Pin the new wording: `Net new homes in this simulation so far: ${parts.join(', ')}.` The parts are in time order and the last is `${total} by ${formatMonthYear(score.months[reveal])}`.
  - Update the existing tests that call these functions to pass `n - 1` where they mean the full run.
- [ ] **Step 2: Run** `npx vitest run src/lib/fzp/chart.spec.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Slice every series to `0..reveal` before `seriesRange` and before `line`/`area`. `xAt` is unchanged. References and verticals are unchanged (inputs).
- [ ] **Step 4: Write a failing browser test in `ScoreChart.svelte.spec.ts`:** rendering with `highWater` at a mid day versus at the horizon gives a shorter `[data-series="total"]` `d`. Moving `day` back below `highWater` leaves `d` unchanged while `[data-cursor]` moves. Also update existing renders to pass `highWater: horizon`.
- [ ] **Step 5: Implement** the prop in `ScoreChart.svelte`. Run `npx vitest run src/lib/fzp/chart.spec.ts src/lib/fzp/ScoreChart.svelte.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(fzp): score chart draws only up to the high-water month`

### Task 3: Wire the mark through `/sim` (FzpMode, SimResults)

**Files:**
- Modify: `src/lib/fzp/FzpMode.svelte` (own a `HighWater`, feed it, reset it, pass it into the `results` snippet, expose it in debug)
- Modify: `src/lib/fzp/SimResults.svelte` (prop `highWater: Day`; pass it to ScoreChart; gate "At the deadline")
- Modify: `src/lib/fzp/debug.ts` (`highWater` getter on `window.__sfhFzp`)
- Test: `src/lib/fzp/SimResults.svelte.spec.ts`, `src/lib/fzp/FzpMode.svelte.spec.ts`

**Interfaces:**
- Consumes: `HighWater` (Task 1); ScoreChart `highWater` prop (Task 2).
- Produces: `window.__sfhFzp.highWater: Day` (E2E only), used by Task 6.

- [ ] **Step 1: Write a failing test in `SimResults.svelte.spec.ts`** (next to the existing deadline test, ~line 323). With `highWater` before the deadline month, no "At the deadline" text. With `highWater` on or after the deadline month, it is shown with today's value. Update existing renders to pass `highWater`.
- [ ] **Step 2: Implement** in SimResults: show the deadline line only when `monthIndex(highWater) >= deadlineIndex(score, target.deadline)`. Pass `highWater` to `ScoreChart`.
- [ ] **Step 3: Write failing tests in `FzpMode.svelte.spec.ts`** (use the `setup` / `toReady` / `timelineMsg` / `__sfhFzp` pattern; `vi.stubEnv('VITE_E2E','1')`):
  - `the high-water mark follows the furthest day and survives scrubbing back`: Run, scrub to day A, then to B > A, then back to A → `__sfhFzp.highWater === B` and `__sfhFzp.day === A`.
  - `Edit policy resets the high-water mark`: extend the "a new run after Edit policy discards the old run" flow (~line 1631) → after reset, `highWater === asOf`.
  - `another future keeps the high-water mark`: in the reroll describe (~579), after a reroll the mark is unchanged.
  - `Setup pins the mark at asOf`: before Run, `highWater === asOf`.
- [ ] **Step 4: Implement in FzpMode:**
  - `const highWater = new HighWater(calibration.asOf)`.
  - `$effect(() => highWater.reach(day))`. Use an effect, not `onDay`, because the Retry path writes `day` directly (~line 860).
  - In the existing Setup effect (~689-702), call `highWater.reset(asOf)` when the phase is `setup`. That is the one place that already handles both "Edit policy" and Today.
  - Pass `highWater.value` into the `results` snippet → SimResults.
  - Add a `highWater` getter in `debug.ts`.
- [ ] **Step 5: Run** `npx vitest run src/lib/fzp/SimResults.svelte.spec.ts src/lib/fzp/FzpMode.svelte.spec.ts src/lib/sim-page`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(sim): results reveal only up to the furthest day reached`

### Task 4: `/lesscars` summary helpers take a reveal index

**Files:**
- Modify: `src/lib/lesscars/summary-view.ts`, `src/lib/lesscars/copy.ts`
- Modify: `src/lib/lesscars/ExtraChart.svelte`, `DetailsPanel.svelte`, `HeadlineBar.svelte` (each gains `highWater: Day`)
- Test: `src/lib/lesscars/summary-view.spec.ts`, `ExtraChart.svelte.spec.ts`, `DetailsPanel.svelte.spec.ts`, `HeadlineBar.svelte.spec.ts`

**Interfaces:**
- Produces:
  - `revealedYearIndex(s: LessCarsSummary, highWater: Day): number`: the last `i` with `s.yearEnds[i] <= highWater`, else `-1`.
  - `homesAt(s, i): number` and `yearAt(s, i): number`. These replace `finalHomes` and `finalYear`; for `i = -1` they return `0` and `utcParts(s.yearEnds[0]).y`.
  - `headlineText(s, i)`, `headlineName(s, i)`, `bandText(s, i)`, `breakdownRows(s, i)`, `extraChartModel(s, i)`. The model's arrays are sliced to `0..i` (empty for `-1`); the y domain comes from the slice with a floor of 0; `years` stays the full list for the x axis.
  - `headlineCopy(n, year, reached: boolean)`: `reached === false` → `'No extra homes yet'`. `headlineSentence` gets the same treatment, with `'The plan has added no homes yet.'`.
  - The three components take `highWater: Day` and compute `i` themselves.

- [ ] **Step 1: Write failing node tests in `summary-view.spec.ts`** (fixture `summary.json`, 41 year ends):
  - `revealedYearIndex`: the day before the first year end → -1; exactly `yearEnds[3]` → 3; past the last → 40.
  - `extraChartModel(s, 3)` has 4 points per series, and its `yMax` comes from those 4.
  - `breakdownRows(s, 3)` sums to `Math.round(mean[3])`.
  - `headlineText(s, -1) === 'No extra homes yet'`.
  - `headlineText(s, 3)` names `yearAt(s, 3)`.
  - Update the existing tests to pass the last index.
- [ ] **Step 2: Run** `npx vitest run src/lib/lesscars/summary-view.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and copy. Remove `finalHomes` and `finalYear` once no caller remains (check with ripgrep, since the graph index will not see this branch).
- [ ] **Step 4: Write failing browser tests:**
  - ExtraChart: with `highWater` at year end 3, the mean polyline has 4 points. The aria-label is `+N by <year 3>`; at `-1`, the label is "No extra homes yet". `day < highWater` keeps the polyline length and moves `[data-now]`.
  - DetailsPanel: the headline sentence, the band text, the breakdown rows/Total and `garageCostCopy` all use index i (assert the Total cell equals `signed(Math.round(mean[i]))`).
  - HeadlineBar: the text follows `highWater`.
- [ ] **Step 5: Implement** the component props. In `ExtraChart.svelte`, guard the empty-slice case: draw no polyline or polygon, and keep the axes and zero line. Update the header comment in `HeadlineBar.svelte` (lines 1-6), which says the text is fixed.
- [ ] **Step 6: Run** `npx vitest run src/lib/lesscars`. Expected: PASS.
- [ ] **Step 7: Commit:** `feat(lesscars): headline, details and chart reveal only reached years`

### Task 5: Wire the mark through `LessCarsMode`

**Files:**
- Modify: `src/lib/lesscars/LessCarsMode.svelte` (own a `HighWater(LESSCARS_START)`, `$effect(() => highWater.reach(day))`, pass `highWater.value` to HeadlineBar, DetailsPanel and ExtraChart through the snippets at ~350-356)
- Modify: `src/lib/lesscars/debug.ts` (`highWater` getter)
- Test: `src/lib/lesscars/LessCarsMode.svelte.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 and 4.
- Produces: `window.__sfhLessCars.highWater: Day` (E2E only).

- [ ] **Step 1: Write failing tests** (next to "the scrubbed day reaches the map…", ~line 292):
  - Scrub to 2040-06-01, then to 2030-06-01 → `[data-testid="lc-headline"]` names 2039 (the last year end ≤ the mark), and `__sfhLessCars.highWater` is the 2040 day.
  - On first render the headline is "No extra homes yet".
- [ ] **Step 2: Run** `npx vitest run src/lib/lesscars/LessCarsMode.svelte.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(lesscars): track the furthest day reached`

### Task 6: E2E and docs

**Files:**
- Modify: `e2e/sim.spec.ts`, `e2e/lesscars.spec.ts`
- Modify: `docs/dev/fzp-mode.md` (scrubber contract: the high-water mark, its reset points and `__sfhFzp.highWater`; rewrite "The chart's y domain", ~106-108)
- Modify: `docs/dev/sim-page.md` (Setup/Run: the Results face in Setup shows only today)
- Modify: `docs/dev/lesscars.md` (Header ~921-933: the headline follows the furthest year reached; "No extra homes yet")

- [ ] **Step 1: Write e2e tests.**
  - `/sim`: `startRun`, use `jumpAndIdle` to a later year, read the length of the `[data-testid="fzp-chart"] [data-series="total"]` `d`, jump back to an earlier year, assert the `d` is unchanged and that `__sfhFzp.highWater` is unchanged.
  - `/lesscars`: the headline reads "No extra homes yet" on load; after a jump to the end it reads "+N homes by 2068"; after jumping back it still reads 2068.
  - Run `expectNoA11yViolations` on the chart with a partial reveal.
- [ ] **Step 2: Run** `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts`, then `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts`. Expected: PASS. Fix any existing e2e test that assumed the full headline or full chart on load.
- [ ] **Step 3: Update the three docs.**
- [ ] **Step 4: Run** `npm run check && npm run lint && npm run test:unit`. Expected: clean.
- [ ] **Step 5: Commit:** `test(e2e): charts and headline reveal up to the high-water mark` + `docs: high-water reveal on /sim and /lesscars`
