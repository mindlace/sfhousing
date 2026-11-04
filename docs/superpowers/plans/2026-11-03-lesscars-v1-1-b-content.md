# /lesscars v1.1 Plan B of 2: Wiring the Approved v1.1 Section into the Live Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live dataset carries the owner-approved v1.1 plan: the freeway-land catalog and basemap ids transcribed into `pipeline/enrichment/lesscars/`, `plan.json` amended from the v1.1 section of `docs/lesscars/plan-v1.md`, a full local build with the paired runs, the new headline, breakdown and the change to `/sim`'s and FZP's numbers recorded, and the dataset uploaded and promoted through staging and production bump PRs.

**Architecture:** No new mechanism: Plan A built every one (catalog and rule, `freewayLand`, freed parcels, held garage sites, basemap ids and the hide or split path). This plan is transcription, tests that hold the files to the approved document, the heavy build on the owner's laptop, and the release flow of plan 3 (`docs/superpowers/plans/2026-11-01-lesscars-3-plan-content.md` Tasks 7-9).

**Tech Stack:** TypeScript, Vitest (pipeline project), DuckDB spatial, tsx, Playwright, wrangler (R2 upload), `gh`.

**Spec:** `docs/superpowers/specs/2026-11-03-lesscars-v1-1-design.md` ("Data and build", "Owner decisions"). The approved section: `docs/lesscars/plan-v1.md` `## v1.1 (2026-11-03): freeway removal and freeway land` (approval line filled in). Plan A: `docs/superpowers/plans/2026-11-03-lesscars-v1-1-a-engine.md`. Release flow: `docs/dev/pipeline.md` ("Release run order", "Lock and datasetVersion"), `docs/dev/deploy.md` ("Promoting a datasetVersion").

## Amendments (2026-11-03, the owner's decisions on the v1.1 section)

The owner approved the v1.1 section on 2026-11-03 with these decisions (section "Owner decisions
(2026-11-03)"); the tasks below are amended to match:

- **One new garage, not two.** `garage-alemany` is dropped; `garage-rincon` stands on `3764064`
  (1,700 spaces, PV-spaces-rincon), on the green freed when `i80-rincon` takes down the westbound
  Harrison St off-ramp. The US-101 phases (the stub included) depend on no garage.
- **Two CNNs change segment.** `19374000` (the Harrison St off-ramp) and `19383000` (the westbound
  mainline piece that only feeds it) move from `i80-bay-bridge` to `i80-soma`, so `i80-rincon`'s
  `segments` list has 24 CNNs. `freeway-land.json` must move them too (it still has the draft
  partition), and `i80-soma`'s label gains ", and the Harrison St off-ramp".
- **Parcels move and drop.** `3764056`, `3764064`, `3765714`, `3765715` move from the kept
  `i80-bay-bridge` list to `i80-soma`'s `in` rows; the stub's `3513071` and `3513074` are `in`;
  three `i280-north` lots (`4382003`, `4349004`, `5232011`) are `excluded` after the satellite spot
  check. `freeway-land.draft.json` carries all of it.
- **`street` capacity 7** (section "Capacity changed", provenance PV-cap-street-7): the phases start
  2033 (stub), 2037, 2040, 2043 (US-101) and 2038 (`i80-rincon`); the last build completes
  mid-2048.
- **Basemap ids:** `i80-rincon` keeps 35184403218600 and drops 35184485600277 (section "Basemap
  ids").

## Global Constraints

- **Starts only after the owner has approved the v1.1 section** (its approval line is filled in). No approval line: stop.
- The enrichment files and `plan.json` transcribe the approved section: no number, parcel, date, dependency or id enters them without its row in the section; a change found necessary while wiring goes back to the owner, never into a file silently.
- If the section proves unbuildable as written (`checkPlan`, a dataset check, V35, the basemap id check or the catalog's homes check fails), the task **stops and reports** the exact message. It never edits a value to make the build pass.
- **Never demolish homes; never free a real park; never count homes twice** (spec Anti-goals): enforced by Plan A's checks; a failure here stops the task.
- The full paired run happens in the local `npm run pipeline -- build` on the owner's laptop, in this session, never in CI. If `report.json` `timings.lesscars` exceeds **30 minutes**, reduce `LIVE_PROFILE.lesscarsSeeds` (`pipeline/config.ts`, keep it odd) and record the band width at both counts.
- Hashed-paths freeze: `datasetVersion` hashes the committed code under `pipeline/`, `src/lib/data/`, `src/lib/generator/`, `src/lib/timelapse/`, `src/lib/plan/geometry.ts`, `src/lib/plan/types.ts`, `src/lib/sim/scenario/`, `src/lib/sim/levers/` and `src/lib/scoreboard/` (the 9 paths of `docs/dev/pipeline.md` "Lock and datasetVersion"), plus the lock and tool versions. Every change there (the enrichment files and `plan.json` included) lands before Task 3's build; after it nothing under those paths changes until the upload, and if one must (or `origin/main` brings one), rebuild.
- Upload, verify and both `PUBLIC_DATASET_VERSION` bumps are done by the controller through the normal flow only: `docs/dev/pipeline.md` "Release run order" steps 3-6, then `docs/dev/deploy.md` "Promoting a datasetVersion" (staging PR titled `chore(data): point staging at dataset <v>`, the staging check, then a later PR titled `data: point production at dataset <v>`). Merging the release PR stays with the owner.
- JSON under `pipeline/enrichment/` is prettier-checked: `npx prettier --write <file>` on every file written.
- `fixture-0` and the goldens change only through `npm run pipeline -- fixture --update-golden` (this plan expects no change to them). Never hand-edit a migration.
- Tests: Vitest with `expect.requireAssertions`; e2e on `fixture-0` in both Playwright projects.
- Code style, commits: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits; `chore(data):` for the lock-free data commits, never `data:` before the production bump (`data` is a releasable type). No Claude attribution anywhere (no `Co-Authored-By`, no generated-with footers). Multi-line commit and PR bodies through a temp file (`git commit -F`, `gh pr create --body-file`), never heredocs. Never compound `cd … && cmd`. Never bare `git stash`. PRs merge only with `chreode/signoff` from `npm run signoff`; never `git push` before it.
- CSP unchanged. No new runtime dependency.

## Review Focus

1. **A section table and the file drifting apart.** A parcel moved between segments, an exclusion without its reason, or a phase list that differs from the catalog's segments for that phase. Expected: the transcription tests parse the section's tables and compare them field for field. Test: Task 1 (`freeway-land.json equals the section, segment for segment`), Task 2 (`each phase frees exactly its segments' catalog parcels`).
2. **Two demolition crews on one freeway.** Phases of the same freeway overlapping in [start, open). Expected: the live-plan test fails naming both. Test: Task 2 (`no two phases of one freeway overlap`).
3. **A closure before its garage opens.** `i80-rincon` starting before `garage-rincon` opens. Expected: `checkPlan`'s `starts-before-dependency` and a direct test. Test: Task 2 (`i80-rincon depends on garage-rincon, which opens first; no US-101 phase depends on a garage`).
4. **A kept freeway disappearing from `/sim`.** After the release, `/sim` and FZP must still draw I-280, US-101 south of Alemany and today's US-101 and I-80. Expected: the live check sees them at z11, z13 and z15. Test: Task 4 Step 2.
5. **A large, silent change to `/sim`'s numbers.** The rule removes capacity everywhere. Expected: the counts by freeway, `/sim`'s and FZP's headline before and after, recorded in `docs/dev/lesscars.md` and in the feature PR body before release. Test: Task 3 Steps 4-5.

---

## Decisions (builder's calls)

- **The transcription tests read the section's tables, not prose.** Plan A Task 9 fixed the headings and column layouts; `pipeline/test/lesscars-live-plan.test.ts` and a new `pipeline/test/lesscars-v1-1-enrichment.test.ts` parse them. Reason: as plan 3's live-plan test does for Appendix A.
- **v1's Appendix A plus the v1.1 changes.** The live-plan test rebuilds the plan from Appendix A, then applies the section's `Projects added`, `Projects changed`, `Projects removed`, `Provenances added` and `Capacity changed` tables. Reason: v1's tables stay as approved; v1.1 is a dated amendment.
- **The `/sim` before and after is measured on the page.** Task 3 records the static counts the build reports; Task 4 reads `/sim`'s and `/fzp`'s headline on the old and new dataset in local R2. Reason: the counts are the build's report; the headlines are what a person sees.
- **Three PRs**, as plan 3: the feature PR, the staging bump, the production bump.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `pipeline/enrichment/lesscars/freeway-land.json` | the catalog: curated parcels and exclusions per segment | 1 |
| `pipeline/enrichment/lesscars/basemap-ids.json` | curated basemap ids per phase | 1 |
| `pipeline/test/lesscars-v1-1-enrichment.test.ts` | both files held to the section | 1 |
| `pipeline/enrichment/lesscars/plan.json`, `pipeline/enrichment/lesscars/corridors.json`, `corridors.resolved.json` (only if the section adds a selector) | the amended live plan | 2 |
| `pipeline/test/lesscars-live-plan.test.ts` | the plan held to Appendix A plus the v1.1 changes | 2 |
| `docs/dev/lesscars.md` | "v1.1 live build", "v1.1 live check" | 3, 4 |
| `wrangler.jsonc` | `PUBLIC_DATASET_VERSION` bumps (separate PRs) | 5 |

---

### Task 1: Transcribe the catalog and the basemap ids

**Files:**
- Modify: `pipeline/enrichment/lesscars/freeway-land.json` (fill `parcels`, `excluded`, `curated` from §3 of the section; move CNNs `19374000` and `19383000` from `i80-bay-bridge` to `i80-soma` and take `i80-soma`'s label from the section's Freeway segments table)
- Create: `pipeline/enrichment/lesscars/basemap-ids.json` (from §8)
- Create: `pipeline/test/lesscars-v1-1-enrichment.test.ts`

**Interfaces:**
- Consumes: `parseFreewayLand` (Plan A Task 2), `parseBasemapIds` (Plan A Task 6), `docs/lesscars/plan-v1.md` §2, §3, §8 tables.
- Produces: the live catalog the scenario step reads (`LESSCARS_FREEWAY_LAND_JSON.live`) and the live id list (`LESSCARS_BASEMAP_IDS_JSON.live`).

- [ ] **Step 1: Write the failing test**

```ts
// lesscars-v1-1-enrichment.test.ts — a local helper reads the pipe table under a heading
it('freeway-land.json equals the section, segment for segment', () => {
  for (const seg of catalog.segments) {
    expect(seg.parcels, seg.id).toEqual(sectionRows(seg.id).filter((r) => r.Decision === 'in').map((r) => r.Parcel).sort());
    expect(seg.excluded, seg.id).toEqual(sectionRows(seg.id).filter((r) => r.Decision === 'out').map((r) => ({ parcel: r.Parcel, reason: r.Reason })));
  }
  expect(catalog.segments.map((s) => s.id)).toEqual(sectionSegments().map((r) => r['Segment id']));
});
it('each segment has the CNNs of its Freeway segments row', () => {
  for (const seg of catalog.segments) expect(seg.cnn, seg.id).toEqual(sectionCnns(seg.id));
  expect(byId('i80-soma').cnn).toEqual(expect.arrayContaining(['19374000', '19383000']));
});
it('a rule segment equals freeway-land.draft.json, and the spot-check removals are excluded', () => {
  // the section's kept-segment tables show only the largest rows; the draft file is the full list
  for (const seg of catalog.segments.filter((s) => s.curated === 'rule'))
    expect(seg.parcels, seg.id).toEqual(draftSegment(seg.id).parcels);
  for (const id of ['4382003', '4349004', '5232011']) expect(set.has(id), id).toBe(false);
});
it('every segment a phase removes is curated by hand', () => {
  for (const s of catalog.segments.filter((x) => x.removedBy)) expect(s.curated, s.id).toBe('hand');
});
it('the stub parcels and the owner’s example are freeway land', () => {
  for (const id of ['3502112', '3503002', '3513071', '3513074']) expect(set.has(id), id).toBe(true);
  expect(EXAMPLE_14.every((id) => set.has(id) || excludedWithReason(id))).toBe(true);
});
it('the parcels recon flagged are decided with a reason', () => {
  for (const id of ['3179011', '3179010', '4012031', '4154001']) expect(decided(id), id).toBe(true);
});
it('basemap-ids.json equals §8, phase for phase, and names only removal phases', () => {
  expect(ids.phases).toEqual(sectionBasemapPhases());
  for (const p of ids.phases) expect(catalog.segments.some((s) => s.removedBy === p.project), p.project).toBe(true);
});
```

`EXAMPLE_14` is the section's list of the owner's example parcels (§3 marks them), not a literal in the test.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-v1-1-enrichment.test.ts`
Expected: FAIL (empty parcel lists; no `basemap-ids.json`).

- [ ] **Step 3: Transcribe both files**

From the section's tables only; `npx prettier --write` both.

- [ ] **Step 4: Run it to verify it passes, then the pipeline suite**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-v1-1-enrichment.test.ts`, then `npm run test:pipeline`
Expected: PASS; goldens unchanged (the fixture reads the fixture catalog). If the section contradicts itself (a parcel `in` on two segments, an `out` with no reason): **stop and report**.

- [ ] **Step 5: Commit**

```bash
git add pipeline/enrichment/lesscars/freeway-land.json pipeline/enrichment/lesscars/basemap-ids.json pipeline/test/lesscars-v1-1-enrichment.test.ts
git commit -m "feat(lesscars): the approved freeway-land catalog and basemap ids"
```

---

### Task 2: Amend the live plan

**Files:**
- Modify: `pipeline/enrichment/lesscars/plan.json`
- Modify: `pipeline/test/lesscars-live-plan.test.ts` (Appendix A plus the v1.1 changes)
- Modify, only if the section adds a street selector: `pipeline/enrichment/lesscars/corridors.json`, then `npm run pipeline -- lesscars-cnns` for `corridors.resolved.json`
- Modify: `docs/dev/lesscars.md` ("The plan format": the live plan is v1 plus v1.1)

**Interfaces:**
- Consumes: `parseLessCarsPlan`, `checkPlan`, `schedulePlan` (`src/lib/data/lesscars/`), `freewayLand` (Plan A Task 3), the catalog (Task 1).
- Produces: `plan.json` with `id` as the section states (keep `lesscars-v1` unless the section changes it), `garage-south` gone, `garage-rincon` (site `3764064`), the US-101 phases and `i80-rincon` added, no `garage-alemany`, `central-freeway-stub` changed as §6 says (no garage dependency; five freed parcels), and `street` capacity 7 with PV-cap-street-7 from "Capacity changed".

Transcription rules (each value from the section; anything else is a plan question):
- Every `Param` takes its provenance row from Appendix A's Provenances table or the section's `Provenances added`, as plan 3 Task 4's rules.
- Each phase's `segments` are the CNN lists of its segments in `freeway-land.json` (`removedBy` = the phase id), in segment order, or the stub's line if the owner kept it.
- Each phase's `freewayLand` is `{ parcels: <its segments' catalog parcels, sorted>, excluded: <their exclusions> }`.
- Garages: `site: { parcel }` and `spaces` as §5.
- Capacity: each row of "Capacity changed" replaces that kind's `maxConcurrent` and provenance.

- [ ] **Step 1: Extend the failing test**

```ts
it('parses and checkPlan on the live plan is empty', () => {
  expect(checkPlan(plan, schedulePlan(plan))).toEqual([]);
});
it('has the approved v1.1 shape', () => {
  expect(plan.projects.map((p) => p.id)).not.toContain('garage-south');
  expect(ids).not.toContain('garage-alemany');
  expect(ids).toEqual(expect.arrayContaining(['garage-rincon', 'i80-rincon', ...US101_PHASES]));
  expect(plan.capacity.find((c) => c.kind === 'street')?.maxConcurrent).toBe(7);
  expect(plan.projects).toHaveLength(appendixCount() + added().length - removed().length);
});
it('each phase frees exactly its segments’ catalog parcels', () => {
  for (const p of phases) expect(p.freewayLand?.parcels, p.id).toEqual(catalogParcelsRemovedBy(p.id));
});
it('no two phases of one freeway overlap', () => {
  for (const [a, b] of pairsOnSameFreeway(phases)) expect(overlap(t(a), t(b)), `${a.id} ${b.id}`).toBe(false);
});
it('i80-rincon depends on garage-rincon, which opens first; no US-101 phase depends on a garage', () => {
  for (const p of us101Phases) expect(p.dependsOn.filter((d) => byId(d).kind === 'edge-garage'), p.id).toEqual([]);
  expect(byId('i80-rincon').dependsOn).toContain('garage-rincon');
  expect(byId('garage-rincon').site).toEqual({ parcel: '3764064' });
  for (const p of phases) for (const g of garagesOf(p)) expect(t(g).openDay).toBeLessThanOrEqual(t(p).startDay);
});
it('the stub keeps its v1 dates', () => {
  expect(t(byId('central-freeway-stub'))).toMatchObject({ startDay: yearStart(2033) });
});
it('every provenance equals its row (Appendix A or v1.1)', () => {
  for (const { path, provenance } of params(plan)) expect(pick(provenance), path).toEqual(rowFor(provenance.label));
});
```

Existing cases (parking conversions row for row, selector CNNs, the Geary trench, Masonic, `opensAfter`, the San Francisco box) stay; a case that named `garage-south` follows the section.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-live-plan.test.ts`
Expected: FAIL (plan.json is v1).

- [ ] **Step 3: Amend `plan.json`**

By the rules above; `npx prettier --write pipeline/enrichment/lesscars/plan.json`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-live-plan.test.ts`, then `npm run test:pipeline`
Expected: PASS. A `checkPlan` problem or a contradiction in the section: **stop and report**; do not change the value.

- [ ] **Step 5: Docs and commit**

```bash
git add pipeline/enrichment/lesscars pipeline/test/lesscars-live-plan.test.ts docs/dev/lesscars.md
git commit -m "feat(lesscars): the approved v1.1 plan as the live plan"
```

---

### Task 3: Live build and measure

Run by the controller on the owner's laptop, in this session. Starts only when Tasks 1-2 are committed and `git status` is clean (the hash includes uncommitted changes under hashed paths).

**Files:**
- Modify: `docs/dev/lesscars.md` (new section "v1.1 live build" after "First live build"; "Running it" if the seed count changes)
- Modify, only under the 30-minute rule: `pipeline/config.ts` (`LIVE_PROFILE.lesscarsSeeds`)

**Interfaces:**
- Consumes: the committed lock (unchanged), the catalog, ids and plan (Tasks 1-2).
- Produces: `pipeline/out/<v>/` with every invariant passing; `<v>` for Tasks 4-5.

- [ ] **Step 1: Build**

Run (in the background): `npm run pipeline -- build`
Expected: exit 0, every invariant OK, V35's detail `<n> projects, <m> sites, 41 year ends`. A lesscars `BuildError` (a freed parcel with homes or outside the catalog, a parking conversion on freeway land, a basemap id missing), a scenario error (a catalog parcel with homes) or a V35 failure **stops the task**: report the full message.

- [ ] **Step 2: Apply the 30-minute rule**

As plan 3 Task 7 Step 2.

- [ ] **Step 3: Confirm `asOf`, transit dates and calibration did not move**

Compare `pipeline/out/<v>/scenarios/fzp/projects.json` `.asOf`, `calibration.json` and `transit.json`'s service dates with `pipeline/out/2026-11-02-39fbf039/` (or the published files under `https://sfhousing.mindlace.net/data/2026-11-02-39fbf039/`).
Expected: `asOf` and transit dates equal; `calibration.json` byte-identical (the freeway rule leaves the panel alone, Plan A Decisions). Not equal: stop and report.

- [ ] **Step 4: Read the delta report and the carve**

From `report.json` counts: `scenario.freeway_land.lots`, `scenario.freeway_land.net_removed` and each `scenario.freeway_land.net_removed.<freeway>`; `lesscars.sites`, `lesscars.sites.parcels`, `lesscars.sites.held`, `lesscars.freed_m2.parcels`, `lesscars.freed_m2.row`; `summary.json` `garageCost`; `tiles.basemap_split_changed` (if Plan A ran Task 7b). Sum `rec.areaM2` per project from `sites.json`. Compare `summary.baseline` at 2068 with v1's 90,054.
Expected: `net_removed` positive on every freeway with catalog parcels; every phase frees area. A phase that frees 0 m²: stop and report with its site list.

- [ ] **Step 5: Record "v1.1 live build" in `docs/dev/lesscars.md`**

Date, `<v>`, machine; whole build time and `timings.lesscars`; seeds and representative seed; V35's detail; the headline (2068 mean, p10, p50, p90; plan against baseline); the 2068 breakdown by source (largest-remainder rounding, as the page shows it); freed land from parcels and from right-of-way (ha) and per phase; each garage's reservation verdict in the representative seed and `garageCost`; regime days; the report counts above; `timeline.bin` bytes; **the change to `/sim`'s and FZP's numbers**: the freeway-land counts by freeway, and the baseline's change against v1. Update "Running it" if the seed count changed.

- [ ] **Step 6: Commit**

```bash
git add docs/dev/lesscars.md
git commit -m "docs(lesscars): v1.1 live build measurements"
```

---

### Task 4: Controller check on the local live dataset

Run by the controller. A check of the rendered pages, not an owner gate.

**Files:**
- Modify: `docs/dev/lesscars.md` ("v1.1 live check" under "v1.1 live build")

**Interfaces:**
- Consumes: `pipeline/out/<v>/` (Task 3), `scripts/r2-load-local.ts`, `window.__sfhLessCars` (VITE_E2E builds).

- [ ] **Step 1: Load both datasets into local R2**

Run: `npx tsx scripts/r2-load-local.ts pipeline/out/<v> <v>` and, for the before numbers, `npm run data:local -- 2026-11-02-39fbf039`; `npm run db:migrate`. Point `.dev.vars` at each in turn (`PUBLIC_DATASET_VERSION=…`; restore `fixture-0` afterwards) and run `VITE_E2E=1 npm run preview`.

- [ ] **Step 2: Check `/sim` and `/fzp` on both datasets, 1280 px**

Pass when all hold:
- Record `/sim`'s and `/fzp`'s headline (the ScoreBar numbers at their defaults) on `2026-11-02-39fbf039` and on `<v>`; the difference has the sign the counts predict.
- On `<v>`, at z11, z13 and z15 over the Central Freeway, the Hairball, Alemany and Rincon Hill, `/sim` and `/fzp` still draw today's US-101, I-80 and I-280 (nothing is removed outside `/lesscars`).
- No new map element on `/sim` or `/fzp`.

- [ ] **Step 3: Check `/lesscars` on `<v>`, 1280 px and 375 px**

Pass when all hold:
- The headline equals Task 3's; the details' four parts add to it; the freed-land disclosure's hectares equal Task 3's parcel and right-of-way areas; the garage cost line shows `garageCost`'s total when present.
- Timeline lists the project count of Task 2; Evidence shows the new provenances.
- For each phase: before its open day the freeway draws at z11, z13 and z15; from its open day it is gone at every zoom, labels included, while I-280 and US-101 south of Alemany still draw; its removed-line overlay and its freed land (parcels included) appear; scrubbing back restores the freeway.
- The `garage-rincon` marker appears when its reservation was kept (Task 3); no `garage-south` or `garage-alemany` marker.
- No console or network errors.

- [ ] **Step 4: Record and commit**

The "v1.1 live check" paragraph: what was checked, `/sim` and `/fzp` before and after, anything that looked wrong (reported to the owner).

```bash
git add docs/dev/lesscars.md
git commit -m "docs(lesscars): v1.1 live check, with /sim and FZP before and after"
```

---

### Task 5: Upload, verify and promote

Run by the controller, through the normal flow. Needs `wrangler login` with R2 write.

**Files:**
- Modify: `wrangler.jsonc` (staging `PUBLIC_DATASET_VERSION` in its own PR; top-level production in a later PR)

- [ ] **Step 1: Check the freeze**

Run: `git fetch origin`, then `git log --oneline HEAD..origin/main -- pipeline src/lib/data src/lib/generator src/lib/timelapse src/lib/plan/geometry.ts src/lib/plan/types.ts src/lib/sim/scenario src/lib/sim/levers src/lib/scoreboard`
Expected: empty, and `git status` clean. Otherwise merge `origin/main` and go back to Task 3.

- [ ] **Step 2: Upload**

Run: `npm run pipeline -- upload <v>`
Expected: the archive and artifacts uploaded with `manifest.json` last and the bump line printed (it refuses unless `report.json` passes, tiles were built and the lock built `<v>`).

- [ ] **Step 3: Verify through staging**

Run: `npm run pipeline -- verify <v> --origin https://sfhousing-staging.mindlace.net`
Expected: `OK   <v> verified against https://sfhousing-staging.mindlace.net`.

- [ ] **Step 4: Finish the feature branch**

Run `npm run signoff` (no `git push` first), then open the PR with the body from a temp file (`gh pr create --body-file <file>`), title `feat(lesscars): v1.1 freeway removal and freeway land`. The body states the headline and band, freed land by origin, and **the change to `/sim`'s and FZP's numbers** (Task 3's counts by freeway, Task 4's before and after), so the owner sees it before release. Squash-merge once `chreode/signoff` is green.

- [ ] **Step 5: Point staging at `<v>`**

On a fresh branch from `origin/main`: set `env.staging.vars.PUBLIC_DATASET_VERSION` to `<v>`; commit `chore(data): point staging at dataset <v>`; signoff; PR with the same title; squash-merge. After `deploy-staging.yml`: check `https://sfhousing-staging.mindlace.net/sim` (freeways drawn), `/fzp`, and `/lesscars` (headline equal to Task 3's; a phase's freeway gone after its day).

- [ ] **Step 6: Point production at `<v>`**

On a fresh branch: set the top-level `PUBLIC_DATASET_VERSION` to `<v>`; commit `data: point production at dataset <v>`; signoff; PR with that title; squash-merge. **Do not merge the release PR**: cutting the release is the owner's.

- [ ] **Step 7: Report**

Tell the owner: `<v>`, the three PRs, the staging check, that the release PR is ready for them, the headline with its band, and the change to `/sim` and FZP.

---

## Open questions for the owner

None blocking beyond the approval line. Stops built in: the section unbuildable as written (Tasks 1-3), `asOf`, transit dates or calibration moving (Task 3), a phase freeing no land (Task 3).
