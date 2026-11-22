# S4 census: the simulation engine

Repo: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game`. All paths below are relative to it. Marks: V = verified in code at the cited `path:line`; I = inferred (source stated); "not examined" = not opened.
Mechanical survey: no judgement, no recommendation.

## 0. Headline facts (all V unless marked)

- The live `/sim` engine is the **world/step engine** (`src/lib/sim/world/**`), run by the **timeline host** (`src/lib/sim/world/host.ts`) behind the Worker router (`src/lib/sim/router.ts:63-201`). The older **scenario engine** (`src/lib/sim/scenario/engine.ts`, `funded.ts`, `scenario-host.ts`) still exists, is still routed (`router.ts:82,121-122` `initScenario`, `reroll`, `setLevers`), and is the thing the world code cites as the reference ("`funded.ts:1684-1720`", "`money.ts:97-163`" in comments, `world/funding/policy.ts:2`, `pools.ts:1`). I: the scenario host is the `/fzp` and lesscars-adjacent path and a referee; I did not read its callers beyond `grep -l` (`src/lib/lesscars/LessCarsMode.svelte`, `src/lib/sim-page/SimPage.svelte`, `src/lib/timeline/TimelineMode.svelte`, `src/lib/timeline/session.svelte.ts` mention `TimelineClient`/`ScenarioClient`/`PlaybackClient`).
- The user-facing policy document on `/sim` is **schema 4** (`SimPolicy4`, dated spans). The engine's older **schema 3** `SimLevers` (`src/lib/sim/levers/types.ts:70`) is still the type that `buildFinance`, `zoningLevers`, `moneyLeversOf` and `compileTimeline` produce/consume internally ("today's undated lever shapes", `world/policy/combine.ts:2-3`). There are **two different "schema 3" types**: `SimLevers` (engine) and `SimPolicy` (page, `src/lib/sim-page/policy.ts:58`).
- **Law switch**: does not exist in code. `grep -rn 'lawSwitch\|afterSwitch'` over `src/lib/sim src/lib/timelapse` returns nothing outside specs. `src/lib/sim/scenario/types.ts:110-111` calls `regimes` "the retired law switch ... generalised". `docs/dev/sim-levers.md:20` and `:234` agree.
- **Month at which a homes total is reached**: not computed anywhere under `src/lib/sim` or `src/lib/timelapse`. The sim emits a per-month series `TimelineScore.targets[].fraction[]`. A reached-month IS computed outside scope: `src/lib/goal/goal.ts:92-103` (`readGoal` -> `reachedOn`), see section 5c.
- **Unbounded public money**: every baseline capped pool is `yearly from asOf, to: null`; the federal pool is `uncapped: true` (Infinity available). See section 4c.
- **Market**: `SimInput.market` is set in exactly one place, `buildSimInput` (`src/lib/sim/scenario/input.ts:75,84`), to one step at `asOf`. No lever, document field or UI sets it. Section 8.
- **Seed**: the timeline host runs two worlds (plan and comparison), both on `SEED = 1` (`src/lib/sim/world/runner/ensemble.ts:26`). No ensemble of N seeds on `/sim`. The scenario host's band has `BAND_RUNS = 101` (`src/lib/sim/scenario/band.ts:6`).

## 1. Directory map

Line counts are `wc -l` of non-test files (specs, `test/`, `fixtures/`, golden files excluded unless noted). Roles marked I come from names/headers only.

### 1.1 `src/lib/sim/` top level
| File | Lines | Role | Exports |
|---|---|---|---|
| `chunks.ts` | 197 | I: chunk loader for parcel cells | `FetchLike ChunkLoaderDeps ChunkLoader createChunkLoader cellsIntersecting` |
| `client.ts` | 254 | V: main-thread client of the *editor* host (`SimRequest`/`SimResponse`), not the timeline | `WorkerLike SimClientEvents SimClient spawnSimWorker` |
| `display.ts` | 234 | I: editor display | `DisplayDeps UpdateMeta Display createDisplay` |
| `host.ts` | 530 | V: editor host (`createSimHost`), default targets `M1_TARGETS` (`host.ts:110`) | `SimHostDeps SimHost DEFAULT_MEMO_CAP DEFAULT_RETRY_DELAYS_MS createSimHost` |
| `lookup-requests.ts` | 190 | I: request/answer table for lookups | `LookupRequests` |
| `lru.ts` | 56 | I | `Lru createLru` |
| `manifest-shape.ts` / `manifest.ts` | 39 / 36 | I: manifest check/load | `checkManifestShape`, `loadManifest` |
| `outlines.ts` | 52 | I: lot outline packing | `LotOutlines packOutlines` |
| `protocol.ts` | 105 | V: editor protocol; re-exports scenario types (`protocol.ts:105`) | `Rev SimRequest SimResponse ParcelSummary ...` |
| `router.ts` | 220 | V: Worker router across editor, scenario, playback, timeline hosts | `RouterDeps createWorkerRouter` |
| `scenario-client.ts` | 345 | V: client of the scenario host | `ScenarioWorkerLike ScenarioClientEvents ScenarioClient` |
| `timeline-client.ts` | 277 | V: client of the timeline host; `WINDOW_MONTHS = 480` (`:29`) | `WINDOW_MONTHS TimelineClientEvents TimelineClient` |
| `timeline-protocol.ts` | 185 | V: timeline host message types | `OpenTimelineRequest SetPolicyRequest TimelineRequest TimelineResponse TimelineHostRequest TimelineHostResponse openTimelineProblem setPolicyProblem` |
| `worker.ts` | 59 | V: thin shell: builds the four hosts and the router | (none) |

### 1.2 `src/lib/sim/finance/` (pricing arithmetic, sourced constants)
| File | Lines | Role | Exports |
|---|---|---|---|
| `debt.ts` | 287 | V: debt service, legal-limit statements | `DEBT_BOUNDS validateDebt debtService Borrowing DEBT_LIMITS limitStatements` |
| `evidence.ts` | 13 | V: `Sourced`/`Unsourced`/`Evidence` | |
| `index.ts` | 49 | V: public surface | re-exports |
| `instruments.ts` | 307 | V: instrument bounds, `fundBundle` (3 tiers: federal, state, City), `tierOf` | `CERTAIN_TOLERANCE isCertain INSTRUMENT_BOUNDS validateInstrument termsNeeded missingTerms grantEquivalentPerHome coverage oddsShift tierOf fundBundle projectDollars` |
| `prototypes.ts` | 151 | V: five building prototypes A-E | `PROTOTYPES PROTOTYPE_BINNING prototypeFor LAND_PER_HOME AFFORDABLE uncoveredPerHome costPerHome` |
| `terms.ts` | 195 | V: market terms | `MARKET_TERMS TYPED_TERM_RANGES CONSTRUCTION_LOAN_TO_COST DRAW_UP_FRONT AVERAGE_DRAWN resolveTerms isResolvedTerms` |
| `tiers.ts` | 182 | V: AMI tier bounds, inclusionary | `AMI_TIER_BOUNDS tierOfAmi INCLUSIONARY ASSUMED_TENURE inclusionaryUnits DISPLACEMENT_RANGE` |

### 1.3 `src/lib/sim/levers/` (schema 3 lever document and its compile)
| File | Lines | Role | Exports |
|---|---|---|---|
| `types.ts` | 246 | V: `SimLevers`, `FinanceLevers`, `parseSimLevers` | `TimedStage StoryEdit Protections TimerEdit Compare COMPARES FinanceLevers SimLevers MIN_SCALE MAX_SCALE DEFAULT_LEVERS LeverFormatError record array parseSimLevers` |
| `finance.ts` | 412 | V: `FINANCE_LIMITS`, `parseFinanceLevers`, `buildFinance` | `FINANCE_LIMITS FIRST_DAY LAST_DAY MAX_DOLLARS parseFinanceLevers buildFinance` |
| `timers.ts` | 213 | V: timer scales, rescale, route shares | `StageScale scaleTable isIdentity sameScale rescaleTransition timersOp routeSharesOp DISAPPROVAL_NEGLIGIBLE disapprovedShare` |
| `resolve.ts` | 212 | V: envelope resolution (rules, paint, protect) | `Need needKey Resolution protectedRows resolveEnvelopes allNeeds fillNeeds netCapacity leverCapacity` |
| `apply.ts` | 162 | V: lever document -> plan/twin `SimInput` | `Lookups LeverLookups LeverInputs twinInput lookupsOf applyLevers` |
| `layers.ts` | 42 | V: stock tables `'fzp' \| 'base'` | `EnvelopeTable LayerCtx DataLayer stockTable` |
| `source.ts` | 73 | V: who sets a lot's limit | `SRC_* LimitSources limitSources LimitOwner ownerOf` |
| `view.ts` | 52 | V: resolved table -> `ScenarioParcels` view | `localProgramColumn parcelsView envelopeOp` |
| `brushes.ts` | 338 | I: brush queries (transit stop types etc.) | `STOP_TYPES StopType BrushQuery BrushCatalog resolveBrushRows brushCatalog ...` |
| `recompute.ts` | 177 | I: yield recompute | `createYieldRecompute createTableRecompute` |

### 1.4 `src/lib/sim/scenario/` (older engine, still live)
| File | Lines | Role | Key exports |
|---|---|---|---|
| `types.ts` | 374 | V: `SimInput`, `Schedule`, `TimelineScore`, scenario protocol | see 2.x, 5 |
| `engine.ts` | 1208 | V: per-project engine, `Sink.ledger` (`:72-78`) | `runEngine runEngineWith Sink Job ...` |
| `funded.ts` | 1910 | V: funded-start latents, line key (`lineKey` `:1057`) | `NEVER_KEY_DAY lineKey financePreOf latentsOf ...` |
| `funding.ts` | 502 | V: `inflowArrivals`, `available`, award rule, finance check | `inflowArrivals checkFinance available awardSet awardPasses financeIndexOf isOff isOffered ...` |
| `money.ts` | 213 | V: `Treasury` (pool counters, events) | `LedgerEvent Treasury` |
| `line.ts` | 415 | V: the line scan (direct + grouped) | `Line scanLine groupedLine` |
| `input.ts` | 497 | V: `buildSimInput`, `Precompute` | `buildSimInput precomputeOf ...` |
| `market.ts` | 29 | V: `marketSteps`, `marketLevel` | |
| `score.ts` | 438 | V: score assembly, `RHNA_DEADLINE`, `targetsOf` | `RHNA_DEADLINE targetsOf tierTargetsOf REFERENCES assembleScore` |
| `finance-score.ts` | 601 | V: tiers and money series | `tierSeries poolSeries moneyOf perAddedHome ...` |
| `band.ts` | 174 | V: N-run band | `BAND_RUNS = 101` (`:6`) |
| `rng.ts` | 72 | V: counter-based draws | `seedHash streamOf drawOn draw P` |
| `policy.ts` | 45 | V: `PolicyOp`, `baseZoning`, `applyPolicies` | |
| `scenario-host.ts` | 1752 | V: scenario host (`SLICE_PLAN_MS` `:242`) | `createScenarioHost` |
| `simulate.ts` | 112 | V | `simulate simulateDetailed simulateNet` |
| `load.ts` | 421 | V: dataset loading | `loadScenario scenarioUrls ...` |
| `card.ts` 262, `massing.ts` 209, `geometry.ts` 242, `lot-at.ts` 24, `dates.ts` 25, `preview.ts` 9 | | I from names | |

### 1.5 `src/lib/sim/world/` (live step engine)
| File/dir | Lines | Role |
|---|---|---|
| `world.ts` | 660 | V: `createWorld step withFunding` |
| `types.ts` | 256 | V: `World`, `WorldEvent` (`:143-150`), `StepCtx`, `FundingSystem` |
| `columns.ts` 263, `due.ts` 298, `pipeline.ts` 486, `stage.ts` 156, `holds.ts` 146, `rates.ts` 195, `read.ts` 168, `statics.ts` 27, `months.ts` 40 | | I from names; `months.ts` V (section 7) |
| `map-stream.ts` 517, `city-feed.ts` 216 | | I: world events -> map updates |
| `policy/` (`compile.ts` 406, `combine.ts` 232, `money.ts` 190, `frame.ts` 54, `intern.ts` 211, `limits.ts` 220, `zoning-view.ts` 240, `compare.ts` 45, `lookups.ts` 53) | | V: schema-4 document -> frames (section 3) |
| `funding/` (`apply.ts` 482, `serve.ts` 299, `pools.ts` 271, `clocks.ts` 326, `columns.ts` 368, `line-index.ts` 251, `frame-money.ts` 156, `shadow.ts` 84, `policy.ts` 77, `system.ts` 71) | | V: the funding hook (section 4) |
| `score/` (`series.ts` 668, `statics.ts` 225, `types.ts` 197, `view.ts` 146, `card.ts` 157, `chunk.ts` 34, `money.ts` 57) | | V: outputs (section 5) |
| `runner/` (`runner.ts` 1391, `ensemble.ts` 334, `dataset.ts` 234, `lookups.ts` 484, `warm.ts` 52, `flags.ts` 65) | | V: fill/refill driver |
| `host.ts` | 459 | V: timeline host |

### 1.6 `src/lib/sim/lesscars/` (playback)
`playback-host.ts` 530, `playback-client.ts` 183, `builds.ts` 87, `types.ts` 49. Section 12.

### 1.7 `src/lib/timelapse/`
`model.ts` 1127 (calibration parse/sampling, `checkPool`, `checkProgramme`, `parseCalibration`), `types.ts` 301 (shared types incl. Pool/Programme), `projects.ts` 468, `projects` file parse, `math.ts` 215 (`exp`, `log`), `time.ts` 77 (`MONTH_DAYS`, `Day`). Exports as listed in the grep (section 1 headings); roles V from headers.

### 1.8 `src/lib/transit/`
`grid.ts` 141 (`buildAccessGrid accessAt`), `service.ts` 89 (`stopService sb79Tier`), `legend.ts` 13, `types.ts` 10, `index.ts` 4. No funding/lever types (I: from export names). Not otherwise examined.

## 2. Lever types (verbatim)

### 2.1 `SimLevers` and its parts (`src/lib/sim/levers/types.ts`)
```ts
// types.ts:19
export type TimedStage = Exclude<Stage, 'complete' | 'construction'>;
// :29
export interface StoryEdit { lots: ParcelId[]; stories: number; source?: string; }
// :36
export interface Protections { rentControl: boolean; historic: boolean; newerThanYears: number | null; }
// :42
export interface TimerEdit { pathway: Pathway; stage: TimedStage; scale: number; reach: 'all' | 'new'; }
// :50
export type Compare = 'preFzp' | 'fzp';
// :70
export interface SimLevers {
  schema: 3;
  rules: StoryEdit[];
  paint: StoryEdit[];
  protect: Protections;
  timers: TimerEdit[];
  routeShares: Record<Pathway, number> | null; // null = observed pathwayForNew
  localProgramStreamlined: boolean;
  compare: Compare;
  finance: FinanceLevers;
}
// :83-84
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;
// :89 DEFAULT_LEVERS = { schema: 3, rules: [], paint: [], protect: {false,false,null}, timers: [], routeShares: null, localProgramStreamlined: true, compare: 'preFzp', finance: { baselineScale: [], pools: [], programmes: [], terms: {} } }
```
`TimedStage` members (V `:20-26`): `preApplication filed entitled permitFiled permitIssued`. Stories 0..255 (`MAX_STORIES` `:87`; checked `:156-172`). `Stage`, `Pathway` (`src/lib/timelapse/types.ts:12-20`):
```ts
export type Stage = 'preApplication'|'filed'|'entitled'|'permitFiled'|'permitIssued'|'construction'|'complete';
export type Pathway = 'discretionary' | 'streamlined' | 'permitOnly';
export type ExitReason = 'withdrawn' | 'disapproved' | 'cancelled' | 'expired';
```
`permitOnly` visits `preApplication, permitFiled, permitIssued, construction, complete` (`timelapse/types.ts:44-49`).

### 2.2 Permitting-timer lever
- Engine shape: `TimerEdit` above; `StageScale` (`levers/timers.ts:24`): `Record<Pathway, Partial<Record<TimedStage, number>>>`. Two cohorts: `scaleTable(edits, 'inFlight')` multiplies only `reach: 'all'` edits; `'new'` multiplies every edit; products clamped to [0.05, 10] (`timers.ts:37-51`). Scale s > 1 slower. In the engine, timers reach it only as scales (`levers/apply.ts:2-8`, `planOf` `:56-80`: `newProjects.scale`, `inFlightScale`); the unscaled calibration is kept. `rescaleTransition` (`timers.ts:81`) is the display-view rescale. Route shares replace `pathwayForNew` (`routeSharesOp` `:175`).
- Page shape (`src/lib/sim-page/timing.ts`, outside S4 but the preset/floor source): `PresetId = 'observed'|'sb423Clock'|'noDiscretionary'|'ceqaInfill'|'benchmarkPermits'` (`:45-46`). `TimingSet` (`:175-186`): `{ preset; presetTimers: TimerEdit[]; presetRouteShares: Record<Pathway,number>|null; edits: TimerEdit[]; routeShares: ... | null; localProgramStreamlined: boolean }`. `EDITABLE_STAGES = preApplication, filed, permitFiled, permitIssued` (`:154-159`).
- Presets (`timing.ts:83-152`): `observed` "SF as observed" (reach null); `sb423Clock` "SB 423 approval clock" (reach `new`; `available: SB423_SMALL_SHARE.value !== null`); `noDiscretionary` "No discretionary review" (reach `new`); `ceqaInfill` "CEQA infill exemption (AB 130 / SB 131, 2025)" (reach `new`; available iff `CEQA_FILED_RATIO.value !== null`); `benchmarkPermits` "Permits at San Diego's pace" (reach `all`; 134 days vs SF 280 on `permitFiled`, every pathway). I: whether `sb423Clock` and `ceqaInfill` are available in the current data depends on `timing-sources.ts` constants I did not open (`SB423_SMALL_SHARE`, `CEQA_FILED_RATIO`).
- Floors (`src/lib/sim-page/timing-sources.ts:217-249`, `STAGE_FLOORS`): `permitFiled` floor = `days(13 + 15)` = 28 days = 0.92 month on all three pathways (`PERMIT_FLOOR` `:187-197`, tier 2, BLA); discretionary `filed` floor = `days(20)` = 0.657 month (`:220-234`, Planning Code 333); `preApplication` and `permitIssued` unsourced on all pathways (`:204-211`); streamlined `filed` unsourced (`:240-242`). Numerical bounds 0.05x..10x typical (`docs/dev/sim-timers.md:60`, matches `MIN_SCALE/MAX_SCALE`).

### 2.3 Zoning levers (every kind of zoning change a policy can make)
Engine (`SimLevers`): (1) `rules`: raise-only story edits, max over rules naming a lot, cap set to none (`resolve.ts:81-93`); (2) `paint`: sets N stories for lots, uncapped, raising or lowering, document order, last wins (`:94-102`); (3) `protect`: `rentControl`, `historic`, `newerThanYears` -> lots reset to FZP row and `hostable = 0` (not redevelopable; in-flight projects carry on) (`:43-60,103-111`); (4) `localProgramStreamlined` (Local Program lots forced onto streamlined) (`levers/view.ts:17-23`); (5) `compare` (twin choice, not a change to the plan). Base table is always FZP as written (`layers.ts:20-42`: `DataLayer = 'fzp' | 'base'`; `resolvePlan` starts from `stockTable(ctx,'fzp')` `resolve.ts:76`).
Schema-4 document (`src/lib/timeline/policy4.ts:17-33`, quoted in 3.1): zoning policies use selector `transit` (effect `bands`: `TransitBand { maxM; stories }`, rule `ZoningRule { kind: 'transit'; stopTypes; bands }`, `sim-page/policy.ts:39-48`; default bands 402 m -> 6 stories, 805 m -> 4 stories, `:75-78`, tier 4), `painted` (effect `brushes`: `CustomBrush = {kind:'paint', strokes, stories} | {kind:'erase', strokes}` `:49-51`), `category` (`rentControl | historic | newerThan`, effect `protect {years}`). Compile in `world/policy/combine.ts:78-137`. Band rule: no outer band taller than the inner (`policy.ts:89-96`). Under `base: 'preFzp'` a zoning policy in force throws (`compile.ts:~165`).

### 2.4 `FinanceLevers` and every type it is built from
```ts
// src/lib/sim/levers/types.ts:57
export interface FinanceLevers {
  baselineScale: { pool: string; from: Day; scale: number }[];
  pools: Pool[];
  programmes: Programme[];
  terms: Partial<Record<TermKey, number>>;
}
// src/lib/timelapse/types.ts:237
export type Inflow =
  | { kind: 'once'; day: Day; dollars: Dollars }
  | { kind: 'yearly'; from: Day; to: Day | null; dollarsPerYear: Dollars };
// :241
export type PoolKind = 'goBond' | 'cop' | 'generalRevenue' | 'dedicatedTax' | 'state' | 'federal' | 'bank';
// :244
export interface Pool {
  id: string; kind: PoolKind; label: string; inflows: Inflow[];
  /** can always pay and has no inflows (in the baseline, only the federal tax-credit pool) */
  uncapped: boolean;
  /** non-null exactly for `goBond` and `cop`; rate in (0, 0.25], termYears 1 to 40 */
  debt: { rate: number; termYears: number } | null;
  /** dollars a pool may have committed or out per dollar received: 1 for every kind but `bank` */
  leverage: number;
}
// :266
export type Instrument =
  | { kind: 'grant'; share: number }
  | { kind: 'loan'; costShare: number; rate: number; requiredReturn: number | null }
  | { kind: 'guarantee'; costShare: number; reserve: number };
// :271
export interface Programme {
  id: string; label: string; pool: string; reach: ProjectKind; instrument: Instrument;
  from: Day; to: Day | null; minHomes: number /* 0..10,000 */;
  tiers: Record<IncomeTier, number> | null /* required for reach 'affordable', null otherwise */;
}
// :194  export type ProjectKind = 'market' | 'affordable';
// :185  export type IncomeTier = 'veryLow' | 'low' | 'moderate' | 'aboveModerate';
// :288  export type TermKey = 'constructionRate' | 'constructionYears' | 'requiredReturn' | 'guaranteeRateCut' | 'lossOnExit';
// :292  export type ResolvedTerms = Record<TermKey, number | null> & { custom: TermKey[] };
```
Limits (`levers/finance.ts:23-40`): `FINANCE_LIMITS = { pools: 12, inflowsPerPool: 12, programmes: 24, baselineScale: 24, labelChars: 80, idChars: 40 }`; `FIRST_DAY = 10957` (2000-01-01), `LAST_DAY = 47482` (2100-01-01); `MAX_DOLLARS = 100_000_000_000`; `MAX_LEVERAGE = 10` (bank only); `baselineScale.scale` in [0,10] (`:93`); added ids must start `u-` (`:75-79`); added pools must have `uncapped: false` and 1..12 inflows (`:128-133`); `lossOnExit` in [0,1] (`scenario/funding.ts:141-144`).

### 2.5 `SimInput` (`src/lib/sim/scenario/types.ts:95-133`, comments abridged)
```ts
export type SimInput = {
  parcels: ScenarioParcels; projects: InFlightProject[]; calibration: Calibration; asOf: Day;
  districtMaxStories: number | null;
  newProjects?: { calibration: Calibration; scale: StageScale }; // absent = calibration, scale 1
  inFlightScale?: StageScale;                                      // absent = 1
  regimes?: { day: Day; parcels: ScenarioParcels }[];             // dated zoning views; days strictly ascending, > asOf
  reservedFrom?: Int32Array;                                      // per row, a later conversion's start day, 0 = none
  // F3: the market term. Absent or [] means shift 0.
  market?: MarketStep[];
  // F9: public money. Absent means no public money at all.
  finance?: {
    pools: Pool[]; programmes: Programme[];
    off: { pool: string; from: Day; to: Day | null }[];
    slope: number; terms: ResolvedTerms;
  };
};
// timelapse/types.ts:202
export interface MarketStep { from: Day; logOdds: number; }
```
`checkFinanceShape` (`scenario/funding.ts:44-160`) enforces: ids unique, programme pool exists, uncapped pool has no inflows, leverage > 0 finite, dollars whole >= 0, debt required exactly for goBond/cop (rate in (0,0.25], termYears whole 1..40), `minHomes` whole 0..10000, programme terms resolved, `lossOnExit` in [0,1], `off` pools exist.

### 2.6 Law switch
Absent from code (section 0). Closest mechanisms: `SimInput.regimes` (dated zoning views, `types.ts:110-117`) and, on `/sim`, dated schema-4 spans compiled to `PolicyFrame.view` per month (`world/policy/frame.ts`).

### 2.7 Lever resolution order
- Zoning (`levers/resolve.ts:1-9,73-138`): FZP as written -> rules (max, raise-only) -> paint (document order, last wins) -> protected lots reset to FZP row with `hostable 0` -> lots off FZP/base need yield recompute (`Need`). `levers/source.ts:2-5` mirrors it for attribution.
- Across policies in force on a day (schema 4, `world/policy/combine.ts`): rules: each lot takes the highest rule naming it (`:102,125-130`); paint: each policy as today then a later policy in the list wins a lot (`:131-133`); protections: any policy turns one on, `newerThan` takes the largest years (`:117-123`); permitting: `all` timers multiplied (`speed`), `new` timers kept as `speedNew` entries by span start (`:185-199`), route shares from the lowest policy in force that sets them, Local Program streamlined false if any policy says so (`:197-199,201`); money: scale entries merged per (pool, from) lower policy wins, pools/programmes in document order, terms merged lower wins (`:208-231`).
- Plan input assembly (`levers/apply.ts:56-80`): envelope op -> route shares op on the new-project calibration -> `buildFinance(base.finance, levers.finance, base.asOf)`; `market` and `finance` survive `bare()` (`apply.ts:42-50`).
- `buildFinance` (`levers/finance.ts:370-412`): empty levers return `base`; no baseline returns undefined; resolves terms (`resolveTerms(MARKET_TERMS, f.terms)`); base pools scaled per run; then `[...pools, ...f.pools]`, `[...base.programmes, ...f.programmes]`, `off` spans from 0-scale entries.

## 3. Policy document schemas

### 3.1 Schema 4 (`src/lib/timeline/policy4.ts:17-61`)
```ts
export type Selector =
  | { tag: 'transit'; stopTypes: StopType[] }
  | { tag: 'painted' }
  | { tag: 'category'; category: 'rentControl' | 'historic' | 'newerThan' }
  | { tag: 'routes' }
  | { tag: 'baseline' }
  | { tag: 'fund'; pool: string }
  | { tag: 'terms' };
export type Effect =
  | { tag: 'bands'; bands: TransitBand[] }
  | { tag: 'brushes'; brushes: CustomBrush[] }
  | { tag: 'protect'; years: number | null }
  | { tag: 'timing'; set: TimingSet }
  | { tag: 'scales'; entries: { pool: string; from: Day; scale: number }[] }
  | { tag: 'fund'; pool: Pool | null; programmes: Programme[] }
  | { tag: 'terms'; terms: Partial<Record<TermKey, number>> };
export interface Span { from: Day; to: Day | null; what: Effect; }
export interface Policy { id: string; label: string; preset: string | null; on: boolean; where: Selector; spans: Span[]; }
export interface SimPolicy4 { schema: 4; kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] }; }
export const DEFAULT_POLICY4: SimPolicy4 = { schema: 4, kinds: { zoning: [], permitting: [], money: [] } };
```
`spanAt` (`:88`): off policy -> null; else first span with `from <= day && (to === null || day <= to)`. Stored envelope `SimDoc4 { schema: 4; kind: 'sim'; datasetVersion: string; title?: string; policy: SimPolicy4 }` (`src/lib/timeline/sim-doc4.ts:38-43`); autosave key `sfhousing:sim:v2` (`:36`).

### 3.2 Schema 3 (two types)
- Engine `SimLevers`, schema 3 (quoted 2.1); validated by `parseSimLevers` (`levers/types.ts:222-246`); used inside the world compile and by the scenario host's `setLevers`/`initScenario` (`scenario/types.ts:146,155`).
- Page `SimPolicy` (`src/lib/sim-page/policy.ts:58-73`): `{ schema: 3; rules: ZoningRule[]; custom: CustomBrush[]; protect: CategoryProtections; timing: SimTiming; funding: FinanceLevers }`; `DEFAULT_POLICY` `:112-120`; validated by `parseSimPolicy` (`:391`; accepts schema 2 with `schema2: 'upgrade'`, in which case `funding` = default).

### 3.3 Load / validate / upgrade
- Strict publish parse: `parseSimDoc4(text, asOf)` rejects schema 2/3 as `unknown-schema`, newer as `future-schema` (`sim-doc4.ts:192-205`).
- Lenient dataset-free load: `loadSimDoc4` (`:213-227`).
- Open stored or shared doc: `openSimDoc4(text, ds)` (`:232-269`): schema 2/3 -> `parseSimDoc(text,'reconcile')` -> `upgradePolicy(policy, asOf)` (`timeline/upgrade.ts:12`, spans start `monthFirstDay(asOf, 1)` and run on) -> size/stroke limits -> `reconcilePolicy4(doc, calibration, asOf)` (`timeline/reconcile4.ts:254`). Schema 4 -> `parseDoc4(...,'reconcile')` then reconcile. `migrateSimAutosave` copies the v1 (schema 3) autosave to v2 (`:342-377`).
- Worker side: `setPolicyProblem`/`openTimelineProblem` (`timeline-protocol.ts:164-185`) check only shape; the compile requires a reconciled doc: `reconcilePolicy4(doc, cal, asOf).doc !== doc` -> `fail('policy','expected a reconciled document')` (`world/policy/compile.ts:~153`); `checkSpans` (`:96-108`), `programmeTermGaps` (`:~157`).

### 3.4 Schema 4 -> frames
`compileTimeline(doc, lots, ctx, base: 'plan' | 'preFzp')` (`world/policy/compile.ts:140-406`) -> `TimelineCompile { step(budgetMs); progress(); result(): PolicyTimeline; capacity(); unknownLots(); missingLots() }`. One `PolicyFrame` per model month m = 1..`ctx.windowMonths`. Per month: `inForceAt(doc, monthFirstDay(asOf,m))` (`combine.ts:46-60`) -> `stateOf` (zoning levers + permitting) -> view (built by `createViewJob` or interned in `VIEWS`) -> `assemble`: `fin = money.month(m, moneyLeversAt(f))`, `mk = marketAt(day)` (step in force from `input.market`, `:262-266`), `id = frameIdOf(canonicalJson({serials, v: view digest, p: permitting key, k: market, f: money key}))` (`:279-281`). Frame type (`world/policy/frame.ts:19-33`):
```ts
export interface PolicyFrame {
  id: number; view: ZoningView; calibration: Calibration; newCalibration: Calibration;
  speed: StageScale; speedNew: { from: Day; scale: StageScale }[];
  market: number;                       // shift in the log-odds of starting
  finance: FinanceFrame | null;
}
export interface FinanceFrame {
  pools: Pool[]; programmes: Programme[]; offered: Uint8Array; slope: number; terms: ResolvedTerms;
  arrivals: { pool: number; day: Day; dollars: number }[];   // money reaching each pool on a day of this month
}
export interface PolicyTimeline {
  frameAt(month: number): PolicyFrame; changes(): number[]; touched(month: number): Int32Array | null; readyThrough(): number;
}
```
Spans must begin on a month's first day and end on a month's last day (`world/policy/money.ts:5-8`, enforced `compile.ts:checkSpans`/`parse4.checkSpanDays`). Money: `createMoneyTrack` builds `buildFinance(base, levers, asOf)` once per distinct levers (`money.ts:116-127`) and reads only that month's days (`:140-172`). The comparison document is derived by `comparisonOf` (`world/policy/compare.ts`, not read in detail; I).

## 4. PUBLIC MONEY

### 4a. Every pool/source/programme the engine knows
**Baseline (data, `calibration.baselineFunding`)**: written by `pipeline/lib/fzp-cal/funding.ts:baselineFunding` (called `calibrate.ts:161`) from `pipeline/enrichment/funding.json` plus MOHCD rows. Real (non-fixture) inputs from `pipeline/enrichment/funding.json` (FY2024-25, BLA 2026-06-05 Exhibit E p. 6):
| Pool id | kind | dollars/year | debt | what it pays |
|---|---|---|---|---|
| `city-debt` | `goBond` | 80,500,000 | rate 0.06, 20 yr | grant programme `baseline-city-debt` |
| `city-ocoh` | `dedicatedTax` | 48,600,000 | none | `baseline-city-ocoh` |
| `city-general-fund` | `generalRevenue` | 36,700,000 | none | `baseline-city-general-fund` |
| `city-impact-fees` | `dedicatedTax` | 34,800,000 | none | `baseline-city-impact-fees` |
| `city-housing-trust-fund` | `generalRevenue` | 27,400,000 | none | `baseline-city-housing-trust-fund` |
| `city-redevelopment` | `dedicatedTax` | 6,000,000 | none | `baseline-city-redevelopment` |
| `state` | `state` | 150,000,000 (lower bound, "$1.2B since 2018 / 8 years") | none | `baseline-state` |
| `federal-tax-credits` | `federal` | no inflow; `uncapped: true` | none | `baseline-federal-tax-credits` |
City sum 234,000,000 (= `city.total`). Each pool has exactly one `grant` programme, `reach: 'affordable'`, `from: asOf`, `to: null`, `minHomes` = nearest-rank 10th percentile of MOHCD `total_project_units`, `tiers` = MOHCD AMI mix (`funding.ts:218-232,279-290`). `share` = pool's per-home dollars / uncovered cost (`uncoveredPerHome('affordable', PROTOTYPES[0])` = 861,525 per `funding.json` perHome check, `funding.ts:196-205`); `perHome` city 300,027 + state 118,390 + federal 443,108 must equal the uncovered cost (`:200-205`); shares rounded by `roundShares`. Fixture-0 values (invented, tier 4): 6 City pools at 1.5M, 1.2M, 1.0M, 1.0M, 0.8M, 0.5M a year, state 3.0M, federal uncapped; `asOf` 20736 = 2026-10-10 (`e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json`, `projects.json`).
Programme `reach` limits: `'market'` or `'affordable'` (`types.ts:194`); an `affordable` programme requires `calibration.affordableRoutes` (`scenario/funding.ts:174-186`). Instruments: grant (share of uncovered cost per home), loan (costShare of cost, repaid to pool on completion, needs `constructionRate` and `constructionYears` terms), guarantee (needs `guaranteeRateCut`, unsourced, so unavailable unless typed) (`finance/terms.ts:48-117`, `finance/instruments.ts:88-120`). Pricing in three tiers federal(0) -> state(1) -> City(2) (`instruments.ts:214-228`, `fundBundle` `:236`).
Legal limits: statements only, not enforced. `limitStatements(borrowing)` (`finance/debt.ts:183`) returns `LimitStatement { id: 'goRate'|'goCap'|'goVote'|'copCap'; exceeded; text; provenance }` (`timelapse/types.ts:296-301`). Values: GO bond tax rate policy cap 0.1201% (today 0.1105%, reached about FY 2031-32); Charter GO cap 3% of assessed value (353.6B -> about 10.608B) with 2.67B outstanding; GO needs two thirds vote; COP debt-service cap 3.25% of 4.66B discretionary revenue, reached about FY 2028-29 (`debt.ts:84-170`). Called from `world/score/statics.ts:~204` (`limitStatements(addedBorrowing(...))`); I: nothing in the engine reads `exceeded` to block a pool (grep of `limitStatements` limited to statics/score; not exhaustive).
**User-added (levers)**: any pool/programme within `FINANCE_LIMITS`; presets in 4d. **Cadence**: `once` (a date) or `yearly` (arrives on `from` and each anniversary of month/day up to `to` inclusive, 29 Feb -> 28 Feb in common years; `scenario/funding.ts:28-47`). No monthly cadence exists in the type.

### 4b. Where a pool's balance lives and changes
Counters per pool (`scenario/funding.ts:195-210` `PoolState`; world analogue `world/funding/columns.ts` `FundPools`):
```ts
interface PoolState { received; committed; spentGrant; outLoan; lostLoan; lostGuarantee }
available = pool.uncapped ? Infinity
  : leverage*received - committed - spentGrant - outLoan - lostLoan - lostGuarantee   // funding.ts:213-223; world: pools.ts:55-66 (availableOf)
```
- **Arrivals**: world: `moneyIn` adds each `frame.finance.arrivals` entry to `pools.received` (`world/funding/pools.ts:46-60`); arrivals are generated per month in `createMoneyTrack` from `inflowArrivals(fl, lo, last)` skipping `isOff` days (`world/policy/money.ts:150-162`); month 1 includes the dataset date (`lo = asOf`). Scenario: `Treasury` constructor pre-bins arrivals over `asOf..horizon` (`scenario/money.ts:46-63`), `receive(day)` (`:67-79`).
- **Awards (commit)**: `commitAward` adds `commit` (grant G / loan P / guarantee reserve H) to `committed`, emits `commit` (`world/funding/pools.ts:99-139`; scenario `money.ts:82-` `award`).
- **Later events**: on `enter construction`: `spend` (committed -> spentGrant for a grant; committed -> outLoan for a loan); on `end complete`: loan `repay P` (outLoan -= P, no interest returned), guarantee `release H`; on `end exit`: grant `loss round(lambda*G)` if after construction else `release G`; loan `repay P-L` + `loss L` after construction else `release P`; guarantee `release H` + `loss min(round(lambda*guaranteed),H)` (`pools.ts:172-215`, `book` `:219-245`; same in `scenario/money.ts:83-136,177-196`). `lambda` = `terms.lossOnExit` (data default 1, tier 4, "Invented" `finance/terms.ts:100-117`). Spent grants never return.
- **Re-pricing and lapse**: when the frame's money identity changes, each waiting line row is re-made under the new frame or lapses (`world/funding/policy.ts:44-77`, `apply.ts:460-477` `remakeRow`; lapse = row `gone`, kind's new spell starts at month first day - 1, lot planned again `policy.ts:21-34`). A row lapses when its bundle no longer exists or its coverage level falls below its level (`apply.ts:440-442`).
- **Returned money during a serve scan** is held until next month's scan (`pools.ts:24-44` `holdingReturns`).
- **Carry-over of unspent money**: yes, unbounded in time. `received` is cumulative and nothing expires, so unspent money stays available (`available` formula; no expiry term exists in `PoolState`).
- **Interest/growth**: none on pool balances (V: counters above have no interest term; loan `repay` returns principal only). Dollars are constant dollars of the dataset year (comment `timelapse/types.ts:183`); baseline amounts held level (`funding.json` notes "Held level (OD-F3)"; `funding.ts:255` "held level from the first inflow, with no end").
- **Debt**: a `goBond`/`cop` pool's `debt` is metadata. Principal enters as an inflow like any other money. Repayment is **not** modelled in the pool: `world/score/view.ts:46-60` computes `owed = debtService(received[last], debt)` with `nominal: true`; limits use it. The pool is not debited.
- **Pool switch-off**: `baselineScale` entries with scale 0 become `off` spans (`levers/finance.ts:350-362`); arrivals and offers are skipped on off days (`scenario/funding.ts:isOff/isOffered`). Other scales rescale a capped pool's inflows by runs (`:314-346`); on an uncapped pool a scale only matters at 0 (switch off) (`:401`).
- **Lever scaling**: `leverage` multiplies `received` (only `bank` may differ from 1; `MAX_LEVERAGE` 10 `levers/finance.ts:37,135`).

### 4c. Unbounded or finite
UNBOUNDED (V):
1. All 7 capped baseline pools: `inflows: [{ kind:'yearly', from: asOf, to: null, dollarsPerYear }]` (`pipeline/lib/fzp-cal/funding.ts:209-211,222,232`; fixture-0 JSON agrees). `inflowArrivals` with `to === null` runs `last = horizon` (`scenario/funding.ts:32`). So each pays the same dollars every year of the 480-month window (about 40 arrivals each), no growth, no cap, no end date. Fixed in time only by the window horizon.
2. `federal-tax-credits`: `uncapped: true`, `inflows: []` -> `available = Infinity` (`scenario/funding.ts:213-215`; `pools.ts:56`). The doc states the simulation "pays this share for any number of funded homes" (`pipeline/enrichment/funding.json` federal.method, tail text; `docs/dev/finance-data.md:149`).
3. Presets with `to: null`: `general-revenue` (36.7M a year from next 1 July, `funding-presets.ts:226-231`) and `federal-support` (yearly from `max(2028, year(asOf)+1)` 1 Jan, amount = baseline state pool's first yearly amount, `to: null`, `:352-358`).
4. User-added yearly inflow may set `to: null` (`levers/finance.ts:108`). The only amount cap is `MAX_DOLLARS` 1e11 per inflow (`:36`, `dollars()` `:82-86`) and at most 12 inflows per pool.
5. `bank` leverage multiplies available per dollar received (up to 10x for a user pool) (`levers/finance.ts:135`).
6. Programmes with `to: null` (all baseline; all presets) never stop offering (`funding-presets.ts` comment: "Every preset's programme has `from` equal to its pool's first arrival and `to: null`", `docs/dev/sim-funding.md:34`).
FINITE (V): `housing-bond` (single `once` 410,442,573 on next 1 July), `revolving-fund` (single `once` 100,000,000), `public-bank` (5 `once` amounts 8,666,667; 11,333,333; 10,000,000; 26,666,667; 13,333,333 on 1 July of successive years, leverage 0.67), `htf-2026` (six `once` 6/13/22/31/40/49 million 2028..2033 then yearly 60,000,000 from 2034-07-01 `to` 2057-07-01, held back, not available). Within any pool, spending is bounded by `received` less committed/out/lost.
No stock-less rate: there is no pool "created from a rate with no stock" other than the yearly-inflow-with-`to: null` pattern above and the Infinity federal pool.

### 4d. Funding presets (`src/lib/sim-page/funding-presets.ts:122-` `fundingPresets(cal)`; sources `funding-sources.ts`)
| id | label | group | available | content | source cited |
|---|---|---|---|---|---|
| `housing-bond` | A housing bond | city | needs baseline funding + affordable programme | `goBond`, `once` 410,442,573 on `nextFiscal(asOf)`; debt 6% / 20 yr; grant `cityGrant` share = round6(300,027 / uncovered) | BLA 2026 Exhibit 40 p. 106 (tier 2) `BOND_PRINCIPAL`; debt `POOL_KIND_DEFAULTS.goBond` BLA p. 106 |
| `general-revenue` | General revenue, yearly | city | same | `generalRevenue`, yearly 36,700,000 from next fiscal, `to: null` | BLA 2026 Exhibit E p. 6 (tier 1) `GENERAL_FUND_FY25`; amount is "a starting value" |
| `htf-2026` | Housing Trust Fund increase (Proposition C, 2026) | city | **held back**: "Not yet certified (passed on early counts, November 2026)." content built (`keepContent`) | `PROP_C_SCHEDULE` | Controller's statement 2026-08-10 (tier 2), `PROP_C_METHOD` |
| `revolving-fund` | A revolving construction-loan fund | city | needs `constructionRate`, `constructionYears` sourced and model | `generalRevenue`, `once` 100,000,000; loan costShare 0.1, rate 0.06, `reach: 'market'`, `minHomes 0`, `tiers null` | BLA 2026 pp. 78-79 (Montgomery County Housing Production Fund, tier 1 description); rate and cost share "custom, not sourced" (tier 4) |
| `public-bank` | The SF public bank, as planned | bank | needs loan terms + grant base | `bank`, five `once`, leverage 0.67; loan costShare 0.1, rate 0.0613, affordable | HR&A 2023 plan pp. 54-58, Table 10 (tier 3); rate HR&A (tier 3); costShare custom |
| `state-bond-2026` | State housing bond (Proposition 1, 2026) | state | **not available**: "Not yet certified, and San Francisco's share is not published." | none | LAO Prop 1 (`LAO_PROP_1`) cited in description only |
| `state-off` | No state money from a date | state | needs state pool | `baselineScale {state, nextFiscal, 0}` | none (policy lever) |
| `state-double` | State money doubled from a date | state | needs state pool | `baselineScale {state, nextFiscal, 2}` | none |
| `federal-support` | Federal support from a year | federal | needs state pool with a yearly inflow | `federal`, yearly = state's first yearly amount from `max(2028, year+1)-01-01`, `to: null`; grant `cityGrant` | `FEDERAL_SUPPORT_AMOUNT_PROVENANCE` and `_START_PROVENANCE`: tier 4 "custom, not sourced" ("2026 ROAD to Housing Act appropriates nothing", ruling R5) |
| `federal-credits-off` | Federal tax credits withdrawn from a date | federal | needs federal pool | `baselineScale {federal, nextCalendar(asOf), 0}` | none |
| `regional-bond` | A regional bond | state | **not available**: "There is no regional measure yet." | none | none |
Default dates: `nextFiscal(asOf)` = 1 July of year after asOf's UTC year; `nextCalendar` = 1 January (`funding-presets.ts:61-63`). Pool-kind defaults (debt, bank leverage, loan rate): `POOL_KIND_DEFAULTS` (`funding-sources.ts:210-278`): goBond 0.06/20, cop 0.065/20 (BLA p. 108), bank leverage 0.67, bank loan rate 0.0613, other kinds no loan rate (`NO_LOAN_RATE`).
Market terms (`finance/terms.ts:48-117`): `constructionRate` 0.085 (Terner Center Dec 2023, tier 3), `constructionYears` 1.917 (the dataset's own table, tier 2), `requiredReturn` 0.06 (Controller Triennial 2026 p. 11, tier 1), `guaranteeRateCut` null (unsourced), `lossOnExit` 1 (tier 4, invented).
Prototypes (`finance/prototypes.ts:72-78`): A (5 stories, 45 homes, 729,700 / 177,000), B (8, 130, 736,700 / 152,000), C (13, 227, 857,700 / 206,000), D (24, 341, 918,700 / 292,000), E (4, 13, 929,700 / 353,000) as `prototype(id, stories, homes, costPerHome-ish, shortfall-ish)`; binning: under 25 homes E; <=6 stories A; <=10 B; <=18 C; else D (`PROTOTYPE_BINNING`, tier 4). I: the argument names of `prototype(...)` I did not read; the 4th/5th numbers are costPerHome/shortfall per the `debt.ts`-adjacent provenance text.

### 4e. The funding queue ("the line")
- Entities: a free lot can hold up to two waiting applications, one per kind (`market`, `affordable`) (`world/funding/apply.ts` `Application`, `KINDS`; `leaveLine` removes "both" `:480`).
- Order (`scenario/funded.ts:1053-1061`): `lineKey(keyDay, rank, kind) = min(keyDay, NEVER_KEY_DAY) * KEY_DAY_SCALE + rank*2 + bit`: keyDay (the day the project would start at unshifted rates, ties after 2^28), then parcel rank, then `market` before `affordable`. `NEVER_KEY_DAY = 2^28` (`:64`).
- Serve (`world/funding/serve.ts:30-95`): one scan a month, rows in line order skipping `gone`, each tested with `awardPasses`/`awardSet` against pools as they stand; an award starts the funded project at once and can mark later lots' rows gone. No second scan in a month. Returned money held until next scan. Grouped serving (`line-index.ts`): applications with the same award rule share a group; the rule is monotone in size so a threshold H per group is bisected; result equals the direct scan (`serve.ts:54-61`, `opts.grouped === false` is the test seam).
- Award rule (`scenario/funding.ts:awardSet` `:~384-398`): ask per capped pool = project dollars of granted+lent+reserve; **leave out** every programme of any pool whose available < ask, repeat until none short or set empty, never add back; award iff set non-empty and `coverageLevel(set) >= coverageLevel(whole bundle)` (with `CERTAIN_TOLERANCE` 1e-9). Else the application waits.
- When money runs out: the application **waits** (stays in the line, retried every monthly scan) until money arrives/returns, its lot's ordinary start fires (rule 8: both applications leave), or a policy change makes it lapse (re-make fails). There is no timeout, expiry or max wait (V: no such field in `FundLine` columns I read; `apply.ts:440-476`, `serve.ts`). Funded projects are given "shadow" starts too (`world/funding/shadow.ts`, 84 lines; not read in detail, I: the unfunded/ordinary counterpart used for displacement and the tolerance referee).
- Effect on start odds: public money shifts a market project's start odds through `oddsShift(g, kind, p, slope)` (`finance/instruments.ts:188`) with `slope = calibration.market.slope.perCostShare` (`input.ts:87-94`; fixture 1.77601).

### 4f. Data files and field lists
There are **no files named funding/finance/market/baseline/calibration besides `calibration.json`** in `e2e/fixtures/data/fixture-0/` (`ls`: `basemap.pmtiles buildings.pmtiles fonts manifest.json neighborhoods.geojson parcels README.md report.json scenarios transit.json`; `scenarios/fzp/{calibration.json,gross.bin,parcels.bin,policy.bin,projects.json}`, `scenarios/lesscars/{plan.json,sites.json,summary.json,timeline.bin}`). `funding.json` and `market.json` are pipeline inputs in `pipeline/enrichment/`, not published files; their content reaches the client only inside `calibration.json`.
- **`calibration.json`** (fixture-0 top-level keys, V by `node`): `schema, asOf, transitions, initiation, pathwayForNew, ppaShare, size, revision, streamlinedForLocalProgram, phaseGap, market, affordableRoutes, baselineFunding`. Written by `pipeline/steps/calibration.ts` (`CALIBRATION_JSON = 'scenarios/fzp/calibration.json'` `:31`, `writeFileSync(jsonPath, a.json)` `:203`), assembled in `pipeline/lib/fzp-cal/calibrate.ts` (`market` `:187`, `baselineFunding` `:189`).
- **`calibration.market`** (`MarketModel`, `timelapse/types.ts:207-228`): `today { all, private, years [2023,2025], observed {all, private}, implied, provenance }`, `crossCheck { logOdds, provenance }` ("reported, never applied"), `slope { perCostShare, provenance, crossChecks { costCoefficient, priceCoefficient, provenance } }`. Fixture example: `today.all = -0.693147`, `today.private = -0.798508`, `observed {10, 9}`, `implied 20`, `slope.perCostShare = 1.77601`, `crossCheck.logOdds = -1.28933`. Writer: `pipeline/lib/fzp-cal/market.ts:marketModel` (`:322`) from `pipeline/enrichment/market.json`.
- **`pipeline/enrichment/market.json`** top-level keys: `schema, source, lagYears, coefficients, costIndex, priceIndex` (Controller Economic Impact Report 2025-10-29; `lagYears.value 2`, `coefficients.cost.value -0.0992`, `coefficients.price.value 0.0143`, `costIndex.values` by year 2005..2023, `priceIndex.means`). Schema `pipeline/enrichment/market-schema.ts`. Read by `steps/calibration.ts:34,108-118`.
- **`calibration.baselineFunding`** (`timelapse/types.ts:95-104`): `{ pools: Pool[]; programmes: Programme[]; provenance: Provenance[] (one per pool, then one for tiers/minHomes); check: { impliedHomesPerYear, observedHomesPerYear, provenance } }`. Fixture: 8 pools, 8 programmes, 9 provenance entries; `check { implied 20, observed 25 }`. Example entry (fixture programme): `{ id:"baseline-city-debt", pool:"city-debt", reach:"affordable", instrument:{kind:"grant",share:0.087063}, from:20736, to:null, minHomes:2, tiers:{veryLow:0.428572, low:0.428571, moderate:0.142857, aboveModerate:0} }`; example pool: `{ id:"city-debt", kind:"goBond", inflows:[{kind:"yearly", from:20736, to:null, dollarsPerYear:1500000}], uncapped:false, debt:{rate:0.06, termYears:20}, leverage:1 }`.
- **`calibration.affordableRoutes`**: `Record<Pathway, number> & { provenance }`; fixture `{ discretionary 0.5, streamlined 0.166667, permitOnly 0.333333 }`.
- **`pipeline/enrichment/funding.json`** top-level keys: `schema, perHome, city, state, federal, awards, retiredIds`. `perHome {total 954127, city 300027, federal 443108, state 118390, permanentLoans 87431, other 5171, tier, cite}`; `city {fiscalYear "FY2024-25", total 234000000, sources[6 x {id,label,kind,dollarsPerYear,debt|null,note,cite}], tier, cite}`; `state {id,label,dollarsPerYear 150000000,tier,method,cite}`; `federal {id,label,tier,method,cite,uncapped {rounds 3, window [2026-01-01, 2026-09-14], cites[3]}}`; `awards {years [2024,2025], rows[19 x {year,application,project,credit,newConstruction,homes,cite}]}`; `retiredIds []`. Schema `pipeline/enrichment/funding-schema.ts` (zod). Fixture twin `pipeline/test/fixtures/mini/enrichment/funding.json` (V exists; fixture build uses it, `pipeline/steps/build.ts:87-88`).
- Pipeline step: **`pipeline/steps/calibration.ts`** writes it; `pipeline/steps/build.ts:87-88,202` selects the live or fixture `funding.json` and checks it before any step.

## 5. Outputs

### 5a. `TimelineScore` (verbatim, `src/lib/sim/scenario/types.ts:312-369`)
```ts
export interface TimelineScore {
  months: Day[]; // months[i] = the 1st of the i-th month, starting with asOf's month and ending with the horizon's month; every series value at i is the state at the end of that month ...
  shown: {
    completedNet: number; // cumulative since asOf, simulation only, excludes baseline
    completedNetPipeline: number;
    completedNetNew: number;
    entitledNew: number;
    inProgress: Record<Exclude<Stage, 'complete'>, number>;
    exitedUnits: number; // cumulative
  }[];
  planEffect: { entitledNew: number; completedNetNew: number }[];
  planEffectBand: { p10: number; p50: number; p90: number }[];
  band: { p10: number; p50: number; p90: number }[];
  baseline: { completedNet: number; since: Day; provenance: Provenance };
  phasing: { masters: number; enrichedMasters: number; phasesScheduled: number; phasesEstimated: number;
             unenriched: { projectId: string; label: string | null; units: number; drawn: boolean }[] };
  targets: TargetProgressAt[];
  references: { id: string; label: string; units: number; from: Day; by: Day;
                measure: 'planEffect.entitledNew' | 'planEffect.completedNetNew' | 'completedNet'; provenance: Provenance }[];
  /** F14: present on every run (once `finance-score` fills it) */
  tiers?: { completed: TierUnits[]; baseline: TierUnits; targets: TargetProgressAt[] };
  /** F14: only on a run with at least one pool; series per month at the month's end */
  money?: {
    pools: { id: string; label: string; kind: PoolKind;
             received: number[]; committed: number[]; out: number[]; spent: number[]; repaid: number[]; lost: number[]; lostCredit: number[] }[];
    fundedHomes: number[]; displacedHomes: number[]; publicSpent: number[];
    owed: { pool: string; principal: Dollars; repayment: number; nominal: true }[];
    limits: LimitStatement[];
  };
}
export type TargetProgressAt = { target: Target; deadline: Day; fraction: number[] /* (baseline + completedNet)/target, uncapped */ };
```
(Comments abridged; `committed` and `out` both carry the comment "amount outstanding" at `:356-357`.) `TierUnits = Record<IncomeTier, number> & { unrecorded: number }` (`timelapse/types.ts:193`). `Target` (`src/lib/scoreboard/types.ts:6-14`): `{ id; label; units; range?; source; tier? }`. Targets: `M1_TARGETS` = `rhna` 82,069 and `rhna-buffer` 94,379 (`src/lib/scoreboard/targets.ts:11-27`); `RHNA_TIER_TARGETS`: very-low 20,867, low 12,014, moderate 13,717, above-moderate 35,471 (`:29-55`). `targetsOf` gives every target `deadline: RHNA_DEADLINE` = 2031-01-31 (`scenario/score.ts:293-304`; tier ruling OD-T4).
Ledger series: `LedgerEvent kind: 'in'|'commit'|'release'|'spend'|'repay'|'loss'` (`scenario/engine.ts:72-78`); tiers via `tierSeries/tiersOf` (`scenario/finance-score.ts`, per-month completed net by income tier; 601 lines, only headers read).

### 5b. World-side outputs (`src/lib/sim/world/score/types.ts`)
```ts
export type MonthRow = TimelineScore['shown'][number];
export interface PlanRow { entitledNew: number; completedNetNew: number; }
export interface MoneyRow { pools: {id,label,kind,received,committed,out,spent,repaid,lost,lostCredit}[]; fundedHomes; displacedHomes; displacedHomesCompleted; publicSpent }
export interface SeriesChunk { from: number; rows: MonthRow[]; planEffect: PlanRow[]; money: MoneyRow[] | null; tiers: TierUnits[] | null; }
export interface WorldSeries {
  add(e: WorldEvent, world: World, statics: Statics): void;
  stepped(month: number): void; finalThrough(): number;
  rows(from: number, through: number): MonthRow[]; data(): WorldSeriesData;
}
export interface TimelineView {
  months: Day[]; lastIndex: number; filledThrough: number /* -1 before the first chunk */;
  rows: MonthRow[]; planEffect: PlanRow[]; targets: TargetProgressAt[]; tierTargets: TargetProgressAt[] | null;
  money: MoneyView | null; tiers: TierUnits[] | null;
  baseline: TimelineScore['baseline']; phasing: TimelineScore['phasing']; references: TimelineScore['references'];
  compare: 'plan' | 'preFzp';
}
export type MoneyView = NonNullable<TimelineScore['money']> & {
  displacedHomesCompleted: number[];
  perAddedHome: { all: number | null; city: number | null };
  displacedShare: number | null;
  perAddedHomeByMonth: { all: (number | null)[]; city: (number | null)[] };
  displacedShareByMonth: (number | null)[];
};
export interface ScoreStatics { asOf; months: Day[]; lastIndex; baseline; tierBaseline: TierUnits | null; phasing; references; compare: 'plan'|'preFzp'; limits: ...|null; debts: {pool; debt}[] | null }
```
`viewOf(chunks, statics)` (`score/view.ts:98-129`) joins contiguous chunks (throws on gap/overlap), computes `targets: targetsOf(units, rows)` and `tierTargets`, `money` via `moneyViewOf` (`owed` = `debtService(received[last], debt)`, `nominal: true`). `chunksBefore(chunks, k)` trims on rewind. Note `TimelineView` has no `band`, `planEffectBand`, `references` computed by runs: the world has no band (V: type lacks them).
`cardAt(world, statics, frame, deps, parcelId, day, projectId?) => { summary: ParcelSummary; lookups: Lookups | null }` (`score/card.ts:97-105`); throws if `deps.record` is null.

### 5c. Grep of `goal|target|rhna|reached|deadline` (case-insensitive) in `src/lib/sim`, `src/lib/timelapse` (non-test)
Hits (all V): `sim/display.ts:9,21,75` and `sim/host.ts:24,45,110,235` (editor `Target[]`, default `M1_TARGETS`); `sim/scenario/score.ts:4,5,292-318,399-433` (`RHNA_DEADLINE`, `targetsOf`, `tierTargetsOf`, `assembleScore`); `sim/scenario/types.ts:10,333,347,370-373` (`TargetProgressAt`); `sim/scenario/finance-score.ts:13,276-360` (`RHNA_TIER_TARGETS`, `tierBaselineOf`, source labels); `sim/world/score/view.ts:3,115`, `types.ts:4,149,167-168`, `statics.ts:182-195` (`rhnaCompletedNet`); `sim/world/runner/runner.ts:781` (`ds.loaded.projects.rhnaCompletedNet`); `sim/scenario/scenario-host.ts:1189,1299`; `sim/finance/tiers.ts:45-47`, `debt.ts:71-78` (`goPolicyReachedFy`, `copReachedFy`: debt-limit years, unrelated to homes); `sim/scenario/engine.ts:537-578,783` (`Reached`: an engine stage-reach kind, unrelated); `sim/scenario/funded.ts:100,198,946,965,1030,1043,1480-1481` (`reached: ProjectKind[]` = programme `reach` kinds, unrelated); `timelapse/projects.ts:92-95,401-437` (`rhnaCompletedNet` file field: `{ units, since, byTier?, provenance }`); `timelapse/model.ts:272-280,364,400-427` (sampling/tail search). **No hit computes the month at which a homes total is reached.** The sim exposes `fraction[]` per month only.
Outside scope but relevant: `src/lib/goal/goal.ts:15-103` defines `Goal { id; name; measure; amount; deadline; countsFrom }`, `GOAL_BASE` (amount = RHNA 82,069, `countsFrom` 2022-06-30, `:53-59`), `defaultGoal(asOf)` (deadline `windowHorizon(asOf, WINDOW_MONTHS)`, `:62-64`), `readGoal(goal, view, i)` -> `{ fraction, reachedOn }` where `reachedOn = months[m]` for the first m in [TODAY..min(i, deadline month)] with `baseline.completedNet + rows[m].completedNet >= amount` (`:92-103`). Only the `homesCompleted` measure exists. Not read beyond line 110 (241 lines).

## 6. The worker (messages verbatim)

`src/lib/sim/worker.ts` builds `createWorkerRouter({ editor: createSimHost, createScenario, createTimeline, createPlayback, post })` and sets `scope.onmessage = (e) => router.handle(e.data)` (`worker.ts:19-58`). Scope type: `onmessage: (e: MessageEvent<WorkerRequest | TimelineRequest>)`, `postMessage(msg: WorkerResponse | TimelineHostResponse, ...)` (`:12-17`). Router modes `'editor' | 'scenario' | 'playback' | 'timeline'` (`router.ts:48`); `init`/`initScenario`/`initPlayback`/`openTimeline` dispose the other hosts (`router.ts:16-25`, comments).

Requests to the worker (`WorkerRequest = SimRequest | ScenarioRequest | PlaybackRequest`, `scenario/types.ts:277`, plus `TimelineRequest`):
```ts
// editor, protocol.ts:12
export type SimRequest =
  | { type: 'init'; rev: Rev; manifest: Manifest; mode: BuildoutMode }
  | { type: 'load'; rev: Rev; plan: Plan }
  | { type: 'preview'; rev: Rev; op: PlanOp }
  | { type: 'cancelPreview'; rev: Rev }
  | { type: 'commit'; rev: Rev; op: PlanOp }
  | { type: 'undo'; rev: Rev; opId: string }
  | { type: 'prefetch'; bbox: BBox }
  | { type: 'retryChunks' }
  | { type: 'parcelSummary'; reqId: number; parcelId: ParcelId }
  | { type: 'heightLots'; reqId: number; outlineOf: number | null };
// scenario, scenario/types.ts:137
export type ScenarioRequest =
  | Extract<SimRequest, { type: 'prefetch' | 'retryChunks' }>
  | { type: 'initScenario'; rev: Rev; manifest: Manifest; scenario: 'fzp'; seed: number | null; horizon: Day; levers?: SimLevers; awaitLevers?: boolean }
  | { type: 'reroll'; rev: Rev; seed: number | null; swap?: true }
  | { type: 'setLevers'; rev: Rev; levers: SimLevers }
  | { type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day: Day; projectId?: string }
  | { type: 'resolveBrush'; reqId: number; query: BrushQuery }
  | { type: 'brushCatalog'; reqId: number }
  | { type: 'lotOutlines'; reqId: number; lots: ParcelId[] }
  | { type: 'previewBuildings'; reqId: number; lots: ParcelId[]; stories: number }
  | { type: 'heightLids'; reqId: number; bbox: [number, number, number, number] }
  | { type: 'lotAt'; reqId: number; point: [number, number] };
// playback, lesscars/types.ts:31
export type PlaybackRequest =
  | { type: 'initPlayback'; rev: Rev; manifest: Manifest; plan: LessCarsPlanFile; sites: LessCarsSitesFile }
  | { type: 'playbackCard'; reqId: number; projectId: string; day: Day };
// timeline, timeline-protocol.ts:93-
export type OpenTimelineRequest = { type: 'openTimeline'; rev: Rev; manifest: Manifest; policy: SimPolicy4; lots: Record<string, ParcelId[]>; months: number };
export type SetPolicyRequest = { type: 'setPolicy'; rev: Rev; policy: SimPolicy4; lots: Record<string, ParcelId[]> };
export type TimelineRequest = OpenTimelineRequest | SetPolicyRequest
  | { type: 'viewMonth'; month: number }    // the model month the playhead is in
  | { type: 'resyncMap' };                  // answered by a `cells` with revision 0
// the timeline host also answers (shapes unchanged): SharedRequest = Extract<ScenarioRequest, 'parcelSummary'|'resolveBrush'|'brushCatalog'|'lotOutlines'|'previewBuildings'|'heightLids'|'lotAt'|'prefetch'|'retryChunks'>
```
Responses (`timeline-protocol.ts:123-151`):
```ts
export type TimelineResponse =
  | { type: 'compiling'; rev: Rev; done: number; total: number; failedCells: string[] }
  | { type: 'compiled'; rev: Rev; capacity: LeverCapacity; unknownLots: number; statics: ScoreStatics }
  | { type: 'filled'; rev: Rev; through: number; series: SeriesChunk }
  | { type: 'refill'; rev: Rev; from: number }
  | { type: 'cells'; render: TimelineUpdate }                 // no rev: never dropped
  | { type: 'lookups'; month: number; lookups: LeverLookups } // no rev: never dropped
  | { type: 'error'; rev: Rev; code: TimelineErrorCode; message: string };
export type TimelineErrorCode = ScenarioErrorCode | 'timeline';
export type TimelineHostResponse = TimelineResponse | Exclude<ScenarioResponse, { type: 'error' | 'timeline' | 'ranks' | 'levers' }>;
// scenario, scenario/types.ts:233
export type ScenarioResponse = ReadyResponse | ChunksResponse | TimelineResponse(scenario's, type:'timeline')
  | { type: 'error'; rev: Rev; code: ScenarioErrorCode; message: string }
  | { type: 'parcelSummary'; reqId; summary: ParcelSummary | null } | { type: 'brushLots'; reqId; result: BrushLotsResult }
  | { type: 'brushCatalog'; reqId; catalog: BrushCatalog | null } | { type: 'lotOutlines'; reqId; result: LotOutlinesResult }
  | { type: 'previewBuildings'; reqId; result: PreviewResult } | { type: 'heights'; rev: Rev; city: HeightCity }
  | { type: 'heightLids'; reqId; result: HeightLidsResult } | { type: 'lotAt'; reqId; result: LotAtResult } | RanksResponse | LeversResponse;
export type ScenarioErrorCode = 'manifest-invalid' | 'scenario-missing' | 'scenario-invalid' | 'bad-request' | 'internal';
// editor, protocol.ts:39
export type SimResponse = ready | diff | chunks | parcelSummary | heightLots | error   // (full shapes at protocol.ts:39-58)
// playback, lesscars/types.ts:39
export type PlaybackResponse =
  | { type: 'playbackLoaded'; rev: Rev; seed: number; places: Record<ParcelId,[number,number]>; reservations: { parcelId: ParcelId; kept: boolean }[] }
  | { type: 'playback'; rev: Rev; render: TimelineUpdate; complete: boolean }
  | { type: 'playbackCard'; reqId: number; card: PlaybackCard | null };
```
`client.ts` (`SimClient`, `spawnSimWorker`) is the **editor** client; it uses `SimRequest`/`SimResponse` only (`client.ts:18-39,250`; I from export list, file not read in full). The timeline client is `timeline-client.ts` (`TimelineClient`; `open`, `setPolicy`, `viewMonth`; drops stale `compiling`; `setPolicy` before `open` throws `Error('open first')` `:127-135`).

Behaviour (code-cited):
- `openTimeline`: `rev` is the page's edit count; `months` = window length; "each side runs one world, on seed 1" (`timeline-protocol.ts:36-45`; code `ensemble.ts:26`). Client sends `months: WINDOW_MONTHS` = 480 (`timeline-client.ts:29,113`). Host session: `openTimelineProblem` (`timeline-protocol.ts:170`) checks `rev` int, `manifest` object, `policy` object, `lots` shape, `months` int >= 1.
- `setPolicy`: doc must be reconciled; unreconciled -> `error bad-request` at that rev. Each accepted edit answered by exactly one `refill`; rejected by `error bad-request` and no `refill` (`timeline-protocol.ts:63-95`; runner header `runner.ts:34-60`).
- `setLevers`: **not part of the timeline protocol** (doc: timeline messages "replace `initScenario`, `reroll`, `setLevers`, `timeline`, `ranks` and `levers` on /sim", `timeline-protocol.ts:1-3`). Still handled by the scenario host (`router.ts:121-122`).
- Fill/refill: the runner drives two ensembles (plan, comparison); each steps one unit at a time (`UnitKind = 'create'|'restore'|'copy'|'feed'|'quiet'|'step'`, `ensemble.ts:51`) while its month is lower; a world steps only while not ahead of the other (`runner.ts:11,409`). Slices of `SLICE_PLAN_MS` = `SLICE_MS - 5` (`scenario-host.ts:242`); at most one `filled` per slice (`runner.ts:21-24`). `filled` carries `through` (last final calendar-month index) and `series: SeriesChunk` (`from`..). `refill.from` = first calendar month withdrawn (non-final after an edit's first changed model month - 1; or first not-yet-posted month if nothing withdrawn) (`timeline-protocol.ts:68-75`). Copies are taken after model month 0 only (`COPY_MONTHS = [0]`, `ensemble.ts:23`); an edit whose first difference m is after `steppedThrough` is applied with `keep`, otherwise `restore` from the last copy at or before m-1 then quiet re-step (`ensemble.ts:68-82`).
- Lookups: `parcelSummary` returns `summary` incl. `lookups?: Lookups` ("stage tables of the frame in force on the requested day", `protocol.ts:98-102`); `lookups` message (`{month, lookups: LeverLookups}`) posted when the frame in view changes its permitting (runner D10, `runner.ts:22-24`); `viewMonth` sets which frame answers lookups/height lids (`runner.ts:824-830`, `viewMonthOf = clamp(view, 1, readyThrough())`). `LeverLookups = { inFlight: Lookups; fresh: Lookups }`, `Lookups = { chance; typicalMonths }` (`levers/apply.ts:33-45`). `resolveBrush`/`brushCatalog` answered by `createBrushService` (`runner/lookups.ts`).
- Buffer: filling is **not gated by the playhead**: the ensembles step to `months` (`ensemble.ts` `EnsembleOpts.months`: "Filling stops at this model month"). `viewMonth` only selects the frame for heights/lids/lookups. I: so "buffer fill" = the whole 480-month window computed progressively; `docs/dev/ensemble-runner.md:3` says "advanced one month at a time ahead of the viewer" (loose wording, not a gate in code as far as I read).

## 7. Time

- As-of/start date: `SimInput.asOf = projects.asOf` (`scenario/input.ts:78-83`; a differing `calibration.asOf` is only warned about `:63-68`). Value is dataset-dependent. Fixture-0: 20736 = 2026-10-10 (`projects.json`, `calibration.json`). Real datasets: I (calibration provenance windows end 2026-10-19 in `finance/terms.ts:73`).
- Model month indexing (`world/months.ts`): month m >= 1 first day = `asOf + floor((m-1)*MONTH_DAYS) + 1`; last day = `asOf + floor(m*MONTH_DAYS)`; `monthOfDay(asOf, day)` = 0 for `day <= asOf`; `MONTH_DAYS = 30.436875` (`timelapse/time.ts:9`). Calendar months for the score: `TimelineScore.months[i]` = first of calendar month, starting with asOf's month (`types.ts:313`; `score/statics.ts:monthsOf`); `windowHorizon(asOf, W)` = last day of the last calendar month ending at or before `monthLastDay(asOf, W)` (`months.ts:34-40`); `lastIndex = months.length - 1`.
- Horizon: window `WINDOW_MONTHS = 480` model months = 40 years (`timeline-client.ts:28-29`, "The window, in model months (40 years)"). Goal deadline = `windowHorizon(asOf, 480)` (`goal/goal.ts:62`). Targets' own `deadline` = `RHNA_DEADLINE` 2031-01-31 (`score.ts:293`). Scenario host takes a `horizon: Day` in `initScenario` (`types.ts:145`).
- Spans must align to model months (see 3.4). Funding arrivals dated by `Day` inside each month's `[first, last]` days.
- Pool `inflows` before `asOf` are never received (`types.ts:232-236` comment; `inflowArrivals` `day >= asOf`).
- Hard day bounds on levers: 2000-01-01..2100-01-01 (`levers/finance.ts:33-34`).

## 8. Market

- `SimInput.market?: MarketStep[]` = `{ from: Day; logOdds: number }[]`, strictly ascending by `from`, first at or before `asOf` (`timelapse/types.ts:198-205`). Meaning: from `from` on, `logOdds` is added to every lot's initiation log-odds.
- Who sets: only `buildSimInput` -> `marketSteps(calibration.market, projects.asOf, marketLevel(calibration))` -> a single step `{ from: asOf, logOdds: m.today[level] }` or `[]` without a model (`scenario/market.ts:8-15`; `input.ts:75,84`). Level = `'private'` exactly when both `calibration.market` and `calibration.baselineFunding` exist (finance is then also set), else `'all'` (`market.ts:21-27`). Warnings `NO_MARKET_WARNING` / `FUNDING_WITHOUT_MARKET_WARNING` (`:25-29`; `input.ts:71-73`).
- In the frame: `PolicyFrame.market` = last step with `from <= day` at the month's first day (`compile.ts:262-266`); frame identity includes it (`:279`). Machinery for later steps exists (the precompute adds `stepLog1mh` rows per later step, `input.ts:115-124`, `:374-375`), but nothing produces later steps.
- Levers/UI: `SimLevers`, `FinanceLevers`, `SimPolicy4` have no market field (types 2.1, 2.4, 3.1). The only market-related lever is money `terms` (`TermKey`s, not log-odds). grep of `.market`/`market:` under `src/lib` (excluding specs/fixtures) found no UI that edits `SimInput.market`; consumers are `fzp/market-view.ts:23,29`, `fzp/provenance.ts:257-336` (display) and `sim-page/funding-presets.ts:109`, `funding-reconcile.ts:61` (availability checks). Public money shifts start odds separately via `oddsShift` and `slope` (`finance/instruments.ts:188`).
- Data: `calibration.market` and `market.json`, section 4f.

## 9. Determinism

- Draws are stateless counter-based: `draw(seed, entity, k, purpose, stageIdx)` = `drawOn(streamOf(seedHash(seed), entity, k), purpose, stageIdx)` with MurmurHash3 finalizer (`scenario/rng.ts:3-72`); purposes in `P` (`:~16-35`, `INIT=1 ... PHASE_GAP=11`, 17-23 retired). Order of draws never matters (`rng.ts:59-63`).
- `/sim` (timeline host): two worlds, plan and comparison, both `SEED = 1` (`world/runner/ensemble.ts:25-26`); the comparison world is paired on the same draws (type comments `timeline-protocol.ts:44-45`). One future shown ("one future" memory is consistent: no band in `TimelineView`).
- Scenario host: `seed: number | null` in `initScenario` (null = representative seed); band of `BAND_RUNS = 101` runs (`band.ts:6`), `bandSeed`, `representativeIndex`.
- Lint guard: `Math.exp`, `Math.log`, `**` banned under `src/lib/sim/world` (`world/determinism.lint.spec.ts:7-15`; use `$lib/timelapse/math` `exp`/`log`).
- Lesscars playback: `seed` carried in `playbackLoaded` from the timeline file (`playback-host.ts:341`, `timeline.seed`); I: seed comes from `scenarios/lesscars/timeline.bin`.

## 10. Dataset-version coupling (`pipeline/lib/version.ts:42-53`, verbatim)
```ts
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
const EXCLUDE_PATHS = ['pipeline/sources.lock.json', 'pipeline/.cache', 'pipeline/out'];
```
Version = `<UTC date of newest retrievedAt>-<first 8 hex of sha256(canonicalJson(lock) \n codeHash \n canonicalJson(toolVersions))>` (`:15-28`); `treeHash` over `git ls-tree -r HEAD` of those paths, plus `git diff HEAD` and untracked files when dirty (`:84-110`). Not hashed (V by absence): `src/lib/sim/world/**`, `src/lib/sim/*.ts` top level, `src/lib/sim/lesscars`, `src/lib/transit`, `src/lib/sim-page`, `src/lib/timeline`, `src/lib/goal`. So changing `src/lib/sim/finance`, `levers`, `scenario`, `timelapse`, `scoreboard` or `pipeline/` (including `pipeline/enrichment/*.json`) changes the dataset version; `src/lib/sim-page/funding-*.ts` (presets, sources) and `src/lib/sim/world/**` do not. (`docs/dev/sim-funding.md:13` says presets are "outside the dataset-version paths": consistent.)

## 11. Budgets and perf tests (all server project; `SERVER_PERF_SPECS = ['src/**/*.bench.spec.ts', 'src/**/*.perf.spec.ts']`, `vite.config.ts:11`)
| File | Budget (V) |
|---|---|
| `src/lib/sim/world/map-stream.perf.spec.ts` | window 480 (`:22`), flush budget 20 ms (`BUDGET :23`), asserted bar `BAR = 30` ms per flush (`:24,103`) |
| `src/lib/sim/world/score/chunk.perf.spec.ts` | window 480, median per month `<= BAR = 1` ms (`:27,150`) |
| `src/lib/sim/world/score/view.perf.spec.ts` | wall-clock report only, no bar (`:1`) |
| `src/lib/sim/world/funding/funded-month.perf.spec.ts` | mean `<= BAR_US = 90` us per month (`:21,95`) |
| `src/lib/sim/world/policy/compile.perf.spec.ts` | `step(SLICE_MS = 20)` longest call `<= BAR_MS = 50` ms (`:55-56,215`) on the bench city; live-city run reported, bar "not asserted" (`:304`) |
| `src/lib/sim/world/host.perf.spec.ts` | `SLICE_BAR_MS = 50`, `FIRST_BAR_MS = 3000` (first cells / first filled), `MONTH_BAR_MS = 9` (fill net `<= MONTHS*9`, `MONTHS = 480`), `HEAP_BOUND_MB = null` (reported, not asserted) (`:43,54-59,819-837,928-935`) |
| `src/lib/sim/world/world.bench.spec.ts` | median `<= 3` ms (`:57`); context not read |
| `src/lib/sim/host.bench.spec.ts` (editor host) | covered `<= 550`, `<= 100` ms, `<= 5000` ms (`:159,168,206,208`); context not read |
| `src/lib/sim/scenario/scenario.bench.spec.ts` | many: median `<= 15`, `<= 80`, `simulateNet` baseline `<= 30` and baseline+funding `<= 83`, `<= 3000`, `<= 200`, `<= 4000`, worst slice `<= 50`, `<= 121`, `<= 300`, `<= 1000`, `<= 9000`, `SLICE_MS` (`:151-890`, contexts not read) |
| `src/lib/transit/grid.bench.spec.ts` | best `<= 100` ms (`:52`) |
Doc note (not code): `npm run test:perf` is idle-machine only, not in signoff (`CLAUDE.md` commands table). `view.perf.spec.ts:7` honours `SFH_PERF_QUIET=1`.

## 12. `lesscars` inside `src/lib/sim` (imports only)
- `lesscars/builds.ts`: `../scenario/card` (`blockLot isVisible revisionAt`), `../scenario/massing` (`footprintOf`), `../scenario/types` (`Massing Schedule`).
- `lesscars/playback-host.ts`: `$lib/data/scenario-codec` (`ScenarioParcels`), `../scenario/geometry` (`createGeometry Geometry`), `../scenario/scenario-host` (`MEMO_CAP SLICE_PLAN_MS createToken Token`), `../scenario/types` (`ScenarioErrorCode ScenarioResponse Schedule SimInput`).
- `lesscars/playback-client.ts`: `../scenario-client` (`ScenarioErrorResponse`), `../scenario/types` (`ScenarioResponse WorkerRequest`).
- `lesscars/types.ts`: `$lib/data/lesscars/codec`, `$lib/data/manifest`, `$lib/data/parcel`, `$lib/map/types`, `$lib/timelapse/time`, `../protocol`.
- No import of `levers/*`, `finance/*` or `world/*` in these four files (grep over `lesscars/*.ts` for `levers|finance|world` returned none beyond the lines above). It uses `Schedule` and `SimInput` types from `scenario/types`. The lesscars *pipeline* step runs the engine and baseline funding (`pipeline/lib/version.ts:34-40` comment); that step (`pipeline/steps/lesscars.ts`) not examined.

## Doc/code contradictions

1. None found that change a fact in this scope. Items that differ in wording only:
   - `docs/dev/ensemble-runner.md:3` says worlds are "advanced one month at a time ahead of the viewer"; code fills to `months` irrespective of the playhead (`ensemble.ts` `months` opt; `viewMonth` only picks frame, `runner.ts:824`). I did not trace every gate in `runner.ts` (1391 lines, read in part), so "no playhead gate" is I.
   - The brief's "law switch" and `setLevers` for `/sim`: the code has no law switch (`sim-levers.md:20,234` agrees); `setLevers` exists only in the scenario protocol, not the timeline protocol (`timeline-protocol.ts:1-3` agrees).
   - The brief's `funding.json` / `market.json` "files under fixture-0": they are not in fixture-0; they are `pipeline/enrichment/*.json` inputs whose content ships inside `calibration.json`.
2. Docs checked against code in passing (all agreed): `docs/dev/sim-funding.md` presets (ids, date rules, `to: null`); `docs/dev/sim-timers.md:60-62` floors (0.92, 0.657 months) and bounds; `docs/dev/finance-data.md:112-152` six City pools, one state pool, one uncapped federal pool; `pipeline/lib/version.ts` comment vs `PATHS`.

## Appendix

### Files read in full
`src/lib/sim/levers/types.ts`, `levers/finance.ts`, `levers/timers.ts`, `levers/resolve.ts`, `levers/layers.ts`, `levers/view.ts`, `levers/source.ts`; `src/lib/timelapse/types.ts`, `timelapse/time.ts`; `src/lib/sim/scenario/types.ts`, `scenario/funding.ts`, `scenario/money.ts`, `scenario/policy.ts`, `scenario/market.ts`, `scenario/dates.ts`; `src/lib/sim/worker.ts`, `timeline-protocol.ts`, `lesscars/types.ts`; `src/lib/sim/world/policy/frame.ts`, `policy/combine.ts`, `policy/money.ts`, `world/months.ts`, `world/funding/pools.ts`, `funding/system.ts`, `funding/policy.ts`; `src/lib/sim/world/score/types.ts`, `score/index.ts`, `score/view.ts`; `src/lib/sim-page/funding-presets.ts`, `funding-sources.ts`; `src/lib/timeline/policy4.ts`; `src/lib/scoreboard/targets.ts` (lines 1-55 shown); `pipeline/lib/fzp-cal/funding.ts` lines 160-443; `world/determinism.lint.spec.ts`.

### Files read in part (line ranges)
`pipeline/lib/version.ts` 1-120; `src/lib/sim/levers/apply.ts` 1-162 (all); `world/policy/compile.ts` 1-406 (all); `world/funding/serve.ts` 1-140; `funding/apply.ts` 1-80 and 440-482; `world/score/statics.ts` 160-225; `world/score/card.ts` 94-110; `world/host.ts` 1-120; `world/runner/runner.ts` 1-72 plus greps; `world/runner/ensemble.ts` 1-80; `scenario/input.ts` 55-100 plus greps; `scenario/funded.ts` 1040-1075 (+ greps); `scenario/engine.ts` 60-90; `scenario/rng.ts` 1-72; `scenario/score.ts` via grep; `sim/protocol.ts` 1-105; `sim/timeline-client.ts` 1-140; `sim/router.ts` 1-60 and case list; `sim/finance/terms.ts` 40-120; `finance/debt.ts` 20-287 (provenance prose skipped); `finance/instruments.ts` 205-236; `finance/prototypes.ts` 60-100; `sim-page/policy.ts` 30-125 and 385-445; `sim-page/timing.ts` 1-215; `sim-page/timing-sources.ts` 187-249; `timeline/sim-doc4.ts` 28-75, 185-270, 335-380; `timeline/upgrade.ts` 1-30; `src/lib/goal/goal.ts` 1-110; `pipeline/enrichment/funding.json` and `market.json` (field lists and examples via `node`, not read as text); `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json` and `projects.json` (via `node`); docs `docs/dev/sim-funding.md`, `finance-data.md`, `sim-timers.md`, `ensemble-runner.md`, `sim-levers.md` by grep only.

### Dirs listed
`src/lib/sim` (recursive with line counts), `src/lib/timelapse`, `src/lib/transit`, `src/lib/timeline`, `src/lib/sim-page` (names), `e2e/fixtures/data/fixture-0` and `scenarios/{fzp,lesscars}`, `pipeline`, `pipeline/lib`, `pipeline/steps`, `pipeline/enrichment`, `pipeline/lib/fzp-cal`.

### NOT examined (in scope or adjacent)
- `src/lib/timelapse/model.ts` (1127), `projects.ts`, `math.ts` bodies (only `checkPool` referenced; exports from grep).
- `src/lib/transit/*` bodies (all 612 lines: only export names).
- `src/lib/sim/scenario/engine.ts`, `funded.ts` (beyond `lineKey`), `scenario-host.ts`, `line.ts`, `card.ts`, `massing.ts`, `geometry.ts`, `load.ts`, `band.ts`, `simulate.ts`, `finance-score.ts` bodies; `score.ts` beyond targets lines.
- `src/lib/sim/world/`: `world.ts`, `due.ts`, `pipeline.ts`, `stage.ts`, `holds.ts`, `rates.ts`, `columns.ts`, `map-stream.ts`, `city-feed.ts`, `policy/{limits,intern,zoning-view,compare,lookups}.ts`, `funding/{clocks,columns,frame-money,line-index,shadow}.ts`, `score/{series,chunk,money,statics (1-160)}.ts`, `runner/{dataset,lookups,warm,flags}.ts`, most of `runner.ts` and `host.ts`.
- `src/lib/sim/{host,client,display,chunks,router (after line 60),lookup-requests,scenario-client}.ts` bodies; `lesscars/playback-host.ts`, `playback-client.ts`, `builds.ts` bodies (imports only).
- `src/lib/sim/finance/{prototypes,instruments,tiers}.ts` full bodies; `terms.ts` 120-195; `debt.ts` provenance prose.
- `src/lib/sim/levers/{brushes,recompute}.ts`.
- All `*.spec.ts`, `test/`, `fixtures/`, golden files (only perf/bench budget lines grepped, contexts of `scenario.bench`, `world.bench`, `host.bench` assertions not read).
- Pipeline: `pipeline/steps/calibration.ts` (only greps and header), `pipeline/lib/fzp-cal/{calibrate,market}.ts` (greps), `pipeline/enrichment/{funding-schema,market-schema}.ts` (greps), `pipeline/steps/lesscars.ts`, `pipeline/lib/fzp-cal/funding.ts` lines 1-160 (AMI bands, MOHCD parsing, `mohcdMix`, `fundingWarning` skimmed only by header).
- `src/lib/sim-page/timing-sources.ts` constants `SB423_*`, `CEQA_FILED_RATIO`, `NO_DISCRETIONARY_BASIS`, `BENCHMARK_PERMIT_DAYS` values; `timeline/{parse4,reconcile4,session4}.ts` bodies; `src/lib/goal/goal.ts` 110-241.
