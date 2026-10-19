# FZP timelapse composition package: fresh-eyes fidelity review (2026-10-16)

Scope: design `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md` (incl. Rulings, Interface table, Traceability, reconciliation and late addenda), the source model `2026-10-10-1749-sf-housing-sim.md` (seams, R4/R8/R10, Global constraints), the seven specs `docs/superpowers/specs/2026-10-16-*-design.md` and both research docs. Documents only; no code read.

Spec short names: SD = scenario-data, PR = project-records, SC = stage-calibration, PM = pipeline-massing, TS = timelapse-sim, TR = timelapse-render, FM = fzp-mode.

Checked and consistent (no finding): T-row text is byte-identical across specs. Also consistent: `MONTH_DAYS`, `OPEN_DAY`, `FILL_LEVELS` (F = 5), the horizon (2050-12-31 = Day 29,584; asOf 2026-10-16 = Day 20,742), the 16 occupiable pathway × stage pairs, the 241-entry `chanceTable`, invariant ids V15–V19 / V20–V24 / V25–V29, the derived-cache path, the `HistoriesFile` wrapper `{schema, asOf, histories}`, the manifest `scenarios` zod shape, playback speeds (1 mo/s, 1 yr/s default, 3 yr/s), the 90 d red + 180 d fade, bar zoom 15, N = 101, the RHNA deadline 2031-01-31, `ppaShare` = 0, Local Program → `streamlined`, the risk-set rules, and the evidence-hierarchy text.

---

## Blockers

### 1. [blocker] Two specs read `TimelineScore.months` differently, so the scoreboard is off by a month and the FM e2e fails
- **Location:** TS §4.3 vs FM §4.4 ("Range", "Per frame"), FM §6 fixture `timeline-score.ts`, FM §6 e2e "Keyboard End"; design T8 ("first of each month, asOf → horizon").
- **Problem:**
  - TS defines `months` as the 1st of the month **after** `asOf` through the 1st of the month after the horizon (2026-11-01 … 2051-01-01, 291 entries). The value at `months[i]` counts events with `day < months[i]`.
  - FM's fixture runs 2026-10 … 2050-12. FM indexes `(Y(day) − Y(months[0]))·12 + (M(day) − M(months[0]))`.
  - Against the real TS output:
    - a day in March 2031 shows the state at 1 March (that is, February's) under a "March 2031" readout;
    - `asOf` maps to index −1 (clamped);
    - End (2050-12-31) maps to index 289, not the last entry (290), so FM's own e2e assertion `headline == shown[last]` fails;
    - FM's check "calibration.asOf differs from the month of `months[0]`" fires on every load.
- **Fix:** Make one semantics normative in T8. For example: `months[i]` = 1st of month *i* starting with asOf's month, and the value = state at the end of that month. Copy it verbatim into TS and FM, and have FM's index rule and fixture derive from it.

### 2. [blocker] The dependency order can't be built: step-1 subsystems import types that land in steps 2–3, and T5/T6/T8 types have no home
- **Location:** design "Dependency order"; TR §2.1 (`TimedPackInput.schedule: Schedule`); SD §2 (`featureValue(..., f: FeatureId, ...)`, `Provenance`, `Day`); PR §4.5 (`STAGE_ORDER`); TS §1 file table.
- **Problem:**
  - Step 1 (SD ∥ PR ∥ PM ∥ TR) depends on SC's `src/lib/timelapse/time.ts`, `math.ts` and the T2/T4/T4a types in `model.ts`, which are step 2.
  - TR's `packTimedCell` takes T5 `Schedule`, owned by TS (step 3).
  - No spec names the file that exports `Schedule`, `ProjectCard`, `TimelineScore`, `TimelineUpdate`/`TimedPackedCell` or `ScenarioParcels`. TS's file table has no types module.
- **Fix:** Add a "step 0: shared types and time" deliverable:
  - SC ships `time.ts`, `math.ts` and the type half of `model.ts` first;
  - TS ships e.g. `src/lib/sim/scenario/types.ts` (T5, T6, T8), and TR ships the T7 types, before step 1 starts.
  - Name each file in its owning spec.

---

## Should-fix: contradictions between specs

### 3. [should-fix] `parcelSummary` has no `projectId`, so the card can describe a different project than the one picked
- **Location:** design T6 request `{ parcelId, day }`; TS §4.9 ("latest one"); T7 `timelinePick` carries `projectId`; TR fixture slot (h) (multi-phase shares a parcel).
- **Problem:**
  - Slots are keyed by project and parcel ids repeat (T7). A fading dead project and a new project can coexist on one parcel, and so can DA split rows or a multi-phase row with another project.
  - The pick names project A, but the worker returns the latest project on the parcel.
- **Fix:** Add an optional `projectId` to the T6 `parcelSummary` request. The worker returns that project when it is visible at `day`, and otherwise falls back to the current rule.

### 4. [should-fix] `ProjectCard` lacks `existingUnits` and `storiesTier`, which the card shows
- **Location:** T6 `ProjectCard`; FM §4.8 "Size at day" ("replaces {existingUnits} … net +…"); T3 `storiesTier`.
- **Problem:**
  - FM can only take `existingUnits` from `ParcelSummary`, which is the **parcel's** value. For multi-parcel projects the net figure is wrong (T3/T5 sum over all parcels).
  - Stories parsed from description text (tier 3) render as plain data, which breaks the global rule "a tier-3 number is never presented as data".
- **Fix:** Add `existingUnits` (from `Schedule`) and `storiesTier: 0 | 3 | null` (pipeline only) to `ProjectCard`. FM labels tier-3 stories, e.g. "about 8 stories (from project description)".

### 5. [should-fix] The rule for the card's `massing` flag is defined twice, differently
- **Location:** TS §4.9 ("matched when the building's units are within ±10% of `units`") vs PM §4.4 ("timelapse-sim maps … `'approximate'` when `massingApproximate(b)`", tolerance ±max(1, 10%)).
- **Problem:**
  - `generateForUnits` always returns `units === U`, so TS's rule always gives `matched` for pipeline projects.
  - `massingApproximate` always gives false for `generate` output, so PM's helper misses simulated projects drawn after a revision (stories come from the next fill level up, so the drawn yield can differ from `units'`).
  - TS also drops PM's ±1 floor.
- **Fix:** In TS §4.9:
  - pipeline: `massingApproximate(b)`;
  - simulated: `|b.units − revision.units| > unitsTolerance(revision.units)`;
  - multi-phase or null building: `none`.
  - Cite PM's `unitsTolerance`.

### 6. [should-fix] Failed massings and multi-phase footprints don't fit TR's pack contract
- **Location:** TR §2.1 (`massings` index-aligned with revisions; footprint ring "when massing is 'none' (multi-phase rows, failed massing)"), §4.1.1 throws on length mismatch; TS §4.8 (multi-phase "footprint-only") and §4.10 ("generator throws or returns null → no geometry for that revision").
- **Problem:**
  - TS gives no geometry for a failed revision, but TR needs an entry for every revision or it throws.
  - No spec says who builds the lng/lat footprint ring, or how: I6 polygons are local metres, and a multi-parcel PRX has more than one polygon.
- **Fix:** In TS §4.8, a null/throwing massing becomes a footprint entry. The ring is the anchor parcel's outer ring converted with the existing `geo.ts` `localFrame` (the same transform the generator uses). Multi-parcel projects use the anchor parcel only (or the PM union, but say which).

### 7. [should-fix] "Band-only messages" have no defined `TimelineUpdate` shape, so TR may discard them and trigger a resync
- **Location:** TS §4.7 ("post a band-only message after every 16 runs"); TR §4.1 ("revision must equal last + 1, or the update is discarded and `onResyncNeeded` fires"); FM §4.2 ("Every `timeline` message: call `applyTimeline(render)`").
- **Fix:** In TS, state that a band-only message is a `timeline` with `render = { revision: last + 1, cells: [], removedCells: [], demolish: [] }`. Alternatively, FM skips `applyTimeline` when `cells` and `removedCells` are empty and the revision is unchanged. Pick one.

### 8. [should-fix] `complete` mixes band completeness with geometry packing, so "still calculating" flickers back on pan
- **Location:** design T6 `complete`; global constraint "the UI marks [the band] as provisional until it is complete"; FM §4.5 item 5; TS §4.7.
- **Problem:** After the band finishes, any newly ready chunk sets `complete = false`, and FM re-labels a final band "(still calculating)". FM can't tell band progress from `band` itself (it is a per-month array).
- **Fix:** Add `bandRuns: number` (or `bandComplete: boolean`) to the T6 `timeline` response, or to T8. FM keys the provisional label on that.

### 9. [should-fix] `ScenarioClient` has two possible owners, and TS's API lacks `prefetch` and `retryChunks`
- **Location:** design late amendment ("`ScenarioClient` … owned and shipped by timelapse-sim"); FM §4.2 ("If timelapse-sim does not ship it, fzp-mode writes it at `src/lib/fzp/client.ts`"), FM §6 "`client.spec.ts` (if fzp-mode owns the client)", FM "Still open R2"; TS §4.1 API list.
- **Problem:** FM sends `prefetch` on every `moveend` and `retryChunks` from the chip, but TS's `ScenarioClient` API exposes neither.
- **Fix:**
  - Delete FM's fallback, its client test and R2. FM imports `src/lib/sim/scenario-client.ts`.
  - Add `prefetch(bbox)` and `retryChunks(cells)` to the TS API.

### 10. [should-fix] FM's crash Retry sends the editor's `init`
- **Location:** FM §4.2 Crash → Retry step 4 ("call `init` with the manifest. The host answers with `ready`").
- **Problem:** Per TS §4.1, `init` goes to the editor host and starts editor state. A following `initScenario` disposes it. That is wasted work and a possible race, and T6 already says `initScenario` is answered by `ready`.
- **Fix:** Drop step 4. Retry sends only `initScenario`.

### 11. [should-fix] T7 `timelinePick.kind` is defined in the row but in no behaviour section; FM still infers it
- **Location:** design late amendment (T7 gains `kind`); TR §4.8 (no mention of `kind`); FM §4.8 (infers hover/tap from `pointer: fine`) and FM "Still open R1".
- **Fix:**
  - TR §4.8: `'hover'` on pointer-move picks (fine pointer), `'tap'` on click or touch tap.
  - FM §4.8: open the card on `kind === 'tap'` and show the tooltip on `'hover'`.
  - Mark R1 resolved.

### 12. [should-fix] The initiation features are computed twice, with different imputation and a different at-risk set
- **Location:** SC §4.6 feature table (`yearBuilt` → 0 if unknown; `improvementShare` → −1 if unknown; at-risk set = "T11 parcels with `hostable` true") vs SD §4.5 (class-median imputation with mask bits 0 and 2; vacant gives 0) and SD §4.6 (the panel already carries `improvement_share`, `rent_control_likely`, `potential_ratio_base`, `stories_gap_base`, `imputed`, `hostable_base`).
- **Problem:**
  - The fit puts unknown parcels in the "unknown" bins (−1/0), but at application T11 gives them medians. The same parcel is binned differently at fit and at use, which biases the main new-project rate.
  - SC's own test ("latest-roll values equal T11's base variant") fails by construction.
  - SC also uses the **FZP** `hostable` flag for the pre-FZP fit, although SD ships `hostable_base` for exactly this purpose.
- **Fix:**
  - SC reads the SD panel columns (one definition of each feature, owned by SD/T13). Either drop SC's −1/0 "unknown" bins, or have SD ship the raw-plus-mask values and pick one imputation for both fit and apply.
  - The at-risk set uses `hostable_base`.

### 13. [should-fix] PR reads DuckDB tables SD doesn't define, and lists two resolved items as still open
- **Location:**
  - PR §4.8 (`baseStoriesAtFiling` from `scenario_envelopes.base_stories`) and PR §4.9 (tables `scenario_envelopes`, "scenario-data's lineage");
  - PR "Interface concerns → Still open" (`rhnaCompletedNet` scope; lineage table name);
  - PR §4.9 heading "(T3: units completed minus units demolished)".
- **Problem:** SD defines only `scenario_panel` (DuckDB) and `parcel-lineage.parquet`, and no `scenario_envelopes` table. The late rulings settled both open items: the Housing Inventory net definition, and `parcel-lineage.parquet`.
- **Fix:**
  - PR reads `base_stories` from `scenario_panel` (or SD names and defines `scenario_envelopes`), and lineage from a named table or parquet file.
  - Move both items to "Resolved".
  - Change the §4.9 wording to the HI definition.

### 14. [should-fix] The fixture-0 assessor units disagree between SD and PR
- **Location:** SD §4.11 roll highlights (lot 1: 2 units; lot 6: 2 units) vs PR §4.9 Fixture ("assessor units are 0 on every project lot except lot 001 (1 unit)", which gives M10 `existingUnits` 1). PR says its values "come from scenario-data's fixture".
- **Problem:** M10 (lot 001) and M11 (lot 006) goldens will disagree with SD's fixture.
- **Fix:** Derive PR's expected values from SD's table: M10 `existingUnits` = 2, M11 = 2 (M11 net is still 1). Also state that SD's fixture lock entries keep `retrievedAt` ≤ 2026-10-10, because `asOf` is the newest `retrievedAt` across the whole lock (PR §4.1).

### 15. [should-fix] SC's coverage-gap guard will abort the fixture build
- **Location:** SC §4.4 Guard ("any year from `startYear` to the last complete year with zero qualifying entries … raises `CalibrationError`"), §4.11 (`FIXTURE_CAL` has no guard setting), §4.12.
- **Problem:** The 13 mini histories leave most of the years 2011/2015–2025 empty for every stage, so `pipeline fixture` throws and fixture-0 (the integration milestone) is never written.
- **Fix:** Add a `COVERAGE_GUARD: true | false` method constant (LIVE true, FIXTURE false), or apply the guard in live mode only.

### 16. [should-fix] The design ruling on the five `//` strings contradicts SD
- **Location:** design "Open questions answered" ("The 5 non-R-4 `//` strings are non-Local-Program") vs SD §4.2 step 5 (the first four are non-LP; the fifth, `120/400//120/650-R4`, normalises to `-R-4` and **is** LP; fixture lot 14 "LP, envelope 65").
- **Problem:** SD is right on the merits, but the design's ruling says otherwise.
- **Fix:** Amend the design ruling to "the four non-R-4 `//` strings are non-LP; `…-R4` is a typo for `-R-4` and is LP".

### 17. [should-fix] FM's DataSF link rule for pipeline rows breaks for PRX case numbers
- **Location:** FM §4.8 sources key table (`6jgi-cpb4`: "`case_no` if the id ends `PRJ`, else `bpa_no`") vs PR §4.8 (pipeline source id = `case_no ?? bpa_no`; PRX case numbers like `2007.0946PRX`).
- **Problem:** Every multi-phase row's link queries `bpa_no=2007.0946PRX`, which matches nothing.
- **Fix:** Use `case_no` when the id is not a pure permit number (e.g. matches `/PR[JX]$/` or contains `.`/`-`), else `bpa_no`. Better: PR stores the field name in `sources` (`{dataset, id, key}`).

---

## Should-fix: fidelity to partner intent

### 18. [should-fix] The reference lines compare unlike quantities, and "new under the plan" overstates what the FZP caused
- **Location:** TS §4.5 references (Planning label "net approvals"; Controller "beyond what existing zoning might produce"); T8 `entitledNew` ("cumulative units", gross, per TS §4.5); FM §4.5/4.6 labels "Simulated, new under the plan".
- **Problem:**
  - `entitledNew` is **gross** units, but Planning's 39k is **net**.
  - Both published estimates are **increments over existing zoning**. The simulated "new" series counts **every** simulated start, including ones the old zoning would have produced.
  - So the chart reads as "the simulation vs Planning/Controller" on bases that differ in two ways. This weakens the partner's honesty and evidence intent.
- **Fix:**
  - Make `entitledNew` net (units − existingUnits), or relabel the reference as gross-compatible.
  - Add to each reference's dialog entry and chart label: "published estimate is the plan's increment over prior zoning; the simulated line counts all new projects".
  - Rename the series "Simulated, new projects (any zoning)", or add a base-zoning counterfactual later through T9.

### 19. [should-fix] Multi-phase rows (over half the pipeline's units) are simulated as single projects, and nothing in the UI says so
- **Location:** design "Multi-phase projects", Out of scope; PR §4.2 item 9 (22 PRX rows ≈ 40.9k units; Candlestick alone 9,637); TS §4.4.3; FM §4.5/§4.10.
- **Problem:**
  - Each PRX row completes all at once, so the completion curve and band get 5–10k-unit steps.
  - This undercuts "realistic timeframe" and "real pipeline as starting state". Only the card mentions it.
- **Fix:** At minimum, add a scoreboard footnote and a sources-dialog entry: "N multi-phase projects (X homes) are simulated as single projects; their phasing is not modelled". Consider partner sign-off on accepting the step artefact.

### 20. [should-fix] The Local Program's borrowed durations (tier 2) are shown as tier 0
- **Location:** design reconciliation ("its durations come from the streamlined tables (tier 2 proxy)"); SC §4.7 (no provenance for the proxy); FM §4.10 item 7 (states only the tier-1 pathway rule).
- **Problem:** Every Local Program project's timing comes from SB 35/HSD/AB 2162 tables whose provenance says tier 0. The partner's "evidence hierarchy with tier labels" is lost for the largest class of new projects.
- **Fix:** SC writes a provenance note into `calibration.json` (e.g. `streamlinedForLocalProgram: Provenance`, tier 2, "SB 35/HSD/AB 2162 durations used as proxy; Local Program in force since 2026-01-12"). FM's dialog and card cite it for LP projects.

### 21. [should-fix] Tail hazards are extrapolations, but they carry tier 0
- **Location:** SC §4.4 Tail, §4.5 rung 1 ("Tier 0 … tail: constant hazards … (extrapolation)").
- **Problem:**
  - For long-lived stages, the tail sets most outcomes. Examples are the ≈9.7k units at "BP not yet filed" and in-flight rows entitled in 2008, where conditional draws start deep in the tail.
  - Under the hierarchy, a constant-hazard extrapolation beyond observation is an inference (tier 2), not tier 0.
- **Fix:** Give `tail` its own provenance (tier 2), or a `tailTier`. FM shows it in the dialog and in the card's "How is this estimated?".

### 22. [should-fix] DBI's Sept–Oct 2026 batch withdrawal enters the exit tables as real attrition timing
- **Location:** PR §4.7 ("DBI batch-withdrew such permits in Sept–Oct 2026, visible in their `status_date`"); SC §4.4 (no treatment).
- **Problem:** Hundreds of long-stale permits exit on one administrative date at durations of about 10 years. That inflates `permitFiled` tail exit hazards, against the partner's "attrition matching data … in which stage" (the timing is an artefact).
- **Fix:** SC detects administrative purge windows (exits clustered within a short date range at durations above some percentile). Either censor those spells at their last non-purge activity, or report and flag them. State the rule and its tier.

### 23. [should-fix] The OD-T3 window may cut against the partner's words
- **Location:** design OD-T3 ("No subset of 2014–present stands in for the future"; "Initiation is fitted over all available parcel-years"); SC §4.4 (W = 2015-01-01 for all stages), §4.6 (initiation 2015-01..2025-12 only); reconciliation ("Permit stages are not pooled further back").
- **Problem:**
  - W = 2015 is itself a subset of 2014–present.
  - Permit stages have tier-0 data from 1981, 2000 and 1983, but are cut to 2015 to keep per-pathway separation.
  - Initiation drops roll years 2007–2014.
  - Each choice is defensible, but each is an orchestrator reading of a partner ruling.
- **Fix:** Get partner confirmation of "W = 2015, permit stages not pooled to 1981, initiation from 2015" with the reasons (PRJ coverage, event observability), or use 2014 where coverage allows (d4jk 182, PRJ 158). Update the design text "all available parcel-years" to match whichever wins.

---

## Should-fix: placeholders, delegation and evidence

### 24. [should-fix] SD's density-cap values are left to implementation
- **Location:** SD §4.4 base density cap table (RM "(I, to verify against §209.2)"; NC "the per-lot-area ratio the Code states … to read from Article 7 at implementation").
- **Problem:** These caps set `potentialRatio` (the decontrol signal) and base yields, which are visible model inputs. AC 10 requires verification but gives reviewers nothing to check now.
- **Fix:** Fill the NC rows with values and section numbers, and confirm the RM ratios, before handoff.

### 25. [should-fix] PR's heuristic thresholds carry no tier
- **Location:** PR §4.5 `filed` (a) ("unless a PPA opened within 7 days"); PR §4.4 item 3 (referral = "opened on or after … filed day minus 30 days").
- **Problem:** Both feed stage dates and pathway classification, and so the calibration.
- **Fix:** Label them tier 4 with a rationale (or tier 2 if measured), and print them in the report.

### 26. [should-fix] The `@luma.gl/engine` dependency and its credit are in no scope or acceptance list
- **Location:** design reconciliation "Rendering"; TR §2.2 IC-9 (marked resolved), but absent from TR §1 In scope and §7 ACs; FM §4.12 defers it to TR.
- **Fix:** Add to TR In scope and an AC: "`@luma.gl/engine` added to `dependencies`, credited in `SOFTWARE` (`src/lib/attribution.ts`)".

---

## Nits

27. **[nit] Stale design bullet.** The design's reconciliation "Units semantics" still says `rhnaCompletedNet` "counts units completed minus units demolished". Change it to the Housing Inventory net definition, as T3 and the late ruling say.
28. **[nit] Stale PM items.** PM §1 quotes the design paragraph without `seed`, and IC-1 is "Open", though design line 95 now has `seed`. IC-2 (I9 lacks `composition`/`role`/`tone`) still wants an I9 refresh.
29. **[nit] TR open questions already ruled.** TR §8 OQ-1/OQ-2 are still "open questions" although the late rulings settle them (no exit labels, edges off). Mark them resolved.
30. **[nit] FM status line.** FM still reads "draft for orchestrator review", while the others say "updated to the reconciliation".
31. **[nit] Fixture claim.** SC §4.12 calls `calibration-small.json` the unit fixture for TS, TR and FM, but each uses its own (`mini-calibration.json`, hand-made lookups, fixture-0's file).
32. **[nit] "Never an all-chunk load".** TS §4.2 says "There is never an all-chunk load". With prefetch at every zoom (T6, FM §4.2), a city-wide view loads every chunk. The global constraint only bars first paint *requiring* it. Reword.
33. **[nit] 270-day constant location.** TS §4.9 imports the 270-day death window "from that module". TR does not name a worker-safe export for `dyingHoldDays`/`dyingFadeDays` (they are shader uniforms in a lazily loaded deck module). Name a constant in `pack-timed.ts` or `time.ts`.
34. **[nit] Two "anchor" rules.** TS §4.2 uses the smallest `ParcelId` (cell placement), PM §4.2 the largest `areaM2` (output `parcelId`, the slot's pick parcel). That works, but say so explicitly.
35. **[nit] Net-negative revisions.** TS §4.4.5 lets a simulated downsize reach `units' ≤ existingUnits` (net-negative), with no rule. State "floor at `existingUnits + 1`" or accept it and say so.
36. **[nit] Day-one burst.** TS §4.4.2 places past-month in-flight results at `asOf + 1`, a visible burst of completions and deaths on day one. An alternative: redraw conditioned on survival to `asOf` within the month.
37. **[nit] Unsourced number.** SD V18 `scenarioUnitsRange` uses 413,208 with no source in the spec.
38. **[nit] Header change on `/`.** FM §4.11 also shortens the brand text on `/` below 640 px. The design's "one intended exception" names only the mode links. Note it in the design or keep the brand.
39. **[nit] Hover vs card.** The design says a "project card on hover or tap". FM shows a tooltip on hover and opens the card on click. That is fine, but record it as a deliberate narrowing.
40. **[nit] T9 seam leak.** FM computes `chanceTable` from the untransformed `calibration.json` on the main thread. Under a future `PolicyOp` the bar colour and card would disagree with the worker's schedules. Note it in FM §5, e.g. the worker could post lookups.
41. **[nit] Pipeline docs unassigned.** Only SD updates `docs/dev/pipeline.md`. The PR and SC steps and V20–V29 have no doc owner.
42. **[nit] Null summary copy.** FM does not distinguish `summary === null` (chunk not loaded) from "no project at this date". Both read as "No project…".
43. **[nit] First-paint bytes.** The source design's ≤ 5 MB first paint is relaxed to "no all-chunk load". `parcels.bin` (≤ 3 MB) + `projects.json` (≤ 2 MB) + calibration (fetched by both the main thread and the worker) + basemap can exceed 5 MB. The design accepted this; FM could at least share the calibration fetch.

---

## Coverage summary (check 1)

- **Owned twice:**
  - `ScenarioClient` (TS + FM fallback, #9);
  - the card `massing` rule and its tolerance (PM + TS, #5);
  - the T4a feature computation (SD + SC, #12);
  - the score-month semantics (TS + FM, #1).
- **Uncovered:**
  - the T5/T6/T8 types file and a step-0 types landing (#2);
  - the footprint-ring construction (#6);
  - provenance for the Local Program durations proxy (#20);
  - handling the purge artefact (#22);
  - the `@luma.gl/engine` dependency (#26);
  - pipeline docs for V20–V29 (#41).
- **Covered once:** every other design clause, T-row, global constraint, OD-T1..T5 and reconciliation ruling.

## Partner-statement fidelity (check 3)

| partner statement | status |
|---|---|
| realistic per-stage attrition | carried (SC V27, TS incidence and replay tests); weakened by #19, #21, #22 |
| ghost from first data | carried (TR `ghostFrom`, OD-T1) |
| option A visuals | carried (TR §4.2–4.4) |
| resizing before construction | carried, narrowly: only two revision points (permitFiled, permitIssued); no resize at `entitled`, where 2026's documented upsizings happen (literature §8). Acceptable given T4d's `unitsAt`, but worth stating in the dialog |
| real pipeline as starting state | carried; weakened by #19; alterations (≈2.8k+ units) are excluded with no UI note |
| evidence hierarchy 0–4 with tier labels | carried; gaps #4, #20, #21, #25 |
| horizon 2050 | carried |
| all projects treated the same in the future | carried (OD-T5) |
| no painting | carried |
| policy-lever seam | carried (T9, `buildSimInput`, `startScenario`); small leak #40 |

## Verdict

**Not ready for handoff.**
- Fix the two blockers (#1 score-month semantics, #2 dependency order and type homes).
- Fix the cross-spec contradictions #3–#17, which are mostly mechanical edits.
- Take #18–#23 to the partner or the orchestrator, because they touch partner intent.
- The nits can ride along.
