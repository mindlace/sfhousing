# Scoreboard Stage 1 (pure core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STAGED DELIVERY.** This plan covers **stage 1 only**: the pure-TS core, with no DOM. **Stage 2 follows** after brush-tool lands. It adds `Scoreboard.svelte`, spec §4.4, §4.6 and §4.7, `ScoreStatus`, and the client and e2e tests. Do not build any UI in this plan, and do not stub brush-tool's protocol (`src/lib/sim/`).

**Goal:** Ship the scoreboard's pure core: the I11 types, the M1 target registry, the incremental accumulator, the pure `score()` that brush-tool's worker host (I15) calls, and number formatting.

**Architecture:** `src/lib/scoreboard/` holds four small pure modules: `types.ts` (I11), `targets.ts` (`M1_TARGETS`), `accumulator.ts` (`createScoreAccumulator`, `score`), and `format.ts`. An `index.ts` barrel re-exports them. The accumulator keeps a `Map<ParcelId, Contribution>` plus integer totals and per-neighborhood `{net, count}`, and supports O(1) `set`. `score()` is an independent fold over the same per-parcel contribution function. The property test checks it against the accumulator.

**Tech Stack:** TypeScript 6, Vitest 4 (`server` project, node env, `expect.requireAssertions`), fast-check 4 (already a devDependency).

**Spec:** `docs/superpowers/specs/2026-10-10-scoreboard-design.md` (design: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`)

## Global Constraints

Copied verbatim from spec §3:

- **Free and open source.** No paid APIs and no vendor keys are needed to run or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1: *theoretical max buildout*). Net counts are shown, not gross. Sources and vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era laptop. Generated buildings appear within 150 ms of pointer-up for strokes covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within 5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works at 375 px.
- **Data is static and versioned.** The worker does no geo computation at runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all work, bare-name Cloudflare resources (`sfhousing`), and the migration workflow via Drizzle.

Interface rows produced. These are verbatim from spec §2, and this plan must not bend them:

- **I11:** `interface Score { grossUnits: number; demolishedUnits: number; netUnits: number; targets: TargetProgress[]; parcelsChanged: number; byNeighborhood: Record<string, number> }`; `interface Target { id: string; label: string; units: number; range?: [low: number, high: number] /* M1 never sets; M2 affordability targets are ranges */; source: { label: string; url: string } }`; `interface TargetProgress { target: Target; fraction: number /* uncapped: 1.8 = 180% */ }`. M1 registers `rhna` (82,069) and `rhna-buffer` (94,379). Marking: MC (net units against named targets; overshoot is meaningful), DC (shape).
- **I15 (the part scoreboard owns):** the worker calls scoreboard's pure `score()`, and may use `createScoreAccumulator`. Neither touches the DOM.

Interfaces consumed. Import them and never modify them:

- `ParcelId` and `ParcelRecord` from `$lib/data/parcel`
- `GeneratedBuilding` from `$lib/generator` (barrel `src/lib/generator/index.ts`)

Project rules:

- Do not touch `src/lib/{data,plan,generator,map,sim}/`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns.
- Every Vitest test must call `expect`.
- Server tests run with `npx vitest --run --project server <path>`.

## Review Focus

These are the inputs the spec implies but does not spell out. Each line has a pinning test in the owning task.

1. **Float error in floored percent.** `0.29 * 100 === 28.999999999999996`. A naive floor shows "28%" for 29%. Expected: "29%". 82068/82069 must still show "99%", never "100%" (Task 2).
2. **Negative zero and negative counts.** `Intl` formats `-0` as "-0" and negatives with a hyphen. Expected: `formatCount(-0)` → "0", `formatCount(-1234)` → "−1,234" with U+2212, and `formatPercent(-0)` → "0%" (Task 2).
3. **Duplicate parcels in `score()`'s iterable.** Expected: the last entry for a parcel id wins, the parcel counts once, and the result equals the accumulator after the same `set` sequence (Task 3).
4. **Neighborhood names that collide with `Object.prototype`** (`"__proto__"`, `"constructor"`, `"toString"`). Expected: they are ordinary own keys of `byNeighborhood` with correct sums, and the object's prototype is not polluted (Task 3).
5. **Snapshot isolation and deterministic key order.** Mutating a returned `Score`, or calling `set` after `snapshot()`, must not change earlier snapshots, later snapshots or `M1_TARGETS`. Keys of `byNeighborhood` come out in sorted order, whatever the update order, so serialized scores are byte-identical (Task 3, Task 1 for target freezing).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/scoreboard/types.ts` | I11 types: `Score`, `Target`, `TargetProgress` (verbatim shape) |
| `src/lib/scoreboard/targets.ts` | `M1_TARGETS`, deep-frozen |
| `src/lib/scoreboard/targets.spec.ts` | registry tests |
| `src/lib/scoreboard/format.ts` | `formatCount`, `formatPercent`, `formatCompactCount`, `formatBuiltDate` |
| `src/lib/scoreboard/format.spec.ts` | formatting tests |
| `src/lib/scoreboard/accumulator.ts` | `Contribution`, `ScoreAccumulator`, `createScoreAccumulator`, `score` |
| `src/lib/scoreboard/score-fixtures.ts` | parcel and building fixture builders for tests |
| `src/lib/scoreboard/accumulator.spec.ts` | formula, replace and remove, fraction, and edge tests |
| `src/lib/scoreboard/accumulator.property.spec.ts` | fast-check: incremental equals recompute, and order invariance |
| `src/lib/scoreboard/index.ts` | public barrel |

---

### Task 1: I11 types and the M1 target registry

**Files:**
- Create: `src/lib/scoreboard/types.ts`
- Create: `src/lib/scoreboard/targets.ts`
- Create: `src/lib/scoreboard/index.ts`
- Test: `src/lib/scoreboard/targets.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface Score`, `export interface Target`, `export interface TargetProgress` (from `types.ts`); `export const M1_TARGETS: readonly Target[]` (from `targets.ts`); the barrel `src/lib/scoreboard/index.ts`, which re-exports them. Tasks 2 and 3 add their exports to it.

- [ ] **Step 1: Write the failing test** `src/lib/scoreboard/targets.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { M1_TARGETS } from './targets';

const PRIMER =
  'https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/RHNA-Primer.pdf';

describe('M1_TARGETS', () => {
  it('registers rhna then rhna-buffer, in that order', () => {
    expect(M1_TARGETS.map((t) => t.id)).toEqual(['rhna', 'rhna-buffer']);
  });

  it('has the spec §4.2 labels, units and sources', () => {
    expect(M1_TARGETS[0]).toEqual({
      id: 'rhna',
      label: 'RHNA 2023–2031',
      units: 82069,
      source: { label: 'SF Planning, RHNA Primer', url: PRIMER }
    });
    expect(M1_TARGETS[1]).toEqual({
      id: 'rhna-buffer',
      label: 'RHNA + 15% buffer',
      units: 94379,
      source: { label: 'SF Planning, RHNA Primer', url: PRIMER }
    });
  });

  it('buffer units equal floor(82069 × 1.15)', () => {
    expect(M1_TARGETS[1].units).toBe(Math.floor(82069 * 1.15));
  });

  it('never sets range in M1', () => {
    for (const t of M1_TARGETS) expect(t.range).toBeUndefined();
  });

  it('is deep-frozen so no consumer can mutate the registry', () => {
    expect(Object.isFrozen(M1_TARGETS)).toBe(true);
    for (const t of M1_TARGETS) {
      expect(Object.isFrozen(t)).toBe(true);
      expect(Object.isFrozen(t.source)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest --run --project server src/lib/scoreboard/targets.spec.ts`
Expected: FAIL, because `./targets` cannot be resolved.

- [ ] **Step 3: Write `types.ts`, `targets.ts` and `index.ts`**

`src/lib/scoreboard/types.ts`:

```ts
// Shared seam (I11). Owned by scoreboard. Shapes are fixed by the design's interface table;
// do not change them. Marking: MC (net units against named targets; overshoot is meaningful).

export interface Target {
  id: string;
  label: string;
  units: number;
  range?: [low: number, high: number] /* M1 never sets; M2 affordability targets are ranges */;
  source: { label: string; url: string };
}

export interface TargetProgress {
  target: Target;
  fraction: number /* uncapped: 1.8 = 180% */;
}

export interface Score {
  grossUnits: number;
  demolishedUnits: number;
  netUnits: number;
  targets: TargetProgress[];
  parcelsChanged: number;
  byNeighborhood: Record<string, number>;
}
```

`src/lib/scoreboard/targets.ts`:

```ts
import type { Target } from './types';

// Spec §4.2. Verified 2026-10-10: the primer gives 82,069 for 2023–2031 and a buffer of
// "at least 15% more capacity". 82,069 × 1.15 = 94,379.35, rounded down to 94,379.
const RHNA_PRIMER = Object.freeze({
  label: 'SF Planning, RHNA Primer',
  url: 'https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/RHNA-Primer.pdf'
});

/** M1 target registry. Order is display order; the first target is primary. */
export const M1_TARGETS: readonly Target[] = Object.freeze([
  Object.freeze({ id: 'rhna', label: 'RHNA 2023–2031', units: 82069, source: RHNA_PRIMER }),
  Object.freeze({ id: 'rhna-buffer', label: 'RHNA + 15% buffer', units: 94379, source: RHNA_PRIMER })
]);
```

`src/lib/scoreboard/index.ts`:

```ts
export type { Score, Target, TargetProgress } from './types';
export { M1_TARGETS } from './targets';
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest --run --project server src/lib/scoreboard/targets.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run lint on the new files, then commit**

Run: `npx prettier --check src/lib/scoreboard && npx eslint src/lib/scoreboard`
Expected: clean. Run `npx prettier --write src/lib/scoreboard` if needed.

```bash
git add src/lib/scoreboard docs/superpowers/plans/2026-10-10-scoreboard-stage1.md
git commit -m "feat(scoreboard): I11 types and M1 target registry"
```

---

### Task 2: Number formatting (§4.5, pure)

**Files:**
- Create: `src/lib/scoreboard/format.ts`
- Modify: `src/lib/scoreboard/index.ts` (append the export line)
- Test: `src/lib/scoreboard/format.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, for stage 2's `Scoreboard.svelte`:
  - `formatCount(n: number): string`
  - `formatPercent(fraction: number): string`
  - `formatCompactCount(n: number): string`
  - `formatBuiltDate(builtAt: string): string`

Rules (spec §4.5, plus the Review Focus decisions):

- `formatCount`: `Intl.NumberFormat('en-US')` on `|n|`, prefixed with U+2212 `−` when `n < 0`. So `-0` gives "0".
- `formatPercent`: `p = fraction * 100`.
  - If `|p| < 10`, floor to one decimal and always show one decimal ("0.4%", "5.0%", "0.0%" for a tiny nonzero value).
  - Otherwise floor to an integer, with en-US grouping ("180%", "1,234%").
  - Exactly 0 (including −0) gives "0%".
  - Negatives get U+2212 and use mathematical floor (−0.45 gives "−0.5%").
  - Before flooring, a scaled value within a relative 1e-9 of an integer snaps to that integer. This defeats float error (`0.29*100 = 28.999…`). It is far below the smallest real step: 1/94379 of a target is about 1e-3 percentage points. So 82068/82069 still shows "99%".
  - Never clamp: overshoot shows as-is.
- `formatCompactCount`: if `n >= 100_000`, use `Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })`. Otherwise use `formatCount(n)`.
- `formatBuiltDate`: return the leading `YYYY-MM-DD` of `builtAt` (the literal date as written, with no timezone conversion). If there is no such prefix, return `builtAt` unchanged.

- [ ] **Step 1: Write the failing test** `src/lib/scoreboard/format.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { formatBuiltDate, formatCompactCount, formatCount, formatPercent } from './format';

describe('formatPercent (spec §6)', () => {
  it.each([
    [0, '0%'],
    [0.004, '0.4%'],
    [0.0999, '9.9%'],
    [0.9999, '99%'],
    [1, '100%'],
    [1.8049, '180%']
  ])('%d → %s', (fraction, expected) => {
    expect(formatPercent(fraction)).toBe(expected);
  });

  it('is never clamped: 2.0 → 200%, 12.345 → 1,234%', () => {
    expect(formatPercent(2)).toBe('200%');
    expect(formatPercent(12.345)).toBe('1,234%');
  });

  it('defeats float error: 0.29 → 29%, 0.57 → 57%', () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE-754
    expect(formatPercent(0.29)).toBe('29%');
    expect(formatPercent(0.57)).toBe('57%');
  });

  it('never shows 100% before the target is met', () => {
    expect(formatPercent(82068 / 82069)).toBe('99%');
    expect(formatPercent(94378 / 94379)).toBe('99%');
    expect(formatPercent(82069 / 82069)).toBe('100%');
  });

  it('every integer net against each M1 target floors exactly', () => {
    for (const units of [82069, 94379]) {
      for (let net = 0; net <= 3 * units; net += 997) {
        const exactTenths = Math.floor((net * 1000) / units); // floor(p*10), integer math
        const p = (net * 100) / units;
        const expected =
          net === 0
            ? '0%'
            : p < 10
              ? `${(exactTenths / 10).toFixed(1)}%`
              : `${Math.floor((net * 100) / units).toLocaleString('en-US')}%`;
        expect(formatPercent(net / units)).toBe(expected);
      }
    }
  });

  it('shows one decimal below 10%, even when it is .0', () => {
    expect(formatPercent(0.05)).toBe('5.0%');
    expect(formatPercent(0.0004)).toBe('0.0%');
  });

  it('formats negatives with U+2212 and treats -0 as 0', () => {
    expect(formatPercent(-0)).toBe('0%');
    expect(formatPercent(-0.004)).toBe('−0.4%');
    expect(formatPercent(-0.0045)).toBe('−0.5%');
    expect(formatPercent(-1.5)).toBe('−150%');
  });
});

describe('formatCount', () => {
  it('82069 → "82,069"', () => {
    expect(formatCount(82069)).toBe('82,069');
  });

  it('−5 → "−5" with U+2212', () => {
    expect(formatCount(-5)).toBe('−5');
    expect(formatCount(-1234)).toBe('−1,234');
  });

  it('0 and -0 → "0"', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(-0)).toBe('0');
  });
});

describe('formatCompactCount', () => {
  it('compact 123456 → "123.5K"', () => {
    expect(formatCompactCount(123456)).toBe('123.5K');
  });

  it('uses the exact count below 100,000', () => {
    expect(formatCompactCount(99999)).toBe('99,999');
    expect(formatCompactCount(-200000)).toBe('−200,000');
  });

  it('switches at exactly 100,000', () => {
    expect(formatCompactCount(100000)).toBe('100K');
  });
});

describe('formatBuiltDate', () => {
  it('takes the literal YYYY-MM-DD prefix, with no timezone shift', () => {
    expect(formatBuiltDate('2026-10-10T23:30:00-07:00')).toBe('2026-10-10');
    expect(formatBuiltDate('2026-10-10T01:00:00Z')).toBe('2026-10-10');
    expect(formatBuiltDate('2026-10-10')).toBe('2026-10-10');
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatBuiltDate('unknown')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest --run --project server src/lib/scoreboard/format.spec.ts`
Expected: FAIL, because `./format` cannot be resolved.

- [ ] **Step 3: Write `src/lib/scoreboard/format.ts`**

```ts
// Spec §4.5. Pure; no DOM.

const MINUS = '−';
const COUNT = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ONE_DP = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

/** Exact count, en-US grouping, U+2212 for negatives. `-0` → "0". */
export function formatCount(n: number): string {
  return (n < 0 ? MINUS : '') + COUNT.format(Math.abs(n));
}

/** Floor that first snaps values within float error of an integer (0.29*100 = 28.999…). */
function snapFloor(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) <= 1e-9 * Math.max(1, Math.abs(x)) ? r : Math.floor(x);
}

/**
 * Percent of an uncapped fraction. Floors (never shows 100% before the target is met):
 * one decimal when |p| < 10, otherwise an integer. Exactly 0 → "0%".
 */
export function formatPercent(fraction: number): string {
  const p = fraction * 100;
  if (p === 0) return '0%';
  if (Math.abs(p) < 10) {
    const tenths = snapFloor(p * 10);
    return (tenths < 0 ? MINUS : '') + ONE_DP.format(Math.abs(tenths) / 10) + '%';
  }
  const whole = snapFloor(p);
  return (whole < 0 ? MINUS : '') + INT.format(Math.abs(whole)) + '%';
}

/** Mobile bar only: compact ("123.5K") when n ≥ 100,000, else the exact count. */
export function formatCompactCount(n: number): string {
  return n >= 100_000 ? COMPACT.format(n) : formatCount(n);
}

/** The literal YYYY-MM-DD prefix of a manifest `builtAt`; unchanged if there is none. */
export function formatBuiltDate(builtAt: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(builtAt);
  return m ? m[1] : builtAt;
}
```

Worked example: for `−0.0045`, `p = −0.45`, `p*10 = −4.5`, the floor is −5, and the output is "−0.5%". This matches the test.

Boundary note: `p = 9.99` gives `tenths = 99`, which formats as "9.9". If `p*10` is within float error of 100 (for example `p = 9.9999999999`), the snap makes `tenths = 100`, which formats as "10.0%". That is acceptable: only a sub-1e-9 neighbourhood of 10% is affected, and real fractions never land there.

- [ ] **Step 4: Append to `src/lib/scoreboard/index.ts`**

```ts
export { formatBuiltDate, formatCompactCount, formatCount, formatPercent } from './format';
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest --run --project server src/lib/scoreboard/format.spec.ts`
Expected: PASS. If the integer-math sweep test fails at a specific `net`, report the value. Do not loosen the test.

- [ ] **Step 6: Lint and commit**

Run: `npx prettier --write src/lib/scoreboard && npx eslint src/lib/scoreboard`

```bash
git add src/lib/scoreboard
git commit -m "feat(scoreboard): pure number formatting"
```

---

### Task 3: Accumulator and pure `score()` (§4.1, §4.3)

**Files:**
- Create: `src/lib/scoreboard/accumulator.ts`
- Create: `src/lib/scoreboard/score-fixtures.ts`
- Modify: `src/lib/scoreboard/index.ts` (append the export lines)
- Test: `src/lib/scoreboard/accumulator.spec.ts`, `src/lib/scoreboard/accumulator.property.spec.ts`

**Interfaces:**
- Consumes:
  - `Score`, `Target` and `TargetProgress` from `./types`; `M1_TARGETS` from `./targets` (tests only).
  - `import type { ParcelId, ParcelRecord } from '$lib/data/parcel'`.
  - `import type { GeneratedBuilding } from '$lib/generator'`. Its shape: `{ parcelId; source: 'user'; typology: TypologyId; parts: { footprint: [lng, lat][]; baseM; topM }[]; stories; units; floorAreaM2; replacesExisting }`.
- Produces (spec §2 internal types, exact names):
  - `export interface Contribution { gross: number; demolished: number; neighborhood: string }`
  - `export interface ScoreAccumulator { set(parcel: ParcelRecord, building: GeneratedBuilding | null): void; clear(): void; snapshot(): Score }`
  - `export function createScoreAccumulator(targets: readonly Target[]): ScoreAccumulator`
  - `export function score(entries: Iterable<[ParcelRecord, GeneratedBuilding]>, targets: readonly Target[]): Score`. This is the function brush-tool's I15 worker host calls.
  - `export const UNASSIGNED = 'Unassigned'`

Semantics (spec §4.1, plus the Review Focus decisions):

- `gross = b ? b.units : 0`
- `demolished = b && b.replacesExisting ? p.existingUnits : 0`
- `net = gross − demolished`
- `parcelsChanged` = the count of parcels whose current building is non-null.
- `byNeighborhood[n]` = the sum of net over changed parcels in `n`. The key is `UNASSIGNED` when `p.neighborhood.trim() === ''`. A key exists exactly while at least one changed parcel is in that neighborhood (count-based, not net-based), so a defensive net of 0 with parcels present still shows 0. Build the object with `Object.fromEntries` over **sorted** keys (default `.sort()`, UTF-16 code-unit order), so that `"__proto__"` is an own data property and key order is deterministic.
- `targets[i] = { target: targets[i], fraction: netUnits / targets[i].units }`, in registry order. Fractions are uncapped and unclamped.
- Every `snapshot()` / `score()` returns fresh objects (a new `targets` array, new `TargetProgress` objects and a new `byNeighborhood`). The `target` reference is the registry object itself, and it is frozen for M1.
- `set(p, null)` on a parcel that was never set is a no-op.
- `score()` folds its entries into a `Map<ParcelId, Contribution>` keyed by `parcel.id`. The last entry wins, and a null building removes the parcel, defensively for JS callers. It then totals the map **without** going through `createScoreAccumulator`, so the property test compares two independent code paths. Both paths share `contributionOf` and `buildScore`.

- [ ] **Step 1: Write the fixtures** `src/lib/scoreboard/score-fixtures.ts`

```ts
import type { ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';

export function parcel(
  id: string,
  existingUnits: number,
  neighborhood = 'Mission',
  overrides: Partial<ParcelRecord> = {}
): ParcelRecord {
  return {
    id,
    polygon: [
      [
        [0, 0],
        [7.62, 0],
        [7.62, 30.48],
        [0, 30.48],
        [0, 0]
      ]
    ],
    labelPoint: [-122.42, 37.76],
    areaM2: 232,
    existingUnits,
    existingFloorAreaM2: existingUnits * 90,
    existingHeightM: existingUnits > 0 ? 9 : 0,
    landUse: existingUnits > 0 ? 'RESIDENT' : 'VACANT',
    eligible: true,
    neighborhood,
    ...overrides
  };
}

export function building(
  p: ParcelRecord,
  units: number,
  replacesExisting: boolean
): GeneratedBuilding {
  return {
    parcelId: p.id,
    source: 'user',
    typology: replacesExisting ? 'walkup' : 'adu',
    parts: [
      {
        footprint: [
          [-122.42, 37.76],
          [-122.4199, 37.76],
          [-122.4199, 37.7601],
          [-122.42, 37.76]
        ],
        baseM: 0,
        topM: 12
      }
    ],
    stories: 4,
    units,
    floorAreaM2: units * 80,
    replacesExisting
  };
}

// Spec §6 named fixtures
export const aduLot = parcel('1000001', 1, 'Sunset');
export const aduBuilding = building(aduLot, 1, false); // gross 1, demolished 0, net 1
export const replLot = parcel('1000002', 1, 'Mission');
export const replBuilding = building(replLot, 9, true); // net 8
export const vacantLot = parcel('1000003', 0, 'Mission');
export const vacantBuilding = building(vacantLot, 2, true); // net 2
export const nullLot = parcel('1000004', 3, 'Richmond'); // generates null
export const unassignedLot = parcel('1000005', 0, '');
export const unassignedBuilding = building(unassignedLot, 4, true); // "Unassigned": 4
```

- [ ] **Step 2: Write the failing unit tests** `src/lib/scoreboard/accumulator.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createScoreAccumulator, score, UNASSIGNED } from './accumulator';
import { M1_TARGETS } from './targets';
import type { Target } from './types';
import {
  aduBuilding,
  aduLot,
  building,
  nullLot,
  parcel,
  replBuilding,
  replLot,
  unassignedBuilding,
  unassignedLot,
  vacantBuilding,
  vacantLot
} from './score-fixtures';

const ONE: readonly Target[] = [
  { id: 't', label: 'T', units: 100, source: { label: 's', url: 'https://example.org' } }
];

describe('formulas (spec §4.1)', () => {
  it('ADU on a 1-unit lot: gross 1, demolished 0, net 1', () => {
    const s = score([[aduLot, aduBuilding]], ONE);
    expect(s).toMatchObject({ grossUnits: 1, demolishedUnits: 0, netUnits: 1, parcelsChanged: 1 });
    expect(s.byNeighborhood).toEqual({ Sunset: 1 });
  });

  it('replacement 9 over 1: net 8', () => {
    const s = score([[replLot, replBuilding]], ONE);
    expect(s).toMatchObject({ grossUnits: 9, demolishedUnits: 1, netUnits: 8 });
  });

  it('vacant replacement 2 over 0: net 2', () => {
    const s = score([[vacantLot, vacantBuilding]], ONE);
    expect(s).toMatchObject({ grossUnits: 2, demolishedUnits: 0, netUnits: 2 });
  });

  it('null building: no change', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(nullLot, null);
    expect(acc.snapshot()).toEqual({
      grossUnits: 0,
      demolishedUnits: 0,
      netUnits: 0,
      targets: [{ target: ONE[0], fraction: 0 }],
      parcelsChanged: 0,
      byNeighborhood: {}
    });
  });

  it('empty neighborhood (and whitespace-only) → "Unassigned"', () => {
    const blank = parcel('1000006', 0, '   ');
    const s = score(
      [
        [unassignedLot, unassignedBuilding],
        [blank, building(blank, 3, true)]
      ],
      ONE
    );
    expect(UNASSIGNED).toBe('Unassigned');
    expect(s.byNeighborhood).toEqual({ Unassigned: 7 });
  });

  it('totals over mixed parcels; neighborhoods sum net; absent when unchanged', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(aduLot, aduBuilding);
    acc.set(replLot, replBuilding);
    acc.set(vacantLot, vacantBuilding);
    acc.set(nullLot, null);
    const s = acc.snapshot();
    expect(s).toMatchObject({ grossUnits: 12, demolishedUnits: 1, netUnits: 11, parcelsChanged: 3 });
    expect(s.byNeighborhood).toEqual({ Mission: 10, Sunset: 1 });
    expect('Richmond' in s.byNeighborhood).toBe(false);
  });
});

describe('accumulator replace and remove', () => {
  it('set twice on the same parcel replaces rather than adds', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(replLot, replBuilding);
    acc.set(replLot, building(replLot, 5, true));
    expect(acc.snapshot()).toMatchObject({ grossUnits: 5, demolishedUnits: 1, netUnits: 4, parcelsChanged: 1 });
    expect(acc.snapshot().byNeighborhood).toEqual({ Mission: 4 });
  });

  it('set(p, null) removes the parcel and deletes the neighborhood key at zero parcels', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(aduLot, aduBuilding);
    acc.set(replLot, replBuilding);
    acc.set(aduLot, null);
    expect(acc.snapshot().byNeighborhood).toEqual({ Mission: 8 });
    acc.set(replLot, null);
    expect(acc.snapshot()).toMatchObject({ grossUnits: 0, netUnits: 0, parcelsChanged: 0, byNeighborhood: {} });
  });

  it('set(p, null) on a never-set parcel is a no-op', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(aduLot, aduBuilding);
    const before = acc.snapshot();
    acc.set(nullLot, null);
    expect(acc.snapshot()).toEqual(before);
  });

  it('a neighborhood whose net sums to 0 stays present (count-based, defensive)', () => {
    const shrink = parcel('1000007', 5, 'Bayview');
    const acc = createScoreAccumulator(ONE);
    acc.set(shrink, building(shrink, 5, true)); // net 0; impossible under I8, handled anyway
    expect(acc.snapshot().byNeighborhood).toEqual({ Bayview: 0 });
  });

  it('negative net is carried, not clamped (defensive)', () => {
    const shrink = parcel('1000008', 10, 'Bayview');
    const s = score([[shrink, building(shrink, 4, true)]], ONE);
    expect(s.netUnits).toBe(-6);
    expect(s.targets[0].fraction).toBe(-0.06);
    expect(s.byNeighborhood).toEqual({ Bayview: -6 });
  });

  it('clear() resets everything', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(replLot, replBuilding);
    acc.clear();
    expect(acc.snapshot()).toEqual(score([], ONE));
    acc.set(aduLot, aduBuilding);
    expect(acc.snapshot().netUnits).toBe(1);
  });
});

describe('fractions (uncapped, registry order)', () => {
  function manyNet(net: number): ReturnType<typeof score> {
    const p = parcel('2000000', 0, 'Mission');
    return score([[p, building(p, net, true)]], M1_TARGETS);
  }

  it('net 164,138 → rhna fraction exactly 2.0', () => {
    const s = manyNet(164138);
    expect(s.targets.map((t) => t.target.id)).toEqual(['rhna', 'rhna-buffer']);
    expect(s.targets[0].fraction).toBe(2);
    expect(s.targets[1].fraction).toBe(164138 / 94379);
    expect(s.targets[0].target).toBe(M1_TARGETS[0]);
  });

  it('net 0 → 0', () => {
    expect(score([], M1_TARGETS).targets.map((t) => t.fraction)).toEqual([0, 0]);
  });

  it('renders N targets generically (zero targets too)', () => {
    expect(score([[aduLot, aduBuilding]], []).targets).toEqual([]);
  });
});

describe('score() edge inputs', () => {
  it('duplicate parcel ids: last entry wins and equals the accumulator', () => {
    const entries: [typeof replLot, typeof replBuilding][] = [
      [replLot, replBuilding],
      [aduLot, aduBuilding],
      [replLot, building(replLot, 3, true)]
    ];
    const s = score(entries, ONE);
    expect(s).toMatchObject({ grossUnits: 4, demolishedUnits: 1, netUnits: 3, parcelsChanged: 2 });
    const acc = createScoreAccumulator(ONE);
    for (const [p, b] of entries) acc.set(p, b);
    expect(s).toEqual(acc.snapshot());
  });

  it('prototype-named neighborhoods are own keys with correct sums', () => {
    const names = ['__proto__', 'constructor', 'toString'];
    const ps = names.map((n, i) => parcel(`300000${i}`, 0, n));
    const s = score(
      ps.map((p, i) => [p, building(p, i + 1, true)] as [typeof p, ReturnType<typeof building>]),
      ONE
    );
    expect(Object.getPrototypeOf(s.byNeighborhood)).toBe(Object.prototype);
    expect(Object.keys(s.byNeighborhood)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getOwnPropertyDescriptor(s.byNeighborhood, '__proto__')?.value).toBe(1);
    expect(s.byNeighborhood.constructor).toBe(2);
    expect(s.byNeighborhood.toString).toBe(3);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('isolation and determinism', () => {
  it('snapshots are independent of later sets and of mutation', () => {
    const acc = createScoreAccumulator(ONE);
    acc.set(replLot, replBuilding);
    const a = acc.snapshot();
    a.byNeighborhood.Mission = 999;
    a.targets.pop();
    acc.set(aduLot, aduBuilding);
    const b = acc.snapshot();
    expect(b.byNeighborhood).toEqual({ Mission: 8, Sunset: 1 });
    expect(b.targets).toHaveLength(1);
    expect(a.netUnits).toBe(8);
  });

  it('byNeighborhood keys are sorted whatever the insertion order', () => {
    const z = parcel('4000001', 0, 'Zeta');
    const a = parcel('4000002', 0, 'Alpha');
    const acc = createScoreAccumulator(ONE);
    acc.set(z, building(z, 1, true));
    acc.set(a, building(a, 1, true));
    expect(Object.keys(acc.snapshot().byNeighborhood)).toEqual(['Alpha', 'Zeta']);
    expect(JSON.stringify(acc.snapshot())).toBe(
      JSON.stringify(
        score(
          [
            [a, building(a, 1, true)],
            [z, building(z, 1, true)]
          ],
          ONE
        )
      )
    );
  });
});
```

- [ ] **Step 3: Write the failing property test** `src/lib/scoreboard/accumulator.property.spec.ts`

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import { createScoreAccumulator, score } from './accumulator';
import { M1_TARGETS } from './targets';
import { building, parcel } from './score-fixtures';

const N = 500;
const HOODS = ['Mission', 'Sunset', 'Bayview', '', 'Richmond', 'Noe Valley', '__proto__'];
const PARCELS: ParcelRecord[] = Array.from({ length: N }, (_, i) =>
  parcel(String(5_000_000 + i), i % 7, HOODS[i % HOODS.length])
);

// An op sets parcel `idx` to a building (units, replacesExisting) or to null.
const opArb = fc.record({
  idx: fc.integer({ min: 0, max: N - 1 }),
  b: fc.option(fc.record({ units: fc.integer({ min: 1, max: 400 }), repl: fc.boolean() }), {
    nil: null
  })
});

function toBuilding(p: ParcelRecord, b: { units: number; repl: boolean } | null) {
  return b ? building(p, b.units, b.repl) : null;
}

describe('accumulator property (spec §6)', () => {
  it('incremental snapshot deep-equals a from-scratch recompute', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 1500 }), (ops) => {
        const acc = createScoreAccumulator(M1_TARGETS);
        const state = new Map<string, [ParcelRecord, GeneratedBuilding]>();
        for (const { idx, b } of ops) {
          const p = PARCELS[idx];
          const g = toBuilding(p, b);
          acc.set(p, g);
          if (g) state.set(p.id, [p, g]);
          else state.delete(p.id);
        }
        const full = score(state.values(), M1_TARGETS);
        expect(acc.snapshot()).toEqual(full);
        expect(JSON.stringify(acc.snapshot())).toBe(JSON.stringify(full));
      }),
      { numRuns: 100 }
    );
  });

  it('is invariant to the order of updates', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(opArb, { selector: (o) => o.idx, maxLength: N }),
        fc.integer(),
        (ops, seed) => {
          const forward = createScoreAccumulator(M1_TARGETS);
          for (const { idx, b } of ops) forward.set(PARCELS[idx], toBuilding(PARCELS[idx], b));
          const shuffled = fc.sample(fc.shuffledSubarray(ops, { minLength: ops.length }), {
            seed,
            numRuns: 1
          })[0];
          const other = createScoreAccumulator(M1_TARGETS);
          for (const { idx, b } of shuffled) other.set(PARCELS[idx], toBuilding(PARCELS[idx], b));
          expect(JSON.stringify(other.snapshot())).toBe(JSON.stringify(forward.snapshot()));
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

- [ ] **Step 4: Run both tests and confirm they fail**

Run: `npx vitest --run --project server src/lib/scoreboard/accumulator`
Expected: FAIL, because `./accumulator` cannot be resolved.

- [ ] **Step 5: Write `src/lib/scoreboard/accumulator.ts`**

```ts
// Spec §4.1 / §4.3. Pure TS, no DOM. Called by brush-tool's worker host (I15).
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import type { Score, Target } from './types';

export const UNASSIGNED = 'Unassigned';

export interface Contribution {
  gross: number;
  demolished: number;
  neighborhood: string;
}

export interface ScoreAccumulator {
  /** Replaces the parcel's prior contribution. `null` removes it. O(1). */
  set(parcel: ParcelRecord, building: GeneratedBuilding | null): void;
  clear(): void;
  /** A fresh I11 `Score`; later `set` calls do not affect it. */
  snapshot(): Score;
}

function contributionOf(p: ParcelRecord, b: GeneratedBuilding | null): Contribution | null {
  if (!b) return null;
  return {
    gross: b.units,
    demolished: b.replacesExisting ? p.existingUnits : 0,
    neighborhood: p.neighborhood.trim() === '' ? UNASSIGNED : p.neighborhood
  };
}

interface Hood {
  net: number;
  count: number;
}

function buildScore(
  grossUnits: number,
  demolishedUnits: number,
  parcelsChanged: number,
  hoods: ReadonlyMap<string, Hood>,
  targets: readonly Target[]
): Score {
  const netUnits = grossUnits - demolishedUnits;
  const names = [...hoods.keys()].sort();
  return {
    grossUnits,
    demolishedUnits,
    netUnits,
    targets: targets.map((target) => ({ target, fraction: netUnits / target.units })),
    parcelsChanged,
    byNeighborhood: Object.fromEntries(names.map((n) => [n, hoods.get(n)!.net]))
  };
}

export function createScoreAccumulator(targets: readonly Target[]): ScoreAccumulator {
  const byParcel = new Map<ParcelId, Contribution>();
  const hoods = new Map<string, Hood>();
  let gross = 0;
  let demolished = 0;

  function apply(c: Contribution, sign: 1 | -1): void {
    gross += sign * c.gross;
    demolished += sign * c.demolished;
    const h = hoods.get(c.neighborhood) ?? { net: 0, count: 0 };
    h.net += sign * (c.gross - c.demolished);
    h.count += sign;
    if (h.count === 0) hoods.delete(c.neighborhood);
    else hoods.set(c.neighborhood, h);
  }

  return {
    set(parcel, building) {
      const prev = byParcel.get(parcel.id);
      if (prev) apply(prev, -1);
      const next = contributionOf(parcel, building);
      if (next) {
        apply(next, 1);
        byParcel.set(parcel.id, next);
      } else {
        byParcel.delete(parcel.id);
      }
    },
    clear() {
      byParcel.clear();
      hoods.clear();
      gross = 0;
      demolished = 0;
    },
    snapshot() {
      return buildScore(gross, demolished, byParcel.size, hoods, targets);
    }
  };
}

/**
 * Pure, non-incremental score (the `score()` I15's worker host calls). Must equal an
 * accumulator's snapshot after the same `set` sequence. A parcel id that repeats takes
 * its last entry.
 */
export function score(
  entries: Iterable<[ParcelRecord, GeneratedBuilding]>,
  targets: readonly Target[]
): Score {
  const byParcel = new Map<ParcelId, Contribution>();
  for (const [p, b] of entries) {
    const c = contributionOf(p, b);
    if (c) byParcel.set(p.id, c);
    else byParcel.delete(p.id);
  }
  let gross = 0;
  let demolished = 0;
  const hoods = new Map<string, Hood>();
  for (const c of byParcel.values()) {
    gross += c.gross;
    demolished += c.demolished;
    const h = hoods.get(c.neighborhood);
    if (h) {
      h.net += c.gross - c.demolished;
      h.count += 1;
    } else {
      hoods.set(c.neighborhood, { net: c.gross - c.demolished, count: 1 });
    }
  }
  return buildScore(gross, demolished, byParcel.size, hoods, targets);
}
```

Note: if ESLint rejects the non-null assertion in `buildScore`, iterate `[...hoods.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))` instead. Keep the code-unit order.

- [ ] **Step 6: Append to `src/lib/scoreboard/index.ts`**

```ts
export { createScoreAccumulator, score, UNASSIGNED } from './accumulator';
export type { Contribution, ScoreAccumulator } from './accumulator';
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest --run --project server src/lib/scoreboard`
Expected: PASS for all scoreboard specs (targets, format, accumulator, property).

- [ ] **Step 8: Typecheck, lint and commit**

Run: `npm run check` (expect 0 errors in `src/lib/scoreboard`), then `npx prettier --write src/lib/scoreboard && npx eslint src/lib/scoreboard`.

```bash
git add src/lib/scoreboard
git commit -m "feat(scoreboard): incremental accumulator and pure score()"
```

---

## Stage 1 acceptance (spec §7, core-applicable)

- §7.1: `Score` matches I11 exactly (Task 1 `types.ts`), and the §4.1 formulas hold on every fixture (Task 3).
- §7.2, core half: no percent is clamped (Task 2 `200%` / `1,234%` tests), and no fraction is clamped (Task 3 `2.0` and negative tests). The bar half is stage 2.
- §7.6: incremental equals full recompute (Task 3 property test).
- §7.3, §7.4, §7.5, §7.7 and §7.8 are UI concerns, deferred to stage 2.
