# Drop street-based zoning rules

Status: approved (2026-11-01).

## Intent

`/sim` zones by transit, not by street size. The state bill the app models (SB 79) is entirely about transit, and SF's streets are already busy, so raising heights along a street because of its size is not a lever we want to offer. Later work will improve the transit levers instead.

There are two street-based rule kinds today, Street and Commercial corridor. Both read `frontage.bin`, and the pipeline step that builds that file takes about 67 of the dataset build's 75 minutes. Removing the rules lets the step go too.

## Goals

1. **Rules:** `/sim` offers only Transit rules. The `street` rule kind is gone from the policy model, the form, the summaries and the brush engine. The Commercial corridor preset is a `street` rule, so it goes with it.
2. **Frontage data:** the app neither fetches nor decodes `frontage.bin`.
3. **Pipeline:** the pipeline no longer builds frontage. That removes:
   - `pipeline/steps/frontage.ts` and `pipeline/sql/83_frontage.sql`;
   - V34;
   - the T14 rule `sd.streets.no-frontage`;
   - the `datasf-streets` source;
   - the five frontage `SQL_VARS` and the `frontage*` profile fields.
4. **Saved policies:** an existing policy that holds street rules still opens.

## Non-goals

- New transit levers (later work).
- A dataset rebuild. The live dataset `2026-10-29-14e0eccb` keeps its `frontage.bin`; the app ignores it. The next dataset build drops it naturally.
- Editing historical plans and specs under `docs/superpowers/`. They record what was decided at the time.
- `LOT_FRONTAGE_M` in `src/lib/generator/`. It is the typology generator's synthetic lot width and has nothing to do with street frontage.

## Anti-goals

- **Losing a saved policy.** Today, an autosave that no longer parses is treated as corrupt, and the page starts from an empty policy. A saved street rule must not wipe the transit rules, paint, protections and timing saved alongside it.
- **Breaking older datasets.** The app must still load a dataset whose manifest names `scenarios.fzp.frontage`, such as the live one.

## Decisions

### Compatibility (my call)

**Today:**
- No `/sim` policy has been published: staging's `plan` table has 0 `sim` rows, and production predates `/sim` publishing.
- So the only street rules in the wild are in browser autosaves, under `sfhousing:sim:v1`. The owner confirmed the only one is their own test autosave.

**Schema:** stays at 2. There is no schema bump and no migrator.

**Reading a stored policy (`parseSimDoc(…, 'reconcile')`, which `SIM_CODEC.load` uses):**
- A stored rule with `kind: 'street'` is dropped silently. Every other part of the policy loads as before.
- The next autosave writes the policy without the street rules.
- Other unknown kinds still fail as they do now.
- There is no notice and no dropped-rule count.
- Street rules live only in `policy.rules`. Brush queries are derived from the rules (`ruleQueries`) and never stored.

**Strict parsing (publishing):**
- `strict` parsing still rejects `kind: 'street'` with `bad-field`.
- A tab that has been open since before the deploy and publishes a street rule gets the existing publish error.

**Published `/s/:id`:** it uses `load`, so the same drop applies. There are none today, but the path stays safe.

### Rule UI (my call)

- With only one kind left, "Add a rule" in `RulesSection.svelte` becomes a single "Add transit rule" button instead of a menu.
- `RuleKind`, `RULE_KINDS` and `ruleKindOf` in `brush-summary.ts` collapse or go, whichever is simpler.
- The Transit form is otherwise unchanged.

### Brush engine

**Removed from `src/lib/sim/levers/brushes.ts`:**
- the `street` member of `BrushQuery`;
- `streetRows`;
- `BrushData.frontage`;
- `BrushCatalog.streetNames` and `has.frontage`;
- `'frontage'` from `BrushDataMissing.file`.

**`isNeighborhoodCommercial`** in `src/lib/data/policy-codec.ts`: delete it if nothing else uses it.

**The scenario host and loader:**
- They stop fetching `frontage.bin`: `BRUSH_FILES`, `filesFor`, `fetchBrushFile` with its binary-fetch branch, the `decodeFrontage` seam, and `ScenarioUrls.frontage`.
- The brush catalog then fetches only transit and neighbourhoods.

**`src/lib/data/frontage-codec.ts`:**
- The file is deleted, including `STREET_CLASSES`, unless something outside the removed code still needs a name from it.
- The manifest parser keeps accepting the optional `scenarios.fzp.frontage` key, so older datasets still validate, but nothing reads it.

### Pipeline

**Removed:**
- the frontage step and its SQL;
- `checkV34` and its options;
- the `sd.streets.no-frontage` rule;
- the `datasf-streets` source, its normalise entry and its `sources.lock.json` entry (live and mini);
- the `frontage` manifest flag and the `scenarios.fzp.frontage` key;
- the frontage URL in `verify.ts` and `upload.ts`;
- `FRONTAGE_BIN`.

**Invariants:** they are V1 to V33 afterwards. V34's number is retired, not reused.

**Attribution:**
- The attribution page reads its data credits from the manifest's `sources`; `attribution.ts` hard-codes no dataset credits.
- So removing `datasf-streets` from the lock also removes its credit from the page.
- Its licence is PDDL, so no notice is owed.

**The manifest:**
- `scenarios.fzp.frontage` is optional in the app's manifest schema.
- Nothing gates on it apart from the `MIN_SIM_DATASET` comment.

**Regenerated:**
- the fixture dataset `e2e/fixtures/data/fixture-0`;
- the mini goldens under `pipeline/test/fixtures/mini/golden/`, via `pipeline fixture --update-golden`.

Run the real pipeline for both; `tippecanoe` and `pmtiles` are installed here. Do not hand-edit them.

**Benchmark:** `scripts/bench-levers.ts` brush (b), "arterial frontage depth 1", is replaced by a second transit query (a wider band), so the benchmark still has a multi-lot brush case.

### Docs

Update the live docs:
- `docs/dev/pipeline.md`: drop the Street frontage section, the frontage output, the V34 text, the T14 row and the `datasf-streets` lock bullet. Correct the build time once the step is gone.
- `docs/dev/sim-page.md`: the rules table, the Street and Corridor bullets, the catalog and the dataset requirement (`/sim` needs `policy.bin`), the performance line, and the "Follow a street" gap.
- `docs/dev/sim-levers.md`: the protocol and the perf table row (b).
- `docs/dev/fzp-mode.md:103`: the fixture's file list.
- `scripts/wrangler-config.spec.ts`: the `MIN_SIM_DATASET` comment.

## Left to the builder

- Whether to rename `src/lib/sim/scenario/fixtures/mini-frontage.ts`, which also holds the transit and neighbourhood fixtures.
- Test changes follow from the code. The e2e check that `frontage.bin` is fetched when the panel opens is inverted: the panel does not fetch it.
