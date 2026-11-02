# /lesscars Plan 2 of 3: The Page (outline)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: outline.** Expand into a full plan (Interfaces blocks, TDD steps) after Plan 1 merges, reading the code Plan 1 produced (`src/lib/data/lesscars/`, the fixture `scenarios/lesscars/` files in `fixture-0`). It is outlined, not written, because its interfaces depend on Plan 1's codec as built, and its UI decisions are best made against real fixture output.

**Goal:** A standalone `/lesscars` route that plays the stored plan future from 2028 to 2068: streets changing state, transit opening, garages and the shuttle appearing, buildings rising, with the headline difference in the top bar and the breakdown, project timeline and evidence behind a tap.

**Architecture:** Read-only playback. No simulation runs in the browser: the page loads the manifest's `scenarios.lesscars` files, and a worker playback mode packs the stored representative timeline (engine schedules plus initiative builds, freed sites as an extra cell of synthetic records) with the existing massing and `packTimedCell`. The FZP timelapse's scrubber, map and generator are reused.

**Spec:** `docs/superpowers/specs/2026-11-01-lesscars-design.md` (Goals 1 to 4, Non-goals, "Compact UI", "Accessibility").

## Global Constraints (carried from the spec and Plan 1)

- Route `/lesscars`, standalone; no change to `/sim`. Nobody edits anything but the year and map layers.
- Scrubber range `LESSCARS_START` (2028-01-01) to `LESSCARS_HORIZON` (2068-12-31) from `src/lib/data/lesscars/schedule.ts`; the page opens paused (no autoplay, as `/sim`).
- Headline in the top bar: mean extra homes by 2068 with the p10 to p90 band; details behind a tap; phone header items in the Menu (owner preference: compact UI, status apart from controls).
- Amenities appear on the map and in no housing number.
- Every plan parameter shows its evidence tier and source; tier 4 is labelled unsourced.
- WCAG 2.2 AA (`docs/dev/accessibility.md`, `expectNoA11yViolations`).
- The worker computes nothing geographic at runtime beyond massing the stored timeline; data stays under `data/<v>/`.

## Tasks (outline)

1. **Load and route.** `src/routes/lesscars/+page.ts` (universal load like `src/routes/sim/+page.ts`): manifest, then `plan.json`, `sites.json`, `summary.json` through the Plan 1 parsers; a dataset without `scenarios.lesscars` renders a "not in this dataset" state. Header link "Fewer cars". Tests: load spec (missing key, bad file), route render spec.
2. **Playback worker mode.** A new request `initPlayback { rev, manifest, timeline }` in `src/lib/sim/` that decodes `timeline.bin` against `parcels.bin`, converts initiative builds to drawable schedules, adds freed sites as a synthetic cell, and answers `timeline` responses as `initScenario` does (prefetch by viewport, `chunks`). Decision to make when expanding: a new `Schedule.origin` value `'initiative'` (cards and map read `origin`, `src/lib/sim/scenario/card.ts:95,141`) versus a parallel build list in the render update. Tests: host spec on the mini city, a stored timeline packs the same cells as a live run of the same seed.
3. **Map layers.** Street states by year (car lanes, bus-only, bike, pedestrian, removed) from `plan.json` segments and times; plan transit lines and stops by opening day over the existing transit layer; edge garages and the shuttle line; a MapKey entry for each. Styling is the builder's call; colours checked for contrast and not colour-only (pattern or label). Tests: layer feature filters by day, a11y of the key.
4. **Header headline and details.** A status-slot headline ("+N homes by 2068", band in the details), the details popover/disclosure with the source breakdown (freed land, parking sites, transit-unlocked, other; parts sum to the whole as stored) and the per-year chart (reuse `ScoreChart` patterns), and the project timeline (start, open per project, grouped by kind) so housing visibly follows transit. Tests: component specs; the breakdown sums; keyboard and screen-reader names.
5. **Evidence.** A sources dialog listing each parameter with tier, source link and method, reusing `SourcesDialog` patterns; opened from the details and from a project in the timeline. Tests: tier 4 rows say unsourced.
6. **e2e and docs.** `e2e/lesscars.spec.ts` on `fixture-0` (scrub, play, open details, open sources, axe at 1280 and 375 px, footer unobscured); `docs/dev/lesscars.md` page section; CLAUDE.md link text updated.

## Open questions to settle when expanding

- Whether the baseline representative future is also drawn (a toggle) or only the plan future (the spec says the map plays one representative future: default plan only).
- `Schedule.origin` extension versus a separate build list (Task 2).
