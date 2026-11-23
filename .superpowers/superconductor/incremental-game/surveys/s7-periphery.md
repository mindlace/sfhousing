# S7 periphery census

Worktree: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game` (branch `worktree-incremental-game`).
Claim marks: V = verified in code/data opened (path:line); I = inferred (source named). Read-only survey; no tests, builds or pipeline run.
Grep counts below are line-level matches unless stated; "occurrences" means `grep -o`.

## 0. Headlines (facts the designers should know first)

1. V. None of `src/lib/{data,map,lesscars}`, `pipeline/`, `scripts/` (except two lines, see 1) imports `sim-sync`, `sim-store`, `sim-log`, `sim-stream`, `members`, `server/sims`, `authz`, `$lib/goal`. The multi-user stack is NOT referenced from the periphery except `scripts/worker-entry.ts` and e2e.
2. V. `src/lib/fzp` is not a page any more. It is the shared library of `/sim`'s Details, card, tooltip, money and provenance. 30+ files in `src/lib/timeline`, `src/lib/sim-page`, `src/lib/about`, `src/lib/scoreboard` import it (section 2c). It imports `$lib/goal/goal` (`src/lib/fzp/chart.ts:6`), `$lib/scoreboard/targets` (`src/lib/fzp/provenance.ts:25`), `$lib/sim/scenario/score` (`provenance.ts:24`, RHNA_DEADLINE), `$lib/sim-page/funding-copy` (`money-view.ts:20`, `provenance.ts:26`), `$lib/sim/finance`, `$lib/sim/scenario/{finance-score,funding,market}`. So the goal and finance are baked into fzp.
3. V. The dataset version hashes `src/lib/{data,generator,timelapse,sim/scenario,sim/levers,sim/finance,scoreboard}`, `src/lib/plan/{geometry,types}.ts` and all of `pipeline/` (`pipeline/lib/version.ts:37-48`). Any change to levers, finance or scoreboard (where `targets.ts` lives) changes the datasetVersion and forces a dataset upload before deploy/signoff. `src/lib/goal` and `src/lib/fzp` are NOT hashed.
4. V. Finance data (pools, programmes, baseline funding, market) ships INSIDE `scenarios/fzp/calibration.json`; there is no `funding.json`/`market.json` in the dataset and no client loader for them (section 11).
5. V. Playwright runs against `wrangler dev` with the real Durable Object (`SIM` binding) and with e2e-only auth seams; 14 of 60 spec files exercise sign-in, invites, members, sockets or `/sims`.
6. V. The Durable Object is wired by `wrangler.jsonc:9-11` (binding, `v1-sim-object` migration, and staging copy) and by `scripts/worker-entry.ts:16` (re-export from `src/lib/server/sim-object/sim-object.ts`). Deploy workflows run `wrangler deploy`, which applies the DO migration implicitly; no workflow step names the DO.

## 1. Cross-reference grep (predicates per directory)

Predicate set: `sim-sync, sim-store, sim-log, sim-stream, members, invites, SimObject, sim-object, server/sims, authz, role, $lib/goal, rhna, funding, pool, FinanceLevers, SimLevers`. Hand-filtered for false positives (e.g. `role` = tile role, `pool` = proportional-hazards "pooled" tables / upload concurrency pool, `members` = cluster members).

### src/lib/data (V)
- No hit for any predicate except a test sentence: `src/lib/data/transit-codec.test.ts:39` ("Object.prototype member"; false positive).
- No import of `$lib/goal`, `sim-*`, `server/*`, `finance`. Only `src/lib/data/gross-table.test.ts:3` imports `$lib/sim/scenario/fixtures/mini-parcels`.
- `funding`/`finance`/`market` words in non-test files: none in `manifest.ts`, `scenario-codec.ts` (the grep for them finds only `calibration` URL entries, `manifest.ts:61,156`, and lesscars codec's "baseline"/"market" meaning the baseline future and the land market, `src/lib/data/lesscars/codec.ts:66,72,92`).

### src/lib/map (V)
- `sim-sync`, `sim-store`, `sim-log`, `sim-stream`, `members`, `invites`, `SimObject`, `sim-object`, `server/sims`, `authz`, `$lib/goal`, `rhna`, `FinanceLevers`, `SimLevers`: no hit (hits for `members`: cluster/stop members, `transit-layer.ts:20,23`, `height/city.ts:169,254`, `fixtures/build-timeline-fixture.ts:125`, false positives).
- `role`: tile-part role `occupied|roof`, `appearance.ts:3,6,8`, `pack.ts:60,61,76` (false positive; not authz).
- `pool`/`funding`: one UI copy line, `src/lib/map/key/copy.ts:9` (`markWhy: 'Your zoning sets its height limit, or your pool funds it.'`). Also `SLOT_FLAG = { zoning: 1, money: 2 }` at `src/lib/map/types.ts:47` (see 12).
- Other-area imports (non-spec): `$lib/timelapse/*`, `$lib/plan*`, `$lib/transit`, `$lib/view/prefs`, `$lib/sim/levers/{source,layers,resolve}` (`types.ts:11`, `height/room.ts:6-7`, `height/lids.ts:16`, `height/limits-style.ts:12`, `height/city.ts:12`), `$lib/sim/scenario/types` (`pack-timed.ts:7`), `$lib/shell/*` (`key/MapKeyControl.svelte:18-19`), `$lib/timeline/Explain.svelte` (`key/test/KeyHost.svelte:3`, test host).

### src/lib/fzp (V) (heavy; per file counts of the broad regex in non-fixture files)
- `FinanceLevers`: only `src/lib/fzp/format.spec.ts:16,120` (`parseFinanceLevers` from `$lib/sim/levers/finance`).
- `$lib/goal`: `src/lib/fzp/chart.ts:6` (`GOAL_BASE`; used at `chart.ts:25`: `total: 'Toward the goal, since ...'`).
- `rhna`/targets: `money-view.ts:35-42` (rewrites "RHNA" labels to "goal"/"State targets"), `provenance.ts:24-25,485-506,605-610` (`RHNA_DEADLINE`, `M1_TARGETS`, "Targets and published estimates" section), `MoneyResults.svelte:197` (caption "Homes by income level against the 2023-2031 targets"), `score-view.ts:42,59-61` (`targets` array; "count toward the goal"), `types.ts:27`.
- `funding`/`pool`: `money-view.ts` (29 hits), `provenance.ts` (17), `card.ts` (8: `CardFunding`, `cardFunding`, `fundingLine`, `card.ts:330-350`), `ProjectCardPanel.svelte` (4; "Funded by" line), `MoneyResults.svelte` (3; `pools` loop `:108`, `uncapped` `:46`), `market-view.ts` (4), `ProvenanceBody.svelte` (2), `ProjectTooltip.svelte` (2). Many spec/fixture hits (`card.spec.ts` 39, `ProjectCardPanel.svelte.spec.ts` 36, `money-view.spec.ts` 31, `TimeScrubber.svelte.spec.ts` 26 (note: that count is almost surely `role="slider"`; I), `provenance.spec.ts` 23, fixtures `timeline-score.ts` 9, `money.ts` 9, `projects.ts` 4, `cards.ts` 3).
- `sim-sync|sim-store|sim-log|sim-stream|members|invites|SimObject|sim-object|server/sims|authz|SimLevers`: no hit.
- Imports of other areas (non-spec): `$lib/sim/{finance,protocol,manifest,scenario/{market,finance-score,funding,score}}`, `$lib/sim-page/{funding-copy,SourceList.svelte}` (`money-view.ts:20`, `provenance.ts:26`, `MoneyResults.svelte:13`), `$lib/timeline/{copy,policy4}` (`ProvenanceBody.svelte:12`, `debug.ts:4`), `$lib/scoreboard/{format,targets,index}`, `$lib/timelapse/*`, `$lib/goal/goal`.

### src/lib/lesscars (V)
- `sim-*`, `members`, `invites`, `SimObject`, `server/sims`, `authz`, `$lib/goal`, `rhna`, `funding` (non-spec), `FinanceLevers`, `SimLevers`: no hit. `pool`/`role` hits are only `map-layers.ts:77` ("by role"; false positive) and aria `role=` attributes.
- Direct imports from the other areas: `$lib/fzp/{high-water.svelte,playback,time,TimeScrubber.svelte,types,format,provenance,load,chart}` (`LessCarsMode.svelte:13-17`, `LessCarsCard.svelte:11`, `TimelineDialog.svelte:9`, `evidence.ts:4`, `load.ts:13`, `timeline-view.ts:6-8`, `summary-view.ts:8-9`), `$lib/sim/client` (`LessCarsMode.svelte:22`), `$lib/sim/lesscars/{playback-client,types}` (`:27-28`, `LessCarsCard.svelte:13`), `$lib/shell/header-actions.svelte` (`LessCarsMode.svelte:21`, `HeadlineBar.svelte:12`), `$lib/map/*`, `$lib/view/prefs`, `$lib/scoreboard/format`, `$lib/timelapse/*`, `$lib/data/lesscars/*`.
- Transitive (I, from imports): `lesscars/evidence.ts:4` -> `fzp/provenance` -> `scoreboard/targets`, `sim-page/funding-copy`, `sim/finance`; `lesscars/summary-view.ts:8` -> `fzp/chart` -> `goal/goal`. So `/lesscars` is not free of the goal/finance code even though it names neither.

### pipeline (V)
- `sim-sync|sim-store|sim-log|sim-stream|members|invites|server/sims|authz|$lib/goal|SimLevers|FinanceLevers`: no hit. (`members` hits are LiDAR/boxes cluster members, e.g. `pipeline/lib/lidar/register.ts`, `pipeline/steps/boxes.ts:204-207`, `pipeline/lib/fzp-cal/report.ts:401`; false positives.)
- `SimObject|sim-object`: no hit in pipeline (the only hits are in scripts, below).
- `rhna` (case-insens.): `pipeline/project-records/rhna.ts` (14; `RHNA_SINCE = 2022-06-30` `:17`, `RHNA_FORMS` `:20`, `rhnaCompletedNet` `:24`), `pipeline/project-records/{derive.ts,assemble.ts,invariants.ts,parse.ts,classify.ts,types.ts}`, `pipeline/config.ts:126,128,206,207,276,277` (`rhnaYearTol`, `rhnaTotalTol`), `pipeline/steps/projects.ts:309` (V22 check), tests `pipeline/test/project-records/rhna.test.ts` (30), fixtures (`mini/golden/report.json` 22).
- `funding`: `pipeline/enrichment/funding.json`, `funding-schema.ts`, `pipeline/lib/fzp-cal/funding.ts` (42), `pipeline/steps/calibration.ts:3,13,148,164,189`, `pipeline/steps/build.ts:43,85-88,202-205,323`, `pipeline/steps/check.ts:27,261-268` (`fundingOutcomes`), tests `pipeline/test/fzp-cal/funding.test.ts` (58), `fallback.test.ts` (49), `enrichment/funding-schema.test.ts` (25), `pipeline/test/fixture-funding.test.ts`.
- `pool`: funding pools = `pipeline/lib/fzp-cal/funding.ts` (imports `Pool, PoolKind, Programme` from `src/lib/timelapse/types`), `pipeline/enrichment/funding-schema.ts`. NON-funding `pool`: `pipeline/lib/fzp-cal/ph-pool.ts` (20; "pooled Aalen-Johansen"), `pipeline/steps/upload.ts:58,238,265` (concurrency pool), `pipeline/test/fzp-cal/ph-pool.test.ts`.
- `role`: `pipeline/lib/quality-rules/*` etc. (SQL/Python "role" words; not examined; I).
- Imports of src: `src/lib/sim/finance/{prototypes,instruments}` (`pipeline/lib/fzp-cal/market.ts:17`, `funding.ts:9-10`, `enrichment/funding-schema.ts:10`), `src/lib/sim/scenario/{input,band,engine,score,types}` (`pipeline/steps/lesscars.ts:48`, `pipeline/lib/lesscars/runs.ts:45-48`), `src/lib/sim/levers/{layers,view}` (`pipeline/lib/lesscars/regimes.ts:41-42`). Non-test imports of `timeline/`, `sim-page/`, `server/` from pipeline: none (the only `src/lib/server` path is `scripts/data-local.ts:13`).

### scripts (V)
- `SimObject`/`sim-object`: `scripts/worker-entry.ts:2,16` (re-exports `SimObject` from `../../src/lib/server/sim-object/sim-object.ts`), `scripts/worker-entry.spec.ts:35,39`.
- `SimLevers`: `scripts/bench-levers.ts:31,121`.
- `members`: `scripts/ensemble-measure.ts` (60; ensemble members = seeds/worlds, false positive).
- `funding`/`money`: `scripts/ensemble-measure.ts` (flag `--no-money`, `:` header), `scripts/measure-policy-compile.ts` (1), `scripts/profile-sim-load.policy.json` (1).
- `sim-page`/`timeline` imports: `scripts/ensemble-measure.ts:47,55-56`, `scripts/measure-policy-compile.ts:25,32-33` (`sim-page/policy`, `timeline/policy4`, `timeline/reconcile4`).
- `/api/policies`: `scripts/profile-sim-load.mjs:3,70,77` (plan-sharing API, not sims).
- `sim-sync|sim-store|sim-log|sim-stream|members(module)|invites|server/sims|authz|$lib/goal|rhna|FinanceLevers`: no hit.

## 2. `/lesscars` and `/fzp` routes

### 2a. Routes (V)
- `src/routes/fzp/+page.ts` (12 lines): universal load that `redirect(307, '/sim?...')` keeping all query params except `start`. No page component; no imports from `src/lib`. Only `@sveltejs/kit`.
- `src/routes/lesscars/+page.ts` (15 lines): `await parent()` for `datasetVersion`, then `loadLessCars(datasetVersion, fetch)` from `$lib/lesscars/load` (`+page.ts:3,13`). Returns `LessCarsRouteData`.
- `src/routes/lesscars/+page.svelte` (36 lines): renders `LessCarsMode` from `$lib/lesscars/LessCarsMode.svelte` (`+page.svelte:5`) when `data.state === 'ready'`; else "no fewer-cars plan" (link to `/sim`) or error + Retry (`invalidateAll`).
- `src/routes/data/[version]/[...path]/+server.ts`: R2 range/immutable-cache data route; imports `dataKey` from `$lib/server/data/key` (`:2`); `+server.ts` + `server.spec.ts` only. No auth, no sim reference.
- Specs: `src/routes/lesscars/page.spec.ts`, `page.svelte.spec.ts`, `src/routes/fzp/page.spec.ts` (not read).

### 2b. Imports of the routes from `src/lib/{sim-page,timeline,sim,fzp,goal,sharing}` (V)
- `src/routes/lesscars/*`: from lib areas only `$lib/lesscars/*` (above). Zero direct imports of `sim-page`, `timeline`, `sim`, `fzp`, `goal`, `sharing`.
- `src/routes/fzp/*`: none.
- `src/routes/data/*`: `$lib/server/data/key`.
- Via `LessCarsMode.svelte` (the page body): `$lib/fzp/*` (list in 1), `$lib/sim/client` (`spawnSimWorker`), `$lib/sim/lesscars/{playback-client,types}`, `$lib/shell/header-actions.svelte`. None of `sim-page`, `timeline`, `goal`, `sharing`.

### 2c. Does `/lesscars` share the timeline/scrubber/card components with `/sim`? (V)
- Scrubber: `/lesscars` uses `src/lib/fzp/TimeScrubber.svelte`; the only importers are `LessCarsMode.svelte:16`, `lesscars/timeline-view.ts` (type/markers) and the test harness `fzp/TimeScrubberHarness.svelte`. `/sim` uses `src/lib/timeline/Playhead.svelte` instead (`Playhead.svelte:14-17` imports fzp/{format,playback,time,types}). So the scrubber component is NOT shared; the clock helpers (`fzp/playback`, `fzp/time`, `fzp/high-water`, `fzp/format`, `fzp/types`) are shared.
- Timeline: `/lesscars` has its own `TimelineDialog.svelte`, `HeadlineBar.svelte`, `DetailsPanel.svelte`, `ExtraChart.svelte`, `EvidenceDialog.svelte`; `/sim` uses `src/lib/timeline/TimelineMode.svelte` (`:98-110` imports fzp card, card-place, card-area-watch, debug, money-view, playback, ProjectCardPanel, ProjectTooltip, provenance, summary-request, time, types). `/lesscars` imports nothing from `$lib/timeline` or `$lib/sim-page`.
- Card: `/lesscars` uses own `LessCarsCard.svelte`; `/sim` uses `fzp/ProjectCardPanel.svelte`. Not shared (the evidence dialog does share `fzp/provenance`).
- Map: both use `$lib/map/SimMap.svelte`.
- Workers: `/lesscars` uses `spawnSimWorker` + `sim/lesscars/playback-*` (`LessCarsMode.svelte:22,27`); `/sim` uses the ensemble runner (not examined).
- Reverse direction, who imports `src/lib/fzp` (outside fzp/lesscars/spec) (V, `grep -rnE "lib/fzp/" src`): sim-page (`FundingPoolRow.svelte:18`, `PolicySummary.svelte:15`, `load.ts:5`, `funding-view.ts:33,34,64`, `FundingTab.svelte:29`, `policy.ts:11`, `funding-copy.ts:3`, `SimRoute.svelte:8`), about (`AboutDialog.svelte:31`, `AboutAssumptions.svelte:11-13`, `copy.ts:5`), scoreboard (`HeaderScore.svelte:16`), goal (`goal/goal.ts:6-7`), timeline (`activity-view.ts`, `SimActivity.svelte`, `session4.ts`, `SimDetails.svelte:21-27`, `TimelineMode.svelte`, `details.ts`, `ChartRow.svelte:25`, `owner.ts`, `copy.ts`, `outcome.ts`, `Playhead.svelte`, `TimelineHeaderScore.svelte:11`, `results.ts`, `axis.ts`, `chart-model.ts`, `playhead.ts`, `ChartLegend.svelte:13`), `sim/world/test/run.ts:3`, `server/test/sim-docs.ts:3` (test fixture `fzp/fixtures/calibration`). Circularity (I): `goal/goal.ts` imports fzp/format+time and `fzp/chart.ts` imports `goal/goal`.
- `src/lib/lesscars` is imported only by `src/routes/lesscars/*` (V).
- Doc/code: `docs/dev/fzp-mode.md` ("scrubber ... Used by /lesscars", "Details' pieces ... `/sim`") matches the code. `docs/dev/fzp-mode.md:3` says `FzpMode.svelte` is gone: V (no such file). Stale comments still name FzpMode: `src/lib/lesscars/LessCarsMode.svelte:6` ("follow FzpMode (copied, not imported)"), `src/lib/fzp/ProjectCardPanel.svelte:49` ("from FzpMode's `fundingName`"). Not a contradiction with a doc, but code comments contradict code.

## 3. e2e (V for files, routes and helper imports; flags are line counts of crude keyword greps, so "I" for any one flag in isolation)

Playwright projects: `chromium`, `mobile`, `chromium-perf`, `mobile-perf` (`playwright.config.ts:27-39`). 60 spec files under `e2e/*.spec.ts` + 3 under `e2e/perf/` + 3 bench files under `e2e/bench/` (not in signoff). `gotoHydrated`/`gotoEditor` (`e2e/helpers/sharing.ts:56,112`) navigate to the path given / `/`.

Flag legend: SIGN = needs sign-in (uses `helpers/auth` or `signIn*`); 2CTX = creates second browser context/user (via `helpers/members.freshContext` or `newContext`); INV = invites/members/`/sims`/leave; SOCK = uses `/api/sims`+WebSocket (`helpers/sim-socket`); FUND = funding/pools/money; GOAL = goal/headline/targets/RHNA.
(goal/headline counts include the word "headline" for the header score which exists on `/`, `/p`, `/sim`.)

| Spec | goto targets | Helpers | SIGN | 2CTX | INV | SOCK | FUND | GOAL |
|---|---|---|---|---|---|---|---|---|
| about | /about, /about#..., /attribution | sharing | no | no | no | no | no | yes (20 hits; the About assumptions) |
| account-a11y | /account | account, auth | yes | no | no | no | no | no |
| account-deletion | /sims/{id} | account, auth, members, sharing, sim-socket | yes | yes | yes (invites, roster) | yes | no | no |
| account-email | none direct | account, auth | yes | no | no | no | no | no |
| account-handle | none direct | account, auth, sharing | I (pseudonymous via helper) | yes | no | no | no | no |
| auth-a11y | /invite/not-a-real-token, /about | auth, sharing | yes | yes | yes (21 invite lines) | yes | no | 1 |
| auth-methods-default | /signin, /account | auth | yes | no | no | no | no | no |
| auth-session | none | auth | I | no | no | no | no | no |
| brush | / | sharing | no | no | no | no | no | no |
| cache-headers | none | sharing | no | no | no | no | no | no |
| chrome-dark | /p/{id}, /sim, /s/{id}, /about | run, sharing | no | no | no | no | no | yes (3) |
| compositions | via gotoEditor | sharing | no | no | no | no | no | no |
| data-fixture | none | none | no | no | no | no | no | no |
| data-route | none (request API) | none | no | no | no | no | no | no |
| email-link | /sims, /signin | auth | yes | no | yes (/sims) | no | no | no |
| fzp-sim | /sim | run, sharing | no | no | no | no | no | no |
| fzp | /about, / | chrome, run, sharing | no | no | no | no | yes (6) | yes (2) |
| headers | / | none | no | no | no | no | no | no |
| invite-redundant-entry | none direct | auth, members | yes | yes | yes | no | no | no |
| invite | /sims, /sims/{simId}, /sims/{ownId} | auth, members | yes | yes (6) | yes (48 invite lines) | no | no | no |
| layout | /p/{id}, /sim, / | auth, chrome, header-text, pointer, run, sharing | yes (1) | no | roster refs (4) | no | no | yes (2) |
| leave-sim | /sims/{simId} | auth, members, sim-socket | yes | yes | yes | yes | no | no |
| lesscars | /lesscars, /sim, /about via gotoHydrated | chrome, run, sharing | no | no | no | no | no | yes (16; headline) |
| map-key | /sim, /p/{id} | auth, run, sharing | no (imports auth) | no | no | no | no | no |
| map | / | sharing | no | no | no | no | no | yes (5) |
| pages-a11y | /attribution, / | chrome | no | no | no | no | no | no |
| passkey | /signin | account, auth | yes | no | no | no | no | no |
| password-auth | /signin | account, auth | yes | no | no | no | no | no |
| password-reset | /forgot-password | account, auth | yes | no | no | no | no | no |
| pseudonymous-onboarding | /sims, /signin | auth | yes | yes | yes (21; pseudonym->invite) | yes | no | yes (9) |
| scenario-data | /about | none | no | no | no | no | no | no |
| scoreboard | /p/{id}, /p/{freshId} | sharing | no | no | no | no | no | yes (11; header score, targets) |
| share-a11y | /p/zzzzzzzz, /p/{id} | sharing | no | no | no | no | no | no |
| share-notices | /p/{id} | sharing | no | no | no | no | no | yes (1) |
| share-roundtrip | none | sharing | no | yes (2) | no | no | no | no |
| share-states | /p/{id}, /p/zzzzzzzz | sharing | no | no | no | no | no | no |
| sign-out | none | account, auth, sharing | yes | no | no | no | no | no |
| sim-activity | /sim | run, sharing | no | no | no | no | yes (6) | yes (6) |
| sim-citywide | /sim | run, sharing | no | no | no | no | no | no |
| sim-control-plane | /about (15), /sims/{simId}, /sims | auth, members, sim-socket | yes | yes (9) | yes (81 members/sims lines) | yes (31) | no | no |
| sim-details | /sim | run, sharing | no | no | no | no | yes (1) | yes (12) |
| sim-funding | none direct (uses openKind 'Public money', /about) | pointer, run, sharing | no | no | no | no | yes (115) | no |
| sim-halos | /sim | pointer, run, sharing | no | no | no | no | yes (1) | no |
| sim-object | /about | auth, members, sim-socket | yes | yes | yes (roster 5) | yes (15) | no | no |
| sim-pools | /sim | run, sharing | no | no | no | no | yes (16) | no |
| sim-share | /s/{id}, /p/{id} | run, sharing | no | yes (2) | no | no | yes (2) | yes (3) |
| sim-timeline | none direct (openKind) | run, sharing | no | yes (2) | no | no | yes (4) | yes (6) |
| sim | /fzp, /about | chrome, header-text, pointer, run, sharing | no | no | no | no | yes (7) | yes (12) |
| sims-onboarding | /sims | auth | yes | yes (1) | yes (13) | no | no | no |
| targets | /sim, /lesscars, /about | run, sharing | no | no | no | no | yes (5) | yes (64; the targets rows) |
| timelapse-render | via gotoEditor | sharing | no | no | no | no | no | no |
| transit | /about | sharing | no | no | no | no | no | no |
| perf/brush-commit.perf | none | sharing | no | no | no | no | no | no |
| perf/first-month.perf | /sim | none | no | no | no | no | no | no |
| perf/loaded-500.perf | none | sharing | no | no | no | no | no | no |
| bench/map-pan, map-timeline, sim-timeline, bench-util | /, /sim | none | no | no | no | no | I (sim-timeline 1) | no |

Specs a multi-user removal would touch (V by helper import or hit counts): `account-deletion`, `auth-a11y` (invite page), `email-link` (/sims), `invite`, `invite-redundant-entry`, `leave-sim`, `pseudonymous-onboarding`, `sim-control-plane`, `sim-object`, `sims-onboarding` (+ `helpers/members.ts`, `helpers/sim-socket.ts`). `auth-*`, `password-*`, `passkey`, `sign-out`, `account-*` are identity/account specs: also sign-in dependent but not sim-specific (I).
Specs a funding-pool change would touch: `sim-funding`, `sim-pools`, `sim-activity`, `sim-details`, `sim-share`, `sim-timeline`, `sim`, `fzp`, `targets`, `sim-halos`.
Specs a goal/levels change would touch: `targets` (64 hits), `about` (20), `lesscars` (16), `sim`, `sim-details`, `scoreboard`, `pseudonymous-onboarding` (9, I), `map`, `chrome-dark`, `layout`, `sim-activity`, `sim-timeline`, `fzp`.

### e2e/helpers (V)
- `a11y.ts` (72 lines): `expectNoA11yViolations`, axe-core WCAG 2.2 AA gate.
- `account.ts` (34): `gotoAccount`, `startPseudonymous`, `readHandle`, `submitPasswordForm`.
- `auth.ts` (75): `loginAs`, `enableAuthMethods`, `followMagicLink`, `readMail`, `sessionOf`, `uniqueEmail`; uses e2e-only seams `/api/e2e/login`, `/api/e2e/mail`, methods cookie.
- `chrome.ts` (74): `expectNoFooter`, `expectAboutReachable`, `expectPhoneHeaderFits`.
- `header-text.ts` (51): `widestHeaderText` for header fit tests.
- `members.ts` (77): `freshContext`, `signInAndCreateSim`, `ownHandle`, `inviteViaApi`, `openMembers`, `inviteLinkFor`, `coldJoin`.
- `pointer.ts` (25): `touchLaptop` (coarse pointer emulation).
- `run.ts` (107): `/sim` timeline helpers (`slider`, `waitFilled`, `installPolicyHold`, `openKind`, `addPolicy`); uses `window.__sfhFzp` from `src/lib/fzp/debug.ts`.
- `sharing.ts` (376): shared plan/sim helpers (`gotoHydrated`, `gotoEditor` -> `/`, `waitForMap`, `openPublish`, `mouseDrag`, `touchDrag`, `paintOnce`, `headerScore`, `openResults`, `seedPlanRow`; constants `PLAN_KEY='sfhousing:plan:v1'`, `SIM_KEY='sfhousing:sim:v2'`).
- `sim-socket.ts` (103): page-side WebSocket client (`openSimSocket`, `framesAtLeast`, `sendFrame`, `closedCode`, `commitsOf`, `nameDraft`), frames kept in `window.__sfhSockets`.

### e2e/fixtures (V)
- `e2e/fixtures/data/fixture-0/`: generated dataset (`manifest.json`, `basemap.pmtiles`, `buildings.pmtiles`, `neighborhoods.geojson`, `parcels/`, `fonts/`, `transit.json`, `report.json`, `README.md`, `scenarios/fzp/{calibration.json,gross.bin,parcels.bin,policy.bin,projects.json}`, `scenarios/lesscars/{plan.json,sites.json,summary.json,timeline.bin}`). Generated by `npm run pipeline -- fixture` from `pipeline/test/fixtures/mini/` (README.md:3). Its `calibration.json` top-level keys: `schema, asOf, transitions, initiation, pathwayForNew, ppaShare, size, revision, streamlinedForLocalProgram, phaseGap, market, affordableRoutes, baselineFunding`; `baselineFunding` = `{pools, programmes, provenance, check}` with 8 pools (`city-debt, city-ocoh, city-general-fund, city-impact-fees, city-housing-trust-fund, city-redevelopment, state, federal-tax-credits`). `projects.json` keys: `schema, asOf, rhnaCompletedNet{units,since,byTier,provenance}, qualityRules, projects`.
- `e2e/fixtures/timeline/fixture0-timeline.json`: generated by `src/lib/map/fixtures/build-timeline-fixture.ts` ("Do not edit by hand").
- `e2e/map.spec.ts-snapshots/`: visual snapshots (not examined).

## 4. pipeline

### 4a. Entry and steps (names; `V` = header comment read, `I` = from the name only)
`pipeline/cli.ts` (commands `doctor, fetch, version, build, check, upload, verify, fixture, quality-doc, lesscars-cnns, lesscars-freeway-land, lesscars-basemap, all` per CLAUDE.md; cli body not read, I). Steps (`pipeline/steps/`):
- `boxes.ts` V: derives building boxes from footprints/parts/LiDAR; locks `building-boxes` artifact.
- `build.ts` I/V: orchestrates build (reads FUNDING path `:85-88`, `:202-205`, passes `fundingPath` `:323`).
- `calibration.ts` V: stage-calibration; writes `scenarios/fzp/calibration.json` + `calibration-report.md` (derived cache, not shipped); reads `market.json`, `funding.json`, MOHCD rows.
- `check.ts` I/V: dataset invariants V-series (V25 states funding outcomes `:261-268`); `check-gross.ts` V36; `check-lesscars.ts` V35; `check-policy.ts` V31-V33.
- `chunks.ts` I: parcel chunks.
- `doctor.ts` I: tool checks.
- `fetch.ts` I: fetch sources into the lock.
- `fixture.ts` I: builds fixture-0 from the mini fixture.
- `gross.ts` V + `gross-worker.ts` V: `scenarios/fzp/gross.bin`.
- `lesscars.ts` V: builds `scenarios/lesscars/{plan,sites,summary}.json` + `timeline.bin` by running paired plan/baseline simulations; `lesscars-basemap.ts`, `lesscars-cnns.ts`, `lesscars-freeway-land.ts`, `lesscars-sql.ts` V: /lesscars support (offline CNN resolution, freeway land candidates, basemap id hiding, freed-land SQL).
- `manifest.ts` I/V: writes manifest (licences).
- `policy.ts` V + `policy-sql.ts` V: `scenarios/fzp/policy.bin` (sfh-policy/1).
- `projects.ts` V: project records from seven DataSF sources -> `projects.json` (incl. `rhnaCompletedNet`, check V22).
- `render-boxes.ts` V: render-only boxes.
- `scenario.ts` V + `scenario-sql.ts` V: `scenarios/fzp/parcels.bin`, parcel panel/lineage.
- `tiles.ts` I; `transit.ts` V (GTFS -> `transit.json`); `upload.ts` I/V (R2 upload; `pool` = concurrency pool); `verify.ts` V (published version through a running origin).

### 4b. Steps/sources producing finance, funding, market, calibration, baseline, goal/target data (V)
- Calibration step: `pipeline/steps/calibration.ts` -> `scenarios/fzp/calibration.json` (`CALIBRATION_JSON` `:31`), calibration report to derived dir (`:32`). Pure core `pipeline/lib/fzp-cal/calibrate.ts` run twice (V29). Output top-level fields = interface `Calibration` (`src/lib/timelapse/types.ts:72-105`): `schema, asOf, transitions, initiation, pathwayForNew, ppaShare, size, revision, streamlinedForLocalProgram, phaseGap, market?, affordableRoutes?, baselineFunding?`.
- `market` : built by `pipeline/lib/fzp-cal/market.ts` (`marketModel`, imported at `calibrate.ts:27`) from `pipeline/enrichment/market.json` (`MARKET_JSON` `calibration.ts:34`). Input file top-level fields: `schema, source{label,url,retrieved}, lagYears{value,locator}, coefficients{cost,price}, costIndex{locator,values}, priceIndex{locator,means}`. Upstream: SF Controller, Office of Economic Analysis, "Family Zoning Plan: Economic Impact Report (Items 250700 and 250701)", 2025-10-29, URL `https://newspack-missionlocal.s3.amazonaws.com/mission/wp-content/uploads/2025/10/250700_economic_impact_final.pdf` (retrieved 2026-11-09); `lagYears` = 2, locator "slide 30". Output type `MarketModel` (`src/lib/timelapse/types.ts:207`).
- `baselineFunding`: `pipeline/lib/fzp-cal/funding.ts` (header `:1-5`) from `pipeline/enrichment/funding.json` (hand-transcribed; schema `pipeline/enrichment/funding-schema.ts`) + MOHCD pipeline rows (lock id `datasf-mohcd-pipeline`, `https://data.sf.gov/d/aaxw-2cb8`, PDDL-1.0, 190 rows, retrievedAt 2026-11-10; definition `pipeline/sources/datasf.ts:213-223`). Output fields: `pools: Pool[]`, `programmes: Programme[]`, `provenance: Provenance[]`, `check{impliedHomesPerYear, observedHomesPerYear, provenance}` (`types.ts:95-104`). Input top-level fields: `schema, perHome, city, state, federal, awards, retiredIds`. Upstream for every funding cite: Budget and Legislative Analyst, "Funding and Incentivizing Affordable Housing in San Francisco", 2026-06-05, `https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf`. City sources: `city-debt, city-ocoh, city-general-fund, city-impact-fees, city-housing-trust-fund, city-redevelopment`; `state` id `state`; `federal` id `federal-tax-credits` (uncapped); `awards.years` = 2024, 2025, 19 rows (CDLAC/CTCAC award rows). Cross-check: `perHome.total` must equal `AFFORDABLE.costPerHome` (`src/lib/sim/finance/prototypes`), throwing `funding.json perHome disagrees with AFFORDABLE` (`funding-schema.ts:287`; doc `docs/dev/pipeline.md:319`).
- `affordableRoutes`: `pipeline/lib/fzp-cal/affordable.ts` (`calibrate.ts:17`) from Planning-record data; type `Calibration.affordableRoutes` (`types.ts:89`).
- RHNA / goal baseline: `pipeline/project-records/rhna.ts` -> `rhnaCompletedNet` in `scenarios/fzp/projects.json` (`{units, since, byTier?, provenance}`; `src/lib/timelapse/projects.ts:92-102`; parse check `:426-435`: byTier sums to units). `RHNA_SINCE = 2022-06-30` (`rhna.ts:17`), forms filter `RHNA_FORMS` (`:20`). Upstream sources: DataSF housing production `datasf-housing-production` (`https://data.sf.gov/d/xdht-4php`, public-domain, 6168 rows), unit completions `datasf-unit-completions` (`j67f-aayr`, PDDL-1.0, 2574 rows) among the seven project sources (I for exact mapping: `pipeline/steps/projects.ts` header says "seven DataSF project sources").
- Targets (goal numbers) themselves: NOT produced by the pipeline. `M1_TARGETS` lives in `src/lib/scoreboard/targets.ts` (hashed into the version via `src/lib/scoreboard`); `GOAL_BASE` lives in `src/lib/goal/goal.ts` (not hashed). The dataset only carries the baseline completed net (`rhnaCompletedNet`). V by imports (`fzp/provenance.ts:24-25`) and by absence of target tables in pipeline grep.
- Lock entries (`pipeline/sources.lock.json`, 1201 lines; `sources[]` ids): `building-boxes, datasf-assessor-roll, datasf-city-lands, datasf-dev-pipeline, datasf-footprints, datasf-height-bulk, datasf-historic-status, datasf-housing-production, datasf-landuse-2023, datasf-mohcd-pipeline, datasf-neighborhoods, datasf-parcel-attrs, datasf-parcels, datasf-permits-named, datasf-permits-newcon, datasf-planning-projects, datasf-planning-records, datasf-planning-review, datasf-streets, datasf-unit-completions, gtfs-bart, gtfs-caltrain, gtfs-muni, overture-building-parts, overture-buildings, protomaps-basemap, protomaps-fonts, sfbos-sb79-exemptions`. `pipeline/sources/*.ts` (datasf, gtfs, land, lidar, normalise, overture, protomaps, sfbos) define fetchers (not read except `datasf.ts:213-223`).
- Fixture funding: `pipeline/test/fixtures/mini/enrichment/funding.json` (fixture build reads it, `build.ts:88`); no mini market file (fixture builds also read live `market.json`: `calibration.ts:34` comment "live and fixture builds read it").
- Other enrichment files: `construction-schema.ts, construction-verified.json, multiphase.json, road-lots.json, sb79-exemptions.csv, schema.ts`, `lesscars/*` (corridors, freeway-land). Not finance.

### 4c. `pipeline/lib/version.ts`: what is hashed (V, quoted)
```
const PATHS = [
  'pipeline',
  'src/lib/data',
  'src/lib/generator',
  'src/lib/timelapse',
  'src/lib/plan/geometry.ts',
  'src/lib/plan/types.ts',
  'src/lib/sim/scenario',
  'src/lib/sim/levers',
  'src/lib/sim/finance',
  'src/lib/scoreboard'
];
/** Inputs and outputs under `pipeline`, not code: never part of the code hash. */
const EXCLUDE_PATHS = ['pipeline/sources.lock.json', 'pipeline/.cache', 'pipeline/out'];
```
(`version.ts:37-48`, excludes `:50`.) Version = `<UTC date of newest retrievedAt>-<first 8 hex of sha256(canonicalJson(lock) \n codeHash \n canonicalJson(toolVersions))>` (`version.ts:11-31`). Code hash = sha256 of `git ls-tree -r HEAD` listing of PATHS minus excludes, plus sha256 of `git diff HEAD` and untracked files when dirty (`:84-120`). The hash covers whole directories including their specs/tests (comment `:35` "over-hashing only costs a new version"). `src/lib/goal`, `src/lib/fzp`, `src/lib/sim-page`, `src/lib/timeline`, `src/lib/sim/world` are NOT hashed. `docs/dev/pipeline.md:91` lists the same paths: consistent.

## 5. `chreode.config.ts` (V, line refs)

Rules (first match wins), `:4-82`:
- `docs/superpowers/**`, `.superpowers/**` -> `[]` (`:6`).
- `docs/dev/pipeline.md` -> format, unit, pipeline (`:12`).
- `CLAUDE.md`, `docs/dev/**` -> format, unit (`:13`; `docs-index.spec.ts` asserts every `docs/dev/*.md` is linked from CLAUDE.md, comment `:8`).
- `src/lib/{generator,timelapse,data}/**`, `src/lib/plan/{types,geometry}.ts`, `src/lib/sim/{scenario,levers,finance}/**`, `src/lib/scoreboard/**` -> lint, check, unit, e2e, pipeline, dataset (`:17-30`).
- `pipeline/**` -> lint, check, unit, e2e, pipeline, dataset (`:33-36`).
- `**/*.md` -> format (`:39`).
- `src/**` -> lint, check, unit, e2e (`:40`).
- `e2e/fixtures/data/**` -> lint, check, e2e, pipeline (`:43`); `e2e/**` -> lint, check, e2e (`:44`).
- `scripts/**` -> lint, check, unit, e2e (`:46`).
- `.github/workflows/**` -> format, workflows (`:47`).
- `wrangler.jsonc`, `chreode.config.ts` -> format, check, unit (`:53`).
- release-please files -> format (`:55-58`); `LICENSE`, `.husky/**` -> none (`:60`); lint config files -> lint (`:62-65`); `playwright.bench.config.ts`, `drizzle*.config.ts` -> lint, check (`:68-76`); `playwright.config.ts` -> lint, check, e2e (`:77`); `vite.config.client-test.ts` -> lint, check, unit (`:79`).
- Unmatched (`migrations/`, `package*.json`, `.npmrc`, `.nvmrc`, `tsconfig.json`, `vite.config.ts`, `svelte.config.js`) run every step incl. dataset (`:80-81`).
- `versionBumpTriggers: ['format']` (`:85`).
Steps (`:86-106`): `dataset` = `npx tsx scripts/dataset-version.ts --check` (when `dataset`); `format` = `npx prettier --check .` (superseded by lint); `lint` = `npm run lint`; `check` = `npm run check`; `test:pipeline` = `npm run test:pipeline`; `test:unit` = `npm run test:unit` (policeStderr); `test:e2e` = `npm run test:e2e` (policeStderr, 15 min timeout); `burnInStep` (unit, e2e; 20 min); `timingStep` (unit, e2e, pipeline); `lint:workflows` = `npm run lint:workflows`.
Also: burn-in runners `e2e` (`e2e/**/*.spec.ts`, chromium only), `client` (`src/**/*.svelte.{test,spec}.ts`), `server` (`src/**/*.{test,spec}.ts`, `scripts/**/*.spec.ts`) (`:109-149`); timing match globs and one allowance for `src/lib/timeline/session.svelte.spec.ts` (`:154-172`); stderr allowlist includes Better-Auth warnings for wrong password / unknown user (`:241-249`) and `/no-such-page` 404 blocks; `afterMerge: 'npx -y npm@11.21.0 ci'` (`:252`).
Note (V): changing `sim/{scenario,levers,finance}`, `scoreboard`, or `pipeline/**` triggers the `dataset` step, which requires the new dataset version to be published (docs/dev/pipeline.md). `src/lib/goal/**` and `src/lib/sim-page|timeline|fzp/**` fall under the plain `src/**` rule (no dataset step).

## 6. package.json scripts and what `test:e2e` starts and seeds (V)

Scripts (`package.json`): `dev` vite dev; `build` = `vite build && tsx scripts/worker-entry.ts`; `preview` = build + `wrangler dev --port 4173 --var ENVIRONMENT:development`; `prepare` = `husky && wrangler types --strict-vars=false && svelte-kit sync`; `check`; `lint`; `lint:workflows`; `format`; `test` = unit then e2e; `test:unit` = `vitest --run --project server --project client --no-file-parallelism --maxWorkers=1`; `test:pipeline` = `vitest --run --project pipeline`; `test:perf`; `pipeline` = `tsx pipeline/cli.ts`; `test:e2e` = `playwright test`; `bench:map` = `playwright test --config playwright.bench.config.ts`; `db:generate` and `db:generate:sim` (`@planafoot/drizzle-cf-migrations` cli `generate d1|sim`, so the sim DO SQLite track has its own migration generator); `db:migrate` (`wrangler d1 migrations apply DB --local`), `db:migrate:staging`, `db:migrate:prod`; `data:local`, `data:fixture` (`tsx scripts/r2-load-local.ts e2e/fixtures/data/fixture-0 fixture-0`), `data:transit`; `signoff` = `chreode signoff`; `branch-protection`(`:dry`); `types`.
`playwright.config.ts:49-67` `webServer.command`: `npm run data:fixture && npm run db:migrate && VITE_E2E=1 npm run build && wrangler dev --port ${port} --var ENVIRONMENT:development --var PUBLIC_DATASET_VERSION:fixture-0 --var AUTH_METHODS:magic-link --var EMAIL_PROVIDER:ses --var SES_ACCESS_KEY_ID: --var SES_SECRET_ACCESS_KEY: --var RESEND_API_KEY: --var BETTER_AUTH_SECRET:e2e-local-secret-... --var BETTER_AUTH_URL:http://localhost:${port} --var SIM_TAKEDOWN_TOKEN:e2e-takedown-token-...`; `url` = `/about`; `reuseExistingServer: false`; timeout 180 s. So it seeds local R2 with fixture-0, applies local D1 migrations, builds with `VITE_E2E=1` (compiles `window.__sfhMap`/`__sfhFzp`/`__sfhLessCars` hooks and e2e seams), and starts `wrangler dev` which instantiates the `SIM` DO from `.svelte-kit/cloudflare/_worker.js` (V by `wrangler.jsonc:9-11` and `scripts/worker-entry.ts`). Other config: `retries: 1`, `fullyParallel: true`, reporter includes `@mindlace/chreode/reporters/playwright`; projects `chromium`, `mobile` (375x812, touch), `chromium-perf`, `mobile-perf` (perf chained after parallel ones) (`:27-39`).
Doc/code: `docs/dev/testing.md:79` describes the same projects (consistent). `docs/dev/testing.md:89` says "CI runs `npm run test:e2e -- --project=chromium --project=mobile ...`": no workflow runs Playwright (V, grep of `.github/workflows` for `playwright|test:e2e|test:unit` finds nothing). See contradictions.

## 7. `.github/**` (V)

- `deploy-staging.yml` (50 lines): on push to `main`/dispatch; `npm ci`; guard `scripts/dataset-version.ts --check <staging url>` (dataset must be published); `npm run build`; `wrangler d1 migrations apply sfhousing-staging --remote --env staging` (D1 migrate); `wrangler deploy --env staging` (deploys Worker and, via `wrangler.jsonc` `migrations: v1-sim-object`, applies the DO class migration implicitly; I); smoke: curls the dataset `manifest.json` and `/about`.
- `deploy-prod.yml` (51): on release published (tag `v*`); same steps against prod (`d1 migrations apply sfhousing --remote`, `deploy --tag ...`) (`:30-46`).
- `pipeline.yml` (59): path-filtered (`pipeline/**`, `src/lib/data/**`, `src/lib/sim/{scenario,levers,finance}/**`, `src/lib/scoreboard/**`, the workflow) on `pull_request` and `push`; builds tippecanoe + pmtiles, `pipeline doctor`, `test:pipeline`, `vitest --project server src/lib/data`, regenerates the fixture and `git diff --exit-code` over `e2e/fixtures` and `pipeline/test/fixtures/mini/golden` (`:52-59`).
- `release-please.yml` (74): on push to `main`; mints a GitHub App token and runs release-please (changelog, tags, release) (`:1-30` read).
No workflow touches `SimObject` by name or runs `db:generate:sim`. Only deploys carry D1 migrations (`migrations/d1`, `wrangler.jsonc` `migrations_dir`).

## 8. scripts/ (V headers; flags)

- `bench-levers.ts`: times citywide brush lever resolution on a dataset dir. FLAG levers (`SimLevers` `:31,121`).
- `building-review.ts` (+spec): building-box review page (VITE_E2E build vs two datasets).
- `bundle-measure.mjs`: bundles a measurement script like the sim worker build.
- `data-local.ts` (+spec): `npm run data:local`, copy published dataset version into local R2 (imports `$lib/server/data/key` `:13`).
- `data-transit.ts` (+spec), `lib/data-transit-helpers.ts`: `npm run data:transit`, GTFS -> `transit.json` into local R2.
- `dataset-version.ts` (+spec): prints / `--check`s the dataset version (used by deploy workflows and chreode `dataset` step).
- `disapproval-share.ts`: prints per-pathway eventual disapproved share from a `calibration.json`.
- `docs-index.spec.ts`: asserts every `docs/dev/*.md` is linked from CLAUDE.md.
- `ensemble-measure.ts`: ensemble-runner measurements; has `--no-money`; imports `sim-page/policy`, `timeline/policy4`, `timeline/reconcile4`. FLAG finance (flag `--no-money`, `:` header).
- `map-stream-live.ts` (+spec), `map-stream-measure.ts`: map-stream copy/measure of a published dataset; `map-stream-measure` steps "one unfunded world" (I/V from header). FLAG finance (mention).
- `math-golden/` (`driver.c`, `generate.sh`), `model-golden.ts`: regenerate timelapse goldens.
- `measure-policy-compile.ts`: times `compileTimeline` on policy edits; imports `timeline/policy4`.
- `profile-sim-load.mjs` + `profile-sim-load.policy.json`: cold-load profile of `/sim`; publishes a policy via `POST /api/policies` (`:70`). Policy JSON contains a funding mention (1 hit).
- `r2-load-local.ts` (+spec), `r2-put-local.ts`: load a dataset dir into local R2 (`npm run data:fixture` uses it).
- `regen-confusables.ts` (+spec): Unicode confusables regen (handle validation, I).
- `timing-evidence.ts` (+spec): permitting-preset evidence from `projects.json`.
- `worker-entry.ts` (+spec): after `vite build`, moves adapter `_worker.js` and writes an entry re-exporting both the handler and `SimObject` (`:2,16`). FLAG DO.
- `wrangler-config.spec.ts`, `lib/wrangler-config.ts`: parse `wrangler.jsonc`; the spec asserts `PUBLIC_DATASET_VERSION` absent for prod and staging (`:13-16`) and does NOT mention the DO or `SIM` (V by grep). FLAG DO only by being the wrangler config test.
- `lib/dataset-version-plugin.ts`: Vite plugin baking `__SFH_DATASET_VERSION__`.

## 9. docs/dev/*.md (37 files; counts are `grep -oi` occurrences: member = substring "member", invite = "invit", role = word `role(s)`, socket, Durable Object, goal = substring "goal", pool = substring "pool" (so "pooled" counts))

| File | Topic | member | invite | role | socket | DO | goal | pool |
|---|---|---|---|---|---|---|---|---|
| about.md | About this model page/dialog | 0 | 0 | 2 | 0 | 0 | 6 | 0 |
| accessibility.md | WCAG checklist | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| auth.md | Accounts, sims, invitations (identity, roles, sim registration, roster) | 43 | 51 | 13 | 11 | 0 | 0 | 0 |
| building-boxes.md | LiDAR boxes | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| data-serving.md | `/data/<version>/*` route | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| deploy.md | environments, release, takedown | 2 | 3 | 0 | 1 | 1 | 0 | 0 |
| developing.md | dev workflow | 0 | 1 | 0 | 1 | 1 | 8 | 0 |
| ensemble-runner.md | /sim timeline worker host | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| finance-data.md | funding data and pipeline source | 0 | 0 | 0 | 0 | 0 | 0 | 40 |
| finance-engine.md | funded starts, queue, pools in engine | 2 | 0 | 0 | 0 | 0 | 0 | 93 |
| finance-levers.md | FinanceLevers, buildFinance | 0 | 0 | 0 | 0 | 0 | 0 | 42 |
| finance-model.md | prototypes, bundles, tiers | 0 | 0 | 0 | 0 | 0 | 0 | 19 |
| finance-score.md | tiers and money in results | 0 | 0 | 0 | 0 | 0 | 0 | 36 |
| fzp-mode.md | what is left in src/lib/fzp | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| lesscars.md (1032 lines) | /lesscars | 0 | 0 | 0 | 0 | 0 | 1 | 3 |
| map-interfaces.md | map consumer interfaces, citywide feed | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| map-perf.md | bench:map | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| map-stream.md | map feed from a stepped world | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| market.md | today's market | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pipeline.md | data pipeline | 6 | 0 | 0 | 0 | 0 | 0 | 7 |
| plan-sharing.md | `/p` and `/s` sharing | 0 | 0 | 1 | 0 | 0 | 3 | 10 |
| policy-timeline.md | schema 4 dated policies | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| road-lots.md | road-like lots | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| sim-funding.md | public money on /sim | 0 | 0 | 1 | 0 | 0 | 0 | 131 |
| sim-levers.md | policy lever engine | 0 | 0 | 0 | 0 | 0 | 1 | 12 |
| sim-log.md | sim log core | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| sim-object.md | per-sim Durable Object | 7 | 2 | 12 | 92 | 3 | 0 | 0 |
| sim-page.md | /sim page shell | 1 | 0 | 0 | 0 | 0 | 4 | 3 |
| sim-store.md | browser log store | 0 | 0 | 0 | 10 | 0 | 0 | 0 |
| sim-sync.md | sim sync client | 0 | 0 | 0 | 95 | 0 | 0 | 0 |
| sim-timers.md | permitting timers | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| testing.md | test projects | 0 | 1 | 0 | 7 | 0 | 1 | 1 |
| timeline-ui.md | /sim timeline | 0 | 0 | 2 | 0 | 0 | 73 | 15 |
| ui-parts.md | shared UI parts | 0 | 0 | 4 | 0 | 0 | 0 | 0 |
| world-core.md | world, step, systems | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| world-funding.md | funding in the step engine | 1 | 0 | 0 | 0 | 0 | 1 | 18 |
| world-score.md | WorldSeries, TimelineView | 0 | 0 | 0 | 0 | 0 | 0 | 13 |

Notes: "member" in finance-engine/world-funding/pipeline is likely not user membership (cluster/pool "members"; I). docs that a multi-user removal touches: `auth.md`, `sim-object.md`, `sim-sync.md`, `sim-store.md`, `sim-log.md`, `deploy.md`, `developing.md`, `testing.md`. A funding-pool change touches the 8+ `finance-*`, `sim-funding.md`, `world-funding.md`, `policy-timeline.md`, `finance-levers.md`, `timeline-ui.md`. A goal/level change: `timeline-ui.md` (73), `developing.md` (8), `about.md`, `sim-page.md`, `plan-sharing.md`. Doc index guard: `scripts/docs-index.spec.ts` + CLAUDE.md list.
`README.md` (30 lines): member 0, invite 0, role 0, socket 0, Durable Object 0, goal 0, pool 0 (V). `CHANGELOG.md` headings (V, 228 lines): `0.6.0 (2026-11-08)` (Features, Bug Fixes, Data), `0.5.0 (2026-10-30)` (Features, Data), `0.4.1 (2026-10-21)` (Data), `0.4.0 (2026-10-20)` (Features, Bug Fixes), `0.3.0 (2026-10-17)` (Features), `0.2.0 (2026-10-12)` (Features, Bug Fixes, Performance Improvements) (19 heading lines in total; I listed all of them via a `#`-to-`###` filter).

## 10. svelte.config.js and vite configs (V)

`svelte.config.js` CSP (verbatim, `kit.csp`, `mode: 'auto'`):
```
'default-src': ['self'],
'img-src': ['self', 'data:', 'blob:'],
'style-src': ['self', 'unsafe-inline'],
'worker-src': ['self', 'blob:'],
'connect-src': ['self'],
'font-src': ['self'],
'object-src': ['none'],
'base-uri': ['self'],
'frame-ancestors': ['none']
```
`connect-src 'self'` covers the sim socket (same origin) and `/data/*`; `worker-src 'self' blob:` covers the sim worker. Adapter `@sveltejs/adapter-cloudflare`. No directive names the sim worker or DO.
`vite.config.ts`: no reference to the sim worker or DO by name. Contents: plugins `datasetVersionPlugin()`, tailwind, sveltekit; `ssr.noExternal` for email components; vitest projects `server` (`src/**/*.{test,spec}.ts`, `scripts/**/*.spec.ts`), `perf`, `client` (`vite.config.client-test.ts`), `client-perf`, `pipeline` (`pipeline/test/**/*.test.ts`, with a plugin `srcLibForSrc` resolving `$lib` only for importers under `src/lib`, `:17-27`, so pipeline code cannot import `$lib` itself). `vite.config.client-test.ts`, `playwright.bench.config.ts`: grep for `sim|Durable|SimObject|worker` finds only `workers: 1` and a comment on a dataset worker (`playwright.bench.config.ts:13,30`).
`wrangler.jsonc:9-11` (outside scope but the only DO wiring): `"alias": {"$lib": "./src/lib"}`, `"durable_objects": {"bindings":[{"name":"SIM","class_name":"SimObject"}]}`, `"migrations":[{"tag":"v1-sim-object","new_sqlite_classes":["SimObject"]}]`, repeated under `env.staging`. Also 7 rate limits incl. `INVITE_RL` (namespace 4105; `MUTATION_REGISTERED_RL`, `ACCOUNT_EDIT_RL`, `PSEUDO_MINT_RL` are sim/identity related).

## 11. src/lib/data: finance/funding/market loaders and client-side types (V)

- No loader in `src/lib/data` fetches `funding.json`, `market.json`, or any finance file. Files in the dir: `column-file, dataset-version, envelope-row, gross-table, manifest, parcel, parcel-chunk, policy-codec, scenario-codec, scenario-yield, stock-layers, transit, transit-codec`, `lesscars/{codec,network,plan,schedule}`, fixtures.
- Manifest schema (`src/lib/data/manifest.ts:42-80`): `scenarios.fzp = { parcels, projects, calibration, policy?, gross?, frontage? }` and `scenarios.lesscars? = { plan, sites, summary, timeline }`. `ManifestSchema` (`:82`), `type Manifest` (`:103`), `ManifestFile`/`manifestFiles` (`:114,132`; `add('scenarios.fzp.calibration', ...)` `:156`). No funding/market keys: grep for `funding|market|finance` in `manifest.ts` finds none.
- Finance data reaches the client via `calibration.json`: `src/lib/fzp/load.ts:11-15` (`fetchCalibration(url, fetchFn)` -> `parseCalibration` from `$lib/timelapse/model`), `reloadScenario` (`:19-26`); `src/lib/lesscars/load.ts:13,52-53` also calls `fetchCalibration`. `Calibration` type `src/lib/timelapse/types.ts:72` with `market?: MarketModel` (`:84`, defined `:207`), `affordableRoutes?` (`:89`), `baselineFunding?: { pools: Pool[]; programmes: Programme[]; provenance: Provenance[]; check: {...} }` (`:95-104`); `Pool` (`:244`), `PoolKind = 'goBond'|'cop'|'generalRevenue'|'dedicatedTax'|'state'|'federal'|'bank'` (`:241-242`), `Programme` (`:271`), `IncomeTier`/`INCOME_TIERS`. `projects.json` carries `rhnaCompletedNet` with `byTier` (`src/lib/timelapse/projects.ts:92-102`), parsed by `parseProjectsFile` (`:411`; loaded in `src/lib/sim/scenario/load.ts:9`).
- `scenario-codec.ts` comment `:15` ("stage-calibration imports this constant") only.

## 12. src/lib/map: policy marks, citywide feed, imports of sim-sync/sim-store/members/goal (V)

- Imports of `$lib/sim-sync`, `$lib/sim-store`, `$lib/members`, `$lib/goal` from `src/lib/map`: none (grep). `goal|rhna|target` word in `src/lib/map` non-spec: only animation `target` variables (`timelapse/demolish.ts`), `timeline-controller.ts:266`, anchor `target="_blank"` (`attribution.ts:10`): none about the homes goal.
- Citywide feed: `src/lib/map/city-delta.ts` (`validateCityDelta`, `CITY_DELTA_BYTES_PER_ROW = 27`, header "map-citywide slice 6"), type `CityDelta` at `src/lib/map/types.ts:70-95` (`city?: CityDelta` on the timeline update `:95`: "absent: no marker changed"), with per-row `flags` (`SLOT_FLAG = { zoning: 1, money: 2 }` `types.ts:47`, `MAX_FLAGS = 3` in `city-delta.ts`), consumed at `src/lib/map/SimMap.svelte:67,409` (`if (u.city) validateCityDelta(u.city)`), `setBarMode('street'|'far')` at `SimMap.svelte:449`. The feed carries homes per row and a money flag; it does not depend on the goal (V by absence; docs `docs/dev/map-interfaces.md` describes the feed as the goal-free, I; and the commit `8125e557` "goal at the end of the window; drop map rings and glows" is the latest history, so `docs/dev/map-interfaces.md` could still describe rings/glows (not examined)).
- Policy marks: key legend copy `src/lib/map/key/copy.ts:9` (`markWhy`); `slotFlags?: Uint8Array` `types.ts:60`; flags comment `timelapse/types.ts:96`. The `money` flag reads funding state (I from the name; produced upstream by the world feed, not examined).
- `src/lib/map/types.ts:11` imports `LimitOwner` from `$lib/sim/levers/source`; `height/*` imports levers (`source`, `layers`, `resolve`): the map's height-limit layers depend on `SimLevers` resolution (zoning), not on members.

## Doc/code contradictions

1. `docs/dev/testing.md:89`: "CI runs `npm run test:e2e -- --project=chromium --project=mobile --project=chromium-perf --project=mobile-perf`." Code: no workflow in `.github/workflows/` mentions `playwright`, `test:e2e` or `test:unit` (V, grep). The only CI test workflow is `pipeline.yml`. Signoff (chreode) runs e2e locally (`chreode.config.ts:93-99`).
2. `CLAUDE.md` (Conventions): "There is no CI workflow on pull requests; signoff is the only check." Code: `.github/workflows/pipeline.yml:3-12` triggers on `pull_request` (path-filtered) and runs `test:pipeline` and the fixture byte check. (V)
3. Stale code comments naming the removed component: `src/lib/lesscars/LessCarsMode.svelte:6` ("follow FzpMode (copied, not imported)") and `src/lib/fzp/ProjectCardPanel.svelte:49` ("FzpMode's `fundingName`"); `docs/dev/fzp-mode.md:3` states `FzpMode.svelte` is gone and no such file exists (V).
4. `CLAUDE.md` / `docs/dev/pipeline.md:91` hashed paths: consistent with `version.ts` (no contradiction found). `docs/dev/fzp-mode.md` file-group table: consistent with import graph for the scrubber (no contradiction found).
5. `chreode.config.ts:8-9` says `pipeline/test/quality.test.ts` asserts pipeline.md's Data quality section: not checked (not examined).

## Surprises

- `src/lib/fzp/chart.ts:6` imports `$lib/goal/goal` while `src/lib/goal/goal.ts:6-7` imports `$lib/fzp/format` and `$lib/fzp/time`: a goal <-> fzp import cycle (I: module-level cycle; not verified for type-only edges).
- `src/lib/fzp` is the home of the money, provenance and targets presentation for `/sim` Details; renaming/removing "fzp" is a larger change than the `/fzp` redirect suggests.
- Targets (the homes goal numbers) are in `src/lib/scoreboard/targets.ts` (hashed into the dataset version) while `GOAL_BASE` is in `src/lib/goal/goal.ts` (not hashed): changing a target forces a dataset republish; changing the goal base does not.
- Funding pools ship in `calibration.json` of the dataset and `pipeline/enrichment/funding.json` is hand-transcribed from one BLA PDF; `perHome.total` is cross-checked against the engine constant `AFFORDABLE.costPerHome` (`funding-schema.ts:287`). A finite-pool redesign that changes `Pool` shape must change `src/lib/timelapse/types.ts` (hashed) and the pipeline, hence a new dataset.

## Appendix

### Files read in full
`pipeline/lib/version.ts`; `chreode.config.ts`; `playwright.config.ts`; `svelte.config.js`; `vite.config.ts`; `src/routes/fzp/+page.ts`; `src/routes/lesscars/+page.ts`; `src/routes/lesscars/+page.svelte`; `.github/workflows/deploy-prod.yml`; `.github/workflows/pipeline.yml`.

### Files read in part (line ranges)
`.github/workflows/deploy-staging.yml` 1-50; `.github/workflows/release-please.yml` 1-30; `package.json` (scripts block via JSON); `wrangler.jsonc` 1-80; `src/lib/lesscars/LessCarsMode.svelte` 1-60; `src/routes/data/[version]/[...path]/+server.ts` 1-60; `src/lib/data/manifest.ts` 40-100; `src/lib/map/city-delta.ts` 1-40; `src/lib/timelapse/types.ts` 72-105 and 207-279; `src/lib/timelapse/projects.ts` 89-102, 399-435; `pipeline/steps/calibration.ts` 1-60; `pipeline/enrichment/funding-schema.ts` 1-60; `pipeline/lib/fzp-cal/funding.ts` 1-25; `pipeline/lib/fzp-cal/ph-pool.ts` 1-25; `docs/dev/fzp-mode.md` 1-50; `docs/dev/testing.md:89`; `docs/dev/pipeline.md:91`; `e2e/helpers/sharing.ts` 108-118; headers (first ~12 lines) of every `pipeline/steps/*.ts`, `scripts/*`, `e2e/helpers/*`; `e2e/fixtures/data/fixture-0/README.md` 1-5; `CHANGELOG.md` headings; JSON structure (top-level keys) of `pipeline/enrichment/funding.json`, `pipeline/enrichment/market.json`, `pipeline/sources.lock.json` (ids), `e2e/fixtures/data/fixture-0/scenarios/fzp/{calibration,projects}.json`.

### Dirs listed
`src/lib`, `src/routes`, `src/routes/{lesscars,fzp,data}`, `src/lib/{lesscars,fzp,data,data/lesscars,timelapse,map,goal,scoreboard,sim/finance}`, `pipeline`, `pipeline/{steps,lib,lib/fzp-cal,enrichment,sources,project-records}`, `pipeline/test/fixtures/mini/enrichment`, `e2e`, `e2e/{helpers,fixtures,bench,perf,fixtures/data,fixtures/data/fixture-0,.../scenarios/*}`, `scripts`, `scripts/{lib,math-golden}`, `.github` (find), `docs/dev` (counts), repo root.

### NOT examined
Bodies of: all `e2e/*.spec.ts` (only grepped for `goto`, helper imports and keyword counts, so every per-spec flag is I at the level of "keyword present", not proof of behaviour); `e2e/map.spec.ts-snapshots`; `e2e/bench/*`; `src/routes/**/page*.spec.ts`; all pipeline step bodies beyond the headers listed (`build.ts`, `check.ts`, `cli.ts`, `fetch.ts`, `upload.ts`, `tiles.ts`, `scenario.ts`, `policy.ts`, `lesscars.ts` etc.); `pipeline/lib/fzp-cal/*` beyond the two header excerpts; `pipeline/sources/*.ts` (except `datasf.ts:213-223` via grep); `pipeline/sql/*`; `pipeline/test/**`; `pipeline/lidar-raster/`; `src/lib/map/**` bodies (only grep results and `city-delta.ts`/`types.ts` lines); `src/lib/lesscars/**` bodies beyond `LessCarsMode.svelte` 1-60; `src/lib/fzp/**` bodies; `src/lib/data/**` bodies beyond `manifest.ts`; `src/lib/goal/**`, `src/lib/scoreboard/**`, `src/lib/sim/finance/**` (listed only); `scripts/*` bodies (headers and greps only); `docs/dev/*.md` bodies (counts and first headings only, plus `fzp-mode.md` 1-50, `testing.md:89`, `pipeline.md:91`); `README.md` (counts only); `docs/dev/map-interfaces.md` claims about rings/glows vs commit `8125e557`; `drizzle*.config.ts`, `playwright.bench.config.ts`, `vite.config.client-test.ts` (grepped only); `pipeline/test/quality.test.ts` claim in `chreode.config.ts:8-9`.
