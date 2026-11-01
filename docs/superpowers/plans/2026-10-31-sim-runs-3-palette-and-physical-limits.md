# /sim refinements 3 of 3: physical limits, palette, Paint/Simulate tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap every generated envelope at the lot's physical max stories (the hybrid rule), carry that through the fixture dataset, and apply the one-hue-per-meaning palette (map tokens, transit legend, app accent, dark chrome) plus Paint/Simulate as tabs.

**Architecture:** A pure `physicalMaxStories` in `src/lib/generator/physical.ts` is applied inside `generateDetailed` before `selectTypology`. Every yield (pipeline, worker, paint on `/`) goes through `generate`, so this one clamp covers all of them. The palette is data: `TOKENS` in `src/lib/map/palette.ts` gains the new values and four new tokens, and everything else derives from it. The chrome accent is a static set of Tailwind 4 `@theme` colours in `src/routes/layout.css`. The light and dark values are separate tokens, so light-only surfaces never pick up the dark accent.

**Tech Stack:** TypeScript, SvelteKit 2 / Svelte 5 runes, Tailwind 4, Vitest (server + client browser projects), Playwright + axe, the `pipeline/` CLI.

**Spec:** `docs/superpowers/specs/2026-10-31-sim-runs-design.md` (§3a, §7, §8). Evidence: `docs/superpowers/design/2026-10-31-physical-limits/`.

**Scope boundary:** Plans 1 and 2 own the `/sim` page, policy and brush model, fog rendering, paint feedback, `lot-overlay.ts` (its `LOT_COLORS` is deleted there: do not retune it), the three-column `/sim` header and the Run button in `TimeScrubber`. This plan touches `SiteHeader.svelte` only in the `modeLinks` snippet and the header/panel colour classes. It touches `TimeScrubber.svelte` only in its `<style>` colour declarations. Merge whichever lands second carefully.

## Global Constraints

- WCAG 2.2 AA (`docs/dev/accessibility.md`): text 4.5:1, non-text UI and graphical objects 3:1 (SC 1.4.11), targets ≥ 24×24 (SC 2.5.8).
- Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- `src/lib/generator/` may not call `Math.sin|cos|atan2|pow|exp` (AC4 guard, `determinism.spec.ts:10`). `Math.sqrt` and `Math.floor` are fine.
- The physical rule is exactly as the spec writes it. `w` = lot minimum width in ft (principal-axis cross extent), `A` = area in ft², `k = A/1000`. Then `sf = min(0.3·w, capA)` and `capA = 2.4k (k ≤ 15) | 36 + 0.9(k−15) (k ≤ 30) | 49.5 + 0.5(k−30)`. Then `big = min(0.49·w, 0.5·√A)` and `t = clamp((w − 60)/60, 0, 1)`. Finally `physicalMax = floor(clamp((1−t)·sf + t·max(sf, big), 5, 80))`.
- The ft/m conversion is explicit: `FT_PER_M = 1 / 0.3048`; ft² = m² × `FT_PER_M`².
- The existing `selectTypology` area thresholds (400 / 600 / 1500 m²) keep their values.
- Spec §8 hex values (the table), with the two WCAG-driven deviations ruled below.
- Blue and violet are used only for water. Teal means transit, terracotta new housing and the accent, plum the pipeline, red/amber/green chance only, an uncoloured haze the height limits, and ink the outlines.
- `aria-current="page"` stays on the current mode link.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits. Never `cd x && cmd`.

## Review Focus

1. **A lot given in metres whose ft value is an integer boundary** (25×100 ft stored as 7.62×30.48 m). Expect 6, not 5: `2.4·k` can land at 5.9999999 after the round trip. Pinned in Task 1 (`metres round trip`).
2. **A rotated or clockwise lot** should get the same physical max as the axis-aligned lot. Pinned in Task 1 (`rotation and winding`).
3. **A low envelope on a big lot** (S = 3 on 100×100 ft) must stay 3. The clamp only lowers. Pinned in Task 2 (`never raises`).
4. **A district site** (≥ 20,000 m²): each synthetic lot is clamped on its own geometry, never the whole site's. Pinned in Task 2 (`district lots`).
5. **The OS in dark mode on a light-only panel** (score bars, shared banner, permitting timeline). The accent must stay the light value there, because the dark accent `#E0955A` on `gray-200` is about 1.9:1. Pinned in Task 6 (`light-only surfaces use the light accent`) and Task 7's dark e2e.

---

## File Structure

- Create `src/lib/generator/physical.ts`: `physicalMaxStories`, `lotPhysicalMaxStories`, `lotBuildableStories`. Pure.
- Create `src/lib/generator/physical.spec.ts`.
- Modify `src/lib/generator/constants.ts`: the physical-rule constants and the typology area thresholds, each with its tier (this file's doc comments are the generator's provenance list, e.g. `constants.ts:71-96`).
- Modify `src/lib/generator/select.ts`: use the named thresholds (same values).
- Modify `src/lib/generator/generate.ts:64-71`: the clamp.
- Modify `src/lib/generator/index.ts`: the exports.
- Modify `src/lib/generator/generator.property.spec.ts:300-314`, `golden.spec.ts`: add the clamp to the predictions and add the new cases.
- Regenerated fixtures: `src/lib/generator/fixtures/golden-seeded.json`, `src/lib/map/fixtures/*.json`, `src/lib/sim/scenario/fixtures/golden-seed1.json`, `e2e/fixtures/timeline/fixture0-timeline.json`, `pipeline/test/fixtures/mini/golden/**`, `e2e/fixtures/data/fixture-0/**`. Each only if its test fails.
- Modify `src/lib/map/palette.ts`, `palette.spec.ts`, `style.ts:273`, `style.spec.ts`.
- Modify `src/lib/brush/overlay.ts:10-14` (`BRUSH_COLORS` derives from tokens) and `overlay.spec.ts`.
- Modify `src/lib/transit/legend.ts`, `legend.spec.ts`.
- Create `src/lib/map/system-theme.svelte.ts`: the one system-theme source that SimMap and the pages share.
- Modify `src/lib/map/SimMap.svelte:139-142,389-396`, `src/lib/view/ViewMenu.svelte`, `ViewMenu.svelte.spec.ts`, `src/routes/+page.svelte`, `src/routes/p/[id]/+page.svelte`.
- Modify `src/routes/layout.css`: the `@theme` accent and chrome colours.
- Create `src/lib/shell/accent.spec.ts`.
- Modify `src/lib/sharing/SharedBanner.svelte:69`, `PublishButton.svelte:68`, `PublishDialog.svelte:185`, `src/lib/scoreboard/TargetRow.svelte:35`, `NeighborhoodList.svelte:23`, `src/lib/sim-page/RouteTimeline.svelte:318-324`.
- Modify `src/lib/shell/SiteHeader.svelte` (`modeLinks`, header/panel classes) and `SiteHeader.svelte.spec.ts`.
- Modify `src/lib/fzp/TimeScrubber.svelte` `<style>` (dark variant and accent).
- Create `e2e/chrome-dark.spec.ts`.
- Modify `e2e/map.spec.ts-snapshots/map-{light,dark}-chromium-darwin.png` (regenerated).
- Modify `docs/dev/pipeline.md` and `pipeline/test/fixtures/mini/README.md`: the clamp, and any changed mini counts.

---

### Task 1: `physicalMaxStories` (pure)

**Files:**
- Create: `src/lib/generator/physical.ts`
- Modify: `src/lib/generator/constants.ts` (append after line 96), `src/lib/generator/index.ts`
- Test: `src/lib/generator/physical.spec.ts`

**Interfaces:**
- Consumes: `Site` (`site.ts:23-38`: `P` canonical ring in local metres, `A` m², `c` centroid, `v` unit minor axis), `project(paths, o, d)` (`poly.ts:110`), `normaliseSite(polygon, edgeInsetM)` (`site.ts:66`), `selectTypology` (`select.ts:7`), `MAX_STORIES` (`constants.ts:27`), `ParcelRecord['polygon']` (`src/lib/data/parcel.ts:8`, local metres, EPSG:7131).
- Produces:
  - `type PhysicalSite = Pick<Site, 'P' | 'A' | 'c' | 'v'>`
  - `physicalMaxStories(site: PhysicalSite): number`: an integer in `[PHYS_MIN_STORIES, MAX_STORIES]`.
  - `lotPhysicalMaxStories(polygon: ParcelRecord['polygon']): number | null`: `null` when `normaliseSite(polygon, 0)` is null.
  - `lotBuildableStories(polygon: ParcelRecord['polygon'], allowedStories: number, existingUnits: number): number | null`: `selectTypology(min(floor(allowed), physicalMax, MAX_STORIES), A, existingUnits).stories`. It is `null` when the site is null or `floor(allowed) < 1`.
  - Constants (each with a one-line doc comment naming its source and tier): `FT_PER_M = 1 / 0.3048` (exact definition); `PHYS_SF_FT_COEF = 0.3` (tier 0, SF LiDAR/parcels/2023 roll, 119,531 sites); `PHYS_AREA_KNOTS` / slopes for `capA` (tier 0, same); `PHYS_SLENDER_FT_COEF = 0.49` (tier 0, SF towers ~5:1 at 3.1 m/floor); `PHYS_SQRT_AREA_COEF = 0.5` (tier 3, NYC Manhattan post-2000 PLUTO applied to SF); `PHYS_JOIN_FROM_FT = 60`, `PHYS_JOIN_TO_FT = 120` (tier 4, invented); `PHYS_MIN_STORIES = 5` (tier 0, SF sub-20 ft lots). The ceiling is `MAX_STORIES`. Cite `docs/superpowers/design/2026-10-31-physical-limits/` in a block comment.

- [ ] **Step 1: Write the failing tests** in `physical.spec.ts` (server project). Build sites with `normaliseSite([rectRing(wFt * 0.3048, dFt * 0.3048)], 0)!` (`fixtures/geom.ts:5`).

```ts
const ft = (w: number, d: number) => normaliseSite([rectRing(w * 0.3048, d * 0.3048)], 0)!;
it.each([
  [25, 100, 6], [25, 120, 7], [50, 100, 12], [75, 100, 22],
  [100, 100, 40], [137.5, 137.5, 67], [200, 275, 80]
] as const)('spec reference lot %f×%f ft → %i', (w, d, s) => {
  expect(physicalMaxStories(ft(w, d))).toBe(s);
});
it('metres round trip: 7.62 × 30.48 m is 6, not 5', () => {
  expect(physicalMaxStories(normaliseSite([rectRing(7.62, 30.48)], 0)!)).toBe(6);
});
it('clamps to 5..80', () => {
  expect(physicalMaxStories(ft(12, 60))).toBe(5);
  expect(physicalMaxStories(ft(400, 400))).toBe(80);
});
it('rotation and winding do not change it', () => {
  // rational rotation cos 0.6, sin 0.8 (no transcendentals); reversed ring for winding
  for (const [w, d, s] of [[50, 100, 12], [75, 100, 22], [137.5, 137.5, 67]] as const) {
    expect(physicalMaxStories(rotated(ft(w, d), 0.6, 0.8))).toBe(s);
    expect(physicalMaxStories(reversed(ft(w, d)))).toBe(s);
  }
});
it('lotPhysicalMaxStories reads a parcel polygon; null on a degenerate lot', () => {
  expect(lotPhysicalMaxStories([rectRing(25 * 0.3048, 100 * 0.3048)])).toBe(6);
  expect(lotPhysicalMaxStories([[[0, 0], [1, 0], [2, 0]]])).toBeNull();
});
it('lotBuildableStories applies the physical max, then the typology cascade', () => {
  const p = [rectRing(25 * 0.3048, 100 * 0.3048)];
  expect(lotBuildableStories(p, 40, 1)).toBe(5); // phys 6, then walkup cap under 400 m²
  expect(lotBuildableStories(p, 3, 1)).toBe(3);
  expect(lotBuildableStories(p, 0.5, 1)).toBeNull();
  expect(lotBuildableStories([rectRing(137.5 * 0.3048, 137.5 * 0.3048)], 80, 1)).toBe(67);
});
```

`rotated`/`reversed` are local helpers. They rotate or reverse the polygon rings and re-run `normaliseSite`, so the site is recomputed.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest --run --project server src/lib/generator/physical.spec.ts`
Expected: FAIL, `physical` module not found.

- [ ] **Step 3: Implement `physical.ts` and the constants.** Compute `w` in metres as `max − min` of `project([site.P], site.c, site.v)`, then convert to ft. **Builder's call:** floor `x + 1e-9`, not `x`. The m→ft round trip turns exact spec values (2.4 × 2.5 = 6) into 5.9999…, and 1e-9 stories is far below any real difference. Export the three functions and `PhysicalSite` from `index.ts`.

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx vitest --run --project server src/lib/generator/physical.spec.ts src/lib/generator/determinism.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/generator/physical.ts src/lib/generator/physical.spec.ts src/lib/generator/constants.ts src/lib/generator/index.ts
git commit -m "feat(generator): physical max stories (hybrid width/area rule)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `generate` clamps S before `selectTypology`

**Files:**
- Modify: `src/lib/generator/generate.ts:64-71`, `src/lib/generator/select.ts`, `src/lib/generator/constants.ts`
- Test: `src/lib/generator/golden.spec.ts`, `src/lib/generator/generator.property.spec.ts:300-314`, `src/lib/generator/select.spec.ts` (unchanged values, must still pass)

**Interfaces:**
- Consumes: `physicalMaxStories` (Task 1).
- Produces: `generateDetailed` / `generateWith` / `generate` build at most `physicalMaxStories(site)` stories. The constants are `TOWER_MIN_M2 = 1500`, `MIDRISE_MIN_M2 = 600` and `PODIUM_MIN_M2 = 400`, each documented as tier 4: the "today" area-only thresholds the spec keeps as the typology cascade. `LOT_MIN_M2`'s comment (`constants.ts:85`) now points at `PODIUM_MIN_M2`.

- [ ] **Step 1: Write the failing tests** in `golden.spec.ts`, as a new `describe('physical max (§3a)')`. Use `run` (`golden.spec.ts:28`) on `{ ...lot1000, id: 'p', polygon: [rectRing(...)] }` records.

```ts
it('137.5 ft square at S=80 builds at most 67 stories', () => {
  const b = run(sq(137.5), 80)!.building;
  expect(b.stories).toBeLessThanOrEqual(67);
  expect(b.typology).toBe('tower');
});
it('never raises: 100×100 ft at S=3 stays 3', () => {
  expect(run(rect(100, 100), 3)!.building.stories).toBe(3);
});
it('the clamp equals painting the physical max', () => {
  const d = run(sq(137.5), 80)!;
  expect(d.building).toEqual(run(sq(137.5), physicalMaxStories(d.site))!.building);
});
it('district lots: each lot is clamped on its own geometry', () => {
  // districtRect(400, 300) = rect from fixtures/district.ts: 120,000 m², so generate() takes the district path.
  // District lots are ≤ LOT_FRONTAGE_M (45 m ≈ 148 ft) wide, so each lot's physical max is < 80.
  const b = generate(P({ ...lot1000, id: 'd', polygon: districtRect(400, 300) }), { maxStories: 80 }, 7, 'max')!;
  expect(b.lots!.length).toBeGreaterThan(0);
  for (const lot of b.lots!) expect(lot.stories).toBeLessThan(80);
});
```

`GeneratedBuilding.lots` (`types.ts:30`) carries no per-lot polygon, so the district test asserts the bound, not the exact per-lot value. `sq(ft)` and `rect(wFt, dFt)` in this describe are local helpers that build a `lot1000`-based record with `rectRing(w * 0.3048, d * 0.3048)`. Don't confuse them with the district fixture's `rect`: import that one as `districtRect`.

In `generator.property.spec.ts:306`, replace `selectTypology(c.S, …)` with `selectTypology(Math.min(c.S, physicalMaxStories(d.site)), …)`. Expect a FAIL before Step 3, because the property no longer matches the unclamped generator.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest --run --project server src/lib/generator/golden.spec.ts src/lib/generator/generator.property.spec.ts`
Expected: FAIL on the 67-story case and on the property.

- [ ] **Step 3: Clamp in `generateDetailed`.** Right after `normaliseSite` (`generate.ts:68-69`), set `S = Math.min(S, physicalMaxStories(site))`. Leave the `MAX_STORIES` clamp at line 66 in place. Replace the literals in `select.ts` with the named constants.

  **Builder's call:** `generateForUnits` / `generateDistrictForUnits` (`units.ts`, `district.ts:150+`) are **not** clamped. They mass recorded projects to their stated units and stories (tier 0), and real buildings are their own evidence. The spec's list (FZP baseline, painting, paint feedback) is all `generate`.

- [ ] **Step 4: Run the whole generator suite.** Every remaining failure must be a golden whose input exceeds its lot's physical max. Predicted unchanged: `std` S=12 (phys 6 → walkup 5, as before); `lot-1000` (phys 30); `lot-1200` S=30 (phys 41); the skinny L at S=40 (phys about 65); `lot-3000` (80). `golden-seeded.json` will change. Regenerate it with `npx tsx src/lib/generator/fixtures/build-golden-seeded.ts` and check in its diff that only `stories`, `units`, `floorAreaM2` and parts change, on parcels whose S is above their physical max.

Run: `npx vitest --run --project server src/lib/generator` then `npx vitest --run --project client src/lib/generator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/generator
git commit -m "feat(generator): clamp envelopes to the lot's physical max" -m "Typology area thresholds named in constants with their tier; golden-seeded regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Downstream goldens and the fixture dataset

**Files:**
- Regenerate (each only if its test fails): `src/lib/map/fixtures/generated-small.json`, `parcels-small.json` (`npx tsx src/lib/map/fixtures/build-fixtures.ts`); `src/lib/sim/scenario/fixtures/golden-seed1.json` (`npx tsx src/lib/sim/scenario/fixtures/build-golden.ts`); `pipeline/test/fixtures/mini/golden/**` and `e2e/fixtures/data/fixture-0/**` (`npm run pipeline -- fixture --update-golden`); `e2e/fixtures/timeline/fixture0-timeline.json` (`npx tsx src/lib/map/fixtures/build-timeline-fixture.ts`, **after** the fixture rebuild, because it reads fixture-0)
- Modify: `docs/dev/pipeline.md`, `pipeline/test/fixtures/mini/README.md`

**Interfaces:**
- Consumes: Task 2's clamped `generate`.
- Produces: a fixture-0 whose yields are clamped. That is what plan 1 and 2 e2e tests run against.

- [ ] **Step 1: Run the suites and list failures.** This needs `tippecanoe 2.79.0` and `pmtiles 1.31.2` (`npm run pipeline -- doctor`).

Run: `npm run test:unit` then `npm run test:pipeline`
Expected: failures only in golden and fixture comparisons, and in pipeline tests with hard-coded mini yields.

- [ ] **Step 2: Rebuild the fixture golden**

Run: `npm run pipeline -- fixture --update-golden`
Expected: exit 0, and V1–V34 pass on the fixture profile.

- [ ] **Step 3: Review the diff.** Run `git diff --stat pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0`, then read `golden/scenarios/fzp/parcels.decoded.json` and `policy.decoded.json`. Check that every changed yield is on a lot whose envelope stories exceed its `lotPhysicalMaxStories`. Fixture `fixture-0`'s version name does not change. Check `calibration.json` too: it should be unchanged unless hostable sets moved, and if it changed, say why in the commit body. If the SB 79 / current-law counts quoted for the mini fixture in `docs/dev/pipeline.md` (e.g. "7 `applies` … net capacity 87") or the mini README changed, update them from `report.json`.

- [ ] **Step 4: Regenerate the other fixtures whose tests failed**, timeline last. Update any hand-pinned pipeline test expectations only where the clamp explains them, and add a `// physical max (§3a)` comment.

- [ ] **Step 5: Add one paragraph to `docs/dev/pipeline.md`'s scenario section.** It should say that yields come from the generator, which caps each envelope at `physicalMaxStories` (`src/lib/generator/physical.ts`), so the cap is inside the `datasetVersion` hash.

- [ ] **Step 6: Run everything and confirm it passes**

Run: `npm run test:unit` then `npm run test:pipeline` then `npm run test:e2e`
Expected: PASS. Any e2e count that moved must trace to a fixture lot above its physical max. Update it with that comment.

- [ ] **Step 7: Commit**

```bash
git add pipeline/test/fixtures/mini e2e/fixtures src/lib/map/fixtures src/lib/sim/scenario/fixtures docs/dev/pipeline.md pipeline/test
git commit -m "test(data): regenerate fixture-0 and goldens for the physical max" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Map tokens (spec §8 table)

**Files:**
- Modify: `src/lib/map/palette.ts:6-113`, `src/lib/brush/overlay.ts:1-14`
- Test: `src/lib/map/palette.spec.ts`, `src/lib/brush/overlay.spec.ts:147-160`, `src/lib/map/style.spec.ts`

**Interfaces:**
- Produces, as new `TokenName`s in both themes:
  - `'height-fog'`: light `rgba(255,255,255,0.30)`, dark `rgba(200,210,214,0.20)`
  - `'brush-paint'`: light `#B4532F` (ruled below), dark `#DB8B42`
  - `'brush-erase'`: light `#2B2A28`, dark `#E8E4DC`
  - `'painted-outline'`: light `#B4532F`, dark `#DB8B42`

  Plan 2 draws the fog and the eraser outline from these. `BRUSH_COLORS` keeps its shape (`{light,dark}{paint,erase}: [r,g,b]`) and is derived as `hexToRgba(TOKENS[t]['brush-paint']).slice(0, 3)`. `BrushToolbar.svelte:13-14` follows automatically.
- Values (spec table):
  - Light `transit-access-1..5` `#E0F2EF #B3E0D8 #7CC7BA #3FA596 #167A6E`; dark `#16282A #1B3E3E #22595A #2E7B78 #4BA59E`.
  - Light `transit-bus/rail/regional` `#5E7A76 #0F5A52 #0B3B36`; dark `#9BB5B0 #7FD6C9 #C2F0E8`.
  - `tl-ghost-planning/permit/ready`: light `#DDBBD2` (ruled below) `#C58FB1 #93527F`; dark `#623257` (ruled below) `#8A5679 #C08AAE`.
  - `tl-ghost-dying`: light `#C62828`, dark `#FF8A80`.
  - Dark `replaced` `#232427`, dark `road` `#34373B`. Everything else is unchanged.

**Rulings (WCAG / existing guards over the spec hex):**
- *Builder's call:* light brush ring and painted outline are `#B4532F`, not `#BF5A3A`. `#BF5A3A` is 2.89:1 on light `existing`, which fails SC 1.4.11 and `overlay.spec.ts:150`. `#B4532F` is the nearest same-hue value at ≥ 3:1 (land 4.34, existing 3.24, replaced 3.59).
- *Builder's call:* `tl-ghost-planning` is light `#DDBBD2` and dark `#623257`, not `#E3C8DA` / `#5A3550`. The spec values are ΔE2000 17.8 / 18.5 from `existing`, under the ≥ 20 guard (`palette.spec.ts:114`) that keeps ghosts distinct from existing buildings (spec anti-goal). The new values keep hue ~320 and the lightness order. Hand-computed ΔE: 20.6 / 20.6. If culori disagrees, step to `#DAB6CF` / `#66305A`.

- [ ] **Step 1: Update the tests first**
  - `palette.spec.ts:66-69,82-89`: "verbatim" assertions on the new values (`TOKENS.light['transit-access-5']` is `'#167A6E'`, `TOKENS.dark['tl-ghost-ready']` is `'#C08AAE'`, `TOKENS.light['tl-ghost-dying']` is `'#C62828'`, `TOKENS.dark.replaced` is `'#232427'`).
  - `:107-113`: the ghost hue band becomes `[300, 335]` (plum). Rename it `ghost hues are plum`.
  - `:48-55`: stop-class distinctness becomes "contrast with land strictly increases bus → rail → regional, and each pair is ΔE2000 ≥ 8". The spec's single teal family makes ΔE ≥ 20 impossible; lightness carries the class, and marker size and minzoom already differ (`style.ts:283-292`).
  - New: `${theme}: brush-paint, brush-erase and painted-outline are ≥ 3:1 against land, existing and replaced`.
  - New: `${theme}: height-fog is translucent (alpha ≤ 0.35)` via `hexToRgba(...)[3] <= 90`.
  - Rewrite the pinned `DEFAULT_TOKENS_BODY` (`palette.spec.ts:199-236`) with the new values and the four new tokens in `TOKENS` key order. Put them after `transit-stroke` and before `tl-*`.
  - `overlay.spec.ts`: `BRUSH_COLORS.light.paint` equals `[180, 83, 47]`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest --run --project server src/lib/map/palette.spec.ts src/lib/brush/overlay.spec.ts src/lib/map/style.spec.ts`
Expected: FAIL on the verbatim values, the hue band and the pinned body.

- [ ] **Step 3: Update `TOKENS` and the `TokenName` union, and derive `BRUSH_COLORS`.** Update the doc comment at `palette.ts:35` to cite spec 2026-10-31 §8.

- [ ] **Step 4: Run them and confirm they pass**, plus the timelapse consumers, which derive from `TOKENS`

Run: `npx vitest --run --project server src/lib/map src/lib/brush` then `npx vitest --run --project client src/lib/map src/lib/brush`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/map/palette.ts src/lib/map/palette.spec.ts src/lib/brush/overlay.ts src/lib/brush/overlay.spec.ts src/lib/map/style.spec.ts
git commit -m "feat(map): one hue per meaning palette (teal transit, plum pipeline)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Transit legend and the ViewMenu theme

**Files:**
- Create: `src/lib/map/system-theme.svelte.ts`
- Modify: `src/lib/map/palette.ts`, `src/lib/map/style.ts:273`, `src/lib/transit/legend.ts:11`, `src/lib/view/ViewMenu.svelte`, `src/lib/map/SimMap.svelte:139-142,389-396`, `src/routes/+page.svelte:117`, `src/routes/p/[id]/+page.svelte:67`
- Test: `src/lib/transit/legend.spec.ts`, `src/lib/view/ViewMenu.svelte.spec.ts`, `src/lib/map/palette.spec.ts`

**Interfaces:**
- Produces:
  - `TRANSIT_ACCESS_OPACITY = 0.45` (palette.ts), used by `transitAccessLayer`'s `fill-opacity`.
  - `compositeHex(fg: string, bg: string, alpha: number): string`: sRGB channel blend, `#RRGGBB` uppercase. It is a legend helper, not a colour-science claim.
  - `accessSwatch(theme: Theme, k: 1|2|3|4|5): string` = `compositeHex(TOKENS[theme]['transit-access-k'], TOKENS[theme].land, TRANSIT_ACCESS_OPACITY)`.
  - `ACCESS_LEGEND = ['200–1k', '1k–3k', '3k–10k', '10k–30k', '30k+']`: bin 1 starts at 200 and below 200 is transparent (`legend.ts:2-9`).
  - `useSystemTheme(): { readonly current: Theme; readonly resolved: boolean }` in `system-theme.svelte.ts`: one `matchMedia('(prefers-color-scheme: dark)')` listener per page, the same logic as `SimMap.svelte:390-396`. SimMap uses it instead of its inline effect. Its `themeProp ?? systemTheme` derivation (`:142`) is unchanged.
  - `ViewMenu` props: `{ view: ViewPrefs; theme: Theme; onchange(v: ViewPrefs): void }`. `theme` is required and its own `matchMedia` (`ViewMenu.svelte:18-27`) is removed. Pages pass `theme={systemTheme.current}`, the same source SimMap resolves to when no `theme` prop is given. A page that passes SimMap an explicit `theme` passes the same value here.
  - *Builder's call:* a shared source, not an `ontheme` callback threaded through `BrushEditor` and `FzpMode`. It gives the same value with no plumbing through components plans 1 and 2 are rewriting.

- [ ] **Step 1: Write the failing tests**
  - `legend.spec.ts`: `expect(ACCESS_LEGEND).toEqual(['200–1k', '1k–3k', '3k–10k', '10k–30k', '30k+'])`, and each label's lower edge equals `ACCESS_BINS[k]` (parse `200` / `1k`=1000 …).
  - `palette.spec.ts`: `compositeHex('#FFFFFF', '#000000', 0.5)` is `'#808080'`; `accessSwatch('light', 5)` is `compositeHex('#167A6E', '#F3EFE6', 0.45)`; `${theme}: legend swatch contrast with land strictly increases`.
  - `ViewMenu.svelte.spec.ts`: existing renders pass `theme: 'light'`. New test `swatches follow the theme prop`: render with `theme: 'dark'`, open it, and check the 5th capacity swatch's computed `background-color` equals `accessSwatch('dark', 5)` as `rgb()`. Then `rerender({ theme: 'light' })` and check it flips. New test `stop swatches use the stop tokens`.
  - `style.spec.ts`: the access layer's `fill-opacity` is `TRANSIT_ACCESS_OPACITY`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest --run --project server src/lib/transit src/lib/map/palette.spec.ts src/lib/map/style.spec.ts` then `npx vitest --run --project client src/lib/view`
Expected: FAIL.

- [ ] **Step 3: Implement it.** Wire `/` and `/p/[id]`. Plans 1 and 2 mount the View menu on `/sim` with the same `theme` source (see Interfaces at the end).

- [ ] **Step 4: Run them and confirm they pass**, plus SimMap's specs and `e2e/transit.spec.ts`

Run: `npx vitest --run --project client src/lib/view src/lib/map` then `npx playwright test e2e/transit.spec.ts`
Expected: PASS, including `the open View menu has no axe violations (dark)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/map src/lib/transit src/lib/view src/routes/+page.svelte "src/routes/p/[id]/+page.svelte"
git commit -m "fix(transit): legend matches bins and the map's 0.45 fill; View menu takes the map theme" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: App accent replaces Tailwind blue

**Files:**
- Modify: `src/routes/layout.css`, `src/lib/sharing/SharedBanner.svelte:69`, `src/lib/sharing/PublishButton.svelte:68`, `src/lib/sharing/PublishDialog.svelte:185`, `src/lib/scoreboard/TargetRow.svelte:35`, `src/lib/scoreboard/NeighborhoodList.svelte:23`, `src/lib/sim-page/RouteTimeline.svelte:318-324`
- Test: Create `src/lib/shell/accent.spec.ts` (server project)

**Interfaces:**
- Produces Tailwind 4 colours in one static `@theme` block, so classes like `bg-accent` and `dark:bg-accent-dark` exist:
  - `--color-accent: #A3472C`, `--color-accent-hover: #84371F`, `--color-on-accent: #FFFFFF`
  - `--color-accent-tint: #F6E3DB` (the editable segment fill; replaces `bg-blue-100`)
  - `--color-accent-dark: #E0955A`, `--color-accent-dark-hover: #EBAE7E`, `--color-on-accent-dark: #1C1D1F`
  - `--color-chrome-dark: #1C1D1F`, `--color-chrome-dark-raised: #2C2E31`
- *Builder's call:* static light and dark tokens, not one token redefined under `prefers-color-scheme`. Most panels (score details, shared banner, publish dialog, permitting timeline) have no dark variant. A switching token would put `#E0955A` on `gray-200` (about 1.9:1) when the OS is dark. Surfaces with a dark variant (Task 7) opt in with `dark:` classes.
- *Builder's call:* `#1C1D1F` text on the dark accent (6.92:1). White on `#E0955A` is 2.44:1 and fails. Dark hover `#EBAE7E` (8.75:1 with that text) is not in the spec; it lightens like the dark ramp.
- Mapping: `bg-blue-700` becomes `bg-accent`, `hover:bg-blue-800` becomes `hover:bg-accent-hover`, `bg-blue-600` becomes `bg-accent` (both bars; the primary bar keeps its height difference), `bg-blue-100` becomes `bg-accent-tint`, and `outline-blue-700` / `focus-visible:outline-blue-700` become `outline-accent`. `text-white` on those buttons becomes `text-on-accent`. `PublishButton` gets `dark:bg-accent-dark dark:text-on-accent-dark`, because it sits in the header (Task 7). The others stay light-only.

- [ ] **Step 1: Write the failing test** `accent.spec.ts`. Read `src/routes/layout.css` with `node:fs`, parse the `@theme` block's `--color-*: #hex` declarations, and assert:

```ts
it('declares the accent tokens', () => {
  expect(tok['accent']).toBe('#A3472C');
  expect(tok['accent-hover']).toBe('#84371F');
  expect(tok['accent-dark']).toBe('#E0955A');
});
it('on-accent text is ≥ 4.5:1 on accent and hover, light and dark', () => {
  expect(contrast(tok['on-accent'], tok['accent'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tok['on-accent'], tok['accent-hover'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tok['on-accent-dark'], tok['accent-dark'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tok['on-accent-dark'], tok['accent-dark-hover'])).toBeGreaterThanOrEqual(4.5);
});
it('accent fills are ≥ 3:1 on their tracks and backgrounds', () => {
  expect(contrast(tok['accent'], '#E5E7EB')).toBeGreaterThanOrEqual(3); // TargetRow track gray-200
  expect(contrast(tok['accent'], '#F3F4F6')).toBeGreaterThanOrEqual(3); // NeighborhoodList gray-100
  expect(contrast(tok['accent'], '#FFFFFF')).toBeGreaterThanOrEqual(3); // focus outline on white
  expect(contrast(tok['accent-dark'], tok['chrome-dark'])).toBeGreaterThanOrEqual(3);
  expect(contrast('#111827', tok['accent-tint'])).toBeGreaterThanOrEqual(4.5); // gray-900 text
});
it('light-only surfaces use the light accent: no colour token is redefined under dark', () => {
  expect(css).not.toMatch(/prefers-color-scheme[^}]*--color-accent/s);
});
it('no Tailwind blue remains in chrome', () => {
  for (const f of CHROME_FILES) expect(readFileSync(f, 'utf8')).not.toMatch(/\bblue-\d{3}\b/);
});
```

`CHROME_FILES` is the six component paths above plus `src/lib/shell/SiteHeader.svelte`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest --run --project server src/lib/shell/accent.spec.ts`
Expected: FAIL (no tokens; blue present).

- [ ] **Step 3: Add the `@theme` block and swap the classes.**

- [ ] **Step 4: Run it and confirm it passes**, plus the components' own specs and the share/scoreboard e2e axe scans

Run: `npx vitest --run --project server src/lib/shell/accent.spec.ts` then `npx vitest --run --project client src/lib/sharing src/lib/scoreboard src/lib/sim-page/RouteTimeline.svelte.spec.ts` then `npx playwright test e2e/share-a11y.spec.ts e2e/scoreboard.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/layout.css src/lib/shell/accent.spec.ts src/lib/sharing src/lib/scoreboard src/lib/sim-page/RouteTimeline.svelte
git commit -m "feat(ui): terracotta app accent replaces Tailwind blue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Paint/Simulate tabs and dark header and toolbars

**Files:**
- Modify: `src/lib/shell/SiteHeader.svelte:30,92-151`, `src/lib/fzp/TimeScrubber.svelte` (`<style>` only, `:203-245`)
- Test: `src/lib/shell/SiteHeader.svelte.spec.ts`, Create `e2e/chrome-dark.spec.ts`

**Interfaces:**
- Consumes: Task 6 colours.
- Produces:
  - **Tabs.** The mode links stay `<a>` in `<nav aria-label="Modes">` with `aria-current`. *Builder's call:* not `role="tab"`, because these are page navigation and the ARIA tab pattern is for in-page panels.
    - Current tab: `bg-accent text-on-accent dark:bg-accent-dark dark:text-on-accent-dark rounded-md px-2 cursor-default`, no underline, no hover change.
    - Other tab: `rounded-md px-2 hover:bg-gray-100 dark:hover:bg-chrome-dark-raised`, no underline.
    - Both keep `min-h-6` / `pointer-coarse:min-h-11`, and the focus ring is `outline-accent dark:outline-accent-dark`.
    - Same in the phone Menu panel.
  - **Dark header.** `<header>` gets `bg-white text-gray-900 dark:bg-chrome-dark dark:text-gray-100 dark:border-gray-700`. The phone panel's `max-md:bg-white` gets `dark:max-md:bg-chrome-dark`, and the Menu button border gets `dark:border-gray-600`.
  - **Dark timeline bar.** `TimeScrubber`'s `<style>` gets `@media (prefers-color-scheme: dark)`: bar `#1C1D1F` with border `#3B3D41`, `.ctl` `#232427` with border `#8F8A80`, text `#E8E4DC`, hover `#2C2E31`, `.pill` `#E8E4DC` on `#1C1D1F`. Light `accent-color` and focus `outline` become `#A3472C`; dark becomes `#E0955A`.
  - The brush toolbar is already themed from map tokens (`BrushToolbar.svelte:9-20`). Leave it alone.

- [ ] **Step 1: Write the failing tests**
  - `SiteHeader.svelte.spec.ts`, new `describe('mode tabs')` at 1024 and 375 (Menu open):
    - `the current tab is filled, not underlined`: the computed `background-color` of the `aria-current` link is `rgb(163, 71, 44)` and its `text-decoration-line` is `none`.
    - `the other tab is unfilled and not underlined`: its `background-color` is `rgba(0, 0, 0, 0)`.
    - `aria-current still marks the mode`: the existing tests at `:36-90` stay green.
    - Update the fixture string at `:319` from `bg-blue-700 text-white` to `bg-accent text-on-accent`.
  - `e2e/chrome-dark.spec.ts`, `colorScheme: 'dark'`, both Playwright projects:
    - `/ header has no axe violations in dark`: `expectNoA11yViolations(page, { include: ['header'] })`.
    - `/sim header and timeline bar have no axe violations in dark`: include `header` and `.sfh-fzp-scrubber`.
    - `at 375px the open Menu has no axe violations in dark`.
    - `the header is dark in dark mode`: the computed `background-color` of `header` is `rgb(28, 29, 31)`.
    - `light-only panels keep the light accent in dark mode`: open the score details on `/` and check the primary target bar fill (`[data-testid="bar-fill"]`) is `rgb(163, 71, 44)`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest --run --project client src/lib/shell/SiteHeader.svelte.spec.ts` then `npx playwright test e2e/chrome-dark.spec.ts`
Expected: FAIL (underlined links; white header).

- [ ] **Step 3: Implement** the snippet and class changes and the `<style>` dark block.

- [ ] **Step 4: Run them and confirm they pass**, plus the header and scrubber suites and the layout e2e

Run: `npx vitest --run --project client src/lib/shell src/lib/fzp/TimeScrubber.svelte.spec.ts` then `npx playwright test e2e/chrome-dark.spec.ts e2e/layout.spec.ts e2e/pages-a11y.spec.ts`
Expected: PASS, with no horizontal scroll at 375 px.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shell src/lib/fzp/TimeScrubber.svelte e2e/chrome-dark.spec.ts
git commit -m "feat(ui): Paint/Simulate as tabs; dark header and timeline bar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Map goldens and full verification

**Files:**
- Modify: `e2e/map.spec.ts-snapshots/map-light-chromium-darwin.png`, `map-dark-chromium-darwin.png`

- [ ] **Step 1: Regenerate the E9 goldens on darwin.** The dark one changes with the dark `replaced`/`road` values. The light one changes if `small.json`'s painted lots exceed their physical max.

Run: `npx playwright test e2e/map.spec.ts -g "E9" --project chromium --update-snapshots`
Expected: two PNGs are written. Open both and look at them: buildings are terracotta, roads in dark are slightly lighter than before, and there is no blue except water.

- [ ] **Step 2: Run the full gate**

Run: `npm run check` then `npm run lint` then `npm run test:unit` then `npm run test:pipeline` then `npm run test:e2e`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/map.spec.ts-snapshots
git commit -m "test(map): regenerate E9 goldens for the new palette" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Live dataset rebuild and promotion (operator step)

The generator is inside the `datasetVersion` hash (`docs/dev/pipeline.md`, "Lock and `datasetVersion`"), so merging Tasks 1–2 means a new live dataset version. The builder does **not** run this. It needs the source cache (`pipeline/.cache`, or R2 to restore it), R2 credentials, and the merge to `main`.

**Who runs what:**
- **Builder (this plan):** Tasks 1–8 and the signoff/PR for this branch. In the PR body, say that a dataset rebuild follows the merge and link this task.
- **Operator (the partner, or a maintainer with R2 access), after the merge, on a clean checkout of `main`.** The hash includes uncommitted changes under the hashed paths, so build from a clean tree.
  1. Cache: if `pipeline/.cache` is missing, run `npm run pipeline -- fetch --restore`. Do **not** run `fetch` to refresh: the sources haven't changed, and a refresh would move `asOf` and the date part of the version for no reason.
  2. Build: `npm run pipeline -- build` (warm 5–8 min, cold 15–25). Every invariant must pass without `--skip-tiles`. Record `<v>` from `out/`. Check `report.json`'s V17 net-capacity line: it warns outside 0.25×–4× Planning's ~780,000, and the clamp lowers it.
  3. Upload: `npm run pipeline -- upload <v>`. The lock is unchanged, so its `lockSha256` check passes.
  4. Verify: `npm run pipeline -- verify <v> --origin https://<staging-origin>`.
  5. Staging: a PR that bumps `env.staging.vars.PUBLIC_DATASET_VERSION` in `wrangler.jsonc` to `<v>`, titled `chore(data): point staging at dataset <v>` (`docs/dev/deploy.md`, "Promoting a datasetVersion" step 2). Merge it, let staging deploy, and check `/attribution`, the map and `/sim`.
  6. Production: a later PR that bumps the top-level `PUBLIC_DATASET_VERSION`, titled `data: point production at dataset <v>` (not `chore`, so release-please picks it up), then merge the release PR.
- **Timing trap:** until staging points at `<v>`, the staging worker's own recomputes (painting, `/sim` policy) are clamped while the shipped `parcels.bin` baseline yields are not. Comparisons there overstate "your policy vs FZP". Do steps 1–5 promptly after the merge, and don't cut a production release with the generator change but without the production dataset bump.

- [ ] **Step 1 (builder):** Add a "Dataset rebuild required" section to the PR body with the operator steps above (`gh pr create --body-file <tmpfile>`).

---

## Open questions (partner)

1. **Brush ring and painted outline light colour.** The spec's `#BF5A3A` fails 3:1 on light existing buildings (2.89). The plan uses `#B4532F`. Alternative: the accent `#A3472C` (3.91), which ties the brush to the accent more visibly. *Recommendation:* `#B4532F`, the smallest departure.
2. **Planning-ghost tint.** The spec's `#E3C8DA` / `#5A3550` sit just under the ΔE ≥ 20 distinctness guard against existing buildings. The plan uses `#DDBBD2` / `#623257`. *Recommendation:* keep the guard and the nudged values.
3. **"Buildable here: M" on a lot under 400 m².** The spec's table gives the physical max (25×100 → 6), but `selectTypology` still caps lots under 400 m² at a 5-story walkup, so the generator builds 5 there. *Recommendation:* plan 2's tooltip should show the worker's generated stories when it has them (`ParcelSummaryLike.generated.stories`, `src/lib/map/types.ts:107`), else `lotBuildableStories`, not `lotPhysicalMaxStories`. Otherwise the tooltip promises a 6th floor the map never draws.
4. **Bus stops over the strongest access fill.** Light bus `#5E7A76` on `transit-access-5` at 0.45 over land is about 2.2:1. That is no worse than today's palette (about 2.3:1), and stops keep their white stroke. *Recommendation:* accept for this pass, and re-check on the map in review.
5. **`/fzp` chart series** (`src/lib/fzp/chart.ts:16` `total: '#1d4ed8'`; `ScoreChart.svelte:221` copy mentions "violet lines"). The rule "blue and violet only for water" arguably covers chart lines, but they are not map overlays or chrome accent. *Recommendation:* leave them for the methodology/charts pass; out of scope here.

## Spec / code contradictions found

- §3a table "Hybrid" column against the generator: on lots under 400 m² (25×100, 25×120) the built stories stay 5, because the `selectTypology` cascade, which the spec keeps, caps them (`select.ts:18-21`). The column is the physical max, not the built height. See open question 3.
- §8 brush-ring and planning-ghost hex against the WCAG 1.4.11 test and the ΔE guard: ruled above.
- §8 stop colours (one teal family) against `palette.spec.ts:48-55` ΔE ≥ 20: the guard is rewritten to lightness ordering plus ΔE ≥ 8.
- `ViewMenu` "takes the map's theme": no page passes SimMap a `theme` today (`SimMap.svelte:142` falls back to `matchMedia`), so "the map's theme" is the system theme, through one shared source.

## Interfaces (for plans 1 and 2)

```ts
// $lib/generator (src/lib/generator/physical.ts, re-exported from src/lib/generator/index.ts)
import type { Site } from '$lib/generator';
import type { ParcelRecord } from '$lib/data/parcel';

/** The geometry the rule reads: canonical ring (local m), area (m²), centroid, minor axis. */
export type PhysicalSite = Pick<Site, 'P' | 'A' | 'c' | 'v'>;

/** Spec §3a hybrid rule; integer in [5, 80]. Pure, deterministic, no transcendentals. */
export function physicalMaxStories(site: PhysicalSite): number;

/** Physical max for a parcel polygon (ParcelRecord.polygon, local metres); null if degenerate. */
export function lotPhysicalMaxStories(polygon: ParcelRecord['polygon']): number | null;

/**
 * Stories the generator would aim for under `allowedStories`: the physical max, then the
 * typology cascade. A pre-massing estimate; the built building can be lower (tower → midrise
 * 12 fallback) or absent (no gain). Null if degenerate or allowedStories < 1.
 */
export function lotBuildableStories(
  polygon: ParcelRecord['polygon'],
  allowedStories: number,
  existingUnits: number
): number | null;

// `generate` / `generateWith` / `generateDetailed` now build at most physicalMaxStories(site);
// envelopes need no pre-clamping by callers (plan 1's resolution step 5 is inside the generator).
// generateForUnits is not clamped (recorded projects).

// $lib/map/palette — new TokenName values, both themes (hex or rgba()):
//   'height-fog' | 'brush-paint' | 'brush-erase' | 'painted-outline'
export const TRANSIT_ACCESS_OPACITY: 0.45;
export function compositeHex(fg: string, bg: string, alpha: number): string;
export function accessSwatch(theme: Theme, k: 1 | 2 | 3 | 4 | 5): string;

// $lib/map/system-theme.svelte.ts
export function useSystemTheme(): { readonly current: Theme; readonly resolved: boolean };

// $lib/view/ViewMenu.svelte props (theme now required)
interface ViewMenuProps { view: ViewPrefs; theme: Theme; onchange(v: ViewPrefs): void }

// src/routes/layout.css @theme colours (Tailwind classes bg-accent, text-on-accent, …):
//   accent #A3472C · accent-hover #84371F · on-accent #FFFFFF · accent-tint #F6E3DB
//   accent-dark #E0955A · accent-dark-hover #EBAE7E · on-accent-dark #1C1D1F
//   chrome-dark #1C1D1F · chrome-dark-raised #2C2E31
// Light-only surfaces use the light tokens; dark-variant surfaces add dark:…-dark classes.
```
