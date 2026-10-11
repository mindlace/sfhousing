# Scoreboard — subsystem spec

Derived from `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (approved 2026-10-10).
Milestone 1. Companions: `2026-10-10-typology-generator-design.md`, and `2026-10-10-brush-tool-design.md`, whose worker host (§4.9) calls the score functions.

## 1. Scope

Design row (verbatim):

| slug | scope |
|---|---|
| `scoreboard` | Derived readouts: gross new units, units demolished on replaced parcels, net units, % of RHNA (82,069) and of RHNA + buffer (94,379), parcels changed, and net units by neighborhood. Includes a short "what this number means" note: M1 is theoretical max buildout, not a forecast. |

**In scope**

- The pure-TS `score()` (I15's name for it) and the incremental accumulator, with exact formulas. They are called by brush-tool's worker host, which attaches the result to every `diff` (I15).
- The M1 target registry (`rhna` and `rhna-buffer`).
- The Svelte `Scoreboard` component: desktop panel, 375 px collapsed bar, the neighborhood list, the "what this number means" copy, loading and error states, the data-vintage footnote, and the aria-live announcement.
- Number formatting.

**Out of scope**

- Generation, which is per-parcel `units` and `replacesExisting` (generator).
- Chunk loading (brush-tool's worker host) and chunk-status display on the map (map-view).
- Plan provenance banners (plan-sharing).
- Affordability, displacement and transit metrics (M2), the likely-mode toggle (M2) and the pipeline line (M5). Section 5 covers the seams for these only.

## 2. Interfaces

### Owned or consumed I-rows (verbatim)

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I2 | `interface Envelope { maxStories: number }` — the per-parcel allowed envelope. The **only** thing manipulation writes. Later milestones add optional fields; M1 code must ignore unknown fields | plan-model → generator, scoreboard | MC (envelope-as-common-currency), DC (field set) |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I7 | `type BuildoutMode = 'max'` (M1). `'likely'` is reserved for M2 | generator, scoreboard | MC (sequence) |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt) | generator → map-view, scoreboard | DC |
| I9 | `interface GeneratedBuilding { parcelId: ParcelId; source: 'user'; /* widens to 'pipeline' \| 'scenario' later */ typology: TypologyId; parts: { footprint: [lng, lat][] /* single outer ring; parcel holes dropped in M1 */; baseM: number; topM: number }[] /* nested: each part's footprint ⊆ the part below; rendered ground-to-topM */; stories: number; units: number; floorAreaM2: number; replacesExisting: boolean }` | generator → map-view, scoreboard | DC |
| I11 | `interface Score { grossUnits: number; demolishedUnits: number; netUnits: number; targets: TargetProgress[]; parcelsChanged: number; byNeighborhood: Record<string, number> }`; `interface Target { id: string; label: string; units: number; range?: [low: number, high: number] /* M1 never sets; M2 affordability targets are ranges */; source: { label: string; url: string } }`; `interface TargetProgress { target: Target; fraction: number /* uncapped: 1.8 = 180% */ }`. M1 registers `rhna` (82,069) and `rhna-buffer` (94,379); M2 registers affordability targets | scoreboard → UI | MC (net units against named targets; overshoot is meaningful), DC (shape) |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |
| I15 | **The one main↔worker protocol** (`src/lib/sim/protocol.ts`, owned by brush-tool's worker host): `SimRequest` as in the brush-tool spec, and `SimResponse = { type: 'ready'; rev; datasetVersion; chunkCount } \| { type: 'diff'; rev; phase: DiffPhase; render: GeneratedUpdate; stats?: OpStats; complete: boolean; score: Score } \| { type: 'chunks'; status: Record<cellId, ChunkStatus>; pending: number; failed: string[] } \| { type: 'parcelSummary'; reqId: number; summary: ParcelSummary \| null } \| { type: 'error'; rev; code; message }`, with matching request `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId }` (no rev). `ParcelSummary = { parcelId; neighborhood; landUse; eligible; existingUnits; envelope: Envelope \| null; generated: { typology; stories; units } \| null }`, used by map-view's tooltip. `GeneratedUpdate` and `PackedCell` are owned by map-view (the worker imports the pure `packCell`). `Score` is owned by scoreboard (the worker calls its pure `score()`). The main thread never receives `GeneratedBuilding[]` | brush-tool ↔ map-view, scoreboard, typology-generator | DC |

### Internal types (new; they do not alter any I-row)

```ts
// src/lib/scoreboard/accumulator.ts — pure TS, no DOM
interface Contribution { gross: number; demolished: number; neighborhood: string }
interface ScoreAccumulator {
  set(parcel: ParcelRecord, building: GeneratedBuilding | null): void; // replaces prior contribution
  clear(): void;
  snapshot(): Score;                                                    // I11
}
function createScoreAccumulator(targets: readonly Target[]): ScoreAccumulator;
// Pure, non-incremental; the `score()` that I15's worker host calls. Must equal the accumulator's snapshot.
function score(entries: Iterable<[ParcelRecord, GeneratedBuilding]>, targets: readonly Target[]): Score;

// src/lib/scoreboard/targets.ts
const M1_TARGETS: readonly Target[];

// UI-only input, derived on the main thread from the I15 SimResponse
// ('chunks' → pending/failed.length; 'diff'.complete; 'ready'.datasetVersion)
interface ScoreStatus { pendingChunks: number; failedChunks: number; datasetVersion: string;
  builtAt: string; planDatasetVersion?: string; mode: BuildoutMode }
```

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

### 4.1 Formulas (exact, integer)

These are per parcel `p` with result `b` (`null` means no building).

- `gross(p) = b ? b.units : 0`
- `demolished(p) = b && b.replacesExisting ? p.existingUnits : 0`. An ADU (`replacesExisting: false`) demolishes 0. A replacement demolishes **all** existing units on the parcel, including on vacant or non-residential parcels, where that is 0.
- `net(p) = gross(p) − demolished(p)`

Totals over all parcels with a contribution:

- `grossUnits = Σ gross`, `demolishedUnits = Σ demolished`, `netUnits = grossUnits − demolishedUnits`
- `parcelsChanged` = the count of parcels with `b !== null`. Painted parcels that generate `null` are not "changed": nothing on the map changed.
- `byNeighborhood[n] = Σ net(p)` over parcels with `b !== null` and `p.neighborhood = n`. An empty `neighborhood` is keyed `"Unassigned"`. Neighborhoods with no changed parcel are **absent**, not 0.
- `targets[i] = { target: T_i, fraction: netUnits / T_i.units }`. This is uncapped and is **not** clamped at 0 or 1. Order follows the registry.

All arithmetic is integer, so the totals are exact and independent of order, and a full recompute equals an incremental one.

Because I8 returns `null` for a replacement whose units ≤ `existingUnits` (and an ADU adds at least one home), `net(p) ≥ 1` for every changed parcel in M1. The formulas and UI still handle negative values (a minus sign, and the bar drawn from 0) defensively.

### 4.2 Targets (M1 registry)

| id | label | units | source.label | source.url |
|---|---|---|---|---|
| `rhna` | RHNA 2023–2031 | 82069 | SF Planning, RHNA Primer | `https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/RHNA-Primer.pdf` |
| `rhna-buffer` | RHNA + 15% buffer | 94379 | SF Planning, RHNA Primer | same URL |

Verified via search result 2026-10-10: the primer gives 82,069 for 2023–2031 and a "at least 15% more capacity" buffer. 82,069 × 1.15 = 94,379.35, which this spec rounds down to 94,379, matching the design. The Housing Element sites inventory states 2023–2030 for the same number. The label uses the primer's period.

`rhna` is the **primary** target, shown first and largest.

### 4.3 Incremental update and timing

- **Hosting.** Brush-tool's worker host holds every `ParcelRecord` and every result. It keeps one accumulator for the display state (committed state plus any active preview). For each parcel whose generated result changed (a building added, replaced or removed), it calls `set()`. Each `set()` subtracts the parcel's previous `Contribution` (kept in a `Map<ParcelId, Contribution>`) and adds the new one, at O(1) per parcel. The host then attaches `snapshot()` as `diff.score`, which I15 makes mandatory on every `diff`. Using `score()` over the whole display state is allowed, because the two must be equal (property test), but it is O(n) per diff and is not recommended during previews.
- **Previews.** The score reflects the live preview while dragging. Cancel and commit diffs restore or confirm it.
- **Rendering.** The main thread renders the `score` of the latest applied diff, at most once per animation frame. Diff ordering and dropping follow brush-tool §4.9.
- **No count-up animation.** The number shown is always the exact current value.
- **Latency.** For strokes of ≤ 500 parcels, the score updates in the same frame as the buildings (≤ 150 ms after pointer-up).
- **Whole-city repaint.** The score updates progressively with each batch, with the "Updating…" state described below.
- **Dataset changes.** When `datasetVersion` changes, the host calls `clear()` before regenerating.

### 4.4 UI states (`src/lib/scoreboard/Scoreboard.svelte`)

**Layout, desktop (≥ 768 px):** a panel docked top-right, 320 px wide. From top to bottom:

1. A badge reading **"Theoretical max buildout"**. It is always visible and is keyed off `mode`.
2. The headline: **net new homes**, formatted, labelled "net new homes".
3. One progress row per target: label, percent, a bar, and a remainder line.
4. A secondary line: "{gross} built · {demolished} replaced · {parcelsChanged} parcels changed".
5. A "By neighborhood" disclosure, collapsed by default.
6. A "What does this number mean?" disclosure.
7. A footnote with the data vintage.

**Layout, mobile (< 768 px, works at 375):** a collapsed bottom bar, 56 px tall, showing "{net} net new homes · {pct}% of RHNA". Tapping it opens a bottom sheet with the full panel. Scoreboard exposes `--scorebar-h: 56px`; brush-tool's mobile bar sits directly above it (brush-tool §4.1a), so the bar never covers the mode switch (decided in fidelity pass). The open sheet covers the brush bar; closing it restores both.

**Progress bar:**

- The track spans 0 to `max(1, ceil(maxFraction·2)/2)`. The full-scale value rounds up to the next 50%.
- A tick sits at 100%, labelled "target".
- The fill reaches the actual fraction, so overshoot is drawn past the tick and the scale grows.
- Remainder line:
  - Under target: "{target − net} to go".
  - At or over target: "{net − target} over target".
  - Overshoot is phrased neutrally. It is not an error state.

**States:**

| state | condition | rendering |
|---|---|---|
| empty | no changed parcels and `pendingChunks = 0` | net "0", 0% on both targets, hint "Paint a height on the map to add homes." Neighborhood disclosure hidden |
| updating | `pendingChunks > 0` or the latest diff has `complete: false` | numbers shown as-is, plus a spinner and "Updating…". The aria-live region stays silent until settled |
| partial failure | `failedChunks > 0` | warning row: "Some areas didn't load ({failedChunks}). Totals leave them out." It has a **Retry** button, which emits `retry`. The shell sends brush-tool's `retryChunks` |
| old plan | `planDatasetVersion && planDatasetVersion !== datasetVersion`. Under I16 this arises only for a published plan whose own version 404s (autosaved plans are rebased before load, so their version always equals current) | the footnote adds "· plan made on data {planDatasetVersion}, recalculated on current data" |
| overshoot | fraction ≥ 1 | the percent shows e.g. "180%", the bar extends past the tick, and the remainder reads "… over target" |

**Neighborhood list:**

- Rows sorted by net, descending, with ties broken by name using `localeCompare(…, 'en')`.
- The top 10 are shown, then a "Show all {k}" button.
- Each row shows the name, net (formatted), and a mini bar relative to the largest row.

### 4.5 Formatting (`src/lib/scoreboard/format.ts`)

- **Counts:** `new Intl.NumberFormat('en-US').format(n)`, so 82069 → "82,069". Negative values use U+2212 MINUS SIGN.
- **Percent** of `fraction`:
  - `p = fraction·100`.
  - If `|p| < 10`, floor to one decimal: "0.4%", "9.9%".
  - Otherwise floor to an integer: "99%", "180%".
  - **Floor** is deliberate: the display never shows "100%" before the target is met. Exactly 0 shows "0%".
- **Compact form**, for the mobile bar only, when net ≥ 100,000: `Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })`, e.g. "123.4K". Exact values are always available in the expanded sheet.
- **Footnote:** "Data {datasetVersion} · built {builtAt as YYYY-MM-DD} · Sources", where Sources links to the attribution page.

### 4.6 "What this number means" copy (ships verbatim)

> **Theoretical max buildout.** This counts every home the heights you painted would allow if every eligible parcel under your strokes were rebuilt to the maximum, all at once, today. It is not a forecast: real construction depends on cost, demand, permitting and time.
>
> **Net, not gross.** When a new building replaces an existing one, the homes in the old building are subtracted. Backyard cottages (1–2 stories painted on a lot with homes) keep the existing building and add one home.
>
> **Targets.** RHNA is the state-assigned number of homes San Francisco must plan for in 2023–2031 (82,069). The state also expects a buffer of at least 15% (94,379). Going past 100% is meaningful: SF is far behind, and more housing than the minimum is a real policy choice.

Each target's source link is shown under the copy.

### 4.7 Accessibility

- The region is `role="region"` with `aria-label="Housing scoreboard"`.
- There is a polite `aria-live` element. It announces "Net new homes {net}, {pct} of RHNA" 1 s after the last change, once the state has settled (not updating).
- Bars are `role="meter"` with `aria-valuemin=0`, `aria-valuemax` = track max × target units, `aria-valuenow` = net, and `aria-valuetext` = "{pct} of {label}". `meter` is used rather than `progressbar` so overshoot past 100% stays valid.
- Disclosures are `<details>`/`<summary>`.
- Colour is never the only signal. The overshoot state carries text.
- Contrast meets WCAG AA.

## 5. Seams

- **M2 `consequences` / affordability (R9, OD-8).** The accumulator takes `targets: readonly Target[]` and the UI renders N targets generically. Nothing is hard-coded to two rows, and only the first target is styled primary. M2 appends targets whose `units` come from `AffordabilityModel.unitsToReach(goal)`. **Nothing is built now:** no model, no range display, no cost display. I11's optional `Target.range` is the M2 seam for ranges; M1 never sets it and the M1 UI ignores it, as it ignores any other unknown field.
- **M2 `buildout-likelihood`.** The badge copy is keyed by `ScoreStatus.mode`. M1 has one entry, `max: 'Theoretical max buildout'`.
- **M5 `pipeline-overlay`.** Nothing now. `Contribution` is per parcel, so a later per-`source` split is additive.

## 6. Testing

**Server project (Vitest, pure TS)**

`accumulator.spec.ts`:

- Formulas on fixtures `score-fixtures.ts`:
  - ADU on a 1-unit lot: gross 1, demolished 0, net 1.
  - Replacement 9 over 1: net 8.
  - Vacant replacement 2 over 0: net 2.
  - `null`: no change.
  - Neighborhood "" → "Unassigned".
- `set` twice on the same parcel replaces rather than adds.
- `set(p, null)` removes the parcel and deletes the neighborhood key when it drops to no parcels.
- Fractions: net 164,138 → `rhna` fraction 2.0 exactly (uncapped). Net 0 → 0.
- **Property** (fast-check): for random sequences of `set` over 500 parcels, the incremental snapshot deep-equals a from-scratch recompute, and is invariant to the order of updates.

`format.spec.ts`:

- 0 → "0%"
- 0.004 → "0.4%"
- 0.0999 → "9.9%"
- 0.9999 → "99%"
- 1 → "100%"
- 1.8049 → "180%"
- −5 → "−5"
- 82069 → "82,069"
- Compact 123456 → "123.5K"

`targets.spec.ts`: the ids, units and URL are as in §4.2. The second target's units equal `floor(82069·1.15)`.

**Client project (Vitest browser)**

`Scoreboard.svelte.spec.ts` checks each state in §4.4:

- empty, updating, partial failure (Retry emits), old plan, and overshoot (bar past the tick, "over target" text)
- the neighborhood list sorting and "Show all"
- the 375 px collapsed bar and the expanded sheet
- the aria-live announcement after settle

**E2E (Playwright, with axe gate)**

`scoreboard.e2e.ts`, using the fixture dataset served by `platform`:

1. Paint a stroke over the fixture block. The score shows a nonzero net within 150 ms of pointer-up.
2. Erase. The score returns to the empty state.
3. Load a share link whose plan's `datasetVersion` is absent from R2 (the I16 fallback to current). The footnote shows "recalculated". A plan whose version exists renders on its own data and shows no such note.
4. Block one chunk URL (route abort). The warning and Retry appear. Retry recovers.
5. axe reports no violations on the page with the panel and sheet open, at 1280 px and 375 px.

## 7. Acceptance criteria

1. `Score` matches I11 exactly, and the formulas in §4.1 hold on every fixture.
2. No displayed percent or bar is clamped at 100%. The test exists and passes.
3. The headline number is **net**. Gross appears only in the secondary line.
4. The "Theoretical max buildout" badge and the §4.6 copy are present in every state.
5. The data version, build date and source links are visible from the panel.
6. Incremental equals full recompute (property test).
7. The score renders ≤ 1 time per frame and settles within 150 ms for strokes of ≤ 500 parcels in e2e.
8. Layout works at 375 px, and axe reports zero violations.

## 8. Interface concerns (for the orchestrator)

- ~~**IC-1:**~~ *Resolved by I15:* chunk status, `complete` and `ready.datasetVersion` travel in the single worker protocol; `ScoreStatus` is derived from it.
- ~~**IC-2:**~~ *Resolved by I15:* the worker calls scoreboard's pure `score()` (and may use `createScoreAccumulator`); neither touches the DOM.
- ~~**IC-3:**~~ *Resolved:* I11 gains optional `Target.range?: [low, high]`, which M1 never sets.

## 9. Open questions

- **OQ-1:** Should "parcels changed" also show painted-but-unchanged parcels, for example "1,204 painted · 980 changed"? *Recommend:* no for M1. `null` parcels are explained by the copy. Revisit if users report "painting did nothing" confusion.
- **OQ-2:** Should RHNA's income-level split (35,471 above-moderate, 13,717 moderate, 12,014 low, 20,867 very low, per an SF BLA document found in search, *unverified at source*) be shown? *Recommend:* no. The design puts affordability breakdowns out of scope for M1, and generated units have no income level.
