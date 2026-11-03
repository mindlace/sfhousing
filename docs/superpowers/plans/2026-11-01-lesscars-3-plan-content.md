# /lesscars Plan 3 of 3: Wiring the Approved Plan into the Live Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live dataset carries the owner-approved fewer-cars plan: `pipeline/enrichment/lesscars/plan.json` transcribed from `docs/lesscars/plan-v1.md` Appendix A, the street centrelines in the lock, a full local build with the paired runs, the measured answer recorded, the page reachable from the header, and the dataset uploaded and promoted through the normal release flow.

**Architecture:** No new mechanism for the answer itself: Plan 1's step reads `LESSCARS_PLAN_JSON.live` (`pipeline/lesscars-config.ts:49-52`, chosen in `pipeline/steps/build.ts:287`) once the file exists. Three small additions make Appendix A buildable and checkable: whole-month durations become calendar months (Appendix A fails `checkPlan` by one day otherwise, see Task 1), an optional `opensAfter` link carries the owner's "phase 2 opens after phase 1" check, and a corridor resolver turns Appendix A's street selectors into CNN lists from the locked `datasf-streets` source so a reviewer can re-run it. The heavy build runs on the owner's laptop inside this session.

**Tech Stack:** TypeScript, Vitest (server, client, pipeline projects), DuckDB spatial (`@duckdb/node-api`), tsx, SvelteKit 2 + Svelte 5 runes, Playwright + axe, wrangler (R2 upload).

**Spec:** `docs/superpowers/specs/2026-11-01-lesscars-design.md` ("Drafting the plan", "How it gets made", "Heavy work stays off CI", Anti-goals). The approved plan: `docs/lesscars/plan-v1.md` (Appendix A is the source of every value; owner answers under "Open questions for the owner"; approval line at the end). Plans 1 and 2 as built: `docs/superpowers/plans/2026-11-01-lesscars-1-pipeline.md`, `docs/superpowers/plans/2026-11-01-lesscars-2-page.md`, `docs/dev/lesscars.md`. Release flow: `docs/dev/pipeline.md` ("Release run order"), `docs/dev/deploy.md` ("Promoting a datasetVersion").

## Global Constraints

- The plan file is a transcription of the approved document's Appendix A: no number enters `plan.json` without its tier and source from the document; a change found necessary while wiring goes back to the owner, not into the file silently.
- If Appendix A proves unbuildable as written (after Task 1's calendar-month fix: `checkPlan` or a dataset check fails, a selector does not resolve, or the Geary carve falls outside its band), the task **stops and reports** the exact problem. It never edits a number, a date, a dependency or a parcel to make the build pass.
- The full paired run happens in the local `npm run pipeline -- build` on the owner's laptop, in this session, never in CI. If the build's `lesscars` step (`report.json` `timings.lesscars`) exceeds **30 minutes**, reduce `LIVE_PROFILE.lesscarsSeeds` (`pipeline/config.ts:205`, keep it odd) and record the band width at both counts.
- Upload, verify and both `PUBLIC_DATASET_VERSION` bumps are done in this plan by the controller (owner's authorisation, 2026-11-02), through the normal flow and nothing else: `docs/dev/pipeline.md` "Release run order" steps 3–6, then `docs/dev/deploy.md` "Promoting a datasetVersion" (staging bump PR titled `chore(data): point staging at dataset <v>`, staging check, then a later PR titled `data: point production at dataset <v>`). Merging the release PR (cutting the release that puts it live) stays with the owner.
- Hashed-paths freeze: `datasetVersion` hashes the committed code under `pipeline/`, `src/lib/data/`, `src/lib/generator/`, `src/lib/timelapse/`, `src/lib/plan/geometry.ts` and `src/lib/plan/types.ts` (`docs/dev/pipeline.md` "Lock and datasetVersion"). Every change there lands before Task 7's build. After it, nothing under those paths changes until the upload; if one must (or `origin/main` brings one), rebuild.
- No change to `/sim`'s behaviour, its levers, `FzpMode`, `ScoreBar`, `TimeScrubber` or the scenario host (Plan 2 constraint; FzpMode is frozen).
- WCAG 2.2 AA (`docs/dev/accessibility.md`): `expectNoA11yViolations` clean; targets at least 24x24 px; map state never by colour alone.
- JSON under `pipeline/enrichment/` is prettier-checked (`.prettierignore` does not exclude it): run `npx prettier --write <file>` on every authored or generated JSON file before committing.
- `fixture-0` and `pipeline/test/fixtures/mini/golden/` are regenerated only by `npm run pipeline -- fixture --update-golden`; never hand-edit them.
- Tests: Vitest with `expect.requireAssertions` (every test calls `expect`); colocated specs; e2e under both Playwright projects (`chromium`, `mobile` 375 px) on `fixture-0`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits. No Claude attribution anywhere (no `Co-Authored-By`, no generated-with footers). Multi-line commit messages through a temp file and `git commit -F`, never heredocs. Never compound `cd … && cmd`. Never bare `git stash`.
- No new runtime dependency. CSP unchanged.

## Review Focus

1. **Off-by-one-day schedule.** Appendix A counts a 36-month project from 2029 as opening on 1 January 2032, and parking conversions start that day. With `MONTH_DAYS` rounding the open day is 2032-01-02, so five conversions fail `starts-before-dependency` and transit capacity reads 6 of 4 on 2032-01-01 (measured against the current `schedule.ts` while drafting this plan). Expected: whole months are calendar months, and a dependant may start on its dependency's open day. Test: Task 1 Step 1 (`monthsAfter …`, `a dependant may start on the day a 36-month dependency opens`) and Task 4 Step 1 (`checkPlan on the live plan is empty`).
2. **A selector that grabs the wrong street.** A street name used in two places (or a parallel carriageway, or a stretch past the named cross street) must give only the named stretch, both carriageways included. Expected: only segments of that street on the shortest path between its crossings with FROM and TO, plus parallel same-name segments within the band. Test: Task 2 Step 1 (`a same-named street elsewhere is excluded`, `both carriageways are included`, `a segment past TO is excluded`).
3. **The Geary strip erased by its own twins.** The trench's main lanes share one centreline with their twins and the Fillmore frontage roads; a kept twin's `keepHalfM` corridor removes most of the freed strip (plan-v1, "Plan 3 carving check for the trench"). Expected: all fourteen CNNs listed as removed, and a carved area near plan-v1's ~1.8 ha. Test: Task 4 Step 1 (`geary-trench removes the main lanes, their twins and the Fillmore frontage roads`); measured in Task 7 Step 4.
4. **Phase 2 opening before phase 1.** The format had only "starts after a dependency opens". Expected: a plan where a project opens before a project it `opensAfter` fails `checkPlan` with `opens-before`, and the live plan passes. Test: Task 1 Step 1 (`opensAfter: …`), Task 4 Step 1.
5. **The live headline overflowing the phone header.** Fixture-0's "+260" fits; a live "+12,345 homes by 2068" may not. Expected: no horizontal overflow at 375 px with a six-digit headline, and the accessible name keeps "homes by 2068". Test: Task 6 Step 1 (`at 375 px a six-digit headline fits beside the Menu`).

Also pinned: swapped `[lat, lng]` in a new stop (Task 1 range check, Task 4 `every new stop lies in San Francisco`).

---

## Decisions (builder's calls; the owner may revisit any)

- **Calendar months.** `schedulePlan` adds whole months as calendar months (`Date.UTC(y, m + k, d)`) and only a fractional remainder as `round(frac × MONTH_DAYS)` days. Reason: plan-v1's Method says a project opens at "`startYear` + `durationMonths`", and Appendix A's schedule relies on 36 months from 1 January 2029 being 1 January 2032. No plan number changes.
- **`opensAfter`.** An optional `opensAfter: string[]` on any project; `checkPlan` reports `opens-before` when the project opens before any project it names, and `unknown-dependency` for an unknown id. Reason: the owner asked for a check (plan-v1 answer 6), and putting it in the data keeps it in `checkPlan`, which both the build step and V35 run. A plan without the key parses to an object without it, so the fixture plan and goldens do not change for it.
- **Coordinate range.** The plan parser rejects any `[lng, lat]` with `lng` outside [-180, 180] or `lat` outside [-90, 90] (stops, alignments, drawn lines). This is Plan 1's stop range validation; the live-plan test adds that every new stop lies in a San Francisco box. Reason: a swapped pair then fails at parse with a path, not as a stop in the ocean.
- **Cross-street names.** The `datasf-streets` fetch also selects `f_st` and `t_st`, normalised into `src_streets`. Reason: Appendix A's `JUNIPERO SERRA BLVD, 19TH AVE → COUNTY LINE` names no street at its south end, and DataSF records "COUNTY LINE" in `t_st` (checked against the live API while drafting: CNNs `7710106`, `7710207`). Without them, that selector cannot be resolved from the locked source.
- **Corridor resolver as a pipeline command.** `npm run pipeline -- lesscars-cnns` reads the selectors in `pipeline/enrichment/lesscars/corridors.json`, normalises the locked `datasf-streets` raw files and writes `corridors.resolved.json` (CNN lists, lengths, the source sha256). Plan CNN lists must equal it (Task 4 test). Reason: reproducible from the lock, re-runnable by a reviewer, and its result is committed for diffing.
- **Geary trench lists fourteen CNNs.** Main lanes `6039201`, `6040201`, `6041201`, twins `6039101`, `6039102`, `6040102`, `6040103`, `6040104`, `6041101`, and the Fillmore frontage roads `6041102`, `6041103`, `6041202`, `6041203`, `6041204` (plan-v1 Data findings). Reason: plan-v1 leaves Plan 3 the choice; in the data all share one centreline, so keeping the frontage roads would erase the block around Fillmore, while the design's kept surface streets lie outside the 20 m strip (`rowHalfWidthM` 10) either way.
- **Masonic display.** `displays: [{ id: 'masonic-station', label: 'Masonic underpass filled: Geary at grade at the Masonic station', segments: <resolved GEARY BLVD, PRESIDIO AVE → WOOD ST>, from: 'geary-subway-1' }]`. Display only: no project, no roundabout, no capacity (owner, 2026-11-01). The selector spans the underpass approaches either side of Masonic (DataSF CNNs `6046101`/`6046201` Presidio–Masonic and `6047101`/`6047201` west of Masonic).
- **Start-year evidence is not carried.** Appendix A gives `PV-start-subway` and a tier-4 note on two `startYear` values, but `startYear` is a plain integer in the format (`plan.ts:66`) and the spec's Goal 4 lists durations, capacities, frequencies and footprints. They stay in plan-v1; `PV-start-subway` is not in `plan.json`.
- **Three PRs.** The feature PR (this branch), then the staging bump PR, then the production bump PR, as `deploy.md` prescribes. Reason: a staging-only bump must not open a release on its own.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/data/lesscars/schedule.ts` (+ `schedule.test.ts`) | `monthsAfter`; calendar-month times; `opens-before` | 1 |
| `src/lib/data/lesscars/plan.ts` (+ `plan.test.ts`) | optional `opensAfter`; coordinate range | 1 |
| `pipeline/test/fixtures/mini/golden/`, `e2e/fixtures/data/fixture-0/` | regenerated for the day shifts | 1 |
| `pipeline/sources/datasf.ts`, `pipeline/sources/normalise.ts` (+ `fetch.test.ts`, `normalise.test.ts`) | `f_st`, `t_st` in `src_streets` | 2 |
| `pipeline/lib/lesscars/corridors.ts` (+ `pipeline/test/lesscars-corridors.test.ts`) | pure selector → CNN resolution | 2 |
| `pipeline/steps/lesscars-cnns.ts`, `pipeline/cli.ts` | `lesscars-cnns` command | 2 |
| `pipeline/enrichment/lesscars/corridors.json` | Appendix A selectors plus Masonic, verbatim | 2 |
| `pipeline/sources.lock.json`, `pipeline/enrichment/lesscars/corridors.resolved.json` | locked centrelines; resolved CNNs | 3 |
| `pipeline/enrichment/lesscars/plan.json`, `pipeline/test/lesscars-live-plan.test.ts` | the live plan and its transcription test | 4 |
| `src/lib/shell/SiteHeader.svelte` (+ spec), `e2e/lesscars.spec.ts` | "Fewer cars" mode link | 5 |
| `src/lib/lesscars/HeadlineBar.svelte`, `legend.ts`, `DetailsPanel.svelte`, `TimelineDialog.svelte` (+ specs), `e2e/lesscars.spec.ts` | live-scale fit, stop key rows, dark-mode axe | 6 |
| `docs/dev/lesscars.md` | format changes, corridors, First live build, live check | 1, 2, 7, 8 |
| `docs/dev/pipeline.md`, `CLAUDE.md` | streets columns, `lesscars-cnns` command | 2 |
| `wrangler.jsonc` | `PUBLIC_DATASET_VERSION` bumps (separate PRs) | 9 |

---

### Task 1: Calendar months, `opensAfter`, coordinate range

**Files:**
- Modify: `src/lib/data/lesscars/schedule.ts:37-64` (`months`, `schedulePlan`), `:66-79` (`PlanProblemCode`), `:127-258` (`checkPlan`)
- Modify: `src/lib/data/lesscars/plan.ts:63-69` (`ProjectBase`), `:197-201` (`lngLat`), `:291-314` (`BASE_KEYS`, `parseProject`)
- Test: `src/lib/data/lesscars/schedule.test.ts`, `src/lib/data/lesscars/plan.test.ts`
- Regenerate: `pipeline/test/fixtures/mini/golden/scenarios/lesscars/`, `e2e/fixtures/data/fixture-0/`
- Modify: `docs/dev/lesscars.md` ("The plan format", "Checks", builder's calls)

**Interfaces:**
- Consumes: `yearStart(year): Day` (`schedule.ts:19`), `MONTH_DAYS` (`src/lib/timelapse/time.ts:10`), `record(v, path, keys, optional)` (`plan.ts:150`).
- Produces:
  - `export function monthsAfter(start: Day, months: number): Day` in `schedule.ts`: the UTC date of `start` plus `Math.floor(months)` calendar months, plus `Math.round((months - Math.floor(months)) * MONTH_DAYS)` days. `schedulePlan` uses it for `openDay` and `build.completeDay`.
  - `ProjectBase.opensAfter?: string[]` (key absent when the input omits it).
  - `PlanProblemCode` gains `'opens-before'`; message `${p.id} opens before ${q.id} opens`.
  - `parseLessCarsPlan` throws `PlanFormatError` at the point's path (`projects.<i>.stops.<j>.lngLat`, `….alignment.<k>`, `….segments.<s>.line.<k>`) for `lng` outside [-180, 180] or `lat` outside [-90, 90].

- [ ] **Step 1: Write the failing tests**

```ts
// schedule.test.ts
it('monthsAfter: whole months are calendar months, a fraction adds days', () => {
  expect(monthsAfter(yearStart(2029), 36)).toBe(yearStart(2032));
  expect(monthsAfter(yearStart(2032), 108)).toBe(yearStart(2041));
  expect(monthsAfter(yearStart(2033), 30)).toBe(Date.UTC(2035, 6, 1) / 86400000);
  expect(monthsAfter(yearStart(2030), 0.5)).toBe(yearStart(2030) + 15);
});
it('a dependant may start on the day a 36-month dependency opens', () => {
  // bus lane 2029 + 36 months; parking conversion 2032 depending on it; transit cap 2 with two
  // bus lanes 2029 and two transit lines starting 2032
  expect(codes(checkPlan(plan, schedulePlan(plan)))).not.toContain('starts-before-dependency');
  expect(codes(checkPlan(plan, schedulePlan(plan)))).not.toContain('capacity');
});
it('opensAfter: opening before the named project is opens-before; equal or later passes', () => {
  expect(codes(check(early))).toContain('second:opens-before');
  expect(codes(check(sameDay))).not.toContain('second:opens-before');
  expect(codes(check(unknownName))).toContain('second:unknown-dependency');
});
// plan.test.ts
it('opensAfter parses when present and is absent from the object when omitted', () => {
  expect(parseLessCarsPlan(withOpensAfter).projects[1].opensAfter).toEqual(['first']);
  expect('opensAfter' in parseLessCarsPlan(tiny).projects[0]).toBe(false);
});
it('rejects a point outside lng/lat range, naming its path', () => {
  expect(() => parseLessCarsPlan(swappedStop)).toThrow(/projects\.0\.stops\.0\.lngLat/);
  expect(() => parseLessCarsPlan(badAlignment)).toThrow(/projects\.0\.alignment\.1/);
  expect(() => parseLessCarsPlan(badLine)).toThrow(/projects\.2\.segments\.0\.line\.0/);
});
```

Existing `schedule.test.ts` cases with hard-coded open days computed from `MONTH_DAYS` are updated to the calendar-month day.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/data/lesscars`
Expected: FAIL (`monthsAfter` not exported; `opensAfter` unknown key; no range error).

- [ ] **Step 3: Implement `monthsAfter`, `opensAfter`, `opens-before` and the range check**

`parseProject` passes `['opensAfter']` as the optional key list to `record` and sets the property only when present (`strings(...)`). In `checkPlan`, check `opensAfter` beside the dependency loop (`schedule.ts:185-190`); it is not part of the cycle search.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest --run --project server src/lib/data/lesscars`
Expected: PASS.

- [ ] **Step 5: Regenerate the fixture and goldens**

Run: `npm run pipeline -- fixture --update-golden`
Expected: the diff under `pipeline/test/fixtures/mini/golden/scenarios/lesscars/` and `e2e/fixtures/data/fixture-0/scenarios/lesscars/` is open, available and build days moving by a day or two (plus whatever those days feed: regime days, timeline schedules, summary). No other golden changes. Then `npm run test:pipeline` PASS and `npx playwright test e2e/lesscars.spec.ts` PASS (it reads every expected value from disk).

- [ ] **Step 6: Update `docs/dev/lesscars.md`**

"The plan format": a project opens `durationMonths` calendar months after 1 January of `startYear`; optional `opensAfter`; coordinates must be in range. "Checks": `opens-before`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/data/lesscars pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0 docs/dev/lesscars.md
git commit -m "feat(lesscars): calendar-month schedule, opensAfter check, coordinate range"
```

---

### Task 2: Cross-street names and the corridor resolver

**Files:**
- Modify: `pipeline/sources/datasf.ts:183-191` (`datasf-streets` `select`), `pipeline/sources/normalise.ts:51-52` (`EMPTY_SELECT`), `:260-267` (`buildSelect` case)
- Create: `pipeline/lib/lesscars/corridors.ts`, `pipeline/steps/lesscars-cnns.ts`, `pipeline/enrichment/lesscars/corridors.json`
- Modify: `pipeline/cli.ts` (new `lesscars-cnns` entry in `steps`)
- Test: `pipeline/test/lesscars-corridors.test.ts` (create), `pipeline/test/fetch.test.ts:536-539`, `pipeline/test/normalise.test.ts`
- Modify: `docs/dev/pipeline.md` (streets paragraph line 5, Commands table), `docs/dev/lesscars.md` ("Streets and freed land"), `CLAUDE.md` (pipeline command list)

**Interfaces:**
- Consumes: `normalise(db, id, rawFiles, outParquet)` (`normalise.ts:290`), `readLock` / `rawPath` (`pipeline/lib/lock.ts:54,77`), `openDuck` (`pipeline/lib/duck.ts`).
- Produces:

```ts
// pipeline/lib/lesscars/corridors.ts
export interface StreetSeg {
  cnn: string;
  streetname: string;
  fSt: string | null;
  tSt: string | null;
  /** Vertices in EPSG:7131 metres; one entry per LineString part. */
  lines: [number, number][][];
}
export interface CorridorSelector { owner: string; street: string; from: string; to: string }
export interface ResolvedCorridor extends CorridorSelector { cnn: string[]; lengthM: number }
export const COUNTY_LINE = 'COUNTY LINE';
export const CORRIDOR = { snapM: 0.5, crossM: 25, bandM: 40 } as const;
export class CorridorError extends Error {}
/** Throws CorridorError naming the selector when it does not resolve. */
export function resolveCorridor(segs: readonly StreetSeg[], sel: CorridorSelector): ResolvedCorridor;
/** Resolves every selector; throws one CorridorError listing every failure. */
export function resolveCorridors(
  segs: readonly StreetSeg[],
  sels: readonly CorridorSelector[]
): ResolvedCorridor[];

// pipeline/steps/lesscars-cnns.ts
export const CORRIDORS_JSON: string; // pipeline/enrichment/lesscars/corridors.json
export const CORRIDORS_RESOLVED_JSON: string; // pipeline/enrichment/lesscars/corridors.resolved.json
export async function lesscarsCnns(a: {
  lockPath: string;
  rawDir: string;
  inPath?: string;
  outPath?: string;
}): Promise<number>; // exit code
```

- `corridors.json`: `{ "schema": 1, "corridors": CorridorSelector[] }`.
- `corridors.resolved.json`: `{ "schema": 1, "source": { "id": "datasf-streets", "sha256": string[] }, "corridors": ResolvedCorridor[] }`, `sha256` the lock entry's file hashes in lock order, `cnn` sorted, `lengthM` rounded to 0.1.

Resolution rule (the tests do not fully determine it):

1. Candidates are the `src_streets` rows with `streetname === street`. Nodes are their line endpoints snapped to `snapM`; edges are the segments, weighted by length.
2. FROM nodes: candidate nodes within `crossM` of any line of a segment named `from`. When `from` (or `to`) is `COUNTY_LINE`: the nodes of degree 1 that end a candidate whose `fSt` or `tSt` is `COUNTY LINE`.
3. The path is the shortest (Dijkstra, multi-source to multi-target) from any FROM node to any TO node. No FROM node, no TO node or no path: `CorridorError` (`<owner>: <street>, <from> → <to>: no crossing with <from>` / `… no path`).
4. The corridor is the path's segments plus every candidate whose every vertex lies within `bandM` of the path polyline (the other carriageway, a twin). `lengthM` sums the corridor's segments.

- [ ] **Step 1: Write the failing tests**

```ts
// pipeline/test/lesscars-corridors.test.ts (synthetic segments in metres)
it('resolves a straight chain between two cross streets', () => {
  expect(resolveCorridor(grid, sel('MAIN ST', 'A ST', 'C ST')).cnn).toEqual(['m-ab', 'm-bc']);
});
it('a segment past TO is excluded', () => {
  expect(resolveCorridor(grid, sel('MAIN ST', 'A ST', 'C ST')).cnn).not.toContain('m-cd');
});
it('both carriageways and a shared-centreline twin are included', () => {
  expect(resolveCorridor(divided, sel('WIDE BLVD', 'A ST', 'B ST')).cnn).toEqual(['w-n', 'w-s', 'w-twin']);
});
it('a same-named street elsewhere is excluded', () => {
  expect(resolveCorridor(twoTowns, sel('MAIN ST', 'A ST', 'B ST')).cnn).not.toContain('far-main');
});
it('COUNTY LINE ends at the dead end whose t_st says so', () => {
  expect(resolveCorridor(county, sel('LONG BLVD', 'A ST', COUNTY_LINE)).cnn).toEqual(['l-1', 'l-2']);
});
it('no crossing or no path throws naming the owner and the selector', () => {
  expect(() => resolveCorridor(grid, sel('MAIN ST', 'NOPE ST', 'C ST'))).toThrow(/x: MAIN ST, NOPE ST → C ST: no crossing with NOPE ST/);
});
it('resolveCorridors lists every failure in one error', () => {
  expect(() => resolveCorridors(grid, [bad1, bad2])).toThrow(/bad1[\s\S]*bad2/);
});
// normalise.test.ts
it('src_streets carries f_st and t_st, NULL when the raw file lacks them', async () => {
  expect(columns).toEqual(expect.arrayContaining(['f_st', 't_st']));
});
// fetch.test.ts:536 — the select now names f_st and t_st
expect(DATASF['datasf-streets'].select).toBe('cnn,streetname,classcode,layer,active,f_st,t_st,line');
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-corridors.test.ts pipeline/test/normalise.test.ts pipeline/test/fetch.test.ts`
Expected: FAIL (module missing; columns missing; select differs).

- [ ] **Step 3: Implement the source columns, `corridors.ts`, `lesscars-cnns.ts` and the CLI entry**

`buildSelect`'s streets case adds `${txt(cols, 'f_st')}, ${txt(cols, 't_st')}` (null-safe for the mini raw file, which has neither); `EMPTY_SELECT` adds the two `NULL::VARCHAR` columns. `lesscarsCnns` exits 1 with a message when the lock has no `datasf-streets` entry or a raw file is missing; otherwise it normalises that entry's raw files to a temp parquet, reads `cnn, streetname, f_st, t_st, ST_AsGeoJSON(geom)`, resolves, and writes the output only when every selector resolves (else prints the `CorridorError` and exits 1). CLI help: `resolve the /lesscars corridor selectors to CNNs from the locked datasf-streets source`.

- [ ] **Step 4: Write `pipeline/enrichment/lesscars/corridors.json`**

One entry per Appendix A selector, `owner` the project id, strings verbatim from Appendix A (upper case as written), in Appendix A order: `fulton-brt` (2), `19th-ave-brt` (3), `lombard-bus-lane` (2), `n-judah-priority` (4), `j-church-priority` (2), `k-ocean-priority` (1), `van-ness-street` (1), `fell-oak-street` (2), `irving-pedestrian` (1), `columbus-pedestrian` (1); then `{ "owner": "masonic-station", "street": "GEARY BLVD", "from": "PRESIDIO AVE", "to": "WOOD ST" }`. 20 entries. `geary-trench` and `central-freeway-stub` are not selectors (CNNs and a line). Run `npx prettier --write` on it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-corridors.test.ts pipeline/test/normalise.test.ts pipeline/test/fetch.test.ts`, then `npm run test:pipeline`
Expected: PASS; the golden test unchanged (`src_streets` columns feed no published file).

- [ ] **Step 6: Docs**

`docs/dev/pipeline.md`: the streets paragraph names `f_st`/`t_st`; the Commands table gets `lesscars-cnns` (reads the lock's raw files, no network). `docs/dev/lesscars.md` "Streets and freed land": the selector format, the resolution rule above, `CORRIDOR` values (all tier 4, builder's), and that plan CNN lists must equal `corridors.resolved.json`. `CLAUDE.md`'s `npm run pipeline -- <cmd>` row lists `lesscars-cnns`.

- [ ] **Step 7: Commit**

```bash
git add pipeline docs/dev CLAUDE.md
git commit -m "feat(lesscars): resolve plan street selectors to CNNs from the locked streets source"
```

---

### Task 3: Lock the street centrelines and resolve the corridors

Run by the controller, in this session (needs `wrangler login` for the R2 archive and network access to DataSF).

**Files:**
- Modify: `pipeline/sources.lock.json` (adds the `datasf-streets` entry)
- Create: `pipeline/enrichment/lesscars/corridors.resolved.json`

**Interfaces:**
- Consumes: `fetch --restore`, `fetch --only datasf-streets` (`pipeline/steps/fetch.ts:80-131`), `lesscars-cnns` (Task 2).
- Produces: the lock that Task 7 builds from; `corridors.resolved.json` that Task 4's test compares against.

- [ ] **Step 1: Restore the raw cache**

No `pipeline/.cache` exists in this worktree or the main checkout. Run: `npm run pipeline -- fetch --restore`
Expected: `restore: N downloaded, 0 already present`, N the file count of the committed lock.

- [ ] **Step 2: Fetch the centrelines**

Run: `npm run pipeline -- fetch --only datasf-streets`
Expected: `datasf-streets: k file(s), ~16,000 rows` (active centrelines; the 2026-11-02 API count by layer sums to 16,378) and `wrote … (24 sources)`.

- [ ] **Step 3: Check that only the streets entry changed**

Run: `git diff --stat pipeline/sources.lock.json` and `git diff pipeline/sources.lock.json`
Expected: one added source object with `id` `datasf-streets`; every other entry byte-identical. `datasf-streets` is in neither `AS_OF_SOURCE_IDS` (`pipeline/project-records/parse.ts`) nor `TRANSIT_DATE_SOURCE_IDS` (`pipeline/steps/transit.ts`), so `asOf` and the transit target date cannot move (confirmed in Task 7 Step 3). Only the `datasetVersion` date moves, to the streets' `retrievedAt`.

- [ ] **Step 4: Resolve the corridors**

Run: `npm run pipeline -- lesscars-cnns`, then `npx prettier --write pipeline/enrichment/lesscars/corridors.resolved.json`
Expected: exit 0 and 20 resolved corridors. If any selector fails: **stop and report** the `CorridorError` lines. A selector Appendix A wrote that the data cannot resolve is a plan question, not a code fix.

- [ ] **Step 5: Sanity-check the lengths**

Read `lengthM` per corridor and compare with the street on a map (the owner or reviewer can repeat this). Expected order of magnitude: `VAN NESS AVE, LOMBARD ST → MARKET ST` about 3 km per carriageway; `IRVING ST, ARGUELLO BLVD → 9TH AVE` about 0.6 km; `GEARY BLVD, PRESIDIO AVE → WOOD ST` under 0.5 km. A corridor several times its expected length means a stretch past the cross street: stop and report.

- [ ] **Step 6: Commit**

```bash
git add pipeline/sources.lock.json pipeline/enrichment/lesscars/corridors.resolved.json
git commit -m "chore(data): lock DataSF street centrelines and resolve the lesscars corridors"
```

(`chore(data):`, not `data:`: `data` is a releasable type in `release-please-config.json`, reserved for the production bump.)

---

### Task 4: Transcribe the plan

**Files:**
- Create: `pipeline/enrichment/lesscars/plan.json`
- Create: `pipeline/test/lesscars-live-plan.test.ts`
- Modify: `docs/dev/lesscars.md` ("The plan format": the live plan exists)

**Interfaces:**
- Consumes: `parseLessCarsPlan`, `checkPlan`, `schedulePlan`, `monthsAfter`, `opensAfter` (Task 1); `CORRIDORS_RESOLVED_JSON` (Task 2, file from Task 3); `LESSCARS_PLAN_JSON.live` (`pipeline/lesscars-config.ts:50`).
- Produces: `plan.json`, a `LessCarsPlan` with `id` `lesscars-v1`, `label` `Fewer cars, v1`, 4 capacity rules, 66 projects (18 named in Appendix A plus 48 parking conversions), one display.

Transcription rules (each value from Appendix A; anything not covered here is a plan question):

- Every `Param` is `{ value, provenance }` with the provenance row of its `PV-…` id from Appendix A's Provenances table: `tier`, `label` and `method` verbatim; `sources` one `{ label, url }` per listed source id, `label` the Appendix B citation text before its URL and `url` its URL (`sources: []` for "—"). No `n` or `window`.
- `capacity`: the Capacity table.
- Transit lines: `stops` as `{ id, name, lngLat }` from Appendix A (`name` the text after the id, without the coordinates); `alignment` as stated (geary-subway-1: the six stops in order; geary-19th-subway-2: phase 1's end, its six stops, Daly City BART).
- `geary-19th-subway-2` carries `"opensAfter": ["geary-subway-1"]` (owner answer 6; the only `opensAfter` in v1).
- Bus lanes: `stopIds` `muni:` + each listed number, in the order listed.
- Every selector-segmented project: `segments` is one `{ cnn }` per selector, in Appendix A order, each list copied from `corridors.resolved.json`.
- `geary-trench`: `segments: [{ cnn: [<the fourteen CNNs in Decisions>] }]`.
- `central-freeway-stub`: `segments: [{ line: <Appendix A's 8 points>, provenance: <PV-line-cfwy> }]`.
- Garages: `site: { parcel }`, `spaces` with `PV-spaces-south` / `PV-spaces-north`.
- Parking conversions: one per row of Appendix A's Parking conversions table; `label` `Parking at <Street> becomes homes` with the Street column of plan-v1's 48-site table (Data findings); `build.durationMonths` 30 with `PV-build`.
- `displays`: the Masonic entry (Decisions), segments from `corridors.resolved.json`.

- [ ] **Step 1: Write the failing test**

```ts
// pipeline/test/lesscars-live-plan.test.ts — reads plan.json, corridors.resolved.json and
// docs/lesscars/plan-v1.md (tables parsed by a local helper: rows of the pipe table under a heading).
// params(plan) yields every Param (durations, build durations, tph, rowHalfWidthM, spaces) plus each
// capacity rule's and each drawn line's provenance, with its dotted path.
it('parses and checkPlan on the live plan is empty', () => {
  expect(checkPlan(plan, schedulePlan(plan))).toEqual([]);
});
it('has the approved shape', () => {
  expect(plan.id).toBe('lesscars-v1');
  expect(plan.projects).toHaveLength(66);
  expect(plan.projects.filter((p) => p.kind === 'parking-conversion')).toHaveLength(48);
  expect(plan.capacity.map((c) => [c.kind, c.maxConcurrent])).toEqual([['transit', 4], ['street', 6], ['garage', 2], ['housing', 15]]);
});
it('every Param has a provenance label; every tier 4 label says invented or unsourced', () => {
  for (const { path, provenance } of params(plan)) {
    expect(provenance.label.trim(), path).not.toBe('');
    if (provenance.tier === 4) expect(provenance.label, path).toMatch(/invented|unsourced/i);
  }
});
it('every provenance equals its Appendix A row (tier, label, method)', () => {
  for (const { path, provenance } of params(plan))
    expect(pick(provenance), path).toEqual(appendixProvenance(provenance.label));
});
it('the parking conversions equal Appendix A, row for row', () => {
  expect(parking(plan)).toEqual(appendixParkingRows()); // id, parcel, startYear, months, dependsOn, build.startYear
});
it('selector segments equal corridors.resolved.json', () => {
  for (const c of resolved.corridors) expect(cnnsOf(plan, c.owner), c.owner).toContainEqual(c.cnn);
  expect(resolvedOwners).toEqual(selectorOwnersInPlan);
});
it('geary-trench removes the main lanes, their twins and the Fillmore frontage roads', () => {
  expect(trenchCnns.sort()).toEqual(FOURTEEN.sort());
});
it('phase 2 opens after phase 1, and the check would catch the reverse', () => {
  expect(open('geary-19th-subway-2')).toBeGreaterThanOrEqual(open('geary-subway-1'));
  expect(codes(checkPlan(phase2Earlier, schedulePlan(phase2Earlier)))).toContain('geary-19th-subway-2:opens-before');
});
it('Masonic is a display from geary-subway-1, no project touches its CNNs, nothing is a roundabout', () => {
  expect(plan.displays).toEqual([expect.objectContaining({ id: 'masonic-station', from: 'geary-subway-1' })]);
  expect(projectCnns.some((c) => masonicCnns.includes(c))).toBe(false);
  expect(JSON.stringify(plan)).not.toMatch(/roundabout/i);
});
it('a display id reused by a project reports duplicate-id on that id', () => {
  expect(codes(checkPlan(withClash, schedulePlan(withClash)))).toContain('masonic-station:duplicate-id');
});
it('every new stop lies in San Francisco', () => {
  for (const s of newStops) {
    expect(s.lngLat[0], s.id).toBeGreaterThan(-122.53); expect(s.lngLat[0], s.id).toBeLessThan(-122.35);
    expect(s.lngLat[1], s.id).toBeGreaterThan(37.7); expect(s.lngLat[1], s.id).toBeLessThan(37.84);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-live-plan.test.ts`
Expected: FAIL (`plan.json` missing).

- [ ] **Step 3: Write `plan.json`**

By the rules above, then `npx prettier --write pipeline/enrichment/lesscars/plan.json`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-live-plan.test.ts`
Expected: PASS. If `checkPlan` reports a problem, or Appendix A contradicts itself (a row that differs between the project text and the table, a provenance id with no row): **stop and report**; do not change the value.

- [ ] **Step 5: Docs and commit**

`docs/dev/lesscars.md` "The plan format": the live plan is `pipeline/enrichment/lesscars/plan.json`, transcribed from plan-v1 Appendix A; `lesscars-live-plan.test.ts` holds it to the document.

```bash
git add pipeline/enrichment/lesscars/plan.json pipeline/test/lesscars-live-plan.test.ts docs/dev/lesscars.md
git commit -m "feat(lesscars): the approved v1 plan as the live plan"
```

---

### Task 5: The "Fewer cars" mode link

**Files:**
- Modify: `src/lib/shell/SiteHeader.svelte:29,102-107`
- Test: `src/lib/shell/SiteHeader.svelte.spec.ts` (mode links block, lines 35-85; the 768/1024 fit test, lines 386-422)
- Modify: `e2e/lesscars.spec.ts` (the no-plan test, line 415 onward)
- Modify: `docs/dev/lesscars.md` (route intro line 280-282, e2e notes, builder's calls "No header mode link until Plan 3")

**Interfaces:**
- Consumes: `routeId` prop.
- Produces: a third mode link `<a href="/lesscars">Fewer cars</a>` after Simulate, `aria-current="page"` when `routeId === '/lesscars'`, in both the md+ nav and the phone Menu nav.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows three links at 1024px; Fewer cars points at /lesscars and is current there', async () => {
  render(SiteHeader, { routeId: '/lesscars' });
  await expect.element(nav.getByRole('link', { name: 'Fewer cars' })).toHaveAttribute('href', '/lesscars');
  await expect.element(nav.getByRole('link', { name: 'Fewer cars' })).toHaveAttribute('aria-current', 'page');
  await expect.element(nav.getByRole('link', { name: 'Simulate' })).not.toHaveAttribute('aria-current');
});
it('puts Fewer cars in the menu at 375px', async () => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect.element(nav.getByRole('link', { name: 'Fewer cars' })).toBeVisible();
});
// the existing "at 768/1024px Autosave off, the nav and every action fit without overlap" test
// runs unchanged on /sim with the third link present
```

e2e no-plan test: reach `/lesscars` by clicking the header "Fewer cars" link from `/about` (through Menu on the mobile project) instead of the anchor the test injects.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project client src/lib/shell/SiteHeader.svelte.spec.ts`
Expected: FAIL (no "Fewer cars" link).

- [ ] **Step 3: Add the link to `modeLinks`**

- [ ] **Step 4: Run the header specs and the lesscars e2e**

Run: `npx vitest --run --project client src/lib/shell`, then `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts`
Expected: PASS, including the existing 768 px `/sim` fit test. If that fit test fails with the third link, **stop and report** the overflow in px: shortening `/sim`'s actions or the link label is a UI call for the owner, not this task.

- [ ] **Step 5: Docs and commit**

```bash
git add src/lib/shell e2e/lesscars.spec.ts docs/dev/lesscars.md
git commit -m "feat(lesscars): Fewer cars mode link in the header"
```

---

### Task 6: The page at live scale

**Files:**
- Modify: `src/lib/lesscars/HeadlineBar.svelte` (only if Step 2 fails), `src/lib/lesscars/legend.ts`, `src/lib/lesscars/DetailsPanel.svelte:79-99`, `src/lib/lesscars/TimelineDialog.svelte` (only if Step 2 fails)
- Test: `src/lib/lesscars/HeadlineBar.svelte.spec.ts`, `src/lib/lesscars/map-layers.spec.ts:270-330` (`LESSCARS_LEGEND` block), `src/lib/lesscars/TimelineDialog.svelte.spec.ts`, `e2e/lesscars.spec.ts`

**Interfaces:**
- Consumes: `headlineText`, `headlineName` (`summary-view.ts:32-37`); `STOP_RADIUS` (`map-layers.ts:123`); `timelineRows` (`timeline-view.ts:52`); `pipeline/enrichment/lesscars/plan.json` (Task 4; imported as JSON by the client spec, parsed with `parseLessCarsPlan`, times from `schedulePlan`).
- Produces: `LegendRow.radius: number | null` (disc radius in px, null for non-discs); the single `stop` row becomes `stop-subway` "Subway stop", `stop-tram` "Tram stop", `stop-brt` "Rapid bus stop", each `radius: STOP_RADIUS[mode]`; `DetailsPanel` draws each disc at `r={row.radius}`.

- [ ] **Step 1: Write the failing tests**

```ts
// HeadlineBar.svelte.spec.ts — rendered as SiteHeader's pinned item with the Menu
it('at 375 px a six-digit headline fits beside the Menu', async () => {
  await page.viewport(375, 812); // summary with final mean 123456.4, band 98,000 to 151,000
  expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  await expect.element(page.getByRole('button', { name: /\+123,456 homes by 2068/ })).toBeVisible();
});
// map-layers.spec.ts
it('the key has one stop row per mode, sized as the map draws it', () => {
  for (const mode of ['subway', 'tram', 'brt'] as const)
    expect(LESSCARS_LEGEND.find((r) => r.id === `stop-${mode}`)?.radius).toBe(STOP_RADIUS[mode]);
  expect(LESSCARS_LEGEND.some((r) => r.id === 'stop')).toBe(false);
});
// TimelineDialog.svelte.spec.ts — on the live plan
it('at 375 px the live plan timeline has no horizontal overflow; 48 parking rows sit in the disclosure', async () => {
  await page.viewport(375, 812);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await expect.element(page.getByText('Parking at Geary Blvd becomes homes')).not.toBeVisible();
  // opens the disclosure, then: 48 parking rows, and the longest label wraps inside the dialog
  expect(parkingRows).toHaveLength(48);
});
```

```ts
// e2e/lesscars.spec.ts
test('dark mode: axe on the page, the details and the timeline', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expectNoA11yViolations(page); // then with the details open, then with the timeline open
});
```

The existing `LESSCARS_LEGEND` label-list test is updated to the three stop rows.

- [ ] **Step 2: Run them to verify which fail**

Run: `npx vitest --run --project client src/lib/lesscars` and `npx vitest --run --project server src/lib/lesscars/map-layers.spec.ts`
Expected: the legend test FAILS. The headline and timeline tests may already pass; a pass needs no change.

- [ ] **Step 3: Implement what failed**

- Legend: the three stop rows and `radius`; `DetailsPanel` uses it.
- Headline, only if it overflowed: below `lg` the words " homes by 2068" are visually hidden (`max-lg:sr-only`) as `ScoreBar` hides "added"; `aria-label` (`headlineName`) is unchanged.
- Timeline, only if it overflowed: the table wraps its project-label column (`break-words`) inside the dialog; no horizontal page scroll.

- [ ] **Step 4: Run the specs and the e2e**

Run: `npx vitest --run --project client src/lib/lesscars`, `npx vitest --run --project server src/lib/lesscars`, `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts`
Expected: PASS in both Playwright projects. A dark-mode axe violation is fixed in the token or class that causes it (`src/lib/map/palette.ts` tokens are contrast-checked by their spec).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lesscars e2e/lesscars.spec.ts
git commit -m "feat(lesscars): stop key rows per mode; live-scale header, timeline and dark-mode checks"
```

---

### Task 7: Live build and measure

Run by the controller on the owner's laptop, in this session. Starts only when Tasks 1–6 are committed and the tree is clean (the hash includes uncommitted changes under hashed paths).

**Files:**
- Modify: `docs/dev/lesscars.md` (new section "First live build"; "Running it" and "CI cost" updated)
- Modify, only under the 30-minute rule: `pipeline/config.ts:205` (`LIVE_PROFILE.lesscarsSeeds`), `docs/dev/lesscars.md` ("Paired runs": the seed count)

**Interfaces:**
- Consumes: the committed lock (Task 3) and `plan.json` (Task 4).
- Produces: `pipeline/out/<v>/` with every invariant passing, `<v>` the version Tasks 8 and 9 use.

- [ ] **Step 1: Build**

Run (in the background, it takes several minutes): `npm run pipeline -- build`
Expected: exit 0, every invariant OK, V35's detail `66 projects, <n> sites, 41 year ends`. On a failure: a lesscars `BuildError` (a dataset check: stop id, route id, parcel, service distance) or a V35 failure (including `timeline.bin` over 3 MB) **stops the task**; report the full message and the measured value. Do not raise a budget or edit the plan.

- [ ] **Step 2: Apply the 30-minute rule**

Read `timings.lesscars` from `pipeline/out/<v>/report.json`. Over 30 minutes: keep this run's `summary.json` aside, set `LIVE_PROFILE.lesscarsSeeds` to the largest odd count whose projected step time (linear in seeds) is under 30 minutes, commit `perf(lesscars): <n> live seeds to keep the build under 30 minutes`, rebuild, and record the p10–p90 band width at 2068 at both counts.

- [ ] **Step 3: Confirm `asOf` and the transit date did not move**

Compare `pipeline/out/<v>/scenarios/fzp/projects.json` `.asOf` and `calibration.json` `.asOf` with the published `https://sfhousing.mindlace.net/data/2026-10-29-14e0eccb/scenarios/fzp/projects.json` and `…/calibration.json`, and the transit service dates in `transit.json` with the published one.
Expected: equal. Not equal: stop and report (the streets source moved a date it must not).

- [ ] **Step 4: Measure the carve**

Sum `rec.areaM2` over `scenarios/lesscars/sites.json` sites per project (`jq '[.sites[] | select(.projectId == "geary-trench") | .rec.areaM2] | add'`, same for `central-freeway-stub`).
Expected: `geary-trench` between 12,000 and 20,000 m² (plan-v1's ~1.8 ha strip before cross streets, less the `keepHalfM` corridors of four to five crossings; band is builder's). Outside it: stop and report with the site list. `central-freeway-stub`: record the area; 0 m² is reported to the owner as plan-v1 Concern 2 (the land under the viaduct is already a parcel), not fixed.

- [ ] **Step 5: Record "First live build" in `docs/dev/lesscars.md`**

Date, `<v>`, machine; `timings.lesscars` and the whole build's time; the seed count; V35's detail; the headline (2068 mean, p10, p90); the 2068 source breakdown (freed, parking, transit-unlocked, other); the regime days (`summary.regimeDays` as ISO dates); `lesscars.sites`, `lesscars.sites.zero_yield`, `lesscars.sites.zero_gain_parking` (and the warning naming those conversions), `lesscars.unlocked_lots`; `timeline.bin` bytes; the carve areas from Step 4; whether each garage reservation was kept in the representative seed (`timeline` `reservations`). Update "Running it" (the live build now runs the step) and the seed count if Step 2 changed it.

- [ ] **Step 6: Commit**

```bash
git add docs/dev/lesscars.md
git commit -m "docs(lesscars): first live build measurements"
```

---

### Task 8: Controller verification on the local live dataset

Run by the controller. Replaces the outline's owner gate: the controller checks the rendered page; it is not a stop for owner approval.

**Files:**
- Modify: `docs/dev/lesscars.md` (a "Live check" paragraph under "First live build")

**Interfaces:**
- Consumes: `pipeline/out/<v>/` (Task 7), `scripts/r2-load-local.ts` (as `npm run data:fixture` uses it), `window.__sfhLessCars` (`src/lib/lesscars/debug.ts`, VITE_E2E builds only).

- [ ] **Step 1: Load the live dataset into local R2 and point the app at it**

Run: `npx tsx scripts/r2-load-local.ts pipeline/out/<v> <v>`; set `.dev.vars` to `PUBLIC_DATASET_VERSION=<v>` (restore `fixture-0` afterwards); run `npm run db:migrate`, then `VITE_E2E=1 npm run preview`.

- [ ] **Step 2: Check the page at `http://localhost:4173/lesscars`, 1280 px and 375 px**

Pass when all hold:
- The header headline equals `Math.round` of `summary.extra.mean` at 2068 with the recorded band; the details' four parts add to it.
- The "Fewer cars" link is current; Timeline lists 66 projects with parking in the disclosure; Evidence shows tier 4 as "Assumption, not data".
- Scrubbing: Fulton, 19th Avenue and N Judah streets in their transit state from 2032; the Geary subway line and stops from 2041 and the Masonic underpass drawn filled from then; freed land on Geary from 2044 and on the Central Freeway stub from mid-2035; buildings rising on parking sites from 2034; scrubbing back to 2028 clears all of it.
- Garages: a marker for each garage reservation recorded as kept in Task 7, none for a voided one.

- [ ] **Step 3: Watch revision 0 on the live dataset**

In the console: `window.__sfhLessCars.revision` and `.cells` after load; time from navigation to revision 0, and whether scrubbing stays responsive while chunks pack (no input lag over about a second on the scrubber).
Pass bar: revision 0 within 10 s and the scrubber responsive. A miss is recorded with its numbers and reported; the packing cap is a follow-up, not a fix in this plan.

- [ ] **Step 4: Record and commit**

The "Live check" paragraph: what was checked, the revision-0 time and cell count, garage verdicts seen, anything that looked wrong (reported to the owner).

```bash
git add docs/dev/lesscars.md
git commit -m "docs(lesscars): live check of the page on the first live build"
```

---

### Task 9: Upload, verify and promote

Run by the controller, through the normal flow (Global Constraints). Needs `wrangler login` with R2 write.

**Files:**
- Modify: `wrangler.jsonc:57` (staging `PUBLIC_DATASET_VERSION`) in its own PR; `wrangler.jsonc:27` (production) in a later PR

- [ ] **Step 1: Check the freeze**

Run: `git fetch origin` and `git log --oneline HEAD..origin/main -- pipeline src/lib/data src/lib/generator src/lib/timelapse src/lib/plan/geometry.ts src/lib/plan/types.ts`
Expected: empty, and `git status` clean. Otherwise merge `origin/main` and go back to Task 7.

- [ ] **Step 2: Upload**

Run: `npm run pipeline -- upload <v>`
Expected: the archive and artifacts uploaded with `manifest.json` last and the bump line printed. It refuses unless `report.json` passes, tiles were built and the lock is the one that built `<v>`.

- [ ] **Step 3: Verify through staging**

Run: `npm run pipeline -- verify <v> --origin https://sfhousing-staging.mindlace.net`
Expected: `OK   <v> verified against https://sfhousing-staging.mindlace.net` (every manifest file, including `scenarios/lesscars/*`).

- [ ] **Step 4: Finish the feature branch**

Run `npm run signoff` (do not `git push` first), open the PR with the body from a temp file (`gh pr create --body-file`), title `feat(lesscars): wire the approved v1 plan into the live build (plan 3 of 3)`, and squash-merge once `chreode/signoff` is green. Signoff runs no live build: `pipeline/` matches no `chreode.config.ts` rule, so it runs every step (format, lint, check, test:pipeline, test:unit, test:e2e, burn-in, lint:workflows), and the only pipeline build among them is the mini fixture inside `test:pipeline`.

- [ ] **Step 5: Point staging at `<v>`**

On a fresh branch from `origin/main`: set `env.staging.vars.PUBLIC_DATASET_VERSION` to `<v>`; commit `chore(data): point staging at dataset <v>`; signoff; PR with the same title; squash-merge. After `deploy-staging.yml` finishes (its smoke step reads the manifest): check `https://sfhousing-staging.mindlace.net/attribution` (DataSF Streets listed with PDDL-1.0), the `/sim` map, and `/lesscars` (headline equal to Task 7's, map plays).

- [ ] **Step 6: Point production at `<v>`**

On a fresh branch: set the top-level `PUBLIC_DATASET_VERSION` to `<v>`; commit `data: point production at dataset <v>`; signoff; PR with that title; squash-merge. This opens or updates the release PR. **Do not merge the release PR**: cutting the release is the owner's (production then deploys from the tag). Until then production keeps the old dataset and code.

- [ ] **Step 7: Report**

Tell the owner: `<v>`, the three PRs, the staging check result, that the release PR is ready for them, and the headline with its band.

---

## Carried from Plan 2

| Item | Where |
| --- | --- |
| Header "Fewer cars" mode link | Task 5 |
| 375 px header fit with the live headline; hide "homes" and "2068" if needed | Task 6 (`at 375 px a six-digit headline fits beside the Menu`) |
| axe pass in dark mode | Task 6 (e2e `dark mode: axe …`) |
| Timeline table at 375 px with plan-v1's labels and 48 parking rows | Task 6 (TimelineDialog spec on the live plan) |
| Plan-stop key row's per-mode size | Task 6 (`the key has one stop row per mode …`) |
| Display-id duplicate message once real displays land | Task 4 (`a display id reused by a project reports duplicate-id on that id`) |
| Watch revision 0's uncapped packing on the live dataset | Task 8 Step 3 |
| Geary trench twin-CNN carve check | Task 4 (fourteen CNNs test), Task 7 Step 4 (area band) |
| Phase 2 opens after phase 1 | Task 1 (`opensAfter`), Task 4 |
| The `masonic` display entry | Tasks 2–4 (`masonic-station`) |
| Street-change only, no `roundabout` | Task 4 (`Masonic is a display …, nothing is a roundabout`) |
| Stop lng/lat range validation (Plan 1 ruling 6) | Task 1 (range check), Task 4 (San Francisco box) |
| e2e for a kept garage | Deferred (below); live verdicts checked in Task 8 Step 2 |
| Card placement on touch tablets (`md:left-16`) | Deferred (below) |
| Shared FzpMode/LessCarsMode helper | Deferred (below) |

## Deferred

- **Shared FzpMode/LessCarsMode helper** (map-ready queue, chunk status, prefetch wiring). FzpMode is a frozen surface, and the helper would have to change it. `docs/dev/lesscars.md` keeps the follow-up note.
- **e2e for a kept garage.** e2e runs on fixture-0 only, and fixture-0's representative seed voids both garage reservations (`docs/dev/lesscars.md` "Street states and layers"). Changing the mini fixture so that a seed keeps one would churn every golden for a path already covered by `playback-host.spec.ts` ("a kept garage-parcel reservation is reported but demolishes nothing") and the `garageFeatures` tests. The live verdicts are checked by eye in Task 8.
- **Card placement on touch tablets.** The card's `md:left-16` clears the bottom-left NavigationControl, which SimMap adds only for fine pointers (`src/lib/map/SimMap.svelte:552`). On a coarse-pointer tablet the 64 px gap is unused space, not an overlap. Neither Playwright project emulates a coarse-pointer tablet, so a fix could not be tested here. Revisit with a device check.
- **Revision 0 packing cap.** Watched in Task 8; any change waits for those numbers.

## Rulings and owner changes embedded (2026-11-02)

1. Upload, verify and both bumps moved from partner actions into Task 9, via `pipeline.md` steps 3–6 and `deploy.md` "Promoting a datasetVersion". Staging and production pick the version from `wrangler.jsonc` (`env.staging.vars` and top-level `vars`). `deploy-staging.yml` deploys on every push to `main`; `deploy-prod.yml` deploys on a published release, which release-please cuts when its PR is merged. The release PR is left to the owner.
2. Outline Task 4 (owner review) is Task 8, a controller check. Numbers are recorded in `docs/dev/lesscars.md` (Task 7). Changes to plan numbers still go back to the owner; an unbuildable Appendix A stops the task.
3. Every "Carried from Plan 2" item is placed above.
4. Corridor selectors resolve from the locked `datasf-streets` source through `lesscars-cnns` (Tasks 2 and 3), with the Geary twins and the Masonic display.
5. The heavy build runs here (Task 7), with the 30-minute rule. `npm run signoff` does not rebuild the live dataset (Task 9 Step 4).

## Open questions for the owner

None blocking. Two conditional stops are built in: Task 5 stops if the third mode link no longer fits `/sim`'s 768 px header, and Task 7 stops if `timeline.bin` exceeds V35's 3 MB budget. Each reports the measured overflow for the owner to decide.
