# Fast policy load: a pipeline-built gross table

Status: draft for discussion (2026-11-08)

## Why

Opening a published policy at `/s/<id>` takes about **12.9 s** before the policy's own result shows. A fresh `/sim` takes about 1.0 s. Both were measured on the real dataset `2026-11-08-91736640`, in a production build on an M5 Pro, as the median of 3 cold loads.

The time goes to three places:

| Step | Cost on `/s` | Cause |
| --- | --- | --- |
| Lever recompute (`leverStep` → `createYieldRecompute` → `scenarioYield` → `generate`) | ~8.6 s CPU, ~10 s wall-clock | Generates a building for each of 81,653 touched lots in the browser, mostly clipper inset and boolean operations. Before it can start, it must fetch 7–21 MB of parcel chunks for every touched cell. |
| Throwaway first revision | ~1 s | `FzpMode` starts the scenario with the policy's levers but without its brush lots, runs a full revision (101 band runs included), then sends the real levers and discards that work. |
| Revision-0 geometry packing | ~1.3 s | Out of scope (see Non-goals). |

The same recompute runs on `/sim` whenever someone opens an autosaved draft or edits a lever that touches many lots. `docs/dev/sim-levers.md` gives 3.4 s for all RH-1 lots and 22.7 s for the transit brush.

## Intent

Make a policy's result appear at about the speed of a fresh `/sim`, without trusting anything a publisher uploads. The numbers someone sees on a shared link must be ones our own build produced.

## Goals

1. `/s/<id>` for the profiling policy (transit rule, one paint stroke, protections) is ready (first timeline) within about 2.5 s on the same machine and build. Today it takes 12.9 s.
   - What's left after this change is mostly loading and decoding (~0.7 s) and revision-0 geometry packing (~1.3–1.6 s).
   - Building shapes can't usefully be cached. They depend on each lot's policy height and are far larger than unit counts.
   - If packing is the remaining gap, the follow-up is to post the first timeline before packing, as `/sim` already does with zero cells, and let buildings fill in. That's a separate change.
2. Lever edits on `/sim` stop needing building generation or city-wide chunk fetches, so a revision resolves without the `resolving` wait.
3. Numbers are identical to today's recompute, bit for bit, on every input.

## Non-goals

- Publishing the seed or any run results. Call 17 stands: the seed is not published.
- Shipping a default-lever representative seed. That would save about 0.24 s on a first `/sim` visit; it is a separate change.
- Speeding up massing or geometry packing (`packCells`, the 2.5 s revision-0 cap).
- Changing the generator, the typology cascade, or any yield.

## Anti-goals

- Any path where a client-supplied yield reaches another viewer.
- A table that silently disagrees with `scenarioYield`, whether through a stale dataset, a generator change, or overflow.

## What we measured (2026-11-08)

All measured over the full real dataset: every row at every story count from 1 to 80. Scripts and outputs are in the session scratchpad (`yield-table/`).

- **Rows and plateaus.** There are 155,020 scenario rows, of which 152,185 are eligible.
  - Gross is a function of (row, stories) and of nothing else. The cap, `existingUnits` and protections all apply after gross.
  - Gross stops changing at a per-row plateau. The plateau is 5 for 87% of rows, 7 or 12 for most of the rest, and 80 for 1,013 rows. The mean is 6.46, for 963,974 stored values in total.
  - The generator clamps stories to 80, so any s ≥ 80 gives g(80).
- **Not monotone.** 4.5% of rows dip, at the walk-up→podium and midrise→tower transitions. No encoding or lookup may assume gross rises with stories.
- **Size.** Each row is stored as `first`, `plateau`, then zigzag-varint deltas.
  - That comes to 938 KiB raw, **219 KiB gzip** or 195 KiB brotli. For comparison, `parcels.bin` is 2,057 KiB.
  - Decoded in memory: about 1.9 MB of values plus 0.6 MB of row offsets.
- **Build time.** It parallelizes trivially, with no shared state across rows.
  - Bounded by `physicalMaxStories` (80 for district-size lots): 1.31M grosses in 20 s on 14 worker threads.
  - Unbounded (all 80 story counts): 67 s.
- **Correctness.** Checked against 24,156 random Needs, with stories from 1 to 255 and caps from 0 to 199, all run through the real `createYieldRecompute` → `envelopeRow` with table lookups: **0 mismatches**. All 79,107 GrossCache entries from a real policy also matched.
- **Existing overflow bug.** One lot (`4591A090`, row 153908, 1.41 km²) grosses up to 162,730 units.
  - The pipeline clamps scenario yields to 0xFFFF (`pipeline/…/scenario.ts:734`).
  - The client's `EnvelopeTable.yield` is a `Uint16Array` (`src/lib/sim/levers/layers.ts:12`), so recompute yields above 65,535 wrap modulo 65,536.

## Design

### 1. Pipeline: `fzp/gross.bin`

- The pipeline adds a scenario output, the gross table, listed in the manifest as `scenarios.fzp.gross`. It is optional in the schema, because older published datasets lack it.
- For every scenario row, in `parcels.bin` row order, it stores gross(row, s) for s from `first` to `plateau`. The lookup rule:
  - g(s) = 0 when s ≤ 0 or s < `first`;
  - g(s) = g(`plateau`) when s ≥ `plateau`;
  - ineligible and all-zero rows store an empty range.
- Each value comes from the same `scenarioYield(scenarioRecordOf(parcels, row, rec), s, null)` call the client makes today, so there is one source of truth.
- Values are clamped to 0xFFFF, matching the pipeline's existing scenario-yield clamp.
  - The clamp affects 71 cells, all on one lot.
  - The client today wraps these values, so this is a behaviour change only for that lot, and it fixes the wrap. Builder's call: keep the clamp, or use a u32 escape if exact values matter. My call is the clamp, for consistency with `parcels.bin`.
- Encoding: one header, then per row a u8 `first`, a u8 `plateau`, then zigzag-varint deltas from g(`first`−1) = 0. The file is deflate-raw like `parcels.bin`. The exact header (magic, version, row count) is left to the builder.
- The build runs rows across `worker_threads`, with each worker loading the inputs itself. The story bound for each row is `physicalMaxStories` (with the variety edge inset) or 80 for district-size lots. The true plateau falls out of the build.
- The pipeline `check` step verifies two things:
  - the row count matches `parcels.bin`;
  - a deterministic sample of rows re-derives exactly through `scenarioYield`, from the **decoded chunk records**, the ones the client uses.
- The build itself reads the pre-encode records (`readParcelRecords`, `pipeline/steps/chunks.ts:54-88`). The measurement used decoded chunks. The two should agree, since coordinates are quantised to cm in both and labels are rounded. The check is what proves it.
- The dataset version already hashes `src/lib/generator`, so a generator change produces a new dataset version and a new table. Nothing extra is needed for lockstep.

### 2. Worker: table-backed recompute

- `initScenario` fetches `gross.bin` alongside `parcels.bin` and decodes it into dense values plus row offsets.
- When the table is present, the lever path computes a Need's `EnvelopeRow` from table lookups. That means:
  - no `generate` calls, no chunk wants, no `resolving` phase;
  - the revision goes current in the same `leverStep`;
  - `lw.gross` (the GrossCache) is unnecessary on this path.
- When the manifest has no `gross` entry, the current chunk-backed recompute runs unchanged. This happens when an older published policy opens on its own, older dataset version. That fallback stays until no served dataset lacks the table. Builder's call: whether to put a single `grossAt(row, s)` seam in front of both paths.
- **The overflow fix applies to both paths.** The recompute clamps yields to 0xFFFF before they enter the `Uint16Array`, so the fallback agrees with the table.

### 3. Client: no throwaway first revision on `/s`

- `initScenario` gains a flag meaning "the levers in this request are incomplete; wait for `setLevers`". `SimPage` sets it on `/s` when the published policy has brushes. On `/s` the policy is known when the page is built, before `FzpMode` mounts.
- **With the flag set, the worker runs and posts nothing until the first revision is current.** `loadedHook` creates no pending revision from the init levers, and the un-levered base run is neither run nor posted. Reroll and prefetch wait as well. (My call: anything posted earlier would show FZP-as-written as if it were the policy's result.)
- `FzpMode.syncLevers` may send before the scenario is live; it no longer waits for the first timeline. The host already accepts `setLevers` before the load finishes (`scenario-host.ts:689-704`).
  - The test "a levers change before the first timeline waits for it" (`FzpMode.svelte.spec.ts:1233`) pins the old gate and changes accordingly.
- `LeverSync` sends its first compile without the 250 ms debounce. Later edits keep the debounce. (My call: the debounce exists for typing and brushing, not for opening a policy.)
- **If a brush fails to resolve** (`data-missing`, `bad-request`, or the `no-session` park outlasting the session), `LeverSync` still sends, with that brush's lots empty. This is today's visible behaviour, because the brushless init revision stays the result today. The existing lever-status messages report the failure. (My call: a policy must never sit in "loading" forever.)
- Brush resolution needs the loaded parcels, so it still waits for `loadedHook`. With the table, the gap from resolution to current is a few milliseconds.
- **`/sim` draft restore is out of scope here.** `FzpMode` sends `initScenario` from its `onMount`, which runs before `SimPage`'s `restore()`, so on `/sim` the init carries the default levers. Fixing that means restructuring restore and remix. Restoring a draft keeps today's throwaway revision. With the table that revision is cheap, about 0.5 s of band runs.

### 4. `npm run data:local` copies scenario files

- `collectDataPaths` in `scripts/data-local.ts` skips `manifest.scenarios` and the glyph files. Because of that, `/sim` cannot load locally on a real dataset. This was found while profiling.
- The manifest has no list of its paths. The URL list is a local array inside `superRefine` (`src/lib/data/manifest.ts:82-98`), and glyphs are a URL template.
- The fix: export one enumerator of every file a manifest references, including the scenario files, `gross.bin` and the glyph ranges. Both `superRefine` and `data-local` use it, so a new file can't be missed again.

## Acceptance

- **Profiling.** Re-run the profiling harness: `run.mjs` (the A/B/C cases) in the scratchpad, or a committed equivalent if the builder wants one. The profiling policy at `/s/<id>` must be ready in ≤ 2.5 s, median of 3, production build. `/sim` cases A and B must not regress.
- **Unit tests.**
  - Table encode/decode round-trips.
  - The lookup rule holds at s ≤ 0, s < `first` and s ≥ `plateau`.
  - On the fixture dataset, table-backed and recompute-backed `EnvelopeRow`s are identical for a sweep of Needs.
  - The 0xFFFF clamp holds on both paths.
- **Fallback.** An `/s` policy on a dataset without `gross` still loads, through the recompute path.
  - The existing e2e "gone-dataset fallback" does not cover this: it opens on the current `fixture-0`, which will have the table.
  - A new test is needed: a policy on an existing dataset version whose manifest lacks `gross`, for example a fixture variant or a host-level test with a manifest that has no `gross`.
- **Overflow and failure paths.** A brush that fails on `/s` still produces a revision. The flag holds every post until that revision is current.
- **Docs.** `docs/dev/sim-levers.md` (recompute and bench numbers), `docs/dev/pipeline.md` (new output, check) and `docs/dev/data-serving.md` if the key layout list names files.
- **Shipping.** The branch changes the dataset version, so it uploads its dataset before signoff, per `docs/dev/pipeline.md`. The dataset version also hashes `src/lib/sim/levers` and `src/lib/sim/scenario` (`pipeline/lib/version.ts:42-49`), so every worker edit on this branch moves the version too. Upload once, after the last such edit.

## Left to the builder

- File header details, whether to use `physicalMaxStories` or the full 1–80 sweep in the build (the output is identical; only build time differs), and test placement.
- Whether `scripts/bench-levers.ts` keeps measuring the fallback path or switches to the table.
