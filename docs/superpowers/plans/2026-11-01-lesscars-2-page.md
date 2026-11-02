# /lesscars Plan 2 of 3: The Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone `/lesscars` route that plays the stored representative plan future from 2028 to 2068 (streets changing state, transit opening, garages and the shuttle appearing, freed land appearing, buildings rising), with the headline difference in the header and the source breakdown, project timeline and evidence behind a tap.

**Architecture:** Read-only playback. The route's universal load fetches the manifest, the FZP calibration and the three `scenarios/lesscars/*.json` files through Plan 1's parsers. A new worker playback host (beside the editor and scenario hosts, behind the same Worker and router) decodes `timeline.bin` against `parcels.bin`, turns initiative builds into drawable schedules, packs engine schedules with the existing `createGeometry`/`packTimedCell` as chunks load and packs freed-site builds as one synthetic cell. Street states, plan transit, garages and freed land are plain MapLibre GeoJSON layers the page derives from `plan.json`/`sites.json`, filtered by day. The FZP `TimeScrubber`, `SimMap` and generator are reused; the header pattern copies `/sim`'s `ScoreBar`.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, MapLibre (via `SimMap`), deck.gl timeline layers (existing), Vitest (server, client, pipeline projects), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-01-lesscars-design.md` (Goals 1 to 4, Non-goals, Anti-goals, "How it gets made": Reuse the FZP timelapse, Many paired futures, Compact UI, Accessibility). Plan 1 as built: `docs/superpowers/plans/2026-11-01-lesscars-1-pipeline.md`, `docs/dev/lesscars.md`. The approved plan the page will show (Plan 3 wires it): `docs/lesscars/plan-v1.md`.

## Global Constraints

- Route `/lesscars`, standalone. No change to `/sim`, its levers, `FzpMode`, `ScoreBar` or the scenario host's behaviour (spec Non-goals). Nobody edits anything but the year (scrub, play) and the map.
- Scrubber range `LESSCARS_START` (2028-01-01) to `LESSCARS_HORIZON` (2068-12-31) from `src/lib/data/lesscars/schedule.ts:16-17`. The page opens paused at `LESSCARS_START`; no autoplay.
- Headline: `summary.extra.mean` at the last year end (2068), with the p10 to p90 band, in the header's **pinned** slot as one button; the breakdown, chart and map key behind that tap; the project timeline and evidence are header actions, which sit in the phone Menu below 768 px (owner: compact UI, details on demand; status apart from controls). The headline is fixed (2068), so no changing status sits among buttons.
- The four sources (freed land, parking sites, transit-unlocked, other) are shown so the displayed parts add to the displayed whole.
- Amenities (wider sidewalks, bike lanes, pedestrian streets, the car shuttle) appear on the map and in no housing number (spec Anti-goals).
- Every plan parameter shows its evidence tier and source; tier 4 reads `TIER_LABEL[4]` "Assumption, not data" (`src/lib/fzp/labels.ts:64`), as `/sim` does.
- WCAG 2.2 AA (`docs/dev/accessibility.md`): `expectNoA11yViolations` at 1280 and 375 px; targets at least 24x24 px; map state never conveyed by colour alone (each street state differs by line pattern or width too, and has a map-key row).
- The worker computes nothing geographic beyond massing and packing the stored timeline; all data stays under `data/<v>/` (CLAUDE.md Architecture).
- No new runtime dependency. CSP (`kit.csp`, `svelte.config.js`) unchanged. Map text uses the self-hosted glyph directories by their shipped names (`NotoSans-Regular`, `FONT_RENAME` in `src/lib/map/style.ts:29-33`), since layers added at runtime bypass `rewriteFont`.
- Tests: Vitest with `expect.requireAssertions` (every test calls `expect`); colocated specs (`*.spec.ts` server, `*.svelte.spec.ts` client); Playwright e2e under both projects (`chromium`, `mobile` 375 px) on `fixture-0`.
- Helpers named in the test sketches (`fixtureFetch`, `harness`, `fakeMap`, `withFinal`, `T`, …) are local to their spec file unless an Interfaces block defines them; fixture values are read from `fixture-0` or the mini plan, not hard-coded, except where a sketch quotes the fixture's own ids.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits; no Claude attribution anywhere; multi-line commit messages via a temp file and `git commit -F`. Never compound `cd ... && cmd`.

## Review Focus

1. **Rounding breaks the sum.** Means are fractional (integer sum ÷ seeds). Rounding each source independently can make the four displayed parts differ from the displayed headline. Expected: the displayed parts add exactly to the displayed total, negative parts included. Pinned by Task 6 `roundedParts` tests.
2. **A zero or negative answer.** A garage on a lot the baseline later builds on can make a seed's difference, the band, or even the mean negative (Plan 1 Review Focus 3). Expected: the headline reads "−N homes by 2068" (U+2212) or "No extra homes by 2068", the band can cross zero, and the chart's axis reaches below zero. Pinned by Task 6 `headlineText` and `extraChartModel` tests.
3. **A dataset without the scenario, or with a bad file.** Production has no `scenarios.lesscars` until Plan 3. Expected: a "not in this dataset" page with no worker started; a malformed or mismatched lesscars file gives an error state with Retry, never a crash or a 500. Pinned by Task 2 load tests and Task 9 route tests.
4. **A reservation voided in the representative seed.** The market got to a parking lot or garage parcel first. Expected: no garage marker, no clearance, no initiative building there; the lot shows the market's project. The map must not draw what the summary does not count. Pinned by Task 1 codec/runs tests, Task 3 `garageFeatures` test and Task 4 host test.
5. **Scrubbing backwards or jumping across events.** Expected: what the map shows is a pure function of the day: a street reverts to cars before its project starts, a stop disappears before its line opens, and a jump past several events lands on the right state with no stale filter. Pinned by Task 3 interval tests and Task 3b `setDay` tests (epoch gating both ways).

---

## Decisions (builder's calls; the owner may revisit any)

- **Representative future only.** The map plays the plan arm of the representative seed, as stored. No baseline toggle (spec: "The map plays one representative future").
- **No `Schedule.origin` extension.** The playback host converts each `InitiativeBuild` into an ordinary `Schedule` (`origin: 'simulated'`, id prefix `lc-build:`) only inside the worker, for massing and packing, and keeps its own index for cards. Widening `origin` would touch the engine, Plan 1's encoded `ORIGINS` index and `card.ts`, for no gain.
- **Own card, not `ProjectCard`.** A tap on a building opens a small lesscars card (what it is, homes, stories, status, dates). The page shows no FZP `ProjectCard`, so `card.ts:210` (Local Program read from the base view) is not on any lesscars path. It is also harmless as data stands: every regime view keeps the base `localProgram` column (`pipeline/lib/lesscars/regimes.ts:9-10,416`); Task 1 pins that invariant with a test so a future change shows up.
- **Freed sites are one synthetic cell.** Their records are not in `parcels.bin` (they live in `sites.json`), so `createGeometry` cannot anchor them. The host packs all freed-site builds once into cell `lc-sites`; parking builds stand on real parcels and go through `createGeometry` like engine schedules.
- **Street geometry stays in `plan.json`.** `segments` (cnn → lines) and drawn `{ line }` segments already carry every street; sites come from `sites.json`. Nothing new is published for geometry. Garage parcels' positions come from the worker (`parcels.bin` label points), since the main thread never loads `parcels.bin`.
- **Plan stops only.** The map draws the stops a plan line adds (`lc:` ids, with `lngLat`). Existing stops a line reuses are not redrawn, and `transit.json` is not fetched; `SimMap` gets `HIDDEN_VIEW` (`src/lib/view/prefs.ts`).
- **Masonic underpass.** plan-v1 asks the page to show it filled from `geary-subway-1`'s opening, with no project of its own (plan-v1 "Masonic underpass becomes the Masonic station"). Task 1 adds an optional, display-only `displays` list to the plan format; Plan 3 adds the Masonic entry to the live plan.
- **Timeline format tag stays `sfh-lesscars/1`.** Nothing is published live yet; the fixture and goldens are regenerated in the same commit.
- **No header mode link in this plan** (see Open questions). The route is reachable by URL.
- **Retry remounts.** A load failure's Retry calls `invalidateAll()`; a worker crash's Retry restarts the client. A new manifest remounts `LessCarsMode` under `{#key}`, so the page's MapLibre layers are always installed on a fresh map (SimMap fires `onready` once per mount, `src/lib/map/SimMap.svelte:633-638`).

## Layout (builder's call; owner can revisit)

```
≥ 768 px
┌ SF Housing [Paint][Simulate]      [ +260 homes by 2068  ▾ ]          [Timeline] [Evidence] ┐
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ map: streets by state, plan lines/stops, garages, freed land, buildings                      │
│                                             ┌ Fewer-cars details (popover, on tap) ────────┐ │
│                                             │ The plan adds 260 homes by 2068 vs no plan.  │ │
│                                             │ Middle 80% of 5 paired futures: +260 to +260 │ │
│                                             │ Where they come from (2068)    table + bar   │ │
│                                             │   Freed land        260                      │ │
│                                             │   Parking sites       0   Transit-unlocked 0 │ │
│                                             │   Other               0                      │ │
│                                             │ Extra homes by year  [chart, band, now-line] │ │
│                                             │ Amenities add no homes and are not counted.  │ │
│ ┌ Building card ┐                           │ ▸ Map key                                    │ │
│ │ (on tap)      │                           │ [Evidence for every number]                  │ │
│ └───────────────┘                           └──────────────────────────────────────────────┘ │
│              [ notices row: Loading… / Couldn't load the buildings. Retry ]                  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ [▶ Play] [1 year/s ▾]  ────●──────── 2028 … 2068, markers: SB 79 · 2030 · 2032 …  Jan 2028   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

< 768 px
┌ SF Housing   [+260 by 2068 ▾]   [☰] ┐   ☰ Menu: Paint, Simulate, Timeline, Evidence
│ details: full-width disclosure below │   card: full width above the scrubber
│ the header                           │
│ map                                  │
├──────────────────────────────────────┤
│ scrubber                             │
└──────────────────────────────────────┘
```

Below lg the headline's words "homes" and "2068" may be visually hidden as `ScoreBar` does for "added" (the accessible name keeps them) if the 375 px header does not fit; Task 9's e2e checks no horizontal scroll at 375 px.

Street states (map key order), each with its own pattern: **Works under way** (dashed), **Buses and trams only** (solid, wide), **Bike lanes** (solid, medium, dotted edge or narrower), **Pedestrian street** (dotted), **Removed: now land** (thin solid over the freed-land fill), **Underpass filled** (double or cased line). Plan lines: subway, tram, BRT (solid, by mode colour; dashed while being built), car shuttle (dash-dot). Stops: discs. Garages: square markers with a "P" label (hollow while being built). Freed land: hatched-look fill (fill + outline). Colours are new palette tokens (Task 3b) checked for contrast.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/data/lesscars/codec.ts` (+ `codec.test.ts`) | timeline `reservations` column | 1 |
| `src/lib/data/lesscars/plan.ts` (+ test), `schedule.ts` (+ test) | optional `displays`; its checks | 1 |
| `pipeline/lib/lesscars/runs.ts` (+ `pipeline/test/lesscars-runs.test.ts`) | representative timeline records reservation verdicts | 1 |
| `pipeline/steps/lesscars.ts`, `pipeline/steps/check-lesscars.ts` (+ `lesscars-step.test.ts`, `invariants.test.ts`, `lesscars-regimes.test.ts`) | display CNNs checked and drawn; V35 checks reservations; Local Program invariant | 1 |
| `pipeline/test/fixtures/mini/enrichment/lesscars-plan.json`, goldens, `e2e/fixtures/data/fixture-0/` | fixture display; regenerated outputs | 1 |
| `src/lib/lesscars/load.ts` (+ `load.spec.ts`) | the page's data load | 2 |
| `src/lib/lesscars/features.ts` (+ spec) | plan → day-stamped GeoJSON (streets, lines, stops, sites, garages) | 3 |
| `src/lib/map/palette.ts` (+ spec), `src/lib/lesscars/map-layers.ts` (+ spec), `src/lib/lesscars/legend.ts` | tokens; MapLibre layers with epoch-gated day filters; key rows | 3b |
| `src/lib/sim/lesscars/types.ts`, `builds.ts` (+ spec), `playback-host.ts` (+ spec) | worker playback protocol, build schedules and cards, the host | 4 |
| `src/lib/sim/router.ts` (+ `worker-router.spec.ts`), `src/lib/sim/worker.ts`, `src/lib/sim/scenario/types.ts` | routing the playback requests | 4 |
| `src/lib/sim/lesscars/playback-client.ts` (+ spec) | main-thread client | 5 |
| `src/lib/lesscars/summary-view.ts` (+ spec), `HeadlineBar.svelte`, `DetailsPanel.svelte`, `ExtraChart.svelte` (+ client specs), `copy.ts` | headline, breakdown, chart | 6 |
| `src/lib/lesscars/timeline-view.ts` (+ spec), `TimelineDialog.svelte` (+ client spec) | project timeline; scrubber markers | 7 |
| `src/lib/lesscars/evidence.ts` (+ spec), `EvidenceDialog.svelte` (+ client spec) | evidence | 8 |
| `src/lib/lesscars/LessCarsMode.svelte` (+ client spec), `LessCarsCard.svelte`, `debug.ts`; `src/routes/lesscars/+page.ts`, `+page.svelte` (+ specs); `src/lib/shell/layout.ts` (+ spec) | composition, route | 9 |
| `e2e/lesscars.spec.ts`, `docs/dev/lesscars.md`, `CLAUDE.md` | e2e, docs | 10 |

---

### Task 1: Format additions: reservation verdicts and display-only plan items

Ruling 5 from Plan 1: the timeline does not record per-seed reservation verdicts. `representativeTimeline` already drops voided parking builds (`pipeline/lib/lesscars/runs.ts:410`), but an edge garage on a parcel has no build, and a zero-gain parking conversion keeps its reservation with no build (`runs.ts:21-23`), so the page cannot tell kept from voided. Also add the display-only `displays` list for plan-v1's Masonic underpass.

**Files:**
- Modify: `src/lib/data/lesscars/codec.ts:76-85` (type), `:279-376` (encode), `:383-561` (decode); `src/lib/data/lesscars/codec.test.ts`
- Modify: `src/lib/data/lesscars/plan.ts:115-121` (type), `:393-403` (parser); `src/lib/data/lesscars/plan.test.ts`
- Modify: `src/lib/data/lesscars/schedule.ts:127` (`checkPlan`); `schedule.test.ts`
- Modify: `pipeline/lib/lesscars/runs.ts:385-420`; `pipeline/test/lesscars-runs.test.ts`
- Modify: `pipeline/steps/lesscars.ts:90-91` (`cnnsOf`), `:150-160` (CNN check), `:238-262` (`segmentLines`); `pipeline/test/lesscars-step.test.ts`
- Modify: `pipeline/steps/check-lesscars.ts` (`checkV35`); `pipeline/test/invariants.test.ts:1211`
- Modify: `pipeline/test/lesscars-regimes.test.ts` (Local Program invariant)
- Modify: `pipeline/test/fixtures/mini/enrichment/lesscars-plan.json`; regenerate `pipeline/test/fixtures/mini/golden/scenarios/lesscars/*` and `e2e/fixtures/data/fixture-0/`
- Modify: `docs/dev/lesscars.md` (format table, output files)

**Interfaces:**
- Produces (codec): `LessCarsTimeline.reservations: { row: number; kept: boolean }[]`, one entry per reserved T11 row in the run, strictly ascending by `row`. Encoded as a column object `reservations: { row: number[]; kept: number[] }` (kept 0/1). `decodeTimelinePayload` throws (`lesscars: reservations…`) on a missing key, a length mismatch, a row out of `[0, count)`, rows not strictly ascending, or `kept` not 0 or 1.
- Produces (plan): `export interface PlanDisplay { id: string; label: string; segments: SegmentRef[]; from: string }` (shown from the open day of project `from`); `LessCarsPlan.displays?: PlanDisplay[]`. The parser accepts the optional top-level key; absent stays absent (goldens of plans without it are unchanged byte for byte); `segments` must be non-empty (the existing `segments()` helper, `plan.ts:257`).
- Produces (checks): `checkPlan` reports `unknown-dependency` (project = the display id) when `from` names no project, and `duplicate-id` when a display id equals a project id or another display id.
- Produces (pipeline): display CNNs are checked against `src_streets` (message `${display.id}.segments: CNN ${c} is not in src_streets`) and their lines are in `plan.json` `segments`. `representativeTimeline` returns `reservations`. V35 fails when the timeline's reservation rows differ from the rows of the plan's parking-conversion parcels and `edge-garage` `{ parcel }` sites.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/data/lesscars/codec.test.ts
it('round-trips reservations ascending by row', () => {
  const t = { ...timeline, reservations: [{ row: 2, kept: true }, { row: 5, kept: false }] };
  const back = decodeTimelinePayload(encodeTimelinePayload(t, ids), parcels);
  expect(back.reservations).toEqual([{ row: 2, kept: true }, { row: 5, kept: false }]);
});
it('rejects reservations out of range, unsorted or with a bad kept flag', () => {
  for (const r of [{ row: [99], kept: [1] }, { row: [5, 2], kept: [1, 1] }, { row: [2], kept: [2] }])
    expect(() => decodeTimelinePayload(withReservations(r), parcels)).toThrow(/reservations/);
});
// withReservations: encode the fixture timeline, then replace the JSON `reservations` column.

// src/lib/data/lesscars/plan.test.ts
it('parses displays; a plan without them has no displays key', () => {
  expect(parseLessCarsPlan(withDisplays).displays).toEqual([
    { id: 'underpass', label: 'Underpass filled', segments: [{ cnn: ['2000'] }], from: 'subway' }
  ]);
  expect('displays' in parseLessCarsPlan(miniPlan)).toBe(false);
});
it('rejects a display with no segments', () => {
  expect(() => parseLessCarsPlan(displayWith({ segments: [] }))).toThrow(/displays\.0\.segments/);
});

// src/lib/data/lesscars/schedule.test.ts
it('a display naming no project is unknown-dependency; a reused id is duplicate-id', () => {
  const codes = checkPlan(planWithDisplays([{ id: 'x', from: 'nope' }, { id: 'subway', from: 'subway' }]), s)
    .map((p) => `${p.project}:${p.code}`);
  expect(codes).toContain('x:unknown-dependency');
  expect(codes).toContain('subway:duplicate-id');
});

// pipeline/test/lesscars-runs.test.ts (reuse the voided-conversion search already at :258)
it('representativeTimeline records every reserved row, kept and voided', () => {
  const t = representativeTimeline({ ...args, seed: found.seed });
  expect(t.reservations.map((r) => r.row)).toEqual(reservedRows(found.rf));
  expect(t.reservations.find((r) => r.row === found.row)?.kept).toBe(false);
});

// pipeline/test/lesscars-step.test.ts
it('display CNNs are checked and drawn', async () => {
  await expect(runStepWith(displayCnn('9999'))).rejects.toThrow(
    /underpass\.segments: CNN 9999 is not in src_streets/
  );
  expect(Object.keys((await fixturePlanFile()).segments)).toContain('2000');
});

// pipeline/test/invariants.test.ts (in 'V35 /lesscars files')
it('V35 fails when the timeline lacks a reserved parcel', async () => {
  const dir = await fixtureCopy(); // existing helper pattern at :1228
  rewriteTimeline(dir, (t) => ({ ...t, reservations: t.reservations.slice(1) }));
  expect((await v35(dir)).ok).toBe(false);
});

// pipeline/test/lesscars-regimes.test.ts
it('every regime view keeps the base Local Program column', () => {
  for (const g of [...regimes.plan, ...regimes.baseline])
    expect(Array.from(g.parcels.localProgram)).toEqual(Array.from(parcels.localProgram));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project server src/lib/data/lesscars`
Run: `npx vitest run --project pipeline pipeline/test/lesscars-runs.test.ts pipeline/test/lesscars-step.test.ts pipeline/test/invariants.test.ts pipeline/test/lesscars-regimes.test.ts`
Expected: the new tests FAIL (no `reservations`, no `displays`); the Local Program test PASSES already (it pins existing behaviour).

- [ ] **Step 3: Implement the codec column, the plan field and the checks**

`codec.ts`: add `reservations` to `LessCarsTimeline`, to the encoded doc and to the decoder's required keys. `plan.ts`: `PlanDisplay`, `parseDisplay(v, path)` with keys `['id', 'label', 'segments', 'from']`, top-level `record(json, '', [...], ['displays'])`. `schedule.ts`: the two display checks in `checkPlan`, using the existing `add` and sort.

- [ ] **Step 4: Implement the pipeline side**

`runs.ts` `representativeTimeline`: `reservations` = the sink's `kept` map as `{ row, kept }` sorted by row. `lesscars.ts`: `cnnsOf` takes the plan and returns project and display CNNs (`segmentLines` and the CNN check both use it). `check-lesscars.ts`: in V35, compute the plan's reserved rows from `plan.projects` and `parcels.bin`'s index and compare with `timeline.reservations` rows (`timeline reservations ≠ plan's reserved parcels` in the detail).

- [ ] **Step 5: Add the fixture display and regenerate**

Add to the mini plan: `"displays": [{ "id": "underpass", "label": "Fixture Ave underpass filled", "segments": [{ "cnn": ["2000"] }], "from": "subway" }]` (`2000` is FIXTURE AVE, `pipeline/test/fixtures/mini/README.md` Streets).
Run: `npm run pipeline -- fixture --update-golden`
Expected: `plan.json` gains `displays` and segment `2000`; `timeline.decoded.json` gains `reservations` (garage parcel `3512015`, parking parcel `3512017`); `git diff --stat` shows only lesscars files changed under `golden/` and `fixture-0/`.

- [ ] **Step 6: Run everything to verify it passes**

Run: `npx vitest run --project server src/lib/data/lesscars`
Run: `npm run test:pipeline`
Expected: PASS, golden test included.

- [ ] **Step 7: Document**

`docs/dev/lesscars.md`: in "The plan format", a paragraph on `displays` (display only: no capacity, no homes, no closure; shown from `from`'s open day; Plan 3 uses it for the Masonic underpass); in "Output files", `timeline.bin` lists `reservations` (every reserved row's kept/voided verdict in the representative seed); V35's new check.

- [ ] **Step 8: Commit**

```bash
git add src/lib/data/lesscars pipeline docs/dev/lesscars.md e2e/fixtures/data/fixture-0
git commit -m "feat(lesscars): record reservation verdicts and display-only plan items"
```

---

### Task 2: The page's data load

**Files:**
- Create: `src/lib/lesscars/load.ts`
- Test: `src/lib/lesscars/load.spec.ts`

**Interfaces:**
- Consumes: `loadManifest(version, current, fetchFn)` (`src/lib/sim/manifest.ts`), `fetchCalibration(url, fetchFn)` (`src/lib/fzp/load.ts:13`), `parsePlanFile`, `parseSitesFile`, `parseSummary` (`src/lib/data/lesscars/codec.ts:636,598,188`).
- Produces:

```ts
export type LessCarsData = {
  manifest: Manifest;
  calibration: Calibration;
  plan: LessCarsPlanFile;
  sites: LessCarsSitesFile;
  summary: LessCarsSummary;
};
export type LessCarsPageData =
  | { state: 'ready'; data: LessCarsData }
  | { state: 'no-scenario'; datasetVersion: string } // no scenarios.lesscars, or no scenarios.fzp
  | { state: 'error'; datasetVersion: string; message: string }; // manifest, fetch, parse, mismatch
export async function loadLessCars(
  datasetVersion: string,
  fetchFn: (url: string) => Promise<Response>
): Promise<LessCarsPageData>;
```

Rules: the manifest of `datasetVersion` (no fallback); `no-scenario` without `scenarios.lesscars` or `scenarios.fzp` (playback needs `parcels.bin`, `projects.json`, `calibration.json`); the calibration and the three files fetched in parallel; `error` when any fetch is not ok, any parser throws, or a file's `datasetVersion` differs from the manifest's. Never throws. Logs with `console.error('[lesscars] …')`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/lesscars/load.spec.ts — a fetch fake serving files from e2e/fixtures/data/fixture-0
it('ready on fixture-0 with the parsed files', async () => {
  const r = await loadLessCars('fixture-0', fixtureFetch());
  expect(r.state).toBe('ready');
  if (r.state !== 'ready') return;
  expect(r.data.summary.planId).toBe(r.data.plan.plan.id);
  expect(r.data.sites.sites.map((s) => s.siteId)).toEqual(['lc:hwy:1', 'lc:hwy:2', 'lc:hwy:3']);
});
it('no-scenario when the manifest has no scenarios.lesscars', async () => {
  expect((await loadLessCars('fixture-0', fixtureFetch({ dropLessCars: true }))).state).toBe('no-scenario');
});
it('error on a 404, a bad file, or a datasetVersion mismatch', async () => {
  for (const f of [fixtureFetch({ status: { 'summary.json': 404 } }),
                   fixtureFetch({ patch: { 'plan.json': (j) => ({ ...j, format: 'x' }) } }),
                   fixtureFetch({ patch: { 'sites.json': (j) => ({ ...j, datasetVersion: 'other' }) } })])
    expect((await loadLessCars('fixture-0', f)).state).toBe('error');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project server src/lib/lesscars/load.spec.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `loadLessCars` in `src/lib/lesscars/load.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project server src/lib/lesscars/load.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lesscars/load.ts src/lib/lesscars/load.spec.ts
git commit -m "feat(lesscars): load the page's manifest, calibration and plan files"
```

---

### Task 3: Plan to day-stamped map features (pure)

**Files:**
- Create: `src/lib/lesscars/features.ts`
- Test: `src/lib/lesscars/features.spec.ts`

**Interfaces:**
- Consumes: `LessCarsPlanFile`, `LessCarsSitesFile` (codec), `LaneUse`, `TransitMode`, `PlanProject` (`plan.ts`), `OPEN_DAY` (`src/lib/timelapse/time.ts:24`), `geojson` types.
- Produces:

```ts
export type StreetState = 'works' | 'transit' | 'bike' | 'pedestrian' | 'removed' | 'grade';
export const STREET_STATES: readonly StreetState[]; // map-key order
/** Every feature is shown on days d with from <= d < to; `to` is OPEN_DAY when it never ends. */
export interface Span { from: Day; to: Day; project: string }
export type StreetProps = Span & { state: StreetState; segment: string }; // 'cnn:<cnn>' | 'line:<projectId>:<k>'
export type LineProps = Span & { mode: TransitMode | 'shuttle'; building: 0 | 1; label: string };
export type StopProps = Span & { name: string; mode: TransitMode };
export type SiteProps = Span & { siteId: string };
export type GarageProps = Span & { building: 0 | 1; label: string; spaces: number };
export interface Reservation { parcelId: ParcelId; kept: boolean }

export function laneState(lanes: readonly LaneUse[]): StreetState | null;
export function streetFeatures(f: LessCarsPlanFile): FeatureCollection<LineString, StreetProps>;
export function lineFeatures(f: LessCarsPlanFile): FeatureCollection<LineString, LineProps>;
export function stopFeatures(f: LessCarsPlanFile): FeatureCollection<Point, StopProps>;
export function siteFeatures(f: LessCarsPlanFile, s: LessCarsSitesFile): FeatureCollection<Polygon, SiteProps>;
export function garageFeatures(
  f: LessCarsPlanFile,
  s: LessCarsSitesFile,
  places: Readonly<Record<ParcelId, [number, number]>>,
  reservations: readonly Reservation[]
): FeatureCollection<Point, GarageProps>;
/** Sorted unique `from` and `to` days (OPEN_DAY excluded) of all given collections. */
export function eventDays(...fcs: FeatureCollection<Geometry, Span>[]): Day[];
/** How many event days are <= day: equal epochs show identical maps. */
export function epochOf(days: readonly Day[], day: Day): number;
```

Rules (times from `f.times`, by project id):

- `laneState`: no `car` lane: `pedestrian` if it has `pedestrian`, else `transit` if `bus` or `tram`, else `bike` if `bike`, else `pedestrian` (sidewalk or service only). With `car`: `transit` if `bus` or `tram`, else `bike` if `bike`, else `null` (no change drawn).
- Street events per segment key (`cnn:<cnn>`, or `line:<projectId>:<k>` for a drawn segment): `bus-lane` and `tram-priority`: `works` at start, `transit` at open. `street-change`: `works` at start, `laneState(lanes)` at open (null ends the drawing). `street-removal` and `highway-truncation`: `works` at start, `removed` at open. A display: `grade` at the open day of `from`. Events on one key are ordered by day, then plan order (displays after projects); each event's state lasts until the next event on that key; a null state draws nothing. One feature per (CNN line or drawn line) per interval, `project` = the event's project. A CNN missing from `f.segments` is skipped (the pipeline guarantees it; no throw).
- Lines: each `transit-line` alignment, and each `car-shuttle` alignment as mode `shuttle`: `building: 1` on `[start, open)`, `building: 0` on `[open, OPEN_DAY)`.
- Stops: each `transit-line` stop with `lngLat` (an `lc:` stop) on `[open, OPEN_DAY)`; a stop id defined by two lines appears once, from the earlier opening.
- Sites: each site's outline from its project's `availableDay` to `OPEN_DAY`.
- Garages: `{ project }` site: the centre of the bounding box of that project's site outlines (none carved: no feature); `{ parcel }` site: `places[parcel]`, only when `reservations` has that parcel with `kept: true` (voided, or not yet known: no feature). `building: 1` on `[start, open)`, `0` from open.
- No feature carries homes; amenities are geometry only.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/lesscars/features.spec.ts — the fixture plan.json and sites.json from fixture-0
const T = (id: string) => planFile.times.find((t) => t.id === id)!;
const stateAt = (fc, key: (p) => boolean, d: Day) =>
  fc.features.filter((x) => key(x.properties) && x.properties.from <= d && d < x.properties.to)
    .map((x) => x.properties.state);

it('laneState follows the priority rule', () => {
  expect(laneState(['bus', 'bike', 'sidewalk'])).toBe('transit');
  expect(laneState(['pedestrian', 'bus'])).toBe('pedestrian');
  expect(laneState(['bike', 'sidewalk'])).toBe('bike');
  expect(laneState(['sidewalk', 'service'])).toBe('pedestrian');
  expect(laneState(['car', 'bike', 'sidewalk'])).toBe('bike');
  expect(laneState(['car', 'sidewalk'])).toBeNull();
});
it('a removal is works from its start and removed from its open, nothing before', () => {
  const fc = streetFeatures(planFile);
  const hwy = (p: StreetProps) => p.project === 'hwy';
  expect(stateAt(fc, hwy, T('hwy').startDay - 1)).toEqual([]);
  expect(new Set(stateAt(fc, hwy, T('hwy').startDay))).toEqual(new Set(['works']));
  expect(new Set(stateAt(fc, hwy, T('hwy').openDay))).toEqual(new Set(['removed']));
});
it('a later project on the same CNN replaces the earlier state (1001: buslane, then ped)', () => {
  const fc = streetFeatures(planFile);
  const at1001 = (d: Day) =>
    fc.features.filter((x) => x.properties.segment === 'cnn:1001' && x.properties.from <= d && d < x.properties.to)
      .map((x) => `${x.properties.project}:${x.properties.state}`);
  expect(new Set(at1001(T('buslane').openDay))).toEqual(new Set(['buslane:transit']));
  expect(new Set(at1001(T('ped').startDay))).toEqual(new Set(['ped:works']));
  expect(new Set(at1001(T('ped').openDay))).toEqual(new Set(['ped:transit']));
  expect(fc.features.every((x) => x.properties.from < x.properties.to)).toBe(true);
});
it('a drawn segment (tram priority) is keyed by project and index', () => {
  expect(streetFeatures(planFile).features.some((x) => x.properties.segment === 'line:tram:0')).toBe(true);
});
it('the display is grade from its project opening', () => {
  const g = streetFeatures(planFile).features.filter((x) => x.properties.state === 'grade');
  expect(g.length).toBeGreaterThan(0);
  expect(g.every((x) => x.properties.from === T('subway').openDay)).toBe(true);
});
it('lines are building until open; stops only from open', () => {
  const l = lineFeatures(planFile).features.filter((x) => x.properties.project === 'subway');
  expect(l.map((x) => [x.properties.building, x.properties.from])).toEqual([
    [1, T('subway').startDay], [0, T('subway').openDay]
  ]);
  expect(stopFeatures(planFile).features.every((x) => x.properties.from === T(x.properties.project).openDay)).toBe(true);
  expect(lineFeatures(planFile).features.some((x) => x.properties.mode === 'shuttle')).toBe(true);
});
it('sites appear on their project availableDay', () => {
  expect(siteFeatures(planFile, sitesFile).features.map((x) => x.properties.from))
    .toEqual([T('hwy').availableDay, T('hwy').availableDay, T('hwy').availableDay]);
});
it('a garage on a parcel is drawn only when its reservation was kept', () => {
  const places = { '3512015': [-122.418, 37.76] as [number, number] };
  expect(garageFeatures(planFile, sitesFile, places, [{ parcelId: '3512015', kept: true }]).features).toHaveLength(2);
  expect(garageFeatures(planFile, sitesFile, places, [{ parcelId: '3512015', kept: false }]).features).toHaveLength(0);
  expect(garageFeatures(planFile, sitesFile, places, []).features).toHaveLength(0);
});
it('epochOf counts event days at or before the day', () => {
  const days = [10, 20, 30];
  expect([9, 10, 19, 20, 31].map((d) => epochOf(days, d))).toEqual([0, 1, 1, 2, 3]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project server src/lib/lesscars/features.spec.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the functions in `src/lib/lesscars/features.ts`**

Relative-free `$lib` imports are fine here (page module). `epochOf` is a binary search (upper bound).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project server src/lib/lesscars/features.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lesscars/features.ts src/lib/lesscars/features.spec.ts
git commit -m "feat(lesscars): derive day-stamped street, transit, site and garage features"
```

---

### Task 3b: Palette tokens and the MapLibre layers

**Files:**
- Modify: `src/lib/map/palette.ts:6-36` (`TokenName`), `TOKENS` both themes; `src/lib/map/palette.spec.ts`
- Create: `src/lib/lesscars/map-layers.ts`, `src/lib/lesscars/legend.ts`
- Test: `src/lib/lesscars/map-layers.spec.ts`

**Interfaces:**
- Consumes: Task 3's collections and `eventDays`/`epochOf`; `BUILDINGS_LAYER`, `OVERLAY_ANCHOR`, `firstSymbolLayerId` (`src/lib/map/style.ts:15,18,364`); `TOKENS`, `Theme`.
- Produces (palette): tokens `lc-works`, `lc-transit`, `lc-bike`, `lc-pedestrian`, `lc-removed`, `lc-grade`, `lc-line-subway`, `lc-line-tram`, `lc-line-brt`, `lc-shuttle`, `lc-garage`, `lc-site` in both themes.
- Produces (layers):

```ts
export interface LessCarsLayerData {
  streets: FeatureCollection<LineString, StreetProps>;
  lines: FeatureCollection<LineString, LineProps>;
  stops: FeatureCollection<Point, StopProps>;
  sites: FeatureCollection<Polygon, SiteProps>;
  garages: FeatureCollection<Point, GarageProps>;
}
export type LayerMap = Pick<
  MapLibreMap,
  'addSource' | 'addLayer' | 'getLayer' | 'getSource' | 'setFilter' | 'setPaintProperty' | 'getStyle'
>;
export interface LessCarsLayers {
  /** O(log n); calls setFilter only when epochOf(day) changes. */
  setDay(day: Day): void;
  setTheme(theme: Theme): void;
  /** Replaces one source's data (garages arrive once the worker has loaded) and refreshes the event days. */
  setData<K extends keyof LessCarsLayerData>(key: K, fc: LessCarsLayerData[K]): void;
}
export const LC_STREET_LAYER: Record<StreetState, string>; // 'lc-street-works', …
export const LC_LAYER_IDS: readonly string[]; // every layer id, in stack order
export function installLessCarsLayers(map: LayerMap, data: LessCarsLayerData, theme: Theme, day: Day): LessCarsLayers;
```

```ts
// legend.ts
export interface LegendRow { id: string; label: string; token: TokenName; kind: 'line' | 'disc' | 'square' | 'fill'; dash: number[] | null }
export const LESSCARS_LEGEND: readonly LegendRow[];
```

Rules: sources `lc-streets`, `lc-lines`, `lc-stops`, `lc-sites`, `lc-garages` (GeoJSON). One line layer per street state (MapLibre `line-dasharray` is not data-driven) filtered `['==', ['get', 'state'], s]`; sites (fill + outline) and street layers before `BUILDINGS_LAYER`; plan lines before `firstSymbolLayerId(map.getStyle())`; stops (circles plus a `symbol` name label from zoom 14, `text-font: ['NotoSans-Regular']`) and garages (square-ish circle plus a "P" `symbol`) before `OVERLAY_ANCHOR`. Every layer's filter is `['all', <own filter>, ['<=', ['get', 'from'], d], ['<', d, ['get', 'to']]]` where `d` is the current epoch's start day (`days[epoch - 1]`, or `-1` at epoch 0), so every day in one epoch yields the same filter. Legend labels (exact copy): "Works under way", "Buses and trams only", "Bike lanes", "Pedestrian street", "Removed: now land", "Underpass filled", "New subway", "New tram", "New rapid bus", "Car shuttle", "Plan stop", "Edge garage", "Freed land". Styling (widths, dashes, colours) is the builder's call within: each street state differs from every other by dash or width, not only colour.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/map/palette.spec.ts
const LC_STREETS = ['lc-works', 'lc-transit', 'lc-bike', 'lc-pedestrian', 'lc-removed', 'lc-grade'] as const;
const LC_MARKS = ['lc-line-subway', 'lc-line-tram', 'lc-line-brt', 'lc-shuttle', 'lc-garage'] as const;
it(`${theme}: lesscars marks reach 3:1 against land and road (SC 1.4.11)`, () => {
  for (const id of [...LC_STREETS, ...LC_MARKS])
    for (const base of ['land', 'road'] as const)
      expect(contrast(TOKENS[theme][id], TOKENS[theme][base]), `${id}/${base}`).toBeGreaterThanOrEqual(3);
});
it(`${theme}: street states are distinct (ΔE2000 ≥ 8)`, () => {
  for (let i = 0; i < LC_STREETS.length; i++)
    for (let j = i + 1; j < LC_STREETS.length; j++)
      expect(de(parse(TOKENS[theme][LC_STREETS[i]])!, parse(TOKENS[theme][LC_STREETS[j]])!)).toBeGreaterThanOrEqual(8);
});

// src/lib/lesscars/map-layers.spec.ts — a recording fake LayerMap (getStyle returns a style
// with a symbol layer and the BUILDINGS_LAYER/OVERLAY_ANCHOR ids)
it('installs every source and layer once, in stack order', () => {
  const m = fakeMap();
  installLessCarsLayers(m, data, 'light', LESSCARS_START);
  expect(m.sources).toEqual(['lc-streets', 'lc-lines', 'lc-stops', 'lc-sites', 'lc-garages']);
  expect(m.layers.map((l) => l.id)).toEqual([...LC_LAYER_IDS]);
});
it('every street-state layer has a dash or width no other has', () => {
  const sig = Object.values(LC_STREET_LAYER).map((id) => JSON.stringify([
    m.layer(id).paint['line-dasharray'] ?? null, m.layer(id).paint['line-width']]));
  expect(new Set(sig).size).toBe(sig.length);
});
it('setDay refilters only on an epoch change, forwards and backwards', () => {
  const l = installLessCarsLayers(m, data, 'light', LESSCARS_START);
  m.filterCalls = 0;
  l.setDay(LESSCARS_START + 1); // same epoch
  expect(m.filterCalls).toBe(0);
  l.setDay(T('hwy').openDay);
  expect(m.filterCalls).toBe(LC_LAYER_IDS.length);
  l.setDay(LESSCARS_START); // back: filters restored to epoch 0
  expect(m.lastFilter('lc-street-removed')).toEqual(m.initialFilter('lc-street-removed'));
});
it('setTheme repaints with the other theme', () => {
  l.setTheme('dark');
  expect(m.paint('lc-street-transit', 'line-color')).toBe(TOKENS.dark['lc-transit']);
});
it('setData on garages replaces the source data and its days count in the epochs', () => {
  l.setData('garages', garages);
  expect(m.sourceData('lc-garages')).toBe(garages);
});
it('the legend has a row per street state and mark, each with a token', () => {
  expect(LESSCARS_LEGEND.map((r) => r.label)).toContain('Removed: now land');
  expect(LESSCARS_LEGEND.every((r) => r.token in TOKENS.light)).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project server src/lib/map/palette.spec.ts src/lib/lesscars/map-layers.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Add the tokens, then implement `installLessCarsLayers` and `LESSCARS_LEGEND`**

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --project server src/lib/map/palette.spec.ts src/lib/lesscars/map-layers.spec.ts`
Expected: PASS (all existing palette tests too).

- [ ] **Step 5: Commit**

```bash
git add src/lib/map/palette.ts src/lib/map/palette.spec.ts src/lib/lesscars/map-layers.ts src/lib/lesscars/map-layers.spec.ts src/lib/lesscars/legend.ts
git commit -m "feat(lesscars): map layers for street states, plan transit, garages and freed land"
```

---

### Task 4: The worker playback host

**Files:**
- Create: `src/lib/sim/lesscars/types.ts`, `src/lib/sim/lesscars/builds.ts`, `src/lib/sim/lesscars/playback-host.ts`
- Modify: `src/lib/sim/scenario/types.ts:196` (`WorkerRequest`), `src/lib/sim/router.ts`, `src/lib/sim/worker.ts`
- Test: `src/lib/sim/lesscars/builds.spec.ts`, `src/lib/sim/lesscars/playback-host.spec.ts`, `src/lib/sim/worker-router.spec.ts`

**Interfaces:**
- Consumes: `decodeTimelinePayload`, `InitiativeBuild`, `LessCarsPlanFile`, `LessCarsSitesFile` (codec, with Task 1's `reservations`); `loadScenario`, `scenarioUrls`, `datasetUrl`, `fetchWithRetry` (`src/lib/sim/scenario/load.ts:244,104,93,176`); `inflateRawBody` (`src/lib/data/column-file.ts:181`); `createChunkLoader`, `cellsIntersecting` (`src/lib/sim/chunks.ts`); `createGeometry` (`src/lib/sim/scenario/geometry.ts:77`); `packTimedCell`, `packTimedTransferables` (`src/lib/map/pack-timed.ts`); `generate`, `generateForUnits`, `fnv1a32` (`$lib/generator`); `blockLot`, `revisionAt` (`src/lib/sim/scenario/card.ts:34,77`); `checkManifestShape` (`src/lib/sim/manifest-shape.ts`); `createLru`, `MEMO_CAP`, `SLICE_PLAN_MS` (`scenario-host.ts:187-204`).
- Produces (`types.ts`):

```ts
export interface PlaybackCard {
  projectId: string;
  kind: 'market' | 'freed' | 'parking';
  /** The plan project's label for an initiative build; null for a market project. */
  planLabel: string | null;
  /** 'Block B, Lot L' (blockLot) of the first parcel; the site id for freed land. */
  where: string;
  units: number;
  existingUnits: number;
  stories: number | null;
  status: 'planning' | 'construction' | 'complete' | 'stopped';
  constructionDay: Day | null;
  completeDay: Day | null;
}
export type PlaybackRequest =
  | { type: 'initPlayback'; rev: Rev; manifest: Manifest; plan: LessCarsPlanFile; sites: LessCarsSitesFile }
  | { type: 'playbackCard'; reqId: number; projectId: string; day: Day };
export type PlaybackResponse =
  | {
      type: 'playbackLoaded';
      rev: Rev;
      seed: number;
      /** Label points of every parcel the plan names (parking and garage parcels) in parcels.bin. */
      places: Record<ParcelId, [number, number]>;
      reservations: { parcelId: ParcelId; kept: boolean }[];
    }
  | { type: 'playback'; rev: Rev; render: TimelineUpdate; complete: boolean }
  | { type: 'playbackCard'; reqId: number; card: PlaybackCard | null };
```

  `WorkerRequest` becomes `SimRequest | ScenarioRequest | PlaybackRequest`. Errors reuse the scenario `error` response (`ScenarioErrorCode`); `ready` and `chunks` are reused as is.
- Produces (`builds.ts`):

```ts
export const SITES_CELL = 'lc-sites';
export const BUILD_PREFIX = 'lc-build:';
/** A drawable Schedule for one initiative build: id BUILD_PREFIX + siteId, origin 'simulated',
 *  parcelIds [parcelId], pathway 'permitOnly', entered { construction: startDay, complete:
 *  completeDay } (complete only if <= horizon), end complete or open, one revision
 *  { day: startDay, units, stories }, existingUnits = existing, no phase. */
export function buildSchedule(b: InitiativeBuild, parcelId: ParcelId, horizon: Day): Schedule;
/** The freed-site building: gen(rec, { maxStories: b.stories }, fnv1a32(b.siteId), 'max'),
 *  stamped source 'scenario'; a null or throwing generator gives the outline's footprint. */
export function freedMassing(b: InitiativeBuild, rec: ParcelRecord, gen: typeof generate): Massing;
export type CardEntry =
  | { kind: 'market'; schedule: Schedule }
  | { kind: 'freed' | 'parking'; schedule: Schedule; build: InitiativeBuild; planLabel: string };
export function playbackCard(e: CardEntry, day: Day): PlaybackCard | null; // null when not visible at day (isVisible)
```

  Status at `day`: `stopped` for an exit on or before day; `complete` on or after completion; `construction` from `entered.construction`; else `planning`. Units and stories at `revisionAt(schedule, day)`.
- Produces (`playback-host.ts`):

```ts
export type PlaybackHostRequest =
  | PlaybackRequest
  | Extract<SimRequest, { type: 'prefetch' | 'retryChunks' }>;
export interface PlaybackHostDeps {
  fetch: FetchLike; fetchBytes: FetchBytesLike;
  post(msg: PlaybackResponse | ScenarioResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; now(): number;
  generate?: typeof generate; generateForUnits?: typeof generateForUnits;
  retryDelaysMs?: readonly number[]; maxConcurrent?: number; warn?(msg: string): void;
  decodeParcels?(bytes: Uint8Array): Promise<ScenarioParcels>;
}
export function createPlaybackHost(deps: PlaybackHostDeps): { handle(r: PlaybackHostRequest): void; dispose(): void };
```

Host behaviour (one session per `initPlayback`, superseded by the next or by `dispose`, with a cancellation token like `scenario-host.ts:161-184`):

1. Validate: `checkManifestShape`; FZP urls (`scenarioUrls`) and `datasetUrl(manifest, manifest.scenarios?.lesscars?.timeline)`; missing → `error` `scenario-missing`; `plan.datasetVersion` or `sites.datasetVersion` ≠ manifest's → `bad-request`. Post `ready` (as `scenario-host.ts:443-448`).
2. Load in parallel: `loadScenario(…, urls, cancelled)` (no policy) and `timeline.bin` bytes via `fetchWithRetry`; then `inflateRawBody` and `decodeTimelinePayload(bytes, parcels)` (a throw → `scenario-invalid`, `timeline.bin: <message>`).
3. Entries: every timeline schedule (`market`); each build with a `parcelRow` (`parking`, parcel `parcels.id[row]`, schedule `buildSchedule`); each build without (`freed`, its site from `sites` by `siteId`; a missing site is warned once and skipped). Plan labels from `plan.plan.projects`.
4. Post `playbackLoaded` (`seed`, `places` from `parcels.labelPoint` for each `parking-conversion` parcel and `edge-garage` `{ parcel }` present in `parcels.bin`, `reservations` mapped row → id).
5. Geometry: `createGeometry` over market and parking schedules (massing ctx with the session memo, `gen`, `genForUnits`). Revision 0: the `lc-sites` cell (`packTimedCell(SITES_CELL, freedItems)`, pick parcel = site id; omitted when there are no freed builds) plus every packable cell; `demolish` = `geometry.demolish()` merged with each kept parking reservation's parcel at its conversion project's `startDay` (the earlier day wins). Later: each ready chunk (`onRecords`) schedules a `setTimeout(0)` slice that packs packable cells while `now() − sliceStart` plus the last pack cost fits `SLICE_PLAN_MS`, and posts one `playback` revision with those cells, `removedCells: []`, `demolish: []`. `complete` = `geometry.complete()`.
6. `prefetch(bbox)`: wanted cells plus `geometry.cellsFor` (as `scenario-host.ts:478-485`). `retryChunks` forwards to the loader. `playbackCard`: the entry by `projectId` → `playbackCard(entry, day)`; unknown id, no session or not loaded → `card: null`.

Router (`router.ts`): a third lazily created host (`deps.createPlayback`). `initPlayback`: mode `'playback'`, `deps.editor.dispose()`, scenario disposed, playback handles it. `initScenario` and `init` dispose the playback host. `prefetch`/`retryChunks` go to the host of the current mode. `playbackCard` outside playback mode posts `{ type: 'playbackCard', reqId, card: null }`. `parcelSummary` in playback mode posts `{ type: 'parcelSummary', reqId, summary: null }`. Brush and lever requests in playback mode get the existing `no-session` answers. `worker.ts` wires `createPlayback: () => createPlaybackHost({ … same deps as the scenario host … })` and widens `Scope.postMessage`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sim/lesscars/builds.spec.ts
const b: InitiativeBuild = { siteId: 'lc:hwy:1', projectId: 'hwy', parcelRow: null, units: 40,
  stories: 5, existing: 0, startDay: 24472, completeDay: 25385 };
it('buildSchedule is a simulated, permit-only schedule from build start to completion', () => {
  const s = buildSchedule(b, 'lc:hwy:1', LESSCARS_HORIZON);
  expect(s).toMatchObject({ projectId: 'lc-build:lc:hwy:1', origin: 'simulated', parcelIds: ['lc:hwy:1'],
    pathway: 'permitOnly', entered: { construction: 24472, complete: 25385 },
    end: { kind: 'complete', day: 25385 }, revisions: [{ day: 24472, units: 40, stories: 5 }] });
  expect(buildSchedule({ ...b, completeDay: LESSCARS_HORIZON + 10 }, 'lc:hwy:1', LESSCARS_HORIZON).end)
    .toEqual({ kind: 'open' });
});
it('freedMassing falls back to the outline when the generator gives nothing', () => {
  expect('footprint' in freedMassing(b, site.rec, () => null)).toBe(true);
});
it('playbackCard reads status and plan label at the day', () => {
  const e: CardEntry = { kind: 'freed', schedule: buildSchedule(b, 'lc:hwy:1', LESSCARS_HORIZON), build: b, planLabel: 'I-80 truncation' };
  expect(playbackCard(e, 24472)).toMatchObject({ kind: 'freed', planLabel: 'I-80 truncation', status: 'construction', units: 40 });
  expect(playbackCard(e, 25385)?.status).toBe('complete');
  expect(playbackCard(e, 24471)).toBeNull();
});

// src/lib/sim/lesscars/playback-host.spec.ts — fixture-0 files served by a fake fetch, a manual
// clock and timers (the scenario-host spec harness pattern), the real generator
it('initPlayback posts ready, playbackLoaded with places and reservations, then revision 0', async () => {
  const h = harness(); h.init();
  await h.settle();
  expect(h.posted('ready')).toHaveLength(1);
  const loaded = h.posted('playbackLoaded')[0];
  expect(loaded.seed).toBe(summary.representativeSeed);
  expect(loaded.reservations.map((r) => r.parcelId).sort()).toEqual(['3512015', '3512017']);
  expect(Object.keys(loaded.places).sort()).toEqual(['3512015', '3512017']);
  const r0 = h.posted('playback')[0].render;
  expect(r0.revision).toBe(0);
  expect(r0.cells.map((c) => c.cellId)).toContain(SITES_CELL);
});
it('the sites cell holds one slot per kept freed build', async () => {
  const cell = (await h.revision0()).cells.find((c) => c.cellId === SITES_CELL)!;
  expect(cell.slotProjectIds).toEqual(timeline.builds.filter((x) => x.parcelRow === null).map((x) => `lc-build:${x.siteId}`).sort());
});
it('chunk cells pack after prefetch, one revision per slice, demolish only in revision 0', async () => {
  h.prefetch(fixtureBBox); await h.settle();
  const later = h.posted('playback').slice(1);
  expect(later.length).toBeGreaterThan(0);
  expect(later.every((p) => p.render.demolish.length === 0)).toBe(true);
  expect(later.at(-1)!.complete).toBe(true);
});
it('a kept parking build is drawn and its lot demolished at the conversion start; a voided one is not', async () => {
  // fixture: read the decoded timeline's reservation for 3512017 and branch on it; also run a
  // patched timeline with that reservation flipped to voided and its build removed
  expect(slotIds(await h.allCells())).toContain('lc-build:3512017'); // kept case
  expect(slotIds(await voided.allCells())).not.toContain('lc-build:3512017');
  expect((await voided.revision0()).demolish.map((d) => d.parcelId)).not.toContain('3512017');
});
it('playbackCard answers a freed build and null for an unknown id', async () => {
  expect((await h.card(`lc-build:lc:hwy:1`, LESSCARS_HORIZON))?.kind).toBe('freed');
  expect(await h.card('nope', LESSCARS_HORIZON)).toBeNull();
});
it('errors: no lesscars scenario, a mismatched plan, a corrupt timeline', async () => {
  expect((await harness({ dropTimeline: true }).initAndSettle()).posted('error')[0].code).toBe('scenario-missing');
  expect((await harness({ planVersion: 'x' }).initAndSettle()).posted('error')[0].code).toBe('bad-request');
  expect((await harness({ timelineBytes: new Uint8Array([1, 2]) }).initAndSettle()).posted('error')[0].code).toBe('scenario-invalid');
});
it('a second initPlayback supersedes the first: nothing more from the old session', async () => {
  h.init(); h.init(); await h.settle();
  expect(new Set(h.posted('playback').map((p) => p.rev))).toEqual(new Set([2]));
});

// src/lib/sim/worker-router.spec.ts
it('initPlayback disposes the editor and scenario hosts and routes prefetch to playback', () => { … expect(calls).toEqual([...]) });
it('playbackCard outside playback mode answers card null', () => { … expect(posted).toEqual([{ type: 'playbackCard', reqId: 1, card: null }]) });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project server src/lib/sim/lesscars src/lib/sim/worker-router.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `types.ts` and `builds.ts`; run the builds spec to PASS**

Run: `npx vitest run --project server src/lib/sim/lesscars/builds.spec.ts`

- [ ] **Step 4: Implement `createPlaybackHost`, the router and the worker wiring**

Worker-bundle rules apply (`scenario-host.ts:4`): no zod, no DOM, no `$app`; the geometry module's determinism lint applies to anything it calls.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run --project server src/lib/sim`
Expected: PASS, existing host and router specs included.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sim/lesscars src/lib/sim/router.ts src/lib/sim/worker.ts src/lib/sim/scenario/types.ts src/lib/sim/worker-router.spec.ts
git commit -m "feat(lesscars): worker playback host for the stored representative future"
```

---

### Task 5: The playback client

**Files:**
- Create: `src/lib/sim/lesscars/playback-client.ts`
- Test: `src/lib/sim/lesscars/playback-client.spec.ts`

**Interfaces:**
- Consumes: Task 4's request and response types; `ScenarioWorkerInput`, `ScenarioWorkerLike` (`src/lib/sim/scenario-client.ts:21-35`); `ReadyResponse`, `ChunksResponse`, `ScenarioErrorResponse`.
- Produces:

```ts
export interface PlaybackClientEvents {
  onReady?(r: ReadyResponse): void;
  onLoaded?(r: Extract<PlaybackResponse, { type: 'playbackLoaded' }>): void;
  /** Current-rev revisions only. */
  onTimeline?(r: Extract<PlaybackResponse, { type: 'playback' }>): void;
  onChunks?(c: ChunksResponse): void;
  /** Current-rev errors only. */
  onError?(e: ScenarioErrorResponse): void;
  onCrash?(e: Event): void;
}
export class PlaybackClient {
  constructor(worker: ScenarioWorkerInput, events: PlaybackClientEvents);
  /** Sends initPlayback with a new rev; later responses of older revs are dropped. */
  init(manifest: Manifest, plan: LessCarsPlanFile, sites: LessCarsSitesFile): Rev;
  /** SimMap's revision gap: re-sends initPlayback with the last arguments and a new rev, at most
   *  once until a current-rev revision 0 arrives. */
  resync(): void;
  prefetch(bbox: BBox): void;
  retryChunks(): void;
  /** Resolves null on crash, restart or dispose. */
  card(projectId: string, day: Day): Promise<PlaybackCard | null>;
  restart(worker: ScenarioWorkerInput): void; // terminates the old worker; the caller calls init again
  dispose(): void;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sim/lesscars/playback-client.spec.ts — a fake worker recording postMessage
it('drops responses from an older init', () => {
  const c = new PlaybackClient(w, { onTimeline }); c.init(m, plan, sites); c.init(m, plan, sites);
  w.emit({ type: 'playback', rev: 1, render, complete: true });
  w.emit({ type: 'playback', rev: 2, render, complete: true });
  expect(onTimeline.mock.calls.map(([r]) => r.rev)).toEqual([2]);
});
it('resync re-sends initPlayback once per episode', () => {
  c.init(m, plan, sites); c.resync(); c.resync();
  expect(w.sent.filter((x) => x.type === 'initPlayback').map((x) => x.rev)).toEqual([1, 2]);
});
it('card resolves with the answer, and null on crash', async () => {
  const p = c.card('lc-build:lc:hwy:1', 25000);
  w.emit({ type: 'playbackCard', reqId: w.lastReqId(), card });
  expect(await p).toBe(card);
  const q = c.card('x', 1); w.crash();
  expect(await q).toBeNull();
  expect(onCrash).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run --project server src/lib/sim/lesscars/playback-client.spec.ts` → FAIL.
- [ ] **Step 3: Implement `PlaybackClient`** (structure after `ScenarioClient`: `#rev`, pending card map keyed by `reqId`, `onerror`/`onmessageerror` → crash).
- [ ] **Step 4: Run to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/lesscars/playback-client.ts src/lib/sim/lesscars/playback-client.spec.ts
git commit -m "feat(lesscars): main-thread playback client"
```

---

### Task 6: Headline, breakdown and chart

**Files:**
- Create: `src/lib/lesscars/summary-view.ts`, `src/lib/lesscars/copy.ts`, `src/lib/lesscars/HeadlineBar.svelte`, `src/lib/lesscars/DetailsPanel.svelte`, `src/lib/lesscars/ExtraChart.svelte`
- Test: `src/lib/lesscars/summary-view.spec.ts`, `src/lib/lesscars/HeadlineBar.svelte.spec.ts`, `src/lib/lesscars/DetailsPanel.svelte.spec.ts`

**Interfaces:**
- Consumes: `LessCarsSummary`, `SOURCES`, `Source` (codec); `formatCount` (`src/lib/scoreboard/format.ts:13`); `niceCeil` (`src/lib/fzp/chart.ts:72`); `headerOverlay` (`src/lib/shell/header-actions.svelte.ts`); `LESSCARS_LEGEND` (Task 3b); `TOKENS`, `useSystemTheme`.
- Produces (`summary-view.ts`):

```ts
export const SOURCE_LABEL: Record<Source, string>; // 'Freed land', 'Parking sites', 'Transit-unlocked', 'Other'
export function signed(n: number): string; // '+1,234', '−56' (U+2212), '0'
export function finalYear(s: LessCarsSummary): number; // UTC year of the last year end
export function headlineText(s: LessCarsSummary): string;
export function headlineName(s: LessCarsSummary): string;
export function bandText(s: LessCarsSummary): string;
/** Largest-remainder rounding: integers, each within 1 of its part, summing to Math.round(total). */
export function roundedParts(parts: readonly number[], total: number): number[];
export function breakdownRows(s: LessCarsSummary): { source: Source; label: string; homes: number }[];
export function yearIndexAt(s: LessCarsSummary, day: Day): number; // the year end bucket at or after day, clamped
export interface ExtraChartModel { years: number[]; mean: number[]; p10: number[]; p90: number[]; yMin: number; yMax: number }
export function extraChartModel(s: LessCarsSummary): ExtraChartModel; // yMax = niceCeil(max), yMin = 0 or -niceCeil(-min)
```

Exact copy (`copy.ts`): with `n = Math.round(mean at the last year)` and year `Y`: `headlineText` is `"+${n} homes by ${Y}"` for n > 0, `"−${|n|} homes by ${Y}"` for n < 0, `"No extra homes by ${Y}"` for 0 (counts through `formatCount`). `headlineName`: `"The plan adds ${n} homes by ${Y} compared with no plan. Show details"` (n > 0), `"The plan has ${|n|} fewer homes by ${Y} than no plan. Show details"` (n < 0), `"The plan adds no homes by ${Y} compared with no plan. Show details"` (0). `bandText`: `"Middle 80% of ${seeds} paired futures: ${signed(p10)} to ${signed(p90)}"`. Amenities sentence: `"Wider sidewalks, bike lanes, pedestrian streets and the car shuttle are on the map but add no homes, so they are not counted here."` Breakdown caption: `"Where the extra homes come from, ${Y}"`.

- Produces (components):
  - `HeadlineBar.svelte` props `{ summary: LessCarsSummary; panel: Snippet }`: one button (`data-testid="lc-headline"`, visible `headlineText`, `aria-label` `headlineName`, `aria-expanded`, `aria-controls`) that opens the details region (`role="region"`, name "Fewer-cars details", `data-testid="lc-details"`): popover at the top right from 768 px, full-width disclosure below; closes on Escape, outside press, or another header overlay (`headerOverlay`); restores focus to the button only when focus was inside. The behaviour copies `ScoreBar.svelte` (no live region: the text never changes).
  - `DetailsPanel.svelte` props `{ summary: LessCarsSummary; day: Day; onevidence: () => void }`: the headline as a sentence, `bandText`, a `<table>` (caption above; rows from `breakdownRows`, plus a Total row equal to the headline's n), a divergent bar per row (`aria-hidden`), `ExtraChart`, the amenities sentence, a closed `<details>` "Map key" with `LESSCARS_LEGEND` swatches (`aria-hidden` swatches, text labels), and a button "Evidence for every number" calling `onevidence`.
  - `ExtraChart.svelte` props `{ summary: LessCarsSummary; day: Day }`: SVG, `role="img"` with `aria-label` "Extra homes by year: ${signed(first)} in 2028, ${signed(last)} by ${Y}", the mean line, the p10 to p90 band, a zero line when yMin < 0, a vertical marker at `yearIndexAt(day)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/lesscars/summary-view.spec.ts
it('roundedParts sums to the rounded total, negatives included', () => {
  expect(roundedParts([10.4, 10.4, 10.2, 0], 31)).toEqual([11, 10, 10, 0]);
  const r = roundedParts([100.6, -40.3, 12.35, 0.35], 73);
  expect(r.reduce((a, b) => a + b, 0)).toBe(73);
  expect(r.every((x, i) => Math.abs(x - [100.6, -40.3, 12.35, 0.35][i]) < 1)).toBe(true);
});
it('breakdownRows add to the headline number on the fixture and on a fractional summary', () => {
  for (const s of [fixtureSummary, fractional(fixtureSummary, 7)]) {
    const n = Math.round(s.extra.mean.at(-1)!);
    expect(breakdownRows(s).reduce((a, r) => a + r.homes, 0)).toBe(n);
  }
});
it('headline copy for positive, negative and zero', () => {
  expect(headlineText(withFinal(fixtureSummary, 1234.4))).toBe('+1,234 homes by 2068');
  expect(headlineText(withFinal(fixtureSummary, -56.2))).toBe('−56 homes by 2068');
  expect(headlineText(withFinal(fixtureSummary, 0.3))).toBe('No extra homes by 2068');
  expect(headlineName(withFinal(fixtureSummary, -56.2))).toBe('The plan has 56 fewer homes by 2068 than no plan. Show details');
});
it('bandText names the seed count and signed bounds', () => {
  expect(bandText(fixtureSummary)).toBe('Middle 80% of 5 paired futures: +260 to +260');
});
it('extraChartModel reaches below zero only when a value does', () => {
  expect(extraChartModel(fixtureSummary).yMin).toBe(0);
  expect(extraChartModel(withP10(fixtureSummary, -30)).yMin).toBeLessThan(0);
});
it('yearIndexAt clamps to the year ends', () => {
  expect(yearIndexAt(fixtureSummary, LESSCARS_START)).toBe(0);
  expect(yearIndexAt(fixtureSummary, LESSCARS_HORIZON + 99)).toBe(fixtureSummary.yearEnds.length - 1);
});

// src/lib/lesscars/HeadlineBar.svelte.spec.ts (vitest-browser-svelte, as ScoreBar's spec)
it('shows the headline and opens the details region by click, closes on Escape with focus back', async () => {
  const btn = page.getByTestId('lc-headline');
  await expect.element(btn).toHaveTextContent('+260 homes by 2068');
  await expect.element(btn).toHaveAccessibleName('The plan adds 260 homes by 2068 compared with no plan. Show details');
  await btn.click();
  await expect.element(page.getByRole('region', { name: 'Fewer-cars details' })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(btn).toHaveFocus();
});

// src/lib/lesscars/DetailsPanel.svelte.spec.ts
it('the breakdown table rows and total match the headline', async () => {
  const rows = page.getByRole('table', { name: 'Where the extra homes come from, 2068' }).getByRole('row');
  await expect.element(rows.nth(1)).toHaveTextContent('Freed land260');
  await expect.element(rows.last()).toHaveTextContent('Total260');
});
it('Evidence for every number calls onevidence; the map key lists Removed: now land', async () => {
  await page.getByRole('button', { name: 'Evidence for every number' }).click();
  expect(onevidence).toHaveBeenCalledTimes(1);
  await page.getByText('Map key').click();
  await expect.element(page.getByText('Removed: now land')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project server src/lib/lesscars/summary-view.spec.ts`
Run: `npx vitest run --project client src/lib/lesscars/HeadlineBar.svelte.spec.ts src/lib/lesscars/DetailsPanel.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `summary-view.ts` and `copy.ts`; run the server spec to PASS**
- [ ] **Step 4: Implement the three components; run the client specs to PASS**
- [ ] **Step 5: Commit**

```bash
git add src/lib/lesscars/summary-view.ts src/lib/lesscars/summary-view.spec.ts src/lib/lesscars/copy.ts src/lib/lesscars/HeadlineBar.svelte src/lib/lesscars/HeadlineBar.svelte.spec.ts src/lib/lesscars/DetailsPanel.svelte src/lib/lesscars/DetailsPanel.svelte.spec.ts src/lib/lesscars/ExtraChart.svelte
git commit -m "feat(lesscars): headline, source breakdown and extra-homes chart"
```

---

### Task 7: Project timeline and scrubber markers

**Files:**
- Create: `src/lib/lesscars/timeline-view.ts`, `src/lib/lesscars/TimelineDialog.svelte`
- Test: `src/lib/lesscars/timeline-view.spec.ts`, `src/lib/lesscars/TimelineDialog.svelte.spec.ts`

**Interfaces:**
- Consumes: `LessCarsPlanFile`, `ProjectKind`, `TRANSIT_KINDS`; `formatMonthYear` (`src/lib/fzp/format.ts:30`); `Marker` (`src/lib/fzp/types.ts`).
- Produces:

```ts
export type TimelineGroup = 'transit' | 'streets' | 'garages' | 'housing';
export const GROUP_LABEL: Record<TimelineGroup, string>; // 'Transit', 'Streets', 'Garages and shuttle', 'Parking conversions'
export const KIND_LABEL: Record<ProjectKind, string>; // 'New line', 'Tram priority', 'Bus lanes', 'Street change', 'Highway truncation', 'Street removal', 'Parking conversion', 'Edge garage', 'Car shuttle'
export interface TimelineRow {
  id: string; label: string; kind: ProjectKind; group: TimelineGroup;
  startDay: Day; openDay: Day; build: { startDay: Day; completeDay: Day } | null;
}
/** Groups in GROUP_LABEL order; within a group by startDay, then id. Transit kinds → transit;
 *  street-change, removal, truncation → streets; edge-garage, car-shuttle → garages;
 *  parking-conversion → housing. */
export function timelineRows(f: LessCarsPlanFile): TimelineRow[];
/** "SB 79" at switchDay, then each transit-line opening (label = year; same day merged, names
 *  joined), name "Jump to <labels> opening, <Month YYYY>". Markers outside the range are dropped. */
export function scrubberMarkers(f: LessCarsPlanFile, switchDay: Day): Marker[];
```

  `TimelineDialog.svelte` props `{ plan: LessCarsPlanFile; day: Day; onevidence: (projectId: string) => void }` and an exported `show(): void`. A native modal `<dialog>` (`data-testid="lc-timeline"`) with `<h2>` "Project timeline", a sentence "Transit opens first; streets close and homes are built after.", a Close button, and one `<table>` per group (caption = group label, the housing group inside a `<details>` "Parking conversions (N)" when N > 6, builder's call) with columns Project, Starts, Opens, Homes built (build months as "Mon YYYY to Mon YYYY", or "—"), and a last column with an "Evidence" button (`aria-label` "Evidence for <label>"). A bar cell per row over 2028 to 2068 (`aria-hidden`) shows the works span, the build span and a marker at `day`. Focus returns to the opener on close (native dialog).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/lesscars/timeline-view.spec.ts
it('groups rows transit, streets, garages, housing; ordered by start', () => {
  expect(timelineRows(planFile).map((r) => `${r.group}:${r.id}`)).toEqual([
    'transit:subway', 'transit:buslane', 'transit:tram',
    'streets:ped', 'streets:hwy',
    'garages:garage', 'garages:shuttle',
    'housing:parking'
  ]);
});
it('scrubberMarkers: SB 79 first, then line openings by year', () => {
  const m = scrubberMarkers(planFile, summary.switchDay);
  expect(m[0]).toMatchObject({ day: summary.switchDay, label: 'SB 79' });
  expect(m.map((x) => x.label)).toContain(String(new Date(T('subway').openDay * 864e5).getUTCFullYear()));
  expect(new Set(m.map((x) => x.name)).size).toBe(m.length);
});

// src/lib/lesscars/TimelineDialog.svelte.spec.ts
it('lists every project with its dates and opens evidence for one', async () => {
  dialog.show();
  await expect.element(page.getByRole('dialog', { name: 'Project timeline' })).toBeVisible();
  await expect.element(page.getByRole('table', { name: 'Transit' })).toBeVisible();
  await page.getByRole('button', { name: 'Evidence for I-80 truncation' }).click();
  expect(onevidence).toHaveBeenCalledWith('hwy');
});
```

(Use the fixture plan's real labels; read them from the file rather than hard-coding.)

- [ ] **Step 2: Run to verify they fail** — `npx vitest run --project server src/lib/lesscars/timeline-view.spec.ts`; `npx vitest run --project client src/lib/lesscars/TimelineDialog.svelte.spec.ts` → FAIL.
- [ ] **Step 3: Implement `timeline-view.ts`; server spec PASS**
- [ ] **Step 4: Implement `TimelineDialog.svelte`; client spec PASS**
- [ ] **Step 5: Commit**

```bash
git add src/lib/lesscars/timeline-view.ts src/lib/lesscars/timeline-view.spec.ts src/lib/lesscars/TimelineDialog.svelte src/lib/lesscars/TimelineDialog.svelte.spec.ts
git commit -m "feat(lesscars): project timeline dialog and scrubber markers"
```

---

### Task 8: Evidence

**Files:**
- Create: `src/lib/lesscars/evidence.ts`, `src/lib/lesscars/EvidenceDialog.svelte`
- Test: `src/lib/lesscars/evidence.spec.ts`, `src/lib/lesscars/EvidenceDialog.svelte.spec.ts`

**Interfaces:**
- Consumes: `LessCarsPlanFile`, `LessCarsSummary`, `Param`, `Provenance`; `provenanceLines` (`src/lib/fzp/provenance.ts:93`, its first line is `TIER_LABEL[tier]`); `KIND_LABEL` (Task 7).
- Produces:

```ts
export interface EvidenceRow {
  name: string;       // 'Duration', 'Build duration', 'Peak trips per hour', 'Right-of-way half-width', 'Spaces', 'Drawn geometry', 'Concurrent projects'
  value: string;      // '108 months', '24 an hour', '10 m', '1,200 spaces', '4 at once', '' for drawn geometry
  prov: Provenance;
  lines: string[];    // provenanceLines(prov); for the model row, without its "based on N records" line and with "over N paired futures" instead
  invented: boolean;  // tier 4
}
export interface EvidenceSection { id: string; heading: string; rows: EvidenceRow[] }
/** 'ev-model' (the summary's provenance: "How the answer is computed"), 'ev-capacity'
 *  ("Construction capacity": one row per capacity rule, name "<Kind> projects at once"), then one
 *  section per project in plan order, id `ev-${project.id}`, heading `${label} (${KIND_LABEL})`:
 *  durationMonths, then peakTph, rowHalfWidthM, spaces, build.durationMonths, and one
 *  'Drawn geometry' row per drawn segment, as the kind has them. */
export function evidenceSections(f: LessCarsPlanFile, s: LessCarsSummary): EvidenceSection[];
export function evidenceSectionId(projectId: string): string; // `ev-${projectId}`
```

  `EvidenceDialog.svelte` props `{ plan: LessCarsPlanFile; summary: LessCarsSummary }`, exported `show(sectionId?: string): void`: a native modal `<dialog>` (`data-testid="lc-evidence"`), `<h2>` "Evidence for every number", an intro sentence ("Every number in the plan says what kind of evidence it rests on. Numbers marked 'Assumption, not data' are invented and have no source."), one `<section>` per `EvidenceSection` (`<h3 id>` focusable with `tabindex="-1"`), each row: name, value, the provenance lines, source links (as `SourceList.svelte` renders them), and for `invented` rows a visible "Invented" tag. `show(id)` opens, scrolls that heading into view and focuses it.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/lesscars/evidence.spec.ts
it('every Param of every project appears once', () => {
  const n = evidenceSections(planFile, summary).filter((x) => x.id.startsWith('ev-') && !['ev-model', 'ev-capacity'].includes(x.id))
    .reduce((a, x) => a + x.rows.length, 0);
  expect(n).toBe(countParams(planFile.plan)); // durations, tph, half-widths, spaces, build durations, drawn segments
});
it('tier 4 rows are invented and read "Assumption, not data"', () => {
  const rows = evidenceSections(planFile, summary).flatMap((x) => x.rows).filter((r) => r.prov.tier === 4);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.invented && r.lines[0] === 'Assumption, not data')).toBe(true);
});
it('the model section carries the summary provenance and counts futures, not records', () => {
  const m = evidenceSections(planFile, summary)[0];
  expect(m.id).toBe('ev-model');
  expect(m.rows[0].lines).toContain(`over ${summary.seeds} paired futures`);
  expect(m.rows[0].lines.some((l) => l.includes('records'))).toBe(false);
});

// src/lib/lesscars/EvidenceDialog.svelte.spec.ts
it('show(id) opens on that project and focuses its heading', async () => {
  dialog.show('ev-hwy');
  await expect.element(page.getByRole('dialog', { name: 'Evidence for every number' })).toBeVisible();
  await expect.element(page.getByRole('heading', { name: /I-80/ })).toHaveFocus();
  await expect.element(page.getByText('Invented').first()).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail** — server and client commands as Task 7 → FAIL.
- [ ] **Step 3: Implement `evidence.ts`; PASS**
- [ ] **Step 4: Implement `EvidenceDialog.svelte`; PASS**
- [ ] **Step 5: Commit**

```bash
git add src/lib/lesscars/evidence.ts src/lib/lesscars/evidence.spec.ts src/lib/lesscars/EvidenceDialog.svelte src/lib/lesscars/EvidenceDialog.svelte.spec.ts
git commit -m "feat(lesscars): evidence dialog with tier and source for every plan number"
```

---

### Task 9: The page: composition and route

**Files:**
- Create: `src/lib/lesscars/LessCarsMode.svelte`, `src/lib/lesscars/LessCarsCard.svelte`, `src/lib/lesscars/debug.ts`
- Create: `src/routes/lesscars/+page.ts`, `src/routes/lesscars/+page.svelte`
- Modify: `src/lib/shell/layout.ts:2-9` (`isFullHeightRoute` adds `/lesscars`); `src/lib/shell/layout.spec.ts`
- Test: `src/lib/lesscars/LessCarsMode.svelte.spec.ts`, `src/routes/lesscars/page.spec.ts`, `src/routes/lesscars/page.svelte.spec.ts`

**Interfaces:**
- Consumes: Tasks 2 to 8; `SimMap` (`src/lib/map/SimMap.svelte`, props `manifest`, `onready`, `view`, `timelinePick`; handle `applyTimeline`, `setTime`, `setTimelineLookups`, `onResyncNeeded`, `setBottomInset`, `getMap`, `setChunkStatus`); `TimeScrubber` (`src/lib/fzp/TimeScrubber.svelte`, props `asOf`, `horizon`, `day`, `playing`, `speed`, `markers`, `onday`, `onheight`); `chanceTable`, `typicalMonths` (`src/lib/timelapse/model`); `spawnSimWorker` (`src/lib/sim/client.ts:226`); `useHeaderActions` (`src/lib/shell/header-actions.svelte.ts`); `useSystemTheme`; `HIDDEN_VIEW`; `cellsIntersecting` is the worker's (the page sends `prefetch` with the map bounds on `moveend`, as FzpMode).
- Produces:

```ts
// debug.ts — only in a VITE_E2E=1 build (constant-false branch otherwise, as src/lib/fzp/debug.ts)
export interface SfhLessCarsDebug {
  readonly phase: 'loading' | 'ready' | 'failed';
  readonly day: Day;
  readonly playing: boolean;
  readonly seed: number | null;
  readonly revision: number;        // last applied playback revision, -1 before revision 0
  readonly cells: string[];         // cell ids received so far
  readonly reservations: { parcelId: string; kept: boolean }[];
}
export function installLessCarsDebug(get: () => SfhLessCarsDebug): () => void; // window.__sfhLessCars
```

  `LessCarsMode.svelte` props `{ data: LessCarsData; createWorker?: () => ScenarioWorkerInput }`. Behaviour:
  - Header: `useHeaderActions(actions, { pinned: headline })`; `actions` = two buttons "Timeline" (opens `TimelineDialog`) and "Evidence" (opens `EvidenceDialog`); `headline` = `HeadlineBar` with `DetailsPanel` (its `onevidence` opens the evidence dialog). Opening either dialog pauses playback.
  - Map: `SimMap` with `view={HIDDEN_VIEW}` and `timelinePick`. On `onready(h)`: `h.setTimelineLookups({ chance: chanceTable(cal), typicalMonths: typicalMonths(cal) })` (once), `h.onResyncNeeded(() => client.resync())`, queued playback updates applied, `installLessCarsLayers(h.getMap()!, { streets, lines, stops, sites, garages: empty }, theme, day)`, `h.setTime(day)`. Theme changes call `layers.setTheme`. `playbackLoaded` calls `layers.setData('garages', garageFeatures(…, places, reservations))`.
  - Client: created on mount (`createWorker ?? spawnSimWorker`), `init(data.manifest, data.plan, data.sites)`; `playback` → `h.applyTimeline(render)` (queued until the handle); `chunks` → `h.setChunkStatus`; `error`/crash → phase `failed` with a notice "Couldn't load the buildings." and a Retry button (`restart(spawnSimWorker())`, `init`); the plan layers keep working while buildings fail.
  - Scrubber: `asOf = LESSCARS_START`, `horizon = LESSCARS_HORIZON`, opens at `LESSCARS_START`, paused; `markers = scrubberMarkers(plan, summary.switchDay)`; `onday(d)`: `h.setTime(d)`, `layers.setDay(d)`, and a card refresh when the month changed. Its height sets the map's bottom inset and a `--lc-scrubber-h` variable for the card and notices.
  - Notices row just above the scrubber: "Loading the buildings…" while loading (the plan layers already show), the failure notice when failed.
  - Card: a tap pick with a project id → `client.card(projectId, day)` → `LessCarsCard`; a tap on nothing closes it. `LessCarsCard.svelte` props `{ card: PlaybackCard | null; loading: boolean; onclose: () => void }`: `role="region"` name "Building details", heading by kind ("Built by the plan on freed land", "Built by the plan on a former parking lot", "Market project"), `planLabel` when present, `where`, homes (`units`, and "replacing N homes" when `existingUnits` > 0), stories, status line ("Under construction since Mon YYYY", "Completed Mon YYYY", "In planning", "Stopped"), Close button, Escape closes. Below 768 px full width above the scrubber; from 768 px bottom left, clearing `--map-controls-br-*` (`docs/dev/map-interfaces.md`).
  - Map picking is pointer-only (the known gap shared with `/sim`, `docs/dev/fzp-mode.md` "Known gap"); everything else is keyboard reachable.

  Route: `+page.ts` (universal, `export const load: PageLoad = async ({ fetch, parent }) => loadLessCars((await parent()).datasetVersion, fetch)`). `+page.svelte`: `<svelte:head><title>Fewer cars · SF Housing Simulator</title></svelte:head>`, `<h1 class="sr-only">A fewer-cars San Francisco, 2028 to 2068</h1>`; `ready` → `{#key data.data.manifest}<LessCarsMode data={data.data} />{/key}`; `no-scenario` → a centred message `<p>This dataset has no fewer-cars plan yet.</p>` with a link "Open the policy simulation" (`/sim`); `error` → `<p role="alert">The fewer-cars plan couldn't be loaded.</p>` and a Retry button (`invalidateAll()`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/routes/lesscars/page.spec.ts
it('load passes the layout datasetVersion to loadLessCars', async () => {
  const out = await load({ fetch: fixtureFetch(), parent: async () => ({ datasetVersion: 'fixture-0' }) } as never);
  expect(out.state).toBe('ready');
});

// src/routes/lesscars/page.svelte.spec.ts
it('no-scenario and error states render without a map or worker', async () => {
  render(Page, { data: { state: 'no-scenario', datasetVersion: 'x' } });
  await expect.element(page.getByText('This dataset has no fewer-cars plan yet.')).toBeVisible();
  render(Page, { data: { state: 'error', datasetVersion: 'x', message: 'm' } });
  await expect.element(page.getByRole('alert')).toHaveTextContent("The fewer-cars plan couldn't be loaded.");
  await expect.element(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

// src/lib/lesscars/LessCarsMode.svelte.spec.ts — fake worker (records requests, emits responses);
// SimMap is real but unsupported-WebGL-safe in the client project as FzpMode's spec does
it('sends initPlayback with the plan and sites, opens paused at 2028-01-01', async () => {
  expect(worker.sent[0]).toMatchObject({ type: 'initPlayback', plan: data.plan, sites: data.sites });
  await expect.element(page.getByTestId('fzp-readout-label')).toHaveTextContent('January 2028');
  await expect.element(page.getByTestId('fzp-play-label')).toHaveTextContent('Play');
});
it('puts the headline in the pinned slot and Timeline and Evidence among the actions', async () => {
  await expect.element(page.getByTestId('lc-headline')).toHaveTextContent('+260 homes by 2068');
  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect.element(page.getByRole('dialog', { name: 'Project timeline' })).toBeVisible();
});
it('a worker error shows the failure notice; Retry restarts and re-inits', async () => {
  worker.emit({ type: 'error', rev: 1, code: 'internal', message: 'x' });
  await page.getByRole('button', { name: 'Retry' }).click();
  expect(spawned).toBe(2);
  expect(lastWorker.sent[0].type).toBe('initPlayback');
});
it('a card answer renders the building details; Escape closes it', async () => {
  pick({ projectId: 'lc-build:lc:hwy:1', parcelId: 'lc:hwy:1', x: 10, y: 10, kind: 'tap' });
  worker.emit({ type: 'playbackCard', reqId: worker.lastReqId(), card: freedCard });
  await expect.element(page.getByRole('region', { name: 'Building details' })).toHaveTextContent('Built by the plan on freed land');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('region', { name: 'Building details' })).not.toBeInTheDocument();
});

// src/lib/shell/layout.spec.ts
it('/lesscars is a full-height route', () => expect(isFullHeightRoute('/lesscars')).toBe(true));
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project server src/routes/lesscars/page.spec.ts src/lib/shell/layout.spec.ts`
Run: `npx vitest run --project client src/routes/lesscars src/lib/lesscars/LessCarsMode.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `debug.ts`, `LessCarsCard.svelte`, `LessCarsMode.svelte`, the route files and `isFullHeightRoute`**
- [ ] **Step 4: Run to verify they pass** (same commands), then `npm run check` and `npm run lint` → no errors.
- [ ] **Step 5: Commit**

```bash
git add src/lib/lesscars src/routes/lesscars src/lib/shell/layout.ts src/lib/shell/layout.spec.ts
git commit -m "feat(lesscars): the /lesscars page"
```

---

### Task 10: e2e and docs

**Files:**
- Create: `e2e/lesscars.spec.ts`
- Modify: `docs/dev/lesscars.md` (a "The page" section), `CLAUDE.md:43` (link text)

**Interfaces:**
- Consumes: the page; `window.__sfhLessCars` (Task 9), `window.__sfhMap` (`src/lib/map/debug.ts`); helpers `expectNoA11yViolations` (`e2e/helpers/a11y.ts:48`), `headerAction`, `openHeaderMenu`, `projectToPage`, `gotoHydrated` (`e2e/helpers/sharing.ts`), `slider` (`e2e/helpers/run.ts:8`); disk reads of `e2e/fixtures/data/fixture-0/scenarios/lesscars/*` and `scenarios/fzp/parcels.bin`, decoded with `parseSummary`, `parseSitesFile`, `parsePlanFile`, `decodeTimelinePayload` (after `inflateRawSync`) and `readScenarioParcels`. No expected value is hard-coded: every count, label, day and id comes from those files.

Tests (all under both Playwright projects unless noted; `reducedMotion: 'reduce'` as `gotoFzp` does):

```ts
test('opens paused on 2028 with the headline from summary.json', async ({ page }) => {
  await gotoHydrated(page, '/lesscars');
  await expect(page.getByTestId('lc-headline')).toHaveText(headlineText(summary));
  await expect(page.getByTestId('fzp-readout-label')).toHaveText('January 2028');
  expect(await page.evaluate(() => window.__sfhLessCars!.playing)).toBe(false);
});
test('the details show a breakdown that adds to the headline', async ({ page }) => {
  await page.getByTestId('lc-headline').click();
  const cells = await page.getByRole('table', { name: /Where the extra homes come from/ }).getByRole('cell').allTextContents();
  expect(sumOfSourceCells(cells)).toBe(Math.round(summary.extra.mean.at(-1)!));
});
test('street states are rendered by day, and revert when scrubbing back', async ({ page }) => {
  await frameOn(page, planBBox(planFile));                        // jumpTo over every segment, wait idle
  const removed = () => renderedProps(page, LC_STREET_LAYER.removed); // queryRenderedFeatures via __sfhMap
  await setDay(page, T('hwy').openDay);                           // keyboard on the slider until the readout month, or End
  expect((await removed()).map((p) => p.project)).toContain('hwy');
  await page.keyboard.press('Home');
  expect(await removed()).toEqual([]);
});
test('plan lines and stops appear on opening; freed land appears when available', async ({ page }) => {
  await setDay(page, T('subway').openDay);
  expect(await renderedProps(page, 'lc-stops')).not.toEqual([]);
  await setDay(page, T('hwy').availableDay!);
  expect((await renderedProps(page, 'lc-sites')).map((p) => p.siteId).sort()).toEqual(siteIds);
});
test('a freed-land building rises and its card matches timeline.bin', async ({ page }) => {
  const b = timeline.builds.find((x) => x.parcelRow === null)!;
  await page.keyboard.press('End');
  await waitFor(page, () => window.__sfhLessCars!.cells.includes('lc-sites'));
  await page.mouse.click(...(await projectToPage(page, siteCentre(b.siteId))));
  const card = page.getByRole('region', { name: 'Building details' });
  await expect(card).toContainText('Built by the plan on freed land');
  await expect(card).toContainText(formatCount(b.units));
});
test('the garage marker follows the reservation verdict', async ({ page }) => {
  const garageParcel = garageOnParcel(planFile).site.parcel; // the edge-garage with a { parcel } site
  const r = timeline.reservations.find((x) => parcels.id[x.row] === garageParcel)!;
  await setDay(page, T('garage').openDay);
  expect((await renderedProps(page, 'lc-garages')).length > 0).toBe(r.kept);
});
test('Timeline and Evidence open from the header (Menu on phones), axe clean', async ({ page }) => {
  await (await headerAction(page, 'Timeline')).click();
  await expectNoA11yViolations(page, { include: ['[data-testid=lc-timeline]'], structure: true });
  await page.getByRole('button', { name: /^Evidence for / }).first().click(); // from a row
  await expect(page.getByRole('dialog', { name: 'Evidence for every number' })).toBeVisible();
  await expect(page.getByText('Assumption, not data').first()).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=lc-evidence]'], structure: true });
});
test('axe on the page, with details open, with a card open; 375 px: no horizontal scroll, footer reachable', async ({ page }) => {
  await expectNoA11yViolations(page);
  await page.getByTestId('lc-headline').click();
  await expectNoA11yViolations(page);
  // mobile project: document.scrollingElement.scrollWidth <= innerWidth; footer links unobscured as /sim's spec checks
});
test('a dataset without scenarios.lesscars shows the not-in-dataset page and starts no worker', async ({ page }) => {
  // navigate from /about with a page.route on manifest.json that drops scenarios.lesscars
  // (a first load takes the manifest from the server render: docs/dev/fzp-mode.md e2e notes)
  await expect(page.getByText('This dataset has no fewer-cars plan yet.')).toBeVisible();
  expect(timelineRequests).toEqual([]);
});
```

- [ ] **Step 1: Write `e2e/lesscars.spec.ts` with the tests above**
- [ ] **Step 2: Run it**

Run: `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts`
Expected: PASS in both projects. If a rendered-content assertion fails, fix the code (the page), not the expectation.

- [ ] **Step 3: Run the neighbouring suites the shell and worker touch**

Run: `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/layout.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts e2e/sim.spec.ts e2e/pages-a11y.spec.ts`
Expected: PASS (no change to `/sim`).

- [ ] **Step 4: Write the docs**

`docs/dev/lesscars.md` "The page": the route and load states; the data flow (main thread: plan, sites, summary, calibration; worker playback host: parcels.bin, projects.json, calibration.json, timeline.bin, chunks); the request flow (`initPlayback`, `playbackLoaded`, `playback`, `playbackCard`, prefetch); the synthetic `lc-sites` cell and `lc-build:` ids; street-state rules (`laneState`, the event order) and the layer ids; epoch-gated filters; the header (pinned headline, Timeline and Evidence actions in the Menu below 768 px); the debug hook; the e2e notes (port, fixture ids read from disk); the known gap (pointer-only picking); the builder's calls from this plan's Decisions. `CLAUDE.md:43`: link text becomes "**`/lesscars` (plan format, checks, dated regimes and reservations, freed land, paired runs, output files, the page)**".

- [ ] **Step 5: Final verification**

Run: `npm run check`; `npm run lint`; `npm run test:unit`; `npm run test:pipeline`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add e2e/lesscars.spec.ts docs/dev/lesscars.md CLAUDE.md
git commit -m "test(lesscars): e2e for the page; docs for the page"
```

---

## Open questions for the owner

1. **Header link before the live plan exists.** The outline put a "Fewer cars" mode link in the header. Production has no `scenarios.lesscars` until Plan 3, so a link merged now would lead every visitor to "This dataset has no fewer-cars plan yet." **Recommendation:** add the mode link in Plan 3, together with the live plan; this plan ships the route reachable by URL only. Say if you want the link now instead (one step in Task 9 plus the header specs and the 768 px header-fit check).
