# Permitting timers on /sim

Plan: `docs/superpowers/plans/` (plan 4 of 5, permitting timers). The sourced constants live in
`src/lib/sim-page/timing-sources.ts`; each carries a `Provenance` (tier, label, sources, method)
that the stage details show. A value that could not be sourced is `{ value: null, reason }`, and
the preset or floor that needs it is unavailable (plan Calls 7 and 8). The UI is
`PermittingSection.svelte` and `RouteTimeline.svelte` in `src/lib/sim-page/`; the rules are in
`timing.ts`. See also [sim-page.md](sim-page.md) and [sim-levers.md](sim-levers.md).

## The timing model

- **Width is the typical (median) duration** of leaving the stage by any outcome (`typicalMonths`),
  not the mean the spec's wording suggests (Call 1). The UI says "typical".
- **A duration edit is stored as a scale** (`TimerEdit`, Call 2, as ruled): custom months `m` on a
  stage become one edit with `scale = m / typical0` and reach `'all'`, where `typical0` is the
  observed (base calibration) typical months of that stage. The edit **replaces** the preset's
  timer on that (pathway, stage) (`compileTiming` drops the preset's timer there), so every
  project, in the pipeline or new, gets the typed months. `m` is rounded to 0.5 month and clamped
  to `stageBounds` (see "Floors and bounds"); an edit equal to the preset's shown months is
  removed. Stacking on the preset's scale was rejected: it made a typed value slow in-flight
  projects against what the user typed.
- **The policy carries resolved numbers** (Call 3): `TimingSet.presetTimers` and
  `presetRouteShares` are resolved from the calibration when the preset is chosen, so
  `compileLevers` needs no calibration and a published policy is deterministic.
- **One preset at a time** (Call 4). Choosing one replaces the current set, edits included, in one
  store change (Undo restores it). Combinations are made by editing.
- **Editable stages** (Call 5): `preApplication`, `filed`, `permitFiled`, `permitIssued`.
  `entitled` (the applicant's wait to file) and `construction` are shown and locked, each with its
  reason. Pre-application is editable. When `calibration.ppaShare[pathway]` is 0, its details
  say "In the records, no new project starts here since <month year>. A change here reaches only
  projects already at this stage." The date is the start of `ppaShare.provenance.window` (July
  2023 in the current data); without a window the note has no date.
- **Route shares** (Call 10) are whole percentages that always sum to 100. Editing one rescales
  the other two in proportion (an even split when both are 0), with largest-remainder rounding.
  A route with share 0 still shows its timeline, since in-flight projects use it.
- **Local Program lots** stay on the streamlined route; the section says so with the preset's value
  (Call 11).
- **Chances** of moving on and of each exit are shown, never edited.

## Presets and their rules

| Preset                                            | Reach | Rule                                                                                                                                                                                                                                               | Tier    |
| ------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `observed`, "SF as observed"                      | none  | No timers, observed route shares.                                                                                                                                                                                                                  | 0       |
| `sb423Clock`, "SB 423 approval clock"             | new   | Streamlined `filed` scaled by `s = min(1, D / q90)`, `D = (90p + 180(1-p)) / 30.4375` months, `p = SB423_SMALL_SHARE`, `q90` the month by which 90% of outcomes have happened. Keeps the observed route shares (`SB423_ROUTE_SHIFT` is unsourced). | 1, 0, 4 |
| `noDiscretionary`, "No discretionary review"      | new   | The discretionary share moves to streamlined; permit-only is kept.                                                                                                                                                                                 | 2       |
| `benchmarkPermits`, "Permits at San Diego's pace" | all   | `permitFiled` on every route scaled by 134 / 280 = 0.4786. The ratio's inputs are tier 1; applying it to our stage is an inference, tier 2.                                                                                                        | 1 to 2  |
| `ceqaInfill`, "CEQA infill exemption"             | new   | **Unavailable, not offered**: no sourced time effect (`CEQA_FILED_RATIO` is null). Kept in `PRESETS` with `available: false`.                                                                                                                      | n/a     |

Every preset keeps Local Program lots on streamlined. A preset scale below a stage's floor is
raised to the floor and the stage says "Limited by the minimum". Inferences are tier 2
(ruling: the evidence hierarchy puts inferences at tier 2). The preset picker lists only available
presets. A preset the sources cannot support is not offered (needs a source: `ceqaInfill`).

## Floors and bounds

A stage's minimum months is `max(floor, 0.05 x typical)` and its maximum is `10 × typical` (the
engine's `MIN_SCALE` and `MAX_SCALE`, `stageBounds`). Floors are sourced only (Call 7): the
`permitFiled` floor (0.92 month) and the discretionary `filed` floor (0.657 month); the others have
none, and the details say "No sourced minimum; numerical limit ×0.05". Reaching a bound is shown
three ways: "min" or "max" badge above the bar, the segment's name ("at the minimum"), and the
details line "At the minimum"; it is announced. A custom edit replaces the preset's timer on its
stage, and both are clamped to the engine's scale range before they are stored, so a stage never
carries a product past the clamp.

## Save and Revert

Save ("Save timelines") stores the current set as `timing.saved` with the label shown at that
moment. Plan 5 persists it: autosave keeps it, so "Revert to saved" survives a reload, but Publish
strips it (`SIM_CODEC.publishable`), so a shared link carries no snapshot. Every load (autosave
restore, `/s/<id>`, Remix) reconciles both the current set and the snapshot with the calibration
the page runs on (`reconcileTiming`, `src/lib/sim-page/reconcile.ts`): presets are re-resolved by
their rule and custom edits clamped, with a notice listing what moved ([plan-sharing.md](plan-sharing.md),
"Policies"). Revert reads "Revert to saved" when there is a snapshot
and "Revert to <preset name>" otherwise. Choosing a preset keeps the saved snapshot. Each is one
labelled store change, so Undo covers it. Editing a preset's set makes the label
"Custom (from <preset name>)".

## The timeline UI

Each route's bar is a roving-tabindex group of segment buttons (Left, Right, Home, End move;
Enter or a click opens the stage details). Names read "<Stage>, <months> months, <advance>% move
on[, locked][, at the minimum]" ("1 month" is singular). The details hold the "Typical months"
input (step 0.5), "Shorten by 0.5 month" and "Lengthen by 0.5 month" buttons (shown "−" and "+"), the minimum, the chances, the reach line and the
sources. Keyboard edits coalesce in undo (Call 14). Dragging is a pointer enhancement (Call 13,
WCAG 2.5.7 and 2.5.8): the handles are `aria-hidden`, sit in a row under the bar, and commit one
store change on pointer-up; the min/max badge sits above the bar.

## Sources in the UI

Every shown number names what it rests on. A stage's details list "Sources:": the preset's
provenance when a preset timer sets that stage, otherwise the calibration's own provenance for
the stage's table (`Transition.provenance`, with its links), locked stages included. On a stage
with a custom edit they say "Your value: N months (custom, not sourced). Observed: M months." and
list the table's provenance as "Observed source:", so a typed number is never shown with a
per-record citation. The section ends with a "Sources and tiers" disclosure: the selected
preset's provenance (for "No discretionary review", the HCD citation), and the route shares'
source: `pathwayForNew.provenance` when observed, the preset's provenance plus
`pathwayForNew.provenance` when the preset sets them, or "your values (custom, not sourced)" with
the observed shares and their source. Both render through `SourceList.svelte`.

## Reach

Permit-office speedups and custom edits reach every project (`'all'`); approval-route and
entitlement changes reach only projects filing after the policy starts (`'new'`). The details say
which: "Applies to every project, including those already in this stage" or "Applies to projects
filing after the policy starts". On the map, bars read the cohort's own lookups (Call 15); see
[fzp-mode.md](fzp-mode.md).

## Evidence

All sources accessed 2026-10-30. Tiers follow the evidence hierarchy: 0 per-record data, 1
official aggregates and law, 2 inferences, 3 literature and research models, 4 invented.

| Constant                           | Value                           | Tier | Source                                                                                                                                                                                                                              | Status                                                                                                                                                                          |
| ---------------------------------- | ------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BENCHMARK_PERMIT_DAYS.sf`         | 280 days                        | 1    | [BLA, Post-Entitlement Permitting, 2026-03-05](https://sfbos.archive.sf.gov/sites/default/files/BLA_Post_Entitlement_Permitting_030526.pdf), Exhibit 1 (PDF p. 9), p. 7                                                             | Sourced. DBI housing permits issued 2024-01-01 to 2025-08-12, whatever their filing date; includes pre-entitlement time for permits filed before 2024. See "Benchmark caveats". |
| `BENCHMARK_PERMIT_DAYS.sanDiego`   | 134 days                        | 1    | BLA, Exhibit 1 and notes 2 to 3                                                                                                                                                                                                     | Sourced. Housing permits issued January to about mid-December 2025, from public dashboards of unknown composition. See "Benchmark caveats".                                     |
| `SB423_DEADLINE_DAYS`              | 90 / 180 days, cutoff 150 units | 1    | [Gov. Code § 65913.4](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65913.4) (d)(1)(A) and (B)                                                                                         | Sourced. Runs from submittal of the development. leginfo and Justia returned 403; text read on the gocodebook mirror (2026 edition, as amended by SB 597).                      |
| `SB423_SMALL_SHARE`                | 0.7679 (43 of 56)               | 0    | Dataset `2026-10-29-0fd62c4d` `projects.json` (asOf 2026-10-19), `npx tsx scripts/timing-evidence.ts`                                                                                                                               | Sourced. Streamlined-pathway pipeline projects with units <= 150. Fixture-0: 1 of 1.                                                                                            |
| `SB423_ROUTE_SHIFT`                | null                            | n/a  | SF Planning SB 423 form, HCD review, web search                                                                                                                                                                                     | Unsourced: no official or per-record eligibility estimate. The SB 423 preset keeps observed route shares.                                                                       |
| `SB423_DEADLINE_QUANTILE`          | 0.9                             | 4    | Plan Open question 2                                                                                                                                                                                                                | Invented parameter, labelled tier 4.                                                                                                                                            |
| `CEQA_FILED_RATIO`                 | null                            | n/a  | Locked Planning extracts; [UC Berkeley CALES report for HCD](https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/ucb-examining-local-law-policy-planning-practice-on-development-in-sf-using-cales.pdf) | Unsourced: no environmental-review type in the locked records; CALES gives pathway shares (Table 10) and per-project plots, not time by pathway. `ceqaInfill` needs a source.   |
| `NO_DISCRETIONARY_BASIS`           | (citation)                      | 2    | [HCD SF Housing Policy and Practice Review, 2023-10-25](https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/sf-housing-policy-and-practice-review.pdf), Required Action 1 (PDF p. 18)                   | Sourced. Definitional inference from the tier-0 route shares.                                                                                                                   |
| `STAGE_FLOORS.*.permitFiled`       | 0.92 month (13 + 15 days)       | 2    | BLA, PDF pp. 8, 9, 11                                                                                                                                                                                                               | Sourced. Median completeness check 13 days plus median first review 15 days; medians read as a minimum (tier-1 inputs, tier-2 use).                                             |
| `STAGE_FLOORS.discretionary.filed` | 0.657 month (20 days)           | 2    | [SF Planning Section 333 handout](https://sfplanning.org/sites/default/files/forms/Section333_Instructions_Declaration.pdf) (v. 05.15.2019)                                                                                         | Sourced. Notice posted at least 20 days before the hearing; applies to hearing-based approvals.                                                                                 |
| `STAGE_FLOORS.streamlined.filed`   | null                            | n/a  | Gov. Code § 65913.4                                                                                                                                                                                                                 | Unsourced: the statute sets maximums only.                                                                                                                                      |
| `STAGE_FLOORS.*.preApplication`    | null                            | n/a  | none found                                                                                                                                                                                                                          | Unsourced: no minimum PPA letter time found.                                                                                                                                    |
| `STAGE_FLOORS.*.permitIssued`      | null                            | n/a  | none found                                                                                                                                                                                                                          | Unsourced: no minimum time from issuance to construction start found.                                                                                                           |

### Benchmark caveats

The `benchmarkPermits` ratio (San Diego / SF) changes direction with the SF figure, so its
caveats are carried in both values' provenance:

- The BLA says the city table "is not an exact comparison as each city presents its data
  slightly differently" (PDF p. 8). San Diego's 134 days comes from "publicly available datasets
  and dashboards" (Exhibit 1 note 3, PDF p. 9), of unknown composition.
- Sensitivity: SF 280 days (housing permits issued 2024-01-01 to 2025-08-12) gives 0.4786;
  PermitSF 177 days (all in-house permits issued 2024-12-01 to 2025-11-30) gives 0.76; SF 114
  days (housing permits filed and issued 2024-01-01 to 2025-08-12) gives 1.18, that is San Diego
  slower (Exhibit 2, PDF p. 10).
- Why 280: both 280 and 134 measure permits issued in a window, whatever their filing date. The
  model's `permitFiled` stage (typical 10 to 13 months by pathway, pooled 2007-01-01 to
  2026-10-19) has the same pre-2024 composition, when SF permits were often filed concurrently
  with entitlements.

### Notes on the primary texts

- **Gov. Code § 65913.4 (SB 423).** (c)(1): the city finds a conflict with objective standards
  within 60 days of submittal (150 or fewer units) or 90 days (more). (d)(1): design review is
  completed and a compliant development approved within 90 days of submittal (150 or fewer
  units) or 180 days (more). The SF Planning SB 423 application form adds a 30-day eligibility
  and completeness review after submittal that restarts on a revised application.
- **Pub. Resources Code § 21080.66 (AB 130, 2025).** A statutory CEQA exemption for a housing
  development project on a site of 20 acres or less (5 for a builder's remedy project) in an
  incorporated city or urbanized area, on a site with qualifying urban uses, consistent with the
  general plan and zoning, at 50% or more of the Housing Element minimum density, outside the
  sensitive sites of Gov. Code § 65913.4(a)(6), demolishing no listed historic structure, and
  with no hotel or transient lodging. Read from the City of South San Francisco AB 130
  eligibility checklist (November 2025), which cites each subdivision; the statute on leginfo
  returned 403. The law is tier 1; its effect on time is unsourced (`CEQA_FILED_RATIO`).
- **Changes from the plan's table.** The `permitFiled` and discretionary `filed` floors and
  `NO_DISCRETIONARY_BASIS` are tier 2, inferences (medians read as a minimum; a hearing notice
  applied to every discretionary project; a definitional route shift). Month conversions use the
  codebase's `MONTH_DAYS = 30.436875`, not 30.4375. The 90/180-day clock is at (d)(1).

## Open questions

Run under each recommendation until the partner decides:

1. `entitled` is locked (the applicant's wait to file).
2. "Meets the SB 423 clock" means 90% of the stage's outcomes by the deadline
   (`SB423_DEADLINE_QUANTILE`, tier 4, labelled); "median at the deadline" is far weaker.
3. Presets that cannot be sourced are left out of the picker (`ceqaInfill`: needs a source).
4. Pre-application shows, editable, with the no-new-projects note.
5. The benchmark is San Diego only. The SF figure stays 280 days on the same "issued in window"
   basis as San Diego's 134, with the caveats above; SF's own recent 114 days would turn the
   preset into a slowdown (1.18).
6. Under "No discretionary review" all discretionary projects go to streamlined.
7. Floors are sourced only; unsourced stages are bounded by the numerical limit and say so.
8. SB 423 already applies in SF, yet the observed streamlined filed-to-entitled median is 7 months
   against a 90-day clock. The preset models "the clock met" and says so.
