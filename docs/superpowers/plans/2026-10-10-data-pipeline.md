# data-pipeline (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reproducible offline pipeline in `pipeline/` that turns public SF sources into a versioned static dataset (parcel chunks, building tiles, basemap, glyphs, neighborhoods, manifest, report), checks invariants V1–V13, uploads to R2 (local verified; remote is a partner action), and generates the e2e fixture dataset `fixture-0`.

**Architecture:** A Node/TypeScript CLI (`npx tsx pipeline/cli.ts <cmd>`) orchestrates: source adapters normalise raw downloads to GeoParquet in `.cache/norm/`; DuckDB (spatial) runs ordered SQL files that build `parcels`, `parcel_landuse`, `buildings`, `pieces` and `parcel_out` tables; TS steps turn those tables into chunks (via the shared pure-TS codec `src/lib/data/parcel-chunk.ts`), `neighborhoods.geojson`, `buildings.pmtiles` (tippecanoe), copy basemap/fonts, write `manifest.json` + `report.json`, then run invariants. A hand-made mini fixture exercises every rule and produces `e2e/fixtures/data/fixture-0/`.

**Tech Stack:** Node 24, TypeScript, tsx, `@duckdb/node-api@1.5.6-r.1` (spatial + httpfs extensions), tippecanoe 2.79.0, pmtiles 1.31.2, wrangler 4 (R2), zod 4, Vitest 4, fast-check, proj4 (dev only), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-data-pipeline-design.md` (design context: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`). Executors read both the spec and this plan; where they disagree, stop and ask.

**Worktree:** `/Users/mindlace/Projects/sfhousing/.claude/worktrees/data-pipeline`, branch `data-pipeline`, based on `9a4d100` (`superconductor/sf-housing-sim`). All paths below are relative to it. Never `cd dir && cmd` in one Bash call: `cd` in its own call, or use absolute paths.

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

- **I1** `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data.
- **I6** `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }`
- **I12** Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>`.

Rulings in force (from the conductor):

- `src/lib/data/parcel.ts` holds `ParcelId` and `ParcelRecord` verbatim. **Never change these shapes.** Import types from `$lib/data/parcel` (or a relative path from `pipeline/`).
- `src/lib/data/manifest.ts` (platform's) is the starting point. Tighten within I12 only. Keep the export names `DATASET_VERSION_RE`, `ManifestSchema`, `ManifestSourcesSchema`, `manifestUrl`, `Manifest`, and keep `src/lib/data/manifest.spec.ts`, `src/lib/server/data/*` tests and e2e green.
- Every `/data` path segment must match `^[A-Za-z0-9._-]+$`. Font stack directories are `NotoSans-Regular`, `NotoSans-Medium`, `NotoSans-Italic`.
- `e2e/fixtures/data/fixture-0/` is replaced by real `pipeline fixture` output; platform e2e must stay green.
- Do not touch `src/lib/plan/` or `src/lib/generator/` (other operators own them).
- Never upload to the remote R2 bucket and never bump `PUBLIC_DATASET_VERSION` in `wrangler.jsonc`. Remote upload is a partner action.

Project rules:

- Code style: 2-space indent, single quotes, no trailing commas, 100 columns (Prettier + ESLint). `npm run lint` and `npm run check` must pass at every commit.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- All shell-outs use `execFile`/`execFileSync`/`spawn` with argument arrays. Never a shell string.
- Pinned versions (spec §4.2): `@duckdb/node-api@1.5.6-r.1` (exact, devDependency: it never ships in the worker), `tippecanoe 2.79.0`, `pmtiles 1.31.2`. Homebrew's pmtiles prints `pmtiles dev, commit none`; `doctor` then falls back to `brew list --versions pmtiles`.
- `pipeline/.cache/` and `pipeline/out/` are gitignored.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Multi-line messages: write to a file in the scratchpad and `git commit -F`, or multiple `-m`. No heredocs.
- Never `git stash` bare. Never `cd x && y`.

## Review Focus

1. **Ids that look numeric** (`0026T001A`, `8711023C`, leading zeros like `0026…`): anything that parses, sorts numerically or casts an id would corrupt joins. Sorting is JS `<` on strings everywhere (codec, chunks). Pinned by the codec property test (ids with leading zeros/letters) and the fixture's two odd-shaped ids surviving to the golden chunk.
2. **Negative cell coordinates and cell boundaries**: a parcel whose rounded label point sits exactly on a 1000 m line, or west/south of the false origin, must still land in exactly one cell with `Math.floor`. Pinned by `cellIdFor` unit tests in Task 9.
3. **Degenerate geometry after quantisation**: slivers, rings that collapse below 3 vertices after cm rounding, and consecutive duplicates. A parcel whose every ring collapses must fail loudly (V7/V8 report), never emit an empty polygon silently. Pinned by `toLocalRings` tests in Task 9.
4. **Re-running upload on an already-published version** must abort before any put, and an interrupted upload must leave no manifest. Pinned by the upload tests in Task 13 (fake target asserts call order: exists check first, manifest last, nothing after an abort).
5. **Malformed chunk bodies reaching the decoder** (truncated JSON object, non-array columns, `rings` sum not matching `xy`, out-of-range dictionary index): the worker host must get a `ChunkFormatError`, not an `undefined` landUse. Pinned in Task 1 (dict-index-out-of-range and non-array-column cases added to the malformed list).

---

## File map

```
pipeline/
  cli.ts                      # command dispatch (Task 3)
  config.ts                   # bbox, grid, thresholds, pins, tool versions, invariant profiles (Task 3)
  sources.lock.json           # live lock, written by fetch (Task 12)
  lib/exec.ts                 # execFile helpers (Task 3)
  lib/duck.ts                 # DuckDB open/run/all/runSqlFile (Task 3)
  lib/lock.ts                 # Lock types, read/write/verify sha256 (Task 4)
  lib/version.ts              # datasetVersion derivation (Task 4)
  lib/rings.ts                # 7131 geometry → I6 local rings (Task 9)
  lib/report.ts               # report accumulator (Task 5)
  sources/normalise.ts        # raw GeoJSON/parquet → .cache/norm/<id>.parquet (Task 5)
  sources/datasf.ts overture.ts protomaps.ts   # live fetchers (Task 12)
  sql/10_parcels.sql … 70_export.sql           # (Tasks 6–8)
  steps/doctor.ts fetch.ts build.ts tiles.ts chunks.ts manifest.ts check.ts upload.ts verify.ts fixture.ts
  test/fixtures/mini/          # hand-made sources, lock, fonts, basemap, golden (Task 5, 11)
  test/*.test.ts               # pipeline vitest project
src/lib/data/parcel-chunk.ts (+ .test.ts)   # codec (Task 1)
src/lib/data/manifest.ts (+ manifest.test.ts) # tightened (Task 2)
e2e/fixtures/data/fixture-0/  # generated (Task 11)
e2e/data-fixture.spec.ts      # (Task 11)
.github/workflows/pipeline.yml, docs/dev/pipeline.md  (Task 14)
```

Shared names (every task uses exactly these):

- DuckDB input tables (created by `loadNormalised`, Task 5): `src_parcels(mapblklot VARCHAR, blklot VARCHAR, active BOOLEAN, analysis_neighborhood VARCHAR, geom GEOMETRY)`, `src_landuse(mapblklot VARCHAR, landuse VARCHAR, resunits INTEGER, res DOUBLE, totalcomm DOUBLE, geom GEOMETRY)`, `src_footprints(mblr VARCHAR, sf16_bldgid VARCHAR, hgt_median_m DOUBLE, geom GEOMETRY)`, `src_neighborhoods(nhood VARCHAR, geom GEOMETRY)`, `src_overture(id VARCHAR, height DOUBLE, num_floors INTEGER, min_height DOUBLE, is_underground BOOLEAN, datasets VARCHAR[], geom GEOMETRY)`. All `geom` in EPSG:4326, x = lng.
- SQL output tables: `parcels`, `parcel_landuse`, `buildings`, `pieces`, `parcel_out`, `buildings_export`, `neighborhoods_out`, and `report_counts(key VARCHAR, value DOUBLE)` (each SQL file inserts its own counts).
- DuckDB variables set before SQL runs (`SET VARIABLE name = value`, read with `getvariable('name')`): `min_piece_m2` (2.0), `iou_min` (0.5), `floors_m` (3.1), `default_height_m` (7.0), `nb_simplify_m` (3.0).

---

### Task 1: Parcel chunk codec `sfh-parcels/1`

**Files:**
- Create: `src/lib/data/parcel-chunk.ts`
- Test: `src/lib/data/parcel-chunk.test.ts`

**Interfaces:**
- Consumes: `ParcelRecord`, `ParcelId` from `src/lib/data/parcel.ts` (unchanged).
- Produces:
  ```ts
  export const PARCEL_CHUNK_FORMAT = 'sfh-parcels/1';
  export interface ParcelChunkV1 { /* exactly spec §2 Internal types */ }
  export class ChunkFormatError extends Error {}
  export function encodeParcelChunk(datasetVersion: string, cellId: string, recs: ParcelRecord[]): string;
  export function decodeParcelChunk(json: unknown): ParcelRecord[];
  export function ringsAreaM2(rings: [number, number][][]): number; // shoelace, rounded 0.01
  ```

Rules (spec §2): `id` ascending by JS `<` (encode sorts a copy; input order is irrelevant); dictionaries sorted ascending; `label` = `Math.round(lng*1e7)`, `Math.round(lat*1e7)`; `floorArea`, `height` = `Math.round(v*10)/10`; `units` integers (`Math.round`); `xy` = `Math.round(v*100)` integer centimetres interleaved; `rings[i]` = vertex count per ring. Output `JSON.stringify` with no whitespace and keys in the interface order. Decode accepts a string or a parsed object; ignores unknown top-level keys; throws `ChunkFormatError` on unknown `format`, any column length ≠ `count` (`label` ≠ `2·count`, `xy` ≠ `2·Σrings`), non-array columns, a dictionary index out of range, or `elig` value not 0/1. `areaM2` is computed on decode from the decoded rings (outer CCW positive, holes CW negative), rounded to 0.01; it is not stored.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/data/parcel-chunk.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from './parcel';
import { ChunkFormatError, decodeParcelChunk, encodeParcelChunk, ringsAreaM2 } from './parcel-chunk';

// Local stand-in for plan-model's grid-20x20 fixture (that module lives on another branch):
// 400 parcels, label points on a 10 m grid from a fixed Mission origin, every 7th ineligible.
function grid20x20(): ParcelRecord[] {
  const recs: ParcelRecord[] = [];
  for (let i = 0; i < 400; i++) {
    const r = Math.floor(i / 20), c = i % 20;
    recs.push({
      id: `9${String(r).padStart(3, '0')}${String(c).padStart(3, '0')}`,
      polygon: [[[-4, -4], [4, -4], [4, 4], [-4, 4]]],
      labelPoint: [
        Math.round((-122.4195 + c * 0.000113) * 1e7) / 1e7,
        Math.round((37.76 + r * 0.00009) * 1e7) / 1e7
      ],
      areaM2: 64,
      existingUnits: i % 5,
      existingFloorAreaM2: Math.round(i * 12.3 * 10) / 10,
      existingHeightM: Math.round((3 + (i % 9)) * 10) / 10,
      landUse: i % 3 === 0 ? 'MIXRES' : 'RESIDENT',
      eligible: i % 7 !== 0,
      neighborhood: r < 10 ? 'Mission' : 'Noe Valley'
    });
  }
  return recs;
}

const sortById = (rs: ParcelRecord[]) => [...rs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

describe('parcel chunk codec', () => {
  it('round-trips grid-20x20 exactly', () => {
    const recs = grid20x20();
    const json = encodeParcelChunk('fixture-0', '50_25', [...recs].reverse());
    expect(decodeParcelChunk(json)).toEqual(sortById(recs));
    expect(decodeParcelChunk(JSON.parse(json))).toEqual(sortById(recs));
  });

  it('is byte-deterministic and whitespace-free', () => {
    const a = encodeParcelChunk('fixture-0', '50_25', grid20x20());
    const b = encodeParcelChunk('fixture-0', '50_25', [...grid20x20()].reverse());
    expect(a).toBe(b);
    expect(a).not.toMatch(/\s/);
    expect(JSON.parse(a).format).toBe('sfh-parcels/1');
  });

  it('sorts dictionaries and ids with JS < on strings', () => {
    const base = grid20x20().slice(0, 3);
    base[0] = { ...base[0], id: '8711023C', landUse: 'VACANT' };
    base[1] = { ...base[1], id: '0026T001A', landUse: 'CIE' };
    base[2] = { ...base[2], id: '10', landUse: 'RESIDENT' };
    const c = JSON.parse(encodeParcelChunk('fixture-0', '0_0', base));
    expect(c.id).toEqual(['0026T001A', '10', '8711023C']);
    expect(c.dict.landUse).toEqual(['CIE', 'RESIDENT', 'VACANT']);
  });

  it('computes areaM2 by shoelace with holes negative', () => {
    const outer: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const hole: [number, number][] = [[2, 2], [2, 4], [4, 4], [4, 2]];
    expect(ringsAreaM2([outer, hole])).toBe(96);
  });

  it('property: decode(encode(r)) == r after quantisation', () => {
    const coord = fc.double({ min: -500, max: 500, noNaN: true }).map((v) => Math.round(v * 100) / 100);
    const rect = fc.tuple(coord, coord, fc.double({ min: 1, max: 50, noNaN: true }), fc.double({ min: 1, max: 50, noNaN: true }))
      .map(([x, y, w, h]) => {
        const q = (v: number) => Math.round(v * 100) / 100;
        return [[q(x), q(y)], [q(x + w), q(y)], [q(x + w), q(y + h)], [q(x), q(y + h)]] as [number, number][];
      })
      .filter((r) => r[0][0] !== r[1][0] && r[0][1] !== r[2][1]);
    const rec = fc.record({
      id: fc.stringMatching(/^[0-9]{4}[0-9A-Z]{3,5}$/),
      polygon: fc.array(rect, { minLength: 1, maxLength: 3 }),
      lng: fc.double({ min: -122.53, max: -122.34, noNaN: true }),
      lat: fc.double({ min: 37.69, max: 37.84, noNaN: true }),
      units: fc.nat(2000),
      fa: fc.double({ min: 0, max: 1e6, noNaN: true }),
      h: fc.double({ min: 0, max: 340, noNaN: true }),
      lu: fc.constantFrom('RESIDENT', 'MIXRES', 'OPENSPACE', 'NONE', 'UNKNOWN'),
      nh: fc.constantFrom('Mission', 'Noe Valley', 'Castro/Upper Market')
    });
    fc.assert(
      fc.property(fc.uniqueArray(rec, { selector: (r) => r.id, minLength: 1, maxLength: 30 }), (rs) => {
        const recs: ParcelRecord[] = rs.map((r) => ({
          id: r.id,
          polygon: r.polygon,
          labelPoint: [Math.round(r.lng * 1e7) / 1e7, Math.round(r.lat * 1e7) / 1e7],
          areaM2: ringsAreaM2(r.polygon),
          existingUnits: r.units,
          existingFloorAreaM2: Math.round(r.fa * 10) / 10,
          existingHeightM: Math.round(r.h * 10) / 10,
          landUse: r.lu,
          eligible: !['OPENSPACE', 'NONE'].includes(r.lu),
          neighborhood: r.nh
        }));
        const out = decodeParcelChunk(encodeParcelChunk('fixture-0', '0_0', recs));
        const exp = sortById(recs);
        expect(out.map((o) => ({ ...o, areaM2: 0 }))).toEqual(exp.map((o) => ({ ...o, areaM2: 0 })));
        out.forEach((o, i) => expect(Math.abs(o.areaM2 - exp[i].areaM2)).toBeLessThanOrEqual(0.01));
      })
    );
  });

  it('ignores unknown top-level keys', () => {
    const c = JSON.parse(encodeParcelChunk('fixture-0', '0_0', grid20x20().slice(0, 2)));
    c.yearBuilt = [1900, 1910];
    expect(decodeParcelChunk(c)).toHaveLength(2);
  });

  describe('malformed input throws ChunkFormatError', () => {
    const good = () => JSON.parse(encodeParcelChunk('fixture-0', '0_0', grid20x20().slice(0, 2)));
    const cases: [string, (c: Record<string, unknown>) => unknown][] = [
      ['unknown format', (c) => ({ ...c, format: 'sfh-parcels/2' })],
      ['units length', (c) => ({ ...c, units: [1] })],
      ['label length', (c) => ({ ...c, label: [1, 2, 3] })],
      ['xy length', (c) => ({ ...c, xy: (c.xy as number[]).slice(1) })],
      ['non-array column', (c) => ({ ...c, height: 'x' })],
      ['dict index out of range', (c) => ({ ...c, lu: [0, 99] })],
      ['elig not 0/1', (c) => ({ ...c, elig: [0, 2] })],
      ['not an object', () => 42],
      ['bad JSON string', () => '{"format":"sfh-parcels/1",']
    ];
    for (const [name, mutate] of cases) {
      it(name, () => {
        expect(() => decodeParcelChunk(mutate(good()))).toThrow(ChunkFormatError);
      });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/data/parcel-chunk.test.ts`
Expected: FAIL — cannot resolve `./parcel-chunk`.

- [ ] **Step 3: Implement**

```ts
// src/lib/data/parcel-chunk.ts
// Wire format "sfh-parcels/1" (data-pipeline spec §2). Pure TS, no dependencies:
// the pipeline writes chunks with it and the worker host reads them.
import type { ParcelId, ParcelRecord } from './parcel';

export const PARCEL_CHUNK_FORMAT = 'sfh-parcels/1';

export interface ParcelChunkV1 {
  format: 'sfh-parcels/1';
  datasetVersion: string;
  cellId: string;
  count: number;
  dict: { landUse: string[]; neighborhood: string[] };
  id: ParcelId[];
  label: number[];
  units: number[];
  floorArea: number[];
  height: number[];
  lu: number[];
  nh: number[];
  elig: (0 | 1)[];
  rings: number[][];
  xy: number[];
}

export class ChunkFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkFormatError';
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Shoelace over all rings (outer CCW positive, holes CW negative), rounded to 0.01 m². */
export function ringsAreaM2(rings: [number, number][][]): number {
  let twice = 0;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      twice += x1 * y2 - x2 * y1;
    }
  }
  return Math.round((twice / 2) * 100) / 100;
}

export function encodeParcelChunk(
  datasetVersion: string,
  cellId: string,
  recs: ParcelRecord[]
): string {
  const sorted = [...recs].sort((a, b) => cmp(a.id, b.id));
  const landUse = [...new Set(sorted.map((r) => r.landUse))].sort(cmp);
  const neighborhood = [...new Set(sorted.map((r) => r.neighborhood))].sort(cmp);
  const luIx = new Map(landUse.map((v, i) => [v, i]));
  const nhIx = new Map(neighborhood.map((v, i) => [v, i]));
  const chunk: ParcelChunkV1 = {
    format: PARCEL_CHUNK_FORMAT,
    datasetVersion,
    cellId,
    count: sorted.length,
    dict: { landUse, neighborhood },
    id: sorted.map((r) => r.id),
    label: sorted.flatMap((r) => [Math.round(r.labelPoint[0] * 1e7), Math.round(r.labelPoint[1] * 1e7)]),
    units: sorted.map((r) => Math.round(r.existingUnits)),
    floorArea: sorted.map((r) => r1(r.existingFloorAreaM2)),
    height: sorted.map((r) => r1(r.existingHeightM)),
    lu: sorted.map((r) => luIx.get(r.landUse)!),
    nh: sorted.map((r) => nhIx.get(r.neighborhood)!),
    elig: sorted.map((r) => (r.eligible ? 1 : 0)),
    rings: sorted.map((r) => r.polygon.map((ring) => ring.length)),
    xy: sorted.flatMap((r) =>
      r.polygon.flatMap((ring) => ring.flatMap(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]))
    )
  };
  return JSON.stringify(chunk);
}

function arr(c: Record<string, unknown>, key: string, len: number): unknown[] {
  const v = c[key];
  if (!Array.isArray(v)) throw new ChunkFormatError(`column ${key} is not an array`);
  if (v.length !== len) throw new ChunkFormatError(`column ${key} has ${v.length}, want ${len}`);
  return v;
}

export function decodeParcelChunk(json: unknown): ParcelRecord[] {
  let c: unknown = json;
  if (typeof c === 'string') {
    try {
      c = JSON.parse(c);
    } catch (e) {
      throw new ChunkFormatError(`invalid JSON: ${(e as Error).message}`);
    }
  }
  if (typeof c !== 'object' || c === null || Array.isArray(c)) {
    throw new ChunkFormatError('chunk is not an object');
  }
  const o = c as Record<string, unknown>;
  if (o.format !== PARCEL_CHUNK_FORMAT) throw new ChunkFormatError(`unknown format ${String(o.format)}`);
  const n = o.count;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new ChunkFormatError('bad count');
  const dict = o.dict as { landUse?: unknown; neighborhood?: unknown } | undefined;
  if (!dict || !Array.isArray(dict.landUse) || !Array.isArray(dict.neighborhood)) {
    throw new ChunkFormatError('bad dict');
  }
  const ids = arr(o, 'id', n) as string[];
  const label = arr(o, 'label', 2 * n) as number[];
  const units = arr(o, 'units', n) as number[];
  const floorArea = arr(o, 'floorArea', n) as number[];
  const height = arr(o, 'height', n) as number[];
  const lu = arr(o, 'lu', n) as number[];
  const nh = arr(o, 'nh', n) as number[];
  const elig = arr(o, 'elig', n) as number[];
  const rings = arr(o, 'rings', n) as number[][];
  let verts = 0;
  for (const r of rings) {
    if (!Array.isArray(r)) throw new ChunkFormatError('rings entry is not an array');
    for (const k of r) verts += k;
  }
  const xy = arr(o, 'xy', 2 * verts) as number[];
  const landUse = dict.landUse as string[];
  const neighborhood = dict.neighborhood as string[];
  const out: ParcelRecord[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!(lu[i] >= 0 && lu[i] < landUse.length) || !(nh[i] >= 0 && nh[i] < neighborhood.length)) {
      throw new ChunkFormatError(`dictionary index out of range at row ${i}`);
    }
    if (elig[i] !== 0 && elig[i] !== 1) throw new ChunkFormatError(`elig not 0/1 at row ${i}`);
    const polygon: [number, number][][] = rings[i].map((count) => {
      const ring: [number, number][] = [];
      for (let v = 0; v < count; v++, k += 2) ring.push([xy[k] / 100, xy[k + 1] / 100]);
      return ring;
    });
    out.push({
      id: ids[i],
      polygon,
      labelPoint: [label[2 * i] / 1e7, label[2 * i + 1] / 1e7],
      areaM2: ringsAreaM2(polygon),
      existingUnits: units[i],
      existingFloorAreaM2: floorArea[i],
      existingHeightM: height[i],
      landUse: landUse[lu[i]],
      eligible: elig[i] === 1,
      neighborhood: neighborhood[nh[i]]
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests, lint, check**

Run: `npx vitest --run --project server src/lib/data/parcel-chunk.test.ts` → PASS. Then `npx prettier --write src/lib/data/parcel-chunk*.ts` and `npm run lint` and `npm run check` → clean.

- [ ] **Step 5: Commit**

`git add src/lib/data/parcel-chunk.ts src/lib/data/parcel-chunk.test.ts` then `git commit -m "feat(data): add sfh-parcels/1 parcel chunk codec" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 2: Manifest — `parseManifest`, `ManifestError`, version-scoped urls

**Files:**
- Modify: `src/lib/data/manifest.ts`
- Create: `src/lib/data/manifest.test.ts`, `src/lib/data/fixtures/manifest.golden.json`
- Keep green: `src/lib/data/manifest.spec.ts` (platform's), `src/lib/server/data/key.spec.ts`

**Interfaces:**
- Produces (in addition to everything already exported, all names kept):
  ```ts
  export class ManifestError extends Error { issues: string[] }
  export function parseManifest(json: unknown): Manifest; // throws ManifestError
  export const CELL_ID_RE = /^-?\d+_-?\d+$/;
  ```

Tightening (all within I12): `cellId` matches `CELL_ID_RE` and is unique across `chunks`; `bbox` is four finite numbers with `w ≤ e` and `s ≤ n`; every root-relative url starts with `/data/<datasetVersion>/` of the same manifest (cross-field, applied on `ManifestSchema` only); `builtAt` and `retrievedAt` are ISO-8601 strings (`z.iso.datetime({ offset: true })`). Zod 4 forbids `.pick` on a refined object, so build an unrefined `ManifestBaseSchema`, derive `ManifestSourcesSchema` from the base, and define `ManifestSchema = ManifestBaseSchema.superRefine(...)`. Platform's `manifest.spec.ts` uses `builtAt: '2026-10-10T00:00:00.000Z'` — that passes. The placeholder fixture's `"2026-10-10T00:00:00Z"` also passes.

- [ ] **Step 1: Write the golden and the failing tests**

`src/lib/data/fixtures/manifest.golden.json`:

```json
{
  "datasetVersion": "2026-10-10-3fa9c2d1",
  "builtAt": "2026-10-10T18:00:00.000Z",
  "sources": [
    { "id": "datasf-parcels", "url": "https://data.sf.gov/d/acdm-wktn", "retrievedAt": "2026-10-10T17:00:00.000Z", "license": "PDDL-1.0" },
    { "id": "overture:OpenStreetMap", "label": "OpenStreetMap via Overture", "url": "https://docs.overturemaps.org/attribution", "retrievedAt": "2026-10-10T17:00:00.000Z", "license": "ODbL-1.0" }
  ],
  "chunks": [
    { "cellId": "50_25", "bbox": [-122.4201, 37.7598, -122.4189, 37.7604], "url": "/data/2026-10-10-3fa9c2d1/parcels/50_25.json", "parcelCount": 14 }
  ],
  "buildingsTiles": "/data/2026-10-10-3fa9c2d1/buildings.pmtiles",
  "basemapTiles": "/data/2026-10-10-3fa9c2d1/basemap.pmtiles",
  "glyphs": "/data/2026-10-10-3fa9c2d1/fonts/{fontstack}/{range}.pbf",
  "neighborhoods": "/data/2026-10-10-3fa9c2d1/neighborhoods.geojson"
}
```

```ts
// src/lib/data/manifest.test.ts
import { describe, expect, it } from 'vitest';
import golden from './fixtures/manifest.golden.json';
import { ManifestError, parseManifest } from './manifest';

const g = () => structuredClone(golden) as Record<string, unknown>;

describe('parseManifest', () => {
  it('accepts the golden (basemapTiles + glyphs, no sprite)', () => {
    const m = parseManifest(g());
    expect(m.datasetVersion).toBe('2026-10-10-3fa9c2d1');
    expect(m.sprite).toBeUndefined();
  });

  it.each(['datasetVersion', 'builtAt', 'sources', 'chunks', 'buildingsTiles', 'basemapTiles', 'glyphs', 'neighborhoods'])(
    'rejects a missing %s',
    (key) => {
      const m = g();
      delete m[key];
      expect(() => parseManifest(m)).toThrow(ManifestError);
    }
  );

  it('rejects a bad datasetVersion', () => {
    expect(() => parseManifest({ ...g(), datasetVersion: '2026-10-10-3FA9C2D1' })).toThrow(ManifestError);
  });

  it('rejects urls that are not /data/<v>/…', () => {
    expect(() => parseManifest({ ...g(), neighborhoods: 'https://x/neighborhoods.geojson' })).toThrow(ManifestError);
    expect(() => parseManifest({ ...g(), neighborhoods: '/data/fixture-0/neighborhoods.geojson' })).toThrow(ManifestError);
    expect(() => parseManifest({ ...g(), basemapTiles: 'basemap.pmtiles' })).toThrow(ManifestError);
  });

  it('rejects a malformed or duplicate cellId and an inverted bbox', () => {
    const chunk = (golden.chunks[0]);
    expect(() => parseManifest({ ...g(), chunks: [{ ...chunk, cellId: '50-25' }] })).toThrow(ManifestError);
    expect(() => parseManifest({ ...g(), chunks: [chunk, chunk] })).toThrow(ManifestError);
    expect(() => parseManifest({ ...g(), chunks: [{ ...chunk, bbox: [-122.41, 37.76, -122.42, 37.77] }] })).toThrow(ManifestError);
  });

  it('accepts negative cell ids', () => {
    const chunk = { ...golden.chunks[0], cellId: '-1_-3', url: '/data/2026-10-10-3fa9c2d1/parcels/-1_-3.json' };
    expect(parseManifest({ ...g(), chunks: [chunk] }).chunks[0].cellId).toBe('-1_-3');
  });

  it('reports issues on the error', () => {
    try {
      parseManifest({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError);
      expect((e as ManifestError).issues.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest --run --project server src/lib/data/manifest.test.ts` → FAIL (`parseManifest` not exported).

- [ ] **Step 3: Implement** — restructure `manifest.ts`:

```ts
export const CELL_ID_RE = /^-?\d+_-?\d+$/;
const IsoDate = z.iso.datetime({ offset: true });
// ManifestSourceSchema: retrievedAt: IsoDate (rest unchanged)
const ChunkSchema = z.object({
  cellId: z.string().regex(CELL_ID_RE),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .refine(([w, s, e, n]) => [w, s, e, n].every(Number.isFinite) && w <= e && s <= n, 'bbox must be [w,s,e,n]'),
  url: RootRelativeUrl,
  parcelCount: z.number().int().nonnegative()
});
const ManifestBaseSchema = z.object({ datasetVersion: DatasetVersion, builtAt: IsoDate, sources: z.array(ManifestSourceSchema), chunks: z.array(ChunkSchema), buildingsTiles: RootRelativeUrl, basemapTiles: RootRelativeUrl, glyphs: RootRelativeUrl, sprite: RootRelativeUrl.optional(), neighborhoods: RootRelativeUrl });
export const ManifestSchema = ManifestBaseSchema.superRefine((m, ctx) => {
  const prefix = `/data/${m.datasetVersion}/`;
  const urls: [string, string | undefined][] = [
    ['buildingsTiles', m.buildingsTiles], ['basemapTiles', m.basemapTiles], ['glyphs', m.glyphs],
    ['sprite', m.sprite], ['neighborhoods', m.neighborhoods],
    ...m.chunks.map((c, i): [string, string] => [`chunks.${i}.url`, c.url])
  ];
  for (const [path, u] of urls) if (u !== undefined && !u.startsWith(prefix)) ctx.addIssue({ code: 'custom', path: path.split('.'), message: `url must start with ${prefix}` });
  const seen = new Set<string>();
  m.chunks.forEach((c, i) => { if (seen.has(c.cellId)) ctx.addIssue({ code: 'custom', path: ['chunks', i, 'cellId'], message: 'duplicate cellId' }); seen.add(c.cellId); });
});
export type Manifest = z.infer<typeof ManifestSchema>;
export const ManifestSourcesSchema = ManifestBaseSchema.pick({ datasetVersion: true, builtAt: true, sources: true });
export class ManifestError extends Error { constructor(public issues: string[]) { super(`invalid manifest: ${issues.join('; ')}`); this.name = 'ManifestError'; } }
export function parseManifest(json: unknown): Manifest {
  const r = ManifestSchema.safeParse(json);
  if (!r.success) throw new ManifestError(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  return r.data;
}
```

Keep `DATASET_VERSION_RE`, `RootRelativeUrl`, `ManifestSourceSchema`, `manifestUrl` as they are. If platform's `manifest.spec.ts` `ManifestSourcesSchema` test (malformed chunks tolerated) fails, the pick is wrong — it must come from the base.

- [ ] **Step 4: Run** `npx vitest --run --project server src/lib/data src/lib/server/data` → all PASS (both platform's spec file and yours). `npm run lint`, `npm run check` clean. Run `grep -rn "ManifestSchema\|ManifestSourcesSchema" src` and confirm every consumer still type-checks.

- [ ] **Step 5: Commit** — `feat(data): add parseManifest and version-scoped manifest validation`.

---

### Task 3: Pipeline scaffold — config, CLI, exec, DuckDB helper, `doctor`, vitest project

**Files:**
- Create: `pipeline/cli.ts`, `pipeline/config.ts`, `pipeline/lib/exec.ts`, `pipeline/lib/duck.ts`, `pipeline/steps/doctor.ts`, `pipeline/test/doctor.test.ts`, `pipeline/test/duck.test.ts`
- Modify: `package.json` (scripts `pipeline`, `test:pipeline`; devDeps `@duckdb/node-api@1.5.6-r.1` exact, `proj4`, `@types/proj4`), `vite.config.ts` (add `pipeline` vitest project), `tsconfig.json` (`include` adds `pipeline/**/*.ts`), `.gitignore` (`pipeline/.cache/`, `pipeline/out/`), `.prettierignore` (`pipeline/test/fixtures/mini/golden`, `pipeline/sources.lock.json` is formatted normally)

**Interfaces:**
- Produces:
  ```ts
  // pipeline/config.ts
  export const BBOX = { w: -122.53, s: 37.69, e: -122.34, n: 37.84 } as const;
  export const CELL_SIZE_M = 1000;
  export const TOOL_VERSIONS = { tippecanoe: '2.79.0', pmtiles: '1.31.2', duckdb: '1.5.6', node: '>=22' } as const;
  export const SQL_VARS = { min_piece_m2: 2.0, iou_min: 0.5, floors_m: 3.1, default_height_m: 7.0, nb_simplify_m: 3.0 } as const;
  export const KNOWN_LANDUSE = ['RESIDENT','MIXRES','VACANT','MIXED','MIPS','RETAIL/ENT','OPENSPACE','CIE','PDR','MED','VISITOR'] as const; // + null→UNKNOWN = 12 values
  export const INELIGIBLE = ['OPENSPACE', 'NONE'] as const;
  export const FONT_STACKS = { 'Noto Sans Regular': 'NotoSans-Regular', 'Noto Sans Medium': 'NotoSans-Medium', 'Noto Sans Italic': 'NotoSans-Italic' } as const;
  export const R2_BUCKET = 'sfhousing';
  export const IMMUTABLE = 'public, max-age=31536000, immutable';
  export let renderSource: 'overture' | 'datasf' = 'overture'; // export const config object instead if preferred
  export interface InvariantProfile { unitsTarget: number; unitsTol: number; parcelRange: [number, number]; landUseMatchMin: number; heightCoverageMin: number; pieceAreaParcelMin: number; neighborhoodNames: 'from-source' | string[]; labelInsideMin: number; maxChunkParcels: number; maxChunkRaw: number; maxChunkGzip: number; maxHeightRange: [number, number]; z12BuildingsMax: number; z12BasemapMax: number; manifestMax: number; neighborhoodsMax: number }
  export const LIVE_PROFILE: InvariantProfile;   // spec §4.9 values: 413208, 0.02, [140000,170000], 0.99, 0.95, 0.95, 'from-source' (expects 41), 0.9999, 6000, 1.5e6, 350e3, [300,340], 2.0e6, 1.2e6, 64e3, 150e3
  export const FIXTURE_PROFILE: InvariantProfile; // values set in Task 11 from the mini fixture's known answers
  // pipeline/lib/exec.ts
  export function run(cmd: string, args: string[], opts?: { cwd?: string; input?: string }): Promise<{ stdout: string; stderr: string; code: number }>;
  export function which(cmd: string): Promise<string | null>;
  // pipeline/lib/duck.ts
  export interface Duck { run(sql: string): Promise<void>; all<T = Record<string, unknown>>(sql: string): Promise<T[]>; close(): void }
  export function openDuck(opts?: { httpfs?: boolean; path?: string }): Promise<Duck>; // INSTALL/LOAD spatial (+httpfs), SET VARIABLEs from SQL_VARS
  export function runSqlFile(db: Duck, file: string): Promise<void>; // reads file, runs it whole
  // pipeline/steps/doctor.ts
  export interface DoctorCheck { name: string; ok: boolean; found?: string; hint?: string }
  export function doctor(deps?: { run: typeof run; which: typeof which; nodeVersion?: string }): Promise<DoctorCheck[]>;
  ```
- `pipeline/cli.ts` parses `process.argv` (`<cmd> [positional] [--flag value|--flag]`) and dispatches to `steps/*`. Unknown command → usage text, exit 2. Each step returns an exit code; the CLI calls `process.exit(code)`. For this task only `doctor` is wired; later tasks wire their own commands.

`all()` must convert DuckDB values to plain JS: `BIGINT` → `number` (throw if beyond `Number.MAX_SAFE_INTEGER`), `DECIMAL` → `number`, lists → arrays. Use `reader.getRowObjectsJS()` / `getRowObjectsJson()` from `@duckdb/node-api` and convert bigint explicitly.

`doctor` checks: Node major ≥ 22; `tippecanoe --version` contains `v2.79.0`; `pmtiles version` contains `1.31.2`, and when it prints `dev` falls back to `brew list --versions pmtiles` containing `1.31.2`; `npx wrangler --version` succeeds; DuckDB `LOAD spatial` and `LOAD httpfs` succeed. Each failing check carries an install hint (`brew install tippecanoe`, `brew install pmtiles`, `npm install`). The CLI prints one line per check and exits 1 if any failed.

- [ ] **Step 1: Write failing tests**

```ts
// pipeline/test/doctor.test.ts
import { describe, expect, it } from 'vitest';
import { doctor } from '../steps/doctor';

const fakeRun = (outputs: Record<string, string>) => async (cmd: string, args: string[]) => {
  const key = [cmd, ...args].join(' ');
  if (!(key in outputs)) return { stdout: '', stderr: 'not found', code: 127 };
  return { stdout: outputs[key], stderr: '', code: 0 };
};

describe('doctor', () => {
  it('passes with pinned tools, accepting brew version when pmtiles prints dev', async () => {
    const checks = await doctor({
      nodeVersion: 'v24.2.0',
      which: async (c) => `/opt/homebrew/bin/${c}`,
      run: fakeRun({
        'tippecanoe --version': 'tippecanoe v2.79.0\n',
        'pmtiles version': 'pmtiles dev, commit none, built at unknown\n',
        'brew list --versions pmtiles': 'pmtiles 1.31.2\n',
        'npx wrangler --version': '4.114.0\n'
      })
    });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('fails with an install hint when tippecanoe is missing or the wrong version', async () => {
    const checks = await doctor({
      nodeVersion: 'v20.1.0',
      which: async (c) => (c === 'tippecanoe' ? null : `/bin/${c}`),
      run: fakeRun({ 'pmtiles version': 'pmtiles 1.30.0', 'npx wrangler --version': '4' })
    });
    const failed = Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.name, c.hint]));
    expect(failed.node).toMatch(/22/);
    expect(failed.tippecanoe).toMatch(/brew install tippecanoe/);
    expect(failed.pmtiles).toMatch(/brew install pmtiles/);
  });
});
```

```ts
// pipeline/test/duck.test.ts
import { describe, expect, it } from 'vitest';
import { openDuck } from '../lib/duck';

describe('openDuck', () => {
  it('loads spatial, sets SQL variables, transforms to EPSG:7131 and returns plain numbers', async () => {
    const db = await openDuck();
    const [r] = await db.all<{ x: number; y: number; n: number; v: number }>(
      `SELECT ST_X(p) x, ST_Y(p) y, 3::BIGINT n, getvariable('min_piece_m2') v FROM (SELECT ST_Transform(ST_Point(-122.4194, 37.7599), 'EPSG:4326', 'EPSG:7131', always_xy := true) p)`
    );
    db.close();
    expect(r.x).toBeCloseTo(50696.431, 2);
    expect(r.y).toBeCloseTo(25099.268, 2);
    expect(r.n).toBe(3);
    expect(r.v).toBe(2);
  });
});
```

Add the vitest project in `vite.config.ts` `test.projects`:

```ts
{
  test: {
    name: 'pipeline',
    environment: 'node',
    include: ['pipeline/test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    expect: { requireAssertions: true }
  }
}
```

(The pipeline project does not extend the SvelteKit config: it imports `src/lib/data/*` by relative path.) Scripts: `"pipeline": "tsx pipeline/cli.ts"`, `"test:pipeline": "vitest --run --project pipeline"`, and change `"test:unit"` to `"vitest --run --project server --project client"` so platform's CI job (`ci.yml`, no tippecanoe) is unchanged; the pipeline project runs in `pipeline.yml` (Task 14).

- [ ] **Step 2: Run** `npm run test:pipeline` → FAIL (modules missing).
- [ ] **Step 3: Implement** `config.ts`, `lib/exec.ts` (`execFile` promisified, never throws on non-zero: returns `code`), `lib/duck.ts`, `steps/doctor.ts`, `cli.ts`.
- [ ] **Step 4: Run** `npm run test:pipeline` → PASS; `npm run pipeline -- doctor` prints all OK on this machine (tippecanoe and pmtiles are installed via Homebrew); `npm run pipeline -- nope` exits 2 with usage. `npm run lint`, `npm run check` clean.
- [ ] **Step 5: Commit** — `feat(pipeline): scaffold CLI, config, DuckDB helper and doctor`.

---

### Task 4: Lockfile and `datasetVersion`

**Files:**
- Create: `pipeline/lib/lock.ts`, `pipeline/lib/version.ts`, `pipeline/test/version.test.ts`, `pipeline/test/lock.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // pipeline/lib/lock.ts — entry shape is spec §4.2
  export interface LockFile { url: string; sha256: string; bytes: number; archiveKey: string; name: string } // name: local filename under the raw dir (e.g. "page-000.geojson")
  export interface LockEntry { id: string; files: LockFile[]; retrievedAt: string; upstreamVersion: string; rowCount: number; license: string; label?: string; homepage: string }
  export interface Lock { sources: LockEntry[] } // sorted by id
  export function readLock(path: string): Lock;
  export function writeLock(path: string, lock: Lock): void;          // canonical JSON, 2-space, trailing newline
  export function canonicalJson(v: unknown): string;                  // keys sorted recursively, no whitespace
  export function sha256File(path: string): Promise<string>;
  export function verifyRaw(lock: Lock, rawDir: string): Promise<string[]>; // returns mismatch messages; [] = ok. File path = `${rawDir}/${sha256}`
  export function archiveKeyFor(sha256: string, name: string): string; // `sources/<sha256>.<ext of name>`
  // pipeline/lib/version.ts
  export function computeDatasetVersion(input: { lock: Lock; codeHash: string; toolVersions: Record<string, string> }): string;
  export function codeTreeHash(repoRoot: string): Promise<string>; // see below
  ```

`computeDatasetVersion`: date = UTC `YYYY-MM-DD` of the max `retrievedAt` across entries; `h8` = first 8 hex of sha256 over `canonicalJson(lock) + '\n' + codeHash + '\n' + canonicalJson(toolVersions)`. Result must match `DATASET_VERSION_RE` (import it from `../../src/lib/data/manifest`; assert before returning).

`codeTreeHash`: `git rev-parse HEAD:pipeline` and `git rev-parse HEAD:src/lib/data` concatenated. If `git status --porcelain -- pipeline src/lib/data` (excluding `pipeline/sources.lock.json`, `.cache`, `out`) is non-empty, append the sha256 of `git diff HEAD -- pipeline src/lib/data` plus each untracked file's sha256, so uncommitted code yields a different version. Document this in a comment.

- [ ] **Step 1: Tests**

```ts
// pipeline/test/version.test.ts
import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from '../../src/lib/data/manifest';
import type { Lock } from '../lib/lock';
import { computeDatasetVersion } from '../lib/version';

const lock = (): Lock => ({
  sources: [
    { id: 'datasf-parcels', files: [{ url: 'https://data.sf.gov/a', sha256: 'a'.repeat(64), bytes: 10, archiveKey: `sources/${'a'.repeat(64)}.geojson`, name: 'page-000.geojson' }], retrievedAt: '2026-10-09T23:59:00.000Z', upstreamVersion: 'x', rowCount: 1, license: 'PDDL-1.0', homepage: 'https://data.sf.gov/d/acdm-wktn' },
    { id: 'overture-buildings', files: [{ url: 's3://o', sha256: 'b'.repeat(64), bytes: 10, archiveKey: `sources/${'b'.repeat(64)}.parquet`, name: 'buildings.parquet' }], retrievedAt: '2026-10-10T00:00:01.000Z', upstreamVersion: '2026-09-23.1', rowCount: 1, license: 'ODbL-1.0', homepage: 'https://overturemaps.org' }
  ]
});
const tools = { tippecanoe: '2.79.0', pmtiles: '1.31.2' };

describe('computeDatasetVersion', () => {
  it('is stable, dated by newest retrievedAt (UTC), and matches DATASET_VERSION_RE', () => {
    const a = computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: tools });
    expect(a).toBe(computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: { pmtiles: '1.31.2', tippecanoe: '2.79.0' } }));
    expect(a).toMatch(DATASET_VERSION_RE);
    expect(a.startsWith('2026-10-10-')).toBe(true);
  });
  it('changes when any sha, the code hash or a tool version changes', () => {
    const base = computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: tools });
    const l = lock();
    l.sources[0].files[0].sha256 = 'c'.repeat(64);
    expect(computeDatasetVersion({ lock: l, codeHash: 'c1', toolVersions: tools })).not.toBe(base);
    expect(computeDatasetVersion({ lock: lock(), codeHash: 'c2', toolVersions: tools })).not.toBe(base);
    expect(computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: { ...tools, tippecanoe: '2.80.0' } })).not.toBe(base);
  });
});
```

`pipeline/test/lock.test.ts`: write two temp raw files into a scratch dir (`fs.mkdtempSync(os.tmpdir())`) named by their sha256, assert `verifyRaw` returns `[]`; flip a byte, assert it returns one message naming the source id; assert `canonicalJson({b:1,a:{d:1,c:2}})` is `{"a":{"c":2,"d":1},"b":1}`; assert `archiveKeyFor(sha, 'page-000.geojson')` is `sources/<sha>.geojson`.

- [ ] **Step 2: Run** `npm run test:pipeline` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, lint/check clean.
- [ ] **Step 5: Commit** — `feat(pipeline): add source lockfile and datasetVersion derivation`.

---

### Task 5: Mini fixture sources, normaliser and loader

**Files:**
- Create: `pipeline/test/fixtures/mini/make-fixture.ts` (generator, run once; output committed), `pipeline/test/fixtures/mini/raw/*.geojson` (generated), `pipeline/test/fixtures/mini/sources.lock.json`, `pipeline/test/fixtures/mini/README.md`, `pipeline/sources/normalise.ts`, `pipeline/lib/report.ts`, `pipeline/test/helpers.ts`, `pipeline/test/normalise.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // pipeline/sources/normalise.ts
  export type SourceId = 'datasf-parcels' | 'datasf-landuse-2023' | 'datasf-footprints' | 'datasf-neighborhoods' | 'overture-buildings';
  export function normalise(db: Duck, id: SourceId, rawFiles: string[], outParquet: string): Promise<number>; // returns row count
  export function loadNormalised(db: Duck, normDir: string): Promise<void>; // CREATE TABLE src_* AS SELECT * FROM read_parquet(...)
  // pipeline/lib/report.ts
  export class Report { counts: Record<string, number>; timings: Record<string, number>; warnings: string[]; set(k: string, v: number): void; time<T>(step: string, f: () => Promise<T>): Promise<T>; toJSON(): object }
  // pipeline/test/helpers.ts
  export const MINI = 'pipeline/test/fixtures/mini';
  export function miniDuck(): Promise<Duck>; // memoised per test file: openDuck + normalise every mini source into a temp norm dir + loadNormalised
  ```

**Normalisation (one function per source family; live and fixture use the same code):**
- DataSF GeoJSON pages (`*.geojson`, SODA output): `ST_Read(file)` each page, `UNION ALL BY NAME`, select/cast to the `src_*` schema in the shared-names block. Parcels: `active` may arrive as boolean or string `"true"`; cast via `CAST(active AS VARCHAR) IN ('true','1')`. Landuse: `resunits` → INTEGER (null → 0 is **not** done here; nulls stay null), `res`, `totalcomm` → DOUBLE. Footprints: keep `mblr`, `sf16_bldgid`, `hgt_median_m`.
- Overture: live input is a parquet file already in the `src_overture` schema (Task 12 writes it); fixture input is a GeoJSON file with properties `id, height, num_floors, min_height, is_underground, datasets` (datasets a JSON array) — normalise both to the schema.
- Output: `COPY (…) TO '<out>.parquet' (FORMAT parquet)` with `geom` stored as GEOMETRY (DuckDB 1.5 writes GeoParquet). Rows ordered by a stable key (`mapblklot, blklot` / `mblr` / `nhood` / `id`) so the parquet is deterministic.

**The mini fixture** (spec §6). `make-fixture.ts` places shapes in **local metres** relative to origin `O = (-122.4195, 37.7600)` projected to EPSG:7131 with proj4 (define EPSG:7131 as `+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`), converts to lng/lat rounded to 1e-7, and writes SODA-shaped GeoJSON FeatureCollections (property names exactly as the live SODA `.geojson` output: lower-case column names, numbers as strings like SODA does). Lots are 10 m wide (x) × 30 m deep (y) unless stated; lot *i* spans `x ∈ [10(i−1), 10i]`, `y ∈ [0, 30]`.

| lot | id(s) | parcel rows | land use row(s) | buildings (Overture unless noted) | exercises |
|---|---|---|---|---|---|
| 1 | `3512001` | 1 row, nhood Mission | RESIDENT, resunits 2, res 2000, totalcomm 0 | b01 h=12 (`hs=0`), datasets [OpenStreetMap] | basic; colliding orphan target |
| 2 | map lot `3512002` | 3 condo rows blklot `3512101`,`3512102`,`3512103`, mapblklot `3512002`; `3512103` has a slightly different polygon (warning) | RESIDENT, 6 units | b02 h=15 | condo dedupe (smallest blklot geometry), sub-lot warning |
| 3 | `8711023C` | 1 row | **two** rows: MIXRES 4 units res 3000 totalcomm 500; RETAIL/ENT 0 units res 0 totalcomm 4000 → landUse = RETAIL/ENT (largest res+totalcomm), units 4, sqft 7500 | b03 no height, no footprint, num_floors 0 → `hs=3` (7.0 m) | duplicate rows summed; default height |
| 4 | `0026T001A` | 1 row | MIXED 3 units | b04 no height, num_floors 4 → `hs=2` (12.4 m) | 9-char id; floors rule |
| 5 | `3512005` | 1 MultiPolygon row: part A `x∈[40,50] y∈[0,18]`, part B `x∈[40,50] y∈[22,30]` | RESIDENT 1 unit | — | multipart ring order (A first: larger) |
| 6 | `3512006` | polygon with hole `x∈[53,57] y∈[10,20]` | RESIDENT 2 units | b06 courtyard building h=9 | holed parcel |
| 7 | `3512007` | 1 row | OPENSPACE 0 units | — | ineligible |
| 8 | `3512008` | 1 row | landuse **null**, resunits 12, res 0, totalcomm 0 | none | `UNKNOWN` eligible; floor-area rule 3 (12×80) |
| 9 | `3512009` | 1 row, analysis_neighborhood **null**, lot lies in Noe Valley polygon | none | none | `NONE` ineligible; floor-area rule 4 (0); neighborhood spatial fallback |
| 10 | `3512010` | 1 row | RESIDENT 3 units | b10 spans `x∈[95,105] y∈[5,25]` h=18 (shared with lot 11) | spanning building → 2 pieces |
| 11 | `3512011` | 1 row | RESIDENT 3 units | (b10) | |
| 12 | `3512012` | 1 row | none of its own | — | orphan reassigned here |
| 13 | `3512013` | 1 row | RESIDENT 5 units, res 0, totalcomm 0 | b13 no height/floors; DataSF footprint `SF1234567` with identical polygon (IoU 1.0) `hgt_median_m` 21.3 → `hs=1` | IoU height rule; floor-area rule 2 (piece area × round(21.3/3.1)) |
| 14 | `3512014` | 1 row | MIXRES 40 units res 30000 totalcomm 5000 | b14 h=60 (tallest), datasets [USGS Lidar] | V10 max height |

Plus:
- Retired parcel rows (`active=false`): `3512099` (polygon inside lot 12) and `3512098` (polygon inside lot 1). Land-use rows for both: `3512099` RESIDENT 7 units (reassigned to lot 12), `3512098` RESIDENT 9 units (dropped: lot 1 has its own row).
- One active parcel row with null `mapblklot` (lot shape at `x∈[150,160]`) → dropped and counted.
- Overture extras: `bpier` at `x∈[20,40] y∈[−40,−32]` h=6, datasets [Microsoft ML Buildings] (outside all parcels, inside neighborhoods → kept, no parcelId); `bunder` inside lot 1, `is_underground=true` (dropped); `bmarin` at `y∈[400,410]` (outside neighborhoods → dropped); `besri` inside lot 6 next to b06, tiny 1.2 m × 1.2 m h=4, datasets [Esri Community Maps] (piece < 2 m² → sliver dropped).
- Footprints: `SF1234567` (lot 13, exactly b13's polygon), `SF7654321` on lot 1 with IoU < 0.5 vs b01 (must not be used), and one `CN…` right-of-way footprint (ignored: not `SF%`).
- Neighborhoods (2 features, `nhood`): `Mission` covers `x∈[−60,75], y∈[−100,100]`; `Noe Valley` covers `x∈[75,220], y∈[−100,100]`. Lot 8 (x 70–80) straddles — its `analysis_neighborhood` is set explicitly to `Mission`.
- Each GeoJSON file name is the raw page name: `datasf-parcels.page-000.geojson`, etc.

`sources.lock.json` for the fixture: one entry per source (`datasf-parcels`, `datasf-landuse-2023`, `datasf-footprints`, `datasf-neighborhoods`, `overture-buildings`, `protomaps-basemap`, `protomaps-fonts`) with **real** sha256/bytes of the committed raw files, `retrievedAt: "2026-10-10T00:00:00.000Z"`, `upstreamVersion: "fixture"`, licences per spec §4.8 (`PDDL-1.0`, `public-domain` for landuse, `PDDL-1.0`, `PDDL-1.0`, `ODbL-1.0`, `ODbL-1.0`, `OFL-1.1`). The fixture build reads raw files by `name` from `mini/raw/` (not by sha) but still verifies sha256 against the lock. (Basemap and font entries are completed in Task 10.)

- [ ] **Step 1: Write** `make-fixture.ts`, run it once (`npx tsx pipeline/test/fixtures/mini/make-fixture.ts`), inspect one feature per file by eye, commit the output in step 5.
- [ ] **Step 2: Failing test** `pipeline/test/normalise.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { miniDuck } from './helpers';

describe('normalise mini fixture', () => {
  it('loads every src_ table with the expected row counts and types', async () => {
    const db = await miniDuck();
    const counts = Object.fromEntries(
      (await db.all<{ t: string; n: number }>(
        `SELECT 'p' t, count(*) n FROM src_parcels UNION ALL SELECT 'l', count(*) FROM src_landuse
         UNION ALL SELECT 'f', count(*) FROM src_footprints UNION ALL SELECT 'n', count(*) FROM src_neighborhoods
         UNION ALL SELECT 'o', count(*) FROM src_overture`
      )).map((r) => [r.t, r.n])
    );
    // parcels: 14 lots, lot 2 has 3 rows → 16, + 2 retired + 1 null-id = 19
    expect(counts).toEqual({ p: 19, l: 15, f: 3, n: 2, o: 12 });
    const [ids] = await db.all<{ ok: boolean }>(`SELECT bool_and(mapblklot IS NULL OR typeof(mapblklot) = 'VARCHAR') ok FROM src_parcels`);
    expect(ids.ok).toBe(true);
    const odd = await db.all<{ mapblklot: string }>(`SELECT mapblklot FROM src_parcels WHERE mapblklot IN ('0026T001A','8711023C') ORDER BY 1`);
    expect(odd.map((r) => r.mapblklot)).toEqual(['0026T001A', '8711023C']);
  });
});
```

Derivation: parcels = 14 lots, lot 2 has 3 rows (16) + 2 retired + 1 null id = 19; landuse = lots 1, 2, 3 (×2), 4, 5, 6, 7, 8, 10, 11, 13, 14 = 13 + 2 orphans = 15; footprints 3; neighborhoods 2; overture = b01 b02 b03 b04 b06 b10 b13 b14 + bpier bunder bmarin besri = 12. If `make-fixture.ts` disagrees with the table, fix the script, not the assertion.

- [ ] **Step 3: Implement** `normalise.ts`, `report.ts`, `helpers.ts`. **Step 4: Run** → PASS; lint/check clean (add `pipeline/test/fixtures/mini/raw` to `.prettierignore`).
- [ ] **Step 5: Commit** — `test(pipeline): add mini fixture sources and normaliser`.

---

### Task 6: SQL 10_parcels — dedupe, transform, label point, neighborhood

**Files:**
- Create: `pipeline/sql/10_parcels.sql`, `pipeline/test/sql.test.ts` (this task's block), `pipeline/lib/sql.ts`

**Interfaces:**
- Consumes: `src_parcels`, `src_neighborhoods`.
- Produces table `parcels(id VARCHAR PRIMARY KEY, geom GEOMETRY /*7131, valid, all parts*/, geom4326 GEOMETRY, label_lng DOUBLE, label_lat DOUBLE /*rounded 1e-7*/, x0 DOUBLE, y0 DOUBLE /*rounded label projected to 7131*/, label_fallback INTEGER /*0 ok, 1 buffer, 2 warning*/, neighborhood VARCHAR, nb_fallback BOOLEAN, n_parts INTEGER, n_holes INTEGER)`; table `nb7131(nhood, geom)`; `report_counts` keys `parcels.null_id_dropped`, `parcels.active_rows`, `parcels.condo_sublots` (rows with blklot ≠ mapblklot), `parcels.condo_geom_mismatch`, `parcels.distinct_active_ids` (distinct non-null `mapblklot` among active source rows, computed independently of the dedupe), `parcels.emitted`, `parcels.multipart`, `parcels.holed`, `parcels.label_buffer_fallback`, `parcels.label_warning`, `parcels.nb_spatial_fallback`, `parcels.no_neighborhood`.
- `pipeline/lib/sql.ts`: `export const SQL_FILES = ['10_parcels.sql', …, '70_export.sql']; export function runSql(db: Duck, upTo?: string): Promise<void>` — creates `report_counts` if absent, then runs files in order up to and including `upTo`.

Rules (spec §4.4): active rows only; drop and count null `mapblklot`; one record per `mapblklot` taking geometry from `blklot = mapblklot` else smallest `blklot`; count sub-lot geometry mismatches (`ST_Equals` false vs chosen) as a warning; `ST_MakeValid` then `ST_Transform(geom, 'EPSG:4326', 'EPSG:7131', always_xy := true)`; label = `ST_PointOnSurface` of the largest part (`ST_Dump` → max `ST_Area`) in 7131 → 4326 → round 1e-7 → project back to 7131 = `(x0,y0)`; if `NOT ST_Contains(geom, ST_Point(x0,y0))` use `ST_PointOnSurface(ST_Buffer(largest_part, -0.05))` (`label_fallback=1`), and if still outside keep the original (`label_fallback=2`). Neighborhood = `analysis_neighborhood`, else the `nb7131` polygon containing `(x0,y0)` (`nb_fallback=true`); `nb7131` is `src_neighborhoods` transformed to 7131.

- [ ] **Step 1: Failing tests** (append a `describe('10_parcels')` block):

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { runSql } from '../lib/sql';
import type { Duck } from '../lib/duck';
import { miniDuck } from './helpers';

let db: Duck;
const counts = async () => Object.fromEntries((await db.all<{ key: string; value: number }>('SELECT key, value FROM report_counts')).map((r) => [r.key, r.value]));

describe('10_parcels', () => {
  beforeAll(async () => { db = await miniDuck(); await runSql(db, '10_parcels.sql'); });

  it('emits one record per distinct active non-null mapblklot', async () => {
    const rows = await db.all<{ id: string }>('SELECT id FROM parcels ORDER BY id');
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => r.id)).toContain('3512002');
    expect(rows.map((r) => r.id)).not.toContain('3512099');
    const c = await counts();
    expect(c['parcels.null_id_dropped']).toBe(1);
    expect(c['parcels.condo_sublots']).toBe(3);
    expect(c['parcels.condo_geom_mismatch']).toBe(1);
  });

  it('takes the condo geometry from the smallest blklot', async () => {
    const [r] = await db.all<{ eq: boolean }>(
      `SELECT ST_Equals(p.geom, ST_Transform(ST_MakeValid(s.geom), 'EPSG:4326', 'EPSG:7131', always_xy := true)) eq
       FROM parcels p JOIN src_parcels s ON s.blklot = '3512101' WHERE p.id = '3512002'`
    );
    expect(r.eq).toBe(true);
  });

  it('puts every label point strictly inside its polygon', async () => {
    const [r] = await db.all<{ bad: number }>('SELECT count(*) bad FROM parcels WHERE NOT ST_Contains(geom, ST_Point(x0, y0))');
    expect(r.bad).toBe(0);
  });

  it('labels a holed parcel outside its hole and counts multipart/holed', async () => {
    const [r] = await db.all<{ x: number; y: number }>(`SELECT x0 - (SELECT ST_XMin(geom) FROM parcels WHERE id='3512006') x, 0 y FROM parcels WHERE id='3512006'`);
    expect(r.x).toBeGreaterThanOrEqual(0);
    const c = await counts();
    expect(c['parcels.multipart']).toBe(1);
    expect(c['parcels.holed']).toBe(1);
  });

  it('falls back to the containing neighborhood polygon', async () => {
    const [r] = await db.all<{ neighborhood: string; nb_fallback: boolean }>(`SELECT neighborhood, nb_fallback FROM parcels WHERE id = '3512009'`);
    expect(r).toEqual({ neighborhood: 'Noe Valley', nb_fallback: true });
    expect((await counts())['parcels.no_neighborhood']).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `npx vitest --run --project pipeline pipeline/test/sql.test.ts` → FAIL. **Step 3: Implement** the SQL (create tables with `CREATE OR REPLACE TABLE`; write counts with `INSERT INTO report_counts SELECT 'parcels.emitted', count(*) FROM parcels;` etc.). **Step 4: Run** → PASS. lint/check clean.
- [ ] **Step 5: Commit** — `feat(pipeline): parcels SQL with condo dedupe, label point and neighborhood`.

---

### Task 7: SQL 20_landuse — join, orphan reassignment, eligibility (OD-6)

**Files:**
- Create: `pipeline/sql/20_landuse.sql`; extend `pipeline/test/sql.test.ts`

**Interfaces:**
- Consumes: `parcels`, `src_landuse`, `src_parcels`.
- Produces `parcel_landuse(id VARCHAR, land_use VARCHAR, units INTEGER, sqft DOUBLE /*Σ(res+totalcomm)*/, has_row BOOLEAN, eligible BOOLEAN, reassigned BOOLEAN)` — exactly one row per `parcels.id`; table `landuse_unknown_values(landuse VARCHAR)` listing distinct non-null `landuse` values not in the 11 known codes (V4 reads it; empty when fine). `report_counts`: `landuse.rows`, `landuse.matched_parcels`, `landuse.no_row_parcels`, `landuse.orphan_rows`, `landuse.orphan_reassigned`, `landuse.orphan_dropped`, `landuse.orphan_reassigned_units`, `landuse.orphan_dropped_units`, `landuse.duplicate_ids`, `landuse.unknown_values` (row count of `landuse_unknown_values`), `landuse.class.<CODE>` (parcels per final class incl. `UNKNOWN`, `NONE`).

Rules (spec §4.5): exact string match on `mapblklot`. Orphan rows (mapblklot not in `parcels`): take `ST_PointOnSurface(geom)`, find the active parcel (in `parcels`, 4326 geometry `geom4326`) containing it; reassign only if that parcel has no direct row; otherwise drop and count (no double counting). If several orphans land on the same row-less parcel, they are all reassigned and summed like duplicates. Duplicate rows per id: `units = Σ resunits` (null → 0), `sqft = Σ (coalesce(res,0)+coalesce(totalcomm,0))`, `land_use` from the row with the largest `res + totalcomm` (tie → smaller `landuse` string, nulls last), null `landuse` → `'UNKNOWN'`. No row → `land_use = 'NONE'`, units 0, sqft 0. `eligible = land_use NOT IN ('OPENSPACE','NONE')`.

- [ ] **Step 1: Failing tests**

```ts
describe('20_landuse', () => {
  beforeAll(async () => { db = await miniDuck(); await runSql(db, '20_landuse.sql'); });
  const lu = async (id: string) => (await db.all<Record<string, unknown>>(`SELECT land_use, units, sqft, eligible, reassigned FROM parcel_landuse WHERE id = '${id}'`))[0];

  it('follows the eligibility table', async () => {
    expect(await lu('3512007')).toMatchObject({ land_use: 'OPENSPACE', eligible: false });
    expect(await lu('3512009')).toMatchObject({ land_use: 'NONE', units: 0, eligible: false });
    expect(await lu('3512008')).toMatchObject({ land_use: 'UNKNOWN', units: 12, eligible: true });
    expect(await lu('3512001')).toMatchObject({ land_use: 'RESIDENT', eligible: true });
  });

  it('sums duplicate rows and takes the class of the largest row', async () => {
    expect(await lu('8711023C')).toMatchObject({ land_use: 'RETAIL/ENT', units: 4, sqft: 7500 });
  });

  it('reassigns an orphan onto a row-less parcel and drops a colliding one', async () => {
    expect(await lu('3512012')).toMatchObject({ land_use: 'RESIDENT', units: 7, reassigned: true });
    expect(await lu('3512001')).toMatchObject({ units: 2 });
    const c = await counts();
    expect(c['landuse.orphan_reassigned']).toBe(1);
    expect(c['landuse.orphan_dropped']).toBe(1);
    expect(c['landuse.orphan_dropped_units']).toBe(9);
  });

  it('has exactly one row per parcel and no unknown classes', async () => {
    const [r] = await db.all<{ n: number; d: number }>('SELECT count(*) n, count(DISTINCT id) d FROM parcel_landuse');
    expect(r).toEqual({ n: 14, d: 14 });
    expect(await db.all('SELECT * FROM landuse_unknown_values')).toEqual([]);
  });
});
```

- [ ] **Step 2–4:** run → FAIL, implement, run → PASS, lint/check.
- [ ] **Step 5: Commit** — `feat(pipeline): land use join, orphan reassignment and eligibility`.

---

### Task 8: SQL 30–70 — buildings, heights, clipping, attributes, export

**Files:**
- Create: `pipeline/sql/30_buildings.sql`, `40_heights.sql`, `50_clip.sql`, `60_attributes.sql`, `70_export.sql`; extend `pipeline/test/sql.test.ts`

**Interfaces:**
- Consumes: `src_overture`, `src_footprints`, `nb7131`, `parcels`, `parcel_landuse`.
- Produces:
  - `buildings(bid VARCHAR, geom GEOMETRY /*7131*/, height_m DOUBLE, base_m DOUBLE, hs INTEGER, datasets VARCHAR[])` (30 + 40).
  - `pieces(bid VARCHAR, parcel_id VARCHAR /*NULL outside parcels*/, geom GEOMETRY /*7131*/, area_m2 DOUBLE, height_m DOUBLE, base_m DOUBLE, hs INTEGER)` (50).
  - `parcel_out(id, geom /*7131*/, label_lng, label_lat, x0, y0, units INTEGER, floor_area_m2 DOUBLE /*0.1*/, height_m DOUBLE /*0.1*/, land_use, eligible BOOLEAN, neighborhood, fa_rule INTEGER /*1–4*/, xmin, ymin, xmax, ymax /*4326 extent of polygon*/, geojson7131 VARCHAR)` (60/70). Ordered by `id`.
  - `buildings_export(parcel_id VARCHAR, bid VARCHAR, height_m DOUBLE, base_m DOUBLE, hs INTEGER, geojson4326 VARCHAR)` ordered by `(parcel_id NULLS LAST, bid)` (70).
  - `neighborhoods_out(name VARCHAR, geojson4326 VARCHAR)` ordered by name: `ST_SimplifyPreserveTopology(geom7131, getvariable('nb_simplify_m'))` → 4326, coordinates rounded to 6 decimals (70).
  - `overture_contrib(dataset VARCHAR, n INTEGER)`: count of kept buildings per element of `datasets` (for manifest sources expansion).
  - `report_counts`: `buildings.input`, `buildings.underground_dropped`, `buildings.outside_nb_dropped`, `buildings.kept`, `buildings.hs0..hs3`, `pieces.count`, `pieces.sliver_dropped`, `pieces.outside_parcels`, `pieces.area_total_m2`, `pieces.area_with_parcel_m2`, `floor_area.rule1..rule4`, `height.max_m`.

Rules: spec §4.6, §4.7, §4.5 Attributes. Specifically:
- 30: drop `is_underground`; transform to 7131; keep if `ST_PointOnSurface` lies within `ST_Union_Agg(nb7131.geom)`. If `config.renderSource === 'datasf'` the TS runner swaps in `30_buildings_datasf.sql` — **not built in M1**; leave a comment and a thrown error in the runner (`renderSource 'datasf' fallback not implemented`), since the fallback is only triggered by a V5 failure. *(If the live run in Task 15 fails V5, stop and escalate to `main`.)*
- 40: first match wins — `height > 0` → hs 0; else best-IoU `SF%` footprint with IoU ≥ `iou_min` (tie → smaller `sf16_bldgid`) → `hgt_median_m`, hs 1; else `num_floors > 0` → `num_floors × floors_m`, hs 2; else `default_height_m`, hs 3. `base_m = coalesce(min_height, 0)`. Clamp height to [2.5, 340], round 0.1. IoU = `ST_Area(ST_Intersection(b,f)) / ST_Area(ST_Union(b,f))` over pairs pre-filtered by `ST_Intersects`.
- 50: pieces = `ST_Intersection(b, p)` for every intersecting parcel; drop `ST_Area < min_piece_m2` (count); the remainder `ST_Difference(b, ST_Union_Agg(intersecting parcels))` emitted once with `parcel_id NULL` if area ≥ `min_piece_m2`. Keep only polygonal output (`ST_CollectionExtract(…, 3)`).
- 60: `floor_area_m2`: rule 1 `sqft × 0.09290304` when > 0; rule 2 Σ `area_m2 × greatest(1, round(height_m / floors_m))` over the parcel's pieces when > 0; rule 3 `units × 80` when > 0; else rule 4 = 0. `height_m` = max piece `height_m` on the parcel, else 0.

- [ ] **Step 1: Failing tests**

```ts
describe('30–70 buildings, clipping, attributes', () => {
  beforeAll(async () => { db = await miniDuck(); await runSql(db); });

  it('applies height rules 0–3 with the expected hs', async () => {
    const rows = await db.all<{ bid: string; height_m: number; hs: number }>(`SELECT bid, height_m, hs FROM buildings WHERE bid IN ('b01','b13','b04','b03') ORDER BY bid`);
    expect(rows).toEqual([
      { bid: 'b01', height_m: 12, hs: 0 },
      { bid: 'b03', height_m: 7, hs: 3 },
      { bid: 'b04', height_m: 12.4, hs: 2 },
      { bid: 'b13', height_m: 21.3, hs: 1 }
    ]);
  });

  it('drops underground and out-of-city buildings', async () => {
    const ids = (await db.all<{ bid: string }>('SELECT bid FROM buildings')).map((r) => r.bid);
    expect(ids).not.toContain('bunder');
    expect(ids).not.toContain('bmarin');
  });

  it('clips a spanning building into 2 pieces and keeps the pier without parcelId', async () => {
    const b10 = await db.all<{ parcel_id: string }>(`SELECT parcel_id FROM pieces WHERE bid = 'b10' ORDER BY parcel_id`);
    expect(b10.map((r) => r.parcel_id)).toEqual(['3512010', '3512011']);
    const pier = await db.all<{ parcel_id: string | null }>(`SELECT parcel_id FROM pieces WHERE bid = 'bpier'`);
    expect(pier).toEqual([{ parcel_id: null }]);
    expect((await counts())['pieces.sliver_dropped']).toBeGreaterThanOrEqual(1);
  });

  it('computes floor area by rules 1–4', async () => {
    const fa = Object.fromEntries((await db.all<{ id: string; floor_area_m2: number; fa_rule: number }>(`SELECT id, floor_area_m2, fa_rule FROM parcel_out WHERE id IN ('3512001','3512013','3512008','3512009')`)).map((r) => [r.id, [r.floor_area_m2, r.fa_rule]]));
    expect(fa['3512001']).toEqual([Math.round(2000 * 0.09290304 * 10) / 10, 1]);
    expect(fa['3512013'][1]).toBe(2);
    expect(fa['3512013'][0]).toBeGreaterThan(0);
    expect(fa['3512008']).toEqual([960, 3]);
    expect(fa['3512009']).toEqual([0, 4]);
  });

  it('sets existing height to the tallest piece and orders the export', async () => {
    const [h] = await db.all<{ m: number }>(`SELECT max(height_m) m FROM parcel_out`);
    expect(h.m).toBe(60);
    const ex = await db.all<{ parcel_id: string | null }>('SELECT parcel_id FROM buildings_export');
    expect(ex[ex.length - 1].parcel_id).toBeNull();
    const nb = await db.all<{ name: string }>('SELECT name FROM neighborhoods_out');
    expect(nb.map((r) => r.name)).toEqual(['Mission', 'Noe Valley']);
  });
});
```

- [ ] **Step 2–4:** FAIL → implement → PASS (the entire `sql.test.ts`), lint/check.
- [ ] **Step 5: Commit** — `feat(pipeline): building heights, parcel clipping, attributes and export SQL`.

---

### Task 9: Local rings, cells and chunk writing (+ neighborhoods.geojson)

**Files:**
- Create: `pipeline/lib/rings.ts`, `pipeline/steps/chunks.ts`, `pipeline/test/rings.test.ts`, `pipeline/test/local-frame.test.ts`

**Interfaces:**
- Consumes: `parcel_out`, `neighborhoods_out`; `encodeParcelChunk`, `ringsAreaM2` (Task 1).
- Produces:
  ```ts
  // pipeline/lib/rings.ts
  export type Ring = [number, number][];
  export function toLocalRings(geom7131: GeoJSON.Polygon | GeoJSON.MultiPolygon, x0: number, y0: number): Ring[];
  export function pointStrictlyInside(pt: [number, number], rings: Ring[]): boolean; // even-odd; false if on an edge
  export function cellIdFor(x0: number, y0: number, size?: number): string;      // `${Math.floor(x0/size)}_${Math.floor(y0/size)}`
  // pipeline/steps/chunks.ts
  export interface ChunkOut { cellId: string; bbox: [number, number, number, number]; path: string; parcelCount: number; rawBytes: number; gzipBytes: number }
  export function writeChunks(db: Duck, outDir: string, datasetVersion: string, report: Report): Promise<ChunkOut[]>; // sorted by cellId
  export function writeNeighborhoods(db: Duck, outDir: string): Promise<number>; // bytes
  ```

`toLocalRings` (spec §4.4 step 5–6): parts ordered by area descending; each part: outer ring then its holes in input order; each vertex `(X − x0, Y − y0)` quantised to `Math.round(v*100)/100`; drop the closing vertex (rings open); drop consecutive duplicates (also last == first after quantising); drop rings with < 3 vertices; outer rings CCW (positive signed area), holes CW — reverse when needed. Returns `[]` if everything collapsed.

`writeChunks`: read `parcel_out` ordered by id; per row build a `ParcelRecord` (`polygon = toLocalRings(JSON.parse(geojson7131), x0, y0)`, `areaM2 = ringsAreaM2(polygon)`, `labelPoint = [label_lng, label_lat]`) and group by `cellIdFor(x0, y0)`. A record with an empty polygon is **not** dropped: count it in `chunks.empty_polygon` and let V7/V8 fail. Count `chunks.label_outside_local` where `!pointStrictlyInside([0,0], polygon)`. bbox = min/max of member `xmin…ymax`, rounded outward to 1e-6 (`Math.floor(v*1e6)/1e6` for w/s, `Math.ceil` for e/n). Write `parcels/<cellId>.json` with `encodeParcelChunk`; record raw bytes and `gzipSync(buf, { level: 9 }).length`.

`writeNeighborhoods`: FeatureCollection, features in `neighborhoods_out` order, `properties: { name }`, `JSON.stringify` no whitespace, file `neighborhoods.geojson`.

- [ ] **Step 1: Failing tests**

```ts
// pipeline/test/rings.test.ts
import { describe, expect, it } from 'vitest';
import { cellIdFor, pointStrictlyInside, toLocalRings } from '../lib/rings';

const sq = (x: number, y: number, s: number, cw = false) => {
  const r = [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
  return cw ? r.reverse() : r;
};

describe('toLocalRings', () => {
  it('opens rings, quantises to cm, makes outer CCW and holes CW', () => {
    const rings = toLocalRings({ type: 'Polygon', coordinates: [sq(100, 200, 10, true), sq(102.001, 202.004, 2)] }, 105, 205);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(4);
    expect(rings[0][0]).toEqual([-5, -5]);
    const signed = (r: [number, number][]) => r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0);
    expect(signed(rings[0])).toBeGreaterThan(0);
    expect(signed(rings[1])).toBeLessThan(0);
    expect(rings[1][0]).toEqual([-3, -3]);
  });
  it('orders multipolygon parts by area descending', () => {
    const rings = toLocalRings({ type: 'MultiPolygon', coordinates: [[sq(0, 0, 2)], [sq(10, 10, 5)]] }, 0, 0);
    expect(rings[0][0]).toEqual([10, 10]);
  });
  it('drops consecutive duplicates and rings that collapse below 3 vertices', () => {
    const sliver = [[0, 0], [0.001, 0], [0.002, 0.001], [0, 0]];
    expect(toLocalRings({ type: 'Polygon', coordinates: [sliver] }, 0, 0)).toEqual([]);
    const dup = [[0, 0], [0, 0.001], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(toLocalRings({ type: 'Polygon', coordinates: [dup] }, 0, 0)[0]).toHaveLength(4);
  });
});

describe('pointStrictlyInside', () => {
  it('is false in a hole and on an edge', () => {
    const outer: [number, number][] = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    const hole: [number, number][] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
    expect(pointStrictlyInside([3, 3], [outer, hole])).toBe(true);
    expect(pointStrictlyInside([0, 0], [outer, hole])).toBe(false);
    expect(pointStrictlyInside([5, 0], [outer])).toBe(false);
  });
});

describe('cellIdFor', () => {
  it('floors, including exact boundaries and negatives', () => {
    expect(cellIdFor(48999.99, 24000)).toBe('48_24');
    expect(cellIdFor(49000, 23999.99)).toBe('49_23');
    expect(cellIdFor(-0.01, -1000)).toBe('-1_-1');
  });
});
```

```ts
// pipeline/test/local-frame.test.ts — chunk polygons inverted with typology-generator §4.10 match source lng/lat
import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { toLocalRings } from '../lib/rings';
import { miniDuck } from './helpers';
import { runSql } from '../lib/sql';

// typology-generator spec §4.10, transcribed (the generator module lives on another branch).
function localToLngLat([x, y]: [number, number], [l0, p0]: [number, number]): [number, number] {
  const rad = Math.PI / 180;
  const g = (l0 + 122.45) * Math.sin(p0 * rad) * rad;
  const e = x * Math.cos(g) + y * Math.sin(g);
  const n = -x * Math.sin(g) + y * Math.cos(g);
  const a = 6378137, e2 = 0.0066943800229;
  const W = 1 - e2 * Math.sin(p0 * rad) ** 2;
  const M = (a * (1 - e2)) / W ** 1.5, N = a / Math.sqrt(W);
  return [l0 + e / (N * Math.cos(p0 * rad) * rad), p0 + n / (M * rad)];
}

describe('local frame', () => {
  it('inverts to the source lng/lat within 0.05 m', async () => {
    const db = await miniDuck();
    await runSql(db);
    const rows = await db.all<{ id: string; label_lng: number; label_lat: number; x0: number; y0: number; g7: string }>(
      'SELECT id, label_lng, label_lat, x0, y0, geojson7131 g7 FROM parcel_out'
    );
    proj4.defs('EPSG:7131', '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
    let worst = 0;
    for (const r of rows) {
      for (const ring of toLocalRings(JSON.parse(r.g7), r.x0, r.y0)) {
        for (const v of ring) {
          const got = localToLngLat(v, [r.label_lng, r.label_lat]);
          const want = proj4('EPSG:7131', 'EPSG:4326', [v[0] + r.x0, v[1] + r.y0]);
          const dx = (got[0] - want[0]) * 111320 * Math.cos((want[1] * Math.PI) / 180);
          const dy = (got[1] - want[1]) * 110540;
          worst = Math.max(worst, Math.hypot(dx, dy));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(0.05);
  });
});
```

- [ ] **Step 2–4:** FAIL → implement `rings.ts` and `chunks.ts` → PASS, lint/check.
- [ ] **Step 5: Commit** — `feat(pipeline): local-frame rings, 1 km cells and chunk writer`.

---

### Task 10: Tiles, basemap and fonts

**Files:**
- Create: `pipeline/steps/tiles.ts`, `pipeline/test/tiles.test.ts`, `pipeline/test/fixtures/mini/raw/protomaps-basemap.pmtiles`, `pipeline/test/fixtures/mini/raw/protomaps-fonts/` (see below), update `pipeline/test/fixtures/mini/sources.lock.json`
- Test also: font block in `pipeline/test/sql.test.ts` is **not** used; font checks live in `tiles.test.ts`

**Interfaces:**
- Consumes: `buildings_export`; raw basemap file and raw fonts.
- Produces:
  ```ts
  export function writeBuildingsTiles(db: Duck, outDir: string, workDir: string): Promise<void>; // writes buildings.geojsonseq in workDir, runs tippecanoe → outDir/buildings.pmtiles
  export function copyBasemap(rawFile: string, outDir: string): void;          // → outDir/basemap.pmtiles
  export function installFonts(fontsRoot: string, outDir: string): string[];   // copies <root>/<Stack Name>/*.pbf → outDir/fonts/<NoSpaceName>/; returns stack names written
  export function z12TileBytes(pmtilesFile: string, bbox: typeof BBOX): Promise<number>; // Σ tile bytes at z12 covering bbox (V11)
  ```

Details:
- GeoJSONSeq lines: one Feature per `buildings_export` row with `properties` `{ parcelId?, heightM, baseM, hs }` (omit `parcelId` when null) in that row order. tippecanoe args exactly spec §4.8 (array form): `['-o', out, '-l', 'buildings', '-Z', '12', '-z', '15', '-y', 'parcelId', '-y', 'heightM', '-y', 'baseM', '-y', 'hs', '-T', 'parcelId:string', '-T', 'heightM:float', '-T', 'baseM:float', '-T', 'hs:int', '--drop-smallest-as-needed', '--maximum-tile-bytes=400000', '--no-simplification-of-shared-nodes', '--force', seqFile]`. Non-zero exit → throw with stderr.
- Fonts: live input is the extracted `fonts/` dir of the basemaps-assets tarball (Task 12). Fixture input: commit `pipeline/test/fixtures/mini/raw/protomaps-fonts/<Stack Name>/0-255.pbf` for the three stacks, downloaded once from `https://raw.githubusercontent.com/protomaps/basemaps-assets/028c18f713baecad011301ff7a69acc39bcc2ae7/fonts/<Stack%20Name>/0-255.pbf`, plus `OFL.txt` from the same commit. Pin `FONTS_COMMIT = '028c18f713baecad011301ff7a69acc39bcc2ae7'` in `config.ts`. Lock: for directories, the lock `files` list each committed file.
- Basemap fixture: commit a real tiny extract made once with `pmtiles extract https://build.protomaps.com/20261009.pmtiles pipeline/test/fixtures/mini/raw/protomaps-basemap.pmtiles --bbox=-122.4215,37.7585,-122.4170,37.7615 --maxzoom=15` (≈1.2 MB; verified to work on 2026-10-10). If that URL has expired, use the newest `https://build.protomaps.com/<YYYYMMDD>.pmtiles` that answers and record the date as `upstreamVersion`.
- `z12TileBytes`: compute the z12 tile range for the bbox, read tile sizes via `pmtiles show --json`? No — use `pmtiles tile <file> 12 x y` per tile and sum stdout bytes (empty/absent tiles = 0). (SF bbox at z12 is ≈ 3×3 tiles.)

- [ ] **Step 1: Failing test**

```ts
// pipeline/test/tiles.test.ts — tagged `tools`: skipped with a message when tippecanoe is absent.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { which, run } from '../lib/exec';
import { runSql } from '../lib/sql';
import { installFonts, writeBuildingsTiles } from '../steps/tiles';
import { MINI, miniDuck } from './helpers';

const hasTippecanoe = !!(await which('tippecanoe'));
if (!hasTippecanoe) console.warn('[tools] tippecanoe not found: skipping tiles.test.ts');

describe.skipIf(!hasTippecanoe)('tiles [tools]', () => {
  it('writes buildings.pmtiles whose features carry typed parcelId/heightM/baseM/hs', async () => {
    const db = await miniDuck();
    await runSql(db);
    const out = mkdtempSync(join(tmpdir(), 'sfh-tiles-'));
    await writeBuildingsTiles(db, out, out);
    const meta = JSON.parse((await run('pmtiles', ['show', join(out, 'buildings.pmtiles'), '--metadata'])).stdout);
    const layer = meta.vector_layers.find((l: { id: string }) => l.id === 'buildings');
    expect(layer.minzoom).toBeLessThanOrEqual(12);
    expect(layer.fields).toMatchObject({ parcelId: 'String', heightM: 'Number', baseM: 'Number', hs: 'Number' });
    const stats = meta.tilestats.layers.find((l: { layer: string }) => l.layer === 'buildings');
    const parcelAttr = stats.attributes.find((a: { attribute: string }) => a.attribute === 'parcelId');
    expect(parcelAttr.type).toBe('string');
    expect(parcelAttr.values).toContain('0026T001A');
  });
});

describe('fonts', () => {
  it('renames stacks without spaces and the glyphs template resolves to existing files', () => {
    const out = mkdtempSync(join(tmpdir(), 'sfh-fonts-'));
    const stacks = installFonts(join(MINI, 'raw/protomaps-fonts'), out);
    expect(stacks.sort()).toEqual(['NotoSans-Italic', 'NotoSans-Medium', 'NotoSans-Regular']);
    for (const s of readdirSync(join(out, 'fonts'))) expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
    const template = 'fonts/{fontstack}/{range}.pbf';
    expect(existsSync(join(out, template.replace('{fontstack}', 'NotoSans-Regular').replace('{range}', '0-255')))).toBe(true);
  });
});
```

(Confirm the exact `pmtiles show --metadata` JSON shape on this machine before asserting; adapt the property paths, not the intent: layer `buildings`, minzoom ≤ 12, four typed fields, a string `parcelId` value with letters.)

- [ ] **Step 2–4:** FAIL → implement → PASS, lint/check.
- [ ] **Step 5: Commit** — `feat(pipeline): building tiles, basemap copy and renamed glyph stacks`.

---

### Task 11: Manifest + report + invariants + `build`/`check`/`fixture` commands; regenerate `fixture-0`

**Files:**
- Create: `pipeline/steps/manifest.ts`, `pipeline/steps/check.ts`, `pipeline/steps/build.ts`, `pipeline/steps/fixture.ts`, `pipeline/test/invariants.test.ts`, `pipeline/test/golden.test.ts`, `pipeline/test/fixtures/mini/golden/**`, `e2e/data-fixture.spec.ts`
- Modify: `pipeline/config.ts` (`FIXTURE_PROFILE`), `pipeline/cli.ts` (wire `build`, `check`, `fixture`, `all` minus fetch), `e2e/data-route.spec.ts` (derive the 256-byte size from the fixture file, see below), `e2e/fixtures/data/fixture-0/**` (regenerated), `e2e/fixtures/data/fixture-0/README.md`

**Interfaces:**
- Produces:
  ```ts
  // steps/manifest.ts
  export function buildManifest(a: { datasetVersion: string; builtAt: string; lock: Lock; chunks: ChunkOut[]; overtureContrib: { dataset: string; n: number }[] }): Manifest; // validates with parseManifest before returning
  export function writeManifest(outDir: string, m: Manifest): number; // JSON.stringify(m, null, 0), returns bytes
  // steps/check.ts
  export interface InvariantResult { id: `V${number}`; ok: boolean; detail: string }
  export function checkDataset(outDir: string, profile: InvariantProfile, extras: { counts: Record<string, number>; reencodeIdentical?: boolean }): Promise<InvariantResult[]>;
  // steps/build.ts
  export interface BuildOpts { lockPath: string; rawDir: string; rawByName?: boolean; outRoot: string; datasetVersion?: string; builtAt?: string; profile: InvariantProfile; skipTiles?: boolean }
  export function build(opts: BuildOpts): Promise<{ outDir: string; datasetVersion: string; results: InvariantResult[] }>;
  // steps/fixture.ts
  export function fixture(opts?: { outDir?: string; skipTiles?: boolean }): Promise<number>; // exit code
  ```

`build` sequence (spec §4.2): verify every lock file sha256 (refuse on mismatch, exit 1, print mismatches); compute `datasetVersion` unless given; normalise into a temp `norm` dir; `runSql`; `writeChunks`; re-encode the chunks a second time from the same rows and compare bytes (`reencodeIdentical`, V12 in-run); `writeNeighborhoods`; tiles (unless `skipTiles`); `copyBasemap`; `installFonts`; `buildManifest`/`writeManifest`; write `report.json` (`{ datasetVersion, counts, timings, warnings, toolVersions, housingStock: { end2022: 413208, end2023: 415803 }, invariants }` with keys sorted, `JSON.stringify(x, null, 2)`, no timings in fixture mode so it stays byte-stable); `checkDataset`; exit 1 on any failure.

Manifest `sources` (spec §4.8): one entry per lock source (`id`, `label`, `url` = the entry's `homepage`, `retrievedAt`, `license`), plus one entry per `overture_contrib` dataset: `id: 'overture:<dataset>'`, `label: '<dataset> via Overture Maps'`, `url: 'https://docs.overturemaps.org/attribution'`, `license`: OpenStreetMap/USGS Lidar/Microsoft ML Buildings → `ODbL-1.0`, Esri Community Maps → `CC-BY-4.0`, unknown dataset → `ODbL-1.0` with a report warning. `glyphs = /data/<v>/fonts/{fontstack}/{range}.pbf`; no `sprite`.

Invariants (spec §4.9), each a function of `outDir` + counts + profile:
- V1 units: |Σ units − target| ≤ tol·target (decode every chunk to sum).
- V2 parcels emitted = count of distinct active non-null ids (`counts['parcels.emitted']` vs `counts['parcels.distinct_active_ids']` — add that key in 10_parcels if missing) and in `parcelRange`.
- V3 `landuse.matched_parcels / parcels.emitted ≥ landUseMatchMin`.
- V4 `counts['landuse.unknown_values'] === 0` (written from `landuse_unknown_values`).
- V5 `(hs0+hs1+hs2)/kept ≥ heightCoverageMin`; failure message is exactly `height coverage X% < 95%: set config.renderSource='datasf'` with X to one decimal and the threshold from the profile.
- V6 `pieces.area_with_parcel_m2 / pieces.area_total_m2 ≥ pieceAreaParcelMin`.
- V7 every chunk record's neighborhood ∈ neighborhood names (from `neighborhoods.geojson` when `'from-source'`; the live profile additionally requires that file to have 41 features) and label-inside rate (from `pointStrictlyInside` on decoded polygons) ≥ `labelInsideMin`; empty polygons fail V7.
- V8 every id in exactly one chunk; Σ `parcelCount` = V2 count; `cellId` unique; every chunk decodes and `parcelCount` = decoded length.
- V9 per chunk ≤ `maxChunkParcels`, raw ≤ `maxChunkRaw`, gzip-9 ≤ `maxChunkGzip`.
- V10 max `existingHeightM` ∈ `maxHeightRange`.
- V11 `z12TileBytes(buildings)` ≤ `z12BuildingsMax`, `z12TileBytes(basemap)` ≤ `z12BasemapMax` (skip with ok + detail "tiles skipped" when `skipTiles`), manifest bytes ≤ `manifestMax`, neighborhoods bytes ≤ `neighborhoodsMax`.
- V12 `reencodeIdentical === true` (in-run). The cross-run half is the golden test + CI.
- V13 is enforced by `upload` (Task 13); `check` reports it as `ok: true, detail: 'enforced at upload'`.

`FIXTURE_PROFILE`: unitsTarget = the mini fixture's exact Σ units (compute from Task 7's results: 2+6+4+3+1+2+0+12+0+3+3+7+5+40 = 88), tol 0; parcelRange [14,14]; landUseMatchMin 0.8; heightCoverageMin 0.5; pieceAreaParcelMin 0.5; labelInsideMin 1; chunk limits as live; maxHeightRange [59, 61]; V11 limits as live. Use the numbers the build actually produces when they are correct per the fixture table; if a number disagrees with the table, the SQL is wrong — fix the SQL.

`fixture` command: `build({ lockPath: mini/sources.lock.json, rawDir: mini/raw, rawByName: true, datasetVersion: 'fixture-0', builtAt: <newest retrievedAt in the lock>, profile: FIXTURE_PROFILE, outRoot: tmp })`, then replace `e2e/fixtures/data/fixture-0/` contents with the output (keep `README.md`, rewritten to say it is generated by `npm run pipeline -- fixture` and must not be hand-edited), and copy chunks/manifest/neighborhoods/report into `pipeline/test/fixtures/mini/golden/` only when called with `--update-golden`.

`e2e/data-route.spec.ts`: platform's tests pin the placeholder's 256-byte size (`bytes 0-126/256`, `bytes 236-255/256`). Replace the literal with `const SIZE = statSync('e2e/fixtures/data/fixture-0/buildings.pmtiles').size;` and template the expected headers (`bytes 0-126/${SIZE}`, `bytes ${SIZE - 20}-${SIZE - 1}/${SIZE}`, `bytes */${SIZE}`); the 416 test's `bytes=999999-` must stay past the end (use `bytes=${SIZE + 10}-`). Assertion intent is unchanged. This is the only edit to a platform file; it is reported to `main`.

`e2e/data-fixture.spec.ts` (spec §6 E2E seam):

```ts
import { expect, test } from '@playwright/test';

test('fixture-0 manifest, every chunk and a buildings range are served', async ({ request }) => {
  const res = await request.get('/data/fixture-0/manifest.json');
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m.chunks.length).toBeGreaterThan(0);
  for (const c of m.chunks) {
    const r = await request.get(c.url);
    expect(r.status(), c.url).toBe(200);
    expect(r.headers()['content-type']).toContain('application/json');
    expect((await r.json()).format).toBe('sfh-parcels/1');
  }
  const t = await request.get(m.buildingsTiles, { headers: { Range: 'bytes=0-15' } });
  expect(t.status()).toBe(206);
  const g = await request.get(m.glyphs.replace('{fontstack}', 'NotoSans-Regular').replace('{range}', '0-255'));
  expect(g.status()).toBe(200);
});
```

- [ ] **Step 1: Failing tests**

```ts
// pipeline/test/golden.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { parseManifest } from '../../src/lib/data/manifest';
import { fixture } from '../steps/fixture';
import { which } from '../lib/exec';
import { MINI } from './helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const skipTiles = !(await which('tippecanoe'));
const files = (d: string) => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(d.length + 1)).sort();
const golden = join(MINI, 'golden');
const COMPARED = (f: string) => f.startsWith('parcels/') || f === 'neighborhoods.geojson' || f === 'manifest.json' || f === 'report.json';
const stripBuiltAt = (s: string) => s.replace(/"builtAt":"[^"]*"/, '"builtAt":""');

describe('pipeline fixture', () => {
  it('matches the golden byte for byte and is identical across two builds (V12)', async () => {
    const a = mkdtempSync(join(tmpdir(), 'sfh-fx-a-'));
    const b = mkdtempSync(join(tmpdir(), 'sfh-fx-b-'));
    expect(await fixture({ outDir: a, skipTiles })).toBe(0);
    expect(await fixture({ outDir: b, skipTiles })).toBe(0);
    const fa = files(a).filter(COMPARED);
    expect(fa).toEqual(files(golden).filter(COMPARED));
    for (const f of fa) {
      const ga = stripBuiltAt(readFileSync(join(a, f), 'utf8'));
      expect(ga, f).toBe(stripBuiltAt(readFileSync(join(golden, f), 'utf8')));
      expect(ga, f).toBe(stripBuiltAt(readFileSync(join(b, f), 'utf8')));
    }
    const m = parseManifest(JSON.parse(readFileSync(join(a, 'manifest.json'), 'utf8')));
    const ids = m.chunks.flatMap((c) => decodeParcelChunk(readFileSync(join(a, c.url.replace('/data/fixture-0/', '')), 'utf8')).map((r) => r.id));
    expect(ids).toContain('0026T001A');
    expect(ids).toContain('8711023C');
    expect(m.sources.map((s) => s.id)).toEqual(expect.arrayContaining(['overture:OpenStreetMap', 'overture:USGS Lidar', 'overture:Microsoft ML Buildings']));
  });

  it('e2e/fixtures/data/fixture-0 is the committed output of `pipeline fixture`', () => {
    const e2e = 'e2e/fixtures/data/fixture-0';
    for (const f of files(golden).filter(COMPARED)) {
      expect(readFileSync(join(e2e, f), 'utf8'), f).toBe(readFileSync(join(golden, f), 'utf8'));
    }
  });
});
```

(The `besri` sliver piece is dropped but the building is kept, so `overture:Esri Community Maps` also appears; assert it too if `overture_contrib` counts kept buildings, as specified.)

```ts
// pipeline/test/invariants.test.ts — each invariant fails on a mutated fixture
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PROFILE } from '../config';
import { checkDataset } from '../steps/check';
import { fixture } from '../steps/fixture';

let base: string;
let counts: Record<string, number>;
beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'sfh-inv-'));
  expect(await fixture({ outDir: base, skipTiles: true })).toBe(0);
  counts = JSON.parse(readFileSync(join(base, 'report.json'), 'utf8')).counts;
});
const copy = () => { const d = mkdtempSync(join(tmpdir(), 'sfh-inv-m-')); cpSync(base, d, { recursive: true }); return d; };
const failed = async (dir: string, c = counts, extra: object = {}) =>
  (await checkDataset(dir, FIXTURE_PROFILE, { counts: c, reencodeIdentical: true, ...extra })).filter((r) => !r.ok).map((r) => r.id);
const editChunk = (dir: string, f: (c: Record<string, unknown>) => void) => {
  const p = join(dir, 'parcels', readdirSync(join(dir, 'parcels'))[0]);
  const c = JSON.parse(readFileSync(p, 'utf8')); f(c); writeFileSync(p, JSON.stringify(c));
};

describe('invariants', () => {
  it('all pass on the unmutated fixture', async () => { expect(await failed(base)).toEqual([]); });
  it('V1 fails when units drift', async () => { const d = copy(); editChunk(d, (c) => { (c.units as number[])[0] += 50; }); expect(await failed(d)).toContain('V1'); });
  it('V2 fails when parcel count differs from source', async () => { expect(await failed(base, { ...counts, 'parcels.distinct_active_ids': counts['parcels.emitted'] + 1 })).toContain('V2'); });
  it('V3 fails on low land-use match', async () => { expect(await failed(base, { ...counts, 'landuse.matched_parcels': 1 })).toContain('V3'); });
  it('V4 fails on an unknown landuse value', async () => { expect(await failed(base, { ...counts, 'landuse.unknown_values': 1 })).toContain('V4'); });
  it('V5 fails on low height coverage with the fallback hint', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, { counts: { ...counts, 'buildings.hs3': counts['buildings.kept'] }, reencodeIdentical: true });
    expect(r.find((x) => x.id === 'V5')!.detail).toMatch(/^height coverage .*%: set config\.renderSource='datasf'$/);
  });
  it('V6 fails when piece area lacks parcelId', async () => { expect(await failed(base, { ...counts, 'pieces.area_with_parcel_m2': 0 })).toContain('V6'); });
  it('V7 fails on an unknown neighborhood', async () => { const d = copy(); editChunk(d, (c) => { (c.dict as { neighborhood: string[] }).neighborhood[0] = 'Atlantis'; }); expect(await failed(d)).toContain('V7'); });
  it('V8 fails when a parcel appears in two chunks', async () => { const d = copy(); const p = readdirSync(join(d, 'parcels'))[0]; cpSync(join(d, 'parcels', p), join(d, 'parcels', 'dup.json')); /* manifest unchanged: ids now duplicated if checker scans the dir; also patch manifest */ const m = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')); m.chunks.push({ ...m.chunks[0], cellId: '999_999', url: m.chunks[0].url.replace(/[^/]+\.json$/, 'dup.json') }); writeFileSync(join(d, 'manifest.json'), JSON.stringify(m)); expect(await failed(d)).toContain('V8'); });
  it('V9 fails on an oversized chunk', async () => { expect((await checkDataset(base, { ...FIXTURE_PROFILE, maxChunkParcels: 1 }, { counts, reencodeIdentical: true })).find((r) => r.id === 'V9')!.ok).toBe(false); });
  it('V10 fails when max height is out of range', async () => { const d = copy(); editChunk(d, (c) => { (c.height as number[])[0] = 500; }); expect(await failed(d)).toContain('V10'); });
  it('V11 fails on an oversized manifest budget', async () => { expect((await checkDataset(base, { ...FIXTURE_PROFILE, manifestMax: 10 }, { counts, reencodeIdentical: true })).find((r) => r.id === 'V11')!.ok).toBe(false); });
  it('V12 fails when re-encoding differs', async () => { expect(await failed(base, counts, { reencodeIdentical: false })).toContain('V12'); });
  it('V13 is reported as enforced at upload', async () => {
    const r = await checkDataset(base, FIXTURE_PROFILE, { counts, reencodeIdentical: true });
    expect(r.find((x) => x.id === 'V13')).toMatchObject({ ok: true, detail: 'enforced at upload' });
  });
});
```

(V13's real failing test lives in Task 13's upload tests.)

- [ ] **Step 2: Run** `npm run test:pipeline` → FAIL.
- [ ] **Step 3: Implement** manifest, check, build, fixture, CLI wiring (`check [<v>]` reads `out/<v>/report.json` counts and re-runs `checkDataset` with `LIVE_PROFILE`, or `FIXTURE_PROFILE` when `<v>` is `fixture-*`).
- [ ] **Step 4: Generate and verify.** `npm run pipeline -- fixture --update-golden`; inspect `golden/report.json` against the fixture table (every count in spec §7 AC-9 present: null ids, condo sub-lots, orphans reassigned/dropped, no-row parcels, each hs, each floor-area rule, multipart, holed, slivers). Run `npm run test:pipeline` → PASS; `npx vitest --run --project server` → PASS (platform's `fixture dataset parses` still passes); `npm run data:fixture` then `npx playwright test e2e/data-route.spec.ts e2e/data-fixture.spec.ts e2e/attribution.spec.ts --project=chromium` → PASS; `git status` shows the regenerated e2e fixture. Run `npm run pipeline -- fixture` again and confirm `git status --porcelain e2e/fixtures` is unchanged (byte-identical second run). lint/check clean.
- [ ] **Step 5: Commit** — `feat(pipeline): manifest, report, invariants, build and fixture-0 generation`.

---

### Task 12: Live `fetch` and `fetch --restore`

**Files:**
- Create: `pipeline/sources/datasf.ts`, `pipeline/sources/overture.ts`, `pipeline/sources/protomaps.ts`, `pipeline/steps/fetch.ts`, `pipeline/test/fetch.test.ts`
- Modify: `pipeline/cli.ts` (wire `fetch`, `all`)

**Interfaces:**
- Produces:
  ```ts
  export interface Http { get(url: string): Promise<{ status: number; headers: Headers; body: Uint8Array }> }
  export function fetchDatasf(id: 'datasf-parcels'|'datasf-landuse-2023'|'datasf-footprints'|'datasf-neighborhoods', rawDir: string, http: Http): Promise<LockEntry>;
  export function fetchOverture(release: string | undefined, rawDir: string, db: Duck, http: Http): Promise<LockEntry>;
  export function fetchBasemap(date: string | undefined, rawDir: string, now: Date): Promise<LockEntry>;
  export function fetchFonts(rawDir: string, http: Http): Promise<LockEntry>;
  export function fetchAll(opts: { only?: string; release?: string; basemapDate?: string; restore?: boolean }): Promise<number>;
  export const DATASF: Record<string, { dataset: string; select: string; where?: string; license: string; homepage: string; label: string }>;
  ```

Behaviour (spec §4.1, §4.2):
- DataSF: `https://data.sf.gov/resource/<dataset>.geojson?$select=<cols>&$order=:id&$limit=50000&$offset=<k>` (+ `$where=active=true` for parcels), until a page has < 50,000 features. Each page is one lock file (`name: <id>.page-NNN.geojson`), saved to `.cache/raw/<sha256>`. `upstreamVersion` = `X-SODA2-Truth-Last-Modified` header of page 0 (else `ETag`). Columns: parcels `mapblklot,blklot,active,analysis_neighborhood,shape`; landuse `mapblklot,landuse,resunits,res,totalcomm,the_geom`; footprints `mblr,sf16_bldgid,hgt_median_m,shape`; neighborhoods `nhood,the_geom`. Datasets: `acdm-wktn`, `fdfd-xptc`, `ynuv-fyni`, `j2bu-swwd`. If footprints lack `sf16_bldgid` in the live schema, check `https://data.sf.gov/api/views/ynuv-fyni.json` columns and use the actual id column name — record what you used in the doc and report it to `main` if no stable id exists.
- Overture: release = `--release` or `latest` from `https://stac.overturemaps.org/catalog.json` (inspect the JSON; the spec says it has a `latest` field). DuckDB with httpfs, `SET s3_region='us-west-2'`, `read_parquet('s3://overturemaps-us-west-2/release/<rel>/theme=buildings/type=building/*', hive_partitioning=1)` with the bbox `WHERE` from spec §4.1, selecting `id, height, num_floors, min_height, is_underground, list_transform(sources, s -> s.dataset) datasets, geometry geom` and `COPY` to a single parquet ordered by `id` → one lock file `overture-buildings.parquet`.
- Basemap: date = `--basemap-date` or yesterday UTC (`YYYYMMDD`); if 404, step back one day up to 7 days. `pmtiles extract https://build.protomaps.com/<date>.pmtiles <tmp> --bbox=-122.53,37.69,-122.34,37.84 --maxzoom=15`.
- Fonts: `https://codeload.github.com/protomaps/basemaps-assets/tar.gz/<FONTS_COMMIT>` → one lock file; build extracts `fonts/` from it (`tar -xzf` via execFile into a temp dir) before `installFonts`. Make `build` handle this for the live lock (fixture uses the pre-extracted dir).
- After fetch: write `.cache/raw/<sha256>` files and rewrite `pipeline/sources.lock.json` (keep entries not refetched under `--only`).
- `--restore`: for each lock file missing from `.cache/raw`, `wrangler r2 object get sfhousing/<archiveKey> --file <path> --remote` (or `--local` with `--local`), then verify sha256. Implement through the `R2Target` from Task 13 — so implement Task 13's `R2Target` interface first in this task if needed, or call a small `getObject(key, file, local)` that Task 13 reuses.
- `all`: if `pipeline/sources.lock.json` is missing, run `fetch`; then `build` with `LIVE_PROFILE`. Never uploads.

- [ ] **Step 1: Failing tests** with a fake `Http` (no network):

```ts
// pipeline/test/fetch.test.ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchDatasf } from '../sources/datasf';

function fakeHttp(pageSizes: number[]) {
  const urls: string[] = [];
  return {
    urls,
    get: async (url: string) => {
      urls.push(url);
      const k = urls.length - 1;
      const n = pageSizes[k] ?? 0;
      const fc = { type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', properties: { mapblklot: `${k}-${i}` }, geometry: null })) };
      return { status: 200, headers: new Headers({ 'X-SODA2-Truth-Last-Modified': 'Tue, 07 Oct 2026 10:00:00 GMT' }), body: new TextEncoder().encode(JSON.stringify(fc)) };
    }
  };
}

describe('fetchDatasf', () => {
  it('pages with $order=:id/$limit/$offset until a short page, filters active parcels and locks each page', async () => {
    const http = fakeHttp([50000, 50000, 12]);
    const raw = mkdtempSync(join(tmpdir(), 'sfh-raw-'));
    const entry = await fetchDatasf('datasf-parcels', raw, http);
    expect(http.urls).toHaveLength(3);
    const u = new URL(http.urls[1]);
    expect(u.host).toBe('data.sf.gov');
    expect(u.pathname).toBe('/resource/acdm-wktn.geojson');
    expect(u.searchParams.get('$offset')).toBe('50000');
    expect(u.searchParams.get('$order')).toBe(':id');
    expect(u.searchParams.get('$where')).toBe('active=true');
    expect(entry.files).toHaveLength(3);
    expect(entry.rowCount).toBe(100012);
    expect(entry.upstreamVersion).toBe('Tue, 07 Oct 2026 10:00:00 GMT');
    expect(entry.license).toBe('PDDL-1.0');
    expect(readFileSync(join(raw, entry.files[2].sha256), 'utf8')).toContain('"2-11"');
  });
});
```

Add a test that `fetchBasemap` steps back a day on 404 by injecting a fake `run` (make `fetchBasemap` accept an optional `run` dependency).

- [ ] **Step 2–4:** FAIL → implement → PASS, lint/check.
- [ ] **Step 5: Live smoke** (network): `npm run pipeline -- fetch --only datasf-neighborhoods` → lock has 41 rows; commit nothing from `.cache`. Do **not** run the full fetch here (Task 15 does).
- [ ] **Step 6: Commit** — `feat(pipeline): live source fetchers, lockfile writing and restore`.

---

### Task 13: `upload` and `verify`

**Files:**
- Create: `pipeline/lib/r2.ts`, `pipeline/steps/upload.ts`, `pipeline/steps/verify.ts`, `pipeline/test/upload.test.ts`, `pipeline/test/verify.test.ts`
- Modify: `pipeline/cli.ts` (wire `upload <v> [--local]`, `verify <v> --origin <url>`)

**Interfaces:**
- Produces:
  ```ts
  // pipeline/lib/r2.ts
  export interface R2Target { exists(key: string): Promise<boolean>; put(key: string, file: string, contentType: string, cacheControl: string): Promise<void>; get(key: string, file: string): Promise<boolean> }
  export function wranglerTarget(opts: { local: boolean; bucket?: string; run?: typeof run }): R2Target;
  export function contentTypeFor(path: string): string; // .json application/json, .geojson application/geo+json, .pmtiles application/vnd.pmtiles, .pbf application/x-protobuf, else application/octet-stream
  // pipeline/steps/upload.ts
  export function upload(a: { outDir: string; datasetVersion: string; lock: Lock; rawDir: string; target: R2Target; concurrency?: number; retries?: number; log?: (s: string) => void }): Promise<number>;
  // pipeline/steps/verify.ts
  export function verify(a: { datasetVersion: string; origin: string; fetch?: typeof fetch }): Promise<{ ok: boolean; failures: string[] }>;
  ```

`wranglerTarget` (spec §4.10): `exists` runs `npx wrangler r2 object get <bucket>/<key> --pipe` with `--remote` or `--local`; exit 0 → true; non-zero with stderr matching `/not found|does not exist|NoSuchKey/i` → false; any other failure → throw (never treat an auth error as "not found"). `put`: `npx wrangler r2 object put <bucket>/<key> --file <f> --content-type <t> --cache-control <c> --remote|--local`. Verify the exact not-found stderr text against local R2 once (`npx wrangler r2 object get sfhousing/data/nope/manifest.json --local --pipe`) and pin it in a comment.

`upload` order (spec §4.10): (1) if `exists('data/<v>/manifest.json')` → log `version <v> already published`, return 1 with **no** puts; (2) for each lock file, if `!exists(archiveKey)` put `rawDir/<sha256>` at `archiveKey` (`application/octet-stream`, `private, no-store`); (3) put every artifact except `manifest.json` at `data/<v>/<relpath>` with `IMMUTABLE`, `concurrency` 8, each with up to 3 retries and exponential backoff (200 ms × 2^n; injectable sleep for tests); any final failure → return 1 without the manifest; (4) put `manifest.json` last; (5) print `"PUBLIC_DATASET_VERSION": "<v>"` and `npm run pipeline -- verify <v> --origin https://sfhousing-staging.mindlace.net`. `upload` refuses a `datasetVersion` not matching `DATASET_VERSION_RE` or an `outDir` whose manifest's `datasetVersion` differs.

`verify`: GET `<origin>/data/<v>/manifest.json` → `parseManifest`; HEAD every chunk url, `neighborhoods`, `buildingsTiles`, `basemapTiles` and the glyph url for each of the three stacks at range `0-255` (expect 200); GET both PMTiles with `Range: bytes=0-126` (expect 206). Collect all failures.

- [ ] **Step 1: Failing tests**

```ts
// pipeline/test/upload.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { R2Target } from '../lib/r2';
import { upload } from '../steps/upload';

function fakeTarget(existing: string[] = [], failKeys: Record<string, number> = {}) {
  const calls: string[] = [];
  const store = new Set(existing);
  const t: R2Target = {
    exists: async (k) => { calls.push(`exists ${k}`); return store.has(k); },
    put: async (k) => { if ((failKeys[k] ?? 0) > 0) { failKeys[k]--; throw new Error('flaky'); } calls.push(`put ${k}`); store.add(k); },
    get: async () => false
  };
  return { t, calls, store };
}
function outDir() {
  const d = mkdtempSync(join(tmpdir(), 'sfh-up-'));
  mkdirSync(join(d, 'parcels'));
  writeFileSync(join(d, 'parcels', '50_25.json'), '{}');
  writeFileSync(join(d, 'neighborhoods.geojson'), '{}');
  writeFileSync(join(d, 'manifest.json'), JSON.stringify({ datasetVersion: 'fixture-7' }));
  return d;
}
const lock = { sources: [] };
const opts = (target: R2Target, extra = {}) => ({ outDir: outDir(), datasetVersion: 'fixture-7', lock, rawDir: '/nonexistent', target, sleep: async () => {}, log: () => {}, ...extra });

describe('upload', () => {
  it('V13: aborts before any put when the version is already published', async () => {
    const { t, calls } = fakeTarget(['data/fixture-7/manifest.json']);
    expect(await upload(opts(t))).toBe(1);
    expect(calls).toEqual(['exists data/fixture-7/manifest.json']);
  });
  it('puts the manifest last and retries a flaky object', async () => {
    const { t, calls } = fakeTarget([], { 'data/fixture-7/parcels/50_25.json': 2 });
    expect(await upload(opts(t))).toBe(0);
    const puts = calls.filter((c) => c.startsWith('put'));
    expect(puts[puts.length - 1]).toBe('put data/fixture-7/manifest.json');
    expect(puts).toContain('put data/fixture-7/parcels/50_25.json');
  });
  it('never puts the manifest when an artifact keeps failing', async () => {
    const { t, store } = fakeTarget([], { 'data/fixture-7/neighborhoods.geojson': 99 });
    expect(await upload(opts(t))).toBe(1);
    expect(store.has('data/fixture-7/manifest.json')).toBe(false);
  });
  it('refuses a mismatched or invalid version', async () => {
    const { t } = fakeTarget();
    expect(await upload(opts(t, { datasetVersion: 'fixture-8' }))).toBe(1);
    expect(await upload(opts(t, { datasetVersion: 'v1' }))).toBe(1);
  });
});
```

(`upload` takes an optional `sleep` for tests; add it to the interface.) `verify.test.ts`: fake `fetch` serving a parsed golden manifest; assert `ok: true`; then make one chunk 404 and one PMTiles answer 200 to a Range request and assert both appear in `failures`.

- [ ] **Step 2–4:** FAIL → implement → PASS, lint/check.
- [ ] **Step 5: Local R2 end-to-end.** `npm run pipeline -- fixture --out pipeline/out/fixture-9 --version fixture-9` (add these two flags to `fixture` if not present; they must not touch `e2e/`), then `npm run pipeline -- upload fixture-9 --local` → exit 0; run it again → exits 1 with `version fixture-9 already published`. Then `npm run preview` in the background and `npm run pipeline -- verify fixture-9 --origin http://localhost:4173` → ok. Stop the preview server. Record the transcript summary in the SDD ledger.
- [ ] **Step 6: Commit** — `feat(pipeline): R2 upload with manifest-last and verify`.

---

### Task 14: CI workflow and docs

**Files:**
- Create: `.github/workflows/pipeline.yml`, `docs/dev/pipeline.md`
- Modify: `CLAUDE.md` (scoped docs list: add `[docs/dev/pipeline.md](docs/dev/pipeline.md)` — platform's `scripts/docs-index.spec.ts` requires every `docs/dev/*.md` to be linked in exactly that form; commands table: `npm run pipeline -- <cmd>`, `npm run test:pipeline`). `ci.yml` is not changed (Task 3 scoped `test:unit` to server+client).

`pipeline.yml`: `on: pull_request` / `push` with `paths: ['pipeline/**', 'src/lib/data/**', '.github/workflows/pipeline.yml']`, plus `workflow_dispatch`. Steps: checkout, setup-node from `.nvmrc`, `npm install -g npm@11.3.0`, `npm ci`, install tippecanoe 2.79.0 from source (`git clone --depth 1 --branch 2.79.0 https://github.com/felt/tippecanoe && make -j && sudo make install` as separate `run:` lines with `working-directory`), install pmtiles 1.31.2 from the GitHub release tarball (`go-pmtiles_1.31.2_Linux_x86_64.tar.gz`; verify the asset name at https://github.com/protomaps/go-pmtiles/releases/tag/v1.31.2), `npm run pipeline -- doctor`, `npm run test:pipeline`, `npx vitest --run --project server src/lib/data`, then `npm run pipeline -- fixture` and `git diff --exit-code e2e/fixtures pipeline/test/fixtures/mini/golden` (V12 cross-run). Lint with `npm run lint:workflows` if actionlint is installed locally; otherwise rely on the CI actionlint job.

`docs/dev/pipeline.md`: commands table (spec §4.2), the run order for a release (`all` → `upload` → `verify` → edit `PUBLIC_DATASET_VERSION` staging then prod via release), where artifacts land, the lock and `datasetVersion` rules, the fixture and `--update-golden`, invariants list, the ODbL obligations (spec §4.12), and **Partner actions** (create bucket `sfhousing`, `wrangler login`, first real upload).

- [ ] **Step 1:** write both files and the CLAUDE.md edits. **Step 2:** `npm run lint`, `npx prettier --check docs/dev/pipeline.md .github/workflows/pipeline.yml`, `npx vitest --run scripts/docs-index.spec.ts` (platform's docs-index test checks CLAUDE.md links) → PASS. **Step 3: Commit** — `ci(pipeline): add pipeline workflow and developer docs`.

---

### Task 15: Live acceptance run (`pipeline all`)

**Files:**
- Modify: `pipeline/sources.lock.json` (written by fetch — commit it), possibly `pipeline/config.ts` only for facts the live data forces **and that the spec allows** (none expected).
- Evidence: `.superpowers/superconductor/<run>/` is not yours — write the run evidence to the SDD ledger dir.

- [ ] **Step 1:** `npm run pipeline -- doctor` → all OK.
- [ ] **Step 2:** `npm run pipeline -- fetch` (network, ~10 min). Confirm lock row counts are near spec §4.1 (parcels ~227,967 active rows, landuse ~154,476, footprints ~177,023, neighborhoods 41, overture ~177,940).
- [ ] **Step 3:** `npm run pipeline -- build` → prints `datasetVersion`; every V1–V12 passes. Record: Σ units vs 413,208, V2 count, V3 rate, V5 coverage, V6, V7 label-inside rate, chunk count/max sizes, V10, V11 numbers, timings.
- [ ] **Step 4:** `npm run pipeline -- build` again → same `datasetVersion`; `diff -r` of chunks, neighborhoods and manifest-minus-builtAt between the two outputs is empty (AC-5). (Build into a second out root or copy the first output aside before the rerun.)
- [ ] **Step 5:** `npm run pipeline -- upload <v> --local` → 0, and `verify <v> --origin http://localhost:4173` against `npm run preview` → ok.
- [ ] **Step 6:** If any invariant fails or any live schema differs from the spec (missing column, different neighborhood count, V5 below 95%), **stop and message `main`** with the numbers — do not loosen thresholds.
- [ ] **Step 7: Commit** `pipeline/sources.lock.json` — `chore(pipeline): pin live source lock for first dataset`.

---

## Spec coverage checklist (self-review)

| Spec item | Task |
|---|---|
| §2 codec, decoding rules | 1 |
| §2 Manifest/parseManifest/DATASET_VERSION_RE | 2 |
| §4.1 sources & fetch, archiving | 12, 13 |
| §4.2 layout, commands, deps, doctor, lock entry | 3, 4, 11, 12, 13 |
| §4.3 datasetVersion | 4 |
| §4.4 parcels | 6, 9 |
| §4.5 land use & eligibility, attributes | 7, 8 |
| §4.6 heights, fallback message | 8, 11 (V5); datasf render fallback not built — escalate if triggered |
| §4.7 clipping | 8 |
| §4.8 artifacts (chunks, tiles, basemap, fonts, neighborhoods, manifest, report) | 9, 10, 11 |
| §4.9 V1–V13 | 11, 13 |
| §4.10 upload | 13 |
| §4.12 attribution (manifest sources expansion, licences) | 11 |
| §6 tests 1–8, CI, e2e seam | 1, 2, 6–11, 14 |
| §7 AC 1–10 | 3, 15, 7, 15, 13/15, 12 (restore; AC-7 full proof needs real R2 → partner action), 11, 11, 11 |
