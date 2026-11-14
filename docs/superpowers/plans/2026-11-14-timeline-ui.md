# timeline-ui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/sim`'s two phases (tabbed setup, then a locked run of one future) with one screen: a timeline under the map on which every schema 4 policy is a bar over the months it is in force, a playhead, a filled mark, and an inspector that hosts today's editors on the selected span; switch `/sim`, `/s/<id>` and `/api/policies` to schema 4 and the timeline worker.

**Architecture:** Pure TS modules in `src/lib/timeline/` hold every rule the screen depends on (the chunk log and its view, stale and fill state, playhead keys and limits, span edits, adding policies, the schema 3 lens the old editors edit through). A `TimelineSession` (runes class) owns the `TimelineClient` protocol: open, edits, refills, errors, crash. `TimelineMode.svelte` composes SimMap, the timeline rows, the header score, the card and the notices; `SimPage.svelte` keeps the store, the tools, persistence and the inspector. Old editors are reused unchanged in behaviour through an `EditStore` lens over one span.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, Vitest (server and client projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-timeline-ui-design.md` (rules cited as "rule N"). Design: `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md`. Mockups (accepted look): `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/superconductor/sim-step-engine/mockups/policy-tracks-v3.html` (rows; `tracks-v3.png`), `policy-tracks-v2.html` (inspector, phone; `tracks-v2-light.png`). Numbers in the mockups are made up.

Interface docs every implementer reads for their task: `docs/dev/policy-timeline.md`, `docs/dev/ensemble-runner.md`, `docs/dev/world-score.md`, `docs/dev/map-stream.md`, `docs/dev/testing.md`, `docs/dev/accessibility.md`.

## Global Constraints

From the spec (verbatim values):

- The calibration file, the dataset and the pipeline do not change. No file under the folders hashed into the dataset version (`pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard`) is added, changed or removed. New code imports from the hashed folders. A builder who finds any other change necessary stops and reports. (Note: `src/lib/scoreboard/HeaderScore.svelte` and `src/lib/sim/scenario/finance-score.ts` (`MONEY_SOURCES`) are hashed: this plan builds beside them, never in them.)
- Tests that run in signoff assert behaviour and order, never wall-clock time. Every timing bar lives in `test:perf`.
- WCAG 2.2 AA for the timeline, including keyboard control of every bar.
- Explanation waits for interest (OD-12). At rest the page shows numbers, short labels and controls. Sentences that explain a number, a caveat or a method appear only when the reader points at, focuses or taps the thing they explain. What appears on pointing also appears on keyboard focus and on tap, stays while pointed at, and can be dismissed (WCAG 1.4.13). An explanation is itself short: it says what the reader cannot infer and stops ("A forecast if nothing changes" is sufficiently unambiguous; "if you can infer it don't belabor it"). No new standing paragraph is added to `/sim`.
- No user setting may decide directly how much gets built.
- `WORLDS = 48`, `WINDOW_MONTHS = 480` (`src/lib/sim/timeline-client.ts:28-31`); the ruler spans the dataset date's year to forty years on and never moves or zooms (ruling R9).

From the conductor (hard constraints):

- Do not edit another spec's files: everything under `src/lib/sim/world/` (world-core, policy-timeline `policy/`, world-funding `funding/`, world-score `score/`, map-stream `map-stream.ts`); `src/lib/timeline/{policy4,parse4,reconcile4,sim-doc4,upgrade}.ts` (policy-timeline); `src/lib/sim/timeline-client.ts`, `timeline-protocol.ts`, `router.ts`, `worker.ts`, the runner and the host (ensemble-runner). A needed change there is an open question for main, not a task. New timeline-ui files go in `src/lib/timeline/`.
- `/lesscars` keeps its own mode and every file it imports untouched. Its import closure (computed for this plan) includes, among others: `src/lib/fzp/{TimeScrubber.svelte,high-water.svelte.ts,playback.ts,time.ts,format.ts,chart.ts,score-view.ts,provenance.ts,card.ts,labels.ts,types.ts,load.ts,market-view.ts,copy.ts}`, `src/lib/map/**` (SimMap included), `src/lib/sharing/{autosave.svelte.ts,doc-codec.ts,storage.ts,api.ts,copy.ts,title.ts}`, `src/lib/sim-page/{funding-copy,funding-presets,funding-reconcile,funding-sources,funding-view,policy,reconcile,sim-doc,sim-session,timing-sources,timing}.ts`, `src/lib/view/prefs.ts`, `src/lib/shell/header-actions.svelte.ts`. **None of these is edited by any task.** New wording for texts they hold lives in `src/lib/timeline/copy.ts` and is imported by the files that render it.
- Signoff tests assert behaviour and order, never wall-clock time. No raised per-test timeouts (signoff rejects them). Vitest runs with `expect.requireAssertions`.
- Page copy is terse. No "it is not X" disclaimers. Status apart from controls (never among buttons); headline number in the top bar, details behind a tap.
- **The measurement lock.** The lock is the directory `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/sdd/measure.lock`. Immediately before EVERY test, check, build or script run, look at the lock directory; if it exists and its `owner` is not ours, wait (`sleep 60` in the foreground, then look again). Never remove a lock you did not create. Report any slip at once. Timings only by the operator, under the lock.
- Run commands from the worktree `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.claude/worktrees/step-timeline-ui`; never `cd <dir> && <cmd>`. Conventional Commits; no Claude attribution anywhere.
- Known limits to show honestly, not to fix (ruling 8): worker memory about +394 MB (no copies) / +526 MB (month-0 copy) on the live city; some worker slices 52-63 ms; one cold massing about 636 ms; planning with rich public money over the per-slice bar. Expected on the live city (ruling 11): first cells about 1.0 s, first results 2.1-2.5 s after open, the window filled in about 4.0 s.
- Report, do not work around (ruling 10): a map-stream ENOENT on `parcels/42_21.json` in a local dataset copy.

Rulings binding this plan (from the conductor, embedded where they bite):

- R-1 (S14 as amended): apply `compiled`, `filled`, `refill` in arrival order; never assume `rev` rises; a `filled` chunk belongs to the statics of the last `compiled` delivered before it. Do not copy the runner's test recorder (it reads every chunk with the latest statics). → Task 1.
- R-2: read `money.perAddedHome` and `money.displacedShare` from the view; never recompute them. `viewOf` works on a cloned `ScoreStatics`; an empty view has null money and tiers. → Tasks 1, 11.
- R-3: reconcile with `openSimDoc4` (calibration and `asOf` = `calibration.asOf`) before `openTimeline`; `codec.load` drops the report, so the page uses `openSimDoc4`. `opCount` counts spans. `migrateSimAutosave` returns `'none'` on a failed write. → Tasks 12, 14, 15.
- R-4: `/s` loading has no `asOf`; the plan chose who opens `/s` documents (Task 15, "Decided").
- R-5: the apply-cost and `bench:map` measurements are the operator's, under the lock. → Task 22.
- R-6: the host calls `MapStream.cellsFor`; `resyncMap` is answered by a revision-0 `cells`. → Task 12 (page side: `onResyncNeeded` → `resyncMap()`).
- R-7: this spec retires the old host's use on `/sim` by no longer sending its messages; no hashed file changes (see Open questions OQ-1).

## Review Focus

1. **An edit while a fill is in flight, with chunks from the previous rev still arriving and a new pool added.** Expected: months before the refill point keep their numbers, the money panel does not throw or drop pools, the band and headline are continuous. Pinned in Task 1 (`viewOfLog with a pool added by an edit`).
2. **The playhead sitting past a refill point when an edit lands.** Expected: the playhead does not move, Results and the header keep the pre-edit numbers dimmed with "Updating", and switch to new numbers the moment the refill passes the playhead's month, not before. Pinned in Task 2 (`held view until the refill passes`) and Task 12.
3. **A restored or shared document whose brush queries are not yet resolved at open.** Expected: no error notice, no "couldn't be applied", the forecast for the full document appears once lots arrive. Pinned in Task 12 (`opens provisionally, then sends the full document`).
4. **Undo or redo across span edits after the worker rejected one.** Expected: the rejected edit is undone to the last accepted document, the notice shows once, redo does not resurrect a state the user never saw silently. Pinned in Task 6 (`undoTo`) and Task 12 (`bad-request undoes to the last accepted`).
5. **Keyboard bar moves at the window's edges and against a neighbouring span.** Expected: no move puts a `from` on or before the dataset date, past the window, or overlapping another span of the same policy; the result is always a reconciled document. Pinned in Task 4 (`clamps` and `every op yields a reconciled document`).

---

## File Structure

New, `src/lib/timeline/`:

| File | Responsibility |
| --- | --- |
| `chunk-log.ts` | The arrival-ordered log of `compiled` / `filled` / `refill`, money alignment, `viewOfLog` (R-1, R-2, rule 29) |
| `fill.ts` | Stale, held view, Play availability, fill status text (rules 25, 31, 32) |
| `playhead.ts` | Day ↔ calendar index, filled end day, key targets, `MonthGate` (viewMonth at most 4/s) (rules 18, 23, 24) |
| `spans.ts` | `SpanRef`, span and policy edit operations, keyboard edge moves (rules 11, 13) |
| `add.ts` | What "+" offers per kind and the new policy at the playhead month (rule 12) |
| `lens.ts` | `EditStore`, schema 3 projection of one span and write-back; `spanLens` |
| `policy-sync.svelte.ts` | `PolicySync`: resolves `queriesOf4`, debounces 250 ms, exposes `lots` (rule 16) |
| `copy.ts` | New wording (rule 38) and the explanation texts |
| `Explain.svelte` | The one explanation component (rule 37) |
| `Playhead.svelte`, `Ruler.svelte`, `ChartRow.svelte` | Ruler, filled mark, markers, the slider, the chart row (rules 3, 4, 23, 28) |
| `Timeline.svelte`, `KindRow.svelte`, `PolicyRow.svelte`, `SpanBar.svelte`, `FixedRow.svelte` | The rows (rules 2, 5-9, 11) |
| `Inspector.svelte`, `WhenEditor.svelte`, `WhatEditor.svelte`, `AddMenu.svelte` | The editor (rules 10, 12, 13, 15, 17) |
| `results.ts` | `scoreOfView`, `resultsAt`, `headerOf` (rules 26, 27) |
| `TimelineHeaderScore.svelte` | Header score beside the hashed `HeaderScore` ("{n} homes by {year}") |
| `session.svelte.ts` | `TimelineSession`: the client protocol, notices, stale, card refresh, crash (rules 16, 21, 29-36) |
| `TimelineMode.svelte` | Composition replacing `FzpMode` on `/sim` and `/s/<id>` |
| `owner.ts` | `ownerName4`, `fundingName4`, `policyOfOwner` (card lines, map tap) |
| `session4.ts` | Restore and open: autosave notice, `Policy4Report` → today's notices, "upgraded", Remix |
| `server-codec.ts` | `SIM_SERVER_CODEC4` for `/api/policies`, `/s` server load, e2e seed |
| `test/fake-timeline-worker.ts`, `test/fixtures.ts`, `test/*Host.svelte` | Test doubles and fixtures |

Modified: `src/lib/sim-page/{SimPage.svelte,SimRoute.svelte,policy-store.svelte.ts,stroke-adapter.ts,selection.ts,SimNotices.svelte,TransitTab.svelte,PermittingSection.svelte,RouteTimeline.svelte,ProtectionsSection.svelte,FundingTab.svelte,MarketTerms.svelte,ProgrammeEditor.svelte}`, `src/lib/fzp/{SimResults.svelte,MoneyResults.svelte,ScoreChart.svelte,SourcesDialog.svelte,debug.ts}`, `src/routes/sim/+page.ts`, `src/routes/s/[id]/{+page.server.ts,+page.ts,+page.svelte}`, `src/lib/server/sharing/codecs.ts`, `src/lib/server/test/sim-docs.ts`, `e2e/**` (sim specs, helpers), docs.

Deleted (rule 41, Task 17): `src/lib/fzp/{FzpMode.svelte,RunSlider.svelte,RunSliderHost.test.svelte,run-slider.ts,run-switch.ts,seed.ts}` with their specs, `src/lib/fzp/test/{FzpModeHost.svelte,fake-worker.ts}`, `src/lib/sim-page/{run-phase.svelte.ts,lever-status.ts,tabs.ts}` with their specs, `e2e/bench/run-slider.bench.ts`. Kept untouched because `/lesscars` imports them: `TimeScrubber.svelte`, `high-water.svelte.ts`.

---

### Task 1: The chunk log and its view

Model: opus.

**Files:**
- Create: `src/lib/timeline/chunk-log.ts`
- Create: `src/lib/timeline/test/fixtures.ts` (statics and chunks built with `src/lib/sim/world/score/test/feed.ts` `testStatics`, or by hand)
- Test: `src/lib/timeline/chunk-log.spec.ts`

**Interfaces:**
- Consumes: `viewOf(chunks, statics)`, `chunksBefore(chunks, k)` (`src/lib/sim/world/score/view.ts:102,154`); `SeriesChunk`, `ScoreStatics`, `TimelineView`, `MoneyRow` (`src/lib/sim/world/score/types.ts:21,60,137,154`).
- Produces:
  ```ts
  export interface LogEntry { chunk: SeriesChunk; statics: ScoreStatics | null }
  export interface ChunkLog { readonly statics: ScoreStatics | null; readonly entries: readonly LogEntry[] }
  export const EMPTY_LOG: ChunkLog;
  export function logCompiled(log: ChunkLog, statics: ScoreStatics): ChunkLog;
  export function logFilled(log: ChunkLog, chunk: SeriesChunk): ChunkLog;
  export function logRefill(log: ChunkLog, from: number): ChunkLog;
  export function viewOfLog(log: ChunkLog): TimelineView | null;
  export function nextMonth(log: ChunkLog): number; // months held: the next `from` expected
  ```
  Fixtures: `statics(opts?: { finance?: boolean; lastIndex?: number }): ScoreStatics`, `chunk(from: number, n: number, opts?: { pools?: string[]; base?: number }): SeriesChunk`.

Rules (decided here):
- `logCompiled` sets `statics` and gives every entry whose `statics` is null the new statics (rule 29: chunks before the first `compiled` are joined then). Entries that already have statics keep them (R-1).
- `logFilled` tags the chunk with `log.statics` (the last delivered). A chunk whose `from !== nextMonth(log)` is a protocol breach: `console.error` and the log is returned unchanged.
- `logRefill(from)` trims as `chunksBefore` does, keeping each kept entry's statics.
- `viewOfLog` is null while `log.statics` is null. The view's statics `S` is the statics of the last entry (else `log.statics`). Before calling `viewOf(chunks, S)`: if `S.limits === null || S.debts === null`, every chunk's `money` is set null; otherwise every chunk's `money` rows are re-keyed to the pool id list of the last chunk that has money (missing ids → a zero row with that pool's `label` and `kind`; ids not in the list are dropped, since a pool the newest document lacks had nothing before the refill point), and a chunk with null `money` gets zero rows. `tiers` are left as they are (`viewOf` gives null tiers when any chunk lacks them).

- [ ] **Step 1: Write the failing tests**

```ts
it('builds nothing before the first compiled, then joins the early chunks', () => {
  let log = logFilled(EMPTY_LOG, chunk(0, 3));
  expect(viewOfLog(log)).toBeNull();
  log = logCompiled(log, statics());
  expect(viewOfLog(log)!.filledThrough).toBe(2);
});
it('tags a chunk with the statics of the last compiled delivered before it', () => {
  const a = statics(), b = statics();
  let log = logFilled(logCompiled(EMPTY_LOG, a), chunk(0, 2));
  log = logFilled(logCompiled(log, b), chunk(2, 2));
  expect(log.entries.map((e) => e.statics)).toEqual([a, b]);
});
it('applies refill then filled in arrival order whatever the rev', () => {
  let log = logFilled(logFilled(logCompiled(EMPTY_LOG, statics()), chunk(0, 5)), chunk(5, 5));
  log = logRefill(log, 7);
  expect(nextMonth(log)).toBe(7);
  log = logFilled(log, chunk(7, 3, { base: 100 }));
  expect(viewOfLog(log)!.mean[8].completedNet).toBe(chunk(7, 3, { base: 100 }).mean[1].completedNet);
  expect(viewOfLog(log)!.mean[6]).toEqual(chunk(5, 5).mean[1]);
});
it('drops a chunk that does not follow and logs it', () => { /* from 4 onto a log through 2: entries unchanged; console.error called once */ });
it('viewOfLog with a pool added by an edit', () => {
  // chunks 0..9 with pools [b1], refill 6, statics with finance, chunk 6..9 with pools [b1, u-new]
  const v = viewOfLog(log)!;
  expect(v.money!.pools.map((p) => p.id)).toEqual(['b1', 'u-new']);
  expect(v.money!.pools[1].received.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(v.money!.perAddedHome).toEqual(viewOf(alignedByHand, S).money!.perAddedHome);
});
it('strips money when the newest statics has no finance', () => { /* view.money === null, no throw */ });
it('an empty log after compiled is an empty view with null money and tiers', () => {
  const v = viewOfLog(logCompiled(EMPTY_LOG, statics({ finance: true })))!;
  expect([v.filledThrough, v.money, v.tiers]).toEqual([-1, null, null]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project server src/lib/timeline/chunk-log.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `chunk-log.ts` and the fixtures as above.** Never mutate a chunk or a statics: entries and rows are replaced. Do not `structuredClone` the statics (`viewOf` reads plain fields only, `world-score.md:75`).

- [ ] **Step 4: Run the tests to verify they pass** (same command; PASS).

- [ ] **Step 5: Commit** `git add src/lib/timeline/chunk-log.ts src/lib/timeline/chunk-log.spec.ts src/lib/timeline/test/fixtures.ts` then `git commit -m "feat(timeline): chunk log and view in arrival order"`.

---

### Task 2: Stale, fill and Play state

Model: sonnet.

**Files:**
- Create: `src/lib/timeline/fill.ts`
- Test: `src/lib/timeline/fill.spec.ts`

**Interfaces:**
- Consumes: `TimelineView` (Task 1 output type).
- Produces:
  ```ts
  /** What the page knows about the latest edit. `pending`: an edit not yet settled (sent or still debouncing). */
  export interface EditState {
    /** The view as it was when the first unsettled edit was made; null when no edit is in play. */
    held: TimelineView | null;
    /** True from an edit until its rev is settled (a `refill` or `compiled` at or after it, or its `bad-request`). */
    pending: boolean;
    /** True from an edit until the forecast is whole again (`filledThrough === lastIndex` after settling). */
    sinceWhole: boolean;
  }
  export const NO_EDIT: EditState;
  export function edited(s: EditState, current: TimelineView | null): EditState;   // keeps the first held view
  export function settled(s: EditState): EditState;                                  // pending false
  export function shownAt(s: EditState, current: TimelineView | null, i: number): { view: TimelineView | null; stale: boolean };
  export function afterView(s: EditState, current: TimelineView | null, i: number): EditState; // clears held when not stale at i; clears sinceWhole when whole and not pending
  export function playAvailable(s: EditState, current: TimelineView | null, stoppedByError: boolean): boolean;
  export function fillStatusText(current: TimelineView | null): string; // 'Forecast filled to 2047' | ''
  ```

Rules: `stale` at month index i is `pending || current === null || current.filledThrough < i` once an edit is in play (`held !== null`); otherwise false. While stale, `shownAt` gives `held` (rule 31: the numbers before the change, dimmed). Play (rule 25) is unavailable while `sinceWhole` and not `stoppedByError`; with no edit Play is available (inside the filled part, rule 24). `fillStatusText` is `''` when `filledThrough === lastIndex` or the view is null, else `Forecast filled to ${year of months[filledThrough]}` (UTC year, `utcParts` from `src/lib/fzp/time.ts:17`).

- [ ] **Step 1: Write the failing tests**

```ts
it('held view until the refill passes the playhead', () => {
  let s = edited(NO_EDIT, whole);               // whole: filledThrough = lastIndex
  expect(shownAt(s, whole, 30)).toEqual({ view: whole, stale: true }); // pending
  s = settled(s);
  expect(shownAt(s, cut(whole, 20), 30)).toEqual({ view: whole, stale: true });
  expect(shownAt(s, cut(whole, 30), 30)).toEqual({ view: cut(whole, 30), stale: false });
});
it('an edit after the playhead ends staleness at settle', () => {
  const s = settled(edited(NO_EDIT, whole));
  expect(shownAt(s, cut(whole, 99), 5).stale).toBe(false);
});
it('Play waits for the whole window after an edit, unless an error stopped the fill', () => {
  const s = afterView(settled(edited(NO_EDIT, whole)), cut(whole, 50), 0);
  expect(playAvailable(s, cut(whole, 50), false)).toBe(false);
  expect(playAvailable(s, cut(whole, 50), true)).toBe(true);
  expect(playAvailable(afterView(s, whole, 0), whole, false)).toBe(true);
});
it('Play is available with no edit, inside the filled part', () => {
  expect(playAvailable(NO_EDIT, cut(whole, 3), false)).toBe(true);
});
it('fill status names the year of the last final month, and nothing when full', () => {
  expect(fillStatusText(cut(whole, 251))).toMatch(/^Forecast filled to \d{4}$/);
  expect(fillStatusText(whole)).toBe('');
});
```

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/fill.spec.ts` — FAIL.
- [ ] **Step 3: Implement `fill.ts`** (pure; `cut` is a test helper trimming a view's series, put it in `test/fixtures.ts`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): stale, fill and Play state`.

---

### Task 3: Playhead rules and the view-month gate

Model: sonnet.

**Files:**
- Create: `src/lib/timeline/playhead.ts`
- Test: `src/lib/timeline/playhead.spec.ts`

**Interfaces:**
- Consumes: `monthOfDay` (`src/lib/sim/world/months.ts:19`); `monthIndex`, `nextMonth`, `prevMonth`, `shiftYear`, `dayFromUtc`, `utcParts` (`src/lib/fzp/time.ts`); `advance`, `SPEED_DAYS` (`src/lib/fzp/playback.ts:24`). All imported, none edited.
- Produces:
  ```ts
  /** Calendar month index of `day` in `months` (clamped to [0, months.length - 1]). */
  export function indexOfDay(months: Day[], day: Day): number;
  /** The last day of calendar month `filledThrough`; `asOf` when nothing is filled. */
  export function filledEndDay(months: Day[], filledThrough: number, asOf: Day): Day;
  /** The model month the playhead is in, for `viewMonth`: max(1, monthOfDay(asOf, day)). */
  export function viewMonthOf(asOf: Day, day: Day): number;
  /** The day a key moves the playhead to, or null for a key it ignores (rule 23). */
  export function keyTarget(key: string, day: Day, asOf: Day, end: Day): Day | null;
  /** Clamps a requested day into [asOf, end]. */
  export function clampDay(day: Day, asOf: Day, end: Day): Day;
  export class MonthGate {
    constructor(deps: { send(month: number): void; now(): number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; minMs?: number });
    want(month: number): void; // sends at once unless one went out < minMs (250) ago; then the latest wanted goes out when the gap ends
    dispose(): void;
  }
  ```

Decided here: the playhead's `end` is `filledEndDay(...)` of the current view (rule 23 "End to the filled mark"; rule 24 "stops at the filled mark"). A key, drag or marker cannot move it past `end`; a refill that withdraws months under it does not move it (rule 25). Keys: ArrowLeft/ArrowDown a month back, ArrowRight/ArrowUp a month on, PageDown/PageUp a year, Home `asOf`, End `end`; modifier keys ignored (as `TimeScrubber.svelte:126-133`).

- [ ] **Step 1: Write the failing tests**

```ts
it('End goes to the filled mark and nothing moves past it', () => {
  const end = filledEndDay(months, 10, asOf);
  expect(keyTarget('End', asOf, asOf, end)).toBe(end);
  expect(keyTarget('PageUp', end - 3, asOf, end)).toBe(end);
});
it('Home goes to the dataset date; Left and Right move a month; Page keys a year', () => { ... });
it('filledEndDay is the last day of the last final month, asOf before any', () => {
  expect(filledEndDay(months, -1, asOf)).toBe(asOf);
  expect(filledEndDay(months, 0, asOf)).toBe(months[1] - 1);
});
it('viewMonthOf is month 1 at the dataset date', () => {
  expect(viewMonthOf(asOf, asOf)).toBe(1);
});
it('MonthGate sends at most once per 250 ms and then the latest month', () => {
  // fake clock: want(2) at 0 → sent [2]; want(3) at 100, want(4) at 200 → nothing; timer at 250 → sent [2, 4]
});
```

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/playhead.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): playhead keys, filled end and view-month gate`.

---

### Task 4: Span and policy edits

Model: sonnet.

**Files:**
- Create: `src/lib/timeline/spans.ts`
- Test: `src/lib/timeline/spans.spec.ts`

**Interfaces:**
- Consumes: `SimPolicy4`, `Policy`, `Span`, `PolicyKind` (`src/lib/timeline/policy4.ts:35-55`); `monthFirstDay`, `monthLastDay`, `monthOfDay` (`src/lib/sim/world/months.ts:9-19`); `reconcilePolicy4` (`src/lib/timeline/reconcile4.ts:254`) in tests only.
- Produces:
  ```ts
  export interface SpanRef { kind: PolicyKind; id: string; span: number }
  export interface Window { asOf: Day; months: number } // months = WINDOW_MONTHS
  export function policyOf(doc: SimPolicy4, kind: PolicyKind, id: string): Policy | undefined;
  export function spanMonths(s: Span, asOf: Day): { from: number; to: number | null };
  export function setFrom(doc: SimPolicy4, ref: SpanRef, month: number, w: Window): SimPolicy4;
  export function setTo(doc: SimPolicy4, ref: SpanRef, month: number | null, w: Window): SimPolicy4;
  export function moveEdge(doc: SimPolicy4, ref: SpanRef, edge: 'from' | 'to', by: number, w: Window): SimPolicy4;
  export function moveSpan(doc: SimPolicy4, ref: SpanRef, by: number, w: Window): SimPolicy4;
  export function nearerEdge(s: Span, playheadMonth: number, asOf: Day): 'from' | 'to';
  export function splitSpan(doc: SimPolicy4, ref: SpanRef, atMonth: number, w: Window): SimPolicy4;
  export function addSpan(doc: SimPolicy4, kind: PolicyKind, id: string, fromMonth: number, w: Window): { doc: SimPolicy4; span: number };
  export function removeSpan(doc: SimPolicy4, ref: SpanRef): SimPolicy4;
  export function setOn(doc: SimPolicy4, kind: PolicyKind, id: string, on: boolean): SimPolicy4;
  export function removePolicy(doc: SimPolicy4, kind: PolicyKind, id: string): SimPolicy4;
  export function movePolicy(doc: SimPolicy4, kind: PolicyKind, id: string, dir: -1 | 1): SimPolicy4;
  export function barKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey'>, s: Span, playheadMonth: number, asOf: Day): { op: 'edge'; edge: 'from' | 'to'; by: number } | { op: 'span'; by: number } | null;
  ```

Rules (decided here):
- Every op returns the same object when nothing changes, and a new document otherwise (never mutates). Days are always `monthFirstDay(asOf, m)` / `monthLastDay(asOf, m)`, so every result is aligned (rule 4 of policy-timeline).
- Clamps: `from` month in [1, months]; `to` in [from, months] or null; a span never overlaps its neighbours (clamped at the neighbour's edge); a move that cannot happen returns `doc` unchanged.
- `nearerEdge`: the edge nearer the playhead's month; a tie or an open end (`to === null`) gives `'from'`. **Spec ambiguity** (rule 11 "its nearer edge"): see OQ-5.
- `barKey`: ArrowLeft/Right move the nearer edge by 1 month, with Shift by 12; Alt+ArrowLeft/Right move the whole span by 1 (Shift+Alt by 12); anything else null.
- `splitSpan` at month a (from < a ≤ to, or to null): `[from, a-1]`, `[a, to]`, each with a `structuredClone` of `what`. `addSpan` starts at `fromMonth`, ends the month before the next span (or null), copying the `what` of the nearest earlier span, else the first.
- `removeSpan` on a policy's only span returns `doc` unchanged (the editor disables it; Remove removes the policy). `movePolicy` swaps within the kind's list; at an end it is a no-op.

- [ ] **Step 1: Write the failing tests** — one per op, plus:

```ts
it('clamps: no from on or before the dataset date, none past the window, no overlap', () => {
  expect(moveEdge(doc, ref0, 'from', -1, w)).toBe(doc); // already month 1
  expect(spanMonths(policyOf(moveSpan(two, ref0, 500, w), 'zoning', 'a')!.spans[0], asOf).to)
    .toBe(spanMonths(two.kinds.zoning[0].spans[1], asOf).from - 1);
});
it('every op yields a reconciled document', () => {
  for (const next of [setFrom(...), setTo(...), moveEdge(...), moveSpan(...), splitSpan(...), addSpan(...).doc, removeSpan(...), setOn(...), removePolicy(...), movePolicy(...)])
    expect(reconcilePolicy4(next, cal, asOf).doc).toBe(next);
});
it('barKey: arrows move the nearer edge by a month, Shift by a year, Alt the whole span', () => {
  expect(barKey({ key: 'ArrowRight', shiftKey: true, altKey: false }, s, 2, asOf)).toEqual({ op: 'edge', edge: 'from', by: 12 });
  expect(barKey({ key: 'ArrowLeft', shiftKey: false, altKey: true }, s, 2, asOf)).toEqual({ op: 'span', by: -1 });
});
```

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/spans.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): span and policy edit operations`.

---

### Task 5: Adding policies and the schema 3 lens

Model: opus.

**Files:**
- Create: `src/lib/timeline/add.ts`, `src/lib/timeline/lens.ts`
- Test: `src/lib/timeline/add.spec.ts`, `src/lib/timeline/lens.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`SpanRef`, `Window`, `policyOf`); `upgradePolicy` (`src/lib/timeline/upgrade.ts:12`); `DEFAULT_POLICY`, `SimPolicy` (`src/lib/sim-page/policy.ts`); `newLayer` (`src/lib/sim-page/transit-edit.ts:26`); `resolvePreset`, `PRESETS`, `OBSERVED_TIMING` (`src/lib/sim-page/timing.ts:298`); `fundingPresets`, `addPreset` (`src/lib/sim-page/funding-presets.ts:106,463`); `simTabs` condition (`src/lib/sim-page/tabs.ts:23`: money exists exactly when `cal.market && cal.baselineFunding`, rule 8).
- Produces:
  ```ts
  // add.ts
  export type AddChoice =
    | { kind: 'zoning'; what: 'transit' | 'paint' }
    | { kind: 'zoning'; what: 'protect'; category: 'rentControl' | 'historic' | 'newerThan' }
    | { kind: 'permitting'; what: 'preset'; preset: PresetId }
    | { kind: 'permitting'; what: 'custom' }
    | { kind: 'money'; what: 'preset'; preset: string }
    | { kind: 'money'; what: 'fund' | 'baseline' | 'terms' };
  export function addChoices(kind: PolicyKind, cal: Calibration, doc: SimPolicy4): { choice: AddChoice; label: string }[];
  export function addPolicy(doc: SimPolicy4, choice: AddChoice, ctx: { w: Window; month: number; cal: Calibration }): { doc: SimPolicy4; ref: SpanRef };
  // lens.ts
  export interface EditStore {
    readonly policy: SimPolicy;
    apply(change: (p: SimPolicy) => SimPolicy, label: string, coalesce?: string): void;
  }
  export interface StrokeStore extends EditStore { undo(): string | null; redo(): string | null }
  export function project(doc: SimPolicy4, ref: SpanRef): SimPolicy;
  export function writeBack(doc: SimPolicy4, ref: SpanRef, p: SimPolicy): SimPolicy4;
  export function spanLens(store: { readonly policy: SimPolicy4; apply(c: (p: SimPolicy4) => SimPolicy4, label: string, coalesce?: string): void; undo(): string | null; redo(): string | null }, ref: () => SpanRef | null): StrokeStore;
  ```

Approach (decided here): **today's "add" logic is reused through schema 3.** `addPolicy` builds a schema 3 `SimPolicy` from `DEFAULT_POLICY` with today's action applied (a `newLayer()` rule; an empty painted area; the protection switched on, `newerThanYears` today's default; `resolvePreset(id, cal)` as `timing.current`; `addPreset(funding, preset)`, a new own pool as `FundingTab` opens one, a baseline scale entry, a terms entry), runs `upgradePolicy(p3, asOf)`, takes the policies it gives for the chosen kind, renames ids clear of the document's ids (and pool and programme ids, policy-timeline "Ids are unique across the document"), sets every span to `{ from: monthFirstDay(asOf, month), to: null }`, appends them to the kind's list, and returns the first as `ref` (rule 12: starts on the playhead's month, no end, selected). `addChoices` lists today's tabs' offers per kind; `money` is offered only when the calibration has `market` and `baselineFunding`.

`project(doc, ref)` is `DEFAULT_POLICY` holding only that span's effect, by selector tag: `transit` → `rules: [{ id: policy.id, kind: 'transit', stopTypes, bands }]`; `painted` → `custom: brushes`; `category` → `protect[category] = true` (`newerThanYears` from `years`); `routes` → `timing: { current: set, saved: null }`; `baseline` → `funding.baselineScale`; `fund` → `funding.pools: pool ? [pool] : []`, `funding.programmes`; `terms` → `funding.terms`. `writeBack` reads the same fields back into that span's `what` (and `where.stopTypes` for transit); every other field of the projection is ignored. A transit projection whose `rules` is empty, or a category projection switched off, sets the policy `on: false` (the editor's own switch maps to the policy's switch). `spanLens(...).apply(c, label, k)` is `store.apply(d => writeBack(d, ref, c(project(d, ref))), label, k)`; `undo`/`redo` delegate. With `ref()` null, `policy` is `DEFAULT_POLICY` and `apply` is a no-op.

- [ ] **Step 1: Write the failing tests**

```ts
it('a new policy starts on the playhead month with no end and is returned selected', () => {
  const { doc, ref } = addPolicy(DEFAULT_POLICY4, { kind: 'zoning', what: 'transit' }, { w, month: 61, cal });
  const p = policyOf(doc, 'zoning', ref.id)!;
  expect(p.spans).toHaveLength(1);
  expect(p.spans[0]).toMatchObject({ from: monthFirstDay(asOf, 61), to: null });
  expect(reconcilePolicy4(doc, cal, asOf).doc).toBe(doc);
});
it('offers money only with market and baseline funding', () => {
  expect(addChoices('money', calNoFunding, DEFAULT_POLICY4)).toEqual([]);
});
it('ids stay unique across the document when adding the same preset twice', () => { ... });
it('project then writeBack of an unchanged projection is the same document', () => {
  for (const ref of everyRef(richDoc)) expect(writeBack(richDoc, ref, project(richDoc, ref))).toEqual(richDoc);
});
it('an editor change through the lens lands in that span only', () => {
  const store = new PolicyStore(twoSpanDoc); // Task 6 makes PolicyStore generic; until then a minimal in-test store
  const lens = spanLens(store, () => ({ kind: 'zoning', id: 'r1', span: 1 }));
  lens.apply((p) => replaceRule(p, { ...p.rules[0], bands: [b] }), 'Edited');
  expect(store.policy.kinds.zoning[0].spans[0]).toEqual(twoSpanDoc.kinds.zoning[0].spans[0]);
  expect(store.policy.kinds.zoning[0].spans[1].what).toEqual({ tag: 'bands', bands: [b] });
});
```

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/add.spec.ts src/lib/timeline/lens.spec.ts` — FAIL.
- [ ] **Step 3: Implement `add.ts` and `lens.ts`.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): add policies at the playhead and the span lens`.

---

### Task 6: The store, the sync and the editors' store type

Model: sonnet.

**Files:**
- Modify: `src/lib/sim-page/policy-store.svelte.ts` (whole file: `PolicyStore` generic; `undoTo`)
- Create: `src/lib/timeline/policy-sync.svelte.ts`
- Modify (type and props only, behaviour unchanged): `src/lib/sim-page/{TransitTab.svelte:27-28,PermittingSection.svelte:28,RouteTimeline.svelte:27,ProtectionsSection.svelte:12,FundingTab.svelte:95,stroke-adapter.ts:68}`
- Test: `src/lib/sim-page/policy-store.svelte.spec.ts` (extend), `src/lib/timeline/policy-sync.svelte.spec.ts`, `src/lib/sim-page/ProtectionsSection.svelte.spec.ts`, `src/lib/sim-page/PermittingSection.svelte.spec.ts`, `src/lib/sim-page/FundingTab.svelte.spec.ts` (extend)

**Interfaces:**
- Consumes: `EditStore`, `StrokeStore` (Task 5); `queriesOf4` (`src/lib/timeline/policy4.ts:64`); `BrushLotsResult` (`src/lib/sim/scenario/types.ts`).
- Produces:
  ```ts
  export class PolicyStore<P = SimPolicy4> { constructor(initial: P); readonly policy: P; canUndo; canRedo; undoLabel; redoLabel;
    apply(change: (p: P) => P, label: string, coalesce?: string): void; reset(p: P): void; undo(): string | null; redo(): string | null;
    /** Undoes until `policy === p`; if `p` is not in the past, records one change back to `p` labelled `label`. */
    undoTo(p: P, label: string): void;
    locked: boolean; // kept only until Task 14 removes it with RunPhase (rule 14)
  }
  export class PolicySync {
    constructor(deps: { resolve(q: BrushQuery): Promise<BrushLotsResult>; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; debounceMs?: number });
    /** The lots of the latest policy: null while a query is unresolved or the 250 ms debounce is armed; a new object each time it settles. */
    readonly lots: Record<string, ParcelId[]> | null;
    readonly pending: boolean;
    open(p: SimPolicy4): void;  // no debounce; a failed query counts as no lots; with no queries `lots` is `{}` synchronously
    update(p: SimPolicy4): void; // debounced 250 ms (rule 16)
    resume(): void; retry(key: string): void; result(key: string): BrushLotsResult | undefined;
  }
  ```
  Editor props added (defaults keep today's behaviour exactly):
  - `ProtectionsSection`: `store: EditStore`, `only?: 'rentControl' | 'historic' | 'newerThan'` (renders that one row).
  - `PermittingSection`: `store: EditStore`, `snapshot?: boolean` (default true; false hides Save and "Revert to saved": schema 4 carries a saved set as its own off policy, `upgrade.ts:79-91`, and each policy has on/off and undo). Builder's call: the reason is in the parenthesis.
  - `FundingTab`: `store: EditStore`, `only?: { tag: 'baseline' } | { tag: 'fund'; pool: string } | { tag: 'terms' }` (only those rows; no "Add money"), `priceDay?: Day` (default `calibration.asOf`): the coverage figure and a programme's cost per home are priced on it (rule 10). Thread `priceDay` to `ProgrammeEditor` where it prices.
  - `TransitTab`, `RouteTimeline`: `store: EditStore`; `TransitTab.sync: Pick<PolicySync, 'result' | 'retry'>`.
  - `createStrokeAdapter({ store: StrokeStore, ... })`.

Mechanism: `PolicySync` mirrors `LeverSync` (`policy-store.svelte.ts:178-297`): same parking on `no-session`, `resume` generations, `retry`, failures standing until retried; it produces `lots` instead of compiled levers. `LeverSync` stays until Task 17 deletes it with the old page.

- [ ] **Step 1: Write the failing tests**

```ts
it('undoTo walks back to the given document and keeps redo', () => {
  const s = new PolicyStore(a); s.apply(() => b, 'b'); s.apply(() => c, 'c');
  s.undoTo(a, 'Not applied');
  expect([s.policy, s.canRedo]).toEqual([a, true]);
});
it('undoTo a document not in the past records one change', () => { /* policy === x, undoLabel 'Not applied' */ });
it('PolicySync: lots null while debouncing, then the 250 ms send', () => { /* fake timers; update → lots null; +249 → null; +1 → object with every queriesOf4 key */ });
it('PolicySync.open with no queries gives {} at once', () => { expect(sync.lots).toEqual({}); });
it('PolicySync parks no-session answers and resumes', () => { ... });
it('ProtectionsSection only=newerThan renders that row alone', async () => { ... });
it('PermittingSection snapshot=false shows no Save', async () => { ... });
it('FundingTab prices the coverage figure on priceDay', async () => { /* the coverage line text differs between asOf and a later day with a dated scale */ });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/sim-page/policy-store.svelte.spec.ts src/lib/timeline/policy-sync.svelte.spec.ts src/lib/sim-page/ProtectionsSection.svelte.spec.ts src/lib/sim-page/PermittingSection.svelte.spec.ts src/lib/sim-page/FundingTab.svelte.spec.ts` — the new cases FAIL.
- [ ] **Step 3: Implement.** Existing specs of these editors must still pass unchanged (they pass a `PolicyStore<SimPolicy>`, which satisfies `EditStore`).
- [ ] **Step 4: Run** the same command plus `npm run check` — PASS, no type errors.
- [ ] **Step 5: Commit** `refactor(sim-page): generic store, PolicySync and editor store type`.

---

### Task 7: `Explain` and the new wording

Model: sonnet.

**Files:**
- Create: `src/lib/timeline/Explain.svelte`, `src/lib/timeline/copy.ts`, `src/lib/timeline/test/ExplainHost.svelte`
- Test: `src/lib/timeline/Explain.svelte.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // Explain.svelte props
  interface Props {
    /** The explanation: short, what the reader cannot infer. */
    text: string;
    /** 'button': wraps a non-interactive target in a button (its name is `label` or the child's text); 'wrap': the child is focusable itself. */
    as?: 'button' | 'wrap';
    label?: string;
    children: Snippet;
  }
  // copy.ts
  export const FORECAST_NOTE = 'A forecast if nothing changes.';
  export const RANGE_NOTE = 'Chance only. A few large sites carry most of it.';
  export const CITY_NOTE = 'One of 48 simulated cities.';
  export const capacityNote = (year: number) => `Capacity in ${year}.`;
  export const TWIN_NOTE = 'Each simulated city is run twice, with and without it.';
  export const PER_HOME_SOURCE: string; // world-score rule 2 wording: displaced homes counted in the month the start they replaced would have happened
  export const COVERAGE_RUN_SENTENCE4: string; // funding-copy.ts:88-89 with "a run" → "the forecast"
  export const COVERAGE_OFF_SHORT_SENTENCE4: string; // funding-copy.ts:92-95, same change
  export const CHANGE_NOT_APPLIED = "That change couldn't be applied.";
  export const UPDATING = 'Updating';
  ```
  Builder's call: further `*4` constants for any other `funding-copy.ts` text that says "a run", named after the original with `4` appended, each imported by the component that renders it instead of the original (the originals stay: `/lesscars` imports `funding-copy.ts`).

Behaviour (rule 37, WCAG 1.4.13): opens on pointer enter, focus and tap; stays while the pointer is over the target or the explanation; closes on Escape, on blur (focus leaving both) and on a second tap; from md a popover beside the target, below md an inline line under it. The text is rendered only while open; the target gets `aria-describedby` to it while open and `aria-expanded` when `as: 'button'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows nothing at rest, the text on hover, focus and tap', async () => { ... expect(page.getByText(TEXT)).not.toBeInTheDocument() ... });
it('stays while the pointer moves onto the explanation', async () => { ... });
it('closes on Escape and returns nothing to the tab order', async () => { ... });
it('describes its target while open', async () => { /* aria-describedby on the target points at the text's id */ });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/timeline/Explain.svelte.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): Explain and the new wording`.

---

### Task 8: Ruler, playhead and chart row

Model: sonnet.

**Files:**
- Create: `src/lib/timeline/Ruler.svelte`, `src/lib/timeline/Playhead.svelte`, `src/lib/timeline/ChartRow.svelte`, `src/lib/timeline/test/PlayheadHost.svelte`
- Test: `src/lib/timeline/Playhead.svelte.spec.ts`, `src/lib/timeline/ChartRow.svelte.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`keyTarget`, `filledEndDay`, `clampDay`, `indexOfDay`); `advance`, `SPEED_NAME`, `DEFAULT_SPEED` (`src/lib/fzp/playback.ts`); `formatMonthYear`, `monthYearLabels` (`src/lib/fzp/format.ts`); `scrubMarkers` (`src/lib/fzp/score-view.ts:134`, through `scoreOfView` of Task 11, so the ruler takes `markers: Marker[]` as a prop); `COLORS` (`src/lib/fzp/chart.ts:18`).
- Produces:
  ```ts
  // Playhead.svelte
  interface Props {
    asOf: Day; windowEnd: Day; end: Day /* filledEndDay */;
    day: Day /* $bindable */; playing: boolean /* $bindable */; speed: Speed /* $bindable */;
    playable: boolean /* Task 2 playAvailable */; markers: Marker[];
    onday?(day: Day): void; // once per change
    raf?; cancelRaf?; // test seams as TimeScrubber's
  }
  // Ruler.svelte: { asOf: Day; windowEnd: Day; filledEnd: Day; markers: Marker[]; onjump(day: Day): void }
  // ChartRow.svelte: { view: TimelineView | null; index: number /* playhead month */; target: { deadlineIndex: number; units: number } | null }
  ```

Rules:
- Playhead is `role="slider"`, `aria-label="Date in the simulation"`, `aria-valuemin`/`max` the window's day range, `aria-valuetext` the month and year; keys per Task 3; a key, a drag or a marker jump pauses (rule 23). The readout has a fixed width: every label of `monthYearLabels` stacked in one grid cell, `tabular-nums` (as `TimeScrubber.svelte:1-8`). Play, Pause, Faster and "back to today" as today's scrubber; Play `aria-disabled` with its reason when `!playable`. Playback advances with `advance(clock, dt, speed, end)`; at `end` before the window's end it idles with `playing` still true and resumes by itself when `end` grows; at the window's end `playing` becomes false (rule 24). Nothing plays on mount.
- Ruler: years from the dataset date's year to forty years on, the filled bar from the start to `filledEnd`, the hatched unfilled part, the "RHNA deadline" and "2045" jump markers (rule 3).
- ChartRow is a `<figure>` with an accessible name and a one-sentence `figcaption` summary; average line, band area, a thinner "this city" line, the state target as a dashed marker at its deadline; the part after `index` drawn lighter; nothing past `filledThrough`; strokes ≥ 3:1 and told apart by dash as well as colour (rule 4). Hover or focus of a month shows that month's three numbers (rule 28; a focusable overlay with Left/Right inside the figure).

- [ ] **Step 1: Write the failing tests**

```ts
it('is a slider named "Date in the simulation" with the month as value text', async () => { ... });
it('Left and Right move a month, Page keys a year, Home the dataset date, End the filled mark', async () => { ... });
it('a key pauses playback', async () => { ... });
it('nothing plays on mount', async () => { /* raf never called */ });
it('stops at the filled mark and resumes by itself when the mark moves on', async () => {
  // manual raf: play to end; playing stays true and day === end; rerender with a later end; frames move the day again
});
it('Play is unavailable while not playable', async () => { /* aria-disabled="true" */ });
it('the readout keeps one width as the month changes', async () => { ... });
it('ChartRow draws nothing past the filled mark and names itself', async () => { ... });
it('ChartRow shows a month\'s three numbers on focus', async () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/timeline/Playhead.svelte.spec.ts src/lib/timeline/ChartRow.svelte.spec.ts` — FAIL.
- [ ] **Step 3: Implement** (look and tokens from the mockups and existing chart tokens).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): ruler, playhead and chart row`.

---

### Task 9: The rows

Model: sonnet.

**Files:**
- Create: `src/lib/timeline/Timeline.svelte`, `KindRow.svelte`, `PolicyRow.svelte`, `SpanBar.svelte`, `FixedRow.svelte`, `src/lib/timeline/test/TimelineHost.svelte`
- Test: `src/lib/timeline/Timeline.svelte.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`SpanRef`, `barKey`, `moveEdge`, `moveSpan`, `spanMonths`); Task 8 (`Ruler`, `Playhead`, `ChartRow`); `marketLevel` (`src/lib/fzp/market-view.ts`) for the "Market conditions" row.
- Produces:
  ```ts
  // Timeline.svelte
  interface Props {
    policy: SimPolicy4; calibration: Calibration; asOf: Day; readonly: boolean;
    selected: SpanRef | null; onselect(ref: SpanRef | null): void;
    onedit(change: (p: SimPolicy4) => SimPolicy4, label: string): void;
    onadd(kind: PolicyKind): void; // "+" (the menu is the page's, Task 10)
    playhead: Snippet; ruler: Snippet; chart: Snippet; // Task 8 parts, composed by TimelineMode
    playheadMonth: number; // for barKey
  }
  ```

Rules: rows top to bottom are the ruler, the chart, Zoning, Permitting, Public money, "The world" (rule 2). Closed kind: one thin bar per policy over its spans, label with the count and a "+" (rule 5). Open kind (ruling R7): heading row, one full row per policy with its label and one `SpanBar` per span carrying the span's short setting ("30% faster", "$500M"); no miniature; an off policy dimmed in place; an open-ended span fades at the right edge (rule 6). Fixed rows first in each kind: "Family Zoning Plan, as adopted", "Permitting times, as observed", "City funding today"; "The world" has "Market conditions" from `marketLevel(cal)`; they span the window, cannot move or be removed, and selecting one selects `{ kind, id: 'fixed', span: 0 }`-like ref the inspector shows read-only (builder's call: a `FixedRef` union member if cleaner) (rule 7). Public money and its fixed row appear exactly when `calibration.market && calibration.baselineFunding` (rule 8); without them money policies stay in the document and are not drawn. A `SpanBar` is a focusable button (`aria-label` "{policy label}, {from month} to {to month | no end}"), Enter or click selects, `barKey` moves via `onedit` (label "Moved: {policy label}"); pointer drags of edges snap to months and commit one `onedit` on pointer-up; `readonly` disables moves and "+". Phone (below md): rows closed by default; tapping a kind opens a full-height sheet with its policies over the same ruler, the playhead and chart staying visible above the handle (rule 9).

- [ ] **Step 1: Write the failing tests**

```ts
it('renders closed kinds as miniatures with a count and +', async () => { ... });
it('opens a kind: a row per policy, a bar per span with its setting', async () => { ... });
it('renders the fixed rows and Market conditions', async () => { ... });
it('has no Public money without market and baseline funding', async () => { ... });
it("a bar's keys produce the expected document", async () => {
  // focus bar, press Shift+ArrowRight → onedit called; applying its change gives moveEdge(doc, ref, 'from', 12, w)
});
it('every bar is reachable by Tab and operable by Enter', async () => { ... });
it('readonly renders no + and ignores bar keys', async () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/timeline/Timeline.svelte.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): kind, policy and fixed rows`.

---

### Task 10: The inspector

Model: opus.

**Files:**
- Create: `src/lib/timeline/Inspector.svelte`, `WhenEditor.svelte`, `WhatEditor.svelte`, `AddMenu.svelte`, `src/lib/timeline/test/InspectorHost.svelte`
- Test: `src/lib/timeline/Inspector.svelte.spec.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 6 (`spans.ts` ops, `addChoices`/`addPolicy`, `spanLens`, `PolicyStore`, `PolicySync`, editor props); `PolicySummary` (`src/lib/sim-page/PolicySummary.svelte`, read-only What); `FundingDrafts`, `DRAFT_DISCARDED` (`src/lib/sim-page/funding-drafts.svelte.ts:8`, `funding-copy.ts:389`); `TransitLayerRow`, `PaintTab`, `ProtectionsSection`, `PermittingSection`, `FundingTab`.
- Produces:
  ```ts
  // Inspector.svelte
  interface Props {
    store: PolicyStore<SimPolicy4>; sync: PolicySync; calibration: Calibration; catalog: BrushCatalog | null | undefined;
    drafts: FundingDrafts; selected: SpanRef | null; onselect(ref: SpanRef | null): void;
    playheadDay: Day; asOf: Day; readonly: boolean;
    announce(msg: string): void;
    /** Focus goes back to the selected bar when the editor closes. */
    onclose(): void;
    paint: Snippet; // the page's PaintTab and tools for a painted policy
  }
  // AddMenu.svelte: { kind: PolicyKind; calibration; doc: SimPolicy4; onpick(choice: AddChoice): void }
  ```

Rules: When (rule 10, 11): the spans, each with a from month and a to month or "no end" (month and year selects snapped to model months), Add span, Split at the playhead month, Remove span (disabled on the only span). What: the editor for the selector through `spanLens(store, () => selected)` — transit → `TransitLayerRow` (its Remove removes the policy), painted → the page's `paint` snippet, category → `ProtectionsSection only={category}`, routes → `PermittingSection snapshot={false}`, baseline/fund/terms → `FundingTab only=... priceDay={playheadDay}`. On/off switch, Remove, "Move up"/"Move down" (rule 13). "+" opens `AddMenu`; a pick runs `addPolicy` at the playhead month, applies it as one store change labelled "Added: {label}", announces it and selects the new span (rule 12). Selecting another policy or closing discards an open funding draft and announces `DRAFT_DISCARDED` (rule 15). Read-only (rule 17): When as text, What as `PolicySummary` of `project(doc, ref)`; no control that edits. Fixed rows show what they are, read-only. Debt terms on a fund policy with several spans: OQ-2 (Task 20); this task edits the selected span only.

- [ ] **Step 1: Write the failing tests**

```ts
it('adds a transit rule from the playhead month, selected', async () => { ... });
it('switches a policy off, removes it and reorders it; undo and redo across those', async () => {
  // after each: store.policy equals the spans.ts op; undo x3 → original; redo x3 → final
});
it('edits the selected span only through the hosted editor', async () => { ... });
it('the month fields set from and to, snapped', async () => { ... });
it('discards an unfinished funding draft when another policy is selected, and says so', async () => { ... });
it('read-only renders no editable control', async () => {
  expect(container.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea, [contenteditable="true"]')).toHaveLength(0);
  // and no button other than selection and close
});
it('focus returns to the bar when the editor closes', async () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/timeline/Inspector.svelte.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): inspector hosting today's editors on a span`.

---

### Task 11: Results and the header score from the view

Model: sonnet.

**Files:**
- Create: `src/lib/timeline/results.ts`, `src/lib/timeline/TimelineHeaderScore.svelte`
- Modify: `src/lib/fzp/SimResults.svelte:33-91` (props), `src/lib/fzp/MoneyResults.svelte`, `src/lib/fzp/ScoreChart.svelte` (only what rule 26 needs here; rule 38 moves are Task 16)
- Test: `src/lib/timeline/results.spec.ts`, `src/lib/timeline/TimelineHeaderScore.svelte.spec.ts`, `src/lib/fzp/SimResults.svelte.spec.ts` (rewrite the cases that used seeds, ranks, high water)

**Interfaces:**
- Consumes: `TimelineView` (Task 1); `scoreAt`, `deadlineIndex`, `RHNA_ID`, `homesAddedBy`, `vsFzpText` (`src/lib/fzp/score-view.ts:16,34,39,154,159`); `TimelineScore` (`src/lib/sim/scenario/types.ts:312`); `fillPercent`, `meterValueText`, `trackMax`, `formatCount` (`src/lib/scoreboard`, imported, not edited).
- Produces:
  ```ts
  /** Today's TimelineScore shape over the filled months: shown = mean (rule 26), band p10/p50/p90 = lo/mean/hi, planEffectBand from planEffectBand, tiers from view.tiers + tierBaseline + tierTargets, money = view.money. */
  export function scoreOfView(view: TimelineView, tierBaseline: TierUnits | null): TimelineScore;
  /** The Results at calendar month i (i <= filledThrough): today's ScoreAt over the average, and "This city" (baseline + shown[i].completedNet). */
  export function resultsAt(view: TimelineView, tierBaseline: TierUnits | null, i: number): { at: ScoreAt; city: number };
  /** Rule 27. total is null until filledThrough === lastIndex; delta only when compare === 'plan'; target null until filled to its deadline. */
  export function headerOf(view: TimelineView | null): { total: number | null; year: number; delta: number | null; target: TargetProgress | null };
  ```
  `SimResults` props become: `score, at, city, day, asOf, filledEnd, datasetVersion, builtAt, onsources, copy, capacity, stale, market, pending, terms, uncapped` (removed: `horizon, highWater, bandRuns, bandRunsTotal, seed, representative, canSwitch, onrepresentative`). `bandLine`/`planBandLine` called with `provisional = false` (rule 38: no "(still calculating)"). Money and tier blocks headed "In this city". `ScoreChart` gets `highWater = filledEnd` (draws nothing past the mark).
  `TimelineHeaderScore` props: `{ total: number | null; year: number; target: TargetProgress | null; delta: number | null; busy: boolean; stale: boolean; expanded: boolean; controls: string; onclick(): void; live: string; quiet: boolean }`; same markup and `data-testid`s as `src/lib/scoreboard/HeaderScore.svelte` (`score-bar`, `score-delta`, `score-live`), the count reading "{n} homes by {year}" and today's "calculating" text (`CALCULATING`, `score-view.ts:19`) while `total` is null; `stale` dims it.

- [ ] **Step 1: Write the failing tests**

```ts
it("the header number is baseline plus the average at lastIndex", () => {
  expect(headerOf(whole).total).toBe(whole.baseline.completedNet + whole.mean[whole.lastIndex].completedNet);
});
it('calculating before the window is filled', () => { expect(headerOf(cut(whole, 10)).total).toBeNull(); });
it('the delta is the plan effect at lastIndex only against the plan', () => { ... });
it('resultsAt gives the average basis and This city', () => {
  const r = resultsAt(view, null, 12);
  expect(r.at.total).toBe(view.baseline.completedNet + view.mean[12].completedNet);
  expect(r.at.band).toEqual({ low: view.baseline.completedNet + view.band[12].lo, high: view.baseline.completedNet + view.band[12].hi });
  expect(r.city).toBe(view.baseline.completedNet + view.shown[12].completedNet);
});
it('SimResults renders every row of rule 26 from a fixture view, and This city', async () => {
  // headline, Actually completed, pipeline, new homes, homes in progress by stage, stopped, targets,
  // "In 8 of 10 simulated futures: … to …", "This city", "What the plan adds" with its band, ScoreChart and "Show as table", money and tiers headed "In this city", Sources
});
it('reads perAddedHome and displacedShare from the view', async () => { /* a view whose money.perAddedHome is a sentinel; the text shows it */ });
it('TimelineHeaderScore reads "{n} homes by {year}" and calculating', async () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/results.spec.ts` and `npx vitest run --project client src/lib/timeline/TimelineHeaderScore.svelte.spec.ts src/lib/fzp/SimResults.svelte.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** `FzpMode.svelte` still passes the old props until Task 17 deletes it: keep it compiling by giving the old props it passes no meaning (delete them from its `<SimResults>` call; FzpMode is dead code once Task 14 lands).
- [ ] **Step 4: Run** the same commands and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(timeline): results and header score from the view`.

---

### Task 12: The session

Model: opus.

**Files:**
- Create: `src/lib/timeline/session.svelte.ts`, `src/lib/timeline/test/fake-timeline-worker.ts`
- Test: `src/lib/timeline/session.svelte.spec.ts`

**Interfaces:**
- Consumes: `TimelineClient`, `TimelineClientEvents` (`src/lib/sim/timeline-client.ts:35-60,73`); `reconcilePolicy4` (`reconcile4.ts:254`); `queriesOf4`; Tasks 1-3 (`ChunkLog` ops, `EditState` ops, `MonthGate`, `viewMonthOf`, `indexOfDay`); `SummaryRequester` (`src/lib/fzp/summary-request.ts`).
- Produces:
  ```ts
  export type SessionNotice =
    | { id: 'failed-cells'; retry: 'chunks' }
    | { id: 'not-applied' }                          // CHANGE_NOT_APPLIED (rule 34)
    | { id: 'error'; text: "The simulation couldn't load." | 'Part of the simulation stopped.'; retry: 'open' } // rule 35
    | { id: 'crash'; retry: 'restart' };            // rule 36
  export interface SessionDeps {
    client: Pick<TimelineClient, 'open' | 'setPolicy' | 'viewMonth' | 'resyncMap' | 'retryChunks' | 'restart'>;
    manifest: Manifest; calibration: Calibration;
    /** The store: rule 34 undoes to the last accepted document. */
    undoTo(p: SimPolicy4): void;
    createWorker(): ScenarioWorkerInput;
    now(): number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout;
  }
  export class TimelineSession {
    constructor(deps: SessionDeps);
    readonly events: TimelineClientEvents; // passed to `new TimelineClient(worker, session.events)`
    readonly view: TimelineView | null;     // current
    readonly statics: ScoreStatics | null;
    readonly notices: readonly SessionNotice[];
    readonly phase: 'loading' | 'ready' | 'failed';
    readonly stoppedByError: boolean;
    readonly accepted: SimPolicy4 | null;
    /** At the playhead's calendar month: the view shown and whether it is stale (Task 2). */
    shown(i: number): { view: TimelineView | null; stale: boolean };
    playAvailable(): boolean;
    open(policy: SimPolicy4, lots: Record<string, ParcelId[]> | null): void;
    /** A store change (rule 25: the caller pauses playback). Marks the edit at once. */
    edited(): void;
    /** The debounced pair from PolicySync. Sends setPolicy unless it equals the last sent (canonical JSON). */
    send(policy: SimPolicy4, lots: Record<string, ParcelId[]>): void;
    playhead(day: Day): void; // viewMonth through MonthGate; recomputes stale
    resync(): void;            // onResyncNeeded → client.resyncMap()
    retry(notice: SessionNotice): void;
    dismiss(id: SessionNotice['id']): void;
    /** The card's day needs asking again (rule 21): after an edit, once a `filled` covers it; the caller re-requests. */
    oncardrefresh?: () => void;
    watchCard(day: Day | null): void;
    dispose(): void;
  }
  ```

Rules (decided here):
- Every document sent is `reconcilePolicy4(p, cal, cal.asOf).doc` (R-3); if that is not `p` the session `console.warn`s once (Task 4's ops guarantee alignment; a warning is a bug to fix).
- **Provisional open** (see OQ-3): `open(policy, null)` sends `client.open(manifest, provisionalOf(policy), {})` where `provisionalOf` removes every zoning policy with a brush or transit query (`queriesOf4` non-empty for it); the first `send` after it is part of opening: it does not count as an edit (no Play block, no held view), and a `bad-request` at the provisional rev is silent. `open(policy, lots)` with lots sends the document as is.
- Arrival order (R-1): `onCompiled` → `logCompiled`; `onFilled` → `logFilled`; `onRefill` → `logRefill`; never compare revs to order them. A rev is settled when a `refill` or `compiled` at rev ≥ it arrives, or its `bad-request`. The accepted document is the one sent at the highest settled-accepted rev.
- `onCompiling` with `failedCells.length > 0` → `failed-cells` notice (Retry `client.retryChunks()`, rule 33); the progress itself is not shown.
- `onError` `bad-request` at the latest sent rev (not provisional): `not-applied` notice and `undoTo(accepted)` (rule 34). Any other code: `error` notice, "The simulation couldn't load." before the first `filled`, else "Part of the simulation stopped."; `stoppedByError` true; Retry calls `client.open(manifest, current, lastLots)` (rule 35).
- `onCrash` → `crash` notice; Retry `client.restart(createWorker())`, then `send` the current pair if it differs from the last sent (rule 36).
- `onLookups`, `onCells`, `onHeights`, `onChunks` are forwarded through constructor callbacks the composition sets (Task 13): add to `SessionDeps` as `oncells(u: TimelineUpdate)`, `onlookups(l: LeverLookups)`, `onheights(c: HeightCity)`, `onchunks(c: ChunksResponse)`. Heights are applied in arrival order without a rev filter (builder's call: the worker posts heights for the zoning in view, and a later post supersedes, `ensemble-runner.md:70`).

- [ ] **Step 1: Write the failing tests** (fake worker behind the real `TimelineClient`):

```ts
it('a refill drops months from that index', () => {
  emit(compiled(1)); emit(filled(1, 0, 20)); emit(refill(2, 12));
  expect(session.view!.filledThrough).toBe(11);
});
it('stale begins on edit and ends when the refill passes the playhead', () => {
  session.playhead(dayOf(15)); session.edited(); expect(session.shown(15).stale).toBe(true);
  session.send(doc2, {}); emit(refill(2, 10)); emit(filled(2, 10, 3)); expect(session.shown(15).stale).toBe(true);
  emit(filled(2, 13, 5)); expect(session.shown(15).stale).toBe(false);
});
it('an open card re-requests once a filled covers its day after an edit', () => { ... oncardrefresh called once ... });
it('bad-request undoes to the last accepted document and shows the notice', () => {
  expect(undoTo).toHaveBeenCalledWith(doc1);
  expect(session.notices).toContainEqual({ id: 'not-applied' });
});
it('an error shows Retry and Retry sends openTimeline with the current document', () => {
  expect(worker.lastOf('openTimeline')!.policy).toEqual(current);
});
it('a crash restarts the worker and re-opens', () => { ... });
it('viewMonth is sent when the playhead changes month, at most four a second', () => { ... });
it('resync calls resyncMap', () => { expect(worker.lastOf('resyncMap')).toBeDefined(); });
it('opens provisionally, then sends the full document', () => {
  session.open(withPaint, null);
  expect(queriesOf4(worker.lastOf('openTimeline')!.policy)).toEqual([]);
  emit(error(1, 'bad-request')); expect(session.notices).toEqual([]);
  session.send(withPaint, lots); expect(worker.lastOf('setPolicy')!.policy).toEqual(withPaint);
  expect(session.playAvailable()).toBe(true);
});
it('sends a reconciled document', () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/timeline/session.svelte.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): session over the timeline client`.

---

### Task 13: `TimelineMode`

Model: opus.

**Files:**
- Create: `src/lib/timeline/TimelineMode.svelte`, `src/lib/timeline/owner.ts`, `src/lib/timeline/test/TimelineModeHost.svelte`
- Modify: `src/lib/fzp/debug.ts` (whole file: rule 42 shape; drops `RunPhase`, `levers`, `ranks`, `selectRank`, `switchTrace`, `seed`, `representative`, `highWater`, `score`)
- Test: `src/lib/timeline/TimelineMode.svelte.spec.ts`, `src/lib/timeline/owner.spec.ts`

**Interfaces:**
- Consumes: Tasks 8, 9, 11, 12; `SimMap` via the stub (`src/lib/fzp/test/FzpSimMapStub.svelte`, `sim-map-stub.ts`, kept); `ProjectCardPanel`, `ProjectTooltip`, `SourcesDialog`, `SummaryRequester`, card placement helpers (as `FzpMode.svelte:678-790`); `NoticePills`, `PILL`, `PILL_ACTION`; `useHeaderActions` (`src/lib/shell/header-actions.svelte.ts`); `spawnSimWorker` (`src/lib/sim/client`); `limitsOf` owner shape `PolicyLimitOwner` (`src/lib/sim/world/policy/limits.ts:25-31`).
- Produces:
  ```ts
  // TimelineMode.svelte props (spec "Defined here"): FzpMode's data props and
  interface Props {
    manifest; manifestError; calibration; calibrationError; noScenario; datasetVersion;
    reload(): Promise<{ manifest: Manifest; calibration: Calibration }>;
    createWorker?: () => ScenarioWorkerInput; view?: ViewPrefs; cards?: boolean;
    ownerName?: (owner: LimitOwner, parcelId: ParcelId) => string | null;
    fundingName?: (f: CardFunding) => string | null;
    actions?: Snippet; status?: Snippet; notices?: Snippet;
    policy: SimPolicy4; lots: Record<string, ParcelId[]> | null; readonly: boolean;
    onedit(change: (p: SimPolicy4) => SimPolicy4, label: string): void;
    // builder's additions (spec leaves component boundaries to the builder):
    selected: SpanRef | null; onselect(ref: SpanRef | null): void; onadd(kind: PolicyKind): void;
    inspector?: Snippet<[{ results: Snippet; day: Day }]>;
    onday?(day: Day): void; onclient?(api: TimelineClientApi | null): void;
    onmapready?(h: SimMapHandle, map: MapLike): void; onmanifest?(m: Manifest | null): void;
    oncalibration?(cal: Calibration): void; onheights?(c: HeightCity): void; onchunks?(): void;
    onmiss?(): void; // a map tap that opened no card (Task 14 selects by lot)
    onscore?(): void; scoreExpanded?: boolean; scoreControls?: string; bottomExtra?: number;
  }
  export interface TimelineClientApi { resolveBrush; brushCatalog; lotOutlines; previewBuildings; heightLids; lotAt; retryChunks } // as SimClientApi, FzpMode.svelte:31-42
  // owner.ts
  export function policyOfOwner(o: LimitOwner): string | null; // reads PolicyLimitOwner.policy
  export function ownerName4(o: LimitOwner, doc: SimPolicy4): string | null; // the policy's label; null for fzp or a policy gone
  export function fundingName4(doc: SimPolicy4, baseline: Baseline | undefined): (c: CardFunding) => string | null; // fundingName (funding-view.ts:1081) over the union of the document's money policies
  // fzp/debug.ts SfhFzpDebug
  { phase; day; asOf; playing; speed; filledThrough: number; lastIndex: number; policy: SimPolicy4; stale: boolean; refills: readonly number[]; mean(): number[] }
  ```

Rules: Load states before the worker are FzpMode's (rule 30): `noScenario` renders the map and today's message, no timeline, no worker. On mount (not `no-scenario`) the session opens with `policy` and `lots`; the timeline rows and the inspector render only after mount (SSR carries the shell and the loading status; builder's call so the page's synchronous restore, Task 14, is what the first open sends). A new `policy` object after open calls `session.edited()` and pauses playback (rule 25); a new non-null `lots` calls `session.send(policy, lots)`. The playhead starts at `asOf`, paused (rule 24); `onday` → `session.playhead`, `handle.setTime`, the card's month check. `onResyncNeeded` → `session.resync()` (rule 22). `onLookups` → `handle.setTimelineLookups` (one map lookups object per posted `LeverLookups`, as `FzpMode.svelte:57-67`) (rule 20). Cards are always on; a tap that hits a project opens its card (rule 19) and `onmiss` is called for a miss tap. The card asks again on a month change and on `oncardrefresh`; it is dimmed while stale; on an error or crash it shows today's "Details unavailable" (rules 21, 35). Map, Results, card and header are dimmed while `shown(i).stale`; the status slot renders the page's `status` snippet then `UPDATING` while stale, else `fillStatusText`; one polite live region, updated at most once a second, reserving the width of its longest text (rules 31, 32). Notices: the session's notices as pills with their Retry; the page's `notices` snippet first. Header: `TimelineHeaderScore` from `headerOf(shown(lastIndex).view)`; its `live` is `homesAddedBy(day, at)` at the playhead month, `quiet` while playing (rule 27). The Results snippet passed to `inspector` is `SimResults` over `scoreOfView` / `resultsAt` at the playhead month (rule 26). Desktop: the inspector is a side panel leaving the timeline visible; phone: a sheet (rule 1).

- [ ] **Step 1: Write the failing tests**

```ts
it('renders map, then timeline; no worker and no timeline without a scenario', async () => { ... });
it('nothing plays on open; the playhead is at the dataset date', async () => { ... });
it('an edit pauses playback and Play is unavailable until filledThrough === lastIndex', async () => { ... });
it('sends viewMonth when the playhead enters another month', async () => { ... });
it('onResyncNeeded calls resyncMap', async () => { /* stub handle fires the resync callback */ });
it('the status slot says Updating while stale, then Forecast filled to …, then nothing', async () => { ... });
it('the header shows calculating, then baseline plus the average at lastIndex', async () => { ... });
it('an open card is dimmed while stale and asks again once the refill covers its day', async () => { ... });
it('a miss tap calls onmiss and opens no card', async () => { ... });
it('ownerName4 names the policy that sets a lot; fzp and a removed policy give null', () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/timeline/TimelineMode.svelte.spec.ts` and `npx vitest run --project server src/lib/timeline/owner.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(timeline): TimelineMode composition`.

---

### Task 14: `/sim` page switchover

Model: opus.

**Files:**
- Modify: `src/lib/sim-page/SimPage.svelte` (whole file), `src/lib/sim-page/selection.ts` (schema 4: select by policy id), `src/lib/sim-page/stroke-adapter.ts:81` (drop `store.locked`), `src/lib/sim-page/policy-store.svelte.ts` (remove `locked`, `policy-store.svelte.ts:27,62,89,101`), `src/lib/sim-page/SimNotices.svelte` (accept `SimNotice4`)
- Create: `src/lib/timeline/session4.ts`
- Test: `src/lib/sim-page/SimPage.svelte.spec.ts` (rewrite), `src/lib/timeline/session4.spec.ts`, `src/lib/sim-page/test/SimPageHost.svelte`

**Interfaces:**
- Consumes: Tasks 5, 6, 10, 13; `createSimCodec4`, `openSimDoc4`, `migrateSimAutosave`, `simDoc4Problems`, `SIM_KEY4`, `SimDoc4` (`src/lib/timeline/sim-doc4.ts:35,74,210,276,320`); `Autosave` (`src/lib/sharing/autosave.svelte.ts:27`); `reconcileTiming`/`changeText` report shapes via `Policy4Report` (`reconcile4.ts:18-35`); `fundingNotices` (`funding-copy.ts:327`), `TIMING_NOTICE_TEXT` (`sim-session.ts:32`), `copyFor('sim')`.
- Produces:
  ```ts
  // session4.ts
  export type SimNotice4 = Omit<SimNotice, 'id'> & { id: SimNotice['id'] | 'upgraded' };
  export const UPGRADED_TEXT: (from: string /* month year of month 1 */) => string; // builder's short wording, e.g. "Saved before policies had dates. Each starts {from}."
  /** Autosave or Remix restore: migrate v1 → v2 (R-3), restore, then the notices in today's order: autosave's, funding (from report.funding), timing (from report.timing), 'upgraded' when upgradedFrom is 2 or 3, Remix toast. */
  export function restoreSim4(storage: Storage | null, autosave: Autosave<SimDoc4>, ds: OpenDataset, remix?: { from: string; doc?: string; upgradedFrom?: number }): { doc: SimDoc4; notices: SimNotice4[] };
  /** A shared document's text, opened (view mode and the /s Retry path). */
  export function openShared(text: string, ds: OpenDataset, upgradedFrom?: number): { ok: true; doc: SimDoc4; notices: SimNotice4[] } | { ok: false };
  ```
  `SimPage` props: `manifest, manifestError, calibration, calibrationError, noScenario, datasetVersion, reload, mode, persist, initialText?: string, remix?, upgradedFrom?, storage?, fetchFn?, timers?` (removed: `urlSeed`, `onurlseed`, `initialPolicy`, `leverTimers`).

Rules:
- The store is `PolicyStore<SimPolicy4>`; `PolicySync` feeds `lots`; `RunPhase`, `store.locked`, `startRun`, `resetRun`, the Run button, the dock, its tabs, the run slider and the high-water mark are gone from `/sim` (rule 14, OD-9; known sites `SimPage.svelte:108,342,361,399,485,502-512,520,657,696,919,1016,1018,1044,1048,1058`; grep `run.phase`, `locked`, `RunPhase` for the rest).
- Restore runs synchronously in the script when in the browser (`BROWSER` from `esm-env`) and the calibration is known, so `TimelineMode`'s first `policy` is the restored one; with no calibration at mount it runs on `oncalibration` after a Retry's reload. `persist: 'restore'` autosaves through `createSimCodec4(ds)` under `sfhousing:sim:v2`, `writable: (d) => simDoc4Problems(d).length === 0`; `migrateSimAutosave(storage, ds)` runs first. Publish uses the same codec.
- The view menu and its overlays are offered at all times; height limits, lids, the paint preview and the lot tooltip follow the worker, which answers for the last `viewMonth` (rule 18). Strokes (rule 19, builder's call): a paint or erase stroke goes into the selected painted policy's span covering the playhead (else its selected span); with no painted policy selected, a new painted policy from the playhead month is added and selected first. The stroke adapter takes `spanLens(store, ...)` as its `StrokeStore`.
- A miss tap (`onmiss`) with Move: `lotAt` at the tap point (from the map's `click` lngLat), `policyOfOwner(owner)` → select that policy's span covering the playhead (else its first) and open its kind (rule 19; today's `selectAt`, `SimPage.svelte:671-689`).
- `ownerName` = `ownerName4(o, store.policy)`; `fundingName` = `fundingName4(store.policy, calibration?.baselineFunding)` (rule 21).
- Header score press toggles the inspector's Results face; selecting a policy shows its editor (builder's call, from the mockup's inspector column).
- The schema 3 `SimRoute` props are adapted minimally here (pass `initialText` through; seed handling stays until Task 15).

- [ ] **Step 1: Write the failing tests** (rewrite of `SimPage.svelte.spec.ts`; drop every Run, run-slider, seed, dock-tab and lock case):

```ts
it('opens with the autosaved v2 document, migrating a v1 record first', async () => { ... });
it('a v1 schema 3 autosave opens upgraded with the upgraded notice', async () => { ... });
it('adding, switching off, removing and reordering a policy; undo and redo across those', async () => { ... });
it('a paint stroke lands in the selected painted span; with none selected a new painted policy starts at the playhead', async () => { ... });
it('a tap on an empty lot selects the policy that sets its limit', async () => { ... });
it('a tap on a building opens its card and selects nothing', async () => { ... });
it('bad-request from the worker undoes the edit and shows "That change couldn\'t be applied."', async () => { ... });
it('publishes a schema 4 document', async () => { /* fetchFn body parses with parseSimDoc4(text, asOf) */ });
it('view mode renders no editable control', async () => { ... });
it('the view menu is offered at all times', async () => { ... });
it('session4: notices in order: autosave, funding, timing, upgraded, remix', () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/sim-page/SimPage.svelte.spec.ts` and `npx vitest run --project server src/lib/timeline/session4.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(sim): one-screen timeline replaces setup and run`.

---

### Task 15: Routes, `/s/<id>` and `/api/policies`

Model: opus.

**Files:**
- Create: `src/lib/timeline/server-codec.ts`
- Modify: `src/lib/server/sharing/codecs.ts:4-8`, `src/routes/s/[id]/+page.server.ts:2,9`, `src/routes/s/[id]/+page.ts`, `src/routes/s/[id]/+page.svelte:11,26-38`, `src/routes/sim/+page.ts`, `src/lib/sim-page/SimRoute.svelte` (whole file), `src/lib/sim-page/load.ts:20-26` (drop the seed from the page data types), `src/lib/server/test/sim-docs.ts`
- Test: `src/lib/timeline/server-codec.spec.ts`, `src/routes/api/policies/server.spec.ts`, `src/routes/s/[id]/page.server.spec.ts`, `src/routes/s/[id]/page.spec.ts`, `src/routes/s/[id]/page.view.svelte.spec.ts`, `src/routes/sim/page.spec.ts`, `src/routes/sim/page.svelte.spec.ts`

**Interfaces:**
- Consumes: `parseSimDoc4` (`sim-doc4.ts:191`), `parsePolicy4` (`parse4.ts:353`), `serializeSimDoc4` (`sim-doc4.ts:249`), `nothingInForce`, `parseSimDoc` + `SIM_CODEC.opCount` (`src/lib/sim-page/sim-doc.ts:199`, read-only use), `DocCodec` (`src/lib/sharing/doc-codec.ts:23`), Task 14 `openShared`.
- Produces:
  ```ts
  /** What the server holds of a policy row: validated, never upgraded or reconciled (it has no dataset). */
  export interface SharedSim { schema: 2 | 3 | 4; kind: 'sim'; datasetVersion: string; title?: string; text: string; policy: SimPolicy4 | null }
  export const SIM_SERVER_CODEC4: DocCodec<SharedSim>;
  ```

Decided here (R-4: who opens `/s` documents): the server validates and the page opens. `SIM_SERVER_CODEC4.parse` (publish, strict) is `parseSimDoc4(text, null)` mapped to `SharedSim` (`text = serializeSimDoc4(doc)`, `policy = doc.policy`); `load` (stored rows) accepts schema 4 via the envelope checks plus `parsePolicy4(r.policy, { asOf: null, presetLayer: 'reconcile' })` and schema 2/3 via `parseSimDoc(text, 'reconcile')`, keeping the stored `text`; a newer schema fails `future-schema`. `schema(d)` is 4 (so `shared-page.ts:81` reports `upgradedFrom` for 2 and 3); `serialize(d)` is `d.text`; `isEmpty` is `nothingInForce(d.policy)` (legacy rows: today's `isDefaultPolicy` of the parsed schema 3); `opCount` counts spans (legacy: today's `SIM_CODEC.opCount`). `/s/[id]/+page.ts` opens the text with `openShared(doc.text, { asOf: cal.asOf, calibration: cal }, upgradedFrom)` when the calibration loaded, and throws `error(500, copyFor('sim').unparsable)` if it fails; with no calibration it passes the text on and `SimPage` opens it after a Retry's reload (a failure there shows the `unparsable` text as an alert notice). Remix writes the opened document with `remixToLocal(doc, current, storage, now, createSimCodec4(ds))`; its confirm asks only when the local v2 document has anything in force. `?seed=` is ignored: `SimRoute` removes it from the URL with `replaceState` after navigation (rule 25, OD-4), keeping other parameters, and no longer remounts on it.

- [ ] **Step 1: Write the failing tests**

```ts
it('publish accepts schema 4 and rejects 2 and 3 as unknown-schema', async () => { ... });
it('a stored schema 3 row loads on the server as text and opens upgraded on the page', async () => { ... });
it('a stored schema 4 row from an earlier dataset loads unaligned and opens reconciled', async () => { ... });
it('/s shows the shared timeline read-only', async () => { ... });
it('Remix stores the opened document under sfhousing:sim:v2', async () => { ... });
it('?seed= is removed from the URL and changes nothing', async () => { ... });
```

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/server-codec.spec.ts src/routes/api/policies/server.spec.ts src/routes/s/[id]/page.server.spec.ts src/routes/s/[id]/page.spec.ts src/routes/sim/page.spec.ts` and `npx vitest run --project client src/routes/s/[id]/page.view.svelte.spec.ts src/routes/sim/page.svelte.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(sim): schema 4 for /sim, /s and /api/policies`.

---

### Task 16: Explanations behind interest, and the rule 37 test

Model: sonnet.

**Files:**
- Modify: `src/lib/sim-page/PermittingSection.svelte:122-125,166-170`, `src/lib/sim-page/FundingTab.svelte:446-460`, `src/lib/sim-page/MarketTerms.svelte:150-160`, `src/lib/fzp/ScoreChart.svelte:220-230`, `src/lib/fzp/SimResults.svelte:255-280`, `src/lib/fzp/MoneyResults.svelte`, `src/lib/fzp/SourcesDialog.svelte`, and the components rendering `funding-copy.ts` texts that say "a run" (import the `*4` constants from `src/lib/timeline/copy.ts` instead)
- Test: `src/lib/timeline/rest-text.svelte.spec.ts`, the existing specs of the modified components (update their text expectations)

**Interfaces:**
- Consumes: `Explain` and `copy.ts` (Task 7); the `SimPageHost` and fake worker (Tasks 12, 14).
- Produces: nothing new for later tasks.

Rule 38's table, each row placed: the preset summary behind the preset's name; the Local Program sentence behind the switch "Local Program lots streamlined"; "Affordable homes: 62% covered" stays, the rest behind it; the guarantee-rate note behind the empty field; the violet-lines sentence behind the reference lines' legend entry; the twin paragraph behind "What the plan adds", cut to `TWIN_NOTE`; "One possible future … not a forecast." and the market "…it is not a forecast." become `FORECAST_NOTE` behind the headline and in Sources; funding copy "a run" → "the forecast", each behind its disclosure; the per-home `MONEY_SOURCES` sentence shown as `PER_HOME_SOURCE` in Sources (the hashed `finance-score.ts` and `/lesscars`-imported `provenance.ts` keep theirs: `MoneyResults` and `SourcesDialog` map that entry's text at render); `RANGE_NOTE` behind the range in Results and on the band; `CITY_NOTE` behind each "this city" label; `capacityNote(year)` behind the capacity figure; the three notices stay notices. Any other text of 12 words or more shown at rest goes behind what it explains (rule 39).

- [ ] **Step 1: Write the failing test**

```ts
// Rule 37: /sim at rest (SimPageHost, fake worker: compiled + one filled chunk), and again with Results open.
it('shows no text of 12 words or more at rest outside a notice, a dialog or an open explanation', async () => {
  const long = visibleTextNodes(document.body)
    .filter((n) => !n.parentElement!.closest('dialog, [data-notice], [data-explain-open]'))
    .map((n) => n.textContent!.trim())
    .filter((t) => t.split(/\s+/).length >= 12);
  expect(long).toEqual([]);
});
```
(`visibleTextNodes` walks text nodes whose parent passes `checkVisibility()`; notices carry `data-notice`, an open `Explain` `data-explain-open`.)

- [ ] **Step 2: Run** `npx vitest run --project client src/lib/timeline/rest-text.svelte.spec.ts` — FAIL, listing today's long texts.
- [ ] **Step 3: Move each text** as above until the list is empty.
- [ ] **Step 4: Run** it and the modified components' specs (`npx vitest run --project client src/lib/sim-page/PermittingSection.svelte.spec.ts src/lib/sim-page/FundingTab.svelte.spec.ts src/lib/fzp/ScoreChart.svelte.spec.ts src/lib/fzp/SimResults.svelte.spec.ts src/lib/fzp/SourcesDialog.svelte.spec.ts`) — PASS.
- [ ] **Step 5: Commit** `feat(sim): explanations wait for interest`.

---

### Task 17: Deletions and the e2e hook

Model: sonnet.

**Files:**
- Delete (rule 41): `src/lib/fzp/{FzpMode.svelte,FzpMode.svelte.spec.ts,RunSlider.svelte,RunSlider.svelte.spec.ts,RunSliderHost.test.svelte,run-slider.ts,run-slider.spec.ts,run-switch.ts,run-switch.spec.ts,seed.ts,seed.spec.ts}`, `src/lib/fzp/test/{FzpModeHost.svelte,fake-worker.ts}`, `src/lib/sim-page/{run-phase.svelte.ts,run-phase.svelte.spec.ts,lever-status.ts,lever-status.spec.ts,tabs.ts}`, `LeverSync` from `policy-store.svelte.ts` (and its spec cases), `e2e/bench/run-slider.bench.ts`. Before deleting each, `rg` for importers: delete only when nothing but the deleted set imports it; keep untouched any file `/lesscars` imports (`TimeScrubber.svelte`, `high-water.svelte.ts` stay).
- Modify: `e2e/helpers/run.ts` (whole file: no ranks, no Run; helpers below)
- Test: `npm run check`, `npm run lint`, `npm run test:unit`

**Interfaces:**
- Produces (`e2e/helpers/run.ts`):
  ```ts
  export const slider: (page: Page) => Locator; // 'Date in the simulation'
  export async function waitFilled(page: Page): Promise<void>;         // __sfhFzp.filledThrough === lastIndex
  export async function waitFilledThrough(page: Page, i: number): Promise<void>;
  export async function openKind(page: Page, kind: 'Zoning' | 'Permitting' | 'Public money'): Promise<void>;
  export async function addPolicy(page: Page, kind: string, choice: string): Promise<void>;
  ```

- [ ] **Step 1: Delete and grep.** `rg -n "FzpMode|RunSlider|run-slider|run-switch|fzp/seed|run-phase|lever-status|LeverSync|sim-page/tabs" src e2e scripts` must print nothing but docs.
- [ ] **Step 2: Rewrite `e2e/helpers/run.ts`** (no raised timeouts: wait on the hook with `page.waitForFunction`).
- [ ] **Step 3: Run** `npm run check`, `npm run lint`, `npm run test:unit` — PASS.
- [ ] **Step 4: Commit** `chore(sim): remove the run phases, run slider and seed`.

---

### Task 18: Existing e2e on the new screen

Model: sonnet.

**Files:**
- Modify: `e2e/sim.spec.ts`, `e2e/fzp.spec.ts`, `e2e/fzp-sim.spec.ts`, `e2e/sim-share.spec.ts`, `e2e/sim-funding.spec.ts`, `e2e/chrome-dark.spec.ts`, `e2e/pages-a11y.spec.ts` (and any other spec that `rg -l "/sim|/s/|__sfhFzp" e2e` lists)

Rules: a test of a removed feature (Run, Setup, the run slider, `?seed=`, a locked store, the high-water mark, autoplay) is deleted, not ported; every other test is ported to the timeline (helpers from Task 17). Schema 2 fixtures (`src/lib/sim-page/fixtures/schema2/`, never reformatted) now open as schema 4 with the "upgraded" notice. No `waitForTimeout`, no raised timeouts or retries.

- [ ] **Step 1: Port.**
- [ ] **Step 2: Run** `npx playwright test e2e/sim.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts e2e/sim-share.spec.ts e2e/sim-funding.spec.ts e2e/chrome-dark.spec.ts e2e/pages-a11y.spec.ts --project=chromium --project=mobile` — PASS.
- [ ] **Step 3: Commit** `test(e2e): sim specs on the timeline`.

---

### Task 19: New e2e and accessibility

Model: sonnet.

**Files:**
- Create: `e2e/sim-timeline.spec.ts`

- [ ] **Step 1: Write the tests**

```ts
test('open /sim and see the headline settle', async ({ page }) => { /* score-bar reads "{n} homes by {year}" after waitFilled */ });
test('a transit rule from 2031 refills from 2031, months before unchanged', async ({ page }) => {
  // before = __sfhFzp.mean(); add a transit rule with the playhead in Jan 2031;
  // expect __sfhFzp.refills.at(-1) to be the calendar index of 2031-01 (or later); after waitFilled,
  // mean().slice(0, k) equals before.slice(0, k)
});
test('publish, open the /s link, see the same timeline', async ({ page }) => { ... });
test('a stored schema 3 link opens with the upgraded notice', async ({ page }) => { ... });
test('no axe violations with a kind open and the editor open, light and dark', async ({ page }) => {
  await expectNoA11yViolations(page); // both color schemes via page.emulateMedia
});
test('every bar is reachable and operable by keyboard; focus returns to the bar when the editor closes', async ({ page }) => { ... });
```

- [ ] **Step 2: Run** `npx playwright test e2e/sim-timeline.spec.ts --project=chromium --project=mobile` — PASS.
- [ ] **Step 3: Commit** `test(e2e): the timeline, refill, sharing and accessibility`.

---

### Task 20: Rulings-dependent follow-ups

Model: sonnet. **Blocked by OQ-2 and OQ-4**; do only what main rules.

**Files:**
- Modify: `src/lib/timeline/lens.ts` (OQ-2), `src/lib/timeline/session4.ts` (OQ-4)
- Test: `src/lib/timeline/lens.spec.ts`, `src/lib/timeline/session4.spec.ts`

- [ ] **Step 1 (OQ-2, if ruled as recommended): write the failing test** `it('a debt-terms edit on one span of a fund policy applies to every span')` — after `lens.apply` changing `pool.debt.rate`, every span's `pool.debt` is equal.
- [ ] **Step 2 (OQ-4, if ruled as recommended): write the failing test** `it('a dropped or trimmed span gives one info notice with details')`.
- [ ] **Step 3: Run** `npx vitest run --project server src/lib/timeline/lens.spec.ts src/lib/timeline/session4.spec.ts` — FAIL; implement; run — PASS.
- [ ] **Step 4: Commit** `feat(timeline): <what was ruled>`.

---

### Task 21: Docs

Model: sonnet.

**Files:**
- Create: `docs/dev/timeline-ui.md` (the timeline, the document on the page, the worker messages as the page uses them, the session's rules, the decisions marked "Decided here" and "builder's call" in this plan, known limits from ruling 8)
- Modify: `CLAUDE.md` (scoped-doc line for `timeline-ui.md`; update the `fzp-mode.md` and `sim-page.md` lines), `docs/dev/sim-page.md`, `docs/dev/fzp-mode.md`, `docs/dev/sim-timers.md` (Save and Revert on `/sim`, the timeline UI), `docs/dev/sim-funding.md` (Funding tab hosted per policy, drafts discard rule, "a run" wording), `docs/dev/map-perf.md` (run-slider bench removed; the new bench of Task 22)

- [ ] **Step 1: Write and update.** Terse; each section says what a reader cannot infer from the code.
- [ ] **Step 2: Run** `npx prettier --check docs CLAUDE.md` — PASS.
- [ ] **Step 3: Commit** `docs: timeline-ui`.

---

### Task 22: Measurements (operator only, under the lock)

Model: the operator runs it; an implementer only writes the files.

**Files:**
- Create: `src/lib/timeline/apply-cost.perf.svelte.spec.ts` (project client-perf), `e2e/bench/sim-timeline.bench.ts`

What each measures (R-5; numbers reported, no new bar):
- `apply-cost.perf.svelte.spec.ts`: the real `SimMap` on the fixture manifest (as `src/lib/map/timeline.perf.svelte.spec.ts:1-30`), playback running (`setTime` each frame); apply one `TimelineUpdate` of K = 22 cells and of K = 121 cells (synthetic, `src/lib/map/test/synthetic-timeline.ts`) and time until `debugSnapshot().pending === 0`; median of 5 each, printed; asserts only that `pending` reaches 0.
- `sim-timeline.bench.ts` (`npm run bench:map`): `/sim` with the timeline docked, the map panned as `e2e/bench/map-pan.bench.ts` does; p50/p95 frame time, pass bar p95 ≤ 16.7 ms (`docs/dev/map-perf.md:47`); with `SFH_BENCH_DATASET=2026-11-10-6ee5a23d` after `npm run data:local -- 2026-11-10-6ee5a23d`, also the per-`cells` apply time during the fill.

- [ ] **Step 1: Write both files.**
- [ ] **Step 2 (operator, lock held):** `npm run test:perf -- src/lib/timeline/apply-cost.perf.svelte.spec.ts` (or `npx vitest run --project client-perf src/lib/timeline/apply-cost.perf.svelte.spec.ts`), then `npm run data:local -- 2026-11-10-6ee5a23d` and `SFH_BENCH_DATASET=2026-11-10-6ee5a23d npm run bench:map -- e2e/bench/sim-timeline.bench.ts`, and `npm run bench:map -- e2e/bench/sim-timeline.bench.ts` on fixture-0.
- [ ] **Step 3:** Record the numbers in `docs/dev/timeline-ui.md` (machine, date, load, lock held) and `docs/dev/map-perf.md`; report any ENOENT on `parcels/42_21.json`.
- [ ] **Step 4: Commit** `perf(timeline): apply cost and bench:map with the timeline docked`.

---

## Open questions for main

- **OQ-1 (R-7, retiring the old host on `/sim`).** After Task 14 nothing on `/sim` sends `initScenario`, `reroll`, `setLevers`; `FzpMode` and `ScenarioClient`'s only page user go. The router (`src/lib/sim/router.ts`) and `worker.ts` still route scenario messages to `scenario-host.ts` (hashed). Removing that route is an ensemble-runner file change. **Recommendation:** leave the router and worker as they are in this branch; schedule removal of the scenario route with the `/lesscars` cut-over (OD-7), when `scenario-host.ts` can go too. `scenario-client.ts` stays (its types are imported by `timeline-client.ts:21` and `lookup-requests.ts`). Blocks nothing.
- **OQ-2 (ruling 9, verified).** A schema 4 document **can** give one pool id different debt terms in two spans: `parse4.ts:341` checks only that every span names the same pool id, and `FundingPoolRow` edits `pool.debt` (`FundingPoolRow.svelte:199-201,407`) of the span the inspector hosts; Split (rule 10) copies the span. world-score then prices all the pool's borrowing on month W's terms (`world-score.md:73`). **Recommendation:** a debt-terms edit on a fund policy applies to every span of that policy (one `writeBack` rule in `lens.ts`), so the document can never express what the engine cannot price. Blocks Task 20 step 1.
- **OQ-3 (opening a document whose brush queries are unresolved).** The worker resolves brushes only after its dataset loads (`host.ts:258-261`), so `openTimeline` can never carry the lots of a restored document with painted or transit policies; an open with missing lots fails late (`combine.ts:106-107`), as `'timeline'` (`runner.ts:1021-1024`). **Plan (Task 12):** open with the document minus its query-needing zoning policies, then `setPolicy` the full document once its lots resolve; the provisional open costs a partial fill and one refill. **Recommendation:** accept this for now; ensemble-runner may later add an "await lots" open. Blocks nothing.
- **OQ-4 (spans moved on open).** `Policy4Report.spans` (moved, trimmed, dropped) has no notice in the spec (rule 40 names "today's notices and the 'upgraded' notice"). A dropped span silently changes what a shared policy does. **Recommendation:** one info notice "Some policy dates moved to fit this data." with one detail line per change. Blocks Task 20 step 2.
- **OQ-5 (rule 11 "its nearer edge").** The spec does not say nearer to what. **Plan (Task 4):** the edge nearer the playhead's month (ties and open ends: the start), so either edge is reachable by keys alone after moving the playhead; the month fields in the editor reach both directly. **Recommendation:** confirm. Blocks nothing (one function, `nearerEdge`).
- **OQ-6 (`/lesscars` import closure).** `/lesscars` reaches `src/lib/sim-page/funding-copy.ts`, `sim-session.ts`, `sim-doc.ts`, `policy.ts` and `src/lib/fzp/provenance.ts` through `src/lib/fzp/provenance.ts → funding-copy.ts → sim-session.ts → sim-doc.ts`. Rule 38 rewords texts held there. **Plan:** none of them is edited; new wording lives in `src/lib/timeline/copy.ts` and the `/sim` components import it (Tasks 7, 16). **Recommendation:** keep it so; if main prefers in-place string edits in those files (no `/lesscars` behaviour depends on them), Task 16 shrinks. Blocks nothing.

## Spec and code contradictions found

- Spec 27 changes the header score's text, but `HeaderScore.svelte` is under the hashed `src/lib/scoreboard/`: Task 11 builds `TimelineHeaderScore.svelte` beside it.
- Spec 38 rewords the per-home sentence of `MONEY_SOURCES`, which lives in the hashed `src/lib/sim/scenario/finance-score.ts:579`: Task 16 maps that entry's text at render.
- Spec 43 names `docs/dev/sim-timeline.md`; the conductor renamed it `docs/dev/timeline-ui.md` (Task 21).
- Spec rule 41 lists `TimeScrubber.svelte` and `high-water.svelte.ts` for deletion "if nothing else imports them": `/lesscars` does (`LessCarsMode.svelte`), so both stay untouched.
