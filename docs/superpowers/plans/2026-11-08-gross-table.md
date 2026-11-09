# Fast policy load: a pipeline-built gross table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a published policy at `/s/<id>` at about the speed of a fresh `/sim` (≤ 2.5 s to the first timeline, from 12.9 s) by looking touched-lot yields up in a pipeline-built gross table instead of generating buildings in the browser, and by not running a throwaway first revision.

**Architecture:** The pipeline writes `scenarios/fzp/gross.bin`: for every `parcels.bin` row, `gross(row, s)` from `first` to `plateau`, computed with the same `scenarioYield` call the client makes, clamped to 0xFFFF and checked by a new invariant V36. The `/sim` worker fetches it with `parcels.bin` and, when the manifest names it, builds each lever revision's `EnvelopeRow`s from table lookups (no `generate`, no chunk wants, no `resolving`); without it the chunk-backed recompute runs as today, now clamped too. On `/s`, `initScenario` carries `awaitLevers`, the worker posts nothing until the first `setLevers` revision is current, and `LeverSync` sends the opening policy without the debounce, with a failed brush's lots empty.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Node `worker_threads` (pipeline only), `DecompressionStream('deflate-raw')` (worker), Vitest (server, client, pipeline projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-gross-table-design.md`. Prior measurement scripts (not production code, but they pin the algorithms): `/private/tmp/claude-501/-Users-mindlace-Projects-sfhousing/74ac24ef-8876-458e-93a9-f363632bbec5/scratchpad/yield-table/` (`encode.mts` scheme (c), `full.mts`, `verify.mts`, `predcheck.mts`) and `.../scratchpad/sim-profile/run.mjs`.

## Global Constraints

- Numbers are identical to today's recompute, bit for bit, on every input, except the one lot whose gross exceeds 65,535 (`4591A090`), which is clamped instead of wrapping.
- No client-supplied yield ever reaches another viewer. No seed and no run results are published (Call 17).
- Gross is a function of (row, stories) only; cap, `existingUnits` and protections apply after it (`envelopeRow`, `src/lib/data/envelope-row.ts:17-31`). No encoding or lookup may assume gross rises with stories (4.5% of rows dip).
- Lookup rule: g(s) = 0 when s ≤ 0 or s < `first`; g(s) = g(`plateau`) when s ≥ `plateau`; ineligible and all-zero rows store an empty range. The generator clamps stories to 80.
- Encoding: one header, then per row a u8 `first`, a u8 `plateau`, then zigzag-varint deltas from g(`first` − 1) = 0; the file is deflate-raw like `parcels.bin`. Rows in `parcels.bin` order.
- Values are clamped to 0xFFFF (`GROSS_MAX`) on the table path and on the fallback recompute path alike.
- Manifest key `scenarios.fzp.gross`, file `scenarios/fzp/gross.bin`, optional in the schema (older datasets lack it). With no key the chunk-backed recompute runs unchanged; that fallback stays.
- Every edit under `pipeline/`, `src/lib/data`, `src/lib/generator`, `src/lib/sim/scenario` and `src/lib/sim/levers` moves the dataset version (`pipeline/lib/version.ts:40-50`). Build and upload once, in Task 9, after the last such edit.
- Out of scope: `/sim` draft restore (keeps today's throwaway revision), `packCells` and the 2.5 s revision-0 cap, the generator and every yield, a default-lever seed.
- Acceptance: `/s/<id>` for the profiling policy ready (first timeline at the last levers rev sent) in ≤ 2,500 ms, median of 3 cold loads, production build; `/sim` cases A and B do not regress.
- Vitest `expect.requireAssertions`; colocated tests; behaviour tests count work, not milliseconds. 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits with `-m` flags. Never `cd x && cmd`. No Claude attribution anywhere.

## Review Focus

1. **A `gross.bin` that does not belong to its `parcels.bin`** (another build's file, a row count or `datasetVersion` that differs). Expected: the load fails `scenario-invalid` naming `gross.bin`; the table is never used. Test in Task 5.
2. **`setLevers` arriving before the load finishes on an `awaitLevers` session.** Expected: one revision runs, at the `setLevers` rev; nothing is posted at the init rev. Test in Task 6.
3. **An edit on an opened policy before its brushes resolve** (edit mode with `initialPolicy`). Expected: the opening ends; the edit is debounced as usual, and no document with empty lots is sent for a query that is merely in flight. Test in Task 7.
4. **A crash and Retry after the opening send.** Expected: the new `initScenario` carries the full levers and no `awaitLevers`, so the session cannot wait forever. Test in Task 7.
5. **Rows that dip, or fall back to 0 after `first`.** Expected: negative deltas and interior zeros round-trip, and lookups inside the range return them exactly. Test in Task 1.

## Resolutions (my calls)

- **Header** (spec leaves to the builder): ASCII `SFHG`, u8 format version `1`, u8 length + ASCII `datasetVersion`, u32le row count. The `datasetVersion` lets the worker refuse a table from another build.
- **Story bound**: `physicalMaxStories` with the variety edge inset, 80 for district-size lots (20 s vs 67 s; `predcheck.mts` found no row whose plateau exceeds it). V36's sample sweeps s up to 81 and 255, so a bound that is too low fails the build.
- **Build inputs**: the spec says the build reads `readParcelRecords` and also that each worker loads its inputs itself; workers cannot reach the build's DuckDB. Workers read `parcels.bin` and the chunk files from the out dir instead, which are exactly the records the client decodes. V36 re-derives a sample from the decoded chunks as the spec asks.
- **Inline build for the fixture**: `writeGross({ workers: 0 })` runs in-thread; the live build uses `availableParallelism() − 1` workers. A pipeline test proves both give the same file.
- **Seam**: two factories behind the one `YieldRecompute` interface (`createYieldRecompute` unchanged but clamped; new `createTableRecompute`), not a rewritten `createYieldRecompute`. Its tests and `bench-levers.ts` keep measuring the fallback unchanged.
- **"Current in the same `leverStep`"**: the documented order is heights before `current` (`docs/dev/sim-levers.md`, Protocol; `scenario-host.ts:46-51`). The table path keeps it: the revision's city builds first, then the table recompute finishes in the next `recompute` job, with no `resolving` post and no chunk wants.
- **A named `gross.bin` that fails to fetch or decode fails the load** (as `policy.bin` does) rather than silently falling back.
- **"Posts nothing"** under `awaitLevers` means no `levers`, `heights`, `timeline` or `chunks` message before the first `current`. `ready`, `error` and answers to requests (`brushLots`, `brushCatalog`, `lotAt`, `heightLids`, `lotOutlines`, `parcelSummary`, `previewBuildings`) still go: brushes must resolve for `setLevers` to exist.
- **"First compile" in `LeverSync`** is the opening policy's compile (`LeverSync.open`, `/s` only), not the first edit on `/sim`, which keeps its debounce. Empty lots for a failed brush apply only to that opening send; later sends keep today's rule (a failed query holds the send). A `no-session` answer still parks until `resume`; it can only outlast a session that never starts, which shows its own failed or crashed state.
- **`bench-levers.ts`** keeps measuring the fallback and adds a "Table ms" column when the dataset has `gross.bin`.
- **Profiling harness**: committed as `scripts/profile-sim-load.mjs` with the profiling policy, because the scratchpad does not outlive this session.
- **`data-serving.md`** names no files in its key layout: no change.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/lib/data/gross-table.ts` (new, + `.test.ts`) | `GrossTable`, row builder, story bound, codec, lookup, binding check | 1 |
| `src/lib/data/manifest.ts` (+ `manifest.test.ts`) | `scenarios.fzp.gross`; `manifestFiles`, `GLYPH_RANGES`, `SPRITE_SUFFIXES`; superRefine uses it | 2 |
| `scripts/data-local.ts` (+ spec), `pipeline/steps/upload.ts`, `pipeline/steps/verify.ts` (+ tests) | file lists from `manifestFiles` | 2 |
| `pipeline/lib/scenario-files.ts` | `GROSS_BIN` | 3 |
| `pipeline/steps/gross.ts`, `pipeline/steps/gross-worker.ts` (new) | `writeGross`, worker entry, `readGrossBin`, `GROSS_DUMP` | 3 |
| `pipeline/steps/check-gross.ts` (new) | `checkV36` | 3 |
| `pipeline/steps/build.ts`, `manifest.ts`, `check.ts`, `fixture.ts`; `pipeline/test/gross.test.ts` (new), `golden.test.ts` | wiring, golden dump | 3 |
| `e2e/fixtures/data/fixture-0/`, `pipeline/test/fixtures/mini/golden/` | regenerated | 3 |
| `src/lib/sim/levers/recompute.ts` (+ spec) | clamp; `createTableRecompute` | 4 |
| `src/lib/sim/levers/table-recompute.spec.ts` (new) | fixture-0 equivalence | 4 |
| `src/lib/sim/scenario/load.ts`, `scenario-host.ts`, `test/host-harness.ts`, `fixtures/mini-gross.ts` (new) | fetch and bind the table; table path | 5 |
| `src/lib/sim/scenario/scenario-host.gross.spec.ts` (new) | table path, fallback, bad tables | 5 |
| `src/lib/sim/scenario/types.ts`, `load.ts`, `scenario-host.ts`; `scenario-host.await.spec.ts` (new) | `awaitLevers` | 6 |
| `src/lib/sim/scenario-client.ts` (+ spec), `src/lib/fzp/FzpMode.svelte` (+ spec), `src/lib/sim-page/policy-store.svelte.ts` (+ spec), `SimPage.svelte` (+ spec) | client side | 7 |
| `scripts/bench-levers.ts`, `scripts/profile-sim-load.mjs` (new), `scripts/profile-sim-load.policy.json` (new) | tooling | 8 |
| `docs/dev/pipeline.md`, `sim-levers.md`, `sim-page.md`, `developing.md` | docs | 2, 3, 5, 6, 7, 9 |

---

### Task 1: The gross table (codec, row builder, lookup)

**Files:**
- Create: `src/lib/data/gross-table.ts`
- Test: `src/lib/data/gross-table.test.ts`

**Interfaces:**
- Consumes: `scenarioYield` (`src/lib/data/scenario-yield.ts:30`), `scenarioRecordOf` (`scenario-codec.ts:625`), `ScenarioParcels`; generator `normaliseSite` (`generator/site`), `physicalMaxStories` (`generator/physical`), `drawVariety` (`generator/variety`), `fnv1a32` (`$lib/generator`), `mayBeDistrict`, `districtArea` (`generator/district-layout.ts:120,138`), `DISTRICT_MIN_M2` (`generator/constants.ts:74`, 20,000) — as `full.mts` `predCeiling` uses them.
- Produces (worker-safe, no `node:` imports):

```ts
export const GROSS_MAX = 0xffff;
export const GROSS_STORIES_MAX = 80;
export interface GrossRow { first: number; plateau: number; values: number[]; clamped: number }
export interface GrossTable {
  format: 'sfh-gross/1';
  datasetVersion: string;
  count: number;
  first: Uint8Array;   // per row
  plateau: Uint8Array; // per row; 0 = empty row
  offset: Uint32Array; // count + 1: row i's values are values[offset[i]..offset[i+1])
  values: Uint16Array; // g(first..plateau) per row
}
export function clampGross(g: number): number;
export function grossStoryBound(rec: ParcelRecord): number; // rec = a scenarioRecordOf view
export function grossRowOf(
  rec: ParcelRecord | undefined,
  yieldOf?: (rec: ParcelRecord, stories: number) => number // default scenarioYield(rec, s, null)
): GrossRow;
export function grossTableOf(datasetVersion: string, rows: readonly GrossRow[]): GrossTable;
export function grossAt(t: GrossTable, row: number, stories: number): number;
export function encodeGrossPayload(t: GrossTable): Uint8Array;
export function decodeGrossPayload(bytes: Uint8Array): GrossTable;
export function readGrossTable(body: Uint8Array): Promise<GrossTable>; // inflate deflate-raw, decode
export function grossTableProblem(t: GrossTable, p: ScenarioParcels): string | null;
```

- [ ] **Step 1: Write the failing tests** in `gross-table.test.ts` (fixtures: `miniCity()` from `src/lib/sim/scenario/fixtures/mini-parcels.ts`; `T` = `grossTableOf('mini-v', [EMPTY, A, B])` with `EMPTY = { first: 0, plateau: 0, values: [], clamped: 0 }`, `A = { first: 1, plateau: 5, values: [4, 8, 12, 12, 16], clamped: 0 }`, `B = { first: 2, plateau: 7, values: [10, 30, 25, 0, 40, 41], clamped: 0 }`; `eligibleRec` = an eligible mini-city scenario view whose polygon is replaced by a 160 m square, so its bound is 80):

```ts
it('round-trips a table through encode and decode', () => {
  expect(decodeGrossPayload(encodeGrossPayload(T))).toEqual(T);
});
it('looks up 0 at s <= 0 and below first, g(plateau) at and above plateau', () => {
  expect([grossAt(T, 2, -3), grossAt(T, 2, 0), grossAt(T, 2, 1)]).toEqual([0, 0, 0]);
  expect([grossAt(T, 2, 3), grossAt(T, 2, 5)]).toEqual([30, 0]); // the dip and the interior zero
  expect([grossAt(T, 2, 7), grossAt(T, 2, 80), grossAt(T, 2, 255)]).toEqual([41, 41, 41]);
  expect([grossAt(T, 0, 1), grossAt(T, 0, 80)]).toEqual([0, 0]);
});
it('grossRowOf keeps first..plateau of the sweep, interior zeros and dips included', () => {
  const sweep = [0, 0, 10, 30, 25, 0, 40, 41]; // s = 1..8, then 41 to the bound
  const row = grossRowOf(eligibleRec, (_, s) => sweep[s - 1] ?? 41);
  expect(row).toEqual({ first: 3, plateau: 8, values: [10, 30, 25, 0, 40, 41], clamped: 0 });
});
it('grossRowOf clamps above 0xFFFF and counts the stored values it clamped', () => {
  const row = grossRowOf(eligibleRec, (_, s) => (s >= 3 ? 162_730 : 1000 * s));
  expect(row).toEqual({ first: 1, plateau: 3, values: [1000, 2000, 65535], clamped: 1 });
});
it('an ineligible or missing record gives an empty row', () => {
  expect(grossRowOf(undefined)).toEqual(EMPTY);
  expect(grossRowOf({ ...eligibleRec, eligible: false })).toEqual(EMPTY);
});
it('grossStoryBound: 0 ineligible, 80 for a district-size lot, else physicalMaxStories', () => {
  // district: a 160 m square (25,600 m² >= DISTRICT_MIN_M2); a 7.62 x 30.48 m lot gives 6
});
it('decode rejects bad magic, a newer version, a truncated row, trailing bytes and plateau < first');
it('encode throws a RangeError for a value above 0xFFFF');
it('readGrossTable inflates deflate-raw bytes', async () => {
  expect(await readGrossTable(deflateRawSync(encodeGrossPayload(T)))).toEqual(T);
});
it('grossTableProblem names a count or datasetVersion that differs from parcels.bin');
it('on the mini city every row matches clampGross(scenarioYield) at s = 0..81 and 255', () => {
  // table built from grossRowOf(scenarioRecordOf(P, i, rec)) for every row; compare every s
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project server src/lib/data/gross-table.test.ts`
Expected: FAIL, cannot resolve `./gross-table`.

- [ ] **Step 3: Implement `src/lib/data/gross-table.ts`.** `grossRowOf` sweeps s = 1..`grossStoryBound(rec)`; `first` is the first s with g > 0, `plateau` the last s where g(s) ≠ g(s − 1) (g(0) = 0); no positive value gives the empty row (the algorithm of `encode.mts` scheme (c)). `grossStoryBound` is `full.mts` `predCeiling`. Encoding is the header in "Resolutions" then scheme (c): u8 `first`, u8 `plateau`, and for `plateau > 0` one zigzag LEB128 varint per s = `first..plateau` of g(s) − g(s − 1). `decodeGrossPayload` throws an `Error` naming the problem (magic, version, truncation, trailing bytes, `first` 0 with `plateau` > 0, `plateau < first`, `plateau` > 80, a value outside 0..0xFFFF). `readGrossTable` inflates as `readScenarioParcels` does (`scenario-codec.ts:532`).

- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/gross-table.ts src/lib/data/gross-table.test.ts
git commit -m "feat(data): gross table codec, row builder and lookup"
```

---

### Task 2: `scenarios.fzp.gross` and one manifest-file enumerator

**Files:**
- Modify: `src/lib/data/manifest.ts:56-66` (schema), `:80-116` (superRefine)
- Modify: `scripts/data-local.ts:9-39`, `pipeline/steps/upload.ts:111-135` (`datasetProblems`), `pipeline/steps/verify.ts:53-63`
- Test: `src/lib/data/manifest.test.ts`, `scripts/data-local.spec.ts`, `pipeline/test/upload.test.ts`, `pipeline/test/verify.test.ts`
- Docs: `docs/dev/developing.md:32` (`data:local` now copies the scenario files, `gross.bin` and every glyph range)

**Interfaces:**
- Produces:

```ts
// src/lib/data/manifest.ts
export interface ManifestFile { key: string; url: string; optional: boolean }
export interface GlyphSet { stacks: readonly string[]; ranges: readonly string[] }
export const GLYPH_RANGES: readonly string[]; // 256 entries: '0-255', '256-511', … '65280-65535'
export const SPRITE_SUFFIXES: readonly ['.json', '.png', '@2x.json', '@2x.png'];
/** Every file `m` names, in schema order. Without `glyphs` the glyph entry is the template. */
export function manifestFiles(m: Manifest, glyphs?: GlyphSet): ManifestFile[];
// scripts/data-local.ts (replaces isSpritePath)
export function isOptionalPath(manifest: Manifest, version: string, rel: string): boolean;
```

`key` is the schema path (`'scenarios.fzp.gross'`, `` `chunks.${i}.url` ``, `'glyphs'`, `'sprite'`); `optional` is true only for sprite variants. `manifest.json` is not an entry.

- [ ] **Step 1: Write the failing tests**
  - `manifest.test.ts`: `'accepts scenarios.fzp.gross and rejects one outside the version'` (`/data/<v>/scenarios/fzp/gross.bin` parses; `/data/other/…` gives one issue at path `scenarios.fzp.gross`); `'every /data/ string in a manifest with every optional field set is a manifestFiles url'` (deep-walk the golden plus `sprite`, `transit`, `scenarios.fzp.{policy,gross,frontage}` and `scenarios.lesscars`; each string starting `/data/` equals some entry's `url`, the sprite base counted through its four variants); `'manifestFiles expands glyphs to stack × range'` (`{ stacks: ['A', 'B'], ranges: GLYPH_RANGES }` gives 512 `glyphs` entries, first `/data/<v>/fonts/A/0-255.pbf`, last `/data/<v>/fonts/B/65280-65535.pbf`); `'only sprite variants are optional'`; `'a bad glyph template is reported once'`.
  - `data-local.spec.ts`: update the expected list in `'returns sorted, de-duplicated relative paths including sprite variants'` to add the 768 glyph paths and every scenario file of a manifest with `scenarios.fzp` (parcels, projects, calibration, policy, gross) and `scenarios.lesscars`; replace `'excludes the glyphs template and source urls'` with `'lists every glyph range of every font stack and no source urls'` (768 `fonts/` paths, none containing `{` or `http`); `'isOptionalPath tolerates sprite variants and glyph ranges only'`.
  - `upload.test.ts`: `'datasetProblems names a missing gross.bin the manifest lists'`. `verify.test.ts`: `'verify HEADs gross.bin when the manifest names it'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project server src/lib/data/manifest.test.ts scripts/data-local.spec.ts` and `npx vitest --run --project pipeline pipeline/test/upload.test.ts pipeline/test/verify.test.ts`
Expected: FAIL (`manifestFiles` not exported; `gross` stripped by the schema; lists lack the new files).

- [ ] **Step 3: Implement.** Add `gross: RootRelativeUrl.optional()` with a one-line doc comment beside `policy`. Move the list in superRefine into `manifestFiles`; superRefine checks each entry's prefix and reports once per `key`. `collectDataPaths` = `manifestFiles(m, { stacks: Object.values(FONT_STACKS), ranges: GLYPH_RANGES })` mapped through its `rel` check, plus `manifest.json`; `main()` skips a 404 when `isOptionalPath`, and drops the glyph warning. `datasetProblems` and `verify` take their lists from `manifestFiles(m, { stacks: Object.values(FONT_STACKS), ranges: ['0-255'] })` without the optional entries (today they check one `0-255.pbf` per stack; that stays).

- [ ] **Step 4: Run to verify they pass** — same commands; Expected: PASS. Also `npx vitest --run --project pipeline pipeline/test/manifest.test.ts`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/manifest.ts src/lib/data/manifest.test.ts scripts/data-local.ts scripts/data-local.spec.ts pipeline/steps/upload.ts pipeline/steps/verify.ts pipeline/test/upload.test.ts pipeline/test/verify.test.ts docs/dev/developing.md
git commit -m "feat(data): manifest gross key and one manifest-file enumerator" -m "data:local now copies the scenario files and glyph ranges."
```

---

### Task 3: Pipeline: `gross.bin`, V36 and fixture-0

**Files:**
- Modify: `pipeline/lib/scenario-files.ts` (add `GROSS_BIN = 'scenarios/fzp/gross.bin'`)
- Create: `pipeline/steps/gross.ts`, `pipeline/steps/gross-worker.ts`, `pipeline/steps/check-gross.ts`
- Modify: `pipeline/steps/build.ts:232-246` (after `writeScenario`), `:355-366` (manifest), `pipeline/steps/manifest.ts:19-99` (`gross?: boolean`), `pipeline/steps/check.ts:840-845` (V36 after V35), `pipeline/steps/fixture.ts:161-180` (golden dump)
- Test: `pipeline/test/gross.test.ts` (new), `pipeline/test/golden.test.ts:73-84,197-204`, `pipeline/test/manifest.test.ts`
- Regenerate: `e2e/fixtures/data/fixture-0/`, `pipeline/test/fixtures/mini/golden/`
- Docs: `docs/dev/pipeline.md` (Commands `build` row, Where things land, Fixture, Invariants: V36)

**Interfaces:**
- Consumes: Task 1 (`grossRowOf`, `grossTableOf`, `encodeGrossPayload`, `decodeGrossPayload`, `grossAt`, `clampGross`); `readParcelsBin` (`pipeline/steps/scenario.ts:481`); `decodeParcelChunk`; Task 2's manifest key.
- Produces:

```ts
// pipeline/steps/gross.ts
export const GROSS_DUMP = 'scenarios/fzp/gross.decoded.json';
export async function writeGross(a: {
  outDir: string; // parcels.bin and the chunks are already written there
  datasetVersion: string;
  workers: number; // 0 = in this thread
}): Promise<{ counts: Record<string, number>; warnings: string[] }>;
export function readGrossBin(file: string): GrossTable; // inflateRawSync + decode; throws naming the file
export function formatGrossDump(t: GrossTable): string;
// pipeline/steps/check-gross.ts
export const GROSS_CHECK_STRIDE = 251;
export function checkV36(
  outDir: string,
  m: Manifest | null,
  p: ScenarioParcels | null,
  records: ReadonlyMap<ParcelId, ParcelRecord>, // decoded chunk records
  stableDetail: boolean
): InvariantResult;
```

Counts from `writeGross`: `gross.rows`, `gross.values`, `gross.clamped`, `gross.plateau_max`, `gross.bytes.payload`, and `gross.bytes.file` (not on fixture versions, as `scenario.bytes.file`). A warning names every lot with a clamped value.

V36 fails unless: the manifest names `scenarios.fzp.gross` whenever it has `scenarios.fzp`; the file inflates and decodes; its `datasetVersion` is the manifest's and its count is `parcels.bin`'s (`grossTableProblem`); re-encoding is byte-identical; and for every row `i` with `i % GROSS_CHECK_STRIDE === 0` (every row when `count <= 2000`), at s = 0..81 and 255, `grossAt` equals `clampGross(scenarioYield(scenarioRecordOf(p, i, rec), s, null))` (0 when the decoded chunks lack the record). The detail names the first mismatching row and s.

- [ ] **Step 1: Write the failing tests** in `pipeline/test/gross.test.ts`, on a temp copy of `e2e/fixtures/data/fixture-0` (`manifest.json`, `parcels/`, `scenarios/fzp/parcels.bin`):

```ts
it('writeGross in-thread and with 2 workers writes the same table', async () => {
  // decoded tables equal; counts['gross.rows'] === parcels.count
});
it('every row of the written table matches clampGross(scenarioYield) on the decoded chunks');
it('checkV36 passes on the written table');
it('checkV36 fails naming the row when one value is changed'); // re-encode with values[k] + 1
it('checkV36 fails when the row count differs from parcels.bin');
it('checkV36 fails when the manifest has scenarios.fzp but no gross');
```

`manifest.test.ts`: `'buildManifest names gross.bin only with scenarios and gross'`. `golden.test.ts`: in `'matches the golden byte for byte…'` add `expect(grossDumpOf(a)).toBe(readFileSync(join(golden, GROSS_DUMP), 'utf8'))` and the same for `b`; in `'e2e/fixtures/data/fixture-0 is the committed output…'` add the e2e dump.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/gross.test.ts pipeline/test/manifest.test.ts`
Expected: FAIL, `../steps/gross` not found.

- [ ] **Step 3: Implement.** `writeGross` loads `parcels.bin` and the chunk records from `outDir`, builds one `GrossRow` per row with `grossRowOf(rec && scenarioRecordOf(p, i, rec))`, writes `deflateRawSync(encodeGrossPayload(t), { level: 9 })`, then reads it back with `readGrossBin`. With `workers > 0`, each worker (`gross-worker.ts`, started with `new Worker(…, { eval: true, workerData })` and bootstrapped through `tsx/esm/api` `tsImport` as `full.mts` does) loads the same inputs itself, takes batches of 64 rows from a shared `Int32Array` cursor (`Atomics.add`), and posts `{ start, rows: GrossRow[] }`; the main thread assembles them in row order. In `build.ts`, run it as `report.time('gross', …)` with `workers: fixtureMode ? 0 : Math.max(1, availableParallelism() - 1)`, merge its counts and warnings, and pass `gross: existsSync(join(outDir, GROSS_BIN))` to `buildManifest`. `checkDataset` passes `checkV36` the decoded chunk records it already has (`recs`). `fixture --update-golden` writes `GROSS_DUMP` beside `SCENARIO_DUMP`.

- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.

- [ ] **Step 5: Regenerate the fixture and the golden**

Run: `npm run pipeline -- fixture --update-golden`
Expected: exit 0, every invariant OK including `V36`; `git status` shows `e2e/fixtures/data/fixture-0/scenarios/fzp/gross.bin`, `manifest.json` and `report.json` changed, `pipeline/test/fixtures/mini/golden/scenarios/fzp/gross.decoded.json` new. Review the diff: only gross additions.

Run: `npm run test:pipeline`
Expected: PASS (golden included).

- [ ] **Step 6: Docs.** `pipeline.md`: `build` row names `gross.bin`; Where things land lists it; Fixture names `gross.decoded.json`; Invariants: "V1 to V33, V35 and V36", with V36's rule as above.

- [ ] **Step 7: Commit**

```bash
git add pipeline e2e/fixtures/data/fixture-0 docs/dev/pipeline.md
git commit -m "feat(pipeline): build scenarios/fzp/gross.bin with invariant V36"
```

---

### Task 4: Table recompute and the clamp

**Files:**
- Modify: `src/lib/sim/levers/recompute.ts:41-129`
- Test: `src/lib/sim/levers/recompute.spec.ts`, `src/lib/sim/levers/table-recompute.spec.ts` (new)

**Interfaces:**
- Consumes: Task 1 (`GrossTable`, `grossAt`, `clampGross`, `readGrossTable`); fixture-0's `gross.bin` from Task 3.
- Produces:

```ts
// recompute.ts: the existing deps gain an optional seam; GrossCache entries are clamped
export function createYieldRecompute(
  parcels: ScenarioParcels,
  needs: readonly Need[],
  deps: {
    record(id: ParcelId): ParcelRecord | undefined;
    cellLoaded(cellId: string): boolean;
    now(): number;
    /** Test seam; default `scenarioYield(rec, s, null)`. Its result is clamped (`clampGross`). */
    grossOf?(rec: ParcelRecord, stories: number): number;
  },
  gross: GrossCache
): YieldRecompute;
/** The same `YieldRecompute` from table lookups: `cellsNeeded()` is always [], `missing` empty. */
export function createTableRecompute(
  parcels: ScenarioParcels,
  needs: readonly Need[],
  table: GrossTable,
  deps: { now(): number }
): YieldRecompute;
```

- [ ] **Step 1: Write the failing tests**
  - `recompute.spec.ts`: `'clamps a gross above 0xFFFF before it reaches a yield'` — one Need `{ row, stories: 4, cap: null }` on an eligible mini row with `grossOf: () => 162_730`; `result().get(key)!.yield` is `[65535, 65535, 65535, 65535, 65535]` and the cache holds 65535. `createTableRecompute`: `'needs no cells and reproduces parcels.bin at the FZP stories and cap'` (as the first existing test, with the mini table built from `grossRowOf`); `'honours the budget: one need per step when every need costs the budget'`; `'a table row above 0xFFFF stays 65535 through capScenarioYield'` (table with `values: [65535]`, cap null → yield 65535; cap 100 → 100).
  - `table-recompute.spec.ts` (server project; reads `e2e/fixtures/data/fixture-0` `scenarios/fzp/parcels.bin`, `scenarios/fzp/gross.bin` and every chunk): `'table-backed and recompute-backed EnvelopeRows are identical for a sweep of Needs'` — Needs for every row × stories `[0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 40, 79, 80, 81, 255]` × cap `[null, 0, existingUnits, existingUnits + 1, 3, 100]`; `expect(tableResult).toEqual(recomputeResult)` over the whole map, and `missing` is `[]` on both.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/levers/recompute.spec.ts src/lib/sim/levers/table-recompute.spec.ts`
Expected: FAIL, `createTableRecompute` not exported; the clamp test sees 31,658 (162,730 mod 65,536).

- [ ] **Step 3: Implement.** In `createYieldRecompute`'s `grossAt` (`recompute.ts:80-85`) store `clampGross((deps.grossOf ?? defaultGross)(view, s))`. `createTableRecompute` dedupes Needs by `needKey` as the existing one does and computes each with `envelopeRow({ …, grossAt: (s) => grossAt(table, n.row, s) })`, in need order, within the budget (the first need of a step always runs).

- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS. Also `npx vitest --run --project server src/lib/sim/levers`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/levers/recompute.ts src/lib/sim/levers/recompute.spec.ts src/lib/sim/levers/table-recompute.spec.ts
git commit -m "feat(levers): table-backed yield recompute; clamp gross to 0xFFFF on both paths"
```

---

### Task 5: The worker loads `gross.bin` and runs the table path

**Files:**
- Modify: `src/lib/sim/scenario/load.ts:28-40` (`ScenarioUrls.gross`, `Loaded.gross`), `:46-56` (`decodeGross` seam), `:104-114` (`scenarioUrls`), `:244-389` (`loadScenario`)
- Modify: `src/lib/sim/scenario/scenario-host.ts:153-172` (deps), `:284-303` (`LeverWork.table`), `:569-603` (`load`), `:605-640` (`loadedHook`), `:825-871` (`leverStep`), `:548-558` (`onFailed`)
- Create: `src/lib/sim/scenario/fixtures/mini-gross.ts`
- Modify: `src/lib/sim/scenario/test/host-harness.ts:111-180` (`gross` option, tracked `decodeGross`)
- Test: `src/lib/sim/scenario/scenario-host.gross.spec.ts` (new), `src/lib/sim/scenario/load` tests where `scenarioUrls` is pinned
- Docs: `docs/dev/sim-levers.md` (Protocol `resolving` bullet and Performance intro: the table path)

**Interfaces:**
- Consumes: Task 1 (`readGrossTable`, `grossTableProblem`, `grossRowOf`, `grossTableOf`, `encodeGrossPayload`), Task 4 (`createTableRecompute`).
- Produces:

```ts
// load.ts
export type ScenarioUrls = { parcels: string; projects: string; calibration: string;
  policy: string | null; gross: string | null };
export interface Loaded { fzp: SimInput; twin: SimInput; projects: ProjectsFile;
  policy: PolicyParcels | null; gross: GrossTable | null };
// LoadDeps and ScenarioHostDeps gain: decodeGross?(bytes: Uint8Array): Promise<GrossTable>
// fixtures/mini-gross.ts
export const MINI_GROSS_URL: string; // `/data/${MINI_VERSION}/scenarios/fzp/gross.bin`
export function miniGross(city: ReturnType<typeof miniCity>): GrossTable;
// host-harness.ts: makeScenarioHarness({ …, gross?: boolean }) names MINI_GROSS_URL in the manifest
```

Behaviour: with `opts.policy` and `urls.gross`, `gross.bin` is a fifth concurrent fetch (bytes, with retries), decoded after `parcels.bin` and bound with `grossTableProblem`; a decode error or a problem is `scenario-invalid` with message `scenario gross.bin: <problem>`; a failed fetch fails as the other files do. Without `opts.policy` it is never requested. `lw.table = loaded.gross`. With a table, `leverStep` builds `createTableRecompute`, returns after starting the city (no `postResolving`, no `loader.want`), and never posts `resolving` while stepping; `onFailed` posts nothing for it.

- [ ] **Step 1: Write the failing tests** in `scenario-host.gross.spec.ts` (harness as in `scenario-host.levers.spec.ts`: `bandRuns: 5`, `raised([LOT_A, LOT_B], 8)`):

```ts
it('with gross.bin a lever revision posts no resolving and fetches no chunk', async () => {
  // init with levers, runAll, no prefetch: levers posts are exactly ['current'];
  // no chunk URL in h.fetches; heights, then current, then the first timeline, in that order
});
it('table and recompute give the same current and the same timelines', async () => {
  // gross vs no gross, seed 1, prefetch WORLD after the first timeline on both:
  // the current posts (lookups, capacity, unknownLots) are equal; sha(timelines.map(content)) equal
});
it('a manifest without gross runs the recompute and never fetches gross.bin', async () => {
  // policy manifest, no gross key, gross body served anyway: fetchesOf(MINI_GROSS_URL) is [];
  // a resolving post precedes current
});
it('/fzp never fetches gross.bin even when the manifest names it');
it('a gross.bin with another row count fails the load as scenario-invalid', async () => {
  // errors()[0]: code 'scenario-invalid', message contains 'gross.bin'; no levers post
});
it('a gross.bin from another datasetVersion fails the load as scenario-invalid');
it('a gross.bin that does not decode fails the load as scenario-invalid');
it('a gross.bin that 404s on every attempt fails the load', async () => {
  // fail(MINI_GROSS_URL, 4, { status: 404 }): one error, code 'internal'
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/scenario/scenario-host.gross.spec.ts`
Expected: FAIL (`gross` harness option unknown; `resolving` posted on the table manifest).

- [ ] **Step 3: Implement** the interfaces and behaviour above. `miniGross` builds every row with `grossRowOf(scenarioRecordOf(city.parcels, i, city.records.get(id)))`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --run --project server src/lib/sim/scenario`
Expected: PASS, the existing lever, heights and brush specs unchanged (they run without `gross`, so they keep covering the fallback).

- [ ] **Step 5: Docs.** `sim-levers.md`: the `resolving` bullet says it is posted only on the fallback (no `scenarios.fzp.gross`); a sentence on the table path and the clamp under Performance.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sim/scenario docs/dev/sim-levers.md
git commit -m "feat(sim): load gross.bin and resolve lever revisions from the table"
```

---

### Task 6: `awaitLevers`: the worker holds every post until the first revision is current

**Files:**
- Modify: `src/lib/sim/scenario/types.ts:95-103` (`initScenario.awaitLevers?: boolean`)
- Modify: `src/lib/sim/scenario/load.ts:83-90` (`validateInitRequest`)
- Modify: `src/lib/sim/scenario/scenario-host.ts`: `Session` (`:355-375`), `initScenario` (`:466-536`), `prefetch` (`:560-567`), `loadedHook` (`:605-640`), `setLevers` (`:693-705`), `nextJob` (`:762-770`), `leverStep` at `current` (`:858-871`)
- Test: `src/lib/sim/scenario/scenario-host.await.spec.ts` (new), `src/lib/sim/scenario/load` validation tests
- Docs: `docs/dev/sim-levers.md` Protocol (`initScenario.awaitLevers`)

**Interfaces:**
- Consumes: Task 5's table path.
- Produces: request field `awaitLevers?: boolean` on `initScenario`, valid only with `levers` (`validateInitRequest` returns `'awaitLevers needs levers'`, or `'awaitLevers must be a boolean'`). Session state: `awaitingLevers: boolean` (from an `awaitLevers` init until the first `setLevers`), `holding: boolean` (until the first `current`), `heldPrefetch: readonly number[] | null` (the latest bbox while holding).

Behaviour: while `awaitingLevers`, `loadedHook` creates no pending revision and `nextJob` returns null; a `setLevers` (before or after the load) clears it and is the session's first revision. A reroll while waiting only replaces `w.run` (its seed becomes the revision's, through `w.run.requested`). While `holding`, `prefetch` stores its bbox and wants nothing; the first `current` replays the latest stored bbox and clears `holding`.

- [ ] **Step 1: Write the failing tests** in `scenario-host.await.spec.ts` (`gross: true` unless stated):

```ts
it('nothing but ready is posted until setLevers', async () => {
  // init({ levers: raised([LOT_A], 8), awaitLevers: true }); runAll; sequence(h) is ['ready:1']
});
it('setLevers after the load runs one revision at its rev: heights, current, timelines');
// no levers, heights or timeline post has rev 1
it('setLevers before the load finishes: one revision, at the setLevers rev'); // holdDecodes
it('brush requests are answered while waiting'); // resolveBrush → brushLots ok, nothing else
it('a reroll while waiting gives the first revision its seed', async () => {
  // reroll(seed 9) after load: nothing posted; setLevers: the first timeline has seed 9
});
it('a prefetch while waiting fetches no chunk; the latest bbox loads at current');
it('without gross: setLevers posts resolving, then current (an /s open on an older dataset)');
it('awaitLevers without levers is bad-request');
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/scenario/scenario-host.await.spec.ts`
Expected: FAIL (levers and timeline posts at rev 1).

- [ ] **Step 3: Implement** the behaviour above.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --run --project server src/lib/sim`
Expected: PASS.

- [ ] **Step 5: Docs.** `sim-levers.md` Protocol: `initScenario.awaitLevers` and what is and is not posted while it holds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sim/scenario docs/dev/sim-levers.md
git commit -m "feat(sim): awaitLevers holds every post until the first setLevers is current"
```

---

### Task 7: Client: `/s` opens on its own levers

**Files:**
- Modify: `src/lib/sim/scenario-client.ts:159-178` (`initScenario`)
- Modify: `src/lib/fzp/FzpMode.svelte:131-135` (prop), `:418-437` (`startScenario`), `:443-451` (`syncLevers`)
- Modify: `src/lib/sim-page/policy-store.svelte.ts:119-269` (`LeverSync.open`)
- Modify: `src/lib/sim-page/SimPage.svelte:184-187`, `:243-248`, `:996-1010`
- Test: `src/lib/sim/scenario-client.spec.ts`, `src/lib/fzp/FzpMode.svelte.spec.ts:1233`, `src/lib/sim-page/policy-store.svelte.spec.ts`, `src/lib/sim-page/SimPage.svelte.spec.ts`
- Docs: `docs/dev/sim-page.md:53` (debounce bullet) and `:124` (Resolution: the opening send)

**Interfaces:**
- Consumes: Task 6's `awaitLevers`.
- Produces:

```ts
// scenario-client.ts
initScenario(manifest: Manifest, horizon: Day, seed?: number | null, levers?: SimLevers,
  awaitLevers?: boolean): Rev; // sends awaitLevers: true only when true and levers is given
// FzpMode props
/** /sim: `levers` lacks its brush lots; the next initScenario asks the worker to wait. */
leversIncomplete?: boolean;
// LeverSync
/** The opening policy (a load): sends once every query has answered, with no debounce. */
open(p: SimPolicy): void;
```

Behaviour: `startScenario` reads `leversIncomplete` untracked with `levers` and passes it. `syncLevers` sends once a session was started (`latest !== null`), not after a crash, not in phase `'failed'`, not while `rerollBusy`; it no longer waits for `scenarioLive`. `open` asks the policy's queries; once none is in flight or parked it sends on a 0 ms timer, compiling a failed query (`ok: false`, any reason but `no-session`) as no lots; an `update` before that send ends the opening. `SimPage` calls `sync.open(store.policy)` in `onMount` when `opened`, and passes `leversIncomplete={initialIncomplete && levers === initial}` with `initialIncomplete = opened !== null && queriesOf(firstPolicy).length > 0`.

- [ ] **Step 1: Write the failing tests**
  - `scenario-client.spec.ts`: `'initScenario sends awaitLevers only when asked, and only with levers'`.
  - `FzpMode.svelte.spec.ts`: replace `'a levers change before the first timeline waits for it'` (`:1233`) with `'a levers change before the first timeline is sent at once'` (rerender with `next` before `toReady`: `allOf('setLevers')` reaches length 1 with `levers` `next`, with no timeline emitted); add `'leversIncomplete: the first initScenario carries awaitLevers'`; `'a crash Retry after the full levers were sent carries no awaitLevers'` (rerender `{ levers: next, leversIncomplete: false }`, crash, Retry: the new `initScenario` has `levers` `next` and no `awaitLevers`); `'a levers change after a failed load sends nothing'`.
  - `policy-store.svelte.spec.ts` (fake timers, the existing `harness`):

```ts
it('open: sends as soon as every query has answered, without the debounce', async () => {
  h.sync.open(withBrushes(area('RH-1'))); h.pending[0].resolve(ok(['a']));
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sent).toHaveLength(1); expect(h.sent[0].rules[0].lots).toEqual(['a']);
});
it("open: a failed query sends with that brush's lots empty", async () => {
  // harness(() => failed): after advance(0), sent[0].rules[0].lots is []; result(key) is `failed`
});
it('open: a bad-request answer also sends with empty lots');
it('open: a no-session answer parks; resume asks again and the answer is sent at once');
it('open: a policy with no brushes sends at once');
it('after the opening send, a failed query on an edit sends nothing', async () => {
  // open → sent 1; update(withBrushes(area('RH-2'))) answered `failed`; advance(1000): sent 1
});
it('an update before the opening send ends the opening: the debounce applies', async () => {
  // open(RH-1) unanswered; update(RH-2) answered ok; advance(249): sent []; advance(1): sent 1
});
```

  - `SimPage.svelte.spec.ts`: `'/s with brushes: the first initScenario carries awaitLevers, the full levers follow as setLevers'`; `'/s without brushes: no awaitLevers'`; `'plain /sim: no awaitLevers'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --run --project client src/lib/fzp/FzpMode.svelte.spec.ts src/lib/sim-page/policy-store.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts` and `npx vitest --run --project server src/lib/sim/scenario-client.spec.ts`
Expected: FAIL (`open` is not a function; no `awaitLevers`; `setLevers` held until ready).

- [ ] **Step 3: Implement** the interfaces and behaviour above.

- [ ] **Step 4: Run to verify they pass** — same commands; Expected: PASS. Then `npx playwright test e2e/sim-share.spec.ts e2e/sim.spec.ts --project=chromium`: PASS (the publish round trip and the gone-dataset fallback open on fixture-0, which now has the table).

- [ ] **Step 5: Docs.** `sim-page.md`: the debounce bullet excepts the opening send; Resolution describes `open` and the empty-lots rule for it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sim/scenario-client.ts src/lib/sim/scenario-client.spec.ts src/lib/fzp src/lib/sim-page docs/dev/sim-page.md
git commit -m "feat(sim-page): open a published policy on its own levers, without a throwaway revision"
```

---

### Task 8: Bench and profiling tooling

**Files:**
- Modify: `scripts/bench-levers.ts:109-180`
- Create: `scripts/profile-sim-load.mjs`, `scripts/profile-sim-load.policy.json`

**Interfaces:**
- Consumes: Task 1 (`readGrossTable`), Task 4 (`createTableRecompute`).
- Produces: `npx tsx scripts/bench-levers.ts <datasetDir>` prints a "Table ms" column (one unsliced `createTableRecompute(...).step(Infinity)` per brush) when `<datasetDir>/scenarios/fzp/gross.bin` exists; other columns unchanged. `node scripts/profile-sim-load.mjs --origin <url> [--runs 3] [--trace]` publishes `profile-sim-load.policy.json` (its `datasetVersion` replaced by the origin's) through `POST /api/policies`, then loads A `/sim`, B `/sim?seed=72` and C `/s/<id>` cold (fresh headed Chromium context each), and prints per case the median of "ready": the first `timeline` message at or after the last `initScenario`/`setLevers` rev the page sent, in ms from navigation (the Worker hook of `sim-profile/run.mjs`). Exit 2 when a load errors.

- [ ] **Step 1: Port** `run.mjs` into `scripts/profile-sim-load.mjs` (drop the trace unless `--trace`; add publishing, the three cases, `--runs`, the median). Copy `sim-profile/policy.json` to `scripts/profile-sim-load.policy.json`.

- [ ] **Step 2: Smoke-test on the fixture**

Run: `npm run preview` (background), then `node scripts/profile-sim-load.mjs --origin http://localhost:4173 --runs 1`
Expected: three lines `A …ms`, `B …ms`, `C …ms`, exit 0 (the policy's brushes may find no lots on fixture-0; C still reaches its timeline).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/bench-levers.ts scripts/profile-sim-load.mjs scripts/profile-sim-load.policy.json
git commit -m "chore(scripts): table column in bench-levers; cold-load profiling harness"
```

---

### Task 9: Dataset build and upload, acceptance, docs numbers

Every edit under the code-hash paths is done; from here on nothing under them changes (docs and `scripts/` are not hashed). Follow `docs/dev/pipeline.md` "Finishing a branch that changes the dataset".

**Files:**
- Modify: `docs/dev/sim-levers.md` (Performance), `docs/dev/pipeline.md` (the build's `gross.*` counts and timing)

- [ ] **Step 1: Cache.** If `pipeline/.cache` is absent: `npm run pipeline -- fetch --restore`. Expected: exit 0.
- [ ] **Step 2: Merge.** `git merge origin/main`. Expected: clean merge (resolve, rerun `npm run test:unit`, commit if not).
- [ ] **Step 3: Build.** `npm run pipeline -- build`, without `--skip-tiles`. Expected: every invariant OK, V36 included; `report.json` counts `gross.rows` equal to `scenario.parcels` (155,020 on the measured lock), `gross.clamped` > 0 only on `4591A090`, `gross.bytes.file` near 220 KB. Note `<v>` from `npm run pipeline -- version`.
- [ ] **Step 4: Upload.** `npm run pipeline -- upload <v>`. Expected: exit 0, manifest last.
- [ ] **Step 5: Verify staging.** `npm run pipeline -- verify <v> --origin https://sfhousing-staging.mindlace.net` and `npx tsx scripts/dataset-version.ts --check`. Expected: both exit 0; `gross.bin` HEAD 200.
- [ ] **Step 6: Acceptance profile.** `npm run data:local -- <v> --from https://sfhousing-staging.mindlace.net`, `npm run db:migrate`, `npm run preview` (background, idle machine), then `node scripts/profile-sim-load.mjs --origin http://localhost:4173 --runs 3`. Expected: C ≤ 2,500 ms; A ≤ 1,125 ms and B ≤ 857 ms (10% over the recorded medians 1,023 and 779 ms on `2026-11-08-91736640`). If A or B is over, profile `main` the same way in the same sitting and compare against that instead. Do the run yourself; do not hand it to the owner.
- [ ] **Step 7: Bench.** `npx tsx scripts/bench-levers.ts pipeline/out/<v>`. Record the brush table with its Table ms column.
- [ ] **Step 8: Perf budgets.** On an idle machine, `npm run test:perf`. Expected: PASS (the scenario worker and the sim host changed).
- [ ] **Step 9: Docs.** `sim-levers.md` Performance: the bench rows on `<v>` with "Table ms", the `/s` cold-load medians (A, B, C) and the harness command. `pipeline.md`: the gross step's time and counts on `<v>`.
- [ ] **Step 10: Commit**

```bash
git add docs/dev/sim-levers.md docs/dev/pipeline.md
git commit -m "docs: gross table bench and cold-load numbers on <v>"
```

Then finish the branch (`npm run signoff`, PR, merge). If signoff's merge moves `origin/main`, `<v>` changes and the loop restarts at Step 2.

---

## Open questions

None needs the partner before building. One to watch: under `awaitLevers` the worker holds `prefetch` until `current` (spec §3), so revision-0 geometry starts its chunk fetches after the levers resolve rather than during the load. FzpMode already prefetches only after the first timeline, so this changes nothing today; if Task 9's C misses 2.5 s on packing, the spec's follow-up (post the first timeline before packing) is the lever, not the hold.
