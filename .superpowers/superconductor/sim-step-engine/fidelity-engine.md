# Fidelity review: the step-engine package against the old engine documents (engine share)

Reviewer: fresh-eyes fidelity reviewer, 2026-11-13. Read-only on the repository except this file.

Scope: every clause of `scratch/source-clauses.md` whose topic is draws, starts, stages, timing, money, line, pools, determinism, levers, data or perf: **596 clauses** (C2 to C1055). The other topics (page, score, map, protocol, comparison, band, other) belong to the other reviewer.

The package read: design `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md` and the seven specs `docs/superpowers/specs/2026-11-13-{world-core,world-funding,policy-timeline,ensemble-runner,world-score,map-stream,timeline-ui}-design.md`, all in full. For every GAP below the original sentence was read at its cited `file:line` in the old document; where the finding depends on today's code, the code was read too (cited).

Classes (as briefed): **untouched** (a: constrains something the package does not touch), **referee** (b: a without-money model rule the exact referee of world-core enforces, and no new spec states a different rule), **carried** (restated, or cited by file:line, in the new package), **changed** / **dropped** (on purpose, with a citation), **GAP**.

## 1. Counts per class per source document

| # | source | untouched | referee | carried | changed | dropped | GAP | total |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-16-1903-fzp-timelapse.md | 52 | 35 | 10 | 0 | 1 | 2 | 100 |
| 2 | 2026-11-09-1911-sim-financing.md | 50 | 1 | 57 | 5 | 1 | 8 | 122 |
| 3 | 2026-10-16-fzp-mode-design.md | 0 | 0 | 3 | 2 | 0 | 0 | 5 |
| 4 | 2026-10-16-stage-calibration-design.md | 75 | 8 | 6 | 0 | 0 | 2 | 91 |
| 5 | 2026-10-16-timelapse-render-design.md | 9 | 1 | 0 | 0 | 0 | 2 | 12 |
| 6 | 2026-10-16-timelapse-sim-design.md | 8 | 28 | 4 | 3 | 0 | 3 | 46 |
| 7 | 2026-10-28-sim-policy-levers-design.md | 16 | 0 | 10 | 2 | 0 | 1 | 29 |
| 8 | 2026-10-31-sim-runs-design.md | 6 | 0 | 8 | 2 | 0 | 0 | 16 |
| 9 | 2026-11-09-finance-engine-design.md | 6 | 0 | 37 | 10 | 1 | 11 | 65 |
| 10 | 2026-11-09-finance-levers-design.md | 25 | 0 | 1 | 4 | 0 | 5 | 35 |
| 11 | 2026-11-09-finance-score-design.md | 2 | 0 | 1 | 2 | 0 | 1 | 6 |
| 12 | 2026-11-09-funding-ui-design.md | 0 | 0 | 4 | 1 | 0 | 2 | 7 |
| 13 | 2026-11-09-market-baseline-design.md | 32 | 4 | 3 | 0 | 0 | 0 | 39 |
| 14 | 2026-11-10-paired-draw-fix-design.md | 3 | 9 | 6 | 0 | 0 | 0 | 18 |
| 15 | 2026-11-10-run-slider-design.md | 1 | 0 | 0 | 0 | 3 | 1 | 5 |
| | **total** | **285** | **86** | **150** | **31** | **6** | **38** | **596** |

The 38 GAP clause ids group into **21 findings**: **2 blockers, 13 should-fix, 6 notes** (section 4).

How "carried" was judged for the funding rules: world-funding imports `awardSet`, `awardPasses`, `asksOf`, `available`, `coverageLevel`, `below`, `inflowArrivals`, the finance pricing functions and `lineKey`, and cites `funded.ts`/`money.ts` lines for `segValue`, `remake`, `respell`, `fundingOf`, `take`/`startSimulated`. A finance-engine rule implemented inside one of those imported functions, or inside a cited line range, was counted as carried. A rule that lived in the day loop (`fundedPass`), which the package rewrites, had to be restated or changed on purpose; most were (rules 4 to 17), and the ones that were not are the funding GAPs below.

## 2. Changed on purpose (31)

| Clause | Old rule (short) | Citation in the new package |
|---|---|---|
| C216 | line served in order of application day, ties by the lot's draw | R5; world-funding rule 8 ("Changed (R5)") |
| C236 | displaced homes counted when the ordinary start fell by the horizon | design 3.5 row 2; world-funding rule 17 ("Changed") |
| C270 | F9 (d): serve on every day a pool changes; key (applied, keyDay, parcel id) | R5; design 11 "Changed by R5"; world-funding rules 6, 8, 9 |
| C293 | `SimPolicy`/`SimDoc` schema 3 | OD-10; policy-timeline rule 21 |
| C297 | F18 funded perf budgets (30/45 ms, 9 s band) | design 9 (9 ms a month); world-funding rule 1 and its cost test |
| C397 | `startScenario` seam; lookups seam in `onready` | S14 (new messages; `lookups?` on `parcelSummary`) |
| C402 | `?seed=` reproducible URL, reroll | OD-4, R6; timeline-ui rule 20 |
| C591 | every future event in `(asOf, horizon]` | R8 (no horizon); world-core test "no event has a day outside the month" keeps the lower bound |
| C619 | `simulateNet` equals `score(simulateDetailed)` | design 11 "Replaced"; world-score rule 4 |
| C664 | e2e: reroll and URL seed | R6, OD-4 |
| C684 | `initScenario` gains the lever parameter | S14 |
| C691 | recompute in background, run uses new envelopes only once complete | T7; policy-timeline rules 15-16; ensemble-runner rule 11 |
| C722 | window to `HORIZON` 2066-12-31 | R8, R9 |
| C752 | schema redesign, old documents fail to parse | OD-10; policy-timeline rule 21 |
| C763 | `fundedPass` eager phase, day loop, close | R5 (approach 2); world-funding Purpose |
| C767 | a month's bundle is the bundle of the lot-month's first day | world-funding rule 4 "Changed in form only"; policy-timeline rule 6 (model month's first day) |
| C768 | segments split at every programme/off/regime/market day | design 3.2, 3.5; world-funding rule 4 |
| C777 | line key: applied, keyDay (searched to the horizon), rank, kind | design 3.5 row 1; R5; world-funding rules 6, 8 |
| C778 | eager phase gives exactly today's schedule per attempt | R5 |
| C787 | line served on each day with an inflow, money event, re-pricing or application | R5; world-funding rule 9 |
| C789 | application leaves the line at the horizon | R8; design 3.5 last row |
| C796 | day-loop order; same-day application served before the ordinary start | R5, T3; world-core rule 16 |
| C818 | bench funding fixtures as budget inputs | design 9; world-funding rule 1 |
| C819 | funded bench budgets | design 9; world-funding cost test |
| C843 | schema numbers 2 to 3 | OD-10; policy-timeline rule 21 |
| C844 | `parseSimDoc` strict/reconcile for schemas 2 and 3 | policy-timeline rule 21 |
| C845 | `publishable` writes schema 3 | policy-timeline rule 21 |
| C871 | "typed `terms` are not dated" | design 3.4 (money: "inflows, offers, terms"); policy-timeline document table (`terms` policy with spans) and rule 14 |
| C903 | `owed` includes payments after the horizon | design 3.5 row 5; world-score rule 10 |
| C906 | money cost budget (15 ms on the shown run) | design 9; world-score cost test |
| C932 | dated baseline changes as inline entries | R2, R7; timeline-ui rules 6, 9, 10 |

## 3. Dropped on purpose (6)

| Clause | Old rule (short) | Citation |
|---|---|---|
| C83 | representative seed = median of the band runs (the determinism half is carried by design 9) | R6; design 3.6 |
| C277 | funded starts obey `reservedFrom` (the `regimes` half is carried: `FundedStart.view`, design 3.4) | design 12 last bullet; world-core Scope ("reservations and freed land (out of the package)") |
| C806 | reservations extended to applications | design 12; world-core Scope |
| C1037 | run-slider switch time | R6 |
| C1044 | run-slider recompute cost | R6 |
| C1050 | run-slider fallbacks | R6 |

## 4. GAPs

### Blockers

**G1 (blocker). An inflow dated on the dataset date is never received.** C769, C253.

- Source: `docs/superpowers/specs/2026-11-09-finance-engine-design.md:155`: "Only arrivals with `asOf ≤ day ≤ horizon` are received. An arrival on `asOf` is received on `asOf` (the baseline's first inflow is on `asOf`, `finance-data` section "First inflow on `asOf`")." Also `docs/superpowers/design/2026-11-09-1911-sim-financing.md:205` (F5).
- Today's code: every baseline yearly inflow is `{ kind: 'yearly', from: asOf, … }` (`pipeline/lib/fzp-cal/funding.ts:210`); `Treasury` schedules the asOf arrival and `fundedPass` receives it when the day loop pops `asOf` (`money.ts:62-74`, `funded.ts:1828`).
- New package: world-funding rule 11 receives only arrivals in `firstDay..lastDay` of a stepped month; model month 1 begins on `asOf + 1` (world-core rule 1). `FundingSystem.create` (S12) is not given any receiving duty. So the first year of every baseline City and state pool (about $234M + $150M) never arrives, in every funded world, in every simulation including the default.
- Why blocker: results change in every funded run, nobody decided it, and the tolerance test is told "A miss is reported with its numbers; no rule is changed to meet it" (design 9), so the builder is steered to report the miss rather than fix it.
- Fix: world-funding rule 11: "`create` receives every inflow whose arrival day is `asOf` (today's rule, finance-engine 4.3 'Arrivals'); `moneyIn` receives those in `firstDay..lastDay`." Add a test: the default baseline at month 1 has `received` equal to one year's inflow on every capped baseline pool.

**G2 (blocker). The award day can precede the money that paid for it, so the money series breaks I4 per calendar month.** C770, C897.

- Sources: `finance-engine-design.md:157`: "**The award day** is the day the line serves the application; the project's first stage is entered that day." and :158 "Money days: commit on the award day; …". `docs/superpowers/specs/2026-11-09-finance-score-design.md:199-203`: "**Identities**, asserted on every pool, every month, by the property tests. … I4. For a pool that is not uncapped, the money it has in hand is never negative: `leverage × received − committed − spent − out − lostCredit ≥ 0`". Today an award is dated on or after the inflow or release that made it possible, because the line is served on that day.
- New package: world-funding rule 10 dates an award on the application's `applied` day if it applied this month, else on the month's first day; serving happens after `moneyIn` (system 2) and after releases in system 3, both of which may be dated later in the same month. The commit therefore carries a day earlier than the inflow or release that funded it. Model months do not align with calendar months (world-core rule 1), and world-score rule 10 files world 1's ledger by calendar month "with today's functions (`finance-score.ts`)". When a model month straddles a calendar-month boundary (most do), the earlier calendar month can show the commit without the inflow: I4 negative, I2 and E4 failing on the series. The package states only "The ledger identities E1 to E7 hold after every step" (world-funding rule 13), which is per model month and does not cover the page's per-calendar-month series.
- Why blocker: a guarantee of the money results (money in hand never negative, asserted every month) changes without a decision, and the page would show it.
- Fix: world-funding rule 10: the award day is the latest of (the month's first day, the application's `applied` day, the day of the latest inflow or release received this month by a pool in the awarded set); add a test that I1-I6 hold on world 1's calendar-month money series. Alternatively record a ruling that money series are filed by model month and I1-I6 are asserted per model month.

### Should-fix

**G3. A funded total that passes in a month with an empty bundle: the new rule is ambiguous where today's is explicit.** C775, C267.

- Source: `finance-engine-design.md:188`: "The attempt has an **application of kind κ** on that day when T ≠ 0, the day is on or before the horizon, and the month's bundle is non-empty. A latent start that falls in a month with an empty bundle makes no application: money that is not on offer that month moves nothing." (Code: `funded.ts:855`, `if (T !== 0 && bundles[seg].length > 0)`.)
- New package: world-funding rule 4: "`planLot` returns the first month in which either total passes its threshold while its bundle is not empty". This reads equally as "the crossing month, if its bundle is non-empty, else none" (today) or "the first later month whose bundle is non-empty, the total having passed" (new). Under the second reading, when a programme opens part-way (any dated money policy, rule 16 replans), every lot whose funded total passed while nothing was offered applies at once in the opening month. The statistical referee, run with baseline funding only from `asOf`, cannot see it.
- Fix: world-funding rule 4: "A funded total that passes its threshold in a month whose bundle is empty makes no application for that spell, and the spell is spent: replanning never makes it apply later (finance-engine 4.4, `funded.ts:855`)." Add a test with a programme opening at month m.

**G4. A certain project's stage time and its revisions: world-core states a different rule and only a citation carries today's.** C275, C318, C800, C830, C831.

- Source: `finance-engine-design.md:321`: "A stage entered on day e is left on day `e + floor(x × sampleAdvance(t, drawOn(s, P.STAGE_TIME, STAGE_INDEX[stage])).days)` … The outcome is always `advance`, and `P.STAGE`, the kind draw, is not read. … Revisions are off (rule NONE)." :632: "What the builder does not decide. Which draw a certain project's stage reads, that its timer scale applies, the cap day, and that there is no advance golden." Design ruling, `2026-11-09-1911-sim-financing.md:424`.
- New package: world-core rule 10 states for every project that "a project's outcome and its length at normal speed come from its `STAGE` and `STAGE_TIME` draws (`sampleTransition` …)", rule 13 that "Entering a stage may revise the size", and rule 15 only that a certain project "never drops out", citing `funded.ts:1734-1765` and `startSimulated`. A builder following rules 10 and 13 literally gives a certain project an exit-kind time when its kind draw is an exit, and revisions. Baseline affordable awards are certain (sim-financing :110, the three tiers fully fund a home), so this is on the default path. The `affordableRoutes` pathway for certain affordable projects (`funded.ts:1743-1745`) is likewise carried only by that citation, while rule 8 states the route is drawn "as `simulatedProject` does".
- Fix: world-core rule 15: "A certain project's stage length at normal speed is `sampleAdvance(t, STAGE_TIME draw).days`; `STAGE` is not read; it has no revisions; a certain affordable project not on a Local Program lot draws its route from `newCalibration.affordableRoutes` on `PATHWAY` (finance-engine 4.9)." Port finance-engine test "A certain project keeps its counterpart's stage times" into world-funding.

**G5. The timing-lever guarantee is stated without its money caveat.** C309.

- Source: `2026-11-09-1911-sim-financing.md:300`: "Through money, a timer can still change which applications are awarded and when, because releases and repayments fall on exit and completion days (F9 (g), (h)). That is an effect of the money, not of the sampler."
- New package: design 9 and every spec's global constraints: "A lever that changes only timing never changes any project's outcome, and moves its days in one direction (paired-draw fix, kept)." With the line served once a month, a timer that moves a release across a month boundary changes which lot is awarded, so with public money the constraint as written is false, and a builder could "fix" the funding path to satisfy it.
- Fix: amend the design 9 bullet: "… (paired-draw fix, kept). It holds exactly without public money; with public money a timer can still change which applications are awarded and when, through release and repayment days (sim-financing, 'Deterministic and paired')." world-core's property test already runs without money; say so.

**G6. The new engine is outside the dataset version; nothing records that this drops "the engine is in the dataset version".** C311.

- Source: `2026-11-09-1911-sim-financing.md:302`: "**The engine is in the dataset version.** `src/lib/sim/scenario`, `src/lib/sim/levers`, `src/lib/scoreboard`, `src/lib/timelapse` and `pipeline/` are hashed into the dataset version. … Any change in a hashed path needs a dataset build and upload before signoff".
- New package: T8 puts all new code in `src/lib/sim/world/` and `src/lib/timeline/`, outside the hashed folders, to avoid a dataset build. After Release B the engine that produces `/sim`'s numbers is not in the dataset version, so a later change to it changes `/sim` results for an unchanged `datasetVersion`. T8 is framed as a build-cost call and does not say it gives up this property.
- Fix: either add `src/lib/sim/world` (and the policy compiler) to `PATHS` at Release B, which already follows the dataset-change procedure once (T8), or record a ruling that the step engine is deliberately unhashed and what then pins `/sim` results.

**G7. The determinism lint does not reach the new code, and design 9 bans fewer functions than today.** C60, C415, C416, C570, C595.

- Sources: `2026-10-16-1903-fzp-timelapse.md:117` (T12): "never `Math.exp`/`Math.log`/`Math.pow`/`**`; an ESLint rule over `src/lib/timelapse/**`, `pipeline/lib/fzp-cal/**` and `src/lib/sim/scenario/**` enforces it." `2026-10-16-stage-calibration-design.md:159`: "`Math.exp` and `Math.log` (and `Math.pow`, `Math.log1p`, `Math.expm1` and the `**` operator) never appear on a determinism path." `2026-10-16-timelapse-sim-design.md:330`: "`Math.log`, `Math.exp`, `Math.pow` and `**` are never used anywhere in `src/lib/sim/scenario/`, and the ESLint rule … enforces it."
- New package: design 9: "`exp` and `log` only from `src/lib/timelapse/math.ts` on any path that decides an outcome." It does not name `pow`, `log1p`, `expm1` or `**`, and no spec extends the ESLint rule's `files` to `src/lib/sim/world/**`, where every outcome-deciding path of the new engine lives.
- Fix: design 9 and world-core: "`Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` and `**` are never used under `src/lib/sim/world/`; the determinism ESLint rule's `files` gains `src/lib/sim/world/**` (`eslint.config.js` is not hashed)."

**G8. No memory budget, and the kept copies look large.** C649.

- Source: `2026-10-16-timelapse-sim-design.md:706`: "Worker heap growth with all 256 cells loaded, after 3 rerolls | ≤ 300 MB".
- New package: S16 and ensemble-runner rule 15 keep a `structuredClone` of every world of both ensembles every 12 model months (40 copies × 96 worlds = 3,840) plus each `WorldSeries`. Design 3.1 puts a live world at "a few hundred kilobytes", so the copies alone could reach several hundred MB to over 1 GB. No spec states a heap bound; thinning past month 240 is "left to the builder".
- Fix: ensemble-runner: state a worker heap budget (carry today's 300 MB or set a new one), make the measurement part of its first task (rule 4), and make the copy policy (every 12 months, thinning, or replay from a sparser copy, as design 3.7 allows) depend on it.

**G9. The map's lookups under dated timers have no route.** C138, C555.

- Sources: `2026-10-16-1903-fzp-timelapse.md:364`: "fzp-mode §5 notes the T9 lookups seam: under future levers, the worker posts the lookups." `2026-10-16-timelapse-render-design.md:527`: "the renderer sees only a new `TimelineUpdate` (revision 0) and new lookups. The renderer never reads `Calibration`: its lookups arrive already computed by T12's `chanceTable` and `typicalMonths`." Today `FzpMode.svelte:605-610` gives `SimMap` the worker's posted lever lookups (bar colour, within-stage fill).
- New package: S14 removes `levers` and `timeline`, and carries `lookups` only on a `parcelSummary` answer, for the card. Nothing says which lookups the map's bars use when a permitting policy is in force, or when it changes part-way.
- Fix: S14/ensemble-runner and timeline-ui: post the map lookups (one set per distinct permitting frame, or the frame at the playhead) and state which one `SimMap` holds; S14 is a D row, so this is the orchestrator's change.

**G10. Streamed cell updates and the main thread.** C546.

- Source: `2026-10-16-timelapse-render-design.md:419`: "`buildBars` and the declutter run once, on the last slice of each update, never on `setTime`. At 30,000 projects that is one long task of about 52–56 ms per streamed update … The spec bounds `setTime`, the pump and per-frame JS, not the rebuild, so this is accepted."
- New package: ensemble-runner rule 9 flushes after every slice (about every 45 ms) and posts `cells` for each non-null update, for the whole fill and every refill, while playback may be running. The old limit was accepted for a few streamed updates per run; the new stream makes it continuous. No spec bounds main-thread work per `cells` update or caps their rate; timeline-ui's `bench:map` test runs with the timeline docked, not during a fill.
- Fix: ensemble-runner rule 9: post `cells` at most N times a second (coalescing in the worker), and map-stream's first task (rule 1) measures main-thread time per update on the live city during a fill with playback running.

**G11. Timer floors and clamps on combined `all` and `new` timers.** C679.

- Source: `2026-10-28-sim-policy-levers-design.md:43`: "Durations have physical minimums (stage floors are left to the builder, sourced)." Today the product of a project's timer edits is clamped to `[MIN_SCALE, MAX_SCALE]` per scale table (`levers/timers.ts:37-50`), and presets are raised to the floor (`timing.ts:284`).
- New package: policy-timeline rule 12 floors "the product" of the policies in force, but rule 13 then splits timers into `speed` (`all`) and `speedNew` entries (`new`, each with its own `from`), and S4 multiplies `speed` by every applicable `speedNew[i].scale` at step time. Neither says that the floor and clamp apply to that final product, so two policies (an `all` speed-up and a `new` speed-up) can take a stage below its floor and below `MIN_SCALE`. The world-core referee also never tests a `speedNew` case (only "`speed` not 1"), so today's `newProjects.scale` path has no exact check.
- Fix: S4 or policy-timeline rule 13: "a project's effective scale for a stage (`speed` × every applicable `speedNew`) is clamped to `[MIN_SCALE, MAX_SCALE]` and raised to the stage's floor"; world-core referee: add "with `speedNew` from `asOf + 1` equal to today's `newProjects.scale`".

**G12. Upgrading schema 3: baseline-scale dates break the schema 4 parser.** C860.

- Source: `docs/superpowers/specs/2026-11-09-finance-levers-design.md:247-250`: "Days in a policy are absolute and are never rewritten when the dataset's `asOf` moves. … A scale entry with `from` before `asOf` applies from `asOf` …; an `off` span that starts before `asOf` is in force from `asOf`." Scale entries are on any day (presets use 1 July and 1 January, finance-levers :269-275).
- New package: policy-timeline rule 2 builds a baseline-scales policy whose spans are "the stretches between scale dates" ("their own dates"), but rule 4 rejects any span `from` that is not a model-month start and "a span before the dataset date's next day". A stored `/s` link holding `state-off` (1 July) or a pre-`asOf` entry cannot pass rule 4. Snapping silently would change when a pool goes off. The round-trip test requires equality with today's frames, so the builder hits a contradiction.
- Fix: policy-timeline rule 2: state the conversion (clip to `asOf + 1`; snap a span edge to the model month holding the scale day while `buildFinance` keeps the exact-day inflow scaling), and say whether `offered` then differs from today for the rest of that month. Or exempt baseline-scale spans from rule 4.

**G13. No reconciliation of schema 4 money policies against the dataset.** C294, C850, C859.

- Sources: `2026-11-09-1911-sim-financing.md:215` (F15): "A `baselineScale` entry or a programme naming a baseline pool the page's dataset does not have is dropped on load with a notice." `finance-levers-design.md:186-190`: `applyLevers`/`buildFinance` throw `LeverFormatError` "no baseline pool <id> in this data" and for a programme needing an unsourced term; :236-243: "`reconcileFunding(f, cal)` … never rejects a document …".
- New package: policy-timeline rule 21 runs `upgradePolicy` for schemas 2 and 3, rule 5 parses each `what`, and rule 14 builds money with `buildFinance`. Nothing reconciles a schema 4 document's money policies against the loaded calibration, so a stored schema 4 policy naming a baseline pool or relying on a term that a later dataset lacks makes `compileTimeline` throw, with no notice. timeline-ui keeps "the three notices" but has no schema 4 source for them.
- Fix: policy-timeline: "On load, every money policy's `what` is reconciled as `reconcileFunding` does (drop scales and programmes naming unknown baseline pools or needing unresolved terms, report them); the compiler never sees an unreconciled document."

**G14. Limits, id uniqueness and size across a schema 4 document.** C257, C837, C842.

- Sources: `2026-11-09-1911-sim-financing.md:207` (F7): "Limits: at most 12 added pools, 12 inflows a pool, 24 added programmes and 24 scale entries; ids unique; every `programme.pool` names an added or a baseline pool." `finance-levers-design.md:70` (`FINANCE_LIMITS`); :139: "a policy whose strokes and funding together pass the cap gets the existing `too-large` error and 'Autosave off' path."
- New package: policy-timeline rule 5 checks each `what` alone with `parseFinanceLevers`; rule 3 makes policy ids unique, but nothing makes added pool and programme ids unique across `fund` policies, or bounds the union that rule 14 builds into `FinanceFrame.pools`/`programmes`. Each span carries a whole `what`, so a painted or money policy with several spans duplicates its content, and nothing re-states `MAX_PLAN_BYTES` for schema 4.
- Fix: policy-timeline document rules: `FINANCE_LIMITS` apply to the whole document's union; added pool and programme ids are unique across the document; `MAX_PLAN_BYTES` applies to the canonical schema 4 document, with today's `too-large` path.

**G15. Funding tests cover grants only.** C823, C824.

- Source: `finance-engine-design.md:504`: "**Conservation, per pool, at every event** (property, 200 seeded random finances on the mini city and `tiny-queue`): identities E1 to E7 … hold"; :505-517 (queue cases, certain stage times, `affordableRoutes` within 3 SE, the cascade, a later-opening programme, a pool switched off, the known limit).
- New package: world-funding's tolerance and identity tests run "seeds 1 to 200, bench city, and the live city" with baseline funding, which has grants only and no loans, guarantees, bank leverage or losses on loans. Rule 12 rewrites when every money event is written ("only the moment it is written changes"), so E3, E5 and E7 for loans and guarantees, and the `lossOnExit` paths, are never exercised. The tolerance comparison likewise never sees certain market bundles, loans or a bond stack.
- Fix: world-funding tests: identities after every step on 200 seeded random finances (as today) and on the bench funding set (`bench-bond`, `bench-loan`, `bench-certain`, `bench-afford`); the tolerance comparison also on the bench funding set.

### Notes

**G16 (note). The "known limit" is no longer pinned.** C788. `finance-engine-design.md:246`: "The engine does not look ahead at inflows to retire such a programme … A test pins this behaviour (section 6), so a later change to it is deliberate." world-funding keeps the behaviour implicitly but has no such test. Fix: carry the test.

**G17 (note). "Decisions identical without the ledger sink" is not stated.** C795. `finance-engine-design.md:296`: "with `sink.ledger` absent the engine keeps the pool state but builds no event objects, and its decisions are identical". ensemble-runner rule 7 gives a ledger to world 1 only, so this property is what makes world 1 the same world as seed 1 elsewhere. Fix: state it in world-funding and test that one world stepped with and without `ledger` gives the same events.

**G18 (note). Lot-order independence is neither stated nor tested, and the design and world-core name different within-system keys.** C816. `finance-engine-design.md:424`: "None of these is the order in which lots were visited, or a row index, so permuting the rows of `parcels` (with the same ids) gives the same schedules and the same ledger." Design 3.3 says inside a system the order is "the line's key, then the lot's rank"; world-core rule 2 says "ascending entity order", entity being the row in `Statics.parcelId`. Fix: world-core rule 2 should use `Statics.rank`, or state that rows are in rank order; carry the permutation test into world-funding.

**G19 (note). The coverage figure under dated money: on which day?** C927. `docs/superpowers/specs/2026-11-09-funding-ui-design.md:179` defines `bundleOn(day)` from `baselineScale` and programme dates. timeline-ui keeps "Affordable homes: 62% covered" but does not say which day's bundle it prices once money policies have spans. Fix: timeline-ui: priced with `fundBundle` on the compiled frame at the playhead (or the selected span), never adding shares itself.

**G20 (note). The read-only "Market conditions" row must state the running level from `marketLevel`.** C956. `funding-ui-design.md:389`: "every level-dependent text here takes `marketLevel(cal)`'s result, so the page cannot state a level the engine is not running". timeline-ui rule 7 adds the row without naming its source. Fix: one line in timeline-ui rule 7.

**G21 (note). One signoff test asserts wall-clock time.** C1055. `docs/superpowers/specs/2026-11-10-run-slider-design.md:154-158`: "every test that runs in signoff must pass on a heavily loaded machine. Signoff tests assert behaviour and ordering, never wall-clock time." policy-timeline's tests include "A compile `step(20)` on the bench city never exceeds 50 ms" without placing it in `test:perf` (world-core, ensemble-runner, map-stream and world-score do). Fix: mark it `test:perf`.

### Traceability table (design section 11) against the specs

- "Holds; demolished once; reservations | `world-core`": world-core's Scope says "reservations and freed land (out of the package)", and design 12 agrees. The row should say "reservations: out of scope (section 12)". (Note.)
- "Fully funded projects always advance | `world-funding`": world-funding has no such rule; it is world-core rule 15. Point the row at world-core and see G4. (Note.)
- "Funded latent starts; min-rate rule; certain bundles | `world-funding`": carried by rules 2-4, but see G3.
- "Pool state, ledger events, identities E1 to E7 | `world-funding`": carried (rules 11-13), but see G1, G2 and G15.
- Every other row was checked and is carried by the spec it names.

## 5. Other observations (not counted as GAPs)

- **Frame ids across timelines.** S4 says `id` is equal "exactly when every other field is the same". world-core rule 16 runs the policy system only when `frame.id !== world.frame`. ensemble-runner rule 13 carries worlds on under a newly compiled timeline. If ids are numbered per compile, a new timeline's frame can reuse an old id for different content and the step would skip rule 7's replanning. Say that ids are unique across every timeline a host compiles.
- **Revision caps and the start view.** world-core rule 8 stores "level, homes, stories, existing homes" from the start view, but simulated revisions need that view's yield row (timelapse-sim :456-464: the largest yield and the smallest level with `yield[f] ≥ units'`). The referee "zoning change in mid-run" protects it; listing the yield row in rule 8 would avoid a failing referee.
- **`newerThan` across protection policies.** policy-timeline rule 11 makes a protection "on when any policy in force turns it on" but takes "the smallest `years`", which protects the fewest buildings. A union would take the largest. This is new territory, so it is not a GAP; worth a second look.
- **Inflow edits refill from month 1.** `FinanceFrame.pools` is one union compiled over the whole document, so an edit to an inflow dated 2040 changes the pools object in every frame, and `firstDifference` then returns month 1. That is correct, but it costs a whole refill; the world-funding test "An inflow raised from month m: every event before month m is identical" checks only the engine.
- **The off-pool arrival rule** (finance-engine :156) is not restated in world-funding rule 11. It holds because `buildFinance` already zeroes a capped pool's arrivals in an off span (finance-levers :193). Counted as carried.

## Appendix

**Files read in full:** the design `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md`; the seven specs `docs/superpowers/specs/2026-11-13-{world-core,world-funding,policy-timeline,ensemble-runner,world-score,map-stream,timeline-ui}-design.md`; my share of `.superpowers/superconductor/sim-step-engine/scratch/source-clauses.md` (all 596 rows) and its appendix.

**Read in part (at the cited lines):**
- `docs/superpowers/specs/2026-11-09-finance-engine-design.md`: :155-158, :183-188, :246, :296, :321, :422-426, :502-517, :620-632.
- `docs/superpowers/design/2026-11-09-1911-sim-financing.md`: :205, :207, :215, :300, :302, :424.
- `docs/superpowers/specs/2026-11-09-finance-score-design.md`: :185-204.
- `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`: :117, :364.
- `docs/superpowers/specs/2026-10-16-stage-calibration-design.md`: :155-161.
- `docs/superpowers/specs/2026-10-16-timelapse-render-design.md`: :419, :527.
- `docs/superpowers/specs/2026-10-16-timelapse-sim-design.md`: :40, :330, :700-706.
- `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`: :43.
- `docs/superpowers/specs/2026-11-09-finance-levers-design.md`: :70, :139, :186-190, :236-243, :247-252.
- `docs/superpowers/specs/2026-11-09-funding-ui-design.md`: :179, :389.
- `docs/superpowers/specs/2026-11-10-run-slider-design.md`: :154-158.
- Code: `src/lib/sim/scenario/funded.ts` :262-311, :820-869, :1650-1909; `src/lib/sim/scenario/money.ts` :40-110; `src/lib/sim/scenario/funding.ts` :32-60; `src/lib/sim/scenario/engine.ts` :655-689 and grep of `certain`, `affordableRoutes`, `newScale`/`inFlightScale`; `src/lib/sim/levers/timers.ts` :37-51; `pipeline/lib/fzp-cal/funding.ts` :200-215; grep of `src/lib/fzp/FzpMode.svelte` for lookups.

**Not examined:** the other fourteen old documents outside the lines above (I relied on the checklist's clause text for clauses classified untouched, referee or carried); the old documents' rows in other topics; the ledger (`ledger.md`), the spike code and the mockups; the rest of the old engine's code.

**Clauses I could not classify with confidence:**
- C680 (disapproval-exit exception for a preset): `levers/timers.ts` mentions disapproval, but I did not check whether the exception was built. Classified untouched on the basis that `TimingSet` is parsed and compiled by today's code (policy-timeline rule 5).
- C320 (the open private-level / `minHomes` tension): classified untouched. It is still open, and the package neither resolves nor worsens it.
- C1015 (the paired-draw fix's non-goal "pairing under dated regimes"): classified untouched. The package now makes dated policies central, and world-core rule 12 is the new pairing rule for a timer that changes part-way, but that rule covers speed only, not regimes.
