# FZP Horizon 2066 + No Autoplay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the `/fzp` timelapse to 2066-12-31 instead of 2050-12-31, and stop it playing on its own when the page becomes ready.

**Architecture:** The horizon has a single source of truth, `HORIZON` in `src/lib/fzp/time.ts`. The worker, scoreboard and scrubber all take it from there, and the sim accepts any integer horizon. The only places that hard-code 2050 are the chart's x ticks and its aria-label, plus tests, fixtures, the e2e suite and the docs. Autoplay is a one-shot latch in `TimeScrubber.svelte`, switched on by `FzpMode.svelte`. Its only consumer is going away, so the feature is deleted rather than defaulted off.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Vitest (`server` and `client` projects), Playwright.

**Spec:** None. The request is "extend the simulator to 2100 so it can reach the 2031 target; entering timeline mode shouldn't press play", then narrowed to 2066 (+40 years). Background: `docs/dev/fzp-mode.md`, `docs/superpowers/specs/2026-10-16-fzp-mode-design.md` (OD-T4 sets the old horizon).

## Global Constraints

- New horizon: `dayFromUtc(2066, 12, 31)`, which is Day 35,428 (483 months from 2026-10).
- Dated specs and plans under `docs/superpowers/` are historical, so leave them alone. Update only `docs/dev/fzp-mode.md`.
- Sim test fixtures with their own 2050 horizon stay as they are: `MINI_HORIZON`, `GOLDEN_HORIZON`, the bench's `HORIZON`, `timeline-small.ts` and `synthetic-timeline.ts`. They test the engine, not the product horizon.
- Leave playback speeds alone. At the default 1 year/s a full run takes about 40 s.
- Out of scope: computing or showing the date a target is reached. Nothing does that today.

## Review Focus

1. **Time to ready on `/fzp`.** At 2066 there are about 1.66× as many months and more initiations per run. The worker's first band must still arrive in reasonable time. Task 3 measures it.
2. **Chart x-axis at 2066.** Fixed ticks would stop at 2050. Generated ticks must reach 2060 and not crowd a phone-width chart. Task 2 tests this.
3. **Chart aria-label.** It must name the actual end year, not "2050". Task 2 tests this.
4. **A first-time visitor with motion allowed.** The day must stay at `asOf` until Play is pressed. Task 1 has an e2e test for this.
5. **Scrubber markers.** At 2066 the RHNA deadline marker sits about 10% from the left and the 2045 marker about 45%. Their labels must not overlap at 375 px. Task 3 checks this by eye.

---

### Task 1: Remove autoplay

**Files:**
- Modify: `src/lib/fzp/TimeScrubber.svelte`. Delete the `autoplay` prop (`:20-21`, default `:38`) and the latch `$effect` (`:72-78`). Keep `reducedMotion` only if something else still reads it; otherwise delete it too.
- Modify: `src/lib/fzp/FzpMode.svelte:675`. Delete `autoplay={phase === 'ready'}`.
- Modify: `src/lib/fzp/TimeScrubberHarness.svelte`. Delete the `autoplay` prop and the "autoplay-flip" button.
- Modify: `src/lib/fzp/TimeScrubber.svelte.spec.ts:255-314`. Replace the `describe('autoplay')` block.
- Modify: `e2e/fzp.spec.ts:236-248`.
- Modify: `e2e/fzp.spec.ts:108-112` and `e2e/fzp-sim.spec.ts:44-46`. These only change comments: reduced-motion emulation no longer exists "to stop autoplay". Keep the emulation and reword the comment, or drop it if nothing else depends on it.
- Modify: `docs/dev/fzp-mode.md:20,25`.

**Interfaces:**
- Produces: `TimeScrubber` no longer accepts `autoplay`. `playing` changes only through Play/Pause, the keyboard, or `bind:playing`.

- [ ] **Step 1: Write the failing tests**

In `TimeScrubber.svelte.spec.ts`, replace the autoplay block with:
```ts
describe('playback start', () => {
  it('does not play on mount, even without reduced motion', async () => {
    // render the harness with reducedMotion: () => false; wait two animation frames
    // expect(playing).toBe(false); expect(day).toBe(asOf)
  });
  it('plays when Play is pressed', async () => {
    // click Play; expect.poll(day).toBeGreaterThan(asOf)
  });
});
```
In `e2e/fzp.spec.ts`, rename the test at `:236` to `'the day stays at asOf until Play is pressed'`. With `reducedMotion: 'no-preference'`: goto `/fzp`, `waitReady`, wait 2 000 ms, then expect `day === asOf` and `playing === false`. Click Play and `expect.poll(day).toBeGreaterThan(asOf)`. Delete the reduced-motion half of the old test; the reduced-motion behaviour it covered was autoplay suppression.

- [ ] **Step 2: Run them and watch them fail**

Run `npx vitest --run --project client src/lib/fzp/TimeScrubber.svelte.spec.ts`. Expected: FAIL. Mount-without-play fails only if the harness still autoplays; if the harness defaults `autoplay` to false it may pass already. In that case confirm the e2e test fails: `npx playwright test e2e/fzp.spec.ts -g "until Play"` should fail with `day > asOf`.

- [ ] **Step 3: Delete the prop, the latch, the harness hooks and the FzpMode binding**

- [ ] **Step 4: Run the tests and type check**

Run `npx vitest --run --project client src/lib/fzp`, then `npm run check`, then `npx playwright test e2e/fzp.spec.ts e2e/fzp-sim.spec.ts`. Expected: all pass, with 0 svelte-check errors.

- [ ] **Step 5: Update `docs/dev/fzp-mode.md`**

Replace the **Autoplay** paragraph (`:20`) with: "Playback never starts on its own: the page opens paused at `asOf` and waits on Play." In `:25`, drop the sentence saying the day advances from the moment the page is ready.

- [ ] **Step 6: Commit** `fix(fzp): open timeline mode paused instead of autoplaying`

---

### Task 2: Move the horizon to 2066

**Files:**
- Modify: `src/lib/fzp/time.ts:20-21`.
- Modify: `src/lib/fzp/chart.ts:167-170` (ticks) and `:254` (aria-label).
- Modify: `src/lib/sim/scenario/score.ts:22-25`. This only updates the doc comment's example ("291 entries … 2050-12-31") to say "483 entries for 2026-10-16 to 2066-12-31".
- Modify: `src/lib/fzp/fixtures/timeline-score.ts`. Export the fixture's own horizon.
- Modify the tests that pair the fixture with `HORIZON`: `chart.spec.ts`, `ScoreChart.svelte.spec.ts` (`:21,68,154`), `FzpScoreboard.svelte.spec.ts:41`, `time.spec.ts`, `card.spec.ts:48` (check it).
- Modify: `e2e/fzp.spec.ts:227` and `:425`.
- Modify: `docs/dev/fzp-mode.md:7`.

**Interfaces:**
- Produces: `HORIZON: Day = dayFromUtc(2066, 12, 31)` (35 428).
- Produces: `FIX_HORIZON: Day = dayFromUtc(2050, 12, 31)`, exported from `src/lib/fzp/fixtures/timeline-score.ts` next to `FIX_ASOF`. Every test that renders or charts `TIMELINE_SCORE` passes `FIX_HORIZON`, not `HORIZON`, so the fixture's 291 months and the horizon agree.
- Produces: chart x ticks follow this rule. `firstYear = utcParts(months[0]).y` (or the asOf the chart already holds) and `lastYear = utcParts(horizon).y`. `step = lastYear - firstYear > 50 ? 20 : 10`. The ticks are every year `Y` with `Y % step === 0` and `firstYear < Y <= lastYear`. The rule gives 2030/2040/2050 for a 2050 horizon, 2030/2040/2050/2060 for 2066, and 2040/2060/2080/2100 for 2100, so a later extension needs no chart change.
- Produces: the last aria-label clause reads `` `${total} by the end of ${lastYear}` ``.

- [ ] **Step 1: Write the failing tests**

`time.spec.ts`:
```ts
expect(dayFromUtc(2066, 12, 31)).toBe(35428);
expect(HORIZON).toBe(35428);
```
In the same file, change any month-count or index assertion derived from `HORIZON` from 291/290 to 483/482. Assertions that are about the fixture keep 291 and switch to `FIX_HORIZON`.

`chart.spec.ts`:
- Keep the test `'labels 2030, 2040 and 2050'`, now with `FIX_HORIZON`.
- Add `'labels 2030, 2040, 2050 and 2060 for a 2066 horizon'` (horizon `dayFromUtc(2066, 12, 31)`, labels `['2030', '2040', '2050', '2060']`) and `'labels every 20 years past a 50-year span'` (horizon `dayFromUtc(2100, 12, 31)`, labels `['2040', '2060', '2080', '2100']`). The model can take a fixture score; only the tick labels are checked.
- `:334-338`: keep `'by the end of 2050.'` under `FIX_HORIZON`, and add a case expecting `'by the end of 2066.'` when the horizon is 2066.

`e2e/fzp.spec.ts:227`: `'December 2066'`.

- [ ] **Step 2: Run them and watch them fail**

Run `npx vitest --run --project server src/lib/fzp`. Expected: FAIL on `HORIZON` (29584 ≠ 35428), on the 2066 tick labels and on the 2066 aria-label.

- [ ] **Step 3: Implement**

Set `HORIZON`, updating the doc comment to say "2066-12-31, Day 35,428; was 2050 under OD-T4". Add the tick rule and the aria-label year in `chart.ts`. Export `FIX_HORIZON` from the fixture, fix its header comment, and point the paired tests at it. In `e2e/fzp.spec.ts:425`, change the loop bound from `26` to `42`; the existing `>= horizon` break still ends it.

- [ ] **Step 4: Run the tests**

Run `npx vitest --run --project server src/lib/fzp src/lib/sim`, then `npx vitest --run --project client src/lib/fzp`, then `npm run check`, then `npx playwright test e2e/fzp.spec.ts e2e/fzp-sim.spec.ts`. Expected: all pass. A sim spec that fails here means something read the product `HORIZON`; report it rather than editing a 2050 sim fixture.

- [ ] **Step 5: Update `docs/dev/fzp-mode.md:7`** to "(2066-12-31, `src/lib/fzp/time.ts`)".

- [ ] **Step 6: Commit** `feat(fzp): run the timelapse to 2066`

---

### Task 3: Measure the cost and look at the result

No code unless a check fails.

- [ ] **Step 1: Time to ready.** On `main` and on this branch, run `npm run preview`. Then, in a Playwright script or the browser, time from navigating to `/fzp` until `window.__sfhFzp.phase === 'ready'`. Take three runs each and record the median. Pass: the branch is no more than 2× main. Otherwise stop and report the numbers before shipping.
- [ ] **Step 2: Scenario bench at 2066 (information only).** Temporarily set `HORIZON` in `src/lib/sim/scenario/scenario.bench.spec.ts:58` to `dayOf(2066, 12, 31)`, run that spec alone, record which budgets (`:124-139`, `:362`) it exceeds, and revert. Do not commit the change. Report the numbers.
- [ ] **Step 3: Visual check at 1280 px and at 375 px.** Use the `run` skill or Chrome to open `/fzp`. Check that it opens paused, the scrubber end label reads 2066, the RHNA and 2045 marker labels don't overlap, the chart ticks read 2030/2040/2050/2060, and pressing End shows "December 2066". Take screenshots for the hand-off.
- [ ] **Step 4: Sign off** with `npm run signoff`.
