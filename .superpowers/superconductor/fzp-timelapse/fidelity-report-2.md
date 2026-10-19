# FZP timelapse composition package: fidelity review, pass 2 (2026-10-16)

Scope: the design `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`, read in full, including Reconciliation round 2, Partner rulings round 3 and the round-3 addenda. Also the source model `2026-10-10-1749-sf-housing-sim.md`, the seven specs, and pass 1's report. Documents only. The T1–T13 row text was not re-checked, because a script has already verified it.

Short names: SD = scenario-data, PR = project-records, SC = stage-calibration, PM = pipeline-massing, TS = timelapse-sim, TR = timelapse-render, FM = fzp-mode.

Checked and consistent (no finding):

**Old-zoning twin, core path.** These pieces agree end to end:
- T9 `baseZoning`;
- SD `baseYield[F]`, `hostableBase` and flag bit 4, plus V17, which ties `baseYield = yield` off the Local Program;
- the SD panel's `hostable_base` and `potential_ratio_base`;
- SC fits on base features, with `hostable_base` as the at-risk set;
- TS view swap, paired runs, entity-keyed common random numbers (CRN), net `entitledNew`, `planEffect`, `planEffectBand`, budgets (3 s covers the shown run only; pairs within 4 s);
- FM "What the plan added" copy, the violet chart series, and references coloured by `measure`.

**Multi-phase path.** These pieces agree:
- the T3 `phases` shape;
- PR §4.10 enriched, fallback and last-resort paths, V24, and the M9 and M14 fixtures;
- TS master + phase expansion (phases start at `permitFiled`; master bucket in `inProgress` and `exitedUnits`; `phasing` counts);
- TR phase slots (no master slot; skipped-stage bar rule);
- FM phase line "Phase N of M, {label}".

**Refined window.** SC §4.4/§4.5 matches the design's round-3 text and addenda:
- Planning-side stages use 2015+;
- `permitFiled` is pooled from 1989, and `permitIssued` and `construction` from 2000;
- pathway level comes from 2015+, via a stated θ-scaling rule, with "pooled across pathways before 2015" in provenance;
- initiation runs 2007–2025, uses permit-filing detection before 2015 (tier 2), and has a measurement-basis term that is not shipped.

---

## 1. Pass-1 findings: status

| # | status | note |
|---|---|---|
| 1 | fixed | T8 states one month semantics. TS §4.3 and the FM index rule, fixture and e2e all derive from it. |
| 2 | **partly fixed** | Step 0 exists, but two type homes are still missing (new finding N5). |
| 3 | fixed | T6 `projectId` added; TS §4.9 rule 1 uses it. |
| 4 | fixed | `existingUnits` and `storiesTier` are on the card; FM uses tier-3 wording. |
| 5 | **partly fixed** | TS §4.9 owns the rule, but PM §4.4 still restates it and now contradicts TS for phases (N2). |
| 6 | fixed | TS §4.8 footprint entries; TR §2.1. |
| 7 | fixed | Band-only shape is in T6, TS §4.7 and TR §4.1. |
| 8 | fixed | `bandRuns`/`bandRunsTotal` drive the provisional label; `complete` does not. |
| 9 | fixed | TS ships the client with `prefetch`/`retryChunks`; FM has no fallback. |
| 10 | fixed | Retry sends only `initScenario`. |
| 11 | fixed | TR §4.8 and FM §4.8 use `kind`. |
| 12 | fixed | Features are defined once in SD, read by SC with no second imputation; at-risk set is `hostable_base`. |
| 13 | fixed | `scenario_panel` and `parcel-lineage.parquet`; open items resolved; HI wording updated. |
| 14 | fixed | M10 and M11 existing = 2; fixture `retrievedAt` ≤ 2026-10-10. |
| 15 | fixed | `COVERAGE_GUARD` is on for live builds, off for fixtures. |
| 16 | fixed (nit left) | Design and SD §4.2 are corrected. SD §8 still says "the five non-R-4 `//` strings: non-Local-Program" (N14). |
| 17 | fixed | `sources[].key`, PR key table, FM link rule. |
| 18 | fixed | Superseded by the plan-effect twin. T8 `entitledNew` comment still doesn't say "net" (N15). |
| 19 | fixed (design text stale) | Phase-by-phase simulation plus disclosure. The design's own Out of scope still defers DA phasing (N6). |
| 20 | fixed | `streamlinedForLocalProgram`, card `localProgram`, FM card and dialog. |
| 21 | fixed | `tailProvenance`, tier 2. |
| 22 | fixed | SC §4.4 step 6 purge censoring, with its tier stated. |
| 23 | fixed | Settled by partner ruling round 3. The stale design and SD text is not marked superseded (N7). |
| 24 | fixed | Caps filled from the mirror; partner accepted; re-verification is AC 10. |
| 25 | fixed | 7-day and 30-day tolerances labelled tier 4 and reported. |
| 26 | fixed | TR in-scope item and AC 12. |
| 27 | fixed | Design "Units semantics" bullet. |
| 28 | partly fixed | IC-1 closed. PM IC-2 (I9 refresh) is still open and has no owner (nit). |
| 29 | fixed | TR OQ-1/OQ-2 resolved. |
| 30 | fixed | FM status line. |
| 31 | fixed | SC §4.12 names each subsystem's own fixture. |
| 32 | fixed | TS §4.2: "First paint never requires an all-chunk load". |
| 33 | fixed | `DYING_DAYS` in `time.ts`, used by TR and TS. |
| 34 | fixed | Both anchors stated in PM §4.2, TS §4.2 and TR §4.1.1. |
| 35 | fixed | Floor at `existingUnits + 1`. |
| 36 | fixed | Bounded redraw rule (TS §4.4.2). |
| 37 | fixed | V18 cites the V1 source. |
| 38 | fixed | Design global constraint names the brand shortening. |
| 39 | fixed | Recorded as a deliberate narrowing. |
| 40 | fixed | FM §5 lookups seam. |
| 41 | fixed | PR AC 10; SC §4.10. |
| 42 | fixed | FM null-summary copy. |
| 43 | accepted by design | The SD §4.8 size note's arithmetic omits `projects.json` (N16). |

Tally: 37 fixed (2 with nits left), 1 accepted by design, 3 partly fixed (#2, #5, #28), 0 not fixed. Of the fixed items, #16, #18, #19 and #23 leave stale text.

---

## 2. New findings

### Should-fix

**N1. [should-fix] `permits.parquet` columns don't match between PR and SC, and SC's grouping misses split DA phases**
- **Location:** PR §4.9 "Outputs" (`permits.parquet` columns) vs SC §4.7a "Phases of a group" and "Identifying past multi-phase projects".
- **Problem:**
  - PR emits `dva_record_id`, `prx_case_no` and `da`, with no `permit_type` column (every row is type 1/2 by construction).
  - SC reads `dva_record_ids` (plural), `prx_case`, `case_no` and `permit_type`.
  - SC defers with "its names win", but both specs now exist, so the mapping should be written down, not left to the implementer.
  - SC also defines a DA group as one T4d history, found by looking for a `DVA` child in `sources`. Two things break this:
    - PR §4.2 step 7 splits any component with ≥ 2 current pipeline rows into separate projects. Gaps between a DA's completed phases and its current phase permits therefore cross `project_id`s and are lost.
    - PR's `sources` lists only records that "set a date, a number, the pathway or the label", so a DVA child is not guaranteed to appear.
- **Fix:**
  - In SC §4.7a, use PR's column names: `prx_case_no`, `dva_record_id`, `da`; drop `permit_type` and `case_no`.
  - Group permits by DA key, `coalesce(prx_case_no, dva_record_id, da)`, read directly from `permits.parquet`, not by history `project_id`.
  - Keep "≥ 2 qualifying permits per `project_id`" only for rung 2.

**N2. [should-fix] PM still says multi-phase rows are never massed and their card shows `none`. That contradicts TS for phase sub-projects**
- **Location:** PM §1 Out of scope ("`multiPhase` rows are never massed: their card shows massing `none`"), §4.4 last bullet list ("`'none'` when the result is `null` or the project is `multiPhase`"), §4.7 ("`multiPhase` rows cost nothing"), §5 DA phasing. Compare TS §4.8 (phases are massed with `generateForUnits`) and TS §4.9 (a phase uses the pipeline rule).
- **Problem:**
  - Phase Schedules carry `multiPhase: true` (TS §4.4.3a). PM's mapping therefore gives every phase `none`, while TS gives `matched` or `approximate`.
  - This is pass-1 #5's double ownership, now with a real contradiction.
- **Fix:**
  - Delete PM's card-flag mapping and point to TS §4.9.
  - Reword PM to "unphased multi-phase rows are not massed; phase sub-projects are massed like any pipeline project (TS §4.8)".
  - Update the §4.7 perf note: phases add massing calls, roughly one per phase revision in loaded cells.

**N3. [should-fix] The twin's pipeline revision-unit difference is resolved in the design, but TS still lists it as open and FM never discloses it**
- **Location:**
  - design round-3 addendum ("sim R3 … It is excluded from the `planEffect.*New` series … The sources dialog states this");
  - design T9 row ("in-flight projects get identical schedules in both runs");
  - TS §2 "Still open (round 3): R3" vs TS §8 "None remain";
  - FM §4.10 section 8.
- **Problem:**
  - T9 promises identical schedules. The addendum says revision units can differ.
  - TS contradicts itself: §2 lists R3 as open, §8 says nothing is open.
  - FM's dialog doesn't state the disclosure the design requires.
- **Fix:**
  - Amend T9 to "identical stage timing, exits and ends". Re-copy the row to every spec that carries it.
  - In TS, mark R3 resolved by the addendum.
  - Add a sentence to FM §4.10 section 8. Suggested: "Under the old zoning a real project's resize is capped by the old height limit, so its size can differ between the two runs. That difference is a real effect of the plan, but it appears only in 'from today's pipeline', not in 'what the plan added', so that the published estimates compare like with like."

**N4. [should-fix] FM still treats the phasing summary as missing (R4 open), although T8 now carries `phasing`**
- **Location:** FM §4.5 item 13, §4.10 section 9, "Still open R4", §6 fixture `timeline-score.ts`; T8 `phasing`; TS §4.5 `phasing` table.
- **Problem:**
  - FM recommends a shape (`scheduled`, `estimated`, `unenriched: {id, label}`, `provenance`) that differs from the adopted row (`masters`, `enrichedMasters`, `phasesScheduled`, `phasesEstimated`, `unenriched: {projectId, label, units}`).
  - FM keeps "omitted when unavailable" branches for a field that is always present.
  - FM's score fixture has no `phasing`.
- **Fix:**
  - Bind the footnote and dialog to `score.phasing.phasesScheduled`, `.phasesEstimated` and `.unenriched`. Show the line only when `masters > 0`.
  - Move R4 to "Resolved by round 3".
  - Add `phasing` to the fixture.

**N5. [should-fix] Step 0 still misses two type homes** (residual of pass-1 #2)
- **Location:** design "Dependency order" step 0; T7 (`setTimelineLookups(l: { chance: ReturnType<typeof chanceTable>; … })`); SC §1 step 0 (`time.ts`, `math.ts`, `types.ts` only); TS §1 `types.ts` (`SimInput` needs `InFlightProject`).
- **Problem:**
  - TR's step-0 `src/lib/map/types.ts` needs `typeof chanceTable` and `typeof typicalMonths`, but `model.ts` is not in step 0.
  - No spec names the TS module that exports T3 `InFlightProject` and the `projects.json` file type. PR's `ProjectsFile` is pipeline-internal. TS's step-0 `SimInput` cannot compile without it.
- **Fix:**
  - SC step 0 lands `model.ts` with signatures throwing `'not implemented'`, as SD does for the codec, or exports named `ChanceTable` and `TypicalMonths` types from `types.ts`.
  - Name a step-0 home for the T3 types, e.g. SC `src/lib/timelapse/types.ts`, beside T4d, or a PR-owned `src/lib/timelapse/projects.ts`. Add it to the design's step-0 list.

**N6. [should-fix] The design and four specs still say DA phasing is out of scope**
- **Location:**
  - design "Out of scope" ("Development Agreement phasing schedules … R10 enrichment is deferred") and Traceability row `pipeline-overlay` ("R10 enrichment deferred");
  - PR §1 Out ("DA phase schedules"), against PR §4.10;
  - SC §1 Out of scope and §5 ("`multiPhase` histories run through the ordinary tables … Nothing else is done now"), against SC §4.7a `phaseGap`;
  - TS §1 "Not in this package: DA phasing", against TS §4.4.3a;
  - PM §1/§5 (see N2).
- **Problem:** The source of truth contradicts round 3. Implementers reading scope sections will under-build.
- **Fix:** Replace the design's Out-of-scope bullet with "R10 renderings and footprints remain out of scope; DA phasing is in scope per Partner rulings round 3". Update each spec's scope and seams lines to match.

**N7. [should-fix] The superseded window ruling is not marked superseded**
- **Location:**
  - design reconciliation "Fitting window and populations" ("W = 2015-01-01 for all stages … Permit stages are not pooled further back");
  - design `stage-calibration` paragraph ("Initiation is fitted over all available parcel-years with no calendar-year term") vs the round-3 addendum's per-era basis term;
  - SD §4.6 ("The fitting window is stage-calibration's: W = 2015-01-01").
- **Problem:** Three places still state the old rule. The Multi-phase bullet got a "*Superseded by …*" marker, but this ruling did not.
- **Fix:**
  - Mark the reconciliation bullet "*Superseded by Partner rulings round 3 (History window)*".
  - Add "(a measurement-basis term, not a calendar-year term; see round-3 addenda)" to the subsystem paragraph.
  - In SD, reword to "The fitting windows are stage-calibration's (§4.4); initiation uses every roll year from 2007".

**N8. [should-fix] Phases that share a parcel are drawn on top of each other**
- **Location:**
  - PR §4.10.2 fallback ("phases share parcels when k > P"; enriched: "a phase left with no parcels takes the tracking parcel");
  - PR §4.10.3 ("Phase parcels are disjoint from other in-flight projects (V24), so no parcel draws twice");
  - TS §4.8 (each phase massed on its own parcels);
  - fixture M14 (3 phases, all on lot 009).
- **Problem:**
  - Phases of one master that share a parcel each get a full-parcel massing. They overlap in space whenever their timelines overlap, e.g. phase 2's ghost inside phase 1's completed solid.
  - PR's "no parcel draws twice" is false within a master.
  - TS and TR define no rule for this, and the M14 e2e fixture exercises it.
- **Fix (orchestrator DC):** pick one of these:
  - (a) cap k at P and put the extra units into the existing phases (simplest, and keeps "each phase is its own lot");
  - (b) mass shared-parcel phases at a 1/m footprint scale;
  - (c) accept the overlap and disclose it.

  Then correct PR §4.10.3's claim and update M14's expected value.

**N9. [should-fix] The historical replay can fail by construction on the permit-side stages**
- **Location:** TS §6 `simulate-replay.test.ts` (2015+ histories, pass at max |Δ| ≤ max(0.03, 2.5·SE)) vs SC §4.5 (permit-side tables are θ-scaled pooled tables; the build only **warns** when they differ from the pathway's own 2015+ AJ by > 0.05).
- **Problem:** A permit-side table may legitimately differ from 2015+ incidence by up to 0.05 or more under the proportional-hazards model. The replay then fails while the calibration is working as designed. This would be a false failure against the partner's "if 10% die at step z" check.
- **Fix:** Use one of these:
  - replay permit-side stages against their own pooled windows (`Wₛ` onward, pathway pooled);
  - or set the replay tolerance per cell to max(0.03, 2.5·SE, SC's reported PH-diagnostic difference);
  - or restrict the strict test to Planning-side stages and to pathway-pooled permit-side checks.

**N10. [should-fix] Phase-related proxies are not disclosed where TS says they are**
- **Location:** TS §4.4.3a ("Using a successive-phase gap for the first phase's delay after entitlement is a tier-2 proxy … stated in the sources dialog") and TS §4.9 (pre-`permitFiled` stages on a phase card are "master context, e.g. 'Master plan entitled 2010'") vs FM §4.10 section 9 and FM §4.8 Timeline.
- **Problem:**
  - FM's dialog lists `phaseGap` as "start gaps" only. It doesn't say the first phase's delay after entitlement uses the same gap list as a proxy.
  - FM's card timeline renders the master's stage rows as if they were the phase's own ("Planning approval · … · Recorded").
- **Fix:**
  - Add the first-phase proxy sentence to FM §4.10 section 9.
  - In FM §4.8, label stage rows before `permitFiled` on a phase card as master context, e.g. "Master plan approved · 2010 · Recorded".

### Nits

- **N11.** TS §1 "Not in this package: DA phasing" is folded into N6. TS §8 "None remain" is folded into N3.
- **N12.** PR's "Round 3 note: the PRX count in the design (22) …" is stale: the design now says 21. Delete the note or reword it.
- **N13.** SC §4.6: the `basis` nuisance column is set by the parcel-month's calendar era (before 2015), but each event's basis is set per history (F < 2015). A permit-basis event whose permit falls in 2015 or later gets basis 0. Make the column follow the event's basis, or state that the mismatch is accepted.
- **N14.** SD §8 still says "the five non-R-4 `//` strings: non-Local-Program". It should say four, plus the `-R4` typo string, which is Local Program.
- **N15.** The T8 comment on `entitledNew` says "cumulative units". TS and `planEffect` make it net. Change the comment to "cumulative net units", then re-copy the row.
- **N16.** SD §4.8 says "still inside the 5 MB first-paint rule together with the basemap z12 budget". That omits `projects.json` (≤ 2 MB) and the calibration. The design already relaxed the rule to "no all-chunk load", so cite that instead of the 5 MB claim.
- **N17.** Dependency order: PR (step 1) needs SD's T13 tables and SD's fixture to run its build and goldens. That is an ordering inside step 1. Say "PR integrates after SD's panel lands", or move PR's goldens to after SD.
- **N18.** PM IC-2 (refresh the I9 row with `composition`/`role`/`tone`) has been open for two rounds with no owner. Assign it or close it as doc debt.
- **N19.** The `multiphase.json` `label` (curated, e.g. "Candlestick Point / Hunters Point Shipyard Phase 2") is not used for the T3 `label` or the phase card. Consider preferring it over `nameaddr` for PRX rows, so "Phase 3 of 12, Candlestick Point" is reliable.

### Contradictions, coverage, ownership, placeholders, delegation, tiers (check 3 summary)

- **Contradictions:** N1, N2, N3, N6, N7, N8 (PR's "no parcel draws twice"), N9.
- **Double ownership:** the card `massing` rule (PM + TS, N2). Everything else has one owner.
- **Coverage gaps:**
  - step-0 type homes (N5);
  - the twin disclosure in the dialog (N3);
  - phase overlap rendering (N8);
  - the first-phase proxy disclosure (N10).
- **Placeholders:**
  - PR §4.10.1 curation is an implementation task gated by AC-11, with seeding research. Acceptable as data curation, with Candlestick, Treasure Island and Parkmerced required.
  - SD unverified NCD caps default to null and are listed (partner-accepted).
  - No others.
- **Delegation:**
  - SC's "its names win" (N1) defers a decision that can be made now.
  - FM R4 (N4) and TS R3 (N3) are stale open items, already decided.
- **Evidence tiers:** these are labelled correctly:
  - `PHASE_MIN_UNITS`/`PHASE_MIN_GAPS` (4);
  - the `phaseGap` ladder (2/2/4);
  - fallback phase size (0→2, 2);
  - the multiphase scale bound (4);
  - `PH_PRIOR` (4);
  - initiation detection (2);
  - the first-phase delay (2);
  - the `[730]` last resort (4).

  No tier-3 or tier-4 number is presented as data.

---

## 3. Partner-intent fidelity (check 4)

| item | status |
|---|---|
| "realistic timeframe" | carried; improved by phase-by-phase simulation |
| "ghost from the permit phase onward … health bar" | carried (OD-T1/T2); phases appear at their own `permitFiled` |
| "how many projects don't make it and in which stage … 10% at z" | carried (V27, incidence specs, purge censoring); N9 risks a false failure in the replay check |
| "change size before construction" | carried; two revision points (`permitFiled`, `permitIssued`), unchanged since pass 1 |
| "tie to actual records … down to models" | carried (T3 sources, curated `multiphase.json` with per-fact citations) |
| "simulate changing policies" | carried; `baseZoning` is the first real `PolicyOp` through `applyPolicies` |
| OD-T1 ghost at first data | carried |
| OD-T2 option A (bar colour = chance; floors bottom-up; red, then fade; tint below street zoom) | carried |
| OD-T3 longest window across the majority of stages | carried as refined in round 3 (SC §4.4/§4.5/§4.6); stale text N7 |
| OD-T4 2050, RHNA and 2045 markers, both estimates as reference lines | carried; references now compare with `planEffect` |
| OD-T5 pipeline projects can die | carried, phases included |
| Round 3: plan-effect twin | carried; disclosure gap N3 |
| Round 3: phase by phase, tiered phase data, last-resort disclosure, scheduled vs estimated counts | carried; gaps N1, N2, N4, N8, N10 |
| Round 3: refined history window | carried (SC); stale text N7 |
| Round 3: other answers (`localProgram`, `bandRunsTotal`, caps checked against the mirror with re-verification as an AC, unverified districts left uncapped and listed) | carried |

---

## Verdict

**Not ready for handoff yet, but close.** There are no blockers. Everything pass 1 raised is fixed or accepted except three partial fixes: #2 (now N5), #5 (now N2) and #28 (PM IC-2, a doc nit, N18).
- The 10 should-fix items are mechanical document edits.
- One item, N8 (shared-parcel phases), needs an orchestrator DC choice.
- None needs a new partner ruling.
- After N1–N10 are applied, the package is ready for handoff. The nits can ride along.
