# Finance Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/lib/sim/finance/`, the pure, worker-safe module of sourced constants and public-money arithmetic (prototypes, market terms, grant-equivalents, bundles, income tiers, debt service, legal limits).

**Architecture:** Seven small TypeScript files under `src/lib/sim/finance/` with relative imports only, each with a colocated Vitest server spec. The evidence types move out of the page (`src/lib/sim-page/timing-sources.ts`) into `evidence.ts` and are re-exported back. Every constant is `Sourced` (with a full `Provenance`) or `Unsourced` (with a reason). Types `Dollars`, `IncomeTier`, `INCOME_TIERS`, `ProjectKind`, `Instrument`, `PoolKind`, `TermKey`, `ResolvedTerms`, `LimitStatement`, `Provenance` are imported from `../../timelapse/types` (declared at step 0, commit b59c0731); never redeclare them.

**Tech Stack:** TypeScript, Vitest (server project, `expect.requireAssertions`).

**Spec:** `docs/superpowers/specs/2026-11-09-finance-model-design.md` (the spec). Every task reads the spec sections it names; exact strings (error messages, provenance labels/methods, limit statement texts, `Unsourced` reasons) are copied from the spec verbatim.

## Global Constraints

- Evidence hierarchy: every number carries a `Provenance` with its tier and source; a value that cannot be sourced is `Unsourced` with a reason. No tier 3 or 4 number is presented as data. Never invent a value: every value comes from the spec.
- `src/lib/sim/finance/` imports only by relative path: no `$lib`, `svelte`, `zod`, DOM, nothing from `src/lib/sim-page/`, no `Intl`/`toLocaleString` (number formatting uses `toFixed`).
- Pure functions: no clock, no global state, no random draws, never mutate arguments.
- Do not edit `src/lib/timelapse/types.ts` or `pipeline/lib/version.ts` (adding the path is `market-baseline`'s). Change no golden or fixture. No dataset build/upload, no `npm run signoff`, no push, no PR.
- Step 0 declares `ResolvedTerms = Record<TermKey, number | null> & { custom: TermKey[] }` (so `lossOnExit` is typed `number | null`, wider than the spec's `number`). Build against it; `resolveTerms` always yields a number for `lossOnExit`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns (Prettier + ESLint). `npm run check` and `npm run lint` clean, `npm run test:unit` passes.
- Conventional Commits. No Claude attribution anywhere (no Co-Authored-By, no generated-by footers). Never chain `cd ... && cmd`.
- Shared `Provenance` for each `Sourced` entry: tier, label, sources with URLs, method with the page and quoted words, ending "accessed 2026-11-09" (spec 4.3).

## Review Focus

1. An invalid instrument reaching `grantEquivalentPerHome` or `fundBundle` must throw `RangeError` with `validateInstrument`'s text, never return NaN (test in Task 3 and Task 4).
2. Results are fresh: mutating a `resolveTerms` result (its `custom` array) or a `fundBundle` result must not change the next call, and `MARKET_TERMS`/`PROTOTYPES` are frozen (tests in Tasks 1, 2, 4).
3. Inclusionary band edges: 10 homes → low 2 (1.5 rounds up), 24 → low 4 (3.6), 25 switches band (Task 5).
4. `limitStatements` with mixed `goBond` and `cop` entries returns `goRate, goCap, goVote, copCap` in that order; `debtService(0, …)` is `{ annual: 0, total: 0 }` (Task 6).
5. A bundle whose loans alone exceed `U`: coverage above 1, `certain` true, every grant pays 0, no negative amounts anywhere (Task 4).

---

### Task 1: Evidence types, prototypes, import guard

**Files:**
- Create: `src/lib/sim/finance/evidence.ts`, `src/lib/sim/finance/prototypes.ts`, `src/lib/sim/finance/prototypes.spec.ts`, `src/lib/sim/finance/imports.spec.ts`
- Modify: `src/lib/sim-page/timing-sources.ts:9-17` (replace declarations with an import + re-export)
- Test: `src/lib/sim-page/timing-sources.spec.ts` (existing, unchanged, must still pass)

**Interfaces:**
- Produces: `Sourced<T>`, `Unsourced`, `Evidence<T>` (spec section 2, shapes unchanged); `PrototypeId`, `PROTOTYPES`, `PROTOTYPE_BINNING: Sourced<null>`, `prototypeFor(stories: number, homes: number): Prototype`, `LAND_PER_HOME: Sourced<Dollars>`, `AFFORDABLE: Sourced<{ costPerHome: Dollars; ownPerHome: Dollars }>`, `uncoveredPerHome(kind: ProjectKind, p: Prototype): Dollars`, `costPerHome(kind: ProjectKind, p: Prototype): Dollars`. `interface Prototype` is declared and exported in `prototypes.ts` with F4's exact shape (`id: 'A'|'B'|'C'|'D'|'E'; stories: number; homes: number; costPerHome: Dollars; shortfallPerHome: Dollars; provenance: Provenance`); F4 is this subsystem's row and step 0 does not declare it (verified: no `Prototype` in `src/lib`).

- [ ] **Step 1: Write failing tests** — `prototypes.spec.ts` covering spec section 6 `prototypes.spec.ts` bullets exactly: the 4.2 value table; `Object.isFrozen(PROTOTYPES)` and each entry; each provenance tier 1 with `method` containing "p. 4" and "p. 11" and ending with "(PROTOTYPE_BINNING)."; `PROTOTYPE_BINNING.provenance.tier === 4`; every `prototypeFor` case in spec section 6 plus `(-3, 100)` → A and `(30, -5)` → E; `prototypeFor(8, 130) === PROTOTYPES[1]`; `prototypeFor(NaN, 30)` and `prototypeFor(5, Infinity)` throw `RangeError` with message `prototypeFor needs finite stories and homes; got NaN, 30`; `uncoveredPerHome`/`costPerHome` equal the 4.2 results table for all five and both kinds; `LAND_PER_HOME.value === 65000` tier 2; `AFFORDABLE.value` `{ costPerHome: 954127, ownPerHome: 92602 }` tier 1; `uncoveredPerHome('rent' as ProjectKind, B)` throws `RangeError('unknown project kind: rent')`.
  `imports.spec.ts`: read every `*.ts` file in `src/lib/sim/finance/` (via `node:fs` and `import.meta.dirname` or `fileURLToPath`), collect `from '…'` and `import('…')` specifiers; assert each starts with `./` or `../`, none contains `sim-page`, `$lib`, `svelte`, `zod`; assert no file's text (excluding `imports.spec.ts` itself) contains `Intl.`, `toLocaleString`, `document.` or `window.`. The test must find at least `evidence.ts` and `prototypes.ts` (assert the file list is non-empty).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/finance` — expect FAIL (modules missing).
- [ ] **Step 3: Implement** `evidence.ts` (types only, importing `Provenance` type from `../../timelapse/types`); `prototypes.ts` per spec 4.2 (values, provenance texts, `PROTOTYPE_BINNING` method text verbatim, errors). In `timing-sources.ts` replace lines 9-17 with `import type { Evidence, Sourced, Unsourced } from '../sim/finance/evidence';` and `export type { Evidence, Sourced, Unsourced } from '../sim/finance/evidence';`.
- [ ] **Step 4: Run** `npx vitest run --project server src/lib/sim/finance src/lib/sim-page` — PASS; `npm run check` clean.
- [ ] **Step 5: Commit** `feat(finance): add evidence types and the Controller prototypes`

### Task 2: Market terms and `resolveTerms`

**Files:**
- Create: `src/lib/sim/finance/terms.ts`, `src/lib/sim/finance/terms.spec.ts`

**Interfaces:**
- Consumes: `Sourced`, `Unsourced`, `Evidence` (Task 1); `TermKey`, `ResolvedTerms` from `../../timelapse/types`.
- Produces: `export type { TermKey, ResolvedTerms }`; `MarketTerms` (spec section 2); `MARKET_TERMS: MarketTerms` (frozen, deep); `TYPED_TERM_RANGES: Readonly<Record<TermKey, readonly [number, number]>>`; `resolveTerms(m?: MarketTerms, typed?: Partial<Record<TermKey, number>>): ResolvedTerms`; `CONSTRUCTION_LOAN_TO_COST`, `DRAW_UP_FRONT`, `AVERAGE_DRAWN: Sourced<number>`; `isResolvedTerms(t: MarketTerms | ResolvedTerms): t is ResolvedTerms` (true when `'custom' in t`; used by Task 3).

- [ ] **Step 1: Write failing tests** — spec section 6 `terms.spec.ts` bullets: values 0.085 (tier 3), 1.917 (tier 2), 0.06 (tier 1), `guaranteeRateCut` `{ value: null, reason }` with the exact 4.3 reason, `lossOnExit` 1 tier 4; `DRAW_UP_FRONT.value` 0.1, `AVERAGE_DRAWN.value` `toBeCloseTo(0.55, 12)`, both tier 4, methods containing "the partner's assumption, R11"; `CONSTRUCTION_LOAN_TO_COST` 0.55 tier 3; `resolveTerms()` equals `{ constructionRate: 0.085, constructionYears: 1.917, requiredReturn: 0.06, guaranteeRateCut: null, lossOnExit: 1, custom: [] }`; typed `{ guaranteeRateCut: 0.01 }` → 0.01 and `custom: ['guaranteeRateCut']`; typed `constructionRate: 0.07` replaces 0.085, listed; typed `{ requiredReturn: 0.06, constructionRate: 0.07 }` → `custom: ['constructionRate', 'requiredReturn']` (typed equal to sourced is still listed); unknown key and `undefined` value ignored; for each key, both bounds of the 4.3 range table accepted, `lo − 1e-9`, `hi + 1e-9` and NaN throw `RangeError` with `'<key> must be between <lo> and <hi>; got <v>'`; two `resolveTerms()` results are distinct objects and pushing to one's `custom` leaves the next call's `[]`; `Object.isFrozen(MARKET_TERMS)`.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/finance/terms.spec.ts` — FAIL.
- [ ] **Step 3: Implement** per spec 4.3: constants and provenance from the 4.3 tables (Terner p. 12/p. 13 quotes, dataset `2026-11-08-d15bdf2d` method, Controller p. 11 row 14, FDIC/2.5% note in `lossOnExit` method, R11 methods). `AVERAGE_DRAWN.value` computed as `DRAW_UP_FRONT.value + (1 - DRAW_UP_FRONT.value) / 2`, not a literal. `resolveTerms` per 4.3: typed wins, `custom` sorted, range check before use.
- [ ] **Step 4: Run** the spec file — PASS.
- [ ] **Step 5: Commit** `feat(finance): add market terms and resolveTerms`

### Task 3: Instrument arithmetic and validation

**Files:**
- Create: `src/lib/sim/finance/instruments.ts`, `src/lib/sim/finance/instruments.spec.ts`, `src/lib/sim/finance/test/fixtures.ts`

**Interfaces:**
- Consumes: Tasks 1-2; `Instrument`, `ProjectKind`, `PoolKind`, `Dollars` from `../../timelapse/types`.
- Produces: `CERTAIN_TOLERANCE = 1e-9`, `isCertain(coverage: number): boolean`, `termsNeeded(inst: Instrument): TermKey[]`, `missingTerms(inst: Instrument, terms: MarketTerms | ResolvedTerms): TermKey[]`, `INSTRUMENT_BOUNDS` (spec section 2 shape, `as const`), `validateInstrument(inst: Instrument): string | null`, `grantEquivalentPerHome(inst, kind, p, terms): Dollars`, `coverage(g: Dollars, kind, p): number`, `oddsShift(g: Dollars, kind, p, slope: number): number`, `projectDollars(perHome: number, homes: number): Dollars`. A module-private helper computes the exact (unrounded, loan-capped) grant-equivalent from `ResolvedTerms`; `grantEquivalentPerHome` rounds it, and Task 4's `fundBundle` (same file, per the spec's file list) reuses it.
- Fixtures (`test/fixtures.ts`, spec section 6): `B = PROTOTYPES[1]`, `TERMS = resolveTerms()`, `TERMS_CUT = resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01 })`, `SLOPE_FIXTURE = 1.75`, `BASELINE_BUNDLE`, `BASELINE_SPLIT` as `BundleItem[]` (declare the `BundleItem` interface in `instruments.ts` now: `{ instrument: Instrument; poolKind: PoolKind }`).

- [ ] **Step 1: Write failing tests** — spec section 6 `instruments.spec.ts` bullets other than `fundBundle`: worked values (grant `share = 50000/217000` on B → 50000, `50000/736700` toBeCloseTo 0.068 at 3 places; loan `{costShare:1, rate:0.085, requiredReturn:0.0525}` market B → 83529; loan `{0.6, 0.04, null}` → 20972); same result for `MARKET_TERMS` and `TERMS`; `oddsShift(50000,'market',B,1.75)` toBeCloseTo(0.1187729, 7), `Math.exp` of it toBeCloseTo(1.1261, 4); loan rate 0.09 with `requiredReturn` 0.07 → 0; `requiredReturn` 0.02 costShare 1 rate 0.085 → 736700; guarantee `{0.6, reserve 0.1}` under `TERMS` throws `'guarantee needs guaranteeRateCut, which is not sourced'`, under `TERMS_CUT` → 4660; affordable loan `{1, 0.085, 0.0525}` → `Math.round(92602 * (0.06/0.0525 - 1))`; `termsNeeded`/`missingTerms` per 4.4 (loan with and without `requiredReturn`; guarantee `['guaranteeRateCut']` under TERMS, `[]` under TERMS_CUT); `validateInstrument` each 4.4 message on both sides of every bound and NaN (grant share 0 and 1.0001; costShare 0 and 1.0001 for loan and guarantee; rate −0.0001 and 0.2501; requiredReturn 0.0099, 0.2501 and 0; reserve −0.01 and 1.01), `{kind:'swap'}` → "Unknown instrument kind.", null for share 0.348251, share 1, rate 0, reserve 0 and 1, requiredReturn null/0.01/0.25; `INSTRUMENT_BOUNDS` toEqual the spec section 2 object; `coverage(-1,…)`, `coverage(NaN,…)`, `oddsShift(-1,…)`, `oddsShift(NaN,…)` throw `'grant-equivalent must be a finite number of 0 or more; got <g>'`; `oddsShift(0,'market',B,1.75)` is 0; `isCertain(1 - 1e-12)` true, `isCertain(0.999)` false; `projectDollars(300027, 130)` 39003510, `projectDollars(0.5, 1)` 1; Review Focus 1: `grantEquivalentPerHome({kind:'grant', share: 2}, …)` throws `RangeError` with the grant message.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/finance/instruments.spec.ts` — FAIL.
- [ ] **Step 3: Implement** per spec 4.4 and 4.5 (first two paragraphs): `MarketTerms` argument resolved with `resolveTerms(terms)` when `!isResolvedTerms`; validate then check missing terms (first missing key in `termsNeeded` order) before arithmetic; loan sum capped at `P`; round once with `Math.round`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(finance): add grant-equivalents, coverage and instrument checks`

### Task 4: `fundBundle`

**Files:**
- Modify: `src/lib/sim/finance/instruments.ts`
- Create: `src/lib/sim/finance/bundle.spec.ts` (separate spec file for the bundle tests)

**Interfaces:**
- Consumes: Task 3 (module-private exact grant-equivalent, `isCertain`, fixtures).
- Produces: `ItemFunding`, `BundleFunding` (spec section 2), `fundBundle(items: readonly BundleItem[], kind: ProjectKind, p: Prototype, terms: MarketTerms | ResolvedTerms): BundleFunding`.

- [ ] **Step 1: Write failing tests** — every `fundBundle` bullet of spec section 6 (`instruments.spec.ts` list, from "fundBundle(BASELINE_BUNDLE…" through "Order"), with the values and tolerances given there (baseline; empty; added City grant `goBond` → 150013.5 each; added federal on `BASELINE_SPLIT` → 100004.4996 / 100022.5004 to 1e-4; added City loan → 272865.44 to 1e-2 and `lent` 572476.2; tiers bullets; floating point incl. 10,000 seeded draws using a small local seeded PRNG (mulberry32) asserting `isCertain` and `expect(coverage === 1)` is never relied on; `lent`/`guaranteed`/`reserve` bullet; 16 subsets with properties (i)-(iii) and the `generalRevenue`-left-out case → `goBond` grant 87528 to 1e-6; every permutation of the four-item bundle). Plus Review Focus 1 (invalid item throws), 2 (mutating `result.items[0].granted` then calling again gives the original), 5 (two federal loans `{costShare:1, rate:0, requiredReturn:0.01}` on B plus grants of 1 in every tier: coverage > 1, `certain` true, every grant `granted === 0`, no negative field).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/finance/bundle.spec.ts` — FAIL.
- [ ] **Step 3: Implement** spec 4.5 "Bundles" steps 1-6 exactly: tiers federal → state → City (`bank`, `dedicatedTax`, `generalRevenue`, `goBond`, `cop`); within a tier loans/guarantees first (`L_t` accumulated in input order from 0, `R = max(0, R − L_t)`), then grants (`S` summed in input order; fit test `S <= R`; scaled: `f = R / S` once, each pays `g_j * f`, tier total taken as `R`, then `R = 0`); `grantEquivalent` accumulated tier by tier (`L_t` then grant total); `coverage = grantEquivalent / U`; per-item fields per step 5; `items[i]` for input `i`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(finance): price bundles by tier with fundBundle`

### Task 5: Income tiers, inclusionary table, displacement range

**Files:**
- Create: `src/lib/sim/finance/tiers.ts`, `src/lib/sim/finance/tiers.spec.ts`

**Interfaces:**
- Consumes: `Sourced` (Task 1); `IncomeTier`, `INCOME_TIERS` from `../../timelapse/types`.
- Produces: `AMI_TIER_BOUNDS`, `tierOfAmi(amiShare: number): IncomeTier`, `Tenure`, `InclusionaryBand`, `INCLUSIONARY: Sourced<Record<Tenure, InclusionaryBand[]>>`, `ASSUMED_TENURE: Sourced<Tenure>`, `inclusionaryUnits(homes: number, tenure?: Tenure): Record<IncomeTier, number>`, `DISPLACEMENT_RANGE: Sourced<{ low: number; high: number }>`.

- [ ] **Step 1: Write failing tests** — spec section 6 `tiers.spec.ts` bullets with their values; `INCLUSIONARY.value` toEqual `{ rental: [{minHomes:10,maxHomes:24,ami:[0.55],basisPoints:[1500]}, {minHomes:25,maxHomes:null,ami:[0.55,0.8,1.1],basisPoints:[1000,400,400]}], ownership: [{10,24,[0.8],[1500]}, {25,null,[0.8,1.05,1.3],[1000,500,500]}] }`; `INCLUSIONARY.provenance.method` mentions the rounding rule as tier 4 and that the 2028 rise is not applied; `tierOfAmi(NaN)` and `tierOfAmi(-0.1)` throw `RangeError`; `inclusionaryUnits(-1)` and `inclusionaryUnits(1.5)` throw; Review Focus 3: 10 → low 2, 24 → low 4, others 0; `DISPLACEMENT_RANGE` low 0.115, high 0.8, tier 3, `sources` URLs include both 4.7 URLs.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/finance/tiers.spec.ts` — FAIL.
- [ ] **Step 3: Implement** per spec 4.6 and 4.7: total `Math.floor((homes * b + 5000) / 10000)`; per-tier basis points summed via `tierOfAmi(ami[k])`; largest-remainder split of the total over `homes * bp / 10000` per tier, ties to the lower-income tier (`INCOME_TIERS` order). Use integer arithmetic (`homes * bp` and remainders mod 10000) so ties are exact.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(finance): add income tiers, inclusionary units and the displacement range`

### Task 6: Debt service and legal limits

**Files:**
- Create: `src/lib/sim/finance/debt.ts`, `src/lib/sim/finance/debt.spec.ts`

**Interfaces:**
- Consumes: `Provenance`, `LimitStatement`, `Dollars` from `../../timelapse/types`.
- Produces: `debtService(principal: Dollars, debt: { rate: number; termYears: number }): { annual: Dollars; total: Dollars }`, `DEBT_BOUNDS` (spec section 2), `validateDebt(debt): string | null`, `Borrowing`, `DEBT_LIMITS: Readonly<Record<'goPolicyRate'|'goRateToday'|'goPolicyReachedFy'|'goRatePerAnnualDollar'|'goCapShare'|'assessedValue'|'goOutstanding'|'copCapShare'|'discretionaryRevenue'|'copReachedFy'|'goVote', Sourced<number | string>>>` (each entry `Sourced` with tier 1, the 4.8 page and quoted words; `goVote` value `'two thirds'` citing Resolution 562-24 p. 2 and the 403 note; `goRatePerAnnualDollar` value `0.01 / 35784254`), `limitStatements(borrowing: readonly Borrowing[]): LimitStatement[]`.

- [ ] **Step 1: Write failing tests** — spec section 6 `debt.spec.ts` bullets: `debtService(410442573, {rate:0.06, termYears:20})` toEqual `{ annual: 35784254, total: 715685078 }`; `debtService(1668752923, {rate:0.065, termYears:20}).annual` 151450000; `validateDebt` accepts rate 0.25, terms 1 and 40; messages for rate 0, 0.2501, NaN, term 0, 41, 20.5; `debtService` throws `RangeError` for each and for principal −1 and NaN; Review Focus 4: `debtService(0, {0.06, 20})` `{0, 0}`. `limitStatements([])` `[]`; $300M goBond 6%/20 → ids `['goRate','goCap','goVote']`, `goRate.text` contains "$26.2 million a year", "0.0073%", "$7.31", `goCap.text` ends "This is within the cap." with `exceeded` false, `goRate`/`goVote` exceeded true; $8,000M goBond → goCap "This is over the cap." exceeded true; $100M cop 6.5%/20 → only `copCap`, text contains "$9.1 million a year" and "0.19%", exceeded true; Review Focus 4: goBond $300M plus cop $100M → ids in order `goRate, goCap, goVote, copCap`; provenance tiers goRate 2, goCap 2, goVote 1, copCap 2. Also assert the exact full `goVote` text for the $300M case: "City general-obligation bonds need a two-thirds vote of the people voting on them. This run assumes $300.0 million of new bonds that no vote has approved."
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/sim/finance/debt.spec.ts` — FAIL.
- [ ] **Step 3: Implement** per spec 4.8: annuity formula, round annual and `total = Math.round(exactAnnual * termYears)`; statement texts verbatim from the 4.8 table with the fixed number formats (money `< 1e9` → `$${(x/1e6).toFixed(1)} million`, else `$${(x/1e9).toFixed(2)} billion`; rate `toFixed(4)` + "%"; per $100,000 `$` + `toFixed(2)` of `rate% / 100 × 100000`; revenue share `toFixed(2)` + "%"). Charter cap computed as `goCapShare × assessedValue`; the goCap provenance notes the $8.07 billion discrepancy and the amortisation caveat; goRate/copCap provenance states the tier 2 no-headroom inference; copCap provenance notes COP issuance costs not modelled.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(finance): add debt service and legal-limit statements`

### Task 7: Index, developer doc, full verification

**Files:**
- Create: `src/lib/sim/finance/index.ts`, `src/lib/sim/finance/index.spec.ts`, `docs/dev/finance-model.md`
- Modify: `CLAUDE.md` (Scoped reference docs list), `docs/dev/sim-timers.md` ("Evidence" section, one sentence)

**Interfaces:**
- Consumes: every export of Tasks 1-6.
- Produces: `index.ts` re-exporting all public names of `evidence`, `prototypes`, `terms`, `instruments`, `tiers`, `debt`.

- [ ] **Step 1: Write failing test** `index.spec.ts`: imports `* as finance from './index'` and asserts a list of runtime export names is present (`PROTOTYPES`, `prototypeFor`, `uncoveredPerHome`, `costPerHome`, `LAND_PER_HOME`, `AFFORDABLE`, `PROTOTYPE_BINNING`, `MARKET_TERMS`, `TYPED_TERM_RANGES`, `resolveTerms`, `CONSTRUCTION_LOAN_TO_COST`, `DRAW_UP_FRONT`, `AVERAGE_DRAWN`, `grantEquivalentPerHome`, `coverage`, `oddsShift`, `CERTAIN_TOLERANCE`, `isCertain`, `termsNeeded`, `missingTerms`, `INSTRUMENT_BOUNDS`, `validateInstrument`, `fundBundle`, `projectDollars`, `AMI_TIER_BOUNDS`, `tierOfAmi`, `INCLUSIONARY`, `ASSUMED_TENURE`, `inclusionaryUnits`, `DISPLACEMENT_RANGE`, `debtService`, `DEBT_BOUNDS`, `validateDebt`, `DEBT_LIMITS`, `limitStatements`).
- [ ] **Step 2: Run** it — FAIL; **Step 3:** write `index.ts`; run — PASS.
- [ ] **Step 4: Write `docs/dev/finance-model.md`** covering every bullet of spec section 8, with the Evidence table in the format of `docs/dev/sim-timers.md` "Evidence". Add the CLAUDE.md line verbatim from spec section 8, placed after the "Road-like lots" entry. Add to `docs/dev/sim-timers.md` "Evidence" one sentence: "The `Sourced`, `Unsourced` and `Evidence` types now live in `src/lib/sim/finance/evidence.ts`; `timing-sources.ts` re-exports them."
- [ ] **Step 5: Verify** `npm run format` (only touched files may change), then `npm run check`, `npm run lint`, `npm run test:unit` — all clean/pass; record the counts.
- [ ] **Step 6: Commit** `docs(finance): document the finance model`
