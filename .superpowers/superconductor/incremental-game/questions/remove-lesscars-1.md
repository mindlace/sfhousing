# Question remove-lesscars-1 — from incremental-game-remove-lesscars
## Question
`npm run data:transit` (`scripts/data-transit.ts`) writes the *parsed* manifest back to the local dataset's `manifest.json`. With L1's derived `splitRoads` mark, that round trip writes `splitRoads: true` into the file and drops `scenarios.lesscars`, so on the next load the older-dataset mark is gone and the map loses its `roads_lc` stretches (local dev only). The file is outside this unit's write set. May `remove-lesscars` edit `scripts/data-transit.ts` (and its spec) so it keeps the raw JSON and only adds `transit`? Or should another unit own the fix, or the design change?

## What the package says
- remove-lesscars spec §sec-design-manifest: "`ManifestSchema` sets it, so `parseManifest` and every direct `ManifestSchema.parse` agree." "A `splitRoads` key in the raw JSON is ignored; only `scenarios.lesscars` sets the mark." "No build writes the mark or the key."
- §sec-write-set lists `scripts/data-local.spec.ts` as the only `scripts/` file; `scripts/data-transit.ts` is in no write set I can find in the spec.
- CLAUDE.md setup runs `npm run data:fixture` then optionally `npm run data:transit`; fixture-0 is an older (split-roads) dataset until this unit's Task 6 regenerates it, and any `data:local <older version>` stays one.

## What I found
- verified-at `scripts/data-transit.ts:56-59`: `const manifest = withTransit(parseManifest(JSON.parse(readFileSync(...))))`, then `writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest))`, then `putLocal(version, 'manifest.json', ...)`.
- verified-at commit 940657d8 (`src/lib/data/manifest.ts`, `markSplitRoads` in `z.preprocess`): parse of an older manifest yields `splitRoads: true` and no `scenarios.lesscars`; re-parse of that output yields no mark (raw `splitRoads` is ignored by spec).
- Before this unit the round trip kept `scenarios.lesscars`, so this is a regression this unit introduces.
- Grep of `parseManifest(|ManifestSchema.parse` over scripts/pipeline/src: 37 files; data-transit is the only one I found that writes the parsed value back to a dataset (unverified for the rest beyond reading the list: pipeline `buildManifest` writes new-build manifests, which have no `lesscars`).
- Found by the Task 3 reviewer (`.superpowers/sdd/2026-11-22-remove-lesscars.html/task-3-review.md` in my worktree, Important 1).

## Options I see
1. Add `scripts/data-transit.ts` and `scripts/data-transit.spec.ts` to remove-lesscars' write set: write `{ ...raw, transit: withTransit(parseManifest(raw)).transit }` (parse only to validate), plus a spec case on an older manifest (written JSON has no `splitRoads`, re-parse still gives `splitRoads: true`). Small, in this unit's Task 3 fix round. (Recommended.)
2. Leave it; accept that `data:transit` on an older local dataset hides the `roads_lc` stretches until `data:fixture` is re-run (local dev only; fixture-0 stops being older after Task 6).
3. Change the design so the mark survives a round trip (e.g. honour a raw `splitRoads` key) — contradicts §sec-design-manifest's "A `splitRoads` key in the raw JSON is ignored".

## Blocking
Only the Task 3 fix round for this finding. Tasks 4–7 proceed meanwhile (they touch none of these files).
