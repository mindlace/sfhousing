# Fidelity re-check: step-engine package after the amendments

Reviewer: fresh eyes, no prior context. Date: 2026-11-13. Read-only except this file.

Abbreviations: **D** = design `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md`; specs by subsystem name (`world-core`, `world-funding`, `policy-timeline`, `ensemble-runner`, `world-score`, `map-stream`, `timeline-ui`), all `docs/superpowers/specs/2026-11-13-*-design.md`. "wc r6" = world-core rule 6; "D:262" = design line 262.

Severity: **blocker** (a team would build the wrong thing or could not build), **should-fix**, **note**.

Summary

| Leg | Blocker | Should-fix | Note |
| --- | --- | --- | --- |
| A (63 blocker/should-fix findings re-judged: 60 closed, 3 partly, 0 open) | 0 | 3 (A-L2-2, A-G14, A-F4) | 32 earlier notes, all closed |
| B Shared names | 0 | 0 | 6 |
| C New contradictions | 0 | 7 | 10 |
| D Future reads | 0 | 0 | 4 |

---

## Leg A: earlier findings

### A.1 Partly closed (should-fix)

**A-L2-2 (should-fix, partly closed). Pool indices and money-edit refills.** The index half is closed: S1 (D:249) names pools and programmes by id between steps; T11 (D:209); world-funding line 33 and r17 re-make waiting applications. The refill half is not: policy-timeline r15 makes `FinanceFrame.pools`/`programmes` "the union over the whole document", and r16 puts "the same `offered`, programme definitions, pool definitions other than their inflows" in a frame's identity. Adding or removing a `fund` policy dated month m (or changing a programme's definition in a later span) changes the union, so every frame from month 1 gets a new id and `firstDifference` returns 1: a full refill. That contradicts D 3.7 (D:141, "Everything before that month is unchanged ... resumes from that month") and policy-timeline's own test (line 99, "an edit of it dated month m gives the same frame ids for every month before m"). T11 covers only arrivals. *Fix:* in policy-timeline r16, make a frame's identity cover only the pools and programmes in force that month (by id), with `offered` keyed by id; or record in T11 and the line-99 test that adding or removing a money policy refills from month 1.

**A-G14 (should-fix, partly closed). Ids across a schema 4 document.** policy-timeline r3 and r5 add document-wide uniqueness, union limits and `MAX_PLAN_BYTES`, as asked. But a `fund` policy with two spans carries a whole `what` (`{ pool, programmes }`) per span (S10; the table at policy-timeline line 44), so the same added pool and programme ids appear in each span. Read literally, r3 forbids a multi-span fund policy (the case timeline-ui r6 draws, "$500M"); read loosely, r15's union holds two definitions under one id, which S1 and `FundedStart.programmes` (ids) cannot tell apart. *Fix:* policy-timeline r3: ids are unique across policies; within one policy, spans repeat the same pool and programme ids, and r15's union holds one entry per id (the definition in force that month is the frame's).

**A-F4 (should-fix, partly closed). Failure states.** timeline-ui r30-r36 now list every state, its copy, Retry and the card; ensemble-runner r12 and r21 match. Remaining conflict: timeline-ui r25 makes Play unavailable after an edit "until `filledThrough === lastIndex`", and r35 says after an error "Play stays available inside the filled part". ensemble-runner r21 stops filling after a `'timeline'` error, so an error during a refill leaves r25 holding Play off for good, which was the original concern. *Fix:* timeline-ui r25: "... unless an `error` has stopped filling (r35), when Play is available inside the filled part."

### A.2 Closed (blocker and should-fix findings)

fidelity-specs.md

| Id | Where closed |
| --- | --- |
| L1-1 | D 3.4 (D:105); policy-timeline r8; timeline-ui r7 |
| L1-2 | ensemble-runner line 40 (`WORLDS`, `WINDOW_MONTHS`); S14 `openTimeline`; ensemble-runner r22 |
| L1-3 | policy-timeline line 88; timeline-ui r40 (four parts named) |
| L2-1 | T12; S13 `comparisonOf` returns `{ doc, base }`; `compileTimeline(..., base)`; policy-timeline r18, r22; ensemble-runner r3. Checked `twinInput(base, ctx, compare)` at `levers/apply.ts:91` |
| L2-3 | T13; S17 (`demolish` after revision 0, `restore`); map-stream r8 and its tests. Checked the guard it replaces at `map/timeline-controller.ts:191-194` and `TimelineUpdate` at `map/types.ts:60-67` (neither hashed) |
| L2-4 | T10; S2, S11 take the timeline; world-core r6, r7; world-funding r4 |
| L2-5 | S12 `FundedStart.pathway`; world-funding r11; world-core r17. Checked `funded.ts:1741-1745` |
| L2-6 | T15; policy-timeline r6; round-trip test includes a pre-asOf scale |
| L2-7 | S14 `compiled.statics`; S15 `scoreStaticsOf`; timeline-ui r29 |
| L2-8 | world-core r15. Checked `engine.ts:509-523` (`sampleAdvance` on `STAGE_TIME`, scale applied, `STAGE` unread) |
| L2-9 | S4 (product clamped); world-core r11; policy-timeline r13 and round-trip test. Checked `scaleTable` (`levers/timers.ts:37-50`). See C-18 for an edge |
| L2-10 | S6 `readyThrough`; S13; policy-timeline r19 |
| L2-11 | S13 `lots`, `progress()`, `capacity()`; T14; policy-timeline r23 |
| L2-12 | T12; policy-timeline r9, r22 and test |
| L2-13 | S12 (`granted`, `lent`, `guaranteed`, ids); world-core r17, r22; world-score r15 |
| L2-14 | world-score r2, r9, r12; S15 `MoneyFeed`. See B-4 for a type fit |
| L2-15 | S14 (`timeline-protocol.ts`, own error codes); ensemble-runner line 18 |
| L2-16 | `ScoreStatics.lastIndex` (world-score line 30); ensemble-runner test; timeline-ui r25, r27 |
| L2-17 | S2 (`frameAt(1)`); S4 (ids across compiles); policy-timeline r17 |
| L3-2 | D:245 and S5 use `ResolvedTerms` (`timelapse/types.ts:292`) |
| L3-3 | S3 `staticsOf`; S12 `createFundingSystem`; S15 `createWorldSeries`, `chunkOf`, `MoneyFeed`; S17 `createMapStream` |
| L3-4 | S15 `data()`, `createWorldSeries(s, from?)`; S16 |
| L3-5 | S17 `createMapStream(deps, windowMonths)`; map-stream r4, r7 |
| L4-2 | world-funding tests (assert, fail on miss); world-core cost (printed, `test:perf`); ensemble-runner `test:perf` |
| L5-1 | S16 "No copy is thinned"; ensemble-runner "Decided here" |
| L5-2 | world-funding line 37 and r5 (model month holding the day) |
| L5-3 | world-funding r20 (`INIT_DAY` day) |
| L5-4 | world-score line 32 (`MoneyRow`, `MoneyView`) |
| L5-5 | T14; S14 (`viewMonth`); ensemble-runner r18; timeline-ui r18 |
| L5-6 | ensemble-runner r12 (filling stops) |
| L6-2 | world-funding line 21 |
| L6-3 | world-score line 18 |

fidelity-engine.md

| Id | Where closed |
| --- | --- |
| G1 | S5 (month 1 holds the dataset date's arrivals); world-funding r12 and test |
| G2 | T17; world-funding r11; test of I1-I6 on world 1's calendar-month series |
| G3 | world-funding r5 and test |
| G4 | world-core r15; world-funding r11; certain-affordable route test |
| G5 | D section 9 (D:278) and every spec |
| G6 | T16; D 11 (D:331) |
| G7 | D section 9 (D:272); world-core test |
| G8 | T18; S16 (60 months, 300 MB); ensemble-runner r4 and `test:perf` |
| G9 | S14 `lookups`; ensemble-runner r19; timeline-ui r20 |
| G10 | ensemble-runner r9 (four a second); map-stream r1 and `bench:map` while streaming |
| G11 | S4; world-core r11 and referee with `speedNew` |
| G12 | T15; policy-timeline r6 |
| G13 | policy-timeline "Reconciling" (`reconcilePolicy4`) and test |
| G15 | world-funding tests (bench funding set; 200 random finances) |

fidelity-page.md

| Id | Where closed |
| --- | --- |
| F1 | T13; S17; map-stream r8 and the real-controller test |
| F2 | S14 `lookups`; S13 `lookupsAt`; ensemble-runner r19; timeline-ui r20 |
| F3 | S14 (`cells`, `lookups` carry no `rev`; `resyncMap`); ensemble-runner r20, r22 and test; timeline-ui r22. See C-6 |
| F5 | timeline-ui r26 |
| F6 | D 3.6 (D:131); timeline-ui r27 |
| F7 | timeline-ui r4, r26 |
| F8 | timeline-ui r3, r23, r24, r32 |
| F9 | timeline-ui r18, r19; T14 |
| F10 | world-score r2, r12; timeline-ui r38 (`MONEY_SOURCES` row) |
| F11 | timeline-ui r15, r38 |
| F12 | timeline-ui r8; policy-timeline r15 |
| F13 | timeline-ui r21 and test |
| F14 | ensemble-runner r4 and `test:perf` (3 s) |
| F15 | map-stream r2 |

### A.3 Earlier notes with a proposed fix

All closed: L1-4 (world-funding tolerance test prints the T3 count), L1-5 (world-core ESLint test), L1-6 (D:224, D:313), L1-7 (world-core cost test defers to the runner), L2-18 (D:82), L2-19 (D 3.6 says 1.2816; OD-3 keeps the partner's 1.28 as quoted), L2-20 (ensemble-runner renumbered 1-22; map-stream r1 no longer cites "rule 6's batching"), L2-21 (timeline-ui r14 site list), L2-22 (policy-timeline r10), L3-1 (mechanical check below: no unescaped `|` splits a D row), L3-6 (D:245 names `timelapse/types.ts`), L3-7 (world-core r8 cites `engine.ts:901-1005`; map-stream cites `timelapse/encode.ts`; policy-timeline line 19 places `parseTimingSet` in `sim-page/policy.ts`), L4-3 (policy-timeline r1), L5-7 (S10 `queriesOf4`), L6-1 (world-core line 22), L6-4 (policy-timeline line 19); G16 (world-funding r16 and test), G17 (r14 and test), G18 (world-core r2, permutation tests in both), G19 (timeline-ui r10), G20 (timeline-ui r7), G21 (policy-timeline `test:perf`); engine "other observations": frame ids (S4, policy-timeline r17), the yield row (world-core r8), `newerThan` (policy-timeline r12, largest), inflow refills (T11); F16 (map-stream r11, checked `MEMO_CAP = 60_000` at `scenario-host.ts:253`), F17 (timeline-ui r26 keeps "8 of 10", but see C-10), F18 (timeline-ui r38 "this city" row), F19 (S14, ensemble-runner r2), F20 (map-stream `test:perf`), F21 (S12 ids; timeline-ui r21; world-score r14).

---

## Leg B: shared names

Mechanical check: a script extracted D's 17 table rows (S1-S17) and every `**S<n>** (...; owner ...)` paragraph in the specs (37 quoted rows). After replacing `\|` with `|`, all 37 equal D's row byte for byte, with the same mark and owner. No D row has an unescaped `|` that splits its cell.

Every name the brief lists is defined once, in its owner's row or section, with one signature, and every use matches: `createWorld`, `step` (S2); `planDue` (S11); `staticsOf` (S3); `StepCtx` with `timeline`, `frame`, `month`, `startProject(lot, day, funded)`, `displace(row, lot, day, units)` (S12; used in world-core r17, world-funding r11, r20); `FundedStart` (S12; filled by world-funding r11, stored by world-core r17); `createFundingSystem` (S12; ensemble-runner r3); `PolicyFrame.id` interning (S4; policy-timeline r17; world-core r16); `FinanceFrame.arrivals` (S5; policy-timeline r15; world-funding r11, r12); `PolicyTimeline` (S6); `firstDifference` (S6; ensemble-runner r13); `compileTimeline`, `TimelineCompile` (S13; ensemble-runner r3, r11); `comparisonOf`, `lookupsAt` (S13); `queriesOf4` (S10; S14; timeline-ui r16); `reconcilePolicy4`, `upgradePolicy` (policy-timeline body; timeline-ui r40); S14 messages, with `rev` on `openTimeline`, `setPolicy`, `compiling`, `compiled`, `filled`, `refill` and `error` (today's `error` already carries `rev`, `scenario/types.ts:237`), and none on `viewMonth`, `resyncMap`, `cells`, `lookups`; `SeriesChunk`, `MonthRow`, `MoneyRow`, `WorldSeries`, `createWorldSeries`, `chunkOf`, `MoneyFeed`, `scoreStaticsOf`, `viewOf`, `cardAt` (S15); `ScoreStatics`, `TimelineView` (world-score lines 30-32); `MapStream`, `createMapStream`, `TimelineUpdate.restore` (S17; map-stream r8); `WORLDS`, `WINDOW_MONTHS` (ensemble-runner line 40; timeline-ui line 32); copy spacing every 60 months and the 300 MB bound (S16; T18; ensemble-runner r4, r15, `test:perf`). The only "every 12" left is T18's statement of the old tension (D:215) and world-core r20's test cadence for rebuilding the due list, which is not a copy rule.

**B-1 (note).** S4 (an M row) and world-core r11 say `[MIN_SCALE, MAX_SCALE]` "of `levers/timers.ts`". They are defined in `src/lib/sim/levers/types.ts:83-84` and imported by `timers.ts:21`. *Fix:* cite `levers/types.ts`; a naming correction to an M row, so tell the partner.

**B-2 (note).** `FundedStart.f` (S12) is never explained. world-funding r6 records "size, level", and r11 lists "the size" but not `f`. *Fix:* one clause in S12 or world-funding r11: "`f` is the level index the application was priced at (today's `app.f`, passed to `startSimulated` in `funded.ts:1746-1758`)".

**B-3 (note).** `reconcilePolicy4(doc, cal): { doc: SimPolicy4; report: … }` (policy-timeline line 61) leaves `cal`'s type and the report type as an ellipsis, though timeline-ui r40 feeds "today's notices" from it. `upgradePolicy(p, asOf)` needs `asOf`, and policy-timeline r25's reconcile parser runs it on the server for `/api/policies` and `/s/<id>`, where nothing says which `asOf` is used. *Fix:* type the report as `{ timing: ...; funding: ...; upgradedFrom }` from today's report shapes, and say the server upgrades with the `asOf` of the document's `datasetVersion` (or defers upgrading to the page).

**B-4 (note).** `MoneyFeed.finance` is a `FinanceFrame` (S15), but `poolSeries` and `addedBorrowing` take `NonNullable<SimInput['finance']>` (`finance-score.ts:382-386, 468-473`), which has `off` and no `offered` or `arrivals`. Any frame serves, since `pools`/`programmes` are the same in every frame (S5). *Fix:* world-score r9: "passes `{ pools, programmes, off: [], slope, terms }` of any frame to `poolSeries`".

**B-5 (note).** world-funding line 21 lists "`pathwayFrom` and the pricing functions of `src/lib/sim/finance/`"; `pathwayFrom` is in `scenario/engine.ts:910` (exported). *Fix:* name its file.

**B-6 (note).** `ScoreStatics.baseline` is `ProjectsFile['rhnaCompletedNet']` (`{ units, since, byTier?, provenance }`), while `TimelineView.baseline` is `TimelineScore['baseline']` (`{ completedNet, since, provenance }`, `scenario/types.ts:325`); timeline-ui r27 reads `baseline.completedNet`. Consistent only if `viewOf` converts. *Fix:* world-score: "`viewOf` maps `units` to `completedNet` as `score.ts` does today".

---

## Leg C: new contradictions

**C-1 (should-fix). Where a refill starts: the edit's month or the copy's.** S16 (D:264): resume "from the last copy at or before the month before the edit, steps quietly from there to the edit". D 3.7 (D:143): an edit "discards every filled month from the edit's date on". ensemble-runner r14 instead posts `refill` "with the index of the first calendar month not final in that copy" and reposts every month after the copy. With copies every 60 months, the chart re-hatches up to five years before the edit, the stale state (timeline-ui r31) and Play's lock (r25) last longer, and the timeline-ui e2e test ("see the forecast refill from 2031 with months before it unchanged", line 134) fails unless the edit happens to fall on a copy month. *Fix:* ensemble-runner r14: step quietly from the copy to month m - 1 (no `filled`), then post `refill` from the first calendar month not final at month m - 1; months between the copy and the edit are identical and are not withdrawn.

**C-2 (should-fix). When `policyChanged` re-makes applications.** world-core r16 calls system 1 only when `frame.id !== world.frame`. world-funding r17 says `policyChanged` "runs when the frame's `finance` or `view` is a different object from last month's", and line 33 says applications are re-made "whenever the frame's `finance` is a different object (rule 14)". policy-timeline r16 has `frameAt(m)` return each month's own `arrivals`, so the `FinanceFrame` object differs month to month even when the id does not, and the two triggers disagree. Line 33's "rule 14" should be rule 17. *Fix:* world-funding line 33 and r17: "when the frame id differs from `world.frame` (world-core r16); inside it, re-make only if the finance definitions or the view differ"; correct the cross-reference.

**C-3 (should-fix). Money edits and frame identity.** As A-L2-2: policy-timeline r15/r16 against its own line-99 test, D 3.7 and T11. Listed here because the amendment (T11) states the outcome for arrivals only.

**C-4 (should-fix). Multi-span money policies and unique ids.** As A-G14: policy-timeline r3 against S10's per-span `what` and timeline-ui r6.

**C-5 (should-fix). World 1's ledger is not rewound.** ensemble-runner r7 keeps world 1's ledger "for the money series", and S15 `MoneyFeed.ledger` feeds `chunkOf`. S16 and r14 restore worlds and `WorldSeries` data only. After a restore, the ledger still holds the old future's events dated after the copy, and world-score r9 files them by calendar month again, so refilled months count money twice. *Fix:* S16 or ensemble-runner r14: the runner records the ledger's length at each copy and truncates it on restore (or world-score files the ledger inside world 1's `WorldSeries` so `data()` carries it).

**C-6 (should-fix). Merging map updates breaks revision numbers.** map-stream r7 numbers each `flush` result (next revision); ensemble-runner r9 calls `flush` after every slice, then "Updates are merged in the worker and posted as `cells` at most four times a second". Merging two numbered updates leaves a gap that the controller treats as a resync (the very failure F3 fixed), and merging `demolish` with a later `restore` of the same lot is undefined. *Fix:* say who merges and how: either the runner calls `flush` only when it will post (so no merge), or `map-stream` exposes the merge, renumbers, and cancels a `demolish` against a later `restore`.

**C-7 (should-fix). Play after an error.** As A-F4: timeline-ui r25 against r35.

**C-8 (should-fix). Interned views versus the heap bound.** policy-timeline r17 interns frame ids "and zoning views ... for the life of the worker". Each new zoning state is a `ScenarioParcels` table plus `Precompute` over every lot, so a session of edits grows the heap without bound, while S16 promises under 300 MB "over today's loaded dataset" and ensemble-runner r4 stops at the bound. *Fix:* policy-timeline r17: intern ids for the life of the worker but keep views only while a live timeline (plan, comparison, or the compile in progress) refers to them; add a heap check after 20 edits to ensemble-runner's `test:perf`.

**C-9 (note).** ensemble-runner's open test (line 91) expects "`ready`, `compiled`, `lookups`, then `filled`", but r3 posts `lookups` when month 1's frame exists and `compiled` only once the plan compile has finished, while filling has already begun; timeline-ui r29 expects `filled` before `compiled`. *Fix:* the test checks the set and the `filled` contiguity, not that order.

**C-10 (note).** timeline-ui r26 glosses the band as "the 10 to 90 range of the 48 worlds"; world-score r10 and D 3.6 define it as mean ± 1.2816 sd. *Fix:* "(the average ± 1.2816 standard deviations, which matches the 10-90 range within 3%, D section 2)".

**C-11 (note).** ensemble-runner line 40: "nothing else in the package states those numbers", but its own Purpose (48), r4 and tests (96), world-core's cost test (48 worlds, month 480), world-funding r1 (96 worlds) and timeline-ui r26 and r38 (48) state them. *Fix:* "no code outside the client hard-codes them".

**C-12 (note).** S4 says `newCalibration` "serves a project at the moment its route is drawn"; world-core r10 also draws stage outcomes and lengths on it for projects not filed at the dataset date (as `scenario/types.ts:101-108` does today). *Fix:* in world-core r10, say it follows today's `newProjects` rule; S4's wording is incomplete rather than wrong.

**C-13 (note).** D 3.3 system 2 (D:79), "Pool inflows dated this month", predates S5's rule that month 1 also holds the dataset date's arrivals. *Fix:* add "(month 1 also the dataset date's, S5)".

**C-14 (note).** D 3.5 (D:117) makes "which limit binds" "a quantity as of a month"; world-score r12 fixes `limits` once, from every arrival in the window, the same at every `filledThrough` (and its test asserts that). *Fix:* D:117: "what is owed as of a month; limit statements over the window's inflows".

**C-15 (note).** D 11 (D:301) says every blocker and should-fix "was resolved"; A-L2-2, A-G14 and A-F4 are only partly closed. 5.3 also lists T15 after T18. *Fix:* update the sentence once the three are closed; reorder T15.

**C-16 (note).** S14 posts `lookups` when the playhead enters a frame "whose permitting differs"; ensemble-runner r19 posts them when "calibrations or scales differ". *Fix:* use r19's wording in S14 or the reverse; this is a D row.

**C-17 (note).** world-core r7 replans every free lot when `touched(m)` is null or `market` differs. By r6 each replan reads the frames since the lot became free: about 140,000 lots × 96 worlds in one unit. ensemble-runner r5 measures "a month in which the policy changes", but only a zoning change is named in policy-timeline's first task. *Fix:* ensemble-runner r4 also measures a market change and a null-`touched` change on the live city.

**C-18 (note).** policy-timeline r13 clamps `speed` per route and stage, and the step clamps the product again (S4). Today `scaleTable(edits, 'new')` (`timers.ts:37-50`) clamps the product once, so an `all` factor below `MIN_SCALE` paired with a `new` factor above 1 differs (for example 0.04 × 2: today 0.08, new 0.1). policy-timeline's round-trip test would catch it only with such a case. *Fix:* keep `speed` unclamped in the frame and clamp only the product, with `speed` alone clamped for rows in flight; or record the difference.

---

## Leg D: reads of a later month (T10)

No rule makes the step, or anything it calls, read a frame later than the month being stepped. Checked: world-core r5-r7 (lot-months take the frame of the month holding their first day; past frames, then the current one continuing); r11-r12 (speed changes applied on the first day of the changed month); world-core r19 (asserts `readyThrough() >= world.month + 1`); S11 `planDue` (reads up to `world.month + 1`, plans to `through` with that frame continuing); world-funding r4 (funded totals), r5 (`planLot`), r7 (key day: "evaluated when it applies", current frame continuing), r11 (award day: this month's money only), r19 (replans on change), r20 (shadow: re-evaluated each month on the frame then in force); S5 `offered` and `arrivals` (this month's only); policy-timeline r13 (`speedNew` entries exist only while their span is in force, so `from` is never later than the month).

**D-1 (note).** `createWorld` makes month 0 "under `timeline.frameAt(1)`" (S2). Month 1 is the month about to be stepped, which matches S11's "up to `world.month + 1`" and is not a future read. Section 9's wording ("the month being stepped and earlier months") covers it only if month 1 counts as being stepped at creation. *Fix:* S2: "month 1 is the frame of the first step".

**D-2 (note).** Compile-ahead (ensemble-runner r11), `capacity()` (S13, T14: last month of the window) and `scoreStaticsOf`'s limit statements (world-score r12: every arrival in the window) read the whole window. All three are outside the step, in the compiler and the scorer, and feed only page figures, so T10 is not broken. They are the page reading its window, as D 3.5 intends.

**D-3 (note).** world-funding r5's "spell spent" is decided by the bundle in the lot-month where the total passes. The rule should say this is judged on the frame of that lot-month once it is reached (rebuilt from past frames by r4), not on the projection made when the lot was planned. Otherwise a programme opening between planning and the crossing would wrongly find the spell already spent. As written, r19's replan and r4's history give the right answer. *Fix:* add "judged on the frame of that lot-month, never on a projection" to r5.

**D-4 (note).** The world-funding key day (r7) and the shadow (r20) extend the current frame forward to find a day. This is R1's "policy in force continuing" (D 3.5), not a read of a later frame. The key day is then fixed even if a later frame would have moved the ordinary crossing; that is the design's intent (D:113, "fixed when it applies").

---

## Appendix

**Read in full:** the three earlier reports (`fidelity-specs.md`, `fidelity-engine.md`, `fidelity-page.md`); D; all seven specs.

**Checked by script:** the byte-for-byte comparison of the 37 quoted S rows against D's table, and the cell split of D's rows (script in the session scratchpad); grep of every Leg B name across the eight documents; export status of the cited functions and constants (`pathwayFrom`, `NEVER_KEY_DAY`, `lineKey`, `MIN_SCALE`/`MAX_SCALE`, `scaleTable`, `isOffered`, `inflowArrivals`, `marketLevel`, `routeSharesOp`, `leverCapacity`, `lookupsOf`, `Lookups`/`LeverLookups`, `tiersOf`, `twinInput`, `FINANCE_LIMITS`, `MAX_PLAN_BYTES`, `queryKey`, `resolvePreset`, `buildFinance`, `parseFinanceLevers`, `reconcileFunding`, `reconcileTiming`, `poolSeries`, `addedBorrowing`, `limitStatements`, `baseZoning`, `ResolvedTerms`, `ProjectKind`, `LayerCtx`, `BrushQuery`, `MarketStep`).

**Read in part:** `src/lib/sim/levers/timers.ts` 1-60; `src/lib/sim/scenario/engine.ts` 500-530; `funded.ts` 1730-1770; `src/lib/map/types.ts` 55-75; `src/lib/map/timeline-controller.ts` 185-198; `src/lib/sim/scenario/types.ts` 95-141, 237, 325; `src/lib/sim/levers/apply.ts` 120-162; `src/lib/sim-page/policy.ts` 560-580; `src/lib/sim-page/timing.ts` 175-190 and a grep; `src/lib/sim/scenario/finance-score.ts` 378-392, 466-476; greps for `TimelineUpdate` in hashed folders, `sfhousing:sim` keys, `MEMO_CAP`, `rhnaCompletedNet`.

**Not examined:** the ledger, the mockups, the spike code; the fifteen source documents behind the earlier reports (their findings were taken as stated); `scenario-host.ts` beyond `MEMO_CAP`; `SimPage.svelte` and the other UI files cited by timeline-ui r14 and r38 (line numbers not re-checked); `docs/dev/*`.
