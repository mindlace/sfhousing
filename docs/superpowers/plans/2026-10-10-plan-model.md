# plan-model (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/lib/plan/`, the pure-TypeScript plan domain core: geometry and coverage, a chunked `ParcelIndex` over parcel label points, `resolveEnvelopes` plus its incremental forms, and plan validation, canonical (de)serialization, schema migration and rebasing.

**Architecture:** Five focused modules under `src/lib/plan/` (`constants`, `geometry`, `parcel-index`, `resolve`, `schema`) plus a barrel `index.ts`. Coverage runs in a fixed equirectangular metre plane with literal constants and only `+ − × ÷` (no trig), so results are bit-identical on every engine. `ParcelIndex` keeps one static `kdbush` tree per loaded chunk; every output is sorted by `ParcelId` (JS `<`) so nothing depends on chunk load order.

**Tech Stack:** TypeScript (strict), `kdbush@^4.1.0` (the only runtime dependency), Vitest 4 server project (Node), fast-check 4.

**Spec:** `docs/superpowers/specs/2026-10-10-plan-model-design.md` (design context: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`). Read the spec before each task; this plan argues from it.

**Worktree:** `/Users/mindlace/Projects/sfhousing/.claude/worktrees/plan-model`, branch `plan-model`, based on `9a4d100` (integration branch `superconductor/sf-housing-sim`). All paths below are relative to it. Never `cd dir && cmd` in one Bash call: `cd` in its own call, or use absolute paths.

## Global Constraints

Verbatim from spec §3:

- **Free and open source.** No paid APIs and no vendor keys are needed to run or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1: *theoretical max buildout*). Net counts are shown, not gross. Sources and vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era laptop. Generated buildings appear within 150 ms of pointer-up for strokes covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within 5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works at 375 px.
- **Data is static and versioned.** The worker does no geo computation at runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all work, bare-name Cloudflare resources (`sfhousing`), and the migration workflow via Drizzle.

Interface rows (verbatim, spec §2):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I2 | `interface Envelope { maxStories: number }` — the per-parcel allowed envelope. The **only** thing manipulation writes. Later milestones add optional fields; M1 code must ignore unknown fields | plan-model → generator, scoreboard | MC (envelope-as-common-currency), DC (field set) |
| I3 | (type lives in plan-model's module; brush-tool produces it) `type PlanOp = BrushStroke` where `type BrushStroke = { kind: 'paint'; stories: number /* integer 1..80 */; radiusM: number /* 5..500 */; path: [lng: number, lat: number][]; id: string } \| { kind: 'erase'; radiusM: number; path: [lng: number, lat: number][]; id: string }`. The union widens in later milestones (`AreaOp`, `PolicyOp`) | brush-tool → plan-model | DC |
| I4 | `interface Plan { schema: 1; datasetVersion: string; ops: PlanOp[]; title?: string }` | plan-model → brush-tool, plan-sharing | DC |
| I5 | `resolveEnvelopes(plan: Plan, index: ParcelIndex): Map<ParcelId, Envelope>`. Ops apply in order and later ops win. A parcel is covered by a stroke iff its label point is within `radiusM` of the stroke polyline. `erase` deletes the entry. Ineligible parcels never get an entry | plan-model → generator | DC |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I12 | (excerpt) `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. Every eligible-or-not parcel appears in **exactly one** chunk | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |

Project and conductor rules:

- `src/lib/plan/types.ts` already exists (I2–I4, verbatim). **Do not change those shapes.** typology-generator imports `Envelope` from it.
- `src/lib/data/parcel.ts` (I1/I6) and `src/lib/data/manifest.ts` are owned by data-pipeline. **Import only; never edit anything under `src/lib/data/`, `src/lib/generator/` or `pipeline/`.** Import `ParcelId`/`ParcelRecord` with `import type`, and only `DATASET_VERSION_RE` (by value) from `../data/manifest`.
- Inside `src/lib/plan/` use relative imports only (no `$lib`, `$app`, `$env`). The module must import cleanly in Node and in a web worker: no DOM, MapLibre, deck.gl, `localStorage`.
- Runtime code under `src/lib/plan/` must not use `Math.cos`, `Math.sin`, `Math.hypot`, `Math.random`, `Date`, or `localeCompare`. Sort ids with `compareIds` (JS `<`).
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Run `npx prettier --write <files>` before committing.
- Vitest runs with `expect.requireAssertions`: every test must call `expect`. Property tests use fast-check with `{ numRuns: 200, seed: 20261010 }` (fixed seed always).
- Run tests with `npx vitest run --project server src/lib/plan` (whole module) or a single file path.
- Commits: Conventional Commits, each message ending with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Use `git commit -m "subject" -m "Co-Authored-By: ..."` (no heredocs).

## Review Focus

Inputs the spec implies but does not test directly; each has a pinning test in the named task.

1. **The worker host re-sends a chunk it already loaded** (retry, race). Expect `addChunk` to return `[]` and leave the index unchanged, not double-count. (Task 2)
2. **A parcel id appears in two chunks** (pipeline bug). Identical records: keep the first silently. Differing records: throw in dev builds. Duplicates within one chunk follow the same rule. (Task 2)
3. **Ids of different lengths** (`"99"` vs `"100"`, real mapblklot ids include letters like `"3512008A"`). Expect every output ordered by JS string `<`, never numerically, in `covered`, `applyOp` changes, and `resolveEnvelopes` iteration. (Tasks 2, 3)
4. **Hostile or huge plan input** (a pasted file with 1,000,000 ops, or a 100,000-point path). Expect a fast `too-many-ops` / `too-many-points` rejection without validating each element. (Task 4)
5. **Wrong JSON types where a value is expected** (`"stories": "5"`, `"title": null`, `"path": "x"`, root `[]` or `"str"` or `null`, a non-integer `schema` like `"1"`). Expect a clean rejection with a JSON-pointer path, never a thrown exception. (Task 4)

**Resolved spec silences (local choices, consistent with the §4.6 table's split between type errors and range errors):** a value of the wrong JSON type (non-number `radiusM`, non-array `path`, a point that is not a 2-tuple of numbers, an empty `path`, a non-string `title`) reports `bad-field`; a value of the right type outside its range reports `out-of-bounds` / `too-many-*`. When `schema` is missing, future or unknown, validation stops there and returns just that one error (nothing else is interpretable). When `ops` exceeds `OPS_MAX`, per-op validation is skipped. `title` length counts UTF-16 code units (`String.length`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/plan/types.ts` | Existing seam (I2–I4). Unchanged. |
| `src/lib/plan/constants.ts` | Bounds and schema constants (`STORIES_MIN` … `CURRENT_SCHEMA`, `SF_BBOX`, `TITLE_MAX_CHARS`). |
| `src/lib/plan/geometry.ts` | `XY`, `BBox`, `XYBox`, projection constants, `project`, `projectPath`, `segDist2`, `pathCovers`, `opPath`, `opXYBox`, `opBBox`, box helpers, `compareIds`, `assertNever`. |
| `src/lib/plan/parcel-index.ts` | `ParcelIndex`, `createParcelIndex` (one kdbush per chunk). |
| `src/lib/plan/resolve.ts` | `EnvelopeMap`, `EnvelopeChange`, `OpCoverage`, `resolveEnvelopes`, `applyOp`, `resolveParcels`, `resolveChunk`. |
| `src/lib/plan/schema.ts` | `PlanError*`, `Result`, `quantize`, `MIGRATIONS`, `runMigrations`, `validatePlan`, `parsePlan`, `serializePlan`, `planByteSize`, `rebasePlan`, `emptyPlan`, `FUTURE_SCHEMA_MESSAGE`. |
| `src/lib/plan/index.ts` | Barrel: the public surface. |
| `src/lib/plan/fixtures/edge-cases.ts` | XY coverage boundary cases. |
| `src/lib/plan/fixtures/grid-20x20.ts` | 400 parcels on a 10 m grid in the Mission, 4 chunks, every 7th ineligible. |
| `src/lib/plan/fixtures/reference.ts` | Brute-force O(n·m) reference coverage and resolve (test-only). |
| `src/lib/plan/fixtures/arbitraries.ts` | fast-check arbitraries for ops/plans (test-only). |
| `src/lib/plan/fixtures/plans/*.json` | Plan fixtures. |
| `src/lib/plan/fixtures/golden/*.json` + `generate.ts` | Expected `[ParcelId, maxStories][]` per valid plan, generated from the reference. |
| `src/lib/plan/*.spec.ts` | Colocated tests. `resolve.bench.spec.ts` holds the perf budgets. |
| `package.json`, `package-lock.json` | Add `kdbush`. |
| `src/lib/attribution.ts` | Credit kdbush in `SOFTWARE`. |

Note on the benchmark filename: the spec names `resolve.bench.ts`. Vitest's `bench` mode reports but never fails on a budget, and the server project's include glob is `src/**/*.{test,spec}.ts`. So the budgets live in `resolve.bench.spec.ts` as ordinary assertions, which CI's `npm run test:unit` already runs and fails on.

---

### Task 1: Constants, geometry and purity guard

**Files:**
- Modify: `package.json`, `package-lock.json` (add `kdbush`), `src/lib/attribution.ts` (credit)
- Create: `src/lib/plan/constants.ts`, `src/lib/plan/geometry.ts`, `src/lib/plan/fixtures/edge-cases.ts`
- Test: `src/lib/plan/geometry.spec.ts`, `src/lib/plan/purity.spec.ts`

**Interfaces:**
- Consumes: `PlanOp` from `./types`.
- Produces (exact):
  - `constants.ts`: `STORIES_MIN = 1`, `STORIES_MAX = 80`, `RADIUS_MIN_M = 5`, `RADIUS_MAX_M = 500`, `PATH_MAX_POINTS = 2000`, `OPS_MAX = 5000`, `MAX_PLAN_BYTES = 262_144`, `TITLE_MAX_CHARS = 120`, `SF_BBOX: BBox = [-123.1738, 37.604, -122.2818, 37.9298]`, `CURRENT_SCHEMA = 1 as const`.
  - `geometry.ts`: `type XY = [x: number, y: number]`; `type BBox = [minLng, minLat, maxLng, maxLat]`; `type XYBox = [minX, minY, maxX, maxY]`; `LNG0`, `LAT0`, `M_PER_DEG_LNG`, `M_PER_DEG_LAT`, `CANDIDATE_PAD_M`; `project(lng, lat): XY`; `projectPath(path: readonly [number, number][]): XY[]`; `segDist2(l: XY, a: XY, b: XY): number`; `pathCovers(path: readonly XY[], r2: number, l: XY): boolean`; `segmentBoxes(path: readonly XY[], grow: number): XYBox[]`; `pathBox(path: readonly XY[], grow: number): XYBox`; `boxesIntersect(a: XYBox, b: XYBox): boolean`; `pointInBox(p: XY, b: XYBox): boolean`; `opPath(op: PlanOp): XY[]`; `opXYBox(op: PlanOp): XYBox`; `opBBox(op: PlanOp): BBox`; `compareIds(a: string, b: string): number`; `assertNever(x: never): never`.

- [ ] **Step 1: Add the dependency and the credit**

Run: `npm install kdbush@^4.1.0`
Expected: `package.json` `dependencies` gains `"kdbush": "^4.1.0"`; lockfile updated.

In `src/lib/attribution.ts`, append to the `SOFTWARE` array (after the SvelteKit entry):

```ts
  { name: 'kdbush', license: 'ISC', url: 'https://github.com/mourner/kdbush' }
```

- [ ] **Step 2: Write the failing tests**

`src/lib/plan/fixtures/edge-cases.ts`:

```ts
import type { XY } from '../geometry';

export interface CoverCase {
  name: string;
  path: XY[];
  r: number;
  l: XY;
  covered: boolean;
}

// All values are exactly representable or chosen so the squared comparison is exact.
export const COVER_CASES: CoverCase[] = [
  { name: 'segment interior at exactly r', path: [[0, 0], [20, 0]], r: 10, l: [10, 10], covered: true },
  { name: 'segment interior at r + 1e-6', path: [[0, 0], [20, 0]], r: 10, l: [10, 10 + 1e-6], covered: false },
  { name: 'segment interior at r - 1e-6', path: [[0, 0], [20, 0]], r: 10, l: [10, 10 - 1e-6], covered: true },
  { name: 'beyond B clamps to B, exactly r', path: [[0, 0], [20, 0]], r: 10, l: [26, 8], covered: true },
  { name: 'beyond B clamps to B, r + 1e-6', path: [[0, 0], [20, 0]], r: 10, l: [26, 8 + 1e-6], covered: false },
  { name: 'beyond A clamps to A, exactly r', path: [[0, 0], [20, 0]], r: 10, l: [-6, -8], covered: true },
  { name: 'on endpoint A', path: [[0, 0], [20, 0]], r: 5, l: [0, 0], covered: true },
  { name: 'on endpoint B', path: [[0, 0], [20, 0]], r: 5, l: [20, 0], covered: true },
  { name: 'one-point path is a disc, exactly r', path: [[5, 5]], r: 5, l: [8, 9], covered: true },
  { name: 'one-point path is a disc, r + 1e-6', path: [[5, 5]], r: 5, l: [8, 9 + 1e-6], covered: false },
  { name: 'zero-length segment is a disc', path: [[5, 5], [5, 5]], r: 5, l: [8, 9], covered: true },
  { name: 'beside a zero-length middle segment', path: [[0, 0], [0, 0], [10, 0]], r: 1, l: [5, 1], covered: true },
  { name: 'far from every segment', path: [[0, 0], [10, 0], [10, 10]], r: 1, l: [5, 5], covered: false }
];
```

`src/lib/plan/geometry.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_PAD_M,
  LAT0,
  LNG0,
  M_PER_DEG_LAT,
  M_PER_DEG_LNG,
  boxesIntersect,
  compareIds,
  opBBox,
  opXYBox,
  pathCovers,
  pointInBox,
  project,
  segDist2,
  segmentBoxes
} from './geometry';
import { COVER_CASES } from './fixtures/edge-cases';
import type { PlanOp } from './types';

describe('project', () => {
  it('uses the literal constants', () => {
    expect(LNG0).toBe(-122.4431);
    expect(LAT0).toBe(37.7562);
    expect(M_PER_DEG_LNG).toBe(87913.423594147971);
    expect(M_PER_DEG_LAT).toBe(111195.08023353292);
  });

  it('is (lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT', () => {
    expect(project(LNG0, LAT0)).toEqual([0, 0]);
    for (const [lng, lat] of [
      [-122.4194, 37.7599],
      [-123.1738, 37.604],
      [-122.2818, 37.9298]
    ]) {
      expect(project(lng, lat)).toEqual([
        (lng - -122.4431) * 87913.423594147971,
        (lat - 37.7562) * 111195.08023353292
      ]);
    }
  });

  it('is metre-scale', () => {
    expect(project(LNG0, LAT0 + 0.001)[1]).toBeCloseTo(111.195, 3);
  });
});

describe('segDist2', () => {
  it('matches the perpendicular distance for interior points', () => {
    // segment (0,0)-(30,40): length 50; point (40,-30) is perpendicular to it at A, distance 50
    expect(segDist2([40, -30], [0, 0], [30, 40])).toBeCloseTo(2500, 9);
    // interior point: (15,20) + 10*(0.8,-0.6) = (23,14)
    expect(segDist2([23, 14], [0, 0], [30, 40])).toBeCloseTo(100, 9);
  });

  it('treats a zero-length segment as a point', () => {
    expect(segDist2([3, 4], [0, 0], [0, 0])).toBe(25);
  });
});

describe('pathCovers', () => {
  for (const c of COVER_CASES) {
    it(c.name, () => {
      expect(pathCovers(c.path, c.r * c.r, c.l)).toBe(c.covered);
    });
  }
});

describe('boxes', () => {
  it('segmentBoxes gives one box per segment, or one for a single point', () => {
    expect(segmentBoxes([[0, 0]], 2)).toEqual([[-2, -2, 2, 2]]);
    expect(
      segmentBoxes(
        [
          [0, 0],
          [10, 0],
          [10, 5]
        ],
        1
      )
    ).toEqual([
      [-1, -1, 11, 1],
      [9, -1, 11, 6]
    ]);
  });

  it('intersection and containment are inclusive', () => {
    expect(boxesIntersect([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true);
    expect(boxesIntersect([0, 0, 1, 1], [1.0001, 0, 2, 1])).toBe(false);
    expect(pointInBox([1, 1], [0, 0, 1, 1])).toBe(true);
    expect(pointInBox([1, 1.0001], [0, 0, 1, 1])).toBe(false);
  });
});

describe('opBBox / opXYBox', () => {
  const op: PlanOp = {
    kind: 'paint',
    id: 'a',
    stories: 3,
    radiusM: 100,
    path: [
      [-122.42, 37.76],
      [-122.41, 37.77]
    ]
  };

  it('grows the lng/lat path bbox by radiusM (plus the candidate pad) in degrees', () => {
    const g = 100 + CANDIDATE_PAD_M;
    const [minLng, minLat, maxLng, maxLat] = opBBox(op);
    expect(minLng).toBeCloseTo(-122.42 - g / M_PER_DEG_LNG, 12);
    expect(minLat).toBeCloseTo(37.76 - g / M_PER_DEG_LAT, 12);
    expect(maxLng).toBeCloseTo(-122.41 + g / M_PER_DEG_LNG, 12);
    expect(maxLat).toBeCloseTo(37.77 + g / M_PER_DEG_LAT, 12);
  });

  it('opXYBox is the projected path bbox grown by radiusM plus the pad', () => {
    const [a, b] = [project(-122.42, 37.76), project(-122.41, 37.77)];
    const g = 100 + CANDIDATE_PAD_M;
    expect(opXYBox(op)).toEqual([a[0] - g, a[1] - g, b[0] + g, b[1] + g]);
  });

  it('erase ops work the same way', () => {
    const erase: PlanOp = { kind: 'erase', id: 'e', radiusM: 5, path: [[-122.42, 37.76]] };
    expect(opBBox(erase)[0]).toBeLessThan(-122.42);
  });
});

describe('compareIds', () => {
  it('orders by JS string <, not numerically', () => {
    expect(['100', '99', '3512008A', '3512008'].sort(compareIds)).toEqual([
      '100',
      '3512008',
      '3512008A',
      '99'
    ]);
  });
});
```

`src/lib/plan/purity.spec.ts` (scans source text; it builds the forbidden names from pieces so it does not match itself):

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src/lib/plan');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const all = walk(ROOT);
const runtime = all.filter(
  (p) => !p.endsWith('.spec.ts') && !relative(ROOT, p).startsWith('fixtures')
);

describe('src/lib/plan purity', () => {
  it('has no trig anywhere (spec §4.1, acceptance 7)', () => {
    const trig = new RegExp(['Math\\.co', 's|Math\\.si', 'n|Math\\.hyp', 'ot'].join(''));
    const self = join(ROOT, 'purity.spec.ts');
    const offenders = all.filter((p) => p !== self && trig.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('runtime code avoids nondeterministic APIs (spec §4.10)', () => {
    const bad = /Math\.random|\bDate\b|localeCompare/;
    expect(runtime.filter((p) => bad.test(readFileSync(p, 'utf8')))).toEqual([]);
  });

  it('runtime code imports only kdbush, siblings, I6 types and DATASET_VERSION_RE (acceptance 1)', () => {
    const problems: string[] = [];
    for (const p of runtime) {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)';/gms)) {
        const [, typeOnly, what, spec] = m;
        const ok =
          spec === 'kdbush' ||
          (spec.startsWith('./') && !spec.includes('fixtures')) ||
          (spec === '../data/parcel' && typeOnly) ||
          (spec === '../data/manifest' && what.trim() === '{ DATASET_VERSION_RE }');
        if (!ok) problems.push(`${relative(ROOT, p)}: ${m[0]}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --project server src/lib/plan`
Expected: FAIL — `./geometry` cannot be resolved.

- [ ] **Step 4: Implement `constants.ts` and `geometry.ts`**

`src/lib/plan/constants.ts`:

```ts
import type { BBox } from './geometry';

export const STORIES_MIN = 1;
export const STORIES_MAX = 80; // I3
export const RADIUS_MIN_M = 5;
export const RADIUS_MAX_M = 500;
export const PATH_MAX_POINTS = 2000;
export const OPS_MAX = 5000;
export const MAX_PLAN_BYTES = 262_144; // I13's 256 KB, as UTF-8 bytes of serializePlan()
export const TITLE_MAX_CHARS = 120;
/** Includes the Farallones and Treasure Island. */
export const SF_BBOX: BBox = [-123.1738, 37.604, -122.2818, 37.9298];
export const CURRENT_SCHEMA = 1 as const;
```

`src/lib/plan/geometry.ts`:

```ts
import type { PlanOp } from './types';

/** Metres in the plan-model plane (spec §4.1). */
export type XY = [x: number, y: number];
export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];
export type XYBox = [minX: number, minY: number, maxX: number, maxY: number];

// Equirectangular about φ₀ = 37.7562°, mean Earth radius 6,371,008.8 m. Literals: never compute
// these at runtime (no trig — ECMAScript trig is not bit-identical across engines).
export const LNG0 = -122.4431;
export const LAT0 = 37.7562;
export const M_PER_DEG_LNG = 87913.423594147971;
export const M_PER_DEG_LAT = 111195.08023353292;

/**
 * Extra growth for candidate boxes only. The exact squared-distance test decides coverage; the pad
 * just guarantees rounding in the interpolated foot point can never drop a true candidate.
 */
export const CANDIDATE_PAD_M = 1e-3;

export function project(lng: number, lat: number): XY {
  return [(lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT];
}

export function projectPath(path: readonly (readonly [number, number])[]): XY[] {
  return path.map(([lng, lat]) => project(lng, lat));
}

/** Squared distance from L to segment AB. Evaluation order is fixed by spec §4.2. */
export function segDist2(l: XY, a: XY, b: XY): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((l[0] - a[0]) * abx + (l[1] - a[1]) * aby) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = a[0] + t * abx;
  const py = a[1] + t * aby;
  const dx = l[0] - px;
  const dy = l[1] - py;
  return dx * dx + dy * dy;
}

/** Inclusive: covered iff some segment (or the single point) is within r (r2 = r * r). */
export function pathCovers(path: readonly XY[], r2: number, l: XY): boolean {
  if (path.length === 1) return segDist2(l, path[0], path[0]) <= r2;
  for (let i = 1; i < path.length; i++) {
    if (segDist2(l, path[i - 1], path[i]) <= r2) return true;
  }
  return false;
}

export function segmentBoxes(path: readonly XY[], grow: number): XYBox[] {
  if (path.length === 1) {
    const [x, y] = path[0];
    return [[x - grow, y - grow, x + grow, y + grow]];
  }
  const out: XYBox[] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    out.push([
      (ax < bx ? ax : bx) - grow,
      (ay < by ? ay : by) - grow,
      (ax > bx ? ax : bx) + grow,
      (ay > by ? ay : by) + grow
    ]);
  }
  return out;
}

export function pathBox(path: readonly XY[], grow: number): XYBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of path) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX - grow, minY - grow, maxX + grow, maxY + grow];
}

export function boxesIntersect(a: XYBox, b: XYBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function pointInBox(p: XY, b: XYBox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

export function assertNever(x: never): never {
  throw new Error(`Unhandled plan op: ${JSON.stringify(x)}`);
}

/** The projected path of an op. Exhaustive over PlanOp kinds (seam for AreaOp, spec §5). */
export function opPath(op: PlanOp): XY[] {
  switch (op.kind) {
    case 'paint':
    case 'erase':
      return projectPath(op.path);
    default:
      return assertNever(op);
  }
}

/** Projected op bbox, grown by radiusM plus CANDIDATE_PAD_M. */
export function opXYBox(op: PlanOp): XYBox {
  switch (op.kind) {
    case 'paint':
    case 'erase':
      return pathBox(opPath(op), op.radiusM + CANDIDATE_PAD_M);
    default:
      return assertNever(op);
  }
}

/** Path bbox in lng/lat grown by radiusM (plus the pad); used to pick which chunks to load. */
export function opBBox(op: PlanOp): BBox {
  switch (op.kind) {
    case 'paint':
    case 'erase': {
      const g = op.radiusM + CANDIDATE_PAD_M;
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const [lng, lat] of op.path) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      const dLng = g / M_PER_DEG_LNG;
      const dLat = g / M_PER_DEG_LAT;
      return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
    }
    default:
      return assertNever(op);
  }
}

/** ParcelId order: JS string `<` (never locale, never numeric). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project server src/lib/plan`
Expected: PASS (geometry.spec.ts, purity.spec.ts).

- [ ] **Step 6: Format, typecheck, commit**

```bash
npx prettier --write src/lib/plan src/lib/attribution.ts
npm run check
git add package.json package-lock.json src/lib/attribution.ts src/lib/plan
git commit -m "feat(plan): projection, coverage geometry and purity guard" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

`npm run check` must report 0 errors (if it flags pre-existing errors outside `src/lib/plan`, note them and continue).

---

### Task 2: ParcelIndex

**Files:**
- Create: `src/lib/plan/parcel-index.ts`, `src/lib/plan/fixtures/grid-20x20.ts`, `src/lib/plan/fixtures/reference.ts`, `src/lib/plan/fixtures/arbitraries.ts`
- Test: `src/lib/plan/parcel-index.spec.ts`

**Interfaces:**
- Consumes: from `./geometry`: `XY`, `XYBox`, `project`, `opPath`, `segDist2`, `segmentBoxes`, `boxesIntersect`, `compareIds`, `CANDIDATE_PAD_M`, `pathCovers`, `projectPath`; `ParcelId`, `ParcelRecord` (type-only) from `../data/parcel`; `PlanOp` from `./types`.
- Produces:
  ```ts
  export interface ParcelIndex {
    addChunk(cellId: string, records: ParcelRecord[]): ParcelId[]; // ids it added
    hasChunk(cellId: string): boolean;
    get(id: ParcelId): ParcelRecord | undefined;
    covered(op: PlanOp): ParcelId[]; // loaded parcels covered by op, eligible or not; ascending id
    readonly size: number;
  }
  export function createParcelIndex(): ParcelIndex;
  ```
  Fixtures: `GRID_ORIGIN`, `GRID_N = 20`, `gridLngLat(i, j)`, `gridId(i, j)`, `gridRecord(i, j)`, `GRID_CHUNKS: { cellId: string; records: ParcelRecord[] }[]`, `GRID_RECORDS`, `gridIndex(order?: number[]): ParcelIndex`. Reference: `bruteForceCovered(op, records): ParcelId[]`, `bruteForceResolve(plan, records): [ParcelId, number][]`. Arbitraries: `arbGridOp: fc.Arbitrary<PlanOp>` (id `'x'`), `arbGridOps(maxLen): fc.Arbitrary<PlanOp[]>` (unique ids `o0`, `o1`, …).

- [ ] **Step 1: Write the fixtures**

`src/lib/plan/fixtures/grid-20x20.ts`:

```ts
import type { ParcelRecord } from '../../data/parcel';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '../geometry';
import { createParcelIndex, type ParcelIndex } from '../parcel-index';

/** 20×20 label points on a 10 m grid from a fixed origin in the Mission (spec §6). */
export const GRID_ORIGIN: [lng: number, lat: number] = [-122.4194, 37.7599];
export const GRID_N = 20;
const STEP_M = 10;

export function gridLngLat(i: number, j: number): [number, number] {
  return [
    GRID_ORIGIN[0] + (i * STEP_M) / M_PER_DEG_LNG,
    GRID_ORIGIN[1] + (j * STEP_M) / M_PER_DEG_LAT
  ];
}

/** Row-major, so ascending id order is row-major order. */
export function gridId(i: number, j: number): string {
  return String(3600000 + j * GRID_N + i);
}

export function gridRecord(i: number, j: number): ParcelRecord {
  const n = j * GRID_N + i;
  return {
    id: gridId(i, j),
    polygon: [
      [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
        [-5, -5]
      ]
    ],
    labelPoint: gridLngLat(i, j),
    areaM2: 100,
    existingUnits: 1,
    existingFloorAreaM2: 100,
    existingHeightM: 6,
    landUse: 'RESIDENT',
    eligible: n % 7 !== 0, // every 7th parcel is ineligible
    neighborhood: 'Mission'
  };
}

function quadrant(qi: number, qj: number): ParcelRecord[] {
  const out: ParcelRecord[] = [];
  for (let j = qj * 10; j < qj * 10 + 10; j++) {
    for (let i = qi * 10; i < qi * 10 + 10; i++) out.push(gridRecord(i, j));
  }
  return out;
}

export const GRID_CHUNKS: { cellId: string; records: ParcelRecord[] }[] = [
  { cellId: 'q00', records: quadrant(0, 0) },
  { cellId: 'q10', records: quadrant(1, 0) },
  { cellId: 'q01', records: quadrant(0, 1) },
  { cellId: 'q11', records: quadrant(1, 1) }
];

export const GRID_RECORDS: ParcelRecord[] = GRID_CHUNKS.flatMap((c) => c.records);

export function gridIndex(order: number[] = [0, 1, 2, 3]): ParcelIndex {
  const index = createParcelIndex();
  for (const k of order) index.addChunk(GRID_CHUNKS[k].cellId, GRID_CHUNKS[k].records);
  return index;
}
```

`src/lib/plan/fixtures/reference.ts`:

```ts
import type { ParcelId, ParcelRecord } from '../../data/parcel';
import { compareIds, pathCovers, project, projectPath } from '../geometry';
import type { Plan, PlanOp } from '../types';

/** O(n·m) reference: tests every record against the op, no index. */
export function bruteForceCovered(op: PlanOp, records: readonly ParcelRecord[]): ParcelId[] {
  const path = projectPath(op.path);
  const r2 = op.radiusM * op.radiusM;
  return records
    .filter((r) => pathCovers(path, r2, project(r.labelPoint[0], r.labelPoint[1])))
    .map((r) => r.id)
    .sort(compareIds);
}

/** Reference resolve: the I5 semantics written as plainly as possible. */
export function bruteForceResolve(plan: Plan, records: readonly ParcelRecord[]): [ParcelId, number][] {
  const state = new Map<ParcelId, number>();
  for (const op of plan.ops) {
    const eligible = new Set(records.filter((r) => r.eligible).map((r) => r.id));
    for (const id of bruteForceCovered(op, records)) {
      if (!eligible.has(id)) continue;
      if (op.kind === 'paint') state.set(id, op.stories);
      else state.delete(id);
    }
  }
  return [...state].sort((a, b) => compareIds(a[0], b[0]));
}
```

`src/lib/plan/fixtures/arbitraries.ts`:

```ts
import fc from 'fast-check';
import type { PlanOp } from '../types';

// Micro-degree integers around the grid (±30 m margin), so k / 1e6 is already quantised.
const lng = fc.integer({ min: -122419700, max: -122416900 }).map((k) => k / 1e6);
const lat = fc.integer({ min: 37759600, max: 37761900 }).map((k) => k / 1e6);
const point = fc.tuple(lng, lat);
const path = fc.array(point, { minLength: 1, maxLength: 4 });
const radiusM = fc.integer({ min: 5, max: 60 });

export const arbGridOp: fc.Arbitrary<PlanOp> = fc.oneof(
  fc.record({
    kind: fc.constant('paint' as const),
    stories: fc.integer({ min: 1, max: 80 }),
    radiusM,
    path,
    id: fc.constant('x')
  }),
  fc.record({ kind: fc.constant('erase' as const), radiusM, path, id: fc.constant('x') })
);

export function arbGridOps(maxLength: number): fc.Arbitrary<PlanOp[]> {
  return fc
    .array(arbGridOp, { minLength: 0, maxLength })
    .map((ops) => ops.map((op, k) => ({ ...op, id: `o${k}` })));
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/plan/parcel-index.spec.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { arbGridOp } from './fixtures/arbitraries';
import {
  GRID_CHUNKS,
  GRID_RECORDS,
  gridId,
  gridIndex,
  gridLngLat,
  gridRecord
} from './fixtures/grid-20x20';
import { bruteForceCovered } from './fixtures/reference';
import { createParcelIndex } from './parcel-index';
import type { PlanOp } from './types';

const FC = { numRuns: 200, seed: 20261010 };
const CENTRE: [number, number] = [-122.418319, 37.760754]; // grid (9.5, 9.5), quantised

function stamp(radiusM: number, at: [number, number] = CENTRE): PlanOp {
  return { kind: 'paint', id: 's', stories: 5, radiusM, path: [at] };
}

describe('addChunk / hasChunk / get / size', () => {
  it('adds a chunk and returns its ids', () => {
    const index = createParcelIndex();
    const ids = index.addChunk('q00', GRID_CHUNKS[0].records);
    expect(ids).toEqual(GRID_CHUNKS[0].records.map((r) => r.id));
    expect(index.hasChunk('q00')).toBe(true);
    expect(index.hasChunk('q10')).toBe(false);
    expect(index.size).toBe(100);
    expect(index.get(gridId(0, 0))).toBe(GRID_CHUNKS[0].records[0]);
    expect(index.get('nope')).toBeUndefined();
  });

  it('re-adding a loaded cellId is a no-op that returns []', () => {
    const index = gridIndex();
    expect(index.addChunk('q00', GRID_CHUNKS[0].records)).toEqual([]);
    expect(index.size).toBe(400);
    expect(index.covered(stamp(25))).toHaveLength(16);
  });

  it('keeps the first copy of an id seen in two chunks when the records are identical', () => {
    const index = createParcelIndex();
    index.addChunk('a', [gridRecord(0, 0), gridRecord(1, 0)]);
    expect(index.addChunk('b', [gridRecord(1, 0), gridRecord(2, 0)])).toEqual([gridId(2, 0)]);
    expect(index.size).toBe(3);
    expect(index.covered(stamp(500))).toEqual([gridId(0, 0), gridId(1, 0), gridId(2, 0)]);
  });

  it('throws in dev builds when a duplicated id carries a different record', () => {
    const index = createParcelIndex();
    index.addChunk('a', [gridRecord(0, 0)]);
    const changed: ParcelRecord = { ...gridRecord(0, 0), existingUnits: 9 };
    expect(() => index.addChunk('b', [changed])).toThrow(/3600000/);
  });

  it('accepts an empty chunk', () => {
    const index = createParcelIndex();
    expect(index.addChunk('empty', [])).toEqual([]);
    expect(index.hasChunk('empty')).toBe(true);
    expect(index.covered(stamp(500))).toEqual([]);
  });
});

describe('covered', () => {
  it('a 25 m stamp at a cell centre covers the 16 nearest label points', () => {
    const ids = gridIndex().covered(stamp(25));
    const expected: string[] = [];
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 20; i++) {
        if ((i - 9.5) ** 2 + (j - 9.5) ** 2 <= 6.25) expected.push(gridId(i, j));
      }
    }
    expect(ids).toEqual(expected.sort());
    expect(ids).toHaveLength(16);
  });

  it('includes ineligible parcels', () => {
    const ids = gridIndex().covered(stamp(5, gridLngLat(7, 0)));
    expect(ids).toEqual([gridId(7, 0)]);
    expect(gridRecord(7, 0).eligible).toBe(false);
  });

  it('covers across chunk boundaries along a polyline', () => {
    const op: PlanOp = {
      kind: 'erase',
      id: 'e',
      radiusM: 4,
      path: [gridLngLat(0, 9), gridLngLat(19, 9)]
    };
    expect(gridIndex().covered(op)).toHaveLength(20);
  });

  it('returns ascending ids whatever the chunk load order', () => {
    const op = stamp(60);
    const a = gridIndex([0, 1, 2, 3]).covered(op);
    const b = gridIndex([3, 1, 0, 2]).covered(op);
    expect(b).toEqual(a);
    expect([...a].sort()).toEqual(a);
  });

  it('orders ids of different lengths by JS string <', () => {
    const index = createParcelIndex();
    const mk = (id: string, i: number): ParcelRecord => ({ ...gridRecord(i, 0), id });
    index.addChunk('a', [mk('99', 0), mk('100', 1), mk('3512008A', 2), mk('3512008', 3)]);
    expect(index.covered(stamp(500))).toEqual(['100', '3512008', '3512008A', '99']);
  });

  it('P5: agrees with the brute-force reference', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(arbGridOp, (op) => {
        expect(index.covered(op)).toEqual(bruteForceCovered(op, GRID_RECORDS));
      }),
      FC
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --project server src/lib/plan/parcel-index.spec.ts`
Expected: FAIL — `../parcel-index` cannot be resolved.

- [ ] **Step 4: Implement `parcel-index.ts`**

```ts
import KDBush from 'kdbush';
import type { ParcelId, ParcelRecord } from '../data/parcel';
import {
  CANDIDATE_PAD_M,
  boxesIntersect,
  compareIds,
  opPath,
  project,
  segDist2,
  segmentBoxes,
  type XY,
  type XYBox
} from './geometry';
import type { PlanOp } from './types';

export interface ParcelIndex {
  /** Returns the ids it added. A cellId already loaded is a no-op returning []. */
  addChunk(cellId: string, records: ParcelRecord[]): ParcelId[];
  hasChunk(cellId: string): boolean;
  get(id: ParcelId): ParcelRecord | undefined;
  /** Every loaded parcel covered by op, eligible or not, in ascending id order. */
  covered(op: PlanOp): ParcelId[];
  readonly size: number;
}

interface Chunk {
  ids: ParcelId[];
  xs: Float64Array;
  ys: Float64Array;
  tree: KDBush | null;
  box: XYBox | null;
}

function isDev(): boolean {
  return import.meta.env?.DEV === true;
}

export function createParcelIndex(): ParcelIndex {
  const chunks = new Map<string, Chunk>();
  const byId = new Map<ParcelId, ParcelRecord>();

  function addChunk(cellId: string, records: ParcelRecord[]): ParcelId[] {
    if (chunks.has(cellId)) return [];
    const accepted: ParcelRecord[] = [];
    for (const r of records) {
      const prev = byId.get(r.id);
      if (prev) {
        // I12: every parcel is in exactly one chunk. Keep the first; flag real conflicts in dev.
        if (isDev() && JSON.stringify(prev) !== JSON.stringify(r)) {
          throw new Error(`Parcel ${r.id} appears in two chunks with different records`);
        }
        continue;
      }
      byId.set(r.id, r);
      accepted.push(r);
    }
    const n = accepted.length;
    const ids = accepted.map((r) => r.id);
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    let tree: KDBush | null = null;
    let box: XYBox | null = null;
    if (n > 0) {
      tree = new KDBush(n);
      box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let k = 0; k < n; k++) {
        const [x, y] = project(accepted[k].labelPoint[0], accepted[k].labelPoint[1]);
        xs[k] = x;
        ys[k] = y;
        tree.add(x, y);
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
      tree.finish();
    }
    chunks.set(cellId, { ids, xs, ys, tree, box });
    return ids;
  }

  function covered(op: PlanOp): ParcelId[] {
    const path = opPath(op);
    const r2 = op.radiusM * op.radiusM;
    const boxes = segmentBoxes(path, op.radiusM + CANDIDATE_PAD_M);
    const out = new Set<ParcelId>();
    for (let s = 0; s < boxes.length; s++) {
      const a = path[s];
      const b = path.length === 1 ? path[0] : path[s + 1];
      const q = boxes[s];
      for (const chunk of chunks.values()) {
        if (!chunk.tree || !chunk.box || !boxesIntersect(chunk.box, q)) continue;
        for (const k of chunk.tree.range(q[0], q[1], q[2], q[3])) {
          const id = chunk.ids[k];
          if (out.has(id)) continue;
          const l: XY = [chunk.xs[k], chunk.ys[k]];
          if (segDist2(l, a, b) <= r2) out.add(id);
        }
      }
    }
    return [...out].sort(compareIds);
  }

  return {
    addChunk,
    hasChunk: (cellId) => chunks.has(cellId),
    get: (id) => byId.get(id),
    covered,
    get size() {
      return byId.size;
    }
  };
}
```

If TypeScript rejects `import.meta.env`, confirm `vite/client` types are in scope via `.svelte-kit/ambient.d.ts`; if not, add `/// <reference types="vite/client" />` at the top of `parcel-index.ts`. If `import.meta.env.DEV` is not `true` under Vitest (the dev-throw test fails), stop and report — do not weaken the test.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project server src/lib/plan`
Expected: PASS (all plan specs, including the purity guard on the new file).

- [ ] **Step 6: Format, typecheck, commit**

```bash
npx prettier --write src/lib/plan
npm run check
git add src/lib/plan
git commit -m "feat(plan): chunked kdbush ParcelIndex with exact capsule coverage" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Resolution (full and incremental) with goldens

**Files:**
- Create: `src/lib/plan/resolve.ts`, `src/lib/plan/fixtures/plans/{empty,single-stamp,paint-then-erase,overlap-lower-wins}.json`, `src/lib/plan/fixtures/golden/generate.ts`, `src/lib/plan/fixtures/golden/{empty,single-stamp,paint-then-erase,overlap-lower-wins}.json`
- Test: `src/lib/plan/resolve.spec.ts`, `src/lib/plan/golden.spec.ts`

**Interfaces:**
- Consumes: `ParcelIndex` (Task 2); `opPath`, `opXYBox`, `pathCovers`, `pointInBox`, `project`, `boxesIntersect`, `compareIds`, `assertNever`, `XY`, `XYBox` (Task 1); `Envelope`, `Plan`, `PlanOp` from `./types`; `ParcelId` (type) from `../data/parcel`.
- Produces:
  ```ts
  export type EnvelopeMap = Map<ParcelId, Envelope>;
  export interface EnvelopeChange { id: ParcelId; before: Envelope | null; after: Envelope | null }
  export interface OpCoverage { eligible: ParcelId[]; ineligible: ParcelId[] }
  export function resolveEnvelopes(plan: Plan, index: ParcelIndex): EnvelopeMap;
  export function applyOp(state: EnvelopeMap, op: PlanOp, index: ParcelIndex): { changes: EnvelopeChange[]; coverage: OpCoverage }; // mutates state
  export function resolveParcels(ops: readonly PlanOp[], index: ParcelIndex, ids: Iterable<ParcelId>): Map<ParcelId, Envelope | null>;
  export function resolveChunk(plan: Plan, index: ParcelIndex, addedIds: ParcelId[]): Map<ParcelId, Envelope | null>;
  ```
  Semantics (spec §4.3–4.4): `resolveEnvelopes` iterates in ascending id order and every Envelope is a fresh frozen `{ maxStories }`. `applyOp` mutates `state` (its iteration order is not guaranteed; equality with a full resolve is by entries). `resolveParcels` / `resolveChunk` return maps in ascending id order, `null` meaning "no entry" (also for ids not loaded or ineligible).

- [ ] **Step 1: Write the plan fixtures (canonical key order)**

Coordinates: grid centre (9.5, 9.5) = `[-122.418319, 37.760754]`; row 5 at i = 2, 7, 12 = `[-122.419173, 37.76035]`, `[-122.418604, 37.76035]`, `[-122.418035, 37.76035]`.

`fixtures/plans/empty.json`:
```json
{ "schema": 1, "datasetVersion": "fixture-0", "ops": [] }
```

`fixtures/plans/single-stamp.json`:
```json
{
  "schema": 1,
  "datasetVersion": "fixture-0",
  "ops": [
    { "id": "a1", "kind": "paint", "stories": 5, "radiusM": 25, "path": [[-122.418319, 37.760754]] }
  ]
}
```

`fixtures/plans/paint-then-erase.json`:
```json
{
  "schema": 1,
  "datasetVersion": "fixture-0",
  "ops": [
    { "id": "p1", "kind": "paint", "stories": 8, "radiusM": 40, "path": [[-122.418319, 37.760754]] },
    { "id": "e1", "kind": "erase", "radiusM": 15, "path": [[-122.418319, 37.760754]] }
  ]
}
```

`fixtures/plans/overlap-lower-wins.json`:
```json
{
  "schema": 1,
  "datasetVersion": "fixture-0",
  "title": "Lower wins",
  "ops": [
    {
      "id": "hi",
      "kind": "paint",
      "stories": 12,
      "radiusM": 30,
      "path": [[-122.419173, 37.76035], [-122.418035, 37.76035]]
    },
    { "id": "lo", "kind": "paint", "stories": 3, "radiusM": 20, "path": [[-122.418604, 37.76035]] }
  ]
}
```

- [ ] **Step 2: Write the golden generator and generate goldens**

`fixtures/golden/generate.ts` (uses the brute-force reference, not the code under test):

```ts
// Regenerate: npx tsx src/lib/plan/fixtures/golden/generate.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plan } from '../../types';
import { GRID_RECORDS } from '../grid-20x20';
import { bruteForceResolve } from '../reference';

export const GOLDEN_PLANS = ['empty', 'single-stamp', 'paint-then-erase', 'overlap-lower-wins'];

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of GOLDEN_PLANS) {
    const plan = JSON.parse(readFileSync(join(here, '../plans', `${name}.json`), 'utf8')) as Plan;
    const rows = bruteForceResolve(plan, GRID_RECORDS);
    writeFileSync(join(here, `${name}.json`), JSON.stringify(rows) + '\n');
  }
}
```

Run: `npx tsx src/lib/plan/fixtures/golden/generate.ts` then `npx prettier --write src/lib/plan/fixtures`.
Expected: four `golden/*.json` files; `empty.json` is `[]`; `single-stamp.json` has 16 rows minus the ineligible ones, all with value 5.

- [ ] **Step 3: Write the failing tests**

`src/lib/plan/golden.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_PLANS } from './fixtures/golden/generate';
import { gridId, gridIndex } from './fixtures/grid-20x20';
import { resolveEnvelopes } from './resolve';
import type { Plan } from './types';

const DIR = join(process.cwd(), 'src/lib/plan/fixtures');
const load = <T>(p: string): T => JSON.parse(readFileSync(join(DIR, p), 'utf8')) as T;

describe('goldens against grid-20x20', () => {
  for (const name of GOLDEN_PLANS) {
    it(name, () => {
      const plan = load<Plan>(`plans/${name}.json`);
      const got = [...resolveEnvelopes(plan, gridIndex())].map(([id, e]) => [id, e.maxStories]);
      expect(got).toEqual(load<[string, number][]>(`golden/${name}.json`));
    });
  }

  it('hand-checked values', () => {
    const r = (name: string) => resolveEnvelopes(load<Plan>(`plans/${name}.json`), gridIndex());
    expect(r('single-stamp').get(gridId(9, 10))).toEqual({ maxStories: 5 });
    expect(r('paint-then-erase').has(gridId(9, 10))).toBe(false); // erased
    expect(r('paint-then-erase').get(gridId(12, 9))).toEqual({ maxStories: 8 }); // 25.5 m out
    expect(r('overlap-lower-wins').get(gridId(7, 5))).toEqual({ maxStories: 3 }); // later wins
    expect(r('overlap-lower-wins').get(gridId(2, 5))).toEqual({ maxStories: 12 });
    expect(r('empty').size).toBe(0);
  });
});
```

`src/lib/plan/resolve.spec.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { arbGridOps } from './fixtures/arbitraries';
import { GRID_CHUNKS, GRID_RECORDS, gridId, gridIndex, gridLngLat, gridRecord } from './fixtures/grid-20x20';
import { bruteForceResolve } from './fixtures/reference';
import { createParcelIndex } from './parcel-index';
import { applyOp, resolveChunk, resolveEnvelopes, resolveParcels, type EnvelopeMap } from './resolve';
import type { Plan, PlanOp } from './types';

const FC = { numRuns: 200, seed: 20261010 };
const plan = (ops: PlanOp[]): Plan => ({ schema: 1, datasetVersion: 'fixture-0', ops });
const paint = (id: string, stories: number, radiusM: number, path: [number, number][]): PlanOp => ({ kind: 'paint', id, stories, radiusM, path });
const erase = (id: string, radiusM: number, path: [number, number][]): PlanOp => ({ kind: 'erase', id, radiusM, path });
const entries = (m: EnvelopeMap) =>
  [...m].map(([id, e]) => [id, e.maxStories] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

describe('resolveEnvelopes', () => {
  it('later ops win absolutely (3 over 12 gives 3)', () => {
    const p = gridLngLat(4, 3); // n = 64, eligible
    const m = resolveEnvelopes(plan([paint('a', 12, 5, [p]), paint('b', 3, 5, [p])]), gridIndex());
    expect(m.get(gridId(4, 3))).toEqual({ maxStories: 3 });
  });

  it('erase deletes; erase over nothing is a no-op', () => {
    const p = gridLngLat(4, 3);
    const idx = gridIndex();
    expect(resolveEnvelopes(plan([paint('a', 4, 5, [p]), erase('b', 5, [p])]), idx).size).toBe(0);
    expect(resolveEnvelopes(plan([erase('b', 50, [p])]), idx).size).toBe(0);
  });

  it('ineligible parcels never get an entry', () => {
    const m = resolveEnvelopes(plan([paint('a', 9, 500, [gridLngLat(9, 9)])]), gridIndex());
    expect(m.size).toBe(GRID_RECORDS.filter((r) => r.eligible).length);
    for (const r of GRID_RECORDS) expect(m.has(r.id)).toBe(r.eligible);
  });

  it('empty plan, and a plan over unloaded parcels, resolve to an empty Map', () => {
    expect(resolveEnvelopes(plan([]), gridIndex()).size).toBe(0);
    expect(resolveEnvelopes(plan([paint('a', 9, 500, [gridLngLat(9, 9)])]), createParcelIndex()).size).toBe(0);
  });

  it('iterates in ascending id order whatever the chunk order, with frozen fresh envelopes', () => {
    const ops = [paint('a', 9, 60, [gridLngLat(15, 15)]), paint('b', 2, 60, [gridLngLat(4, 4)])];
    const a = resolveEnvelopes(plan(ops), gridIndex([3, 2, 1, 0]));
    const ids = [...a.keys()];
    expect(ids).toEqual([...ids].sort());
    expect([...a]).toEqual([...resolveEnvelopes(plan(ops), gridIndex())]);
    const envs = [...a.values()];
    expect(envs.every((e) => Object.isFrozen(e) && Object.keys(e).join() === 'maxStories')).toBe(true);
    expect(new Set(envs).size).toBe(envs.length);
  });

  it('agrees with the brute-force reference on random plans', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(arbGridOps(8), (ops) => {
        expect(entries(resolveEnvelopes(plan(ops), index))).toEqual(bruteForceResolve(plan(ops), GRID_RECORDS));
      }),
      FC
    );
  });
});

describe('applyOp', () => {
  it('reports coverage split by eligibility, and only real changes, ascending', () => {
    const idx = gridIndex();
    const state: EnvelopeMap = new Map();
    const op = paint('a', 4, 5, [gridLngLat(7, 0)]); // (7,0) is ineligible
    const r1 = applyOp(state, op, idx);
    expect(r1.coverage).toEqual({ eligible: [], ineligible: [gridId(7, 0)] });
    expect(r1.changes).toEqual([]);

    const p = paint('b', 4, 12, [gridLngLat(4, 3)]);
    const r2 = applyOp(state, p, idx);
    expect(r2.changes.length).toBe(r2.coverage.eligible.length);
    expect(r2.changes.every((c) => c.before === null && c.after?.maxStories === 4)).toBe(true);
    expect(r2.changes.map((c) => c.id)).toEqual([...r2.changes.map((c) => c.id)].sort());

    const r3 = applyOp(state, { ...p, id: 'c' }, idx); // same value again
    expect(r3.changes).toEqual([]);

    const r4 = applyOp(state, erase('d', 12, [gridLngLat(4, 3)]), idx);
    expect(r4.changes.every((c) => c.after === null && c.before?.maxStories === 4)).toBe(true);
    expect(state.size).toBe(0);
  });

  it('a stroke only over ineligible parcels yields { eligible: [], ineligible: [...] }', () => {
    const r = applyOp(new Map(), erase('e', 5, [gridLngLat(0, 0)]), gridIndex()); // n = 0
    expect(r.coverage).toEqual({ eligible: [], ineligible: [gridId(0, 0)] });
  });

  it('P1 append: applyOp(resolve(ops[..k]), op) ≡ resolve(ops[..k+1])', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(arbGridOps(8).filter((o) => o.length > 0), (ops) => {
        const state = resolveEnvelopes(plan(ops.slice(0, -1)), index);
        applyOp(state, ops[ops.length - 1], index);
        expect(entries(state)).toEqual(entries(resolveEnvelopes(plan(ops), index)));
      }),
      FC
    );
  });
});

describe('resolveParcels (undo)', () => {
  it('returns null for unloaded or ineligible ids, ascending, deduplicated', () => {
    const r = resolveParcels([paint('a', 5, 500, [gridLngLat(9, 9)])], gridIndex(), [gridId(1, 0), 'missing', gridId(0, 0), gridId(1, 0)]);
    expect([...r]).toEqual([
      [gridId(0, 0), null],
      [gridId(1, 0), { maxStories: 5 }],
      ['missing', null]
    ]);
  });

  it('P2 undo: patching resolve(ops) with resolveParcels ≡ resolve(ops[..k-1])', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(arbGridOps(8).filter((o) => o.length > 0), (ops) => {
        const last = ops[ops.length - 1];
        const prev = ops.slice(0, -1);
        const state = resolveEnvelopes(plan(ops), index);
        const ids = index.covered(last).filter((id) => index.get(id)!.eligible);
        for (const [id, env] of resolveParcels(prev, index, ids)) {
          if (env) state.set(id, env);
          else state.delete(id);
        }
        expect(entries(state)).toEqual(entries(resolveEnvelopes(plan(prev), index)));
      }),
      FC
    );
  });
});

describe('resolveChunk (late chunks)', () => {
  it('returns {} for no added ids', () => {
    expect(resolveChunk(plan([]), gridIndex(), []).size).toBe(0);
  });

  it('P3: chunk order never matters, and late chunk + resolveChunk ≡ full resolve', () => {
    fc.assert(
      fc.property(
        arbGridOps(6),
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
        (ops, order) => {
          const full = entries(resolveEnvelopes(plan(ops), gridIndex()));
          expect(entries(resolveEnvelopes(plan(ops), gridIndex(order)))).toEqual(full);

          const index = gridIndex(order.slice(0, 3));
          const state = resolveEnvelopes(plan(ops), index);
          const late = GRID_CHUNKS[order[3]];
          const added = index.addChunk(late.cellId, late.records);
          for (const [id, env] of resolveChunk(plan(ops), index, added)) if (env) state.set(id, env);
          expect(entries(state)).toEqual(full);
        }
      ),
      FC
    );
  });

  it('ignores ops whose bbox misses the chunk', () => {
    const index = createParcelIndex();
    const rec: ParcelRecord = gridRecord(1, 1);
    const added = index.addChunk('one', [rec]);
    const far = paint('far', 7, 5, [gridLngLat(19, 19)]);
    expect([...resolveChunk(plan([far]), index, added)]).toEqual([[rec.id, null]]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run --project server src/lib/plan/resolve.spec.ts src/lib/plan/golden.spec.ts`
Expected: FAIL — `./resolve` cannot be resolved.

- [ ] **Step 5: Implement `resolve.ts`**

```ts
import type { ParcelId } from '../data/parcel';
import {
  assertNever,
  boxesIntersect,
  compareIds,
  opPath,
  opXYBox,
  pathCovers,
  pointInBox,
  project,
  type XY,
  type XYBox
} from './geometry';
import type { ParcelIndex } from './parcel-index';
import type { Envelope, Plan, PlanOp } from './types';

export type EnvelopeMap = Map<ParcelId, Envelope>;
export interface EnvelopeChange {
  id: ParcelId;
  before: Envelope | null;
  after: Envelope | null;
}
export interface OpCoverage {
  eligible: ParcelId[];
  ineligible: ParcelId[];
}

function envelope(maxStories: number): Envelope {
  return Object.freeze({ maxStories });
}

function sortedMap<V>(m: Map<ParcelId, V>): Map<ParcelId, V> {
  return new Map([...m].sort((a, b) => compareIds(a[0], b[0])));
}

/** The value an op writes to a covered eligible parcel (null = delete). Exhaustive (spec §5). */
function written(op: PlanOp): Envelope | null {
  switch (op.kind) {
    case 'paint':
      return envelope(op.stories);
    case 'erase':
      return null;
    default:
      return assertNever(op);
  }
}

export function applyOp(
  state: EnvelopeMap,
  op: PlanOp,
  index: ParcelIndex
): { changes: EnvelopeChange[]; coverage: OpCoverage } {
  const eligible: ParcelId[] = [];
  const ineligible: ParcelId[] = [];
  const changes: EnvelopeChange[] = [];
  const value = written(op);
  for (const id of index.covered(op)) {
    if (!index.get(id)!.eligible) {
      ineligible.push(id);
      continue;
    }
    eligible.push(id);
    const before = state.get(id) ?? null;
    if ((before?.maxStories ?? null) === (value?.maxStories ?? null)) continue;
    if (value) state.set(id, envelope(value.maxStories));
    else state.delete(id);
    changes.push({ id, before, after: value ? state.get(id)! : null });
  }
  return { changes, coverage: { eligible, ineligible } };
}

export function resolveEnvelopes(plan: Plan, index: ParcelIndex): EnvelopeMap {
  const state: EnvelopeMap = new Map();
  for (const op of plan.ops) {
    const value = written(op);
    for (const id of index.covered(op)) {
      if (!index.get(id)!.eligible) continue;
      if (value) state.set(id, envelope(value.maxStories));
      else state.delete(id);
    }
  }
  return sortedMap(state);
}

interface PreparedOp {
  op: PlanOp;
  box: XYBox;
  path: XY[];
  r2: number;
}

export function resolveParcels(
  ops: readonly PlanOp[],
  index: ParcelIndex,
  ids: Iterable<ParcelId>
): Map<ParcelId, Envelope | null> {
  const prepared: PreparedOp[] = ops.map((op) => ({
    op,
    box: opXYBox(op),
    path: opPath(op),
    r2: op.radiusM * op.radiusM
  }));
  const out = new Map<ParcelId, Envelope | null>();
  for (const id of [...new Set(ids)].sort(compareIds)) {
    const rec = index.get(id);
    if (!rec || !rec.eligible) {
      out.set(id, null);
      continue;
    }
    const l = project(rec.labelPoint[0], rec.labelPoint[1]);
    let value: Envelope | null = null;
    for (let i = prepared.length - 1; i >= 0; i--) {
      const p = prepared[i];
      if (!pointInBox(l, p.box) || !pathCovers(p.path, p.r2, l)) continue;
      value = written(p.op);
      break;
    }
    out.set(id, value);
  }
  return out;
}

export function resolveChunk(
  plan: Plan,
  index: ParcelIndex,
  addedIds: ParcelId[]
): Map<ParcelId, Envelope | null> {
  const box: XYBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const id of addedIds) {
    const rec = index.get(id);
    if (!rec) continue;
    const [x, y] = project(rec.labelPoint[0], rec.labelPoint[1]);
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }
  const ops = box[0] <= box[2] ? plan.ops.filter((op) => boxesIntersect(opXYBox(op), box)) : [];
  return resolveParcels(ops, index, addedIds);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run --project server src/lib/plan`
Expected: PASS.

- [ ] **Step 7: Format, typecheck, commit**

```bash
npx prettier --write src/lib/plan
npm run check
git add src/lib/plan
git commit -m "feat(plan): resolveEnvelopes with incremental applyOp, undo and late-chunk resolution" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Validation, canonical serialization, migration, rebase

**Files:**
- Create: `src/lib/plan/schema.ts`, `src/lib/plan/fixtures/plans/{unquantised,future-schema,unknown-fields}.json`
- Test: `src/lib/plan/schema.spec.ts`

**Interfaces:**
- Consumes: `DATASET_VERSION_RE` from `../data/manifest`; constants (Task 1); `assertNever` (Task 1); `Plan`, `PlanOp` from `./types`.
- Produces:
  ```ts
  export type PlanErrorCode = 'not-json' | 'not-object' | 'future-schema' | 'unknown-schema' | 'bad-field' | 'out-of-bounds' | 'too-many-ops' | 'too-many-points' | 'duplicate-id' | 'too-large';
  export type PlanError = { path: string; code: PlanErrorCode; message: string };
  export type Result<T> = { ok: true; value: T } | { ok: false; errors: PlanError[] };
  export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
  export const FUTURE_SCHEMA_MESSAGE: string;
  export const MIGRATIONS: Record<number, Migration>; // empty in M1
  export function runMigrations(raw: Record<string, unknown>, registry?: Record<number, Migration>, target?: number): Record<string, unknown>;
  export function quantize(deg: number): number;
  export function validatePlan(raw: unknown): Result<Plan>;
  export function parsePlan(text: string): Result<Plan>;
  export function serializePlan(plan: Plan): string;
  export function planByteSize(plan: Plan): number;
  export function rebasePlan(plan: Plan, datasetVersion: string): Plan;
  export function emptyPlan(datasetVersion: string): Plan;
  ```
  `rebasePlan` and `emptyPlan` throw `TypeError` for a `datasetVersion` that fails `DATASET_VERSION_RE` (programmer error; never produce an unparseable plan).

- [ ] **Step 1: Write the fixtures**

`fixtures/plans/unquantised.json` (7+ decimals, a padded title, an id that canonicalises nothing else):
```json
{
  "schema": 1,
  "datasetVersion": "2026-10-01-0a1b2c3d",
  "title": "  Mission upzone  ",
  "ops": [
    { "id": "u1", "kind": "paint", "stories": 6, "radiusM": 50, "path": [[-122.41831949, 37.76075351], [-122.4180000004, 37.7609999996]] }
  ]
}
```

`fixtures/plans/future-schema.json`:
```json
{ "schema": 2, "datasetVersion": "fixture-0", "ops": [] }
```

`fixtures/plans/unknown-fields.json`:
```json
{
  "schema": 1,
  "datasetVersion": "fixture-0",
  "extra": { "nested": true },
  "ops": [
    { "id": "e1", "kind": "erase", "stories": 9, "radiusM": 10, "path": [[-122.418319, 37.760754]], "color": "red" },
    { "id": "p1", "kind": "paint", "stories": 2, "radiusM": 10, "path": [[-122.418319, 37.760754]], "pressure": 0.5 }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/plan/schema.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_PLAN_BYTES, OPS_MAX, SF_BBOX } from './constants';
import {
  FUTURE_SCHEMA_MESSAGE,
  MIGRATIONS,
  emptyPlan,
  parsePlan,
  planByteSize,
  quantize,
  rebasePlan,
  runMigrations,
  serializePlan,
  validatePlan,
  type PlanErrorCode
} from './schema';
import type { Plan } from './types';

const FC = { numRuns: 200, seed: 20261010 };
const DIR = join(process.cwd(), 'src/lib/plan/fixtures/plans');
const text = (name: string) => readFileSync(join(DIR, `${name}.json`), 'utf8');
const PT: [number, number] = [-122.418319, 37.760754];
const base = () => ({
  schema: 1,
  datasetVersion: 'fixture-0',
  ops: [{ id: 'a', kind: 'paint', stories: 5, radiusM: 25, path: [PT] }] as unknown[]
});

function errorsOf(raw: unknown): [string, PlanErrorCode][] {
  const r = validatePlan(raw);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
}
function withOp(patch: Record<string, unknown>, drop: string[] = []) {
  const op: Record<string, unknown> = { id: 'a', kind: 'paint', stories: 5, radiusM: 25, path: [PT], ...patch };
  for (const k of drop) delete op[k];
  return { ...base(), ops: [op] };
}

describe('quantize', () => {
  it('rounds to 1e-6 and is idempotent', () => {
    expect(quantize(-122.41831949)).toBe(-122.418319);
    expect(quantize(37.7607535)).toBe(37.760754);
    expect(quantize(quantize(37.12345678))).toBe(quantize(37.12345678));
  });
});

describe('validatePlan: one test per §4.6 row', () => {
  it('root must be a plain object', () => {
    for (const raw of [null, [], 'str', 3, true]) expect(errorsOf(raw)).toEqual([['', 'not-object']]);
  });

  it('schema: missing → unknown-schema; future → future-schema; non-1 after migration → unknown-schema', () => {
    const { schema: _s, ...noSchema } = base();
    expect(errorsOf(noSchema)).toEqual([['/schema', 'unknown-schema']]);
    expect(errorsOf({ ...base(), schema: 2 })).toEqual([['/schema', 'future-schema']]);
    for (const s of [0, '1', 1.5, null]) expect(errorsOf({ ...base(), schema: s })).toEqual([['/schema', 'unknown-schema']]);
  });

  it('datasetVersion must match DATASET_VERSION_RE', () => {
    for (const v of ['', 'latest', '2026-10-01-XYZ', 7, undefined])
      expect(errorsOf({ ...base(), datasetVersion: v })).toEqual([['/datasetVersion', 'bad-field']]);
    expect(validatePlan({ ...base(), datasetVersion: '2026-10-01-0a1b2c3d' }).ok).toBe(true);
  });

  it('title: trimmed, ≤ 120 chars, empty dropped, non-string rejected', () => {
    const ok = validatePlan({ ...base(), title: '  hi  ' });
    expect(ok.ok && ok.value.title).toBe('hi');
    const blank = validatePlan({ ...base(), title: '   ' });
    expect(blank.ok && 'title' in blank.value).toBe(false);
    expect(validatePlan({ ...base(), title: 'x'.repeat(120) }).ok).toBe(true);
    expect(errorsOf({ ...base(), title: 'x'.repeat(121) })).toEqual([['/title', 'bad-field']]);
    expect(errorsOf({ ...base(), title: null })).toEqual([['/title', 'bad-field']]);
  });

  it('ops: must be an array of ≤ OPS_MAX, and a huge array is rejected without per-op work', () => {
    expect(errorsOf({ ...base(), ops: 'x' })).toEqual([['/ops', 'bad-field']]);
    const huge = new Array(1_000_000).fill(null);
    const t0 = performance.now();
    expect(errorsOf({ ...base(), ops: huge })).toEqual([['/ops', 'too-many-ops']]);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(errorsOf({ ...base(), ops: new Array(OPS_MAX + 1).fill(null) })).toEqual([['/ops', 'too-many-ops']]);
  });

  it('op must be an object; op.kind must be paint or erase', () => {
    expect(errorsOf({ ...base(), ops: [null] })).toEqual([['/ops/0', 'bad-field']]);
    expect(errorsOf(withOp({ kind: 'area' }))).toEqual([['/ops/0/kind', 'bad-field']]);
  });

  it('op.id: 1–32 chars of [A-Za-z0-9_-], unique', () => {
    for (const id of ['', 'x'.repeat(33), 'a b', 'é', 5]) expect(errorsOf(withOp({ id }))).toEqual([['/ops/0/id', 'bad-field']]);
    expect(validatePlan(withOp({ id: 'A-z_09'.padEnd(32, 'x') })).ok).toBe(true);
    const dup = { ...base(), ops: [base().ops[0], base().ops[0]] };
    expect(errorsOf(dup)).toEqual([['/ops/1/id', 'duplicate-id']]);
  });

  it('op.stories: paint needs an integer 1–80; erase drops it', () => {
    expect(errorsOf(withOp({}, ['stories']))).toEqual([['/ops/0/stories', 'bad-field']]);
    expect(errorsOf(withOp({ stories: '5' }))).toEqual([['/ops/0/stories', 'bad-field']]);
    for (const s of [0, 81, 2.5, Number.NaN]) expect(errorsOf(withOp({ stories: s }))).toEqual([['/ops/0/stories', 'out-of-bounds']]);
    for (const s of [1, 80]) expect(validatePlan(withOp({ stories: s })).ok).toBe(true);
    const e = validatePlan(withOp({ kind: 'erase', stories: 999 }));
    expect(e.ok && 'stories' in e.value.ops[0]).toBe(false);
  });

  it('op.radiusM: integer 5–500', () => {
    for (const r of [4, 501, 10.5]) expect(errorsOf(withOp({ radiusM: r }))).toEqual([['/ops/0/radiusM', 'out-of-bounds']]);
    expect(errorsOf(withOp({}, ['radiusM']))).toEqual([['/ops/0/radiusM', 'bad-field']]);
    for (const r of [5, 500]) expect(validatePlan(withOp({ radiusM: r })).ok).toBe(true);
  });

  it('op.path: 1–2000 finite [lng, lat] points inside SF_BBOX', () => {
    expect(errorsOf(withOp({ path: 'x' }))).toEqual([['/ops/0/path', 'bad-field']]);
    expect(errorsOf(withOp({ path: [] }))).toEqual([['/ops/0/path', 'bad-field']]);
    expect(errorsOf(withOp({ path: new Array(2001).fill(PT) }))).toEqual([['/ops/0/path', 'too-many-points']]);
    expect(validatePlan(withOp({ path: new Array(2000).fill(PT) })).ok).toBe(true);
    expect(errorsOf(withOp({ path: [PT, [1]] }))).toEqual([['/ops/0/path/1', 'bad-field']]);
    expect(errorsOf(withOp({ path: [['a', 37.7]] }))).toEqual([['/ops/0/path/0', 'bad-field']]);
    expect(errorsOf(withOp({ path: [[Infinity, 37.7]] }))).toEqual([['/ops/0/path/0', 'out-of-bounds']]);
    expect(errorsOf(withOp({ path: [[-122.0, 37.7]] }))).toEqual([['/ops/0/path/0', 'out-of-bounds']]);
    expect(validatePlan(withOp({ path: [[SF_BBOX[0], SF_BBOX[1]], [SF_BBOX[2], SF_BBOX[3]]] })).ok).toBe(true);
  });

  it('whole plan: planByteSize ≤ MAX_PLAN_BYTES (too-large generated in the test)', () => {
    const path = new Array(5).fill(PT);
    const ops = Array.from({ length: 3000 }, (_, k) => ({ id: `o${k}`, kind: 'paint', stories: 5, radiusM: 25, path }));
    expect(errorsOf({ ...base(), ops })).toEqual([['', 'too-large']]);
  });

  it('reports every failure, with JSON-pointer paths, all-or-nothing', () => {
    const raw = {
      schema: 1,
      datasetVersion: 'bad',
      title: 3,
      ops: [
        { id: 'a', kind: 'paint', stories: 99, radiusM: 1, path: [[0, 0]] },
        { id: 'a', kind: 'erase', radiusM: 10, path: [PT] }
      ]
    };
    expect(errorsOf(raw)).toEqual([
      ['/datasetVersion', 'bad-field'],
      ['/title', 'bad-field'],
      ['/ops/0/stories', 'out-of-bounds'],
      ['/ops/0/radiusM', 'out-of-bounds'],
      ['/ops/0/path/0', 'out-of-bounds'],
      ['/ops/1/id', 'duplicate-id']
    ]);
  });
});

describe('parsePlan', () => {
  it('rejects non-JSON', () => {
    for (const s of ['', '{', 'undefined']) {
      const r = parsePlan(s);
      expect(r.ok === false && r.errors[0].code).toBe('not-json');
    }
  });

  it('future-schema carries the default copy', () => {
    const r = parsePlan(text('future-schema'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([{ path: '/schema', code: 'future-schema', message: FUTURE_SCHEMA_MESSAGE }]);
    expect(FUTURE_SCHEMA_MESSAGE).toBe(
      'This plan was made with a newer version of SF Housing Simulator. Reload the page to get the latest version.'
    );
  });

  it('accepts every valid fixture, and they round-trip canonically', () => {
    for (const name of ['empty', 'single-stamp', 'paint-then-erase', 'overlap-lower-wins']) {
      const compact = JSON.stringify(JSON.parse(text(name)));
      const r = parsePlan(compact);
      expect(r.ok).toBe(true);
      if (r.ok) expect(serializePlan(r.value)).toBe(compact);
    }
  });

  it('quantises unquantised input and trims the title', () => {
    const r = parsePlan(text('unquantised'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('Mission upzone');
    expect(r.value.ops[0].path).toEqual([
      [-122.418319, 37.760754],
      [-122.418, 37.761]
    ]);
  });

  it('drops unknown fields, including stories on an erase op', () => {
    const r = parsePlan(text('unknown-fields'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serializePlan(r.value)).toBe(
      '{"schema":1,"datasetVersion":"fixture-0","ops":[' +
        '{"id":"e1","kind":"erase","radiusM":10,"path":[[-122.418319,37.760754]]},' +
        '{"id":"p1","kind":"paint","stories":2,"radiusM":10,"path":[[-122.418319,37.760754]]}]}'
    );
  });
});

describe('serializePlan', () => {
  it('emits fixed key order with title between datasetVersion and ops', () => {
    const p: Plan = { ops: [{ path: [PT], radiusM: 9, kind: 'paint', stories: 3, id: 'z' }], title: 'T', datasetVersion: 'fixture-1', schema: 1 };
    expect(serializePlan(p)).toBe(
      '{"schema":1,"datasetVersion":"fixture-1","title":"T","ops":[{"id":"z","kind":"paint","stories":3,"radiusM":9,"path":[[-122.418319,37.760754]]}]}'
    );
  });

  it('planByteSize counts UTF-8 bytes', () => {
    const p: Plan = { ...emptyPlan('fixture-0'), title: 'é' };
    expect(planByteSize(p)).toBe(new TextEncoder().encode(serializePlan(p)).byteLength);
    expect(planByteSize(p)).toBe(serializePlan(p).length + 1);
    expect(MAX_PLAN_BYTES).toBe(262_144);
  });

  it('P4: parse(serialize(p)) ≡ p for arbitrary valid plans', () => {
    const micro = (min: number, max: number) => fc.integer({ min: Math.round(min * 1e6), max: Math.round(max * 1e6) }).map((k) => k / 1e6);
    const point = fc.tuple(micro(SF_BBOX[0], SF_BBOX[2]), micro(SF_BBOX[1], SF_BBOX[3]));
    const path = fc.array(point, { minLength: 1, maxLength: 20 });
    const radiusM = fc.integer({ min: 5, max: 500 });
    const op = fc.oneof(
      fc.record({ kind: fc.constant('paint' as const), stories: fc.integer({ min: 1, max: 80 }), radiusM, path }),
      fc.record({ kind: fc.constant('erase' as const), radiusM, path })
    );
    const arbPlan = fc.record(
      {
        schema: fc.constant(1 as const),
        datasetVersion: fc.oneof(fc.nat(99).map((n) => `fixture-${n}`), fc.constant('2026-10-01-0a1b2c3d')),
        title: fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim() === s && s.length > 0),
        ops: fc.array(op, { maxLength: 30 }).map((ops) => ops.map((o, k) => ({ ...o, id: `id_${k}` })))
      },
      { requiredKeys: ['schema', 'datasetVersion', 'ops'] }
    );
    fc.assert(
      fc.property(arbPlan, (p) => {
        const r = parsePlan(serializePlan(p as Plan));
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value).toEqual(p);
          expect(serializePlan(r.value)).toBe(serializePlan(p as Plan));
        }
      }),
      FC
    );
  });
});

describe('migration', () => {
  it('MIGRATIONS is empty in M1', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it('runMigrations chains a registry up to the target', () => {
    const registry = {
      1: (r: Record<string, unknown>) => ({ ...r, schema: 2, a: true }),
      2: (r: Record<string, unknown>) => ({ ...r, schema: 3, b: true })
    };
    expect(runMigrations({ schema: 1 }, registry, 3)).toEqual({ schema: 3, a: true, b: true });
    expect(runMigrations({ schema: 2 }, registry, 3)).toEqual({ schema: 3, b: true });
    expect(() => runMigrations({ schema: 1 }, { 1: (r) => r }, 2)).toThrow(/schema 2/);
  });
});

describe('rebasePlan / emptyPlan', () => {
  it('rebasePlan returns a copy with the new version and the same ops, leaving the input alone', () => {
    const p: Plan = { ...emptyPlan('fixture-0'), ops: [{ id: 'a', kind: 'erase', radiusM: 5, path: [PT] }] };
    const before = serializePlan(p);
    const q = rebasePlan(p, '2026-10-01-0a1b2c3d');
    expect(q).not.toBe(p);
    expect(q.datasetVersion).toBe('2026-10-01-0a1b2c3d');
    expect(q.ops).toEqual(p.ops);
    expect(serializePlan(p)).toBe(before);
  });

  it('emptyPlan, and both reject a bad version', () => {
    expect(emptyPlan('fixture-3')).toEqual({ schema: 1, datasetVersion: 'fixture-3', ops: [] });
    expect(() => emptyPlan('latest')).toThrow(TypeError);
    expect(() => rebasePlan(emptyPlan('fixture-0'), 'latest')).toThrow(TypeError);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --project server src/lib/plan/schema.spec.ts`
Expected: FAIL — `./schema` cannot be resolved.

- [ ] **Step 4: Implement `schema.ts`**

```ts
import { DATASET_VERSION_RE } from '../data/manifest';
import {
  CURRENT_SCHEMA,
  MAX_PLAN_BYTES,
  OPS_MAX,
  PATH_MAX_POINTS,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  SF_BBOX,
  STORIES_MAX,
  STORIES_MIN,
  TITLE_MAX_CHARS
} from './constants';
import { assertNever } from './geometry';
import type { Plan, PlanOp } from './types';

export type PlanErrorCode =
  | 'not-json'
  | 'not-object'
  | 'future-schema'
  | 'unknown-schema'
  | 'bad-field'
  | 'out-of-bounds'
  | 'too-many-ops'
  | 'too-many-points'
  | 'duplicate-id'
  | 'too-large';
export type PlanError = { path: string; code: PlanErrorCode; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; errors: PlanError[] };
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const FUTURE_SCHEMA_MESSAGE =
  'This plan was made with a newer version of SF Housing Simulator. Reload the page to get the latest version.';

/** MIGRATIONS[n] maps raw schema n to n + 1. Empty in M1 (spec §4.8). */
export const MIGRATIONS: Record<number, Migration> = {};

export function runMigrations(
  raw: Record<string, unknown>,
  registry: Record<number, Migration> = MIGRATIONS,
  target: number = CURRENT_SCHEMA
): Record<string, unknown> {
  let cur = raw;
  while (typeof cur.schema === 'number' && Number.isInteger(cur.schema) && cur.schema < target) {
    const from = cur.schema;
    const step = registry[from];
    if (!step) break;
    cur = step(cur);
    if (cur.schema !== from + 1) throw new Error(`Migration ${from} must produce schema ${from + 1}`);
  }
  return cur;
}

export function quantize(deg: number): number {
  return Math.round(deg * 1e6) / 1e6;
}

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const encoder = new TextEncoder();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function fail(path: string, code: PlanErrorCode, message: string): Result<never> {
  return { ok: false, errors: [{ path, code, message }] };
}

type Report = (path: string, code: PlanErrorCode, message: string) => void;

function validatePath(raw: unknown, at: string, bad: Report): [number, number][] {
  if (!Array.isArray(raw)) {
    bad(at, 'bad-field', 'path must be an array of [lng, lat] points.');
    return [];
  }
  if (raw.length === 0) {
    bad(at, 'bad-field', 'path needs at least one point.');
    return [];
  }
  if (raw.length > PATH_MAX_POINTS) {
    bad(at, 'too-many-points', `path has more than ${PATH_MAX_POINTS} points.`);
    return [];
  }
  const out: [number, number][] = [];
  raw.forEach((pt: unknown, j) => {
    const p = `${at}/${j}`;
    if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
      bad(p, 'bad-field', 'Each point must be [lng, lat].');
      return;
    }
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
      bad(p, 'out-of-bounds', 'Point coordinates must be finite.');
      return;
    }
    const lng = quantize(pt[0]);
    const lat = quantize(pt[1]);
    if (lng < SF_BBOX[0] || lat < SF_BBOX[1] || lng > SF_BBOX[2] || lat > SF_BBOX[3]) {
      bad(p, 'out-of-bounds', 'The point is outside San Francisco.');
      return;
    }
    out.push([lng, lat]);
  });
  return out;
}

function validateOp(raw: unknown, at: string, report: Report, seen: Set<string>): PlanOp | null {
  if (!isPlainObject(raw)) {
    report(at, 'bad-field', 'Each op must be an object.');
    return null;
  }
  let ok = true;
  const bad: Report = (path, code, message) => {
    ok = false;
    report(path, code, message);
  };
  const { id, kind, stories, radiusM } = raw;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    bad(`${at}/id`, 'bad-field', 'id must be 1–32 characters of A–Z, a–z, 0–9, _ or -.');
  } else if (seen.has(id)) {
    bad(`${at}/id`, 'duplicate-id', `Duplicate op id "${id}".`);
  } else {
    seen.add(id);
  }
  if (kind !== 'paint' && kind !== 'erase') bad(`${at}/kind`, 'bad-field', 'kind must be paint or erase.');
  if (kind === 'paint') {
    if (typeof stories !== 'number') bad(`${at}/stories`, 'bad-field', 'A paint op needs stories.');
    else if (!Number.isInteger(stories) || stories < STORIES_MIN || stories > STORIES_MAX)
      bad(`${at}/stories`, 'out-of-bounds', `stories must be an integer ${STORIES_MIN}–${STORIES_MAX}.`);
  }
  if (typeof radiusM !== 'number') bad(`${at}/radiusM`, 'bad-field', 'radiusM must be a number.');
  else if (!Number.isInteger(radiusM) || radiusM < RADIUS_MIN_M || radiusM > RADIUS_MAX_M)
    bad(`${at}/radiusM`, 'out-of-bounds', `radiusM must be an integer ${RADIUS_MIN_M}–${RADIUS_MAX_M}.`);
  const path = validatePath(raw.path, `${at}/path`, bad);
  if (!ok) return null;
  return kind === 'paint'
    ? { id: id as string, kind, stories: stories as number, radiusM: radiusM as number, path }
    : { id: id as string, kind: 'erase', radiusM: radiusM as number, path };
}

export function validatePlan(raw: unknown): Result<Plan> {
  if (!isPlainObject(raw)) return fail('', 'not-object', 'A plan must be a JSON object.');
  if (raw.schema === undefined) return fail('/schema', 'unknown-schema', 'The plan has no schema version.');
  if (typeof raw.schema === 'number' && raw.schema > CURRENT_SCHEMA)
    return fail('/schema', 'future-schema', FUTURE_SCHEMA_MESSAGE);
  const m = runMigrations(raw);
  if (m.schema !== CURRENT_SCHEMA)
    return fail('/schema', 'unknown-schema', `Unknown plan schema ${JSON.stringify(m.schema)}.`);

  const errors: PlanError[] = [];
  const report: Report = (path, code, message) => errors.push({ path, code, message });

  const { datasetVersion } = m;
  if (typeof datasetVersion !== 'string' || !DATASET_VERSION_RE.test(datasetVersion))
    report('/datasetVersion', 'bad-field', 'datasetVersion is not a valid dataset version.');

  let title: string | undefined;
  if (m.title !== undefined) {
    if (typeof m.title !== 'string') report('/title', 'bad-field', 'title must be a string.');
    else {
      const t = m.title.trim();
      if (t.length > TITLE_MAX_CHARS) report('/title', 'bad-field', `title is over ${TITLE_MAX_CHARS} characters.`);
      else if (t.length > 0) title = t;
    }
  }

  const ops: PlanOp[] = [];
  if (!Array.isArray(m.ops)) report('/ops', 'bad-field', 'ops must be an array.');
  else if (m.ops.length > OPS_MAX) report('/ops', 'too-many-ops', `A plan can have at most ${OPS_MAX} ops.`);
  else {
    const seen = new Set<string>();
    m.ops.forEach((o: unknown, i) => {
      const op = validateOp(o, `/ops/${i}`, report, seen);
      if (op) ops.push(op);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  const plan: Plan = { schema: CURRENT_SCHEMA, datasetVersion: datasetVersion as string, ops };
  if (title !== undefined) plan.title = title;
  if (planByteSize(plan) > MAX_PLAN_BYTES)
    return fail('', 'too-large', `The plan is larger than ${MAX_PLAN_BYTES / 1024} KB.`);
  return { ok: true, value: plan };
}

export function parsePlan(text: string): Result<Plan> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('', 'not-json', 'The plan is not valid JSON.');
  }
  return validatePlan(raw);
}

function serializeOp(op: PlanOp): Record<string, unknown> {
  const path = op.path.map(([lng, lat]) => [quantize(lng), quantize(lat)]);
  switch (op.kind) {
    case 'paint':
      return { id: op.id, kind: op.kind, stories: op.stories, radiusM: op.radiusM, path };
    case 'erase':
      return { id: op.id, kind: op.kind, radiusM: op.radiusM, path };
    default:
      return assertNever(op);
  }
}

/** Canonical compact JSON; fixed key order (spec §4.7). */
export function serializePlan(plan: Plan): string {
  const root: Record<string, unknown> = { schema: plan.schema, datasetVersion: plan.datasetVersion };
  if (plan.title !== undefined) root.title = plan.title;
  root.ops = plan.ops.map(serializeOp);
  return JSON.stringify(root);
}

export function planByteSize(plan: Plan): number {
  return encoder.encode(serializePlan(plan)).byteLength;
}

function checkVersion(datasetVersion: string): void {
  if (!DATASET_VERSION_RE.test(datasetVersion))
    throw new TypeError(`Invalid datasetVersion: ${JSON.stringify(datasetVersion)}`);
}

export function rebasePlan(plan: Plan, datasetVersion: string): Plan {
  checkVersion(datasetVersion);
  return { ...plan, datasetVersion, ops: plan.ops };
}

export function emptyPlan(datasetVersion: string): Plan {
  checkVersion(datasetVersion);
  return { schema: CURRENT_SCHEMA, datasetVersion, ops: [] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project server src/lib/plan`
Expected: PASS. If the huge-array test exceeds 100 ms, the per-op loop is running — fix the guard, not the threshold.

- [ ] **Step 6: Format, typecheck, commit**

```bash
npx prettier --write src/lib/plan
npm run check
git add src/lib/plan
git commit -m "feat(plan): plan validation, canonical serialization, migration and rebase" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Public barrel and performance budgets

**Files:**
- Create: `src/lib/plan/index.ts`, `src/lib/plan/resolve.bench.spec.ts`, `src/lib/plan/index.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `src/lib/plan/index.ts`, the public surface consumers import (`$lib/plan` from app code, `../plan` from sibling modules):
  ```ts
  export type { Envelope, BrushStroke, PlanOp, Plan } from './types';
  export * from './constants';
  export { project, opBBox, type XY, type BBox } from './geometry';
  export { createParcelIndex, type ParcelIndex } from './parcel-index';
  export { resolveEnvelopes, applyOp, resolveParcels, resolveChunk, type EnvelopeMap, type EnvelopeChange, type OpCoverage } from './resolve';
  export { parsePlan, validatePlan, serializePlan, planByteSize, quantize, rebasePlan, emptyPlan, MIGRATIONS, FUTURE_SCHEMA_MESSAGE, type PlanError, type PlanErrorCode, type Result } from './schema';
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/plan/index.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as plan from './index';

describe('public surface (spec §2 Internal types)', () => {
  it('exports every function and constant', () => {
    for (const name of [
      'project', 'opBBox', 'createParcelIndex', 'resolveEnvelopes', 'applyOp', 'resolveParcels',
      'resolveChunk', 'parsePlan', 'validatePlan', 'serializePlan', 'planByteSize', 'quantize',
      'rebasePlan', 'emptyPlan'
    ]) {
      expect(typeof (plan as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(plan.STORIES_MIN).toBe(1);
    expect(plan.STORIES_MAX).toBe(80);
    expect(plan.RADIUS_MIN_M).toBe(5);
    expect(plan.RADIUS_MAX_M).toBe(500);
    expect(plan.PATH_MAX_POINTS).toBe(2000);
    expect(plan.OPS_MAX).toBe(5000);
    expect(plan.MAX_PLAN_BYTES).toBe(262_144);
    expect(plan.SF_BBOX).toEqual([-123.1738, 37.604, -122.2818, 37.9298]);
    expect(plan.CURRENT_SCHEMA).toBe(1);
    expect(plan.MIGRATIONS).toEqual({});
  });
});
```

`src/lib/plan/resolve.bench.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { createParcelIndex, type ParcelIndex } from './parcel-index';
import { applyOp, resolveEnvelopes } from './resolve';
import { quantize } from './schema';
import type { Plan, PlanOp } from './types';

// Synthetic city: 420 × 358 = 150,360 label points over ≈13.2 km × 11.1 km, in 16 × 16 chunks.
const W = -122.51, E = -122.36, S = 37.71, N = 37.81;
const COLS = 420, ROWS = 358, CELLS = 16;

function buildIndex(): { index: ParcelIndex; eligible: number } {
  const chunks = new Map<string, ParcelRecord[]>();
  let eligible = 0;
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const n = j * COLS + i;
      const ok = n % 7 !== 0;
      if (ok) eligible++;
      const cell = `${Math.floor((i * CELLS) / COLS)}-${Math.floor((j * CELLS) / ROWS)}`;
      const rec: ParcelRecord = {
        id: String(1000000 + n),
        polygon: [],
        labelPoint: [W + ((i + 0.5) * (E - W)) / COLS, S + ((j + 0.5) * (N - S)) / ROWS],
        areaM2: 100, existingUnits: 1, existingFloorAreaM2: 100, existingHeightM: 6,
        landUse: 'RESIDENT', eligible: ok, neighborhood: 'Synthetic'
      };
      (chunks.get(cell) ?? chunks.set(cell, []).get(cell)!).push(rec);
    }
  }
  const index = createParcelIndex();
  for (const [cellId, records] of chunks) index.addChunk(cellId, records);
  return { index, eligible };
}

function wholeCityPlan(): Plan {
  const ops: PlanOp[] = [];
  for (let k = 0; k < 40; k++) {
    const lat = quantize(S + ((k + 0.5) * (N - S)) / 40);
    const path: [number, number][] = [];
    for (let p = 0; p < 14; p++) path.push([quantize(W + (p * (E - W)) / 13), lat]);
    ops.push({ kind: 'paint', id: `s${k}`, stories: 1 + (k % 80), radiusM: 500, path });
  }
  return { schema: 1, datasetVersion: 'fixture-0', ops };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

describe('performance budgets (spec §4.4)', () => {
  const { index, eligible } = buildIndex();
  const plan = wholeCityPlan();

  it('resolveEnvelopes: 150k parcels, 40 radius-500 m strokes, ≤ 1,000 ms', () => {
    expect(index.size).toBe(COLS * ROWS);
    const times: number[] = [];
    let size = 0;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      size = resolveEnvelopes(plan, index).size;
      times.push(performance.now() - t0);
    }
    expect(size).toBe(eligible); // every eligible parcel is covered
    expect(median(times)).toBeLessThanOrEqual(1000);
  });

  it('appending one ≈500-parcel op takes ≤ 10 ms', () => {
    const committed = resolveEnvelopes(plan, index);
    const op: PlanOp = { kind: 'paint', id: 'add', stories: 7, radiusM: 394, path: [[-122.435, 37.76]] };
    const n = index.covered(op).length;
    expect(n).toBeGreaterThanOrEqual(450);
    expect(n).toBeLessThanOrEqual(550);
    const times: number[] = [];
    for (let run = 0; run < 7; run++) {
      const state = new Map(committed);
      const t0 = performance.now();
      applyOp(state, op, index);
      times.push(performance.now() - t0);
    }
    expect(median(times)).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project server src/lib/plan/index.spec.ts src/lib/plan/resolve.bench.spec.ts`
Expected: `index.spec.ts` FAILS (`./index` missing). The bench may already pass; if it fails on budget, profile before touching thresholds (the budgets are spec values and must not be loosened). Likely hot spots: re-sorting inside `covered` for huge sets, `index.get` per id, Set churn.

- [ ] **Step 3: Implement `index.ts`** with exactly the exports listed under **Produces**.

- [ ] **Step 4: Run the full verification**

```bash
npx prettier --write src/lib/plan
npx vitest run --project server src/lib/plan
npm run test:unit
npm run lint
npm run check
```
Expected: all pass; `npm run lint` clean for `src/lib/plan`, `package.json`, `src/lib/attribution.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan
git commit -m "feat(plan): public barrel and CI-enforced performance budgets" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (done at authoring)

- Spec coverage: §4.1 → T1; §4.2 → T1 (predicate) + T2 (candidate selection, ordering); §4.3/4.4 → T3; §4.5–4.9 → T4; §4.10 → T1 purity guard + ordering tests in T2/T3; §6 unit tests 1–8 → T1–T4; P1–P3 → T3, P4 → T4, P5 → T2; goldens → T3; benchmark → T5; acceptance 1 & 7 → purity spec; acceptance 2 → index.spec + types.ts unchanged; acceptance 6 is asserted in brush-tool's browser test (out of scope here).
- IC-3 guard (keep first, throw in dev on differing records) → T2.
- Not covered here by design: chunk fetching, stroke sampling, generator, storage.
