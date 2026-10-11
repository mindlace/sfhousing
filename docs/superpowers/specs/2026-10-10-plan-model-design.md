# plan-model — Spec (Milestone 1)

Source: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (approved 2026-10-10).
Status: draft for orchestrator review. No product code written.

## 1. Scope

Design row (verbatim):

| slug | scope |
|---|---|
| `plan-model` | Pure TypeScript domain core with no DOM or map dependencies. Contains the `Plan` / `PlanOp` types, `resolveEnvelopes`, (de)serialization and schema versioning. Stores strokes, not parcel lists, so a plan stays valid across dataset versions. |

**In:**
- The types `Plan`, `PlanOp`, `BrushStroke`, `Envelope` (I2–I4) and the internal type `ParcelIndex`.
- `ParcelIndex`: a spatial index over parcel label points, filled one parcel chunk at a time.
- The geometry used for coverage: the projection to metres, the distance metric and the boundary rule.
- `resolveEnvelopes` (I5), plus the incremental forms: `applyOp`, `resolveParcels`, and `resolveChunk` for chunks that load late.
- Validation and canonicalisation of plans, value bounds, canonical JSON (de)serialization, the byte-size budget, schema versioning and migration, and rebasing a plan to a new `datasetVersion`.
- Determinism guarantees for everything above.

**Out:**
- Fetching parcel chunks over the network. The worker host (see the brush-tool spec, §Internal types) fetches them and passes `ParcelRecord[]` in.
- Stroke sampling and simplification. brush-tool owns these; plan-model only validates the result.
- Typology generation (`typology-generator`), scoring (`scoreboard`), and storage or transport (`plan-sharing`).
- Any DOM, MapLibre, deck.gl or `localStorage` access. The package must import cleanly in Node and in a web worker.

Module location: `src/lib/plan/` (no `$app` or `$env` imports). Runtime dependency: `kdbush` only.

## 2. Interfaces

Owned or consumed rows, copied verbatim:

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I2 | `interface Envelope { maxStories: number }` — the per-parcel allowed envelope. The **only** thing manipulation writes. Later milestones add optional fields; M1 code must ignore unknown fields | plan-model → generator, scoreboard | MC (envelope-as-common-currency), DC (field set) |
| I3 | `type PlanOp = BrushStroke` where `interface BrushStroke { kind: 'paint' \| 'erase'; stories: number; radiusM: number; path: [lng: number, lat: number][]; id: string }`. The union widens in later milestones (`AreaOp`, `PolicyOp`) | brush-tool → plan-model | DC |
| I4 | `interface Plan { schema: 1; datasetVersion: string; ops: PlanOp[]; title?: string }` | plan-model → brush-tool, plan-sharing | DC |
| I5 | `resolveEnvelopes(plan: Plan, index: ParcelIndex): Map<ParcelId, Envelope>`. Ops apply in order and later ops win. A parcel is covered by a stroke iff its label point is within `radiusM` of the stroke polyline. `erase` deletes the entry. Ineligible parcels never get an entry | plan-model → generator | DC |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, EPSG:7131 or equivalent, origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, neighborhoods: url }` | data-pipeline → map-view, generator, platform | DC |

### Internal types (new; they do not alter any I-row)

```ts
// Geometry
type XY = [x: number, y: number];                    // metres in the plan-model plane (§4.1)
function project(lng: number, lat: number): XY;
type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

// Spatial index (consumed by I5 as `ParcelIndex`)
interface ParcelIndex {
  addChunk(cellId: string, records: ParcelRecord[]): ParcelId[]; // returns the ids it added
  hasChunk(cellId: string): boolean;
  get(id: ParcelId): ParcelRecord | undefined;
  covered(op: PlanOp): ParcelId[];          // every loaded parcel covered by op, eligible or not; ascending id order
  size: number;
}
function createParcelIndex(): ParcelIndex;
function opBBox(op: PlanOp): BBox;          // path bbox grown by radiusM; used to pick which chunks to load

// Incremental resolution
type EnvelopeMap = Map<ParcelId, Envelope>;
interface EnvelopeChange { id: ParcelId; before: Envelope | null; after: Envelope | null }
interface OpCoverage { eligible: ParcelId[]; ineligible: ParcelId[] }
function applyOp(state: EnvelopeMap, op: PlanOp, index: ParcelIndex): { changes: EnvelopeChange[]; coverage: OpCoverage }; // mutates state
function resolveParcels(ops: readonly PlanOp[], index: ParcelIndex, ids: Iterable<ParcelId>): Map<ParcelId, Envelope | null>;
function resolveChunk(plan: Plan, index: ParcelIndex, addedIds: ParcelId[]): Map<ParcelId, Envelope | null>;

// Bounds
const STORIES_MIN = 1, STORIES_MAX = 60;
const RADIUS_MIN_M = 5, RADIUS_MAX_M = 500;
const PATH_MAX_POINTS = 2000;
const OPS_MAX = 5000;
const MAX_PLAN_BYTES = 262_144;             // I13's 256 KB, as UTF-8 bytes of serializePlan()
const SF_BBOX: BBox = [-123.1738, 37.6040, -122.2818, 37.9298]; // includes the Farallones and Treasure Island

// Serialization and versioning
type PlanError = { path: string; code: PlanErrorCode; message: string };
type PlanErrorCode = 'not-json' | 'not-object' | 'future-schema' | 'unknown-schema' | 'bad-field' | 'out-of-bounds'
  | 'too-many-ops' | 'too-many-points' | 'duplicate-id' | 'too-large';
type Result<T> = { ok: true; value: T } | { ok: false; errors: PlanError[] };
function parsePlan(text: string): Result<Plan>;       // JSON.parse → migrate → validate → canonicalise
function validatePlan(raw: unknown): Result<Plan>;    // same, but skips JSON.parse
function serializePlan(plan: Plan): string;           // canonical JSON
function planByteSize(plan: Plan): number;
function quantize(deg: number): number;               // Math.round(deg * 1e6) / 1e6
function rebasePlan(plan: Plan, datasetVersion: string): Plan;
function emptyPlan(datasetVersion: string): Plan;
const CURRENT_SCHEMA = 1;
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>; // empty in M1
```

**Why `kdbush`.** kdbush is a static kd-tree over points. It is built with `add(x, y)` followed by `finish()`, and it answers `range(minX, minY, maxX, maxY)` and `within(x, y, r)` (verified: `npm view kdbush` readme, lines 71–88; v4.1.0, ISC). Label points are points, so an R-tree over rectangles (flatbush 4.6.2) would add bbox overhead for no gain. kdbush is static, which suits us because chunks are immutable once loaded. `ParcelIndex` keeps **one kdbush per loaded chunk** plus a projected chunk bbox, so lazy loading is a plain `addChunk` and nothing is ever rebuilt. The `within` radius would only express a disc around a single point, so coverage is computed per segment instead (§4.2). Internal choice: the kdbush node size (default 64).

## 3. Global constraints (verbatim from design)

- **Free and open source.** No paid APIs and no vendor keys are needed to run
  or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app
  (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for
  DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings
  and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1:
  *theoretical max buildout*). Net counts are shown, not gross. Sources and
  vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era
  laptop. Generated buildings appear within 150 ms of pointer-up for strokes
  covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within
  5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel
  chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works
  at 375 px.
- **Data is static and versioned.** The worker does no geo computation at
  runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all
  work, bare-name Cloudflare resources (`sfhousing`), and the migration
  workflow via Drizzle.

## 4. Behaviour

### 4.1 Plane and distance metric

Coverage is computed in a fixed local plane in metres, using an equirectangular projection about a constant reference latitude φ₀ = 37.7562° (the approximate SF centroid):

```
x = (lng − LNG0) × M_PER_DEG_LNG      LNG0 = -122.4431, M_PER_DEG_LNG = 87913.423594147971
y = (lat − LAT0) × M_PER_DEG_LAT      LAT0 =   37.7562, M_PER_DEG_LAT = 111195.08023353292
```

- The constants are **literals**, taken from the mean Earth radius 6,371,008.8 m and cos φ₀ = 0.79062332082958531 (computed once, offline, in Node). Runtime code must not call `Math.cos`, `Math.sin` or `Math.hypot`. ECMAScript only promises approximations for these, so engines may differ in the last bit. `+ − × ÷` and `Math.sqrt` are correctly rounded under IEEE-754, so the result is bit-identical on every engine.
- Error: inside SF the scale error is ≤ 0.12% (cos 37.83° / cos 37.71°, inferred). At the 500 m maximum radius that is ≤ 0.6 m, which is far below lot width (≈ 7.6 m). The metric is a defined convention, not a survey measurement.
- The polygon CRS in I6 (EPSG:7131) is not used here. plan-model reads only `labelPoint`.

### 4.2 Coverage (the I5 predicate, made exact)

- A path `P = [p₀ … pₙ₋₁]` with n ≥ 1 is projected point by point. A one-point path covers a disc. An n-point path covers the union of the n−1 segment capsules.
- A label point L is covered iff `min over segments of dist²(L, seg) ≤ radiusM²`. The boundary is **inclusive**. Squared distances are compared, so coverage needs no `sqrt`.
- Point-to-segment distance: `t = clamp(((L−A)·(B−A)) / |B−A|², 0, 1)`, and `|B−A|² = 0` gives `t = 0`. Then `d² = |L − (A + t(B−A))|²`. Every term is evaluated in exactly this order (it is written in the spec so the tests can pin it).
- Candidate selection: for each segment, call `range()` on the segment bbox grown by `radiusM`. This is done only on chunks whose projected bbox intersects it. The exact test is then applied. Results are deduplicated and returned in ascending `ParcelId` order (JS `<` on strings).
- `covered()` returns both eligible and ineligible parcels, so that callers can report "N not eligible". Only `applyOp` and `resolve*` filter on `eligible`.

### 4.3 resolveEnvelopes semantics

```
state = empty Map
for op in plan.ops (array order):
  for id in index.covered(op) where index.get(id).eligible:
    paint → state.set(id, { maxStories: op.stories })   // replace, never merge or max
    erase → state.delete(id)
return state re-inserted in ascending ParcelId order
```

- **Later ops win, absolutely.** Painting 3 stories over a 12-story paint sets the parcel to 3. OD-2 (never demolish existing buildings) is the generator's rule (`generate` returns `null`), not a resolve rule.
- `erase.stories` is validated (§4.6) but has no effect on resolution.
- An erase over a parcel with no entry is a no-op.
- An **empty plan**, or a plan whose strokes cover only ineligible or unloaded parcels, resolves to an empty Map.
- **Partial index.** The result is only defined over the parcels loaded in `index`. A plan's resolution is *complete* when every chunk whose bbox intersects some `opBBox(op)` has been added. The caller (the worker host) must load those chunks before it treats a score as final (brush-tool spec §4.9). For any set of loaded chunks, the result restricted to them is independent of the order in which they were loaded.
- Output Map iteration order is ascending `ParcelId`. This makes downstream iteration (generation order, diff order) deterministic, whatever order the chunks arrived in.
- Envelope objects are fresh per entry and frozen (`Object.freeze`). No unknown fields are ever written (I2).

### 4.4 Incremental resolution (live preview, commit, undo, late chunks)

All of these are defined to **equal** a full `resolveEnvelopes`. The equalities are property-tested (§6).

1. **Append.** `applyOp(resolve(ops[0..k)), op_k)` produces exactly `resolve(ops[0..k])`. This holds because paint and erase each overwrite a covered parcel without reading its prior value. `changes` lists only the parcels whose envelope actually changed (`before` ≠ `after` by `maxStories`), in ascending id order. `coverage` is the full covered set, split by eligibility.
2. **Preview.** A preview is `applyOp` on a copy-on-write overlay of the committed state. The worker host must not mutate committed state during preview. plan-model provides no special preview API: the host calls `applyOp` with a scratch Map that it seeds lazily. Internal choice: whether the host reuses work across successive previews of a growing path. Each preview result must equal a fresh `applyOp` against committed state.
3. **Undo of the last op.** Let `ids = covered(lastOp) ∩ eligible`. Then `resolveParcels(ops[0..k−1), index, ids)` gives the new value for each id (`null` means no entry). Each id is resolved by scanning ops from newest to oldest and stopping at the first op that covers it. Ops are first filtered by `opBBox`. Other parcels are untouched. The result equals `resolve(ops[0..k−1))`.
4. **Late chunk.** When `addChunk` adds ids, `resolveChunk(plan, index, addedIds)` gives their values. It is the same backward scan as in (3), restricted to ops whose `opBBox` intersects the chunk bbox.
5. **Full load or whole-plan replacement** (open a plan, remix, a migration) calls `resolveEnvelopes`.

Performance budget, measured in Node on CI hardware with a synthetic 150,000-parcel index and a plan of 40 radius-500 m strokes covering the whole city: `resolveEnvelopes` ≤ 1,000 ms, which leaves ≥ 4 s of the 5 s budget for generation. Appending a single 500-parcel op takes ≤ 10 ms.

### 4.5 Coordinates and quantisation

- All plan coordinates are quantised with `quantize(deg) = Math.round(deg × 1e6) / 1e6` (≈ 0.11 m north–south). **brush-tool quantises at sampling time.** So the in-memory plan, the serialized plan and the reparsed plan are value-identical, and preview, commit and a reload all resolve the same.
- `validatePlan` accepts unquantised input (for example, hand-edited JSON) and canonicalises it by quantising. A plan that changes under canonicalisation is still `ok`, and the canonical value is what is returned.

### 4.6 Validation rules (all-or-nothing)

A plan is rejected whole if any rule fails. Every failure is reported, with a JSON-pointer `path` (for example `/ops/12/radiusM`). M1 never loads a plan partially.

| field | rule | code |
|---|---|---|
| root | a plain object | `not-object` |
| `schema` | missing → `unknown-schema`. A number > `CURRENT_SCHEMA` → `future-schema`. Otherwise it is migrated (§4.8) and must then equal 1 | |
| `datasetVersion` | string, 1–64 chars, matching `^[A-Za-z0-9._-]+$` | `bad-field` |
| `title` | absent, or a string of ≤ 120 chars after trim (an empty string after trim is dropped) | `bad-field` |
| `ops` | array of length ≤ `OPS_MAX` (5,000) | `too-many-ops` |
| `op.kind` | `'paint'` or `'erase'` | `bad-field` |
| `op.id` | string, 1–32 chars, `^[A-Za-z0-9_-]+$`, unique in the plan | `bad-field` / `duplicate-id` |
| `op.stories` | integer 1–60 (also enforced on erase) | `out-of-bounds` |
| `op.radiusM` | integer 5–500 | `out-of-bounds` |
| `op.path` | 1–2,000 points. Each point is a 2-tuple of finite numbers inside `SF_BBOX` | `too-many-points` / `out-of-bounds` |
| whole | `planByteSize ≤ MAX_PLAN_BYTES` | `too-large` |

- The stories range 1–60 covers the tallest residential tower in SF (Salesforce Tower is 61 floors but is office; inferred from public sources). 60 × 3.1 m = 186 m. A higher cap is an M3 decision (scenario layers).
- The radius range 5–500 m runs from "one lot" to "whole-city repaint in ≈ 15 passes".
- Unknown properties on the root or on ops are **dropped** during canonicalisation. They are not an error. This is consistent with I2's "ignore unknown fields".

### 4.7 Serialization

- `serializePlan` emits compact JSON (no whitespace). Keys appear in a fixed order: root `schema, datasetVersion, title?, ops`; op `id, kind, stories, radiusM, path`. Numbers are formatted by `JSON.stringify` of the quantised doubles.
- The output is canonical: `serializePlan(parsePlan(s).value) === s` for every canonical `s`, and `parsePlan(serializePlan(p)).value` deep-equals `p`.
- Size guidance (inferred): one path point costs about 24 bytes, so a typical 20-point stroke is about 560 bytes, and the 256 KB cap holds about 450 such strokes. No compact or binary encoding ships in M1 (YAGNI; see Open question 1).
- The media type is `application/json`. The same string is used for `localStorage`, for the I13 POST body, and for any download.

### 4.8 Schema versioning and migration

- `CURRENT_SCHEMA = 1`. `MIGRATIONS[n]` maps raw schema `n` to `n+1`. It is empty in M1.
- Migration runs on raw objects before validation. Each migration is pure and total over valid input of its version.
- A plan with `schema > CURRENT_SCHEMA` fails with `future-schema`. Its message is: "This plan was made with a newer version of SF Housing. Reload the page to get the latest version." Callers display the message as given.
- Any change to op semantics, or any new `PlanOp` variant, **must** bump `schema`. M1 code then rejects that plan, instead of silently resolving it wrongly.

### 4.9 datasetVersion

- `Plan.datasetVersion` records the dataset in effect when the plan was last edited. Strokes are geographic, so a plan resolves against any dataset. Results may differ wherever parcels changed.
- `rebasePlan(plan, v)` returns a copy with `datasetVersion = v`, with `ops` left unchanged. brush-tool calls it on the first op it commits to a plan whose version differs from the current manifest.
- plan-model never rejects a plan for being stale. The user-facing notice and the choice of which dataset to render belong to plan-sharing and the app shell (see the brush-tool spec, §5).

### 4.10 Determinism statement

Given a byte-identical `serializePlan` and an identical set of loaded chunk records, every function here returns identical results on every JS engine. The guarantee rests on: literal projection constants; only `+ − × ÷` and `sqrt` in geometry; deterministic ordering of outputs; and no `Date`, `Math.random`, locale-sensitive compare or Map iteration over insertion orders that depend on load order.

## 5. Seams

- **`area-select` (M2).** `AreaOp` will join `PlanOp`. Now: `applyOp`, `covered` and `opBBox` dispatch on `op.kind` through an exhaustive `switch` with a `never` check. Nothing else is added.
- **`scenario-loader` (M3).** A baseline envelope layer will sit under user ops. Now: erase is defined as "delete the user-layer entry", which composes later as "fall through to the baseline". No baseline parameter is added yet.
- **`policy-levers` (M3).** Envelope gains fields. Now: paint writes `{ maxStories }` only, by replacement. Consumers must ignore unknown fields (I2). M3 must specify whether its paint merges or replaces; that is a schema bump.
- **`buildout-likelihood`, `time-permitting`, `pipeline-overlay`, `accounts`.** No plan-model change now.

## 6. Testing

Vitest **server** project (Node), with colocated `*.spec.ts` files under `src/lib/plan/`. fast-check is used for property tests (planafoot already depends on `fast-check ^4.9.0`, verified: planafoot/package.json:121).

Fixtures in `src/lib/plan/fixtures/`:
- `grid-20x20.ts`: 400 hand-made parcels, label points on a 10 m grid from a fixed origin in the Mission, split into 4 chunks. Every 7th parcel is `eligible: false`.
- `edge-cases.ts`: label points at exactly r, at r ± 1e-6 m, on segment endpoints, and beside a zero-length segment.
- `plans/*.json`: `empty.json`, `single-stamp.json`, `paint-then-erase.json`, `overlap-lower-wins.json`, `unquantised.json`, `future-schema.json`, `too-large.json` (generated in the test), `unknown-fields.json`.
- `golden/*.json`: the expected `[ParcelId, maxStories][]` for each plan against `grid-20x20`.

Unit tests:
1. `project` matches the literal constants. A grep test fails if `Math.cos`, `Math.sin` or `Math.hypot` appears under `src/lib/plan/`.
2. Coverage boundary: exactly r is covered, r + ε is not. A one-point path is a disc. Zero-length segments are handled. Clamping applies at both ends.
3. Resolve: ordering (lower wins), erase, ineligible never present, empty plan, a stroke only over ineligible parcels yields `{eligible: [], ineligible: [...]}`.
4. Output ordering: ascending ids, whatever order the chunks were added in.
5. Validation table: one test per row in §4.6. All errors are reported, and the paths are correct.
6. Serialization: key order, canonical round-trip, unknown fields dropped, quantisation of `unquantised.json`.
7. Migration: `future-schema` message text, missing schema, and the `MIGRATIONS` chain runner (tested with a fake registry `{1: identity}`).
8. `rebasePlan` immutability.

Property tests (fast-check, ≥ 200 runs each, fixed seed in CI):
- P1 Append: `applyOp(resolve(ops[..k]), op)` ≡ `resolve(ops[..k+1])`.
- P2 Undo: `resolveParcels` patch ≡ `resolve(ops[..k−1])`.
- P3 Chunk order: any permutation of `addChunk` order gives the same resolution. Late chunk plus `resolveChunk` ≡ full resolve with all chunks present.
- P4 Round-trip: `parse(serialize(p))` ≡ `p` for arbitrary valid plans.
- P5 Coverage agrees with a brute-force O(n·m) reference implementation.

Golden tests: `golden/*.json` compared exactly.

Benchmark (`resolve.bench.ts`, run in CI and failing above budget): 150k synthetic parcels, 40 strokes ≤ 1,000 ms; one 500-parcel append ≤ 10 ms.

There are no DOM, e2e or axe tests in this subsystem. The cross-layer seams are covered in the brush-tool spec.

## 7. Acceptance criteria

1. `src/lib/plan/` imports nothing but `kdbush` and type-only imports of I6. It runs unchanged in Node and in a module worker.
2. Every function in "Internal types" exists with the given signature, and I1–I5 match the design verbatim.
3. Properties P1–P5 pass, and the goldens match.
4. The benchmark budgets in §4.4 pass on CI.
5. `parsePlan` rejects every malformed fixture with the specified codes, and accepts every valid one.
6. `serializePlan` output for `golden` plans is byte-stable across Node 22+ and Chromium (asserted in the brush-tool browser test that round-trips through the worker).
7. No trig functions appear in `src/lib/plan/` (lint/grep test).

## 8. Open questions

1. **A compact wire encoding** (for example, delta-encoded polyline strings) would raise the stroke capacity of the 256 KB cap about 4×. It would change I13's body away from `Plan` JSON. *Recommend:* not in M1. Revisit if real plans approach 75% of the cap (brush-tool warns at 90%).
2. **Stories cap of 60.** *Recommend:* keep it for M1. M3's scenario-loader may need higher values for downtown height districts (up to 1,200 ft ≈ 118 stories, inferred). Raising the cap is a validation change, and it would not need a schema bump if semantics stay the same.

## Interface concerns (for the orchestrator)

- **IC-1: `ParcelIndex` and partial data.** I5 names `ParcelIndex` but does not define it, and the design loads chunks lazily. This spec defines `ParcelIndex` as internal and states that the result is complete only once all chunks intersecting the ops are loaded. I5's text is unchanged.
- **IC-2: I12 consumers.** The worker host builds the index from I12 `chunks[].bbox/url`, so plan-model (`opBBox`) and brush-tool (the worker host) are de facto consumers of I12, but I12 does not list them.
- **IC-3: chunk uniqueness.** This spec assumes data-pipeline assigns each parcel to exactly one chunk, by label point. If a parcel id appears in two chunks, `addChunk` keeps the first and throws in dev builds if the records differ. data-pipeline should state this invariant.
- **IC-4: `erase.stories`.** I3 requires `stories` on erase, where it is meaningless. This spec keeps it required (1–60) and ignored. Making it optional in a later widening would need a schema bump.
