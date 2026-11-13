# policy-timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Policies with dates: the schema 4 policy document (types, parser, default, canonical form, limits), opening schema 2/3 documents as schema 4, reconciling a stored document with its dataset, compiling a document into a month-by-month `PolicyTimeline` in slices with frames interned by content, the comparison rule, and a schema 4 codec built and tested but switched on nowhere.

**Architecture:** Page-side, pure TypeScript in `src/lib/timeline/` (document, month math, parser, upgrade, reconcile, codec), reusing today's schema 3 parsers from `src/lib/sim-page/policy.ts` and `parseFinanceLevers`. Engine-side in `src/lib/sim/world/policy/` beside the frozen `frame.ts`: for each month the policies in force are combined into today's undated lever shapes (`SimLevers` zoning fields, timer lists, `FinanceLevers`), each distinct zoning state is built once with today's `resolveEnvelopes` → yield recompute → `fillNeeds` → `applyLevers` → `precomputeOf`, and frames are identified by a 128-bit digest of their content, interned for the worker's life; zoning views are held weakly so only live timelines keep them. Nothing reaches a user in this release.

**Tech Stack:** TypeScript, Vitest (projects `server`, `perf`), SvelteKit 2 (only for the existing `DocCodec`/autosave types).

**Spec:** `docs/superpowers/specs/2026-11-13-policy-timeline-design.md` (binding). Design: `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md` sections 3.4, 5.3 (T5, T6, T7, T11, T12, T14, T15), 8 (S4 to S6, S10, S13 frozen word for word), 9. Ledger findings F7, F12, F17 (`.superpowers/superconductor/sim-step-engine/ledger.md`). Project rules: `CLAUDE.md`, `docs/dev/testing.md`, `docs/dev/sim-levers.md`, `docs/dev/finance-levers.md`, `docs/dev/sim-funding.md`, `docs/dev/sim-timers.md`, `docs/dev/plan-sharing.md`.

## Global Constraints

From the spec, verbatim:

- The calibration file, the dataset and the pipeline do not change. No file under the folders hashed into the dataset version (`pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard`) is added, changed or removed in Release A. In Release B the one exception is `src/lib/sim/scenario/scenario-host.ts`, which `ensemble-runner` may change or move so that the new host can use the dataset it loads, without changing any result of the old engine; that branch then follows "Finishing a branch that changes the dataset" in `docs/dev/pipeline.md`. New code imports from the hashed folders. A builder who finds any other change necessary stops and reports.
- The step and everything it calls may read the policy of the month being stepped and of earlier months, never of a later one.
- Agreement with today's engine (OD-2). Without public money and under one frame: for every seed tested, `scheduleAt` and `masterAt` over every row at the horizon day equal `simulateDetailed`'s schedules and masters, and each world's calendar-month series equals `shownSeries`. With public money, over seeds 1 to 200 on the bench city and on the live city with baseline funding, at years 5, 10, 20 and 40: the mean of completed net homes within 1% of today's mean, its standard deviation within 15% of today's, and the mean number of awards and of funded homes within 3%. The ledger identities hold after every step in every world. A miss is reported with its numbers; no rule is changed to meet it.
- `exp` and `log` only from `src/lib/timelapse/math.ts`. `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` and the `**` operator are never used under `src/lib/sim/world/`, and the determinism ESLint rule's `files` gains `src/lib/sim/world/**` (`world-core` adds it; `eslint.config.js` is not hashed).
- The same inputs give the same world, in Node and in the browser.
- No slice of worker work longer than 50 ms.
- `step`, the world and every function they call take no horizon, read no end date and keep nothing laid out to one. Only the runner and the page hold the window.
- One month for every world of both ensembles, scoring included, on the live city: at most 9 ms on the reference machine. (Playback at its fastest covers 36 months a second; the forecast must fill at least three times faster.) The spike measured 0.31 ms for 48 worlds without public money; the funded path is unmeasured, and `world-funding` measures it first.
- No user setting may decide directly how much gets built (levers spec anti-goal, kept).
- A lever that changes only timing never changes any project's outcome, and moves its days in one direction (paired-draw fix, kept). This holds exactly without public money. With public money a timer can still change which applications are awarded and when, because releases and repayments fall on stage days; that is an effect of the money and is not to be "fixed".
- Tests that run in signoff assert behaviour and order, never wall-clock time. Every timing bar lives in `test:perf`.
- WCAG 2.2 AA for the timeline, including keyboard control of every bar.
- Explanation waits for interest (OD-12). At rest the page shows numbers, short labels and controls. Sentences that explain a number, a caveat or a method appear only when the reader points at, focuses or taps the thing they explain. What appears on pointing also appears on keyboard focus and on tap, stays while pointed at, and can be dismissed (WCAG 1.4.13). An explanation is itself short: it says what the reader cannot infer and stops (partner, 2026-11-13: "A forecast if nothing changes" is sufficiently unambiguous; "if you can infer it don't belabor it"). No new standing paragraph is added to `/sim`, and the specs for `timeline-ui` and `world-score` list each text they carry over from today's page with where it goes.

Added by the dispatch and this plan:

- **Hashed folders, tests included.** Nothing under the hashed folders is added, changed or removed, specs and fixtures included. New code goes in `src/lib/timeline/` and `src/lib/sim/world/policy/`. `src/lib/sim-page/` is not hashed: Task 2 exports `parseRule`, `parseCustom`, `parseTimingSet` from `src/lib/sim-page/policy.ts` and nothing else there changes. Anything private inside a hashed file (`scenario-host.ts`'s `leverStep`, `apply.ts`'s `planOf`/`bare`) is re-composed from exported functions in new code; if that is impossible, stop and report.
- **Frozen rows.** S4, S5, S6, S10, S13 are frozen word for word. `src/lib/sim/world/policy/frame.ts` is not edited. `src/lib/sim/world/statics.ts` belongs to `world-core`: import nothing from it (this plan needs nothing from it) and never import `staticsOf` or any `world-core` code.
- **Nothing switched on.** `/api/policies`, `/s/[id]`, `SIM_CODEC`, the page and the autosave key `sfhousing:sim:v1` stay as they are. The schema 4 codec, the key migration helper and the upgrade path are built and tested only.
- **Determinism under `src/lib/sim/world/`** applies to spec and fixture files there too: no `Math.exp/log/pow/log1p/expm1`, no `**`.
- **Vitest** runs with `expect.requireAssertions`: every test calls `expect`. Timing assertions only in `*.perf.spec.ts` (project `perf`).
- **House rules.** 2-space indent, single quotes, no trailing commas, 100 columns; Conventional Commits; multi-line messages via `git commit -F <file>`; no Claude attribution anywhere. Run everything foreground; never `cd X && cmd`. Do not push, open a PR, run signoff or merge.
- **Timing.** Another operator shares the machine. Wall-clock numbers are ballpark unless `uptime` shows a quiet machine; say which.
- **Verification per task:** the task's named spec files green, `npm run check` green, `npx eslint <touched files>` and `npx prettier --check <touched files>` green. Run `npm run test:unit` at Tasks 5, 10, 13 and 15.

Commands: server specs `npx vitest run --project server <path>`; perf `npx vitest run --project perf <path>`.

## Review Focus

1. **Two money policies in force naming the same baseline pool on the same `from` day, or both typing one term.** Expect the lower policy in the list to win (as for paint and route shares, rules 11 and 14) and the compile never to throw. Test in Task 6 (`money: same pool and day, lower wins`).
2. **A programme whose own `to` falls inside a month.** Offered is decided on the month's first day only (rule 7): offered is 1 for that whole month and 0 from the next. Test in Task 7 (`offered on the first day only`).
3. **An inflow dated on the dataset date itself.** It appears in month 1's `arrivals` exactly once and in no other month. Test in Task 7 (`dataset-date inflow once, month 1`).
4. **An `on` zoning policy whose brush query has no entry in `lots`.** Expect `LeverFormatError` naming the query key, never a silent "no lots"; an `off` policy's missing query is not an error. Test in Task 6 (`missing lots`).
5. **A row deleted from the document (a policy removed whole) whose span began at month 1.** Expect `firstDifference` 1 and `touched(m)` on the month the views change to be exactly the lots that policy raised. Test in Task 10 (`removing a painted policy`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/sim-page/policy.ts` (modify: `195`, `219`, `268`) | export `parseRule`, `parseCustom`, `parseTimingSet` |
| `src/lib/timeline/months.ts` | model-month day arithmetic |
| `src/lib/timeline/policy4.ts` | S10 types, `DEFAULT_POLICY4`, `queriesOf4`, `spanAt`, `nothingInForce` |
| `src/lib/timeline/parse4.ts` | `parsePolicy4` (rules 1, 3, 4, 5) |
| `src/lib/timeline/upgrade.ts` | `upgradePolicy` (the table, rules 1, 2, T6) |
| `src/lib/timeline/reconcile4.ts` | `reconcilePolicy4`, `programmeTermGaps` |
| `src/lib/timeline/sim-doc4.ts` | `SimDoc4`, strict and opening parsers, serializer, codec, autosave key migration (rules 25, 26) |
| `src/lib/sim/world/policy/combine.ts` | policies in force on a day, and their combination into today's lever shapes (rules 10 to 15) |
| `src/lib/sim/world/policy/money.ts` | per-month `FinanceFrame` and its identity key (rules 6, 7, 15, 16) |
| `src/lib/sim/world/policy/intern.ts` | `digest128`, frame ids, input serials, the weak view cache (rule 17) |
| `src/lib/sim/world/policy/zoning-view.ts` | one zoning state's `ZoningView` as a sliced job; `touchedRows` (rules 18, 20) |
| `src/lib/sim/world/policy/compile.ts` | `CompileCtx`, `YieldSource`, `TimelineCompile`, `compileTimeline` (rules 16 to 21, 23) |
| `src/lib/sim/world/policy/compare.ts` | `firstDifference`, `comparisonOf` (rule 22) |
| `src/lib/sim/world/policy/lookups.ts` | `lookupsAt` |
| `src/lib/sim/world/policy/test/fixtures.ts` | mini-city compile context, fake yields, document builders |
| `scripts/measure-policy-compile.ts` (untracked until Task 15) | Task 1 and Task 15 measurements |
| `.superpowers/sdd/policy-timeline/measure-compile.md` | the measurement report |
| `docs/dev/step-engine.md` (create if absent), `docs/dev/sim-levers.md`, `CLAUDE.md` | docs |

Code this plan relies on (base c0bd4864): `SimPolicy` `sim-page/policy.ts:58-69`, `PolicyFormatError` `98-105`, `DEFAULT_POLICY` `112-119`, `isDefaultPolicy` `128-130`, `parseRule` `195-217`, `parseCustom` `219-236`, `PresetLayerMode` `266`, `parseTimingSet` `268-295`, `parseSimPolicy` `391-440`, `canonicalJson` `445-455`, `queryKey` `457-459`, `ruleQueries` `464-470`, `customQuery` `473-475`, `queriesOf` `478-487`, `Lots` `490`, `paintedLots` `530-540`, `compileLevers` `561-574` (twin rule `571`); `TimingSet`/`SimTiming`/`OBSERVED_TIMING` `sim-page/timing.ts:175-203`, `resolvePreset` `298-343`, `timingLabel` `349-352`, `compileTiming` `380-391`; `reconcileTiming` `sim-page/reconcile.ts:146-158`, `TimingChange` `23-34`; `reconcileFunding`, `FundingLoadReport` `sim-page/funding-reconcile.ts:12-33`; `SimDoc`, `SIM_KEY`, `SCHEMA2_PUBLISH_MESSAGE` `sim-page/sim-doc.ts:37-50`, `simDocProblems` `63-102`, `pointer` `112-118`, `parseSimDoc` `125-182`, `serializeSimDoc` `190-197`, `SIM_CODEC` `199-232`; `DocCodec` `sharing/doc-codec.ts:23-50`; `readRecord`/`writeRecord` `sharing/storage.ts:49-80`; `SimLevers`, `MIN_SCALE`/`MAX_SCALE`, `DEFAULT_LEVERS`, `LeverFormatError` `levers/types.ts:70-108`; `FINANCE_LIMITS` `levers/finance.ts:23-30`, `parseFinanceLevers` `240-272`, `buildFinance` `370-412`; `scaleTable` `levers/timers.ts:37-51`, `sameScale` `58-63`, `routeSharesOp` `175-185`; `resolveEnvelopes` `levers/resolve.ts:140-154`, `allNeeds` `157-164`, `fillNeeds` `167-184`, `Need` `18-22`, `LeverCapacity`/`leverCapacity` `199-212`; `createYieldRecompute` `levers/recompute.ts:42-133`, `createTableRecompute` `136-177`, `YieldRecompute` `19-33`; `localProgramColumn` `levers/view.ts:17-21`; `twinInput` `levers/apply.ts:91-110`, `lookupsOf` `124-136`, `applyLevers` `144-162`, `planOf` `66-81` (private, reached through `applyLevers`); `baseZoning` `scenario/policy.ts:23-35`; `SimInput` `scenario/types.ts:94-135`; `buildSimInput` `scenario/input.ts:58-97`, `Precompute` `99-157`, `precomputeOf` `363`; `inflowArrivals` `scenario/funding.ts:32-48`, `financeIndexOf` `260`, `isOff` `323-330`, `isOffered` `332-335`; `Treasury` arrivals `scenario/money.ts:58-73` (capped pools only, off days skipped, pools in order within a day); `leverStep` `scenario/scenario-host.ts:929-1011` (the sequence the compiler re-composes), `postResolving` `1013-1023`; `MONTH_DAYS` `timelapse/time.ts:10`; `MarketStep` `timelapse/types.ts:202-205`; fixtures `synthCity`/`synthPolicy` `scenario/fixtures/synth-city.ts:377,434`, `withBenchFunding`/`benchFundingLevers` `scenario/fixtures/bench-finance.ts:252,267`, `miniCity`, `miniPolicy`, `miniProjectsJson`, `mini-calibration.json` (as `levers/apply.spec.ts:27-35` builds them), `miniFinance` `scenario/fixtures/mini-finance.ts:29`, `baselineFixture`/`fundingOnly` `levers/fixtures/finance.ts:76,92`, `simDoc`/`paintedPolicy`/`paintedText` `server/test/sim-docs.ts`.

---

### Task 1: Measure today's compile of one zoning state (rule 24)

**Files:**
- Create (untracked): `scripts/measure-policy-compile.ts`
- Create: `.superpowers/sdd/policy-timeline/measure-compile.md`

**Interfaces:**
- Consumes: today's exported functions only (`loadScenario`, `resolveBrushRows`, `createLotIndex`, `resolveEnvelopes`, `allNeeds`, `createTableRecompute`/`createYieldRecompute`, `fillNeeds`, `applyLevers`, `precomputeOf`, `buildFinance`, `inflowArrivals`), as `scripts/bench-levers.ts:1-80` loads and runs them.
- Produces: the report the conductor reads; the per-unit costs that size Task 9's slicing.

- [ ] **Step 1: Find a live dataset.** In order: (a) a built dataset dir with `manifest.json` under `/Users/mindlace/Projects/sfhousing/pipeline/out/*/` or any worktree's `pipeline/out/*/`; (b) the production dataset, fetched read-only into `.superpowers/sdd/policy-timeline/data/<version>/` from the origin `scripts/data-local.ts` uses (manifest, `scenarios/fzp/*`, `policy.bin`, `gross.bin` when the manifest names it, `transit.json`; chunks only if there is no gross table); (c) the bench city (`synthCity()` + `synthPolicy()`), and every number is then labelled "bench city".
- [ ] **Step 2: Write the script** (run with `npx tsx scripts/measure-policy-compile.ts <datasetDir|--bench>`). For each scenario, time each unit separately with `performance.now()`, median of 5 runs after one warm-up, a fresh `SimInput`/views each run so no WeakMap memo hides work:
  - Scenario A, one added transit rule: `{ stopTypes: ['metro'], bands: DEFAULT_BANDS }` (`sim-page/policy.ts:75-78`), lots from `resolveBrushRows` per band (bench city: report "n/a, no transit.json").
  - Scenario B, one painted policy of 500 lots: the first 500 hostable rows by ascending parcel id, painted to 8 stories.
  - Units: `resolveEnvelopes`; `allNeeds` count; the recompute to done (gross table if present, else chunk records with every cell loaded), reporting its largest single `step(20)`; `fillNeeds`; `applyLevers` (levers `{ ...DEFAULT_LEVERS, rules|paint, compare: 'preFzp' }`); `precomputeOf(plan)`; a row diff of the new view against the default view over `envelopeStories`, `yield`, `hostable`, `localProgram`, `potentialRatio.fzp`, `storiesGap.fzp`, `pre.logit`; and the money loop for 480 months (`buildFinance` once, then per month `inflowArrivals` over the month's days and `isOffered` per programme on its first day).
  - Time to first frame (edit from month 1) = the sum of every unit but the money loop's 479 later months; time to all frames = everything. Also an edit dated month 241: first frame = 0 new work (the default view is reused), all frames = the zoning units.
- [ ] **Step 3: Run it**, record `uptime` before and after, and write `measure-compile.md`: dataset version (or "bench city"), machine, Node version, load, every unit's median, the two times per scenario, and the largest single unsliceable unit (`resolveEnvelopes`, `applyLevers`, `precomputeOf`) against the 50 ms slice bar. Mark "ballpark" if the load average exceeded 2.
- [ ] **Step 4: Report to the conductor** (your hand-back) the two times per scenario and, if any single unsliceable unit is over 40 ms, say so first: Task 9 cannot meet rule 19's bound without changing a hashed file, which is a conductor decision (Open question Q7). Commit only the report: `git add .superpowers/sdd/policy-timeline/measure-compile.md`, `docs: measure one zoning-state compile (policy-timeline rule 24)`.

### Task 2: Month math, the document types, `queriesOf4`, parser exports

**Files:**
- Modify: `src/lib/sim-page/policy.ts:195,219,268` (add `export`)
- Create: `src/lib/timeline/months.ts`, `src/lib/timeline/policy4.ts`
- Test: `src/lib/timeline/months.spec.ts`, `src/lib/timeline/policy4.spec.ts`

**Interfaces:**
- Produces (`months.ts`): `monthFirstDay(asOf: Day, m: number): Day` = `asOf + Math.floor((m - 1) * MONTH_DAYS) + 1`; `monthLastDay(asOf: Day, m: number): Day` = `asOf + Math.floor(m * MONTH_DAYS)`; `monthOfDay(asOf: Day, day: Day): number` (the m with first ≤ day ≤ last; `day <= asOf` gives 0).
- Produces (`policy4.ts`), S10 word for word plus the spec's table:

```ts
export type Selector =
  | { tag: 'transit'; stopTypes: StopType[] } | { tag: 'painted' }
  | { tag: 'category'; category: 'rentControl' | 'historic' | 'newerThan' }
  | { tag: 'routes' } | { tag: 'baseline' } | { tag: 'fund'; pool: string } | { tag: 'terms' };
export type Effect =
  | { tag: 'bands'; bands: TransitBand[] } | { tag: 'brushes'; brushes: CustomBrush[] }
  | { tag: 'protect'; years: number | null } | { tag: 'timing'; set: TimingSet }
  | { tag: 'scales'; entries: { pool: string; from: Day; scale: number }[] }
  | { tag: 'fund'; pool: Pool | null; programmes: Programme[] }
  | { tag: 'terms'; terms: Partial<Record<TermKey, number>> };
export interface Span { from: Day; to: Day | null; what: Effect }
export interface Policy { id: string; label: string; preset: string | null; on: boolean; where: Selector; spans: Span[] }
export interface SimPolicy4 { schema: 4; kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] } }
export type PolicyKind = keyof SimPolicy4['kinds'];
export const DEFAULT_POLICY4: SimPolicy4; // empty lists (rule 8)
export function queriesOf4(doc: SimPolicy4): { key: string; query: BrushQuery }[];
export function spanAt(p: Policy, day: Day): Span | null; // the span covering `day`, null when off or none
export function nothingInForce(doc: SimPolicy4): boolean; // rule 9: no `on` policy has a span
```

- [ ] **Step 1: Write the failing tests.** `months.spec.ts`: for `asOf = dayOf(2026, 3, 15)`, months 1, 2, 12, 13, 480: `monthFirstDay(m + 1) === monthLastDay(m) + 1`; month 1 first is `asOf + 1`; `monthOfDay` inverts both ends of every month 1..480; `monthOfDay(asOf, asOf) === 0`. `policy4.spec.ts`: `queriesOf4` of a document holding a transit policy (two spans, different bands) and a painted policy equals, as a set of keys, `queriesOf` of a schema 3 policy with the same rules and brushes, each key `queryKey` of its query, no duplicates; `spanAt` returns null for `on: false`, the covering span by `from`/`to` (null `to` open), null between spans; `nothingInForce(DEFAULT_POLICY4)` true, true for a doc whose only policies are off or have no spans, false once one `on` policy has a span.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline` — FAIL (modules missing).
- [ ] **Step 3: Implement.** `queriesOf4` walks every policy (on or off) and every span, using `ruleQueries` for `bands` (build the `ZoningRule` from `where.stopTypes` and `what.bands`) and `customQuery` for each brush, deduplicated by `queryKey` like `queriesOf` (`policy.ts:478-487`). Builder's call: off policies' queries are listed too, so switching a policy on needs no new brush round trip. No Svelte, no DOM in `src/lib/timeline/`.
- [ ] **Step 4: Run** the specs and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(timeline): schema 4 policy types and model-month arithmetic`.

### Task 3: `parsePolicy4` (rules 1, 3, 4, 5)

**Files:**
- Create: `src/lib/timeline/parse4.ts`
- Test: `src/lib/timeline/parse4.spec.ts`

**Interfaces:**
- Consumes: Task 2; `parseRule`, `parseCustom`, `parseTimingSet`, `PolicyFormatError`, `PresetLayerMode` (`sim-page/policy.ts`); `parseFinanceLevers`, `FINANCE_LIMITS` (`levers/finance.ts`); `LeverFormatError`.
- Produces: `parsePolicy4(json: unknown, opts: { asOf: Day | null; presetLayer?: PresetLayerMode }): SimPolicy4`, throwing `PolicyFormatError` whose `path` names the field (e.g. `kinds.money[1].spans[0].what.programmes[2].pool`). `asOf: null` skips only the month-alignment and dataset-date checks (Open question Q3).

- [ ] **Step 1: Write the failing tests**, one per case, asserting `e.path` exactly and the message by substring:
  - Shape: unknown and missing keys at every level; `schema` not 4 → `schema`; a `where.tag` not of its kind (`kinds.zoning[0].where.tag`); a `what.tag` that does not pair with `where.tag` (`…spans[0].what.tag`).
  - Rule 1: a permitting policy with `preset: null` or a preset different from any span's `set.preset` → `kinds.permitting[0].preset`; a zoning or money policy with a non-null preset.
  - Rule 3: duplicate policy id across kinds → second one's `.id`, `duplicate id`; an added pool id in two fund policies; a programme id in two fund policies; a later span naming another pool or another set of programme ids than span 0 (`…spans[1].what.programmes`); `label` of 81 characters → `.label`; a fund policy whose `what.pool.id` differs from `where.pool`, and one with `pool: null` naming a `u-` id.
  - Rule 4 (`asOf` given): `from` one day off a month start; `to` one day off a month end; `from` on the dataset date (before its next day); two overlapping spans; spans out of order; an open (`to: null`) span followed by another; each naming `…spans[j].from` or `.to`. With `asOf: null` the misaligned day parses, the overlap still fails.
  - Rule 5: each `what` through its schema 3 parser with the path re-rooted: a band list taller outward (`…what.bands`), a stop type unknown (`…where.stopTypes[0]`), a brush with radius 0 (`…what.brushes[0].strokes[0].radiusM`), a timing edit with reach `new` (`…what.set.edits[0].reach`), a scale of 11 (`…what.entries[0].scale`), an inflow day 47483 (`…what.pool.inflows[0].day`), an unknown term (`…what.terms.x`); `years` null for `newerThan` or non-null for another category (`…what.years`). Union limits over the whole document, with one policy per item: 13 distinct added pools → `kinds.money`; 25 distinct programme ids; 25 distinct scale `(pool, from)` pairs; each limit exactly at the bound parses.
  - Round trip: a document with one policy of every pair and two spans each parses to a deep-equal value; `presetLayer: 'reconcile'` accepts a retired preset id that `'strict'` rejects.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/parse4.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** House guards as in `policy.ts:134-172`. Each `what` goes through one call of its schema 3 parser on a synthetic value under a sentinel path, the thrown path re-rooted: bands as `parseRule({ id, kind: 'transit', stopTypes, bands }, '#')` (`#.stopTypes` → `<policy>.where.stopTypes`, `#.bands` → `<span>.what.bands`); scales, fund and terms as `parseFinanceLevers({ baselineScale, pools, programmes, terms }, '#')` with the unused lists empty (`#.baselineScale` → `.what.entries`, `#.pools[0]` → `.what.pool`, `#.programmes` → `.what.programmes`, `#.terms` → `.what.terms`; `LeverFormatError` rethrown as `PolicyFormatError`). Builder's calls: a policy id is a non-empty string of at most 80 characters (schema 3 rule ids are free strings and become policy ids in Task 4); brush ids are unique within one span; `label` is not trimmed; spans may be empty; scale entries are counted as distinct `(pool, from)` pairs and programmes and pools by distinct id, because spans repeat ids by rule 3.
- [ ] **Step 4: Run** the spec and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(timeline): parse schema 4 policy documents`.

### Task 4: `upgradePolicy` (the table, rules 1, 2, T6)

**Files:**
- Create: `src/lib/timeline/upgrade.ts`
- Test: `src/lib/timeline/upgrade.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 3; `SimPolicy`, `OBSERVED_TIMING`, `timingLabel`, `canonicalJson`.
- Produces: `upgradePolicy(p: SimPolicy, asOf: Day): SimPolicy4`.

- [ ] **Step 1: Write the failing tests.** Every policy made has one span `{ from: asOf + 1, to: null }`; `parsePolicy4(upgradePolicy(p, asOf), { asOf })` succeeds for every case below and deep-equals its input:
  - `upgradePolicy(DEFAULT_POLICY, asOf)` deep-equals `DEFAULT_POLICY4` (Open question Q1).
  - Two rules → two zoning `transit` policies in rule order, ids the rule ids; `custom` of paint, erase, paint → one `painted` policy holding the three brushes in order; empty `custom` → none.
  - Protections `{ rentControl: true, historic: false, newerThanYears: 30 }` → `category` policies `rentControl` (`years: null`) and `newerThan` (`years: 30`), in that order; none for `historic`.
  - Timing: `current` a `benchmarkPermits` set → one `routes` policy, `on: true`, `preset: 'benchmarkPermits'`, label `timingLabel(set)`; `saved` present → a second, `on: false`, label the saved label, preset the saved set's; `current` deep-equal to `OBSERVED_TIMING.current` → no current policy (Q1).
  - Funding (`fundingOnly()` plus a programme on a baseline pool and typed terms): one `baseline` policy holding `baselineScale` unchanged; one `fund` policy per added pool with its programmes (`where.pool` its id); one `fund` policy with `pool: null` per baseline pool that has added programmes; one `terms` policy; none for empty parts. Every `preset` but the permitting ones is null.
  - Ids are unique across the document even when a rule id equals a fixed id (a rule named `painted`).
  - A schema 2 document opened by `parseSimPolicy(json, { schema2: 'upgrade' })` then upgraded has no money policies.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/upgrade.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** Builder's calls: fixed ids `painted`, `protect-rentControl`, `protect-historic`, `protect-newerThan`, `timing`, `timing-saved`, `baseline`, `fund-<pool id>`, `terms`, transit policies keep their rule id, a collision gets `-2`, `-3`… appended; labels `Transit rule`, `Painted zoning`, `Protect rent-controlled buildings`, `Protect historic buildings`, `Protect buildings newer than <n> years`, `timingLabel(set)` or the saved label, `City funding scale`, the added pool's label or `Programmes on <pool id>`, `Market terms`. Deep-clone every `what` from `p`.
- [ ] **Step 4: Run** the spec — PASS.
- [ ] **Step 5: Commit** `feat(timeline): open schema 3 policies as schema 4`.

### Task 5: `reconcilePolicy4` and `programmeTermGaps`

**Files:**
- Create: `src/lib/timeline/reconcile4.ts`
- Test: `src/lib/timeline/reconcile4.spec.ts`

**Interfaces:**
- Consumes: Tasks 2 to 4; `reconcileTiming`, `TimingChange` (`sim-page/reconcile.ts`); `reconcileFunding`, `FundingLoadReport` (`sim-page/funding-reconcile.ts`); `resolveTerms`, `missingTerms`, `MARKET_TERMS` (`$lib/sim/finance`).
- Produces:

```ts
export interface Policy4Report {
  timing: { policy: string; change: TimingChange }[]; // change.set: 'current' when the policy is on, 'saved' when off
  funding: Omit<FundingLoadReport, 'upgradedFrom'>;   // today's shape, summed over the document
}
export function reconcilePolicy4(doc: SimPolicy4, cal: Calibration): { doc: SimPolicy4; report: Policy4Report };
export function programmeTermGaps(doc: SimPolicy4): { path: string; programme: string; term: TermKey }[];
```

- [ ] **Step 1: Write the failing tests.**
  - `reconcilePolicy4 drops a programme naming an unknown baseline pool and reports it`: a `fund` policy with `pool: null`, `where.pool: 'nope'`, one programme → the programme is gone from every span, `report.funding.droppedProgrammes` is `[{ id, label, pool: 'nope', reason: 'pool', term: null }]`.
  - A scale entry on an unknown pool is dropped from every span and reported in `droppedScales`; a guarantee programme with no `guaranteeRateCut` typed in any `terms` policy in force during its spans is dropped with `reason: 'term'`; the same programme is kept when an `on` `terms` policy covering all its spans types the cut, and dropped when that terms policy ends before the programme's last span (gap found by `programmeTermGaps`).
  - A permitting policy whose preset no longer resolves the same against `cal` is re-fitted in every span and reported with `change.kind: 'preset-refit'`, `policy` its id; its `preset` field follows `preset-unavailable` to `observed`.
  - A calibration without `baselineFunding` and a document with money policies: nothing dropped, `unusable: true`.
  - Idempotence and identity: reconciling the result again returns the same object (`toBe`) and an empty report; a document needing nothing back by identity (the house rule, `funding-reconcile.ts:1-6`); never throws on any fixture.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/reconcile4.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** Permitting: each span's set through `reconcileTiming({ current: set, saved: null }, cal)`, relabel each change's `set`. Money: each span's `what` as a `FinanceLevers` through `reconcileFunding` with terms `{}` for the pool checks; the term check is `programmeTermGaps`, which, for each programme, cuts its policy's spans at every `from`/`to + 1` of the `on` terms policies and resolves `resolveTerms(MARKET_TERMS, merged)` on each piece (lower policy wins a key typed twice, as Task 6). Builder's call: off fund policies are checked against the on terms policies, so turning one on later cannot make the compile throw without a reconcile.
- [ ] **Step 4: Run** the spec, then `npm run test:unit` — PASS.
- [ ] **Step 5: Commit** `feat(timeline): reconcile schema 4 policies with their dataset`.

### Task 6: Policies in force and how they combine (rules 10 to 15)

**Files:**
- Create: `src/lib/sim/world/policy/combine.ts`, `src/lib/sim/world/policy/test/fixtures.ts`
- Test: `src/lib/sim/world/policy/combine.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`spanAt`); `compileLevers`, `paintedLots`, `DEFAULT_POLICY`, `queryKey` (`sim-page/policy.ts`); `compileTiming` (`sim-page/timing.ts`); `scaleTable` (`levers/timers.ts`).
- Produces:

```ts
export interface Active { index: number; policy: Policy; span: Span }
export interface InForce { zoning: Active[]; permitting: Active[]; money: Active[] } // list order
export function inForceAt(doc: SimPolicy4, day: Day): InForce;
export type ZoningLevers = Pick<SimLevers, 'rules' | 'paint' | 'protect' | 'localProgramStreamlined'>;
export function zoningLevers(f: InForce, lots: Record<string, ParcelId[]>, lp: boolean): ZoningLevers;
export function zoningKeyOf(z: ZoningLevers): string; // canonical text, order-free where resolution is
export interface Permitting {
  speed: StageScale; speedNew: { from: Day; scale: StageScale }[];
  routeShares: Record<Pathway, number> | null; localProgramStreamlined: boolean;
}
export function permittingOf(f: InForce): Permitting;
export function moneyLeversOf(f: InForce): FinanceLevers;
```

- Produces (`test/fixtures.ts`): `miniDoc(...policies)` and a builder per pair, with spans given by month numbers (`span(asOf, fromMonth, toMonth | null, what)`); Task 9 adds the compile context and yields.

- [ ] **Step 1: Write the failing tests** (hand-built cases on the mini city's parcel ids):
  - Rule 10: two transit policies naming one lot at 5 and 7 stories → its `rules` entry is 7, in either list order; `zoningKeyOf` equal for both orders.
  - Rule 11: painted A (lot x at 4, then erase x, then y at 6) above painted B (x at 9) → x 9, y 6; swapped order → x 9 still (A's erase never reaches B), y 6; B above A with A painting x at 4 last → x 4.
  - Rule 12: `historic` from one policy and `rentControl` from another → both on; `newerThan` 20 and 40 → 40.
  - Rule 13: two permitting policies with `all` timers 0.5 and 0.5 on one stage → `speed` 0.25; 0.04 overall clamps to `MIN_SCALE`; a `new` timer 0.5 in a span from day d → `speedNew` `[{ from: d, scale }]` with that stage at 0.5 and no `all` timer folded in; floors stay as each set carries them (no re-resolve).
  - Rule 14: route shares from the lowest policy that sets them; none set → null; one policy with `localProgramStreamlined: false` among two → false; none in force → true.
  - Rule 15 (Review Focus 1): `money: same pool and day, lower wins` — two `baseline` policies with an entry for one pool on one day → the lower's scale, entries sorted by pool then `from` as `parseFinanceLevers` requires; two `terms` policies typing one key → the lower's value.
  - Off and out of span: an `on: false` policy and a policy whose span starts later are absent from `inForceAt`.
  - Review Focus 4, `missing lots`: an `on` painted policy whose query key is absent from `lots` → `LeverFormatError` with that key in its message; the same policy `off` → no error.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/world/policy/combine.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** Rules: `compileLevers({ ...DEFAULT_POLICY, rules }, lots)` for the transit policies in force, then reduce to the highest stories per lot and emit one `StoryEdit` per story value, lots sorted (resolution takes the max, `resolve.ts:80-93`). Paint: `paintedLots({ ...DEFAULT_POLICY, custom: brushes }, lots)` per painted policy, top of the list first, later policies overwriting; emit one edit per story value (each lot once, so order cannot matter). `source` is never set (it changes nothing in resolution). `zoningKeyOf` = `canonicalJson` of `{ rules: [[lot, n]…], paint: [[lot, n]…], protect, lp }` with pairs sorted by lot. `speed` = `scaleTable` of every `all` timer of every `compileTiming(set).timers` in force, `'inFlight'`; each policy's `new` timers become one entry `{ from: span.from, scale: scaleTable(newOnly, 'new') }`, skipped when identity; entries sorted by `from`, then document order. Money: union of the `what`s in force (scales merged and deduped per `(pool, from)`, lower wins; pools and programmes in document order; terms merged, lower wins).
- [ ] **Step 4: Run** the spec and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(sim): combine the policies in force in a month`.

### Task 7: The money of a month (rules 6, 7, 15, 16 money part)

**Files:**
- Create: `src/lib/sim/world/policy/money.ts`
- Test: `src/lib/sim/world/policy/money.spec.ts`

**Interfaces:**
- Consumes: Task 2 (months), Task 6 (`moneyLeversOf`); `buildFinance`; `financeIndexOf`, `isOff`, `isOffered`, `inflowArrivals`.
- Produces:

```ts
export function moneyOrder(doc: SimPolicy4, base: SimInput['finance']): { pools: string[]; programmes: string[] };
export interface MoneyTrack {
  /** Call for m = 1, 2, … in order; null when `input.finance` is undefined (frames then have `finance: null`). */
  month(m: number, levers: FinanceLevers): { frame: FinanceFrame; key: string } | null;
}
export function createMoneyTrack(doc: SimPolicy4, input: SimInput): MoneyTrack;
```

- [ ] **Step 1: Write the failing tests** on `miniFinance()` / `baselineFixture()` and `fundingOnly()`:
  - Order: `pools`/`programmes` ids are the baseline's in their order, then added ones in document order, the same arrays in every month, one entry per id though spans repeat it.
  - Definitions: a programme whose second span changes `minHomes` carries the new value from that span's month; in a month where its policy is not in force it carries the last definition in force, and before its first span the first span's (builder's call).
  - `offered on the first day only` (Review Focus 2): a programme with `to` on day 10 of month m → `offered` 1 in month m, 0 from m + 1; a scale-0 entry on its pool from month k's first day → 0 from month k (rule 7).
  - Arrivals: each month's list equals, by `(day, pool id, dollars)`, `inflowArrivals` over the month's days for the capped pools of `buildFinance(base, levers, asOf)`, off days skipped, ordered by day then frame pool index (`money.ts:58-73`); `dataset-date inflow once, month 1` (Review Focus 3): a `once` inflow on `asOf` is in month 1 and nowhere else.
  - Spans cut settings (rule 6): a scale entry dated before the span's start applies from the span's month only; inflows of an added pool arrive only in months its fund policy is in force.
  - Identity key (rule 16): raising an inflow's dollars leaves every month's `key` unchanged and changes `arrivals`; adding a fund whose span starts in month m leaves months before m's keys unchanged and changes m's; changing a programme setting in a span from month m changes m's key only from m; a programme not on offer changes no key.
  - `createMoneyTrack(doc, inputWithoutFinance).month(1, …)` is null.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/world/policy/money.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** Per month: `buildFinance(input.finance, levers, input.asOf)` memoised on `canonicalJson(levers)` for the track's life; `offered[g]` from `isOffered(financeIndexOf(fin), gIn, monthFirstDay(m))` for programmes present in `fin`, else 0; arrivals from `fin.pools` exactly as `Treasury` builds them, over `[m === 1 ? asOf : first, last]`, pool given as the frame index of its id. `key` = `canonicalJson({ offered: [[id, def]…], pools: [[id, def without inflows]…] for the offered programmes' pools, terms, slope })`. No arithmetic on dollars beyond what `buildFinance` did.
- [ ] **Step 4: Run** the spec — PASS.
- [ ] **Step 5: Commit** `feat(sim): the money frame of each month`.

### Task 8: Interning (rule 17)

**Files:**
- Create: `src/lib/sim/world/policy/intern.ts`
- Test: `src/lib/sim/world/policy/intern.spec.ts`

**Interfaces:**
- Produces:

```ts
export function digest128(s: string): string;      // 32 lowercase hex characters
export function frameIdOf(key: string): number;    // same key, same id, for the worker's life; ids from 1
export function serialOf(o: object): number;       // stable per object identity (WeakMap), from 1
export interface WeakLike<T> { deref(): T | undefined }
export interface ViewInfo { capacity: LeverCapacity; unknownLots: number }
export interface ViewCache {
  get(key: string): ZoningView | undefined;  // a live view, or undefined
  put(key: string, view: ZoningView, info: ViewInfo): void;
  info(view: ZoningView): ViewInfo | undefined;
  size(): number;                             // live entries, for tests
}
export function createViewCache(weak?: <T extends object>(v: T) => WeakLike<T>): ViewCache;
export const VIEWS: ViewCache;                // the worker's cache, real `WeakRef`s
```

Decisions (builder's calls, each one line):
- **Frame ids** are interned on `digest128(key)` in a module `Map<string, number>` that is never cleared: the table "lives as long as the worker" (rule 17) while holding 32 characters per distinct frame, not keys that can carry tens of thousands of lot ids.
- **`digest128`** is MurmurHash3 x86 128 over the UTF-16 code units with `Math.imul` and shifts only (determinism ban list); a collision needs about 2^64 distinct frames, which a worker never makes.
- **Views** are held by `WeakRef` in the cache and strongly by the frames of every timeline and by every compile in progress, so a view lives exactly while a timeline in use refers to it; a `FinalizationRegistry` deletes a dead key, and `get` treats a dead `WeakRef` as a miss. The `weak` seam makes this testable without a garbage collector.
- **Serials** (`serialOf`) put the input and layer objects' identity in every key, so frames of different datasets never share an id.

- [ ] **Step 1: Write the failing tests:** `digest128` is stable across calls, differs for keys differing in one character, and handles astral characters; `frameIdOf` gives one id per distinct key and the same id again later; `serialOf` per object; with a fake `weak` whose refs can be "collected": `get` returns the stored view while live, undefined after collection, `size()` drops, and a `put` after collection stores the new view; `info` follows the view.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/world/policy/intern.spec.ts` — FAIL.
- [ ] **Step 3: Implement** as decided.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(sim): intern policy frames and zoning views by content`.

### Task 9: One zoning state's view, in slices (rules 18, 20)

**Blocked on Open question Q2** (how the compiler gets yields for `Need`s); build with the recommended `YieldSource` unless the conductor rules otherwise.

**Files:**
- Create: `src/lib/sim/world/policy/zoning-view.ts`
- Modify: `src/lib/sim/world/policy/test/fixtures.ts` (`miniCompileCtx`, `fakeYields`)
- Test: `src/lib/sim/world/policy/zoning-view.spec.ts`

**Interfaces:**
- Consumes: Tasks 6, 8; `resolveEnvelopes`, `allNeeds`, `fillNeeds`, `applyLevers`, `twinInput`, `precomputeOf`, `DEFAULT_LEVERS`, `LeverFormatError`.
- Produces:

```ts
export interface YieldSource {
  /** Today's `createTableRecompute` or `createYieldRecompute`, closed over the runner's table or chunks and clock. */
  recompute(parcels: ScenarioParcels, needs: readonly Need[]): YieldRecompute;
  /** Cells whose chunks failed to load. */
  failedCells(): readonly string[];
}
export interface ViewJob {
  step(budgetMs: number): boolean;           // true when the view is built
  readonly done: number; readonly total: number; // needs, as `resolving` reports them
  cellsNeeded(): string[];
  result(): { view: ZoningView; info: ViewInfo }; // after step returned true
}
export function createViewJob(
  input: SimInput, layers: LayerCtx, yields: YieldSource, now: () => number,
  z: ZoningLevers, base: 'plan' | 'preFzp'
): ViewJob;
export function touchedRows(a: ZoningView, b: ZoningView): Int32Array; // ascending rows
```

- Produces (`test/fixtures.ts`): `miniCompileCtx(opts?: { finance?: boolean; market?: boolean; windowMonths?: number }): CompileCtx` (mini city as `levers/apply.spec.ts:27-35`, `miniFinance()` when asked); `fakeYields(): YieldSource` whose recompute fills each need with `{ stories, cap, yield: FILL_LEVELS.map((_, f) => (f + 1) * stories), hostable: true }` one need per call of `step` work unit, and `fakeRows(needs)` giving the same rows for the reference path.

- [ ] **Step 1: Write the failing tests:**
  - Parity with today (rule 18): for painted, transit and protected `ZoningLevers` on the mini city, the job's `view.parcels` equals, column by column (`envelopeStories`, `yield`, `hostable`, `localProgram`, `potentialRatio`, `storiesGap`), `applyLevers(input, layers, { ...DEFAULT_LEVERS, ...z }, fillNeeds(resolveEnvelopes(...), fakeRows(...))).plan.parcels`; `view.pre` deep-equals `precomputeOf` of that plan; `info.capacity` and `info.unknownLots` equal `applyLevers`' `capacity` and `unknownLots`.
  - `lp: false` gives an all-zero `localProgram` (`view.ts:17-21`).
  - `base: 'preFzp'` with no zoning levers: `view.parcels` equals `twinInput(input, layers, 'preFzp').parcels` column by column; with any zoning lever → `LeverFormatError` at `base` (Open question Q5).
  - Slicing: with a fake clock advancing 1 per need and `step(3)`, each call computes at most 3 needs beyond the first unit, `done`/`total` grow to the need count, and the result equals the one-call result.
  - `touchedRows`: for the default view and a view painting 7 lots of which 2 already sit at the painted height, exactly the 5 changed rows; identical views → empty.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/world/policy/zoning-view.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** Units, each finished before a budget check (the order `leverStep` runs, `scenario-host.ts:929-1011`): `resolveEnvelopes(layers, levers, input.asOf)`; then `yields.recompute(input.parcels, allNeeds(r)).step(remaining)` until done; then `fillNeeds` + `applyLevers(input, layers, levers, filled)` with `levers = { ...DEFAULT_LEVERS, ...z, compare: 'preFzp' }` (the preFzp twin is the cheap memoised one; only `.plan`, `.capacity`, `.unknownLots` are used); then `pre = precomputeOf(plan)`. The view is `{ parcels: plan.parcels, pre }`; the plan `SimInput` is not kept. `touchedRows` compares the columns above plus `pre.logit` row by row.
- [ ] **Step 4: Run** the spec and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(sim): build a zoning state's view in slices`.

### Task 10: `compileTimeline` (rules 16 to 21, 23; S6, S13)

**Files:**
- Create: `src/lib/sim/world/policy/compile.ts`
- Test: `src/lib/sim/world/policy/compile.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 5 to 9; `routeSharesOp`; `LeverFormatError`.
- Produces (S13 word for word, plus Q2's fields):

```ts
export interface CompileCtx {
  input: SimInput; layers: LayerCtx; windowMonths: number;
  yields: YieldSource;      // Q2
  now?: () => number;       // Q2; default performance.now
}
export interface TimelineCompile {
  step(budgetMs: number): boolean;
  progress(): { done: number; total: number; failedCells: string[] };
  result(): PolicyTimeline;
  capacity(): LeverCapacity;
  unknownLots(): number;
}
export function compileTimeline(
  doc: SimPolicy4, lots: Record<string, ParcelId[]>, ctx: CompileCtx, base: 'plan' | 'preFzp'
): TimelineCompile;
```

How it works (decisions):
- **Checks, synchronous in `compileTimeline`:** `reconcilePolicy4(doc, ctx.input.calibration).doc !== doc` → throw `LeverFormatError('policy', 'expected a reconciled document')`; `parsePolicy4`'s span checks with `asOf = ctx.input.asOf` re-run on `doc` (a misaligned span throws `LeverFormatError`); nothing else runs before the first `step`.
- **Month content.** For month m, `inForceAt(doc, monthFirstDay(asOf, m))`; in-force sets change only at span boundaries, so zoning levers, `zoningKeyOf` and `permittingOf` are memoised per distinct set of active `(policy index, span index)`; money is per month (`MoneyTrack`). `market` is the `logOdds` of the last `input.market` step with `from <= monthFirstDay(m)`, else 0 (rule 21). `calibration` is `input.calibration`; `newCalibration` is `routeSharesOp(shares)(calibration, parcels).cal`, memoised per shares key so equal shares give one object.
- **Frame key** (rule 16, memo keys left to the builder): `canonicalJson({ i: serialOf(input), l: serialOf(layers), b: base, z: digest128(zoningKeyOf), r: shares, s: speed with 1-entries dropped, n: speedNew, k: market, f: money key or null })`, id `frameIdOf(key)`. The calibration is the input's, covered by `i`. A frame object is built per month (`finance` per month for its arrivals and for rule 15's "definition in force that month"); months with equal id share `view`, calibrations and the scale objects.
- **Zoning views** come from `VIEWS.get(digest)` or a `ViewJob`, then `VIEWS.put`; the compile holds every view it uses strongly.
- **Slicing (rule 19):** `step(budgetMs)` works month by month from `readyThrough() + 1`, checking `now() - t0 >= budgetMs` after each unit (a month's assembly, or a `ViewJob.step` call with the remaining budget), and always makes one unit of progress, so a call overruns by at most one unit (one lot-cell recompute, or one of Task 9's atomic units; Task 1 measured their size, Q7). A view job waiting on chunks makes no progress: `step` returns false and the runner calls again when chunks arrive.
- **`changes()`** lists m >= 2 with `id(m) !== id(m - 1)`. **`touched(m)`**: for m in `changes()`, `touchedRows(view(m - 1), view(m))` when the views differ, else empty; `touched(1)` is null (no month before it); a month not in `changes()` gives an empty array (builder's calls).
- **`progress()`**: `done`/`total` summed over this compile's view jobs (it grows as states are resolved); `failedCells` = `ctx.yields.failedCells()` filtered to the cells those jobs need (as `leverStep` filters, `scenario-host.ts:953`).
- **`result()`** throws before month 1 exists; **`capacity()`/`unknownLots()`** throw before `step` returned true, then give the `ViewInfo` of month `windowMonths`' view (rule 23).
- `frameAt(m)` throws `RangeError` outside `1..readyThrough()`.

- [ ] **Step 1: Write the failing tests** (mini city, `fakeYields`, `windowMonths` 60 unless stated):
  - `two spans give three frames`: a painted policy with spans months 13–24 at 6 stories and 25–open at 8 → `changes()` `[13, 25]`, three distinct ids, months 1–12 equal to the default document's ids.
  - Rule 17 across compiles: compile a document, then the same document with one more span from month 30 → ids equal for months 1–29 and the views `toBe` the same objects while both timelines are referenced.
  - Rule 20: `touched for an added paint policy` — `touched(m)` at the month the policy starts is exactly the rows whose view row changed (checked by a column-by-column scan of the two views in the test); a month whose change is money-only gives an empty array.
  - Review Focus 5, `removing a painted policy`: the document without the policy differs from month 1, `touched(1)` is null, and comparing views month 1 of the two timelines with `touchedRows` gives exactly the lots it raised.
  - `finance: null in every frame` when the calibration lacks `baselineFunding` (no `finance` on the input), with money policies in force.
  - Market (rule 21): an input whose `market` has a second step dated in month 7 → `market` changes at month 7 and month 7 is in `changes()`.
  - Unreconciled: a document with a programme on an unknown baseline pool → `compileTimeline` throws `LeverFormatError`; the reconciled document compiles.
  - Slicing: with a fake clock and `step(1)` repeatedly, `readyThrough()` grows monotonically, `result()` works after the first frame, `frameAt(readyThrough() + 1)` throws, `step` eventually returns true and the frames equal a one-call compile's; `capacity()` before completion throws, after equals the view info of month `windowMonths`; a span starting after the window changes nothing in the window.
  - `progress()`: `total` equals the need count of the document's zoning states, `failedCells` passes through only the cells those jobs need.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/world/policy/compile.spec.ts` — FAIL.
- [ ] **Step 3: Implement** as decided.
- [ ] **Step 4: Run** the spec, `npm run check`, then `npm run test:unit` — PASS.
- [ ] **Step 5: Commit** `feat(sim): compile a dated policy into monthly frames`.

### Task 11: `firstDifference`, `comparisonOf`, `lookupsAt` (rule 22; S6, S13)

**Files:**
- Create: `src/lib/sim/world/policy/compare.ts`, `src/lib/sim/world/policy/lookups.ts`
- Test: `src/lib/sim/world/policy/compare.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 10; `lookupsOf`, `scaleTable`, `MIN_SCALE`/`MAX_SCALE`.
- Produces: `firstDifference(a: PolicyTimeline, b: PolicyTimeline): number | null`; `comparisonOf(doc: SimPolicy4): { doc: SimPolicy4; base: 'plan' | 'preFzp' }`; `lookupsAt(frame: PolicyFrame): LeverLookups`.

Decisions: arrivals are compared as sequences of `(pools[pool].id, day, dollars)`, since pool indices differ between timelines whose documents add a fund (builder's call); months are compared up to `min(a.readyThrough(), b.readyThrough())`, and when no difference is found there but the two `readyThrough()` differ, the answer is that minimum plus one, so a runner never keeps a month it has not compared (builder's call); `lookupsAt` builds a `SimInput` with the frame's view parcels and calibration, `inFlightScale: speed`, `newProjects: { calibration: newCalibration, scale }` with `scale` the per-stage product of `speed` and every `speedNew` scale clamped to `[MIN_SCALE, MAX_SCALE]`, and calls `lookupsOf`; results are memoised by frame id in a small map of at most 8 entries (builder's call: lookups tables are large).

- [ ] **Step 1: Write the failing tests:**
  - Rule 17 / `firstDifference`: an edit dated month m (a span from m) → m; `raises one inflow dated in month m` → m; `adding a fund whose span begins in month m` → m; `changing a programme's setting in a span that begins in month m` → m; `changes only a label` → null; `adds a policy that is off` → null; identical documents → null.
  - `comparisonOf`: `DEFAULT_POLICY4` and a document of off policies → `{ doc, base: 'preFzp' }` (same `doc`); anything in force → `{ doc: DEFAULT_POLICY4, base: 'plan' }`; adding an off policy to either does not change the answer; compiling `DEFAULT_POLICY4` on `'preFzp'` gives frames whose `view.parcels` columns, `calibration` and money equal `twinInput(input, layers, 'preFzp')`'s and `buildFinance(input.finance, empty, asOf)`'s.
  - `lookupsAt` of a frame of an upgraded `sb423Clock` document equals `lookupsOf(applyLevers(...).plan)` today (`inFlight` and `fresh`).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/world/policy/compare.spec.ts` — FAIL.
- [ ] **Step 3: Implement** as decided.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(sim): the comparison, first differences and frame lookups`.

### Task 12: The round trip against today's levers (acceptance)

**Files:**
- Create: `src/lib/sim/world/policy/roundtrip.spec.ts`

**Interfaces:**
- Consumes: everything above; today's `compileLevers`, `applyLevers`, `buildFinance`, `isOffered`, `inflowArrivals`, `scaleTable`, `resolvePreset`.

- [ ] **Step 1: Write the tests.** Fixture set of schema 3 documents on the mini city with `miniFinance()` and a market: the default; each available preset (`PRESETS.filter((p) => p.available)`, sets from `resolvePreset(id, cal)`), asserting the `sb423Clock` fixture really carries a `new` timer (so the `speedNew` case is not vacuous); two rules; paint, erase, paint; all three protections; custom timers (`setStageMonths`) with a `new` preset beside them; custom route shares and `localProgramStreamlined: false`; baseline scales including one dated before `asOf` and one of 0; `fundingOnly()` plus a programme on a baseline pool; typed terms. For each `p`: `doc = reconcilePolicy4(upgradePolicy(p, asOf), cal)` (assert the report empty), compile on `'plan'` to completion over 120 months, and today's `li = applyLevers(input, layers, compileLevers(p, lots), fillNeeds(resolveEnvelopes(...), fakeRows(...)))`. Every month m:
  - the `parcels` columns equal `li.plan.parcels`' and `pre` deep-equals `precomputeOf(li.plan)`;
  - `calibration` is `li.plan.calibration`; `newCalibration` deep-equals `li.plan.newProjects.calibration`;
  - `speed` `sameScale` `li.plan.inFlightScale ?? identity`; the clamped product of `speed` and every `speedNew` scale `sameScale` `li.plan.newProjects.scale`;
  - `finance.pools`/`programmes` ids and definitions equal `li.plan.finance`'s, `terms` and `slope` equal; `offered[g]` equals `isOffered(financeIndexOf(li.plan.finance), g, monthFirstDay(m))`; `arrivals` equal `inflowArrivals` over month m's days (month 1 from `asOf`) of `li.plan.finance`'s capped pools, off days skipped.
  - `changes()` is empty (one frame), and `firstDifference` of two compiles of the same document is null.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/world/policy/roundtrip.spec.ts` — PASS (Tasks 2 to 11 built the code). A failure is a defect in an earlier task: fix it there, with a test in that task's spec.
- [ ] **Step 3: Commit** `test(sim): dated policies reproduce today's levers`.

### Task 13: The schema 4 codec and the autosave key (rules 25, 26)

**Files:**
- Create: `src/lib/timeline/sim-doc4.ts`
- Test: `src/lib/timeline/sim-doc4.spec.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5; `canonicalJson`, `PolicyFormatError`; `MAX_PLAN_BYTES`, `TITLE_MAX_CHARS`, `FUTURE_SCHEMA_MESSAGE`, `OPS_MAX`, `quantize`, `Result`, `PlanError` (`$lib/plan`); `parseSimDoc`, `SCHEMA2_PUBLISH_MESSAGE`, `SIM_CODEC` (`sim-page/sim-doc.ts`); `DocCodec`; `readRecord`, `writeRecord`, `LocalPlanRecord`.
- Produces:

```ts
export interface SimDoc4 { schema: 4; kind: 'sim'; datasetVersion: string; title?: string; policy: SimPolicy4 }
export const SIM_DOC4_SCHEMA = 4;
export const SIM_KEY4 = 'sfhousing:sim:v2';
export interface OpenDataset { asOf: Day; calibration: Calibration }
export function parseSimDoc4(text: string, asOf: Day | null): Result<SimDoc4>; // strict: schema 4 only
export function openSimDoc4(text: string, ds: OpenDataset):
  Result<{ doc: SimDoc4; upgradedFrom?: 2 | 3; report: Policy4Report }>;     // 2, 3, 4; reconciled
export function serializeSimDoc4(d: SimDoc4): string;                          // canonical, strokes quantized
export function simDoc4Problems(d: SimDoc4): PlanError[];                      // stroke limits, then too-large
export function createSimCodec4(ds: OpenDataset): DocCodec<SimDoc4>;
export function migrateSimAutosave(storage: Storage, ds: OpenDataset): 'none' | 'migrated' | 'kept';
```

- [ ] **Step 1: Write the failing tests:**
  - `strict publish refuses schema 3`: `parseSimDoc4(serializeSimDoc(simDoc()), asOf)` → `unknown-schema` at `/schema` with `SCHEMA2_PUBLISH_MESSAGE` (today's kind of message); schema 2 likewise; schema 5 → `future-schema`.
  - `reconcile opens it`: `openSimDoc4` of a schema 3 body (with paint, timing and funding) → ok, `upgradedFrom: 3`, `doc.policy` equal to `reconcilePolicy4(upgradePolicy(p, asOf), cal).doc`; a schema 2 body → `upgradedFrom: 2`; a schema 4 body → no `upgradedFrom`; a body with a programme on an unknown pool → ok with the drop reported.
  - `a stored schema 3 body loads`: `readRecord(storage, createSimCodec4(ds))` of a record under `SIM_KEY4` holding a schema 3 body → `ok` with `upgradedFrom: 3`; a stored `/s` body (`paintedText()`) through `codec.load` → ok.
  - Strict schema 4: a policy error maps to a JSON pointer (`kinds.zoning[0].spans[1].from` → `/policy/kinds/zoning/0/spans/1/from`) with `bad-field`; a programme with a term gap → `bad-field` at its pointer (`programmeTermGaps`); a document over `MAX_PLAN_BYTES` canonical bytes → `too-large`; strokes over `OPS_MAX` across all painted spans → `too-many-ops`; `serializeSimDoc4` is stable under key order and round-trips through `parseSimDoc4`.
  - Codec: `storageKey` is `SIM_KEY4`, `api` `/api/policies`, `path(id)` `/s/<id>`, `empty` is `DEFAULT_POLICY4`, `isEmpty` is `nothingInForce` (rule 9), `publishable` drops nothing (no snapshot in schema 4).
  - `migrateSimAutosave`: a record under `sfhousing:sim:v1` and none under v2 → v2 holds the upgraded, reconciled document with `savedAt` and `lastPublished` carried, v1 left as is, returns `'migrated'`; a v2 record already present → `'kept'`, v2 untouched; neither → `'none'`; a corrupt v1 → `'none'`, nothing written.
  - Nothing switched on: `SIM_CODEC.storageKey` is still `sfhousing:sim:v1` and `CODECS.sim` is still `SIM_CODEC` (`server/sharing/codecs.ts:6-9`).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/timeline/sim-doc4.spec.ts` — FAIL.
- [ ] **Step 3: Implement** after `parseSimDoc` (`sim-doc.ts:125-182`): schema check first, then `kind`, `datasetVersion`, `title`, then the policy (`parsePolicy4` strict) and the term-gap check, then `simDoc4Problems`. `openSimDoc4` sends schema 2/3 through `parseSimDoc(text, 'reconcile')`, then `upgradePolicy`, then `reconcilePolicy4`; schema 4 through `parsePolicy4` with `presetLayer: 'reconcile'`, then `reconcilePolicy4`. Builder's calls: `migrateSimAutosave` leaves the v1 key so an older tab keeps working, and carries `lastPublished` (the id is still a valid link).
- [ ] **Step 4: Run** the spec, then `npm run test:unit` — PASS.
- [ ] **Step 5: Commit** `feat(timeline): schema 4 policy codec (not yet in use)`.

### Task 14: Developer documentation

**Files:**
- Create or modify: `docs/dev/step-engine.md` ("Policies with dates" section)
- Modify: `docs/dev/sim-levers.md` (one pointer line), `CLAUDE.md` (scoped-docs list, only if `step-engine.md` was created here)

- [ ] **Step 1:** If `docs/dev/step-engine.md` exists on the branch, add the section; else create it holding only `# Step engine` and the section, and add one line to CLAUDE.md's scoped list: `- **Step engine: policies with dates (schema 4 document, compiling to frames, frame ids, the comparison)** — [docs/dev/step-engine.md](docs/dev/step-engine.md)` (`scripts/docs-index.spec.ts` requires every `docs/dev/*.md` to be linked). Note in the commit body that `world-core` may create the same file in parallel and the merge keeps both sections.
- [ ] **Step 2:** The section says, tersely: the document (kinds, policy, span, the pairs table, rules 3 to 6), opening and reconciling, how policies in force combine (rules 10 to 15), what a frame's identity covers and the interning (Task 8's decisions), slicing and `CompileCtx.yields`, `touched`, `firstDifference`, `comparisonOf`, the codec and that it is not switched on, the test files, and Task 1's numbers. `sim-levers.md` gains under "The lever document": `Dated policies (schema 4) compile to these levers month by month: see [step-engine.md](step-engine.md#policies-with-dates).`
- [ ] **Step 3: Run** `npx vitest run --project server scripts/docs-index.spec.ts` and `npx prettier --check docs CLAUDE.md` — PASS.
- [ ] **Step 4: Commit** `docs: policies with dates`.

### Task 15: The timing bar and the measurement again

**Files:**
- Create: `src/lib/sim/world/policy/compile.perf.spec.ts`
- Modify: `scripts/measure-policy-compile.ts`, `.superpowers/sdd/policy-timeline/measure-compile.md`

- [ ] **Step 1: Write the perf test** (project `perf`): on the bench city (`synthCity()`, `synthPolicy()`, `withBenchFunding`, `benchFundingLevers` upgraded), a `YieldSource` over the bench city's chunk records with `createYieldRecompute` and `performance.now`, `windowMonths` 480, a document with a painted policy of 500 lots from month 1, a transit-like rule over 2,000 lots from month 61 and the bench funding; call `step(20)` until true, timing every call: `expect(Math.max(...calls)).toBeLessThanOrEqual(50)`. Also assert, as a fixture check, that more than one zoning state was built.
- [ ] **Step 2: Run** `npx vitest run --project perf src/lib/sim/world/policy/compile.perf.spec.ts` on a quiet machine (`uptime` first; if busy, report the result as ballpark and do not loosen the bar).
- [ ] **Step 3: Re-measure** Task 1's two scenarios with `compileTimeline` (time to `result()` being callable, time to `step` returning true, largest `step(20)` call), append to `measure-compile.md` beside Task 1's numbers. Builder's call: commit the script if it runs on the bench city with `--bench`, and name it in `step-engine.md`; otherwise delete it.
- [ ] **Step 4: Run** `npm run test:unit`, `npm run check`, `npm run lint` — PASS.
- [ ] **Step 5: Commit** `test(sim): bound a compile slice; re-measure the compile wait`.

---

## Traceability

| Spec item | Task |
| --- | --- |
| S10 types, `queriesOf4`, the pairs table | 2, 4 |
| Rule 1 (preset) | 3, 4 |
| Rule 2 (upgraded span) | 4 |
| Rule 3 (ids, same ids across spans, label) | 3 |
| Rule 4 (month days, order, overlap) | 2, 3, 10 |
| Rule 5 (schema 3 parsers, union limits, `MAX_PLAN_BYTES`) | 3, 13 |
| Rule 6 (days inside a setting, spans cut them) | 7 |
| Rule 7 (offered on the first day) | 7 |
| Rule 8 (default document) | 2, 4 |
| Rule 9 (canonical identity, "nothing in force") | 2, 11, 13 |
| `upgradePolicy` | 4 |
| `reconcilePolicy4`, compiler throws on unreconciled | 5, 10 |
| Rules 10 to 14 (combination) | 6 |
| Rule 15 (money, fixed order, `finance: null`) | 6, 7, 10 |
| Rule 16 (frame identity) | 7, 10 |
| Rule 17 (interning, views kept while used) | 8, 10, 11 |
| Rule 18 (zoning views with today's code, `preFzp`) | 9 |
| Rule 19 (slicing, `readyThrough`, `progress`) | 9, 10, 15 |
| Rule 20 (`touched`) | 9, 10 |
| Rule 21 (`market`) | 10 |
| Rule 22 (`comparisonOf`) | 11 |
| Rule 23 (`capacity`, `unknownLots`) | 9, 10 |
| Rule 24 (measurement) | 1, 15 |
| Rule 25 (schema 4 `SimDoc`, strict/reconcile, key `v2`, migration) | 13 |
| Rule 26 (old `/s` links open) | 13 |
| S4, S5, S6 (`frameAt`, `changes`, `touched`, `readyThrough`), `firstDifference` | 7, 10, 11 |
| S13 (`compileTimeline`, `TimelineCompile`, `lookupsAt`) | 10, 11 |
| Tests: round trip | 12 |
| Tests: two spans, three frames | 10 |
| Tests: rule 17 cases, `firstDifference` | 10, 11 |
| Tests: `touched` for added paint | 10 |
| Tests: rules 11 to 14 hand-built | 6 |
| Tests: parser rejects rules 3 to 5 | 3 |
| Tests: `comparisonOf` | 11 |
| Tests: reconcile drops and reports; compiler throws | 5, 10 |
| Tests: strict refuses 3, reconcile opens, stored 3 loads | 13 |
| Tests: `finance: null` without `baselineFunding` | 7, 10 |
| `test:perf` `step(20)` <= 50 ms | 15 |
| Docs | 14 |

## Open questions (for the conductor)

- **Q1. The default schema 3 document does not upgrade to the default document** (spec contradiction). The table makes "one policy from `timing.current`" unconditionally, but `DEFAULT_POLICY.timing.current` is the observed set (`sim-page/policy.ts:117`), so `upgradePolicy(DEFAULT_POLICY)` would hold a permitting policy in force, `comparisonOf` would answer `'plan'`, and today's default compares with pre-FZP zoning (`policy.ts:571`). Rule 8 says the default document has empty lists. Recommendation, built into Task 4: skip the current-set policy when it equals `OBSERVED_TIMING.current`; then `isDefaultPolicy(p)` holds exactly when `nothingInForce(upgradePolicy(p))` (Task 4 can assert the equivalence over its fixtures).
- **Q2. `CompileCtx` (S13, frozen) gives the compiler no way to compute yields** (blocks Task 9). Rule 18 needs `createYieldRecompute` (chunk records, cell loading) or `createTableRecompute` (the gross table), and `progress().failedCells` presumes chunks, but `CompileCtx { input; layers; windowMonths }` carries neither, and `leverStep` keeps them private to the host (`scenario-host.ts:935-946`). Recommendation: add `yields: YieldSource` and `now?: () => number` to `CompileCtx` (a D row; the runner builds the source from what it loads). Alternative without touching S13: a module-level `setYieldSource()` in `compile.ts`, which is harder to test and global.
- **Q3. Parsing needs the dataset date; the server has none.** Rule 4's month checks need `asOf`, and opening a schema 3 document (rule 2 spans, rule 25's reconcile) needs `asOf` and the calibration, but `DocCodec.load` takes only text and `loadSharedDoc` parses on the server without the dataset (`server/sharing/shared-page.ts:65`). Built here: `parsePolicy4(…, { asOf: null })` skips only the alignment checks, and `createSimCodec4(ds)` takes the dataset. For Release B, `timeline-ui` must choose: the server fetches `projects.json`/`calibration.json` from R2 to open and check documents, or `/s` ships the stored text and the client opens it. Recommendation: the latter, with the server's publish check run with `asOf: null` plus the compiler's re-check.
- **Q4. The Local Program switch lives in the zoning view, not in `newCalibration`** (S4 wording vs code). S4 and rule 14 put the switch in `newCalibration`, but `Calibration` has no such field: today it is the `parcels.localProgram` column (`levers/view.ts:17-21`, `apply.ts:67`). Built here: the switch is part of the zoning state and the view's `localProgram` column, as today; `newCalibration` carries the route shares. No shape changes; the S4 sentence is wrong in one clause. `world-core` should read the switch from `view.parcels.localProgram`.
- **Q5. `base: 'preFzp'` with zoning policies in force.** `resolveEnvelopes` always starts from the FZP table (`resolve.ts:76`); `comparisonOf` only asks for `'preFzp'` when nothing is in force. Built here: `LeverFormatError` at `base`. Supporting it means resolving on a layer context whose FZP slots hold the base columns; say if wanted.
- **Q6. Month arithmetic has two owners.** `world-core` rule 1 defines model months too; this plan puts `monthFirstDay`/`monthLastDay`/`monthOfDay` in `src/lib/timeline/months.ts` (the parser needs them page-side). Recommendation: `world-core` imports these rather than defining its own.
- **Q7. `precomputeOf` is one unsliceable pass over every lot** (`scenario/input.ts:363`), and the view needs it (S4 `ZoningView.pre`). If Task 1 measures it, `resolveEnvelopes` or `applyLevers` above about 40 ms on the live city, rule 19 and the 50 ms slice bar cannot both hold without a sliced precompute in a hashed file. Task 1 reports; the conductor decides.
- **Q8. `docs/dev/step-engine.md`** may be created by `world-core` in parallel; Task 14 creates it only if absent, and the merge must keep both sections and one CLAUDE.md line.
