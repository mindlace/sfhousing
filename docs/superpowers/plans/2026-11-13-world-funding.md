# world-funding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public money in the step engine: a `FundingSystem` (`createFundingSystem()`) that plugs into world-core's frozen hook and runs today's funding model once a month (clocks, applications, the line, awards, pools, money events, policy change, shadow starts).

**Architecture:** All code in `src/lib/sim/world/funding/`. The world holds the line, the pools, the awarded projects' money rows, respelled spells and shadows as typed-array / string-array columns that name pools and programmes by id (`World.line`, `World.pools`, narrowed here). Per-frame derived data (finance index, id maps, offered bundles) is memoised per (timeline, frame id) outside the world. The funded clocks are evaluated from the frames a lot has lived through, as world-core's `ordinaryStart` evaluates the ordinary one; nothing about a clock is stored except a respelled spell's start.

**Tech Stack:** TypeScript, Vitest (server project for behaviour, perf project for the one timing bar), the old engine's exported pure functions (`awardSet`, `awardPasses`, `asksOf`, `available`, `coverageLevel`, `below`, `financeIndexOf`, `lineKey`, `NEVER_KEY_DAY`, `pathwayFrom`, `projectDollars`, `prototypeFor`, `oddsShift`, `uncoveredPerHome`, `costPerHome`).

**Spec:** `docs/superpowers/specs/2026-11-13-world-funding-design.md` (binding). Design: `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md` sections 3.3, 3.5, 5.3 (T3, T11, T17). Today's rules: `docs/superpowers/specs/2026-11-09-finance-engine-design.md` 4.3-4.13, `src/lib/sim/scenario/{funded,line,funding,money}.ts`.

## Global Constraints

- Code only in `src/lib/sim/world/funding/` (and test files there), `docs/dev/world-funding.md`, and one scoped-doc line in `CLAUDE.md`. A needed change in any other file under `src/lib/sim/world/` (world-core's top level, `policy/`) is a request to `main`, not a task.
- No file under `pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard` is added, changed or removed. Import from them; never add an export there. A builder who finds a change there necessary stops and reports.
- `World` stays `structuredClone`-able: every line/pool column is a typed array, a `number[]` or a `string[]`; between steps a pool or programme is named by its id, never an index.
- `exp`/`log` only from `src/lib/timelapse/math.ts`. Never `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` or `**` under `src/lib/sim/world/` (the determinism ESLint rule covers `src/lib/sim/world/**`).
- The step and everything it calls read the policy of the month stepped and earlier months, never a later one; nothing takes a horizon, reads an end date or lays anything out to one.
- Tests that run in signoff assert behaviour and order, never wall-clock time; the 90 µs bar lives only in a `*.perf.spec.ts` (`npm run test:perf`). Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- Measurement lock (operator standing rules): every timing takes `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/sdd/measure.lock` (`mkdir`; on failure `sleep 60` in the foreground and retry up to 30 min, then tell `main`; write slug `world-funding` into `owner`; wait 30 s; time; `rm -r` at once; at most 15 min held; mark numbers "quiet (lock held)"). Before any heavy command that is not a timing (a test file run, `npm run check`, `npm run lint`, a leaf dispatch) check the directory and wait while someone else holds it.
- Every shell command in the foreground; never `cd <dir> && <cmd>`; working directory `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.claude/worktrees/step-world-funding`. No push, no PR, no `npm run signoff`.
- Conventional Commits, scope `world-funding`; multi-line messages via a temp file and `git commit -F`; no attribution trailers or notes anywhere.
- Every report names the dataset a number came from (bench city = `synthCity`; live = `2026-11-10-6ee5a23d`).
- Agreement tolerance (spec global constraints, OD-2): seeds 1 to 200, years 5, 10, 20 and 40: mean completed net homes within 1% of today's mean, its standard deviation within 15% of today's, mean number of awards and of funded homes within 3%. A miss is reported with its numbers; no rule is changed to meet it.

## Review Focus

1. **Re-entrancy during `serve`.** An award calls `startProject`, whose chain can free a lot (core calls `planLot`) or start one ordinarily (core calls `onProjectEvent` with a `'start'`, which removes that lot's applications from the line being scanned). The scan must skip rows removed mid-scan, never re-scan, and `planLot` must be pure. Test in Task 6.
2. **An awarded project that enters construction (or ends) in its own award month.** Its `'enter'` reaches `onProjectEvent` inside `startProject`, before the row is returned; the money rows must already be there. Test in Task 6.
3. **An award whose programmes ask nothing of a capped pool** (only uncapped or zero asks): its day is the application day or the month's first day, no pool's money day applies, and no zero-dollar ledger event is written. Test in Task 6.
4. **A resumed world under an edited timeline** (T11): pool ids the world has never seen get rows; an application naming a programme id the new frame lacks is treated as not offered (remade or lapsed in `policyChanged`), never an index lookup that returns `undefined`. Test in Task 9.
5. **A lot whose funded project exits and frees it again** (attempt k + 1): the old attempt's shadow keeps running on attempt k, the new attempt's clocks start from the exit day, and a respelled spell recorded for attempt k is ignored. Test in Task 10.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `funding/columns.ts` | `FundLine`, `FundPools` (narrowed `LineColumns`/`PoolColumns`), creation, growth, row add/remove/compact, id lookup |
| `funding/frame-money.ts` | `FrameMoney` per (timeline, frame id): `FinanceIndex` over the frame's arrays, id maps, offered programmes by kind, canonical bundles, money identity |
| `funding/clocks.ts` | Rules 2-5, 7: the market and affordable funded totals of one attempt over the frames lived through |
| `funding/apply.ts` | Rules 5, 6, 9: `planLot` answers and system 4's applications |
| `funding/pools.ts` | Rules 12-16: arrivals, commits, money events on stage events, ledger |
| `funding/serve.ts` | Rules 10, 11: the monthly scan, award day, `FundedStart`, the award |
| `funding/policy.ts` | Rules 17-19: remake, lapse, respell, replan |
| `funding/shadow.ts` | Rule 20: shadows and `displace` |
| `funding/system.ts` | `createFundingSystem()`: wires the hook methods to the modules |
| `funding/index.ts` | `export { createFundingSystem }` and the column types |
| `funding/test/fixtures.ts` | Funded inputs (bench, mini, live), `moneyTimeline`, `randomFinance`, `runFunded` |
| `funding/test/identities.ts` | E1-E7 after a step, from the ledger so far and the world's pool columns |
| `docs/dev/world-funding.md` | The subsystem's developer doc |

---

### Task 1: Rule 1 measurement and the serving/rates decision

The direct build of rules 2-13 does not exist yet, so this task measures the per-month work with the old engine's kernels on the old engine's own runs, which do the same arithmetic per lot and per application:

- **Counts** (exact): today's funded pass with `opts.lineProbe` (`engine.ts:1181`, called once per calendar day with the line, `funded.ts:1903`): new applications per model month (distinct `App` objects by `applied` day's model month), line length at each model month's end, awards per month (funded schedules by first revision's model month), and the free lots due per month (ordinary starts plus applications, from the schedules).
- **Cost** (a prototype of the direct path): per measured month, (a) `kindLatentInto(out, run, fp, i, size, kind, r, u, v, TO, -1, null)` (`funded.ts:772`, the direct path with no tables) for both kinds on as many lots as were due that month; (b) one direct scan of a recorded line: `scanLine()` (`line.ts:71`) filled with the probe's apps of that day, served with `awardSet` against the pool availability captured by `opts.probe` (`engine.ts:1176`) on that day, `take` a counter; the same line through `groupedLine` (`line.ts:206`) and the same latents with `tablesOf(fp)` (`funded.ts:703`) for the remedies' numbers; (c) the whole-city pass the core makes on every funded frame change (`world.ts:484-489`, `due.ts:202-223` ask `planLot` for every free lot): (a) over every candidate.
- Estimate per world-month = (a) for the month's due lots + (b) for the month's line + 5 µs allowance for money events and bookkeeping. Report p50, p90 and max over months 1 to 480.

Decision rule (later tasks follow it): **direct scan with direct rates** when the p90 estimate is at most 90 µs on both cities. Otherwise name the dominant term: line scan → Task 8a (grouped serving); rate evaluation → Task 8b (rate tables); both when both exceed 45 µs. The replan-month cost (c) is reported to `main` as a separate number (it is a frame-change cost the runner slices, not the 90 µs bar), with a flag if one world's replan exceeds 50 ms.

**Files:**
- Create (throwaway, never committed, deleted at the end of the task): `src/lib/sim/world/funding/rule1.tmp.perf.spec.ts`
- Create (git-ignored by `.git/info/exclude`): `.superpowers/sdd/world-funding/rule1-measurement.md`, `.superpowers/sdd/world-funding/fetch-live.mjs`, `.superpowers/sdd/world-funding/live/2026-11-10-6ee5a23d/`

**Interfaces:**
- Consumes: `runEngineWith(input, seed, horizon, sink, opts)` (`engine.ts:1195`), `runOf`, `financePreOf`, `kindLatentInto`, `newKindOut`, `tablesOf`, `drawsOf`, `scanLine`, `groupedLine`, `awardSet`, `awardPasses`; bench calibration as `compile.perf.spec.ts:135-150` builds it (`benchRoutes`, `benchBaselineFunding`, `benchMarket`); `liveInput(dir)` (`world/test/cities.node.ts:42`).
- Produces: the report file and one line of decision: `DECISION: direct | grouped | tables | grouped+tables`.

- [ ] **Step 1: Fetch the live dataset as a directory.** Run `npm run data:local -- 2026-11-10-6ee5a23d` (local R2, as the standing rules say). The Node tests read a directory (`cities.node.ts:90-100`, `SFH_WORLD_LIVE`), which `data:local` does not leave behind (`scripts/data-local.ts:58-81` deletes its temp dir), so also write `fetch-live.mjs` (plain Node, no `$lib`): fetch `https://sfhousing.mindlace.net/data/2026-11-10-6ee5a23d/manifest.json`, then every string URL under `scenarios.fzp` in it, saving each at its path below `/data/2026-11-10-6ee5a23d/` inside `.superpowers/sdd/world-funding/live/2026-11-10-6ee5a23d/`. Run `node .superpowers/sdd/world-funding/fetch-live.mjs`. Expected: `manifest.json` and the scenario files present; `SFH_WORLD_LIVE=<that dir>` loads with `liveInput`.

- [ ] **Step 2: Write the harness** `rule1.tmp.perf.spec.ts` with two cases (bench; live, skipped with a logged reason when `SFH_WORLD_LIVE` is unset). The live input from `liveInput` has `finance` stripped (`cities.node.ts:19-23`); re-add it as `buildSimInput` does (`input.ts:85-93`: `{ pools: structuredClone(bf.pools), programmes: structuredClone(bf.programmes), off: [], slope: m.slope.perCostShare, terms: resolveTerms(MARKET_TERMS) }`). Seeds 1 to 5, horizon `monthLastDay(asOf, 480)`. Each case prints the counts table, the cost table (a), (b) direct/grouped, (a) direct/tables, (c), and the estimate's p50/p90/max, then `expect(applications).toBeGreaterThan(0)`.

- [ ] **Step 3: Take the lock and run.** Lock per Global Constraints, then `SFH_WORLD_LIVE=<dir> npx vitest --run --project perf src/lib/sim/world/funding/rule1.tmp.perf.spec.ts`, then release. Expected: both cases print; numbers marked "quiet (lock held)".

- [ ] **Step 4: Write `.superpowers/sdd/world-funding/rule1-measurement.md`**: method (what was timed and why it stands for the direct build), counts and costs per city with dataset names, the estimate against 90 µs per world-month (9 ms / 96 worlds), the replan-month cost against 50 ms, and the `DECISION:` line with its reason.

- [ ] **Step 5: Delete the harness** (`rm src/lib/sim/world/funding/rule1.tmp.perf.spec.ts`; `git status` shows nothing under `src/`). No commit.

- [ ] **Step 6: Operator** sends `main` the report's summary (both cities, the decision, the replan cost). Continue with Task 2 on the decision unless `main` rules otherwise; Task 8 follows the decision.

---

### Task 2: Columns and frame money

**Files:**
- Create: `src/lib/sim/world/funding/columns.ts`, `src/lib/sim/world/funding/frame-money.ts`, `src/lib/sim/world/funding/index.ts`
- Test: `src/lib/sim/world/funding/columns.spec.ts`, `src/lib/sim/world/funding/frame-money.spec.ts`

**Interfaces:**
- Consumes: `LineColumns`, `PoolColumns`, `World` (`types.ts:29-37, 128-135`); `financeIndexOf`, `FinanceIndex` (`funding.ts:240-320`); `FinanceFrame`, `PolicyFrame`, `PolicyTimeline` (`policy/frame.ts`); `canonicalJson` (`$lib/sim-page/policy`).
- Produces:

```ts
// columns.ts
export const KIND_MARKET = 0, KIND_AFFORDABLE = 1;
export const INSTR_GRANT = 0, INSTR_LOAN = 1, INSTR_GUARANTEE = 2;
export interface FundLine extends LineColumns {
  n: number;
  lot: Int32Array; kind: Uint8Array;
  /** Model month applied: the line's first key (rule 9). */
  month: Int32Array;
  applied: Int32Array; keyDay: Int32Array; key: Float64Array;
  /** Programme ids joined with ','. */
  bundle: string[];
  f: Uint8Array; units: Int32Array; stories: Float64Array; level: Float64Array;
  /** Model month whose frame's view gave the size. */
  viewMonth: Int32Array;
  /** 1 = removed this step, dropped by `compactLine`. */
  gone: Uint8Array;
  spellN: number; spellLot: Int32Array; spellKind: Uint8Array; spellK: Int32Array; spellR: Int32Array;
  shadowN: number; shadowLot: Int32Array; shadowRow: Int32Array; shadowK: Int32Array;
  shadowR: Int32Array; shadowExisting: Int32Array;
  /** Planned ordinary-start month as last evaluated, 0 = never so far. */
  shadowMonth: Int32Array;
}
export interface FundPools extends PoolColumns {
  n: number; id: string[];
  received: Float64Array; committed: Float64Array; spentGrant: Float64Array;
  outLoan: Float64Array; lostLoan: Float64Array; lostGuarantee: Float64Array;
  /** Day and model month of the latest money that reached the pool (arrival, release, repayment). */
  moneyDay: Int32Array; moneyMonth: Int32Array;
  /** Money rows: one per (awarded project, paying programme) with events still to come, by project row ascending. */
  mN: number; mRow: Int32Array; mProg: string[]; mPool: string[]; mInstr: Uint8Array;
  mGrant: Float64Array; mLent: Float64Array; mReserve: Float64Array; mGuaranteed: Float64Array;
  /** `terms.lossOnExit` of the award's frame. */
  mLoss: Float64Array;
}
export function initFunding(world: World, poolIds: readonly string[]): void;
export function fundOf(world: World): { line: FundLine; pools: FundPools }; // throws before initFunding
export function poolRowOf(pools: FundPools, id: string): number; // appends a zeroed row for an unknown id
export function addLineRow(line: FundLine): number;
export function compactLine(line: FundLine): void; // drops `gone` rows, keeps order
export function addMoneyRow(pools: FundPools): number;
export function moneyRowsOf(pools: FundPools, row: number): [from: number, to: number]; // binary search on mRow
export function dropMoneyRows(pools: FundPools, row: number): void;
export function spellOf(line: FundLine, lot: number, kind: number, k: number): number; // r, or NO_DAY
export function setSpell(line: FundLine, lot: number, kind: number, k: number, r: number): void;
export function addShadow(line: FundLine, lot: number, row: number, k: number, r: number, existing: number): void;

// frame-money.ts
export interface FrameMoney {
  fin: FinanceFrame;
  index: FinanceIndex;
  prog: Map<string, number>;
  pool: Map<string, number>;
  /** Offered programme indices of each kind, ascending (rule 3). */
  offered: Record<ProjectKind, number[]>;
  /** Least `minHomes` among `offered[kind]`; Infinity when none. */
  least: Record<ProjectKind, number>;
  /** Money identity (rule 17), as `policy/money.ts:170-182` keys it. */
  key: string;
  /** `offered[kind]` filtered to `minHomes <= units`, one shared array per distinct set. */
  bundleOf(kind: ProjectKind, units: number): number[];
  /** A joined id list mapped to its canonical bundle, null when an id is unknown or not offered. */
  bundleIds(ids: string): number[] | null;
}
export function frameMoney(timeline: PolicyTimeline, frame: PolicyFrame): FrameMoney;
export function sameMoney(a: PolicyFrame, b: PolicyFrame, timeline: PolicyTimeline): boolean;
```

Builder's calls: the `FinanceIndex` is built from a synthetic `Finance` `{ pools: fin.pools, programmes: fin.programmes, off: [], slope: fin.slope, terms: fin.terms }` (offers come from `fin.offered`, never `isOffered`); memo `WeakMap<PolicyTimeline, Map<number, FrameMoney>>` keyed by frame id (ids are consistent inside one timeline; hand-built test timelines reuse small ids across timelines, so a worker-wide id map would collide). One money row per paying programme (not per project) because each programme's events are written separately (`money.ts:105-162`). Money rows kept sorted by project row: awards append rows in increasing order.

- [ ] **Step 1: Write the failing tests.**

```ts
// columns.spec.ts
it('a world with funding columns survives structuredClone', () => {
  // initFunding on a world from the mini city, two pools, a line row, a money row, a spell, a shadow
  const copy = structuredClone(w);
  expect(fundOf(copy)).toEqual(fundOf(w));
  expect(fundOf(copy).line.lot).toBeInstanceOf(Int32Array);
});
it('compactLine drops gone rows and keeps the order', () => { /* rows 0..4, gone 1 and 3 → lots [l0, l2, l4] */ });
it('poolRowOf appends an unknown id with zeroed counters', () => {
  expect(poolRowOf(p, 'new-pool')).toBe(2);
  expect(p.received[2]).toBe(0);
});
it('moneyRowsOf finds a project row's rows, dropMoneyRows removes them', () => {});
it('spellOf ignores a spell recorded for another attempt', () => {
  setSpell(line, 7, KIND_MARKET, 0, 1234);
  expect(spellOf(line, 7, KIND_MARKET, 0)).toBe(1234);
  expect(spellOf(line, 7, KIND_MARKET, 1)).toBe(NO_DAY);
});

// frame-money.spec.ts (mini city, `miniFinance(asOf)` as a FinanceFrame with offered = all 1)
it('maps ids to the frame's indices and lists offered programmes by kind, ascending', () => {});
it('bundleOf returns one shared array per distinct set', () => {
  expect(fm.bundleOf('affordable', 10)).toBe(fm.bundleOf('affordable', 11)); // same set
});
it('bundleIds round-trips a joined id list and refuses an unknown id', () => {
  expect(fm.bundleIds(ids.join(','))).toBe(fm.bundleOf('affordable', 10));
  expect(fm.bundleIds('nope')).toBeNull();
});
it('sameMoney ignores arrivals and sees an offer switched off', () => {});
it('frameMoney is memoised per (timeline, frame id)', () => {});
```

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/columns.spec.ts src/lib/sim/world/funding/frame-money.spec.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `columns.ts` (growth by doubling as `columns.ts:136-149` grows project columns) and `frame-money.ts`; `index.ts` exports the column types.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-funding): line and pool columns, per-frame money`.

---

### Task 3: The funded clocks (rules 2, 3, 4, 5, 7)

**Files:**
- Create: `src/lib/sim/world/funding/clocks.ts`
- Test: `src/lib/sim/world/funding/clocks.spec.ts`, `src/lib/sim/world/funding/test/fixtures.ts` (first part)

**Interfaces:**
- Consumes: `FrameMoney` (Task 2); `startRates`, `lotEntity`, `ordinaryStart` (`rates.ts:18, 46, 82`); `piecewiseMonth`, `lastInitiationMonth`, `sizeCumAgainst` (`scenario/input.ts`); `P`, `drawOn`, `streamOf`, `seedHash` (`scenario/rng.ts`); `oddsShift`, `uncoveredPerHome`, `costPerHome`, `prototypeFor` (`$lib/sim/finance`); `coverageLevel` (`funding.ts:197`); `NEVER_KEY_DAY` (`funded.ts:64`); `exp`, `log` (`timelapse/math.ts`); `monthFirstDay`, `monthOfDay` (`months.ts`).
- Produces:

```ts
export interface KindClock {
  kind: ProjectKind;
  /** Lot-month of the spell in which the total passes; 0 = never so far. */
  T: number;
  /** Application day; null when T = 0 or the bundle of lot-month T is empty (the spell is spent, rule 5). */
  day: Day | null;
  /** Model month holding `day` (0 when null). */
  month: number;
  keyDay: Day;
  /** Model month of the frame in force at lot-month T's first day (its view gave the size). */
  viewMonth: number;
  f: number; units: number; stories: number; protoId: PrototypeId;
  bundle: number[]; level: number; certain: boolean;
}
/** The attempt a free lot is on: its stream, the spell start of each kind, its existing homes. */
export interface Spell { lot: number; k: number; stream: number; r: Day; existing: number }
export function kindClock(
  statics: Statics, timeline: PolicyTimeline, month: number, sh: number,
  spell: Spell, kind: ProjectKind
): KindClock;
/** The size the attempt's SIZE draw gives in `view` against `existing`, as `startRow` draws it (`world.ts:288-315`); null when no level gains a home. */
export function sizeIn(statics: Statics, view: ZoningView, calibration: Calibration, lot: number,
  existing: number, uS: number): { f: number; units: number; stories: number; protoId: PrototypeId } | null;
```

Algorithm the signature does not determine (rule 4 with `funded.ts:452-478, 830-871` rewritten on frames):

```text
segments: frame of monthOfDay(asOf, r + 1) capped at `month`, then each c in timeline.changes()
  with monthOfDay(asOf, r+1) < c <= month, bound_c = lastInitiationMonth(r, monthFirstDay(asOf, c) - 1)
  (empty segments kept: piecewiseMonth skips them, `input.ts:253`)
per segment j (frame g_j, z = g_j.view.pre.logit[lot], ord_j = startRates(g_j.view, g_j.market)[lot]):
  size_j = sizeIn(view_j, existing, uS); no size or z = -Infinity → rate = ref = ord_j (market) or 0, bundle []
  else x0 = z + g_j.market (market) or z + g_j.market - slope*(unc(aff,p) - unc(mkt,p))/cost(aff,p) (affordable)
       ref = market ? ord_j : log(1 - 1/(1+exp(-x0)))
       bundle = fm_j.bundleOf(kind, units); empty → rate = ref, level 0
       priced = fm_j.index.price(kind, bundle, protoId); level = coverageLevel(priced.coverage)
       priced.certain → rate = -Infinity
       else x = log(1 - 1/(1+exp(-(x0 + oddsShift(priced.grantEquivalent, kind, p, slope)))))
            rate = market ? min(ord_j, x) : x
L = log(1 - u)   (u = INIT for market, INIT_AFFORDABLE for affordable)
T = piecewiseMonth(L, bounds, rates)
market: TO = lot-month of ordinaryStart(statics, timeline, month, sh, lot, r, k)?.day
        (lastInitiationMonth(r, day); 0 when null)
        if TO != 0: if T == 0 or T > TO → T = TO; else if T < TO and no non-empty segment up to T's
        has rates[j] < ord_j → T = TO
day: T != 0 and bundle of T's segment non-empty → (rate of T's segment = -Infinity ?
     r + 1 + floor((T-1)*MONTH_DAYS) : r + 1 + floor((T - 1 + v) * MONTH_DAYS)), v = INIT_DAY / INIT_DAY_AFFORDABLE
keyDay: Tref = market ? TO : piecewiseMonth(L, bounds, refs); Tref = 0 → NEVER_KEY_DAY else r + 1 + floor((Tref-1)*MONTH_DAYS)
```

The draws are those of `drawsOf` (`funded.ts:984-992`) on `streamOf(sh, lotEntity(statics, lot), k)`. `kindClock` reads no frame above `month`.

- [ ] **Step 1: Write `test/fixtures.ts` (first part)** with `fundedMini(): SimInput` (mini city with `miniFinance(asOf)` and `miniCalibrationWithRoutes()`, `finance-engine` fixtures), `financeFrameOf(fin: Finance, asOf, m): FinanceFrame` (offered from `isOffered` on `monthFirstDay(asOf, m)`, arrivals from `inflowArrivals` over the month, month 1 from `asOf`, as `policy/money.ts:156-168`) and `oneMoneyTimeline(input, fin): PolicyTimeline` (one frame per distinct offered set; ids from `frameIdOf` of the set and market).

- [ ] **Step 2: Write the failing tests.**

```ts
it('on one frame equals the old kernel for every lot, attempt 0', () => {
  // mini city, programmes all from asOf (no finance segment days), market constant.
  // For seeds 1..5 and every candidate c: kindLatentInto(out, runOf(input, seed, H, true),
  // financePreOf(input), i, sizes, kind, asOf, u, v, TO, -1, null) vs kindClock(...).
  expect({ T: k.T, day: k.day, keyDay: k.keyDay, bundle: k.bundle, level: k.level })
    .toEqual({ T: out.T, day: out.day, keyDay: out.keyDay, bundle: out.bundle, level: out.level });
  expect(compared).toBeGreaterThan(100);
});
it('a market clock with nothing shifting is the ordinary clock', () => {
  // no market programme offered: market T === lot-month of ordinaryStart, day null (empty bundle)
});
it('a certain bundle applies on the first day of lot-month T', () => {
  expect(k.day).toBe(spell.r + 1 + Math.floor((k.T - 1) * MONTH_DAYS));
});
it('rule 5: a programme opening at month m does not make an earlier pass apply', () => {
  // affordable programme offered from month 13 only; a lot whose affordable total passes in
  // lot-month 4: kindClock at month 20 still has day === null and T === 4
});
it('rule 7: keyDay is the ordinary pass (market) or the unshifted affordable pass', () => {});
it('reads no frame above `month`', () => {
  // timeline whose frameAt throws for m > 30; kindClock(..., month = 30, ...) does not throw
});
```

- [ ] **Step 3: Run** `npx vitest --run --project server src/lib/sim/world/funding/clocks.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `clocks.ts`. Builder's call: `sizeIn` builds the size cumulative against non-own `existing` with `sizeCumAgainst({ parcels, projects, calibration, asOf, districtMaxStories }, lot, existing)` exactly as `world.ts:294-307`, so a funded size and an ordinary size agree.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(world-funding): market and affordable clocks over frames`.

---

### Task 4: The system, `planLot` and `apply` (rules 5, 6, 8, 9)

**Files:**
- Create: `src/lib/sim/world/funding/apply.ts`, `src/lib/sim/world/funding/system.ts`
- Modify: `src/lib/sim/world/funding/index.ts` (export `createFundingSystem`)
- Test: `src/lib/sim/world/funding/apply.spec.ts`

**Interfaces:**
- Consumes: `kindClock`, `Spell` (Task 3); columns (Task 2); `lineKey` (`funded.ts:1057`); `lotRow` (`world/columns.ts`); `StepCtx`, `FundingSystem` (`types.ts:176-240`).
- Produces:

```ts
// apply.ts
/** The attempt of free lot `lot` and each kind's spell start (a respelled one from `spellOf`). */
export function spellsOf(ctx: StepCtx, lot: number): { market: Spell; affordable: Spell };
/** Rule 5: the model month of the earliest application day of a kind not already waiting, or 0. */
export function planLotMonth(ctx: StepCtx, lot: number): number;
/** System 4: each kind whose day falls in ctx.month and is not waiting joins the line; the month's
 *  new rows are appended in key order after every waiting row (rule 9). */
export function applyLots(ctx: StepCtx, lots: Int32Array): void;
/** Rule 8: marks both of the lot's waiting applications `gone`. */
export function leaveLine(line: FundLine, lot: number): void;
// system.ts
export function createFundingSystem(): FundingSystem;
```

`createFundingSystem` in this task: `create` → `initFunding(world, frame.finance.pools ids)`; `planLot` → `planLotMonth`; `apply` → `applyLots`; `onProjectEvent` → on `'start'` of a simulated row (`origin === ORIGIN_SIM`), `leaveLine(line, projects.src[row])`; `policyChanged`, `moneyIn`, `serve`, `shadow` → no-ops filled by Tasks 5, 6, 9, 10 (`shadow` already calls `compactLine`, so no `gone` row survives a step). Builder's call: compact once at the end of the step (system 7 always runs in a funded month, `world.ts:609`).

An application row records (rule 6): lot, kind, `month` = ctx.month, `applied` = the clock's day, `keyDay`, `key = lineKey(keyDay, statics.rank[lot], kind)`, `bundle` = ids joined, `f`, `units`, `stories`, `level`, `viewMonth`.

- [ ] **Step 1: Write the failing tests** (mini city with `fundedMini`, `withFunding(createFundingSystem())`, `runWorld` from `world/test/run.ts:38`):

```ts
it('line order: (month applied, key day, parcel rank, market before affordable)', () => {
  // Hand-built: a world after month 1 holding A (month 1, keyDay 900); applyLots in month 2 on
  // two lots whose clocks give keyDay 100: B rank 4 affordable, C rank 6 market.
  expect(rowsInOrder).toEqual(['A', 'B', 'C']);
  // Second case: one lot whose market and affordable both apply in month 2 with equal keyDay:
  expect(kinds).toEqual([KIND_MARKET, KIND_AFFORDABLE]);
});
it('planLot gives the earlier kind's month, then the other once the first is waiting', () => {});
it('apply records lot, kind, applied day inside the month, bundle ids, size, level and key', () => {
  for (const r of rows) {
    expect(r.applied).toBeGreaterThanOrEqual(ctx.firstDay);
    expect(r.applied).toBeLessThanOrEqual(ctx.lastDay);
    expect(r.key).toBe(lineKey(r.keyDay, statics.rank[r.lot], r.kind === 1 ? 'affordable' : 'market'));
  }
});
it('rule 8: an ordinary start removes both applications of its lot', () => {});
it('planLot is pure: asking twice, or from planDue's context, gives the same month', () => {});
```

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/apply.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `apply.ts` and `system.ts`.
- [ ] **Step 4: Run.** Expected: PASS. Also run `npx vitest --run --project server src/lib/sim/world/funding-hook.spec.ts` (world-core's hook tests, unchanged) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-funding): the funding system, planLot and applications`.

---

### Task 5: Pools, arrivals and money events (rules 12, 13, 14, 16)

**Files:**
- Create: `src/lib/sim/world/funding/pools.ts`
- Modify: `src/lib/sim/world/funding/system.ts` (`moneyIn`, `onProjectEvent` money part)
- Test: `src/lib/sim/world/funding/pools.spec.ts`

**Interfaces:**
- Consumes: columns (Task 2); `available`, `PoolState` (`funding.ts:207-238`); `projectDollars` (`$lib/sim/finance`); `LedgerEvent` (`money.ts:20`); `STAGE_ORDER` index of `'construction'`, `NO_DAY`.
- Produces:

```ts
/** System 2 (rule 12): every entry of frame.finance.arrivals, in list order; 0 dollars skipped. */
export function moneyIn(ctx: StepCtx): void;
/** Available money of world pool row `q` under the frame's definition of that pool (Infinity uncapped). */
export function availableOf(pools: FundPools, q: number, def: Pool): number;
/** Rule 13: the money events of a funded row on `e`; no-op for a row without money rows. */
export function moneyOnEvent(ctx: StepCtx, e: WorldEvent): void;
/** The commit of one award (Task 6 calls it before startProject): money rows for `row`, counters, 'commit' events. */
export function commitAward(ctx: StepCtx, fm: FrameMoney, row: number, day: Day, award: Award, units: number): void;
```

Money events (rule 13, amounts and kinds exactly `money.ts:105-162`, made at the event): on `'enter'` `construction`: grant `spend` G, loan `spend` P. On `'end'` `complete`: loan `repay` P, guarantee `release` H. On `'end'` `exit`, with `after` = the row entered construction (`projects.entered[row * 7 + construction] !== NO_DAY`): grant `loss` round(λ·G) if after else `release` G; loan: after → `repay` P − round(λ·P) then `loss` round(λ·P), else `release` P; guarantee: `release` H then, if after, `loss` min(round(λ·Q), H). λ = `mLoss`. Within one event the project's events are ordered (spend 0, repay 1, loss 2, release 3; a guarantee's release takes the loss order, ahead of its loss), then programme index in the frame, as `settle` sorts (`money.ts:170-172`). Counter updates as `settle` (`money.ts:177-196`). A `repay` or `release` to a capped pool sets `moneyDay`/`moneyMonth`; so does an arrival. Money rows of a row are dropped at its `'end'`. With `ctx.out.ledger` undefined no event object is built (rule 14). Nothing reads `pools[q].inflows` (rule 12).

- [ ] **Step 1: Write the failing tests.**

```ts
it('rule 12: under the bench baseline, after month 1 every capped baseline pool has received its first year's inflow', () => {
  // benchBaselineFunding(asOf) pools with a yearly inflow from asOf: received === dollarsPerYear
});
it('rule 14: one world stepped with and without a ledger gives the same events and pool columns', () => {});
it('money events: for a funded row that enters construction and completes, the ledger matches money.ts amounts', () => {
  // grant G spent on the construction day, loan P spent then repaid on completion, guarantee H released
});
it('an exit after construction books loss and repayment as money.ts does, guarantee release before its loss', () => {});
it('nothing reads pools[q].inflows', () => {
  // frame whose pools carry a throwing `inflows` getter; 24 months step without throwing
});
```

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/pools.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pools.ts`; wire `moneyIn` and the money part of `onProjectEvent` in `system.ts`. Builder's call: the money-event and exit tests drive `moneyOnEvent` directly on hand-set columns (a `World` with one funded row and money rows), so they do not need serving yet.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-funding): pools, arrivals and money events`.

---

### Task 6: Serving and the award (rules 10, 11)

**Files:**
- Create: `src/lib/sim/world/funding/serve.ts`
- Modify: `src/lib/sim/world/funding/system.ts` (`serve`)
- Test: `src/lib/sim/world/funding/serve.spec.ts`

**Interfaces:**
- Consumes: `awardSet`, `awardPasses`, `Award` (`funding.ts:337-502`); `pathwayFrom` (`scenario/engine.ts:910`); `commitAward`, `availableOf` (Task 5); `leaveLine` (Task 4); `FundedStart` (`types.ts:160`).
- Produces:

```ts
/** System 5: one scan in line order (rows 0..n-1, skipping `gone`), each against the pools as they stand. */
export function serveLine(ctx: StepCtx): void;
/** Rule 11's award day for an application row. */
export function awardDay(ctx: StepCtx, line: FundLine, i: number, pools: FundPools, asked: readonly number[]): Day;
/** Rule 11's `FundedStart` (fundingOf as `funded.ts:1657-1675`, route as `funded.ts:1738-1745`). */
export function fundedStartOf(ctx: StepCtx, fm: FrameMoney, line: FundLine, i: number, award: Award): FundedStart;
```

Per row: `bundle = fm.bundleIds(line.bundle[i])` (non-null after Task 9's remake; until then every frame of one timeline lists the same ids), `awardPasses` first (no allocation), `awardSet` only when it passes. On an award, in this order: `day = awardDay(...)` = max(`applied` if `month[i] === ctx.month` else `ctx.firstDay`, max `moneyDay[q]` over the capped pools in `award.asks` whose `moneyMonth[q] === ctx.month`); `row = world.projects.n` (builder's call: a funded `startProject` always appends exactly one row, `world.ts:327-328` with `addProject` `columns.ts:136-140`; asserted equal to the returned row); `commitAward(ctx, fm, row, day, award, units)`; `leaveLine(line, lot)`; `ctx.startProject(lot, day, fundedStartOf(...))`; `ctx.out.event({ kind: 'award', row, day })` (after the start's chain, the only order the synchronous `startProject` allows); `addShadow` is Task 10's. `certain = coverageLevel(award.priced.coverage) === 1`; `pathway`: `'streamlined'` when the application's view (`timeline.frameAt(viewMonth).view`) has `localProgram[lot] === 1`, `pathwayFrom(ctx.frame.newCalibration.affordableRoutes!, stream)` for a certain affordable award, else null. `programmes` = ids of set members with granted, lent or guaranteed above 0. Money moved after the scan (by the started chains) waits for next month (rule 10): no second scan.

- [ ] **Step 1: Write the failing tests.**

```ts
it('serves once a month in line order; money released after the scan waits a month', () => {});
it('T17: an award is dated no earlier than the latest money that reached a pool it draws on this month', () => {
  // a once inflow on day d late in month m to an empty pool: the award in month m has day >= d
});
it('FundedStart carries kind, view, size, applied, paying programme ids and fundingOf dollars', () => {});
it('a certain affordable award draws its route from affordableRoutes, within 3 standard errors over 500 seeds', () => {
  // as engine-finance.spec.ts:420-497: uncapped federal 100% affordable grant; for each pathway p,
  // |count_p / n - share_p| <= 3 * sqrt(share_p * (1 - share_p) / n); Local Program lots excluded
});
it('Review Focus 1: a lot removed from the line during the scan is skipped and the line is scanned once', () => {
  // an award whose chain frees and ordinarily starts a lot that also waits later in the line
});
it('Review Focus 2: an award entering construction in its own month spends that month', () => {});
it('Review Focus 3: an award asking nothing of a capped pool is dated its applied day or the first day', () => {});
```

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/serve.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `serve.ts`; wire `serve` in `system.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-funding): monthly serving and the award`.

---

### Task 7: Funded worlds end to end (rules 14, 15, 16, 21) — milestone "funded worlds ready"

**Files:**
- Create: `src/lib/sim/world/funding/test/identities.ts`, `src/lib/sim/world/funding/funded.spec.ts`, `src/lib/sim/world/funding/funded.golden.shared.ts`, `src/lib/sim/world/funding/funded.golden.test.ts`, `src/lib/sim/world/funding/funded.golden.svelte.spec.ts`, `src/lib/sim/world/funding/fixtures/funded-events-mini-seed1.json` (built by a builder script beside it, as `world/fixtures/build-world-golden.ts`)
- Modify: `src/lib/sim/world/funding/test/fixtures.ts` (`randomFinance`, `runFunded`)

**Interfaces:**
- Consumes: everything above; `checkMoneyIdentities` (`scenario/test/money-identities.ts:59`); `poolSeries`, `monthsOf` (`finance-score.ts:382`, `score.ts:25`); `selectRows` (`scenario/fixtures/select-rows.ts:12`); `tinyQueue`, `tinyStack` (`scenario/fixtures/tiny-queue.ts`).
- Produces:

```ts
// test/identities.ts
/** E1-E7 (finance-engine 4.7) on the ledger so far, and E4/the counters equal to the world's columns. Call after every step. */
export function checkStep(events: readonly LedgerEvent[], world: World, fin: FinanceFrame, prev: StepSums | null): StepSums;
// test/fixtures.ts
export function randomFinance(seed: number): Finance; // a copy of engine-finance.spec.ts:196-260 (not exported there)
export function runFunded(statics: Statics, timeline: PolicyTimeline, seed: number, through: number,
  opts?: { ledger?: boolean; afterStep?: (w: World, m: number) => void }): { world: World; events: (WorldEvent & { month: number })[]; ledger: LedgerEvent[] };
```

`checkStep` asserts, per pool: cumulative sums never fall from `prev` (E1), `committed >= 0`, `outLoan >= 0` (E1), `C = R + Sg + Sl + committed` (E2), `Sl = outLoan + P + Ll` (E3), capped `leverage·received − committed − Sg − outLoan − Ll − Lh >= -1e-6` and equal (to 1e-6) to `availableOf` on the world's columns (E4), `Lg <= Sg` (E5), no `in` on an uncapped pool (E6), per programme as `finance-harness.ts:76-87` (E7); and the world's six counters equal the ledger's. Days are not required to ascend across a step (a month's events come in system order).

- [ ] **Step 1: Write the failing tests** in `funded.spec.ts`:

```ts
it('E1-E7 after every step on 200 seeded random finances on the mini city', () => { /* commits > 50 */ });
it('rule 21: a timeline whose finance offers nothing gives the events of no finance, seed for seed', () => {
  // seeds 1..20, 480 months: events equal to world-core's unfunded run
});
it('rule 14: with and without a ledger, the same events', () => {});
it('rule 16: the known limit — an application waits on a spent pool and stays in line', () => {
  // tinyQueue + tinyStack with t-city one once inflow spent by the first award, no later inflow:
  // the second application is never awarded and is still in line at month 480
});
it('a structuredClone of the world mid-run steps to the same events and ledger', () => {});
it('permuting the lot table's rows gives the same events and ledger', () => {
  // as world/order.property.spec.ts: rows permuted by selectRows, events compared by parcel id
});
it('world 1's calendar-month money series satisfies I1-I6', () => {
  // poolSeries(ledger, finance, monthsOf(asOf, monthLastDay(asOf, 480)), ...) → checkMoneyIdentities
});
```

and the golden pair (Node and browser read the same JSON): the mini city with `miniFinance`, seed 1, 120 months, events and ledger.

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/funded.spec.ts src/lib/sim/world/funding/funded.golden.test.ts`. Expected: PASS when Tasks 3-6 are right (these tests add no production code). A failure is a defect in the owning module (Tasks 3-6) and is fixed there, never by loosening an assertion.
- [ ] **Step 3: Build the golden** with its builder script, then run `npx vitest --run --project client src/lib/sim/world/funding/funded.golden.svelte.spec.ts`. Expected: PASS in both projects.
- [ ] **Step 4: Run the funding folder and world-core's tests**: `npx vitest --run --project server src/lib/sim/world`. Expected: PASS. Then `npx eslint src/lib/sim/world/funding` and `npm run check`. Expected: clean.
- [ ] **Step 5: Commit** `test(world-funding): funded worlds end to end, ledger identities, golden`.
- [ ] **Step 6: MILESTONE — "funded worlds ready".** After this task's review passes, the operator messages `main`: "funded worlds ready" with `git rev-parse HEAD`. world-score waits on this sha. Rules 2-16 and 21 are in; 17-20 follow and do not change the hook's surface.

---

### Task 8: Remedies chosen by Task 1 (skip the parts Task 1's `DECISION` does not name)

Both remedies are exact: every test of Tasks 3-7 passes unchanged with them.

**Files:**
- Modify: `src/lib/sim/world/funding/clocks.ts` (8b), `src/lib/sim/world/funding/serve.ts` (8a)
- Test: `src/lib/sim/world/funding/remedies.spec.ts`

**Interfaces:**
- 8a (grouped serving, as `line.ts:194-415`): `serveLine` keeps its signature; inside, applications with one award rule (kind, bundle, prototype) are grouped and each group's largest passing size is found with `awardPasses` (`funding.ts:444`); the order of awards stays rule 9's scan order.
- 8b (rate tables, as `funded.ts:480-557`): `FrameMoney` gains `rates(kind): { rate: Float64Array; ref: Float64Array; at: Uint8Array | Uint16Array | Uint32Array; values: { bundle: number[]; level: number }[] }` indexed `lot * F + f`, filled lazily (seed-independent; never part of the world).

- [ ] **Step 1: Write the failing tests.**

```ts
it('8a: grouped serving awards the same rows on the same days as the direct scan', () => {
  // seeds 1..20 on the mini city with randomFinance: events and ledger equal with a test seam
  // `serveLine(ctx, { grouped: false })`
});
it('8b: kindClock with tables equals kindClock without, every lot and kind, bench city seed 1', () => {});
```

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/remedies.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the named remedies.
- [ ] **Step 4: Run** it and `npx vitest --run --project server src/lib/sim/world/funding`. Expected: PASS.
- [ ] **Step 5: Commit** `perf(world-funding): <grouped serving | rate tables> (rule 1 decision)`.

---

### Task 9: Change of policy (rules 17, 18, 19)

**Files:**
- Create: `src/lib/sim/world/funding/policy.ts`
- Modify: `src/lib/sim/world/funding/system.ts` (`policyChanged`), `src/lib/sim/world/funding/test/fixtures.ts` (`moneyTimeline`)
- Test: `src/lib/sim/world/funding/policy.spec.ts`

**Interfaces:**
- Consumes: `sameMoney`, `frameMoney` (Task 2); `sizeIn`, `kindClock` (Task 3); `spellsOf`, `planLotMonth` (Task 4); `setSpell`, `poolRowOf` (Task 2); `ordinaryStart` (`rates.ts:82`); `plannedMonth` (`due.ts:113`); `createMoneyTrack` (`policy/money.ts:112`), `inForceAt`, `moneyLeversOf` (`policy/combine.ts:48, 211`), `fundPolicy`, `miniDoc` (`policy/test/fixtures.ts`).
- Produces:

```ts
/** System 1 (rules 17-19). */
export function policyChanged(ctx: StepCtx): void;
// test/fixtures.ts
/** Frames of `input` (view and market constant) whose `finance` is policy-timeline's money track of `doc`; ids from `frameIdOf(key + market)`. */
export function moneyTimeline(input: SimInput, doc: SimPolicy4): PolicyTimeline;
```

`policyChanged`: ensure a pool row for every id of `frame.finance.pools` (`poolRowOf`). Let `before = timeline.frameAt(month - 1)`; when `before.view === frame.view` and `sameMoney(before, frame)`, return. Otherwise, in line order, re-make each waiting row as `remake` (`funded.ts:1684-1703`): size from the attempt's `SIZE` draw in `frame.view` against the lot's existing homes now; lapse when there is no size or `frame.view.pre.logit[lot] === -Infinity`, when `fm.bundleOf(kind, units)` is empty, or when `below(newLevel, level[i])`; else take the new bundle ids, size, level and `viewMonth = month`, keeping `month`, `applied`, `keyDay`, `key`. A lapse marks the row `gone`, records `setSpell(line, lot, kind, k, ctx.firstDay - 1)` (rule 18, `respell` with D = the month's first day, `funded.ts:1033-1051`), and puts the lot: `ctx.due.put(lot, plannedMonth(ord, planLotMonth(ctx, lot), ctx.month))` when that is above 0, `ord` the month of `ordinaryStart(...)` (the core has already replanned every free lot in system 1, `world.ts:484-489`, before this hook runs, `world.ts:536-537`; a put at a month no later than the lot's current one is safe, `types.ts:179-183`). Rule 19 needs no code here: `planLot` is pure, and the core's replanning only re-asks it.

- [ ] **Step 1: Write the failing tests.**

```ts
it('rule 17: a frame change that leaves money and view alone changes nothing in the line', () => {
  // a permitting-speed change at month 30: line columns before and after policyChanged equal
});
it('a pool switched off from month m: no award from it on or after m; emptied applications lapse and are planned again', () => {
  // moneyTimeline with the pool's programme ending at month m - 1's last day
});
it('rule 18: a lapsed kind's new spell starts on the month's first day on the same draws', () => {});
it('an arrival raised from month m leaves every event before month m identical', () => {
  // two moneyTimelines differing only in one pool's inflow from month m (firstDifference = m)
});
it('rule 16 continued: ending the spent programme lapses the waiting application and redraws it on the other shares', () => {});
it('Review Focus 4: a resumed world under an edited timeline gets rows for new pool ids and lapses applications naming unknown programmes', () => {});
```

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/policy.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `policy.ts`, `moneyTimeline`; wire `policyChanged`.
- [ ] **Step 4: Run** it and `npx vitest --run --project server src/lib/sim/world/funding`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-funding): re-making, lapse and respell on a change of policy`.

---

### Task 10: Shadow starts (rule 20)

**Files:**
- Create: `src/lib/sim/world/funding/shadow.ts`
- Modify: `src/lib/sim/world/funding/serve.ts` (an award adds a shadow), `src/lib/sim/world/funding/system.ts` (`shadow`)
- Test: `src/lib/sim/world/funding/shadow.spec.ts`

**Interfaces:**
- Consumes: `addShadow` (Task 2); `ordinaryStart` (`rates.ts:82`); `sizeIn` (Task 3); `ctx.displace` (`types.ts:205`).
- Produces:

```ts
/** System 7: each shadow whose ordinary start falls in ctx.month calls displace and ends; then compactLine. */
export function stepShadows(ctx: StepCtx): void;
```

An award adds a shadow with the lot's attempt k, the day it became free r, and its existing homes then. Each month the shadow's plan is `ordinaryStart(statics, timeline, month, sh, lot, r, k)`; builder's call: re-evaluate only in a month whose frame differs from last month's (`timeline.changes()` holds it) or when `shadowMonth` is unset, since between changes the plan cannot move (`rates.ts:70-81`). In the month that holds its day, `displace(row, lot, day, units)` with `units = size.units − existing`, the size from the attempt's `SIZE` draw in `timeline.frameAt(min(frameMonth, month)).view` (the view `startRow` uses, `world.ts:286`); when no level gains a home, no `displace` (today's `displaced` is 0 then, `funded.ts:1669-1673`; builder's call). A plan month before `ctx.month` throws (the due list's invariant). Nothing else ends a shadow.

- [ ] **Step 1: Write the failing tests.**

```ts
it('displaces on the ordinary start day, in its month, with the homes that start would have added', () => {
  expect(e).toEqual({ kind: 'displaced', row, lot, day: s.day, units: size.units - existing });
});
it('T3: an ordinary start later in the award month is displaced in that same month', () => {});
it('a shadow is never cancelled: the funded project exits and the lot restarts, the shadow still displaces', () => {});
it('Review Focus 5: attempt k + 1 after an exit has its own clocks; a spell recorded for attempt k is ignored', () => {});
```

- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/funding/shadow.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `npx vitest --run --project server src/lib/sim/world/funding`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-funding): shadow starts and displaced homes`.

---

### Task 11: The tolerance test against today's engine

**Files:**
- Create: `src/lib/sim/world/funding/tolerance.referee.spec.ts`
- Modify: `src/lib/sim/world/funding/test/fixtures.ts` (`benchFunded`, `liveFunded`, `metricsAt`)

**Interfaces:**
- Consumes: `runCollect` (`scenario/test/finance-harness.ts:115`) or `runEngineWith` with a ledger; `oldInputOf` (`world/test/timeline.ts:116`); `readAll` (`world/test/run.ts:70`); `addNet` semantics (`score.ts:125-136`); `benchFundingLevers` (`bench-finance.ts:267`), `buildFinance` (`$lib/sim/levers/finance`); `liveInput`, `liveDir` (`cities.node.ts`); `checkStep` (Task 7); `moneyTimeline` (Task 9).
- Produces:

```ts
export function benchFunded(set: 'baseline' | 'bench'): { input: SimInput; doc: SimPolicy4 }; // bench calibration as compile.perf.spec.ts:140-150; 'bench' adds benchFundingLevers (u- ids) on both engines
export function liveFunded(dir: string): Promise<{ input: SimInput; doc: SimPolicy4 }>; // finance re-added as input.ts:85-93
export interface Metrics { net: number; awards: number; fundedHomes: number }
/** By `day`: completed net homes (−existing at construction start after asOf, + final units at completion), awards (funded schedules whose first revision is on or before day), funded homes (their first revision's units). */
export function metricsAt(schedules: readonly Schedule[], asOf: Day, day: Day): Metrics;
```

Years Y ∈ {5, 10, 20, 40} read at `monthLastDay(asOf, 12 * Y)`; both engines run to month 480 (old horizon `monthLastDay(asOf, 480)`). The world side calls `checkStep` after every step (E1-E7 on every seed). T3 count: rows funded here whose `projectId` (`sim:<parcel>:<k>`) is an ordinary start in the old run whose first revision falls in the same model month. Each case prints a table (year, new mean/sd, old mean/sd, ratio; awards; funded homes; T3 count) and then asserts.

- [ ] **Step 1: Write the test**: for each of `benchFunded('baseline')`, `benchFunded('bench')`, and `liveFunded(liveDir())` when `liveDir()` is non-null (else a logged skip), seeds 1 to 200:

```ts
for (const Y of [5, 10, 20, 40]) {
  expect(Math.abs(mean(newNet[Y]) - mean(oldNet[Y])) / mean(oldNet[Y])).toBeLessThanOrEqual(0.01);
  expect(Math.abs(sd(newNet[Y]) - sd(oldNet[Y])) / sd(oldNet[Y])).toBeLessThanOrEqual(0.15);
  expect(Math.abs(mean(newAwards[Y]) - mean(oldAwards[Y])) / mean(oldAwards[Y])).toBeLessThanOrEqual(0.03);
  expect(Math.abs(mean(newFunded[Y]) - mean(oldFunded[Y])) / mean(oldFunded[Y])).toBeLessThanOrEqual(0.03);
}
```

Timeout 600_000 per case; the old runs are shared across years.

- [ ] **Step 2: Run** `SFH_WORLD_LIVE=<dir from Task 1> npx vitest --run --project server src/lib/sim/world/funding/tolerance.referee.spec.ts` (check the lock first; it is heavy). Expected: PASS, tables printed. **On a miss:** do not change a rule or a tolerance; the operator sends `main` the printed table (dataset, case, year, numbers, T3 count) and waits for a ruling. A failing assertion stays failing in the commit only if `main` says so; otherwise continue other tasks while waiting.
- [ ] **Step 3: Commit** `test(world-funding): tolerance against today's engine with public money`.

---

### Task 12: The perf bar and the docs

**Files:**
- Create: `src/lib/sim/world/funding/funded-month.perf.spec.ts`, `docs/dev/world-funding.md`
- Modify: `CLAUDE.md` (one line in "Scoped reference docs")

**Interfaces:**
- Consumes: `benchFunded('baseline')`, `runFunded` (Tasks 7, 11).

- [ ] **Step 1: Write the perf spec**: bench city, baseline funding, seeds 1 to 8 stepped to month 120 untimed, then months 121 to 240 timed one `step` at a time per world (frame-change months included as they come); prints p50, p90, mean and max µs per world-month and asserts `expect(mean).toBeLessThanOrEqual(90)` (the bar, spec "`test:perf`": one funded month for one world on the bench city, 90 µs; builder's call: the mean, because the 9 ms constraint is a sum over 96 worlds in one month). It also prints the whole-city replan month (every free lot asked `planLot`) as a separate number, unasserted.
- [ ] **Step 2: Take the lock, run** `npx vitest --run --project perf src/lib/sim/world/funding/funded-month.perf.spec.ts`, release. Expected: PASS; numbers marked "quiet (lock held)". A miss is reported to `main` with the numbers; no bar is moved.
- [ ] **Step 3: Write `docs/dev/world-funding.md`**: files table; the column layout of `World.line` and `World.pools` (ids, not indices); how each spec rule maps to code (clocks over frames, spent spells, key day, line order by month then key, once-a-month scan, award day T17, money events at stage events, respell on the month's first day, shadows); the hook calls by system; the Task 1 decision and its numbers (dataset named); the tests and how to run the live referee (`SFH_WORLD_LIVE`, the fetch from Task 1); the known differences from today (T3, R5's same-month order, a month's first-day bundle).
- [ ] **Step 4: Add to `CLAUDE.md`** under "Scoped reference docs": `- **Public money in the step engine (world-funding: the line by month, funded clocks over frames, money events at stage events, shadows, the tolerance referee)** — [docs/dev/world-funding.md](docs/dev/world-funding.md)`.
- [ ] **Step 5: Run** `npx prettier --check docs/dev/world-funding.md CLAUDE.md src/lib/sim/world/funding` and `npx vitest --run --project server src/lib/sim/world`. Expected: PASS.
- [ ] **Step 6: Commit** `docs(world-funding): developer doc, perf bar`.

---

## Open questions for `main`

1. **Money identity is not on the frame.** Rule 17 needs "the money in force (the frame's identity, rule 16 of policy-timeline)", but `FinanceFrame` (`policy/frame.ts:32-43`) carries no key; the key is built and folded into the frame id (`policy/money.ts:177-182`, `compile.ts:292-294`). The plan recomputes it in `sameMoney` from `offered`, the offered programmes, the pools they draw on (without inflows), `terms` and `slope`, mirroring `money.ts:170-182`. Recommendation: accept for Release A; if policy-timeline later adds `FinanceFrame.key`, `sameMoney` switches to it.
2. **The funded row is predicted, not handed back.** Money rows must exist before `startProject` returns because the award's own chain events reach `onProjectEvent` inside the call (`world.ts:370-376`). The plan relies on a funded start appending exactly row `world.projects.n` (`world.ts:327-328`, `columns.ts:136-140`) and asserts it. Recommendation: world-core confirms this as a documented guarantee of `startProject` (a doc-comment line in `types.ts`), no code change.
3. **`'award'` arrives after the start's chain.** S7 orders `'start'` first; the synchronous `startProject` emits the chain before the hook can send `'award'`. Recommendation: accept (world-score reads the award by row, not by position); note in world-score's assignment.
4. **The whole-city `planLot` on every funded frame change** (`world.ts:484-489`, `due.ts:200-223`): the hook cannot see the due list's `through`, so it cannot skip lots whose applications fall past the window as today's `marketSkip`/`affordableSkip` do (`funded.ts:118-125`). Task 1 measures this month's cost; if one world's replan exceeds 50 ms, the remedy is a `through` (or a skip bound) on `StepCtx`, a world-core change.

## Spec notes the plan resolves (no ruling needed)

- `pathwayFrom` is in `src/lib/sim/scenario/engine.ts:910` (hashed, importable), not in `src/lib/sim/finance/` as the spec's Scope paragraph says.
- The spec's docs line names `docs/dev/step-engine.md`; per the standing rules the doc is `docs/dev/world-funding.md`.
- `npm run data:local` loads local R2 only; the Node referee reads a directory (`cities.node.ts:90`), so Task 1 also fetches the scenario files into one.
- Within one timeline `finance` is null in every month or in none (`policy/money.ts:118`), so no awarded project can miss its money events in a month without hooks.
