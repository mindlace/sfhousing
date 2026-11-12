# finance-levers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Funding levers in the `/sim` documents (`FinanceLevers`, schema 3 everywhere, a schema-2 loader on every load path), their compile path into `plan.finance` (`buildFinance` in `applyLevers`), the worker's guard, the load-time reconcile and its report, the presets; plus two engine follow-ups the conductor assigned (I2 cold first band task, R-P3 bench cases).

**Architecture:** `FinanceLevers` is parsed in `src/lib/sim/levers/finance.ts` with the house guards plus `finance-data`'s `checkPool`; `planOf` calls `buildFinance(base.finance, levers.finance, base.asOf)`, which returns `base.finance` by identity for empty levers and otherwise scales baseline pools run by run on `inflowArrivals` windows and emits `off` spans. Page code (`src/lib/sim-page/`) adds `SimPolicy.funding`, the schema-2 upgrade in `parseSimPolicy`/`parseSimDoc`, the `upgradedFrom` plumbing, `reconcileFunding` and the presets; nothing there is in the hashed paths.

**Tech Stack:** TypeScript, SvelteKit 2 / Svelte 5 runes, Vitest (projects `server`, `client`, `perf`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-finance-levers-design.md` (binding). Design: `docs/superpowers/design/2026-11-09-1911-sim-financing.md` ("Presets", "Dependency order", "How a release is built", "Global constraints", "Reappraisal 1", "Reappraisal 2"). As-built contracts consumed: `docs/dev/finance-engine.md`, `docs/dev/finance-score.md`, `docs/dev/finance-model.md`, `docs/dev/finance-data.md`.

## Global Constraints

- **Release boundary.** This branch may change fixture inputs and the hand-edited fixtures the spec names. It must NOT regenerate `golden-seed1.json`, `model-golden.json`, `golden-finance-seed1.json`, the pipeline or lesscars goldens, or `e2e/fixtures/data/fixture-0`, and must not build, upload or verify a dataset. `pipeline/test/.../golden.test.ts` V12 already fails at base; do not chase it. Goldens this subsystem is expected to move: none (spec section 6, "Goldens").
- **Stored documents keep loading.** "A schema-2 policy, saved locally or published, opens with default funding. It is never treated as corrupt." Schema 3 loads schema-2 autosaves, `/s/<id>` and Remix with defaults plus a report; publish writes schema 3 only and refuses schema 2. No D1 migration, no data migration.
- **Evidence hierarchy.** "Every number the simulation uses carries a `Provenance` with its tier and source … No tier 3 or 4 number is presented as data."
- **Deterministic and paired.** No draw purpose changes; with empty levers `plan.finance` is `base.finance` by identity.
- **Lock tests** (`Assert<Equals>` in `src/lib/sim/scenario/types.spec.ts`, `src/lib/timelapse/types.test.ts`, `src/lib/timelapse/projects.test.ts`, `src/lib/map/timeline-types.spec.ts`, and value locks): edit only by exactly the change this spec adds. None of their locked types change here; if one fails, stop and report.
- **Hashed paths.** No path is added to `pipeline/lib/version.ts` `PATHS` (if one were, it would also go in `chreode.config.ts` and `.github/workflows/pipeline.yml`).
- **Partner ruling R24:** a partly covered application can draw from a pool switched off mid-month for up to about a month; accepted approximation; do not "fix" it.
- **House rules.** Vitest runs with `expect.requireAssertions` (every test calls `expect`); Svelte 5 runes; Tailwind 4; 2-space indent, single quotes, no trailing commas, 100 columns; Conventional Commits; multi-line messages via `git commit -F <file>`; no Claude attribution anywhere.
- **Leaves.** Run everything foreground. Never `cd X && cmd`; use absolute paths. Do not push, open a PR, run signoff or merge.
- **Timing.** Wall-clock numbers (`npm run test:perf`) only on a quiet machine; otherwise report ballpark figures and say so. `test:perf` is not part of signoff.
- **Verification per task:** `npm run check` green, `npm run lint` green on touched files, and the task's named Vitest files green. Run the whole `npm run test:unit` at Tasks 4, 6 and 12.

Commands: server specs `npx vitest run --project server <path>`; client specs `npx vitest run --project client <path>`; perf `npx vitest run --project perf <path>`; e2e `npx playwright test <path>`.

## Review Focus

1. **A stored schema-2 document with a nested schema mismatch or extra keys** (a schema-2 doc whose policy has `funding`, or a schema-3 doc whose policy is schema 2): expect `bad-field` at `/policy/schema` or `/policy/funding` (unknown key), never a silent upgrade and never a crash. Test in Task 4.
2. **A lever revision that fails the baseline-id check as the session's very first revision**: expect no timeline post at all (not the base run's) until a good `setLevers`; today's host would fall through to the base run once `pending` is cleared. Test in Task 3.
3. **A scale entry dated before `asOf` stacked with a later one on the same pool**: expect the earlier entry to govern from `asOf` until the later one, the off span unclipped. Test in Task 2 (`scale-before-asOf-then-later`).
4. **The autosave holding an upgraded document across two reloads**: expect `upgradedFrom: 2` on the first restore only, and the record on disk schema 3 after the first. Test in Task 5.
5. **A preset added twice, then one copy's pool deleted by the user**: `nextAddedId` must still not reuse an id that a remaining programme holds (ids checked in both lists). Test in Task 8.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/sim/levers/types.ts` (modify) | `FinanceLevers`, `SimLevers` schema 3 + `finance`, `DEFAULT_LEVERS.finance`, `parseSimLevers` |
| `src/lib/sim/levers/finance.ts` (create) | `FINANCE_LIMITS`, `LAST_DAY`, `parseFinanceLevers`, `buildFinance` |
| `src/lib/sim/levers/fixtures/finance.ts` (create) | `FIXTURE_AS_OF`, `baselineFixture`, `leapBaseline`, `fundingOnly`, `maxFunding` |
| `src/lib/sim/levers/apply.ts` (modify) | `planOf` sets `finance` |
| `src/lib/sim/scenario/scenario-host.ts` (modify) | `leverStep` guard, `inForce`, finance warm-up job |
| `src/lib/sim-page/policy.ts` (modify) | `SimPolicy` schema 3 + `funding`, parse, `viaLevers`, `compileLevers` |
| `src/lib/sim-page/sim-doc.ts` (modify) | `SimDoc` schema 3, schema-2 loader, strict missing-term rule, `opCount` |
| `src/lib/sim-page/fixtures/schema2/*.json` (create) | stored schema-2 documents, byte copies |
| `src/lib/sharing/doc-codec.ts`, `storage.ts`, `autosave.svelte.ts` (modify) | `schemaOfText`, `upgradedFrom`, write-back |
| `src/lib/server/sharing/shared-page.ts`, `e2e-seed.ts` (modify) | `SharedDocData.upgradedFrom`; comment |
| `src/routes/s/[id]/+page.svelte`, `src/app.d.ts`, `src/lib/sim-page/SimRoute.svelte`, `SimPage.svelte` (modify) | prop and Remix state |
| `src/lib/sim-page/funding-reconcile.ts` (create), `sim-session.ts` (modify) | `FundingLoadReport`, `reconcileFunding`, report on `restoreSimDoc` |
| `src/lib/sim-page/funding-sources.ts` (create) | sourced constants, `POOL_KIND_DEFAULTS` |
| `src/lib/sim-page/funding-presets.ts` (create) | `FundingPreset`, `fundingPresets`, `addPreset`, `valueSource`, `pastItems`, `nextAddedId` |
| `src/lib/sim/scenario/fixtures/bench-finance.ts`, `synth-city.ts`, `scenario.bench.spec.ts` (modify) | R-P3 |
| `docs/dev/finance-levers.md`, `docs/dev/sim-funding.md` (create); `sim-levers.md`, `plan-sharing.md`, `sim-page.md`, `finance-engine.md`, `CLAUDE.md` (modify) | docs |

Current code locations (the spec's predate the engine and score work): `SimLevers` `types.ts:49-58`, `DEFAULT_LEVERS` `67-76`, `record()` `95-108`, `parseSimLevers` `199-221`; `bare` `apply.ts:58-62`, `planOf` `65-77`, `twinInput` `87-106`; `SimPolicy` `policy.ts:57-66`, `DEFAULT_POLICY` `109-115`, `isDefaultPolicy` `124-126`, `viaLevers` `235-246`, `parseSimPolicy` `387-427`, `compileLevers` `548-560`; `SimDoc` `sim-doc.ts:36-46`, `pointer` `108-114`, `parseSimDoc` `121-162`, `SIM_CODEC` `179-202`; `ReadResult` `storage.ts:24-28`, `readRecord` `49-68`; `RestoreResult` `autosave.svelte.ts:15-18`, `restore` `72-131`; `SharedDocData` `shared-page.ts:19-26`, `loadSharedDoc` `42-79`; `restoreSimDoc` `sim-session.ts:45-71`; `SimPage.svelte:172-182` (`opened`), `217-221` (`doc`), `226-228` (`restore`); `initScenario` `scenario-host.ts:495-560`, `loadedHook` `645-689`, `setLevers` `736-749`, `kick` `754-768`, `slice` `787-805`, `nextJob` `807-`, `leverStep` `874-947` (`applyLevers` at `917`), `JobKind` `372`; `leversProblem` `load.ts:78-85`; `checkPool` `model.ts:963-997`, `CalibrationFormatError` `model.ts:539-547`; `validateInstrument` `instruments.ts:41`, `missingTerms` `instruments.ts:106` (its message format is `checkPriceable`'s, `instruments.ts:112-119`: `` `${inst.kind} needs ${key}, which is not sourced` ``); `resolveTerms` `terms.ts:170-193` (ranges `TYPED_TERM_RANGES` `120-126`); `inflowArrivals` `scenario/funding.ts:32-48`; `uncoveredPerHome(kind, p)` `prototypes.ts:140-145` (two arguments; the prototype is ignored for `'affordable'`, so pass `PROTOTYPES[0]`); `financePreOf` `funded.ts:127-216`; e2e seed schema column `e2e-seed.ts:55`; the client's error-on-own-rev `scenario-client.ts:454-466`.

---

### Task 1: `FinanceLevers`, its parser and limits, `SimLevers` schema 3, fixtures

**Files:**
- Create: `src/lib/sim-page/fixtures/schema2/{painted,profile,tampered,default-record}.json`
- Modify: `.prettierignore` (add `src/lib/sim-page/fixtures/schema2`)
- Modify: `src/lib/sim/levers/types.ts:49-76,199-221`
- Create: `src/lib/sim/levers/finance.ts` (parser part), `src/lib/sim/levers/fixtures/finance.ts`
- Modify: `src/lib/sim-page/policy.ts:548-560` (`compileLevers` emits schema 3; placeholder finance, replaced in Task 4)
- Test: `src/lib/sim/levers/finance.spec.ts` (create), `src/lib/sim/levers/types.spec.ts`

**Interfaces:**
- Produces (in `types.ts`): `interface FinanceLevers { baselineScale: { pool: string; from: Day; scale: number }[]; pools: Pool[]; programmes: Programme[]; terms: Partial<Record<TermKey, number>> }`; `SimLevers.schema: 3`, `SimLevers.finance: FinanceLevers`; `DEFAULT_LEVERS.finance = { baselineScale: [], pools: [], programmes: [], terms: {} }` written as a literal (no call into `finance.ts` at module init: `types.ts` and `finance.ts` import each other at call time only).
- Produces (in `finance.ts`): `FINANCE_LIMITS = { pools: 12, inflowsPerPool: 12, programmes: 24, baselineScale: 24, labelChars: 80, idChars: 40 } as const`; `LAST_DAY = 47482`; `FIRST_DAY = 10957`; `MAX_DOLLARS = 100_000_000_000`; `parseFinanceLevers(v: unknown, path: string): FinanceLevers`.
- Produces (fixtures): `FIXTURE_AS_OF: Day` = `dayOf(2026, 3, 15)` (builder's call: mid-year, so `nextFiscal` is 2027-07-01 and `nextCalendar` 2027-01-01); `baselineFixture(asOf?: Day): { finance: NonNullable<SimInput['finance']>; baselineFunding: NonNullable<Calibration['baselineFunding']> }`; `leapBaseline(): same`; `fundingOnly(): FinanceLevers`; `maxFunding(): FinanceLevers`.

- [ ] **Step 1: Generate the schema-2 fixtures from the base code, before any schema change.** Confirm `git diff --stat 2c7711fe HEAD -- src/lib/sim-page/policy.ts src/lib/sim-page/sim-doc.ts src/lib/server/test/sim-docs.ts scripts/profile-sim-load.policy.json` is empty (it is at `1a1928d6`). Write a throwaway spec (not committed) under `src/lib/sim-page/fixtures/schema2/` that writes: `painted.json` = `paintedText()`; `tampered.json` = `tamperedText()`; `default-record.json` = `JSON.stringify({ v: 1, savedAt: '2026-11-01T00:00:00.000Z', plan: serializeSimDoc(simDoc()) })`. Run it once with `npx vitest run --project server <that file>`, delete it. Copy `profile.json` byte for byte: `git -C /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-levers show HEAD:scripts/profile-sim-load.policy.json` redirected to `src/lib/sim-page/fixtures/schema2/profile.json`. Add the folder to `.prettierignore`. Commit: `test: add stored schema-2 policy fixtures`.

- [ ] **Step 2: Write the failing parser tests** in `finance.spec.ts`: one passing and one failing case per row of spec section 4.1's table, asserting `[e.path, message]` exactly. Shape:

```ts
const bad = (f: unknown) => { try { parseFinanceLevers(f, 'finance'); } catch (e) {
  if (e instanceof LeverFormatError) return [e.path, e.message.slice(e.path.length + 2)]; throw e; }
  return null; };
it('scale out of range', () => expect(bad(withScale({ pool: 'state', from: FIXTURE_AS_OF, scale: 10.01 })))
  .toEqual(['finance.baselineScale[0].scale', 'expected a number from 0 to 10']));
```

Cover, with the spec's messages verbatim: `expected at most 24 scale entries`; `expected a baseline pool id` (a `u-` pool and a bad id); `expected a whole day from 10957 to 47482` (10956, 47483, 1.5); `expected entries sorted by pool, then by from, with no two on one day` (unsorted pools, equal `from`); `expected at most 12 pools`; `expected an id starting u-`; `duplicate id` (pools; programmes; a pool and a programme sharing an id parse); `expected a label of 1 to 80 characters` (`'   '`, 81 chars; `'  ok '` stored as `'ok'`); `expected false: an added pool has a schedule of money`; `expected 1 to 12 inflows` (0, 13); `expected a number above 0 and at most 10` (bank leverage 10.5); `expected whole dollars from 1 to 100000000000` (0, 1.5, 1e11 + 1, on `dollars` and `dollarsPerYear`); `expected at most 24 programmes`; `expected the id of an added pool` (`u-missing`); `expected one of market, affordable`; `expected one of grant, loan, guarantee` and an extra instrument key (`unknown key`); `validateInstrument`'s text (grant share 0; loan rate 0.3); `expected null or a day on or after from`; `expected a whole number from 0 to 10000` (−1, 10001, 2.5); `expected tiers for affordable reach only` (affordable with null, market with tiers); `expected values summing to 1, got 0.9`; terms `unknown key`, `expected a number`, and each key at and just outside its range with `resolveTerms`'s text (`lossOnExit must be between 0 and 1; got 1.01`). Shared rows: a pool with `kind: 'goBond'`, `debt: null` fails with `checkPool`'s message at `finance.pools[0].debt`; `leverage: 2` on `generalRevenue` fails at `finance.pools[0].leverage` with `expected 1 unless kind is bank, got 2`. Limits at and one past: 12/13 pools, 12/13 inflows, 24/25 programmes, 24/25 entries. A guarantee with no typed `guaranteeRateCut` parses. In `types.spec.ts`: `parseSimLevers(DEFAULT_LEVERS)` deep-equals it; `{ ...DEFAULT_LEVERS, schema: 2 }` fails at `schema` with `expected 3, got 2`; a bad `finance` field fails at `finance.pools[0].id`; `maxFunding()` parses.

- [ ] **Step 3: Run** `npx vitest run --project server src/lib/sim/levers/finance.spec.ts src/lib/sim/levers/types.spec.ts` — FAIL (module missing).

- [ ] **Step 4: Implement.** `parseFinanceLevers` order per pool: own `record()` key check, then `checkPool(v, path)` inside `try`, rethrowing a `CalibrationFormatError` as `new LeverFormatError(e.path, e.message.slice(e.path.length + 2))`, then the added-only rules (id `u-` and unique, label trimmed 1 to 80, `uncapped` false, 1 to 12 inflows, every inflow day in [10957, 47482], dollars 1 to 1e11, bank leverage ≤ 10). Programmes: the table's rows in table order, `validateInstrument` after the exact-keys check, tiers summing to 1 within `1e-9`. Terms: each key via `resolveTerms(MARKET_TERMS, { [key]: v })` in `try`, `RangeError` → `LeverFormatError('finance.terms.' + key, e.message)`. Return a fresh object (labels trimmed). `parseSimLevers` adds `'finance'` to its keys and calls `parseFinanceLevers(r.finance, 'finance')`. Builder's call: export `record` and `array` from `types.ts` for reuse rather than duplicating them. In `compileLevers` set `schema: 3, finance: structuredClone(DEFAULT_LEVERS.finance)` (Task 4 replaces it with `p.funding`). Fixtures: spec section 6 values exactly; `baselineFunding.provenance` one tier-4 entry per pool plus one; `fundingOnly()` = one scale entry `{ pool: 'state', from: FIXTURE_AS_OF + 400, scale: 2 }`, pool `u-pool-1` (`generalRevenue`, one `once` $1,000,000 on `FIXTURE_AS_OF + 100`), programme `u-prog-1` (grant 0.1, affordable, fixture tiers); `maxFunding()` = 12 `u-pool-<n>` pools of 12 `yearly` inflows with 80-character labels, 24 programmes, 24 scale entries over the four baseline pools on distinct days, all five terms typed in range.

- [ ] **Step 5: Run** the two spec files and `npm run check` — PASS. Run `npx vitest run --project server src/lib/sim src/lib/sim-page` — PASS (existing specs spread `DEFAULT_LEVERS`, so they follow).

- [ ] **Step 6: Commit** `feat(sim): funding levers in the lever document (schema 3)`.

### Task 2: `buildFinance` and the plan

**Files:**
- Modify: `src/lib/sim/levers/finance.ts` (add `buildFinance`), `src/lib/sim/levers/apply.ts:65-77`
- Test: `src/lib/sim/levers/finance.spec.ts`, `src/lib/sim/levers/apply.spec.ts`

**Interfaces:**
- Consumes: Task 1's `FinanceLevers`, `LAST_DAY`, fixtures; `inflowArrivals(inflow, asOf, horizon)` from `../scenario/funding`; `resolveTerms`, `missingTerms`, `MARKET_TERMS` from `$lib/sim/finance`.
- Produces: `buildFinance(base: SimInput['finance'], f: FinanceLevers, asOf: Day): SimInput['finance']`; `planOf` returns `{ ...plan, newProjects, ...inFlightScale, finance: buildFinance(base.finance, levers.finance, base.asOf) }`.

- [ ] **Step 1: Write the failing tests** (spec section 6 `buildFinance` and `apply.spec.ts` lists, all of them), with these exact pins added:
  - `'scale 0 then 1 on a capped pool: one off span, no arrival inside it'` (the F7 emission the docs state): on `baselineFixture()`, entries `[{ pool: 'state', from: X, scale: 0 }, { pool: 'state', from: Y, scale: 1 }]` with `X = FIXTURE_AS_OF + 200`, `Y = dayOf(2030, 3, 15)`: `expect(out.off).toEqual([{ pool: 'state', from: X, to: Y - 1 }])`; every arrival day of `state`'s new inflows (expanded with `inflowArrivals(inflow, FIXTURE_AS_OF, LAST_DAY)`) is `< X` or `>= Y`; no inflow has 0 dollars; the programme list is the base's ids in order (`baseline-state` still present).
  - `'scale 0 on the uncapped federal pool'`: `off` is `[{ pool: 'federal', from: X, to: null }]`, `federal` pool object is the base's by identity.
  - `'scale-before-asOf-then-later'`: entries `[{ pool: 'city-b', from: FIXTURE_AS_OF - 30, scale: 0 }, { pool: 'city-b', from: FIXTURE_AS_OF + 400, scale: 0.5 }]` give `off: [{ pool: 'city-b', from: FIXTURE_AS_OF - 30, to: FIXTURE_AS_OF + 399 }]`, and `city-b`'s first received arrival is on or after `FIXTURE_AS_OF + 400` at `Math.round(4_000_000 × 0.5)`.
  - Leap: on `leapBaseline()` with `{ pool: 'city-a', from: dayOf(2029, 1, 1), scale: 1 }`, the plan's arrival days for `city-a` equal `inflowArrivals(original, asOf, LAST_DAY)` up to a far horizon, including `dayOf(2032, 2, 29)`.
  - Identity: `buildFinance(base, DEFAULT_LEVERS.finance, asOf)` is `base` (`toBe`); `buildFinance(undefined, fundingOnly(), asOf)` is `undefined`; a terms-only lever gives a new object with `terms.custom` `['lossOnExit']` and `pools[i]` `toBe` `base.pools[i]`.
  - Ids: `finance.baselineScale[0].pool` → `no baseline pool nope in this data`; `finance.programmes[0].pool` likewise. Terms: a `u-` guarantee programme with no typed cut throws at `finance.programmes[0].instrument` with `guarantee needs guaranteeRateCut, which is not sourced`; with `terms: { guaranteeRateCut: 0.01 }` it compiles.
  - Deep-frozen `base` input is not mutated.
  - `apply.spec.ts`: `bare()` keeps `market` and `finance` by identity through `baseZoning` and `planOf`, with timers set; both twins carry `base.finance` by identity also when the levers type a term; `twinInput` returns the same object for two documents differing only in `finance`; with `finance` absent from the base and `DEFAULT_LEVERS`, plan and twin deep-equal today's.

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/levers/finance.spec.ts src/lib/sim/levers/apply.spec.ts` — FAIL.

- [ ] **Step 3: Implement `buildFinance`** following spec section 4.4 steps 1 to 6 exactly (no arrival arithmetic of its own). The run splitting, for one baseline pool with sorted entries `E`:

```ts
// runs: [asOf, E[0].from - 1] at scale 1, then [E[k].from, E[k+1].from - 1] at E[k].scale, last open
// (an entry with from <= asOf starts its run at asOf; a run with hi < lo is skipped)
for (const inflow of pool.inflows) for (const run of runs) {
  const days = inflowArrivals(inflow, run.lo, run.hi ?? LAST_DAY);
  if (run.scale === 0 || days.length === 0) continue;
  if (inflow.kind === 'once') push once(day, round(dollars × scale));
  else if (run.hi !== null) for (const d of days) push once(d, round(dollarsPerYear × scale));
  else { // open run: a true anniversary restarts the yearly inflow; earlier arrivals stay once
    const a = days.find((d) => sameMonthDay(d, inflow.from)); // UTC month and day of `from`
    for (const d of days) if (a === undefined || d < a) push once(d, …);
    if (a !== undefined) push yearly({ from: a, to: inflow.to, dollarsPerYear: round(…) });
  }
}
// drop 0-dollar inflows; sort by first day; off spans: each maximal run of 0-scale entries
```

`sameMonthDay` compares UTC month and date of the two days (`new Date(day × 86400000)`), so a 29 February `from` never restarts on a 28 February. In `apply.ts` add `finance` last in `planOf`'s returned object.

- [ ] **Step 4: Run** both spec files, then `npx vitest run --project server src/lib/sim` — PASS; `npm run check` — PASS.

- [ ] **Step 5: Commit** `feat(sim): compile funding levers into the plan's finance`.

### Task 3: The worker's guard

**Files:**
- Modify: `src/lib/sim/scenario/scenario-host.ts:874-947` (`leverStep`), `nextJob` (807-), `LeverWork` type
- Create: `src/lib/sim/scenario/test/funded-calibration.ts` (move `sourced` and `fundedCalibration` out of `scenario-host.finance.spec.ts:62-107`, re-import there)
- Test: `src/lib/sim/scenario/scenario-host.levers.spec.ts`

**Interfaces:**
- Consumes: `applyLevers` throwing `LeverFormatError` (Task 2).
- Produces: `fundedCalibration(): Calibration` (test helper); `LeverWork.inForce: boolean`.

- [ ] **Step 1: Write the failing tests** (harness `makeScenarioHarness({ deps: { bandRuns: N }, policy: true, bodies: { [MINI_SCENARIO_URLS.calibration]: fundedCalibration() } })`):
  - `'setLevers with a bad finance field is bad-request naming the path'`: `finance.pools[0].id` in the error message `levers finance.pools[0].id: expected an id starting u-`.
  - `'a revision naming a missing baseline pool posts bad-request on its rev and keeps the previous revision'`: after rev A is `current` and a timeline posted, `setLevers` B with `baselineScale [{ pool: 'nope', … }]`; expect one `{ type: 'error', rev: B, code: 'bad-request', message: 'levers finance.baselineScale[0].pool: no baseline pool nope in this data' }`, no `current` for B, the next timeline still on A's inputs (same `content` as before B), and a good `setLevers` C reaches `current`.
  - `'a failing first revision runs nothing until the next setLevers'`: `init({ levers: badBaseline })` → error on rev 1, then `runAll()` posts no `timeline`; `setLevers` good → `current` then a timeline.
  - `'LeversResponse shape unchanged'`: keys of the `current` post equal `['capacity','lookups','phase','rev','type','unknownLots']`.

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/scenario/scenario-host.levers.spec.ts` — FAIL.

- [ ] **Step 3: Implement.** Wrap the `applyLevers` call in `leverStep`: on `LeverFormatError`, `post({ type: 'error', rev: p.rev, code: 'bad-request', message: 'levers ' + e.message })`, `lw.pending = null`, return before touching `w.loaded`, `w.run`, `w.band`; rethrow anything else (the `kick` catch ends the session as `internal`). Add `inForce: false` to `LeverWork` (set in `loadedHook`), set true where a revision becomes current; in `nextJob`, after the lever branches, `if (lw && !lw.inForce) return null`. Builder's call: the failing revision's `heights` may already have been posted by the resolve step; that path is a guard the page never takes, so it is left.

- [ ] **Step 4: Run** the levers spec plus `scenario-host.finance.spec.ts`, `scenario-host.await.spec.ts` — PASS.

- [ ] **Step 5: Commit** `feat(sim): the worker refuses levers naming a missing baseline pool`.

### Task 4: Schema-3 policy and stored document, the schema-2 loader, publish

**Files:**
- Modify: `src/lib/sim-page/policy.ts` (57-66, 109-126, 235-246, 387-427, 548-560), `src/lib/sim-page/sim-doc.ts` (36-46, 121-162, 179-202)
- Modify fixtures and specs that build a whole policy or document: `src/lib/server/test/sim-docs.ts`, `scripts/profile-sim-load.policy.json` (schema 3 and `"funding"`), `src/lib/sim-page/SimPage.svelte:176,219-220`, and the literals in `sim-session.spec.ts:16`, `sim-doc.spec.ts:19,173`, `SimPage.svelte.spec.ts:711,906,1409,1894,1949`, `PublishDialog.svelte.spec.ts:170,190`, `autosave.svelte.spec.ts:325`, `src/routes/s/[id]/page.spec.ts:38`, `page.view.svelte.spec.ts:75,188` (the full list: `grep -rnE "schema: 2|\"schema\": ?2" src e2e scripts`, ignoring plan-document and lesscars hits)
- Modify: `src/lib/server/sharing/e2e-seed.ts:55` (comment only)
- Test: `src/lib/sim-page/policy.spec.ts`, `src/lib/sim-page/sim-doc.spec.ts`, `src/lib/server/sharing/publish.spec.ts`, `src/routes/api/policies/server.spec.ts`

**Interfaces:**
- Consumes: `FinanceLevers`, `DEFAULT_LEVERS.finance`, `missingTerms`, `resolveTerms`, fixtures.
- Produces: `SimPolicy.schema: 3`, `SimPolicy.funding: FinanceLevers`; `DEFAULT_POLICY.funding = structuredClone(DEFAULT_LEVERS.finance)`; `parseSimPolicy(json, opts: { presetLayer?: PresetLayerMode; schema2?: 'upgrade' })`; `SIM_DOC_SCHEMA = 3`; `SimDoc.schema: 3`; `SCHEMA2_PUBLISH_MESSAGE = 'This policy was made by an older version of the site. Reload the page, then publish it.'` (exported from `sim-doc.ts`).

- [ ] **Step 1: Write the failing tests** (spec section 6 `policy.spec.ts`, `sim-doc.spec.ts`, publish lists, all of them), plus Review Focus 1: a schema-2 doc whose policy has `funding` → `bad-field` at `/policy/funding` (`unknown key`); a schema-3 doc whose policy is schema 2 → `bad-field` at `/policy/schema` (`expected 3, got 2`). Fixture loads: `readFileSync` each of `fixtures/schema2/painted.json`, `profile.json`, `tampered.json` (and `JSON.parse(default-record.json).plan`) through `parseSimDoc(text, 'reconcile')`: `value.schema === 3`, `value.policy.funding` deep-equals `DEFAULT_POLICY.funding` and is not the same object, and the policy without `funding` and `schema` deep-equals the stored JSON's policy without `schema` (reconcile mode keeps these fixtures' fields as stored; if one is rewritten, compare that field to its reconcile-mode value and say why in the test). `'strict'` on each gives `[{ path: '/schema', code: 'unknown-schema', message: SCHEMA2_PUBLISH_MESSAGE }]`. `opCount` of a doc with one rule, one brush and `fundingOnly()` (one scale entry, one pool, one programme, no typed term) is 5. `maxFunding()` with no strokes: `simDocProblems` is `[]` and `serializeSimDoc` is under 32,768 bytes. Publish: funding-only policy 201 with row `schema` 3; schema-2 body 422 `unsupported_schema`; 13 pools 422 `invalid_plan` with detail path `/policy/funding/pools`, 13 inflows in a pool with `/policy/funding/pools/0/inflows`; guarantee without typed cut 422 `invalid_plan` at `/policy/funding/programmes/0/instrument`.

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim-page/policy.spec.ts src/lib/sim-page/sim-doc.spec.ts src/lib/server/sharing src/routes/api/policies` — FAIL.

- [ ] **Step 3: Implement** spec sections 4.2, 4.3 (points 1 to 6) and 4.4 (`compare`, `compileLevers`): `viaLevers`' type parameter widens to `'timers' | 'routeShares' | 'finance'`; `parseSimPolicy` keys gain `funding` for schema 3 and parse it with `viaLevers('finance', r.funding, 'funding')`; with `schema2: 'upgrade'` it requires schema 2 and the schema-2 keys exactly and returns `schema: 3, funding: structuredClone(DEFAULT_POLICY.funding)`. `parseSimDoc`: schema > 3 `future-schema`; schema 2 → `'reconcile'` upgrades, `'strict'` refuses with `SCHEMA2_PUBLISH_MESSAGE`; schema 3 strict adds the missing-term rule after the policy parse. `compileLevers` uses `finance: structuredClone(p.funding)`. `SIM_CODEC.empty` and `opCount` as the spec says. Update every listed literal to schema 3 (a whole `SimPolicy` literal gains `funding: structuredClone(DEFAULT_POLICY.funding)` or spreads `DEFAULT_POLICY`). `e2e-seed.ts:55` gets the comment from spec section 4.3.

- [ ] **Step 4: Run** the step-2 files, `npm run check`, then `npm run test:unit` — PASS.

- [ ] **Step 5: Commit** `feat(sim): policy documents carry funding (schema 3) and load schema 2`.

### Task 5: Carrying "upgraded" to the loader

**Files:**
- Modify: `src/lib/sharing/doc-codec.ts`, `storage.ts:24-68`, `autosave.svelte.ts:15-18,72-131`
- Modify: `src/lib/server/sharing/shared-page.ts:19-79`, `src/routes/s/[id]/+page.svelte:41,66`, `src/app.d.ts:12`, `src/lib/sim-page/SimRoute.svelte:12-25,81`, `src/lib/sim-page/SimPage.svelte:116-182,226-228`, `src/lib/sim-page/sim-session.ts:45-49` (parameter type only)
- Test: `src/lib/sharing/doc-codec.spec.ts`, `storage.spec.ts`, `autosave.svelte.spec.ts`, `src/lib/server/sharing/shared-page.spec.ts`, `src/lib/sim-page/SimPage.svelte.spec.ts`, `src/routes/s/[id]/page.view.svelte.spec.ts`

**Interfaces:**
- Produces: `schemaOfText(text: string): number | null`; `ReadResult` `ok` gains `upgradedFrom?: number`; `RestoreResult.upgradedFrom?: number`; `SharedDocData.upgradedFrom?: number` (absent when not upgraded); `App.PageState.sfhSimRemix?: { from: string; doc?: string; upgradedFrom?: number }`; `SimRoute`/`SimPage` prop `upgradedFrom?: number`; `restoreSimDoc(r: { plan: SimDoc; notice: AutosaveNotice | null; upgradedFrom?: number }, cal, remixFrom?)`.

- [ ] **Step 1: Write the failing tests:** `schemaOfText('{"schema":2}')` is 2, `'nope'` and `'{"schema":"2"}'` null. Storage/autosave (spec section 6 list): a record built from `default-record.json` restores with `upgradedFrom: 2`; storage then holds a schema-3 plan text (`schemaOfText(JSON.parse(stored).plan) === 3`); a second `restore()` has no `upgradedFrom` (Review Focus 4); a `PLAN_CODEC` record never has it; a schema-2 record on another dataset version gives notice `rebased` and `upgradedFrom: 2`; the handoff branch with `painted.json`'s text gives `upgradedFrom: 2`. Shared page: a stored `painted.json` body loads with `upgradedFrom: 2`; a schema-3 body has no `upgradedFrom` key. Client: in `SimPage.svelte.spec.ts`, `vi.mock('./sim-session')` as a pass-through spy; edit mode with a schema-2 record in the injected storage, and view mode with `initialPolicy` plus `upgradedFrom={2}`, each: the spy's first argument has `upgradedFrom: 2`. `page.view.svelte.spec.ts`: with `data.upgradedFrom = 2`, Remix calls `goto('/sim', { state: { sfhSimRemix: expect.objectContaining({ upgradedFrom: 2 }) } })`.

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sharing src/lib/server/sharing` and `npx vitest run --project client src/lib/sharing/autosave.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts src/routes/s/[id]/page.view.svelte.spec.ts` — FAIL.

- [ ] **Step 3: Implement** spec section 4.3 "Knowing that a document was upgraded": `readRecord` compares `schemaOfText(parsed.plan)` with `codec.schema(p.value)`; `Autosave.restore`'s `ok` branch with `upgradedFrom` writes back (`#lastWritten = null; #write(...)`) like the rebased branch, in both same-version and rebased cases; the handoff branch compares `schemaOfText(handoff)`. `SimPage.restore()` passes `upgradedFrom: r.upgradedFrom ?? remix?.upgradedFrom`; `opened` passes the prop. The `/s/[id]` page passes `upgradedFrom={data.upgradedFrom}` to `SimRoute` and `upgradedFrom: data.upgradedFrom` in the Remix state.

- [ ] **Step 4: Run** the step-2 commands and `npm run check` — PASS.

- [ ] **Step 5: Commit** `feat(sim): report a schema-2 document's upgrade on every load path`.

### Task 6: `reconcileFunding` and `FundingLoadReport`

**Files:**
- Create: `src/lib/sim-page/funding-reconcile.ts`
- Modify: `src/lib/sim-page/sim-session.ts:45-71`
- Test: `src/lib/sim-page/funding-reconcile.spec.ts` (create), `src/lib/sim-page/sim-session.spec.ts`

**Interfaces:**
- Produces: `FundingLoadReport` exactly as spec section 4.5's block; `reconcileFunding(f: FinanceLevers, cal: Calibration): { funding: FinanceLevers; report: Omit<FundingLoadReport, 'upgradedFrom'> }`; `restoreSimDoc(...)` returns `{ doc: SimDoc; notices: SimNotice[]; funding: FundingLoadReport }`.

- [ ] **Step 1: Write the failing tests** (spec section 6 list): calibration from `{ ...miniCal, market, baselineFunding: baselineFixture().baselineFunding }`. A scale on `nope` → `droppedScales: [{ pool: 'nope', from }]`; a programme on `nope` → `{ id, label, pool: 'nope', reason: 'pool', term: null }`; a `u-` guarantee with no typed cut → `reason: 'term', term: 'guaranteeRateCut'`; a programme on an added pool is never dropped for its pool; `unusable` true with `market` absent and `fundingOnly()`, true with `baselineFunding` absent, false when only drops left the default; `funding` is the input object (`toBe`) when nothing changes; `restoreSimDoc` copies `upgradedFrom` (2 → 2, absent → null), `cal` null gives `{ upgradedFrom, droppedScales: [], droppedProgrammes: [], unusable: false }`, and `notices` has no funding id (ids stay within `corrupt|future|rebased|timing|remix`).

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim-page/funding-reconcile.spec.ts src/lib/sim-page/sim-session.spec.ts` — FAIL.

- [ ] **Step 3: Implement** spec section 4.5. `restoreSimDoc` runs `reconcileFunding` beside `reconcileTiming` and replaces `doc.policy.funding` only when the returned object differs. `SimPage.svelte` destructures `{ doc, notices }` as today (`funding-ui` consumes the report).

- [ ] **Step 4: Run** the step-2 command, `npm run check`, `npm run test:unit` — PASS.

- [ ] **Step 5: Commit** `feat(sim): reconcile funding on load and report what changed`.

### Task 7: Funding sources and the preset list

**Files:**
- Create: `src/lib/sim-page/funding-sources.ts`, `src/lib/sim-page/funding-presets.ts` (list part)
- Test: `src/lib/sim-page/funding-presets.spec.ts` (create)

**Interfaces:**
- Consumes: `Sourced`, `Unsourced`, `Evidence` from `./timing-sources`; `MARKET_TERMS`, `resolveTerms`, `missingTerms`, `uncoveredPerHome`, `PROTOTYPES` from `$lib/sim/finance`; `inflowArrivals`; `dayOf`; `LAST_DAY`.
- Produces (sources): `CITY_PER_HOME: Sourced<Dollars>` (300,027); `POOL_KIND_DEFAULTS` (spec section 4.7's type and table, the `Unsourced` reason verbatim); named `Sourced` constants for each preset number with its provenance (`BOND_PRINCIPAL` 410,442,573, `GENERAL_FUND_FY25` 36,700,000, `PROP_C_SCHEDULE`, `REVOLVING_FUND_SIZE` 100,000,000, `PUBLIC_BANK_HOUSING` the five amounts). Source URLs: BLA `https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf`; Controller's Proposition C statement `https://media.api.sf.gov/documents/Proposition_C__Contributions_to_the_Housing_Fund_-_Signed.pdf`; HR&A corporation plan `https://lafco.archive.sf.gov/sites/default/files/rwg051823_MFC-Final.pdf`; HR&A bank plan `https://lafco.archive.sf.gov/sites/default/files/rwg051823_PublicBankFinal.pdf`; LAO Proposition 1 `https://lao.ca.gov/BallotAnalysis/Proposition?number=1&year=2026`. Tiers and page references exactly as spec section 4.7 "Sources and tiers".
- Produces (presets): `FundingPreset` (F16 shape); `fundingPresets(cal: Calibration): FundingPreset[]`; `cityGrant(...)`, `nextFiscal(asOf: Day): Day`, `nextCalendar(asOf: Day): Day` (exported for tests).

- [ ] **Step 1: Write the failing tests**, against `cal` = mini calibration with `market` and `baselineFixture(FIXTURE_AS_OF).baselineFunding`: ids in display order `['housing-bond','general-revenue','htf-2026','revolving-fund','public-bank','state-bond-2026','state-off','state-double','federal-support','federal-credits-off','regional-bond']`; `label`, `group` and `description` equal spec section 4.7's tables verbatim; `available`/`reason` per the table (`htf-2026`: `Not yet certified (passed on early counts, November 2026).`; `state-bond-2026`: `Not yet certified, and San Francisco's share is not published.`; `regional-bond`: `There is no regional measure yet.`); every available preset's content exact (`housing-bond` pool `goBond`, one `once` 410,442,573 on `dayOf(2027, 7, 1)`, debt `{ rate: 0.06, termYears: 20 }`, programme share `0.348251`, `minHomes`/`tiers` the fixture baseline's first affordable programme's; `public-bank` five `once` inflows on 1 July 2027 to 2031 summing to 70,000,000, leverage 0.67, loan rate 0.0613, `costShare` 0.1; `federal-support` yearly 3,000,000 from `dayOf(2028, 1, 1)`; `state-off` scale entry `{ pool: 'state', from: dayOf(2027, 7, 1), scale: 0 }`; `federal-credits-off` `{ pool: 'federal', from: dayOf(2027, 1, 1), scale: 0 }`); every label 1 to 80 characters; every programme's `from` is its pool's first arrival and `to` null; with `market` absent every preset is `available: false`, reason `This data has no funding model.`; with no `state` pool `state-off` gives `This data has no state pool.`; rule 2 with a stubbed `Unsourced` `constructionRate` (`vi.mock('$lib/sim/finance', …)` pass-through overriding `MARKET_TERMS`) makes `revolving-fund` unavailable with `The market terms this loan is valued against are not sourced: constructionRate`. `POOL_KIND_DEFAULTS`: every `PoolKind` present, `debt` non-null exactly for `goBond` (0.06/20, tier 2) and `cop` (0.065/20, tier 2), `leverage` non-null only for `bank` (0.67, tier 2), `loanRate` `Sourced` 0.0613 tier 3 for `bank` and `Unsourced` with the spec's reason elsewhere; `housing-bond`'s debt and `public-bank`'s leverage and rate equal its entries.

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim-page/funding-presets.spec.ts` — FAIL.

- [ ] **Step 3: Implement** spec section 4.7 "Availability", "Shared pieces", the list and its sources. Builder's calls: the reason order is the fixed reason (rules 1 and 3), then rule 2, then rule 4, then a missing baseline kind; `federal-support` without a state `yearly` inflow is unavailable with `This data's state pool has no yearly amount to start from.` (the spec names the condition, not the text); an unavailable preset carries empty `baselineScale`, `pools` and `programmes` except `htf-2026`, whose content is built so certification is a one-flag change. Preset pools and programmes get the placeholder ids `u-<presetId>-1` here; `addPreset` (Task 8) assigns real ones.

- [ ] **Step 4: Run** the spec and `npm run check` — PASS.

- [ ] **Step 5: Commit** `feat(sim): funding presets and their sources`.

### Task 8: Preset helpers and the fill-rule lock

**Files:**
- Modify: `src/lib/sim-page/funding-presets.ts`
- Test: `src/lib/sim-page/funding-presets.spec.ts`, `src/lib/sim-page/funding-presets.fill.spec.ts` (create)

**Interfaces:**
- Produces: `nextAddedId(f: FinanceLevers, presetId: string): string` (`u-<presetId>-<n>`, n the least positive integer free in both `pools` and `programmes`); `addPreset(f: FinanceLevers, p: FundingPreset): FinanceLevers` (throws `RangeError` past `FINANCE_LIMITS`); `type PoolField`, `type ProgrammeField` (spec section 4.7); `valueSource(item: Pool | Programme, field: PoolField | ProgrammeField, presets: FundingPreset[]): Provenance | 'custom'`; `pastItems(f: FinanceLevers, asOf: Day): { pools: string[]; programmes: string[]; inflows: { pool: string; index: number }[] }`.

- [ ] **Step 1: Write the failing tests:** `addPreset` twice with `housing-bond` gives pools `u-housing-bond-1`, `u-housing-bond-2` with programmes sharing `n`; a same-day `state-off` entry replaces an existing one and `baselineScale` stays sorted; 12 pools then one more throws `RangeError`; Review Focus 5: after adding `housing-bond` twice and deleting pool `u-housing-bond-1` (keeping its programme), `nextAddedId(f, 'housing-bond')` is `u-housing-bond-3`. `valueSource`: every row of the field table, untouched → its provenance (`toEqual` the constant's), edited → `'custom'`; each field the spec lists as `'custom'` from the start (default dates, `to: null`, `federal-support`'s amount, `revolving-fund`'s `costShare`/`rate`/`minHomes`, `public-bank`'s `costShare` and inflow days, `requiredReturn: null`) → `'custom'`; a hand-made `u-pool-1` → `'custom'`; preset-id matching works for `u-federal-credits-off-3`. `pastItems(f, asOf)` with one past pool, one past programme, and a pool with one past and one future inflow returns the three typed lists in document order. Fill spec (`fundBundle` on `baselineFixture()`'s affordable programmes, `PROTOTYPES[0]`, `resolveTerms()`): `housing-bond`/`general-revenue` → each City item `granted` is half its `share × 861,525` and `coverage` 1; City baseline items left out → the added item granted in full; `federal-support` → both City items granted 0; `public-bank` → City items scaled by one common fraction, their total lower by the loan's `grantEquivalent`; `state-double` → every item as in the baseline; `state-off` and `federal-credits-off` (programme removed) → `coverage` `toBeCloseTo(0.862581, 6)` and `toBeCloseTo(0.48567, 6)`, `certain: false`.

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim-page/funding-presets.spec.ts src/lib/sim-page/funding-presets.fill.spec.ts` — FAIL.

- [ ] **Step 3: Implement** spec section 4.7 (`addPreset`, `valueSource`) and 4.6 (`pastItems`, using `inflowArrivals(inflow, asOf, LAST_DAY)`).

- [ ] **Step 4: Run** both specs and `npm run check` — PASS.

- [ ] **Step 5: Commit** `feat(sim): add presets to a policy and label their values`.

### Task 9: End to end, schema-2 policies

**Files:**
- Modify: `e2e/sim-share.spec.ts`

- [ ] **Step 1: Write the tests** (spec section 6 "Playwright e2e"): `'a stored schema-2 policy opens, remixes and republishes as schema 3'`: seed `painted.json`'s text with `seedPlanRow(page.request, { body, datasetVersion: 'fixture-0', kind: 'sim' })`; `/s/<id>` responds 200 and the summary shows the custom brush (use the locator the existing summary tests use); Remix lands on `/sim` with the Remix toast and the brush. `'a schema-2 autosave record opens and is stored back as schema 3'`: put `{ v: 1, savedAt, plan: <painted.json text> }` under `SIM_KEY` before load; the page shows the brush; `expect.poll` reads `JSON.parse(JSON.parse(localStorage[SIM_KEY]).plan).schema` → 3; publish it; `GET /api/policies/<new id>` body has `"schema":3`. Keep every existing `expectNoA11yViolations` call.

- [ ] **Step 2: Run** `npx playwright test e2e/sim-share.spec.ts` — PASS (it builds the preview and loads `fixture-0`; the fixture has baseline funding and a market model, so `funding` reconciles to itself).

- [ ] **Step 3: Commit** `test(e2e): schema-2 policies open, remix and republish as schema 3`.

### Task 10: I2, warm the finance precompute in its own task

**Files:**
- Modify: `src/lib/sim/scenario/scenario-host.ts` (`JobKind` 372, `Work` type, `loadedHook` 645-689, `leverStep` after `w.loaded = …`, `slice` 787-805, `nextJob`)
- Test: `src/lib/sim/scenario/scenario-host.finance.spec.ts`

**Interfaces:**
- Consumes: `financePreOf(input): FinancePre` (`funded.ts:127`), its `marketSkip(horizon)` and `affordableSkip(horizon)` (memoised per horizon; the engine calls them with `run.horizon`, `funded.ts:1088-1089`).
- Produces: `JobKind` gains `'warm'`; `Work.warm: SimInput[]`; `ScenarioHostDeps.warmFinance?: boolean` (default true; builder's call: the test seam that proves outputs unchanged).

- [ ] **Step 1: Write the failing tests** (`fundedCalibration()`, seed null so FZP band runs come first): `vi.mock('./funded')` pass-through spying `financePreOf`, and the existing `./simulate` spies; record for each call the harness step number (`h.step()` loop). `'the finance precompute is warmed in its own task before the first band task'`: for the fzp and twin inputs, the first `financePreOf` call happens in a step that has no `simulateNet`/`simulateDetailed` call, and before the step of the first `simulateNet`. `'warming changes no output'`: two harnesses, `warmFinance: true` and `false`, same seed; the revision-0 timeline post's `score` and `render`, and the final post with `bandRuns === bandRunsTotal`, are deep-equal. In `scenario-host.levers.spec.ts`: after a `current`, the new plan input is warmed in a step before its first band run.

- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/scenario/scenario-host.finance.spec.ts` — FAIL.

- [ ] **Step 3: Implement.** In `loadedHook` and after `w.loaded = …` in `leverStep`, set `w.warm` to the distinct inputs among `w.loaded.fzp` and `w.loaded.twin` that have `finance` (none when `deps.warmFinance === false`). `nextJob`, before the `run.revision < 0` branch: `if (w.warm.length > 0) return { kind: 'warm', run: () => warmStep(w) }`; `warmStep` shifts one input and calls `financePreOf(i)`, then `.marketSkip(w.horizon)` and `.affordableSkip(w.horizon)`. `slice` gives `'warm'` a macrotask of its own, as `'shown'` has (`return kick(st)` before it when not first, and after it). The mini harness proves order and outputs only; the wall-clock check is Task 11's.

- [ ] **Step 4: Run** the finance and levers host specs, then `npx vitest run --project server src/lib/sim/scenario` — PASS.

- [ ] **Step 5: Commit** `perf(sim): warm the finance precompute in a task before the band`.

### Task 11: R-P3, bench cases 4 and 5 with the bench funding on the plan

**Files:**
- Modify: `src/lib/sim/scenario/fixtures/bench-finance.ts` (add `benchFundingLevers`), `src/lib/sim/scenario/fixtures/synth-city.ts` (add `synthPolicy` and the policy URL), `src/lib/sim/scenario/scenario.bench.spec.ts:591-669`

**Interfaces:**
- Produces: `benchFundingLevers(asOf: Day): FinanceLevers` = `benchFunding(asOf)` with every pool and programme id prefixed `u-` (programme `pool` references renamed with them), `baselineScale: []`, `terms: {}` (builder's call: `benchFunding`'s own ids stay, since cases 3 and 7 and the engine specs use them); `synthPolicy(city: SynthCity): PolicyParcels` (modelled on `miniPolicy`, `fixtures/mini-policy.ts:53-`: FZP as written, no SB 79, no S207, current law = the envelope).

- [ ] **Step 1: Change the cases.** The bench host `Rig` serves `policy.bin` (manifest `scenarios.fzp.policy`) with a `decodePolicy` dep returning `synthPolicy(city)`; cases 4 and 5 `initScenario` with `levers: { ...DEFAULT_LEVERS, finance: benchFundingLevers(SYNTH_AS_OF), compare: 'fzp' }`. Add a non-timed assertion that the lever revision went `current` and that the plan's `finance.pools` ids end with `u-bench-bond`, `u-bench-fund` (read from the first `levers` post and a `vi.mock('./simulate')` spy already in the file). Rewrite the R-P3 comment above the describe to say the cases now run the bench funding on the plan.

- [ ] **Step 2: Run** `npx vitest run --project perf src/lib/sim/scenario/scenario.bench.spec.ts -t "F18 cases 4 and 5"`. Wall-clock only on a quiet machine (check `uptime` load below 2 on this machine and no other agents' builds); otherwise report the numbers as ballpark and say so. Report case 4's and case 5's figures, and whether the longest band task after Task 10 is near the warm figure (44 to 47 ms). A budget miss is reported, not fixed here (the F18 budgets are the conductor's to re-set).

- [ ] **Step 3: Commit** `test(perf): run bench host cases 4 and 5 with the bench funding as levers`.

### Task 12: Developer documentation

**Files:**
- Create: `docs/dev/finance-levers.md`, `docs/dev/sim-funding.md`
- Modify: `docs/dev/sim-levers.md` ("The lever document"; new "Funding levers"), `docs/dev/plan-sharing.md` ("Policies (`/sim`)"), `docs/dev/sim-page.md` ("The recipe and its compile rules", "Autosave, publish and the read-only view"), `docs/dev/finance-engine.md` (bench section lines 579-580 and the R-P3 bullet 664-665; a note on the warm task under "Budgets"), `docs/dev/testing.md` (the `fixtures/schema2` byte copies), `CLAUDE.md` ("Scoped reference docs")

- [ ] **Step 1: Write `docs/dev/finance-levers.md`**: the parse rules in brief (section 4.1, shared `checkPool`, the `u-` rule, typed terms and their bounds), `buildFinance`'s steps 1 to 6, and verbatim this F7 statement: "For a stretch of a baseline pool's `baselineScale` entries at scale 0, `buildFinance` emits one `off` span `{ pool, from, to }`: `from` is the first zero entry's `from` (not clipped at `asOf`), `to` the day before the next entry above 0, or null. A capped pool's arrivals inside the span are scaled to 0 and dropped, so they are absent from `plan.finance` inflows; the engine and the score skip off days themselves as well. An uncapped pool keeps its object; only the span is emitted. Programme ids are never split or renamed." Name the test that pins it (`'scale 0 then 1 on a capped pool: one off span, no arrival inside it'`). Then the twin and `bare()` rule, the worker's `bad-request` and `inForce`, the warm task (Task 10, with its cost moved out of the band window), and the bench levers (Task 11).
- [ ] **Step 2: Write `docs/dev/sim-funding.md`** per spec section 8 ("Funding levers in a policy" pointing to `finance-levers.md`, `sim-levers.md`, `plan-sharing.md`; "Presets" with the table, sources, pages, tiers, verification dates, availability, ids, `POOL_KIND_DEFAULTS` vs `valueSource`, the fill-rule effects, how to switch on a certified measure).
- [ ] **Step 3: Update the other docs** per spec section 8 (`sim-levers.md`'s "Funding levers" stays brief and links `finance-levers.md`). In `CLAUDE.md` add both lines: the spec's `sim-funding.md` line verbatim, and "**Funding levers (`FinanceLevers`, `buildFinance`, `off` spans, the twin, the worker's guard, the finance warm task)** — [docs/dev/finance-levers.md](docs/dev/finance-levers.md)".
- [ ] **Step 4: Run** `npm run lint` and `npm run test:unit` — PASS.
- [ ] **Step 5: Commit** `docs: funding levers, presets and the schema-3 loader`.

## Open questions

1. **Two docs for one subsystem.** The conductor named `docs/dev/finance-levers.md`; the spec names `docs/dev/sim-funding.md` (which `funding-ui` extends). Recommendation: keep both as planned, `finance-levers.md` the engine-facing reference (worker side) and `sim-funding.md` the page side; `sim-levers.md` links rather than repeats.
2. **The warm task is still a long macrotask** (I2): it moves the 85 to 95 ms cold cost out of the band window into a load-phase task of its own, before revision 0 on a cold input and after each lever `current`. Recommendation: accept (it is what I2 asked); if the conductor wants every macrotask under 50 ms, split `financePreOf` itself, which is `finance-engine`'s code.
