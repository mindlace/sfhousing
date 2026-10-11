# Typology Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `generate(parcel, env, seed, mode)` (I8): a pure, deterministic TypeScript function that turns a `ParcelRecord` plus an `Envelope` into a `GeneratedBuilding` (I9) or `null`, with seeded variety (I14), plus an optional memo cache for the worker host.

**Architecture:** A pipeline of small pure modules under `src/lib/generator/`: `site.ts` normalises the parcel polygon into a site (`P`, `A`, centroid, principal axis, inset base region `Q`); `select.ts` resolves typology and built stories (cap chain); `massing.ts` derives the base footprint (Sutherland–Hodgman slab bisection) and the per-typology parts in local metres; `generate.ts` applies unit yield, null rules, rounding and calls `geo.ts` to convert rings to `[lng, lat]`. Polygon booleans and offsets go through `clipper2-ts` wrapped in `poly.ts`. Only `geo.ts` may use transcendental functions.

**Tech Stack:** TypeScript (strict), `clipper2-ts@2.0.1` (runtime, BSL-1.0), Vitest 4 (server project in Node, client project in Chromium), fast-check (already a devDependency), `proj4` (devDependency, conversion test only).

**Spec:** `docs/superpowers/specs/2026-10-10-typology-generator-design.md` (design context: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`). Executors read the spec's §4 for every rule; this plan restates the rules as code.

## Global Constraints

Verbatim from the spec §3 (design global constraints):

- **Free and open source.** No paid APIs and no vendor keys are needed to run or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1: *theoretical max buildout*). Net counts are shown, not gross. Sources and vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era laptop. Generated buildings appear within 150 ms of pointer-up for strokes covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within 5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works at 375 px.
- **Data is static and versioned.** The worker does no geo computation at runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all work, bare-name Cloudflare resources (`sfhousing`), and the migration workflow via Drizzle.

("The worker" in the static-data bullet means the Cloudflare Worker. The browser web worker is where generation is meant to run.)

Interface rows this plan produces/consumes (verbatim from the spec §2; do not alter):

- I1 `type ParcelId = string`; I6 `ParcelRecord` — consumed, type-only, from `src/lib/data/parcel.ts` (owned by data-pipeline; **do not edit**).
- I2 `interface Envelope { maxStories: number }` — consumed, type-only, from `src/lib/plan/types.ts` (owned by plan-model; **do not edit**). M1 code must ignore unknown fields.
- I7 `type BuildoutMode = 'max'` (M1). `'likely'` is reserved for M2.
- I8 `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding | null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt)
- I9 `interface GeneratedBuilding { parcelId: ParcelId; source: 'user'; /* widens to 'pipeline' | 'scenario' later */ typology: TypologyId; parts: { footprint: [lng, lat][] /* single outer ring; parcel holes dropped in M1 */; baseM: number; topM: number }[] /* nested: each part's footprint ⊆ the part below; rendered ground-to-topM */; stories: number; units: number; floorAreaM2: number; replacesExisting: boolean }`
- I10 `type TypologyId = 'adu' | 'plex' | 'walkup' | 'podium' | 'midrise' | 'tower'`
- I14 Seed: `seed = fnv1a32(parcelId)`.

Project rules that bind every task:

- Do **not** touch `src/lib/data/`, `src/lib/plan/`, or `pipeline/` (other subsystems own them; they run concurrently). Import `ParcelRecord`/`Envelope` with `import type` via **relative** paths (`../data/parcel`, `../plan/types`) so the same modules run under Vitest, the client test config and `tsx`.
- The only new runtime dependency is `clipper2-ts@2.0.1`, pinned exactly (no `^`), and credited in `SOFTWARE` in `src/lib/attribution.ts`.
- No `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow` or `Math.exp` anywhere under `src/lib/generator/` except `geo.ts` (AC4; enforced by a grep test in Task 4). Test code rotates with the rational parametrisation `cos = (1−t²)/(1+t²)`, `sin = 2t/(1+t²)` instead.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`. Wrap `fc.assert(...)` as `expect(() => fc.assert(...)).not.toThrow()`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Run `npx prettier --write <files>` and `npx eslint <files>` before each commit.
- Conventional Commits. Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Multi-line messages: write to a temp file and `git commit -F`, no heredocs.
- Run single test files with `npx vitest --run --project server <path>` (or `--project client`).

## Review Focus

Inputs the spec implies but its tables do not exercise; each has a test pinned in the owning task:

1. **Non-finite coordinates** (NaN/Infinity in a ring, from bad data) → that ring is dropped like a degenerate ring; `generate` returns `null` or uses the remaining rings and never throws. (Task 3, `site.spec.ts`)
2. **Closed rings and repeated vertices** (GeoJSON-style first-vertex-repeated rings, consecutive duplicates) → identical result to the open, de-duplicated ring. (Task 3, `site.spec.ts`)
3. **Clockwise single outer ring** (orientation is not trusted, IC-4) → identical building to the CCW ring. (Task 5, `golden.spec.ts`)
4. **Odd envelope values** (`maxStories` 5.7, 0, −3, NaN, Infinity, 1e9, plus unknown extra envelope fields) → floor, `null`, or clamp to 80, never throw; extra fields ignored. (Task 5, `golden.spec.ts`)
5. **Tall paint on a large but skinny/irregular site** (≥ 1,500 m² L-shape with narrow arms) → the tower plate cannot fit, so the result falls back to `midrise` 12 (or a fitting tower), and every upper part still nests inside the part below. (Task 6, `golden.spec.ts`)

---

## File Structure

All under `src/lib/generator/` unless noted.

| file | responsibility |
|---|---|
| `types.ts` | `TypologyId`, `BuildoutMode`, `GeneratedBuilding` (I7, I9, I10) |
| `constants.ts` | §4.1 constants + `rulesFor(typ)` table (M3 seam) |
| `seed.ts` | `fnv1a32`, `mulberry32` |
| `variety.ts` | `VarietyDraws`, `drawVariety`, `varietyFromUniforms` |
| `poly.ts` | local-metre geometry: shoelace, centroid, principal axis, projection, Sutherland–Hodgman slab clip, oriented rectangle, ring canonicalisation, Clipper wrappers |
| `site.ts` | §4.4 site normalisation → `Site` |
| `select.ts` | §4.5 `selectTypology` |
| `massing.ts` | §4.6–4.8 `baseFootprint`, `massTypology`, `massAdu`, `floorTop` |
| `geo.ts` | §4.10 `toLngLat` (the only file allowed transcendental Math) |
| `generate.ts` | §4.4 steps 1–3, §4.9 null rules/yield, rounding; `generateDetailed`, `generateWith`, `generate`, `aduOpenOk` |
| `cache.ts` | §4.12 `createGeneratorCache` |
| `index.ts` | public exports |
| `fixtures/*.json` | golden parcels (§6) and `seeds.json`, `golden-seeded.json` |
| `fixtures/synth.ts` | seeded synthetic parcels (perf + seeded snapshot) |
| `fixtures/build-golden-seeded.ts` | regenerates `golden-seeded.json` (run deliberately) |
| `fixtures/geom.ts` | test-only geometry assertions (containment, nesting, rotation) |
| `*.spec.ts` | server-project tests; `generator.svelte.spec.ts` is the Chromium client test |
| `src/lib/attribution.ts` (modify) | add the Clipper2 credit |
| `.prettierignore` (modify) | ignore `src/lib/generator/fixtures/golden-seeded.json` |

---

### Task 1: Package, types, constants, seed and variety

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm), `src/lib/attribution.ts`, `.prettierignore`
- Create: `src/lib/generator/types.ts`, `src/lib/generator/constants.ts`, `src/lib/generator/seed.ts`, `src/lib/generator/variety.ts`, `src/lib/generator/fixtures/seeds.json`
- Test: `src/lib/generator/seed.spec.ts`, `src/lib/generator/variety.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts`: `export type TypologyId = 'adu' | 'plex' | 'walkup' | 'podium' | 'midrise' | 'tower'`; `export type BuildoutMode = 'max'`; `export type ReplacementTypology = Exclude<TypologyId, 'adu'>`; `export interface GeneratedBuilding` (I9 verbatim shape).
  - `constants.ts`: every §4.1 constant by name, plus `MIN_PIECE_M2 = 10`, `TOWER_INSET_M = 1.0`, `ADU_INSET_M = 1.0`, `ADU_GROSS_M2 = 68.75`, `interface TypologyRules { coverage: number; avgUnitM2: number; groundFtfM: number; maxUnits: number }`, `rulesFor(typ: TypologyId): TypologyRules`.
  - `seed.ts`: `fnv1a32(s: string): number`, `mulberry32(seed: number): () => number`.
  - `variety.ts`: `interface VarietyDraws { edgeInsetM: number; stepbackM: number; parapetM: number; towerSlide: number; towerAspect: number; aduEnd: 1 | -1 }`, `drawVariety(seed: number): VarietyDraws`, `varietyFromUniforms(r: readonly number[]): VarietyDraws`.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-exact clipper2-ts@2.0.1
npm install --save-dev --save-exact proj4@2.22.0
```

Check `package.json`: `"clipper2-ts": "2.0.1"` under `dependencies` (no caret), `"proj4": "2.22.0"` under `devDependencies`.

- [ ] **Step 2: Write the failing tests**

`src/lib/generator/fixtures/seeds.json` (values computed with an independent Node `Buffer`-based FNV-1a implementation):

```json
{ "3512008": 2247560566, "0001001": 3289633977, "3721019A": 2396457167 }
```

`src/lib/generator/seed.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fnv1a32, mulberry32 } from './seed';
import seeds from './fixtures/seeds.json';

describe('fnv1a32', () => {
  it('matches published FNV-1a 32-bit vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });
  it('matches frozen mapblklot seeds', () => {
    for (const [id, h] of Object.entries(seeds)) expect(fnv1a32(id)).toBe(h);
  });
  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // 'é' is two UTF-8 bytes (0xc3 0xa9); hashing the code unit 0xe9 would differ
    let h = 0x811c9dc5;
    for (const b of [0xc3, 0xa9]) h = Math.imul(h ^ b, 0x01000193);
    expect(fnv1a32('é')).toBe(h >>> 0);
  });
  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('3512008');
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
  });
});

describe('mulberry32', () => {
  it('first five outputs for seed 1 are frozen', () => {
    const r = mulberry32(1);
    expect([r(), r(), r(), r(), r()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849
    ]);
  });
  it('outputs lie in [0, 1)', () => {
    const r = mulberry32(fnv1a32('x'));
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});
```

`src/lib/generator/variety.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { drawVariety, varietyFromUniforms } from './variety';
import { mulberry32 } from './seed';

describe('drawVariety', () => {
  it('takes exactly six draws in the frozen order', () => {
    const r = mulberry32(1);
    const u = [r(), r(), r(), r(), r(), r()];
    expect(drawVariety(1)).toEqual({
      edgeInsetM: 0.2 + 0.4 * u[0],
      stepbackM: 1.5 + 1.5 * u[1],
      parapetM: 0.3 + 0.9 * u[2],
      towerSlide: 2 * u[3] - 1,
      towerAspect: 1 + 0.5 * u[4],
      aduEnd: u[5] < 0.5 ? 1 : -1
    });
  });
  it('keeps every draw in range', () => {
    expect(() =>
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
          const d = drawVariety(seed);
          return (
            d.edgeInsetM >= 0.2 && d.edgeInsetM < 0.6 &&
            d.stepbackM >= 1.5 && d.stepbackM < 3 &&
            d.parapetM >= 0.3 && d.parapetM < 1.2 &&
            d.towerSlide >= -1 && d.towerSlide < 1 &&
            d.towerAspect >= 1 && d.towerAspect < 1.5 &&
            (d.aduEnd === 1 || d.aduEnd === -1)
          );
        }),
        { numRuns: 1000 }
      )
    ).not.toThrow();
  });
  it('varietyFromUniforms maps the golden draws', () => {
    expect(varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25])).toEqual({
      edgeInsetM: 0.4,
      stepbackM: 2.25,
      parapetM: 0.75,
      towerSlide: 0,
      towerAspect: 1,
      aduEnd: 1
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest --run --project server src/lib/generator/seed.spec.ts src/lib/generator/variety.spec.ts`
Expected: FAIL (cannot resolve `./seed` / `./variety`).

- [ ] **Step 4: Implement**

`src/lib/generator/types.ts`:

```ts
import type { ParcelId } from '../data/parcel';

/** I10 */
export type TypologyId = 'adu' | 'plex' | 'walkup' | 'podium' | 'midrise' | 'tower';
/** I7 — M1 supports only 'max'; 'likely' is reserved for M2. */
export type BuildoutMode = 'max';
export type ReplacementTypology = Exclude<TypologyId, 'adu'>;

/** I9 */
export interface GeneratedBuilding {
  parcelId: ParcelId;
  source: 'user' /* widens to 'pipeline' | 'scenario' later */;
  typology: TypologyId;
  parts: {
    footprint: [lng: number, lat: number][] /* single outer ring; parcel holes dropped in M1 */;
    baseM: number;
    topM: number;
  }[] /* nested: each part's footprint ⊆ the part below; rendered ground-to-topM */;
  stories: number;
  units: number;
  floorAreaM2: number;
  replacesExisting: boolean;
}
```

`src/lib/generator/constants.ts`:

```ts
import type { ReplacementTypology, TypologyId } from './types';

export const FTF_M = 3.1;
/** Ground floor of podium, midrise and tower only (OD-7, OQ-2). */
export const GROUND_FTF_M = 4.5;
export const EFFICIENCY = 0.8;
export const AVG_UNIT_M2: Record<TypologyId, number> = {
  adu: 55,
  plex: 85,
  walkup: 70,
  podium: 65,
  midrise: 65,
  tower: 70
};
/** Base-footprint coverage; for `tower` this is the podium coverage. */
export const COVERAGE: Record<ReplacementTypology, number> = {
  plex: 0.6,
  walkup: 0.7,
  podium: 0.8,
  midrise: 0.75,
  tower: 0.8
};
export const TOWER_COVERAGE = 0.35;
export const TOWER_PLATE_MAX_M2 = 900;
export const TOWER_PODIUM_STORIES = 5;
export const MIDRISE_STEPBACK_ABOVE = 6;
export const MAX_STORIES = 80;
export const MIN_SITE_M2 = 40;
export const MIN_WIDTH_INSET_M = 1.5;
export const ADU_MIN_OPEN_M2 = 60;
export const ADU_MAX_WIDTH_M = 6.0;
export const ADU_EDGE_GAP_M = 1.0;
export const PLEX_MAX_UNITS = 4;
export const SIMPLIFY_EPS_M = 0.1;
export const CLIPPER_PRECISION = 2;

/** Pieces of base/upper regions smaller than this are dropped (§4.4.6, §4.6). */
export const MIN_PIECE_M2 = 10;
/** Tower plate is fitted inside the podium inset by this much (§4.7). */
export const TOWER_INSET_M = 1.0;
/** ADU is fitted inside the site inset by this much (§4.8). */
export const ADU_INSET_M = 1.0;
/** ADU gross area = 55 / EFFICIENCY (§4.8). */
export const ADU_GROSS_M2 = AVG_UNIT_M2.adu / EFFICIENCY;

export interface TypologyRules {
  coverage: number;
  avgUnitM2: number;
  groundFtfM: number;
  maxUnits: number;
}

/** Per-typology rule table. M3 (policy-levers) overrides values here per envelope. */
export function rulesFor(typ: TypologyId): TypologyRules {
  return {
    coverage: typ === 'adu' ? 0 : COVERAGE[typ],
    avgUnitM2: AVG_UNIT_M2[typ],
    groundFtfM: typ === 'podium' || typ === 'midrise' || typ === 'tower' ? GROUND_FTF_M : FTF_M,
    maxUnits: typ === 'plex' ? PLEX_MAX_UNITS : typ === 'adu' ? 1 : Number.POSITIVE_INFINITY
  };
}
```

`src/lib/generator/seed.ts`:

```ts
const encoder = new TextEncoder();

/** I14: FNV-1a 32-bit over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  const bytes = encoder.encode(s);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: integer ops only, bit-identical in every engine. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`src/lib/generator/variety.ts`:

```ts
import { mulberry32 } from './seed';

export interface VarietyDraws {
  edgeInsetM: number;
  stepbackM: number;
  parapetM: number;
  towerSlide: number /* -1..1 */;
  towerAspect: number /* 1..1.5 */;
  aduEnd: 1 | -1;
}

/** Maps six uniforms in [0,1) to draws, in the frozen order (§4.2). */
export function varietyFromUniforms(r: readonly number[]): VarietyDraws {
  return {
    edgeInsetM: 0.2 + 0.4 * r[0],
    stepbackM: 1.5 + 1.5 * r[1],
    parapetM: 0.3 + 0.9 * r[2],
    towerSlide: 2 * r[3] - 1,
    towerAspect: 1 + 0.5 * r[4],
    aduEnd: r[5] < 0.5 ? 1 : -1
  };
}

/** Always exactly six draws, whatever the typology, so the stream never shifts. */
export function drawVariety(seed: number): VarietyDraws {
  const r = mulberry32(seed);
  return varietyFromUniforms([r(), r(), r(), r(), r(), r()]);
}
```

Note: if prettier reflows the long `&&` chain in `variety.spec.ts`, accept its output.

- [ ] **Step 5: Attribution credit and prettier ignore**

In `src/lib/attribution.ts`, append to `SOFTWARE` (keep the existing entries and order):

```ts
  { name: 'Clipper2 (clipper2-ts)', license: 'BSL-1.0', url: 'https://github.com/countertype/clipper2-ts' }
```

Append to `.prettierignore`:

```
src/lib/generator/fixtures/golden-seeded.json
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest --run --project server src/lib/generator/seed.spec.ts src/lib/generator/variety.spec.ts src/routes/attribution`
Expected: PASS. Also run `npx vitest --run --project client src/routes/attribution` (the attribution page renders `SOFTWARE`); expected PASS.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/generator src/lib/attribution.ts
npx eslint src/lib/generator src/lib/attribution.ts
git add package.json package-lock.json .prettierignore src/lib/attribution.ts src/lib/generator
git commit -m "feat(generator): add seed, variety, constants and clipper2-ts dependency"
```

---

### Task 2: Local geometry primitives (`poly.ts`)

**Files:**
- Create: `src/lib/generator/poly.ts`
- Test: `src/lib/generator/poly.spec.ts`

**Interfaces:**
- Consumes: `CLIPPER_PRECISION`, `MIN_PIECE_M2` from `constants.ts`; `clipper2-ts` (`inflatePathsD`, `intersectD`, `JoinType`, `EndType`, `FillRule`, types `PathD`, `PathsD`). Clipper signatures (verified in `dist/Clipper.d.ts`): `inflatePathsD(paths, delta, joinType, endType, miterLimit?, precision?, arcTolerance?)`, `intersectD(subject, clip, fillRule, precision?)`, `unionD(subject, clip, fillRule, precision?)`, `simplifyPathsD(paths, epsilon, isClosedPath?)`. `PointD = { x: number; y: number; z?: number }`.
- Produces (all exported from `poly.ts`):
  - `interface Vec { x: number; y: number }`
  - `signedArea(p: PathD): number` (CCW positive)
  - `totalArea(paths: PathsD): number` (Σ |signedArea|)
  - `centroid(p: PathD): Vec` (area centroid)
  - `principalAxis(p: PathD, c: Vec): Vec` (unit long axis, sign-normalised)
  - `project(paths: PathsD, o: Vec, d: Vec): { min: number; max: number }` (of `(p − o)·d` over all vertices)
  - `clipSlab(p: PathD, c: Vec, u: Vec, h: number): PathD` (Sutherland–Hodgman to `|(p − c)·u| ≤ h`)
  - `orientedRect(c: Vec, u: Vec, v: Vec, u0: number, u1: number, v0: number, v1: number): PathD` (CCW)
  - `canonicalRing(p: PathD): PathD` (open, no duplicate vertices, CCW, starts at the lexicographically smallest vertex)
  - `inset(paths: PathsD, d: number): PathsD` (Miter, Polygon, miterLimit 2, `CLIPPER_PRECISION`)
  - `intersect(a: PathsD, b: PathsD): PathsD` (NonZero, `CLIPPER_PRECISION`)
  - `keepPieces(paths: PathsD, min?: number): PathsD` (drop pieces with |area| < `min`, default `MIN_PIECE_M2`)
  - `largest(paths: PathsD): PathD | null`

- [ ] **Step 1: Write the failing test**

`src/lib/generator/poly.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PathD } from 'clipper2-ts';
import {
  canonicalRing,
  centroid,
  clipSlab,
  inset,
  intersect,
  keepPieces,
  largest,
  orientedRect,
  principalAxis,
  project,
  signedArea,
  totalArea
} from './poly';

const rect = (w: number, h: number, cx = 0, cy = 0): PathD => [
  { x: cx - w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 },
  { x: cx - w / 2, y: cy + h / 2 }
];
/** Rational rotation (no transcendentals): cos=(1-t²)/(1+t²), sin=2t/(1+t²). */
const rot = (p: PathD, t: number): PathD => {
  const d = 1 + t * t;
  const c = (1 - t * t) / d;
  const s = (2 * t) / d;
  return p.map(({ x, y }) => ({ x: x * c - y * s, y: x * s + y * c }));
};

describe('areas and centroid', () => {
  it('signedArea is positive for CCW and negative for CW', () => {
    expect(signedArea(rect(4, 5))).toBeCloseTo(20, 9);
    expect(signedArea([...rect(4, 5)].reverse())).toBeCloseTo(-20, 9);
    expect(totalArea([rect(4, 5), [...rect(2, 2, 10, 0)].reverse()])).toBeCloseTo(24, 9);
  });
  it('centroid of an offset rectangle and an L', () => {
    const c = centroid(rect(4, 6, 10, -3));
    expect(c.x).toBeCloseTo(10, 9);
    expect(c.y).toBeCloseTo(-3, 9);
    const L: PathD = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }
    ];
    const cl = centroid(L);
    expect(cl.x).toBeCloseTo(5 / 6, 9);
    expect(cl.y).toBeCloseTo(5 / 6, 9);
  });
});

describe('principalAxis', () => {
  it('is the long axis of rotated rectangles, sign-normalised', () => {
    for (const t of [0, 0.1, 0.4, -0.3, 0.9, -0.95]) {
      const p = rot(rect(8, 30), t);
      const u = principalAxis(p, centroid(p));
      const d = 1 + t * t;
      // long side is the rotated (0,1) axis
      let ex = (-2 * t) / d;
      let ey = (1 - t * t) / d;
      if (ex < 0 || (ex === 0 && ey < 0)) {
        ex = -ex;
        ey = -ey;
      }
      expect(u.x).toBeCloseTo(ex, 6);
      expect(u.y).toBeCloseTo(ey, 6);
      expect(u.x * u.x + u.y * u.y).toBeCloseTo(1, 12);
    }
  });
  it('returns (1,0) for a square (tie) whatever its orientation', () => {
    expect(principalAxis(rect(10, 10), { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
    const p = rot(rect(10, 10), 0.3);
    expect(principalAxis(p, centroid(p))).toEqual({ x: 1, y: 0 });
  });
  it('ignores ring orientation', () => {
    const p = rot(rect(8, 30), 0.2);
    const q = [...p].reverse();
    expect(principalAxis(q, centroid(q)).x).toBeCloseTo(principalAxis(p, centroid(p)).x, 12);
  });
});

describe('project and clipSlab', () => {
  it('projects extents along an axis', () => {
    expect(project([rect(8, 30)], { x: 0, y: 0 }, { x: 0, y: 1 })).toEqual({ min: -15, max: 15 });
  });
  it('clips a rectangle to a slab across its long axis', () => {
    const s = clipSlab(rect(8, 30), { x: 0, y: 0 }, { x: 0, y: 1 }, 5);
    expect(Math.abs(signedArea(s))).toBeCloseTo(80, 9);
  });
  it('slab wider than the polygon leaves it whole; zero slab leaves nothing', () => {
    expect(Math.abs(signedArea(clipSlab(rect(8, 30), { x: 0, y: 0 }, { x: 0, y: 1 }, 100)))).toBeCloseTo(240, 9);
    expect(Math.abs(signedArea(clipSlab(rect(8, 30), { x: 0, y: 0 }, { x: 0, y: 1 }, 0)))).toBeCloseTo(0, 9);
  });
});

describe('orientedRect and canonicalRing', () => {
  it('orientedRect is CCW with the requested extents', () => {
    const r = orientedRect({ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, -2, 3, -1, 1);
    expect(signedArea(r)).toBeCloseTo(10, 9);
    expect(project([r], { x: 1, y: 1 }, { x: 1, y: 0 })).toEqual({ min: -2, max: 3 });
  });
  it('canonicalRing orients CCW, drops closing/duplicate vertices, starts at min vertex', () => {
    const ring: PathD = [
      { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }
    ];
    // input is CCW already? (1,1)->(0,1)->(0,0)->(1,0) is CCW
    expect(canonicalRing(ring)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
    ]);
    expect(canonicalRing([...ring].reverse())).toEqual(canonicalRing(ring));
  });
});

describe('clipper wrappers', () => {
  it('inset is orientation-independent and collapses slivers', () => {
    expect(totalArea(inset([rect(10, 30)], 1))).toBeCloseTo(8 * 28, 6);
    expect(totalArea(inset([[...rect(10, 30)].reverse()], 1))).toBeCloseTo(8 * 28, 6);
    expect(inset([rect(1.5, 60)], 1.5)).toEqual([]);
  });
  it('width test: a 2.5 m wide strip does not survive a further 1.5 m inset', () => {
    expect(inset([rect(2.5, 40)], 1.5)).toEqual([]);
    expect(inset([rect(3.2, 40)], 1.5).length).toBe(1);
  });
  it('intersect, keepPieces and largest', () => {
    const r = intersect([rect(10, 10)], [rect(10, 10, 5, 0)]);
    expect(totalArea(r)).toBeCloseTo(50, 6);
    expect(keepPieces([rect(3, 3), rect(4, 4)])).toEqual([rect(4, 4)]);
    expect(largest([rect(3, 3), rect(4, 4)])).toEqual(rect(4, 4));
    expect(largest([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run --project server src/lib/generator/poly.spec.ts`
Expected: FAIL (cannot resolve `./poly`).

- [ ] **Step 3: Implement `poly.ts`**

```ts
import {
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  JoinType,
  type PathD,
  type PathsD
} from 'clipper2-ts';
import { CLIPPER_PRECISION, MIN_PIECE_M2 } from './constants';

export interface Vec {
  x: number;
  y: number;
}

/** Shoelace area; CCW (y up) is positive. */
export function signedArea(p: PathD): number {
  let s = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function totalArea(paths: PathsD): number {
  let s = 0;
  for (const p of paths) s += Math.abs(signedArea(p));
  return s;
}

/** Area centroid (computed relative to the first vertex for stability). */
export function centroid(p: PathD): Vec {
  const ox = p[0].x;
  const oy = p[0].y;
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const x0 = p[i].x - ox;
    const y0 = p[i].y - oy;
    const x1 = p[(i + 1) % n].x - ox;
    const y1 = p[(i + 1) % n].y - oy;
    const cr = x0 * y1 - x1 * y0;
    a2 += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  return { x: ox + cx / (3 * a2), y: oy + cy / (3 * a2) };
}

/**
 * Long principal axis: eigenvector of the larger eigenvalue of the second-moment matrix
 * about `c` (closed-form 2×2). Tie → (1,0). Sign: u.x > 0, or u.x = 0 and u.y > 0.
 */
export function principalAxis(p: PathD, c: Vec): Vec {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const x0 = p[i].x - c.x;
    const y0 = p[i].y - c.y;
    const x1 = p[(i + 1) % n].x - c.x;
    const y1 = p[(i + 1) % n].y - c.y;
    const cr = x0 * y1 - x1 * y0;
    sxx += cr * (x0 * x0 + x0 * x1 + x1 * x1);
    syy += cr * (y0 * y0 + y0 * y1 + y1 * y1);
    sxy += cr * (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0);
  }
  sxx /= 12;
  syy /= 12;
  sxy /= 24;
  if (sxx + syy < 0) {
    // clockwise ring: every moment has its sign flipped
    sxx = -sxx;
    syy = -syy;
    sxy = -sxy;
  }
  const half = (sxx - syy) / 2;
  const disc = Math.sqrt(half * half + sxy * sxy);
  const mean = (sxx + syy) / 2;
  const l1 = mean + disc;
  const l2 = mean - disc;
  if (l1 - l2 <= 1e-9 * (l1 + l2)) return { x: 1, y: 0 };
  // (λ1 − syy, sxy) and (sxy, λ1 − sxx) are both eigenvectors; pick the better-conditioned one
  let ux: number;
  let uy: number;
  if (half >= 0) {
    ux = half + disc;
    uy = sxy;
  } else {
    ux = sxy;
    uy = disc - half;
  }
  const len = Math.sqrt(ux * ux + uy * uy);
  ux /= len;
  uy /= len;
  if (ux < 0 || (ux === 0 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { x: ux, y: uy };
}

export function project(paths: PathsD, o: Vec, d: Vec): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of paths) {
    for (const q of p) {
      const t = (q.x - o.x) * d.x + (q.y - o.y) * d.y;
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  return { min, max };
}

/** Sutherland–Hodgman against the half-plane nx·x + ny·y ≤ k. */
function clipHalf(poly: PathD, nx: number, ny: number, k: number): PathD {
  const out: PathD = [];
  const n = poly.length;
  if (n === 0) return out;
  let prev = poly[n - 1];
  let dp = nx * prev.x + ny * prev.y - k;
  for (const cur of poly) {
    const dc = nx * cur.x + ny * cur.y - k;
    if (dc <= 0) {
      if (dp > 0) {
        const t = dp / (dp - dc);
        out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
      }
      out.push(cur);
    } else if (dp <= 0) {
      const t = dp / (dp - dc);
      out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
    }
    prev = cur;
    dp = dc;
  }
  return out;
}

/** Clip `p` to the slab |(q − c)·u| ≤ h (two half-planes, in-house, no Clipper). */
export function clipSlab(p: PathD, c: Vec, u: Vec, h: number): PathD {
  const k = u.x * c.x + u.y * c.y;
  return clipHalf(clipHalf(p, u.x, u.y, k + h), -u.x, -u.y, -(k - h));
}

/** Rectangle c + t·u + s·v for t∈[u0,u1], s∈[v0,v1]; CCW when v = rot90(u). */
export function orientedRect(
  c: Vec,
  u: Vec,
  v: Vec,
  u0: number,
  u1: number,
  v0: number,
  v1: number
): PathD {
  const at = (t: number, s: number) => ({ x: c.x + t * u.x + s * v.x, y: c.y + t * u.y + s * v.y });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

/** Open ring, no repeated vertices, CCW, starting at the lexicographically smallest (x, y). */
export function canonicalRing(p: PathD): PathD {
  const pts: PathD = [];
  for (const q of p) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) pts.push({ x: q.x, y: q.y });
  }
  while (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) {
    pts.pop();
  }
  if (signedArea(pts) < 0) pts.reverse();
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[start].x || (pts[i].x === pts[start].x && pts[i].y < pts[start].y)) start = i;
  }
  return pts.slice(start).concat(pts.slice(0, start));
}

/** Inward offset by `d` metres (Miter, closed polygons, cm grid). */
export function inset(paths: PathsD, d: number): PathsD {
  return inflatePathsD(paths, -d, JoinType.Miter, EndType.Polygon, 2, CLIPPER_PRECISION);
}

export function intersect(a: PathsD, b: PathsD): PathsD {
  return intersectD(a, b, FillRule.NonZero, CLIPPER_PRECISION);
}

export function keepPieces(paths: PathsD, min = MIN_PIECE_M2): PathsD {
  return paths.filter((p) => Math.abs(signedArea(p)) >= min);
}

export function largest(paths: PathsD): PathD | null {
  let best: PathD | null = null;
  let bestA = -1;
  for (const p of paths) {
    const a = Math.abs(signedArea(p));
    if (a > bestA) {
      best = p;
      bestA = a;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run --project server src/lib/generator/poly.spec.ts`
Expected: PASS. If the Clipper-backed assertions differ by the cm grid, use `toBeCloseTo(x, 1)` for those areas only, never for the pure-TS ones.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/generator && npx eslint src/lib/generator
git add src/lib/generator/poly.ts src/lib/generator/poly.spec.ts
git commit -m "feat(generator): add local geometry primitives"
```

---

### Task 3: Site normalisation and typology selection

**Files:**
- Create: `src/lib/generator/site.ts`, `src/lib/generator/select.ts`
- Test: `src/lib/generator/site.spec.ts`, `src/lib/generator/select.spec.ts`

**Interfaces:**
- Consumes: `poly.ts` (`Vec`, `signedArea`, `centroid`, `principalAxis`, `canonicalRing`, `inset`, `keepPieces`); constants `SIMPLIFY_EPS_M`, `MIN_SITE_M2`, `MIN_WIDTH_INSET_M`, `CLIPPER_PRECISION`; `clipper2-ts` `unionD`, `simplifyPathsD`, `FillRule`.
- Produces:
  - `site.ts`: `interface Site { P: PathD; A: number; c: Vec; u: Vec; v: Vec; Q: PathsD }` (`P` canonical CCW site ring in local metres; `A = |area(P)|`; `c` centroid of `P`; `u` long principal axis; `v = (−u.y, u.x)`; `Q` = base region pieces ≥ 10 m²) and `normaliseSite(polygon: [number, number][][], edgeInsetM: number): Site | null` (§4.4 steps 4–6).
  - `select.ts`: `selectTypology(S: number, A: number, existingUnits: number): { typology: TypologyId; stories: number }` (§4.5; `S` is an integer 1..80).

- [ ] **Step 1: Write the failing tests**

`src/lib/generator/select.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectTypology } from './select';

describe('selectTypology (§4.5)', () => {
  it.each([
    // [S, A, existingUnits, typology, stories]
    [13, 1500, 1, 'tower', 13],
    [80, 5000, 1, 'tower', 80],
    [13, 1499.99, 1, 'midrise', 12],
    [30, 1200, 1, 'midrise', 12],
    [13, 599.99, 1, 'podium', 7],
    [13, 399.99, 1, 'walkup', 5],
    [8, 600, 1, 'midrise', 8],
    [12, 600, 1, 'midrise', 12],
    [12, 599.99, 1, 'podium', 7],
    [8, 399.99, 1, 'walkup', 5],
    [12, 232.3, 1, 'walkup', 5],
    [5, 400, 1, 'podium', 5],
    [7, 400, 1, 'podium', 7],
    [5, 399.99, 1, 'walkup', 5],
    [7, 399.99, 1, 'walkup', 5],
    [6, 399.99, 1, 'walkup', 5],
    [4, 5000, 1, 'walkup', 4],
    [3, 5000, 1, 'plex', 3],
    [2, 232.3, 1, 'adu', 2],
    [1, 232.3, 3, 'adu', 1],
    [2, 232.3, 0, 'plex', 2],
    [1, 232.3, 0, 'plex', 1]
  ] as const)('S=%i A=%f units=%i → %s %i', (S, A, eu, typology, stories) => {
    expect(selectTypology(S, A, eu)).toEqual({ typology, stories });
  });
});
```

`src/lib/generator/site.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normaliseSite } from './site';
import { signedArea, totalArea } from './poly';

type Ring = [number, number][];
const rect = (w: number, h: number, cx = 0, cy = 0): Ring => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2]
];
const STD = rect(7.62, 30.48);

describe('normaliseSite (§4.4)', () => {
  it('standard lot: A, centroid, long axis, inset base region', () => {
    const s = normaliseSite([STD], 0.4)!;
    expect(s.A).toBeCloseTo(232.26, 2);
    expect(s.c.x).toBeCloseTo(0, 9);
    expect(s.c.y).toBeCloseTo(0, 9);
    expect(s.u.x).toBeCloseTo(0, 9);
    expect(s.u.y).toBeCloseTo(1, 9);
    expect(s.v.x).toBeCloseTo(-1, 9);
    expect(s.v.y).toBeCloseTo(0, 9);
    expect(totalArea(s.Q)).toBeCloseTo(6.82 * 29.68, 1);
    expect(signedArea(s.P)).toBeGreaterThan(0);
  });
  it('tiny (6×6 m, A=36 < 40) → null', () => {
    expect(normaliseSite([rect(6, 6)], 0.4)).toBeNull();
  });
  it('sliver (1.5×60 m) fails the width test → null', () => {
    expect(normaliseSite([rect(1.5, 60)], 0.4)).toBeNull();
  });
  it('no rings, or rings with < 3 distinct vertices → null', () => {
    expect(normaliseSite([], 0.4)).toBeNull();
    expect(normaliseSite([[[0, 0], [1, 1], [0, 0]]], 0.4)).toBeNull();
  });
  it('multipart: the largest part is the site, the other part is ignored', () => {
    const s = normaliseSite([STD, rect(5, 10, 12.5, 5)], 0.4)!;
    expect(s).toEqual(normaliseSite([STD], 0.4));
  });
  it('holed: holes are dropped, the outer ring is used', () => {
    const hole: Ring = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
    expect(normaliseSite([STD, hole], 0.4)).toEqual(normaliseSite([STD], 0.4));
  });
  it('clockwise single ring gives the same site', () => {
    expect(normaliseSite([[...STD].reverse()], 0.4)).toEqual(normaliseSite([STD], 0.4));
  });
  // Review Focus 1
  it('rings with non-finite coordinates are dropped, never thrown on', () => {
    expect(normaliseSite([[[0, 0], [NaN, 1], [5, 5], [0, 9]]], 0.4)).toBeNull();
    expect(normaliseSite([[[0, 0], [Infinity, 0], [5, 5]], STD], 0.4)).toEqual(
      normaliseSite([STD], 0.4)
    );
  });
  // Review Focus 2
  it('closed rings and repeated vertices equal the open ring', () => {
    const closed: Ring = [...STD, STD[0]];
    const dup: Ring = [STD[0], STD[0], STD[1], STD[2], STD[2], STD[3]];
    expect(normaliseSite([closed], 0.4)).toEqual(normaliseSite([STD], 0.4));
    expect(normaliseSite([dup], 0.4)).toEqual(normaliseSite([STD], 0.4));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run --project server src/lib/generator/site.spec.ts src/lib/generator/select.spec.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/lib/generator/select.ts`:

```ts
import type { TypologyId } from './types';

/**
 * §4.5. "Capped at" caps both typology and stories. `S` is the painted story count after
 * floor and clamp (integer 1..80); the returned `stories` is the built count.
 */
export function selectTypology(
  S: number,
  A: number,
  existingUnits: number
): { typology: TypologyId; stories: number } {
  if (S >= 13) {
    return A >= 1500 ? { typology: 'tower', stories: S } : selectTypology(12, A, existingUnits);
  }
  if (S >= 8) {
    return A >= 600 ? { typology: 'midrise', stories: S } : selectTypology(7, A, existingUnits);
  }
  if (S >= 5) {
    return A >= 400
      ? { typology: 'podium', stories: S }
      : { typology: 'walkup', stories: Math.min(S, 5) };
  }
  if (S === 4) return { typology: 'walkup', stories: 4 };
  if (S === 3) return { typology: 'plex', stories: 3 };
  return existingUnits >= 1 ? { typology: 'adu', stories: S } : { typology: 'plex', stories: S };
}
```

`src/lib/generator/site.ts`:

```ts
import { FillRule, simplifyPathsD, unionD, type PathD, type PathsD } from 'clipper2-ts';
import { CLIPPER_PRECISION, MIN_SITE_M2, MIN_WIDTH_INSET_M, SIMPLIFY_EPS_M } from './constants';
import {
  canonicalRing,
  centroid,
  inset,
  keepPieces,
  principalAxis,
  signedArea,
  type Vec
} from './poly';

export interface Site {
  /** Site ring (local metres), canonical: open, CCW, no holes. */
  P: PathD;
  /** |area(P)| in m². */
  A: number;
  /** Area centroid of P. */
  c: Vec;
  /** Long principal axis of P (unit). */
  u: Vec;
  /** u rotated +90°. */
  v: Vec;
  /** Base region: P inset by the edge inset, pieces ≥ 10 m². */
  Q: PathsD;
}

/** Open, de-duplicated ring; [] if any coordinate is non-finite or < 3 distinct vertices. */
function cleanRing(ring: readonly (readonly number[])[]): PathD {
  const out: PathD = [];
  for (const pt of ring) {
    const x = pt[0];
    const y = pt[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const last = out[out.length - 1];
    if (!last || last.x !== x || last.y !== y) out.push({ x, y });
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) {
    out.pop();
  }
  const distinct = new Set(out.map((p) => p.x + ',' + p.y));
  return distinct.size >= 3 ? out : [];
}

/** §4.4 steps 4–6. Returns null for degenerate parcels. */
export function normaliseSite(polygon: [number, number][][], edgeInsetM: number): Site | null {
  const rings: PathsD = [];
  for (const ring of polygon) {
    const r = cleanRing(ring);
    if (r.length) rings.push(r);
  }
  if (rings.length === 0) return null;

  let P: PathD | null;
  if (rings.length === 1) {
    P = rings[0];
  } else {
    // Resolves holes and disjoint parts without trusting ring orientation. Outers come back
    // positive; holes negative. The largest positive path is the site's outer ring.
    const merged = unionD(rings, [], FillRule.EvenOdd, CLIPPER_PRECISION);
    P = null;
    let best = 0;
    for (const p of merged) {
      const a = signedArea(p);
      if (a > best) {
        best = a;
        P = p;
      }
    }
    if (!P) return null;
  }
  P = canonicalRing(P);
  const simplified = simplifyPathsD([P], SIMPLIFY_EPS_M, true);
  if (simplified.length === 0 || simplified[0].length < 3) return null;
  P = canonicalRing(simplified[0]);

  const A = Math.abs(signedArea(P));
  if (!(A >= MIN_SITE_M2)) return null;

  const Q = keepPieces(inset([P], edgeInsetM));
  if (Q.length === 0) return null;
  if (inset(Q, MIN_WIDTH_INSET_M).length === 0) return null;

  const c = centroid(P);
  const u = principalAxis(P, c);
  // `+ 0` turns -0 into 0 so structurally equal sites compare equal
  return { P, A, c, u, v: { x: -u.y + 0, y: u.x + 0 }, Q };
}
```

If `unionD(rings, [], …)` rejects an empty clip, use the two-argument overload `unionD(rings, FillRule.EvenOdd)` and confirm (by reading `node_modules/clipper2-ts/dist/Clipper.js`) that its default precision is 2; if it is not, keep the four-argument form with a clip of `[]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run --project server src/lib/generator/site.spec.ts src/lib/generator/select.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/generator && npx eslint src/lib/generator
git add src/lib/generator/site.ts src/lib/generator/site.spec.ts src/lib/generator/select.ts src/lib/generator/select.spec.ts
git commit -m "feat(generator): add site normalisation and typology selection"
```

---

### Task 4: Local metres → `[lng, lat]` and the transcendental-function guard

**Files:**
- Create: `src/lib/generator/geo.ts`
- Test: `src/lib/generator/geo.spec.ts`, `src/lib/generator/determinism.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (`mulberry32` from `seed.ts` in the test).
- Produces: `toLngLat(ring: readonly (readonly [number, number])[], labelPoint: readonly [number, number]): [number, number][]` — converts every vertex; preserves vertex order (a CCW local ring stays CCW in lng/lat); rounds each coordinate to 1e-7°.

- [ ] **Step 1: Write the failing tests**

`src/lib/generator/geo.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import { toLngLat } from './geo';
import { mulberry32 } from './seed';

// https://epsg.io/7131.proj4
const EPSG7131 =
  '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const fwd = (p: [number, number]) => proj4('EPSG:4326', EPSG7131, p) as [number, number];

describe('toLngLat (§4.10)', () => {
  it('is within 0.05 m of proj4 EPSG:7131 for 500 seeded points with offsets ≤ 500 m', () => {
    const r = mulberry32(7131);
    let maxErr = 0;
    for (let i = 0; i < 500; i++) {
      const label: [number, number] = [-122.52 + 0.17 * r(), 37.7 + 0.13 * r()];
      const dx = (2 * r() - 1) * 500;
      const dy = (2 * r() - 1) * 500;
      const [o] = [fwd(label)];
      const [[lng, lat]] = toLngLat([[dx, dy]], label);
      const p = fwd([lng, lat]);
      const err = Math.hypot(p[0] - o[0] - dx, p[1] - o[1] - dy);
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThanOrEqual(0.05);
  });
  it('maps the origin to the label point', () => {
    expect(toLngLat([[0, 0]], [-122.4194, 37.7749])).toEqual([[-122.4194, 37.7749]]);
  });
  it('rounds to 1e-7 degrees', () => {
    for (const [lng, lat] of toLngLat([[123.456, -78.9]], [-122.4194, 37.7749])) {
      expect(Math.round(lng * 1e7) / 1e7).toBe(lng);
      expect(Math.round(lat * 1e7) / 1e7).toBe(lat);
    }
  });
  it('keeps a CCW ring CCW', () => {
    const out = toLngLat(
      [[-5, -5], [5, -5], [5, 5], [-5, 5]],
      [-122.4194, 37.7749]
    );
    let s = 0;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    expect(s).toBeGreaterThan(0);
  });
});
```

`src/lib/generator/determinism.spec.ts` (AC4):

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src/lib/generator');
const ALLOWED = new Set(['geo.ts', 'determinism.spec.ts']);
// Built from parts so this file never matches itself.
const BANNED = new RegExp('Math\\.' + '(sin|cos|atan2|pow|exp)\\b');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('numeric determinism guard (AC4)', () => {
  it('no Math.sin/cos/atan2/pow/exp outside geo.ts', () => {
    const offenders = walk(ROOT)
      .filter((p) => !ALLOWED.has(relative(ROOT, p)))
      .filter((p) => BANNED.test(readFileSync(p, 'utf8')))
      .map((p) => relative(ROOT, p));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run --project server src/lib/generator/geo.spec.ts src/lib/generator/determinism.spec.ts`
Expected: `geo.spec.ts` FAILS (no `./geo`); `determinism.spec.ts` passes already (nothing banned yet) — that is fine, it is a guard.

- [ ] **Step 3: Implement `geo.ts`**

```ts
// The only generator module allowed transcendental Math (AC4). Output is rounded to 1e-7°.
// I6's frame is EPSG:7131 (TM, lat_0=37.75, lon_0=-122.45, k=1.000007, GRS80) translated so
// the label point is (0,0). Local tangent-plane approximation; ≤ 0.05 m within 500 m (§4.10).

const D2R = Math.PI / 180;
const A_GRS80 = 6378137;
const E2_GRS80 = 0.0066943800229;
const LON0 = -122.45;

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

export function toLngLat(
  ring: readonly (readonly [number, number])[],
  labelPoint: readonly [number, number]
): [number, number][] {
  const lng0 = labelPoint[0];
  const lat0 = labelPoint[1];
  const phi = lat0 * D2R;
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  // grid convergence γ (degrees) = (λ0 − lon_0)·sin φ0; rotate grid → true north
  const g = (lng0 - LON0) * sinP * D2R;
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  const W = 1 - E2_GRS80 * sinP * sinP;
  const M = (A_GRS80 * (1 - E2_GRS80)) / Math.pow(W, 1.5);
  const N = A_GRS80 / Math.sqrt(W);
  const degPerMLat = 1 / (M * D2R);
  const degPerMLng = 1 / (N * cosP * D2R);
  return ring.map(([x, y]) => {
    const e = x * cg + y * sg;
    const n = -x * sg + y * cg;
    return [r7(lng0 + e * degPerMLng), r7(lat0 + n * degPerMLat)];
  });
}
```

(Pre-plan check, 2026-10-10: this exact formula against proj4 2.22.0 over 500 seeded SF points gave a max error of 0.036 m before rounding.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run --project server src/lib/generator/geo.spec.ts src/lib/generator/determinism.spec.ts`
Expected: PASS. If TypeScript complains about `proj4` types, it ships `dist/index.d.ts`; check the import is the default import shown.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/generator && npx eslint src/lib/generator
git add src/lib/generator/geo.ts src/lib/generator/geo.spec.ts src/lib/generator/determinism.spec.ts
git commit -m "feat(generator): convert local metres to lng/lat and guard transcendental math"
```

---

### Task 5: Base footprint, low-rise massing, ADU, `generate` and golden fixtures

**Files:**
- Create: `src/lib/generator/massing.ts`, `src/lib/generator/generate.ts`, `src/lib/generator/index.ts`, `src/lib/generator/fixtures/*.json` (listed below)
- Test: `src/lib/generator/massing.spec.ts`, `src/lib/generator/golden.spec.ts`

**Interfaces:**
- Consumes: `Site`, `normaliseSite` (Task 3); `selectTypology` (Task 3); `poly.ts` (Task 2); `toLngLat` (Task 4); `VarietyDraws`, `drawVariety` (Task 1); constants; types `ParcelRecord` (`../data/parcel`), `Envelope` (`../plan/types`).
- Produces:
  - `massing.ts`:
    - `interface MassPart { ring: PathD; baseM: number; topM: number /* pre-parapet, unrounded */; floors: number; reachesTop: boolean }`
    - `interface Massing { typology: TypologyId; stories: number; parts: MassPart[]; floorAreaM2: number /* unrounded */ }`
    - `floorTop(typology: TypologyId, k: number): number` — top of floor `k` = `g + (k−1)·FTF_M`
    - `baseFootprint(site: Site, target: number): PathsD`
    - `massTypology(site: Site, typology: ReplacementTypology, stories: number, draws: VarietyDraws): Massing | null` (this task: plex/walkup/podium; Task 6 adds midrise/tower — until then midrise/tower fall through to the low-rise branch and the Task 6 golden rows are not yet written)
    - `massAdu(site: Site, stories: number, draws: VarietyDraws): Massing | null`
  - `generate.ts`:
    - `interface LocalPart { ring: [number, number][]; baseM: number; topM: number }` (local metres, open CCW ring, same vertex order as the output footprint; `baseM`/`topM` exactly as in the output)
    - `interface Detailed { building: GeneratedBuilding; local: LocalPart[]; site: Site }`
    - `aduOpenOk(parcel: ParcelRecord, A: number): boolean`
    - `generateDetailed(parcel: ParcelRecord, env: Envelope, draws: VarietyDraws, mode: BuildoutMode): Detailed | null`
    - `generateWith(parcel, env, draws, mode): GeneratedBuilding | null` (test seam named in the spec)
    - `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding | null` (I8)
  - `index.ts`: exports `generate`, `fnv1a32`, `selectTypology`, `massTypology`, `drawVariety`, and types `TypologyId`, `BuildoutMode`, `GeneratedBuilding`, `VarietyDraws`. (Task 8 adds `createGeneratorCache`, `GeneratorCache`.)

- [ ] **Step 1: Write the fixtures**

Every fixture is a full `ParcelRecord` with `polygon` in local metres centred on the origin. Shared defaults (the spec's default existing building is a 2-story single-family house): `"labelPoint": [-122.4194, 37.7749]`, `"existingUnits": 1`, `"existingFloorAreaM2": 180`, `"existingHeightM": 7`, `"landUse": "RESIDENTIAL"`, `"eligible": true`, `"neighborhood": "Mission"`. `areaM2` is the polygon area.

`src/lib/generator/fixtures/std-25x100.json`:

```json
{
  "id": "0000001",
  "polygon": [[[-3.81, -15.24], [3.81, -15.24], [3.81, 15.24], [-3.81, 15.24]]],
  "labelPoint": [-122.4194, 37.7749],
  "areaM2": 232.2576,
  "existingUnits": 1,
  "existingFloorAreaM2": 180,
  "existingHeightM": 7,
  "landUse": "RESIDENTIAL",
  "eligible": true,
  "neighborhood": "Mission"
}
```

The remaining fixtures differ from `std-25x100.json` only in the fields shown (copy the whole record and change these):

| file | `id` | `polygon` | other overrides |
|---|---|---|---|
| `shallow-adu-fail.json` | `0000002` | `[[[-3.81,-7.5],[3.81,-7.5],[3.81,7.5],[-3.81,7.5]]]` | `areaM2 114.3`, `existingFloorAreaM2 160`, `existingHeightM 6.2` |
| `lot-1000.json` | `0000003` | `[[[-12.5,-20],[12.5,-20],[12.5,20],[-12.5,20]]]` | `areaM2 1000` |
| `lot-3000.json` | `0000004` | `[[[-30,-25],[30,-25],[30,25],[-30,25]]]` | `areaM2 3000` |
| `lot-1200.json` | `0000005` | `[[[-20,-15],[20,-15],[20,15],[-20,15]]]` | `areaM2 1200` |
| `std-over-apartment.json` | `0000006` | std polygon | `existingUnits 8`, `existingFloorAreaM2 700`, `existingHeightM 10` |
| `std-over-10units.json` | `0000007` | std polygon | `existingUnits 10`, `existingFloorAreaM2 600`, `existingHeightM 10` |
| `vacant-std.json` | `0000008` | std polygon | `existingUnits 0`, `existingFloorAreaM2 0`, `existingHeightM 0`, `landUse "VACANT"` |
| `sliver.json` | `0000009` | `[[[-0.75,-30],[0.75,-30],[0.75,30],[-0.75,30]]]` | `areaM2 90` |
| `tiny.json` | `0000010` | `[[[-3,-3],[3,-3],[3,3],[-3,3]]]` | `areaM2 36` |
| `multipart.json` | `0000011` | std ring, then `[[10,0],[15,0],[15,10],[10,10]]` | `areaM2 282.2576` |
| `holed.json` | `0000012` | std ring, then `[[-1,-1],[-1,1],[1,1],[1,-1]]` | `areaM2 228.2576` |
| `lshape.json` | `0000013` | `[[[-10,-10],[10,-10],[10,0],[0,0],[0,10],[-10,10]]]` | `areaM2 300` |

- [ ] **Step 2: Write the failing tests**

`src/lib/generator/golden.spec.ts` (Task 6 appends midrise/tower rows to this file):

```ts
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generate, generateDetailed, generateWith, type Detailed } from './generate';
import { varietyFromUniforms } from './variety';
import { signedArea } from './poly';
import std from './fixtures/std-25x100.json';
import shallow from './fixtures/shallow-adu-fail.json';
import lot1000 from './fixtures/lot-1000.json';
import overApt from './fixtures/std-over-apartment.json';
import over10 from './fixtures/std-over-10units.json';
import vacant from './fixtures/vacant-std.json';
import sliver from './fixtures/sliver.json';
import tiny from './fixtures/tiny.json';
import multipart from './fixtures/multipart.json';
import holed from './fixtures/holed.json';
import lshape from './fixtures/lshape.json';

/** Golden draws r = [0.5, 0.5, 0.5, 0.5, 0, x]: inset 0.4, stepback 2.25, parapet 0.75, slide 0, aspect 1. */
const GOLDEN = varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25]);
const P = (j: unknown) => j as ParcelRecord;
const run = (j: unknown, S: number) => generateDetailed(P(j), { maxStories: S }, GOLDEN, 'max');
const localArea = (d: Detailed, i: number) =>
  Math.abs(signedArea(d.local[i].ring.map(([x, y]) => ({ x, y }))));
/** Building without parcelId, footprints as sorted vertex lists (start vertex may differ). */
const shape = (d: Detailed | null) =>
  d && {
    ...d.building,
    parcelId: undefined,
    parts: d.building.parts.map((p) => ({ ...p, footprint: [...p.footprint].sort() }))
  };

describe('golden fixtures (hand-calculated, §6)', () => {
  it('std 25×100 S=3 → plex', () => {
    const d = run(std, 3)!;
    expect(d.building.typology).toBe('plex');
    expect(d.building.stories).toBe(3);
    expect(d.building.units).toBe(3);
    expect(d.building.replacesExisting).toBe(true);
    expect(d.building.parts).toHaveLength(1);
    expect(localArea(d, 0)).toBeCloseTo(139.4, 0); // ±0.5
    expect(Math.abs(d.building.floorAreaM2 - 418.1)).toBeLessThanOrEqual(2);
    expect(d.building.parts[0].baseM).toBe(0);
    expect(d.building.parts[0].topM).toBe(10.05); // 3×3.1 + 0.75
    expect(d.building.source).toBe('user');
    expect(d.building.parcelId).toBe('0000001');
  });
  it('std S=5 → walkup, FA 812.9, units 9', () => {
    const b = run(std, 5)!.building;
    expect(b.typology).toBe('walkup');
    expect(Math.abs(b.floorAreaM2 - 812.9)).toBeLessThanOrEqual(2);
    expect(b.units).toBe(9);
  });
  it('std S=12 → walkup via the cap chain, 5 stories, 9 units', () => {
    const b = run(std, 12)!.building;
    expect(b).toMatchObject({ typology: 'walkup', stories: 5, units: 9 });
  });
  it('std S=2 → adu, FA 68.75, 1 unit, keeps the existing building', () => {
    const b = run(std, 2)!.building;
    expect(b).toMatchObject({ typology: 'adu', stories: 2, units: 1, replacesExisting: false });
    expect(Math.abs(b.floorAreaM2 - 68.75)).toBeLessThanOrEqual(2);
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0]).toMatchObject({ baseM: 0, topM: 6.95 }); // 2×3.1 + 0.75
  });
  it('shallow lot S=2 → null (open 34 m² < 60)', () => {
    expect(run(shallow, 2)).toBeNull();
  });
  it('lot-1000 S=6 → podium, FA 4800, 59 units, top 20.0 + 0.75', () => {
    const b = run(lot1000, 6)!.building;
    expect(b.typology).toBe('podium');
    expect(Math.abs(b.floorAreaM2 - 4800)).toBeLessThanOrEqual(2);
    expect(b.units).toBe(59);
    expect(b.parts.map((p) => p.topM)).toEqual([20.75]);
  });
  it('std over an 8-unit apartment (FA 700) S=3 → null (N6)', () => {
    expect(run(overApt, 3)).toBeNull();
  });
  it('std over 10 units (FA 600) S=5 → null (N7)', () => {
    expect(run(over10, 5)).toBeNull();
  });
  it('vacant std S=2 → plex replacement, 2 stories, FA 278.7, 2 units', () => {
    const b = run(vacant, 2)!.building;
    expect(b).toMatchObject({ typology: 'plex', stories: 2, units: 2, replacesExisting: true });
    expect(Math.abs(b.floorAreaM2 - 278.7)).toBeLessThanOrEqual(2);
  });
  it('sliver and tiny → null at any S', () => {
    for (const S of [1, 3, 5, 12, 40]) {
      expect(run(sliver, S)).toBeNull();
      expect(run(tiny, S)).toBeNull();
    }
  });
  it('multipart and holed equal the std S=3 result', () => {
    expect(shape(run(multipart, 3))).toEqual(shape(run(std, 3)));
    expect(shape(run(holed, 3))).toEqual(shape(run(std, 3)));
  });
  it('lshape S=5 → walkup, ≥ 1 part, footprint ≤ 0.7·A·1.001', () => {
    const d = run(lshape, 5)!;
    expect(d.building.typology).toBe('walkup');
    expect(d.local.length).toBeGreaterThanOrEqual(1);
    const base = d.local.reduce((s, _, i) => s + localArea(d, i), 0);
    expect(base).toBeLessThanOrEqual(0.7 * 300 * 1.001);
  });
});

describe('I8 contract and mode', () => {
  it('unsupported mode throws', () => {
    expect(() => generate(P(std), { maxStories: 3 }, 1, 'likely' as never)).toThrow(
      'unsupported BuildoutMode'
    );
  });
  it('ineligible parcel → null', () => {
    expect(generateWith(P({ ...std, eligible: false }), { maxStories: 3 }, GOLDEN, 'max')).toBeNull();
  });
  it('generate draws variety from the seed', () => {
    const a = generate(P(std), { maxStories: 3 }, 1, 'max');
    const b = generate(P(std), { maxStories: 3 }, 1, 'max');
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });
  // Review Focus 3
  it('clockwise outer ring gives the same building', () => {
    const cw = { ...std, polygon: [[...std.polygon[0]].reverse()] };
    expect(shape(run(cw, 3))).toEqual(shape(run(std, 3)));
    expect(shape(run(cw, 2))).toEqual(shape(run(std, 2)));
  });
  // Review Focus 4
  it('odd envelope values floor, null or clamp; unknown fields are ignored', () => {
    expect(run(std, 5.7)!.building).toEqual(run(std, 5)!.building);
    for (const S of [0, 0.9, -3, NaN, Infinity, -Infinity]) expect(run(std, S)).toBeNull();
    expect(run(lot1000, 1e9)!.building.stories).toBeLessThanOrEqual(80);
    const extra = { maxStories: 3, farMax: 2, setbackM: 9 } as unknown as { maxStories: number };
    expect(generateWith(P(std), extra, GOLDEN, 'max')).toEqual(run(std, 3)!.building);
  });
  it('local parts mirror the output parts', () => {
    const d = run(std, 3)!;
    expect(d.local.map((l) => [l.baseM, l.topM])).toEqual(
      d.building.parts.map((p) => [p.baseM, p.topM])
    );
    expect(d.local[0].ring.length).toBe(d.building.parts[0].footprint.length);
  });
});
```

Note: `run(lot1000, 1e9)` exercises the clamp; until Task 6 lands, the tower branch on a 1,000 m² lot already caps to midrise 12 via selection (A < 1500), so `stories ≤ 80` holds now and stays meaningful.

`src/lib/generator/massing.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { baseFootprint, floorTop } from './massing';
import { normaliseSite } from './site';
import { totalArea, project } from './poly';

const rect = (w: number, h: number): [number, number][] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2]
];

describe('floorTop', () => {
  it('uses 3.1 m floors, 4.5 m ground for podium/midrise/tower', () => {
    expect(floorTop('plex', 3)).toBeCloseTo(9.3, 9);
    expect(floorTop('podium', 6)).toBeCloseTo(20.0, 9);
    expect(floorTop('midrise', 10)).toBeCloseTo(32.4, 9);
    expect(floorTop('tower', 30)).toBeCloseTo(94.4, 9);
  });
});

describe('baseFootprint (§4.6)', () => {
  it('slab bisection reaches T within 0.25 m² from below, yard split equally', () => {
    const site = normaliseSite([rect(7.62, 30.48)], 0.4)!;
    const T = 0.6 * site.A;
    const F = baseFootprint(site, T);
    const a = totalArea(F);
    expect(a).toBeLessThanOrEqual(T + 1e-9);
    expect(T - a).toBeLessThanOrEqual(0.25 + 0.15); // + cm-grid snap of the final clip
    const ext = project(F, site.c, site.u);
    expect(ext.max).toBeCloseTo(-ext.min, 1); // equal yards at both ends
    expect(15.24 - ext.max).toBeCloseTo(5.0, 0); // ≈5.0 m from the lot line at each end
  });
  it('returns Q unchanged when Q is already within the target', () => {
    const site = normaliseSite([rect(7.62, 30.48)], 0.4)!;
    expect(baseFootprint(site, 1e6)).toBe(site.Q);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest --run --project server src/lib/generator/golden.spec.ts src/lib/generator/massing.spec.ts`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement `massing.ts`** (low-rise + ADU; Task 6 replaces the midrise/tower stubs)

```ts
import type { PathD, PathsD } from 'clipper2-ts';
import {
  ADU_EDGE_GAP_M,
  ADU_GROSS_M2,
  ADU_INSET_M,
  ADU_MAX_WIDTH_M,
  FTF_M,
  rulesFor
} from './constants';
import {
  clipSlab,
  intersect,
  inset,
  keepPieces,
  largest,
  orientedRect,
  project,
  signedArea,
  totalArea
} from './poly';
import type { Site } from './site';
import type { ReplacementTypology, TypologyId } from './types';
import type { VarietyDraws } from './variety';

export interface MassPart {
  ring: PathD;
  baseM: number;
  /** Pre-parapet, unrounded. */
  topM: number;
  floors: number;
  /** True when the part reaches the top floor (it gets the parapet). */
  reachesTop: boolean;
}

export interface Massing {
  typology: TypologyId;
  stories: number;
  parts: MassPart[];
  /** Σ area × floors in local m², unrounded. */
  floorAreaM2: number;
}

/** Top of floor k: g + (k − 1)·FTF_M. */
export function floorTop(typology: TypologyId, k: number): number {
  return rulesFor(typology).groundFtfM + (k - 1) * FTF_M;
}

/**
 * §4.6: F = Q if area(Q) ≤ target, else Q ∩ slab(h) with h found by bisection on
 * [0, half-extent of P along u] (Sutherland–Hodgman inside the loop). Keeps the largest h
 * whose area ≤ target; stops after 30 iterations or once target − area ≤ 0.25 m².
 * The final clip uses Clipper so concave sites split into clean pieces.
 */
export function baseFootprint(site: Site, target: number): PathsD {
  const { Q, P, c, u, v } = site;
  if (totalArea(Q) <= target) return Q;
  const pu = project([P], c, u);
  const H = Math.max(-pu.min, pu.max);
  const slabArea = (h: number) => {
    let s = 0;
    for (const q of Q) s += Math.abs(signedArea(clipSlab(q, c, u, h)));
    return s;
  };
  let lo = 0;
  let hi = H;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const a = slabArea(mid);
    if (a <= target) {
      lo = mid;
      if (target - a <= 0.25) break;
    } else {
      hi = mid;
    }
  }
  const pv = project([P], c, v);
  const slab = orientedRect(c, u, v, -lo, lo, pv.min - 1, pv.max + 1);
  return keepPieces(intersect(Q, [slab]));
}

function part(ring: PathD, baseM: number, topM: number, floors: number, reachesTop: boolean): MassPart {
  return { ring, baseM, topM, floors, reachesTop };
}

function finish(typology: TypologyId, stories: number, parts: MassPart[]): Massing {
  let fa = 0;
  for (const p of parts) fa += Math.abs(signedArea(p.ring)) * p.floors;
  return { typology, stories, parts, floorAreaM2: fa };
}

/** §4.7 massing for replacement typologies. Selection (§4.5) is separate: `selectTypology`. */
export function massTypology(
  site: Site,
  typology: ReplacementTypology,
  stories: number,
  draws: VarietyDraws
): Massing | null {
  const F = baseFootprint(site, rulesFor(typology).coverage * site.A);
  if (F.length === 0) return null;
  if (typology === 'midrise') return massMidrise(site, F, stories, draws);
  if (typology === 'tower') return massTower(site, F, stories, draws);
  const top = floorTop(typology, stories);
  return finish(
    typology,
    stories,
    F.map((r) => part(r, 0, top, stories, true))
  );
}

// Task 6 replaces these two stubs.
function massMidrise(_site: Site, F: PathsD, stories: number, _draws: VarietyDraws): Massing {
  const top = floorTop('midrise', stories);
  return finish('midrise', stories, F.map((r) => part(r, 0, top, stories, true)));
}
function massTower(_site: Site, F: PathsD, stories: number, _draws: VarietyDraws): Massing {
  const top = floorTop('tower', stories);
  return finish('tower', stories, F.map((r) => part(r, 0, top, stories, true)));
}

/** §4.8 ADU geometry (the open-area check lives in generate.ts: it needs the parcel). */
export function massAdu(site: Site, stories: number, draws: VarietyDraws): Massing | null {
  const { P, Q, c, u, v } = site;
  const Ap = ADU_GROSS_M2 / stories;
  const qv = project(Q, c, v);
  const width = Math.min(ADU_MAX_WIDTH_M, qv.max - qv.min - 2);
  if (!(width > 0)) return null;
  const depth = Ap / width;
  const pu = project([P], c, u);
  const [u0, u1] =
    draws.aduEnd === 1
      ? [pu.max - ADU_EDGE_GAP_M - depth, pu.max - ADU_EDGE_GAP_M]
      : [pu.min + ADU_EDGE_GAP_M, pu.min + ADU_EDGE_GAP_M + depth];
  const rect = orientedRect(c, u, v, u0, u1, -width / 2, width / 2);
  const fit = largest(intersect([rect], inset([P], ADU_INSET_M)));
  if (!fit || Math.abs(signedArea(fit)) < 0.9 * Ap) return null;
  return finish('adu', stories, [part(fit, 0, stories * FTF_M, stories, true)]);
}
```

(`keepPieces` is used by Task 6; leave the import if ESLint accepts it, otherwise import it in Task 6.)

- [ ] **Step 5: Implement `generate.ts` and `index.ts`**

`src/lib/generator/generate.ts`:

```ts
import type { ParcelRecord } from '../data/parcel';
import type { Envelope } from '../plan/types';
import { ADU_MIN_OPEN_M2, EFFICIENCY, FTF_M, MAX_STORIES, rulesFor } from './constants';
import { toLngLat } from './geo';
import { massAdu, massTypology, type Massing } from './massing';
import { canonicalRing } from './poly';
import { selectTypology } from './select';
import { normaliseSite, type Site } from './site';
import type { BuildoutMode, GeneratedBuilding } from './types';
import { drawVariety, type VarietyDraws } from './variety';

export interface LocalPart {
  /** Local metres, open CCW ring, same vertex order as the output footprint. */
  ring: [number, number][];
  baseM: number;
  topM: number;
}

export interface Detailed {
  building: GeneratedBuilding;
  local: LocalPart[];
  site: Site;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** §4.8 existing-footprint estimate: is there ≥ 60 m² of open lot for an ADU? */
export function aduOpenOk(parcel: ParcelRecord, A: number): boolean {
  const estStories =
    parcel.existingHeightM > 0 ? Math.max(1, Math.round(parcel.existingHeightM / FTF_M)) : 2;
  return A - parcel.existingFloorAreaM2 / estStories >= ADU_MIN_OPEN_M2;
}

export function generateDetailed(
  parcel: ParcelRecord,
  env: Envelope,
  draws: VarietyDraws,
  mode: BuildoutMode
): Detailed | null {
  if (mode !== 'max') throw new Error('unsupported BuildoutMode');
  if (!parcel.eligible) return null;
  let S = Math.floor(env.maxStories);
  if (!Number.isFinite(S) || S < 1) return null;
  if (S > MAX_STORIES) S = MAX_STORIES;

  const site = normaliseSite(parcel.polygon, draws.edgeInsetM);
  if (!site) return null;

  const sel = selectTypology(S, site.A, parcel.existingUnits);
  let m: Massing | null;
  if (sel.typology === 'adu') {
    if (!aduOpenOk(parcel, site.A)) return null;
    m = massAdu(site, sel.stories, draws);
  } else {
    m = massTypology(site, sel.typology, sel.stories, draws);
  }
  if (!m || m.parts.length === 0) return null;

  const floorAreaM2 = round1(m.floorAreaM2);
  const replacesExisting = m.typology !== 'adu';
  const rules = rulesFor(m.typology);
  const units = replacesExisting
    ? Math.min(rules.maxUnits, Math.floor((floorAreaM2 * EFFICIENCY) / rules.avgUnitM2))
    : 1;
  if (units < 1) return null; // N5
  const after = replacesExisting ? floorAreaM2 : parcel.existingFloorAreaM2 + floorAreaM2;
  if (after <= parcel.existingFloorAreaM2) return null; // N6
  if (replacesExisting && units <= parcel.existingUnits) return null; // N7

  const local: LocalPart[] = m.parts.map((p) => ({
    ring: canonicalRing(p.ring).map((q) => [q.x, q.y] as [number, number]),
    baseM: round2(p.baseM),
    topM: round2(p.topM + (p.reachesTop ? draws.parapetM : 0))
  }));
  const building: GeneratedBuilding = {
    parcelId: parcel.id,
    source: 'user',
    typology: m.typology,
    parts: local.map((l) => ({
      footprint: toLngLat(l.ring, parcel.labelPoint),
      baseM: l.baseM,
      topM: l.topM
    })),
    stories: m.stories,
    units,
    floorAreaM2,
    replacesExisting
  };
  return { building, local, site };
}

/** Same rules as `generate`, with injected draws (test seam). */
export function generateWith(
  parcel: ParcelRecord,
  env: Envelope,
  draws: VarietyDraws,
  mode: BuildoutMode
): GeneratedBuilding | null {
  return generateDetailed(parcel, env, draws, mode)?.building ?? null;
}

/** I8. Callers pass `seed = fnv1a32(parcel.id)` (I14). */
export function generate(
  parcel: ParcelRecord,
  env: Envelope,
  seed: number,
  mode: BuildoutMode
): GeneratedBuilding | null {
  if (mode !== 'max') throw new Error('unsupported BuildoutMode');
  return generateWith(parcel, env, drawVariety(seed), mode);
}
```

`src/lib/generator/index.ts`:

```ts
export { generate } from './generate';
export { fnv1a32 } from './seed';
export { selectTypology } from './select';
export { massTypology } from './massing';
export { drawVariety } from './variety';
export type { BuildoutMode, GeneratedBuilding, TypologyId } from './types';
export type { VarietyDraws } from './variety';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest --run --project server src/lib/generator`
Expected: PASS. If a golden row is outside tolerance, debug with `superpowers:systematic-debugging` against the hand calculation in the spec §6 (do not loosen tolerances or change expected values; a genuine spec/arithmetic conflict is reported, not patched).

Hand-calculation reference for debugging: std lot Q = 6.82 × 29.68 = 202.4 m²; plex T = 0.6 × 232.26 = 139.36; walkup T = 162.58. lot-1000: Q = 24.2 × 39.2 = 948.6, podium T = 800.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/generator && npx eslint src/lib/generator
git add src/lib/generator
git commit -m "feat(generator): generate low-rise and ADU buildings with golden fixtures"
```

---

### Task 6: Midrise stepback and tower placement

**Files:**
- Modify: `src/lib/generator/massing.ts` (replace the `massMidrise` / `massTower` stubs)
- Test: `src/lib/generator/golden.spec.ts` (append), `src/lib/generator/fixtures/lot-3000.json`, `lot-1200.json` (already created in Task 5)

**Interfaces:**
- Consumes: everything from Task 5; constants `MIDRISE_STEPBACK_ABOVE`, `TOWER_PODIUM_STORIES`, `TOWER_COVERAGE`, `TOWER_PLATE_MAX_M2`, `TOWER_INSET_M`.
- Produces: no new exports; `massTypology` now implements §4.7 midrise and tower, including the tower → midrise-12 fallback (the returned `Massing.typology`/`stories` reflect the fallback).

- [ ] **Step 1: Write the failing tests** — append to `golden.spec.ts` (move the two new `import` lines up with the file's other imports):

```ts
import lot3000 from './fixtures/lot-3000.json';
import lot1200 from './fixtures/lot-1200.json';

describe('golden fixtures: midrise and tower', () => {
  it('lot-1000 S=10 → midrise, FA 6587.4, 81 units, tops 20.0 / 32.4 + 0.75', () => {
    const d = run(lot1000, 10)!;
    expect(d.building.typology).toBe('midrise');
    expect(Math.abs(d.building.floorAreaM2 - 6587.4)).toBeLessThanOrEqual(2);
    expect(d.building.units).toBe(81);
    expect(d.building.parts.map((p) => [p.baseM, p.topM])).toEqual([
      [0, 20],
      [20, 33.15]
    ]);
  });
  it('lot-3000 S=30 → tower, podium plate 2400, tower plate 900, 394 units', () => {
    const d = run(lot3000, 30)!;
    expect(d.building).toMatchObject({ typology: 'tower', stories: 30, units: 394 });
    expect(d.building.parts.map((p) => [p.baseM, p.topM])).toEqual([
      [0, 16.9],
      [16.9, 95.15]
    ]);
    expect(localArea(d, 0)).toBeCloseTo(2400, 0);
    expect(localArea(d, 1)).toBeCloseTo(900, 0);
  });
  it('lot-1200 S=30 → midrise, 12 stories (cap chain)', () => {
    expect(run(lot1200, 30)!.building).toMatchObject({ typology: 'midrise', stories: 12 });
  });
  it('midrise without room for a stepback keeps U = F', () => {
    // stepback ≈ 3 m on a narrow midrise: U falls below 0.4·F → U = F
    // 11×55 = 605 m²: F ≈ 10.2×44.5; U ≈ 4.2×38.5 = 162 < 0.4·454 = 182
    const narrow = {
      ...lot1000,
      id: 'n',
      polygon: [[[-5.5, -27.5], [5.5, -27.5], [5.5, 27.5], [-5.5, 27.5]]]
    };
    const big = varietyFromUniforms([0.5, 0.999, 0.5, 0.5, 0, 0.25]);
    const d = generateDetailed(P(narrow), { maxStories: 10 }, big, 'max')!;
    expect(d.building.typology).toBe('midrise');
    expect(d.local[1].ring).toEqual(d.local[0].ring);
  });
  // Review Focus 5
  it('tall paint on a large skinny L falls back without breaking nesting', () => {
    // 1,600 m² L with 10 m arms: 90×10 + 10×70 = 1600
    const L = {
      ...lot1000,
      id: 'L',
      polygon: [[[0, 0], [90, 0], [90, 10], [10, 10], [10, 80], [0, 80]]]
    };
    const d = run(L, 40)!;
    expect(['tower', 'midrise']).toContain(d.building.typology);
    if (d.building.typology === 'midrise') expect(d.building.stories).toBe(12);
    for (const up of d.local.filter((l) => l.baseM > 0)) {
      expect(d.local.some((lo) => lo.baseM < up.baseM && lo.topM === up.baseM)).toBe(true);
    }
  });
});
```

(Containment of upper parts inside lower parts is property-tested in Task 7; here the fallback branch is exercised.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/generator/golden.spec.ts`
Expected: the new midrise/tower rows FAIL (stubs emit a single part).

- [ ] **Step 3: Implement** — replace the two stubs in `massing.ts` and add the constant imports (`MIDRISE_STEPBACK_ABOVE`, `TOWER_COVERAGE`, `TOWER_INSET_M`, `TOWER_PLATE_MAX_M2`, `TOWER_PODIUM_STORIES`):

```ts
/** §4.7 midrise: floors 1–6 on F; 7–S on U = F inset by the stepback (or F if U < 0.4·F). */
function massMidrise(_site: Site, F: PathsD, stories: number, draws: VarietyDraws): Massing {
  const below = MIDRISE_STEPBACK_ABOVE;
  const topLow = floorTop('midrise', below);
  let U = keepPieces(inset(F, draws.stepbackM));
  if (totalArea(U) < 0.4 * totalArea(F)) U = F;
  const top = floorTop('midrise', stories);
  return finish('midrise', stories, [
    ...F.map((r) => part(r, 0, topLow, below, false)),
    ...U.map((r) => part(r, topLow, top, stories - below, true))
  ]);
}

/**
 * §4.7 tower: podium floors 1–5 on F; tower plate (rectangle on u/v, area At) slid along u,
 * clipped to F inset 1 m. Retry centred; else largest piece ≥ 0.5·At; else midrise at 12.
 */
function massTower(site: Site, F: PathsD, stories: number, draws: VarietyDraws): Massing | null {
  const { c, u, v } = site;
  const At = Math.min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE * site.A);
  const depth = Math.sqrt(At * draws.towerAspect);
  const width = Math.sqrt(At / draws.towerAspect);
  const fu = project(F, c, u);
  const s = Math.max(0, (fu.max - fu.min - depth) / 2 - TOWER_INSET_M);
  const Fin = inset(F, TOWER_INSET_M);
  const plate = (slide: number) => {
    const t = slide * s;
    const rect = orientedRect(c, u, v, t - depth / 2, t + depth / 2, -width / 2, width / 2);
    return keepPieces(intersect([rect], Fin));
  };
  let R = plate(draws.towerSlide);
  if (totalArea(R) < 0.9 * At) {
    R = plate(0);
    if (totalArea(R) < 0.9 * At) {
      const big = largest(R);
      if (big && Math.abs(signedArea(big)) >= 0.5 * At) R = [big];
      else return massTypology(site, 'midrise', 12, draws);
    }
  }
  const podium = TOWER_PODIUM_STORIES;
  const topPodium = floorTop('tower', podium);
  const top = floorTop('tower', stories);
  return finish('tower', stories, [
    ...F.map((r) => part(r, 0, topPodium, podium, false)),
    ...R.map((r) => part(r, topPodium, top, stories - podium, true))
  ]);
}
```

`massTypology`'s return type is already `Massing | null`, so `massTower` returning `null` (via the midrise fallback) type-checks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run --project server src/lib/generator`
Expected: PASS. Hand-calculation reference: lot-1000 midrise F = 24.2 × 30.99 = 750, U = 19.7 × 26.49 = 521.9, FA = 750×6 + 521.9×4 ≈ 6587.5. lot-3000: F = 49.2 × 48.78 = 2400, At = min(900, 1050) = 900 → 30×30, FA = 2400×5 + 900×25 = 34,500, units ⌊34,500×0.8/70⌋ = 394.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/generator && npx eslint src/lib/generator
git add src/lib/generator
git commit -m "feat(generator): add midrise stepback and tower placement"
```

---

### Task 7: Property tests (determinism, rotation, monotonicity, containment, nesting, coverage, I8 invariants)

**Files:**
- Create: `src/lib/generator/fixtures/geom.ts` (test helpers)
- Test: `src/lib/generator/generator.property.spec.ts`

**Interfaces:**
- Consumes: `generateDetailed`, `Detailed`, `LocalPart` (Task 5); `drawVariety`, `varietyFromUniforms`; `selectTypology`; `COVERAGE`; `signedArea`.
- Produces (test-only, `fixtures/geom.ts`):
  - `rotateRing(ring: [number, number][], t: number, flip: boolean): [number, number][]` (rational rotation, no transcendentals)
  - `rectRing(w: number, h: number, cx?: number, cy?: number): [number, number][]`
  - `lRing(w: number, h: number, nw: number, nh: number): [number, number][]` (notch at top-right)
  - `uRing(w: number, h: number, gapW: number, gapH: number): [number, number][]` (concave U, opening at top)
  - `pointNearPolygon(p: [number, number], ring: [number, number][], tol: number): boolean` (inside, or within `tol` of an edge)
  - `ringArea(ring: [number, number][]): number` (absolute shoelace)
  - `lngLatToLocalApprox(ring: [number, number][], label: [number, number]): [number, number][]` (inverse of `toLngLat` without the convergence rotation is not good enough — use the same tangent-plane constants; see code)

- [ ] **Step 1: Write the helpers** — `src/lib/generator/fixtures/geom.ts`:

```ts
// Test-only helpers. No transcendental Math (AC4 covers this directory too).

export type Ring = [number, number][];

export function rectRing(w: number, h: number, cx = 0, cy = 0): Ring {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2]
  ];
}

export function lRing(w: number, h: number, nw: number, nh: number): Ring {
  const x = w / 2;
  const y = h / 2;
  return [
    [-x, -y],
    [x, -y],
    [x, y - nh],
    [x - nw, y - nh],
    [x - nw, y],
    [-x, y]
  ];
}

export function uRing(w: number, h: number, gapW: number, gapH: number): Ring {
  const x = w / 2;
  const y = h / 2;
  const g = gapW / 2;
  return [
    [-x, -y],
    [x, -y],
    [x, y],
    [g, y],
    [g, y - gapH],
    [-g, y - gapH],
    [-g, y],
    [-x, y]
  ];
}

/** Rotation with cos=(1−t²)/(1+t²), sin=2t/(1+t²); `flip` adds 180°. Covers every angle. */
export function rotateRing(ring: Ring, t: number, flip: boolean): Ring {
  const d = 1 + t * t;
  let c = (1 - t * t) / d;
  let s = (2 * t) / d;
  if (flip) {
    c = -c;
    s = -s;
  }
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

function segDist2(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

/** Inside `ring` (even-odd), or within `tol` of its boundary. */
export function pointNearPolygon(p: [number, number], ring: Ring, tol: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (segDist2(p, ring[j], ring[i]) <= tol * tol) return true;
  }
  return false;
}

/**
 * Approximate lng/lat → local metres around `label` (equirectangular, metres per degree at the
 * label latitude). Only used to compare lng/lat rings with each other, so the shared
 * convergence rotation and scale cancel out; tolerance 0.02 m still applies.
 */
export function lngLatToLocalApprox(ring: Ring, label: [number, number]): Ring {
  const mPerDegLat = 111_000;
  // cos(lat) without Math.cos: SF latitudes are ~37.7–37.8°, cos ≈ 0.7907 there
  const mPerDegLng = 111_000 * 0.7907;
  return ring.map(([lng, lat]) => [(lng - label[0]) * mPerDegLng, (lat - label[1]) * mPerDegLat]);
}
```

- [ ] **Step 2: Write the property spec** — `src/lib/generator/generator.property.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ParcelRecord } from '../data/parcel';
import { generateDetailed, type Detailed } from './generate';
import { drawVariety, varietyFromUniforms } from './variety';
import { selectTypology } from './select';
import { COVERAGE } from './constants';
import {
  lRing,
  lngLatToLocalApprox,
  pointNearPolygon,
  rectRing,
  ringArea,
  rotateRing,
  uRing,
  type Ring
} from './fixtures/geom';
import std from './fixtures/std-25x100.json';
import lot1000 from './fixtures/lot-1000.json';
import lot3000 from './fixtures/lot-3000.json';

const RUNS = { numRuns: 1000 };
const GOLDEN = varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25]);

function parcel(polygon: Ring[], over: Partial<ParcelRecord> = {}): ParcelRecord {
  return {
    id: 'p',
    polygon,
    labelPoint: [-122.4194, 37.7749],
    areaM2: 0,
    existingUnits: 1,
    existingFloorAreaM2: 180,
    existingHeightM: 7,
    landUse: 'RESIDENTIAL',
    eligible: true,
    neighborhood: 'Test',
    ...over
  };
}

const t = fc.double({ min: -1, max: 1, noNaN: true });
const arbSite: fc.Arbitrary<Ring[]> = fc.oneof(
  fc
    .record({ w: fc.double({ min: 4, max: 90, noNaN: true }), h: fc.double({ min: 4, max: 90, noNaN: true }), t, f: fc.boolean() })
    .map(({ w, h, t, f }) => [rotateRing(rectRing(w, h), t, f)]),
  fc
    .record({ w: fc.double({ min: 10, max: 80, noNaN: true }), h: fc.double({ min: 10, max: 80, noNaN: true }), a: fc.double({ min: 0.2, max: 0.8, noNaN: true }), b: fc.double({ min: 0.2, max: 0.8, noNaN: true }), t, f: fc.boolean() })
    .map(({ w, h, a, b, t, f }) => [rotateRing(lRing(w, h, w * a, h * b), t, f)]),
  fc
    .record({ w: fc.double({ min: 15, max: 80, noNaN: true }), h: fc.double({ min: 15, max: 80, noNaN: true }), a: fc.double({ min: 0.2, max: 0.6, noNaN: true }), b: fc.double({ min: 0.2, max: 0.8, noNaN: true }), t, f: fc.boolean() })
    .map(({ w, h, a, b, t, f }) => [rotateRing(uRing(w, h, w * a, h * b), t, f)]),
  fc
    .record({ w: fc.double({ min: 6, max: 60, noNaN: true }), h: fc.double({ min: 6, max: 60, noNaN: true }), t, f: fc.boolean() })
    .map(({ w, h, t, f }) => [
      rotateRing(rectRing(w, h), t, f),
      rotateRing(rectRing(5, 10, w + 20, 0), t, f)
    ])
);
const arbCase = fc.record({
  site: arbSite,
  S: fc.integer({ min: 1, max: 80 }),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  units: fc.integer({ min: 0, max: 4 }),
  fa: fc.double({ min: 0, max: 400, noNaN: true })
});
const detailed = (c: { site: Ring[]; S: number; seed: number; units: number; fa: number }) =>
  generateDetailed(
    parcel(c.site, { existingUnits: c.units, existingFloorAreaM2: c.fa }),
    { maxStories: c.S },
    drawVariety(c.seed),
    'max'
  );

/** Every part with baseM > 0 lies in some part whose topM equals its baseM. */
function nested(rings: Ring[], d: Detailed, tol: number): boolean {
  return d.local.every((up, i) => {
    if (up.baseM === 0) return true;
    return d.local.some(
      (lo, j) => j !== i && lo.topM === up.baseM && rings[i].every((p) => pointNearPolygon(p, rings[j], tol))
    );
  });
}

describe('generator properties (§6)', () => {
  it('determinism: same input → deep-equal output', () => {
    expect(() =>
      fc.assert(fc.property(arbCase, (c) => expect(detailed(c)).toEqual(detailed(c))), RUNS)
    ).not.toThrow();
  });

  it('nesting (I9): single open rings ≥ 3 vertices; upper parts inside the part below (local and lng/lat)', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          for (const p of d.building.parts) {
            expect(p.footprint.length).toBeGreaterThanOrEqual(3);
            const [a, b] = [p.footprint[0], p.footprint[p.footprint.length - 1]];
            expect(a[0] === b[0] && a[1] === b[1]).toBe(false);
          }
          expect(nested(d.local.map((l) => l.ring), d, 0.02)).toBe(true);
          const label: [number, number] = [-122.4194, 37.7749]; // parcel() labelPoint
          const ll = d.building.parts.map((p) => lngLatToLocalApprox(p.footprint, label));
          expect(nested(ll, d, 0.02)).toBe(true);
          return true;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('containment: every footprint vertex lies within P (0.02 m)', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          const P: Ring = d.site.P.map((q) => [q.x, q.y]);
          return d.local.every((l) => l.ring.every((p) => pointNearPolygon(p, P, 0.02)));
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('coverage: base footprint area ≤ COVERAGE·A + 0.25', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d || d.building.typology === 'adu') return true;
          const base = d.local.filter((l) => l.baseM === 0).reduce((s, l) => s + ringArea(l.ring), 0);
          const cov = COVERAGE[d.building.typology];
          return base <= cov * d.site.A + 0.25;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('I8/AC7: ADU never replaces; replacements always beat existing FA and units', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          const b = d.building;
          if (b.typology === 'adu') return b.replacesExisting === false && b.units === 1;
          return b.replacesExisting && b.units > c.units && b.floorAreaM2 > c.fa && b.units >= 1;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('monotonicity: within one typology, raising S never lowers floorAreaM2', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const lo = detailed(c);
          const hi = detailed({ ...c, S: Math.min(80, c.S + 1) });
          if (!lo || !hi || lo.building.typology !== hi.building.typology) return true;
          return hi.building.floorAreaM2 >= lo.building.floorAreaM2;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('rotation invariance on the golden fixtures: units/stories equal, FA within 0.5%', () => {
    const cases: [unknown, number][] = [
      // lshape is excluded: its walkup FA sits at ⌊1050·0.8/70⌋ = 12.0, a unit-count boundary
      [std, 3], [std, 5], [std, 2], [lot1000, 6], [lot1000, 10], [lot3000, 30]
    ];
    expect(() =>
      fc.assert(
        fc.property(fc.constantFrom(...cases), t, fc.boolean(), ([fx, S], tt, f) => {
          const base = fx as ParcelRecord;
          const rot = { ...base, polygon: base.polygon.map((r) => rotateRing(r, tt, f)) };
          const a = generateDetailed(base, { maxStories: S }, GOLDEN, 'max')!.building;
          const b = generateDetailed(rot, { maxStories: S }, GOLDEN, 'max')!.building;
          expect(b.units).toBe(a.units);
          expect(b.stories).toBe(a.stories);
          expect(Math.abs(b.floorAreaM2 - a.floorAreaM2)).toBeLessThanOrEqual(0.005 * a.floorAreaM2);
          return true;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('selection is consistent with the built result', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          const sel = selectTypology(c.S, d.site.A, c.units);
          // tower may legitimately fall back to midrise 12 (§4.7)
          if (sel.typology === 'tower' && d.building.typology === 'midrise') return d.building.stories === 12;
          return sel.typology === d.building.typology && sel.stories === d.building.stories;
        }),
        RUNS
      )
    ).not.toThrow();
  });
});
```

Notes for the implementer:
- `fc.property` predicates may use `expect` inside; a failed `expect` throws, which fast-check reports as a counterexample.
- The lng/lat nesting check compares lng/lat rings with each other via `lngLatToLocalApprox`; the approximation's scale error (≲ 0.1%) over a ≤ 130 m site is ≲ 0.13 m in absolute position but cancels between rings (both rings go through the same map); the containment margin between nested rings is ≥ 1 m by construction except where `U = F` (identical rings). If this check flakes on identical rings, it is a real rounding bug — investigate, don't widen the tolerance.
- The rotation test uses the golden draws so only geometry varies.

- [ ] **Step 3: Run**

Run: `npx vitest --run --project server src/lib/generator/generator.property.spec.ts`
Expected: PASS. A counterexample is a real defect: shrink it, add it as a named regression test in `golden.spec.ts`, then fix the rule per spec. If a counterexample shows the *spec's* rule itself violates a spec property (e.g. monotonicity within a typology), stop and report it to the operator — do not change the rule.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/lib/generator && npx eslint src/lib/generator
git add src/lib/generator/fixtures/geom.ts src/lib/generator/generator.property.spec.ts
git commit -m "test(generator): property tests for nesting, containment, coverage and invariance"
```

---

### Task 8: Generator cache

**Files:**
- Create: `src/lib/generator/cache.ts`
- Modify: `src/lib/generator/index.ts`
- Test: `src/lib/generator/cache.spec.ts`

**Interfaces:**
- Consumes: `generate` (Task 5), `fnv1a32` (Task 1), `MAX_STORIES`.
- Produces: `interface GeneratorCache { get(parcel: ParcelRecord, env: Envelope): GeneratedBuilding | null; clear(): void }`, `createGeneratorCache(datasetVersion: string): GeneratorCache`; both re-exported from `index.ts`.

- [ ] **Step 1: Write the failing test** — `src/lib/generator/cache.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { createGeneratorCache } from './cache';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import std from './fixtures/std-25x100.json';

const P = std as unknown as ParcelRecord;

afterEach(() => vi.restoreAllMocks());

describe('createGeneratorCache (§4.12)', () => {
  it('same key returns the identical object', () => {
    const c = createGeneratorCache('fixture-0');
    const a = c.get(P, { maxStories: 5 });
    expect(a).not.toBeNull();
    expect(c.get(P, { maxStories: 5 })).toBe(a);
    expect(c.get(P, { maxStories: 5.9 })).toBe(a); // key uses floor(S)
    expect(a).toEqual(generate(P, { maxStories: 5 }, fnv1a32(P.id), 'max'));
  });
  it('a changed S recomputes', () => {
    const c = createGeneratorCache('fixture-0');
    const a = c.get(P, { maxStories: 5 });
    const b = c.get(P, { maxStories: 3 });
    expect(b).not.toBe(a);
    expect(b!.typology).toBe('plex');
  });
  it('S above 80 shares the clamped key', () => {
    const c = createGeneratorCache('fixture-0');
    expect(c.get(P, { maxStories: 200 })).toBe(c.get(P, { maxStories: 80 }));
  });
  it('invalid S → null without throwing', () => {
    const c = createGeneratorCache('fixture-0');
    expect(c.get(P, { maxStories: NaN })).toBeNull();
    expect(c.get(P, { maxStories: 0 })).toBeNull();
  });
  it('a throwing parcel yields null and logs once', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = createGeneratorCache('fixture-0');
    const bad = { ...P, id: 'bad', polygon: null } as unknown as ParcelRecord;
    expect(c.get(bad, { maxStories: 3 })).toBeNull();
    expect(c.get(bad, { maxStories: 4 })).toBeNull();
    expect(c.get(bad, { maxStories: 3 })).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toMatch(/^\[generator\] bad: /);
  });
  it('clear() drops memoised results', () => {
    const c = createGeneratorCache('fixture-0');
    const a = c.get(P, { maxStories: 5 });
    c.clear();
    const b = c.get(P, { maxStories: 5 });
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run --project server src/lib/generator/cache.spec.ts`
Expected: FAIL (no `./cache`).

- [ ] **Step 3: Implement** — `src/lib/generator/cache.ts`:

```ts
import type { ParcelRecord } from '../data/parcel';
import type { Envelope } from '../plan/types';
import { MAX_STORIES } from './constants';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import type { GeneratedBuilding } from './types';

export interface GeneratorCache {
  get(parcel: ParcelRecord, env: Envelope): GeneratedBuilding | null;
  clear(): void;
}

/**
 * Optional memo for the worker host, keyed by `parcelId|S` (S after floor and clamp). The
 * host creates a new cache when `datasetVersion` changes. Exceptions (bugs or bad data) are
 * caught: logged once per parcel, and the parcel contributes `null`.
 */
export function createGeneratorCache(_datasetVersion: string): GeneratorCache {
  const memo = new Map<string, GeneratedBuilding | null>();
  const logged = new Set<string>();
  return {
    get(parcel, env) {
      const f = Math.floor(env.maxStories);
      if (!Number.isFinite(f) || f < 1) return null;
      const key = parcel.id + '|' + Math.min(f, MAX_STORIES);
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      let out: GeneratedBuilding | null;
      try {
        out = generate(parcel, env, fnv1a32(parcel.id), 'max');
      } catch (e) {
        if (!logged.has(parcel.id)) {
          logged.add(parcel.id);
          console.error(`[generator] ${parcel.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
        out = null;
      }
      memo.set(key, out);
      return out;
    },
    clear() {
      memo.clear();
      logged.clear();
    }
  };
}
```

Append to `index.ts`:

```ts
export { createGeneratorCache } from './cache';
export type { GeneratorCache } from './cache';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run --project server src/lib/generator/cache.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/generator && npx eslint src/lib/generator
git add src/lib/generator/cache.ts src/lib/generator/cache.spec.ts src/lib/generator/index.ts
git commit -m "feat(generator): add memo cache for the worker host"
```

---

### Task 9: Synthetic parcels, seeded snapshot (Node + Chromium) and performance budget

**Files:**
- Create: `src/lib/generator/fixtures/synth.ts`, `src/lib/generator/fixtures/build-golden-seeded.ts`, `src/lib/generator/fixtures/golden-seeded.json` (generated)
- Test: `src/lib/generator/seeded.spec.ts`, `src/lib/generator/generator.svelte.spec.ts` (client project), `src/lib/generator/generator.perf.spec.ts`

**Interfaces:**
- Consumes: `generate`, `fnv1a32`, `mulberry32`; `rectRing`, `lRing`, `rotateRing`, `ringArea` from `fixtures/geom.ts`.
- Produces: `interface SynthCase { parcel: ParcelRecord; S: number }`, `synthParcels(n: number, seed: number): SynthCase[]`; `golden-seeded.json` shaped `{ parcel: ParcelRecord; S: number; out: GeneratedBuilding | null }[]` (200 entries).

- [ ] **Step 1: Write `fixtures/synth.ts`**

```ts
import type { ParcelRecord } from '../../data/parcel';
import { mulberry32 } from '../seed';
import { lRing, rectRing, ringArea, rotateRing, type Ring } from './geom';

export interface SynthCase {
  parcel: ParcelRecord;
  S: number;
}

const S_CHOICES = [1, 2, 3, 3, 4, 5, 5, 6, 8, 10, 12, 15, 24, 40, 80];
const UNIT_CHOICES = [0, 1, 1, 1, 2, 3];
const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

/**
 * Seeded SF-like mix: 70% 25×100 ft lots, 25% 400–3,000 m² lots, 5% irregular (L-shapes),
 * every one rotated by a random angle, at mixed painted S. No transcendental Math.
 */
export function synthParcels(n: number, seed: number): SynthCase[] {
  const r = mulberry32(seed);
  const out: SynthCase[] = [];
  for (let i = 0; i < n; i++) {
    const k = r();
    let ring: Ring;
    if (k < 0.7) {
      ring = rectRing(7.62, 30.48);
    } else if (k < 0.95) {
      const area = 400 + 2600 * r();
      const aspect = 1 + 1.5 * r();
      const w = Math.sqrt(area / aspect);
      ring = rectRing(w, area / w);
    } else {
      const w = 15 + 30 * r();
      const h = 15 + 30 * r();
      ring = lRing(w, h, w * (0.3 + 0.3 * r()), h * (0.3 + 0.3 * r()));
    }
    ring = rotateRing(ring, 2 * r() - 1, r() < 0.5);
    const S = S_CHOICES[Math.floor(r() * S_CHOICES.length)];
    const units = UNIT_CHOICES[Math.floor(r() * UNIT_CHOICES.length)];
    const fa =
      units === 0 ? (r() < 0.5 ? 0 : Math.round(400 * r())) : units * (80 + Math.round(60 * r()));
    const height = fa === 0 ? 0 : 3 + Math.round(9 * r());
    out.push({
      parcel: {
        id: String(9000000 + i),
        polygon: [ring],
        labelPoint: [r7(-122.51 + 0.14 * r()), r7(37.71 + 0.1 * r())],
        areaM2: ringArea(ring),
        existingUnits: units,
        existingFloorAreaM2: fa,
        existingHeightM: height,
        landUse: units > 0 ? 'RESIDENTIAL' : 'COMMERCIAL',
        eligible: true,
        neighborhood: 'Synthetic'
      },
      S
    });
  }
  return out;
}
```

- [ ] **Step 2: Write the regeneration script and generate the snapshot**

`src/lib/generator/fixtures/build-golden-seeded.ts`:

```ts
// Regenerates golden-seeded.json. Run deliberately, and commit the result with a reason:
//   npx tsx src/lib/generator/fixtures/build-golden-seeded.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../generate';
import { fnv1a32 } from '../seed';
import { synthParcels } from './synth';

export const GOLDEN_SEEDED_SEED = 20261010;
export const GOLDEN_SEEDED_COUNT = 200;

const cases = synthParcels(GOLDEN_SEEDED_COUNT, GOLDEN_SEEDED_SEED).map(({ parcel, S }) => ({
  parcel,
  S,
  out: generate(parcel, { maxStories: S }, fnv1a32(parcel.id), 'max')
}));
writeFileSync(
  fileURLToPath(new URL('./golden-seeded.json', import.meta.url)),
  JSON.stringify(cases) + '\n'
);
console.log(`wrote ${cases.length} cases, ${cases.filter((c) => c.out).length} non-null`);
```

Run: `npx tsx src/lib/generator/fixtures/build-golden-seeded.ts`
Expected: `wrote 200 cases, N non-null` with N well above 100 (most std lots at S ≥ 3 build). If N < 100 or every non-null output has the same typology, the mix is wrong — fix `synth.ts` before freezing. Confirm the JSON contains every typology at least once: `node -e "const c=require('./src/lib/generator/fixtures/golden-seeded.json');console.log([...new Set(c.filter(x=>x.out).map(x=>x.out.typology))])"`. If `tower` or `adu` is missing, increase the 25% lot range share of `S ≥ 13` by adjusting `S_CHOICES` (and regenerate) — `tower` needs A ≥ 1,500 with S ≥ 13; `adu` needs S ≤ 2 on a lot with existing units.

- [ ] **Step 3: Write the snapshot tests**

`src/lib/generator/seeded.spec.ts` (Node):

```ts
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import { synthParcels } from './fixtures/synth';
import golden from './fixtures/golden-seeded.json';

const cases = golden as unknown as { parcel: ParcelRecord; S: number; out: unknown }[];

describe('seeded snapshot (golden-seeded.json)', () => {
  it('has 200 frozen cases', () => {
    expect(cases).toHaveLength(200);
  });
  it('generate reproduces every frozen output exactly', () => {
    for (const c of cases) {
      expect(generate(c.parcel, { maxStories: c.S }, fnv1a32(c.parcel.id), 'max')).toEqual(c.out);
    }
  });
  it('synthParcels still produces the frozen inputs', () => {
    const fresh = synthParcels(200, 20261010);
    expect(fresh.map((f) => [f.parcel, f.S])).toEqual(cases.map((c) => [c.parcel, c.S]));
  });
});
```

`src/lib/generator/generator.svelte.spec.ts` (client project, Chromium — the `.svelte.spec.ts` suffix routes it there; it renders nothing):

```ts
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import golden from './fixtures/golden-seeded.json';

const cases = golden as unknown as { parcel: ParcelRecord; S: number; out: unknown }[];

describe('seeded snapshot in Chromium (AC3)', () => {
  it('deep-equals golden-seeded.json', () => {
    expect(cases).toHaveLength(200);
    for (const c of cases) {
      expect(generate(c.parcel, { maxStories: c.S }, fnv1a32(c.parcel.id), 'max')).toEqual(c.out);
    }
  });
});
```

- [ ] **Step 4: Write the perf spec** — `src/lib/generator/generator.perf.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import { synthParcels } from './fixtures/synth';

describe('generation performance budget (§4.12)', () => {
  it('150k synthetic parcels in ≤ 2,500 ms', { timeout: 120_000 }, () => {
    const cases = synthParcels(150_000, 42);
    const seeds = cases.map((c) => fnv1a32(c.parcel.id));
    for (let i = 0; i < 2000; i++) generate(cases[i].parcel, { maxStories: cases[i].S }, seeds[i], 'max');
    const t0 = performance.now();
    let built = 0;
    for (let i = 0; i < cases.length; i++) {
      if (generate(cases[i].parcel, { maxStories: cases[i].S }, seeds[i], 'max')) built++;
    }
    const ms = performance.now() - t0;
    console.log(`[perf] 150k parcels: ${ms.toFixed(0)} ms, ${built} built`);
    expect(built).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(2500);
  });

  it('500 parcels in ≤ 30 ms (median of 5)', () => {
    const cases = synthParcels(500, 7);
    const seeds = cases.map((c) => fnv1a32(c.parcel.id));
    const once = () => {
      const t0 = performance.now();
      for (let i = 0; i < cases.length; i++) generate(cases[i].parcel, { maxStories: cases[i].S }, seeds[i], 'max');
      return performance.now() - t0;
    };
    once(); // warm-up
    const runs = [once(), once(), once(), once(), once()].sort((a, b) => a - b);
    console.log(`[perf] 500 parcels median: ${runs[2].toFixed(1)} ms`);
    expect(runs[2]).toBeLessThanOrEqual(30);
  });
});
```

- [ ] **Step 5: Run everything**

```bash
npx vitest --run --project server src/lib/generator
npx vitest --run --project client src/lib/generator
```

Expected: PASS in both. If the perf budget fails, profile (`node --cpu-prof` on a small script calling `generate` over `synthParcels(150000, 42)`) and optimise the hot path without changing results: e.g. hoist the `clipSlab` closure, avoid `Set` in `cleanRing` for 4-vertex rings, skip `unionD` when there is one ring (already done). Any optimisation that changes output requires regenerating `golden-seeded.json` in a deliberate commit with a reason — and must not change any golden-fixture result. Report the measured ms in the task report.

- [ ] **Step 6: Full verification**

```bash
npm run lint
npm run check
npx vitest --run
```

Expected: all clean. (`npm run check` runs `svelte-check` over the whole project — fix only generator-owned errors; report others.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/generator
git commit -m "test(generator): seeded snapshot across Node and Chromium, perf budget"
```

---

## Spec coverage map (self-review)

| spec item | task |
|---|---|
| §4.1 constants, `rulesFor` (M3 seam) | 1 |
| §4.2 fnv1a32, mulberry32, drawVariety (6 draws, order) | 1 |
| §4.3 numeric determinism, output rounding, units from rounded FA | 4 (guard), 5 |
| §4.4 steps 1–3 (mode throw, eligible, S floor/clamp) | 5 |
| §4.4 steps 4–6 (rings, union, site, simplify, MIN_SITE, inset, width test) | 3 |
| §4.5 selection + cap chain | 3 |
| §4.6 base footprint, slab bisection (SH), yard split, multi-piece F | 5 |
| §4.7 plex/walkup/podium | 5; midrise/tower/parapet/nesting | 6 (+ 7 property) |
| §4.8 ADU | 5 |
| §4.9 yield, N5/N6/N7, replacesExisting | 5 (+ 7 property) |
| §4.10 lng/lat, open CCW rings | 4, 5 |
| §4.11 clipper2-ts@2.0.1 pinned, attribution | 1 |
| §4.12 cache, error logging, perf budgets | 8, 9 |
| §5 seams (`mode` param, `selectTypology`/`massTypology` exports, `source: 'user'`) | 5 |
| §6 unit / golden / property / conversion / seeded / perf / cache / cross-engine | 1–9 |
| §7 AC1–AC8 | AC1: 5; AC2: 5–6; AC3: 9; AC4: 4; AC5: 9; AC6: 1; AC7: 5, 7; AC8: 6, 7 |
