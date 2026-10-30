# /sim Permitting Timers: Timeline UI, Presets, Stage Floors and Route Shares (Plan 4 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Permitting timelines" section in the `/sim` Policy panel. It shows one timeline per approval route and the share of new projects on each route. The user picks a sourced preset, drags or types stage durations down to sourced physical floors, and can Save or Revert. Everything compiles to plan 2's `timers` and `routeShares` levers, and the map's in-flight bars read their own cohort's lookups.

**Architecture:** The section edits `SimPolicy.timing`, which becomes a `TimingSet` (a preset id, the preset's resolved timers and route shares, custom edits and a custom route split) plus an optional saved snapshot. `compileLevers` concatenates the preset's timers with the custom edits. All timing maths is pure TS in `src/lib/sim-page/timing.ts`, read against the base `calibration` the page already holds. The sourced constants (presets and floors) live in one file, `timing-sources.ts`, which a research task produces. The map gets a second, in-flight lookups set and a per-slot cohort flag, so in-flight bars stop reading the new-project tables.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, worker-safe TypeScript (`src/lib/sim/**`, `src/lib/map/**`), Vitest (`server` and `client` projects), Playwright with `expectNoA11yViolations`.

**Spec:** `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`. Plan 4 owns Goal 3 in full. Read Goal 3, "Partner rulings after the builder check" (timer reach, publishable policies and "Timeline Save"), "Calls made after the builder check" (density and route decoupling), the non-goals and anti-goals, "Known data work" (preset parameters), "Left to the builder" (stage minimums) and "Carried from plan 2". Read it with:

- `docs/dev/sim-levers.md`: "Timer reach", "Rescale construction and bounds", "In-flight remaining-time rule", "Route shares and Local Program forcing", "Disapproval exception" and "Notes for plans 3 and 4".
- `docs/dev/sim-page.md`: the recipe, `PolicyStore`, the layout rulings, and the known gap "In-flight map bars under `'all'` timers".
- `docs/dev/fzp-mode.md`: the T9 lookups seam.
- `docs/dev/accessibility.md`.

## Plan sequence

This is plan 4 of 5. Plans 1 to 3 are merged on `main` at `20f28f8`. Plan 5 owns publishing, local autosave and size limits on the policy document. This plan changes the shape of `SimPolicy.timing` (it is in memory only, so no migration is needed: sim-page.md Call 15) and keeps `parseSimPolicy` strict for plan 5.

## Measured facts this plan relies on

All of these come from dataset `2026-10-29-0fd62c4d` (`scenarios/fzp/calibration.json`, production and staging), read with `parseCalibration`, `typicalMonths` and `eventualProbabilities` on 2026-10-30.

- **Typical (median) months, by pathway and stage.**

  | Stage | Discretionary | Streamlined | Permit only |
  | --- | --- | --- | --- |
  | preApplication | 4 | 4 | 4 |
  | filed | 23 | 7 | none |
  | entitled | 1 | 1 | none |
  | permitFiled | 12 | 10 | 13 |
  | permitIssued | 8 | 6 | 4 |
  | construction | 25 | 24 | 22 |

  "None" means the pathway has no table for that stage.
- **`pathwayForNew`:** discretionary 0.6989, streamlined 0.0875, permitOnly 0.2136 (tier 0, n = 983).
- **`ppaShare`:** 0 on every pathway (tier 0, n = 177, since 2023-07-08). No new project starts at pre-application.
- **Disapproved share** (plan 2, `sim-levers.md:121-133`): 0.0082, 0.0034 and 0.0012, all below `DISAPPROVAL_NEGLIGIBLE = 0.01`. Plan 2 already dropped the exception. Task 1 re-confirms this and gates Task 3.

## Calls made in this plan

Each is the builder's call unless marked otherwise. Each gives its reason and what it costs if wrong.

1. **The bar width is the typical (median) duration, not the mean.** The spec says "average". The map, the cards and `typicalMonths` (`src/lib/timelapse/model.ts:448`) all use the median of leaving the stage by any outcome. The UI says "typical". Reason: one definition everywhere, and the median is what a time-rescale moves by exactly `s`, up to month rounding. Cost if wrong: labels and widths change. The model is untouched.
2. **A duration edit is stored as a scale, not as months.** Custom months `m` on a stage become a `TimerEdit` with `scale = m / (typical0 × presetScale)` and `reach: 'all'`. Here `typical0` is the base calibration's typical months, and `presetScale` is the product of the preset's scales on that stage for new projects. The UI shows `typical0 × freshScale` months, rounded to 0.5 month. Reason: the engine's lever is the scale (`TimerEdit`, `src/lib/sim/levers/types.ts:44-49`), and custom edits reach every project (partner ruling). Cost if wrong: the shown months drift from `typicalMonths` of the rescaled table by up to one month. Task 3 pins that bound with a test.
3. **The policy carries resolved numbers, not just a preset id.** `TimingSet.presetTimers` and `presetRouteShares` are resolved from the calibration when the preset is chosen. Reason: `compileLevers` stays free of the calibration, and the document plan 5 publishes is deterministic in its own numbers. Cost if wrong: a published policy keeps the scales of the dataset it was made on, which is the right behaviour for an immutable link.
4. **Only one preset at a time.** Choosing a preset replaces the current set, edits included (one store change, so Undo restores it). Combinations, such as the SB 423 clock with benchmark permits, are made by editing. Reason: the spec says presets "rewrite the timelines and route shares". Stacking rules for presets would be a new design surface.
5. **Editable stages are `preApplication`, `filed`, `permitFiled` and `permitIssued`.** `entitled` (entitled to permit filed) and `construction` are shown and locked, each with its reason. Reason: this is the spec's list ("pre-application, filed to entitled, permit filed and permit issued, the stages the city controls"). `entitled` is the applicant's wait to file. See Open question 1.
6. **Pre-application is shown and editable, with a note.** The details say "In the records, no new project starts here since July 2023", from `ppaShare`. It still affects pipeline rows that sit at pre-application. Reason: the spec lists it, and hiding a stage when one dataset happens to show 0% would be data-dependent UI. Open question 4.
7. **Stage floors** (spec "Left to the builder") are per pathway and stage, in months, each with a `Provenance`. The UI's minimum for a stage is `max(floor, MIN_SCALE × typical0, …)` (see `stageBounds`, Task 3). A stage with no sourced floor gets no floor. Its minimum is then the numerical bound, and the details say "No sourced minimum; numerical limit ×0.05". Reason: anti-goal "durations below physical minimums", with no invented number. Task 2 supplies the values.
8. **The sourcing rule for presets.** A preset ships only when each of its values is tier 0 to 3 with a source. A preset whose value Task 2 cannot source is left out of `PRESETS` (`available: false` with its reason), and is listed in `docs/dev/sim-timers.md` as "needs a source". Reason: anti-goal "Presets without sources". Open question 3.
9. **The preset definitions** (values in Task 2, the rules in `resolvePreset`, Task 3):
   - **`observed`, "SF as observed":** no timers, observed route shares, Local Program forced. Tier 0 (the calibration's own provenance).
   - **`sb423Clock`, "SB 423 approval clock"** (reach `'new'`). On streamlined `filed`, the scale `s = min(1, D / q90(t))`, where `q90` is the month by which 90% of the stage's outcomes have happened. `D` is the deadline in months: `(90 × p + 180 × (1 − p)) / 30.4375`, where `p` is the per-record share of streamlined projects with 150 or fewer units (Task 2). The route split is unchanged unless Task 2 sources an eligibility shift. The 90% is a tier-4 parameter (Open question 2).
   - **`noDiscretionary`, "No discretionary review"** (route shares only, so new projects only). The discretionary share moves to streamlined, and the permit-only share is kept. Tier 3: a definitional inference from the tier-0 shares (Open question 7). The source is the HCD Policy and Practice Review, required action "eliminate discretion" (Task 2 confirms the citation).
   - **`ceqaInfill`, "CEQA infill exemption (AB 130 / SB 131, 2025)"** (reach `'new'`). It scales discretionary `filed` by `CEQA_FILED_RATIO` from Task 2. Streamlined approvals are ministerial, so CEQA does not apply to them and they are untouched.
   - **`benchmarkPermits`, "Permits at San Diego's pace"** (reach `'all'`). It scales `permitFiled` on every pathway by `134 / 280 = 0.4786`. Both medians are from BLA, Exhibit 1. The ratio's inputs are tier 1, and applying the ratio to our stage is tier 3.

   Every preset keeps `localProgramStreamlined: true`; none says otherwise. A preset scale that would put a stage below its floor is raised to the floor, and the stage shows "Limited by the minimum".
10. **Route shares are whole percentages that always sum to 100.** Editing one share rescales the other two in proportion to their current values; when both are 0, they split the remainder evenly. Rounding uses the largest remainder. Observed shares show rounded. Reason: an invalid intermediate state never reaches the engine, and three inputs stay typeable. Cost if wrong: one more control style.
11. **Local Program forcing is shown, not edited.** A line reads "Family Zoning Plan Local Program lots use the streamlined route" with the preset's value (requirement: forced "unless a preset says otherwise").
12. **Save and Revert work in session.** Save stores the current set as `timing.saved` with the label shown at that moment. Revert goes to `saved` if there is one, else to the preset's own set. Both are labelled store changes, so Undo covers them. Plan 5 persists `saved` with the rest of the policy. Choosing a preset keeps `saved`.
13. **Drag is a pointer enhancement. The keyboard and single-pointer path is the details editor** (WCAG 2.2 2.5.7, 2.1.1). Each route's bar is one roving-tabindex group of segment buttons: Left and Right move between segments, and Enter or a click opens the stage details. The details hold a number input (step 0.5 month, with min and max) and − / + buttons. Drag handles are `aria-hidden`, at least 24 × 24 px, and commit one store change on pointer-up (2.5.8). Reason: eleven sliders would be eleven extra tab stops in a 320 px panel. Cost if wrong: switching handles to `role="slider"` is local to `RouteTimeline`.
14. **Keyboard edits coalesce in undo.** `PolicyStore.apply` gains an optional `coalesce` key. Consecutive changes with the same key, and no undo or redo between them, merge into one history entry. So ten presses of + give one "Undo: Permit review, discretionary to 6 months". Drag commits only on pointer-up.
15. **The in-flight map-bar gap is fixed, not kept** (requirement 6). The presets here are mostly `'new'`-reach. Under them, the map's single `lookups.fresh` would draw pipeline projects at the policy's faster pace, though the law does not touch them. That error runs in the misleading direction (the anti-goal "promising what the evidence can't back").

    The fix: the engine flags in-flight schedules (`Schedule.inFlight`, only on runs with `newProjects`, as `afterSwitch` is only on switch runs), and the packer writes `slotCohort`. The map takes optional `inFlight` lookups and packs a 36-row chance texture, and `segRow` and `typicalDays` pick the cohort's rows. The shader is unchanged: the row index is per-instance data (`stage-bar-layer.ts:436-437`).

    What stays approximate: the in-flight `chanceShift` for the stage a project is in at `asOf` under `'all'` timers is not applied on the map; cards apply it. This is documented as the remaining gap. Cost if wrong: one map-subsystem change (Task 6). It can be reverted alone.
16. **No new dependency, no CSP change, no dataset bump.** Everything reads the existing `calibration.json`.

## Global Constraints

- **Spec anti-goal:** "A policy that skips the simulation. No user setting may decide directly how much gets built." Timers change only stage tables and route shares, through `SimLevers`.
- **Spec anti-goal:** "Presets without sources, or durations below physical minimums, make the tool advocacy rather than a simulator. Every number follows the evidence hierarchy: per-record data, then official aggregates, then inferences, then literature, then invented values. It carries its tier and source, and the UI can show both." Every preset value and floor carries a `Provenance` (`tier`, `label`, `sources[{label, url}]`, `method`), and the stage details show the tier and source.
- **Spec Goal 3:** "One timeline per approval route (discretionary, streamlined, permit-only)… one current set, not a before-and-after view." "Construction is shown but locked." "The chances of advancing are shown, not editable." "FZP Local Program lots stay forced onto streamlined unless a preset says otherwise."
- **Partner ruling (reach):** permit-office speedups reach every project (`'all'`); approval-route and entitlement changes reach only projects filing after the policy start (`'new'`); custom edits reach every project (`'all'`).
- **Partner ruling:** "Timeline **Save** is a named local snapshot inside the current policy." Here it is in memory; plan 5 persists and publishes.
- **Engine bounds:** a single `TimerEdit.scale` must be in `[MIN_SCALE, MAX_SCALE] = [0.05, 10]` (`types.ts:63-65`, `:196-203`); stacked edits clamp in `scaleTable` (`timers.ts:37-51`), and a clamped stack is shown as clamped (`sim-levers.md:182`).
- **No disapproval exception** unless Task 1 finds a pathway at or above `DISAPPROVAL_NEGLIGIBLE = 0.01`. Spec: "If it is negligible, drop the exception."
- **Out of scope:** publishing, local autosave, size limits (plan 5); editing exits or construction (non-goals); funding and feasibility levers.
- **WCAG 2.2 AA** (`docs/dev/accessibility.md`): every control keyboard-operable with a visible label; 2.5.7 (every drag has a single-pointer alternative); 2.5.8 (targets at least 24 × 24 px); no horizontal scroll at 375 px; live regions stay in the accessibility tree while empty (`sr-only`, never `display: none`); colour is never the only signal (locked and clamped segments carry text or an icon with a label).
- **Compact UI, details on demand** (user preference): the section's collapsed header shows one line (the set's label); stage details open on demand.
- **Stack and style:** Svelte 5 runes; colocated Vitest; `expect.requireAssertions` (every test calls `expect`); 2-space indent, single quotes, no trailing commas, 100 columns. `src/lib/sim/**` and `src/lib/map/**` stay worker-safe (no DOM, no zod, no `$app`).
- **Shell and worktree:** never compound `cd … && cmd`. Work only in `.claude/worktrees/sim-timers` (branch `sim-timers`).
- **No push, no upload.** `npm run signoff` runs once, after the last task, when the controller asks.
- **Commits:** Conventional Commits, `-m` flags only (no heredoc), with `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` as the last `-m`.

## Review Focus

1. **Dragging or typing past a bound, and stacked clamps.** A drag below the floor stops at the floor with "Minimum: N months" visible and announced; a drag past `MAX_SCALE` stops likewise. A preset at ×0.48 plus a custom edit can push the in-flight product past `[0.05, 10]`, and that stage says it is limited for projects already in the pipeline. Task 3 tests `setStageMonths clamps to the floor and says which bound` and `an in-flight clamp is reported`; Task 5 test `a drag past the minimum stops and says so`.
2. **Route shares at the edges.** Setting one route to 100 sets the others to 0; editing a 0 route when both others are 0 splits evenly; the three inputs always sum to 100; a route with share 0 still shows its timeline (in-flight projects use it). Task 4 tests `shares always sum to 100` and `a zero-share route keeps its timeline`.
3. **Preset changes, Save and Revert in any order.** Custom edits, then another preset (edits gone, Undo restores them), then Revert (to the saved set if one exists, else the new preset), then Save twice. The label always matches the set. Task 3 tests `revert goes to the save, else the preset` and `choosing a preset keeps the save`; Task 4 test `Undo restores edits a preset replaced`.
4. **Calibrations with missing or extreme tables.** Permit-only has no `filed` or `entitled` table; a stage whose typical months is the tail's `MAX_EVENT_MONTH`; the fixture's one-month pre-application table. No segment is drawn for a missing table, widths stay finite, and the preset rules never throw (`rescaleTransition` throws on impossible scales). Task 3 tests `permitOnly has no filed or entitled stage` and `a huge typical month gives a finite, capped width`.
5. **In-flight bars after the fix.** On a run with a `'new'` timer, a pipeline project's bar reads in-flight rows and a simulated project's reads fresh rows. On a run with no lever timers, every bar is unchanged (the goldens and `/fzp` stay identical). Task 6 tests `cohort rows follow slotCohort` and `no newProjects, no inFlight flag`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/sim-page/timing-sources.ts` (new, Task 2) | Sourced constants: preset parameters and stage floors, each with `Provenance`; availability of each preset |
| `src/lib/sim-page/timing.ts` (new) | Pure timing model: `TimingSet`, presets, `resolvePreset`, `routeView`, `stageBounds`, `setStageMonths`, `setRouteShare`, Save/Revert, labels |
| `src/lib/sim-page/policy.ts` | `SimPolicy.timing` reshaped; `parseSimPolicy`, `policyFromLevers`, `compileLevers` |
| `src/lib/sim-page/policy-store.svelte.ts` | `apply(…, coalesce?)` |
| `src/lib/sim-page/PermittingSection.svelte` (new) | Preset picker, label, Save/Revert, route shares, Local Program line, one `RouteTimeline` per route, the section's live region |
| `src/lib/sim-page/RouteTimeline.svelte` (new) | One route's bar: segments, chance lines, locked marks, drag handles, roving focus, stage details editor |
| `src/lib/sim-page/PolicyPanel.svelte`, `SimPage.svelte` | Fourth section "Permitting timelines"; passes `calibration` |
| `src/lib/sim/scenario/types.ts`, `engine.ts` | `Schedule.inFlight` |
| `src/lib/map/types.ts`, `pack-timed.ts`, `timelapse/lookups.ts`, `timelapse/bars.ts`, `timelapse/encode.ts`, `timeline-controller.ts` | `slotCohort`, optional `inFlight` lookups, 36-row chance texture |
| `src/lib/fzp/FzpMode.svelte` | Pushes both lookups sets to the map |
| `scripts/timing-evidence.ts` (new, Task 2) | Per-record measurements for Task 2 (streamlined size share; CEQA filed ratio if the records allow) |
| `e2e/sim.spec.ts` | Timeline e2e and axe |
| `docs/dev/sim-timers.md` (new), `docs/dev/sim-page.md`, `docs/dev/sim-levers.md`, `docs/dev/map-interfaces.md`, `CLAUDE.md` | Docs |

---

### Task 0: Timeline layout mockups (controller, with the partner)

The spec asks for layouts to go to the partner before building ("Left to the builder"), as plan 3's Task 0 did. The user has a standing opt-in for the visual companion: launch it directly, without asking.

**Proposed layout** (the plan is executable under it):

- **Section.** "Permitting timelines" is the fourth disclosure in `PolicyPanel`, after "Protections", and starts collapsed. Its header button shows one line under the title: the set's label ("SF as observed", or "Custom (from SB 423 approval clock)").
- **Top row.** A "Preset" `<select>`, then Save and Revert (Revert's name says where it goes: "Revert to saved" or "Revert to SB 423 approval clock"; disabled when there is nothing to revert).
- **Routes.** Three blocks, in pathway order: "Discretionary", "Streamlined", "Permit only". Each has:
  - a header line with the route name and its share, as a number input ("70 %");
  - a full-width stacked bar. A segment's width is proportional to its typical months, with a 24 px minimum. Between segments is a thin line with the chance of advancing ("92 %") under it. Locked segments are hatched and carry a lock icon (`aria-label` "locked"). Clamped segments get a "min" or "max" badge;
  - details under the bar when a segment is opened (one open at a time per route): the stage name, the typical months input with − and +, "≈ N days", the minimum and its source, the chance of advancing with an exit breakdown, who it applies to (reach), and the preset's source and tier.
- **Footer.** The Local Program line (Call 11) and "Sources and tiers" as a link to the stage details.
- **Phone.** The same section inside the sheet, full width (bars about 343 px). There is no drag below md on a coarse pointer: handles render only for `(pointer: fine)`.

- [ ] **Step 1:** Build static mockups in the visual companion (`.superpowers/brainstorm/`): md+ docked panel with the section open and one details row open; the 375 px sheet; a clamped segment; and a custom label with Revert.
- [ ] **Step 2:** Show the partner. Record the approved layout, with any changes, as "Layout (approved <date>)" in this task. Tasks 4 and 5 build that version. If the partner has not answered when Task 4 starts, build the proposal above and flag it in the task's report.

### Task 1: Re-measure the disapproved share (gates Task 3)

**Files:**
- Read: `scripts/disapproval-share.ts`, `src/lib/sim/levers/timers.ts:179-205`
- Modify: `docs/dev/sim-levers.md` ("Disapproval exception": re-measured date)

**Interfaces:**
- Consumes: `disapprovedShare(cal)`, `DISAPPROVAL_NEGLIGIBLE`.
- Produces: the gate result **G1** ∈ {`negligible`, `not-negligible`}, which Task 3 reads.

- [ ] **Step 1:** Fetch the dataset production and staging name in `wrangler.jsonc` into local R2 (`npm run data:local -- <version>`), or reuse a local copy, then run `npx tsx scripts/disapproval-share.ts <calibration.json>`. Also run it on `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json`.
- [ ] **Step 2:** Expected for `2026-10-29-0fd62c4d`: 0.0082 / 0.0034 / 0.0012, all `negligible`. **G1 = negligible** unless a pathway is at or above 0.01 on the dataset production names.
- [ ] **Step 3:** Add one line under "Disapproval exception" in `sim-levers.md`: the dataset, the date and "re-measured for plan 4: still negligible; no exception". Commit: `docs(sim-levers): re-measure the disapproved share for plan 4`.

If **G1 = not-negligible**, stop and report to the controller before Task 3. The exception then needs the engine op that the Task 3 conditional step describes.

### Task 2: Research and the sourced constants file

The output of this task is `src/lib/sim-page/timing-sources.ts`. Every exported value carries a `Provenance` with a URL and an access date in `method` or `label`. No number may be entered without a source. A value that cannot be sourced is exported as `null` with its reason, and the preset or floor that needs it is unavailable (Calls 7 and 8).

**Files:**
- Create: `src/lib/sim-page/timing-sources.ts`, `src/lib/sim-page/timing-sources.spec.ts`, `scripts/timing-evidence.ts`, `docs/dev/sim-timers.md` (the evidence table; linked from `CLAUDE.md` in Task 7)

**Interfaces:**
- Produces:

```ts
import type { Pathway, Provenance } from '$lib/timelapse/types';
import type { TimedStage } from '$lib/sim/levers/types';
export interface Sourced<T> { value: T; provenance: Provenance }
export interface Unsourced { value: null; reason: string }
export type Evidence<T> = Sourced<T> | Unsourced;

export const BENCHMARK_PERMIT_DAYS: { sf: Sourced<number>; sanDiego: Sourced<number> };
export const SB423_DEADLINE_DAYS: Sourced<{ small: number; large: number; unitsCutoff: number }>;
export const SB423_SMALL_SHARE: Evidence<number>;       // share of streamlined projects <= 150 units
export const SB423_ROUTE_SHIFT: Evidence<number>;        // share of discretionary moving to streamlined
export const SB423_DEADLINE_QUANTILE: Sourced<number>;   // 0.9, tier 4 (Open question 2)
export const CEQA_FILED_RATIO: Evidence<number>;         // discretionary filed, exempt vs all
export const NO_DISCRETIONARY_BASIS: Sourced<null>;      // the citation for the definitional preset
export const STAGE_FLOORS: Record<Pathway, Partial<Record<TimedStage, Evidence<number>>>>; // months
```

**Sources already found** (accessed 2026-10-30; Step 1 confirms each one against the primary text):

| Value | Starting value | Source | Tier |
| --- | --- | --- | --- |
| SF median days from permit filing to issuance | 280 (housing, in-house review, issued 2024-01-01 to 2025-08-12) | BLA, "Post-Entitlement Permitting", report to Supervisor Mahmood, 2026-03-05, Exhibit 1, p. 9: https://sfbos.org/sites/default/files/BLA_Post_Entitlement_Permitting_030526.pdf (now redirects to https://sfbos.archive.sf.gov/sites/default/files/BLA_Post_Entitlement_Permitting_030526.pdf) | 1 |
| San Diego median days to permit issuance | 134 (housing, issued Jan to mid-Dec 2025) | Same, Exhibit 1 and note 2 | 1 |
| SF permit floor inputs | completeness check median 13 calendar days; first plan review median 14 to 15 calendar days; state limit 15 business days for completeness (AB 2234) | Same, pp. 8 and 11 to 12 | 1 |
| SB 423 approval deadline | 90 days at 150 units or fewer, 180 days above, from submittal | Gov. Code § 65913.4 as amended by SB 423 (2023): https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65913.4 (returned 403 to an automated fetch; verify by hand); SF Planning SB 423 application form: https://sfplanning.org/sites/default/files/forms/SB423_MinisterialApplication.pdf | 1 |
| CEQA infill exemption | statutory exemption, Pub. Resources Code § 21080.66, added by AB 130 (2025), signed 2025-06-30 | https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB130 ; secondary summary: https://www.coxcastle.com/publication-governor-signs-bill-enacting-an-important-new-ceqa-exemption-for-infill-residential-and-mixed-use-projects | 1 (law); the time effect needs Step 3 |
| "Eliminate discretion" | HCD required action for SF | HCD, San Francisco Housing Policy and Practice Review (2023-10-25): https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/sf-housing-policy-and-practice-review.pdf | 1 |

- [ ] **Step 1: Confirm the statute and report values.** Read the primary texts in the table above. Record the exact subdivision of § 65913.4 that holds the 90/180-day clock, and whether it runs from submittal. Record § 21080.66's eligibility conditions in one sentence. If any value differs from the table, use the primary text and note the change in `sim-timers.md`.
- [ ] **Step 2: `SB423_SMALL_SHARE` (tier 0).** Write `scripts/timing-evidence.ts`. It reads a dataset's `projects.json` with the existing validator and prints the share of streamlined-pathway projects with `units <= 150`, with n. Record the value, n and the dataset in `method`.
- [ ] **Step 3: `CEQA_FILED_RATIO`.** Try, in order, and stop at the first that gives a sourced number:
  1. Per-record (tier 0 or 3): if the locked SF Planning records (`qvu5-m3a2`, `y673-d69b`) carry the environmental review type, measure the median filed-to-entitled months of discretionary projects with an exemption (categorical, community plan, statutory), over all discretionary projects. Add the measurement to `timing-evidence.ts`.
  2. Official or literature (tier 1 to 3): the UC Berkeley CALES report for HCD, https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/ucb-examining-local-law-policy-planning-practice-on-development-in-sf-using-cales.pdf, for entitlement time by CEQA document type.
  3. Otherwise `{ value: null, reason }`, so `ceqaInfill` is unavailable (Call 8).
- [ ] **Step 4: `SB423_ROUTE_SHIFT`.** Look for an official or per-record estimate of the share of discretionary projects that would qualify for SB 423 (SF Planning SB 423 page, the HCD review, Housing Element annual progress reports). If none is found, use `{ value: null, reason }`: the SB 423 preset then keeps observed shares and says so. It does not become unavailable, because the clock alone is sourced.
- [ ] **Step 5: `STAGE_FLOORS`.** One entry per editable stage and pathway, in months. Starting candidates:
  - `permitFiled`, all pathways: one completeness check plus one first review at SF's current median pace, (13 + 15) / 30.4375 ≈ 0.9 month (BLA, tier 1).
  - `filed`, discretionary: the Planning Code's minimum hearing-notice period, if a hearing is required (Planning Code §§ 311 and 333; cite the section and its days).
  - `filed`, streamlined: a statutory minimum for ministerial review, if any exists; otherwise unsourced.
  - `preApplication`: SF Planning's PPA letter service time, if published; otherwise unsourced.
  - `permitIssued`: unsourced unless a source for a minimum time from issuance to construction start exists.

  Unsourced floors are `{ value: null, reason }`. Never fill them with a guess.
- [ ] **Step 6: Write the file and its test.** `timing-sources.spec.ts`:
  - every `Sourced` has `provenance.sources.length >= 1` with an `https` URL, and a tier in 0 to 4;
  - `SB423_DEADLINE_QUANTILE.provenance.tier === 4`;
  - every floor value is positive and finite;
  - `BENCHMARK_PERMIT_DAYS.sanDiego.value / BENCHMARK_PERMIT_DAYS.sf.value` is between 0 and 1.
- [ ] **Step 7:** Write `docs/dev/sim-timers.md` "Evidence": one row per value, with value, tier, source, access date and status (sourced, or unsourced with its reason). Run `npx vitest --run --project server src/lib/sim-page/timing-sources.spec.ts` (PASS). Commit: `feat(sim-page): sourced constants for permitting presets and stage floors`.

### Task 3: The timing model, the policy shape and compiling

**Files:**
- Create: `src/lib/sim-page/timing.ts`, `src/lib/sim-page/timing.spec.ts`
- Modify: `src/lib/sim-page/policy.ts:76-77` (the type), `:107-128` (`policyFromLevers`), `:276-294` (`parseTiming`), `:296-342` (`parseSimPolicy`), `:467-487` (`compileLevers`); `src/lib/sim-page/policy.spec.ts`

**Interfaces:**
- Consumes: Task 2's exports; `rescaleTransition`, `scaleTable`, `timersOp` (`timers.ts:37`, `:73`, `:151`); `typicalMonths`, `eventualProbabilities`, `cumulativeTotal` (`model.ts:448`, `:218`, `:177`); `MIN_SCALE`, `MAX_SCALE`, `TimerEdit`, `TimedStage`.
- Produces:

```ts
export type PresetId = 'observed' | 'sb423Clock' | 'noDiscretionary' | 'ceqaInfill' | 'benchmarkPermits';
export interface Preset { id: PresetId; name: string; summary: string; reach: 'new' | 'all' | null;
  available: boolean; unavailableReason: string | null; provenance: Provenance[] }
export const PRESETS: readonly Preset[];                    // in the order above; Call 9 names
export const EDITABLE_STAGES: readonly TimedStage[];        // preApplication, filed, permitFiled, permitIssued
export interface TimingSet {
  preset: PresetId;
  presetTimers: TimerEdit[];
  presetRouteShares: Record<Pathway, number> | null;        // whole percents summing to 100, or null = observed
  edits: TimerEdit[];                                       // reach 'all', at most one per (pathway, stage)
  routeShares: Record<Pathway, number> | null;              // custom whole percents, or null = the preset's
  localProgramStreamlined: boolean;
}
export interface SimTiming { current: TimingSet; saved: { label: string; set: TimingSet } | null }
export const OBSERVED_TIMING: SimTiming;
export function resolvePreset(id: PresetId, cal: Calibration): TimingSet;
export function isCustom(s: TimingSet): boolean;           // edits non-empty or routeShares non-null
export function timingLabel(s: TimingSet): string;         // 'SF as observed' | 'Custom (from SF as observed)'
export function revertTarget(t: SimTiming, cal: Calibration): { label: string; set: TimingSet } | null; // null: nothing to revert
export function compileTiming(s: TimingSet): Pick<SimLevers, 'timers' | 'routeShares' | 'localProgramStreamlined'>;
export function shownRouteShares(s: TimingSet, cal: Calibration): Record<Pathway, number>; // whole percents
export function setRouteShare(s: TimingSet, cal: Calibration, p: Pathway, pct: number): TimingSet;

export interface StageBounds { min: number; max: number; minBy: 'floor' | 'scale'; maxBy: 'scale' }
export interface StageView {
  stage: Exclude<Stage, 'complete'>; label: string; months: number; observedMonths: number;
  editable: boolean; lockReason: string | null;
  advance: number; exits: Partial<Record<ExitReason, number>>;
  floor: Evidence<number> | null; bounds: StageBounds | null;   // null when locked
  atBound: 'min' | 'max' | null;
  fresh: number; inFlight: number; inFlightClamped: boolean;    // effective scales (scaleTable)
  reach: 'new' | 'all' | 'mixed' | null;                        // who the non-identity scales reach
  presetLimitedByFloor: boolean;
}
export function routeView(cal: Calibration, s: TimingSet, p: Pathway): StageView[]; // stages with a table, pathway order
export function stageBounds(cal: Calibration, s: TimingSet, p: Pathway, st: TimedStage): StageBounds;
export function setStageMonths(cal: Calibration, s: TimingSet, p: Pathway, st: TimedStage, months: number):
  { set: TimingSet; clamped: 'min' | 'max' | null };
export function exitMonth(t: Transition, q: number): number; // least k with cumulativeTotal(t, k) >= q
```

Stage labels: `preApplication` "Pre-application"; `filed` "Filed to entitled"; `entitled` "Entitled to permit filed" (locked: "Set by the applicant's timing, not by the city"); `permitFiled` "Permit review"; `permitIssued` "Permit issued to construction start"; `construction` "Construction" (locked: "Set mostly by the builder, financing and technology").

`stageBounds`: `min = max(floor ?? 0, MIN_SCALE × typical0, typical0 × presetFresh × MIN_SCALE)`, and `max = min(MAX_SCALE × typical0, typical0 × presetFresh × MAX_SCALE)`, each rounded inward to 0.5 month. `minBy` says which term won. With these bounds, the custom scale and the fresh product both stay inside `[MIN_SCALE, MAX_SCALE]`.

- [ ] **Step 1: Failing tests** (`timing.spec.ts`, on `src/lib/sim/levers/fixtures` or the fixture-0 calibration, plus a hand-made calibration where noted):
  - `observed compiles to no timers`: `compileTiming(OBSERVED_TIMING.current)` equals `{ timers: [], routeShares: null, localProgramStreamlined: true }`.
  - `benchmark permits scale permitFiled on every pathway by 134/280 for everyone`: three timers, `scale` ≈ 0.4786 (to 4 places), `reach: 'all'`.
  - `the SB 423 clock puts streamlined filed's 90th percentile at the deadline`: for the resolved scale `s`, `exitMonth(rescaleTransition(t, s), 0.9)` is within 1 month of `D`, and `s <= 1`; `reach: 'new'`.
  - `no discretionary review moves the discretionary share to streamlined`: `presetRouteShares.discretionary === 0` and the streamlined share is the old discretionary share plus the old streamlined share, in whole percents summing to 100.
  - `an unavailable preset cannot be resolved`: `resolvePreset` throws for a preset with `available: false` (use a test double for `PRESETS`, or assert on the real one if Task 2 left any unavailable).
  - `a preset never goes below a floor`: for every available preset, every scaled stage's months are at least its floor, and `presetLimitedByFloor` is true where the floor won.
  - `setStageMonths clamps to the floor and says which bound`: below `min` gives `months === min` and `clamped: 'min'`; above `max` gives `'max'`; a value inside gives `null`.
  - `editing back to the preset value removes the edit`, so `isCustom` is false again.
  - `shown months track the engine`: for every stage with a table and scales {0.3, 0.5, 2}, `|typicalMonths(timersOp(scale)(cal).cal)[p][st] − routeView(...).months| <= 1`.
  - `an in-flight clamp is reported`: a set whose `presetTimers` has scale 0.2 with `reach: 'all'`, plus an edit with scale 0.2, gives `inFlightClamped: true` and `inFlight === MIN_SCALE`.
  - `permitOnly has no filed or entitled stage`: `routeView(cal, s, 'permitOnly').map(v => v.stage)` is `['preApplication', 'permitFiled', 'permitIssued', 'construction']`.
  - `a huge typical month gives a finite, capped width`: a hand-made calibration whose tail never reaches 0.5 gives finite `months`.
  - `shares always sum to 100`: `setRouteShare(…, 'permitOnly', 100)` gives `{0, 0, 100}`; then `setRouteShare(…, 'discretionary', 40)` splits 60 evenly (30, 30); `setRouteShare(…, 'streamlined', 33)` from `{70, 9, 21}` keeps 100 with the largest remainder.
  - `revert goes to the save, else the preset`; `choosing a preset keeps the save` (`resolvePreset` replaces `current` only); `the label follows the set`.
  - `policy.spec.ts`: `parseSimPolicy` round-trips a policy with a custom timing set and a save; it rejects `timing.current.edits[0].reach: 'new'` (custom edits are `'all'`), an unknown preset id, and route shares that do not sum to 100; `compileLevers` puts `presetTimers` then `edits` into `timers`, and `routeShares` is `current.routeShares ?? presetRouteShares`.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim-page/timing.spec.ts src/lib/sim-page/policy.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `timing.ts`, `typical0` is `typicalMonths(cal)`, memoised per calibration object (a `WeakMap`, as `FzpMode.svelte:31-39`). Effective scales come from `scaleTable(compileTiming(s).timers, 'new' | 'inFlight')`. `inFlightClamped` compares that against the unclamped product. `reach` is derived from which timers touch the stage. In `policy.ts`, `SimPolicy.timing` becomes `SimTiming`. `policyFromLevers` maps any `SimLevers` with no timers and null route shares to `OBSERVED_TIMING` (with the given `localProgramStreamlined`), and throws `PolicyFormatError('timers', …)` otherwise. `parseTiming` validates every `TimerEdit` through `parseSimLevers` as it does now (`policy.ts:277-294`), plus the rules in the tests.
  - **Only if Task 1's G1 = not-negligible:** add `zeroDisapproved: Pathway[]` to `TimingSet` and a worker-safe `disapprovalZeroOp(pathways, reach)` in `src/lib/sim/levers/timers.ts`. It sets the `disapproved` column and tail to 0 and moves that mass to `advance`, on the covered pathways. Wire it through `SimLevers` (a new optional field, `parseSimLevers` and `applyLevers`) with the preset's reach. Its tests: `disapproval-zero keeps C(K) within parseCalibration limits` and `eventual advance gains exactly the disapproved share`. Otherwise skip this step.
- [ ] **Step 4:** Rerun (PASS), then `npx vitest --run --project server src/lib/sim-page src/lib/sim/levers` (PASS). Commit: `feat(sim-page): timing model, presets, floors and route shares in the policy`.

### Task 4: The "Permitting timelines" section: presets, Save, Revert and route shares

**Files:**
- Create: `src/lib/sim-page/PermittingSection.svelte`, `src/lib/sim-page/PermittingSection.svelte.spec.ts`
- Modify: `src/lib/sim-page/policy-store.svelte.ts:51-57` (`apply`), `policy-store.svelte.spec.ts`; `src/lib/sim-page/PolicyPanel.svelte:29-31`, `:52-62`, `:138-147` (fourth section and its snippet prop); `src/lib/sim-page/SimPage.svelte:335-381` (the snippet, passing `calibration` and `announce`)

**Interfaces:**
- Consumes: Task 3's `timing.ts`; `PolicyStore`; `brush.announce` (SimPage's existing polite region, `SimPage.svelte:385`).
- Produces:

```ts
// policy-store.svelte.ts
apply(change: (p: SimPolicy) => SimPolicy, label: string, coalesce?: string): void;
// PolicyPanel: new snippet prop `timing?: Snippet`; SectionId gains 'timing' titled 'Permitting timelines',
// collapsed by default; its header button shows `summary` (a second line) when given: prop `timingSummary?: string`.
// PermittingSection.svelte props:
{ store: PolicyStore; calibration: Calibration; announce(msg: string): void }
```

  - **Preset `<select>`**, labelled "Preset", listing the available presets by name. Each option's description (`aria-describedby`) is the preset's summary and tier. Choosing one is `store.apply(p => ({ …p, timing: { …p.timing, current: resolvePreset(id, cal) } }), 'Timelines: <name>')`.
  - **The label** (`timingLabel`) and buttons **Save** ("Save timelines"; label "Saved timelines") and **Revert** (`revertTarget` gives the name "Revert to <label>"; disabled when null).
  - **Route share inputs** (`type="number"`, min 0, max 100, step 1, visible label "<Route> share, %"). They commit on `change` through `setRouteShare` with coalesce key `share:<pathway>`, and announce "Shares now: discretionary 40 %, streamlined 30 %, permit only 30 %".
  - **The Local Program line** (Call 11), read-only.
  - One `RouteTimeline` per pathway (Task 5). Until Task 5 lands, render a placeholder list of `routeView` rows (stage label and months), which Task 5 replaces.
- [ ] **Step 1: Failing tests.**
  - `policy-store`: two `apply` calls with one coalesce key and nothing between give one undo entry with the second label; an undo between them gives two entries; a different key gives two.
  - `PermittingSection`: choosing "Permits at San Diego's pace" sets `store.policy.timing.current.preset` and the label; with a custom edit present, choosing a preset then `store.undo()` restores the edit (`Undo restores edits a preset replaced`).
  - Save, then a preset change, then Revert gives back the saved set; with no save, Revert after an edit gives the preset's set; Revert is disabled on an unedited preset with no save.
  - `shares always sum to 100` (component): typing 100 in "Permit only share, %" shows 0 and 0 in the other two inputs.
  - `a zero-share route keeps its timeline`: with discretionary at 0 %, the Discretionary block still renders its stages.
  - `PolicyPanel`: "Permitting timelines" exists, is `aria-expanded="false"` on open, and its button text includes the summary.
- [ ] **Step 2:** Run `npx vitest --run --project client src/lib/sim-page/PermittingSection.svelte.spec.ts src/lib/sim-page/PolicyPanel.svelte.spec.ts src/lib/sim-page/policy-store.svelte.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with the Task 0 layout. SimPage passes `calibration` (its prop, `SimPage.svelte:46`). The section renders only when it is non-null.
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim-page): permitting timelines section with presets, save, revert and route shares`.

### Task 5: `RouteTimeline`: segments, chances, drag, keyboard and details

**Files:**
- Create: `src/lib/sim-page/RouteTimeline.svelte`, `src/lib/sim-page/RouteTimeline.svelte.spec.ts`
- Modify: `src/lib/sim-page/PermittingSection.svelte` (replace the placeholder)

**Interfaces:**
- Consumes: `routeView`, `stageBounds`, `setStageMonths` (Task 3); `store.apply(…, coalesce)` (Task 4).
- Produces: props `{ store: PolicyStore; calibration: Calibration; pathway: Pathway; announce(msg: string): void }`.
  - **Bar.** A `role="group"` labelled "<Route> timeline". Segments are buttons with roving `tabindex`: Left and Right move, Home and End jump, and Enter, Space or a click toggles the details. A segment's accessible name is "<Stage>, <months> months, <advance>% move on[, locked][, at the minimum]". The width is `max(24px, share of the route's total months)`.
  - **Chance line.** The percentage below each boundary is `aria-hidden`, because it is already in the segment's name.
  - **Drag handles** (fine pointer only, `aria-hidden`, 24 × 24 px hit area, on the right edge of each editable segment). Pointer capture; the preview width follows the pointer in months (the route's px-per-month), clamped to `stageBounds`; one `store.apply` on pointer-up with label "<Stage>, <route> to <months> months". A bound reached during the drag shows the badge immediately.
  - **Details** (`id`-linked from the segment by `aria-controls` and `aria-expanded`):
    - a "Typical months" number input (step 0.5, `min` and `max` from the bounds, commit on `change`, coalesce key `stage:<pathway>:<stage>`);
    - − and + buttons (0.5 month each, same coalesce key, disabled at the bound);
    - "≈ N days";
    - "Minimum: N months (<source label>, tier T)", or "No sourced minimum; numerical limit ×0.05";
    - "Of projects in this stage, A% move on; W% withdrawn, C% cancelled, X% expired, D% disapproved" (only reasons present);
    - "Applies to projects filing after the policy starts" / "Applies to every project, including those already in this stage";
    - when `inFlightClamped`: "Limited to ×0.05 (or ×10) for projects already in the pipeline";
    - when `presetLimitedByFloor`: "The preset's value is below the minimum; the minimum is used";
    - the preset's sources;
    - locked stages show their `lockReason` and no editor.
  - **Announcements** go through `announce`: the committed value, and "Reached the minimum for <Stage>: N months" or the maximum likewise.
- [ ] **Step 1: Failing tests** (client project, at 768 px and 375 px):
  - Discretionary renders segments in pathway order, construction and "Entitled to permit filed" named "…, locked"; permit only has four segments.
  - Keyboard: focus the first segment, ArrowRight moves focus to the next, Enter opens details (`aria-expanded="true"`), "+" raises the shown months by 0.5 and creates one edit; pressing "+" ten times leaves `store.undoLabel` naming one change (coalesced).
  - `a drag past the minimum stops and says so`: pointer-down on the permit review handle, move far left, pointer-up: the edit's months equal `bounds.min`, the segment's name ends "at the minimum", and `announce` received "Reached the minimum for Permit review: …".
  - Typing a value above `max` in the input commits `max` and announces the maximum.
  - With `(pointer: coarse)` (emulated), no handle is in the DOM, and the details editor still edits (2.5.7).
  - Every handle and segment box is at least 24 × 24 px (2.5.8; read with `getBoundingClientRect`).
  - At 375 px, the section has no horizontal overflow (`scrollWidth <= clientWidth`).
- [ ] **Step 2:** Run `npx vitest --run --project client src/lib/sim-page/RouteTimeline.svelte.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Months to px: `trackPx / Σ months` over the route's segments, recomputed with a `ResizeObserver` on the bar. Locked and clamped states each have a text badge, so colour is never the only signal.
- [ ] **Step 4:** Rerun (PASS) and `npx vitest --run --project client src/lib/sim-page` (PASS). Commit: `feat(sim-page): editable route timelines with drag, keyboard and stage details`.

### Task 6: Cohort-aware map bars (fixes the in-flight gap, Call 15)

**Files:**
- Modify: `src/lib/sim/scenario/types.ts:21-48` (`Schedule.inFlight?`); `src/lib/sim/scenario/engine.ts:581-583` and wherever a master or phase job takes `run.cal` (set the flag); `src/lib/map/types.ts:49-55` (`slotCohort`), `:95-98` (`setTimelineLookups` takes optional `inFlight`); `src/lib/map/pack-timed.ts:63`, `:129`, `:165-177` (write and transfer `slotCohort`); `src/lib/map/timelapse/lookups.ts:6-15`, `:28` (`CHANCE_ROWS = 36`, `chanceRow(pathwayIndex, stage, cohort)`); `src/lib/map/timelapse/bars.ts:43-83` (`segRow` by cohort); `src/lib/map/timelapse/encode.ts:37-48` (validate `slotCohort`), `:55-63` (`typicalDays(l, pathway, stage, cohort)`), `:94-97`; `src/lib/map/timeline-controller.ts:205-226`; `src/lib/fzp/FzpMode.svelte:319-329` (`pushLookups`); test fixtures that build `TimedPackedCell` (`src/lib/map/test/synthetic-timeline.ts`, `src/lib/map/fixtures/timeline-small.ts`)
- Test: `src/lib/sim/scenario/simulate.spec.ts`, `src/lib/map/pack-timed.spec.ts`, `src/lib/map/timelapse/lookups.spec.ts`, `bars.spec.ts`, `encode.spec.ts`

**Interfaces:**
- Produces:

```ts
// Schedule: true on a schedule whose job ran on `calibration` (not `newProjects`) on a run whose
// input has `newProjects`. Absent on every other Schedule, so runs without lever timers are unchanged.
inFlight?: true;
// TimedPackedCell
slotCohort: Uint8Array; // per slot: 0 = fresh (new projects' lookups), 1 = in flight
// SimMapHandle
setTimelineLookups(l: TimelineLookupSet & { inFlight?: TimelineLookupSet }): void; // absent: in flight reads fresh
// lookups.ts
export const CHANCE_ROWS = 36; // 2 cohorts × 3 pathways × 6 stages
export function chanceRow(pathwayIndex: number, stage: Exclude<Stage, 'complete'>, cohort: 0 | 1): number;
// = cohort * 18 + pathwayIndex * 6 + STAGE_ORDER.indexOf(stage)
```

  `TimelineLookupSet` is the existing `{ chance, typicalMonths }`. `FzpMode.pushLookups` sends `{ ...leverLookups.fresh, inFlight: leverLookups.inFlight }`, cached per `leverLookups` object, because SimMap compares lookups by identity (`FzpMode.svelte:27-39`). On `/fzp` and before the first `current`, it sends the base set with no `inFlight`.
- [ ] **Step 1: Failing tests.**
  - `simulate.spec`: `no newProjects, no inFlight flag` (a run without `newProjects` has no `inFlight` key on any schedule); with `newProjects`, a pipeline row past pre-application has `inFlight: true`, while a pre-application row and a simulated project have none.
  - `pack-timed.spec`: `slotCohort` is 1 exactly for flagged schedules and is in the transferables.
  - `lookups.spec`: the texture height is 36; without `inFlight`, rows 18 to 35 equal rows 0 to 17; with it, they hold the in-flight values.
  - `bars.spec`, `cohort rows follow slotCohort`: an in-flight slot's `segRow` values are 18 or more and a fresh slot's are below 18; its fill reads `typicalDays` of the in-flight set.
  - `encode.spec`: `slotCohort` of the wrong length, or a value above 1, fails validation; the construction typical days follow the cohort.
  - The existing map and timelapse goldens pass unchanged (they never set `inFlight`).
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/scenario src/lib/map` and `npx vitest --run --project client src/lib/map`. Expected: FAIL.
- [ ] **Step 3:** Implement. The shader needs no change: `segRow` is per-instance data (`stage-bar-layer.ts:436-437`), and the texture's height is not read in GLSL (`stage-bar-layer.ts:173-176`). Run the GPU spec `src/lib/map/timelapse/timelapse-extension.gpu.svelte.spec.ts` to confirm.
- [ ] **Step 4:** Rerun both commands (PASS) and `npm run bench:map` once if a GPU is available (no regression beyond noise; note the result in the commit body). Commit: `feat(map): in-flight bars read the in-flight lookups`.

### Task 7: End-to-end, accessibility, docs and signoff

**Files:**
- Modify: `e2e/sim.spec.ts`; `docs/dev/sim-timers.md` (complete), `docs/dev/sim-page.md` (layout, recipe table `timing` row, known gaps), `docs/dev/sim-levers.md` ("Notes for plans 3 and 4": plan 4 done), `docs/dev/map-interfaces.md` (`setTimelineLookups` and `slotCohort`), `docs/dev/fzp-mode.md` (lookups seam: both cohorts), `CLAUDE.md` (link `sim-timers.md` in "Scoped reference docs"; `scripts/docs-index.spec.ts` requires it)

**Interfaces:**
- Consumes: `window.__sfhFzp.levers` (`status`, `sentRev`) to wait for a lever revision (sim-page.md, "The debug hook").

- [ ] **Step 1: Failing e2e** (`e2e/sim.spec.ts`, against fixture-0):
  - `choosing a preset sends timers and the label changes`: open Policy, expand "Permitting timelines", choose "Permits at San Diego's pace". `levers.sentRev` rises and `status` reaches `current`, and the section header reads that name.
  - `a keyboard edit makes the set custom and Revert undoes it`: Tab to the Discretionary bar, ArrowRight to "Permit review", press Enter, then "−" three times. The header reads "Custom (from SF as observed)". Revert gives back "SF as observed", and a new revision is current.
  - `the minimum is visible`: type 0 in "Typical months". The input shows the minimum and the segment's name contains "at the minimum".
  - `route shares sum to 100`: set "Permit only share, %" to 100; the others read 0.
  - `axe: the timelines section open, details open` with `expectNoA11yViolations` at 1280 px and at 375 px (the sheet).
  - `at 375 px with the timelines open: no horizontal scroll`.
- [ ] **Step 2:** Run `npx playwright test e2e/sim.spec.ts` (FAIL), implement any fixes, rerun (PASS).
- [ ] **Step 3: Docs.**
  - `sim-timers.md`: the timing model (Calls 1 to 4), presets and their rules, floors, the evidence table (Task 2), Save and Revert, reach, and the open questions as asked.
  - `sim-page.md`: the approved layout from Task 0; the recipe row `timing` becomes "`current` (preset, preset timers and shares, custom edits and shares, Local Program) and `saved`"; remove the "In-flight map bars" known gap and add the remaining `chanceShift` approximation (Call 15).
  - `sim-levers.md`: the plan-4 note marked done, pointing at `sim-timers.md`.
  - `map-interfaces.md`, `fzp-mode.md`: the second lookups set and `slotCohort`.
  - `CLAUDE.md`: a line "**Permitting timers on `/sim` (presets, floors, evidence, timeline UI)** — [docs/dev/sim-timers.md](docs/dev/sim-timers.md)".
- [ ] **Step 4:** Run `npm run lint`, `npm run check` and `npm run test:unit` (all PASS). Commit: `test(sim): permitting timelines end to end and a11y; docs for /sim timers`.
- [ ] **Step 5: Signoff (when the controller asks).** Run `npm run signoff -- --dry-run`, then `npm run signoff`. Expected: every planned step passes, and the `chreode/signoff` status is posted.

---

## Open questions (partner)

The plan runs under each recommendation.

1. **Is `entitled` (entitled to permit filed) editable?** The spec's list omits it, but the engine's `TimedStage` includes it (`types.ts:21-28`). **Recommendation:** locked, because it is the applicant's wait to file (Call 5).
2. **What "meets the SB 423 clock" means.** The tables never reach 100% (the tail is geometric). **Recommendation:** 90% of the stage's outcomes by the deadline (`SB423_DEADLINE_QUANTILE`, tier 4, labelled). The alternative, "median at the deadline", is far weaker.
3. **Presets Task 2 cannot source.** **Recommendation:** leave them out of the picker and list them as "needs a source" in `sim-timers.md`. The alternative is to show them disabled with the reason. A tier-4 preset is not offered.
4. **Pre-application has a 0% share of new projects since July 2023.** **Recommendation:** show it, editable, with that note (Call 6). It still moves pipeline rows at pre-application.
5. **The benchmark city.** **Recommendation:** San Diego only, per the spec. Austin (91 days) and Washington (92.6, an average) are in the same BLA table but less comparable, and BLA notes that SF's own permits filed since 2024 took a median of 114 days.
6. **Where discretionary projects go under "No discretionary review".** **Recommendation:** all of them to streamlined (ministerial approval of the same projects); permit-only is unchanged.
7. **Floor rule.** **Recommendation:** sourced floors only, with unsourced stages bounded by the numerical limit and saying so (Call 7). The alternative, SF's own fastest tenth per stage (tier 0), would block legal deadlines faster than SF's history, such as SB 423's 90 days against an observed streamlined p10 of 3 months.

## Spec gaps and contradictions found

- **"Width is its average duration"** against the median used everywhere in the code (Call 1).
- **The editable stage list omits `entitled`**, which plan 2's engine treats as timed (Open question 1).
- **The disapproval measurement is already done.** Plan 2 measured it and dropped the exception (`sim-levers.md:108-133`). Task 1 re-confirms it and does not redo the work.
- **Pre-application is editable, but `ppaShare` is 0** on every pathway in the live calibration, so the edit reaches only pipeline rows (Call 6).
- **SB 423 already applies in SF**, yet the observed streamlined filed-to-entitled median is 7 months against a 90-day clock. Either the record's filed date comes before the statutory start, or the clock is missed. The preset models "the clock met" and says so in its summary. Task 2 Step 1 records which explanation the sources support.
- **Save placement.** The spec puts timeline Save "inside the current policy" alongside publishing; the dispatch puts persistence in plan 5. They are consistent: the snapshot lives in `SimPolicy.timing.saved` in memory, and plan 5 persists it.

## Self-review

- **Spec coverage (Goal 3):**
  - one timeline per route, with segments, chance lines and the current set: Tasks 3 and 5;
  - route shares shown and editable, Local Program forcing: Tasks 3 and 4, Call 11;
  - presets with sources: Tasks 2 and 3, Call 9;
  - editing turns the set into "Custom (from …)", with Save and Revert: Tasks 3 and 4;
  - editable stages and the construction lock: Call 5, Task 5;
  - stage floors: Task 2 and Call 7;
  - chances shown, not edited: Task 5;
  - the disapproval exception: Task 1, gating Task 3;
  - the rescale: plan 2's, reused.
- **Partner reach ruling:** Call 9 (per preset) and Call 2 (custom edits `'all'`).
- **Plan 2 notes:** clamped stacks shown (Task 3 `inFlightClamped`, Task 5); in-flight bars (Task 6).
- **Requirement 8:** e2e, a11y, docs and signoff in Task 7.
- **Types.** `TimingSet` and `SimTiming` (Task 3) are used in Tasks 4 and 5. `Evidence` (Task 2) is used by `StageView.floor` (Task 3). `chanceRow(…, cohort)` (Task 6) matches its callers in `bars.ts`.
- **Review Focus tests:** 1 in Tasks 3 and 5; 2 in Tasks 3 and 4; 3 in Tasks 3 and 4; 4 in Task 3; 5 in Task 6.
- **Proportion:** the code blocks are signatures only. Bodies are left to the implementer, except the bounds and preset formulas, which tests alone do not determine.
